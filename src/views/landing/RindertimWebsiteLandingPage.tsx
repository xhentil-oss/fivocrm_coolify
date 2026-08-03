import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Code2, CheckCircle2, X, ArrowRight, Clock, Shield,
  Phone, ArrowUpRight, Layers, Star,
} from 'lucide-react';
import LandingMobileMenu from './LandingMobileMenu';
import ClientLogos from './ClientLogos';

/* ─── scroll-in animation ─── */
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
function FadeIn({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useInView();
  return (
    <div ref={ref}
      className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

interface Pkg {
  id: string;
  name: string;
  tagline: string;
  price: number;          // EUR, një herë
  deadline: string;       // afati i realizimit
  badge?: string;
  popular?: boolean;
  included: string[];
  excluded: string[];
}

const PACKAGES: Pkg[] = [
  {
    id: 'corporate-rebuild',
    name: 'Corporate Rebuild',
    tagline: 'Baza e duhur: strukturë, dizajn dhe SEO të rindërtuara nga fillimi, me përmbajtjen aktuale të riorganizuar profesionalisht.',
    price: 1490,
    deadline: '18–22 ditë pune',
    included: [
      'Strategjia dhe struktura:',
      'Analizë e faqes aktuale të internetit dhe e strukturës së saj',
      'Planifikim i strukturës së re të faqeve',
      'Transferim dhe riorganizim i përmbajtjes ekzistuese',
      'Korrigjim bazë i teksteve ekzistuese',
      'Dizajn dhe zhvillim:',
      'Dizajn modern dhe profesional, i përshtatur me identitetin e kompanisë',
      'Zhvillim i përshtatur për kompjuter, tablet dhe telefon',
      'Deri në 12 faqe gjithsej',
      'Një gjuhë: shqip',
      'Faqe kryesore, Rreth nesh, Galeri dhe Kontakt',
      'Katalog i kategorive të produkteve (deri në 8 kategori)',
      'Faqe “Procesi i prodhimit” dhe “Riciklimi”',
      'Formular kontakti',
      'Integrim me WhatsApp, telefon, email dhe hartë',
      'SEO dhe performanca:',
      'Optimizim bazë SEO brenda faqes',
      'Tituj dhe përshkrime SEO për faqet kryesore',
      'Hartë e faqes (sitemap) dhe konfigurim i indeksimit',
      'Lidhje me Google Analytics 4 dhe Search Console',
      'Optimizim bazë i shpejtësisë së ngarkimit',
      'Ridrejtim i URL-ve kryesore të vjetra',
      'Konfigurim bazë i sigurisë dhe i kopjeve rezervë',
      'Dorëzimi:',
      'Akses i plotë si administrator',
      '1 orë trajnim për menaxhimin e përmbajtjes',
      '2 cikle korrigjimesh',
      '30 ditë mirëmbajtje pas publikimit',
    ],
    excluded: [
      'Fotografi ose video profesionale',
      'Krijim i teksteve të reja nga zero',
      'Gjuhë e dytë',
      'Optimizim SEO mujor',
      'Katalog PDF',
    ],
  },
  {
    id: 'b2b-growth',
    name: 'B2B Growth',
    tagline: 'Platformë B2B që paraqet produktet me specifikime dhe sjell kërkesa konkrete për ofertë.',
    price: 2490,
    deadline: '25–30 ditë pune',
    popular: true,
    badge: 'E rekomanduar',
    included: [
      'Gjithçka nga Corporate Rebuild, plus:',
      'Struktura dhe gjuhët:',
      'Deri në 18 faqe gjithsej',
      'Dy gjuhë: shqip dhe anglisht',
      'Deri në 12 faqe të strukturuara produktesh',
      'Strukturë profesionale për çdo produkt: përshkrim, material, dimensione, trashësia në mikron, ngjyra, përdorime, mundësi personalizimi dhe sektorë',
      'Faqe “Sektorët që shërbejmë”',
      'Faqe “Cilësia dhe standardet”',
      'Faqe “Riciklimi dhe qëndrueshmëria”',
      'Seksion për certifikata dhe standarde',
      'Seksion për klientë dhe partnerë',
      'Seksion me pyetjet më të shpeshta',
      'Kërkesat për ofertë:',
      'Formular specifik “Kërko ofertë” për çdo produkt',
      'Fusha për produktin, dimensionet, sasinë, materialin, shtypjen e logos dhe afatin',
      'Formularë me mbrojtje kundër mesazheve të padëshiruara',
      'Matje e klikimeve në telefon, email, WhatsApp dhe formularë',
      'Përmbajtja dhe SEO:',
      'Shkrim dhe ristrukturim profesional i teksteve deri në 15 faqe',
      'Strukturë e fjalëve kyçe',
      'Optimizim SEO i thelluar për faqet kryesore',
      'URL të pastra dhe schema markup',
      'Ridrejtime 301 nga faqet e vjetra',
      'Dorëzimi:',
      '3 cikle korrigjimesh',
      '2 orë trajnim dhe regjistrim video i trajnimit',
      '60 ditë mirëmbajtje pas publikimit',
    ],
    excluded: [
      'Fotografi dhe video profesionale',
      'Katalog ose profil i kompanisë në PDF',
      'Faqe hyrëse sipas sektorëve',
    ],
  },
  {
    id: 'brand-content-360',
    name: 'Brand & Content 360',
    tagline: 'Rindërtim i plotë i pranisë dixhitale: faqe interneti, fotografi, video dhe materiale prezantuese.',
    price: 4190,
    deadline: '35–45 ditë pune',
    badge: 'Zgjidhja e plotë',
    included: [
      'Gjithçka nga B2B Growth, plus:',
      'Faqja e internetit, e zgjeruar:',
      'Deri në 25 faqe gjithsej',
      '5 faqe hyrëse SEO sipas sektorëve ose përdorimeve',
      'Optimizim i konvertimeve',
      'Integrim i kërkesave me email ose CRM, kur integrimi teknik është i disponueshëm',
      'Fotografia:',
      '1–2 ditë xhirim fotografik dhe video në mjediset e kompanisë',
      'Planifikim paraprak i fotografive dhe i videove',
      'Fotografim i produkteve, fabrikës, makinerive dhe procesit të prodhimit',
      'Fotografim i magazinimit, personelit, kontrollit të cilësisë dhe shtypjes së logos',
      '50–70 fotografi të përpunuara profesionalisht',
      'Video:',
      '1 video prezantuese e kompanisë, 60–90 sekonda',
      '5 video vertikale për Instagram, Facebook, TikTok dhe LinkedIn',
      'Versione të videos për faqen e internetit dhe për rrjetet sociale',
      'Krijim i skenarit dhe i strukturës së videos',
      'Tekst profesional për zërin narrator ose për titrat',
      'Materiale dhe mbështetje:',
      'Katalog ose profil i kompanisë në PDF, deri në 12 faqe',
      'Analizë e sjelljes së vizitorëve pas publikimit',
      'Raport pas publikimit me rekomandime për përmirësim',
      '90 ditë mirëmbajtje pas publikimit',
    ],
    excluded: [
      'Optimizim SEO mujor (ofrohet veçmas)',
    ],
  },
];

/* Krahasim i shpejtë — vetëm dallimet që vendosin blerjen */
const COMPARE: { label: string; values: [string, string, string] }[] = [
  { label: 'Numri i faqeve', values: ['Deri në 12', 'Deri në 18', 'Deri në 25'] },
  { label: 'Gjuhët', values: ['Shqip', 'Shqip + Anglisht', 'Shqip + Anglisht'] },
  { label: 'Faqe të strukturuara produktesh', values: ['Katalog kategorish', 'Deri në 12 faqe', 'Deri në 12 faqe'] },
  { label: 'Formular “Kërko ofertë” për produkt', values: ['—', 'Po', 'Po'] },
  { label: 'Shkrim profesional i teksteve', values: ['Korrigjim bazë', 'Deri në 15 faqe', 'Deri në 15 faqe'] },
  { label: 'Optimizim SEO', values: ['Bazë', 'I thelluar', 'I thelluar + faqe hyrëse'] },
  { label: 'Fotografi profesionale', values: ['—', '—', '50–70 fotografi'] },
  { label: 'Video', values: ['—', '—', '1 prezantuese + 5 vertikale'] },
  { label: 'Katalog PDF', values: ['—', '—', 'Deri në 12 faqe'] },
  { label: 'Trajnim', values: ['1 orë', '2 orë + video', '2 orë + video'] },
  { label: 'Cikle korrigjimesh', values: ['2', '3', '3'] },
  { label: 'Support pas publikimit', values: ['30 ditë', '60 ditë', '90 ditë'] },
  { label: 'Afati i realizimit', values: ['18–22 ditë pune', '25–30 ditë pune', '35–45 ditë pune'] },
];

const PKG_ACCENTS = [
  'from-slate-500 to-gray-600',
  'from-blue-600 to-indigo-600',
  'from-violet-600 to-purple-600',
];


export default function RindertimWebsiteLandingPage() {
  const [selected, setSelected] = useState<Pkg | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', website: '', message: '' });
  const [formSent, setFormSent] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const scrollTo = (id: string, pkg?: Pkg) => {
    if (pkg) setSelected(pkg);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/landing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          category: 'Rindërtim Faqe Interneti B2B',
          packageId: selected?.id || '',
          packageName: selected ? `Rindërtim Faqe Interneti — ${selected.name} (€${selected.price})` : 'Rindërtim Faqe Interneti B2B',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Diçka shkoi keq. Provoni përsëri.');
      setFormSent(true);
    } catch (err: any) {
      setFormError(err.message || 'Diçka shkoi keq. Provoni përsëri.');
    } finally {
      setSubmitting(false);
    }
  };

  const navLinks = [
    { href: '#paketat', label: 'Paketat' },
    { href: '#krahasim', label: 'Krahasim' },
    { href: '#klientet', label: 'Klientët' },
  ];

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans overflow-x-hidden">
      {/* NAV */}
      <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center">
              <Code2 className="w-4 h-4 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">FivoCRM Web</span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-gray-600">
            {navLinks.map(l => (
              <a key={l.href} href={l.href} className="hover:text-blue-600 transition-colors">{l.label}</a>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => scrollTo('kontakt')}
              className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:shadow-lg hover:shadow-blue-500/25 transition-all hover:-translate-y-0.5">
              Merrni Ofertën
            </button>
            <LandingMobileMenu
              links={navLinks}
              ctaLabel="Merrni Ofertën"
              onCta={() => scrollTo('kontakt')}
              accentClass="bg-gradient-to-r from-blue-600 to-indigo-600"
            />
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative pt-32 pb-16 sm:pt-40 sm:pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-50/80 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-blue-200/30 rounded-full blur-3xl" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 border border-blue-100 mb-8">
                <Layers className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-medium text-blue-700">Rindërtim i plotë, nga strategjia deri në publikim</span>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.12]">
                Rindërtimi i faqes së internetit të kompanisë dhe i{' '}
                <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent">katalogut dixhital të produkteve</span>
              </h1>
            </FadeIn>
            <FadeIn delay={200}>
              <p className="mt-8 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
                Një platformë moderne që paraqet kapacitetet e kompanisë, organizon qartë produktet dhe i shndërron vizitorët në kërkesa konkrete për ofertë.
              </p>
            </FadeIn>
            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button onClick={() => scrollTo('paketat')}
                  className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:shadow-xl hover:shadow-blue-500/25 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">
                  Shikoni Paketat
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
                <button onClick={() => scrollTo('kontakt')}
                  className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border-2 border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all flex items-center justify-center gap-2">
                  <Phone className="w-5 h-5" />Konsultim Falas
                </button>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-400">
                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-500" /> Çmime të qarta, pa kosto të fshehura</span>
                <span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-blue-500" /> Afate të përcaktuara në ofertë</span>
                <span className="flex items-center gap-1.5"><Star className="w-4 h-4 text-violet-500" /> Faqe interneti, përmbajtje dhe SEO nga një partner i vetëm</span>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* PAKETAT */}
      <section id="paketat" className="py-24 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-3">Paketat</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Tri alternativa, me përmbajtje të përcaktuar qartë</h2>
              <p className="mt-4 text-gray-600 max-w-2xl mx-auto">
                Çdo paketë përcakton numrin e faqeve, gjuhët, përmbajtjen, ciklet e korrigjimeve dhe mbështetjen pas publikimit. Çmimet janë orientuese dhe pa TVSH, sipas rastit.
              </p>
            </div>
          </FadeIn>
          <div className="grid gap-6 lg:grid-cols-3 items-start">
            {PACKAGES.map((pkg, i) => {
              const accent = PKG_ACCENTS[i];
              const isSel = selected?.id === pkg.id;
              return (
                <FadeIn key={pkg.id} delay={i * 120}>
                  <div className={`relative rounded-2xl bg-white border-2 transition-all duration-300 hover:shadow-2xl ${pkg.popular ? 'border-blue-400 ring-2 ring-blue-500/20 lg:-mt-3 lg:mb-3 shadow-xl' : 'border-gray-200 shadow-sm'} ${isSel ? 'ring-2 ring-green-500' : ''}`}>
                    {pkg.badge && (
                      <div className={`absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap px-3.5 py-1.5 rounded-full bg-gradient-to-r ${accent} text-white text-[11px] font-bold tracking-wide`}>{pkg.badge}</div>
                    )}
                    <div className="p-6">
                      <h3 className="text-xl font-bold">{pkg.name}</h3>
                      <p className="text-xs text-gray-500 mt-1.5 min-h-[3.5rem] leading-relaxed">{pkg.tagline}</p>
                      <div className="mt-4 flex items-baseline gap-1.5">
                        <span className={`text-4xl font-bold bg-gradient-to-r ${accent} bg-clip-text text-transparent`}>€{pkg.price.toLocaleString()}</span>
                        <span className="text-xs text-gray-500">një herë</span>
                      </div>
                      <p className="mt-2 text-xs text-gray-500 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-blue-500" /> Afati: {pkg.deadline}
                      </p>
                      <button onClick={() => scrollTo('kontakt', pkg)}
                        className={`mt-5 w-full py-3 rounded-xl text-sm font-semibold transition-all hover:-translate-y-0.5 ${pkg.popular ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:shadow-lg hover:shadow-blue-500/25' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}>
                        {isSel ? '✓ Zgjedhur' : 'Zgjidhni këtë paketë'}
                      </button>
                      <ul className="mt-6 space-y-2.5">
                        {pkg.included.map((f, fi) => (
                          <li key={fi} className={`flex items-start gap-2 text-[13px] ${f.endsWith(':') ? 'font-semibold text-gray-900 pt-1' : 'text-gray-700'}`}>
                            {!f.endsWith(':') && <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-green-500" />}
                            <span>{f}</span>
                          </li>
                        ))}
                        {pkg.excluded.length > 0 && (
                          <li className="text-[13px] font-semibold text-gray-900 pt-2">Nuk përfshin:</li>
                        )}
                        {pkg.excluded.map((f, fi) => (
                          <li key={`x-${fi}`} className="flex items-start gap-2 text-[13px] text-gray-400">
                            <X className="w-4 h-4 mt-0.5 flex-shrink-0 text-gray-300" />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>
          <FadeIn delay={400}>
            <p className="mt-10 text-center text-sm text-gray-500">
              Afati nis pasi të dorëzohen materialet dhe të jepen akseset. Përmbajtja shtesë jashtë kufirit të paketës tarifohet veçmas.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* KRAHASIM */}
      <section id="krahasim" className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-14">
              <p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-3">Krahasim</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Dallimet kryesore mes paketave</h2>
              <p className="mt-4 text-gray-600 max-w-xl mx-auto">Një pamje e përmbledhur e atyre elementeve që përcaktojnë rezultatin.</p>
            </div>
          </FadeIn>
          <FadeIn delay={150}>
            <div className="overflow-x-auto rounded-2xl border border-gray-200 shadow-sm">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-5 py-4 font-semibold text-gray-500 uppercase tracking-wider text-xs">Elementi</th>
                    {PACKAGES.map((pkg, i) => (
                      <th key={pkg.id} className={`px-5 py-4 font-bold ${i === 1 ? 'text-blue-700 bg-blue-50/60' : 'text-gray-900'}`}>
                        {pkg.name}
                        <span className="block text-xs font-medium text-gray-500 mt-0.5">€{pkg.price.toLocaleString()}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARE.map((row, ri) => (
                    <tr key={row.label} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                      <td className="px-5 py-3.5 font-medium text-gray-700">{row.label}</td>
                      {row.values.map((v, vi) => (
                        <td key={vi} className={`px-5 py-3.5 ${vi === 1 ? 'bg-blue-50/40 font-medium text-gray-900' : 'text-gray-600'}`}>
                          {v === '—' ? <span className="text-gray-300">—</span> : v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* KLIENTËT */}
      <ClientLogos accentClass="text-blue-600" />

      {/* KONTAKT */}
      <section id="kontakt" className="py-24 bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 text-white relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-indigo-500/10 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-blue-400 mb-4">Gati për të filluar?</p>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">Merrni ofertën e detajuar për paketën që zgjodhët</h2>
                <p className="mt-5 text-gray-300 leading-relaxed text-lg">
                  Në ofertën përfundimtare përcaktohen numri i faqeve, funksionet, afatet, ciklet e korrigjimeve dhe mbështetja — pa kosto të paqarta gjatë projektit.
                </p>
                <div className="mt-8 space-y-4">
                  {[
                    'Konsultim falas, pa detyrim',
                    'Ofertë e personalizuar brenda 24 orëve',
                    'Ju merrni akses të plotë dhe pronësinë e faqes së internetit',
                  ].map((p, i) => (
                    <div key={i} className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">{p}</span></div>
                  ))}
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              {formSent ? (
                <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-10 border border-white/10 text-center">
                  <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6"><CheckCircle2 className="w-10 h-10 text-green-400" /></div>
                  <h3 className="text-2xl font-bold mb-3">Faleminderit!</h3>
                  <p className="text-gray-300">Kërkesa juaj u dërgua. Do t'ju kontaktojmë brenda 24 orëve.</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">Merrni ofertën falas</h3>
                  {selected && (
                    <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-blue-500/20 border border-blue-500/30">
                      <div>
                        <p className="text-xs text-blue-300">Paketa e zgjedhur</p>
                        <p className="font-semibold text-white">{selected.name} — €{selected.price.toLocaleString()}</p>
                      </div>
                      <button type="button" onClick={() => setSelected(null)} className="text-blue-300 hover:text-white text-sm underline">Ndrysho</button>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Emri i plotë *</label>
                    <input type="text" required value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Emri Mbiemri" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">Email *</label>
                      <input type="email" required value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="email@domain.com" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">Telefon</label>
                      <input type="tel" value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="+355 6X XXX XXXX" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Faqja aktuale e internetit (nëse ka)</label>
                    <input type="url" value={formData.website} onChange={e => setFormData(p => ({ ...p, website: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="https://example.com" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Mesazh (jo i detyrueshëm)</label>
                    <textarea rows={3} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" placeholder="Sa kategori dhe sa produkte dëshironi të publikohen? Në sa gjuhë?" />
                  </div>
                  {formError && <div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">{formError}</div>}
                  <button type="submit" disabled={submitting}
                    className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-400 hover:to-indigo-400 text-white shadow-lg shadow-blue-500/25 transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60">
                    {submitting ? 'Duke dërguar...' : 'Dërgo Kërkesën'}
                    {!submitting && <ArrowUpRight className="w-5 h-5" />}
                  </button>
                  <p className="text-xs text-gray-400 text-center">Duke dërguar, pranoni politikën e privatësisë. Nuk do të merrni mesazhe të padëshiruara.</p>
                </form>
              )}
            </FadeIn>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-10 bg-gray-950 text-gray-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center"><Code2 className="w-3 h-3 text-white" /></div>
            <span className="font-semibold text-white text-sm">FivoCRM Web</span>
          </div>
          <p className="text-sm">&copy; {new Date().getFullYear()} FivoCRM. Të gjitha të drejtat e rezervuara.</p>
          <div className="flex items-center gap-6 text-sm">
            <Link to="/login" className="hover:text-white transition-colors">Hyr</Link>
            <a href="#paketat" className="hover:text-white transition-colors">Çmimet</a>
            <a href="#kontakt" className="hover:text-white transition-colors">Kontakt</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
