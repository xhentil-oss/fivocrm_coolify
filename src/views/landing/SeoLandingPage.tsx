import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, TrendingUp, Shield, Zap, CheckCircle2, ArrowRight,
  Star, Users, Target, Clock, Award, ChevronDown, Phone,
  ArrowUpRight, Sparkles, Eye, MousePointer, LineChart, Lock,
} from 'lucide-react';
import { LangSwitcher, useLandingLang, type Lang } from './LangSwitcher';
import LandingMobileMenu from './LandingMobileMenu';
import { currencySymbol } from '../../lib/utils';

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

interface SeoPackage { id: string; title: string; description: string; price: number; currency: string; }

const CARD_STYLES = [
  { color: 'from-blue-500 to-cyan-500', border: 'border-blue-200 hover:border-blue-400', popular: false },
  { color: 'from-purple-600 to-indigo-600', border: 'border-purple-300 hover:border-purple-500', popular: true },
  { color: 'from-amber-500 to-orange-600', border: 'border-amber-200 hover:border-amber-400', popular: false },
];
const RESULT_ICONS = [TrendingUp, Award, Target, Users];
const PAIN_ICONS = [Eye, MousePointer, Clock];
const PROCESS_ICONS = [Search, Target, Zap, LineChart];

interface Copy {
  nav: { results: string; process: string; packages: string; testimonials: string; login: string; cta: string };
  hero: { badge: string; h1a: string; h1b: string; h1c: string; h1d: string; sub1: string; sub2: string; sub3: string; ctaPrimary: string; ctaSecondary: string; t1: string; t2: string; t3: string };
  pains: { kicker: string; title1: string; title2: string; items: { title: string; desc: string }[]; bridge1: string; bridge2: string };
  results: { kicker: string; title: string; items: { metric: string; suffix: string; label: string }[] };
  process: { kicker: string; title: string; sub: string; steps: { title: string; desc: string }[] };
  packages: { kicker: string; title: string; sub: string; perMonth: string; chosen: string; note: string; cta: string[]; badge: (string | null)[]; fallback: SeoPackage[]; features: string[][] };
  testimonials: { kicker: string; title: string; items: { name: string; role: string; quote: string; avatar: string }[] };
  faq: { kicker: string; title: string; items: { q: string; a: string }[] };
  contact: { kicker: string; title1: string; title2: string; sub: string; perks: string[]; urgency: string; formTitle: string; selected: string; change: string; name: string; namePh: string; email: string; phone: string; phonePh: string; site: string; sitePh: string; message: string; messagePh: string; submit: string; submitting: string; privacy: string; successTitle: string; successBody: string; error: string };
  footer: { rights: string; pricing: string; contact: string };
}

