/* ═══════════════════════════════════════════════════════════════════════
   Service Configuration Sections — All 7 categories in one file
   Uses shadcn/ui: Switch, Input, Select, Label, Badge
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { Switch } from '../ui/switch';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import {
  Instagram, Megaphone, Globe, Search, Palette, Camera, Plus,
} from 'lucide-react';
import type { CalculatorSelections } from '../../lib/calculator/types';

/* ─── Shared primitives ─── */

type Sel = CalculatorSelections;
type UpSel = (fn: (prev: Sel) => Sel) => void;

interface SectionProps {
  sel: Sel;
  update: UpSel;
}

function SectionHeader({
  icon: Icon, title, enabled, onToggle, color,
}: {
  icon: React.ElementType; title: string; enabled: boolean; onToggle: () => void; color: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center`}>
          <Icon className="w-4.5 h-4.5 text-white" />
        </div>
        <h3 className="font-semibold text-gray-900">{title}</h3>
      </div>
      <Switch checked={enabled} onCheckedChange={onToggle} />
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <Label className="text-sm text-gray-600 flex-1">{label}</Label>
      <div className="w-40 flex-shrink-0">{children}</div>
    </div>
  );
}

function NumberInput({ value, onChange, min = 0, max = 999 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <Input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={e => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
      className="h-9 text-sm"
    />
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-gray-600">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/* ═══ 1. SOCIAL MEDIA ═══ */
export function SocialMediaSection({ sel, update }: SectionProps) {
  const s = sel.socialMedia;
  const up = (patch: Partial<typeof s>) => update(prev => ({ ...prev, socialMedia: { ...prev.socialMedia, ...patch } }));

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Instagram} title="Social Media Management" color="bg-pink-500"
        enabled={s.enabled} onToggle={() => up({ enabled: !s.enabled })}
      />
      {s.enabled && (
        <div className="pl-12 space-y-1 animate-in fade-in slide-in-from-top-2 duration-200">
          <FieldRow label="Numri i platformave">
            <NumberInput value={s.platforms} onChange={v => up({ platforms: v })} min={1} max={10} />
          </FieldRow>
          <FieldRow label="Postime statike / muaj">
            <NumberInput value={s.postsPerMonth} onChange={v => up({ postsPerMonth: v })} />
          </FieldRow>
          <FieldRow label="Reels / muaj">
            <NumberInput value={s.reelsPerMonth} onChange={v => up({ reelsPerMonth: v })} />
          </FieldRow>
          <FieldRow label="Story sets / muaj">
            <NumberInput value={s.storySetsPerMonth} onChange={v => up({ storySetsPerMonth: v })} />
          </FieldRow>
          <FieldRow label="Cilësia e design-it">
            <Select value={s.designQuality} onValueChange={(v: any) => up({ designQuality: v })}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="premium">Premium</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
          <div className="border-t pt-3 mt-3 space-y-1">
            <ToggleRow label="Caption / Copywriting" checked={s.captionWriting} onChange={v => up({ captionWriting: v })} />
            <ToggleRow label="Community management" checked={s.communityManagement} onChange={v => up({ communityManagement: v })} />
            <ToggleRow label="Raport mujor" checked={s.monthlyReport} onChange={v => up({ monthlyReport: v })} />
            <ToggleRow label="Content calendar" checked={s.contentCalendar} onChange={v => up({ contentCalendar: v })} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ 2. PAID ADS ═══ */
const AD_PLATFORMS = [
  { id: 'facebook', label: 'Facebook / Instagram' },
  { id: 'google', label: 'Google Ads' },
  { id: 'tiktok', label: 'TikTok Ads' },
  { id: 'linkedin', label: 'LinkedIn Ads' },
];

export function PaidAdsSection({ sel, update }: SectionProps) {
  const s = sel.paidAds;
  const up = (patch: Partial<typeof s>) => update(prev => ({ ...prev, paidAds: { ...prev.paidAds, ...patch } }));

  const togglePlatform = (id: string) => {
    const platforms = s.platforms.includes(id)
      ? s.platforms.filter(p => p !== id)
      : [...s.platforms, id];
    up({ platforms: platforms.length > 0 ? platforms : [id] });
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Megaphone} title="Paid Ads Management" color="bg-blue-500"
        enabled={s.enabled} onToggle={() => up({ enabled: !s.enabled })}
      />
      {s.enabled && (
        <div className="pl-12 space-y-1 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="py-2">
            <Label className="text-sm text-gray-600 mb-2 block">Platformat</Label>
            <div className="flex flex-wrap gap-2">
              {AD_PLATFORMS.map(p => (
                <Badge
                  key={p.id}
                  variant={s.platforms.includes(p.id) ? 'default' : 'outline'}
                  className="cursor-pointer select-none"
                  onClick={() => togglePlatform(p.id)}
                >
                  {p.label}
                </Badge>
              ))}
            </div>
          </div>
          <FieldRow label="Fushata">
            <NumberInput value={s.campaigns} onChange={v => up({ campaigns: v })} />
          </FieldRow>
          <FieldRow label="Ad sets">
            <NumberInput value={s.adSets} onChange={v => up({ adSets: v })} />
          </FieldRow>
          <FieldRow label="Kreativa">
            <NumberInput value={s.creatives} onChange={v => up({ creatives: v })} />
          </FieldRow>
          <FieldRow label="Mënyra e çmimit">
            <Select value={s.pricingMode} onValueChange={(v: any) => up({ pricingMode: v })}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed price</SelectItem>
                <SelectItem value="percentage">% of ad spend</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
          {s.pricingMode === 'percentage' && (
            <FieldRow label="Ad spend mujor">
              <NumberInput value={s.adSpendAmount} onChange={v => up({ adSpendAmount: v })} max={999999} />
            </FieldRow>
          )}
          <FieldRow label="Buxheti i reklamave">
            <Select value={s.adBudgetRange} onValueChange={(v: any) => up({ adBudgetRange: v })}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0-300">0 – 300</SelectItem>
                <SelectItem value="300-1000">300 – 1,000</SelectItem>
                <SelectItem value="1000-3000">1,000 – 3,000</SelectItem>
                <SelectItem value="3000+">3,000+</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
          <div className="border-t pt-3 mt-3 space-y-1">
            <ToggleRow label="Optimizim mujor" checked={s.monthlyOptimization} onChange={v => up({ monthlyOptimization: v })} />
            <ToggleRow label="Tracking / Pixel setup" checked={s.trackingSetup} onChange={v => up({ trackingSetup: v })} />
            <ToggleRow label="Conversion tracking" checked={s.conversionTracking} onChange={v => up({ conversionTracking: v })} />
            <ToggleRow label="Landing page review" checked={s.landingPageReview} onChange={v => up({ landingPageReview: v })} />
            <ToggleRow label="Raportim mujor" checked={s.monthlyReporting} onChange={v => up({ monthlyReporting: v })} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ 3. WEB DESIGN ═══ */
export function WebDesignSection({ sel, update }: SectionProps) {
  const s = sel.webDesign;
  const up = (patch: Partial<typeof s>) => update(prev => ({ ...prev, webDesign: { ...prev.webDesign, ...patch } }));

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Globe} title="Web Design / Development" color="bg-indigo-500"
        enabled={s.enabled} onToggle={() => up({ enabled: !s.enabled })}
      />
      {s.enabled && (
        <div className="pl-12 space-y-1 animate-in fade-in slide-in-from-top-2 duration-200">
          <FieldRow label="Tipi i faqes">
            <Select value={s.websiteType} onValueChange={(v: any) => up({ websiteType: v })}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="landing">Landing Page</SelectItem>
                <SelectItem value="business">Business Website</SelectItem>
                <SelectItem value="ecommerce">E-commerce</SelectItem>
                <SelectItem value="custom">Custom Website</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Numri i faqeve">
            <NumberInput value={s.pages} onChange={v => up({ pages: v })} min={1} max={100} />
          </FieldRow>
          <FieldRow label="Faqe shtesë">
            <NumberInput value={s.extraPages} onChange={v => up({ extraPages: v })} />
          </FieldRow>
          {s.websiteType === 'ecommerce' && (
            <FieldRow label="Numri i produkteve">
              <NumberInput value={s.productsCount} onChange={v => up({ productsCount: v })} max={99999} />
            </FieldRow>
          )}
          <div className="border-t pt-3 mt-3 space-y-1">
            <ToggleRow label="Copywriting" checked={s.copywriting} onChange={v => up({ copywriting: v })} />
            <ToggleRow label="SEO bazë" checked={s.basicSeo} onChange={v => up({ basicSeo: v })} />
            <ToggleRow label="Blog setup" checked={s.blogSetup} onChange={v => up({ blogSetup: v })} />
            <ToggleRow label="Formular kontakti" checked={s.contactForm} onChange={v => up({ contactForm: v })} />
            <ToggleRow label="Sistem rezervimi" checked={s.bookingSystem} onChange={v => up({ bookingSystem: v })} />
            <ToggleRow label="Multi-language" checked={s.multiLanguage} onChange={v => up({ multiLanguage: v })} />
            <ToggleRow label="Speed optimization" checked={s.speedOptimization} onChange={v => up({ speedOptimization: v })} />
            <ToggleRow label="CMS / Admin panel" checked={s.cmsPanel} onChange={v => up({ cmsPanel: v })} />
            {s.websiteType === 'ecommerce' && (
              <>
                <ToggleRow label="E-commerce features" checked={s.ecommerceFeatures} onChange={v => up({ ecommerceFeatures: v })} />
                <ToggleRow label="Payment gateway" checked={s.paymentGateway} onChange={v => up({ paymentGateway: v })} />
              </>
            )}
            <ToggleRow label="Hosting / Domain support" checked={s.hostingSupport} onChange={v => up({ hostingSupport: v })} />
            <ToggleRow label="Mirëmbajtje mujore" checked={s.maintenanceMonthly} onChange={v => up({ maintenanceMonthly: v })} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ 4. SEO ═══ */
export function SeoSection({ sel, update }: SectionProps) {
  const s = sel.seo;
  const up = (patch: Partial<typeof s>) => update(prev => ({ ...prev, seo: { ...prev.seo, ...patch } }));

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Search} title="SEO" color="bg-green-600"
        enabled={s.enabled} onToggle={() => up({ enabled: !s.enabled })}
      />
      {s.enabled && (
        <div className="pl-12 space-y-1 animate-in fade-in slide-in-from-top-2 duration-200">
          <FieldRow label="Artikuj blog / muaj">
            <NumberInput value={s.blogArticlesPerMonth} onChange={v => up({ blogArticlesPerMonth: v })} />
          </FieldRow>
          <FieldRow label="Faqe target">
            <NumberInput value={s.targetPages} onChange={v => up({ targetPages: v })} />
          </FieldRow>
          <div className="border-t pt-3 mt-3 space-y-1">
            <ToggleRow label="SEO Audit" checked={s.seoAudit} onChange={v => up({ seoAudit: v })} />
            <ToggleRow label="On-page SEO" checked={s.onPageSeo} onChange={v => up({ onPageSeo: v })} />
            <ToggleRow label="Technical SEO" checked={s.technicalSeo} onChange={v => up({ technicalSeo: v })} />
            <ToggleRow label="Local SEO" checked={s.localSeo} onChange={v => up({ localSeo: v })} />
            <ToggleRow label="Keyword research" checked={s.keywordResearch} onChange={v => up({ keywordResearch: v })} />
            <ToggleRow label="Backlink outreach" checked={s.backlinkOutreach} onChange={v => up({ backlinkOutreach: v })} />
            <ToggleRow label="Raportim mujor" checked={s.monthlyReporting} onChange={v => up({ monthlyReporting: v })} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ 5. BRANDING ═══ */
export function BrandingSection({ sel, update }: SectionProps) {
  const s = sel.branding;
  const up = (patch: Partial<typeof s>) => update(prev => ({ ...prev, branding: { ...prev.branding, ...patch } }));

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Palette} title="Branding / Graphic Design" color="bg-orange-500"
        enabled={s.enabled} onToggle={() => up({ enabled: !s.enabled })}
      />
      {s.enabled && (
        <div className="pl-12 space-y-1 animate-in fade-in slide-in-from-top-2 duration-200">
          <ToggleRow label="Logo design" checked={s.logoDesign} onChange={v => up({ logoDesign: v })} />
          <ToggleRow label="Brand guidelines" checked={s.brandGuidelines} onChange={v => up({ brandGuidelines: v })} />
          <ToggleRow label="Social media templates" checked={s.socialMediaTemplates} onChange={v => up({ socialMediaTemplates: v })} />
          <ToggleRow label="Print materials" checked={s.printMaterials} onChange={v => up({ printMaterials: v })} />
          <ToggleRow label="Presentation design" checked={s.presentationDesign} onChange={v => up({ presentationDesign: v })} />
          <FieldRow label="Kërkesa shtesë design / muaj">
            <NumberInput value={s.extraDesignRequestsPerMonth} onChange={v => up({ extraDesignRequestsPerMonth: v })} />
          </FieldRow>
        </div>
      )}
    </div>
  );
}

/* ═══ 6. CONTENT PRODUCTION ═══ */
export function ContentProductionSection({ sel, update }: SectionProps) {
  const s = sel.contentProduction;
  const up = (patch: Partial<typeof s>) => update(prev => ({ ...prev, contentProduction: { ...prev.contentProduction, ...patch } }));

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Camera} title="Content Production" color="bg-rose-500"
        enabled={s.enabled} onToggle={() => up({ enabled: !s.enabled })}
      />
      {s.enabled && (
        <div className="pl-12 space-y-1 animate-in fade-in slide-in-from-top-2 duration-200">
          <ToggleRow label="Photo shoot" checked={s.photoShoot} onChange={v => up({ photoShoot: v })} />
          <ToggleRow label="Video shoot" checked={s.videoShoot} onChange={v => up({ videoShoot: v })} />
          <ToggleRow label="Reel production" checked={s.reelProduction} onChange={v => up({ reelProduction: v })} />
          <ToggleRow label="Script writing" checked={s.scriptWriting} onChange={v => up({ scriptWriting: v })} />
          <ToggleRow label="Editing only" checked={s.editingOnly} onChange={v => up({ editingOnly: v })} />
          <ToggleRow label="Travel fee" checked={s.travelFee} onChange={v => up({ travelFee: v })} />
          <ToggleRow label="Equipment fee" checked={s.equipmentFee} onChange={v => up({ equipmentFee: v })} />
          <FieldRow label="Orë në lokacion">
            <NumberInput value={s.onSiteHours} onChange={v => up({ onSiteHours: v })} />
          </FieldRow>
          <FieldRow label="Deliverables">
            <NumberInput value={s.deliverables} onChange={v => up({ deliverables: v })} />
          </FieldRow>
        </div>
      )}
    </div>
  );
}

/* ═══ 7. ADD-ONS ═══ */
export function AddOnsSection({ sel, update }: SectionProps) {
  const s = sel.addOns;
  const up = (patch: Partial<typeof s>) => update(prev => ({ ...prev, addOns: { ...prev.addOns, ...patch } }));

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Plus} title="Add-ons / Extra" color="bg-gray-600"
        enabled={
          s.rushDelivery || s.dedicatedAccountManager || s.competitorAnalysis ||
          s.advancedReporting || s.strategySession || s.extraRevisions > 0 || s.monthlyConsultingHours > 0
        }
        onToggle={() => {
          // Toggle all off
          up({
            rushDelivery: false, extraRevisions: 0, dedicatedAccountManager: false,
            competitorAnalysis: false, advancedReporting: false, strategySession: false,
            monthlyConsultingHours: 0,
          });
        }}
      />
      <div className="pl-12 space-y-1">
        <ToggleRow label="Rush delivery" checked={s.rushDelivery} onChange={v => up({ rushDelivery: v })} />
        <ToggleRow label="Account manager i dedikuar" checked={s.dedicatedAccountManager} onChange={v => up({ dedicatedAccountManager: v })} />
        <ToggleRow label="Analizë konkurrentësh" checked={s.competitorAnalysis} onChange={v => up({ competitorAnalysis: v })} />
        <ToggleRow label="Raportim i avancuar" checked={s.advancedReporting} onChange={v => up({ advancedReporting: v })} />
        <ToggleRow label="Strategy session" checked={s.strategySession} onChange={v => up({ strategySession: v })} />
        <FieldRow label="Revizione shtesë">
          <NumberInput value={s.extraRevisions} onChange={v => up({ extraRevisions: v })} />
        </FieldRow>
        <FieldRow label="Orë konsulenze / muaj">
          <NumberInput value={s.monthlyConsultingHours} onChange={v => up({ monthlyConsultingHours: v })} />
        </FieldRow>
      </div>
    </div>
  );
}
