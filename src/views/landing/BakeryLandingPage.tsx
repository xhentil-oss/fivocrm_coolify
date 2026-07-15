import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Croissant, Camera, CheckCircle2, ArrowRight, Star, Clock,
  ChevronDown, Phone, ArrowUpRight, Sparkles, Shield, Megaphone,
  TrendingUp, CalendarCheck, BarChart3, Cake, Coffee, Cookie,
} from 'lucide-react';
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
   Paketa Social Bakery — Rrjete Sociale për Furra & Pastiçeri
   ═══════════════════════════════════════════════ */
const PACKAGE = {
  name: 'Social Bakery',
  tagline: 'Menaxhim i plotë i rrjeteve sociale, i krijuar posaçërisht për furra buke, pastiçeri dhe ëmbëltore.',
  price: '60.000',
  priceNote: 'Lekë / muaj',
  cta: 'Dua këtë paketë',
  highlight: 'Çdo muaj: përmbajtje e freskët, reklama që sjellin klientë dhe një prezencë online që hap oreksin.',
  groups: [
    {
      icon: Camera,
      title: 'Përmbajtja & Prodhimi',
      items: [
        'Menaxhim i Instagram, Facebook dhe TikTok',
        '16 postime në muaj që hapin oreksin',
        '12 Reels në muaj me produktet tuaja të freskëta',
        '2 ditë xhirimi në muaj brenda furrës suaj',
        'Regji dhe editim profesional i videove',
        'Stories ditore që tregojnë përditshmërinë e furrës',
      ],
    },
    {
      icon: Megaphone,
      title: 'Reklama që sjellin klientë',
      items: [
        'Menaxhim i reklamave në Meta Ads Manager',
        'Targetim lokal — klientët brenda zonës suaj',
        'Fushata për porosi online dhe vizita në dyqan',
      ],
    },
    {
      icon: TrendingUp,
      title: 'Rritje & Raportim',
      items: [
        'Strategji për video që bëhen virale',
        'Rritje organike e shikueshmërisë',
        'Raport mujor i qartë me rezultate reale',
      ],
    },
  ],
};

const BUSINESS_TYPES = [
  { icon: Croissant, label: 'Furra Buke' },
  { icon: Cake, label: 'Pastiçeri' },
  { icon: Cookie, label: 'Ëmbëltore' },
  { icon: Coffee, label: 'Kafe & Brunch' },
];

const WHY = [
  { icon: Camera, title: 'Klienti zgjedh me sy', desc: 'Produktet tuaja janë të shijshme, por një foto e bërë shpejt me telefon nuk e tregon freskinë e tyre. Klienti vendos në pak sekonda nëse i vjen uria — ose jo.' },
  { icon: Star, title: 'Konkurrenti është online çdo ditë', desc: 'Furrat që postojnë rregullt me foto e video profesionale duken më të besueshme dhe tërheqin më shumë klientë — edhe kur produkti është i njëjtë me tuajin.' },
  { icon: Clock, title: 'Nuk keni kohë për rrjetet', desc: 'Ju jeni në furrë që në orët e para të mëngjesit. Postimet mbeten pas, algoritmi ju ndëshkon dhe humbisni klientë çdo ditë pa e kuptuar.' },
];

const STEPS = [
  { icon: CalendarCheck, title: 'Njihemi & planifikojmë', desc: 'Kuptojmë produktet, klientët dhe qëllimet tuaja. Ndërtojmë një plan mujor të qartë.' },
  { icon: Camera, title: 'Xhirojmë te ju', desc: 'Vijmë në furrën tuaj dhe xhirojmë produktet e freskëta, ambientin dhe ekipin.' },
  { icon: Megaphone, title: 'Postojmë & reklamojmë', desc: 'Publikojmë përmbajtjen sipas orarit optimal dhe aktivizojmë reklamat lokale.' },
  { icon: BarChart3, title: 'Rritemi & raportojmë', desc: 'Çdo muaj ju tregojmë me numra realë çfarë arritëm dhe planin për muajin tjetër.' },
];

const TESTIMONIALS = [
  { name: 'Ervin Kola', role: 'Pronar, Furra "Buka e Ditës"', quote: 'Që kur filluam, klientët vijnë duke thënë "e pashë në Instagram". Reels-et me byrekët tanë të nxehtë bëjnë mrekulli.', avatar: 'EK' },
  { name: 'Sara Meta', role: 'Pastiçeri "Dolce Vita"', quote: 'Porositë për torta u shtuan ndjeshëm. Fotot duken aq të bukura sa njerëzit i ndajnë vetë. Ia vlejti çdo lek.', avatar: 'SM' },
  { name: 'Blerim Hoxha', role: 'Ëmbëltore "Sheqerka"', quote: 'Më në fund nuk mendoj më për postime. Ata merren me gjithçka dhe unë përqendrohem te prodhimi. Shumë profesionalë.', avatar: 'BH' },
];

