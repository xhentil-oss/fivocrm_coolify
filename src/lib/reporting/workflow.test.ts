import { describe, expect, it } from 'vitest';
import {
  EDITABLE_STATUSES,
  PUBLISHED_STATUSES,
  SIDE_META,
  STATUS_LABELS,
  canEditContent,
  canHardDelete,
  canTransition,
  isBlockEmpty,
  isClientFacingKind,
  nextStaffAction,
  sideOfKind,
  transitionPatch,
} from './workflow';
import type { Report, ReportBlock, ReportStatus } from '../../types';

const NOW = new Date('2026-08-05T10:00:00Z');

const block = (over: Partial<ReportBlock> = {}): ReportBlock => ({
  id: over.id || 'b1',
  type: over.type || 'rich-text',
  order: over.order ?? 0,
  visibility: over.visibility || 'internal',
  ...over,
});

const rep = (over: Partial<Report> = {}): Report => ({
  id: 'r1',
  businessId: 'biz1',
  kind: 'client-monthly',
  title: 'Raport mujor',
  status: 'draft',
  period: { frequency: 'monthly', key: '2026-07', start: '2026-07-01', end: '2026-07-31' },
  authorUserId: 'author',
  blocks: [block({ visibility: 'client', text: 'Rezultate' })],
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const author = { kind: 'staff' as const, userId: 'author', isAuthor: true };
const reviewer = { kind: 'staff' as const, userId: 'lead', canReview: true, isReviewer: true };
const approver = { kind: 'staff' as const, userId: 'boss', canApproveInternal: true, canPublish: true, canSend: true };
const management = { kind: 'staff' as const, userId: 'owner', isManagement: true };
const client = { kind: 'client' as const, userId: 'clientUid', customerId: 'cust1' };

describe('edge legality', () => {
  it('rejects a jump from draft straight to published', () => {
    const r = canTransition(rep({ status: 'draft' }), 'published', { actor: management });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('nuk lejohet');
  });

  it('rejects a no-op transition', () => {
    expect(canTransition(rep({ status: 'draft' }), 'draft', { actor: author }).ok).toBe(false);
  });

  it('allows the happy path one step at a time', () => {
    const steps: Array<[ReportStatus, ReportStatus, any]> = [
      ['draft', 'submitted', author],
      ['submitted', 'under_review', reviewer],
      ['under_review', 'internally_approved', approver],
      ['internally_approved', 'published', approver],
      ['published', 'sent', approver],
    ];
    for (const [from, to, actor] of steps) {
      const res = canTransition(rep({ status: from }), to, { actor });
      expect(res.ok, `${from} → ${to}: ${res.reason}`).toBe(true);
    }
  });

  it('labels every status', () => {
    for (const s of Object.keys(STATUS_LABELS) as ReportStatus[]) {
      expect(STATUS_LABELS[s].length).toBeGreaterThan(0);
    }
  });
});

describe('rule 1 — no publish without internal approval', () => {
  it('blocks publishing from submitted', () => {
    expect(canTransition(rep({ status: 'submitted' }), 'published', { actor: approver }).ok).toBe(false);
  });

  it('blocks publishing a report with no client-visible content', () => {
    const r = rep({ status: 'internally_approved', blocks: [block({ visibility: 'internal' })] });
    const res = canTransition(r, 'published', { actor: approver });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('dukshëm për klientin');
  });

  it('allows an internal-only kind to publish without client blocks', () => {
    const r = rep({ status: 'internally_approved', kind: 'client-risk', blocks: [block({ visibility: 'management' })] });
    expect(canTransition(r, 'published', { actor: approver }).ok).toBe(true);
  });

  it('blocks publishing with unapproved AI content', () => {
    const r = rep({
      status: 'internally_approved',
      blocks: [block({ visibility: 'client', aiSuggested: true, text: 'Draft' })],
    });
    const res = canTransition(r, 'published', { actor: approver });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('AI');
  });
});

describe('rule 4 — separation of duties', () => {
  const submitted = rep({ status: 'submitted', authorUserId: 'author' });

  it('stops the author approving their own report', () => {
    const selfApprover = { ...author, canApproveInternal: true };
    const res = canTransition(submitted, 'internally_approved', { actor: selfApprover });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('Ndarja e detyrave');
  });

  it('allows it when the tenant switches separation off', () => {
    const selfApprover = { ...author, canApproveInternal: true };
    expect(canTransition(submitted, 'internally_approved', {
      actor: selfApprover,
      separationOfDuties: false,
    }).ok).toBe(true);
  });

  it('still allows a different approver', () => {
    expect(canTransition(submitted, 'internally_approved', { actor: approver }).ok).toBe(true);
  });
});

describe('rule 3 — authorisation', () => {
  it('refuses approval from a user without the permission', () => {
    const res = canTransition(rep({ status: 'submitted' }), 'internally_approved', {
      actor: { kind: 'staff', userId: 'nobody' },
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('aprovoni');
  });

  it('refuses publishing from a user without canPublish', () => {
    const res = canTransition(rep({ status: 'internally_approved' }), 'published', {
      actor: { kind: 'staff', userId: 'nobody' },
    });
    expect(res.ok).toBe(false);
  });

  it('requires a reason when requesting changes', () => {
    const noReason = canTransition(rep({ status: 'submitted' }), 'changes_requested', { actor: reviewer });
    expect(noReason.ok).toBe(false);
    const withReason = canTransition(rep({ status: 'submitted' }), 'changes_requested', {
      actor: reviewer, reason: 'Mungon përmbledhja',
    });
    expect(withReason.ok).toBe(true);
  });
});

describe('client transitions', () => {
  it('lets the owning client acknowledge a published report', () => {
    const r = rep({ status: 'published', customerId: 'cust1' });
    expect(canTransition(r, 'acknowledged', { actor: client }).ok).toBe(true);
  });

  it('refuses a client from another tenant', () => {
    const r = rep({ status: 'published', customerId: 'other' });
    const res = canTransition(r, 'acknowledged', { actor: client });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('nuk i përket');
  });

  it('refuses a client acting on an unpublished report', () => {
    const r = rep({ status: 'internally_approved', customerId: 'cust1' });
    expect(canTransition(r, 'acknowledged', { actor: client }).ok).toBe(false);
  });

  it('requires a reason for client rejection', () => {
    const r = rep({ status: 'sent', customerId: 'cust1' });
    expect(canTransition(r, 'client_rejected', { actor: client }).ok).toBe(false);
    expect(canTransition(r, 'client_rejected', { actor: client, reason: 'Numrat nuk përputhen' }).ok).toBe(true);
  });

  it('stops staff from faking a client approval', () => {
    const r = rep({ status: 'published', customerId: 'cust1' });
    const res = canTransition(r, 'client_approved', { actor: management });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('Vetëm klienti');
  });

  it('stops a client touching internal statuses', () => {
    const r = rep({ status: 'submitted', customerId: 'cust1' });
    expect(canTransition(r, 'internally_approved', { actor: client }).ok).toBe(false);
  });
});

describe('required fields gate submission', () => {
  it('blocks submit when a required block is empty', () => {
    const r = rep({
      status: 'draft',
      blocks: [block({ id: 'summary', type: 'executive-summary', required: true, title: 'Përmbledhje' })],
    });
    const res = canTransition(r, 'submitted', { actor: author });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('Përmbledhje');
  });

  it('allows submit once filled', () => {
    const r = rep({
      status: 'draft',
      blocks: [block({ type: 'executive-summary', required: true, text: 'Gjithçka shkoi mirë.' })],
    });
    expect(canTransition(r, 'submitted', { actor: author }).ok).toBe(true);
  });
});

describe('isBlockEmpty', () => {
  it('is type-aware', () => {
    expect(isBlockEmpty(block({ type: 'kpi-cards', kpiIds: [] }))).toBe(true);
    expect(isBlockEmpty(block({ type: 'kpi-cards', kpiIds: ['a'] }))).toBe(false);
    expect(isBlockEmpty(block({ type: 'table', rows: [] }))).toBe(true);
    expect(isBlockEmpty(block({ type: 'table', rows: [{ a: 1 }] }))).toBe(false);
    expect(isBlockEmpty(block({ type: 'progress', progress: 0 }))).toBe(false);
    expect(isBlockEmpty(block({ type: 'progress' }))).toBe(true);
    expect(isBlockEmpty(block({ type: 'page-break' }))).toBe(false);
    expect(isBlockEmpty(block({ type: 'rich-text', text: '   ' }))).toBe(true);
  });
});

describe('transitionPatch', () => {
  it('stamps submittedAt', () => {
    const p = transitionPatch(rep({ status: 'draft' }), 'submitted', { actor: author, now: NOW });
    expect(p.submittedAt).toBe(NOW);
    expect(p.status).toBe('submitted');
  });

  it('counts views and records the first one only once', () => {
    const first = transitionPatch(rep({ status: 'published', viewCount: 0 }), 'viewed', { actor: client, now: NOW });
    expect(first.viewCount).toBe(1);
    expect(first.firstViewedAt).toBe(NOW);

    const later = new Date('2026-08-06T10:00:00Z');
    const second = transitionPatch(
      rep({ status: 'viewed', viewCount: 1, firstViewedAt: NOW }),
      'viewed',
      { actor: client, now: later },
    );
    expect(second.viewCount).toBe(2);
    expect(second.firstViewedAt).toBeUndefined();
    expect(second.lastViewedAt).toBe(later);
  });

  it('pins the approved version and sets a legal hold on client approval (rule 9)', () => {
    const p = transitionPatch(rep({ status: 'sent', version: 3 }), 'client_approved', { actor: client, now: NOW });
    expect(p.clientApprovedVersion).toBe(3);
    expect(p.legalHold).toBe(true);
  });

  it('bumps the version and forces re-approval when reopening a published report (rule 6)', () => {
    const p = transitionPatch(
      rep({ status: 'published', version: 2, internallyApprovedAt: NOW }),
      'in_progress',
      { actor: management, now: NOW },
    );
    expect(p.version).toBe(3);
    expect(p.hasUnpublishedChanges).toBe(true);
    expect(p.internallyApprovedAt).toBeUndefined();
  });

  it('does not bump the version when moving between draft states', () => {
    const p = transitionPatch(rep({ status: 'draft', version: 1 }), 'in_progress', { actor: author, now: NOW });
    expect(p.version).toBeUndefined();
  });
});

describe('editing and deletion', () => {
  it('allows content edits only in editable statuses', () => {
    for (const s of ['draft', 'in_progress', 'changes_requested'] as ReportStatus[]) {
      expect(EDITABLE_STATUSES.has(s)).toBe(true);
      expect(canEditContent(rep({ status: s }), author)).toBe(true);
    }
    expect(canEditContent(rep({ status: 'published' }), author)).toBe(false);
    expect(canEditContent(rep({ status: 'draft' }), client as any)).toBe(false);
  });

  it('refuses hard delete for published or legally held reports (rule 8)', () => {
    const deleter = { ...management, canDelete: true };
    expect(canHardDelete(rep({ status: 'draft' }), deleter)).toBe(true);
    expect(canHardDelete(rep({ status: 'draft', legalHold: true }), deleter)).toBe(false);
    expect(canHardDelete(rep({ status: 'published', publishedAt: NOW }), deleter)).toBe(false);
    expect(canHardDelete(rep({ status: 'draft' }), { kind: 'staff', userId: 'x' })).toBe(false);
  });

  it('refuses to cancel a legally held report', () => {
    expect(canTransition(rep({ status: 'draft', legalHold: true }), 'cancelled', { actor: management }).ok).toBe(false);
  });
});

describe('system actor', () => {
  it('may publish on a schedule but not approve', () => {
    const system = { kind: 'system' as const };
    expect(canTransition(rep({ status: 'internally_approved' }), 'published', { actor: system }).ok).toBe(true);
    expect(canTransition(rep({ status: 'submitted' }), 'internally_approved', { actor: system }).ok).toBe(false);
  });
});

describe('helpers', () => {
  it('classifies client-facing kinds', () => {
    expect(isClientFacingKind('client-monthly')).toBe(true);
    expect(isClientFacingKind('qbr')).toBe(true);
    expect(isClientFacingKind('weekly-staff')).toBe(false);
    expect(isClientFacingKind('client-risk')).toBe(false);
  });

  it('exposes the published statuses used by the portal query', () => {
    expect(PUBLISHED_STATUSES.has('published')).toBe(true);
    expect(PUBLISHED_STATUSES.has('acknowledged')).toBe(true);
    expect(PUBLISHED_STATUSES.has('internally_approved')).toBe(false);
  });

  it('suggests the next action per role', () => {
    expect(nextStaffAction(rep({ status: 'draft' }), author)?.to).toBe('submitted');
    expect(nextStaffAction(rep({ status: 'submitted' }), approver)?.to).toBe('internally_approved');
    expect(nextStaffAction(rep({ status: 'internally_approved' }), approver)?.to).toBe('published');
    expect(nextStaffAction(rep({ status: 'archived' }), author)).toBeNull();
  });
});

/**
 * The reporting UI splits on audience before anything else. The tab filter and the
 * row badge MUST read from this one function — otherwise a report can sit under
 * "Brenda agjencisë" while wearing a "KLIENTI" badge, which is precisely the
 * confusion the unification was meant to remove.
 */
describe('audience axis', () => {
  it('puts every client deliverable on the client side', () => {
    for (const kind of ['client-monthly', 'qbr', 'project-status',
      'project-completion', 'campaign-completion', 'website-launch'] as const) {
      expect(sideOfKind(kind), kind).toBe('client');
    }
  });

  it('keeps staff and management instruments internal', () => {
    for (const kind of ['weekly-staff', 'client-risk', 'custom'] as const) {
      expect(sideOfKind(kind), kind).toBe('internal');
    }
  });

  it('agrees with isClientFacingKind for every kind', () => {
    const kinds = ['weekly-staff', 'project-status', 'client-monthly', 'qbr',
      'project-completion', 'campaign-completion', 'website-launch', 'incident',
      'client-risk', 'custom'] as const;
    for (const kind of kinds) {
      expect(sideOfKind(kind) === 'client', kind).toBe(isClientFacingKind(kind));
    }
  });

  it('never leaves a side unlabelled', () => {
    for (const side of ['internal', 'client'] as const) {
      expect(SIDE_META[side].label.length).toBeGreaterThan(0);
      expect(SIDE_META[side].short.length).toBeGreaterThan(0);
      expect(SIDE_META[side].hint.length).toBeGreaterThan(0);
    }
  });

  it('states plainly that internal never reaches the client', () => {
    expect(SIDE_META.internal.hint).toContain('Nuk shkon kurrë tek klienti');
  });
});
