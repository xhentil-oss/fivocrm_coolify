import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Zap, CheckCircle2, ArrowRight, ChevronDown, Phone, ArrowUpRight, Search, Bot,
  Clapperboard, LayoutGrid, Camera, BarChart3, Target, Repeat, MapPin, Users, ShieldCheck,
  Newspaper, Star, AlertCircle, CalendarCheck, Video, FileText, Gauge, MessageCircle, Globe,
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
   Tre objektiva: më shumë kërkesa nga klientë të rinj, përmbajtje që
   tërheq vëmendjen, prani më e fortë në Google (SEO + GEO).
   Dy nivele: Premium 150.000, Business 190.000 (+ mbrojtje imazhi,
   heqje vlerësimesh negative nga Google Maps, artikuj në portale).
   ═══════════════════════════════════════════════ */
const CLIENT = 'Body Code';

// Studiot e Body Code — reklamat dhe profilet në Google Maps ndërtohen për secilën.
const STUDIOS = [
  { city: 'Tiranë', spots: ['Barrikada', 'Dinamo', 'Brryli', 'Zogu i Zi', 'Astir'] },
  { city: 'Durrës', spots: ['Durrës'] },
  { city: 'Shkodër', spots: ['Shkodër'] },
];
const STUDIO_COUNT = STUDIOS.reduce((n, s) => n + s.spots.length, 0);

// Tre objektivat që dolën nga kërkesat e klientit.
const GOALS = [
  { icon: Users, title: 'Më shumë kërkesa nga klientë të rinj', desc: 'Reklama në Instagram dhe Facebook që i nxisin njerëzit pranë studiove tuaja t\'ju kontaktojnë dhe të rezervojnë seancën e parë.' },
  { icon: Clapperboard, title: 'Përmbajtje që tërheq vëmendjen', desc: '16 postime në muaj me njerëz të vërtetë: klientët, trajnerët dhe përvoja në studio. Shihet, ndahet dhe mbahet mend.' },
  { icon: Search, title: 'Prani më e fortë në Google', desc: 'Faqja e parë për kërkimet që sjellin klientë, profile të forta në Google Maps për çdo studio dhe dukshmëri në kërkimet me inteligjencë artificiale.' },
];

// Pse interesi nuk kthehet në abonime — dhimbja që hap bisedën.
const PAINS = [
  { title: 'Shikime pa rezervime', desc: 'Videot shihen, por askush nuk shkruan. Pa një ofertë hyrëse dhe një formular të thjeshtë, interesi mbetet te pëlqimi.' },
  { title: 'Shtatë studio, një reklamë', desc: 'Një reklamë e vetme për gjithë Tiranën, Durrësin dhe Shkodrën paguan për njerëz që nuk vijnë dot. Çdo studio ka nevojë për audiencën e vet.' },
  { title: '"EMS" nuk e di kush është', desc: 'Shumica ende pyesin a dhemb, a funksionon dhe pse 20 minuta mjaftojnë. Pa përgjigje të qarta, dyshimi fiton.' },
  { title: 'Google nuk ju gjen', desc: 'Kush kërkon "stërvitje EMS Tiranë" ose "palestër pranë meje" duhet të gjejë Body Code të parin, jo konkurrentin.' },
];

// Drejtimi 1 — reklamat në Meta.
const ADS = [
  { icon: MapPin, title: 'Audienca pranë çdo studioje', desc: 'Reklama të veçanta për rrethin e secilës studio, që njerëzit të shohin studion ku mund të shkojnë vërtet.' },
  { icon: Video, title: 'Video që prezantojnë shërbimin', desc: 'Trajnerët, seanca dhe përvojat e klientëve, që personi ta kuptojë EMS para se të pyesë.' },
  { icon: Target, title: 'Ofertë e qartë për rezervimin e parë', desc: 'Një ofertë hyrëse e thjeshtë, e vendosur bashkë me ju, që e bën hapin e parë të lehtë.' },
  { icon: Repeat, title: 'Reklama rikujtuese', desc: 'Për ata që panë videon, vizituan profilin ose hapën formularin, por nuk rezervuan ende.' },
  { icon: FileText, title: 'Formularë të thjeshtë', desc: 'Të interesuarit lënë kontaktin brenda Facebook-ut ose Instagramit, pa dalë nga aplikacioni.' },
  { icon: BarChart3, title: 'Kosto për kërkesë, çdo javë', desc: 'Ndjekim numrin e kërkesave dhe koston e tyre; me stafin tuaj matim sa kthehen në rezervime dhe abonime.' },
];

