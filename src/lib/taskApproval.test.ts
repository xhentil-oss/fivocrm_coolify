import { describe, it, expect } from 'vitest';
import {
  approvalRequestBlockReason,
  buildApprovalRequestPatch,
  buildApprovalCancelPatch,
  clientDecisionBlockReason,
  clientDecisionUpdate,
  approvalBadge,
  approvalRounds,
  nextApprovalRound,
  approvalDecisionRecipients,
  isApprovalPending,
  MAX_DECISION_NOTE,
} from './taskApproval';
import type { Task } from '../types';

const base = (extra: Partial<Task> = {}): Task => ({
  id: 't1', title: 'Logo', status: 'In Progress', projectId: 'p1', customerId: 'c1',
  assignedToUserId: 'ana', createdByUserId: 'ben',
  createdAt: new Date(0), updatedAt: new Date(0),
  ...extra,
} as Task);

const NOW = new Date('2026-10-19T10:00:00Z');

describe('approvalRequestBlockReason', () => {
  const staff = (uid: string, isManagerTier = false) => ({ uid, readOnly: false, isManagerTier });
  it('assignee, creator and managers may ask; others may not', () => {
    expect(approvalRequestBlockReason(base(), staff('ana'))).toBeNull();
    expect(approvalRequestBlockReason(base(), staff('ben'))).toBeNull();
    expect(approvalRequestBlockReason(base(), staff('zoe', true))).toBeNull();
    expect(approvalRequestBlockReason(base(), staff('zoe'))).toBe('not-owner');
  });
  it('read-only roles never ask', () => {
    expect(approvalRequestBlockReason(base(), { uid: 'ana', readOnly: true, isManagerTier: true })).toBe('read-only');
    expect(approvalRequestBlockReason(base(), { uid: null, readOnly: false, isManagerTier: true })).toBe('read-only');
  });
  it('needs a portal-visible task inside a project, open, not already pending', () => {
    expect(approvalRequestBlockReason(base({ customerId: undefined }), staff('ana'))).toBe('no-client');
    expect(approvalRequestBlockReason(base({ projectId: undefined }), staff('ana'))).toBe('no-project');
    expect(approvalRequestBlockReason(base({ status: 'Done' }), staff('ana'))).toBe('done');
    const pending = buildApprovalRequestPatch(base(), { uid: 'ana', now: NOW });
    expect(approvalRequestBlockReason(base(pending), staff('ana'))).toBe('already-pending');
  });
});

describe('request / cancel', () => {
  it('opens round 1 in Review with the note', () => {
    const p = buildApprovalRequestPatch(base(), { uid: 'ana', now: NOW, note: '  Shiko versionin 2  ', attachmentUrl: 'https://vps.fivocrm.com/f.pdf', attachmentName: 'f.pdf' });
    expect(p.status).toBe('Review');
    expect(p.clientApproval).toMatchObject({ state: 'pending', round: 1, requestedByUserId: 'ana', note: 'Shiko versionin 2', attachmentName: 'f.pdf', decidedByUid: null });
    expect(p.clientApprovalHistory).toBeUndefined();
  });
  it('a new round archives the decided one and increments', () => {
    const r1 = base(buildApprovalRequestPatch(base(), { uid: 'ana', now: NOW }));
    const decided = base({ ...r1, clientApproval: { ...r1.clientApproval!, state: 'changes_requested', decisionNote: 'Ngjyra' } });
    const p2 = buildApprovalRequestPatch(decided, { uid: 'ana', now: NOW });
    expect(p2.clientApproval!.round).toBe(2);
    expect(p2.clientApprovalHistory).toHaveLength(1);
    expect(p2.clientApprovalHistory![0]).toMatchObject({ round: 1, state: 'changes_requested' });
    expect(nextApprovalRound(base(p2))).toBe(3);
    // history newest first, current included
    expect(approvalRounds(base(p2)).map(r => r.round)).toEqual([2, 1]);
  });
  it('an attachment name without a url is dropped', () => {
    const p = buildApprovalRequestPatch(base(), { uid: 'ana', now: NOW, attachmentName: 'x' });
    expect(p.clientApproval!.attachmentName).toBeNull();
  });
  it('cancel only withdraws a pending request; Review goes back to In Progress', () => {
    expect(buildApprovalCancelPatch(base(), { uid: 'ana', now: NOW })).toBeNull();
    const pending = base(buildApprovalRequestPatch(base(), { uid: 'ana', now: NOW }));
    const c = buildApprovalCancelPatch(pending, { uid: 'zoe', now: NOW })!;
    expect(c.clientApproval).toMatchObject({ state: 'cancelled', cancelledByUserId: 'zoe', round: 1 });
    expect(c.status).toBe('In Progress');
    expect(approvalBadge(base(c))).toBeNull();
  });
});

