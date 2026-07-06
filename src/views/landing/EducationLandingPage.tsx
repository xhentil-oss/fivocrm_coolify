import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  GraduationCap, BookOpen, Users, Star, CheckCircle2, ArrowRight,
  Target, Clock, Award, ChevronDown, Phone, ArrowUpRight,
  Sparkles, TrendingUp, Zap, Shield, BarChart3, Globe,
  Video, Instagram, Search, MessageSquare, X, Play,
} from 'lucide-react';
import { LangSwitcher, type Lang } from './LangSwitcher';
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

const PKG_STYLES = [
  { id: 'fillestar', color: 'from-blue-400 to-indigo-500', border: 'border-blue-200 hover:border-blue-400', popular: false },
  { id: 'rritje', color: 'from-indigo-500 to-violet-600', border: 'border-indigo-200 hover:border-indigo-500', popular: true },
  { id: 'akademi', color: 'from-violet-600 to-purple-700', border: 'border-violet-200 hover:border-violet-500', popular: false },
];
const PAIN_ICONS = [Users, Globe, BarChart3, Clock];
const PAIN_STYLE = [
  { color: 'text-red-500', bg: 'bg-red-50' }, { color: 'text-orange-500', bg: 'bg-orange-50' },
  { color: 'text-amber-500', bg: 'bg-amber-50' }, { color: 'text-blue-500', bg: 'bg-blue-50' },
];
const SERVE_ICONS = [GraduationCap, BookOpen, Globe, Zap, Star, Award];
const ADDON_ICONS = [Video, Globe, MessageSquare, Instagram, Search, Shield];
const TESTI_COLORS = ['bg-indigo-500', 'bg-violet-500', 'bg-blue-500'];
const STAT_VALUES = [{ end: 300, suffix: '%+', color: 'text-indigo-600' }, { end: 20, suffix: '+', color: 'text-violet-600' }, { end: 3200, suffix: '+', color: 'text-blue-600' }, { end: 98, suffix: '%', color: 'text-green-600' }];
const PERK_ICONS = [CheckCircle2, Target, TrendingUp, Play];

interface Pkg { title: string; subtitle: string; price: string; priceNote: string; badge: string; cta: string; targetAudience: string[]; features: { category: string; items: string[] }[]; notIncluded: string[]; }
interface Copy {
  nav: { problem: string; packages: string; process: string; faq: string; cta: string };
  hero: { badge: string; h1a: string; h1b: string; h1c: string; sub: string; cta1: string; cta2: string; t1: string; t2: string; t3: string };
  stats: { label: string }[];
  pains: { kicker: string; title: string; sub: string; items: { title: string; body: string }[] };
  serve: { title: string; labels: string[] };
  packages: { kicker: string; title: string; sub: string; idealFor: string; notIncluded: string; note: string; pkgs: Pkg[] };
  process: { kicker: string; title: string; sub: string; steps: { n: string; title: string; body: string }[] };
  addons: { kicker: string; title: string; sub: string; items: { title: string; desc: string }[] };
  testimonials: { kicker: string; title: string; sub: string; items: { name: string; role: string; text: string; avatar: string }[] };
  faq: { kicker: string; title: string; items: { q: string; a: string }[] };
  contact: { kicker: string; titleA: string; titleB: string; sub: string; perks: string[]; formTitle: string; pkgLabel: string; name: string; namePh: string; phone: string; phonePh: string; email: string; emailPh: string; school: string; schoolPh: string; message: string; messagePh: string; submit: string; submitting: string; note: string; successTitle: string; successBody: string; error: string };
  footer: { rights: string; login: string; pricing: string; contact: string };
}

