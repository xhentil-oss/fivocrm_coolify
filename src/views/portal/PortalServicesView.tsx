import React, { useMemo, useState } from 'react';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useCollection } from '../../hooks/useFirestore';
import { useStartInquiry } from '../../hooks/useStartInquiry';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ShoppingBag, Tag, DollarSign, FileText, Clock, Star, Check, TrendingUp, Megaphone, Navigation, Sparkles, Globe, Search } from 'lucide-react';
import { CardGridSkeleton } from './PortalSkeletons';
import { sanitizeHtml, currencySymbol } from '../../lib/utils';
import type { Invoice, InvoiceItem, Service } from '../../types';

// Per-category icon + color for the catalog cards. Unknown categories fall back
// to a neutral bag icon.
const CATEGORY_VISUALS: Record<string, { Icon: any; box: string }> = {
  'Web Design': { Icon: Navigation, box: 'bg-accent-soft text-primary dark:bg-primary/10 dark:text-primary' },
  'SEO': { Icon: TrendingUp, box: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300' },
  'Social Media': { Icon: Megaphone, box: 'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-300' },
  'Marketing': { Icon: Sparkles, box: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300' },
  'Website': { Icon: Globe, box: 'bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-300' },
};
function serviceVisual(category?: string) {
  return (category && CATEGORY_VISUALS[category]) || { Icon: ShoppingBag, box: 'bg-primary/10 text-primary' };
}

/**
 * FLOW I RI:
 * "Kërko këtë shërbim" NUK hap më dialog. Krijon një kërkesë (serviceInquiry) në
 * gjendjen 'Draft' dhe të çon te faqja e anketës brenda Projekteve:
 *   /portal/projects/inquiry/:inquiryId
 * Klienti e plotëson anketën atje; kërkesa shfaqet edhe te tab-i Projektet.
 */
const PortalServicesView: React.FC = () => {
  const { customerId, businessId: portalBusinessId } = useClientPortal();
  const startInquiry = useStartInquiry();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const { data: invoices } = useCollection<Invoice>('invoices', {
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });
  const { data: invoiceItems } = useCollection<InvoiceItem>('invoiceItems', {
    skip: !customerId,
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });
  const { data: services, loading } = useCollection<Service>('services', {
    // The service catalogue is tenant data: scope it to the client's OWN business.
    // Reading it unscoped (the old `skipTeamFilter` behaviour) returned every
    // tenant's catalogue and pricing to any signed-in client.
    skip: !portalBusinessId,
    where: portalBusinessId ? [{ field: 'businessId', operator: '==', value: portalBusinessId }] : undefined,
    skipTeamFilter: true,
    skipBusinessFilter: true,
  });

  const purchasedServiceDetails = useMemo(() => {
    if (!invoices || !invoiceItems || !services) return [];
    const invoiceIds = new Set(invoices.map(i => i.id));
    const myItems = invoiceItems.filter(item => invoiceIds.has(item.invoiceId));
    const serviceMap = new Map<string, { service: Service; totalSpent: number; invoiceCount: number; lastPurchase: Date | null }>();
    myItems.forEach(item => {
      if (!item.serviceId) return;
      const service = services.find(s => s.id === item.serviceId);
      if (!service) return;
      const existing = serviceMap.get(service.id);
      const invoice = invoices.find(i => i.id === item.invoiceId);
      const invoiceDate = invoice?.createdAt instanceof Date ? invoice.createdAt : null;
      if (existing) {
        existing.totalSpent += item.totalPrice;
        existing.invoiceCount += 1;
        if (invoiceDate && (!existing.lastPurchase || invoiceDate > existing.lastPurchase)) existing.lastPurchase = invoiceDate;
      } else {
        serviceMap.set(service.id, { service, totalSpent: item.totalPrice, invoiceCount: 1, lastPurchase: invoiceDate });
      }
    });
    return Array.from(serviceMap.values()).sort((a, b) => b.totalSpent - a.totalSpent);
  }, [invoices, invoiceItems, services]);

  const allServices = services || [];

  const categories = useMemo(() => {
    const set = new Set<string>();
    allServices.forEach(s => { if (s.category) set.add(s.category); });
    return Array.from(set).sort();
  }, [allServices]);

  const filteredServices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allServices.filter(s => {
      if (categoryFilter !== 'all' && s.category !== categoryFilter) return false;
      if (q) {
        const hay = `${s.title || ''} ${s.name || ''} ${s.category || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allServices, search, categoryFilter]);

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="space-y-2">
          <div className="h-8 w-40 rounded-md bg-muted animate-pulse" />
          <div className="h-4 w-72 rounded-md bg-muted animate-pulse" />
        </div>
        <CardGridSkeleton count={6} />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Shërbimet</h1>
        <p className="text-muted-foreground mt-2 text-[15px]">
          Shërbimet tuaja të blera dhe katalogu i shërbimeve
        </p>
      </div>

      {/* Purchased Services */}
      <div>
        <div className="flex items-center gap-2.5 mb-4">
          <h2 className="text-lg font-semibold tracking-tight">Shërbimet e Blera</h2>
          <span className="text-xs font-semibold text-muted-foreground bg-muted rounded-full px-2.5 py-0.5">{purchasedServiceDetails.length}</span>
        </div>
        {purchasedServiceDetails.length === 0 ? (
          <Card className="rounded-2xl border-border/80">
            <CardContent className="py-14 text-center">
              <div className="mx-auto mb-4 flex h-[74px] w-[74px] items-center justify-center rounded-2xl bg-primary/10">
                <ShoppingBag className="h-8 w-8 text-primary" />
              </div>
              <h3 className="font-semibold text-lg">Nuk keni blerë asnjë shërbim akoma</h3>
              <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground leading-relaxed">
                Shfletoni katalogun më poshtë dhe kërkoni shërbimin që i përshtatet biznesit tuaj — ekipi ynë ju kontakton menjëherë.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {purchasedServiceDetails.map(({ service, totalSpent, invoiceCount, lastPurchase }) => {
              const vis = serviceVisual(service.category);
              const Icon = vis.Icon;
              return (
              <Card key={service.id} className="rounded-2xl transition-all hover:-translate-y-1 hover:shadow-md">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <div className={`p-2.5 rounded-xl flex-shrink-0 ${vis.box}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate">{service.title || service.name}</h3>
                      {service.description && (
                        <div className="text-sm text-muted-foreground mt-1 line-clamp-2 prose prose-sm dark:prose-invert max-w-none"
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(service.description) }} />
                      )}
                      <div className="flex flex-wrap gap-2 mt-3">
                        {service.category && (
                          <Badge variant="secondary" className="gap-1 rounded-full"><Tag className="h-3 w-3" />{service.category}</Badge>
                        )}
                        <Badge variant="outline" className="gap-1 rounded-full"><DollarSign className="h-3 w-3" />{totalSpent.toLocaleString()} {currencySymbol(service.currency)}</Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                        <span>{invoiceCount} faturë</span>
                        {lastPurchase && <span>Blerje e fundit: {lastPurchase.toLocaleDateString('sq-AL')}</span>}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Service Catalog */}
      <div>
        <div className="flex items-center gap-2.5 mb-4">
          <h2 className="text-lg font-semibold tracking-tight">Katalogu i Shërbimeve</h2>
          <span className="text-xs font-semibold text-muted-foreground bg-muted rounded-full px-2.5 py-0.5">{allServices.length}</span>
        </div>

        {/* Search + category filter */}
        {allServices.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-3 mb-5">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Kërko shërbim..."
                className="pl-9"
              />
            </div>
            {categories.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mb-1">
                <button
                  onClick={() => setCategoryFilter('all')}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                    categoryFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  }`}
                >
                  Të gjitha
                </button>
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                      categoryFilter === cat ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {allServices.length === 0 ? (
          <Card className="rounded-2xl">
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">Nuk ka shërbime në katalog</p>
            </CardContent>
          </Card>
        ) : filteredServices.length === 0 ? (
          <Card className="rounded-2xl">
            <CardContent className="py-12 text-center">
              <Search className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-muted-foreground">Asnjë shërbim nuk përputhet me kërkimin</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
            {filteredServices.map((service) => {
              const isPurchased = purchasedServiceDetails.some(p => p.service.id === service.id);
              // "Më e zgjedhura" is driven by the real `featured` flag (set by admin).
              const isPopular = (service as any).featured === true;
              const vis = serviceVisual(service.category);
              const Icon = vis.Icon;
              const features: string[] = Array.isArray((service as any).features) ? (service as any).features : [];
              const duration = (service as any).duration as string | undefined;
              const period = (service as any).billingPeriod as string | undefined;
              return (
                <Card key={service.id}
                  className={`group relative flex flex-col overflow-hidden rounded-2xl border-border/80 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_18px_44px_-20px_rgba(80,50,160,0.28)] ${isPopular ? 'ring-1 ring-primary/60' : ''}`}>
                  <div className="h-1 bg-brand-gradient" />
                  {isPopular && (
                    <span className="absolute top-4 right-4 z-10 inline-flex items-center gap-1 rounded-full bg-brand-gradient px-2.5 py-1 text-[11.5px] font-semibold text-white shadow-md shadow-primary/40">
                      <Star className="w-3 h-3 fill-current" />Më e zgjedhura
                    </span>
                  )}
                  <CardContent className="p-6 flex flex-col flex-1">
                    <div className="flex items-start justify-between mb-4">
                      <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${vis.box}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      {!isPopular && service.category && (
                        <Badge variant="secondary" className="gap-1 rounded-full"><Tag className="h-3 w-3" />{service.category}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-lg tracking-tight">{service.title || service.name}</h3>
                      {isPurchased && <Badge className="bg-primary/10 text-primary text-xs rounded-full">Aktiv</Badge>}
                    </div>
                    {service.description && (
                      <div className="text-sm text-muted-foreground mt-1.5 line-clamp-3 prose prose-sm dark:prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(service.description) }} />
                    )}

                    {features.length > 0 && (
                      <ul className="mt-3 space-y-1.5">
                        {features.slice(0, 6).map((f, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                            <span className="text-foreground/80">{f}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="mt-auto pt-5">
                      <div className="h-px bg-border mb-4" />
                      <div className="flex items-end justify-between mb-4 gap-2">
                        <div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-2xl font-bold font-mono tracking-tight">{(service.price ?? 0).toLocaleString()}</span>
                            <span className="text-sm font-semibold text-muted-foreground">{currencySymbol(service.currency)}</span>
                          </div>
                          {period && <div className="text-xs text-muted-foreground mt-0.5">{period}</div>}
                        </div>
                        {duration && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground whitespace-nowrap flex-shrink-0">
                            <Clock className="h-3 w-3" />{duration}
                          </span>
                        )}
                      </div>
                      <Button variant={isPopular ? 'default' : 'outline'} size="sm"
                        className={`w-full gap-1.5 rounded-xl ${isPopular ? 'bg-brand-gradient text-white shadow-md shadow-primary/25 hover:opacity-95' : 'hover:bg-brand-gradient hover:text-white hover:border-transparent'}`}
                        onClick={() => startInquiry(service)}>
                        <FileText className="w-3.5 h-3.5" />Kërko këtë shërbim
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default PortalServicesView;
