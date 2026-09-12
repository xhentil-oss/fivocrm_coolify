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
