/**
 * Contact merge — what "one record" should look like when the CRM holds two.
 *
 * `contactIdentity.ts` answers "is this the same person?" on the WRITE path, so a
 * new lead/customer never becomes an unlinked orphan. This module answers the
 * question that comes after: two records for one person already exist (imported
 * CSV, WHMCS sync, landing form typed a second email, portal signup) — which
 * record survives, which values does it keep, and what has to be moved onto it.
 *
 * Everything here is pure and unit-tested. The actual reassignment of invoices,
 * projects, quotes, chat, … runs server-side in `api/_merge-contacts.ts`, which
 * mirrors the field allow-lists below (api/ never imports from src/).
 */

import { normContactEmail, normContactPhone, type ContactLike } from './contactIdentity';
import { getTimestampMs } from './utils';

export type ContactKind = 'customer' | 'lead';

/** Which side of the merge a field's value comes from. */
export type MergeChoice = 'primary' | 'secondary' | 'both';

export interface MergeFieldSpec {
  key: string;
  label: string;
  /**
   * `tags` = always unioned (losing a tag on merge is never what anyone wants).
   * `long` = free text that can be kept from both sides, concatenated.
   * `value` = a single value; one side wins.
   */
  mode?: 'value' | 'tags' | 'long';
}

/**
 * Fields the merge may write on a customer. Deliberately an allow-list: the
 * server refuses anything outside it, so a merge can never rewrite tenant keys
 * (`businessId`/`teamId`), links (`leadId`) or bookkeeping (`createdAt`).
 */
export const CUSTOMER_MERGE_FIELDS: MergeFieldSpec[] = [
  { key: 'name', label: 'Emri' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Telefoni' },
  { key: 'company', label: 'Kompania' },
  { key: 'industry', label: 'Industria' },
  { key: 'status', label: 'Statusi' },
  { key: 'website', label: 'Website' },
  { key: 'address', label: 'Adresa' },
  { key: 'billingAddress', label: 'Adresa e faturimit' },
  { key: 'shippingAddress', label: 'Adresa e dërgesës' },
  { key: 'taxId', label: 'NIPT' },
  { key: 'contactPerson', label: 'Personi i kontaktit' },
  { key: 'contactPhone', label: 'Telefoni i kontaktit' },
  { key: 'paymentTerms', label: 'Kushtet e pagesës' },
  { key: 'creditLimit', label: 'Limiti i kredisë' },
  { key: 'assignedToUserId', label: 'Përgjegjësi' },
  { key: 'avatarUrl', label: 'Foto' },
  { key: 'tags', label: 'Etiketat', mode: 'tags' },
  { key: 'notes', label: 'Shënime', mode: 'long' },
];

/** Same idea for a lead. Note the phone field differs (`phoneNumber`). */
export const LEAD_MERGE_FIELDS: MergeFieldSpec[] = [
  { key: 'name', label: 'Emri' },
  { key: 'email', label: 'Email' },
  { key: 'phoneNumber', label: 'Telefoni' },
  { key: 'company', label: 'Kompania' },
  { key: 'jobTitle', label: 'Pozicioni' },
  { key: 'website', label: 'Website' },
  { key: 'address', label: 'Adresa' },
  { key: 'status', label: 'Statusi' },
  { key: 'source', label: 'Burimi' },
  { key: 'estimatedValue', label: 'Vlera e parashikuar' },
  { key: 'value', label: 'Vlera' },
  { key: 'probability', label: 'Probabiliteti (%)' },
  { key: 'businessCategory', label: 'Kategoria e biznesit' },
  { key: 'assignedToUserId', label: 'Përgjegjësi' },
  { key: 'tags', label: 'Etiketat', mode: 'tags' },
  { key: 'notes', label: 'Shënime', mode: 'long' },
];

export function mergeFieldsFor(kind: ContactKind): MergeFieldSpec[] {
  return kind === 'customer' ? CUSTOMER_MERGE_FIELDS : LEAD_MERGE_FIELDS;
}

/** Albanian label for the record type, for dialog copy. */
export function contactKindLabel(kind: ContactKind, plural = false): string {
  if (kind === 'customer') return plural ? 'klientë' : 'klient';
  return plural ? 'lead' : 'lead';
}

// ── field-level plan ─────────────────────────────────────────────────────────

/** Tags live as a comma string on customers and as an array on leads. */
function parseTagList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Loose equality that treats "" / null / undefined and 5 / "5" as the same. */
function sameValue(a: unknown, b: unknown): boolean {
  if (isBlank(a) && isBlank(b)) return true;
  if (isBlank(a) !== isBlank(b)) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    const sa = parseTagList(a).map((t) => t.toLowerCase()).sort();
    const sb = parseTagList(b).map((t) => t.toLowerCase()).sort();
    return sa.length === sb.length && sa.every((t, i) => t === sb[i]);
  }
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a).trim() === String(b).trim();
}

