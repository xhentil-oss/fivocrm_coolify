import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useCollection, useMutation, getGlobalBusinessId } from '../hooks/useFirestore';
import { useToast } from '../hooks/use-toast';
import { getStatusColor } from '../lib/statusColors';
import { usePermissions } from '../contexts/PermissionsContext';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import {
  FileText, Search, Building, User, Mail, Phone, Globe, MapPin, Target,
  DollarSign, Clock, FolderOpen, Share2, Palette,
  ExternalLink, Tag, CheckCircle2, Eye, AlertCircle,
  Instagram, Facebook, Linkedin, ArrowRight, Trash2,
  Image as ImageIcon, Briefcase,
  Quote, Download, X, ChevronLeft, ChevronRight, FileArchive, Film, Pencil,
} from 'lucide-react';
import type { ServiceInquiry, Lead, Project, Customer, Deal } from '../types';
import { routeContact } from '../lib/contactIdentity';
import { clientDealDraft, convertLeadPatch, reopenLeadPatch } from '../lib/crm/contactRoute';
import { safeHref } from '../lib/utils';
import { buildProjectDescription, appendBrief, getInquiryCompleteness, getInquirySections, canSeeInquiryPricing } from '../lib/inquiryBrief';
import { FolderKanban } from 'lucide-react';
import ServiceQuestionnaireForm from '../components/ServiceQuestionnaireForm';

