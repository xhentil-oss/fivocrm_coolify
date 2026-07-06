import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, Shield, Zap, CheckCircle2, ArrowRight,
  Star, Users, Target, Clock, ChevronDown, Phone,
  ArrowUpRight, Megaphone, BarChart3,
  X, Lock, Briefcase, UserCheck, Search, Globe, Award,
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

const ADDON_ICONS = [Briefcase, UserCheck, Award, Users, Globe, Zap];
const RESULT_ICONS = [Briefcase, Target, TrendingUp, Users];
const PAIN_ICONS = [Search, Megaphone, Clock];
const PROCESS_ICONS = [Target, UserCheck, Megaphone, BarChart3];

const SQ: Copy = {
  nav: { results: 'Rezultatet', process: 'Procesi', packages: 'Paketat', addons: 'Shtesa', testimonials: 'Dëshmitë', login: 'Hyr', cta: 'Fillo Tani' },
  hero: { badge: '120+ kompani rekrutimi na besojnë', h1a: 'Gjeni talentet', h1b: 'më të mirë', h1c: 'përmes social media.', h1d: 'Po e bëni këtë?',
    sub1: 'Çdo ditë, mijëra kandidatë të kualifikuar shfletojnë LinkedIn, Instagram dhe Facebook duke kërkuar mundësi pune.', sub2: 'Pa employer brand bindës, ata po shkojnë tek konkurrenca.',
    ctaPrimary: 'Shiko Paketat', ctaSecondary: 'Konsultim Falas', t1: 'Pa kontratë afatgjatë', t2: 'Ad spend i veçantë', t3: 'Rezultate brenda muajit' },
  pains: { kicker: 'A e njeh këtë situatë?', title1: 'Po humbisni talentet më të mirë', title2: 'çdo ditë',
    items: [
      { title: 'Vende pune të postuara, por askush nuk aplikon', desc: 'Postoni pozicione të hapura por nuk arrini kandidatët e duhur. Pa targeting të saktë, njoftimet tuaja po humbin në feed.' },
      { title: 'Konkurrenca po tërheq talentet më të mirë', desc: 'Kompani të tjera kanë employer brand të fortë, video punonjësish, dhe prezencë aktive — dhe kandidatët po zgjedhin ata.' },
      { title: 'Koha e rekrutimit po zgjatet', desc: 'Pa marketing dixhital, procesi i gjetjes së kandidatëve zgjat javë e javë. Çdo ditë pa punonjës kushton para.' },
    ], bridge1: 'Lajmi i mirë?', bridge2: 'Ne e dimë zgjidhjen.' },
  results: { kicker: 'Rezultate të vërteta', title: 'Numrat flasin më shumë se fjalët',
    items: [{ metric: '180', suffix: '+', label: 'Kompani rekrutimi të promovuara' }, { metric: '75', suffix: '%', label: 'Rritje e aplikimeve në 3 muaj' }, { metric: '4.2', suffix: 'x', label: 'Rritje e kandidatëve cilësorë' }, { metric: '120', suffix: '+', label: 'Biznese HR të kënaqur' }] },
  process: { kicker: 'Si funksionon', title: '4 hapa për sukses në recruitment marketing', sub: 'Procesi ynë i provuar që sjell kandidatë cilësorë për kompaninë tuaj',
    steps: [
      { step: '01', title: 'Analiza & Strategjia', desc: 'Analizojmë nevojat e rekrutimit, industrinë, dhe konkurrencën. Krijojmë strategji recruitment marketing.' },
      { step: '02', title: 'Krijim Përmbajtjeje', desc: 'Xhirime me punonjës, testimoniale, ambient pune — gjithçka që tërheq kandidatë cilësorë.' },
      { step: '03', title: 'Publikim & Ads', desc: 'Publikojmë sipas kalendarit dhe lançojmë fushata me targeting (profesion, eksperiencë, lokacion).' },
      { step: '04', title: 'Optimizim & Raportim', desc: 'Monitorojmë aplikimet, optimizojmë fushatat, raportojmë cost-per-candidate dhe cilësinë.' },
    ] },
  packages: { kicker: 'Paketat Recruitment Marketing', title: 'Zgjidh paketin ideal për agjencinë tënde', sub: 'Çdo paketë përfshin strategji të personalizuar për industrinë e rekrutimit. Çmimet nuk përfshijnë buxhetin e reklamave (ad spend).',
    forLabel: 'Për:', more: 'më shumë...', less: 'Shfaq më pak', notIncluded: 'Nuk përfshihet:', chosen: '✓ Zgjedhur', note: 'Të gjitha çmimet janë në Euro (€). Buxheti i reklamave (ad spend) nuk përfshihet. TVSH nuk përfshihet. Faturim mujor.',
    list: [
      { id: 'starter', title: 'Starter', subtitle: 'Prezencë profesionale dhe besueshmëri online', price: '700€', priceNote: '/ muaj + ad spend', targetAudience: ['Agjenci rekrutimi të reja', 'Kompani të vogla HR', 'Biznese që duan ta ndërtojnë brandin si punëdhënës'],
        features: [{ category: 'Përmbajtja & Menaxhimi', items: ['Menaxhim i 2 platformave (Facebook + Instagram/LinkedIn)', '12 postime / muaj', '8 reels / stories / muaj', 'Design grafik për postimet', 'Copywriting për përshkrimet', 'Publikim sipas kalendarit', 'Job posting templates', 'Menaxhim bazë i faqes', 'Raport mujor bazë'] }, { category: 'Ads & Reklama', items: ['Setup bazë i fushatave recruitment', 'Menaxhim bazë i reklamave', 'Targetim sipas industrisë dhe pozicionit'] }],
        notIncluded: ['Buxheti i reklamave (ad spend)', 'Video xhirime me punonjës/kandidatë', 'LinkedIn premium campaigns', 'Landing page / website development', 'Employer branding i avancuar'], color: 'from-sky-400 to-blue-500', border: 'border-sky-200 hover:border-sky-400', cta: 'Fillo me Starter' },
      { id: 'growth', title: 'Growth', subtitle: 'Rritje e aplikimeve dhe employer brand i fortë', price: '1,100€', priceNote: '/ muaj + ad spend', popular: true, badge: 'Më i Popullarizuari', targetAudience: ['Agjenci rekrutimi në rritje', 'Kompani me 5+ pozicione të hapura', 'Biznese që duan kandidatë cilësorë'],
        features: [{ category: 'Përmbajtja & Menaxhimi', items: ['Menaxhim i 3 platformave (Facebook + Instagram + LinkedIn)', '16 postime / muaj', '15 reels & stories / muaj', 'Design grafik profesional', 'Copywriting i orientuar për rekrutim', 'Publikim sipas kalendarit', '1 ditë xhirimi / muaj (intervista punonjësish, ambient pune)', 'Employee spotlight content', 'Employer branding content', 'Menaxhim i komenteve dhe inbox-it', 'Raport mujor performance'] }, { category: 'Ads & Reklama', items: ['Menaxhim i plotë i Meta Ads + LinkedIn Ads', 'Job awareness campaigns', 'Kandidate generation campaigns', 'Audience targeting (profesion, eksperiencë, lokacion)', 'Optimizim javor', 'A/B testing i kreativëve', 'Raportim i aplikimeve dhe cost-per-lead'] }],
        notIncluded: ['Buxheti i reklamave (ad spend)', 'Xhirime shtesë jashtë ditës mujore', 'Influencer/ambassador programs', 'Career page development'], color: 'from-blue-500 to-indigo-600', border: 'border-blue-200 hover:border-blue-400', cta: 'Zgjidh Growth' },
      { id: 'pro', title: 'Pro', subtitle: 'Dominim i tregut të punës dhe flow i vazhdueshëm kandidatësh', price: '1,600€', priceNote: '/ muaj + ad spend', badge: 'Maksimum Rezultate', targetAudience: ['Agjenci rekrutimi premium', 'Kompani me 20+ pozicione të hapura', 'Organizata me nevoja të vazhdueshme punësimi'],
        features: [{ category: 'Përmbajtja & Menaxhimi', items: ['Menaxhim i 3–4 platformave (+ TikTok ose YouTube)', '20 postime / muaj', '25 reels & stories / muaj', 'Design grafik premium', 'Copywriting i avancuar', 'Publikim dhe planifikim mujor', '2 ditë xhirimi / muaj', 'Employee testimonial videos', 'Day in the life content', 'Behind the scenes i kompanisë', 'Employer branding strategy', 'Community management aktiv', 'Raportim i detajuar mujor'] }, { category: 'Ads & Reklama', items: ['Menaxhim i plotë i Meta + LinkedIn + Google Ads', 'Talent acquisition campaigns', 'Retargeting i kandidatëve', 'Audience segmentation i avancuar', 'Multi-channel candidate funnel', 'Optimizim i rregullt i performancës', 'Raportim i detajuar ROI per pozicion'] }],
        notIncluded: ['Buxheti i reklamave (ad spend)', 'Produksion pa limit', 'Career page / website development', 'Event coverage ose job fair participation', 'Referral program management (ofrohet si add-on)'], color: 'from-indigo-500 to-violet-600', border: 'border-indigo-200 hover:border-indigo-400', cta: 'Zgjidh Pro' },
      { id: 'custom', title: 'Custom', subtitle: 'Zgjidhje e plotë sipas nevojave tuaja', price: 'Sipas kërkesës', priceNote: '', targetAudience: ['Agjenci ndërkombëtare rekrutimi', 'Kompani me shumë degë / lokacione', 'Organizata me nevoja sezonale', 'Mass recruitment campaigns'],
        features: [{ category: 'Mund të përfshijë', items: ['Më shumë platforma (TikTok, YouTube, Twitter/X)', 'Më shumë xhirime mujore', 'Video testimoniale nga punonjësit', 'University & job fair campaigns', 'Seasonal hiring campaigns', 'Referral program marketing', 'Employer branding i kompletuar', 'Career page design & development', 'Ads me buxhet të lartë', 'Strategji e personalizuar mujore'] }],
        notIncluded: [], color: 'from-violet-600 to-purple-600', border: 'border-violet-200 hover:border-violet-400', cta: 'Na Kontaktoni' },
    ] },
  addons: { kicker: 'Shtesa Extra', title: 'Personalizo paketën tënde', sub: 'Shto shërbime ekstra sipas nevojave të rekrutimit suaj.',
    items: [{ name: 'Reel / video shtesë', price: '50€ – 80€' }, { name: 'Employee testimonial video', price: '150€ – 250€' }, { name: 'Ditë ekstra xhirimi', price: '200€ – 350€' }, { name: 'Job fair / event coverage', price: '300€ – 500€' }, { name: 'Career page design', price: '500€ – 1,000€' }, { name: 'Urgent hire campaign', price: 'Sipas kërkesës' }] },
  testimonials: { kicker: 'Dëshmi klientësh', title: 'Çfarë thonë kompanitë e rekrutimit',
    items: [{ name: 'Dritan Berisha', role: 'CEO, TalentHub Albania', quote: 'Brenda 2 muajve aplikimet u rritën me 80%. LinkedIn campaigns na sjellin kandidatë cilësorë çdo javë — investimi më i mirë që kemi bërë.', avatar: 'DB' }, { name: 'Entela Krasniqi', role: 'HR Director, StaffPro Solutions', quote: 'Employee spotlight reels kanë transformuar employer brand-in tonë. Tani kandidatët na kontaktojnë direkt — jo ne ata.', avatar: 'EK' }, { name: 'Alban Hoxha', role: 'Themelues, WorkForce Connect', quote: 'Nga 5 aplikime/javë shkuam në 40+. Ekipi i FivoCRM e kupton recruitment marketing — nuk janë thjesht agjenci social media.', avatar: 'AH' }] },
  faq: { kicker: 'FAQ', title: 'Pyetjet më të shpeshta',
    items: [
      { q: 'Çfarë përfshihet në buxhetin e reklamave (ad spend)?', a: 'Buxheti i reklamave (ad spend) paguhet direkt tek Meta (Facebook/Instagram), LinkedIn, ose Google dhe nuk përfshihet në çmimin e paketës. Ne menaxhojmë se si shpenzohet. Zakonisht rekomandojmë 300€–1,500€/muaj varësisht nga numri i pozicioneve.' },
      { q: 'Sa kohë duhet për të parë rezultate?', a: 'Employer branding ndikon menjëherë në besueshmërinë e kompanisë. Për rritje aplikimesh përmes reklamave, rezultatet e para vijnë brenda 2–3 javëve. Pipeline-i i plotë i kandidatëve ndërtohet brenda 2–3 muajve.' },
      { q: 'A punoni me LinkedIn Ads?', a: 'Po! LinkedIn është platforma kryesore për rekrutim profesional. Në paketën Growth e Pro përfshihen LinkedIn Ads me targeting sipas industrisë, pozicionit, viteve të eksperiencës, dhe lokacionit.' },
      { q: 'A mund ta ndryshoj paketin gjatë rrugës?', a: 'Po, absolutisht. Mund të upgrade-oni ose ndryshoni paketin çdo muaj. Na njoftoni 7 ditë para rifillimit të muajit.' },
      { q: 'Si e matni suksesin e fushatave recruitment?', a: 'Matim aplikimet totale, cost-per-application, cilësinë e kandidatëve (sa kalojnë interview-n), time-to-fill per pozicion, dhe engagement me employer brand content. Raportim mujor i detajuar.' },
      { q: 'A bëni content me punonjësit tanë aktualë?', a: 'Po! Employee spotlight, day in the life, testimoniale — janë nga format më efektive. Gjatë xhirimeve mujore organizojmë intervista dhe xhirime në ambient pune.' },
    ] },
  contact: { kicker: 'Gati për të filluar?', title1: 'Agjencia jote meriton', title2: 'kandidatë çdo javë', sub: 'Plotëso formularin dhe merr një konsultim falas me ekipin tonë. Do analizojmë prezencën tuaj online dhe do tregojmë mundësitë konkrete për rritje të aplikimeve.',
    perks: ['Audit falas i employer brand-it tuaj', 'Analizë e strategjisë recruitment marketing', 'Propozim strategjie pa detyrim'], urgency: 'Kapacitet i limituar: pranojmë vetëm 8 agjenci të reja çdo muaj.',
    formTitle: 'Merr konsultimin falas', selected: 'Paketa e zgjedhur', change: 'Ndrysho', name: 'Emri i plotë *', namePh: 'Emri Mbiemri', email: 'Email *', phone: 'Telefon', phonePh: '+355 6X XXX XXXX', site: 'Website / LinkedIn (nëse keni)', sitePh: 'https://example.com ose linkedin.com/company/...', message: 'Mesazh (opsional)', messagePh: 'Na tregoni pak për agjencinë tuaj, industritë që merreni, dhe nevojat e rekrutimit...', submit: 'Dërgo Kërkesën', submitting: 'Duke dërguar...', privacy: 'Duke dërguar pranoni politikën e privatësisë. Nuk do merrni spam.', successTitle: 'Faleminderit!', successBody: 'Kërkesa jote u dërgua me sukses. Ekipi ynë do t\'ju kontaktojë brenda 24 orëve.', error: 'Diçka shkoi keq. Provoni përsëri.' },
  footer: { rights: 'Të gjitha të drejtat e rezervuara.', pricing: 'Çmimet', contact: 'Kontakt' },
};

