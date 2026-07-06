import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, TrendingUp, Shield, Zap, CheckCircle2, ArrowRight,
  Star, Users, Target, Clock, ChevronDown, Phone,
  ArrowUpRight, Sparkles, Camera, Instagram, Megaphone, BarChart3,
  X, Lock, Video, Image, Plane,
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

interface Pkg { id: string; title: string; subtitle: string; price: string; priceNote: string; targetAudience: string[]; features: { category: string; items: string[] }[]; notIncluded: string[]; popular?: boolean; badge?: string; color: string; border: string; cta: string; }
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

const ADDON_ICONS = [Video, Camera, Image, Plane, Camera, Zap];
const RESULT_ICONS = [Building2, Target, TrendingUp, Users];
const PAIN_ICONS = [Instagram, Megaphone, Clock];
const PROCESS_ICONS = [Target, Camera, Megaphone, BarChart3];

const SQ: Copy = {
  nav: { results: 'Rezultatet', process: 'Procesi', packages: 'Paketat', addons: 'Shtesa', testimonials: 'Dëshmitë', login: 'Hyr', cta: 'Fillo Tani' },
  hero: { badge: '120+ biznese na besojnë', h1a: 'Pronat tuaja meritojnë', h1b: 'vëmendje', h1c: 'në social media.', h1d: 'A po e marrin atë?',
    sub1: 'Çdo ditë, mijëra blerës potencialë shfletojnë Instagram dhe Facebook duke kërkuar pronën e ëndrrave.', sub2: 'Pa një prezencë profesionale, ata po zgjedhin konkurrentët tuaj.',
    ctaPrimary: 'Shiko Paketat', ctaSecondary: 'Konsultim Falas', t1: 'Pa kontratë afatgjatë', t2: 'Ad spend i veçantë', t3: 'Rezultate brenda muajit' },
  pains: { kicker: 'A e njeh këtë situatë?', title1: 'Pronat po qëndrojnë të pashitura', title2: 'pa nevojë',
    items: [
      { title: 'Rrjetet sociale pa strategji', desc: 'Postoni prona pa plan, pa design profesional, pa copy bindës — dhe pyesni pse nuk ka interesim.' },
      { title: 'Reklama që djegin buxhetin', desc: 'Krijoni reklama pa targeting të saktë, pa testim kreativësh — dhe humbisni para çdo ditë pa rezultate.' },
      { title: 'Koha po shkon, pronat po qëndrojnë', desc: 'Sa më shumë qëndron një pronë e pashitur, aq më shumë humbni mundësi të reja. Tregu nuk pret.' },
    ], bridge1: 'Lajmi i mirë?', bridge2: 'Ne e dimë zgjidhjen.' },
  results: { kicker: 'Rezultate të vërteta', title: 'Numrat flasin më shumë se fjalët',
    items: [{ metric: '250', suffix: '+', label: 'Prona të promovuara me sukses' }, { metric: '85', suffix: '%', label: 'Klientë që marrin lead brenda muajit' }, { metric: '3.2', suffix: 'x', label: 'Rritje e interesimit të blerësve' }, { metric: '120', suffix: '+', label: 'Agjenci dhe agjentë të kënaqur' }] },
  process: { kicker: 'Si funksionon', title: '4 hapa për sukses në social media', sub: 'Procesi ynë i provuar që sjell rezultate për agjenci real estate',
    steps: [
      { step: '01', title: 'Analiza & Strategjia', desc: 'Analizojmë pronat, targetin, dhe konkurrencën tuaj. Krijojmë strategji të tailored.' },
      { step: '02', title: 'Krijim Përmbajtjeje', desc: 'Xhirime profesionale, design grafik, copywriting bindës — gjithçka e gatshme.' },
      { step: '03', title: 'Publikim & Ads', desc: 'Publikojmë sipas kalendarit dhe lançojmë fushata reklamash me targeting të saktë.' },
      { step: '04', title: 'Optimizim & Raportim', desc: 'Monitorojmë rezultatet javor, optimizojmë fushatat, raportojmë performancën.' },
    ] },
  packages: { kicker: 'Paketat Social Media', title: 'Zgjidh paketin ideal për agjencinë tënde', sub: 'Çdo paketë përfshin strategji të personalizuar për real estate. Çmimet nuk përfshijnë buxhetin e reklamave (ad spend).',
    forLabel: 'Për:', more: 'më shumë...', less: 'Shfaq më pak', notIncluded: 'Nuk përfshihet:', chosen: '✓ Zgjedhur', note: 'Të gjitha çmimet janë në Euro (€). Buxheti i reklamave (ad spend) nuk përfshihet. TVSH nuk përfshihet. Faturim mujor.',
    list: [
      { id: 'starter', title: 'Starter', subtitle: 'Prezencë profesionale dhe aktivitet i rregullt', price: '700€', priceNote: '/ muaj + ad spend', targetAudience: ['Agjentë individualë', 'Agjenci të vogla', 'Klientë që duan prezencë profesionale'],
        features: [{ category: 'Përmbajtja & Menaxhimi', items: ['Menaxhim i 2 platformave (Facebook + Instagram)', '12 postime / muaj', '10 reels / muaj', 'Design grafik për postimet', 'Copywriting për përshkrimet', 'Publikim sipas kalendarit', '1 content session / muaj', 'Menaxhim bazë i faqes', 'Raport mujor bazë'] }, { category: 'Ads & Reklama', items: ['Setup bazë i fushatave', 'Menaxhim bazë i reklamave', 'Optimizim i thjeshtë'] }],
        notIncluded: ['Buxheti i reklamave', 'Drone', 'Xhirime të shumta pronash', 'Community management i avancuar', 'Landing page / website changes'], color: 'from-sky-500 to-blue-600', border: 'border-sky-200 hover:border-sky-400', cta: 'Fillo me Starter' },
      { id: 'growth', title: 'Growth', subtitle: 'Jo vetëm prezencë — por edhe lead-e', price: '1,100€', priceNote: '/ muaj + ad spend', popular: true, badge: 'Më i Popullarizuari', targetAudience: ['Agjenci që duan më shumë volum', 'Klientë që duan lead generation'],
        features: [{ category: 'Përmbajtja & Menaxhimi', items: ['Menaxhim i 2 platformave', '16 postime / muaj', '20 reels / muaj', 'Design grafik', 'Copywriting', 'Publikim sipas kalendarit', '1 ditë xhirimi / muaj', 'Përmbajtje për prona + brand content', 'Menaxhim bazë i komenteve dhe inbox-it', 'Raport mujor performance'] }, { category: 'Ads & Reklama', items: ['Menaxhim i plotë i Meta Ads', 'Krijim fushatash', 'Testim kreativësh', 'Audience targeting', 'Optimizim javor', 'Raportim i rezultateve'] }],
        notIncluded: ['Buxheti i reklamave', 'Drone i përfshirë rregullisht', 'Xhirime shtesë jashtë ditës mujore', 'Foto/video për volum të lartë pronash'], color: 'from-emerald-500 to-teal-600', border: 'border-emerald-200 hover:border-emerald-400', cta: 'Zgjidh Growth' },
      { id: 'pro', title: 'Pro', subtitle: 'Prezencë e fortë dhe lead generation agresive', price: '1,600€', priceNote: '/ muaj + ad spend', badge: 'Maksimum Rezultate', targetAudience: ['Agjenci serioze', 'Kompani me disa prona aktive', 'Klientë që duan lead generation agresive'],
        features: [{ category: 'Përmbajtja & Menaxhimi', items: ['Menaxhim i 2–3 platformave', '20 postime / muaj', '25 reels / muaj', 'Design grafik premium', 'Copywriting i avancuar', 'Publikim dhe planifikim mujor', '2 ditë xhirimi / muaj', 'Foto + video për prona', 'Content për brand personal / agjentë', 'Community management aktiv', 'Raportim i detajuar mujor'] }, { category: 'Ads & Reklama', items: ['Menaxhim i plotë i Meta Ads', 'Lead generation campaigns', 'Retargeting', 'Audience segmentation', 'Testim i shumë kreativëve', 'Optimizim i rregullt i performancës'] }],
        notIncluded: ['Buxheti i reklamave', 'Produksion pa limit', 'Drone në çdo xhirim', 'Landing pages / website development', 'Event coverage ose launch campaigns të veçanta'], color: 'from-amber-500 to-orange-600', border: 'border-amber-200 hover:border-amber-400', cta: 'Zgjidh Pro' },
      { id: 'custom', title: 'Custom', subtitle: 'Zgjidhje e plotë sipas nevojave tuaja', price: 'Sipas kërkesës', priceNote: '', targetAudience: ['Developer-a', 'Kompani me shumë projekte', 'Volum të lartë pronash', 'Nevoja të veçanta'],
        features: [{ category: 'Mund të përfshijë', items: ['Më shumë platforma sociale', 'Më shumë xhirime mujore', 'Drone profesionale', 'Video tour profesionale', 'Launch campaigns', 'Event coverage', 'Ads me buxhet të lartë', 'Strategji e personalizuar mujore'] }],
        notIncluded: [], color: 'from-purple-600 to-indigo-600', border: 'border-purple-200 hover:border-purple-400', cta: 'Na Kontaktoni' },
    ] },
  addons: { kicker: 'Shtesa Extra', title: 'Personalizo paketën tënde', sub: 'Shto shërbime ekstra sipas nevojave të projekteve tuaja specifike.',
    items: [{ name: 'Reel shtesë', price: '50€ – 80€' }, { name: 'Xhirim shtesë prone', price: '150€ – 250€' }, { name: 'Ditë ekstra xhirimi', price: '200€ – 350€' }, { name: 'Drone add-on', price: '100€ – 150€' }, { name: 'Foto shtesë prone', price: '80€ – 150€' }, { name: 'Montazh i avancuar / urgent', price: 'Sipas kërkesës' }] },
  testimonials: { kicker: 'Dëshmi klientësh', title: 'Çfarë thonë agjencitë real estate',
    items: [{ name: 'Andi Shehu', role: 'Drejtor, Elite Properties', quote: 'Brenda 2 muajve filluan të vijnë lead-e serioze. Prezenca jonë në Instagram u transformua komplet — klientë na gjejnë vetë tani.', avatar: 'AS' }, { name: 'Gentiana Rexhepi', role: 'Agjente, Prime Real Estate', quote: 'Reels-et që krijuan për pronat e mia kanë mijëra shikime. Klientët më kontaktojnë direkt nga Instagram — ROI fantastik.', avatar: 'GR' }, { name: 'Blerim Koci', role: 'CEO, Tirana Invest Group', quote: 'Kemi provuar disa agjenci marketingu — askush si këta. Strategjia, ekzekutimi, dhe raportet janë në nivel tjetër.', avatar: 'BK' }] },
  faq: { kicker: 'FAQ', title: 'Pyetjet më të shpeshta',
    items: [
      { q: 'Çfarë përfshihet në buxhetin e reklamave (ad spend)?', a: 'Buxheti i reklamave (ad spend) paguhet direkt tek Meta (Facebook/Instagram) dhe nuk përfshihet në çmimin e paketës. Ne menaxhojmë se si shpenzohet, por shuma është e veçantë. Zakonisht rekomandojmë 300€–1,000€/muaj varësisht nga objektivat.' },
      { q: 'Sa kohë duhet për të parë rezultate?', a: 'Prezenca profesionale ndikon menjëherë. Për lead generation përmes reklamave, rezultatet e para vijnë zakonisht brenda 2–4 javëve. Strategjia e plotë ndërtohet brenda 2–3 muajve.' },
      { q: 'A mund ta ndryshoj paketin gjatë rrugës?', a: 'Po, absolutisht. Mund të upgrade-oni ose ndryshoni paketin çdo muaj. Na njoftoni 7 ditë para rifillimit të muajit.' },
      { q: 'A bëni xhirime me drone?', a: 'Drone nuk përfshihet si standard në paketat Starter dhe Growth, por mund të shtohet si add-on (100€–150€ per xhirim). Në paketin Custom përfshihet sipas nevojave.' },
      { q: 'Sa prona mund të promovohen në muaj?', a: 'Varet nga paketa. Starter mbulon aktivitet të përgjithshëm, Growth përfshin 1 ditë xhirimi dedikuar pronave, ndërsa Pro ka 2 ditë xhirimi. Për volum të lartë, paketa Custom është zgjidhja ideale.' },
    ] },
  contact: { kicker: 'Gati për të filluar?', title1: 'Pronat tuaja duhet parë nga', title2: 'blerësi i duhur', sub: 'Plotëso formularin dhe merr një konsultim falas me ekipin tonë. Do analizojmë prezencën tuaj në social media dhe do tregojmë mundësitë konkrete për lead generation.',
    perks: ['Audit falas i prezencës në social media', 'Analizë e konkurrentëve në industri', 'Propozim strategjie pa detyrim'], urgency: 'Kapacitet i limituar: pranojmë vetëm 8 agjenci të reja çdo muaj.',
    formTitle: 'Merr konsultimin falas', selected: 'Paketa e zgjedhur', change: 'Ndrysho', name: 'Emri i plotë *', namePh: 'Emri Mbiemri', email: 'Email *', phone: 'Telefon', phonePh: '+355 6X XXX XXXX', site: 'Website / Instagram (nëse keni)', sitePh: 'https://example.com ose @instagram', message: 'Mesazh (opsional)', messagePh: 'Na tregoni pak për agjencinë tuaj dhe nevojat tuaja...', submit: 'Dërgo Kërkesën', submitting: 'Duke dërguar...', privacy: 'Duke dërguar pranoni politikën e privatësisë. Nuk do merrni spam.', successTitle: 'Faleminderit!', successBody: 'Kërkesa jote u dërgua me sukses. Ekipi ynë do t\'ju kontaktojë brenda 24 orëve.', error: 'Diçka shkoi keq. Provoni përsëri.' },
  footer: { rights: 'Të gjitha të drejtat e rezervuara.', pricing: 'Çmimet', contact: 'Kontakt' },
};

