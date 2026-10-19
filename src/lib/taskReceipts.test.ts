import { describe, it, expect } from 'vitest';
import {
  receiptMs,
  receiptTimeLabel,
  isAssigneeSeen,
  shouldMarkAssigneeSeen,
  assigneeSeenLabel,
  reassignPatch,
  commentReaders,
  shouldMarkCommentRead,
  commentsToMarkRead,
  commentReceipt,
} from './taskReceipts';

// 2026-10-19 14:32 in Tirane (UTC+2 in October).
const AT = Date.parse('2026-10-19T12:32:00Z');
const NOW = Date.parse('2026-10-19T15:00:00Z');

describe('receiptMs / receiptTimeLabel', () => {
  it('reads Date, Timestamp-like, seconds objects and strings', () => {
    expect(receiptMs(new Date(AT))).toBe(AT);
    expect(receiptMs({ toMillis: () => AT })).toBe(AT);
    expect(receiptMs({ seconds: AT / 1000, nanoseconds: 0 })).toBe(AT);
    expect(receiptMs('2026-10-19T12:32:00Z')).toBe(AT);
    expect(receiptMs(null)).toBeNull();
    expect(receiptMs('nope')).toBeNull();
  });
  it('labels on the Tirane wall clock', () => {
    expect(receiptTimeLabel(AT, NOW)).toBe('14:32');
    expect(receiptTimeLabel(AT - 86_400_000, NOW)).toBe('dje 14:32');
    expect(receiptTimeLabel(Date.parse('2026-10-12T12:32:00Z'), NOW)).toBe('12 tet 14:32');
  });
});

describe('assignment seen', () => {
  const seen = { assignedToUserId: 'ana', assigneeSeenAt: new Date(AT), assigneeSeenFor: 'ana' };
  it('counts only for the CURRENT assignee', () => {
    expect(isAssigneeSeen(seen)).toBe(true);
    expect(isAssigneeSeen({ ...seen, assignedToUserId: 'ben' })).toBe(false);
    expect(isAssigneeSeen({ ...seen, assigneeSeenAt: null })).toBe(false);
  });
  it('labels', () => {
    expect(assigneeSeenLabel(seen, NOW)).toBe('Parë 14:32');
    expect(assigneeSeenLabel({ ...seen, assignedToUserId: 'ben' }, NOW)).toBe('Pa parë ende');
    expect(assigneeSeenLabel({ assignedToUserId: undefined })).toBeNull();
  });
  it('only the assignee marks, once, while visible', () => {
    const fresh = { assignedToUserId: 'ana' };
    expect(shouldMarkAssigneeSeen(fresh, 'ana', { visible: true })).toBe(true);
    expect(shouldMarkAssigneeSeen(fresh, 'ana', { visible: false })).toBe(false);
    expect(shouldMarkAssigneeSeen(fresh, 'ben', { visible: true })).toBe(false);
    expect(shouldMarkAssigneeSeen(seen, 'ana', { visible: true })).toBe(false);
    // stale mark for a previous assignee → the new one marks again
    expect(shouldMarkAssigneeSeen({ ...seen, assignedToUserId: 'ben' }, 'ben', { visible: true })).toBe(true);
    expect(shouldMarkAssigneeSeen(null, 'ana', { visible: true })).toBe(false);
  });
  it('a changed assignee clears the mark; an unchanged one does not', () => {
    expect(reassignPatch({ assignedToUserId: 'ana' }, 'ben')).toEqual({ assignedToUserId: 'ben', assigneeSeenAt: null, assigneeSeenFor: null });
    expect(reassignPatch({ assignedToUserId: 'ana' }, 'ana')).toEqual({ assignedToUserId: 'ana' });
  });
});

describe('comment read receipts', () => {
  const c = (readBy: Record<string, any> | undefined, author = 'ana') => ({ id: 'c1', createdByUserId: author, userId: author, readBy });
  it('readers exclude the author and sort by time', () => {
    const r = commentReaders(c({ ana: new Date(AT), bora: new Date(AT + 60_000), ardi: new Date(AT) }));
    expect(r.map(x => x.uid)).toEqual(['ardi', 'bora']);
  });
  it('mark once, never your own', () => {
    expect(shouldMarkCommentRead(c(undefined), 'ardi')).toBe(true);
    expect(shouldMarkCommentRead(c({ ardi: new Date(AT) }), 'ardi')).toBe(false);
    expect(shouldMarkCommentRead(c(undefined), 'ana')).toBe(false);
    expect(shouldMarkCommentRead(c(undefined), null)).toBe(false);
    const list = [c(undefined), { ...c(undefined), id: 'c2' }, { ...c({ ardi: new Date(AT) }), id: 'c3' }];
    expect(commentsToMarkRead(list, 'ardi')).toEqual(['c1', 'c2']);
    expect(commentsToMarkRead(list, 'ardi', new Set(['c1']))).toEqual(['c2']);
  });
  it('labels: sent, read by names, capped with +N, anonymous for the portal', () => {
    const names: Record<string, string> = { ardi: 'Ardi', bora: 'Bora', cen: 'Cen', dea: 'Dea' };
    const nameOf = (u: string) => names[u] || u;
    expect(commentReceipt(c(undefined), nameOf).label).toBe('✓ Dërguar');
    const two = commentReceipt(c({ ardi: new Date(AT), bora: new Date(AT + 1000) }), nameOf, { nowMs: NOW });
    expect(two.kind).toBe('read');
    expect(two.label).toBe('✓✓ Parë nga Ardi, Bora');
    expect(two.title).toBe('Ardi — 14:32\nBora — 14:32');
    const four = commentReceipt(c({ ardi: AT, bora: AT + 1, cen: AT + 2, dea: AT + 3 }), nameOf, { nowMs: NOW, maxNames: 2 });
    expect(four.label).toBe('✓✓ Parë nga Ardi, Bora +2');
    expect(commentReceipt(c({ ardi: AT }), nameOf, { anonymous: true, nowMs: NOW }).label).toBe('✓✓ Parë');
  });
});
