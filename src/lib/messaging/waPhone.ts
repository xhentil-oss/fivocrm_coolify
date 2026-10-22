/**
 * THE WhatsApp phone normaliser — one rule set for every sender (Meta, Baileys,
 * campaigns, automations, invoice reminders, inbound matching).
 *
 * Import-free on purpose: `api/_waPhone.ts` is a BYTE-IDENTICAL copy
 * (enforced by `waPhone.test.ts`) and `vps/server.ts` carries the same rules.
 * Before this module there were eight normalisers: `069…` went to Meta
 * verbatim and failed, and the campaign dedupe treated `069…` and `35569…` as
 * two people.
 *
 * Output: international digits only (no `+`), e.g. `355691234567`, or `''`
 * when the input cannot be a deliverable number.
 */

/** Digits only, `00` international prefix stripped, Albanian local forms → 355. */
export function toWaPhone(raw: unknown): string {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^3550[6-9]/.test(digits)) digits = '355' + digits.slice(4);
  else if (/^0[6-9]\d{7,8}$/.test(digits)) digits = '355' + digits.slice(1);
  else if (/^[6-9]\d{8}$/.test(digits)) digits = '355' + digits;
  return digits.length >= 8 && digits.length <= 15 ? digits : '';
}

/** A phone we can actually deliver to. */
export function isSendableWaPhone(raw: unknown): boolean {
  return toWaPhone(raw) !== '';
}

/** Same person? (both normalised, both non-empty). */
export function sameWaPhone(a: unknown, b: unknown): boolean {
  const x = toWaPhone(a);
  return x !== '' && x === toWaPhone(b);
}

/**
 * Stored-value candidates for an equality query: Firestore matches exactly and
 * phones are stored however they were typed.
 */
export function waPhoneVariants(raw: unknown): string[] {
  const canonical = toWaPhone(raw);
  if (!canonical) return [];
  const out = new Set<string>([canonical, `+${canonical}`]);
  const typed = String(raw ?? '').trim();
  if (typed) out.add(typed);
  if (canonical.startsWith('355')) {
    const local = canonical.slice(3);
    out.add(local);
    out.add(`0${local}`);
  }
  return [...out];
}
