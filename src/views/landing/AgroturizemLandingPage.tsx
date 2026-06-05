import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, TrendingUp, Shield, CheckCircle2, ArrowRight,
  Star, Users, Target, Clock, ChevronDown, Phone,
  Camera, Megaphone, BarChart3,
  X, Search, Globe, Sun, Trees,
} from 'lucide-react';
import { LangSwitcher, type Lang } from './LangSwitcher';

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

interface Pkg { id: string; title: string; subtitle: string; price: string; originalPrice?: string; priceNote: string; popular?: boolean; badge?: string; color: string; cta: string; targetAudience: string[]; features: { category: string; items: string[] }[]; notIncluded: string[]; }
interface Copy {
  nav: { results: string; process: string; packages: string; testimonials: string; faq: string; login: string; cta: string };
  hero: { badge: string; h1a: string; h1b: string; h1c: string; sub1: string; sub2: string; ctaPrimary: string; ctaSecondary: string; t1: string; t2: string; t3: string };
  pains: { kicker: string; title1: string; title2: string; items: { title: string; desc: string }[]; bridge1: string; bridge2: string };
  results: { kicker: string; title1: string; title2: string; items: { metric: string; suffix: string; label: string }[] };
  process: { kicker: string; title1: string; title2: string; steps: { step: string; title: string; desc: string }[] };
  packages: { kicker: string; title1: string; title2: string; subA: string; subB: string; photoHighlight: string; idealFor: string; notIncluded: string; less: string; moreCats: string; savingsBadge: string; calloutA: string; calloutB: string; list: Pkg[] };
  addons: { kicker: string; title1: string; title2: string; sub: string; items: { name: string; price: string }[] };
  testimonials: { kicker: string; title1: string; title2: string; items: { name: string; role: string; quote: string; avatar: string }[] };
  faq: { kicker: string; title1: string; title2: string; items: { q: string; a: string }[] };
  contact: { kicker: string; title1: string; title2: string; sub: string; selected: string; name: string; namePh: string; email: string; emailPh: string; phone: string; phonePh: string; site: string; sitePh: string; message: string; messagePh: string; submit: string; submitting: string; trust: string; successTitle: string; successBody: string; error: string };
  footer: { rights: string; login: string; contact: string };
}

const ADDON_ICONS = [Camera, Camera, Star, Sparkles, Megaphone, Globe];
const RESULT_ICONS = [Trees, Target, TrendingUp, Users];
const PAIN_ICONS = [Globe, Camera, Clock];
const PROCESS_ICONS = [Target, Camera, Search, BarChart3];
const PKG_STYLES = [
  { id: 'starter', color: 'from-amber-500 to-lime-600', border: 'border-amber-300 hover:border-amber-500', headerBg: 'bg-gradient-to-br from-amber-50 to-lime-50', popular: false },
  { id: 'growth', color: 'from-emerald-500 to-green-600', border: 'border-emerald-300 hover:border-emerald-500', headerBg: 'bg-gradient-to-br from-emerald-50 to-green-50', popular: true },
  { id: 'pro', color: 'from-green-700 to-emerald-800', border: 'border-green-400 hover:border-green-600', headerBg: 'bg-gradient-to-br from-green-50 to-emerald-50', popular: false },
];

