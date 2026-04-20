import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, Zap, CheckCircle2, ArrowRight, Star, Users,
  Target, Clock, ChevronDown, Phone, ArrowUpRight, Sparkles,
  BarChart3, X, Video, MessageSquare, Search,
  Shield, Award, Camera, Globe, Megaphone,
} from 'lucide-react';

/* ─── Intersection Observer ─── */
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
    <div
      ref={ref}
      className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

function Counter({ end, suffix = '', duration = 2000 }: { end: number; suffix?: string; duration?: number }) {
  const { ref, visible } = useInView();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let start = 0;
    const step = end / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= end) { setCount(end); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [visible, end, duration]);
  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

/* ═══════════════════════════════════════════════
   4 PACKAGES
   ═══════════════════════════════════════════════ */
interface SocialPackage {
  id: string;
  title: string;
  subtitle: string;
  price: string;
  priceNote: string;
  popular?: boolean;
  badge?: string;
  color: string;
  border: string;
  headerBg: string;
  cta: string;
  targetAudience: string[];
  features: { category: string; items: string[] }[];
  notIncluded: string[];
}

const PACKAGES: SocialPackage[] = [
  {
    id: 'starter',
    title: 'Starter',
    subtitle: 'Prezencë profesionale dhe aktivitet i rregullt',
    price: '500€',
    priceNote: '/ muaj + ad spend',
    popular: false,
    badge: '',
    color: 'from-pink-400 to-rose-500',
    border: 'border-pink-200 hover:border-pink-400',
    headerBg: 'bg-gradient-to-br from-pink-50 to-rose-50',
    cta: 'Fillo me Starter',
    targetAudience: [
      'Biznese të reja online',
      'Brand-e personale & influencerë fillestarë',
      'Dyqane & shërbime lokale',
    ],
    features: [
      {
        category: 'Platformat & Kontent',
        items: [
          'Menaxhim 2 platformash (Facebook + Instagram)',
          '12 postime / muaj',
          '8 reels / muaj',
          'Design grafik profesional',
          'Copywriting & hashtag strategy',
          'Kalendar mujor kontent',
          'Publikim sipas orarit optimal',
        ],
      },
      {
        category: 'Reklama',
        items: [
          'Setup i fushatave Meta Ads',
          '1 fushatë aktive',
          'Targetim bazë i audiencës',
        ],
      },
      {
        category: 'Raportim',
        items: [
          'Raport mujor bazë',
          'KPIs: reach, engagement, followers',
        ],
      },
    ],
    notIncluded: [
      'Buxheti i reklamave',
      'TikTok / LinkedIn / YouTube',
      'Xhirime video profesionale',
      'Community management',
      'Google Ads',
    ],
  },
  {
    id: 'growth',
    title: 'Growth',
    subtitle: 'Rritje e audiencës dhe gjenerim i klientëve',
    price: '700€',
    priceNote: '/ muaj + ad spend',
    popular: false,
    badge: 'Popullor',
    color: 'from-violet-500 to-purple-600',
    border: 'border-violet-200 hover:border-violet-400',
    headerBg: 'bg-gradient-to-br from-violet-50 to-purple-50',
    cta: 'Zgjidh Growth',
    targetAudience: [
      'Biznese në rritje që duan followers',
      'E-commerce & shitje online',
      'Brand-e që duan lead generation',
    ],
    features: [
      {
        category: 'Platformat & Kontent',
        items: [
          'Menaxhim 3 platformash (FB + IG + TikTok)',
          '16 postime / muaj',
          '14 reels / muaj',
          '1 ditë xhirimi kontent / muaj',
          'Design grafik & branding',
          'Copywriting storytelling',
          'Stories / Highlights optimizim',
          'Kalendar strategjik kontent',
        ],
      },
      {
        category: 'Reklama',
        items: [
          'Menaxhim i plotë Meta Ads',
          '2–3 fushata aktive',
          'Audience targeting i avancuar',
          'Optimizim javor i reklamave',
          'Raportim javor performancës',
        ],
      },
      {
        category: 'Community & Raportim',
        items: [
          'Community management bazë',
          'Monitorim komentesh & mentions',
          'Raport mujor i detajuar',
        ],
      },
    ],
    notIncluded: [
      'Buxheti i reklamave',
      'LinkedIn / YouTube',
      'Google Ads',
      'Influencer management',
      'Email marketing',
    ],
  },
  {
    id: 'pro',
    title: 'Pro',
    subtitle: 'Dominim dixhital dhe rezultate të matshme',
    price: '1,400€',
    priceNote: '/ muaj + ad spend',
    popular: true,
    badge: 'Më i Zgjedhuri',
    color: 'from-indigo-500 to-blue-600',
    border: 'border-indigo-300 hover:border-indigo-500',
    headerBg: 'bg-gradient-to-br from-indigo-50 to-blue-50',
    cta: 'Zgjidh Pro',
    targetAudience: [
      'Biznese serioze me objektiva të qarta',
      'Brand-e që duan rritje agresive',
      'Kompani me produkte/shërbime të shumta',
    ],
    features: [
      {
        category: 'Platformat & Kontent',
        items: [
          'Menaxhim 4 platformash (FB + IG + TikTok + LinkedIn)',
          '24 postime / muaj',
          '20 reels / muaj',
          '2 ditë xhirimi / muaj',
          'Design grafik premium',
          'Copywriting i avancuar + SEO copy',
          'Video editing & subtitle',
          'Stories + Reels + Carousel strategy',
          'Kalendar strategjik 3-mujor',
        ],
      },
      {
        category: 'Reklama',
        items: [
          'Menaxhim i plotë Meta Ads',
          'Google Search & Display Ads',
          '4–6 fushata aktive',
          'Remarketing & retargeting',
          'Lookalike audiences',
          'A/B testing kreativësh',
          'Optimizim i vazhdueshëm',
        ],
      },
      {
        category: 'Community & Strategji',
        items: [
          'Community management aktiv',
          'Inbox management (komente + DM)',
          'Brand monitoring',
          'Raport javor + mujor i plotë',
          'Strategji rritje 6-mujore',
        ],
      },
    ],
    notIncluded: [
      'Buxheti i reklamave',
      'YouTube Ads',
      'Influencer management',
      'Email marketing automation',
    ],
  },
  {
    id: 'agency',
    title: 'Agency',
    subtitle: 'Zgjidhja e plotë — ekip i dedikuar për brand-in tuaj',
    price: '2,800€',
    priceNote: '/ muaj + ad spend',
    popular: false,
    badge: 'Full Service',
    color: 'from-amber-500 to-orange-500',
    border: 'border-amber-200 hover:border-amber-500',
    headerBg: 'bg-gradient-to-br from-amber-50 to-orange-50',
    cta: 'Zgjidh Agency',
    targetAudience: [
      'Kompani të mëdha & korporata',
      'Brand-e me prania multi-platformë',
      'Biznese që duan ekip të dedikuar',
    ],
    features: [
      {
        category: 'Platformat & Kontent',
        items: [
          'Menaxhim 5 platformash (FB + IG + TikTok + LinkedIn + YouTube)',
          '32+ postime / muaj',
          '28+ reels / muaj',
          '3+ ditë xhirimi / muaj',
          'Mini-dokumentarë & brand films',
          'Podcast / Audio content',
          'Design system i plotë brand',
          'Copywriting multiplatformë',
          'Kampanja sezonale & promovuese',
        ],
      },
      {
        category: 'Reklama Full-Funnel',
        items: [
          'Meta Ads + Google Ads + TikTok Ads',
          'YouTube Ads',
          'Fushata pa limit',
          'Full funnel strategy (Awareness → Conversion)',
          'Email marketing automation',
          'CRM integration & follow-up',
          'Buxhet i optimizuar cross-platform',
        ],
      },
      {
        category: 'Ekip & Strategji',
        items: [
          'Account manager i dedikuar',
          'Menaxher kontent i dedikuar',
          'Community management i plotë 7/7',
          'Inbox + DM management',
          'Influencer marketing & koordinim',
          'Brand reputation management',
          'Raport javor + mujor + kuartal',
          'Strategji vjetore growth',
        ],
      },
    ],
    notIncluded: [
      'Buxheti i reklamave',
    ],
  },
];

