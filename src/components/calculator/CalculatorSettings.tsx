/* ═══════════════════════════════════════════════════════════════════════
   Calculator Settings / Admin Panel
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useState, useRef } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Separator } from '../ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import {
  Save, RotateCcw, Upload, Download, ChevronDown, ChevronRight,
} from 'lucide-react';
import type { CalculatorSettings, Market, MarketPricing } from '../../lib/calculator/types';
import { DEFAULT_SETTINGS, exportSettingsJSON, importSettingsJSON } from '../../lib/calculator/defaults';
import { saveOrShareFile } from '../../lib/native';

interface Props {
  settings: CalculatorSettings;
  onSave: (s: CalculatorSettings) => void;
  onReset: () => void;
}

/* ─── Helpers ─── */
function PriceField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <Label className="text-sm text-gray-600 flex-1 min-w-0">{label}</Label>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={e => onChange(Number(e.target.value) || 0)}
        className="h-8 w-32 text-sm text-right"
      />
    </div>
  );
}

function CollapsibleSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="font-semibold text-sm text-gray-800">{title}</span>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="px-5 py-4 space-y-1 bg-white">{children}</div>}
    </div>
  );
}

/* ═══ Main Component ═══ */
export default function CalculatorSettingsPanel({ settings, onSave, onReset }: Props) {
  const [local, setLocal] = useState<CalculatorSettings>(structuredClone(settings));
  const [market, setMarket] = useState<Market>('albania');
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pricing = local.pricing[market];

  const updatePricing = <K extends keyof MarketPricing>(
    cat: K,
    field: keyof MarketPricing[K],
    value: number,
  ) => {
    setLocal(prev => ({
      ...prev,
      pricing: {
        ...prev.pricing,
        [market]: {
          ...prev.pricing[market],
          [cat]: {
            ...prev.pricing[market][cat],
            [field]: value,
          },
        },
      },
    }));
    setDirty(true);
  };

  const handleSave = () => { onSave(local); setDirty(false); };
  const handleReset = () => {
    setLocal(structuredClone(DEFAULT_SETTINGS));
    setDirty(true);
    onReset();
  };

  const handleExport = () => {
    const json = exportSettingsJSON(local);
    const blob = new Blob([json], { type: 'application/json' });
    saveOrShareFile(blob, 'calculator-settings.json');
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = importSettingsJSON(reader.result as string);
        setLocal(imported);
        setDirty(true);
      } catch { alert('JSON i pavlefshëm'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-6">
      {/* Actions bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Select value={market} onValueChange={(v: Market) => setMarket(v)}>
            <SelectTrigger className="w-44 h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="albania">🇦🇱 Albania Pricing</SelectItem>
              <SelectItem value="international">🌍 International Pricing</SelectItem>
            </SelectContent>
          </Select>
          {dirty && (
            <span className="text-xs text-amber-600 font-medium animate-pulse">● Pa ruajtur</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" /> Import
          </button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset Defaults
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800 disabled:opacity-40 transition-colors"
          >
            <Save className="w-3.5 h-3.5" /> Ruaj
          </button>
        </div>
      </div>

      {/* Pricing sections */}
      <div className="space-y-3">
        <CollapsibleSection title="Social Media Management" defaultOpen>
          <PriceField label="Tarifa bazë mujore" value={pricing.socialMedia.baseMonthlyFee} onChange={v => updatePricing('socialMedia', 'baseMonthlyFee', v)} />
          <PriceField label="Çmim për postim" value={pricing.socialMedia.pricePerPost} onChange={v => updatePricing('socialMedia', 'pricePerPost', v)} />
          <PriceField label="Çmim për reel" value={pricing.socialMedia.pricePerReel} onChange={v => updatePricing('socialMedia', 'pricePerReel', v)} />
          <PriceField label="Çmim për story set" value={pricing.socialMedia.pricePerStorySet} onChange={v => updatePricing('socialMedia', 'pricePerStorySet', v)} />
          <PriceField label="Çmim për platformë shtesë" value={pricing.socialMedia.pricePerExtraPlatform} onChange={v => updatePricing('socialMedia', 'pricePerExtraPlatform', v)} />
          <PriceField label="Caption / Copywriting fee" value={pricing.socialMedia.captionWritingFee} onChange={v => updatePricing('socialMedia', 'captionWritingFee', v)} />
          <PriceField label="Community management fee" value={pricing.socialMedia.communityManagementFee} onChange={v => updatePricing('socialMedia', 'communityManagementFee', v)} />
          <PriceField label="Raport mujor fee" value={pricing.socialMedia.monthlyReportFee} onChange={v => updatePricing('socialMedia', 'monthlyReportFee', v)} />
          <PriceField label="Content calendar fee" value={pricing.socialMedia.contentCalendarFee} onChange={v => updatePricing('socialMedia', 'contentCalendarFee', v)} />
          <PriceField label="Premium design upcharge" value={pricing.socialMedia.premiumDesignUpcharge} onChange={v => updatePricing('socialMedia', 'premiumDesignUpcharge', v)} />
        </CollapsibleSection>

        <CollapsibleSection title="Paid Ads Management">
          <PriceField label="Setup fee" value={pricing.paidAds.setupFee} onChange={v => updatePricing('paidAds', 'setupFee', v)} />
          <PriceField label="Management fee mujore" value={pricing.paidAds.monthlyManagementFee} onChange={v => updatePricing('paidAds', 'monthlyManagementFee', v)} />
          <PriceField label="Minimum fee mujore" value={pricing.paidAds.minimumMonthlyFee} onChange={v => updatePricing('paidAds', 'minimumMonthlyFee', v)} />
          <PriceField label="% e ad spend" value={pricing.paidAds.percentageOfAdSpend} onChange={v => updatePricing('paidAds', 'percentageOfAdSpend', v)} />
          <PriceField label="Çmim për fushatë" value={pricing.paidAds.pricePerCampaign} onChange={v => updatePricing('paidAds', 'pricePerCampaign', v)} />
          <PriceField label="Çmim për ad set" value={pricing.paidAds.pricePerAdSet} onChange={v => updatePricing('paidAds', 'pricePerAdSet', v)} />
          <PriceField label="Çmim për kreativë" value={pricing.paidAds.pricePerCreative} onChange={v => updatePricing('paidAds', 'pricePerCreative', v)} />
          <PriceField label="Tracking setup fee" value={pricing.paidAds.trackingSetupFee} onChange={v => updatePricing('paidAds', 'trackingSetupFee', v)} />
          <PriceField label="Conversion tracking fee" value={pricing.paidAds.conversionTrackingFee} onChange={v => updatePricing('paidAds', 'conversionTrackingFee', v)} />
          <PriceField label="Landing page review fee" value={pricing.paidAds.landingPageReviewFee} onChange={v => updatePricing('paidAds', 'landingPageReviewFee', v)} />
          <PriceField label="Raportim mujor fee" value={pricing.paidAds.monthlyReportingFee} onChange={v => updatePricing('paidAds', 'monthlyReportingFee', v)} />
        </CollapsibleSection>

        <CollapsibleSection title="Web Design / Development">
          <PriceField label="Landing Page base" value={pricing.webDesign.landingPageBase} onChange={v => updatePricing('webDesign', 'landingPageBase', v)} />
          <PriceField label="Business Website base" value={pricing.webDesign.businessWebsiteBase} onChange={v => updatePricing('webDesign', 'businessWebsiteBase', v)} />
          <PriceField label="E-commerce base" value={pricing.webDesign.ecommerceWebsiteBase} onChange={v => updatePricing('webDesign', 'ecommerceWebsiteBase', v)} />
          <PriceField label="Custom Website base" value={pricing.webDesign.customWebsiteBase} onChange={v => updatePricing('webDesign', 'customWebsiteBase', v)} />
          <PriceField label="Çmim për faqe shtesë" value={pricing.webDesign.pricePerExtraPage} onChange={v => updatePricing('webDesign', 'pricePerExtraPage', v)} />
          <PriceField label="Copywriting fee" value={pricing.webDesign.copywritingFee} onChange={v => updatePricing('webDesign', 'copywritingFee', v)} />
          <PriceField label="SEO bazë fee" value={pricing.webDesign.basicSeoFee} onChange={v => updatePricing('webDesign', 'basicSeoFee', v)} />
          <PriceField label="Blog setup fee" value={pricing.webDesign.blogSetupFee} onChange={v => updatePricing('webDesign', 'blogSetupFee', v)} />
          <PriceField label="Contact form fee" value={pricing.webDesign.contactFormFee} onChange={v => updatePricing('webDesign', 'contactFormFee', v)} />
          <PriceField label="Booking system fee" value={pricing.webDesign.bookingSystemFee} onChange={v => updatePricing('webDesign', 'bookingSystemFee', v)} />
          <PriceField label="Multi-language fee" value={pricing.webDesign.multiLanguageFee} onChange={v => updatePricing('webDesign', 'multiLanguageFee', v)} />
          <PriceField label="Speed optimization fee" value={pricing.webDesign.speedOptimizationFee} onChange={v => updatePricing('webDesign', 'speedOptimizationFee', v)} />
          <PriceField label="CMS / Admin panel fee" value={pricing.webDesign.cmsPanelFee} onChange={v => updatePricing('webDesign', 'cmsPanelFee', v)} />
          <PriceField label="E-commerce features fee" value={pricing.webDesign.ecommerceFeaturesFee} onChange={v => updatePricing('webDesign', 'ecommerceFeaturesFee', v)} />
          <PriceField label="Çmim për produkt" value={pricing.webDesign.pricePerProduct} onChange={v => updatePricing('webDesign', 'pricePerProduct', v)} />
          <PriceField label="Payment gateway fee" value={pricing.webDesign.paymentGatewayFee} onChange={v => updatePricing('webDesign', 'paymentGatewayFee', v)} />
          <PriceField label="Hosting support fee" value={pricing.webDesign.hostingSupportFee} onChange={v => updatePricing('webDesign', 'hostingSupportFee', v)} />
          <PriceField label="Mirëmbajtje mujore" value={pricing.webDesign.maintenanceMonthlyFee} onChange={v => updatePricing('webDesign', 'maintenanceMonthlyFee', v)} />
        </CollapsibleSection>

        <CollapsibleSection title="SEO">
          <PriceField label="Setup fee" value={pricing.seo.setupFee} onChange={v => updatePricing('seo', 'setupFee', v)} />
          <PriceField label="Tarifa bazë mujore" value={pricing.seo.monthlyBaseFee} onChange={v => updatePricing('seo', 'monthlyBaseFee', v)} />
          <PriceField label="SEO Audit fee" value={pricing.seo.seoAuditFee} onChange={v => updatePricing('seo', 'seoAuditFee', v)} />
          <PriceField label="On-page SEO fee" value={pricing.seo.onPageSeoFee} onChange={v => updatePricing('seo', 'onPageSeoFee', v)} />
          <PriceField label="Technical SEO fee" value={pricing.seo.technicalSeoFee} onChange={v => updatePricing('seo', 'technicalSeoFee', v)} />
          <PriceField label="Local SEO fee" value={pricing.seo.localSeoFee} onChange={v => updatePricing('seo', 'localSeoFee', v)} />
          <PriceField label="Keyword research fee" value={pricing.seo.keywordResearchFee} onChange={v => updatePricing('seo', 'keywordResearchFee', v)} />
          <PriceField label="Çmim për artikull" value={pricing.seo.pricePerArticle} onChange={v => updatePricing('seo', 'pricePerArticle', v)} />
          <PriceField label="Backlink outreach fee" value={pricing.seo.backlinkOutreachFee} onChange={v => updatePricing('seo', 'backlinkOutreachFee', v)} />
          <PriceField label="Raportim mujor fee" value={pricing.seo.monthlyReportingFee} onChange={v => updatePricing('seo', 'monthlyReportingFee', v)} />
          <PriceField label="Çmim për faqe target" value={pricing.seo.pricePerTargetPage} onChange={v => updatePricing('seo', 'pricePerTargetPage', v)} />
        </CollapsibleSection>

        <CollapsibleSection title="Branding / Graphic Design">
          <PriceField label="Logo design" value={pricing.branding.logoDesignFee} onChange={v => updatePricing('branding', 'logoDesignFee', v)} />
          <PriceField label="Brand guidelines" value={pricing.branding.brandGuidelinesFee} onChange={v => updatePricing('branding', 'brandGuidelinesFee', v)} />
          <PriceField label="Social media templates" value={pricing.branding.socialMediaTemplatesFee} onChange={v => updatePricing('branding', 'socialMediaTemplatesFee', v)} />
          <PriceField label="Print materials" value={pricing.branding.printMaterialsFee} onChange={v => updatePricing('branding', 'printMaterialsFee', v)} />
          <PriceField label="Presentation design" value={pricing.branding.presentationDesignFee} onChange={v => updatePricing('branding', 'presentationDesignFee', v)} />
          <PriceField label="Çmim për kërkesë shtesë" value={pricing.branding.pricePerExtraDesignRequest} onChange={v => updatePricing('branding', 'pricePerExtraDesignRequest', v)} />
        </CollapsibleSection>

        <CollapsibleSection title="Content Production">
          <PriceField label="Photo shoot" value={pricing.contentProduction.photoShootFee} onChange={v => updatePricing('contentProduction', 'photoShootFee', v)} />
          <PriceField label="Video shoot" value={pricing.contentProduction.videoShootFee} onChange={v => updatePricing('contentProduction', 'videoShootFee', v)} />
          <PriceField label="Reel production" value={pricing.contentProduction.reelProductionFee} onChange={v => updatePricing('contentProduction', 'reelProductionFee', v)} />
          <PriceField label="Script writing" value={pricing.contentProduction.scriptWritingFee} onChange={v => updatePricing('contentProduction', 'scriptWritingFee', v)} />
          <PriceField label="Editing only" value={pricing.contentProduction.editingOnlyFee} onChange={v => updatePricing('contentProduction', 'editingOnlyFee', v)} />
          <PriceField label="Çmim për orë on-site" value={pricing.contentProduction.pricePerOnSiteHour} onChange={v => updatePricing('contentProduction', 'pricePerOnSiteHour', v)} />
          <PriceField label="Travel fee" value={pricing.contentProduction.travelFee} onChange={v => updatePricing('contentProduction', 'travelFee', v)} />
          <PriceField label="Equipment fee" value={pricing.contentProduction.equipmentFee} onChange={v => updatePricing('contentProduction', 'equipmentFee', v)} />
          <PriceField label="Çmim për deliverable" value={pricing.contentProduction.pricePerDeliverable} onChange={v => updatePricing('contentProduction', 'pricePerDeliverable', v)} />
        </CollapsibleSection>

        <CollapsibleSection title="Add-ons / Extra">
          <PriceField label="Rush delivery" value={pricing.addOns.rushDeliveryFee} onChange={v => updatePricing('addOns', 'rushDeliveryFee', v)} />
          <PriceField label="Çmim për revizion shtesë" value={pricing.addOns.pricePerExtraRevision} onChange={v => updatePricing('addOns', 'pricePerExtraRevision', v)} />
          <PriceField label="Account manager i dedikuar" value={pricing.addOns.dedicatedAccountManagerFee} onChange={v => updatePricing('addOns', 'dedicatedAccountManagerFee', v)} />
          <PriceField label="Analizë konkurrentësh" value={pricing.addOns.competitorAnalysisFee} onChange={v => updatePricing('addOns', 'competitorAnalysisFee', v)} />
          <PriceField label="Raportim i avancuar" value={pricing.addOns.advancedReportingFee} onChange={v => updatePricing('addOns', 'advancedReportingFee', v)} />
          <PriceField label="Strategy session" value={pricing.addOns.strategySessionFee} onChange={v => updatePricing('addOns', 'strategySessionFee', v)} />
          <PriceField label="Çmim për orë konsulence" value={pricing.addOns.pricePerConsultingHour} onChange={v => updatePricing('addOns', 'pricePerConsultingHour', v)} />
        </CollapsibleSection>

        <Separator />

        <CollapsibleSection title="Kursi i këmbimit">
          <PriceField label="ALL → EUR" value={local.exchangeRates.ALL_to_EUR} onChange={v => { setLocal(prev => ({ ...prev, exchangeRates: { ...prev.exchangeRates, ALL_to_EUR: v } })); setDirty(true); }} />
          <PriceField label="ALL → USD" value={local.exchangeRates.ALL_to_USD} onChange={v => { setLocal(prev => ({ ...prev, exchangeRates: { ...prev.exchangeRates, ALL_to_USD: v } })); setDirty(true); }} />
          <PriceField label="EUR → ALL" value={local.exchangeRates.EUR_to_ALL} onChange={v => { setLocal(prev => ({ ...prev, exchangeRates: { ...prev.exchangeRates, EUR_to_ALL: v } })); setDirty(true); }} />
          <PriceField label="EUR → USD" value={local.exchangeRates.EUR_to_USD} onChange={v => { setLocal(prev => ({ ...prev, exchangeRates: { ...prev.exchangeRates, EUR_to_USD: v } })); setDirty(true); }} />
          <PriceField label="USD → ALL" value={local.exchangeRates.USD_to_ALL} onChange={v => { setLocal(prev => ({ ...prev, exchangeRates: { ...prev.exchangeRates, USD_to_ALL: v } })); setDirty(true); }} />
          <PriceField label="USD → EUR" value={local.exchangeRates.USD_to_EUR} onChange={v => { setLocal(prev => ({ ...prev, exchangeRates: { ...prev.exchangeRates, USD_to_EUR: v } })); setDirty(true); }} />
        </CollapsibleSection>

        <CollapsibleSection title="Bundle Discounts">
          <div className="flex items-center justify-between py-2">
            <Label className="text-sm text-gray-600">Aktivizo bundle discounts</Label>
            <Switch
              checked={local.bundleDiscountsEnabled}
              onCheckedChange={v => { setLocal(prev => ({ ...prev, bundleDiscountsEnabled: v })); setDirty(true); }}
            />
          </div>
          {local.bundleDiscountsEnabled && (
            <div className="space-y-3 mt-2">
              {local.bundleDiscounts.map((bd, i) => (
                <div key={bd.id} className="flex items-center gap-3 py-1 border-b border-gray-50 last:border-0">
                  <Switch
                    checked={bd.enabled}
                    onCheckedChange={v => {
                      setLocal(prev => {
                        const next = structuredClone(prev);
                        next.bundleDiscounts[i].enabled = v;
                        return next;
                      });
                      setDirty(true);
                    }}
                  />
                  <span className="text-sm text-gray-700 flex-1">{bd.name}</span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={bd.discountPercent}
                    onChange={e => {
                      setLocal(prev => {
                        const next = structuredClone(prev);
                        next.bundleDiscounts[i].discountPercent = Number(e.target.value) || 0;
                        return next;
                      });
                      setDirty(true);
                    }}
                    className="h-8 w-20 text-sm text-right"
                  />
                  <span className="text-xs text-gray-400">%</span>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Internal Costs & Margins">
          <div className="flex items-center justify-between py-2">
            <Label className="text-sm text-gray-600">Shfaq kostet interne</Label>
            <Switch
              checked={local.showInternalCosts}
              onCheckedChange={v => { setLocal(prev => ({ ...prev, showInternalCosts: v })); setDirty(true); }}
            />
          </div>
          <PriceField
            label="Shumëzues i kostos interne (%)"
            value={local.internalCostMultiplier * 100}
            onChange={v => { setLocal(prev => ({ ...prev, internalCostMultiplier: v / 100 })); setDirty(true); }}
          />
          <PriceField
            label="Çmim minimal i pranueshëm (%)"
            value={local.minimumPriceFloorPercent}
            onChange={v => { setLocal(prev => ({ ...prev, minimumPriceFloorPercent: v })); setDirty(true); }}
          />
        </CollapsibleSection>
      </div>
    </div>
  );
}
