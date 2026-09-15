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
  it('returns the defaults for nothing / {} (disabled, Meta, 60 days, 09–19)', () => {
    expect(resolveInvoiceWaConfig(null)).toEqual(INVOICE_WA_DEFAULTS);
    expect(resolveInvoiceWaConfig({})).toEqual(INVOICE_WA_DEFAULTS);
  });
  it('reads the legacy waOverdue* keys AND the new waInvoice* keys', () => {
    const c = resolveInvoiceWaConfig({
      waOverdueEnabled: true, waOverdueDays: '30', waOverdueTemplateId: 't1', waOverdueChannelPhoneNumberId: 'p1',
      waInvoiceSources: 'whmcs', waInvoiceChannel: 'baileys', waInvoiceAgentId: ' a1 ', waInvoiceText: 'Hi {{name}}',
      waInvoicePreDueDays: 3, waInvoiceOnDue: true, waInvoiceRenotifyDays: 7, waInvoiceHourStart: 8, waInvoiceHourEnd: 20,
      overdueEmailSkipWhmcs: true,
    });
    expect(c).toEqual({
      enabled: true, sources: 'whmcs', channel: 'baileys', agentId: 'a1', text: 'Hi {{name}}', templateId: 't1',
      channelPhoneNumberId: 'p1', preDueDays: 3, onDue: true, overdueDays: 30, renotifyDays: 7, hourStart: 8, hourEnd: 20,
      emailSkipWhmcs: true,
    });
  });
  it('an invalid value falls back individually, never resetting its neighbours', () => {
    const c = resolveInvoiceWaConfig({ waOverdueDays: 0, waInvoicePreDueDays: 99, waInvoiceRenotifyDays: 'x', waInvoiceSources: 'bogus', waInvoiceChannel: 'sms' });
    expect(c.overdueDays).toBe(60);
    expect(c.preDueDays).toBe(0);
    expect(c.renotifyDays).toBe(14);
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
    const reasons = ['disabled', 'source-mismatch', 'settled', 'zero-balance', 'no-due-date', 'not-due', 'already-sent',
      'no-customer', 'customer-opt-out', 'wa-opt-out', 'no-phone', 'outside-hours', 'no-channel', 'no-template'] as const;
    for (const r of reasons) expect(INVOICE_WA_BLOCK_LABELS[r]).toBeTruthy();
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
    expect(tallyInvoiceWaBlocked(['no-phone', 'no-phone', 'not-due'])).toEqual({ 'no-phone': 2, 'not-due': 1 });
  });
});
