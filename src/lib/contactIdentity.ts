/**
 * Contact identity — the single source of truth for "is this the same person?".
 *
 * A contact can legitimately be BOTH a lead and a customer (a client who asks
 * for a new service is still a prospect for that service). What must never
 * happen is two records for the same person that don't know about each other.
 * Every write path — manual create in CRM/Customers, landing form, portal
 * login, WHMCS sync — resolves identity through these helpers so the matching
 * rules can't drift apart per screen.
 *
 * Server-side mirror: `api/_contactIdentity.ts` (keep the two in sync).
 */

import { normalizeAlbanianPhone } from './utils';

/** Minimum digits before a phone number is trustworthy enough to match on. */
const MIN_PHONE_DIGITS = 7;

export function normContactEmail(raw?: string | null): string {
  return (raw || '').toLowerCase().trim();
}

/**
 * Canonical phone form for comparison. Returns '' for anything too short to
 * identify a person — so a contact with a junk phone never "matches" another
 * contact with an equally junk phone.
 */
export function normContactPhone(raw?: string | null): string {
  const normalized = normalizeAlbanianPhone(raw || '');
  return normalized.length >= MIN_PHONE_DIGITS ? normalized : '';
}

/** Loose shape covering both Lead (`phoneNumber`) and Customer (`phone`). */
export interface ContactLike {
  email?: string | null;
  phone?: string | null;
  phoneNumber?: string | null;
}

/**
 * Stable identity key: email when present, phone otherwise, '' when the record
 * carries neither (such a contact can't be deduped and must not match anything).
 */
export function contactKey(c: ContactLike): string {
  const email = normContactEmail(c.email);
  if (email) return `e:${email}`;
  const phone = normContactPhone(c.phone ?? c.phoneNumber);
  return phone ? `p:${phone}` : '';
}

export type MatchField = 'email' | 'phone';

export interface ContactMatch<T> {
  record: T;
  /** Which field made them match — surfaced in the UI so the user can judge. */
  on: MatchField;
}

/** Compare a candidate against one existing record; null when they differ. */
function matchOn(candidate: ContactLike, existing: ContactLike): MatchField | null {
  const candEmail = normContactEmail(candidate.email);
  const existEmail = normContactEmail(existing.email);
  if (candEmail && candEmail === existEmail) return 'email';

  const candPhone = normContactPhone(candidate.phone ?? candidate.phoneNumber);
  const existPhone = normContactPhone(existing.phone ?? existing.phoneNumber);
  if (candPhone && candPhone === existPhone) return 'phone';

  return null;
}

/**
 * All records that look like the same person as `candidate`. Email matches are
 * listed before phone matches (email is the stronger signal).
 */
export function findContactMatches<T extends ContactLike & { id: string }>(
  candidate: ContactLike,
  records: T[] | null | undefined,
  excludeId?: string
): ContactMatch<T>[] {
  if (!records?.length) return [];
  const matches: ContactMatch<T>[] = [];
  for (const record of records) {
    if (excludeId && record.id === excludeId) continue;
    const on = matchOn(candidate, record);
    if (on) matches.push({ record, on });
  }
  return matches.sort((a, b) => (a.on === b.on ? 0 : a.on === 'email' ? -1 : 1));
}

/** First match only — the common case for "does this already exist?" checks. */
export function findContactMatch<T extends ContactLike & { id: string }>(
  candidate: ContactLike,
  records: T[] | null | undefined,
  excludeId?: string
): ContactMatch<T> | null {
  return findContactMatches(candidate, records, excludeId)[0] ?? null;
}

/** Albanian label for the matched field, for toasts and dialogs. */
export function matchFieldLabel(on: MatchField): string {
  return on === 'email' ? 'email-i' : 'numri i telefonit';
}
