/* ═══════════════════════════════════════════════════════════════════════
   Marketing Agency Price Calculator — Type Definitions
   ═══════════════════════════════════════════════════════════════════════ */

export type Market = 'albania' | 'international';
export type Currency = 'ALL' | 'EUR' | 'USD';
export type DesignQuality = 'standard' | 'premium';
export type AdsPricingMode = 'fixed' | 'percentage';

export type WebsiteType = 'landing' | 'business' | 'ecommerce' | 'custom';
export type AdBudgetRange = '0-300' | '300-1000' | '1000-3000' | '3000+';

/* ─── Selections (what the user picks in the calculator) ─── */

export interface SocialMediaSelection {
  enabled: boolean;
  platforms: number;
  postsPerMonth: number;
  reelsPerMonth: number;
  storySetsPerMonth: number;
  captionWriting: boolean;
  communityManagement: boolean;
  monthlyReport: boolean;
  contentCalendar: boolean;
  designQuality: DesignQuality;
}

export interface PaidAdsSelection {
  enabled: boolean;
  platforms: string[];          // e.g. ['facebook', 'google', 'tiktok', 'linkedin']
  campaigns: number;
  adSets: number;
  creatives: number;
  monthlyOptimization: boolean;
  trackingSetup: boolean;
  conversionTracking: boolean;
  landingPageReview: boolean;
  monthlyReporting: boolean;
  adBudgetRange: AdBudgetRange;
  pricingMode: AdsPricingMode;
  adSpendAmount: number;        // actual ad spend for percentage calculation
}

export interface WebDesignSelection {
  enabled: boolean;
  websiteType: WebsiteType;
  pages: number;
  extraPages: number;
  copywriting: boolean;
  basicSeo: boolean;
  blogSetup: boolean;
  contactForm: boolean;
  bookingSystem: boolean;
  multiLanguage: boolean;
  speedOptimization: boolean;
  cmsPanel: boolean;
  ecommerceFeatures: boolean;
  productsCount: number;
  paymentGateway: boolean;
  hostingSupport: boolean;
  maintenanceMonthly: boolean;
}

export interface SeoSelection {
  enabled: boolean;
  seoAudit: boolean;
  onPageSeo: boolean;
  technicalSeo: boolean;
  localSeo: boolean;
  keywordResearch: boolean;
  blogArticlesPerMonth: number;
  backlinkOutreach: boolean;
  monthlyReporting: boolean;
  targetPages: number;
}

export interface BrandingSelection {
  enabled: boolean;
  logoDesign: boolean;
  brandGuidelines: boolean;
  socialMediaTemplates: boolean;
  printMaterials: boolean;
  presentationDesign: boolean;
  extraDesignRequestsPerMonth: number;
}

export interface ContentProductionSelection {
  enabled: boolean;
  photoShoot: boolean;
  videoShoot: boolean;
  reelProduction: boolean;
  scriptWriting: boolean;
  editingOnly: boolean;
  onSiteHours: number;
  travelFee: boolean;
  equipmentFee: boolean;
  deliverables: number;
}

export interface AddOnsSelection {
  rushDelivery: boolean;
  extraRevisions: number;
  dedicatedAccountManager: boolean;
  competitorAnalysis: boolean;
  advancedReporting: boolean;
  strategySession: boolean;
  monthlyConsultingHours: number;
}

export interface CalculatorSelections {
  market: Market;
  currency: Currency;
  socialMedia: SocialMediaSelection;
  paidAds: PaidAdsSelection;
  webDesign: WebDesignSelection;
  seo: SeoSelection;
  branding: BrandingSelection;
  contentProduction: ContentProductionSelection;
  addOns: AddOnsSelection;
  discountPercent: number;
  discountFixed: number;
}

/* ─── Pricing config (what admin sets) ─── */

export interface SocialMediaPricing {
  baseMonthlyFee: number;
  pricePerPost: number;
  pricePerReel: number;
  pricePerStorySet: number;
  pricePerExtraPlatform: number;
  captionWritingFee: number;
  communityManagementFee: number;
  monthlyReportFee: number;
  contentCalendarFee: number;
  premiumDesignUpcharge: number;
}

