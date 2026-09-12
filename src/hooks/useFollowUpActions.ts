import React, { useCallback, useMemo } from 'react';
import { useMutation } from './useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './use-toast';
import { ToastAction } from '../components/ui/toast';
import { logLeadActivity } from '../components/LeadTimeline';
import {
  FOLLOW_UP_TYPE_META, completeFollowUpPatch, completionTitle, scheduleNextStepPatch, snoozePatch,
  statusAfterTouch, touchContactPatch, dueState,
  type FollowUpEntity, type FollowUpOutcome, type NextStep, type SnoozePresetKey,
} from '../lib/crm/followUp';
import type { Customer, FollowUpType, Lead } from '../types';

// ── The ONE write path for follow-up state (leads AND customers) ─────────────
//
// Every surface — the /app/follow-ups queue, the dashboard widget, the CRM
// drawer, CustomersView, Customer360 — calls these. Nothing else may spread a
// follow-up patch by hand: `removeUndefined()` strips `undefined`, so an ad-hoc
// `update({ nextFollowUpDate: undefined })` clears nothing, and the timeline row
// would be forgotten. Timeline writes are fire-and-forget (existing convention).

export interface FollowUpTarget {
  kind: FollowUpEntity;
  id: string;
  name: string;
  raw: Lead | Customer;
}

export const targetFromLead = (lead: Lead): FollowUpTarget => ({ kind: 'lead', id: lead.id, name: lead.name, raw: lead });
export const targetFromCustomer = (c: Customer): FollowUpTarget => ({ kind: 'customer', id: c.id, name: c.name, raw: c });

type Snapshot = Record<string, unknown>;

const SNAPSHOT_KEYS = [
  'nextFollowUpDate', 'nextFollowUpType', 'followUpNote', 'lastFollowUpDate',
  'lastActivityAt', 'firstResponseAt', 'awaitingReply', 'status',
] as const;

/** Values as they were, with `null` for fields that did not exist — so undo can CLEAR them. */
function snapshotOf(raw: Record<string, any>, keys: readonly string[]): Snapshot {
  const snap: Snapshot = {};
  for (const k of keys) snap[k] = raw[k] === undefined ? null : raw[k];
  return snap;
}

const TOUCH_TITLES: Record<FollowUpType, string> = {
  call: 'Telefonatë e regjistruar',
  whatsapp: 'WhatsApp i dërguar',
  email: 'Email i dërguar',
  meeting: 'Takim i regjistruar',
  other: 'Kontakt i regjistruar',
};

