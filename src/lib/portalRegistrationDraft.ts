/**
 * Portal registration draft — the extra details a client typed on /register
 * (phone, company, service, message) that the CRM record should carry.
 *
 * Why this exists: a password account is UNVERIFIED right after sign-up, and the
 * Firestore rules (audit Sep 2026) refuse every portal bootstrap write
 * (`customers`, `leads`, `clientPortalAccess`, `userProfiles`) until the address is
 * verified — an attacker registering someone else's email must not be able to plant
 * records in a tenant. So RegisterView no longer writes anything; it parks the form
 * here and `useClientPortal` consumes it on the first VERIFIED portal login, when it
 * auto-creates the Customer + access record (and `/api/link-contact` derives the lead).
 *
 * Keyed by lower-cased email so a draft never leaks into a different account on a
 * shared device. localStorage is a convenience: losing it only loses phone/company.
 */

const KEY = 'fivocrm_portal_registration_draft';

export interface PortalRegistrationDraft {
  email: string;
  name?: string;
  phone?: string;
  company?: string;
  serviceInterested?: string;
  message?: string;
  savedAt: number;
}

const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function savePortalRegistrationDraft(draft: Omit<PortalRegistrationDraft, 'savedAt'>): void {
  try {
    const clean: PortalRegistrationDraft = {
      email: draft.email.trim().toLowerCase(),
      ...(draft.name?.trim() ? { name: draft.name.trim() } : {}),
      ...(draft.phone?.trim() ? { phone: draft.phone.trim() } : {}),
      ...(draft.company?.trim() ? { company: draft.company.trim() } : {}),
      ...(draft.serviceInterested?.trim() ? { serviceInterested: draft.serviceInterested.trim() } : {}),
      ...(draft.message?.trim() ? { message: draft.message.trim().slice(0, 2000) } : {}),
      savedAt: Date.now(),
    };
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch { /* storage unavailable — the draft is a convenience */ }
}

/** The draft for THIS email only (and only while fresh); anything else is discarded. */
export function loadPortalRegistrationDraft(email: string | null | undefined): PortalRegistrationDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PortalRegistrationDraft>;
    if (!parsed || typeof parsed.email !== 'string' || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) { clearPortalRegistrationDraft(); return null; }
    if (!email || parsed.email !== email.trim().toLowerCase()) return null;
    return parsed as PortalRegistrationDraft;
  } catch {
    return null;
  }
}

export function clearPortalRegistrationDraft(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
