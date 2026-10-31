import { describe, it, expect } from 'vitest';
import { canManageTaskSeries, seriesActionBlocked, isPermissionDenied } from './taskSeriesAccess';

const rec = { isRecurring: true, assignedToUserId: 'u2', createdByUserId: 'u3' };

describe('taskSeriesAccess — who may close / re-open a recurring series', () => {
  it('assignee, creator, Admin/Manager/owner/super-admin may; another Member may not', () => {
    expect(canManageTaskSeries(rec, { uid: 'u2' })).toBe(true);
    expect(canManageTaskSeries(rec, { uid: 'u3' })).toBe(true);
    expect(canManageTaskSeries(rec, { uid: 'u9', isManager: true })).toBe(true);
    expect(canManageTaskSeries(rec, { uid: 'u9', isAdmin: true })).toBe(true);
    expect(canManageTaskSeries(rec, { uid: 'u9', isOwner: true })).toBe(true);
    expect(canManageTaskSeries(rec, { uid: 'u9', isSuperAdmin: true })).toBe(true);
    expect(canManageTaskSeries(rec, { uid: 'u9' })).toBe(false);
    expect(canManageTaskSeries(rec, null)).toBe(false);
    expect(canManageTaskSeries(rec, { uid: null })).toBe(false);
  });
  it('a legacy email assignee counts as the assignee', () => {
    expect(canManageTaskSeries({ ...rec, assignedToUserId: 'me@x.al' }, { uid: 'u9', email: 'me@x.al' })).toBe(true);
  });
  it('only a RECURRING task is blocked for an outsider', () => {
    expect(seriesActionBlocked(rec, { uid: 'u9' })).toBe(true);
    expect(seriesActionBlocked({ ...rec, isRecurring: false }, { uid: 'u9' })).toBe(false);
    expect(seriesActionBlocked({ ...rec, isRecurring: undefined }, { uid: 'u9' })).toBe(false);
    expect(seriesActionBlocked(rec, { uid: 'u2' })).toBe(false);
  });
  it('recognises a rules refusal by code or message', () => {
    expect(isPermissionDenied({ code: 'permission-denied' })).toBe(true);
    expect(isPermissionDenied(new Error('FirebaseError: Missing or insufficient permissions.'))).toBe(true);
    expect(isPermissionDenied(new Error('network'))).toBe(false);
    expect(isPermissionDenied(null)).toBe(false);
  });
});
