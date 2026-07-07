import React, { useState, useCallback } from 'react';
import { useClientPortal } from '../../hooks/useClientPortal';
import { usePortalTenant } from '../../hooks/usePortalTenant';
import { useAuth } from '../../contexts/AuthContext';
import { useCollection, useMutation } from '../../hooks/useFirestore';
import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { getStatusColor } from '../../lib/statusColors';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { ShoppingBag, Tag, DollarSign, FileText, CheckCircle2, Eye, Edit3, Send, Clock, Star, Check, TrendingUp, Megaphone, Navigation, Sparkles, Globe } from 'lucide-react';
import { sanitizeHtml } from '../../lib/utils';
import { useToast } from '../../hooks/use-toast';
import ServiceQuestionnaireForm from '../../components/ServiceQuestionnaireForm';
import type { Invoice, InvoiceItem, Service, ServiceInquiry, Notification } from '../../types';

// Per-category icon + color for the catalog cards. Unknown categories fall back
// to a neutral bag icon.
const CATEGORY_VISUALS: Record<string, { Icon: any; box: string }> = {
  'Web Design': { Icon: Navigation, box: 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300' },
  'SEO': { Icon: TrendingUp, box: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300' },
  'Social Media': { Icon: Megaphone, box: 'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-300' },
  'Marketing': { Icon: Sparkles, box: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300' },
  'Website': { Icon: Globe, box: 'bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-300' },
};
function serviceVisual(category?: string) {
  return (category && CATEGORY_VISUALS[category]) || { Icon: ShoppingBag, box: 'bg-primary/10 text-primary' };
}

const PortalServicesView: React.FC = () => {
  const { user } = useAuth();
  const { customerId } = useClientPortal();
  const { tenantBusinessId } = usePortalTenant();
  const { toast } = useToast();
  const [isQuestionnaireOpen, setIsQuestionnaireOpen] = useState(false);
  const [preselectedService, setPreselectedService] = useState<string | undefined>();
  const [showSuccess, setShowSuccess] = useState(false);
  const [editingInquiry, setEditingInquiry] = useState<ServiceInquiry | null>(null);
  const [viewingInquiry, setViewingInquiry] = useState<ServiceInquiry | null>(null);

  const { data: invoices } = useCollection<Invoice>('invoices', {
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });

  const { data: invoiceItems } = useCollection<InvoiceItem>('invoiceItems', {
    skip: !customerId,
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });
  const { data: services, loading } = useCollection<Service>('services', { skipTeamFilter: true });

  // Fetch client's own inquiries
  const { data: myInquiries } = useCollection<ServiceInquiry>('serviceInquiries', {
    where: user?.uid ? [{ field: 'clientUserId', operator: '==', value: user.uid }] : [],
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });

  // Mutations for CRM automation
  const inquiryMutation = useMutation<ServiceInquiry>('serviceInquiries');
  const notificationMutation = useMutation<Notification>('notifications');
  const { data: activeTeamMembers } = useCollection<any>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
    skipTeamFilter: true,
  });
  const resolvedTeamId = activeTeamMembers?.find((m: any) => m.teamId)?.teamId || null;

  // Handle questionnaire submission with CRM automations
  const handleQuestionnaireSubmit = async (formData: any) => {
    if (editingInquiry) {
      await inquiryMutation.update(editingInquiry.id, {
        ...formData,
        status: editingInquiry.status === 'Draft' ? 'New' : editingInquiry.status,
        isDraft: false,
        clientUserId: user?.uid || undefined,
      });

      if (editingInquiry.status === 'Draft') {
        await createLeadAndAutomations(formData, editingInquiry.id);
      }

      setEditingInquiry(null);
      setIsQuestionnaireOpen(false);
      setShowSuccess(true);
      toast({
        title: editingInquiry.status === 'Draft' ? 'Kërkesa u dërgua me sukses!' : 'Kërkesa u përditësua!',
        description: 'Ekipi ynë do t\'ju kontaktojë së shpejti.',
      });
      return;
    }

    const inquiryRef = await addDoc(collection(db, 'serviceInquiries'), {
      ...formData,
      status: 'New',
      isDraft: false,
      customerId: customerId || undefined,
      clientUserId: user?.uid || undefined,
      ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdByUserId: user?.uid || null,
    });
    const inquiry = { id: inquiryRef.id };

    await createLeadAndAutomations(formData, inquiry.id);

    setIsQuestionnaireOpen(false);
    setShowSuccess(true);
    toast({
      title: 'Formulari u dërgua me sukses!',
      description: 'Ekipi ynë do t\'ju kontaktojë së shpejti.',
    });
  };

  const handleDraftSave = useCallback(async (formData: any, step: number) => {
    if (editingInquiry?.status === 'Draft') {
      await inquiryMutation.update(editingInquiry.id, {
        ...formData,
        lastSavedStep: step,
        isDraft: true,
        status: 'Draft',
      });
    }
  }, [editingInquiry, inquiryMutation]);

  const createLeadAndAutomations = async (formData: any, inquiryId: string) => {
    const existingLeads = myInquiries?.find(i => i.id === inquiryId && (i as any).leadId);
    if (existingLeads) return;

    const tags: string[] = [];
    if (formData.servicesInterestedIn.includes('Web Design')) tags.push('Web Design Lead');
    if (formData.servicesInterestedIn.includes('Social Media Marketing')) tags.push('SMM Lead');
    if (formData.servicesInterestedIn.includes('Paid Ads')) tags.push('Ads Lead');
    if (['100,000–300,000 L', '300,000+ L'].includes(formData.budgetRange)) tags.push('High Value Lead');
    if (formData.timeline === 'Menjëherë') tags.push('Urgent Lead');

    let estimatedValue = 0;
    if (formData.budgetRange === 'Nën 30,000 L') estimatedValue = 20000;
    else if (formData.budgetRange === '30,000–50,000 L') estimatedValue = 40000;
    else if (formData.budgetRange === '50,000–100,000 L') estimatedValue = 75000;
    else if (formData.budgetRange === '100,000–300,000 L') estimatedValue = 200000;
    else if (formData.budgetRange === '300,000+ L') estimatedValue = 400000;

    const leadData: Record<string, any> = {
      name: formData.contactName,
      email: formData.email,
      phoneNumber: formData.phoneNumber,
      company: formData.businessName,
      status: 'New',
      source: 'Service Questionnaire',
      estimatedValue,
      tags,
      notes: `Shërbime: ${formData.servicesInterestedIn.join(', ')}\nObjektivi: ${formData.mainGoal}\nBuxheti: ${formData.budgetRange}\nAfati: ${formData.timeline}\n\nPërshkrimi: ${formData.projectNeedDescription}\nSfida: ${formData.currentMainChallenge}`,
      serviceInquiryId: inquiryId,
      ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdByUserId: user?.uid || null,
    };
    if (formData.jobTitle) leadData.jobTitle = formData.jobTitle;
    if (formData.website) leadData.website = formData.website;
    const leadRef = await addDoc(collection(db, 'leads'), leadData);
    const lead = { id: leadRef.id };

    await inquiryMutation.update(inquiryId, { leadId: lead.id });

    const taskPriority = formData.timeline === 'Menjëherë' || formData.isUrgent === 'Po' ? 'urgent' : 'high';
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const salesAdminMembers = activeTeamMembers?.filter((m: any) => (m.role === 'Admin' || m.canAccessCRM) && (!tenantBusinessId || m.businessId === tenantBusinessId)) || [];

    await addDoc(collection(db, 'tasks'), {
      title: `Kontakto lead: ${formData.contactName} (${formData.businessName})`,
      description: `Lead i ri nga pyetësori i shërbimeve.\n\nShërbime: ${formData.servicesInterestedIn.join(', ')}\nObjektivi: ${formData.mainGoal}\nBuxheti: ${formData.budgetRange}\nAfati: ${formData.timeline}\nKontakt: ${formData.email} / ${formData.phoneNumber}${formData.preferredContactMethod ? '\nMënyra e preferuar: ' + formData.preferredContactMethod : ''}`,
      status: 'Todo',
      priority: taskPriority,
      startDate: new Date(),
      endDate: tomorrow,
      dueDate: tomorrow,
      assignedToUserId: salesAdminMembers?.[0]?.userId || '',
      ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdByUserId: user?.uid || null,
    });

    if (salesAdminMembers.length > 0) {
      await Promise.all(
        salesAdminMembers.map((m: any) => notificationMutation.create({
          userId: m.userId,
          type: 'lead_created',
          title: 'Lead i Ri nga Pyetësori',
          message: `${formData.contactName} (${formData.businessName}) dorëzoi pyetësorin për: ${formData.servicesInterestedIn.join(', ')}`,
          isRead: false,
        }))
      );
    }
  };

  const openQuestionnaire = (serviceCategory?: string) => {
    setPreselectedService(serviceCategory);
    setShowSuccess(false);
    setEditingInquiry(null);
    setIsQuestionnaireOpen(true);
  };

  const openEditInquiry = (inquiry: ServiceInquiry) => {
    setEditingInquiry(inquiry);
    setPreselectedService(undefined);
    setShowSuccess(false);
    setIsQuestionnaireOpen(true);
  };

  const openViewInquiry = (inquiry: ServiceInquiry) => {
    setViewingInquiry(inquiry);
  };

  const purchasedServiceDetails = React.useMemo(() => {
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
        if (invoiceDate && (!existing.lastPurchase || invoiceDate > existing.lastPurchase)) {
          existing.lastPurchase = invoiceDate;
        }
      } else {
        serviceMap.set(service.id, {
          service,
          totalSpent: item.totalPrice,
          invoiceCount: 1,
          lastPurchase: invoiceDate,
        });
      }
    });

    return Array.from(serviceMap.values()).sort((a, b) => b.totalSpent - a.totalSpent);
  }, [invoices, invoiceItems, services]);

  const allServices = services || [];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground">Duke ngarkuar shërbimet...</div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Shërbimet</h1>
          <p className="text-muted-foreground mt-2 text-[15px]">
            Shërbimet tuaja të blera dhe katalogu i shërbimeve
          </p>
        </div>
        <Button onClick={() => openQuestionnaire()} className="gap-2 rounded-xl bg-brand-gradient shadow-lg shadow-primary/25 hover:opacity-95 transition">
          <FileText className="w-4 h-4" />
          Kërko Shërbim
        </Button>
      </div>

      {/* Success message */}
      {showSuccess && (
        <Card className="border-green-200 bg-green-50 rounded-2xl dark:bg-green-950/20 dark:border-green-800/40">
          <CardContent className="py-6 flex items-center gap-4">
            <CheckCircle2 className="w-8 h-8 text-green-600 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-green-800 dark:text-green-300">Formulari u dërgua me sukses!</h3>
              <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                Ekipi ynë do të shqyrtojë kërkesën tuaj dhe do t'ju kontaktojë brenda 24 orëve.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* My Inquiries */}
      {myInquiries && myInquiries.length > 0 && (
        <div>
          <div className="flex items-center gap-2.5 mb-4">
            <h2 className="text-lg font-semibold tracking-tight">Kërkesat e Mia</h2>
            <span className="text-xs font-semibold text-muted-foreground bg-muted rounded-full px-2.5 py-0.5">{myInquiries.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {myInquiries.map(inquiry => {
              const statusConfig: Record<string, { label: string; color: string }> = {
                'Draft': { label: 'Draft', color: getStatusColor('Draft') },
                'New': { label: 'Dërguar', color: getStatusColor('New') },
                'Reviewed': { label: 'Në Shqyrtim', color: getStatusColor('Reviewed') },
                'Converted': { label: 'Konvertuar', color: getStatusColor('Converted') },
              };
              const status = statusConfig[inquiry.status] || statusConfig['New'];
              const createdDate = inquiry.createdAt instanceof Date
                ? inquiry.createdAt.toLocaleDateString('sq-AL')
                : '';
              return (
                <Card key={inquiry.id} className="rounded-2xl transition-all hover:-translate-y-1 hover:shadow-md">
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold truncate">{inquiry.businessName || 'Kërkesë pa titull'}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status.color}`}>{status.label}</span>
                        </div>
                        {inquiry.servicesInterestedIn && inquiry.servicesInterestedIn.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {inquiry.servicesInterestedIn.map(s => (
                              <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                            ))}
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {createdDate}
                          {inquiry.budgetRange && ` · ${inquiry.budgetRange}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      {inquiry.status === 'Draft' ? (
                        <Button size="sm" className="gap-1 flex-1 rounded-xl" onClick={() => openEditInquiry(inquiry)}>
                          <Send className="w-3.5 h-3.5" />
                          Vazhdo & Dërgo
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" className="gap-1 flex-1 rounded-xl" onClick={() => openViewInquiry(inquiry)}>
                            <Eye className="w-3.5 h-3.5" />
                            Shiko
                          </Button>
                          {inquiry.status === 'New' && (
                            <Button size="sm" variant="outline" className="gap-1 rounded-xl" onClick={() => openEditInquiry(inquiry)}>
                              <Edit3 className="w-3.5 h-3.5" />
                              Edito
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

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
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(service.description) }}
                        />
                      )}
                      <div className="flex flex-wrap gap-2 mt-3">
                        {service.category && (
                          <Badge variant="secondary" className="gap-1 rounded-full">
                            <Tag className="h-3 w-3" />
                            {service.category}
                          </Badge>
                        )}
                        <Badge variant="outline" className="gap-1 rounded-full">
                          <DollarSign className="h-3 w-3" />
                          {totalSpent.toLocaleString()} {service.currency || 'ALL'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                        <span>{invoiceCount} faturë</span>
                        {lastPurchase && (
                          <span>Blerje e fundit: {lastPurchase.toLocaleDateString('sq-AL')}</span>
                        )}
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
        {allServices.length === 0 ? (
          <Card className="rounded-2xl">
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">Nuk ka shërbime në katalog</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
            {allServices.map((service) => {
              const isPurchased = purchasedServiceDetails.some(p => p.service.id === service.id);
              // "Më e zgjedhura" is driven by the real `featured` flag (set by admin).
              const isPopular = (service as any).featured === true;
              const vis = serviceVisual(service.category);
              const Icon = vis.Icon;
              const features: string[] = Array.isArray((service as any).features) ? (service as any).features : [];
              const duration = (service as any).duration as string | undefined;
              const period = (service as any).billingPeriod as string | undefined;
              return (
                <Card
                  key={service.id}
                  className={`group relative flex flex-col overflow-hidden rounded-2xl border-border/80 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_18px_44px_-20px_rgba(80,50,160,0.28)] ${
                    isPopular ? 'ring-1 ring-primary/60' : ''
                  }`}
                >
                  {/* top accent bar */}
                  <div className="h-1 bg-brand-gradient" />

                  {isPopular && (
                    <span className="absolute top-4 right-4 z-10 inline-flex items-center gap-1 rounded-full bg-brand-gradient px-2.5 py-1 text-[11.5px] font-semibold text-white shadow-md shadow-primary/40">
                      <Star className="w-3 h-3 fill-current" />
                      Më e zgjedhura
                    </span>
                  )}

                  <CardContent className="p-6 flex flex-col flex-1">
                    <div className="flex items-start justify-between mb-4">
                      <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${vis.box}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      {!isPopular && service.category && (
                        <Badge variant="secondary" className="gap-1 rounded-full">
                          <Tag className="h-3 w-3" />
                          {service.category}
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-lg tracking-tight">{service.title || service.name}</h3>
                      {isPurchased && (
                        <Badge className="bg-primary/10 text-primary text-xs rounded-full">Aktiv</Badge>
                      )}
                    </div>
                    {service.description && (
                      <div className="text-sm text-muted-foreground mt-1.5 line-clamp-3 prose prose-sm dark:prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(service.description) }}
                      />
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
                            <span className="text-2xl font-bold font-mono tracking-tight">{service.price.toLocaleString()}</span>
                            <span className="text-sm font-semibold text-muted-foreground">{service.currency || 'ALL'}</span>
                          </div>
                          {period && <div className="text-xs text-muted-foreground mt-0.5">{period}</div>}
                        </div>
                        {duration && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground whitespace-nowrap flex-shrink-0">
                            <Clock className="h-3 w-3" />
                            {duration}
                          </span>
                        )}
                      </div>

                      <Button
                        variant={isPopular ? 'default' : 'outline'}
                        size="sm"
                        className={`w-full gap-1.5 rounded-xl ${
                          isPopular
                            ? 'bg-brand-gradient shadow-md shadow-primary/25 hover:opacity-95'
                            : 'hover:bg-brand-gradient hover:text-white hover:border-transparent'
                        }`}
                        onClick={() => openQuestionnaire(service.category)}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Kërko këtë shërbim
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Service Questionnaire Dialog */}
      <Dialog open={isQuestionnaireOpen} onOpenChange={(open) => {
        setIsQuestionnaireOpen(open);
        if (!open) setEditingInquiry(null);
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingInquiry?.status === 'Draft' ? 'Vazhdo Kërkesën' : editingInquiry ? 'Edito Kërkesën' : 'Pyetësor për Shërbimin'}
            </DialogTitle>
          </DialogHeader>
          <ServiceQuestionnaireForm
            key={editingInquiry?.id || 'new'}
            onSubmit={handleQuestionnaireSubmit}
            preselectedService={preselectedService}
            prefillEmail={user?.email || ''}
            prefillName={user?.displayName || ''}
            initialDraft={editingInquiry ? { ...editingInquiry, id: editingInquiry.id } : undefined}
            onDraftSave={editingInquiry?.status === 'Draft' ? handleDraftSave : undefined}
            isEditing={!!editingInquiry && editingInquiry.status !== 'Draft'}
          />
        </DialogContent>
      </Dialog>

      {/* View Inquiry Detail Dialog */}
      <Dialog open={!!viewingInquiry} onOpenChange={(open) => { if (!open) setViewingInquiry(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detajet e Kërkesës</DialogTitle>
          </DialogHeader>
          {viewingInquiry && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Biznesi</p>
                  <p className="font-medium">{viewingInquiry.businessName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Kontakti</p>
                  <p className="font-medium">{viewingInquiry.contactName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className="font-medium">{viewingInquiry.email}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Telefon</p>
                  <p className="font-medium">{viewingInquiry.phoneNumber}</p>
                </div>
              </div>
              {viewingInquiry.servicesInterestedIn && viewingInquiry.servicesInterestedIn.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Shërbimet e kërkuara</p>
                  <div className="flex flex-wrap gap-1">
                    {viewingInquiry.servicesInterestedIn.map(s => (
                      <Badge key={s} variant="secondary">{s}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {viewingInquiry.mainGoal && (
                <div>
                  <p className="text-xs text-muted-foreground">Objektivi kryesor</p>
                  <p className="font-medium">{viewingInquiry.mainGoal}</p>
                </div>
              )}
              {viewingInquiry.projectNeedDescription && (
                <div>
                  <p className="text-xs text-muted-foreground">Përshkrimi i projektit</p>
                  <p className="text-sm">{viewingInquiry.projectNeedDescription}</p>
                </div>
              )}
              {viewingInquiry.budgetRange && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Buxheti</p>
                    <p className="font-medium">{viewingInquiry.budgetRange}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Afati</p>
                    <p className="font-medium">{viewingInquiry.timeline}</p>
                  </div>
                </div>
              )}
              <div className="pt-3 border-t">
                {viewingInquiry.status === 'New' && (
                  <Button size="sm" className="gap-1 rounded-xl" onClick={() => { setViewingInquiry(null); openEditInquiry(viewingInquiry); }}>
                    <Edit3 className="w-3.5 h-3.5" />
                    Edito Kërkesën
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PortalServicesView;