const SQ: Copy = {
  nav: { results: 'Rezultatet', process: 'Procesi', packages: 'Paketat', testimonials: 'Dëshmitë', login: 'Hyr', cta: 'Fillo Tani' },
  hero: { badge: '150+ biznese na besojnë', h1a: 'Konkurrentët tuaj janë në', h1b: 'Faqen 1', h1c: 'të Google.', h1d: 'Ti ku je?',
    sub1: 'Çdo ditë, mijëra klientë potencialë kërkojnë shërbime si të tuat në Google.', sub2: 'Pa SEO profesionale, ata po shkojnë tek konkurrentët tuaj.', sub3: 'Ne e ndryshojmë këtë.',
    ctaPrimary: 'Shiko Paketat SEO', ctaSecondary: 'Konsultim Falas', t1: 'Pa kontratë afatgjatë', t2: 'Privatësi e garantuar', t3: 'Rezultate brenda 90 ditëve' },
  pains: { kicker: 'A e njeh këtë situatë?', title1: 'Biznesi yt po humb para', title2: 'çdo ditë pa SEO',
    items: [
      { title: 'Faqja jote është e padukshme', desc: 'Klientët tuaj po kërkojnë çdo ditë shërbimet që ti ofron — por po i gjejnë tek konkurrentët.' },
      { title: 'Trafikun e paguan shumë shtrenjtë', desc: 'Reklamat me pagesë po bëhen gjithnjë e më të shtrenjta. SEO organik sjell klientë çdo ditë, pa pushim.' },
      { title: 'Po humbet kohë me taktika jo-efektive', desc: 'Pa një strategji profesionale SEO, çdo përpjekje tjetër marketingu prodhon rezultate minimale.' },
    ], bridge1: 'Lajmi i mirë?', bridge2: 'Ka një zgjidhje të provuar.' },
  results: { kicker: 'Rezultate të vërteta', title: 'Numrat flasin më shumë se fjalët',
    items: [{ metric: '347', suffix: '%', label: 'Rritje mesatare e trafikut organik' }, { metric: '89', suffix: '%', label: 'Klientë që arrijnë Faqen 1 të Google' }, { metric: '2.4', suffix: 'x', label: 'Rritje e konvertimeve' }, { metric: '150', suffix: '+', label: 'Biznese të kënaqura' }] },
  process: { kicker: 'Si funksionon', title: '4 hapa drejt Faqes 1 të Google', sub: 'Metodologji e provuar që ka funksionuar për 150+ biznese',
    steps: [
      { title: 'Audit & Analizë', desc: 'Analizojmë faqen, konkurrentët, dhe fjalët kyçe me ROI më të lartë.' },
      { title: 'Strategji e Personalizuar', desc: 'Ndërtojmë hartën e rrugës SEO të përshtatur për biznesin tuaj.' },
      { title: 'Implementim', desc: 'Ekipi ynë zbaton optimizimet teknike, përmbajtjen, dhe linkbuilding.' },
      { title: 'Monitorim & Rritje', desc: 'Ndjekim rezultatet çdo javë dhe përshtatim strategjinë për rritje.' },
    ] },
  packages: { kicker: 'Paketat SEO', title: 'Zgjidh paketin që i përshtatet biznesit tënd', sub: 'Çdo paketë përmban strategji të personalizuar. Pa kontrata afatgjata — anulo kur të duash.', perMonth: '/muaj', chosen: '✓ Zgjedhur', note: 'Çmimet janë në Lekë shqiptare (ALL). TVSH nuk përfshihet. Faturim mujor.',
    cta: ['Fillo Tani', 'Zgjidh Këtë Paket', 'Kontakto për Detaje'], badge: [null, 'Më i Popullarizuari', 'ROI Maksimal'],
    fallback: [
      { id: 'starter', title: 'SEO Starter', description: 'Për biznese të reja që duan praninë online', price: 29900, currency: 'ALL' },
      { id: 'professional', title: 'SEO Professional', description: 'Për biznese që duan rritje të qëndrueshme', price: 59900, currency: 'ALL' },
      { id: 'enterprise', title: 'SEO Enterprise', description: 'Dominim total i tregut dixhital', price: 119900, currency: 'ALL' },
    ],
    features: [
      ['Audit teknik i faqes', 'Kërkimi i fjalëve kyçe (deri 20)', 'Optimizim On-Page bazë', 'Google Business Profile', 'Raport mujor i performancës', '1 artikull blog / muaj'],
      ['Gjithçka nga Starter +', 'Kërkimi i fjalëve kyçe (deri 50)', 'Optimizim On-Page i avancuar', 'Strategji linkbuilding', 'Optimizim i shpejtësisë (Core Web Vitals)', '4 artikuj blog / muaj', 'Raport javor me analiza', 'Menaxhim i Google Ads bazë'],
      ['Gjithçka nga Professional +', 'Fjalë kyçe të pakufizuara', 'SEO teknik i thelluar', 'Content marketing strategjik', 'Linkbuilding premium (DR 50+)', '8+ artikuj / muaj', 'Menaxher i dedikuar llogarie', 'Analiza konkurrentësh mujore', 'A/B testing & CRO bazë', 'Raporte live dashboard'],
    ] },
  testimonials: { kicker: 'Dëshmi klientësh', title: 'Çfarë thonë klientët tanë',
    items: [{ name: 'Arben Krasniqi', role: 'CEO, TechHub Albania', quote: 'Brenda 4 muajve kaluan nga faqja 5 e Google në pozitën #2. Trafiku u rrit 420% dhe kemi klientë të rinj çdo javë.', avatar: 'AK' }, { name: 'Elena Hoxha', role: 'Drejtoreshë, Boutique Elegance', quote: 'Investimi më i mirë që kemi bërë. SEO-ja solli 68% të klientëve tanë online pa shpenzuar asnjë lek reklamë.', avatar: 'EH' }, { name: 'Dritan Muça', role: 'Themelues, Digital Solutions', quote: 'Profesionalizëm i jashtëzakonshëm. Raportet javore na mbajnë të informuar dhe rezultatet flasin vetë.', avatar: 'DM' }] },
  faq: { kicker: 'FAQ', title: 'Pyetjet më të shpeshta',
    items: [
      { q: 'Sa kohë duhet për të parë rezultate?', a: 'SEO organike kërkon zakonisht 3-6 muaj për rezultate të qenësishme. Përmirësimet teknike mund të ndikojnë brenda javëve të para. Japim raporte javore për ta ndjekur progresin.' },
      { q: 'A garantoni pozitën #1 në Google?', a: 'Askush nuk mund ta garantojë, sepse algoritmi i Google ndryshon vazhdimisht. Garantojmë metodologji të provuar, transparencë të plotë dhe punë të palodhur.' },
      { q: 'A mund ta ndryshoj paketin gjatë rrugës?', a: 'Absolutisht. Mund të bëni upgrade ose downgrade kur të doni. Përshtatemi me nevojat e biznesit tuaj.' },
      { q: 'Çfarë ndodh nëse ndaloj SEO-në?', a: 'Renditja organike nuk zhduket menjëherë — bie ngadalë nëse konkurrentët vazhdojnë të investojnë. Rekomandojmë një investim minimal vazhdues.' },
      { q: 'A punoni me biznese jashtë Shqipërisë?', a: 'Po! Kemi eksperiencë me SEO lokale dhe ndërkombëtare. Na kontaktoni për nevojat tuaja specifike.' },
    ] },
  contact: { kicker: 'Gati për të filluar?', title1: 'Mos lejo konkurrentët të marrin klientët tuaj', title2: 'edhe një ditë tjetër', sub: 'Plotëso formularin dhe merr një konsultim falas 30-minutësh me ekspertët tanë SEO. Do analizojmë faqen tënde dhe do tregojmë mundësitë konkrete për rritje.',
    perks: ['Audit SEO falas me vlerë 15,000 ALL', 'Analizë e detajuar e konkurrentëve', 'Rekomandime konkrete veprimi pa detyrim'], urgency: 'Pranojmë vetëm 5 klientë të rinj çdo muaj për cilësi maksimale.',
    formTitle: 'Merr konsultimin falas', selected: 'Paketa e zgjedhur', change: 'Ndrysho', name: 'Emri i plotë *', namePh: 'Emri Mbiemri', email: 'Email *', phone: 'Telefon', phonePh: '+355 6X XXX XXXX', site: 'Faqja web (nëse keni)', sitePh: 'https://example.com', message: 'Mesazh (opsional)', messagePh: 'Na tregoni pak për biznesin tuaj...', submit: 'Dërgo Kërkesën', submitting: 'Duke dërguar...', privacy: 'Duke dërguar pranoni politikën e privatësisë. Nuk do merrni spam.', successTitle: 'Faleminderit!', successBody: 'Kërkesa jote u dërgua me sukses. Do t\'ju kontaktojmë brenda 24 orëve.', error: 'Diçka shkoi keq. Provoni përsëri.' },
  footer: { rights: 'Të gjitha të drejtat e rezervuara.', pricing: 'Çmimet', contact: 'Kontakt' },
};