const SQ: Copy = {
  nav: { results: 'Rezultatet', process: 'Procesi', packages: 'Paketat', testimonials: 'Dëshmitë', faq: 'FAQ', login: 'Hyr', cta: 'Fillo Tani' },
  hero: { badge: '85+ agroturizme na besojnë', h1a: 'Restoranti yt meriton', h1b: 'të jetë plot', h1c: '.', sub1: 'Turistët kërkojnë "agroturizëm Shqipëri" çdo ditë në Google dhe Instagram.', sub2: 'Pa foto profesionale dhe pa SEO, ata po zgjedhin fermat e tjera.',
    ctaPrimary: 'Shiko Paketat', ctaSecondary: 'Konsultim Falas', t1: '2 fotoshooting / muaj', t2: 'Pa kontratë afatgjatë', t3: 'SEO + Social Media në një' },
  pains: { kicker: 'A e njeh këtë situatë?', title1: 'Sezoni po kalon —', title2: 'dhoma janë bosh',
    items: [
      { title: 'Turistët nuk ju gjejnë online', desc: 'Turistët kërkojnë "agroturizëm Shqipëri" ose "ferma për fundjavë", por website-i juaj nuk del në Google. Konkurrenca i merr rezervimet që duhej të ishin tuajat.' },
      { title: 'Foto amatore nuk ja arrijnë emocionit', desc: 'Bukuria e fermës, natyra, ushqimi tradicional, atmosfera familjare — të gjitha humbasin në foto të bëra me telefon. Pa foto profesionale, mysafirët nuk e ndjejnë magjinë.' },
      { title: 'Sezoni i shkurtër — koha po humbet', desc: 'Pranvera, vera dhe vjeshta janë sezonet tuaja. Çdo javë pa marketing profesional është dhoma bosh, është ushqim që mbetet, është mundësi e humbur.' },
    ], bridge1: 'Ndërkohë, agroturizmet me marketing profesional', bridge2: 'i mbushin dhomat 3 muaj para sezonit.' },
  results: { kicker: 'Rezultatet tona', title1: 'Numrat flasin', title2: 'vetë',
    items: [{ metric: '85', suffix: '+', label: 'Agroturizme të promovuara në Shqipëri' }, { metric: '72', suffix: '%', label: 'Klientë me rritje rezervimesh brenda 90 ditësh' }, { metric: '5.1', suffix: 'x', label: 'Rritje mesatare e vizitave organike Google' }, { metric: '60', suffix: '+', label: 'Ferma & bujtina me brand të fortë dixhital' }] },
  process: { kicker: 'Si punojmë', title1: 'Procesi ynë', title2: 'i provuar',
    steps: [
      { step: '01', title: 'Analiza & Strategjia', desc: 'Vizitojmë fermën, kuptojmë identitetin, shërbimet, mysafirët ideal dhe konkurrencën. Hartojmë strategji dixhitale autentike.' },
      { step: '02', title: '2 Fotoshooting / Muaj', desc: 'Dy ditë në muaj me ekipin profesional — ambient, dhoma, restorant, aktivitete, peizazhe. Foto për gjithë sezonin.' },
      { step: '03', title: 'SEO & Prezenca Google', desc: 'Optimizojmë website-in, Google Business Profile, Booking.com, TripAdvisor. Ndërtojmë autoritet organik për fjalët kyçe të agroturizmit.' },
      { step: '04', title: 'Reklama & Optimizim', desc: 'Lançojmë fushata Meta & Google Ads të targetuara për turistë vendas dhe ndërkombëtarë. Monitorojmë, optimizojmë, raportojmë çdo javë.' },
    ] },
  packages: { kicker: 'Çmimet tona', title1: 'Zgjidhni paketën', title2: 'e duhur', subA: 'Të 3 paketat përfshijnë', subB: '2 fotoshooting profesionale çdo muaj · Pa kontratë afatgjatë · Ad spend i veçantë', photoHighlight: '2 Fotoshooting Profesionale / Muaj', idealFor: 'Ideal për:', notIncluded: 'Nuk përfshihet:', less: 'Shfaq më pak', moreCats: 'kategori tjera', savingsBadge: '🎁 Kurseni 200€/muaj', calloutA: 'Të 3 paketat përfshijnë', calloutB: '2 ditë fotoshooting profesionale çdo muaj — ambient, dhoma, restorant, aktivitete & peizazhe.',
    list: [
      { id: 'starter', title: 'Starter', subtitle: 'Hyrje në botën dixhitale për agroturizmin tuaj', price: '800€', priceNote: '/ muaj + ad spend', badge: 'Për të Filluar', color: 'from-amber-500 to-lime-600', cta: 'Zgjidh Starter', targetAudience: ['Agroturizme të reja që duan vizibilitet online', 'Ferma të vogla familjare', 'Bujtina rurale me kapacitet të vogël'],
        features: [{ category: '📸 Fotoshooting Profesionale', items: ['2 ditë fotoshooting në muaj', 'Foto profesionale të ambientit & natyrës', 'Foto të dhomave, restorantit & aktiviteteve', 'Editim & retush profesional', 'Të drejtat e plota mbi materialet'] }, { category: 'Social Media Management', items: ['Menaxhim Facebook + Instagram', '12 postime / muaj', '8 reels / muaj', 'Design grafik & copywriting në shqip/anglisht', 'Publikim sipas kalendarit sezonal', 'Raport mujor performance'] }, { category: 'SEO & Google', items: ['Audit teknik i website-it', 'Google Business Profile optimizim', 'Keyword research (20 fjalë kyçe agroturizëm)', 'Optimizim On-page', '1 artikull blog / muaj (kulturë, tradita, ushqim)'] }],
        notIncluded: ['Buxheti i reklamave (ad spend)', 'Meta & Google Ads', 'Video drone aeriale', 'Website development'] },
      { id: 'growth', title: 'Growth', subtitle: 'SEO + Social Media + Ads — paketa më e kërkuar', price: '1,300€', originalPrice: '1,500€', priceNote: '/ muaj + ad spend', popular: true, badge: 'Më e Popullarizuara', color: 'from-emerald-500 to-green-600', cta: 'Zgjidh Growth', targetAudience: ['Agroturizme në rritje me kapacitet mesatar', 'Ferma me restorant & dhoma akomodimi', 'Bujtina me 5–15 dhoma'],
        features: [{ category: '📸 Fotoshooting Profesionale', items: ['2 ditë fotoshooting në muaj', 'Foto premium ambient, dhoma, restorant', 'Foto aktivitete (verë, ulli, mjaltë, hipur kalit)', 'Stagione: pranverë, verë, vjeshtë', 'Foto food styling & gastronomi tradicionale', 'Editim premium & retush avancuar', 'Bibliotekë e plotë mediash për përdorim afatgjatë'] }, { category: 'Social Media Management', items: ['Menaxhim FB + Instagram', '20 postime / muaj', '16 reels / muaj', 'Story të përditshme & highlights', 'Community management aktiv', 'Bashkëpunime me influencerë lokalë', 'Raport javor + mujor i detajuar'] }, { category: 'Meta Ads', items: ['Menaxhim i plotë i Meta Ads', '3–4 fushata aktive', 'Targeting turistë vendas + të huaj', 'Booking & enquiry campaigns', 'Optimizim javor i fushatave'] }, { category: 'SEO Avancuar', items: ['Audit i plotë teknik & off-page', 'Keyword research (40+ fjalë: "agroturizëm Shqipëri", etj.)', 'Optimizim On-page i plotë', 'Google Business Profile menaxhim aktiv', '2 artikuj blog / muaj', 'Lokalizim për Booking.com & TripAdvisor'] }],
        notIncluded: ['Buxheti i reklamave', 'Video drone aeriale (add-on)', 'Website development'] },
      { id: 'pro', title: 'Pro', subtitle: 'Dominim i plotë i tregut turistik dixhital', price: '2,000€', priceNote: '/ muaj + ad spend', badge: 'Maksimum Rezultate', color: 'from-green-700 to-emerald-800', cta: 'Zgjidh Pro', targetAudience: ['Agroturizme premium me brand të fortë', 'Resort rurale & estate vinifikimi', 'Destinacione me 15+ dhoma & event hosting'],
        features: [{ category: '📸 Fotoshooting Profesionale', items: ['2 ditë fotoshooting në muaj', 'Foto + Video premium me drone aerial', 'Filmime kinematike të peizazheve', 'Video testimoniale të mysafirëve', 'Brand storytelling visual', 'Stilist profesional për food & ambient', 'Galeri komplete sezonale për website & social'] }, { category: 'Social Media Management', items: ['Menaxhim FB + Instagram + TikTok + YouTube', '30 postime / muaj', '24 reels / muaj', 'Video kinematike mujore', 'Bashkëpunime me influencerë ndërkombëtarë', 'Strategji brand & content kalendarik vjetor', 'Community management premium', 'Raportim javor + mujor i thelluar'] }, { category: 'Meta + Google Ads', items: ['Menaxhim i plotë Meta Ads', '5–7 fushata aktive (vendas + ndërkombëtar)', 'Google Search Ads & Display', 'YouTube Ads (video kinematike)', 'Retargeting & lookalike audiences', 'A/B testing kreativësh', 'Optimizim ditor i fushatave'] }, { category: 'SEO Premium', items: ['Audit teknik dhe off-page premium', 'Keyword research (80+ fjalë multilingual)', 'Optimizim multilingual (SQ / EN / IT)', 'Ndërtim backlinks (DR 40+)', '4 artikuj blog / muaj', 'Booking.com / Airbnb / TripAdvisor optimizim', 'Raport mujor strategjik'] }],
        notIncluded: ['Buxheti i reklamave', 'Website development (ofrohet si projekt veçmas)'] },
    ] },
  addons: { kicker: 'Shtesa', title1: 'Shërbime', title2: 'shtesë', sub: 'Mund t\'i shtoni çdo muaj sipas nevojës suaj',
    items: [{ name: 'Ditë ekstra fotoshooting', price: '250€ – 400€' }, { name: 'Video drone aerial', price: '300€ – 500€' }, { name: 'Video testimonial mysafirësh', price: '120€ – 200€' }, { name: 'Food styling shoot', price: '150€ – 280€' }, { name: 'Fushatë sezonale speciale', price: 'Sipas kërkesës' }, { name: 'Përkthim multilingual content', price: '80€ – 150€' }] },
  testimonials: { kicker: 'Dëshmitë', title1: 'Çfarë thonë', title2: 'klientët tanë',
    items: [{ name: 'Petrit Domi', role: 'Pronar, Agroturizëm Domi — Berat', quote: 'Fotot e bëra nga ekipi i tyre na kanë ndryshuar imazhin krejtësisht. Mysafirët na thonë "ju pashë në Instagram dhe nuk mund të mos vija". Sezoni 2026 është i rezervuar 80% qysh në Maj.', avatar: 'PD' }, { name: 'Albana Krasniqi', role: 'Menaxhere, Bujtinë Krasniqi — Theth', quote: 'Brenda 4 muajsh, rezervimet nga turistët e huaj u rritën 3-fish. Google na rendit në faqen e parë për "agroturizëm Theth". Investimi më i mirë që kemi bërë ndonjëherë.', avatar: 'AK' }, { name: 'Bardhyl Hoxha', role: 'Pronar, Estate Vinifikimi Cobo — Berat', quote: '2 fotoshooting në muaj është shumë. Kemi material për reels, postime, broshura, website. Brand-i ynë duket si i një resort 5-yje, megjithëse jemi ferma familjare.', avatar: 'BH' }] },
  faq: { kicker: 'Pyetje të shpeshta', title1: 'Keni', title2: 'pyetje?',
    items: [
      { q: 'Çfarë përfshihet vërtet në "2 fotoshooting / muaj"?', a: 'Çdo muaj ekipi ynë vjen dy ditë në fermën tuaj. Bëjmë foto profesionale të ambientit, dhomave, restorantit, aktiviteteve, ushqimit dhe peizazheve. Pas editimit, ju merrni 60–120 foto premium me të drejta të plota përdorimi — për website, social media, broshura ose reklama. Stagionet ndryshojnë: pranverë, verë, vjeshtë — kemi material për çdo sezon.' },
      { q: 'A vijnë në fermë edhe nëse jemi në fshat të largët?', a: 'Po. Punojmë me agroturizme në të gjithë Shqipërinë — Theth, Valbonë, Berat, Përmet, Korçë, Lezhë e gjetkë. Transporti i ekipit përfshihet në paketë për distancat normale. Për zona shumë të largëta, mund të ketë shtesë të vogël transporti që ju njoftohet paraprakisht.' },
      { q: 'Çfarë ndryshimi ka mes Starter, Growth dhe Pro?', a: 'Të treja kanë 2 fotoshooting / muaj. Starter është për ferma të vogla familjare që duan praninë online. Growth shton Meta Ads, më shumë postime dhe sezone të plota fotoshooting. Pro shton video drone aerial, kinemati, fushata Google Ads, përmbajtje multilingual dhe targetim ndërkombëtar.' },
      { q: 'Sa kohë duhet për të parë rezultate?', a: 'Social Media dhe fotot profesionale ndikojnë menjëherë në besueshmëri dhe rezervime. Meta Ads japin rezultate brenda 1–2 javëve. SEO dhe rankimet organike Google ndërtohen brenda 3–6 muajve, varësisht konkurrencës. Sezonin tuaj të parë me ne, prisni rritje 40–80% të rezervimeve.' },
      { q: 'A flisni gjuhë të huaja për turistët ndërkombëtarë?', a: 'Po. Në paketat Growth dhe Pro përfshihet copywriting në anglisht. Pro shton edhe italisht (turisti më i shpeshtë në Shqipëri). Përkthime në gjuhë të tjera ofrohen si shtesë.' },
      { q: 'A keni kontratë afatgjatë?', a: 'Jo. Punojmë me pagesa mujore pa kontratë afatgjatë. Mund ta ndërpresni në çdo kohë me njoftim 7 ditë para. Megjithatë, rekomandojmë minimum 3 muaj për të parë rezultate të vërteta sezonale.' },
      { q: 'A mund ta ndryshoj paketin gjatë sezonit?', a: 'Po. Mund të upgrade-oni në çdo kohë (p.sh. nga Starter në Growth para sezonit të verës). Downgrade lejohet me njoftim 7 ditë para fillimit të muajit të ri.' },
    ] },
  contact: { kicker: 'Na kontaktoni', title1: 'Filloni', title2: 'sot', sub: 'Konsultimi i parë është falas. Nuk kemi kontratë afatgjatë.', selected: 'Paketa e zgjedhur:', name: 'Emri & Mbiemri *', namePh: 'Emri juaj', email: 'Email *', emailPh: 'email@juaj.com', phone: 'Numri i telefonit *', phonePh: '+355 6X XXX XXXX', site: 'Website / Instagram', sitePh: 'website.com ose @instagram', message: 'Mesazhi (opsionale)', messagePh: 'Tregoni pak për fermën tuaj, shërbimet, kapacitetin & objektivat...', submit: 'Kërko Konsultim Falas', submitting: 'Duke dërguar...', trust: 'Pa kontratë afatgjatë · Pa spam · Do t\'ju kontaktojmë brenda 24 orëve', successTitle: 'Faleminderit! 🌾', successBody: 'E kemi marrë kërkesën tuaj. Do t\'ju kontaktojmë brenda 24 orëve për konsultimin falas.', error: 'Diçka shkoi keq. Provoni përsëri.' },
  footer: { rights: 'Të gjitha të drejtat e rezervuara.', login: 'Hyr', contact: 'Kontakt' },
};

