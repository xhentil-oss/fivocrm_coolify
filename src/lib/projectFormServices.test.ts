import { describe, it, expect } from 'vitest';
import { sameIdSet, servicesTotalIn, serviceBudgetOverride, updateIdListValue } from './projectFormServices';
import { getRateToAll } from './utils';

const services = [
  { id: 'a', price: 500, currency: 'EUR' },
  { id: 'b', price: 10000, currency: 'ALL' },
  { id: 'c', price: 0 },
];

describe('sameIdSet', () => {
  it('ignores order and duplicates', () => {
    expect(sameIdSet(['a', 'b'], ['b', 'a', 'a'])).toBe(true);
    expect(sameIdSet([], undefined)).toBe(true);
    expect(sameIdSet(['a'], [])).toBe(false);
    expect(sameIdSet(['a'], ['b'])).toBe(false);
  });
});

describe('servicesTotalIn', () => {
  const eur = getRateToAll('EUR');
  it('normalises each service currency into the project currency', () => {
    expect(servicesTotalIn(services, ['a', 'b'], 'ALL')).toBeCloseTo(500 * eur + 10000, 2);
    expect(servicesTotalIn(services, ['a', 'b'], 'EUR')).toBeCloseTo(500 + 10000 / eur, 2);
  });
  it('is null when nothing is selected', () => {
    expect(servicesTotalIn(services, [], 'ALL')).toBeNull();
    expect(servicesTotalIn(undefined, ['a'], 'ALL')).toBeNull();
  });
});

describe('serviceBudgetOverride', () => {
  const base = { services, currency: 'ALL' };
  it('never overrides for a user who cannot see the budget', () => {
    expect(serviceBudgetOverride({ ...base, canSeeBudget: false, selectedIds: ['b'], initialIds: [] })).toBeNull();
  });
  it('leaves a negotiated budget alone when the selection is unchanged on edit', () => {
    expect(serviceBudgetOverride({ ...base, canSeeBudget: true, selectedIds: ['b', 'a'], initialIds: ['a', 'b'] })).toBeNull();
  });
  it('overrides when the selection changed (create = initial empty)', () => {
    expect(serviceBudgetOverride({ ...base, canSeeBudget: true, selectedIds: ['b'], initialIds: undefined })).toBe(10000);
    expect(serviceBudgetOverride({ ...base, canSeeBudget: true, selectedIds: ['b'], initialIds: ['a', 'b'] })).toBe(10000);
  });
  it('on CREATE the services total sets the budget even without budget permission', () => {
    // Member/Sales may create a project but never see the budget: without this the
    // project was saved at 0 and the recurring cron billed 0 from cycle two.
    expect(serviceBudgetOverride({ ...base, canSeeBudget: false, selectedIds: ['b'], initialIds: undefined, isCreate: true })).toBe(10000);
    expect(serviceBudgetOverride({ ...base, canSeeBudget: true, selectedIds: ['b'], initialIds: undefined, isCreate: true })).toBe(10000);
    expect(serviceBudgetOverride({ ...base, canSeeBudget: false, selectedIds: [], initialIds: undefined, isCreate: true })).toBeNull();
  });
  it('on EDIT a user without budget permission never overrides, even if the selection changed', () => {
    expect(serviceBudgetOverride({ ...base, canSeeBudget: false, selectedIds: ['a', 'b'], initialIds: ['a'], isCreate: false })).toBeNull();
  });
  it('does not override when every service was removed', () => {
    expect(serviceBudgetOverride({ ...base, canSeeBudget: true, selectedIds: [], initialIds: ['a'] })).toBeNull();
  });
});

describe('updateIdListValue', () => {
  it('returns [] for an emptied list so the update clears the field', () => {
    expect(updateIdListValue('[]')).toEqual([]);
  });
  it('returns the ids, dropping junk', () => {
    expect(updateIdListValue('["a","",3,"b"]')).toEqual(['a', 'b']);
  });
  it('is undefined when not sent or malformed (leave untouched)', () => {
    expect(updateIdListValue(null)).toBeUndefined();
    expect(updateIdListValue('')).toBeUndefined();
    expect(updateIdListValue('{bad')).toBeUndefined();
    expect(updateIdListValue('{"a":1}')).toBeUndefined();
  });
});
