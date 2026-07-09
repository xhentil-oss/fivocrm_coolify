import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Car, Plane, MapPin, Search, TrendingUp, Star, Globe, CheckCircle2,
  ArrowRight, Phone, ChevronDown, ArrowUpRight, Sparkles, Shield, Clock,
  Target, Link2, Megaphone, Rocket, Users, XCircle,
} from 'lucide-react';
import LandingMobileMenu from './LandingMobileMenu';

/* ─── Animazione allo scroll ─── */
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
   Il problema (agitazione — parte alta del funnel)
   ═══════════════════════════════════════════════ */
const PROBLEMS = [
  {
    icon: XCircle,
    title: 'Dipendi dagli intermediari',
    desc: 'Piattaforme e broker si prendono il 15–25% di commissione su ogni corsa. Lavori tanto, ma il margine resta a loro. Ogni prenotazione diretta persa è denaro regalato.',
  },
  {
    icon: Search,
    title: 'Su Google non ti trova nessuno',
    desc: 'Quando un cliente cerca "transfer aeroporto" o "NCC" nella tua zona, compaiono i tuoi concorrenti — non tu. Sei invisibile proprio dove si decide la prenotazione.',
  },
  {
    icon: Globe,
    title: 'Il tuo sito non converte',
    desc: 'Un sito lento, vecchio o senza prenotazione online fa scappare il cliente in pochi secondi. Le visite ci sono, ma non si trasformano in richieste reali.',
  },
];

/* ═══════════════════════════════════════════════
   Il nostro metodo (parte centrale del funnel)
   ═══════════════════════════════════════════════ */
const METHOD = [
  { icon: Globe, title: 'Ti rendiamo credibile', desc: 'Un sito professionale con prenotazione online che ispira fiducia e trasforma i visitatori in richieste.' },
  { icon: Search, title: 'Ti rendiamo visibile', desc: 'SEO e Google Maps per apparire in cima quando il cliente cerca un transfer nella tua zona.' },
  { icon: Megaphone, title: 'Ti portiamo richieste', desc: 'Google Ads mirati alle ricerche ad alta intenzione: chi vuole prenotare adesso trova te.' },
  { icon: TrendingUp, title: 'Facciamo crescere le prenotazioni', desc: 'Ottimizziamo ogni mese il funnel per aumentare le prenotazioni dirette e ridurre le commissioni.' },
];

/* ═══════════════════════════════════════════════
   Servizi in dettaglio (parte bassa del funnel)
   ═══════════════════════════════════════════════ */
interface ServiceDetail {
  icon: React.ElementType;
  tag: string;
  title: string;
  tagline: string;
  color: string;
  bg: string;
  points: string[];
  outcome: string;
}

