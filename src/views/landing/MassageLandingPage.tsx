import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, TrendingUp, Shield, Zap, CheckCircle2, ArrowRight,
  Star, Users, Target, Clock, ChevronDown, Phone,
  Camera, Instagram, Megaphone, BarChart3,
  X, Lock, Search, Globe, Heart, Leaf, Wind,
} from 'lucide-react';
import { LangSwitcher, useLandingLang, type Lang } from './LangSwitcher';
import LandingMobileMenu from './LandingMobileMenu';

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

interface Pkg { id: string; title: string; subtitle: string; price: string; originalPrice?: string; priceNote: string; popular?: boolean; badge?: string; color: string; border: string; headerBg: string; cta: string; targetAudience: string[]; features: { category: string; items: string[] }[]; notIncluded: string[]; }
interface Copy {
  nav: { results: string; process: string; packages: string; testimonials: string; faq: string; login: string; cta: string };
  hero: { badge: string; h1a: string; h1b: string; h1c: string; h1d: string; sub1: string; sub2: string; ctaPrimary: string; ctaSecondary: string; t1: string; t2: string; t3: string };
  pains: { kicker: string; title1: string; title2: string; items: { title: string; desc: string }[]; bridge1: string; bridge2: string };
  results: { kicker: string; title1: string; title2: string; items: { metric: string; suffix: string; label: string }[] };
  process: { kicker: string; title1: string; title2: string; steps: { step: string; title: string; desc: string }[] };
  packages: { kicker: string; title1: string; title2: string; sub: string; idealFor: string; notIncluded: string; less: string; moreCats: string; savingsBadge: string; calloutA: string; calloutB: string; list: Pkg[] };
  addons: { kicker: string; title1: string; title2: string; sub: string; items: { name: string; price: string }[] };
  testimonials: { kicker: string; title1: string; title2: string; items: { name: string; role: string; quote: string; avatar: string }[] };
  faq: { kicker: string; title1: string; title2: string; items: { q: string; a: string }[] };
  contact: { kicker: string; title1: string; title2: string; sub: string; selected: string; name: string; namePh: string; email: string; emailPh: string; phone: string; phonePh: string; site: string; sitePh: string; message: string; messagePh: string; submit: string; submitting: string; trust: string; successTitle: string; successBody: string; error: string };
  footer: { rights: string; login: string; contact: string };
}

const ADDON_ICONS = [Camera, Camera, Heart, Sparkles, Megaphone, Zap];
const RESULT_ICONS = [Sparkles, Target, TrendingUp, Users];
const PAIN_ICONS = [Globe, Instagram, Clock];
const PROCESS_ICONS = [Target, Search, Camera, BarChart3];
const PKG_STYLES = [
  { id: 'essential', color: 'from-emerald-500 to-teal-600', border: 'border-emerald-300 hover:border-emerald-500', headerBg: 'bg-gradient-to-br from-emerald-50 to-teal-50', popular: true },
  { id: 'pro', color: 'from-teal-600 to-cyan-700', border: 'border-teal-300 hover:border-teal-500', headerBg: 'bg-gradient-to-br from-teal-50 to-cyan-50', popular: false },
];

