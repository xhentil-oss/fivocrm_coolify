import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Sanitize HTML by stripping dangerous tags/attributes (script, onerror, etc.)
 * Allows safe formatting tags only.
 */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const allowedTags = new Set([
    'h1','h2','h3','h4','h5','h6','p','br','hr','ul','ol','li',
    'strong','b','em','i','u','s','a','span','div','blockquote',
    'table','thead','tbody','tr','th','td','img','pre','code','sub','sup',
  ]);
  const allowedAttrs: Record<string, Set<string>> = {
    a: new Set(['href', 'target', 'rel']),
    img: new Set(['src', 'alt', 'width', 'height']),
    '*': new Set(['style', 'class']),
  };

  function clean(node: Node): void {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        const tag = el.tagName.toLowerCase();
        if (!allowedTags.has(tag)) {
          el.replaceWith(...Array.from(el.childNodes));
          continue;
        }
        // Remove disallowed attributes
        const tagAllowed = allowedAttrs[tag] || new Set();
        const globalAllowed = allowedAttrs['*'];
        for (const attr of Array.from(el.attributes)) {
          if (!tagAllowed.has(attr.name) && !globalAllowed.has(attr.name)) {
            el.removeAttribute(attr.name);
          }
          // Block javascript: URLs
          if ((attr.name === 'href' || attr.name === 'src') && /^\s*javascript:/i.test(attr.value)) {
            el.removeAttribute(attr.name);
          }
          // Remove event handlers
          if (attr.name.startsWith('on')) {
            el.removeAttribute(attr.name);
          }
        }
        // Force safe link attributes
        if (tag === 'a') {
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
        }
        clean(el);
      }
    }
  }

  clean(doc.body);
  return doc.body.innerHTML;
}

/**
 * Validate a URL is safe for use in href (blocks javascript:, data:, etc.)
 * Returns the URL if safe, or '#' if unsafe.
 */
export function safeHref(url: string | undefined | null): string {
  if (!url) return '#';
  const trimmed = url.trim();
  if (/^\s*javascript:/i.test(trimmed) || /^\s*data:/i.test(trimmed) || /^\s*vbscript:/i.test(trimmed)) {
    return '#';
  }
  // Allow http, https, mailto, tel
  if (/^(https?:|mailto:|tel:|\/)/i.test(trimmed)) return trimmed;
  // Allow relative URLs
  if (!trimmed.includes(':')) return trimmed;
  return '#';
}

// ── Foreign currency → ALL exchange rates ──
// Stored in localStorage so admins can update them from settings. Defaults are
// approximate; admins should set the real rate. ALL is the base (rate 1).
const DEFAULT_RATES: Record<string, number> = { EUR: 100, USD: 92, GBP: 118, ALL: 1, LEK: 1 };
const RATE_KEYS: Record<string, string> = { EUR: 'eur_all_rate', USD: 'usd_all_rate', GBP: 'gbp_all_rate' };

// Rate to convert one unit of `currency` into ALL. Unknown/empty currency → 1
// (treated as already-ALL) so a missing currency never silently 100x a total.
export function getRateToAll(currency?: string): number {
  const cur = (currency || 'ALL').toUpperCase();
  if (cur === 'ALL' || cur === 'LEK' || cur === '') return 1;
  try {
    const key = RATE_KEYS[cur];
    if (key) {
      const stored = localStorage.getItem(key);
      if (stored) { const r = parseFloat(stored); if (r > 0 && isFinite(r)) return r; }
    }
  } catch { /* ignore */ }
  return DEFAULT_RATES[cur] ?? 1;
}

// Kept for existing callers that specifically read the EUR rate.
export function getEurToAllRate(): number { return getRateToAll('EUR'); }

// Normalize any amount to ALL. Now handles EUR/USD/GBP (was EUR-only, so USD/GBP
// were silently counted 1:1 and understated ~90-120x).
export function toAll(amount: number, currency?: string): number {
  return (amount || 0) * getRateToAll(currency);
}

// Inverse of toAll: express an ALL amount in `currency`. Needed when a total is
// aggregated in ALL but must be STORED in a document's own currency (e.g. summing
// services priced in EUR onto an ALL-denominated invoice).
export function fromAll(amountAll: number, currency?: string): number {
  const rate = getRateToAll(currency);
  return rate > 0 ? (amountAll || 0) / rate : (amountAll || 0);
}

/**
 * A lejohet ky përdorues të shohë të dhëna financiare (buxhet/çmim)?
 * Vetëm Manager, Admin dhe SuperAdmin. (`isAdmin` mbulon Admin + Owner + SuperAdmin.)
 * Burim i vetëm i rregullit — përdoret te buxheti i projektit dhe çmimi i briefit.
 */
export function canSeeFinancials(p: { isAdmin?: boolean; isManager?: boolean } | null | undefined): boolean {
  return !!(p && (p.isAdmin || p.isManager));
}

// ── Currency / date formatting ──
// Centralized so the 80+ ad-hoc .toLocaleDateString()/.toFixed() call sites can
// converge on one implementation (sq-AL locale, consistent rounding).

/** Format a number as a currency string in sq-AL locale. Defaults to EUR. */
/** ALL (Lek) is the house currency: an amount with no explicit currency is Lek.
 *  This defaulted to EUR, which silently mislabelled Lek figures as euros. */
