import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, TrendingUp, Shield, Zap, CheckCircle2, ArrowRight,
  Star, Users, Target, Clock, ChevronDown, Phone,
  Camera, Instagram, Megaphone, BarChart3,
  X, Lock, Search, Globe, Sun, Leaf, Trees,
} from 'lucide-react';

/* ─── Intersection Observer ─── */
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
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
   PACKAGES
   ═══════════════════════════════════════════════ */
interface AgroPackage {
  id: string;
  title: string;
  subtitle: string;
  price: string;
  originalPrice?: string;
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

const PACKAGES: AgroPackage[] = [
  {
    id: 'starter',
    title: 'Starter',
    subtitle: 'Hyrje në botën dixhitale për agroturizmin tuaj',
    price: '800€',
    priceNote: '/ muaj + ad spend',
    badge: 'Për të Filluar',
    targetAudience: [
      'Agroturizme të reja që duan vizibilitet online',
      'Ferma të vogla familjare',
      'Bujtina rurale me kapacitet të vogël',
    ],
    features: [
      {
        category: '📸 Fotoshooting Profesionale',
        items: [
          '2 ditë fotoshooting në muaj',
          'Foto profesionale të ambientit & natyrës',
          'Foto të dhomave, restorantit & aktiviteteve',
          'Editim & retush profesional',
          'Të drejtat e plota mbi materialet',
        ],
      },
      {
        category: 'Social Media Management',
        items: [
          'Menaxhim Facebook + Instagram',
          '12 postime / muaj',
          '8 reels / muaj',
          'Design grafik & copywriting në shqip/anglisht',
          'Publikim sipas kalendarit sezonal',
          'Raport mujor performance',
        ],
      },
      {
        category: 'SEO & Google',
        items: [
          'Audit teknik i website-it',
          'Google Business Profile optimizim',
          'Keyword research (20 fjalë kyçe agroturizëm)',
          'Optimizim On-page',
          '1 artikull blog / muaj (kulturë, tradita, ushqim)',
        ],
      },
    ],
    notIncluded: [
      'Buxheti i reklamave (ad spend)',
      'Meta & Google Ads',
      'Video drone aeriale',
      'Website development',
    ],
    color: 'from-amber-500 to-lime-600',
    border: 'border-amber-300 hover:border-amber-500',
    headerBg: 'bg-gradient-to-br from-amber-50 to-lime-50',
    cta: 'Zgjidh Starter',
  },
  {
    id: 'growth',
    title: 'Growth',
    subtitle: 'SEO + Social Media + Ads — paketa më e kërkuar',
    price: '1,300€',
    originalPrice: '1,500€',
    priceNote: '/ muaj + ad spend',
    popular: true,
    badge: 'Më e Popullarizuara',
    targetAudience: [
      'Agroturizme në rritje me kapacitet mesatar',
      'Ferma me restorant & dhoma akomodimi',
      'Bujtina me 5–15 dhoma',
    ],
    features: [
      {
        category: '📸 Fotoshooting Profesionale',
        items: [
          '2 ditë fotoshooting në muaj',
          'Foto premium ambient, dhoma, restorant',
          'Foto aktivitete (verë, ulli, mjaltë, hipur kalit)',
          'Stagione: pranverë, verë, vjeshtë',
          'Foto food styling & gastronomi tradicionale',
          'Editim premium & retush avancuar',
          'Bibliotekë e plotë mediash për përdorim afatgjatë',
        ],
      },
      {
        category: 'Social Media Management',
        items: [
          'Menaxhim FB + Instagram',
          '20 postime / muaj',
          '16 reels / muaj',
          'Story të përditshme & highlights',
          'Community management aktiv',
          'Bashkëpunime me influencerë lokalë',
          'Raport javor + mujor i detajuar',
        ],
      },
      {
        category: 'Meta Ads',
        items: [
          'Menaxhim i plotë i Meta Ads',
          '3–4 fushata aktive',
          'Targeting turistë vendas + të huaj',
          'Booking & enquiry campaigns',
          'Optimizim javor i fushatave',
        ],
      },
      {
        category: 'SEO Avancuar',
        items: [
          'Audit i plotë teknik & off-page',
          'Keyword research (40+ fjalë: "agroturizëm Shqipëri", etj.)',
          'Optimizim On-page i plotë',
          'Google Business Profile menaxhim aktiv',
          '2 artikuj blog / muaj',
          'Lokalizim për Booking.com & TripAdvisor',
        ],
      },
    ],
    notIncluded: [
      'Buxheti i reklamave',
      'Video drone aeriale (add-on)',
      'Website development',
    ],
    color: 'from-emerald-500 to-green-600',
    border: 'border-emerald-300 hover:border-emerald-500',
    headerBg: 'bg-gradient-to-br from-emerald-50 to-green-50',
    cta: 'Zgjidh Growth',
  },
  {
    id: 'pro',
    title: 'Pro',
    subtitle: 'Dominim i plotë i tregut turistik dixhital',
    price: '2,000€',
    priceNote: '/ muaj + ad spend',
    badge: 'Maksimum Rezultate',
    targetAudience: [
      'Agroturizme premium me brand të fortë',
      'Resort rurale & estate vinifikimi',
      'Destinacione me 15+ dhoma & event hosting',
    ],
    features: [
      {
        category: '📸 Fotoshooting Profesionale',
        items: [
          '2 ditë fotoshooting në muaj',
          'Foto + Video premium me drone aerial',
          'Filmime kinematike të peizazheve',
          'Video testimoniale të mysafirëve',
          'Brand storytelling visual',
          'Stilist profesional për food & ambient',
          'Galeri komplete sezonale për website & social',
        ],
      },
      {
        category: 'Social Media Management',
        items: [
          'Menaxhim FB + Instagram + TikTok + YouTube',
          '30 postime / muaj',
          '24 reels / muaj',
          'Video kinematike mujore',
          'Bashkëpunime me influencerë ndërkombëtarë',
          'Strategji brand & content kalendarik vjetor',
          'Community management premium',
          'Raportim javor + mujor i thelluar',
        ],
      },
      {
        category: 'Meta + Google Ads',
        items: [
          'Menaxhim i plotë Meta Ads',
          '5–7 fushata aktive (vendas + ndërkombëtar)',
          'Google Search Ads & Display',
          'YouTube Ads (video kinematike)',
          'Retargeting & lookalike audiences',
          'A/B testing kreativësh',
          'Optimizim ditor i fushatave',
        ],
      },
      {
        category: 'SEO Premium',
        items: [
          'Audit teknik dhe off-page premium',
          'Keyword research (80+ fjalë multilingual)',
          'Optimizim multilingual (SQ / EN / IT)',
          'Ndërtim backlinks (DR 40+)',
          '4 artikuj blog / muaj',
          'Booking.com / Airbnb / TripAdvisor optimizim',
          'Raport mujor strategjik',
        ],
      },
    ],
    notIncluded: [
      'Buxheti i reklamave',
      'Website development (ofrohet si projekt veçmas)',
    ],
    color: 'from-green-700 to-emerald-800',
    border: 'border-green-400 hover:border-green-600',
    headerBg: 'bg-gradient-to-br from-green-50 to-emerald-50',
    cta: 'Zgjidh Pro',
  },
];

const ADD_ONS = [
  { name: 'Ditë ekstra fotoshooting', price: '250€ – 400€', icon: Camera },
  { name: 'Video drone aerial', price: '300€ – 500€', icon: Camera },
  { name: 'Video testimonial mysafirësh', price: '120€ – 200€', icon: Star },
  { name: 'Food styling shoot', price: '150€ – 280€', icon: Sparkles },
  { name: 'Fushatë sezonale speciale', price: 'Sipas kërkesës', icon: Megaphone },
  { name: 'Përkthim multilingual content', price: '80€ – 150€', icon: Globe },
];

const RESULTS = [
  { metric: '85', suffix: '+', label: 'Agroturizme të promovuara në Shqipëri', icon: Trees },
  { metric: '72', suffix: '%', label: 'Klientë me rritje rezervimesh brenda 90 ditësh', icon: Target },
  { metric: '5.1', suffix: 'x', label: 'Rritje mesatare e vizitave organike Google', icon: TrendingUp },
  { metric: '60', suffix: '+', label: 'Ferma & bujtina me brand të fortë dixhital', icon: Users },
];

const PAIN_POINTS = [
  {
    icon: Globe,
    title: 'Turistët nuk ju gjejnë online',
    desc: 'Turistët kërkojnë "agroturizëm Shqipëri" ose "ferma për fundjavë", por website-i juaj nuk del në Google. Konkurrenca i merr rezervimet që duhej të ishin tuajat.',
  },
  {
    icon: Camera,
    title: 'Foto amatore nuk ja arrijnë emocionit',
    desc: 'Bukuria e fermës, natyra, ushqimi tradicional, atmosfera familjare — të gjitha humbasin në foto të bëra me telefon. Pa foto profesionale, mysafirët nuk e ndjejnë magjinë.',
  },
  {
    icon: Clock,
    title: 'Sezoni i shkurtër — koha po humbet',
    desc: 'Pranvera, vera dhe vjeshta janë sezonet tuaja. Çdo javë pa marketing profesional është dhoma bosh, është ushqim që mbetet, është mundësi e humbur.',
  },
];

const PROCESS_STEPS = [
  { step: '01', title: 'Analiza & Strategjia', desc: 'Vizitojmë fermën, kuptojmë identitetin, shërbimet, mysafirët ideal dhe konkurrencën. Hartojmë strategji dixhitale autentike.', icon: Target },
  { step: '02', title: '2 Fotoshooting / Muaj', desc: 'Dy ditë në muaj me ekipin profesional — ambient, dhoma, restorant, aktivitete, peizazhe. Foto për gjithë sezonin.', icon: Camera },
  { step: '03', title: 'SEO & Prezenca Google', desc: 'Optimizojmë website-in, Google Business Profile, Booking.com, TripAdvisor. Ndërtojmë autoritet organik për fjalët kyçe të agroturizmit.', icon: Search },
  { step: '04', title: 'Reklama & Optimizim', desc: 'Lançojmë fushata Meta & Google Ads të targetuara për turistë vendas dhe ndërkombëtarë. Monitorojmë, optimizojmë, raportojmë çdo javë.', icon: BarChart3 },
];

const TESTIMONIALS = [
  {
    name: 'Petrit Domi',
    role: 'Pronar, Agroturizëm Domi — Berat',
    quote: 'Fotot e bëra nga ekipi i tyre na kanë ndryshuar imazhin krejtësisht. Mysafirët na thonë "ju pashë në Instagram dhe nuk mund të mos vija". Sezoni 2026 është i rezervuar 80% qysh në Maj.',
    rating: 5,
    avatar: 'PD',
  },
  {
    name: 'Albana Krasniqi',
    role: 'Menaxhere, Bujtinë Krasniqi — Theth',
    quote: 'Brenda 4 muajsh, rezervimet nga turistët e huaj u rritën 3-fish. Google na rendit në faqen e parë për "agroturizëm Theth". Investimi më i mirë që kemi bërë ndonjëherë.',
    rating: 5,
    avatar: 'AK',
  },
  {
    name: 'Bardhyl Hoxha',
    role: 'Pronar, Estate Vinifikimi Cobo — Berat',
    quote: '2 fotoshooting në muaj është shumë. Kemi material për reels, postime, broshura, website. Brand-i ynë duket si i një resort 5-yje, megjithëse jemi ferma familjare.',
    rating: 5,
    avatar: 'BH',
  },
];

const FAQ = [
  {
    q: 'Çfarë përfshihet vërtet në "2 fotoshooting / muaj"?',
    a: 'Çdo muaj ekipi ynë vjen dy ditë në fermën tuaj. Bëjmë foto profesionale të ambientit, dhomave, restorantit, aktiviteteve, ushqimit dhe peizazheve. Pas editimit, ju merrni 60–120 foto premium me të drejta të plota përdorimi — për website, social media, broshura ose reklama. Stagionet ndryshojnë: pranverë, verë, vjeshtë — kemi material për çdo sezon.',
  },
  {
    q: 'A vijnë në fermë edhe nëse jemi në fshat të largët?',
    a: 'Po. Punojmë me agroturizme në të gjithë Shqipërinë — Theth, Valbonë, Berat, Përmet, Korçë, Lezhë e gjetkë. Transporti i ekipit përfshihet në paketë për distancat normale. Për zona shumë të largëta, mund të ketë shtesë të vogël transporti që ju njoftohet paraprakisht.',
  },
  {
    q: 'Çfarë ndryshimi ka mes Starter, Growth dhe Pro?',
    a: 'Të treja kanë 2 fotoshooting / muaj. Starter është për ferma të vogla familjare që duan praninë online. Growth shton Meta Ads, më shumë postime dhe sezone të plota fotoshooting. Pro shton video drone aerial, kinemati, fushata Google Ads, përmbajtje multilingual dhe targetim ndërkombëtar.',
  },
  {
    q: 'Sa kohë duhet për të parë rezultate?',
    a: 'Social Media dhe fotot profesionale ndikojnë menjëherë në besueshmëri dhe rezervime. Meta Ads japin rezultate brenda 1–2 javëve. SEO dhe rankimet organike Google ndërtohen brenda 3–6 muajve, varësisht konkurrencës. Sezonin tuaj të parë me ne, prisni rritje 40–80% të rezervimeve.',
  },
  {
    q: 'A flisni gjuhë të huaja për turistët ndërkombëtarë?',
    a: 'Po. Në paketat Growth dhe Pro përfshihet copywriting në anglisht. Pro shton edhe italisht (turisti më i shpeshtë në Shqipëri). Përkthime në gjuhë të tjera ofrohen si shtesë.',
  },
  {
    q: 'A keni kontratë afatgjatë?',
    a: 'Jo. Punojmë me pagesa mujore pa kontratë afatgjatë. Mund ta ndërpresni në çdo kohë me njoftim 7 ditë para. Megjithatë, rekomandojmë minimum 3 muaj për të parë rezultate të vërteta sezonale.',
  },
  {
    q: 'A mund ta ndryshoj paketin gjatë sezonit?',
    a: 'Po. Mund të upgrade-oni në çdo kohë (p.sh. nga Starter në Growth para sezonit të verës). Downgrade lejohet me njoftim 7 ditë para fillimit të muajit të ri.',
  },
];

/* ═══════════════════════════════════════════════════════════════════════ */

export default function AgroturizemLandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', website: '', message: '' });
  const [formSent, setFormSent] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<AgroPackage | null>(null);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const scrollToPackages = () => document.getElementById('packages')?.scrollIntoView({ behavior: 'smooth' });
  const scrollToContact = (pkg?: AgroPackage) => {
    if (pkg) setSelectedPackage(pkg);
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
        body: JSON.stringify({
          ...formData,
          packageId: selectedPackage?.id || 'growth',
          packageName: selectedPackage ? `Agroturizëm ${selectedPackage.title}` : 'Agroturizëm Growth',
          source: 'Agroturizëm Landing Page',
          category: 'SEO + Social Media - Agroturizëm',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Diçka shkoi keq');
      setFormSent(true);
    } catch (err: any) {
      setFormError(err.message || 'Diçka shkoi keq. Provoni përsëri.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans overflow-x-hidden">

      {/* ═══ NAV ═══ */}
      <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-emerald-600 flex items-center justify-center">
              <Trees className="w-4 h-4 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-amber-600 to-emerald-700 bg-clip-text text-transparent">
              FivoCRM Agroturizëm
            </span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
            <a href="#results" className="hover:text-emerald-600 transition-colors">Rezultatet</a>
            <a href="#process" className="hover:text-emerald-600 transition-colors">Procesi</a>
            <a href="#packages" className="hover:text-emerald-600 transition-colors">Paketat</a>
            <a href="#testimonials" className="hover:text-emerald-600 transition-colors">Dëshmitë</a>
            <a href="#faq" className="hover:text-emerald-600 transition-colors">FAQ</a>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="hidden sm:inline-flex text-sm font-medium text-gray-600 hover:text-emerald-600 transition-colors">
              Hyr
            </Link>
            <button
              onClick={() => scrollToContact()}
              className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-amber-500 to-emerald-600 hover:shadow-lg hover:shadow-emerald-500/25 transition-all duration-300 hover:-translate-y-0.5"
            >
              Fillo Tani
            </button>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-amber-50/60 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[700px] h-[700px] bg-amber-200/25 rounded-full blur-3xl" />
        <div className="absolute top-40 right-0 w-[350px] h-[350px] bg-emerald-200/25 rounded-full blur-3xl" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-100 mb-8">
                <div className="flex -space-x-2">
                  {['PD', 'AK', 'BH', 'EK'].map((initials, i) => (
                    <div key={i} className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-emerald-500 border-2 border-white flex items-center justify-center text-[10px] font-bold text-white">
                      {initials}
                    </div>
                  ))}
                </div>
                <span className="text-sm font-medium text-emerald-700">
                  85+ agroturizme na besojnë
                </span>
                <div className="flex">
                  {[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}
                </div>
              </div>
            </FadeIn>

            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                Agroturizmi yt meriton{' '}
                <span className="relative">
                  <span className="bg-gradient-to-r from-amber-500 via-emerald-500 to-green-600 bg-clip-text text-transparent">
                    dhoma të plota
                  </span>
                  <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 300 12" fill="none">
                    <path d="M2 8 C60 2, 120 2, 150 6 S240 10, 298 4" stroke="url(#agro-underline)" strokeWidth="3" strokeLinecap="round" />
                    <defs><linearGradient id="agro-underline" x1="0" y1="0" x2="300" y2="0"><stop offset="0%" stopColor="#d97706"/><stop offset="100%" stopColor="#059669"/></linearGradient></defs>
                  </svg>
                </span>
                {' '}gjatë gjithë sezonit.
                <br />
                <span className="text-gray-400">Po ndodh kjo te ti?</span>
              </h1>
            </FadeIn>

            <FadeIn delay={200}>
              <p className="mt-8 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
                Turistët kërkojnë <strong className="text-gray-900">"agroturizëm Shqipëri"</strong> çdo ditë në Google dhe Instagram.
                Pa foto profesionale dhe pa SEO,{' '}
                <strong className="text-emerald-600">ata po zgjedhin fermat e tjera.</strong>
              </p>
            </FadeIn>

            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button
                  onClick={scrollToPackages}
                  className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-amber-500 to-emerald-600 hover:shadow-xl hover:shadow-emerald-500/25 transition-all duration-300 hover:-translate-y-1 flex items-center justify-center gap-2"
                >
                  Shiko Paketat
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
                <button
                  onClick={() => scrollToContact()}
                  className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border-2 border-gray-200 hover:border-emerald-300 hover:bg-emerald-50 transition-all duration-300 flex items-center justify-center gap-2"
                >
                  <Phone className="w-5 h-5" />
                  Konsultim Falas
                </button>
              </div>
            </FadeIn>

            <FadeIn delay={400}>
              <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-400">
                <span className="flex items-center gap-1.5"><Camera className="w-4 h-4 text-amber-500" /> 2 fotoshooting / muaj</span>
                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-500" /> Pa kontratë afatgjatë</span>
                <span className="flex items-center gap-1.5"><Sun className="w-4 h-4 text-amber-500" /> SEO + Social Media në një</span>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ PAIN POINTS ═══ */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-red-500 mb-3">A e njeh këtë situatë?</p>
              <h2 className="text-3xl sm:text-4xl font-bold">
                Sezoni po kalon — <span className="text-red-500">dhoma janë bosh</span>
              </h2>
            </div>
          </FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {PAIN_POINTS.map((point, i) => (
              <FadeIn key={i} delay={i * 150}>
                <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 hover:shadow-lg hover:border-red-100 transition-all duration-300 h-full">
                  <div className="w-14 h-14 rounded-xl bg-red-50 flex items-center justify-center mb-6">
                    <point.icon className="w-7 h-7 text-red-500" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">{point.title}</h3>
                  <p className="text-gray-600 leading-relaxed">{point.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
          <FadeIn delay={500}>
            <div className="mt-12 text-center">
              <p className="text-lg text-gray-700 font-medium">
                Ndërkohë, agroturizmet me marketing profesional{' '}
                <span className="text-emerald-600 font-bold">i mbushin dhomat 3 muaj para sezonit.</span>
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══ RESULTS ═══ */}
      <section id="results" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Rezultatet tona</p>
              <h2 className="text-3xl sm:text-4xl font-bold">
                Numrat flasin <span className="bg-gradient-to-r from-amber-600 to-emerald-700 bg-clip-text text-transparent">vetë</span>
              </h2>
            </div>
          </FadeIn>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {RESULTS.map((r, i) => (
              <FadeIn key={i} delay={i * 100}>
                <div className="text-center p-8 rounded-2xl bg-gradient-to-br from-amber-50 to-emerald-50 border border-emerald-100">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-emerald-600 flex items-center justify-center mx-auto mb-4">
                    <r.icon className="w-6 h-6 text-white" />
                  </div>
                  <div className="text-4xl font-bold text-emerald-700 mb-2">
                    <Counter end={parseFloat(r.metric)} suffix={r.suffix} />
                  </div>
                  <p className="text-sm text-gray-600 leading-tight">{r.label}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PROCESS ═══ */}
      <section id="process" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Si punojmë</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Procesi ynë <span className="bg-gradient-to-r from-amber-600 to-emerald-700 bg-clip-text text-transparent">i provuar</span></h2>
            </div>
          </FadeIn>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {PROCESS_STEPS.map((step, i) => (
              <FadeIn key={i} delay={i * 150}>
                <div className="relative bg-white rounded-2xl p-8 shadow-sm border border-gray-100 hover:shadow-lg hover:border-emerald-200 transition-all duration-300 h-full">
                  <div className="text-6xl font-black text-amber-100 mb-4">{step.step}</div>
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-emerald-600 flex items-center justify-center mb-4">
                    <step.icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-lg font-bold mb-2">{step.title}</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">{step.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PACKAGES ═══ */}
      <section id="packages" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-4">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Çmimet tona</p>
              <h2 className="text-3xl sm:text-4xl font-bold">
                Zgjidhni paketën <span className="bg-gradient-to-r from-amber-600 to-emerald-700 bg-clip-text text-transparent">e duhur</span>
              </h2>
              <p className="mt-4 text-gray-500 max-w-xl mx-auto">
                Të 3 paketat përfshijnë <strong className="text-emerald-700">2 fotoshooting profesionale çdo muaj</strong> · Pa kontratë afatgjatë · Ad spend i veçantë
              </p>
            </div>
          </FadeIn>

          <div className="grid lg:grid-cols-3 gap-6 mt-12">
            {PACKAGES.map((pkg, i) => {
              const isExpanded = expandedCard === pkg.id;
              return (
                <FadeIn key={pkg.id} delay={i * 150}>
                  <div className={`relative rounded-2xl border-2 transition-all duration-300 flex flex-col h-full ${pkg.border} ${pkg.popular ? 'shadow-2xl shadow-emerald-500/20 scale-[1.02]' : 'shadow-sm hover:shadow-xl'}`}>
                    {pkg.popular && (
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10">
                        <span className="px-5 py-1.5 rounded-full text-sm font-bold text-white bg-gradient-to-r from-emerald-500 to-green-600 shadow-lg shadow-emerald-500/30">
                          ⭐ {pkg.badge}
                        </span>
                      </div>
                    )}
                    {!pkg.popular && pkg.badge && (
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10">
                        <span className="px-5 py-1.5 rounded-full text-sm font-bold text-white bg-gradient-to-r from-amber-600 to-emerald-700 shadow-lg">
                          {pkg.badge}
                        </span>
                      </div>
                    )}

                    {/* Header */}
                    <div className={`${pkg.headerBg} rounded-t-2xl p-6 pt-8`}>
                      <h3 className="text-2xl font-bold text-gray-900">{pkg.title}</h3>
                      <p className="text-sm text-gray-600 mt-1">{pkg.subtitle}</p>
                      <div className="mt-4 flex items-end gap-2">
                        <span className={`text-4xl font-black bg-gradient-to-r ${pkg.color} bg-clip-text text-transparent`}>
                          {pkg.price}
                        </span>
                        {pkg.originalPrice && (
                          <span className="text-xl font-medium text-gray-400 line-through mb-1">{pkg.originalPrice}</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mt-1">{pkg.priceNote}</p>
                      {pkg.originalPrice && (
                        <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 border border-emerald-200">
                          <span className="text-xs font-bold text-emerald-700">🎁 Kurseni 200€/muaj</span>
                        </div>
                      )}
                    </div>

                    {/* Highlight: 2 fotoshooting */}
                    <div className="px-6 py-3 bg-amber-50 border-y border-amber-100">
                      <p className="text-sm font-bold text-amber-800 flex items-center gap-2">
                        <Camera className="w-4 h-4" />
                        2 Fotoshooting Profesionale / Muaj
                      </p>
                    </div>

                    {/* Target audience */}
                    <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Ideal për:</p>
                      <ul className="space-y-1">
                        {pkg.targetAudience.map((t, idx) => (
                          <li key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Features */}
                    <div className="flex-1 px-6 py-5 space-y-5">
                      {(isExpanded ? pkg.features : pkg.features.slice(0, 2)).map((cat, ci) => (
                        <div key={ci}>
                          <p className={`text-xs font-bold uppercase tracking-wide mb-2 bg-gradient-to-r ${pkg.color} bg-clip-text text-transparent`}>
                            {cat.category}
                          </p>
                          <ul className="space-y-1.5">
                            {cat.items.map((item, ii) => (
                              <li key={ii} className="flex items-start gap-2 text-sm text-gray-700">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}

                      {pkg.features.length > 2 && (
                        <button
                          onClick={() => setExpandedCard(isExpanded ? null : pkg.id)}
                          className="text-sm text-emerald-600 font-medium flex items-center gap-1 hover:text-emerald-700"
                        >
                          <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          {isExpanded ? 'Shfaq më pak' : `+ ${pkg.features.length - 2} kategori tjera`}
                        </button>
                      )}

                      {pkg.notIncluded.length > 0 && (
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">Nuk përfshihet:</p>
                          <ul className="space-y-1.5">
                            {pkg.notIncluded.map((item, ii) => (
                              <li key={ii} className="flex items-start gap-2 text-sm text-gray-400">
                                <X className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {/* CTA */}
                    <div className="px-6 pb-6">
                      <button
                        onClick={() => scrollToContact(pkg)}
                        className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all duration-300 flex items-center justify-center gap-2 ${
                          pkg.popular
                            ? `text-white bg-gradient-to-r ${pkg.color} hover:shadow-lg hover:shadow-emerald-500/25 hover:-translate-y-0.5`
                            : 'text-gray-700 bg-gray-100 hover:bg-gray-200'
                        }`}
                      >
                        {pkg.cta}
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>

          {/* Photoshoot callout */}
          <FadeIn delay={400}>
            <div className="mt-10 max-w-3xl mx-auto text-center p-6 rounded-2xl bg-gradient-to-r from-amber-50 to-emerald-50 border border-amber-200">
              <p className="text-emerald-800 font-semibold flex items-center justify-center gap-2 flex-wrap">
                <Camera className="w-5 h-5 text-amber-600" />
                Të 3 paketat përfshijnë <strong className="text-amber-700">2 ditë fotoshooting profesionale çdo muaj</strong> — ambient, dhoma, restorant, aktivitete & peizazhe.
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══ ADD-ONS ═══ */}
      <section id="addons" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-12">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Shtesa</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Shërbime <span className="bg-gradient-to-r from-amber-600 to-emerald-700 bg-clip-text text-transparent">shtesë</span></h2>
              <p className="mt-3 text-gray-500">Mund t'i shtoni çdo muaj sipas nevojës suaj</p>
            </div>
          </FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {ADD_ONS.map((addon, i) => (
              <FadeIn key={i} delay={i * 80}>
                <div className="bg-white rounded-2xl p-6 border border-gray-100 hover:border-emerald-200 hover:shadow-lg transition-all duration-300 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                    <addon.icon className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{addon.name}</p>
                    <p className="text-sm text-emerald-600 font-medium mt-0.5">{addon.price}</p>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ TESTIMONIALS ═══ */}
      <section id="testimonials" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Dëshmitë</p>
              <h2 className="text-3xl sm:text-4xl font-bold">
                Çfarë thonë <span className="bg-gradient-to-r from-amber-600 to-emerald-700 bg-clip-text text-transparent">klientët tanë</span>
              </h2>
            </div>
          </FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {TESTIMONIALS.map((t, i) => (
              <FadeIn key={i} delay={i * 150}>
                <div className="bg-gradient-to-br from-amber-50 to-emerald-50 rounded-2xl p-8 border border-emerald-100 hover:shadow-lg hover:border-emerald-200 transition-all duration-300 h-full flex flex-col">
                  <div className="flex mb-4">
                    {Array.from({ length: t.rating }).map((_, j) => (
                      <Star key={j} className="w-5 h-5 text-amber-400 fill-amber-400" />
                    ))}
                  </div>
                  <p className="text-gray-700 leading-relaxed flex-1 italic">"{t.quote}"</p>
                  <div className="mt-6 flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-amber-500 to-emerald-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                      {t.avatar}
                    </div>
                    <div>
                      <p className="font-bold text-gray-900">{t.name}</p>
                      <p className="text-sm text-gray-500">{t.role}</p>
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="py-20 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Pyetje të shpeshta</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Keni <span className="bg-gradient-to-r from-amber-600 to-emerald-700 bg-clip-text text-transparent">pyetje?</span></h2>
            </div>
          </FadeIn>
          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <FadeIn key={i} delay={i * 60}>
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden hover:border-emerald-200 transition-colors">
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full px-6 py-5 flex items-center justify-between text-left"
                  >
                    <span className="font-semibold text-gray-900 pr-4">{item.q}</span>
                    <ChevronDown className={`w-5 h-5 text-emerald-500 flex-shrink-0 transition-transform duration-300 ${openFaq === i ? 'rotate-180' : ''}`} />
                  </button>
                  {openFaq === i && (
                    <div className="px-6 pb-5">
                      <p className="text-gray-600 leading-relaxed">{item.a}</p>
                    </div>
                  )}
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ CONTACT ═══ */}
      <section id="contact" className="py-20 bg-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6">
          <FadeIn>
            <div className="text-center mb-12">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Na kontaktoni</p>
              <h2 className="text-3xl sm:text-4xl font-bold">
                Filloni{' '}
                <span className="bg-gradient-to-r from-amber-600 to-emerald-700 bg-clip-text text-transparent">sot</span>
              </h2>
              <p className="mt-4 text-gray-500">Konsultimi i parë është falas. Nuk kemi kontratë afatgjatë.</p>
            </div>
          </FadeIn>

          {selectedPackage && (
            <FadeIn>
              <div className={`mb-6 p-4 rounded-xl bg-gradient-to-r from-amber-50 to-emerald-50 border border-emerald-200 flex items-center justify-between`}>
                <div>
                  <p className="text-sm text-gray-500">Paketa e zgjedhur:</p>
                  <p className="font-bold text-emerald-700">
                    {selectedPackage.title} — {selectedPackage.price}
                    {selectedPackage.originalPrice && <span className="text-gray-400 line-through ml-2 font-normal">{selectedPackage.originalPrice}</span>}
                  </p>
                </div>
                <button onClick={() => setSelectedPackage(null)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </FadeIn>
          )}

          {formSent ? (
            <FadeIn>
              <div className="text-center p-12 rounded-2xl bg-gradient-to-br from-amber-50 to-emerald-50 border border-emerald-200">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-500 to-emerald-600 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/30">
                  <CheckCircle2 className="w-10 h-10 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-3">Faleminderit! 🌾</h3>
                <p className="text-gray-600 text-lg">E kemi marrë kërkesën tuaj. Do t'ju kontaktojmë brenda 24 orëve për konsultimin falas.</p>
              </div>
            </FadeIn>
          ) : (
            <FadeIn>
              <form onSubmit={handleSubmit} className="space-y-5 bg-gray-50 rounded-2xl p-8 border border-gray-100">
                <div className="grid sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Emri & Mbiemri *</label>
                    <input
                      type="text" required
                      value={formData.name}
                      onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                      placeholder="Emri juaj"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Email *</label>
                    <input
                      type="email" required
                      value={formData.email}
                      onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                      placeholder="email@juaj.com"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Numri i telefonit *</label>
                    <input
                      type="tel" required
                      value={formData.phone}
                      onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))}
                      placeholder="+355 6X XXX XXXX"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Website / Instagram</label>
                    <input
                      type="text"
                      value={formData.website}
                      onChange={e => setFormData(p => ({ ...p, website: e.target.value }))}
                      placeholder="website.com ose @instagram"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Mesazhi (opsionale)</label>
                  <textarea
                    rows={4}
                    value={formData.message}
                    onChange={e => setFormData(p => ({ ...p, message: e.target.value }))}
                    placeholder="Tregoni pak për fermën tuaj, shërbimet, kapacitetin & objektivat..."
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all resize-none"
                  />
                </div>

                {formError && (
                  <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{formError}</div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-4 px-8 rounded-xl font-semibold text-white bg-gradient-to-r from-amber-500 to-emerald-600 hover:shadow-xl hover:shadow-emerald-500/25 transition-all duration-300 hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-lg"
                >
                  {submitting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Duke dërguar...
                    </>
                  ) : (
                    <>
                      Kërko Konsultim Falas
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>

                <p className="text-center text-xs text-gray-400">
                  <Shield className="w-3.5 h-3.5 inline mr-1" />
                  Pa kontratë afatgjatë · Pa spam · Do t'ju kontaktojmë brenda 24 orëve
                </p>
              </form>
            </FadeIn>
          )}
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="py-10 bg-gray-900 text-gray-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-emerald-600 flex items-center justify-center">
                <Trees className="w-4 h-4 text-white" />
              </div>
              <span className="text-white font-bold">FivoCRM Agroturizëm</span>
            </div>
            <p className="text-sm">© {new Date().getFullYear()} FivoCRM. Të gjitha të drejtat e rezervuara.</p>
            <div className="flex items-center gap-4 text-sm">
              <Link to="/login" className="hover:text-white transition-colors">Hyr</Link>
              <a href="#contact" className="hover:text-white transition-colors">Kontakt</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
