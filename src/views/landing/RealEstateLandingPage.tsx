import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, TrendingUp, Shield, Zap, CheckCircle2, ArrowRight,
  Star, Users, Target, Clock, ChevronDown, Phone,
  ArrowUpRight, Sparkles, Camera, Instagram, Megaphone, BarChart3,
  X, Lock, Video, Image, Plane,
} from 'lucide-react';

/* ─── Intersection Observer hook for scroll animations ─── */
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

/* ─── Animated counter ─── */
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

/* ═══════════════════════════════════════════════════════════════════════
   Real Estate Social Media Packages
   ═══════════════════════════════════════════════════════════════════════ */

interface RealEstatePackage {
  id: string;
  title: string;
  subtitle: string;
  price: string;
  priceNote: string;
  targetAudience: string[];
  features: { category: string; items: string[] }[];
  notIncluded: string[];
  popular?: boolean;
  badge?: string;
  color: string;
  border: string;
  cta: string;
}

const PACKAGES: RealEstatePackage[] = [
  {
    id: 'starter',
    title: 'Starter',
    subtitle: 'Prezencë profesionale dhe aktivitet i rregullt',
    price: '700€',
    priceNote: '/ muaj + ad spend',
    targetAudience: [
      'Agjentë individualë',
      'Agjenci të vogla',
      'Klientë që duan prezencë profesionale',
    ],
    features: [
      {
        category: 'Përmbajtja & Menaxhimi',
        items: [
          'Menaxhim i 2 platformave (Facebook + Instagram)',
          '12 postime / muaj',
          '2 reels / muaj',
          'Design grafik për postimet',
          'Copywriting për përshkrimet',
          'Publikim sipas kalendarit',
          '1 content session / muaj',
          'Menaxhim bazë i faqes',
          'Raport mujor bazë',
        ],
      },
      {
        category: 'Ads & Reklama',
        items: [
          'Setup bazë i fushatave',
          'Menaxhim bazë i reklamave',
          'Optimizim i thjeshtë',
        ],
      },
    ],
    notIncluded: [
      'Buxheti i reklamave',
      'Drone',
      'Xhirime të shumta pronash',
      'Community management i avancuar',
      'Landing page / website changes',
    ],
    color: 'from-sky-500 to-blue-600',
    border: 'border-sky-200 hover:border-sky-400',
    cta: 'Fillo me Starter',
  },
  {
    id: 'growth',
    title: 'Growth',
    subtitle: 'Jo vetëm prezencë — por edhe lead-e',
    price: '1,100€',
    priceNote: '/ muaj + ad spend',
    popular: true,
    badge: 'Më i Popullarizuari',
    targetAudience: [
      'Agjenci që duan më shumë volum',
      'Klientë që duan lead generation',
    ],
    features: [
      {
        category: 'Përmbajtja & Menaxhimi',
        items: [
          'Menaxhim i 2 platformave',
          '16 postime / muaj',
          '4 reels / muaj',
          'Design grafik',
          'Copywriting',
          'Publikim sipas kalendarit',
          '1 ditë xhirimi / muaj',
          'Përmbajtje për prona + brand content',
          'Menaxhim bazë i komenteve dhe inbox-it',
          'Raport mujor performance',
        ],
      },
      {
        category: 'Ads & Reklama',
        items: [
          'Menaxhim i plotë i Meta Ads',
          'Krijim fushatash',
          'Testim kreativësh',
          'Audience targeting',
          'Optimizim javor',
          'Raportim i rezultateve',
        ],
      },
    ],
    notIncluded: [
      'Buxheti i reklamave',
      'Drone i përfshirë rregullisht',
      'Xhirime shtesë jashtë ditës mujore',
      'Foto/video për volum të lartë pronash',
    ],
    color: 'from-emerald-500 to-teal-600',
    border: 'border-emerald-200 hover:border-emerald-400',
    cta: 'Zgjidh Growth',
  },
  {
    id: 'pro',
    title: 'Pro',
    subtitle: 'Prezencë e fortë dhe lead generation agresive',
    price: '1,600€',
    priceNote: '/ muaj + ad spend',
    badge: 'Maksimum Rezultate',
    targetAudience: [
      'Agjenci serioze',
      'Kompani me disa prona aktive',
      'Klientë që duan lead generation agresive',
    ],
    features: [
      {
        category: 'Përmbajtja & Menaxhimi',
        items: [
          'Menaxhim i 2–3 platformave',
          '20 postime / muaj',
          '6–8 reels / muaj',
          'Design grafik premium',
          'Copywriting i avancuar',
          'Publikim dhe planifikim mujor',
          '2 ditë xhirimi / muaj',
          'Foto + video për prona',
          'Content për brand personal / agjentë',
          'Community management aktiv',
          'Raportim i detajuar mujor',
        ],
      },
      {
        category: 'Ads & Reklama',
        items: [
          'Menaxhim i plotë i Meta Ads',
          'Lead generation campaigns',
          'Retargeting',
          'Audience segmentation',
          'Testim i shumë kreativëve',
          'Optimizim i rregullt i performancës',
        ],
      },
    ],
    notIncluded: [
      'Buxheti i reklamave',
      'Produksion pa limit',
      'Drone në çdo xhirim',
      'Landing pages / website development',
      'Event coverage ose launch campaigns të veçanta',
    ],
    color: 'from-amber-500 to-orange-600',
    border: 'border-amber-200 hover:border-amber-400',
    cta: 'Zgjidh Pro',
  },
  {
    id: 'custom',
    title: 'Custom',
    subtitle: 'Zgjidhje e plotë sipas nevojave tuaja',
    price: 'Sipas kërkesës',
    priceNote: '',
    targetAudience: [
      'Developer-a',
      'Kompani me shumë projekte',
      'Volum të lartë pronash',
      'Nevoja të veçanta',
    ],
    features: [
      {
        category: 'Mund të përfshijë',
        items: [
          'Më shumë platforma sociale',
          'Më shumë xhirime mujore',
          'Drone profesionale',
          'Video tour profesionale',
          'Launch campaigns',
          'Event coverage',
          'Ads me buxhet të lartë',
          'Strategji e personalizuar mujore',
        ],
      },
    ],
    notIncluded: [],
    color: 'from-purple-600 to-indigo-600',
    border: 'border-purple-200 hover:border-purple-400',
    cta: 'Na Kontaktoni',
  },
];

