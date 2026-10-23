import { describe, it, expect } from 'vitest';
import {
  dueState, dayFromPreset, dayAtNoon, snoozePatch, scheduleNextStepPatch, touchContactPatch,
  completeFollowUpPatch, statusAfterTouch, needsNextStep, buildFollowUpQueue, daysSinceContact,
  isMineItem, completionTitle, normalizeFollowUpDate, waitingSince, contactTags,
} from './followUp';
import type { Customer, Lead } from '../../types';

// Instants are expressed in UTC; Tirana is UTC+2 in summer, UTC+1 in winter.
const lead = (over: Partial<Lead> = {}): Lead => ({
  id: 'l1', name: 'Arben', status: 'Qualified',
  createdAt: new Date('2026-09-01T08:00:00Z'), updatedAt: new Date('2026-09-01T08:00:00Z'),
  createdByUserId: 'u1', ...over,
} as Lead);

const customer = (over: Partial<Customer> = {}): Customer => ({
  id: 'c1', name: 'Blerta', createdAt: new Date('2026-01-01T08:00:00Z'),
  updatedAt: new Date('2026-01-01T08:00:00Z'), createdByUserId: 'u1', ...over,
} as Customer);

const zonedDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tirane', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const zonedHour = (d: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Tirane', hour: '2-digit', hour12: false }).format(d));

describe('dueState — day math in Europe/Tirane', () => {
  const now = new Date('2026-09-12T10:00:00Z'); // Saturday 12:00 Tirana

  it('none when no next step', () => {
    expect(dueState(lead(), now).state).toBe('none');
    expect(dueState(lead({ nextFollowUpDate: null }), now).state).toBe('none');
  });

  it('today / tomorrow / overdue by calendar day, not by 24h', () => {
    expect(dueState(lead({ nextFollowUpDate: new Date('2026-09-12T21:30:00Z') }), now)).toMatchObject({ state: 'today', dayDiff: 0, label: 'Sot' });
    // 23:30 UTC on the 12th is already 01:30 on the 13th in Tirana → Nesër.
    expect(dueState(lead({ nextFollowUpDate: new Date('2026-09-12T23:30:00Z') }), now)).toMatchObject({ state: 'upcoming', dayDiff: 1, label: 'Nesër' });
    expect(dueState(lead({ nextFollowUpDate: new Date('2026-09-09T10:00:00Z') }), now)).toMatchObject({ state: 'overdue', dayDiff: -3, label: 'Vonuar 3 ditë' });
  });

  it('accepts Firestore-like timestamps and ISO strings', () => {
    expect(dueState({ nextFollowUpDate: { toMillis: () => Date.parse('2026-09-12T08:00:00Z') } as any }, now).state).toBe('today');
    expect(dueState({ nextFollowUpDate: '2026-09-15T08:00:00Z' as any }, now).state).toBe('upcoming');
  });

  it('is stable across the DST switches', () => {
    // Spring forward 2026-03-29 (02:00 → 03:00). Due "tomorrow" set on the 28th stays the 29th.
    const sat = new Date('2026-03-28T11:00:00Z');
    const due = dayFromPreset('tomorrow', sat);
    expect(zonedDay(due)).toBe('2026-03-29');
    expect(dueState({ nextFollowUpDate: due }, new Date('2026-03-29T05:00:00Z')).state).toBe('today');
    // Fall back 2026-10-25.
    const fri = new Date('2026-10-24T11:00:00Z');
    const due2 = dayFromPreset('tomorrow', fri);
    expect(zonedDay(due2)).toBe('2026-10-25');
    expect(dueState({ nextFollowUpDate: due2 }, new Date('2026-10-26T05:00:00Z')).state).toBe('overdue');
  });
});

describe('presets', () => {
  it('land at noon in the zone (never on a day boundary)', () => {
    const d = dayAtNoon(new Date('2026-09-12T23:30:00Z'), 0); // already the 13th in Tirana
    expect(zonedDay(d)).toBe('2026-09-13');
    expect(zonedHour(d)).toBe(12);
  });

  it('next_week is the next Monday — from a Sunday and from a Monday', () => {
    expect(zonedDay(dayFromPreset('next_week', new Date('2026-09-13T10:00:00Z')))).toBe('2026-09-14'); // Sunday → tomorrow
    expect(zonedDay(dayFromPreset('next_week', new Date('2026-09-14T10:00:00Z')))).toBe('2026-09-21'); // Monday → +7
    expect(zonedDay(dayFromPreset('next_week', new Date('2026-09-11T10:00:00Z')))).toBe('2026-09-14'); // Friday
  });

  it('+3 ditë and +2 javë', () => {
    const now = new Date('2026-09-12T10:00:00Z');
    expect(zonedDay(dayFromPreset('3d', now))).toBe('2026-09-15');
    expect(zonedDay(dayFromPreset('2w', now))).toBe('2026-09-26');
  });

  it('snooze is relative to today, not to the old due date', () => {
    const now = new Date('2026-09-12T10:00:00Z');
    const p = snoozePatch('1d', now);
    expect(zonedDay(p.nextFollowUpDate as Date)).toBe('2026-09-13');
    expect(Object.keys(p)).toEqual(['nextFollowUpDate']);
  });
});

