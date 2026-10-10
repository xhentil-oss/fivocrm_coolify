import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, Eye, UserPlus, Repeat, CalendarCheck, CheckCircle2, ArrowRight, ChevronDown, Phone,
  ArrowUpRight, Megaphone, Search, Clapperboard, LayoutGrid, BarChart3, Target,
  HeartHandshake, AlertCircle, Camera, Calculator, ShieldCheck, FlaskConical, Zap, Film,
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
   Paketë klienti — Qendër estetike
   Bërthama e çdo pakete: menaxhim reklamash + gjenerim kontaktesh +
   rimarketing + A/B testing; mbi të, përmbajtje (nga 15 postime/muaj), foto, video.
   Tre nivele: Esenca, Shkëlqimi, Prestigji.
   ═══════════════════════════════════════════════ */

// Pse ndjekësit nuk kthehen në klientë — dhimbja që hap bisedën.
const PAINS = [
  { title: 'Reklama pa drejtim', desc: 'Një postim i promovuar pa plan sjell pëlqime, jo takime. Paratë harxhohen, ndërsa kalendari mbetet bosh.' },
  { title: 'Mesazhe pa përgjigje', desc: 'Dikush pyet për çmimin në orën 21:00 dhe merr përgjigje të nesërmen. Deri atëherë, ka rezervuar gjetkë.' },
  { title: 'Interesi që harrohet', desc: 'Shumica e vizitorëve nuk rezervojnë herën e parë. Pa rimarketing, ju harrojnë brenda pak ditësh.' },
  { title: 'Përmbajtje pa histori', desc: 'Fotot e rastit nuk tregojnë as profesionalizmin, as rezultatin. Klienti nuk gjen arsye për t\'ju besuar.' },
];

// Hinka e klientëve — katër hapat nga i panjohuri te klienti i rregullt.
const FUNNEL = [
  {
    icon: Eye, step: '01', name: 'Vëmendja', width: 'w-full',
    who: 'Gratë dhe burrat në qytetin tuaj që nuk ju njohin ende',
    what: ['Reels me trajtime, rezultate "para dhe pas" dhe ekipin tuaj', 'Reklama për shikueshmëri në Instagram dhe Facebook', 'Kërkimi në Google: "botox Tiranë", "pastrim fytyre pranë meje"'],
    metric: 'Kosto për 1.000 shikime',
  },
  {
    icon: UserPlus, step: '02', name: 'Interesi', width: 'w-[88%]',
    who: 'Ata që panë videon, vizituan profilin ose kërkuan një trajtim',
    what: ['Formular "Rezervo konsultën falas" brenda Facebook-ut', 'Mesazh në WhatsApp me një prekje të vetme', 'Ofertë mirëseardhjeje për trajtimin e parë'],
    metric: 'Kosto për kontakt të ri',
  },
  {
    icon: Repeat, step: '03', name: 'Vendimi', width: 'w-[76%]',
    who: 'Ata që u interesuan, por ende nuk kanë rezervuar',
    what: ['Rimarketing me dëshmi klientësh dhe rezultate reale', 'Përgjigje për pyetjet që i mbajnë në mëdyshje: dhimbja, çmimi, kohëzgjatja', 'Kujtesë me afat: "vetëm këtë javë"'],
    metric: 'Kosto për takim të rezervuar',
  },
  {
    icon: HeartHandshake, step: '04', name: 'Besnikëria', width: 'w-[64%]',
    who: 'Klientët që kanë ardhur të paktën një herë',
    what: ['Rimarketing për seancën e radhës dhe trajtime plotësuese', 'Fushata për ditëlindjet, festat dhe ndërrimin e stinëve', 'Kërkesë për vlerësim në Google pas çdo vizite'],
    metric: 'Klientë që rikthehen çdo muaj',
  },
];

