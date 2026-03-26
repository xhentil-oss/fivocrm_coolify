import React, { useState, useMemo } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useActivityLogger } from '../hooks/useActivityLogger';
import { Mail, Phone, Building, DollarSign, TrendingUp, Plus, Calendar as CalendarIcon, Zap, Trash2, MoreVertical } from 'lucide-react';
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
import { useFilteredByOwner } from '../hooks/useRoleFilteredData';
import { safeHref } from '../lib/utils';
import type { Lead, ClientPortalAccess, Customer, Notification, TeamMember } from '../types';

const CRMView: React.FC = () => {
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [saving, setSaving] = useState(false);

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
  const notificationMutation = useMutation<Notification>('notifications');
  const portalAccessMutation = useMutation<ClientPortalAccess>('clientPortalAccess');

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'New':
        return 'bg-info text-info-foreground';
      case 'Contacted':
        return 'bg-tertiary text-tertiary-foreground';
      case 'Qualified':
        return 'bg-success text-success-foreground';
      case 'Follow-up':
        return 'bg-warning text-warning-foreground';
      case 'Converted':
        return 'bg-accent text-accent-foreground';
      case 'Lost':
        return 'bg-error text-error-foreground';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

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
    const notes = formData.get('notes') as string;
    const estimatedValue = formData.get('estimatedValue') as string;

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
      notes: notes || undefined,
      estimatedValue: estimatedValue ? parseFloat(estimatedValue) : undefined,
      score: calculateLeadScore({ name, email, phoneNumber, company, estimatedValue: estimatedValue ? parseFloat(estimatedValue) : undefined }),
    });

    logActivity('lead_created', `Lead i ri: ${name}`, { entityType: 'lead', description: company || email || '' });
    setIsCreateDialogOpen(false);
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

  const handleDeleteLead = async (id: string) => {
    if (window.confirm('Je i sigurt që dëshiron të fshish këtë lead?')) {
      await leadMutation.remove(id);
    }
  };

  const handleFollowUp = async (leadId: string) => {
    await leadMutation.update(leadId, {
      lastFollowUpDate: new Date(),
      status: 'Follow-up',
    });
  };

  const handleStatusChange = async (lead: Lead, newStatus: string) => {
    // Update lead status
    await leadMutation.update(lead.id, { status: newStatus });

    // If status is "Converted", create a customer + portal access
    if (newStatus === 'Converted') {
      const customerDoc = await customerMutation.create({
        name: lead.name,
        email: lead.email,
        phone: lead.phoneNumber,
        address: lead.address,
        company: lead.company,
        website: lead.website,
        notes: lead.notes,
        status: 'Active',
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

      // Send notification to Admin + Sales (canAccessCRM) team members
      if (user && teamMembers) {
        const notifyPromises = teamMembers
          .filter(m => m.userId !== user.uid && (m.role === 'Admin' || m.canAccessCRM))
          .map(m => notificationMutation.create({
            userId: m.userId,
            title: 'Lead u konvertua në Klient',
            message: `${lead.name} u konvertua me sukses në klient!`,
            isRead: false,
          }));
        await Promise.all(notifyPromises);
      }

      logActivity('lead_converted', `Lead u konvertua: ${lead.name}`, { entityType: 'lead', entityId: lead.id });
    }
  };

  const filteredLeads = React.useMemo(() => {
    if (!leads) return [];
    if (activeTab === 'all') return leads;
    return leads.filter(lead => lead.status === activeTab);
  }, [leads, activeTab]);

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
              <LeadForm onSubmit={handleCreateLead} disabled={saving} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6 stagger-children">
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
          </TabsList>
        </div>

        <TabsContent value={activeTab} className="mt-6">
          {/* Mobile card layout */}
          <div className="sm:hidden space-y-3">
            {filteredLeads.map((lead) => {
              const s = (lead as any).score ?? calculateLeadScore(lead);
              const scoreColor = s >= 70 ? 'text-green-600' : s >= 40 ? 'text-yellow-600' : 'text-red-500';
              return (
                <Card key={lead.id} className="p-4 space-y-3" onClick={() => setSelectedLead(lead)}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{lead.name}</p>
                      {lead.company && <p className="text-sm text-muted-foreground">{lead.company}</p>}
                      {lead.jobTitle && <p className="text-xs text-muted-foreground">{lead.jobTitle}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
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
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleFollowUp(lead.id); }}>
                            Ndiq
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelectedLead(lead); }}>
                            Shiko
                          </DropdownMenuItem>
                          {permissions.canEdit && (
                            <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); handleDeleteLead(lead.id); }}>
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
                    {lead.source && <Badge variant="outline" className="text-xs">{lead.source}</Badge>}
                    {lead.estimatedValue ? (
                      <span className="text-xs font-medium text-foreground">${lead.estimatedValue.toLocaleString()}</span>
                    ) : null}
                  </div>
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
                      Vlera Est.
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Pikët
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
                      <td className="px-6 py-4 text-body text-foreground">
                        {lead.estimatedValue 
                          ? `$${lead.estimatedValue.toLocaleString()}`
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
                      <td className="px-6 py-4 text-body text-foreground">
                        {lead.lastFollowUpDate 
                          ? new Date(lead.lastFollowUpDate).toLocaleDateString()
                          : 'Asnjëherë'}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleFollowUp(lead.id);
                            }}
                          >
                            Ndiq
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedLead(lead);
                            }}
                          >
                            Shiko
                          </Button>
                          {permissions.canEdit && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteLead(lead.id);
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
      />
    </div>
  );
};

const LeadForm: React.FC<{
  onSubmit: (data: FormData) => void;
  initialData?: Lead;
  disabled?: boolean;
}> = ({ onSubmit, initialData, disabled }) => {
  const [lastFollowUpDate, setLastFollowUpDate] = useState<Date | undefined>(
    initialData?.lastFollowUpDate ? new Date(initialData.lastFollowUpDate) : undefined
  );

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    if (lastFollowUpDate) {
      formData.set('lastFollowUpDate', lastFollowUpDate.toISOString());
    }
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
          <Label htmlFor="phoneNumber">Numri i Telefonit</Label>
          <Input id="phoneNumber" name="phoneNumber" type="tel" defaultValue={initialData?.phoneNumber} />
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
          <Label htmlFor="estimatedValue">Vlera e Parashikuar (€)</Label>
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
