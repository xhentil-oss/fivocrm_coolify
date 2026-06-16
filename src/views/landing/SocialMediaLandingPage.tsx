import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, Zap, CheckCircle2, ArrowRight, Star, Users,
  Target, Clock, ChevronDown, Phone, ArrowUpRight, Sparkles,
  BarChart3, X, Video, MessageSquare, Search,
  Shield, Award, Camera, Globe, Megaphone,
} from 'lucide-react';
import { LangSwitcher, type Lang } from './LangSwitcher';

/* ─── Intersection Observer ─── */
function useInView<T extends Element = HTMLDivElement>(threshold = 0.15) {
  const ref = useRef<T>(null);
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
  const { ref, visible } = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function Counter({ end, suffix = '', duration = 2000 }: { end: number; suffix?: string; duration?: number }) {
  const { ref, visible } = useInView<HTMLSpanElement>();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let start = 0;
    const step = end / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= end) { setCount(end); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [visible, end, duration]);
  return <span ref={ref as React.RefObject<HTMLSpanElement>}>{count.toLocaleString()}{suffix}</span>;
}

/* ─── Static (non-translatable) package styling ─── */
const PKG_STYLES = [
  { id: 'starter', color: 'from-pink-400 to-rose-500', border: 'border-pink-200 hover:border-pink-400', headerBg: 'bg-gradient-to-br from-pink-50 to-rose-50', popular: false },
  { id: 'growth', color: 'from-violet-500 to-purple-600', border: 'border-violet-200 hover:border-violet-400', headerBg: 'bg-gradient-to-br from-violet-50 to-purple-50', popular: true },
  { id: 'pro', color: 'from-indigo-500 to-blue-600', border: 'border-indigo-300 hover:border-indigo-500', headerBg: 'bg-gradient-to-br from-indigo-50 to-blue-50', popular: false },
  { id: 'agency', color: 'from-amber-500 to-orange-500', border: 'border-amber-200 hover:border-amber-500', headerBg: 'bg-gradient-to-br from-amber-50 to-orange-50', popular: false },
];
const COMPARE_COLORS = ['text-pink-600', 'text-violet-600', 'text-indigo-600', 'text-amber-600'];
const PAIN_ICONS = [Users, Clock, BarChart3, Search];
const PAIN_STYLE = [
  { color: 'text-rose-500', bg: 'bg-rose-50' },
  { color: 'text-amber-500', bg: 'bg-amber-50' },
  { color: 'text-orange-500', bg: 'bg-orange-50' },
  { color: 'text-purple-500', bg: 'bg-purple-50' },
];
const ADDON_ICONS = [Video, Globe, MessageSquare, Award, Camera, Shield];
const TESTI_COLORS = ['bg-pink-500', 'bg-violet-500', 'bg-indigo-500'];
const PERK_ICONS = [CheckCircle2, Target, TrendingUp, Zap];
// Add-on monthly prices (€), by add-on order. Selectable on the page.
const ADDON_PRICES = [200, 350, 150, 300, 180, 150];
const ANNUAL_DISCOUNT = 0.15;
const priceNum = (p: string) => parseInt(String(p).replace(/[^\d]/g, ''), 10) || 0;
const BILLING_T: Record<string, { monthly: string; annual: string; save: string; annualNote: string; add: string; added: string; estTitle: string; perMonth: string }> = {
  sq: { monthly: 'Mujore', annual: 'Vjetore', save: 'Kurse 15%', annualNote: 'faturuar vjetore', add: 'Shto', added: 'Shtuar ✓', estTitle: 'Vlera e përafërt', perMonth: '/muaj' },
  en: { monthly: 'Monthly', annual: 'Annual', save: 'Save 15%', annualNote: 'billed annually', add: 'Add', added: 'Added ✓', estTitle: 'Estimated value', perMonth: '/mo' },
  it: { monthly: 'Mensile', annual: 'Annuale', save: 'Risparmia 15%', annualNote: 'fatturato annualmente', add: 'Aggiungi', added: 'Aggiunto ✓', estTitle: 'Valore stimato', perMonth: '/mese' },
};

interface Pkg { title: string; subtitle: string; price: string; priceNote: string; badge: string; cta: string; targetAudience: string[]; features: { category: string; items: string[] }[]; notIncluded: string[]; }
interface Copy {
  nav: { problem: string; packages: string; process: string; faq: string; cta: string };
  hero: { badge: string; h1a: string; h1b: string; h1c: string; sub: string; cta1: string; cta2: string; t1: string; t2: string; t3: string };
  stats: { label: string }[];
  pains: { title: string; sub: string; items: { title: string; body: string }[] };
  packages: { kicker: string; title: string; sub: string; idealFor: string; notIncluded: string; note: string; pkgs: Pkg[]; compareChoose: string };
  process: { kicker: string; title: string; sub: string; steps: { n: string; title: string; body: string }[] };
  addons: { kicker: string; title: string; sub: string; items: { title: string; desc: string }[] };
  testimonials: { kicker: string; title: string; sub: string; items: { name: string; role: string; text: string; avatar: string }[] };
  faq: { kicker: string; title: string; items: { q: string; a: string }[] };
  contact: { kicker: string; titleA: string; titleB: string; sub: string; perks: string[]; formTitle: string; pkgLabel: string; name: string; namePh: string; phone: string; phonePh: string; email: string; emailPh: string; business: string; businessPh: string; message: string; messagePh: string; submit: string; submitting: string; note: string; successTitle: string; successBody: string; error: string };
  footer: { rights: string; login: string; pricing: string; contact: string };
}

