import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useCollection, getGlobalTeamId } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { phoneKeyDown } from '../lib/utils';
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
  ShoppingCart, Heart, Save, Clock, Trash2, Upload, Package, Sparkles, Loader2,
  Image as ImageIcon, X, Briefcase, MapPin, Mail, Wrench, ClipboardCheck,
} from 'lucide-react';
import { useToast } from '../hooks/use-toast';
import { useFileUpload } from '../hooks/useFileUpload';
import { getInquiryCompleteness } from '../lib/inquiryBrief';

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
  businessDescription: string;
  instagramLink: string;
  facebookLink: string;
  tiktokLink: string;
  linkedinLink: string;
  // Logo + business's own services catalog
  logoUrl: string;
  logoName: string;
  businessServices: { title: string; description: string }[];
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
  // E-commerce
  ecom_platform: string;
  ecom_productsCount: string;
  ecom_hasInventory: string;
  ecom_paymentMethods: string[];
  ecom_shippingNeeds: string;
  ecom_hasProductPhotos: string;
  ecom_productCategories: string;
  ecom_existingShopLink: string;
  ecom_features: string[];
  ecom_products: { name: string; category: string; price: string }[];
  // Coaching
  coach_niche: string;
  coach_targetAudience: string;
  coach_deliveryMethod: string[];
  coach_hasProgram: string;
  coach_programDescription: string;
  coach_needsBooking: string;
  coach_needsPayment: string;
  coach_contentNeeds: string[];
  coach_socialPresence: string;
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
  materialFiles: { url: string; name: string }[];
  // Currency + separate ad spend
  currency: 'EUR' | 'ALL';
  adBudget: string;
  // SEO extra
  seo_hasGoogleBusiness: string;
  seo_wantsBacklinks: string;
  seo_wantsBlog: string;
  seo_analyticsAccess: string;
  // SMM extra
  smm_reelsPerMonth: string;
  smm_shootDays: string;
  smm_communityManagement: string;
  // Web Design extra
  web_languages: string[];
  web_needsCopywriting: string;
  web_hasDomainHosting: string;
  // Paid Ads extra
  ads_hasTracking: string;
  ads_wantsRemarketing: string;
  ads_targetMarket: string;
  // Content extra
  content_scope: string;
  content_location: string;
  content_needsDrone: string;
  content_quantity: string;
  // Google Maps / Google Business Profile
  gmb_hasProfile: string;
  gmb_locations: string;
  gmb_needs: string[];
  // Website Maintenance
  maint_hasWebsite: string;
  maint_platform: string;
  maint_needs: string[];
  maint_supportLevel: string;
  // Email / WhatsApp Marketing
  email_channels: string[];
  email_hasList: string;
  email_listSize: string;
  email_frequency: string;
  email_goalNote: string;
}

const initialFormData: FormData = {
  businessName: '', contactName: '', email: '', phoneNumber: '',
  jobTitle: '', industry: '', cityMarket: '', website: '', businessDescription: '',
  instagramLink: '', facebookLink: '', tiktokLink: '', linkedinLink: '',
  logoUrl: '', logoName: '', businessServices: [],
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
  ecom_platform: '', ecom_productsCount: '', ecom_hasInventory: '',
  ecom_paymentMethods: [], ecom_shippingNeeds: '', ecom_hasProductPhotos: '',
  ecom_productCategories: '', ecom_existingShopLink: '', ecom_features: [],
  ecom_products: [],
  coach_niche: '', coach_targetAudience: '', coach_deliveryMethod: [],
  coach_hasProgram: '', coach_programDescription: '', coach_needsBooking: '',
  coach_needsPayment: '', coach_contentNeeds: [], coach_socialPresence: '',
  budgetRange: '', timeline: '', isUrgent: '', decisionMaker: '',
  preferredContactMethod: '',
  hasExistingMaterials: '', googleDriveLink: '', secondGoogleDriveLink: '',
  folderIncludes: [], hasBrandGuidelines: '',
  materialFiles: [],
  currency: 'EUR', adBudget: '',
  seo_hasGoogleBusiness: '', seo_wantsBacklinks: '', seo_wantsBlog: '', seo_analyticsAccess: '',
  smm_reelsPerMonth: '', smm_shootDays: '', smm_communityManagement: '',
  web_languages: [], web_needsCopywriting: '', web_hasDomainHosting: '',
  ads_hasTracking: '', ads_wantsRemarketing: '', ads_targetMarket: '',
  content_scope: '', content_location: '', content_needsDrone: '', content_quantity: '',
  gmb_hasProfile: '', gmb_locations: '', gmb_needs: [],
  maint_hasWebsite: '', maint_platform: '', maint_needs: [], maint_supportLevel: '',
  email_channels: [], email_hasList: '', email_listSize: '', email_frequency: '', email_goalNote: '',
};

// --------------- Constants ---------------

const INDUSTRIES = [
  'Restorant', 'Hotel', 'Klinikë', 'Retail', 'Real Estate', 'Edukim',
  'Coaching / Trajnime', 'Transport / NCC', 'Tjetër',
];

const SERVICES = [
  { value: 'Social Media Marketing', label: 'Social Media Marketing', icon: Share2 },
  { value: 'Web Design', label: 'Web Design', icon: Globe },
  { value: 'SEO', label: 'SEO', icon: Search },
  { value: 'Paid Ads', label: 'Paid Ads', icon: Megaphone },
  { value: 'Google Maps', label: 'Google Maps', icon: MapPin },
  { value: 'E-commerce', label: 'E-commerce', icon: ShoppingCart },
  { value: 'Branding', label: 'Branding', icon: Palette },
  { value: 'Content Creation', label: 'Content Creation', icon: PenTool },
  { value: 'Email/WhatsApp Marketing', label: 'Email / WhatsApp', icon: Mail },
  { value: 'Website Maintenance', label: 'Mirëmbajtje Website', icon: Wrench },
  { value: 'Tjetër', label: 'Tjetër', icon: FileText },
];

const SERVICE_GOALS: Record<string, string[]> = {
  'Web Design': ['Website i ri', 'Ridizajnim website-i', 'Landing Page', 'E-commerce', 'Booking Platform'],
  'Social Media Marketing': ['Rritje ndjekësish', 'Brand awareness', 'Më shumë engagement', 'Shitje nga social media'],
  'Paid Ads': ['Më shumë shitje online', 'Më shumë lead-e', 'Trafik në website', 'Instalime aplikacioni'],
  'Branding': ['Logo e re', 'Identitet vizual komplet', 'Rifreskim brandi', 'Brand Guidelines'],
  'Content Creation': ['Foto profesionale', 'Video marketing', 'Reels & TikTok', 'Copywriting'],
  'SEO': ['Pozicionim në Google', 'SEO lokal', 'Më shumë trafik organik', 'Analizë konkurrentësh'],
  'E-commerce': ['Dyqan online i ri', 'Migrim platforme', 'Rritje shitjesh online', 'Integrim pagesash', 'Menaxhim inventari'],
  'Google Maps': ['Profil i ri në Google Maps', 'Optimizim i profilit', 'Më shumë vlerësime (reviews)', 'Renditje më e lartë lokale'],
  'Email/WhatsApp Marketing': ['Fushata promocionale', 'Automatizime (welcome, follow-up)', 'Mbajtja e klientëve ekzistues', 'Rritje shitjesh nga lista'],
  'Website Maintenance': ['Përditësime & siguri', 'Backup & monitorim', 'Optimizim shpejtësie', 'Mbështetje teknike e vazhdueshme'],
};

const SERVICE_DESCRIPTION_HINTS: Record<string, string> = {
  'Web Design': 'Përshkruani llojin e website-it që dëshironi, funksionalitetet, dhe stilin vizual...',
  'Social Media Marketing': 'Përshkruani çfarë dëshironi të arrini me rrjetet sociale, audiencën tuaj...',
  'Paid Ads': 'Përshkruani produktet/shërbimet që dëshironi të reklamoni dhe audiencën target...',
  'Branding': 'Përshkruani vizionin tuaj për markën, vlerat, dhe stilin që dëshironi...',
  'Content Creation': 'Përshkruani llojin e përmbajtjes që ju nevojitet dhe ku do ta përdorni...',
  'SEO': 'Përshkruani website-in tuaj, fjalët kyçe target, dhe çfarë dëshironi të arrini...',
  'E-commerce': 'Përshkruani produktet që shisni, audiencën target, dhe çfarë funksionalitetesh dëshironi...',
  'Google Maps': 'Na tregoni ku ndodheni, zonën që mbuloni dhe nëse keni profil ekzistues në Google...',
  'Email/WhatsApp Marketing': 'Na tregoni për listën e kontakteve, çfarë doni të komunikoni dhe sa shpesh...',
  'Website Maintenance': 'Na tregoni për website-in tuaj dhe çfarë mbështetjeje ju nevojitet...',
};