// Drejtimi 2 — përmbajtja: 16 postime në muaj.
const CONTENT_MIX = [
  { n: 10, label: 'Reels', desc: 'video të shkurtra me hyrje që kap vëmendjen në sekondat e para dhe një mesazh të qartë' },
  { n: 4, label: 'Karusele', desc: 'shpjegime hap pas hapi, pyetje dhe përgjigje, prezantim studiosh' },
  { n: 2, label: 'Postime fotografike', desc: 'ekipi, ambientet dhe momentet e studios' },
];
const CONTENT_TOTAL = CONTENT_MIX.reduce((sum, p) => sum + p.n, 0);
const THEMES = [
  { title: 'Histori klientësh', desc: 'pse e nisën, çfarë i motivon dhe si po ecën përvoja e tyre' },
  { title: 'Seanca në praktikë', desc: 'çfarë ndodh gjatë stërvitjes dhe si ndihmon trajneri' },
  { title: 'Video të përditshmërisë', desc: 'mungesa e kohës, puna dhe gjetja e një rutine' },
  { title: 'Pyetje dhe përgjigje', desc: 'shpjegime të thjeshta për EMS: a dhemb, për kë është, sa shpejt duken rezultatet' },
  { title: 'Ekipi dhe studiot', desc: 'prezantimi i trajnerëve, ambienteve dhe kujdesit ndaj klientit' },
];

// Drejtimi 3 — SEO, dhe drejtimi 4 — GEO.
const SEO = [
  { icon: Search, title: 'Fjalët që kërkojnë klientët', desc: 'Identifikojmë kërkimet me vlerë: "EMS Tiranë", "stërvitje 20 minuta", "humbje peshe Durrës", "palestër Shkodër".' },
  { icon: FileText, title: 'Tekstet dhe organizimi i website-it', desc: 'Faqe për çdo shërbim dhe çdo studio, që vizitori ta kuptojë shërbimin, të zgjedhë studion dhe t\'ju kontaktojë.' },
  { icon: Gauge, title: 'Shpejtësia dhe telefoni', desc: 'Kontroll i shpejtësisë dhe i përdorimit nga telefoni, nga ku vjen shumica e vizitave.' },
  { icon: Newspaper, title: 'Artikuj për pyetjet e klientëve', desc: 'Përmbajtje që u përgjigjet pyetjeve reale dhe e sjell Body Code në faqen e parë.' },
  { icon: MapPin, title: `Google Maps për ${STUDIO_COUNT} studiot`, desc: 'Profil i plotë për secilën studio: foto, orare, shërbime, vlerësime dhe përgjigje për çdo vlerësim.' },
];
const GEO = [
  { icon: MessageCircle, title: 'Përgjigje të qarta për EMS', desc: 'Pyetjet që njerëzit u bëjnë ChatGPT-së, Gemini-t dhe Google AI, të përgjigjura me emrin e Body Code.' },
  { icon: Globe, title: 'Informacion i saktë dhe i strukturuar', desc: 'Shërbimet, ekipi dhe studiot, të organizuara ashtu si i lexojnë sistemet e inteligjencës artificiale.' },
  { icon: Star, title: 'Përmbajtje e besueshme', desc: 'Burime të organizuara mirë, që e bëjnë Body Code emrin që përmendet kur dikush pyet për EMS në Shqipëri.' },
];