const PAIN_POINTS = [
  {
    icon: Users,
    title: 'Followers, por jo klientë',
    body: 'Keni ndjekës në Instagram, por nuk kthehen në blerës. Kontent pa strategji nuk sjell shitje — strategji pa ekzekutim nuk funksionon.',
    color: 'text-rose-500',
    bg: 'bg-rose-50',
  },
  {
    icon: Clock,
    title: 'Nuk keni kohë',
    body: 'Postimet bëhen rastësisht ose fare nuk bëhen. Algoritmi i ndëshkon ata që nuk janë të rregullt — ju humbisni reach çdo ditë.',
    color: 'text-amber-500',
    bg: 'bg-amber-50',
  },
  {
    icon: BarChart3,
    title: 'Reklamat hangrën buxhetin',
    body: 'Keni investuar në Meta Ads por rezultatet ishin zhgënjyese. Reklamat pa strategji të saktë janë para të hedhura.',
    color: 'text-orange-500',
    bg: 'bg-orange-50',
  },
  {
    icon: Search,
    title: 'Konkurrenti është kudo',
    body: 'Kompetitorët tuaj janë aktiv, postojnë çdo ditë dhe marrin klientët tuaj potencialë. Çdo ditë pa prezencë është mundësi e humbur.',
    color: 'text-purple-500',
    bg: 'bg-purple-50',
  },
];

