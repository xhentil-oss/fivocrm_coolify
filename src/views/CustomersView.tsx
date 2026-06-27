import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { phoneKeyDown } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { getStatusColor, getPriorityColor } from '../lib/statusColors';
import { getDocs, query, where, collection, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  Building2, Plus, Mail, Phone, Search, Filter, X,
  CheckCircle2, XCircle, AlertCircle, Star, Users,
  ShieldCheck, ClipboardList, UserPlus, Ban, Clock,
  ExternalLink, Globe, Trash2, MoreVertical, PlusCircle, UserCheck,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
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
  const [showFilters, setShowFilters] = useState(false);

  // Portal State
  const [portalSearchQuery, setPortalSearchQuery] = useState('');
  const [isGrantDialogOpen, setIsGrantDialogOpen] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null);

  // Requests State
  const [selectedRequest, setSelectedRequest] = useState<ClientRequest | null>(null);
  const [requestStatusFilter, setRequestStatusFilter] = useState<string>('__all__');

  // Data Fetching
  const { data: rawCustomers, loading: customersLoading } = useCollection<Customer>('customers', {
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  // Role-based filtering: Member/Viewer see only customers they created
  const customers = useFilteredByOwner(rawCustomers);
  const { data: leads } = useCollection<Lead>('leads', { skipTeamFilter: true });
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
    return customers.filter((customer) => {
      const q = searchQuery.toLowerCase().trim();
      if (q) {
        const match =
          customer.name?.toLowerCase().includes(q) ||
          customer.email?.toLowerCase().includes(q) ||
          customer.phone?.toLowerCase().includes(q) ||
          customer.company?.toLowerCase().includes(q) ||
          (customer as any).taxId?.toLowerCase().includes(q) ||
          (customer as any).contactPerson?.toLowerCase().includes(q) ||
          (customer as any).industry?.toLowerCase().includes(q);
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
      return true;
    });
  }, [customers, searchQuery, statusFilter, industryFilter, creditLimitFilter]);

  // Cap rendered rows so large customer lists don't mount hundreds of DOM nodes
  // at once (mobile jank). "Load more" reveals the rest of the filtered set.
  const [visibleCount, setVisibleCount] = useState(50);
  useEffect(() => { setVisibleCount(50); }, [searchQuery, statusFilter, industryFilter, creditLimitFilter]);
  const visibleCustomers = useMemo(
    () => filteredCustomers.slice(0, visibleCount),
    [filteredCustomers, visibleCount]
  );

  const statusCounts = useMemo(() => {
    if (!customers) return {};
    return customers.reduce((acc, c) => {
      const status = (c as any).status || 'Active';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [customers]);

  const hasActiveFilters = searchQuery || statusFilter !== '__all__' || industryFilter !== '__all__' || creditLimitFilter !== '__all__';

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('__all__');
    setIndustryFilter('__all__');
    setCreditLimitFilter('__all__');
  };

  const handleCreateCustomer = async (formData: FormData) => {
    const data: Record<string, any> = {};
    ['name', 'email', 'phone', 'company', 'address', 'website', 'industry',
     'taxId', 'billingAddress', 'shippingAddress', 'contactPerson', 'contactPhone',
     'notes', 'status', 'paymentTerms', 'tags'].forEach(key => {
      const val = formData.get(key) as string;
      if (val) data[key] = val;
    });
    const creditLimit = formData.get('creditLimit') as string;
    if (creditLimit) data.creditLimit = parseFloat(creditLimit);
    const assignedTo = formData.get('assignedToUserId') as string;
    data.assignedToUserId = assignedTo && assignedTo !== 'unassigned' ? assignedTo : null;
    data.disableOverdueReminders = formData.get('disableOverdueReminders') === 'true';

    // Duplicate check: email vs existing customers + leads
    const normEmail = data.email?.toLowerCase().trim();
    const normPhone = (data.phone as string | undefined)?.replace(/\D/g, '');
    if (normEmail) {
      if (customers?.some(c => c.email?.toLowerCase().trim() === normEmail)) {
        toast({ title: 'Ky email ekziston tek Klientët!', description: 'Ka një klient me këtë email.', variant: 'destructive' });
        return;
      }
      if (leads?.some((l: any) => l.email?.toLowerCase().trim() === normEmail)) {
        toast({ title: 'Ky email ekziston tek Leads!', description: 'Ka një lead me këtë email.', variant: 'destructive' });
        return;
      }
    }
    if (normPhone && normPhone.length >= 7) {
      if (customers?.some(c => c.phone?.replace(/\D/g, '') === normPhone)) {
        toast({ title: 'Ky numër ekziston tek Klientët!', description: 'Ka një klient me këtë numër telefoni.', variant: 'destructive' });
        return;
      }
      if (leads?.some((l: any) => l.phoneNumber?.replace(/\D/g, '') === normPhone)) {
        toast({ title: 'Ky numër ekziston tek Leads!', description: 'Ka një lead me këtë numër telefoni.', variant: 'destructive' });
        return;
      }
    }

    const created = await customerMutation.create(data as any);
    setIsCreateDialogOpen(false);

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
    await customerMutation.remove(id);
    const [invoicesSnap, accessSnap, requestsSnap, projectsSnap, activitiesSnap, inquiriesSnap] = await Promise.all([
      getDocs(query(collection(db, 'invoices'), where('customerId', '==', id))),
      getDocs(query(collection(db, 'clientPortalAccess'), where('customerId', '==', id))),
      getDocs(query(collection(db, 'clientRequests'), where('customerId', '==', id))),
      getDocs(query(collection(db, 'projects'), where('customerId', '==', id))),
      getDocs(query(collection(db, 'activities'), where('customerId', '==', id))),
      getDocs(query(collection(db, 'serviceInquiries'), where('customerId', '==', id))),
    ]);
    // Collect invoice IDs to also delete their line items
    const invoiceIds = invoicesSnap.docs.map(d => d.id);
    const itemSnapshots = await Promise.all(
      invoiceIds.map(invId => getDocs(query(collection(db, 'invoiceItems'), where('invoiceId', '==', invId))))
    );
    await Promise.all([
      ...invoicesSnap.docs.map(d => deleteDoc(doc(db, 'invoices', d.id))),
      ...accessSnap.docs.map(d => deleteDoc(doc(db, 'clientPortalAccess', d.id))),
      ...requestsSnap.docs.map(d => deleteDoc(doc(db, 'clientRequests', d.id))),
      ...projectsSnap.docs.map(d => deleteDoc(doc(db, 'projects', d.id))),
      ...activitiesSnap.docs.map(d => deleteDoc(doc(db, 'activities', d.id))),
      ...inquiriesSnap.docs.map(d => deleteDoc(doc(db, 'serviceInquiries', d.id))),
      ...itemSnapshots.flatMap(snap => snap.docs.map(d => deleteDoc(doc(db, 'invoiceItems', d.id)))),
    ]);
    toast({ title: 'Klienti u fshi!', description: 'Faturat, projektet, CRM dhe të dhënat e lidhura u fshinë gjithashtu.' });
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
    const creditLimit = formData.get('creditLimit') as string;
    data.creditLimit = creditLimit ? parseFloat(creditLimit) : null;
    const assignedTo = formData.get('assignedToUserId') as string;
    data.assignedToUserId = assignedTo && assignedTo !== 'unassigned' ? assignedTo : null;
    data.disableOverdueReminders = formData.get('disableOverdueReminders') === 'true';

    const normEmail = (data.email as string | undefined)?.toLowerCase().trim();
    const normPhone = (data.phone as string | undefined)?.replace(/\D/g, '');

    // Duplicate email check (exclude current customer, check leads too)
    if (normEmail) {
      if (customers?.some(c => c.id !== selectedCustomer.id && c.email?.toLowerCase().trim() === normEmail)) {
        toast({ title: 'Ky email ekziston tek Klientët!', description: 'Ka një klient tjetër me këtë email.', variant: 'destructive' });
        return;
      }
      if (leads?.some((l: any) => l.email?.toLowerCase().trim() === normEmail)) {
        toast({ title: 'Ky email ekziston tek Leads!', description: 'Ka një lead me këtë email.', variant: 'destructive' });
        return;
      }
    }
    // Duplicate phone check (exclude current customer, check leads too)
    if (normPhone && normPhone.length >= 7) {
      if (customers?.some(c => c.id !== selectedCustomer.id && c.phone?.replace(/\D/g, '') === normPhone)) {
        toast({ title: 'Ky numër ekziston tek Klientët!', description: 'Ka një klient tjetër me këtë numër telefoni.', variant: 'destructive' });
        return;
      }
      if (leads?.some((l: any) => l.phoneNumber?.replace(/\D/g, '') === normPhone)) {
        toast({ title: 'Ky numër ekziston tek Leads!', description: 'Ka një lead me këtë numër telefoni.', variant: 'destructive' });
        return;
      }
    }
    await customerMutation.update(selectedCustomer.id, data as any);
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
    return <div className="flex items-center justify-center h-96">Duke ngarkuar klientet...</div>;
  }

  const portalActiveCount = portalAccess?.filter(a => a.status === 'Active').length || 0;
  const newRequestsCount = requests?.filter(r => r.status === 'New').length || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Klientet</h1>
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
              <CustomerForm onSubmit={(data) => { setDirty(false); handleCreateCustomer(data); }} industries={allIndustries} onAddIndustry={() => setShowAddIndustry(true)} onDirtyChange={setDirty} teamMembers={teamMembers || []} getName={getName} canAssign={permissions.canManageMembers || permissions.role === 'Admin' || permissions.role === 'Manager'} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
            <div className="p-2 bg-purple-100 rounded-lg">
              <Clock className="h-5 w-5 text-purple-600" />
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
        <div className="overflow-x-auto">
          <TabsList className="min-w-max">
            <TabsTrigger value="customers" className="gap-1 sm:gap-2 text-xs sm:text-sm">
              <Building2 className="h-4 w-4" />
              <span className="hidden sm:inline">Klientet</span>
              <span className="sm:hidden">Kliente</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* TAB: Klientet */}
        <TabsContent value="customers" className="space-y-4">
          {/* Status Quick Filters */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
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
              <div className="flex gap-3">
                <div className="relative flex-1">
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
                      {[statusFilter !== '__all__', industryFilter !== '__all__', creditLimitFilter !== '__all__'].filter(Boolean).length}
                    </Badge>
                  )}
                </Button>
                {hasActiveFilters && (
                  <Button variant="ghost" onClick={clearFilters} className="gap-2 text-muted-foreground">
                    <X className="w-4 h-4" /> Pastro
                  </Button>
                )}
              </div>

              {showFilters && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t">
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
                </div>
              )}
            </div>
          </Card>

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
                  <Card key={customer.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{customer.name}</p>
                        {customer.company && <p className="text-sm text-muted-foreground">{customer.company}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
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

                  </Card>
                );
              })
            )}
            {filteredCustomers.length > visibleCount && (
              <Button variant="outline" className="w-full" onClick={() => setVisibleCount((c) => c + 50)}>
                Shfaq më shumë ({filteredCustomers.length - visibleCount})
              </Button>
            )}
          </div>

          {/* Customer Table - Desktop */}
          <Card className="overflow-hidden hidden sm:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
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
                      <td colSpan={5} className="px-6 py-12 text-center">
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
                        <tr key={customer.id} className="hover:bg-muted/50 transition-colors">
                          <td className="px-3 sm:px-6 py-3 sm:py-4">
                            <div className="space-y-1">
                              <p className="font-medium truncate max-w-[120px] sm:max-w-none">{customer.name}</p>
                              {cust.taxId && <p className="text-sm text-muted-foreground hidden sm:block">NIPT: {cust.taxId}</p>}
                              {cust.contactPerson && <p className="text-sm text-muted-foreground hidden sm:block">Kontakt: {cust.contactPerson}</p>}
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
                            <Badge className={`${statusOpt?.color || 'bg-gray-100 text-gray-800'} gap-1`}>
                              <StatusIcon className="w-3 h-3" />
                              {statusOpt?.label || cust.status || 'Aktiv'}
                            </Badge>
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
                <Button variant="outline" className="w-full" onClick={() => setVisibleCount((c) => c + 50)}>
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
                <CustomerForm onSubmit={(data) => { setDirty(false); handleUpdateCustomer(data); }} initialData={selectedCustomer} industries={allIndustries} onAddIndustry={() => setShowAddIndustry(true)} onDirtyChange={setDirty} teamMembers={teamMembers || []} getName={getName} canAssign={permissions.canManageMembers || permissions.role === 'Admin' || permissions.role === 'Manager'} />
              </DialogContent>
            </Dialog>
          )}
        </TabsContent>

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
        <DialogContent className="max-w-lg">
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
    </div>
  );
};