const SQ: Copy = {
  nav: { problem: 'Problemi', packages: 'Paketat', process: 'Procesi', faq: 'FAQ', cta: 'Konsultim Falas' },
  hero: { badge: 'Marketing Dixhital për Institucione Arsimore', h1a: 'Mbush klasat tuaja me', h1b: 'nxënës të rinj', h1c: 'çdo sezon', sub: 'Marketing profesional për shkolla private, qendra kursesh dhe akademi. Ne menaxhojmë praninë tuaj dixhitale — ju fokusoheni te mësimdhënia.', cta1: 'Konsultim Falas', cta2: 'Shiko Paketat', t1: 'Pa kontratë afatgjatë', t2: 'Raporte mujore transparente', t3: 'Rezultate të matshme' },
  stats: [{ label: 'rritje mesatare aplikimesh' }, { label: 'shkolla & qendra kursesh' }, { label: 'aplikime të gjeneruara' }, { label: 'kënaqësi klientësh' }],
  pains: { kicker: 'A ju njeh?', title: 'Problemet që frenojnë rritjen tuaj', sub: 'Shumica e institucioneve arsimore kanë të njëjtat sfida dixhitale. Ne i kemi zgjidhur të gjitha.',
    items: [
      { title: 'Vende bosh në klasë çdo vit', body: 'Programet tuaja janë cilësorë, por nxënësit e rinj nuk e dinë që ekzistoni. Konkurrentët tuaj po marrin nxënësit tuaj.' },
      { title: 'Faqe e vjetër dhe e padukshme', body: 'Kur prindërit kërkojnë "shkollë private Tiranë" ose "kurs anglisht", institucioni juaj nuk shfaqet as në faqen e parë.' },
      { title: 'Postime pa rezultate', body: 'Bëni postime herë pas here pa strategji. Nuk dini çfarë funksionon. Orë të humbura pa asnjë aplikim të ri.' },
      { title: 'Nuk keni kohë për marketing', body: 'Fokusohu te mësimdhënia — ne marrim përsipër gjithë praninë tuaj dixhitale, nga postimet deri te reklamat.' },
    ] },
  serve: { title: 'Me kë punojmë', labels: ['Shkolla Private', 'Qendra Kursesh', 'Akademi Gjuhësh', 'Kurseve IT', 'Çerdhe & Kopshte', 'Kolegje Private'] },
  packages: { kicker: 'Çmimet', title: 'Paketë për çdo institucion', sub: 'Zgjidhni paketën që i përshtatet madhësisë dhe qëllimeve tuaja. Pa kontratë — ndryshoni kur dëshironi.', idealFor: 'Ideal për', notIncluded: 'Nuk përfshihet', note: '* Buxheti i reklamave paguhet direkt te platformat (Meta/Google) dhe nuk përfshihet në çmimin e paketës.',
    pkgs: [
      { title: 'Fillestar', subtitle: 'Prezencë online profesionale për qendra të vogla', price: '500€', priceNote: '/ muaj + ad spend', badge: '', cta: 'Fillo me Fillestar', targetAudience: ['Qendra kursesh të reja', 'Mësues privatë / tutorë', 'Çerdhe dhe kopshte private'],
        features: [{ category: 'Social Media', items: ['Menaxhim 2 platformash (Facebook + Instagram)', '12 postime / muaj', '8 reels / muaj', 'Design grafik profesional', 'Copywriting në shqip', 'Publikim sipas kalendarit', 'Raport mujor bazë'] }, { category: 'SEO', items: ['Optimizim bazë i faqes', 'Google Business Profile setup', '2 artikuj blog / muaj'] }, { category: 'Reklama', items: ['Setup bazë i Meta Ads', 'Menaxhim 1 fushatë aktive', 'Targetim lokal'] }],
        notIncluded: ['Buxheti i reklamave', 'Google Ads', 'Xhirime video profesionale', 'Email marketing', 'TikTok / YouTube'] },
      { title: 'Rritje', subtitle: 'Rrit nxënësit dhe autoritetin e institucionit', price: '950€', priceNote: '/ muaj + ad spend', badge: 'Më i Zgjedhuri', cta: 'Zgjidh Rritje', targetAudience: ['Shkolla private në rritje', 'Qendra kursesh me 2+ programe', 'Akademi gjuhësh dhe IT'],
        features: [{ category: 'Social Media', items: ['Menaxhim 3 platformash (FB + IG + TikTok)', '20 postime / muaj', '16 reels / muaj', '1 ditë xhirimi / muaj', 'Behind-the-scenes content', 'Testimoniale nxënësish', 'Community management bazë', 'Raport javor performance'] }, { category: 'SEO', items: ['SEO i plotë On-Page', 'Strategji fjalësh kyçe', '4 artikuj blog / muaj', 'Google Business optimizim', 'Ndërtim i autoritetit (backlinks)'] }, { category: 'Reklama', items: ['Menaxhim i plotë Meta Ads', 'Google Search Ads', '3–5 fushata aktive', 'Remarketing për vizitorë', 'Optimizim javor', 'A/B testing kreativësh'] }],
        notIncluded: ['Buxheti i reklamave', 'Produksion video të plotë', 'Influencer marketing'] },
      { title: 'Akademi', subtitle: 'Dominim i plotë dixhital për institucione të mëdha', price: '1,800€', priceNote: '/ muaj + ad spend', badge: 'Premium', cta: 'Zgjidh Akademi', targetAudience: ['Shkolla të mëdha private', 'Universitete dhe kolegje', 'Rrjete qendrash arsimore'],
        features: [{ category: 'Social Media', items: ['Menaxhim 4 platformash (FB + IG + TikTok + YouTube)', 'Postime të pakufizuara', '24+ reels / muaj', '2 ditë xhirimi / muaj', 'Mini-dokumentarë suksesi', 'Kampanja sezonale (regjistrimi)', 'Community management i plotë', 'Inbox management', 'Raport mujor i detajuar'] }, { category: 'SEO & Content', items: ['SEO teknik i avancuar', 'Content strategy 6-mujore', '8 artikuj blog / muaj', 'Landing pages dedikuara / kurs', 'Ndërtim autoritet domenin', 'Local SEO multi-lokacion'] }, { category: 'Reklama & Email', items: ['Menaxhim i plotë Meta + Google Ads', 'YouTube Ads', 'Fushata sezonale regjistrimi', 'Email marketing automation', 'CRM integration & follow-up', 'Raportim i plotë ROI'] }],
        notIncluded: ['Buxheti i reklamave'] },
    ] },
  process: { kicker: 'Si Funksionon', title: 'Procesi ynë i provuar', sub: '5 hapa drejt klasave të mbushura dhe autoritetit dixhital.',
    steps: [
      { n: '01', title: 'Analizë & Strategji', body: 'Studiojmë institucionin, konkurrentët dhe audiencën tuaj. Ndërtojmë strategji 3-mujore me qëllime të matshme.' },
      { n: '02', title: 'Identitet & Mesazh', body: 'Optimizojmë profilet, krijojmë mesazhe bindëse dhe ndërtojmë "zërin" e institucionit tuaj online.' },
      { n: '03', title: 'Kontent & Reklamim', body: 'Prodhojmë postime, reels, artikuj dhe aktivizojmë fushatat reklamuese drejtuar prindërve dhe nxënësve.' },
      { n: '04', title: 'Optimizim Javor', body: 'Analizojmë rezultatet çdo javë dhe rregullojmë çdo element për performancë maksimale.' },
      { n: '05', title: 'Raportim & Rritje', body: 'Raporte mujore transparente me numra realë: aplikime, regjistrimet, kosto për nxënës të ri.' },
    ] },
  addons: { kicker: 'Shtojca', title: 'Shërbime shtesë', sub: 'Personalizoni paketën tuaj me shërbime shtesë sipas nevojës.',
    items: [
      { title: 'Produksion Video', desc: 'Xhirim dhe editim profesional video promovuese, tour të shkollës, testimoniale.' },
      { title: 'Faqe Interneti', desc: 'Dizajn dhe zhvillim faqeje moderne, me SEO të integruar dhe sistem aplikimesh online.' },
      { title: 'WhatsApp Marketing', desc: 'Fushatë direkte me prindër dhe nxënës potencialë nëpërmjet WhatsApp.' },
      { title: 'Influencer Marketing', desc: 'Bashkëpunim me influencerë arsimor dhe prindër të njohur për besueshmëri.' },
      { title: 'Google Ads Shtesë', desc: 'Buxhet shtesë i menaxhuar për periudha regjistrimi dhe kampanja sezonale.' },
      { title: 'Menaxhim Reputacioni', desc: 'Monitorim komentesh, recensionesh dhe ndërtim imazhi pozitiv online.' },
    ] },
  testimonials: { kicker: 'Dëshmitarë', title: 'Çfarë thonë klientët tanë', sub: 'Institucione reale, rezultate reale.',
    items: [
      { name: 'Arta Kelmendi', role: 'Drejtuese, Akademia e Gjuhëve "Lingua"', text: 'Pas 3 muajsh bashkëpunim, aplikacionet për kurse u shtuan me 280%. Tani jemi plotë çdo sezon.', avatar: 'AK' },
      { name: 'Besnik Hoxha', role: 'Pronar, Shkolla Private "Mendimi"', text: 'Google-i tashmë na tregon në vendin e parë kur prindërit kërkojnë shkollë private. Regjistrimet u trefishuan.', avatar: 'BH' },
      { name: 'Mirela Brahimi', role: 'CEO, Qendra e Kurseve IT "CodePro"', text: 'Fushatat tona sezonale sjellin 50–80 aplikime të reja çdo muaj. ROI-i është i jashtëzakonshëm.', avatar: 'MB' },
    ] },
  faq: { kicker: 'FAQ', title: 'Pyetjet e shpeshta',
    items: [
      { q: 'Sa kohë duhet për të parë rezultatet e para?', a: 'Për reklamat paguese (Meta/Google Ads), rezultatet fillojnë brenda 2–4 javëve. Për SEO, rezultate organike duhen 3–6 muaj. Shumica e klientëve shohin rritje të aplikimeve brenda muajit të parë.' },
      { q: 'A punoni vetëm me shkolla shqiptare?', a: 'Punojmë me çdo institucion arsimor: shkolla private, qendra kursesh (gjuhë, IT, muzikë, arte), çerdhe, kopshte, akademi sportive dhe institucione të arsimit të lartë.' },
      { q: 'Çfarë buxheti reklamash rekomandoni?', a: 'Për rezultate optimale, rekomandojmë minimum 200–400€/muaj për Meta Ads dhe 150–300€/muaj për Google Ads. Buxheti nuk përfshihet në çmimin e paketave dhe menaxhohet plotësisht nga ne.' },
      { q: 'A mund të ndryshojmë paketën pas fillimit?', a: 'Po, mund të upgradoni ose downgradoni paketën çdo muaj sipas nevojave tuaja. Nuk ka kontratë afatgjatë — punojmë mujor.' },
      { q: 'A prodhoni ju materialin vizual (foto/video)?', a: 'Po. Vizitojmë institucionin tuaj për xhirime dhe foto (sipas paketës). Mund të shtoni gjithashtu shërbimin "Produksion Video" si add-on.' },
      { q: 'Si raportoni rezultatet?', a: 'Çdo muaj ju dërgojmë raport të detajuar me: numrin e aplikimeve, koston për aplikim, rritjen e faqes, performancën e reklamave dhe rekomandimet për muajin e ardhshëm.' },
    ] },
  contact: { kicker: 'Fillo sot', titleA: 'Merr konsultimin falas', titleB: 'pa asnjë detyrim', sub: 'Takohemi (online ose fizikisht), analizojmë situatën aktuale dhe ju tregojmë saktësisht çfarë mund të bëjmë për institucionin tuaj.',
    perks: ['Analizë falas e prezencës suaj dixhitale', 'Strategji e personalizuar për institucionin tuaj', 'Projeksion i rezultateve të pritshme', 'Fillojmë brenda 5 ditëve pune'],
    formTitle: 'Konsultim Falas', pkgLabel: 'Paketa e zgjedhur', name: 'Emri & Mbiemri *', namePh: 'Artan Hoxha', phone: 'Telefon *', phonePh: '+355 69 XXX XXXX', email: 'Email *', emailPh: 'info@shkolla-juaj.al', school: 'Emri i Institucionit *', schoolPh: 'Akademia \'Mendimi\' / Kursi IT Pro...', message: 'Mesazhi (opsional)', messagePh: 'Tregoni pak për institucionin dhe sfidat kryesore...', submit: 'Dërgo Kërkesën — Falas', submitting: 'Duke dërguar...', note: 'Pa detyrim. Ju kontaktojmë brenda 24 orëve.', successTitle: 'Faleminderit!', successBody: 'Kërkesa juaj u dërgua me sukses. Ekipi ynë do t\'ju kontaktojë brenda 24 orëve.', error: 'Diçka shkoi keq. Provoni përsëri ose na kontaktoni direkt.' },
  footer: { rights: 'Të gjitha të drejtat e rezervuara.', login: 'Hyrje', pricing: 'Çmimet', contact: 'Kontakt' },
};