const EN: Copy = {
  nav: { results: 'Results', process: 'Process', packages: 'Packages', addons: 'Add-ons', testimonials: 'Testimonials', login: 'Login', cta: 'Get Started' },
  hero: { badge: '120+ businesses trust us', h1a: 'Your properties deserve', h1b: 'attention', h1c: 'on social media.', h1d: 'Are they getting it?',
    sub1: 'Every day, thousands of potential buyers scroll Instagram and Facebook looking for their dream property.', sub2: 'Without a professional presence, they\'re choosing your competitors.',
    ctaPrimary: 'See Packages', ctaSecondary: 'Free Consultation', t1: 'No long-term contract', t2: 'Ad spend separate', t3: 'Results within the month' },
  pains: { kicker: 'Sound familiar?', title1: 'Properties are sitting unsold', title2: 'needlessly',
    items: [
      { title: 'Social media with no strategy', desc: 'You post properties with no plan, no professional design, no compelling copy — and wonder why there\'s no interest.' },
      { title: 'Ads that burn the budget', desc: 'You create ads without precise targeting, without creative testing — and lose money every day with no results.' },
      { title: 'Time passes, properties stay', desc: 'The longer a property stays unsold, the more new opportunities you lose. The market doesn\'t wait.' },
    ], bridge1: 'The good news?', bridge2: 'We know the solution.' },
  results: { kicker: 'Real results', title: 'Numbers speak louder than words',
    items: [{ metric: '250', suffix: '+', label: 'Properties successfully promoted' }, { metric: '85', suffix: '%', label: 'Clients getting leads within the month' }, { metric: '3.2', suffix: 'x', label: 'Growth in buyer interest' }, { metric: '120', suffix: '+', label: 'Happy agencies and agents' }] },
  process: { kicker: 'How it works', title: '4 steps to social media success', sub: 'Our proven process that brings results for real estate agencies',
    steps: [
      { step: '01', title: 'Analysis & Strategy', desc: 'We analyze your properties, target and competitors. We build a tailored strategy.' },
      { step: '02', title: 'Content Creation', desc: 'Professional shoots, graphic design, persuasive copywriting — all ready to go.' },
      { step: '03', title: 'Publishing & Ads', desc: 'We publish on schedule and launch ad campaigns with precise targeting.' },
      { step: '04', title: 'Optimization & Reporting', desc: 'We monitor results weekly, optimize campaigns and report performance.' },
    ] },
  packages: { kicker: 'Social Media Packages', title: 'Choose the ideal plan for your agency', sub: 'Every package includes a strategy tailored to real estate. Prices exclude ad spend.',
    forLabel: 'For:', more: 'more...', less: 'Show less', notIncluded: 'Not included:', chosen: '✓ Selected', note: 'All prices in Euro (€). Ad spend not included. VAT not included. Monthly billing.',
    list: [
      { id: 'starter', title: 'Starter', subtitle: 'Professional presence and steady activity', price: '€700', priceNote: '/ month + ad spend', targetAudience: ['Individual agents', 'Small agencies', 'Clients wanting a professional presence'],
        features: [{ category: 'Content & Management', items: ['Management of 2 platforms (Facebook + Instagram)', '12 posts / month', '10 reels / month', 'Graphic design for posts', 'Copywriting for descriptions', 'Scheduled publishing', '1 content session / month', 'Basic page management', 'Basic monthly report'] }, { category: 'Ads', items: ['Basic campaign setup', 'Basic ad management', 'Simple optimization'] }],
        notIncluded: ['Ad budget', 'Drone', 'Multiple property shoots', 'Advanced community management', 'Landing page / website changes'], color: 'from-sky-500 to-blue-600', border: 'border-sky-200 hover:border-sky-400', cta: 'Start with Starter' },
      { id: 'growth', title: 'Growth', subtitle: 'Not just presence — but leads', price: '€1,100', priceNote: '/ month + ad spend', popular: true, badge: 'Most Popular', targetAudience: ['Agencies wanting more volume', 'Clients wanting lead generation'],
        features: [{ category: 'Content & Management', items: ['Management of 2 platforms', '16 posts / month', '20 reels / month', 'Graphic design', 'Copywriting', 'Scheduled publishing', '1 shoot day / month', 'Content for properties + brand content', 'Basic comment & inbox management', 'Monthly performance report'] }, { category: 'Ads', items: ['Full Meta Ads management', 'Campaign creation', 'Creative testing', 'Audience targeting', 'Weekly optimization', 'Results reporting'] }],
        notIncluded: ['Ad budget', 'Regularly included drone', 'Extra shoots beyond the monthly day', 'Photo/video for high property volume'], color: 'from-emerald-500 to-teal-600', border: 'border-emerald-200 hover:border-emerald-400', cta: 'Choose Growth' },
      { id: 'pro', title: 'Pro', subtitle: 'Strong presence and aggressive lead generation', price: '€1,600', priceNote: '/ month + ad spend', badge: 'Maximum Results', targetAudience: ['Serious agencies', 'Companies with several active properties', 'Clients wanting aggressive lead generation'],
        features: [{ category: 'Content & Management', items: ['Management of 2–3 platforms', '20 posts / month', '25 reels / month', 'Premium graphic design', 'Advanced copywriting', 'Monthly publishing & planning', '2 shoot days / month', 'Photo + video for properties', 'Content for personal brand / agents', 'Active community management', 'Detailed monthly reporting'] }, { category: 'Ads', items: ['Full Meta Ads management', 'Lead generation campaigns', 'Retargeting', 'Audience segmentation', 'Multi-creative testing', 'Regular performance optimization'] }],
        notIncluded: ['Ad budget', 'Unlimited production', 'Drone on every shoot', 'Landing pages / website development', 'Event coverage or special launch campaigns'], color: 'from-amber-500 to-orange-600', border: 'border-amber-200 hover:border-amber-400', cta: 'Choose Pro' },
      { id: 'custom', title: 'Custom', subtitle: 'A complete solution tailored to your needs', price: 'On request', priceNote: '', targetAudience: ['Developers', 'Companies with many projects', 'High property volume', 'Special needs'],
        features: [{ category: 'May include', items: ['More social platforms', 'More monthly shoots', 'Professional drone', 'Professional video tour', 'Launch campaigns', 'Event coverage', 'High-budget ads', 'Personalized monthly strategy'] }],
        notIncluded: [], color: 'from-purple-600 to-indigo-600', border: 'border-purple-200 hover:border-purple-400', cta: 'Contact Us' },
    ] },
  addons: { kicker: 'Extra Add-ons', title: 'Customize your package', sub: 'Add extra services based on your specific project needs.',
    items: [{ name: 'Extra reel', price: '€50 – €80' }, { name: 'Extra property shoot', price: '€150 – €250' }, { name: 'Extra shoot day', price: '€200 – €350' }, { name: 'Drone add-on', price: '€100 – €150' }, { name: 'Extra property photos', price: '€80 – €150' }, { name: 'Advanced / urgent editing', price: 'On request' }] },
  testimonials: { kicker: 'Client testimonials', title: 'What real estate agencies say',
    items: [{ name: 'Andi Shehu', role: 'Director, Elite Properties', quote: 'Within 2 months serious leads started coming in. Our Instagram presence was completely transformed — clients find us themselves now.', avatar: 'AS' }, { name: 'Gentiana Rexhepi', role: 'Agent, Prime Real Estate', quote: 'The reels they created for my properties have thousands of views. Clients contact me straight from Instagram — fantastic ROI.', avatar: 'GR' }, { name: 'Blerim Koci', role: 'CEO, Tirana Invest Group', quote: 'We tried several marketing agencies — none like these. The strategy, execution and reports are on another level.', avatar: 'BK' }] },
  faq: { kicker: 'FAQ', title: 'Frequently asked questions',
    items: [
      { q: 'What is included in the ad spend?', a: 'Ad spend is paid directly to Meta (Facebook/Instagram) and is not included in the package price. We manage how it\'s spent, but the amount is separate. We usually recommend €300–€1,000/month depending on objectives.' },
      { q: 'How long until I see results?', a: 'A professional presence has an immediate impact. For lead generation via ads, first results usually come within 2–4 weeks. The full strategy is built within 2–3 months.' },
      { q: 'Can I change the plan along the way?', a: 'Yes, absolutely. You can upgrade or change the plan every month. Just notify us 7 days before the month renews.' },
      { q: 'Do you do drone shoots?', a: 'Drone is not standard in Starter and Growth, but can be added as an add-on (€100–€150 per shoot). Custom includes it as needed.' },
      { q: 'How many properties can be promoted per month?', a: 'It depends on the package. Starter covers general activity, Growth includes 1 shoot day dedicated to properties, while Pro has 2 shoot days. For high volume, the Custom package is ideal.' },
    ] },
  contact: { kicker: 'Ready to start?', title1: 'Your properties should be seen by', title2: 'the right buyer', sub: 'Fill in the form and get a free consultation with our team. We\'ll analyze your social media presence and show concrete opportunities for lead generation.',
    perks: ['Free social media presence audit', 'Competitor analysis in the industry', 'Strategy proposal with no obligation'], urgency: 'Limited capacity: we only take 8 new agencies each month.',
    formTitle: 'Get your free consultation', selected: 'Selected package', change: 'Change', name: 'Full name *', namePh: 'First Last', email: 'Email *', phone: 'Phone', phonePh: '+39 3XX XXX XXXX', site: 'Website / Instagram (if any)', sitePh: 'https://example.com or @instagram', message: 'Message (optional)', messagePh: 'Tell us a bit about your agency and your needs...', submit: 'Send Request', submitting: 'Sending...', privacy: 'By submitting you accept the privacy policy. No spam.', successTitle: 'Thank you!', successBody: 'Your request was sent successfully. Our team will contact you within 24 hours.', error: 'Something went wrong. Please try again.' },
  footer: { rights: 'All rights reserved.', pricing: 'Pricing', contact: 'Contact' },
};

