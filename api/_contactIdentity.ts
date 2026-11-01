import { Timestamp } from './_firebaseAdmin.js';
import { convertLeadPatch, isOpenLeadStatus, type RouteLeadFacts } from './_contactRoute.js';

/**
 * Contact identity (server side) — mirror of `src/lib/contactIdentity.ts`.
 *
 * One person, one pair of records: a lead is the person BEFORE they are a
 * client; once they are a client their lead is closed (`Converted`) and kept
 * only as history, and new business from them is a Deal (`_contactRoute.ts`
 * decides which). Every server write path (landing form, portal, WhatsApp,
 * WHMCS sync) resolves the person through these helpers — email OR phone — so
 * the CRM never shows an open lead next to the client it already is.
 *
 * Keep the normalization rules identical to the client mirror.
 */

const MIN_PHONE_DIGITS = 7;

export function normContactEmail(raw?: string | null): string {
  return (raw || '').toLowerCase().trim();
}

/** Same rules as `normalizeAlbanianPhone` in src/lib/utils.ts. */
export function normalizeAlbanianPhone(raw: string): string {
  const digits = (raw || '').replace(/[^\d]/g, '');
  if (/^3550[6-9]/.test(digits)) return '355' + digits.slice(4);
  if (/^0[6-9]/.test(digits)) return '355' + digits.slice(1);
  if (/^[6-9]\d{8}$/.test(digits)) return '355' + digits;
  return digits;
}

export function normContactPhone(raw?: string | null): string {
  const normalized = normalizeAlbanianPhone(raw || '');
  return normalized.length >= MIN_PHONE_DIGITS ? normalized : '';
}

/**
 * Stored-value candidates for a phone number.
 *
 * Firestore only does exact matches and phones are stored however they were
 * typed, so an equality query on one format silently misses the same number in
 * another. We probe the handful of forms this app actually produces.
 */
export function phoneQueryVariants(raw?: string | null): string[] {
  const canonical = normContactPhone(raw);
  if (!canonical) return [];
  const variants = new Set<string>([canonical, `+${canonical}`]);
  if (raw) variants.add(raw.trim());
  if (canonical.startsWith('355')) {
    const local = canonical.slice(3);
    variants.add(local);
    variants.add(`0${local}`);
    variants.add(`+355${local}`);
  }
  return [...variants].filter(Boolean);
}

type Db = FirebaseFirestore.Firestore;
type DocSnap = FirebaseFirestore.QueryDocumentSnapshot;

export interface ContactLookup {
  email?: string | null;
  phone?: string | null;
  /** Restrict to one tenant. Docs with no teamId are accepted (legacy records). */
  teamId?: string | null;
  /**
   * Tenant boundary. When given, a doc stamped with a DIFFERENT businessId is
   * never a match — two tenants can hold the same email, and linking across
   * them would write one tenant's data into another's.
   */
  businessId?: string | null;
}

/**
 * Every doc in `collectionName` for the same person, in tenant: email matches
 * first (strong signal), then phone variants, de-duplicated. `phoneField` differs
 * per collection — leads store `phoneNumber`, customers store `phone`.
 */
async function findContactDocs(
  db: Db,
  collectionName: 'leads' | 'customers',
  phoneField: 'phoneNumber' | 'phone',
  { email, phone, teamId, businessId }: ContactLookup,
  firstOnly: boolean
): Promise<DocSnap[]> {
  const sameTenant = (d: DocSnap) => {
    const data = d.data();
    if (teamId && data.teamId && data.teamId !== teamId) return false;
    if (businessId && data.businessId && data.businessId !== businessId) return false;
    return true;
  };
  const found = new Map<string, DocSnap>();
  const take = (docs: DocSnap[]) => { for (const d of docs) if (sameTenant(d) && !found.has(d.id)) found.set(d.id, d); };

  const normEmail = normContactEmail(email);
  if (normEmail) {
    // Emails are stored lowercased on most paths but not all (older landing
    // submissions kept the raw casing), so probe both.
    const rawEmail = (email || '').trim();
    const emailForms = rawEmail && rawEmail !== normEmail ? [normEmail, rawEmail] : [normEmail];
    for (const form of emailForms) {
      const snap = await db.collection(collectionName).where('email', '==', form).limit(10).get();
      take(snap.docs);
      if (firstOnly && found.size) return [...found.values()];
    }
  }

  for (const variant of phoneQueryVariants(phone)) {
    const snap = await db.collection(collectionName).where(phoneField, '==', variant).limit(10).get();
    take(snap.docs);
    if (firstOnly && found.size) return [...found.values()];
  }

  return [...found.values()];
}

