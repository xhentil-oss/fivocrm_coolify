import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Car, Camera, Clapperboard, CheckCircle2, ArrowRight, ChevronDown, Phone, ArrowUpRight,
  Megaphone, Search, Users, Lightbulb, Star, Target, TrendingUp, MapPin, FileText,
  Gauge, CalendarCheck, BarChart3, MessageCircle, Repeat, LayoutGrid,
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
   Ofertë e personalizuar — Penta Group (shitje makinash)
   ═══════════════════════════════════════════════ */
const CLIENT = 'Penta Group';

// Çfarë kërkoi klienti, me sasitë mujore.
const INCLUDED = [
  { icon: LayoutGrid, qty: '20', unit: 'postime / muaj', title: 'Postime për rrjetet sociale', desc: 'Dizajn, tekst dhe hashtag: makina në stok, oferta, makina e javës, dorëzime dhe dëshmi klientësh.' },
  { icon: Clapperboard, qty: '6', unit: 'video / muaj', title: 'Video profesionale', desc: 'Xhirim + montazh: walkaround, test-drive, dorëzim makine. Format vertikal për Reels dhe TikTok.' },
  { icon: Megaphone, qty: '3', unit: 'fushata', title: 'Fushata në Meta Ads', desc: 'Facebook + Instagram: lead-e për test-drive, katalogu i makinave dhe rimarketing.' },
  { icon: Search, qty: '1', unit: 'fushatë', title: 'Fushatë në Google Ads', desc: 'Search për ata që kërkojnë "makina në shitje", markë/model + qytet. Thirrje direkte nga reklama.' },
  { icon: Users, qty: '3', unit: 'platforma', title: 'Menaxhim IG, FB, TikTok', desc: 'Planifikim, publikim, përgjigje komenteve dhe mesazheve, rritje e ndjekësve.' },
  { icon: Lightbulb, qty: '1', unit: 'takim / muaj', title: 'Konsulencë strategjie & menaxhimi', desc: 'Pozicionimi i markës, ofertat dhe procesi i shitjes nga lead-i te dorëzimi i makinës.' },
  { icon: Star, qty: '1–2', unit: 'bashkëpunime / muaj', title: 'Bashkëpunim me influencerë', desc: 'Përzgjedhje, negocim, brief kreativ dhe ndjekje e publikimit në platforma të ndryshme.' },
  { icon: BarChart3, qty: '1', unit: 'raport / muaj', title: 'Raport mujor', desc: 'Lead-e, kosto për lead, shikime, ndjekës dhe rekomandime për muajin tjetër.' },
];

interface Pkg { id: string; name: string; price: number; tagline: string; badge?: string; items: string[] }
const PACKAGES: Pkg[] = [
  {
    id: 'drive', name: 'Penta Drive', price: 120000,
    tagline: 'Gjithçka që kërkuat: përmbajtje, reklama, menaxhim dhe strategji.',
    items: ['20 postime + 6 video profesionale / muaj', '3 fushata Meta Ads + 1 Google Ads', 'Menaxhim Instagram, Facebook, TikTok', 'Konsulencë strategjie dhe menaxhimi', 'Bashkëpunim me influencerë', 'Raport mujor'],
  },
  {
    id: 'drive-seo', name: 'Penta Drive + SEO', price: 145000, badge: 'Rekomandohet',
    tagline: 'E njëjta paketë + faqja e parë në Google për klientët që kërkojnë makinë sot.',
    items: ['Gjithçka te Penta Drive', 'SEO e plotë për website-in', 'Google Business Profile + vlerësime', 'Faqe të optimizuara për çdo markë/model', '2 artikuj / muaj', 'Raport renditjeje në Google çdo muaj'],
  },
];
// Vlera e shërbimeve nëse merren veçmas (Lekë / muaj).
const STANDALONE_VALUE: Record<string, number> = { drive: 151000, 'drive-seo': 186000 };

