import React, { useState, useMemo } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Card } from './ui/card';
import {
  Building, Globe,
  Target, FileText, DollarSign,
  ChevronRight, ChevronLeft, Check, Instagram, Facebook, Linkedin,
  Share2, Search, Palette, PenTool, Megaphone, Send, AlertCircle, PlusCircle,
} from 'lucide-react';

// --------------- Types ---------------

interface FormData {
  // Step 1: Basic Info
  businessName: string;
  contactName: string;
  email: string;
  phoneNumber: string;
  jobTitle: string;
  industry: string;
  cityMarket: string;
  website: string;
  instagramLink: string;
  facebookLink: string;
  tiktokLink: string;
  linkedinLink: string;
  // Step 2: Service Interest
  servicesInterestedIn: string[];
  mainGoal: string;
  projectNeedDescription: string;
  currentMainChallenge: string;
  hasWorkedWithAgency: string;
  whatHaveYouTried: string;
  // Step 3: Service-specific
  // Social Media
  smm_mainPlatforms: string[];
  smm_organicOrAds: string;
  smm_hasContent: string;
  smm_postingFrequency: string;
  smm_toneOfCommunication: string;
  smm_contentTypes: string[];
  // Web Design
  web_hasExistingWebsite: string;
  web_existingWebsiteLink: string;
  web_mainPurpose: string;
  web_estimatedPages: string;
  web_hasTextsAndPhotos: string;
  web_websitesYouLike: string;
  web_features: string[];
  // Paid Ads
  ads_platforms: string[];
  ads_mainConversionAction: string;
  ads_monthlyBudget: string;
  ads_hasRunAdsBefore: string;
  ads_pastResults: string;
  ads_hasLandingPage: string;
  // Branding
  brand_hasExistingLogo: string;
  brand_whatYouNeed: string[];
  brand_coreValues: string;
  brand_targetAudience: string;
  brand_competitors: string;
  brand_preferredStyle: string;
  // Content Creation
  content_types: string[];
  content_platforms: string[];
  content_frequency: string;
  content_hasModels: string;
  content_visualStyle: string;
  // SEO
  seo_hasWebsite: string;
  seo_websitePlatform: string;
  seo_targetKeywords: string;
  seo_targetMarket: string;
  seo_hasDoneSEO: string;
  seo_competitors: string;
  // Step 4: Budget & Materials
  budgetRange: string;
  timeline: string;
  isUrgent: string;
  decisionMaker: string;
  preferredContactMethod: string;
  hasExistingMaterials: string;
  googleDriveLink: string;
  secondGoogleDriveLink: string;
  folderIncludes: string[];
  hasBrandGuidelines: string;
}

const initialFormData: FormData = {
  businessName: '', contactName: '', email: '', phoneNumber: '',
  jobTitle: '', industry: '', cityMarket: '', website: '',
  instagramLink: '', facebookLink: '', tiktokLink: '', linkedinLink: '',
  servicesInterestedIn: [], mainGoal: '', projectNeedDescription: '',
  currentMainChallenge: '', hasWorkedWithAgency: '', whatHaveYouTried: '',
  smm_mainPlatforms: [], smm_organicOrAds: '', smm_hasContent: '',
  smm_postingFrequency: '', smm_toneOfCommunication: '', smm_contentTypes: [],
  web_hasExistingWebsite: '', web_existingWebsiteLink: '',
  web_mainPurpose: '', web_estimatedPages: '', web_hasTextsAndPhotos: '',
  web_websitesYouLike: '', web_features: [],
  ads_platforms: [], ads_mainConversionAction: '', ads_monthlyBudget: '',
  ads_hasRunAdsBefore: '', ads_pastResults: '', ads_hasLandingPage: '',
  brand_hasExistingLogo: '', brand_whatYouNeed: [], brand_coreValues: '',
  brand_targetAudience: '', brand_competitors: '', brand_preferredStyle: '',
  content_types: [], content_platforms: [], content_frequency: '',
  content_hasModels: '', content_visualStyle: '',
  seo_hasWebsite: '', seo_websitePlatform: '', seo_targetKeywords: '',
  seo_targetMarket: '', seo_hasDoneSEO: '', seo_competitors: '',
  budgetRange: '', timeline: '', isUrgent: '', decisionMaker: '',
  preferredContactMethod: '',
  hasExistingMaterials: '', googleDriveLink: '', secondGoogleDriveLink: '',
  folderIncludes: [], hasBrandGuidelines: '',
};

// --------------- Constants ---------------

const INDUSTRIES = [
  'Restorant', 'Hotel', 'Klinikë', 'Retail', 'Real Estate', 'Edukim', 'Tjetër',
];

const SERVICES = [
  { value: 'Social Media Marketing', label: 'Social Media Marketing', icon: Share2 },
  { value: 'Web Design', label: 'Web Design', icon: Globe },
  { value: 'Paid Ads', label: 'Paid Ads', icon: Megaphone },
  { value: 'Branding', label: 'Branding', icon: Palette },
  { value: 'Content Creation', label: 'Content Creation', icon: PenTool },
  { value: 'SEO', label: 'SEO', icon: Search },
  { value: 'Tjetër', label: 'Tjetër', icon: FileText },
];