describe('patches — explicit nulls, single source of stamps', () => {
  const now = new Date('2026-09-12T10:00:00Z');

  it('scheduleNextStepPatch(null) clears with null, never undefined', () => {
    const p = scheduleNextStepPatch(null);
    expect(p).toEqual({ nextFollowUpDate: null, nextFollowUpType: null, followUpNote: null });
    expect(Object.values(p).every(v => v === null)).toBe(true);
  });

  it('scheduleNextStepPatch normalises to noon and defaults the type', () => {
    const p = scheduleNextStepPatch({ date: new Date('2026-09-15T22:30:00Z'), note: '  dërgo ofertën ' });
    expect(zonedDay(p.nextFollowUpDate as Date)).toBe('2026-09-16');
    expect(p.nextFollowUpType).toBe('call');
    expect(p.followUpNote).toBe('dërgo ofertën');
    expect(scheduleNextStepPatch({ date: now, note: '   ' }).followUpNote).toBeNull();
  });

  it('touchContactPatch sets firstResponseAt once, only for leads, never for "other"', () => {
    const l = lead();
    const p1 = touchContactPatch(l, 'call', now, { entity: 'lead' });
    expect(p1.firstResponseAt).toEqual(now);
    expect(p1.lastActivityAt).toEqual(now);
    expect(p1.lastFollowUpDate).toBeUndefined();

    const p2 = touchContactPatch(lead({ firstResponseAt: new Date('2026-09-01T09:00:00Z') }), 'call', now, { entity: 'lead' });
    expect(p2.firstResponseAt).toBeUndefined();

    const p3 = touchContactPatch(l, 'other', now, { entity: 'lead' });
    expect(p3.firstResponseAt).toBeUndefined();

    const p4 = touchContactPatch(customer(), 'call', now, { entity: 'customer', countsAsFollowUp: true });
    expect((p4 as any).firstResponseAt).toBeUndefined();
    expect(p4.lastFollowUpDate).toEqual(now);
  });

  it('a reply from us clears awaitingReply', () => {
    const p = touchContactPatch(lead({ awaitingReply: true }), 'whatsapp', now, { entity: 'lead' });
    expect(p.awaitingReply).toBe(false);
    expect(touchContactPatch(lead(), 'whatsapp', now, { entity: 'lead' }).awaitingReply).toBeUndefined();
  });

  it('completeFollowUpPatch = touch (as follow-up) + next step', () => {
    const p = completeFollowUpPatch(lead(), { channel: 'call', result: 'reached' }, { date: dayFromPreset('3d', now), type: 'email' }, now, { entity: 'lead' });
    expect(p.lastFollowUpDate).toEqual(now);
    expect(p.firstResponseAt).toEqual(now);
    expect(p.nextFollowUpType).toBe('email');
    expect(zonedDay(p.nextFollowUpDate as Date)).toBe('2026-09-15');

    const cleared = completeFollowUpPatch(lead(), { channel: 'call' }, null, now, { entity: 'lead' });
    expect(cleared.nextFollowUpDate).toBeNull();
    expect(cleared.nextFollowUpType).toBeNull();
  });

  it('statusAfterTouch only promotes New', () => {
    expect(statusAfterTouch(lead({ status: 'New' }))).toBe('Contacted');
    expect(statusAfterTouch(lead({ status: 'Proposal' }))).toBeNull();
  });
});

describe('needsNextStep / daysSinceContact / waitingSince', () => {
  const now = new Date('2026-09-12T10:00:00Z');
  it('open lead without a date needs a step; closed ones never do', () => {
    expect(needsNextStep(lead())).toBe(true);
    expect(needsNextStep(lead({ nextFollowUpDate: now }))).toBe(false);
    expect(needsNextStep(lead({ status: 'Won' }))).toBe(false);
    expect(needsNextStep(lead({ status: 'Lost' }))).toBe(false);
    expect(needsNextStep(lead({ status: 'Converted' }))).toBe(false);
  });
  it('daysSinceContact uses the newest of lastActivityAt / lastFollowUpDate; null when never', () => {
    expect(daysSinceContact(customer(), now)).toBeNull();
    expect(daysSinceContact(customer({ lastActivityAt: new Date('2026-08-01T10:00:00Z'), lastFollowUpDate: new Date('2026-09-10T10:00:00Z') }), now)).toBe(2);
  });
  it('waitingSince formats minutes / hours / days', () => {
    expect(waitingSince(lead({ lastInboundAt: new Date('2026-09-12T09:40:00Z') }), now)).toBe('20 min');
    expect(waitingSince(lead({ lastInboundAt: new Date('2026-09-12T04:00:00Z') }), now)).toBe('6 orë');
    expect(waitingSince(lead({ lastInboundAt: new Date('2026-09-09T04:00:00Z') }), now)).toBe('3 ditë');
    expect(waitingSince(lead(), now)).toBeNull();
  });
});

