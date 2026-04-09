import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, TrendingUp, Shield, Zap, CheckCircle2, ArrowRight,
  Star, Users, Target, Clock, ChevronDown, Phone,
  ArrowUpRight, Camera, Instagram, Megaphone, BarChart3,
  X, Lock, Video, Image, Heart,
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
   Aesthetics / Beauty Clinic Social Media Packages
   ═══════════════════════════════════════════════════════════════════════ */

interface AestheticsPackage {
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

const PACKAGES: AestheticsPackage[] = [
  {
    id: 'starter',
    title: 'Starter',
    subtitle: 'Prezencë profesionale dhe besueshmëri online',
    price: '700€',
    priceNote: '/ muaj + ad spend',
    targetAudience: [
      'Klinika të reja estetike',
      'Kozmetike individuale',
      'Biznese që duan prezencë profesionale',
    ],
    features: [
      {
        category: 'Përmbajtja & Menaxhimi',
        items: [
          'Menaxhim i 2 platformave (Facebook + Instagram)',
          '12 postime / muaj',
          '10 reels / muaj',
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
      'Xhirime të shumta trajtimesh',
      'Community management i avancuar',
      'Landing page / website changes',
      'Influencer marketing',
    ],
    color: 'from-pink-400 to-rose-500',
    border: 'border-pink-200 hover:border-pink-400',
    cta: 'Fillo me Starter',
  },
  {
    id: 'growth',
    title: 'Growth',
    subtitle: 'Rritje e klientëve dhe besueshmëri e fortë',
    price: '1,100€',
    priceNote: '/ muaj + ad spend',
    popular: true,
    badge: 'Më i Popullarizuari',
    targetAudience: [
      'Klinika estetike në rritje',
      'Sallone me disa shërbime',
      'Klientë që duan leads të rinj',
    ],
    features: [
      {
        category: 'Përmbajtja & Menaxhimi',
        items: [
          'Menaxhim i 2 platformave',
          '16 postime / muaj',
          '20 reels / muaj',
          'Design grafik',
          'Copywriting',
          'Publikim sipas kalendarit',
          '1 ditë xhirimi / muaj',
          'Before & After content',
          'Përmbajtje për trajtime + brand personal',
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
          'Audience targeting (femra, mosha, gjeografi)',
          'Optimizim javor',
          'Raportim i rezultateve',
        ],
      },
    ],
    notIncluded: [
      'Buxheti i reklamave',
      'Xhirime shtesë jashtë ditës mujore',
      'Influencer management',
      'Foto/video për evente speciale',
    ],
    color: 'from-rose-500 to-pink-600',
    border: 'border-rose-200 hover:border-rose-400',
    cta: 'Zgjidh Growth',
  },
  {
    id: 'pro',
    title: 'Pro',
    subtitle: 'Dominim i tregut dhe flow i vazhdueshëm klientësh',
    price: '1,600€',
    priceNote: '/ muaj + ad spend',
    badge: 'Maksimum Rezultate',
    targetAudience: [
      'Klinika premium estetike',
      'Qendra me disa lokacione',
      'Klientë që duan rritje agresive',
    ],
    features: [
      {
        category: 'Përmbajtja & Menaxhimi',
        items: [
          'Menaxhim i 2–3 platformave',
          '20 postime / muaj',
          '25 reels / muaj',
          'Design grafik premium',
          'Copywriting i avancuar',
          'Publikim dhe planifikim mujor',
          '2 ditë xhirimi / muaj',
          'Before & After professional',
          'Content për trajtime, doktor, dhe klinikë',
          'Testimonial video nga klientët',
          'Community management aktiv',
          'Raportim i detajuar mujor',
        ],
      },
      {
        category: 'Ads & Reklama',
        items: [
          'Menaxhim i plotë i Meta Ads',
          'Booking generation campaigns',
          'Retargeting',
          'Audience segmentation i avancuar',
          'Testim i shumë kreativëve',
          'Optimizim i rregullt i performancës',
        ],
      },
    ],
    notIncluded: [
      'Buxheti i reklamave',
      'Produksion pa limit',
      'Landing pages / website development',
      'Event coverage ose launch campaigns të veçanta',
      'Influencer marketing (ofrohet si add-on)',
    ],
    color: 'from-fuchsia-500 to-purple-600',
    border: 'border-fuchsia-200 hover:border-fuchsia-400',
    cta: 'Zgjidh Pro',
  },
  {
    id: 'custom',
    title: 'Custom',
    subtitle: 'Zgjidhje e plotë sipas nevojave tuaja',
    price: 'Sipas kërkesës',
    priceNote: '',
    targetAudience: [
      'Zinxhirë klinikash',
      'Qendra me shumë degë',
      'Lançime produktesh/trajtimesh',
      'Nevoja të veçanta',
    ],
    features: [
      {
        category: 'Mund të përfshijë',
        items: [
          'Më shumë platforma (TikTok, YouTube)',
          'Më shumë xhirime mujore',
          'Video testimoniale profesionale',
          'Before & After me kualitet të lartë',
          'Seasonal campaigns (dimër, verë, festa)',
          'Influencer marketing & management',
          'Event coverage (hapje klinike, lançim trajtimi)',
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
  { name: 'Xhirim trajtimi (Before/After)', price: '150€ – 250€', icon: Camera },
  { name: 'Ditë ekstra xhirimi', price: '200€ – 350€', icon: Image },
  { name: 'Testimonial video klienti', price: '100€ – 180€', icon: Heart },
  { name: 'Foto shtesë klinike/trajtimesh', price: '80€ – 150€', icon: Camera },
  { name: 'Montazh i avancuar / urgent', price: 'Sipas kërkesës', icon: Zap },
];

const RESULTS = [
  { metric: '200', suffix: '+', label: 'Klinika estetike të promovuara', icon: Sparkles },
  { metric: '85', suffix: '%', label: 'Klientë me rritje rezervimesh në 3 muaj', icon: Target },
  { metric: '3.8', suffix: 'x', label: 'Rritje e interesimit për trajtime', icon: TrendingUp },
  { metric: '150', suffix: '+', label: 'Biznese beauty të kënaqur', icon: Users },
];

const PAIN_POINTS = [
  {
    icon: Instagram,
    title: 'Social media pa strategji',
    desc: 'Postoni foto trajtimesh pa plan, pa estetikë vizuale, pa copy tërheqës — dhe pyesni pse nuk ka rezervime.',
  },
  {
    icon: Megaphone,
    title: 'Reklama që nuk sjellin klientë',
    desc: 'Shpenzoni në reklama pa targeting të saktë, pa Before & After bindës — dhe humbisni buxhetin pa rezultate.',
  },
  {
    icon: Clock,
    title: 'Konkurrenca po ju kalon përpara',
    desc: 'Çdo ditë hapen klinika të reja me prezencë të fortë online. Pa marketing profesional, klientët potencialë po zgjedhin të tjerët.',
  },
];

const PROCESS_STEPS = [
  { step: '01', title: 'Analiza & Strategjia', desc: 'Analizojmë klinikën, targetin, dhe konkurrencën. Krijojmë strategji vizuale të tailored.', icon: Target },
  { step: '02', title: 'Krijim Përmbajtjeje', desc: 'Xhirime trajtimesh, Before & After, testimoniale, ambient klinike — gjithçka profesionale.', icon: Camera },
  { step: '03', title: 'Publikim & Ads', desc: 'Publikojmë sipas kalendarit dhe lançojmë fushata me targeting të saktë (mosha, gjinia, zona).', icon: Megaphone },
  { step: '04', title: 'Optimizim & Raportim', desc: 'Monitorojmë rezultatet javor, optimizojmë fushatat, raportojmë rezervimet e reja.', icon: BarChart3 },
];

const TESTIMONIALS = [
  {
    name: 'Dr. Elona Hoxha',
    role: 'Drejtuese, Glow Aesthetics Clinic',
    quote: 'Brenda 2 muajve u rritën rezervimet me 70%. Reels-et e trajtimeve Before & After kanë bërë çudi — klientë na kontaktojnë direkt nga Instagram.',
    rating: 5,
    avatar: 'EH',
  },
  {
    name: 'Arjeta Krasniqi',
    role: 'Pronare, Belle Beauty Center',
    quote: 'Prezenca jonë në social media u transformua komplet. Kurse estetike, trajtime fytyre — tani klientë të rinj na gjejnë çdo javë.',
    rating: 5,
    avatar: 'AK',
  },
  {
    name: 'Dr. Besnik Maliqi',
    role: 'Kirurg Plastik, Premium Med',
    quote: 'Kampanjat Lead Generation na sjellin 40+ kontakte të reja çdo muaj. Investimi në marketing profesional ka ndryshuar biznesin.',
    rating: 5,
    avatar: 'BM',
  },
];

const FAQ = [
  {
    q: 'Çfarë përfshihet në buxhetin e reklamave (ad spend)?',
    a: 'Buxheti i reklamave (ad spend) paguhet direkt tek Meta (Facebook/Instagram) dhe nuk përfshihet në çmimin e paketës. Ne menaxhojmë se si shpenzohet, por shuma është e veçantë. Zakonisht rekomandojmë 300€–1,000€/muaj varësisht nga objektivat.',
  },
  {
    q: 'Sa kohë duhet për të parë rezultate?',
    a: 'Prezenca profesionale ndikon menjëherë në besueshmërinë e klinikës. Për rritje rezervimesh përmes reklamave, rezultatet e para vijnë zakonisht brenda 2–4 javëve. Strategjia e plotë ndërtohet brenda 2–3 muajve.',
  },
  {
    q: 'A mund ta ndryshoj paketin gjatë rrugës?',
    a: 'Po, absolutisht. Mund të upgrade-oni ose ndryshoni paketin çdo muaj. Na njoftoni 7 ditë para rifillimit të muajit.',
  },
  {
    q: 'A bëni Before & After content?',
    a: 'Po! Before & After është një nga format më efektive për industrinë e estetikës. Në Growth përfshihet 1 ditë xhirimi, në Pro 2 ditë, dhe në Custom sipas nevojave.',
  },
  {
    q: 'A respektoni konfidencialitetin e klientëve?',
    a: 'Absolutisht. Çdo Before & After ose testimonial bëhet vetëm me miratimin e plotë të klientit. Ne jemi të kujdesshëm me privatësinë dhe respektojmë rregullat e industrisë.',
  },
  {
    q: 'A targetoni klientë sipas trajtimeve specifike?',
    a: 'Po. Krijojmë fushata të ndara për trajtime të ndryshme (filler, botox, lazer, etj.) me audience targeting të saktë sipas moshës, gjinisë, interesave, dhe zonës gjeografike.',
  },
];

/* ═══════════════════════════════════════════════════════════════════════ */

export default function EstetikeLandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', website: '', message: '' });
  const [formSent, setFormSent] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<AestheticsPackage | null>(null);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const scrollToPackages = () => {
    document.getElementById('packages')?.scrollIntoView({ behavior: 'smooth' });
  };
  const scrollToContact = (pkg?: AestheticsPackage) => {
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
          packageName: selectedPackage ? `Estetikë ${selectedPackage.title}` : '',
          source: 'Estetikë Landing Page',
          category: 'Social Media - Estetikë',
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
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-rose-500 to-pink-600 bg-clip-text text-transparent">
              FivoCRM Estetikë
            </span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
            <a href="#results" className="hover:text-rose-500 transition-colors">Rezultatet</a>
            <a href="#process" className="hover:text-rose-500 transition-colors">Procesi</a>
            <a href="#packages" className="hover:text-rose-500 transition-colors">Paketat</a>
            <a href="#addons" className="hover:text-rose-500 transition-colors">Shtesa</a>
            <a href="#testimonials" className="hover:text-rose-500 transition-colors">Dëshmitë</a>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="hidden sm:inline-flex text-sm font-medium text-gray-600 hover:text-rose-500 transition-colors"
            >
              Hyr
            </Link>
            <button
              onClick={() => scrollToContact()}
              className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-rose-500 to-pink-600 hover:shadow-lg hover:shadow-rose-500/25 transition-all duration-300 hover:-translate-y-0.5"
            >
              Fillo Tani
            </button>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-rose-50/80 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-pink-200/30 rounded-full blur-3xl" />
        <div className="absolute top-40 right-0 w-[400px] h-[400px] bg-rose-200/20 rounded-full blur-3xl" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-rose-50 border border-rose-100 mb-8">
                <div className="flex -space-x-2">
                  {['EH', 'AK', 'BM', 'DL'].map((initials, i) => (
                    <div key={i} className="w-7 h-7 rounded-full bg-gradient-to-br from-rose-400 to-pink-500 border-2 border-white flex items-center justify-center text-[10px] font-bold text-white">
                      {initials}
                    </div>
                  ))}
                </div>
                <span className="text-sm font-medium text-rose-700">
                  150+ klinika estetike na besojnë
                </span>
                <div className="flex">
                  {[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}
                </div>
              </div>
            </FadeIn>

            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                Klinika jote meriton{' '}
                <span className="relative">
                  <span className="bg-gradient-to-r from-rose-500 via-pink-500 to-fuchsia-500 bg-clip-text text-transparent">
                    klientë të rinj
                  </span>
                  <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 300 12" fill="none">
                    <path d="M2 8 C60 2, 120 2, 150 6 S240 10, 298 4" stroke="url(#estetike-underline)" strokeWidth="3" strokeLinecap="round" />
                    <defs><linearGradient id="estetike-underline" x1="0" y1="0" x2="300" y2="0"><stop offset="0%" stopColor="#f43f5e"/><stop offset="100%" stopColor="#d946ef"/></linearGradient></defs>
                  </svg>
                </span>
                {' '}çdo javë.
                <br />
                <span className="text-gray-400">A po ndodh kjo?</span>
              </h1>
            </FadeIn>

            <FadeIn delay={200}>
              <p className="mt-8 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
                Çdo ditë, <strong className="text-gray-900">mijëra femra dhe meshkuj</strong> shfletojnë Instagram duke kërkuar trajtimin e radhës.
                Pa Before & After bindës, pa prezencë profesionale,{' '}
                <strong className="text-rose-500">ata po shkojnë tek konkurrenca.</strong>
              </p>
            </FadeIn>

            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button
                  onClick={scrollToPackages}
                  className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-rose-500 to-pink-600 hover:shadow-xl hover:shadow-rose-500/25 transition-all duration-300 hover:-translate-y-1 flex items-center justify-center gap-2"
                >
                  Shiko Paketat
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
                <button
                  onClick={() => scrollToContact()}
                  className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border-2 border-gray-200 hover:border-rose-300 hover:bg-rose-50 transition-all duration-300 flex items-center justify-center gap-2"
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
                <span className="flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-rose-500" /> Rezultate brenda muajit</span>
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
                Klinika po humb klientë <span className="text-red-500">çdo ditë</span>
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
                Lajmi i mirë? <span className="text-rose-500 font-bold">Ne e dimë zgjidhjen.</span>
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
              <p className="text-sm font-semibold uppercase tracking-widest text-rose-500 mb-3">Rezultate të vërteta</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Numrat flasin më shumë se fjalët</h2>
            </div>
          </FadeIn>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {RESULTS.map((r, i) => (
              <FadeIn key={i} delay={i * 100}>
                <div className="text-center p-8 rounded-2xl bg-gradient-to-br from-rose-50 to-pink-50 border border-rose-100">
                  <r.icon className="w-8 h-8 text-rose-500 mx-auto mb-4" />
                  <div className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-rose-500 to-pink-600 bg-clip-text text-transparent">
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
              <p className="text-sm font-semibold uppercase tracking-widest text-rose-400 mb-3">Si funksionon</p>
              <h2 className="text-3xl sm:text-4xl font-bold">4 hapa për sukses në social media</h2>
              <p className="mt-4 text-gray-400 max-w-xl mx-auto">
                Procesi ynë i provuar që sjell klientë të rinj për klinika estetike
              </p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-4 gap-6 relative">
            <div className="hidden md:block absolute top-16 left-[12%] right-[12%] h-px bg-gradient-to-r from-rose-500/50 via-pink-500/50 to-rose-500/50" />

            {PROCESS_STEPS.map((s, i) => (
              <FadeIn key={i} delay={i * 150}>
                <div className="relative text-center p-6 rounded-2xl bg-gray-800/50 border border-gray-700 hover:border-rose-500/50 transition-all duration-300 group">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center mx-auto mb-4 text-lg font-bold relative z-10">
                    {s.step}
                  </div>
                  <s.icon className="w-6 h-6 text-rose-400 mx-auto mb-3 group-hover:scale-110 transition-transform" />
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
              <p className="text-sm font-semibold uppercase tracking-widest text-rose-500 mb-3">Paketat Social Media</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Zgjidh paketin ideal për klinikën tënde</h2>
              <p className="mt-4 text-gray-600 max-w-2xl mx-auto">
                Çdo paketë përfshin strategji të personalizuar për industrinë e estetikës. Çmimet nuk përfshijnë buxhetin e reklamave (ad spend).
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
                  <div className={`relative rounded-2xl bg-white border-2 ${pkg.border} transition-all duration-300 hover:shadow-2xl ${pkg.popular ? 'shadow-xl ring-2 ring-rose-500/20' : 'shadow-sm'} ${isSelected ? 'ring-2 ring-green-500' : ''}`}>
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
                              <span className="text-rose-400 mt-0.5">•</span>
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
                                  <CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${pkg.popular ? 'text-rose-500' : 'text-green-500'}`} />
                                  {feature}
                                </li>
                              ))}
                            </ul>
                            {!isExpanded && cat.items.length > 4 && (
                              <button
                                onClick={() => setExpandedCard(pkg.id)}
                                className="mt-2 text-xs text-rose-500 font-medium hover:underline"
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
                            ? `bg-gradient-to-r ${pkg.color} text-white hover:shadow-lg hover:shadow-rose-500/25`
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
              <p className="text-sm font-semibold uppercase tracking-widest text-rose-500 mb-3">Shtesa Extra</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Personalizo paketën tënde</h2>
              <p className="mt-4 text-gray-600 max-w-xl mx-auto">
                Shto shërbime ekstra sipas nevojave të klinikës suaj.
              </p>
            </div>
          </FadeIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {ADD_ONS.map((addon, i) => (
              <FadeIn key={i} delay={i * 80}>
                <div className="flex items-center gap-4 p-5 rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-md hover:border-rose-100 transition-all duration-300">
                  <div className="w-11 h-11 rounded-lg bg-rose-50 flex items-center justify-center flex-shrink-0">
                    <addon.icon className="w-5 h-5 text-rose-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm">{addon.name}</p>
                    <p className="text-rose-500 font-bold text-sm">{addon.price}</p>
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
              <p className="text-sm font-semibold uppercase tracking-widest text-rose-500 mb-3">Dëshmi klientësh</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Çfarë thonë klinika estetike</h2>
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
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center text-white font-bold text-sm">
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
              <p className="text-sm font-semibold uppercase tracking-widest text-rose-500 mb-3">FAQ</p>
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
      <section id="contact" className="py-24 bg-gradient-to-br from-gray-900 via-rose-900 to-gray-900 text-white relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-rose-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-pink-500/10 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-rose-400 mb-4">Gati për të filluar?</p>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">
                  Klinika jote meriton{' '}
                  <span className="text-rose-400">klientë çdo javë</span>
                </h2>
                <p className="mt-5 text-gray-300 leading-relaxed text-lg">
                  Plotëso formularin dhe merr një <strong className="text-white">konsultim falas</strong> me ekipin tonë.
                  Do analizojmë prezencën tuaj në social media dhe do tregojmë mundësitë konkrete për rritje klientësh.
                </p>

                <div className="mt-8 space-y-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                    <span className="text-gray-300">Audit falas i prezencës në social media</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                    <span className="text-gray-300">Analizë e konkurrentëve në industrinë e estetikës</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                    <span className="text-gray-300">Propozim strategjie pa detyrim</span>
                  </div>
                </div>

                <div className="mt-10 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                  <p className="text-sm text-amber-300 font-medium flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Kapacitet i limituar: pranojmë vetëm 10 klinika të reja çdo muaj.
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
                    <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-rose-500/20 border border-rose-500/30">
                      <div>
                        <p className="text-xs text-rose-300">Paketa e zgjedhur</p>
                        <p className="font-semibold text-white">{selectedPackage.title} — {selectedPackage.price}{selectedPackage.priceNote ? ` ${selectedPackage.priceNote}` : ''}</p>
                      </div>
                      <button type="button" onClick={() => setSelectedPackage(null)} className="text-rose-300 hover:text-white text-sm underline">Ndrysho</button>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Emri i plotë *</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent transition-all"
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
                        className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent transition-all"
                        placeholder="email@domain.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">Telefon</label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={e => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent transition-all"
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
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent transition-all"
                      placeholder="https://example.com ose @instagram"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Mesazh (opsional)</label>
                    <textarea
                      rows={3}
                      value={formData.message}
                      onChange={e => setFormData(prev => ({ ...prev, message: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent transition-all resize-none"
                      placeholder="Na tregoni pak për klinikën tuaj dhe shërbimet që ofroni..."
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
                    className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-400 hover:to-pink-400 text-white shadow-lg shadow-rose-500/25 hover:shadow-xl hover:shadow-rose-500/30 transition-all duration-300 hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
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
            <div className="w-6 h-6 rounded bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center">
              <Sparkles className="w-3 h-3 text-white" />
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
