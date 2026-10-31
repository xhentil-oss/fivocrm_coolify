import { useMemo } from 'react';
import { useBlockedUsers } from './useBlockedUsers';
import { useAuth } from '../contexts/AuthContext';
import { useCollection } from './useFirestore';
import type { ChatMessage, Channel } from '../types';
import {
  dmUnreadBySender, clientUnreadByChannel, groupUnreadByChannel, sumCounts,
} from '../lib/chat/unread';

/**
 * The single source of "what is unread for me" in chat — used by ChatView (list
 * badges + header total + the mark-as-read pass), the Sidebar and MobileBottomNav.
 *
 * Three listeners, all shapes that already existed (so `useCollection`'s
 * module-level cache shares one Firestore stream per shape across every mount):
 *   • DMs:     receiverId == me AND isRead == false            (skipTeamFilter, limit 200)
 *   • client:  businessId == bid AND senderType == 'client' AND isRead == false, newest 300
 *              (index messages(businessId, senderType, isRead, createdAt DESC))
 *   • tenant:  businessId == bid AND isRead == false, newest 200 — the group source
 *              (index messages(businessId, isRead, createdAt DESC))
 *
 * The DM listener is the one the Sidebar always had; ChatView used to count DMs from
 * a DIFFERENT window (the 100 newest received messages of any read state), so a badge
 * and the mark-as-read pass could disagree. Now both read the same rows.
 */
export interface UnreadChatState {
  /** Unread DMs addressed to me (raw rows, for the mark-as-read pass). */
  unreadDms: ChatMessage[];
  /** Unread client-portal messages in this business (raw rows). */
  unreadClientMsgs: ChatMessage[];
  /** Newest `isRead == false` rows in this business (raw rows; group source). */
  unreadTenantMsgs: ChatMessage[];
  myGroupIds: Set<string>;
  myGroups: Channel[];
  dmBySender: Map<string, number>;
  clientByChannel: Map<string, number>;
  groupByChannel: Map<string, number>;
  total: number;
}

const EMPTY: ChatMessage[] = [];

export function useUnreadChat(): UnreadChatState {
  const { user } = useAuth();
  const me = user?.uid || '';

  const unreadDmQuery = useMemo(() => ({
    skip: !me,
    where: [
      { field: 'receiverId', operator: '==' as const, value: me },
      { field: 'isRead', operator: '==' as const, value: false },
    ],
    skipTeamFilter: true,
    // A count only — cap the stream so an ignored inbox can't grow it forever.
    limit: 200,
  }), [me]);
  const { data: unreadDms } = useCollection<ChatMessage>('messages', unreadDmQuery);

  const unreadClientQuery = useMemo(() => ({
    skip: !me,
    where: [
      { field: 'senderType', operator: '==' as const, value: 'client' },
      { field: 'isRead', operator: '==' as const, value: false },
    ],
    orderBy: { field: 'createdAt', direction: 'desc' as const },
    limit: 300,
    teamScopedWhere: true,
  }), [me]);
  const { data: unreadClientMsgs } = useCollection<ChatMessage>('messages', unreadClientQuery);

  const unreadTenantQuery = useMemo(() => ({
    skip: !me,
    where: [{ field: 'isRead', operator: '==' as const, value: false }],
    orderBy: { field: 'createdAt', direction: 'desc' as const },
    limit: 200,
    teamScopedWhere: true,
  }), [me]);
  const { data: unreadTenantMsgs } = useCollection<ChatMessage>('messages', unreadTenantQuery);

  // `channels` is business-isolated regardless of the flag; same shape as ChatView.
  const { data: channels } = useCollection<Channel>('channels', { skipTeamFilter: true });
  const myGroups = useMemo(
    () => (channels || []).filter(c => c?.isGroup && Array.isArray(c.members) && !!me && c.members.includes(me)),
    [channels, me],
  );
  const myGroupIds = useMemo(() => new Set(myGroups.map(g => g.id)), [myGroups]);

  // A blocked person's messages are hidden in the thread, so they must not light the
  // badges either (chat "Blloko", src/lib/chat/moderation.ts).
  const { blocked } = useBlockedUsers();
  const notBlocked = useMemo(
    () => (rows: ChatMessage[] | undefined) => (blocked.size ? (rows || []).filter(m => !blocked.has(m.senderId)) : rows),
    [blocked],
  );
  const dmBySender = useMemo(() => dmUnreadBySender(notBlocked(unreadDms) as ChatMessage[], me), [unreadDms, me, notBlocked]);
  const clientByChannel = useMemo(() => clientUnreadByChannel(unreadClientMsgs, me), [unreadClientMsgs, me]);
  const groupByChannel = useMemo(() => groupUnreadByChannel(notBlocked(unreadTenantMsgs) as ChatMessage[], me, myGroupIds), [unreadTenantMsgs, me, myGroupIds, notBlocked]);
  const total = useMemo(() => sumCounts(dmBySender, clientByChannel, groupByChannel), [dmBySender, clientByChannel, groupByChannel]);

  return {
    unreadDms: unreadDms || EMPTY,
    unreadClientMsgs: unreadClientMsgs || EMPTY,
    unreadTenantMsgs: unreadTenantMsgs || EMPTY,
    myGroupIds,
    myGroups,
    dmBySender,
    clientByChannel,
    groupByChannel,
    total,
  };
}
