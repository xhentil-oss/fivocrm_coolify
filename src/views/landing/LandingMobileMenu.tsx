import React, { useState } from 'react';
import { Menu, X } from 'lucide-react';

export interface LandingNavLink {
  href: string;
  label: string;
}

/**
 * Shared mobile navigation for the public landing pages. The desktop anchor row is
 * `hidden md:flex`, which left phone visitors with no way to reach the in-page
 * sections. This renders a hamburger (shown only < md) that opens a full-width
 * dropdown with the same anchors + the primary CTA.
 */
export const LandingMobileMenu: React.FC<{
  links: LandingNavLink[];
  ctaLabel: string;
  onCta: () => void;
  /** Tailwind bg-* (or gradient) class matching the page's accent, e.g. "bg-emerald-600". */
  accentClass?: string;
}> = ({ links, ctaLabel, onCta, accentClass = 'bg-primary' }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Mbyll menunë' : 'Hap menunë'}
        aria-expanded={open}
        className="p-2 -mr-1 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
      >
        {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
      </button>

      {open && (
        <>
          {/* Tap-away overlay */}
          <div className="fixed inset-0 top-16 z-40 bg-black/20" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="fixed left-0 right-0 top-16 z-50 bg-white border-b border-gray-100 shadow-lg animate-in fade-in slide-in-from-top-2 duration-150">
            <nav className="flex flex-col p-4 gap-1">
              {links.map(l => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="px-3 py-3 rounded-lg text-base font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  {l.label}
                </a>
              ))}
              <button
                type="button"
                onClick={() => { setOpen(false); onCta(); }}
                className={`mt-2 px-5 py-3 text-base font-semibold text-white rounded-full text-center ${accentClass}`}
              >
                {ctaLabel}
              </button>
            </nav>
          </div>
        </>
      )}
    </div>
  );
};

export default LandingMobileMenu;
