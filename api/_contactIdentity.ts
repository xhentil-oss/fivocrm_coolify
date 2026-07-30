import { Timestamp } from './_firebaseAdmin.js';

/**
 * Contact identity (server side) — mirror of `src/lib/contactIdentity.ts`.
 *
 * A contact may legitimately be both a lead and a customer; what must never
 * happen is two records for the same person that don't know about each other.
 * Every server write path (landing form, WHMCS sync) resolves the counterpart
 * through these helpers and cross-links it, so the CRM never shows an orphan
 * lead next to an orphan customer for one person.
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
 * Finds an existing doc in `collectionName` for the same person: email first
 * (strong signal), then phone variants. `phoneField` differs per collection —
 * leads store `phoneNumber`, customers store `phone`.
 */
async function findContactDoc(
  db: Db,
  collectionName: 'leads' | 'customers',
  phoneField: 'phoneNumber' | 'phone',
  { email, phone, teamId, businessId }: ContactLookup
): Promise<DocSnap | null> {
  const sameTenant = (d: DocSnap) => {
    const data = d.data();
    if (teamId && data.teamId && data.teamId !== teamId) return false;
    if (businessId && data.businessId && data.businessId !== businessId) return false;
    return true;
  };

  const normEmail = normContactEmail(email);
  if (normEmail) {
    // Emails are stored lowercased on most paths but not all (older landing
    // submissions kept the raw casing), so probe both.
    const rawEmail = (email || '').trim();
    const emailForms = rawEmail && rawEmail !== normEmail ? [normEmail, rawEmail] : [normEmail];
    for (const form of emailForms) {
      const snap = await db.collection(collectionName).where('email', '==', form).limit(10).get();
      const hit = snap.docs.find(sameTenant);
      if (hit) return hit;
    }
  }

  for (const variant of phoneQueryVariants(phone)) {
    const snap = await db.collection(collectionName).where(phoneField, '==', variant).limit(10).get();
    const hit = snap.docs.find(sameTenant);
    if (hit) return hit;
  }

  return null;
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
