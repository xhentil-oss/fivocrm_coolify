import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin, { adminAuth, adminDb as db, Timestamp } from './_firebaseAdmin.js';
import { writeAudit } from './_audit.js';

/**
 * POST /api/merge-contacts
 * Header: Authorization: Bearer <Firebase ID token>
 * Body: {
 *   kind: 'customer' | 'lead',
 *   primaryId: string,        // the record that SURVIVES
 *   duplicateId: string,      // the record that is absorbed and deleted
 *   fields?: Record<string, any>,   // resolved field values to write on the primary
 *   cascade?: boolean,        // also merge the linked lead/customer pair (default true)
 *   dryRun?: boolean,         // preview only — count what would move, write nothing
 * }
 *
 * Merging two records for the same person is a tenant-wide rewrite: every invoice,
 * project, quote, contract, task, portal access, report and chat thread that points
 * at the duplicate has to point at the survivor instead, or the "merge" would just
 * hide history behind a deleted document.
 *
 * WHY THIS IS SERVER-SIDE:
 *  - it spans ~35 collections, several of which the acting user cannot even read
 *    (reports of other staff, portal access, conversations) — Firestore rules would
 *    deny half the operation and leave the graph half-moved;
 *  - it must be all-or-nothing per collection (batched writes) and must NOT delete
 *    the duplicate when it ran out of time;
 *  - the duplicate's full document is archived to `contactMerges` first, so a merge
 *    made by mistake can still be reconstructed.
 *
 * Authorization: super-admin, or an Admin/Manager (or team owner) of the business
 * that owns BOTH records. Cross-tenant merges are refused outright.
 */

// ── what points at a contact ─────────────────────────────────────────────────
// One equality query per entry (no composite index needed). Over-inclusion is
// harmless — a collection that never carries the field returns nothing — while
// under-inclusion silently orphans data, so the list is deliberately generous.
// Keys are mirrored by MERGE_COLLECTION_LABELS in src/lib/contactMerge.ts.

interface RefSpec {
  collection: string;
  field: string;
}

const CUSTOMER_REFS: RefSpec[] = [
  { collection: 'invoices', field: 'customerId' },
  { collection: 'invoiceItems', field: 'customerId' },
  { collection: 'payments', field: 'customerId' },
  { collection: 'subscriptions', field: 'customerId' },
  { collection: 'quotes', field: 'customerId' },
  { collection: 'contracts', field: 'customerId' },
  { collection: 'projects', field: 'customerId' },
  { collection: 'tasks', field: 'customerId' },
  { collection: 'projectComments', field: 'customerId' },
  { collection: 'taskComments', field: 'customerId' },
  { collection: 'milestones', field: 'customerId' },
  { collection: 'timeEntries', field: 'customerId' },
  { collection: 'expenses', field: 'customerId' },
  { collection: 'activities', field: 'customerId' },
  { collection: 'deals', field: 'customerId' },
  { collection: 'leads', field: 'customerId' },
  { collection: 'clientRequests', field: 'customerId' },
  { collection: 'clientPortalAccess', field: 'customerId' },
  { collection: 'serviceInquiries', field: 'customerId' },
  { collection: 'shopOrders', field: 'customerId' },
  { collection: 'conversations', field: 'customerId' },
  { collection: 'campaignEnrollments', field: 'customerId' },
  { collection: 'socialAccounts', field: 'customerId' },
  { collection: 'socialSnapshots', field: 'customerId' },
  { collection: 'reports', field: 'customerId' },
  { collection: 'reportVersions', field: 'customerId' },
  { collection: 'reportComments', field: 'customerId' },
  { collection: 'reportEvents', field: 'customerId' },
  { collection: 'reportApprovals', field: 'customerId' },
  { collection: 'reportSchedules', field: 'customerId' },
  { collection: 'reportKpis', field: 'customerId' },
  { collection: 'reportMetrics', field: 'customerId' },
  { collection: 'clientHealthScores', field: 'customerId' },
];