export type FieldStatus = 'same' | 'conflict' | 'onlyPrimary' | 'onlySecondary' | 'empty';

export interface FieldDecision {
  key: string;
  label: string;
  mode: 'value' | 'tags' | 'long';
  primaryValue: unknown;
  secondaryValue: unknown;
  status: FieldStatus;
  /** What the merge does if the user changes nothing. */
  suggested: MergeChoice;
}

/**
 * Field-by-field comparison of the two records.
 *
 * The suggested resolution never loses data on its own: the surviving record
 * keeps its own value, empty fields are filled from the duplicate, tags are
 * unioned, and two different notes are kept together. Only a real conflict on a
 * single-value field (two different phone numbers) needs a human decision, and
 * there the primary is pre-selected.
 */
export function buildFieldPlan(
  kind: ContactKind,
  primary: Record<string, any>,
  secondary: Record<string, any>,
): FieldDecision[] {
  return mergeFieldsFor(kind).map((spec) => {
    const mode = spec.mode || 'value';
    const primaryValue = primary?.[spec.key];
    const secondaryValue = secondary?.[spec.key];

    let status: FieldStatus;
    if (isBlank(primaryValue) && isBlank(secondaryValue)) status = 'empty';
    else if (sameValue(primaryValue, secondaryValue)) status = 'same';
    else if (isBlank(primaryValue)) status = 'onlySecondary';
    else if (isBlank(secondaryValue)) status = 'onlyPrimary';
    else status = 'conflict';

    // Never lose data by default: an empty field is filled from the duplicate, and
    // tags / free text keep both sides. Only a single-value conflict defaults to
    // the survivor's own value, which is the one decision a human should confirm.
    let suggested: MergeChoice = 'primary';
    if (status === 'onlySecondary') suggested = 'secondary';
    else if (status === 'conflict' && (mode === 'tags' || mode === 'long')) suggested = 'both';

    return { key: spec.key, label: spec.label, mode, primaryValue, secondaryValue, status, suggested };
  });
}

/** Only the decisions worth showing — an empty-on-both field is noise. */
export function visibleFieldPlan(plan: FieldDecision[]): FieldDecision[] {
  return plan.filter((d) => d.status !== 'empty');
}

/** Default choices, keyed by field — the starting point for the dialog state. */
export function defaultChoices(plan: FieldDecision[]): Record<string, MergeChoice> {
  return Object.fromEntries(plan.map((d) => [d.key, d.suggested]));
}

/** Case-insensitive union that keeps the primary's spelling of a shared tag. */
function unionTags(a: unknown, b: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of [...parseTagList(a), ...parseTagList(b)]) {
    const k = tag.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(tag);
  }
  return out;
}

/** Marker so a merged note is readable later instead of two texts glued together. */
export const MERGED_NOTE_SEPARATOR = '\n\n— nga rekordi i bashkuar —\n';

/**
 * The values to WRITE on the surviving record. Fields already correct on the
 * primary are omitted, so a merge with no field changes issues no field write.
 */
export function resolveMergedValues(
  kind: ContactKind,
  primary: Record<string, any>,
  secondary: Record<string, any>,
  choices: Record<string, MergeChoice>,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const decision of buildFieldPlan(kind, primary, secondary)) {
    if (decision.status === 'empty' || decision.status === 'same') continue;
    const choice = choices[decision.key] || decision.suggested;
    const { primaryValue: p, secondaryValue: s } = decision;

    let resolved: any;
    if (decision.mode === 'tags') {
      resolved = choice === 'primary' ? parseTagList(p)
        : choice === 'secondary' ? parseTagList(s)
          : unionTags(p, s);
      // Preserve each collection's storage shape: comma string vs array.
      if (kind === 'customer') resolved = (resolved as string[]).join(', ');
    } else if (decision.mode === 'long' && choice === 'both') {
      resolved = [p, s].filter((v) => !isBlank(v)).map((v) => String(v).trim()).join(MERGED_NOTE_SEPARATOR);
    } else if (choice === 'secondary') {
      resolved = isBlank(s) ? '' : s;
    } else {
      resolved = isBlank(p) ? '' : p;
    }

    if (!sameValue(resolved, p)) out[decision.key] = resolved;
  }
  return out;
}