const ServiceInquiriesView: React.FC = () => {
  const permissions = usePermissions();
  // Use the resolved role flags, not the raw role string — SuperAdmin/Owner both
  // have isAdmin=true but a role of 'SuperAdmin'/custom, so a string compare hid these actions.
  const canDelete = permissions.isAdmin || permissions.isManager;
  const canEdit = permissions.isAdmin || permissions.isManager;
  // Çmimi/buxheti i briefit: vetëm Admin/SuperAdmin/SalesAgent.
  const canSeePricing = canSeeInquiryPricing(permissions);
  const [selectedInquiry, setSelectedInquiry] = useState<ServiceInquiry | null>(null);
  const [editing, setEditing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [convertingProjectId, setConvertingProjectId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  // In-app image lightbox for uploaded materials (click to zoom, prev/next).
  const [lightbox, setLightbox] = useState<{ files: { url: string; name: string }[]; index: number } | null>(null);

  const { toast } = useToast();

  const { data: inquiries, loading } = useCollection<ServiceInquiry>('serviceInquiries', {
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  const inquiryMutation = useMutation<ServiceInquiry>('serviceInquiries');
  const leadMutation = useMutation<Lead>('leads');
  const dealMutation = useMutation<Deal>('deals');
  const projectMutation = useMutation<Project>('projects');
  // Identity sources for "lead or client?" (crm/contactRoute.ts): the whole
  // tenant, not a role-filtered list — a duplicate is a tenant-level problem.
  const { data: rawLeads } = useCollection<Lead>('leads', { skipTeamFilter: true });
  const { data: rawCustomers } = useCollection<Customer>('customers', { skipTeamFilter: true });

  const filtered = React.useMemo(() => {
    if (!inquiries) return [];
    let result = inquiries.filter(i => !deletedIds.has(i.id));
    if (statusFilter !== 'all') {
      result = result.filter(i => i.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i =>
        i.businessName?.toLowerCase().includes(q) ||
        i.contactName?.toLowerCase().includes(q) ||
        i.email?.toLowerCase().includes(q) ||
        i.servicesInterestedIn?.some(s => s.toLowerCase().includes(q))
      );
    }
    return result;
  }, [inquiries, deletedIds, statusFilter, searchQuery]);

  const stats = React.useMemo(() => {
    if (!inquiries) return { total: 0, new: 0, reviewed: 0, converted: 0 };
    return {
      total: inquiries.length,
      new: inquiries.filter(i => i.status === 'New').length,
      reviewed: inquiries.filter(i => i.status === 'Reviewed').length,
      converted: inquiries.filter(i => i.status === 'Converted').length,
    };
  }, [inquiries]);

  const handleDelete = async (id: string) => {
    setDeleting(true);
    // Optimistic: hide immediately so user sees instant feedback
    setDeletedIds(prev => new Set([...prev, id]));
    setDeleteConfirmId(null);
    if (selectedInquiry?.id === id) setSelectedInquiry(null);
    try {
      await inquiryMutation.remove(id);
      toast({ title: 'Kërkesa u fshi' });
    } catch {
      // Revert optimistic update on failure
      setDeletedIds(prev => { const s = new Set(prev); s.delete(id); return s; });
      toast({ title: 'Gabim', description: 'Kërkesa nuk u fshi. Provoni përsëri.', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  // Admin/Manager edit of a client-submitted survey — reuses the same
  // questionnaire form the client fills, then writes the changes back.
  const handleEditSubmit = async (formData: any) => {
    if (!selectedInquiry) return;
    const id = selectedInquiry.id;
    await inquiryMutation.update(id, { ...formData });
    setSelectedInquiry(prev => (prev ? ({ ...prev, ...formData } as ServiceInquiry) : null));
    setEditing(false);
    toast({ title: 'Anketa u përditësua', description: 'Ndryshimet u ruajtën me sukses.' });
  };

  const handleStatusChange = async (id: string, status: string) => {
    await inquiryMutation.update(id, { status: status as ServiceInquiry['status'] });
    if (selectedInquiry?.id === id) {
      setSelectedInquiry(prev => prev ? { ...prev, status: status as any } : null);
    }
  };

  const handleConvertToLead = async (inquiry: ServiceInquiry) => {
    if (convertingId) return;
    setConvertingId(inquiry.id);
    try {
      // Lead or client? (crm/contactRoute.ts — email OR phone is identity.)
      // A client's brief is a DEAL on the client, never a lead; an open lead is
      // reused, a lost one reopened; only an unknown person gets a new lead.
      const bid = (inquiry as any).businessId || getGlobalBusinessId();
      const inTenant = (d: any) => !bid || !d.businessId || d.businessId === bid;
      const route = routeContact(
        { email: inquiry.email, phone: inquiry.phoneNumber },
        (rawLeads || []).filter(inTenant),
        (rawCustomers || []).filter(inTenant),
        'inquiry',
      );
      if (route.action === 'customer-deal' && route.customer) {
        const customer = route.customer;
        await Promise.allSettled(route.closeLeadIds.map(id => leadMutation.update(id, convertLeadPatch(customer.id, new Date()) as any)));
        const deal = await dealMutation.create({
          ...clientDealDraft({
            customer,
            subject: (inquiry.servicesInterestedIn || []).join(', ') || null,
            source: 'Service Questionnaire',
            notes: buildProjectDescription(inquiry),
            at: new Date(),
          }),
          serviceInquiryId: inquiry.id,
        } as any);
        await inquiryMutation.update(inquiry.id, { status: 'Converted', dealId: deal.id, customerId: customer.id } as any);
        setSelectedInquiry(prev => prev ? { ...prev, status: 'Converted', dealId: deal.id } as any : null);
        toast({ title: 'Marrëveshje e re te klienti', description: `${customer.name} është klient — kërkesa u shtua si marrëveshje, jo si lead.` });
        return;
      }
      if (route.leadId && (route.action === 'update-lead' || route.action === 'reopen-lead')) {
        const existingLead = route.matchedLeads.find(l => l.id === route.leadId)!;
        if (route.action === 'reopen-lead') await leadMutation.update(existingLead.id, reopenLeadPatch(existingLead, new Date()) as any);
        await inquiryMutation.update(inquiry.id, {
          status: 'Converted',
          leadId: existingLead.id,
        });
        setSelectedInquiry(prev => prev ? { ...prev, status: 'Converted', leadId: existingLead.id } : null);
        toast({
          title: route.action === 'reopen-lead' ? 'Lead-i u rihap' : 'Lead ekziston tashmë',
          description: `${inquiry.contactName} u lidh me lead-in ekzistues në CRM.`,
        });
        return;
      }

      const score = [
        inquiry.contactName ? 10 : 0,
        inquiry.email ? 15 : 0,
        inquiry.phoneNumber ? 10 : 0,
        inquiry.businessName ? 15 : 0,
        inquiry.website ? 5 : 0,
        5, // source known (inquiry)
      ].reduce((a, b) => a + b, 0);

      const newLead = await leadMutation.create({
        name: inquiry.contactName,
        email: inquiry.email,
        phoneNumber: inquiry.phoneNumber,
        company: inquiry.businessName,
        jobTitle: inquiry.jobTitle,
        website: inquiry.website,
        source: 'Website',
        // Full structured brief so sales sees every answer without opening the inquiry.
        notes: buildProjectDescription(inquiry),
        status: 'New',
        serviceInquiryId: inquiry.id,
        score,
        // A Pending portal prospect keeps its lead, linked to its portal record.
        ...(route.customer ? { customerId: route.customer.id } : {}),
      });

      if (newLead?.id) {
        await inquiryMutation.update(inquiry.id, {
          status: 'Converted',
          leadId: newLead.id,
        });
        setSelectedInquiry(prev => prev ? { ...prev, status: 'Converted', leadId: newLead.id } : null);
        toast({ title: 'Lead u krijua me sukses', description: `${inquiry.contactName} u shtua në CRM.` });
      }
    } catch {
      toast({ title: 'Gabim', description: 'Nuk u krijua lead-i. Provo sërish.', variant: 'destructive' });
    } finally {
      setConvertingId(null);
    }
  };

  // Konverto anketën direkt në një Projekt, me brief-in e plotë te description.
  const handleConvertToProject = async (inquiry: ServiceInquiry) => {
    if (convertingProjectId) return;
    if ((inquiry as any).projectId) {
      toast({ title: 'Ekziston tashmë', description: 'Kjo kërkesë është konvertuar më parë në projekt.' });
      return;
    }
    setConvertingProjectId(inquiry.id);
    try {
      const brief = buildProjectDescription(inquiry);
      const projectName =
        (inquiry as any).serviceTitle ||
        [inquiry.businessName, inquiry.servicesInterestedIn?.[0]].filter(Boolean).join(' — ') ||
        'Projekt i ri';

      const newProject = await projectMutation.create({
        name: projectName,
        description: appendBrief('', brief),
        status: 'Planning',
        sourceQuestionnaireId: inquiry.id,
        ...((inquiry as any).customerId ? { customerId: (inquiry as any).customerId } : {}),
        ...((inquiry as any).teamId ? { teamId: (inquiry as any).teamId } : {}),
      } as Partial<Project>);

      if (newProject?.id) {
        await inquiryMutation.update(inquiry.id, {
          status: 'Converted',
          projectId: newProject.id,
        } as any);
        setSelectedInquiry(prev => prev ? { ...prev, status: 'Converted', projectId: newProject.id } as any : null);
        toast({ title: 'Projekti u krijua', description: `"${projectName}" u krijua me brief-in e anketës.` });
      }
    } catch {
      toast({ title: 'Gabim', description: 'Nuk u krijua projekti. Provo sërish.', variant: 'destructive' });
    } finally {
      setConvertingProjectId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const label = status === 'New' ? 'E Re' : status === 'Reviewed' ? 'Shqyrtuar' : status === 'Converted' ? 'Konvertuar' : status;
    return <Badge className={getStatusColor(status)}>{label}</Badge>;
  };

  const getBudgetBadge = (budget: string) => {
    const isHigh = ['100,000–300,000 L', '300,000+ L'].includes(budget);
    return (
      <Badge className={isHigh
        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
        : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
      }>
        {budget}
      </Badge>
    );
  };

  const formatDate = (date: any) => {
    if (!date) return '—';
    const d = date instanceof Date ? date : date?.toDate?.() ? date.toDate() : new Date(date);
    return d.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-8 w-48 skeleton rounded" />
            <div className="h-4 w-64 skeleton rounded" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="p-6 bg-card rounded-lg border space-y-3">
              <div className="h-5 w-3/4 skeleton rounded" />
              <div className="h-4 w-full skeleton rounded" />
              <div className="flex gap-2">
                <div className="h-5 w-20 skeleton rounded" />
                <div className="h-5 w-16 skeleton rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Kërkesat e Shërbimeve</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pyetësorët e dorëzuar nga klientët
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-2xl font-bold">{stats.total}</div>
          <div className="text-xs text-muted-foreground">Gjithsej</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-blue-600">{stats.new}</div>
          <div className="text-xs text-muted-foreground">Të Reja</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-amber-600">{stats.reviewed}</div>
          <div className="text-xs text-muted-foreground">Të Shqyrtuara</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-green-600">{stats.converted}</div>
          <div className="text-xs text-muted-foreground">Të Konvertuara</div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Kërko sipas emrit, email, shërbimit..."
            className="pl-9 h-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[160px] h-9">
            <SelectValue placeholder="Statusi" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Të gjitha</SelectItem>
            <SelectItem value="New">Të Reja</SelectItem>
            <SelectItem value="Reviewed">Të Shqyrtuara</SelectItem>
            <SelectItem value="Converted">Të Konvertuara</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Inquiry List */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Nuk ka kërkesa</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(inquiry => {
            const isUrgent = inquiry.timeline === 'Menjëherë' || inquiry.isUrgent === 'Po';
            // "High value" nxjerr tërthorazi buxhetin — trego vetëm te ata që lejohen.
            const isHighValue = canSeePricing && ['100,000–300,000 L', '300,000+ L'].includes(inquiry.budgetRange);
            const missingCount = getInquiryCompleteness(inquiry).missing.length;

            return (
              <Card
                key={inquiry.id}
                className={`cursor-pointer hover:shadow-md transition-all ${
                  isUrgent ? 'border-l-4 border-l-red-500' : isHighValue ? 'border-l-4 border-l-emerald-500' : ''
                }`}
                onClick={() => setSelectedInquiry(inquiry)}
              >
                <CardContent className="p-4 space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-sm truncate">{inquiry.businessName}</h3>
                      <p className="text-xs text-muted-foreground truncate">{inquiry.contactName} · {inquiry.email}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {getStatusBadge(inquiry.status)}
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={e => { e.stopPropagation(); setDeleteConfirmId(inquiry.id); }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Services */}
                  <div className="flex flex-wrap gap-1">
                    {inquiry.servicesInterestedIn?.map(s => (
                      <Badge key={s} variant="outline" className="text-[10px] px-1.5 py-0">
                        {s}
                      </Badge>
                    ))}
                  </div>

                  {/* Description preview */}
                  {inquiry.projectNeedDescription && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {inquiry.projectNeedDescription}
                    </p>
                  )}

                  {/* Footer info */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                    <div className="flex items-center gap-3">
                      {canSeePricing && getBudgetBadge(inquiry.budgetRange)}
                      {isUrgent && (
                        <span className="flex items-center gap-0.5 text-red-600">
                          <AlertCircle className="w-3 h-3" />
                          Urgjent
                        </span>
                      )}
                      {missingCount > 0 && (
                        <span className="flex items-center gap-0.5 text-amber-600">
                          <AlertCircle className="w-3 h-3" />
                          {missingCount} pa dërguar
                        </span>
                      )}
                    </div>
                    <span>{formatDate(inquiry.createdAt)}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={open => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              Konfirmo Fshirjen
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Jeni i sigurt që doni ta fshini këtë kërkesë? Ky veprim nuk mund të kthehet.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirmId(null)}>
              Anulo
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              {deleting ? 'Duke fshirë...' : 'Fshi'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!selectedInquiry} onOpenChange={open => { if (!open) { setSelectedInquiry(null); setEditing(false); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              {editing ? <Pencil className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
              {editing ? 'Edito Anketën' : 'Detajet e Kërkesës'}
            </DialogTitle>
          </DialogHeader>

          {selectedInquiry && editing && (
            <div className="flex-1 overflow-y-auto pr-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground mb-4"
              >
                <ChevronLeft className="h-4 w-4" /> Anulo editimin
              </button>
              <ServiceQuestionnaireForm
                key={selectedInquiry.id}
                onSubmit={handleEditSubmit}
                initialDraft={{ ...(selectedInquiry as any), id: selectedInquiry.id }}
                isEditing
              />
            </div>
          )}

          {selectedInquiry && !editing && (
            <div className="flex-1 overflow-y-auto pr-2">
              <div className="space-y-6 pb-4">
                {/* Status + Actions bar */}
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    {getStatusBadge(selectedInquiry.status)}
                    <span className="text-xs text-muted-foreground">{formatDate(selectedInquiry.createdAt)}</span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {selectedInquiry.status === 'New' && (
                      <Button size="sm" variant="outline" onClick={() => handleStatusChange(selectedInquiry.id, 'Reviewed')}>
                        <Eye className="w-3.5 h-3.5 mr-1" />
                        Shëno si Shqyrtuar
                      </Button>
                    )}
                    {selectedInquiry.status !== 'Converted' && (
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white"
                        disabled={convertingId === selectedInquiry.id}
                        onClick={() => handleConvertToLead(selectedInquiry)}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        {convertingId === selectedInquiry.id ? 'Duke krijuar...' : 'Konverto në Lead'}
                      </Button>
                    )}
                    {!(selectedInquiry as any).projectId && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-primary/30 text-primary hover:bg-primary/10"
                        disabled={convertingProjectId === selectedInquiry.id}
                        onClick={() => handleConvertToProject(selectedInquiry)}
                      >
                        <FolderKanban className="w-3.5 h-3.5 mr-1" />
                        {convertingProjectId === selectedInquiry.id ? 'Duke krijuar...' : 'Konverto në Projekt'}
                      </Button>
                    )}
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing(true)}
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1" />
                        Edito
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive border-destructive/30 hover:bg-destructive/10"
                        onClick={() => setDeleteConfirmId(selectedInquiry.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        Fshi
                      </Button>
                    )}
                  </div>
                </div>

                {/* Çfarë s'ka dërguar akoma klienti */}
                {(() => {
                  const c = getInquiryCompleteness(selectedInquiry);
                  if (c.missing.length === 0) return null;
                  return (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:bg-amber-950/20 dark:border-amber-800/40">
                      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5 mb-2">
                        <AlertCircle className="h-4 w-4" /> Klienti nuk ka dërguar akoma
                      </p>
                      <ol className="space-y-1.5">
                        {c.missing.map((m, i) => (
                          <li key={m.key} className="text-sm text-amber-900 dark:text-amber-200 flex items-center gap-2">
                            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-amber-200 text-[11px] font-bold text-amber-800 dark:bg-amber-800/50 dark:text-amber-200">{i + 1}</span>
                            {m.label}
                          </li>
                        ))}
                      </ol>
                    </div>
                  );
                })()}

                {/* ── Fjalët e klientit — the message the client wrote, elevated to the
                       top and made large + readable so staff reads intent first. ── */}
                {(() => {
                  const goal = selectedInquiry.mainGoal?.trim();
                  const narrative: { label: string; value?: string }[] = [
                    { label: 'Nevoja e projektit', value: selectedInquiry.projectNeedDescription?.trim() },
                    { label: 'Sfida kryesore', value: selectedInquiry.currentMainChallenge?.trim() },
                    { label: 'Çfarë ka provuar', value: selectedInquiry.whatHaveYouTried?.trim() },
                  ].filter(n => n.value);
                  if (!goal && narrative.length === 0) return null;
                  return (
                    <div className="rounded-xl border border-primary/20 bg-primary/[0.04] dark:bg-primary/10 p-4 sm:p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Quote className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground leading-tight">Çfarë kërkon klienti</p>
                          <p className="text-[11px] text-muted-foreground">Me fjalët e tyre</p>
                        </div>
                      </div>
                      {goal && (
                        <p className="text-[16px] sm:text-[17px] font-medium leading-snug text-foreground mb-3">
                          {goal}
                        </p>
                      )}
                      <div className="space-y-3">
                        {narrative.map(n => (
                          <div key={n.label}>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary/70 mb-0.5">{n.label}</p>
                            <p className="text-[15px] leading-relaxed text-foreground/90 whitespace-pre-wrap">{n.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Section 1: Basic Info */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2 text-primary">
                    <Building className="w-4 h-4" />
                    Informacion Bazë
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-muted/30 rounded-lg p-4">
                    <InfoRow icon={Building} label="Biznesi" value={selectedInquiry.businessName} />
                    <InfoRow icon={User} label="Kontakti" value={selectedInquiry.contactName} />
                    <InfoRow icon={Mail} label="Email" value={selectedInquiry.email} isLink={`mailto:${selectedInquiry.email}`} />
                    <InfoRow icon={Phone} label="Telefon" value={selectedInquiry.phoneNumber} isLink={`tel:${selectedInquiry.phoneNumber}`} />
                    {selectedInquiry.jobTitle && <InfoRow icon={User} label="Pozicioni" value={selectedInquiry.jobTitle} />}
                    <InfoRow icon={Tag} label="Industria" value={selectedInquiry.industry} />
                    <InfoRow icon={MapPin} label="Qyteti" value={selectedInquiry.cityMarket || '—'} />
                    {selectedInquiry.website && <InfoRow icon={Globe} label="Website" value={selectedInquiry.website} isLink={selectedInquiry.website} />}
                  </div>
                  {/* Social links */}
                  {(selectedInquiry.instagramLink || selectedInquiry.facebookLink || selectedInquiry.tiktokLink || selectedInquiry.linkedinLink) && (
                    <div className="flex flex-wrap gap-2">
                      {selectedInquiry.instagramLink && (
                        <a href={safeHref(selectedInquiry.instagramLink)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-pink-600 bg-pink-50 dark:bg-pink-950/30 px-2 py-1 rounded hover:underline">
                          <Instagram className="w-3 h-3" /> Instagram
                        </a>
                      )}
                      {selectedInquiry.facebookLink && (
                        <a href={safeHref(selectedInquiry.facebookLink)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 dark:bg-blue-950/30 px-2 py-1 rounded hover:underline">
                          <Facebook className="w-3 h-3" /> Facebook
                        </a>
                      )}
                      {selectedInquiry.tiktokLink && (
                        <a href={safeHref(selectedInquiry.tiktokLink)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-foreground bg-muted px-2 py-1 rounded hover:underline">
                          <Share2 className="w-3 h-3" /> TikTok
                        </a>
                      )}
                      {selectedInquiry.linkedinLink && (
                        <a href={safeHref(selectedInquiry.linkedinLink)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-700 bg-blue-50 dark:bg-blue-950/30 px-2 py-1 rounded hover:underline">
                          <Linkedin className="w-3 h-3" /> LinkedIn
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* Logo */}
                {selectedInquiry.logoUrl && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold flex items-center gap-2 text-primary">
                      <ImageIcon className="w-4 h-4" />
                      Logo
                    </h4>
                    <a href={safeHref(selectedInquiry.logoUrl)} target="_blank" rel="noopener noreferrer">
                      <img src={selectedInquiry.logoUrl} alt="Logo e biznesit" className="h-20 rounded-lg border bg-white object-contain p-1.5" />
                    </a>
                  </div>
                )}

                {/* Shërbimet e biznesit */}
                {Array.isArray(selectedInquiry.businessServices) && selectedInquiry.businessServices.some(s => s?.title?.trim()) && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold flex items-center gap-2 text-primary">
                      <Briefcase className="w-4 h-4" />
                      Shërbimet e biznesit
                    </h4>
                    <div className="bg-muted/30 rounded-lg p-4 space-y-2.5">
                      {selectedInquiry.businessServices.filter(s => s?.title?.trim() || s?.description?.trim()).map((s, i) => (
                        <div key={i} className="border-b border-border/60 last:border-0 pb-2.5 last:pb-0">
                          <p className="text-sm font-semibold">{s.title?.trim() || 'Shërbim'}</p>
                          {s.description?.trim() && <p className="text-sm text-muted-foreground mt-0.5 whitespace-pre-wrap">{s.description}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Section 2: Service Interest */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2 text-primary">
                    <Target className="w-4 h-4" />
                    Interesi për Shërbimin
                  </h4>
                  <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                    <div>
                      <span className="text-xs text-muted-foreground">Shërbimet e zgjedhura</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {selectedInquiry.servicesInterestedIn?.map(s => (
                          <Badge key={s} className="bg-primary/10 text-primary">{s}</Badge>
                        ))}
                      </div>
                    </div>
                    {/* The client's narrative (goal / need / challenge / tried) is shown
                        prominently in the "Çfarë kërkon klienti" card above. */}
                    <InfoRow icon={User} label="Ka punuar me agjenci" value={selectedInquiry.hasWorkedWithAgency || '—'} />
                  </div>
                </div>

                {/* Section 3: Budget & Timeline */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2 text-primary">
                    <DollarSign className="w-4 h-4" />
                    Buxheti & Afati
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-muted/30 rounded-lg p-4">
                    {canSeePricing && (
                      <div>
                        <span className="text-xs text-muted-foreground">Buxheti</span>
                        <div className="mt-1">{getBudgetBadge(selectedInquiry.budgetRange)}</div>
                      </div>
                    )}
                    <InfoRow icon={Clock} label="Afati" value={selectedInquiry.timeline} />
                    <InfoRow icon={AlertCircle} label="Urgjent" value={selectedInquiry.isUrgent || '—'} />
                    <InfoRow icon={User} label="Vendimmarrësi" value={selectedInquiry.decisionMaker} />
                    <InfoRow icon={Phone} label="Kontakt i preferuar" value={selectedInquiry.preferredContactMethod || '—'} />
                  </div>
                </div>

                {/* Section 4: Materials */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2 text-primary">
                    <FolderOpen className="w-4 h-4" />
                    Materialet
                  </h4>
                  <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                    <InfoRow icon={FolderOpen} label="Ka materiale" value={selectedInquiry.hasExistingMaterials} />
                    {(selectedInquiry.googleDriveLink || selectedInquiry.secondGoogleDriveLink) && (
                      <div className="flex flex-wrap gap-2">
                        {[selectedInquiry.googleDriveLink, selectedInquiry.secondGoogleDriveLink].filter(Boolean).map((link, i) => (
                          <a
                            key={i}
                            href={safeHref(link!)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm hover:border-primary/40 hover:bg-primary/5 transition-colors"
                          >
                            <FolderOpen className="h-4 w-4 text-primary flex-shrink-0" />
                            <span className="font-medium">Hap Google Drive{i === 1 ? ' (2)' : ''}</span>
                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                          </a>
                        ))}
                      </div>
                    )}
                    {selectedInquiry.folderIncludes && selectedInquiry.folderIncludes.length > 0 && (
                      <div>
                        <span className="text-xs text-muted-foreground">Dosja përfshin</span>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {selectedInquiry.folderIncludes.map(f => (
                            <Badge key={f} variant="outline" className="text-xs">{f}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedInquiry.hasBrandGuidelines && (
                      <InfoRow icon={Palette} label="Brand Guidelines" value={selectedInquiry.hasBrandGuidelines} />
                    )}
                    {Array.isArray(selectedInquiry.materialFiles) && selectedInquiry.materialFiles.length > 0 && (() => {
                      const files = selectedInquiry.materialFiles!;
                      const images = files.filter(isImageFile);
                      return (
                        <div>
                          <span className="text-xs text-muted-foreground">Foto &amp; materiale të ngarkuara · {files.length}</span>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-2">
                            {files.map((f, i) => {
                              if (isImageFile(f)) {
                                const imgIndex = Math.max(0, images.findIndex(x => x.url === f.url));
                                return (
                                  <button
                                    key={i}
                                    type="button"
                                    onClick={() => setLightbox({ files: images, index: imgIndex })}
                                    className="group relative rounded-xl border bg-background overflow-hidden aspect-square"
                                    title={f.name}
                                  >
                                    <img src={f.url} alt={f.name} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                                    <div className="absolute inset-0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                      <Eye className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                    <span className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[10px] text-white truncate text-left">{f.name}</span>
                                  </button>
                                );
                              }
                              const kind = fileKind(f.name || f.url);
                              const Icon = kind.icon;
                              return (
                                <div key={i} className="rounded-xl border bg-background p-3 flex flex-col aspect-square" title={f.name}>
                                  <div className={`flex-1 flex items-center justify-center ${kind.tint}`}>
                                    <Icon className="h-9 w-9" />
                                  </div>
                                  <p className="text-[11px] text-foreground/80 truncate mb-1.5">{f.name}</p>
                                  <div className="flex gap-1.5">
                                    <a href={safeHref(f.url)} target="_blank" rel="noopener noreferrer" className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] rounded-md bg-muted hover:bg-accent py-1">
                                      <ExternalLink className="h-3 w-3" />Hap
                                    </a>
                                    <a href={safeHref(f.url)} download={f.name} className="inline-flex items-center justify-center rounded-md bg-muted hover:bg-accent px-2 py-1" title="Shkarko">
                                      <Download className="h-3 w-3" />
                                    </a>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Section 5: Service-Specific (dinamik nga inquiryBrief — mbulon të gjitha shërbimet) */}
                {(() => {
                  const TOP = new Set(['Informacion Bazë', 'Shërbimet e biznesit', 'Shërbimi & Objektivi', 'Buxheti & Materialet']);
                  const specific = getInquirySections(selectedInquiry, { includePricing: canSeePricing }).sections.filter(s => !TOP.has(s.title));
                  return specific.map(sec => (
                    <div key={sec.title} className="space-y-3">
                      <h4 className="text-sm font-semibold flex items-center gap-2 text-primary">
                        <Target className="w-4 h-4" />
                        {sec.title}
                      </h4>
                      <div className="bg-muted/30 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {sec.rows.map(row => (
                          <div key={row.label} className={Array.isArray(row.value) ? 'sm:col-span-2' : ''}>
                            <span className="text-xs text-muted-foreground">{row.label}</span>
                            {Array.isArray(row.value) ? (
                              <div className="flex flex-wrap gap-1.5 mt-1">
                                {row.value.map((v, i) => <Badge key={i} variant="outline" className="text-xs">{v}</Badge>)}
                              </div>
                            ) : (
                              <p className="text-sm mt-0.5 whitespace-pre-wrap">{row.value}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ));
                })()}

                {/* Linked Lead */}
                {selectedInquiry.leadId && (
                  <div className="pt-2 border-t">
                    <div className="flex items-center gap-2 text-xs">
                      <ArrowRight className="w-3.5 h-3.5 text-green-600" />
                      <span className="text-green-700 dark:text-green-400 font-medium">Lead i krijuar me sukses në CRM</span>
                      <span className="text-muted-foreground">· ID: {selectedInquiry.leadId.slice(0, 12)}…</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* In-app image lightbox — zoom uploaded photos without leaving the app */}
      {lightbox && createPortal(
        <div className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 text-white/80 hover:text-white p-2" onClick={() => setLightbox(null)} aria-label="Mbyll">
            <X className="h-6 w-6" />
          </button>
          {lightbox.files.length > 1 && (
            <>
              <button className="absolute left-2 sm:left-6 text-white/80 hover:text-white p-2" aria-label="Para"
                onClick={e => { e.stopPropagation(); setLightbox(l => l && ({ ...l, index: (l.index - 1 + l.files.length) % l.files.length })); }}>
                <ChevronLeft className="h-8 w-8" />
              </button>
              <button className="absolute right-2 sm:right-6 text-white/80 hover:text-white p-2" aria-label="Pas"
                onClick={e => { e.stopPropagation(); setLightbox(l => l && ({ ...l, index: (l.index + 1) % l.files.length })); }}>
                <ChevronRight className="h-8 w-8" />
              </button>
            </>
          )}
          <div className="max-w-[92vw] max-h-[88vh] flex flex-col items-center gap-3" onClick={e => e.stopPropagation()}>
            <img src={lightbox.files[lightbox.index].url} alt={lightbox.files[lightbox.index].name} className="max-w-full max-h-[80vh] object-contain rounded-lg" />
            <div className="flex items-center gap-3 text-white/90 text-sm">
              <span className="truncate max-w-[55vw]">{lightbox.files[lightbox.index].name}</span>
              <span className="text-white/50">{lightbox.index + 1}/{lightbox.files.length}</span>
              <a href={safeHref(lightbox.files[lightbox.index].url)} download={lightbox.files[lightbox.index].name}
                className="inline-flex items-center gap-1 hover:text-white" onClick={e => e.stopPropagation()}>
                <Download className="h-4 w-4" />Shkarko
              </a>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// True when a material file is an image (checked on both name and url).
const isImageFile = (f: { url: string; name: string }) =>
  /\.(png|jpe?g|gif|webp|svg|bmp)(\?|$)/i.test(f.name || '') || /\.(png|jpe?g|gif|webp|svg|bmp)(\?|$)/i.test(f.url || '');

// Pick an icon + tint for a non-image material file by extension.
const fileKind = (nameOrUrl: string): { icon: React.ElementType; tint: string } => {
  const s = (nameOrUrl || '').toLowerCase();
  if (/\.pdf(\?|$)/.test(s)) return { icon: FileText, tint: 'text-red-500' };
  if (/\.(docx?|odt|rtf|txt)(\?|$)/.test(s)) return { icon: FileText, tint: 'text-blue-500' };
  if (/\.(zip|rar|7z|tar|gz)(\?|$)/.test(s)) return { icon: FileArchive, tint: 'text-amber-500' };
  if (/\.(mp4|mov|avi|mkv|webm)(\?|$)/.test(s)) return { icon: Film, tint: 'text-purple-500' };
  return { icon: FileText, tint: 'text-muted-foreground' };
};

// Helper component for info rows
const InfoRow: React.FC<{
  icon: React.ElementType;
  label: string;
  value?: string;
  isLink?: string;
}> = ({ icon: Icon, label, value, isLink }) => {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        {isLink ? (
          <a href={safeHref(isLink)} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline block truncate">{value}</a>
        ) : (
          <p className="text-sm">{value}</p>
        )}
      </div>
    </div>
  );
};

export default ServiceInquiriesView;
