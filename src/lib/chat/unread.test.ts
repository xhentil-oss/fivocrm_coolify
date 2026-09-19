import { describe, it, expect } from 'vitest';
import {
  isDmForMe, isUnreadDmForMe, isUnreadClientMessage, isUnreadGroupMessageForMe,
  groupFullyReadAfter, dmUnreadBySender, clientUnreadByChannel, groupUnreadByChannel,
  sumCounts, unionById,
} from './unread';

const me = 'me';
const dm = (o: Partial<Parameters<typeof isDmForMe>[0]> = {}) => ({ id: 'x', senderId: 'elton', receiverId: me, isRead: false, ...o });

describe('DM unread', () => {
  it('counts a DM to me from someone else that is not read', () => {
    expect(isUnreadDmForMe(dm(), me)).toBe(true);
  });
  it('a missing isRead is unread (legacy rows)', () => {
    expect(isUnreadDmForMe(dm({ isRead: undefined }), me)).toBe(true);
  });
  it('never counts my own, channel, task-thread, read or deleted rows', () => {
    expect(isUnreadDmForMe(dm({ senderId: me }), me)).toBe(false);
    expect(isUnreadDmForMe(dm({ channelId: 'grp' }), me)).toBe(false);
    expect(isUnreadDmForMe(dm({ taskId: 't1', receiverId: undefined }), me)).toBe(false);
    expect(isUnreadDmForMe(dm({ isRead: true }), me)).toBe(false);
    expect(isUnreadDmForMe(dm({ deletedAt: new Date() }), me)).toBe(false);
    expect(isUnreadDmForMe(dm({ receiverId: 'other' }), me)).toBe(false);
  });
  it('isDmForMe ignores read state (used to pick what to mark)', () => {
    expect(isDmForMe(dm({ isRead: true }), me)).toBe(true);
  });
  it('groups by sender', () => {
    const map = dmUnreadBySender([dm({ id: 'a' }), dm({ id: 'b' }), dm({ id: 'c', senderId: 'ana' }), dm({ id: 'd', isRead: true })], me);
    expect(map.get('elton')).toBe(2);
    expect(map.get('ana')).toBe(1);
  });
});

describe('client thread unread', () => {
  it('counts only CLIENT messages — a colleague’s message to the client is not mine to read', () => {
    expect(isUnreadClientMessage({ id: '1', senderId: 'c', channelId: 'client-1', senderType: 'client', isRead: false }, me)).toBe(true);
    expect(isUnreadClientMessage({ id: '2', senderId: 'col', channelId: 'client-1', senderType: 'staff', isRead: false }, me)).toBe(false);
    expect(isUnreadClientMessage({ id: '3', senderId: 'c', channelId: 'client-1', senderType: 'client', isRead: false, deletedAt: 1 }, me)).toBe(false);
  });
  it('groups by channel', () => {
    const map = clientUnreadByChannel([
      { id: '1', senderId: 'c', channelId: 'client-1', senderType: 'client', isRead: false },
      { id: '2', senderId: 'c', channelId: 'client-1', senderType: 'client', isRead: false },
      { id: '3', senderId: 'd', channelId: 'client-2', senderType: 'client', isRead: true },
    ], me);
    expect(map.get('client-1')).toBe(2);
    expect(map.has('client-2')).toBe(false);
  });
});

describe('group unread (per member)', () => {
  const groups = new Set(['g1']);
  it('unread until MY uid is in readBy, even when isRead is already true (another member read it)', () => {
    expect(isUnreadGroupMessageForMe({ id: '1', senderId: 'a', channelId: 'g1', isRead: true, readBy: ['b'] }, me, groups)).toBe(true);
    expect(isUnreadGroupMessageForMe({ id: '1', senderId: 'a', channelId: 'g1', isRead: false, readBy: ['b', me] }, me, groups)).toBe(false);
  });
  it('only my groups, never my own or deleted messages', () => {
    expect(isUnreadGroupMessageForMe({ id: '1', senderId: 'a', channelId: 'g9', readBy: [] }, me, groups)).toBe(false);
    expect(isUnreadGroupMessageForMe({ id: '1', senderId: me, channelId: 'g1', readBy: [] }, me, groups)).toBe(false);
    expect(isUnreadGroupMessageForMe({ id: '1', senderId: 'a', channelId: 'g1', readBy: [], deletedAt: 1 }, me, groups)).toBe(false);
  });
  it('groupFullyReadAfter: everyone but the sender has read once I do', () => {
    const m = { id: '1', senderId: 'a', channelId: 'g1', readBy: ['b'] };
    expect(groupFullyReadAfter(m, me, ['a', 'b', me])).toBe(true);
    expect(groupFullyReadAfter(m, me, ['a', 'b', me, 'd'])).toBe(false);
    expect(groupFullyReadAfter(m, me, [])).toBe(false);
    expect(groupFullyReadAfter(m, me, undefined)).toBe(false);
  });
  it('groups by channel', () => {
    const map = groupUnreadByChannel([
      { id: '1', senderId: 'a', channelId: 'g1', readBy: [] },
      { id: '2', senderId: 'a', channelId: 'g1', readBy: [me] },
    ], me, groups);
    expect(map.get('g1')).toBe(1);
  });
});

describe('helpers', () => {
  it('sumCounts and unionById', () => {
    expect(sumCounts(new Map([['a', 2]]), new Map([['b', 3]]))).toBe(5);
    const merged = unionById([{ id: '1', v: 1 }], [{ id: '1', v: 2 }, { id: '2', v: 0 }]);
    expect(merged).toHaveLength(2);
    expect(merged.find(m => m.id === '1')?.v).toBe(2);
  });
});
