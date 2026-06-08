import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Sun, TrendingUp, Shield, CheckCircle2, ArrowRight,
  Star, Users, Target, Clock, ChevronDown, Phone,
  ArrowUpRight, Sparkles, Camera, Megaphone, BarChart3,
  X, Lock, Search, Share2, Mail, MousePointerClick, MapPin,
} from 'lucide-react';

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
function Counter({ end, suffix = '', duration = 2000 }: { end: number; suffix?: string; duration?: number }) {
  const { ref, visible } = useInView();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!visible) return; let start = 0; const step = end / (duration / 16);
    const timer = setInterval(() => { start += step; if (start >= end) { setCount(end); clearInterval(timer); } else setCount(Math.floor(start)); }, 16);
    return () => clearInterval(timer);
  }, [visible, end, duration]);
  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

/* ═══════════════════════════════════════════════
   Paketat — Marketing për prodhues pergolash, kangjellash xhami & tendash
   ═══════════════════════════════════════════════ */
interface Pkg {
  id: string;
  title: string;
  subtitle: string;
  price: string;
  priceNote: string;
  popular?: boolean;
  badge?: string;
  color: string;
  border: string;
  ring: string;
  cta: string;
  targetAudience: string[];
  features: { category: string; items: string[] }[];
  notIncluded: string[];
}

