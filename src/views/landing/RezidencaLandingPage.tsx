import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, CheckCircle2, X, ArrowRight, Clock, Shield, Target,
  Phone, ArrowUpRight, BarChart3, Search, MessageSquare, Plus,
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
  price: string;
  priceNote: string;
  audience: string[];
  groups: { title: string; items: string[] }[];
  excluded: string[];
  badge?: string;
  popular?: boolean;
}

/* Paketat janë ndërtuar rreth shitjes së pronave, jo rreth rezervimeve:
   matësi është lead i kualifikuar → vizitë → shitje. */
const PACKAGES: Pkg[] = [
  {
    id: 'baza-rezidenciale',
    name: 'Baza Rezidenciale',
    tagline: 'Baza e matjes dhe një prani që u përgjigjet cilësisë së projektit.',
    price: '1.200 €',
    priceNote: '/ muaj + buxheti i reklamave',
    audience: ['Projekte në fazë ndërtimi', 'Zhvillues pa matje të instaluar', 'Shitje që ecin me rekomandime'],
    groups: [
      {
        title: 'Përmbajtja dhe menaxhimi',
        items: [
          'Menaxhim i 2 platformave (Instagram + Facebook)',
          '12 postime në muaj',
          '8 reels në muaj: tipologji, pamje, ecuria e punimeve',
          'Dizajn grafik dhe shkrim tekstesh, shqip dhe anglisht',
          '1 ditë xhirimi në muaj, në kantier dhe në mjediset e përfunduara',
          'Kalendar publikimi i aprovuar paraprakisht',
          'Menaxhim bazë i komenteve dhe i mesazheve',
        ],
      },
      {
        title: 'Matja — themeli që zakonisht mungon',
        items: [
          'Instalim i Meta Pixel dhe Google Analytics 4',
          'Konfigurim i konvertimeve: formular, klikim telefoni, WhatsApp',
          'Formular që kualifikon: tipologjia, buxheti, afati, vendndodhja e blerësit',
          'Raport mujor: shfaqje, ndërveprime, lead-e dhe kosto për lead',
        ],
      },
      {
        title: 'Reklamat',
        items: [
          'Konfigurim dhe menaxhim bazë i fushatave Meta',
          'Një audiencë kryesore dhe retargeting bazë',
        ],
      },
    ],
    excluded: ['Buxheti i reklamave', 'Google Search', 'Xhirim me dron', 'Faqe hyrëse sipas tipologjisë', 'Shëtitje video e tipologjive', 'Ndërlidhje me CRM'],
  },
  {
    id: 'motor-leadesh',
    name: 'Motor Lead-esh',
    tagline: 'Blerësi që ka vendosur të blejë ju gjen, dhe kërkesa e tij mbërrin e kualifikuar.',
    price: '1.900 €',
    priceNote: '/ muaj + buxheti i reklamave',
    popular: true,
    badge: 'E rekomanduar',
    audience: ['Projekte në shitje aktive', 'Shitje ndaj Shqipërisë, Kosovës dhe diasporës', 'Ekipe që duan të dinë sa kushton një lead'],
    groups: [
      { title: 'Gjithçka nga Baza Rezidenciale, plus:', items: [] },
      {
        title: 'Përmbajtja',
        items: [
          '16 postime dhe 14 reels në muaj',
          '2 ditë xhirimi në muaj, përfshirë xhirim me dron',
          'Përmbajtje sipas tipologjisë: 1+1, 2+1, dupleks, vila',
          'Përmbajtje për destinacionin — plazhi, promenada, infrastruktura, si argument investimi',
        ],
      },
      {
        title: 'Reklamat dhe kërkesa',
        items: [
          'Meta Ads të plota, me testim të materialeve reklamuese',
          'Google Search për fjalë kyçe që tregojnë synim blerjeje',
          'Segmentim: Shqipëri, Kosovë dhe diasporë (Italia, Gjermania, Zvicra, Britania)',
          'Retargeting i vizitorëve të faqes dhe i shikuesve të videove',
          'Faqe hyrëse sipas tipologjisë, me formular dhe WhatsApp',
        ],
      },
      {
        title: 'Rruga e lead-it',
        items: [
          'Lead-i mbërrin menjëherë në WhatsApp dhe në email',
          'Regjistrim automatik në CRM, me burimin dhe fushatën',
          'Kualifikim: buxheti, tipologjia, afati i blerjes, vendndodhja',
          'Raport dyjavor: lead-e, kosto për lead, cilësia sipas burimit',
        ],
      },
    ],
    excluded: ['Buxheti i reklamave', 'Shëtitje video për tipologji', 'Sekuenca e email-eve', 'Prezantim për investitorin', 'Bashkëpunime me media'],
  },
  {
    id: 'shitje-360',
    name: 'Shitje 360',
    tagline: 'Për hedhjen në shitje të një faze të re dhe për objektiva ambicioze, përfshirë investitorët dhe diasporën.',
    price: '3.200 €',
    priceNote: '/ muaj + buxheti i reklamave',
    badge: 'Zgjidhja e plotë',
    audience: ['Hedhje në shitje e një faze të re', 'Shitje ndaj investitorëve', 'Objektiva mujore shitjeje'],
    groups: [
      { title: 'Gjithçka nga Motor Lead-esh, plus:', items: [] },
      {
        title: 'Prodhimi',
        items: [
          '20 postime dhe 20 reels në muaj',
          '3 ditë xhirimi në muaj',
          'Shëtitje video profesionale për secilën tipologji, 60–90 sekonda',
          'Xhirim mujor me dron, i projektit dhe i bregdetit',
          'Prezantim për investitorin në PDF dhe katalog i tipologjive',
        ],
      },
      {
        title: 'Rritja e kërkesës',
        items: [
          'Sekuencë e pesë email-eve për lead-et që nuk vendosin menjëherë',
          'Fushata sezonale dhe fushata të posaçme për diasporën',
          'Dy bashkëpunime në muaj me krijues përmbajtjeje ose media',
          'Përmbajtje edhe në një gjuhë të tretë: italisht ose gjermanisht',
        ],
      },
      {
        title: 'Bashkëpunimi me shitjet',
        items: [
          'Konfigurim i kanalit të shitjeve në CRM dhe trajnim i ekipit',
          'Takim mujor për performancën me ekipin e shitjeve',
          'Raport i shitjeve të mbyllura: lead-e, vizita, oferta, shitje sipas burimit',
        ],
      },
    ],
    excluded: ['Buxheti i reklamave', 'Kostoja e blerjes së medias', 'Prodhim 3D dhe renderime arkitekturore'],
  },
  {
    id: 'custom',
    name: 'Sipas kërkesës',
    tagline: 'Kur projekti ka nevojë për më shumë se një marrëveshje mujore.',
    price: 'Me preventiv',
    priceNote: '',
    audience: ['Hedhje në shitje e një faze të re', 'Disa projekte njëkohësisht', 'Panair, aktivitet ose fushatë televizive'],
    groups: [
      {
        title: 'Mund të përfshijë',
        items: [
          'Prodhim 3D dhe renderime arkitekturore',
          'Fushata televizive dhe reklamë në mjedise të hapura (bilborda)',
          'Panaire pronash brenda dhe jashtë vendit',
          'Faqe e re interneti me katalog tipologjish dhe kërkesë vizite',
          'Fushata në gjuhë të tjera për tregje të veçanta',
          'Marrëveshje me portale ndërkombëtare pronash',
        ],
      },
    ],
    excluded: [],
  },
];

