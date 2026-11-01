import { describe, it, expect } from 'vitest';
import {
  normalizePlace, normalizeWebsite, websiteHost, isSocialOnlyWebsite, normalizeName, dedupeKeysFor, findDuplicate,
  fitScore, estimateSearchRequests, prospectServiceLine, searchBlockReason, prospectExpiresAt, buildFirstEmailDraft, buildCallScript, buildColdWaDraft,
  PLACES_TEXT_SEARCH_FIELD_MASK, PROSPECT_TTL_DAYS, type ProspectDraft, type SalesAgentIcp,
} from './prospecting';
import { renderTemplate, SALES_AGENT_DEFAULTS } from './core';

const normalizePhone = (raw: string) => raw.replace(/\D/g, '').replace(/^0?0?355/, '355').replace(/^0(6\d{8})$/, '355$1').replace(/^(6\d{8})$/, '355$1');

const icp: SalesAgentIcp = { categories: ['dentist', 'dental'], cities: ['Tiranë'], minRating: 3.5, minReviews: 5, preferNoWebsite: true, excludeKeywords: ['bank', 'spital'] };

const draft = (over: Partial<ProspectDraft> = {}): ProspectDraft => ({
  placeId: 'p1', name: 'Klinika Dentare Smile', category: 'Dentist', address: 'Rr. e Kavajës, Tiranë', city: 'Tiranë',
  phone: '355691234567', website: null, rating: 4.2, reviewCount: 38, operational: true, ...over,
});

describe('normalizePlace', () => {
  it('maps a Places (New) row to a draft with the injected phone rule', () => {
    const d = normalizePlace({
      id: 'ChIJ123', displayName: { text: ' Klinika Dentare Smile ' }, formattedAddress: 'Rr. e Kavajës, Tiranë 1001, Albania',
      addressComponents: [{ longText: 'Tiranë', types: ['locality'] }], rating: 4.2, userRatingCount: 38,
      primaryType: 'dental_clinic', primaryTypeDisplayName: { text: 'Dental clinic' }, websiteUri: 'https://www.Smile.al/?utm=x#top',
      nationalPhoneNumber: '069 123 4567', businessStatus: 'OPERATIONAL',
    }, { normalizePhone });
    expect(d).toMatchObject({ placeId: 'ChIJ123', name: 'Klinika Dentare Smile', city: 'Tiranë', category: 'Dental clinic', phone: '355691234567', website: 'https://www.smile.al', rating: 4.2, reviewCount: 38, operational: true });
  });
  it('falls back to the search city and humanises the type; rejects rows without id/name', () => {
    const d = normalizePlace({ id: 'x', displayName: 'Bar Tirana', primaryType: 'coffee_shop' }, { fallbackCity: 'Durrës', normalizePhone });
    expect(d).toMatchObject({ city: 'Durrës', category: 'coffee shop', phone: null, website: null, rating: null });
    expect(normalizePlace({ displayName: 'No id' }, { normalizePhone })).toBeNull();
  });
  it('field mask asks for everything in one Text Search request', () => {
    expect(PLACES_TEXT_SEARCH_FIELD_MASK).toContain('places.nationalPhoneNumber');
    expect(PLACES_TEXT_SEARCH_FIELD_MASK).toContain('places.websiteUri');
    expect(PLACES_TEXT_SEARCH_FIELD_MASK).toContain('nextPageToken');
  });
});

describe('website & name normalisation', () => {
  it('normalizeWebsite strips query/hash, rejects non-http', () => {
    expect(normalizeWebsite('https://Example.com/a/?b=1#c')).toBe('https://example.com/a');
    expect(normalizeWebsite('javascript:alert(1)')).toBeNull();
    expect(normalizeWebsite('not a url')).toBeNull();
  });
  it('social pages are not a website', () => {
    expect(websiteHost('https://www.facebook.com/smile')).toBeNull();
    expect(isSocialOnlyWebsite('https://instagram.com/smile')).toBe(true);
    expect(websiteHost('https://www.smile.al/x')).toBe('smile.al');
  });
  it('normalizeName drops legal forms and diacritics', () => {
    expect(normalizeName('Klinika Dentare "Smile" SH.P.K.')).toBe('smile');
    expect(normalizeName('Çikrikë Studio')).toBe('cikrike');
  });
});

describe('dedupe', () => {
  it('matches on phone, host, or name+city', () => {
    const d = draft({ website: 'https://smile.al' });
    expect(findDuplicate(d, [{ id: 'l1', kind: 'lead', phone: '355691234567' }])?.id).toBe('l1');
    expect(findDuplicate(d, [{ id: 'c1', kind: 'customer', website: 'http://www.smile.al/home' }])?.id).toBe('c1');
    expect(findDuplicate(d, [{ id: 'p2', kind: 'prospect', name: 'SMILE klinika dentare', city: 'tiranë' }])?.id).toBe('p2');
    expect(findDuplicate(d, [{ id: 'x', kind: 'lead', phone: '355690000000', name: 'Other', city: 'Tiranë' }])).toBeNull();
    expect(dedupeKeysFor(d)).toEqual({ phone: '355691234567', host: 'smile.al', nameCity: 'smile|tiranë' });
  });
});