// ── duplicate detection ──────────────────────────────────────────────────────

export type DuplicateReason = 'email' | 'phone' | 'name';

export interface DuplicateGroup<T> {
  /** Stable id for React keys / dismissals — the ids of the group, sorted. */
  key: string;
  reason: DuplicateReason;
  /** Best merge target first (most complete, then oldest). */
  records: T[];
}

type DupRecord = ContactLike & { id: string; name?: string; company?: string; createdAt?: any };

/** Accent-folded, punctuation-free, single-spaced name for the weakest signal. */
function normName(raw?: string | null): string {
  return (raw || '')
    .toLowerCase()
    // NFD + drop combining marks folds "Ëngjëll" → "engjell" so an accented and an
    // unaccented spelling of one name land in the same bucket.
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * How much a record would lose by being the one that disappears. Used to
 * pre-select the surviving record: the fuller one, ties broken by age (the
 * older record is usually the one other systems already reference).
 */
export function scoreContactCompleteness(record: Record<string, any>): number {
  const fields = ['email', 'phone', 'phoneNumber', 'company', 'address', 'website', 'taxId',
    'industry', 'notes', 'assignedToUserId', 'jobTitle', 'contactPerson', 'billingAddress'];
  let score = fields.reduce((n, f) => (isBlank(record?.[f]) ? n : n + 1), 0);
  score += parseTagList(record?.tags).length ? 1 : 0;
  return score;
}

/**
 * Records that look like the same person, ranked so the best merge target is
 * first. Never two people in one group by accident: a name-only match is
 * rejected when both records carry an email (or a phone) and those differ.
 */
export function findDuplicateGroups<T extends DupRecord>(
  records: T[] | null | undefined,
): DuplicateGroup<T>[] {
  const list = (records || []).filter((r) => r && r.id);
  if (list.length < 2) return [];

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    if (root !== id) {
      root = find(root);
      parent.set(id, root);
    }
    return root;
  };
  const reasons = new Map<string, Set<DuplicateReason>>();
  const union = (a: string, b: string, reason: DuplicateReason) => {
    const ra = find(a);
    const rb = find(b);
    const merged = new Set<DuplicateReason>([...(reasons.get(ra) || []), ...(reasons.get(rb) || []), reason]);
    if (ra !== rb) parent.set(rb, ra);
    reasons.set(find(a), merged);
  };

  // Strong signals first — an exact email or phone match is a duplicate, full stop.
  const byKey = new Map<string, string>();
  for (const r of list) {
    const email = normContactEmail(r.email);
    const phone = normContactPhone(r.phone ?? r.phoneNumber);
    for (const [key, reason] of [
      [email && `e:${email}`, 'email' as DuplicateReason],
      [phone && `p:${phone}`, 'phone' as DuplicateReason],
    ] as [string | '', DuplicateReason][]) {
      if (!key) continue;
      const seen = byKey.get(key);
      if (seen) union(seen, r.id, reason);
      else byKey.set(key, r.id);
    }
  }

  // Weak signal: same name (+ company when both have one). Only trusted when the
  // records don't actively contradict each other on email or phone.
  const byName = new Map<string, T[]>();
  for (const r of list) {
    const name = normName(r.name);
    if (name.length < 5) continue; // "Ana", "Info" — too generic to merge on
    const company = normName(r.company);
    const key = company ? `n:${name}|${company}` : `n:${name}`;
    byName.set(key, [...(byName.get(key) || []), r]);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (!contradicts(group[i], group[j])) union(group[i].id, group[j].id, 'name');
      }
    }
  }

  const buckets = new Map<string, T[]>();
  for (const r of list) {
    const root = find(r.id);
    buckets.set(root, [...(buckets.get(root) || []), r]);
  }

  const order: DuplicateReason[] = ['email', 'phone', 'name'];
  const groups: DuplicateGroup<T>[] = [];
  for (const [root, members] of buckets) {
    if (members.length < 2) continue;
    const found = reasons.get(root) || new Set<DuplicateReason>();
    const reason = order.find((r) => found.has(r)) || 'name';
    groups.push({
      key: members.map((m) => m.id).sort().join('|'),
      reason,
      records: rankMergeCandidates(members),
    });
  }

  return groups.sort((a, b) => {
    const byReason = order.indexOf(a.reason) - order.indexOf(b.reason);
    return byReason !== 0 ? byReason : b.records.length - a.records.length;
  });
}