const SQ: Copy = {
  nav: { problem: 'Problemi', packages: 'Paketat', process: 'Procesi', faq: 'FAQ', cta: 'Konsultim Falas' },
  hero: { badge: 'Menaxhim Profesional i Rrjeteve Sociale', h1a: 'Brand-i juaj meriton', h1b: 'prezencë të vërtetë', h1c: 'online', sub: 'Ne menaxhojmë Facebook, Instagram, TikTok dhe reklamat tuaja — ju përqendroheni te biznesi. Rezultate të matshme, jo premtime boshe.', cta1: 'Konsultim Falas', cta2: 'Shiko Paketat', t1: 'Pa kontratë afatgjatë', t2: 'Raporte transparente', t3: 'Fillojmë brenda 5 ditësh' },
  stats: [{ label: 'brand të menaxhuar' }, { label: 'rritje mesatare engagement' }, { label: 'followers të fituar' }, { label: 'klientë që ripërtërijnë' }],
  pains: { title: 'Pse nuk po rritet biznesi juaj online?', sub: 'Ne kemi ndihmuar mbi 120 biznese të kalojnë nga rrëmuja digjitale te një sistem që sjell rezultate të matshme.',
    items: [
      { title: 'Followers, por jo klientë', body: 'Keni ndjekës në Instagram, por nuk kthehen në blerës. Kontent pa strategji nuk sjell shitje — strategji pa ekzekutim nuk funksionon.' },
      { title: 'Nuk keni kohë', body: 'Postimet bëhen rastësisht ose fare nuk bëhen. Algoritmi i ndëshkon ata që nuk janë të rregullt — ju humbisni reach çdo ditë.' },
      { title: 'Reklamat hangrën buxhetin', body: 'Keni investuar në Meta Ads por rezultatet ishin zhgënjyese. Reklamat pa strategji të saktë janë para të hedhura.' },
      { title: 'Konkurrenti është kudo', body: 'Kompetitorët tuaj janë aktiv, postojnë çdo ditë dhe marrin klientët tuaj potencialë. Çdo ditë pa prezencë është mundësi e humbur.' },
    ] },
  packages: { kicker: 'Çmimet', title: '4 paketa — 1 zgjidhje e duhur për ju', sub: 'Nga 500€/muaj deri në 2,800€/muaj. Pa kontratë — ndryshoni kur dëshironi.', idealFor: 'Ideal për', notIncluded: 'Nuk përfshihet', note: '* Buxheti i reklamave paguhet direkt te platformat (Meta/Google/TikTok) — nuk përfshihet në çmim.', compareChoose: 'Zgjidh',
    pkgs: [
      { title: 'Starter', subtitle: 'Prezencë profesionale dhe aktivitet i rregullt', price: '500€', priceNote: '/ muaj + ad spend', badge: '', cta: 'Fillo me Starter', targetAudience: ['Biznese të reja online', 'Brand-e personale & influencerë fillestarë', 'Dyqane & shërbime lokale'],
        features: [{ category: 'Platformat & Kontent', items: ['Menaxhim 2 platformash (Facebook + Instagram)', '12 postime / muaj', '8 reels / muaj', 'Design grafik profesional', 'Copywriting & hashtag strategy', 'Kalendar mujor kontent', 'Publikim sipas orarit optimal'] }, { category: 'Reklama', items: ['Setup i fushatave Meta Ads', '1 fushatë aktive', 'Targetim bazë i audiencës'] }, { category: 'Raportim', items: ['Raport mujor bazë', 'KPIs: reach, engagement, followers'] }],
        notIncluded: ['Buxheti i reklamave', 'TikTok / LinkedIn / YouTube', 'Xhirime video profesionale', 'Community management', 'Google Ads'] },
      { title: 'Growth', subtitle: 'Rritje e audiencës dhe gjenerim i klientëve', price: '700€', priceNote: '/ muaj + ad spend', badge: 'Popullor', cta: 'Zgjidh Growth', targetAudience: ['Biznese në rritje që duan followers', 'E-commerce & shitje online', 'Brand-e që duan lead generation'],
        features: [{ category: 'Platformat & Kontent', items: ['Menaxhim 3 platformash (FB + IG + TikTok)', '16 postime / muaj', '14 reels / muaj', '1 ditë xhirimi kontent / muaj', 'Design grafik & branding', 'Copywriting storytelling', 'Stories / Highlights optimizim', 'Kalendar strategjik kontent'] }, { category: 'Reklama', items: ['Menaxhim i plotë Meta Ads', '2–3 fushata aktive', 'Audience targeting i avancuar', 'Optimizim javor i reklamave', 'Raportim javor performancës'] }, { category: 'Community & Raportim', items: ['Community management bazë', 'Monitorim komentesh & mentions', 'Raport mujor i detajuar'] }],
        notIncluded: ['Buxheti i reklamave', 'LinkedIn / YouTube', 'Google Ads', 'Influencer management', 'Email marketing'] },
      { title: 'Pro', subtitle: 'Dominim dixhital dhe rezultate të matshme', price: '1,400€', priceNote: '/ muaj + ad spend', badge: 'Më i Zgjedhuri', cta: 'Zgjidh Pro', targetAudience: ['Biznese serioze me objektiva të qarta', 'Brand-e që duan rritje agresive', 'Kompani me produkte/shërbime të shumta'],
        features: [{ category: 'Platformat & Kontent', items: ['Menaxhim 4 platformash (FB + IG + TikTok + LinkedIn)', '24 postime / muaj', '20 reels / muaj', '2 ditë xhirimi / muaj', 'Design grafik premium', 'Copywriting i avancuar + SEO copy', 'Video editing & subtitle', 'Stories + Reels + Carousel strategy', 'Kalendar strategjik 3-mujor'] }, { category: 'Reklama', items: ['Menaxhim i plotë Meta Ads', 'Google Search & Display Ads', '4–6 fushata aktive', 'Remarketing & retargeting', 'Lookalike audiences', 'A/B testing kreativësh', 'Optimizim i vazhdueshëm'] }, { category: 'Community & Strategji', items: ['Community management aktiv', 'Inbox management (komente + DM)', 'Brand monitoring', 'Raport javor + mujor i plotë', 'Strategji rritje 6-mujore'] }],
        notIncluded: ['Buxheti i reklamave', 'YouTube Ads', 'Influencer management', 'Email marketing automation'] },
      { title: 'Agency', subtitle: 'Zgjidhja e plotë — ekip i dedikuar për brand-in tuaj', price: '2,800€', priceNote: '/ muaj + ad spend', badge: 'Full Service', cta: 'Zgjidh Agency', targetAudience: ['Kompani të mëdha & korporata', 'Brand-e me prania multi-platformë', 'Biznese që duan ekip të dedikuar'],
        features: [{ category: 'Platformat & Kontent', items: ['Menaxhim 5 platformash (FB + IG + TikTok + LinkedIn + YouTube)', '32+ postime / muaj', '28+ reels / muaj', '3+ ditë xhirimi / muaj', 'Mini-dokumentarë & brand films', 'Podcast / Audio content', 'Design system i plotë brand', 'Copywriting multiplatformë', 'Kampanja sezonale & promovuese'] }, { category: 'Reklama Full-Funnel', items: ['Meta Ads + Google Ads + TikTok Ads', 'YouTube Ads', 'Fushata pa limit', 'Full funnel strategy (Awareness → Conversion)', 'Email marketing automation', 'CRM integration & follow-up', 'Buxhet i optimizuar cross-platform'] }, { category: 'Ekip & Strategji', items: ['Account manager i dedikuar', 'Menaxher kontent i dedikuar', 'Community management i plotë 7/7', 'Inbox + DM management', 'Influencer marketing & koordinim', 'Brand reputation management', 'Raport javor + mujor + kuartal', 'Strategji vjetore growth'] }],
        notIncluded: ['Buxheti i reklamave'] },
    ] },
  process: { kicker: 'Si Punojmë', title: 'Procesi ynë i provuar', sub: '5 hapa drejt prezencës dixhitale që sjell rezultate.',
    steps: [
      { n: '01', title: 'Audit & Strategji', body: 'Analizojmë profilin, audiencën, konkurrencën. Ndërtojmë strategji të personalizuar me qëllime të matshme.' },
      { n: '02', title: 'Brand Voice & Vizual', body: 'Krijojmë identitetin vizual, tonin e komunikimit dhe kalendarin e parë të kontentit.' },
      { n: '03', title: 'Prodhim & Publikim', body: 'Prodhojmë postime, reels, stories dhe i publikojmë sipas orarit optimal të audiencës suaj.' },
      { n: '04', title: 'Reklamim & Rritje', body: 'Aktivizojmë fushatat reklamuese, testojmë, optimizojmë — gjithmonë me fokus te ROI.' },
      { n: '05', title: 'Raportim & Iterim', body: 'Çdo muaj raport i detajuar me numra realë dhe plan aksioni për muajin vijues.' },
    ] },
  addons: { kicker: 'Shtojca', title: 'Shërbime shtesë', sub: 'Personalizoni paketën tuaj — shtoni çfarë ju nevojitet.',
    items: [
      { title: 'Produksion Video', desc: 'Xhirim dhe editim video profesionale: brand films, testimoniale, product shots.' },
      { title: 'Faqe Interneti', desc: 'Landing page ose faqe e plotë me SEO të integruar dhe lidhje me social media.' },
      { title: 'WhatsApp Marketing', desc: 'Fushata direkte te klientët nëpërmjet WhatsApp — apertura 98%.' },
      { title: 'Influencer Marketing', desc: 'Identifikim, kontaktim dhe koordinim influencerësh relevantë për brand-in tuaj.' },
      { title: 'Foto Profesionale', desc: 'Sesion fotografimi produktesh, shërbimesh ose brand lifestyle.' },
      { title: 'Reputacion Online', desc: 'Menaxhim recensionesh, komentesh negative dhe ndërtim imazhi pozitiv.' },
    ] },
  testimonials: { kicker: 'Rezultate Reale', title: 'Çfarë thonë klientët tanë', sub: 'Biznese reale — numra realë.',
    items: [
      { name: 'Elona Marku', role: 'CEO, Dyqan Mode "Lira Fashion"', text: 'Pas 2 muajsh me paketën Pro, shitjet online u rritën 340%. Reklamat e tyre janë të ndryshme — jo vetëm "boost post".', avatar: 'EM' },
      { name: 'Genti Basha', role: 'Pronar, Restaurant "Oltari"', text: 'Nga zero në 8,200 ndjekës në 4 muaj. Por më e rëndësishme — rezervimet u trefishuan.', avatar: 'GB' },
      { name: 'Anisa Çela', role: 'Drejtuese Marketing, "CleanPro Albania"', text: 'Ekipi Agency është si ekipi ynë i brendshëm, por me ekspertizë shumë më të lartë. ROI 8x brenda 6 muajsh.', avatar: 'AC' },
    ] },
  faq: { kicker: 'FAQ', title: 'Pyetjet e shpeshta',
    items: [
      { q: 'Cila paketë është e duhura për mua?', a: 'Varet nga qëllimet dhe buxheti juaj. Starter është ideal për prezencë profesionale, Growth për rritje audiencës, Pro për lead generation agresive, Agency për kompani të mëdha me nevojë për ekip të dedikuar. Gjatë konsultimit falas, ju rekomandojmë paketën e duhur.' },
      { q: 'Sa kohë duhet për të parë rezultate?', a: 'Rezultate të para (rritje engagement, followers) shfaqen brenda 30 ditëve. Lead-et dhe konvertimet fillojnë pas 4–8 javësh, ndërsa rritja e qëndrueshme ndjehet pas 3 muajsh bashkëpunimi.' },
      { q: 'Çfarë buxheti reklamash duhet?', a: 'Për paketën Starter rekomandojmë 100–200€/muaj. Growth: 200–400€/muaj. Pro: 400–800€/muaj. Agency: sipas strategjisë. Buxheti menaxhohet direkt nga ne dhe paguhet te platformat (Meta/Google).' },
      { q: 'A mund të ndryshoj paketën pas fillimit?', a: 'Po, mund të upgradoni ose downgradoni çdo muaj. Nuk kemi kontratë afatgjatë — punojmë muaj pas muaji me rezultate.' },
      { q: 'Kush prodhon materialin vizual (foto/video)?', a: 'Ne prodhojmë çdo material. Në paketat Growth e lart, përfshihet 1–3 ditë xhirimi/muaj. Mund të shtoni edhe "Foto Profesionale" si add-on nëse keni nevojë për sesion të dedikuar.' },
      { q: 'A punoni me çdo lloj biznesi?', a: 'Po. Kemi eksperiencë në: e-commerce, restorante, hotele, bukuri & estetikë, fashion, fitness, arsim, imobiliare, teknologji, shërbime profesionale dhe shumë të tjera. Strategjia personalizohet sipas industrisë.' },
    ] },
  contact: { kicker: 'Fillo Sot', titleA: 'Konsultim falas —', titleB: 'pa asnjë detyrim', sub: 'Takohemi, analizojmë gjendjen aktuale dhe ju tregojmë saktësisht çfarë mund të arrihet me brand-in tuaj online.',
    perks: ['Audit falas i profileve tuaja sociale', 'Strategji e personalizuar për industrinë tuaj', 'Projeksion i followers, engagement dhe leads', 'Fillojmë prodhimin brenda 5 ditëve pune'],
    formTitle: 'Merr Konsultimin Falas', pkgLabel: 'Paketa', name: 'Emri & Mbiemri *', namePh: 'Artan Hoxha', phone: 'Telefon *', phonePh: '+355 69 XXX XXXX', email: 'Email *', emailPh: 'info@biznesi-juaj.al', business: 'Emri i Biznesit *', businessPh: 'Biznesi juaj / Brand-i juaj', message: 'Mesazhi (opsional)', messagePh: 'Tregoni pak për biznesin dhe sfidat kryesore...', submit: 'Dërgo Kërkesën — Falas', submitting: 'Duke dërguar...', note: 'Pa detyrim. Ju kontaktojmë brenda 24 orëve.', successTitle: 'Faleminderit!', successBody: 'Kërkesa juaj u dërgua me sukses. Do t\'ju kontaktojmë brenda 24 orëve.', error: 'Diçka shkoi keq. Provoni përsëri ose na kontaktoni direkt.' },
  footer: { rights: 'Të gjitha të drejtat e rezervuara.', login: 'Hyrje', pricing: 'Çmimet', contact: 'Kontakt' },
};

