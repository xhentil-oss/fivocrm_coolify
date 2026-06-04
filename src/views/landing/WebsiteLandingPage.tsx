import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Code2, CheckCircle2, X, ArrowRight, Star, Clock, Shield,
  ChevronDown, Phone, ArrowUpRight, Sparkles, Rocket, Languages,
  Gauge, Search,
} from 'lucide-react';

/* ─── scroll-in animation ─── */
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
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
    <div ref={ref}
      className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

type Lang = 'sq' | 'en' | 'it';

interface Pkg {
  id: string;
  name: string;
  tagline: string;
  price: number;      // EUR, one-time
  badge?: string;
  included: string[];
  excluded: string[];
  popular?: boolean;
}

interface Copy {
  langName: string;
  nav: { results: string; process: string; packages: string; faq: string; login: string; cta: string };
  hero: {
    badge: string; h1a: string; h1b: string; h1c: string; sub: string;
    ctaPrimary: string; ctaSecondary: string;
    t1: string; t2: string; t3: string;
  };
  pains: { kicker: string; title: string; items: { title: string; desc: string }[]; bridge: string };
  why: { kicker: string; title: string; items: { metric: string; label: string }[] };
  process: { kicker: string; title: string; sub: string; steps: { title: string; desc: string }[] };
  packages: { kicker: string; title: string; sub: string; oneTime: string; choose: string; chosen: string; note: string; included: string; notIncluded: string; list: Pkg[] };
  testimonials: { kicker: string; title: string; items: { quote: string; name: string; role: string; avatar: string }[] };
  faq: { kicker: string; title: string; items: { q: string; a: string }[] };
  contact: {
    kicker: string; title: string; sub: string; perks: string[]; urgency: string;
    formTitle: string; selected: string; change: string;
    name: string; namePh: string; email: string; phone: string; phonePh: string;
    website: string; websitePh: string; message: string; messagePh: string;
    submit: string; submitting: string; privacy: string;
    successTitle: string; successBody: string; error: string;
  };
  footer: { rights: string; pricing: string; contact: string };
}