const SERVICES: ServiceDetail[] = [
  {
    icon: Globe,
    tag: 'Fondamenta',
    title: 'Ridisegno del sito web',
    tagline: 'Il tuo biglietto da visita digitale, pensato per far prenotare.',
    color: 'text-blue-600',
    bg: 'from-blue-50/60 border-blue-200',
    points: [
      'Design moderno e professionale che comunica affidabilità e classe',
      'Sistema di prenotazione e richiesta preventivo online integrato',
      'Velocità di caricamento ottimizzata (Core Web Vitals di Google)',
      '100% responsive: perfetto su telefono, tablet e desktop',
      'Multilingua (Italiano / Inglese) per i clienti internazionali',
      'Testi persuasivi orientati alla conversione, non solo descrittivi',
      'Pulsanti diretti: WhatsApp, chiamata immediata e Google Maps',
    ],
    outcome: 'Un sito che lavora per te 24/7 e trasforma le visite in prenotazioni.',
  },
  {
    icon: Search,
    tag: 'Visibilità organica',
    title: 'SEO — Posizionamento su Google',
    tagline: 'Comparire in prima pagina quando il cliente cerca un transfer.',
    color: 'text-emerald-600',
    bg: 'from-emerald-50/60 border-emerald-200',
    points: [
      'Analisi delle parole chiave reali ("transfer aeroporto [città]", "NCC [città]")',
      'Ottimizzazione on-page: titoli, meta descrizioni e struttura del sito',
      'Una pagina dedicata per ogni tratta e ogni servizio che offri',
      'Contenuti e blog che intercettano le ricerche dei viaggiatori',
      'SEO locale per dominare la tua città e le zone che copri',
      'Report mensile chiaro sul posizionamento e sui progressi',
    ],
    outcome: 'Traffico costante e gratuito da chi sta già cercando te.',
  },
  {
    icon: Megaphone,
    tag: 'Risultati immediati',
    title: 'Google Ads',
    tagline: 'Prenotazioni fin dal primo giorno, mentre la SEO cresce.',
    color: 'text-orange-600',
    bg: 'from-orange-50/60 border-orange-200',
    points: [
      'Campagne di ricerca sulle richieste ad alta intenzione di acquisto',
      'Targeting su aeroporti, hotel, porti e zone turistiche strategiche',
      'Gestione e ottimizzazione continua del budget pubblicitario',
      'Estensioni di chiamata e prenotazione direttamente nell\'annuncio',
      'Remarketing verso chi ha già visitato il tuo sito senza prenotare',
      'Focus sul costo per prenotazione, non sui click a vuoto',
    ],
    outcome: 'Un flusso prevedibile di richieste, controllabile e misurabile.',
  },
  {
    icon: MapPin,
    tag: 'Presenza locale',
    title: 'Profilo Google Maps',
    tagline: 'Farti trovare nella mappa, dove si decide "chi chiamo adesso".',
    color: 'text-red-600',
    bg: 'from-red-50/60 border-red-200',
    points: [
      'Apertura e ottimizzazione completa del profilo Google Business',
      'Foto professionali, servizi, orari e area geografica coperta',
      'Strategia di recensioni per aumentare la fiducia dei clienti',
      'Post e aggiornamenti periodici per restare attivo e rilevante',
      'Comparsa nei risultati locali e nelle ricerche "vicino a me"',
    ],
    outcome: 'Più chiamate dirette da chi cerca un transfer nella tua zona.',
  },
  {
    icon: Link2,
    tag: 'Autorità',
    title: 'Aumento dell\'autorità del dominio',
    tagline: 'Più autorevole agli occhi di Google = posizioni più alte.',
    color: 'text-violet-600',
    bg: 'from-violet-50/60 border-violet-200',
    points: [
      'Costruzione di backlink di qualità da siti affidabili',
      'Citazioni su directory di settore, turismo e trasporti',
      'Collaborazioni e menzioni con hotel e portali locali',
      'Segnali di fiducia che migliorano tutto il posizionamento',
      'Crescita graduale e solida della Domain Authority',
    ],
    outcome: 'Un dominio forte che rende ogni altra azione SEO più efficace.',
  },
  {
    icon: TrendingUp,
    tag: 'Obiettivo finale',
    title: 'Aumento delle prenotazioni',
    tagline: 'Tutto converge qui: più prenotazioni dirette, più margine.',
    color: 'text-cyan-600',
    bg: 'from-cyan-50/60 border-cyan-200',
    points: [
      'Funnel di conversione ottimizzato dal primo click alla prenotazione',
      'Call-to-action chiare: prenota, preventivo, WhatsApp, chiama',
      'Riduzione della dipendenza da intermediari e commissioni',
      'Analisi mensile dei dati per migliorare continuamente i risultati',
      'Più prenotazioni dirette significa più profitto che resta a te',
    ],
    outcome: 'Il vero traguardo: un\'attività che cresce e non dipende da altri.',
  },
];

/* ═══════════════════════════════════════════════
   Pacchetti / Prezzi
   ═══════════════════════════════════════════════ */
interface Pkg {
  id: string;
  title: string;
  idealFor: string;
  price: string;
  priceNote: string;
  badge?: string;
  popular?: boolean;
  color: string;
  border: string;
  ring: string;
  cta: string;
  includes: string[];
  note: string;
}