// Çfarë përfshihet, me sasitë mujore.
const CORE = [
  { icon: Megaphone, qty: '3', unit: 'fushata', title: 'Menaxhimi i reklamave në Meta', desc: 'Facebook dhe Instagram: vëmendje, kontakte të reja dhe rimarketing, secila me buxhetin dhe matjen e vet.' },
  { icon: Search, qty: '1', unit: 'fushatë', title: 'Reklama në Google', desc: 'Për ata që e kërkojnë trajtimin sot. Nga vetë reklama, klienti ju telefonon ose merr udhëzimet për të ardhur në qendër.' },
  { icon: UserPlus, qty: '∞', unit: 'pa kufi', title: 'Gjenerim kontaktesh', desc: 'Formularë, WhatsApp dhe thirrje — çdo kontakt regjistrohet në FivoCRM me emrin, trajtimin dhe reklamën nga erdhi.' },
  { icon: Repeat, qty: '2', unit: 'audienca', title: 'Rimarketing', desc: 'Rikthejmë ata që u interesuan pa rezervuar, si dhe klientët të cilëve u ka ardhur koha për seancën e radhës.' },
  { icon: FlaskConical, qty: '2+', unit: 'variante / fushatë', title: 'A/B testing', desc: 'Çdo fushatë nis me të paktën dy versione, me pamje, tekst ose ofertë të ndryshme. Buxheti kalon te versioni që sjell takime, jo te ai që na pëlqen më shumë.' },
  { icon: Zap, qty: '5', unit: 'minuta', title: 'Përgjigje e shpejtë', desc: 'Mesazhe të gatshme për WhatsApp dhe Instagram, dhe matja e kohës së përgjigjes së stafit, sepse klientin e fiton kush përgjigjet i pari.' },
  { icon: Target, qty: '1', unit: 'faqe', title: 'Faqe rezervimi', desc: 'Një faqe e thjeshtë dhe e shpejtë ku reklama çon drejt e te rezervimi i konsultës.' },
  { icon: BarChart3, qty: '1', unit: 'raport / muaj', title: 'Raport i qartë', desc: 'Sa kontakte erdhën, sa rezervuan dhe sa kushtoi secili, bashkë me rekomandimet për muajin që vjen.' },
];
const CONTENT = [
  { icon: LayoutGrid, qty: '15–30', unit: 'postime / muaj', title: 'Postime dhe karusele', desc: 'Dizajni, teksti dhe etiketat sipas planit mujor, me zërin dhe stilin e qendrës suaj. Çdo paketë nis nga 15 postime.' },
  { icon: Clapperboard, qty: '4–12', unit: 'reels / muaj', title: 'Video të shkurtra', desc: 'Trajtimi hap pas hapi, rezultati, ekipi dhe pyetjet më të shpeshta. Xhirimi dhe montazhi përfshihen.' },
  { icon: Camera, qty: '15–40', unit: 'foto / muaj', title: 'Fotografi profesionale', desc: 'Ambienti, aparaturat, ekipi dhe detajet e trajtimeve — të përpunuara me një stil të unjësuar, që e bën profilin tuaj të dallueshëm.' },
  { icon: Film, qty: '1', unit: 'video / muaj', title: 'Video promovuese', desc: 'Në paketën Prestigji: një film i shkurtër 60–90 sekondash për qendrën ose trajtimin kryesor, për reklama dhe website.' },
];

interface Pkg { id: string; name: string; price: number; tagline: string; badge?: string; items: string[] }
const PACKAGES: Pkg[] = [
  {
    id: 'esenca', name: 'Esenca', price: 80000,
    tagline: 'Hinka e plotë, me përmbajtjen bazë që e ushqen çdo muaj.',
    items: [
      '3 fushata Meta + 1 fushatë Google',
      'Gjenerim kontaktesh: formular, WhatsApp, thirrje',
      'Rimarketing për 2 audienca',
      'A/B testing: 2 variante për çdo fushatë',
      '15 postime + 4 reels në muaj',
      '1 seancë fotografike në muaj (15 foto)',
      'Menaxhim i Instagram-it dhe Facebook-ut',
      'Faqe rezervimi + çdo kontakt në FivoCRM',
      'Raport mujor me koston për takim',
    ],
  },
  {
    id: 'shkelqimi', name: 'Shkëlqimi', price: 120000, badge: 'Rekomandohet',
    tagline: 'Më shumë përmbajtje, më shumë teste, më shumë takime.',
    items: [
      'Gjithçka te Esenca',
      '20 postime + 8 reels në muaj',
      '1 ditë xhirimi foto + video në qendër (25 foto)',
      'A/B testing i avancuar: pamje, tekste, audienca dhe faqja e rezervimit',
      'Rimarketing për 4 audienca — një për çdo trajtim kryesor',
      '1 video dëshmie klienteje në muaj',
      'Stories çdo javë',
      'Mesazhe të gatshme për stafin + matja e kohës së përgjigjes',
      'Raport çdo dy javë',
    ],
  },
  {
    id: 'prestigji', name: 'Prestigji', price: 170000,
    tagline: 'Për qendrat që duan të jenë emri i parë në qytet.',
    items: [
      'Gjithçka te Shkëlqimi',
      '30 postime + 12 reels në muaj',
      '2 ditë xhirimi në muaj (40 foto)',
      '1 video promovuese profesionale (60–90 sekonda) në muaj',
      'Menaxhim i TikTok-ut',
      'Fushatë shtesë Google: YouTube / Performance Max',
      'Google Business Profile + SEO lokale',
      'Organizimi i një bashkëpunimi me influencere në muaj',
      'Takim strategjie çdo muaj + raport javor',
    ],
  },
];
// Vlera e shërbimeve nëse merren veçmas (Lekë / muaj).
const STANDALONE_VALUE: Record<string, number> = { esenca: 100000, shkelqimi: 155000, prestigji: 225000 };

const REELS = [
  'Trajtimi i javës, hap pas hapi, me zërin e specialistes',
  'Rezultati "para dhe pas" (me pëlqimin e klientes)',
  '"3 pyetjet që na bëni më shpesh" — përgjigje e shkurtër dhe e sinqertë',
  'Dita e një klienteje në qendër, nga mbërritja te rezultati',
  'Njihuni me ekipin: kush kujdeset për ju dhe pse',
  'Mite dhe të vërteta rreth një trajtimi të njohur',
  'Dëshmi video nga një kliente e kënaqur',
  'Oferta e muajit, e shpjeguar në 15 sekonda',
];
const POSTS = [
  { n: 5, label: 'Trajtime dhe rezultate', desc: 'çfarë bëni dhe çfarë fiton klientja' },
  { n: 4, label: 'Edukim', desc: 'kujdesi për lëkurën, këshilla para dhe pas trajtimit' },
  { n: 4, label: 'Besim', desc: 'dëshmi, certifikata, aparaturat dhe ekipi' },
  { n: 2, label: 'Oferta', desc: 'oferta e muajit dhe paketat stinore' },
];
const POSTS_TOTAL = POSTS.reduce((sum, p) => sum + p.n, 0);

