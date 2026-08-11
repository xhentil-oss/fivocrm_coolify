import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  HardHat, Linkedin, Search, Target, CheckCircle2, ArrowRight, ArrowUpRight,
  ChevronDown, Phone, Shield, Globe2, Landmark, Ruler, Activity, ClipboardList,
  ScanLine, Users, Megaphone, BarChart3, Building2, Layers, Briefcase,
} from 'lucide-react';
import LandingMobileMenu from './LandingMobileMenu';

/* ─── Scroll animation ─── */
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

/* ═══════════════════════════════════════════════════════════════════════
   B2B marketing packages for engineering & infrastructure firms.

   English + CHF on purpose: the audience is Swiss and Western-Balkan
   engineering companies selling into tenders, institutions and IFI/EU
   funded projects — not local consumers. Every other landing page in this
   folder targets a consumer niche in ALL/EUR; this one must not be
   "translated" into that pattern.
   ═══════════════════════════════════════════════════════════════════════ */
interface ScopeGroup { label: string; items: string[] }

interface Pkg {
  id: string;
  title: string;
  tagline: string;
  price: string;
  priceNote: string;
  adBudget: string;
  /** Card stats row */
  posts: string;
  googleAds: string;
  linkedinAds: string;
  /** "Everything in <previous package>" chip */
  inherits?: string;
  popular?: boolean;
  badge?: string;
  color: string;
  border: string;
  ring: string;
  cta: string;
  scope: ScopeGroup[];
  reporting: string[];
}