const SQ: Copy = {
  nav: { results: 'Rezultatet', process: 'Procesi', packages: 'Paketat', testimonials: 'Dëshmitë', faq: 'FAQ', login: 'Hyr', cta: 'Fillo Tani' },
  hero: { badge: '120+ qendra wellness na besojnë', h1a: 'Qendra jote e masazheve meriton', h1b: 'rezervime të plota', h1c: 'çdo javë.', h1d: 'A po ndodh kjo?',
    sub1: 'Çdo ditë njerëz kërkojnë "masazh afër meje" në Google dhe Instagram.', sub2: 'Pa SEO dhe pa prezencë profesionale, ata po zgjedhin konkurrencën.',
    ctaPrimary: 'Shiko Paketat', ctaSecondary: 'Konsultim Falas', t1: 'Pa kontratë afatgjatë', t2: 'Ad spend i veçantë', t3: 'SEO + Social Media në një' },
  pains: { kicker: 'A e njeh këtë situatë?', title1: 'Qendra po humb klientë', title2: 'çdo ditë',
    items: [
      { title: 'Nuk ju gjejnë në Google', desc: 'Klientët që kërkojnë "masazh [qyteti]" hasin konkurrencën tuaj — jo ju. Pa SEO, kalendarët mbeten gjysmë bosh.' },
      { title: 'Social media pa drejtim', desc: 'Postoni herë pas here foto trajtimesh pa strategji, pa estetikë vizuale, pa copy tërheqës — dhe rezervimet nuk vijnë.' },
      { title: 'Koha po humbet', desc: 'Ju jeni terapist, jo specialist marketingu. Çdo orë që shpenzoni duke u munduar me social media, humbisni klientë dhe relaksim.' },
    ], bridge1: 'Ndërkohë, qendrat me marketing profesional', bridge2: 'mbushin kalendarët me rezervime javore.' },
  results: { kicker: 'Rezultatet tona', title1: 'Numrat flasin', title2: 'vetë',
    items: [{ metric: '120', suffix: '+', label: 'Qendra wellness të promovuara' }, { metric: '78', suffix: '%', label: 'Klientë me rritje rezervimesh brenda 60 ditësh' }, { metric: '4.2', suffix: 'x', label: 'Rritje mesatare e vizitave nga Google' }, { metric: '95', suffix: '+', label: 'Biznese masazh & spa të kënaqur' }] },
  process: { kicker: 'Si punojmë', title1: 'Procesi ynë', title2: 'i provuar',
    steps: [
      { step: '01', title: 'Analiza & Strategjia', desc: 'Analizojmë qendrën, shërbimet, targetin dhe konkurrencën lokale. Hartojmë strategji dixhitale të personalizuar.' },
      { step: '02', title: 'SEO & Prezenca Google', desc: 'Optimizojmë website-in, Google Business Profile dhe fillojmë ndërtimin e autoritetit organik.' },
      { step: '03', title: 'Krijim Përmbajtjeje', desc: 'Xhirojmë trajtime, ambient, relaksim — kreojmë content që tregon përvojën e vërtetë të qendrës suaj.' },
      { step: '04', title: 'Reklama & Optimizim', desc: 'Lançojmë fushata Meta Ads me targeting të saktë. Monitorojmë, optimizojmë dhe raportojmë javore.' },
    ] },
  packages: { kicker: 'Çmimet tona', title1: 'Zgjidhni paketën', title2: 'e duhur', sub: 'Pa kontratë afatgjatë · Pagesë mujore · Ad spend i veçantë', idealFor: 'Ideal për:', notIncluded: 'Nuk përfshihet:', less: 'Shfaq më pak', moreCats: 'kategori tjera', savingsBadge: '🎁 Kurseni 100€/muaj', calloutA: '🌿 Paketa Essential kombinon SEO + Social Media me çmim special 800€/muaj', calloutB: '— kursen 100€ çdo muaj krahasuar me blerjen e tyre veças.',
    list: [
      { id: 'essential', title: 'Essential', subtitle: 'SEO + Social Media — gjithçka në një paketë', price: '800€', originalPrice: '900€', priceNote: '/ muaj + ad spend', popular: true, badge: 'Paketë Komplete', color: 'from-emerald-500 to-teal-600', border: '', headerBg: '', cta: 'Zgjidh Essential', targetAudience: ['Qendra masazhesh që duan klientë të rinj', 'Biznese wellness në rritje', 'Qendra me 2–5 terapistë'],
        features: [{ category: 'Social Media Management', items: ['Menaxhim Facebook + Instagram', '16 postime / muaj', '12 reels / muaj', 'Design grafik premium & copywriting', 'Publikim sipas kalendarit', '1 ditë xhirimi / muaj (trajtime, ambient)', 'Menaxhim bazë komentesh & inbox', 'Raport javor performance'] }, { category: 'Meta Ads', items: ['Menaxhim i plotë i Meta Ads', '2–3 fushata aktive', 'Targeting sipas moshës, gjinisë, zonës', 'Booking generation campaigns', 'Optimizim javor i fushatave'] }, { category: 'SEO & Google', items: ['Audit teknik i website-it', 'Keyword research (30 fjalë kyçe)', 'Optimizim On-page (faqet e trajtimeve)', 'Google Business Profile optimizim', '2 artikuj blog / muaj (wellness, masazh)', 'Raport mujor rankimesh Google'] }],
        notIncluded: ['Buxheti i reklamave (ad spend)', 'Xhirime shtesë jashtë ditës mujore', 'Video testimoniale', 'Website development'] },
      { id: 'pro', title: 'Pro', subtitle: 'Dominim i plotë i tregut dixhital', price: '1,400€', priceNote: '/ muaj + ad spend', badge: 'Maksimum Rezultate', color: 'from-teal-600 to-cyan-700', border: '', headerBg: '', cta: 'Zgjidh Pro', targetAudience: ['Qendra premium masazhesh', 'Spa & wellness resort', 'Zinxhirë me shumë lokacione'],
        features: [{ category: 'Social Media Management', items: ['Menaxhim FB + Instagram + TikTok', '24 postime / muaj', '20 reels / muaj', 'Design grafik premium', '2 ditë xhirimi / muaj', 'Video testimoniale klientësh', 'Ambient & relaksim content', 'Community management aktiv', 'Raportim javor + mujor i detajuar'] }, { category: 'Meta + Google Ads', items: ['Menaxhim i plotë Meta Ads', '4–6 fushata aktive', 'Retargeting & lookalike audiences', 'Google Search Ads', 'Booking & lead generation campaigns', 'A/B testing kreativësh', 'Optimizim i vazhdueshëm'] }, { category: 'SEO Avancuar', items: ['Audit teknik i plotë', 'Keyword research i avancuar (50+ fjalë)', 'Optimizim On-page + Off-page', 'Ndërtim backlinks (DR 30+)', '4 artikuj blog / muaj', 'Google Business Profile menaxhim aktiv', 'Raport mujor i detajuar + rekomandimet'] }],
        notIncluded: ['Buxheti i reklamave', 'Website development', 'Event coverage (ofrohet si add-on)'] },
    ] },
  addons: { kicker: 'Shtesa', title1: 'Shërbime', title2: 'shtesë', sub: 'Mund t\'i shtoni çdo muaj sipas nevojës suaj',
    items: [{ name: 'Reel shtesë / video ambient', price: '50€ – 80€' }, { name: 'Ditë ekstra xhirimi', price: '200€ – 350€' }, { name: 'Video testimonial klienti', price: '100€ – 180€' }, { name: 'Foto profesionale spa/ambient', price: '80€ – 150€' }, { name: 'Sezon kampanjë speciale', price: 'Sipas kërkesës' }, { name: 'Optimizim urgjent / montazh', price: 'Sipas kërkesës' }] },
  testimonials: { kicker: 'Dëshmitë', title1: 'Çfarë thonë', title2: 'klientët tanë',
    items: [{ name: 'Blerina Çela', role: 'Pronare, Zen Spa & Massage Center', quote: 'Brenda 45 ditëve, rezervimet u rritën me 60%. Google Business Profile tani ka 4.9 yje dhe klientët na gjejnë çdo ditë organikisht.', avatar: 'BC' }, { name: 'Artan Shehu', role: 'Drejtor, Serenity Wellness Tirana', quote: 'Kombinimi SEO + Social Media ka qenë investimi më i mirë. Kalendarët janë të plotë 3 javë para kohe. Nuk kemi nevojë të reklamojmë aq shpesh.', avatar: 'AS' }, { name: 'Mirela Hoxha', role: 'Terapiste, Relax Point Durrës', quote: 'Reels-et e trajtimeve janë me mijëra shikime. Klientë të rinj vijnë duke thënë "ju pashë në Instagram". Kjo paguan punën e tyre.', avatar: 'MH' }] },
  faq: { kicker: 'Pyetje të shpeshta', title1: 'Keni', title2: 'pyetje?',
    items: [
      { q: 'Çfarë përfshihet në çmimin 800€?', a: 'Çmimi 800€/muaj përfshin menaxhimin e plotë të Social Media (Facebook + Instagram, postime, reels, 1 ditë xhirimi, Meta Ads), plus SEO komplet (audit, keyword research, on-page optimization, Google Business Profile, 2 blog artikuj). Buxheti i reklamave (ad spend) është i veçantë dhe paguhet direkt tek Meta/Google.' },
      { q: 'Pse 800€ dhe jo 900€?', a: 'Kemi aplikuar zbritje promovuese prej 100€/muaj për qendrat e masazheve dhe wellness që regjistrohen gjatë kësaj periudhe. Çmimi i rregullt është 900€/muaj.' },
      { q: 'Sa kohë duhet për të parë rezultate nga SEO?', a: 'SEO është investim afatgjatë. Google Business Profile dhe optimizimet bazë fillojnë të japin rezultate brenda 30–60 ditëve. Rankimet organike ndërtohen brenda 3–6 muajve varësisht konkurrencës lokale.' },
      { q: 'Sa kohë duhet për rezultate nga Social Media & Ads?', a: 'Prezenca profesionale ndikon menjëherë në besueshmëri. Fushata Meta Ads për booking generation jep rezultate të para brenda 1–2 javëve pas lançimit.' },
      { q: 'A mund ta ndryshoj paketin?', a: 'Po. Mund të upgrade-oni ose ndryshoni paketin çdo muaj. Na njoftoni 7 ditë para fillimit të muajit të ri.' },
      { q: 'A punoni me zona jashtë Tiranës?', a: 'Po, punojmë me qendra masazhesh dhe wellness në të gjithë Shqipërinë dhe rajonin. Xhirimet bëhen me orar të dakorduar. Strategjia SEO dhe Social Media mund të menaxhohet plotësisht online.' },
      { q: 'A keni kontratë afatgjatë?', a: 'Jo. Punojmë me pagesa mujore pa kontratë afatgjatë. Klienti mund të ndërpresë në çdo kohë me njoftim 7 ditë para.' },
    ] },
  contact: { kicker: 'Na kontaktoni', title1: 'Filloni', title2: 'sot', sub: 'Konsultimi i parë është falas. Nuk kemi kontratë afatgjatë.', selected: 'Paketa e zgjedhur:', name: 'Emri & Mbiemri *', namePh: 'Emri juaj', email: 'Email *', emailPh: 'email@juaj.com', phone: 'Numri i telefonit *', phonePh: '+355 6X XXX XXXX', site: 'Website / Instagram', sitePh: 'website.com ose @instagram', message: 'Mesazhi (opsionale)', messagePh: 'Tregoni pak për qendrën tuaj, shërbimet dhe objektivat...', submit: 'Kërko Konsultim Falas', submitting: 'Duke dërguar...', trust: 'Pa kontratë afatgjatë · Pa spam · Do t\'ju kontaktojmë brenda 24 orëve', successTitle: 'Faleminderit! 🌿', successBody: 'E kemi marrë kërkesën tuaj. Do t\'ju kontaktojmë brenda 24 orëve për konsultimin falas.', error: 'Diçka shkoi keq. Provoni përsëri.' },
  footer: { rights: 'Të gjitha të drejtat e rezervuara.', login: 'Hyr', contact: 'Kontakt' },
};