const COMPARE: { label: string; values: [string, string, string] }[] = [
  { label: 'Postime në muaj', values: ['12', '16', '20'] },
  { label: 'Reels në muaj', values: ['8', '14', '20'] },
  { label: 'Ditë xhirimi në muaj', values: ['1', '2', '3'] },
  { label: 'Xhirim me dron', values: ['—', 'Po', 'Mujor'] },
  { label: 'Meta Ads', values: ['Bazë', 'Të plota', 'Të plota'] },
  { label: 'Google Search', values: ['—', 'Po', 'Po'] },
  { label: 'Faqe hyrëse sipas tipologjisë', values: ['—', 'Po', 'Po'] },
  { label: 'Shëtitje video për tipologji', values: ['—', '—', 'Po'] },
  { label: 'Lead-i në WhatsApp dhe CRM', values: ['—', 'Po', 'Po'] },
  { label: 'Kualifikim i lead-it', values: ['Formular', 'I plotë', 'I plotë'] },
  { label: 'Sekuencë email-esh', values: ['—', '—', 'Po'] },
  { label: 'Gjuhët e përmbajtjes', values: ['SQ + EN', 'SQ + EN', 'SQ + EN + 1'] },
  { label: 'Raportimi', values: ['Mujor', 'Dyjavor', 'Dyjavor + takim'] },
];