const PACKAGES: Pkg[] = [
  {
    id: 'digital-foundation',
    title: 'Digital Foundation',
    tagline: 'Establishes a professional, consistent digital presence and builds the foundations for organic search visibility and paid promotion.',
    price: 'CHF 1,800 – 2,500',
    priceNote: '/ month',
    adBudget: 'CHF 1,500 – 2,500 / month',
    posts: '4 posts / mo',
    googleAds: '3 campaigns',
    linkedinAds: '3 campaigns',
    color: 'from-slate-600 to-slate-800',
    border: 'border-slate-200 hover:border-slate-400',
    ring: 'ring-slate-400',
    cta: 'Start with Foundation',
    scope: [
      {
        label: 'LinkedIn & Social Media',
        items: [
          '4 strategic LinkedIn posts / month',
          'Copywriting and graphic design',
          'Adaptation of the technical materials you provide',
          'Content publishing and scheduling',
          'Up to 2 additional posts for events, project updates or major company announcements',
          'Up to 2 Instagram / Facebook adaptations / month',
        ],
      },
      {
        label: 'Strategy & Positioning',
        items: [
          'Initial communication analysis',
          'Definition of LinkedIn positioning',
          'Target audience identification',
          'Definition of priority markets',
          'Content pillars',
          'Tone of voice',
          'Monthly editorial planning',
        ],
      },
      {
        label: 'SEO',
        items: [
          'Initial SEO audit',
          'Keyword research for priority services',
          'Basic competitor analysis',
          'On-page optimisation of priority website pages',
          'Meta title and description optimisation',
          'Google Search Console monitoring',
          'Basic technical SEO recommendations',
          'Organic visibility tracking',
        ],
      },
      {
        label: 'Google Ads',
        items: [
          'Google Ads setup and account structure',
          '3 active campaigns',
          'Keyword research and targeting',
          'Ad copywriting',
          'Negative keyword management',
          'Conversion tracking',
          'Monthly optimisation',
          'Search term monitoring',
        ],
      },
      {
        label: 'LinkedIn Ads',
        items: [
          '3 active campaigns',
          'Brand awareness campaigns',
          'Technical content promotion',
          'Qualified stakeholder targeting',
          'Audience segmentation by industry, role, seniority and geography',
          'Monthly optimisation',
        ],
      },
    ],
    reporting: [
      'LinkedIn performance',
      'Social media visibility',
      'Website traffic',
      'Organic search visibility',
      'Google Ads and LinkedIn Ads performance',
      'Leads and conversions',
    ],
  },
  {
    id: 'authority-lead-growth',
    title: 'Authority & Lead Growth',
    tagline: 'Strengthens your professional authority while creating qualified visibility, strategic connections and B2B opportunities.',
    price: 'CHF 3,000 – 4,200',
    priceNote: '/ month',
    adBudget: 'CHF 2,500 – 4,000 / month',
    posts: '6 posts / mo',
    googleAds: '5 campaigns',
    linkedinAds: '5 campaigns',
    inherits: 'Everything in Digital Foundation',
    color: 'from-navy-700 to-sky-600',
    border: 'border-sky-200 hover:border-sky-400',
    ring: 'ring-sky-400',
    cta: 'Choose Authority',
    scope: [
      {
        label: 'LinkedIn & Content',
        items: [
          '6 strategic LinkedIn posts / month',
          'Up to 2 additional reactive posts',
          'Up to 4 Instagram / Facebook adaptations / month',
          'Project and case-study communication',
          'Tender and contract announcements',
          'Partnership communication',
          'Event coverage',
          'Technical thought-leadership content',
        ],
      },
      {
        label: 'B2B Networking',
        items: [
          'Identification of priority stakeholder categories',
          'Target-account mapping',
          'Decision-maker identification',
          'Monthly networking strategy',
          'Engagement with relevant companies and institutions',
          'Professional connection strategy',
          'Outreach message development',
        ],
      },
      {
        label: 'SEO',
        items: [
          'Extended keyword research',
          'Search-intent analysis',
          'Competitor SEO monitoring',
          'Optimisation of priority service pages',
          'Optimisation of case-study pages',
          '1 SEO-focused article or technical content piece / month',
          'Internal linking optimisation',
          'Multilingual SEO recommendations',
          'Organic ranking monitoring',
        ],
      },
      {
        label: 'Google Ads',
        items: [
          '5 active campaigns',
          'Campaign segmentation by service and market',
          'Search campaigns',
          'Keyword and negative keyword management',
          'Conversion tracking',
          'Remarketing',
          'Search term analysis',
          'Landing-page recommendations',
          'Monthly performance optimisation',
        ],
      },
      {
        label: 'LinkedIn Ads',
        items: [
          '5 active campaigns',
          'Brand visibility and technical content promotion',
          'Decision-maker targeting',
          'Lead generation',
          'Market-specific campaigns',
          'Audience segmentation by company, industry, job title, seniority and geography',
        ],
      },
      {
        label: 'PR Support',
        items: [
          'Up to one strategic press release or institutional communication per quarter',
        ],
      },
    ],
    reporting: [
      'Organic keyword growth and search traffic',
      'Advertising conversions',
      'Cost per click (CPC) and cost per lead (CPL)',
      'Target companies reached',
      'Quality of professional connections',
      'B2B enquiries generated',
    ],
  },
  {
    id: 'strategic-b2b-growth',
    title: 'Strategic B2B Growth',
    tagline: 'An integrated communication and business-development system focused on authority, visibility, strategic relationships and qualified B2B opportunities.',
    price: 'CHF 4,500 – 6,500',
    priceNote: '/ month',
    adBudget: 'From CHF 4,000 / month',
    posts: '8 posts / mo',
    googleAds: '8 campaigns',
    linkedinAds: '8 campaigns',
    inherits: 'Everything in Authority & Lead Growth',
    popular: true,
    badge: 'Most recommended',
    color: 'from-sky-600 to-navy-700',
    border: 'border-sky-300 hover:border-sky-500',
    ring: 'ring-sky-400',
    cta: 'Choose Strategic Growth',
    scope: [
      {
        label: 'Advanced LinkedIn Strategy',
        items: [
          '8 strategic LinkedIn posts / month',
          'Up to 4 additional reactive posts',
          'Communication of tender awards and new contracts',
          'Communication of partnerships and project milestones',
          'Institutional developments and events',
        ],
      },
      {
        label: 'Executive Thought Leadership',
        items: [
          'Positioning of selected leaders or technical experts',
          'Up to 2 executive-profile posts / month',
          'Technical commentary and expert insights',
          'Professional networking content',
        ],
      },
      {
        label: 'Advanced B2B Networking',
        items: [
          'Monthly identification of target companies',
          'Stakeholder mapping and decision-maker research',
          'Target-account lists',
          'Networking and engagement strategy',
          'Outreach messaging and follow-up support',
          'Identification of potential business opportunities',
        ],
      },
      {
        label: 'Advanced SEO',
        items: [
          'Full ongoing SEO management',
          'Strategic keyword mapping',
          'Competitor gap analysis',
          'Service page and case-study SEO',
          'Technical SEO monitoring',
          'Multilingual SEO strategy',
          '2 SEO-focused articles or technical content pieces / month',
          'Recommendations for search-focused landing pages',
          'Monthly keyword ranking analysis',
          'Organic conversion monitoring',
        ],
      },
      {
        label: 'Google Ads',
        items: [
          '8 active campaigns',
          'Segmentation by service, sector and market',
          'Search, market-specific and service-specific campaigns',
          'Remarketing campaigns',
          'Conversion tracking and advanced bidding optimisation',
          'Search term analysis and lead quality monitoring',
          'Continuous campaign optimisation',
        ],
      },
      {
        label: 'LinkedIn Ads',
        items: [
          '8 active campaigns',
          'Brand visibility and technical authority',
          'Decision-maker and strategic account targeting',
          'Lead generation',
          'Market-entry campaigns',
          'Event and case-study promotion',
          'Structured by country, industry, job function, seniority, target company or institutional stakeholder',
        ],
      },
      {
        label: 'International & Institutional Communication',
        items: [
          'Dedicated support for Switzerland, Albania, Serbia, North Macedonia, Bosnia and Herzegovina, Montenegro and Kosovo',
          'Tender participation communication',
          'Project award and consortium announcements',
          'Strategic partnership announcements',
          'Major project milestone communication',
          'Communication support for International Financial Institution (IFI) and EU-funded projects',
        ],
      },
      {
        label: 'PR & Media',
        items: [
          'Press release preparation',
          'Corporate announcement support',
          'Media messaging',
          'Identification of relevant PR opportunities',
        ],
      },
    ],
    reporting: [
      'Everything in the previous packages, plus a quarterly strategic review of:',
      'Brand visibility, SEO and advertising performance',
      'Lead generation and stakeholder engagement',
      'Network development and business opportunities',
      'Priority markets, upcoming tenders, projects and partnerships',
    ],
  },
  {
    id: 'international-institutional',
    title: 'International & Institutional Growth',
    tagline: 'Built for large organisations pursuing broader international expansion, institutional communication and project-specific requirements.',
    price: 'Custom',
    priceNote: 'scoped per project',
    adBudget: 'Defined per market',
    posts: 'Full management',
    googleAds: '8+ per channel',
    linkedinAds: '8+ per channel',
    inherits: 'Everything in Strategic B2B Growth',
    badge: 'Enterprise',
    color: 'from-navy-800 to-navy-900',
    border: 'border-navy-700/30 hover:border-navy-700',
    ring: 'ring-navy-700',
    cta: 'Request a custom scope',
    scope: [
      {
        label: 'International Communication',
        items: [
          'Full international communication strategy',
          'Multi-market communication campaigns',
          'Full LinkedIn management',
          'Executive profile management',
          'Instagram and Facebook communication',
          'International event and conference communication',
        ],
      },
      {
        label: 'SEO & Web',
        items: [
          'International SEO strategy',
          'Multilingual keyword research',
          'Country-specific landing pages',
          'Technical SEO',
        ],
      },
      {
        label: 'Paid Advertising & ABM',
        items: [
          'Advanced Google Ads and LinkedIn Ads',
          'Account-based marketing',
          'Target company advertising',
          'Decision-maker campaigns',
          'Institutional stakeholder targeting',
          'A minimum starting structure of 8+ active campaigns per paid channel',
        ],
      },
      {
        label: 'Networking & Institutional',
        items: [
          'Target-account lists and decision-maker research',
          'Strategic networking and digital outreach',
          'Partner identification',
          'Consortium communication',
          'Communication for IFI and EU-funded projects',
          'Project dissemination strategies',
        ],
      },
      {
        label: 'Content & PR',
        items: [
          'PR and media relations',
          'Corporate presentations',
          'Technical publications',
          'Video production',
          'Case studies',
          'Project visibility materials',
        ],
      },
    ],
    reporting: [
      'Consolidated multi-market performance reporting',
      'Advertising performance per channel and per market',
      'Cost per lead by market',
      'Reporting scope and cadence agreed with your team at kick-off',
    ],
  },
];