const EN: Copy = {
  nav: { results: 'Results', process: 'Process', packages: 'Packages', testimonials: 'Testimonials', faq: 'FAQ', login: 'Login', cta: 'Get Started' },
  hero: { badge: '85+ agritourisms trust us', h1a: 'Your farm restaurant deserves', h1b: 'to be full', h1c: '.', sub1: 'Tourists search "agritourism Albania" every day on Google and Instagram.', sub2: 'Without professional photos and SEO, they\'re choosing the other farms.',
    ctaPrimary: 'See Packages', ctaSecondary: 'Free Consultation', t1: '2 photoshoots / month', t2: 'No long-term contract', t3: 'SEO + Social Media in one' },
  pains: { kicker: 'Sound familiar?', title1: 'The season is passing —', title2: 'rooms are empty',
    items: [
      { title: 'Tourists can\'t find you online', desc: 'Tourists search "agritourism Albania" or "farm for the weekend", but your website doesn\'t show on Google. The competition takes the bookings that should have been yours.' },
      { title: 'Amateur photos don\'t convey the emotion', desc: 'The beauty of the farm, nature, traditional food, the family atmosphere — all lost in phone photos. Without professional photos, guests don\'t feel the magic.' },
      { title: 'Short season — time is being lost', desc: 'Spring, summer and autumn are your seasons. Every week without professional marketing is an empty room, food going to waste, a lost opportunity.' },
    ], bridge1: 'Meanwhile, agritourisms with professional marketing', bridge2: 'fill their rooms 3 months before the season.' },
  results: { kicker: 'Our results', title1: 'The numbers speak', title2: 'for themselves',
    items: [{ metric: '85', suffix: '+', label: 'Agritourisms promoted in Albania' }, { metric: '72', suffix: '%', label: 'Clients with more bookings within 90 days' }, { metric: '5.1', suffix: 'x', label: 'Average growth in organic Google visits' }, { metric: '60', suffix: '+', label: 'Farms & guesthouses with a strong digital brand' }] },
  process: { kicker: 'How we work', title1: 'Our proven', title2: 'process',
    steps: [
      { step: '01', title: 'Analysis & Strategy', desc: 'We visit the farm, understand its identity, services, ideal guests and competition. We design an authentic digital strategy.' },
      { step: '02', title: '2 Photoshoots / Month', desc: 'Two days a month with the professional team — ambiance, rooms, restaurant, activities, landscapes. Photos for the whole season.' },
      { step: '03', title: 'SEO & Google Presence', desc: 'We optimize the website, Google Business Profile, Booking.com, TripAdvisor. We build organic authority for agritourism keywords.' },
      { step: '04', title: 'Ads & Optimization', desc: 'We launch Meta & Google Ads campaigns targeted at local and international tourists. We monitor, optimize and report weekly.' },
    ] },
  packages: { kicker: 'Our pricing', title1: 'Choose the right', title2: 'package', subA: 'All 3 packages include', subB: '2 professional photoshoots every month · No long-term contract · Ad spend separate', photoHighlight: '2 Professional Photoshoots / Month', idealFor: 'Ideal for:', notIncluded: 'Not included:', less: 'Show less', moreCats: 'more categories', savingsBadge: '🎁 Save €200/month', calloutA: 'All 3 packages include', calloutB: '2 days of professional photoshoots every month — ambiance, rooms, restaurant, activities & landscapes.',
    list: [
      { id: 'starter', title: 'Starter', subtitle: 'An entry into the digital world for your agritourism', price: '€800', priceNote: '/ month + ad spend', badge: 'To Get Started', color: 'from-amber-500 to-lime-600', cta: 'Choose Starter', targetAudience: ['New agritourisms wanting online visibility', 'Small family farms', 'Rural guesthouses with small capacity'],
        features: [{ category: '📸 Professional Photoshoots', items: ['2 photoshoot days per month', 'Professional photos of the setting & nature', 'Photos of rooms, restaurant & activities', 'Professional editing & retouching', 'Full rights to the materials'] }, { category: 'Social Media Management', items: ['Facebook + Instagram management', '12 posts / month', '8 reels / month', 'Graphic design & copywriting in Albanian/English', 'Publishing by seasonal calendar', 'Monthly performance report'] }, { category: 'SEO & Google', items: ['Technical website audit', 'Google Business Profile optimization', 'Keyword research (20 agritourism keywords)', 'On-page optimization', '1 blog article / month (culture, traditions, food)'] }],
        notIncluded: ['Ad budget (ad spend)', 'Meta & Google Ads', 'Aerial drone video', 'Website development'] },
      { id: 'growth', title: 'Growth', subtitle: 'SEO + Social Media + Ads — the most requested package', price: '€1,300', originalPrice: '€1,500', priceNote: '/ month + ad spend', popular: true, badge: 'Most Popular', color: 'from-emerald-500 to-green-600', cta: 'Choose Growth', targetAudience: ['Growing agritourisms with medium capacity', 'Farms with restaurant & accommodation', 'Guesthouses with 5–15 rooms'],
        features: [{ category: '📸 Professional Photoshoots', items: ['2 photoshoot days per month', 'Premium photos of ambiance, rooms, restaurant', 'Activity photos (harvest, olives, honey, horse riding)', 'Seasons: spring, summer, autumn', 'Food styling & traditional gastronomy photos', 'Premium editing & advanced retouching', 'Full media library for long-term use'] }, { category: 'Social Media Management', items: ['FB + Instagram management', '20 posts / month', '16 reels / month', 'Daily stories & highlights', 'Active community management', 'Collaborations with local influencers', 'Detailed weekly + monthly report'] }, { category: 'Meta Ads', items: ['Full Meta Ads management', '3–4 active campaigns', 'Targeting local + foreign tourists', 'Booking & enquiry campaigns', 'Weekly campaign optimization'] }, { category: 'Advanced SEO', items: ['Full technical & off-page audit', 'Keyword research (40+ keywords: "agritourism Albania", etc.)', 'Full on-page optimization', 'Active Google Business Profile management', '2 blog articles / month', 'Localization for Booking.com & TripAdvisor'] }],
        notIncluded: ['Ad budget', 'Aerial drone video (add-on)', 'Website development'] },
      { id: 'pro', title: 'Pro', subtitle: 'Total dominance of the digital tourism market', price: '€2,000', priceNote: '/ month + ad spend', badge: 'Maximum Results', color: 'from-green-700 to-emerald-800', cta: 'Choose Pro', targetAudience: ['Premium agritourisms with a strong brand', 'Rural resorts & wine estates', 'Destinations with 15+ rooms & event hosting'],
        features: [{ category: '📸 Professional Photoshoots', items: ['2 photoshoot days per month', 'Premium photo + video with aerial drone', 'Cinematic landscape footage', 'Guest testimonial videos', 'Visual brand storytelling', 'Professional stylist for food & ambiance', 'Complete seasonal gallery for website & social'] }, { category: 'Social Media Management', items: ['FB + Instagram + TikTok + YouTube management', '30 posts / month', '24 reels / month', 'Monthly cinematic video', 'Collaborations with international influencers', 'Brand strategy & annual content calendar', 'Premium community management', 'In-depth weekly + monthly reporting'] }, { category: 'Meta + Google Ads', items: ['Full Meta Ads management', '5–7 active campaigns (local + international)', 'Google Search Ads & Display', 'YouTube Ads (cinematic video)', 'Retargeting & lookalike audiences', 'Creative A/B testing', 'Daily campaign optimization'] }, { category: 'Premium SEO', items: ['Premium technical and off-page audit', 'Keyword research (80+ multilingual keywords)', 'Multilingual optimization (SQ / EN / IT)', 'Backlink building (DR 40+)', '4 blog articles / month', 'Booking.com / Airbnb / TripAdvisor optimization', 'Strategic monthly report'] }],
        notIncluded: ['Ad budget', 'Website development (offered as a separate project)'] },
    ] },
  addons: { kicker: 'Add-ons', title1: 'Extra', title2: 'services', sub: 'You can add them every month as you need',
    items: [{ name: 'Extra photoshoot day', price: '€250 – €400' }, { name: 'Aerial drone video', price: '€300 – €500' }, { name: 'Guest testimonial video', price: '€120 – €200' }, { name: 'Food styling shoot', price: '€150 – €280' }, { name: 'Special seasonal campaign', price: 'On request' }, { name: 'Multilingual content translation', price: '€80 – €150' }] },
  testimonials: { kicker: 'Testimonials', title1: 'What our', title2: 'clients say',
    items: [{ name: 'Petrit Domi', role: 'Owner, Agritourism Domi — Berat', quote: 'The photos taken by their team completely changed our image. Guests tell us "I saw you on Instagram and couldn\'t not come". The 2026 season is 80% booked already in May.', avatar: 'PD' }, { name: 'Albana Krasniqi', role: 'Manager, Guesthouse Krasniqi — Theth', quote: 'Within 4 months, bookings from foreign tourists tripled. Google ranks us on the first page for "agritourism Theth". The best investment we\'ve ever made.', avatar: 'AK' }, { name: 'Bardhyl Hoxha', role: 'Owner, Cobo Wine Estate — Berat', quote: '2 photoshoots a month is a lot. We have material for reels, posts, brochures, website. Our brand looks like a 5-star resort, even though we\'re a family farm.', avatar: 'BH' }] },
  faq: { kicker: 'Frequently asked questions', title1: 'Have a', title2: 'question?',
    items: [
      { q: 'What is really included in "2 photoshoots / month"?', a: 'Every month our team comes to your farm for two days. We take professional photos of the setting, rooms, restaurant, activities, food and landscapes. After editing, you receive 60–120 premium photos with full usage rights — for website, social media, brochures or ads. The seasons change: spring, summer, autumn — we have material for every season.' },
      { q: 'Do you come to the farm even if we\'re in a remote village?', a: 'Yes. We work with agritourisms across Albania — Theth, Valbona, Berat, Përmet, Korçë, Lezhë and elsewhere. Team transport is included in the package for normal distances. For very remote areas, there may be a small transport surcharge that\'s communicated in advance.' },
      { q: 'What\'s the difference between Starter, Growth and Pro?', a: 'All three have 2 photoshoots / month. Starter is for small family farms wanting an online presence. Growth adds Meta Ads, more posts and full seasonal photoshoots. Pro adds aerial drone video, cinematics, Google Ads campaigns, multilingual content and international targeting.' },
      { q: 'How long until I see results?', a: 'Social Media and professional photos immediately impact credibility and bookings. Meta Ads deliver results within 1–2 weeks. SEO and organic Google rankings build within 3–6 months, depending on competition. In your first season with us, expect a 40–80% increase in bookings.' },
      { q: 'Do you speak foreign languages for international tourists?', a: 'Yes. The Growth and Pro packages include copywriting in English. Pro also adds Italian (the most frequent tourist in Albania). Translations into other languages are offered as an add-on.' },
      { q: 'Do you have a long-term contract?', a: 'No. We work with monthly payments without a long-term contract. You can stop at any time with 7 days\' notice. However, we recommend a minimum of 3 months to see real seasonal results.' },
      { q: 'Can I change the package during the season?', a: 'Yes. You can upgrade at any time (e.g. from Starter to Growth before the summer season). Downgrades are allowed with 7 days\' notice before the new month begins.' },
    ] },
  contact: { kicker: 'Contact us', title1: 'Start', title2: 'today', sub: 'The first consultation is free. We have no long-term contract.', selected: 'Selected package:', name: 'Full name *', namePh: 'Your name', email: 'Email *', emailPh: 'email@you.com', phone: 'Phone number *', phonePh: '+39 3XX XXX XXXX', site: 'Website / Instagram', sitePh: 'website.com or @instagram', message: 'Message (optional)', messagePh: 'Tell us a bit about your farm, services, capacity & goals...', submit: 'Request Free Consultation', submitting: 'Sending...', trust: 'No long-term contract · No spam · We\'ll contact you within 24 hours', successTitle: 'Thank you! 🌾', successBody: 'We\'ve received your request. We\'ll contact you within 24 hours for the free consultation.', error: 'Something went wrong. Please try again.' },
  footer: { rights: 'All rights reserved.', login: 'Login', contact: 'Contact' },
};

