import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, CheckCircle2, X, ArrowRight, Clock, Shield, Target,
  Phone, ArrowUpRight, BarChart3, Plus,
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
  price: string;
  priceNote: string;
  audience: string[];
  groups: { title: string; items: string[] }[];
  excluded: string[];
  badge?: string;
  popular?: boolean;
}

/* Paketat ndjekin strukturen e /social-media (Starter -> Growth -> Pro -> Agency),
   te pershtatura per shitjen e rezidencave: permbajtja tregon tipologjite,
   kantierin dhe destinacionin, reklamat targetojne Shqiperine, Kosoven dhe
   diasporen, dhe matja nis nga instalimi i Pixel-it e GA4-es. */
const PACKAGES: Pkg[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '120.000 Lekë',
    priceNote: '/ muaj + buxheti i reklamave',
    audience: ['Projekte në fazë ndërtimi', 'Profile pa aktivitet të rregullt', 'Shitje që ecin me rekomandime'],
    groups: [
      {
        title: 'Platformat dhe përmbajtja',
        items: [
          'Menaxhim i 2 platformave (Facebook + Instagram)',
          '12 postime në muaj',
          '8 reels në muaj: tipologji, pamje, ecuria e punimeve',
          'Dizajn grafik profesional',
          'Shkrim tekstesh, shqip dhe anglisht',
          'Kalendar mujor i përmbajtjes',
          'Publikim në orarin më të përshtatshëm të audiencës',
        ],
      },
      {
        title: 'Reklamat',
        items: [
          'Konfigurim i fushatave Meta Ads',
          '1 fushatë aktive',
          'Targetim bazë i audiencës',
        ],
      },
      {
        title: 'Matja dhe raportimi',
        items: [
          'Instalim i Meta Pixel dhe Google Analytics 4',
          'Konfigurim i konvertimeve: formular, telefon, WhatsApp',
          'Formular që kualifikon: tipologjia, buxheti, afati',
          'Raport mujor: shfaqje, ndërveprime, kërkesa',
        ],
      },
    ],
    excluded: ['Buxheti i reklamave', 'TikTok / LinkedIn / YouTube', 'Ditë xhirimi', 'Xhirim me dron', 'Google Ads', 'Video prezantuese e tipologjive'],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: '190.000 Lekë',
    priceNote: '/ muaj + buxheti i reklamave',
    badge: 'Popullor',
    audience: ['Projekte në shitje aktive', 'Shitje ndaj Shqipërisë, Kosovës dhe diasporës', 'Ekipe shitjeje që kërkojnë kontakte të vazhdueshme'],
    groups: [
      {
        title: 'Platformat dhe përmbajtja',
        items: [
          'Menaxhim i 3 platformave (Facebook + Instagram + TikTok)',
          '16 postime në muaj',
          '14 reels në muaj',
          '1 ditë xhirimi në muaj, në kantier dhe në mjediset e përfunduara',
          'Dizajn grafik dhe identitet vizual',
          'Shkrim tekstesh me rrëfim, sipas tipologjive',
          'Stories dhe Highlights për secilën tipologji',
          'Kalendar strategjik i përmbajtjes',
        ],
      },
      {
        title: 'Reklamat',
        items: [
          'Menaxhim i plotë i Meta Ads',
          '2–3 fushata aktive',
          'Google Search për fjalë kyçe që tregojnë synim blerjeje',
          'Targetim i avancuar: Shqipëri, Kosovë dhe diasporë',
          'Retargeting i vizitorëve dhe i shikuesve të videove',
          'Optimizim javor i fushatave',
        ],
      },
      {
        title: 'Kërkesat dhe raportimi',
        items: [
          'Lead-i mbërrin menjëherë në WhatsApp dhe në email',
          'Regjistrim automatik në CRM, me burimin dhe fushatën',
          'LandingPage sipas tipologjisë, me formular dhe WhatsApp',
          'Menaxhim bazë i komenteve dhe i mesazheve',
          'Raport dyjavor: lead-e, kosto për lead, cilësia sipas burimit',
        ],
      },
    ],
    excluded: ['Buxheti i reklamave', 'LinkedIn / YouTube', 'Video prezantuese e tipologjive', 'Sekuenca e email-eve', 'Bashkëpunime me media'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '320.000 Lekë',
    priceNote: '/ muaj + buxheti i reklamave',
    popular: true,
    badge: 'Më i zgjedhuri',
    audience: ['Hedhje në shitje e një faze të re', 'Shitje ndaj investitorëve', 'Objektiva mujore shitjeje'],
    groups: [
      {
        title: 'Platformat dhe përmbajtja',
        items: [
          'Menaxhim i 4 platformave (Facebook + Instagram + TikTok + LinkedIn)',
          '24 postime në muaj',
          '20 reels në muaj',
          '2 ditë xhirimi në muaj, përfshirë xhirim me dron',
          'Video prezantuese për secilën tipologji, 60–90 sekonda',
          'Dizajn grafik premium',
          'Montazh video dhe titra',
          'Kalendar strategjik tremujor',
        ],
      },
      {
        title: 'Reklamat',
        items: [
          'Meta Ads të plota',
          'Google Search dhe Display',
          '4–6 fushata aktive',
          'Audienca të përafruara dhe retargeting i shtresuar',
          'Testim A/B i materialeve reklamuese',
          'Fushata sezonale dhe fushata të posaçme për diasporën',
        ],
      },
      {
        title: 'Shitjet dhe raportimi',
        items: [
          'Menaxhim aktiv i komenteve dhe i mesazheve',
          'Kanali i shitjeve në CRM dhe trajnim i ekipit',
          'Sekuencë email-esh për lead-et që nuk vendosin menjëherë',
          'Prezantim për investitorin në PDF dhe katalog i tipologjive',
          'Raport javor dhe mujor',
          'Takim mujor për performancën me ekipin e shitjeve',
        ],
      },
    ],
    excluded: ['Buxheti i reklamave', 'YouTube Ads', 'Prodhim 3D dhe renderime arkitekturore', 'Kostoja e blerjes së medias'],
  },
  {
    id: 'agency',
    name: 'Agency',
    price: '490.000 Lekë',
    priceNote: '/ muaj + buxheti i reklamave',
    badge: 'Shërbim i plotë',
    audience: ['Zhvillime me disa faza ose projekte', 'Shitje në tregje të jashtme', 'Kompani që duan ekip të dedikuar'],
    groups: [
      {
        title: 'Platformat dhe përmbajtja',
        items: [
          'Menaxhim i 5 platformave (Facebook + Instagram + TikTok + LinkedIn + YouTube)',
          '32+ postime në muaj',
          '28+ reels në muaj',
          '3+ ditë xhirimi në muaj',
          'Film i shkurtër prezantues i projektit',
          'Xhirim mujor me dron, i projektit dhe i bregdetit',
          'Sistem i plotë vizual i markës',
          'Përmbajtje në shqip, anglisht dhe në një gjuhë të tretë',
        ],
      },
      {
        title: 'Reklamat në të gjitha platformat',
        items: [
          'Meta Ads, Google Ads dhe TikTok Ads',
          'YouTube Ads',
          'Fushata pa kufi',
          'Strategji e plotë: njohje, kërkesë, shitje',
          'Email marketing i automatizuar',
          'Lidhje me CRM dhe ndjekje e lead-eve deri në mbyllje',
          'Buxhet i optimizuar mes platformave',
        ],
      },
      {
        title: 'Ekipi dhe strategjia',
        items: [
          'Menaxher i dedikuar i klientit',
          'Menaxher i dedikuar i përmbajtjes',
          'Menaxhim i komunikimit shtatë ditë në javë',
          'Bashkëpunime me krijues përmbajtjeje dhe media',
          'Menaxhim i reputacionit në internet',
          'Raport javor, mujor dhe tremujor',
          'Strategji vjetore e shitjeve',
        ],
      },
    ],
    excluded: ['Buxheti i reklamave'],
  },
];