const SECTORS = [
  { icon: Activity, label: 'Structural monitoring' },
  { icon: HardHat, label: 'Civil engineering' },
  { icon: ScanLine, label: 'Infrastructure diagnostics' },
  { icon: ClipboardList, label: 'Project management' },
  { icon: Ruler, label: 'Infrastructure design' },
  { icon: Landmark, label: 'IFI & EU-funded projects' },
];

const WHY = [
  {
    icon: Search,
    title: 'Decision-makers cannot find your expertise',
    desc: 'When a procurement officer or technical director researches monitoring specialists, they shortlist the firms that show up. Engineering excellence that is never published does not compete.',
  },
  {
    icon: Linkedin,
    title: 'A dormant LinkedIn page reads as a dormant company',
    desc: 'In B2B infrastructure, your company page is part of the due-diligence check. An empty feed signals risk to exactly the stakeholders you need to reassure.',
  },
  {
    icon: Target,
    title: 'Authority is built between tenders, not during them',
    desc: 'Awards, partnerships and project milestones compound into credibility. Silence between tenders means starting from zero on every new opportunity.',
  },
];

const STEPS = [
  { icon: ClipboardList, title: 'Position', desc: 'Communication analysis, priority markets, target audiences, content pillars and tone of voice.' },
  { icon: Layers, title: 'Build', desc: 'LinkedIn presence, on-page SEO, campaign structure and conversion tracking.' },
  { icon: Megaphone, title: 'Reach', desc: 'Google Ads and LinkedIn Ads segmented by service, market, industry and seniority.' },
  { icon: Users, title: 'Convert', desc: 'Target-account mapping, decision-maker outreach and qualified B2B enquiries.' },
];