async function findContactDoc(
  db: Db,
  collectionName: 'leads' | 'customers',
  phoneField: 'phoneNumber' | 'phone',
  lookup: ContactLookup
): Promise<DocSnap | null> {
  return (await findContactDocs(db, collectionName, phoneField, lookup, true))[0] ?? null;
}

/** Every lead of this person (email OR phone) — routing needs all of them, not the first. */
export function findLeadsForContact(db: Db, lookup: ContactLookup) {
  return findContactDocs(db, 'leads', 'phoneNumber', lookup, false);
}

/** Routing facts for `resolveContactRoute` (`_contactRoute.ts`). */
export function leadRouteFacts(docs: DocSnap[]): RouteLeadFacts[] {
  return docs.map(d => ({ id: d.id, status: d.data().status ?? null, customerId: d.data().customerId ?? null }));
}

export function findLeadForContact(db: Db, lookup: ContactLookup) {
  return findContactDoc(db, 'leads', 'phoneNumber', lookup);
}

export function findCustomerForContact(db: Db, lookup: ContactLookup) {
  return findContactDoc(db, 'customers', 'phone', lookup);
}

/**
 * Cross-links a lead and a customer that turned out to be the same person.
 * Only fills empty links — never overwrites an existing one, so a deliberate
 * manual pairing survives a later automated sync. Best-effort by design: a
 * failed link must not fail the sync/submission that triggered it.
 */
export async function crossLinkLeadCustomer(
  db: Db,
  leadId: string,
  customerId: string
): Promise<void> {
  const now = Timestamp.now();
  try {
    const [leadSnap, customerSnap] = await Promise.all([
      db.collection('leads').doc(leadId).get(),
      db.collection('customers').doc(customerId).get(),
    ]);
    const writes: Promise<unknown>[] = [];
    if (leadSnap.exists && !leadSnap.data()?.customerId) {
      writes.push(leadSnap.ref.update({ customerId, updatedAt: now }));
    }
    if (customerSnap.exists && !customerSnap.data()?.leadId) {
      writes.push(customerSnap.ref.update({ leadId, updatedAt: now }));
    }
    await Promise.all(writes);
  } catch (err) {
    console.error('[contactIdentity] cross-link failed', { leadId, customerId, err });
  }
}

/**
 * The person is a client: close every OPEN lead of theirs (`Converted`, linked)
 * and pair the customer back to one of them. A client never keeps an open lead
 * (`_contactRoute.ts`). Best-effort, same as `crossLinkLeadCustomer`.
 */
export async function closeLeadsForClient(
  db: Db,
  leadIds: string[],
  customerId: string
): Promise<number> {
  if (!leadIds.length) return 0;
  const at = new Date();
  const patch = { ...convertLeadPatch(customerId, at), convertedAt: Timestamp.fromDate(at), updatedAt: Timestamp.fromDate(at) };
  let closed = 0;
  for (const id of leadIds) {
    try {
      const ref = db.collection('leads').doc(id);
      const snap = await ref.get();
      if (!snap.exists || !isOpenLeadStatus(snap.data()?.status)) continue;
      await ref.update(patch);
      await db.collection('leadActivities').add({
        leadId: id,
        teamId: snap.data()?.teamId ?? null,
        businessId: snap.data()?.businessId ?? null,
        type: 'converted',
        title: 'U mbyll automatikisht: personi është klient',
        body: 'Një klient nuk mban lead të hapur — kërkesat e reja shkojnë si marrëveshje te klienti.',
        meta: { customerId, auto: true },
        userId: null,
        userName: 'Sistemi',
        createdAt: Timestamp.fromDate(at),
      }).catch(() => {});
      closed++;
    } catch (err) {
      console.error('[contactIdentity] close lead failed', { leadId: id, customerId, err });
    }
  }
  if (closed) await crossLinkLeadCustomer(db, leadIds[0], customerId);
  return closed;
}

/**
 * A customer record that is a CLIENT was just created or synced (CRM, WHMCS):
 * close whatever open lead the same person still has, and pair the two.
 */
export async function convertLeadsForCustomer(
  db: Db,
  customerId: string,
  lookup: ContactLookup
): Promise<number> {
  try {
    const leads = await findLeadsForContact(db, lookup);
    const open = leads.filter(d => isOpenLeadStatus(d.data().status)).map(d => d.id);
    if (open.length) return await closeLeadsForClient(db, open, customerId);
    if (leads.length) await crossLinkLeadCustomer(db, leads[0].id, customerId);
  } catch (err) {
    console.error('[contactIdentity] convert leads for customer failed', { customerId, err });
  }
  return 0;
}