const COMPARE: { label: string; values: [string, string, string, string] }[] = [
  { label: 'Platforma', values: ['2', '3', '4', '5'] },
  { label: 'Postime në muaj', values: ['12', '16', '24', '32+'] },
  { label: 'Reels në muaj', values: ['8', '14', '20', '28+'] },
  { label: 'Ditë xhirimi në muaj', values: ['—', '1', '2', '3+'] },
  { label: 'Xhirim me dron', values: ['—', '—', 'Po', 'Mujor'] },
  { label: 'Meta Ads', values: ['Konfigurim', 'Të plota', 'Të plota', 'Të plota'] },
  { label: 'Google Ads', values: ['—', 'Search', 'Search + Display', 'Të plota'] },
  { label: 'Video prezantuese sipas tipologjisë', values: ['—', '—', 'Po', 'Po'] },
  { label: 'Lead-i në WhatsApp dhe CRM', values: ['—', 'Po', 'Po', 'Po'] },
  { label: 'Sekuencë email-esh', values: ['—', '—', 'Po', 'Po'] },
  { label: 'Gjuhët e përmbajtjes', values: ['SQ + EN', 'SQ + EN', 'SQ + EN', 'SQ + EN + 1'] },
  { label: 'Raportimi', values: ['Mujor', 'Dyjavor', 'Javor + mujor', 'Javor + tremujor'] },
  { label: 'Ekip i dedikuar', values: ['—', '—', '—', 'Po'] },
];

