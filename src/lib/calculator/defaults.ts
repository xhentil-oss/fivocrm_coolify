/* ═══════════════════════════════════════════════════════════════════════
   Marketing Agency Price Calculator — Default Pricing Data
   ═══════════════════════════════════════════════════════════════════════ */

import type {
  MarketPricing, ExchangeRates, BundleDiscount,
  CalculatorSettings, CalculatorSelections,
} from './types';

/* ─── Albania Pricing (in ALL) ─── */
const ALBANIA_PRICING: MarketPricing = {
  socialMedia: {
    baseMonthlyFee: 15_000,
    pricePerPost: 2_500,
    pricePerReel: 5_000,
    pricePerStorySet: 1_500,
    pricePerExtraPlatform: 8_000,
    captionWritingFee: 5_000,
    communityManagementFee: 10_000,
    monthlyReportFee: 5_000,
    contentCalendarFee: 5_000,
    premiumDesignUpcharge: 15_000,
  },
  paidAds: {
    setupFee: 15_000,
    monthlyManagementFee: 25_000,
    minimumMonthlyFee: 15_000,
    percentageOfAdSpend: 15,
    pricePerCampaign: 5_000,
    pricePerAdSet: 3_000,
    pricePerCreative: 2_500,
    trackingSetupFee: 10_000,
    conversionTrackingFee: 8_000,
    landingPageReviewFee: 5_000,
    monthlyReportingFee: 5_000,
  },
  webDesign: {
    landingPageBase: 80_000,
    businessWebsiteBase: 150_000,
    ecommerceWebsiteBase: 300_000,
    customWebsiteBase: 250_000,
    pricePerExtraPage: 10_000,
    copywritingFee: 20_000,
    basicSeoFee: 15_000,
    blogSetupFee: 10_000,
    contactFormFee: 5_000,
    bookingSystemFee: 25_000,
    multiLanguageFee: 30_000,
    speedOptimizationFee: 15_000,
    cmsPanelFee: 20_000,
    ecommerceFeaturesFee: 50_000,
    pricePerProduct: 200,
    paymentGatewayFee: 20_000,
    hostingSupportFee: 5_000,
    maintenanceMonthlyFee: 10_000,
  },
  seo: {
    setupFee: 20_000,
    monthlyBaseFee: 25_000,
    seoAuditFee: 15_000,
    onPageSeoFee: 15_000,
    technicalSeoFee: 20_000,
    localSeoFee: 10_000,
    keywordResearchFee: 10_000,
    pricePerArticle: 5_000,
    backlinkOutreachFee: 15_000,
    monthlyReportingFee: 5_000,
    pricePerTargetPage: 3_000,
  },
  branding: {
    logoDesignFee: 50_000,
    brandGuidelinesFee: 40_000,
    socialMediaTemplatesFee: 25_000,
    printMaterialsFee: 20_000,
    presentationDesignFee: 15_000,
    pricePerExtraDesignRequest: 5_000,
  },
  contentProduction: {
    photoShootFee: 20_000,
    videoShootFee: 30_000,
    reelProductionFee: 8_000,
    scriptWritingFee: 5_000,
    editingOnlyFee: 10_000,
    pricePerOnSiteHour: 5_000,
    travelFee: 3_000,
    equipmentFee: 5_000,
    pricePerDeliverable: 3_000,
  },
  addOns: {
    rushDeliveryFee: 10_000,
    pricePerExtraRevision: 3_000,
    dedicatedAccountManagerFee: 25_000,
    competitorAnalysisFee: 15_000,
    advancedReportingFee: 10_000,
    strategySessionFee: 15_000,
    pricePerConsultingHour: 8_000,
  },
};

/* ─── International Pricing (in EUR) ─── */
const INTERNATIONAL_PRICING: MarketPricing = {
  socialMedia: {
    baseMonthlyFee: 200,
    pricePerPost: 35,
    pricePerReel: 70,
    pricePerStorySet: 20,
    pricePerExtraPlatform: 100,
    captionWritingFee: 60,
    communityManagementFee: 150,
    monthlyReportFee: 60,
    contentCalendarFee: 60,
    premiumDesignUpcharge: 200,
  },
  paidAds: {
    setupFee: 200,
    monthlyManagementFee: 350,
    minimumMonthlyFee: 200,
    percentageOfAdSpend: 15,
    pricePerCampaign: 60,
    pricePerAdSet: 40,
    pricePerCreative: 35,
    trackingSetupFee: 120,
    conversionTrackingFee: 100,
    landingPageReviewFee: 80,
    monthlyReportingFee: 60,
  },
  webDesign: {
    landingPageBase: 800,
    businessWebsiteBase: 1_800,
    ecommerceWebsiteBase: 3_500,
    customWebsiteBase: 3_000,
    pricePerExtraPage: 120,
    copywritingFee: 250,
    basicSeoFee: 180,
    blogSetupFee: 120,
    contactFormFee: 60,
    bookingSystemFee: 300,
    multiLanguageFee: 400,
    speedOptimizationFee: 180,
    cmsPanelFee: 250,
    ecommerceFeaturesFee: 600,
    pricePerProduct: 2,
    paymentGatewayFee: 250,
    hostingSupportFee: 60,
    maintenanceMonthlyFee: 120,
  },
  seo: {
    setupFee: 250,
    monthlyBaseFee: 350,
    seoAuditFee: 200,
    onPageSeoFee: 180,
    technicalSeoFee: 250,
    localSeoFee: 120,
    keywordResearchFee: 120,
    pricePerArticle: 60,
    backlinkOutreachFee: 200,
    monthlyReportingFee: 60,
    pricePerTargetPage: 40,
  },
  branding: {
    logoDesignFee: 600,
    brandGuidelinesFee: 500,
    socialMediaTemplatesFee: 300,
    printMaterialsFee: 250,
    presentationDesignFee: 200,
    pricePerExtraDesignRequest: 60,
  },
  contentProduction: {
    photoShootFee: 250,
    videoShootFee: 400,
    reelProductionFee: 100,
    scriptWritingFee: 60,
    editingOnlyFee: 120,
    pricePerOnSiteHour: 60,
    travelFee: 40,
    equipmentFee: 60,
    pricePerDeliverable: 40,
  },
  addOns: {
    rushDeliveryFee: 120,
    pricePerExtraRevision: 40,
    dedicatedAccountManagerFee: 350,
    competitorAnalysisFee: 200,
    advancedReportingFee: 120,
    strategySessionFee: 200,
    pricePerConsultingHour: 100,
  },
};

