import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, TrendingUp, Shield, Zap, CheckCircle2, ArrowRight,
  Star, Users, Target, Clock, Award, ChevronDown, Phone,
  ArrowUpRight, Sparkles, Eye, MousePointer, LineChart, Lock,
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

/* ─── SEO Packages (fallback when API has no data) ─── */
const FALLBACK_PACKAGES = [
  {
    id: 'starter',
    title: 'SEO Starter',
    description: 'Për biznese të reja që duan praninë online',
    price: 29_900,
    currency: 'ALL',
  },
  {
    id: 'professional',
    title: 'SEO Professional',
    description: 'Për biznese që duan rritje të qëndrueshme',
    price: 59_900,
    currency: 'ALL',
  },
  {
    id: 'enterprise',
    title: 'SEO Enterprise',
    description: 'Dominim total i tregut dixhital',
    price: 119_900,
    currency: 'ALL',
  },
];

interface SeoPackage {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
}

/* Card styling by position index */
const CARD_STYLES = [
  { color: 'from-blue-500 to-cyan-500', border: 'border-blue-200 hover:border-blue-400', badge: null as string | null, popular: false, cta: 'Fillo Tani' },
  { color: 'from-purple-600 to-indigo-600', border: 'border-purple-300 hover:border-purple-500', badge: 'Më i Popullarizuari', popular: true, cta: 'Zgjidh Këtë Paket' },
  { color: 'from-amber-500 to-orange-600', border: 'border-amber-200 hover:border-amber-400', badge: 'ROI Maksimal', popular: false, cta: 'Kontakto për Detaje' },
];

const RESULTS = [
  { metric: '347', suffix: '%', label: 'Rritje mesatare e trafikut organik', icon: TrendingUp },
  { metric: '89', suffix: '%', label: 'Klientë që arrijnë Faqen 1 të Google', icon: Award },
  { metric: '2.4', suffix: 'x', label: 'Rritje e konvertimeve', icon: Target },
  { metric: '150', suffix: '+', label: 'Biznese të kënaqura', icon: Users },
];

const PAIN_POINTS = [
  { icon: Eye, title: 'Faqja jote është e padukshme', desc: 'Klientët tuaj po kërkojnë çdo ditë shërbimet që ti ofron — por po i gjejnë tek konkurrentët.' },
  { icon: MousePointer, title: 'Trafikun e paguan shumë shtrenjtë', desc: 'Reklama me pagesë po bëhen gjithnjë e më të shtrenjta. SEO organik sjell klientë FALAS, çdo ditë, pa pushim.' },
  { icon: Clock, title: 'Po humbet kohë me taktika jo-efektive', desc: 'Pa një strategji profesionale SEO, çdo përpjekje tjetër marketingu prodhon rezultate minimale.' },
];

const PROCESS_STEPS = [
  { step: '01', title: 'Audit & Analizë', desc: 'Analizojmë faqen, konkurrentët, dhe fjalët kyçe me ROI më të lartë.' , icon: Search },
  { step: '02', title: 'Strategji e Personalizuar', desc: 'Ndërtojmë hartën e rrugës SEO të përshtatur për biznesin tuaj.', icon: Target },
  { step: '03', title: 'Implementim', desc: 'Ekipi ynë zbaton optimizimet teknike, përmbajtjen, dhe linkbuilding.', icon: Zap },
  { step: '04', title: 'Monitorim & Rritje', desc: 'Ndjekim rezultatet çdo javë dhe përshtatim strategjinë për rritje të vazhdueshme.', icon: LineChart },
];

const TESTIMONIALS = [
  {
    name: 'Arben Krasniqi',
    role: 'CEO, TechHub Albania',
    quote: 'Brenda 4 muajve kaluan nga faqja 5 e Google në pozitën #2. Trafiku u rrit 420% dhe kemi klientë të rinj çdo javë.',
    rating: 5,
    avatar: 'AK',
  },
  {
    name: 'Elena Hoxha',
    role: 'Drejtoreshë, Boutique Elegance',
    quote: 'Investimi më i mirë që kemi bërë. SEO-ja solli 68% të klientëve tanë online pa shpenzuar asnjë lek reklamë.',
    rating: 5,
    avatar: 'EH',
  },
  {
    name: 'Dritan Muça',
    role: 'Themelues, Digital Solutions',
    quote: 'Profesionalizëm i jashtëzakonshëm. Raportet javore na mbajnë të informuar dhe rezultatet flasin vetë.',
    rating: 5,
    avatar: 'DM',
  },
];

