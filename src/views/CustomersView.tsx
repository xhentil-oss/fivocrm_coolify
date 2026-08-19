import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCollection, useMutation, useGlobalBusinessId } from '../hooks/useFirestore';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { phoneKeyDown } from '../lib/utils';
import { findContactMatch, matchFieldLabel } from '../lib/contactIdentity';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { getStatusColor, getPriorityColor } from '../lib/statusColors';
import { getDocs, query, where, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { deleteProjectCascade } from '../lib/deleteCascade';
import {
  Building2,
  Plus,
  Mail,
  Phone,
  Search,
  Filter,
  X,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Star,
  Users,
  ShieldCheck,
  ClipboardList,
  UserPlus,
  Ban,
  Clock,
  ExternalLink,
  Trash2,
  MoreVertical,
  PlusCircle,
  UserCheck,
  Download,
  Merge,
  Copy,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/card';
import { SkeletonLoader } from '../components/PageSkeleton';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import ContactTagsField, { parseTags } from '../components/ContactTagsField';
import MergeContactsDialog from '../components/MergeContactsDialog';
import DuplicateContactsPanel from '../components/DuplicateContactsPanel';
import { findDuplicateGroups } from '../lib/contactMerge';
import { TaskLabels } from '../components/TaskLabels';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Separator } from '../components/ui/separator';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { useToast } from '../hooks/use-toast';
import { useFilteredByOwner, useUniqueTeamMembers } from '../hooks/useRoleFilteredData';
import { useUserNames } from '../hooks/useUserNames';
import type { Customer, ClientPortalAccess, ClientRequest, Team, Lead, TeamMember } from '../types';

const STATUS_OPTIONS = [
  { value: 'Active', label: 'Aktiv', color: 'bg-success text-success-foreground', icon: CheckCircle2 },
  { value: 'Inactive', label: 'Joaktiv', color: 'bg-muted text-muted-foreground', icon: XCircle },
  { value: 'VIP', label: 'VIP', color: 'bg-accent text-accent-foreground', icon: Star },
  { value: 'Pending', label: 'Ne Pritje', color: 'bg-warning text-warning-foreground', icon: AlertCircle },
  { value: 'Suspended', label: 'Pezulluar', color: 'bg-error text-error-foreground', icon: XCircle },
];

const INDUSTRY_OPTIONS = [
  'Teknologji', 'Sherbime Financiare', 'Shendetesi', 'Arsim',
  'Prodhim', 'Tregti me Pakice', 'Ndertim', 'Hoteleri', 'Transport', 'Tjeter',
];

const CustomersView: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const permissions = usePermissions();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('customers');
  const { setDirty, isDirtyRef, discardOpen, requestClose, confirmDiscard, cancelDiscard } = useUnsavedChanges();

  // Customers State
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('__all__');
  const [industryFilter, setIndustryFilter] = useState<string>('__all__');
  const [creditLimitFilter, setCreditLimitFilter] = useState<string>('__all__');
  const [tagFilter, setTagFilter] = useState<string>('__all__');
  const [sortBy, setSortBy] = useState<'recent' | 'name'>('recent');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Manual duplicate merge (Admin/Manager only — the server re-checks the role).
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergePair, setMergePair] = useState<{ primaryId?: string; duplicateId?: string }>({});

  // Portal State
  const [portalSearchQuery, setPortalSearchQuery] = useState('');
  const [isGrantDialogOpen, setIsGrantDialogOpen] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null);

  // Requests State
  const [selectedRequest, setSelectedRequest] = useState<ClientRequest | null>(null);
  const [requestStatusFilter, setRequestStatusFilter] = useState<string>('__all__');

  // Show 20 rows initially (lighter page), grow via "Shfaq më shumë". NOTE: this is
  // display-only — the status-count cards, search and duplicate-detection need the
  // whole tenant in memory, so the fetch still loads all customers. Cutting reads
  // would require server-side counts + cursor pagination (a larger refactor).
  const [visibleCount, setVisibleCount] = useState(20);

  // Data Fetching
  const { data: rawCustomers, loading: customersLoading } = useCollection<Customer>('customers', {
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  // Role-based filtering: Member/Viewer see only customers they created
  const customers = useFilteredByOwner(rawCustomers);
  const { data: leads } = useCollection<Lead>('leads', { skipTeamFilter: true });
  // `leads` is read with skipTeamFilter, and a super-admin's read bypasses the
  // per-business rule — so scope to the active business before matching a lead
  // to a customer, or a link could be written across tenants.
  const activeBusinessId = useGlobalBusinessId();
  const inActiveBusiness = (d: any) => !activeBusinessId || !d.businessId || d.businessId === activeBusinessId;
  const scopedLeads = useMemo(
    () => (leads || []).filter(inActiveBusiness),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leads, activeBusinessId]
  );
  // Same reasoning for the customer side of the identity check.
  const scopedCustomers = useMemo(
    () => (rawCustomers || []).filter(inActiveBusiness),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawCustomers, activeBusinessId]
  );
  // Duplicate detection deliberately runs over the whole tenant (`scopedCustomers`),
  // not the role-filtered `customers`: two records for one person are a tenant-level
  // problem, and a Member/Viewer would otherwise only see half of a pair.
  const duplicateGroups = useMemo(() => findDuplicateGroups(scopedCustomers as any), [scopedCustomers]);
  // Merging rewrites invoices/projects across the tenant → Admin/Manager/Owner only
  // (the endpoint re-checks this server-side; this just hides a button that would fail).
  const canMerge = permissions.isAdmin || permissions.isManager || permissions.isOwner;
  const openMerge = (primaryId?: string, duplicateId?: string) => {
    setMergePair({ primaryId, duplicateId });
    setMergeOpen(true);
  };

  // Existing tags across customers + leads → feed the tag picker so users reuse
  // tags instead of creating near-duplicates.
  const tagSuggestions = useMemo(() => {
    const s = new Set<string>();
    (rawCustomers || []).forEach((c: any) => parseTags(c.tags).forEach(t => s.add(t)));
    (leads || []).forEach((l: any) => parseTags(l.tags).forEach(t => s.add(t)));
    return [...s];
  }, [rawCustomers, leads]);
  const { data: portalAccess } = useCollection<ClientPortalAccess>('clientPortalAccess', {
    skipTeamFilter: true,
  });
  const { data: requests } = useCollection<ClientRequest>('clientRequests', {
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  const { data: teams } = useCollection<Team>('teams');
  const { data: customIndustries } = useCollection<any>('customIndustries', {
    orderBy: { field: 'name', direction: 'asc' },
    skipTeamFilter: true,
  });
  const { data: rawTeamMembers } = useCollection<TeamMember>('teamMembers', { skipTeamFilter: true });
  const teamMembers = useUniqueTeamMembers(rawTeamMembers);
  const { getName } = useUserNames(teamMembers || []);

  const customerMutation = useMutation<Customer>('customers');
  const customIndustryMutation = useMutation<any>('customIndustries');
  const accessMutation = useMutation<ClientPortalAccess>('clientPortalAccess');
  // Used to pair a lead with the client it turned into (see handleCreateCustomer).
  const leadMutation = useMutation<Lead>('leads');
  const requestMutation = useMutation<ClientRequest>('clientRequests');

  // Merge default + custom industries
  const allIndustries = useMemo(() => {
    const customNames = (customIndustries || []).map((ci: any) => ci.name);
    return [...INDUSTRY_OPTIONS, ...customNames.filter((n: string) => !INDUSTRY_OPTIONS.includes(n))];
  }, [customIndustries]);

  const [newIndustryName, setNewIndustryName] = useState('');
  const [showAddIndustry, setShowAddIndustry] = useState(false);

  const handleAddIndustry = async () => {
    const name = newIndustryName.trim();
    if (!name) return;
    if (allIndustries.some(i => i.toLowerCase() === name.toLowerCase())) {
      toast({ title: 'Kjo industri ekziston tashm�', variant: 'destructive' });
      return;
    }
    await customIndustryMutation.create({ name });
    setNewIndustryName('');
    setShowAddIndustry(false);
    toast({ title: 'Industria u shtua me sukses!' });
  };

  // Customers Logic
  const filteredCustomers = useMemo(() => {
    if (!customers) return [];
    const list = customers.filter((customer) => {
      const q = searchQuery.toLowerCase().trim();
      if (q) {
        const match =
          customer.name?.toLowerCase().includes(q) ||
          customer.email?.toLowerCase().includes(q) ||
          customer.phone?.toLowerCase().includes(q) ||
          customer.company?.toLowerCase().includes(q) ||
          (customer as any).taxId?.toLowerCase().includes(q) ||
          (customer as any).contactPerson?.toLowerCase().includes(q) ||
          (customer as any).industry?.toLowerCase().includes(q) ||
          parseTags((customer as any).tags).some(t => t.toLowerCase().includes(q));
        if (!match) return false;
      }
      if (statusFilter !== '__all__') {
        if (((customer as any).status || 'Active') !== statusFilter) return false;
      }
      if (industryFilter !== '__all__') {
        if ((customer as any).industry !== industryFilter) return false;
      }
      if (creditLimitFilter !== '__all__') {
        const limit = (customer as any).creditLimit || 0;
        switch (creditLimitFilter) {
          case 'none': if (limit > 0) return false; break;
          case 'low': if (limit <= 0 || limit > 10000) return false; break;
          case 'medium': if (limit <= 10000 || limit > 50000) return false; break;
          case 'high': if (limit <= 50000) return false; break;
        }
      }
      if (tagFilter !== '__all__') {
        if (!parseTags((customer as any).tags).some(t => t.toLowerCase() === tagFilter.toLowerCase())) return false;
      }
      return true;
    });
    // Sort: newest first (createdAt desc) or alphabetically by name.
    const ms = (d: any) => { const x = d?.toDate ? d.toDate() : d; const t = x instanceof Date ? x.getTime() : Date.parse(x); return isNaN(t) ? 0 : t; };
    return [...list].sort((a, b) => sortBy === 'name'
      ? (a.name || '').localeCompare(b.name || '')
      : ms((b as any).createdAt) - ms((a as any).createdAt));
  }, [customers, searchQuery, statusFilter, industryFilter, creditLimitFilter, tagFilter, sortBy]);

  // Cap rendered rows so large customer lists don't mount hundreds of DOM nodes
  // at once (mobile jank). "Load more" reveals the rest of the filtered set.
  useEffect(() => { setVisibleCount(20); }, [searchQuery, statusFilter, industryFilter, creditLimitFilter, tagFilter, sortBy]);
  const visibleCustomers = useMemo(
    () => filteredCustomers.slice(0, visibleCount),
    [filteredCustomers, visibleCount]
  );

  // Tags actually used on customers (for the filter dropdown).
  const customerTagOptions = useMemo(() => {
    const s = new Set<string>();
    (rawCustomers || []).forEach((c: any) => parseTags(c.tags).forEach(t => s.add(t)));
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [rawCustomers]);

  const statusCounts = useMemo(() => {
    if (!customers) return {};
    return customers.reduce((acc, c) => {
      const status = (c as any).status || 'Active';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [customers]);

  const hasActiveFilters = searchQuery || statusFilter !== '__all__' || industryFilter !== '__all__' || creditLimitFilter !== '__all__' || tagFilter !== '__all__';

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('__all__');
    setIndustryFilter('__all__');
    setCreditLimitFilter('__all__');
    setTagFilter('__all__');
  };

  // Export the currently-filtered customers to a CSV file.
  const exportCsv = () => {
    const rows = filteredCustomers;
    if (!rows.length) { toast({ title: 'Asnjë klient për të eksportuar' }); return; }
    const esc = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const headers = ['Emri', 'Email', 'Telefoni', 'Kompania', 'Industria', 'Statusi', 'Etiketat', 'NIPT'];
    const lines = rows.map((c: any) => [c.name, c.email, c.phone, c.company, c.industry, c.status || 'Active', parseTags(c.tags).join('; '), c.taxId].map(esc).join(','));
    const csv = '﻿' + [headers.join(','), ...lines].join('\n'); // BOM for Excel UTF-8
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `kliente-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  // Bulk selection helpers
  const toggleSelect = (id: string) => setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const clearSelection = () => setSelectedIds(new Set());
  const bulkSetStatus = async (status: string) => {
    const ids = [...selectedIds];
    const res = await Promise.allSettled(ids.map(id => customerMutation.update(id, { status } as any)));
    const failed = res.filter(r => r.status === 'rejected').length;
    toast(failed ? { title: `${ids.length - failed}/${ids.length} u përditësuan`, variant: 'destructive' } : { title: `${ids.length} klientë u përditësuan` });
    clearSelection();
  };
  const bulkDelete = async () => {
    const ids = [...selectedIds];
    for (const id of ids) { try { await handleDeleteCustomer(id); } catch { /* handled inside */ } }
    toast({ title: `${ids.length} klientë u fshinë` });
    clearSelection();
  };

  const handleCreateCustomer = async (formData: FormData) => {
    const data: Record<string, any> = {};
    ['name', 'email', 'phone', 'company', 'address', 'website', 'industry',
     'taxId', 'billingAddress', 'shippingAddress', 'contactPerson', 'contactPhone',
     'notes', 'status', 'paymentTerms', 'tags'].forEach(key => {
      const val = formData.get(key) as string;
      if (val) data[key] = val;
    });
    // "__none__" is the Select sentinel for "no industry" — don't persist it.
    if (data.industry === '__none__') delete data.industry;
    const creditLimit = formData.get('creditLimit') as string;
    if (creditLimit) data.creditLimit = parseFloat(creditLimit);
    const assignedTo = formData.get('assignedToUserId') as string;
    data.assignedToUserId = assignedTo && assignedTo !== 'unassigned' ? assignedTo : null;
    data.disableOverdueReminders = formData.get('disableOverdueReminders') === 'true';

    // Mandatory owner: a customer manually created here must have an account owner.
    // (Automated creation — portal login, lead conversion, WHMCS sync — bypasses
    // this form and may still create ownerless records that are routed later.)
    if (!data.assignedToUserId) {
      toast({ title: 'Cakto një përgjegjës', description: 'Klienti duhet të ketë një person përgjegjës.', variant: 'destructive' });
      return;
    }

    // Identity check against the WHOLE tenant (rawCustomers) — not the role-filtered
    // `customers`, or a Member/Viewer would bypass a teammate's existing record.
    // A second CLIENT for the same person is always wrong → block. A matching LEAD
    // is not a duplicate but the same person at an earlier stage: create the client
    // and pair the two, so the lead's history follows them instead of being orphaned.
    const dupCustomer = findContactMatch(data, scopedCustomers);
    if (dupCustomer) {
      toast({
        title: `Klienti ekziston — ${matchFieldLabel(dupCustomer.on)} përputhet`,
        description: `"${dupCustomer.record.name}" është tashmë klient.`,
        variant: 'destructive',
      });
      return;
    }
    const matchedLead = findContactMatch(data, scopedLeads as any)?.record as Lead | undefined;

    const created = await customerMutation.create({
      ...data,
      ...(matchedLead ? { leadId: matchedLead.id } : {}),
    } as any);
    setIsCreateDialogOpen(false);

    // Pair the lead back to this client (and mark it converted — the prospect
    // became a customer, which is exactly what this form just recorded).
    if (matchedLead && created?.id) {
      leadMutation.update(matchedLead.id, {
        customerId: created.id,
        ...(matchedLead.status !== 'Converted' ? { status: 'Converted', probability: 100, convertedAt: new Date() } : {}),
      } as any)
        .then(() => toast({ title: 'Lead-i u lidh', description: `"${matchedLead.name}" u lidh me këtë klient dhe u shënua si i konvertuar.` }))
        .catch(err => console.error('[CustomersView] lead→customer link failed', err));
    }

    // Auto-grant portal access if customer has email
    if (data.email && created?.id) {
      try {
        await accessMutation.create({
          customerId: created.id,
          userId: '',
          email: data.email.toLowerCase().trim(),
          status: 'Active',
        });
      } catch { /* non-blocking */ }

      // Send welcome email with portal link
      try {
        const idToken = await user!.getIdToken();
        const portalUrl = `${window.location.origin}/portal`;
        await fetch('/api/send-welcome-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
          body: JSON.stringify({
            customerName: data.name || data.email,
            customerEmail: data.email,
            portalUrl,
            teamName: permissions.teamId ? undefined : 'FivoCRM',
          }),
        });
      } catch { /* non-blocking — klienti u krijua, email-i eshte opsional */ }
    }

    toast({ title: 'Klienti u krijua me sukses!' });
  };

  const handleDeleteCustomer = async (id: string) => {
    try {
      // 1) Read everything linked to the customer up front.
      // Every query carries businessId: the rules can only prove a read whose
      // filters imply `isBusinessMember(resource.data.businessId)` — a
      // customerId-only query is denied outright for non-super-admins, which is
      // why this cascade used to fail with "Gabim gjatë fshirjes".
      const byCustomer = (col: string) => activeBusinessId
        ? query(collection(db, col), where('businessId', '==', activeBusinessId), where('customerId', '==', id))
        : query(collection(db, col), where('customerId', '==', id));
      const [invoicesSnap, accessSnap, requestsSnap, projectsSnap, inquiriesSnap, quotesSnap, contractsSnap] = await Promise.all([
        getDocs(byCustomer('invoices')),
        getDocs(byCustomer('clientPortalAccess')),
        getDocs(byCustomer('clientRequests')),
        getDocs(byCustomer('projects')),
        getDocs(byCustomer('serviceInquiries')),
        getDocs(byCustomer('quotes')),
        getDocs(byCustomer('contracts')),
      ]);
      const scopedBy = (col: string, field: string, value: string) => activeBusinessId
        ? query(collection(db, col), where('businessId', '==', activeBusinessId), where(field, '==', value))
        : query(collection(db, col), where(field, '==', value));

      // 2a) Projects go through the SHARED cascade (src/lib/deleteCascade.ts):
      // tasks + their satellites deleted, draft auto-invoices deleted, issued
      // invoices/expenses/logged hours UNLINKED — accounting documents and
      // payroll history must survive a customer deletion too, exactly like a
      // project deletion. (The old code here deleted paid invoices and every
      // time entry outright, contradicting that policy.)
      const projectResults = await Promise.allSettled(
        projectsSnap.docs.map(d => deleteProjectCascade({ id: d.id, name: (d.data() as any).name || '' })),
      );

      // 2b) Customer-level invoices not linked to any project: same policy —
      // never-sent draft autos go, everything else is unlinked with a note.
      const invoiceOps: Promise<unknown>[] = [];
      for (const d of invoicesSnap.docs) {
        const inv = d.data() as any;
        if (inv.projectId) continue; // project cascade already handled it
        if (inv.status === 'Draft' && inv.autoGenerated) {
          const itemsSnap = await getDocs(scopedBy('invoiceItems', 'invoiceId', d.id));
          invoiceOps.push(...itemsSnap.docs.map(i => deleteDoc(i.ref)));
          invoiceOps.push(deleteDoc(d.ref));
        } else {
          invoiceOps.push(updateDoc(d.ref, {
            customerId: '',
            notes: `${inv.notes ? `${inv.notes}\n` : ''}[Klienti u fshi më ${new Date().toLocaleDateString('sq-AL')} — fatura u shkëputur.]`,
            updatedAt: new Date(),
          }));
        }
      }

      // 2c) Portal/CRM records that are meaningless without the customer.
      // `activities` is deliberately NOT touched — it is append-only by rule
      // (`update, delete: if false`), so the old deleteDoc calls on it failed
      // every time and took the entire Promise.all (and the delete) down.
      const results = await Promise.allSettled([
        ...invoiceOps,
        ...accessSnap.docs.map(d => deleteDoc(doc(db, 'clientPortalAccess', d.id))),
        ...requestsSnap.docs.map(d => deleteDoc(doc(db, 'clientRequests', d.id))),
        ...inquiriesSnap.docs.map(d => deleteDoc(doc(db, 'serviceInquiries', d.id))),
        ...quotesSnap.docs.map(d => deleteDoc(doc(db, 'quotes', d.id))),
        ...contractsSnap.docs.map(d => deleteDoc(doc(db, 'contracts', d.id))),
      ]);
      const failed = results.filter(r => r.status === 'rejected').length
        + projectResults.filter(r => r.status === 'rejected').length;
      if (failed) console.warn(`[CustomersView] ${failed} veprime të kaskadës dështuan`);
      // 3) Delete the customer LAST — so a failure above doesn't leave a
      //    half-deleted graph with the customer already gone.
      await customerMutation.remove(id);
      toast({ title: 'Klienti u fshi!', description: 'Projektet, detyrat, kuotat, kontratat dhe aksesi në portal u fshinë; faturat e lëshuara dhe orët e punës u shkëputën (nuk u fshinë).' });
    } catch (err) {
      console.error('[CustomersView] delete customer failed', err);
      toast({ title: 'Gabim gjatë fshirjes', description: 'Disa të dhëna të lidhura mund të mos u fshinë. Provo përsëri.', variant: 'destructive' });
    }
    setCustomerToDelete(null);
  };
  const handleUpdateCustomer = async (formData: FormData) => {
    if (!selectedCustomer) return;
    const data: Record<string, any> = {};
    ['name', 'email', 'phone', 'company', 'address', 'website', 'industry',
     'taxId', 'billingAddress', 'shippingAddress', 'contactPerson', 'contactPhone',
     'notes', 'status', 'paymentTerms', 'tags'].forEach(key => {
      // Always include the value so clearing a field (e.g. removing email/phone) is saved
      const val = formData.get(key) as string;
      data[key] = val || '';
    });
    // "__none__" is the Select sentinel for "no industry" — store empty instead.
    if (data.industry === '__none__') data.industry = '';
    const creditLimit = formData.get('creditLimit') as string;
    data.creditLimit = creditLimit ? parseFloat(creditLimit) : null;
    const assignedTo = formData.get('assignedToUserId') as string;
    data.assignedToUserId = assignedTo && assignedTo !== 'unassigned' ? assignedTo : null;
    data.disableOverdueReminders = formData.get('disableOverdueReminders') === 'true';

    // Mandatory owner: keep the account owner set on edit too.
    if (!data.assignedToUserId) {
      toast({ title: 'Cakto një përgjegjës', description: 'Klienti duhet të ketë një person përgjegjës.', variant: 'destructive' });
      return;
    }

    // Another CLIENT with the same details is a real duplicate → block. A matching
    // LEAD is the same person earlier in the funnel → link it (the old check
    // blocked here, which made every already-linked client uneditable).
    const dupCustomer = findContactMatch(data, scopedCustomers, selectedCustomer.id);
    if (dupCustomer) {
      toast({
        title: `Klienti ekziston — ${matchFieldLabel(dupCustomer.on)} përputhet`,
        description: `"${dupCustomer.record.name}" ka të njëjtat të dhëna kontakti.`,
        variant: 'destructive',
      });
      return;
    }
    const matchedLead = selectedCustomer.leadId
      ? null
      : findContactMatch(data, scopedLeads as any)?.record as Lead | undefined;

    await customerMutation.update(selectedCustomer.id, {
      ...data,
      ...(matchedLead ? { leadId: matchedLead.id } : {}),
    } as any);
    if (matchedLead && !matchedLead.customerId) {
      leadMutation.update(matchedLead.id, { customerId: selectedCustomer.id } as any)
        .catch(err => console.error('[CustomersView] lead→customer link failed', err));
    }
    setIsEditDialogOpen(false);
    setSelectedCustomer(null);
  };

  // Portal Logic
  const customersWithoutAccess = useMemo(() => {
    if (!customers || !portalAccess) return [];
    const accessedIds = new Set(portalAccess.map(a => a.customerId));
    return customers.filter(c => !accessedIds.has(c.id) && c.email);
  }, [customers, portalAccess]);

  const filteredAccess = useMemo(() => {
    if (!portalAccess) return [];
    if (!portalSearchQuery) return portalAccess;
    const q = portalSearchQuery.toLowerCase();
    return portalAccess.filter(a => {
      const customer = customers?.find(c => c.id === a.customerId);
      return (
        a.email.toLowerCase().includes(q) ||
        customer?.name?.toLowerCase().includes(q) ||
        customer?.company?.toLowerCase().includes(q)
      );
    });
  }, [portalAccess, portalSearchQuery, customers]);

  const handleGrantAccess = async (customerId: string) => {
    const customer = customers?.find(c => c.id === customerId);
    if (!customer?.email) return;
    // Check if active portal access already exists for this customer
    const existing = portalAccess?.find(
      a => a.customerId === customerId && a.status === 'Active'
    );
    if (existing) {
      toast({ title: 'Ky klient ka tashmë akses aktiv në portal' });
      setIsGrantDialogOpen(false);
      return;
    }
    await accessMutation.create({
      customerId, userId: '', email: customer.email, status: 'Active',
    });
    setIsGrantDialogOpen(false);

    // Send welcome email
    try {
      const authToken = await user?.getIdToken();
      const portalUrl = `${window.location.origin}/portal`;
      const resp = await fetch('/api/send-welcome-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          customerName: customer.name,
          customerEmail: customer.email,
          portalUrl,
          teamName: permissions.teamName || 'FivoCRM',
        }),
      });
      if (!resp.ok) throw new Error('Email failed');
      toast({ title: 'Akses i dhene', description: `${customer.name} tani ka akses. Email u dergua.` });
    } catch {
      toast({ title: 'Akses i dhene', description: `${customer.name} ka akses, por email nuk u dergua.` });
    }
  };

  const handleToggleAccess = async (access: ClientPortalAccess) => {
    const newStatus = access.status === 'Active' ? 'Suspended' : 'Active';
    await accessMutation.update(access.id, { status: newStatus });
    toast({
      title: newStatus === 'Active' ? 'Aksesi u aktivizua' : 'Aksesi u pezullua',
      description: `Aksesi per ${access.email} u ${newStatus === 'Active' ? 'aktivizua' : 'pezullua'}.`,
    });
  };

  // Requests Logic
  const filteredRequests = useMemo(() => {
    if (!requests) return [];
    if (requestStatusFilter === '__all__') return requests;
    return requests.filter(r => r.status === requestStatusFilter);
  }, [requests, requestStatusFilter]);

  const getCustomerName = (customerId: string) =>
    customers?.find(c => c.id === customerId)?.name || 'Pa emer';

  const handleUpdateRequestStatus = async (requestId: string, newStatus: string, adminNotes?: string) => {
    const update: Record<string, any> = { status: newStatus };
    if (adminNotes !== undefined) update.adminNotes = adminNotes;
    await requestMutation.update(requestId, update);
    setSelectedRequest(null);
    toast({ title: 'Statusi u perditesua' });
  };

  const handleAssignTeam = async (requestId: string, teamId: string) => {
    await requestMutation.update(requestId, { assignedTeamId: teamId });
    toast({ title: 'Ekipi u caktua' });
  };


  const getReqStatusLabel = (status: string) => {
    switch (status) {
      case 'New': return 'E Re'; case 'In Review': return 'Ne Shqyrtim';
      case 'In Progress': return 'Ne Progres'; case 'Completed': return 'Perfunduar';
      case 'Rejected': return 'Refuzuar'; default: return status;
    }
  };

  const getPriorityLabel = (p: string) => {
    switch (p) {
      case 'low': return 'E Ulet'; case 'medium': return 'Mesatare';
      case 'high': return 'E Larte'; case 'urgent': return 'Urgjente'; default: return p;
    }
  };

  const getPortalAccessFor = (customerId: string) =>
    portalAccess?.find(a => a.customerId === customerId);

  if (customersLoading) {
    return <SkeletonLoader variant="page" />;
  }

  const portalActiveCount = portalAccess?.filter(a => a.status === 'Active').length || 0;
  const newRequestsCount = requests?.filter(r => r.status === 'New').length || 0;

  return (
    <div className="space-y-6 w-full min-w-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Klientet</h1>
          <p className="text-muted-foreground mt-1">
            Menaxhoni klientet, portalin dhe kerkesat e tyre
          </p>
        </div>
        {permissions.canEdit && activeTab === 'customers' && (
          <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
            if (open) { setDirty(false); setIsCreateDialogOpen(true); }
            else requestClose(() => setIsCreateDialogOpen(false));
          }}>
            <DialogTrigger asChild>
              <Button className="gap-2 w-full sm:w-auto">
                <Plus className="w-4 h-4" />
                Klient i Ri
              </Button>
            </DialogTrigger>
            <DialogContent
              className="max-w-2xl"
              onInteractOutside={(e) => {
                if (isDirtyRef.current) {
                  e.preventDefault();
                  requestClose(() => setIsCreateDialogOpen(false));
                }
              }}
              onEscapeKeyDown={(e) => {
                if (isDirtyRef.current) {
                  e.preventDefault();
                  requestClose(() => setIsCreateDialogOpen(false));
                }
              }}
            >
              <DialogHeader>
                <DialogTitle>Krijo Klient te Ri</DialogTitle>
              </DialogHeader>
              <CustomerForm onSubmit={(data) => { setDirty(false); return handleCreateCustomer(data); }} industries={allIndustries} onAddIndustry={() => setShowAddIndustry(true)} onDirtyChange={setDirty} teamMembers={teamMembers || []} getName={getName} canAssign={permissions.canManageMembers || permissions.role === 'Admin' || permissions.role === 'Manager'} tagSuggestions={tagSuggestions} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveTab('customers')}>
          <CardContent className="pt-6 flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Kliente Totale</p>
              <p className="text-xl font-bold">{customers?.length || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveTab('requests')}>
          <CardContent className="pt-6 flex items-center gap-3">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <ClipboardList className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Kerkesa te Reja</p>
              <p className="text-xl font-bold">{newRequestsCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveTab('requests')}>
          <CardContent className="pt-6 flex items-center gap-3">
            <div className="p-2 bg-accent-soft dark:bg-primary/10 rounded-lg">
              <Clock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Ne Progres</p>
              <p className="text-xl font-bold">
                {requests?.filter(r => r.status === 'In Progress' || r.status === 'In Review').length || 0}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="w-full min-w-0 overflow-x-auto">
          <TabsList className="min-w-max">
            <TabsTrigger value="customers" className="gap-1 sm:gap-2 text-xs sm:text-sm">
              <Building2 className="h-4 w-4" />
              <span className="hidden sm:inline">Klientet</span>
              <span className="sm:hidden">Kliente</span>
            </TabsTrigger>
            {canMerge && (
              <TabsTrigger value="duplicates" className="gap-1 sm:gap-2 text-xs sm:text-sm">
                <Copy className="h-4 w-4" />
                <span>Dublikatë</span>
                {duplicateGroups.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                    {duplicateGroups.length}
                  </Badge>
                )}
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        {/* TAB: Klientet */}
        <TabsContent value="customers" className="space-y-4">
          {/* Status Quick Filters */}
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            {STATUS_OPTIONS.map((st) => {
              const count = statusCounts[st.value] || 0;
              const Icon = st.icon;
              const isActive = statusFilter === st.value;
              return (
                <button
                  key={st.value}
                  onClick={() => setStatusFilter(isActive ? '__all__' : st.value)}
                  className={`p-3 rounded-lg border transition-all ${
                    isActive
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border hover:border-primary/50 hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className="text-sm font-medium">{st.label}</span>
                  </div>
                  <p className="text-2xl font-bold mt-1">{count}</p>
                </button>
              );
            })}
          </div>

          {/* Search & Filters */}
          <Card className="p-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-3">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Kerko sipas emrit, email, telefon, NIPT, kompani..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <Button variant={showFilters ? 'default' : 'outline'} onClick={() => setShowFilters(!showFilters)} className="gap-2">
                  <Filter className="w-4 h-4" />
                  Filtrat
                  {hasActiveFilters && (
                    <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
                      {[statusFilter !== '__all__', industryFilter !== '__all__', creditLimitFilter !== '__all__', tagFilter !== '__all__'].filter(Boolean).length}
                    </Badge>
                  )}
                </Button>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                  <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recent">Më të rejat</SelectItem>
                    <SelectItem value="name">Sipas emrit (A–Z)</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={exportCsv} className="gap-2" title="Eksporto listën e filtruar në CSV">
                  <Download className="w-4 h-4" /> <span className="hidden sm:inline">Eksporto</span>
                </Button>
                {hasActiveFilters && (
                  <Button variant="ghost" onClick={clearFilters} className="gap-2 text-muted-foreground">
                    <X className="w-4 h-4" /> Pastro
                  </Button>
                )}
              </div>

              {showFilters && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t">
                  <div>
                    <Label className="text-sm text-muted-foreground mb-2 block">Statusi</Label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger><SelectValue placeholder="Te gjithe statuset" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">Te gjithe statuset</SelectItem>
                        {STATUS_OPTIONS.map(s => (
                          <SelectItem key={s.value} value={s.value}>
                            <div className="flex items-center gap-2"><s.icon className="w-4 h-4" />{s.label}</div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-sm text-muted-foreground mb-2 block">Industria</Label>
                    <Select value={industryFilter} onValueChange={setIndustryFilter}>
                      <SelectTrigger><SelectValue placeholder="Te gjitha industrite" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">Te gjitha industrite</SelectItem>
                        {allIndustries.map(ind => <SelectItem key={ind} value={ind}>{ind}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-sm text-muted-foreground mb-2 block">Limiti i Kredise</Label>
                    <Select value={creditLimitFilter} onValueChange={setCreditLimitFilter}>
                      <SelectTrigger><SelectValue placeholder="Te gjitha limitet" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">Te gjitha limitet</SelectItem>
                        <SelectItem value="none">Pa limit</SelectItem>
                        <SelectItem value="low">Deri 10,000 ALL</SelectItem>
                        <SelectItem value="medium">10,000 - 50,000 ALL</SelectItem>
                        <SelectItem value="high">Mbi 50,000 ALL</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-sm text-muted-foreground mb-2 block">Etiketa</Label>
                    <Select value={tagFilter} onValueChange={setTagFilter}>
                      <SelectTrigger><SelectValue placeholder="Të gjitha etiketat" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">Të gjitha etiketat</SelectItem>
                        {customerTagOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Bulk action bar (floating) */}
          {selectedIds.size > 0 && (
            <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-2 rounded-xl bg-card border shadow-lg flex-wrap max-w-[95vw]">
              <span className="text-sm font-medium px-1">{selectedIds.size} të zgjedhur</span>
              <Select onValueChange={(v) => bulkSetStatus(v)}>
                <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="Ndrysho statusin" /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {/* Two selected rows are the natural "these are the same person" gesture. */}
              {canMerge && selectedIds.size === 2 && (
                <Button
                  size="sm" variant="outline" className="h-8 text-xs gap-1"
                  onClick={() => {
                    const [a, b] = Array.from(selectedIds);
                    openMerge(a, b);
                  }}
                >
                  <Merge className="w-3.5 h-3.5" /> Bashko
                </Button>
              )}
              <Button size="sm" variant="destructive" className="h-8 text-xs gap-1" onClick={() => { if (confirm(`Fshi ${selectedIds.size} klientë dhe të dhënat e tyre?`)) bulkDelete(); }}>
                <Trash2 className="w-3.5 h-3.5" /> Fshi
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={clearSelection}>Anulo</Button>
            </div>
          )}

          {/* Customer Mobile Cards */}
          <div className="sm:hidden space-y-3">
            {filteredCustomers.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Users className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                  <p className="text-muted-foreground">
                    {hasActiveFilters ? 'Nuk u gjet asnje klient me keto filtra' : 'Nuk ka kliente ende'}
                  </p>
                  {hasActiveFilters && (
                    <Button variant="link" onClick={clearFilters} className="mt-2">Pastro filtrat</Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              visibleCustomers.map((customer) => {
                const cust = customer as any;
                const statusOpt = STATUS_OPTIONS.find(s => s.value === (cust.status || 'Active'));
                const StatusIcon = statusOpt?.icon || CheckCircle2;
                const portalAcc = getPortalAccessFor(customer.id);
                return (
                  <Card key={customer.id} className={`p-4 space-y-3 ${selectedIds.has(customer.id) ? 'ring-1 ring-primary' : ''}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        {permissions.canEdit && (
                          <Checkbox className="mt-0.5 flex-shrink-0" checked={selectedIds.has(customer.id)} onCheckedChange={() => toggleSelect(customer.id)} aria-label="Përzgjidh klientin" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{customer.name}</p>
                          {customer.company && <p className="text-sm text-muted-foreground">{customer.company}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {portalAcc && (
                          <Badge variant="outline" className="gap-1 text-[10px] text-emerald-600 border-emerald-200 dark:border-emerald-800" title="Ka akses në portal">
                            <ExternalLink className="w-2.5 h-2.5" /> Portal
                          </Badge>
                        )}
                        <Badge className={`${statusOpt?.color || 'bg-gray-100 text-gray-800'} gap-1`}>
                          <StatusIcon className="w-3 h-3" />
                          {statusOpt?.label || cust.status || 'Aktiv'}
                        </Badge>
                        {permissions.canEdit && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => navigate(`/app/customers/${customer.id}`)}>
                                <ExternalLink className="w-3.5 h-3.5 mr-2" /> Shiko 360�
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { setSelectedCustomer(customer); setIsEditDialogOpen(true); }}>
                                Ndrysho
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => setCustomerToDelete(customer.id)}>
                                <Trash2 className="w-3.5 h-3.5 mr-2" /> Fshi
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      {customer.email && (
                        <div className="flex items-center gap-1"><Mail className="w-3 h-3" />{customer.email}</div>
                      )}
                      {customer.phone && (
                        <div className="flex items-center gap-1"><Phone className="w-3 h-3" />{customer.phone}</div>
                      )}
                    </div>
                    {parseTags(cust.tags).length > 0 && <TaskLabels labels={parseTags(cust.tags)} />}
                  </Card>
                );
              })
            )}
            {filteredCustomers.length > visibleCount && (
              <Button variant="outline" className="w-full" onClick={() => setVisibleCount((c) => c + 20)}>
                Shfaq më shumë ({filteredCustomers.length - visibleCount})
              </Button>
            )}
          </div>

          {/* Customer Table - Desktop */}
          <Card className="overflow-hidden hidden sm:block">
            <div className="w-full min-w-0 overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
                    {permissions.canEdit && (
                      <th className="px-3 sm:px-4 py-3 w-10">
                        <Checkbox
                          checked={visibleCustomers.length > 0 && visibleCustomers.every(c => selectedIds.has(c.id))}
                          onCheckedChange={(v) => setSelectedIds(v ? new Set(visibleCustomers.map(c => c.id)) : new Set())}
                          aria-label="Zgjidh të gjithë"
                        />
                      </th>
                    )}
                    <th className="px-3 sm:px-6 py-3 sm:py-4 text-left text-sm font-medium">Klienti</th>
                    <th className="px-3 sm:px-6 py-3 sm:py-4 text-left text-sm font-medium hidden md:table-cell">Kontakti</th>
                    <th className="px-3 sm:px-6 py-3 sm:py-4 text-left text-sm font-medium hidden lg:table-cell">Info Kompanie</th>
                    <th className="px-3 sm:px-6 py-3 sm:py-4 text-left text-sm font-medium">Statusi</th>
                    <th className="px-3 sm:px-6 py-3 sm:py-4 text-left text-sm font-medium">Veprime</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center">
                        <Users className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                        <p className="text-muted-foreground">
                          {hasActiveFilters ? 'Nuk u gjet asnje klient me keto filtra' : 'Nuk ka kliente ende'}
                        </p>
                        {hasActiveFilters && (
                          <Button variant="link" onClick={clearFilters} className="mt-2">Pastro filtrat</Button>
                        )}
                      </td>
                    </tr>
                  ) : (
                    visibleCustomers.map((customer) => {
                      const cust = customer as any;
                      const statusOpt = STATUS_OPTIONS.find(s => s.value === (cust.status || 'Active'));
                      const StatusIcon = statusOpt?.icon || CheckCircle2;
                      const portalAcc = getPortalAccessFor(customer.id);

                      return (
                        <tr key={customer.id} className={`hover:bg-muted/50 transition-colors ${selectedIds.has(customer.id) ? 'bg-primary/5' : ''}`}>
                          {permissions.canEdit && (
                            <td className="px-3 sm:px-4 py-3 sm:py-4">
                              <Checkbox checked={selectedIds.has(customer.id)} onCheckedChange={() => toggleSelect(customer.id)} aria-label="Përzgjidh klientin" />
                            </td>
                          )}
                          <td className="px-3 sm:px-6 py-3 sm:py-4">
                            <div className="space-y-1">
                              <p className="font-medium truncate max-w-[120px] sm:max-w-none">{customer.name}</p>
                              {cust.taxId && <p className="text-sm text-muted-foreground hidden sm:block">NIPT: {cust.taxId}</p>}
                              {cust.contactPerson && <p className="text-sm text-muted-foreground hidden sm:block">Kontakt: {cust.contactPerson}</p>}
                              <TaskLabels labels={parseTags(cust.tags)} max={4} />
                            </div>
                          </td>
                          <td className="px-3 sm:px-6 py-3 sm:py-4 hidden md:table-cell">
                            <div className="space-y-1">
                              {customer.email && (
                                <div className="flex items-center gap-1 text-sm"><Mail className="w-3 h-3 text-muted-foreground" /><span className="truncate max-w-[150px]">{customer.email}</span></div>
                              )}
                              {customer.phone && (
                                <div className="flex items-center gap-1 text-sm"><Phone className="w-3 h-3 text-muted-foreground" />{customer.phone}</div>
                              )}
                            </div>
                          </td>
                          <td className="px-3 sm:px-6 py-3 sm:py-4 hidden lg:table-cell">
                            <div className="space-y-1">
                              {customer.company && <p className="font-normal">{customer.company}</p>}
                              {cust.industry && <Badge variant="outline" className="text-xs">{cust.industry}</Badge>}
                              {cust.assignedToUserId && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <UserCheck className="w-3 h-3" />{getName(cust.assignedToUserId)}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-3 sm:px-6 py-3 sm:py-4">
                            <div className="flex flex-col items-start gap-1">
                              <Badge className={`${statusOpt?.color || 'bg-gray-100 text-gray-800'} gap-1`}>
                                <StatusIcon className="w-3 h-3" />
                                {statusOpt?.label || cust.status || 'Aktiv'}
                              </Badge>
                              {portalAcc && (
                                <Badge variant="outline" className="gap-1 text-[10px] text-emerald-600 border-emerald-200 dark:border-emerald-800" title="Ka akses në portal">
                                  <ExternalLink className="w-2.5 h-2.5" /> Portal
                                </Badge>
                              )}
                            </div>
                          </td>

                          <td className="px-3 sm:px-6 py-3 sm:py-4">
                            <div className="flex items-center gap-1 sm:gap-2">
                              <Button variant="ghost" size="sm" className="gap-1" onClick={() => navigate(`/app/customers/${customer.id}`)}>
                                <ExternalLink className="w-3.5 h-3.5" /> 360�
                              </Button>
                              {permissions.canEdit && (
                                <Button variant="outline" size="sm" onClick={() => { setSelectedCustomer(customer); setIsEditDialogOpen(true); }}>
                                  Ndrysho
                                </Button>
                              )}
                              {permissions.canEdit && (
                                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); setCustomerToDelete(customer.id); }}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {filteredCustomers.length > visibleCount && (
              <div className="p-3 border-t border-border">
                <Button variant="outline" className="w-full" onClick={() => setVisibleCount((c) => c + 20)}>
                  Shfaq më shumë ({filteredCustomers.length - visibleCount})
                </Button>
              </div>
            )}
          </Card>

          {/* Edit Dialog */}
          {selectedCustomer && (
            <Dialog open={isEditDialogOpen} onOpenChange={(open) => {
              if (open) { setDirty(false); setIsEditDialogOpen(true); }
              else requestClose(() => setIsEditDialogOpen(false));
            }}>
              <DialogContent
                className="max-w-2xl"
                onInteractOutside={(e) => {
                  if (isDirtyRef.current) {
                    e.preventDefault();
                    requestClose(() => setIsEditDialogOpen(false));
                  }
                }}
                onEscapeKeyDown={(e) => {
                  if (isDirtyRef.current) {
                    e.preventDefault();
                    requestClose(() => setIsEditDialogOpen(false));
                  }
                }}
              >
                <DialogHeader>
                  <DialogTitle>Ndrysho Klientin</DialogTitle>
                </DialogHeader>
                <CustomerForm onSubmit={(data) => { setDirty(false); return handleUpdateCustomer(data); }} initialData={selectedCustomer} industries={allIndustries} onAddIndustry={() => setShowAddIndustry(true)} onDirtyChange={setDirty} teamMembers={teamMembers || []} getName={getName} canAssign={permissions.canManageMembers || permissions.role === 'Admin' || permissions.role === 'Manager'} tagSuggestions={tagSuggestions} />
              </DialogContent>
            </Dialog>
          )}
        </TabsContent>

        {/* TAB: Dublikatë — zbulimi automatik, bashkimi manual */}
        {canMerge && (
          <TabsContent value="duplicates" className="space-y-4">
            <DuplicateContactsPanel
              kind="customer"
              records={scopedCustomers as any}
              onMerge={(primaryId, duplicateId) => openMerge(primaryId, duplicateId)}
              action={
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openMerge()}>
                  <Merge className="w-3.5 h-3.5" /> Bashko dy klientë manualisht
                </Button>
              }
            />
          </TabsContent>
        )}

        {/* TAB: Aksesi Portalit */}
        <TabsContent value="portal" className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Kerko klient ne portal..."
                value={portalSearchQuery}
                onChange={(e) => setPortalSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            {permissions.canEdit && (
              <Dialog open={isGrantDialogOpen} onOpenChange={setIsGrantDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2">
                    <UserPlus className="h-4 w-4" />
                    Jep Akses
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Jep Akses ne Portal</DialogTitle>
                  </DialogHeader>
                  {customersWithoutAccess.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      Te gjithe klientet me email kane akses tashme, ose nuk ka kliente.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                      {customersWithoutAccess.map(customer => (
                        <div key={customer.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent">
                          <div>
                            <p className="font-medium">{customer.name}</p>
                            <p className="text-sm text-muted-foreground">{customer.email}</p>
                          </div>
                          <Button size="sm" onClick={() => handleGrantAccess(customer.id)}>Jep Akses</Button>
                        </div>
                      ))}
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            )}
          </div>

          {filteredAccess.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ShieldCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Nuk ka akses te klienteve akoma</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredAccess.map(access => {
                const customer = customers?.find(c => c.id === access.customerId);
                return (
                  <Card key={access.id}>
                    <CardContent className="py-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-muted rounded-full">
                            <Building2 className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-semibold">{customer?.name || 'Pa emer'}</p>
                            <p className="text-sm text-muted-foreground">{access.email}</p>
                            {customer?.company && <p className="text-xs text-muted-foreground">{customer.company}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="secondary"
                            className={access.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}
                          >
                            {access.status === 'Active' ? 'Aktiv' : 'Pezulluar'}
                          </Badge>
                          {access.userId && <Badge variant="outline" className="text-xs">I lidhur</Badge>}
                          {permissions.canEdit && (
                            <Button size="sm" variant="outline" onClick={() => handleToggleAccess(access)}>
                              {access.status === 'Active' ? (
                                <><Ban className="h-3.5 w-3.5 mr-1" /> Pezullo</>
                              ) : (
                                <><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Aktivizo</>
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* TAB: Kerkesat */}
        <TabsContent value="requests" className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {['__all__', 'New', 'In Review', 'In Progress', 'Completed', 'Rejected'].map(status => (
              <Button
                key={status}
                variant={requestStatusFilter === status ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRequestStatusFilter(status)}
              >
                {status === '__all__' ? 'Te gjitha' : getReqStatusLabel(status)}
                {status !== '__all__' && requests && (
                  <span className="ml-1 text-xs">({requests.filter(r => r.status === status).length})</span>
                )}
              </Button>
            ))}
          </div>

          {filteredRequests.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Nuk ka kerkesa</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredRequests.map(request => (
                <Card
                  key={request.id}
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => setSelectedRequest(request)}
                >
                  <CardContent className="py-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{request.title}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1">
                          <span>{getCustomerName(request.customerId)}</span>
                          <span>-</span>
                          <span>{request.category}</span>
                          <span>-</span>
                          <span>{request.createdAt instanceof Date ? request.createdAt.toLocaleDateString('sq-AL') : ''}</span>
                          {request.assignedTeamId && (
                            <>
                              <span>-</span>
                              <span>Ekipi: {teams?.find(t => t.id === request.assignedTeamId)?.name || '-'}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={getPriorityColor(request.priority)} variant="secondary">
                          {getPriorityLabel(request.priority)}
                        </Badge>
                        <Badge className={getStatusColor(request.status)} variant="secondary">
                          {getReqStatusLabel(request.status)}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Request Detail Dialog */}
      <Dialog open={!!selectedRequest} onOpenChange={(open) => { if (!open) setSelectedRequest(null); }}>
        <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedRequest?.title}</DialogTitle>
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge className={getStatusColor(selectedRequest.status)} variant="secondary">
                  {getReqStatusLabel(selectedRequest.status)}
                </Badge>
                <Badge className={getPriorityColor(selectedRequest.priority)} variant="secondary">
                  {getPriorityLabel(selectedRequest.priority)}
                </Badge>
                <Badge variant="outline">{selectedRequest.category}</Badge>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Klienti</p>
                  <p className="font-medium">{getCustomerName(selectedRequest.customerId)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Data</p>
                  <p className="font-medium">
                    {selectedRequest.createdAt instanceof Date ? selectedRequest.createdAt.toLocaleString('sq-AL') : '-'}
                  </p>
                </div>
              </div>

              <Separator />

              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Pershkrimi</p>
                <p className="text-sm whitespace-pre-wrap">{selectedRequest.description}</p>
              </div>

              {selectedRequest.attachmentUrl && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Bashkengjitje</p>
                  <a href={selectedRequest.attachmentUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" /> Hap bashkengjitjen
                  </a>
                </div>
              )}

              {selectedRequest.adminNotes && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Pergjigjja e Ekipit</p>
                    <p className="text-sm whitespace-pre-wrap bg-muted p-3 rounded-lg">{selectedRequest.adminNotes}</p>
                  </div>
                </>
              )}

              {permissions.canEdit && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <div>
                      <Label>Ndrysho Statusin</Label>
                      <Select value={selectedRequest.status} onValueChange={(val) => handleUpdateRequestStatus(selectedRequest.id, val)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="New">E Re</SelectItem>
                          <SelectItem value="In Review">Ne Shqyrtim</SelectItem>
                          <SelectItem value="In Progress">Ne Progres</SelectItem>
                          <SelectItem value="Completed">Perfunduar</SelectItem>
                          <SelectItem value="Rejected">Refuzuar</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Cakto Ekipin</Label>
                      <Select value={selectedRequest.assignedTeamId || ''} onValueChange={(val) => handleAssignTeam(selectedRequest.id, val)}>
                        <SelectTrigger><SelectValue placeholder="Zgjidhni ekipin" /></SelectTrigger>
                        <SelectContent>
                          {teams?.map(team => (
                            <SelectItem key={team.id} value={team.id}>
                              {team.name} {team.department ? `(${team.department})` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Shenim Administrativ</Label>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const fd = new FormData(e.currentTarget);
                          handleUpdateRequestStatus(selectedRequest.id, selectedRequest.status, fd.get('adminNotes') as string);
                        }}
                        className="flex gap-2"
                      >
                        <Textarea name="adminNotes" defaultValue={selectedRequest.adminNotes || ''} placeholder="Shkruani pergjigjen ose shenimin..." rows={3} />
                        <Button type="submit" size="sm" className="self-end">Ruaj</Button>
                      </form>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Custom Industry Dialog */}
      <Dialog open={showAddIndustry} onOpenChange={setShowAddIndustry}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Shto Industri t� Re</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Emri i Industris�</Label>
              <Input
                value={newIndustryName}
                onChange={e => setNewIndustryName(e.target.value)}
                placeholder="p.sh. Marketing Digital"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddIndustry(); } }}
              />
            </div>
            <Button onClick={handleAddIndustry} className="w-full" disabled={!newIndustryName.trim()}>
              <PlusCircle className="w-4 h-4 mr-2" /> Shto
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Customer Confirmation */}
      <Dialog open={!!customerToDelete} onOpenChange={(open) => { if (!open) setCustomerToDelete(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Fshi Klientin</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Je i sigurt? Faturat, aksesi portal dhe kërkesat e lidhura do të fshihen gjithashtu.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCustomerToDelete(null)}>Anulo</Button>
            <Button variant="destructive" onClick={() => customerToDelete && handleDeleteCustomer(customerToDelete)}>Fshi</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Unsaved Changes Confirmation */}
      <AlertDialog open={discardOpen} onOpenChange={(open) => { if (!open) cancelDiscard(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Të dhënat nuk u ruajtën</AlertDialogTitle>
            <AlertDialogDescription>
              Ke ndryshime të paruajtura. A je i sigurt që dëshiron të mbyllësh pa ruajtur?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDiscard}>Kthehu</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscard} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Hiq Ndryshimet
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Manual merge of two duplicate clients (moves invoices, projects, quotes, …) */}
      {canMerge && (
        <MergeContactsDialog
          kind="customer"
          open={mergeOpen}
          onOpenChange={(open) => { setMergeOpen(open); if (!open) setMergePair({}); }}
          records={scopedCustomers as any}
          initialPrimaryId={mergePair.primaryId}
          initialDuplicateId={mergePair.duplicateId}
          onMerged={() => setSelectedIds(new Set())}
        />
      )}
    </div>
  );
};

const CustomerForm: React.FC<{
  onSubmit: (data: FormData) => void | Promise<void>;
  initialData?: Customer;
  industries?: string[];
  onAddIndustry?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  teamMembers?: TeamMember[];
  getName?: (userId: string | null | undefined, fallback?: string) => string;
  canAssign?: boolean;
  tagSuggestions?: string[];
}> = ({ onSubmit, initialData, industries = INDUSTRY_OPTIONS, onAddIndustry, onDirtyChange, teamMembers = [], getName, canAssign, tagSuggestions = [] }) => {
  const init = initialData as any;
  const [status, setStatus] = useState(init?.status || 'Active');
  const [industry, setIndustry] = useState(init?.industry || '');
  const [assignedTo, setAssignedTo] = useState(init?.assignedToUserId || 'unassigned');
  const [disableOverdue, setDisableOverdue] = useState(!!init?.disableOverdueReminders);

  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return; // guard against double-submit → duplicate customers
    const formData = new FormData(e.currentTarget);
    formData.set('status', status);
    formData.set('industry', industry);
    formData.set('assignedToUserId', assignedTo);
    formData.set('disableOverdueReminders', String(disableOverdue));
    setSubmitting(true);
    try { await onSubmit(formData); } finally { setSubmitting(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto px-1" onInput={() => onDirtyChange?.(true)}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="name">Emri *</Label>
          <Input id="name" name="name" required defaultValue={init?.name} />
        </div>
        <div>
          <Label htmlFor="company">Kompania</Label>
          <Input id="company" name="company" defaultValue={init?.company} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={init?.email} />
        </div>
        <div>
          <Label htmlFor="phone">Telefon</Label>
          <Input id="phone" name="phone" type="tel" inputMode="numeric" maxLength={20} onKeyDown={phoneKeyDown} defaultValue={init?.phone} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="contactPerson">Personi i Kontaktit</Label>
          <Input id="contactPerson" name="contactPerson" defaultValue={init?.contactPerson} />
        </div>
        <div>
          <Label htmlFor="contactPhone">Telefoni i Kontaktit</Label>
          <Input id="contactPhone" name="contactPhone" type="tel" inputMode="numeric" maxLength={20} onKeyDown={phoneKeyDown} defaultValue={init?.contactPhone} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="website">Website</Label>
          <Input id="website" name="website" type="url" defaultValue={init?.website} />
        </div>
        <div>
          <Label>Industria</Label>
          <div className="flex gap-2">
            <Select value={industry} onValueChange={(v) => { setIndustry(v); onDirtyChange?.(true); }}>
              <SelectTrigger><SelectValue placeholder="Zgjidh industrine" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Pa industri</SelectItem>
                {industries.map(ind => <SelectItem key={ind} value={ind}>{ind}</SelectItem>)}
              </SelectContent>
            </Select>
            {onAddIndustry && (
              <Button type="button" variant="outline" size="icon" className="flex-shrink-0" onClick={onAddIndustry} title="Shto industri te re">
                <PlusCircle className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="taxId">NIPT</Label>
          <Input id="taxId" name="taxId" defaultValue={init?.taxId} placeholder="L12345678A" />
        </div>
        <div>
          <Label>Statusi</Label>
          <Select value={status} onValueChange={(v) => { setStatus(v); onDirtyChange?.(true); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  <div className="flex items-center gap-2"><opt.icon className="w-4 h-4" />{opt.label}</div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {canAssign && teamMembers.length > 0 && (
        <div>
          <Label>Asigno tek</Label>
          <Select value={assignedTo} onValueChange={(v) => { setAssignedTo(v); onDirtyChange?.(true); }}>
            <SelectTrigger><SelectValue placeholder="Pa asignuar" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Pa asignuar</SelectItem>
              {teamMembers.filter(m => m.status === 'Active').map(m => (
                <SelectItem key={m.userId} value={m.userId}>
                  {getName ? getName(m.userId, m.email || m.userId) : (m.email || m.userId)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div>
        <Label htmlFor="address">Adresa</Label>
        <Textarea id="address" name="address" rows={2} defaultValue={init?.address} />
      </div>

      <div>
        <Label htmlFor="billingAddress">Adresa e Faturimit</Label>
        <Textarea id="billingAddress" name="billingAddress" rows={2} defaultValue={init?.billingAddress} />
      </div>

      <div>
        <Label htmlFor="shippingAddress">Adresa e Dergeses</Label>
        <Textarea id="shippingAddress" name="shippingAddress" rows={2} defaultValue={init?.shippingAddress} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="creditLimit">Limiti i Kredise (ALL)</Label>
          <Input id="creditLimit" name="creditLimit" type="number" step="0.01" min="0" defaultValue={init?.creditLimit} />
        </div>
        <div>
          <Label htmlFor="paymentTerms">Kushtet e Pageses</Label>
          <Input id="paymentTerms" name="paymentTerms" defaultValue={init?.paymentTerms} placeholder="p.sh. 30 dite" />
        </div>
      </div>

      <div>
        <Label>Etiketat</Label>
        <ContactTagsField name="tags" initial={init?.tags} suggestions={tagSuggestions} />
      </div>

      <div>
        <Label htmlFor="notes">Shenime</Label>
        <Textarea id="notes" name="notes" rows={3} defaultValue={init?.notes} />
      </div>

      <label className="flex items-start gap-2 p-3 rounded-lg border border-border bg-muted/30 cursor-pointer">
        <input type="checkbox" checked={disableOverdue} onChange={(e) => { setDisableOverdue(e.target.checked); onDirtyChange?.(true); }} className="mt-0.5" />
        <span className="text-sm">
          Mos dërgo kujtesa për fatura të vonuara
          <span className="block text-xs text-muted-foreground">Çaktivizon email-in javor + WhatsApp për këtë klient kur faturat janë Overdue.</span>
        </span>
      </label>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? 'Duke ruajtur…' : (initialData ? 'Perditeso Klientin' : 'Krijo Klientin')}
      </Button>
    </form>
  );
};

export default CustomersView;