const EN: Copy = {
  nav: { results: 'Results', process: 'Process', packages: 'Packages', addons: 'Add-ons', testimonials: 'Testimonials', login: 'Login', cta: 'Get Started' },
  hero: { badge: '120+ recruitment companies trust us', h1a: 'Find the', h1b: 'best talent', h1c: 'through social media.', h1d: 'Are you doing it?',
    sub1: 'Every day, thousands of qualified candidates scroll LinkedIn, Instagram and Facebook looking for job opportunities.', sub2: 'Without a compelling employer brand, they\'re going to the competition.',
    ctaPrimary: 'See Packages', ctaSecondary: 'Free Consultation', t1: 'No long-term contract', t2: 'Ad spend separate', t3: 'Results within the month' },
  pains: { kicker: 'Sound familiar?', title1: 'You\'re losing the best talent', title2: 'every day',
    items: [
      { title: 'Jobs posted, but no one applies', desc: 'You post open positions but don\'t reach the right candidates. Without precise targeting, your listings get lost in the feed.' },
      { title: 'Competitors attract the best talent', desc: 'Other companies have a strong employer brand, employee videos and an active presence — and candidates choose them.' },
      { title: 'Time-to-hire keeps growing', desc: 'Without digital marketing, finding candidates drags on week after week. Every day without staff costs money.' },
    ], bridge1: 'The good news?', bridge2: 'We know the solution.' },
  results: { kicker: 'Real results', title: 'Numbers speak louder than words',
    items: [{ metric: '180', suffix: '+', label: 'Recruitment companies promoted' }, { metric: '75', suffix: '%', label: 'Increase in applications in 3 months' }, { metric: '4.2', suffix: 'x', label: 'Growth in quality candidates' }, { metric: '120', suffix: '+', label: 'Happy HR businesses' }] },
  process: { kicker: 'How it works', title: '4 steps to recruitment marketing success', sub: 'Our proven process that brings quality candidates to your company',
    steps: [
      { step: '01', title: 'Analysis & Strategy', desc: 'We analyze recruitment needs, the industry and competitors. We build a recruitment marketing strategy.' },
      { step: '02', title: 'Content Creation', desc: 'Shoots with employees, testimonials, workplace — everything that attracts quality candidates.' },
      { step: '03', title: 'Publishing & Ads', desc: 'We publish on schedule and launch campaigns with targeting (role, experience, location).' },
      { step: '04', title: 'Optimization & Reporting', desc: 'We monitor applications, optimize campaigns and report cost-per-candidate and quality.' },
    ] },
  packages: { kicker: 'Recruitment Marketing Packages', title: 'Choose the ideal plan for your agency', sub: 'Every package includes a strategy tailored to the recruitment industry. Prices exclude ad spend.',
    forLabel: 'For:', more: 'more...', less: 'Show less', notIncluded: 'Not included:', chosen: '✓ Selected', note: 'All prices in Euro (€). Ad spend not included. VAT not included. Monthly billing.',
    list: [
      { id: 'starter', title: 'Starter', subtitle: 'Professional presence and online credibility', price: '€700', priceNote: '/ month + ad spend', targetAudience: ['New recruitment agencies', 'Small HR companies', 'Businesses wanting to build an employer brand'],
        features: [{ category: 'Content & Management', items: ['Management of 2 platforms (Facebook + Instagram/LinkedIn)', '12 posts / month', '8 reels / stories / month', 'Graphic design for posts', 'Copywriting for descriptions', 'Scheduled publishing', 'Job posting templates', 'Basic page management', 'Basic monthly report'] }, { category: 'Ads', items: ['Basic recruitment campaign setup', 'Basic ad management', 'Targeting by industry and role'] }],
        notIncluded: ['Ad budget (ad spend)', 'Video shoots with employees/candidates', 'LinkedIn premium campaigns', 'Landing page / website development', 'Advanced employer branding'], color: 'from-sky-400 to-blue-500', border: 'border-sky-200 hover:border-sky-400', cta: 'Start with Starter' },
      { id: 'growth', title: 'Growth', subtitle: 'More applications and a strong employer brand', price: '€1,100', priceNote: '/ month + ad spend', popular: true, badge: 'Most Popular', targetAudience: ['Growing recruitment agencies', 'Companies with 5+ open positions', 'Businesses wanting quality candidates'],
        features: [{ category: 'Content & Management', items: ['Management of 3 platforms (Facebook + Instagram + LinkedIn)', '16 posts / month', '15 reels & stories / month', 'Professional graphic design', 'Recruitment-oriented copywriting', 'Scheduled publishing', '1 shoot day / month (employee interviews, workplace)', 'Employee spotlight content', 'Employer branding content', 'Comment & inbox management', 'Monthly performance report'] }, { category: 'Ads', items: ['Full Meta Ads + LinkedIn Ads management', 'Job awareness campaigns', 'Candidate generation campaigns', 'Audience targeting (role, experience, location)', 'Weekly optimization', 'Creative A/B testing', 'Reporting of applications and cost-per-lead'] }],
        notIncluded: ['Ad budget (ad spend)', 'Extra shoots beyond the monthly day', 'Influencer/ambassador programs', 'Career page development'], color: 'from-blue-500 to-indigo-600', border: 'border-blue-200 hover:border-blue-400', cta: 'Choose Growth' },
      { id: 'pro', title: 'Pro', subtitle: 'Job-market dominance and a steady candidate flow', price: '€1,600', priceNote: '/ month + ad spend', badge: 'Maximum Results', targetAudience: ['Premium recruitment agencies', 'Companies with 20+ open positions', 'Organizations with continuous hiring needs'],
        features: [{ category: 'Content & Management', items: ['Management of 3–4 platforms (+ TikTok or YouTube)', '20 posts / month', '25 reels & stories / month', 'Premium graphic design', 'Advanced copywriting', 'Monthly publishing & planning', '2 shoot days / month', 'Employee testimonial videos', 'Day in the life content', 'Company behind the scenes', 'Employer branding strategy', 'Active community management', 'Detailed monthly reporting'] }, { category: 'Ads', items: ['Full Meta + LinkedIn + Google Ads management', 'Talent acquisition campaigns', 'Candidate retargeting', 'Advanced audience segmentation', 'Multi-channel candidate funnel', 'Regular performance optimization', 'Detailed ROI reporting per position'] }],
        notIncluded: ['Ad budget (ad spend)', 'Unlimited production', 'Career page / website development', 'Event coverage or job fair participation', 'Referral program management (offered as add-on)'], color: 'from-indigo-500 to-violet-600', border: 'border-indigo-200 hover:border-indigo-400', cta: 'Choose Pro' },
      { id: 'custom', title: 'Custom', subtitle: 'A complete solution tailored to your needs', price: 'On request', priceNote: '', targetAudience: ['International recruitment agencies', 'Companies with multiple branches / locations', 'Organizations with seasonal needs', 'Mass recruitment campaigns'],
        features: [{ category: 'May include', items: ['More platforms (TikTok, YouTube, Twitter/X)', 'More monthly shoots', 'Employee testimonial videos', 'University & job fair campaigns', 'Seasonal hiring campaigns', 'Referral program marketing', 'Complete employer branding', 'Career page design & development', 'High-budget ads', 'Personalized monthly strategy'] }],
        notIncluded: [], color: 'from-violet-600 to-purple-600', border: 'border-violet-200 hover:border-violet-400', cta: 'Contact Us' },
    ] },
  addons: { kicker: 'Extra Add-ons', title: 'Customize your package', sub: 'Add extra services based on your recruitment needs.',
    items: [{ name: 'Extra reel / video', price: '€50 – €80' }, { name: 'Employee testimonial video', price: '€150 – €250' }, { name: 'Extra shoot day', price: '€200 – €350' }, { name: 'Job fair / event coverage', price: '€300 – €500' }, { name: 'Career page design', price: '€500 – €1,000' }, { name: 'Urgent hire campaign', price: 'On request' }] },
  testimonials: { kicker: 'Client testimonials', title: 'What recruitment companies say',
    items: [{ name: 'Dritan Berisha', role: 'CEO, TalentHub Albania', quote: 'Within 2 months applications grew 80%. LinkedIn campaigns bring us quality candidates every week — the best investment we\'ve made.', avatar: 'DB' }, { name: 'Entela Krasniqi', role: 'HR Director, StaffPro Solutions', quote: 'Employee spotlight reels transformed our employer brand. Now candidates contact us directly — not us them.', avatar: 'EK' }, { name: 'Alban Hoxha', role: 'Founder, WorkForce Connect', quote: 'From 5 applications/week we went to 40+. The FivoCRM team understands recruitment marketing — they\'re not just a social media agency.', avatar: 'AH' }] },
  faq: { kicker: 'FAQ', title: 'Frequently asked questions',
    items: [
      { q: 'What is included in the ad spend?', a: 'Ad spend is paid directly to Meta (Facebook/Instagram), LinkedIn or Google and is not included in the package price. We manage how it\'s spent. We usually recommend €300–€1,500/month depending on the number of positions.' },
      { q: 'How long until I see results?', a: 'Employer branding has an immediate impact on company credibility. For application growth via ads, first results come within 2–3 weeks. The full candidate pipeline is built within 2–3 months.' },
      { q: 'Do you work with LinkedIn Ads?', a: 'Yes! LinkedIn is the main platform for professional recruitment. Growth and Pro include LinkedIn Ads with targeting by industry, role, years of experience and location.' },
      { q: 'Can I change the plan along the way?', a: 'Yes, absolutely. You can upgrade or change the plan every month. Just notify us 7 days before the month renews.' },
      { q: 'How do you measure recruitment campaign success?', a: 'We measure total applications, cost-per-application, candidate quality (how many pass the interview), time-to-fill per position, and engagement with employer brand content. Detailed monthly reporting.' },
      { q: 'Do you create content with our current employees?', a: 'Yes! Employee spotlight, day in the life, testimonials — are among the most effective formats. During monthly shoots we organize interviews and workplace filming.' },
    ] },
  contact: { kicker: 'Ready to start?', title1: 'Your agency deserves', title2: 'candidates every week', sub: 'Fill in the form and get a free consultation with our team. We\'ll analyze your online presence and show concrete opportunities to grow applications.',
    perks: ['Free audit of your employer brand', 'Recruitment marketing strategy analysis', 'Strategy proposal with no obligation'], urgency: 'Limited capacity: we only take 8 new agencies each month.',
    formTitle: 'Get your free consultation', selected: 'Selected package', change: 'Change', name: 'Full name *', namePh: 'First Last', email: 'Email *', phone: 'Phone', phonePh: '+39 3XX XXX XXXX', site: 'Website / LinkedIn (if any)', sitePh: 'https://example.com or linkedin.com/company/...', message: 'Message (optional)', messagePh: 'Tell us a bit about your agency, the industries you cover and your recruitment needs...', submit: 'Send Request', submitting: 'Sending...', privacy: 'By submitting you accept the privacy policy. No spam.', successTitle: 'Thank you!', successBody: 'Your request was sent successfully. Our team will contact you within 24 hours.', error: 'Something went wrong. Please try again.' },
  footer: { rights: 'All rights reserved.', pricing: 'Pricing', contact: 'Contact' },
};