const FAQ = [
  { q: 'Sa kohë duhet për të parë rezultate?', a: 'SEO organike kërkon zakonisht 3-6 muaj për rezultate të qenësishme. Megjithatë, përmirësimet teknike mund të ndikojnë brenda javëve të para. Ne japim raporte javore për ta ndjekur progresin nga dita e parë.' },
  { q: 'A garanton pozitën #1 në Google?', a: 'Askush nuk mund ta garantojë, sepse algoritmi i Google ndryshon vazhdimisht. Ajo çfarë garantojmë është metodologji e provuar, transparencë e plotë, dhe punë e palodhur derisa të arrjiini objektivat.' },
  { q: 'A mund ta ndryshoj paketin gjatë rrugës?', a: 'Absolutisht. Mund të upgradon ose downgradon paketin kur të duash. Ne përshtatemi me nevojat e biznesit tuaj.' },
  { q: 'Çfarë ndodh nëse ndaloj SEO-në?', a: 'Renditja organike nuk zhduket menjëherë — ajo bien ngadalë nëse konkurrentët vazhdojnë të investojnë. Rekomandjomë një investim minimal vazhdueshëm për mbajtjen e pozitave.' },
  { q: 'A punoni me biznese jashtë Shqipërisë?', a: 'Po! Kemi eksperiencë me SEO lokale dhe ndërkombëtare. Na kontaktoni për të diskutuar nevojat tuaja specifike.' },
];