const CAMPAIGNS = [
  { icon: Target, platform: 'Meta Ads', title: 'Lead-e për test-drive', desc: 'Formular "Rezervo test-drive" brenda Facebook-ut ose mesazh në WhatsApp, me video walkaround.' },
  { icon: Car, platform: 'Meta Ads', title: 'Katalogu i makinave', desc: 'Carousel me makinat në stok — foto, çmim, kilometrazh — te njerëzit që po kërkojnë makinë.' },
  { icon: Repeat, platform: 'Meta Ads', title: 'Rimarketing', desc: 'Rikthen ata që panë makinat ose vizituan faqen, me oferta, financim dhe dëshmi klientësh.' },
  { icon: Search, platform: 'Google Ads', title: 'Kërkimi në Google', desc: 'Kap kërkimet "makina në shitje", markë/model + qytet. Reklama Search + thirrje direkte.' },
];

const VIDEOS = [
  'Walkaround i makinës së javës: jashtë, brenda, motori, detajet',
  'Test-drive në rrugë me rrëfim të shkurtër',
  'Dorëzimi i makinës te klienti, me reagimin e tij',
  '"5 gjëra që duhet të kontrollosh para se të blesh makinë"',
  'Prapaskenat: përgatitja dhe kontrolli teknik i makinave',
  'Video me influencerin — bashkëpunimi i muajit',
];
const POSTS = [
  { n: 8, label: 'Makina në stok', desc: 'foto profesionale + çmim + specifika' },
  { n: 4, label: 'Oferta & financim', desc: 'kushte, këste, promocione' },
  { n: 4, label: 'Dorëzime & dëshmi', desc: 'klientë realë me makinën e re' },
  { n: 4, label: 'Këshilla & markë', desc: 'edukim dhe besim te Penta Group' },
];

const SEO_POINTS = [
  { icon: MapPin, title: 'Google Business Profile', desc: 'Profil i plotë, foto, orare dhe vlerësime — që të dilni në hartë për "auto sallon pranë meje".' },
  { icon: Search, title: 'SEO lokale', desc: 'Fjalë kyçe sipas qytetit dhe markave që shisni.' },
  { icon: Car, title: 'Faqe për çdo model', desc: 'Faqe në website të optimizuara për kërkimet e markës dhe modelit.' },
  { icon: FileText, title: 'Artikuj mujorë', desc: '2 artikuj në muaj, p.sh. "Si të blesh makinë të përdorur pa rrezik".' },
  { icon: Gauge, title: 'SEO teknike', desc: 'Shpejtësia, versioni mobile dhe struktura e faqes.' },
  { icon: TrendingUp, title: 'Raport renditjeje', desc: 'Çdo muaj: ku renditeni për fjalët kyçe kryesore.' },
];

const TIMELINE = [
  { week: 'Java 1', title: 'Strategji & auditim', desc: 'Takim strategjie, auditim i rrjeteve dhe website-it, qasje në llogaritë e reklamave.' },
  { week: 'Java 2', title: 'Plan & xhirime', desc: 'Plani i përmbajtjes për aprovim, xhirimi i parë i videove dhe fotove të makinave.' },
  { week: 'Java 3', title: 'Nisja e fushatave', desc: '3 fushatat Meta + fushata Google live; publikimet e para.' },
  { week: 'Java 4', title: 'Optimizim & raport', desc: 'Optimizimi i parë, kontakti me influencerin dhe raporti i parë.' },
];