const EN: Copy = {
  nav: { results: 'Results', process: 'Process', packages: 'Packages', testimonials: 'Testimonials', faq: 'FAQ', login: 'Login', cta: 'Get Started' },
  hero: { badge: '120+ wellness centers trust us', h1a: 'Your massage center deserves', h1b: 'a full schedule', h1c: 'every week.', h1d: 'Is that happening?',
    sub1: 'Every day people search "massage near me" on Google and Instagram.', sub2: 'Without SEO and a professional presence, they\'re choosing the competition.',
    ctaPrimary: 'See Packages', ctaSecondary: 'Free Consultation', t1: 'No long-term contract', t2: 'Ad spend separate', t3: 'SEO + Social Media in one' },
  pains: { kicker: 'Sound familiar?', title1: 'The center is losing clients', title2: 'every day',
    items: [
      { title: 'They can\'t find you on Google', desc: 'Clients searching "massage [city]" meet your competition — not you. Without SEO, the calendar stays half-empty.' },
      { title: 'Social media with no direction', desc: 'You post treatment photos now and then with no strategy, no visual aesthetic, no compelling copy — and the bookings don\'t come.' },
      { title: 'Time is being lost', desc: 'You\'re a therapist, not a marketing specialist. Every hour you spend struggling with social media, you lose clients and relaxation.' },
    ], bridge1: 'Meanwhile, centers with professional marketing', bridge2: 'fill their calendars with weekly bookings.' },
  results: { kicker: 'Our results', title1: 'The numbers speak', title2: 'for themselves',
    items: [{ metric: '120', suffix: '+', label: 'Wellness centers promoted' }, { metric: '78', suffix: '%', label: 'Clients with more bookings within 60 days' }, { metric: '4.2', suffix: 'x', label: 'Average growth in visits from Google' }, { metric: '95', suffix: '+', label: 'Happy massage & spa businesses' }] },
  process: { kicker: 'How we work', title1: 'Our proven', title2: 'process',
    steps: [
      { step: '01', title: 'Analysis & Strategy', desc: 'We analyze the center, services, target and local competition. We design a personalized digital strategy.' },
      { step: '02', title: 'SEO & Google Presence', desc: 'We optimize the website, Google Business Profile and start building organic authority.' },
      { step: '03', title: 'Content Creation', desc: 'We film treatments, ambiance, relaxation — we create content that shows the real experience of your center.' },
      { step: '04', title: 'Ads & Optimization', desc: 'We launch Meta Ads campaigns with precise targeting. We monitor, optimize and report weekly.' },
    ] },
  packages: { kicker: 'Our pricing', title1: 'Choose the right', title2: 'package', sub: 'No long-term contract · Monthly payment · Ad spend separate', idealFor: 'Ideal for:', notIncluded: 'Not included:', less: 'Show less', moreCats: 'more categories', savingsBadge: '🎁 Save €100/month', calloutA: '🌿 The Essential package combines SEO + Social Media at a special price of €800/month', calloutB: '— saving €100 every month compared to buying them separately.',
    list: [
      { id: 'essential', title: 'Essential', subtitle: 'SEO + Social Media — everything in one package', price: '€800', originalPrice: '€900', priceNote: '/ month + ad spend', popular: true, badge: 'Complete Package', color: 'from-emerald-500 to-teal-600', border: '', headerBg: '', cta: 'Choose Essential', targetAudience: ['Massage centers wanting new clients', 'Growing wellness businesses', 'Centers with 2–5 therapists'],
        features: [{ category: 'Social Media Management', items: ['Facebook + Instagram management', '16 posts / month', '12 reels / month', 'Premium graphic design & copywriting', 'Scheduled publishing', '1 shoot day / month (treatments, ambiance)', 'Basic comment & inbox management', 'Weekly performance report'] }, { category: 'Meta Ads', items: ['Full Meta Ads management', '2–3 active campaigns', 'Targeting by age, gender, area', 'Booking generation campaigns', 'Weekly campaign optimization'] }, { category: 'SEO & Google', items: ['Technical website audit', 'Keyword research (30 keywords)', 'On-page optimization (treatment pages)', 'Google Business Profile optimization', '2 blog articles / month (wellness, massage)', 'Monthly Google rankings report'] }],
        notIncluded: ['Ad budget (ad spend)', 'Extra shoots beyond the monthly day', 'Testimonial videos', 'Website development'] },
      { id: 'pro', title: 'Pro', subtitle: 'Total dominance of the digital market', price: '€1,400', priceNote: '/ month + ad spend', badge: 'Maximum Results', color: 'from-teal-600 to-cyan-700', border: '', headerBg: '', cta: 'Choose Pro', targetAudience: ['Premium massage centers', 'Spa & wellness resorts', 'Multi-location chains'],
        features: [{ category: 'Social Media Management', items: ['FB + Instagram + TikTok management', '24 posts / month', '20 reels / month', 'Premium graphic design', '2 shoot days / month', 'Client testimonial videos', 'Ambiance & relaxation content', 'Active community management', 'Detailed weekly + monthly reporting'] }, { category: 'Meta + Google Ads', items: ['Full Meta Ads management', '4–6 active campaigns', 'Retargeting & lookalike audiences', 'Google Search Ads', 'Booking & lead generation campaigns', 'Creative A/B testing', 'Continuous optimization'] }, { category: 'Advanced SEO', items: ['Full technical audit', 'Advanced keyword research (50+ keywords)', 'On-page + Off-page optimization', 'Backlink building (DR 30+)', '4 blog articles / month', 'Active Google Business Profile management', 'Detailed monthly report + recommendations'] }],
        notIncluded: ['Ad budget', 'Website development', 'Event coverage (offered as add-on)'] },
    ] },
  addons: { kicker: 'Add-ons', title1: 'Extra', title2: 'services', sub: 'You can add them every month as you need',
    items: [{ name: 'Extra reel / ambiance video', price: '€50 – €80' }, { name: 'Extra shoot day', price: '€200 – €350' }, { name: 'Client testimonial video', price: '€100 – €180' }, { name: 'Professional spa/ambiance photos', price: '€80 – €150' }, { name: 'Special seasonal campaign', price: 'On request' }, { name: 'Urgent optimization / editing', price: 'On request' }] },
  testimonials: { kicker: 'Testimonials', title1: 'What our', title2: 'clients say',
    items: [{ name: 'Blerina Çela', role: 'Owner, Zen Spa & Massage Center', quote: 'Within 45 days, bookings grew 60%. Our Google Business Profile now has 4.9 stars and clients find us organically every day.', avatar: 'BC' }, { name: 'Artan Shehu', role: 'Director, Serenity Wellness Tirana', quote: 'The SEO + Social Media combination has been the best investment. Calendars are full 3 weeks ahead. We don\'t need to advertise as often.', avatar: 'AS' }, { name: 'Mirela Hoxha', role: 'Therapist, Relax Point Durrës', quote: 'The treatment reels have thousands of views. New clients come saying "I saw you on Instagram". This pays for their work.', avatar: 'MH' }] },
  faq: { kicker: 'Frequently asked questions', title1: 'Have a', title2: 'question?',
    items: [
      { q: 'What is included in the €800 price?', a: 'The €800/month price includes full Social Media management (Facebook + Instagram, posts, reels, 1 shoot day, Meta Ads), plus complete SEO (audit, keyword research, on-page optimization, Google Business Profile, 2 blog articles). Ad spend is separate and paid directly to Meta/Google.' },
      { q: 'Why €800 and not €900?', a: 'We\'ve applied a promotional discount of €100/month for massage and wellness centers that sign up during this period. The regular price is €900/month.' },
      { q: 'How long until I see results from SEO?', a: 'SEO is a long-term investment. Google Business Profile and basic optimizations start showing results within 30–60 days. Organic rankings build within 3–6 months depending on local competition.' },
      { q: 'How long until results from Social Media & Ads?', a: 'A professional presence has an immediate impact on credibility. Meta Ads booking-generation campaigns deliver first results within 1–2 weeks of launch.' },
      { q: 'Can I change the package?', a: 'Yes. You can upgrade or change the package every month. Just notify us 7 days before the new month begins.' },
      { q: 'Do you work with areas outside Tirana?', a: 'Yes, we work with massage and wellness centers across Albania and the region. Shoots are scheduled by agreement. The SEO and Social Media strategy can be managed entirely online.' },
      { q: 'Do you have a long-term contract?', a: 'No. We work with monthly payments without a long-term contract. The client can stop at any time with 7 days\' notice.' },
    ] },
  contact: { kicker: 'Contact us', title1: 'Start', title2: 'today', sub: 'The first consultation is free. We have no long-term contract.', selected: 'Selected package:', name: 'Full name *', namePh: 'Your name', email: 'Email *', emailPh: 'email@you.com', phone: 'Phone number *', phonePh: '+39 3XX XXX XXXX', site: 'Website / Instagram', sitePh: 'website.com or @instagram', message: 'Message (optional)', messagePh: 'Tell us a bit about your center, services and goals...', submit: 'Request Free Consultation', submitting: 'Sending...', trust: 'No long-term contract · No spam · We\'ll contact you within 24 hours', successTitle: 'Thank you! 🌿', successBody: 'We\'ve received your request. We\'ll contact you within 24 hours for the free consultation.', error: 'Something went wrong. Please try again.' },
  footer: { rights: 'All rights reserved.', login: 'Login', contact: 'Contact' },
};