const TIMELINE = [
  { week: 'Java 1', title: 'Njohja dhe strategjia', desc: 'Takim në qendër, trajtimet që sjellin më shumë fitim, auditimi i profileve dhe qasja në llogaritë e reklamave.' },
  { week: 'Java 2', title: 'Përmbajtja dhe faqja', desc: 'Dita e parë e xhirimit, plani mujor për miratim dhe faqja e rezervimit, gati për përdorim.' },
  { week: 'Java 3', title: 'Hinka vihet në punë', desc: 'Fushatat e vëmendjes, të kontakteve dhe të rimarketingut nisin njëkohësisht.' },
  { week: 'Java 4', title: 'Matja e parë', desc: 'Optimizimi i parë sipas kostos për takim dhe raporti i parë me numra realë.' },
];

const PROMISES = [
  { icon: ShieldCheck, title: 'Llogaritë janë tuajat', desc: 'Reklamat drejtohen nga llogaria juaj e biznesit. Nëse një ditë ndaheni nga ne, gjithçka mbetet e juaja.' },
  { icon: BarChart3, title: 'Numra, jo fjalë', desc: 'Çdo muaj e dini sa kushtoi një kontakt dhe një takim. Asnjë "shikim" nuk paraqitet si rezultat.' },
  { icon: CheckCircle2, title: 'Asgjë pa miratimin tuaj', desc: 'Planin e përmbajtjes dhe çdo video i miratoni ju, para se të publikohen.' },
];

const FAQ = [
  { q: 'A përfshihet buxheti i reklamave në çmim?', a: 'Jo. Çmimi mbulon menaxhimin, strategjinë dhe përmbajtjen. Buxheti i reklamave paguhet drejtpërdrejt te Meta dhe Google nga llogaria juaj. Për një qendër estetike rekomandojmë të nisni me 30.000–60.000 Lekë në muaj.' },
  { q: 'Kur vijnë kontaktet e para?', a: 'Fushatat nisin brenda javës së tretë dhe kontaktet e para vijnë zakonisht që në ditët e para. Hinka e gjen ritmin e saj pas 6–8 javësh, kur rimarketingu ka mbledhur audiencë të mjaftueshme.' },
  { q: 'Kush u përgjigjet mesazheve dhe thirrjeve?', a: 'Kontaktet mbërrijnë në FivoCRM dhe në WhatsApp-in tuaj në kohë reale. Rezervimin e bën stafi juaj; ne ju japim mesazhet e gatshme dhe ju tregojmë sa shpejt u përgjigjet secili, sepse shpejtësia vendos takimin.' },
  { q: 'A mund të nis me Esencën dhe të kaloj më lart më vonë?', a: 'Po. Mund të kaloni te Shkëlqimi ose Prestigji në çdo muaj; diferenca faturohet nga muaji pasardhës.' },
  { q: 'Çfarë është A/B testing dhe pse ka rëndësi?', a: 'Për çdo fushatë përgatisim të paktën dy versione — p.sh. dy video ose dy oferta të ndryshme, dhe i shfaqim njëkohësisht. Pas disa ditësh buxheti kalon te versioni që sjell më shumë takime me kosto më të ulët. Kështu reklamat bëhen çdo muaj më efektive, jo më të shtrenjta.' },
  { q: 'Si i trajtoni fotot "para dhe pas"?', a: 'Vetëm me pëlqimin me shkrim të klientes dhe brenda rregullave të Meta-s për reklamat estetike. Pa premtime që nuk mbahen: kjo mbron edhe llogarinë tuaj të reklamave.' },
  { q: 'Sa zgjat kontrata?', a: 'Të paktën 3 muaj, sepse hinkës i duhet kohë të mësojë se kush rezervon. Pagesa bëhet në fillim të çdo muaji, me faturë.' },
];

const money = (n: number) => Math.round(n).toLocaleString('de-DE');

/* ═══════════════════════════════════════════════════════════════════════ */

