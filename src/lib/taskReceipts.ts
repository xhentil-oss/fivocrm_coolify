/**
 * "Parë" — seen / read receipts on tasks (WhatsApp vocabulary: ✓ Dërguar, ✓✓ Parë).
 *
 * Import-free, unit-tested. Two receipts, two shapes:
 *
 *  · ASSIGNMENT — `task.assigneeSeenAt` + `task.assigneeSeenFor`. Written once, by
 *    the assignee themselves (rules), the first time they open the task with the
 *    tab visible (or open its task_assigned notification). `assigneeSeenFor` is
 *    what makes it honest: a seen mark only counts while it names the CURRENT
 *    assignee, so a reassignment path that forgets to clear it still reads
 *    "Pa parë ende" for the new person. Reassignments clear both anyway
 *    (`reassignPatch`) so A → B → A does not resurrect A's old mark.
 *
 *  · COMMENTS — `taskComment.readBy: { [uid]: Timestamp }`. Each reader adds ONLY
 *    their own key (rules: the diff of `readBy` must be exactly the caller's uid,
 *    valued request.time) — a map rather than an array so the time travels with
 *    the person. The author never marks their own comment.
 *
 * Neither write stamps `updatedAt`: being seen is not an edit (and `updatedAt`
 * is read as a date by other engines).
 */

import type { Task, TaskComment } from '../types';

/** Date | Firestore Timestamp | ISO | ms → ms, or null. */
export function receiptMs(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? null : t; }
  if (typeof v === 'object') {
    const o = v as any;
    if (typeof o.toMillis === 'function') return o.toMillis();
    if (typeof o.toDate === 'function') { const d = o.toDate(); return d instanceof Date ? d.getTime() : null; }
    if (typeof o.seconds === 'number') return o.seconds * 1000 + Math.floor((o.nanoseconds || 0) / 1e6);
  }
  return null;
}

const TZ = 'Europe/Tirane';
const dayKey = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
const hm = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(ms);
const MONTHS = ['jan', 'shk', 'mar', 'pri', 'maj', 'qer', 'kor', 'gus', 'sht', 'tet', 'nën', 'dhj'];