const SERVICE_GOALS: Record<string, string[]> = {
  'Web Design': ['Website i ri', 'Ridizajnim website-i', 'Landing Page', 'E-commerce', 'Booking Platform'],
  'Social Media Marketing': ['Rritje ndjekësish', 'Brand awareness', 'Më shumë engagement', 'Shitje nga social media'],
  'Paid Ads': ['Më shumë shitje online', 'Më shumë lead-e', 'Trafik në website', 'Instalime aplikacioni'],
  'Branding': ['Logo e re', 'Identitet vizual komplet', 'Rifreskim brandi', 'Brand Guidelines'],
  'Content Creation': ['Foto profesionale', 'Video marketing', 'Reels & TikTok', 'Copywriting'],
  'SEO': ['Pozicionim në Google', 'SEO lokal', 'Më shumë trafik organik', 'Analizë konkurrentësh'],
};

const SERVICE_DESCRIPTION_HINTS: Record<string, string> = {
  'Web Design': 'Përshkruani llojin e website-it që dëshironi, funksionalitetet, dhe stilin vizual...',
  'Social Media Marketing': 'Përshkruani çfarë dëshironi të arrini me rrjetet sociale, audiencën tuaj...',
  'Paid Ads': 'Përshkruani produktet/shërbimet që dëshironi të reklamoni dhe audiencën target...',
  'Branding': 'Përshkruani vizionin tuaj për markën, vlerat, dhe stilin që dëshironi...',
  'Content Creation': 'Përshkruani llojin e përmbajtjes që ju nevojitet dhe ku do ta përdorni...',
  'SEO': 'Përshkruani website-in tuaj, fjalët kyçe target, dhe çfarë dëshironi të arrini...',
};

const SERVICES_WITH_QUESTIONS = ['Social Media Marketing', 'Web Design', 'Paid Ads', 'Branding', 'Content Creation', 'SEO'];

const BUDGETS = [
  'Nën €300', '€300–€500', '€500–€1000', '€1000–€3000', '€3000+',
];

const TIMELINES = [
  'Menjëherë', 'Brenda 30 ditësh', 'Brenda 3 muajsh', 'Vetëm po informohem',
];

const FOLDER_ITEMS = [
  'Foto', 'Video', 'Logo', 'Brand Guide', 'Tekste', 'Dokumente', 'Tjetër',
];

// --------------- Multi-select helper ---------------

