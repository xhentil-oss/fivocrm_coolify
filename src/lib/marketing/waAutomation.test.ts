import { describe, it, expect } from 'vitest';
import {
  contactTags, normalizePhone, isSendablePhone, toDate,
  resolveLastContactAt, daysSince, pickVariant, variantServiceLabel,
  withUtm, firstName, summarizeNotes, renderWaMessage,
  waSendBlockReason, evaluateWaSegment, validateWaCampaign,
  type WaContact, type WaMessageVariant,
} from './waAutomation';

const NOW = new Date('2026-08-12T10:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const lead = (over: Partial<WaContact> = {}): WaContact => ({
  id: 'l1', name: 'Ardit Hoxha', phone: '+355 69 123 4567', status: 'Contacted',
  tags: ['SEO'], notes: 'Interesuar për faqe e-commerce me 200 produkte', ...over,
});

const VARIANTS: WaMessageVariant[] = [
  { id: 'v-seo', label: 'SEO', tags: ['SEO'], body: 'Përshëndetje {{name}}, për {{notes}} — {{link}}', landingUrl: 'https://fivocrm.com/seo' },
  { id: 'v-ads', label: 'Ads', tags: ['Google Ads', 'Meta Ads'], body: 'Ads për {{company}}', landingUrl: 'https://fivocrm.com/ads' },
  { id: 'v-any', label: 'Fallback', tags: [], body: 'Përshëndetje {{name}}!' },
];

describe('normalization', () => {
  it('reads tags from an array (leads) and a comma string (customers)', () => {
    expect(contactTags({ tags: ['SEO', ' Ads '] })).toEqual(['SEO', 'Ads']);
    expect(contactTags({ tags: 'SEO, Ads ,' })).toEqual(['SEO', 'Ads']);
    expect(contactTags({})).toEqual([]);
    expect(contactTags(null)).toEqual([]);
  });

  it('strips everything but digits from a phone', () => {
    expect(normalizePhone('+355 69 123 4567')).toBe('355691234567');
    expect(isSendablePhone('123')).toBe(false);
    expect(isSendablePhone('+355 69 123 4567')).toBe(true);
    expect(isSendablePhone(undefined)).toBe(false);
  });

  it('accepts Date, Firestore Timestamp, millis and ISO strings', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(toDate(d)).toEqual(d);
    expect(toDate({ toDate: () => d })).toEqual(d);
    expect(toDate(d.getTime())).toEqual(d);
    expect(toDate('2026-01-01T00:00:00Z')).toEqual(d);
    expect(toDate(null)).toBeNull();
    expect(toDate('not a date')).toBeNull();
    expect(toDate(new Date('nope'))).toBeNull();
  });
});

describe('resolveLastContactAt', () => {
  it('takes the newest signal across message, activity and follow-up', () => {
    const at = resolveLastContactAt(
      lead({ lastActivityAt: daysAgo(40), lastFollowUpDate: daysAgo(10) }),
      daysAgo(60),
    );
    expect(daysSince(at, NOW)).toBe(10);
  });

  it('does NOT treat createdAt as a contact — an untouched lead is "never contacted"', () => {
    const at = resolveLastContactAt(lead({ createdAt: daysAgo(200) }));
    expect(at).toBeNull();
    expect(daysSince(at, NOW)).toBeNull();
  });

  it('uses the WhatsApp message date when the CRM has no activity', () => {
    expect(daysSince(resolveLastContactAt(lead(), daysAgo(45)), NOW)).toBe(45);
  });
});