const ADD_ONS = [
  { name: 'Reel shtesë', price: '50€ – 80€', icon: Video },
  { name: 'Xhirim shtesë prone', price: '150€ – 250€', icon: Camera },
  { name: 'Ditë ekstra xhirimi', price: '200€ – 350€', icon: Image },
  { name: 'Drone add-on', price: '100€ – 150€', icon: Plane },
  { name: 'Foto shtesë prone', price: '80€ – 150€', icon: Camera },
  { name: 'Montazh i avancuar / urgent', price: 'Sipas kërkesës', icon: Zap },
];

const RESULTS = [
  { metric: '250', suffix: '+', label: 'Prona të promovuara me sukses', icon: Building2 },
  { metric: '85', suffix: '%', label: 'Klientë që marrin lead brenda muajit', icon: Target },
  { metric: '3.2', suffix: 'x', label: 'Rritje e interesimit të blerësve', icon: TrendingUp },
  { metric: '120', suffix: '+', label: 'Agjenci dhe agjentë të kënaqur', icon: Users },
];

const PAIN_POINTS = [
  {
    icon: Instagram,
    title: 'Rrjetet sociale pa strategji',
    desc: 'Postoni prona pa plan, pa design profesional, pa copy bindës — dhe pyesni pse nuk ka interesim.',
  },
  {
    icon: Megaphone,
    title: 'Reklama që djegin buxhetin',
    desc: 'Krijoni reklama pa targeting të saktë, pa testim kreativësh — dhe humbisni para çdo ditë pa rezultate.',
  },
  {
    icon: Clock,
    title: 'Koha po shkon, pronat po qëndrojnë',
    desc: 'Sa më shumë qëndron një pronë e pashitur, aq më shumë humbni mundësi të reja. Tregu nuk pret.',
  },
];