const SERVICES_WITH_QUESTIONS = ['Social Media Marketing', 'Web Design', 'Paid Ads', 'Branding', 'Content Creation', 'SEO', 'E-commerce', 'Google Maps', 'Email/WhatsApp Marketing', 'Website Maintenance'];

// Shërbime me çmim njëherësh (projekt); të tjerat janë mujore (retainer).
const ONE_TIME_SERVICES = ['Web Design', 'E-commerce'];

// Buxheti — sipas monedhës dhe modelit të faturimit (mujor vs njëherësh).
const BUDGETS_MONTHLY_EUR = ['Nën €500', '€500–1.000', '€1.000–2.000', '€2.000–3.000', 'Mbi €3.000'];
const BUDGETS_ONETIME_EUR = ['Nën €800', '€800–1.500', '€1.500–2.500', '€2.500–5.000', 'Mbi €5.000'];
const BUDGETS_MONTHLY_ALL = ['Nën 50.000 L', '50.000–100.000 L', '100.000–200.000 L', '200.000–400.000 L', 'Mbi 400.000 L'];
const BUDGETS_ONETIME_ALL = ['Nën 80.000 L', '80.000–150.000 L', '150.000–300.000 L', '300.000–600.000 L', 'Mbi 600.000 L'];

// Buxheti i reklamave — i ndarë nga tarifa e menaxhimit.
const AD_BUDGETS_EUR = ['€100–300 / muaj', '€300–1.000 / muaj', '€1.000–3.000 / muaj', 'Mbi €3.000 / muaj', 'Do ta vendosim bashkë'];
const AD_BUDGETS_ALL = ['10.000–30.000 L / muaj', '30.000–100.000 L / muaj', '100.000–300.000 L / muaj', 'Mbi 300.000 L / muaj', 'Do ta vendosim bashkë'];

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
            aria-pressed={isActive}
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

// --------------- Validation & formatting helpers ---------------

/** Prepend https:// when a non-empty URL has no scheme. */
const normalizeUrl = (v: string): string => {
  const t = (v || '').trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
};

/** Empty is valid (fields are optional); otherwise require a parseable URL with a TLD. */
const isValidUrl = (v: string): boolean => {
  const t = (v || '').trim();
  if (!t) return true;
  try { new URL(normalizeUrl(t)); return /\.[a-z]{2,}/i.test(t); } catch { return false; }
};

/** Loose international phone check: 6–15 digits ignoring spaces/+/-/(). */
const isValidPhone = (v: string): boolean => {
  const digits = (v || '').replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 15;
};

// --------------- Inline field helpers (module-level to avoid remounts) ---------------

const FieldError: React.FC<{ field: string; errors: Record<string, string> }> = ({ field, errors }) =>
  errors[field] ? (
    <p id={`err-${field}`} className="text-xs text-red-500 mt-1 flex items-center gap-1">
      <AlertCircle className="w-3 h-3" />{errors[field]}
    </p>
  ) : null;