// Ekstrat e paketës Business.
const BUSINESS_EXTRAS = [
  { icon: ShieldCheck, title: 'Mbrojtje imazhi', desc: 'Monitorim i përditshëm i asaj që thuhet për Body Code në Google, rrjete sociale dhe portale. Reagim i shpejtë dhe i matur te çdo koment, ankesë apo krizë e vogël, para se të bëhet e madhe.' },
  { icon: Star, title: 'Heqja e vlerësimeve negative nga Google Maps', desc: 'Raportojmë vlerësimet e rreme, të padrejta ose që shkelin rregullat e Google, e ndjekim rastin deri në heqje dhe përgjigjemi profesionalisht te secili vlerësim që mbetet. Mesatarja e yjeve për çdo studio rritet muaj pas muaji.' },
  { icon: Newspaper, title: 'Publikim artikujsh në portale shqiptare dhe të huaja', desc: 'Artikuj për EMS, për ekipin dhe për historitë e klientëve, të publikuar në media shqiptare dhe ndërkombëtare. Ndërtojnë besim, forcojnë SEO-n dhe e bëjnë emrin të njohur përtej rrjeteve sociale.' },
];

interface Pkg { id: string; name: string; price: number; tagline: string; badge?: string; items: string[] }
const PACKAGES: Pkg[] = [
  {
    id: 'premium', name: 'Premium', price: 150000,
    tagline: 'Plani i plotë: reklama, 16 postime në muaj, SEO dhe GEO.',
    items: [
      `Reklama Meta për ${STUDIO_COUNT} studiot: audienca lokale, video, ofertë hyrëse, rikujtim`,
      'Formularë kontakti brenda Facebook-ut dhe Instagramit',
      '16 postime në muaj: 10 Reels, 4 karusele, 2 foto',
      'Stories gjatë javës',
      'Ide, skenarë, xhirim, montazh dhe postim',
      'SEO: fjalë kyçe, tekste, faqe për shërbime dhe studio, artikuj',
      `Google Maps për ${STUDIO_COUNT} studiot`,
      'GEO: prania në kërkimet me inteligjencë artificiale',
      'Raport mujor: kërkesa, kosto për kërkesë, rezervime, Google',
    ],
  },
  {
    id: 'business', name: 'Business', price: 190000, badge: 'Rekomandohet',
    tagline: 'Gjithçka te Premium, plus mbrojtja e emrit Body Code.',
    items: [
      'Gjithçka te Premium',
      'Mbrojtje imazhi: monitorim dhe reagim i përditshëm',
      'Heqja e vlerësimeve negative nga Google Maps',
      'Përgjigje profesionale te çdo vlerësim, për çdo studio',
      'Publikim artikujsh në portale shqiptare',
      'Publikim artikujsh në portale të huaja',
      'Takim strategjie çdo muaj me drejtuesit',
    ],
  },
];
// Vlera e shërbimeve nëse merren veçmas (Lekë / muaj).
const STANDALONE_VALUE: Record<string, number> = { premium: 195000, business: 260000 };

const TIMELINE = [
  { month: 'Muaji i parë', title: 'Themelet', desc: 'Përcaktojmë studiot prioritare, audiencat dhe ofertën hyrëse. Përgatisim përmbajtjen, nisim reklamat dhe ndërhyrjet kryesore në website.' },
  { month: 'Muaji i dytë', title: 'Përmirësimi', desc: 'Përmirësojmë reklamat sipas rezultateve. Zhvillojmë formatet më të ndjekura dhe vazhdojmë punën për SEO dhe GEO.' },
  { month: 'Muaji i tretë', title: 'Zgjerimi', desc: 'Zgjerojmë fushatat që sjellin kërkesa cilësore dhe planifikojmë hapat e ardhshëm sipas rezervimeve dhe kapacitetit të studiove.' },
];

const REPORT = [
  { icon: Users, label: 'Kërkesat e reja dhe kosto për kërkesë' },
  { icon: CalendarCheck, label: 'Rezervimet dhe abonimet e konfirmuara nga stafi juaj' },
  { icon: Clapperboard, label: 'Shikueshmëria, shpërndarjet dhe reagimet ndaj përmbajtjes' },
  { icon: Search, label: 'Vizitat në website dhe ecuria në Google' },
];

