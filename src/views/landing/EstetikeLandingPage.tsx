import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, TrendingUp, Shield, Zap, CheckCircle2, ArrowRight,
  Star, Users, Target, Clock, ChevronDown, Phone,
  ArrowUpRight, Camera, Instagram, Megaphone, BarChart3,
  X, Lock, Video, Image, Heart,
} from 'lucide-react';
import { LangSwitcher, useLandingLang, type Lang } from './LangSwitcher';
import LandingMobileMenu from './LandingMobileMenu';

/* ─── scroll-in animation ─── */
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
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
    if (!visible) return;
    let start = 0; const step = end / (duration / 16);
    const timer = setInterval(() => { start += step; if (start >= end) { setCount(end); clearInterval(timer); } else setCount(Math.floor(start)); }, 16);
    return () => clearInterval(timer);
  }, [visible, end, duration]);
  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

interface Pkg {
  id: string; title: string; subtitle: string; price: string; priceNote: string;
  targetAudience: string[]; features: { category: string; items: string[] }[];
  notIncluded: string[]; popular?: boolean; badge?: string; color: string; border: string; cta: string;
}
interface Copy {
  nav: { results: string; process: string; packages: string; addons: string; testimonials: string; login: string; cta: string };
  hero: { badge: string; h1a: string; h1b: string; h1c: string; h1d: string; sub1: string; sub2: string; ctaPrimary: string; ctaSecondary: string; t1: string; t2: string; t3: string };
  pains: { kicker: string; title1: string; title2: string; items: { title: string; desc: string }[]; bridge1: string; bridge2: string };
  results: { kicker: string; title: string; items: { metric: string; suffix: string; label: string }[] };
  process: { kicker: string; title: string; sub: string; steps: { step: string; title: string; desc: string }[] };
  packages: { kicker: string; title: string; sub: string; forLabel: string; more: string; less: string; notIncluded: string; chosen: string; note: string; list: Pkg[] };
  addons: { kicker: string; title: string; sub: string; items: { name: string; price: string }[] };
  testimonials: { kicker: string; title: string; items: { name: string; role: string; quote: string; avatar: string }[] };
  faq: { kicker: string; title: string; items: { q: string; a: string }[] };
  contact: { kicker: string; title1: string; title2: string; sub: string; perks: string[]; urgency: string; formTitle: string; selected: string; change: string; name: string; namePh: string; email: string; phone: string; phonePh: string; site: string; sitePh: string; message: string; messagePh: string; submit: string; submitting: string; privacy: string; successTitle: string; successBody: string; error: string };
  footer: { rights: string; pricing: string; contact: string };
}

const ADDON_ICONS = [Video, Camera, Image, Heart, Camera, Zap];
const RESULT_ICONS = [Sparkles, Target, TrendingUp, Users];
const PAIN_ICONS = [Instagram, Megaphone, Clock];
const PROCESS_ICONS = [Target, Camera, Megaphone, BarChart3];