const IT: Copy = {
  nav: { results: 'Risultati', process: 'Processo', packages: 'Pacchetti', testimonials: 'Testimonianze', faq: 'FAQ', login: 'Accedi', cta: 'Inizia Ora' },
  hero: { badge: '120+ centri wellness si fidano di noi', h1a: 'Il tuo centro massaggi merita', h1b: 'un\'agenda piena', h1c: 'ogni settimana.', h1d: 'Sta succedendo?',
    sub1: 'Ogni giorno le persone cercano "massaggio vicino a me" su Google e Instagram.', sub2: 'Senza SEO e una presenza professionale, scelgono la concorrenza.',
    ctaPrimary: 'Vedi i Pacchetti', ctaSecondary: 'Consulenza Gratuita', t1: 'Nessun contratto a lungo termine', t2: 'Budget pubblicitario separato', t3: 'SEO + Social Media in uno' },
  pains: { kicker: 'Ti suona familiare?', title1: 'Il centro perde clienti', title2: 'ogni giorno',
    items: [
      { title: 'Non ti trovano su Google', desc: 'I clienti che cercano "massaggio [città]" incontrano la tua concorrenza — non te. Senza SEO, l\'agenda resta mezza vuota.' },
      { title: 'Social senza direzione', desc: 'Pubblichi foto dei trattamenti ogni tanto senza strategia, senza estetica visiva, senza testi efficaci — e le prenotazioni non arrivano.' },
      { title: 'Il tempo si perde', desc: 'Sei un terapista, non uno specialista di marketing. Ogni ora spesa a lottare con i social, perdi clienti e relax.' },
    ], bridge1: 'Nel frattempo, i centri con marketing professionale', bridge2: 'riempiono le agende con prenotazioni settimanali.' },
  results: { kicker: 'I nostri risultati', title1: 'I numeri parlano', title2: 'da soli',
    items: [{ metric: '120', suffix: '+', label: 'Centri wellness promossi' }, { metric: '78', suffix: '%', label: 'Clienti con più prenotazioni entro 60 giorni' }, { metric: '4.2', suffix: 'x', label: 'Crescita media delle visite da Google' }, { metric: '95', suffix: '+', label: 'Attività massaggi & spa soddisfatte' }] },
  process: { kicker: 'Come lavoriamo', title1: 'Il nostro processo', title2: 'collaudato',
    steps: [
      { step: '01', title: 'Analisi & Strategia', desc: 'Analizziamo il centro, i servizi, il target e la concorrenza locale. Progettiamo una strategia digitale personalizzata.' },
      { step: '02', title: 'SEO & Presenza Google', desc: 'Ottimizziamo il sito, il Google Business Profile e iniziamo a costruire autorevolezza organica.' },
      { step: '03', title: 'Creazione Contenuti', desc: 'Riprendiamo trattamenti, ambiente, relax — creiamo contenuti che mostrano la vera esperienza del tuo centro.' },
      { step: '04', title: 'Pubblicità & Ottimizzazione', desc: 'Lanciamo campagne Meta Ads con targeting preciso. Monitoriamo, ottimizziamo e riportiamo ogni settimana.' },
    ] },
  packages: { kicker: 'I nostri prezzi', title1: 'Scegli il pacchetto', title2: 'giusto', sub: 'Nessun contratto a lungo termine · Pagamento mensile · Budget pubblicitario separato', idealFor: 'Ideale per:', notIncluded: 'Non incluso:', less: 'Mostra meno', moreCats: 'altre categorie', savingsBadge: '🎁 Risparmia 100€/mese', calloutA: '🌿 Il pacchetto Essential combina SEO + Social Media a un prezzo speciale di 800€/mese', calloutB: '— risparmiando 100€ ogni mese rispetto all\'acquisto separato.',
    list: [
      { id: 'essential', title: 'Essential', subtitle: 'SEO + Social Media — tutto in un pacchetto', price: '800€', originalPrice: '900€', priceNote: '/ mese + ad spend', popular: true, badge: 'Pacchetto Completo', color: 'from-emerald-500 to-teal-600', border: '', headerBg: '', cta: 'Scegli Essential', targetAudience: ['Centri massaggi che vogliono nuovi clienti', 'Attività wellness in crescita', 'Centri con 2–5 terapisti'],
        features: [{ category: 'Social Media Management', items: ['Gestione Facebook + Instagram', '16 post / mese', '12 reels / mese', 'Grafica premium & copywriting', 'Pubblicazione programmata', '1 giorno di riprese / mese (trattamenti, ambiente)', 'Gestione base commenti & inbox', 'Report settimanale delle performance'] }, { category: 'Meta Ads', items: ['Gestione completa Meta Ads', '2–3 campagne attive', 'Targeting per età, genere, zona', 'Campagne di generazione prenotazioni', 'Ottimizzazione settimanale delle campagne'] }, { category: 'SEO & Google', items: ['Audit tecnico del sito', 'Ricerca parole chiave (30 keyword)', 'Ottimizzazione On-page (pagine trattamenti)', 'Ottimizzazione Google Business Profile', '2 articoli blog / mese (wellness, massaggi)', 'Report mensile dei posizionamenti Google'] }],
        notIncluded: ['Budget pubblicitario (ad spend)', 'Riprese extra oltre il giorno mensile', 'Video testimonianze', 'Sviluppo sito web'] },
      { id: 'pro', title: 'Pro', subtitle: 'Dominio totale del mercato digitale', price: '1.400€', priceNote: '/ mese + ad spend', badge: 'Massimi Risultati', color: 'from-teal-600 to-cyan-700', border: '', headerBg: '', cta: 'Scegli Pro', targetAudience: ['Centri massaggi premium', 'Spa & wellness resort', 'Catene multi-sede'],
        features: [{ category: 'Social Media Management', items: ['Gestione FB + Instagram + TikTok', '24 post / mese', '20 reels / mese', 'Grafica premium', '2 giorni di riprese / mese', 'Video testimonianze dei clienti', 'Contenuti ambiente & relax', 'Community management attivo', 'Report settimanale + mensile dettagliato'] }, { category: 'Meta + Google Ads', items: ['Gestione completa Meta Ads', '4–6 campagne attive', 'Retargeting & lookalike audiences', 'Google Search Ads', 'Campagne di prenotazione & lead generation', 'A/B testing dei creativi', 'Ottimizzazione continua'] }, { category: 'SEO Avanzata', items: ['Audit tecnico completo', 'Ricerca parole chiave avanzata (50+ keyword)', 'Ottimizzazione On-page + Off-page', 'Costruzione backlink (DR 30+)', '4 articoli blog / mese', 'Gestione attiva Google Business Profile', 'Report mensile dettagliato + raccomandazioni'] }],
        notIncluded: ['Budget pubblicitario', 'Sviluppo sito web', 'Copertura eventi (offerta come extra)'] },
    ] },
  addons: { kicker: 'Extra', title1: 'Servizi', title2: 'aggiuntivi', sub: 'Puoi aggiungerli ogni mese secondo le tue esigenze',
    items: [{ name: 'Reel extra / video ambiente', price: '50€ – 80€' }, { name: 'Giorno di ripresa extra', price: '200€ – 350€' }, { name: 'Video testimonianza cliente', price: '100€ – 180€' }, { name: 'Foto professionali spa/ambiente', price: '80€ – 150€' }, { name: 'Campagna stagionale speciale', price: 'Su richiesta' }, { name: 'Ottimizzazione urgente / montaggio', price: 'Su richiesta' }] },
  testimonials: { kicker: 'Testimonianze', title1: 'Cosa dicono', title2: 'i nostri clienti',
    items: [{ name: 'Blerina Çela', role: 'Titolare, Zen Spa & Massage Center', quote: 'In 45 giorni le prenotazioni sono cresciute del 60%. Il nostro Google Business Profile ora ha 4.9 stelle e i clienti ci trovano ogni giorno in modo organico.', avatar: 'BC' }, { name: 'Artan Shehu', role: 'Direttore, Serenity Wellness Tirana', quote: 'La combinazione SEO + Social Media è stata il miglior investimento. Le agende sono piene con 3 settimane di anticipo. Non dobbiamo fare pubblicità così spesso.', avatar: 'AS' }, { name: 'Mirela Hoxha', role: 'Terapista, Relax Point Durrës', quote: 'I reel dei trattamenti hanno migliaia di visualizzazioni. Nuovi clienti arrivano dicendo "ti ho visto su Instagram". Questo ripaga il loro lavoro.', avatar: 'MH' }] },
  faq: { kicker: 'Domande frequenti', title1: 'Hai una', title2: 'domanda?',
    items: [
      { q: 'Cosa è incluso nel prezzo di 800€?', a: 'Il prezzo di 800€/mese include la gestione completa dei Social Media (Facebook + Instagram, post, reels, 1 giorno di riprese, Meta Ads), più SEO completa (audit, ricerca parole chiave, ottimizzazione on-page, Google Business Profile, 2 articoli blog). Il budget pubblicitario è separato e si paga direttamente a Meta/Google.' },
      { q: 'Perché 800€ e non 900€?', a: 'Abbiamo applicato uno sconto promozionale di 100€/mese per i centri massaggi e wellness che si registrano in questo periodo. Il prezzo regolare è 900€/mese.' },
      { q: 'Quanto tempo per vedere risultati dalla SEO?', a: 'La SEO è un investimento a lungo termine. Il Google Business Profile e le ottimizzazioni base iniziano a dare risultati entro 30–60 giorni. I posizionamenti organici si costruiscono in 3–6 mesi a seconda della concorrenza locale.' },
      { q: 'Quanto tempo per i risultati da Social Media & Ads?', a: 'Una presenza professionale ha un impatto immediato sulla credibilità. Le campagne Meta Ads di generazione prenotazioni danno i primi risultati entro 1–2 settimane dal lancio.' },
      { q: 'Posso cambiare il pacchetto?', a: 'Sì. Puoi fare upgrade o cambiare il pacchetto ogni mese. Avvisaci 7 giorni prima dell\'inizio del nuovo mese.' },
      { q: 'Lavorate con zone fuori Tirana?', a: 'Sì, lavoriamo con centri massaggi e wellness in tutta l\'Albania e nella regione. Le riprese si concordano. La strategia SEO e Social Media può essere gestita interamente online.' },
      { q: 'Avete un contratto a lungo termine?', a: 'No. Lavoriamo con pagamenti mensili senza contratto a lungo termine. Il cliente può interrompere in qualsiasi momento con 7 giorni di preavviso.' },
    ] },
  contact: { kicker: 'Contattaci', title1: 'Inizia', title2: 'oggi', sub: 'La prima consulenza è gratuita. Non abbiamo contratti a lungo termine.', selected: 'Pacchetto selezionato:', name: 'Nome e Cognome *', namePh: 'Il tuo nome', email: 'Email *', emailPh: 'email@tua.com', phone: 'Numero di telefono *', phonePh: '+39 3XX XXX XXXX', site: 'Sito / Instagram', sitePh: 'sito.com o @instagram', message: 'Messaggio (opzionale)', messagePh: 'Raccontaci del tuo centro, dei servizi e degli obiettivi...', submit: 'Richiedi Consulenza Gratuita', submitting: 'Invio in corso...', trust: 'Nessun contratto a lungo termine · Niente spam · Ti contatteremo entro 24 ore', successTitle: 'Grazie! 🌿', successBody: 'Abbiamo ricevuto la tua richiesta. Ti contatteremo entro 24 ore per la consulenza gratuita.', error: 'Qualcosa è andato storto. Riprova.' },
  footer: { rights: 'Tutti i diritti riservati.', login: 'Accedi', contact: 'Contatti' },
};