describe('buildFollowUpQueue', () => {
  const now = new Date('2026-09-12T10:00:00Z'); // Saturday

  it('groups, filters closed leads and inactive customers, sorts by due then name', () => {
    const q = buildFollowUpQueue(
      [
        lead({ id: 'a', name: 'Zana', nextFollowUpDate: new Date('2026-09-10T10:00:00Z') }),        // overdue 2
        lead({ id: 'b', name: 'Agim', nextFollowUpDate: new Date('2026-09-05T10:00:00Z') }),        // overdue 7
        lead({ id: 'c', name: 'Besa', nextFollowUpDate: new Date('2026-09-12T15:00:00Z') }),        // today
        lead({ id: 'd', name: 'Drita', nextFollowUpDate: new Date('2026-09-16T10:00:00Z') }),       // this week
        lead({ id: 'e', name: 'Erion', nextFollowUpDate: new Date('2026-10-05T10:00:00Z') }),       // later — not in queue
        lead({ id: 'f', name: 'Flori' }),                                                             // no next step
        lead({ id: 'g', name: 'Genta', status: 'Lost', nextFollowUpDate: new Date('2026-09-01T10:00:00Z') }), // closed — out
        lead({ id: 'h', name: 'Hana', awaitingReply: true, lastInboundAt: new Date('2026-09-12T08:00:00Z') }),
      ],
      [
        customer({ id: 'c1', name: 'Blerta', nextFollowUpDate: new Date('2026-09-12T08:00:00Z') }), // today
        customer({ id: 'c2', name: 'Ilir', status: 'Inactive', nextFollowUpDate: new Date('2026-09-01T08:00:00Z') }), // out
        customer({ id: 'c3', name: 'Jona' }), // customers without a step are NOT in noNextStep
      ],
      now,
    );
    expect(q.overdue.map(i => i.id)).toEqual(['b', 'a']);
    expect(q.today.map(i => i.id)).toEqual(['c1', 'c']);   // Blerta 08:00Z before Besa 15:00Z
    expect(q.thisWeek.map(i => i.id)).toEqual(['d']);
    expect(q.noNextStep.map(i => i.id)).toEqual(['f', 'h']);
    expect(q.awaitingReply.map(i => i.id)).toEqual(['h']);
    expect(q.counts).toEqual({ awaitingReply: 1, overdue: 2, today: 2, thisWeek: 1, noNextStep: 2, due: 4 });
  });

  it('isMineItem: assigned to me, or unassigned and created by me', () => {
    const q = buildFollowUpQueue([
      lead({ id: 'a', assignedToUserId: 'me', createdByUserId: 'other' }),
      lead({ id: 'b', assignedToUserId: 'other', createdByUserId: 'me' }),
      lead({ id: 'c', createdByUserId: 'me' }),
    ], [], now);
    const byId = Object.fromEntries(q.noNextStep.map(i => [i.id, i]));
    expect(isMineItem(byId.a, 'me')).toBe(true);
    expect(isMineItem(byId.b, 'me')).toBe(false);
    expect(isMineItem(byId.c, 'me')).toBe(true);
    expect(isMineItem(byId.c, null)).toBe(false);
  });
});

describe('completionTitle', () => {
  const now = new Date('2026-09-12T10:00:00Z');
  it('describes the touch and the next step', () => {
    expect(completionTitle({ channel: 'call', result: 'reached' }, null, now)).toBe('Ndjekje e kryer · Telefonatë · Foli');
    expect(completionTitle({ channel: 'whatsapp' }, { date: dayFromPreset('tomorrow', now) }, now)).toBe('Ndjekje e kryer · WhatsApp → hapi tjetër nesër');
    expect(normalizeFollowUpDate(new Date('2026-09-12T23:30:00Z')).getTime()).toBe(dayAtNoon(new Date('2026-09-12T23:30:00Z'), 0).getTime());
  });
});

describe('contactTags — tolerates legacy non-array tags', () => {
  it('returns a clean list for an array', () => {
    expect(contactTags({ tags: [' SEO ', 'ads', '', 'seo', null] })).toEqual(['SEO', 'ads']);
  });
  it('splits a comma/semicolon string (CSV import / hand edit)', () => {
    expect(contactTags({ tags: 'seo, ads;web' })).toEqual(['seo', 'ads', 'web']);
  });
  it('reads a map by its values and ignores everything else', () => {
    expect(contactTags({ tags: { a: 'x', b: 'y' } })).toEqual(['x', 'y']);
    expect(contactTags({ tags: 42 })).toEqual([]);
    expect(contactTags({})).toEqual([]);
    expect(contactTags(null)).toEqual([]);
  });
});