const LEAD_REFS: RefSpec[] = [
  { collection: 'leadActivities', field: 'leadId' },
  { collection: 'activities', field: 'leadId' },
  { collection: 'deals', field: 'leadId' },
  { collection: 'quotes', field: 'leadId' },
  { collection: 'contracts', field: 'leadId' },
  { collection: 'tasks', field: 'leadId' },
  { collection: 'customers', field: 'leadId' },
  { collection: 'serviceInquiries', field: 'leadId' },
  { collection: 'conversations', field: 'leadId' },
  { collection: 'whatsappMessages', field: 'leadId' },
  { collection: 'campaignEnrollments', field: 'leadId' },
  { collection: 'notifications', field: 'leadId' },
];

/** Array-valued references — reassigned with arrayRemove + arrayUnion. */
const CUSTOMER_ARRAY_REFS: RefSpec[] = [
  { collection: 'dailyReports', field: 'customerIds' },
];

/** Per-collection cap. Above this the merge reports `truncated` and keeps the
 *  duplicate alive, so a second call finishes the job instead of orphaning docs. */
const MAX_DOCS_PER_COLLECTION = 500;
const BATCH_SIZE = 400; // Firestore hard limit is 500 writes per batch
const BUDGET_MS = 45_000;

/** Field allow-lists — mirror of CUSTOMER_MERGE_FIELDS / LEAD_MERGE_FIELDS. */
const CUSTOMER_FIELDS = new Set([
  'name', 'email', 'phone', 'company', 'industry', 'status', 'website', 'address',
  'billingAddress', 'shippingAddress', 'taxId', 'contactPerson', 'contactPhone',
  'paymentTerms', 'creditLimit', 'assignedToUserId', 'avatarUrl', 'tags', 'notes',
]);
const LEAD_FIELDS = new Set([
  'name', 'email', 'phoneNumber', 'company', 'jobTitle', 'website', 'address',
  'status', 'source', 'estimatedValue', 'value', 'probability', 'businessCategory',
  'assignedToUserId', 'tags', 'notes',
]);

type Kind = 'customer' | 'lead';
const collectionOf = (kind: Kind) => (kind === 'customer' ? 'customers' : 'leads');
const refsFor = (kind: Kind) => (kind === 'customer' ? CUSTOMER_REFS : LEAD_REFS);
const arrayRefsFor = (kind: Kind) => (kind === 'customer' ? CUSTOMER_ARRAY_REFS : []);
const fieldsFor = (kind: Kind) => (kind === 'customer' ? CUSTOMER_FIELDS : LEAD_FIELDS);

