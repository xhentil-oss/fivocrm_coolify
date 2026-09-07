/**
 * CRM automation rules — the PURE engine ("kur X, nëse Y, atëherë Z").
 *
 * No Firestore, no React, no Date.now(): every function takes `now` and plain
 * records, so the browser (rule builder preview) and the cron (`crm-automations`
 * in api/_crmAutomationJob.ts) evaluate a rule IDENTICALLY. The number the user
 * approved in the preview is the number that fires.
 *
 * MIRROR: `api/_crmAutomationEngine.ts` must stay byte-identical to this file —
 * `automationRules.test.ts` fails the run if the two drift. `api/` never imports
 * from `src/`, so the mirror is a copy, not an import. Edit here, copy there.
 *
 * Design laws (same family as src/lib/marketing/waAutomation.ts):
 *  - Every non-firing is a NAMED reason (`AutomationBlockReason`), never a silent
 *    `continue`, so the builder can say "1 240 shqyrtuar → 38 ndezur, 900 kusht
 *    i paplotësuar, 300 tashmë të ndezur".
 *  - Idempotency is a deterministic FIRE KEY per (rule, entity, occurrence): the
 *    cron creates `crmAutomationRuns/{ruleId}_{entityId}_{key}` with create(), so
 *    two overlapping runs cannot fire the same occurrence twice.
 *  - A recurring trigger's window IS its cooldown (dormancy law): "pa aktivitet
 *    prej 30 ditësh" cannot reach the same contact again for 30 days by default.
 *  - Nothing fires retroactively unless the owner asks (`enrollExisting`): a new
 *    rule must not wake up every lead created since 2024.
 */

// ── Model ─────────────────────────────────────────────────────────────────────

export type AutomationEntity = 'lead' | 'customer';
export type AutomationStatus = 'active' | 'paused';

export type TriggerKind =
  | 'lead_created'            // a lead exists → once per lead
  | 'lead_stage'              // a lead is in stage X → once per lead per stage entry
  | 'lead_inactive'           // no activity for N days → repeats after the cooldown
  | 'lead_unassigned'         // no owner for N hours → repeats after the cooldown
  | 'lead_no_response'        // no first outbound touch within N hours → once
  | 'customer_created'        // a customer exists → once per customer
  | 'customer_inactive'       // no activity for N days → repeats after the cooldown
  | 'customer_invoice_overdue'; // an unpaid invoice is ≥ N days overdue → once per invoice

export interface AutomationTrigger {
  kind: TriggerKind;
  /** `lead_stage` only. */
  status?: string;
  /** Day-based triggers (inactive / overdue). */
  days?: number;
  /** Hour-based triggers (unassigned / no response). */
  hours?: number;
}

export type ConditionField =
  | 'status' | 'source' | 'tags' | 'estimatedValue' | 'assigned' | 'assignedToUserId'
  | 'score' | 'temperature' | 'businessCategory' | 'daysSinceCreated' | 'daysSinceActivity'
  | 'hasEmail' | 'hasPhone';

export type ConditionOp = 'in' | 'not_in' | 'any' | 'all' | 'none' | 'gte' | 'lte' | 'is' | 'is_not';

export interface AutomationCondition {
  field: ConditionField;
  op: ConditionOp;
  /** List operators (`in`, `not_in`, `any`, `all`, `none`). */
  values?: string[];
  /** Numeric (`gte`, `lte`) and boolean (`is`, `is_not`) operators. */
  value?: number | boolean;
}

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type AutomationAction =
  | { type: 'assign'; mode: 'user' | 'round_robin'; userId?: string; userIds?: string[] }
  | { type: 'create_task'; title: string; description?: string; dueInDays: number; priority?: TaskPriority; assignTo: 'owner' | 'user'; userId?: string }
  | { type: 'notify'; to: 'owner' | 'managers' | 'users'; userIds?: string[]; title: string; message?: string }
  | { type: 'add_tags'; tags: string[] }
  | { type: 'set_status'; status: string }
  | { type: 'start_cadence' }
  | { type: 'send_email'; subject: string; body: string };

export type AutomationActionType = AutomationAction['type'];

export interface AutomationRule {
  id: string;
  businessId: string;
  teamId?: string | null;
  name: string;
  description?: string;
  entity: AutomationEntity;
  status: AutomationStatus;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  /** Apply to records that already existed when the rule was created. */
  enrollExisting: boolean;
  /** Recurring triggers: minimum days between two firings on the same record. Defaults to the trigger window. */
  cooldownDays?: number | null;
  /** Safety valve: max firings per run (default MAX_PER_RUN_DEFAULT). */
  maxPerRun?: number | null;
  /** Round-robin position, advanced by the cron. */
  roundRobinCursor?: number;
  /** Stats written by the cron. */
  lastRunAt?: unknown;
  lastRunConsidered?: number;
  lastRunFired?: number;
  lastRunBlocked?: Partial<Record<AutomationBlockReason, number>>;
  lastRunFailedConditions?: Record<string, number>;
  totalFired?: number;
  error?: string | null;
  createdAt: unknown;
  updatedAt: unknown;
  createdByUserId: string | null;
}

/** One firing, written by the cron. Doc id = `${ruleId}_${entityId}_${fireKey}`. */
export interface AutomationRun {
  id: string;
  businessId: string;
  ruleId: string;
  ruleName: string;
  entity: AutomationEntity;
  entityId: string;
  entityName: string;
  fireKey: string;
  firedAt: unknown;
  /** Per action: what happened. */
  results: Array<{ type: AutomationActionType; ok: boolean; detail?: string }>;
}