describe('fitScore', () => {
  it('explains every point and stays within 0–100', () => {
    const r = fitScore(draft(), icp);
    expect(r.score).toBe(100); // 10 + 30 + 15 + 15 + 20 + 10
    expect(r.reasons).toEqual(expect.arrayContaining(['Kategori në ICP', 'Qyteti Tiranë', 'Pa website', 'Telefon i disponueshëm']));
    expect(fitScore(draft({ name: 'Spitali Amerikan', category: 'Hospital' }), icp).reasons.join()).toContain('Përjashtuar');
    expect(fitScore(draft({ operational: false }), icp).score).toBeLessThan(50);
  });
  it('weak website still scores, strong website does not get the bonus', () => {
    expect(fitScore(draft({ website: 'https://facebook.com/smile' }), icp).reasons.join()).toContain('Vetëm faqe sociale');
    expect(fitScore(draft({ website: 'https://smile.al' }), icp).score).toBe(80);
    expect(fitScore(draft({ website: 'https://smile.al' }), { ...icp, preferNoWebsite: false }).score).toBe(80);
  });
  it('too few reviews is penalised, no reviews is explained', () => {
    expect(fitScore(draft({ reviewCount: 2 }), icp).reasons.join()).toContain('Vetëm 2 vlerësime');
    expect(fitScore(draft({ rating: null, reviewCount: null }), icp).reasons).toContain('Pa vlerësime në Google');
  });
});

describe('cost & gates', () => {
  it('requests = ceil(results / 20), max 3', () => {
    expect(estimateSearchRequests(20)).toBe(1);
    expect(estimateSearchRequests(21)).toBe(2);
    expect(estimateSearchRequests(60)).toBe(3);
    expect(estimateSearchRequests(500)).toBe(3);
    expect(estimateSearchRequests(0)).toBe(1);
  });
  it('searchBlockReason', () => {
    const base = { query: 'klinika dentare', city: 'Tiranë', maxResults: 60, requestsUsedThisMonth: 0, monthlyBudget: 300, queuedCount: 0 };
    expect(searchBlockReason(base)).toBeNull();
    expect(searchBlockReason({ ...base, query: ' ' })).toBe('empty-query');
    expect(searchBlockReason({ ...base, city: '' })).toBe('empty-city');
    expect(searchBlockReason({ ...base, requestsUsedThisMonth: 298 })).toBe('budget-exceeded');
    expect(searchBlockReason({ ...base, queuedCount: 10 })).toBe('too-many-queued');
  });
  it('prospects expire after 30 days', () => {
    const c = new Date('2026-11-03T00:00:00Z');
    expect(prospectExpiresAt(c).getTime() - c.getTime()).toBe(PROSPECT_TTL_DAYS * 86_400_000);
  });
});

describe('first-contact drafts', () => {
  const persona = { ...SALES_AGENT_DEFAULTS.persona, businessName: 'Bos Marketing' };
  it('email names the observation, discloses the agent and offers an exit', () => {
    const e = buildFirstEmailDraft({ prospect: draft(), persona, serviceLine: 'website profesional', senderName: 'Xhentil' });
    expect(e.subject).toContain('Klinika Dentare Smile');
    expect(e.body).toContain('nuk ka ende një website');
    expect(e.body).toContain('asistentja virtuale e Bos Marketing');
    expect(e.body).toContain('Jo, faleminderit');
    expect(e.body).toContain('Xhentil');
  });
  it('a renamed persona reaches drafts rebuilt from a stored snapshot', () => {
    const old = buildFirstEmailDraft({ prospect: draft(), persona: { ...persona, businessName: 'Agjencia' }, serviceLine: 'seo', senderName: null });
    const line = prospectServiceLine({ firstMessageDraft: old.body });
    expect(line).toBe('seo');
    expect(prospectServiceLine({ serviceLine: ' website ', firstMessageDraft: old.body })).toBe('website');
    expect(prospectServiceLine({ firstMessageDraft: null })).toBeNull();
    const fresh = buildFirstEmailDraft({ prospect: draft(), persona, serviceLine: line!, senderName: null });
    expect(fresh.body).toContain('asistentja virtuale e Bos Marketing');
    expect(fresh.body).not.toContain('Agjencia');
  });
  it('call script and cold WA draft', () => {
    const s = buildCallScript({ prospect: draft(), persona, serviceLine: 'SEO lokal', senderName: 'Xhentil' });
    expect(s).toContain('HAPJA');
    expect(s).toContain('4.2★');
    const wa = buildColdWaDraft(SALES_AGENT_DEFAULTS.coldWa.template, { prospect: draft(), persona, serviceLine: 'SEO lokal' }, renderTemplate);
    expect(wa).toContain('Jam Ana, asistentja virtuale e Bos Marketing');
    expect(wa).toContain('Klinika Dentare Smile');
    expect(wa).not.toContain('{{');
  });
});