const FAQ = [
  { q: 'A vini ju te furra për të xhiruar?', a: 'Po. Xhirimet bëhen brenda ambientit tuaj, në ditë e orar të dakorduar paraprakisht, që produktet të duken të freskëta dhe reale.' },
  { q: 'Sa shpejt shoh rezultate?', a: 'Rritjen e parë në shikueshmëri dhe ndërveprim e vini re brenda 30 ditëve. Porositë dhe vizitat fillojnë të rriten pas 4–8 javësh me punë të vazhdueshme.' },
  { q: 'A përfshihet buxheti i reklamave në çmim?', a: 'Jo. Çmimi mbulon menaxhimin e plotë. Buxheti i reklamave paguhet direkt te platformat (Meta) dhe e vendosni ju — ne rekomandojmë 15.000–30.000 Lekë/muaj për fillim.' },
  { q: 'A kam kontratë afatgjatë?', a: 'Jo. Punojmë muaj pas muaji me rezultate. Mund ta ndaloni ose ndryshoni bashkëpunimin kur të dëshironi.' },
  { q: 'Kush i shkruan tekstet dhe idetë?', a: 'Ne. Ju vetëm na tregoni produktet dhe ofertat e javës — pjesën tjetër (ide, tekste, regji, editim) e marrim përsipër ne.' },
];

/* ═══════════════════════════════════════════════════════════════════════ */

