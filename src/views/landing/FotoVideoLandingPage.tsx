import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Camera, Video, Image as ImageIcon, Film, CheckCircle2, ArrowRight,
  Star, Clock, ChevronDown, Phone, ArrowUpRight, Sparkles, Shield,
  Play, X, CalendarCheck, Download, Utensils, Coffee, Scissors,
  ShoppingBag, Building2, Gift,
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

/* ═══════════════════════════════════════════════
   Paketat Foto + Video për Biznese
   ═══════════════════════════════════════════════ */
interface Pkg {
  id: string;
  title: string;
  idealFor: string;
  price: string;
  priceNote: string;
  photos: string;
  reels: string;
  duration: string;
  popular?: boolean;
  badge?: string;
  color: string;
  border: string;
  ring: string;
  cta: string;
  includes: string[];
  deliverable: string;
  salesLine: string;
}

const PACKAGES: Pkg[] = [
  {
    id: 'starter',
    title: 'Starter',
    idealFor: 'Biznese të vogla që duan një imazh më profesional online për herë të parë.',
    price: '120€',
    priceNote: 'një herë',
    photos: '15 foto',
    reels: '1 Reel',
    duration: '~1 orë',
    color: 'from-zinc-500 to-slate-600',
    border: 'border-zinc-200 hover:border-zinc-400',
    ring: 'ring-zinc-400',
    cta: 'Zgjidh Starter',
    includes: [
      '1 seancë fotografimi në biznesin tuaj',
      'Foto të ambientit dhe produkteve',
      'Editim profesional i fotove',
      '1 Reel i shkurtër për Instagram / TikTok',
      'Format vertikal & katror, gati për postim',
    ],
    deliverable: '15 foto të edituara + 1 Reel, gati për t\'u postuar.',
    salesLine: 'Hapi i parë drejt një imazhi profesional — pa shpenzuar shumë.',
  },
  {
    id: 'growth',
    title: 'Growth',
    idealFor: 'Biznese që duan përmbajtje të mjaftueshme për rrjetet sociale për disa javë.',
    price: '290€',
    priceNote: 'një herë',
    photos: '30 foto',
    reels: '3–4 Reels',
    duration: '~2–3 orë',
    popular: true,
    badge: 'Më e Rekomanduara',
    color: 'from-fuchsia-600 to-pink-600',
    border: 'border-fuchsia-300 hover:border-fuchsia-500',
    ring: 'ring-fuchsia-400',
    cta: 'Zgjidh Growth',
    includes: [
      'Seancë e zgjeruar foto + video',
      'Foto të ambientit, produkteve dhe ekipit',
      '3–4 Reels me muzikë dhe titra',
      'Editim profesional i të gjitha materialeve',
      'Përmbajtje e mjaftueshme për rreth 1 muaj',
    ],
    deliverable: '30 foto + 3–4 Reels — përmbajtje e gatshme për një muaj të tërë.',
    salesLine: 'Përmbajtje për një muaj të tërë, e gatshme për t\'u postuar.',
  },
  {
    id: 'premium',
    title: 'Premium',
    idealFor: 'Biznese që duan materiale të nivelit të lartë për reklama, website dhe fushata.',
    price: '650€',
    priceNote: 'një herë',
    photos: '50+ foto',
    reels: '6–8 Reels',
    duration: 'Gjysmë dite',
    badge: 'Maksimum Cilësi',
    color: 'from-violet-600 to-fuchsia-700',
    border: 'border-violet-300 hover:border-violet-500',
    ring: 'ring-violet-400',
    cta: 'Zgjidh Premium',
    includes: [
      'Produksion i plotë foto + video',
      '1 video promovuese (30–60 sekonda)',
      '6–8 Reels për rrjete sociale',
      'Editim kinematik me muzikë & titra',
      'Materiale për reklama dhe website',
      'Të drejta të plota përdorimi',
    ],
    deliverable: '50+ foto, 6–8 Reels dhe 1 video promovuese për reklama & website.',
    salesLine: 'Gjithçka që ju duhet për të dukur si brandi më i mirë në treg.',
  },
];

