import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  GraduationCap, BookOpen, Users, Star, CheckCircle2, ArrowRight,
  Target, Clock, Award, ChevronDown, Phone, ArrowUpRight,
  Sparkles, TrendingUp, Zap, Shield, BarChart3, Globe,
  Video, Instagram, Search, MessageSquare, X, Play,
} from 'lucide-react';

/* ─── Intersection observer for scroll animations ─── */
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
   PACKAGES
   ═══════════════════════════════════════════════ */
const PACKAGES = [
  {
    id: 'fillestar',
    title: 'Fillestar',
    subtitle: 'Prezencë online profesionale për qendra të vogla',
    price: '500€',
    priceNote: '/ muaj + ad spend',
    popular: false,
    badge: '',
    color: 'from-blue-400 to-indigo-500',
    border: 'border-blue-200 hover:border-blue-400',
    cta: 'Fillo me Fillestar',
    targetAudience: [
      'Qendra kursesh të reja',
      'Mësues privatë / tutorë',
      'Çerdhe dhe kopshte private',
    ],
    features: [
      {
        category: 'Social Media',
        items: [
          'Menaxhim 2 platformash (Facebook + Instagram)',
          '12 postime / muaj',
          '8 reels / muaj',
          'Design grafik profesional',
          'Copywriting në shqip',
          'Publikim sipas kalendarit',
          'Raport mujor bazë',
        ],
      },
      {
        category: 'SEO',
        items: [
          'Optimizim bazë i faqes',
          'Google Business Profile setup',
          '2 artikuj blog / muaj',
        ],
      },
      {
        category: 'Reklama',
        items: [
          'Setup bazë i Meta Ads',
          'Menaxhim 1 fushatë aktive',
          'Targetim lokal',
        ],
      },
    ],
    notIncluded: [
      'Buxheti i reklamave',
      'Google Ads',
      'Xhirime video profesionale',
      'Email marketing',
      'TikTok / YouTube',
    ],
  },
  {
    id: 'rritje',
    title: 'Rritje',
    subtitle: 'Rrit nxënësit dhe autoritetin e institucionit',
    price: '950€',
    priceNote: '/ muaj + ad spend',
    popular: true,
    badge: 'Më i Zgjedhuri',
    color: 'from-indigo-500 to-violet-600',
    border: 'border-indigo-200 hover:border-indigo-500',
    cta: 'Zgjidh Rritje',
    targetAudience: [
      'Shkolla private në rritje',
      'Qendra kursesh me 2+ programe',
      'Akademi gjuhësh dhe IT',
    ],
    features: [
      {
        category: 'Social Media',
        items: [
          'Menaxhim 3 platformash (FB + IG + TikTok)',
          '20 postime / muaj',
          '16 reels / muaj',
          '1 ditë xhirimi / muaj',
          'Behind-the-scenes content',
          'Testimoniale nxënësish',
          'Community management bazë',
          'Raport javor performance',
        ],
      },
      {
        category: 'SEO',
        items: [
          'SEO i plotë On-Page',
          'Strategji fjalësh kyçe',
          '4 artikuj blog / muaj',
          'Google Business optimizim',
          'Ndërtim i autoritetit (backlinks)',
        ],
      },
      {
        category: 'Reklama',
        items: [
          'Menaxhim i plotë Meta Ads',
          'Google Search Ads',
          '3–5 fushata aktive',
          'Remarketing për vizitorë',
          'Optimizim javor',
          'A/B testing kreativësh',
        ],
      },
    ],
    notIncluded: [
      'Buxheti i reklamave',
      'Produksion video të plotë',
      'Influencer marketing',
    ],
  },
  {
    id: 'akademi',
    title: 'Akademi',
    subtitle: 'Dominim i plotë dixhital për institucione të mëdha',
    price: '1,800€',
    priceNote: '/ muaj + ad spend',
    popular: false,
    badge: 'Premium',
    color: 'from-violet-600 to-purple-700',
    border: 'border-violet-200 hover:border-violet-500',
    cta: 'Zgjidh Akademi',
    targetAudience: [
      'Shkolla të mëdha private',
      'Universitete dhe kolegje',
      'Rrjete qendrash arsimore',
    ],
    features: [
      {
        category: 'Social Media',
        items: [
          'Menaxhim 4 platformash (FB + IG + TikTok + YouTube)',
          'Postime të pakufizuara',
          '24+ reels / muaj',
          '2 ditë xhirimi / muaj',
          'Mini-dokumentarë suksesi',
          'Kampanja sezonale (regjistrimi)',
          'Community management i plotë',
          'Inbox management',
          'Raport mujor i detajuar',
        ],
      },
      {
        category: 'SEO & Content',
        items: [
          'SEO teknik i avancuar',
          'Content strategy 6-mujore',
          '8 artikuj blog / muaj',
          'Landing pages dedikuara / kurs',
          'Ndërtim autoritet domenin',
          'Local SEO multi-lokacion',
        ],
      },
      {
        category: 'Reklama & Email',
        items: [
          'Menaxhim i plotë Meta + Google Ads',
          'YouTube Ads',
          'Fushata sezonale regjistrimi',
          'Email marketing automation',
          'CRM integration & follow-up',
          'Raportim i plotë ROI',
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
    title: 'Vende bosh në klasë çdo vit',
    body: 'Programet tuaja janë cilësorë, por nxënësit e rinj nuk e dinë që ekzistoni. Konkurrentët tuaj po marrin nxënësit tuaj.',
    color: 'text-red-500',
    bg: 'bg-red-50',
  },
  {
    icon: Globe,
    title: 'Faqe e vjetër dhe e padukshme',
    body: 'Kur prindërit kërkojnë "shkollë private Tiranë" ose "kurs anglisht", institucioni juaj nuk shfaqet as në faqen e parë.',
    color: 'text-orange-500',
    bg: 'bg-orange-50',
  },
  {
    icon: BarChart3,
    title: 'Postime pa rezultate',
    body: 'Bëni postime herë pas here pa strategji. Nuk dini çfarë funksionon. Orë të humbura pa asnjë aplikim të ri.',
    color: 'text-amber-500',
    bg: 'bg-amber-50',
  },
  {
    icon: Clock,
    title: 'Nuk keni kohë për marketing',
    body: 'Fokusohu te mësimdhënia — ne marrim përsipër gjithë praninë tuaj dixhitale, nga postimet deri te reklamat.',
    color: 'text-blue-500',
    bg: 'bg-blue-50',
  },
];

const PROCESS_STEPS = [
  { n: '01', title: 'Analizë & Strategji', body: 'Studiojmë institucionin, konkurentët dhe audiencën tuaj. Ndërtojmë strategji 3-mujore me qëllime të matshme.' },
  { n: '02', title: 'Identitet & Mesazh', body: 'Optimizojmë profilet, kriojmë mesazhe bindëse dhe ndërtojmë "zërin" e institucionit tuaj online.' },
  { n: '03', title: 'Kontent & Reklamim', body: 'Prodhojmë postime, reels, artikuj dhe aktivizojmë fushatat reklamuese drejtuar prindërve dhe nxënësve.' },
  { n: '04', title: 'Optimizim Javor', body: 'Analizojmë rezultatet çdo javë dhe rregullojmë çdo element për performancë maksimale.' },
  { n: '05', title: 'Raportim & Rritje', body: 'Raporte mujore transparente me numra realë: aplikime, regjistrimet, kosto për nxënës të ri.' },
];

const ADDONS = [
  { icon: Video,     title: 'Produksion Video',   desc: 'Xhirim dhe editim profesional video promovuese, tour të shkollës, testimoniale.' },
  { icon: Globe,     title: 'Faqe Interneti',      desc: 'Dizajn dhe zhvillim faqeje moderne, me SEO të integruar dhe sistem aplikimesh online.' },
  { icon: MessageSquare, title: 'WhatsApp Marketing', desc: 'Fushatë direkte me prindër dhe nxënës potencialë nëpërmjet WhatsApp.' },
  { icon: Instagram, title: 'Influencer Marketing', desc: 'Bashkëpunim me influencerë arsimor dhe prindër të njohur për besueshmëri.' },
  { icon: Search,    title: 'Google Ads Shtesë',   desc: 'Buxhet shtesë i menaxhuar për periudha regjistrimi dhe kampanja sezonale.' },
  { icon: Shield,    title: 'Menaxhim Reputacioni', desc: 'Monitorim komentesh, recensionesh dhe ndërtim imazhi pozitiv online.' },
];

const TESTIMONIALS = [
  {
    name: 'Arta Kelmendi',
    role: 'Drejtuese, Akademia e Gjuhëve "Lingua"',
    text: 'Pas 3 muajsh bashkëpunim, aplikacionet për kurse u shtuan me 280%. Tani jemi plotë çdo sezon.',
    stars: 5,
    avatar: 'AK',
    color: 'bg-indigo-500',
  },
  {
    name: 'Besnik Hoxha',
    role: 'Pronar, Shkolla Private "Mendimi"',
    text: 'Google-i tashmë na tregon në vendin e parë kur prindërit kërkojnë shkollë private. Regjistrimet u trefishuan.',
    stars: 5,
    avatar: 'BH',
    color: 'bg-violet-500',
  },
  {
    name: 'Mirela Brahimi',
    role: 'CEO, Qendra e Kurseve IT "CodePro"',
    text: 'Fushatat tona sezonale sjellin 50–80 aplikime të reja çdo muaj. ROI-i është i jashtëzakonshëm.',
    stars: 5,
    avatar: 'MB',
    color: 'bg-blue-500',
  },
];

const FAQS = [
  {
    q: 'Sa kohë duhet për të parë rezultatet e para?',
    a: 'Për reklamat paguese (Meta/Google Ads), rezultatet fillojnë brenda 2–4 javëve. Për SEO, rezultate organike duhen 3–6 muaj. Shumica e klientëve shohin rritje të aplikimeve brenda muajit të parë.',
  },
  {
    q: 'A punoni vetëm me shkolla shqiptare?',
    a: 'Punojmë me çdo institucion arsimor: shkolla private, qendra kursesh (gjuhë, IT, muzikë, arte), çerdhe, kopshte, akademi sportive dhe institucione të arsimit të lartë.',
  },
  {
    q: 'Çfarë buxheti reklamash rekomandoni?',
    a: 'Për rezultate optimale, rekomandojmë minimum 200–400€/muaj për Meta Ads dhe 150–300€/muaj për Google Ads. Buxheti nuk përfshihet në çmimin e paketave dhe menaxhohet plotësisht nga ne.',
  },
  {
    q: 'A mund të ndryshojmë paketën pas fillimit?',
    a: 'Po, mund të upgradoni ose downgradoni paketën çdo muaj sipas nevojave tuaja. Nuk ka kontratë afatgjatë — punojmë mujor.',
  },
  {
    q: 'A prodhoni ju materialin vizual (foto/video)?',
    a: 'Po. Vizitojmë institucionin tuaj për xhirime dhe foto (sipas paketës). Mund të shtoni gjithashtu shërbimin "Produksion Video" si add-on.',
  },
  {
    q: 'Si raportoni rezultatet?',
    a: 'Çdo muaj ju dërgojmë raport të detajuar me: numrin e aplikimeve, koston për aplikim, rritjen e faqes, performancën e reklamave dhe rekomandimet për muajin e ardhshëm.',
  },
];

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════ */
const EducationLandingPage: React.FC = () => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [selectedPkg, setSelectedPkg] = useState<string>('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', school: '', message: '',
  });

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
        body: JSON.stringify({
          ...formData,
          selectedPackage: selectedPkg,
          source: 'education-landing',
          category: 'Education',
        }),
      });
      if (!res.ok) throw new Error('Server error');
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
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-lg flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg text-gray-900">FivoCRM <span className="text-indigo-600">Arsim</span></span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600">
            <a href="#problemi" className="hover:text-indigo-600 transition-colors">Problemi</a>
            <a href="#packages" className="hover:text-indigo-600 transition-colors">Paketat</a>
            <a href="#procesi" className="hover:text-indigo-600 transition-colors">Procesi</a>
            <a href="#faq" className="hover:text-indigo-600 transition-colors">FAQ</a>
          </nav>
          <button
            onClick={() => scrollToContact()}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Konsultim Falas
          </button>
        </div>
      </header>

      {/* ═══ HERO ═══ */}
      <section className="relative pt-28 pb-20 bg-gradient-to-br from-indigo-950 via-indigo-900 to-violet-900 text-white overflow-hidden">
        {/* Background blobs */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-violet-500/10 rounded-full blur-3xl" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_hsl(238,70%,60%,0.15),_transparent_70%)]" />
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 bg-indigo-500/20 border border-indigo-400/30 rounded-full px-4 py-1.5 text-sm mb-6">
              <Sparkles className="w-4 h-4 text-indigo-300" />
              <span className="text-indigo-200">Marketing Dixhital për Institucione Arsimore</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight mb-6">
              Mbush klasat tuaja me{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 to-violet-300">
                nxënës të rinj
              </span>{' '}
              çdo sezon
            </h1>

            <p className="text-lg sm:text-xl text-indigo-100 mb-8 leading-relaxed max-w-2xl">
              Marketing profesional për shkolla private, qendra kursesh dhe akademi.
              Ne menaxhojmë praninë tuaj dixhitale — ju fokusoheni te mësimdhënia.
            </p>

            <div className="flex flex-col sm:flex-row gap-4">
              <button
                onClick={() => scrollToContact()}
                className="flex items-center justify-center gap-2 bg-white text-indigo-700 font-bold px-8 py-4 rounded-xl hover:bg-indigo-50 transition-all shadow-lg hover:shadow-xl text-lg"
              >
                <Phone className="w-5 h-5" />
                Konsultim Falas
              </button>
              <button
                onClick={scrollToPackages}
                className="flex items-center justify-center gap-2 border border-indigo-400/40 text-white font-semibold px-8 py-4 rounded-xl hover:bg-indigo-800/50 transition-all text-lg"
              >
                Shiko Paketat
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>

            {/* Trust badges */}
            <div className="flex flex-wrap items-center gap-6 mt-10 text-sm text-indigo-300">
              <div className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-400" /> Pa kontratë afatgjatë</div>
              <div className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-400" /> Raporte mujore transparente</div>
              <div className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-400" /> Rezultate të matshme</div>
            </div>
          </div>
        </div>

        {/* Wave bottom */}
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
              { end: 300, suffix: '%+', label: 'rritje mesatare aplikimesh', color: 'text-indigo-600' },
              { end: 20,  suffix: '+',  label: 'shkolla & qendra kursesh', color: 'text-violet-600' },
              { end: 3200, suffix: '+', label: 'aplikime të gjeneruara', color: 'text-blue-600' },
              { end: 98, suffix: '%',   label: 'kënaqësi klientësh', color: 'text-green-600' },
            ].map((stat, i) => (
              <FadeIn key={i} delay={i * 100}>
                <div>
                  <div className={`text-4xl font-extrabold ${stat.color} mb-1`}>
                    <Counter end={stat.end} suffix={stat.suffix} />
                  </div>
                  <p className="text-sm text-gray-500 font-medium">{stat.label}</p>
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
              <span className="inline-block bg-red-100 text-red-600 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">A ju njeh?</span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
                Problemet që frenojnë rritjen tuaj
              </h2>
              <p className="text-gray-500 max-w-xl mx-auto">
                Shumica e institucioneve arsimore kanë të njëjtat sfida dixhitale. Ne i kemi zgjidhur të gjitha.
              </p>
            </div>
          </FadeIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {PAIN_POINTS.map((p, i) => {
              const Icon = p.icon;
              return (
                <FadeIn key={i} delay={i * 100}>
                  <div className={`${p.bg} rounded-2xl p-6 border border-gray-100`}>
                    <div className={`w-10 h-10 rounded-xl ${p.bg} flex items-center justify-center mb-4`}>
                      <Icon className={`w-6 h-6 ${p.color}`} />
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

      {/* ═══ WHO WE SERVE ═══ */}
      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <FadeIn>
            <div className="text-center mb-10">
              <h2 className="text-2xl font-bold text-gray-800">Me kë punojmë</h2>
            </div>
          </FadeIn>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { icon: GraduationCap, label: 'Shkolla Private' },
              { icon: BookOpen,      label: 'Qendra Kursesh' },
              { icon: Globe,         label: 'Akademi Gjuhësh' },
              { icon: Zap,           label: 'Kurseve IT' },
              { icon: Star,          label: 'Çerdhe & Kopshte' },
              { icon: Award,         label: 'Kolegje Private' },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <FadeIn key={i} delay={i * 80}>
                  <div className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/40 transition-colors text-center">
                    <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-indigo-600" />
                    </div>
                    <span className="text-xs font-semibold text-gray-700">{item.label}</span>
                  </div>
                </FadeIn>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══ PACKAGES ═══ */}
      <section id="packages" className="py-24 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <FadeIn>
            <div className="text-center mb-14">
              <span className="inline-block bg-indigo-100 text-indigo-600 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">Çmimet</span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
                Paketë për çdo institucion
              </h2>
              <p className="text-gray-500 max-w-xl mx-auto">
                Zgjidhni paketën që i përshtatet madhësisë dhe qëllimeve tuaja. Pa kontratë — ndryshoni kur dëshironi.
              </p>
            </div>
          </FadeIn>

          <div className="grid lg:grid-cols-3 gap-8 items-start">
            {PACKAGES.map((pkg, i) => (
              <FadeIn key={pkg.id} delay={i * 120}>
                <div className={`relative bg-white rounded-2xl border-2 ${pkg.border} transition-all shadow-sm hover:shadow-xl overflow-hidden flex flex-col`}>
                  {pkg.popular && (
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
                  )}
                  {pkg.badge && (
                    <div className="absolute top-4 right-4">
                      <span className={`inline-block px-3 py-1 text-xs font-bold rounded-full text-white bg-gradient-to-r ${pkg.color}`}>
                        {pkg.badge}
                      </span>
                    </div>
                  )}

                  <div className="p-6 pb-4">
                    <div className={`inline-flex w-10 h-10 rounded-xl items-center justify-center bg-gradient-to-br ${pkg.color} mb-4`}>
                      <GraduationCap className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="text-xl font-extrabold text-gray-900">{pkg.title}</h3>
                    <p className="text-sm text-gray-500 mt-1 mb-4">{pkg.subtitle}</p>
                    <div className="flex items-end gap-1 mb-1">
                      <span className="text-4xl font-extrabold text-gray-900">{pkg.price}</span>
                    </div>
                    <p className="text-xs text-gray-400 mb-5">{pkg.priceNote}</p>

                    <button
                      onClick={() => scrollToContact(pkg.title)}
                      className={`w-full py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-r ${pkg.color} hover:opacity-90 transition-opacity shadow`}
                    >
                      {pkg.cta}
                    </button>
                  </div>

                  {/* Target audience */}
                  <div className="px-6 pb-4">
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Ideal për</p>
                    <ul className="space-y-1">
                      {pkg.targetAudience.map((a, j) => (
                        <li key={j} className="flex items-center gap-2 text-xs text-gray-600">
                          <CheckCircle2 className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                          {a}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Features */}
                  <div className="px-6 pb-6 flex-1 space-y-4 border-t border-gray-100 pt-4">
                    {pkg.features.map((section, si) => (
                      <div key={si}>
                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">{section.category}</p>
                        <ul className="space-y-1.5">
                          {section.items.map((item, ii) => (
                            <li key={ii} className="flex items-start gap-2 text-xs text-gray-700">
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}

                    {/* Not included */}
                    <div>
                      <p className="text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-2">Nuk përfshihet</p>
                      <ul className="space-y-1">
                        {pkg.notIncluded.map((item, ii) => (
                          <li key={ii} className="flex items-start gap-2 text-xs text-gray-400">
                            <X className="w-3 h-3 text-gray-300 flex-shrink-0 mt-0.5" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>

          <FadeIn>
            <p className="text-center text-sm text-gray-400 mt-8">
              * Buxheti i reklamave paguhet direkt te platformat (Meta/Google) dhe nuk përfshihet në çmimin e paketës.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ═══ PROCESS ═══ */}
      <section id="procesi" className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <FadeIn>
            <div className="text-center mb-14">
              <span className="inline-block bg-violet-100 text-violet-600 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">Si Funksionon</span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">Procesi ynë i provuar</h2>
              <p className="text-gray-500 max-w-xl mx-auto">5 hapa drejt klasave të mbushura dhe autoritetit dixhital.</p>
            </div>
          </FadeIn>

          <div className="relative">
            {/* Connector line */}
            <div className="hidden lg:block absolute top-8 left-[10%] right-[10%] h-0.5 bg-gradient-to-r from-indigo-200 via-violet-300 to-indigo-200" />

            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-8">
              {PROCESS_STEPS.map((step, i) => (
                <FadeIn key={i} delay={i * 100}>
                  <div className="relative text-center">
                    <div className="w-16 h-16 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-200 relative z-10">
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
      <section className="py-20 bg-indigo-950 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_hsl(245,60%,50%,0.2),_transparent_70%)]" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
          <FadeIn>
            <div className="text-center mb-12">
              <span className="inline-block bg-indigo-500/20 text-indigo-300 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">Shtojca</span>
              <h2 className="text-3xl font-extrabold mb-3">Shërbime shtesë</h2>
              <p className="text-indigo-300 max-w-xl mx-auto text-sm">Personalizoni paketën tuaj me shërbime shtesë sipas nevojës.</p>
            </div>
          </FadeIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {ADDONS.map((a, i) => {
              const Icon = a.icon;
              return (
                <FadeIn key={i} delay={i * 80}>
                  <div className="bg-indigo-900/50 border border-indigo-700/40 rounded-2xl p-6 hover:bg-indigo-800/50 transition-colors">
                    <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center mb-4">
                      <Icon className="w-5 h-5 text-indigo-300" />
                    </div>
                    <h3 className="font-bold mb-2">{a.title}</h3>
                    <p className="text-sm text-indigo-300 leading-relaxed">{a.desc}</p>
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
              <span className="inline-block bg-yellow-100 text-yellow-600 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">Dëshmitarë</span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">Çfarë thonë klientët tanë</h2>
              <p className="text-gray-500">Institucione reale, rezultate reale.</p>
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
              <span className="inline-block bg-blue-100 text-blue-600 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">FAQ</span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">Pyetjet e shpeshta</h2>
            </div>
          </FadeIn>

          <div className="space-y-3">
            {FAQS.map((faq, i) => (
              <FadeIn key={i} delay={i * 60}>
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

      {/* ═══ CONTACT FORM ═══ */}
      <section id="contact" className="py-24 bg-gradient-to-br from-indigo-950 via-indigo-900 to-violet-900 text-white relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-violet-500/10 rounded-full blur-3xl" />
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
          <div className="grid lg:grid-cols-2 gap-14 items-start">
            {/* Left: value props */}
            <FadeIn>
              <div>
                <span className="inline-block bg-indigo-500/20 text-indigo-300 text-xs font-bold px-3 py-1 rounded-full mb-6 uppercase tracking-wide">Fillo sot</span>
                <h2 className="text-3xl sm:text-4xl font-extrabold mb-6 leading-tight">
                  Merr konsultimin falas<br />
                  <span className="text-indigo-300">pa asnjë detyrim</span>
                </h2>
                <p className="text-indigo-200 mb-8 leading-relaxed">
                  Takohemi (online ose fizikisht), analizojmë situatën aktuale dhe ju tregojmë saktësisht çfarë mund të bëjmë për institucionin tuaj.
                </p>

                <div className="space-y-4">
                  {[
                    { icon: CheckCircle2, text: 'Analizë falas e prezencës suaj dixhitale' },
                    { icon: Target,       text: 'Strategji e personalizuar për institucionin tuaj' },
                    { icon: TrendingUp,   text: 'Projeksion i rezultateve të pritshme' },
                    { icon: Play,         text: 'Fillojmë brenda 5 ditëve pune' },
                  ].map((item, i) => {
                    const Icon = item.icon;
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                          <Icon className="w-4 h-4 text-indigo-300" />
                        </div>
                        <span className="text-indigo-100 text-sm">{item.text}</span>
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
                  <p className="text-indigo-200 leading-relaxed">
                    Kërkesa juaj u dërgua me sukses. Ekipi ynë do t'ju kontaktojë brenda 24 orëve.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">Konsultim Falas</h3>

                  {selectedPkg && (
                    <div className="flex items-center gap-2 bg-indigo-500/20 rounded-lg px-4 py-2.5 text-sm border border-indigo-400/30">
                      <GraduationCap className="w-4 h-4 text-indigo-300" />
                      <span className="text-indigo-200">Paketa e zgjedhur: <strong className="text-white">{selectedPkg}</strong></span>
                      <button type="button" onClick={() => setSelectedPkg('')} className="ml-auto">
                        <X className="w-4 h-4 text-indigo-400 hover:text-white" />
                      </button>
                    </div>
                  )}

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-indigo-200 mb-1.5">Emri & Mbiemri *</label>
                      <input
                        required
                        type="text"
                        placeholder="Artan Hoxha"
                        value={formData.name}
                        onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                        className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-indigo-300/60 text-sm focus:outline-none focus:border-indigo-400 focus:bg-white/15 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-indigo-200 mb-1.5">Telefon *</label>
                      <input
                        required
                        type="tel"
                        placeholder="+355 69 XXX XXXX"
                        value={formData.phone}
                        onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))}
                        className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-indigo-300/60 text-sm focus:outline-none focus:border-indigo-400 focus:bg-white/15 transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-indigo-200 mb-1.5">Email *</label>
                    <input
                      required
                      type="email"
                      placeholder="info@shkolla-juaj.al"
                      value={formData.email}
                      onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-indigo-300/60 text-sm focus:outline-none focus:border-indigo-400 focus:bg-white/15 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-indigo-200 mb-1.5">Emri i Institucionit *</label>
                    <input
                      required
                      type="text"
                      placeholder="Akademia 'Mendimi' / Kursi IT Pro..."
                      value={formData.school}
                      onChange={e => setFormData(p => ({ ...p, school: e.target.value }))}
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-indigo-300/60 text-sm focus:outline-none focus:border-indigo-400 focus:bg-white/15 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-indigo-200 mb-1.5">Mesazhi (opsional)</label>
                    <textarea
                      rows={3}
                      placeholder="Tregoni pak për institucionin dhe sfidat kryesore..."
                      value={formData.message}
                      onChange={e => setFormData(p => ({ ...p, message: e.target.value }))}
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-indigo-300/60 text-sm focus:outline-none focus:border-indigo-400 focus:bg-white/15 transition-colors resize-none"
                    />
                  </div>

                  {formError && (
                    <p className="text-red-300 text-sm bg-red-500/10 rounded-lg px-4 py-2">{formError}</p>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-white text-indigo-700 font-bold py-4 rounded-xl hover:bg-indigo-50 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-60 text-sm"
                  >
                    {submitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-indigo-400/30 border-t-indigo-600 rounded-full animate-spin" />
                        Duke dërguar...
                      </>
                    ) : (
                      <>
                        <ArrowUpRight className="w-5 h-5" />
                        Dërgo Kërkesën — Falas
                      </>
                    )}
                  </button>

                  <p className="text-xs text-indigo-300/70 text-center">
                    Pa detyrim. Ju kontaktojmë brenda 24 orëve.
                  </p>
                </form>
              )}
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="bg-indigo-950 border-t border-indigo-900 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-indigo-400">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-indigo-500 to-violet-600 rounded flex items-center justify-center">
              <GraduationCap className="w-3.5 h-3.5 text-white" />
            </div>
            <span>&copy; {new Date().getFullYear()} FivoCRM. Të gjitha të drejtat e rezervuara.</span>
          </div>
          <div className="flex items-center gap-6">
            <Link to="/login" className="hover:text-white transition-colors">Hyrje</Link>
            <a href="#packages" className="hover:text-white transition-colors">Çmimet</a>
            <a href="#contact" className="hover:text-white transition-colors">Kontakt</a>
          </div>
        </div>
      </footer>

    </div>
  );
};

export default EducationLandingPage;