export type AutomationBlockReason =
  | 'terminal-status'    // Lost/Converted/Won lead on a non-stage trigger
  | 'not-due'            // trigger threshold not reached (or stage differs)
  | 'predates-rule'      // record older than the rule and enrollExisting is off
  | 'already-fired'      // this occurrence already has a run record
  | 'cooldown'           // recurring trigger fired too recently on this record
  | 'condition-failed'   // a condition did not hold
  | 'run-cap';           // maxPerRun reached in this run

export const BLOCK_LABELS: Record<AutomationBlockReason, string> = {
  'terminal-status': 'lead i mbyllur (Fituar/Konvertuar/Humbur)',
  'not-due': 'kushti i ndezjes ende s’është arritur',
  'predates-rule': 'më i vjetër se rregulli',
  'already-fired': 'tashmë të ndezur',
  'cooldown': 'në periudhë pritjeje',
  'condition-failed': 'kusht i paplotësuar',
  'run-cap': 'kufiri për ekzekutim',
};

export const MAX_PER_RUN_DEFAULT = 50;
export const MS_PER_DAY = 86_400_000;
export const MS_PER_HOUR = 3_600_000;
const TERMINAL_LEAD_STATUSES = new Set(['Won', 'Converted', 'Lost']);

// ── Labels (sq-AL) ────────────────────────────────────────────────────────────

export interface TriggerMeta {
  label: string;
  help: string;
  entity: AutomationEntity;
  needs: 'status' | 'days' | 'hours' | null;
  recurring: boolean;
}

export const TRIGGER_META: Record<TriggerKind, TriggerMeta> = {
  lead_created:            { label: 'Lead i ri',                        help: 'Ndizet një herë për çdo lead të ri.',                                    entity: 'lead',     needs: null,     recurring: false },
  lead_stage:              { label: 'Lead-i hyn në fazën…',             help: 'Ndizet një herë për lead, sapo gjendet në fazën e zgjedhur.',                     entity: 'lead',     needs: 'status', recurring: false },
  lead_inactive:           { label: 'Lead pa aktivitet prej X ditësh',  help: 'Asnjë shënim, thirrje, mesazh a ndryshim për X ditë. Përsëritet pas periudhës së pritjes.', entity: 'lead', needs: 'days', recurring: true },
  lead_unassigned:         { label: 'Lead pa pronar prej X orësh',      help: 'Askush s’e ka marrë lead-in. Përsëritet pas periudhës së pritjes.',  entity: 'lead',     needs: 'hours',  recurring: true },
  lead_no_response:        { label: 'Lead pa përgjigje brenda X orësh', help: 'Asnjë kontakt i parë (SLA) që nga krijimi. Ndizet një herë.',            entity: 'lead',     needs: 'hours',  recurring: false },
  customer_created:        { label: 'Klient i ri',                      help: 'Ndizet një herë për çdo klient të ri (onboarding).',                     entity: 'customer', needs: null,     recurring: false },
  customer_inactive:       { label: 'Klient pa aktivitet prej X ditësh', help: 'Asnjë faturë, projekt a ndryshim për X ditë. Përsëritet pas periudhës së pritjes.', entity: 'customer', needs: 'days', recurring: true },
  customer_invoice_overdue: { label: 'Faturë e vonuar mbi X ditë',       help: 'Një faturë e papaguar ka kaluar afatin me X ditë. Një herë për faturë.',  entity: 'customer', needs: 'days',   recurring: false },
};

export interface ConditionMeta {
  label: string;
  entity: AutomationEntity | 'both';
  ops: ConditionOp[];
  input: 'list' | 'number' | 'boolean' | 'users';
  /** Fixed option set for `list` inputs, when there is one. */
  options?: string[];
}

export const CONDITION_META: Record<ConditionField, ConditionMeta> = {
  status:            { label: 'Faza',                    entity: 'lead', ops: ['in', 'not_in'],       input: 'list', options: ['New', 'Contacted', 'Qualified', 'Follow-up', 'Proposal', 'Won', 'Converted', 'Lost'] },
  source:            { label: 'Burimi',                  entity: 'both', ops: ['in', 'not_in'],       input: 'list' },
  tags:              { label: 'Etiketat',                entity: 'both', ops: ['any', 'all', 'none'], input: 'list' },
  businessCategory:  { label: 'Kategoria e biznesit',    entity: 'both', ops: ['in', 'not_in'],       input: 'list' },
  estimatedValue:    { label: 'Vlera e vlerësuar',       entity: 'lead', ops: ['gte', 'lte'],         input: 'number' },
  score:             { label: 'Pikët (score)',           entity: 'lead', ops: ['gte', 'lte'],         input: 'number' },
  temperature:       { label: 'Temperatura',             entity: 'lead', ops: ['in', 'not_in'],       input: 'list', options: ['hot', 'warm', 'cold'] },
  assigned:          { label: 'Ka pronar',               entity: 'both', ops: ['is'],                 input: 'boolean' },
  assignedToUserId:  { label: 'Pronari është',           entity: 'both', ops: ['in', 'not_in'],       input: 'users' },
  daysSinceCreated:  { label: 'Ditë që nga krijimi',     entity: 'both', ops: ['gte', 'lte'],         input: 'number' },
  daysSinceActivity: { label: 'Ditë pa aktivitet',       entity: 'both', ops: ['gte', 'lte'],         input: 'number' },
  hasEmail:          { label: 'Ka email',                entity: 'both', ops: ['is'],                 input: 'boolean' },
  hasPhone:          { label: 'Ka telefon',              entity: 'both', ops: ['is'],                 input: 'boolean' },
};