const ADDONS: { name: string; price: string }[] = [
  { name: 'Ditë shtesë xhirimi', price: '250 € – 400 €' },
  { name: 'Xhirim me dron, jashtë paketës', price: '120 € – 180 €' },
  { name: 'Shëtitje video për një tipologji', price: '350 € – 600 €' },
  { name: 'Katalog tipologjish ose prezantim për investitorin (PDF)', price: '400 € – 700 €' },
  { name: 'Bashkëpunim me krijues përmbajtjeje', price: '300 € – 800 €' },
  { name: 'Gjuhë shtesë e përmbajtjes', price: '150 € / muaj' },
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
    { href: '#problemi', label: 'Problemi' },
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
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-100 mb-8">
                <Target className="w-4 h-4 text-emerald-600" />
                <span className="text-sm font-medium text-emerald-700">Marketing për zhvillues rezidencash dhe vilash</span>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.12]">
                Jo më ndjekës. Ju duhen{' '}
                <span className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 bg-clip-text text-transparent">blerës të kualifikuar</span>
              </h1>
            </FadeIn>
            <FadeIn delay={200}>
              <p className="mt-8 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
                Një apartament i shitur mbulon një vit të plotë marketingu. Ndaj treguesi i punës tonë nuk është pëlqimi, por kërkesa e kualifikuar — me buxhet, tipologji dhe afat blerjeje — që mbërrin drejt e në duart e ekipit të shitjeve.
              </p>
            </FadeIn>
            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button onClick={() => scrollTo('paketat')}
                  className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:shadow-xl hover:shadow-emerald-500/25 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">
                  Shikoni Paketat
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
                <button onClick={() => scrollTo('kontakt')}
                  className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border-2 border-gray-200 hover:border-emerald-300 hover:bg-emerald-50 transition-all flex items-center justify-center gap-2">
                  <Phone className="w-5 h-5" />Konsultim Falas
                </button>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-400">
                <span className="flex items-center gap-1.5"><BarChart3 className="w-4 h-4 text-emerald-500" /> Kosto për lead e matur, jo e supozuar</span>
                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-teal-500" /> Buxheti i reklamave gjithnjë i veçuar</span>
                <span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-cyan-500" /> Pa kontratë afatgjatë</span>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* PROBLEMI */}
      <section id="problemi" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-red-500 mb-3">Ku humbasin shitjet</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Tri boshllëqe që i shohim thuajse në çdo projekt</h2>
            </div>
          </FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: BarChart3,
                title: 'Asgjë nuk matet',
                desc: 'Pa Meta Pixel dhe pa Google Analytics 4 të instaluar, nuk dihet nga vjen kërkesa, sa kushton dhe cila reklamë e prodhoi. Buxheti shpenzohet me hamendje, jo me të dhëna.',
              },
              {
                icon: Search,
                title: 'Blerësi kërkon, ju nuk dukeni',
                desc: 'Prania vetëm në Instagram kap atë që shfleton për kënaqësi. Ai që shkruan në Google “apartament me pamje nga deti” është blerësi që ka vendosur të blejë — dhe atje takohet me konkurrentin.',
              },
              {
                icon: MessageSquare,
                title: 'Lead-i ftohet para se t’i përgjigjeni',
                desc: 'Kërkesat mbërrijnë në mesazhet e drejtpërdrejta, në telefon dhe në email, pa u regjistruar gjëkund. Kur ekipi i shitjeve kthen përgjigje pas dy ditësh, blerësi ka folur me tre projekte të tjera.',
              },
            ].map((p, i) => (
              <FadeIn key={i} delay={i * 150}>
                <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 hover:shadow-lg hover:border-red-100 transition-all h-full">
                  <div className="w-14 h-14 rounded-xl bg-red-50 flex items-center justify-center mb-6"><p.icon className="w-7 h-7 text-red-500" /></div>
                  <h3 className="text-xl font-bold mb-3">{p.title}</h3>
                  <p className="text-gray-600 leading-relaxed">{p.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
          <FadeIn delay={450}>
            <p className="mt-12 text-center text-lg text-gray-700 font-medium">
              Paketat më poshtë i mbyllin këto boshllëqe me radhë: së pari matja, pastaj kërkesa, pastaj rruga e lead-it drejt shitjes.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* PAKETAT */}
      <section id="paketat" className="py-24 bg-gradient-to-b from-white to-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Paketat</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Katër nivele, sipas fazës në të cilën ndodhet projekti</h2>
              <p className="mt-4 text-gray-600 max-w-2xl mx-auto">
                Faturim mujor, pa kontratë afatgjatë. Buxheti i reklamave paguhet drejtpërdrejt platformave dhe nuk përfshihet — për projekte rezidenciale rekomandojmë 800 € – 3.000 € në muaj, sipas fazës. Çmimet pa TVSH, sipas rastit.
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
                      <p className="text-xs text-gray-500 mt-1.5 min-h-[3.5rem] leading-relaxed">{pkg.tagline}</p>
                      <div className="mt-4">
                        <span className={`text-4xl font-bold bg-gradient-to-r ${accent} bg-clip-text text-transparent`}>{pkg.price}</span>
                        {pkg.priceNote && <span className="block text-xs text-gray-500 mt-1">{pkg.priceNote}</span>}
                      </div>

                      <div className="mt-4 p-3 rounded-lg bg-gray-50">
                        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Për:</p>
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
                    {PACKAGES.slice(0, 3).map((pkg, i) => (
                      <th key={pkg.id} className={`px-5 py-4 font-bold ${i === 1 ? 'text-emerald-700 bg-emerald-50/60' : 'text-gray-900'}`}>
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
                        <td key={vi} className={`px-5 py-3.5 ${vi === 1 ? 'bg-emerald-50/40 font-medium text-gray-900' : 'text-gray-600'}`}>
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
