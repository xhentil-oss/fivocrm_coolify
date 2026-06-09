import React, { useState } from 'react';
import { Shield, ArrowRight } from 'lucide-react';

type Lang = 'sq' | 'en' | 'it';

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
  problem: { kicker: string; title: string; items: { icon: string; title: string; desc: string }[]; };
  maintenance: { kicker: string; title: string; sub: string; monthly: string; choose: string; chosen: string; note: string; list: Pkg[]; };
  social: { title: string; items: { text: string; author: string; role: string }[]; stats: { number: string; label: string }[]; };
  contact: { kicker: string; title: string; sub: string; urgency: string; formTitle: string; selected: string; change: string; name: string; namePh: string; email: string; phone: string; phonePh: string; website: string; websitePh: string; message: string; messagePh: string; submit: string; submitting: string; privacy: string; successTitle: string; successBody: string; error: string; };
};

const SQ: Copy = {
  langName: 'Shqip',
  hero: {
    badge: 'Mbrojte per faqen tuaj',
    h1: 'Mos e lejo faqen tuaj te shembet',
    sub: 'Çdo ditë pa mirëmbajtje është rrezik. Hackerë, viruse, ndërprerje — të gjitha këto ndodhin në heshtje. Ne kujdesemi ndërsa ti shpenzon kohë me biznesin tuaj.',
    cta: '✓ Merr mbrojtjen përnjëmend',
  },
  problem: {
    kicker: 'Pse duhet mirëmbajtje?',
    title: 'Një faqe e pa-mirëmbajtur është një faqe në rrezik',
    items: [
      { icon: '🔓', title: 'Hakimi & malware', desc: 'Pa përditësime, hackerët hyjnë në faqen tuaj dhe vjedhin të dhënat e klientëve.' },
      { icon: '⚡', title: 'Ndërprerje ose prishje', desc: 'Serveri bie në qoftë se nuk monitorohet. Klientët nuk të gjejnë dot faqen — dhe as arsimet.' },
      { icon: '🐌', title: 'Faqja bëhet shumë e ngadaltë', desc: 'Plugin-et e vjeter dhe fajllat jo të optimizuara e bëjnë faqen të ngadalshme. Vizitorët largohen përpara të blidhesh.' },
      { icon: '🚨', title: 'Zbritje në Google', desc: 'Google e zbret faqet e pasigurta ose të brishta në kërkime. Vizibilitet = 0.' },
    ],
  },
  maintenance: {
    kicker: 'Paketat e mirëmbajtjes',
    title: 'Zgjidh nivel i duhur i mbrojtjes',
    sub: 'Çdo paket përfshin orë të dedikuara për suporte direkte — kur i duhen, ti je në qendër. Nëse nevojitet më shumë, thjesht na kontakto.',
    monthly: '€/muaj',
    choose: 'Zgjidh këtë paketë →',
    chosen: '✓ I zgjedhur',
    note: '✓ Të gjitha paketat: Monitorim 24/7 · Backup i sigurt · Riparim i shpejtë · Support gjatë ditës së punës',
    list: [
      {
        id: 'maintenance-starter',
        name: 'Starter',
        tagline: 'Për faqe të reja ose blogje të vogla',
        price: 50,
        badge: 'Zgjidhe më e mirë për fillimet',
        included: ['✓ Përditësime mujore plugin & CMS', '✓ Backup javor i sigurt', '✓ Monitorim uptime 24/7', '✓ Patch siguri bazik', '✓ 3 orë suporte/muaj', '✓ Email support gjatë ditës'],
        excluded: ['Optimizim speed', 'Monitorim 24/7 premium', 'Backup ditor'],
      },
      {
        id: 'maintenance-basic',
        name: 'Essential',
        tagline: 'Për biznesin qe po rritet',
        price: 120,
        included: ['✓ Përditësime tëpara të mundshme', '✓ Backup javor + shtesë mujore', '✓ Monitorim & alarm uptime', '✓ Patch & hardening sigurie', '✓ 8 orë suporte/muaj', '✓ Raport mujor performancë'],
        excluded: ['Optimizim i avancuar', 'Monitorim premium'],
      },
      {
        id: 'maintenance-standard',
        name: 'Profesional',
        tagline: 'Faqe të rëndësishme për shitjen',
        price: 220,
        badge: 'Më e zgjedhura e bizneset',
        popular: true,
        included: ['✓ Gjithçka nga Essential, plus:', '✓ Backup ditor automatik', '✓ Optimizim speed & SEO mujor', '✓ Security audit tëpara të mundshme', '✓ 15 orë suporte/muaj', '✓ Chat + email support'],
        excluded: ['Ndryshime të mëdha përmbajtjeje', 'Monitorim 24/7 emergjent'],
      },
      {
        id: 'maintenance-premium',
        name: 'Enterprise',
        tagline: 'Për faqe kritike — asnjë rrezik',
        price: 420,
        included: ['✓ Gjithçka nga Profesional, plus:', '✓ Monitorim 24/7 & reagim emergjent', '✓ Backup ditor me gjendje të dytë', '✓ Optimizim kontinual & A/B tests', '✓ 28 orë suporte/muaj', '✓ Phone support 24/7 prioritet'],
        excluded: [],
      },
    ],
  },
  social: {
    title: 'Ndjekin më të mirët në industri',
    items: [
      { text: 'Përpara mirëmbajtjes, faqja imi ra çdo tre muaj. Tani funksionon pa probleme. Zhurma u zhduk.', author: 'Fatmir Kasa', role: 'Pronarë kompanie IT, Tiranë' },
      { text: 'Thirra në qoftë se diçka u prishte. Në 20 minuta, të gjitha ishin gati. Kështu duhet të jetë supporti.', author: 'Arben Gashi', role: 'Restorant & Bar, Prishtinë' },
      { text: 'Na u rrit shitja 23% pasi faqja bëhet më e shpejtë. Vlera më e mirë për parat. Përkundrazi rekomandoj.', author: 'Lindita Thaci', role: 'E-commerce Store, Durrës' },
    ],
    stats: [
      { number: '340+', label: 'Website-e të mirëmbajturat' },
      { number: '99.7%', label: 'Uptime mesatar' },
      { number: '<2h', label: 'Koha mesatare e zgjidhjes' },
      { number: '98%', label: 'Klientë të kthyer' },
    ],
  },
  contact: {
    kicker: 'Fundi i brengës',
    title: 'Filloje proteksionin tuaj tani',
    sub: 'Një paket mirëmbajtjeje = pez e mendje. Mos prij më shumë — rreziku rritet çdo ditë.',
    urgency: '⚠️ Nëse faqja bie sot, humb sa disa orësh ardhura. Filloje tani, ndërpre më vonë nëse nuk të pëlqen.',
    formTitle: 'Filluesi i mirëmbajtjes',
    selected: 'Paketa e zgjedhur',
    change: 'Ndrysho',
    name: 'Emri i plotë *',
    namePh: 'Emri Mbiemri',
    email: 'Email *',
    phone: 'Telefon',
    phonePh: '+355 6X XXX XXXX',
    website: 'URL i faqes (nëse ke)',
    websitePh: 'https://example.com',
    message: 'Mesazh (opsional)',
    messagePh: 'Çfarë të shqetëson më shumë në faqen tuaj?',
    submit: '✓ Po, dua mbrojtjen',
    submitting: 'Duke siguruar...',
    privacy: 'Nuk do të pësosh spam. Thjesht kontakt për ofertën tuaj të personalizuar.',
    successTitle: 'Ureje! 🎉',
    successBody: 'Kërkesa juaj u dërgua. Në 2 orësh, do të merrni një ofertë të personalizuar me një strategji të plotë mbrojtjeje.',
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
    badge: 'Manutenzione sito',
    h1: 'Mantieni il tuo sito veloce e sicuro',
    sub: 'Aggiornamenti, backup, monitoraggio e supporto mensile dopo il lancio.',
    cta: 'Richiedi Preventivo',
  },
  maintenance: {
    kicker: 'Manutenzione',
    title: 'Piani mensili di manutenzione sul sito',
    sub: 'Scegli il livello di supporto giusto e mantieni il sito sicuro, veloce e aggiornato.',
    monthly: '/mese',
    choose: 'Scegli questo piano',
    chosen: '✓ Selezionato',
    note: 'Tutti i piani includono monitoraggio, backup e interventi rapidi.',
    list: [
      {
        id: 'maintenance-basic',
        name: 'Base',
        tagline: 'Cura essenziale e sicurezza di base',
        price: 120,
        included: ['Aggiornamenti mensili CMS/plugin', 'Backup settimanali', 'Monitoraggio uptime', 'Patch di sicurezza di base', '1 ora modifiche minori', 'Report mensile sullo stato'],
        excluded: ['Aggiornamenti giornalieri', 'Ottimizzazione delle prestazioni', 'Supporto emergenza 24/7'],
      },
      {
        id: 'maintenance-standard',
        name: 'Standard',
        tagline: 'Manutenzione proattiva e cura delle prestazioni',
        price: 220,
        badge: 'Più scelto',
        popular: true,
        included: ['Tutto del Base, più:', 'Backup giornalieri', 'Monitoraggio prestazioni e sicurezza', '3 ore modifiche minori', 'Report mensile SEO', 'Aggiornamenti prioritari'],
        excluded: ['Revisioni contenuti importanti', 'Ottimizzazione avanzata delle conversioni'],
      },
      {
        id: 'maintenance-premium',
        name: 'Premium',
        tagline: 'Assistenza 24/7 e miglioramento continuo',
        price: 420,
        included: ['Tutto dello Standard, più:', 'Monitoraggio 24/7 e risposta emergenza', 'Ottimizzazione performances & sicurezza', 'Sessione strategica mensile', 'Modifiche minori illimitate', 'Audit tecnico ogni mese'],
        excluded: [],
      },
    ],
  },
  contact: {
    kicker: 'Pronto a iniziare?',
    title: 'Richiedi il tuo preventivo di manutenzione',
    sub: 'Compila il modulo e ti risponderemo con una proposta personalizzata entro 24 ore.',
    formTitle: 'Contatto per manutenzione',
    selected: 'Pacchetto selezionato',
    change: 'Modifica',
    name: 'Nome completo *',
    namePh: 'Nome Cognome',
    email: 'Email *',
    phone: 'Telefono',
    phonePh: '+39 3XX XXX XXXX',
    website: 'Sito attuale (se presente)',
    websitePh: 'https://example.com',
    message: 'Messaggio (opzionale)',
    messagePh: 'Dicci qualcosa sulle tue esigenze di manutenzione...',
    submit: 'Invia Richiesta',
    submitting: 'Invio in corso...',
    privacy: 'Inviando accetti l’informativa sulla privacy. Niente spam.',
    successTitle: 'Grazie!',
    successBody: 'La tua richiesta è stata inviata. Ti contatteremo entro 24 ore.',
    error: 'Qualcosa è andato storto. Riprova.',
  },
};

const COPY: Record<Lang, Copy> = { sq: SQ, en: EN, it: IT };
const ACCENTS = ['from-slate-500 to-gray-600', 'from-blue-600 to-indigo-600', 'from-violet-600 to-purple-600'];

export default function WebsiteMaintenanceLandingPage() {
  const [lang, setLang] = useState<Lang>('sq');
  const t = COPY[lang];
  const [selected, setSelected] = useState<Pkg | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', website: '', message: '' });
  const [formSent, setFormSent] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
