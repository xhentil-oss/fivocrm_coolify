/**
 * @vitest-environment node
 *
 * Node, not jsdom: the drift guard reads `api/_waAutomationCore.ts` off disk.
 * The cron (api/cron/run.ts) runs THAT copy, so these tests are the parity tests
 * between the browser preview and the sender.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  normalizePhone, isSendablePhone, isWaUndeliverable, waSendBlockReason, waFailureBlock, readFailedPhones,
  splitInFlight, waQuietHoursBlock, waLocalHour, waLocalDayKey, waBroadcastIdempotencyKey,
  waAutomationIdempotencyKey, WA_BLOCK_LABELS, WA_MAX_SEND_ATTEMPTS, WA_IN_FLIGHT_STALE_MS,
  type WaBlockReason, type WaContact,
} from './waAutomationCore';
import { evaluateWaSegment } from './waAutomation';
import { toWaPhone } from '../messaging/waPhone';
import { normalizeInvoiceWaPhone } from '../finance/invoiceWaReminders';

const root = resolve(__dirname, '../../..');
const NOW = new Date('2026-08-12T10:00:00Z'); // 12:00 Tirane (CEST)
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const lead = (over: Partial<WaContact> = {}): WaContact => ({
  id: 'l1', name: 'Ardit Hoxha', phone: '+355 69 123 4567', status: 'Contacted', tags: ['SEO'], ...over,
});
const ctx = { now: NOW, kind: 'lead' as const };

describe('api mirror', () => {
  it('api/_waAutomationCore.ts is byte-identical to the canonical module', () => {
    const canonical = readFileSync(resolve(root, 'src/lib/marketing/waAutomationCore.ts'), 'utf8');
    const mirror = readFileSync(resolve(root, 'api/_waAutomationCore.ts'), 'utf8');
    expect(mirror).toBe(canonical);
  });
  it('the core is import-free (the api copy must not reach into src/)', () => {
    const canonical = readFileSync(resolve(root, 'src/lib/marketing/waAutomationCore.ts'), 'utf8');
    expect(canonical).not.toMatch(/^\s*import\s/m);
  });
  it('run.ts no longer carries a hand-written mirror of the gate', () => {
    const run = readFileSync(resolve(root, 'api/cron/run.ts'), 'utf8');
    expect(run).not.toMatch(/function waBlockReason\(/);
    expect(run).not.toMatch(/function normalizeWaPhone\(/);
    expect(run).toMatch(/from '\.\.\/_waAutomationCore\.js'/);
  });
});

describe('ONE phone rule', () => {
  const samples = [
    '0691234567', '691234567', '+355 69 123 4567', '00355691234567', '3550691234567', '355691234567',
    '+39 347 123 4567', '123', '', null, undefined, '+1 (415) 555-0100', '1234567890123456', '0681234567',
  ];
  it('normalizePhone == toWaPhone == normalizeInvoiceWaPhone on every sample', () => {
    for (const p of samples) {
      expect(normalizePhone(p)).toBe(toWaPhone(p));
      expect(normalizeInvoiceWaPhone(p as string | null | undefined)).toBe(toWaPhone(p));
    }
  });
  it('local and international forms are the SAME person', () => {
    expect(normalizePhone('069 123 4567')).toBe('355691234567');
    expect(isSendablePhone('123')).toBe(false);
  });
});

describe('opt-out and undeliverable', () => {
  it('waOptOut === true blocks as opted-out, before any segment filter', () => {
    expect(waSendBlockReason(lead({ waOptOut: true, status: 'Lost' }), { statuses: ['Contacted'] }, {}, ctx)).toBe('opted-out');
    expect(waSendBlockReason(lead({ waOptOut: false }), {}, {}, ctx)).toBeNull();
  });
  it('a permanent failure for THIS number blocks; editing the phone re-arms it', () => {
    const bad = lead({ waUndeliverablePhone: '355691234567', phone: '069 123 4567' });
    expect(isWaUndeliverable(bad)).toBe(true);
    expect(waSendBlockReason(bad, {}, {}, ctx)).toBe('undeliverable');
    expect(waSendBlockReason({ ...bad, phone: '0697654321' }, {}, {}, ctx)).toBeNull();
  });
});

describe('dormancy matches local-format phones (the daily re-message bug)', () => {
  it('a message logged under 355… counts as contact for a customer stored as 069…', () => {
    const customer = lead({ id: 'c1', phone: '069 123 4567', lastActivityAt: daysAgo(90) });
    const lastMessageByPhone = new Map([[normalizePhone('355691234567'), daysAgo(1)]]);
    expect(waSendBlockReason(customer, {}, { lastContactMinDays: 30 }, { ...ctx, kind: 'customer', lastMessageByPhone }))
      .toBe('contacted-too-recently');
  });
  it('sentPhones stored in an older digits-only form still dedupe after normalisation', () => {
    const sentPhones = new Set(['0691234567'].map(normalizePhone));
    expect(waSendBlockReason(lead(), {}, {}, { ...ctx, sentPhones })).toBe('already-sent');
  });
});

describe('per-phone failure ledger', () => {
  it('permanent → never; transient → retried until WA_MAX_SEND_ATTEMPTS', () => {
    expect(waFailureBlock(undefined)).toBeNull();
    expect(waFailureBlock({ count: 1, permanent: true })).toBe('failed-permanent');
    expect(waFailureBlock({ count: WA_MAX_SEND_ATTEMPTS - 1 })).toBeNull();
    expect(waFailureBlock({ count: WA_MAX_SEND_ATTEMPTS })).toBe('retries-exhausted');
  });
  it('a failing head target does not block the others (the gate skips only that phone)', () => {
    const failedPhones = readFailedPhones({ '355691111111': { count: 1, permanent: true, error: 'not-on-whatsapp' } });
    const res = evaluateWaSegment({
      leads: [lead({ id: 'a', phone: '0691111111' }), lead({ id: 'b', phone: '0692222222' })],
      segment: {}, now: NOW, failedPhones,
    });
    expect(res.targets.map((t) => t.contact.id)).toEqual(['b']);
    expect(res.blocked['failed-permanent']).toBe(1);
  });
  it('readFailedPhones normalises keys and drops junk', () => {
    const m = readFailedPhones({ '0691234567': { count: '2' }, x: { count: 1 }, '355692222222': null });
    expect([...m.keys()]).toEqual(['355691234567']);
    expect(m.get('355691234567')).toMatchObject({ count: 2, permanent: false });
  });
  it('in-flight: fresh claims block, stale ones are handed back', () => {
    const { fresh, stale } = splitInFlight({
      '355691111111': new Date(NOW.getTime() - 60_000),
      '355692222222': new Date(NOW.getTime() - WA_IN_FLIGHT_STALE_MS - 1),
    }, NOW.getTime());
    expect([...fresh]).toEqual(['355691111111']);
    expect(stale).toEqual(['355692222222']);
    expect(waSendBlockReason(lead({ phone: '0691111111' }), {}, {}, { ...ctx, inFlightPhones: fresh })).toBe('in-flight');
  });
});

describe('quiet hours (09:00–20:00 Europe/Tirane)', () => {
  it('blocks the night and the evening, never the working day', () => {
    expect(waLocalHour(Date.parse('2026-08-12T10:00:00Z'))).toBe(12);
    expect(waQuietHoursBlock(Date.parse('2026-08-12T10:00:00Z'))).toBeNull();          // 12:00
    expect(waQuietHoursBlock(Date.parse('2026-08-12T06:59:00Z'))).toBe('quiet-hours'); // 08:59
    expect(waQuietHoursBlock(Date.parse('2026-08-12T07:00:00Z'))).toBeNull();          // 09:00
    expect(waQuietHoursBlock(Date.parse('2026-08-12T18:00:00Z'))).toBe('quiet-hours'); // 20:00
    // Winter (CET = UTC+1): 08:30Z is 09:30 local.
    expect(waQuietHoursBlock(Date.parse('2026-12-01T08:30:00Z'))).toBeNull();
  });
});

describe('deterministic idempotency keys', () => {
  it('same campaign + same person = same key, whatever the stored format', () => {
    expect(waBroadcastIdempotencyKey('b1', '069 123 4567')).toBe('bc_b1_355691234567');
    expect(waBroadcastIdempotencyKey('b1', '+355691234567')).toBe('bc_b1_355691234567');
    expect(waAutomationIdempotencyKey('r1', '0691234567', '2026-08-12')).toBe('auto_r1_355691234567_2026-08-12');
  });
  it('the day key is the LOCAL day', () => {
    expect(waLocalDayKey(Date.parse('2026-08-12T22:30:00Z'))).toBe('2026-08-13'); // 00:30 local
  });
});

describe('labels', () => {
  it('every reason has an Albanian label', () => {
    const reasons: WaBlockReason[] = ['no-phone', 'status-mismatch', 'tag-mismatch', 'category-mismatch', 'assignee-mismatch',
      'source-mismatch', 'domain-mismatch', 'never-contacted', 'contacted-too-recently', 'contact-too-old', 'no-notes',
      'no-variant', 'already-sent', 'opted-out', 'undeliverable', 'failed-permanent', 'retries-exhausted', 'in-flight',
      'quiet-hours', 'channel-down'];
    for (const r of reasons) expect(WA_BLOCK_LABELS[r]).toBeTruthy();
  });
});