export interface PaidAdsPricing {
  setupFee: number;
  monthlyManagementFee: number;
  minimumMonthlyFee: number;
  percentageOfAdSpend: number;
  pricePerCampaign: number;
  pricePerAdSet: number;
  pricePerCreative: number;
  trackingSetupFee: number;
  conversionTrackingFee: number;
  landingPageReviewFee: number;
  monthlyReportingFee: number;
}

export interface WebDesignPricing {
  landingPageBase: number;
  businessWebsiteBase: number;
  ecommerceWebsiteBase: number;
  customWebsiteBase: number;
  pricePerExtraPage: number;
  copywritingFee: number;
  basicSeoFee: number;
  blogSetupFee: number;
  contactFormFee: number;
  bookingSystemFee: number;
  multiLanguageFee: number;
  speedOptimizationFee: number;
  cmsPanelFee: number;
  ecommerceFeaturesFee: number;
  pricePerProduct: number;
  paymentGatewayFee: number;
  hostingSupportFee: number;
  maintenanceMonthlyFee: number;
}

export interface SeoPricing {
  setupFee: number;
  monthlyBaseFee: number;
  seoAuditFee: number;
  onPageSeoFee: number;
  technicalSeoFee: number;
  localSeoFee: number;
  keywordResearchFee: number;
  pricePerArticle: number;
  backlinkOutreachFee: number;
  monthlyReportingFee: number;
  pricePerTargetPage: number;
}

export interface BrandingPricing {
  logoDesignFee: number;
  brandGuidelinesFee: number;
  socialMediaTemplatesFee: number;
  printMaterialsFee: number;
  presentationDesignFee: number;
  pricePerExtraDesignRequest: number;
}

export interface ContentProductionPricing {
  photoShootFee: number;
  videoShootFee: number;
  reelProductionFee: number;
  scriptWritingFee: number;
  editingOnlyFee: number;
  pricePerOnSiteHour: number;
  travelFee: number;
  equipmentFee: number;
  pricePerDeliverable: number;
}

export interface AddOnsPricing {
  rushDeliveryFee: number;
  pricePerExtraRevision: number;
  dedicatedAccountManagerFee: number;
  competitorAnalysisFee: number;
  advancedReportingFee: number;
  strategySessionFee: number;
  pricePerConsultingHour: number;
}

export interface BundleDiscount {
  id: string;
  name: string;
  services: string[];   // e.g. ['socialMedia', 'paidAds']
  discountPercent: number;
  enabled: boolean;
}

export interface MarketPricing {
  socialMedia: SocialMediaPricing;
  paidAds: PaidAdsPricing;
  webDesign: WebDesignPricing;
  seo: SeoPricing;
  branding: BrandingPricing;
  contentProduction: ContentProductionPricing;
  addOns: AddOnsPricing;
}

export interface ExchangeRates {
  ALL_to_EUR: number;
  ALL_to_USD: number;
  EUR_to_ALL: number;
  EUR_to_USD: number;
  USD_to_ALL: number;
  USD_to_EUR: number;
}

export interface CalculatorSettings {
  pricing: Record<Market, MarketPricing>;
  exchangeRates: ExchangeRates;
  bundleDiscounts: BundleDiscount[];
  bundleDiscountsEnabled: boolean;
  showInternalCosts: boolean;
  internalCostMultiplier: number;  // e.g. 0.5 = internal cost is 50% of selling price
  minimumPriceFloorPercent: number; // e.g. 70 = min acceptable price is 70% of listed
}

/* ─── Calculation results ─── */

export interface LineItem {
  label: string;
  quantity?: number;
  unitPrice?: number;
  amount: number;
  type: 'one-time' | 'monthly';
  category: string;
}

export interface CategoryTotal {
  category: string;
  oneTime: number;
  monthly: number;
  items: LineItem[];
}

export interface CalculationResult {
  categories: CategoryTotal[];
  subtotalOneTime: number;
  subtotalMonthly: number;
  bundleDiscountAmount: number;
  bundleDiscountLabel: string;
  manualDiscountAmount: number;
  totalOneTime: number;
  totalMonthly: number;
  grandTotal: number;                // oneTime + (monthly * 1) for first month
  suggestedLabel: string;
  internalCostOneTime?: number;
  internalCostMonthly?: number;
  profitMarginPercent?: number;
  minimumAcceptablePrice?: number;
  enabledServicesCount: number;
}