export interface MergeResult {
  kind: Kind;
  primaryId: string;
  duplicateId: string;
  moved: Record<string, number>;
  total: number;
  /** Hit a per-collection cap or the time budget — duplicate NOT deleted. */
  truncated: boolean;
  fieldsWritten: string[];
  warnings: string[];
  /** Portal-access rows collapsed because they shared an email. */
  deduped?: number;
  mergeId?: string;
  cascade?: MergeResult | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  let decoded: admin.auth.DecodedIdToken;
  try {
    decoded = await adminAuth.verifyIdToken(authHeader.slice(7));
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const body = (req.body || {}) as Record<string, any>;
  const kind = body.kind as Kind;
  const primaryId = typeof body.primaryId === 'string' ? body.primaryId : '';
  const duplicateId = typeof body.duplicateId === 'string' ? body.duplicateId : '';
  const dryRun = body.dryRun === true;
  const cascade = body.cascade !== false;

  if (kind !== 'customer' && kind !== 'lead') {
    return res.status(400).json({ error: 'kind duhet të jetë "customer" ose "lead"' });
  }
  if (!primaryId || !duplicateId) return res.status(400).json({ error: 'Mungon primaryId ose duplicateId' });
  if (primaryId === duplicateId) return res.status(400).json({ error: 'Nuk mund të bashkohet një rekord me vetveten' });

  const coll = collectionOf(kind);
  const [primarySnap, dupSnap] = await Promise.all([
    db.collection(coll).doc(primaryId).get(),
    db.collection(coll).doc(duplicateId).get(),
  ]);
  if (!primarySnap.exists || !dupSnap.exists) {
    return res.status(404).json({ error: 'Një nga rekordet nuk u gjet (mund të jetë fshirë).' });
  }

  const primary = primarySnap.data() as any;
  const duplicate = dupSnap.data() as any;

  // ── tenant boundary: both records must belong to the same business ──
  const primaryBusinessId: string | null = primary.businessId || primary.teamId || null;
  const dupBusinessId: string | null = duplicate.businessId || duplicate.teamId || null;
  if (primaryBusinessId && dupBusinessId && primaryBusinessId !== dupBusinessId) {
    return res.status(400).json({ error: 'Rekordet janë në dy biznese të ndryshme — bashkimi nuk lejohet.' });
  }
  // Legacy records created before the tenancy backfill carry no businessId at all.
  // They show up in every tenant's list already (the client filter lets an untagged
  // doc through), so refusing to merge them would dead-end exactly the mess this
  // feature exists to clean up — authorize such a merge against the caller's own
  // tenant instead, and stamp the archive with it.
  const businessId: string | null = primaryBusinessId || dupBusinessId
    || (typeof (decoded as any).bid === 'string' ? (decoded as any).bid : null);

  const authorized = await isBusinessAdmin(decoded, businessId);
  if (!authorized) {
    return res.status(403).json({ error: 'Vetëm Admin/Manager i biznesit mund të bashkojë kontakte.' });
  }

  // Only allow-listed fields, and never a tenant key or a link.
  const rawFields = (body.fields && typeof body.fields === 'object') ? body.fields as Record<string, any> : {};
  const allowed = fieldsFor(kind);
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(rawFields)) {
    if (allowed.has(k) && v !== undefined) fields[k] = v;
  }

  try {
    const result = await mergeContacts({
      kind, primaryId, duplicateId, primary, duplicate, fields,
      businessId, dryRun, cascade, actorUid: decoded.uid, actorEmail: decoded.email || null,
      startedAt: Date.now(),
    });

    if (!dryRun) {
      await writeAudit({
        businessId,
        actorUid: decoded.uid,
        actorEmail: decoded.email || null,
        action: 'contact.merge',
        target: `${kind}:${primaryId}`,
        meta: {
          duplicateId, moved: result.moved, total: result.total,
          truncated: result.truncated, fields: result.fieldsWritten,
          cascadedInto: result.cascade ? `${result.cascade.kind}:${result.cascade.primaryId}` : null,
        },
      });
    }

    return res.status(200).json({ ok: true, dryRun, ...result });
  } catch (err: any) {
    console.error('[merge-contacts] failed:', err?.message || err);
    return res.status(500).json({ error: 'Bashkimi dështoi', detail: err?.message || String(err) });
  }
}

/**
 * Admin/Manager (or owner) of the business, or platform super-admin.
 *
 * `bid` on the token proves staff membership of that business, but not the role —
 * so the role is read from the authoritative `teamMembers` records of the teams
 * inside this business.
 */
