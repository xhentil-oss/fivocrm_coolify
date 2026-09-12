import type { Activity, Customer, FollowUpFields, FollowUpType, Lead, LeadActivityType } from '../../types';
import { getTimestampMs } from '../utils';
import { OPEN_STATUSES } from '../leadStages';
import { RECURRENCE_TIMEZONE, startOfRecurrenceDay, toZoned, fromZoned } from '../recurringUtils';

// ── Follow-up ("Ndjekja") — the ONE place that knows what a next step is ─────
//
// A contact (lead OR customer) carries at most one pending next step
// (`nextFollowUpDate` + `nextFollowUpType` + `followUpNote`). This module owns:
//   • when it is due (overdue / today / upcoming) — day math in Europe/Tirane,
//     never `setHours(0,0,0,0)` (a browser abroad and the cron must agree);
//   • the presets for scheduling and snoozing;
//   • the patches every write path uses (`touchContactPatch`, `snoozePatch`,
//     `scheduleNextStepPatch`, `completeFollowUpPatch`) — always with explicit
//     `null` when clearing, because `removeUndefined()` strips `undefined` and
//     would clear nothing;
//   • the queue builder behind /app/follow-ups, the dashboard widget and the
//     sidebar badge, so all three show the same counts.
//
// Mirrored (day math + block reasons) by the follow-up reminder cron in
// api/cron/run.ts — keep the two in sync.

export const DAY_MS = 86_400_000;
export const FOLLOW_UP_TIMEZONE = RECURRENCE_TIMEZONE;

export type DueState = 'overdue' | 'today' | 'upcoming' | 'none';

export type FollowUpContact = FollowUpFields & { status?: string };

export const FOLLOW_UP_TYPE_META: Record<FollowUpType, {
  label: string;
  /** Timeline row type on a lead when a step of this kind is completed. */
  activityType: LeadActivityType;
  /** `activities` row type on a customer. */
  customerActivityType: Activity['type'];
}> = {
  call:     { label: 'Telefonatë', activityType: 'call',     customerActivityType: 'call' },
  whatsapp: { label: 'WhatsApp',   activityType: 'whatsapp', customerActivityType: 'note' },
  email:    { label: 'Email',      activityType: 'email',    customerActivityType: 'email_sent' },
  meeting:  { label: 'Takim',      activityType: 'meeting',  customerActivityType: 'meeting' },
  other:    { label: 'Tjetër',     activityType: 'note',     customerActivityType: 'note' },
};

export const FOLLOW_UP_TYPES = Object.keys(FOLLOW_UP_TYPE_META) as FollowUpType[];

export type FollowUpOutcomeResult = 'reached' | 'no_answer' | 'left_message' | 'meeting_set';

export const OUTCOME_META: Record<FollowUpOutcomeResult, { label: string }> = {
  reached:      { label: 'Foli' },
  no_answer:    { label: "S'u përgjigj" },
  left_message: { label: 'La mesazh' },
  meeting_set:  { label: 'Takim caktuar' },
};

// ── Due state ────────────────────────────────────────────────────────────────

/** Calendar-day difference between two instants, read in the follow-up zone. */
export function dayDiffInZone(target: Date, now: Date): number {
  return Math.round((startOfRecurrenceDay(target) - startOfRecurrenceDay(now)) / DAY_MS);
}

const DUE_CLASS: Record<DueState, string> = {
  overdue:  'bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400',
  today:    'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-400',
  upcoming: 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/20 dark:text-blue-400',
  none:     'bg-muted text-muted-foreground border border-transparent',
};

export interface DueInfo {
  state: DueState;
  dueMs: number | null;
  /** Calendar days from today (negative = overdue). null when no next step. */
  dayDiff: number | null;
  label: string;
  className: string;
}

