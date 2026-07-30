import { describe, expect, it } from 'vitest';
import {
  TEMPLATE_SEEDS,
  TEMPLATE_SEED_BY_KEY,
  duplicateTemplate,
  expandBlocks,
  instantiateTemplate,
  pickTemplate,
  templateFromSeed,
} from './templates';
import { CLIENT_VISIBILITIES } from './visibility';
import { BLOCK_DEF_BY_TYPE, validateBlocks } from './blocks';
import { buildPeriod } from './period';
import type { ReportTemplate } from '../../types';

describe('seeded library', () => {
  it('ships the default templates the agency needs', () => {
    for (const key of [
      'weekly-employee', 'weekly-project-status', 'weekly-client-update',
      'monthly-seo', 'monthly-social', 'monthly-ads', 'monthly-maintenance',
      'monthly-full-service', 'qbr', 'project-completion', 'website-launch',
      'campaign-completion', 'incident', 'client-risk', 'daily-employee',
    ]) {
      expect(TEMPLATE_SEED_BY_KEY[key], key).toBeDefined();
    }
  });

  it('has unique keys', () => {
    const keys = TEMPLATE_SEEDS.map(t => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only uses block types the registry knows', () => {
    for (const seed of TEMPLATE_SEEDS) {
      for (const spec of seed.blocks) {
        expect(BLOCK_DEF_BY_TYPE[spec.type], `${seed.key}/${spec.type}`).toBeDefined();
      }
    }
  });

  it('produces structurally valid blocks', () => {
    for (const seed of TEMPLATE_SEEDS) {
      const issues = validateBlocks(expandBlocks(seed.blocks)).filter(i => i.severity === 'error');
      expect(issues, `${seed.key}: ${JSON.stringify(issues)}`).toEqual([]);
    }
  });

  it('keeps the internal-only templates entirely internal', () => {
    for (const key of ['client-risk', 'weekly-employee', 'daily-employee']) {
      const blocks = expandBlocks(TEMPLATE_SEED_BY_KEY[key].blocks);
      const leaky = blocks.filter(b => CLIENT_VISIBILITIES.has(b.visibility));
      expect(leaky.map(b => b.title), key).toEqual([]);
    }
  });

  it('keeps margin and internal-notes blocks off the client side in client templates', () => {
    for (const key of ['monthly-seo', 'monthly-full-service', 'project-completion', 'weekly-project-status']) {
      const blocks = expandBlocks(TEMPLATE_SEED_BY_KEY[key].blocks);
      const confidential = blocks.filter(b => /brendshme|Ekonomia|ekonomik|Vlerësim i brendshëm/i.test(b.title || ''));
      expect(confidential.length, key).toBeGreaterThan(0);
      for (const b of confidential) {
        expect(CLIENT_VISIBILITIES.has(b.visibility), `${key}/${b.title}`).toBe(false);
      }
    }
  });

  it('gives every client-facing template a client-visible executive summary', () => {
    for (const key of ['monthly-seo', 'monthly-social', 'monthly-ads', 'monthly-full-service', 'qbr']) {
      const blocks = expandBlocks(TEMPLATE_SEED_BY_KEY[key].blocks);
      const summary = blocks.find(b => b.type === 'executive-summary');
      expect(summary, key).toBeDefined();
      expect(summary!.visibility, key).toBe('client');
      expect(summary!.required, key).toBe(true);
    }
  });

  it('defaults an unspecified block to internal, never to client', () => {
    const blocks = expandBlocks([{ type: 'rich-text', title: 'Pa caktuar' }]);
    expect(blocks[0].visibility).toBe('internal');
  });
});

describe('expandBlocks', () => {
  it('numbers blocks sequentially and gives them unique ids', () => {
    const blocks = expandBlocks(TEMPLATE_SEED_BY_KEY['monthly-seo'].blocks);
    expect(blocks.map(b => b.order)).toEqual(blocks.map((_, i) => i));
    expect(new Set(blocks.map(b => b.id)).size).toBe(blocks.length);
  });

  it('resolves KPI catalog keys through the resolver', () => {
    const blocks = expandBlocks(
      [{ type: 'kpi-cards', title: 'K', kpis: ['organic_users', 'unknown_metric'] }],
      key => (key === 'organic_users' ? 'kpi-doc-1' : undefined),
    );
    expect(blocks[0].kpiIds).toEqual(['kpi-doc-1']);
  });

  it('attaches table presets', () => {
    const blocks = expandBlocks([{ type: 'table', title: 'Fjalët', columns: 'keywords' }]);
    expect(blocks[0].columns?.map(c => c.key)).toContain('keyword');
    expect(blocks[0].rows).toEqual([]);
  });
});

describe('templateFromSeed', () => {
  it('produces a version-1 system template', () => {
    const t = templateFromSeed(TEMPLATE_SEED_BY_KEY['monthly-seo']);
    expect(t.version).toBe(1);
    expect(t.isSystem).toBe(true);
    expect(t.blocks.length).toBeGreaterThan(10);
  });
});

describe('instantiateTemplate — rule 11/15 (history never rewrites)', () => {
  const template: ReportTemplate = {
    id: 'tmpl1',
    businessId: 'biz1',
    key: 'monthly-seo',
    name: 'Raport mujor SEO',
    kind: 'client-monthly',
    frequency: 'monthly',
    service: 'seo',
    version: 4,
    blocks: expandBlocks(TEMPLATE_SEED_BY_KEY['monthly-seo'].blocks),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const period = buildPeriod('monthly', '2026-07-15');

  it('stamps the template key AND version onto the report', () => {
    const r = instantiateTemplate(template, {
      businessId: 'biz1', authorUserId: 'u1', period,
    });
    expect(r.templateId).toBe('tmpl1');
    expect(r.templateKey).toBe('monthly-seo');
    expect(r.templateVersion).toBe(4);
  });

  it('deep-copies nested payloads so editing the report cannot mutate the template', () => {
    const r = instantiateTemplate(template, { businessId: 'biz1', authorUserId: 'u1', period });
    const reportTable = r.blocks.find(b => b.type === 'table')!;
    const templateTable = template.blocks.find(b => b.type === 'table')!;

    reportTable.rows!.push({ keyword: 'test' });
    reportTable.columns![0].label = 'MUTUAR';

    expect(templateTable.rows).toEqual([]);
    expect(templateTable.columns![0].label).not.toBe('MUTUAR');
  });

  it('starts as a draft at version 1', () => {
    const r = instantiateTemplate(template, { businessId: 'biz1', authorUserId: 'u1', period });
    expect(r.status).toBe('draft');
    expect(r.version).toBe(1);
    expect(r.viewCount).toBe(0);
    expect(r.deletedAt).toBeNull();
  });

  it('builds a title from the subject and the period', () => {
    const r = instantiateTemplate(template, {
      businessId: 'biz1', authorUserId: 'u1', period, customerName: 'Klienti X',
    });
    expect(r.title).toBe('Raport mujor SEO — Klienti X · Korrik 2026');
  });

  it('honours an explicit title', () => {
    const r = instantiateTemplate(template, {
      businessId: 'biz1', authorUserId: 'u1', period, title: 'Titull i vetë',
    });
    expect(r.title).toBe('Titull i vetë');
  });

  it('carries the idempotency key through', () => {
    const r = instantiateTemplate(template, {
      businessId: 'biz1', authorUserId: 'u1', period,
      scheduleId: 'sch1', generationKey: 'sch1:2026-07',
    });
    expect(r.generationKey).toBe('sch1:2026-07');
    expect(r.scheduleId).toBe('sch1');
  });

  it('preserves the template visibility of every block', () => {
    const r = instantiateTemplate(template, { businessId: 'biz1', authorUserId: 'u1', period });
    const marginBlock = r.blocks.find(b => /Ekonomia/i.test(b.title || ''));
    expect(marginBlock?.visibility).toBe('management');
  });

  it('gives each report its own block ids', () => {
    const a = instantiateTemplate(template, { businessId: 'biz1', authorUserId: 'u1', period });
    expect(new Set(a.blocks.map(b => b.id)).size).toBe(a.blocks.length);
  });
});

describe('pickTemplate', () => {
  const t = (over: Partial<ReportTemplate>): ReportTemplate => ({
    id: over.id || 'x',
    businessId: 'biz1',
    key: over.key || 'k',
    name: over.name || 'T',
    kind: over.kind || 'client-monthly',
    frequency: over.frequency || 'monthly',
    version: 1,
    blocks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  it('prefers a customer-assigned template', () => {
    const picked = pickTemplate(
      [t({ id: 'generic', isDefault: true }), t({ id: 'forClient', appliesToCustomerIds: ['c1'] })],
      { kind: 'client-monthly', customerId: 'c1' },
    );
    expect(picked?.id).toBe('forClient');
  });

  it('prefers a matching service over a plain default', () => {
    const picked = pickTemplate(
      [t({ id: 'default', isDefault: true }), t({ id: 'seo', service: 'seo' })],
      { kind: 'client-monthly', service: 'seo' },
    );
    expect(picked?.id).toBe('seo');
  });

  it('never returns a template of the wrong kind', () => {
    expect(pickTemplate([t({ kind: 'qbr' })], { kind: 'client-monthly' })).toBeUndefined();
  });

  it('ignores archived templates', () => {
    expect(pickTemplate([t({ archivedAt: new Date() })], { kind: 'client-monthly' })).toBeUndefined();
  });
});

describe('duplicateTemplate', () => {
  it('creates an editable copy that is not a system template', () => {
    const source = templateFromSeed(TEMPLATE_SEED_BY_KEY.qbr) as unknown as ReportTemplate;
    const copy = duplicateTemplate({ ...source, id: 't1', businessId: 'biz1' } as ReportTemplate, 'QBR i ynë');
    expect(copy.isSystem).toBe(false);
    expect(copy.isDefault).toBe(false);
    expect(copy.version).toBe(1);
    expect(copy.name).toBe('QBR i ynë');
    expect(copy.key).not.toBe(source.key);
    expect(copy.blocks.length).toBe(source.blocks.length);
  });
});