async function isBusinessAdmin(decoded: admin.auth.DecodedIdToken, businessId: string | null): Promise<boolean> {
  if (decoded.superAdmin === true) return true;
  if (!businessId) return false;
  // A portal client must never reach this endpoint, whatever else they carry.
  if ((decoded as any).cid) return false;
  if ((decoded as any).bid && (decoded as any).bid !== businessId) return false;

  const roles = Array.isArray((decoded as any).roles) ? ((decoded as any).roles as string[]) : [];
  const claimedAdmin = roles.some((r) => ['owner', 'admin', 'manager'].includes(String(r).toLowerCase()));
  if ((decoded as any).bid === businessId && claimedAdmin) return true;

  // Fallback for tokens minted before the claims rollout: check memberships.
  try {
    const teams = await db.collection('teams').where('businessId', '==', businessId).get();
    const teamIds = teams.docs.map((d) => d.id);
    if (teams.docs.some((d) => (d.data() as any)?.createdByUserId === decoded.uid)) return true;
    // The businessId may itself be a legacy teamId (no business layer yet).
    if (!teamIds.includes(businessId)) teamIds.push(businessId);
    for (const teamId of teamIds.slice(0, 20)) {
      const direct = await db.collection('teamMembers').doc(`${teamId}_${decoded.uid}`).get();
      const m = direct.exists ? (direct.data() as any) : null;
      if (m && m.status !== 'Inactive' && ['Admin', 'Manager'].includes(m.role)) return true;
    }
    const legacy = await db.collection('teamMembers').where('userId', '==', decoded.uid).limit(20).get();
    return legacy.docs.some((d) => {
      const m = d.data() as any;
      return m.status !== 'Inactive'
        && ['Admin', 'Manager'].includes(m.role)
        && (m.businessId === businessId || teamIds.includes(m.teamId));
    });
  } catch {
    return false;
  }
}

interface MergeArgs {
  kind: Kind;
  primaryId: string;
  duplicateId: string;
  primary: Record<string, any>;
  duplicate: Record<string, any>;
  fields: Record<string, any>;
  businessId: string | null;
  dryRun: boolean;
  cascade: boolean;
  actorUid: string;
  actorEmail: string | null;
  startedAt: number;
}

/**
 * The merge itself. Order matters:
 *   1. collect every reference (so a dry run can preview it),
 *   2. archive the duplicate,
 *   3. move the references,
 *   4. write the resolved fields + links on the survivor,
 *   5. delete the duplicate LAST — and only if nothing was left behind.
 */