const EN: Copy = {
  nav: { results: 'Results', process: 'Process', packages: 'Packages', testimonials: 'Testimonials', login: 'Login', cta: 'Get Started' },
  hero: { badge: '150+ businesses trust us', h1a: 'Your competitors are on', h1b: 'Page 1', h1c: 'of Google.', h1d: 'Where are you?',
    sub1: 'Every day, thousands of potential clients search for services like yours on Google.', sub2: 'Without professional SEO, they\'re going to your competitors.', sub3: 'We change that.',
    ctaPrimary: 'See SEO Packages', ctaSecondary: 'Free Consultation', t1: 'No long-term contract', t2: 'Privacy guaranteed', t3: 'Results within 90 days' },
  pains: { kicker: 'Sound familiar?', title1: 'Your business is losing money', title2: 'every day without SEO',
    items: [
      { title: 'Your site is invisible', desc: 'Your clients search for the services you offer every day — but they\'re finding your competitors.' },
      { title: 'You pay too much for traffic', desc: 'Paid ads keep getting more expensive. Organic SEO brings clients every day, non-stop.' },
      { title: 'You\'re wasting time on ineffective tactics', desc: 'Without a professional SEO strategy, every other marketing effort produces minimal results.' },
    ], bridge1: 'The good news?', bridge2: 'There\'s a proven solution.' },
  results: { kicker: 'Real results', title: 'Numbers speak louder than words',
    items: [{ metric: '347', suffix: '%', label: 'Average organic traffic growth' }, { metric: '89', suffix: '%', label: 'Clients reaching Google Page 1' }, { metric: '2.4', suffix: 'x', label: 'Conversion growth' }, { metric: '150', suffix: '+', label: 'Happy businesses' }] },
  process: { kicker: 'How it works', title: '4 steps to Google Page 1', sub: 'A proven methodology that has worked for 150+ businesses',
    steps: [
      { title: 'Audit & Analysis', desc: 'We analyze the site, competitors and the highest-ROI keywords.' },
      { title: 'Custom Strategy', desc: 'We build an SEO roadmap tailored to your business.' },
      { title: 'Implementation', desc: 'Our team applies technical optimizations, content and link building.' },
      { title: 'Monitoring & Growth', desc: 'We track results weekly and adapt the strategy for growth.' },
    ] },
  packages: { kicker: 'SEO Packages', title: 'Choose the plan that fits your business', sub: 'Every package includes a custom strategy. No long-term contracts — cancel anytime.', perMonth: '/month', chosen: '✓ Selected', note: 'Prices in Albanian Lek (ALL). VAT not included. Monthly billing.',
    cta: ['Get Started', 'Choose This Plan', 'Contact for Details'], badge: [null, 'Most Popular', 'Max ROI'],
    fallback: [
      { id: 'starter', title: 'SEO Starter', description: 'For new businesses wanting an online presence', price: 29900, currency: 'ALL' },
      { id: 'professional', title: 'SEO Professional', description: 'For businesses wanting steady growth', price: 59900, currency: 'ALL' },
      { id: 'enterprise', title: 'SEO Enterprise', description: 'Total dominance of the digital market', price: 119900, currency: 'ALL' },
    ],
    features: [
      ['Technical site audit', 'Keyword research (up to 20)', 'Basic on-page optimization', 'Google Business Profile', 'Monthly performance report', '1 blog article / month'],
      ['Everything in Starter +', 'Keyword research (up to 50)', 'Advanced on-page optimization', 'Link-building strategy', 'Speed optimization (Core Web Vitals)', '4 blog articles / month', 'Weekly report with analytics', 'Basic Google Ads management'],
      ['Everything in Professional +', 'Unlimited keywords', 'Deep technical SEO', 'Strategic content marketing', 'Premium link building (DR 50+)', '8+ articles / month', 'Dedicated account manager', 'Monthly competitor analysis', 'Basic A/B testing & CRO', 'Live dashboard reports'],
    ] },
  testimonials: { kicker: 'Client testimonials', title: 'What our clients say',
    items: [{ name: 'Arben Krasniqi', role: 'CEO, TechHub Albania', quote: 'Within 4 months they went from Google page 5 to position #2. Traffic grew 420% and we get new clients every week.', avatar: 'AK' }, { name: 'Elena Hoxha', role: 'Director, Boutique Elegance', quote: 'The best investment we\'ve made. SEO brought 68% of our clients online without spending a cent on ads.', avatar: 'EH' }, { name: 'Dritan Muça', role: 'Founder, Digital Solutions', quote: 'Exceptional professionalism. The weekly reports keep us informed and the results speak for themselves.', avatar: 'DM' }] },
  faq: { kicker: 'FAQ', title: 'Frequently asked questions',
    items: [
      { q: 'How long until I see results?', a: 'Organic SEO usually takes 3–6 months for substantial results. Technical improvements can show within the first weeks. We provide weekly reports to track progress.' },
      { q: 'Do you guarantee #1 on Google?', a: 'No one can guarantee it because Google\'s algorithm constantly changes. We guarantee a proven methodology, full transparency and relentless work.' },
      { q: 'Can I change the plan along the way?', a: 'Absolutely. You can upgrade or downgrade anytime. We adapt to your business needs.' },
      { q: 'What happens if I stop SEO?', a: 'Organic rankings don\'t vanish immediately — they slowly drop if competitors keep investing. We recommend a minimum ongoing investment.' },
      { q: 'Do you work with businesses outside Albania?', a: 'Yes! We have experience with local and international SEO. Contact us for your specific needs.' },
    ] },
  contact: { kicker: 'Ready to start?', title1: 'Don\'t let competitors take your clients', title2: 'one more day', sub: 'Fill in the form and get a free 30-minute consultation with our SEO experts. We\'ll analyze your site and show concrete growth opportunities.',
    perks: ['Free SEO audit worth 15,000 ALL', 'Detailed competitor analysis', 'Concrete action recommendations, no obligation'], urgency: 'We only take 5 new clients each month for maximum quality.',
    formTitle: 'Get your free consultation', selected: 'Selected package', change: 'Change', name: 'Full name *', namePh: 'First Last', email: 'Email *', phone: 'Phone', phonePh: '+39 3XX XXX XXXX', site: 'Website (if any)', sitePh: 'https://example.com', message: 'Message (optional)', messagePh: 'Tell us a bit about your business...', submit: 'Send Request', submitting: 'Sending...', privacy: 'By submitting you accept the privacy policy. No spam.', successTitle: 'Thank you!', successBody: 'Your request was sent. We\'ll contact you within 24 hours.', error: 'Something went wrong. Please try again.' },
  footer: { rights: 'All rights reserved.', pricing: 'Pricing', contact: 'Contact' },
};