const FAQ = [
  { q: 'A përfshihet buxheti i reklamave në çmim?', a: 'Jo. Çmimi mbulon strategjinë, menaxhimin, përmbajtjen dhe SEO-n. Buxheti i reklamave paguhet drejtpërdrejt te Meta nga llogaria juaj dhe përcaktohet së bashku para nisjes, sipas studiove ku do të përqendrohemi.' },
  { q: 'Kur vijnë kërkesat e para?', a: 'Reklamat nisin brenda muajit të parë, pasi të jenë gati videot dhe oferta hyrëse. Kërkesat e para vijnë zakonisht që në javën e parë të reklamave; kostoja për kërkesë ulet gjatë muajit të dytë, kur reklamat rikujtuese kanë mbledhur audiencë.' },
  { q: 'Kush u përgjigjet kërkesave?', a: 'Kërkesat mbërrijnë në kohë reale te stafi juaj, me emrin, studion dhe reklamën nga erdhën. Rezervimin e bën stafi; ne ju japim mesazhet e gatshme dhe matim së bashku sa kërkesa kthehen në rezervime dhe abonime.' },
  { q: 'Si hiqen vlerësimet negative nga Google Maps?', a: 'Google heq vetëm vlerësimet që shkelin rregullat e tij: të rreme, nga persona që nuk kanë qenë klientë, fyese ose nga konkurrenca. Ne i identifikojmë, i raportojmë me argumente dhe e ndjekim rastin deri në fund. Vlerësimeve të vërteta u përgjigjemi profesionalisht, që lexuesi i radhës të shohë kujdesin tuaj. Të dyja bashkë e rrisin mesataren e yjeve.' },
  { q: 'Çfarë është GEO?', a: 'Gjithnjë e më shumë njerëz pyesin ChatGPT, Gemini ose Google AI: "ku të bëj EMS në Tiranë?". GEO është puna që Body Code të përmendet në këto përgjigje: informacion i saktë dhe i strukturuar për shërbimet, ekipin dhe studiot, dhe përmbajtje që këto sisteme e konsiderojnë të besueshme.' },
  { q: 'Në cilat portale publikohen artikujt?', a: 'Në paketën Business: portale shqiptare lajmesh dhe lifestyle, si dhe media të huaja që pranojnë artikuj për shëndetin dhe fitnesin. Listën e saktë e miratojmë bashkë çdo muaj, sipas temës së artikullit.' },
  { q: 'A xhirohet në të gjitha studiot?', a: 'Po, me radhë. Çdo muaj planifikojmë ditët e xhirimit sipas studiove prioritare, që çdo studio të ketë videot dhe fotot e veta brenda tremujorit të parë.' },
  { q: 'Sa zgjat kontrata?', a: 'Plani është ndërtuar për 3 muaj, sepse reklamave dhe Google-it u duhet kohë të japin rezultat të qëndrueshëm. Pagesa bëhet në fillim të çdo muaji, me faturë.' },
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
            <button onClick={() => scrollTo('contact')} className="px-5 py-2.5 text-sm font-semibold text-stone-950 rounded-full bg-gradient-to-r from-lime-400 to-lime-500 hover:shadow-lg hover:shadow-lime-500/30 transition-all hover:-translate-y-0.5">Nisim bashkëpunimin</button>
            <LandingMobileMenu links={NAV} ctaLabel="Nisim bashkëpunimin" onCta={() => scrollTo('contact')} accentClass="bg-gradient-to-r from-lime-500 to-lime-600" />
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
                <span className="text-sm font-medium text-stone-200">Ofertë e personalizuar për {CLIENT}</span>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                20 minuta EMS.{' '}
                <span className="bg-gradient-to-r from-lime-300 to-emerald-300 bg-clip-text text-transparent">Një kalendar plot rezervime.</span>
              </h1>
            </FadeIn>
            <FadeIn delay={200}>
              <p className="mt-8 text-lg sm:text-xl text-stone-300 max-w-2xl leading-relaxed">
                Një plan me tre objektiva për {STUDIO_COUNT} studiot e {CLIENT}: më shumë kërkesa nga klientë të rinj, përmbajtje që tërheq vëmendjen dhe prani më e fortë në Google —{' '}
                <strong className="text-white">duke nisur nga 150.000 Lekë në muaj.</strong>
              </p>
            </FadeIn>
            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row gap-4">
                <button onClick={() => scrollTo('plani')} className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-stone-950 rounded-xl bg-gradient-to-r from-lime-400 to-lime-500 hover:shadow-xl hover:shadow-lime-500/30 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">Shiko planin<ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></button>
                <button onClick={() => scrollTo('paketat')} className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border border-white/20 hover:bg-white/10 transition-all flex items-center justify-center gap-2">Shiko paketat</button>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-14 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl">
                {[{ n: String(STUDIO_COUNT), l: 'studio me reklamat e veta' }, { n: '16', l: 'postime në muaj' }, { n: '4', l: 'drejtime: Ads, përmbajtje, SEO, GEO' }, { n: '1', l: 'raport i qartë çdo muaj' }].map((s, i) => (
                  <div key={i} className="rounded-xl bg-white/5 border border-white/10 p-4">
                    <div className="text-3xl font-extrabold text-lime-300">{s.n}</div>
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
          <FadeIn><div className="text-center mb-14"><p className="text-sm font-semibold uppercase tracking-widest text-lime-600 mb-3">Bazuar në kërkesat tuaja</p><h2 className="text-3xl sm:text-4xl font-bold">Tre objektiva, një plan</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Nga biseda me ekipin e {CLIENT} dolën tre gjëra që duhen bërë. Gjithçka më poshtë u shërben këtyre tre objektivave.</p></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-6">
            {GOALS.map((g, i) => (
              <FadeIn key={i} delay={i * 120}>
                <div className="rounded-2xl p-7 border border-stone-100 shadow-sm bg-gradient-to-b from-lime-50/60 to-white h-full">
                  <div className="w-12 h-12 rounded-xl bg-stone-950 flex items-center justify-center mb-5"><g.icon className="w-6 h-6 text-lime-300" /></div>
                  <div className="text-xs font-bold text-lime-600 uppercase tracking-wider mb-2">Objektivi {i + 1}</div>
                  <h3 className="text-xl font-bold mb-2">{g.title}</h3>
                  <p className="text-sm text-stone-600 leading-relaxed">{g.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PROBLEMI ═══ */}
      <section className="py-24 bg-stone-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-lime-600 mb-3">Ku humbet interesi</p><h2 className="text-3xl sm:text-4xl font-bold">Njerëzit e shohin EMS. Pse nuk rezervojnë?</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Shërbimi juaj ka 11 vjet rezultate dhe mijëra klientë të kënaqur. Problemi nuk është produkti, është rruga nga telefoni te studioja më e afërt.</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {PAINS.map((p, i) => (
              <FadeIn key={i} delay={i * 100}>
                <div className="bg-white rounded-2xl p-6 border border-stone-100 shadow-sm h-full">
                  <div className="w-11 h-11 rounded-xl bg-lime-50 flex items-center justify-center mb-5"><AlertCircle className="w-5 h-5 text-lime-600" /></div>
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
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-lime-300 mb-3">Drejtimi 1</p><h2 className="text-3xl sm:text-4xl font-bold">Më shumë kërkesa nga Instagrami dhe Facebook-u</h2><p className="mt-4 text-stone-400 max-w-2xl mx-auto">Krijojmë dhe menaxhojmë reklama që i nxisin njerëzit t'ju kontaktojnë dhe të rezervojnë një seancë. Çdo studio merr audiencën dhe matjen e vet.</p></div></FadeIn>
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
              <p className="text-xs font-bold text-lime-300 uppercase tracking-wider mb-4 flex items-center gap-2"><MapPin className="w-4 h-4" />{STUDIO_COUNT} studio, {STUDIO_COUNT} audienca</p>
              <div className="flex flex-wrap gap-2">
                {STUDIOS.flatMap(s => s.spots.map(spot => (
                  <span key={`${s.city}-${spot}`} className="px-3.5 py-1.5 rounded-full bg-white/10 border border-white/10 text-sm">
                    <span className="text-stone-400">{s.city} · </span><span className="font-semibold">{spot}</span>
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
          <FadeIn><div className="text-center mb-14"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Drejtimi 2</p><h2 className="text-3xl sm:text-4xl font-bold">Përmbajtje që shihet, ndahet dhe mbahet mend</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Në qendër do të jenë njerëzit, përvoja në studio dhe avantazhet e shërbimit tuaj. Ne kujdesemi për idetë, skenarët, xhirimet, montazhin dhe postimin; ju vetëm i miratoni.</p></div></FadeIn>
          <div className="grid lg:grid-cols-2 gap-10">
            <FadeIn>
              <div className="rounded-3xl border border-stone-100 shadow-sm p-8 h-full">
                <p className="flex items-center gap-2 text-xs font-bold text-emerald-600 uppercase tracking-wider mb-2"><LayoutGrid className="w-4 h-4" />{CONTENT_TOTAL} postime në muaj</p>
                <p className="text-sm text-stone-500 mb-6">Plus Stories gjatë javës, që profili të jetë gjallë çdo ditë.</p>
                <div className="space-y-5">
                  {CONTENT_MIX.map((p, i) => (
                    <div key={i}>
                      <div className="flex items-baseline justify-between mb-1.5"><span className="font-semibold">{p.label}</span><span className="text-sm text-stone-500">{p.n} në muaj</span></div>
                      <div className="h-2.5 rounded-full bg-stone-100 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-lime-400 to-emerald-500" style={{ width: `${(p.n / CONTENT_TOTAL) * 100}%` }} /></div>
                      <p className="text-xs text-stone-500 mt-1.5">{p.desc}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-7 pt-6 border-t border-stone-100 grid grid-cols-3 gap-3 text-center">
                  {[{ icon: Camera, l: 'Xhirim në studio' }, { icon: Clapperboard, l: 'Montazh' }, { icon: Video, l: 'Hyrje që kap vëmendjen' }].map((x, i) => (
                    <div key={i} className="rounded-xl bg-stone-50 p-3"><x.icon className="w-5 h-5 text-emerald-600 mx-auto mb-1.5" /><div className="text-xs font-medium text-stone-700">{x.l}</div></div>
                  ))}
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={150}>
              <div className="rounded-3xl border border-stone-100 shadow-sm p-8 h-full">
                <p className="flex items-center gap-2 text-xs font-bold text-emerald-600 uppercase tracking-wider mb-5"><Clapperboard className="w-4 h-4" />Temat kryesore</p>
                <ol className="space-y-4">
                  {THEMES.map((t, i) => (
                    <li key={i} className="flex items-start gap-4">
                      <span className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                      <div><div className="font-semibold">{t.title}</div><div className="text-sm text-stone-600">{t.desc}</div></div>
                    </li>
                  ))}
                </ol>
                <p className="mt-6 pt-5 border-t border-stone-100 text-sm text-stone-600">Testojmë edhe formate me humor, sfida dhe seri videosh, për të nxitur shikueshmërinë dhe shpërndarjet.</p>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ DREJTIMI 3 + 4: SEO & GEO ═══ */}
      <section id="google" className="py-24 bg-stone-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-14"><p className="text-sm font-semibold uppercase tracking-widest text-lime-600 mb-3">Drejtimi 3</p><h2 className="text-3xl sm:text-4xl font-bold">Pozicionimi në Google (SEO)</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Synimi është faqja e parë e Google për kërkimet më të rëndësishme për biznesin tuaj, dhe një website që e udhëzon vizitorin qartë: të kuptojë shërbimin, të zgjedhë studion dhe t'ju kontaktojë.</p></div></FadeIn>
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

          <FadeIn><div className="text-center mt-24 mb-14"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Drejtimi 4</p><h2 className="text-3xl sm:text-4xl font-bold">Prania në kërkimet me inteligjencë artificiale (GEO)</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Gjithnjë e më shumë njerëz pyesin një asistent AI para se të kërkojnë në Google. Punojmë që {CLIENT} të zbulohet dhe të përmendet në këto përgjigje.</p></div></FadeIn>
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
          <FadeIn delay={200}><div className="mt-10 mx-auto w-fit flex items-center gap-3 px-6 py-3 rounded-full bg-stone-950 text-lime-300 font-semibold"><Bot className="w-5 h-5" />"Ku të bëj EMS në Tiranë?" — përgjigjja: {CLIENT}</div></FadeIn>
        </div>
      </section>

      {/* ═══ PAKETAT ═══ */}
      <section id="paketat" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-14"><p className="text-sm font-semibold uppercase tracking-widest text-lime-600 mb-3">Paketat & çmimet</p><h2 className="text-3xl sm:text-4xl font-bold">Dy opsione, të ndërtuara për {CLIENT}</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Të dyja përfshijnë planin e plotë: reklamat, 16 postimet, SEO dhe GEO. Rekomandojmë <strong>Business</strong>: me +40.000 Lekë në muaj mbrohet emri {CLIENT} në Google Maps dhe në media, aty ku një klient i ri vendos a t'ju besojë.</p></div></FadeIn>
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
                      <p className="text-sm text-stone-500 mt-2 min-h-[40px]">{p.tagline}</p>
                      <div className="mt-6 flex items-baseline gap-2">
                        <span className={`text-4xl xl:text-5xl font-extrabold ${featured ? 'text-lime-600' : 'text-stone-900'}`}>{money(p.price)}</span>
                        <span className="text-sm text-stone-500">Lekë / muaj</span>
                      </div>
                      <p className="mt-2 text-xs text-stone-500">Vlera veçmas: <span className="line-through">{money(STANDALONE_VALUE[p.id])} Lekë</span> · kurseni {money(saving)} Lekë në muaj</p>
                      <ul className="mt-7 space-y-3 flex-1">
                        {p.items.map((it, j) => (<li key={j} className="flex items-start gap-2.5 text-sm text-stone-700"><CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${featured ? 'text-lime-500' : 'text-emerald-500'}`} />{it}</li>))}
                      </ul>
                      <button onClick={() => choose(p.id)} className={`mt-8 w-full py-4 rounded-xl text-base font-bold transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 ${featured ? 'text-stone-950 bg-gradient-to-r from-lime-400 to-lime-500 hover:shadow-lg hover:shadow-lime-500/30' : 'text-stone-900 border-2 border-stone-200 hover:border-lime-300 hover:bg-lime-50'}`}>Zgjidh {p.name}<ArrowRight className="w-5 h-5" /></button>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>
          <p className="mt-8 text-center text-xs text-stone-400">Buxheti i reklamave paguhet veçmas dhe është i ndarë nga tarifa e shërbimit. Çmimet pa TVSH. Plan 3-mujor.</p>

          {/* Ekstrat e Business */}
          <FadeIn><div className="text-center mt-24 mb-12"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Vetëm te Business</p><h2 className="text-3xl sm:text-4xl font-bold">Mbrojtja e emrit {CLIENT}</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Një klient i ri lexon vlerësimet para se të telefonojë. Paketa Business kujdeset që ajo që gjen për {CLIENT} të jetë e vërtetë, e drejtë dhe e fortë.</p></div></FadeIn>
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

      {/* ═══ 3 MUAJT ═══ */}
      <section className="py-24 bg-stone-950 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-lime-300 mb-3">Si organizohet puna</p><h2 className="text-3xl sm:text-4xl font-bold">Tre muajt e parë</h2><p className="mt-4 text-stone-400 max-w-2xl mx-auto">Për nisjen përcaktojmë së bashku buxhetin e reklamave, ofertën hyrëse dhe studiot ku do të përqendrohemi.</p></div></FadeIn>
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
              <p className="flex items-center gap-2 text-xs font-bold text-lime-300 uppercase tracking-wider mb-6"><BarChart3 className="w-4 h-4" />Çdo muaj, një raport i qartë me</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {REPORT.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-xl bg-white/5 p-4"><r.icon className="w-5 h-5 text-lime-300 flex-shrink-0 mt-0.5" /><span className="text-sm text-stone-200">{r.label}</span></div>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      <ClientLogos accentClass="text-lime-600" />

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="py-24 bg-stone-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-lime-600 mb-3">Kushtet & pyetjet</p><h2 className="text-3xl sm:text-4xl font-bold">Gjithçka që duhet të dini</h2></div></FadeIn>
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
                <p className="text-sm font-semibold uppercase tracking-widest text-lime-300 mb-4">Hapi i parë</p>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">Le ta kthejmë interesin për {CLIENT} në <span className="text-lime-300">kontakte, rezervime dhe klientë të rinj</span></h2>
                <p className="mt-5 text-stone-300 leading-relaxed text-lg">Zgjidhni paketën dhe na lini kontaktin. Brenda 24 orëve ju telefonojmë për të caktuar takimin e nisjes: buxheti i reklamave, oferta hyrëse dhe studiot prioritare.</p>
                <div className="mt-8 space-y-4">
                  {[`Reklama të veçanta për ${STUDIO_COUNT} studiot`, '16 postime në muaj: 10 Reels, 4 karusele, 2 foto + Stories', 'SEO + GEO: Google dhe kërkimet me AI', 'Raport mujor me kërkesat, koston dhe rezervimet'].map((t, i) => (
                    <div key={i} className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-lime-300" /><span className="text-stone-300">{t}</span></div>
                  ))}
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              {formSent ? (
                <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-10 border border-white/10 text-center"><div className="w-20 h-20 rounded-full bg-lime-400/20 flex items-center justify-center mx-auto mb-6"><CheckCircle2 className="w-10 h-10 text-lime-300" /></div><h3 className="text-2xl font-bold mb-3">Faleminderit!</h3><p className="text-stone-300">Kërkesa juaj u dërgua. Do t'ju telefonojmë brenda 24 orëve.</p></div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">Nisim bashkëpunimin</h3>
                  <div>
                    <p className="text-sm font-medium text-stone-300 mb-2">Paketa</p>
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
                    <div><label className="block text-sm font-medium text-stone-300 mb-1.5">Emri i plotë *</label><input type="text" required value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-lime-400" placeholder="Emër Mbiemër" /></div>
                    <div><label className="block text-sm font-medium text-stone-300 mb-1.5">Pozicioni / studioja</label><input type="text" value={formData.company} onChange={e => setFormData(p => ({ ...p, company: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-lime-400" placeholder="Body Code — Drejtues" /></div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-stone-300 mb-1.5">Email *</label><input type="email" required value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-lime-400" placeholder="info@bodycode.al" /></div>
                    <div><label className="block text-sm font-medium text-stone-300 mb-1.5">Telefon *</label><input type="tel" required value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-lime-400" placeholder="+355 6X XXX XXXX" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-stone-300 mb-1.5">Mesazh (opsional)</label><textarea rows={3} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-lime-400 resize-none" placeholder="Cilat studio doni të nisim të parat?" /></div>
                  {formError && (<div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">{formError}</div>)}
                  <button type="submit" disabled={submitting} className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-lime-400 to-lime-500 hover:from-lime-300 hover:to-lime-400 text-stone-950 shadow-lg shadow-lime-500/25 transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60">{submitting ? 'Duke dërguar...' : `Dërgo kërkesën — ${pkg.name}`}{!submitting && <ArrowUpRight className="w-5 h-5" />}</button>
                  <p className="text-xs text-stone-400 text-center flex items-center justify-center gap-1.5"><Phone className="w-3.5 h-3.5" />Takimi i nisjes është falas dhe pa detyrim.</p>
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