const PROCESS_STEPS = [
  { step: '01', title: 'Analiza & Strategjia', desc: 'Analizojmë pronat, targetin, dhe konkurrencën tuaj. Krijojmë strategji të tailored.', icon: Target },
  { step: '02', title: 'Krijim Përmbajtjeje', desc: 'Xhirime profesionale, design grafik, copywriting bindës — gjithçka e gatshme.', icon: Camera },
  { step: '03', title: 'Publikim & Ads', desc: 'Publikojmë sipas kalendarit dhe lançojmë fushata reklamash me targeting të saktë.', icon: Megaphone },
  { step: '04', title: 'Optimizim & Raportim', desc: 'Monitorojmë rezultatet javor, optimizojmë fushatat, raportojmë performancën.', icon: BarChart3 },
];

const TESTIMONIALS = [
  {
    name: 'Andi Shehu',
    role: 'Drejtor, Elite Properties',
    quote: 'Brenda 2 muajve filluan të vijnë lead-e serioze. Prezenca jonë në Instagram u transformua komplet — klientë na gjejnë vetë tani.',
    rating: 5,
    avatar: 'AS',
  },
  {
    name: 'Gentiana Rexhepi',
    role: 'Agjente, Prime Real Estate',
    quote: 'Reels-et që krijuan për pronat e mia kanë mijëra shikime. Klientët më kontaktojnë direkt nga Instagram — ROI fantastik.',
    rating: 5,
    avatar: 'GR',
  },
  {
    name: 'Blerim Koci',
    role: 'CEO, Tirana Invest Group',
    quote: 'Kemi provuar disa agjenci marketingu — askush si këta. Strategjia, ekzekutimi, dhe raportet janë në nivel tjetër.',
    rating: 5,
    avatar: 'BK',
  },
];

const FAQ = [
  {
    q: 'Çfarë përfshihet në buxhetin e reklamave (ad spend)?',
    a: 'Buxheti i reklamave (ad spend) paguhet direkt tek Meta (Facebook/Instagram) dhe nuk përfshihet në çmimin e paketës. Ne menaxhojmë se si shpenzohet, por shuma është e veçantë. Zakonisht rekomandojmë 300€–1,000€/muaj varësisht nga objektivat.',
  },
  {
    q: 'Sa kohë duhet për të parë rezultate?',
    a: 'Prezenca profesionale ndikon menjëherë. Për lead generation përmes reklamave, rezultatet e para vijnë zakonisht brenda 2–4 javëve. Strategjia e plotë ndërtohet brenda 2–3 muajve.',
  },
  {
    q: 'A mund ta ndryshoj paketin gjatë rrugës?',
    a: 'Po, absolutisht. Mund të upgrade-oni ose ndryshoni paketin çdo muaj. Na njoftoni 7 ditë para rifillimit të muajit.',
  },
  {
    q: 'A bëni xhirime me drone?',
    a: 'Drone nuk përfshihet si standard në paketat Starter dhe Growth, por mund të shtohet si add-on (100€–150€ per xhirim). Në paketin Custom përfshihet sipas nevojave.',
  },
  {
    q: 'Sa prona mund të promovohen në muaj?',
    a: 'Varet nga paketa. Starter mbulon aktivitet të përgjithshëm, Growth përfshin 1 ditë xhirimi dedikuar pronave, ndërsa Pro ka 2 ditë xhirimi. Për volum të lartë, paketa Custom është zgjidhja ideale.',
  },
];

/* ═══════════════════════════════════════════════════════════════════════ */