/** Two records that both state an email (or phone) and disagree aren't one person. */
function contradicts(a: DupRecord, b: DupRecord): boolean {
  const ea = normContactEmail(a.email);
  const eb = normContactEmail(b.email);
  if (ea && eb && ea !== eb) return true;
  const pa = normContactPhone(a.phone ?? a.phoneNumber);
  const pb = normContactPhone(b.phone ?? b.phoneNumber);
  return !!pa && !!pb && pa !== pb;
}

/** Best merge target first: most complete, then oldest, then id for stability. */
export function rankMergeCandidates<T extends DupRecord>(records: T[]): T[] {
  return [...records].sort((a, b) => {
    const byScore = scoreContactCompleteness(b) - scoreContactCompleteness(a);
    if (byScore !== 0) return byScore;
    const ta = getTimestampMs(a.createdAt);
    const tb = getTimestampMs(b.createdAt);
    if (ta && tb && ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

export function duplicateReasonLabel(reason: DuplicateReason): string {
  if (reason === 'email') return 'i njëjti email';
  if (reason === 'phone') return 'i njëjti telefon';
  return 'i njëjti emër';
}

// ── what the server moves (labels for the preview) ───────────────────────────

/**
 * Albanian labels for the collections the server reassigns. Keys must match
 * `api/_merge-contacts.ts`; an unknown key falls back to the raw name so a new
 * collection there still shows up in the preview instead of vanishing.
 */
export const MERGE_COLLECTION_LABELS: Record<string, string> = {
  invoices: 'Fatura',
  invoiceItems: 'Rreshta faturash',
  payments: 'Pagesa',
  subscriptions: 'Abonime',
  domains: 'Domain-e',
  hostingOrders: 'Porosi hosting',
  hostingEvents: 'Aktivitet hosting',
  hostingBackups: 'Backup-e hosting',
  quotes: 'Preventiva',
  contracts: 'Kontrata',
  projects: 'Projekte',
  tasks: 'Detyra',
  projectComments: 'Komente projekti',
  taskComments: 'Komente detyre',
  milestones: 'Momente kyçe',
  timeEntries: 'Orë pune',
  expenses: 'Shpenzime',
  activities: 'Aktivitete',
  leadActivities: 'Historik lead-i',
  deals: 'Marrëveshje',
  leads: 'Lead',
  customers: 'Klientë',
  clientRequests: 'Kërkesa klienti',
  clientPortalAccess: 'Akses portali',
  serviceInquiries: 'Interesime shërbimi',
  shopOrders: 'Porosi dyqani',
  conversations: 'Bisedat',
  messages: 'Mesazhe',
  whatsappMessages: 'Mesazhe WhatsApp',
  campaignEnrollments: 'Regjistrime kampanjash',
  socialAccounts: 'Llogari sociale',
  socialSnapshots: 'Statistika sociale',
  gmbAccounts: 'Profile Google Business',
  gmbReviews: 'Reviews Google',
  reports: 'Raporte',
  reportVersions: 'Versione raportesh',
  reportComments: 'Komente raportesh',
  reportEvents: 'Evente raportesh',
  reportApprovals: 'Aprovime raportesh',
  reportSchedules: 'Planifikime raportesh',
  reportKpis: 'KPI raportesh',
  reportMetrics: 'Metrika raportesh',
  clientHealthScores: 'Shëndeti i klientit',
  dailyReports: 'Raporte ditore',
  notifications: 'Njoftime',
};

export function mergeCollectionLabel(collection: string): string {
  return MERGE_COLLECTION_LABELS[collection] || collection;
}

/** Total docs a merge will touch — drives the confirm copy. */
export function totalMoved(moved: Record<string, number> | null | undefined): number {
  return Object.values(moved || {}).reduce((n, v) => n + (Number(v) || 0), 0);
}