/* ─── Exchange Rates ─── */
const DEFAULT_EXCHANGE_RATES: ExchangeRates = {
  ALL_to_EUR: 0.0093,
  ALL_to_USD: 0.0101,
  EUR_to_ALL: 107,
  EUR_to_USD: 1.08,
  USD_to_ALL: 99,
  USD_to_EUR: 0.92,
};

/* ─── Bundle Discounts ─── */
const DEFAULT_BUNDLE_DISCOUNTS: BundleDiscount[] = [
  { id: 'sm-ads', name: 'Social Media + Ads', services: ['socialMedia', 'paidAds'], discountPercent: 10, enabled: true },
  { id: 'web-seo', name: 'Website + SEO', services: ['webDesign', 'seo'], discountPercent: 10, enabled: true },
  { id: 'full-digital', name: 'Full Digital Package', services: ['socialMedia', 'paidAds', 'seo'], discountPercent: 15, enabled: true },
  { id: 'brand-content', name: 'Branding + Content', services: ['branding', 'contentProduction'], discountPercent: 8, enabled: true },
];

/* ─── Full Default Settings ─── */
export const DEFAULT_SETTINGS: CalculatorSettings = {
  pricing: {
    albania: ALBANIA_PRICING,
    international: INTERNATIONAL_PRICING,
  },
  exchangeRates: DEFAULT_EXCHANGE_RATES,
  bundleDiscounts: DEFAULT_BUNDLE_DISCOUNTS,
  bundleDiscountsEnabled: true,
  showInternalCosts: false,
  internalCostMultiplier: 0.5,
  minimumPriceFloorPercent: 70,
};

/* ─── Default Selections (empty calculator) ─── */
export const DEFAULT_SELECTIONS: CalculatorSelections = {
  market: 'albania',
  currency: 'ALL',
  socialMedia: {
    enabled: false,
    platforms: 2,
    postsPerMonth: 12,
    reelsPerMonth: 4,
    storySetsPerMonth: 4,
    captionWriting: true,
    communityManagement: false,
    monthlyReport: true,
    contentCalendar: true,
    designQuality: 'standard',
  },
  paidAds: {
    enabled: false,
    platforms: ['facebook'],
    campaigns: 2,
    adSets: 4,
    creatives: 4,
    monthlyOptimization: true,
    trackingSetup: true,
    conversionTracking: false,
    landingPageReview: false,
    monthlyReporting: true,
    adBudgetRange: '300-1000',
    pricingMode: 'fixed',
    adSpendAmount: 500,
  },
  webDesign: {
    enabled: false,
    websiteType: 'business',
    pages: 5,
    extraPages: 0,
    copywriting: false,
    basicSeo: true,
    blogSetup: false,
    contactForm: true,
    bookingSystem: false,
    multiLanguage: false,
    speedOptimization: false,
    cmsPanel: true,
    ecommerceFeatures: false,
    productsCount: 0,
    paymentGateway: false,
    hostingSupport: true,
    maintenanceMonthly: false,
  },
  seo: {
    enabled: false,
    seoAudit: true,
    onPageSeo: true,
    technicalSeo: false,
    localSeo: false,
    keywordResearch: true,
    blogArticlesPerMonth: 2,
    backlinkOutreach: false,
    monthlyReporting: true,
    targetPages: 5,
  },
  branding: {
    enabled: false,
    logoDesign: true,
    brandGuidelines: false,
    socialMediaTemplates: false,
    printMaterials: false,
    presentationDesign: false,
    extraDesignRequestsPerMonth: 0,
  },
  contentProduction: {
    enabled: false,
    photoShoot: false,
    videoShoot: false,
    reelProduction: false,
    scriptWriting: false,
    editingOnly: false,
    onSiteHours: 0,
    travelFee: false,
    equipmentFee: false,
    deliverables: 0,
  },
  addOns: {
    rushDelivery: false,
    extraRevisions: 0,
    dedicatedAccountManager: false,
    competitorAnalysis: false,
    advancedReporting: false,
    strategySession: false,
    monthlyConsultingHours: 0,
  },
  discountPercent: 0,
  discountFixed: 0,
};

/* ─── localStorage helpers ─── */
const SETTINGS_KEY = 'fivo_calculator_settings';

export function loadSettings(): CalculatorSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as CalculatorSettings;
  } catch { /* ignore */ }
  return structuredClone(DEFAULT_SETTINGS);
}

export function saveSettings(settings: CalculatorSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function resetSettings(): CalculatorSettings {
  localStorage.removeItem(SETTINGS_KEY);
  return structuredClone(DEFAULT_SETTINGS);
}

export function exportSettingsJSON(settings: CalculatorSettings): string {
  return JSON.stringify(settings, null, 2);
}

export function importSettingsJSON(json: string): CalculatorSettings {
  return JSON.parse(json) as CalculatorSettings;
}