const IT: Copy = {
  nav: { results: 'Risultati', process: 'Processo', packages: 'Pacchetti', testimonials: 'Testimonianze', login: 'Accedi', cta: 'Inizia Ora' },
  hero: { badge: '150+ attività si fidano di noi', h1a: 'I tuoi concorrenti sono in', h1b: 'Prima Pagina', h1c: 'di Google.', h1d: 'Tu dove sei?',
    sub1: 'Ogni giorno migliaia di clienti potenziali cercano servizi come i tuoi su Google.', sub2: 'Senza una SEO professionale, vanno dai tuoi concorrenti.', sub3: 'Noi cambiamo questo.',
    ctaPrimary: 'Vedi i Pacchetti SEO', ctaSecondary: 'Consulenza Gratuita', t1: 'Nessun contratto a lungo termine', t2: 'Privacy garantita', t3: 'Risultati entro 90 giorni' },
  pains: { kicker: 'Ti suona familiare?', title1: 'La tua attività perde denaro', title2: 'ogni giorno senza SEO',
    items: [
      { title: 'Il tuo sito è invisibile', desc: 'I tuoi clienti cercano ogni giorno i servizi che offri — ma trovano i concorrenti.' },
      { title: 'Paghi troppo per il traffico', desc: 'La pubblicità a pagamento diventa sempre più costosa. La SEO organica porta clienti ogni giorno, senza sosta.' },
      { title: 'Perdi tempo con tattiche inefficaci', desc: 'Senza una strategia SEO professionale, ogni altro sforzo di marketing produce risultati minimi.' },
    ], bridge1: 'La buona notizia?', bridge2: 'C\'è una soluzione collaudata.' },
  results: { kicker: 'Risultati reali', title: 'I numeri parlano più delle parole',
    items: [{ metric: '347', suffix: '%', label: 'Crescita media del traffico organico' }, { metric: '89', suffix: '%', label: 'Clienti che raggiungono la Pagina 1 di Google' }, { metric: '2.4', suffix: 'x', label: 'Crescita delle conversioni' }, { metric: '150', suffix: '+', label: 'Attività soddisfatte' }] },
  process: { kicker: 'Come funziona', title: '4 passi verso la Pagina 1 di Google', sub: 'Una metodologia collaudata che ha funzionato per oltre 150 attività',
    steps: [
      { title: 'Audit & Analisi', desc: 'Analizziamo il sito, i concorrenti e le parole chiave con il ROI più alto.' },
      { title: 'Strategia Personalizzata', desc: 'Costruiamo una roadmap SEO su misura per la tua attività.' },
      { title: 'Implementazione', desc: 'Il nostro team applica ottimizzazioni tecniche, contenuti e link building.' },
      { title: 'Monitoraggio & Crescita', desc: 'Monitoriamo i risultati ogni settimana e adattiamo la strategia per crescere.' },
    ] },
  packages: { kicker: 'Pacchetti SEO', title: 'Scegli il piano adatto alla tua attività', sub: 'Ogni pacchetto include una strategia personalizzata. Nessun contratto a lungo termine — disdici quando vuoi.', perMonth: '/mese', chosen: '✓ Selezionato', note: 'Prezzi in Lek albanesi (ALL). IVA esclusa. Fatturazione mensile.',
    cta: ['Inizia Ora', 'Scegli Questo Piano', 'Contatta per Dettagli'], badge: [null, 'Più Popolare', 'ROI Massimo'],
    fallback: [
      { id: 'starter', title: 'SEO Starter', description: 'Per nuove attività che vogliono una presenza online', price: 29900, currency: 'ALL' },
      { id: 'professional', title: 'SEO Professional', description: 'Per attività che vogliono una crescita costante', price: 59900, currency: 'ALL' },
      { id: 'enterprise', title: 'SEO Enterprise', description: 'Dominio totale del mercato digitale', price: 119900, currency: 'ALL' },
    ],
    features: [
      ['Audit tecnico del sito', 'Ricerca parole chiave (fino a 20)', 'Ottimizzazione On-Page base', 'Google Business Profile', 'Report mensile delle performance', '1 articolo blog / mese'],
      ['Tutto dello Starter +', 'Ricerca parole chiave (fino a 50)', 'Ottimizzazione On-Page avanzata', 'Strategia di link building', 'Ottimizzazione velocità (Core Web Vitals)', '4 articoli blog / mese', 'Report settimanale con analisi', 'Gestione base di Google Ads'],
      ['Tutto del Professional +', 'Parole chiave illimitate', 'SEO tecnica approfondita', 'Content marketing strategico', 'Link building premium (DR 50+)', '8+ articoli / mese', 'Account manager dedicato', 'Analisi mensile della concorrenza', 'A/B testing & CRO base', 'Report dashboard live'],
    ] },
  testimonials: { kicker: 'Testimonianze clienti', title: 'Cosa dicono i nostri clienti',
    items: [{ name: 'Arben Krasniqi', role: 'CEO, TechHub Albania', quote: 'In 4 mesi sono passati dalla pagina 5 di Google alla posizione #2. Il traffico è cresciuto del 420% e abbiamo nuovi clienti ogni settimana.', avatar: 'AK' }, { name: 'Elena Hoxha', role: 'Direttrice, Boutique Elegance', quote: 'Il miglior investimento che abbiamo fatto. La SEO ha portato il 68% dei nostri clienti online senza spendere un centesimo in ads.', avatar: 'EH' }, { name: 'Dritan Muça', role: 'Fondatore, Digital Solutions', quote: 'Professionalità eccezionale. I report settimanali ci tengono informati e i risultati parlano da soli.', avatar: 'DM' }] },
  faq: { kicker: 'FAQ', title: 'Domande frequenti',
    items: [
      { q: 'Quanto tempo per vedere risultati?', a: 'La SEO organica richiede di solito 3–6 mesi per risultati sostanziali. I miglioramenti tecnici possono vedersi nelle prime settimane. Forniamo report settimanali.' },
      { q: 'Garantite la posizione #1 su Google?', a: 'Nessuno può garantirla perché l\'algoritmo di Google cambia di continuo. Garantiamo una metodologia collaudata, piena trasparenza e lavoro instancabile.' },
      { q: 'Posso cambiare il pacchetto in corsa?', a: 'Assolutamente. Puoi fare upgrade o downgrade quando vuoi. Ci adattiamo alle tue esigenze.' },
      { q: 'Cosa succede se smetto la SEO?', a: 'Il posizionamento organico non sparisce subito — cala lentamente se i concorrenti continuano a investire. Consigliamo un investimento minimo continuativo.' },
      { q: 'Lavorate con attività fuori dall\'Albania?', a: 'Sì! Abbiamo esperienza con SEO locale e internazionale. Contattaci per le tue esigenze specifiche.' },
    ] },
  contact: { kicker: 'Pronto a iniziare?', title1: 'Non lasciare che i concorrenti prendano i tuoi clienti', title2: 'un altro giorno', sub: 'Compila il modulo e ricevi una consulenza gratuita di 30 minuti con i nostri esperti SEO. Analizzeremo il tuo sito e mostreremo opportunità concrete di crescita.',
    perks: ['Audit SEO gratuito del valore di 15.000 ALL', 'Analisi dettagliata della concorrenza', 'Raccomandazioni concrete senza impegno'], urgency: 'Accettiamo solo 5 nuovi clienti al mese per la massima qualità.',
    formTitle: 'Ricevi la consulenza gratuita', selected: 'Pacchetto selezionato', change: 'Modifica', name: 'Nome completo *', namePh: 'Nome Cognome', email: 'Email *', phone: 'Telefono', phonePh: '+39 3XX XXX XXXX', site: 'Sito web (se presente)', sitePh: 'https://example.com', message: 'Messaggio (opzionale)', messagePh: 'Raccontaci della tua attività...', submit: 'Invia Richiesta', submitting: 'Invio in corso...', privacy: 'Inviando accetti l\'informativa sulla privacy. Niente spam.', successTitle: 'Grazie!', successBody: 'La tua richiesta è stata inviata. Ti contatteremo entro 24 ore.', error: 'Qualcosa è andato storto. Riprova.' },
  footer: { rights: 'Tutti i diritti riservati.', pricing: 'Prezzi', contact: 'Contatti' },
};