const PACKAGES: Pkg[] = [
  {
    id: 'baze',
    title: 'Bazë',
    subtitle: 'Prezencë profesionale dhe kërkesat e para',
    price: '650€',
    priceNote: '/ muaj + buxhet reklamash',
    color: 'from-zinc-500 to-slate-600',
    border: 'border-zinc-200 hover:border-zinc-400',
    ring: 'ring-zinc-400',
    cta: 'Fillo me Bazë',
    targetAudience: [
      'Prodhues të rinj që duan prani online',
      'Biznese të vogla familjare',
      'Ata që sapo nisin marketingun dixhital',
    ],
    features: [
      { category: 'Rrjete Sociale', items: [
        'Menaxhim Facebook + Instagram',
        '10 postime / muaj',
        '6 reels / muaj',
        '1 ditë xhirimi produktesh / muaj',
        'Dizajn grafik & tekste profesionale',
        'Kalendar mujor publikimi',
      ] },
      { category: 'SEO (Google & Maps)', items: [
        'Audit teknik i website-it',
        'Krijim & optimizim i Google Maps (Business Profile)',
        '15 fjalë kyçe të zonës suaj',
        'Optimizim On-page',
        '1 artikull blog / muaj',
      ] },
      { category: 'Google Ads', items: [
        'Konfigurim i fushatave',
        '1 fushatë aktive për gjenerim kërkesash',
        'Targetim lokal i saktë',
      ] },
      { category: 'Email Marketing', items: [
        'Ndërtim i listës së kontakteve',
        '1 newsletter / muaj me oferta & projekte',
        'Shabllone profesionale',
      ] },
    ],
    notIncluded: [
      'Buxheti i reklamave (ad spend)',
      'Video kinematike / me dron ajror',
      'Automatizim email-i & fushata ndërkombëtare',
    ],
  },
  {
    id: 'rritje',
    title: 'Rritje',
    subtitle: 'Rritje e qëndrueshme e kërkesave dhe projekteve',
    price: '1,200€',
    priceNote: '/ muaj + buxhet reklamash',
    popular: true,
    badge: 'Më e Zgjedhura',
    color: 'from-amber-500 to-orange-600',
    border: 'border-amber-300 hover:border-amber-500',
    ring: 'ring-amber-400',
    cta: 'Zgjidh Rritje',
    targetAudience: [
      'Prodhues në rritje me portofol projektesh',
      'Biznese që synojnë hotele, restorante & resorte',
      'Ata që duan kërkesa të rregullta çdo javë',
    ],
    features: [
      { category: 'Rrjete Sociale', items: [
        'Menaxhim Facebook + Instagram + TikTok',
        '16 postime / muaj',
        '12 reels / muaj',
        '1–2 video prezantuese profesionale / muaj',
        'Case studies nga projektet reale',
        'Community management aktiv',
      ] },
      { category: 'SEO (Google & Maps)', items: [
        'SEO i plotë On-page & Off-page',
        'Dominim lokal në Google Maps',
        '30+ fjalë kyçe',
        '2 artikuj blog / muaj',
        'Ndërtim backlink-esh (autoritet)',
      ] },
      { category: 'Google Ads', items: [
        'Menaxhim i plotë i fushatave',
        '3–4 fushata aktive',
        'Retargeting i vizitorëve',
        'Targetim: hotele, restorante & bujtina',
      ] },
      { category: 'Email Marketing', items: [
        '2 fushata / muaj',
        'Segmentim B2B (hotele & biznese)',
        'Shabllone të personalizuara',
        'Raport hapjesh & klikimesh',
      ] },
    ],
    notIncluded: [
      'Buxheti i reklamave (ad spend)',
      'Video me dron ajror (si shtesë)',
      'Zhvillim website-i',
    ],
  },
  {
    id: 'dominim',
    title: 'Dominim',
    subtitle: 'Dominim i plotë i tregut në zonën tuaj',
    price: '2,000€',
    priceNote: '/ muaj + buxhet reklamash',
    badge: 'Maksimum Rezultate',
    color: 'from-orange-600 to-red-600',
    border: 'border-orange-300 hover:border-orange-500',
    ring: 'ring-orange-400',
    cta: 'Zgjidh Dominim',
    targetAudience: [
      'Prodhues premium me brand të fortë',
      'Kompani me instalime në disa qytete',
      'Ata që duan epërsi të qartë ndaj konkurrencës',
    ],
    features: [
      { category: 'Rrjete Sociale', items: [
        'Menaxhim FB + Instagram + TikTok + YouTube',
        '24 postime / muaj',
        '20 reels / muaj',
        'Video kinematike me dron ajror',
        'Case studies premium & PR',
        'Bashkëpunime me influencerë & arkitektë',
      ] },
      { category: 'SEO (Google & Maps)', items: [
        'SEO premium shumë-qytetësh',
        'Dominim i plotë në Google Maps',
        '60+ fjalë kyçe',
        '4 artikuj blog / muaj',
        'Ndërtim i autoritetit të domenit',
      ] },
      { category: 'Google Ads', items: [
        'Meta + Google + YouTube Ads',
        'Fushata pa limit',
        'A/B testing i kreativëve',
        'Optimizim ditor i performancës',
      ] },
      { category: 'Email Marketing', items: [
        'Automatizim i plotë (drip campaigns)',
        'Integrim me CRM & ndjekje e kërkesave',
        'Follow-up automatik i klientëve',
        'Raport mujor i kthimit nga investimi (ROI)',
      ] },
    ],
    notIncluded: [
      'Buxheti i reklamave (ad spend)',
      'Zhvillim website-i (si projekt veçmas)',
    ],
  },
];

const SERVICES = [
  {
    icon: Share2,
    title: 'Menaxhimi i Rrjeteve Sociale',
    desc: 'Përgatisim një plan marketingu të dedikuar për ju. Fokusi është te prezantimi i produkteve dhe case studies nga projektet reale. Një video prezantuese e fuqishme sponsorizohet me target të saktë — hotele, restorante, bujtina dhe biznese që kërkojnë zgjidhje cilësore outdoor.',
  },
  {
    icon: Search,
    title: 'SEO — Google & Maps',
    desc: 'Synojmë vendin e parë në Google dhe në Google Maps për kërkimet kyçe të zonës suaj. SEO është investim afatgjatë: rezultatet e qëndrueshme ndërtohen brenda 3 muajve, por pastaj mbeten tuajat për vite me radhë.',
  },
  {
    icon: MousePointerClick,
    title: 'Google Ads',
    desc: 'Kur ju duhen rezultate të shpejta, Google Ads i sjell. Klientin që kërkon "pergola", "tendë" ose "kangjella xhami" pikërisht në çastin e vendimit, e drejtojmë te ju — brenda ditësh, jo muajsh.',
  },
  {
    icon: Mail,
    title: 'Email Marketing',
    desc: 'Ofertat sezonale, projektet e reja dhe case studies shkojnë drejtpërdrejt te baza juaj e kontakteve — hotele, arkitektë dhe biznese — duke i kthyer kontaktet e vjetra në porosi të reja.',
  },
];