export const OP_LABELS: Record<ConditionOp, string> = {
  in: 'është një nga', not_in: 'nuk është', any: 'përmban ndonjë nga', all: 'përmban të gjitha',
  none: 'nuk përmban asnjë nga', gte: '≥', lte: '≤', is: 'është', is_not: 'nuk është',
};

export interface ActionMeta {
  label: string;
  help: string;
  entity: AutomationEntity | 'both';
}

export const ACTION_META: Record<AutomationActionType, ActionMeta> = {
  assign:        { label: 'Cakto pronar',        help: 'Një person i caktuar ose me radhë (round-robin).',                       entity: 'both' },
  create_task:   { label: 'Krijo detyrë',        help: 'Detyrë për pronarin ose një person, me afat pas X ditësh.',              entity: 'both' },
  notify:        { label: 'Njofto',              help: 'Zile + push + email te pronari, menaxherët ose persona të zgjedhur.',   entity: 'both' },
  add_tags:      { label: 'Shto etiketa',        help: 'Etiketat shtohen pa fshirë ekzistueset.',                                entity: 'both' },
  set_status:    { label: 'Ndrysho fazën',       help: 'Lëviz lead-in në një fazë tjetër.',                                      entity: 'lead' },
  start_cadence: { label: 'Nis kadencën',        help: 'Aktivizon sekuencën e ndjekjes (Cilësimet → CRM).',                      entity: 'lead' },
  send_email:    { label: 'Dërgo email',         help: 'Email te kontakti me tokenët {{name}}, {{company}}, {{owner}}…',        entity: 'both' },
};

/** Tokens accepted by `renderAutomationText`. */
export const TEMPLATE_TOKENS = ['name', 'firstName', 'company', 'email', 'phone', 'status', 'value', 'days', 'owner', 'invoice', 'amount'] as const;

// ── Facts: the normalized view of a record the engine evaluates ───────────────

export type Temperature = 'hot' | 'warm' | 'cold';

export interface OverdueInvoiceFact {
  id: string;
  number?: string;
  amount?: number;
  currency?: string;
  daysOverdue: number;
}

export interface EntityFacts {
  id: string;
  entity: AutomationEntity;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  status?: string;
  source?: string;
  tags: string[];
  businessCategory?: string;
  estimatedValue: number;
  score: number;
  temperature: Temperature;
  assignedToUserId: string | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  lastActivityMs: number | null;
  firstResponseMs: number | null;
  overdueInvoices: OverdueInvoiceFact[];
}

/** Date | Firestore Timestamp-like | ISO string | epoch → ms, else null. */
export function toMs(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') { const t = new Date(v).getTime(); return isNaN(t) ? null : t; }
  const o = v as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof o.toDate === 'function') { const t = o.toDate().getTime(); return isNaN(t) ? null : t; }
  if (typeof o.seconds === 'number') return o.seconds * 1000;
  if (typeof o._seconds === 'number') return o._seconds * 1000;
  return null;
}

const maxMs = (...vals: Array<number | null>): number | null => {
  let m: number | null = null;
  for (const v of vals) if (v != null && (m == null || v > m)) m = v;
  return m;
};

const str = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
};

const tagsOf = (raw: Record<string, unknown>): string[] =>
  Array.isArray(raw.tags) ? (raw.tags as unknown[]).map(t => String(t).trim().toLowerCase()).filter(Boolean) : [];

/** Mirror of src/lib/leadScore.ts (kept inline so the api copy stays self-contained). */
export function computeLeadScore(raw: Record<string, unknown>): number {
  let score = 0;
  if (raw.name) score += 10;
  if (raw.email) score += 15;
  if (raw.phoneNumber || raw.phone) score += 10;
  if (raw.company) score += 15;
  if (raw.website) score += 5;
  if (raw.source) score += 5;
  const ev = Number(raw.estimatedValue) || 0;
  if (ev > 0) score += Math.min(30, Math.round(ev / 1000) * 5);
  if (raw.lastFollowUpDate) score += 10;
  return Math.min(100, score);
}

/** Mirror of leadTemperature() in src/lib/leadIntel.ts. */
export function computeTemperature(status: string | undefined, lastActivityMs: number | null, estimatedValue: number, score: number, nowMs: number): Temperature {
  if (status === 'Lost' || status === 'Converted') return 'cold';
  const days = lastActivityMs ? (nowMs - lastActivityMs) / MS_PER_DAY : Infinity;
  let pts = 0;
  if (days <= 2) pts += 3; else if (days <= 7) pts += 2; else if (days <= 14) pts += 1;
  if (status === 'Proposal' || status === 'Qualified') pts += 2;
  else if (status === 'Contacted' || status === 'Follow-up') pts += 1;
  if (estimatedValue >= 5000) pts += 1;
  if (score >= 70) pts += 1;
  return pts >= 4 ? 'hot' : pts >= 2 ? 'warm' : 'cold';
}