const EN: Copy = {
  nav: { problem: 'The Problem', packages: 'Packages', process: 'Process', faq: 'FAQ', cta: 'Free Consultation' },
  hero: { badge: 'Professional Social Media Management', h1a: 'Your brand deserves a', h1b: 'real presence', h1c: 'online', sub: 'We manage your Facebook, Instagram, TikTok and ads — you focus on the business. Measurable results, not empty promises.', cta1: 'Free Consultation', cta2: 'See Packages', t1: 'No long-term contract', t2: 'Transparent reports', t3: 'We start within 5 days' },
  stats: [{ label: 'brands managed' }, { label: 'average engagement growth' }, { label: 'followers gained' }, { label: 'clients who renew' }],
  pains: { title: 'Why isn\'t your business growing online?', sub: 'We\'ve helped over 120 businesses move from digital chaos to a system that brings measurable results.',
    items: [
      { title: 'Followers, but not clients', body: 'You have Instagram followers, but they don\'t turn into buyers. Content without strategy doesn\'t sell — strategy without execution doesn\'t work.' },
      { title: 'You have no time', body: 'Posts happen randomly or not at all. The algorithm punishes those who aren\'t consistent — you lose reach every day.' },
      { title: 'Ads ate the budget', body: 'You invested in Meta Ads but the results disappointed. Ads without a precise strategy are money thrown away.' },
      { title: 'Competitors are everywhere', body: 'Your competitors are active, posting daily and taking your potential clients. Every day without presence is a lost opportunity.' },
    ] },
  packages: { kicker: 'Pricing', title: '4 packages — 1 right solution for you', sub: 'From €500/month up to €2,800/month. No contract — change whenever you want.', idealFor: 'Ideal for', notIncluded: 'Not included', note: '* Ad budget is paid directly to the platforms (Meta/Google/TikTok) — not included in the price.', compareChoose: 'Choose',
    pkgs: [
      { title: 'Starter', subtitle: 'Professional presence and steady activity', price: '€500', priceNote: '/ month + ad spend', badge: '', cta: 'Start with Starter', targetAudience: ['New online businesses', 'Personal brands & early influencers', 'Local shops & services'],
        features: [{ category: 'Platforms & Content', items: ['Management of 2 platforms (Facebook + Instagram)', '12 posts / month', '8 reels / month', 'Professional graphic design', 'Copywriting & hashtag strategy', 'Monthly content calendar', 'Publishing at optimal times'] }, { category: 'Ads', items: ['Meta Ads campaign setup', '1 active campaign', 'Basic audience targeting'] }, { category: 'Reporting', items: ['Basic monthly report', 'KPIs: reach, engagement, followers'] }],
        notIncluded: ['Ad budget', 'TikTok / LinkedIn / YouTube', 'Professional video shoots', 'Community management', 'Google Ads'] },
      { title: 'Growth', subtitle: 'Audience growth and client generation', price: '€700', priceNote: '/ month + ad spend', badge: 'Popular', cta: 'Choose Growth', targetAudience: ['Growing businesses wanting followers', 'E-commerce & online sales', 'Brands wanting lead generation'],
        features: [{ category: 'Platforms & Content', items: ['Management of 3 platforms (FB + IG + TikTok)', '16 posts / month', '14 reels / month', '1 content shoot day / month', 'Graphic design & branding', 'Storytelling copywriting', 'Stories / Highlights optimization', 'Strategic content calendar'] }, { category: 'Ads', items: ['Full Meta Ads management', '2–3 active campaigns', 'Advanced audience targeting', 'Weekly ad optimization', 'Weekly performance reporting'] }, { category: 'Community & Reporting', items: ['Basic community management', 'Comment & mention monitoring', 'Detailed monthly report'] }],
        notIncluded: ['Ad budget', 'LinkedIn / YouTube', 'Google Ads', 'Influencer management', 'Email marketing'] },
      { title: 'Pro', subtitle: 'Digital dominance and measurable results', price: '€1,400', priceNote: '/ month + ad spend', badge: 'Most Chosen', cta: 'Choose Pro', targetAudience: ['Serious businesses with clear goals', 'Brands wanting aggressive growth', 'Companies with multiple products/services'],
        features: [{ category: 'Platforms & Content', items: ['Management of 4 platforms (FB + IG + TikTok + LinkedIn)', '24 posts / month', '20 reels / month', '2 shoot days / month', 'Premium graphic design', 'Advanced copywriting + SEO copy', 'Video editing & subtitles', 'Stories + Reels + Carousel strategy', '3-month strategic calendar'] }, { category: 'Ads', items: ['Full Meta Ads management', 'Google Search & Display Ads', '4–6 active campaigns', 'Remarketing & retargeting', 'Lookalike audiences', 'Creative A/B testing', 'Continuous optimization'] }, { category: 'Community & Strategy', items: ['Active community management', 'Inbox management (comments + DM)', 'Brand monitoring', 'Full weekly + monthly report', '6-month growth strategy'] }],
        notIncluded: ['Ad budget', 'YouTube Ads', 'Influencer management', 'Email marketing automation'] },
      { title: 'Agency', subtitle: 'The complete solution — a dedicated team for your brand', price: '€2,800', priceNote: '/ month + ad spend', badge: 'Full Service', cta: 'Choose Agency', targetAudience: ['Large companies & corporations', 'Brands with multi-platform presence', 'Businesses wanting a dedicated team'],
        features: [{ category: 'Platforms & Content', items: ['Management of 5 platforms (FB + IG + TikTok + LinkedIn + YouTube)', '32+ posts / month', '28+ reels / month', '3+ shoot days / month', 'Mini-documentaries & brand films', 'Podcast / Audio content', 'Full brand design system', 'Multi-platform copywriting', 'Seasonal & promotional campaigns'] }, { category: 'Full-Funnel Ads', items: ['Meta Ads + Google Ads + TikTok Ads', 'YouTube Ads', 'Unlimited campaigns', 'Full funnel strategy (Awareness → Conversion)', 'Email marketing automation', 'CRM integration & follow-up', 'Optimized cross-platform budget'] }, { category: 'Team & Strategy', items: ['Dedicated account manager', 'Dedicated content manager', 'Full community management 7/7', 'Inbox + DM management', 'Influencer marketing & coordination', 'Brand reputation management', 'Weekly + monthly + quarterly report', 'Annual growth strategy'] }],
        notIncluded: ['Ad budget'] },
    ] },
  process: { kicker: 'How We Work', title: 'Our proven process', sub: '5 steps toward a digital presence that delivers results.',
    steps: [
      { n: '01', title: 'Audit & Strategy', body: 'We analyze the profile, audience and competitors. We build a custom strategy with measurable goals.' },
      { n: '02', title: 'Brand Voice & Visual', body: 'We create the visual identity, communication tone and the first content calendar.' },
      { n: '03', title: 'Production & Publishing', body: 'We produce posts, reels and stories and publish them at your audience\'s optimal times.' },
      { n: '04', title: 'Advertising & Growth', body: 'We launch ad campaigns, test and optimize — always focused on ROI.' },
      { n: '05', title: 'Reporting & Iteration', body: 'Every month a detailed report with real numbers and an action plan for the next month.' },
    ] },
  addons: { kicker: 'Add-ons', title: 'Extra services', sub: 'Customize your package — add what you need.',
    items: [
      { title: 'Video Production', desc: 'Professional video shooting and editing: brand films, testimonials, product shots.' },
      { title: 'Website', desc: 'Landing page or full website with integrated SEO and social media links.' },
      { title: 'WhatsApp Marketing', desc: 'Direct campaigns to clients via WhatsApp — 98% open rate.' },
      { title: 'Influencer Marketing', desc: 'Identifying, contacting and coordinating relevant influencers for your brand.' },
      { title: 'Professional Photos', desc: 'Photo session of products, services or brand lifestyle.' },
      { title: 'Online Reputation', desc: 'Managing reviews, negative comments and building a positive image.' },
    ] },
  testimonials: { kicker: 'Real Results', title: 'What our clients say', sub: 'Real businesses — real numbers.',
    items: [
      { name: 'Elona Marku', role: 'CEO, Fashion Store "Lira Fashion"', text: 'After 2 months on the Pro package, online sales grew 340%. Their ads are different — not just "boost post".', avatar: 'EM' },
      { name: 'Genti Basha', role: 'Owner, Restaurant "Oltari"', text: 'From zero to 8,200 followers in 4 months. But more importantly — reservations tripled.', avatar: 'GB' },
      { name: 'Anisa Çela', role: 'Marketing Director, "CleanPro Albania"', text: 'The Agency team is like our in-house team, but with much higher expertise. 8x ROI within 6 months.', avatar: 'AC' },
    ] },
  faq: { kicker: 'FAQ', title: 'Frequently asked questions',
    items: [
      { q: 'Which package is right for me?', a: 'It depends on your goals and budget. Starter is ideal for a professional presence, Growth for audience growth, Pro for aggressive lead generation, Agency for large companies needing a dedicated team. During the free consultation we recommend the right package.' },
      { q: 'How long until I see results?', a: 'First results (engagement and follower growth) appear within 30 days. Leads and conversions start after 4–8 weeks, while steady growth is felt after 3 months of collaboration.' },
      { q: 'What ad budget is needed?', a: 'For Starter we recommend €100–200/month. Growth: €200–400/month. Pro: €400–800/month. Agency: per strategy. The budget is managed directly by us and paid to the platforms (Meta/Google).' },
      { q: 'Can I change the package after starting?', a: 'Yes, you can upgrade or downgrade every month. We have no long-term contract — we work month by month with results.' },
      { q: 'Who produces the visual material (photo/video)?', a: 'We produce all material. In Growth and up, 1–3 shoot days/month are included. You can also add "Professional Photos" as an add-on if you need a dedicated session.' },
      { q: 'Do you work with any kind of business?', a: 'Yes. We have experience in: e-commerce, restaurants, hotels, beauty & aesthetics, fashion, fitness, education, real estate, technology, professional services and many more. The strategy is tailored to the industry.' },
    ] },
  contact: { kicker: 'Start Today', titleA: 'Free consultation —', titleB: 'with no obligation', sub: 'We meet, analyze the current situation and show you exactly what can be achieved with your brand online.',
    perks: ['Free audit of your social profiles', 'A strategy tailored to your industry', 'Projection of followers, engagement and leads', 'We start production within 5 working days'],
    formTitle: 'Get Your Free Consultation', pkgLabel: 'Package', name: 'Full name *', namePh: 'John Smith', phone: 'Phone *', phonePh: '+39 3XX XXX XXXX', email: 'Email *', emailPh: 'info@your-business.com', business: 'Business name *', businessPh: 'Your business / your brand', message: 'Message (optional)', messagePh: 'Tell us a bit about your business and main challenges...', submit: 'Send Request — Free', submitting: 'Sending...', note: 'No obligation. We\'ll contact you within 24 hours.', successTitle: 'Thank you!', successBody: 'Your request was sent successfully. We\'ll contact you within 24 hours.', error: 'Something went wrong. Please try again or contact us directly.' },
  footer: { rights: 'All rights reserved.', login: 'Login', pricing: 'Pricing', contact: 'Contact' },
};