const PROCESS_STEPS = [
  { n: '01', title: 'Audit & Strategji',   body: 'Analizojmë profilin, audiencën, konkurrencën. Ndërtojmë strategji të personalizuar me qëllime të matshme.' },
  { n: '02', title: 'Brand Voice & Vizual', body: 'Krijojmë identitetin vizual, tonin e komunikimit dhe kalendarin e parë të kontentit.' },
  { n: '03', title: 'Prodhim & Publikim',   body: 'Prodhojmë postime, reels, stories dhe i publikojmë sipas orarit optimal të audiencës suaj.' },
  { n: '04', title: 'Reklamim & Rritje',    body: 'Aktivizojmë fushatat reklamuese, testojmë, optimizojmë — gjithmonë me fokus te ROI.' },
  { n: '05', title: 'Raportim & Iterim',    body: 'Çdo muaj raport i detajuar me numra realë dhe plan aksioni për muajin vijues.' },
];

const ADDONS = [
  { icon: Video,       title: 'Produksion Video',     desc: 'Xhirim dhe editim video profesionale: brand films, testimoniale, product shots.' },
  { icon: Globe,       title: 'Faqe Interneti',        desc: 'Landing page ose faqe e plotë me SEO të integruar dhe lidhje me social media.' },
  { icon: MessageSquare, title: 'WhatsApp Marketing', desc: 'Fushata direkte te klientët nëpërmjet WhatsApp — apertura 98%.' },
  { icon: Award,       title: 'Influencer Marketing',  desc: 'Identifikim, kontaktim dhe koordinim influencerësh relevantë për brand-in tuaj.' },
  { icon: Camera,      title: 'Foto Profesionale',     desc: 'Sesion fotografimi produktesh, shërbimesh ose brand lifestyle.' },
  { icon: Shield,      title: 'Reputacion Online',     desc: 'Menaxhim recensionesh, komentesh negative dhe ndërtim imazhi pozitiv.' },
];

const TESTIMONIALS = [
  {
    name: 'Elona Marku',
    role: 'CEO, Dyqan Mode "Lira Fashion"',
    text: 'Pas 2 muajsh me paketën Pro, shitjet online u rritën 340%. Reklamat e tyre janë të ndryshme — jo vetëm "boost post".',
    stars: 5,
    avatar: 'EM',
    color: 'bg-pink-500',
  },
  {
    name: 'Genti Basha',
    role: 'Pronar, Restaurant "Oltari"',
    text: 'Nga zero në 8,200 ndjekës në 4 muaj. Por më e rëndësishme — rezervimet u trefishuan.',
    stars: 5,
    avatar: 'GB',
    color: 'bg-violet-500',
  },
  {
    name: 'Anisa Çela',
    role: 'Drejtuese Marketing, "CleanPro Albania"',
    text: 'Ekipi Agency është si ekipi ynë i brendshëm, por me ekspertizë shumë më të lartë. ROI 8x brenda 6 muajsh.',
    stars: 5,
    avatar: 'AC',
    color: 'bg-indigo-500',
  },
];