const IT: Copy = {
  nav: { results: 'Risultati', process: 'Processo', packages: 'Pacchetti', addons: 'Extra', testimonials: 'Testimonianze', login: 'Accedi', cta: 'Inizia Ora' },
  hero: { badge: '120+ attività si fidano di noi', h1a: 'I tuoi immobili meritano', h1b: 'attenzione', h1c: 'sui social.', h1d: 'La stanno ricevendo?',
    sub1: 'Ogni giorno migliaia di potenziali acquirenti scorrono Instagram e Facebook cercando l\'immobile dei loro sogni.', sub2: 'Senza una presenza professionale, scelgono i tuoi concorrenti.',
    ctaPrimary: 'Vedi i Pacchetti', ctaSecondary: 'Consulenza Gratuita', t1: 'Nessun contratto a lungo termine', t2: 'Budget pubblicitario separato', t3: 'Risultati entro il mese' },
  pains: { kicker: 'Ti suona familiare?', title1: 'Gli immobili restano invenduti', title2: 'inutilmente',
    items: [
      { title: 'Social senza strategia', desc: 'Pubblichi immobili senza piano, senza design professionale, senza testi convincenti — e ti chiedi perché non c\'è interesse.' },
      { title: 'Pubblicità che brucia il budget', desc: 'Crei annunci senza targeting preciso, senza test dei creativi — e perdi denaro ogni giorno senza risultati.' },
      { title: 'Il tempo passa, gli immobili restano', desc: 'Più a lungo un immobile resta invenduto, più opportunità nuove perdi. Il mercato non aspetta.' },
    ], bridge1: 'La buona notizia?', bridge2: 'Conosciamo la soluzione.' },
  results: { kicker: 'Risultati reali', title: 'I numeri parlano più delle parole',
    items: [{ metric: '250', suffix: '+', label: 'Immobili promossi con successo' }, { metric: '85', suffix: '%', label: 'Clienti che ricevono lead entro il mese' }, { metric: '3.2', suffix: 'x', label: 'Crescita dell\'interesse degli acquirenti' }, { metric: '120', suffix: '+', label: 'Agenzie e agenti soddisfatti' }] },
  process: { kicker: 'Come funziona', title: '4 passi verso il successo sui social', sub: 'Il nostro processo collaudato che porta risultati alle agenzie immobiliari',
    steps: [
      { step: '01', title: 'Analisi & Strategia', desc: 'Analizziamo i tuoi immobili, il target e la concorrenza. Creiamo una strategia su misura.' },
      { step: '02', title: 'Creazione Contenuti', desc: 'Riprese professionali, grafica, copywriting persuasivo — tutto pronto.' },
      { step: '03', title: 'Pubblicazione & Ads', desc: 'Pubblichiamo secondo il calendario e lanciamo campagne con targeting preciso.' },
      { step: '04', title: 'Ottimizzazione & Report', desc: 'Monitoriamo i risultati ogni settimana, ottimizziamo le campagne e riportiamo le performance.' },
    ] },
  packages: { kicker: 'Pacchetti Social Media', title: 'Scegli il piano ideale per la tua agenzia', sub: 'Ogni pacchetto include una strategia su misura per l\'immobiliare. I prezzi escludono il budget pubblicitario.',
    forLabel: 'Per:', more: 'altro...', less: 'Mostra meno', notIncluded: 'Non incluso:', chosen: '✓ Selezionato', note: 'Tutti i prezzi in Euro (€). Budget pubblicitario non incluso. IVA esclusa. Fatturazione mensile.',
    list: [
      { id: 'starter', title: 'Starter', subtitle: 'Presenza professionale e attività regolare', price: '700€', priceNote: '/ mese + ad spend', targetAudience: ['Agenti individuali', 'Piccole agenzie', 'Clienti che vogliono una presenza professionale'],
        features: [{ category: 'Contenuti & Gestione', items: ['Gestione di 2 piattaforme (Facebook + Instagram)', '12 post / mese', '10 reels / mese', 'Grafica per i post', 'Copywriting per le descrizioni', 'Pubblicazione programmata', '1 sessione contenuti / mese', 'Gestione base della pagina', 'Report mensile base'] }, { category: 'Pubblicità', items: ['Setup base delle campagne', 'Gestione base degli annunci', 'Ottimizzazione semplice'] }],
        notIncluded: ['Budget pubblicitario', 'Drone', 'Riprese di più immobili', 'Community management avanzato', 'Modifiche landing page / sito'], color: 'from-sky-500 to-blue-600', border: 'border-sky-200 hover:border-sky-400', cta: 'Inizia con Starter' },
      { id: 'growth', title: 'Growth', subtitle: 'Non solo presenza — ma lead', price: '1.100€', priceNote: '/ mese + ad spend', popular: true, badge: 'Più Popolare', targetAudience: ['Agenzie che vogliono più volume', 'Clienti che vogliono lead generation'],
        features: [{ category: 'Contenuti & Gestione', items: ['Gestione di 2 piattaforme', '16 post / mese', '20 reels / mese', 'Grafica', 'Copywriting', 'Pubblicazione programmata', '1 giorno di riprese / mese', 'Contenuti per immobili + brand content', 'Gestione base di commenti e inbox', 'Report mensile delle performance'] }, { category: 'Pubblicità', items: ['Gestione completa Meta Ads', 'Creazione campagne', 'Test dei creativi', 'Targeting del pubblico', 'Ottimizzazione settimanale', 'Report dei risultati'] }],
        notIncluded: ['Budget pubblicitario', 'Drone incluso regolarmente', 'Riprese extra oltre il giorno mensile', 'Foto/video per alto volume di immobili'], color: 'from-emerald-500 to-teal-600', border: 'border-emerald-200 hover:border-emerald-400', cta: 'Scegli Growth' },
      { id: 'pro', title: 'Pro', subtitle: 'Presenza forte e lead generation aggressiva', price: '1.600€', priceNote: '/ mese + ad spend', badge: 'Massimi Risultati', targetAudience: ['Agenzie serie', 'Aziende con diversi immobili attivi', 'Clienti che vogliono lead generation aggressiva'],
        features: [{ category: 'Contenuti & Gestione', items: ['Gestione di 2–3 piattaforme', '20 post / mese', '25 reels / mese', 'Grafica premium', 'Copywriting avanzato', 'Pubblicazione e pianificazione mensile', '2 giorni di riprese / mese', 'Foto + video per immobili', 'Contenuti per personal brand / agenti', 'Community management attivo', 'Report mensile dettagliato'] }, { category: 'Pubblicità', items: ['Gestione completa Meta Ads', 'Campagne di lead generation', 'Retargeting', 'Segmentazione del pubblico', 'Test di più creativi', 'Ottimizzazione regolare delle performance'] }],
        notIncluded: ['Budget pubblicitario', 'Produzione illimitata', 'Drone in ogni ripresa', 'Sviluppo landing page / sito', 'Copertura eventi o campagne di lancio speciali'], color: 'from-amber-500 to-orange-600', border: 'border-amber-200 hover:border-amber-400', cta: 'Scegli Pro' },
      { id: 'custom', title: 'Custom', subtitle: 'Una soluzione completa su misura', price: 'Su richiesta', priceNote: '', targetAudience: ['Developer', 'Aziende con molti progetti', 'Alto volume di immobili', 'Esigenze speciali'],
        features: [{ category: 'Può includere', items: ['Più piattaforme social', 'Più riprese mensili', 'Drone professionale', 'Video tour professionale', 'Campagne di lancio', 'Copertura eventi', 'Ads ad alto budget', 'Strategia mensile personalizzata'] }],
        notIncluded: [], color: 'from-purple-600 to-indigo-600', border: 'border-purple-200 hover:border-purple-400', cta: 'Contattaci' },
    ] },
  addons: { kicker: 'Extra', title: 'Personalizza il tuo pacchetto', sub: 'Aggiungi servizi extra in base alle esigenze specifiche dei tuoi progetti.',
    items: [{ name: 'Reel extra', price: '50€ – 80€' }, { name: 'Ripresa extra immobile', price: '150€ – 250€' }, { name: 'Giorno di ripresa extra', price: '200€ – 350€' }, { name: 'Drone add-on', price: '100€ – 150€' }, { name: 'Foto extra immobile', price: '80€ – 150€' }, { name: 'Montaggio avanzato / urgente', price: 'Su richiesta' }] },
  testimonials: { kicker: 'Testimonianze clienti', title: 'Cosa dicono le agenzie immobiliari',
    items: [{ name: 'Andi Shehu', role: 'Direttore, Elite Properties', quote: 'In 2 mesi hanno iniziato ad arrivare lead seri. La nostra presenza su Instagram si è trasformata completamente — ora i clienti ci trovano da soli.', avatar: 'AS' }, { name: 'Gentiana Rexhepi', role: 'Agente, Prime Real Estate', quote: 'I reel che hanno creato per i miei immobili hanno migliaia di visualizzazioni. I clienti mi contattano direttamente da Instagram — ROI fantastico.', avatar: 'GR' }, { name: 'Blerim Koci', role: 'CEO, Tirana Invest Group', quote: 'Abbiamo provato diverse agenzie — nessuna come loro. La strategia, l\'esecuzione e i report sono a un altro livello.', avatar: 'BK' }] },
  faq: { kicker: 'FAQ', title: 'Domande frequenti',
    items: [
      { q: 'Cosa è incluso nel budget pubblicitario (ad spend)?', a: 'Il budget pubblicitario si paga direttamente a Meta (Facebook/Instagram) e non è incluso nel prezzo del pacchetto. Noi gestiamo come viene speso, ma l\'importo è separato. Di solito consigliamo 300€–1.000€/mese a seconda degli obiettivi.' },
      { q: 'Quanto tempo per vedere risultati?', a: 'Una presenza professionale ha un impatto immediato. Per la lead generation tramite ads, i primi risultati arrivano di solito entro 2–4 settimane. La strategia completa si costruisce in 2–3 mesi.' },
      { q: 'Posso cambiare il pacchetto in corsa?', a: 'Sì, assolutamente. Puoi fare upgrade o cambiare il pacchetto ogni mese. Avvisaci 7 giorni prima del rinnovo.' },
      { q: 'Fate riprese con drone?', a: 'Il drone non è standard in Starter e Growth, ma si aggiunge come extra (100€–150€ a ripresa). Custom lo include secondo necessità.' },
      { q: 'Quanti immobili si possono promuovere al mese?', a: 'Dipende dal pacchetto. Starter copre l\'attività generale, Growth include 1 giorno di riprese dedicato agli immobili, mentre Pro ha 2 giorni di riprese. Per alti volumi, il pacchetto Custom è ideale.' },
    ] },
  contact: { kicker: 'Pronto a iniziare?', title1: 'I tuoi immobili devono essere visti dal', title2: 'compratore giusto', sub: 'Compila il modulo e ricevi una consulenza gratuita con il nostro team. Analizzeremo la tua presenza social e mostreremo opportunità concrete di lead generation.',
    perks: ['Audit gratuito della presenza social', 'Analisi della concorrenza nel settore', 'Proposta di strategia senza impegno'], urgency: 'Capacità limitata: accettiamo solo 8 nuove agenzie al mese.',
    formTitle: 'Ricevi la consulenza gratuita', selected: 'Pacchetto selezionato', change: 'Modifica', name: 'Nome completo *', namePh: 'Nome Cognome', email: 'Email *', phone: 'Telefono', phonePh: '+39 3XX XXX XXXX', site: 'Sito / Instagram (se presente)', sitePh: 'https://example.com o @instagram', message: 'Messaggio (opzionale)', messagePh: 'Raccontaci della tua agenzia e delle tue esigenze...', submit: 'Invia Richiesta', submitting: 'Invio in corso...', privacy: 'Inviando accetti l\'informativa sulla privacy. Niente spam.', successTitle: 'Grazie!', successBody: 'La tua richiesta è stata inviata con successo. Il nostro team ti contatterà entro 24 ore.', error: 'Qualcosa è andato storto. Riprova.' },
  footer: { rights: 'Tutti i diritti riservati.', pricing: 'Prezzi', contact: 'Contatti' },
};