const BUSINESS_TYPES = [
  { icon: Utensils, label: 'Restorante' },
  { icon: Coffee, label: 'Bare & Kafene' },
  { icon: Sparkles, label: 'Klinika Estetike' },
  { icon: Scissors, label: 'Sallone Bukurie' },
  { icon: ShoppingBag, label: 'Dyqane Produktesh' },
  { icon: Building2, label: 'Hotele të Vogla' },
];

const WHY = [
  { icon: Camera, title: 'Fotot me telefon nuk e shesin biznesin', desc: 'Produkti juaj mund të jetë i shkëlqyer, por foto të bëra shpejt me telefon nuk e tregojnë cilësinë e tij. Klienti gjykon në sekonda.' },
  { icon: Star, title: 'Konkurrenti duket më i mirë se ju', desc: 'Bizneset me foto e video profesionale duken më të besueshme dhe tërheqin më shumë klientë — edhe kur produkti është i njëjtë.' },
  { icon: Play, title: 'Pa përmbajtje, rrjetet "vdesin"', desc: 'Pa materiale të reja, faqet tuaja mbeten të heshtura. Përmbajtja profesionale ju mban aktiv dhe të dukshëm çdo javë.' },
];

const STEPS = [
  { icon: CalendarCheck, title: 'Rezervoni', desc: 'Zgjidhni paketën dhe caktojmë bashkë ditën e xhirimit.' },
  { icon: Camera, title: 'Xhirojmë', desc: 'Vijmë te ju dhe xhirojmë ambientin, produktet dhe ekipin.' },
  { icon: Film, title: 'Editojmë', desc: 'Përpunojmë foto e video me cilësi profesionale.' },
  { icon: Download, title: 'Merrni materialet', desc: 'I merrni gati për postim — foto, Reels dhe video.' },
];

const TESTIMONIALS = [
  { name: 'Elsa Doçi', role: 'Pronare, Kafe & Brunch "Mira"', quote: 'Fotot e reja na ndryshuan krejt profilin. Klientët vijnë duke thënë "e pashë në Instagram". Vlejti çdo qindarkë.', avatar: 'ED' },
  { name: 'Renato Hasa', role: 'Menaxher, Restorant "Deti"', quote: 'Me Reels-et që na bënë, rezervimet u rritën dukshëm. Tani kemi material të ri për javë të tëra.', avatar: 'RH' },
  { name: 'Klea Berisha', role: 'Klinikë Estetike "Lumière"', quote: 'Përmbajtja duket luksoze dhe profesionale. Pikërisht imazhi që donim të jepnim. Shumë të kënaqur.', avatar: 'KB' },
];

const FAQ = [
  { q: 'Sa kohë duhet për t\'i marrë materialet?', a: 'Zakonisht 3–7 ditë pune pas xhirimit, sipas paketës. Për Premium, pak më shumë për shkak të editimit kinematik.' },
  { q: 'A vini ju te biznesi ynë?', a: 'Po. Xhirimi bëhet në ambientin tuaj, me ditë e orar të dakorduar paraprakisht, që gjithçka të duket natyrale dhe reale.' },
  { q: 'A janë gati materialet për postim direkt?', a: 'Po. Fotot dhe Reels-et i merrni në formate të gatshme për Instagram, Facebook dhe TikTok — vetëm i ngarkoni.' },
  { q: 'Po nëse na duhen më shumë foto ose video?', a: 'Mund të shtoni materiale ekstra ose ditë xhirimi shtesë në çdo paketë. Na e thoni nevojën dhe e përshtatim ofertën.' },
  { q: 'Kush i zotëron materialet në fund?', a: 'Ju. Pas dorëzimit, materialet janë tuajat për t\'i përdorur lirisht në rrjete sociale, website dhe reklama.' },
];

/* ═══════════════════════════════════════════════════════════════════════ */

