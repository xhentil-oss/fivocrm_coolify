/**
 * Data-leakage tests. These are the ones that must never be allowed to go red:
 * every internal visibility level is checked against a client audience, so adding
 * a new level without teaching the redactor about it fails here.
 */
import { describe, expect, it } from 'vitest';
import {
  CLIENT_VISIBILITIES,
  VISIBILITY_OPTIONS,
  assertNoClientLeak,
  clientAudience,
  countByAudience,
  findClientLeaks,
  hasClientContent,
  isBlockVisibleTo,
  isCommentVisibleTo,
  isKpiValueVisibleTo,
  redactForAudience,
  redactForClient,
} from './visibility';
import type {
  Report,
  ReportBlock,
  ReportComment,
  ReportKpiValue,
  ReportVisibility,
} from '../../types';

const block = (over: Partial<ReportBlock> = {}): ReportBlock => ({
  id: over.id || 'b1',
  type: over.type || 'rich-text',
  order: over.order ?? 0,
  visibility: over.visibility || 'internal',
  ...over,
});

const report = (blocks: ReportBlock[], over: Partial<Report> = {}): Report => ({
  id: 'r1',
  businessId: 'biz1',
  kind: 'client-monthly',
  title: 'Raport',
  status: 'published',
  period: { frequency: 'monthly', key: '2026-07', start: '2026-07-01', end: '2026-07-31' },
  authorUserId: 'u1',
  blocks,
  version: 1,
  createdAt: new Date('2026-08-01'),
  updatedAt: new Date('2026-08-01'),
  ...over,
});

const ALL_VISIBILITIES: ReportVisibility[] = VISIBILITY_OPTIONS.map(o => o.value);

describe('CLIENT_VISIBILITIES is a closed allow-list', () => {
  it('contains exactly the two client levels', () => {
    expect([...CLIENT_VISIBILITIES].sort()).toEqual(['client', 'client_contacts']);
  });

  it('covers every visibility value in the editor options', () => {
    // If someone adds a ReportVisibility without adding an option, the editor can't
    // set it — this keeps the union and the UI in lockstep.
    expect(ALL_VISIBILITIES.length).toBe(10);
  });
});

describe('isBlockVisibleTo — client audience', () => {
  const client = clientAudience('cust1');

  it.each(ALL_VISIBILITIES.filter(v => !CLIENT_VISIBILITIES.has(v)))(
    'hides "%s" blocks from a client',
    (visibility) => {
      expect(isBlockVisibleTo(block({ visibility }), client)).toBe(false);
    },
  );

  it('shows client blocks', () => {
    expect(isBlockVisibleTo(block({ visibility: 'client' }), client)).toBe(true);
  });

  it('respects inPortal=false even for client blocks', () => {
    expect(isBlockVisibleTo(block({ visibility: 'client', inPortal: false }), client)).toBe(false);
  });

  it('restricts client_contacts to the listed contacts', () => {
    const b = block({ visibility: 'client_contacts', visibleContactIds: ['c-alpha'] });
    expect(isBlockVisibleTo(b, clientAudience('cust1', 'c-alpha'))).toBe(true);
    expect(isBlockVisibleTo(b, clientAudience('cust1', 'c-beta'))).toBe(false);
    expect(isBlockVisibleTo(b, clientAudience('cust1'))).toBe(false);
  });

  it('treats an empty contact list as "all contacts of this client"', () => {
    const b = block({ visibility: 'client_contacts', visibleContactIds: [] });
    expect(isBlockVisibleTo(b, clientAudience('cust1', 'anyone'))).toBe(true);
  });

  it('treats a public link exactly like a client', () => {
    const link = { kind: 'link' as const };
    expect(isBlockVisibleTo(block({ visibility: 'management' }), link)).toBe(false);
    expect(isBlockVisibleTo(block({ visibility: 'client' }), link)).toBe(true);
  });
});

