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
  maintenance: { kicker: string; title: string; sub: string; monthly: string; choose: string; chosen: string; note: string; list: Pkg[]; };
  contact: { kicker: string; title: string; sub: string; formTitle: string; selected: string; change: string; name: string; namePh: string; email: string; phone: string; phonePh: string; website: string; websitePh: string; message: string; messagePh: string; submit: string; submitting: string; privacy: string; successTitle: string; successBody: string; error: string; };
};

const SQ: Copy = {
  langName: 'Shqip',
  hero: {
    badge: 'Mirëmbajtje website-i',
    h1: 'Përfundo me shpejtësi dhe siguri',
    sub: 'Përditësime, backup, monitorim dhe mbështetje mujore për faqen tënde.',
    cta: 'Kërko Ofertë',
  },
  maintenance: {
    kicker: 'Mirëmbajtje',
    title: 'Paketat mujore për website-in tuaj',
    sub: 'Zgjidh nivelin e duhur të mbështetjes dhe siguro një faqe të shpejtë, të sigurt dhe të azhurnuar.',
    monthly: '€/muaj',
    choose: 'Zgjidh këtë paketë',
    chosen: '✓ Zgjedhur',
    note: 'Të gjitha paketat përfshijnë monitorim, backup dhe riparime të shpejta.',
    list: [
      {
        id: 'maintenance-basic',
        name: 'Basic',
        tagline: 'Mbështetje themelore dhe siguri bazike',
        price: 120,
        included: ['Përditësime mujore CMS/plugin', 'Backup javor', 'Monitorim uptime', 'Patch sigurie bazik', '1 orë ndryshime të vogla', 'Raport mujor performancë'],
        excluded: ['Përditësime ditore', 'Optimizim performancë', 'Mbështetje urgjente 24/7'],
      },
      {
        id: 'maintenance-standard',
        name: 'Standard',
        tagline: 'Optimizim dhe shërbim proaktiv',
        price: 220,
        badge: 'Më e zgjedhura',
        popular: true,
        included: ['Gjithçka nga Basic, plus:', 'Backup ditor', 'Monitorim performancë dhe siguri', '3 orë ndryshime të vogla', 'Raport mujor SEO', 'Përditësime prioritare'],
        excluded: ['Redaktime të mëdha të përmbajtjes', 'Optimizim i avancuar i konvertimit'],
      },
      {
        id: 'maintenance-premium',
        name: 'Premium',
        tagline: 'Mbështetje 24/7 dhe përmirësim i vazhdueshëm',
        price: 420,
        included: ['Gjithçka nga Standard, plus:', 'Monitorim 24/7 dhe reagim emergjent', 'Optimizim performance & siguri', 'Strategji mujore', 'Ndryshime të vogla të pakufizuara', 'Audit teknik çdo muaj'],
        excluded: [],
      },
    ],
  },
  contact: {
    kicker: 'Gati për të filluar?',
    title: 'Merr ofertën tënde të mirëmbajtjes',
    sub: 'Plotëso formularin dhe ne do të kthehemi me një propozim të personalizuar brenda 24 orëve.',
    formTitle: 'Kontakto për mirëmbajtje',
    selected: 'Paketa e zgjedhur',
    change: 'Ndrysho',
    name: 'Emri i plotë *',
    namePh: 'Emri Mbiemri',
    email: 'Email *',
    phone: 'Telefon',
    phonePh: '+355 6X XXX XXXX',
    website: 'Faqja aktuale (nëse ke)',
    websitePh: 'https://example.com',
    message: 'Mesazh (opsional)',
    messagePh: 'Na trego pak për nevojat e mirëmbajtjes...',
    submit: 'Dërgo Kërkesën',
    submitting: 'Duke dërguar...',
    privacy: 'Duke dërguar pranoni politikën e privatësisë. Nuk do të merrni spam.',
    successTitle: 'Faleminderit!',
    successBody: 'Kërkesa juaj u dërgua. Do të kontaktojmë brenda 24 orëve.',
    error: 'Diçka shkoi keq. Provoni përsëri.',
  },
};

const EN: Copy = {
  langName: 'English',
  hero: {
    badge: 'Website Maintenance',
    h1: 'Keep your website safe and fast',
    sub: 'Updates, backups, monitoring and monthly support after launch.',
    cta: 'Request Quote',
  },
  maintenance: {
    kicker: 'Maintenance',
    title: 'Monthly website maintenance plans',
    sub: 'Pick the right level of support and keep your website secure, fast and updated.',
    monthly: '/month',
    choose: 'Choose this plan',
    chosen: '✓ Selected',
    note: 'All plans include monitoring, backups and fast fix support.',
    list: [
      {
        id: 'maintenance-basic',
        name: 'Basic',
        tagline: 'Essential care and baseline security',
        price: 120,
        included: ['Monthly CMS/plugin updates', 'Weekly backups', 'Uptime monitoring', 'Basic security patching', '1 hour small edits', 'Monthly health report'],
        excluded: ['Daily updates', 'Performance tuning', '24/7 emergency support'],
      },
      {
        id: 'maintenance-standard',
        name: 'Standard',
        tagline: 'Proactive upkeep and performance care',
        price: 220,
        badge: 'Most popular',
        popular: true,
        included: ['Everything in Basic, plus:', 'Daily backups', 'Performance and security monitoring', '3 hours small edits', 'Monthly SEO report', 'Priority updates'],
        excluded: ['Large content revisions', 'Advanced conversion optimization'],
      },
      {
        id: 'maintenance-premium',
        name: 'Premium',
        tagline: '24/7 care and continuous improvement',
        price: 420,
        included: ['Everything in Standard, plus:', '24/7 monitoring and emergency response', 'Performance & security tuning', 'Monthly strategy session', 'Unlimited small edits', 'Technical audit every month'],
        excluded: [],
      },
    ],
  },
  contact: {
    kicker: 'Ready to start?',
    title: 'Get your maintenance quote',
    sub: 'Fill in the form and we will come back with a tailored proposal within 24 hours.',
    formTitle: 'Contact for maintenance',
    selected: 'Selected package',
    change: 'Change',
    name: 'Full name *',
    namePh: 'First Last',
    email: 'Email *',
    phone: 'Phone',
    phonePh: '+39 3XX XXX XXXX',
    website: 'Current website (if any)',
    websitePh: 'https://example.com',
    message: 'Message (optional)',
    messagePh: 'Tell us a bit about your maintenance needs...',
    submit: 'Send Request',
    submitting: 'Sending...',
    privacy: 'By submitting you accept the privacy policy. No spam.',
    successTitle: 'Thank you!',
    successBody: 'Your request was sent. We will contact you within 24 hours.',
    error: 'Something went wrong. Please try again.',
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

        <section id="contact" className="mt-16 rounded-[2rem] border border-slate-200 bg-slate-50 p-8 shadow-sm">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-6">
              <p className="text-sm uppercase tracking-[0.24em] text-slate-500">{t.contact.kicker}</p>
              <h3 className="text-3xl font-semibold text-slate-900">{t.contact.title}</h3>
              <p className="text-slate-600">{t.contact.sub}</p>
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