const MARKETS = [
  'Switzerland', 'Albania', 'Serbia', 'North Macedonia',
  'Bosnia and Herzegovina', 'Montenegro', 'Kosovo',
];

const FAQ = [
  {
    q: 'Why LinkedIn instead of Instagram or Facebook?',
    a: 'Because that is where your buyers are. Procurement officers, technical directors, institutional stakeholders and consortium partners can be targeted on LinkedIn by company, industry, job function and seniority — no other channel allows that precision. Instagram and Facebook are included as adaptations, not as the core.',
  },
  {
    q: 'Is the advertising budget included in the monthly fee?',
    a: 'No. The monthly fee covers strategy, content, campaign management and reporting. Media spend is paid to Google and LinkedIn directly, so you always see exactly what went to the platforms. Each package states a recommended budget range.',
  },
  {
    q: 'Do you write the technical content yourselves?',
    a: 'We write, design and publish everything. The technical substance comes from your engineers: you provide project material, we turn it into publishable content. No technical claim is published without your approval.',
  },
  {
    q: 'How long before we see results?',
    a: 'Paid campaigns produce usable data within weeks. SEO, authority and network effects compound over months, which is why we recommend a minimum collaboration of six months for anything above the Foundation package.',
  },
  {
    q: 'Which markets can you cover?',
    a: 'Switzerland, Albania, Serbia, North Macedonia, Bosnia and Herzegovina, Montenegro and Kosovo, with multilingual SEO and market-specific ad campaigns. Additional markets are handled through the International & Institutional package.',
  },
  {
    q: 'Do you support tender and IFI / EU-funded project communication?',
    a: 'Yes — participation communication, award announcements, consortium and partnership communication, and project dissemination. This is communication support around the process; we do not write the technical bid itself.',
  },
  {
    q: 'Can we move between packages later?',
    a: 'Yes. Most firms start with Digital Foundation or Authority & Lead Growth and move up once the campaign structure and content pipeline are proven. Changes apply from the next monthly cycle.',
  },
];

/* ═══════════════════════════════════════════════════════════════════════ */