const FAQ = [
  { q: 'A përfshihet buxheti i reklamave në çmim?', a: 'Jo. Çmimi mbulon menaxhimin, përmbajtjen dhe strategjinë. Buxheti i reklamave paguhet direkt te Meta dhe Google. Rekomandimi fillestar: 300–500 € / muaj gjithsej për 4 fushatat.' },
  { q: 'Kush e paguan influencerin?', a: 'Pagesa e influencerit paguhet veçmas nga Penta Group. Ne merremi me përzgjedhjen, negocimin, brief-in kreativ dhe ndjekjen e rezultatit.' },
  { q: 'Sa zgjat kontrata?', a: 'Minimumi 6 muaj, sepse fushatat dhe SEO kanë nevojë për kohë që të optimizohen. Pagesa bëhet në fillim të çdo muaji, me faturë.' },
  { q: 'Kur shihen rezultatet?', a: 'Fushatat janë live brenda javës së 3-të dhe lead-et e para vijnë brenda muajit të parë. SEO jep rezultatet e para në 3–4 muaj; faqja e parë për kërkimet lokale arrihet zakonisht brenda 4–6 muajve.' },
  { q: 'A e aprovojmë përmbajtjen para publikimit?', a: 'Po. Plani i përmbajtjes dërgohet për aprovim para fillimit të çdo muaji, dhe çdo video kalon te ju para publikimit.' },
];

const money = (n: number) => n.toLocaleString('de-DE');

/* ═══════════════════════════════════════════════════════════════════════ */