/* ─────────────────────────── ALBANIAN ─────────────────────────── */
const SQ: Copy = {
  langName: 'Shqip',
  nav: { results: 'Pse ne', process: 'Procesi', packages: 'Paketat', faq: 'FAQ', login: 'Hyr', cta: 'Merr Ofertën' },
  hero: {
    badge: '120+ faqe interneti të dorëzuara',
    h1a: 'Faqja juaj e re —', h1b: 'profesionale, e shpejtë', h1c: 'dhe që sjell klientë.',
    sub: 'Dizajn modern, shumëgjuhësh dhe i optimizuar për Google. Ndërtojmë faqe që nuk janë thjesht të bukura — janë makina shitjeje.',
    ctaPrimary: 'Shiko Paketat', ctaSecondary: 'Konsultim Falas',
    t1: 'Pa kontratë afatgjatë', t2: 'Dorëzim brenda afatit', t3: 'Anglisht · Italisht · Shqip',
  },
  pains: {
    kicker: 'A e njeh këtë situatë?',
    title: 'Një faqe e dobët po të kushton klientë',
    items: [
      { title: 'Klientët largohen për 3 sekonda', desc: 'Faqe e ngadaltë ose e vjetëruar = besim i humbur dhe klientë që ikin te konkurrenti.' },
      { title: 'Je i padukshëm në Google', desc: 'Pa SEO dhe strukturë të saktë, klientët nuk të gjejnë dot kur të kërkojnë.' },
      { title: 'Nuk flet gjuhën e klientit', desc: 'Tregu ndërkombëtar kërkon faqe shumëgjuhëshe. Një faqe vetëm në një gjuhë mbyll dyer.' },
    ],
    bridge: 'Zgjidhja? Një faqe e ndërtuar siç duhet — nga e para.',
  },
  why: {
    kicker: 'Pse FivoCRM',
    title: 'Rezultate, jo premtime',
    items: [
      { metric: '120+', label: 'Faqe të dorëzuara' },
      { metric: '<2s', label: 'Kohë ngarkimi' },
      { metric: '3', label: 'Gjuhë: EN · IT · SQ' },
      { metric: '98%', label: 'Klientë të kthyer' },
    ],
  },
  process: {
    kicker: 'Si punojmë', title: '4 hapa drejt faqes suaj', sub: 'Proces i qartë, pa surpriza, me afate.',
    steps: [
      { title: 'Konsultim & Strategji', desc: 'Kuptojmë biznesin, qëllimet dhe tregun tuaj.' },
      { title: 'Dizajn', desc: 'Dizajn modern që reflekton brandin tuaj — ju e aprovoni.' },
      { title: 'Zhvillim', desc: 'E ndërtojmë të shpejtë, të sigurt dhe shumëgjuhëshe.' },
      { title: 'Lansim & Mbështetje', desc: 'E publikojmë dhe ju mbështesim pas dorëzimit.' },
    ],
  },
  packages: {
    kicker: 'Paketat', title: 'Zgjidh paketën që i përshtatet biznesit', sub: 'Çmim një herë — pa kosto mujore të fshehura. TVSH nuk përfshihet.',
    oneTime: 'një herë', choose: 'Zgjidh Këtë Paket', chosen: '✓ Zgjedhur', note: 'Të gjitha paketat: dizajn responsive, hosting, dhe trajnim bazë për përdorim. Çmimet në Euro (€).',
    included: 'Përfshihet', notIncluded: 'Nuk përfshihet',
    list: [
      {
        id: 'basic', name: 'Bazike', tagline: 'Prania jote e parë profesionale online', price: 550,
        included: ['Dizajn profesional & responsive', 'Deri në 10 faqe', 'Gjuha kryesore sipas zgjedhjes', 'SEO bazike', 'Google Analytics', 'Hosting bazik', 'Formular kontakti + Google Maps', 'Lidhje me rrjetet sociale', 'Siguri bazike', 'Mbështetje teknike 1 muaj'],
        excluded: ['SEO Premium', 'Reklama Google & Social', 'SSL & siguri e avancuar', 'Hosting Premium'],
      },
      {
        id: 'standard', name: 'Standard', tagline: 'Për biznese që duan të rriten seriozisht', price: 1200, popular: true, badge: 'Më e zgjedhura',
        included: ['Gjithçka nga Bazike, plus:', 'Dizajn i personalizuar me brand', 'Deri në 15 faqe', 'SEO Premium', 'Integrim me rrjetet sociale', 'Gati për shumë gjuhë', 'Certifikatë SSL', 'Hosting Premium', 'Siguri e avancuar', 'Mbështetje teknike 3 muaj'],
        excluded: ['SEO Plus', 'Sistem rezervimesh ndërkombëtar', 'Integrim CDN', 'Hosting Plus'],
      },
      {
        id: 'advanced', name: 'Avancuar', tagline: 'Faqja që rezervon dhe shet vetë', price: 1750, badge: 'Vlera më e mirë',
        included: ['Gjithçka nga Standard, plus:', 'Elemente vizuale të personalizuara', 'Deri në 20 faqe', 'Sistem rezervimesh online', 'SEO Plus', 'Analiza të avancuara', 'Integrim CDN', 'Hosting Plus', 'Backup ditor', 'Pagesa online', 'Mbështetje teknike 6 muaj'],
        excluded: ['Integrim Google Reviews', 'SEO me analizë konkurruese', 'Hosting Premium Plus'],
      },
      {
        id: 'premium', name: 'Premium', tagline: 'Zgjidhja totale, pa kompromise', price: 2400,
        included: ['Gjithçka nga Avancuar, plus:', 'Dizajn unik plotësisht i personalizuar', 'Faqe të pakufizuara + përditësime', 'Sistem i plotë rezervimesh & pagesash', 'SEO me analizë konkurruese', 'Reklama Google & Social + gjurmim', 'Integrim Google Reviews', 'Hosting Premium Plus', 'Siguri + monitorim 24/7', 'Mbështetje teknike 12 muaj'],
        excluded: [],
      },
    ],
  },
  testimonials: {
    kicker: 'Dëshmi', title: 'Çfarë thonë klientët',
    items: [
      { quote: 'Faqja e re na solli klientë italianë brenda javës së parë. Profesionalizëm i jashtëzakonshëm.', name: 'Marco Bianchi', role: 'Studio Dentale, Milano', avatar: 'MB' },
      { quote: 'E shpejtë, e bukur dhe në 3 gjuhë. Pikërisht çfarë na duhej për tregun ndërkombëtar.', name: 'Elsa Hoxha', role: 'Boutique Hotel', avatar: 'EH' },
      { quote: 'Sistemi i rezervimeve online na kurseu orë të tëra çdo ditë. E rekomandoj fuqishëm.', name: 'Andrea Rossi', role: 'Clinica Estetica', avatar: 'AR' },
    ],
  },
  faq: {
    kicker: 'FAQ', title: 'Pyetjet më të shpeshta',
    items: [
      { q: 'Sa kohë merr ndërtimi i faqes?', a: 'Zakonisht 2–4 javë në varësi të paketës dhe përmbajtjes. Ju japim një afat të qartë që në fillim.' },
      { q: 'A është faqja në 3 gjuhë?', a: 'Po — ofrojmë Anglisht, Italisht dhe Shqip. Paketat Standard e lart janë gati për shumë gjuhë.' },
      { q: 'A i mbani ju hosting dhe mirëmbajtjen?', a: 'Po, hosting përfshihet dhe ofrojmë mbështetje teknike sipas paketës (1–12 muaj).' },
      { q: 'A mund të shtoj dyqan online ose rezervime?', a: 'Absolutisht. Paketat Avancuar dhe Premium përfshijnë rezervime dhe pagesa online.' },
      { q: 'Çfarë ndodh pas dorëzimit?', a: 'Faqja është 100% e juaja. Ju trajnojmë për ta përdorur dhe ju mbështesim sipas paketës.' },
    ],
  },
  contact: {
    kicker: 'Gati për të filluar?', title: 'Merr ofertën tënde falas sot', sub: 'Plotëso formularin dhe merr një konsultim falas + ofertë të personalizuar brenda 24 orëve.',
    perks: ['Konsultim falas pa detyrim', 'Ofertë e personalizuar për biznesin tuaj', 'Këshilla konkrete edhe nëse nuk vazhdoni'],
    urgency: 'Pranojmë vetëm pak projekte të reja çdo muaj për cilësi maksimale.',
    formTitle: 'Merr ofertën falas', selected: 'Paketa e zgjedhur', change: 'Ndrysho',
    name: 'Emri i plotë *', namePh: 'Emri Mbiemri', email: 'Email *', phone: 'Telefon', phonePh: '+355 6X XXX XXXX',
    website: 'Faqja aktuale (nëse ke)', websitePh: 'https://example.com', message: 'Mesazh (opsional)', messagePh: 'Na trego pak për biznesin tuaj...',
    submit: 'Dërgo Kërkesën', submitting: 'Duke dërguar...', privacy: 'Duke dërguar pranoni politikën e privatësisë. Nuk do merrni spam.',
    successTitle: 'Faleminderit!', successBody: 'Kërkesa juaj u dërgua. Do t\'ju kontaktojmë brenda 24 orëve.', error: 'Diçka shkoi keq. Provoni përsëri.',
  },
  footer: { rights: 'Të gjitha të drejtat e rezervuara.', pricing: 'Çmimet', contact: 'Kontakt' },
};