const IT: Copy = {
  nav: { problem: 'Il Problema', packages: 'Pacchetti', process: 'Processo', faq: 'FAQ', cta: 'Consulenza Gratuita' },
  hero: { badge: 'Gestione Professionale dei Social', h1a: 'Il tuo brand merita una', h1b: 'presenza vera', h1c: 'online', sub: 'Gestiamo Facebook, Instagram, TikTok e le tue ads — tu pensi al business. Risultati misurabili, non promesse vuote.', cta1: 'Consulenza Gratuita', cta2: 'Vedi i Pacchetti', t1: 'Nessun contratto a lungo termine', t2: 'Report trasparenti', t3: 'Iniziamo entro 5 giorni' },
  stats: [{ label: 'brand gestiti' }, { label: 'crescita media engagement' }, { label: 'follower guadagnati' }, { label: 'clienti che rinnovano' }],
  pains: { title: 'Perché la tua attività non cresce online?', sub: 'Abbiamo aiutato oltre 120 attività a passare dal caos digitale a un sistema che porta risultati misurabili.',
    items: [
      { title: 'Follower, ma non clienti', body: 'Hai follower su Instagram, ma non si trasformano in acquirenti. Contenuti senza strategia non vendono — la strategia senza esecuzione non funziona.' },
      { title: 'Non hai tempo', body: 'I post escono a caso o non escono affatto. L\'algoritmo punisce chi non è costante — perdi reach ogni giorno.' },
      { title: 'Le ads hanno divorato il budget', body: 'Hai investito in Meta Ads ma i risultati hanno deluso. Le ads senza una strategia precisa sono soldi buttati.' },
      { title: 'I concorrenti sono ovunque', body: 'I tuoi concorrenti sono attivi, pubblicano ogni giorno e si prendono i tuoi clienti potenziali. Ogni giorno senza presenza è un\'opportunità persa.' },
    ] },
  packages: { kicker: 'Prezzi', title: '4 pacchetti — 1 soluzione giusta per te', sub: 'Da 500€/mese fino a 2.800€/mese. Nessun contratto — cambia quando vuoi.', idealFor: 'Ideale per', notIncluded: 'Non incluso', note: '* Il budget pubblicitario si paga direttamente alle piattaforme (Meta/Google/TikTok) — non incluso nel prezzo.', compareChoose: 'Scegli',
    pkgs: [
      { title: 'Starter', subtitle: 'Presenza professionale e attività regolare', price: '500€', priceNote: '/ mese + ad spend', badge: '', cta: 'Inizia con Starter', targetAudience: ['Nuove attività online', 'Personal brand & influencer alle prime armi', 'Negozi & servizi locali'],
        features: [{ category: 'Piattaforme & Contenuti', items: ['Gestione di 2 piattaforme (Facebook + Instagram)', '12 post / mese', '8 reels / mese', 'Grafica professionale', 'Copywriting & strategia hashtag', 'Calendario contenuti mensile', 'Pubblicazione negli orari ottimali'] }, { category: 'Pubblicità', items: ['Setup campagne Meta Ads', '1 campagna attiva', 'Targeting base del pubblico'] }, { category: 'Report', items: ['Report mensile base', 'KPI: reach, engagement, follower'] }],
        notIncluded: ['Budget pubblicitario', 'TikTok / LinkedIn / YouTube', 'Riprese video professionali', 'Community management', 'Google Ads'] },
      { title: 'Growth', subtitle: 'Crescita del pubblico e generazione di clienti', price: '700€', priceNote: '/ mese + ad spend', badge: 'Popolare', cta: 'Scegli Growth', targetAudience: ['Attività in crescita che vogliono follower', 'E-commerce & vendite online', 'Brand che vogliono lead generation'],
        features: [{ category: 'Piattaforme & Contenuti', items: ['Gestione di 3 piattaforme (FB + IG + TikTok)', '16 post / mese', '14 reels / mese', '1 giorno di riprese / mese', 'Grafica & branding', 'Copywriting storytelling', 'Ottimizzazione Stories / Highlights', 'Calendario contenuti strategico'] }, { category: 'Pubblicità', items: ['Gestione completa Meta Ads', '2–3 campagne attive', 'Targeting avanzato del pubblico', 'Ottimizzazione settimanale', 'Report settimanale delle performance'] }, { category: 'Community & Report', items: ['Community management base', 'Monitoraggio commenti & menzioni', 'Report mensile dettagliato'] }],
        notIncluded: ['Budget pubblicitario', 'LinkedIn / YouTube', 'Google Ads', 'Influencer management', 'Email marketing'] },
      { title: 'Pro', subtitle: 'Dominio digitale e risultati misurabili', price: '1.400€', priceNote: '/ mese + ad spend', badge: 'Il Più Scelto', cta: 'Scegli Pro', targetAudience: ['Attività serie con obiettivi chiari', 'Brand che vogliono crescita aggressiva', 'Aziende con più prodotti/servizi'],
        features: [{ category: 'Piattaforme & Contenuti', items: ['Gestione di 4 piattaforme (FB + IG + TikTok + LinkedIn)', '24 post / mese', '20 reels / mese', '2 giorni di riprese / mese', 'Grafica premium', 'Copywriting avanzato + SEO copy', 'Video editing & sottotitoli', 'Strategia Stories + Reels + Carousel', 'Calendario strategico trimestrale'] }, { category: 'Pubblicità', items: ['Gestione completa Meta Ads', 'Google Search & Display Ads', '4–6 campagne attive', 'Remarketing & retargeting', 'Lookalike audiences', 'A/B testing dei creativi', 'Ottimizzazione continua'] }, { category: 'Community & Strategia', items: ['Community management attivo', 'Gestione inbox (commenti + DM)', 'Brand monitoring', 'Report settimanale + mensile completo', 'Strategia di crescita semestrale'] }],
        notIncluded: ['Budget pubblicitario', 'YouTube Ads', 'Influencer management', 'Email marketing automation'] },
      { title: 'Agency', subtitle: 'La soluzione completa — un team dedicato al tuo brand', price: '2.800€', priceNote: '/ mese + ad spend', badge: 'Full Service', cta: 'Scegli Agency', targetAudience: ['Grandi aziende & corporation', 'Brand con presenza multi-piattaforma', 'Attività che vogliono un team dedicato'],
        features: [{ category: 'Piattaforme & Contenuti', items: ['Gestione di 5 piattaforme (FB + IG + TikTok + LinkedIn + YouTube)', '32+ post / mese', '28+ reels / mese', '3+ giorni di riprese / mese', 'Mini-documentari & brand film', 'Podcast / Contenuti audio', 'Brand design system completo', 'Copywriting multi-piattaforma', 'Campagne stagionali & promozionali'] }, { category: 'Pubblicità Full-Funnel', items: ['Meta Ads + Google Ads + TikTok Ads', 'YouTube Ads', 'Campagne illimitate', 'Strategia full funnel (Awareness → Conversione)', 'Email marketing automation', 'Integrazione CRM & follow-up', 'Budget cross-platform ottimizzato'] }, { category: 'Team & Strategia', items: ['Account manager dedicato', 'Content manager dedicato', 'Community management completo 7/7', 'Gestione Inbox + DM', 'Influencer marketing & coordinamento', 'Brand reputation management', 'Report settimanale + mensile + trimestrale', 'Strategia di crescita annuale'] }],
        notIncluded: ['Budget pubblicitario'] },
    ] },
  process: { kicker: 'Come Lavoriamo', title: 'Il nostro processo collaudato', sub: '5 passi verso una presenza digitale che porta risultati.',
    steps: [
      { n: '01', title: 'Audit & Strategia', body: 'Analizziamo il profilo, il pubblico e i concorrenti. Costruiamo una strategia su misura con obiettivi misurabili.' },
      { n: '02', title: 'Brand Voice & Visual', body: 'Creiamo l\'identità visiva, il tono di comunicazione e il primo calendario contenuti.' },
      { n: '03', title: 'Produzione & Pubblicazione', body: 'Produciamo post, reels e stories e li pubblichiamo negli orari ottimali del tuo pubblico.' },
      { n: '04', title: 'Pubblicità & Crescita', body: 'Lanciamo le campagne, testiamo e ottimizziamo — sempre con focus sul ROI.' },
      { n: '05', title: 'Report & Iterazione', body: 'Ogni mese un report dettagliato con numeri reali e un piano d\'azione per il mese successivo.' },
    ] },
  addons: { kicker: 'Extra', title: 'Servizi aggiuntivi', sub: 'Personalizza il tuo pacchetto — aggiungi ciò che ti serve.',
    items: [
      { title: 'Produzione Video', desc: 'Riprese e montaggio video professionali: brand film, testimonianze, product shot.' },
      { title: 'Sito Web', desc: 'Landing page o sito completo con SEO integrata e collegamento ai social.' },
      { title: 'WhatsApp Marketing', desc: 'Campagne dirette ai clienti via WhatsApp — apertura al 98%.' },
      { title: 'Influencer Marketing', desc: 'Identificazione, contatto e coordinamento di influencer rilevanti per il tuo brand.' },
      { title: 'Foto Professionali', desc: 'Servizio fotografico di prodotti, servizi o brand lifestyle.' },
      { title: 'Reputazione Online', desc: 'Gestione recensioni, commenti negativi e costruzione di un\'immagine positiva.' },
    ] },
  testimonials: { kicker: 'Risultati Reali', title: 'Cosa dicono i nostri clienti', sub: 'Attività reali — numeri reali.',
    items: [
      { name: 'Elona Marku', role: 'CEO, Negozio Moda "Lira Fashion"', text: 'Dopo 2 mesi col pacchetto Pro, le vendite online sono cresciute del 340%. Le loro ads sono diverse — non solo "boost post".', avatar: 'EM' },
      { name: 'Genti Basha', role: 'Titolare, Ristorante "Oltari"', text: 'Da zero a 8.200 follower in 4 mesi. Ma soprattutto — le prenotazioni sono triplicate.', avatar: 'GB' },
      { name: 'Anisa Çela', role: 'Direttrice Marketing, "CleanPro Albania"', text: 'Il team Agency è come il nostro team interno, ma con competenze molto più elevate. ROI 8x in 6 mesi.', avatar: 'AC' },
    ] },
  faq: { kicker: 'FAQ', title: 'Domande frequenti',
    items: [
      { q: 'Quale pacchetto fa per me?', a: 'Dipende dai tuoi obiettivi e dal budget. Starter è ideale per una presenza professionale, Growth per la crescita del pubblico, Pro per la lead generation aggressiva, Agency per grandi aziende che necessitano di un team dedicato. Durante la consulenza gratuita ti consigliamo il pacchetto giusto.' },
      { q: 'Quanto tempo per vedere risultati?', a: 'I primi risultati (crescita di engagement e follower) appaiono entro 30 giorni. Lead e conversioni iniziano dopo 4–8 settimane, mentre la crescita stabile si sente dopo 3 mesi di collaborazione.' },
      { q: 'Che budget pubblicitario serve?', a: 'Per Starter consigliamo 100–200€/mese. Growth: 200–400€/mese. Pro: 400–800€/mese. Agency: in base alla strategia. Il budget è gestito direttamente da noi e pagato alle piattaforme (Meta/Google).' },
      { q: 'Posso cambiare pacchetto dopo l\'inizio?', a: 'Sì, puoi fare upgrade o downgrade ogni mese. Non abbiamo contratti a lungo termine — lavoriamo mese per mese con risultati.' },
      { q: 'Chi produce il materiale visivo (foto/video)?', a: 'Produciamo tutto il materiale. Da Growth in su sono inclusi 1–3 giorni di riprese/mese. Puoi anche aggiungere "Foto Professionali" come extra se ti serve una sessione dedicata.' },
      { q: 'Lavorate con qualsiasi tipo di attività?', a: 'Sì. Abbiamo esperienza in: e-commerce, ristoranti, hotel, bellezza & estetica, moda, fitness, istruzione, immobiliare, tecnologia, servizi professionali e molto altro. La strategia è personalizzata per il settore.' },
    ] },
  contact: { kicker: 'Inizia Oggi', titleA: 'Consulenza gratuita —', titleB: 'senza alcun impegno', sub: 'Ci incontriamo, analizziamo la situazione attuale e ti mostriamo esattamente cosa si può ottenere con il tuo brand online.',
    perks: ['Audit gratuito dei tuoi profili social', 'Una strategia su misura per il tuo settore', 'Proiezione di follower, engagement e lead', 'Iniziamo la produzione entro 5 giorni lavorativi'],
    formTitle: 'Ricevi la Consulenza Gratuita', pkgLabel: 'Pacchetto', name: 'Nome e Cognome *', namePh: 'Mario Rossi', phone: 'Telefono *', phonePh: '+39 3XX XXX XXXX', email: 'Email *', emailPh: 'info@tua-attivita.it', business: 'Nome dell\'attività *', businessPh: 'La tua attività / il tuo brand', message: 'Messaggio (opzionale)', messagePh: 'Raccontaci della tua attività e delle sfide principali...', submit: 'Invia Richiesta — Gratis', submitting: 'Invio in corso...', note: 'Senza impegno. Ti contattiamo entro 24 ore.', successTitle: 'Grazie!', successBody: 'La tua richiesta è stata inviata con successo. Ti contatteremo entro 24 ore.', error: 'Qualcosa è andato storto. Riprova o contattaci direttamente.' },
  footer: { rights: 'Tutti i diritti riservati.', login: 'Accedi', pricing: 'Prezzi', contact: 'Contatti' },
};