describe('pickVariant', () => {
  it('picks the variant matching the contact tag', () => {
    expect(pickVariant(lead({ tags: ['SEO'] }), VARIANTS)?.id).toBe('v-seo');
    expect(pickVariant(lead({ tags: ['Meta Ads'] }), VARIANTS)?.id).toBe('v-ads');
  });

  it('falls back to the tagless variant when nothing matches', () => {
    expect(pickVariant(lead({ tags: ['Hosting'] }), VARIANTS)?.id).toBe('v-any');
  });

  it('prefers the MORE SPECIFIC variant over declaration order', () => {
    const vs: WaMessageVariant[] = [
      { id: 'broad', tags: ['SEO'], body: 'broad' },
      { id: 'narrow', tags: ['SEO', 'E-commerce'], body: 'narrow' },
    ];
    expect(pickVariant(lead({ tags: ['SEO', 'E-commerce'] }), vs)?.id).toBe('narrow');
  });

  it('returns null when there are no variants or all bodies are empty', () => {
    expect(pickVariant(lead(), [])).toBeNull();
    expect(pickVariant(lead(), [{ id: 'x', tags: [], body: '  ' }])).toBeNull();
    expect(pickVariant(lead(), undefined)).toBeNull();
  });

  it('names the matched tag as the service label', () => {
    const v = pickVariant(lead({ tags: ['Meta Ads'] }), VARIANTS)!;
    expect(variantServiceLabel(lead({ tags: ['Meta Ads'] }), v)).toBe('Meta Ads');
    expect(variantServiceLabel(lead({ tags: ['Hosting'] }), VARIANTS[2])).toBe('Fallback');
  });
});

describe('withUtm', () => {
  it('adds UTM params and keeps the existing query', () => {
    const out = withUtm('https://fivocrm.com/seo?ref=x', { source: 'whatsapp', medium: 'crm', campaign: 'riaktivizim' });
    expect(out).toContain('ref=x');
    expect(out).toContain('utm_source=whatsapp');
    expect(out).toContain('utm_campaign=riaktivizim');
  });

  it('never overwrites a UTM the user already put in the URL', () => {
    expect(withUtm('https://a.com/?utm_source=mine', { source: 'whatsapp' })).toContain('utm_source=mine');
  });

  it('returns non-URLs and empties untouched instead of throwing', () => {
    expect(withUtm('fivocrm.com/seo', { source: 'x' })).toBe('fivocrm.com/seo');
    expect(withUtm('', { source: 'x' })).toBe('');
    expect(withUtm(undefined)).toBe('');
  });
});

describe('firstName', () => {
  it('takes only the first name — a full legal name does not read human', () => {
    expect(firstName('Ardit Hoxha')).toBe('Ardit');
    expect(firstName('  Besa   Kola ')).toBe('Besa');
    expect(firstName('Ardit')).toBe('Ardit');
    expect(firstName(undefined)).toBe('');
    expect(firstName('   ')).toBe('');
  });
});

describe('summarizeNotes', () => {
  it('takes the first meaningful line and strips bullet/date noise', () => {
    expect(summarizeNotes('- Interesuar për SEO\nTelefonoi dy herë')).toBe('Interesuar për SEO');
    expect(summarizeNotes('12/07: kërkoi ofertë')).toBe('kërkoi ofertë');
    expect(summarizeNotes('\n\n  • buxhet 500 EUR')).toBe('buxhet 500 EUR');
  });

  it('caps length on a word boundary with an ellipsis', () => {
    const out = summarizeNotes('a'.repeat(40) + ' ' + 'b'.repeat(200), 60);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(61);
    expect(out).not.toContain('bbbb');
  });

  it('returns empty for missing notes', () => {
    expect(summarizeNotes(undefined)).toBe('');
    expect(summarizeNotes('   \n  ')).toBe('');
  });
});

describe('renderWaMessage', () => {
  it('fills named tokens with a first name and summarized notes', () => {
    const out = renderWaMessage('Ç’kemi {{name}}, për {{notes}}?', lead());
    expect(out).toBe('Ç’kemi Ardit, për Interesuar për faqe e-commerce me 200 produkte?');
  });

  it('never leaks template syntax for an unknown token', () => {
    const out = renderWaMessage('Hi {{name}} {{unknownThing}}!', lead());
    expect(out).not.toContain('{{');
    expect(out).toBe('Hi Ardit !');
  });

  it('substitutes {{link}} in place when the token is present', () => {
    const out = renderWaMessage('Info: {{link}} — faleminderit', lead(), { link: 'https://x.com/seo' });
    expect(out).toBe('Info: https://x.com/seo — faleminderit');
  });

  it('appends the link when the body forgot the token', () => {
    const out = renderWaMessage('Përshëndetje {{name}}', lead(), { link: 'https://x.com/seo' });
    expect(out).toBe('Përshëndetje Ardit\n\nhttps://x.com/seo');
  });

  it('adds nothing when there is no link', () => {
    expect(renderWaMessage('Vetëm tekst', lead())).toBe('Vetëm tekst');
  });
});