const ADDONS: { name: string; price: string }[] = [
  { name: 'Ditë shtesë xhirimi', price: '25.000 – 40.000 Lekë' },
  { name: 'Xhirim me dron, jashtë paketës', price: '12.000 – 18.000 Lekë' },
  { name: 'Video prezantuese për një tipologji', price: '35.000 – 60.000 Lekë' },
  { name: 'Katalog tipologjish ose prezantim për investitorin (PDF)', price: '40.000 – 70.000 Lekë' },
  { name: 'Bashkëpunim me krijues përmbajtjeje', price: '30.000 – 80.000 Lekë' },
  { name: 'Gjuhë shtesë e përmbajtjes', price: '15.000 Lekë / muaj' },
  { name: 'Render 3D dhe animacion arkitekturor', price: 'Me preventiv' },
];

const PKG_ACCENTS = [
  'from-slate-500 to-gray-600',
  'from-emerald-600 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-violet-600 to-purple-600',
];

export default function RezidencaLandingPage() {
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
          category: 'Rezidenca / Shitje Pronash',
          packageId: selected?.id || '',
          packageName: selected ? `Rezidenca — ${selected.name} (${selected.price}${selected.priceNote})` : 'Rezidenca / Shitje Pronash',
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
    { href: '#shtesa', label: 'Shtesa' },
    { href: '#klientet', label: 'Klientët' },
  ];

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans overflow-x-hidden">
      {/* NAV */}
      <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">FivoCRM Rezidenca</span>
          </div>
          <div className="hidden lg:flex items-center gap-7 text-sm font-medium text-gray-600">
            {navLinks.map(l => (
              <a key={l.href} href={l.href} className="hover:text-emerald-600 transition-colors">{l.label}</a>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => scrollTo('kontakt')}
              className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:shadow-lg hover:shadow-emerald-500/25 transition-all hover:-translate-y-0.5">
              Merrni Ofertën
            </button>
            <LandingMobileMenu
              links={navLinks}
              ctaLabel="Merrni Ofertën"
              onCta={() => scrollTo('kontakt')}
              accentClass="bg-gradient-to-r from-emerald-600 to-teal-600"
            />
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative pt-32 pb-16 sm:pt-40 sm:pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-50/80 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-emerald-200/30 rounded-full blur-3xl" />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Faqja hapet me propozimin. Titulli mbahet vetëm për strukturën e
              dokumentit dhe për lexuesat e ekranit — pa reklamë në kokë. */}
          <h1 className="sr-only">Propozim për marketing në rrjetet sociale — Green Coast Hills</h1>
          <FadeIn>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-100 mb-8">
              <Target className="w-4 h-4 text-emerald-600" />
              <span className="text-sm font-medium text-emerald-700">Propozim për Green Coast Hills</span>
            </div>
          </FadeIn>
          <FadeIn delay={80}>
            <p className="text-xl sm:text-2xl text-gray-900 leading-relaxed">
              Në një treg ku vendimet e blerjes ndikohen gjithnjë e më shumë nga prezenca digjitale, rrjetet sociale janë një nga mjetet më të rëndësishme për të ndërtuar besueshmëri, për të rritur vlerën e markës dhe për të krijuar një lidhje të vazhdueshme me klientët potencialë.
            </p>
          </FadeIn>
          <div className="mt-6 space-y-6 text-lg text-gray-600 leading-relaxed">
            <FadeIn delay={160}>
              <p>
                Duke marrë në konsideratë pozicionimin premium të Green Coast Hills, kemi përgatitur këtë propozim me synimin për të zhvilluar një komunikim të kuruar, estetik dhe strategjik, i cili reflekton cilësinë, stilin e jetesës dhe ekskluzivitetin që projekti përfaqëson.
              </p>
            </FadeIn>
            <FadeIn delay={240}>
              <p>
                Qasja jonë fokusohet në krijimin e përmbajtjes me standard të lartë, planifikimin strategjik të publikimeve dhe ndërtimin e një identiteti të qëndrueshëm në platformat sociale, me qëllim rritjen e angazhimit, forcimin e imazhit të markës dhe gjenerimin e interesit nga audienca e synuar.
              </p>
            </FadeIn>
            <FadeIn delay={320}>
              <p className="font-medium text-gray-900">
                Në vijim do të gjeni preventivin dhe përshkrimin e shërbimeve të propozuara, të ndërtuara për t'iu përshtatur objektivave dhe vizionit të Green Coast Hills.
              </p>
            </FadeIn>
          </div>
          <FadeIn delay={400}>
            <div className="mt-10 flex flex-col sm:flex-row gap-4">
              <button onClick={() => scrollTo('paketat')}
                className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:shadow-xl hover:shadow-emerald-500/25 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">
                Shikoni preventivin
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
              <button onClick={() => scrollTo('kontakt')}
                className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border-2 border-gray-200 hover:border-emerald-300 hover:bg-emerald-50 transition-all flex items-center justify-center gap-2">
                <Phone className="w-5 h-5" />Bisedë njohjeje
              </button>
            </div>
          </FadeIn>
          <FadeIn delay={480}>
            <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-gray-400">
              <span className="flex items-center gap-1.5"><BarChart3 className="w-4 h-4 text-emerald-500" /> Raportim me të dhëna të matshme</span>
              <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-teal-500" /> Buxheti i reklamave gjithnjë i veçuar</span>
              <span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-cyan-500" /> Pa kontratë afatgjatë</span>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* PAKETAT */}
      <section id="paketat" className="py-24 bg-gradient-to-b from-white to-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Çmimet</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Paketat dhe çmimet</h2>
              <p className="mt-4 text-gray-600 max-w-2xl mx-auto">
                Nga 120.000 Lekë deri në 490.000 Lekë në muaj. Pa kontratë afatgjatë — mund të ndryshoni paketë kur dëshironi. Buxheti i reklamave paguhet drejtpërdrejt platformave (Meta, Google, TikTok) dhe nuk përfshihet; për projekte rezidenciale rekomandojmë 120.000 – 300.000 Lekë në muaj. Çmimet pa TVSH, sipas rastit.
              </p>
            </div>
          </FadeIn>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4 items-start">
            {PACKAGES.map((pkg, i) => {
              const accent = PKG_ACCENTS[i];
              const isSel = selected?.id === pkg.id;
              return (
                <FadeIn key={pkg.id} delay={i * 110}>
                  <div className={`relative rounded-2xl bg-white border-2 transition-all duration-300 hover:shadow-2xl ${pkg.popular ? 'border-emerald-400 ring-2 ring-emerald-500/20 xl:-mt-3 xl:mb-3 shadow-xl' : 'border-gray-200 shadow-sm'} ${isSel ? 'ring-2 ring-emerald-600' : ''}`}>
                    {pkg.badge && (
                      <div className={`absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap px-3.5 py-1.5 rounded-full bg-gradient-to-r ${accent} text-white text-[11px] font-bold tracking-wide`}>{pkg.badge}</div>
                    )}
                    <div className="p-6">
                      <h3 className="text-xl font-bold">{pkg.name}</h3>
                      <div className="mt-4">
                        <span className={`text-4xl font-bold bg-gradient-to-r ${accent} bg-clip-text text-transparent`}>{pkg.price}</span>
                        {pkg.priceNote && <span className="block text-xs text-gray-500 mt-1">{pkg.priceNote}</span>}
                      </div>

                      <div className="mt-4 p-3 rounded-lg bg-gray-50">
                        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Ideal për:</p>
                        <ul className="space-y-1">
                          {pkg.audience.map((a, ai) => (
                            <li key={ai} className="text-xs text-gray-600 flex items-start gap-1.5">
                              <span className="text-emerald-500 mt-0.5">•</span>{a}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <button onClick={() => scrollTo('kontakt', pkg)}
                        className={`mt-5 w-full py-3 rounded-xl text-sm font-semibold transition-all hover:-translate-y-0.5 ${pkg.popular ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:shadow-lg hover:shadow-emerald-500/25' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}>
                        {isSel ? '✓ Zgjedhur' : 'Zgjidhni këtë paketë'}
                      </button>

                      <div className="mt-6 space-y-4">
                        {pkg.groups.map((g, gi) => (
                          <div key={gi}>
                            <p className="text-[13px] font-semibold text-gray-900">{g.title}</p>
                            {g.items.length > 0 && (
                              <ul className="mt-2 space-y-2">
                                {g.items.map((it, ii) => (
                                  <li key={ii} className="flex items-start gap-2 text-[13px] text-gray-700">
                                    <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-500" />
                                    <span>{it}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))}
                        {pkg.excluded.length > 0 && (
                          <div className="pt-3 border-t border-gray-100">
                            <p className="text-[13px] font-semibold text-gray-900 mb-2">Nuk përfshin:</p>
                            <ul className="space-y-1.5">
                              {pkg.excluded.map((f, fi) => (
                                <li key={fi} className="flex items-start gap-2 text-[13px] text-gray-400">
                                  <X className="w-4 h-4 mt-0.5 flex-shrink-0 text-gray-300" />
                                  <span>{f}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>
        </div>
      </section>

      {/* KRAHASIM */}
      <section id="krahasim" className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-14">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Krahasim</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Dallimet që përcaktojnë rezultatin</h2>
            </div>
          </FadeIn>
          <FadeIn delay={150}>
            <div className="overflow-x-auto rounded-2xl border border-gray-200 shadow-sm">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-5 py-4 font-semibold text-gray-500 uppercase tracking-wider text-xs">Elementi</th>
                    {PACKAGES.map((pkg, i) => (
                      <th key={pkg.id} className={`px-5 py-4 font-bold ${i === 2 ? 'text-emerald-700 bg-emerald-50/60' : 'text-gray-900'}`}>
                        {pkg.name}
                        <span className="block text-xs font-medium text-gray-500 mt-0.5">{pkg.price} / muaj</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARE.map((row, ri) => (
                    <tr key={row.label} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                      <td className="px-5 py-3.5 font-medium text-gray-700">{row.label}</td>
                      {row.values.map((v, vi) => (
                        <td key={vi} className={`px-5 py-3.5 ${vi === 2 ? 'bg-emerald-50/40 font-medium text-gray-900' : 'text-gray-600'}`}>
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

      {/* SHTESA */}
      <section id="shtesa" className="py-24 bg-gray-900 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-14">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400 mb-3">Shtesa</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Përshtatni paketën sipas fazës së projektit</h2>
              <p className="mt-4 text-gray-400 max-w-xl mx-auto">Çdo shtesë tarifohet veçmas dhe aprovohet paraprakisht, pa surpriza në faturë.</p>
            </div>
          </FadeIn>
          <div className="grid sm:grid-cols-2 gap-4">
            {ADDONS.map((a, i) => (
              <FadeIn key={a.name} delay={i * 80}>
                <div className="flex items-center justify-between gap-4 p-5 rounded-xl bg-gray-800/60 border border-gray-700 hover:border-emerald-500/50 transition-colors">
                  <span className="text-sm text-gray-200 flex items-center gap-2">
                    <Plus className="w-4 h-4 text-emerald-400 flex-shrink-0" />{a.name}
                  </span>
                  <span className="text-sm font-semibold text-emerald-300 whitespace-nowrap">{a.price}</span>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* KLIENTËT */}
      <ClientLogos accentClass="text-emerald-600" />

      {/* KONTAKT */}
      <section id="kontakt" className="py-24 bg-gradient-to-br from-gray-900 via-emerald-900 to-gray-900 text-white relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-teal-500/10 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400 mb-4">Gati për të filluar?</p>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">Merrni një plan konkret për projektin tuaj</h2>
                <p className="mt-5 text-gray-300 leading-relaxed text-lg">
                  Para çdo oferte, shikojmë matjen që keni instaluar, praninë aktuale dhe konkurrentët që shfaqen për kërkimet e blerësit. Rezultatin e diskutojmë me ju, pa detyrim.
                </p>
                <div className="mt-8 space-y-4">
                  {[
                    'Kontroll falas i matjes: Pixel, GA4 dhe konvertimet',
                    'Analizë e konkurrentëve që shfaqen në Google për tipologjitë tuaja',
                    'Vlerësim i kostos së pritshme për lead sipas tregut',
                  ].map((p, i) => (
                    <div key={i} className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-400" /><span className="text-gray-300">{p}</span></div>
                  ))}
                </div>
                <div className="mt-10 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                  <p className="text-sm text-amber-300 font-medium flex items-center gap-2">
                    <Clock className="w-4 h-4" />Pranojmë një numër të kufizuar projektesh rezidenciale në të njëjtën kohë, për të mos u përplasur në të njëjtin treg.
                  </p>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              {formSent ? (
                <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-10 border border-white/10 text-center">
                  <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-6"><CheckCircle2 className="w-10 h-10 text-emerald-400" /></div>
                  <h3 className="text-2xl font-bold mb-3">Faleminderit!</h3>
                  <p className="text-gray-300">Kërkesa juaj u dërgua. Do t'ju kontaktojmë brenda 24 orëve.</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">Merrni ofertën falas</h3>
                  {selected && (
                    <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-emerald-500/20 border border-emerald-500/30">
                      <div>
                        <p className="text-xs text-emerald-300">Paketa e zgjedhur</p>
                        <p className="font-semibold text-white">{selected.name} — {selected.price}</p>
                      </div>
                      <button type="button" onClick={() => setSelected(null)} className="text-emerald-300 hover:text-white text-sm underline">Ndrysho</button>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Emri i plotë *</label>
                    <input type="text" required value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Emri Mbiemri" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">Email *</label>
                      <input type="email" required value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="email@domain.com" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">Telefon</label>
                      <input type="tel" value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="+355 6X XXX XXXX" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Faqja e projektit ose Instagram</label>
                    <input type="text" value={formData.website} onChange={e => setFormData(p => ({ ...p, website: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="https://example.com ose @instagram" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Mesazh (jo i detyrueshëm)</label>
                    <textarea rows={3} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none" placeholder="Sa tipologji shiten? Në cilat tregje: Shqipëri, Kosovë, diasporë?" />
                  </div>
                  {formError && <div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">{formError}</div>}
                  <button type="submit" disabled={submitting}
                    className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white shadow-lg shadow-emerald-500/25 transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60">
                    {submitting ? 'Duke dërguar...' : 'Dërgo Kërkesën'}
                    {!submitting && <ArrowUpRight className="w-5 h-5" />}
                  </button>
                  <p className="text-xs text-gray-400 text-center">
                    Duke dërguar, pranoni <Link to="/privatesia" className="underline hover:text-white">politikën e privatësisë</Link>. Nuk do të merrni mesazhe të padëshiruara.
                  </p>
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
            <div className="w-6 h-6 rounded bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center"><Building2 className="w-3 h-3 text-white" /></div>
            <span className="font-semibold text-white text-sm">FivoCRM Rezidenca</span>
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
