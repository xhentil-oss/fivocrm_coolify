/**
 * @vitest-environment node
 *
 * Node, not jsdom: the drift guard reads the api mirrors off disk.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SALES_AGENT_DEFAULTS, SALES_AGENT_MAX_AUTONOMY, SALES_AGENT_LIMITS,
  resolveSalesAgentSettings, agentGateReason, decideDelivery, parseAgentOutput, sanitizeAgentReply,
  detectHandoffTrigger, qualificationProgress, mergeCollected, nextStage, leadAgentScore, buildLeadSummary,
  buildSalesAgentPrompt, renderSalesFacts, ensureDisclosure, renderTemplate, ensureColdWaCompliance,
  coldWaDailyQuota, coldWaBlockReason, coldWaPauseAfterFailure, nudgeBlockReason, buildNudgeText,
  handoffOverdue, buildSalesDigest, inWindow, localParts, salesAgentRunId, allowedIntentsForAutonomy,
  SALES_AGENT_BLOCK_LABELS, COLD_WA_BLOCK_LABELS, HANDOFF_LABELS,
  type SalesAgentSettings, type AgentModelOutput, type DeliveryInput, type ColdWaGateInput, type SalesFacts,
} from './core';

const ROOT = resolve(__dirname, '../../..');
const TZ = 'Europe/Tirane';

describe('api mirror', () => {
  it('api/_salesAgentCore.ts is byte-identical to the canonical core', () => {
    const canonical = readFileSync(resolve(ROOT, 'src/lib/salesAgent/core.ts'), 'utf8');
    const mirror = readFileSync(resolve(ROOT, 'api/_salesAgentCore.ts'), 'utf8');
    expect(mirror).toBe(canonical);
  });
  it('api/_salesAgentProspecting.ts is byte-identical to prospecting.ts', () => {
    const canonical = readFileSync(resolve(ROOT, 'src/lib/salesAgent/prospecting.ts'), 'utf8');
    const mirror = readFileSync(resolve(ROOT, 'api/_salesAgentProspecting.ts'), 'utf8');
    expect(mirror).toBe(canonical);
  });
  it('core and prospecting are import-free', () => {
    for (const f of ['src/lib/salesAgent/core.ts', 'src/lib/salesAgent/prospecting.ts']) {
      const src = readFileSync(resolve(ROOT, f), 'utf8');
      expect(/^\s*import\s/m.test(src)).toBe(false);
    }
  });
});

const settings = (over: Partial<SalesAgentSettings> = {}): SalesAgentSettings => ({
  ...SALES_AGENT_DEFAULTS,
  enabled: true,
  persona: { ...SALES_AGENT_DEFAULTS.persona, businessName: 'Bos Marketing' },
  ...over,
});

describe('resolveSalesAgentSettings', () => {
  it('fills defaults, clamps, and caps autonomy at the platform maximum', () => {
    const s = resolveSalesAgentSettings({ enabled: true, autonomy: 3, persona: { name: '  Ana ', languages: ['SQ', 'en', 'it', 'de', 'fr', 'es'] }, coldWa: { enabled: true, perDay: 50, minGapMinutes: 5 }, dailyReplyCap: 99999 });
    expect(s.enabled).toBe(true);
    expect(s.autonomy).toBe(SALES_AGENT_MAX_AUTONOMY);
    expect(s.persona.name).toBe('Ana');
    expect(s.persona.languages).toEqual(['sq', 'en', 'it', 'de', 'fr']);
    expect(s.coldWa.perDay).toBe(SALES_AGENT_LIMITS.coldWaPerDayMax);
    expect(s.coldWa.minGapMinutes).toBe(SALES_AGENT_LIMITS.coldWaMinGapMinutesMin);
    expect(s.dailyReplyCap).toBe(SALES_AGENT_LIMITS.dailyReplyCapMax);
  });
  it('never throws on garbage and keeps the default template', () => {
    const s = resolveSalesAgentSettings('nope');
    expect(s.enabled).toBe(false);
    expect(s.autonomy).toBe(0);
    expect(s.coldWa.template).toContain('{{agent}}');
    expect(s.qualificationFields).toEqual(SALES_AGENT_DEFAULTS.qualificationFields);
  });
  it('a platform flag may raise the cap', () => {
    expect(resolveSalesAgentSettings({ autonomy: 3 }, { maxAutonomy: 3 }).autonomy).toBe(3);
  });
});

describe('agentGateReason (before any model call)', () => {
  const base = {
    settings: settings(), channel: 'whatsapp' as const, hasAiKey: true, hasText: true, optedOut: false, isPerson: true,
    agentState: null, replyToAutomated: false, repliesToday: 0, now: new Date('2026-11-03T09:00:00Z'),
  };
  it('passes a normal inbound', () => expect(agentGateReason(base)).toBeNull());
  it('names every block', () => {
    expect(agentGateReason({ ...base, settings: settings({ enabled: false }) })).toBe('module-off');
    expect(agentGateReason({ ...base, settings: settings({ channels: { ...base.settings.channels, whatsapp: false } }) })).toBe('channel-off');
    expect(agentGateReason({ ...base, isPerson: false })).toBe('not-a-person');
    expect(agentGateReason({ ...base, hasText: false })).toBe('no-text');
    expect(agentGateReason({ ...base, optedOut: true })).toBe('opted-out');
    expect(agentGateReason({ ...base, agentState: { active: false, stage: 'handoff', lastReplyAt: null, lastDraftAt: null } })).toBe('handoff-active');
    expect(agentGateReason({ ...base, agentState: { active: true, stage: 'closed', lastReplyAt: null, lastDraftAt: null } })).toBe('closed');
    expect(agentGateReason({ ...base, replyToAutomated: true })).toBe('reply-to-automated');
    expect(agentGateReason({ ...base, hasAiKey: false })).toBe('no-ai-key');
    expect(agentGateReason({ ...base, repliesToday: 200 })).toBe('daily-cap');
    expect(agentGateReason({ ...base, agentState: { active: true, stage: 'qualifying', lastReplyAt: new Date(base.now.getTime() - 10_000), lastDraftAt: null } })).toBe('burst');
  });
  it('every block reason has an Albanian label', () => {
    for (const k of Object.keys(SALES_AGENT_BLOCK_LABELS)) expect(SALES_AGENT_BLOCK_LABELS[k as keyof typeof SALES_AGENT_BLOCK_LABELS].length).toBeGreaterThan(5);
    for (const k of Object.keys(COLD_WA_BLOCK_LABELS)) expect(COLD_WA_BLOCK_LABELS[k as keyof typeof COLD_WA_BLOCK_LABELS].length).toBeGreaterThan(5);
    for (const k of Object.keys(HANDOFF_LABELS)) expect(HANDOFF_LABELS[k as keyof typeof HANDOFF_LABELS].length).toBeGreaterThan(5);
  });
});

describe('parseAgentOutput', () => {
  it('reads clean JSON', () => {
    const o = parseAgentOutput('{"reply":"Po, ofrojmë SEO.","intent":"question","confidence":0.92,"collected":{"service":"SEO"},"priceFromFacts":true,"handoff":null,"language":"sq"}');
    expect(o.intent).toBe('question');
    expect(o.confidence).toBeCloseTo(0.92);
    expect(o.collected.service).toBe('SEO');
    expect(o.priceFromFacts).toBe(true);
  });
  it('reads fenced JSON and clamps confidence', () => {
    const o = parseAgentOutput('```json\n{"reply":"Ok","intent":"answer","confidence":7}\n```');
    expect(o.intent).toBe('answer');
    expect(o.confidence).toBe(1);
  });
  it('a bare sentence becomes a low-confidence draft, never a crash', () => {
    const o = parseAgentOutput('Përshëndetje, si mund t\'ju ndihmoj?');
    expect(o.reply).toContain('Përshëndetje');
    expect(o.intent).toBe('other');
    expect(o.confidence).toBeLessThan(0.4);
  });
  it('unknown intent / handoff values are discarded', () => {
    const o = parseAgentOutput('{"reply":"x","intent":"hack","handoff":"drop-tables","collected":{"evil":"1","budget":"500€"}}');
    expect(o.intent).toBe('other');
    expect(o.handoff).toBeNull();
    expect(o.collected).toEqual({ budget: '500€' });
  });
});

describe('sanitizeAgentReply', () => {
  it('strips markdown and caps at 400 chars on a sentence boundary', () => {
    const long = ('Kjo është një fjali e gjatë që përsëritet. ').repeat(20);
    const out = sanitizeAgentReply(`**${long}**`);
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out.endsWith('.')).toBe(true);
    expect(out).not.toContain('*');
  });
});

describe('decideDelivery', () => {
  const out = (over: Partial<AgentModelOutput> = {}): AgentModelOutput => ({
    reply: 'Po, ofrojmë SEO lokal.', intent: 'question', confidence: 0.9, collected: {}, priceFromFacts: true, handoff: null, language: 'sq', ...over,
  });
  const input = (over: Partial<DeliveryInput> = {}): DeliveryInput => ({
    settings: settings({ autonomy: 2 }), output: out(), trigger: null, clientText: 'A bëni SEO?', insideOfficeHours: false,
    minutesSinceHumanReply: null, minutesSinceInbound: 0, turnsWithoutProgress: 0, progressed: true, ...over,
  });
  it('level 2 sends a confident FAQ answer', () => {
    expect(decideDelivery(input())).toEqual({ mode: 'send', blockReason: null, handoffReason: null });
  });
  it('level 0 always drafts', () => {
    expect(decideDelivery(input({ settings: settings({ autonomy: 0 }) })).blockReason).toBe('autonomy-draft');
  });
  it('a deterministic trigger beats everything', () => {
    expect(decideDelivery(input({ trigger: 'complaint' })).handoffReason).toBe('complaint');
    expect(detectHandoffTrigger('Dua të flas me një njeri')).toBe('asked-for-human');
    expect(detectHandoffTrigger('Kam një ankesë për faturën')).toBe('complaint');
    expect(detectHandoffTrigger('Ju dërgoj numrin e kartës së kreditit')).toBe('sensitive-topic');
    expect(detectHandoffTrigger('Sa kushton SEO?')).toBeNull();
  });
  it('a price not backed by facts, or a discount ask, is a handoff — never an invented figure', () => {
    expect(decideDelivery(input({ output: out({ intent: 'price', priceFromFacts: false }) })).handoffReason).toBe('custom-price');
    expect(decideDelivery(input({ clientText: 'A bëni ndonjë zbritje?' })).handoffReason).toBe('custom-price');
  });
  it('level 1 inside office hours waits for a human; outside it answers', () => {
    const s = settings({ autonomy: 1 });
    expect(decideDelivery(input({ settings: s, insideOfficeHours: true, minutesSinceInbound: 2 })).blockReason).toBe('inside-hours-human');
    expect(decideDelivery(input({ settings: s, insideOfficeHours: true, minutesSinceInbound: 15, minutesSinceHumanReply: 5 })).blockReason).toBe('inside-hours-human');
    expect(decideDelivery(input({ settings: s, insideOfficeHours: true, minutesSinceInbound: 15, minutesSinceHumanReply: 600 })).mode).toBe('send');
    expect(decideDelivery(input({ settings: s, insideOfficeHours: false })).mode).toBe('send');
  });
  it('level 1 never sends a qualification answer or a booking', () => {
    const s = settings({ autonomy: 1 });
    expect(decideDelivery(input({ settings: s, output: out({ intent: 'booking' }) })).blockReason).toBe('intent-not-allowed');
    expect(allowedIntentsForAutonomy(1).has('answer')).toBe(false);
    expect(allowedIntentsForAutonomy(2).has('booking')).toBe(true);
  });
  it('confidence bands: < 0.4 handoff, < 0.8 draft', () => {
    expect(decideDelivery(input({ output: out({ confidence: 0.3 }) })).handoffReason).toBe('low-confidence');
    expect(decideDelivery(input({ output: out({ confidence: 0.6 }) })).blockReason).toBe('low-confidence');
  });
  it('too many turns without progress hands off', () => {
    expect(decideDelivery(input({ progressed: false, turnsWithoutProgress: 5 })).handoffReason).toBe('no-progress');
    expect(decideDelivery(input({ progressed: false, turnsWithoutProgress: 2 })).mode).toBe('send');
  });
  it('an unsupported language hands off; opt-out is silent', () => {
    expect(decideDelivery(input({ output: out({ language: 'zh' }) })).handoffReason).toBe('unsupported-language');
    expect(decideDelivery(input({ output: out({ intent: 'opt-out' }) })).mode).toBe('silent');
  });
});

describe('qualification', () => {
  const fields = SALES_AGENT_DEFAULTS.qualificationFields;
  it('tracks progress and the next question in order', () => {
    const c = mergeCollected(null, { service: 'Website', budget: '500-800 €' });
    const p = qualificationProgress(c, fields);
    expect(p.answered).toEqual(['service', 'budget']);
    expect(p.nextField).toBe('city');
    expect(p.qualified).toBe(false);
    const p2 = qualificationProgress(mergeCollected(c, { city: 'Tiranë' }), fields);
    expect(p2.qualified).toBe(true);
  });
  it('mergeCollected ignores blanks and unknown keys and keeps earlier answers', () => {
    const c = mergeCollected({ service: 'SEO' }, { service: '  ', timeline: 'këtë muaj', ...( { evil: 'x' } as any) });
    expect(c).toEqual({ service: 'SEO', timeline: 'këtë muaj' });
  });
  it('stage machine', () => {
    const send = { mode: 'send' as const, blockReason: null, handoffReason: null };
    const notQ = qualificationProgress({}, fields);
    const q = qualificationProgress({ service: 'a', city: 'b', timeline: 'c' }, fields);
    expect(nextStage('greeting', { decision: send, intent: 'question', progress: notQ, autonomy: 2 })).toBe('qualifying');
    expect(nextStage('qualifying', { decision: send, intent: 'answer', progress: q, autonomy: 2 })).toBe('proposing');
    expect(nextStage('proposing', { decision: send, intent: 'booking', progress: q, autonomy: 2 })).toBe('booking');
    expect(nextStage('qualifying', { decision: { mode: 'handoff', blockReason: null, handoffReason: 'complaint' }, intent: 'complaint', progress: q, autonomy: 2 })).toBe('handoff');
    expect(nextStage('greeting', { decision: send, intent: 'question', progress: notQ, autonomy: 1 })).toBe('greeting');
    expect(nextStage('closed', { decision: send, intent: 'question', progress: q, autonomy: 2 })).toBe('closed');
  });
  it('score and summary are deterministic', () => {
    const c = { service: 'Website', city: 'Durrës', timeline: 'këtë muaj', budget: '1000 €', decisionMaker: 'po, unë' };
    expect(leadAgentScore(c, fields)).toBe(100);
    expect(leadAgentScore({ service: 'x' }, fields)).toBe(12);
    const s = buildLeadSummary('Arben', c);
    expect(s.split('\n')).toHaveLength(3);
    expect(s).toContain('Website');
    expect(s).toContain('1000 €');
  });
});

describe('prompt & facts', () => {
  const facts: SalesFacts = {
    businessName: 'Bos Marketing', officeHours: 'Hën–Pre 09:00–18:00', about: 'Agjenci marketingu',
    services: [{ name: 'SEO lokal', category: 'SEO', price: 300, currency: 'EUR', unit: 'muaj' }, { name: 'Website', price: null }],
    knowledge: [{ kind: 'faq', question: 'Sa zgjat?', answer: '4 javë' }, { kind: 'objection', question: 'Shtrenjtë', answer: 'Krahaso me 1 klient të ri' }],
  };
  it('renders prices only from the catalogue and says so', () => {
    const r = renderSalesFacts(facts);
    expect(r).toContain('SEO lokal [SEO]: 300 EUR/muaj');
    expect(r).toContain('Website: çmimi me ofertë');
    expect(r).toContain('OBJEKSIONEVE');
  });
  it('the prompt carries persona, disclosure, rules, facts and the JSON contract', () => {
    const p = buildSalesAgentPrompt({
      settings: settings({ autonomy: 2 }), facts, contactName: 'Arben', contactKind: 'lead', leadStatus: 'New', stage: 'qualifying',
      collected: { service: 'SEO' }, channel: 'whatsapp', nowLabel: 'e hënë, 3 nëntor 2026, 10:15', isFirstAgentMessage: true,
    });
    expect(p).toContain('Ti je Ana, asistentja virtuale e shitjeve e Bos Marketing');
    expect(p).toContain('Prezantohu në fjalinë e parë');
    expect(p).toContain('KURRË mos shpik çmim');
    expect(p).toContain('300 EUR/muaj');
    expect(p).toContain('Qyteti / sektori');
    expect(p).toContain('"priceFromFacts"');
  });
  it('level < 2 never asks qualification questions', () => {
    const p = buildSalesAgentPrompt({
      settings: settings({ autonomy: 1 }), facts, contactName: '', contactKind: 'unknown', stage: 'greeting',
      collected: {}, channel: 'whatsapp', nowLabel: 'x', isFirstAgentMessage: false,
    });
    expect(p).toContain('MOS bëj pyetje kualifikimi');
  });
  it('ensureDisclosure adds the intro once, only on the first message', () => {
    const persona = settings().persona;
    expect(ensureDisclosure('Po, bëjmë SEO.', persona, 'Bos Marketing', true)).toBe('Jam Ana, asistentja virtuale e Bos Marketing. Po, bëjmë SEO.');
    expect(ensureDisclosure('Jam Ana, asistentja virtuale e Bos Marketing. Po.', persona, 'Bos Marketing', true)).toBe('Jam Ana, asistentja virtuale e Bos Marketing. Po.');
    expect(ensureDisclosure('Po, bëjmë SEO.', persona, 'Bos Marketing', false)).toBe('Po, bëjmë SEO.');
  });
});

describe('templates & cold WhatsApp', () => {
  it('renderTemplate: unknown token renders empty', () => {
    expect(renderTemplate('Hi {{name}} from {{business}} {{foo}}!', { name: 'Arben', business: 'Bos' })).toBe('Hi Arben from Bos!');
  });
  it('ensureColdWaCompliance adds disclosure + NDALO exactly when missing', () => {
    const persona = settings().persona;
    const t = ensureColdWaCompliance('A keni 10 minuta?', persona);
    expect(t).toContain('Jam Ana, asistentja virtuale e Bos Marketing');
    expect(t).toContain('NDALO');
    expect(ensureColdWaCompliance(t, persona)).toBe(t);
  });
  it('quota: warm-up, halved after 1 failure, 0 after 2', () => {
    const now = new Date('2026-11-03T10:00:00Z');
    const cold = settings().coldWa;
    expect(coldWaDailyQuota({ settings: cold, senderWarmupStartedAt: null, failures24h: 0, now })).toBe(3);
    const old = new Date(now.getTime() - 30 * 86_400_000);
    expect(coldWaDailyQuota({ settings: cold, senderWarmupStartedAt: old, failures24h: 0, now })).toBe(10);
    expect(coldWaDailyQuota({ settings: cold, senderWarmupStartedAt: old, failures24h: 1, now })).toBe(5);
    expect(coldWaDailyQuota({ settings: cold, senderWarmupStartedAt: old, failures24h: 2, now })).toBe(0);
    expect(coldWaPauseAfterFailure(1, now)).toBeNull();
    expect(coldWaPauseAfterFailure(2, now)?.getTime()).toBe(now.getTime() + 7 * 86_400_000);
  });
  it('coldWaBlockReason enforces law 7 in order', () => {
    const now = new Date('2026-11-03T10:00:00Z'); // Tuesday 11:00 Tirane
    const old = new Date(now.getTime() - 30 * 86_400_000);
    const base: ColdWaGateInput = {
      settings: { ...settings().coldWa, enabled: true }, senderWarmupStartedAt: old, failures24h: 0, now, timeZone: TZ,
      senderAgentId: 'acc1', pausedUntil: null, sentTodayBySender: 0, lastSentAtBySender: null,
      prospect: { phone: '355691234567', waVerified: true, optedOut: false, registeredAt: old, contactedAt: null },
    };
    expect(coldWaBlockReason(base)).toBeNull();
    expect(coldWaBlockReason({ ...base, settings: { ...base.settings, enabled: false } })).toBe('cold-wa-off');
    expect(coldWaBlockReason({ ...base, pausedUntil: new Date(now.getTime() + 1000) })).toBe('cold-wa-paused');
    expect(coldWaBlockReason({ ...base, senderAgentId: null })).toBe('no-sender');
    expect(coldWaBlockReason({ ...base, prospect: { ...base.prospect, phone: null } })).toBe('no-phone');
    expect(coldWaBlockReason({ ...base, prospect: { ...base.prospect, waVerified: false } })).toBe('not-on-whatsapp');
    expect(coldWaBlockReason({ ...base, prospect: { ...base.prospect, optedOut: true } })).toBe('opted-out');
    expect(coldWaBlockReason({ ...base, prospect: { ...base.prospect, contactedAt: old } })).toBe('already-contacted');
    expect(coldWaBlockReason({ ...base, prospect: { ...base.prospect, registeredAt: now } })).toBe('same-day-registration');
    expect(coldWaBlockReason({ ...base, now: new Date('2026-11-01T10:00:00Z') })).toBe('weekend');
    expect(coldWaBlockReason({ ...base, now: new Date('2026-11-03T20:30:00Z') })).toBe('outside-window');
    expect(coldWaBlockReason({ ...base, sentTodayBySender: 10 })).toBe('quota-reached');
    expect(coldWaBlockReason({ ...base, failures24h: 2 })).toBe('budget-exhausted');
    expect(coldWaBlockReason({ ...base, lastSentAtBySender: new Date(now.getTime() - 30 * 60_000) })).toBe('min-gap');
    expect(coldWaBlockReason({ ...base, lastSentAtBySender: new Date(now.getTime() - 61 * 60_000) })).toBeNull();
    // A fresh number is capped by the warm-up, not the per-day setting.
    expect(coldWaBlockReason({ ...base, senderWarmupStartedAt: null, sentTodayBySender: 3 })).toBe('quota-reached');
  });
});

describe('nudges, SLA, digest', () => {
  const now = new Date('2026-11-03T10:00:00Z');
  const agent = { active: true, stage: 'qualifying' as const, collected: {}, turns: 2, turnsWithoutProgress: 0, lastReplyAt: null, lastDraftAt: null, nudgesSent: 0, lastNudgeAt: null };
  it('nudge rules', () => {
    const lastOut = new Date(now.getTime() - 30 * 3_600_000);
    expect(nudgeBlockReason({ settings: settings(), agent, lastInboundAt: new Date(lastOut.getTime() - 1000), lastOutboundAt: lastOut, now, timeZone: TZ })).toBeNull();
    expect(nudgeBlockReason({ settings: settings(), agent: { ...agent, active: false }, lastInboundAt: null, lastOutboundAt: lastOut, now, timeZone: TZ })).toBe('agent-inactive');
    expect(nudgeBlockReason({ settings: settings(), agent: { ...agent, stage: 'handoff' }, lastInboundAt: null, lastOutboundAt: lastOut, now, timeZone: TZ })).toBe('not-qualifying');
    expect(nudgeBlockReason({ settings: settings(), agent: { ...agent, nudgesSent: 2 }, lastInboundAt: null, lastOutboundAt: lastOut, now, timeZone: TZ })).toBe('max-nudges');
    expect(nudgeBlockReason({ settings: settings(), agent, lastInboundAt: now, lastOutboundAt: lastOut, now, timeZone: TZ })).toBe('client-replied');
    expect(nudgeBlockReason({ settings: settings(), agent, lastInboundAt: null, lastOutboundAt: new Date(now.getTime() - 3_600_000), now, timeZone: TZ })).toBe('too-soon');
    const sunday = new Date('2026-11-01T10:00:00Z');
    expect(nudgeBlockReason({ settings: settings(), agent, lastInboundAt: null, lastOutboundAt: new Date(sunday.getTime() - 30 * 3_600_000), now: sunday, timeZone: TZ })).toBe('quiet-hours');
  });
  it('nudge text is polite and the second one closes the door', () => {
    const p = qualificationProgress({ service: 'SEO' }, SALES_AGENT_DEFAULTS.qualificationFields);
    expect(buildNudgeText(settings().persona, 'Arben Hoxha', 0, p)).toContain('Ana këtu');
    expect(buildNudgeText(settings().persona, 'Arben Hoxha', 1, p)).toContain('nuk dua t\'ju bezdis');
  });
  it('handoff SLA', () => {
    expect(handoffOverdue(new Date(now.getTime() - 31 * 60_000), null, 30, now)).toBe(true);
    expect(handoffOverdue(new Date(now.getTime() - 10 * 60_000), null, 30, now)).toBe(false);
    expect(handoffOverdue(new Date(now.getTime() - 90 * 60_000), now, 30, now)).toBe(false);
  });
  it('digest: silence when nothing happened, otherwise handoffs first', () => {
    const empty = { date: '2026-11-03', prospectsNew: 0, prospectsRegistered: 0, conversationsHeld: 0, qualified: [], meetingsBooked: 0, handoffsOpen: [], coldWaSent: 0, coldEmailSent: 0, blocked: {}, aiCalls: 0, placesRequests: 0 };
    expect(buildSalesDigest(empty, settings().persona)).toBeNull();
    const d = buildSalesDigest({ ...empty, conversationsHeld: 3, handoffsOpen: [{ name: 'Arben', reason: 'custom-price', minutesOpen: 125 }], blocked: { 'daily-cap': 2 } }, settings().persona)!;
    expect(d.split('\n')[1]).toContain('presin një person');
    expect(d).toContain('Kërkoi çmim të personalizuar');
    expect(d).toContain('Kuota ditore');
  });
});

describe('time helpers', () => {
  it('inWindow handles wrap-around', () => {
    expect(inWindow('10:00', '09:00', '19:00')).toBe(true);
    expect(inWindow('19:00', '09:00', '19:00')).toBe(false);
    expect(inWindow('23:00', '22:00', '02:00')).toBe(true);
    expect(inWindow('03:00', '22:00', '02:00')).toBe(false);
  });
  it('localParts is zone-explicit', () => {
    const p = localParts(new Date('2026-11-03T10:00:00Z'), TZ);
    expect(p).toMatchObject({ date: '2026-11-03', hhmm: '11:00', weekday: 2 });
  });
  it('run ids are deterministic and safe', () => {
    expect(salesAgentRunId('biz', 'reply', 'wa-t1-355691234567', 'ABC/123')).toBe('biz_reply_wa-t1-355691234567_ABC-123');
  });
});