const MultiSelectChips: React.FC<{
  options: { value: string; label: string; icon?: React.ElementType }[];
  selected: string[];
  onChange: (selected: string[]) => void;
  columns?: number;
}> = ({ options, selected, onChange, columns = 2 }) => {
  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter(v => v !== value)
        : [...selected, value]
    );
  };

  return (
    <div className={`grid grid-cols-1 ${columns === 3 ? 'sm:grid-cols-3' : columns === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-2'} gap-2`}>
      {options.map(opt => {
        const isActive = selected.includes(opt.value);
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all text-left ${
              isActive
                ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/30'
                : 'border-border bg-background hover:border-primary/40 hover:bg-muted/50 text-foreground'
            }`}
          >
            {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
            <span className="flex-1">{opt.label}</span>
            {isActive && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
          </button>
        );
      })}
    </div>
  );
};

// --------------- Steps ---------------

const STEPS = [
  { id: 1, title: 'Informacion Bazë', icon: Building },
  { id: 2, title: 'Shërbimi & Objektivi', icon: Target },
  { id: 3, title: 'Pyetje Specifike', icon: FileText },
  { id: 4, title: 'Buxheti & Materialet', icon: DollarSign },
];

// --------------- Component ---------------

interface Props {
  onSubmit: (data: FormData) => Promise<void>;
  preselectedService?: string;
  prefillEmail?: string;
  prefillName?: string;
}

const ServiceQuestionnaireForm: React.FC<Props> = ({ onSubmit, preselectedService, prefillEmail, prefillName }) => {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(() => ({
    ...initialFormData,
    servicesInterestedIn: preselectedService ? [preselectedService] : [],
    email: prefillEmail || '',
    contactName: prefillName || '',
  }));
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Custom industries
  const { data: customIndustries } = useCollection<any>('customIndustries', {
    orderBy: { field: 'name', direction: 'asc' },
    skipTeamFilter: true,
  });
  const customIndustryMutation = useMutation<any>('customIndustries');
  const [showAddIndustry, setShowAddIndustry] = useState(false);
  const [newIndustryName, setNewIndustryName] = useState('');

  const allIndustries = useMemo(() => {
    const customNames = (customIndustries || []).map((ci: any) => ci.name);
    return [...INDUSTRIES, ...customNames.filter((n: string) => !INDUSTRIES.includes(n))];
  }, [customIndustries]);

  const handleAddIndustry = async () => {
    const name = newIndustryName.trim();
    if (!name || allIndustries.some(i => i.toLowerCase() === name.toLowerCase())) return;
    await customIndustryMutation.create({ name });
    set('industry', name);
    setNewIndustryName('');
    setShowAddIndustry(false);
  };

  const set = (field: keyof FormData, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  };

  // Dynamic goals based on selected services
  const availableGoals = useMemo(() => {
    const goals = new Set<string>();
    form.servicesInterestedIn.forEach(s => {
      (SERVICE_GOALS[s] || []).forEach(g => goals.add(g));
    });
    if (goals.size === 0) goals.add('Tjetër');
    return Array.from(goals);
  }, [form.servicesInterestedIn]);

  // Reset mainGoal if no longer in available goals
  React.useEffect(() => {
    if (form.mainGoal && !availableGoals.includes(form.mainGoal)) {
      set('mainGoal', '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableGoals]);

  // Dynamic description placeholder
  const descriptionPlaceholder = useMemo(() => {
    const selected = form.servicesInterestedIn.filter(s => s !== 'Tjetër');
    if (selected.length === 1) return SERVICE_DESCRIPTION_HINTS[selected[0]] || 'Përshkruani nevojën tuaj...';
    if (selected.length > 1) return 'Përshkruani çfarë dëshironi të arrini me shërbimet e zgjedhura...';
    return 'Përshkruani nevojën tuaj...';
  }, [form.servicesInterestedIn]);

  // Determine if step 3 (service-specific) should show
  const hasServiceSpecific = form.servicesInterestedIn.some(s =>
    SERVICES_WITH_QUESTIONS.includes(s)
  );
  const totalSteps = hasServiceSpecific ? 4 : 3;

  // Map display step to actual step when step 3 is skipped
  const actualStep = (displayStep: number) => {
    if (hasServiceSpecific) return displayStep;
    return displayStep >= 3 ? displayStep + 1 : displayStep;
  };

  const visibleSteps = hasServiceSpecific
    ? STEPS
    : STEPS.filter(s => s.id !== 3);

  // Validation per step
  const validateStep = (s: number): boolean => {
    const actual = actualStep(s);
    const e: Record<string, string> = {};
    if (actual === 1) {
      if (!form.businessName.trim()) e.businessName = 'E detyrueshme';
      if (!form.contactName.trim()) e.contactName = 'E detyrueshme';
      if (!form.email.trim()) e.email = 'E detyrueshme';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Email i pavlefshëm';
      if (!form.phoneNumber.trim()) e.phoneNumber = 'E detyrueshme';
      if (!form.industry) e.industry = 'E detyrueshme';
    } else if (actual === 2) {
      if (form.servicesInterestedIn.length === 0) e.servicesInterestedIn = 'Zgjidhni të paktën një shërbim';
      if (!form.mainGoal) e.mainGoal = 'E detyrueshme';
      if (!form.projectNeedDescription.trim()) e.projectNeedDescription = 'E detyrueshme';
    } else if (actual === 3) {
      if (form.servicesInterestedIn.includes('Social Media Marketing')) {
        if (form.smm_mainPlatforms.length === 0) e.smm_mainPlatforms = 'Zgjidhni të paktën një platformë';
        if (!form.smm_organicOrAds) e.smm_organicOrAds = 'E detyrueshme';
      }
      if (form.servicesInterestedIn.includes('Web Design')) {
        if (!form.web_hasExistingWebsite) e.web_hasExistingWebsite = 'E detyrueshme';
        if (!form.web_mainPurpose) e.web_mainPurpose = 'E detyrueshme';
      }
      if (form.servicesInterestedIn.includes('Paid Ads')) {
        if (form.ads_platforms.length === 0) e.ads_platforms = 'Zgjidhni të paktën një platformë';
        if (!form.ads_mainConversionAction) e.ads_mainConversionAction = 'E detyrueshme';
        if (!form.ads_monthlyBudget) e.ads_monthlyBudget = 'E detyrueshme';
      }
      if (form.servicesInterestedIn.includes('Branding')) {
        if (form.brand_whatYouNeed.length === 0) e.brand_whatYouNeed = 'Zgjidhni të paktën një opsion';
        if (!form.brand_hasExistingLogo) e.brand_hasExistingLogo = 'E detyrueshme';
      }
      if (form.servicesInterestedIn.includes('Content Creation')) {
        if (form.content_types.length === 0) e.content_types = 'Zgjidhni të paktën një lloj';
      }
      if (form.servicesInterestedIn.includes('SEO')) {
        if (!form.seo_hasWebsite) e.seo_hasWebsite = 'E detyrueshme';
        if (!form.seo_targetMarket) e.seo_targetMarket = 'E detyrueshme';
      }
    } else if (actual === 4) {
      if (!form.budgetRange) e.budgetRange = 'E detyrueshme';
      if (!form.timeline) e.timeline = 'E detyrueshme';
      if (!form.decisionMaker) e.decisionMaker = 'E detyrueshme';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (validateStep(step)) {
      setStep(Math.min(step + 1, totalSteps));
    }
  };
  const prev = () => setStep(Math.max(step - 1, 1));

  const handleSubmit = async () => {
    if (!validateStep(step)) return;
    setSubmitting(true);
    try {
      await onSubmit(form);
    } finally {
      setSubmitting(false);
    }
  };

  const FieldError: React.FC<{ field: string }> = ({ field }) =>
    errors[field] ? <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{errors[field]}</p> : null;

  // ---------- Step 1: Basic Info ----------

  const renderStep1 = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-medium">Emri i Biznesit *</Label>
          <Input value={form.businessName} onChange={e => set('businessName', e.target.value)} placeholder="p.sh. Fivo Studio" className="mt-1" />
          <FieldError field="businessName" />
        </div>
        <div>
          <Label className="text-sm font-medium">Emri i Kontaktit *</Label>
          <Input value={form.contactName} onChange={e => set('contactName', e.target.value)} placeholder="p.sh. Andi Hoxha" className="mt-1" />
          <FieldError field="contactName" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-medium">Email *</Label>
          <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="email@example.com" className="mt-1" />
          <FieldError field="email" />
        </div>
        <div>
          <Label className="text-sm font-medium">Numri i Telefonit *</Label>
          <Input value={form.phoneNumber} onChange={e => set('phoneNumber', e.target.value)} placeholder="+355 69 xxx xxxx" className="mt-1" />
          <FieldError field="phoneNumber" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-medium">Pozicioni / Roli</Label>
          <Input value={form.jobTitle} onChange={e => set('jobTitle', e.target.value)} placeholder="p.sh. CEO, Menaxher Marketing" className="mt-1" />
        </div>
        <div>
          <Label className="text-sm font-medium">Industria *</Label>
          {showAddIndustry ? (
            <div className="flex gap-2 mt-1">
              <Input
                value={newIndustryName}
                onChange={e => setNewIndustryName(e.target.value)}
                placeholder="Emri i industrisë"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddIndustry(); } }}
              />
              <Button type="button" size="sm" onClick={handleAddIndustry} disabled={!newIndustryName.trim()}>Shto</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowAddIndustry(false)}>Anulo</Button>
            </div>
          ) : (
            <div className="flex gap-2 mt-1">
              <Select value={form.industry} onValueChange={v => set('industry', v)}>
                <SelectTrigger><SelectValue placeholder="Zgjidh industrinë" /></SelectTrigger>
                <SelectContent>
                  {allIndustries.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="icon" className="flex-shrink-0" onClick={() => setShowAddIndustry(true)} title="Shto industri te re">
                <PlusCircle className="w-4 h-4" />
              </Button>
            </div>
          )}
          <FieldError field="industry" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-medium">Qyteti / Tregu</Label>
          <Input value={form.cityMarket} onChange={e => set('cityMarket', e.target.value)} placeholder="p.sh. Tiranë" className="mt-1" />
        </div>
        <div>
          <Label className="text-sm font-medium">Website</Label>
          <Input value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://..." className="mt-1" />
        </div>
      </div>

      <div className="pt-2 border-t">
        <Label className="text-sm font-medium text-muted-foreground mb-3 block">Rrjetet Sociale (opsionale)</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <Instagram className="w-4 h-4 text-pink-500 flex-shrink-0" />
            <Input value={form.instagramLink} onChange={e => set('instagramLink', e.target.value)} placeholder="Instagram link" className="h-9 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <Facebook className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <Input value={form.facebookLink} onChange={e => set('facebookLink', e.target.value)} placeholder="Facebook link" className="h-9 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 flex-shrink-0" />
            <Input value={form.tiktokLink} onChange={e => set('tiktokLink', e.target.value)} placeholder="TikTok link" className="h-9 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <Linkedin className="w-4 h-4 text-blue-700 flex-shrink-0" />
            <Input value={form.linkedinLink} onChange={e => set('linkedinLink', e.target.value)} placeholder="LinkedIn link" className="h-9 text-sm" />
          </div>
        </div>
      </div>
    </div>
  );

  // ---------- Step 2: Service & Goal ----------

  const renderStep2 = () => (
    <div className="space-y-5">
      <div>
        <Label className="text-sm font-medium mb-2 block">Cilat shërbime ju interesojnë? *</Label>
        <MultiSelectChips
          options={SERVICES}
          selected={form.servicesInterestedIn}
          onChange={v => set('servicesInterestedIn', v)}
        />
        <FieldError field="servicesInterestedIn" />
      </div>

      {form.servicesInterestedIn.length > 0 && (
        <>
          <div>
            <Label className="text-sm font-medium">Objektivi kryesor *</Label>
            <Select value={form.mainGoal} onValueChange={v => set('mainGoal', v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh objektivin" /></SelectTrigger>
              <SelectContent>
                {availableGoals.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
            <FieldError field="mainGoal" />
          </div>

          <div>
            <Label className="text-sm font-medium">Përshkruani nevojën tuaj *</Label>
            <Textarea
              value={form.projectNeedDescription}
              onChange={e => set('projectNeedDescription', e.target.value)}
              placeholder={descriptionPlaceholder}
              className="mt-1 min-h-[100px]"
            />
            <FieldError field="projectNeedDescription" />
          </div>

          <div>
            <Label className="text-sm font-medium">Sfida kryesore aktuale</Label>
            <Textarea value={form.currentMainChallenge} onChange={e => set('currentMainChallenge', e.target.value)} placeholder="Cila është sfida më e madhe që po përballoni tani?" className="mt-1 min-h-[80px]" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium">Keni punuar me agjenci më parë?</Label>
              <Select value={form.hasWorkedWithAgency} onValueChange={v => set('hasWorkedWithAgency', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Po">Po</SelectItem>
                  <SelectItem value="Jo">Jo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.hasWorkedWithAgency === 'Po' && (
            <div>
              <Label className="text-sm font-medium">Çfarë keni provuar deri tani?</Label>
              <Textarea value={form.whatHaveYouTried} onChange={e => set('whatHaveYouTried', e.target.value)} placeholder="Përshkruani eksperiencat e mëparshme..." className="mt-1 min-h-[80px]" />
            </div>
          )}
        </>
      )}
    </div>
  );

  // ---------- Step 3: Conditional Service-Specific Questions ----------

  const renderStep3ServiceSpecific = () => {
    const showSMM = form.servicesInterestedIn.includes('Social Media Marketing');
    const showWeb = form.servicesInterestedIn.includes('Web Design');
    const showAds = form.servicesInterestedIn.includes('Paid Ads');
    const showBranding = form.servicesInterestedIn.includes('Branding');
    const showContent = form.servicesInterestedIn.includes('Content Creation');
    const showSEO = form.servicesInterestedIn.includes('SEO');

    return (
      <div className="space-y-6">
        <div className="bg-muted/30 rounded-lg p-3 text-sm text-muted-foreground">
          Pyetje specifike bazuar në shërbimet që zgjodhët. Kjo na ndihmon të përgatisim një propozim të personalizuar.
        </div>

        {/* ─── Social Media Marketing ─── */}
        {showSMM && (
          <Card className="p-4 space-y-4 border-purple-200 bg-purple-50/30 dark:bg-purple-950/10 dark:border-purple-800/40">
            <div className="flex items-center gap-2">
              <Share2 className="w-5 h-5 text-purple-600" />
              <h3 className="font-semibold text-sm">Social Media Marketing</h3>
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Platformat kryesore *</Label>
              <MultiSelectChips
                options={[
                  { value: 'Instagram', label: 'Instagram' },
                  { value: 'Facebook', label: 'Facebook' },
                  { value: 'TikTok', label: 'TikTok' },
                  { value: 'LinkedIn', label: 'LinkedIn' },
                ]}
                selected={form.smm_mainPlatforms}
                onChange={v => set('smm_mainPlatforms', v)}
                columns={4}
              />
              <FieldError field="smm_mainPlatforms" />
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Lloji i përmbajtjes</Label>
              <MultiSelectChips
                options={[
                  { value: 'Posts statike', label: 'Posts statike' },
                  { value: 'Reels / Video', label: 'Reels / Video' },
                  { value: 'Stories', label: 'Stories' },
                  { value: 'Carousel', label: 'Carousel' },
                ]}
                selected={form.smm_contentTypes}
                onChange={v => set('smm_contentTypes', v)}
                columns={4}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Organik ose Ads? *</Label>
                <Select value={form.smm_organicOrAds} onValueChange={v => set('smm_organicOrAds', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Vetëm organik">Vetëm organik</SelectItem>
                    <SelectItem value="Organik + Ads">Organik + Ads</SelectItem>
                    <SelectItem value="Vetëm Ads">Vetëm Ads</SelectItem>
                  </SelectContent>
                </Select>
                <FieldError field="smm_organicOrAds" />
              </div>
              <div>
                <Label className="text-sm font-medium">Keni përmbajtje foto/video?</Label>
                <Select value={form.smm_hasContent} onValueChange={v => set('smm_hasContent', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                    <SelectItem value="Pjesërisht">Pjesërisht</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Frekuenca e postimeve</Label>
                <Select value={form.smm_postingFrequency} onValueChange={v => set('smm_postingFrequency', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="8 posts/month">8 postime/muaj</SelectItem>
                    <SelectItem value="12 posts/month">12 postime/muaj</SelectItem>
                    <SelectItem value="16 posts/month">16 postime/muaj</SelectItem>
                    <SelectItem value="ta rekomandojë agjensia">Ta rekomandojë agjensia</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Toni i komunikimit</Label>
                <Select value={form.smm_toneOfCommunication} onValueChange={v => set('smm_toneOfCommunication', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Profesional">Profesional</SelectItem>
                    <SelectItem value="Miqësor">Miqësor</SelectItem>
                    <SelectItem value="Premium">Premium</SelectItem>
                    <SelectItem value="Direkt në shitje">Direkt në shitje</SelectItem>
                    <SelectItem value="Tjetër">Tjetër</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>
        )}

        {/* ─── Web Design ─── */}
        {showWeb && (
          <Card className="p-4 space-y-4 border-blue-200 bg-blue-50/30 dark:bg-blue-950/10 dark:border-blue-800/40">
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-blue-600" />
              <h3 className="font-semibold text-sm">Web Design</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Keni website ekzistues? *</Label>
                <Select value={form.web_hasExistingWebsite} onValueChange={v => set('web_hasExistingWebsite', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                  </SelectContent>
                </Select>
                <FieldError field="web_hasExistingWebsite" />
              </div>
              {form.web_hasExistingWebsite === 'Po' && (
                <div>
                  <Label className="text-sm font-medium">Linku i website-it</Label>
                  <Input value={form.web_existingWebsiteLink} onChange={e => set('web_existingWebsiteLink', e.target.value)} placeholder="https://..." className="mt-1" />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Qëllimi kryesor i website-it *</Label>
                <Select value={form.web_mainPurpose} onValueChange={v => set('web_mainPurpose', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Prezencë profesionale">Prezencë profesionale</SelectItem>
                    <SelectItem value="Lead generation">Lead generation</SelectItem>
                    <SelectItem value="Booking">Booking</SelectItem>
                    <SelectItem value="E-commerce">E-commerce</SelectItem>
                    <SelectItem value="Blog / Portal">Blog / Portal</SelectItem>
                    <SelectItem value="Tjetër">Tjetër</SelectItem>
                  </SelectContent>
                </Select>
                <FieldError field="web_mainPurpose" />
              </div>
              <div>
                <Label className="text-sm font-medium">Numri i faqeve</Label>
                <Select value={form.web_estimatedPages} onValueChange={v => set('web_estimatedPages', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1–3">1–3</SelectItem>
                    <SelectItem value="4–6">4–6</SelectItem>
                    <SelectItem value="7–10">7–10</SelectItem>
                    <SelectItem value="10+">10+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Funksionalitete të nevojshme</Label>
              <MultiSelectChips
                options={[
                  { value: 'Formular kontakti', label: 'Formular kontakti' },
                  { value: 'Chat live', label: 'Chat live' },
                  { value: 'Blog', label: 'Blog' },
                  { value: 'Galeri', label: 'Galeri' },
                  { value: 'Sistem Booking', label: 'Sistem Booking' },
                  { value: 'Dyqan online', label: 'Dyqan online' },
                ]}
                selected={form.web_features}
                onChange={v => set('web_features', v)}
                columns={3}
              />
            </div>

            <div>
              <Label className="text-sm font-medium">Keni tekste dhe foto gati?</Label>
              <Select value={form.web_hasTextsAndPhotos} onValueChange={v => set('web_hasTextsAndPhotos', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Po">Po</SelectItem>
                  <SelectItem value="Jo">Jo</SelectItem>
                  <SelectItem value="Pjesërisht">Pjesërisht</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm font-medium">Website-e që ju pëlqejnë (shembuj)</Label>
              <Textarea value={form.web_websitesYouLike} onChange={e => set('web_websitesYouLike', e.target.value)} placeholder="Vendosni linke ose emra website-esh që ju pëlqen stili..." className="mt-1 min-h-[70px]" />
            </div>
          </Card>
        )}

        {/* ─── Paid Ads ─── */}
        {showAds && (
          <Card className="p-4 space-y-4 border-orange-200 bg-orange-50/30 dark:bg-orange-950/10 dark:border-orange-800/40">
            <div className="flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-orange-600" />
              <h3 className="font-semibold text-sm">Paid Ads</h3>
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Platformat e reklamave *</Label>
              <MultiSelectChips
                options={[
                  { value: 'Google Ads', label: 'Google Ads' },
                  { value: 'Facebook Ads', label: 'Facebook Ads' },
                  { value: 'Instagram Ads', label: 'Instagram Ads' },
                  { value: 'TikTok Ads', label: 'TikTok Ads' },
                ]}
                selected={form.ads_platforms}
                onChange={v => set('ads_platforms', v)}
                columns={4}
              />
              <FieldError field="ads_platforms" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Veprimi kryesor i konvertimit *</Label>
                <Select value={form.ads_mainConversionAction} onValueChange={v => set('ads_mainConversionAction', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Telefonatë">Telefonatë</SelectItem>
                    <SelectItem value="Formular">Formular</SelectItem>
                    <SelectItem value="Mesazh">Mesazh</SelectItem>
                    <SelectItem value="Blerje">Blerje</SelectItem>
                    <SelectItem value="Booking">Booking</SelectItem>
                  </SelectContent>
                </Select>
                <FieldError field="ads_mainConversionAction" />
              </div>
              <div>
                <Label className="text-sm font-medium">Buxheti mujor për reklama *</Label>
                <Select value={form.ads_monthlyBudget} onValueChange={v => set('ads_monthlyBudget', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Nën €300">Nën €300</SelectItem>
                    <SelectItem value="€300–€500">€300–€500</SelectItem>
                    <SelectItem value="€500–€1000">€500–€1000</SelectItem>
                    <SelectItem value="€1000+">€1000+</SelectItem>
                  </SelectContent>
                </Select>
                <FieldError field="ads_monthlyBudget" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Keni bërë reklama më parë?</Label>
                <Select value={form.ads_hasRunAdsBefore} onValueChange={v => set('ads_hasRunAdsBefore', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Keni landing page?</Label>
                <Select value={form.ads_hasLandingPage} onValueChange={v => set('ads_hasLandingPage', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                    <SelectItem value="Duhet ndërtuar">Duhet ndërtuar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.ads_hasRunAdsBefore === 'Po' && (
              <div>
                <Label className="text-sm font-medium">Rezultatet e kaluara</Label>
                <Textarea value={form.ads_pastResults} onChange={e => set('ads_pastResults', e.target.value)} placeholder="Përshkruani eksperiencat e mëparshme me reklama..." className="mt-1 min-h-[70px]" />
              </div>
            )}
          </Card>
        )}

        {/* ─── Branding ─── */}
        {showBranding && (
          <Card className="p-4 space-y-4 border-pink-200 bg-pink-50/30 dark:bg-pink-950/10 dark:border-pink-800/40">
            <div className="flex items-center gap-2">
              <Palette className="w-5 h-5 text-pink-600" />
              <h3 className="font-semibold text-sm">Branding</h3>
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Çfarë ju nevojitet? *</Label>
              <MultiSelectChips
                options={[
                  { value: 'Logo', label: 'Logo' },
                  { value: 'Identitet vizual', label: 'Identitet vizual' },
                  { value: 'Brand Guidelines', label: 'Brand Guidelines' },
                  { value: 'Rifreskim brandi', label: 'Rifreskim brandi' },
                  { value: 'Naming / Emërtim', label: 'Naming / Emërtim' },
                  { value: 'Materiale printimi', label: 'Materiale printimi' },
                ]}
                selected={form.brand_whatYouNeed}
                onChange={v => set('brand_whatYouNeed', v)}
                columns={3}
              />
              <FieldError field="brand_whatYouNeed" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Keni logo ekzistuese? *</Label>
                <Select value={form.brand_hasExistingLogo} onValueChange={v => set('brand_hasExistingLogo', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                  </SelectContent>
                </Select>
                <FieldError field="brand_hasExistingLogo" />
              </div>
              <div>
                <Label className="text-sm font-medium">Stili i preferuar</Label>
                <Select value={form.brand_preferredStyle} onValueChange={v => set('brand_preferredStyle', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Minimal">Minimal</SelectItem>
                    <SelectItem value="Modern">Modern</SelectItem>
                    <SelectItem value="Luksoz">Luksoz</SelectItem>
                    <SelectItem value="Lojtar / Bold">Lojtar / Bold</SelectItem>
                    <SelectItem value="Klasik">Klasik</SelectItem>
                    <SelectItem value="Tjetër">Tjetër</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium">Vlerat kryesore të markës</Label>
              <Textarea value={form.brand_coreValues} onChange={e => set('brand_coreValues', e.target.value)} placeholder="p.sh. Profesionalizëm, Inovacion, Besueshmëri..." className="mt-1 min-h-[60px]" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Audienca e synuar</Label>
                <Input value={form.brand_targetAudience} onChange={e => set('brand_targetAudience', e.target.value)} placeholder="p.sh. Biznese lokale, 25-45 vjeç" className="mt-1" />
              </div>
              <div>
                <Label className="text-sm font-medium">Konkurrentë kryesorë</Label>
                <Input value={form.brand_competitors} onChange={e => set('brand_competitors', e.target.value)} placeholder="p.sh. Brand A, Brand B" className="mt-1" />
              </div>
            </div>
          </Card>
        )}

        {/* ─── Content Creation ─── */}
        {showContent && (
          <Card className="p-4 space-y-4 border-green-200 bg-green-50/30 dark:bg-green-950/10 dark:border-green-800/40">
            <div className="flex items-center gap-2">
              <PenTool className="w-5 h-5 text-green-600" />
              <h3 className="font-semibold text-sm">Content Creation</h3>
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Lloji i përmbajtjes *</Label>
              <MultiSelectChips
                options={[
                  { value: 'Foto produkti', label: 'Foto produkti' },
                  { value: 'Foto biznesi', label: 'Foto biznesi' },
                  { value: 'Video promo', label: 'Video promo' },
                  { value: 'Reels / TikTok', label: 'Reels / TikTok' },
                  { value: 'Copywriting', label: 'Copywriting' },
                  { value: 'Grafika dizajn', label: 'Grafika dizajn' },
                ]}
                selected={form.content_types}
                onChange={v => set('content_types', v)}
                columns={3}
              />
              <FieldError field="content_types" />
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Platformat ku do përdoret</Label>
              <MultiSelectChips
                options={[
                  { value: 'Instagram', label: 'Instagram' },
                  { value: 'Facebook', label: 'Facebook' },
                  { value: 'TikTok', label: 'TikTok' },
                  { value: 'Website', label: 'Website' },
                  { value: 'Print', label: 'Print' },
                ]}
                selected={form.content_platforms}
                onChange={v => set('content_platforms', v)}
                columns={3}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Frekuenca e prodhimit</Label>
                <Select value={form.content_frequency} onValueChange={v => set('content_frequency', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Një herë (projekt)">Një herë (projekt)</SelectItem>
                    <SelectItem value="Mujore">Mujore</SelectItem>
                    <SelectItem value="Javore">Javore</SelectItem>
                    <SelectItem value="Sipas nevojës">Sipas nevojës</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Keni staf/modele për foto/video?</Label>
                <Select value={form.content_hasModels} onValueChange={v => set('content_hasModels', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                    <SelectItem value="Duhet organizuar">Duhet organizuar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium">Stili vizual i preferuar</Label>
              <Select value={form.content_visualStyle} onValueChange={v => set('content_visualStyle', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Minimal & Clean">Minimal & Clean</SelectItem>
                  <SelectItem value="Bold & Colorful">Bold & Colorful</SelectItem>
                  <SelectItem value="Premium / Luksoz">Premium / Luksoz</SelectItem>
                  <SelectItem value="Natyral / Autentik">Natyral / Autentik</SelectItem>
                  <SelectItem value="Corporate">Corporate</SelectItem>
                  <SelectItem value="Tjetër">Tjetër</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Card>
        )}

        {/* ─── SEO ─── */}
        {showSEO && (
          <Card className="p-4 space-y-4 border-teal-200 bg-teal-50/30 dark:bg-teal-950/10 dark:border-teal-800/40">
            <div className="flex items-center gap-2">
              <Search className="w-5 h-5 text-teal-600" />
              <h3 className="font-semibold text-sm">SEO</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Keni website? *</Label>
                <Select value={form.seo_hasWebsite} onValueChange={v => set('seo_hasWebsite', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                  </SelectContent>
                </Select>
                <FieldError field="seo_hasWebsite" />
              </div>
              {form.seo_hasWebsite === 'Po' && (
                <div>
                  <Label className="text-sm font-medium">Platforma e website-it</Label>
                  <Select value={form.seo_websitePlatform} onValueChange={v => set('seo_websitePlatform', v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="WordPress">WordPress</SelectItem>
                      <SelectItem value="Shopify">Shopify</SelectItem>
                      <SelectItem value="Wix">Wix</SelectItem>
                      <SelectItem value="Custom">Custom</SelectItem>
                      <SelectItem value="Nuk e di">Nuk e di</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div>
              <Label className="text-sm font-medium">Fjalë kyçe target</Label>
              <Textarea value={form.seo_targetKeywords} onChange={e => set('seo_targetKeywords', e.target.value)} placeholder="p.sh. restorant tiranë, hotel sarandë, dentist..." className="mt-1 min-h-[60px]" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Tregu gjeografik *</Label>
                <Select value={form.seo_targetMarket} onValueChange={v => set('seo_targetMarket', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Lokal (qytet)">Lokal (qytet)</SelectItem>
                    <SelectItem value="Kombëtar">Kombëtar</SelectItem>
                    <SelectItem value="Rajonal">Rajonal (Ballkan)</SelectItem>
                    <SelectItem value="Ndërkombëtar">Ndërkombëtar</SelectItem>
                  </SelectContent>
                </Select>
                <FieldError field="seo_targetMarket" />
              </div>
              <div>
                <Label className="text-sm font-medium">Keni bërë SEO më parë?</Label>
                <Select value={form.seo_hasDoneSEO} onValueChange={v => set('seo_hasDoneSEO', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                    <SelectItem value="Nuk e di">Nuk e di</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium">Konkurrentë kryesorë</Label>
              <Input value={form.seo_competitors} onChange={e => set('seo_competitors', e.target.value)} placeholder="Website-e ose emra biznesesh konkurrentë..." className="mt-1" />
            </div>
          </Card>
        )}
      </div>
    );
  };

  // ---------- Step 4: Budget & Materials ----------

  const renderStep4BudgetMaterials = () => (
    <div className="space-y-5">
      <div>
        <Label className="text-sm font-medium">Buxheti i parashikuar *</Label>
        <Select value={form.budgetRange} onValueChange={v => set('budgetRange', v)}>
          <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh buxhetin" /></SelectTrigger>
          <SelectContent>
            {BUDGETS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
        <FieldError field="budgetRange" />
      </div>

      <div>
        <Label className="text-sm font-medium">Afati kohor *</Label>
        <Select value={form.timeline} onValueChange={v => set('timeline', v)}>
          <SelectTrigger className="mt-1"><SelectValue placeholder="Kur dëshironi të filloni?" /></SelectTrigger>
          <SelectContent>
            {TIMELINES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <FieldError field="timeline" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-medium">Është urgjente?</Label>
          <Select value={form.isUrgent} onValueChange={v => set('isUrgent', v)}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Po">Po</SelectItem>
              <SelectItem value="Jo">Jo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-sm font-medium">Vendimmarrësi *</Label>
          <Select value={form.decisionMaker} onValueChange={v => set('decisionMaker', v)}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Kush vendos?" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Po, jam unë">Po, jam unë</SelectItem>
              <SelectItem value="Jo, ka edhe persona të tjerë">Jo, ka edhe persona të tjerë</SelectItem>
            </SelectContent>
          </Select>
          <FieldError field="decisionMaker" />
        </div>
      </div>

      <div>
        <Label className="text-sm font-medium">Mënyra e preferuar e kontaktit</Label>
        <Select value={form.preferredContactMethod} onValueChange={v => set('preferredContactMethod', v)}>
          <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Telefonatë">Telefonatë</SelectItem>
            <SelectItem value="Email">Email</SelectItem>
            <SelectItem value="WhatsApp">WhatsApp</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Materials section */}
      <div className="pt-4 border-t space-y-4">
        <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground">
          A keni materiale ekzistuese për projektin? (foto, video, logo, dokumente)
        </div>

        <div>
          <Label className="text-sm font-medium">Keni materiale ekzistuese?</Label>
          <Select value={form.hasExistingMaterials} onValueChange={v => set('hasExistingMaterials', v)}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Po">Po</SelectItem>
              <SelectItem value="Jo">Jo</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {form.hasExistingMaterials === 'Po' && (
          <>
            <div>
              <Label className="text-sm font-medium">Google Drive Link</Label>
              <Input value={form.googleDriveLink} onChange={e => set('googleDriveLink', e.target.value)} placeholder="https://drive.google.com/..." className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">
                Sigurohuni që linku të jetë i aksesueshëm. Vendoseni në &quot;Anyone with the link can view&quot;.
              </p>
            </div>

            <div>
              <Label className="text-sm font-medium">Google Drive Link i dytë (opsional)</Label>
              <Input value={form.secondGoogleDriveLink} onChange={e => set('secondGoogleDriveLink', e.target.value)} placeholder="https://drive.google.com/..." className="mt-1" />
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Çfarë përfshin dosja?</Label>
              <MultiSelectChips
                options={FOLDER_ITEMS.map(f => ({ value: f, label: f }))}
                selected={form.folderIncludes}
                onChange={v => set('folderIncludes', v)}
                columns={4}
              />
            </div>
          </>
        )}

        <div>
          <Label className="text-sm font-medium">Keni udhëzues brandi (Brand Guidelines)?</Label>
          <Select value={form.hasBrandGuidelines} onValueChange={v => set('hasBrandGuidelines', v)}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Po">Po</SelectItem>
              <SelectItem value="Jo">Jo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );

  // Render the correct step based on actual step number
  const renderCurrentStep = () => {
    const actual = actualStep(step);
    switch (actual) {
      case 1: return renderStep1();
      case 2: return renderStep2();
      case 3: return renderStep3ServiceSpecific();
      case 4: return renderStep4BudgetMaterials();
      default: return null;
    }
  };

  const currentStepTitle = visibleSteps[step - 1]?.title || '';

  // ---------- Main Render ----------

  return (
    <div className="space-y-6">
      {/* Header text */}
      <div className="bg-muted/30 rounded-lg p-4 border">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Ky formular na ndihmon të kuptojmë më mirë biznesin tuaj, objektivat dhe materialet që keni aktualisht. 
          Sa më të plota të jenë përgjigjet, aq më e saktë do të jetë zgjidhja dhe propozimi ynë.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {visibleSteps.map((s, i) => {
          const StepIcon = s.icon;
          const isActive = step === i + 1;
          const isCompleted = step > i + 1;
          return (
            <React.Fragment key={s.id}>
              {i > 0 && <div className={`h-px flex-1 min-w-[16px] ${isCompleted ? 'bg-primary' : 'bg-border'}`} />}
              <button
                type="button"
                onClick={() => { if (isCompleted) setStep(i + 1); }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : isCompleted
                    ? 'bg-primary/10 text-primary cursor-pointer hover:bg-primary/20'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {isCompleted ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <StepIcon className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">{s.title}</span>
                <span className="sm:hidden">{i + 1}</span>
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Step title */}
      <div>
        <h3 className="text-lg font-semibold">{currentStepTitle}</h3>
      </div>

      {/* Step content */}
      <div className="min-h-[300px]">
        {renderCurrentStep()}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t">
        <Button
          type="button"
          variant="outline"
          onClick={prev}
          disabled={step === 1}
          className="gap-1"
        >
          <ChevronLeft className="w-4 h-4" />
          Para
        </Button>

        {step < totalSteps ? (
          <Button type="button" onClick={next} className="gap-1">
            Vazhdo
            <ChevronRight className="w-4 h-4" />
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="gap-1 bg-success hover:bg-success/90 text-white"
          >
            {submitting ? 'Duke dërguar...' : 'Dërgo Formularin'}
            <Send className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
};

export default ServiceQuestionnaireForm;