export function useFollowUpActions() {
  const leadMutation = useMutation<Lead>('leads');
  const customerMutation = useMutation<Customer>('customers');
  const leadActivityMutation = useMutation<any>('leadActivities');
  const activityMutation = useMutation<any>('activities');
  const { user } = useAuth();
  const { toast } = useToast();
  const userName = user?.displayName || user?.email || undefined;

  const update = useCallback((t: FollowUpTarget, patch: Record<string, any>) =>
    (t.kind === 'lead' ? leadMutation.update(t.id, patch as any) : customerMutation.update(t.id, patch as any)),
  [leadMutation, customerMutation]);

  /** Timeline row on the right collection for the entity. */
  const logTimeline = useCallback((t: FollowUpTarget, channel: FollowUpType, title: string, body?: string, meta?: Record<string, any>) => {
    if (t.kind === 'lead') {
      void logLeadActivity(leadActivityMutation.create, {
        leadId: t.id, type: FOLLOW_UP_TYPE_META[channel].activityType, title, body, meta, userName,
      });
    } else {
      activityMutation.create({
        type: FOLLOW_UP_TYPE_META[channel].customerActivityType,
        title,
        description: body || undefined,
        entityType: 'customer',
        entityId: t.id,
        customerId: t.id,
        userId: user?.uid || '',
        ...(meta ? { meta } : {}),
      } as any).catch(() => { /* non-critical */ });
    }
  }, [leadActivityMutation, activityMutation, user?.uid, userName]);

  const withStatus = (t: FollowUpTarget, patch: Record<string, any>) => {
    if (t.kind !== 'lead') return patch;
    const next = statusAfterTouch(t.raw as Lead);
    return next ? { ...patch, status: next } : patch;
  };

  const undoToast = useCallback((t: FollowUpTarget, title: string, description: string | undefined, snap: Snapshot) => {
    toast({
      title,
      description,
      action: React.createElement(ToastAction, {
        altText: 'Anulo',
        onClick: async () => {
          try {
            await update(t, snap);
            toast({ title: 'U anulua', description: t.name });
          } catch {
            toast({ title: 'Gabim', description: 'Anulimi dështoi', variant: 'destructive' });
          }
        },
      }, 'Anulo'),
    });
  }, [toast, update]);

  /** "U bë ✓" — log the outcome, stamp the touch, set (or clear) the next step. */
  const complete = useCallback(async (t: FollowUpTarget, outcome: FollowUpOutcome, next: NextStep | null, opts: { silent?: boolean } = {}) => {
    const now = new Date();
    const snap = snapshotOf(t.raw as any, SNAPSHOT_KEYS);
    const patch = withStatus(t, completeFollowUpPatch(t.raw as any, outcome, next, now, { entity: t.kind }));
    try {
      await update(t, patch);
    } catch {
      toast({ title: 'Gabim', description: 'Ndjekja nuk u ruajt', variant: 'destructive' });
      return null;
    }
    const title = completionTitle(outcome, next, now);
    logTimeline(t, outcome.channel, title, undefined, {
      followUp: true, outcome: outcome.result || null, next: next ? scheduleNextStepPatch(next).nextFollowUpDate : null,
    });
    if (!opts.silent) {
      undoToast(t, 'Ndjekja u krye', next ? `${t.name} · hapi tjetër ${dueState({ nextFollowUpDate: scheduleNextStepPatch(next).nextFollowUpDate }, now).label.toLowerCase()}` : t.name, snap);
    }
    return snap;
  }, [update, logTimeline, undoToast, toast]);

  /** Move only the date (type + note preserved). */
  const snooze = useCallback(async (t: FollowUpTarget, presetOrDate: SnoozePresetKey | Date, opts: { silent?: boolean } = {}) => {
    const now = new Date();
    const snap = snapshotOf(t.raw as any, ['nextFollowUpDate']);
    const patch = snoozePatch(presetOrDate, now);
    try {
      await update(t, patch);
    } catch {
      toast({ title: 'Gabim', description: 'Shtyrja dështoi', variant: 'destructive' });
      return null;
    }
    if (!opts.silent) {
      undoToast(t, 'U shty', `${t.name} → ${dueState({ nextFollowUpDate: patch.nextFollowUpDate }, now).label}`, snap);
    }
    return snap;
  }, [update, undoToast, toast]);

  /** Set or clear the pending next step without logging a touch. */
  const schedule = useCallback(async (t: FollowUpTarget, next: NextStep | null, opts: { silent?: boolean } = {}) => {
    const now = new Date();
    const snap = snapshotOf(t.raw as any, ['nextFollowUpDate', 'nextFollowUpType', 'followUpNote']);
    const patch = scheduleNextStepPatch(next);
    try {
      await update(t, patch);
    } catch {
      toast({ title: 'Gabim', description: 'Hapi tjetër nuk u ruajt', variant: 'destructive' });
      return null;
    }
    if (next) {
      const due = dueState({ nextFollowUpDate: patch.nextFollowUpDate }, now);
      if (t.kind === 'lead') {
        void logLeadActivity(leadActivityMutation.create, {
          leadId: t.id, type: 'followup_scheduled',
          title: `Hapi tjetër: ${FOLLOW_UP_TYPE_META[patch.nextFollowUpType || 'call'].label} · ${due.label}`,
          body: patch.followUpNote || undefined, userName,
        });
      }
      if (!opts.silent) toast({ title: 'Hapi tjetër u caktua', description: `${t.name} · ${due.label}` });
    } else if (!opts.silent) {
      toast({ title: 'Hapi tjetër u hoq', description: t.name });
    }
    return snap;
  }, [update, leadActivityMutation, userName, toast]);

  /** Stamp an outbound touch without a timeline row (the caller already logged one, e.g. WhatsAppChatPanel). */
  const touch = useCallback(async (t: FollowUpTarget, channel: FollowUpType, opts: { countsAsFollowUp?: boolean } = {}) => {
    const patch = withStatus(t, touchContactPatch(t.raw as any, channel, new Date(), { entity: t.kind, countsAsFollowUp: opts.countsAsFollowUp }));
    await update(t, patch).catch(() => { /* non-critical */ });
  }, [update]);

  /** Touch + timeline row — for calls confirmed via the "A e kontaktove?" prompt, WhatsApp sends, emails. */
  const logContact = useCallback(async (t: FollowUpTarget, channel: FollowUpType, body?: string, opts: { title?: string; countsAsFollowUp?: boolean } = {}) => {
    await touch(t, channel, { countsAsFollowUp: opts.countsAsFollowUp ?? true });
    logTimeline(t, channel, opts.title || TOUCH_TITLES[channel], body);
  }, [touch, logTimeline]);

  return useMemo(() => ({ complete, snooze, schedule, touch, logContact, logTimeline }), [complete, snooze, schedule, touch, logContact, logTimeline]);
}

export type FollowUpActions = ReturnType<typeof useFollowUpActions>;