/* ─────────────────────────── ENGLISH ─────────────────────────── */
const EN: Copy = {
  langName: 'English',
  nav: { results: 'Why us', process: 'Process', packages: 'Packages', faq: 'FAQ', login: 'Login', cta: 'Get a Quote' },
  hero: {
    badge: '120+ websites delivered',
    h1a: 'Your new website —', h1b: 'professional, fast', h1c: 'and built to convert.',
    sub: 'Modern, multilingual and SEO-optimized. We build websites that aren\'t just beautiful — they\'re sales machines.',
    ctaPrimary: 'See Packages', ctaSecondary: 'Free Consultation',
    t1: 'No long-term contract', t2: 'On-time delivery', t3: 'English · Italian · Albanian',
  },
  pains: {
    kicker: 'Sound familiar?',
    title: 'A weak website is costing you clients',
    items: [
      { title: 'Visitors leave in 3 seconds', desc: 'A slow or outdated site = lost trust and clients heading to your competitor.' },
      { title: 'You\'re invisible on Google', desc: 'Without SEO and the right structure, clients simply can\'t find you when they search.' },
      { title: 'You don\'t speak their language', desc: 'International markets need multilingual sites. A single-language site closes doors.' },
    ],
    bridge: 'The fix? A website built right — from the ground up.',
  },
  why: {
    kicker: 'Why FivoCRM',
    title: 'Results, not promises',
    items: [
      { metric: '120+', label: 'Websites delivered' },
      { metric: '<2s', label: 'Load time' },
      { metric: '3', label: 'Languages: EN · IT · SQ' },
      { metric: '98%', label: 'Returning clients' },
    ],
  },
  process: {
    kicker: 'How we work', title: '4 steps to your website', sub: 'A clear process, no surprises, with deadlines.',
    steps: [
      { title: 'Consultation & Strategy', desc: 'We understand your business, goals and market.' },
      { title: 'Design', desc: 'A modern design that reflects your brand — you approve it.' },
      { title: 'Development', desc: 'We build it fast, secure and multilingual.' },
      { title: 'Launch & Support', desc: 'We publish it and support you after delivery.' },
    ],
  },
  packages: {
    kicker: 'Packages', title: 'Choose the package that fits your business', sub: 'One-time price — no hidden monthly costs. VAT not included.',
    oneTime: 'one-time', choose: 'Choose This Plan', chosen: '✓ Selected', note: 'All packages: responsive design, hosting, and basic training. Prices in Euro (€).',
    included: 'Included', notIncluded: 'Not included',
    list: [
      {
        id: 'basic', name: 'Basic', tagline: 'Your first professional presence online', price: 550,
        included: ['Professional & responsive design', 'Up to 10 pages', 'Primary language of your choice', 'Basic SEO', 'Google Analytics', 'Basic hosting', 'Contact form + Google Maps', 'Social media links', 'Basic security', '1-month technical support'],
        excluded: ['Premium SEO', 'Google & Social ads', 'SSL & advanced security', 'Premium hosting'],
      },
      {
        id: 'standard', name: 'Standard', tagline: 'For businesses ready to grow seriously', price: 1200, popular: true, badge: 'Most popular',
        included: ['Everything in Basic, plus:', 'Custom branded design', 'Up to 15 pages', 'Premium SEO', 'Social media integration', 'Multi-language ready', 'SSL certificate', 'Premium hosting', 'Advanced security', '3-month technical support'],
        excluded: ['SEO Plus', 'International booking system', 'CDN integration', 'Hosting Plus'],
      },
      {
        id: 'advanced', name: 'Advanced', tagline: 'A site that books and sells on its own', price: 1750, badge: 'Best value',
        included: ['Everything in Standard, plus:', 'Custom visual elements', 'Up to 20 pages', 'Online booking system', 'SEO Plus', 'Advanced analytics', 'CDN integration', 'Hosting Plus', 'Daily backup', 'Online payments', '6-month technical support'],
        excluded: ['Google Reviews integration', 'SEO with competitor analysis', 'Premium Plus hosting'],
      },
      {
        id: 'premium', name: 'Premium', tagline: 'The complete solution, no compromises', price: 2400,
        included: ['Everything in Advanced, plus:', 'Fully custom unique design', 'Unlimited pages + updates', 'Full booking & payment system', 'SEO with competitor analysis', 'Google & Social ads + tracking', 'Google Reviews integration', 'Premium Plus hosting', '24/7 security & monitoring', '12-month technical support'],
        excluded: [],
      },
    ],
  },
  testimonials: {
    kicker: 'Testimonials', title: 'What clients say',
    items: [
      { quote: 'The new site brought us Italian clients in the first week. Truly professional.', name: 'Marco Bianchi', role: 'Dental Studio, Milan', avatar: 'MB' },
      { quote: 'Fast, beautiful and in 3 languages. Exactly what we needed for the international market.', name: 'Elsa Hoxha', role: 'Boutique Hotel', avatar: 'EH' },
      { quote: 'The online booking system saved us hours every day. Highly recommend.', name: 'Andrea Rossi', role: 'Aesthetic Clinic', avatar: 'AR' },
    ],
  },
  faq: {
    kicker: 'FAQ', title: 'Frequently asked questions',
    items: [
      { q: 'How long does it take to build?', a: 'Usually 2–4 weeks depending on the package and content. We give you a clear deadline upfront.' },
      { q: 'Is the website in 3 languages?', a: 'Yes — we offer English, Italian and Albanian. Standard and above are multi-language ready.' },
      { q: 'Do you handle hosting and maintenance?', a: 'Yes, hosting is included and we provide technical support per package (1–12 months).' },
      { q: 'Can I add an online shop or bookings?', a: 'Absolutely. Advanced and Premium include online bookings and payments.' },
      { q: 'What happens after delivery?', a: 'The site is 100% yours. We train you to use it and support you per your package.' },
    ],
  },
  contact: {
    kicker: 'Ready to start?', title: 'Get your free quote today', sub: 'Fill in the form and get a free consultation + a tailored quote within 24 hours.',
    perks: ['Free, no-obligation consultation', 'Tailored quote for your business', 'Concrete advice even if you don\'t proceed'],
    urgency: 'We only take a few new projects each month for maximum quality.',
    formTitle: 'Get your free quote', selected: 'Selected package', change: 'Change',
    name: 'Full name *', namePh: 'First Last', email: 'Email *', phone: 'Phone', phonePh: '+39 3XX XXX XXXX',
    website: 'Current website (if any)', websitePh: 'https://example.com', message: 'Message (optional)', messagePh: 'Tell us a bit about your business...',
    submit: 'Send Request', submitting: 'Sending...', privacy: 'By submitting you accept the privacy policy. No spam.',
    successTitle: 'Thank you!', successBody: 'Your request was sent. We\'ll contact you within 24 hours.', error: 'Something went wrong. Please try again.',
  },
  footer: { rights: 'All rights reserved.', pricing: 'Pricing', contact: 'Contact' },
};