export default function EngineeringLandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', company: '', website: '', message: '' });
  const [formSent, setFormSent] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<Pkg | null>(null);

  const scrollToPackages = () => document.getElementById('packages')?.scrollIntoView({ behavior: 'smooth' });
  const scrollToContact = (pkg?: Pkg) => { if (pkg) setSelectedPackage(pkg); document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormError(''); setSubmitting(true);
    try {
      const res = await fetch('/api/landing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          packageId: selectedPackage?.id || '',
          // Price stays inside the label: `estimatedValue` is a number in the
          // tenant's own currency, and a CHF range written into it would silently
          // read as Lek/EUR in the CRM.
          packageName: selectedPackage ? `${selectedPackage.title} (${selectedPackage.price} ${selectedPackage.priceNote})` : '',
          source: 'Engineering B2B Landing Page',
          category: 'B2B Marketing',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      setFormSent(true);
    } catch (err: any) {
      setFormError(err.message || 'Something went wrong. Please try again.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans overflow-x-hidden">
      {/* ═══ NAV ═══ */}
      <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-navy-700 to-sky-600 flex items-center justify-center"><HardHat className="w-4 h-4 text-white" /></div>
            <span className="text-xl font-bold bg-gradient-to-r from-navy-700 to-sky-600 bg-clip-text text-transparent">FivoCRM B2B</span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-gray-600">
            <a href="#why" className="hover:text-sky-600 transition-colors">Why</a>
            <a href="#approach" className="hover:text-sky-600 transition-colors">Approach</a>
            <a href="#packages" className="hover:text-sky-600 transition-colors">Packages</a>
            <a href="#markets" className="hover:text-sky-600 transition-colors">Markets</a>
            <a href="#faq" className="hover:text-sky-600 transition-colors">FAQ</a>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="hidden sm:inline-flex text-sm font-medium text-gray-600 hover:text-sky-600 transition-colors">Login</Link>
            <button onClick={() => scrollToContact()} className="px-5 py-2.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-navy-700 to-sky-600 hover:shadow-lg hover:shadow-sky-500/25 transition-all hover:-translate-y-0.5">Book a Consultation</button>
            <LandingMobileMenu
              links={[
                { href: '#why', label: 'Why' },
                { href: '#approach', label: 'Approach' },
                { href: '#packages', label: 'Packages' },
                { href: '#markets', label: 'Markets' },
                { href: '#faq', label: 'FAQ' },
              ]}
              ctaLabel="Book a Consultation"
              onCta={() => scrollToContact()}
              accentClass="bg-gradient-to-r from-navy-700 to-sky-600"
            />
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-sky-50/70 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-sky-200/25 rounded-full blur-3xl" />
        <div className="absolute top-40 right-0 w-[400px] h-[400px] bg-navy-700/10 rounded-full blur-3xl" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-sky-50 border border-sky-100 mb-8">
                <Globe2 className="w-4 h-4 text-sky-600" />
                <span className="text-sm font-medium text-sky-700">B2B marketing for engineering &amp; infrastructure firms</span>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.12]">
                Your engineering is world-class.{' '}
                <span className="bg-gradient-to-r from-navy-700 via-sky-600 to-sky-500 bg-clip-text text-transparent">Your visibility is not.</span>
              </h1>
            </FadeIn>
            <FadeIn delay={200}>
              <p className="mt-8 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
                LinkedIn, SEO, Google Ads and B2B networking built for firms that win work through{' '}
                <strong className="text-navy-700">tenders, institutions and decision-makers</strong> — not impulse purchases.
              </p>
            </FadeIn>
            <FadeIn delay={300}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button onClick={scrollToPackages} className="group w-full sm:w-auto px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-navy-700 to-sky-600 hover:shadow-xl hover:shadow-sky-500/25 transition-all hover:-translate-y-1 flex items-center justify-center gap-2">View Packages<ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></button>
                <button onClick={() => scrollToContact()} className="w-full sm:w-auto px-8 py-4 text-lg font-semibold rounded-xl border-2 border-gray-200 hover:border-sky-300 hover:bg-sky-50 transition-all flex items-center justify-center gap-2"><Phone className="w-5 h-5" />Book a Consultation</button>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-400">
                <span className="flex items-center gap-1.5"><Globe2 className="w-4 h-4 text-sky-500" /> Switzerland &amp; Western Balkans</span>
                <span className="flex items-center gap-1.5"><Search className="w-4 h-4 text-navy-700" /> Multilingual SEO</span>
                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-500" /> Tender &amp; institutional communication</span>
              </div>
            </FadeIn>
          </div>

          {/* Sectors */}
          <FadeIn delay={500}>
            <div className="mt-16 grid grid-cols-3 md:grid-cols-6 gap-4 max-w-4xl mx-auto">
              {SECTORS.map((s, i) => (
                <div key={i} className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-100 hover:border-sky-200 hover:bg-sky-50/40 transition-colors text-center">
                  <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center"><s.icon className="w-5 h-5 text-sky-700" /></div>
                  <span className="text-xs font-semibold text-gray-700 leading-tight">{s.label}</span>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══ WHY ═══ */}
      <section id="why" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-sky-600 mb-3">Why B2B marketing</p><h2 className="text-3xl sm:text-4xl font-bold">Technical credibility has to be visible to count</h2></div></FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {WHY.map((w, i) => (
              <FadeIn key={i} delay={i * 150}><div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 hover:shadow-lg hover:border-sky-100 transition-all h-full"><div className="w-14 h-14 rounded-xl bg-sky-50 flex items-center justify-center mb-6"><w.icon className="w-7 h-7 text-sky-600" /></div><h3 className="text-xl font-bold mb-3">{w.title}</h3><p className="text-gray-600 leading-relaxed">{w.desc}</p></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ APPROACH ═══ */}
      <section id="approach" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-sky-600 mb-3">The approach</p><h2 className="text-3xl sm:text-4xl font-bold">One system, four stages</h2><p className="mt-4 text-gray-600 max-w-2xl mx-auto">Visibility → authority → qualified traffic → strategic connections → B2B leads → business opportunities.</p></div></FadeIn>
          <div className="grid md:grid-cols-4 gap-6 relative">
            <div className="hidden md:block absolute top-16 left-[12%] right-[12%] h-px bg-gradient-to-r from-navy-700/40 via-sky-500/50 to-navy-700/40" />
            {STEPS.map((s, i) => (
              <FadeIn key={i} delay={i * 150}><div className="relative text-center p-6 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg hover:border-sky-200 transition-all group h-full"><div className="w-12 h-12 rounded-full bg-gradient-to-br from-navy-700 to-sky-600 flex items-center justify-center mx-auto mb-4 text-lg font-bold text-white relative z-10">{i + 1}</div><s.icon className="w-6 h-6 text-sky-600 mx-auto mb-3 group-hover:scale-110 transition-transform" /><h3 className="text-lg font-bold mb-2">{s.title}</h3><p className="text-gray-500 text-sm leading-relaxed">{s.desc}</p></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PACKAGES ═══ */}
      <section id="packages" className="py-24 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-sky-600 mb-3">Packages</p><h2 className="text-3xl sm:text-4xl font-bold">Four levels, one continuous system</h2><p className="mt-4 text-gray-600 max-w-2xl mx-auto">Each package includes everything in the one before it. Management fee and advertising budget are always separate.</p></div></FadeIn>

          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6 items-start">
            {PACKAGES.map((pkg, i) => {
              const isSelected = selectedPackage?.id === pkg.id;
              const isOpen = !!expanded[pkg.id];
              const visibleScope = isOpen ? pkg.scope : pkg.scope.slice(0, 2);
              const hiddenGroups = pkg.scope.length - visibleScope.length;
              return (
                <FadeIn key={pkg.id} delay={i * 120}>
                  <div className={`relative rounded-2xl bg-white border-2 ${pkg.border} transition-all hover:shadow-2xl flex flex-col h-full ${pkg.popular ? `shadow-xl ring-2 ${pkg.ring}/20 xl:-mt-3 xl:mb-3` : 'shadow-sm'} ${isSelected ? 'ring-2 ring-green-500' : ''}`}>
                    {pkg.badge && (<div className={`absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-gradient-to-r ${pkg.color} text-white text-xs font-bold tracking-wide whitespace-nowrap`}>{pkg.badge}</div>)}
                    <div className="p-6 flex flex-col h-full">
                      <h3 className="text-xl font-bold leading-tight min-h-[56px]">{pkg.title}</h3>
                      <p className="text-sm text-gray-500 mt-2 min-h-[96px] leading-relaxed">{pkg.tagline}</p>

                      <div className="mt-4 flex flex-wrap items-baseline gap-x-2">
                        <span className={`text-2xl font-bold bg-gradient-to-r ${pkg.color} bg-clip-text text-transparent`}>{pkg.price}</span>
                        <span className="text-sm text-gray-500">{pkg.priceNote}</span>
                      </div>

                      {/* Stats: content volume / paid channels */}
                      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                        <div className="p-2.5 rounded-lg bg-gray-50"><Linkedin className="w-4 h-4 text-sky-600 mx-auto mb-1" /><p className="text-[11px] font-bold text-gray-900 leading-tight">{pkg.posts}</p></div>
                        <div className="p-2.5 rounded-lg bg-gray-50"><Search className="w-4 h-4 text-sky-600 mx-auto mb-1" /><p className="text-[11px] font-bold text-gray-900 leading-tight">{pkg.googleAds}</p><p className="text-[10px] text-gray-400">Google</p></div>
                        <div className="p-2.5 rounded-lg bg-gray-50"><Briefcase className="w-4 h-4 text-sky-600 mx-auto mb-1" /><p className="text-[11px] font-bold text-gray-900 leading-tight">{pkg.linkedinAds}</p><p className="text-[10px] text-gray-400">LinkedIn</p></div>
                      </div>

                      {pkg.inherits && (
                        <div className="mt-4 flex items-start gap-2 px-3 py-2 rounded-lg bg-navy-700/5 border border-navy-700/10">
                          <CheckCircle2 className="w-4 h-4 text-navy-700 mt-0.5 flex-shrink-0" />
                          <p className="text-xs font-semibold text-navy-700">{pkg.inherits}</p>
                        </div>
                      )}

                      {/* Scope */}
                      <div className="mt-5 space-y-4 flex-1">
                        {visibleScope.map(group => (
                          <div key={group.label}>
                            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">{group.label}</p>
                            <ul className="space-y-1.5">
                              {group.items.map((item, ii) => (
                                <li key={ii} className="flex items-start gap-2 text-sm text-gray-700 leading-snug">
                                  <CheckCircle2 className={`w-3.5 h-3.5 mt-1 flex-shrink-0 ${pkg.popular ? 'text-sky-500' : 'text-green-500'}`} />
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}

                        {isOpen && (
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5" />Reporting</p>
                            <ul className="space-y-1.5">
                              {pkg.reporting.map((item, ii) => (
                                <li key={ii} className="flex items-start gap-2 text-sm text-gray-700 leading-snug">
                                  <CheckCircle2 className="w-3.5 h-3.5 mt-1 flex-shrink-0 text-green-500" />
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => setExpanded(p => ({ ...p, [pkg.id]: !p[pkg.id] }))}
                        aria-expanded={isOpen}
                        className="mt-5 w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-sky-700 hover:text-navy-700 transition-colors"
                      >
                        {isOpen ? 'Show less' : `Show full scope (+${hiddenGroups} sections)`}
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>

                      <div className="mt-4 p-3 rounded-lg bg-sky-50 border border-sky-100">
                        <p className="text-[11px] font-semibold text-sky-700 uppercase tracking-wide mb-1">Recommended ad budget</p>
                        <p className="text-sm font-semibold text-gray-800">{pkg.adBudget}</p>
                      </div>

                      <button onClick={() => scrollToContact(pkg)} className={`mt-4 w-full py-3.5 rounded-xl text-sm font-semibold transition-all hover:-translate-y-0.5 ${pkg.popular ? `bg-gradient-to-r ${pkg.color} text-white hover:shadow-lg hover:shadow-sky-500/25` : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}>{isSelected ? '✓ Selected' : pkg.cta}</button>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>

          <FadeIn delay={500}><p className="mt-10 text-center text-sm text-gray-500 max-w-3xl mx-auto">Prices are monthly management fees in CHF and exclude VAT and advertising spend, which is paid directly to Google and LinkedIn. Content volumes are the committed minimum per month.</p></FadeIn>
        </div>
      </section>

      {/* ═══ CAMPAIGN STRUCTURE ═══ */}
      <section className="py-16 bg-white border-t border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-10"><p className="text-sm font-semibold uppercase tracking-widest text-sky-600 mb-3">At a glance</p><h2 className="text-2xl sm:text-3xl font-bold">Campaign structure per package</h2></div></FadeIn>
          <FadeIn delay={100}>
            <div className="overflow-x-auto rounded-2xl border border-gray-100 shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left font-semibold px-5 py-3">Package</th>
                    <th className="text-right font-semibold px-5 py-3">Google Ads</th>
                    <th className="text-right font-semibold px-5 py-3">LinkedIn Ads</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {PACKAGES.map(p => (
                    <tr key={p.id} className={p.popular ? 'bg-sky-50/50' : ''}>
                      <td className="px-5 py-3 font-semibold text-gray-900">{p.title}</td>
                      <td className="px-5 py-3 text-right text-gray-700">{p.googleAds}</td>
                      <td className="px-5 py-3 text-right text-gray-700">{p.linkedinAds}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs text-gray-500 text-center">International &amp; Institutional: 8+ campaigns per channel, with the final volume set by the markets and objectives involved.</p>
          </FadeIn>
        </div>
      </section>

      {/* ═══ RECOMMENDATION ═══ */}
      <section className="py-16 bg-gradient-to-r from-navy-900 via-navy-800 to-navy-700 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <FadeIn>
            <Target className="w-8 h-8 text-sky-400 mx-auto mb-4" />
            <h2 className="text-2xl sm:text-3xl font-bold mb-4">Which package do we recommend?</h2>
            <p className="text-gray-200 leading-relaxed">
              For an established engineering firm competing internationally, <strong className="text-sky-400">Strategic B2B Growth</strong> is the level where the parts start reinforcing each other: LinkedIn, social media, SEO, Google Ads, LinkedIn Ads, B2B networking, PR and institutional communication running as one system rather than separate services.
            </p>
            <p className="mt-5 text-sm font-semibold text-sky-300 uppercase tracking-wide">Recommended minimum collaboration: 6 months</p>
            <button onClick={() => scrollToContact(PACKAGES[2])} className="mt-8 px-7 py-3.5 rounded-xl font-semibold bg-white text-navy-900 hover:bg-sky-50 transition-all hover:-translate-y-0.5 inline-flex items-center gap-2">Discuss this package<ArrowRight className="w-4 h-4" /></button>
          </FadeIn>
        </div>
      </section>

      {/* ═══ MARKETS ═══ */}
      <section id="markets" className="py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-10"><p className="text-sm font-semibold uppercase tracking-widest text-sky-600 mb-3">Markets</p><h2 className="text-2xl sm:text-3xl font-bold">Dedicated communication support per market</h2><p className="mt-3 text-gray-600">Multilingual SEO, market-specific campaigns and country-level positioning.</p></div></FadeIn>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {MARKETS.map((m, i) => (
              <FadeIn key={m} delay={i * 60}>
                <div className="flex items-center gap-2.5 px-4 py-3.5 rounded-xl border border-gray-100 bg-white shadow-sm hover:border-sky-200 hover:bg-sky-50/40 transition-colors h-full">
                  <Building2 className="w-4 h-4 text-sky-600 flex-shrink-0" />
                  <span className="text-sm font-semibold text-gray-800 leading-tight">{m}</span>
                </div>
              </FadeIn>
            ))}
            <FadeIn delay={MARKETS.length * 60}>
              <div className="flex items-center gap-2.5 px-4 py-3.5 rounded-xl border border-dashed border-sky-300 bg-sky-50/50 h-full">
                <Globe2 className="w-4 h-4 text-sky-600 flex-shrink-0" />
                <span className="text-sm font-semibold text-sky-700 leading-tight">Additional markets on request</span>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="py-24 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn><div className="text-center mb-16"><p className="text-sm font-semibold uppercase tracking-widest text-sky-600 mb-3">FAQ</p><h2 className="text-3xl sm:text-4xl font-bold">Questions engineering firms ask us</h2></div></FadeIn>
          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <FadeIn key={i} delay={i * 80}><div className="bg-white rounded-xl border border-gray-100 overflow-hidden"><button onClick={() => setOpenFaq(openFaq === i ? null : i)} aria-expanded={openFaq === i} className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"><span className="font-semibold text-gray-900 pr-4">{item.q}</span><ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} /></button><div className={`transition-all duration-300 overflow-hidden ${openFaq === i ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}><p className="px-6 pb-5 text-gray-600 leading-relaxed">{item.a}</p></div></div></FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ CONTACT ═══ */}
      <section id="contact" className="py-24 bg-gradient-to-br from-navy-900 via-navy-800 to-navy-900 text-white relative overflow-hidden">
        <div className="absolute inset-0"><div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-sky-500/10 rounded-full blur-3xl" /><div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-sky-400/10 rounded-full blur-3xl" /></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-sky-400 mb-4">Ready to start?</p>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">Let's build the visibility your <span className="text-sky-400">technical work deserves</span></h2>
                <p className="mt-5 text-gray-300 leading-relaxed text-lg">Send us your details and we will come back with a scoped proposal for your markets, services and target stakeholders. The first consultation is free.</p>
                <div className="mt-8 space-y-4">
                  <div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">Management fee and ad spend always separate</span></div>
                  <div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">Monthly reporting on leads, not just impressions</span></div>
                  <div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-400" /><span className="text-gray-300">Nothing technical published without your approval</span></div>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              {formSent ? (
                <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-10 border border-white/10 text-center"><div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6"><CheckCircle2 className="w-10 h-10 text-green-400" /></div><h3 className="text-2xl font-bold mb-3">Thank you</h3><p className="text-gray-300">Your request has been sent. We will get back to you within one business day.</p></div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/10 space-y-5">
                  <h3 className="text-xl font-bold mb-2">Request a proposal</h3>
                  {selectedPackage && (<div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-sky-500/20 border border-sky-500/30"><div><p className="text-xs text-sky-300">Selected package</p><p className="font-semibold text-white text-sm">{selectedPackage.title} — {selectedPackage.price} {selectedPackage.priceNote}</p></div><button type="button" onClick={() => setSelectedPackage(null)} className="text-sky-300 hover:text-white text-sm underline flex-shrink-0">Change</button></div>)}
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Full name *</label><input type="text" required value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="Name Surname" /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Work email *</label><input type="email" required value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="name@company.com" /></div>
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Phone</label><input type="tel" value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="+41 XX XXX XX XX" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Company</label><input type="text" value={formData.company} onChange={e => setFormData(p => ({ ...p, company: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="Company name" /></div>
                    <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Website</label><input type="text" value={formData.website} onChange={e => setFormData(p => ({ ...p, website: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="company.com" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-300 mb-1.5">Target markets &amp; objectives (optional)</label><textarea rows={3} value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none" placeholder="Which markets, services and stakeholders matter most to you?" /></div>
                  {formError && (<div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">{formError}</div>)}
                  <button type="submit" disabled={submitting} className="w-full py-4 rounded-xl text-lg font-bold bg-gradient-to-r from-sky-600 to-sky-500 hover:from-sky-500 hover:to-sky-400 text-white shadow-lg shadow-sky-500/25 transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-60">{submitting ? 'Sending...' : 'Send Request'}{!submitting && <ArrowUpRight className="w-5 h-5" />}</button>
                  <p className="text-xs text-gray-400 text-center">By submitting you accept our privacy policy. No unsolicited messages.</p>
                </form>
              )}
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="py-10 bg-navy-900 text-gray-400 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2"><div className="w-6 h-6 rounded bg-gradient-to-br from-navy-700 to-sky-600 flex items-center justify-center"><HardHat className="w-3 h-3 text-white" /></div><span className="font-semibold text-white text-sm">FivoCRM B2B</span></div>
          <p className="text-sm">&copy; {new Date().getFullYear()} FivoCRM. All rights reserved.</p>
          <div className="flex items-center gap-6 text-sm"><Link to="/login" className="hover:text-white transition-colors">Login</Link><a href="#packages" className="hover:text-white transition-colors">Packages</a><a href="#contact" className="hover:text-white transition-colors">Contact</a></div>
        </div>
      </footer>
    </div>
  );
}