function shortDayLabel(at: Date): string {
  try {
    return new Intl.DateTimeFormat('sq-AL', {
      timeZone: FOLLOW_UP_TIMEZONE, weekday: 'short', day: 'numeric', month: 'short',
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export function dueState(contact: FollowUpContact | null | undefined, now: Date = new Date()): DueInfo {
  const dueMs = getTimestampMs(contact?.nextFollowUpDate) || 0;
  if (!dueMs) return { state: 'none', dueMs: null, dayDiff: null, label: 'Pa hap tjetër', className: DUE_CLASS.none };
  const diff = dayDiffInZone(new Date(dueMs), now);
  if (diff < 0) {
    return { state: 'overdue', dueMs, dayDiff: diff, label: `Vonuar ${-diff} ditë`, className: DUE_CLASS.overdue };
  }
  if (diff === 0) return { state: 'today', dueMs, dayDiff: 0, label: 'Sot', className: DUE_CLASS.today };
  if (diff === 1) return { state: 'upcoming', dueMs, dayDiff: 1, label: 'Nesër', className: DUE_CLASS.upcoming };
  return { state: 'upcoming', dueMs, dayDiff: diff, label: shortDayLabel(new Date(dueMs)), className: DUE_CLASS.upcoming };
}

// ── Presets ──────────────────────────────────────────────────────────────────

export type NextStepPresetKey = 'today' | 'tomorrow' | '3d' | 'next_week' | '2w' | 'custom';
export type SnoozePresetKey = '1d' | '3d' | 'next_week' | 'custom';

export const NEXT_STEP_PRESETS: { key: NextStepPresetKey; label: string }[] = [
  { key: 'tomorrow',  label: 'Nesër' },
  { key: '3d',        label: '+3 ditë' },
  { key: 'next_week', label: 'Javën tjetër' },
  { key: '2w',        label: '+2 javë' },
  { key: 'custom',    label: 'Datë tjetër' },
];

/** Snooze is relative to TODAY, never to the old due date: an item ten days
 *  overdue snoozed "+1 ditë" lands tomorrow, not nine days ago. */
export const SNOOZE_PRESETS: { key: SnoozePresetKey; label: string }[] = [
  { key: '1d',        label: '+1 ditë' },
  { key: '3d',        label: '+3 ditë' },
  { key: 'next_week', label: 'Javën tjetër' },
  { key: 'custom',    label: 'Datë tjetër' },
];

/**
 * Noon (Europe/Tirane) of the day `daysFromNow` days after today. Noon, not
 * midnight, so a DST shift of ±1h can never push the instant across a day
 * boundary when it is later re-read in another zone.
 */
export function dayAtNoon(now: Date, daysFromNow: number): Date {
  const z = toZoned(now, FOLLOW_UP_TIMEZONE);
  z.setUTCHours(12, 0, 0, 0);
  z.setUTCDate(z.getUTCDate() + daysFromNow);
  return fromZoned(z, FOLLOW_UP_TIMEZONE);
}

/** Days until the NEXT Monday (a Monday today → next week's Monday, 7). */
function daysToNextMonday(now: Date): number {
  const dow = toZoned(now, FOLLOW_UP_TIMEZONE).getUTCDay(); // 0 = Sunday
  const diff = (8 - dow) % 7;
  return diff === 0 ? 7 : diff;
}

export function dayFromPreset(key: NextStepPresetKey | SnoozePresetKey, now: Date = new Date()): Date {
  switch (key) {
    case 'today':     return dayAtNoon(now, 0);
    case 'tomorrow':
    case '1d':        return dayAtNoon(now, 1);
    case '3d':        return dayAtNoon(now, 3);
    case 'next_week': return dayAtNoon(now, daysToNextMonday(now));
    case '2w':        return dayAtNoon(now, 14);
    default:          return dayAtNoon(now, 1);
  }
}

/** Normalise a picked calendar date to noon in the zone (same day the user saw). */
export function normalizeFollowUpDate(date: Date): Date {
  const z = toZoned(date, FOLLOW_UP_TIMEZONE);
  z.setUTCHours(12, 0, 0, 0);
  return fromZoned(z, FOLLOW_UP_TIMEZONE);
}

// ── Patches ──────────────────────────────────────────────────────────────────

export interface NextStep {
  date: Date;
  type?: FollowUpType | null;
  note?: string | null;
}

export type FollowUpEntity = 'lead' | 'customer';

/** Only the date moves; type and note are preserved. */
export function snoozePatch(presetOrDate: SnoozePresetKey | Date, now: Date = new Date()): Partial<FollowUpFields> {
  const date = presetOrDate instanceof Date ? normalizeFollowUpDate(presetOrDate) : dayFromPreset(presetOrDate, now);
  return { nextFollowUpDate: date };
}

/** Set or clear the pending next step. Clearing writes explicit nulls. */
export function scheduleNextStepPatch(next: NextStep | null): Partial<FollowUpFields> {
  if (!next) return { nextFollowUpDate: null, nextFollowUpType: null, followUpNote: null };
  return {
    nextFollowUpDate: normalizeFollowUpDate(next.date),
    nextFollowUpType: next.type ?? 'call',
    followUpNote: next.note?.trim() ? next.note.trim() : null,
  };
}

export interface TouchOptions {
  entity: FollowUpEntity;
  /** The touch was a deliberate follow-up (stamps `lastFollowUpDate`). */
  countsAsFollowUp?: boolean;
}

/**
 * Every OUTBOUND action (call logged, WhatsApp sent, email sent, meeting held)
 * goes through here. Replaces `bumpLeadActivity` and the hand-written patches
 * CRMView used to spread after a send.
 */
export function touchContactPatch(
  contact: FollowUpContact & { firstResponseAt?: Date | null },
  channel: FollowUpType,
  now: Date = new Date(),
  opts: TouchOptions,
): Partial<FollowUpFields> & { firstResponseAt?: Date; awaitingReply?: boolean | null } {
  const patch: Partial<FollowUpFields> & { firstResponseAt?: Date; awaitingReply?: boolean | null } = {
    lastActivityAt: now,
  };
  if (opts.entity === 'lead' && channel !== 'other' && !contact.firstResponseAt) {
    patch.firstResponseAt = now;
  }
  if (opts.countsAsFollowUp) patch.lastFollowUpDate = now;
  // A reply from us closes the "they are waiting" flag on either entity.
  if (contact.awaitingReply && channel !== 'other') patch.awaitingReply = false;
  return patch;
}

export interface FollowUpOutcome {
  channel: FollowUpType;
  result?: FollowUpOutcomeResult | null;
}

/** "U bë ✓": stamp the touch AND set (or clear) what comes next — one write. */
export function completeFollowUpPatch(
  contact: FollowUpContact & { firstResponseAt?: Date | null },
  outcome: FollowUpOutcome,
  next: NextStep | null,
  now: Date = new Date(),
  opts: TouchOptions,
): Partial<FollowUpFields> & { firstResponseAt?: Date; awaitingReply?: boolean | null } {
  return {
    ...touchContactPatch(contact, outcome.channel, now, { ...opts, countsAsFollowUp: true }),
    ...scheduleNextStepPatch(next),
  };
}

/** A brand-new lead that gets touched is, by definition, Contacted. */
export function statusAfterTouch(lead: Pick<Lead, 'status'>): Lead['status'] | null {
  return lead.status === 'New' ? 'Contacted' : null;
}

/** An open lead with nothing planned is the drift the queue exists to expose. */
export function needsNextStep(lead: Pick<Lead, 'status' | 'nextFollowUpDate'>): boolean {
  return (OPEN_STATUSES as string[]).includes(lead.status) && !getTimestampMs(lead.nextFollowUpDate);
}

export function isOpenLead(lead: Pick<Lead, 'status'>): boolean {
  return (OPEN_STATUSES as string[]).includes(lead.status);
}

const INACTIVE_CUSTOMER_STATUSES = new Set(['Inactive', 'Suspended']);

export function isActiveCustomer(c: Pick<Customer, 'status'>): boolean {
  return !INACTIVE_CUSTOMER_STATUSES.has(c.status || 'Active');
}

/** Days since the contact was last touched; null = never. */
export function daysSinceContact(contact: FollowUpContact, now: Date = new Date()): number | null {
  const last = Math.max(getTimestampMs(contact.lastActivityAt) || 0, getTimestampMs(contact.lastFollowUpDate) || 0);
  if (!last) return null;
  return Math.max(0, Math.floor((now.getTime() - last) / DAY_MS));
}

/** Human "N ditë / N orë" since the contact wrote to us (Presin përgjigje). */
export function waitingSince(contact: FollowUpContact, now: Date = new Date()): string | null {
  const ms = getTimestampMs(contact.lastInboundAt);
  if (!ms) return null;
  const mins = Math.max(0, Math.floor((now.getTime() - ms) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} orë`;
  return `${Math.floor(hours / 24)} ditë`;
}

// ── Queue ────────────────────────────────────────────────────────────────────

export interface FollowUpItem {
  kind: FollowUpEntity;
  id: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  assignedToUserId?: string | null;
  createdByUserId?: string | null;
  due: DueInfo;
  type: FollowUpType;
  note?: string | null;
  awaitingReply: boolean;
  lastInboundAt: number | null;
  raw: Lead | Customer;
}

export interface FollowUpQueue {
  /** The contact wrote to us and nobody answered — first, always. */
  awaitingReply: FollowUpItem[];
  overdue: FollowUpItem[];
  today: FollowUpItem[];
  thisWeek: FollowUpItem[];
  /** Open leads with no next step (the drift). */
  noNextStep: FollowUpItem[];
  counts: { awaitingReply: number; overdue: number; today: number; thisWeek: number; noNextStep: number; due: number };
}

function leadItem(lead: Lead, now: Date): FollowUpItem {
  return {
    kind: 'lead',
    id: lead.id,
    name: lead.name,
    company: lead.company,
    phone: lead.phoneNumber || lead.phone,
    email: lead.email,
    assignedToUserId: lead.assignedToUserId ?? null,
    createdByUserId: lead.createdByUserId ?? null,
    due: dueState(lead, now),
    type: lead.nextFollowUpType || 'other',
    note: lead.followUpNote ?? null,
    awaitingReply: !!lead.awaitingReply,
    lastInboundAt: getTimestampMs(lead.lastInboundAt) || null,
    raw: lead,
  };
}

function customerItem(c: Customer, now: Date): FollowUpItem {
  return {
    kind: 'customer',
    id: c.id,
    name: c.name,
    company: c.company,
    phone: c.phone,
    email: c.email,
    assignedToUserId: c.assignedToUserId ?? null,
    createdByUserId: c.createdByUserId ?? null,
    due: dueState(c, now),
    type: c.nextFollowUpType || 'other',
    note: c.followUpNote ?? null,
    awaitingReply: !!c.awaitingReply,
    lastInboundAt: getTimestampMs(c.lastInboundAt) || null,
    raw: c,
  };
}

function byDue(a: FollowUpItem, b: FollowUpItem): number {
  const ad = a.due.dueMs ?? Number.POSITIVE_INFINITY;
  const bd = b.due.dueMs ?? Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad - bd;
  return a.name.localeCompare(b.name, 'sq');
}

function byWaiting(a: FollowUpItem, b: FollowUpItem): number {
  // Longest wait first.
  return (a.lastInboundAt ?? 0) - (b.lastInboundAt ?? 0) || a.name.localeCompare(b.name, 'sq');
}

/**
 * Build the queue. `weekEndDayDiff` is how many calendar days ahead still count
 * as "këtë javë" (default 7 — the next seven days, not the ISO week, so a Friday
 * still shows what is due Monday).
 */
export function buildFollowUpQueue(
  leads: Lead[] | undefined | null,
  customers: Customer[] | undefined | null,
  now: Date = new Date(),
  opts: { weekEndDayDiff?: number } = {},
): FollowUpQueue {
  const weekEnd = opts.weekEndDayDiff ?? 7;
  const items: FollowUpItem[] = [];
  for (const l of leads || []) if (isOpenLead(l)) items.push(leadItem(l, now));
  for (const c of customers || []) if (isActiveCustomer(c)) items.push(customerItem(c, now));

  const awaitingReply = items.filter(i => i.awaitingReply).sort(byWaiting);
  const overdue = items.filter(i => i.due.state === 'overdue').sort(byDue);
  const today = items.filter(i => i.due.state === 'today').sort(byDue);
  const thisWeek = items
    .filter(i => i.due.state === 'upcoming' && (i.due.dayDiff ?? Infinity) <= weekEnd)
    .sort(byDue);
  const noNextStep = items
    .filter(i => i.kind === 'lead' && i.due.state === 'none')
    .sort((a, b) => a.name.localeCompare(b.name, 'sq'));

  return {
    awaitingReply, overdue, today, thisWeek, noNextStep,
    counts: {
      awaitingReply: awaitingReply.length,
      overdue: overdue.length,
      today: today.length,
      thisWeek: thisWeek.length,
      noNextStep: noNextStep.length,
      due: overdue.length + today.length,
    },
  };
}

/** "Të miat": assigned to me, or unassigned and created by me. */
export function isMineItem(item: FollowUpItem, uid: string | null | undefined): boolean {
  if (!uid) return false;
  if (item.assignedToUserId) return item.assignedToUserId === uid;
  return item.createdByUserId === uid;
}

/** Deep link for an item's record page. */
export function followUpItemHref(item: Pick<FollowUpItem, 'kind' | 'id'>): string {
  return item.kind === 'lead' ? `/app/crm?lead=${item.id}` : `/app/customers/${item.id}`;
}

/** Title for the timeline row written when a step is completed. */
export function completionTitle(outcome: FollowUpOutcome, next: NextStep | null, now: Date = new Date()): string {
  const parts = ['Ndjekje e kryer', FOLLOW_UP_TYPE_META[outcome.channel].label];
  if (outcome.result) parts.push(OUTCOME_META[outcome.result].label);
  const head = parts.join(' · ');
  if (!next) return head;
  const d = dueState({ nextFollowUpDate: normalizeFollowUpDate(next.date) }, now);
  return `${head} → hapi tjetër ${d.label.toLowerCase()}`;
}
