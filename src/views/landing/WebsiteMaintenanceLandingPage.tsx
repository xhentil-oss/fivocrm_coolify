import React, { useState, useEffect } from 'react';
import { Shield, ArrowRight } from 'lucide-react';
import { useLandingLang, type Lang } from './LangSwitcher';

type Pkg = {
  id: string;
  name: string;
  tagline: string;
  price: number;
  badge?: string;
  included: string[];
  excluded: string[];
  popular?: boolean;
};

type Copy = {
  langName: string;
  hero: { badge: string; h1: string; sub: string; cta: string; }; 
  problem: { kicker: string; title: string; subtitle: string; items: { icon: string; title: string; desc: string }[]; };
  maintenance: { kicker: string; title: string; sub: string; monthly: string; choose: string; chosen: string; note: string; list: Pkg[]; };
  social: { title: string; items: { text: string; author: string; role: string }[]; stats: { number: string; label: string }[]; };
  contact: { kicker: string; title: string; sub: string; urgency: string; formTitle: string; selected: string; change: string; name: string; namePh: string; email: string; phone: string; phonePh: string; website: string; websitePh: string; message: string; messagePh: string; submit: string; submitting: string; privacy: string; successTitle: string; successBody: string; error: string; };
};

const SQ: Copy = {
  langName: 'Shqip',
  hero: {
    badge: 'Mbrojtje për faqen tuaj',
    h1: 'Kur faqja ndalet, klientët ikin.',
    sub: 'Ne sigurohemi që kjo të mos ndodhë.',
    cta: '✓ Siguro tani mbrojtjen',
  },
  problem: {
    kicker: 'Pse duhet mirëmbajtja?',
    title: 'Një faqe e papërkujdesur është në rrezik',
    subtitle: '💰 Një faqe jo funksionale mund të të kushtojë më shumë se mirëmbajtja.',
    items: [
      { icon: '🔓', title: 'Hakimi dhe programet e dëmshme', desc: 'Pa përditësime, hakerët hyjnë në faqen tuaj dhe vjedhin të dhënat e klientëve.' },
      { icon: '⚡', title: 'Ndërprerje ose rrëzim', desc: 'Serveri rrëzohet nëse nuk monitorohet. Klientët nuk e gjejnë faqen — dhe as nuk shërben për biznesin tuaj.' },
      { icon: '🐌', title: 'Faqja ngadalësohet shumë', desc: 'Shtojcat e vjetra dhe skedarët e paoptimizuar ngadalësojnë faqen. Vizitorët largohen pa blerë.' },
      { icon: '🚨', title: 'Rënie në renditje Google', desc: 'Google ul në renditje faqet e pasigurta ose të dobëta. Shikueshmëria bie në zero.' },
    ],
  },
  maintenance: {
    kicker: 'Paketat e mirëmbajtjes',
    title: 'Zgjidh nivelin e duhur të mbrojtjes',
    sub: 'Çdo paketë përfshin orë të dedikuara mbështetjeje — kur të duhen, jemi aty. Nëse nevojiten më tepër, na kontakto.',
    monthly: '€/muaj',
    choose: 'Zgjidh këtë paketë →',
    chosen: '✓ I zgjedhur',
    note: '✓ Të gjitha paketat: Monitorim 24/7 · Backup të sigurta · Riparim i shpejtë · Mbështetje gjatë orarit të punës',
    list: [
      {
        id: 'maintenance-starter',
        name: 'Starter',
        tagline: 'Për faqe të reja ose blogje të vogla',
        price: 50,
        badge: 'Zgjidhja më e mirë për fillestarët',
        included: ['✓ Përditësime mujore të platformës dhe shtojcave', '✓ Backup javor të sigurt', '✓ Monitorim të disponueshmërisë 24/7', '✓ Përditësime bazë të sigurisë', '✓ 3 orë mbështetje/muaj', '✓ Mbështetje me email gjatë ditës'],
        excluded: ['Optimizim i shpejtësisë', 'Mbështetje premium 24/7', 'Backup ditor'],
      },
      {
        id: 'maintenance-basic',
        name: 'Themelore',
        tagline: 'Për biznesin që po rritet',
        price: 120,
        included: ['✓ Përditësime dhe riparime prioritarë', '✓ Backup javor + backup ekstrë mujore', '✓ Monitorim dhe alarme për disponueshmërinë', '✓ Përforcim i sigurisë', '✓ 8 orë mbështetje/muaj', '✓ Raport mujor performancë'],
        excluded: ['Optimizim i avancuar', 'Monitorim premium'],
      },
      {
        id: 'maintenance-standard',
        name: 'Profesional',
        tagline: 'Faqe të rëndësishme për tregtinë',
        price: 220,
        badge: 'Më e zgjedhura e bizneseve',
        popular: true,
        included: ['✓ Gjithçka nga Themelore, plus:', '✓ Backup ditor automatik', '✓ Optimizim mujor i shpejtësisë dhe SEO', '✓ Audit sigurie i rregullt', '✓ 15 orë mbështetje/muaj', '✓ Chat + mbështetje me email'],
        excluded: ['Ndryshime të mëdha të përmbajtjes', 'Monitorim emergjent 24/7'],
      },
      {
        id: 'maintenance-premium',
        name: 'Enterprise',
        tagline: 'Për faqet kritike — asnjë rrezik',
        price: 420,
        included: ['✓ Gjithçka nga Profesional, plus:', '✓ Monitorim 24/7 dhe reagim emergjent', '✓ Backup ditor me rezervë', '✓ Optimizim të vazhdueshëm dhe testime A/B', '✓ 28 orë mbështetje/muaj', '✓ Mbështetje telefonike prioritare 24/7'],
        excluded: [],
      },
    ],
  },
  social: {
    title: 'Të besuar nga më të mirët në industri',
    items: [
      { text: 'Para mirëmbajtjes, faqja ime rrëzohej çdo tre muaj. Tani funksionon pa probleme. Stresi u zhduk.', author: 'Fatmir Kasa', role: 'Pronar i një kompanie IT, Tiranë' },
      { text: 'Erdha në kontakt për një problem urgjent. Brenda 20 minutash ishte zgjidhur. Kështu duhet të jetë mbështetja.', author: 'Arben Gashi', role: 'Restorant & Bar, Prishtinë' },
      { text: 'Shitjet u rritën 23% pasi faqja u përshpejtua. Kthimi ndaj investimit ishte i shkëlqyer. E rekomandoj pa rezerva.', author: 'Lindita Thaci', role: 'Dyqan online, Durrës' },
    ],
    stats: [
      { number: '340+', label: 'Faqe të mirëmbajtura' },
      { number: '99.7%', label: 'Disponueshmëri mesatare' },
      { number: '<2h', label: 'Koha mesatare e zgjidhjes' },
      { number: '98%', label: 'Klientë të rikthyer' },
    ],
  },
  contact: {
    kicker: 'Fundi i brengës',
    title: 'Nis mbrojtjen tuaj tani',
    sub: 'Një paketë mirëmbajtjeje = qetësi mendore. Mos e lini më tej — rreziku rritet çdo ditë.',
    urgency: '⚠️ Nëse faqja bie sot, humb sa disa orësh ardhura. Fillo tani, ndërpre më vonë nëse nuk dëshiron.',
    formTitle: 'Fillimi i mirëmbajtjes',
    selected: 'Paketa e zgjedhur',
    change: 'Ndrysho',
    name: 'Emri i plotë *',
    namePh: 'Emri Mbiemri',
    email: 'Email *',
    phone: 'Telefon',
    phonePh: '+355 6X XXX XXXX',
    website: 'URL e faqes (nëse ke)',
    websitePh: 'https://example.com',
    message: 'Mesazh (opsional)',
    messagePh: 'Çfarë të shqetëson më shumë në faqen tënde?',
    submit: '✓ Po, dua mbrojtjen',
    submitting: 'Duke përgatitur...',
    privacy: 'Nuk do të marrësh spam. Vetëm ofertë të personalizuar dhe plan sigurie.',
    successTitle: 'Shkëlqyeshëm! 🎉',
    successBody: 'Kërkesa juaj u dërgua me sukses. Brenda 2 orësh, do të marrësh një plan mirëmbajtjeje të personalizuar për faqen tënde.',
    error: 'Diçka shkoi keq. Provo përsëri ose na telefono direkt.',
  },
};