const RESULTS = [
  { metric: '60', suffix: '+', label: 'Biznese prodhuese të promovuara', icon: Users },
  { metric: '80', suffix: '%', label: 'Klientë me rritje kërkesash brenda 90 ditësh', icon: Target },
  { metric: '4.3', suffix: 'x', label: 'Rritje e vizitave nga Google & Maps', icon: TrendingUp },
  { metric: '90', suffix: ' ditë', label: 'Deri te dominimi në SEO lokal', icon: MapPin },
];

const PAIN_POINTS = [
  {
    icon: Search,
    title: 'Produkte të jashtëzakonshme, por të padukshme',
    desc: 'Punoni pergola, kangjella e tenda që duken mrekullueshëm — por kur dikush kërkon në Google, del konkurrenti, jo ju. Cilësia juaj mbetet e fshehur.',
  },
  {
    icon: Users,
    title: 'Hotelet & restorantet po i merr tjetri',
    desc: 'Projektet më fitimprurëse janë te bizneset: hotele, restorante, bujtina. Pa një prezencë profesionale, ato kontrata po shkojnë te kompanitë që duken më seriozisht online.',
  },
  {
    icon: Clock,
    title: 'Mbështeteni vetëm te "goja-më-gojë"',
    desc: 'Rekomandimet janë të mira, por të paparashikueshme. Pa marketing të rregullt, disa muaj jeni plot, disa muaj prisni — dhe rritja mbetet e bllokuar.',
  },
];

const PROCESS_STEPS = [
  { step: '01', title: 'Analizë & Strategji', desc: 'Studiojmë produktet tuaja, klientët ideal (hotele, restorante, bujtina, vila) dhe konkurrencën. Hartojmë një plan marketingu të qartë e të matshëm.', icon: Target },
  { step: '02', title: 'Prodhim Përmbajtjeje', desc: 'Xhirojmë foto dhe video profesionale të produkteve e instalimeve reale. Ndërtojmë case studies që e tregojnë cilësinë dhe bindin.', icon: Camera },
  { step: '03', title: 'Reklamim & SEO', desc: 'Lançojmë fushata Meta & Google Ads me target të saktë dhe forcojmë praninë në Google e Maps për kërkimet kyçe.', icon: Megaphone },
  { step: '04', title: 'Optimizim & Raportim', desc: 'Monitorojmë çdo javë, optimizojmë fushatat dhe raportojmë me transparencë të plotë kërkesat e gjeneruara.', icon: BarChart3 },
];

const TESTIMONIALS = [
  {
    name: 'Klodian Meta',
    role: 'Pronar, MetalDesign Pergola',
    quote: 'Videoja prezantuese që xhiruan u përhap shpejt mes hotelerëve. Brenda dy muajsh morëm tri projekte të mëdha nga resorte bregdetare. Investimi u kthye menjëherë.',
    rating: 5,
    avatar: 'KM',
  },
  {
    name: 'Ardit Lleshi',
    role: 'Drejtor, AluGlass Sisteme',
    quote: 'Tani dalim të parët në Google Maps për "kangjella xhami Tiranë". Kërkesat vijnë çdo javë vetë, pa pasur nevojë t\'i ndjekim ne klientët.',
    rating: 5,
    avatar: 'AL',
  },
  {
    name: 'Erjon Caka',
    role: 'Bashkëthemelues, Tenda Pro',
    quote: 'Google Ads na solli rezultate që në javën e parë. Kthimi nga investimi është i qartë: çdo euro e shpenzuar kthehet shumëfish në porosi.',
    rating: 5,
    avatar: 'EC',
  },
];

