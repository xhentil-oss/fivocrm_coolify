import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Zap, CheckCircle2, ArrowRight, ChevronDown, Phone, ArrowUpRight, Search, Bot,
  Clapperboard, LayoutGrid, Camera, BarChart3, Target, Repeat, MapPin, Users, ShieldCheck,
  Newspaper, Star, CalendarCheck, Video, FileText, Gauge, MessageCircle, Globe, MousePointerClick,
  HelpCircle, Lightbulb,
} from 'lucide-react';
import ClientLogos from './ClientLogos';
import LandingMobileMenu from './LandingMobileMenu';

/* ─── Animacioni në scroll ─── */
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold });
    obs.observe(el); return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}
function FadeIn({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useInView();
  return <div ref={ref} className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

/* ═══════════════════════════════════════════════
   Ofertë e personalizuar — Body Code (stërvitje EMS, 7 studio)
   Tre objektiva: më shumë klientë të rinj, përmbajtje që mbahet mend,
   prani më e fortë në Google (SEO + GEO).
   Dy nivele: Premium 150.000, Business 190.000 (+ reputacion online,
   vlerësimet në Google Maps, artikuj në media).
   Teksti është i klientit (miratuar 21 Tet 2026) — mos e "përmirëso".
   ═══════════════════════════════════════════════ */
const CLIENT = 'Body Code';

// Studiot e Body Code — reklamat dhe profilet në Google Maps ndërtohen për secilën.
const STUDIOS = [
  { city: 'Tiranë', spots: ['Barrikada', 'Dinamo', 'Brryli', 'Zogu i Zi', 'Astir'] },
  { city: 'Durrës', spots: ['Durrës'] },
  { city: 'Shkodër', spots: ['Shkodër'] },
];
const STUDIO_COUNT = STUDIOS.reduce((n, s) => n + s.spots.length, 0);

const HERO_STATS = [
  { n: String(STUDIO_COUNT), t: 'studio', l: 'Reklama sipas vendndodhjes' },
  { n: '16', t: 'postime në muaj', l: 'Reels, karusele dhe fotografi' },
  { n: '4', t: 'drejtime pune', l: 'Reklama, përmbajtje, SEO dhe GEO' },
  { n: '1', t: 'raport çdo muaj', l: 'Rezultatet dhe hapat e ardhshëm' },
];

// Tre objektivat që do të udhëheqin punën.
const GOALS = [
  { icon: Users, title: 'Më shumë klientë të rinj', desc: 'Përmes reklamave në Instagram dhe Facebook, do të arrijmë njerëzit pranë studiove tuaja dhe do t\'i nxisim të kërkojnë informacion ose të rezervojnë seancën e parë.' },
  { icon: Clapperboard, title: 'Përmbajtje që tërheq vëmendjen', desc: 'Do të krijojmë 16 postime në muaj, me fokus te klientët, trajnerët dhe përvoja në Body Code.' },
  { icon: Search, title: 'Prani më e fortë në Google', desc: 'Do të punojmë për pozicionimin në faqen e parë të Google dhe përmirësimin e pranisë së çdo studioje në Google Maps.' },
];

// Nga interesi te rezervimi — çfarë e ndihmon një person të zgjedhë Body Code.
const STEPS = [
  { icon: MousePointerClick, title: 'Një hap i qartë pas videos', desc: 'Përmbajtjen do ta shoqërojmë me një ftesë konkrete: kërkoni informacion, lini kontaktin ose rezervoni një seancë.' },
  { icon: MapPin, title: 'Reklama pranë çdo studioje', desc: 'Do t\'i përshtatim reklamat sipas vendndodhjes, që njerëzit të njihen me studion ku mund të vijnë më lehtë.' },
  { icon: HelpCircle, title: 'Përgjigje për pyetjet rreth EMS', desc: 'Si zhvillohet seanca? Çfarë ndien gjatë stërvitjes? Për kë është e përshtatshme? Do t\'i trajtojmë këto pyetje me shpjegime të thjeshta nga ekipi juaj.' },
  { icon: Search, title: 'Prani në momentin e kërkimit', desc: 'Do të punojmë që njerëzit që kërkojnë EMS dhe shërbimet tuaja në Google të gjejnë informacion të qartë për Body Code dhe mënyrën e rezervimit.' },
];

// Drejtimi 1 — reklamat në Instagram dhe Facebook.
const ADS = [
  { icon: MapPin, title: 'Reklama sipas vendndodhjes', desc: 'Do të synojmë njerëzit që jetojnë ose punojnë pranë studiove tuaja.' },
  { icon: Video, title: 'Video që prezantojnë përvojën', desc: 'Do të tregojmë si zhvillohet një seancë, si ndihmojnë trajnerët dhe çfarë thonë klientët për Body Code.' },
  { icon: Target, title: 'Ofertë për seancën e parë', desc: 'Do të përcaktojmë së bashku një ofertë hyrëse, me përfitime dhe kushte të qarta.' },
  { icon: Repeat, title: 'Reklama rikujtuese', desc: 'Do t\'u shfaqim mesazhe të tjera personave që kanë parë përmbajtjen ose kanë shfaqur interes, për t\'i nxitur të rezervojnë.' },
  { icon: FileText, title: 'Formularë të thjeshtë kontakti', desc: 'Të interesuarit do të mund të lënë të dhënat e tyre drejtpërdrejt në Facebook ose Instagram.' },
  { icon: BarChart3, title: 'Ndjekje e rezultateve çdo javë', desc: 'Do të matim kërkesat dhe koston për secilën. Me ndihmën e stafit tuaj, do të ndjekim edhe rezervimet dhe abonimet që vijnë prej tyre.' },
];

// Drejtimi 2 — përmbajtja: 16 postime në muaj.
const CONTENT_MIX = [
  { n: 10, label: 'Reels', desc: 'Video të shkurtra, me një hyrje që tërheq vëmendjen dhe një mesazh të qartë.' },
  { n: 4, label: 'Karusele', desc: 'Postime me disa pamje që shpjegojnë shërbimin dhe u përgjigjen pyetjeve të klientëve.' },
  { n: 2, label: 'Postime fotografike', desc: 'Fotografi të ekipit, ambienteve dhe momenteve nga puna në studio.' },
];
const CONTENT_TOTAL = CONTENT_MIX.reduce((sum, p) => sum + p.n, 0);
const THEMES = [
  { title: 'Historitë e klientëve', desc: 'Pse e zgjodhën Body Code, si e përjetojnë stërvitjen dhe çfarë progresi kanë bërë.' },
  { title: 'Seancat në praktikë', desc: 'Çfarë ndodh gjatë 20 minutave dhe si e udhëzon trajneri klientin.' },
  { title: 'Stërvitja në jetën e përditshme', desc: 'Si mund të përfshihet një seancë në një ditë të ngarkuar me punë dhe angazhime.' },
  { title: 'Pyetjet rreth EMS', desc: 'Përgjigje të kuptueshme për ndjesinë gjatë seancës, përshtatshmërinë dhe pritshmëritë.' },
  { title: 'Ekipi dhe studiot', desc: 'Trajnerët, ambientet dhe kujdesi që ofroni në çdo seancë.' },
];

// Drejtimi 3 — SEO, dhe drejtimi 4 — GEO.
const SEO = [
  { icon: Search, title: 'Fjalët që kërkojnë klientët', desc: 'Do të analizojmë kërkime si "EMS Tiranë" dhe terma të tjerë që lidhen me shërbimet dhe qytetet ku operoni.' },
  { icon: FileText, title: 'Faqe për shërbimet dhe studiot', desc: 'Do të organizojmë informacionin që çdo vizitor të gjejë lehtësisht shërbimin, adresën dhe kontaktin që i nevojitet.' },
  { icon: Gauge, title: 'Website i lehtë për t\'u përdorur', desc: 'Do të punojmë për shpejtësinë, organizimin dhe përdorimin nga telefoni.' },
  { icon: Newspaper, title: 'Artikuj që u përgjigjen pyetjeve', desc: 'Do të përgatisim përmbajtje të dobishme për EMS dhe shërbimet tuaja, bazuar në pyetjet që bëjnë klientët.' },
  { icon: MapPin, title: 'Google Maps për çdo studio', desc: 'Do të përmirësojmë profilet me fotografi, orare, shërbime dhe të dhëna të sakta kontakti.' },
];
const GEO = [
  { icon: MessageCircle, title: 'Përgjigje të qarta', desc: 'Do të trajtojmë pyetjet që bëjnë njerëzit për EMS, seancat dhe studiot.' },
  { icon: Globe, title: 'Informacion i saktë dhe i njëjtë', desc: 'Emri, shërbimet, ekipi dhe vendndodhjet do të paraqiten qartë në website dhe në profilet tuaja.' },
  { icon: Star, title: 'Përmbajtje e mbështetur në burime', desc: 'Do të përgatisim materiale të besueshme, me burime për informacionet që kërkojnë mbështetje shkencore.' },
];

// Vetëm në paketën Business.
const BUSINESS_EXTRAS = [
  { icon: ShieldCheck, title: 'Monitorim dhe reagim', desc: 'Do të ndjekim çdo ditë përmendjet, komentet dhe ankesat. Për rastet që kërkojnë sqarim, do të koordinojmë përgjigjen me ekipin tuaj.' },
  { icon: Star, title: 'Menaxhimi i vlerësimeve në Google Maps', desc: 'Do të raportojmë vlerësimet e rreme ose ato që shkelin rregullat e Google dhe do të ndjekim kërkesat për heqjen e tyre. Vendimin e merr Google. Vlerësimeve të tjera do t\'u përgjigjemi me profesionalizëm.' },
  { icon: Newspaper, title: 'Artikuj në media shqiptare dhe të huaja', desc: 'Do të përgatisim artikuj që prezantojnë Body Code, ekipin dhe shërbimet tuaja. Portalet dhe temat do t\'i përcaktojmë së bashku, për të arritur një audiencë të përshtatshme.' },
];

interface Pkg { id: string; name: string; price: number; tagline: string; badge?: string; items: string[] }
const PACKAGES: Pkg[] = [
  {
    id: 'premium', name: 'Premium', price: 150000,
    tagline: 'Për menaxhimin e reklamave, përmbajtjes dhe pranisë suaj në kërkimet online.',
    items: [
      `Menaxhimin e reklamave në Instagram dhe Facebook për ${STUDIO_COUNT} studiot.`,
      'Formularë për mbledhjen e kontakteve.',
      '16 postime në muaj: 10 Reels, 4 karusele dhe 2 postime fotografike.',
      'Stories çdo javë.',
      'Idetë, skenarët, xhirimet, montazhin dhe postimin.',
      'SEO: analizë fjalësh kyçe, përmirësim faqesh dhe artikuj.',
      `Përmirësimin e profileve në Google Maps për ${STUDIO_COUNT} studiot.`,
      'GEO: përmbajtje për kërkimet me inteligjencë artificiale.',
      'Raport mujor.',
    ],
  },
  {
    id: 'business', name: 'Business', price: 190000, badge: 'Paketa e rekomanduar',
    tagline: 'Për të gjitha shërbimet e paketës Premium, së bashku me kujdesin për reputacionin dhe praninë tuaj në media.',
    items: [
      'Të gjitha shërbimet e paketës Premium.',
      'Monitorimin dhe menaxhimin e reputacionit online.',
      'Raportimin dhe ndjekjen e kërkesave për heqjen e vlerësimeve që shkelin rregullat e Google.',
      'Përgjigje profesionale ndaj vlerësimeve për çdo studio.',
      'Artikuj në portale shqiptare.',
      'Artikuj në portale të huaja.',
      'Takim strategjie çdo muaj.',
    ],
  },
];
// Vlera e shërbimeve të marra veçmas (Lekë / muaj).
const STANDALONE_VALUE: Record<string, number> = { premium: 195000, business: 260000 };

const TIMELINE = [
  { month: 'Muaji 1', title: 'Përgatitja dhe nisja', desc: 'Analizojmë gjendjen aktuale, përcaktojmë audiencat dhe organizojmë xhirimet. Përgatisim postimet, nisim reklamat dhe përmirësimet kryesore në website.' },
  { month: 'Muaji 2', title: 'Përmirësimi sipas rezultateve', desc: 'Vlerësojmë cilat reklama sjellin kërkesa më cilësore dhe cilat video tërheqin më shumë interes. Përmirësojmë fushatat dhe vazhdojmë punën për SEO dhe GEO.' },
  { month: 'Muaji 3', title: 'Zgjerimi i asaj që funksionon', desc: 'Drejtojmë më shumë vëmendje dhe buxhet te fushatat me rezultatet më të mira. Planifikojmë vazhdimin sipas rezervimeve dhe kapacitetit të studiove.' },
];

const REPORT = [
  { icon: Users, label: 'Numrin e kërkesave të reja dhe koston për secilën.' },
  { icon: CalendarCheck, label: 'Rezervimet dhe abonimet e konfirmuara nga stafi juaj.' },
  { icon: Clapperboard, label: 'Shikimet, shpërndarjet dhe reagimet ndaj përmbajtjes.' },
  { icon: Search, label: 'Vizitat në website dhe ecurinë e pozicionimit në Google.' },
  { icon: Lightbulb, label: 'Veprimet që propozojmë për muajin pasardhës.' },
];

const FAQ = [
  { q: 'A përfshihet buxheti i reklamave në çmim?', a: 'Jo. Çmimi përfshin shërbimet e agjencisë. Buxhetin që do të shpenzohet për reklamat e përcaktojmë së bashku dhe e paguani veçmas.' },
  { q: 'Kur mund të presim kërkesat e para?', a: 'Kërkesat mund të fillojnë pas aktivizimit të reklamave. Ritmi varet nga oferta, buxheti dhe reagimi i audiencës. Javët e para do të na ndihmojnë të kuptojmë cilat fushata funksionojnë më mirë.' },
  { q: 'Kush do t\'u përgjigjet personave të interesuar?', a: 'Stafi juaj do të kontaktojë të interesuarit dhe do të konfirmojë rezervimet. Ne do të organizojmë mënyrën e mbledhjes dhe ndjekjes së kërkesave, që të matim rezultatet së bashku.' },
  { q: 'Si trajtohen vlerësimet negative në Google Maps?', a: 'Vlerësimeve do t\'u përgjigjemi në mënyrë profesionale. Kur një vlerësim shkel rregullat e Google, do ta raportojmë dhe do të ndjekim kërkesën për heqje. Heqja varet nga shqyrtimi i Google.' },
  { q: 'Çfarë është GEO?', a: 'Është puna që bëjmë me përmbajtjen dhe informacionin tuaj për të rritur mundësinë që Body Code të përmendet në përgjigjet e platformave me inteligjencë artificiale.' },
  { q: 'Në cilat portale do të dalin artikujt?', a: 'Listën e portaleve shqiptare dhe të huaja, temat dhe numrin e artikujve do t\'i përcaktojmë përpara nisjes së këtij shërbimi.' },
  { q: 'A do të ketë xhirime në të gjitha studiot?', a: 'Xhirimet do t\'i organizojmë sipas kalendarit të përmbajtjes dhe nevojave të studiove. Vendndodhjet dhe ditët e xhirimit do t\'i dakordësojmë paraprakisht.' },
  { q: 'Sa zgjat bashkëpunimi?', a: 'Plani fillestar është për tre muaj. Në fund të kësaj periudhe, do të vlerësojmë rezultatet dhe do të përcaktojmë vazhdimin.' },
];

const money = (n: number) => Math.round(n).toLocaleString('de-DE');

/* ═══════════════════════════════════════════════════════════════════════ */

export default function BodyCodeLandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [pkgId, setPkgId] = useState('business');
  const [formData, setFormData] = useState({ name: '', company: '', email: '', phone: '', message: '' });
  const [formSent, setFormSent] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const pkg = PACKAGES.find(p => p.id === pkgId) || PACKAGES[0];

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  const choose = (id: string) => { setPkgId(id); scrollTo('contact'); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormError(''); setSubmitting(true);
    try {
      const res = await fetch('/api/landing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          packageId: `body-code-${pkg.id}`,
          packageName: `${CLIENT} ${pkg.name} — ${money(pkg.price)} Lekë / muaj`,
          estimatedValue: pkg.price,
          source: 'Body Code — Ofertë Klienti',
          category: 'Marketing',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Diçka shkoi keq');
      setFormSent(true);
    } catch (err: any) {
      setFormError(err.message || 'Diçka shkoi keq. Provoni përsëri.');
    } finally { setSubmitting(false); }
  };

  const NAV = [
    { href: '#plani', label: 'Plani' },
    { href: '#permbajtja', label: 'Përmbajtja' },
    { href: '#google', label: 'Google & AI' },
    { href: '#paketat', label: 'Paketat' },
    { href: '#faq', label: 'Pyetjet' },
  ];

  const inputCls = 'w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-lime-400';

  return (
    <div className="min-h-screen bg-white text-stone-900 font-sans overflow-x-hidden">
      {/* ═══ NAV ═══ */}
      <nav className="fixed top-0 w-full z-50 bg-white/85 backdrop-blur-xl border-b border-stone-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-lime-400 to-stone-900 flex items-center justify-center"><Zap className="w-4 h-4 text-white" /></div>
            <span className="text-lg font-bold">Fivo <span className="text-stone-400 font-medium">×</span> <span className="text-lime-600">{CLIENT}</span></span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-stone-600">
            {NAV.map(l => <a key={l.href} href={l.href} className="hover:text-lime-600 transition-colors">{l.label}</a>)}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => scrollTo('contact')} className="px-5 py-2.5 text-sm font-semibold text-stone-950 rounded-full bg-gradient-to-r from-lime-400 to-lime-500 hover:shadow-lg hover:shadow-lime-500/30 transition-all hover:-translate-y-0.5">Kërkoni një takim</button>
            <LandingMobileMenu links={NAV} ctaLabel="Kërkoni një takim" onCta={() => scrollTo('contact')} accentClass="bg-gradient-to-r from-lime-500 to-lime-600" />
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="relative pt-32 pb-24 sm:pt-40 sm:pb-32 overflow-hidden bg-gradient-to-br from-stone-950 via-stone-900 to-emerald-950 text-white">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-10 left-1/3 w-[700px] h-[700px] bg-lime-400/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-emerald-500/10 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/15 mb-8">
                <Zap className="w-4 h-4 text-lime-300" />
                <span className="text-sm font-medium text-stone-200">Plan marketingu për {CLIENT}</span>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                20 minuta stërvitje.{' '}
                <span className="bg-gradient-to-r from-lime-300 to-emerald-300 bg-clip-text text-transparent">Më shumë klientë për {CLIENT}.</span>
              </h1>
            </FadeIn>
            <FadeIn delay={200}>
              <p className="mt-8 text-lg sm:text-xl text-stone-300 max-w-2xl leading-relaxed">
                Një plan marketingu për {STUDIO_COUNT} studiot tuaja: reklama që nxisin rezervimet, përmbajtje që tërheq vëmendjen dhe dukshmëri më e lartë në Google.{' '}
                <strong className="text-white">Nga 150.000 Lekë në muaj.</strong>
              </p>
            </FadeIn>
            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row gap-4">
                <button onClick={() => scrollTo('plani')} className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-stone-950 rounded-xl bg-gradient-to-r from-lime-400 to-lime-500 hover:shadow-xl hover:shadow-lime-500/30 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">Shiko planin<ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></button>
                <button onClick={() => scrollTo('paketat')} className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border border-white/20 hover:bg-white/10 transition-all flex items-center justify-center gap-2">Krahaso paketat</button>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-14 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl">
                {HERO_STATS.map((s, i) => (
                  <div key={i} className="rounded-xl bg-white/5 border border-white/10 p-4">
                    <div className="flex items-baseline gap-1.5"><span className="text-3xl font-extrabold text-lime-300">{s.n}</span><span className="text-sm font-semibold text-stone-200">{s.t}</span></div>
                    <div className="text-xs text-stone-400 mt-1">{s.l}</div>
                  </div>
                ))}
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ OBJEKTIVAT ═══ */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-14"><p className="text-sm font-semibold uppercase tracking-widest text-lime-600 mb-3">Objektivat</p><h2 className="text-3xl sm:text-4xl font-bold">Tre objektivat që do të udhëheqin punën tonë</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Kemi ndërtuar këtë plan rreth kërkesave tuaja: të tërhiqni klientë të rinj, të krijoni përmbajtje që mbahet mend dhe të gjendeni më lehtë në Google.</p></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-6">
            {GOALS.map((g, i) => (
              <FadeIn key={i} delay={i * 120}>
                <div className="rounded-2xl p-7 border border-stone-100 shadow-sm bg-gradient-to-b from-lime-50/60 to-white h-full">
                  <div className="w-12 h-12 rounded-xl bg-stone-950 flex items-center justify-center mb-5"><g.icon className="w-6 h-6 text-lime-300" /></div>
                  <h3 className="text-xl font-bold mb-2">{i + 1}. {g.title}</h3>
                  <p className="text-sm text-stone-600 leading-relaxed">{g.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ NGA INTERESI TE REZERVIMI ═══ */}
      <section className="py-24 bg-stone-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-lime-600 mb-3">Nga interesi te rezervimi</p><h2 className="text-3xl sm:text-4xl font-bold">Çfarë e ndihmon një person të zgjedhë {CLIENT}?</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Përvoja juaj në EMS është një pikë e fortë për komunikimin. Puna jonë është ta prezantojmë qartë këtë përvojë dhe ta bëjmë më të lehtë hapin nga shikimi i një videoje te rezervimi në studio.</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {STEPS.map((p, i) => (
              <FadeIn key={i} delay={i * 100}>
                <div className="bg-white rounded-2xl p-6 border border-stone-100 shadow-sm h-full">
                  <div className="w-11 h-11 rounded-xl bg-lime-50 flex items-center justify-center mb-5"><p.icon className="w-5 h-5 text-lime-600" /></div>
                  <h3 className="font-bold mb-2">{p.title}</h3>
                  <p className="text-sm text-stone-600 leading-relaxed">{p.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ DREJTIMI 1: REKLAMAT ═══ */}
      <section id="plani" className="py-24 bg-stone-950 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-lime-300 mb-3">Drejtimi 1 · Reklama në Instagram dhe Facebook</p><h2 className="text-3xl sm:text-4xl font-bold">Më shumë kërkesa për studiot tuaja</h2><p className="mt-4 text-stone-400 max-w-2xl mx-auto">Do të krijojmë dhe menaxhojmë fushata që nxisin kontaktet dhe rezervimet. Reklamat do të përshtaten për secilën studio dhe rezultatet do të ndiqen veçmas.</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {ADS.map((a, i) => (
              <FadeIn key={i} delay={(i % 3) * 100}>
                <div className="rounded-2xl bg-white/5 border border-white/10 p-6 h-full hover:bg-white/[0.08] transition-colors">
                  <div className="w-12 h-12 rounded-xl bg-lime-400/15 flex items-center justify-center mb-5"><a.icon className="w-6 h-6 text-lime-300" /></div>
                  <h3 className="font-bold mb-2">{a.title}</h3>
                  <p className="text-sm text-stone-400 leading-relaxed">{a.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
          <FadeIn delay={200}>
            <div className="mt-12 rounded-2xl border border-white/10 bg-gradient-to-r from-lime-400/10 via-white/5 to-emerald-500/10 p-6 sm:p-8">
              <p className="text-xs font-bold text-lime-300 uppercase tracking-wider mb-4 flex items-center gap-2"><MapPin className="w-4 h-4" />Reklama për të {STUDIO_COUNT} studiot</p>
              <div className="flex flex-wrap gap-2">
                {STUDIOS.flatMap(s => s.spots.map(spot => (
                  <span key={`${s.city}-${spot}`} className="px-3.5 py-1.5 rounded-full bg-white/10 border border-white/10 text-sm">
                    {spot === s.city ? <span className="font-semibold">{s.city}</span> : <><span className="text-stone-400">{s.city} — </span><span className="font-semibold">{spot}</span></>}
                  </span>
                )))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══ DREJTIMI 2: PËRMBAJTJA ═══ */}
      <section id="permbajtja" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-14"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Drejtimi 2 · Përmbajtja</p><h2 className="text-3xl sm:text-4xl font-bold">Ta njohin {CLIENT} dhe ta mbajnë mend</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Do të krijojmë përmbajtje që tregon shërbimin tuaj përmes njerëzve dhe përvojave reale. Ne do të kujdesemi për idetë, skenarët, xhirimet, montazhin dhe postimin. Me ekipin tuaj do të koordinojmë xhirimet dhe miratimin e materialeve.</p></div></FadeIn>
          <div className="grid lg:grid-cols-2 gap-10">
            <FadeIn>
              <div className="rounded-3xl border border-stone-100 shadow-sm p-8 h-full">
                <p className="flex items-center gap-2 text-xs font-bold text-emerald-600 uppercase tracking-wider mb-6"><LayoutGrid className="w-4 h-4" />{CONTENT_TOTAL} postime në muaj, të shoqëruara me Stories çdo javë</p>
                <div className="space-y-6">
                  {CONTENT_MIX.map((p, i) => (
                    <div key={i}>
                      <div className="flex items-baseline justify-between mb-1.5"><span className="font-semibold">{p.n} {p.label}</span></div>
                      <div className="h-2.5 rounded-full bg-stone-100 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-lime-400 to-emerald-500" style={{ width: `${(p.n / CONTENT_TOTAL) * 100}%` }} /></div>
                      <p className="text-sm text-stone-600 mt-2">{p.desc}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-7 pt-6 border-t border-stone-100 grid grid-cols-3 gap-3 text-center">
                  {[{ icon: Camera, l: 'Xhirime në studio' }, { icon: Clapperboard, l: 'Montazh' }, { icon: Video, l: 'Postim' }].map((x, i) => (
                    <div key={i} className="rounded-xl bg-stone-50 p-3"><x.icon className="w-5 h-5 text-emerald-600 mx-auto mb-1.5" /><div className="text-xs font-medium text-stone-700">{x.l}</div></div>
                  ))}
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={150}>
              <div className="rounded-3xl border border-stone-100 shadow-sm p-8 h-full">
                <p className="flex items-center gap-2 text-xs font-bold text-emerald-600 uppercase tracking-wider mb-5"><Clapperboard className="w-4 h-4" />Çfarë do të tregojmë?</p>
                <ol className="space-y-4">
                  {THEMES.map((t, i) => (
                    <li key={i} className="flex items-start gap-4">
                      <span className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                      <div><div className="font-semibold">{t.title}</div><div className="text-sm text-stone-600">{t.desc}</div></div>
                    </li>
                  ))}
                </ol>
                <p className="mt-6 pt-5 border-t border-stone-100 text-sm text-stone-600">Do të përfshijmë edhe humor, sfida dhe seri videosh, me synimin që përmbajtja të shihet, të komentohet dhe të ndahet më shumë.</p>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ DREJTIMI 3 + 4: SEO & GEO ═══ */}
      <section id="google" className="py-24 bg-stone-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-14"><p className="text-sm font-semibold uppercase tracking-widest text-lime-600 mb-3">Drejtimi 3 · SEO</p><h2 className="text-3xl sm:text-4xl font-bold">T'ju gjejnë më lehtë në Google</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Do të punojmë drejt faqes së parë të Google për kërkimet që kanë më shumë rëndësi për {CLIENT}. Website-i do t'i ndihmojë vizitorët të kuptojnë shërbimin, të zgjedhin studion dhe t'ju kontaktojnë.</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-5">
            {SEO.map((s, i) => (
              <FadeIn key={i} delay={i * 80}>
                <div className="bg-white rounded-2xl p-6 border border-stone-100 shadow-sm h-full">
                  <div className="w-11 h-11 rounded-xl bg-lime-50 flex items-center justify-center mb-4"><s.icon className="w-5 h-5 text-lime-600" /></div>
                  <h3 className="font-bold text-sm mb-2">{s.title}</h3>
                  <p className="text-xs text-stone-600 leading-relaxed">{s.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>

          <FadeIn><div className="text-center mt-24 mb-14"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Drejtimi 4 · GEO</p><h2 className="text-3xl sm:text-4xl font-bold">{CLIENT} në kërkimet me inteligjencë artificiale</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Do ta përgatisim përmbajtjen tuaj që të kuptohet më lehtë edhe nga platformat me inteligjencë artificiale. Synimi është të rrisim mundësinë që {CLIENT} të përmendet në përgjigjet që lidhen me EMS dhe shërbimet tuaja.</p></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-6">
            {GEO.map((g, i) => (
              <FadeIn key={i} delay={i * 100}>
                <div className="rounded-2xl p-6 bg-stone-950 text-white h-full">
                  <div className="w-11 h-11 rounded-xl bg-emerald-400/15 flex items-center justify-center mb-4"><g.icon className="w-5 h-5 text-emerald-300" /></div>
                  <h3 className="font-bold mb-2">{g.title}</h3>
                  <p className="text-sm text-stone-400 leading-relaxed">{g.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
          <FadeIn delay={200}><p className="mt-10 mx-auto max-w-2xl text-center text-stone-700 flex items-start sm:items-center justify-center gap-3"><Bot className="w-5 h-5 text-lime-600 flex-shrink-0" /><span>Për një pyetje si <strong>"Ku mund të bëj EMS në Tiranë?"</strong>, synimi ynë është që {CLIENT} të jetë ndër alternativat që përmenden.</span></p></FadeIn>
        </div>
      </section>

      {/* ═══ PAKETAT ═══ */}
      <section id="paketat" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-14"><p className="text-sm font-semibold uppercase tracking-widest text-lime-600 mb-3">Paketat dhe çmimet</p><h2 className="text-3xl sm:text-4xl font-bold">Zgjidhni paketën që i përshtatet objektivave tuaja</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Të dyja paketat përfshijnë reklamat, 16 postime në muaj, SEO dhe GEO.</p><p className="mt-3 text-stone-600 max-w-2xl mx-auto">Rekomandojmë paketën <strong>Business</strong> nëse dëshironi edhe menaxhimin e reputacionit online dhe artikuj në media. Diferenca është <strong>40.000 Lekë në muaj</strong>.</p></div></FadeIn>
          <div className="grid lg:grid-cols-2 gap-8 max-w-md lg:max-w-4xl mx-auto">
            {PACKAGES.map((p, i) => {
              const featured = !!p.badge;
              const saving = STANDALONE_VALUE[p.id] - p.price;
              return (
                <FadeIn key={p.id} delay={i * 150}>
                  <div className={`relative rounded-3xl bg-white overflow-hidden h-full flex flex-col ${featured ? 'border-2 border-lime-400 shadow-2xl shadow-lime-500/10' : 'border border-stone-200 shadow-sm'}`}>
                    {featured && <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-lime-400 to-emerald-500" />}
                    {p.badge && <div className="absolute top-5 right-5"><span className="text-[10px] font-extrabold uppercase tracking-wider px-3 py-1 rounded-full text-stone-950 bg-gradient-to-r from-lime-400 to-emerald-400">{p.badge}</span></div>}
                    <div className="p-8 flex-1 flex flex-col">
                      <h3 className="text-2xl font-bold">{p.name}</h3>
                      <p className="text-sm text-stone-500 mt-2 min-h-[60px]">{p.tagline}</p>
                      <div className="mt-6 flex items-baseline gap-2">
                        <span className={`text-4xl xl:text-5xl font-extrabold ${featured ? 'text-lime-600' : 'text-stone-900'}`}>{money(p.price)}</span>
                        <span className="text-sm text-stone-500">Lekë / muaj</span>
                      </div>
                      <p className="mt-2 text-xs text-stone-500">Vlera e shërbimeve të marra veçmas: {money(STANDALONE_VALUE[p.id])} Lekë.<br />Kursimi me paketën: {money(saving)} Lekë në muaj.</p>
                      <p className="mt-6 text-sm font-semibold">Përfshin:</p>
                      <ul className="mt-3 space-y-3 flex-1">
                        {p.items.map((it, j) => (<li key={j} className="flex items-start gap-2.5 text-sm text-stone-700"><CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${featured ? 'text-lime-500' : 'text-emerald-500'}`} />{it}</li>))}
                      </ul>
                      <button onClick={() => choose(p.id)} className={`mt-8 w-full py-4 rounded-xl text-base font-bold transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 ${featured ? 'text-stone-950 bg-gradient-to-r from-lime-400 to-lime-500 hover:shadow-lg hover:shadow-lime-500/30' : 'text-stone-900 border-2 border-stone-200 hover:border-lime-300 hover:bg-lime-50'}`}>Zgjidh {p.name}<ArrowRight className="w-5 h-5" /></button>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>
          <p className="mt-8 text-center text-xs text-stone-400">Buxheti i reklamave paguhet veçmas. Çmimet janë pa TVSH. Bashkëpunimi fillestar është 3-mujor.</p>

          {/* Vetëm në paketën Business */}
          <FadeIn><div className="text-center mt-24 mb-12"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Vetëm në paketën Business</p><h2 className="text-3xl sm:text-4xl font-bold">Kujdes për reputacionin e {CLIENT}</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Vlerësimet dhe informacioni online ndikojnë në përshtypjen që krijon një klient i ri. Me paketën Business, do të kujdesemi për mënyrën si paraqitet {CLIENT} dhe si u përgjigjet komenteve të publikut.</p></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-6">
            {BUSINESS_EXTRAS.map((x, i) => (
              <FadeIn key={i} delay={i * 120}>
                <div className="rounded-2xl p-7 border border-emerald-100 bg-gradient-to-b from-emerald-50/70 to-white h-full">
                  <div className="w-12 h-12 rounded-xl bg-white shadow-sm flex items-center justify-center mb-5"><x.icon className="w-6 h-6 text-emerald-600" /></div>
                  <h3 className="text-lg font-bold mb-2">{x.title}</h3>
                  <p className="text-sm text-stone-600 leading-relaxed">{x.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SI DO TË PUNOJMË ═══ */}
      <section className="py-24 bg-stone-950 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-lime-300 mb-3">Si do të punojmë</p><h2 className="text-3xl sm:text-4xl font-bold">Tre muajt e parë</h2><p className="mt-4 text-stone-400 max-w-2xl mx-auto">Përpara nisjes do të përcaktojmë së bashku buxhetin e reklamave, ofertën hyrëse dhe përparësitë për secilën studio.</p></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-6 relative">
            <div className="hidden md:block absolute top-6 left-[16%] right-[16%] h-px bg-gradient-to-r from-lime-400/50 via-emerald-400/50 to-lime-400/50" />
            {TIMELINE.map((s, i) => (
              <FadeIn key={i} delay={i * 150}>
                <div className="relative text-center">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-lime-400 to-emerald-500 flex items-center justify-center mx-auto mb-4 text-stone-950 relative z-10 font-bold">{i + 1}</div>
                  <div className="text-xs font-bold text-lime-300 uppercase tracking-wider">{s.month}</div>
                  <h3 className="text-lg font-bold mt-1 mb-2">{s.title}</h3>
                  <p className="text-sm text-stone-400 leading-relaxed max-w-xs mx-auto">{s.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
          <FadeIn delay={200}>
            <div className="mt-16 rounded-3xl border border-white/10 bg-white/5 p-8">
              <p className="flex items-center gap-2 text-xs font-bold text-lime-300 uppercase tracking-wider mb-6"><BarChart3 className="w-4 h-4" />Çdo muaj do të merrni një raport me:</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {REPORT.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-xl bg-white/5 p-4"><r.icon className="w-5 h-5 text-lime-300 flex-shrink-0 mt-0.5" /><span className="text-sm text-stone-200">{r.label}</span></div>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      <ClientLogos accentClass="text-lime-600" kicker="Klientët tanë" title="Biznese dhe institucione që na kanë besuar" sub="Kemi bashkëpunuar me kompani dhe institucione në prodhim, tregti, shëndetësi, turizëm dhe shërbime." />

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="py-24 bg-stone-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-lime-600 mb-3">Pyetje dhe përgjigje</p><h2 className="text-3xl sm:text-4xl font-bold">Pyetjet më të shpeshta</h2></div></FadeIn>
          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <FadeIn key={i} delay={i * 80}><div className="bg-white rounded-xl border border-stone-100 overflow-hidden"><button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-stone-50 transition-colors"><span className="font-semibold pr-4">{item.q}</span><ChevronDown className={`w-5 h-5 text-stone-400 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} /></button><div className={`transition-all duration-300 overflow-hidden ${openFaq === i ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0'}`}><p className="px-6 pb-5 text-stone-600 leading-relaxed">{item.a}</p></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ KONTAKT ═══ */}
      <section id="contact" className="py-24 bg-gradient-to-br from-stone-950 via-stone-900 to-emerald-950 text-white relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none"><div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-lime-400/10 rounded-full blur-3xl" /></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-lime-300 mb-4">Le të planifikojmë nisjen</p>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">Hapi i radhës për <span className="text-lime-300">marketingun e {CLIENT}</span></h2>
                <p className="mt-5 text-stone-300 leading-relaxed text-lg">Zgjidhni paketën dhe lini të dhënat tuaja. Do t'ju kontaktojmë brenda 24 orëve për të caktuar një takim dhe për të diskutuar nisjen.</p>
                <div className="mt-8 space-y-4">
                  {[`Reklama për ${STUDIO_COUNT} studiot.`, '16 postime në muaj dhe Stories çdo javë.', 'SEO dhe GEO për dukshmëri më të lartë.', 'Raport mujor me rezultatet dhe hapat e ardhshëm.'].map((t, i) => (
                    <div key={i} className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-lime-300" /><span className="text-stone-300">{t}</span></div>
                  ))}
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              {formSent ? (
                <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-10 border border-white/10 text-center"><div className="w-20 h-20 rounded-full bg-lime-400/20 flex items-center justify-center mx-auto mb-6"><CheckCircle2 className="w-10 h-10 text-lime-300" /></div><h3 className="text-2xl font-bold mb-3">Faleminderit!</h3><p className="text-stone-300">Kërkesa juaj u dërgua. Do t'ju kontaktojmë brenda 24 orëve.</p></div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">Kërkoni një takim</h3>
                  <div>
                    <p className="text-sm font-medium text-stone-300 mb-2">Paketa që ju intereson</p>
                    <div className="grid grid-cols-2 gap-2">
                      {PACKAGES.map(p => (
                        <button type="button" key={p.id} onClick={() => setPkgId(p.id)} className={`text-left px-4 py-3 rounded-xl border transition-colors ${pkgId === p.id ? 'bg-lime-400/20 border-lime-400' : 'bg-white/5 border-white/15 hover:border-white/30'}`}>
                          <p className="font-semibold text-sm">{p.name}</p>
                          <p className="text-xs text-stone-400">{money(p.price)} Lekë / muaj</p>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-stone-300 mb-1.5">Emri dhe mbiemri *</label><input type="text" required value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className={inputCls} placeholder="Shkruani emrin dhe mbiemrin tuaj." /></div>
                    <div><label className="block text-sm font-medium text-stone-300 mb-1.5">Pozicioni ose studioja</label><input type="text" value={formData.company} onChange={e => setFormData(p => ({ ...p, company: e.target.value }))} className={inputCls} placeholder="P.sh. drejtues, përgjegjës studioje." /></div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-stone-300 mb-1.5">Email *</label><input type="email" required value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} className={inputCls} placeholder="Shkruani adresën tuaj të email-it." /></div>
                    <div><label className="block text-sm font-medium text-stone-300 mb-1.5">Telefon *</label><input type="tel" required value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} className={inputCls} placeholder="Shkruani numrin ku mund t'ju kontaktojmë." /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-stone-300 mb-1.5">Mesazh — opsional</label><textarea rows={3} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} className={`${inputCls} resize-none`} placeholder="Na tregoni përparësitë tuaja ose pyetjet që dëshironi të diskutojmë." /></div>
                  {formError && (<div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">{formError}</div>)}
                  <button type="submit" disabled={submitting} className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-lime-400 to-lime-500 hover:from-lime-300 hover:to-lime-400 text-stone-950 shadow-lg shadow-lime-500/25 transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60">{submitting ? 'Duke dërguar...' : 'Dërgo kërkesën për takim'}{!submitting && <ArrowUpRight className="w-5 h-5" />}</button>
                  <p className="text-xs text-stone-400 text-center flex items-center justify-center gap-1.5"><Phone className="w-3.5 h-3.5" />Takimi është falas dhe pa detyrim për bashkëpunim.</p>
                </form>
              )}
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="py-10 bg-black text-stone-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2"><div className="w-6 h-6 rounded bg-gradient-to-br from-lime-400 to-stone-800 flex items-center justify-center"><Zap className="w-3 h-3 text-white" /></div><span className="font-semibold text-white text-sm">Fivo × {CLIENT}</span></div>
          <p className="text-sm">&copy; {new Date().getFullYear()} FivoCRM. Të gjitha të drejtat e rezervuara.</p>
          <div className="flex items-center gap-6 text-sm"><Link to="/login" className="hover:text-white transition-colors">Hyrje</Link><a href="#paketat" className="hover:text-white transition-colors">Paketat</a><a href="#contact" className="hover:text-white transition-colors">Kontakt</a></div>
        </div>
      </footer>
    </div>
  );
}
