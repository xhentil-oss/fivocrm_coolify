/* Shared multilingual helpers for public landing pages (SQ / EN / IT). */

export type Lang = 'sq' | 'en' | 'it';

export const LANGS: Lang[] = ['sq', 'en', 'it'];

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