/* ───────────────────────── ALBANIAN ───────────────────────── */
const SQ: Copy = {
  nav: { results: 'Rezultatet', process: 'Procesi', packages: 'Paketat', addons: 'Shtesa', testimonials: 'Dëshmitë', login: 'Hyr', cta: 'Fillo Tani' },
  hero: { badge: '150+ klinika estetike na besojnë', h1a: 'Klinika jote meriton', h1b: 'klientë të rinj', h1c: 'çdo javë.', h1d: 'A po ndodh kjo?',
    sub1: 'Çdo ditë, mijëra femra dhe meshkuj shfletojnë Instagram duke kërkuar trajtimin e radhës.', sub2: 'Pa Before & After bindës, pa prezencë profesionale, ata po shkojnë tek konkurrenca.',
    ctaPrimary: 'Shiko Paketat', ctaSecondary: 'Konsultim Falas', t1: 'Pa kontratë afatgjatë', t2: 'Ad spend i veçantë', t3: 'Rezultate brenda muajit' },
  pains: { kicker: 'A e njeh këtë situatë?', title1: 'Klinika po humb klientë', title2: 'çdo ditë',
    items: [
      { title: 'Social media pa strategji', desc: 'Postoni foto trajtimesh pa plan, pa estetikë vizuale, pa copy tërheqës — dhe pyesni pse nuk ka rezervime.' },
      { title: 'Reklama që nuk sjellin klientë', desc: 'Shpenzoni në reklama pa targeting të saktë, pa Before & After bindës — dhe humbisni buxhetin pa rezultate.' },
      { title: 'Konkurrenca po ju kalon përpara', desc: 'Çdo ditë hapen klinika të reja me prezencë të fortë online. Pa marketing profesional, klientët po zgjedhin të tjerët.' },
    ], bridge1: 'Lajmi i mirë?', bridge2: 'Ne e dimë zgjidhjen.' },
  results: { kicker: 'Rezultate të vërteta', title: 'Numrat flasin më shumë se fjalët',
    items: [{ metric: '200', suffix: '+', label: 'Klinika estetike të promovuara' }, { metric: '85', suffix: '%', label: 'Klientë me rritje rezervimesh në 3 muaj' }, { metric: '3.8', suffix: 'x', label: 'Rritje e interesimit për trajtime' }, { metric: '150', suffix: '+', label: 'Biznese beauty të kënaqur' }] },
  process: { kicker: 'Si funksionon', title: '4 hapa për sukses në social media', sub: 'Procesi ynë i provuar që sjell klientë të rinj për klinika estetike',
    steps: [
      { step: '01', title: 'Analiza & Strategjia', desc: 'Analizojmë klinikën, targetin, dhe konkurrencën. Krijojmë strategji vizuale të tailored.' },
      { step: '02', title: 'Krijim Përmbajtjeje', desc: 'Xhirime trajtimesh, Before & After, testimoniale, ambient klinike — gjithçka profesionale.' },
      { step: '03', title: 'Publikim & Ads', desc: 'Publikojmë sipas kalendarit dhe lançojmë fushata me targeting të saktë (mosha, gjinia, zona).' },
      { step: '04', title: 'Optimizim & Raportim', desc: 'Monitorojmë rezultatet javor, optimizojmë fushatat, raportojmë rezervimet e reja.' },
    ] },
  packages: { kicker: 'Paketat Social Media', title: 'Zgjidh paketin ideal për klinikën tënde', sub: 'Çdo paketë përfshin strategji të personalizuar për industrinë e estetikës. Çmimet nuk përfshijnë buxhetin e reklamave (ad spend).',
    forLabel: 'Për:', more: 'më shumë...', less: 'Shfaq më pak', notIncluded: 'Nuk përfshihet:', chosen: '✓ Zgjedhur', note: 'Të gjitha çmimet janë në Lekë (ALL). Buxheti i reklamave (ad spend) nuk përfshihet. TVSH nuk përfshihet. Faturim mujor.',
    list: [
      { id: 'starter', title: 'Starter', subtitle: 'Prezencë profesionale dhe besueshmëri online', price: '70.000', priceNote: 'Lekë / muaj + ad spend', targetAudience: ['Klinika të reja estetike', 'Kozmetike individuale', 'Biznese që duan prezencë profesionale'],
        features: [{ category: 'Përmbajtja & Menaxhimi', items: ['Menaxhim i 2 platformave (Facebook + Instagram)', '12 postime / muaj', '10 reels / muaj', 'Design grafik për postimet', 'Copywriting për përshkrimet', 'Publikim sipas kalendarit', '1 content session / muaj', 'Menaxhim bazë i faqes', 'Raport mujor bazë'] }, { category: 'Ads & Reklama', items: ['Setup bazë i fushatave', 'Menaxhim bazë i reklamave', 'Optimizim i thjeshtë'] }],
        notIncluded: ['Buxheti i reklamave', 'Xhirime të shumta trajtimesh', 'Community management i avancuar', 'Landing page / website changes', 'Influencer marketing'], color: 'from-pink-400 to-rose-500', border: 'border-pink-200 hover:border-pink-400', cta: 'Fillo me Starter' },
      { id: 'growth', title: 'Growth', subtitle: 'Rritje e klientëve dhe besueshmëri e fortë', price: '110.000', priceNote: 'Lekë / muaj + ad spend', popular: true, badge: 'Më i Popullarizuari', targetAudience: ['Klinika estetike në rritje', 'Sallone me disa shërbime', 'Klientë që duan leads të rinj'],
        features: [{ category: 'Përmbajtja & Menaxhimi', items: ['Menaxhim i 2 platformave', '16 postime / muaj', '20 reels / muaj', 'Design grafik', 'Copywriting', 'Publikim sipas kalendarit', '1 ditë xhirimi / muaj', 'Before & After content', 'Përmbajtje për trajtime + brand personal', 'Menaxhim bazë i komenteve dhe inbox-it', 'Raport mujor performance'] }, { category: 'Ads & Reklama', items: ['Menaxhim i plotë i Meta Ads', 'Krijim fushatash', 'Testim kreativësh', 'Audience targeting (femra, mosha, gjeografi)', 'Optimizim javor', 'Raportim i rezultateve'] }],
        notIncluded: ['Buxheti i reklamave', 'Xhirime shtesë jashtë ditës mujore', 'Influencer management', 'Foto/video për evente speciale'], color: 'from-rose-500 to-pink-600', border: 'border-rose-200 hover:border-rose-400', cta: 'Zgjidh Growth' },
      { id: 'pro', title: 'Pro', subtitle: 'Dominim i tregut dhe flow i vazhdueshëm klientësh', price: '160.000', priceNote: 'Lekë / muaj + ad spend', badge: 'Maksimum Rezultate', targetAudience: ['Klinika premium estetike', 'Qendra me disa lokacione', 'Klientë që duan rritje agresive'],
        features: [{ category: 'Përmbajtja & Menaxhimi', items: ['Menaxhim i 2–3 platformave', '20 postime / muaj', '25 reels / muaj', 'Design grafik premium', 'Copywriting i avancuar', 'Publikim dhe planifikim mujor', '2 ditë xhirimi / muaj', 'Before & After professional', 'Content për trajtime, doktor, dhe klinikë', 'Testimonial video nga klientët', 'Community management aktiv', 'Raportim i detajuar mujor'] }, { category: 'Ads & Reklama', items: ['Menaxhim i plotë i Meta Ads', 'Booking generation campaigns', 'Retargeting', 'Audience segmentation i avancuar', 'Testim i shumë kreativëve', 'Optimizim i rregullt i performancës'] }],
        notIncluded: ['Buxheti i reklamave', 'Produksion pa limit', 'Landing pages / website development', 'Event coverage ose launch campaigns të veçanta', 'Influencer marketing (ofrohet si add-on)'], color: 'from-fuchsia-500 to-purple-600', border: 'border-fuchsia-200 hover:border-fuchsia-400', cta: 'Zgjidh Pro' },
      { id: 'custom', title: 'Custom', subtitle: 'Zgjidhje e plotë sipas nevojave tuaja', price: 'Sipas kërkesës', priceNote: '', targetAudience: ['Zinxhirë klinikash', 'Qendra me shumë degë', 'Lançime produktesh/trajtimesh', 'Nevoja të veçanta'],
        features: [{ category: 'Mund të përfshijë', items: ['Më shumë platforma (TikTok, YouTube)', 'Më shumë xhirime mujore', 'Video testimoniale profesionale', 'Before & After me kualitet të lartë', 'Seasonal campaigns (dimër, verë, festa)', 'Influencer marketing & management', 'Event coverage (hapje klinike, lançim trajtimi)', 'Ads me buxhet të lartë', 'Strategji e personalizuar mujore'] }],
        notIncluded: [], color: 'from-purple-600 to-indigo-600', border: 'border-purple-200 hover:border-purple-400', cta: 'Na Kontaktoni' },
    ] },
  addons: { kicker: 'Shtesa Extra', title: 'Personalizo paketën tënde', sub: 'Shto shërbime ekstra sipas nevojave të klinikës suaj.',
    items: [{ name: 'Reel shtesë', price: '5.000 – 8.000 Lekë' }, { name: 'Xhirim trajtimi (Before/After)', price: '15.000 – 25.000 Lekë' }, { name: 'Ditë ekstra xhirimi', price: '20.000 – 35.000 Lekë' }, { name: 'Testimonial video klienti', price: '10.000 – 18.000 Lekë' }, { name: 'Foto shtesë klinike/trajtimesh', price: '8.000 – 15.000 Lekë' }, { name: 'Montazh i avancuar / urgent', price: 'Sipas kërkesës' }] },
  testimonials: { kicker: 'Dëshmi klientësh', title: 'Çfarë thonë klinika estetike',
    items: [{ name: 'Dr. Elona Hoxha', role: 'Drejtuese, Glow Aesthetics Clinic', quote: 'Brenda 2 muajve u rritën rezervimet me 70%. Reels-et Before & After kanë bërë çudi — klientë na kontaktojnë direkt nga Instagram.', avatar: 'EH' }, { name: 'Arjeta Krasniqi', role: 'Pronare, Belle Beauty Center', quote: 'Prezenca jonë në social media u transformua komplet. Tani klientë të rinj na gjejnë çdo javë.', avatar: 'AK' }, { name: 'Dr. Besnik Maliqi', role: 'Kirurg Plastik, Premium Med', quote: 'Kampanjat Lead Generation na sjellin 40+ kontakte të reja çdo muaj. Investimi ka ndryshuar biznesin.', avatar: 'BM' }] },
  faq: { kicker: 'FAQ', title: 'Pyetjet më të shpeshta',
    items: [
      { q: 'Çfarë përfshihet në buxhetin e reklamave (ad spend)?', a: 'Buxheti i reklamave paguhet direkt tek Meta (Facebook/Instagram) dhe nuk përfshihet në çmimin e paketës. Ne menaxhojmë si shpenzohet. Zakonisht rekomandojmë 30.000–100.000 Lekë/muaj.' },
      { q: 'Sa kohë duhet për të parë rezultate?', a: 'Prezenca profesionale ndikon menjëherë në besueshmëri. Për rritje rezervimesh përmes reklamave, rezultatet e para vijnë brenda 2–4 javëve.' },
      { q: 'A mund ta ndryshoj paketin gjatë rrugës?', a: 'Po, absolutisht. Mund të upgrade-oni çdo muaj. Na njoftoni 7 ditë para rifillimit të muajit.' },
      { q: 'A bëni Before & After content?', a: 'Po! Në Growth përfshihet 1 ditë xhirimi, në Pro 2 ditë, dhe në Custom sipas nevojave.' },
      { q: 'A respektoni konfidencialitetin e klientëve?', a: 'Absolutisht. Çdo Before & After ose testimonial bëhet vetëm me miratimin e plotë të klientit.' },
    ] },
  contact: { kicker: 'Gati për të filluar?', title1: 'Klinika jote meriton', title2: 'klientë çdo javë', sub: 'Plotëso formularin dhe merr një konsultim falas. Do analizojmë prezencën tuaj dhe do tregojmë mundësitë për rritje.',
    perks: ['Audit falas i prezencës në social media', 'Analizë e konkurrentëve në industrinë e estetikës', 'Propozim strategjie pa detyrim'], urgency: 'Kapacitet i limituar: pranojmë vetëm 10 klinika të reja çdo muaj.',
    formTitle: 'Merr konsultimin falas', selected: 'Paketa e zgjedhur', change: 'Ndrysho', name: 'Emri i plotë *', namePh: 'Emri Mbiemri', email: 'Email *', phone: 'Telefon', phonePh: '+355 6X XXX XXXX', site: 'Website / Instagram (nëse keni)', sitePh: 'https://example.com ose @instagram', message: 'Mesazh (opsional)', messagePh: 'Na tregoni pak për klinikën tuaj...', submit: 'Dërgo Kërkesën', submitting: 'Duke dërguar...', privacy: 'Duke dërguar pranoni politikën e privatësisë. Nuk do merrni spam.', successTitle: 'Faleminderit!', successBody: 'Kërkesa jote u dërgua. Do t\'ju kontaktojmë brenda 24 orëve.', error: 'Diçka shkoi keq. Provoni përsëri.' },
  footer: { rights: 'Të gjitha të drejtat e rezervuara.', pricing: 'Çmimet', contact: 'Kontakt' },
};