const COPY: Record<Lang, Copy> = { sq: SQ, en: EN, it: IT };

export default function MassageLandingPage() {
  const [lang, setLang] = useLandingLang();
  const t = COPY[lang];
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', website: '', message: '' });
  const [formSent, setFormSent] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<Pkg | null>(null);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const scrollToPackages = () => document.getElementById('packages')?.scrollIntoView({ behavior: 'smooth' });
  const scrollToContact = (pkg?: Pkg) => { if (pkg) setSelectedPackage(pkg); document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormError(''); setSubmitting(true);
    try {
      const res = await fetch('/api/landing', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, packageId: selectedPackage?.id || 'essential', packageName: selectedPackage ? `Masazh ${selectedPackage.title}` : 'Masazh Essential', source: 'Masazh Landing Page', category: 'SEO + Social Media - Masazh', message: `[${lang.toUpperCase()}] ${formData.message}` }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.contact.error);
      setFormSent(true);
    } catch (err: any) { setFormError(err.message || t.contact.error); } finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans overflow-x-hidden">
      <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center"><Leaf className="w-4 h-4 text-white" /></div>
            <span className="text-xl font-bold bg-gradient-to-r from-teal-600 to-emerald-600 bg-clip-text text-transparent">FivoCRM Wellness</span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-gray-600">
            <a href="#results" className="hover:text-teal-600 transition-colors">{t.nav.results}</a>
            <a href="#process" className="hover:text-teal-600 transition-colors">{t.nav.process}</a>
            <a href="#packages" className="hover:text-teal-600 transition-colors">{t.nav.packages}</a>
            <a href="#testimonials" className="hover:text-teal-600 transition-colors">{t.nav.testimonials}</a>
            <a href="#faq" className="hover:text-teal-600 transition-colors">{t.nav.faq}</a>
          </div>
          <div className="flex items-center gap-3">
            <LangSwitcher lang={lang} setLang={setLang} accentClass="bg-teal-600" />
            <button onClick={() => scrollToContact()} className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-teal-500 to-emerald-600 hover:shadow-lg hover:shadow-teal-500/25 transition-all hover:-translate-y-0.5">{t.nav.cta}</button>
            <LandingMobileMenu
              links={[
                { href: '#results', label: t.nav.results },
                { href: '#process', label: t.nav.process },
                { href: '#packages', label: t.nav.packages },
                { href: '#testimonials', label: t.nav.testimonials },
                { href: '#faq', label: t.nav.faq },
              ]}
              ctaLabel={t.nav.cta}
              onCta={() => scrollToContact()}
              accentClass="bg-gradient-to-r from-teal-500 to-emerald-600"
            />
          </div>
        </div>
      </nav>

      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-teal-50/70 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[700px] h-[700px] bg-teal-200/25 rounded-full blur-3xl" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal-50 border border-teal-100 mb-8">
                <div className="flex -space-x-2">{['BC', 'AS', 'MH', 'EK'].map((ini, i) => (<div key={i} className="w-7 h-7 rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 border-2 border-white flex items-center justify-center text-[10px] font-bold text-white">{ini}</div>))}</div>
                <span className="text-sm font-medium text-teal-700">{t.hero.badge}</span>
                <div className="flex">{[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}</div>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                {t.hero.h1a}{' '}<span className="bg-gradient-to-r from-teal-600 via-emerald-500 to-cyan-500 bg-clip-text text-transparent">{t.hero.h1b}</span>{' '}{t.hero.h1c}
                <br /><span className="text-gray-400">{t.hero.h1d}</span>
              </h1>
            </FadeIn>
            <FadeIn delay={200}><p className="mt-8 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">{t.hero.sub1} <strong className="text-teal-600">{t.hero.sub2}</strong></p></FadeIn>
            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button onClick={scrollToPackages} className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-teal-500 to-emerald-600 hover:shadow-xl hover:shadow-teal-500/25 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">{t.hero.ctaPrimary}<ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></button>
                <button onClick={() => scrollToContact()} className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border-2 border-gray-200 hover:border-teal-300 hover:bg-teal-50 transition-all flex items-center justify-center gap-2"><Phone className="w-5 h-5" />{t.hero.ctaSecondary}</button>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-400">
                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-500" /> {t.hero.t1}</span>
                <span className="flex items-center gap-1.5"><Lock className="w-4 h-4 text-blue-500" /> {t.hero.t2}</span>
                <span className="flex items-center gap-1.5"><Wind className="w-4 h-4 text-teal-500" /> {t.hero.t3}</span>
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
          <FadeIn delay={500}><div className="mt-12 text-center"><p className="text-lg text-gray-700 font-medium">{t.pains.bridge1} <span className="text-teal-600 font-bold">{t.pains.bridge2}</span></p></div></FadeIn>
        </div>
      </section>

      <section id="results" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-teal-600 mb-3">{t.results.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.results.title1} <span className="bg-gradient-to-r from-teal-600 to-emerald-600 bg-clip-text text-transparent">{t.results.title2}</span></h2></div></FadeIn>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {t.results.items.map((r, i) => { const Icon = RESULT_ICONS[i]; return (
              <FadeIn key={i} delay={i * 100}><div className="text-center p-8 rounded-2xl bg-gradient-to-br from-teal-50 to-emerald-50 border border-teal-100"><div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center mx-auto mb-4"><Icon className="w-6 h-6 text-white" /></div><div className="text-4xl font-bold text-teal-700 mb-2"><Counter end={parseFloat(r.metric)} suffix={r.suffix} /></div><p className="text-sm text-gray-600 leading-tight">{r.label}</p></div></FadeIn>); })}
          </div>
        </div>
      </section>

      <section id="process" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-teal-600 mb-3">{t.process.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.process.title1} <span className="bg-gradient-to-r from-teal-600 to-emerald-600 bg-clip-text text-transparent">{t.process.title2}</span></h2></div></FadeIn>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {t.process.steps.map((step, i) => { const Icon = PROCESS_ICONS[i]; return (
              <FadeIn key={i} delay={i * 150}><div className="relative bg-white rounded-2xl p-8 shadow-sm border border-gray-100 hover:shadow-lg hover:border-teal-200 transition-all h-full"><div className="text-6xl font-black text-teal-100 mb-4">{step.step}</div><div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center mb-4"><Icon className="w-6 h-6 text-white" /></div><h3 className="text-lg font-bold mb-2">{step.title}</h3><p className="text-gray-600 text-sm leading-relaxed">{step.desc}</p></div></FadeIn>); })}
          </div>
        </div>
      </section>

      <section id="packages" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-4"><p className="text-sm font-semibold uppercase tracking-widest text-teal-600 mb-3">{t.packages.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.packages.title1} <span className="bg-gradient-to-r from-teal-600 to-emerald-600 bg-clip-text text-transparent">{t.packages.title2}</span></h2><p className="mt-4 text-gray-500 max-w-xl mx-auto">{t.packages.sub}</p></div></FadeIn>
          <div className="grid lg:grid-cols-2 gap-8 mt-12 max-w-5xl mx-auto">
            {t.packages.list.map((pkg, i) => {
              const style = PKG_STYLES[i]; const isExpanded = expandedCard === pkg.id;
              return (
                <FadeIn key={pkg.id} delay={i * 150}>
                  <div className={`relative rounded-2xl border-2 transition-all flex flex-col ${style.border} ${style.popular ? 'shadow-2xl shadow-teal-500/20 scale-[1.02]' : 'shadow-sm hover:shadow-xl'}`}>
                    {style.popular && (<div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10"><span className="px-5 py-1.5 rounded-full text-sm font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-600 shadow-lg shadow-teal-500/30">⭐ {pkg.badge}</span></div>)}
                    {!style.popular && pkg.badge && (<div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10"><span className="px-5 py-1.5 rounded-full text-sm font-bold text-white bg-gradient-to-r from-teal-600 to-cyan-700 shadow-lg">{pkg.badge}</span></div>)}
                    <div className={`${style.headerBg} rounded-t-2xl p-6 pt-8`}>
                      <h3 className="text-2xl font-bold text-gray-900">{pkg.title}</h3>
                      <p className="text-sm text-gray-600 mt-1">{pkg.subtitle}</p>
                      <div className="mt-4 flex items-end gap-2"><span className={`text-4xl font-black bg-gradient-to-r ${style.color} bg-clip-text text-transparent`}>{pkg.price}</span>{pkg.originalPrice && (<span className="text-xl font-medium text-gray-400 line-through mb-1">{pkg.originalPrice}</span>)}</div>
                      <p className="text-sm text-gray-500 mt-1">{pkg.priceNote}</p>
                      {pkg.originalPrice && (<div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 border border-emerald-200"><span className="text-xs font-bold text-emerald-700">{t.packages.savingsBadge}</span></div>)}
                    </div>
                    <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{t.packages.idealFor}</p>
                      <ul className="space-y-1">{pkg.targetAudience.map((a, idx) => (<li key={idx} className="flex items-center gap-2 text-sm text-gray-700"><CheckCircle2 className="w-3.5 h-3.5 text-teal-500 flex-shrink-0" />{a}</li>))}</ul>
                    </div>
                    <div className="flex-1 px-6 py-5 space-y-5">
                      {(isExpanded ? pkg.features : pkg.features.slice(0, 2)).map((cat, ci) => (
                        <div key={ci}><p className={`text-xs font-bold uppercase tracking-wide mb-2 bg-gradient-to-r ${style.color} bg-clip-text text-transparent`}>{cat.category}</p><ul className="space-y-1.5">{cat.items.map((item, ii) => (<li key={ii} className="flex items-start gap-2 text-sm text-gray-700"><CheckCircle2 className="w-3.5 h-3.5 text-teal-500 flex-shrink-0 mt-0.5" />{item}</li>))}</ul></div>
                      ))}
                      {pkg.features.length > 2 && (<button onClick={() => setExpandedCard(isExpanded ? null : pkg.id)} className="text-sm text-teal-600 font-medium flex items-center gap-1 hover:text-teal-700"><ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />{isExpanded ? t.packages.less : `+ ${pkg.features.length - 2} ${t.packages.moreCats}`}</button>)}
                      {pkg.notIncluded.length > 0 && (<div><p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">{t.packages.notIncluded}</p><ul className="space-y-1.5">{pkg.notIncluded.map((item, ii) => (<li key={ii} className="flex items-start gap-2 text-sm text-gray-400"><X className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{item}</li>))}</ul></div>)}
                    </div>
                    <div className="px-6 pb-6">
                      <button onClick={() => scrollToContact(pkg)} className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${style.popular ? `text-white bg-gradient-to-r ${style.color} hover:shadow-lg hover:shadow-teal-500/25 hover:-translate-y-0.5` : 'text-gray-700 bg-gray-100 hover:bg-gray-200'}`}>{pkg.cta}<ArrowRight className="w-4 h-4" /></button>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>
          <FadeIn delay={400}><div className="mt-10 max-w-2xl mx-auto text-center p-6 rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200"><p className="text-emerald-800 font-semibold">{t.packages.calloutA} <span className="text-gray-500 line-through">900€</span> {t.packages.calloutB}</p></div></FadeIn>
        </div>
      </section>

      <section id="addons" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-12"><p className="text-sm font-semibold uppercase tracking-widest text-teal-600 mb-3">{t.addons.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.addons.title1} <span className="bg-gradient-to-r from-teal-600 to-emerald-600 bg-clip-text text-transparent">{t.addons.title2}</span></h2><p className="mt-3 text-gray-500">{t.addons.sub}</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {t.addons.items.map((addon, i) => { const Icon = ADDON_ICONS[i]; return (
              <FadeIn key={i} delay={i * 80}><div className="bg-white rounded-2xl p-6 border border-gray-100 hover:border-teal-200 hover:shadow-lg transition-all flex items-center gap-4"><div className="w-12 h-12 rounded-xl bg-teal-50 flex items-center justify-center flex-shrink-0"><Icon className="w-6 h-6 text-teal-600" /></div><div><p className="font-semibold text-gray-900">{addon.name}</p><p className="text-sm text-teal-600 font-medium mt-0.5">{addon.price}</p></div></div></FadeIn>); })}
          </div>
        </div>
      </section>

      <section id="testimonials" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-teal-600 mb-3">{t.testimonials.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.testimonials.title1} <span className="bg-gradient-to-r from-teal-600 to-emerald-600 bg-clip-text text-transparent">{t.testimonials.title2}</span></h2></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {t.testimonials.items.map((tm, i) => (
              <FadeIn key={i} delay={i * 150}><div className="bg-gradient-to-br from-teal-50 to-emerald-50 rounded-2xl p-8 border border-teal-100 hover:shadow-lg hover:border-teal-200 transition-all h-full flex flex-col"><div className="flex mb-4">{[1,2,3,4,5].map(j => (<Star key={j} className="w-5 h-5 text-amber-400 fill-amber-400" />))}</div><p className="text-gray-700 leading-relaxed flex-1 italic">"{tm.quote}"</p><div className="mt-6 flex items-center gap-3"><div className="w-11 h-11 rounded-full bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">{tm.avatar}</div><div><p className="font-bold text-gray-900">{tm.name}</p><p className="text-sm text-gray-500">{tm.role}</p></div></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="py-20 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-teal-600 mb-3">{t.faq.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.faq.title1} <span className="bg-gradient-to-r from-teal-600 to-emerald-600 bg-clip-text text-transparent">{t.faq.title2}</span></h2></div></FadeIn>
          <div className="space-y-3">
            {t.faq.items.map((item, i) => (
              <FadeIn key={i} delay={i * 60}><div className="bg-white rounded-2xl border border-gray-100 overflow-hidden hover:border-teal-200 transition-colors"><button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full px-6 py-5 flex items-center justify-between text-left"><span className="font-semibold text-gray-900 pr-4">{item.q}</span><ChevronDown className={`w-5 h-5 text-teal-500 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} /></button>{openFaq === i && (<div className="px-6 pb-5"><p className="text-gray-600 leading-relaxed">{item.a}</p></div>)}</div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className="py-20 bg-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6">
          <FadeIn><div className="text-center mb-12"><p className="text-sm font-semibold uppercase tracking-widest text-teal-600 mb-3">{t.contact.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.contact.title1} <span className="bg-gradient-to-r from-teal-600 to-emerald-600 bg-clip-text text-transparent">{t.contact.title2}</span></h2><p className="mt-4 text-gray-500">{t.contact.sub}</p></div></FadeIn>
          {selectedPackage && (
            <FadeIn>
              <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-teal-50 to-emerald-50 border border-teal-200 flex items-center justify-between">
                <div><p className="text-sm text-gray-500">{t.contact.selected}</p><p className="font-bold text-teal-700">{selectedPackage.title} — {selectedPackage.price}{selectedPackage.originalPrice && <span className="text-gray-400 line-through ml-2 font-normal">{selectedPackage.originalPrice}</span>}</p></div>
                <button onClick={() => setSelectedPackage(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
              </div>
            </FadeIn>
          )}
          {formSent ? (
            <FadeIn><div className="text-center p-12 rounded-2xl bg-gradient-to-br from-teal-50 to-emerald-50 border border-teal-200"><div className="w-20 h-20 rounded-full bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-teal-500/30"><CheckCircle2 className="w-10 h-10 text-white" /></div><h3 className="text-2xl font-bold text-gray-900 mb-3">{t.contact.successTitle}</h3><p className="text-gray-600 text-lg">{t.contact.successBody}</p></div></FadeIn>
          ) : (
            <FadeIn>
              <form onSubmit={handleSubmit} className="space-y-5 bg-gray-50 rounded-2xl p-8 border border-gray-100">
                <div className="grid sm:grid-cols-2 gap-5">
                  <div><label className="block text-sm font-medium text-gray-700 mb-1.5">{t.contact.name}</label><input type="text" required value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} placeholder={t.contact.namePh} className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1.5">{t.contact.email}</label><input type="email" required value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} placeholder={t.contact.emailPh} className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all" /></div>
                </div>
                <div className="grid sm:grid-cols-2 gap-5">
                  <div><label className="block text-sm font-medium text-gray-700 mb-1.5">{t.contact.phone}</label><input type="tel" required value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} placeholder={t.contact.phonePh} className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1.5">{t.contact.site}</label><input type="text" value={formData.website} onChange={e => setFormData(p => ({ ...p, website: e.target.value }))} placeholder={t.contact.sitePh} className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all" /></div>
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">{t.contact.message}</label><textarea rows={4} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} placeholder={t.contact.messagePh} className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all resize-none" /></div>
                {formError && (<div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{formError}</div>)}
                <button type="submit" disabled={submitting} className="w-full py-4 px-8 rounded-xl font-semibold text-white bg-gradient-to-r from-teal-500 to-emerald-600 hover:shadow-xl hover:shadow-teal-500/25 transition-all hover:-translate-y-0.5 disabled:opacity-60 flex items-center justify-center gap-2 text-lg">{submitting ? (<><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t.contact.submitting}</>) : (<>{t.contact.submit}<ArrowRight className="w-5 h-5" /></>)}</button>
                <p className="text-center text-xs text-gray-400"><Shield className="w-3.5 h-3.5 inline mr-1" />{t.contact.trust}</p>
              </form>
            </FadeIn>
          )}
        </div>
      </section>

      <footer className="py-10 bg-gray-900 text-gray-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center"><Leaf className="w-4 h-4 text-white" /></div><span className="text-white font-bold">FivoCRM Wellness</span></div>
            <p className="text-sm">© {new Date().getFullYear()} FivoCRM. {t.footer.rights}</p>
            <div className="flex items-center gap-4 text-sm"><Link to="/login" className="hover:text-white transition-colors">{t.footer.login}</Link><a href="#contact" className="hover:text-white transition-colors">{t.footer.contact}</a></div>
          </div>
        </div>
      </footer>
    </div>
  );
}