export function leadFacts(id: string, raw: Record<string, unknown>, nowMs: number): EntityFacts {
  const status = str(raw.status);
  const estimatedValue = Number(raw.estimatedValue ?? raw.value) || 0;
  const score = typeof raw.score === 'number' ? raw.score : computeLeadScore(raw);
  const lastActivityMs = maxMs(toMs(raw.lastActivityAt), toMs(raw.lastFollowUpDate), toMs(raw.updatedAt));
  return {
    id, entity: 'lead',
    name: str(raw.name) || 'Lead',
    company: str(raw.company),
    email: str(raw.email)?.toLowerCase(),
    phone: str(raw.phoneNumber) || str(raw.phone),
    status,
    source: str(raw.source),
    tags: tagsOf(raw),
    businessCategory: str(raw.businessCategory),
    estimatedValue,
    score,
    temperature: computeTemperature(status, lastActivityMs, estimatedValue, score, nowMs),
    assignedToUserId: str(raw.assignedToUserId) || null,
    createdAtMs: toMs(raw.createdAt),
    updatedAtMs: toMs(raw.updatedAt),
    lastActivityMs,
    firstResponseMs: toMs(raw.firstResponseAt),
    overdueInvoices: [],
  };
}

export interface CustomerContext {
  /** Newest touch the caller knows about (invoice, project, chat…). Merged with the doc's own timestamps. */
  lastActivityMs?: number | null;
  overdueInvoices?: OverdueInvoiceFact[];
}

export function customerFacts(id: string, raw: Record<string, unknown>, ctx: CustomerContext, nowMs: number): EntityFacts {
  const lastActivityMs = maxMs(toMs(raw.lastActivityAt), toMs(raw.updatedAt), ctx.lastActivityMs ?? null);
  return {
    id, entity: 'customer',
    name: str(raw.name) || 'Klient',
    company: str(raw.company),
    email: str(raw.email)?.toLowerCase(),
    phone: str(raw.phone) || str(raw.phoneNumber),
    status: str(raw.status),
    source: str(raw.source),
    tags: tagsOf(raw),
    businessCategory: str(raw.businessCategory),
    estimatedValue: 0,
    score: 0,
    temperature: computeTemperature(undefined, lastActivityMs, 0, 0, nowMs),
    assignedToUserId: str(raw.assignedToUserId) || null,
    createdAtMs: toMs(raw.createdAt),
    updatedAtMs: toMs(raw.updatedAt),
    lastActivityMs,
    firstResponseMs: null,
    overdueInvoices: ctx.overdueInvoices ?? [],
  };
}

/** Unpaid invoice → overdue fact, or null when it is not (yet) overdue. */
export function overdueInvoiceFact(id: string, inv: Record<string, unknown>, nowMs: number): OverdueInvoiceFact | null {
  const status = String(inv.status || '');
  if (!['Pending', 'Overdue', 'Partial', 'Sent'].includes(status)) return null;
  const due = toMs(inv.dueDate);
  if (due == null || due >= nowMs) return null;
  return {
    id,
    number: str(inv.invoiceNumber) || str(inv.number),
    amount: Number(inv.total) || undefined,
    currency: str(inv.currency),
    daysOverdue: Math.floor((nowMs - due) / MS_PER_DAY),
  };
}

// ── Conditions ────────────────────────────────────────────────────────────────

export function daysSince(ms: number | null, nowMs: number): number | null {
  return ms == null ? null : (nowMs - ms) / MS_PER_DAY;
}

const norm = (vals?: string[]): string[] => (vals || []).map(v => String(v).trim().toLowerCase()).filter(Boolean);

/** True when the condition holds for these facts. */
export function conditionHolds(c: AutomationCondition, f: EntityFacts, nowMs: number): boolean {
  const listOp = (actual: string[]): boolean => {
    const want = norm(c.values);
    switch (c.op) {
      case 'in':   case 'any': return want.some(w => actual.includes(w));
      case 'not_in': case 'none': return !want.some(w => actual.includes(w));
      case 'all': return want.every(w => actual.includes(w));
      default: return false;
    }
  };
  const numOp = (actual: number | null): boolean => {
    const want = Number(c.value);
    if (actual == null || !Number.isFinite(want)) return false;
    return c.op === 'gte' ? actual >= want : c.op === 'lte' ? actual <= want : false;
  };
  const boolOp = (actual: boolean): boolean => {
    const want = c.value === true || String(c.value) === 'true';
    return c.op === 'is_not' ? actual !== want : actual === want;
  };
  switch (c.field) {
    case 'status':           return listOp(f.status ? [f.status.toLowerCase()] : []);
    case 'source':           return listOp(f.source ? [f.source.toLowerCase()] : []);
    case 'businessCategory': return listOp(f.businessCategory ? [f.businessCategory.toLowerCase()] : []);
    case 'temperature':      return listOp([f.temperature]);
    case 'tags':             return listOp(f.tags);
    case 'assignedToUserId': return listOp(f.assignedToUserId ? [f.assignedToUserId.toLowerCase()] : []);
    case 'estimatedValue':   return numOp(f.estimatedValue);
    case 'score':            return numOp(f.score);
    case 'daysSinceCreated': return numOp(daysSince(f.createdAtMs, nowMs));
    case 'daysSinceActivity': return numOp(f.lastActivityMs == null ? Infinity : daysSince(f.lastActivityMs, nowMs));
    case 'assigned':         return boolOp(!!f.assignedToUserId);
    case 'hasEmail':         return boolOp(!!f.email);
    case 'hasPhone':         return boolOp(!!f.phone);
    default: return false;
  }
}

/** The first failing condition's field, or null when all hold. */
export function firstFailingCondition(conditions: AutomationCondition[], f: EntityFacts, nowMs: number): ConditionField | null {
  for (const c of conditions || []) if (!conditionHolds(c, f, nowMs)) return c.field;
  return null;
}

// ── Trigger → fire keys ───────────────────────────────────────────────────────