export default function BakeryLandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', website: '', message: '' });
  const [formSent, setFormSent] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const scrollToPackage = () => document.getElementById('paketa')?.scrollIntoView({ behavior: 'smooth' });
  const scrollToContact = () => document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormError(''); setSubmitting(true);
    try {
      const res = await fetch('/api/landing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          packageId: 'social-bakery',
          packageName: `${PACKAGE.name} — ${PACKAGE.price} ${PACKAGE.priceNote}`,
          source: 'Bakery Landing Page',
          category: 'Social Media',
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
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center"><Croissant className="w-4 h-4 text-white" /></div>
            <span className="text-xl font-bold bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-transparent">Social Bakery</span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-gray-600">
            <a href="#pse" className="hover:text-orange-600 transition-colors">Pse</a>
            <a href="#si-funksionon" className="hover:text-orange-600 transition-colors">Si funksionon</a>
            <a href="#paketa" className="hover:text-orange-600 transition-colors">Paketa</a>
            <a href="#faq" className="hover:text-orange-600 transition-colors">Pyetjet</a>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="hidden sm:inline-flex text-sm font-medium text-gray-600 hover:text-orange-600 transition-colors">Hyr</Link>
            <button onClick={scrollToContact} className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-amber-500 to-orange-600 hover:shadow-lg hover:shadow-orange-500/25 transition-all hover:-translate-y-0.5">Konsultim Falas</button>
            <LandingMobileMenu
              links={[
                { href: '#pse', label: 'Pse' },
                { href: '#si-funksionon', label: 'Si funksionon' },
                { href: '#paketa', label: 'Paketa' },
                { href: '#faq', label: 'Pyetjet' },
              ]}
              ctaLabel="Konsultim Falas"
              onCta={scrollToContact}
              accentClass="bg-gradient-to-r from-amber-500 to-orange-600"
            />
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
                <Croissant className="w-4 h-4 text-orange-600" />
                <span className="text-sm font-medium text-orange-700">Rrjete sociale për furra & pastiçeri</span>
                <div className="flex">{[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}</div>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                Furra juaj meriton të jetë{' '}
                <span className="bg-gradient-to-r from-amber-500 via-orange-600 to-rose-500 bg-clip-text text-transparent">e para që i vjen ndër mend</span> klientit.
              </h1>
            </FadeIn>
            <FadeIn delay={200}>
              <p className="mt-8 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
                Ne menaxhojmë Instagram, Facebook e TikTok, xhirojmë produktet tuaja të freskëta dhe sjellim klientë me reklama lokale.{' '}
                <strong className="text-orange-600">Ju përqendroheni te furra — ne te rrjetet.</strong>
              </p>
            </FadeIn>
            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button onClick={scrollToPackage} className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:shadow-xl hover:shadow-orange-500/25 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">Shiko Paketën<ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></button>
                <button onClick={scrollToContact} className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border-2 border-gray-200 hover:border-orange-300 hover:bg-orange-50 transition-all flex items-center justify-center gap-2"><Phone className="w-5 h-5" />Konsultim Falas</button>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-400">
                <span className="flex items-center gap-1.5"><Camera className="w-4 h-4 text-orange-500" /> Xhirojmë te ju</span>
                <span className="flex items-center gap-1.5"><Megaphone className="w-4 h-4 text-amber-500" /> Reklama lokale</span>
                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-500" /> Pa kontratë afatgjatë</span>
              </div>
            </FadeIn>
          </div>

          {/* Llojet e bizneseve */}
          <FadeIn delay={500}>
            <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto">
              {BUSINESS_TYPES.map((b, i) => (
                <div key={i} className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-100 hover:border-orange-200 hover:bg-orange-50/40 transition-colors text-center">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center"><b.icon className="w-5 h-5 text-orange-600" /></div>
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
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-orange-600 mb-3">Pse rrjetet sociale</p><h2 className="text-3xl sm:text-4xl font-bold">Klienti e ha me sy përpara se me gojë</h2></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {WHY.map((w, i) => (
              <FadeIn key={i} delay={i * 150}><div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 hover:shadow-lg hover:border-orange-100 transition-all h-full"><div className="w-14 h-14 rounded-xl bg-amber-50 flex items-center justify-center mb-6"><w.icon className="w-7 h-7 text-orange-600" /></div><h3 className="text-xl font-bold mb-3">{w.title}</h3><p className="text-gray-600 leading-relaxed">{w.desc}</p></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SI FUNKSIONON ═══ */}
      <section id="si-funksionon" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-orange-600 mb-3">Si funksionon</p><h2 className="text-3xl sm:text-4xl font-bold">Thjesht, në 4 hapa</h2></div></FadeIn>
          <div className="grid md:grid-cols-4 gap-6 relative">
            <div className="hidden md:block absolute top-16 left-[12%] right-[12%] h-px bg-gradient-to-r from-amber-500/50 via-orange-500/50 to-amber-500/50" />
            {STEPS.map((s, i) => (
              <FadeIn key={i} delay={i * 150}><div className="relative text-center p-6 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg hover:border-orange-200 transition-all group"><div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center mx-auto mb-4 text-lg font-bold text-white relative z-10">{i + 1}</div><s.icon className="w-6 h-6 text-orange-600 mx-auto mb-3 group-hover:scale-110 transition-transform" /><h3 className="text-lg font-bold mb-2">{s.title}</h3><p className="text-gray-500 text-sm leading-relaxed">{s.desc}</p></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PAKETA ═══ */}
      <section id="paketa" className="py-24 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-12"><p className="text-sm font-semibold uppercase tracking-widest text-orange-600 mb-3">Paketa</p><h2 className="text-3xl sm:text-4xl font-bold">Gjithçka që i duhet furrës suaj online</h2><p className="mt-4 text-gray-600">Një paketë e vetme, e plotë. Pa gjëra të fshehura, pa kontratë afatgjatë.</p></div></FadeIn>
          <FadeIn delay={150}>
            <div className="relative rounded-3xl bg-white border-2 border-orange-200 shadow-xl overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500" />
              <div className="p-8 sm:p-10">
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-2">
                  <div>
                    <h3 className="text-2xl font-bold">{PACKAGE.name}</h3>
                    <p className="text-sm text-gray-500 mt-1 max-w-md">{PACKAGE.tagline}</p>
                  </div>
                  <div className="text-left sm:text-right flex-shrink-0">
                    <div className="flex items-baseline gap-1.5 sm:justify-end"><span className="text-4xl font-bold bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-transparent">{PACKAGE.price}</span></div>
                    <span className="text-sm text-gray-500">{PACKAGE.priceNote}</span>
                  </div>
                </div>

                <div className="mt-6 p-4 rounded-xl bg-amber-50 border border-amber-100 flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-gray-700">{PACKAGE.highlight}</p>
                </div>

                <div className="mt-8 grid sm:grid-cols-3 gap-6">
                  {PACKAGE.groups.map((g, gi) => (
                    <div key={gi}>
                      <p className="flex items-center gap-2 text-xs font-bold text-orange-600 uppercase tracking-wider mb-3"><g.icon className="w-4 h-4" />{g.title}</p>
                      <ul className="space-y-2">
                        {g.items.map((item, ii) => (<li key={ii} className="flex items-start gap-2 text-sm text-gray-700"><CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />{item}</li>))}
                      </ul>
                    </div>
                  ))}
                </div>

                <button onClick={scrollToContact} className="mt-9 w-full py-4 rounded-xl text-base font-bold text-white bg-gradient-to-r from-amber-500 to-orange-600 hover:shadow-lg hover:shadow-orange-500/25 transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2">{PACKAGE.cta}<ArrowRight className="w-5 h-5" /></button>
                <p className="mt-3 text-center text-xs text-gray-400">Buxheti i reklamave paguhet direkt te platformat dhe nuk përfshihet në çmim.</p>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══ DËSHMITË ═══ */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-orange-600 mb-3">Dëshmi klientësh</p><h2 className="text-3xl sm:text-4xl font-bold">Furra që tashmë po rriten me ne</h2></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {TESTIMONIALS.map((t, i) => (
              <FadeIn key={i} delay={i * 150}><div className="p-8 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg transition-all h-full flex flex-col"><div className="flex mb-4">{[1,2,3,4,5].map(j => (<Star key={j} className="w-5 h-5 text-amber-400 fill-amber-400" />))}</div><p className="text-gray-700 leading-relaxed flex-1 italic">"{t.quote}"</p><div className="mt-6 flex items-center gap-3 pt-4 border-t border-gray-100"><div className="w-11 h-11 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-sm">{t.avatar}</div><div><p className="font-semibold text-sm">{t.name}</p><p className="text-xs text-gray-500">{t.role}</p></div></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="py-24 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-orange-600 mb-3">Pyetjet e shpeshta</p><h2 className="text-3xl sm:text-4xl font-bold">Gjithçka që duhet të dini</h2></div></FadeIn>
          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <FadeIn key={i} delay={i * 80}><div className="bg-white rounded-xl border border-gray-100 overflow-hidden"><button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"><span className="font-semibold text-gray-900 pr-4">{item.q}</span><ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} /></button><div className={`transition-all duration-300 overflow-hidden ${openFaq === i ? 'max-h-60 opacity-100' : 'max-h-0 opacity-0'}`}><p className="px-6 pb-5 text-gray-600 leading-relaxed">{item.a}</p></div></div></FadeIn>
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
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">Le ta bëjmë furrën tuaj <span className="text-orange-400">të parën në lagje</span> — edhe online</h2>
                <p className="mt-5 text-gray-300 leading-relaxed text-lg">Plotësoni formularin dhe ju kontaktojmë për një konsultim falas. Ju tregojmë saktësisht çfarë mund të arrihet me furrën tuaj në rrjetet sociale.</p>
                <div className="mt-8 space-y-4">
                  <div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">Xhirojmë te ju — pa stres</span></div>
                  <div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">Përmbajtje e freskët çdo javë</span></div>
                  <div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">Pa kontratë afatgjatë</span></div>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              {formSent ? (
                <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-10 border border-white/10 text-center"><div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6"><CheckCircle2 className="w-10 h-10 text-green-400" /></div><h3 className="text-2xl font-bold mb-3">Faleminderit!</h3><p className="text-gray-300">Kërkesa juaj u dërgua me sukses. Do t'ju kontaktojmë brenda 24 orëve.</p></div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">Merr konsultimin falas</h3>
                  <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-orange-500/20 border border-orange-500/30"><div><p className="text-xs text-orange-300">Paketa</p><p className="font-semibold text-white">{PACKAGE.name} — {PACKAGE.price} {PACKAGE.priceNote}</p></div><Croissant className="w-6 h-6 text-orange-300" /></div>
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Emri i plotë *</label><input type="text" required value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500" placeholder="Emër Mbiemër" /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Email *</label><input type="email" required value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500" placeholder="email@furra.al" /></div>
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Telefon</label><input type="tel" value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500" placeholder="+355 6X XXX XXXX" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Furra / Instagram (nëse keni)</label><input type="text" value={formData.website} onChange={e => setFormData(p => ({ ...p, website: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500" placeholder="@instagram ose emri i furrës" /></div>
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Mesazh (opsional)</label><textarea rows={3} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none" placeholder="Na tregoni shkurt për furrën tuaj..." /></div>
                  {formError && (<div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">{formError}</div>)}
                  <button type="submit" disabled={submitting} className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white shadow-lg shadow-orange-500/25 transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60">{submitting ? 'Duke dërguar...' : 'Dërgo Kërkesën'}{!submitting && <ArrowUpRight className="w-5 h-5" />}</button>
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
          <div className="flex items-center gap-2"><div className="w-6 h-6 rounded bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center"><Croissant className="w-3 h-3 text-white" /></div><span className="font-semibold text-white text-sm">Social Bakery</span></div>
          <p className="text-sm">&copy; {new Date().getFullYear()} FivoCRM. Të gjitha të drejtat e rezervuara.</p>
          <div className="flex items-center gap-6 text-sm"><Link to="/login" className="hover:text-white transition-colors">Hyrje</Link><a href="#paketa" className="hover:text-white transition-colors">Paketa</a><a href="#contact" className="hover:text-white transition-colors">Kontakt</a></div>
        </div>
      </footer>
    </div>
  );
}