describe('isBlockVisibleTo — staff audience', () => {
  it('shows internal blocks to any staff member', () => {
    expect(isBlockVisibleTo(block({ visibility: 'internal' }), { kind: 'staff', userId: 'u9' })).toBe(true);
  });

  it('hides author-private blocks from other staff', () => {
    const b = block({ visibility: 'author' });
    expect(isBlockVisibleTo(b, { kind: 'staff', userId: 'u9' })).toBe(false);
    expect(isBlockVisibleTo(b, { kind: 'staff', userId: 'u1', isAuthor: true })).toBe(true);
  });

  it('requires the confidential permission for management blocks', () => {
    const b = block({ visibility: 'management' });
    expect(isBlockVisibleTo(b, { kind: 'staff', isManagement: true })).toBe(true);
    // An admin whose role template withholds "view confidential sections".
    expect(isBlockVisibleTo(b, { kind: 'staff', isManagement: true, canViewConfidential: false })).toBe(false);
    expect(isBlockVisibleTo(b, { kind: 'staff', isManagement: false })).toBe(false);
  });

  it('matches custom_roles against the reader roles', () => {
    const b = block({ visibility: 'custom_roles', visibleRoles: ['Sales'] });
    expect(isBlockVisibleTo(b, { kind: 'staff', roles: ['Sales'] })).toBe(true);
    expect(isBlockVisibleTo(b, { kind: 'staff', roles: ['Member'] })).toBe(false);
    expect(isBlockVisibleTo(b, { kind: 'staff', roles: ['Member'], isManagement: true })).toBe(true);
  });

  it('gates account_manager blocks on the relationship', () => {
    const b = block({ visibility: 'account_manager' });
    expect(isBlockVisibleTo(b, { kind: 'staff', isAccountManager: true })).toBe(true);
    expect(isBlockVisibleTo(b, { kind: 'staff' })).toBe(false);
  });

  it('shows client-facing blocks to staff too', () => {
    expect(isBlockVisibleTo(block({ visibility: 'client' }), { kind: 'staff' })).toBe(true);
  });
});

describe('redactForClient', () => {
  const mixed = report([
    block({ id: 'summary', visibility: 'client', order: 0, text: 'Rezultate' }),
    block({ id: 'margin', visibility: 'management', order: 1, text: 'Marzhi 12%' }),
    block({ id: 'blockers', visibility: 'internal', order: 2, text: 'Ekipi u vonua' }),
    block({ id: 'next', visibility: 'client', order: 3, text: 'Hapat' }),
    block({ id: 'private', visibility: 'author', order: 4, text: 'Shënim personal' }),
  ], {
    healthOverrideReason: 'Menaxheri e uli në të verdhë',
    qualityScore: 71,
    suggestedHealth: 'red',
    subjectUserId: 'u5',
    kpiValues: [
      { kpiId: 'organic_users', label: 'Vizitorë', unit: 'number', value: 100, clientVisible: true },
      { kpiId: 'gross_margin', label: 'Marzhi', unit: 'percent', value: 12, clientVisible: false, financial: true },
    ] as ReportKpiValue[],
  });

  it('keeps only client blocks', () => {
    const out = redactForClient(mixed, 'cust1');
    expect(out.blocks.map(b => b.id)).toEqual(['summary', 'next']);
  });

  it('renumbers order with no gaps', () => {
    const out = redactForClient(mixed, 'cust1');
    expect(out.blocks.map(b => b.order)).toEqual([0, 1]);
  });

  it('drops non-client KPI values', () => {
    const out = redactForClient(mixed, 'cust1');
    expect(out.kpiValues?.map(k => k.kpiId)).toEqual(['organic_users']);
  });

  it('strips internal report metadata', () => {
    const out = redactForClient(mixed, 'cust1') as any;
    expect(out.healthOverrideReason).toBeUndefined();
    expect(out.qualityScore).toBeUndefined();
    expect(out.suggestedHealth).toBeUndefined();
    expect(out.subjectUserId).toBeUndefined();
  });

  it('does not mutate the input report', () => {
    const before = JSON.stringify(mixed);
    redactForClient(mixed, 'cust1');
    expect(JSON.stringify(mixed)).toBe(before);
  });

  it('produces a payload that passes the leak assertion', () => {
    expect(() => assertNoClientLeak(redactForClient(mixed, 'cust1'))).not.toThrow();
    expect(findClientLeaks(redactForClient(mixed, 'cust1'))).toEqual([]);
  });

  it('flags the raw report as leaky', () => {
    expect(findClientLeaks(mixed).length).toBeGreaterThan(0);
    expect(() => assertNoClientLeak(mixed)).toThrow(/brendshme/);
  });
});