const IT: Copy = {
  nav: { results: 'Risultati', process: 'Processo', packages: 'Pacchetti', testimonials: 'Testimonianze', faq: 'FAQ', login: 'Accedi', cta: 'Inizia Ora' },
  hero: { badge: '85+ agriturismi si fidano di noi', h1a: 'Il tuo agriturismo merita', h1b: 'di essere pieno', h1c: '.', sub1: 'I turisti cercano "agriturismo Albania" ogni giorno su Google e Instagram.', sub2: 'Senza foto professionali e senza SEO, scelgono gli altri agriturismi.',
    ctaPrimary: 'Vedi i Pacchetti', ctaSecondary: 'Consulenza Gratuita', t1: '2 servizi fotografici / mese', t2: 'Nessun contratto a lungo termine', t3: 'SEO + Social Media in uno' },
  pains: { kicker: 'Ti suona familiare?', title1: 'La stagione passa —', title2: 'le camere sono vuote',
    items: [
      { title: 'I turisti non ti trovano online', desc: 'I turisti cercano "agriturismo Albania" o "fattoria per il weekend", ma il tuo sito non appare su Google. La concorrenza si prende le prenotazioni che dovevano essere tue.' },
      { title: 'Le foto amatoriali non trasmettono l\'emozione', desc: 'La bellezza della fattoria, la natura, il cibo tradizionale, l\'atmosfera familiare — tutto si perde in foto fatte col telefono. Senza foto professionali, gli ospiti non sentono la magia.' },
      { title: 'Stagione breve — il tempo si perde', desc: 'Primavera, estate e autunno sono le tue stagioni. Ogni settimana senza marketing professionale è una camera vuota, cibo che resta, un\'opportunità persa.' },
    ], bridge1: 'Nel frattempo, gli agriturismi con marketing professionale', bridge2: 'riempiono le camere 3 mesi prima della stagione.' },
  results: { kicker: 'I nostri risultati', title1: 'I numeri parlano', title2: 'da soli',
    items: [{ metric: '85', suffix: '+', label: 'Agriturismi promossi in Albania' }, { metric: '72', suffix: '%', label: 'Clienti con più prenotazioni entro 90 giorni' }, { metric: '5.1', suffix: 'x', label: 'Crescita media delle visite organiche da Google' }, { metric: '60', suffix: '+', label: 'Fattorie & agriturismi con un brand digitale forte' }] },
  process: { kicker: 'Come lavoriamo', title1: 'Il nostro processo', title2: 'collaudato',
    steps: [
      { step: '01', title: 'Analisi & Strategia', desc: 'Visitiamo la fattoria, comprendiamo l\'identità, i servizi, gli ospiti ideali e la concorrenza. Progettiamo una strategia digitale autentica.' },
      { step: '02', title: '2 Servizi Fotografici / Mese', desc: 'Due giorni al mese con il team professionale — ambiente, camere, ristorante, attività, paesaggi. Foto per tutta la stagione.' },
      { step: '03', title: 'SEO & Presenza Google', desc: 'Ottimizziamo il sito, il Google Business Profile, Booking.com, TripAdvisor. Costruiamo autorevolezza organica per le parole chiave dell\'agriturismo.' },
      { step: '04', title: 'Pubblicità & Ottimizzazione', desc: 'Lanciamo campagne Meta & Google Ads mirate a turisti locali e internazionali. Monitoriamo, ottimizziamo e riportiamo ogni settimana.' },
    ] },
  packages: { kicker: 'I nostri prezzi', title1: 'Scegli il pacchetto', title2: 'giusto', subA: 'Tutti e 3 i pacchetti includono', subB: '2 servizi fotografici professionali al mese · Nessun contratto a lungo termine · Budget pubblicitario separato', photoHighlight: '2 Servizi Fotografici Professionali / Mese', idealFor: 'Ideale per:', notIncluded: 'Non incluso:', less: 'Mostra meno', moreCats: 'altre categorie', savingsBadge: '🎁 Risparmia 200€/mese', calloutA: 'Tutti e 3 i pacchetti includono', calloutB: '2 giorni di servizi fotografici professionali al mese — ambiente, camere, ristorante, attività & paesaggi.',
    list: [
      { id: 'starter', title: 'Starter', subtitle: 'Un ingresso nel mondo digitale per il tuo agriturismo', price: '800€', priceNote: '/ mese + ad spend', badge: 'Per Iniziare', color: 'from-amber-500 to-lime-600', cta: 'Scegli Starter', targetAudience: ['Nuovi agriturismi che vogliono visibilità online', 'Piccole fattorie familiari', 'Agriturismi rurali di piccola capacità'],
        features: [{ category: '📸 Servizi Fotografici Professionali', items: ['2 giorni di riprese al mese', 'Foto professionali dell\'ambiente & della natura', 'Foto di camere, ristorante & attività', 'Editing & ritocco professionale', 'Diritti completi sui materiali'] }, { category: 'Social Media Management', items: ['Gestione Facebook + Instagram', '12 post / mese', '8 reels / mese', 'Grafica & copywriting in albanese/inglese', 'Pubblicazione su calendario stagionale', 'Report mensile delle performance'] }, { category: 'SEO & Google', items: ['Audit tecnico del sito', 'Ottimizzazione Google Business Profile', 'Ricerca parole chiave (20 keyword agriturismo)', 'Ottimizzazione On-page', '1 articolo blog / mese (cultura, tradizioni, cibo)'] }],
        notIncluded: ['Budget pubblicitario (ad spend)', 'Meta & Google Ads', 'Video drone aereo', 'Sviluppo sito web'] },
      { id: 'growth', title: 'Growth', subtitle: 'SEO + Social Media + Ads — il pacchetto più richiesto', price: '1.300€', originalPrice: '1.500€', priceNote: '/ mese + ad spend', popular: true, badge: 'Più Popolare', color: 'from-emerald-500 to-green-600', cta: 'Scegli Growth', targetAudience: ['Agriturismi in crescita di media capacità', 'Fattorie con ristorante & camere', 'Agriturismi con 5–15 camere'],
        features: [{ category: '📸 Servizi Fotografici Professionali', items: ['2 giorni di riprese al mese', 'Foto premium di ambiente, camere, ristorante', 'Foto attività (vendemmia, olive, miele, equitazione)', 'Stagioni: primavera, estate, autunno', 'Foto food styling & gastronomia tradizionale', 'Editing premium & ritocco avanzato', 'Libreria completa di media per uso a lungo termine'] }, { category: 'Social Media Management', items: ['Gestione FB + Instagram', '20 post / mese', '16 reels / mese', 'Storie giornaliere & highlights', 'Community management attivo', 'Collaborazioni con influencer locali', 'Report settimanale + mensile dettagliato'] }, { category: 'Meta Ads', items: ['Gestione completa Meta Ads', '3–4 campagne attive', 'Targeting turisti locali + stranieri', 'Campagne di prenotazione & richiesta', 'Ottimizzazione settimanale delle campagne'] }, { category: 'SEO Avanzata', items: ['Audit tecnico & off-page completo', 'Ricerca parole chiave (40+ keyword: "agriturismo Albania", ecc.)', 'Ottimizzazione On-page completa', 'Gestione attiva Google Business Profile', '2 articoli blog / mese', 'Localizzazione per Booking.com & TripAdvisor'] }],
        notIncluded: ['Budget pubblicitario', 'Video drone aereo (extra)', 'Sviluppo sito web'] },
      { id: 'pro', title: 'Pro', subtitle: 'Dominio totale del mercato turistico digitale', price: '2.000€', priceNote: '/ mese + ad spend', badge: 'Massimi Risultati', color: 'from-green-700 to-emerald-800', cta: 'Scegli Pro', targetAudience: ['Agriturismi premium con un brand forte', 'Resort rurali & tenute vinicole', 'Destinazioni con 15+ camere & hosting eventi'],
        features: [{ category: '📸 Servizi Fotografici Professionali', items: ['2 giorni di riprese al mese', 'Foto + Video premium con drone aereo', 'Riprese cinematografiche dei paesaggi', 'Video testimonianze degli ospiti', 'Brand storytelling visivo', 'Stylist professionale per food & ambiente', 'Galleria stagionale completa per sito & social'] }, { category: 'Social Media Management', items: ['Gestione FB + Instagram + TikTok + YouTube', '30 post / mese', '24 reels / mese', 'Video cinematografico mensile', 'Collaborazioni con influencer internazionali', 'Strategia brand & calendario contenuti annuale', 'Community management premium', 'Reporting settimanale + mensile approfondito'] }, { category: 'Meta + Google Ads', items: ['Gestione completa Meta Ads', '5–7 campagne attive (locale + internazionale)', 'Google Search Ads & Display', 'YouTube Ads (video cinematografico)', 'Retargeting & lookalike audiences', 'A/B testing dei creativi', 'Ottimizzazione giornaliera delle campagne'] }, { category: 'SEO Premium', items: ['Audit tecnico e off-page premium', 'Ricerca parole chiave (80+ keyword multilingua)', 'Ottimizzazione multilingua (SQ / EN / IT)', 'Costruzione backlink (DR 40+)', '4 articoli blog / mese', 'Ottimizzazione Booking.com / Airbnb / TripAdvisor', 'Report mensile strategico'] }],
        notIncluded: ['Budget pubblicitario', 'Sviluppo sito web (offerto come progetto separato)'] },
    ] },
  addons: { kicker: 'Extra', title1: 'Servizi', title2: 'aggiuntivi', sub: 'Puoi aggiungerli ogni mese secondo le tue esigenze',
    items: [{ name: 'Giorno di riprese extra', price: '250€ – 400€' }, { name: 'Video drone aereo', price: '300€ – 500€' }, { name: 'Video testimonianza ospiti', price: '120€ – 200€' }, { name: 'Servizio food styling', price: '150€ – 280€' }, { name: 'Campagna stagionale speciale', price: 'Su richiesta' }, { name: 'Traduzione contenuti multilingua', price: '80€ – 150€' }] },
  testimonials: { kicker: 'Testimonianze', title1: 'Cosa dicono', title2: 'i nostri clienti',
    items: [{ name: 'Petrit Domi', role: 'Titolare, Agriturismo Domi — Berat', quote: 'Le foto realizzate dal loro team hanno cambiato completamente la nostra immagine. Gli ospiti ci dicono "ti ho visto su Instagram e non potevo non venire". La stagione 2026 è già prenotata all\'80% a maggio.', avatar: 'PD' }, { name: 'Albana Krasniqi', role: 'Manager, Agriturismo Krasniqi — Theth', quote: 'In 4 mesi, le prenotazioni dai turisti stranieri sono triplicate. Google ci posiziona in prima pagina per "agriturismo Theth". Il miglior investimento che abbiamo mai fatto.', avatar: 'AK' }, { name: 'Bardhyl Hoxha', role: 'Titolare, Tenuta Vinicola Cobo — Berat', quote: '2 servizi fotografici al mese sono tanti. Abbiamo materiale per reels, post, brochure, sito. Il nostro brand sembra quello di un resort a 5 stelle, anche se siamo una fattoria familiare.', avatar: 'BH' }] },
  faq: { kicker: 'Domande frequenti', title1: 'Hai una', title2: 'domanda?',
    items: [
      { q: 'Cosa è incluso davvero in "2 servizi fotografici / mese"?', a: 'Ogni mese il nostro team viene due giorni nella tua fattoria. Realizziamo foto professionali dell\'ambiente, delle camere, del ristorante, delle attività, del cibo e dei paesaggi. Dopo l\'editing, ricevi 60–120 foto premium con diritti d\'uso completi — per sito, social, brochure o pubblicità. Le stagioni cambiano: primavera, estate, autunno — abbiamo materiale per ogni stagione.' },
      { q: 'Venite in fattoria anche se siamo in un villaggio remoto?', a: 'Sì. Lavoriamo con agriturismi in tutta l\'Albania — Theth, Valbona, Berat, Përmet, Korçë, Lezhë e altrove. Il trasporto del team è incluso nel pacchetto per distanze normali. Per zone molto remote, può esserci un piccolo supplemento di trasporto comunicato in anticipo.' },
      { q: 'Qual è la differenza tra Starter, Growth e Pro?', a: 'Tutti e tre hanno 2 servizi fotografici / mese. Starter è per piccole fattorie familiari che vogliono una presenza online. Growth aggiunge Meta Ads, più post e servizi fotografici stagionali completi. Pro aggiunge video drone aereo, cinematografia, campagne Google Ads, contenuti multilingua e targeting internazionale.' },
      { q: 'Quanto tempo per vedere risultati?', a: 'I Social Media e le foto professionali influenzano immediatamente credibilità e prenotazioni. Le Meta Ads danno risultati entro 1–2 settimane. La SEO e i posizionamenti organici Google si costruiscono in 3–6 mesi, a seconda della concorrenza. Nella tua prima stagione con noi, aspettati un aumento del 40–80% delle prenotazioni.' },
      { q: 'Parlate lingue straniere per i turisti internazionali?', a: 'Sì. I pacchetti Growth e Pro includono copywriting in inglese. Pro aggiunge anche l\'italiano (il turista più frequente in Albania). Le traduzioni in altre lingue sono offerte come extra.' },
      { q: 'Avete un contratto a lungo termine?', a: 'No. Lavoriamo con pagamenti mensili senza contratto a lungo termine. Puoi interrompere in qualsiasi momento con 7 giorni di preavviso. Tuttavia, consigliamo un minimo di 3 mesi per vedere veri risultati stagionali.' },
      { q: 'Posso cambiare il pacchetto durante la stagione?', a: 'Sì. Puoi fare upgrade in qualsiasi momento (es. da Starter a Growth prima della stagione estiva). Il downgrade è consentito con 7 giorni di preavviso prima dell\'inizio del nuovo mese.' },
    ] },
  contact: { kicker: 'Contattaci', title1: 'Inizia', title2: 'oggi', sub: 'La prima consulenza è gratuita. Non abbiamo contratti a lungo termine.', selected: 'Pacchetto selezionato:', name: 'Nome e Cognome *', namePh: 'Il tuo nome', email: 'Email *', emailPh: 'email@tua.com', phone: 'Numero di telefono *', phonePh: '+39 3XX XXX XXXX', site: 'Sito / Instagram', sitePh: 'sito.com o @instagram', message: 'Messaggio (opzionale)', messagePh: 'Raccontaci della tua fattoria, dei servizi, della capacità & degli obiettivi...', submit: 'Richiedi Consulenza Gratuita', submitting: 'Invio in corso...', trust: 'Nessun contratto a lungo termine · Niente spam · Ti contatteremo entro 24 ore', successTitle: 'Grazie! 🌾', successBody: 'Abbiamo ricevuto la tua richiesta. Ti contatteremo entro 24 ore per la consulenza gratuita.', error: 'Qualcosa è andato storto. Riprova.' },
  footer: { rights: 'Tutti i diritti riservati.', login: 'Accedi', contact: 'Contatti' },
};