export function cooldownMsFor(rule: Pick<AutomationRule, 'trigger' | 'cooldownDays'>): number {
  const explicit = Number(rule.cooldownDays);
  if (Number.isFinite(explicit) && explicit > 0) return explicit * MS_PER_DAY;
  const t = rule.trigger;
  if (t.kind === 'lead_unassigned') return Math.max(MS_PER_HOUR, (Number(t.hours) || 24) * MS_PER_HOUR);
  return Math.max(MS_PER_DAY, (Number(t.days) || 1) * MS_PER_DAY);
}

export interface FireOccurrence {
  key: string;
  /** Extra render context for this occurrence (days elapsed, the invoice…). */
  days?: number;
  invoice?: OverdueInvoiceFact;
}

/** Occurrences the trigger produces for these facts right now, before idempotency. */
export function triggerOccurrences(trigger: AutomationTrigger, f: EntityFacts, nowMs: number): FireOccurrence[] | 'not-due' | 'terminal-status' {
  const isTerminal = f.entity === 'lead' && !!f.status && TERMINAL_LEAD_STATUSES.has(f.status);
  switch (trigger.kind) {
    case 'lead_created':
    case 'customer_created':
      if (isTerminal) return 'terminal-status';
      return [{ key: 'created' }];
    case 'lead_stage': {
      if (!trigger.status || f.status !== trigger.status) return 'not-due';
      return [{ key: `stage:${trigger.status}` }];
    }
    case 'lead_inactive':
    case 'customer_inactive': {
      if (isTerminal) return 'terminal-status';
      const days = Number(trigger.days) || 0;
      const since = f.lastActivityMs == null ? Infinity : daysSince(f.lastActivityMs, nowMs)!;
      if (days <= 0 || since < days) return 'not-due';
      return [{ key: `inactive:${Math.floor(nowMs / MS_PER_DAY)}`, days: Number.isFinite(since) ? Math.floor(since) : days }];
    }
    case 'lead_unassigned': {
      if (isTerminal) return 'terminal-status';
      if (f.assignedToUserId) return 'not-due';
      const hours = Number(trigger.hours) || 0;
      const sinceH = f.createdAtMs == null ? Infinity : (nowMs - f.createdAtMs) / MS_PER_HOUR;
      if (hours <= 0 || sinceH < hours) return 'not-due';
      return [{ key: `unassigned:${Math.floor(nowMs / MS_PER_HOUR)}`, days: Number.isFinite(sinceH) ? Math.floor(sinceH / 24) : 0 }];
    }
    case 'lead_no_response': {
      if (isTerminal) return 'terminal-status';
      if (f.firstResponseMs != null) return 'not-due';
      const hours = Number(trigger.hours) || 0;
      const sinceH = f.createdAtMs == null ? 0 : (nowMs - f.createdAtMs) / MS_PER_HOUR;
      if (hours <= 0 || sinceH < hours) return 'not-due';
      return [{ key: 'no-response', days: Math.floor(sinceH / 24) }];
    }
    case 'customer_invoice_overdue': {
      const days = Number(trigger.days) || 0;
      const hits = f.overdueInvoices.filter(i => days > 0 && i.daysOverdue >= days);
      if (!hits.length) return 'not-due';
      return hits.map(i => ({ key: `invoice:${i.id}`, days: i.daysOverdue, invoice: i }));
    }
    default:
      return 'not-due';
  }
}

/** Fire keys are part of a document id: keep them path-safe. */
export function sanitizeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 120);
}

export function runDocId(ruleId: string, entityId: string, fireKey: string): string {
  return `${ruleId}_${entityId}_${sanitizeKey(fireKey)}`;
}

// ── Evaluation ────────────────────────────────────────────────────────────────

/** What the cron already fired for one rule: entityId → { keys, lastFiredMs }. */
export type RunsIndex = Map<string, { keys: Set<string>; lastFiredMs: number }>;

export function buildRunsIndex(runs: Array<{ entityId: string; fireKey: string; firedAt: unknown }>): RunsIndex {
  const idx: RunsIndex = new Map();
  for (const r of runs) {
    const cur = idx.get(r.entityId) || { keys: new Set<string>(), lastFiredMs: 0 };
    cur.keys.add(sanitizeKey(r.fireKey));
    cur.lastFiredMs = Math.max(cur.lastFiredMs, toMs(r.firedAt) || 0);
    idx.set(r.entityId, cur);
  }
  return idx;
}

export interface Firing {
  facts: EntityFacts;
  occurrence: FireOccurrence;
}

export interface EvaluationResult {
  considered: number;
  fires: Firing[];
  blocked: Partial<Record<AutomationBlockReason, number>>;
  failedConditions: Record<string, number>;
}

export interface EvaluateOptions {
  /** Rule creation instant — needed for `predates-rule`. */
  ruleCreatedAtMs: number | null;
  runs?: RunsIndex;
}

/**
 * Decide, for ONE record, what (if anything) the rule fires now. Pure: the same
 * facts + runs + now always give the same answer.
 */
