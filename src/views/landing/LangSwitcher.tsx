/* Shared multilingual helpers for public landing pages (SQ / EN / IT). */

import { useCallback, useEffect, useRef, useState } from 'react';

export type Lang = 'sq' | 'en' | 'it';

export const LANGS: Lang[] = ['sq', 'en', 'it'];

const LANG_STORAGE_KEY = 'fivo.landing.lang';
const COUNTRY_CACHE_KEY = 'fivo.landing.country';

/** Time zones that mean "this device is physically in Italy / in Albania-Kosovo". */
const IT_ZONES = new Set(['Europe/Rome', 'Europe/Vatican', 'Europe/San_Marino']);
const SQ_ZONES = new Set(['Europe/Tirane', 'Europe/Skopje', 'Europe/Belgrade', 'Europe/Podgorica']);

/**
 * Countries whose language we serve, keyed by ISO-3166 alpha-2. Where the visitor
 * connects from beats whatever locale the device carries around.
 *
 * A country is listed only when one of our three languages is genuinely the
 * language of business there — anything else (DE, FR, ES…) is deliberately absent
 * so the visitor keeps the language their own browser asked for.
 */
const COUNTRY_LANG: Record<string, Lang> = {
  // Italian
  IT: 'it', SM: 'it', VA: 'it',
  // Albanian
  AL: 'sq', XK: 'sq',
  // English — the major anglophone markets
  US: 'en', GB: 'en', IE: 'en', CA: 'en', AU: 'en', NZ: 'en',
  ZA: 'en', MT: 'en', SG: 'en', AE: 'en',
};

const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as string[]).includes(v);

function readStoredLang(): Lang | null {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(saved) ? saved : null;
  } catch {
    return null; // private mode / storage disabled
  }
}

function readQueryLang(): Lang | null {
  try {
    const q = new URLSearchParams(window.location.search).get('lang')?.toLowerCase();
    return isLang(q) ? q : null;
  } catch {
    return null; // malformed query string
  }
}

/**
 * True when the visitor has already said what they want — via `?lang=` or by
 * clicking the switcher on a previous visit. Nothing automatic may override it.
 */
export function hasExplicitLang(): boolean {
  if (typeof window === 'undefined') return false;
  return readQueryLang() !== null || readStoredLang() !== null;
}

/**
 * Which language a first-time visitor should see, in priority order:
 *  1. an explicit `?lang=it` (marketing links, QR codes, ads)
 *  2. the visitor's own earlier choice on this device
 *  3. the browser's preferred languages (an Italian visitor is `it-IT`)
 *  4. the device time zone — catches a visitor in Rome whose browser is set to
 *     a fourth language (German, French…), who would otherwise get Albanian
 *  5. English as the safest international fallback
 *
 * This is the *synchronous* answer, used for the first paint. Where the visitor
 * actually is can only be learned from the server — see `fetchCountryLang()`.
 */
export function detectLang(): Lang {
  if (typeof window === 'undefined') return 'sq';

  const explicit = readQueryLang() ?? readStoredLang();
  if (explicit) return explicit;

  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const raw of preferred) {
    const base = raw?.toLowerCase().split('-')[0];
    if (base === 'it') return 'it';
    if (base === 'sq') return 'sq';
    if (base === 'en') return 'en';
  }

  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (IT_ZONES.has(zone)) return 'it';
    if (SQ_ZONES.has(zone)) return 'sq';
  } catch { /* no Intl time zone support */ }

  return 'en';
}

/**
 * The language implied by where the visitor's connection actually is.
 *
 * The browser locale and the time zone both travel with the device, so a visitor
 * on a VPN in Milan — or an Albanian phone used in Italy — still reports the old
 * settings. The request IP is the only signal that follows the connection, and
 * only the server can see it (`/api/landing?geo=1`).
 *
 * Returns null when the country is unknown or is not one we localise for, so the
 * synchronous guess stands. Cached per tab: one request per visit, not per page.
 */
export async function fetchCountryLang(signal?: AbortSignal): Promise<Lang | null> {
  try {
    const cached = sessionStorage.getItem(COUNTRY_CACHE_KEY);
    if (cached) return COUNTRY_LANG[cached] ?? null;
  } catch { /* storage disabled */ }

  try {
    const res = await fetch('/api/landing?geo=1', { signal });
    if (!res.ok) return null;
    const country = String((await res.json())?.country || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return null;
    try { sessionStorage.setItem(COUNTRY_CACHE_KEY, country); } catch { /* ignore */ }
    return COUNTRY_LANG[country] ?? null;
  } catch {
    return null; // offline, blocked, or running outside Vercel
  }
}

/**
 * Landing-page language state: guessed synchronously for the first paint,
 * corrected once the visitor's country comes back from the server, frozen the
 * moment the visitor picks a language by hand, and mirrored onto `<html lang>`
 * for Google and for screen readers.
 */
export function useLandingLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>(detectLang);
  // Once the visitor has chosen — now or on an earlier visit — geo must not win.
  const explicit = useRef(hasExplicitLang());

  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = lang;
    return () => { document.documentElement.lang = previous; };
  }, [lang]);

  useEffect(() => {
    if (explicit.current) return;
    const ctrl = new AbortController();
    fetchCountryLang(ctrl.signal).then(geoLang => {
      if (geoLang && !explicit.current) setLangState(geoLang);
    });
    return () => ctrl.abort();
  }, []);

  const setLang = useCallback((l: Lang) => {
    explicit.current = true;
    setLangState(l);
    try { localStorage.setItem(LANG_STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);

  return [lang, setLang];
}

/**
 * Compact language switcher used in landing-page navbars.
 * `accentClass` is the active-pill background (e.g. 'bg-blue-600') so it can
 * match each page's color theme.
 */
export function LangSwitcher({
  lang,
  setLang,
  accentClass = 'bg-blue-600',
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  accentClass?: string;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-gray-200 p-0.5 text-xs font-semibold">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={`px-2.5 py-1 rounded-full uppercase transition-colors ${
            lang === l ? `${accentClass} text-white` : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