export default function RealEstateLandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', website: '', message: '' });
  const [formSent, setFormSent] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<RealEstatePackage | null>(null);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const scrollToPackages = () => {
    document.getElementById('packages')?.scrollIntoView({ behavior: 'smooth' });
  };
  const scrollToContact = (pkg?: RealEstatePackage) => {
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
          packageId: selectedPackage?.id || '',
          packageName: selectedPackage ? `Real Estate ${selectedPackage.title}` : '',
          source: 'Real Estate Landing Page',
          category: 'Social Media - Real Estate',
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
      {/* ═══ STICKY NAV ═══ */}
      <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
              FivoCRM Real Estate
            </span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
            <a href="#results" className="hover:text-emerald-600 transition-colors">Rezultatet</a>
            <a href="#process" className="hover:text-emerald-600 transition-colors">Procesi</a>
            <a href="#packages" className="hover:text-emerald-600 transition-colors">Paketat</a>
            <a href="#addons" className="hover:text-emerald-600 transition-colors">Shtesa</a>
            <a href="#testimonials" className="hover:text-emerald-600 transition-colors">Dëshmitë</a>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="hidden sm:inline-flex text-sm font-medium text-gray-600 hover:text-emerald-600 transition-colors"
            >
              Hyr
            </Link>
            <button
              onClick={() => scrollToContact()}
              className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:shadow-lg hover:shadow-emerald-500/25 transition-all duration-300 hover:-translate-y-0.5"
            >
              Fillo Tani
            </button>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-50/80 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-emerald-200/30 rounded-full blur-3xl" />
        <div className="absolute top-40 right-0 w-[400px] h-[400px] bg-teal-200/20 rounded-full blur-3xl" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-100 mb-8">
                <div className="flex -space-x-2">
                  {['AS', 'GR', 'BK', 'EL'].map((initials, i) => (
                    <div key={i} className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 border-2 border-white flex items-center justify-center text-[10px] font-bold text-white">
                      {initials}
                    </div>
                  ))}
                </div>
                <span className="text-sm font-medium text-emerald-700">
                  120+ agjenci na besojnë
                </span>
                <div className="flex">
                  {[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}
                </div>
              </div>
            </FadeIn>

            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                Pronat tuaja meritojnë{' '}
                <span className="relative">
                  <span className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 bg-clip-text text-transparent">
                    vëmendje
                  </span>
                  <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 300 12" fill="none">
                    <path d="M2 8 C60 2, 120 2, 150 6 S240 10, 298 4" stroke="url(#re-underline)" strokeWidth="3" strokeLinecap="round" />
                    <defs><linearGradient id="re-underline" x1="0" y1="0" x2="300" y2="0"><stop offset="0%" stopColor="#059669"/><stop offset="100%" stopColor="#0891b2"/></linearGradient></defs>
                  </svg>
                </span>
                {' '}në social media.
                <br />
                <span className="text-gray-400">A po e marrin atë?</span>
              </h1>
            </FadeIn>

            <FadeIn delay={200}>
              <p className="mt-8 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
                Çdo ditë, <strong className="text-gray-900">mijëra blerës potencialë</strong> shfletojnë Instagram dhe Facebook duke kërkuar pronën e ëndrrave.
                Pa një prezencë profesionale,{' '}
                <strong className="text-emerald-600">ata po zgjedhin konkurrentët tuaj.</strong>
              </p>
            </FadeIn>

            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button
                  onClick={scrollToPackages}
                  className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:shadow-xl hover:shadow-emerald-500/25 transition-all duration-300 hover:-translate-y-1 flex items-center justify-center gap-2"
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
                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-500" /> Pa kontratë afatgjatë</span>
                <span className="flex items-center gap-1.5"><Lock className="w-4 h-4 text-blue-500" /> Ad spend i veçantë</span>
                <span className="flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-emerald-500" /> Rezultate brenda muajit</span>
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
                Pronat po qëndrojnë të pashitura <span className="text-red-500">pa nevojë</span>
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
                Lajmi i mirë? <span className="text-emerald-600 font-bold">Ne e dimë zgjidhjen.</span>
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══ RESULTS ═══ */}
      <section id="results" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Rezultate të vërteta</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Numrat flasin më shumë se fjalët</h2>
            </div>
          </FadeIn>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {RESULTS.map((r, i) => (
              <FadeIn key={i} delay={i * 100}>
                <div className="text-center p-8 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100">
                  <r.icon className="w-8 h-8 text-emerald-600 mx-auto mb-4" />
                  <div className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
                    <Counter end={parseFloat(r.metric)} suffix={r.suffix} />
                  </div>
                  <p className="mt-3 text-sm text-gray-600 font-medium">{r.label}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PROCESS ═══ */}
      <section id="process" className="py-24 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400 mb-3">Si funksionon</p>
              <h2 className="text-3xl sm:text-4xl font-bold">4 hapa për sukses në social media</h2>
              <p className="mt-4 text-gray-400 max-w-xl mx-auto">
                Procesi ynë i provuar që sjell rezultate për agjenci real estate
              </p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-4 gap-6 relative">
            <div className="hidden md:block absolute top-16 left-[12%] right-[12%] h-px bg-gradient-to-r from-emerald-500/50 via-teal-500/50 to-emerald-500/50" />

            {PROCESS_STEPS.map((s, i) => (
              <FadeIn key={i} delay={i * 150}>
                <div className="relative text-center p-6 rounded-2xl bg-gray-800/50 border border-gray-700 hover:border-emerald-500/50 transition-all duration-300 group">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center mx-auto mb-4 text-lg font-bold relative z-10">
                    {s.step}
                  </div>
                  <s.icon className="w-6 h-6 text-emerald-400 mx-auto mb-3 group-hover:scale-110 transition-transform" />
                  <h3 className="text-lg font-bold mb-2">{s.title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">{s.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PACKAGES ═══ */}
      <section id="packages" className="py-24 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Paketat Social Media</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Zgjidh paketin ideal për agjencine tënde</h2>
              <p className="mt-4 text-gray-600 max-w-2xl mx-auto">
                Çdo paketë përfshin strategji të personalizuar për real estate. Çmimet nuk përfshijnë buxhetin e reklamave (ad spend).
              </p>
            </div>
          </FadeIn>

          {/* Package Cards */}
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6 items-start">
            {PACKAGES.map((pkg, i) => {
              const isSelected = selectedPackage?.id === pkg.id;
              const isExpanded = expandedCard === pkg.id;
              return (
                <FadeIn key={pkg.id} delay={i * 120}>
                  <div className={`relative rounded-2xl bg-white border-2 ${pkg.border} transition-all duration-300 hover:shadow-2xl ${pkg.popular ? 'shadow-xl ring-2 ring-emerald-500/20' : 'shadow-sm'} ${isSelected ? 'ring-2 ring-green-500' : ''}`}>
                    {pkg.badge && (
                      <div className={`absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-gradient-to-r ${pkg.color} text-white text-xs font-bold tracking-wide whitespace-nowrap`}>
                        {pkg.badge}
                      </div>
                    )}
                    <div className="p-6">
                      {/* Header */}
                      <h3 className="text-2xl font-bold">{pkg.title}</h3>
                      <p className="text-sm text-gray-500 mt-1">{pkg.subtitle}</p>

                      {/* Price */}
                      <div className="mt-5">
                        <div className="flex items-baseline gap-1.5">
                          <span className={`text-3xl font-bold bg-gradient-to-r ${pkg.color} bg-clip-text text-transparent`}>
                            {pkg.price}
                          </span>
                          {pkg.priceNote && (
                            <span className="text-sm text-gray-500">{pkg.priceNote}</span>
                          )}
                        </div>
                      </div>

                      {/* Target audience */}
                      <div className="mt-4 p-3 rounded-lg bg-gray-50">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Për:</p>
                        <ul className="space-y-1">
                          {pkg.targetAudience.map((t, ti) => (
                            <li key={ti} className="text-xs text-gray-600 flex items-start gap-1.5">
                              <span className="text-emerald-500 mt-0.5">•</span>
                              {t}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Feature categories */}
                      <div className="mt-5 space-y-4">
                        {pkg.features.map((cat, ci) => (
                          <div key={ci}>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{cat.category}</p>
                            <ul className="space-y-2">
                              {(isExpanded ? cat.items : cat.items.slice(0, 4)).map((feature, fi) => (
                                <li key={fi} className="flex items-start gap-2 text-sm text-gray-700">
                                  <CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${pkg.popular ? 'text-emerald-500' : 'text-green-500'}`} />
                                  {feature}
                                </li>
                              ))}
                            </ul>
                            {!isExpanded && cat.items.length > 4 && (
                              <button
                                onClick={() => setExpandedCard(pkg.id)}
                                className="mt-2 text-xs text-emerald-600 font-medium hover:underline"
                              >
                                +{cat.items.length - 4} më shumë...
                              </button>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Expand/collapse toggle */}
                      {isExpanded && (
                        <button
                          onClick={() => setExpandedCard(null)}
                          className="mt-2 text-xs text-gray-400 hover:text-gray-600 font-medium"
                        >
                          Shfaq më pak
                        </button>
                      )}

                      {/* Not included */}
                      {pkg.notIncluded.length > 0 && isExpanded && (
                        <div className="mt-4 pt-4 border-t border-gray-100">
                          <p className="text-xs font-semibold uppercase tracking-wide text-red-400 mb-2">Nuk përfshihet:</p>
                          <ul className="space-y-1.5">
                            {pkg.notIncluded.map((item, ni) => (
                              <li key={ni} className="flex items-start gap-2 text-xs text-gray-500">
                                <X className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-red-300" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* CTA */}
                      <button
                        onClick={() => scrollToContact(pkg)}
                        className={`mt-6 w-full py-3.5 rounded-xl text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5 ${
                          pkg.popular
                            ? `bg-gradient-to-r ${pkg.color} text-white hover:shadow-lg hover:shadow-emerald-500/25`
                            : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                        }`}
                      >
                        {isSelected ? '✓ Zgjedhur' : pkg.cta}
                      </button>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>

          <FadeIn delay={500}>
            <p className="mt-10 text-center text-sm text-gray-500">
              Të gjitha çmimet janë në Euro (€). Buxheti i reklamave (ad spend) nuk përfshihet. TVSH nuk përfshihet. Faturim mujor.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ═══ ADD-ONS ═══ */}
      <section id="addons" className="py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-14">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Shtesa Extra</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Personalizo paketën tënde</h2>
              <p className="mt-4 text-gray-600 max-w-xl mx-auto">
                Shto shërbime ekstra sipas nevojave të projekteve tuaja specifike.
              </p>
            </div>
          </FadeIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {ADD_ONS.map((addon, i) => (
              <FadeIn key={i} delay={i * 80}>
                <div className="flex items-center gap-4 p-5 rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-md hover:border-emerald-100 transition-all duration-300">
                  <div className="w-11 h-11 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                    <addon.icon className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm">{addon.name}</p>
                    <p className="text-emerald-600 font-bold text-sm">{addon.price}</p>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ TESTIMONIALS ═══ */}
      <section id="testimonials" className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">Dëshmi klientësh</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Çfarë thonë agjencitë real estate</h2>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-8">
            {TESTIMONIALS.map((t, i) => (
              <FadeIn key={i} delay={i * 150}>
                <div className="p-8 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg transition-all duration-300 h-full flex flex-col">
                  <div className="flex mb-4">
                    {Array.from({ length: t.rating }).map((_, j) => (
                      <Star key={j} className="w-5 h-5 text-amber-400 fill-amber-400" />
                    ))}
                  </div>
                  <p className="text-gray-700 leading-relaxed flex-1 italic">"{t.quote}"</p>
                  <div className="mt-6 flex items-center gap-3 pt-4 border-t border-gray-100">
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white font-bold text-sm">
                      {t.avatar}
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{t.name}</p>
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
      <section className="py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">FAQ</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Pyetjet më të shpeshta</h2>
            </div>
          </FadeIn>

          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <FadeIn key={i} delay={i * 80}>
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                  >
                    <span className="font-semibold text-gray-900 pr-4">{item.q}</span>
                    <ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform duration-300 ${openFaq === i ? 'rotate-180' : ''}`} />
                  </button>
                  <div className={`transition-all duration-300 overflow-hidden ${openFaq === i ? 'max-h-60 opacity-100' : 'max-h-0 opacity-0'}`}>
                    <p className="px-6 pb-5 text-gray-600 leading-relaxed">{item.a}</p>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ CTA + CONTACT FORM ═══ */}
      <section id="contact" className="py-24 bg-gradient-to-br from-gray-900 via-emerald-900 to-gray-900 text-white relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-teal-500/10 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400 mb-4">Gati për të filluar?</p>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">
                  Pronat tuaja duhet parë nga{' '}
                  <span className="text-emerald-400">blerësi i duhur</span>
                </h2>
                <p className="mt-5 text-gray-300 leading-relaxed text-lg">
                  Plotëso formularin dhe merr një <strong className="text-white">konsultim falas</strong> me ekipin tonë.
                  Do analizojmë prezencën tuaj në social media dhe do tregojmë mundësitë konkrete për lead generation.
                </p>

                <div className="mt-8 space-y-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                    <span className="text-gray-300">Audit falas i prezencës në social media</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                    <span className="text-gray-300">Analizë e konkurrentëve në industri</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                    <span className="text-gray-300">Propozim strategjie pa detyrim</span>
                  </div>
                </div>

                <div className="mt-10 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                  <p className="text-sm text-amber-300 font-medium flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Kapacitet i limituar: pranojmë vetëm 8 agjenci të reja çdo muaj.
                  </p>
                </div>
              </div>
            </FadeIn>

            <FadeIn delay={200}>
              {formSent ? (
                <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-10 border border-white/10 text-center">
                  <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
                    <CheckCircle2 className="w-10 h-10 text-green-400" />
                  </div>
                  <h3 className="text-2xl font-bold mb-3">Faleminderit!</h3>
                  <p className="text-gray-300">
                    Kërkesa jote u dërgua me sukses. Ekipi ynë do t'ju kontaktojë brenda 24 orëve.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">Merr konsultimin falas</h3>

                  {selectedPackage && (
                    <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-emerald-500/20 border border-emerald-500/30">
                      <div>
                        <p className="text-xs text-emerald-300">Paketa e zgjedhur</p>
                        <p className="font-semibold text-white">{selectedPackage.title} — {selectedPackage.price}{selectedPackage.priceNote ? ` ${selectedPackage.priceNote}` : ''}</p>
                      </div>
                      <button type="button" onClick={() => setSelectedPackage(null)} className="text-emerald-300 hover:text-white text-sm underline">Ndrysho</button>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Emri i plotë *</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                      placeholder="Emri Mbiemri"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">Email *</label>
                      <input
                        type="email"
                        required
                        value={formData.email}
                        onChange={e => setFormData(prev => ({ ...prev, email: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                        placeholder="email@domain.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">Telefon</label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={e => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                        placeholder="+355 6X XXX XXXX"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Website / Instagram (nëse keni)</label>
                    <input
                      type="text"
                      value={formData.website}
                      onChange={e => setFormData(prev => ({ ...prev, website: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                      placeholder="https://example.com ose @instagram"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Mesazh (opsional)</label>
                    <textarea
                      rows={3}
                      value={formData.message}
                      onChange={e => setFormData(prev => ({ ...prev, message: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all resize-none"
                      placeholder="Na tregoni pak për agjencine tuaj dhe nevojat tuaja..."
                    />
                  </div>

                  {formError && (
                    <div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">
                      {formError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30 transition-all duration-300 hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {submitting ? 'Duke dërguar...' : 'Dërgo Kërkesën'}
                    {!submitting && <ArrowUpRight className="w-5 h-5" />}
                  </button>
                  <p className="text-xs text-gray-400 text-center">
                    Duke dërguar pranoni{' '}
                    <a href="#" className="underline hover:text-white">politikën e privatësisë</a>.
                    Nuk do merrni spam.
                  </p>
                </form>
              )}
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="py-10 bg-gray-950 text-gray-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center">
              <Building2 className="w-3 h-3 text-white" />
            </div>
            <span className="font-semibold text-white text-sm">FivoCRM</span>
          </div>
          <p className="text-sm">&copy; {new Date().getFullYear()} FivoCRM. Të gjitha të drejtat e rezervuara.</p>
          <div className="flex items-center gap-6 text-sm">
            <Link to="/login" className="hover:text-white transition-colors">Hyrje</Link>
            <a href="#packages" className="hover:text-white transition-colors">Çmimet</a>
            <a href="#contact" className="hover:text-white transition-colors">Kontakt</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