async function mergeContacts(args: MergeArgs): Promise<MergeResult> {
  const { kind, primaryId, duplicateId, primary, duplicate, fields, businessId, dryRun } = args;
  const now = Timestamp.now();
  const moved: Record<string, number> = {};
  const warnings: string[] = [];
  let truncated = false;

  // ── 1. collect ──
  const plan: { collection: string; field: string; refs: admin.firestore.DocumentReference[] }[] = [];
  for (const spec of refsFor(kind)) {
    if (Date.now() - args.startedAt > BUDGET_MS) { truncated = true; break; }
    try {
      const snap = await db.collection(spec.collection)
        .where(spec.field, '==', duplicateId)
        .limit(MAX_DOCS_PER_COLLECTION + 1)
        .get();
      let docs = snap.docs;
      if (docs.length > MAX_DOCS_PER_COLLECTION) {
        docs = docs.slice(0, MAX_DOCS_PER_COLLECTION);
        truncated = true;
        warnings.push(`${spec.collection}: më shumë se ${MAX_DOCS_PER_COLLECTION} rekorde — bashkoji përsëri për pjesën tjetër.`);
      }
      // Never move a doc from another tenant, even if an id somehow collides.
      const refs = docs
        .filter((d) => sameTenant(d.data() as any, businessId))
        .map((d) => d.ref);
      if (refs.length) {
        plan.push({ collection: spec.collection, field: spec.field, refs });
        moved[spec.collection] = (moved[spec.collection] || 0) + refs.length;
      }
    } catch (err: any) {
      warnings.push(`${spec.collection}: leximi dështoi (${err?.message || 'gabim'})`);
    }
  }

  // Array-valued links (a daily report can name several customers).
  const arrayPlan: { collection: string; field: string; refs: admin.firestore.DocumentReference[] }[] = [];
  for (const spec of arrayRefsFor(kind)) {
    try {
      const snap = await db.collection(spec.collection)
        .where(spec.field, 'array-contains', duplicateId)
        .limit(MAX_DOCS_PER_COLLECTION)
        .get();
      const refs = snap.docs.filter((d) => sameTenant(d.data() as any, businessId)).map((d) => d.ref);
      if (refs.length) {
        arrayPlan.push({ collection: spec.collection, field: spec.field, refs });
        moved[spec.collection] = (moved[spec.collection] || 0) + refs.length;
      }
    } catch { /* collection may not exist in this tenant */ }
  }

  // Portal chat lives under a channelId that EMBEDS the customer id
  // (`client-<customerId>[-project-…]`), so the thread has to be renamed, not
  // re-pointed. A range query on the prefix needs no composite index.
  const chatPlan = kind === 'customer'
    ? await collectChatMigration(duplicateId, businessId, warnings)
    : { messages: [], conversations: [], truncated: false } as ChatPlan;
  if (chatPlan.messages.length) moved.messages = (moved.messages || 0) + chatPlan.messages.length;
  if (chatPlan.conversations.length) {
    moved.conversations = (moved.conversations || 0) + chatPlan.conversations.length;
  }
  // A long chat history renames in several passes; deleting the customer after the
  // first one would leave the rest of the messages under a channel nobody opens.
  if (chatPlan.truncated) {
    truncated = true;
    warnings.push(`messages: më shumë se ${MAX_DOCS_PER_COLLECTION} mesazhe portali — bashkoji përsëri për pjesën tjetër.`);
  }

  const total = Object.values(moved).reduce((n, v) => n + v, 0);
  const fieldsWritten = Object.keys(fields);

  if (dryRun) {
    return { kind, primaryId, duplicateId, moved, total, truncated, fieldsWritten, warnings, cascade: null };
  }

  // ── 2. archive the duplicate BEFORE touching anything ──
  const mergeRef = db.collection('contactMerges').doc();
  await mergeRef.set({
    businessId: businessId || null,
    teamId: duplicate.teamId || primary.teamId || null,
    kind,
    primaryId,
    duplicateId,
    // Full snapshot: the only copy of the absorbed record once it is deleted.
    duplicateSnapshot: stripUndefined(duplicate),
    primaryBefore: pickFields(primary, [...fieldsFor(kind)]),
    fieldsWritten,
    moved,
    actorUid: args.actorUid,
    actorEmail: args.actorEmail,
    createdAt: now,
  });

  // ── 3. move the references ──
  for (const entry of plan) {
    for (let i = 0; i < entry.refs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const ref of entry.refs.slice(i, i + BATCH_SIZE)) {
        batch.update(ref, { [entry.field]: primaryId, updatedAt: now });
      }
      await batch.commit();
    }
  }
  for (const entry of arrayPlan) {
    for (let i = 0; i < entry.refs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const ref of entry.refs.slice(i, i + BATCH_SIZE)) {
        batch.update(ref, {
          [entry.field]: admin.firestore.FieldValue.arrayRemove(duplicateId),
          updatedAt: now,
        });
      }
      await batch.commit();
      const batch2 = db.batch();
      for (const ref of entry.refs.slice(i, i + BATCH_SIZE)) {
        batch2.update(ref, { [entry.field]: admin.firestore.FieldValue.arrayUnion(primaryId) });
      }
      await batch2.commit();
    }
  }
  if (kind === 'customer') {
    await applyChatMigration(chatPlan, duplicateId, primaryId, now, warnings);
  }

  // ── 4. the survivor: resolved fields + links + provenance ──
  const update: Record<string, any> = { ...fields, updatedAt: now };
  update.mergedFromIds = admin.firestore.FieldValue.arrayUnion(duplicateId);
  update.lastMergedAt = now;
  if (typeof update.email === 'string') update.email = update.email.trim().toLowerCase();

  // Keep the cross-kind link if only the duplicate had one.
  const linkField = kind === 'customer' ? 'leadId' : 'customerId';
  const inheritedLink = !primary[linkField] && duplicate[linkField] ? duplicate[linkField] : null;
  if (inheritedLink) update[linkField] = inheritedLink;
  await db.collection(collectionOf(kind)).doc(primaryId).update(update);

  // The counterpart must point back at the survivor, or the pair silently breaks.
  const counterpartColl = kind === 'customer' ? 'leads' : 'customers';
  const counterpartField = kind === 'customer' ? 'customerId' : 'leadId';
  const counterpartId = primary[linkField] || inheritedLink;
  if (counterpartId) {
    await db.collection(counterpartColl).doc(counterpartId)
      .update({ [counterpartField]: primaryId, updatedAt: now })
      .catch(() => warnings.push(`Lidhja me ${counterpartColl}/${counterpartId} nuk u përditësua.`));
  }

  // Two portal-access rows for one email would resurrect the ambiguity we just
  // removed, so collapse them now that they all point at the survivor.
  let deduped = 0;
  if (kind === 'customer') {
    deduped = await dedupePortalAccess(primaryId, warnings);
  }

  // ── 5. delete the duplicate — never while data may still reference it ──
  if (truncated) {
    warnings.push('Rekordi dublikat NUK u fshi: kishte më shumë rekorde lidhur sesa një kalim i vetëm mund të zhvendosë. Ekzekuto bashkimin përsëri.');
  } else {
    await db.collection(collectionOf(kind)).doc(duplicateId).delete();
  }

  // ── cascade: the same person's lead/customer counterpart pair ──
  let cascadeResult: MergeResult | null = null;
  const primaryLink = primary[linkField];
  const dupLink = duplicate[linkField];
  if (args.cascade && !truncated && primaryLink && dupLink && primaryLink !== dupLink) {
    const otherKind: Kind = kind === 'customer' ? 'lead' : 'customer';
    try {
      const otherColl = collectionOf(otherKind);
      const [pSnap, dSnap] = await Promise.all([
        db.collection(otherColl).doc(primaryLink).get(),
        db.collection(otherColl).doc(dupLink).get(),
      ]);
      if (pSnap.exists && dSnap.exists) {
        cascadeResult = await mergeContacts({
          ...args,
          kind: otherKind,
          primaryId: primaryLink,
          duplicateId: dupLink,
          primary: pSnap.data() as any,
          duplicate: dSnap.data() as any,
          // Field resolution was decided for the visible pair only; the linked pair
          // keeps the survivor's own values (nothing is discarded — the absorbed
          // record is archived in contactMerges).
          fields: {},
          cascade: false,
        });
      }
    } catch (err: any) {
      warnings.push(`Bashkimi i ${otherKind === 'lead' ? 'lead-eve' : 'klientëve'} të lidhur dështoi: ${err?.message || 'gabim'}`);
    }
  }

  return {
    kind, primaryId, duplicateId, moved, total, truncated, fieldsWritten, warnings,
    deduped, mergeId: mergeRef.id, cascade: cascadeResult,
  };
}

