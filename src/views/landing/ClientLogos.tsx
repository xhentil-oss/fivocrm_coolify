import React, { useState, useEffect, useRef } from 'react';

/**
 * Referencat e klientëve — i përbashkët midis landing pages.
 *
 * Logot janë asete reale në static/logot/<slug>.webp. Nëse një skedar mungon,
 * qeliza bie në emrin si tekst, ndaj rrjeti nuk shfaqet kurrë bosh.
 */

interface Client { name: string; slug: string }

export const CLIENTS: Client[] = [
  { name: 'Market AnnA', slug: 'market-anna' },
  { name: 'Pierre Cardin Home', slug: 'pierre-cardin-home' },
  { name: 'Sante Plus Hospitals Group', slug: 'sante-plus' },
  { name: 'Avokati i Popullit', slug: 'avokati-i-popullit' },
  { name: 'Albtours D', slug: 'albtours-d' },
  { name: 'SOMEG Bakery & Pastry', slug: 'someg' },
  { name: 'Salus', slug: 'salus' },
  { name: 'Burger Ija Bio', slug: 'burger-ija-bio' },
  { name: 'G&A — George & Alexander', slug: 'g-and-a' },
  { name: 'Gift Card', slug: 'gift-card' },
  { name: 'Restoration 416', slug: 'restoration-416' },
  { name: 'Albania Vacaciones', slug: 'albania-vacaciones' },
  { name: 'MaxiMarket', slug: 'maxi-market' },
  { name: 'Derby Plus', slug: 'derby-plus' },
  { name: 'Rimmed', slug: 'rimmed' },
  { name: 'TIDI Group', slug: 'tidi-group' },
  { name: 'Peti Bakery', slug: 'peti-bakery' },
  { name: 'MeteoAlb', slug: 'meteoalb' },
  { name: 'Edel Company', slug: 'edel-company' },
  { name: 'Koral', slug: 'koral' },
  { name: 'Smart Dent', slug: 'smart-dent' },
  { name: 'Magniflex', slug: 'magniflex' },
  { name: 'Colin Design & AB Forniture', slug: 'colin-design-ab-forniture' },
  { name: 'Eliksir', slug: 'eliksir' },
];

function ClientLogo({ name, slug }: Client) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className="text-[13px] font-semibold text-gray-400 text-center leading-tight">{name}</span>;
  }
  return (
    <img src={`/logot/${slug}.webp`} alt={name} loading="lazy" onError={() => setFailed(true)}
      className="max-h-14 max-w-full object-contain grayscale opacity-75 hover:grayscale-0 hover:opacity-100 transition-all duration-300" />
  );
}

function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function Fade({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useInView();
  return (
    <div ref={ref}
      className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

interface ClientLogosProps {
  /** Ngjyra e kicker-it, që seksioni të ndjekë paletën e faqes pritëse. */
  accentClass?: string;
  kicker?: string;
  title?: string;
  sub?: string;
  id?: string;
}

export default function ClientLogos({
  accentClass = 'text-blue-600',
  kicker = 'Referencat',
  title = 'Ja kush na ka besuar',
  sub = 'Kompani nga prodhimi, tregtia, shëndetësia, turizmi dhe shërbimet, që kanë zgjedhur të punojnë me ne.',
  id = 'klientet',
}: ClientLogosProps) {
  return (
    <section id={id} className="py-24 bg-gray-50 border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <Fade>
          <div className="text-center mb-14">
            <p className={`text-sm font-semibold uppercase tracking-widest mb-3 ${accentClass}`}>{kicker}</p>
            <h2 className="text-3xl sm:text-4xl font-bold">{title}</h2>
            <p className="mt-4 text-gray-600 max-w-2xl mx-auto">{sub}</p>
          </div>
        </Fade>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-gray-200 rounded-2xl overflow-hidden border border-gray-200">
          {CLIENTS.map((c, i) => (
            <Fade key={c.slug} className="bg-white" delay={Math.min(i * 40, 480)}>
              <div className="h-28 flex items-center justify-center p-5">
                <ClientLogo {...c} />
              </div>
            </Fade>
          ))}
        </div>
      </div>
    </section>
  );
}