describe('redactForClient — attachments and AI', () => {
  it('strips confidential attachments from a client-visible block', () => {
    const r = report([block({
      id: 'files',
      visibility: 'client',
      type: 'attachment',
      attachments: [
        { id: 'a1', name: 'raport.pdf', url: 'https://x/1', visibility: 'client' },
        { id: 'a2', name: 'kostot.xlsx', url: 'https://x/2', visibility: 'management' },
      ],
    })]);
    const out = redactForClient(r, 'cust1');
    expect(out.blocks[0].attachments?.map(a => a.id)).toEqual(['a1']);
  });

  it('drops unapproved AI content by default', () => {
    const r = report([
      block({ id: 'ai', visibility: 'client', aiSuggested: true, text: 'Draft AI' }),
      block({ id: 'ok', visibility: 'client', aiSuggested: true, aiApprovedByUserId: 'u1', text: 'Aprovuar' }),
    ]);
    expect(redactForClient(r, 'cust1').blocks.map(b => b.id)).toEqual(['ok']);
  });

  it('never sends custom-html to a client, even if marked client-visible', () => {
    const r = report([block({ id: 'html', type: 'custom-html', visibility: 'client', html: '<b>x</b>' })]);
    expect(redactForClient(r, 'cust1').blocks).toEqual([]);
  });
});

describe('redactForAudience — pdf target', () => {
  it('drops blocks excluded from the PDF', () => {
    const r = report([
      block({ id: 'screen-only', visibility: 'client', inPdf: false }),
      block({ id: 'both', visibility: 'client', order: 1 }),
    ]);
    const out = redactForAudience(r, clientAudience('cust1'), { target: 'pdf' });
    expect(out.blocks.map(b => b.id)).toEqual(['both']);
  });
});

describe('comments', () => {
  const comment = (over: Partial<ReportComment> = {}): ReportComment => ({
    id: 'c1',
    businessId: 'biz1',
    reportId: 'r1',
    body: 'test',
    internal: true,
    authorUserId: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  it('hides internal comments from clients', () => {
    expect(isCommentVisibleTo(comment({ internal: true }), clientAudience('cust1'))).toBe(false);
    expect(isCommentVisibleTo(comment({ internal: false }), clientAudience('cust1'))).toBe(true);
  });

  it('shows every comment to staff', () => {
    expect(isCommentVisibleTo(comment({ internal: true }), { kind: 'staff' })).toBe(true);
  });
});

describe('kpi value visibility', () => {
  const kpi = (over: Partial<ReportKpiValue>): ReportKpiValue =>
    ({ kpiId: 'k', label: 'K', unit: 'number', value: 1, ...over });

  it('requires clientVisible for clients', () => {
    expect(isKpiValueVisibleTo(kpi({ clientVisible: true }), clientAudience('c'))).toBe(true);
    expect(isKpiValueVisibleTo(kpi({ clientVisible: false }), clientAudience('c'))).toBe(false);
    expect(isKpiValueVisibleTo(kpi({}), clientAudience('c'))).toBe(false);
  });

  it('hides financial KPIs from staff without the permission', () => {
    const financial = kpi({ financial: true });
    expect(isKpiValueVisibleTo(financial, { kind: 'staff', canViewFinancial: false })).toBe(false);
    expect(isKpiValueVisibleTo(financial, { kind: 'staff', canViewFinancial: true })).toBe(true);
  });
});

describe('helpers', () => {
  it('hasClientContent detects publishable content', () => {
    expect(hasClientContent(report([block({ visibility: 'internal' })]))).toBe(false);
    expect(hasClientContent(report([block({ visibility: 'client' })]))).toBe(true);
    expect(hasClientContent(report([block({ visibility: 'client', inPortal: false })]))).toBe(false);
  });

  it('countByAudience splits the two sides', () => {
    const r = report([
      block({ id: '1', visibility: 'client' }),
      block({ id: '2', visibility: 'internal' }),
      block({ id: '3', visibility: 'management' }),
    ]);
    expect(countByAudience(r)).toEqual({ internal: 2, client: 1 });
  });
});