export function formatCurrency(amount: number, currency: 'EUR' | 'ALL' | 'USD' | 'GBP' = 'ALL'): string {
  const value = typeof amount === 'number' && isFinite(amount) ? amount : 0;
  try {
    return value.toLocaleString('sq-AL', {
      style: 'currency',
      currency,
      minimumFractionDigits: currency === 'ALL' ? 0 : 2,
      maximumFractionDigits: currency === 'ALL' ? 0 : 2,
    });
  } catch {
    // Fallback if the runtime lacks the currency/locale data
    return `${value.toFixed(currency === 'ALL' ? 0 : 2)} ${currency}`;
  }
}

/** Shorthand: format as EUR. */
export function formatEUR(amount: number): string {
  return formatCurrency(amount, 'EUR');
}

/** Shorthand: format as ALL (Albanian Lek, no decimals). */
export function formatALL(amount: number): string {
  return formatCurrency(amount, 'ALL');
}

/**
 * Parse a "YYYY-MM-DD" date-input string as a LOCAL date (midnight local time),
 * avoiding the UTC-shift bug of `new Date('YYYY-MM-DD')` which lands on the
 * previous day in negative-offset timezones. Returns null for invalid input.
 */
export function parseLocalDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Normalize an Albanian phone number to international digit-only format.
 * "069123456" → "35569123456", "+355069123456" → "35569123456",
 * "35569123456" → "35569123456" (no change).
 */
export function normalizeAlbanianPhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  // "3550[6-9]…" → strip the trunk-prefix zero
  if (/^3550[6-9]/.test(digits)) return '355' + digits.slice(4);
  // "0[6-9]…" → local format, prepend country code
  if (/^0[6-9]/.test(digits)) return '355' + digits.slice(1);
  // Bare local mobile "6[6-9]…" / "7[6-9]…" (9 digits) → prepend 355
  if (/^[6-9]\d{8}$/.test(digits)) return '355' + digits;
  return digits;
}

/**
 * Strict variant: returns `null` if the input cannot be confidently parsed as
 * an Albanian mobile number (or any reasonable international number).  Used
 * before sending WhatsApp messages so we don't waste API quota on garbage.
 *
 * Rules:
 *   - Albanian mobile prefixes: 06[6-9], 06[7-9], 067, 068, 069 → normalized to 3556…
 *   - Bare 9-digit local: 6[6-9]……… (rare) accepted
 *   - International: any 8–15 digit string starting with a non-zero digit
 */
export function validatePhone(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const normalized = normalizeAlbanianPhone(raw);
  if (!/^\d+$/.test(normalized)) return null;
  if (normalized.length < 8 || normalized.length > 15) return null;
  // Albanian numbers MUST start with 3556[6-9] or 3557 (mobile / VOIP)
  if (normalized.startsWith('355')) {
    if (!/^3556[6-9]\d{7}$/.test(normalized) && !/^3557\d{7,8}$/.test(normalized)) {
      return null;
    }
  } else if (normalized.startsWith('0')) {
    // Leading zero after normalization means we couldn't strip it → invalid
    return null;
  }
  return normalized;
}

/**
 * onKeyDown handler for phone/tel inputs.
 * Allows: digits, +, -, (, ), space, and control keys.
 */
export function phoneKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key.length === 1 && !/[\d\s+\-()#*]/.test(e.key)) {
    e.preventDefault();
  }
}

/**
 * onKeyDown handler for SWIFT/BIC inputs.
 * Allows only alphanumeric characters (A-Z, 0-9).
 */
export function swiftKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key.length === 1 && !/[a-zA-Z0-9]/.test(e.key)) {
    e.preventDefault();
  }
}

/**
 * onChange handler that converts IBAN input to uppercase and removes
 * characters that are not letters, digits, or spaces.
 */
export function ibanChange(
  value: string,
  setter: (v: string) => void
) {
  setter(value.toUpperCase().replace(/[^A-Z0-9\s]/g, ''));
}

/** Converts a Firestore Timestamp, Date, or any date-like value to milliseconds. */
export function getTimestampMs(ts: any): number {
  if (!ts) return 0;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  if (typeof ts === 'number') return ts;
  return new Date(ts).getTime() || 0;
}

/**
 * True if a value looks like a date: a JS Date, a Firestore Timestamp
 * ({seconds}/toDate), or an ISO-8601 string (e.g. "2026-06-24T11:50:33.608Z").
 */
export function isDateLike(v: any): boolean {
  if (v instanceof Date) return true;
  if (v && typeof v === 'object' && (typeof v.toDate === 'function' || typeof v.seconds === 'number')) return true;
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
  return false;
}

/** Coerce a Date / Firestore Timestamp / ISO string / millis into a Date, or null. */
export function toDate(v: any): Date | null {
  const ms = getTimestampMs(v);
  return ms ? new Date(ms) : null;
}

/** Format a date-like value as a localized date (sq-AL). Returns '' when empty/invalid. */
export function formatDate(v: any, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }): string {
  const d = toDate(v);
  return d ? d.toLocaleDateString('sq-AL', opts) : '';
}

/** Format a date-like value as a localized date + time (sq-AL). Returns '' when empty/invalid. */
export function formatDateTime(v: any): string {
  const d = toDate(v);
  return d ? d.toLocaleString('sq-AL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}