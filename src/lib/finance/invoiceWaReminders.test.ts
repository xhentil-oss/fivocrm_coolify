/**
 * @vitest-environment node
 *
 * Node, not jsdom: the drift guard reads `api/_invoiceWaReminders.ts` off disk.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_INVOICE_WA_TEXT,
  INVOICE_WA_DEFAULTS,
  INVOICE_WA_BLOCK_LABELS,
  daysLateOn,
  formatInvoiceWaAmount,
  invoiceMatchesSource,
  invoiceWaDecision,
  invoiceWaDueText,
  invoiceWaFirstName,
  invoiceWaIdempotencyKey,
  invoiceWaTemplateParams,
  invoiceEmailUsable,
  coversWhmcs,
  INVOICE_WA_PARAM_FIELDS,
  invoiceWaStage,
  invoiceWaStageField,
  localHourIn,
  normalizeInvoiceWaPhone,
  renderInvoiceWaText,
  resolveInvoiceWaConfig,
  tallyInvoiceWaBlocked,
  type InvoiceWaConfig,
  type InvoiceWaInvoiceFacts,
} from './invoiceWaReminders';

const TZ = 'Europe/Tirane';
const DAY = 86_400_000;
// Monday 2026-09-14 12:00 local (10:00Z, CEST).
const NOW = Date.parse('2026-09-14T10:00:00Z');
const dueIn = (days: number) => NOW + days * DAY;

const cfg = (over: Partial<InvoiceWaConfig> = {}): InvoiceWaConfig => ({
  ...INVOICE_WA_DEFAULTS,
  enabled: true,
  channel: 'baileys',
  // The fixtures are WHMCS invoices; the legacy-stage tests run without the cadence.
  whmcsCadence: false,
  ...over,
});
const inv = (over: Partial<InvoiceWaInvoiceFacts> = {}): InvoiceWaInvoiceFacts => ({
  status: 'Pending',
  source: 'whmcs',
  dueDateMs: dueIn(-70),
  total: 12_000,
  paidAmount: 0,
  ...over,
});
const customer = { phone: '+355 69 123 4567', waOptOut: false, disableOverdueReminders: false };
const ctx = (over: Partial<Parameters<typeof invoiceWaDecision>[3]> = {}) => ({ nowMs: NOW, timeZone: TZ, hasChannel: true, hasTemplate: true, ...over });

describe('api mirror', () => {
  it('api/_invoiceWaReminders.ts is byte-identical to the canonical module', () => {
    const root = resolve(__dirname, '../../..');
    const canonical = readFileSync(resolve(root, 'src/lib/finance/invoiceWaReminders.ts'), 'utf8');
    const mirror = readFileSync(resolve(root, 'api/_invoiceWaReminders.ts'), 'utf8');
    expect(mirror).toBe(canonical);
  });
});

describe('resolveInvoiceWaConfig', () => {
  it('returns the defaults for nothing / {} (disabled, Meta, day 4, every 7 days, max 3, 09–19)', () => {
    expect(resolveInvoiceWaConfig(null)).toEqual(INVOICE_WA_DEFAULTS);
    expect(resolveInvoiceWaConfig({})).toEqual(INVOICE_WA_DEFAULTS);
    // "More than 3 days late" = day 4; then weekly, three times, then staff.
    expect([INVOICE_WA_DEFAULTS.overdueDays, INVOICE_WA_DEFAULTS.renotifyDays, INVOICE_WA_DEFAULTS.overdueMaxSends]).toEqual([4, 7, 3]);
  });
  it('reads the legacy waOverdue* keys AND the new waInvoice* keys', () => {
    const c = resolveInvoiceWaConfig({
      waOverdueEnabled: true, waOverdueDays: '30', waOverdueTemplateId: 't1', waOverdueChannelPhoneNumberId: 'p1',
      waInvoiceSources: 'whmcs', waInvoiceChannel: 'baileys', waInvoiceAgentId: ' a1 ', waInvoiceText: 'Hi {{name}}',
      waInvoicePreDueDays: 3, waInvoiceOnDue: true, waInvoiceRenotifyDays: 7, waInvoiceHourStart: 8, waInvoiceHourEnd: 20,
      overdueEmailSkipWhmcs: true, waOverdueMaxSends: '5',
    });
    expect(c).toEqual({
      enabled: true, sources: 'whmcs', channel: 'baileys', agentId: 'a1', text: 'Hi {{name}}', templateId: 't1',
      channelPhoneNumberId: 'p1', preDueDays: 3, onDue: true, overdueDays: 30, renotifyDays: 7, overdueMaxSends: 5, hourStart: 8, hourEnd: 20,
      emailSkipWhmcs: true,
      whmcsCadence: true, whmcsWindowDays: 20, whmcsEveryDays: 5, whmcsUrgentDays: 10, whmcsUrgentEveryDays: 2,
    });
  });
  it('an invalid value falls back individually, never resetting its neighbours', () => {
    const c = resolveInvoiceWaConfig({ waOverdueDays: 0, waInvoicePreDueDays: 99, waInvoiceRenotifyDays: 'x', waInvoiceSources: 'bogus', waInvoiceChannel: 'sms', waOverdueMaxSends: 11 });
    expect(c.overdueDays).toBe(4);
    expect(c.preDueDays).toBe(0);
    expect(c.renotifyDays).toBe(7);
    expect(c.overdueMaxSends).toBe(3);
    expect(resolveInvoiceWaConfig({ waOverdueMaxSends: 0 }).overdueMaxSends).toBe(3);
    expect(c.sources).toBe('all');
    expect(c.channel).toBe('meta');
  });
  it('a zero-width send window is widened to one hour instead of silently sending nothing', () => {
    const c = resolveInvoiceWaConfig({ waInvoiceHourStart: 10, waInvoiceHourEnd: 10 });
    expect([c.hourStart, c.hourEnd]).toEqual([10, 11]);
  });
});

describe('zone-aware day math', () => {
  it('daysLateOn counts calendar days in Europe/Tirane, not 24h blocks', () => {
    // Due 2026-09-13 23:30 local (21:30Z); now is 12:00 local on the 14th → 1 day late,
    // although fewer than 24h have passed.
    const due = Date.parse('2026-09-13T21:30:00Z');
    expect(daysLateOn(due, NOW, TZ)).toBe(1);
    expect(daysLateOn(NOW, NOW, TZ)).toBe(0);
    expect(daysLateOn(dueIn(3), NOW, TZ)).toBe(-3);
  });
  it('localHourIn reads the wall clock in the zone (CEST = UTC+2)', () => {
    expect(localHourIn(TZ, NOW)).toBe(12);
    expect(localHourIn(TZ, Date.parse('2026-09-14T01:00:00Z'))).toBe(3);
  });
});

describe('invoiceWaStage', () => {
  it('overdue: fires once daysLate >= overdueDays, then every renotifyDays', () => {
    const c = cfg({ overdueDays: 60, renotifyDays: 14 });
    expect(invoiceWaStage(inv({ dueDateMs: dueIn(-59) }), c, ctx())).toEqual({ ok: false, reason: 'not-due' });
    expect(invoiceWaStage(inv({ dueDateMs: dueIn(-60) }), c, ctx())).toEqual({ ok: true, stage: 'overdue', daysLate: 60 });
    expect(invoiceWaStage(inv({ dueDateMs: dueIn(-70), overdueWaSentAtMs: NOW - 5 * DAY }), c, ctx())).toEqual({ ok: false, reason: 'already-sent' });
    expect(invoiceWaStage(inv({ dueDateMs: dueIn(-70), overdueWaSentAtMs: NOW - 14 * DAY }), c, ctx())).toEqual({ ok: true, stage: 'overdue', daysLate: 70 });
  });
  it('due: only when onDue is set, and only once', () => {
    expect(invoiceWaStage(inv({ dueDateMs: NOW }), cfg(), ctx())).toEqual({ ok: false, reason: 'not-due' });
    expect(invoiceWaStage(inv({ dueDateMs: NOW }), cfg({ onDue: true }), ctx())).toEqual({ ok: true, stage: 'due', daysLate: 0 });
    expect(invoiceWaStage(inv({ dueDateMs: NOW, dueWaSentAtMs: NOW - DAY }), cfg({ onDue: true }), ctx())).toEqual({ ok: false, reason: 'already-sent' });
  });
  it('pre-due: inside the window, once; 0 = off', () => {
    expect(invoiceWaStage(inv({ dueDateMs: dueIn(2) }), cfg({ preDueDays: 0 }), ctx())).toEqual({ ok: false, reason: 'not-due' });
    expect(invoiceWaStage(inv({ dueDateMs: dueIn(4) }), cfg({ preDueDays: 3 }), ctx())).toEqual({ ok: false, reason: 'not-due' });
    expect(invoiceWaStage(inv({ dueDateMs: dueIn(3) }), cfg({ preDueDays: 3 }), ctx())).toEqual({ ok: true, stage: 'pre-due', daysLate: -3 });
    expect(invoiceWaStage(inv({ dueDateMs: dueIn(2), preDueWaSentAtMs: NOW - DAY }), cfg({ preDueDays: 3 }), ctx())).toEqual({ ok: false, reason: 'already-sent' });
  });
  it('no due date is a named reason', () => {
    expect(invoiceWaStage(inv({ dueDateMs: null }), cfg(), ctx())).toEqual({ ok: false, reason: 'no-due-date' });
  });
});

describe('WHMCS pre-due cadence (20 ditë → çdo 5, ≤10 → çdo 2)', () => {
  const c = cfg({ whmcsCadence: true });
  // Sent at 18:00 local `daysAgo` calendar days before NOW (12:00 local).
  const sentDaysAgo = (n: number) => Date.parse('2026-09-14T16:00:00Z') - n * DAY;

  it('is on by default with 20 / 5 / 10 / 2, and the urgent band never exceeds the window', () => {
    const d = resolveInvoiceWaConfig({});
    expect([d.whmcsCadence, d.whmcsWindowDays, d.whmcsEveryDays, d.whmcsUrgentDays, d.whmcsUrgentEveryDays]).toEqual([true, 20, 5, 10, 2]);
    expect(resolveInvoiceWaConfig({ waWhmcsCadenceEnabled: false }).whmcsCadence).toBe(false);
    expect(resolveInvoiceWaConfig({ waWhmcsWindowDays: 7, waWhmcsUrgentDays: 10 }).whmcsUrgentDays).toBe(7);
    expect(resolveInvoiceWaConfig({ waWhmcsWindowDays: 31 }).whmcsWindowDays).toBe(20);
  });
  it('nothing before the window; the first send at 20 days left', () => {
    expect(invoiceWaStage(inv({ dueDateMs: dueIn(21) }), c, ctx())).toEqual({ ok: false, reason: 'not-due' });
    expect(invoiceWaStage(inv({ dueDateMs: dueIn(20) }), c, ctx())).toEqual({ ok: true, stage: 'pre-due', daysLate: -20 });
  });
  it('far from the due date: every 5 calendar days', () => {
    expect(invoiceWaStage(inv({ dueDateMs: dueIn(16), preDueWaSentAtMs: sentDaysAgo(4) }), c, ctx())).toEqual({ ok: false, reason: 'already-sent' });
    // Sent at 18:00 five days ago, now 12:00 → < 5×24h but 5 calendar days: goes.
    expect(invoiceWaStage(inv({ dueDateMs: dueIn(15), preDueWaSentAtMs: sentDaysAgo(5) }), c, ctx())).toEqual({ ok: true, stage: 'pre-due', daysLate: -15 });
  });
  it('10 days or fewer: every 2 calendar days', () => {
    expect(invoiceWaStage(inv({ dueDateMs: dueIn(10), preDueWaSentAtMs: sentDaysAgo(5) }), c, ctx())).toMatchObject({ ok: true });
    expect(invoiceWaStage(inv({ dueDateMs: dueIn(9), preDueWaSentAtMs: sentDaysAgo(1) }), c, ctx())).toEqual({ ok: false, reason: 'already-sent' });
    expect(invoiceWaStage(inv({ dueDateMs: dueIn(8), preDueWaSentAtMs: sentDaysAgo(2) }), c, ctx())).toEqual({ ok: true, stage: 'pre-due', daysLate: -8 });
    expect(invoiceWaStage(inv({ dueDateMs: dueIn(2), preDueWaSentAtMs: sentDaysAgo(2) }), c, ctx())).toMatchObject({ ok: true });
  });
  it('a full run from 20 days out sends on 20, 15, 10, 8, 6, 4, 2 and "skadon sot" on the due day', () => {
    const due = dueIn(20);
    const sent: number[] = [];
    let last: number | null = null;
    let dueSent: number | null = null;
    for (let day = 0; day <= 20; day++) {
      const now = NOW + day * DAY;
      const r = invoiceWaStage(inv({ dueDateMs: due, preDueWaSentAtMs: last, dueWaSentAtMs: dueSent }), c, ctx({ nowMs: now }));
      if (!r.ok) continue;
      sent.push(0 - r.daysLate || 0);
      if (r.stage === 'pre-due') last = now; else dueSent = now;
    }
    expect(sent).toEqual([20, 15, 10, 8, 6, 4, 2, 0]);
  });
  it('the due day is sent once even without onDue; FivoCRM invoices keep the once-only stage', () => {
    expect(invoiceWaStage(inv({ dueDateMs: NOW }), c, ctx())).toEqual({ ok: true, stage: 'due', daysLate: 0 });
    expect(invoiceWaStage(inv({ dueDateMs: NOW, dueWaSentAtMs: NOW - 1000 }), c, ctx())).toEqual({ ok: false, reason: 'already-sent' });
    expect(invoiceWaStage(inv({ source: 'fivocrm', dueDateMs: dueIn(15) }), c, ctx())).toEqual({ ok: false, reason: 'not-due' });
    expect(invoiceWaStage(inv({ source: null, dueDateMs: NOW }), c, ctx())).toEqual({ ok: false, reason: 'not-due' });
  });
});

describe('invoiceWaStage — misc', () => {
  it('no due date is a named reason (cadence on)', () => {
    expect(invoiceWaStage(inv({ dueDateMs: null }), cfg(), ctx())).toEqual({ ok: false, reason: 'no-due-date' });
  });
});

describe('invoiceWaDecision — the only gate', () => {
  it('lets a 70-day-late WHMCS invoice through with a phone, inside hours, with a channel', () => {
    expect(invoiceWaDecision(inv(), customer, cfg(), ctx())).toEqual({ ok: true, stage: 'overdue', daysLate: 70 });
  });
  it('disabled config blocks everything first', () => {
    expect(invoiceWaDecision(inv(), customer, cfg({ enabled: false }), ctx())).toEqual({ ok: false, reason: 'disabled' });
  });
  it('source filter: whmcs-only ignores FivoCRM invoices and vice versa', () => {
    expect(invoiceWaDecision(inv({ source: 'manual' }), customer, cfg({ sources: 'whmcs' }), ctx())).toEqual({ ok: false, reason: 'source-mismatch' });
    expect(invoiceWaDecision(inv({ source: 'whmcs' }), customer, cfg({ sources: 'fivocrm' }), ctx())).toEqual({ ok: false, reason: 'source-mismatch' });
    expect(invoiceMatchesSource('fivocrm', undefined)).toBe(true);
    expect(invoiceMatchesSource('all', 'whmcs')).toBe(true);
  });
  it('settled / zero-balance invoices never get a reminder', () => {
    expect(invoiceWaDecision(inv({ status: 'Paid' }), customer, cfg(), ctx())).toEqual({ ok: false, reason: 'settled' });
    expect(invoiceWaDecision(inv({ status: 'Cancelled' }), customer, cfg(), ctx())).toEqual({ ok: false, reason: 'settled' });
    expect(invoiceWaDecision(inv({ status: 'Draft' }), customer, cfg(), ctx())).toEqual({ ok: false, reason: 'settled' });
    expect(invoiceWaDecision(inv({ total: 100, paidAmount: 100 }), customer, cfg(), ctx())).toEqual({ ok: false, reason: 'zero-balance' });
  });
  it('a Partial invoice past due still reaches the overdue stage', () => {
    expect(invoiceWaDecision(inv({ status: 'Partial', paidAmount: 5_000 }), customer, cfg(), ctx())).toEqual({ ok: true, stage: 'overdue', daysLate: 70 });
  });
  it('customer gates: missing, opted out of reminders, opted out of WhatsApp, no usable phone', () => {
    expect(invoiceWaDecision(inv(), null, cfg(), ctx())).toEqual({ ok: false, reason: 'no-customer' });
    expect(invoiceWaDecision(inv(), { ...customer, disableOverdueReminders: true }, cfg(), ctx())).toEqual({ ok: false, reason: 'customer-opt-out' });
    expect(invoiceWaDecision(inv(), { ...customer, waOptOut: true }, cfg(), ctx())).toEqual({ ok: false, reason: 'wa-opt-out' });
    expect(invoiceWaDecision(inv(), { ...customer, phone: '123' }, cfg(), ctx())).toEqual({ ok: false, reason: 'no-phone' });
  });
  it('outside the local send window nothing goes out', () => {
    const night = Date.parse('2026-09-14T01:00:00Z'); // 03:00 local
    expect(invoiceWaDecision(inv(), customer, cfg(), ctx({ nowMs: night }))).toEqual({ ok: false, reason: 'outside-hours' });
    expect(invoiceWaDecision(inv(), customer, cfg({ hourStart: 0, hourEnd: 24 }), ctx({ nowMs: night }))).toMatchObject({ ok: true });
  });
  it('channel gates: no channel; Meta needs a template, Baileys does not', () => {
    expect(invoiceWaDecision(inv(), customer, cfg(), ctx({ hasChannel: false }))).toEqual({ ok: false, reason: 'no-channel' });
    expect(invoiceWaDecision(inv(), customer, cfg({ channel: 'meta' }), ctx({ hasTemplate: false }))).toEqual({ ok: false, reason: 'no-template' });
    expect(invoiceWaDecision(inv(), customer, cfg({ channel: 'baileys' }), ctx({ hasTemplate: false }))).toMatchObject({ ok: true });
  });
  it('every reason has a label', () => {
    const reasons = ['disabled', 'source-mismatch', 'settled', 'zero-balance', 'no-due-date', 'not-due', 'awaiting-email',
      'max-sends-reached', 'already-sent',
      'no-customer', 'customer-opt-out', 'wa-opt-out', 'no-phone', 'undeliverable', 'outside-hours', 'no-channel', 'no-template',
      'send-failed'] as const;
    for (const r of reasons) expect(INVOICE_WA_BLOCK_LABELS[r]).toBeTruthy();
  });
});

describe('email first, then WhatsApp (overdue stage)', () => {
  const late = (days: number, over: Partial<InvoiceWaInvoiceFacts> = {}) =>
    inv({ status: 'Overdue', source: 'manual', dueDateMs: dueIn(-days), ...over });
  const c = cfg(); // defaults: day 4, every 7 days, max 3

  it('3 days late is not "more than 3 days" — nothing yet', () => {
    expect(invoiceWaDecision(late(3, { emailChannelAvailable: true, overdueEmailSentAtMs: NOW - 2 * DAY }), customer, c, ctx()))
      .toEqual({ ok: false, reason: 'not-due' });
  });
  it('day 4 with an email possible but not yet sent → awaiting-email', () => {
    expect(invoiceWaDecision(late(4, { emailChannelAvailable: true }), customer, c, ctx()))
      .toEqual({ ok: false, reason: 'awaiting-email' });
  });
  it('day 4 after the email went out → WhatsApp', () => {
    expect(invoiceWaDecision(late(4, { emailChannelAvailable: true, overdueEmailSentAtMs: NOW - 3 * DAY }), customer, c, ctx()))
      .toEqual({ ok: true, stage: 'overdue', daysLate: 4 });
  });
  it('no email possible (no address / WHMCS mails it / opted out of email) → WhatsApp goes anyway', () => {
    expect(invoiceWaDecision(late(4, { emailChannelAvailable: false }), customer, c, ctx()))
      .toEqual({ ok: true, stage: 'overdue', daysLate: 4 });
    // Legacy callers that pass no email facts keep the old behaviour.
    expect(invoiceWaDecision(late(4), customer, c, ctx())).toMatchObject({ ok: true });
  });
  it('the email gate never touches the pre-due / due stages', () => {
    expect(invoiceWaDecision(inv({ dueDateMs: dueIn(0), emailChannelAvailable: true }), customer, cfg({ onDue: true }), ctx()))
      .toEqual({ ok: true, stage: 'due', daysLate: 0 });
  });
  it('repeats every 7 days, at most 3 sends, then max-sends-reached', () => {
    const base = { emailChannelAvailable: true, overdueEmailSentAtMs: NOW - 10 * DAY };
    expect(invoiceWaDecision(late(10, { ...base, overdueWaCount: 1, overdueWaSentAtMs: NOW - 6 * DAY }), customer, c, ctx()))
      .toEqual({ ok: false, reason: 'already-sent' });
    expect(invoiceWaDecision(late(11, { ...base, overdueWaCount: 1, overdueWaSentAtMs: NOW - 7 * DAY }), customer, c, ctx()))
      .toEqual({ ok: true, stage: 'overdue', daysLate: 11 });
    expect(invoiceWaDecision(late(18, { ...base, overdueWaCount: 2, overdueWaSentAtMs: NOW - 7 * DAY }), customer, c, ctx()))
      .toMatchObject({ ok: true });
    expect(invoiceWaDecision(late(25, { ...base, overdueWaCount: 3, overdueWaSentAtMs: NOW - 7 * DAY }), customer, c, ctx()))
      .toEqual({ ok: false, reason: 'max-sends-reached' });
    expect(invoiceWaDecision(late(25, { ...base, overdueWaCount: 3, overdueWaSentAtMs: NOW - 7 * DAY }), customer, cfg({ overdueMaxSends: 5 }), ctx()))
      .toMatchObject({ ok: true });
  });
});

describe('text', () => {
  it('stage stamp fields', () => {
    expect(invoiceWaStageField('pre-due')).toBe('preDueWaSentAt');
    expect(invoiceWaStageField('due')).toBe('dueWaSentAt');
    expect(invoiceWaStageField('overdue')).toBe('overdueWaSentAt');
  });
  it('dueText per stage', () => {
    expect(invoiceWaDueText('pre-due', -1)).toBe('skadon nesër');
    expect(invoiceWaDueText('pre-due', -3)).toBe('skadon për 3 ditë');
    expect(invoiceWaDueText('due', 0)).toBe('skadon sot');
    expect(invoiceWaDueText('overdue', 1)).toBe('ka 1 ditë vonesë');
    expect(invoiceWaDueText('overdue', 12)).toBe('ka 12 ditë vonesë');
  });
  it('renders tokens, blanks unknown ones, formats the amount', () => {
    const out = renderInvoiceWaText('Fatura {{invoiceNumber}}: {{amount}} {{currency}} {{dueText}} {{foo}} {{link}}',
      { invoiceNumber: 'INV-7', amount: 12500.5, currency: 'ALL', dueText: 'ka 3 ditë vonesë', link: 'https://x/pay' });
    expect(out).toBe('Fatura INV-7: 12 500.50 ALL ka 3 ditë vonesë https://x/pay');
    expect(out).not.toContain('{{');
  });
  it('a body without {{link}} gets the link appended; empty body uses the default', () => {
    expect(renderInvoiceWaText('Paguaj ju lutem.', { link: 'https://x/pay' })).toBe('Paguaj ju lutem.\nhttps://x/pay');
    const def = renderInvoiceWaText('', { firstName: 'Arben', invoiceNumber: 'INV-1', amount: 100, currency: 'EUR', dueText: 'skadon sot', link: 'https://x', company: 'Fivo' });
    expect(def.startsWith('Përshëndetje Arben, fatura INV-1 (100 EUR) skadon sot.')).toBe(true);
    expect(DEFAULT_INVOICE_WA_TEXT).toContain('{{link}}');
  });
  it('helpers', () => {
    expect(formatInvoiceWaAmount(1234567)).toBe('1 234 567');
    expect(formatInvoiceWaAmount(99.9)).toBe('99.90');
    expect(invoiceWaFirstName('Arben Hoxha')).toBe('Arben');
    expect(invoiceWaFirstName('  ')).toBe('');
    expect(normalizeInvoiceWaPhone('+355 69 123 4567')).toBe('355691234567');
    expect(normalizeInvoiceWaPhone('')).toBe('');
    // Albanian numbers as they are typed into the CRM → international form.
    expect(normalizeInvoiceWaPhone('699249702')).toBe('355699249702');
    expect(normalizeInvoiceWaPhone('069 924 9702')).toBe('355699249702');
    expect(normalizeInvoiceWaPhone('+355 069 924 9702')).toBe('355699249702');
    expect(normalizeInvoiceWaPhone('00355699249702')).toBe('355699249702');
    expect(normalizeInvoiceWaPhone('+39 347 123 4567')).toBe('393471234567');
    expect(tallyInvoiceWaBlocked(['no-phone', 'no-phone', 'not-due'])).toEqual({ 'no-phone': 2, 'not-due': 1 });
  });
});

describe('email first — a FAILED email never holds WhatsApp hostage', () => {
  const late = (days: number, over: Partial<InvoiceWaInvoiceFacts> = {}) =>
    inv({ status: 'Overdue', source: 'manual', dueDateMs: dueIn(-days), ...over });
  it('SMTP failed and never succeeded → WhatsApp goes', () => {
    expect(invoiceWaDecision(late(5, { emailChannelAvailable: true, overdueEmailFailedAtMs: NOW - DAY }), customer, cfg(), ctx()))
      .toEqual({ ok: true, stage: 'overdue', daysLate: 5 });
  });
  it('a failure OLDER than the last success changes nothing', () => {
    const f = late(5, { emailChannelAvailable: true, overdueEmailSentAtMs: NOW - DAY, overdueEmailFailedAtMs: NOW - 3 * DAY });
    expect(invoiceEmailUsable(f)).toBe(true);
    expect(invoiceWaDecision(f, customer, cfg(), ctx())).toMatchObject({ ok: true });
  });
  it('no failure, no email yet → still awaiting-email', () => {
    expect(invoiceWaDecision(late(5, { emailChannelAvailable: true }), customer, cfg(), ctx()))
      .toEqual({ ok: false, reason: 'awaiting-email' });
    expect(invoiceEmailUsable(late(5, { emailChannelAvailable: false }))).toBe(false);
  });
});

describe('undeliverable numbers', () => {
  it('a permanent failure for THIS number blocks; a new number re-arms', () => {
    expect(invoiceWaDecision(inv(), { ...customer, waUndeliverablePhone: '355691234567' }, cfg(), ctx()))
      .toEqual({ ok: false, reason: 'undeliverable' });
    expect(invoiceWaDecision(inv(), { ...customer, waUndeliverablePhone: '355690000000' }, cfg(), ctx()))
      .toMatchObject({ ok: true });
  });
});

describe('coversWhmcs — which team panel drives a WHMCS invoice', () => {
  it('an enabled panel on all / whmcs covers WHMCS; fivocrm-only or disabled does not', () => {
    expect(coversWhmcs(cfg({ sources: 'all' }))).toBe(true);
    expect(coversWhmcs(cfg({ sources: 'whmcs' }))).toBe(true);
    expect(coversWhmcs(cfg({ sources: 'fivocrm' }))).toBe(false);
    expect(coversWhmcs(cfg({ enabled: false, sources: 'whmcs' }))).toBe(false);
    expect(coversWhmcs(resolveInvoiceWaConfig(null))).toBe(false);
  });
});

describe('idempotency key', () => {
  it('is deterministic per invoice, stage and overdue send number', () => {
    expect(invoiceWaIdempotencyKey('abc', 'overdue', 2)).toBe('inv_abc_overdue_2');
    expect(invoiceWaIdempotencyKey('abc', 'due', 7)).toBe('inv_abc_due_1');
    expect(invoiceWaIdempotencyKey('abc', 'pre-due', 0)).toBe('inv_abc_pre-due_1');
    // The WHMCS cadence repeats the pre-due stage — each send has its own key.
    expect(invoiceWaIdempotencyKey('abc', 'pre-due', 3)).toBe('inv_abc_pre-due_3');
  });
});

describe('Meta template params (invoice pseudo-fields)', () => {
  const tctx = {
    name: 'Arben Hoxha', firstName: 'Arben', company: 'Fivo', invoiceNumber: 'INV-7', amount: 12500, total: 20000,
    currency: 'ALL', dueDate: '14.09.2026', dueText: 'ka 5 ditë vonesë', daysLate: 5, link: 'https://x/pay', whmcsLink: '',
  };
  it('fills every documented field, aliases included', () => {
    expect(invoiceWaTemplateParams(
      ['invoiceNumber', 'amount', 'balanceDue', 'currency', 'dueDate', 'daysLate', 'customerName', 'companyName', 'paymentLink', 'total'],
      tctx,
    )).toEqual(['INV-7', '12 500', '12 500', 'ALL', '14.09.2026', '5', 'Arben Hoxha', 'Fivo', 'https://x/pay', '20 000']);
  });
  it('unknown / custom / non-array → empty strings, never a crash', () => {
    expect(invoiceWaTemplateParams(['custom', 'foo', ''], tctx)).toEqual(['', '', '']);
    expect(invoiceWaTemplateParams(undefined, tctx)).toEqual([]);
  });
  it('a negative daysLate (pre-due) renders 0', () => {
    expect(invoiceWaTemplateParams(['daysLate'], { ...tctx, daysLate: -3 })).toEqual(['0']);
  });
  it('the documented list is what the picker shows', () => {
    for (const f of ['invoiceNumber', 'amount', 'balanceDue', 'currency', 'dueDate', 'daysLate', 'customerName', 'companyName', 'paymentLink']) {
      expect(INVOICE_WA_PARAM_FIELDS).toContain(f);
    }
  });
});
