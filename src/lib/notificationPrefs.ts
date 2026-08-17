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
