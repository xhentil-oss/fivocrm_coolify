/**
 * Server mirror of src/lib/chat/moderation.ts (api/ never imports src/).
 * `src/lib/chat/moderation.test.ts` checks the reasons and limits agree.
 */

export const REPORT_REASON_KEYS = ['spam', 'abuse', 'inappropriate', 'other'] as const;
export type ReportReason = typeof REPORT_REASON_KEYS[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam ose reklamë e padëshiruar',
  abuse: 'Ngacmim, kërcënim ose fyerje',
  inappropriate: 'Përmbajtje e papërshtatshme',
  other: 'Tjetër',
};

export function isReportReason(v: unknown): v is ReportReason {
  return typeof v === 'string' && (REPORT_REASON_KEYS as readonly string[]).includes(v);
}

export const MAX_BLOCKED_USERS = 500;

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

/** True when `recipientPrefs` says the recipient blocked `actorUserId`. */
export function recipientBlockedActor(recipientPrefs: unknown, actorUserId: string | null | undefined): boolean {
  if (!actorUserId) return false;
  return blockedUserIdsOf(recipientPrefs).includes(actorUserId);
}

export const REPORT_NOTE_MAX = 500;
export function cleanReportNote(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim().slice(0, REPORT_NOTE_MAX);
}
