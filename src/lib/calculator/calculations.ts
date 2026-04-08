/* ═══════════════════════════════════════════════════════════════════════
   Marketing Agency Price Calculator — Calculation Engine
   ═══════════════════════════════════════════════════════════════════════ */

import type {
  CalculatorSelections, CalculatorSettings, MarketPricing,
  LineItem, CategoryTotal, CalculationResult, Currency,
} from './types';

/* ─── Currency formatting ─── */
export function formatCurrency(amount: number, currency: Currency): string {
  const abs = Math.abs(amount);
  switch (currency) {
    case 'ALL': return `${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })} ALL`;
    case 'EUR': return `€${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'USD': return `$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

/* ─── Convert between currencies ─── */
export function convertCurrency(
  amount: number,
  from: Currency,
  to: Currency,
  rates: CalculatorSettings['exchangeRates'],
): number {
  if (from === to) return amount;
  const key = `${from}_to_${to}` as keyof typeof rates;
  const rate = rates[key];
  if (!rate) return amount;
  return amount * rate;
}

/* ─── Helper: push a line item ─── */
function line(
  label: string, amount: number, type: 'one-time' | 'monthly', category: string,
  quantity?: number, unitPrice?: number,
): LineItem {
  return { label, amount, type, category, quantity, unitPrice };
}

/* ─── Social Media ─── */
function calcSocialMedia(s: CalculatorSelections['socialMedia'], p: MarketPricing['socialMedia']): LineItem[] {
  if (!s.enabled) return [];
  const items: LineItem[] = [];
  const cat = 'Social Media';

  items.push(line('Tarifa bazë mujore', p.baseMonthlyFee, 'monthly', cat));

  if (s.platforms > 1) {
    const extra = s.platforms - 1;
    items.push(line('Platforma shtesë', extra * p.pricePerExtraPlatform, 'monthly', cat, extra, p.pricePerExtraPlatform));
  }
  if (s.postsPerMonth > 0) {
    items.push(line('Postime statike', s.postsPerMonth * p.pricePerPost, 'monthly', cat, s.postsPerMonth, p.pricePerPost));
  }
  if (s.reelsPerMonth > 0) {
    items.push(line('Reels', s.reelsPerMonth * p.pricePerReel, 'monthly', cat, s.reelsPerMonth, p.pricePerReel));
  }
  if (s.storySetsPerMonth > 0) {
    items.push(line('Story sets', s.storySetsPerMonth * p.pricePerStorySet, 'monthly', cat, s.storySetsPerMonth, p.pricePerStorySet));
  }
  if (s.captionWriting) items.push(line('Copywriting / Caption', p.captionWritingFee, 'monthly', cat));
  if (s.communityManagement) items.push(line('Community management', p.communityManagementFee, 'monthly', cat));
  if (s.monthlyReport) items.push(line('Raport mujor', p.monthlyReportFee, 'monthly', cat));
  if (s.contentCalendar) items.push(line('Content calendar', p.contentCalendarFee, 'monthly', cat));
  if (s.designQuality === 'premium') items.push(line('Premium design upgrade', p.premiumDesignUpcharge, 'monthly', cat));

  return items;
}

/* ─── Paid Ads ─── */
function calcPaidAds(s: CalculatorSelections['paidAds'], p: MarketPricing['paidAds']): LineItem[] {
  if (!s.enabled) return [];
  const items: LineItem[] = [];
  const cat = 'Paid Ads';

  items.push(line('Setup fee', p.setupFee, 'one-time', cat));

  if (s.pricingMode === 'fixed') {
    items.push(line('Management fee mujore', Math.max(p.monthlyManagementFee, p.minimumMonthlyFee), 'monthly', cat));
  } else {
    const pctFee = s.adSpendAmount * (p.percentageOfAdSpend / 100);
    const mgmtFee = Math.max(pctFee, p.minimumMonthlyFee);
    items.push(line(`Management fee (${p.percentageOfAdSpend}% of ad spend)`, mgmtFee, 'monthly', cat));
  }

  if (s.platforms.length > 1) {
    const extra = s.platforms.length - 1;
    items.push(line('Platforma shtesë ads', extra * p.pricePerCampaign, 'monthly', cat, extra, p.pricePerCampaign));
  }
  if (s.campaigns > 0) items.push(line('Fushata', s.campaigns * p.pricePerCampaign, 'monthly', cat, s.campaigns, p.pricePerCampaign));
  if (s.adSets > 0) items.push(line('Ad sets', s.adSets * p.pricePerAdSet, 'monthly', cat, s.adSets, p.pricePerAdSet));
  if (s.creatives > 0) items.push(line('Kreativa', s.creatives * p.pricePerCreative, 'monthly', cat, s.creatives, p.pricePerCreative));
  if (s.trackingSetup) items.push(line('Tracking / Pixel setup', p.trackingSetupFee, 'one-time', cat));
  if (s.conversionTracking) items.push(line('Conversion tracking', p.conversionTrackingFee, 'one-time', cat));
  if (s.landingPageReview) items.push(line('Landing page review', p.landingPageReviewFee, 'one-time', cat));
  if (s.monthlyReporting) items.push(line('Raportim mujor', p.monthlyReportingFee, 'monthly', cat));

  return items;
}

/* ─── Web Design ─── */
function calcWebDesign(s: CalculatorSelections['webDesign'], p: MarketPricing['webDesign']): LineItem[] {
  if (!s.enabled) return [];
  const items: LineItem[] = [];
  const cat = 'Web Design';

  const baseMap = {
    landing: p.landingPageBase,
    business: p.businessWebsiteBase,
    ecommerce: p.ecommerceWebsiteBase,
    custom: p.customWebsiteBase,
  };
  const typeLabels = { landing: 'Landing Page', business: 'Business Website', ecommerce: 'E-commerce', custom: 'Custom Website' };
  items.push(line(`${typeLabels[s.websiteType]} (${s.pages} faqe)`, baseMap[s.websiteType], 'one-time', cat));

  if (s.extraPages > 0) items.push(line('Faqe shtesë', s.extraPages * p.pricePerExtraPage, 'one-time', cat, s.extraPages, p.pricePerExtraPage));
  if (s.copywriting) items.push(line('Copywriting', p.copywritingFee, 'one-time', cat));
  if (s.basicSeo) items.push(line('SEO bazë', p.basicSeoFee, 'one-time', cat));
  if (s.blogSetup) items.push(line('Blog setup', p.blogSetupFee, 'one-time', cat));
  if (s.contactForm) items.push(line('Formular kontakti', p.contactFormFee, 'one-time', cat));
  if (s.bookingSystem) items.push(line('Sistem rezervimi', p.bookingSystemFee, 'one-time', cat));
  if (s.multiLanguage) items.push(line('Multi-language', p.multiLanguageFee, 'one-time', cat));
  if (s.speedOptimization) items.push(line('Speed optimization', p.speedOptimizationFee, 'one-time', cat));
  if (s.cmsPanel) items.push(line('CMS / Admin panel', p.cmsPanelFee, 'one-time', cat));
  if (s.ecommerceFeatures) {
    items.push(line('E-commerce features', p.ecommerceFeaturesFee, 'one-time', cat));
    if (s.productsCount > 0) items.push(line('Produkte', s.productsCount * p.pricePerProduct, 'one-time', cat, s.productsCount, p.pricePerProduct));
  }
  if (s.paymentGateway) items.push(line('Payment gateway', p.paymentGatewayFee, 'one-time', cat));
  if (s.hostingSupport) items.push(line('Hosting / Domain support', p.hostingSupportFee, 'monthly', cat));
  if (s.maintenanceMonthly) items.push(line('Mirëmbajtje mujore', p.maintenanceMonthlyFee, 'monthly', cat));

  return items;
}

/* ─── SEO ─── */
function calcSeo(s: CalculatorSelections['seo'], p: MarketPricing['seo']): LineItem[] {
  if (!s.enabled) return [];
  const items: LineItem[] = [];
  const cat = 'SEO';

  items.push(line('SEO setup fee', p.setupFee, 'one-time', cat));
  items.push(line('Tarifa bazë mujore SEO', p.monthlyBaseFee, 'monthly', cat));

  if (s.seoAudit) items.push(line('SEO Audit', p.seoAuditFee, 'one-time', cat));
  if (s.onPageSeo) items.push(line('On-page SEO', p.onPageSeoFee, 'monthly', cat));
  if (s.technicalSeo) items.push(line('Technical SEO', p.technicalSeoFee, 'monthly', cat));
  if (s.localSeo) items.push(line('Local SEO', p.localSeoFee, 'monthly', cat));
  if (s.keywordResearch) items.push(line('Keyword research', p.keywordResearchFee, 'one-time', cat));
  if (s.blogArticlesPerMonth > 0) items.push(line('Artikuj blog', s.blogArticlesPerMonth * p.pricePerArticle, 'monthly', cat, s.blogArticlesPerMonth, p.pricePerArticle));
  if (s.backlinkOutreach) items.push(line('Backlink outreach', p.backlinkOutreachFee, 'monthly', cat));
  if (s.monthlyReporting) items.push(line('Raportim mujor SEO', p.monthlyReportingFee, 'monthly', cat));
  if (s.targetPages > 0) items.push(line('Faqe target', s.targetPages * p.pricePerTargetPage, 'monthly', cat, s.targetPages, p.pricePerTargetPage));

  return items;
}

/* ─── Branding ─── */
function calcBranding(s: CalculatorSelections['branding'], p: MarketPricing['branding']): LineItem[] {
  if (!s.enabled) return [];
  const items: LineItem[] = [];
  const cat = 'Branding';

  if (s.logoDesign) items.push(line('Logo design', p.logoDesignFee, 'one-time', cat));
  if (s.brandGuidelines) items.push(line('Brand guidelines', p.brandGuidelinesFee, 'one-time', cat));
  if (s.socialMediaTemplates) items.push(line('Social media templates', p.socialMediaTemplatesFee, 'one-time', cat));
  if (s.printMaterials) items.push(line('Print materials', p.printMaterialsFee, 'one-time', cat));
  if (s.presentationDesign) items.push(line('Presentation design', p.presentationDesignFee, 'one-time', cat));
  if (s.extraDesignRequestsPerMonth > 0) {
    items.push(line('Kërkesa shtesë design', s.extraDesignRequestsPerMonth * p.pricePerExtraDesignRequest, 'monthly', cat, s.extraDesignRequestsPerMonth, p.pricePerExtraDesignRequest));
  }

  return items;
}

/* ─── Content Production ─── */
function calcContentProduction(s: CalculatorSelections['contentProduction'], p: MarketPricing['contentProduction']): LineItem[] {
  if (!s.enabled) return [];
  const items: LineItem[] = [];
  const cat = 'Content Production';

  if (s.photoShoot) items.push(line('Photo shoot', p.photoShootFee, 'one-time', cat));
  if (s.videoShoot) items.push(line('Video shoot', p.videoShootFee, 'one-time', cat));
  if (s.reelProduction) items.push(line('Reel production', p.reelProductionFee, 'one-time', cat));
  if (s.scriptWriting) items.push(line('Script writing', p.scriptWritingFee, 'one-time', cat));
  if (s.editingOnly) items.push(line('Editing', p.editingOnlyFee, 'one-time', cat));
  if (s.onSiteHours > 0) items.push(line('On-site shooting', s.onSiteHours * p.pricePerOnSiteHour, 'one-time', cat, s.onSiteHours, p.pricePerOnSiteHour));
  if (s.travelFee) items.push(line('Travel fee', p.travelFee, 'one-time', cat));
  if (s.equipmentFee) items.push(line('Equipment fee', p.equipmentFee, 'one-time', cat));
  if (s.deliverables > 0) items.push(line('Deliverables', s.deliverables * p.pricePerDeliverable, 'one-time', cat, s.deliverables, p.pricePerDeliverable));

  return items;
}

/* ─── Add-ons ─── */
function calcAddOns(s: CalculatorSelections['addOns'], p: MarketPricing['addOns']): LineItem[] {
  const items: LineItem[] = [];
  const cat = 'Add-ons';

  if (s.rushDelivery) items.push(line('Rush delivery', p.rushDeliveryFee, 'one-time', cat));
  if (s.extraRevisions > 0) items.push(line('Revizione shtesë', s.extraRevisions * p.pricePerExtraRevision, 'one-time', cat, s.extraRevisions, p.pricePerExtraRevision));
  if (s.dedicatedAccountManager) items.push(line('Account manager i dedikuar', p.dedicatedAccountManagerFee, 'monthly', cat));
  if (s.competitorAnalysis) items.push(line('Analizë konkurrentësh', p.competitorAnalysisFee, 'one-time', cat));
  if (s.advancedReporting) items.push(line('Raportim i avancuar', p.advancedReportingFee, 'monthly', cat));
  if (s.strategySession) items.push(line('Strategy session', p.strategySessionFee, 'one-time', cat));
  if (s.monthlyConsultingHours > 0) items.push(line('Orë konsulenze', s.monthlyConsultingHours * p.pricePerConsultingHour, 'monthly', cat, s.monthlyConsultingHours, p.pricePerConsultingHour));

  return items;
}

/* ─── Suggest a label ─── */
function suggestLabel(enabledCount: number, totalMonthly: number, currency: string): string {
  if (enabledCount === 0) return 'Custom';
  if (enabledCount === 1 && totalMonthly < (currency === 'ALL' ? 50_000 : 400)) return 'Basic';
  if (enabledCount <= 2 && totalMonthly < (currency === 'ALL' ? 100_000 : 900)) return 'Standard';
  if (enabledCount <= 3) return 'Growth';
  if (enabledCount <= 5) return 'Premium';
  return 'Enterprise';
}

/* ═══ Main Calculation ═══ */
export function calculate(sel: CalculatorSelections, settings: CalculatorSettings): CalculationResult {
  const pricing = settings.pricing[sel.market];

  // Calculate line items per category
  const categoryCalcs: { key: string; label: string; items: LineItem[] }[] = [
    { key: 'socialMedia', label: 'Social Media', items: calcSocialMedia(sel.socialMedia, pricing.socialMedia) },
    { key: 'paidAds', label: 'Paid Ads', items: calcPaidAds(sel.paidAds, pricing.paidAds) },
    { key: 'webDesign', label: 'Web Design', items: calcWebDesign(sel.webDesign, pricing.webDesign) },
    { key: 'seo', label: 'SEO', items: calcSeo(sel.seo, pricing.seo) },
    { key: 'branding', label: 'Branding', items: calcBranding(sel.branding, pricing.branding) },
    { key: 'contentProduction', label: 'Content Production', items: calcContentProduction(sel.contentProduction, pricing.contentProduction) },
    { key: 'addOns', label: 'Add-ons', items: calcAddOns(sel.addOns, pricing.addOns) },
  ];

  const categories: CategoryTotal[] = categoryCalcs
    .filter(c => c.items.length > 0)
    .map(c => ({
      category: c.label,
      oneTime: c.items.filter(i => i.type === 'one-time').reduce((s, i) => s + i.amount, 0),
      monthly: c.items.filter(i => i.type === 'monthly').reduce((s, i) => s + i.amount, 0),
      items: c.items,
    }));

  const subtotalOneTime = categories.reduce((s, c) => s + c.oneTime, 0);
  const subtotalMonthly = categories.reduce((s, c) => s + c.monthly, 0);

  // Enabled services count
  const enabledKeys = ['socialMedia', 'paidAds', 'webDesign', 'seo', 'branding', 'contentProduction'] as const;
  const enabledServicesCount = enabledKeys.filter(k => sel[k].enabled).length;

  // Bundle discounts
  let bundleDiscountAmount = 0;
  let bundleDiscountLabel = '';
  if (settings.bundleDiscountsEnabled) {
    const enabledSet = new Set(enabledKeys.filter(k => sel[k].enabled));
    let bestDiscount = 0;
    for (const bd of settings.bundleDiscounts) {
      if (!bd.enabled) continue;
      if (bd.services.every(s => enabledSet.has(s as any))) {
        if (bd.discountPercent > bestDiscount) {
          bestDiscount = bd.discountPercent;
          bundleDiscountLabel = bd.name;
        }
      }
    }
    if (bestDiscount > 0) {
      bundleDiscountAmount = (subtotalOneTime + subtotalMonthly) * (bestDiscount / 100);
    }
  }

  // Manual discounts
  let manualDiscountAmount = 0;
  if (sel.discountPercent > 0) {
    manualDiscountAmount += (subtotalOneTime + subtotalMonthly) * (sel.discountPercent / 100);
  }
  manualDiscountAmount += sel.discountFixed;

  const totalDiscount = bundleDiscountAmount + manualDiscountAmount;
  const totalBeforeDiscount = subtotalOneTime + subtotalMonthly;
  const discountRatio = totalBeforeDiscount > 0 ? (totalBeforeDiscount - totalDiscount) / totalBeforeDiscount : 1;

  const totalOneTime = Math.max(0, subtotalOneTime * discountRatio);
  const totalMonthly = Math.max(0, subtotalMonthly * discountRatio);
  const grandTotal = totalOneTime + totalMonthly;

  // Internal costs (optional)
  const internalCostOneTime = settings.showInternalCosts ? totalOneTime * settings.internalCostMultiplier : undefined;
  const internalCostMonthly = settings.showInternalCosts ? totalMonthly * settings.internalCostMultiplier : undefined;
  const profitMarginPercent = settings.showInternalCosts && grandTotal > 0
    ? ((grandTotal - (internalCostOneTime! + internalCostMonthly!)) / grandTotal) * 100
    : undefined;
  const minimumAcceptablePrice = grandTotal * (settings.minimumPriceFloorPercent / 100);

  return {
    categories,
    subtotalOneTime,
    subtotalMonthly,
    bundleDiscountAmount,
    bundleDiscountLabel,
    manualDiscountAmount,
    totalOneTime,
    totalMonthly,
    grandTotal,
    suggestedLabel: suggestLabel(enabledServicesCount, subtotalMonthly, sel.currency),
    internalCostOneTime,
    internalCostMonthly,
    profitMarginPercent,
    minimumAcceptablePrice,
    enabledServicesCount,
  };
}