const EN: Copy = {
  nav: { problem: 'The Problem', packages: 'Packages', process: 'Process', faq: 'FAQ', cta: 'Free Consultation' },
  hero: { badge: 'Digital Marketing for Educational Institutions', h1a: 'Fill your classes with', h1b: 'new students', h1c: 'every season', sub: 'Professional marketing for private schools, course centers and academies. We manage your digital presence — you focus on teaching.', cta1: 'Free Consultation', cta2: 'See Packages', t1: 'No long-term contract', t2: 'Transparent monthly reports', t3: 'Measurable results' },
  stats: [{ label: 'average increase in applications' }, { label: 'schools & course centers' }, { label: 'applications generated' }, { label: 'client satisfaction' }],
  pains: { kicker: 'Sound familiar?', title: 'The problems holding back your growth', sub: 'Most educational institutions face the same digital challenges. We\'ve solved them all.',
    items: [
      { title: 'Empty seats in class every year', body: 'Your programs are excellent, but new students don\'t know you exist. Your competitors are taking your students.' },
      { title: 'An old, invisible website', body: 'When parents search "private school" or "English course", your institution doesn\'t even appear on the first page.' },
      { title: 'Posts with no results', body: 'You post now and then with no strategy. You don\'t know what works. Hours lost with no new applications.' },
      { title: 'No time for marketing', body: 'Focus on teaching — we take over your entire digital presence, from posts to ads.' },
    ] },
  serve: { title: 'Who we work with', labels: ['Private Schools', 'Course Centers', 'Language Academies', 'IT Courses', 'Nurseries & Kindergartens', 'Private Colleges'] },
  packages: { kicker: 'Pricing', title: 'A package for every institution', sub: 'Choose the package that fits your size and goals. No contract — change whenever you want.', idealFor: 'Ideal for', notIncluded: 'Not included', note: '* Ad budget is paid directly to the platforms (Meta/Google) and is not included in the package price.',
    pkgs: [
      { title: 'Starter', subtitle: 'A professional online presence for small centers', price: '€500', priceNote: '/ month + ad spend', badge: '', cta: 'Start with Starter', targetAudience: ['New course centers', 'Private teachers / tutors', 'Private nurseries and kindergartens'],
        features: [{ category: 'Social Media', items: ['Management of 2 platforms (Facebook + Instagram)', '12 posts / month', '8 reels / month', 'Professional graphic design', 'Copywriting', 'Scheduled publishing', 'Basic monthly report'] }, { category: 'SEO', items: ['Basic site optimization', 'Google Business Profile setup', '2 blog articles / month'] }, { category: 'Ads', items: ['Basic Meta Ads setup', '1 active campaign management', 'Local targeting'] }],
        notIncluded: ['Ad budget', 'Google Ads', 'Professional video shoots', 'Email marketing', 'TikTok / YouTube'] },
      { title: 'Growth', subtitle: 'Grow students and your institution\'s authority', price: '€950', priceNote: '/ month + ad spend', badge: 'Most Chosen', cta: 'Choose Growth', targetAudience: ['Growing private schools', 'Course centers with 2+ programs', 'Language and IT academies'],
        features: [{ category: 'Social Media', items: ['Management of 3 platforms (FB + IG + TikTok)', '20 posts / month', '16 reels / month', '1 shoot day / month', 'Behind-the-scenes content', 'Student testimonials', 'Basic community management', 'Weekly performance report'] }, { category: 'SEO', items: ['Full On-Page SEO', 'Keyword strategy', '4 blog articles / month', 'Google Business optimization', 'Authority building (backlinks)'] }, { category: 'Ads', items: ['Full Meta Ads management', 'Google Search Ads', '3–5 active campaigns', 'Remarketing for visitors', 'Weekly optimization', 'Creative A/B testing'] }],
        notIncluded: ['Ad budget', 'Full video production', 'Influencer marketing'] },
      { title: 'Academy', subtitle: 'Complete digital dominance for large institutions', price: '€1,800', priceNote: '/ month + ad spend', badge: 'Premium', cta: 'Choose Academy', targetAudience: ['Large private schools', 'Universities and colleges', 'Networks of educational centers'],
        features: [{ category: 'Social Media', items: ['Management of 4 platforms (FB + IG + TikTok + YouTube)', 'Unlimited posts', '24+ reels / month', '2 shoot days / month', 'Mini success documentaries', 'Seasonal campaigns (enrollment)', 'Full community management', 'Inbox management', 'Detailed monthly report'] }, { category: 'SEO & Content', items: ['Advanced technical SEO', '6-month content strategy', '8 blog articles / month', 'Dedicated landing pages / course', 'Domain authority building', 'Multi-location local SEO'] }, { category: 'Ads & Email', items: ['Full Meta + Google Ads management', 'YouTube Ads', 'Seasonal enrollment campaigns', 'Email marketing automation', 'CRM integration & follow-up', 'Full ROI reporting'] }],
        notIncluded: ['Ad budget'] },
    ] },
  process: { kicker: 'How It Works', title: 'Our proven process', sub: '5 steps toward full classes and digital authority.',
    steps: [
      { n: '01', title: 'Analysis & Strategy', body: 'We study your institution, competitors and audience. We build a 3-month strategy with measurable goals.' },
      { n: '02', title: 'Identity & Message', body: 'We optimize the profiles, create compelling messages and build your institution\'s "voice" online.' },
      { n: '03', title: 'Content & Advertising', body: 'We produce posts, reels and articles and launch ad campaigns aimed at parents and students.' },
      { n: '04', title: 'Weekly Optimization', body: 'We analyze results every week and adjust every element for maximum performance.' },
      { n: '05', title: 'Reporting & Growth', body: 'Transparent monthly reports with real numbers: applications, enrollments, cost per new student.' },
    ] },
  addons: { kicker: 'Add-ons', title: 'Extra services', sub: 'Customize your package with extra services as needed.',
    items: [
      { title: 'Video Production', desc: 'Professional shooting and editing of promo videos, school tours, testimonials.' },
      { title: 'Website', desc: 'Design and development of a modern website with integrated SEO and an online application system.' },
      { title: 'WhatsApp Marketing', desc: 'Direct campaign to potential parents and students via WhatsApp.' },
      { title: 'Influencer Marketing', desc: 'Collaboration with education influencers and well-known parents for credibility.' },
      { title: 'Extra Google Ads', desc: 'Additional managed budget for enrollment periods and seasonal campaigns.' },
      { title: 'Reputation Management', desc: 'Monitoring comments, reviews and building a positive online image.' },
    ] },
  testimonials: { kicker: 'Testimonials', title: 'What our clients say', sub: 'Real institutions, real results.',
    items: [
      { name: 'Arta Kelmendi', role: 'Director, "Lingua" Language Academy', text: 'After 3 months of collaboration, course applications grew 280%. Now we\'re full every season.', avatar: 'AK' },
      { name: 'Besnik Hoxha', role: 'Owner, "Mendimi" Private School', text: 'Google now shows us first when parents search for a private school. Enrollments tripled.', avatar: 'BH' },
      { name: 'Mirela Brahimi', role: 'CEO, "CodePro" IT Course Center', text: 'Our seasonal campaigns bring 50–80 new applications every month. The ROI is exceptional.', avatar: 'MB' },
    ] },
  faq: { kicker: 'FAQ', title: 'Frequently asked questions',
    items: [
      { q: 'How long until I see the first results?', a: 'For paid ads (Meta/Google Ads), results start within 2–4 weeks. For SEO, organic results take 3–6 months. Most clients see application growth within the first month.' },
      { q: 'Do you only work with Albanian schools?', a: 'We work with any educational institution: private schools, course centers (language, IT, music, arts), nurseries, kindergartens, sports academies and higher education institutions.' },
      { q: 'What ad budget do you recommend?', a: 'For optimal results, we recommend a minimum of €200–400/month for Meta Ads and €150–300/month for Google Ads. The budget is not included in package prices and is fully managed by us.' },
      { q: 'Can we change the package after starting?', a: 'Yes, you can upgrade or downgrade the package every month as your needs change. There\'s no long-term contract — we work month by month.' },
      { q: 'Do you produce the visual material (photo/video)?', a: 'Yes. We visit your institution for shoots and photos (depending on the package). You can also add the "Video Production" service as an add-on.' },
      { q: 'How do you report results?', a: 'Every month we send you a detailed report with: number of applications, cost per application, site growth, ad performance and recommendations for the next month.' },
    ] },
  contact: { kicker: 'Start today', titleA: 'Get your free consultation', titleB: 'with no obligation', sub: 'We meet (online or in person), analyze the current situation and show you exactly what we can do for your institution.',
    perks: ['Free analysis of your digital presence', 'A strategy tailored to your institution', 'Projection of expected results', 'We start within 5 working days'],
    formTitle: 'Free Consultation', pkgLabel: 'Selected package', name: 'Full name *', namePh: 'John Smith', phone: 'Phone *', phonePh: '+39 3XX XXX XXXX', email: 'Email *', emailPh: 'info@your-school.com', school: 'Institution name *', schoolPh: '"Mendimi" Academy / IT Pro Course...', message: 'Message (optional)', messagePh: 'Tell us a bit about the institution and main challenges...', submit: 'Send Request — Free', submitting: 'Sending...', note: 'No obligation. We\'ll contact you within 24 hours.', successTitle: 'Thank you!', successBody: 'Your request was sent successfully. Our team will contact you within 24 hours.', error: 'Something went wrong. Please try again or contact us directly.' },
  footer: { rights: 'All rights reserved.', login: 'Login', pricing: 'Pricing', contact: 'Contact' },
};