const FAQS = [
  {
    q: 'Cila paketë është e duhura për mua?',
    a: 'Varet nga qëllimet dhe buxheti juaj. Starter është ideal për prezencë profesionale, Growth për rritje audiencës, Pro për lead generation agresive, Agency për kompani të mëdha me nevojë për ekip të dedikuar. Gjatë konsultimit falas, ju rekomandojmë paketën e duhur.',
  },
  {
    q: 'Sa kohë duhet për të parë rezultate?',
    a: 'Rezultate të para (rritje engagement, followers) shfaqen brenda 30 ditëve. Lead-et dhe konvertimet fillojnë pas 4–8 javësh, ndërsa rritja e qëndrueshme ndjehet pas 3 muajsh bashkëpunimi.',
  },
  {
    q: 'Çfarë buxheti reklamash duhet?',
    a: 'Për paketën Starter rekomandojmë 100–200€/muaj. Growth: 200–400€/muaj. Pro: 400–800€/muaj. Agency: sipas strategjisë. Buxheti menaxhohet direkt nga ne dhe paguhet te platformat (Meta/Google).',
  },
  {
    q: 'A mund të ndryshoj paketën pas fillimit?',
    a: 'Po, mund të upgradoni ose downgradoni çdo muaj. Nuk kemi kontratë afatgjatë — punojmë muaj pas muaji me rezultate.',
  },
  {
    q: 'Kush prodhon materialin vizual (foto/video)?',
    a: 'Ne prodhojmë çdo material. Në paketat Growth e lart, përfshihet 1–3 ditë xhirimi/muaj. Mund të shtoni edhe "Foto Profesionale" si add-on nëse keni nevojë për sesion të dedikuar.',
  },
  {
    q: 'A punoni me çdo lloj biznesi?',
    a: 'Po. Kemi eksperiencë në: e-commerce, restorante, hotele, bukuri & estetikë, fashion, fitness, arsim, imobiliare, teknologji, shërbime profesionale dhe shumë të tjera. Strategjia personalizohet sipas industrisë.',
  },
];

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════ */
const SocialMediaLandingPage: React.FC = () => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [selectedPkg, setSelectedPkg] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', business: '', message: '' });

  const scrollToPackages = () => document.getElementById('packages')?.scrollIntoView({ behavior: 'smooth' });
  const scrollToContact  = (pkg = '') => {
    if (pkg) setSelectedPkg(pkg);
    document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/landing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, selectedPackage: selectedPkg, source: 'social-media-landing', category: 'SocialMedia' }),
      });
      if (!res.ok) throw new Error();
      setSubmitted(true);
    } catch {
      setFormError('Diçka shkoi keq. Provoni përsëri ose na kontaktoni direkt.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">

      {/* ═══ NAVBAR ═══ */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 via-purple-500 to-indigo-500 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg">Fivo<span className="bg-gradient-to-r from-pink-500 to-violet-600 bg-clip-text text-transparent">Social</span></span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600">
            <a href="#problemi"  className="hover:text-purple-600 transition-colors">Problemi</a>
            <a href="#packages"  className="hover:text-purple-600 transition-colors">Paketat</a>
            <a href="#procesi"   className="hover:text-purple-600 transition-colors">Procesi</a>
            <a href="#faq"       className="hover:text-purple-600 transition-colors">FAQ</a>
          </nav>
          <button
            onClick={() => scrollToContact()}
            className="bg-gradient-to-r from-pink-500 to-violet-600 hover:opacity-90 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-opacity shadow-sm"
          >
            Konsultim Falas
          </button>
        </div>
      </header>

      {/* ═══ HERO ═══ */}
      <section className="relative pt-28 pb-24 overflow-hidden bg-gradient-to-br from-gray-950 via-purple-950 to-gray-950 text-white">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/3 w-[700px] h-[700px] bg-purple-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-pink-500/10 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-0 w-[300px] h-[300px] bg-indigo-500/10 rounded-full blur-3xl" />
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 text-sm mb-6">
              <Sparkles className="w-4 h-4 text-pink-300" />
              <span className="text-purple-200">Menaxhim Profesional i Rrjeteve Sociale</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight mb-6">
              Brand-i juaj meriton{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-400 via-purple-400 to-indigo-400">
                prezencë të vërtetë
              </span>
              {' '}online
            </h1>

            <p className="text-lg sm:text-xl text-purple-100 mb-8 leading-relaxed max-w-2xl">
              Ne menaxhojmë Facebook, Instagram, TikTok dhe reklamat tuaja —
              ju përqendroheni te biznesi. Rezultate të matshme, jo premtime boshe.
            </p>

            <div className="flex flex-col sm:flex-row gap-4">
              <button
                onClick={() => scrollToContact()}
                className="flex items-center justify-center gap-2 bg-gradient-to-r from-pink-500 to-violet-600 text-white font-bold px-8 py-4 rounded-xl hover:opacity-90 transition-opacity shadow-lg text-lg"
              >
                <Phone className="w-5 h-5" />
                Konsultim Falas
              </button>
              <button
                onClick={scrollToPackages}
                className="flex items-center justify-center gap-2 border border-white/20 text-white font-semibold px-8 py-4 rounded-xl hover:bg-white/10 transition-colors text-lg"
              >
                Shiko Paketat
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-6 mt-10 text-sm text-purple-300">
              <div className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-400" />Pa kontratë afatgjatë</div>
              <div className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-400" />Raporte transparente</div>
              <div className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-400" />Fillojmë brenda 5 ditësh</div>
            </div>
          </div>
        </div>

        {/* Floating platform icons */}
        <div className="absolute right-8 top-1/2 -translate-y-1/2 hidden xl:flex flex-col gap-4 opacity-60">
          {['f', 'in', 'tk', 'yt', 'li'].map((p, i) => (
            <div key={i} className="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-white text-xs font-bold backdrop-blur">
              {p}
            </div>
          ))}
        </div>

        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 60" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
            <path d="M0 60L1440 60L1440 20C1200 60 960 0 720 20C480 40 240 0 0 20L0 60Z" fill="white" />
          </svg>
        </div>
      </section>

      {/* ═══ STATS ═══ */}
      <section className="py-16 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 text-center">
            {[
              { end: 120,   suffix: '+',  label: 'brand të menaxhuar',         color: 'text-pink-600' },
              { end: 450,   suffix: '%',  label: 'rritje mesatare engagement',  color: 'text-violet-600' },
              { end: 2800,  suffix: 'K+', label: 'followers të fituar',         color: 'text-indigo-600' },
              { end: 99,    suffix: '%',  label: 'klientë që ripërtërijnë',     color: 'text-green-600' },
            ].map((s, i) => (
              <FadeIn key={i} delay={i * 100}>
                <div>
                  <div className={`text-4xl font-extrabold ${s.color} mb-1`}>
                    <Counter end={s.end} suffix={s.suffix} />
                  </div>
                  <p className="text-sm text-gray-500 font-medium">{s.label}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PAIN POINTS ═══ */}
      <section id="problemi" className="py-20 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <FadeIn>
            <div className="text-center mb-14">
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">Pse nuk po rritet biznesi juaj online?</h2>
              <p className="text-gray-500 max-w-xl mx-auto">Ne kemi ndihmuar mbi 120 biznese të kalojnë nga rrëmuja digjitale te një sistem që sjell rezultate të matshme.</p>
            </div>
          </FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {PAIN_POINTS.map((p, i) => {
              const Icon = p.icon;
              return (
                <FadeIn key={i} delay={i * 100}>
                  <div className={`${p.bg} rounded-2xl p-6 border border-gray-100`}>
                    <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center mb-4 shadow-sm">
                      <Icon className={`w-5 h-5 ${p.color}`} />
                    </div>
                    <h3 className="font-bold text-gray-900 mb-2">{p.title}</h3>
                    <p className="text-sm text-gray-600 leading-relaxed">{p.body}</p>
                  </div>
                </FadeIn>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══ PACKAGES ═══ */}
      <section id="packages" className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <FadeIn>
            <div className="text-center mb-16">
              <span className="inline-block bg-purple-100 text-purple-600 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">Çmimet</span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">4 paketa — 1 zgjidhje e duhur për ju</h2>
              <p className="text-gray-500 max-w-xl mx-auto">Nga 500€/muaj deri në 2,800€/muaj. Pa kontratë — ndryshoni kur dëshironi.</p>
            </div>
          </FadeIn>

          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-6 items-start">
            {PACKAGES.map((pkg, i) => (
              <FadeIn key={pkg.id} delay={i * 100}>
                <div className={`relative bg-white rounded-2xl border-2 ${pkg.border} transition-all duration-300 shadow-sm hover:shadow-xl flex flex-col overflow-hidden`}>
                  {/* Popular highlight */}
                  {pkg.popular && (
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500" />
                  )}

                  {/* Header */}
                  <div className={`${pkg.headerBg} p-5 pb-4`}>
                    {pkg.badge && (
                      <span className={`inline-block mb-3 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full text-white bg-gradient-to-r ${pkg.color}`}>
                        {pkg.badge}
                      </span>
                    )}
                    <div className={`inline-flex w-9 h-9 rounded-xl items-center justify-center bg-gradient-to-br ${pkg.color} mb-3`}>
                      <Megaphone className="w-4 h-4 text-white" />
                    </div>
                    <h3 className="text-xl font-extrabold text-gray-900">{pkg.title}</h3>
                    <p className="text-xs text-gray-500 mt-1 mb-3 leading-snug">{pkg.subtitle}</p>
                    <div className="flex items-end gap-1">
                      <span className="text-3xl font-extrabold text-gray-900">{pkg.price}</span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5 mb-4">{pkg.priceNote}</p>
                    <button
                      onClick={() => scrollToContact(pkg.title)}
                      className={`w-full py-2.5 rounded-xl font-bold text-sm text-white bg-gradient-to-r ${pkg.color} hover:opacity-90 transition-opacity shadow`}
                    >
                      {pkg.cta}
                    </button>
                  </div>

                  {/* Target audience */}
                  <div className="px-5 py-3 border-b border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Ideal për</p>
                    <ul className="space-y-1">
                      {pkg.targetAudience.map((a, j) => (
                        <li key={j} className="flex items-start gap-1.5 text-[11px] text-gray-600">
                          <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0 mt-0.5" />
                          {a}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Features */}
                  <div className="px-5 py-4 flex-1 space-y-4">
                    {pkg.features.map((sec, si) => (
                      <div key={si}>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">{sec.category}</p>
                        <ul className="space-y-1.5">
                          {sec.items.map((item, ii) => (
                            <li key={ii} className="flex items-start gap-1.5 text-[11px] text-gray-700">
                              <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0 mt-0.5" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}

                    {/* Not included */}
                    {pkg.notIncluded.length > 1 && (
                      <div>
                        <p className="text-[10px] font-bold text-gray-300 uppercase tracking-wider mb-1.5">Nuk përfshihet</p>
                        <ul className="space-y-1">
                          {pkg.notIncluded.map((item, ii) => (
                            <li key={ii} className="flex items-start gap-1.5 text-[11px] text-gray-400">
                              <X className="w-3 h-3 text-gray-300 flex-shrink-0 mt-0.5" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>

          <FadeIn>
            <p className="text-center text-sm text-gray-400 mt-8">
              * Buxheti i reklamave paguhet direkt te platformat (Meta/Google/TikTok) — nuk përfshihet në çmim.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ═══ COMPARISON STRIP ═══ */}
      <section className="py-12 bg-gradient-to-r from-pink-50 via-purple-50 to-indigo-50 border-y border-purple-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <FadeIn>
            <div className="flex flex-wrap justify-center gap-6 text-sm">
              {[
                { label: 'Starter',  price: '500€',   color: 'text-pink-600' },
                { label: 'Growth',   price: '700€',   color: 'text-violet-600' },
                { label: 'Pro',      price: '1,400€', color: 'text-indigo-600' },
                { label: 'Agency',   price: '2,800€', color: 'text-amber-600' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3 bg-white rounded-xl px-5 py-3 shadow-sm border border-gray-100">
                  <span className="font-bold text-gray-900">{item.label}</span>
                  <span className="text-gray-300">|</span>
                  <span className={`font-extrabold text-lg ${item.color}`}>{item.price}<span className="text-xs text-gray-400 font-normal">/muaj</span></span>
                  <button
                    onClick={() => scrollToContact(item.label)}
                    className="ml-2 text-xs text-primary hover:underline font-medium flex items-center gap-1"
                  >
                    Zgjidh <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══ PROCESS ═══ */}
      <section id="procesi" className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <FadeIn>
            <div className="text-center mb-14">
              <span className="inline-block bg-indigo-100 text-indigo-600 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">Si Punojmë</span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">Procesi ynë i provuar</h2>
              <p className="text-gray-500 max-w-xl mx-auto">5 hapa drejt prezencës dixhitale që sjell rezultate.</p>
            </div>
          </FadeIn>
          <div className="relative">
            <div className="hidden lg:block absolute top-8 left-[10%] right-[10%] h-0.5 bg-gradient-to-r from-pink-200 via-purple-300 to-indigo-200" />
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-8">
              {PROCESS_STEPS.map((step, i) => (
                <FadeIn key={i} delay={i * 100}>
                  <div className="relative text-center">
                    <div className="w-16 h-16 bg-gradient-to-br from-pink-500 via-purple-500 to-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-purple-200 relative z-10">
                      <span className="text-white font-extrabold text-lg">{step.n}</span>
                    </div>
                    <h3 className="font-bold text-gray-900 mb-2 text-sm">{step.title}</h3>
                    <p className="text-xs text-gray-500 leading-relaxed">{step.body}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ ADD-ONS ═══ */}
      <section className="py-20 bg-gray-950 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_hsl(270,60%,50%,0.15),_transparent_70%)]" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
          <FadeIn>
            <div className="text-center mb-12">
              <span className="inline-block bg-white/10 text-purple-300 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">Shtojca</span>
              <h2 className="text-3xl font-extrabold mb-3">Shërbime shtesë</h2>
              <p className="text-gray-400 max-w-xl mx-auto text-sm">Personalizoni paketën tuaj — shtoni çfarë ju nevojitet.</p>
            </div>
          </FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {ADDONS.map((a, i) => {
              const Icon = a.icon;
              return (
                <FadeIn key={i} delay={i * 80}>
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-colors">
                    <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center mb-4">
                      <Icon className="w-5 h-5 text-purple-300" />
                    </div>
                    <h3 className="font-bold mb-2">{a.title}</h3>
                    <p className="text-sm text-gray-400 leading-relaxed">{a.desc}</p>
                  </div>
                </FadeIn>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══ TESTIMONIALS ═══ */}
      <section className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <FadeIn>
            <div className="text-center mb-14">
              <span className="inline-block bg-yellow-100 text-yellow-600 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">Rezultate Reale</span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">Çfarë thonë klientët tanë</h2>
              <p className="text-gray-500">Biznese reale — numra realë.</p>
            </div>
          </FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {TESTIMONIALS.map((t, i) => (
              <FadeIn key={i} delay={i * 120}>
                <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition-shadow">
                  <div className="flex gap-0.5 mb-4">
                    {Array.from({ length: t.stars }).map((_, j) => (
                      <Star key={j} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                    ))}
                  </div>
                  <p className="text-gray-700 text-sm leading-relaxed mb-6 italic">"{t.text}"</p>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full ${t.color} flex items-center justify-center text-white font-bold text-sm`}>
                      {t.avatar}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{t.name}</p>
                      <p className="text-xs text-gray-500">{t.role}</p>
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="py-24 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <FadeIn>
            <div className="text-center mb-14">
              <span className="inline-block bg-purple-100 text-purple-600 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">FAQ</span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">Pyetjet e shpeshta</h2>
            </div>
          </FadeIn>
          <div className="space-y-3">
            {FAQS.map((faq, i) => (
              <FadeIn key={i} delay={i * 50}>
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                  <button
                    className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 transition-colors"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  >
                    <span className="font-semibold text-gray-900 text-sm pr-4">{faq.q}</span>
                    <ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                  </button>
                  {openFaq === i && (
                    <div className="px-5 pb-5">
                      <p className="text-sm text-gray-600 leading-relaxed">{faq.a}</p>
                    </div>
                  )}
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ CONTACT ═══ */}
      <section id="contact" className="py-24 bg-gradient-to-br from-gray-950 via-purple-950 to-gray-950 text-white relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-pink-500/10 rounded-full blur-3xl" />
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
          <div className="grid lg:grid-cols-2 gap-14 items-start">
            {/* Left */}
            <FadeIn>
              <div>
                <span className="inline-block bg-white/10 text-purple-300 text-xs font-bold px-3 py-1 rounded-full mb-6 uppercase tracking-wide">Fillo Sot</span>
                <h2 className="text-3xl sm:text-4xl font-extrabold mb-6 leading-tight">
                  Konsultim falas —<br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-violet-400">pa asnjë detyrim</span>
                </h2>
                <p className="text-purple-200 mb-8 leading-relaxed">
                  Takohemi, analizojmë gjendjen aktuale dhe ju tregojmë saktësisht çfarë mund të arrihet me brand-in tuaj online.
                </p>
                <div className="space-y-4">
                  {[
                    { icon: CheckCircle2, text: 'Audit falas i profileve tuaja sociale' },
                    { icon: Target,       text: 'Strategji e personalizuar për industrinë tuaj' },
                    { icon: TrendingUp,   text: 'Projeksion i followers, engagement dhe leads' },
                    { icon: Zap,          text: 'Fillojmë prodhimin brenda 5 ditëve pune' },
                  ].map((item, i) => {
                    const Icon = item.icon;
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                          <Icon className="w-4 h-4 text-purple-300" />
                        </div>
                        <span className="text-purple-100 text-sm">{item.text}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </FadeIn>

            {/* Right: form */}
            <FadeIn delay={200}>
              {submitted ? (
                <div className="bg-white/10 backdrop-blur rounded-2xl p-10 border border-white/10 text-center">
                  <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8 text-green-400" />
                  </div>
                  <h3 className="text-2xl font-bold mb-3">Faleminderit!</h3>
                  <p className="text-purple-200 leading-relaxed">Kërkesa juaj u dërgua me sukses. Do t'ju kontaktojmë brenda 24 orëve.</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">Merr Konsultimin Falas</h3>

                  {selectedPkg && (
                    <div className="flex items-center gap-2 bg-purple-500/20 rounded-lg px-4 py-2.5 text-sm border border-purple-400/30">
                      <Sparkles className="w-4 h-4 text-purple-300" />
                      <span className="text-purple-200">Paketa: <strong className="text-white">{selectedPkg}</strong></span>
                      <button type="button" onClick={() => setSelectedPkg('')} className="ml-auto">
                        <X className="w-4 h-4 text-purple-400 hover:text-white" />
                      </button>
                    </div>
                  )}

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-purple-200 mb-1.5">Emri & Mbiemri *</label>
                      <input required type="text" placeholder="Artan Hoxha"
                        value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                        className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-purple-300/60 text-sm focus:outline-none focus:border-purple-400 focus:bg-white/15 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-purple-200 mb-1.5">Telefon *</label>
                      <input required type="tel" placeholder="+355 69 XXX XXXX"
                        value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))}
                        className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-purple-300/60 text-sm focus:outline-none focus:border-purple-400 focus:bg-white/15 transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-purple-200 mb-1.5">Email *</label>
                    <input required type="email" placeholder="info@biznesi-juaj.al"
                      value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-purple-300/60 text-sm focus:outline-none focus:border-purple-400 focus:bg-white/15 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-purple-200 mb-1.5">Emri i Biznesit *</label>
                    <input required type="text" placeholder="Biznesi juaj / Brand-i juaj"
                      value={formData.business} onChange={e => setFormData(p => ({ ...p, business: e.target.value }))}
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-purple-300/60 text-sm focus:outline-none focus:border-purple-400 focus:bg-white/15 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-purple-200 mb-1.5">Mesazhi (opsional)</label>
                    <textarea rows={3} placeholder="Tregoni pak për biznesin dhe sfidat kryesore..."
                      value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))}
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-purple-300/60 text-sm focus:outline-none focus:border-purple-400 focus:bg-white/15 transition-colors resize-none"
                    />
                  </div>

                  {formError && <p className="text-red-300 text-sm bg-red-500/10 rounded-lg px-4 py-2">{formError}</p>}

                  <button type="submit" disabled={submitting}
                    className="w-full bg-gradient-to-r from-pink-500 to-violet-600 text-white font-bold py-4 rounded-xl hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-60 text-sm"
                  >
                    {submitting ? (
                      <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Duke dërguar...</>
                    ) : (
                      <><ArrowUpRight className="w-5 h-5" />Dërgo Kërkesën — Falas</>
                    )}
                  </button>
                  <p className="text-xs text-purple-300/70 text-center">Pa detyrim. Ju kontaktojmë brenda 24 orëve.</p>
                </form>
              )}
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="bg-gray-950 border-t border-gray-900 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gradient-to-br from-pink-500 via-purple-500 to-indigo-500 flex items-center justify-center">
              <Sparkles className="w-3 h-3 text-white" />
            </div>
            <span>&copy; {new Date().getFullYear()} FivoCRM. Të gjitha të drejtat e rezervuara.</span>
          </div>
          <div className="flex items-center gap-6">
            <Link to="/login" className="hover:text-white transition-colors">Hyrje</Link>
            <a href="#packages" className="hover:text-white transition-colors">Çmimet</a>
            <a href="#contact"  className="hover:text-white transition-colors">Kontakt</a>
          </div>
        </div>
      </footer>

    </div>
  );
};

export default SocialMediaLandingPage;