export default function PentaGroupLandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [pkgId, setPkgId] = useState('drive-seo');
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', message: '' });
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
          company: CLIENT,
          packageId: `penta-group-${pkg.id}`,
          packageName: `${pkg.name} — ${money(pkg.price)} Lekë / muaj`,
          estimatedValue: pkg.price,
          source: 'Penta Group — Ofertë e personalizuar',
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

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans overflow-x-hidden">
      {/* ═══ NAV ═══ */}
      <nav className="fixed top-0 w-full z-50 bg-white/85 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-600 to-zinc-900 flex items-center justify-center"><Car className="w-4 h-4 text-white" /></div>
            <span className="text-lg font-bold">Fivo <span className="text-gray-400 font-medium">×</span> <span className="text-red-600">{CLIENT}</span></span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-gray-600">
            <a href="#perfshihet" className="hover:text-red-600 transition-colors">Çfarë përfshihet</a>
            <a href="#paketat" className="hover:text-red-600 transition-colors">Paketat</a>
            <a href="#fushatat" className="hover:text-red-600 transition-colors">Fushatat</a>
            <a href="#seo" className="hover:text-red-600 transition-colors">SEO</a>
            <a href="#faq" className="hover:text-red-600 transition-colors">Pyetjet</a>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => scrollTo('contact')} className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-red-600 to-red-700 hover:shadow-lg hover:shadow-red-600/25 transition-all hover:-translate-y-0.5">Prano Ofertën</button>
            <LandingMobileMenu
              links={[
                { href: '#perfshihet', label: 'Çfarë përfshihet' },
                { href: '#paketat', label: 'Paketat' },
                { href: '#fushatat', label: 'Fushatat' },
                { href: '#seo', label: 'SEO' },
                { href: '#faq', label: 'Pyetjet' },
              ]}
              ctaLabel="Prano Ofertën"
              onCta={() => scrollTo('contact')}
              accentClass="bg-gradient-to-r from-red-600 to-red-700"
            />
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="relative pt-32 pb-24 sm:pt-40 sm:pb-32 overflow-hidden bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 text-white">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-10 left-1/3 w-[700px] h-[700px] bg-red-600/15 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-red-500/10 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/15 mb-8">
                <Car className="w-4 h-4 text-red-400" />
                <span className="text-sm font-medium text-zinc-200">Ofertë e personalizuar për {CLIENT}</span>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                Më shumë test-drive.{' '}
                <span className="bg-gradient-to-r from-red-500 to-orange-400 bg-clip-text text-transparent">Më shumë makina të shitura.</span>
              </h1>
            </FadeIn>
            <FadeIn delay={200}>
              <p className="mt-8 text-lg sm:text-xl text-zinc-300 max-w-2xl leading-relaxed">
                Një ekip i plotë marketingu për {CLIENT}: video profesionale të makinave, reklama në Meta dhe Google, menaxhim i rrjeteve, influencerë dhe strategji —{' '}
                <strong className="text-white">nga 120.000 Lekë / muaj.</strong>
              </p>
            </FadeIn>
            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row gap-4">
                <button onClick={() => scrollTo('paketat')} className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:shadow-xl hover:shadow-red-600/25 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">Shiko Paketat<ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></button>
                <button onClick={() => scrollTo('contact')} className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border border-white/20 hover:bg-white/10 transition-all flex items-center justify-center gap-2"><Phone className="w-5 h-5" />Prano Ofertën</button>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-14 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl">
                {[{ n: '20', l: 'postime / muaj' }, { n: '6', l: 'video profesionale' }, { n: '4', l: 'fushata reklamash' }, { n: '3', l: 'platforma sociale' }].map((s, i) => (
                  <div key={i} className="rounded-xl bg-white/5 border border-white/10 p-4">
                    <div className="text-3xl font-extrabold text-red-400">{s.n}</div>
                    <div className="text-xs text-zinc-400 mt-1">{s.l}</div>
                  </div>
                ))}
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ ÇFARË PËRFSHIHET ═══ */}
      <section id="perfshihet" className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-red-600 mb-3">Çfarë përfshihet</p><h2 className="text-3xl sm:text-4xl font-bold">Një ekip i tërë marketingu, çdo muaj</h2><p className="mt-4 text-gray-600 max-w-2xl mx-auto">Gjithçka e fokusuar te makinat në stok dhe te besimi në {CLIENT} si shitës.</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {INCLUDED.map((s, i) => (
              <FadeIn key={i} delay={(i % 4) * 100}>
                <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-lg hover:border-red-100 transition-all h-full">
                  <div className="flex items-center justify-between mb-5">
                    <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center"><s.icon className="w-6 h-6 text-red-600" /></div>
                    <div className="text-right"><div className="text-2xl font-extrabold text-gray-900">{s.qty}</div><div className="text-[11px] text-gray-400">{s.unit}</div></div>
                  </div>
                  <h3 className="font-bold mb-2">{s.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{s.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PAKETAT ═══ */}
      <section id="paketat" className="py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-14"><p className="text-sm font-semibold uppercase tracking-widest text-red-600 mb-3">Paketat & çmimet</p><h2 className="text-3xl sm:text-4xl font-bold">Dy opsione, të ndërtuara për {CLIENT}</h2><p className="mt-4 text-gray-600 max-w-2xl mx-auto">Rekomandojmë <strong>Penta Drive + SEO</strong>: me +25.000 Lekë / muaj dilni në faqen e parë të Google dhe merrni klientë që kërkojnë makinë sot, pa paguar për çdo klik.</p></div></FadeIn>
          <div className="grid md:grid-cols-2 gap-8">
            {PACKAGES.map((p, i) => {
              const featured = !!p.badge;
              const saving = STANDALONE_VALUE[p.id] - p.price;
              return (
                <FadeIn key={p.id} delay={i * 150}>
                  <div className={`relative rounded-3xl bg-white overflow-hidden h-full flex flex-col ${featured ? 'border-2 border-red-500 shadow-2xl shadow-red-600/10' : 'border border-gray-200 shadow-sm'}`}>
                    {featured && <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-red-600 to-orange-400" />}
                    {p.badge && <div className="absolute top-5 right-5"><span className="text-[10px] font-extrabold uppercase tracking-wider px-3 py-1 rounded-full text-white bg-gradient-to-r from-red-600 to-red-700">{p.badge}</span></div>}
                    <div className="p-8 flex-1 flex flex-col">
                      <h3 className="text-2xl font-bold">{p.name}</h3>
                      <p className="text-sm text-gray-500 mt-2 min-h-[40px]">{p.tagline}</p>
                      <div className="mt-6 flex items-baseline gap-2">
                        <span className={`text-5xl font-extrabold ${featured ? 'text-red-600' : 'text-gray-900'}`}>{money(p.price)}</span>
                        <span className="text-sm text-gray-500">Lekë / muaj</span>
                      </div>
                      <p className="mt-2 text-xs text-gray-500">Vlera veçmas: <span className="line-through">{money(STANDALONE_VALUE[p.id])} Lekë</span> · kurseni {money(saving)} Lekë / muaj</p>
                      <ul className="mt-7 space-y-3 flex-1">
                        {p.items.map((it, j) => (<li key={j} className="flex items-start gap-2.5 text-sm text-gray-700"><CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${featured ? 'text-red-500' : 'text-green-500'}`} />{it}</li>))}
                      </ul>
                      <button onClick={() => choose(p.id)} className={`mt-8 w-full py-4 rounded-xl text-base font-bold transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 ${featured ? 'text-white bg-gradient-to-r from-red-600 to-red-700 hover:shadow-lg hover:shadow-red-600/25' : 'text-gray-900 border-2 border-gray-200 hover:border-red-300 hover:bg-red-50'}`}>Zgjidh {p.name}<ArrowRight className="w-5 h-5" /></button>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>
          <p className="mt-8 text-center text-xs text-gray-400">Buxheti i reklamave dhe pagesa e influencerëve paguhen veçmas. Kontratë minimale 6 muaj.</p>
        </div>
      </section>

      {/* ═══ FUSHATAT ═══ */}
      <section id="fushatat" className="py-24 bg-zinc-950 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-red-400 mb-3">Plani i fushatave</p><h2 className="text-3xl sm:text-4xl font-bold">4 fushata, secila me një qëllim të vetëm</h2><p className="mt-4 text-zinc-400 max-w-2xl mx-auto">Kështu matet qartë sa kushton një klient i ri. Çdo javë e zhvendosim buxhetin te fushata që sjell më shumë thirrje dhe vizita në sallon.</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {CAMPAIGNS.map((c, i) => (
              <FadeIn key={i} delay={i * 120}>
                <div className="rounded-2xl bg-white/5 border border-white/10 p-6 h-full hover:border-red-500/40 transition-colors">
                  <div className="flex items-center justify-between mb-5">
                    <div className="w-11 h-11 rounded-xl bg-red-600/20 flex items-center justify-center"><c.icon className="w-5 h-5 text-red-400" /></div>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/10 text-zinc-300">{c.platform}</span>
                  </div>
                  <div className="text-xs text-red-400 font-bold mb-1">Fushata {i + 1}</div>
                  <h3 className="text-lg font-bold mb-2">{c.title}</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">{c.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PËRMBAJTJA ═══ */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-red-600 mb-3">Përmbajtja e muajit</p><h2 className="text-3xl sm:text-4xl font-bold">Video që e shesin makinën para se klienti të vijë në sallon</h2></div></FadeIn>
          <div className="grid lg:grid-cols-2 gap-10">
            <FadeIn>
              <div className="rounded-3xl border border-gray-100 shadow-sm p-8 h-full">
                <p className="flex items-center gap-2 text-xs font-bold text-red-600 uppercase tracking-wider mb-5"><Camera className="w-4 h-4" />6 videot profesionale (shembull)</p>
                <ol className="space-y-4">
                  {VIDEOS.map((v, i) => (
                    <li key={i} className="flex items-start gap-4"><span className="w-8 h-8 rounded-full bg-red-50 text-red-600 text-sm font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span><span className="text-gray-700 pt-1">{v}</span></li>
                  ))}
                </ol>
              </div>
            </FadeIn>
            <FadeIn delay={150}>
              <div className="rounded-3xl border border-gray-100 shadow-sm p-8 h-full">
                <p className="flex items-center gap-2 text-xs font-bold text-red-600 uppercase tracking-wider mb-5"><LayoutGrid className="w-4 h-4" />Si ndahen 20 postimet</p>
                <div className="space-y-5">
                  {POSTS.map((p, i) => (
                    <div key={i}>
                      <div className="flex items-baseline justify-between mb-1.5"><span className="font-semibold">{p.label}</span><span className="text-sm text-gray-500">{p.n} postime</span></div>
                      <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-red-600 to-orange-400" style={{ width: `${(p.n / 20) * 100}%` }} /></div>
                      <p className="text-xs text-gray-500 mt-1.5">{p.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ SEO ═══ */}
      <section id="seo" className="py-24 bg-gradient-to-b from-red-50/60 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-red-600 mb-3">Sugjerimi ynë: SEO</p><h2 className="text-3xl sm:text-4xl font-bold">Dilni në faqen e parë të Google</h2><p className="mt-4 text-gray-600 max-w-2xl mx-auto">Kush kërkon "makina në shitje" në Google është gati të blejë. SEO ju vendos para tij çdo ditë — pa pagesë për klik. Rezultatet e para në 3–4 muaj, faqja e parë lokale zakonisht brenda 4–6 muajve.</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {SEO_POINTS.map((s, i) => (
              <FadeIn key={i} delay={(i % 3) * 120}>
                <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm h-full flex gap-4">
                  <div className="w-11 h-11 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0"><s.icon className="w-5 h-5 text-red-600" /></div>
                  <div><h3 className="font-bold mb-1">{s.title}</h3><p className="text-sm text-gray-600 leading-relaxed">{s.desc}</p></div>
                </div>
              </FadeIn>
            ))}
          </div>
          <FadeIn delay={200}>
            <div className="mt-10 text-center"><button onClick={() => choose('drive-seo')} className="inline-flex items-center gap-2 px-8 py-4 rounded-xl font-bold text-white bg-gradient-to-r from-red-600 to-red-700 hover:shadow-lg hover:shadow-red-600/25 transition-all hover:-translate-y-0.5">Zgjidh Penta Drive + SEO — 145.000 Lekë / muaj<ArrowRight className="w-5 h-5" /></button></div>
          </FadeIn>
        </div>
      </section>

      {/* ═══ 30 DITËT E PARA ═══ */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-red-600 mb-3">30 ditët e para</p><h2 className="text-3xl sm:text-4xl font-bold">Fushatat live brenda javës së 3-të</h2></div></FadeIn>
          <div className="grid md:grid-cols-4 gap-6 relative">
            <div className="hidden md:block absolute top-6 left-[12%] right-[12%] h-px bg-gradient-to-r from-red-500/50 via-orange-400/50 to-red-500/50" />
            {TIMELINE.map((s, i) => (
              <FadeIn key={i} delay={i * 150}>
                <div className="relative text-center">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-red-600 to-red-700 flex items-center justify-center mx-auto mb-4 text-white relative z-10"><CalendarCheck className="w-5 h-5" /></div>
                  <div className="text-xs font-bold text-red-600 uppercase tracking-wider">{s.week}</div>
                  <h3 className="text-lg font-bold mt-1 mb-2">{s.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <ClientLogos accentClass="text-red-600" />

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="py-24 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-red-600 mb-3">Kushtet & pyetjet</p><h2 className="text-3xl sm:text-4xl font-bold">Gjithçka që duhet të dini</h2></div></FadeIn>
          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <FadeIn key={i} delay={i * 80}><div className="bg-white rounded-xl border border-gray-100 overflow-hidden"><button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"><span className="font-semibold text-gray-900 pr-4">{item.q}</span><ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} /></button><div className={`transition-all duration-300 overflow-hidden ${openFaq === i ? 'max-h-72 opacity-100' : 'max-h-0 opacity-0'}`}><p className="px-6 pb-5 text-gray-600 leading-relaxed">{item.a}</p></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ KONTAKT ═══ */}
      <section id="contact" className="py-24 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 text-white relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none"><div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-red-600/10 rounded-full blur-3xl" /></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-red-400 mb-4">Gati për të filluar?</p>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">Le t'i kthejmë makinat e {CLIENT} në <span className="text-red-400">shitje reale</span></h2>
                <p className="mt-5 text-zinc-300 leading-relaxed text-lg">Zgjidhni paketën dhe na lini kontaktin. Ju telefonojmë brenda 24 orëve për takimin e strategjisë dhe nisim punën brenda javës.</p>
                <div className="mt-8 space-y-4">
                  {['Video profesionale të makinave çdo muaj', '4 fushata që sjellin thirrje dhe test-drive', 'Raport mujor me lead-e dhe kosto për lead'].map((t, i) => (
                    <div key={i} className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-zinc-300">{t}</span></div>
                  ))}
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              {formSent ? (
                <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-10 border border-white/10 text-center"><div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6"><CheckCircle2 className="w-10 h-10 text-green-400" /></div><h3 className="text-2xl font-bold mb-3">Faleminderit!</h3><p className="text-zinc-300">Zgjedhja juaj u dërgua. Do t'ju kontaktojmë brenda 24 orëve.</p></div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">Prano ofertën</h3>
                  <div>
                    <p className="text-sm font-medium text-zinc-300 mb-2">Paketa</p>
                    <div className="grid grid-cols-2 gap-3">
                      {PACKAGES.map(p => (
                        <button type="button" key={p.id} onClick={() => setPkgId(p.id)} className={`text-left px-4 py-3 rounded-xl border transition-colors ${pkgId === p.id ? 'bg-red-600/25 border-red-500' : 'bg-white/5 border-white/15 hover:border-white/30'}`}>
                          <p className="font-semibold text-sm">{p.name}</p>
                          <p className="text-xs text-zinc-400">{money(p.price)} Lekë / muaj</p>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div><label className="block text-sm font-medium text-zinc-300 mb-1.5">Emri i plotë *</label><input type="text" required value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500" placeholder="Emër Mbiemër" /></div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-zinc-300 mb-1.5">Email *</label><input type="email" required value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500" placeholder="email@pentagroup.al" /></div>
                    <div><label className="block text-sm font-medium text-zinc-300 mb-1.5">Telefon *</label><input type="tel" required value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500" placeholder="+355 6X XXX XXXX" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-zinc-300 mb-1.5">Mesazh (opsional)</label><textarea rows={3} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none" placeholder="Pyetje ose ndryshime që dëshironi në paketë..." /></div>
                  {formError && (<div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">{formError}</div>)}
                  <button type="submit" disabled={submitting} className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white shadow-lg shadow-red-600/25 transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60">{submitting ? 'Duke dërguar...' : `Prano — ${money(pkg.price)} Lekë / muaj`}{!submitting && <ArrowUpRight className="w-5 h-5" />}</button>
                  <p className="text-xs text-zinc-400 text-center flex items-center justify-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" />Pa detyrim deri në nënshkrimin e kontratës.</p>
                </form>
              )}
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="py-10 bg-black text-zinc-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2"><div className="w-6 h-6 rounded bg-gradient-to-br from-red-600 to-zinc-800 flex items-center justify-center"><Car className="w-3 h-3 text-white" /></div><span className="font-semibold text-white text-sm">Fivo × {CLIENT}</span></div>
          <p className="text-sm">&copy; {new Date().getFullYear()} FivoCRM. Të gjitha të drejtat e rezervuara.</p>
          <div className="flex items-center gap-6 text-sm"><Link to="/login" className="hover:text-white transition-colors">Hyrje</Link><a href="#paketat" className="hover:text-white transition-colors">Paketat</a><a href="#contact" className="hover:text-white transition-colors">Kontakt</a></div>
        </div>
      </footer>
    </div>
  );
}