const AiButton: React.FC<{
  field: 'businessDescription' | 'projectNeedDescription';
  aiField: null | 'businessDescription' | 'projectNeedDescription';
  onGenerate: (field: 'businessDescription' | 'projectNeedDescription') => void;
}> = ({ field, aiField, onGenerate }) => (
  <button
    type="button"
    onClick={() => onGenerate(field)}
    disabled={aiField !== null}
    className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-60 transition"
  >
    {aiField === field ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
    {aiField === field ? 'Duke shkruar…' : 'Ndihmë me AI'}
  </button>
);

// --------------- Steps ---------------

const STEPS = [
  { id: 1, title: 'Informacion Bazë', icon: Building },
  { id: 2, title: 'Shërbimi & Objektivi', icon: Target },
  { id: 3, title: 'Pyetje Specifike', icon: FileText },
  { id: 4, title: 'Buxheti & Materialet', icon: DollarSign },
  { id: 5, title: 'Rishiko & Dërgo', icon: ClipboardCheck },
];

// --------------- Component ---------------

interface Props {
  onSubmit: (data: FormData) => Promise<void>;
  preselectedService?: string;
  prefillEmail?: string;
  prefillName?: string;
  initialDraft?: Partial<FormData> & { id?: string; lastSavedStep?: number };
  onDraftSave?: (data: FormData, step: number) => void;
  isEditing?: boolean;
}

const ServiceQuestionnaireForm: React.FC<Props> = ({ onSubmit, preselectedService, prefillEmail, prefillName, initialDraft, onDraftSave, isEditing }) => {
  // Per-inquiry draft key so two different inquiries (or services) in the same
  // browser don't overwrite each other's autosaved draft.
  const draftKey = 'fivocrm_inquiry_draft'
    + (initialDraft?.id ? `_${initialDraft.id}` : (preselectedService ? `_${preselectedService}` : ''));
  const [step, setStep] = useState(() => initialDraft?.lastSavedStep || 1);
  const [form, setForm] = useState<FormData>(() => {
    // Priority: initialDraft prop > localStorage draft > fresh form
    if (initialDraft) {
      return { ...initialFormData, ...initialDraft };
    }
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...initialFormData, ...parsed.form };
      }
    } catch { /* ignore */ }
    return {
      ...initialFormData,
      servicesInterestedIn: preselectedService ? [preselectedService] : [],
      email: prefillEmail || '',
      contactName: prefillName || '',
    };
  });
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stepContentRef = useRef<HTMLDivElement>(null);
  const didMountRef = useRef(false);
  const [showDraftBanner, setShowDraftBanner] = useState(() => {
    if (initialDraft) return false;
    try {
      return !!localStorage.getItem(draftKey);
    } catch { return false; }
  });

  // Restore step from localStorage draft if no initialDraft
  useEffect(() => {
    if (!initialDraft) {
      try {
        const saved = localStorage.getItem(draftKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.step) setStep(parsed.step);
        }
      } catch { /* ignore */ }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save to localStorage on every form/step change (debounced 1s)
  const saveDraft = useCallback(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ form, step, savedAt: new Date().toISOString() }));
      setDraftSavedAt(new Date().toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' }));
    } catch { /* ignore */ }
    if (onDraftSave) {
      onDraftSave(form, step);
    }
  }, [form, step, onDraftSave]);

  useEffect(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(saveDraft, 1000);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [saveDraft]);

  // Clear draft on successful submit
  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
  }, []);

  // On step change (not initial mount), move focus to the step heading so
  // keyboard/screen-reader users are oriented to the new content.
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return; }
    headingRef.current?.focus();
    stepContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [step]);

  // Custom industries
  const { data: customIndustries } = useCollection<any>('customIndustries', {
    orderBy: { field: 'name', direction: 'asc' },
    skipTeamFilter: true,
  });
  const [showAddIndustry, setShowAddIndustry] = useState(false);
  const [newIndustryName, setNewIndustryName] = useState('');

  // Resolve teamId for portal users who don't have getGlobalTeamId()
  const { user } = useAuth();
  const { data: allTeamMembers } = useCollection<any>('teamMembers', { skipTeamFilter: true });
  const resolvedTeamId = useMemo(() => {
    const global = getGlobalTeamId();
    if (global) return global;
    if (!allTeamMembers?.length) return null;
    // Portal users are NOT in teamMembers — grab any team's ID
    return allTeamMembers.find((m: any) => m.teamId)?.teamId || null;
  }, [allTeamMembers]);

  const allIndustries = useMemo(() => {
    const customNames = (customIndustries || []).map((ci: any) => ci.name);
    return [...INDUSTRIES, ...customNames.filter((n: string) => !INDUSTRIES.includes(n))];
  }, [customIndustries]);

  const handleAddIndustry = async () => {
    const name = newIndustryName.trim();
    if (!name || allIndustries.some(i => i.toLowerCase() === name.toLowerCase())) return;
    await addDoc(collection(db, 'customIndustries'), {
      name,
      ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdByUserId: user?.uid || null,
    });
    set('industry', name);
    setNewIndustryName('');
    setShowAddIndustry(false);
  };

  const set = (field: keyof FormData, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  };

  // ---------- AI assist: help the client draft the long free-text fields ----------
  const { toast } = useToast();
  const [aiField, setAiField] = useState<null | 'businessDescription' | 'projectNeedDescription'>(null);

  // ---------- File uploads: logo + fotot/materialet ----------
  const { upload } = useFileUpload();
  const [logoUploading, setLogoUploading] = useState(false);
  const [materialsUploading, setMaterialsUploading] = useState(false);

  const handleLogoUpload = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Na duhet një imazh', description: 'Logon ngarkojeni si imazh (PNG, JPG ose SVG).', variant: 'destructive' });
      return;
    }
    setLogoUploading(true);
    try {
      const res = await upload(file, 'inquiry-logos');
      setForm(prev => ({ ...prev, logoUrl: res.url, logoName: res.name || file.name }));
    } catch (err: any) {
      toast({ title: 'Ngarkimi nuk u krye', description: err?.message || 'Provojeni edhe një herë, ju lutem.', variant: 'destructive' });
    } finally {
      setLogoUploading(false);
    }
  };

  const handleMaterialsUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setMaterialsUploading(true);
    try {
      const uploaded: { url: string; name: string }[] = [];
      for (const file of Array.from(files)) {
        const res = await upload(file, 'inquiry-materials');
        uploaded.push({ url: res.url, name: res.name || file.name });
      }
      setForm(prev => ({ ...prev, materialFiles: [...prev.materialFiles, ...uploaded] }));
    } catch (err: any) {
      toast({ title: 'Ngarkimi nuk u krye', description: err?.message || 'Provojeni edhe një herë, ju lutem.', variant: 'destructive' });
    } finally {
      setMaterialsUploading(false);
    }
  };

  const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\n{3,}/g, '\n\n').trim();

  const generateWithAI = async (field: 'businessDescription' | 'projectNeedDescription') => {
    if (aiField) return;
    setAiField(field);
    try {
      const token = await (user as any)?.getIdToken?.();
      if (!token) throw new Error('no-auth');

      const ctx = [
        form.businessName && `Biznesi: ${form.businessName}`,
        form.industry && `Industria: ${form.industry}`,
        form.cityMarket && `Qyteti/Tregu: ${form.cityMarket}`,
        form.website && `Website: ${form.website}`,
      ].filter(Boolean).join('\n');

      const prompt = field === 'businessDescription'
        ? `Je duke ndihmuar një klient të plotësojë një anketë shërbimi. Shkruaj një përshkrim/historik të shkurtër dhe profesional të biznesit në SHQIP (3–5 fjali, tekst i thjeshtë, PA HTML dhe PA tituj).\n\nTë dhënat:\n${ctx || '(pak të dhëna)'}\n${form.businessDescription ? `\nShënime nga klienti (përmirësoji): ${form.businessDescription}` : ''}\n\nKthe VETËM tekstin e përshkrimit, pa hyrje si "Ja përshkrimi".`
        : `Je duke ndihmuar një klient të plotësojë një anketë shërbimi. Shkruaj një përshkrim të qartë të nevojës së projektit në SHQIP (3–6 fjali, tekst i thjeshtë, PA HTML).\n\nTë dhënat:\n${ctx}\nShërbimet e kërkuara: ${form.servicesInterestedIn.join(', ') || '—'}\nObjektivi: ${form.mainGoal || '—'}\n${form.businessDescription ? `Për biznesin: ${form.businessDescription}` : ''}\n${form.projectNeedDescription ? `\nShënime nga klienti (përmirësoji): ${form.projectNeedDescription}` : ''}\n\nKthe VETËM tekstin, pa hyrje.`;

      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], teamId: resolvedTeamId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.reply) {
        set(field, stripHtml(String(data.reply)));
      } else {
        toast({ title: 'AI nuk u përgjigj', description: data?.error || 'Provoni përsëri pas pak.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Gabim', description: 'Ndihma me AI dështoi. Provoni përsëri.', variant: 'destructive' });
    } finally {
      setAiField(null);
    }
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

  // Buxheti sipas monedhës + modelit (mujor vs njëherësh) + a duhet ad spend.
  const budgetContext = useMemo(() => {
    const svcs = form.servicesInterestedIn;
    const isOneTime = svcs.length > 0
      && svcs.every(s => ONE_TIME_SERVICES.includes(s) || s === 'Tjetër')
      && svcs.some(s => ONE_TIME_SERVICES.includes(s));
    const budgetOptions = form.currency === 'EUR'
      ? (isOneTime ? BUDGETS_ONETIME_EUR : BUDGETS_MONTHLY_EUR)
      : (isOneTime ? BUDGETS_ONETIME_ALL : BUDGETS_MONTHLY_ALL);
    const adBudgetOptions = form.currency === 'EUR' ? AD_BUDGETS_EUR : AD_BUDGETS_ALL;
    const showAdBudget = svcs.includes('Paid Ads') || ['Organik + Ads', 'Vetëm Ads'].includes(form.smm_organicOrAds);
    return { isOneTime, budgetOptions, adBudgetOptions, showAdBudget, billingLabel: isOneTime ? 'njëherësh' : 'në muaj' };
  }, [form.servicesInterestedIn, form.currency, form.smm_organicOrAds]);

  // Clear budget / ad-spend selections once they no longer match the current
  // currency + billing model (e.g. user switched EUR→ALL or monthly→one-time),
  // so a stale value from the old option set is never submitted.
  React.useEffect(() => {
    if (form.budgetRange && !budgetContext.budgetOptions.includes(form.budgetRange)) {
      set('budgetRange', '');
    }
    if (form.adBudget && !budgetContext.adBudgetOptions.includes(form.adBudget)) {
      set('adBudget', '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetContext.budgetOptions, budgetContext.adBudgetOptions]);

  // Determine if step 3 (service-specific) should show
  const hasServiceSpecific = form.servicesInterestedIn.some(s =>
    SERVICES_WITH_QUESTIONS.includes(s)
  );
  // 5 steps total (incl. "Rishiko & Dërgo"); step 3 is skipped when there are
  // no service-specific questions, leaving 4 visible steps.
  const totalSteps = hasServiceSpecific ? 5 : 4;

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
      else if (!isValidPhone(form.phoneNumber)) e.phoneNumber = 'Numër telefoni i pavlefshëm';
      if (!form.industry) e.industry = 'E detyrueshme';
      if (form.website.trim() && !isValidUrl(form.website)) e.website = 'Link i pavlefshëm (p.sh. https://faqja.com)';
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
      if (form.servicesInterestedIn.includes('E-commerce')) {
        if (!form.ecom_platform) e.ecom_platform = 'E detyrueshme';
        if (!form.ecom_productsCount) e.ecom_productsCount = 'E detyrueshme';
        if (form.ecom_paymentMethods.length === 0) e.ecom_paymentMethods = 'Zgjidhni të paktën një metodë';
      }
      if (form.servicesInterestedIn.includes('Coaching')) {
        if (!form.coach_niche.trim()) e.coach_niche = 'E detyrueshme';
        if (form.coach_deliveryMethod.length === 0) e.coach_deliveryMethod = 'Zgjidhni të paktën një metodë';
      }
      if (form.servicesInterestedIn.includes('Google Maps')) {
        if (form.gmb_needs.length === 0) e.gmb_needs = 'Zgjidhni të paktën një opsion';
      }
      if (form.servicesInterestedIn.includes('Email/WhatsApp Marketing')) {
        if (form.email_channels.length === 0) e.email_channels = 'Zgjidhni të paktën një kanal';
      }
      if (form.servicesInterestedIn.includes('Website Maintenance')) {
        if (form.maint_needs.length === 0) e.maint_needs = 'Zgjidhni të paktën një opsion';
      }
      if (form.web_existingWebsiteLink.trim() && !isValidUrl(form.web_existingWebsiteLink)) {
        e.web_existingWebsiteLink = 'Link i pavlefshëm';
      }
    } else if (actual === 4) {
      if (!form.budgetRange) e.budgetRange = 'E detyrueshme';
      if (!form.timeline) e.timeline = 'E detyrueshme';
      if (!form.decisionMaker) e.decisionMaker = 'E detyrueshme';
    }
    setErrors(e);
    return e;
  };

  // Move focus (and scroll) to the first field with an error, so keyboard and
  // screen-reader users land on what needs fixing.
  const focusFirstError = (e: Record<string, string>) => {
    const firstKey = Object.keys(e)[0];
    if (!firstKey) return;
    const el = typeof document !== 'undefined' ? document.getElementById(`field-${firstKey}`) : null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (el as HTMLElement).focus({ preventScroll: true });
    } else {
      stepContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const next = () => {
    const e = validateStep(step);
    if (Object.keys(e).length === 0) setStep(Math.min(step + 1, totalSteps));
    else focusFirstError(e);
  };
  const prev = () => setStep(Math.max(step - 1, 1));

  // Normalize URLs + email/phone right before persisting.
  const normalizeForm = (f: FormData): FormData => ({
    ...f,
    email: f.email.trim().toLowerCase(),
    phoneNumber: f.phoneNumber.trim(),
    website: normalizeUrl(f.website),
    web_existingWebsiteLink: normalizeUrl(f.web_existingWebsiteLink),
    googleDriveLink: normalizeUrl(f.googleDriveLink),
    secondGoogleDriveLink: normalizeUrl(f.secondGoogleDriveLink),
    instagramLink: normalizeUrl(f.instagramLink),
    facebookLink: normalizeUrl(f.facebookLink),
    tiktokLink: normalizeUrl(f.tiktokLink),
    linkedinLink: normalizeUrl(f.linkedinLink),
  });

  const handleSubmit = async () => {
    const e = validateStep(step);
    if (Object.keys(e).length) { focusFirstError(e); return; }
    setSubmitting(true);
    try {
      await onSubmit(normalizeForm(form));
      clearDraft();
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- Step 1: Basic Info ----------

  const renderStep1 = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-medium">Emri i Biznesit *</Label>
          <Input id="field-businessName" value={form.businessName} onChange={e => set('businessName', e.target.value)} placeholder="p.sh. Fivo Studio" className="mt-1" aria-invalid={!!errors.businessName} aria-describedby={errors.businessName ? 'err-businessName' : undefined} />
          <FieldError errors={errors} field="businessName" />
        </div>
        <div>
          <Label className="text-sm font-medium">Emri i Kontaktit *</Label>
          <Input id="field-contactName" value={form.contactName} onChange={e => set('contactName', e.target.value)} placeholder="p.sh. Andi Hoxha" className="mt-1" aria-invalid={!!errors.contactName} aria-describedby={errors.contactName ? 'err-contactName' : undefined} />
          <FieldError errors={errors} field="contactName" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-medium">Email *</Label>
          <Input id="field-email" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="email@example.com" className="mt-1" aria-invalid={!!errors.email} aria-describedby={errors.email ? 'err-email' : undefined} />
          <FieldError errors={errors} field="email" />
        </div>
        <div>
          <Label className="text-sm font-medium">Numri i Telefonit *</Label>
          <Input id="field-phoneNumber" type="tel" inputMode="numeric" maxLength={20} onKeyDown={phoneKeyDown} value={form.phoneNumber} onChange={e => set('phoneNumber', e.target.value)} placeholder="+355 69 xxx xxxx" className="mt-1" aria-invalid={!!errors.phoneNumber} aria-describedby={errors.phoneNumber ? 'err-phoneNumber' : undefined} />
          <FieldError errors={errors} field="phoneNumber" />
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
          <FieldError errors={errors} field="industry" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-medium">Qyteti / Tregu</Label>
          <Input value={form.cityMarket} onChange={e => set('cityMarket', e.target.value)} placeholder="p.sh. Tiranë" className="mt-1" />
        </div>
        <div>
          <Label className="text-sm font-medium">Website</Label>
          <Input id="field-website" value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://..." className="mt-1" aria-invalid={!!errors.website} aria-describedby={errors.website ? 'err-website' : undefined} />
          <FieldError errors={errors} field="website" />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <Label className="text-sm font-medium">Historiku / Përshkrimi i biznesit</Label>
          <AiButton aiField={aiField} onGenerate={generateWithAI} field="businessDescription" />
        </div>
        <Textarea
          value={form.businessDescription}
          onChange={e => set('businessDescription', e.target.value)}
          placeholder="Tregoni shkurt historikun e biznesit: kur nisi, çfarë ofron, klientët, çfarë e dallon..."
          className="min-h-[90px]"
        />
        <p className="text-xs text-muted-foreground mt-1">Kjo na ndihmon të njohim biznesin tuaj. Shkruajeni ju vetë ose lëreni AI-në t'ju ndihmojë.</p>
      </div>

      {/* Logo e biznesit */}
      <div className="pt-4 border-t">
        <Label className="text-sm font-medium flex items-center gap-1.5"><ImageIcon className="w-4 h-4 text-primary" /> Logo e biznesit</Label>
        <p className="text-xs text-muted-foreground mb-2 mt-0.5">Nëse e keni gati, ngarkojeni këtu — na ndihmon të kapim menjëherë stilin tuaj.</p>
        {form.logoUrl ? (
          <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/30">
            <img src={form.logoUrl} alt="Logo" className="h-14 w-14 rounded-md object-contain bg-white border" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{form.logoName || 'Logo e ngarkuar'}</p>
              <p className="text-xs text-green-600 flex items-center gap-1"><Check className="w-3 h-3" /> U ngarkua me sukses</p>
            </div>
            <button
              type="button"
              onClick={() => setForm(prev => ({ ...prev, logoUrl: '', logoName: '' }))}
              className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-destructive rounded transition-colors"
              aria-label="Hiq logon"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <label className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border hover:border-primary/40 hover:bg-muted/40 cursor-pointer py-6 transition-colors">
            <input type="file" accept="image/*" className="hidden" disabled={logoUploading} onChange={e => { handleLogoUpload(e.target.files?.[0]); e.target.value = ''; }} />
            {logoUploading ? (
              <><Loader2 className="w-4 h-4 animate-spin text-primary" /><span className="text-sm text-muted-foreground">Duke ngarkuar...</span></>
            ) : (
              <><Upload className="w-4 h-4 text-primary" /><span className="text-sm font-medium text-primary">Ngarko logon</span></>
            )}
          </label>
        )}
      </div>

      {/* Shërbimet / produktet e biznesit */}
      <div className="pt-4 border-t">
        <Label className="text-sm font-medium flex items-center gap-1.5"><Briefcase className="w-4 h-4 text-primary" /> Shërbimet tuaja</Label>
        <p className="text-xs text-muted-foreground mb-3 mt-0.5">
          Na tregoni shërbimet ose produktet kryesore që ofroni — një titull dhe një përshkrim i shkurtër për secilin. Kështu e dimë saktë çfarë po promovojmë për ju.
        </p>
        {form.businessServices.length > 0 && (
          <div className="space-y-3">
            {form.businessServices.map((svc, idx) => (
              <div key={idx} className="rounded-lg border p-3 space-y-2 bg-muted/20">
                <div className="flex items-center gap-2">
                  <Input
                    value={svc.title}
                    onChange={e => {
                      const updated = [...form.businessServices];
                      updated[idx] = { ...updated[idx], title: e.target.value };
                      set('businessServices', updated);
                    }}
                    placeholder="Titulli i shërbimit (p.sh. Transfer Aeroporti)"
                    className="h-9"
                  />
                  <button
                    type="button"
                    onClick={() => set('businessServices', form.businessServices.filter((_, i) => i !== idx))}
                    className="h-9 w-9 flex-shrink-0 flex items-center justify-center text-muted-foreground hover:text-destructive rounded transition-colors"
                    aria-label="Hiq shërbimin"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <Textarea
                  value={svc.description}
                  onChange={e => {
                    const updated = [...form.businessServices];
                    updated[idx] = { ...updated[idx], description: e.target.value };
                    set('businessServices', updated);
                  }}
                  placeholder="Përshkrim i shkurtër: çfarë përfshin, për kë është, çmimi nëse doni..."
                  className="min-h-[60px]"
                />
              </div>
            ))}
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs mt-3"
          onClick={() => set('businessServices', [...form.businessServices, { title: '', description: '' }])}
        >
          <PlusCircle className="w-3.5 h-3.5" />
          Shto shërbim
        </Button>
      </div>

      <div className="pt-4 border-t">
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
        <FieldError errors={errors} field="servicesInterestedIn" />
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
            <FieldError errors={errors} field="mainGoal" />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <Label className="text-sm font-medium">Përshkruani nevojën tuaj *</Label>
              <AiButton aiField={aiField} onGenerate={generateWithAI} field="projectNeedDescription" />
            </div>
            <Textarea
              value={form.projectNeedDescription}
              onChange={e => set('projectNeedDescription', e.target.value)}
              placeholder={descriptionPlaceholder}
              className="mt-1 min-h-[100px]"
            />
            <FieldError errors={errors} field="projectNeedDescription" />
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
    const showEcommerce = form.servicesInterestedIn.includes('E-commerce');
    const showCoaching = form.servicesInterestedIn.includes('Coaching');
    const showGmb = form.servicesInterestedIn.includes('Google Maps');
    const showMaint = form.servicesInterestedIn.includes('Website Maintenance');
    const showEmail = form.servicesInterestedIn.includes('Email/WhatsApp Marketing');

    return (
      <div className="space-y-6">
        <div className="bg-muted/30 rounded-lg p-3 text-sm text-muted-foreground">
          Disa pyetje të shpejta sipas shërbimeve që zgjodhët. Na ndihmojnë t'ju përgatisim një propozim vërtet për ju — jo një të gatshëm për të gjithë.
        </div>

        {/* ─── Social Media Marketing ─── */}
        {showSMM && (
          <Card className="p-4 space-y-4 border-primary/30 bg-accent-soft dark:bg-primary/10 dark:border-primary/30">
            <div className="flex items-center gap-2">
              <Share2 className="w-5 h-5 text-primary" />
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
                  { value: 'YouTube', label: 'YouTube' },
                ]}
                selected={form.smm_mainPlatforms}
                onChange={v => set('smm_mainPlatforms', v)}
                columns={3}
              />
              <FieldError errors={errors} field="smm_mainPlatforms" />
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
                <FieldError errors={errors} field="smm_organicOrAds" />
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
                    <SelectItem value="24 posts/month">24 postime/muaj</SelectItem>
                    <SelectItem value="32+ posts/month">32+ postime/muaj</SelectItem>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Reels / video në muaj</Label>
                <Select value={form.smm_reelsPerMonth} onValueChange={v => set('smm_reelsPerMonth', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pa reels">Pa reels</SelectItem>
                    <SelectItem value="4-8 reels">4–8 reels</SelectItem>
                    <SelectItem value="8-14 reels">8–14 reels</SelectItem>
                    <SelectItem value="14-20 reels">14–20 reels</SelectItem>
                    <SelectItem value="20+ reels">20+ reels</SelectItem>
                    <SelectItem value="ta rekomandojë agjensia">Ta rekomandojë agjensia</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Ditë xhirimi te ju në muaj?</Label>
                <Select value={form.smm_shootDays} onValueChange={v => set('smm_shootDays', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pa xhirim">Jo, kam përmbajtjen vetë</SelectItem>
                    <SelectItem value="1 ditë/muaj">1 ditë/muaj</SelectItem>
                    <SelectItem value="2 ditë/muaj">2 ditë/muaj</SelectItem>
                    <SelectItem value="3+ ditë/muaj">3+ ditë/muaj</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium">Menaxhim i komenteve & mesazheve (community management)?</Label>
              <Select value={form.smm_communityManagement} onValueChange={v => set('smm_communityManagement', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Po, plotësisht">Po — përgjigje te komentet dhe DM-të</SelectItem>
                  <SelectItem value="Vetëm monitorim">Vetëm monitorim (na njoftoni)</SelectItem>
                  <SelectItem value="Jo">Jo, e menaxhoj vetë</SelectItem>
                </SelectContent>
              </Select>
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
                <FieldError errors={errors} field="web_hasExistingWebsite" />
              </div>
              {form.web_hasExistingWebsite === 'Po' && (
                <div>
                  <Label className="text-sm font-medium">Linku i website-it</Label>
                  <Input value={form.web_existingWebsiteLink} onChange={e => set('web_existingWebsiteLink', e.target.value)} placeholder="https://..." className="mt-1" aria-invalid={!!errors.web_existingWebsiteLink} />
                  <FieldError errors={errors} field="web_existingWebsiteLink" />
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
                <FieldError errors={errors} field="web_mainPurpose" />
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
                  { value: 'Pagesa online', label: 'Pagesa online' },
                  { value: 'Google Reviews', label: 'Google Reviews' },
                  { value: 'Harta Google (Maps)', label: 'Harta Google (Maps)' },
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
              <Label className="text-sm font-medium mb-2 block">Në cilat gjuhë do jetë website-i?</Label>
              <MultiSelectChips
                options={[
                  { value: 'Shqip', label: 'Shqip' },
                  { value: 'Anglisht', label: 'Anglisht' },
                  { value: 'Italisht', label: 'Italisht' },
                  { value: 'Tjetër', label: 'Tjetër' },
                ]}
                selected={form.web_languages}
                onChange={v => set('web_languages', v)}
                columns={4}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Kush i shkruan tekstet?</Label>
                <Select value={form.web_needsCopywriting} onValueChange={v => set('web_needsCopywriting', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="I kam gati">I kam gati tekstet</SelectItem>
                    <SelectItem value="Doni t'i shkruani ju">Dua t'i shkruani ju</SelectItem>
                    <SelectItem value="Pjesërisht">Pjesërisht — kam disa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Keni domain & hosting?</Label>
                <Select value={form.web_hasDomainHosting} onValueChange={v => set('web_hasDomainHosting', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po, të dyja">Po, të dyja</SelectItem>
                    <SelectItem value="Vetëm domain">Vetëm domain</SelectItem>
                    <SelectItem value="Jo, na ndihmoni">Jo — na ndihmoni ju</SelectItem>
                    <SelectItem value="Nuk e di">Nuk e di</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
                  { value: 'YouTube Ads', label: 'YouTube Ads' },
                  { value: 'LinkedIn Ads', label: 'LinkedIn Ads' },
                ]}
                selected={form.ads_platforms}
                onChange={v => set('ads_platforms', v)}
                columns={3}
              />
              <FieldError errors={errors} field="ads_platforms" />
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
                <FieldError errors={errors} field="ads_mainConversionAction" />
              </div>
              <div>
                <Label className="text-sm font-medium">Tregu që doni të synoni</Label>
                <Select value={form.ads_targetMarket} onValueChange={v => set('ads_targetMarket', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Lokal (qytet/zonë)">Lokal (qytet/zonë)</SelectItem>
                    <SelectItem value="Kombëtar">Kombëtar</SelectItem>
                    <SelectItem value="Ndërkombëtar">Ndërkombëtar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-1">Buxhetin e reklamave (që shkon te platformat) e caktoni te hapi i fundit — është i ndarë nga tarifa e menaxhimit.</p>

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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Keni tracking të instaluar? (Pixel / conversion)</Label>
                <Select value={form.ads_hasTracking} onValueChange={v => set('ads_hasTracking', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po, është i instaluar</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                    <SelectItem value="Nuk e di">Nuk e di</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Doni remarketing / retargeting?</Label>
                <Select value={form.ads_wantsRemarketing} onValueChange={v => set('ads_wantsRemarketing', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                    <SelectItem value="Ma rekomandoni">Ma rekomandoni ju</SelectItem>
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
                  { value: 'Template social media', label: 'Template social media' },
                  { value: 'Prezantim / Pitch deck', label: 'Prezantim / Pitch deck' },
                ]}
                selected={form.brand_whatYouNeed}
                onChange={v => set('brand_whatYouNeed', v)}
                columns={3}
              />
              <FieldError errors={errors} field="brand_whatYouNeed" />
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
                <FieldError errors={errors} field="brand_hasExistingLogo" />
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
              <FieldError errors={errors} field="content_types" />
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Çfarë ju nevojitet?</Label>
                <Select value={form.content_scope} onValueChange={v => set('content_scope', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Prodhim i plotë">Prodhim i plotë (xhirim + editim)</SelectItem>
                    <SelectItem value="Vetëm editim">Vetëm editim (kam materialin)</SelectItem>
                    <SelectItem value="Vetëm xhirim">Vetëm xhirim</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Ku do bëhet xhirimi?</Label>
                <Select value={form.content_location} onValueChange={v => set('content_location', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Te biznesi im">Te biznesi im</SelectItem>
                    <SelectItem value="Në studio">Në studio</SelectItem>
                    <SelectItem value="Në terren / lokacion">Në terren / lokacion</SelectItem>
                    <SelectItem value="Mix">Mix</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Doni xhirim me dron (ajror)?</Label>
                <Select value={form.content_needsDrone} onValueChange={v => set('content_needsDrone', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                    <SelectItem value="Ndoshta">Ndoshta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Sa material ju nevojitet? (approx)</Label>
                <Input value={form.content_quantity} onChange={e => set('content_quantity', e.target.value)} placeholder="p.sh. 20 foto + 4 video" className="mt-1" />
              </div>
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
                <FieldError errors={errors} field="seo_hasWebsite" />
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
                <FieldError errors={errors} field="seo_targetMarket" />
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Keni profil në Google Maps / Business?</Label>
                <Select value={form.seo_hasGoogleBusiness} onValueChange={v => set('seo_hasGoogleBusiness', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po, i optimizuar">Po, i optimizuar</SelectItem>
                    <SelectItem value="Po, por i papërfunduar">Po, por i papërfunduar</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                    <SelectItem value="Nuk e di">Nuk e di</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Keni akses në Analytics / Search Console?</Label>
                <Select value={form.seo_analyticsAccess} onValueChange={v => set('seo_analyticsAccess', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                    <SelectItem value="Duhet konfiguruar">Duhet konfiguruar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Doni ndërtim linqesh (backlinks / autoritet)?</Label>
                <Select value={form.seo_wantsBacklinks} onValueChange={v => set('seo_wantsBacklinks', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                    <SelectItem value="Ma rekomandoni">Ma rekomandoni ju</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Doni artikuj blog / përmbajtje?</Label>
                <Select value={form.seo_wantsBlog} onValueChange={v => set('seo_wantsBlog', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po, rregullisht">Po, rregullisht</SelectItem>
                    <SelectItem value="Herë pas here">Herë pas here</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
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

        {/* ─── E-commerce ─── */}
        {showEcommerce && (
          <Card className="p-4 space-y-4 border-amber-200 bg-amber-50/30 dark:bg-amber-950/10 dark:border-amber-800/40">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-amber-600" />
              <h3 className="font-semibold text-sm">E-commerce</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Platforma e preferuar *</Label>
                <Select value={form.ecom_platform} onValueChange={v => set('ecom_platform', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Shopify">Shopify</SelectItem>
                    <SelectItem value="WooCommerce">WooCommerce</SelectItem>
                    <SelectItem value="Custom">Custom (i ndërtuar nga zero)</SelectItem>
                    <SelectItem value="Wix">Wix</SelectItem>
                    <SelectItem value="Nuk e di">Nuk e di, këshillomëni</SelectItem>
                  </SelectContent>
                </Select>
                <FieldError errors={errors} field="ecom_platform" />
              </div>
              <div>
                <Label className="text-sm font-medium">Sa produkte keni? *</Label>
                <Select value={form.ecom_productsCount} onValueChange={v => set('ecom_productsCount', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1-10">1–10</SelectItem>
                    <SelectItem value="11-50">11–50</SelectItem>
                    <SelectItem value="51-200">51–200</SelectItem>
                    <SelectItem value="200+">200+</SelectItem>
                  </SelectContent>
                </Select>
                <FieldError errors={errors} field="ecom_productsCount" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Keni nevojë për menaxhim inventari?</Label>
                <Select value={form.ecom_hasInventory} onValueChange={v => set('ecom_hasInventory', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                    <SelectItem value="Nuk e di">Nuk e di</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Nevojat e transportit</Label>
                <Select value={form.ecom_shippingNeeds} onValueChange={v => set('ecom_shippingNeeds', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Lokal">Vetëm lokal</SelectItem>
                    <SelectItem value="Kombëtar">Kombëtar</SelectItem>
                    <SelectItem value="Ndërkombëtar">Ndërkombëtar</SelectItem>
                    <SelectItem value="Dixhital">Produkte dixhitale (pa transport)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Metodat e pagesës *</Label>
              <MultiSelectChips
                options={[
                  { value: 'Kartë krediti', label: 'Kartë krediti' },
                  { value: 'PayPal', label: 'PayPal' },
                  { value: 'Transfertë bankare', label: 'Transfertë bankare' },
                  { value: 'Cash on delivery', label: 'Cash on delivery' },
                  { value: 'Stripe', label: 'Stripe' },
                ]}
                selected={form.ecom_paymentMethods}
                onChange={v => set('ecom_paymentMethods', v)}
                columns={3}
              />
              <FieldError errors={errors} field="ecom_paymentMethods" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Keni foto produktesh?</Label>
                <Select value={form.ecom_hasProductPhotos} onValueChange={v => set('ecom_hasProductPhotos', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po, profesionale">Po, profesionale</SelectItem>
                    <SelectItem value="Po, amatore">Po, por amatore</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Keni dyqan ekzistues online?</Label>
                <Input value={form.ecom_existingShopLink} onChange={e => set('ecom_existingShopLink', e.target.value)} placeholder="https://..." className="mt-1" />
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium">Kategoritë e produkteve</Label>
              <Textarea value={form.ecom_productCategories} onChange={e => set('ecom_productCategories', e.target.value)} placeholder="p.sh. Veshje, Aksesorë, Elektronikë..." className="mt-1 min-h-[60px]" />
            </div>

            {/* ── Product List ── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-amber-600" />
                  Lista e Produkteve
                </Label>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = ev => {
                        const text = ev.target?.result as string;
                        if (!text) return;
                        const lines = text.split(/\r?\n/).filter(l => l.trim());
                        const newProducts: { name: string; category: string; price: string }[] = [];
                        for (let i = 0; i < lines.length; i++) {
                          const cols = lines[i].split(/[,;\t]/).map(c => c.trim().replace(/^["']|["']$/g, ''));
                          // Skip header row if detected
                          if (i === 0 && /^(em[eë]r|name|produkt)/i.test(cols[0])) continue;
                          if (cols[0]) {
                            newProducts.push({
                              name: cols[0] || '',
                              category: cols[1] || '',
                              price: cols[2] || '',
                            });
                          }
                        }
                        if (newProducts.length > 0) {
                          set('ecom_products', [...form.ecom_products, ...newProducts]);
                        }
                      };
                      reader.readAsText(file);
                      e.target.value = '';
                    }}
                  />
                  <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-300 cursor-pointer font-medium">
                    <Upload className="w-3.5 h-3.5" />
                    Ngarko CSV
                  </span>
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Shtoni produktet një nga një ose ngarkoni skedar CSV (kolona: Emër, Kategori, Çmim)
              </p>

              {form.ecom_products.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="grid grid-cols-[1fr_1fr_100px_36px] gap-0 bg-muted/50 border-b px-3 py-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Emri</span>
                    <span className="text-[11px] font-medium text-muted-foreground">Kategoria</span>
                    <span className="text-[11px] font-medium text-muted-foreground">Çmimi</span>
                    <span />
                  </div>
                  <div className="max-h-[240px] overflow-y-auto">
                    {form.ecom_products.map((prod, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_1fr_100px_36px] gap-0 items-center px-3 py-1 border-b last:border-0 hover:bg-muted/20">
                        <Input
                          value={prod.name}
                          onChange={e => {
                            const updated = [...form.ecom_products];
                            updated[idx] = { ...updated[idx], name: e.target.value };
                            set('ecom_products', updated);
                          }}
                          className="h-7 text-xs border-0 bg-transparent shadow-none px-0 focus-visible:ring-0"
                          placeholder="Emri..."
                        />
                        <Input
                          value={prod.category}
                          onChange={e => {
                            const updated = [...form.ecom_products];
                            updated[idx] = { ...updated[idx], category: e.target.value };
                            set('ecom_products', updated);
                          }}
                          className="h-7 text-xs border-0 bg-transparent shadow-none px-0 focus-visible:ring-0"
                          placeholder="Kategoria..."
                        />
                        <Input
                          value={prod.price}
                          onChange={e => {
                            const updated = [...form.ecom_products];
                            updated[idx] = { ...updated[idx], price: e.target.value };
                            set('ecom_products', updated);
                          }}
                          className="h-7 text-xs border-0 bg-transparent shadow-none px-0 focus-visible:ring-0"
                          placeholder="Çmimi..."
                        />
                        <button
                          type="button"
                          onClick={() => set('ecom_products', form.ecom_products.filter((_, i) => i !== idx))}
                          className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-destructive rounded transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {form.ecom_products.length > 0 && (
                <p className="text-[11px] text-muted-foreground">{form.ecom_products.length} produkte të shtuara</p>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => set('ecom_products', [...form.ecom_products, { name: '', category: '', price: '' }])}
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Shto Produkt
              </Button>
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Funksionalitete të nevojshme</Label>
              <MultiSelectChips
                options={[
                  { value: 'Filtrim produktesh', label: 'Filtrim produktesh' },
                  { value: 'Wishlist', label: 'Wishlist' },
                  { value: 'Kupon / Zbritje', label: 'Kupon / Zbritje' },
                  { value: 'Vlerësime klientësh', label: 'Vlerësime klientësh' },
                  { value: 'Chat live', label: 'Chat live' },
                  { value: 'Multi-currency', label: 'Multi-currency' },
                  { value: 'Abonime / Subscription', label: 'Abonime / Subscription' },
                  { value: 'Integrim social media', label: 'Integrim social media' },
                  { value: 'Shumëgjuhësh', label: 'Shumëgjuhësh' },
                  { value: 'SEO për dyqanin', label: 'SEO për dyqanin' },
                ]}
                selected={form.ecom_features}
                onChange={v => set('ecom_features', v)}
                columns={2}
              />
            </div>
          </Card>
        )}

        {/* ─── Coaching ─── */}
        {showCoaching && (
          <Card className="p-4 space-y-4 border-rose-200 bg-rose-50/30 dark:bg-rose-950/10 dark:border-rose-800/40">
            <div className="flex items-center gap-2">
              <Heart className="w-5 h-5 text-rose-600" />
              <h3 className="font-semibold text-sm">Coaching</h3>
            </div>

            <div>
              <Label className="text-sm font-medium">Nisha / Fusha e coaching-ut *</Label>
              <Input value={form.coach_niche} onChange={e => set('coach_niche', e.target.value)} placeholder="p.sh. Life coaching, Business coaching, Fitness..." className="mt-1" />
              <FieldError errors={errors} field="coach_niche" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Audienca e synuar</Label>
                <Input value={form.coach_targetAudience} onChange={e => set('coach_targetAudience', e.target.value)} placeholder="p.sh. Profesionistë 25-40 vjeç" className="mt-1" />
              </div>
              <div>
                <Label className="text-sm font-medium">Prezencë aktuale në social media</Label>
                <Select value={form.coach_socialPresence} onValueChange={v => set('coach_socialPresence', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="E fortë">E fortë</SelectItem>
                    <SelectItem value="Mesatare">Mesatare</SelectItem>
                    <SelectItem value="Fillestare">Fillestare</SelectItem>
                    <SelectItem value="Asnjë">Asnjë</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Si e ofroni shërbimin? *</Label>
              <MultiSelectChips
                options={[
                  { value: '1-on-1 online', label: '1-on-1 Online' },
                  { value: '1-on-1 fizik', label: '1-on-1 Fizik' },
                  { value: 'Grup online', label: 'Grup Online' },
                  { value: 'Kurse te regjistruara', label: 'Kurse të regjistruara' },
                  { value: 'Workshop', label: 'Workshop' },
                  { value: 'Hibrid', label: 'Hibrid' },
                ]}
                selected={form.coach_deliveryMethod}
                onChange={v => set('coach_deliveryMethod', v)}
                columns={3}
              />
              <FieldError errors={errors} field="coach_deliveryMethod" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Keni program të strukturuar?</Label>
                <Select value={form.coach_hasProgram} onValueChange={v => set('coach_hasProgram', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po</SelectItem>
                    <SelectItem value="Jo, dua ta krijoj">Jo, dua ta krijoj</SelectItem>
                    <SelectItem value="Pjesërisht">Pjesërisht</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Keni nevojë për sistem booking?</Label>
                <Select value={form.coach_needsBooking} onValueChange={v => set('coach_needsBooking', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                    <SelectItem value="E kam">E kam tashmë</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.coach_hasProgram !== 'Jo, dua ta krijoj' && form.coach_hasProgram && (
              <div>
                <Label className="text-sm font-medium">Përshkruani programin tuaj</Label>
                <Textarea value={form.coach_programDescription} onChange={e => set('coach_programDescription', e.target.value)} placeholder="Përshkruani modulet, kohëzgjatjen, rezultatet e pritura..." className="mt-1 min-h-[70px]" />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Keni nevojë për sistem pagesash online?</Label>
                <Select value={form.coach_needsPayment} onValueChange={v => set('coach_needsPayment', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                    <SelectItem value="E kam">E kam tashmë</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Nevojat për përmbajtje</Label>
              <MultiSelectChips
                options={[
                  { value: 'Website personal', label: 'Website personal' },
                  { value: 'Landing page', label: 'Landing page' },
                  { value: 'Social media content', label: 'Social media content' },
                  { value: 'Email marketing', label: 'Email marketing' },
                  { value: 'Video promo', label: 'Video promo' },
                  { value: 'Lead magnet / Freebie', label: 'Lead magnet / Freebie' },
                ]}
                selected={form.coach_contentNeeds}
                onChange={v => set('coach_contentNeeds', v)}
                columns={2}
              />
            </div>
          </Card>
        )}

        {/* ─── Google Maps / Google Business Profile ─── */}
        {showGmb && (
          <Card className="p-4 space-y-4 border-red-200 bg-red-50/30 dark:bg-red-950/10 dark:border-red-800/40">
            <div className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-red-600" />
              <h3 className="font-semibold text-sm">Google Maps</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Keni profil ekzistues?</Label>
                <Select value={form.gmb_hasProfile} onValueChange={v => set('gmb_hasProfile', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po, i verifikuar">Po, i verifikuar</SelectItem>
                    <SelectItem value="Po, i paverifikuar">Po, por i paverifikuar</SelectItem>
                    <SelectItem value="Jo">Jo</SelectItem>
                    <SelectItem value="Nuk e di">Nuk e di</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Sa vendndodhje keni?</Label>
                <Select value={form.gmb_locations} onValueChange={v => set('gmb_locations', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1</SelectItem>
                    <SelectItem value="2-3">2–3</SelectItem>
                    <SelectItem value="4-10">4–10</SelectItem>
                    <SelectItem value="10+">10+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Çfarë ju nevojitet?</Label>
              <MultiSelectChips
                options={[
                  { value: 'Hapje profili', label: 'Hapje profili' },
                  { value: 'Optimizim i profilit', label: 'Optimizim i profilit' },
                  { value: 'Strategji vlerësimesh (reviews)', label: 'Strategji reviews' },
                  { value: 'Postime periodike', label: 'Postime periodike' },
                  { value: 'Foto profesionale', label: 'Foto profesionale' },
                  { value: 'Renditje "afër meje"', label: 'Renditje "afër meje"' },
                ]}
                selected={form.gmb_needs}
                onChange={v => set('gmb_needs', v)}
                columns={3}
              />
              <FieldError errors={errors} field="gmb_needs" />
            </div>
          </Card>
        )}

        {/* ─── Website Maintenance ─── */}
        {showMaint && (
          <Card className="p-4 space-y-4 border-slate-200 bg-slate-50/40 dark:bg-slate-900/20 dark:border-slate-700/40">
            <div className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-slate-600" />
              <h3 className="font-semibold text-sm">Mirëmbajtje Website</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Keni website për t'u mirëmbajtur?</Label>
                <Select value={form.maint_hasWebsite} onValueChange={v => set('maint_hasWebsite', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po</SelectItem>
                    <SelectItem value="Jo, do ndërtohet">Jo, do ndërtohet së pari</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Në cilën platformë?</Label>
                <Select value={form.maint_platform} onValueChange={v => set('maint_platform', v)}>
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
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Çfarë ju nevojitet?</Label>
              <MultiSelectChips
                options={[
                  { value: 'Përditësime & plugins', label: 'Përditësime & plugins' },
                  { value: 'Backup i rregullt', label: 'Backup i rregullt' },
                  { value: 'Siguri & patch-e', label: 'Siguri & patch-e' },
                  { value: 'Monitorim uptime', label: 'Monitorim uptime' },
                  { value: 'Optimizim shpejtësie', label: 'Optimizim shpejtësie' },
                  { value: 'Ndryshime të vogla', label: 'Ndryshime të vogla' },
                ]}
                selected={form.maint_needs}
                onChange={v => set('maint_needs', v)}
                columns={3}
              />
              <FieldError errors={errors} field="maint_needs" />
            </div>

            <div>
              <Label className="text-sm font-medium">Sa mbështetje ju duhet?</Label>
              <Select value={form.maint_supportLevel} onValueChange={v => set('maint_supportLevel', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Bazë">Bazë (pak orë/muaj)</SelectItem>
                  <SelectItem value="Standard">Standard</SelectItem>
                  <SelectItem value="E lartë / prioritare">E lartë / prioritare</SelectItem>
                  <SelectItem value="24/7 emergjencë">24/7 emergjencë</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Card>
        )}

        {/* ─── Email / WhatsApp Marketing ─── */}
        {showEmail && (
          <Card className="p-4 space-y-4 border-indigo-200 bg-indigo-50/30 dark:bg-indigo-950/10 dark:border-indigo-800/40">
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-indigo-600" />
              <h3 className="font-semibold text-sm">Email / WhatsApp Marketing</h3>
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Cilat kanale?</Label>
              <MultiSelectChips
                options={[
                  { value: 'Email', label: 'Email' },
                  { value: 'WhatsApp', label: 'WhatsApp' },
                  { value: 'SMS', label: 'SMS' },
                ]}
                selected={form.email_channels}
                onChange={v => set('email_channels', v)}
                columns={3}
              />
              <FieldError errors={errors} field="email_channels" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Keni listë kontaktesh?</Label>
                <Select value={form.email_hasList} onValueChange={v => set('email_hasList', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Po">Po</SelectItem>
                    <SelectItem value="Jo, duhet ndërtuar">Jo, duhet ndërtuar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Sa e madhe është lista?</Label>
                <Select value={form.email_listSize} onValueChange={v => set('email_listSize', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Nën 500">Nën 500</SelectItem>
                    <SelectItem value="500-2000">500–2.000</SelectItem>
                    <SelectItem value="2000-10000">2.000–10.000</SelectItem>
                    <SelectItem value="10000+">10.000+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Sa shpesh doni të dërgoni?</Label>
                <Select value={form.email_frequency} onValueChange={v => set('email_frequency', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Javore">Javore</SelectItem>
                    <SelectItem value="2 herë/muaj">2 herë/muaj</SelectItem>
                    <SelectItem value="Mujore">Mujore</SelectItem>
                    <SelectItem value="Sipas fushatave">Sipas fushatave</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Çfarë doni të arrini?</Label>
                <Input value={form.email_goalNote} onChange={e => set('email_goalNote', e.target.value)} placeholder="p.sh. oferta, njoftime, rikthim klientësh..." className="mt-1" />
              </div>
            </div>
          </Card>
        )}
      </div>
    );
  };

  // ---------- Step 4: Budget & Materials ----------

  // Live meter for the OPTIONAL business-profile extras (logo, foto, shërbimet e
  // biznesit, përshkrimi, website, rrjetet sociale) — NUK mat fushat e detyrueshme
  // të briefit. E njëjta llogaritje si te CRM (getInquiryCompleteness), prandaj
  // etiketa e bën të qartë se janë shtesa opsionale, jo progresi i briefit.
  const renderCompleteness = () => {
    const c = getInquiryCompleteness(form as any);
    return (
      <div className="rounded-lg border p-4 bg-muted/20 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Profili i biznesit (opsional)</span>
          <span className="text-sm font-semibold text-primary">{c.filled}/{c.total} · {c.percent}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${c.percent}%` }} />
        </div>
        {c.missing.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs text-muted-foreground">Opsionale, por na ndihmojnë — mund të shtoni:</span>
            {c.missing.map(m => (
              <span key={m.key} className="text-xs rounded-full border px-2 py-0.5 text-muted-foreground">{m.label}</span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-success flex items-center gap-1"><Check className="w-3 h-3" /> Profili i biznesit i plotësuar — faleminderit!</p>
        )}
      </div>
    );
  };

  const renderReview = () => {
    const row = (label: string, value: string) => (
      <div className="flex justify-between gap-3 py-1.5 border-b border-border/60 last:border-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm font-medium text-right break-words max-w-[60%]">{value || '—'}</span>
      </div>
    );
    return (
      <div className="space-y-5">
        {renderCompleteness()}
        <div className="rounded-lg border p-4">
          <h4 className="font-semibold text-sm mb-2">Përmbledhje</h4>
          {row('Biznesi', form.businessName)}
          {row('Kontakti', form.contactName)}
          {row('Email', form.email)}
          {row('Telefon', form.phoneNumber)}
          {row('Industria', form.industry)}
          {row('Shërbimet', form.servicesInterestedIn.join(', '))}
          {row('Objektivi', form.mainGoal)}
          {row('Buxheti', form.budgetRange)}
          {row('Afati', form.timeline)}
        </div>
        <p className="text-xs text-muted-foreground">
          Kontrolloni të dhënat më sipër dhe kthehuni pas nëse doni t'i ndryshoni. Kur të jeni gati, klikoni
          &nbsp;<strong>{isEditing ? 'Përditëso Kërkesën' : 'Dërgo Formularin'}</strong>.
        </p>
      </div>
    );
  };

  const renderStep4BudgetMaterials = () => (
    <div className="space-y-5">
      {renderCompleteness()}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <Label className="text-sm font-medium">Monedha</Label>
          <Select value={form.currency} onValueChange={v => set('currency', v)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="EUR">€ Euro</SelectItem>
              <SelectItem value="ALL">L Lekë</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label className="text-sm font-medium">
            Buxheti i parashikuar ({budgetContext.billingLabel}) *
          </Label>
          <Select value={form.budgetRange} onValueChange={v => set('budgetRange', v)}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh buxhetin" /></SelectTrigger>
            <SelectContent>
              {budgetContext.budgetOptions.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
          <FieldError errors={errors} field="budgetRange" />
        </div>
      </div>

      {budgetContext.showAdBudget && (
        <div>
          <Label className="text-sm font-medium">Buxheti mujor i reklamave (i ndarë nga menaxhimi)</Label>
          <Select value={form.adBudget} onValueChange={v => set('adBudget', v)}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh" /></SelectTrigger>
            <SelectContent>
              {budgetContext.adBudgetOptions.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">Kjo shumë shkon direkt te platformat (Meta/Google/TikTok) — nuk përfshihet te tarifa jonë.</p>
        </div>
      )}

      <div>
        <Label className="text-sm font-medium">Afati kohor *</Label>
        <Select value={form.timeline} onValueChange={v => set('timeline', v)}>
          <SelectTrigger className="mt-1"><SelectValue placeholder="Kur dëshironi të filloni?" /></SelectTrigger>
          <SelectContent>
            {TIMELINES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <FieldError errors={errors} field="timeline" />
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
          <FieldError errors={errors} field="decisionMaker" />
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
          Keni foto, dokumente apo materiale që na ndihmojnë? Ngarkojini këtu ose ndajini me një link — sa më shumë të kemi, aq më mirë punojmë për ju.
        </div>

        {/* Ngarko foto / materiale drejtpërdrejt */}
        <div>
          <Label className="text-sm font-medium flex items-center gap-1.5"><ImageIcon className="w-4 h-4 text-primary" /> Foto & materiale</Label>
          <p className="text-xs text-muted-foreground mb-2 mt-0.5">Foto, dizajne, dokumente — çfarëdo që keni gati. Mund të zgjidhni disa njëherësh.</p>
          {form.materialFiles.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
              {form.materialFiles.map((f, idx) => {
                const isImg = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f.name) || /\.(png|jpe?g|gif|webp|svg|bmp)/i.test(f.url);
                return (
                  <div key={idx} className="relative group rounded-lg border p-2 bg-muted/20 flex items-center gap-2">
                    {isImg ? (
                      <img src={f.url} alt={f.name} className="h-10 w-10 rounded object-cover bg-white border flex-shrink-0" />
                    ) : (
                      <div className="h-10 w-10 rounded bg-primary/10 flex items-center justify-center flex-shrink-0"><FileText className="w-4 h-4 text-primary" /></div>
                    )}
                    <span className="text-xs truncate flex-1">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => set('materialFiles', form.materialFiles.filter((_, i) => i !== idx))}
                      className="h-6 w-6 flex-shrink-0 flex items-center justify-center text-muted-foreground hover:text-destructive rounded transition-colors"
                      aria-label="Hiq skedarin"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <label className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border hover:border-primary/40 hover:bg-muted/40 cursor-pointer py-5 transition-colors">
            <input type="file" multiple accept="image/*,application/pdf" className="hidden" disabled={materialsUploading} onChange={e => { handleMaterialsUpload(e.target.files); e.target.value = ''; }} />
            {materialsUploading ? (
              <><Loader2 className="w-4 h-4 animate-spin text-primary" /><span className="text-sm text-muted-foreground">Duke ngarkuar...</span></>
            ) : (
              <><Upload className="w-4 h-4 text-primary" /><span className="text-sm font-medium text-primary">Ngarko foto / materiale</span></>
            )}
          </label>
        </div>

        <div>
          <Label className="text-sm font-medium">A keni edhe materiale në një dosje (Drive)?</Label>
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
      case 5: return renderReview();
      default: return null;
    }
  };

  const currentStepTitle = visibleSteps[step - 1]?.title || '';

  // ---------- Main Render ----------

  return (
    <div className="space-y-6">
      {/* Draft resume banner */}
      {showDraftBanner && !initialDraft && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-lg p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-600" />
            <span className="text-sm font-medium">Keni një draft të ruajtur. Dëshironi ta vazhdoni?</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => {
              localStorage.removeItem(draftKey);
              setForm({ ...initialFormData, servicesInterestedIn: preselectedService ? [preselectedService] : [], email: prefillEmail || '', contactName: prefillName || '' });
              setStep(1);
              setShowDraftBanner(false);
            }}>Fillo Rishtazi</Button>
            <Button size="sm" onClick={() => setShowDraftBanner(false)}>Vazhdo Draft-in</Button>
          </div>
        </div>
      )}

      {/* Header text */}
      <div className="bg-muted/30 rounded-lg p-4 border">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Le të njihemi pak më mirë 👋 Sa më shumë të na tregoni për biznesin tuaj — çfarë ofroni, ku doni të shkoni
          dhe çfarë keni tashmë në dorë — aq më e menduar do të jetë zgjidhja që përgatisim për ju. Mos u shqetësoni
          nëse s'i keni të gjitha gati: plotësoni ç'të mundeni tani, pjesën tjetër e shtoni kur t'ju vijë më mbarë.
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
                aria-current={isActive ? 'step' : undefined}
                aria-label={`Hapi ${i + 1}: ${s.title}`}
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
      <div ref={stepContentRef}>
        <h3 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">{currentStepTitle}</h3>
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

        <div className="flex items-center gap-3">
          {draftSavedAt && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Save className="w-3 h-3" />
              Ruajtur {draftSavedAt}
            </span>
          )}

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
              {submitting ? 'Duke dërguar...' : isEditing ? 'Përditëso Kërkesën' : 'Dërgo Formularin'}
              <Send className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ServiceQuestionnaireForm;