describe('client decision', () => {
  const pending = base(buildApprovalRequestPatch(base(), { uid: 'ana', now: NOW }));
  it('only a pending round can be decided', () => {
    expect(clientDecisionBlockReason(base(), 'approved')).toBe('not-pending');
    expect(clientDecisionBlockReason(pending, 'approved')).toBeNull();
  });
  it('changes need a reason; notes are bounded', () => {
    expect(clientDecisionBlockReason(pending, 'changes_requested', '   ')).toBe('note-required');
    expect(clientDecisionBlockReason(pending, 'changes_requested', 'Logo më e madhe')).toBeNull();
    expect(clientDecisionBlockReason(pending, 'approved', 'x'.repeat(MAX_DECISION_NOTE + 1))).toBe('note-too-long');
  });
  it('approve writes only the four decision keys and never completes the task', () => {
    const u = clientDecisionUpdate(pending, 'approved', { uid: 'carol', serverNow: 'TS' });
    expect(u).toEqual({
      'clientApproval.state': 'approved',
      'clientApproval.decidedAt': 'TS',
      'clientApproval.decidedByUid': 'carol',
      'clientApproval.decisionNote': null,
    });
    expect(Object.keys(u)).not.toContain('status');
  });
  it('changes requested sends a task in Review back to work', () => {
    const u = clientDecisionUpdate(pending, 'changes_requested', { uid: 'carol', note: ' Ngjyra ', serverNow: 'TS' });
    expect(u['clientApproval.decisionNote']).toBe('Ngjyra');
    expect(u.status).toBe('In Progress');
    const notReview = clientDecisionUpdate({ ...pending, status: 'Todo' }, 'changes_requested', { uid: 'carol', note: 'x', serverNow: 'TS' });
    expect(notReview.status).toBeUndefined();
  });
});

describe('display + recipients', () => {
  it('badges per state', () => {
    expect(approvalBadge(base())).toBeNull();
    const pending = base(buildApprovalRequestPatch(base(), { uid: 'ana', now: NOW }));
    expect(isApprovalPending(pending)).toBe(true);
    expect(approvalBadge(pending)!.label).toBe('Në miratim te klienti');
    expect(approvalBadge(base({ clientApproval: { ...pending.clientApproval!, state: 'approved' } }))!.label).toBe('✓ Miratuar nga klienti');
    expect(approvalBadge(base({ clientApproval: { ...pending.clientApproval!, state: 'changes_requested' } }))!.label).toBe('↺ Klienti kërkoi ndryshime');
  });
  it('recipients = assignee + requester, deduped', () => {
    const t = base(buildApprovalRequestPatch(base(), { uid: 'zoe', now: NOW }));
    expect(approvalDecisionRecipients(t)).toEqual(['ana', 'zoe']);
    const self = base(buildApprovalRequestPatch(base(), { uid: 'ana', now: NOW }));
    expect(approvalDecisionRecipients(self)).toEqual(['ana']);
  });
});