export default function FotoVideoLandingPage() {
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
          packageName: selectedPackage ? `Foto+Video ${selectedPackage.title}` : '',
          source: 'Foto Video Landing Page',
          category: 'Foto & Video',
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
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-fuchsia-600 to-pink-600 flex items-center justify-center"><Camera className="w-4 h-4 text-white" /></div>
            <span className="text-xl font-bold bg-gradient-to-r from-fuchsia-600 to-pink-600 bg-clip-text text-transparent">FivoCRM Studio</span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-gray-600">
            <a href="#pse" className="hover:text-fuchsia-600 transition-colors">Pse</a>
            <a href="#si-funksionon" className="hover:text-fuchsia-600 transition-colors">Si funksionon</a>
            <a href="#packages" className="hover:text-fuchsia-600 transition-colors">Paketat</a>
            <a href="#faq" className="hover:text-fuchsia-600 transition-colors">Pyetjet</a>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="hidden sm:inline-flex text-sm font-medium text-gray-600 hover:text-fuchsia-600 transition-colors">Hyr</Link>
            <button onClick={() => scrollToContact()} className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:shadow-lg hover:shadow-fuchsia-500/25 transition-all hover:-translate-y-0.5">Rezervo Tani</button>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-fuchsia-50/70 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-fuchsia-200/30 rounded-full blur-3xl" />
        <div className="absolute top-40 right-0 w-[400px] h-[400px] bg-pink-200/20 rounded-full blur-3xl" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-fuchsia-50 border border-fuchsia-100 mb-8">
                <Camera className="w-4 h-4 text-fuchsia-600" />
                <span className="text-sm font-medium text-fuchsia-700">Foto + Video për biznese lokale</span>
                <div className="flex">{[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}</div>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                Foto dhe video që e bëjnë biznesin tuaj{' '}
                <span className="bg-gradient-to-r from-fuchsia-600 via-pink-600 to-rose-500 bg-clip-text text-transparent">të duket profesional</span>.
              </h1>
            </FadeIn>
            <FadeIn delay={200}>
              <p className="mt-8 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
                Përmbajtje e gatshme për Instagram, Facebook, TikTok, website dhe reklama. Ne xhirojmë dhe editojmë —{' '}
                <strong className="text-fuchsia-600">ju vetëm i postoni.</strong>
              </p>
            </FadeIn>
            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button onClick={scrollToPackages} className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:shadow-xl hover:shadow-fuchsia-500/25 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">Shiko Paketat<ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></button>
                <button onClick={() => scrollToContact()} className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border-2 border-gray-200 hover:border-fuchsia-300 hover:bg-fuchsia-50 transition-all flex items-center justify-center gap-2"><Phone className="w-5 h-5" />Konsultim Falas</button>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-400">
                <span className="flex items-center gap-1.5"><Camera className="w-4 h-4 text-fuchsia-500" /> Xhirojmë te ju</span>
                <span className="flex items-center gap-1.5"><Download className="w-4 h-4 text-pink-500" /> Gati për postim</span>
                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-500" /> Të drejta të plota përdorimi</span>
              </div>
            </FadeIn>
          </div>

          {/* Llojet e bizneseve */}
          <FadeIn delay={500}>
            <div className="mt-16 grid grid-cols-3 md:grid-cols-6 gap-4 max-w-4xl mx-auto">
              {BUSINESS_TYPES.map((b, i) => (
                <div key={i} className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-100 hover:border-fuchsia-200 hover:bg-fuchsia-50/40 transition-colors text-center">
                  <div className="w-10 h-10 rounded-xl bg-fuchsia-100 flex items-center justify-center"><b.icon className="w-5 h-5 text-fuchsia-600" /></div>
                  <span className="text-xs font-semibold text-gray-700">{b.label}</span>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══ PSE ═══ */}
      <section id="pse" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-fuchsia-600 mb-3">Pse foto & video profesionale</p><h2 className="text-3xl sm:text-4xl font-bold">Imazhi është gjëja e parë që sheh klienti</h2></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {WHY.map((w, i) => (
              <FadeIn key={i} delay={i * 150}><div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 hover:shadow-lg hover:border-fuchsia-100 transition-all h-full"><div className="w-14 h-14 rounded-xl bg-fuchsia-50 flex items-center justify-center mb-6"><w.icon className="w-7 h-7 text-fuchsia-600" /></div><h3 className="text-xl font-bold mb-3">{w.title}</h3><p className="text-gray-600 leading-relaxed">{w.desc}</p></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SI FUNKSIONON ═══ */}
      <section id="si-funksionon" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-fuchsia-600 mb-3">Si funksionon</p><h2 className="text-3xl sm:text-4xl font-bold">Thjesht, në 4 hapa</h2></div></FadeIn>
          <div className="grid md:grid-cols-4 gap-6 relative">
            <div className="hidden md:block absolute top-16 left-[12%] right-[12%] h-px bg-gradient-to-r from-fuchsia-500/50 via-pink-500/50 to-fuchsia-500/50" />
            {STEPS.map((s, i) => (
              <FadeIn key={i} delay={i * 150}><div className="relative text-center p-6 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg hover:border-fuchsia-200 transition-all group"><div className="w-12 h-12 rounded-full bg-gradient-to-br from-fuchsia-600 to-pink-600 flex items-center justify-center mx-auto mb-4 text-lg font-bold text-white relative z-10">{i + 1}</div><s.icon className="w-6 h-6 text-fuchsia-600 mx-auto mb-3 group-hover:scale-110 transition-transform" /><h3 className="text-lg font-bold mb-2">{s.title}</h3><p className="text-gray-500 text-sm leading-relaxed">{s.desc}</p></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PAKETAT ═══ */}
      <section id="packages" className="py-24 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-fuchsia-600 mb-3">Paketat</p><h2 className="text-3xl sm:text-4xl font-bold">Paketa Foto + Video për Biznese</h2><p className="mt-4 text-gray-600 max-w-2xl mx-auto">Tri paketa të qarta. Zgjidhni atë që i përshtatet biznesit dhe buxhetit tuaj.</p></div></FadeIn>
          <div className="grid lg:grid-cols-3 gap-6 items-start">
            {PACKAGES.map((pkg, i) => {
              const isSelected = selectedPackage?.id === pkg.id;
              return (
                <FadeIn key={pkg.id} delay={i * 120}>
                  <div className={`relative rounded-2xl bg-white border-2 ${pkg.border} transition-all hover:shadow-2xl flex flex-col h-full ${pkg.popular ? `shadow-xl ring-2 ${pkg.ring}/20 lg:-mt-3 lg:mb-3` : 'shadow-sm'} ${isSelected ? 'ring-2 ring-green-500' : ''}`}>
                    {pkg.badge && (<div className={`absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-gradient-to-r ${pkg.color} text-white text-xs font-bold tracking-wide whitespace-nowrap`}>{pkg.badge}</div>)}
                    <div className="p-6 flex flex-col h-full">
                      <h3 className="text-2xl font-bold">{pkg.title}</h3>
                      <p className="text-sm text-gray-500 mt-1 min-h-[40px]">{pkg.idealFor}</p>
                      <div className="mt-5 flex items-baseline gap-1.5"><span className={`text-4xl font-bold bg-gradient-to-r ${pkg.color} bg-clip-text text-transparent`}>{pkg.price}</span><span className="text-sm text-gray-500">{pkg.priceNote}</span></div>

                      {/* Stats: foto / reels / kohëzgjatja */}
                      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                        <div className="p-2.5 rounded-lg bg-gray-50"><ImageIcon className="w-4 h-4 text-fuchsia-600 mx-auto mb-1" /><p className="text-xs font-bold text-gray-900">{pkg.photos}</p></div>
                        <div className="p-2.5 rounded-lg bg-gray-50"><Video className="w-4 h-4 text-fuchsia-600 mx-auto mb-1" /><p className="text-xs font-bold text-gray-900">{pkg.reels}</p></div>
                        <div className="p-2.5 rounded-lg bg-gray-50"><Clock className="w-4 h-4 text-fuchsia-600 mx-auto mb-1" /><p className="text-xs font-bold text-gray-900">{pkg.duration}</p></div>
                      </div>

                      <ul className="mt-5 space-y-2 flex-1">
                        {pkg.includes.map((item, ii) => (<li key={ii} className="flex items-start gap-2 text-sm text-gray-700"><CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${pkg.popular ? 'text-fuchsia-500' : 'text-green-500'}`} />{item}</li>))}
                      </ul>

                      <div className="mt-5 p-3 rounded-lg bg-fuchsia-50 border border-fuchsia-100">
                        <p className="text-xs font-semibold text-fuchsia-700 uppercase tracking-wide mb-1 flex items-center gap-1.5"><Gift className="w-3.5 h-3.5" />Çfarë merrni</p>
                        <p className="text-sm text-gray-700">{pkg.deliverable}</p>
                      </div>

                      <p className="mt-4 text-sm text-gray-500 italic">"{pkg.salesLine}"</p>

                      <button onClick={() => scrollToContact(pkg)} className={`mt-5 w-full py-3.5 rounded-xl text-sm font-semibold transition-all hover:-translate-y-0.5 ${pkg.popular ? `bg-gradient-to-r ${pkg.color} text-white hover:shadow-lg hover:shadow-fuchsia-500/25` : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}>{isSelected ? '✓ Zgjedhur' : pkg.cta}</button>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>
          <FadeIn delay={500}><p className="mt-10 text-center text-sm text-gray-500">Çmimet janë orientuese, për një seancë (një herë). Numrat e fotove dhe Reels-eve janë orientues dhe mund të përshtaten sipas nevojës suaj.</p></FadeIn>
        </div>
      </section>

      {/* ═══ REKOMANDIMI ═══ */}
      <section className="py-16 bg-gradient-to-r from-fuchsia-50 via-pink-50 to-rose-50 border-y border-fuchsia-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <FadeIn>
            <Sparkles className="w-8 h-8 text-fuchsia-600 mx-auto mb-4" />
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">Cilën paketë rekomandojmë?</h2>
            <p className="text-gray-700 leading-relaxed">Për shumicën e bizneseve, <strong className="text-fuchsia-700">Paketa Growth</strong> është zgjedhja më e mirë: jep mjaftueshëm foto dhe Reels për të mbushur rrjetet sociale për një muaj të tërë, me një çmim të balancuar. Është ekuilibri ideal mes cilësisë, sasisë dhe vlerës.</p>
          </FadeIn>
        </div>
      </section>

      {/* ═══ DËSHMITË ═══ */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-fuchsia-600 mb-3">Dëshmi klientësh</p><h2 className="text-3xl sm:text-4xl font-bold">Çfarë thonë bizneset që punojnë me ne</h2></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {TESTIMONIALS.map((t, i) => (
              <FadeIn key={i} delay={i * 150}><div className="p-8 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg transition-all h-full flex flex-col"><div className="flex mb-4">{[1,2,3,4,5].map(j => (<Star key={j} className="w-5 h-5 text-amber-400 fill-amber-400" />))}</div><p className="text-gray-700 leading-relaxed flex-1 italic">"{t.quote}"</p><div className="mt-6 flex items-center gap-3 pt-4 border-t border-gray-100"><div className="w-11 h-11 rounded-full bg-gradient-to-br from-fuchsia-600 to-pink-600 flex items-center justify-center text-white font-bold text-sm">{t.avatar}</div><div><p className="font-semibold text-sm">{t.name}</p><p className="text-xs text-gray-500">{t.role}</p></div></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="py-24 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-fuchsia-600 mb-3">Pyetjet e shpeshta</p><h2 className="text-3xl sm:text-4xl font-bold">Gjithçka që duhet të dini</h2></div></FadeIn>
          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <FadeIn key={i} delay={i * 80}><div className="bg-white rounded-xl border border-gray-100 overflow-hidden"><button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"><span className="font-semibold text-gray-900 pr-4">{item.q}</span><ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} /></button><div className={`transition-all duration-300 overflow-hidden ${openFaq === i ? 'max-h-60 opacity-100' : 'max-h-0 opacity-0'}`}><p className="px-6 pb-5 text-gray-600 leading-relaxed">{item.a}</p></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ KONTAKT ═══ */}
      <section id="contact" className="py-24 bg-gradient-to-br from-zinc-900 via-fuchsia-950 to-zinc-900 text-white relative overflow-hidden">
        <div className="absolute inset-0"><div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-fuchsia-500/10 rounded-full blur-3xl" /><div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-pink-500/10 rounded-full blur-3xl" /></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-fuchsia-400 mb-4">Gati për të filluar?</p>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">Le ta bëjmë biznesin tuaj të <span className="text-fuchsia-400">duket i mrekullueshëm</span></h2>
                <p className="mt-5 text-gray-300 leading-relaxed text-lg">Plotësoni formularin dhe ju kontaktojmë për të caktuar ditën e xhirimit. Konsultimi i parë është falas.</p>
                <div className="mt-8 space-y-4">
                  <div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">Vijmë te ju — pa stres për ju</span></div>
                  <div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">Materiale gati për postim</span></div>
                  <div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">Pa kontratë afatgjatë</span></div>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              {formSent ? (
                <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-10 border border-white/10 text-center"><div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6"><CheckCircle2 className="w-10 h-10 text-green-400" /></div><h3 className="text-2xl font-bold mb-3">Faleminderit!</h3><p className="text-gray-300">Kërkesa juaj u dërgua me sukses. Do t'ju kontaktojmë brenda 24 orëve.</p></div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">Rezervo seancën tënde</h3>
                  {selectedPackage && (<div className="flex items-center justify-between px-4 py-3 rounded-xl bg-fuchsia-500/20 border border-fuchsia-500/30"><div><p className="text-xs text-fuchsia-300">Paketa e zgjedhur</p><p className="font-semibold text-white">{selectedPackage.title} — {selectedPackage.price} ({selectedPackage.priceNote})</p></div><button type="button" onClick={() => setSelectedPackage(null)} className="text-fuchsia-300 hover:text-white text-sm underline">Ndrysho</button></div>)}
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Emri i plotë *</label><input type="text" required value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500" placeholder="Emër Mbiemër" /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Email *</label><input type="email" required value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500" placeholder="email@biznesi.al" /></div>
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Telefon</label><input type="tel" value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500" placeholder="+355 6X XXX XXXX" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Biznesi / Instagram (nëse keni)</label><input type="text" value={formData.website} onChange={e => setFormData(p => ({ ...p, website: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500" placeholder="@instagram ose emri i biznesit" /></div>
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Mesazh (opsional)</label><textarea rows={3} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500 resize-none" placeholder="Na tregoni shkurt për biznesin tuaj..." /></div>
                  {formError && (<div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">{formError}</div>)}
                  <button type="submit" disabled={submitting} className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60">{submitting ? 'Duke dërguar...' : 'Dërgo Kërkesën'}{!submitting && <ArrowUpRight className="w-5 h-5" />}</button>
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
          <div className="flex items-center gap-2"><div className="w-6 h-6 rounded bg-gradient-to-br from-fuchsia-600 to-pink-600 flex items-center justify-center"><Camera className="w-3 h-3 text-white" /></div><span className="font-semibold text-white text-sm">FivoCRM Studio</span></div>
          <p className="text-sm">&copy; {new Date().getFullYear()} FivoCRM. Të gjitha të drejtat e rezervuara.</p>
          <div className="flex items-center gap-6 text-sm"><Link to="/login" className="hover:text-white transition-colors">Hyrje</Link><a href="#packages" className="hover:text-white transition-colors">Paketat</a><a href="#contact" className="hover:text-white transition-colors">Kontakt</a></div>
        </div>
      </footer>
    </div>
  );
}