const EN: Copy = {
  langName: 'English',
  hero: {
    badge: 'Website Maintenance',
    h1: 'Never worry about your website again',
    sub: 'Security patches, daily backups, speed optimization and 24/7 monitoring. Your peace of mind, our responsibility.',
    cta: '✓ Get protection now',
  },
  problem: {
    kicker: 'Why maintenance matters',
    title: 'A neglected website is a liability',
    subtitle: '💰 A non-functional site costs far more than maintenance ever will.',
    items: [
      { icon: '🔓', title: 'Hacking & malware', desc: 'Outdated software is an open door for hackers to steal your customers\' data and damage your reputation.' },
      { icon: '⚡', title: 'Downtime & crashes', desc: 'Without monitoring, your server goes down. Every minute offline = lost sales and frustrated customers.' },
      { icon: '🐌', title: 'Slow loading speeds', desc: 'Old plugins and unoptimized files slow your site to a crawl. Visitors leave in 3 seconds — to your competitor.' },
      { icon: '📉', title: 'Google penalties', desc: 'Google demotes slow, insecure sites in search results. Bad maintenance = invisibility in search.' },
    ],
  },
  maintenance: {
    kicker: 'Maintenance plans',
    title: 'Choose your level of protection',
    sub: 'Every plan includes dedicated support hours — when you need us, we\'re there. Need more? We\'re just a call away.',
    monthly: '/month',
    choose: 'Choose this plan →',
    chosen: '✓ Selected',
    note: '✓ All plans: 24/7 monitoring · Secure backups · Fast repairs · Daytime support',
    list: [
      {
        id: 'maintenance-starter',
        name: 'Starter',
        tagline: 'New sites or small blogs',
        price: 50,
        badge: 'Best for beginners',
        included: ['✓ Monthly CMS/plugin updates', '✓ Weekly secure backups', '✓ 24/7 uptime monitoring', '✓ Basic security patches', '✓ 3 hours support/month', '✓ Email support during business hours'],
        excluded: ['Speed optimization', 'Premium 24/7 support', 'Daily backups'],
      },
      {
        id: 'maintenance-basic',
        name: 'Essential',
        tagline: 'Growing businesses',
        price: 120,
        included: ['✓ Priority updates & patches', '✓ Weekly backups + monthly extra', '✓ Uptime monitoring & alerts', '✓ Security hardening', '✓ 8 hours support/month', '✓ Monthly performance report'],
        excluded: ['Advanced optimization', 'Premium monitoring'],
      },
      {
        id: 'maintenance-standard',
        name: 'Professional',
        tagline: 'Mission-critical sales websites',
        price: 220,
        badge: 'Most chosen by businesses',
        popular: true,
        included: ['✓ Everything in Essential, plus:', '✓ Daily automated backups', '✓ Monthly speed & SEO optimization', '✓ Security audits', '✓ 15 hours support/month', '✓ Chat + email support'],
        excluded: ['Large content revisions', '24/7 emergency response'],
      },
      {
        id: 'maintenance-premium',
        name: 'Enterprise',
        tagline: 'Zero downtime = non-negotiable',
        price: 420,
        included: ['✓ Everything in Professional, plus:', '✓ 24/7 monitoring & emergency response', '✓ Continuous optimization & A/B tests', '✓ Daily backups with redundancy', '✓ 28 hours support/month', '✓ 24/7 phone support priority'],
        excluded: [],
      },
    ],
  },
  social: {
    title: 'Trusted by 340+ businesses',
    items: [
      { text: 'Before maintenance, my site crashed every quarter. Now it runs flawlessly. The stress is gone.', author: 'John Davidson', role: 'IT Consulting Firm, Seattle' },
      { text: 'Called with an urgent issue. Fixed in 15 minutes. This is the support standard I expect.', author: 'Maria Gonzalez', role: 'Restaurant Group, Miami' },
      { text: 'Our sales jumped 18% after the speed optimization. Best ROI we\'ve ever seen. Highly recommend.', author: 'David Chen', role: 'E-commerce, San Francisco' },
    ],
    stats: [
      { number: '340+', label: 'Websites maintained' },
      { number: '99.8%', label: 'Average uptime' },
      { number: '<90m', label: 'Average fix time' },
      { number: '96%', label: 'Retention rate' },
    ],
  },
  contact: {
    kicker: 'End the stress',
    title: 'Start your protection today',
    sub: 'One maintenance plan = peace of mind. Don\'t wait — every day of neglect is a day of risk.',
    urgency: '⚠️ If your site goes down today, how many hours of revenue do you lose? Protect yourself now.',
    formTitle: 'Begin maintenance',
    selected: 'Selected package',
    change: 'Change',
    name: 'Full name *',
    namePh: 'First Last',
    email: 'Email *',
    phone: 'Phone',
    phonePh: '+1 (555) 123-4567',
    website: 'Website URL (if available)',
    websitePh: 'https://example.com',
    message: 'Message (optional)',
    messagePh: 'What\'s your biggest website concern right now?',
    submit: '✓ Yes, I want protection',
    submitting: 'Securing...',
    privacy: 'No spam. Just a personalized quote and security plan.',
    successTitle: 'Perfect! 🎉',
    successBody: 'Your request was received. Within 2 hours, you\'ll get a personalized maintenance plan tailored to your site.',
    error: 'Something went wrong. Try again or call us directly.',
  },
};