/** "14:32" today, "dje 14:32", "12 tet 14:32" otherwise (Tirane wall clock). */
export function receiptTimeLabel(ms: number, nowMs: number = Date.now()): string {
  const k = dayKey(ms);
  if (k === dayKey(nowMs)) return hm(ms);
  if (k === dayKey(nowMs - 86_400_000)) return `dje ${hm(ms)}`;
  const [, m, d] = k.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${hm(ms)}`;
}

// ── Assignment ───────────────────────────────────────────────────────────────

/** When the CURRENT assignee saw the task (ms), or null. */
export function assigneeSeenMs(task: Pick<Task, 'assignedToUserId' | 'assigneeSeenAt' | 'assigneeSeenFor'>): number | null {
  if (!task.assignedToUserId || task.assigneeSeenFor !== task.assignedToUserId) return null;
  return receiptMs(task.assigneeSeenAt);
}

export function isAssigneeSeen(task: Pick<Task, 'assignedToUserId' | 'assigneeSeenAt' | 'assigneeSeenFor'>): boolean {
  return assigneeSeenMs(task) !== null;
}

/** Should THIS viewer stamp the seen mark now? Only the assignee, once, with the tab visible. */
export function shouldMarkAssigneeSeen(
  task: Pick<Task, 'assignedToUserId' | 'assigneeSeenAt' | 'assigneeSeenFor'> | null | undefined,
  uid: string | null | undefined,
  opts: { visible: boolean },
): boolean {
  if (!task || !uid || !opts.visible) return false;
  if (task.assignedToUserId !== uid) return false;
  return !isAssigneeSeen(task);
}

/** "Parë 14:32" / "Pa parë ende" — null when nobody is assigned. */
export function assigneeSeenLabel(
  task: Pick<Task, 'assignedToUserId' | 'assigneeSeenAt' | 'assigneeSeenFor'>,
  nowMs: number = Date.now(),
): string | null {
  if (!task.assignedToUserId) return null;
  const ms = assigneeSeenMs(task);
  return ms === null ? 'Pa parë ende' : `Parë ${receiptTimeLabel(ms, nowMs)}`;
}

/**
 * The assignment write. A CHANGED assignee clears the seen mark (explicit null —
 * the mutation layer strips undefined); an unchanged one writes nothing extra.
 */
export function reassignPatch(
  task: Pick<Task, 'assignedToUserId'> | null | undefined,
  newUserId: string | null,
): Partial<Pick<Task, 'assignedToUserId' | 'assigneeSeenAt' | 'assigneeSeenFor'>> {
  if ((task?.assignedToUserId || null) === (newUserId || null)) return { assignedToUserId: newUserId || undefined };
  return { assignedToUserId: (newUserId || '') as any, assigneeSeenAt: null, assigneeSeenFor: null };
}

// ── Comments ─────────────────────────────────────────────────────────────────

type CommentLike = Pick<TaskComment, 'id' | 'createdByUserId' | 'userId' | 'readBy'> & { senderType?: string };

export function commentAuthor(c: Pick<TaskComment, 'createdByUserId' | 'userId'>): string {
  return c.createdByUserId || c.userId || '';
}

export interface CommentReader { uid: string; at: number }

/** Who read the comment (author excluded), earliest first. */
export function commentReaders(c: CommentLike): CommentReader[] {
  const author = commentAuthor(c);
  const out: CommentReader[] = [];
  const map = c.readBy && typeof c.readBy === 'object' ? c.readBy : {};
  for (const [uid, v] of Object.entries(map)) {
    if (!uid || uid === author) continue;
    const at = receiptMs(v);
    if (at !== null) out.push({ uid, at });
  }
  return out.sort((a, b) => a.at - b.at || a.uid.localeCompare(b.uid));
}

export function shouldMarkCommentRead(c: CommentLike, uid: string | null | undefined): boolean {
  if (!uid || !c.id) return false;
  if (commentAuthor(c) === uid) return false;
  const map = c.readBy && typeof c.readBy === 'object' ? c.readBy : {};
  return !Object.prototype.hasOwnProperty.call(map, uid);
}

/** Ids this viewer still has to mark read (never twice in one session: `alreadySent`). */
export function commentsToMarkRead(
  comments: readonly CommentLike[],
  uid: string | null | undefined,
  alreadySent?: ReadonlySet<string>,
): string[] {
  if (!uid) return [];
  return comments.filter(c => shouldMarkCommentRead(c, uid) && !alreadySent?.has(c.id)).map(c => c.id);
}

export interface CommentReceipt {
  kind: 'sent' | 'read';
  /** "✓ Dërguar" / "✓✓ Parë nga Ardi, Bora" / "✓✓ Parë nga Ardi, Bora +2". */
  label: string;
  /** One line per reader: "Ardi — 14:32". */
  title: string;
}

/**
 * The receipt under a comment. `nameOf` resolves a uid to a display name;
 * `maxNames` caps the inline list (the rest is "+N", the tooltip has everyone).
 */
export function commentReceipt(
  c: CommentLike,
  nameOf: (uid: string) => string,
  opts: { nowMs?: number; maxNames?: number; anonymous?: boolean } = {},
): CommentReceipt {
  const readers = commentReaders(c);
  if (readers.length === 0) return { kind: 'sent', label: '✓ Dërguar', title: 'Askush tjetër nuk e ka parë ende' };
  const now = opts.nowMs ?? Date.now();
  const title = readers.map(r => `${nameOf(r.uid)} — ${receiptTimeLabel(r.at, now)}`).join('\n');
  if (opts.anonymous) return { kind: 'read', label: '✓✓ Parë', title: `Parë ${receiptTimeLabel(readers[readers.length - 1].at, now)}` };
  const max = Math.max(1, opts.maxNames ?? 3);
  const names = [...new Set(readers.map(r => nameOf(r.uid)))];
  const shown = names.slice(0, max).join(', ');
  const more = names.length > max ? ` +${names.length - max}` : '';
  return { kind: 'read', label: `✓✓ Parë nga ${shown}${more}`, title };
}