const CustomerForm: React.FC<{
  onSubmit: (data: FormData) => void;
  initialData?: Customer;
  industries?: string[];
  onAddIndustry?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  teamMembers?: TeamMember[];
  getName?: (userId: string | null | undefined, fallback?: string) => string;
  canAssign?: boolean;
}> = ({ onSubmit, initialData, industries = INDUSTRY_OPTIONS, onAddIndustry, onDirtyChange, teamMembers = [], getName, canAssign }) => {
  const init = initialData as any;
  const [status, setStatus] = useState(init?.status || 'Active');
  const [industry, setIndustry] = useState(init?.industry || '');
  const [assignedTo, setAssignedTo] = useState(init?.assignedToUserId || 'unassigned');
  const [disableOverdue, setDisableOverdue] = useState(!!init?.disableOverdueReminders);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('status', status);
    formData.set('industry', industry);
    formData.set('assignedToUserId', assignedTo);
    formData.set('disableOverdueReminders', String(disableOverdue));
    onSubmit(formData);
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
        <Label htmlFor="tags">Etiketat (te ndara me presje)</Label>
        <Input id="tags" name="tags" defaultValue={init?.tags} placeholder="p.sh. VIP, Prioritet, Lokal" />
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

      <Button type="submit" className="w-full">
        {initialData ? 'Perditeso Klientin' : 'Krijo Klientin'}
      </Button>
    </form>
  );
};

export default CustomersView;