/* ───────────────────────── ENGLISH ───────────────────────── */
const EN: Copy = {
  nav: { results: 'Results', process: 'Process', packages: 'Packages', addons: 'Add-ons', testimonials: 'Testimonials', login: 'Login', cta: 'Get Started' },
  hero: { badge: '150+ aesthetic clinics trust us', h1a: 'Your clinic deserves', h1b: 'new clients', h1c: 'every week.', h1d: 'Is it happening?',
    sub1: 'Every day, thousands scroll Instagram looking for their next treatment.', sub2: 'Without convincing Before & After and a professional presence, they\'re going to your competitors.',
    ctaPrimary: 'See Packages', ctaSecondary: 'Free Consultation', t1: 'No long-term contract', t2: 'Ad spend separate', t3: 'Results within the month' },
  pains: { kicker: 'Sound familiar?', title1: 'Your clinic is losing clients', title2: 'every day',
    items: [
      { title: 'Social media with no strategy', desc: 'You post treatment photos with no plan, no visual aesthetic, no compelling copy — and wonder why there are no bookings.' },
      { title: 'Ads that don\'t bring clients', desc: 'You spend on ads without precise targeting, without convincing Before & After — and waste the budget with no results.' },
      { title: 'Competitors are getting ahead', desc: 'New clinics with a strong online presence open every day. Without professional marketing, clients are choosing others.' },
    ], bridge1: 'The good news?', bridge2: 'We know the solution.' },
  results: { kicker: 'Real results', title: 'Numbers speak louder than words',
    items: [{ metric: '200', suffix: '+', label: 'Aesthetic clinics promoted' }, { metric: '85', suffix: '%', label: 'Clients with more bookings in 3 months' }, { metric: '3.8', suffix: 'x', label: 'Growth in treatment interest' }, { metric: '150', suffix: '+', label: 'Happy beauty businesses' }] },
  process: { kicker: 'How it works', title: '4 steps to social media success', sub: 'Our proven process that brings new clients to aesthetic clinics',
    steps: [
      { step: '01', title: 'Analysis & Strategy', desc: 'We analyze the clinic, target audience and competitors. We build a tailored visual strategy.' },
      { step: '02', title: 'Content Creation', desc: 'Treatment shoots, Before & After, testimonials, clinic ambiance — all professional.' },
      { step: '03', title: 'Publishing & Ads', desc: 'We publish on schedule and launch campaigns with precise targeting (age, gender, area).' },
      { step: '04', title: 'Optimization & Reporting', desc: 'We monitor results weekly, optimize campaigns, and report new bookings.' },
    ] },
  packages: { kicker: 'Social Media Packages', title: 'Choose the ideal plan for your clinic', sub: 'Every package includes a strategy tailored to the aesthetics industry. Prices exclude ad spend.',
    forLabel: 'For:', more: 'more...', less: 'Show less', notIncluded: 'Not included:', chosen: '✓ Selected', note: 'All prices in Albanian Lek (ALL). Ad spend not included. VAT not included. Monthly billing.',
    list: [
      { id: 'starter', title: 'Starter', subtitle: 'Professional presence and online credibility', price: '70,000', priceNote: 'ALL / month + ad spend', targetAudience: ['New aesthetic clinics', 'Individual cosmetologists', 'Businesses wanting a professional presence'],
        features: [{ category: 'Content & Management', items: ['Management of 2 platforms (Facebook + Instagram)', '12 posts / month', '10 reels / month', 'Graphic design for posts', 'Copywriting for captions', 'Scheduled publishing', '1 content session / month', 'Basic page management', 'Basic monthly report'] }, { category: 'Ads', items: ['Basic campaign setup', 'Basic ad management', 'Simple optimization'] }],
        notIncluded: ['Ad budget', 'Multiple treatment shoots', 'Advanced community management', 'Landing page / website changes', 'Influencer marketing'], color: 'from-pink-400 to-rose-500', border: 'border-pink-200 hover:border-pink-400', cta: 'Start with Starter' },
      { id: 'growth', title: 'Growth', subtitle: 'Client growth and strong credibility', price: '110,000', priceNote: 'ALL / month + ad spend', popular: true, badge: 'Most Popular', targetAudience: ['Growing aesthetic clinics', 'Salons with several services', 'Clients wanting new leads'],
        features: [{ category: 'Content & Management', items: ['Management of 2 platforms', '16 posts / month', '20 reels / month', 'Graphic design', 'Copywriting', 'Scheduled publishing', '1 shoot day / month', 'Before & After content', 'Treatment + personal brand content', 'Basic comment & inbox management', 'Monthly performance report'] }, { category: 'Ads', items: ['Full Meta Ads management', 'Campaign creation', 'Creative testing', 'Audience targeting (women, age, geography)', 'Weekly optimization', 'Results reporting'] }],
        notIncluded: ['Ad budget', 'Extra shoots beyond the monthly day', 'Influencer management', 'Photo/video for special events'], color: 'from-rose-500 to-pink-600', border: 'border-rose-200 hover:border-rose-400', cta: 'Choose Growth' },
      { id: 'pro', title: 'Pro', subtitle: 'Market dominance and a steady client flow', price: '160,000', priceNote: 'ALL / month + ad spend', badge: 'Maximum Results', targetAudience: ['Premium aesthetic clinics', 'Multi-location centers', 'Clients wanting aggressive growth'],
        features: [{ category: 'Content & Management', items: ['Management of 2–3 platforms', '20 posts / month', '25 reels / month', 'Premium graphic design', 'Advanced copywriting', 'Monthly publishing & planning', '2 shoot days / month', 'Professional Before & After', 'Content for treatments, doctor and clinic', 'Client testimonial videos', 'Active community management', 'Detailed monthly reporting'] }, { category: 'Ads', items: ['Full Meta Ads management', 'Booking generation campaigns', 'Retargeting', 'Advanced audience segmentation', 'Multi-creative testing', 'Regular performance optimization'] }],
        notIncluded: ['Ad budget', 'Unlimited production', 'Landing pages / website development', 'Event coverage or special launch campaigns', 'Influencer marketing (available as add-on)'], color: 'from-fuchsia-500 to-purple-600', border: 'border-fuchsia-200 hover:border-fuchsia-400', cta: 'Choose Pro' },
      { id: 'custom', title: 'Custom', subtitle: 'A complete solution tailored to your needs', price: 'On request', priceNote: '', targetAudience: ['Clinic chains', 'Multi-branch centers', 'Product/treatment launches', 'Special needs'],
        features: [{ category: 'May include', items: ['More platforms (TikTok, YouTube)', 'More monthly shoots', 'Professional testimonial videos', 'High-quality Before & After', 'Seasonal campaigns (winter, summer, holidays)', 'Influencer marketing & management', 'Event coverage (clinic opening, treatment launch)', 'High-budget ads', 'Personalized monthly strategy'] }],
        notIncluded: [], color: 'from-purple-600 to-indigo-600', border: 'border-purple-200 hover:border-purple-400', cta: 'Contact Us' },
    ] },
  addons: { kicker: 'Extra Add-ons', title: 'Customize your package', sub: 'Add extra services based on your clinic\'s needs.',
    items: [{ name: 'Extra reel', price: '5,000 – 8,000 ALL' }, { name: 'Treatment shoot (Before/After)', price: '15,000 – 25,000 ALL' }, { name: 'Extra shoot day', price: '20,000 – 35,000 ALL' }, { name: 'Client testimonial video', price: '10,000 – 18,000 ALL' }, { name: 'Extra clinic/treatment photos', price: '8,000 – 15,000 ALL' }, { name: 'Advanced / urgent editing', price: 'On request' }] },
  testimonials: { kicker: 'Client testimonials', title: 'What aesthetic clinics say',
    items: [{ name: 'Dr. Elona Hoxha', role: 'Director, Glow Aesthetics Clinic', quote: 'Within 2 months bookings grew 70%. The Before & After reels worked wonders — clients contact us straight from Instagram.', avatar: 'EH' }, { name: 'Arjeta Krasniqi', role: 'Owner, Belle Beauty Center', quote: 'Our social media presence was completely transformed. New clients now find us every week.', avatar: 'AK' }, { name: 'Dr. Besnik Maliqi', role: 'Plastic Surgeon, Premium Med', quote: 'Lead Generation campaigns bring us 40+ new contacts every month. The investment changed the business.', avatar: 'BM' }] },
  faq: { kicker: 'FAQ', title: 'Frequently asked questions',
    items: [
      { q: 'What is included in the ad spend?', a: 'Ad spend is paid directly to Meta (Facebook/Instagram) and is not included in the package price. We manage how it\'s spent. We usually recommend 30,000–100,000 ALL/month.' },
      { q: 'How long until I see results?', a: 'A professional presence immediately boosts credibility. For booking growth via ads, first results usually come within 2–4 weeks.' },
      { q: 'Can I change the plan along the way?', a: 'Yes, absolutely. You can upgrade any month. Just notify us 7 days before the month renews.' },
      { q: 'Do you create Before & After content?', a: 'Yes! Growth includes 1 shoot day, Pro 2 days, and Custom as needed.' },
      { q: 'Do you respect client confidentiality?', a: 'Absolutely. Every Before & After or testimonial is done only with the client\'s full consent.' },
    ] },
  contact: { kicker: 'Ready to start?', title1: 'Your clinic deserves', title2: 'clients every week', sub: 'Fill in the form and get a free consultation. We\'ll analyze your presence and show concrete growth opportunities.',
    perks: ['Free social media presence audit', 'Competitor analysis in the aesthetics industry', 'Strategy proposal with no obligation'], urgency: 'Limited capacity: we only take 10 new clinics each month.',
    formTitle: 'Get your free consultation', selected: 'Selected package', change: 'Change', name: 'Full name *', namePh: 'First Last', email: 'Email *', phone: 'Phone', phonePh: '+39 3XX XXX XXXX', site: 'Website / Instagram (if any)', sitePh: 'https://example.com or @instagram', message: 'Message (optional)', messagePh: 'Tell us a bit about your clinic...', submit: 'Send Request', submitting: 'Sending...', privacy: 'By submitting you accept the privacy policy. No spam.', successTitle: 'Thank you!', successBody: 'Your request was sent. We\'ll contact you within 24 hours.', error: 'Something went wrong. Please try again.' },
  footer: { rights: 'All rights reserved.', pricing: 'Pricing', contact: 'Contact' },
};

