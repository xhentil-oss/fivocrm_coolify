/**
 * Chat moderation — "Raporto" (report a message) and "Blloko" (block a person).
 *
 * App Store guideline 1.2: an app with user-generated content must let people report
 * objectionable content and block abusive users. Pure logic only; the server mirror
 * is `api/_chatModeration.ts` (api/ never imports src/ — keep the two in step).
 *
 *  - A block is PER VIEWER: `userPreferences/{uid}.blockedUserIds`. The blocked
 *    person's messages are folded away in the viewer's chat, they leave the viewer's
 *    unread counts, and the server stops pushing/emailing the viewer about them.
 *    The blocked person is not told and their messages are not deleted — it is a
 *    filter on one person's view, exactly what Apple asks for.
 *  - A report goes to `POST /api/report-content`, which stores it (server-only
 *    collection `contentReports`), notifies the business's managers and emails the
 *    platform (social@fivo.al) so it is reviewed within 24h.
 */

export const REPORT_REASONS = [
  { key: 'spam', label: 'Spam ose reklamë e padëshiruar' },
  { key: 'abuse', label: 'Ngacmim, kërcënim ose fyerje' },
  { key: 'inappropriate', label: 'Përmbajtje e papërshtatshme' },
  { key: 'other', label: 'Tjetër' },
] as const;

export type ReportReason = typeof REPORT_REASONS[number]['key'];

export function isReportReason(v: unknown): v is ReportReason {
  return typeof v === 'string' && REPORT_REASONS.some((r) => r.key === v);
}

/** A hard ceiling so a hand-edited preferences doc cannot grow without bound. */
export const MAX_BLOCKED_USERS = 500;

/** The viewer's blocked uids, read defensively from a `userPreferences` document. */
export function blockedUserIdsOf(prefs: unknown): string[] {
  const raw = (prefs as { blockedUserIds?: unknown } | null | undefined)?.blockedUserIds;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && v && !out.includes(v)) out.push(v);
    if (out.length >= MAX_BLOCKED_USERS) break;
  }
  return out;
}

/**
 * Is this message hidden from the viewer? Never their own message (blocking yourself
 * is meaningless) and never a message without a sender.
 */
export function isFromBlockedUser(
  senderId: string | null | undefined,
  viewerId: string | null | undefined,
  blocked: ReadonlySet<string>,
): boolean {
  if (!senderId || senderId === viewerId) return false;
  return blocked.has(senderId);
}

/** Who may be blocked from a message: anyone but yourself. */
export function canBlockSender(senderId: string | null | undefined, viewerId: string | null | undefined): boolean {
  return !!senderId && !!viewerId && senderId !== viewerId;
}

/** Report note: trimmed, single-spaced, capped — it is shown to managers and emailed. */
export const REPORT_NOTE_MAX = 500;
export function cleanReportNote(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim().slice(0, REPORT_NOTE_MAX);
}