const COPY: Record<Lang, Copy> = { sq: SQ, en: EN, it: IT };

export default function AgroturizemLandingPage() {
  const [lang, setLang] = useState<Lang>('sq');
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
        body: JSON.stringify({ ...formData, packageId: selectedPackage?.id || 'growth', packageName: selectedPackage ? `Agroturizëm ${selectedPackage.title}` : 'Agroturizëm Growth', source: 'Agroturizëm Landing Page', category: 'SEO + Social Media - Agroturizëm', message: `[${lang.toUpperCase()}] ${formData.message}` }) });
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
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-emerald-600 flex items-center justify-center"><Trees className="w-4 h-4 text-white" /></div>
            <span className="text-xl font-bold bg-gradient-to-r from-amber-600 to-emerald-700 bg-clip-text text-transparent">FivoCRM Agroturizëm</span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-gray-600">
            <a href="#results" className="hover:text-emerald-600 transition-colors">{t.nav.results}</a>
            <a href="#process" className="hover:text-emerald-600 transition-colors">{t.nav.process}</a>
            <a href="#packages" className="hover:text-emerald-600 transition-colors">{t.nav.packages}</a>
            <a href="#testimonials" className="hover:text-emerald-600 transition-colors">{t.nav.testimonials}</a>
            <a href="#faq" className="hover:text-emerald-600 transition-colors">{t.nav.faq}</a>
          </div>
          <div className="flex items-center gap-3">
            <LangSwitcher lang={lang} setLang={setLang} accentClass="bg-emerald-600" />
            <button onClick={() => scrollToContact()} className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-amber-500 to-emerald-600 hover:shadow-lg hover:shadow-emerald-500/25 transition-all hover:-translate-y-0.5">{t.nav.cta}</button>
          </div>
        </div>
      </nav>

      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-amber-50/60 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[700px] h-[700px] bg-amber-200/25 rounded-full blur-3xl" />
        <div className="absolute top-40 right-0 w-[350px] h-[350px] bg-emerald-200/25 rounded-full blur-3xl" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-100 mb-8">
                <div className="flex -space-x-2">{['PD', 'AK', 'BH', 'EK'].map((ini, i) => (<div key={i} className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-emerald-500 border-2 border-white flex items-center justify-center text-[10px] font-bold text-white">{ini}</div>))}</div>
                <span className="text-sm font-medium text-emerald-700">{t.hero.badge}</span>
                <div className="flex">{[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}</div>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                {t.hero.h1a}{' '}<span className="bg-gradient-to-r from-amber-500 via-emerald-500 to-green-600 bg-clip-text text-transparent">{t.hero.h1b}</span>{t.hero.h1c}
                <br /><span className="text-gray-400">{lang === 'sq' ? 'Po ndodh kjo te ti?' : lang === 'en' ? 'Is that happening to you?' : 'Sta succedendo a te?'}</span>
              </h1>
            </FadeIn>
            <FadeIn delay={200}><p className="mt-8 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">{t.hero.sub1} <strong className="text-emerald-600">{t.hero.sub2}</strong></p></FadeIn>
            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button onClick={scrollToPackages} className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-amber-500 to-emerald-600 hover:shadow-xl hover:shadow-emerald-500/25 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">{t.hero.ctaPrimary}<ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></button>
                <button onClick={() => scrollToContact()} className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border-2 border-gray-200 hover:border-emerald-300 hover:bg-emerald-50 transition-all flex items-center justify-center gap-2"><Phone className="w-5 h-5" />{t.hero.ctaSecondary}</button>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-400">
                <span className="flex items-center gap-1.5"><Camera className="w-4 h-4 text-amber-500" /> {t.hero.t1}</span>
                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-500" /> {t.hero.t2}</span>
                <span className="flex items-center gap-1.5"><Sun className="w-4 h-4 text-amber-500" /> {t.hero.t3}</span>
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
          <FadeIn delay={500}><div className="mt-12 text-center"><p className="text-lg text-gray-700 font-medium">{t.pains.bridge1} <span className="text-emerald-600 font-bold">{t.pains.bridge2}</span></p></div></FadeIn>
        </div>
      </section>

      <section id="results" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">{t.results.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.results.title1} <span className="bg-gradient-to-r from-amber-600 to-emerald-700 bg-clip-text text-transparent">{t.results.title2}</span></h2></div></FadeIn>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {t.results.items.map((r, i) => { const Icon = RESULT_ICONS[i]; return (
              <FadeIn key={i} delay={i * 100}><div className="text-center p-8 rounded-2xl bg-gradient-to-br from-amber-50 to-emerald-50 border border-emerald-100"><div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-emerald-600 flex items-center justify-center mx-auto mb-4"><Icon className="w-6 h-6 text-white" /></div><div className="text-4xl font-bold text-emerald-700 mb-2"><Counter end={parseFloat(r.metric)} suffix={r.suffix} /></div><p className="text-sm text-gray-600 leading-tight">{r.label}</p></div></FadeIn>); })}
          </div>
        </div>
      </section>

      <section id="process" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">{t.process.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.process.title1} <span className="bg-gradient-to-r from-amber-600 to-emerald-700 bg-clip-text text-transparent">{t.process.title2}</span></h2></div></FadeIn>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {t.process.steps.map((step, i) => { const Icon = PROCESS_ICONS[i]; return (
              <FadeIn key={i} delay={i * 150}><div className="relative bg-white rounded-2xl p-8 shadow-sm border border-gray-100 hover:shadow-lg hover:border-emerald-200 transition-all h-full"><div className="text-6xl font-black text-amber-100 mb-4">{step.step}</div><div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-emerald-600 flex items-center justify-center mb-4"><Icon className="w-6 h-6 text-white" /></div><h3 className="text-lg font-bold mb-2">{step.title}</h3><p className="text-gray-600 text-sm leading-relaxed">{step.desc}</p></div></FadeIn>); })}
          </div>
        </div>
      </section>

      <section id="packages" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-4"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">{t.packages.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.packages.title1} <span className="bg-gradient-to-r from-amber-600 to-emerald-700 bg-clip-text text-transparent">{t.packages.title2}</span></h2><p className="mt-4 text-gray-500 max-w-xl mx-auto">{t.packages.subA} <strong className="text-emerald-700">{t.packages.subB}</strong></p></div></FadeIn>
          <div className="grid lg:grid-cols-3 gap-6 mt-12">
            {t.packages.list.map((pkg, i) => {
              const style = PKG_STYLES[i]; const isExpanded = expandedCard === pkg.id;
              return (
                <FadeIn key={pkg.id} delay={i * 150}>
                  <div className={`relative rounded-2xl border-2 transition-all flex flex-col h-full ${style.border} ${style.popular ? 'shadow-2xl shadow-emerald-500/20 scale-[1.02]' : 'shadow-sm hover:shadow-xl'}`}>
                    {style.popular && (<div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10"><span className="px-5 py-1.5 rounded-full text-sm font-bold text-white bg-gradient-to-r from-emerald-500 to-green-600 shadow-lg shadow-emerald-500/30">⭐ {pkg.badge}</span></div>)}
                    {!style.popular && pkg.badge && (<div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10"><span className="px-5 py-1.5 rounded-full text-sm font-bold text-white bg-gradient-to-r from-amber-600 to-emerald-700 shadow-lg">{pkg.badge}</span></div>)}
                    <div className={`${style.headerBg} rounded-t-2xl p-6 pt-8`}>
                      <h3 className="text-2xl font-bold text-gray-900">{pkg.title}</h3>
                      <p className="text-sm text-gray-600 mt-1">{pkg.subtitle}</p>
                      <div className="mt-4 flex items-end gap-2"><span className={`text-4xl font-black bg-gradient-to-r ${style.color} bg-clip-text text-transparent`}>{pkg.price}</span>{pkg.originalPrice && (<span className="text-xl font-medium text-gray-400 line-through mb-1">{pkg.originalPrice}</span>)}</div>
                      <p className="text-sm text-gray-500 mt-1">{pkg.priceNote}</p>
                      {pkg.originalPrice && (<div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 border border-emerald-200"><span className="text-xs font-bold text-emerald-700">{t.packages.savingsBadge}</span></div>)}
                    </div>
                    <div className="px-6 py-3 bg-amber-50 border-y border-amber-100"><p className="text-sm font-bold text-amber-800 flex items-center gap-2"><Camera className="w-4 h-4" />{t.packages.photoHighlight}</p></div>
                    <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{t.packages.idealFor}</p>
                      <ul className="space-y-1">{pkg.targetAudience.map((a, idx) => (<li key={idx} className="flex items-center gap-2 text-sm text-gray-700"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />{a}</li>))}</ul>
                    </div>
                    <div className="flex-1 px-6 py-5 space-y-5">
                      {(isExpanded ? pkg.features : pkg.features.slice(0, 2)).map((cat, ci) => (
                        <div key={ci}><p className={`text-xs font-bold uppercase tracking-wide mb-2 bg-gradient-to-r ${style.color} bg-clip-text text-transparent`}>{cat.category}</p><ul className="space-y-1.5">{cat.items.map((item, ii) => (<li key={ii} className="flex items-start gap-2 text-sm text-gray-700"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />{item}</li>))}</ul></div>
                      ))}
                      {pkg.features.length > 2 && (<button onClick={() => setExpandedCard(isExpanded ? null : pkg.id)} className="text-sm text-emerald-600 font-medium flex items-center gap-1 hover:text-emerald-700"><ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />{isExpanded ? t.packages.less : `+ ${pkg.features.length - 2} ${t.packages.moreCats}`}</button>)}
                      {pkg.notIncluded.length > 0 && (<div><p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">{t.packages.notIncluded}</p><ul className="space-y-1.5">{pkg.notIncluded.map((item, ii) => (<li key={ii} className="flex items-start gap-2 text-sm text-gray-400"><X className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{item}</li>))}</ul></div>)}
                    </div>
                    <div className="px-6 pb-6">
                      <button onClick={() => scrollToContact(pkg)} className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${style.popular ? `text-white bg-gradient-to-r ${style.color} hover:shadow-lg hover:shadow-emerald-500/25 hover:-translate-y-0.5` : 'text-gray-700 bg-gray-100 hover:bg-gray-200'}`}>{pkg.cta}<ArrowRight className="w-4 h-4" /></button>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>
          <FadeIn delay={400}><div className="mt-10 max-w-3xl mx-auto text-center p-6 rounded-2xl bg-gradient-to-r from-amber-50 to-emerald-50 border border-amber-200"><p className="text-emerald-800 font-semibold flex items-center justify-center gap-2 flex-wrap"><Camera className="w-5 h-5 text-amber-600" />{t.packages.calloutA} <strong className="text-amber-700">{t.packages.calloutB}</strong></p></div></FadeIn>
        </div>
      </section>

      <section id="addons" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-12"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">{t.addons.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.addons.title1} <span className="bg-gradient-to-r from-amber-600 to-emerald-700 bg-clip-text text-transparent">{t.addons.title2}</span></h2><p className="mt-3 text-gray-500">{t.addons.sub}</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {t.addons.items.map((addon, i) => { const Icon = ADDON_ICONS[i]; return (
              <FadeIn key={i} delay={i * 80}><div className="bg-white rounded-2xl p-6 border border-gray-100 hover:border-emerald-200 hover:shadow-lg transition-all flex items-center gap-4"><div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0"><Icon className="w-6 h-6 text-emerald-600" /></div><div><p className="font-semibold text-gray-900">{addon.name}</p><p className="text-sm text-emerald-600 font-medium mt-0.5">{addon.price}</p></div></div></FadeIn>); })}
          </div>
        </div>
      </section>

      <section id="testimonials" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">{t.testimonials.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.testimonials.title1} <span className="bg-gradient-to-r from-amber-600 to-emerald-700 bg-clip-text text-transparent">{t.testimonials.title2}</span></h2></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {t.testimonials.items.map((tm, i) => (
              <FadeIn key={i} delay={i * 150}><div className="bg-gradient-to-br from-amber-50 to-emerald-50 rounded-2xl p-8 border border-emerald-100 hover:shadow-lg hover:border-emerald-200 transition-all h-full flex flex-col"><div className="flex mb-4">{[1,2,3,4,5].map(j => (<Star key={j} className="w-5 h-5 text-amber-400 fill-amber-400" />))}</div><p className="text-gray-700 leading-relaxed flex-1 italic">"{tm.quote}"</p><div className="mt-6 flex items-center gap-3"><div className="w-11 h-11 rounded-full bg-gradient-to-br from-amber-500 to-emerald-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">{tm.avatar}</div><div><p className="font-bold text-gray-900">{tm.name}</p><p className="text-sm text-gray-500">{tm.role}</p></div></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="py-20 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">{t.faq.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.faq.title1} <span className="bg-gradient-to-r from-amber-600 to-emerald-700 bg-clip-text text-transparent">{t.faq.title2}</span></h2></div></FadeIn>
          <div className="space-y-3">
            {t.faq.items.map((item, i) => (
              <FadeIn key={i} delay={i * 60}><div className="bg-white rounded-2xl border border-gray-100 overflow-hidden hover:border-emerald-200 transition-colors"><button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full px-6 py-5 flex items-center justify-between text-left"><span className="font-semibold text-gray-900 pr-4">{item.q}</span><ChevronDown className={`w-5 h-5 text-emerald-500 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} /></button>{openFaq === i && (<div className="px-6 pb-5"><p className="text-gray-600 leading-relaxed">{item.a}</p></div>)}</div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className="py-20 bg-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6">
          <FadeIn><div className="text-center mb-12"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">{t.contact.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.contact.title1} <span className="bg-gradient-to-r from-amber-600 to-emerald-700 bg-clip-text text-transparent">{t.contact.title2}</span></h2><p className="mt-4 text-gray-500">{t.contact.sub}</p></div></FadeIn>
          {selectedPackage && (
            <FadeIn>
              <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-amber-50 to-emerald-50 border border-emerald-200 flex items-center justify-between">
                <div><p className="text-sm text-gray-500">{t.contact.selected}</p><p className="font-bold text-emerald-700">{selectedPackage.title} — {selectedPackage.price}{selectedPackage.originalPrice && <span className="text-gray-400 line-through ml-2 font-normal">{selectedPackage.originalPrice}</span>}</p></div>
                <button onClick={() => setSelectedPackage(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
              </div>
            </FadeIn>
          )}
          {formSent ? (
            <FadeIn><div className="text-center p-12 rounded-2xl bg-gradient-to-br from-amber-50 to-emerald-50 border border-emerald-200"><div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-500 to-emerald-600 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/30"><CheckCircle2 className="w-10 h-10 text-white" /></div><h3 className="text-2xl font-bold text-gray-900 mb-3">{t.contact.successTitle}</h3><p className="text-gray-600 text-lg">{t.contact.successBody}</p></div></FadeIn>
          ) : (
            <FadeIn>
              <form onSubmit={handleSubmit} className="space-y-5 bg-gray-50 rounded-2xl p-8 border border-gray-100">
                <div className="grid sm:grid-cols-2 gap-5">
                  <div><label className="block text-sm font-medium text-gray-700 mb-1.5">{t.contact.name}</label><input type="text" required value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} placeholder={t.contact.namePh} className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1.5">{t.contact.email}</label><input type="email" required value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} placeholder={t.contact.emailPh} className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all" /></div>
                </div>
                <div className="grid sm:grid-cols-2 gap-5">
                  <div><label className="block text-sm font-medium text-gray-700 mb-1.5">{t.contact.phone}</label><input type="tel" required value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} placeholder={t.contact.phonePh} className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1.5">{t.contact.site}</label><input type="text" value={formData.website} onChange={e => setFormData(p => ({ ...p, website: e.target.value }))} placeholder={t.contact.sitePh} className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all" /></div>
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">{t.contact.message}</label><textarea rows={4} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} placeholder={t.contact.messagePh} className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all resize-none" /></div>
                {formError && (<div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{formError}</div>)}
                <button type="submit" disabled={submitting} className="w-full py-4 px-8 rounded-xl font-semibold text-white bg-gradient-to-r from-amber-500 to-emerald-600 hover:shadow-xl hover:shadow-emerald-500/25 transition-all hover:-translate-y-0.5 disabled:opacity-60 flex items-center justify-center gap-2 text-lg">{submitting ? (<><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t.contact.submitting}</>) : (<>{t.contact.submit}<ArrowRight className="w-5 h-5" /></>)}</button>
                <p className="text-center text-xs text-gray-400"><Shield className="w-3.5 h-3.5 inline mr-1" />{t.contact.trust}</p>
              </form>
            </FadeIn>
          )}
        </div>
      </section>

      <footer className="py-10 bg-gray-900 text-gray-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-emerald-600 flex items-center justify-center"><Trees className="w-4 h-4 text-white" /></div><span className="text-white font-bold">FivoCRM Agroturizëm</span></div>
            <p className="text-sm">© {new Date().getFullYear()} FivoCRM. {t.footer.rights}</p>
            <div className="flex items-center gap-4 text-sm"><Link to="/login" className="hover:text-white transition-colors">{t.footer.login}</Link><a href="#contact" className="hover:text-white transition-colors">{t.footer.contact}</a></div>
          </div>
        </div>
      </footer>
    </div>
  );
}