/* ─────────────────────────── ITALIAN ─────────────────────────── */
const IT: Copy = {
  langName: 'Italiano',
  nav: { results: 'Perché noi', process: 'Processo', packages: 'Pacchetti', faq: 'FAQ', login: 'Accedi', cta: 'Richiedi Preventivo' },
  hero: {
    badge: '120+ siti web realizzati',
    h1a: 'Il tuo nuovo sito —', h1b: 'professionale, veloce', h1c: 'e fatto per convertire.',
    sub: 'Moderno, multilingue e ottimizzato per Google. Costruiamo siti che non sono solo belli — sono macchine di vendita.',
    ctaPrimary: 'Vedi i Pacchetti', ctaSecondary: 'Consulenza Gratuita',
    t1: 'Nessun contratto a lungo termine', t2: 'Consegna nei tempi', t3: 'Inglese · Italiano · Albanese',
  },
  pains: {
    kicker: 'Ti suona familiare?',
    title: 'Un sito debole ti sta costando clienti',
    items: [
      { title: 'I visitatori se ne vanno in 3 secondi', desc: 'Un sito lento o datato = fiducia persa e clienti che vanno dal concorrente.' },
      { title: 'Sei invisibile su Google', desc: 'Senza SEO e la giusta struttura, i clienti non ti trovano quando cercano.' },
      { title: 'Non parli la loro lingua', desc: 'I mercati internazionali richiedono siti multilingue. Un sito monolingua chiude porte.' },
    ],
    bridge: 'La soluzione? Un sito costruito bene — da zero.',
  },
  why: {
    kicker: 'Perché FivoCRM',
    title: 'Risultati, non promesse',
    items: [
      { metric: '120+', label: 'Siti realizzati' },
      { metric: '<2s', label: 'Tempo di caricamento' },
      { metric: '3', label: 'Lingue: EN · IT · SQ' },
      { metric: '98%', label: 'Clienti che tornano' },
    ],
  },
  process: {
    kicker: 'Come lavoriamo', title: '4 passi verso il tuo sito', sub: 'Un processo chiaro, senza sorprese, con scadenze.',
    steps: [
      { title: 'Consulenza & Strategia', desc: 'Capiamo la tua attività, gli obiettivi e il mercato.' },
      { title: 'Design', desc: 'Un design moderno che riflette il tuo brand — lo approvi tu.' },
      { title: 'Sviluppo', desc: 'Lo costruiamo veloce, sicuro e multilingue.' },
      { title: 'Lancio & Supporto', desc: 'Lo pubblichiamo e ti supportiamo dopo la consegna.' },
    ],
  },
  packages: {
    kicker: 'Pacchetti', title: 'Scegli il pacchetto adatto alla tua attività', sub: 'Prezzo una tantum — nessun costo mensile nascosto. IVA esclusa.',
    oneTime: 'una tantum', choose: 'Scegli Questo Piano', chosen: '✓ Selezionato', note: 'Tutti i pacchetti: design responsive, hosting e formazione di base. Prezzi in Euro (€).',
    included: 'Incluso', notIncluded: 'Non incluso',
    list: [
      {
        id: 'basic', name: 'Base', tagline: 'La tua prima presenza professionale online', price: 550,
        included: ['Design professionale & responsive', 'Fino a 10 pagine', 'Lingua principale a scelta', 'SEO di base', 'Google Analytics', 'Hosting di base', 'Modulo contatti + Google Maps', 'Collegamento ai social', 'Sicurezza di base', 'Supporto tecnico 1 mese'],
        excluded: ['SEO Premium', 'Pubblicità Google & Social', 'SSL & sicurezza avanzata', 'Hosting Premium'],
      },
      {
        id: 'standard', name: 'Standard', tagline: 'Per attività pronte a crescere sul serio', price: 1200, popular: true, badge: 'Più scelto',
        included: ['Tutto del Base, più:', 'Design personalizzato col brand', 'Fino a 15 pagine', 'SEO Premium', 'Integrazione social', 'Pronto per più lingue', 'Certificato SSL', 'Hosting Premium', 'Sicurezza avanzata', 'Supporto tecnico 3 mesi'],
        excluded: ['SEO Plus', 'Sistema prenotazioni internazionale', 'Integrazione CDN', 'Hosting Plus'],
      },
      {
        id: 'advanced', name: 'Avanzato', tagline: 'Un sito che prenota e vende da solo', price: 1750, badge: 'Miglior valore',
        included: ['Tutto dello Standard, più:', 'Elementi visivi personalizzati', 'Fino a 20 pagine', 'Sistema di prenotazione online', 'SEO Plus', 'Analisi avanzate', 'Integrazione CDN', 'Hosting Plus', 'Backup giornaliero', 'Pagamenti online', 'Supporto tecnico 6 mesi'],
        excluded: ['Integrazione Google Reviews', 'SEO con analisi della concorrenza', 'Hosting Premium Plus'],
      },
      {
        id: 'premium', name: 'Premium', tagline: 'La soluzione totale, senza compromessi', price: 2400,
        included: ['Tutto dell\'Avanzato, più:', 'Design unico totalmente personalizzato', 'Pagine illimitate + aggiornamenti', 'Sistema completo prenotazioni & pagamenti', 'SEO con analisi della concorrenza', 'Pubblicità Google & Social + tracking', 'Integrazione Google Reviews', 'Hosting Premium Plus', 'Sicurezza & monitoraggio 24/7', 'Supporto tecnico 12 mesi'],
        excluded: [],
      },
    ],
  },
  testimonials: {
    kicker: 'Testimonianze', title: 'Cosa dicono i clienti',
    items: [
      { quote: 'Il nuovo sito ci ha portato clienti italiani nella prima settimana. Davvero professionali.', name: 'Marco Bianchi', role: 'Studio Dentistico, Milano', avatar: 'MB' },
      { quote: 'Veloce, bello e in 3 lingue. Esattamente ciò che serviva per il mercato internazionale.', name: 'Elsa Hoxha', role: 'Boutique Hotel', avatar: 'EH' },
      { quote: 'Il sistema di prenotazione online ci ha fatto risparmiare ore ogni giorno. Consigliatissimo.', name: 'Andrea Rossi', role: 'Clinica Estetica', avatar: 'AR' },
    ],
  },
  faq: {
    kicker: 'FAQ', title: 'Domande frequenti',
    items: [
      { q: 'Quanto tempo serve per realizzarlo?', a: 'Di solito 2–4 settimane in base al pacchetto e ai contenuti. Ti diamo una scadenza chiara fin dall\'inizio.' },
      { q: 'Il sito è in 3 lingue?', a: 'Sì — offriamo Inglese, Italiano e Albanese. Standard e superiori sono pronti per più lingue.' },
      { q: 'Gestite hosting e manutenzione?', a: 'Sì, l\'hosting è incluso e offriamo supporto tecnico per pacchetto (1–12 mesi).' },
      { q: 'Posso aggiungere shop online o prenotazioni?', a: 'Assolutamente. Avanzato e Premium includono prenotazioni e pagamenti online.' },
      { q: 'Cosa succede dopo la consegna?', a: 'Il sito è al 100% tuo. Ti formiamo all\'uso e ti supportiamo secondo il pacchetto.' },
    ],
  },
  contact: {
    kicker: 'Pronto a iniziare?', title: 'Ricevi il tuo preventivo gratuito oggi', sub: 'Compila il modulo e ricevi una consulenza gratuita + un preventivo su misura entro 24 ore.',
    perks: ['Consulenza gratuita senza impegno', 'Preventivo su misura per la tua attività', 'Consigli concreti anche se non procedi'],
    urgency: 'Accettiamo solo pochi nuovi progetti al mese per la massima qualità.',
    formTitle: 'Ricevi il preventivo gratuito', selected: 'Pacchetto selezionato', change: 'Modifica',
    name: 'Nome completo *', namePh: 'Nome Cognome', email: 'Email *', phone: 'Telefono', phonePh: '+39 3XX XXX XXXX',
    website: 'Sito attuale (se presente)', websitePh: 'https://example.com', message: 'Messaggio (opzionale)', messagePh: 'Raccontaci della tua attività...',
    submit: 'Invia Richiesta', submitting: 'Invio in corso...', privacy: 'Inviando accetti l\'informativa sulla privacy. Niente spam.',
    successTitle: 'Grazie!', successBody: 'La tua richiesta è stata inviata. Ti contatteremo entro 24 ore.', error: 'Qualcosa è andato storto. Riprova.',
  },
  footer: { rights: 'Tutti i diritti riservati.', pricing: 'Prezzi', contact: 'Contatti' },
};

