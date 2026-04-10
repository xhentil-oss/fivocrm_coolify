/* ═══════════════════════════════════════════════════════════════════════
   Marketing Agency Price Calculator — Main View
   ═══════════════════════════════════════════════════════════════════════ */

import { useState, useMemo, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Input } from '../components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
import { Calculator, Settings, Globe, DollarSign } from 'lucide-react';
import {
  SocialMediaSection, PaidAdsSection, WebDesignSection,
  SeoSection, BrandingSection, ContentProductionSection, AddOnsSection,
} from '../components/calculator/ServiceSections';
import PriceSummary from '../components/calculator/PriceSummary';
import CalculatorSettingsPanel from '../components/calculator/CalculatorSettings';
import { DEFAULT_SELECTIONS, loadSettings, saveSettings, resetSettings } from '../lib/calculator/defaults';
import { calculate } from '../lib/calculator/calculations';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { toast } from '../hooks/use-toast';
import type { CalculatorSelections, CalculatorSettings as SettingsType, Market, Currency } from '../lib/calculator/types';
import type { Lead, Customer, Quote } from '../types';

export default function PriceCalculatorView() {
  const [sel, setSel] = useState<CalculatorSelections>(() => structuredClone(DEFAULT_SELECTIONS));
  const [settings, setSettings] = useState<SettingsType>(() => loadSettings());
  const [activeTab, setActiveTab] = useState('calculator');
  const [linkType, setLinkType] = useState<'lead' | 'customer'>('lead');
  const [linkedId, setLinkedId] = useState('');

  const { data: leads } = useCollection<Lead>('leads');
  const { data: customers } = useCollection<Customer>('customers');
  const quoteMutation = useMutation<Quote>('quotes');

  const result = useMemo(() => calculate(sel, settings), [sel, settings]);

  const updateSel: (fn: (prev: CalculatorSelections) => CalculatorSelections) => void = useCallback(
    fn => setSel(prev => fn(prev)),
    [],
  );

  const handleReset = () => setSel(structuredClone(DEFAULT_SELECTIONS));

  const handleSaveQuote = async () => {
    // Find linked entity name
    const linkedLead = linkType === 'lead' && linkedId ? leads?.find(l => l.id === linkedId) : null;
    const linkedCustomer = linkType === 'customer' && linkedId ? customers?.find(c => c.id === linkedId) : null;

    try {
      await quoteMutation.create({
        leadId: linkedLead ? linkedId : undefined,
        customerId: linkedCustomer ? linkedId : undefined,
        leadName: linkedLead?.name,
        customerName: linkedCustomer?.name,
        label: result.suggestedLabel,
        currency: sel.currency,
        market: sel.market,
        selections: sel as any,
        result: {
          categories: result.categories,
          subtotalOneTime: result.subtotalOneTime,
          subtotalMonthly: result.subtotalMonthly,
          totalOneTime: result.totalOneTime,
          totalMonthly: result.totalMonthly,
          grandTotal: result.grandTotal,
          suggestedLabel: result.suggestedLabel,
          enabledServicesCount: result.enabledServicesCount,
          bundleDiscountAmount: result.bundleDiscountAmount,
          bundleDiscountLabel: result.bundleDiscountLabel,
          manualDiscountAmount: result.manualDiscountAmount,
        },
        status: 'Draft',
      } as any);
      toast({ title: 'Preventivi u ruajt!', description: linkedLead ? `Lidhur me lead: ${linkedLead.name}` : linkedCustomer ? `Lidhur me klient: ${linkedCustomer.name}` : 'Pa lidhje me lead/klient' });
    } catch (err: any) {
      toast({ title: 'Gabim', description: err.message, variant: 'destructive' });
    }
  };

  const handleSaveSettings = (s: SettingsType) => {
    setSettings(s);
    saveSettings(s);
  };

  const handleResetSettings = () => {
    const fresh = resetSettings();
    setSettings(fresh);
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white">
        <div className="px-6 py-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
                  <Calculator className="w-5 h-5 text-white" />
                </div>
                Price Calculator
              </h1>
              <p className="text-sm text-gray-500 mt-1">Konfiguro shërbimet dhe gjenero çmimin automatikisht</p>
            </div>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid grid-cols-2 w-64">
                <TabsTrigger value="calculator" className="flex items-center gap-1.5 text-xs">
                  <Calculator className="w-3.5 h-3.5" /> Calculator
                </TabsTrigger>
                <TabsTrigger value="settings" className="flex items-center gap-1.5 text-xs">
                  <Settings className="w-3.5 h-3.5" /> Settings
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </div>

      {activeTab === 'calculator' ? (
        <div className="px-6 py-6">
          {/* Market & Currency & Link controls */}
          <div className="flex flex-wrap items-center gap-4 mb-6 p-4 bg-white rounded-xl border border-gray-200">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-gray-400" />
              <Select value={sel.market} onValueChange={(v: Market) => setSel(prev => ({ ...prev, market: v }))}>
                <SelectTrigger className="w-44 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="albania">🇦🇱 Albania</SelectItem>
                  <SelectItem value="international">🌍 International</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-gray-400" />
              <Select value={sel.currency} onValueChange={(v: Currency) => setSel(prev => ({ ...prev, currency: v }))}>
                <SelectTrigger className="w-32 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">ALL (Lek)</SelectItem>
                  <SelectItem value="EUR">EUR (€)</SelectItem>
                  <SelectItem value="USD">USD ($)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Lead / Customer linker */}
            <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
              <Select value={linkType} onValueChange={(v: 'lead' | 'customer') => { setLinkType(v); setLinkedId(''); }}>
                <SelectTrigger className="w-28 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="customer">Klient</SelectItem>
                </SelectContent>
              </Select>
              <Select value={linkedId || '__none__'} onValueChange={v => setLinkedId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="w-48 h-9 text-sm">
                  <SelectValue placeholder={linkType === 'lead' ? 'Zgjidh lead...' : 'Zgjidh klient...'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Asnjë</SelectItem>
                  {linkType === 'lead'
                    ? (leads || []).map(l => <SelectItem key={l.id} value={l.id}>{l.name}{l.company ? ` — ${l.company}` : ''}</SelectItem>)
                    : (customers || []).map(c => <SelectItem key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</SelectItem>)
                  }
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <label className="text-xs text-gray-500">Zbritje %</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={sel.discountPercent || ''}
                onChange={e => setSel(prev => ({ ...prev, discountPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) }))}
                className="h-9 w-20 text-sm"
                placeholder="0"
              />
              <label className="text-xs text-gray-500">Fixed</label>
              <Input
                type="number"
                min={0}
                value={sel.discountFixed || ''}
                onChange={e => setSel(prev => ({ ...prev, discountFixed: Math.max(0, Number(e.target.value) || 0) }))}
                className="h-9 w-24 text-sm"
                placeholder="0"
              />
            </div>
          </div>

          {/* Two-column layout */}
          <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
            {/* Left: Service Configurator */}
            <div className="space-y-4">
              {[
                SocialMediaSection,
                PaidAdsSection,
                WebDesignSection,
                SeoSection,
                BrandingSection,
                ContentProductionSection,
                AddOnsSection,
              ].map((Section, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
                  <Section sel={sel} update={updateSel} />
                </div>
              ))}
            </div>

            {/* Right: Sticky Summary */}
            <div className="lg:sticky lg:top-20">
              <PriceSummary
                result={result}
                currency={sel.currency}
                sel={sel}
                onReset={handleReset}
                onSaveQuote={handleSaveQuote}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="px-6 py-6 max-w-4xl">
          <CalculatorSettingsPanel
            settings={settings}
            onSave={handleSaveSettings}
            onReset={handleResetSettings}
          />
        </div>
      )}
    </div>
  );
}