describe('waSendBlockReason — segment filters', () => {
  const ctx = { now: NOW, kind: 'lead' as const };

  it('passes an eligible lead', () => {
    expect(waSendBlockReason(lead(), {}, {}, ctx)).toBeNull();
  });

  it('blocks a contact with no usable phone', () => {
    expect(waSendBlockReason(lead({ phone: '12' }), {}, {}, ctx)).toBe('no-phone');
  });

  it('applies status, tag, assignee and source filters', () => {
    expect(waSendBlockReason(lead(), { statuses: ['New'] }, {}, ctx)).toBe('status-mismatch');
    expect(waSendBlockReason(lead(), { tags: ['Ads'] }, {}, ctx)).toBe('tag-mismatch');
    expect(waSendBlockReason(lead({ tags: ['SEO'] }), { tags: ['SEO', 'Ads'], tagMatch: 'all' }, {}, ctx)).toBe('tag-mismatch');
    expect(waSendBlockReason(lead({ tags: ['SEO'] }), { tags: ['SEO', 'Ads'], tagMatch: 'any' }, {}, ctx)).toBeNull();
    expect(waSendBlockReason(lead(), { assignedToUserId: 'u9' }, {}, ctx)).toBe('assignee-mismatch');
    expect(waSendBlockReason(lead(), { source: 'whmcs' }, {}, ctx)).toBe('source-mismatch');
  });

  it('honours the deprecated single-tag field', () => {
    expect(waSendBlockReason(lead({ tags: ['SEO'] }), { tag: 'SEO' }, {}, ctx)).toBeNull();
    expect(waSendBlockReason(lead({ tags: ['SEO'] }), { tag: 'Ads' }, {}, ctx)).toBe('tag-mismatch');
  });

  it('excludes leads from a hasDomain segment (a lead never owns one)', () => {
    expect(waSendBlockReason(lead(), { hasDomain: true }, {}, ctx)).toBe('domain-mismatch');
    const cust = { id: 'c1', name: 'X', phone: '355691234567' };
    expect(waSendBlockReason(cust, { hasDomain: true }, {}, {
      now: NOW, kind: 'customer', domainCustomerIds: new Set(['c1']),
    })).toBeNull();
    expect(waSendBlockReason(cust, { hasDomain: true }, {}, {
      now: NOW, kind: 'customer', domainCustomerIds: new Set(['other']),
    })).toBe('domain-mismatch');
  });

  it('skips a phone already sent in a one-shot campaign', () => {
    expect(waSendBlockReason(lead(), {}, {}, { ...ctx, sentPhones: new Set(['355691234567']) })).toBe('already-sent');
  });
});