const PACKAGES: Pkg[] = [
  {
    id: 'website',
    title: 'Sito Web Professionale',
    idealFor: 'La base indispensabile: un sito moderno pensato per convertire i visitatori in prenotazioni.',
    price: '1.500',
    priceNote: '€ · una tantum',
    color: 'from-blue-600 to-cyan-500',
    border: 'border-blue-200 hover:border-blue-400',
    ring: 'ring-blue-400',
    cta: 'Voglio il nuovo sito',
    includes: [
      'Ridisegno completo e moderno del sito',
      'Sistema di prenotazione / preventivo online',
      'Ottimizzato per velocità e mobile',
      'Multilingua (IT / EN)',
      'Testi persuasivi orientati alla conversione',
      'Integrazione WhatsApp, chiamata e Google Maps',
    ],
    note: 'Pagamento una tantum. La base su cui costruire tutta la crescita.',
  },
  {
    id: 'growth',
    title: 'Crescita & Prenotazioni',
    idealFor: 'Il motore mensile che porta visibilità, richieste e prenotazioni dirette in modo costante.',
    price: '900',
    priceNote: '€ / mese',
    badge: 'Più scelto',
    popular: true,
    color: 'from-cyan-600 to-blue-600',
    border: 'border-cyan-300 hover:border-cyan-500',
    ring: 'ring-cyan-400',
    cta: 'Voglio più prenotazioni',
    includes: [
      'SEO — posizionamento su Google',
      'Google Ads — gestione completa delle campagne',
      'Profilo Google Maps — apertura e ottimizzazione',
      'Aumento dell\'autorità del dominio (Domain Authority)',
      'Ottimizzazione continua per l\'aumento delle prenotazioni',
      'Report mensile con risultati e prossimi passi',
    ],
    note: 'Contratto minimo di 3 mesi — il tempo necessario per vedere risultati reali.',
  },
];

const STATS = [
  { icon: TrendingUp, value: '+150%', label: 'Prenotazioni dirette in media' },
  { icon: Search, value: 'Top 3', label: 'Obiettivo su Google local' },
  { icon: Users, value: '−20%', label: 'Meno commissioni agli intermediari' },
  { icon: Clock, value: '90 giorni', label: 'Per i primi risultati concreti' },
];

const TESTIMONIALS = [
  { name: 'Marco Ferrari', role: 'Titolare, Elite NCC Milano', quote: 'In tre mesi le prenotazioni dal sito sono raddoppiate. Finalmente non dipendo più solo dalle piattaforme che si prendono le commissioni.', avatar: 'MF' },
  { name: 'Giulia Romano', role: 'Fondatrice, Costa Transfer', quote: 'Ora quando cercano "transfer aeroporto" nella nostra zona compariamo noi per primi. Le chiamate dirette sono aumentate tantissimo.', avatar: 'GR' },
  { name: 'Antonio Greco', role: 'Amministratore, Greco Luxury Cars', quote: 'Il nuovo sito è di un\'altra categoria. I clienti ci scrivono dicendo che sembriamo l\'azienda più seria della città. E si vede nei numeri.', avatar: 'AG' },
];

const FAQ = [
  { q: 'In quanto tempo vedrò i primi risultati?', a: 'Con Google Ads le prime richieste possono arrivare già nelle prime settimane. La SEO e l\'autorità del dominio crescono nel tempo: i risultati più solidi si vedono tipicamente entro 90 giorni. Per questo il contratto minimo è di 3 mesi.' },
  { q: 'Perché un contratto minimo di 3 mesi?', a: 'Perché il marketing serio non è magia istantanea. Tre mesi sono il tempo minimo per posizionarsi su Google, ottimizzare le campagne e costruire un flusso di prenotazioni stabile e misurabile.' },
  { q: 'Il budget pubblicitario di Google Ads è incluso nei 900€?', a: 'I 900€/mese coprono la gestione professionale di tutti i servizi. Il budget speso direttamente su Google Ads è a parte e lo decidi tu in base ai tuoi obiettivi — ti consigliamo l\'importo ideale per la tua zona.' },
  { q: 'Devo per forza rifare il sito?', a: 'Se il tuo sito è moderno, veloce e con prenotazione online, possiamo lavorarci sopra. Nella maggior parte dei casi, però, un sito che converte è la base che moltiplica i risultati di tutto il resto.' },
  { q: 'Lavorate anche fuori dalla mia città?', a: 'Sì. Lavoriamo con aziende di transfer e NCC in tutta Italia. La strategia SEO e Google Ads viene sempre costruita sulla tua zona e sulle tratte che copri.' },
  { q: 'Cosa succede dopo i primi 3 mesi?', a: 'Se sei soddisfatto — e lo sarai vedendo i dati — si continua mese per mese, senza vincoli lunghi. L\'obiettivo è farti crescere così tanto da non voler più smettere.' },
];

/* ═══════════════════════════════════════════════════════════════════════ */