const IT: Copy = {
  nav: { problem: 'Il Problema', packages: 'Pacchetti', process: 'Processo', faq: 'FAQ', cta: 'Consulenza Gratuita' },
  hero: { badge: 'Marketing Digitale per Istituti Scolastici', h1a: 'Riempi le tue classi con', h1b: 'nuovi studenti', h1c: 'ogni stagione', sub: 'Marketing professionale per scuole private, centri di corsi e accademie. Gestiamo la tua presenza digitale — tu pensi all\'insegnamento.', cta1: 'Consulenza Gratuita', cta2: 'Vedi i Pacchetti', t1: 'Nessun contratto a lungo termine', t2: 'Report mensili trasparenti', t3: 'Risultati misurabili' },
  stats: [{ label: 'aumento medio delle iscrizioni' }, { label: 'scuole & centri di corsi' }, { label: 'candidature generate' }, { label: 'soddisfazione clienti' }],
  pains: { kicker: 'Ti suona familiare?', title: 'I problemi che frenano la tua crescita', sub: 'La maggior parte degli istituti scolastici affronta le stesse sfide digitali. Le abbiamo risolte tutte.',
    items: [
      { title: 'Posti vuoti in classe ogni anno', body: 'I tuoi programmi sono eccellenti, ma i nuovi studenti non sanno che esisti. I tuoi concorrenti si prendono i tuoi studenti.' },
      { title: 'Un sito vecchio e invisibile', body: 'Quando i genitori cercano "scuola privata" o "corso di inglese", il tuo istituto non appare nemmeno in prima pagina.' },
      { title: 'Post senza risultati', body: 'Pubblichi ogni tanto senza strategia. Non sai cosa funziona. Ore perse senza nessuna nuova iscrizione.' },
      { title: 'Non hai tempo per il marketing', body: 'Concentrati sull\'insegnamento — ci occupiamo noi di tutta la tua presenza digitale, dai post agli annunci.' },
    ] },
  serve: { title: 'Con chi lavoriamo', labels: ['Scuole Private', 'Centri di Corsi', 'Accademie di Lingue', 'Corsi IT', 'Asili & Scuole Materne', 'College Privati'] },
  packages: { kicker: 'Prezzi', title: 'Un pacchetto per ogni istituto', sub: 'Scegli il pacchetto adatto alle tue dimensioni e ai tuoi obiettivi. Nessun contratto — cambia quando vuoi.', idealFor: 'Ideale per', notIncluded: 'Non incluso', note: '* Il budget pubblicitario si paga direttamente alle piattaforme (Meta/Google) e non è incluso nel prezzo del pacchetto.',
    pkgs: [
      { title: 'Starter', subtitle: 'Una presenza online professionale per piccoli centri', price: '500€', priceNote: '/ mese + ad spend', badge: '', cta: 'Inizia con Starter', targetAudience: ['Nuovi centri di corsi', 'Insegnanti privati / tutor', 'Asili e scuole materne private'],
        features: [{ category: 'Social Media', items: ['Gestione di 2 piattaforme (Facebook + Instagram)', '12 post / mese', '8 reels / mese', 'Grafica professionale', 'Copywriting', 'Pubblicazione programmata', 'Report mensile base'] }, { category: 'SEO', items: ['Ottimizzazione base del sito', 'Setup Google Business Profile', '2 articoli blog / mese'] }, { category: 'Pubblicità', items: ['Setup base Meta Ads', 'Gestione di 1 campagna attiva', 'Targeting locale'] }],
        notIncluded: ['Budget pubblicitario', 'Google Ads', 'Riprese video professionali', 'Email marketing', 'TikTok / YouTube'] },
      { title: 'Growth', subtitle: 'Aumenta studenti e autorevolezza dell\'istituto', price: '950€', priceNote: '/ mese + ad spend', badge: 'Il Più Scelto', cta: 'Scegli Growth', targetAudience: ['Scuole private in crescita', 'Centri di corsi con 2+ programmi', 'Accademie di lingue e IT'],
        features: [{ category: 'Social Media', items: ['Gestione di 3 piattaforme (FB + IG + TikTok)', '20 post / mese', '16 reels / mese', '1 giorno di riprese / mese', 'Contenuti behind-the-scenes', 'Testimonianze degli studenti', 'Community management base', 'Report settimanale delle performance'] }, { category: 'SEO', items: ['SEO On-Page completa', 'Strategia parole chiave', '4 articoli blog / mese', 'Ottimizzazione Google Business', 'Costruzione autorevolezza (backlink)'] }, { category: 'Pubblicità', items: ['Gestione completa Meta Ads', 'Google Search Ads', '3–5 campagne attive', 'Remarketing per i visitatori', 'Ottimizzazione settimanale', 'A/B testing dei creativi'] }],
        notIncluded: ['Budget pubblicitario', 'Produzione video completa', 'Influencer marketing'] },
      { title: 'Academy', subtitle: 'Dominio digitale completo per grandi istituti', price: '1.800€', priceNote: '/ mese + ad spend', badge: 'Premium', cta: 'Scegli Academy', targetAudience: ['Grandi scuole private', 'Università e college', 'Reti di centri educativi'],
        features: [{ category: 'Social Media', items: ['Gestione di 4 piattaforme (FB + IG + TikTok + YouTube)', 'Post illimitati', '24+ reels / mese', '2 giorni di riprese / mese', 'Mini-documentari di successo', 'Campagne stagionali (iscrizioni)', 'Community management completo', 'Gestione inbox', 'Report mensile dettagliato'] }, { category: 'SEO & Content', items: ['SEO tecnica avanzata', 'Strategia contenuti semestrale', '8 articoli blog / mese', 'Landing page dedicate / corso', 'Costruzione autorevolezza del dominio', 'Local SEO multi-sede'] }, { category: 'Pubblicità & Email', items: ['Gestione completa Meta + Google Ads', 'YouTube Ads', 'Campagne stagionali di iscrizione', 'Email marketing automation', 'Integrazione CRM & follow-up', 'Report ROI completo'] }],
        notIncluded: ['Budget pubblicitario'] },
    ] },
  process: { kicker: 'Come Funziona', title: 'Il nostro processo collaudato', sub: '5 passi verso classi piene e autorevolezza digitale.',
    steps: [
      { n: '01', title: 'Analisi & Strategia', body: 'Studiamo il tuo istituto, i concorrenti e il tuo pubblico. Costruiamo una strategia trimestrale con obiettivi misurabili.' },
      { n: '02', title: 'Identità & Messaggio', body: 'Ottimizziamo i profili, creiamo messaggi convincenti e costruiamo la "voce" del tuo istituto online.' },
      { n: '03', title: 'Contenuti & Pubblicità', body: 'Produciamo post, reels e articoli e lanciamo campagne rivolte a genitori e studenti.' },
      { n: '04', title: 'Ottimizzazione Settimanale', body: 'Analizziamo i risultati ogni settimana e regoliamo ogni elemento per le massime performance.' },
      { n: '05', title: 'Report & Crescita', body: 'Report mensili trasparenti con numeri reali: candidature, iscrizioni, costo per nuovo studente.' },
    ] },
  addons: { kicker: 'Extra', title: 'Servizi aggiuntivi', sub: 'Personalizza il tuo pacchetto con servizi extra secondo necessità.',
    items: [
      { title: 'Produzione Video', desc: 'Riprese e montaggio professionali di video promozionali, tour della scuola, testimonianze.' },
      { title: 'Sito Web', desc: 'Design e sviluppo di un sito moderno con SEO integrata e sistema di iscrizione online.' },
      { title: 'WhatsApp Marketing', desc: 'Campagna diretta a genitori e studenti potenziali via WhatsApp.' },
      { title: 'Influencer Marketing', desc: 'Collaborazione con influencer del settore educativo e genitori noti per la credibilità.' },
      { title: 'Google Ads Extra', desc: 'Budget aggiuntivo gestito per i periodi di iscrizione e le campagne stagionali.' },
      { title: 'Gestione Reputazione', desc: 'Monitoraggio di commenti, recensioni e costruzione di un\'immagine positiva online.' },
    ] },
  testimonials: { kicker: 'Testimonianze', title: 'Cosa dicono i nostri clienti', sub: 'Istituti reali, risultati reali.',
    items: [
      { name: 'Arta Kelmendi', role: 'Direttrice, Accademia di Lingue "Lingua"', text: 'Dopo 3 mesi di collaborazione, le iscrizioni ai corsi sono cresciute del 280%. Ora siamo al completo ogni stagione.', avatar: 'AK' },
      { name: 'Besnik Hoxha', role: 'Titolare, Scuola Privata "Mendimi"', text: 'Google ora ci mostra al primo posto quando i genitori cercano una scuola privata. Le iscrizioni sono triplicate.', avatar: 'BH' },
      { name: 'Mirela Brahimi', role: 'CEO, Centro Corsi IT "CodePro"', text: 'Le nostre campagne stagionali portano 50–80 nuove candidature ogni mese. Il ROI è eccezionale.', avatar: 'MB' },
    ] },
  faq: { kicker: 'FAQ', title: 'Domande frequenti',
    items: [
      { q: 'Quanto tempo per vedere i primi risultati?', a: 'Per le ads a pagamento (Meta/Google Ads), i risultati iniziano entro 2–4 settimane. Per la SEO, i risultati organici richiedono 3–6 mesi. La maggior parte dei clienti vede una crescita delle candidature entro il primo mese.' },
      { q: 'Lavorate solo con scuole albanesi?', a: 'Lavoriamo con qualsiasi istituto scolastico: scuole private, centri di corsi (lingue, IT, musica, arti), asili, scuole materne, accademie sportive e istituti di istruzione superiore.' },
      { q: 'Che budget pubblicitario consigliate?', a: 'Per risultati ottimali, consigliamo un minimo di 200–400€/mese per Meta Ads e 150–300€/mese per Google Ads. Il budget non è incluso nel prezzo dei pacchetti ed è gestito interamente da noi.' },
      { q: 'Possiamo cambiare pacchetto dopo l\'inizio?', a: 'Sì, puoi fare upgrade o downgrade del pacchetto ogni mese in base alle tue esigenze. Non c\'è contratto a lungo termine — lavoriamo mese per mese.' },
      { q: 'Producete voi il materiale visivo (foto/video)?', a: 'Sì. Visitiamo il tuo istituto per riprese e foto (a seconda del pacchetto). Puoi anche aggiungere il servizio "Produzione Video" come extra.' },
      { q: 'Come riportate i risultati?', a: 'Ogni mese ti inviamo un report dettagliato con: numero di candidature, costo per candidatura, crescita del sito, performance degli annunci e raccomandazioni per il mese successivo.' },
    ] },
  contact: { kicker: 'Inizia oggi', titleA: 'Ricevi la consulenza gratuita', titleB: 'senza alcun impegno', sub: 'Ci incontriamo (online o di persona), analizziamo la situazione attuale e ti mostriamo esattamente cosa possiamo fare per il tuo istituto.',
    perks: ['Analisi gratuita della tua presenza digitale', 'Una strategia su misura per il tuo istituto', 'Proiezione dei risultati attesi', 'Iniziamo entro 5 giorni lavorativi'],
    formTitle: 'Consulenza Gratuita', pkgLabel: 'Pacchetto selezionato', name: 'Nome e Cognome *', namePh: 'Mario Rossi', phone: 'Telefono *', phonePh: '+39 3XX XXX XXXX', email: 'Email *', emailPh: 'info@tua-scuola.it', school: 'Nome dell\'istituto *', schoolPh: 'Accademia \'Mendimi\' / Corso IT Pro...', message: 'Messaggio (opzionale)', messagePh: 'Raccontaci dell\'istituto e delle sfide principali...', submit: 'Invia Richiesta — Gratis', submitting: 'Invio in corso...', note: 'Senza impegno. Ti contattiamo entro 24 ore.', successTitle: 'Grazie!', successBody: 'La tua richiesta è stata inviata con successo. Il nostro team ti contatterà entro 24 ore.', error: 'Qualcosa è andato storto. Riprova o contattaci direttamente.' },
  footer: { rights: 'Tutti i diritti riservati.', login: 'Accedi', pricing: 'Prezzi', contact: 'Contatti' },
};