describe('waSendBlockReason — the new dormancy conditions', () => {
  const ctx = { now: NOW, kind: 'lead' as const };

  it('blocks someone contacted more recently than the threshold', () => {
    const r = waSendBlockReason(lead({ lastActivityAt: daysAgo(5) }), {}, { lastContactMinDays: 30 }, ctx);
    expect(r).toBe('contacted-too-recently');
  });

  it('passes someone dormant past the threshold', () => {
    expect(waSendBlockReason(lead({ lastActivityAt: daysAgo(45) }), {}, { lastContactMinDays: 30 }, ctx)).toBeNull();
  });

  it('counts a recent WhatsApp message as contact — this is the cooldown', () => {
    const l = lead({ lastActivityAt: daysAgo(90) });
    const phone = normalizePhone(l.phone);
    // We messaged them yesterday (e.g. the previous run of this same rule):
    const r = waSendBlockReason(l, {}, { lastContactMinDays: 30 }, {
      ...ctx, lastMessageByPhone: new Map([[phone, daysAgo(1)]]),
    });
    expect(r).toBe('contacted-too-recently');
  });

  it('treats a never-contacted lead as dormant, but respects requireContacted', () => {
    const untouched = lead({ lastActivityAt: undefined, notes: 'x' });
    expect(waSendBlockReason(untouched, {}, { lastContactMinDays: 30 }, ctx)).toBeNull();
    expect(waSendBlockReason(untouched, {}, { lastContactMinDays: 30, requireContacted: true }, ctx)).toBe('never-contacted');
  });

  it('excludes a never-contacted lead when a window ceiling is set', () => {
    const untouched = lead({ lastActivityAt: undefined });
    expect(waSendBlockReason(untouched, {}, { lastContactMinDays: 30, lastContactMaxDays: 120 }, ctx)).toBe('never-contacted');
  });

  it('applies the window ceiling to ancient contacts', () => {
    const old = lead({ lastActivityAt: daysAgo(400) });
    expect(waSendBlockReason(old, {}, { lastContactMinDays: 30, lastContactMaxDays: 120 }, ctx)).toBe('contact-too-old');
    expect(waSendBlockReason(old, {}, { lastContactMinDays: 30 }, ctx)).toBeNull();
  });

  it('requires notes when the message quotes them', () => {
    expect(waSendBlockReason(lead({ notes: '' }), {}, { requireNotes: true }, ctx)).toBe('no-notes');
    expect(waSendBlockReason(lead(), {}, { requireNotes: true }, ctx)).toBeNull();
  });

  it('blocks a contact no variant has text for', () => {
    const onlySeo: WaMessageVariant[] = [{ id: 'v', tags: ['SEO'], body: 'x' }];
    expect(waSendBlockReason(lead({ tags: ['Hosting'] }), {}, {}, ctx, onlySeo)).toBe('no-variant');
    expect(waSendBlockReason(lead({ tags: ['SEO'] }), {}, {}, ctx, onlySeo)).toBeNull();
  });

  it('does no dormancy work at all when no dormancy condition is set', () => {
    expect(waSendBlockReason(lead({ lastActivityAt: daysAgo(0) }), {}, {}, ctx)).toBeNull();
  });
});