export default function TransferLandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', website: '', message: '' });
  const [formSent, setFormSent] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<Pkg | null>(null);

  const scrollToPackages = () => document.getElementById('prezzi')?.scrollIntoView({ behavior: 'smooth' });
  const scrollToContact = (pkg?: Pkg) => { if (pkg) setSelectedPackage(pkg); document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormError(''); setSubmitting(true);
    try {
      const res = await fetch('/api/landing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          packageId: selectedPackage?.id || '',
          packageName: selectedPackage ? selectedPackage.title : '',
          source: 'Transfer Landing Page',
          category: 'Transfer & NCC',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Qualcosa è andato storto');
      setFormSent(true);
    } catch (err: any) {
      setFormError(err.message || 'Qualcosa è andato storto. Riprova.');
    } finally { setSubmitting(false); }
  };

  const navLinks = [
    { href: '#problema', label: 'Perché' },
    { href: '#metodo', label: 'Il metodo' },
    { href: '#servizi', label: 'Servizi' },
    { href: '#prezzi', label: 'Prezzi' },
    { href: '#faq', label: 'FAQ' },
  ];

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans overflow-x-hidden">
      {/* ═══ NAV ═══ */}
      <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center"><Car className="w-4 h-4 text-white" /></div>
            <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">FivoCRM Transfer</span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-gray-600">
            {navLinks.map(l => <a key={l.href} href={l.href} className="hover:text-blue-600 transition-colors">{l.label}</a>)}
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="hidden sm:inline-flex text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors">Accedi</Link>
            <button onClick={() => scrollToContact()} className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 hover:shadow-lg hover:shadow-blue-500/25 transition-all hover:-translate-y-0.5">Consulenza Gratuita</button>
            <LandingMobileMenu
              links={navLinks}
              ctaLabel="Consulenza Gratuita"
              onCta={() => scrollToContact()}
              accentClass="bg-gradient-to-r from-blue-600 to-cyan-500"
            />
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-50/70 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-blue-200/30 rounded-full blur-3xl" />
        <div className="absolute top-40 right-0 w-[400px] h-[400px] bg-cyan-200/20 rounded-full blur-3xl" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 border border-blue-100 mb-8">
                <Plane className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-medium text-blue-700">Marketing per aziende di Transfer & NCC</span>
                <div className="flex">{[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}</div>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                Più prenotazioni dirette per il tuo{' '}
                <span className="bg-gradient-to-r from-blue-600 via-cyan-500 to-sky-400 bg-clip-text text-transparent">servizio transfer</span>.
              </h1>
            </FadeIn>
            <FadeIn delay={200}>
              <p className="mt-8 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
                Ti rendiamo il primo risultato su Google, con un sito che converte e campagne che portano clienti reali.{' '}
                <strong className="text-blue-600">Meno commissioni agli intermediari, più profitto per te.</strong>
              </p>
            </FadeIn>
            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button onClick={scrollToPackages} className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 hover:shadow-xl hover:shadow-blue-500/25 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">Vedi i prezzi<ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></button>
                <button onClick={() => scrollToContact()} className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border-2 border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all flex items-center justify-center gap-2"><Phone className="w-5 h-5" />Consulenza Gratuita</button>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-400">
                <span className="flex items-center gap-1.5"><Search className="w-4 h-4 text-blue-500" /> Primi su Google</span>
                <span className="flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-cyan-500" /> Prenotazioni in crescita</span>
                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-500" /> Meno dipendenza dagli intermediari</span>
              </div>
            </FadeIn>
          </div>

          {/* Statistiche */}
          <FadeIn delay={500}>
            <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
              {STATS.map((s, i) => (
                <div key={i} className="flex flex-col items-center gap-2 p-5 rounded-2xl border border-gray-100 bg-white/70 shadow-sm text-center">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center"><s.icon className="w-5 h-5 text-blue-600" /></div>
                  <span className="text-2xl font-bold text-gray-900">{s.value}</span>
                  <span className="text-xs font-medium text-gray-500 leading-tight">{s.label}</span>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══ PROBLEMA ═══ */}
      <section id="problema" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-3">Il problema</p><h2 className="text-3xl sm:text-4xl font-bold">Lavori tanto, ma le prenotazioni finiscono altrove</h2><p className="mt-4 text-gray-600 max-w-2xl mx-auto">La maggior parte delle aziende di transfer perde clienti ogni giorno — non per il servizio, ma perché online è invisibile.</p></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {PROBLEMS.map((p, i) => (
              <FadeIn key={i} delay={i * 150}><div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 hover:shadow-lg hover:border-red-100 transition-all h-full"><div className="w-14 h-14 rounded-xl bg-red-50 flex items-center justify-center mb-6"><p.icon className="w-7 h-7 text-red-500" /></div><h3 className="text-xl font-bold mb-3">{p.title}</h3><p className="text-gray-600 leading-relaxed">{p.desc}</p></div></FadeIn>
            ))}
          </div>
          <FadeIn delay={300}>
            <div className="mt-12 max-w-3xl mx-auto text-center p-6 rounded-2xl bg-blue-600 text-white">
              <p className="text-lg font-semibold">La buona notizia? Ognuno di questi problemi ha una soluzione precisa. 👇</p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══ IL METODO ═══ */}
      <section id="metodo" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-3">Il nostro metodo</p><h2 className="text-3xl sm:text-4xl font-bold">Un sistema in 4 fasi per farti crescere</h2><p className="mt-4 text-gray-600 max-w-2xl mx-auto">Non azioni sparse, ma un percorso chiaro: dalla credibilità alla crescita delle prenotazioni.</p></div></FadeIn>
          <div className="grid md:grid-cols-4 gap-6 relative">
            <div className="hidden md:block absolute top-16 left-[12%] right-[12%] h-px bg-gradient-to-r from-blue-500/50 via-cyan-500/50 to-blue-500/50" />
            {METHOD.map((s, i) => (
              <FadeIn key={i} delay={i * 150}><div className="relative text-center p-6 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg hover:border-blue-200 transition-all group"><div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center mx-auto mb-4 text-lg font-bold text-white relative z-10">{i + 1}</div><s.icon className="w-6 h-6 text-blue-600 mx-auto mb-3 group-hover:scale-110 transition-transform" /><h3 className="text-lg font-bold mb-2">{s.title}</h3><p className="text-gray-500 text-sm leading-relaxed">{s.desc}</p></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SERVIZI IN DETTAGLIO ═══ */}
      <section id="servizi" className="py-24 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-3">Cosa facciamo per te</p><h2 className="text-3xl sm:text-4xl font-bold">Ogni servizio, spiegato nel dettaglio</h2><p className="mt-4 text-gray-600 max-w-2xl mx-auto">Tutto ciò di cui la tua azienda di transfer ha bisogno per dominare online — in un unico partner.</p></div></FadeIn>
          <div className="grid md:grid-cols-2 gap-6">
            {SERVICES.map((svc, i) => (
              <FadeIn key={i} delay={(i % 2) * 120}>
                <div className={`rounded-2xl bg-gradient-to-b ${svc.bg} to-white border-2 p-7 h-full flex flex-col shadow-sm hover:shadow-lg transition-all`}>
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-white shadow-sm flex items-center justify-center flex-shrink-0"><svc.icon className={`w-6 h-6 ${svc.color}`} /></div>
                    <div>
                      <span className={`text-[11px] font-bold uppercase tracking-wider ${svc.color}`}>{svc.tag}</span>
                      <h3 className="text-xl font-bold leading-tight">{svc.title}</h3>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-gray-600 font-medium italic">{svc.tagline}</p>
                  <ul className="mt-5 space-y-2.5 flex-1">
                    {svc.points.map((pt, pi) => (
                      <li key={pi} className="flex items-start gap-2.5 text-sm text-gray-700"><CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${svc.color}`} />{pt}</li>
                    ))}
                  </ul>
                  <div className="mt-5 pt-4 border-t border-gray-200/70 flex items-start gap-2">
                    <Target className={`w-4 h-4 mt-0.5 flex-shrink-0 ${svc.color}`} />
                    <p className="text-sm font-semibold text-gray-800">{svc.outcome}</p>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PREZZI ═══ */}
      <section id="prezzi" className="py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-3">Investimento</p><h2 className="text-3xl sm:text-4xl font-bold">Un piano semplice e trasparente</h2><p className="mt-4 text-gray-600 max-w-2xl mx-auto">Una base solida una tantum, più un motore mensile che fa crescere le prenotazioni.</p></div></FadeIn>
          <div className="grid md:grid-cols-2 gap-6 items-start">
            {PACKAGES.map((pkg, i) => {
              const isSelected = selectedPackage?.id === pkg.id;
              return (
                <FadeIn key={pkg.id} delay={i * 120}>
                  <div className={`relative rounded-2xl bg-white border-2 ${pkg.border} transition-all hover:shadow-2xl flex flex-col h-full ${pkg.popular ? `shadow-xl ring-2 ${pkg.ring}/20` : 'shadow-sm'} ${isSelected ? 'ring-2 ring-green-500' : ''}`}>
                    {pkg.badge && (<div className={`absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-gradient-to-r ${pkg.color} text-white text-xs font-bold tracking-wide whitespace-nowrap`}>{pkg.badge}</div>)}
                    <div className="p-8 flex flex-col h-full">
                      <h3 className="text-2xl font-bold">{pkg.title}</h3>
                      <p className="text-sm text-gray-500 mt-2 min-h-[48px]">{pkg.idealFor}</p>
                      <div className="mt-5 flex items-baseline gap-1.5"><span className={`text-5xl font-bold bg-gradient-to-r ${pkg.color} bg-clip-text text-transparent`}>{pkg.price}</span><span className="text-sm text-gray-500">{pkg.priceNote}</span></div>
                      <ul className="mt-6 space-y-2.5 flex-1">
                        {pkg.includes.map((item, ii) => (<li key={ii} className="flex items-start gap-2 text-sm text-gray-700"><CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${pkg.popular ? 'text-cyan-500' : 'text-blue-500'}`} />{item}</li>))}
                      </ul>
                      <div className="mt-6 p-3 rounded-lg bg-blue-50 border border-blue-100">
                        <p className="text-xs text-gray-700 flex items-start gap-1.5"><Sparkles className="w-3.5 h-3.5 text-blue-600 mt-0.5 flex-shrink-0" />{pkg.note}</p>
                      </div>
                      <button onClick={() => scrollToContact(pkg)} className={`mt-6 w-full py-3.5 rounded-xl text-sm font-semibold transition-all hover:-translate-y-0.5 ${pkg.popular ? `bg-gradient-to-r ${pkg.color} text-white hover:shadow-lg hover:shadow-cyan-500/25` : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}>{isSelected ? '✓ Selezionato' : pkg.cta}</button>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>
          <FadeIn delay={300}>
            <div className="mt-10 flex items-center justify-center gap-3 text-center flex-wrap">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-50 border border-amber-200 text-sm font-medium text-amber-800"><Clock className="w-4 h-4" /> Contratto minimo 3 mesi sul pacchetto mensile</span>
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gray-50 border border-gray-200 text-sm font-medium text-gray-600">Il budget pubblicitario di Google Ads è a parte</span>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══ RACCOMANDAZIONE ═══ */}
      <section className="py-16 bg-gradient-to-r from-blue-50 via-cyan-50 to-sky-50 border-y border-blue-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <FadeIn>
            <Rocket className="w-8 h-8 text-blue-600 mx-auto mb-4" />
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">La combinazione che consigliamo</h2>
            <p className="text-gray-700 leading-relaxed">Il risultato migliore arriva unendo <strong className="text-blue-700">il nuovo sito (€1.500 una tantum)</strong> con <strong className="text-blue-700">il pacchetto Crescita & Prenotazioni (€900/mese)</strong>. Il sito converte le visite in prenotazioni, il pacchetto mensile porta quelle visite. Insieme trasformano la tua presenza online in una vera macchina di prenotazioni dirette.</p>
          </FadeIn>
        </div>
      </section>

      {/* ═══ TESTIMONIANZE ═══ */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-3">Dicono di noi</p><h2 className="text-3xl sm:text-4xl font-bold">Aziende di transfer che sono già cresciute</h2></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {TESTIMONIALS.map((t, i) => (
              <FadeIn key={i} delay={i * 150}><div className="p-8 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg transition-all h-full flex flex-col"><div className="flex mb-4">{[1,2,3,4,5].map(j => (<Star key={j} className="w-5 h-5 text-amber-400 fill-amber-400" />))}</div><p className="text-gray-700 leading-relaxed flex-1 italic">"{t.quote}"</p><div className="mt-6 flex items-center gap-3 pt-4 border-t border-gray-100"><div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center text-white font-bold text-sm">{t.avatar}</div><div><p className="font-semibold text-sm">{t.name}</p><p className="text-xs text-gray-500">{t.role}</p></div></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="py-24 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-3">Domande frequenti</p><h2 className="text-3xl sm:text-4xl font-bold">Tutto ciò che vuoi sapere</h2></div></FadeIn>
          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <FadeIn key={i} delay={i * 80}><div className="bg-white rounded-xl border border-gray-100 overflow-hidden"><button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"><span className="font-semibold text-gray-900 pr-4">{item.q}</span><ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} /></button><div className={`transition-all duration-300 overflow-hidden ${openFaq === i ? 'max-h-72 opacity-100' : 'max-h-0 opacity-0'}`}><p className="px-6 pb-5 text-gray-600 leading-relaxed">{item.a}</p></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ CONTATTO ═══ */}
      <section id="contact" className="py-24 bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white relative overflow-hidden">
        <div className="absolute inset-0"><div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-3xl" /><div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-cyan-500/10 rounded-full blur-3xl" /></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-cyan-400 mb-4">Pronto a crescere?</p>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">Trasformiamo il tuo transfer in una <span className="text-cyan-400">macchina di prenotazioni</span></h2>
                <p className="mt-5 text-gray-300 leading-relaxed text-lg">Compila il modulo e ti ricontattiamo per una consulenza gratuita e senza impegno. Analizziamo la tua presenza online e ti diciamo esattamente da dove partire.</p>
                <div className="mt-8 space-y-4">
                  <div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">Consulenza e analisi iniziale gratuite</span></div>
                  <div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">Strategia su misura per la tua zona</span></div>
                  <div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">Risultati concreti entro 90 giorni</span></div>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              {formSent ? (
                <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-10 border border-white/10 text-center"><div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6"><CheckCircle2 className="w-10 h-10 text-green-400" /></div><h3 className="text-2xl font-bold mb-3">Grazie!</h3><p className="text-gray-300">La tua richiesta è stata inviata con successo. Ti contatteremo entro 24 ore.</p></div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">Richiedi la consulenza gratuita</h3>
                  {selectedPackage && (<div className="flex items-center justify-between px-4 py-3 rounded-xl bg-cyan-500/20 border border-cyan-500/30"><div><p className="text-xs text-cyan-300">Pacchetto selezionato</p><p className="font-semibold text-white">{selectedPackage.title} — {selectedPackage.price} {selectedPackage.priceNote}</p></div><button type="button" onClick={() => setSelectedPackage(null)} className="text-cyan-300 hover:text-white text-sm underline">Cambia</button></div>)}
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Nome e cognome *</label><input type="text" required value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500" placeholder="Mario Rossi" /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Email *</label><input type="email" required value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500" placeholder="email@azienda.it" /></div>
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Telefono</label><input type="tel" value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500" placeholder="+39 3XX XXX XXXX" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Azienda / Sito web (se presente)</label><input type="text" value={formData.website} onChange={e => setFormData(p => ({ ...p, website: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500" placeholder="www.tuotransfer.it" /></div>
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Messaggio (opzionale)</label><textarea rows={3} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none" placeholder="Raccontaci brevemente della tua azienda e della zona che copri..." /></div>
                  {formError && (<div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">{formError}</div>)}
                  <button type="submit" disabled={submitting} className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white shadow-lg shadow-blue-500/25 transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60">{submitting ? 'Invio in corso...' : 'Invia la richiesta'}{!submitting && <ArrowUpRight className="w-5 h-5" />}</button>
                  <p className="text-xs text-gray-400 text-center">Inviando accetti la nostra privacy policy. Nessuno spam, promesso.</p>
                </form>
              )}
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="py-10 bg-slate-950 text-gray-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2"><div className="w-6 h-6 rounded bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center"><Car className="w-3 h-3 text-white" /></div><span className="font-semibold text-white text-sm">FivoCRM Transfer</span></div>
          <p className="text-sm">&copy; {new Date().getFullYear()} FivoCRM. Tutti i diritti riservati.</p>
          <div className="flex items-center gap-6 text-sm"><Link to="/login" className="hover:text-white transition-colors">Accedi</Link><a href="#prezzi" className="hover:text-white transition-colors">Prezzi</a><a href="#contact" className="hover:text-white transition-colors">Contatti</a></div>
        </div>
      </footer>
    </div>
  );
}