function sameTenant(data: Record<string, any>, businessId: string | null): boolean {
  if (!businessId) return true;
  const bid = data?.businessId || data?.teamId;
  return !bid || bid === businessId;
}

function stripUndefined(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function pickFields(obj: Record<string, any>, keys: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k];
  return out;
}

// ── portal chat ──────────────────────────────────────────────────────────────

interface ChatPlan {
  messages: admin.firestore.QueryDocumentSnapshot[];
  conversations: admin.firestore.QueryDocumentSnapshot[];
  /** More messages than one pass can rename — the duplicate must survive this run. */
  truncated: boolean;
}

/**
 * Messages and conversation threads whose channel id belongs to the duplicate.
 * `client-<id>` and `client-<id>-project-<pid>` both start with the same prefix,
 * so one range query covers the customer's whole portal chat.
 */
async function collectChatMigration(
  duplicateId: string,
  businessId: string | null,
  warnings: string[],
): Promise<ChatPlan> {
  const prefix = `client-${duplicateId}`;
  const end = `${prefix}`;
  const out: ChatPlan = { messages: [], conversations: [], truncated: false };
  try {
    const msgSnap = await db.collection('messages')
      .where('channelId', '>=', prefix)
      .where('channelId', '<=', end)
      .limit(MAX_DOCS_PER_COLLECTION + 1)
      .get();
    if (msgSnap.size > MAX_DOCS_PER_COLLECTION) out.truncated = true;
    out.messages = msgSnap.docs
      .slice(0, MAX_DOCS_PER_COLLECTION)
      .filter((d) => sameTenant(d.data() as any, businessId));
  } catch (err: any) {
    warnings.push(`Mesazhet e portalit nuk u lexuan (${err?.message || 'gabim'}).`);
  }
  try {
    const convSnap = await db.collection('conversations')
      .where(admin.firestore.FieldPath.documentId(), '>=', prefix)
      .where(admin.firestore.FieldPath.documentId(), '<=', end)
      .limit(100)
      .get();
    out.conversations = convSnap.docs.filter((d) => sameTenant(d.data() as any, businessId));
  } catch (err: any) {
    warnings.push(`Bisedat e portalit nuk u lexuan (${err?.message || 'gabim'}).`);
  }
  return out;
}