const FAQ = [
  {
    q: 'A përfshihet buxheti i reklamave në çmimin e paketës?',
    a: 'Jo. Buxheti i reklamave (ad spend) paguhet drejtpërdrejt te Meta dhe Google dhe është i ndarë nga çmimi i paketës. Ne e menaxhojmë plotësisht se si shpenzohet. Zakonisht rekomandojmë 300€–1.000€ në muaj, sipas objektivave tuaja.',
  },
  {
    q: 'Sa kohë duhet për të parë rezultate?',
    a: 'Varet nga kanali. Google Ads jep rezultatet e para brenda 1–2 javësh. Përmbajtja në rrjete sociale dhe videoja ndikojnë menjëherë te besueshmëria. SEO dhe pozicionimi në Google Maps kërkojnë rreth 3 muaj për rezultate të qëndrueshme, por pastaj mbeten të qëndrueshme për një kohë të gjatë.',
  },
  {
    q: 'A i xhironi ju vetë produktet dhe instalimet?',
    a: 'Po. Foto dhe video profesionale të produkteve e instalimeve reale përfshihen në paketë (numri i ditëve të xhirimit ndryshon sipas nivelit). Në paketën Dominim përfshihet edhe xhirimi me dron ajror.',
  },
  {
    q: 'Si i targetoni hotelet, restorantet dhe bujtinat?',
    a: 'Përmes Meta dhe Google Ads me targetim të saktë gjeografik, demografik dhe sipas interesit, të kombinuar me video të sponsorizuara që u drejtohen pikërisht vendimmarrësve të këtyre bizneseve.',
  },
  {
    q: 'A mund ta ndryshoj paketën gjatë rrugës?',
    a: 'Po, absolutisht. Mund ta përmirësoni ose ndryshoni paketën çdo muaj. Nuk ka kontratë afatgjatë — punojmë muaj pas muaji, bazuar te rezultatet.',
  },
  {
    q: 'A punoni edhe jashtë qytetit tim?',
    a: 'Po. Punojmë me prodhues në të gjithë Shqipërinë. Xhirimet bëhen me orar të dakorduar paraprakisht, ndërsa pjesa dixhitale — rrjete sociale, SEO, reklama dhe email — menaxhohet plotësisht online.',
  },
];

/* ═══════════════════════════════════════════════════════════════════════ */