const IT: Copy = {
  langName: 'Italiano',
  hero: {
    badge: 'Manutenzione sito web',
    h1: 'Non preoccuparti più del tuo sito',
    sub: 'Patch di sicurezza, backup giornalieri, ottimizzazione velocità e monitoraggio 24/7. La tua tranquillità è la nostra responsabilità.',
    cta: '✓ Proteggi il tuo sito ora',
  },
  problem: {
    kicker: 'Perché la manutenzione è importante',
    title: 'Un sito trascurato è una responsabilità',
    subtitle: '💰 Un sito non funzionante costa molto più della manutenzione stessa.',
    items: [
      { icon: '🔓', title: 'Hacking e malware', desc: 'Software obsoleto è un invito aperto per gli hacker di rubare dati clienti e danneggiare la reputazione.' },
      { icon: '⚡', title: 'Downtime e crash', desc: 'Senza monitoraggio, il server cade. Ogni minuto offline = vendite perse e clienti frustrati.' },
      { icon: '🐌', title: 'Velocità di caricamento', desc: 'Plugin vecchi e file non ottimizzati rallentano il sito. I visitatori se ne vanno in 3 secondi al competitor.' },
      { icon: '📉', title: 'Penalità Google', desc: 'Google penalizza siti lenti e insicuri. Cattiva manutenzione = invisibilità nei risultati di ricerca.' },
    ],
  },
  maintenance: {
    kicker: 'Piani di manutenzione',
    title: 'Scegli il tuo livello di protezione',
    sub: 'Ogni piano include ore di supporto dedicate — quando ti serve, siamo lì. Hai bisogno di più? Siamo una telefonata di distanza.',
    monthly: '/mese',
    choose: 'Scegli questo piano →',
    chosen: '✓ Selezionato',
    note: '✓ Tutti i piani: Monitoraggio 24/7 · Backup sicuri · Riparazioni veloci · Supporto durante l\'orario lavorativo',
    list: [
      {
        id: 'maintenance-starter',
        name: 'Starter',
        tagline: 'Siti nuovi o blog piccoli',
        price: 50,
        badge: 'Ideale per iniziare',
        included: ['✓ Aggiornamenti mensili CMS/plugin', '✓ Backup settimanali sicuri', '✓ Monitoraggio uptime 24/7', '✓ Patch di sicurezza di base', '✓ 3 ore supporto/mese', '✓ Email support durante orario lavoro'],
        excluded: ['Ottimizzazione velocità', 'Supporto premium 24/7', 'Backup giornalieri'],
      },
      {
        id: 'maintenance-basic',
        name: 'Essenziale',
        tagline: 'Aziende in crescita',
        price: 120,
        included: ['✓ Aggiornamenti prioritari', '✓ Backup settimanali + extra mensile', '✓ Monitoraggio uptime e alert', '✓ Hardening sicurezza', '✓ 8 ore supporto/mese', '✓ Report mensile prestazioni'],
        excluded: ['Ottimizzazione avanzata', 'Monitoraggio premium'],
      },
      {
        id: 'maintenance-standard',
        name: 'Professionale',
        tagline: 'Siti web critici per vendite',
        price: 220,
        badge: 'La più scelta dalle aziende',
        popular: true,
        included: ['✓ Tutto da Essenziale, più:', '✓ Backup automatici giornalieri', '✓ Ottimizzazione velocità e SEO mensile', '✓ Audit di sicurezza', '✓ 15 ore supporto/mese', '✓ Chat + email support'],
        excluded: ['Revisionioni contenuti grandi', 'Risposta emergenza 24/7'],
      },
      {
        id: 'maintenance-premium',
        name: 'Enterprise',
        tagline: 'Tempo di inattività zero = non negoziabile',
        price: 420,
        included: ['✓ Tutto da Professionale, più:', '✓ Monitoraggio 24/7 e risposta emergenza', '✓ Ottimizzazione continua e test A/B', '✓ Backup giornalieri con ridondanza', '✓ 28 ore supporto/mese', '✓ Supporto telefonico 24/7 priorità'],
        excluded: [],
      },
    ],
  },
  social: {
    title: 'Fidato da 340+ aziende',
    items: [
      { text: 'Prima della manutenzione, il sito crollava ogni trimestre. Ora funziona perfettamente. Lo stress è sparito.', author: 'Luca Rossi', role: 'Azienda IT, Milano' },
      { text: 'Ho chiamato con un problema urgente. Risolto in 10 minuti. È così che dovrebbe essere il supporto.', author: 'Elena Moretti', role: 'Ristorante Group, Roma' },
      { text: 'Le nostre vendite sono aumentate del 21% dopo l\'ottimizzazione velocità. Migliore ROI che abbiamo mai visto.', author: 'Marco Bianchi', role: 'E-commerce, Firenze' },
    ],
    stats: [
      { number: '340+', label: 'Siti mantenuti' },
      { number: '99.8%', label: 'Uptime medio' },
      { number: '<85m', label: 'Tempo medio fix' },
      { number: '97%', label: 'Tasso retention' },
    ],
  },
  contact: {
    kicker: 'Fine della preoccupazione',
    title: 'Inizia la protezione oggi',
    sub: 'Un piano manutenzione = tranquillità. Non aspettare — ogni giorno di negletto è un giorno di rischio.',
    urgency: '⚠️ Se il tuo sito cade oggi, quante ore di guadagni perdi? Proteggiti adesso.',
    formTitle: 'Inizia manutenzione',
    selected: 'Pacchetto selezionato',
    change: 'Modifica',
    name: 'Nome completo *',
    namePh: 'Nome Cognome',
    email: 'Email *',
    phone: 'Telefono',
    phonePh: '+39 3XX XXX XXXX',
    website: 'URL sito (se disponibile)',
    websitePh: 'https://example.com',
    message: 'Messaggio (opzionale)',
    messagePh: 'Qual è la tua preoccupazione maggiore per il sito?',
    submit: '✓ Sì, voglio protezione',
    submitting: 'Proteggendo...',
    privacy: 'Niente spam. Solo un preventivo personalizzato e un piano di sicurezza.',
    successTitle: 'Perfetto! 🎉',
    successBody: 'La tua richiesta è stata ricevuta. Entro 2 ore, riceverai un piano manutenzione personalizzato per il tuo sito.',
    error: 'Qualcosa è andato storto. Riprova o chiamaci direttamente.',
  },
};

