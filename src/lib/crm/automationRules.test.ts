/**
 * @vitest-environment node
 *
 * Node, not jsdom: the drift guard reads `api/_crmAutomationEngine.ts` off disk.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AUTOMATION_RECIPES,
  BLOCK_LABELS,
  MS_PER_DAY,
  MS_PER_HOUR,
  buildRunsIndex,
  conditionHolds,
  customerFacts,
  describeRule,
  evaluateEntity,
  evaluateRule,
  leadFacts,
  overdueInvoiceFact,
  pickRoundRobin,
  recipeToDraft,
  renderAutomationText,
  runDocId,
  toMs,
  validateRule,
  type AutomationRule,
  type EntityFacts,
} from './automationRules';

const NOW = new Date('2026-09-07T10:00:00Z').getTime();
const daysAgo = (d: number) => new Date(NOW - d * MS_PER_DAY);
const hoursAgo = (h: number) => new Date(NOW - h * MS_PER_HOUR);

const rule = (over: Partial<AutomationRule> = {}): AutomationRule => ({
  id: 'r1',
  businessId: 'biz',
  name: 'Test',
  entity: 'lead',
  status: 'active',
  trigger: { kind: 'lead_created' },
  conditions: [],
  actions: [{ type: 'notify', to: 'owner', title: 'x' }],
  enrollExisting: true,
  createdAt: daysAgo(30),
  updatedAt: daysAgo(30),
  createdByUserId: 'u',
  ...over,
});

const lead = (id: string, over: Record<string, unknown> = {}): EntityFacts =>
  leadFacts(id, { name: `Lead ${id}`, status: 'New', createdAt: daysAgo(1), updatedAt: daysAgo(1), ...over }, NOW);

// ── Drift guard ────────────────────────────────────────────────────────────────

describe('api mirror', () => {
  it('api/_crmAutomationEngine.ts is byte-identical to the canonical engine', () => {
    const root = resolve(__dirname, '../../..');
    const canonical = readFileSync(resolve(root, 'src/lib/crm/automationRules.ts'), 'utf8');
    const mirror = readFileSync(resolve(root, 'api/_crmAutomationEngine.ts'), 'utf8');
    expect(mirror).toBe(canonical);
  });
});

// ── Facts ──────────────────────────────────────────────────────────────────────

describe('facts', () => {
  it('normalises Date / Timestamp-like / ISO / epoch', () => {
    expect(toMs(new Date(NOW))).toBe(NOW);
    expect(toMs({ toDate: () => new Date(NOW) })).toBe(NOW);
    expect(toMs({ seconds: NOW / 1000 })).toBe(NOW);
    expect(toMs(new Date(NOW).toISOString())).toBe(NOW);
    expect(toMs(NOW)).toBe(NOW);
    expect(toMs('garbage')).toBeNull();
    expect(toMs(undefined)).toBeNull();
  });

  it('lead facts: last activity is the newest of the three stamps, tags are lower-cased', () => {
    const f = lead('a', { lastActivityAt: daysAgo(10), lastFollowUpDate: daysAgo(3), updatedAt: daysAgo(20), tags: ['SEO', ' Ads '] });
    expect(f.lastActivityMs).toBe(daysAgo(3).getTime());
    expect(f.tags).toEqual(['seo', 'ads']);
    expect(f.phone).toBeUndefined();
  });

  it('lead facts: phoneNumber wins over phone, stored score wins over the computed one', () => {
    const f = lead('a', { phoneNumber: '069', phone: '068', score: 88 });
    expect(f.phone).toBe('069');
    expect(f.score).toBe(88);
    expect(lead('b', { email: 'x@y.z', company: 'C' }).score).toBe(10 + 15 + 15);
  });

  it('customer facts merge the caller context into last activity and carry the overdue invoices', () => {
    const inv = overdueInvoiceFact('i1', { status: 'Pending', dueDate: daysAgo(20), total: 500, currency: 'EUR', invoiceNumber: 'F-1' }, NOW)!;
    const f = customerFacts('c', { name: 'ACME', updatedAt: daysAgo(90) }, { lastActivityMs: daysAgo(5).getTime(), overdueInvoices: [inv] }, NOW);
    expect(f.lastActivityMs).toBe(daysAgo(5).getTime());
    expect(f.overdueInvoices[0]).toMatchObject({ id: 'i1', daysOverdue: 20, amount: 500, number: 'F-1' });
  });

  it('an invoice is overdue only when unpaid AND past due', () => {
    expect(overdueInvoiceFact('a', { status: 'Paid', dueDate: daysAgo(20) }, NOW)).toBeNull();
    expect(overdueInvoiceFact('b', { status: 'Pending', dueDate: daysAgo(-2) }, NOW)).toBeNull();
    expect(overdueInvoiceFact('c', { status: 'Cancelled', dueDate: daysAgo(20) }, NOW)).toBeNull();
    expect(overdueInvoiceFact('d', { status: 'Overdue', dueDate: daysAgo(3) }, NOW)?.daysOverdue).toBe(3);
  });
});

// ── Conditions ─────────────────────────────────────────────────────────────────

describe('conditions', () => {
  const f = lead('a', { status: 'Proposal', source: 'Landing', tags: ['seo', 'ads'], estimatedValue: 8000, assignedToUserId: 'u1', email: 'a@b.c' });

  it('list operators are case-insensitive', () => {
    expect(conditionHolds({ field: 'status', op: 'in', values: ['proposal'] }, f, NOW)).toBe(true);
    expect(conditionHolds({ field: 'status', op: 'not_in', values: ['Proposal'] }, f, NOW)).toBe(false);
    expect(conditionHolds({ field: 'source', op: 'in', values: ['landing', 'whmcs'] }, f, NOW)).toBe(true);
  });

  it('tags: any / all / none', () => {
    expect(conditionHolds({ field: 'tags', op: 'any', values: ['ADS'] }, f, NOW)).toBe(true);
    expect(conditionHolds({ field: 'tags', op: 'all', values: ['seo', 'ads'] }, f, NOW)).toBe(true);
    expect(conditionHolds({ field: 'tags', op: 'all', values: ['seo', 'social'] }, f, NOW)).toBe(false);
    expect(conditionHolds({ field: 'tags', op: 'none', values: ['social'] }, f, NOW)).toBe(true);
  });

  it('numbers and booleans', () => {
    expect(conditionHolds({ field: 'estimatedValue', op: 'gte', value: 5000 }, f, NOW)).toBe(true);
    expect(conditionHolds({ field: 'estimatedValue', op: 'lte', value: 5000 }, f, NOW)).toBe(false);
    expect(conditionHolds({ field: 'assigned', op: 'is', value: true }, f, NOW)).toBe(true);
    expect(conditionHolds({ field: 'assigned', op: 'is', value: false }, lead('b'), NOW)).toBe(true);
    expect(conditionHolds({ field: 'hasEmail', op: 'is', value: true }, f, NOW)).toBe(true);
    expect(conditionHolds({ field: 'hasPhone', op: 'is', value: true }, f, NOW)).toBe(false);
    expect(conditionHolds({ field: 'daysSinceCreated', op: 'gte', value: 1 }, f, NOW)).toBe(true);
  });

  it('a record with no activity at all counts as infinitely inactive', () => {
    const g = leadFacts('g', { name: 'g' }, NOW);
    expect(conditionHolds({ field: 'daysSinceActivity', op: 'gte', value: 365 }, g, NOW)).toBe(true);
    expect(conditionHolds({ field: 'daysSinceActivity', op: 'lte', value: 365 }, g, NOW)).toBe(false);
  });

  it('a missing numeric value never matches', () => {
    expect(conditionHolds({ field: 'estimatedValue', op: 'gte' }, f, NOW)).toBe(false);
  });
});

// ── Triggers + idempotency ─────────────────────────────────────────────────────

describe('evaluateEntity', () => {
  it('lead_created fires once and then reports already-fired', () => {
    const r = rule();
    const f = lead('a');
    expect(evaluateEntity(r, f, { ruleCreatedAtMs: null }, NOW).fires.map(o => o.key)).toEqual(['created']);
    const runs = buildRunsIndex([{ entityId: 'a', fireKey: 'created', firedAt: daysAgo(1) }]);
    expect(evaluateEntity(r, f, { ruleCreatedAtMs: null, runs }, NOW).blocked).toBe('already-fired');
  });

  it('a closed lead never fires a non-stage trigger', () => {
    const r = rule();
    expect(evaluateEntity(r, lead('a', { status: 'Lost' }), { ruleCreatedAtMs: null }, NOW).blocked).toBe('terminal-status');
    expect(evaluateEntity(r, lead('a', { status: 'Converted' }), { ruleCreatedAtMs: null }, NOW).blocked).toBe('terminal-status');
  });

  it('lead_stage fires on the chosen stage — including Lost, the win-back case', () => {
    const r = rule({ trigger: { kind: 'lead_stage', status: 'Lost' } });
    expect(evaluateEntity(r, lead('a', { status: 'Lost' }), { ruleCreatedAtMs: null }, NOW).fires[0].key).toBe('stage:Lost');
    expect(evaluateEntity(r, lead('a', { status: 'New' }), { ruleCreatedAtMs: null }, NOW).blocked).toBe('not-due');
  });

  it('enrollExisting=false protects the past: creation for created-triggers, last change for stage', () => {
    const created = rule({ enrollExisting: false });
    const ruleAt = daysAgo(2).getTime();
    expect(evaluateEntity(created, lead('old', { createdAt: daysAgo(5) }), { ruleCreatedAtMs: ruleAt }, NOW).blocked).toBe('predates-rule');
    expect(evaluateEntity(created, lead('new', { createdAt: daysAgo(1) }), { ruleCreatedAtMs: ruleAt }, NOW).blocked).toBeNull();

    const stage = rule({ enrollExisting: false, trigger: { kind: 'lead_stage', status: 'Proposal' } });
    expect(evaluateEntity(stage, lead('a', { status: 'Proposal', updatedAt: daysAgo(5) }), { ruleCreatedAtMs: ruleAt }, NOW).blocked).toBe('predates-rule');
    expect(evaluateEntity(stage, lead('b', { status: 'Proposal', updatedAt: daysAgo(1) }), { ruleCreatedAtMs: ruleAt }, NOW).blocked).toBeNull();
  });

  it('enrollExisting=true wakes up existing records', () => {
    expect(evaluateEntity(rule({ enrollExisting: true }), lead('old', { createdAt: daysAgo(400) }), { ruleCreatedAtMs: daysAgo(2).getTime() }, NOW).blocked).toBeNull();
  });

  it('a stage rule fires once per lead per stage (re-entering the same stage does not re-fire; a different stage rule does)', () => {
    const r = rule({ trigger: { kind: 'lead_stage', status: 'Proposal' } });
    const runs = buildRunsIndex([{ entityId: 'a', fireKey: 'stage:Proposal', firedAt: daysAgo(3) }]);
    expect(evaluateEntity(r, lead('a', { status: 'Proposal' }), { ruleCreatedAtMs: null, runs }, NOW).blocked).toBe('already-fired');
    // Different stage under a different rule → different key → fires.
    const r2 = rule({ id: 'r2', trigger: { kind: 'lead_stage', status: 'Qualified' } });
    expect(evaluateEntity(r2, lead('a', { status: 'Qualified' }), { ruleCreatedAtMs: null, runs }, NOW).blocked).toBeNull();
  });

  it('lead_inactive: the window is the cooldown by default', () => {
    const r = rule({ trigger: { kind: 'lead_inactive', days: 14 } });
    const f = lead('a', { updatedAt: daysAgo(20), lastActivityAt: daysAgo(20) });
    const first = evaluateEntity(r, f, { ruleCreatedAtMs: null }, NOW);
    expect(first.fires[0].key).toMatch(/^inactive:/);
    expect(first.fires[0].days).toBe(20);
    // Fired 5 days ago → still cooling down (14-day window).
    const runs = buildRunsIndex([{ entityId: 'a', fireKey: 'inactive:1', firedAt: daysAgo(5) }]);
    expect(evaluateEntity(r, f, { ruleCreatedAtMs: null, runs }, NOW).blocked).toBe('cooldown');
    // Fired 15 days ago → fires again.
    const older = buildRunsIndex([{ entityId: 'a', fireKey: 'inactive:1', firedAt: daysAgo(15) }]);
    expect(evaluateEntity(r, f, { ruleCreatedAtMs: null, runs: older }, NOW).blocked).toBeNull();
    // An explicit cooldown overrides the window.
    const short = rule({ trigger: { kind: 'lead_inactive', days: 14 }, cooldownDays: 3 });
    expect(evaluateEntity(short, f, { ruleCreatedAtMs: null, runs }, NOW).blocked).toBeNull();
  });

  it('lead_inactive: a fresh lead is not due', () => {
    const r = rule({ trigger: { kind: 'lead_inactive', days: 14 } });
    expect(evaluateEntity(r, lead('a', { updatedAt: daysAgo(2) }), { ruleCreatedAtMs: null }, NOW).blocked).toBe('not-due');
  });

  it('lead_unassigned: hours since creation with no owner', () => {
    const r = rule({ trigger: { kind: 'lead_unassigned', hours: 2 } });
    expect(evaluateEntity(r, lead('a', { createdAt: hoursAgo(3) }), { ruleCreatedAtMs: null }, NOW).blocked).toBeNull();
    expect(evaluateEntity(r, lead('b', { createdAt: hoursAgo(1) }), { ruleCreatedAtMs: null }, NOW).blocked).toBe('not-due');
    expect(evaluateEntity(r, lead('c', { createdAt: hoursAgo(3), assignedToUserId: 'u' }), { ruleCreatedAtMs: null }, NOW).blocked).toBe('not-due');
  });

  it('lead_no_response: SLA fires once, never after a first response', () => {
    const r = rule({ trigger: { kind: 'lead_no_response', hours: 24 } });
    expect(evaluateEntity(r, lead('a', { createdAt: hoursAgo(30) }), { ruleCreatedAtMs: null }, NOW).fires[0].key).toBe('no-response');
    expect(evaluateEntity(r, lead('b', { createdAt: hoursAgo(30), firstResponseAt: hoursAgo(20) }), { ruleCreatedAtMs: null }, NOW).blocked).toBe('not-due');
    expect(evaluateEntity(r, lead('c', { createdAt: hoursAgo(10) }), { ruleCreatedAtMs: null }, NOW).blocked).toBe('not-due');
  });

  it('customer_invoice_overdue: one occurrence per qualifying invoice, keyed by invoice id', () => {
    const r = rule({ entity: 'customer', trigger: { kind: 'customer_invoice_overdue', days: 14 } });
    const invs = [
      overdueInvoiceFact('i1', { status: 'Pending', dueDate: daysAgo(20) }, NOW)!,
      overdueInvoiceFact('i2', { status: 'Overdue', dueDate: daysAgo(40) }, NOW)!,
      overdueInvoiceFact('i3', { status: 'Pending', dueDate: daysAgo(3) }, NOW)!,
    ];
    const f = customerFacts('c', { name: 'ACME' }, { overdueInvoices: invs }, NOW);
    const first = evaluateEntity(r, f, { ruleCreatedAtMs: null }, NOW);
    expect(first.fires.map(o => o.key)).toEqual(['invoice:i1', 'invoice:i2']);
    const runs = buildRunsIndex([{ entityId: 'c', fireKey: 'invoice:i1', firedAt: daysAgo(6) }]);
    expect(evaluateEntity(r, f, { ruleCreatedAtMs: null, runs }, NOW).fires.map(o => o.key)).toEqual(['invoice:i2']);
  });

  it('customer_created is retro-guarded like lead_created', () => {
    const r = rule({ entity: 'customer', trigger: { kind: 'customer_created' }, enrollExisting: false });
    const c = customerFacts('c', { name: 'ACME', createdAt: daysAgo(100) }, {}, NOW);
    expect(evaluateEntity(r, c, { ruleCreatedAtMs: daysAgo(1).getTime() }, NOW).blocked).toBe('predates-rule');
  });

  it('an entity of the wrong kind is ignored', () => {
    const r = rule({ entity: 'customer', trigger: { kind: 'customer_created' } });
    expect(evaluateEntity(r, lead('a'), { ruleCreatedAtMs: null }, NOW).fires).toEqual([]);
  });

  it('conditions are checked before idempotency and report the failing field', () => {
    const r = rule({ conditions: [{ field: 'estimatedValue', op: 'gte', value: 1000 }] });
    const res = evaluateEntity(r, lead('a', { estimatedValue: 10 }), { ruleCreatedAtMs: null }, NOW);
    expect(res.blocked).toBe('condition-failed');
    expect(res.failedField).toBe('estimatedValue');
  });
});

describe('evaluateRule (population)', () => {
  it('counts every non-firing under a named reason and caps the run', () => {
    const r = rule({ maxPerRun: 2, conditions: [{ field: 'hasEmail', op: 'is', value: true }] });
    const pop = [
      lead('a', { email: 'a@x.y' }),
      lead('b', { email: 'b@x.y' }),
      lead('c', { email: 'c@x.y' }),
      lead('d'),                                   // condition fails
      lead('e', { status: 'Lost', email: 'e@x' }), // terminal
      customerFacts('z', { name: 'z' }, {}, NOW),  // wrong entity → not considered
    ];
    const runs = buildRunsIndex([{ entityId: 'a', fireKey: 'created', firedAt: daysAgo(1) }]);
    const res = evaluateRule(r, pop, { ruleCreatedAtMs: null, runs }, NOW);
    expect(res.considered).toBe(5);
    expect(res.fires.map(f => f.facts.id)).toEqual(['b', 'c']);
    expect(res.blocked).toEqual({ 'already-fired': 1, 'condition-failed': 1, 'terminal-status': 1 });
    expect(res.failedConditions).toEqual({ hasEmail: 1 });
    // Only 2 could fire (cap) — a third eligible lead would have been counted under run-cap.
    const wide = rule({ maxPerRun: 1 });
    expect(evaluateRule(wide, [lead('a'), lead('b')], { ruleCreatedAtMs: null }, NOW).blocked).toEqual({ 'run-cap': 1 });
  });

  it('every block reason has a label', () => {
    for (const k of ['terminal-status', 'not-due', 'predates-rule', 'already-fired', 'cooldown', 'condition-failed', 'run-cap'] as const) {
      expect(BLOCK_LABELS[k]).toBeTruthy();
    }
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

describe('helpers', () => {
  it('round-robin cycles and survives an out-of-range cursor', () => {
    expect(pickRoundRobin(['a', 'b', 'c'], 0)).toEqual({ userId: 'a', nextCursor: 1 });
    expect(pickRoundRobin(['a', 'b', 'c'], 4)).toEqual({ userId: 'b', nextCursor: 5 });
    expect(pickRoundRobin(['a', 'b', 'c'], -1)).toEqual({ userId: 'c', nextCursor: 0 });
    expect(pickRoundRobin([], 3)).toEqual({ userId: null, nextCursor: 3 });
  });

  it('renders tokens, empties unknown ones, formats money', () => {
    const f = lead('a', { name: 'Arben Hoxha', company: 'ACME', estimatedValue: 12500 });
    const inv = { id: 'i', number: 'F-7', amount: 1500, currency: 'EUR', daysOverdue: 14 };
    const out = renderAutomationText('Hi {{firstName}} ({{name}}) nga {{company}}: {{value}} · {{invoice}} {{amount}} · {{days}} · {{owner}} · {{nope}}!', f, { ownerName: 'Eda', days: 14, invoice: inv });
    expect(out).toBe('Hi Arben (Arben Hoxha) nga ACME: 12.500 · F-7 1.500 EUR · 14 · Eda · !');
  });

  it('run doc ids are deterministic and path-safe', () => {
    expect(runDocId('r1', 'lead9', 'stage:Proposal')).toBe('r1_lead9_stage:Proposal');
    expect(runDocId('r1', 'l', 'x/y z')).toBe('r1_l_x_y_z');
  });

  it('describes a rule in one line', () => {
    expect(describeRule({ trigger: { kind: 'lead_inactive', days: 14 }, conditions: [{ field: 'status', op: 'in', values: ['Proposal'] }], actions: [{ type: 'notify', to: 'owner', title: 't' }, { type: 'create_task', title: 't', dueInDays: 1, assignTo: 'owner' }] }))
      .toBe('Kur Lead pa aktivitet prej 14 ditësh (+1 kushte) → Njofto, Krijo detyrë');
    expect(describeRule({ trigger: { kind: 'lead_stage', status: 'Lost' }, conditions: [], actions: [] })).toBe('Kur Lead-i hyn në fazën “Lost” → —');
  });
});

// ── Validation + recipes ───────────────────────────────────────────────────────

describe('validateRule', () => {
  it('rejects an empty rule with specific messages', () => {
    const errs = validateRule({ name: '', entity: 'lead', status: 'paused', trigger: { kind: 'lead_inactive' }, conditions: [], actions: [], enrollExisting: false });
    expect(errs).toContain('Rregulli ka nevojë për një emër.');
    expect(errs).toContain('Ndezësi kërkon numrin e ditëve (> 0).');
    expect(errs).toContain('Shto të paktën një veprim.');
  });

  it('rejects lead-only actions and conditions on a customer rule', () => {
    const errs = validateRule({
      name: 'x', entity: 'customer', status: 'paused', trigger: { kind: 'customer_created' },
      conditions: [{ field: 'status', op: 'in', values: ['New'] }],
      actions: [{ type: 'set_status', status: 'Lost' }, { type: 'start_cadence' }],
      enrollExisting: false,
    });
    expect(errs.some(e => e.includes('Kushti 1') && e.includes('nuk vlen'))).toBe(true);
    expect(errs.filter(e => e.includes('vlen vetëm për lead'))).toHaveLength(2);
  });

  it('rejects a set_status that re-enters the trigger stage (infinite loop)', () => {
    const errs = validateRule({
      name: 'x', entity: 'lead', status: 'paused', trigger: { kind: 'lead_stage', status: 'Proposal' },
      conditions: [], actions: [{ type: 'set_status', status: 'Proposal' }], enrollExisting: false,
    });
    expect(errs.some(e => e.includes('e njëjta me ndezësin'))).toBe(true);
  });

  it('every shipped recipe validates and its trigger/actions match its entity', () => {
    for (const r of AUTOMATION_RECIPES) {
      const draft = recipeToDraft(r);
      expect(validateRule(draft), r.key).toEqual([]);
      expect(draft.status).toBe('paused'); // never active on creation — the owner arms it
      expect(draft.enrollExisting).toBe(false);
    }
    expect(new Set(AUTOMATION_RECIPES.map(r => r.key)).size).toBe(AUTOMATION_RECIPES.length);
  });

  it('recipe drafts are deep copies', () => {
    const d = recipeToDraft(AUTOMATION_RECIPES[0]);
    (d.actions[0] as { mode: string }).mode = 'user';
    expect((AUTOMATION_RECIPES[0].actions[0] as { mode: string }).mode).toBe('round_robin');
  });
});
