/**
 * @vitest-environment node
 *
 * Node, not jsdom: the drift guard reads `api/_waAutoReply.ts` off disk.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AUTO_REPLY_BLOCK_LABELS,
  DEFAULT_WA_TIMEZONE,
  decideAutoReply,
  isOptInMessage,
  isOptOutMessage,
  isOutsideBusinessHours,
  renderAutoReplyTokens,
  type AutoReplyBlockReason,
  type AutoReplyInput,
} from './autoReply';

const TZ = DEFAULT_WA_TIMEZONE;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// 2026-09-09 is a Wednesday. Tirana is UTC+2 in September (CEST).
const WED_11_00 = new Date('2026-09-09T09:00:00Z').getTime(); // 11:00 local
const WED_23_00 = new Date('2026-09-09T21:00:00Z').getTime(); // 23:00 local
const SAT_11_00 = new Date('2026-09-12T09:00:00Z').getTime(); // Saturday 11:00 local

const settingsOn = {
  waAutoReplyEnabled: true,
  waAutoReplyText: 'Jemi mbyllur. Ju kthejmë përgjigje nesër.',
  waBusinessStart: '09:00',
  waBusinessEnd: '18:00',
  waGreetingEnabled: true,
  waGreetingText: 'Mirë se vini {{firstName}}! Si mund t\'ju ndihmojmë?',
};

const brandNew = { lastInboundBeforeMs: null, lastOutboundMs: null, lastAutoReplyMs: null };

const input = (over: Partial<AutoReplyInput> = {}): AutoReplyInput => ({
  channel: 'baileys',
  direction: 'inbound',
  isAutoReply: false,
  kind: 'text',
  settings: settingsOn,
  contact: { name: 'Arben Hoxha', company: 'Hoxha shpk' },
  history: brandNew,
  nowMs: WED_11_00,
  timeZone: TZ,
  ...over,
});

describe('api mirror', () => {
  it('api/_waAutoReply.ts is byte-identical to src/lib/messaging/autoReply.ts', () => {
    const root = resolve(__dirname, '../../..');
    const canonical = readFileSync(resolve(root, 'src/lib/messaging/autoReply.ts'), 'utf8');
    const mirror = readFileSync(resolve(root, 'api/_waAutoReply.ts'), 'utf8');
    expect(mirror).toBe(canonical);
  });
});

describe('isOutsideBusinessHours', () => {
  it('is inside on a weekday within the window and outside after closing', () => {
    expect(isOutsideBusinessHours(WED_11_00, TZ, '09:00', '18:00')).toBe(false);
    expect(isOutsideBusinessHours(WED_23_00, TZ, '09:00', '18:00')).toBe(true);
  });

  it('supports an overnight window (22:00–06:00 is OPEN at 23:00)', () => {
    expect(isOutsideBusinessHours(WED_23_00, TZ, '22:00', '06:00')).toBe(false);
    expect(isOutsideBusinessHours(WED_11_00, TZ, '22:00', '06:00')).toBe(true);
  });

  it('treats a non-business weekday as outside all day (default Mon–Fri)', () => {
    expect(isOutsideBusinessHours(SAT_11_00, TZ, '09:00', '18:00')).toBe(true);
    expect(isOutsideBusinessHours(SAT_11_00, TZ, '09:00', '18:00', [1, 2, 3, 4, 5, 6])).toBe(false);
    // An empty/invalid day list falls back to the default instead of "never open".
    expect(isOutsideBusinessHours(WED_11_00, TZ, '09:00', '18:00', [])).toBe(false);
  });

  it('means "always open" when the hours are not configured (legacy)', () => {
    expect(isOutsideBusinessHours(WED_23_00, TZ, undefined, undefined)).toBe(false);
    expect(isOutsideBusinessHours(SAT_11_00, TZ, '', '18:00')).toBe(false);
  });
});

describe('renderAutoReplyTokens', () => {
  it('fills firstName / name / company and blanks an unknown token', () => {
    const c = { name: 'Arben Hoxha', company: 'Hoxha shpk' };
    expect(renderAutoReplyTokens('Pershendetje {{firstName}} ({{ NAME }}) nga {{company}}', c))
      .toBe('Pershendetje Arben (Arben Hoxha) nga Hoxha shpk');
    expect(renderAutoReplyTokens('Hi {{foo}}, {{firstName}}!', c)).toBe('Hi, Arben!');
  });

  it('never leaks a placeholder for a contact with no data (phone-as-name included)', () => {
    expect(renderAutoReplyTokens('Përshëndetje {{firstName}}, faleminderit!', { name: '+355691234567' }))
      .toBe('Përshëndetje, faleminderit!');
    expect(renderAutoReplyTokens('{{firstName}} {{company}}', {})).toBe('');
  });
});

describe('decideAutoReply — block reasons', () => {
  const blocked = (d: ReturnType<typeof decideAutoReply>) => ('blocked' in d ? d.blocked : `sent:${d.kind}`);

  it('own-echo for outbound, auto-reply-echo for our echo, not-a-message for reactions/system', () => {
    expect(blocked(decideAutoReply(input({ direction: 'outbound' })))).toBe('own-echo');
    expect(blocked(decideAutoReply(input({ isAutoReply: true })))).toBe('auto-reply-echo');
    expect(blocked(decideAutoReply(input({ kind: 'reaction' })))).toBe('not-a-message');
    expect(blocked(decideAutoReply(input({ kind: 'system' })))).toBe('not-a-message');
  });

  it('opted-out beats everything after the echo checks', () => {
    expect(blocked(decideAutoReply(input({ contact: { waOptOut: true }, nowMs: WED_23_00 })))).toBe('opted-out');
  });

  it('disabled when neither feature is on', () => {
    expect(blocked(decideAutoReply(input({ settings: {}, nowMs: WED_23_00 })))).toBe('disabled');
    expect(blocked(decideAutoReply(input({ settings: { waAutoReplyEnabled: false, waGreetingEnabled: false } })))).toBe('disabled');
  });

  it('debounced within the window (default 6h), free again after it', () => {
    expect(blocked(decideAutoReply(input({ nowMs: WED_23_00, history: { ...brandNew, lastAutoReplyMs: WED_23_00 - 2 * HOUR } })))).toBe('debounced');
    expect(blocked(decideAutoReply(input({ nowMs: WED_23_00, history: { ...brandNew, lastAutoReplyMs: WED_23_00 - 7 * HOUR } })))).toBe('sent:outside-hours');
    // A configured 1h window frees it sooner.
    expect(blocked(decideAutoReply(input({
      nowMs: WED_23_00,
      settings: { ...settingsOn, waAutoReplyDebounceHours: 1 },
      history: { ...brandNew, lastAutoReplyMs: WED_23_00 - 2 * HOUR },
    })))).toBe('sent:outside-hours');
  });

  it('inside-hours when only the outside-hours reply is on and the office is open', () => {
    const s = { ...settingsOn, waGreetingEnabled: false };
    expect(blocked(decideAutoReply(input({ settings: s })))).toBe('inside-hours');
  });

  it('no-text-configured when the applicable feature has an empty text', () => {
    expect(blocked(decideAutoReply(input({
      nowMs: WED_23_00,
      settings: { waAutoReplyEnabled: true, waAutoReplyText: '   ', waBusinessStart: '09:00', waBusinessEnd: '18:00' },
    })))).toBe('no-text-configured');
    expect(blocked(decideAutoReply(input({ settings: { waGreetingEnabled: true, waGreetingText: '' } })))).toBe('no-text-configured');
  });

  it('not-first-contact when the greeting is on but the contact was in touch recently', () => {
    const s = { ...settingsOn, waAutoReplyEnabled: false };
    expect(blocked(decideAutoReply(input({
      settings: s,
      history: { lastInboundBeforeMs: WED_11_00 - 2 * DAY, lastOutboundMs: null, lastAutoReplyMs: null },
    })))).toBe('not-first-contact');
    expect(blocked(decideAutoReply(input({
      settings: s,
      history: { lastInboundBeforeMs: null, lastOutboundMs: WED_11_00 - 1 * DAY, lastAutoReplyMs: null },
    })))).toBe('not-first-contact');
  });

  it('has an Albanian label for every reason', () => {
    const reasons: AutoReplyBlockReason[] = [
      'disabled', 'own-echo', 'auto-reply-echo', 'not-a-message', 'opted-out', 'no-text-configured',
      'debounced', 'inside-hours', 'not-first-contact', 'meta-window-closed', 'no-channel',
      'reply-to-automated', 'no-phone',
    ];
    for (const r of reasons) expect(AUTO_REPLY_BLOCK_LABELS[r]?.length).toBeGreaterThan(5);
  });
});

describe('decideAutoReply — reply to one of our automated messages', () => {
  const blocked = (d: ReturnType<typeof decideAutoReply>) => ('blocked' in d ? d.blocked : `sent:${d.kind}`);

  it('blocks the greeting and the outside-hours reply within 72h of an automated outbound', () => {
    const h = { ...brandNew, lastOutboundMessageMs: WED_23_00 - 5 * HOUR, lastOutboundMessageAutomated: true };
    expect(blocked(decideAutoReply(input({ nowMs: WED_23_00, history: h })))).toBe('reply-to-automated');
    // Inside hours, brand-new by every other measure (an invoice reminder is the first message ever).
    expect(blocked(decideAutoReply(input({ history: { ...h, lastOutboundMessageMs: WED_11_00 - 2 * DAY } })))).toBe('reply-to-automated');
  });

  it('does not apply after the window, nor when the last outbound was a person', () => {
    const old = { ...brandNew, lastOutboundMessageMs: WED_23_00 - 4 * DAY, lastOutboundMessageAutomated: true };
    expect(blocked(decideAutoReply(input({ nowMs: WED_23_00, history: old })))).toBe('sent:outside-hours');
    const human = { ...brandNew, lastOutboundMessageMs: WED_23_00 - 5 * HOUR, lastOutboundMessageAutomated: false };
    expect(blocked(decideAutoReply(input({ nowMs: WED_23_00, history: human })))).toBe('sent:outside-hours');
  });

  it('honours a configured window (waReplyToAutomatedHours)', () => {
    const h = { ...brandNew, lastOutboundMessageMs: WED_23_00 - 30 * HOUR, lastOutboundMessageAutomated: true };
    expect(blocked(decideAutoReply(input({ nowMs: WED_23_00, history: h, settings: { ...settingsOn, waReplyToAutomatedHours: 24 } }))))
      .toBe('sent:outside-hours');
  });

  it('still reports opted-out / disabled first', () => {
    const h = { ...brandNew, lastOutboundMessageMs: WED_23_00 - HOUR, lastOutboundMessageAutomated: true };
    expect(blocked(decideAutoReply(input({ nowMs: WED_23_00, history: h, contact: { waOptOut: true } })))).toBe('opted-out');
    expect(blocked(decideAutoReply(input({ nowMs: WED_23_00, history: h, settings: {} })))).toBe('disabled');
  });
});

describe('decideAutoReply — replies', () => {
  it('greets a brand-new contact (both history fields null) with tokens rendered', () => {
    const d = decideAutoReply(input());
    expect(d).toEqual({ kind: 'greeting', text: 'Mirë se vini Arben! Si mund t\'ju ndihmojmë?' });
  });

  it('greets again after waGreetingAfterDays of silence, not before', () => {
    const quiet = { lastInboundBeforeMs: WED_11_00 - 10 * DAY, lastOutboundMs: WED_11_00 - 9 * DAY, lastAutoReplyMs: null };
    expect(decideAutoReply(input({ history: quiet }))).toMatchObject({ kind: 'greeting' });
    expect(decideAutoReply(input({ history: quiet, settings: { ...settingsOn, waGreetingAfterDays: 30 } })))
      .toEqual({ blocked: 'not-first-contact' });
  });

  it('outside-hours wins over greeting for a brand-new contact at night and on a weekend', () => {
    expect(decideAutoReply(input({ nowMs: WED_23_00 }))).toEqual({ kind: 'outside-hours', text: settingsOn.waAutoReplyText });
    expect(decideAutoReply(input({ nowMs: SAT_11_00 }))).toMatchObject({ kind: 'outside-hours' });
    // Meta and Baileys decide identically — a fresh inbound keeps Meta's window open.
    expect(decideAutoReply(input({ nowMs: WED_23_00, channel: 'meta' }))).toMatchObject({ kind: 'outside-hours' });
  });

  it('falls through to the greeting when the office is closed but the outside-hours reply is off', () => {
    const s = { ...settingsOn, waAutoReplyEnabled: false };
    expect(decideAutoReply(input({ nowMs: WED_23_00, settings: s }))).toMatchObject({ kind: 'greeting' });
  });

  it('answers media too (a photo is a message)', () => {
    expect(decideAutoReply(input({ kind: 'media', nowMs: WED_23_00 }))).toMatchObject({ kind: 'outside-hours' });
  });
});

describe('isOptOutMessage', () => {
  it('matches the whole-message keywords only', () => {
    for (const t of ['STOP', 'stop', 'Ndalo', ' hiq ', 'unsubscribe.', 'Stop!']) expect(isOptOutMessage(t)).toBe(true);
    for (const t of ['stop it', 'ndalo pak', 'hiqni ofertën', '', null, undefined]) expect(isOptOutMessage(t)).toBe(false);
    for (const t of ['START', 'fillo', 'Rifillo!']) expect(isOptOutMessage(t)).toBe(false);
  });
});

describe('isOptInMessage', () => {
  it('matches START / FILLO / RIFILLO as the whole message only', () => {
    for (const t of ['START', 'start', ' Fillo ', 'rifillo.', 'Start!']) expect(isOptInMessage(t)).toBe(true);
    for (const t of ['start the project', 'fillojmë nesër', 'stop', '', null, undefined]) expect(isOptInMessage(t)).toBe(false);
  });
});