/* ───────────────────────── ITALIAN ───────────────────────── */
const IT: Copy = {
  nav: { results: 'Risultati', process: 'Processo', packages: 'Pacchetti', addons: 'Extra', testimonials: 'Testimonianze', login: 'Accedi', cta: 'Inizia Ora' },
  hero: { badge: '150+ cliniche estetiche si fidano di noi', h1a: 'La tua clinica merita', h1b: 'nuovi clienti', h1c: 'ogni settimana.', h1d: 'Sta succedendo?',
    sub1: 'Ogni giorno migliaia di persone scorrono Instagram cercando il prossimo trattamento.', sub2: 'Senza Before & After convincenti e una presenza professionale, vanno dalla concorrenza.',
    ctaPrimary: 'Vedi i Pacchetti', ctaSecondary: 'Consulenza Gratuita', t1: 'Nessun contratto a lungo termine', t2: 'Budget pubblicitario separato', t3: 'Risultati entro il mese' },
  pains: { kicker: 'Ti suona familiare?', title1: 'La tua clinica perde clienti', title2: 'ogni giorno',
    items: [
      { title: 'Social media senza strategia', desc: 'Pubblichi foto dei trattamenti senza piano, senza estetica visiva, senza testi efficaci — e ti chiedi perché non arrivano prenotazioni.' },
      { title: 'Pubblicità che non porta clienti', desc: 'Spendi in ads senza targeting preciso, senza Before & After convincenti — e sprechi il budget senza risultati.' },
      { title: 'La concorrenza ti supera', desc: 'Ogni giorno aprono nuove cliniche con forte presenza online. Senza marketing professionale, i clienti scelgono altri.' },
    ], bridge1: 'La buona notizia?', bridge2: 'Conosciamo la soluzione.' },
  results: { kicker: 'Risultati reali', title: 'I numeri parlano più delle parole',
    items: [{ metric: '200', suffix: '+', label: 'Cliniche estetiche promosse' }, { metric: '85', suffix: '%', label: 'Clienti con più prenotazioni in 3 mesi' }, { metric: '3.8', suffix: 'x', label: 'Crescita dell\'interesse per i trattamenti' }, { metric: '150', suffix: '+', label: 'Attività beauty soddisfatte' }] },
  process: { kicker: 'Come funziona', title: '4 passi verso il successo sui social', sub: 'Il nostro processo collaudato che porta nuovi clienti alle cliniche estetiche',
    steps: [
      { step: '01', title: 'Analisi & Strategia', desc: 'Analizziamo la clinica, il target e la concorrenza. Creiamo una strategia visiva su misura.' },
      { step: '02', title: 'Creazione Contenuti', desc: 'Riprese dei trattamenti, Before & After, testimonianze, ambiente della clinica — tutto professionale.' },
      { step: '03', title: 'Pubblicazione & Ads', desc: 'Pubblichiamo secondo il calendario e lanciamo campagne con targeting preciso (età, genere, zona).' },
      { step: '04', title: 'Ottimizzazione & Report', desc: 'Monitoriamo i risultati ogni settimana, ottimizziamo le campagne e riportiamo le nuove prenotazioni.' },
    ] },
  packages: { kicker: 'Pacchetti Social Media', title: 'Scegli il piano ideale per la tua clinica', sub: 'Ogni pacchetto include una strategia su misura per il settore estetico. I prezzi escludono il budget pubblicitario.',
    forLabel: 'Per:', more: 'altro...', less: 'Mostra meno', notIncluded: 'Non incluso:', chosen: '✓ Selezionato', note: 'Tutti i prezzi in Lek albanesi (ALL). Budget pubblicitario non incluso. IVA esclusa. Fatturazione mensile.',
    list: [
      { id: 'starter', title: 'Starter', subtitle: 'Presenza professionale e credibilità online', price: '70.000', priceNote: 'ALL / mese + ad spend', targetAudience: ['Nuove cliniche estetiche', 'Cosmetologi individuali', 'Attività che vogliono una presenza professionale'],
        features: [{ category: 'Contenuti & Gestione', items: ['Gestione di 2 piattaforme (Facebook + Instagram)', '12 post / mese', '10 reels / mese', 'Grafica per i post', 'Copywriting per le didascalie', 'Pubblicazione programmata', '1 sessione contenuti / mese', 'Gestione base della pagina', 'Report mensile base'] }, { category: 'Pubblicità', items: ['Setup base delle campagne', 'Gestione base degli annunci', 'Ottimizzazione semplice'] }],
        notIncluded: ['Budget pubblicitario', 'Riprese multiple dei trattamenti', 'Community management avanzato', 'Modifiche landing page / sito', 'Influencer marketing'], color: 'from-pink-400 to-rose-500', border: 'border-pink-200 hover:border-pink-400', cta: 'Inizia con Starter' },
      { id: 'growth', title: 'Growth', subtitle: 'Crescita dei clienti e forte credibilità', price: '110.000', priceNote: 'ALL / mese + ad spend', popular: true, badge: 'Più Popolare', targetAudience: ['Cliniche estetiche in crescita', 'Saloni con più servizi', 'Clienti che vogliono nuovi lead'],
        features: [{ category: 'Contenuti & Gestione', items: ['Gestione di 2 piattaforme', '16 post / mese', '20 reels / mese', 'Grafica', 'Copywriting', 'Pubblicazione programmata', '1 giorno di riprese / mese', 'Contenuti Before & After', 'Contenuti trattamenti + brand personale', 'Gestione base di commenti e inbox', 'Report mensile delle performance'] }, { category: 'Pubblicità', items: ['Gestione completa Meta Ads', 'Creazione campagne', 'Test dei creativi', 'Targeting del pubblico (donne, età, geografia)', 'Ottimizzazione settimanale', 'Report dei risultati'] }],
        notIncluded: ['Budget pubblicitario', 'Riprese extra oltre il giorno mensile', 'Influencer management', 'Foto/video per eventi speciali'], color: 'from-rose-500 to-pink-600', border: 'border-rose-200 hover:border-rose-400', cta: 'Scegli Growth' },
      { id: 'pro', title: 'Pro', subtitle: 'Dominio del mercato e flusso costante di clienti', price: '160.000', priceNote: 'ALL / mese + ad spend', badge: 'Massimi Risultati', targetAudience: ['Cliniche estetiche premium', 'Centri con più sedi', 'Clienti che vogliono crescita aggressiva'],
        features: [{ category: 'Contenuti & Gestione', items: ['Gestione di 2–3 piattaforme', '20 post / mese', '25 reels / mese', 'Grafica premium', 'Copywriting avanzato', 'Pubblicazione e pianificazione mensile', '2 giorni di riprese / mese', 'Before & After professionale', 'Contenuti per trattamenti, medico e clinica', 'Video testimonianza dei clienti', 'Community management attivo', 'Report mensile dettagliato'] }, { category: 'Pubblicità', items: ['Gestione completa Meta Ads', 'Campagne di generazione prenotazioni', 'Retargeting', 'Segmentazione avanzata del pubblico', 'Test di più creativi', 'Ottimizzazione regolare delle performance'] }],
        notIncluded: ['Budget pubblicitario', 'Produzione illimitata', 'Sviluppo landing page / sito', 'Copertura eventi o campagne di lancio speciali', 'Influencer marketing (disponibile come extra)'], color: 'from-fuchsia-500 to-purple-600', border: 'border-fuchsia-200 hover:border-fuchsia-400', cta: 'Scegli Pro' },
      { id: 'custom', title: 'Custom', subtitle: 'Una soluzione completa su misura', price: 'Su richiesta', priceNote: '', targetAudience: ['Catene di cliniche', 'Centri con più filiali', 'Lanci di prodotti/trattamenti', 'Esigenze speciali'],
        features: [{ category: 'Può includere', items: ['Più piattaforme (TikTok, YouTube)', 'Più riprese mensili', 'Video testimonianze professionali', 'Before & After di alta qualità', 'Campagne stagionali (inverno, estate, feste)', 'Influencer marketing & gestione', 'Copertura eventi (apertura clinica, lancio trattamento)', 'Ads ad alto budget', 'Strategia mensile personalizzata'] }],
        notIncluded: [], color: 'from-purple-600 to-indigo-600', border: 'border-purple-200 hover:border-purple-400', cta: 'Contattaci' },
    ] },
  addons: { kicker: 'Extra', title: 'Personalizza il tuo pacchetto', sub: 'Aggiungi servizi extra in base alle esigenze della tua clinica.',
    items: [{ name: 'Reel extra', price: '5.000 – 8.000 ALL' }, { name: 'Ripresa trattamento (Before/After)', price: '15.000 – 25.000 ALL' }, { name: 'Giorno di ripresa extra', price: '20.000 – 35.000 ALL' }, { name: 'Video testimonianza cliente', price: '10.000 – 18.000 ALL' }, { name: 'Foto extra clinica/trattamenti', price: '8.000 – 15.000 ALL' }, { name: 'Montaggio avanzato / urgente', price: 'Su richiesta' }] },
  testimonials: { kicker: 'Testimonianze clienti', title: 'Cosa dicono le cliniche estetiche',
    items: [{ name: 'Dr. Elona Hoxha', role: 'Direttrice, Glow Aesthetics Clinic', quote: 'In 2 mesi le prenotazioni sono cresciute del 70%. I reel Before & After hanno fatto miracoli — i clienti ci contattano direttamente da Instagram.', avatar: 'EH' }, { name: 'Arjeta Krasniqi', role: 'Titolare, Belle Beauty Center', quote: 'La nostra presenza social si è trasformata completamente. Ora nuovi clienti ci trovano ogni settimana.', avatar: 'AK' }, { name: 'Dr. Besnik Maliqi', role: 'Chirurgo Plastico, Premium Med', quote: 'Le campagne di Lead Generation ci portano oltre 40 nuovi contatti al mese. L\'investimento ha cambiato l\'attività.', avatar: 'BM' }] },
  faq: { kicker: 'FAQ', title: 'Domande frequenti',
    items: [
      { q: 'Cosa è incluso nel budget pubblicitario (ad spend)?', a: 'Il budget pubblicitario si paga direttamente a Meta (Facebook/Instagram) e non è incluso nel prezzo del pacchetto. Noi gestiamo come viene speso. Di solito consigliamo 30.000–100.000 ALL/mese.' },
      { q: 'Quanto tempo per vedere risultati?', a: 'Una presenza professionale aumenta subito la credibilità. Per la crescita delle prenotazioni tramite ads, i primi risultati arrivano entro 2–4 settimane.' },
      { q: 'Posso cambiare il pacchetto in corsa?', a: 'Sì, assolutamente. Puoi fare upgrade ogni mese. Avvisaci 7 giorni prima del rinnovo.' },
      { q: 'Realizzate contenuti Before & After?', a: 'Sì! Growth include 1 giorno di riprese, Pro 2 giorni, e Custom secondo le esigenze.' },
      { q: 'Rispettate la riservatezza dei clienti?', a: 'Assolutamente. Ogni Before & After o testimonianza è realizzata solo con il pieno consenso del cliente.' },
    ] },
  contact: { kicker: 'Pronto a iniziare?', title1: 'La tua clinica merita', title2: 'clienti ogni settimana', sub: 'Compila il modulo e ricevi una consulenza gratuita. Analizzeremo la tua presenza e mostreremo opportunità concrete di crescita.',
    perks: ['Audit gratuito della presenza social', 'Analisi della concorrenza nel settore estetico', 'Proposta di strategia senza impegno'], urgency: 'Capacità limitata: accettiamo solo 10 nuove cliniche al mese.',
    formTitle: 'Ricevi la consulenza gratuita', selected: 'Pacchetto selezionato', change: 'Modifica', name: 'Nome completo *', namePh: 'Nome Cognome', email: 'Email *', phone: 'Telefono', phonePh: '+39 3XX XXX XXXX', site: 'Sito / Instagram (se presente)', sitePh: 'https://example.com o @instagram', message: 'Messaggio (opzionale)', messagePh: 'Raccontaci della tua clinica...', submit: 'Invia Richiesta', submitting: 'Invio in corso...', privacy: 'Inviando accetti l\'informativa sulla privacy. Niente spam.', successTitle: 'Grazie!', successBody: 'La tua richiesta è stata inviata. Ti contatteremo entro 24 ore.', error: 'Qualcosa è andato storto. Riprova.' },
  footer: { rights: 'Tutti i diritti riservati.', pricing: 'Prezzi', contact: 'Contatti' },
};