const IT: Copy = {
  nav: { results: 'Risultati', process: 'Processo', packages: 'Pacchetti', addons: 'Extra', testimonials: 'Testimonianze', login: 'Accedi', cta: 'Inizia Ora' },
  hero: { badge: '120+ aziende di recruiting si fidano di noi', h1a: 'Trova i', h1b: 'migliori talenti', h1c: 'attraverso i social.', h1d: 'Lo stai facendo?',
    sub1: 'Ogni giorno migliaia di candidati qualificati scorrono LinkedIn, Instagram e Facebook cercando opportunità di lavoro.', sub2: 'Senza un employer brand convincente, vanno dalla concorrenza.',
    ctaPrimary: 'Vedi i Pacchetti', ctaSecondary: 'Consulenza Gratuita', t1: 'Nessun contratto a lungo termine', t2: 'Budget pubblicitario separato', t3: 'Risultati entro il mese' },
  pains: { kicker: 'Ti suona familiare?', title1: 'Stai perdendo i migliori talenti', title2: 'ogni giorno',
    items: [
      { title: 'Offerte pubblicate, ma nessuno si candida', desc: 'Pubblichi posizioni aperte ma non raggiungi i candidati giusti. Senza targeting preciso, i tuoi annunci si perdono nel feed.' },
      { title: 'La concorrenza attira i migliori talenti', desc: 'Altre aziende hanno un employer brand forte, video dei dipendenti e una presenza attiva — e i candidati scelgono loro.' },
      { title: 'I tempi di assunzione si allungano', desc: 'Senza marketing digitale, trovare candidati si trascina settimana dopo settimana. Ogni giorno senza personale costa denaro.' },
    ], bridge1: 'La buona notizia?', bridge2: 'Conosciamo la soluzione.' },
  results: { kicker: 'Risultati reali', title: 'I numeri parlano più delle parole',
    items: [{ metric: '180', suffix: '+', label: 'Aziende di recruiting promosse' }, { metric: '75', suffix: '%', label: 'Aumento delle candidature in 3 mesi' }, { metric: '4.2', suffix: 'x', label: 'Crescita dei candidati di qualità' }, { metric: '120', suffix: '+', label: 'Aziende HR soddisfatte' }] },
  process: { kicker: 'Come funziona', title: '4 passi verso il successo nel recruitment marketing', sub: 'Il nostro processo collaudato che porta candidati di qualità alla tua azienda',
    steps: [
      { step: '01', title: 'Analisi & Strategia', desc: 'Analizziamo le esigenze di recruiting, il settore e la concorrenza. Creiamo una strategia di recruitment marketing.' },
      { step: '02', title: 'Creazione Contenuti', desc: 'Riprese con i dipendenti, testimonianze, ambiente di lavoro — tutto ciò che attrae candidati di qualità.' },
      { step: '03', title: 'Pubblicazione & Ads', desc: 'Pubblichiamo secondo il calendario e lanciamo campagne con targeting (ruolo, esperienza, località).' },
      { step: '04', title: 'Ottimizzazione & Report', desc: 'Monitoriamo le candidature, ottimizziamo le campagne e riportiamo il cost-per-candidate e la qualità.' },
    ] },
  packages: { kicker: 'Pacchetti Recruitment Marketing', title: 'Scegli il piano ideale per la tua agenzia', sub: 'Ogni pacchetto include una strategia su misura per il settore del recruiting. I prezzi escludono il budget pubblicitario.',
    forLabel: 'Per:', more: 'altro...', less: 'Mostra meno', notIncluded: 'Non incluso:', chosen: '✓ Selezionato', note: 'Tutti i prezzi in Euro (€). Budget pubblicitario non incluso. IVA esclusa. Fatturazione mensile.',
    list: [
      { id: 'starter', title: 'Starter', subtitle: 'Presenza professionale e credibilità online', price: '700€', priceNote: '/ mese + ad spend', targetAudience: ['Nuove agenzie di recruiting', 'Piccole aziende HR', 'Attività che vogliono costruire un employer brand'],
        features: [{ category: 'Contenuti & Gestione', items: ['Gestione di 2 piattaforme (Facebook + Instagram/LinkedIn)', '12 post / mese', '8 reels / stories / mese', 'Grafica per i post', 'Copywriting per le descrizioni', 'Pubblicazione programmata', 'Template per offerte di lavoro', 'Gestione base della pagina', 'Report mensile base'] }, { category: 'Pubblicità', items: ['Setup base di campagne recruitment', 'Gestione base degli annunci', 'Targeting per settore e ruolo'] }],
        notIncluded: ['Budget pubblicitario (ad spend)', 'Riprese video con dipendenti/candidati', 'Campagne LinkedIn premium', 'Sviluppo landing page / sito', 'Employer branding avanzato'], color: 'from-sky-400 to-blue-500', border: 'border-sky-200 hover:border-sky-400', cta: 'Inizia con Starter' },
      { id: 'growth', title: 'Growth', subtitle: 'Più candidature e un employer brand forte', price: '1.100€', priceNote: '/ mese + ad spend', popular: true, badge: 'Più Popolare', targetAudience: ['Agenzie di recruiting in crescita', 'Aziende con 5+ posizioni aperte', 'Attività che vogliono candidati di qualità'],
        features: [{ category: 'Contenuti & Gestione', items: ['Gestione di 3 piattaforme (Facebook + Instagram + LinkedIn)', '16 post / mese', '15 reels & stories / mese', 'Grafica professionale', 'Copywriting orientato al recruiting', 'Pubblicazione programmata', '1 giorno di riprese / mese (interviste dipendenti, ambiente di lavoro)', 'Contenuti employee spotlight', 'Contenuti employer branding', 'Gestione di commenti e inbox', 'Report mensile delle performance'] }, { category: 'Pubblicità', items: ['Gestione completa Meta Ads + LinkedIn Ads', 'Campagne di job awareness', 'Campagne di generazione candidati', 'Targeting del pubblico (ruolo, esperienza, località)', 'Ottimizzazione settimanale', 'A/B testing dei creativi', 'Report di candidature e cost-per-lead'] }],
        notIncluded: ['Budget pubblicitario (ad spend)', 'Riprese extra oltre il giorno mensile', 'Programmi influencer/ambassador', 'Sviluppo career page'], color: 'from-blue-500 to-indigo-600', border: 'border-blue-200 hover:border-blue-400', cta: 'Scegli Growth' },
      { id: 'pro', title: 'Pro', subtitle: 'Dominio del mercato del lavoro e flusso continuo di candidati', price: '1.600€', priceNote: '/ mese + ad spend', badge: 'Massimi Risultati', targetAudience: ['Agenzie di recruiting premium', 'Aziende con 20+ posizioni aperte', 'Organizzazioni con esigenze di assunzione continue'],
        features: [{ category: 'Contenuti & Gestione', items: ['Gestione di 3–4 piattaforme (+ TikTok o YouTube)', '20 post / mese', '25 reels & stories / mese', 'Grafica premium', 'Copywriting avanzato', 'Pubblicazione e pianificazione mensile', '2 giorni di riprese / mese', 'Video testimonianze dei dipendenti', 'Contenuti day in the life', 'Behind the scenes dell\'azienda', 'Strategia di employer branding', 'Community management attivo', 'Report mensile dettagliato'] }, { category: 'Pubblicità', items: ['Gestione completa Meta + LinkedIn + Google Ads', 'Campagne di talent acquisition', 'Retargeting dei candidati', 'Segmentazione avanzata del pubblico', 'Funnel candidati multicanale', 'Ottimizzazione regolare delle performance', 'Report dettagliato del ROI per posizione'] }],
        notIncluded: ['Budget pubblicitario (ad spend)', 'Produzione illimitata', 'Sviluppo career page / sito', 'Copertura eventi o partecipazione a job fair', 'Gestione programma referral (offerta come extra)'], color: 'from-indigo-500 to-violet-600', border: 'border-indigo-200 hover:border-indigo-400', cta: 'Scegli Pro' },
      { id: 'custom', title: 'Custom', subtitle: 'Una soluzione completa su misura', price: 'Su richiesta', priceNote: '', targetAudience: ['Agenzie di recruiting internazionali', 'Aziende con più filiali / sedi', 'Organizzazioni con esigenze stagionali', 'Campagne di mass recruitment'],
        features: [{ category: 'Può includere', items: ['Più piattaforme (TikTok, YouTube, Twitter/X)', 'Più riprese mensili', 'Video testimonianze dei dipendenti', 'Campagne università & job fair', 'Campagne di assunzione stagionali', 'Marketing del programma referral', 'Employer branding completo', 'Design & sviluppo career page', 'Ads ad alto budget', 'Strategia mensile personalizzata'] }],
        notIncluded: [], color: 'from-violet-600 to-purple-600', border: 'border-violet-200 hover:border-violet-400', cta: 'Contattaci' },
    ] },
  addons: { kicker: 'Extra', title: 'Personalizza il tuo pacchetto', sub: 'Aggiungi servizi extra in base alle tue esigenze di recruiting.',
    items: [{ name: 'Reel / video extra', price: '50€ – 80€' }, { name: 'Video testimonianza dipendente', price: '150€ – 250€' }, { name: 'Giorno di ripresa extra', price: '200€ – 350€' }, { name: 'Copertura job fair / evento', price: '300€ – 500€' }, { name: 'Design career page', price: '500€ – 1.000€' }, { name: 'Campagna assunzione urgente', price: 'Su richiesta' }] },
  testimonials: { kicker: 'Testimonianze clienti', title: 'Cosa dicono le aziende di recruiting',
    items: [{ name: 'Dritan Berisha', role: 'CEO, TalentHub Albania', quote: 'In 2 mesi le candidature sono cresciute dell\'80%. Le campagne LinkedIn ci portano candidati di qualità ogni settimana — il miglior investimento che abbiamo fatto.', avatar: 'DB' }, { name: 'Entela Krasniqi', role: 'HR Director, StaffPro Solutions', quote: 'I reel employee spotlight hanno trasformato il nostro employer brand. Ora i candidati ci contattano direttamente — non noi loro.', avatar: 'EK' }, { name: 'Alban Hoxha', role: 'Fondatore, WorkForce Connect', quote: 'Da 5 candidature/settimana siamo passati a 40+. Il team FivoCRM capisce il recruitment marketing — non sono solo un\'agenzia social.', avatar: 'AH' }] },
  faq: { kicker: 'FAQ', title: 'Domande frequenti',
    items: [
      { q: 'Cosa è incluso nel budget pubblicitario (ad spend)?', a: 'Il budget pubblicitario si paga direttamente a Meta (Facebook/Instagram), LinkedIn o Google e non è incluso nel prezzo del pacchetto. Noi gestiamo come viene speso. Di solito consigliamo 300€–1.500€/mese a seconda del numero di posizioni.' },
      { q: 'Quanto tempo per vedere risultati?', a: 'L\'employer branding ha un impatto immediato sulla credibilità aziendale. Per la crescita delle candidature tramite ads, i primi risultati arrivano entro 2–3 settimane. La pipeline completa di candidati si costruisce in 2–3 mesi.' },
      { q: 'Lavorate con LinkedIn Ads?', a: 'Sì! LinkedIn è la piattaforma principale per il recruiting professionale. Growth e Pro includono LinkedIn Ads con targeting per settore, ruolo, anni di esperienza e località.' },
      { q: 'Posso cambiare il pacchetto in corsa?', a: 'Sì, assolutamente. Puoi fare upgrade o cambiare il pacchetto ogni mese. Avvisaci 7 giorni prima del rinnovo.' },
      { q: 'Come misurate il successo delle campagne di recruiting?', a: 'Misuriamo le candidature totali, il cost-per-application, la qualità dei candidati (quanti superano il colloquio), il time-to-fill per posizione e l\'engagement con i contenuti di employer brand. Report mensile dettagliato.' },
      { q: 'Create contenuti con i nostri dipendenti attuali?', a: 'Sì! Employee spotlight, day in the life, testimonianze — sono tra i formati più efficaci. Durante le riprese mensili organizziamo interviste e riprese nell\'ambiente di lavoro.' },
    ] },
  contact: { kicker: 'Pronto a iniziare?', title1: 'La tua agenzia merita', title2: 'candidati ogni settimana', sub: 'Compila il modulo e ricevi una consulenza gratuita con il nostro team. Analizzeremo la tua presenza online e mostreremo opportunità concrete per far crescere le candidature.',
    perks: ['Audit gratuito del tuo employer brand', 'Analisi della strategia di recruitment marketing', 'Proposta di strategia senza impegno'], urgency: 'Capacità limitata: accettiamo solo 8 nuove agenzie al mese.',
    formTitle: 'Ricevi la consulenza gratuita', selected: 'Pacchetto selezionato', change: 'Modifica', name: 'Nome completo *', namePh: 'Nome Cognome', email: 'Email *', phone: 'Telefono', phonePh: '+39 3XX XXX XXXX', site: 'Sito / LinkedIn (se presente)', sitePh: 'https://example.com o linkedin.com/company/...', message: 'Messaggio (opzionale)', messagePh: 'Raccontaci della tua agenzia, dei settori di cui ti occupi e delle tue esigenze di recruiting...', submit: 'Invia Richiesta', submitting: 'Invio in corso...', privacy: 'Inviando accetti l\'informativa sulla privacy. Niente spam.', successTitle: 'Grazie!', successBody: 'La tua richiesta è stata inviata con successo. Il nostro team ti contatterà entro 24 ore.', error: 'Qualcosa è andato storto. Riprova.' },
  footer: { rights: 'Tutti i diritti riservati.', pricing: 'Prezzi', contact: 'Contatti' },
};