const COPY: Record<Lang, Copy> = { sq: SQ, en: EN, it: IT };

export default function SeoLandingPage() {
  const [lang, setLang] = useLandingLang();
  const t = COPY[lang];
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', website: '', message: '' });
  const [formSent, setFormSent] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<SeoPackage | null>(null);
  const [apiPackages, setApiPackages] = useState<SeoPackage[] | null>(null);

  useEffect(() => {
    fetch('/api/landing?category=SEO').then(r => r.json()).then(data => { if (data.services?.length) setApiPackages(data.services); }).catch(() => {});
  }, []);
  const packages = apiPackages ?? t.packages.fallback;

  const scrollToPackages = () => document.getElementById('packages')?.scrollIntoView({ behavior: 'smooth' });
  const scrollToContact = (pkg?: SeoPackage) => { if (pkg) setSelectedPackage(pkg); document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormError(''); setSubmitting(true);
    try {
      const res = await fetch('/api/landing', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, packageId: selectedPackage?.id || '', packageName: selectedPackage?.title || '', category: 'SEO', message: `[${lang.toUpperCase()}] ${formData.message}` }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.contact.error);
      setFormSent(true);
    } catch (err: any) { setFormError(err.message || t.contact.error); } finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans overflow-x-hidden">
      <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center"><Search className="w-4 h-4 text-white" /></div><span className="text-xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">FivoCRM SEO</span></div>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-gray-600">
            <a href="#results" className="hover:text-purple-600 transition-colors">{t.nav.results}</a>
            <a href="#process" className="hover:text-purple-600 transition-colors">{t.nav.process}</a>
            <a href="#packages" className="hover:text-purple-600 transition-colors">{t.nav.packages}</a>
            <a href="#testimonials" className="hover:text-purple-600 transition-colors">{t.nav.testimonials}</a>
          </div>
          <div className="flex items-center gap-3">
            <LangSwitcher lang={lang} setLang={setLang} accentClass="bg-purple-600" />
            <button onClick={() => scrollToContact()} className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:shadow-lg hover:shadow-purple-500/25 transition-all hover:-translate-y-0.5">{t.nav.cta}</button>
            <LandingMobileMenu
              links={[
                { href: '#results', label: t.nav.results },
                { href: '#process', label: t.nav.process },
                { href: '#packages', label: t.nav.packages },
                { href: '#testimonials', label: t.nav.testimonials },
              ]}
              ctaLabel={t.nav.cta}
              onCta={() => scrollToContact()}
              accentClass="bg-gradient-to-r from-purple-600 to-indigo-600"
            />
          </div>
        </div>
      </nav>

      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-purple-50/80 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-purple-200/30 rounded-full blur-3xl" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-50 border border-purple-100 mb-8">
                <div className="flex -space-x-2">{['AK', 'EH', 'DM', 'FL'].map((ini, i) => (<div key={i} className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 border-2 border-white flex items-center justify-center text-[10px] font-bold text-white">{ini}</div>))}</div>
                <span className="text-sm font-medium text-purple-700">{t.hero.badge}</span>
                <div className="flex">{[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}</div>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                {t.hero.h1a}{' '}<span className="bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 bg-clip-text text-transparent">{t.hero.h1b}</span>{' '}{t.hero.h1c}
                <br /><span className="text-gray-400">{t.hero.h1d}</span>
              </h1>
            </FadeIn>
            <FadeIn delay={200}><p className="mt-8 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">{t.hero.sub1} {t.hero.sub2} <strong className="text-purple-600">{t.hero.sub3}</strong></p></FadeIn>
            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button onClick={scrollToPackages} className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:shadow-xl hover:shadow-purple-500/25 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">{t.hero.ctaPrimary}<ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></button>
                <button onClick={() => scrollToContact()} className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border-2 border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-all flex items-center justify-center gap-2"><Phone className="w-5 h-5" />{t.hero.ctaSecondary}</button>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-400">
                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-500" /> {t.hero.t1}</span>
                <span className="flex items-center gap-1.5"><Lock className="w-4 h-4 text-blue-500" /> {t.hero.t2}</span>
                <span className="flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-purple-500" /> {t.hero.t3}</span>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-red-500 mb-3">{t.pains.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.pains.title1} <span className="text-red-500">{t.pains.title2}</span></h2></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {t.pains.items.map((point, i) => { const Icon = PAIN_ICONS[i]; return (
              <FadeIn key={i} delay={i * 150}><div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 hover:shadow-lg hover:border-red-100 transition-all h-full"><div className="w-14 h-14 rounded-xl bg-red-50 flex items-center justify-center mb-6"><Icon className="w-7 h-7 text-red-500" /></div><h3 className="text-xl font-bold mb-3">{point.title}</h3><p className="text-gray-600 leading-relaxed">{point.desc}</p></div></FadeIn>); })}
          </div>
          <FadeIn delay={500}><div className="mt-12 text-center"><p className="text-lg text-gray-700 font-medium">{t.pains.bridge1} <span className="text-purple-600 font-bold">{t.pains.bridge2}</span></p></div></FadeIn>
        </div>
      </section>

      <section id="results" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-purple-600 mb-3">{t.results.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.results.title}</h2></div></FadeIn>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {t.results.items.map((r, i) => { const Icon = RESULT_ICONS[i]; return (
              <FadeIn key={i} delay={i * 100}><div className="text-center p-8 rounded-2xl bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-100"><Icon className="w-8 h-8 text-purple-600 mx-auto mb-4" /><div className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent"><Counter end={parseFloat(r.metric)} suffix={r.suffix} /></div><p className="mt-3 text-sm text-gray-600 font-medium">{r.label}</p></div></FadeIn>); })}
          </div>
        </div>
      </section>

      <section id="process" className="py-24 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-purple-400 mb-3">{t.process.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.process.title}</h2><p className="mt-4 text-gray-400 max-w-xl mx-auto">{t.process.sub}</p></div></FadeIn>
          <div className="grid md:grid-cols-4 gap-6 relative">
            <div className="hidden md:block absolute top-16 left-[12%] right-[12%] h-px bg-gradient-to-r from-purple-500/50 via-indigo-500/50 to-purple-500/50" />
            {t.process.steps.map((s, i) => { const Icon = PROCESS_ICONS[i]; return (
              <FadeIn key={i} delay={i * 150}><div className="relative text-center p-6 rounded-2xl bg-gray-800/50 border border-gray-700 hover:border-purple-500/50 transition-all group"><div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center mx-auto mb-4 text-lg font-bold relative z-10">{String(i + 1).padStart(2, '0')}</div><Icon className="w-6 h-6 text-purple-400 mx-auto mb-3 group-hover:scale-110 transition-transform" /><h3 className="text-lg font-bold mb-2">{s.title}</h3><p className="text-gray-400 text-sm leading-relaxed">{s.desc}</p></div></FadeIn>); })}
          </div>
        </div>
      </section>

      <section id="packages" className="py-24 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-purple-600 mb-3">{t.packages.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.packages.title}</h2><p className="mt-4 text-gray-600 max-w-xl mx-auto">{t.packages.sub}</p></div></FadeIn>
          <div className={`grid gap-8 items-start ${packages.length === 1 ? 'max-w-md mx-auto' : packages.length === 2 ? 'md:grid-cols-2 max-w-3xl mx-auto' : 'md:grid-cols-3'}`}>
            {packages.map((pkg, i) => {
              const style = CARD_STYLES[i] || CARD_STYLES[0];
              const isSelected = selectedPackage?.id === pkg.id;
              const badge = t.packages.badge[i];
              return (
                <FadeIn key={pkg.id} delay={i * 150}>
                  <div className={`relative rounded-2xl bg-white border-2 ${style.border} transition-all hover:shadow-2xl ${style.popular ? 'md:-mt-4 md:mb-4 shadow-xl ring-2 ring-purple-500/20' : 'shadow-sm'} ${isSelected ? 'ring-2 ring-green-500' : ''}`}>
                    {badge && (<div className={`absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-gradient-to-r ${style.color} text-white text-xs font-bold tracking-wide`}>{badge}</div>)}
                    <div className="p-8">
                      <h3 className="text-2xl font-bold">{pkg.title}</h3>
                      {pkg.description && (<p className="text-sm text-gray-500 mt-1">{pkg.description.replace(/<[^>]*>/g, '').slice(0, 120)}</p>)}
                      <div className="mt-6 flex items-baseline gap-1.5"><span className={`text-4xl font-bold bg-gradient-to-r ${style.color} bg-clip-text text-transparent`}>{pkg.price.toLocaleString()}</span><span className="text-sm text-gray-500">{currencySymbol(pkg.currency)}{t.packages.perMonth}</span></div>
                      {t.packages.features[i] && (<ul className="mt-6 space-y-3">{t.packages.features[i].map((feature, fi) => (<li key={fi} className="flex items-start gap-2.5 text-sm text-gray-700"><CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${style.popular ? 'text-purple-500' : 'text-green-500'}`} />{feature}</li>))}</ul>)}
                      <button onClick={() => scrollToContact(pkg)} className={`mt-8 w-full py-3.5 rounded-xl text-sm font-semibold transition-all hover:-translate-y-0.5 ${style.popular ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:shadow-lg hover:shadow-purple-500/25' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}>{isSelected ? t.packages.chosen : t.packages.cta[i] || t.packages.cta[0]}</button>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>
          <FadeIn delay={500}><p className="mt-10 text-center text-sm text-gray-500">{t.packages.note}</p></FadeIn>
        </div>
      </section>

      <section id="testimonials" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-purple-600 mb-3">{t.testimonials.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.testimonials.title}</h2></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {t.testimonials.items.map((tm, i) => (
              <FadeIn key={i} delay={i * 150}><div className="p-8 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg transition-all h-full flex flex-col"><div className="flex mb-4">{[1,2,3,4,5].map(j => (<Star key={j} className="w-5 h-5 text-amber-400 fill-amber-400" />))}</div><p className="text-gray-700 leading-relaxed flex-1 italic">"{tm.quote}"</p><div className="mt-6 flex items-center gap-3 pt-4 border-t border-gray-100"><div className="w-11 h-11 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center text-white font-bold text-sm">{tm.avatar}</div><div><p className="font-semibold text-sm">{tm.name}</p><p className="text-xs text-gray-500">{tm.role}</p></div></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-purple-600 mb-3">{t.faq.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.faq.title}</h2></div></FadeIn>
          <div className="space-y-3">
            {t.faq.items.map((item, i) => (
              <FadeIn key={i} delay={i * 80}><div className="bg-white rounded-xl border border-gray-100 overflow-hidden"><button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"><span className="font-semibold text-gray-900 pr-4">{item.q}</span><ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} /></button><div className={`transition-all duration-300 overflow-hidden ${openFaq === i ? 'max-h-60 opacity-100' : 'max-h-0 opacity-0'}`}><p className="px-6 pb-5 text-gray-600 leading-relaxed">{item.a}</p></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className="py-24 bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-white relative overflow-hidden">
        <div className="absolute inset-0"><div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-3xl" /><div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-indigo-500/10 rounded-full blur-3xl" /></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-purple-400 mb-4">{t.contact.kicker}</p>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">{t.contact.title1} <span className="text-purple-400">{t.contact.title2}</span></h2>
                <p className="mt-5 text-gray-300 leading-relaxed text-lg">{t.contact.sub}</p>
                <div className="mt-8 space-y-4">{t.contact.perks.map((p, i) => (<div key={i} className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">{p}</span></div>))}</div>
                <div className="mt-10 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30"><p className="text-sm text-amber-300 font-medium flex items-center gap-2"><Clock className="w-4 h-4" />{t.contact.urgency}</p></div>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              {formSent ? (
                <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-10 border border-white/10 text-center"><div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6"><CheckCircle2 className="w-10 h-10 text-green-400" /></div><h3 className="text-2xl font-bold mb-3">{t.contact.successTitle}</h3><p className="text-gray-300">{t.contact.successBody}</p></div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">{t.contact.formTitle}</h3>
                  {selectedPackage && (<div className="flex items-center justify-between px-4 py-3 rounded-xl bg-purple-500/20 border border-purple-500/30"><div><p className="text-xs text-purple-300">{t.contact.selected}</p><p className="font-semibold text-white">{selectedPackage.title} — {selectedPackage.price.toLocaleString()} {selectedPackage.currency || 'ALL'}{t.packages.perMonth}</p></div><button type="button" onClick={() => setSelectedPackage(null)} className="text-purple-300 hover:text-white text-sm underline">{t.contact.change}</button></div>)}
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.name}</label><input type="text" required value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder={t.contact.namePh} /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.email}</label><input type="email" required value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder="email@domain.com" /></div>
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.phone}</label><input type="tel" value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder={t.contact.phonePh} /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.site}</label><input type="url" value={formData.website} onChange={e => setFormData(p => ({ ...p, website: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder={t.contact.sitePh} /></div>
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.message}</label><textarea rows={3} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none" placeholder={t.contact.messagePh} /></div>
                  {formError && (<div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">{formError}</div>)}
                  <button type="submit" disabled={submitting} className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-400 hover:to-indigo-400 text-white shadow-lg shadow-purple-500/25 transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60">{submitting ? t.contact.submitting : t.contact.submit}{!submitting && <ArrowUpRight className="w-5 h-5" />}</button>
                  <p className="text-xs text-gray-400 text-center">{t.contact.privacy}</p>
                </form>
              )}
            </FadeIn>
          </div>
        </div>
      </section>

      <footer className="py-10 bg-gray-950 text-gray-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2"><div className="w-6 h-6 rounded bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center"><Search className="w-3 h-3 text-white" /></div><span className="font-semibold text-white text-sm">FivoCRM</span></div>
          <p className="text-sm">&copy; {new Date().getFullYear()} FivoCRM. {t.footer.rights}</p>
          <div className="flex items-center gap-6 text-sm"><Link to="/login" className="hover:text-white transition-colors">{t.nav.login}</Link><a href="#packages" className="hover:text-white transition-colors">{t.footer.pricing}</a><a href="#contact" className="hover:text-white transition-colors">{t.footer.contact}</a></div>
        </div>
      </footer>
    </div>
  );
}
