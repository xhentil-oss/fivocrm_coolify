// Chat read/unread model — the ONE definition of "unread for me", shared by the
// ChatView list badges, the ChatView header total, the Sidebar nav badge and
// MobileBottomNav (via `useUnreadChat`), and by the mark-as-read effects.
//
// Before this module the four surfaces each had their own filter (one counted
// soft-deleted rows, one counted group messages, one ignored `readBy`, one
// scoped DMs by business and one did not), and the mark-as-read pass in
// ChatView read from a DIFFERENT window than the badge did — so a row could be
// counted, "read" in the thread, and never marked. Counted == marked is now a
// structural property: both sides call the predicates below.
//
// Three kinds of message, three read models:
//   • DM            — `receiverId` set, no `channelId`. Read = `isRead` (the
//                     receiver flips it).
//   • client thread — `channelId: client-<customerId>`. A CLIENT message is
//                     unread for staff until `isRead`; a STAFF message is read by
//                     the client via `readAt` (portal) — staff never write that.
//   • group         — `channelId` = a `channels` doc with `isGroup`. Read is
//                     PER MEMBER (`readBy`); `isRead` means "read by every other
//                     member" and only exists so the shared `isRead == false`
//                     window can drop finished messages.

export interface UnreadMessageLike {
  id: string;
  senderId: string;
  receiverId?: string | null;
  channelId?: string | null;
  taskId?: string | null;
  senderType?: string | null;
  isRead?: boolean | null;
  readBy?: string[] | null;
  deletedAt?: unknown;
}

const readByOf = (m: UnreadMessageLike): string[] => (Array.isArray(m.readBy) ? m.readBy : []);

/** A direct message addressed to `me` by someone else (any read state). */
export function isDmForMe(m: UnreadMessageLike, me: string): boolean {
  return !!me && !m.channelId && !m.taskId && m.receiverId === me && m.senderId !== me;
}

/** A DM I have not read yet. A deleted DM is never unread — there is nothing to read. */
export function isUnreadDmForMe(m: UnreadMessageLike, me: string): boolean {
  return isDmForMe(m, me) && !m.isRead && !m.deletedAt;
}

/** A client-portal message (in a `client-*` thread) staff have not read. */
export function isUnreadClientMessage(m: UnreadMessageLike, me: string): boolean {
  return !!m.channelId && m.senderType === 'client' && m.senderId !== me && !m.isRead && !m.deletedAt;
}

/** A group message I (a member) have not opened — per-member via `readBy`. */
export function isUnreadGroupMessageForMe(m: UnreadMessageLike, me: string, myGroupIds: Set<string>): boolean {
  return !!me && !!m.channelId && myGroupIds.has(m.channelId) && m.senderId !== me
    && !m.deletedAt && !readByOf(m).includes(me);
}

/**
 * True when, after `me` reads it, every member of the group other than the
 * sender has read the message — the moment `isRead` may be flipped so the row
 * leaves the shared unread window. Unknown/empty membership never "completes".
 */
export function groupFullyReadAfter(m: UnreadMessageLike, me: string, members: string[] | undefined | null): boolean {
  if (!Array.isArray(members) || members.length === 0) return false;
  const readers = new Set([...readByOf(m), me]);
  return members.every(uid => uid === m.senderId || readers.has(uid));
}

export function countByKey<T>(list: readonly T[] | null | undefined, keyOf: (m: T) => string | null | undefined): Map<string, number> {
  const map = new Map<string, number>();
  (list || []).forEach(m => {
    const k = keyOf(m);
    if (k) map.set(k, (map.get(k) || 0) + 1);
  });
  return map;
}

/** DM unread per sender. */
export function dmUnreadBySender(list: readonly UnreadMessageLike[] | null | undefined, me: string): Map<string, number> {
  return countByKey(list, m => (isUnreadDmForMe(m, me) ? m.senderId : null));
}

/** Client unread per `client-*` channel. */
export function clientUnreadByChannel(list: readonly UnreadMessageLike[] | null | undefined, me: string): Map<string, number> {
  return countByKey(list, m => (isUnreadClientMessage(m, me) ? m.channelId : null));
}

/** Group unread per group channel, per member. */
export function groupUnreadByChannel(list: readonly UnreadMessageLike[] | null | undefined, me: string, myGroupIds: Set<string>): Map<string, number> {
  return countByKey(list, m => (isUnreadGroupMessageForMe(m, me, myGroupIds) ? m.channelId : null));
}

export function sumCounts(...maps: Map<string, number>[]): number {
  let n = 0;
  maps.forEach(map => map.forEach(v => { n += v; }));
  return n;
}

/** Merge several snapshots of the same collection by id (later lists win). */
export function unionById<T extends { id: string }>(...lists: (readonly T[] | null | undefined)[]): T[] {
  const byId = new Map<string, T>();
  lists.forEach(list => (list || []).forEach(m => byId.set(m.id, m)));
  return [...byId.values()];
}
