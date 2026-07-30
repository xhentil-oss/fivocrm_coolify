import { describe, it, expect } from 'vitest';
import { contactKey, findContactMatch, findContactMatches, normContactPhone } from './contactIdentity';

describe('normContactPhone', () => {
  it('canonicalizes Albanian formats to the same value', () => {
    const forms = ['069 123 4567', '0691234567', '+355 69 123 4567', '355691234567'];
    const normalized = forms.map(normContactPhone);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('355691234567');
  });

  it('rejects numbers too short to identify anyone', () => {
    expect(normContactPhone('123')).toBe('');
    expect(normContactPhone('')).toBe('');
    expect(normContactPhone(undefined)).toBe('');
  });
});

describe('contactKey', () => {
  it('prefers email over phone', () => {
    expect(contactKey({ email: 'A@Fivo.al ', phone: '0691234567' })).toBe('e:a@fivo.al');
  });

  it('falls back to the phone when there is no email', () => {
    expect(contactKey({ phoneNumber: '069 123 4567' })).toBe('p:355691234567');
  });

  it('is empty when the contact has neither', () => {
    expect(contactKey({ name: 'Pa kontakt' } as any)).toBe('');
  });
});

describe('findContactMatches', () => {
  const customers = [
    { id: 'c1', name: 'Alba', email: 'alba@fivo.al', phone: '0691111111' },
    { id: 'c2', name: 'Bora', email: 'bora@fivo.al', phone: '+355 69 222 2222' },
  ];

  it('matches on email regardless of case and whitespace', () => {
    const m = findContactMatch({ email: ' ALBA@fivo.al ' }, customers);
    expect(m?.record.id).toBe('c1');
    expect(m?.on).toBe('email');
  });

  it('matches on phone across formats', () => {
    const m = findContactMatch({ phoneNumber: '0692222222' }, customers);
    expect(m?.record.id).toBe('c2');
    expect(m?.on).toBe('phone');
  });

  it('ranks an email match ahead of a phone match', () => {
    const matches = findContactMatches({ email: 'bora@fivo.al', phone: '0691111111' }, customers);
    expect(matches.map(m => [m.record.id, m.on])).toEqual([['c2', 'email'], ['c1', 'phone']]);
  });

  it('honours excludeId so editing a record never flags itself', () => {
    expect(findContactMatch({ email: 'alba@fivo.al' }, customers, 'c1')).toBeNull();
  });

  it('returns nothing for a contact with no email or phone', () => {
    expect(findContactMatches({ email: '', phone: '' }, customers)).toEqual([]);
  });

  it('does not match two records that both lack contact details', () => {
    expect(findContactMatches({}, [{ id: 'x', email: '', phone: '' }])).toEqual([]);
  });
});