const COPY: Record<Lang, Copy> = { sq: SQ, en: EN, it: IT };

export default function RealEstateLandingPage() {
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
        body: JSON.stringify({ ...formData, packageId: selectedPackage?.id || '', packageName: selectedPackage ? `Real Estate ${selectedPackage.title}` : '', source: 'Real Estate Landing Page', category: 'Social Media - Real Estate', message: `[${lang.toUpperCase()}] ${formData.message}` }) });
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
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center"><Building2 className="w-4 h-4 text-white" /></div>
            <span className="text-xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">FivoCRM Real Estate</span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-gray-600">
            <a href="#results" className="hover:text-emerald-600 transition-colors">{t.nav.results}</a>
            <a href="#process" className="hover:text-emerald-600 transition-colors">{t.nav.process}</a>
            <a href="#packages" className="hover:text-emerald-600 transition-colors">{t.nav.packages}</a>
            <a href="#addons" className="hover:text-emerald-600 transition-colors">{t.nav.addons}</a>
            <a href="#testimonials" className="hover:text-emerald-600 transition-colors">{t.nav.testimonials}</a>
          </div>
          <div className="flex items-center gap-3">
            <LangSwitcher lang={lang} setLang={setLang} accentClass="bg-emerald-600" />
            <button onClick={() => scrollToContact()} className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:shadow-lg hover:shadow-emerald-500/25 transition-all hover:-translate-y-0.5">{t.nav.cta}</button>
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
              accentClass="bg-gradient-to-r from-emerald-600 to-teal-600"
            />
          </div>
        </div>
      </nav>

      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-50/80 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-emerald-200/30 rounded-full blur-3xl" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-100 mb-8">
                <div className="flex -space-x-2">{['AS', 'GR', 'BK', 'EL'].map((ini, i) => (<div key={i} className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 border-2 border-white flex items-center justify-center text-[10px] font-bold text-white">{ini}</div>))}</div>
                <span className="text-sm font-medium text-emerald-700">{t.hero.badge}</span>
                <div className="flex">{[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}</div>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                {t.hero.h1a}{' '}<span className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 bg-clip-text text-transparent">{t.hero.h1b}</span>{' '}{t.hero.h1c}
                <br /><span className="text-gray-400">{t.hero.h1d}</span>
              </h1>
            </FadeIn>
            <FadeIn delay={200}><p className="mt-8 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">{t.hero.sub1} <strong className="text-emerald-600">{t.hero.sub2}</strong></p></FadeIn>
            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button onClick={scrollToPackages} className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:shadow-xl hover:shadow-emerald-500/25 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">{t.hero.ctaPrimary}<ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></button>
                <button onClick={() => scrollToContact()} className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border-2 border-gray-200 hover:border-emerald-300 hover:bg-emerald-50 transition-all flex items-center justify-center gap-2"><Phone className="w-5 h-5" />{t.hero.ctaSecondary}</button>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-400">
                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-500" /> {t.hero.t1}</span>
                <span className="flex items-center gap-1.5"><Lock className="w-4 h-4 text-blue-500" /> {t.hero.t2}</span>
                <span className="flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-emerald-500" /> {t.hero.t3}</span>
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

      <section id="results" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">{t.results.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.results.title}</h2></div></FadeIn>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {t.results.items.map((r, i) => { const Icon = RESULT_ICONS[i]; return (
              <FadeIn key={i} delay={i * 100}><div className="text-center p-8 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100"><Icon className="w-8 h-8 text-emerald-600 mx-auto mb-4" /><div className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent"><Counter end={parseFloat(r.metric)} suffix={r.suffix} /></div><p className="mt-3 text-sm text-gray-600 font-medium">{r.label}</p></div></FadeIn>); })}
          </div>
        </div>
      </section>

      <section id="process" className="py-24 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-400 mb-3">{t.process.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.process.title}</h2><p className="mt-4 text-gray-400 max-w-xl mx-auto">{t.process.sub}</p></div></FadeIn>
          <div className="grid md:grid-cols-4 gap-6 relative">
            <div className="hidden md:block absolute top-16 left-[12%] right-[12%] h-px bg-gradient-to-r from-emerald-500/50 via-teal-500/50 to-emerald-500/50" />
            {t.process.steps.map((s, i) => { const Icon = PROCESS_ICONS[i]; return (
              <FadeIn key={i} delay={i * 150}><div className="relative text-center p-6 rounded-2xl bg-gray-800/50 border border-gray-700 hover:border-emerald-500/50 transition-all group"><div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center mx-auto mb-4 text-lg font-bold relative z-10">{s.step}</div><Icon className="w-6 h-6 text-emerald-400 mx-auto mb-3 group-hover:scale-110 transition-transform" /><h3 className="text-lg font-bold mb-2">{s.title}</h3><p className="text-gray-400 text-sm leading-relaxed">{s.desc}</p></div></FadeIn>); })}
          </div>
        </div>
      </section>

      <section id="packages" className="py-24 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">{t.packages.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.packages.title}</h2><p className="mt-4 text-gray-600 max-w-2xl mx-auto">{t.packages.sub}</p></div></FadeIn>
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6 items-start">
            {t.packages.list.map((pkg, i) => {
              const isSelected = selectedPackage?.id === pkg.id; const isExpanded = expandedCard === pkg.id;
              return (
                <FadeIn key={pkg.id} delay={i * 120}>
                  <div className={`relative rounded-2xl bg-white border-2 ${pkg.border} transition-all hover:shadow-2xl ${pkg.popular ? 'shadow-xl ring-2 ring-emerald-500/20' : 'shadow-sm'} ${isSelected ? 'ring-2 ring-green-500' : ''}`}>
                    {pkg.badge && (<div className={`absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-gradient-to-r ${pkg.color} text-white text-xs font-bold tracking-wide whitespace-nowrap`}>{pkg.badge}</div>)}
                    <div className="p-6">
                      <h3 className="text-2xl font-bold">{pkg.title}</h3>
                      <p className="text-sm text-gray-500 mt-1">{pkg.subtitle}</p>
                      <div className="mt-5 flex items-baseline gap-1.5"><span className={`text-3xl font-bold bg-gradient-to-r ${pkg.color} bg-clip-text text-transparent`}>{pkg.price}</span>{pkg.priceNote && <span className="text-sm text-gray-500">{pkg.priceNote}</span>}</div>
                      <div className="mt-4 p-3 rounded-lg bg-gray-50"><p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t.packages.forLabel}</p><ul className="space-y-1">{pkg.targetAudience.map((a, ti) => (<li key={ti} className="text-xs text-gray-600 flex items-start gap-1.5"><span className="text-emerald-500 mt-0.5">•</span>{a}</li>))}</ul></div>
                      <div className="mt-5 space-y-4">
                        {pkg.features.map((cat, ci) => (
                          <div key={ci}>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{cat.category}</p>
                            <ul className="space-y-2">{(isExpanded ? cat.items : cat.items.slice(0, 4)).map((feature, fi) => (<li key={fi} className="flex items-start gap-2 text-sm text-gray-700"><CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${pkg.popular ? 'text-emerald-500' : 'text-green-500'}`} />{feature}</li>))}</ul>
                            {!isExpanded && cat.items.length > 4 && (<button onClick={() => setExpandedCard(pkg.id)} className="mt-2 text-xs text-emerald-600 font-medium hover:underline">+{cat.items.length - 4} {t.packages.more}</button>)}
                          </div>
                        ))}
                      </div>
                      {isExpanded && (<button onClick={() => setExpandedCard(null)} className="mt-2 text-xs text-gray-400 hover:text-gray-600 font-medium">{t.packages.less}</button>)}
                      {pkg.notIncluded.length > 0 && isExpanded && (<div className="mt-4 pt-4 border-t border-gray-100"><p className="text-xs font-semibold uppercase tracking-wide text-red-400 mb-2">{t.packages.notIncluded}</p><ul className="space-y-1.5">{pkg.notIncluded.map((item, ni) => (<li key={ni} className="flex items-start gap-2 text-xs text-gray-500"><X className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-red-300" />{item}</li>))}</ul></div>)}
                      <button onClick={() => scrollToContact(pkg)} className={`mt-6 w-full py-3.5 rounded-xl text-sm font-semibold transition-all hover:-translate-y-0.5 ${pkg.popular ? `bg-gradient-to-r ${pkg.color} text-white hover:shadow-lg hover:shadow-emerald-500/25` : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}>{isSelected ? t.packages.chosen : pkg.cta}</button>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>
          <FadeIn delay={500}><p className="mt-10 text-center text-sm text-gray-500">{t.packages.note}</p></FadeIn>
        </div>
      </section>

      <section id="addons" className="py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-14"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">{t.addons.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.addons.title}</h2><p className="mt-4 text-gray-600 max-w-xl mx-auto">{t.addons.sub}</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {t.addons.items.map((addon, i) => { const Icon = ADDON_ICONS[i]; return (
              <FadeIn key={i} delay={i * 80}><div className="flex items-center gap-4 p-5 rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-md hover:border-emerald-100 transition-all"><div className="w-11 h-11 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0"><Icon className="w-5 h-5 text-emerald-600" /></div><div className="flex-1 min-w-0"><p className="font-semibold text-gray-900 text-sm">{addon.name}</p><p className="text-emerald-600 font-bold text-sm">{addon.price}</p></div></div></FadeIn>); })}
          </div>
        </div>
      </section>

      <section id="testimonials" className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">{t.testimonials.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.testimonials.title}</h2></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {t.testimonials.items.map((tm, i) => (
              <FadeIn key={i} delay={i * 150}><div className="p-8 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg transition-all h-full flex flex-col"><div className="flex mb-4">{[1,2,3,4,5].map(j => (<Star key={j} className="w-5 h-5 text-amber-400 fill-amber-400" />))}</div><p className="text-gray-700 leading-relaxed flex-1 italic">"{tm.quote}"</p><div className="mt-6 flex items-center gap-3 pt-4 border-t border-gray-100"><div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white font-bold text-sm">{tm.avatar}</div><div><p className="font-semibold text-sm">{tm.name}</p><p className="text-xs text-gray-500">{tm.role}</p></div></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 mb-3">{t.faq.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.faq.title}</h2></div></FadeIn>
          <div className="space-y-3">
            {t.faq.items.map((item, i) => (
              <FadeIn key={i} delay={i * 80}><div className="bg-white rounded-xl border border-gray-100 overflow-hidden"><button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"><span className="font-semibold text-gray-900 pr-4">{item.q}</span><ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} /></button><div className={`transition-all duration-300 overflow-hidden ${openFaq === i ? 'max-h-60 opacity-100' : 'max-h-0 opacity-0'}`}><p className="px-6 pb-5 text-gray-600 leading-relaxed">{item.a}</p></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className="py-24 bg-gradient-to-br from-gray-900 via-emerald-900 to-gray-900 text-white relative overflow-hidden">
        <div className="absolute inset-0"><div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-3xl" /><div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-teal-500/10 rounded-full blur-3xl" /></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400 mb-4">{t.contact.kicker}</p>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">{t.contact.title1} <span className="text-emerald-400">{t.contact.title2}</span></h2>
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
                  {selectedPackage && (<div className="flex items-center justify-between px-4 py-3 rounded-xl bg-emerald-500/20 border border-emerald-500/30"><div><p className="text-xs text-emerald-300">{t.contact.selected}</p><p className="font-semibold text-white">{selectedPackage.title} — {selectedPackage.price}{selectedPackage.priceNote ? ` ${selectedPackage.priceNote}` : ''}</p></div><button type="button" onClick={() => setSelectedPackage(null)} className="text-emerald-300 hover:text-white text-sm underline">{t.contact.change}</button></div>)}
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.name}</label><input type="text" required value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder={t.contact.namePh} /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.email}</label><input type="email" required value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="email@domain.com" /></div>
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.phone}</label><input type="tel" value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder={t.contact.phonePh} /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.site}</label><input type="text" value={formData.website} onChange={e => setFormData(p => ({ ...p, website: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder={t.contact.sitePh} /></div>
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.message}</label><textarea rows={3} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none" placeholder={t.contact.messagePh} /></div>
                  {formError && (<div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">{formError}</div>)}
                  <button type="submit" disabled={submitting} className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white shadow-lg shadow-emerald-500/25 transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60">{submitting ? t.contact.submitting : t.contact.submit}{!submitting && <ArrowUpRight className="w-5 h-5" />}</button>
                  <p className="text-xs text-gray-400 text-center">{t.contact.privacy}</p>
                </form>
              )}
            </FadeIn>
          </div>
        </div>
      </section>

      <footer className="py-10 bg-gray-950 text-gray-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2"><div className="w-6 h-6 rounded bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center"><Building2 className="w-3 h-3 text-white" /></div><span className="font-semibold text-white text-sm">FivoCRM</span></div>
          <p className="text-sm">&copy; {new Date().getFullYear()} FivoCRM. {t.footer.rights}</p>
          <div className="flex items-center gap-6 text-sm"><Link to="/login" className="hover:text-white transition-colors">{t.nav.login}</Link><a href="#packages" className="hover:text-white transition-colors">{t.footer.pricing}</a><a href="#contact" className="hover:text-white transition-colors">{t.footer.contact}</a></div>
        </div>
      </footer>
    </div>
  );
}