export function evaluateEntity(rule: AutomationRule, f: EntityFacts, opts: EvaluateOptions, nowMs: number):
  { fires: FireOccurrence[]; blocked: AutomationBlockReason | null; failedField: ConditionField | null } {
  if (f.entity !== rule.entity) return { fires: [], blocked: 'not-due', failedField: null };

  const occ = triggerOccurrences(rule.trigger, f, nowMs);
  if (occ === 'terminal-status' || occ === 'not-due') return { fires: [], blocked: occ, failedField: null };

  // Retroactivity guard. `created`-type triggers look at the record's birth;
  // `lead_stage` at its last change (a lead that has not moved since the rule was
  // written did not "enter" the stage under this rule). Recurring and SLA/invoice
  // triggers describe the present, so they are never retroactive.
  if (!rule.enrollExisting && opts.ruleCreatedAtMs != null) {
    const k = rule.trigger.kind;
    if ((k === 'lead_created' || k === 'customer_created') && f.createdAtMs != null && f.createdAtMs < opts.ruleCreatedAtMs) {
      return { fires: [], blocked: 'predates-rule', failedField: null };
    }
    if (k === 'lead_stage' && f.updatedAtMs != null && f.updatedAtMs < opts.ruleCreatedAtMs) {
      return { fires: [], blocked: 'predates-rule', failedField: null };
    }
  }

  const failedField = firstFailingCondition(rule.conditions, f, nowMs);
  if (failedField) return { fires: [], blocked: 'condition-failed', failedField };

  const prior = opts.runs?.get(f.id);
  const recurring = TRIGGER_META[rule.trigger.kind]?.recurring;
  if (recurring && prior && prior.lastFiredMs > 0 && nowMs - prior.lastFiredMs < cooldownMsFor(rule)) {
    return { fires: [], blocked: 'cooldown', failedField: null };
  }
  const fresh = occ.filter(o => !prior?.keys.has(sanitizeKey(o.key)));
  if (!fresh.length) return { fires: [], blocked: 'already-fired', failedField: null };
  return { fires: fresh, blocked: null, failedField: null };
}

/** Evaluate a rule over a whole population — the cron's loop and the builder's preview. */
export function evaluateRule(rule: AutomationRule, population: EntityFacts[], opts: EvaluateOptions, nowMs: number): EvaluationResult {
  const cap = Math.max(1, Number(rule.maxPerRun) || MAX_PER_RUN_DEFAULT);
  const out: EvaluationResult = { considered: 0, fires: [], blocked: {}, failedConditions: {} };
  const bump = (r: AutomationBlockReason) => { out.blocked[r] = (out.blocked[r] || 0) + 1; };
  for (const f of population) {
    if (f.entity !== rule.entity) continue;
    out.considered++;
    const r = evaluateEntity(rule, f, opts, nowMs);
    if (r.blocked) {
      bump(r.blocked);
      if (r.failedField) out.failedConditions[r.failedField] = (out.failedConditions[r.failedField] || 0) + 1;
      continue;
    }
    for (const occurrence of r.fires) {
      if (out.fires.length >= cap) { bump('run-cap'); break; }
      out.fires.push({ facts: f, occurrence });
    }
  }
  return out;
}

// ── Actions helpers (pure) ────────────────────────────────────────────────────

/** Next assignee in a round-robin pool. Cursor is the count of picks so far. */
export function pickRoundRobin(pool: string[], cursor: number): { userId: string | null; nextCursor: number } {
  const clean = pool.filter(Boolean);
  if (!clean.length) return { userId: null, nextCursor: cursor };
  const i = ((Math.floor(cursor) % clean.length) + clean.length) % clean.length;
  return { userId: clean[i], nextCursor: cursor + 1 };
}

export function firstName(name?: string): string {
  const n = String(name || '').trim();
  if (!n) return '';
  return n.split(/\s+/)[0];
}

export interface RenderContext {
  ownerName?: string;
  days?: number;
  invoice?: OverdueInvoiceFact;
}

/** `{{token}}` substitution; an unknown token renders EMPTY (never leak `{{foo}}`). */
export function renderAutomationText(tpl: string, f: EntityFacts, ctx: RenderContext = {}): string {
  // Deterministic thousands separator (sq-AL style) — toLocaleString depends on the
  // runtime's ICU data, so browser and cron could render the same amount differently.
  const money = (n?: number, cur?: string) => n == null ? '' : `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${cur ? ' ' + cur : ''}`;
  const vars: Record<string, string> = {
    name: f.name || '',
    firstname: firstName(f.name),
    company: f.company || '',
    email: f.email || '',
    phone: f.phone || '',
    status: f.status || '',
    value: f.estimatedValue ? money(f.estimatedValue) : '',
    days: ctx.days != null ? String(ctx.days) : '',
    owner: ctx.ownerName || '',
    invoice: ctx.invoice?.number || '',
    amount: money(ctx.invoice?.amount, ctx.invoice?.currency),
  };
  return String(tpl || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => vars[key.toLowerCase()] ?? '');
}

// ── Validation ────────────────────────────────────────────────────────────────

export type RuleDraft = Omit<AutomationRule, 'id' | 'createdAt' | 'updatedAt' | 'createdByUserId' | 'businessId'> & { businessId?: string };