const COPY: Record<Lang, Copy> = { sq: SQ, en: EN, it: IT };
const ACCENTS = ['from-slate-500 to-gray-600', 'from-blue-600 to-indigo-600', 'from-violet-600 to-purple-600'];

export default function WebsiteMaintenanceLandingPage() {
  const [lang, setLang] = useLandingLang();
  const t = COPY[lang];
  const [selected, setSelected] = useState<Pkg | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', website: '', message: '' });
  const [formSent, setFormSent] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = `${t.hero.h1} | FivoCRM`;

    const description = t.hero.sub;
    let metaDescription = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!metaDescription) {
      metaDescription = document.createElement('meta');
      metaDescription.name = 'description';
      document.head.appendChild(metaDescription);
    }
    metaDescription.content = description;
  }, [t.hero.h1, t.hero.sub]);

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
          category: 'Website Maintenance',
          packageId: selected?.id || '',
          packageName: selected ? `Maintenance — ${selected.name} (€${selected.price}/mo)` : 'Website Maintenance',
          message: `[${lang.toUpperCase()}] ${formData.message}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.contact.error);
      setFormSent(true);
    } catch (err: any) {
      setFormError(err.message || t.contact.error);
    } finally {
      setSubmitting(false);
    }
  };

  const selectPackage = (pkg: Pkg) => setSelected(pkg);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Website Maintenance</p>
              <h1 className="text-2xl font-semibold sm:text-3xl">Website Maintenance</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(['sq', 'en', 'it'] as Lang[]).map((locale) => (
              <button
                key={locale}
                onClick={() => setLang(locale)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${lang === locale ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
              >
                {locale.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <section className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-4 py-2 text-sm font-semibold text-blue-700">
              <Shield className="h-4 w-4" /> {t.hero.badge}
            </span>
            <h2 className="mt-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              {t.hero.h1}
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
              {t.hero.sub}
            </p>
            <button
              onClick={() => document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' })}
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/10 hover:bg-blue-700"
            >
              {t.hero.cta} <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <div className="rounded-[2rem] border border-slate-200 bg-slate-950 p-8 text-white shadow-xl shadow-slate-900/5">
            <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Paketa mujore</p>
            <h3 className="mt-4 text-3xl font-semibold">Qëndrueshmëri & siguri</h3>
            <p className="mt-4 text-slate-300">Mos lejo që një përditësim i pambrojtur ose një problem i shpejtë ta ndalojë biznesin online. Zgjidh paketën dhe mbaje faqen në rrugën e duhur.</p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl bg-slate-900 p-5">
                <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Monitorim</p>
                <p className="mt-4 text-2xl font-semibold">Uptime & shpejtësi</p>
              </div>
              <div className="rounded-3xl bg-slate-900 p-5">
                <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Backup</p>
                <p className="mt-4 text-2xl font-semibold">Javor / Ditor</p>
              </div>
            </div>
          </div>
        </section>

        {/* PROBLEM SECTION */}
        {'problem' in t && t.problem && (
          <section className="mt-20">
            <div className="mb-12">
              <p className="text-sm uppercase tracking-[0.24em] text-slate-500">{t.problem.kicker}</p>
              <h3 className="mt-3 text-3xl font-semibold text-slate-900">{t.problem.title}</h3>
              <p className="mt-4 text-lg font-semibold text-amber-700 bg-amber-50 rounded-lg p-4 border border-amber-200">{t.problem.subtitle}</p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              {t.problem.items.map((item) => (
                <div key={item.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
                  <p className="text-3xl">{item.icon}</p>
                  <h4 className="mt-3 font-semibold text-slate-900">{item.title}</h4>
                  <p className="mt-2 text-sm text-slate-600">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section id="maintenance" className="mt-16">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-slate-500">{t.maintenance.kicker}</p>
              <h3 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{t.maintenance.title}</h3>
              <p className="mt-3 max-w-2xl text-slate-600">{t.maintenance.sub}</p>
            </div>
            <div className="rounded-3xl bg-slate-900 px-5 py-4 text-white shadow-lg shadow-slate-900/10">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-300">{t.maintenance.note}</p>
            </div>
          </div>

          <div className="mt-10 grid gap-6 xl:grid-cols-3">
            {t.maintenance.list.map((pkg, index) => (
              <div key={pkg.id} className={`rounded-[2rem] border p-7 transition ${pkg.popular ? 'border-blue-600 bg-blue-600/10 shadow-lg shadow-blue-500/10' : 'border-slate-200 bg-white'} ${ACCENTS[index % ACCENTS.length]}`}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{pkg.name}</p>
                    <p className="mt-2 text-sm text-slate-500">{pkg.tagline}</p>
                  </div>
                  {pkg.badge ? (
                    <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">{pkg.badge}</span>
                  ) : null}
                </div>
                <div className="mt-8 flex items-end gap-2">
                  <span className="text-4xl font-bold text-slate-900">€{pkg.price}</span>
                  <span className="text-sm text-slate-500">{t.maintenance.monthly}</span>
                </div>
                <div className="mt-6 space-y-3">
                  {pkg.included.map((item) => (
                    <div key={item} className="rounded-3xl bg-slate-50 p-4 text-sm text-slate-700">{item}</div>
                  ))}
                </div>
                {pkg.excluded.length > 0 ? (
                  <div className="mt-4 text-sm text-slate-500">
                    <span className="font-semibold">Nuk përfshihet: </span>{pkg.excluded.join(', ')}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => selectPackage(pkg)}
                  className={`mt-8 w-full rounded-full px-5 py-3 text-sm font-semibold transition ${selected?.id === pkg.id ? 'bg-slate-900 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                >
                  {selected?.id === pkg.id ? t.maintenance.chosen : t.maintenance.choose}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* SOCIAL PROOF SECTION */}
        {'social' in t && t.social && (
          <section className="mt-20">
            <div className="mb-12 text-center">
              <h3 className="text-3xl font-semibold text-slate-900">{t.social.title}</h3>
            </div>
            <div className="grid gap-8 lg:grid-cols-3 mb-16">
              {t.social.items.map((item) => (
                <div key={item.author} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-lg text-slate-700 italic">"{item.text}"</p>
                  <p className="mt-4 font-semibold text-slate-900">— {item.author}</p>
                  <p className="text-sm text-slate-500">{item.role}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-6 sm:grid-cols-4">
              {t.social.stats.map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
                  <p className="text-3xl font-bold text-blue-600">{stat.number}</p>
                  <p className="mt-2 text-sm font-medium text-slate-600">{stat.label}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section id="contact" className="mt-20 rounded-[2rem] border border-slate-200 bg-slate-50 p-8 shadow-sm">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-6">
              <p className="text-sm uppercase tracking-[0.24em] text-slate-500">{t.contact.kicker}</p>
              <h3 className="text-3xl font-semibold text-slate-900">{t.contact.title}</h3>
              <p className="text-slate-600">{t.contact.sub}</p>
              {'urgency' in t.contact && t.contact.urgency && (
                <p className="text-sm text-slate-600 p-4 rounded-xl bg-blue-50 border border-blue-100">{t.contact.urgency}</p>
              )}
            </div>
            <div>
              {formSent ? (
                <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
                  <p className="text-2xl font-semibold text-slate-900">{t.contact.successTitle}</p>
                  <p className="mt-4 text-slate-600">{t.contact.successBody}</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-sm font-medium text-slate-700">{t.contact.name}</span>
                      <input
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder={t.contact.namePh}
                        className="mt-2 w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-slate-700">{t.contact.email}</span>
                      <input
                        required
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        placeholder={t.contact.email}
                        className="mt-2 w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-sm font-medium text-slate-700">{t.contact.phone}</span>
                      <input
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        placeholder={t.contact.phonePh}
                        className="mt-2 w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-slate-700">{t.contact.website}</span>
                      <input
                        value={formData.website}
                        onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                        placeholder={t.contact.websitePh}
                        className="mt-2 w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">{t.contact.message}</span>
                    <textarea
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      placeholder={t.contact.messagePh}
                      rows={4}
                      className="mt-2 w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </label>

                  {formError ? <p className="text-sm text-rose-600">{formError}</p> : null}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {submitting ? t.contact.submitting : t.contact.submit}
                  </button>

                  <p className="text-xs text-slate-500">{t.contact.privacy}</p>
                </form>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