export default function PergolaLandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', website: '', message: '' });
  const [formSent, setFormSent] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<Pkg | null>(null);

  const scrollToPackages = () => document.getElementById('packages')?.scrollIntoView({ behavior: 'smooth' });
  const scrollToContact = (pkg?: Pkg) => { if (pkg) setSelectedPackage(pkg); document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormError(''); setSubmitting(true);
    try {
      const res = await fetch('/api/landing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          packageId: selectedPackage?.id || '',
          packageName: selectedPackage ? `Pergola ${selectedPackage.title}` : '',
          source: 'Pergola Landing Page',
          category: 'Marketing - Pergola & Tenda',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Diçka shkoi keq');
      setFormSent(true);
    } catch (err: any) {
      setFormError(err.message || 'Diçka shkoi keq. Provoni përsëri.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans overflow-x-hidden">
      {/* ═══ NAV ═══ */}
      <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center"><Sun className="w-4 h-4 text-white" /></div>
            <span className="text-xl font-bold bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent">FivoCRM Outdoor</span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-gray-600">
            <a href="#sherbimet" className="hover:text-orange-600 transition-colors">Shërbimet</a>
            <a href="#procesi" className="hover:text-orange-600 transition-colors">Procesi</a>
            <a href="#packages" className="hover:text-orange-600 transition-colors">Paketat</a>
            <a href="#deshmite" className="hover:text-orange-600 transition-colors">Dëshmitë</a>
            <a href="#faq" className="hover:text-orange-600 transition-colors">Pyetjet</a>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="hidden sm:inline-flex text-sm font-medium text-gray-600 hover:text-orange-600 transition-colors">Hyr</Link>
            <button onClick={() => scrollToContact()} className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-amber-500 to-orange-600 hover:shadow-lg hover:shadow-orange-500/25 transition-all hover:-translate-y-0.5">Konsultim Falas</button>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-amber-50/70 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-amber-200/30 rounded-full blur-3xl" />
        <div className="absolute top-40 right-0 w-[400px] h-[400px] bg-orange-200/20 rounded-full blur-3xl" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-50 border border-amber-100 mb-8">
                <div className="flex -space-x-2">{['KM', 'AL', 'EC', 'BD'].map((ini, i) => (<div key={i} className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 border-2 border-white flex items-center justify-center text-[10px] font-bold text-white">{ini}</div>))}</div>
                <span className="text-sm font-medium text-amber-700">60+ biznese prodhuese na besojnë</span>
                <div className="flex">{[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}</div>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                Pergolat, kangjellat dhe tendat tuaja meritojnë{' '}
                <span className="bg-gradient-to-r from-amber-600 via-orange-600 to-red-500 bg-clip-text text-transparent">klientët e duhur</span>.
                <br /><span className="text-gray-400">A po i marrin?</span>
              </h1>
            </FadeIn>
            <FadeIn delay={200}>
              <p className="mt-8 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
                Çdo ditë, hotele, restorante dhe familje kërkojnë zgjidhje cilësore outdoor në Google dhe Instagram. Pa një prezencë profesionale,{' '}
                <strong className="text-orange-600">ata po zgjedhin konkurrentin tuaj.</strong>
              </p>
            </FadeIn>
            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button onClick={scrollToPackages} className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:shadow-xl hover:shadow-orange-500/25 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">Shiko Paketat<ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></button>
                <button onClick={() => scrollToContact()} className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border-2 border-gray-200 hover:border-orange-300 hover:bg-orange-50 transition-all flex items-center justify-center gap-2"><Phone className="w-5 h-5" />Konsultim Falas</button>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-400">
                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-500" /> Pa kontratë afatgjatë</span>
                <span className="flex items-center gap-1.5"><Lock className="w-4 h-4 text-blue-500" /> Buxhet reklamash i veçantë</span>
                <span className="flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-orange-500" /> Të 4 shërbimet në një paketë</span>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ PIKAT E DHIMBJES ═══ */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-red-500 mb-3">A e njihni këtë situatë?</p><h2 className="text-3xl sm:text-4xl font-bold">Cilësia juaj po mbetet <span className="text-red-500">pa u parë</span></h2></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {PAIN_POINTS.map((point, i) => (
              <FadeIn key={i} delay={i * 150}><div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 hover:shadow-lg hover:border-red-100 transition-all h-full"><div className="w-14 h-14 rounded-xl bg-red-50 flex items-center justify-center mb-6"><point.icon className="w-7 h-7 text-red-500" /></div><h3 className="text-xl font-bold mb-3">{point.title}</h3><p className="text-gray-600 leading-relaxed">{point.desc}</p></div></FadeIn>
            ))}
          </div>
          <FadeIn delay={500}><div className="mt-12 text-center"><p className="text-lg text-gray-700 font-medium">Lajmi i mirë? <span className="text-orange-600 font-bold">Ne i kthejmë produktet tuaja në kërkesa konkrete.</span></p></div></FadeIn>
        </div>
      </section>

      {/* ═══ ÇFARË BËJMË ═══ */}
      <section id="sherbimet" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-orange-600 mb-3">Çfarë bëjmë për ju</p><h2 className="text-3xl sm:text-4xl font-bold">Katër shërbime, një strategji e vetme</h2><p className="mt-4 text-gray-600 max-w-2xl mx-auto">Çdo paketë i ndërthur të katër shërbimet — secili me peshën e duhur, që puna juaj e mirë të kthehet në porosi.</p></div></FadeIn>
          <div className="grid md:grid-cols-2 gap-6">
            {SERVICES.map((s, i) => (
              <FadeIn key={i} delay={i * 120}>
                <div className="h-full p-8 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg hover:border-orange-100 transition-all">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center flex-shrink-0"><s.icon className="w-6 h-6 text-white" /></div>
                    <div>
                      <h3 className="text-xl font-bold mb-2">{s.title}</h3>
                      <p className="text-gray-600 leading-relaxed">{s.desc}</p>
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ REZULTATET ═══ */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-orange-600 mb-3">Rezultate të vërteta</p><h2 className="text-3xl sm:text-4xl font-bold">Numrat flasin më shumë se fjalët</h2></div></FadeIn>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {RESULTS.map((r, i) => (
              <FadeIn key={i} delay={i * 100}><div className="text-center p-8 rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100"><r.icon className="w-8 h-8 text-orange-600 mx-auto mb-4" /><div className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent"><Counter end={parseFloat(r.metric)} suffix={r.suffix} /></div><p className="mt-3 text-sm text-gray-600 font-medium">{r.label}</p></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PROCESI ═══ */}
      <section id="procesi" className="py-24 bg-zinc-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-orange-400 mb-3">Si punojmë</p><h2 className="text-3xl sm:text-4xl font-bold">4 hapa nga produkti te porosia</h2><p className="mt-4 text-gray-400 max-w-xl mx-auto">Një proces i provuar, i ndërtuar posaçërisht për prodhuesit e zgjidhjeve outdoor.</p></div></FadeIn>
          <div className="grid md:grid-cols-4 gap-6 relative">
            <div className="hidden md:block absolute top-16 left-[12%] right-[12%] h-px bg-gradient-to-r from-amber-500/50 via-orange-500/50 to-amber-500/50" />
            {PROCESS_STEPS.map((s, i) => (
              <FadeIn key={i} delay={i * 150}><div className="relative text-center p-6 rounded-2xl bg-zinc-800/60 border border-zinc-700 hover:border-orange-500/50 transition-all group"><div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center mx-auto mb-4 text-lg font-bold relative z-10">{s.step}</div><s.icon className="w-6 h-6 text-orange-400 mx-auto mb-3 group-hover:scale-110 transition-transform" /><h3 className="text-lg font-bold mb-2">{s.title}</h3><p className="text-gray-400 text-sm leading-relaxed">{s.desc}</p></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PAKETAT ═══ */}
      <section id="packages" className="py-24 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-orange-600 mb-3">Paketat</p><h2 className="text-3xl sm:text-4xl font-bold">Zgjidhni paketën e duhur për biznesin tuaj</h2><p className="mt-4 text-gray-600 max-w-2xl mx-auto">Të tria paketat përfshijnë të 4 shërbimet — rrjete sociale, SEO, Google Ads dhe email marketing. Ndryshon vetëm intensiteti. Çmimet nuk përfshijnë buxhetin e reklamave.</p></div></FadeIn>
          <div className="grid lg:grid-cols-3 gap-6 items-start">
            {PACKAGES.map((pkg, i) => {
              const isSelected = selectedPackage?.id === pkg.id;
              return (
                <FadeIn key={pkg.id} delay={i * 120}>
                  <div className={`relative rounded-2xl bg-white border-2 ${pkg.border} transition-all hover:shadow-2xl flex flex-col h-full ${pkg.popular ? `shadow-xl ring-2 ${pkg.ring}/20 lg:-mt-3 lg:mb-3` : 'shadow-sm'} ${isSelected ? 'ring-2 ring-green-500' : ''}`}>
                    {pkg.badge && (<div className={`absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-gradient-to-r ${pkg.color} text-white text-xs font-bold tracking-wide whitespace-nowrap`}>{pkg.badge}</div>)}
                    <div className="p-6 flex flex-col h-full">
                      <h3 className="text-2xl font-bold">{pkg.title}</h3>
                      <p className="text-sm text-gray-500 mt-1">{pkg.subtitle}</p>
                      <div className="mt-5 flex items-baseline gap-1.5"><span className={`text-4xl font-bold bg-gradient-to-r ${pkg.color} bg-clip-text text-transparent`}>{pkg.price}</span><span className="text-sm text-gray-500">{pkg.priceNote}</span></div>

                      <div className="mt-4 p-3 rounded-lg bg-gray-50">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Ideale për:</p>
                        <ul className="space-y-1">{pkg.targetAudience.map((a, ti) => (<li key={ti} className="text-xs text-gray-600 flex items-start gap-1.5"><span className="text-orange-500 mt-0.5">•</span>{a}</li>))}</ul>
                      </div>

                      <div className="mt-5 space-y-4 flex-1">
                        {pkg.features.map((cat, ci) => (
                          <div key={ci}>
                            <p className={`text-xs font-bold uppercase tracking-wide mb-2 bg-gradient-to-r ${pkg.color} bg-clip-text text-transparent`}>{cat.category}</p>
                            <ul className="space-y-2">{cat.items.map((feature, fi) => (<li key={fi} className="flex items-start gap-2 text-sm text-gray-700"><CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${pkg.popular ? 'text-orange-500' : 'text-green-500'}`} />{feature}</li>))}</ul>
                          </div>
                        ))}
                        {pkg.notIncluded.length > 0 && (
                          <div className="pt-4 border-t border-gray-100">
                            <p className="text-xs font-semibold uppercase tracking-wide text-red-400 mb-2">Nuk përfshihet:</p>
                            <ul className="space-y-1.5">{pkg.notIncluded.map((item, ni) => (<li key={ni} className="flex items-start gap-2 text-xs text-gray-400"><X className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-red-300" />{item}</li>))}</ul>
                          </div>
                        )}
                      </div>

                      <button onClick={() => scrollToContact(pkg)} className={`mt-6 w-full py-3.5 rounded-xl text-sm font-semibold transition-all hover:-translate-y-0.5 ${pkg.popular ? `bg-gradient-to-r ${pkg.color} text-white hover:shadow-lg hover:shadow-orange-500/25` : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}>{isSelected ? '✓ Zgjedhur' : pkg.cta}</button>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>
          <FadeIn delay={500}><p className="mt-10 text-center text-sm text-gray-500">Të gjitha çmimet janë në Euro (€) dhe pa TVSH. Buxheti i reklamave (ad spend) paguhet veçmas, drejtpërdrejt te Meta/Google. Faturim mujor, pa kontratë afatgjatë.</p></FadeIn>
        </div>
      </section>

      {/* ═══ DËSHMITË ═══ */}
      <section id="deshmite" className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-orange-600 mb-3">Dëshmi klientësh</p><h2 className="text-3xl sm:text-4xl font-bold">Çfarë thonë prodhuesit që punojnë me ne</h2></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {TESTIMONIALS.map((t, i) => (
              <FadeIn key={i} delay={i * 150}><div className="p-8 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg transition-all h-full flex flex-col"><div className="flex mb-4">{Array.from({ length: t.rating }).map((_, j) => (<Star key={j} className="w-5 h-5 text-amber-400 fill-amber-400" />))}</div><p className="text-gray-700 leading-relaxed flex-1 italic">"{t.quote}"</p><div className="mt-6 flex items-center gap-3 pt-4 border-t border-gray-100"><div className="w-11 h-11 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white font-bold text-sm">{t.avatar}</div><div><p className="font-semibold text-sm">{t.name}</p><p className="text-xs text-gray-500">{t.role}</p></div></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-orange-600 mb-3">Pyetjet e shpeshta</p><h2 className="text-3xl sm:text-4xl font-bold">Gjithçka që duhet të dini</h2></div></FadeIn>
          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <FadeIn key={i} delay={i * 80}><div className="bg-white rounded-xl border border-gray-100 overflow-hidden"><button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"><span className="font-semibold text-gray-900 pr-4">{item.q}</span><ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} /></button><div className={`transition-all duration-300 overflow-hidden ${openFaq === i ? 'max-h-72 opacity-100' : 'max-h-0 opacity-0'}`}><p className="px-6 pb-5 text-gray-600 leading-relaxed">{item.a}</p></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ KONTAKT ═══ */}
      <section id="contact" className="py-24 bg-gradient-to-br from-zinc-900 via-orange-950 to-zinc-900 text-white relative overflow-hidden">
        <div className="absolute inset-0"><div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-orange-500/10 rounded-full blur-3xl" /><div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-amber-500/10 rounded-full blur-3xl" /></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-orange-400 mb-4">Gati për të filluar?</p>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">Le ta kthejmë cilësinë tuaj në <span className="text-orange-400">kërkesa konkrete</span></h2>
                <p className="mt-5 text-gray-300 leading-relaxed text-lg">Plotësoni formularin dhe merrni një konsultim falas me ekipin tonë. Do të analizojmë prezencën tuaj online dhe do t'ju tregojmë mundësitë konkrete për të tërhequr hotele, restorante dhe klientë premium.</p>
                <div className="mt-8 space-y-4">
                  <div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">Auditim falas i prezencës suaj dixhitale</span></div>
                  <div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">Analizë e konkurrentëve në zonën tuaj</span></div>
                  <div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">Propozim strategjie pa asnjë detyrim</span></div>
                </div>
                <div className="mt-10 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30"><p className="text-sm text-amber-300 font-medium flex items-center gap-2"><Clock className="w-4 h-4" />Kapacitet i kufizuar: pranojmë vetëm 6 prodhues të rinj çdo muaj.</p></div>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              {formSent ? (
                <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-10 border border-white/10 text-center"><div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6"><CheckCircle2 className="w-10 h-10 text-green-400" /></div><h3 className="text-2xl font-bold mb-3">Faleminderit!</h3><p className="text-gray-300">Kërkesa juaj u dërgua me sukses. Ekipi ynë do t'ju kontaktojë brenda 24 orëve.</p></div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">Merrni konsultimin falas</h3>
                  {selectedPackage && (<div className="flex items-center justify-between px-4 py-3 rounded-xl bg-orange-500/20 border border-orange-500/30"><div><p className="text-xs text-orange-300">Paketa e zgjedhur</p><p className="font-semibold text-white">{selectedPackage.title} — {selectedPackage.price} {selectedPackage.priceNote}</p></div><button type="button" onClick={() => setSelectedPackage(null)} className="text-orange-300 hover:text-white text-sm underline">Ndrysho</button></div>)}
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Emri i plotë *</label><input type="text" required value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500" placeholder="Emër Mbiemër" /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Email *</label><input type="email" required value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500" placeholder="email@kompania.al" /></div>
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Telefon</label><input type="tel" value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500" placeholder="+355 6X XXX XXXX" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Website / Instagram (nëse keni)</label><input type="text" value={formData.website} onChange={e => setFormData(p => ({ ...p, website: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500" placeholder="https://shembull.al ose @instagram" /></div>
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Mesazh (opsional)</label><textarea rows={3} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none" placeholder="Na tregoni shkurt për produktet dhe objektivat tuaja..." /></div>
                  {formError && (<div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">{formError}</div>)}
                  <button type="submit" disabled={submitting} className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white shadow-lg shadow-orange-500/25 transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60">{submitting ? 'Duke dërguar...' : 'Dërgo Kërkesën'}{!submitting && <ArrowUpRight className="w-5 h-5" />}</button>
                  <p className="text-xs text-gray-400 text-center">Duke dërguar, pranoni politikën e privatësisë. Nuk do të merrni mesazhe të padëshiruara.</p>
                </form>
              )}
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="py-10 bg-zinc-950 text-gray-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2"><div className="w-6 h-6 rounded bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center"><Sun className="w-3 h-3 text-white" /></div><span className="font-semibold text-white text-sm">FivoCRM Outdoor</span></div>
          <p className="text-sm">&copy; {new Date().getFullYear()} FivoCRM. Të gjitha të drejtat e rezervuara.</p>
          <div className="flex items-center gap-6 text-sm"><Link to="/login" className="hover:text-white transition-colors">Hyrje</Link><a href="#packages" className="hover:text-white transition-colors">Çmimet</a><a href="#contact" className="hover:text-white transition-colors">Kontakt</a></div>
        </div>
      </footer>
    </div>
  );
}