const COPY: Record<Lang, Copy> = { sq: SQ, en: EN, it: IT };

const EducationLandingPage: React.FC = () => {
  const [lang, setLang] = useState<Lang>('sq');
  const t = COPY[lang];
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [selectedPkg, setSelectedPkg] = useState<string>('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', school: '', message: '' });

  const scrollToPackages = () => document.getElementById('packages')?.scrollIntoView({ behavior: 'smooth' });
  const scrollToContact = (pkg = '') => { if (pkg) setSelectedPkg(pkg); document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/landing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, message: `[${lang.toUpperCase()}] ${formData.message}`, selectedPackage: selectedPkg, source: 'education-landing', category: 'Education' }),
      });
      if (!res.ok) throw new Error('Server error');
      setSubmitted(true);
    } catch {
      setFormError(t.contact.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">

      <header className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-lg flex items-center justify-center"><GraduationCap className="w-5 h-5 text-white" /></div>
            <span className="font-bold text-lg text-gray-900">FivoCRM <span className="text-indigo-600">Arsim</span></span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600">
            <a href="#problemi" className="hover:text-indigo-600 transition-colors">{t.nav.problem}</a>
            <a href="#packages" className="hover:text-indigo-600 transition-colors">{t.nav.packages}</a>
            <a href="#procesi" className="hover:text-indigo-600 transition-colors">{t.nav.process}</a>
            <a href="#faq" className="hover:text-indigo-600 transition-colors">{t.nav.faq}</a>
          </nav>
          <div className="flex items-center gap-3">
            <LangSwitcher lang={lang} setLang={setLang} accentClass="bg-indigo-600" />
            <button onClick={() => scrollToContact()} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">{t.nav.cta}</button>
            <LandingMobileMenu
              links={[
                { href: '#problemi', label: t.nav.problem },
                { href: '#packages', label: t.nav.packages },
                { href: '#procesi', label: t.nav.process },
                { href: '#faq', label: t.nav.faq },
              ]}
              ctaLabel={t.nav.cta}
              onCta={() => scrollToContact()}
              accentClass="bg-indigo-600"
            />
          </div>
        </div>
      </header>

      <section className="relative pt-28 pb-20 bg-gradient-to-br from-indigo-950 via-indigo-900 to-violet-900 text-white overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-violet-500/10 rounded-full blur-3xl" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_hsl(238,70%,60%,0.15),_transparent_70%)]" />
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 bg-indigo-500/20 border border-indigo-400/30 rounded-full px-4 py-1.5 text-sm mb-6"><Sparkles className="w-4 h-4 text-indigo-300" /><span className="text-indigo-200">{t.hero.badge}</span></div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight mb-6">{t.hero.h1a}{' '}<span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 to-violet-300">{t.hero.h1b}</span>{' '}{t.hero.h1c}</h1>
            <p className="text-lg sm:text-xl text-indigo-100 mb-8 leading-relaxed max-w-2xl">{t.hero.sub}</p>
            <div className="flex flex-col sm:flex-row gap-4">
              <button onClick={() => scrollToContact()} className="flex items-center justify-center gap-2 bg-white text-indigo-700 font-bold px-8 py-4 rounded-xl hover:bg-indigo-50 transition-all shadow-lg hover:shadow-xl text-lg"><Phone className="w-5 h-5" />{t.hero.cta1}</button>
              <button onClick={scrollToPackages} className="flex items-center justify-center gap-2 border border-indigo-400/40 text-white font-semibold px-8 py-4 rounded-xl hover:bg-indigo-800/50 transition-all text-lg">{t.hero.cta2}<ArrowRight className="w-5 h-5" /></button>
            </div>
            <div className="flex flex-wrap items-center gap-6 mt-10 text-sm text-indigo-300">
              <div className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-400" /> {t.hero.t1}</div>
              <div className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-400" /> {t.hero.t2}</div>
              <div className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-400" /> {t.hero.t3}</div>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0"><svg viewBox="0 0 1440 60" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full"><path d="M0 60L1440 60L1440 20C1200 60 960 0 720 20C480 40 240 0 0 20L0 60Z" fill="white" /></svg></div>
      </section>

      <section className="py-16 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 text-center">
            {STAT_VALUES.map((s, i) => (
              <FadeIn key={i} delay={i * 100}><div><div className={`text-4xl font-extrabold ${s.color} mb-1`}><Counter end={s.end} suffix={s.suffix} /></div><p className="text-sm text-gray-500 font-medium">{t.stats[i].label}</p></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section id="problemi" className="py-20 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <FadeIn><div className="text-center mb-14"><span className="inline-block bg-red-100 text-red-600 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">{t.pains.kicker}</span><h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">{t.pains.title}</h2><p className="text-gray-500 max-w-xl mx-auto">{t.pains.sub}</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {t.pains.items.map((p, i) => { const Icon = PAIN_ICONS[i]; const st = PAIN_STYLE[i]; return (
              <FadeIn key={i} delay={i * 100}><div className={`${st.bg} rounded-2xl p-6 border border-gray-100`}><div className={`w-10 h-10 rounded-xl ${st.bg} flex items-center justify-center mb-4`}><Icon className={`w-6 h-6 ${st.color}`} /></div><h3 className="font-bold text-gray-900 mb-2">{p.title}</h3><p className="text-sm text-gray-600 leading-relaxed">{p.body}</p></div></FadeIn>); })}
          </div>
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <FadeIn><div className="text-center mb-10"><h2 className="text-2xl font-bold text-gray-800">{t.serve.title}</h2></div></FadeIn>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {t.serve.labels.map((label, i) => { const Icon = SERVE_ICONS[i]; return (
              <FadeIn key={i} delay={i * 80}><div className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/40 transition-colors text-center"><div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center"><Icon className="w-5 h-5 text-indigo-600" /></div><span className="text-xs font-semibold text-gray-700">{label}</span></div></FadeIn>); })}
          </div>
        </div>
      </section>

      <section id="packages" className="py-24 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <FadeIn><div className="text-center mb-14"><span className="inline-block bg-indigo-100 text-indigo-600 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">{t.packages.kicker}</span><h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">{t.packages.title}</h2><p className="text-gray-500 max-w-xl mx-auto">{t.packages.sub}</p></div></FadeIn>
          <div className="grid lg:grid-cols-3 gap-8 items-start">
            {t.packages.pkgs.map((pkg, i) => { const style = PKG_STYLES[i]; return (
              <FadeIn key={style.id} delay={i * 120}>
                <div className={`relative bg-white rounded-2xl border-2 ${style.border} transition-all shadow-sm hover:shadow-xl overflow-hidden flex flex-col`}>
                  {style.popular && (<div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />)}
                  {pkg.badge && (<div className="absolute top-4 right-4"><span className={`inline-block px-3 py-1 text-xs font-bold rounded-full text-white bg-gradient-to-r ${style.color}`}>{pkg.badge}</span></div>)}
                  <div className="p-6 pb-4">
                    <div className={`inline-flex w-10 h-10 rounded-xl items-center justify-center bg-gradient-to-br ${style.color} mb-4`}><GraduationCap className="w-5 h-5 text-white" /></div>
                    <h3 className="text-xl font-extrabold text-gray-900">{pkg.title}</h3>
                    <p className="text-sm text-gray-500 mt-1 mb-4">{pkg.subtitle}</p>
                    <div className="flex items-end gap-1 mb-1"><span className="text-4xl font-extrabold text-gray-900">{pkg.price}</span></div>
                    <p className="text-xs text-gray-400 mb-5">{pkg.priceNote}</p>
                    <button onClick={() => scrollToContact(pkg.title)} className={`w-full py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-r ${style.color} hover:opacity-90 transition-opacity shadow`}>{pkg.cta}</button>
                  </div>
                  <div className="px-6 pb-4">
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">{t.packages.idealFor}</p>
                    <ul className="space-y-1">{pkg.targetAudience.map((a, j) => (<li key={j} className="flex items-center gap-2 text-xs text-gray-600"><CheckCircle2 className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />{a}</li>))}</ul>
                  </div>
                  <div className="px-6 pb-6 flex-1 space-y-4 border-t border-gray-100 pt-4">
                    {pkg.features.map((section, si) => (<div key={si}><p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">{section.category}</p><ul className="space-y-1.5">{section.items.map((item, ii) => (<li key={ii} className="flex items-start gap-2 text-xs text-gray-700"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />{item}</li>))}</ul></div>))}
                    <div><p className="text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-2">{t.packages.notIncluded}</p><ul className="space-y-1">{pkg.notIncluded.map((item, ii) => (<li key={ii} className="flex items-start gap-2 text-xs text-gray-400"><X className="w-3 h-3 text-gray-300 flex-shrink-0 mt-0.5" />{item}</li>))}</ul></div>
                  </div>
                </div>
              </FadeIn>); })}
          </div>
          <FadeIn><p className="text-center text-sm text-gray-400 mt-8">{t.packages.note}</p></FadeIn>
        </div>
      </section>

      <section id="procesi" className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <FadeIn><div className="text-center mb-14"><span className="inline-block bg-violet-100 text-violet-600 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">{t.process.kicker}</span><h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">{t.process.title}</h2><p className="text-gray-500 max-w-xl mx-auto">{t.process.sub}</p></div></FadeIn>
          <div className="relative">
            <div className="hidden lg:block absolute top-8 left-[10%] right-[10%] h-0.5 bg-gradient-to-r from-indigo-200 via-violet-300 to-indigo-200" />
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-8">
              {t.process.steps.map((step, i) => (
                <FadeIn key={i} delay={i * 100}><div className="relative text-center"><div className="w-16 h-16 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-200 relative z-10"><span className="text-white font-extrabold text-lg">{step.n}</span></div><h3 className="font-bold text-gray-900 mb-2 text-sm">{step.title}</h3><p className="text-xs text-gray-500 leading-relaxed">{step.body}</p></div></FadeIn>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 bg-indigo-950 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_hsl(245,60%,50%,0.2),_transparent_70%)]" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
          <FadeIn><div className="text-center mb-12"><span className="inline-block bg-indigo-500/20 text-indigo-300 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">{t.addons.kicker}</span><h2 className="text-3xl font-extrabold mb-3">{t.addons.title}</h2><p className="text-indigo-300 max-w-xl mx-auto text-sm">{t.addons.sub}</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {t.addons.items.map((a, i) => { const Icon = ADDON_ICONS[i]; return (
              <FadeIn key={i} delay={i * 80}><div className="bg-indigo-900/50 border border-indigo-700/40 rounded-2xl p-6 hover:bg-indigo-800/50 transition-colors"><div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center mb-4"><Icon className="w-5 h-5 text-indigo-300" /></div><h3 className="font-bold mb-2">{a.title}</h3><p className="text-sm text-indigo-300 leading-relaxed">{a.desc}</p></div></FadeIn>); })}
          </div>
        </div>
      </section>

      <section className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <FadeIn><div className="text-center mb-14"><span className="inline-block bg-yellow-100 text-yellow-600 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">{t.testimonials.kicker}</span><h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">{t.testimonials.title}</h2><p className="text-gray-500">{t.testimonials.sub}</p></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {t.testimonials.items.map((tm, i) => (
              <FadeIn key={i} delay={i * 120}><div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition-shadow"><div className="flex gap-0.5 mb-4">{Array.from({ length: 5 }).map((_, j) => (<Star key={j} className="w-4 h-4 fill-yellow-400 text-yellow-400" />))}</div><p className="text-gray-700 text-sm leading-relaxed mb-6 italic">"{tm.text}"</p><div className="flex items-center gap-3"><div className={`w-10 h-10 rounded-full ${TESTI_COLORS[i]} flex items-center justify-center text-white font-bold text-sm`}>{tm.avatar}</div><div><p className="font-semibold text-gray-900 text-sm">{tm.name}</p><p className="text-xs text-gray-500">{tm.role}</p></div></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="py-24 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <FadeIn><div className="text-center mb-14"><span className="inline-block bg-blue-100 text-blue-600 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">{t.faq.kicker}</span><h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">{t.faq.title}</h2></div></FadeIn>
          <div className="space-y-3">
            {t.faq.items.map((faq, i) => (
              <FadeIn key={i} delay={i * 60}><div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm"><button className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 transition-colors" onClick={() => setOpenFaq(openFaq === i ? null : i)}><span className="font-semibold text-gray-900 text-sm pr-4">{faq.q}</span><ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} /></button>{openFaq === i && (<div className="px-5 pb-5"><p className="text-sm text-gray-600 leading-relaxed">{faq.a}</p></div>)}</div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className="py-24 bg-gradient-to-br from-indigo-950 via-indigo-900 to-violet-900 text-white relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none"><div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-3xl" /><div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-violet-500/10 rounded-full blur-3xl" /></div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
          <div className="grid lg:grid-cols-2 gap-14 items-start">
            <FadeIn>
              <div>
                <span className="inline-block bg-indigo-500/20 text-indigo-300 text-xs font-bold px-3 py-1 rounded-full mb-6 uppercase tracking-wide">{t.contact.kicker}</span>
                <h2 className="text-3xl sm:text-4xl font-extrabold mb-6 leading-tight">{t.contact.titleA}<br /><span className="text-indigo-300">{t.contact.titleB}</span></h2>
                <p className="text-indigo-200 mb-8 leading-relaxed">{t.contact.sub}</p>
                <div className="space-y-4">
                  {t.contact.perks.map((text, i) => { const Icon = PERK_ICONS[i]; return (
                    <div key={i} className="flex items-center gap-3"><div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center flex-shrink-0"><Icon className="w-4 h-4 text-indigo-300" /></div><span className="text-indigo-100 text-sm">{text}</span></div>); })}
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              {submitted ? (
                <div className="bg-white/10 backdrop-blur rounded-2xl p-10 border border-white/10 text-center"><div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-8 h-8 text-green-400" /></div><h3 className="text-2xl font-bold mb-3">{t.contact.successTitle}</h3><p className="text-indigo-200 leading-relaxed">{t.contact.successBody}</p></div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">{t.contact.formTitle}</h3>
                  {selectedPkg && (<div className="flex items-center gap-2 bg-indigo-500/20 rounded-lg px-4 py-2.5 text-sm border border-indigo-400/30"><GraduationCap className="w-4 h-4 text-indigo-300" /><span className="text-indigo-200">{t.contact.pkgLabel}: <strong className="text-white">{selectedPkg}</strong></span><button type="button" onClick={() => setSelectedPkg('')} className="ml-auto"><X className="w-4 h-4 text-indigo-400 hover:text-white" /></button></div>)}
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div><label className="block text-xs font-semibold text-indigo-200 mb-1.5">{t.contact.name}</label><input required type="text" placeholder={t.contact.namePh} value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-indigo-300/60 text-sm focus:outline-none focus:border-indigo-400 focus:bg-white/15 transition-colors" /></div>
                    <div><label className="block text-xs font-semibold text-indigo-200 mb-1.5">{t.contact.phone}</label><input required type="tel" placeholder={t.contact.phonePh} value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-indigo-300/60 text-sm focus:outline-none focus:border-indigo-400 focus:bg-white/15 transition-colors" /></div>
                  </div>
                  <div><label className="block text-xs font-semibold text-indigo-200 mb-1.5">{t.contact.email}</label><input required type="email" placeholder={t.contact.emailPh} value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-indigo-300/60 text-sm focus:outline-none focus:border-indigo-400 focus:bg-white/15 transition-colors" /></div>
                  <div><label className="block text-xs font-semibold text-indigo-200 mb-1.5">{t.contact.school}</label><input required type="text" placeholder={t.contact.schoolPh} value={formData.school} onChange={e => setFormData(p => ({ ...p, school: e.target.value }))} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-indigo-300/60 text-sm focus:outline-none focus:border-indigo-400 focus:bg-white/15 transition-colors" /></div>
                  <div><label className="block text-xs font-semibold text-indigo-200 mb-1.5">{t.contact.message}</label><textarea rows={3} placeholder={t.contact.messagePh} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-indigo-300/60 text-sm focus:outline-none focus:border-indigo-400 focus:bg-white/15 transition-colors resize-none" /></div>
                  {formError && (<p className="text-red-300 text-sm bg-red-500/10 rounded-lg px-4 py-2">{formError}</p>)}
                  <button type="submit" disabled={submitting} className="w-full bg-white text-indigo-700 font-bold py-4 rounded-xl hover:bg-indigo-50 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-60 text-sm">{submitting ? (<><div className="w-4 h-4 border-2 border-indigo-400/30 border-t-indigo-600 rounded-full animate-spin" />{t.contact.submitting}</>) : (<><ArrowUpRight className="w-5 h-5" />{t.contact.submit}</>)}</button>
                  <p className="text-xs text-indigo-300/70 text-center">{t.contact.note}</p>
                </form>
              )}
            </FadeIn>
          </div>
        </div>
      </section>

      <footer className="bg-indigo-950 border-t border-indigo-900 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-indigo-400">
          <div className="flex items-center gap-2"><div className="w-6 h-6 bg-gradient-to-br from-indigo-500 to-violet-600 rounded flex items-center justify-center"><GraduationCap className="w-3.5 h-3.5 text-white" /></div><span>&copy; {new Date().getFullYear()} FivoCRM. {t.footer.rights}</span></div>
          <div className="flex items-center gap-6"><Link to="/login" className="hover:text-white transition-colors">{t.footer.login}</Link><a href="#packages" className="hover:text-white transition-colors">{t.footer.pricing}</a><a href="#contact" className="hover:text-white transition-colors">{t.footer.contact}</a></div>
        </div>
      </footer>

    </div>
  );
};

export default EducationLandingPage;