/** Human-readable (sq-AL) problems; an empty list means the rule may be saved. */
export function validateRule(rule: RuleDraft): string[] {
  const errors: string[] = [];
  if (!String(rule.name || '').trim()) errors.push('Rregulli ka nevojë për një emër.');
  const tm = TRIGGER_META[rule.trigger?.kind as TriggerKind];
  if (!tm) errors.push('Zgjidh një ndezës (trigger).');
  else {
    if (tm.entity !== rule.entity) errors.push('Ndezësi nuk i përket këtij lloji rekordi.');
    if (tm.needs === 'status' && !rule.trigger.status) errors.push('Ndezësi kërkon një fazë.');
    if (tm.needs === 'days' && !(Number(rule.trigger.days) > 0)) errors.push('Ndezësi kërkon numrin e ditëve (> 0).');
    if (tm.needs === 'hours' && !(Number(rule.trigger.hours) > 0)) errors.push('Ndezësi kërkon numrin e orëve (> 0).');
  }
  for (const [i, c] of (rule.conditions || []).entries()) {
    const cm = CONDITION_META[c.field];
    if (!cm) { errors.push(`Kushti ${i + 1}: fushë e panjohur.`); continue; }
    if (cm.entity !== 'both' && cm.entity !== rule.entity) errors.push(`Kushti ${i + 1} (${cm.label}) nuk vlen për këtë lloj rekordi.`);
    if (!cm.ops.includes(c.op) && !(c.op === 'is_not' && cm.ops.includes('is'))) errors.push(`Kushti ${i + 1}: operator i pavlefshëm.`);
    if ((cm.input === 'list' || cm.input === 'users') && !norm(c.values).length) errors.push(`Kushti ${i + 1} (${cm.label}) kërkon të paktën një vlerë.`);
    if (cm.input === 'number' && !Number.isFinite(Number(c.value))) errors.push(`Kushti ${i + 1} (${cm.label}) kërkon një numër.`);
  }
  if (!rule.actions?.length) errors.push('Shto të paktën një veprim.');
  for (const [i, a] of (rule.actions || []).entries()) {
    const am = ACTION_META[a.type];
    if (!am) { errors.push(`Veprimi ${i + 1}: lloj i panjohur.`); continue; }
    if (am.entity !== 'both' && am.entity !== rule.entity) errors.push(`Veprimi ${i + 1} (${am.label}) vlen vetëm për lead.`);
    switch (a.type) {
      case 'assign':
        if (a.mode === 'user' && !a.userId) errors.push(`Veprimi ${i + 1}: zgjidh personin.`);
        break;
      case 'create_task':
        if (!String(a.title || '').trim()) errors.push(`Veprimi ${i + 1}: detyra ka nevojë për titull.`);
        if (a.assignTo === 'user' && !a.userId) errors.push(`Veprimi ${i + 1}: zgjidh kujt i caktohet detyra.`);
        if (!(Number(a.dueInDays) >= 0)) errors.push(`Veprimi ${i + 1}: afati në ditë duhet të jetë ≥ 0.`);
        break;
      case 'notify':
        if (!String(a.title || '').trim()) errors.push(`Veprimi ${i + 1}: njoftimi ka nevojë për titull.`);
        if (a.to === 'users' && !(a.userIds || []).length) errors.push(`Veprimi ${i + 1}: zgjidh të paktën një marrës.`);
        break;
      case 'add_tags':
        if (!norm(a.tags).length) errors.push(`Veprimi ${i + 1}: shto të paktën një etiketë.`);
        break;
      case 'set_status':
        if (!a.status) errors.push(`Veprimi ${i + 1}: zgjidh fazën.`);
        else if (rule.trigger?.kind === 'lead_stage' && rule.trigger.status === a.status) errors.push(`Veprimi ${i + 1}: faza e re është e njëjta me ndezësin.`);
        break;
      case 'send_email':
        if (!String(a.subject || '').trim()) errors.push(`Veprimi ${i + 1}: emaili ka nevojë për subjekt.`);
        if (!String(a.body || '').trim()) errors.push(`Veprimi ${i + 1}: emaili ka nevojë për përmbajtje.`);
        break;
      default:
        break;
    }
  }
  if (rule.cooldownDays != null && rule.cooldownDays !== undefined && !(Number(rule.cooldownDays) >= 0)) errors.push('Periudha e pritjes duhet të jetë ≥ 0 ditë.');
  return errors;
}

/** One-line human summary of a rule ("Kur lead pa aktivitet prej 14 ditësh → Njofto, Krijo detyrë"). */
export function describeRule(rule: Pick<AutomationRule, 'trigger' | 'actions' | 'conditions'>): string {
  const t = rule.trigger;
  const tm = TRIGGER_META[t.kind];
  let when = tm ? tm.label : t.kind;
  if (tm?.needs === 'status') when = `Lead-i hyn në fazën “${t.status || '?'}”`;
  if (tm?.needs === 'days') when = when.replace('X', String(t.days ?? '?'));
  if (tm?.needs === 'hours') when = when.replace('X', String(t.hours ?? '?'));
  const conds = (rule.conditions || []).length ? ` (+${rule.conditions.length} kushte)` : '';
  const acts = (rule.actions || []).map(a => ACTION_META[a.type]?.label || a.type).join(', ');
  return `Kur ${when}${conds} → ${acts || '—'}`;
}

// ── Recipes: ready-made enterprise rules ──────────────────────────────────────

export interface AutomationRecipe {
  key: string;
  name: string;
  description: string;
  entity: AutomationEntity;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  cooldownDays?: number | null;
}