const COPY: Record<Lang, Copy> = { sq: SQ, en: EN, it: IT };
const PKG_ACCENTS = [
  'from-slate-500 to-gray-600',
  'from-blue-600 to-indigo-600',
  'from-violet-600 to-purple-600',
  'from-amber-500 to-orange-600',
];

export default function WebsiteLandingPage() {
  const [lang, setLang] = useState<Lang>('sq');
  const t = COPY[lang];
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [selected, setSelected] = useState<Pkg | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', website: '', message: '' });
  const [formSent, setFormSent] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const scrollTo = (id: string, pkg?: Pkg) => {
    if (pkg) setSelected(pkg);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
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
          category: 'Website',
          packageId: selected?.id || '',
          packageName: selected ? `Website — ${selected.name} (€${selected.price})` : 'Website',
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

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans overflow-x-hidden">
      {/* NAV */}
      <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center">
              <Code2 className="w-4 h-4 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">FivoCRM Web</span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-gray-600">
            <a href="#why" className="hover:text-blue-600 transition-colors">{t.nav.results}</a>
            <a href="#process" className="hover:text-blue-600 transition-colors">{t.nav.process}</a>
            <a href="#packages" className="hover:text-blue-600 transition-colors">{t.nav.packages}</a>
            <a href="#faq" className="hover:text-blue-600 transition-colors">{t.nav.faq}</a>
          </div>
          <div className="flex items-center gap-3">
            {/* Language switcher */}
            <div className="hidden sm:flex items-center gap-0.5 rounded-full border border-gray-200 p-0.5 text-xs font-semibold">
              {(['sq', 'en', 'it'] as Lang[]).map(l => (
                <button key={l} onClick={() => setLang(l)}
                  className={`px-2.5 py-1 rounded-full uppercase transition-colors ${lang === l ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-900'}`}>
                  {l}
                </button>
              ))}
            </div>
            <button onClick={() => scrollTo('contact')}
              className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:shadow-lg hover:shadow-blue-500/25 transition-all hover:-translate-y-0.5">
              {t.nav.cta}
            </button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-50/80 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-blue-200/30 rounded-full blur-3xl" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 border border-blue-100 mb-8">
                <Rocket className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-medium text-blue-700">{t.hero.badge}</span>
                <div className="flex">{[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}</div>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                {t.hero.h1a}{' '}
                <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent">{t.hero.h1b}</span>{' '}
                {t.hero.h1c}
              </h1>
            </FadeIn>
            <FadeIn delay={200}>
              <p className="mt-8 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">{t.hero.sub}</p>
            </FadeIn>
            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button onClick={() => scrollTo('packages')}
                  className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:shadow-xl hover:shadow-blue-500/25 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">
                  {t.hero.ctaPrimary}
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
                <button onClick={() => scrollTo('contact')}
                  className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border-2 border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all flex items-center justify-center gap-2">
                  <Phone className="w-5 h-5" />{t.hero.ctaSecondary}
                </button>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-400">
                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-500" /> {t.hero.t1}</span>
                <span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-blue-500" /> {t.hero.t2}</span>
                <span className="flex items-center gap-1.5"><Languages className="w-4 h-4 text-violet-500" /> {t.hero.t3}</span>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* PAINS */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-red-500 mb-3">{t.pains.kicker}</p>
              <h2 className="text-3xl sm:text-4xl font-bold">{t.pains.title}</h2>
            </div>
          </FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {t.pains.items.map((p, i) => {
              const Icon = [Gauge, Search, Languages][i];
              return (
                <FadeIn key={i} delay={i * 150}>
                  <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 hover:shadow-lg hover:border-red-100 transition-all h-full">
                    <div className="w-14 h-14 rounded-xl bg-red-50 flex items-center justify-center mb-6"><Icon className="w-7 h-7 text-red-500" /></div>
                    <h3 className="text-xl font-bold mb-3">{p.title}</h3>
                    <p className="text-gray-600 leading-relaxed">{p.desc}</p>
                  </div>
                </FadeIn>
              );
            })}
          </div>
          <FadeIn delay={450}>
            <p className="mt-12 text-center text-lg text-gray-700 font-medium">{t.pains.bridge}</p>
          </FadeIn>
        </div>
      </section>

      {/* WHY / STATS */}
      <section id="why" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-3">{t.why.kicker}</p>
              <h2 className="text-3xl sm:text-4xl font-bold">{t.why.title}</h2>
            </div>
          </FadeIn>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {t.why.items.map((r, i) => (
              <FadeIn key={i} delay={i * 100}>
                <div className="text-center p-8 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100">
                  <div className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">{r.metric}</div>
                  <p className="mt-3 text-sm text-gray-600 font-medium">{r.label}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* PROCESS */}
      <section id="process" className="py-24 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-blue-400 mb-3">{t.process.kicker}</p>
              <h2 className="text-3xl sm:text-4xl font-bold">{t.process.title}</h2>
              <p className="mt-4 text-gray-400 max-w-xl mx-auto">{t.process.sub}</p>
            </div>
          </FadeIn>
          <div className="grid md:grid-cols-4 gap-6 relative">
            <div className="hidden md:block absolute top-16 left-[12%] right-[12%] h-px bg-gradient-to-r from-blue-500/50 via-indigo-500/50 to-blue-500/50" />
            {t.process.steps.map((s, i) => {
              const Icon = [Phone, Sparkles, Code2, Rocket][i];
              return (
                <FadeIn key={i} delay={i * 150}>
                  <div className="relative text-center p-6 rounded-2xl bg-gray-800/50 border border-gray-700 hover:border-blue-500/50 transition-all group">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center mx-auto mb-4 text-lg font-bold relative z-10">{String(i + 1).padStart(2, '0')}</div>
                    <Icon className="w-6 h-6 text-blue-400 mx-auto mb-3 group-hover:scale-110 transition-transform" />
                    <h3 className="text-lg font-bold mb-2">{s.title}</h3>
                    <p className="text-gray-400 text-sm leading-relaxed">{s.desc}</p>
                  </div>
                </FadeIn>
              );
            })}
          </div>
        </div>
      </section>

      {/* PACKAGES */}
      <section id="packages" className="py-24 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-3">{t.packages.kicker}</p>
              <h2 className="text-3xl sm:text-4xl font-bold">{t.packages.title}</h2>
              <p className="mt-4 text-gray-600 max-w-xl mx-auto">{t.packages.sub}</p>
            </div>
          </FadeIn>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4 items-start">
            {t.packages.list.map((pkg, i) => {
              const accent = PKG_ACCENTS[i];
              const isSel = selected?.id === pkg.id;
              return (
                <FadeIn key={pkg.id} delay={i * 100}>
                  <div className={`relative rounded-2xl bg-white border-2 transition-all duration-300 hover:shadow-2xl ${pkg.popular ? 'border-blue-400 ring-2 ring-blue-500/20 xl:-mt-3 xl:mb-3 shadow-xl' : 'border-gray-200 shadow-sm'} ${isSel ? 'ring-2 ring-green-500' : ''}`}>
                    {pkg.badge && (
                      <div className={`absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap px-3.5 py-1.5 rounded-full bg-gradient-to-r ${accent} text-white text-[11px] font-bold tracking-wide`}>{pkg.badge}</div>
                    )}
                    <div className="p-6">
                      <h3 className="text-xl font-bold">{pkg.name}</h3>
                      <p className="text-xs text-gray-500 mt-1 min-h-[2.5rem]">{pkg.tagline}</p>
                      <div className="mt-4 flex items-baseline gap-1.5">
                        <span className={`text-4xl font-bold bg-gradient-to-r ${accent} bg-clip-text text-transparent`}>€{pkg.price.toLocaleString()}</span>
                        <span className="text-xs text-gray-500">{t.packages.oneTime}</span>
                      </div>
                      <button onClick={() => scrollTo('contact', pkg)}
                        className={`mt-5 w-full py-3 rounded-xl text-sm font-semibold transition-all hover:-translate-y-0.5 ${pkg.popular ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:shadow-lg hover:shadow-blue-500/25' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}>
                        {isSel ? t.packages.chosen : t.packages.choose}
                      </button>
                      <ul className="mt-6 space-y-2.5">
                        {pkg.included.map((f, fi) => (
                          <li key={fi} className={`flex items-start gap-2 text-[13px] ${f.endsWith(':') ? 'font-semibold text-gray-900 pt-1' : 'text-gray-700'}`}>
                            {!f.endsWith(':') && <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-green-500" />}
                            <span>{f}</span>
                          </li>
                        ))}
                        {pkg.excluded.map((f, fi) => (
                          <li key={`x-${fi}`} className="flex items-start gap-2 text-[13px] text-gray-400">
                            <X className="w-4 h-4 mt-0.5 flex-shrink-0 text-gray-300" />
                            <span className="line-through">{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>
          <FadeIn delay={400}>
            <p className="mt-10 text-center text-sm text-gray-500">{t.packages.note}</p>
          </FadeIn>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-3">{t.testimonials.kicker}</p>
              <h2 className="text-3xl sm:text-4xl font-bold">{t.testimonials.title}</h2>
            </div>
          </FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {t.testimonials.items.map((tm, i) => (
              <FadeIn key={i} delay={i * 150}>
                <div className="p-8 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg transition-all h-full flex flex-col">
                  <div className="flex mb-4">{[1,2,3,4,5].map(j => <Star key={j} className="w-5 h-5 text-amber-400 fill-amber-400" />)}</div>
                  <p className="text-gray-700 leading-relaxed flex-1 italic">"{tm.quote}"</p>
                  <div className="mt-6 flex items-center gap-3 pt-4 border-t border-gray-100">
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white font-bold text-sm">{tm.avatar}</div>
                    <div><p className="font-semibold text-sm">{tm.name}</p><p className="text-xs text-gray-500">{tm.role}</p></div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-3">{t.faq.kicker}</p>
              <h2 className="text-3xl sm:text-4xl font-bold">{t.faq.title}</h2>
            </div>
          </FadeIn>
          <div className="space-y-3">
            {t.faq.items.map((item, i) => (
              <FadeIn key={i} delay={i * 80}>
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors">
                    <span className="font-semibold text-gray-900 pr-4">{item.q}</span>
                    <ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
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

      {/* CONTACT */}
      <section id="contact" className="py-24 bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 text-white relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-indigo-500/10 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-blue-400 mb-4">{t.contact.kicker}</p>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">{t.contact.title}</h2>
                <p className="mt-5 text-gray-300 leading-relaxed text-lg">{t.contact.sub}</p>
                <div className="mt-8 space-y-4">
                  {t.contact.perks.map((p, i) => (
                    <div key={i} className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">{p}</span></div>
                  ))}
                </div>
                <div className="mt-10 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                  <p className="text-sm text-amber-300 font-medium flex items-center gap-2"><Clock className="w-4 h-4" />{t.contact.urgency}</p>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              {formSent ? (
                <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-10 border border-white/10 text-center">
                  <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6"><CheckCircle2 className="w-10 h-10 text-green-400" /></div>
                  <h3 className="text-2xl font-bold mb-3">{t.contact.successTitle}</h3>
                  <p className="text-gray-300">{t.contact.successBody}</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">{t.contact.formTitle}</h3>
                  {selected && (
                    <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-blue-500/20 border border-blue-500/30">
                      <div>
                        <p className="text-xs text-blue-300">{t.contact.selected}</p>
                        <p className="font-semibold text-white">{selected.name} — €{selected.price.toLocaleString()}</p>
                      </div>
                      <button type="button" onClick={() => setSelected(null)} className="text-blue-300 hover:text-white text-sm underline">{t.contact.change}</button>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.name}</label>
                    <input type="text" required value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder={t.contact.namePh} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.email}</label>
                      <input type="email" required value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="email@domain.com" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.phone}</label>
                      <input type="tel" value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder={t.contact.phonePh} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.website}</label>
                    <input type="url" value={formData.website} onChange={e => setFormData(p => ({ ...p, website: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder={t.contact.websitePh} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.message}</label>
                    <textarea rows={3} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" placeholder={t.contact.messagePh} />
                  </div>
                  {formError && <div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">{formError}</div>}
                  <button type="submit" disabled={submitting}
                    className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-400 hover:to-indigo-400 text-white shadow-lg shadow-blue-500/25 transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60">
                    {submitting ? t.contact.submitting : t.contact.submit}
                    {!submitting && <ArrowUpRight className="w-5 h-5" />}
                  </button>
                  <p className="text-xs text-gray-400 text-center">{t.contact.privacy}</p>
                </form>
              )}
            </FadeIn>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-10 bg-gray-950 text-gray-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center"><Code2 className="w-3 h-3 text-white" /></div>
            <span className="font-semibold text-white text-sm">FivoCRM Web</span>
          </div>
          <p className="text-sm">&copy; {new Date().getFullYear()} FivoCRM. {t.footer.rights}</p>
          <div className="flex items-center gap-6 text-sm">
            <Link to="/login" className="hover:text-white transition-colors">{t.nav.login}</Link>
            <a href="#packages" className="hover:text-white transition-colors">{t.footer.pricing}</a>
            <a href="#contact" className="hover:text-white transition-colors">{t.footer.contact}</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
