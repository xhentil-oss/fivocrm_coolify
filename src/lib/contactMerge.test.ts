import { describe, it, expect } from 'vitest';
import {
  buildFieldPlan, defaultChoices, findDuplicateGroups, rankMergeCandidates,
  resolveMergedValues, totalMoved, visibleFieldPlan, MERGED_NOTE_SEPARATOR,
} from './contactMerge';

const customer = (over: Record<string, any>) => ({
  id: 'x', name: 'Klient', createdAt: new Date('2026-01-01'), ...over,
});

describe('findDuplicateGroups', () => {
  it('groups records that share an email, case- and space-insensitively', () => {
    const groups = findDuplicateGroups([
      customer({ id: 'a', email: 'alba@fivo.al' }),
      customer({ id: 'b', email: ' ALBA@fivo.al ' }),
      customer({ id: 'c', email: 'bora@fivo.al' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe('email');
    expect(groups[0].records.map(r => r.id).sort()).toEqual(['a', 'b']);
  });

  it('groups on phone across stored formats (lead phoneNumber vs customer phone)', () => {
    const groups = findDuplicateGroups([
      customer({ id: 'a', phone: '+355692222222' }),
      customer({ id: 'b', phoneNumber: '0692222222' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe('phone');
  });

  it('chains a transitive group: a~b by email, b~c by phone', () => {
    const groups = findDuplicateGroups([
      customer({ id: 'a', email: 'x@fivo.al' }),
      customer({ id: 'b', email: 'x@fivo.al', phone: '0691111111' }),
      customer({ id: 'c', phone: '0691111111' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].records).toHaveLength(3);
  });

  it('matches on name only when nothing contradicts it', () => {
    const groups = findDuplicateGroups([
      customer({ id: 'a', name: 'Arben Krasniqi' }),
      customer({ id: 'b', name: 'arben krasniqi' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe('name');
  });

  it('folds accents so "Ëngjëll" and "Engjell" are one person', () => {
    const groups = findDuplicateGroups([
      customer({ id: 'a', name: 'Ëngjëll Hoxha' }),
      customer({ id: 'b', name: 'Engjell Hoxha' }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it('refuses a name match when both records state DIFFERENT emails', () => {
    expect(findDuplicateGroups([
      customer({ id: 'a', name: 'Arben Krasniqi', email: 'a@fivo.al' }),
      customer({ id: 'b', name: 'Arben Krasniqi', email: 'b@fivo.al' }),
    ])).toEqual([]);
  });

  it('ignores names too short to identify anyone', () => {
    expect(findDuplicateGroups([
      customer({ id: 'a', name: 'Ana' }),
      customer({ id: 'b', name: 'Ana' }),
    ])).toEqual([]);
  });

  it('never groups records with no contact data at all', () => {
    expect(findDuplicateGroups([
      { id: 'a', name: '', email: '', phone: '', createdAt: new Date() },
      { id: 'b', name: '', email: '', phone: '', createdAt: new Date() },
    ])).toEqual([]);
  });

  it('puts email groups before name groups', () => {
    const groups = findDuplicateGroups([
      customer({ id: 'a', name: 'Petrit Berisha' }),
      customer({ id: 'b', name: 'Petrit Berisha' }),
      customer({ id: 'c', name: 'Dritan Shehu', email: 'd@fivo.al' }),
      customer({ id: 'd', name: 'Dritan Shehu 2', email: 'd@fivo.al' }),
    ]);
    expect(groups.map(g => g.reason)).toEqual(['email', 'name']);
  });
});

describe('rankMergeCandidates', () => {
  it('puts the most complete record first, ties broken by age', () => {
    const ranked = rankMergeCandidates([
      customer({ id: 'thin', createdAt: new Date('2026-01-01') }),
      customer({ id: 'rich', email: 'a@fivo.al', phone: '0691111111', company: 'Fivo', notes: 'x' }),
    ]);
    expect(ranked[0].id).toBe('rich');
  });

  it('prefers the older record when both are equally complete', () => {
    const ranked = rankMergeCandidates([
      customer({ id: 'new', email: 'a@fivo.al', createdAt: new Date('2026-05-01') }),
      customer({ id: 'old', email: 'a@fivo.al', createdAt: new Date('2026-01-01') }),
    ]);
    expect(ranked[0].id).toBe('old');
  });
});

describe('buildFieldPlan', () => {
  const primary = { name: 'Alba', email: 'alba@fivo.al', phone: '', notes: 'Nota A', tags: 'VIP' };
  const secondary = { name: 'Alba Kola', email: 'alba@fivo.al', phone: '0691111111', notes: 'Nota B', tags: 'Prioritet' };

  it('classifies every field', () => {
    const plan = buildFieldPlan('customer', primary, secondary);
    const by = Object.fromEntries(plan.map(d => [d.key, d]));
    expect(by.email.status).toBe('same');
    expect(by.phone.status).toBe('onlySecondary');
    expect(by.name.status).toBe('conflict');
    expect(by.company.status).toBe('empty');
  });

  it('suggests filling an empty primary field from the duplicate', () => {
    const by = Object.fromEntries(buildFieldPlan('customer', primary, secondary).map(d => [d.key, d]));
    expect(by.phone.suggested).toBe('secondary');
    expect(by.name.suggested).toBe('primary');
    expect(by.notes.suggested).toBe('both');
    expect(by.tags.suggested).toBe('both');
  });

  it('hides fields that are empty on both sides', () => {
    const visible = visibleFieldPlan(buildFieldPlan('customer', primary, secondary));
    expect(visible.some(d => d.key === 'company')).toBe(false);
  });
});

describe('resolveMergedValues', () => {
  const primary = { name: 'Alba', email: 'alba@fivo.al', phone: '', notes: 'Nota A', tags: 'VIP' };
  const secondary = { name: 'Alba Kola', phone: '0691111111', notes: 'Nota B', tags: 'Prioritet, vip' };

  it('writes only what actually changes on the survivor', () => {
    const plan = buildFieldPlan('customer', primary, secondary);
    const out = resolveMergedValues('customer', primary, secondary, defaultChoices(plan));
    expect(out.phone).toBe('0691111111');
    expect(out.name).toBeUndefined();        // primary kept → no write
    expect(out.email).toBeUndefined();       // identical → no write
  });

  it('unions tags case-insensitively and keeps the customer comma format', () => {
    const plan = buildFieldPlan('customer', primary, secondary);
    const out = resolveMergedValues('customer', primary, secondary, defaultChoices(plan));
    expect(out.tags).toBe('VIP, Prioritet');
  });

  it('keeps the lead tag array shape', () => {
    const p = { name: 'L', tags: ['A'] };
    const s = { name: 'L', tags: ['B'] };
    const out = resolveMergedValues('lead', p, s, { tags: 'both' });
    expect(out.tags).toEqual(['A', 'B']);
  });

  it('concatenates notes when both sides are kept', () => {
    const out = resolveMergedValues('customer', primary, secondary, { notes: 'both' });
    expect(out.notes).toBe(`Nota A${MERGED_NOTE_SEPARATOR}Nota B`);
  });

  it('takes the duplicate value when the user picks it', () => {
    const out = resolveMergedValues('customer', primary, secondary, { name: 'secondary' });
    expect(out.name).toBe('Alba Kola');
  });

  it('treats "5" and 5 as the same value (no pointless write)', () => {
    const out = resolveMergedValues('lead', { estimatedValue: 5 }, { estimatedValue: '5' }, {});
    expect(out.estimatedValue).toBeUndefined();
  });

  it('never returns a key outside the allow-list', () => {
    const out = resolveMergedValues(
      'customer',
      { name: 'A' },
      { name: 'B', businessId: 'other-tenant', leadId: 'l1', createdAt: new Date() },
      { name: 'secondary' },
    );
    expect(Object.keys(out)).toEqual(['name']);
  });
});

describe('totalMoved', () => {
  it('sums the per-collection counts', () => {
    expect(totalMoved({ invoices: 3, projects: 2 })).toBe(5);
    expect(totalMoved(null)).toBe(0);
  });
});