export default function SeoLandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', website: '', message: '' });
  const [formSent, setFormSent] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<SeoPackage | null>(null);
  const [packages, setPackages] = useState<SeoPackage[]>(FALLBACK_PACKAGES);

  // Fetch real SEO packages from CRM
  useEffect(() => {
    fetch('/api/landing?category=SEO')
      .then(r => r.json())
      .then(data => {
        if (data.services?.length) {
          setPackages(data.services);
        }
      })
      .catch(() => { /* keep fallback packages */ });
  }, []);

  const scrollToPackages = () => {
    document.getElementById('packages')?.scrollIntoView({ behavior: 'smooth' });
  };
  const scrollToContact = (pkg?: SeoPackage) => {
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
          packageName: selectedPackage?.title || '',
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
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center">
              <Search className="w-4 h-4 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
              FivoCRM SEO
            </span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
            <a href="#results" className="hover:text-purple-600 transition-colors">Rezultatet</a>
            <a href="#process" className="hover:text-purple-600 transition-colors">Procesi</a>
            <a href="#packages" className="hover:text-purple-600 transition-colors">Paketat</a>
            <a href="#testimonials" className="hover:text-purple-600 transition-colors">Dëshmitë</a>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="hidden sm:inline-flex text-sm font-medium text-gray-600 hover:text-purple-600 transition-colors"
            >
              Hyr
            </Link>
            <button
              onClick={() => scrollToContact()}
              className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:shadow-lg hover:shadow-purple-500/25 transition-all duration-300 hover:-translate-y-0.5"
            >
              Fillo Tani
            </button>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 bg-gradient-to-b from-purple-50/80 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-purple-200/30 rounded-full blur-3xl" />
        <div className="absolute top-40 right-0 w-[400px] h-[400px] bg-blue-200/20 rounded-full blur-3xl" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            {/* Social proof badge */}
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-50 border border-purple-100 mb-8">
                <div className="flex -space-x-2">
                  {['AK', 'EH', 'DM', 'FL'].map((initials, i) => (
                    <div key={i} className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 border-2 border-white flex items-center justify-center text-[10px] font-bold text-white">
                      {initials}
                    </div>
                  ))}
                </div>
                <span className="text-sm font-medium text-purple-700">
                  150+ biznese na besojnë
                </span>
                <div className="flex">
                  {[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}
                </div>
              </div>
            </FadeIn>

            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                Konkurrentët tuaj janë në{' '}
                <span className="relative">
                  <span className="bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 bg-clip-text text-transparent">
                    Faqen 1
                  </span>
                  <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 300 12" fill="none">
                    <path d="M2 8 C60 2, 120 2, 150 6 S240 10, 298 4" stroke="url(#underline-grad)" strokeWidth="3" strokeLinecap="round" />
                    <defs><linearGradient id="underline-grad" x1="0" y1="0" x2="300" y2="0"><stop offset="0%" stopColor="#9333ea"/><stop offset="100%" stopColor="#3b82f6"/></linearGradient></defs>
                  </svg>
                </span>
                {' '}të Google.
                <br />
                <span className="text-gray-400">Ti ku je?</span>
              </h1>
            </FadeIn>

            <FadeIn delay={200}>
              <p className="mt-8 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
                Çdo ditë, <strong className="text-gray-900">mijëra klientë potencialë</strong> kërkojnë shërbime si të tuat në Google.
                Pa SEO profesionale, ata po shkojnë tek konkurrentët tuaj. 
                <strong className="text-purple-600"> Ne e ndryshojmë këtë.</strong>
              </p>
            </FadeIn>

            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button
                  onClick={scrollToPackages}
                  className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:shadow-xl hover:shadow-purple-500/25 transition-all duration-300 hover:-translate-y-1 flex items-center justify-center gap-2"
                >
                  Shiko Paketat SEO
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
                <button
                  onClick={() => scrollToContact()}
                  className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border-2 border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-all duration-300 flex items-center justify-center gap-2"
                >
                  <Phone className="w-5 h-5" />
                  Konsultim Falas
                </button>
              </div>
            </FadeIn>

            {/* Trust signals */}
            <FadeIn delay={400}>
              <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-400">
                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-500" /> Pa kontrat afatgjatë</span>
                <span className="flex items-center gap-1.5"><Lock className="w-4 h-4 text-blue-500" /> Privatësi e garantuar</span>
                <span className="flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-purple-500" /> Rezultate brenda 90 ditëve</span>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ PAIN POINTS — Agitation ═══ */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-red-500 mb-3">A e njeh këtë situatë?</p>
              <h2 className="text-3xl sm:text-4xl font-bold">
                Biznesi yt po humb para <span className="text-red-500">çdo ditë</span> pa SEO
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
                Lajmi i mirë? <span className="text-purple-600 font-bold">Ka një zgjidhje të provuar.</span>
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
              <p className="text-sm font-semibold uppercase tracking-widest text-purple-600 mb-3">Rezultate të vërteta</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Numrat flasin më shumë se fjalët</h2>
            </div>
          </FadeIn>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {RESULTS.map((r, i) => (
              <FadeIn key={i} delay={i * 100}>
                <div className="text-center p-8 rounded-2xl bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-100">
                  <r.icon className="w-8 h-8 text-purple-600 mx-auto mb-4" />
                  <div className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
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
              <p className="text-sm font-semibold uppercase tracking-widest text-purple-400 mb-3">Si funksionon</p>
              <h2 className="text-3xl sm:text-4xl font-bold">4 hapa drejt Faqes 1 të Google</h2>
              <p className="mt-4 text-gray-400 max-w-xl mx-auto">
                Metodologji e provuar që ka funksionuar për 150+ biznese shqiptare
              </p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-4 gap-6 relative">
            {/* Connecting line */}
            <div className="hidden md:block absolute top-16 left-[12%] right-[12%] h-px bg-gradient-to-r from-purple-500/50 via-indigo-500/50 to-purple-500/50" />

            {PROCESS_STEPS.map((s, i) => (
              <FadeIn key={i} delay={i * 150}>
                <div className="relative text-center p-6 rounded-2xl bg-gray-800/50 border border-gray-700 hover:border-purple-500/50 transition-all duration-300 group">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center mx-auto mb-4 text-lg font-bold relative z-10">
                    {s.step}
                  </div>
                  <s.icon className="w-6 h-6 text-purple-400 mx-auto mb-3 group-hover:scale-110 transition-transform" />
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
              <p className="text-sm font-semibold uppercase tracking-widest text-purple-600 mb-3">Paketat SEO</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Zgjidh paketin që i përshtatet biznesit tënd</h2>
              <p className="mt-4 text-gray-600 max-w-xl mx-auto">
                Çdo pakejtë përmban strategji të personalizuar. Pa kontrata afatgjata — anulo kur të duash.
              </p>
            </div>
          </FadeIn>

          <div className={`grid gap-8 items-start ${packages.length === 1 ? 'max-w-md mx-auto' : packages.length === 2 ? 'md:grid-cols-2 max-w-3xl mx-auto' : 'md:grid-cols-3'}`}>
            {packages.map((pkg, i) => {
              const style = CARD_STYLES[i] || CARD_STYLES[0];
              const isSelected = selectedPackage?.id === pkg.id;
              return (
              <FadeIn key={pkg.id} delay={i * 150}>
                <div className={`relative rounded-2xl bg-white border-2 ${style.border} transition-all duration-300 hover:shadow-2xl ${style.popular ? 'md:-mt-4 md:mb-4 shadow-xl ring-2 ring-purple-500/20' : 'shadow-sm'} ${isSelected ? 'ring-2 ring-green-500' : ''}`}>
                  {style.badge && (
                    <div className={`absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-gradient-to-r ${style.color} text-white text-xs font-bold tracking-wide`}>
                      {style.badge}
                    </div>
                  )}
                  <div className="p-8">
                    <h3 className="text-2xl font-bold">{pkg.title}</h3>
                    {pkg.description && (
                      <p className="text-sm text-gray-500 mt-1" dangerouslySetInnerHTML={{ __html: pkg.description.replace(/<[^>]*>/g, '').slice(0, 120) }} />
                    )}

                    <div className="mt-6">
                      <div className="flex items-baseline gap-1.5">
                        <span className={`text-4xl font-bold bg-gradient-to-r ${style.color} bg-clip-text text-transparent`}>
                          {pkg.price.toLocaleString()}
                        </span>
                        <span className="text-sm text-gray-500">{pkg.currency || 'ALL'}/muaj</span>
                      </div>
                    </div>

                    <button
                      onClick={() => scrollToContact(pkg)}
                      className={`mt-8 w-full py-3.5 rounded-xl text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5 ${
                        style.popular
                          ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:shadow-lg hover:shadow-purple-500/25'
                          : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                      }`}
                    >
                      {isSelected ? '✓ Zgjedhur' : style.cta}
                    </button>
                  </div>
                </div>
              </FadeIn>
              );
            })}
          </div>

          <FadeIn delay={500}>
            <p className="mt-10 text-center text-sm text-gray-500">
              Çmimet janë në Lekë shqiptare (ALL). TVSH nuk përfshihet. Faturim mujor.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ═══ SOCIAL PROOF / TESTIMONIALS ═══ */}
      <section id="testimonials" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-purple-600 mb-3">Dëshmi klientësh</p>
              <h2 className="text-3xl sm:text-4xl font-bold">Çfarë thonë klientët tanë</h2>
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
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center text-white font-bold text-sm">
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
      <section className="py-24 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-purple-600 mb-3">FAQ</p>
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
      <section id="contact" className="py-24 bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-white relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-indigo-500/10 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-purple-400 mb-4">Gati për të filluar?</p>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">
                  Mos lejo konkurrentët të marrin klientët tuaj{' '}
                  <span className="text-purple-400">edhe një ditë tjetër</span>
                </h2>
                <p className="mt-5 text-gray-300 leading-relaxed text-lg">
                  Plotëso formularin dhe merr një <strong className="text-white">konsultim falas 30-minutësh</strong> me ekspertët tanë SEO. Do analizojmë faqen tënde dhe do tregojmë mundësitë konkrete për rritje.
                </p>

                <div className="mt-8 space-y-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                    <span className="text-gray-300">Audit SEO falas me vlerë 15,000 ALL</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                    <span className="text-gray-300">Analizë e detajuar e konkurrentëve</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                    <span className="text-gray-300">Rekomandime konkrete veprimi pa detyrim</span>
                  </div>
                </div>

                {/* Urgency */}
                <div className="mt-10 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                  <p className="text-sm text-amber-300 font-medium flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Kujdes: Pranojmë vetëm 5 klientë të rinj çdo muaj për cilësi maksimale.
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

                  {/* Selected package indicator */}
                  {selectedPackage && (
                    <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-purple-500/20 border border-purple-500/30">
                      <div>
                        <p className="text-xs text-purple-300">Paketa e zgjedhur</p>
                        <p className="font-semibold text-white">{selectedPackage.title} — {selectedPackage.price.toLocaleString()} {selectedPackage.currency || 'ALL'}/muaj</p>
                      </div>
                      <button type="button" onClick={() => setSelectedPackage(null)} className="text-purple-300 hover:text-white text-sm underline">Ndrysho</button>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Emri i plotë *</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
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
                        className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                        placeholder="email@domain.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">Telefon</label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={e => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                        placeholder="+355 6X XXX XXXX"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Faqja web (nëse keni)</label>
                    <input
                      type="url"
                      value={formData.website}
                      onChange={e => setFormData(prev => ({ ...prev, website: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                      placeholder="https://example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Mesazh (opsional)</label>
                    <textarea
                      rows={3}
                      value={formData.message}
                      onChange={e => setFormData(prev => ({ ...prev, message: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all resize-none"
                      placeholder="Na tregoni pak për biznesin tuaj..."
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
                    className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-400 hover:to-indigo-400 text-white shadow-lg shadow-purple-500/25 hover:shadow-xl hover:shadow-purple-500/30 transition-all duration-300 hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
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
            <div className="w-6 h-6 rounded bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center">
              <Search className="w-3 h-3 text-white" />
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