describe('evaluateWaSegment', () => {
  it('builds the exact message per contact, with the right landing page', () => {
    const res = evaluateWaSegment({
      leads: [
        lead({ id: 'a', name: 'Ardit Hoxha', phone: '355691111111', tags: ['SEO'], notes: 'faqe e-commerce', lastActivityAt: daysAgo(60) }),
        lead({ id: 'b', name: 'Besa K', phone: '355692222222', tags: ['Meta Ads'], company: 'Besa Ltd', lastActivityAt: daysAgo(60) }),
      ],
      segment: { audience: ['leads'] },
      conditions: { lastContactMinDays: 30 },
      variants: VARIANTS,
      utm: { source: 'whatsapp', campaign: 'riaktivizim' },
      now: NOW,
    });
    expect(res.targets).toHaveLength(2);
    const [a, b] = res.targets;
    expect(a.variant?.id).toBe('v-seo');
    expect(a.message).toContain('Ardit');
    expect(a.message).toContain('faqe e-commerce');
    expect(a.message).toContain('utm_source=whatsapp');
    expect(a.link).toContain('https://fivocrm.com/seo');
    expect(b.variant?.id).toBe('v-ads');
    expect(b.message).toContain('Besa Ltd');
    expect(b.link).toContain('https://fivocrm.com/ads');
  });

  it('accounts for every excluded contact by reason', () => {
    const res = evaluateWaSegment({
      leads: [
        lead({ id: 'ok', phone: '355691111111', lastActivityAt: daysAgo(60) }),
        lead({ id: 'recent', phone: '355692222222', lastActivityAt: daysAgo(2) }),
        lead({ id: 'nophone', phone: '' }),
        lead({ id: 'wrongtag', phone: '355693333333', tags: ['Hosting'], lastActivityAt: daysAgo(60) }),
      ],
      segment: { audience: ['leads'], tags: ['SEO'] },
      conditions: { lastContactMinDays: 30 },
      now: NOW,
    });
    expect(res.targets.map((t) => t.contact.id)).toEqual(['ok']);
    expect(res.considered).toBe(4);
    expect(res.blocked['contacted-too-recently']).toBe(1);
    expect(res.blocked['no-phone']).toBe(1);
    expect(res.blocked['tag-mismatch']).toBe(1);
  });

  it('dedupes one person who is both a lead and a customer', () => {
    const res = evaluateWaSegment({
      leads: [lead({ id: 'l', phone: '+355 69 111 1111' })],
      customers: [{ id: 'c', name: 'Same Person', phone: '355691111111' }],
      segment: { audience: ['leads', 'customers'] },
      now: NOW,
    });
    expect(res.targets).toHaveLength(1);
    expect(res.targets[0].contact.id).toBe('l'); // the lead wins — it holds the notes
    expect(res.deduped).toBe(1);
  });

  it('respects the audience selection', () => {
    const input = {
      leads: [lead({ id: 'l', phone: '355691111111' })],
      customers: [{ id: 'c', name: 'C', phone: '355692222222' }],
      now: NOW,
    };
    expect(evaluateWaSegment({ ...input, segment: { audience: ['customers'] } }).targets.map((t) => t.contact.id)).toEqual(['c']);
    expect(evaluateWaSegment({ ...input, segment: { audience: ['leads'] } }).targets.map((t) => t.contact.id)).toEqual(['l']);
    // No audience given → leads, matching the cron default.
    expect(evaluateWaSegment({ ...input, segment: {} }).targets.map((t) => t.contact.id)).toEqual(['l']);
  });

  it('reports the dailyCap batch WITHOUT hiding how many qualify', () => {
    const leads = Array.from({ length: 10 }, (_, i) => lead({ id: `l${i}`, phone: `35569000000${i}` }));
    const res = evaluateWaSegment({ leads, segment: { audience: ['leads'] }, conditions: { dailyCap: 3 }, now: NOW });
    expect(res.targets).toHaveLength(10);   // all 10 qualify…
    expect(res.sendableNow).toBe(3);        // …3 go out in the next run
  });

  it('sendableNow equals the target count when there is no cap', () => {
    const leads = Array.from({ length: 4 }, (_, i) => lead({ id: `l${i}`, phone: `35569000000${i}` }));
    const res = evaluateWaSegment({ leads, segment: { audience: ['leads'] }, now: NOW });
    expect(res.sendableNow).toBe(4);
  });

  it('uses the fallback body when no variants are configured', () => {
    const res = evaluateWaSegment({
      leads: [lead()], segment: {}, fallbackBody: 'Ciao {{name}}',
      defaultLandingUrl: 'https://fivocrm.com/info', now: NOW,
    });
    expect(res.targets[0].message).toBe('Ciao Ardit\n\nhttps://fivocrm.com/info');
  });
});

describe('validateWaCampaign', () => {
  it('demands text', () => {
    expect(validateWaCampaign({})).toContain('Shto të paktën një tekst (variant) ose zgjidh një template.');
    expect(validateWaCampaign({ templateId: 't1' })).toEqual([]);
    expect(validateWaCampaign({ variants: [{ id: 'v', tags: [], body: 'hi' }] })).toEqual([]);
  });

  it('rejects a landing URL without a scheme', () => {
    const errs = validateWaCampaign({ variants: [{ id: 'v', label: 'SEO', tags: [], body: 'x', landingUrl: 'fivocrm.com' }] });
    expect(errs.join()).toContain('http(s)://');
  });

  it('rejects an inverted or negative day window', () => {
    expect(validateWaCampaign({ templateId: 't', conditions: { lastContactMinDays: 90, lastContactMaxDays: 30 } }).join())
      .toContain('më i vogël');
    expect(validateWaCampaign({ templateId: 't', conditions: { lastContactMinDays: -5 } }).join())
      .toContain('numër pozitiv');
  });

  it('requires a dormancy threshold and a cap on an evergreen automation', () => {
    const errs = validateWaCampaign({ templateId: 't', trigger: 'dormant', conditions: {} });
    expect(errs.join()).toContain('Të pakontaktuar prej');
    expect(errs.join()).toContain('limit ditor');
    expect(validateWaCampaign({ templateId: 't', trigger: 'dormant', conditions: { lastContactMinDays: 30, dailyCap: 20 } })).toEqual([]);
  });
});
