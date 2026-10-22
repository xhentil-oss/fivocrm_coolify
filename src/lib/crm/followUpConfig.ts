// ── Follow-up thresholds ("Ndjekja") — ONE resolver for every reader ─────────
//
// These numbers used to live hard-coded in three places (leadIntel.ts, the cron's
// runLeadSlaAndStaleAlerts, and a loose `leadCadenceDays` read in
// runLeadCadenceSteps), so a tenant could not change them and the UI and the cron
// could disagree. They are now `teamSettings` keys with defaults, and this module
// is the only thing that knows how to validate them.
//
// Pure — no Firebase, no React. `api/_followUpConfig.ts` is a BYTE-IDENTICAL copy
// (api/ never imports from src/); `followUpConfig.test.ts` reads both files and
// fails on any difference, so "keeping them in sync" means copying the file.
//
// Every invalid value falls back to its default INDIVIDUALLY — a typo in one field
// never resets the others.

export interface FollowUpConfig {
  /** First-response SLA on a new lead, in hours (1–168). */
  followUpSlaHours: number;
  /** A lead with no activity for this many days is "i ftohur" (1–365). */
  followUpStaleDays: number;
  /** Unanswered inbound WhatsApp → `conversation_sla` after this many minutes (15–1440). */
  waResponseSlaMinutes: number;
  /** Day offsets (from enrollment) at which the cadence creates a follow-up task. */
  leadCadenceDays: number[];
}

export const DEFAULT_FOLLOW_UP_CONFIG: Readonly<FollowUpConfig> = Object.freeze({
  followUpSlaHours: 24,
  followUpStaleDays: 14,
  waResponseSlaMinutes: 120,
  leadCadenceDays: Object.freeze([1, 3, 7, 14]) as unknown as number[],
});

export const FOLLOW_UP_LIMITS = Object.freeze({
  followUpSlaHours: { min: 1, max: 168 },
  followUpStaleDays: { min: 1, max: 365 },
  waResponseSlaMinutes: { min: 15, max: 1440 },
  leadCadenceDays: { min: 1, max: 90, maxEntries: 8 },
});

/** Finite integer inside [min, max], or null. Strings ("24") are accepted — the
 *  Settings form and Firestore both round-trip through them. */
function intInRange(raw: unknown, min: number, max: number): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i !== n) return null;
  if (i < min || i > max) return null;
  return i;
}

/**
 * Sorted, de-duplicated day offsets in [1, 90], at most `maxEntries`. Returns null
 * when the input is not a non-empty array or when ANY entry is invalid — a cadence
 * with one bad step is a different cadence than the user typed, so it is refused
 * whole rather than silently trimmed.
 */
export function normalizeCadenceDays(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const { min, max, maxEntries } = FOLLOW_UP_LIMITS.leadCadenceDays;
  const out = new Set<number>();
  for (const v of raw) {
    const i = intInRange(v, min, max);
    if (i === null) return null;
    out.add(i);
  }
  if (out.size === 0 || out.size > maxEntries) return null;
  return Array.from(out).sort((a, b) => a - b);
}

/**
 * Resolve the effective thresholds from a (partial, untyped) `teamSettings`
 * document. Missing or invalid keys take their default; the result is always a
 * complete, valid `FollowUpConfig`.
 */
export function resolveFollowUpConfig(
  // `object` (not Record<string, unknown>) so a typed `TeamSettings` interface
  // and a raw Firestore `DocumentData` are both accepted without a cast.
  settings?: object | null,
): FollowUpConfig {
  const s = (settings || {}) as Record<string, unknown>;
  const d = DEFAULT_FOLLOW_UP_CONFIG;
  const L = FOLLOW_UP_LIMITS;
  return {
    followUpSlaHours:
      intInRange(s.followUpSlaHours, L.followUpSlaHours.min, L.followUpSlaHours.max) ?? d.followUpSlaHours,
    followUpStaleDays:
      intInRange(s.followUpStaleDays, L.followUpStaleDays.min, L.followUpStaleDays.max) ?? d.followUpStaleDays,
    waResponseSlaMinutes:
      intInRange(s.waResponseSlaMinutes, L.waResponseSlaMinutes.min, L.waResponseSlaMinutes.max) ?? d.waResponseSlaMinutes,
    leadCadenceDays: normalizeCadenceDays(s.leadCadenceDays) ?? [...d.leadCadenceDays],
  };
}

/** True when `settings` would resolve to exactly the defaults (nothing customised). */
export function isDefaultFollowUpConfig(cfg: FollowUpConfig): boolean {
  const d = DEFAULT_FOLLOW_UP_CONFIG;
  return cfg.followUpSlaHours === d.followUpSlaHours
    && cfg.followUpStaleDays === d.followUpStaleDays
    && cfg.waResponseSlaMinutes === d.waResponseSlaMinutes
    && cfg.leadCadenceDays.length === d.leadCadenceDays.length
    && cfg.leadCadenceDays.every((v, i) => v === d.leadCadenceDays[i]);
}

// ── Business hours (the WhatsApp response SLA counts only working minutes) ───

/** Mon–Fri 09:00–18:00 Europe/Tirane — no tenant setting exists yet. */
export const DEFAULT_BUSINESS_HOURS = Object.freeze({
  timeZone: 'Europe/Tirane',
  startHour: 9,
  endHour: 18,
  /** ISO-ish weekday numbers, 0 = Sunday … 6 = Saturday. */
  days: [1, 2, 3, 4, 5] as readonly number[],
});

export type BusinessHours = {
  timeZone: string;
  startHour: number;
  endHour: number;
  days: readonly number[];
};

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function zonedClock(ms: number, timeZone: string): { weekday: number; minuteOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return {
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
    minuteOfDay: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  };
}

/**
 * Working minutes between two instants (Mon–Fri 09:00–18:00 in the zone by
 * default). A message that arrives Friday 17:50 has used 10 SLA minutes by
 * Monday 09:00, not 3 days' worth — the old wall-clock count paged managers
 * every weekend night.
 *
 * Walks window boundaries (one or two steps per day, capped at 400 steps ≈ 6
 * months), never minute by minute. The jump to the next 09:00 is computed in
 * local minutes, so the two DST nights a year can shift that one jump by an
 * hour; the next step reads the clock again and corrects itself.
 */
export function businessMinutesBetween(startMs: number, endMs: number, hours: BusinessHours = DEFAULT_BUSINESS_HOURS): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  const open = Math.max(0, Math.min(24, hours.startHour)) * 60;
  const close = Math.max(0, Math.min(24, hours.endHour)) * 60;
  if (close <= open || !hours.days.length) return 0;
  const MIN = 60_000;
  let t = startMs;
  let total = 0;
  for (let i = 0; i < 400 && t < endMs; i++) {
    const { weekday, minuteOfDay } = zonedClock(t, hours.timeZone);
    const workday = hours.days.includes(weekday);
    if (workday && minuteOfDay >= open && minuteOfDay < close) {
      const until = Math.min(endMs, t + (close - minuteOfDay) * MIN);
      total += (until - t) / MIN;
      t = until;
    } else if (workday && minuteOfDay < open) {
      t += (open - minuteOfDay) * MIN;
    } else {
      t += (24 * 60 - minuteOfDay + open) * MIN;
    }
  }
  return Math.floor(total);
}