/**
 * Renames the duplicate's chat channels onto the survivor. A conversation's doc
 * id IS its channel id, so it is re-created under the new id (only when the
 * survivor has no thread there yet — an existing thread already holds the owner
 * and watcher routing we must not overwrite) and the old doc is removed.
 */
async function applyChatMigration(
  plan: ChatPlan,
  duplicateId: string,
  primaryId: string,
  now: admin.firestore.Timestamp,
  warnings: string[],
) {
  const rename = (channelId: string) =>
    channelId.replace(`client-${duplicateId}`, `client-${primaryId}`);

  try {
    for (let i = 0; i < plan.messages.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const d of plan.messages.slice(i, i + BATCH_SIZE)) {
        const channelId = (d.data() as any)?.channelId;
        if (typeof channelId !== 'string') continue;
        batch.update(d.ref, { channelId: rename(channelId) });
      }
      await batch.commit();
    }
  } catch (err: any) {
    warnings.push(`Zhvendosja e mesazheve dështoi (${err?.message || 'gabim'}).`);
  }

  for (const d of plan.conversations) {
    try {
      const data = d.data() as any;
      const newId = rename(d.id);
      if (newId === d.id) continue;
      const targetRef = db.collection('conversations').doc(newId);
      const existing = await targetRef.get();
      if (!existing.exists) {
        await targetRef.set({ ...stripUndefined(data), customerId: primaryId, updatedAt: now });
      } else {
        // Keep the survivor's routing; only carry the newer activity timestamp.
        const cur = existing.data() as any;
        const newer = (data?.lastMessageAt?.toMillis?.() || 0) > (cur?.lastMessageAt?.toMillis?.() || 0);
        if (newer) await targetRef.update({ lastMessageAt: data.lastMessageAt, updatedAt: now });
      }
      await d.ref.delete();
    } catch (err: any) {
      warnings.push(`Biseda ${d.id} nuk u zhvendos (${err?.message || 'gabim'}).`);
    }
  }
}

/**
 * One portal login per email. After a merge the survivor can hold several access
 * rows for the same address; the oldest is kept (it is the one the client has
 * been using) and the rest are removed. Returns how many were deleted.
 */
async function dedupePortalAccess(customerId: string, warnings: string[]): Promise<number> {
  try {
    const snap = await db.collection('clientPortalAccess').where('customerId', '==', customerId).get();
    const byEmail = new Map<string, admin.firestore.QueryDocumentSnapshot[]>();
    for (const d of snap.docs) {
      const email = String((d.data() as any)?.email || '').trim().toLowerCase();
      if (!email) continue;
      byEmail.set(email, [...(byEmail.get(email) || []), d]);
    }
    let deleted = 0;
    for (const docs of byEmail.values()) {
      if (docs.length < 2) continue;
      const sorted = docs.sort((a, b) =>
        ((a.data() as any)?.createdAt?.toMillis?.() || 0) - ((b.data() as any)?.createdAt?.toMillis?.() || 0));
      for (const extra of sorted.slice(1)) {
        await extra.ref.delete();
        deleted++;
      }
    }
    return deleted;
  } catch (err: any) {
    warnings.push(`Aksesi i portalit nuk u pastrua (${err?.message || 'gabim'}).`);
    return 0;
  }
}
