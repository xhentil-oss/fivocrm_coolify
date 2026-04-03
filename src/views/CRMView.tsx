import React, { useState, useMemo } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import type { WhatsAppMessage } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useActivityLogger } from '../hooks/useActivityLogger';
import { getStatusColor } from '../lib/statusColors';
import { useToast } from '../hooks/use-toast';
import { Mail, Phone, Building, DollarSign, TrendingUp, Plus, Calendar as CalendarIcon, Zap, Trash2, MoreVertical, Search, X, UserCircle, Edit2, Percent, MessageSquare, ExternalLink } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Calendar } from '../components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import DetailDrawer from '../components/DetailDrawer';
import WhatsAppChatPanel from '../components/WhatsAppChatPanel';
import { useFilteredByOwner } from '../hooks/useRoleFilteredData';
import { useUserNames } from '../hooks/useUserNames';
import { safeHref } from '../lib/utils';
import type { Lead, ClientPortalAccess, Customer, Notification, TeamMember } from '../types';

const CRMView: React.FC = () => {
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [whatsappLead, setWhatsappLead] = useState<Lead | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [lostReasonLead, setLostReasonLead] = useState<Lead | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [saving, setSaving] = useState(false);
  const [leadToDelete, setLeadToDelete] = useState<Lead | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [scoreFilter, setScoreFilter] = useState('all');
  const [assignedFilter, setAssignedFilter] = useState('all');
  const { toast } = useToast();

  const { user } = useAuth();
  const permissions = usePermissions();
  const logActivity = useActivityLogger();
  const { data: rawLeads, loading: leadsLoading } = useCollection<Lead>('leads', {
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  // Role-based filtering: Member/Viewer see only leads they created
  const leads = useFilteredByOwner(rawLeads);
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }]
  });
  const leadMutation = useMutation<Lead>('leads');
  const customerMutation = useMutation<Customer>('customers');
  const { data: allWaMessages } = useCollection<WhatsAppMessage>('whatsappMessages', { skipTeamFilter: true });

  // Unread WA count per lead phone
  const waUnreadByPhone = useMemo(() => {
    const map = new Map<string, number>();
    if (!allWaMessages) return map;
    // Count inbound messages that were not generated from platform (status=received)
    // Treat all inbound as unread for now — future: track read state per leadId
    allWaMessages.forEach(m => {
      if (m.direction === 'inbound' && m.status === 'received') {
        const key = m.phone.replace(/[^\d]/g, '');
        map.set(key, (map.get(key) || 0) + 1);
      }
    });
    return map;
  }, [allWaMessages]);
  const notificationMutation = useMutation<Notification>('notifications');
  const portalAccessMutation = useMutation<ClientPortalAccess>('clientPortalAccess');
  const { getName } = useUserNames(teamMembers || []);

  const STAGE_PROBABILITY: Record<string, number> = {
    'New': 10,
    'Contacted': 20,
    'Qualified': 40,
    'Follow-up': 30,
    'Proposal': 70,
    'Won': 100,
    'Converted': 100,
    'Lost': 0,
  };

  const LOST_REASONS = [
    'Çmimi i lartë',
    'Koha e gjatë',
    'Konkurrenca',
    'Nuk përgjigjet',
    'Nuk ka buxhet',
    'Zgjodhi tjetër',
    'Nuk ka nevojë më',
    'Tjetër',
  ];



  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'New': return 'I Ri';
      case 'Contacted': return 'Kontaktuar';
      case 'Qualified': return 'Kualifikuar';
      case 'Follow-up': return 'Në Ndjekje';
      case 'Converted': return 'Konvertuar';
      case 'Lost': return 'Humbur';
      default: return status;
    }
  };

  const handleCreateLead = async (formData: FormData) => {
    if (saving) return;
    setSaving(true);
    try {
    const name = formData.get('name') as string;
    const email = formData.get('email') as string;
    const status = formData.get('status') as string;
    const lastFollowUpDate = formData.get('lastFollowUpDate') as string;
    const phoneNumber = formData.get('phoneNumber') as string;
    const address = formData.get('address') as string;
    const company = formData.get('company') as string;
    const jobTitle = formData.get('jobTitle') as string;
    const website = formData.get('website') as string;
    const source = formData.get('source') as string;
    const businessCategory = formData.get('businessCategory') as string;
    const notes = formData.get('notes') as string;
    const estimatedValue = formData.get('estimatedValue') as string;
    const assignedToUserId = formData.get('assignedToUserId') as string;
    const resolvedAssigned = assignedToUserId && assignedToUserId !== 'unassigned' ? assignedToUserId : undefined;

    await leadMutation.create({
      name,
      email: email || undefined,
      status,
      lastFollowUpDate: lastFollowUpDate ? new Date(lastFollowUpDate) : undefined,
      phoneNumber: phoneNumber || undefined,
      address: address || undefined,
      company: company || undefined,
      jobTitle: jobTitle || undefined,
      website: website || undefined,
      source: source || undefined,
      businessCategory,
      notes: notes || undefined,
      estimatedValue: estimatedValue ? parseFloat(estimatedValue) : undefined,
      probability: STAGE_PROBABILITY[status] ?? 10,
      score: calculateLeadScore({ name, email, phoneNumber, company, estimatedValue: estimatedValue ? parseFloat(estimatedValue) : undefined }),
      assignedToUserId: resolvedAssigned,
    });

    // Notify assigned user
    if (resolvedAssigned && user && resolvedAssigned !== user.uid) {
      await notificationMutation.create({
        userId: resolvedAssigned,
        title: 'Lead i asignuar ty',
        message: `${user.displayName || 'Një admin'} të asignoi lead-in "${name}"`,
        isRead: false,
      }).catch(() => {});
    }

    logActivity('lead_created', `Lead i ri: ${name}`, { entityType: 'lead', description: company || email || '' });
    setIsCreateDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleEditLead = async (formData: FormData) => {
    if (saving || !editLead) return;
    setSaving(true);
    try {
      const name = formData.get('name') as string;
      const email = formData.get('email') as string;
      const status = formData.get('status') as string;
      const lastFollowUpDate = formData.get('lastFollowUpDate') as string;
      const phoneNumber = formData.get('phoneNumber') as string;
      const address = formData.get('address') as string;
      const company = formData.get('company') as string;
      const jobTitle = formData.get('jobTitle') as string;
      const website = formData.get('website') as string;
      const source = formData.get('source') as string;
      const businessCategory = formData.get('businessCategory') as string;
      const notes = formData.get('notes') as string;
      const estimatedValue = formData.get('estimatedValue') as string;
      const assignedToUserId = formData.get('assignedToUserId') as string;
      const resolvedAssigned = assignedToUserId && assignedToUserId !== 'unassigned' ? assignedToUserId : undefined;

      await leadMutation.update(editLead.id, {
        name,
        email: email || undefined,
        status,
        lastFollowUpDate: lastFollowUpDate ? new Date(lastFollowUpDate) : undefined,
        phoneNumber: phoneNumber || undefined,
        address: address || undefined,
        company: company || undefined,
        jobTitle: jobTitle || undefined,
        website: website || undefined,
        source: source || undefined,
        businessCategory,
        notes: notes || undefined,
        estimatedValue: estimatedValue ? parseFloat(estimatedValue) : undefined,
        probability: STAGE_PROBABILITY[status] ?? editLead.probability,
        score: calculateLeadScore({ name, email, phoneNumber, company, estimatedValue: estimatedValue ? parseFloat(estimatedValue) : undefined }),
        assignedToUserId: resolvedAssigned,
      });

      toast({ title: 'Lead u përditësua', description: `${name} u përditësua me sukses.` });
      setEditLead(null);
    } finally {
      setSaving(false);
    }
  };

  // Lead Scoring: 0-100 based on data completeness & value
  const calculateLeadScore = (lead: Partial<Lead> & Record<string, any>): number => {
    let score = 0;
    if (lead.name) score += 10;
    if (lead.email) score += 15;
    if (lead.phoneNumber) score += 10;
    if (lead.company) score += 15;
    if (lead.website) score += 5;
    if (lead.source) score += 5;
    if (lead.estimatedValue && lead.estimatedValue > 0) {
      score += Math.min(30, Math.round(lead.estimatedValue / 1000) * 5);
    }
    if (lead.lastFollowUpDate) score += 10;
    return Math.min(100, score);
  };

  const handleAssignLead = async (lead: Lead, assignedToUserId: string) => {
    const resolved = assignedToUserId && assignedToUserId !== 'unassigned' ? assignedToUserId : undefined;
    await leadMutation.update(lead.id, { assignedToUserId: resolved });
    if (resolved && user && resolved !== user.uid) {
      await notificationMutation.create({
        userId: resolved,
        title: 'Lead i asignuar ty',
        message: `${user.displayName || 'Një admin'} të asignoi lead-in "${lead.name}"`,
        isRead: false,
      }).catch(() => {});
    }
  };

  const handleDeleteLead = async (id: string) => {
    await leadMutation.remove(id);
    setLeadToDelete(null);
  };

  const handleFollowUp = async (leadId: string) => {
    await leadMutation.update(leadId, {
      lastFollowUpDate: new Date(),
      status: 'Follow-up',
    });
  };

  const handleStatusChange = async (lead: Lead, newStatus: string) => {
    // If status is "Lost", prompt for reason before proceeding
    if (newStatus === 'Lost') {
      setLostReasonLead(lead);
      setLostReason('');
      return;
    }

    // If status is "Converted", create a customer + portal access, then delete the lead
    if (newStatus === 'Converted') {
      let customerDoc: { id: string } | undefined | null = null;
      try {
        customerDoc = await customerMutation.create({
          name: lead.name,
          email: lead.email,
          phone: lead.phoneNumber,
          address: lead.address,
          company: lead.company,
          website: lead.website,
          notes: lead.notes,
          status: 'Active',
          leadId: lead.id,
        });

        // Auto-create client portal access if customer has an email
        if (lead.email && customerDoc?.id) {
          await portalAccessMutation.create({
            customerId: customerDoc.id,
            userId: '', // Will be linked when client registers/logs in
            email: lead.email,
            status: 'Active',
          });
        }
      } catch (err) {
        // If portal access creation failed after customer was created, roll back customer
        if (customerDoc?.id) {
          await customerMutation.remove(customerDoc.id);
        }
        toast({ title: 'Gabim gjatë konvertimit', description: 'Ndodhi një gabim. Statusi nuk u ndryshua.', variant: 'destructive' });
        return;
      }

      // Delete the lead — it now lives as a Customer
      await leadMutation.remove(lead.id);

      // Send notification to Admin + Sales (canAccessCRM) team members (best-effort)
      if (user && teamMembers) {
        const notifyPromises = teamMembers
          .filter(m => m.userId !== user.uid && (m.role === 'Admin' || m.canAccessCRM))
          .map(m => notificationMutation.create({
            userId: m.userId,
            title: 'Lead u konvertua në Klient',
            message: `${lead.name} u konvertua me sukses në klient!`,
            isRead: false,
          }));
        await Promise.all(notifyPromises).catch(() => {});
      }

      logActivity('lead_converted', `Lead u konvertua: ${lead.name}`, { entityType: 'lead', entityId: lead.id });
      toast({ title: 'Lead u konvertua', description: `${lead.name} tani është klient.` });
      return;
    }

    // Normal status change (not conversion)
    const update: Record<string, any> = { status: newStatus, probability: STAGE_PROBABILITY[newStatus] ?? undefined };
    if (newStatus === 'Follow-up') update.lastFollowUpDate = new Date();
    await leadMutation.update(lead.id, update);
  };

  const handleConfirmLost = async () => {
    if (!lostReasonLead) return;
    await leadMutation.update(lostReasonLead.id, {
      status: 'Lost',
      probability: 0,
      lostReason: lostReason || undefined,
    });
    toast({ title: 'Lead u shënja si i humbur', description: lostReason ? `Arsyeja: ${lostReason}` : undefined });
    setLostReasonLead(null);
    setLostReason('');
  };

  const filteredLeads = React.useMemo(() => {
    if (!leads) return [];
    let result = leads;
    if (activeTab !== 'all') result = result.filter(l => l.status === activeTab);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.email?.toLowerCase().includes(q) ||
        l.company?.toLowerCase().includes(q)
      );
    }
    if (sourceFilter !== 'all') result = result.filter(l => l.source === sourceFilter);
    if (scoreFilter !== 'all') result = result.filter(l => {
      const s = (l as any).score ?? calculateLeadScore(l);
      if (scoreFilter === 'high') return s >= 70;
      if (scoreFilter === 'medium') return s >= 40 && s < 70;
      if (scoreFilter === 'low') return s < 40;
      return true;
    });
    if (assignedFilter === 'mine') result = result.filter(l => l.assignedToUserId === user?.uid);
    if (assignedFilter === 'unassigned') result = result.filter(l => !l.assignedToUserId);
    return result;
  }, [leads, activeTab, searchQuery, sourceFilter, scoreFilter, assignedFilter, user]);

  const needsFollowUp = React.useMemo(() => {
    if (!leads) return [];
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    return leads.filter(lead => {
      if (!lead.lastFollowUpDate) return true;
      return new Date(lead.lastFollowUpDate) < thirtyDaysAgo;
    });
  }, [leads]);

  if (leadsLoading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-8 w-40 skeleton rounded" />
            <div className="h-4 w-56 skeleton rounded" />
          </div>
          <div className="h-10 w-28 skeleton rounded" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-6 bg-card rounded-lg border space-y-3">
              <div className="flex justify-between">
                <div className="h-4 w-24 skeleton rounded" />
                <div className="h-5 w-5 skeleton rounded" />
              </div>
              <div className="h-8 w-16 skeleton rounded" />
            </div>
          ))}
        </div>
        <div className="h-10 w-full skeleton rounded" />
        <div className="bg-card rounded-lg border overflow-hidden">
          <div className="h-12 w-full skeleton" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 w-full skeleton border-t" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-h2 text-foreground">CRM - Leads</h1>
          <p className="text-body text-muted-foreground mt-1">
            {leads?.length || 0} lead total · {needsFollowUp.length} kanë nevojë për ndjekje
          </p>
        </div>
        {permissions.canEdit && (
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground w-full sm:w-auto">
                <Plus className="w-4 h-4 mr-2" />
                Lead i Ri
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Krijo Lead të Ri</DialogTitle>
              </DialogHeader>
              <LeadForm onSubmit={handleCreateLead} disabled={saving} teamMembers={teamMembers || []} getName={getName} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Search & Filter bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Kërko sipas emrit, email, kompanisë..."
            className="pl-9 h-9"
          />
          {searchQuery && (
            <button className="absolute right-3 top-2.5" onClick={() => setSearchQuery('')}>
              <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-full sm:w-[150px] h-9">
            <SelectValue placeholder="Burimi" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Të gjithë burimet</SelectItem>
            <SelectItem value="Website">Faqja Web</SelectItem>
            <SelectItem value="Referral">Referim</SelectItem>
            <SelectItem value="Cold Call">Thirrje e Ftoftë</SelectItem>
            <SelectItem value="Social Media">Rrjete Sociale</SelectItem>
            <SelectItem value="Email Campaign">Fushata Email</SelectItem>
            <SelectItem value="Event">Event</SelectItem>
            <SelectItem value="Other">Tjetër</SelectItem>
          </SelectContent>
        </Select>
        <Select value={scoreFilter} onValueChange={setScoreFilter}>
          <SelectTrigger className="w-full sm:w-[145px] h-9">
            <SelectValue placeholder="Pikët" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Të gjitha pikët</SelectItem>
            <SelectItem value="high">I lartë (70+)</SelectItem>
            <SelectItem value="medium">Mesatar (40–69)</SelectItem>
            <SelectItem value="low">I ulët (&lt;40)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={assignedFilter} onValueChange={setAssignedFilter}>
          <SelectTrigger className="w-full sm:w-[140px] h-9">
            <SelectValue placeholder="Asignuara" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Të gjitha</SelectItem>
            <SelectItem value="mine">Të miat</SelectItem>
            <SelectItem value="unassigned">Pa asignuar</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-6 stagger-children">
        <Card className="p-3 sm:p-6 space-y-1 sm:space-y-2 card-hover metric-card-primary border-l-4 border-l-primary">
          <div className="flex items-center justify-between">
            <p className="text-xs sm:text-body-sm text-muted-foreground">Lead Totale</p>
            <div className="p-1.5 sm:p-2 bg-primary/10 rounded-lg">
              <Building className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
            </div>
          </div>
          <p className="text-lg sm:text-h2 text-foreground font-medium animate-count-up">
            {leads?.length || 0}
          </p>
          <p className="text-xs text-muted-foreground hidden sm:block">Të gjitha lead-et</p>
        </Card>

        <Card className="p-3 sm:p-6 space-y-1 sm:space-y-2 card-hover metric-card-success border-l-4 border-l-success">
          <div className="flex items-center justify-between">
            <p className="text-xs sm:text-body-sm text-muted-foreground">Kualifikuara</p>
            <div className="p-1.5 sm:p-2 bg-success/10 rounded-lg">
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-success" />
            </div>
          </div>
          <p className="text-lg sm:text-h2 text-foreground font-medium animate-count-up">
            {leads?.filter(l => l.status === 'Qualified').length || 0}
          </p>
          <p className="text-xs text-success hidden sm:block">Të kualifikuara</p>
        </Card>

        <Card className="p-3 sm:p-6 space-y-1 sm:space-y-2 card-hover metric-card-info border-l-4 border-l-accent">
          <div className="flex items-center justify-between">
            <p className="text-xs sm:text-body-sm text-muted-foreground">Konvertuara</p>
            <div className="p-1.5 sm:p-2 bg-accent/10 rounded-lg">
              <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-accent" />
            </div>
          </div>
          <p className="text-lg sm:text-h2 text-foreground font-medium animate-count-up">
            {leads?.filter(l => l.status === 'Converted').length || 0}
          </p>
          <p className="text-xs text-accent hidden sm:block">Të konvertuara</p>
        </Card>

        <Card className="p-3 sm:p-6 space-y-1 sm:space-y-2 card-hover metric-card-warning border-l-4 border-l-warning">
          <div className="flex items-center justify-between">
            <p className="text-xs sm:text-body-sm text-muted-foreground">Për ndjekje</p>
            <div className="p-1.5 sm:p-2 bg-warning/10 rounded-lg">
              <CalendarIcon className="w-4 h-4 sm:w-5 sm:h-5 text-warning" />
            </div>
          </div>
          <p className="text-lg sm:text-h2 text-foreground font-medium animate-count-up">
            {needsFollowUp.length}
          </p>
          <p className="text-xs text-warning hidden sm:block">Kërkojnë ndjekje</p>
        </Card>

        <Card className="p-3 sm:p-6 space-y-1 sm:space-y-2 card-hover border-l-4 border-l-tertiary">
          <div className="flex items-center justify-between">
            <p className="text-xs sm:text-body-sm text-muted-foreground">Forecast</p>
            <div className="p-1.5 sm:p-2 bg-tertiary/10 rounded-lg">
              <Percent className="w-4 h-4 sm:w-5 sm:h-5 text-tertiary" />
            </div>
          </div>
          <p className="text-lg sm:text-h2 text-foreground font-medium animate-count-up">
            {(() => {
              const val = (leads || [])
                .filter(l => l.status !== 'Lost' && l.status !== 'Converted')
                .reduce((sum, l) => {
                  const prob = (l.probability ?? STAGE_PROBABILITY[l.status] ?? 0) / 100;
                  return sum + (l.estimatedValue || 0) * prob;
                }, 0);
              return `${Math.round(val).toLocaleString()} L`;
            })()}
          </p>
          <p className="text-xs text-tertiary hidden sm:block">Vlera e ponderuar</p>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto">
          <TabsList className="min-w-max">
            <TabsTrigger value="all" className="text-xs sm:text-sm">Të gjitha</TabsTrigger>
            <TabsTrigger value="New" className="text-xs sm:text-sm">Të reja</TabsTrigger>
            <TabsTrigger value="Contacted" className="text-xs sm:text-sm">Kontaktuara</TabsTrigger>
            <TabsTrigger value="Qualified" className="text-xs sm:text-sm">Kualifikuara</TabsTrigger>
            <TabsTrigger value="Follow-up" className="text-xs sm:text-sm">Në ndjekje</TabsTrigger>
            <TabsTrigger value="Converted" className="text-xs sm:text-sm">Konvertuara</TabsTrigger>
            <TabsTrigger value="Lost" className="text-xs sm:text-sm">Humbura</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value={activeTab} className="mt-6">
          {/* Mobile card layout */}
          <div className="sm:hidden space-y-3">
            {filteredLeads.map((lead) => {
              const s = (lead as any).score ?? calculateLeadScore(lead);
              const scoreColor = s >= 70 ? 'text-green-600' : s >= 40 ? 'text-yellow-600' : 'text-red-500';
              const leadPhone = (lead.phoneNumber || lead.phone || '').replace(/[^\d]/g, '');
              const waUnread = leadPhone ? (waUnreadByPhone.get(leadPhone) || 0) : 0;
              return (
                <Card key={lead.id} className="p-4 space-y-3" onClick={() => setSelectedLead(lead)}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{lead.name}</p>
                      {lead.company && <p className="text-sm text-muted-foreground">{lead.company}</p>}
                      {lead.jobTitle && <p className="text-xs text-muted-foreground">{lead.jobTitle}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {waUnread > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setWhatsappLead(lead); }}
                          className="flex items-center gap-1 bg-[#25D366] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full hover:bg-[#1da851] transition-colors"
                        >
                          <MessageSquare className="w-3 h-3" />
                          {waUnread}
                        </button>
                      )}
                      <div className="flex items-center gap-0.5">
                        <Zap className={`w-3 h-3 ${scoreColor}`} />
                        <span className={`text-xs font-semibold ${scoreColor}`}>{s}</span>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {lead.phoneNumber && (
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setWhatsappLead(lead); }} className="text-[#25D366]">
                              <MessageSquare className="w-3.5 h-3.5 mr-2" /> WhatsApp
                            </DropdownMenuItem>
                          )}
                          {permissions.canEdit && (
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditLead(lead); }}>
                              <Edit2 className="w-3.5 h-3.5 mr-2" /> Ndrysho
                            </DropdownMenuItem>
                          )}
                          {permissions.canEdit && (
                            <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); setLeadToDelete(lead); }}>
                              <Trash2 className="w-3.5 h-3.5 mr-2" /> Fshi
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={getStatusColor(lead.status)}>
                      {getStatusLabel(lead.status)}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      <Percent className="w-3 h-3 mr-0.5" />
                      {lead.probability ?? STAGE_PROBABILITY[lead.status] ?? 0}%
                    </Badge>
                    {lead.source && <Badge variant="outline" className="text-xs">{lead.source}</Badge>}
                    {lead.estimatedValue ? (
                      <span className="text-xs font-medium text-foreground">{lead.estimatedValue.toLocaleString()} L</span>
                    ) : null}
                  </div>
                  {lead.status === 'Lost' && lead.lostReason && (
                    <p className="text-xs text-destructive">Arsyeja: {lead.lostReason}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {lead.email && (
                      <div className="flex items-center gap-1"><Mail className="w-3 h-3" />{lead.email}</div>
                    )}
                    {lead.phoneNumber && (
                      <div className="flex items-center gap-1"><Phone className="w-3 h-3" />{lead.phoneNumber}</div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Ndjekja e fundit: {lead.lastFollowUpDate ? new Date(lead.lastFollowUpDate).toLocaleDateString() : 'Asnjëherë'}
                  </div>
                  {lead.assignedToUserId && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <UserCircle className="w-3 h-3" />
                      {getName(lead.assignedToUserId, 'Pa emër')}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          {/* Desktop table */}
          <Card className="overflow-hidden hidden sm:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Kontakti
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Kompania
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Statusi
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Burimi
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Asignuar
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Vlera Est.
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Pikët
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Prob.
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Ndjekja e fundit
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Veprime
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredLeads.map((lead) => (
                    <tr
                      key={lead.id}
                      className="hover:bg-muted/50 cursor-pointer transition-colors duration-fast"
                      onClick={() => setSelectedLead(lead)}
                    >
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          <p className="text-body font-normal text-foreground">{lead.name}</p>
                          {lead.jobTitle && (
                            <p className="text-body-sm text-muted-foreground">{lead.jobTitle}</p>
                          )}
                          {lead.email && (
                            <div className="flex items-center gap-1 text-body-sm text-muted-foreground">
                              <Mail className="w-3 h-3" />
                              {lead.email}
                            </div>
                          )}
                          {lead.phoneNumber && (
                            <div className="flex items-center gap-1 text-body-sm text-muted-foreground">
                              <Phone className="w-3 h-3" />
                              {lead.phoneNumber}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          {lead.company && (
                            <p className="text-body font-normal text-foreground">{lead.company}</p>
                          )}
                          {lead.website && (
                            <a 
                              href={safeHref(lead.website)} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-body-sm text-primary hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {lead.website}
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Select
                          value={lead.status}
                          onValueChange={(newStatus) => {
                            handleStatusChange(lead, newStatus);
                          }}
                        >
                          <SelectTrigger className="w-[140px]" onClick={(e) => e.stopPropagation()}>
                            <SelectValue>
                              <Badge className={getStatusColor(lead.status)}>
                                {getStatusLabel(lead.status)}
                              </Badge>
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="New">I Ri</SelectItem>
                            <SelectItem value="Contacted">Kontaktuar</SelectItem>
                            <SelectItem value="Qualified">Kualifikuar</SelectItem>
                            <SelectItem value="Follow-up">Në Ndjekje</SelectItem>
                            <SelectItem value="Converted">Konvertuar</SelectItem>
                            <SelectItem value="Lost">Humbur</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-6 py-4 text-body text-foreground">
                        {lead.source || '-'}
                      </td>
                      <td className="px-6 py-4" onClick={e => e.stopPropagation()}>
                        {permissions.canEdit ? (
                          <Select
                            value={lead.assignedToUserId || 'unassigned'}
                            onValueChange={val => handleAssignLead(lead, val === 'unassigned' ? '' : val)}
                          >
                            <SelectTrigger className="w-[130px] h-8 text-xs">
                              <SelectValue>
                                <div className="flex items-center gap-1">
                                  <UserCircle className="w-3 h-3 text-muted-foreground" />
                                  <span className="truncate max-w-[80px]">
                                    {lead.assignedToUserId ? getName(lead.assignedToUserId, '…') : 'Pa asignuar'}
                                  </span>
                                </div>
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unassigned">Pa asignuar</SelectItem>
                              {(teamMembers || []).filter(m => m.status === 'Active').map(m => (
                                <SelectItem key={m.userId} value={m.userId}>
                                  {getName(m.userId, m.email || m.userId)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-body text-foreground">
                            {lead.assignedToUserId ? getName(lead.assignedToUserId, '—') : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-body text-foreground">
                        {lead.estimatedValue 
                          ? `${lead.estimatedValue.toLocaleString()} L`
                          : '-'}
                      </td>
                      <td className="px-6 py-4">
                        {(() => {
                          const s = (lead as any).score ?? calculateLeadScore(lead);
                          const color = s >= 70 ? 'text-green-600' : s >= 40 ? 'text-yellow-600' : 'text-red-500';
                          return (
                            <div className="flex items-center gap-1">
                              <Zap className={`w-3.5 h-3.5 ${color}`} />
                              <span className={`font-semibold ${color}`}>{s}</span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4">
                        {(() => {
                          const prob = lead.probability ?? STAGE_PROBABILITY[lead.status] ?? 0;
                          const color = prob >= 60 ? 'text-green-600' : prob >= 30 ? 'text-yellow-600' : 'text-red-500';
                          return (
                            <span className={`font-semibold ${color}`}>{prob}%</span>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4 text-body text-foreground">
                        {lead.lastFollowUpDate 
                          ? new Date(lead.lastFollowUpDate).toLocaleDateString()
                          : 'Asnjëherë'}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          {lead.phoneNumber && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-[#25D366] border-[#25D366]/30 hover:bg-[#25D366]/10"
                              onClick={(e) => { e.stopPropagation(); setWhatsappLead(lead); }}
                              title="WhatsApp"
                            >
                              <MessageSquare className="w-4 h-4" />
                            </Button>
                          )}
                          {permissions.canEdit && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditLead(lead);
                              }}
                              title="Ndrysho"
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                          )}
                          {permissions.canEdit && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLeadToDelete(lead);
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <DetailDrawer
        open={!!selectedLead}
        onClose={() => setSelectedLead(null)}
        title={selectedLead?.name || ''}
        data={selectedLead}
        onSaveNotes={selectedLead ? async (notes) => {
          await leadMutation.update(selectedLead.id, { notes });
        } : undefined}
        actions={selectedLead ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Kontakto</p>
            <div className="flex flex-wrap gap-2">
              {selectedLead.email && (
                <Button variant="outline" size="sm" asChild>
                  <a href={`mailto:${selectedLead.email}`}>
                    <Mail className="w-4 h-4 mr-1.5" />
                    Email
                  </a>
                </Button>
              )}
              {selectedLead.phoneNumber && (
                <Button variant="outline" size="sm" asChild>
                  <a href={`tel:${selectedLead.phoneNumber}`}>
                    <Phone className="w-4 h-4 mr-1.5" />
                    Thirr
                  </a>
                </Button>
              )}
              {selectedLead.phoneNumber && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-[#25D366] border-[#25D366]/30 hover:bg-[#25D366]/10"
                  onClick={() => { setSelectedLead(null); setWhatsappLead(selectedLead); }}
                >
                  <MessageSquare className="w-4 h-4 mr-1.5" />
                  WhatsApp Chat
                </Button>
              )}
              {selectedLead.phoneNumber && (
                <Button variant="outline" size="sm" asChild>
                  <a href={`sms:${selectedLead.phoneNumber}`}>
                    <MessageSquare className="w-4 h-4 mr-1.5" />
                    SMS
                  </a>
                </Button>
              )}
              {selectedLead.website && (
                <Button variant="outline" size="sm" asChild>
                  <a href={safeHref(selectedLead.website)} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4 mr-1.5" />
                    Website
                  </a>
                </Button>
              )}
            </div>
            {selectedLead.status === 'Lost' && selectedLead.lostReason && (
              <div className="mt-2 p-2 bg-destructive/10 border border-destructive/20 rounded-md">
                <p className="text-xs text-destructive font-medium">Arsyeja e humbjes: {selectedLead.lostReason}</p>
              </div>
            )}
          </div>
        ) : undefined}
      />

      {/* Delete Lead Confirmation */}
      <Dialog open={!!leadToDelete} onOpenChange={(open) => { if (!open) setLeadToDelete(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Fshi Lead</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Je i sigurt që dëshiron të fshish <span className="font-semibold text-foreground">{leadToDelete?.name}</span>?</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setLeadToDelete(null)}>Anulo</Button>
            <Button variant="destructive" onClick={() => leadToDelete && handleDeleteLead(leadToDelete.id)}>Fshi</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Lead Dialog */}
      <Dialog open={!!editLead} onOpenChange={(open) => { if (!open) setEditLead(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ndrysho Lead</DialogTitle>
          </DialogHeader>
          {editLead && (
            <LeadForm
              onSubmit={handleEditLead}
              initialData={editLead}
              disabled={saving}
              teamMembers={teamMembers || []}
              getName={getName}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Lost Reason Dialog */}
      <Dialog open={!!lostReasonLead} onOpenChange={(open) => { if (!open) { setLostReasonLead(null); setLostReason(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Arsyeja e Humbjes</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Pse u humb lead-i <span className="font-semibold text-foreground">{lostReasonLead?.name}</span>?</p>
          <Select value={lostReason} onValueChange={setLostReason}>
            <SelectTrigger>
              <SelectValue placeholder="Zgjidh arsyen..." />
            </SelectTrigger>
            <SelectContent>
              {LOST_REASONS.map(r => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setLostReasonLead(null); setLostReason(''); }}>Anulo</Button>
            <Button variant="destructive" onClick={handleConfirmLost}>Shëno si të Humbur</Button>
          </div>
        </DialogContent>
      </Dialog>
      {whatsappLead && (
        <WhatsAppChatPanel
          phone={whatsappLead.phoneNumber || whatsappLead.phone || ''}
          leadName={whatsappLead.name}
          leadId={whatsappLead.id}
          onClose={() => setWhatsappLead(null)}
        />
      )}
    </div>
  );
};

const LeadForm: React.FC<{
  onSubmit: (data: FormData) => void;
  initialData?: Lead;
  disabled?: boolean;
  teamMembers?: TeamMember[];
  getName?: (userId: string | null | undefined, fallback?: string) => string;
}> = ({ onSubmit, initialData, disabled, teamMembers = [], getName }) => {
  // Split existing phoneNumber into prefix + local
  const PHONE_PREFIXES = ['+355','+383','+389','+381','+382','+385','+387','+386','+49','+43','+41','+39','+44','+1','+33','+34','+30','+90'];
  const parsePhone = (phone?: string) => {
    if (!phone) return { prefix: '+355', local: '' };
    for (const p of PHONE_PREFIXES) {
      if (phone.startsWith(p)) return { prefix: p, local: phone.slice(p.length).trim() };
    }
    // Try generic +XX or +XXX
    const m = phone.match(/^(\+\d{1,3})\s*(.*)/);
    if (m) return { prefix: m[1], local: m[2] };
    return { prefix: '+355', local: phone };
  };
  const parsed = parsePhone(initialData?.phoneNumber);
  const [phonePrefix, setPhonePrefix] = useState(parsed.prefix);

  const [lastFollowUpDate, setLastFollowUpDate] = useState<Date | undefined>(
    initialData?.lastFollowUpDate ? new Date(initialData.lastFollowUpDate) : undefined
  );

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    if (lastFollowUpDate) {
      formData.set('lastFollowUpDate', lastFollowUpDate.toISOString());
    }
    // Combine prefix + local phone number
    const localPhone = (formData.get('phoneLocal') as string || '').trim();
    formData.delete('phoneLocal');
    formData.set('phoneNumber', localPhone ? `${phonePrefix} ${localPhone}` : '');
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto px-1">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="name">Emri *</Label>
          <Input id="name" name="name" required defaultValue={initialData?.name} />
        </div>

        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={initialData?.email} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="phoneLocal">Numri i Telefonit</Label>
          <div className="flex gap-1">
            <Select value={phonePrefix} onValueChange={setPhonePrefix}>
              <SelectTrigger className="w-[100px] shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PHONE_PREFIXES.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input id="phoneLocal" name="phoneLocal" type="tel" placeholder="69 123 4567" className="flex-1" defaultValue={parsed.local} />
          </div>
        </div>

        <div>
          <Label htmlFor="company">Kompania</Label>
          <Input id="company" name="company" defaultValue={initialData?.company} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="jobTitle">Pozita e Punës</Label>
          <Input id="jobTitle" name="jobTitle" defaultValue={initialData?.jobTitle} />
        </div>

        <div>
          <Label htmlFor="website">Faqja e Internetit</Label>
          <Input id="website" name="website" type="url" defaultValue={initialData?.website} />
        </div>
      </div>

      <div>
        <Label htmlFor="businessCategory">Kategoria e Biznesit *</Label>
        <Select name="businessCategory" required defaultValue={initialData?.businessCategory || ''}>
          <SelectTrigger>
            <SelectValue placeholder="Zgjidh kategorinë" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Teknologji">Teknologji</SelectItem>
            <SelectItem value="Tregti">Tregti</SelectItem>
            <SelectItem value="Shërbime">Shërbime</SelectItem>
            <SelectItem value="Prodhim">Prodhim</SelectItem>
            <SelectItem value="Ndërtim">Ndërtim</SelectItem>
            <SelectItem value="Arsim">Arsim</SelectItem>
            <SelectItem value="Shëndetësi">Shëndetësi</SelectItem>
            <SelectItem value="Transport">Transport</SelectItem>
            <SelectItem value="Hoteleri & Turizëm">Hoteleri & Turizëm</SelectItem>
            <SelectItem value="Bujqësi">Bujqësi</SelectItem>
            <SelectItem value="Financa & Sigurime">Financa & Sigurime</SelectItem>
            <SelectItem value="Pasuri të Paluajtshme">Pasuri të Paluajtshme</SelectItem>
            <SelectItem value="Marketing & Media">Marketing & Media</SelectItem>
            <SelectItem value="Ushqim & Pije">Ushqim & Pije</SelectItem>
            <SelectItem value="Tjetër">Tjetër</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
          <Label htmlFor="address">Adresa</Label>
        <Textarea id="address" name="address" rows={2} defaultValue={initialData?.address} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="status">Statusi *</Label>
          <Select name="status" defaultValue={initialData?.status || 'New'}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="New">I Ri</SelectItem>
              <SelectItem value="Contacted">Kontaktuar</SelectItem>
              <SelectItem value="Qualified">Kualifikuar</SelectItem>
              <SelectItem value="Follow-up">Në Ndjekje</SelectItem>
              <SelectItem value="Converted">Konvertuar</SelectItem>
              <SelectItem value="Lost">Humbur</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="source">Burimi</Label>
          <Select name="source" defaultValue={initialData?.source}>
            <SelectTrigger>
              <SelectValue placeholder="Zgjidh burimin" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Website">Faqja Web</SelectItem>
              <SelectItem value="Referral">Referim</SelectItem>
              <SelectItem value="Cold Call">Thirrje e Ftoftë</SelectItem>
              <SelectItem value="Social Media">Rrjete Sociale</SelectItem>
              <SelectItem value="Email Campaign">Fushata Email</SelectItem>
              <SelectItem value="Event">Event</SelectItem>
              <SelectItem value="Other">Tjetër</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="estimatedValue">Vlera e Parashikuar (L)</Label>
          <Input 
            id="estimatedValue" 
            name="estimatedValue" 
            type="number" 
            step="0.01"
            defaultValue={initialData?.estimatedValue} 
          />
        </div>

        <div>
          <Label>Data e ndjekjes së fundit</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {lastFollowUpDate ? lastFollowUpDate.toLocaleDateString() : "Zgjidh datën"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar mode="single" selected={lastFollowUpDate} onSelect={setLastFollowUpDate} />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {teamMembers.length > 0 && (
        <div>
          <Label htmlFor="assignedToUserId">Asigno tek</Label>
          <Select name="assignedToUserId" defaultValue={initialData?.assignedToUserId || 'unassigned'}>
            <SelectTrigger>
              <SelectValue placeholder="Pa asignuar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Pa asignuar</SelectItem>
              {teamMembers.filter(m => m.status === 'Active').map(m => (
                <SelectItem key={m.userId} value={m.userId}>
                  {getName ? getName(m.userId, m.email || m.userId) : (m.displayName || m.email || m.userId)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div>
        <Label htmlFor="notes">Shënime</Label>
        <Textarea id="notes" name="notes" rows={3} defaultValue={initialData?.notes} />
      </div>

      <Button type="submit" className="w-full" disabled={disabled}>
        {initialData ? 'Përditëso Lead' : 'Krijo Lead'}
      </Button>
    </form>
  );
};

export default CRMView;