const COPY: Record<Lang, Copy> = { sq: SQ, en: EN, it: IT };

export default function RecruitLandingPage() {
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
        body: JSON.stringify({ ...formData, packageId: selectedPackage?.id || '', packageName: selectedPackage ? `Recruit ${selectedPackage.title}` : '', source: 'Recruit Landing Page', category: 'Social Media - Recruit', message: `[${lang.toUpperCase()}] ${formData.message}` }) });
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
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center"><Briefcase className="w-4 h-4 text-white" /></div>
            <span className="text-xl font-bold bg-gradient-to-r from-blue-500 to-indigo-600 bg-clip-text text-transparent">FivoCRM Recruit</span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-gray-600">
            <a href="#results" className="hover:text-blue-500 transition-colors">{t.nav.results}</a>
            <a href="#process" className="hover:text-blue-500 transition-colors">{t.nav.process}</a>
            <a href="#packages" className="hover:text-blue-500 transition-colors">{t.nav.packages}</a>
            <a href="#addons" className="hover:text-blue-500 transition-colors">{t.nav.addons}</a>
            <a href="#testimonials" className="hover:text-blue-500 transition-colors">{t.nav.testimonials}</a>
          </div>
          <div className="flex items-center gap-3">
            <LangSwitcher lang={lang} setLang={setLang} accentClass="bg-blue-600" />
            <button onClick={() => scrollToContact()} className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:shadow-lg hover:shadow-blue-500/25 transition-all hover:-translate-y-0.5">{t.nav.cta}</button>
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
              accentClass="bg-gradient-to-r from-blue-500 to-indigo-600"
            />
          </div>
        </div>
      </nav>

      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-50/80 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-sky-200/30 rounded-full blur-3xl" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 border border-blue-100 mb-8">
                <div className="flex -space-x-2">{['DB', 'EK', 'AH', 'ML'].map((ini, i) => (<div key={i} className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 border-2 border-white flex items-center justify-center text-[10px] font-bold text-white">{ini}</div>))}</div>
                <span className="text-sm font-medium text-blue-700">{t.hero.badge}</span>
                <div className="flex">{[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}</div>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                {t.hero.h1a}{' '}<span className="bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500 bg-clip-text text-transparent">{t.hero.h1b}</span>{' '}{t.hero.h1c}
                <br /><span className="text-gray-400">{t.hero.h1d}</span>
              </h1>
            </FadeIn>
            <FadeIn delay={200}><p className="mt-8 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">{t.hero.sub1} <strong className="text-blue-500">{t.hero.sub2}</strong></p></FadeIn>
            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button onClick={scrollToPackages} className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 hover:shadow-xl hover:shadow-blue-500/25 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">{t.hero.ctaPrimary}<ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></button>
                <button onClick={() => scrollToContact()} className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border-2 border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all flex items-center justify-center gap-2"><Phone className="w-5 h-5" />{t.hero.ctaSecondary}</button>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-400">
                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-500" /> {t.hero.t1}</span>
                <span className="flex items-center gap-1.5"><Lock className="w-4 h-4 text-blue-500" /> {t.hero.t2}</span>
                <span className="flex items-center gap-1.5"><Briefcase className="w-4 h-4 text-indigo-500" /> {t.hero.t3}</span>
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
          <FadeIn delay={500}><div className="mt-12 text-center"><p className="text-lg text-gray-700 font-medium">{t.pains.bridge1} <span className="text-blue-500 font-bold">{t.pains.bridge2}</span></p></div></FadeIn>
        </div>
      </section>

      <section id="results" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-blue-500 mb-3">{t.results.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.results.title}</h2></div></FadeIn>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {t.results.items.map((r, i) => { const Icon = RESULT_ICONS[i]; return (
              <FadeIn key={i} delay={i * 100}><div className="text-center p-8 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100"><Icon className="w-8 h-8 text-blue-500 mx-auto mb-4" /><div className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-blue-500 to-indigo-600 bg-clip-text text-transparent"><Counter end={parseFloat(r.metric)} suffix={r.suffix} /></div><p className="mt-3 text-sm text-gray-600 font-medium">{r.label}</p></div></FadeIn>); })}
          </div>
        </div>
      </section>

      <section id="process" className="py-24 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-blue-400 mb-3">{t.process.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.process.title}</h2><p className="mt-4 text-gray-400 max-w-xl mx-auto">{t.process.sub}</p></div></FadeIn>
          <div className="grid md:grid-cols-4 gap-6 relative">
            <div className="hidden md:block absolute top-16 left-[12%] right-[12%] h-px bg-gradient-to-r from-blue-500/50 via-indigo-500/50 to-blue-500/50" />
            {t.process.steps.map((s, i) => { const Icon = PROCESS_ICONS[i]; return (
              <FadeIn key={i} delay={i * 150}><div className="relative text-center p-6 rounded-2xl bg-gray-800/50 border border-gray-700 hover:border-blue-500/50 transition-all group"><div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center mx-auto mb-4 text-lg font-bold relative z-10">{s.step}</div><Icon className="w-6 h-6 text-blue-400 mx-auto mb-3 group-hover:scale-110 transition-transform" /><h3 className="text-lg font-bold mb-2">{s.title}</h3><p className="text-gray-400 text-sm leading-relaxed">{s.desc}</p></div></FadeIn>); })}
          </div>
        </div>
      </section>

      <section id="packages" className="py-24 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-blue-500 mb-3">{t.packages.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.packages.title}</h2><p className="mt-4 text-gray-600 max-w-2xl mx-auto">{t.packages.sub}</p></div></FadeIn>
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6 items-start">
            {t.packages.list.map((pkg, i) => {
              const isSelected = selectedPackage?.id === pkg.id; const isExpanded = expandedCard === pkg.id;
              return (
                <FadeIn key={pkg.id} delay={i * 120}>
                  <div className={`relative rounded-2xl bg-white border-2 ${pkg.border} transition-all hover:shadow-2xl ${pkg.popular ? 'shadow-xl ring-2 ring-blue-500/20' : 'shadow-sm'} ${isSelected ? 'ring-2 ring-green-500' : ''}`}>
                    {pkg.badge && (<div className={`absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-gradient-to-r ${pkg.color} text-white text-xs font-bold tracking-wide whitespace-nowrap`}>{pkg.badge}</div>)}
                    <div className="p-6">
                      <h3 className="text-2xl font-bold">{pkg.title}</h3>
                      <p className="text-sm text-gray-500 mt-1">{pkg.subtitle}</p>
                      <div className="mt-5 flex items-baseline gap-1.5"><span className={`text-3xl font-bold bg-gradient-to-r ${pkg.color} bg-clip-text text-transparent`}>{pkg.price}</span>{pkg.priceNote && <span className="text-sm text-gray-500">{pkg.priceNote}</span>}</div>
                      <div className="mt-4 p-3 rounded-lg bg-gray-50"><p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t.packages.forLabel}</p><ul className="space-y-1">{pkg.targetAudience.map((a, ti) => (<li key={ti} className="text-xs text-gray-600 flex items-start gap-1.5"><span className="text-blue-400 mt-0.5">•</span>{a}</li>))}</ul></div>
                      <div className="mt-5 space-y-4">
                        {pkg.features.map((cat, ci) => (
                          <div key={ci}>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{cat.category}</p>
                            <ul className="space-y-2">{(isExpanded ? cat.items : cat.items.slice(0, 4)).map((feature, fi) => (<li key={fi} className="flex items-start gap-2 text-sm text-gray-700"><CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${pkg.popular ? 'text-blue-500' : 'text-green-500'}`} />{feature}</li>))}</ul>
                            {!isExpanded && cat.items.length > 4 && (<button onClick={() => setExpandedCard(pkg.id)} className="mt-2 text-xs text-blue-500 font-medium hover:underline">+{cat.items.length - 4} {t.packages.more}</button>)}
                          </div>
                        ))}
                      </div>
                      {isExpanded && (<button onClick={() => setExpandedCard(null)} className="mt-2 text-xs text-gray-400 hover:text-gray-600 font-medium">{t.packages.less}</button>)}
                      {pkg.notIncluded.length > 0 && isExpanded && (<div className="mt-4 pt-4 border-t border-gray-100"><p className="text-xs font-semibold uppercase tracking-wide text-red-400 mb-2">{t.packages.notIncluded}</p><ul className="space-y-1.5">{pkg.notIncluded.map((item, ni) => (<li key={ni} className="flex items-start gap-2 text-xs text-gray-500"><X className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-red-300" />{item}</li>))}</ul></div>)}
                      <button onClick={() => scrollToContact(pkg)} className={`mt-6 w-full py-3.5 rounded-xl text-sm font-semibold transition-all hover:-translate-y-0.5 ${pkg.popular ? `bg-gradient-to-r ${pkg.color} text-white hover:shadow-lg hover:shadow-blue-500/25` : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}>{isSelected ? t.packages.chosen : pkg.cta}</button>
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
          <FadeIn><div className="text-center mb-14"><p className="text-sm font-semibold uppercase tracking-widest text-blue-500 mb-3">{t.addons.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.addons.title}</h2><p className="mt-4 text-gray-600 max-w-xl mx-auto">{t.addons.sub}</p></div></FadeIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {t.addons.items.map((addon, i) => { const Icon = ADDON_ICONS[i]; return (
              <FadeIn key={i} delay={i * 80}><div className="flex items-center gap-4 p-5 rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-md hover:border-blue-100 transition-all"><div className="w-11 h-11 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0"><Icon className="w-5 h-5 text-blue-500" /></div><div className="flex-1 min-w-0"><p className="font-semibold text-gray-900 text-sm">{addon.name}</p><p className="text-blue-500 font-bold text-sm">{addon.price}</p></div></div></FadeIn>); })}
          </div>
        </div>
      </section>

      <section id="testimonials" className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-blue-500 mb-3">{t.testimonials.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.testimonials.title}</h2></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {t.testimonials.items.map((tm, i) => (
              <FadeIn key={i} delay={i * 150}><div className="p-8 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg transition-all h-full flex flex-col"><div className="flex mb-4">{[1,2,3,4,5].map(j => (<Star key={j} className="w-5 h-5 text-amber-400 fill-amber-400" />))}</div><p className="text-gray-700 leading-relaxed flex-1 italic">&ldquo;{tm.quote}&rdquo;</p><div className="mt-6 flex items-center gap-3 pt-4 border-t border-gray-100"><div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-bold text-sm">{tm.avatar}</div><div><p className="font-semibold text-sm">{tm.name}</p><p className="text-xs text-gray-500">{tm.role}</p></div></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-blue-500 mb-3">{t.faq.kicker}</p><h2 className="text-3xl sm:text-4xl font-bold">{t.faq.title}</h2></div></FadeIn>
          <div className="space-y-3">
            {t.faq.items.map((item, i) => (
              <FadeIn key={i} delay={i * 80}><div className="bg-white rounded-xl border border-gray-100 overflow-hidden"><button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"><span className="font-semibold text-gray-900 pr-4">{item.q}</span><ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} /></button><div className={`transition-all duration-300 overflow-hidden ${openFaq === i ? 'max-h-60 opacity-100' : 'max-h-0 opacity-0'}`}><p className="px-6 pb-5 text-gray-600 leading-relaxed">{item.a}</p></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className="py-24 bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 text-white relative overflow-hidden">
        <div className="absolute inset-0"><div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-3xl" /><div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-indigo-500/10 rounded-full blur-3xl" /></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-blue-400 mb-4">{t.contact.kicker}</p>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">{t.contact.title1} <span className="text-blue-400">{t.contact.title2}</span></h2>
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
                  {selectedPackage && (<div className="flex items-center justify-between px-4 py-3 rounded-xl bg-blue-500/20 border border-blue-500/30"><div><p className="text-xs text-blue-300">{t.contact.selected}</p><p className="font-semibold text-white">{selectedPackage.title} — {selectedPackage.price}{selectedPackage.priceNote ? ` ${selectedPackage.priceNote}` : ''}</p></div><button type="button" onClick={() => setSelectedPackage(null)} className="text-blue-300 hover:text-white text-sm underline">{t.contact.change}</button></div>)}
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.name}</label><input type="text" required value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder={t.contact.namePh} /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.email}</label><input type="email" required value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="email@domain.com" /></div>
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.phone}</label><input type="tel" value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder={t.contact.phonePh} /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.site}</label><input type="text" value={formData.website} onChange={e => setFormData(p => ({ ...p, website: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder={t.contact.sitePh} /></div>
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">{t.contact.message}</label><textarea rows={3} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" placeholder={t.contact.messagePh} /></div>
                  {formError && (<div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">{formError}</div>)}
                  <button type="submit" disabled={submitting} className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-400 hover:to-indigo-400 text-white shadow-lg shadow-blue-500/25 transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60">{submitting ? t.contact.submitting : t.contact.submit}{!submitting && <ArrowUpRight className="w-5 h-5" />}</button>
                  <p className="text-xs text-gray-400 text-center">{t.contact.privacy}</p>
                </form>
              )}
            </FadeIn>
          </div>
        </div>
      </section>

      <footer className="py-10 bg-gray-950 text-gray-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2"><div className="w-6 h-6 rounded bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center"><Briefcase className="w-3 h-3 text-white" /></div><span className="font-semibold text-white text-sm">FivoCRM</span></div>
          <p className="text-sm">&copy; {new Date().getFullYear()} FivoCRM. {t.footer.rights}</p>
          <div className="flex items-center gap-6 text-sm"><Link to="/login" className="hover:text-white transition-colors">{t.nav.login}</Link><a href="#packages" className="hover:text-white transition-colors">{t.footer.pricing}</a><a href="#contact" className="hover:text-white transition-colors">{t.footer.contact}</a></div>
        </div>
      </footer>
    </div>
  );
}