export default function QenderEstetikeLandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [pkgId, setPkgId] = useState('shkelqimi');
  const [formData, setFormData] = useState({ name: '', company: '', email: '', phone: '', message: '' });
  const [formSent, setFormSent] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Llogaritësi: buxheti i reklamave dhe vlera mesatare e një klienti.
  const [adBudget, setAdBudget] = useState(45000);
  const [treatmentValue, setTreatmentValue] = useState(12000);
  const pkg = PACKAGES.find(p => p.id === pkgId) || PACKAGES[0];

  // Supozime të matura për tregun shqiptar të estetikës (ilustruese, jo garanci).
  const COST_PER_CONTACT = 450;   // Lekë për kontakt nga Meta
  const BOOKING_RATE = 0.25;      // 1 në 4 kontakte rezervon
  const VISITS_PER_CLIENT = 1.5;  // seanca mesatare në 3 muajt e parë
  const contacts = adBudget / COST_PER_CONTACT;
  const bookings = contacts * BOOKING_RATE;
  const revenue = bookings * treatmentValue * VISITS_PER_CLIENT;
  const totalCost = adBudget + pkg.price;

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  const choose = (id: string) => { setPkgId(id); scrollTo('contact'); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormError(''); setSubmitting(true);
    try {
      const res = await fetch('/api/landing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          packageId: `qender-estetike-${pkg.id}`,
          packageName: `${pkg.name} — ${money(pkg.price)} Lekë / muaj`,
          estimatedValue: pkg.price,
          source: 'Qendër Estetike — Paketë Klienti',
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

  const NAV = [
    { href: '#hinka', label: 'Hinka' },
    { href: '#perfshihet', label: 'Çfarë përfshihet' },
    { href: '#llogaritesi', label: 'Llogaritësi' },
    { href: '#paketat', label: 'Paketat' },
    { href: '#faq', label: 'Pyetjet' },
  ];

  return (
    <div className="min-h-screen bg-white text-stone-900 font-sans overflow-x-hidden">
      {/* ═══ NAV ═══ */}
      <nav className="fixed top-0 w-full z-50 bg-white/85 backdrop-blur-xl border-b border-stone-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-stone-900 flex items-center justify-center"><Sparkles className="w-4 h-4 text-white" /></div>
            <span className="text-lg font-bold">Fivo <span className="text-stone-400 font-medium">·</span> <span className="text-rose-600">Estetikë</span></span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-stone-600">
            {NAV.map(l => <a key={l.href} href={l.href} className="hover:text-rose-600 transition-colors">{l.label}</a>)}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => scrollTo('contact')} className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-rose-500 to-rose-600 hover:shadow-lg hover:shadow-rose-500/25 transition-all hover:-translate-y-0.5">Rezervo takimin</button>
            <LandingMobileMenu links={NAV} ctaLabel="Rezervo takimin" onCta={() => scrollTo('contact')} accentClass="bg-gradient-to-r from-rose-500 to-rose-600" />
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="relative pt-32 pb-24 sm:pt-40 sm:pb-32 overflow-hidden bg-gradient-to-br from-stone-950 via-stone-900 to-rose-950 text-white">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-10 left-1/3 w-[700px] h-[700px] bg-rose-500/15 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-fuchsia-500/10 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/15 mb-8">
                <Sparkles className="w-4 h-4 text-rose-300" />
                <span className="text-sm font-medium text-stone-200">Paketë për qendra estetike dhe klinika bukurie</span>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                Nga një shikim në Instagram{' '}
                <span className="bg-gradient-to-r from-rose-300 to-fuchsia-300 bg-clip-text text-transparent">te një takim i rezervuar.</span>
              </h1>
            </FadeIn>
            <FadeIn delay={200}>
              <p className="mt-8 text-lg sm:text-xl text-stone-300 max-w-2xl leading-relaxed">
                Ndërtojmë për qendrën tuaj një hinkë klientësh: reklama që tërheqin vëmendjen, kontakte të reja çdo ditë dhe rimarketing që i kthen të interesuarit në klientë të rregullt —{' '}
                <strong className="text-white">duke nisur nga 80.000 Lekë në muaj.</strong>
              </p>
            </FadeIn>
            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row gap-4">
                <button onClick={() => scrollTo('hinka')} className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 hover:shadow-xl hover:shadow-rose-500/25 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">Si funksionon<ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></button>
                <button onClick={() => scrollTo('paketat')} className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border border-white/20 hover:bg-white/10 transition-all flex items-center justify-center gap-2">Shiko paketat</button>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-14 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl">
                {[{ n: '4', l: 'hapat e hinkës' }, { n: '4', l: 'fushata reklamash' }, { n: '15+', l: 'postime në muaj' }, { n: 'A/B', l: 'testim i çdo reklame' }].map((s, i) => (
                  <div key={i} className="rounded-xl bg-white/5 border border-white/10 p-4">
                    <div className="text-3xl font-extrabold text-rose-300">{s.n}</div>
                    <div className="text-xs text-stone-400 mt-1">{s.l}</div>
                  </div>
                ))}
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ PROBLEMI ═══ */}
      <section className="py-24 bg-stone-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-rose-600 mb-3">Ku humbasin klientët</p><h2 className="text-3xl sm:text-4xl font-bold">Ndjekës keni. Pse kalendari nuk mbushet?</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Shumica e qendrave estetike nuk e kanë problemin te cilësia e punës. E kanë te rruga që bën një klient i ri, nga telefoni deri te shtrati i trajtimit.</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {PAINS.map((p, i) => (
              <FadeIn key={i} delay={i * 100}>
                <div className="bg-white rounded-2xl p-6 border border-stone-100 shadow-sm h-full">
                  <div className="w-11 h-11 rounded-xl bg-rose-50 flex items-center justify-center mb-5"><AlertCircle className="w-5 h-5 text-rose-500" /></div>
                  <h3 className="font-bold mb-2">{p.title}</h3>
                  <p className="text-sm text-stone-600 leading-relaxed">{p.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
          <FadeIn delay={200}><p className="mt-12 text-center text-lg font-semibold text-stone-800">Zgjidhja nuk është "më shumë postime". Është një rrugë e qartë, hap pas hapi.</p></FadeIn>
        </div>
      </section>

      {/* ═══ HINKA ═══ */}
      <section id="hinka" className="py-24 bg-stone-950 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-rose-300 mb-3">Hinka e klientëve</p><h2 className="text-3xl sm:text-4xl font-bold">Katër hapa, nga i panjohuri te klientja besnike</h2><p className="mt-4 text-stone-400 max-w-2xl mx-auto">Çdo hap ka reklamën, mesazhin dhe matjen e vet. Kështu dimë saktësisht ku na rrëshqet klienti dhe ku duhet ndërhyrë.</p></div></FadeIn>
          <div className="space-y-4">
            {FUNNEL.map((f, i) => (
              <FadeIn key={i} delay={i * 120}>
                <div className={`mx-auto ${f.width} max-w-full`}>
                  <div className="rounded-2xl bg-gradient-to-r from-rose-500/15 via-white/5 to-fuchsia-500/10 border border-white/10 p-6 sm:p-7 grid md:grid-cols-[220px_1fr_200px] gap-5 items-start">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-rose-500/25 flex items-center justify-center flex-shrink-0"><f.icon className="w-6 h-6 text-rose-200" /></div>
                      <div><div className="text-xs font-bold text-rose-300">Hapi {f.step}</div><div className="text-xl font-bold">{f.name}</div></div>
                    </div>
                    <div>
                      <p className="text-sm text-stone-300 mb-3"><span className="text-stone-500">Kujt i flasim: </span>{f.who}</p>
                      <ul className="space-y-1.5">
                        {f.what.map((w, j) => <li key={j} className="flex items-start gap-2 text-sm text-stone-200"><CheckCircle2 className="w-4 h-4 mt-0.5 text-rose-300 flex-shrink-0" />{w}</li>)}
                      </ul>
                    </div>
                    <div className="md:text-right">
                      <div className="text-[10px] uppercase tracking-wider text-stone-500">Çfarë masim</div>
                      <div className="text-sm font-semibold text-rose-200 mt-1">{f.metric}</div>
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
          <FadeIn delay={300}><div className="mt-10 mx-auto w-fit flex items-center gap-3 px-6 py-3 rounded-full bg-rose-500 text-white font-semibold"><CalendarCheck className="w-5 h-5" />Rezultati: takime të rezervuara, çdo javë</div></FadeIn>
        </div>
      </section>

      {/* ═══ ÇFARË PËRFSHIHET ═══ */}
      <section id="perfshihet" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-14"><p className="text-sm font-semibold uppercase tracking-widest text-rose-600 mb-3">Çfarë përfshihet</p><h2 className="text-3xl sm:text-4xl font-bold">Bërthama që sjell klientë</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Menaxhimi i reklamave, gjenerimi i kontakteve, rimarketingu dhe testimi i vazhdueshëm — pjesët pa të cilat asnjë hinkë nuk funksionon. Të gjitha përfshihen në çdo paketë.</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {CORE.map((s, i) => (
              <FadeIn key={i} delay={(i % 4) * 100}>
                <div className="bg-white rounded-2xl p-6 border border-stone-100 shadow-sm hover:shadow-lg hover:border-rose-100 transition-all h-full">
                  <div className="flex items-center justify-between mb-5">
                    <div className="w-12 h-12 rounded-xl bg-rose-50 flex items-center justify-center"><s.icon className="w-6 h-6 text-rose-600" /></div>
                    <div className="text-right"><div className="text-2xl font-extrabold">{s.qty}</div><div className="text-[11px] text-stone-400">{s.unit}</div></div>
                  </div>
                  <h3 className="font-bold mb-2">{s.title}</h3>
                  <p className="text-sm text-stone-600 leading-relaxed">{s.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>

          <FadeIn><div className="text-center mt-24 mb-14"><p className="text-sm font-semibold uppercase tracking-widest text-fuchsia-600 mb-3">+ Krijim përmbajtjeje</p><h2 className="text-3xl sm:text-4xl font-bold">Përmbajtja është karburanti i reklamave</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Reklama më e mirë është një video e vërtetë nga qendra juaj. Postimet, fotot dhe videot i krijojmë ne çdo muaj, duke nisur nga 15 postime. Ju vetëm i miratoni.</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {CONTENT.map((s, i) => (
              <FadeIn key={i} delay={i * 100}>
                <div className="bg-gradient-to-b from-fuchsia-50/60 to-white rounded-2xl p-6 border border-fuchsia-100 h-full">
                  <div className="flex items-center justify-between mb-5">
                    <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shadow-sm"><s.icon className="w-6 h-6 text-fuchsia-600" /></div>
                    <div className="text-right"><div className="text-2xl font-extrabold">{s.qty}</div><div className="text-[11px] text-stone-400">{s.unit}</div></div>
                  </div>
                  <h3 className="font-bold mb-2">{s.title}</h3>
                  <p className="text-sm text-stone-600 leading-relaxed">{s.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-10 mt-12">
            <FadeIn>
              <div className="rounded-3xl border border-stone-100 shadow-sm p-8 h-full">
                <p className="flex items-center gap-2 text-xs font-bold text-fuchsia-600 uppercase tracking-wider mb-5"><Clapperboard className="w-4 h-4" />8 reels të një muaji (shembull nga Shkëlqimi)</p>
                <ol className="space-y-3.5">
                  {REELS.map((v, i) => (
                    <li key={i} className="flex items-start gap-4"><span className="w-7 h-7 rounded-full bg-fuchsia-50 text-fuchsia-600 text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span><span className="text-stone-700 pt-0.5 text-sm">{v}</span></li>
                  ))}
                </ol>
              </div>
            </FadeIn>
            <FadeIn delay={150}>
              <div className="rounded-3xl border border-stone-100 shadow-sm p-8 h-full">
                <p className="flex items-center gap-2 text-xs font-bold text-fuchsia-600 uppercase tracking-wider mb-5"><LayoutGrid className="w-4 h-4" />Si ndahen 15 postimet e Esencës</p>
                <div className="space-y-5">
                  {POSTS.map((p, i) => (
                    <div key={i}>
                      <div className="flex items-baseline justify-between mb-1.5"><span className="font-semibold">{p.label}</span><span className="text-sm text-stone-500">{p.n} postime</span></div>
                      <div className="h-2.5 rounded-full bg-stone-100 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-rose-500 to-fuchsia-500" style={{ width: `${(p.n / POSTS_TOTAL) * 100}%` }} /></div>
                      <p className="text-xs text-stone-500 mt-1.5">{p.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ LLOGARITËSI ═══ */}
      <section id="llogaritesi" className="py-24 bg-gradient-to-b from-rose-50/70 to-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-12"><p className="text-sm font-semibold uppercase tracking-widest text-rose-600 mb-3">Llogaritësi</p><h2 className="text-3xl sm:text-4xl font-bold">Sa mund t'ju sjellë hinka në muaj?</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Lëvizni dy vlerat dhe shihni rrugën e plotë: nga buxheti te kontaktet, nga kontaktet te takimet.</p></div></FadeIn>
          <FadeIn delay={100}>
            <div className="rounded-3xl bg-white border border-rose-100 shadow-xl shadow-rose-500/5 p-6 sm:p-10 grid md:grid-cols-2 gap-10">
              <div className="space-y-8">
                <div>
                  <div className="flex items-baseline justify-between mb-2"><label htmlFor="budget" className="font-semibold text-sm">Buxheti i reklamave në muaj</label><span className="font-bold text-rose-600">{money(adBudget)} Lekë</span></div>
                  <input id="budget" type="range" min={20000} max={150000} step={5000} value={adBudget} onChange={e => setAdBudget(Number(e.target.value))} className="w-full accent-rose-500" />
                </div>
                <div>
                  <div className="flex items-baseline justify-between mb-2"><label htmlFor="value" className="font-semibold text-sm">Vlera mesatare e një trajtimi</label><span className="font-bold text-rose-600">{money(treatmentValue)} Lekë</span></div>
                  <input id="value" type="range" min={3000} max={50000} step={1000} value={treatmentValue} onChange={e => setTreatmentValue(Number(e.target.value))} className="w-full accent-rose-500" />
                </div>
                <div>
                  <p className="font-semibold text-sm mb-2">Paketa</p>
                  <div className="grid grid-cols-3 gap-2">
                    {PACKAGES.map(p => (
                      <button type="button" key={p.id} onClick={() => setPkgId(p.id)} className={`text-left px-4 py-3 rounded-xl border transition-colors ${pkgId === p.id ? 'bg-rose-50 border-rose-400' : 'border-stone-200 hover:border-rose-200'}`}>
                        <p className="font-semibold text-sm">{p.name}</p><p className="text-xs text-stone-500">{money(p.price)} Lekë / muaj</p>
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-stone-400 leading-relaxed">Supozime: rreth {money(COST_PER_CONTACT)} Lekë për kontakt, 1 në 4 kontakte rezervon, {String(VISITS_PER_CLIENT).replace('.', ',')} seanca për klient në tre muajt e parë. Llogaritje ilustruese, jo garanci — numrat e vërtetë i shihni në raportin e muajit të parë.</p>
              </div>
              <div className="flex flex-col justify-center">
                <div className="space-y-3">
                  {[
                    { icon: UserPlus, l: 'Kontakte të reja', v: `≈ ${money(contacts)}` },
                    { icon: CalendarCheck, l: 'Takime të rezervuara', v: `≈ ${money(bookings)}` },
                    { icon: Calculator, l: 'Investimi gjithsej (reklama + paketa)', v: `${money(totalCost)} Lekë` },
                  ].map((r, i) => (
                    <div key={i} className="flex items-center justify-between rounded-xl bg-stone-50 px-5 py-4">
                      <span className="flex items-center gap-3 text-sm text-stone-600"><r.icon className="w-4 h-4 text-rose-500" />{r.l}</span>
                      <span className="font-bold">{r.v}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-5 rounded-2xl bg-gradient-to-br from-rose-500 to-fuchsia-600 text-white p-6">
                  <p className="text-sm text-rose-100">Të ardhura të mundshme nga klientët e rinj</p>
                  <p className="text-4xl font-extrabold mt-1">≈ {money(revenue)} Lekë</p>
                  <p className="text-sm text-rose-100 mt-2">{revenue > totalCost ? `≈ ${(revenue / totalCost).toFixed(1).replace('.', ',')} herë sa investimi` : 'Rrisni vlerën e trajtimit ose buxhetin për ta mbuluar investimin'}</p>
                </div>
                <button onClick={() => scrollTo('contact')} className="mt-5 w-full py-4 rounded-xl font-bold text-white bg-stone-900 hover:bg-stone-800 transition-colors flex items-center justify-center gap-2">Dua këtë plan për qendrën time<ArrowRight className="w-5 h-5" /></button>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══ PAKETAT ═══ */}
      <section id="paketat" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-14"><p className="text-sm font-semibold uppercase tracking-widest text-rose-600 mb-3">Paketat & çmimet</p><h2 className="text-3xl sm:text-4xl font-bold">Tre nivele, një hinkë e vetme</h2><p className="mt-4 text-stone-600 max-w-2xl mx-auto">Çdo paketë përfshin reklamat, gjenerimin e kontakteve, rimarketingun, A/B testing dhe përmbajtjen. Ndryshojnë sasia e përmbajtjes dhe thellësia e testimit. Rekomandojmë <strong>Shkëlqimin</strong>: me dyfishin e videove dhe testim të avancuar, hinka mëson më shpejt cila reklamë sjell takime.</p></div></FadeIn>
          <div className="grid lg:grid-cols-3 gap-8 max-w-md lg:max-w-none mx-auto">
            {PACKAGES.map((p, i) => {
              const featured = !!p.badge;
              const saving = STANDALONE_VALUE[p.id] - p.price;
              return (
                <FadeIn key={p.id} delay={i * 150}>
                  <div className={`relative rounded-3xl bg-white overflow-hidden h-full flex flex-col ${featured ? 'border-2 border-rose-400 shadow-2xl shadow-rose-500/10' : 'border border-stone-200 shadow-sm'}`}>
                    {featured && <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-rose-500 to-fuchsia-500" />}
                    {p.badge && <div className="absolute top-5 right-5"><span className="text-[10px] font-extrabold uppercase tracking-wider px-3 py-1 rounded-full text-white bg-gradient-to-r from-rose-500 to-fuchsia-600">{p.badge}</span></div>}
                    <div className="p-8 flex-1 flex flex-col">
                      <h3 className="text-2xl font-bold">{p.name}</h3>
                      <p className="text-sm text-stone-500 mt-2 min-h-[40px]">{p.tagline}</p>
                      <div className="mt-6 flex items-baseline gap-2">
                        <span className={`text-4xl xl:text-5xl font-extrabold ${featured ? 'text-rose-600' : 'text-stone-900'}`}>{money(p.price)}</span>
                        <span className="text-sm text-stone-500">Lekë / muaj</span>
                      </div>
                      <p className="mt-2 text-xs text-stone-500">Vlera veçmas: <span className="line-through">{money(STANDALONE_VALUE[p.id])} Lekë</span> · kurseni {money(saving)} Lekë në muaj</p>
                      <ul className="mt-7 space-y-3 flex-1">
                        {p.items.map((it, j) => (<li key={j} className="flex items-start gap-2.5 text-sm text-stone-700"><CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${featured ? 'text-rose-500' : 'text-emerald-500'}`} />{it}</li>))}
                      </ul>
                      <button onClick={() => choose(p.id)} className={`mt-8 w-full py-4 rounded-xl text-base font-bold transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 ${featured ? 'text-white bg-gradient-to-r from-rose-500 to-rose-600 hover:shadow-lg hover:shadow-rose-500/25' : 'text-stone-900 border-2 border-stone-200 hover:border-rose-300 hover:bg-rose-50'}`}>Zgjidh {p.name}<ArrowRight className="w-5 h-5" /></button>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>
          <p className="mt-8 text-center text-xs text-stone-400">Buxheti i reklamave dhe pagesa e influencerëve paguhen veçmas. Çmimet pa TVSH. Kontratë minimale 3 muaj.</p>

          <div className="grid md:grid-cols-3 gap-6 mt-16">
            {PROMISES.map((s, i) => (
              <FadeIn key={i} delay={i * 100}>
                <div className="rounded-2xl bg-stone-50 p-6 h-full flex gap-4">
                  <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm"><s.icon className="w-5 h-5 text-rose-500" /></div>
                  <div><h3 className="font-bold mb-1">{s.title}</h3><p className="text-sm text-stone-600 leading-relaxed">{s.desc}</p></div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 30 DITËT E PARA ═══ */}
      <section className="py-24 bg-stone-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-rose-600 mb-3">30 ditët e para</p><h2 className="text-3xl sm:text-4xl font-bold">Hinka ndizet brenda javës së tretë</h2></div></FadeIn>
          <div className="grid md:grid-cols-4 gap-6 relative">
            <div className="hidden md:block absolute top-6 left-[12%] right-[12%] h-px bg-gradient-to-r from-rose-400/50 via-fuchsia-400/50 to-rose-400/50" />
            {TIMELINE.map((s, i) => (
              <FadeIn key={i} delay={i * 150}>
                <div className="relative text-center">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-rose-500 to-fuchsia-600 flex items-center justify-center mx-auto mb-4 text-white relative z-10 font-bold">{i + 1}</div>
                  <div className="text-xs font-bold text-rose-600 uppercase tracking-wider">{s.week}</div>
                  <h3 className="text-lg font-bold mt-1 mb-2">{s.title}</h3>
                  <p className="text-sm text-stone-500 leading-relaxed">{s.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <ClientLogos accentClass="text-rose-600" />

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="py-24 bg-stone-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-rose-600 mb-3">Kushtet & pyetjet</p><h2 className="text-3xl sm:text-4xl font-bold">Gjithçka që duhet të dini</h2></div></FadeIn>
          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <FadeIn key={i} delay={i * 80}><div className="bg-white rounded-xl border border-stone-100 overflow-hidden"><button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-stone-50 transition-colors"><span className="font-semibold pr-4">{item.q}</span><ChevronDown className={`w-5 h-5 text-stone-400 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} /></button><div className={`transition-all duration-300 overflow-hidden ${openFaq === i ? 'max-h-72 opacity-100' : 'max-h-0 opacity-0'}`}><p className="px-6 pb-5 text-stone-600 leading-relaxed">{item.a}</p></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ KONTAKT ═══ */}
      <section id="contact" className="py-24 bg-gradient-to-br from-stone-950 via-stone-900 to-rose-950 text-white relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none"><div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-rose-500/10 rounded-full blur-3xl" /></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-rose-300 mb-4">Hapi i parë</p>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">Le ta mbushim kalendarin e qendrës suaj me <span className="text-rose-300">takime të vërteta</span></h2>
                <p className="mt-5 text-stone-300 leading-relaxed text-lg">Zgjidhni paketën dhe na lini kontaktin. Brenda 24 orëve ju telefonojmë për një takim njohjeje — falas dhe pa asnjë detyrim.</p>
                <div className="mt-8 space-y-4">
                  {['Hinkë e plotë: vëmendje, kontakte, rimarketing, A/B testing', 'Çdo kontakt në FivoCRM, me burimin e reklamës', 'Përmbajtje e re çdo muaj: nga 15 postime, foto dhe video'].map((t, i) => (
                    <div key={i} className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-400" /><span className="text-stone-300">{t}</span></div>
                  ))}
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              {formSent ? (
                <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-10 border border-white/10 text-center"><div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-6"><CheckCircle2 className="w-10 h-10 text-emerald-400" /></div><h3 className="text-2xl font-bold mb-3">Faleminderit!</h3><p className="text-stone-300">Kërkesa juaj u dërgua. Do t'ju telefonojmë brenda 24 orëve.</p></div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">Rezervo takimin e njohjes</h3>
                  <div>
                    <p className="text-sm font-medium text-stone-300 mb-2">Paketa</p>
                    <div className="grid grid-cols-3 gap-2">
                      {PACKAGES.map(p => (
                        <button type="button" key={p.id} onClick={() => setPkgId(p.id)} className={`text-left px-4 py-3 rounded-xl border transition-colors ${pkgId === p.id ? 'bg-rose-500/25 border-rose-400' : 'bg-white/5 border-white/15 hover:border-white/30'}`}>
                          <p className="font-semibold text-sm">{p.name}</p>
                          <p className="text-xs text-stone-400">{money(p.price)} Lekë / muaj</p>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-stone-300 mb-1.5">Emri i plotë *</label><input type="text" required value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-rose-400" placeholder="Emër Mbiemër" /></div>
                    <div><label className="block text-sm font-medium text-stone-300 mb-1.5">Emri i qendrës</label><input type="text" value={formData.company} onChange={e => setFormData(p => ({ ...p, company: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-rose-400" placeholder="Qendra Estetike ..." /></div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-stone-300 mb-1.5">Email *</label><input type="email" required value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-rose-400" placeholder="email@qendra.al" /></div>
                    <div><label className="block text-sm font-medium text-stone-300 mb-1.5">Telefon *</label><input type="tel" required value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-rose-400" placeholder="+355 6X XXX XXXX" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-stone-300 mb-1.5">Mesazh (opsional)</label><textarea rows={3} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none" placeholder="Cilat trajtime doni të promovoni më shumë?" /></div>
                  {formError && (<div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">{formError}</div>)}
                  <button type="submit" disabled={submitting} className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-400 hover:to-rose-500 text-white shadow-lg shadow-rose-500/25 transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60">{submitting ? 'Duke dërguar...' : `Dërgo kërkesën — ${pkg.name}`}{!submitting && <ArrowUpRight className="w-5 h-5" />}</button>
                  <p className="text-xs text-stone-400 text-center flex items-center justify-center gap-1.5"><Phone className="w-3.5 h-3.5" />Takimi i njohjes është falas dhe pa detyrim.</p>
                </form>
              )}
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="py-10 bg-black text-stone-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2"><div className="w-6 h-6 rounded bg-gradient-to-br from-rose-500 to-stone-800 flex items-center justify-center"><Sparkles className="w-3 h-3 text-white" /></div><span className="font-semibold text-white text-sm">Fivo · Estetikë</span></div>
          <p className="text-sm">&copy; {new Date().getFullYear()} FivoCRM. Të gjitha të drejtat e rezervuara.</p>
          <div className="flex items-center gap-6 text-sm"><Link to="/login" className="hover:text-white transition-colors">Hyrje</Link><a href="#paketat" className="hover:text-white transition-colors">Paketat</a><a href="#contact" className="hover:text-white transition-colors">Kontakt</a></div>
        </div>
      </footer>
    </div>
  );
}