const COPY: Record<Lang, Copy> = { sq: SQ, en: EN, it: IT };

export default function EstetikeLandingPage() {
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
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/landing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          packageId: selectedPackage?.id || '',
          packageName: selectedPackage ? `Estetikë ${selectedPackage.title}` : '',
          source: 'Estetikë Landing Page',
          category: 'Social Media - Estetikë',
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
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center"><Sparkles className="w-4 h-4 text-white" /></div>
            <span className="text-xl font-bold bg-gradient-to-r from-rose-500 to-pink-600 bg-clip-text text-transparent">FivoCRM Estetikë</span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-gray-600">
            <a href="#results" className="hover:text-rose-500 transition-colors">{t.nav.results}</a>
            <a href="#process" className="hover:text-rose-500 transition-colors">{t.nav.process}</a>
            <a href="#packages" className="hover:text-rose-500 transition-colors">{t.nav.packages}</a>
            <a href="#addons" className="hover:text-rose-500 transition-colors">{t.nav.addons}</a>
            <a href="#testimonials" className="hover:text-rose-500 transition-colors">{t.nav.testimonials}</a>
          </div>
          <div className="flex items-center gap-3">
            <LangSwitcher lang={lang} setLang={setLang} accentClass="bg-rose-500" />
            <button onClick={() => scrollToContact()} className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-rose-500 to-pink-600 hover:shadow-lg hover:shadow-rose-500/25 transition-all hover:-translate-y-0.5">{t.nav.cta}</button>
            <LandingMobileMenu
              links={[
                { href: '#results', label: t.nav.results },
                { href: '#process', label: t.nav.process },
                { href: '#packages', label: t.nav.packages },
                { href: '#addons', label: t.nav.addons },
                { href: '#testimonials', label: t.nav.testimonials },
              ]}
              ctaLabel={t.nav.cta}
              onCta={() => scrollToContact()}
              accentClass="bg-gradient-to-r from-rose-500 to-pink-600"
            />
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-rose-50/80 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-pink-200/30 rounded-full blur-3xl" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-rose-50 border border-rose-100 mb-8">
                <div className="flex -space-x-2">{['EH', 'AK', 'BM', 'DL'].map((ini, i) => (<div key={i} className="w-7 h-7 rounded-full bg-gradient-to-br from-rose-400 to-pink-500 border-2 border-white flex items-center justify-center text-[10px] font-bold text-white">{ini}</div>))}</div>
                <span className="text-sm font-medium text-rose-700">{t.hero.badge}</span>
                <div className="flex">{[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}</div>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                {t.hero.h1a}{' '}
                <span className="bg-gradient-to-r from-rose-500 via-pink-500 to-fuchsia-500 bg-clip-text text-transparent">{t.hero.h1b}</span>{' '}{t.hero.h1c}
                <br /><span className="text-gray-400">{t.hero.h1d}</span>
              </h1>
            </FadeIn>
            <FadeIn delay={200}><p className="mt-8 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">{t.hero.sub1} <strong className="text-rose-500">{t.hero.sub2}</strong></p></FadeIn>
            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button onClick={scrollToPackages} className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-rose-500 to-pink-600 hover:shadow-xl hover:shadow-rose-500/25 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">{t.hero.ctaPrimary}<ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></button>
                <button onClick={() => scrollToContact()} className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border-2 border-gray-200 hover:border-rose-300 hover:bg-rose-50 transition-all flex items-center justify-center gap-2"><Phone className="w-5 h-5" />{t.hero.ctaSecondary}</button>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-400">
                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-500" /> {t.hero.t1}</span>
                <span className="flex items-center gap-1.5"><Lock className="w-4 h-4 text-blue-500" /> {t.hero.t2}</span>
                <span className="flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-rose-500" /> {t.hero.t3}</span>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* PAINS */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-red-500 mb-3">{t.pains.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.pains.title1} <span className="text-red-500">{t.pains.title2}</span></h2></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {t.pains.items.map((point, i) => { const Icon = PAIN_ICONS[i]; return (
              <FadeIn key={i} delay={i * 150}>
                <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 hover:shadow-lg hover:border-red-100 transition-all h-full">
                  <div className="w-14 h-14 rounded-xl bg-red-50 flex items-center justify-center mb-6"><Icon className="w-7 h-7 text-red-500" /></div>
                  <h3 className="text-xl font-bold mb-3">{point.title}</h3><p className="text-gray-600 leading-relaxed">{point.desc}</p>
                </div>
              </FadeIn>); })}
          </div>
          <FadeIn delay={500}><div className="mt-12 text-center"><p className="text-lg text-gray-700 font-medium">{t.pains.bridge1} <span className="text-rose-500 font-bold">{t.pains.bridge2}</span></p></div></FadeIn>
        </div>
      </section>

      {/* RESULTS */}
      <section id="results" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-rose-500 mb-3">{t.results.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.results.title}</h2></div></FadeIn>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {t.results.items.map((r, i) => { const Icon = RESULT_ICONS[i]; return (
              <FadeIn key={i} delay={i * 100}>
                <div className="text-center p-8 rounded-2xl bg-gradient-to-br from-rose-50 to-pink-50 border border-rose-100">
                  <Icon className="w-8 h-8 text-rose-500 mx-auto mb-4" />
                  <div className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-rose-500 to-pink-600 bg-clip-text text-transparent"><Counter end={parseFloat(r.metric)} suffix={r.suffix} /></div>
                  <p className="mt-3 text-sm text-gray-600 font-medium">{r.label}</p>
                </div>
              </FadeIn>); })}
          </div>
        </div>
      </section>

      {/* PROCESS */}
      <section id="process" className="py-24 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-rose-400 mb-3">{t.process.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.process.title}</h2><p className="mt-4 text-gray-400 max-w-xl mx-auto">{t.process.sub}</p></div></FadeIn>
          <div className="grid md:grid-cols-4 gap-6 relative">
            <div className="hidden md:block absolute top-16 left-[12%] right-[12%] h-px bg-gradient-to-r from-rose-500/50 via-pink-500/50 to-rose-500/50" />
            {t.process.steps.map((s, i) => { const Icon = PROCESS_ICONS[i]; return (
              <FadeIn key={i} delay={i * 150}>
                <div className="relative text-center p-6 rounded-2xl bg-gray-800/50 border border-gray-700 hover:border-rose-500/50 transition-all group">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center mx-auto mb-4 text-lg font-bold relative z-10">{s.step}</div>
                  <Icon className="w-6 h-6 text-rose-400 mx-auto mb-3 group-hover:scale-110 transition-transform" />
                  <h3 className="text-lg font-bold mb-2">{s.title}</h3><p className="text-gray-400 text-sm leading-relaxed">{s.desc}</p>
                </div>
              </FadeIn>); })}
          </div>
        </div>
      </section>

      {/* PACKAGES */}
      <section id="packages" className="py-24 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-rose-500 mb-3">{t.packages.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.packages.title}</h2><p className="mt-4 text-gray-600 max-w-2xl mx-auto">{t.packages.sub}</p></div></FadeIn>
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6 items-start">
            {t.packages.list.map((pkg, i) => {
              const isSelected = selectedPackage?.id === pkg.id;
              const isExpanded = expandedCard === pkg.id;
              return (
                <FadeIn key={pkg.id} delay={i * 120}>
                  <div className={`relative rounded-2xl bg-white border-2 ${pkg.border} transition-all hover:shadow-2xl ${pkg.popular ? 'shadow-xl ring-2 ring-rose-500/20' : 'shadow-sm'} ${isSelected ? 'ring-2 ring-green-500' : ''}`}>
                    {pkg.badge && (<div className={`absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-gradient-to-r ${pkg.color} text-white text-xs font-bold tracking-wide whitespace-nowrap`}>{pkg.badge}</div>)}
                    <div className="p-6">
                      <h3 className="text-2xl font-bold">{pkg.title}</h3>
                      <p className="text-sm text-gray-500 mt-1">{pkg.subtitle}</p>
                      <div className="mt-5 flex items-baseline gap-1.5">
                        <span className={`text-3xl font-bold bg-gradient-to-r ${pkg.color} bg-clip-text text-transparent`}>{pkg.price}</span>
                        {pkg.priceNote && <span className="text-sm text-gray-500">{pkg.priceNote}</span>}
                      </div>
                      <div className="mt-4 p-3 rounded-lg bg-gray-50">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t.packages.forLabel}</p>
                        <ul className="space-y-1">{pkg.targetAudience.map((a, ti) => (<li key={ti} className="text-xs text-gray-600 flex items-start gap-1.5"><span className="text-rose-400 mt-0.5">•</span>{a}</li>))}</ul>
                      </div>
                      <div className="mt-5 space-y-4">
                        {pkg.features.map((cat, ci) => (
                          <div key={ci}>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{cat.category}</p>
                            <ul className="space-y-2">
                              {(isExpanded ? cat.items : cat.items.slice(0, 4)).map((feature, fi) => (<li key={fi} className="flex items-start gap-2 text-sm text-gray-700"><CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${pkg.popular ? 'text-rose-500' : 'text-green-500'}`} />{feature}</li>))}
                            </ul>
                            {!isExpanded && cat.items.length > 4 && (<button onClick={() => setExpandedCard(pkg.id)} className="mt-2 text-xs text-rose-500 font-medium hover:underline">+{cat.items.length - 4} {t.packages.more}</button>)}
                          </div>
                        ))}
                      </div>
                      {isExpanded && (<button onClick={() => setExpandedCard(null)} className="mt-2 text-xs text-gray-400 hover:text-gray-600 font-medium">{t.packages.less}</button>)}
                      {pkg.notIncluded.length > 0 && isExpanded && (
                        <div className="mt-4 pt-4 border-t border-gray-100">
                          <p className="text-xs font-semibold uppercase tracking-wide text-red-400 mb-2">{t.packages.notIncluded}</p>
                          <ul className="space-y-1.5">{pkg.notIncluded.map((item, ni) => (<li key={ni} className="flex items-start gap-2 text-xs text-gray-500"><X className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-red-300" />{item}</li>))}</ul>
                        </div>
                      )}
                      <button onClick={() => scrollToContact(pkg)} className={`mt-6 w-full py-3.5 rounded-xl text-sm font-semibold transition-all hover:-translate-y-0.5 ${pkg.popular ? `bg-gradient-to-r ${pkg.color} text-white hover:shadow-lg hover:shadow-rose-500/25` : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}>{isSelected ? t.packages.chosen : pkg.cta}</button>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>
          <FadeIn delay={500}><p className="mt-10 text-center text-sm text-gray-500">{t.packages.note}</p></FadeIn>
        </div>
      </section>

      {/* ADD-ONS */}
      <section id="addons" className="py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-14"><p className="text-sm font-semibold uppercase tracking-widest text-rose-500 mb-3">{t.addons.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.addons.title}</h2><p className="mt-4 text-gray-600 max-w-xl mx-auto">{t.addons.sub}</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {t.addons.items.map((addon, i) => { const Icon = ADDON_ICONS[i]; return (
              <FadeIn key={i} delay={i * 80}>
                <div className="flex items-center gap-4 p-5 rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-md hover:border-rose-100 transition-all">
                  <div className="w-11 h-11 rounded-lg bg-rose-50 flex items-center justify-center flex-shrink-0"><Icon className="w-5 h-5 text-rose-500" /></div>
                  <div className="flex-1 min-w-0"><p className="font-semibold text-gray-900 text-sm">{addon.name}</p><p className="text-rose-500 font-bold text-sm">{addon.price}</p></div>
                </div>
              </FadeIn>); })}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section id="testimonials" className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-rose-500 mb-3">{t.testimonials.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.testimonials.title}</h2></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {t.testimonials.items.map((tm, i) => (
              <FadeIn key={i} delay={i * 150}>
                <div className="p-8 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg transition-all h-full flex flex-col">
                  <div className="flex mb-4">{[1,2,3,4,5].map(j => (<Star key={j} className="w-5 h-5 text-amber-400 fill-amber-400" />))}</div>
                  <p className="text-gray-700 leading-relaxed flex-1 italic">"{tm.quote}"</p>
                  <div className="mt-6 flex items-center gap-3 pt-4 border-t border-gray-100">
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center text-white font-bold text-sm">{tm.avatar}</div>
                    <div><p className="font-semibold text-sm">{tm.name}</p><p className="text-xs text-gray-500">{tm.role}</p></div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-rose-500 mb-3">{t.faq.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.faq.title}</h2></div></FadeIn>
          <div className="space-y-3">
            {t.faq.items.map((item, i) => (
              <FadeIn key={i} delay={i * 80}>
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"><span className="font-semibold text-gray-900 pr-4">{item.q}</span><ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} /></button>
                  <div className={`transition-all duration-300 overflow-hidden ${openFaq === i ? 'max-h-60 opacity-100' : 'max-h-0 opacity-0'}`}><p className="px-6 pb-5 text-gray-600 leading-relaxed">{item.a}</p></div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* CONTACT */}
      <section id="contact" className="py-24 bg-gradient-to-br from-gray-900 via-rose-900 to-gray-900 text-white relative overflow-hidden">
        <div className="absolute inset-0"><div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-rose-500/10 rounded-full blur-3xl" /><div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-pink-500/10 rounded-full blur-3xl" /></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-rose-400 mb-4">{t.contact.kicker}</p>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">{t.contact.title1} <span className="text-rose-400">{t.contact.title2}</span></h2>
                <p className="mt-5 text-gray-300 leading-relaxed text-lg">{t.contact.sub}</p>
                <div className="mt-8 space-y-4">{t.contact.perks.map((p, i) => (<div key={i} className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">{p}</span></div>))}</div>
                <div className="mt-10 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30"><p className="text-sm text-amber-300 font-medium flex items-center gap-2"><Clock className="w-4 h-4" />{t.contact.urgency}</p></div>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              {formSent ? (
                <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-10 border border-white/10 text-center">
                  <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6"><CheckCircle2 className="w-10 h-10 text-green-400" /></div>
                  <h3 className="text-2xl font-bold mb-3">{t.contact.successTitle}</h3><p className="text-gray-300">{t.contact.successBody}</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">{t.contact.formTitle}</h3>
                  {selectedPackage && (
                    <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-rose-500/20 border border-rose-500/30">
                      <div><p className="text-xs text-rose-300">{t.contact.selected}</p><p className="font-semibold text-white">{selectedPackage.title} — {selectedPackage.price}{selectedPackage.priceNote ? ` ${selectedPackage.priceNote}` : ''}</p></div>
                      <button type="button" onClick={() => setSelectedPackage(null)} className="text-rose-300 hover:text-white text-sm underline">{t.contact.change}</button>
                    </div>
                  )}
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.name}</label><input type="text" required value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500" placeholder={t.contact.namePh} /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.email}</label><input type="email" required value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500" placeholder="email@domain.com" /></div>
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.phone}</label><input type="tel" value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500" placeholder={t.contact.phonePh} /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.site}</label><input type="text" value={formData.website} onChange={e => setFormData(p => ({ ...p, website: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500" placeholder={t.contact.sitePh} /></div>
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.message}</label><textarea rows={3} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none" placeholder={t.contact.messagePh} /></div>
                  {formError && (<div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">{formError}</div>)}
                  <button type="submit" disabled={submitting} className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-400 hover:to-pink-400 text-white shadow-lg shadow-rose-500/25 transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60">{submitting ? t.contact.submitting : t.contact.submit}{!submitting && <ArrowUpRight className="w-5 h-5" />}</button>
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
          <div className="flex items-center gap-2"><div className="w-6 h-6 rounded bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center"><Sparkles className="w-3 h-3 text-white" /></div><span className="font-semibold text-white text-sm">FivoCRM</span></div>
          <p className="text-sm">&copy; {new Date().getFullYear()} FivoCRM. {t.footer.rights}</p>
          <div className="flex items-center gap-6 text-sm"><Link to="/login" className="hover:text-white transition-colors">{t.nav.login}</Link><a href="#packages" className="hover:text-white transition-colors">{t.footer.pricing}</a><a href="#contact" className="hover:text-white transition-colors">{t.footer.contact}</a></div>
        </div>
      </footer>
    </div>
  );
}