export const AUTOMATION_RECIPES: AutomationRecipe[] = [
  {
    key: 'new-lead-routing',
    name: 'Lead i ri → cakto me radhë + detyrë kontakti',
    description: 'Çdo lead i ri pa pronar shpërndahet me radhë te ekipi i shitjes dhe merr një detyrë “Kontakto brenda 24h”.',
    entity: 'lead',
    trigger: { kind: 'lead_created' },
    conditions: [{ field: 'assigned', op: 'is', value: false }],
    actions: [
      { type: 'assign', mode: 'round_robin' },
      { type: 'create_task', title: 'Kontakto lead-in: {{name}}', description: 'Lead i ri nga {{company}}. Përgjigju brenda 24 orëve.', dueInDays: 1, priority: 'high', assignTo: 'owner' },
    ],
  },
  {
    key: 'hot-lead-sla',
    name: 'Lead i nxehtë pa përgjigje 4 orë → alarm',
    description: 'Një lead me vlerë ose temperaturë të lartë që s’ka marrë asnjë kontakt brenda 4 orësh njofton pronarin dhe menaxherët.',
    entity: 'lead',
    trigger: { kind: 'lead_no_response', hours: 4 },
    conditions: [{ field: 'temperature', op: 'in', values: ['hot', 'warm'] }],
    actions: [
      { type: 'notify', to: 'owner', title: '⏰ {{name}} pret përgjigje', message: 'Lead i nxehtë pa kontakt të parë. Vlera: {{value}}.' },
      { type: 'notify', to: 'managers', title: 'SLA në rrezik: {{name}}', message: 'Asnjë kontakt i parë brenda 4 orësh. Pronari: {{owner}}.' },
    ],
  },
  {
    key: 'proposal-stuck',
    name: 'Propozim i ngecur 5 ditë → ndjekje',
    description: 'Lead në fazën Propozim pa aktivitet prej 5 ditësh: detyrë ndjekjeje për pronarin dhe njoftim.',
    entity: 'lead',
    trigger: { kind: 'lead_inactive', days: 5 },
    conditions: [{ field: 'status', op: 'in', values: ['Proposal'] }],
    actions: [
      { type: 'create_task', title: 'Ndiq propozimin: {{name}}', description: '{{days}} ditë pa përgjigje për propozimin. Telefono ose dërgo një kujtesë.', dueInDays: 0, priority: 'high', assignTo: 'owner' },
      { type: 'notify', to: 'owner', title: 'Propozimi për {{name}} ka ngecur', message: '{{days}} ditë pa aktivitet.' },
    ],
    cooldownDays: 5,
  },
  {
    key: 'lost-winback',
    name: 'Lead i humbur → win-back pas 60 ditësh',
    description: 'Kur një lead humbet, krijohet një detyrë rikontakti pas 60 ditësh dhe etiketohet “win-back”.',
    entity: 'lead',
    trigger: { kind: 'lead_stage', status: 'Lost' },
    conditions: [],
    actions: [
      { type: 'add_tags', tags: ['win-back'] },
      { type: 'create_task', title: 'Win-back: {{name}}', description: 'Lead i humbur 60 ditë më parë. Provo një ofertë të re.', dueInDays: 60, priority: 'low', assignTo: 'owner' },
    ],
  },
  {
    key: 'customer-onboarding',
    name: 'Klient i ri → onboarding',
    description: 'Email mirëseardhjeje te klienti, detyrë kickoff për pronarin e llogarisë brenda 2 ditësh, etiketa “onboarding”.',
    entity: 'customer',
    trigger: { kind: 'customer_created' },
    conditions: [],
    actions: [
      { type: 'add_tags', tags: ['onboarding'] },
      { type: 'create_task', title: 'Kickoff me {{name}}', description: 'Takim njohës, akses në portal, plan i punës.', dueInDays: 2, priority: 'high', assignTo: 'owner' },
      { type: 'send_email', subject: 'Mirë se vini, {{firstName}}!', body: 'Përshëndetje {{firstName}},\n\nFaleminderit që na besuat. Brenda 2 ditëve do t’ju kontaktojë {{owner}} për takimin e parë.\n\nGjithë të mirat' },
    ],
  },
  {
    key: 'invoice-overdue-14',
    name: 'Faturë e vonuar 14 ditë → detyrë arkëtimi',
    description: 'Për çdo faturë 14+ ditë mbi afat, pronari i llogarisë merr një detyrë arkëtimi dhe menaxherët njoftohen.',
    entity: 'customer',
    trigger: { kind: 'customer_invoice_overdue', days: 14 },
    conditions: [],
    actions: [
      { type: 'create_task', title: 'Arkëto faturën {{invoice}} — {{name}}', description: '{{amount}} e vonuar {{days}} ditë. Telefono klientin.', dueInDays: 1, priority: 'urgent', assignTo: 'owner' },
      { type: 'notify', to: 'managers', title: 'Faturë {{invoice}} e vonuar {{days}} ditë', message: '{{name}} — {{amount}}.' },
    ],
  },
  {
    key: 'customer-at-risk',
    name: 'Klient pa aktivitet 45 ditë → alarm rreziku',
    description: 'Një klient pa faturë, projekt a ndryshim prej 45 ditësh etiketohet “në rrezik” dhe pronari i llogarisë merr detyrë check-in.',
    entity: 'customer',
    trigger: { kind: 'customer_inactive', days: 45 },
    conditions: [],
    actions: [
      { type: 'add_tags', tags: ['në-rrezik'] },
      { type: 'create_task', title: 'Check-in me {{name}}', description: '{{days}} ditë pa aktivitet. Telefono dhe pyet si po shkon.', dueInDays: 2, priority: 'medium', assignTo: 'owner' },
    ],
    cooldownDays: 45,
  },
];

/** Recipe → saveable draft (owner still names/adjusts it in the builder). */
export function recipeToDraft(r: AutomationRecipe): RuleDraft {
  return {
    name: r.name,
    description: r.description,
    entity: r.entity,
    status: 'paused',
    trigger: { ...r.trigger },
    conditions: r.conditions.map(c => ({ ...c, values: c.values ? [...c.values] : undefined })),
    actions: r.actions.map(a => ({ ...a })) as AutomationAction[],
    enrollExisting: false,
    cooldownDays: r.cooldownDays ?? null,
    maxPerRun: null,
  };
}