const COPY: Record<Lang, Copy> = { sq: SQ, en: EN, it: IT };
const STAT_VALUES = [{ end: 120, suffix: '+', color: 'text-pink-600' }, { end: 450, suffix: '%', color: 'text-violet-600' }, { end: 2800, suffix: 'K+', color: 'text-indigo-600' }, { end: 99, suffix: '%', color: 'text-green-600' }];

const SocialMediaLandingPage: React.FC = () => {
  const [lang, setLang] = useState<Lang>('sq');
  const t = COPY[lang];
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [selectedPkg, setSelectedPkg] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', business: '', message: '' });
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');
  const [selectedAddons, setSelectedAddons] = useState<number[]>([]);
  const bt = BILLING_T[lang] || BILLING_T.sq;
  const toggleAddon = (i: number) => setSelectedAddons(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);
  // Monthly value: selected package (annual = −15%) + selected add-ons.
  const pkgMonthly = priceNum(t.packages.pkgs.find(x => x.title === selectedPkg)?.price || '');
  const effPkgMonthly = billing === 'annual' ? Math.round(pkgMonthly * (1 - ANNUAL_DISCOUNT)) : pkgMonthly;
  const addonsMonthly = selectedAddons.reduce((s, i) => s + (ADDON_PRICES[i] || 0), 0);
  const estMonthly = effPkgMonthly + addonsMonthly;

  const scrollToPackages = () => document.getElementById('packages')?.scrollIntoView({ behavior: 'smooth' });
  const scrollToContact = (pkg = '') => { if (pkg) setSelectedPkg(pkg); document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const addonNames = selectedAddons.map(i => t.addons.items[i]?.title).filter(Boolean);
      const billingLabel = billing === 'annual' ? bt.annual : bt.monthly;
      const fullMsg = `[${lang.toUpperCase()}] [${billingLabel}]${addonNames.length ? ` [Add-ons: ${addonNames.join(', ')}]` : ''} ${formData.message}`;
      const res = await fetch('/api/landing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          company: formData.business,
          message: fullMsg,
          packageName: selectedPkg ? `${selectedPkg}${billing === 'annual' ? ' (Vjetore)' : ''}` : '',
          estimatedValue: estMonthly,
          source: 'social-media-landing',
          category: 'SocialMedia',
        }),
      });
      if (!res.ok) throw new Error();
      setSubmitted(true);
    } catch {
      setFormError(t.contact.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">

      {/* ═══ NAVBAR ═══ */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 via-purple-500 to-indigo-500 flex items-center justify-center"><Sparkles className="w-4 h-4 text-white" /></div>
            <span className="font-bold text-lg">Fivo<span className="bg-gradient-to-r from-pink-500 to-violet-600 bg-clip-text text-transparent">Social</span></span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600">
            <a href="#problemi" className="hover:text-purple-600 transition-colors">{t.nav.problem}</a>
            <a href="#packages" className="hover:text-purple-600 transition-colors">{t.nav.packages}</a>
            <a href="#procesi" className="hover:text-purple-600 transition-colors">{t.nav.process}</a>
            <a href="#faq" className="hover:text-purple-600 transition-colors">{t.nav.faq}</a>
          </nav>
          <div className="flex items-center gap-3">
            <LangSwitcher lang={lang} setLang={setLang} accentClass="bg-purple-600" />
            <button onClick={() => scrollToContact()} className="bg-gradient-to-r from-pink-500 to-violet-600 hover:opacity-90 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-opacity shadow-sm">{t.nav.cta}</button>
          </div>
        </div>
      </header>

      {/* ═══ HERO ═══ */}
      <section className="relative pt-28 pb-24 overflow-hidden bg-gradient-to-br from-gray-950 via-purple-950 to-gray-950 text-white">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/3 w-[700px] h-[700px] bg-purple-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-pink-500/10 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-0 w-[300px] h-[300px] bg-indigo-500/10 rounded-full blur-3xl" />
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 text-sm mb-6"><Sparkles className="w-4 h-4 text-pink-300" /><span className="text-purple-200">{t.hero.badge}</span></div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight mb-6">{t.hero.h1a}{' '}<span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-400 via-purple-400 to-indigo-400">{t.hero.h1b}</span>{' '}{t.hero.h1c}</h1>
            <p className="text-lg sm:text-xl text-purple-100 mb-8 leading-relaxed max-w-2xl">{t.hero.sub}</p>
            <div className="flex flex-col sm:flex-row gap-4">
              <button onClick={() => scrollToContact()} className="flex items-center justify-center gap-2 bg-gradient-to-r from-pink-500 to-violet-600 text-white font-bold px-8 py-4 rounded-xl hover:opacity-90 transition-opacity shadow-lg text-lg"><Phone className="w-5 h-5" />{t.hero.cta1}</button>
              <button onClick={scrollToPackages} className="flex items-center justify-center gap-2 border border-white/20 text-white font-semibold px-8 py-4 rounded-xl hover:bg-white/10 transition-colors text-lg">{t.hero.cta2}<ArrowRight className="w-5 h-5" /></button>
            </div>
            <div className="flex flex-wrap items-center gap-6 mt-10 text-sm text-purple-300">
              <div className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-400" />{t.hero.t1}</div>
              <div className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-400" />{t.hero.t2}</div>
              <div className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-400" />{t.hero.t3}</div>
            </div>
          </div>
        </div>
        <div className="absolute right-8 top-1/2 -translate-y-1/2 hidden xl:flex flex-col gap-4 opacity-60">
          {['f', 'in', 'tk', 'yt', 'li'].map((p, i) => (<div key={i} className="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-white text-xs font-bold backdrop-blur">{p}</div>))}
        </div>
        <div className="absolute bottom-0 left-0 right-0"><svg viewBox="0 0 1440 60" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full"><path d="M0 60L1440 60L1440 20C1200 60 960 0 720 20C480 40 240 0 0 20L0 60Z" fill="white" /></svg></div>
      </section>

      {/* ═══ STATS ═══ */}
      <section className="py-16 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 text-center">
            {STAT_VALUES.map((s, i) => (
              <FadeIn key={i} delay={i * 100}><div><div className={`text-4xl font-extrabold ${s.color} mb-1`}><Counter end={s.end} suffix={s.suffix} /></div><p className="text-sm text-gray-500 font-medium">{t.stats[i].label}</p></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PAIN POINTS ═══ */}
      <section id="problemi" className="py-20 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <FadeIn><div className="text-center mb-14"><h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">{t.pains.title}</h2><p className="text-gray-500 max-w-xl mx-auto">{t.pains.sub}</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {t.pains.items.map((p, i) => { const Icon = PAIN_ICONS[i]; const st = PAIN_STYLE[i]; return (
              <FadeIn key={i} delay={i * 100}><div className={`${st.bg} rounded-2xl p-6 border border-gray-100`}><div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center mb-4 shadow-sm"><Icon className={`w-5 h-5 ${st.color}`} /></div><h3 className="font-bold text-gray-900 mb-2">{p.title}</h3><p className="text-sm text-gray-600 leading-relaxed">{p.body}</p></div></FadeIn>); })}
          </div>
        </div>
      </section>

      {/* ═══ PACKAGES ═══ */}
      <section id="packages" className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <FadeIn><div className="text-center mb-8"><span className="inline-block bg-purple-100 text-purple-600 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">{t.packages.kicker}</span><h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">{t.packages.title}</h2><p className="text-gray-500 max-w-xl mx-auto">{t.packages.sub}</p></div></FadeIn>
          {/* Billing toggle (monthly / annual −15%) */}
          <FadeIn>
            <div className="flex items-center justify-center gap-1 mb-12">
              <div className="inline-flex items-center bg-gray-100 rounded-full p-1">
                <button onClick={() => setBilling('monthly')} className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${billing === 'monthly' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>{bt.monthly}</button>
                <button onClick={() => setBilling('annual')} className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors flex items-center gap-1.5 ${billing === 'annual' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
                  {bt.annual}<span className="text-[10px] font-bold text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full">{bt.save}</span>
                </button>
              </div>
            </div>
          </FadeIn>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-6 items-start">
            {t.packages.pkgs.map((pkg, i) => { const style = PKG_STYLES[i]; return (
              <FadeIn key={style.id} delay={i * 100}>
                <div className={`relative bg-white rounded-2xl border-2 ${style.border} transition-all duration-300 shadow-sm hover:shadow-xl flex flex-col overflow-hidden`}>
                  {style.popular && (<div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500" />)}
                  <div className={`${style.headerBg} p-5 pb-4`}>
                    {pkg.badge && (<span className={`inline-block mb-3 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full text-white bg-gradient-to-r ${style.color}`}>{pkg.badge}</span>)}
                    <div className={`inline-flex w-9 h-9 rounded-xl items-center justify-center bg-gradient-to-br ${style.color} mb-3`}><Megaphone className="w-4 h-4 text-white" /></div>
                    <h3 className="text-xl font-extrabold text-gray-900">{pkg.title}</h3>
                    <p className="text-xs text-gray-500 mt-1 mb-3 leading-snug">{pkg.subtitle}</p>
                    {(() => {
                      const m = priceNum(pkg.price);
                      const annual = Math.round(m * (1 - ANNUAL_DISCOUNT));
                      return billing === 'annual' ? (
                        <>
                          <div className="flex items-end gap-2">
                            <span className="text-3xl font-extrabold text-gray-900">{annual.toLocaleString()}€</span>
                            <span className="text-sm text-gray-400 line-through mb-1">{m.toLocaleString()}€</span>
                          </div>
                          <p className="text-[11px] text-gray-400 mt-0.5 mb-4">{bt.perMonth} · {bt.annualNote}</p>
                        </>
                      ) : (
                        <>
                          <div className="flex items-end gap-1"><span className="text-3xl font-extrabold text-gray-900">{pkg.price}</span></div>
                          <p className="text-[11px] text-gray-400 mt-0.5 mb-4">{pkg.priceNote}</p>
                        </>
                      );
                    })()}
                    <button onClick={() => scrollToContact(pkg.title)} className={`w-full py-2.5 rounded-xl font-bold text-sm text-white bg-gradient-to-r ${style.color} hover:opacity-90 transition-opacity shadow`}>{pkg.cta}</button>
                  </div>
                  <div className="px-5 py-3 border-b border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">{t.packages.idealFor}</p>
                    <ul className="space-y-1">{pkg.targetAudience.map((a, j) => (<li key={j} className="flex items-start gap-1.5 text-[11px] text-gray-600"><CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0 mt-0.5" />{a}</li>))}</ul>
                  </div>
                  <div className="px-5 py-4 flex-1 space-y-4">
                    {pkg.features.map((sec, si) => (<div key={si}><p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">{sec.category}</p><ul className="space-y-1.5">{sec.items.map((item, ii) => (<li key={ii} className="flex items-start gap-1.5 text-[11px] text-gray-700"><CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0 mt-0.5" />{item}</li>))}</ul></div>))}
                    {pkg.notIncluded.length > 0 && (<div><p className="text-[10px] font-bold text-gray-300 uppercase tracking-wider mb-1.5">{t.packages.notIncluded}</p><ul className="space-y-1">{pkg.notIncluded.map((item, ii) => (<li key={ii} className="flex items-start gap-1.5 text-[11px] text-gray-400"><X className="w-3 h-3 text-gray-300 flex-shrink-0 mt-0.5" />{item}</li>))}</ul></div>)}
                  </div>
                </div>
              </FadeIn>); })}
          </div>
          <FadeIn><p className="text-center text-sm text-gray-400 mt-8">{t.packages.note}</p></FadeIn>
        </div>
      </section>

      {/* ═══ COMPARISON STRIP ═══ */}
      <section className="py-12 bg-gradient-to-r from-pink-50 via-purple-50 to-indigo-50 border-y border-purple-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <FadeIn>
            <div className="flex flex-wrap justify-center gap-6 text-sm">
              {t.packages.pkgs.map((pkg, i) => (
                <div key={i} className="flex items-center gap-3 bg-white rounded-xl px-5 py-3 shadow-sm border border-gray-100">
                  <span className="font-bold text-gray-900">{pkg.title}</span>
                  <span className="text-gray-300">|</span>
                  <span className={`font-extrabold text-lg ${COMPARE_COLORS[i]}`}>{pkg.price}<span className="text-xs text-gray-400 font-normal">{lang === 'it' ? '/mese' : lang === 'en' ? '/month' : '/muaj'}</span></span>
                  <button onClick={() => scrollToContact(pkg.title)} className="ml-2 text-xs text-primary hover:underline font-medium flex items-center gap-1">{t.packages.compareChoose} <ArrowRight className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══ PROCESS ═══ */}
      <section id="procesi" className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <FadeIn><div className="text-center mb-14"><span className="inline-block bg-indigo-100 text-indigo-600 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">{t.process.kicker}</span><h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">{t.process.title}</h2><p className="text-gray-500 max-w-xl mx-auto">{t.process.sub}</p></div></FadeIn>
          <div className="relative">
            <div className="hidden lg:block absolute top-8 left-[10%] right-[10%] h-0.5 bg-gradient-to-r from-pink-200 via-purple-300 to-indigo-200" />
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-8">
              {t.process.steps.map((step, i) => (
                <FadeIn key={i} delay={i * 100}><div className="relative text-center"><div className="w-16 h-16 bg-gradient-to-br from-pink-500 via-purple-500 to-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-purple-200 relative z-10"><span className="text-white font-extrabold text-lg">{step.n}</span></div><h3 className="font-bold text-gray-900 mb-2 text-sm">{step.title}</h3><p className="text-xs text-gray-500 leading-relaxed">{step.body}</p></div></FadeIn>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ ADD-ONS ═══ */}
      <section className="py-20 bg-gray-950 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_hsl(270,60%,50%,0.15),_transparent_70%)]" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
          <FadeIn><div className="text-center mb-12"><span className="inline-block bg-white/10 text-purple-300 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">{t.addons.kicker}</span><h2 className="text-3xl font-extrabold mb-3">{t.addons.title}</h2><p className="text-gray-400 max-w-xl mx-auto text-sm">{t.addons.sub}</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {t.addons.items.map((a, i) => { const Icon = ADDON_ICONS[i]; const on = selectedAddons.includes(i); const price = ADDON_PRICES[i]; return (
              <FadeIn key={i} delay={i * 80}>
                <button type="button" onClick={() => toggleAddon(i)} className={`w-full text-left rounded-2xl p-6 border transition-all ${on ? 'bg-purple-500/20 border-purple-400 ring-1 ring-purple-400' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center"><Icon className="w-5 h-5 text-purple-300" /></div>
                    {price ? <span className="text-sm font-extrabold text-white">+{price}€<span className="text-[10px] text-gray-400 font-normal">{bt.perMonth}</span></span> : null}
                  </div>
                  <h3 className="font-bold mb-2">{a.title}</h3>
                  <p className="text-sm text-gray-400 leading-relaxed mb-3">{a.desc}</p>
                  <span className={`inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full ${on ? 'bg-purple-500 text-white' : 'bg-white/10 text-purple-200'}`}>{on ? bt.added : `+ ${bt.add}`}</span>
                </button>
              </FadeIn>); })}
          </div>
          {(selectedPkg || selectedAddons.length > 0) && estMonthly > 0 && (
            <FadeIn>
              <div className="mt-10 max-w-2xl mx-auto bg-white/5 border border-purple-400/30 rounded-2xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-purple-300 uppercase tracking-wider font-bold">{bt.estTitle}</p>
                  <p className="text-2xl font-extrabold text-white">{estMonthly.toLocaleString()}€<span className="text-sm text-gray-400 font-normal">{bt.perMonth}</span></p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {selectedPkg ? `${selectedPkg} (${billing === 'annual' ? bt.annual : bt.monthly})` : ''}
                    {selectedAddons.length > 0 ? ` + ${selectedAddons.length} add-on${selectedAddons.length > 1 ? 's' : ''}` : ''}
                  </p>
                </div>
                <button onClick={() => scrollToContact(selectedPkg)} className="shrink-0 px-6 py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 hover:opacity-90 shadow flex items-center gap-2">
                  {t.packages.compareChoose} <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </FadeIn>
          )}
        </div>
      </section>

      {/* ═══ TESTIMONIALS ═══ */}
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

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="py-24 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <FadeIn><div className="text-center mb-14"><span className="inline-block bg-purple-100 text-purple-600 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">{t.faq.kicker}</span><h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">{t.faq.title}</h2></div></FadeIn>
          <div className="space-y-3">
            {t.faq.items.map((faq, i) => (
              <FadeIn key={i} delay={i * 50}><div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm"><button className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 transition-colors" onClick={() => setOpenFaq(openFaq === i ? null : i)}><span className="font-semibold text-gray-900 text-sm pr-4">{faq.q}</span><ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} /></button>{openFaq === i && (<div className="px-5 pb-5"><p className="text-sm text-gray-600 leading-relaxed">{faq.a}</p></div>)}</div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ CONTACT ═══ */}
      <section id="contact" className="py-24 bg-gradient-to-br from-gray-950 via-purple-950 to-gray-950 text-white relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none"><div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-3xl" /><div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-pink-500/10 rounded-full blur-3xl" /></div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
          <div className="grid lg:grid-cols-2 gap-14 items-start">
            <FadeIn>
              <div>
                <span className="inline-block bg-white/10 text-purple-300 text-xs font-bold px-3 py-1 rounded-full mb-6 uppercase tracking-wide">{t.contact.kicker}</span>
                <h2 className="text-3xl sm:text-4xl font-extrabold mb-6 leading-tight">{t.contact.titleA}<br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-violet-400">{t.contact.titleB}</span></h2>
                <p className="text-purple-200 mb-8 leading-relaxed">{t.contact.sub}</p>
                <div className="space-y-4">
                  {t.contact.perks.map((text, i) => { const Icon = PERK_ICONS[i]; return (
                    <div key={i} className="flex items-center gap-3"><div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0"><Icon className="w-4 h-4 text-purple-300" /></div><span className="text-purple-100 text-sm">{text}</span></div>); })}
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              {submitted ? (
                <div className="bg-white/10 backdrop-blur rounded-2xl p-10 border border-white/10 text-center"><div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-8 h-8 text-green-400" /></div><h3 className="text-2xl font-bold mb-3">{t.contact.successTitle}</h3><p className="text-purple-200 leading-relaxed">{t.contact.successBody}</p></div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">{t.contact.formTitle}</h3>
                  {selectedPkg && (<div className="flex items-center gap-2 bg-purple-500/20 rounded-lg px-4 py-2.5 text-sm border border-purple-400/30"><Sparkles className="w-4 h-4 text-purple-300" /><span className="text-purple-200">{t.contact.pkgLabel}: <strong className="text-white">{selectedPkg}</strong></span><button type="button" onClick={() => setSelectedPkg('')} className="ml-auto"><X className="w-4 h-4 text-purple-400 hover:text-white" /></button></div>)}
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div><label className="block text-xs font-semibold text-purple-200 mb-1.5">{t.contact.name}</label><input required type="text" placeholder={t.contact.namePh} value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-purple-300/60 text-sm focus:outline-none focus:border-purple-400 focus:bg-white/15 transition-colors" /></div>
                    <div><label className="block text-xs font-semibold text-purple-200 mb-1.5">{t.contact.phone}</label><input required type="tel" placeholder={t.contact.phonePh} value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-purple-300/60 text-sm focus:outline-none focus:border-purple-400 focus:bg-white/15 transition-colors" /></div>
                  </div>
                  <div><label className="block text-xs font-semibold text-purple-200 mb-1.5">{t.contact.email}</label><input required type="email" placeholder={t.contact.emailPh} value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-purple-300/60 text-sm focus:outline-none focus:border-purple-400 focus:bg-white/15 transition-colors" /></div>
                  <div><label className="block text-xs font-semibold text-purple-200 mb-1.5">{t.contact.business}</label><input required type="text" placeholder={t.contact.businessPh} value={formData.business} onChange={e => setFormData(p => ({ ...p, business: e.target.value }))} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-purple-300/60 text-sm focus:outline-none focus:border-purple-400 focus:bg-white/15 transition-colors" /></div>
                  <div><label className="block text-xs font-semibold text-purple-200 mb-1.5">{t.contact.message}</label><textarea rows={3} placeholder={t.contact.messagePh} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-purple-300/60 text-sm focus:outline-none focus:border-purple-400 focus:bg-white/15 transition-colors resize-none" /></div>
                  {formError && <p className="text-red-300 text-sm bg-red-500/10 rounded-lg px-4 py-2">{formError}</p>}
                  <button type="submit" disabled={submitting} className="w-full bg-gradient-to-r from-pink-500 to-violet-600 text-white font-bold py-4 rounded-xl hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-60 text-sm">{submitting ? (<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t.contact.submitting}</>) : (<><ArrowUpRight className="w-5 h-5" />{t.contact.submit}</>)}</button>
                  <p className="text-xs text-purple-300/70 text-center">{t.contact.note}</p>
                </form>
              )}
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="bg-gray-950 border-t border-gray-900 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500">
          <div className="flex items-center gap-2"><div className="w-6 h-6 rounded bg-gradient-to-br from-pink-500 via-purple-500 to-indigo-500 flex items-center justify-center"><Sparkles className="w-3 h-3 text-white" /></div><span>&copy; {new Date().getFullYear()} FivoCRM. {t.footer.rights}</span></div>
          <div className="flex items-center gap-6"><Link to="/login" className="hover:text-white transition-colors">{t.footer.login}</Link><a href="#packages" className="hover:text-white transition-colors">{t.footer.pricing}</a><a href="#contact" className="hover:text-white transition-colors">{t.footer.contact}</a></div>
        </div>
      </footer>

    </div>
  );
};

export default SocialMediaLandingPage;
