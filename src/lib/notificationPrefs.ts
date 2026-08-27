/**
 * Shared DND (Do-Not-Disturb) zone stamping for notification preferences.
 *
 * The DND window is typed into an `<input type="time">` — WALL-CLOCK time in the
 * user's own zone. The server (api/_push.ts `isDndActive`) reconstructs the user's
 * local time from `dndTimeZone` / `dndUtcOffsetMinutes`; when neither is stored it
 * falls back to UTC, which for Albania (UTC+2 in summer) turns "22:00–08:00" into
 * an actual 00:00–10:00 silence — pushes at midnight, everything swallowed all
 * morning.
 *
 * Three UIs write `userPreferences/{uid}` (the bell panel, Cilësimet, the portal
 * profile). Every one of them MUST stamp the zone whenever it writes DND fields —
 * the bell always did, the other two did not, so a DND window saved from Cilësimet
 * or the portal was permanently offset. This helper is the single implementation.
 */

function localZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
}

/** Fields to merge into any `userPreferences` write that touches the DND window. */
export function dndZoneStamp(): { dndTimeZone: string; dndUtcOffsetMinutes: number } {
  return {
    dndTimeZone: localZone(),
    // getTimezoneOffset() is minutes to ADD to local to reach UTC — invert it.
    dndUtcOffsetMinutes: -new Date().getTimezoneOffset(),
  };
}

// ── Do-Not-Disturb evaluation (client side) ───────────────────────────────────

/** True when the current LOCAL time falls inside the user's Do-Not-Disturb window. */
export function isInDndWindow(
  prefs: { dndEnabled?: boolean; dndStart?: string; dndEnd?: string } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!prefs?.dndEnabled || !prefs.dndStart || !prefs.dndEnd) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = String(prefs.dndStart).split(':').map(Number);
  const [eh, em] = String(prefs.dndEnd).split(':').map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return false;
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  // Equal start/end reads as "the whole day" (the window has no outside), matching
  // the server (api/_push.ts isDndActive) — `start <= end` alone made it never active.
  if (start === end) return true;
  return start < end ? (cur >= start && cur < end) : (cur >= start || cur < end);
}

// ── Presence: "is this person looking at that conversation right now" ─────────
//
// The key is stamped onto `userPreferences/{uid}` — the SAME document the delivery
// path already reads for pushEnabled/DND/mutes — so a presence check costs the
// server nothing extra. Every chat notification carries the key of the conversation
// it belongs to; `api/_push.ts` compares the two and skips push + email (never the
// bell document) while the recipient is demonstrably reading that thread.

/** A stamp older than this is stale — deliver normally (fail OPEN, never silence). */
export const PRESENCE_FRESH_MS = 2 * 60 * 1000;

/** Conversation key for a channel (group or client-portal channel). */
export function channelConversationKey(channelId: string): string {
  return `ch:${channelId}`;
}

/**
 * Conversation key for a 1:1 DM, from the point of view of the person who has it
 * OPEN — i.e. keyed on the OTHER participant. The sender must therefore stamp the
 * notification with their OWN uid, which is the peer for the recipient.
 */
export function dmConversationKey(peerUserId: string): string {
  return `dm:${peerUserId}`;
}
