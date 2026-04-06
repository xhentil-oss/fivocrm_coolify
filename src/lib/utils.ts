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

// ── EUR → ALL exchange rate ──
// Stored in localStorage so admins can update it from settings.
const DEFAULT_EUR_ALL_RATE = 100;

export function getEurToAllRate(): number {
  try {
    const stored = localStorage.getItem('eur_all_rate');
    if (stored) {
      const rate = parseFloat(stored);
      if (rate > 0 && isFinite(rate)) return rate;
    }
  } catch { /* ignore */ }
  return DEFAULT_EUR_ALL_RATE;
}

export function toAll(amount: number, currency?: string): number {
  if (currency === 'EUR') return amount * getEurToAllRate();
  return amount;
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
  return digits;
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