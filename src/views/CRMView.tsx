import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCollection, useMutation, useGlobalTeamId, useWhatsappEnabled } from '../hooks/useFirestore';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import type { WhatsAppMessage } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useActivityLogger } from '../hooks/useActivityLogger';
import { getStatusColor } from '../lib/statusColors';
import { useToast } from '../hooks/use-toast';
import { ToastAction } from '../components/ui/toast';
import { Checkbox } from '../components/ui/checkbox';
import { PipelineBoard } from './crm/PipelineBoard';
import { Mail, Phone, Building, DollarSign, TrendingUp, Plus, Calendar as CalendarIcon, Zap, Trash2, MoreVertical, Search, X, UserCircle, Edit2, Percent, MessageSquare, ExternalLink, Calculator, FileText, Clock, Bell, Send, ArrowUp, ArrowDown, ChevronsUpDown, Inbox } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Calendar } from '../components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import DetailDrawer from '../components/DetailDrawer';
import WhatsAppChatPanel from '../components/WhatsAppChatPanel';
import { useFilteredByOwner, useUniqueTeamMembers } from '../hooks/useRoleFilteredData';
import { useUserNames } from '../hooks/useUserNames';
import { safeHref, phoneKeyDown, normalizeAlbanianPhone, getTimestampMs } from '../lib/utils';
import type { Lead, ClientPortalAccess, Customer, Notification, TeamMember, Quote } from '../types';

const CRMView: React.FC = () => {
  const navigate = useNavigate();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [whatsappLead, setWhatsappLead] = useState<Lead | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const { setDirty, isDirtyRef, discardOpen, requestClose, confirmDiscard, cancelDiscard } = useUnsavedChanges();
  const [lostReasonLead, setLostReasonLead] = useState<Lead | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [saving, setSaving] = useState(false);
  const [leadToDelete, setLeadToDelete] = useState<Lead | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [scoreFilter, setScoreFilter] = useState('all');
  const [assignedFilter, setAssignedFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  type SortKey = 'createdAt' | 'name' | 'value' | 'score' | 'prob' | 'follow';
  const [sortBy, setSortBy] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
  };
  // Optimistic status overrides (cleared automatically as Firestore subscription updates)
  const [optimisticStatus, setOptimisticStatus] = useState<Record<string, string>>({});
  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  // View mode (table | pipeline) — persisted
  const [viewMode, setViewMode] = useState<'table' | 'pipeline'>(() => {
    if (typeof window === 'undefined') return 'table';
    return (window.localStorage.getItem('crm_view_mode') as 'table' | 'pipeline') || 'table';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('crm_view_mode', viewMode);
  }, [viewMode]);
  const { toast } = useToast();

  // Follow-up / re-contact state (synced with selectedLead)
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpNote, setFollowUpNote] = useState('');
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const [recontactMsg, setRecontactMsg] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendingWa, setSendingWa] = useState(false);

  const { user } = useAuth();
  const permissions = usePermissions();
  const logActivity = useActivityLogger();
  const { data: rawLeads, loading: leadsLoading } = useCollection<Lead>('leads', {
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  // Role-based filtering: Member/Viewer see only leads they created
  const leads = useFilteredByOwner(rawLeads);
  const { data: rawTeamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }]
  });
  const teamMembers = useUniqueTeamMembers(rawTeamMembers);
  const leadMutation = useMutation<Lead>('leads');
  const customerMutation = useMutation<Customer>('customers');
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  const waTeamId = useGlobalTeamId();
  const waEnabled = useWhatsappEnabled();
  const waQuery = useMemo(() => ({
    skip: !waEnabled || !waTeamId,
    where: waTeamId ? [{ field: 'teamId', operator: '==' as const, value: waTeamId }] : undefined,
    orderBy: { field: 'createdAt', direction: 'desc' as const },
    limit: 200,
    skipTeamFilter: true,
  }), [waEnabled, waTeamId]);
  const { data: allWaMessages } = useCollection<WhatsAppMessage>('whatsappMessages', waQuery);

  // Unread WA count per canonical phone
  const waUnreadByPhone = useMemo(() => {
    const map = new Map<string, number>();
    if (!allWaMessages) return map;
    allWaMessages.forEach(m => {
      if (m.direction === 'inbound' && m.status === 'received') {
        const key = normalizeAlbanianPhone(
          m.jid?.endsWith('@s.whatsapp.net')
            ? m.jid.split('@')[0]
            : (m.phone || '')
        );
        if (key) map.set(key, (map.get(key) || 0) + 1);
      }
    });
    return map;
  }, [allWaMessages]);
  const notificationMutation = useMutation<Notification>('notifications');
  const portalAccessMutation = useMutation<ClientPortalAccess>('clientPortalAccess');
  const { data: allQuotes } = useCollection<Quote>('quotes');
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

    // Duplicate check: email vs existing leads + customers
    const normEmail = email?.toLowerCase().trim();
    const normPhone = phoneNumber?.replace(/\D/g, '');
    if (normEmail) {
      const dupLead = leads?.find(l => l.email?.toLowerCase().trim() === normEmail);
      const dupCustomer = customers?.find(c => c.email?.toLowerCase().trim() === normEmail);
      if (dupLead) {
        toast({ title: 'Email ekziston tek Leads!', description: `Lead "${dupLead.name}" ka të njëjtin email.`, variant: 'destructive' });
        setSaving(false); return;
      }
      if (dupCustomer) {
        toast({ title: 'Email ekziston tek Klientët!', description: `Klienti "${dupCustomer.name}" ka të njëjtin email.`, variant: 'destructive' });
        setSaving(false); return;
      }
    }
    if (normPhone && normPhone.length >= 7) {
      const dupLead = leads?.find(l => l.phoneNumber?.replace(/\D/g, '') === normPhone);
      const dupCustomer = customers?.find(c => c.phone?.replace(/\D/g, '') === normPhone);
      if (dupLead) {
        toast({ title: 'Numri ekziston tek Leads!', description: `Lead "${dupLead.name}" ka të njëjtin numër telefoni.`, variant: 'destructive' });
        setSaving(false); return;
      }
      if (dupCustomer) {
        toast({ title: 'Numri ekziston tek Klientët!', description: `Klienti "${dupCustomer.name}" ka të njëjtin numër telefoni.`, variant: 'destructive' });
        setSaving(false); return;
      }
    }
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
      estimatedValue: estimatedValue && !isNaN(parseFloat(estimatedValue)) ? parseFloat(estimatedValue) : undefined,
      probability: STAGE_PROBABILITY[status] ?? 10,
      score: calculateLeadScore({ name, email, phoneNumber, company, estimatedValue: estimatedValue && !isNaN(parseFloat(estimatedValue)) ? parseFloat(estimatedValue) : undefined }),
      assignedToUserId: resolvedAssigned,
    });

    // Notify assigned user
    if (resolvedAssigned && user && resolvedAssigned !== user.uid) {
      await notificationMutation.create({
        userId: resolvedAssigned,
        type: 'lead_assigned',
        title: 'Lead i asignuar ty',
        message: `${user.displayName || 'Një admin'} të asignoi lead-in "${name}"`,
        isRead: false,
        actionUrl: '/app/crm',
        actionLabel: 'Shiko CRM',
      }).catch(err => console.error('[Notifications] lead_assigned dërgim dështoi:', err));
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

      // Duplicate check on edit (exclude current lead)
      const normEmail = email?.toLowerCase().trim();
      const normPhone = phoneNumber?.replace(/\D/g, '');
      if (normEmail) {
        const dupLead = leads?.find(l => l.id !== editLead.id && l.email?.toLowerCase().trim() === normEmail);
        const dupCustomer = customers?.find(c => c.email?.toLowerCase().trim() === normEmail);
        if (dupLead) {
          toast({ title: 'Email ekziston tek Leads!', description: `Lead "${dupLead.name}" ka të njëjtin email.`, variant: 'destructive' });
          setSaving(false); return;
        }
        if (dupCustomer) {
          toast({ title: 'Email ekziston tek Klientët!', description: `Klienti "${dupCustomer.name}" ka të njëjtin email.`, variant: 'destructive' });
          setSaving(false); return;
        }
      }
      if (normPhone && normPhone.length >= 7) {
        const dupLead = leads?.find(l => l.id !== editLead.id && l.phoneNumber?.replace(/\D/g, '') === normPhone);
        const dupCustomer = customers?.find(c => c.phone?.replace(/\D/g, '') === normPhone);
        if (dupLead) {
          toast({ title: 'Numri ekziston tek Leads!', description: `Lead "${dupLead.name}" ka të njëjtin numër telefoni.`, variant: 'destructive' });
          setSaving(false); return;
        }
        if (dupCustomer) {
          toast({ title: 'Numri ekziston tek Klientët!', description: `Klienti "${dupCustomer.name}" ka të njëjtin numër telefoni.`, variant: 'destructive' });
          setSaving(false); return;
        }
      }
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

      // Notify if lead was reassigned to a different user
      if (resolvedAssigned && user && resolvedAssigned !== user.uid && resolvedAssigned !== editLead.assignedToUserId) {
        await notificationMutation.create({
          userId: resolvedAssigned,
          type: 'lead_assigned',
          title: 'Lead i asignuar ty',
          message: `${user.displayName || 'Një admin'} të asignoi lead-in "${name}"`,
          isRead: false,
          actionUrl: '/app/crm',
          actionLabel: 'Shiko CRM',
        }).catch(err => console.error('[Notifications] lead_assigned dërgim dështoi:', err));
      }

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
    if (lead.phoneNumber || lead.phone) score += 10;
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
        type: 'lead_assigned',
        title: 'Lead i asignuar ty',
        message: `${user.displayName || 'Një admin'} të asignoi lead-in "${lead.name}"`,
        isRead: false,
        actionUrl: '/app/crm',
        actionLabel: 'Shiko CRM',
      }).catch(err => console.error('[Notifications] lead_assigned dërgim dështoi:', err));
    }
  };

  const handleDeleteLead = async (id: string) => {
    // Capture full snapshot for Undo
    const snapshot = leads?.find(l => l.id === id);
    if (!snapshot) {
      await leadMutation.remove(id);
      setLeadToDelete(null);
      return;
    }
    setLeadToDelete(null);
    try {
      await leadMutation.remove(id);
      toast({
        title: 'Lead u fshi',
        description: snapshot.name,
        action: (
          <ToastAction
            altText="Anulo"
            onClick={async () => {
              try {
                // Strip id and re-create — Firestore will assign a new id
                const { id: _omit, ...data } = snapshot as any;
                await leadMutation.create(data);
                toast({ title: 'Lead u rikthye', description: snapshot.name });
              } catch {
                toast({ title: 'Gabim', description: 'Rikthimi dështoi', variant: 'destructive' });
              }
            }}
          >
            Anulo
          </ToastAction>
        ),
      });
    } catch (err) {
      toast({ title: 'Gabim', description: 'Fshirja dështoi', variant: 'destructive' });
    }
  };

  const handleFollowUp = async (leadId: string) => {
    await leadMutation.update(leadId, {
      lastFollowUpDate: new Date(),
      nextFollowUpDate: null,
      followUpNote: null,
      status: 'Follow-up',
    });
  };

  // Sync follow-up state whenever the selected lead changes
  useEffect(() => {
    if (!selectedLead) return;
    const nd = selectedLead.nextFollowUpDate;
    setFollowUpDate(nd
      ? (nd instanceof Date ? nd : new Date((nd as any)?.seconds ? (nd as any).seconds * 1000 : nd)).toISOString().split('T')[0]
      : '');
    setFollowUpNote(selectedLead.followUpNote || '');
    const firstName = selectedLead.name?.split(' ')[0] || selectedLead.name || 'ju';
    setRecontactMsg(`Përshëndetje ${firstName},\n\nDoja t'ju kontaktoja lidhur me shërbimin tonë.\n\nA keni mundësi të flasim këtë javë?\n\nFaleminderit!`);
  }, [selectedLead?.id]);

  const handleSaveFollowUp = async () => {
    if (!selectedLead) return;
    setFollowUpSaving(true);
    try {
      await leadMutation.update(selectedLead.id, {
        nextFollowUpDate: followUpDate ? new Date(followUpDate) : null,
        followUpNote: followUpNote.trim() || null,
      });
      toast({ title: 'Kujtesë e ruajtur' });
    } catch {
      toast({ title: 'Gabim', description: 'Kujtesja nuk u ruajt', variant: 'destructive' });
    } finally {
      setFollowUpSaving(false);
    }
  };

  const handleSendRecontactWhatsApp = async () => {
    if (!selectedLead?.phoneNumber || !recontactMsg.trim()) return;
    setSendingWa(true);
    try {
      const token = await user?.getIdToken();
      const normalized = normalizeAlbanianPhone(selectedLead.phoneNumber);
      const res = await fetch('/api/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: normalized, message: recontactMsg, leadId: selectedLead.id, leadName: selectedLead.name, teamId: waTeamId }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Dërgimi dështoi'); }
      toast({ title: 'WhatsApp u dërgua!' });
      await leadMutation.update(selectedLead.id, { lastFollowUpDate: new Date() });
    } catch (err: unknown) {
      toast({ title: 'Gabim WhatsApp', description: err instanceof Error ? err.message : 'Dërgimi dështoi', variant: 'destructive' });
    } finally {
      setSendingWa(false);
    }
  };

  const handleSendRecontactEmail = async () => {
    if (!selectedLead?.email || !recontactMsg.trim()) return;
    setSendingEmail(true);
    try {
      const token = await user?.getIdToken();
      const res = await fetch('/api/send-lead-reminder-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ leadId: selectedLead.id, message: recontactMsg }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Dërgimi dështoi'); }
      toast({ title: 'Email u dërgua!' });
      await leadMutation.update(selectedLead.id, { lastFollowUpDate: new Date() });
    } catch (err: unknown) {
      toast({ title: 'Gabim Email', description: err instanceof Error ? err.message : 'Dërgimi dështoi', variant: 'destructive' });
    } finally {
      setSendingEmail(false);
    }
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
      // Dedup: block conversion if a customer with the same email already exists
      const normEmail = lead.email?.toLowerCase().trim();
      if (normEmail) {
        const existing = customers?.find(c => c.email?.toLowerCase().trim() === normEmail);
        if (existing) {
          toast({ title: 'Klienti ekziston tashmë', description: `Klient me email "${lead.email}" ekziston: "${existing.name}".`, variant: 'destructive' });
          return;
        }
      }

      let customerDoc: { id: string } | undefined | null = null;
      let portalAccessDoc: { id: string } | undefined | null = null;
      try {
        customerDoc = await customerMutation.create({
          name: lead.name,
          email: lead.email,
          phone: lead.phoneNumber || lead.phone,
          address: lead.address,
          company: lead.company,
          website: lead.website,
          notes: lead.notes,
          status: 'Active',
          leadId: lead.id,
          convertedAt: new Date(),
          assignedToUserId: lead.assignedToUserId || undefined,
        });

        // Auto-create client portal access if customer has an email
        if (lead.email && customerDoc?.id) {
          portalAccessDoc = await portalAccessMutation.create({
            customerId: customerDoc.id,
            userId: '', // Will be linked when client registers/logs in
            email: lead.email.toLowerCase().trim(),
            status: 'Active',
          });
        }
        // Delete the lead inside the same try — if it fails, roll back everything
        await leadMutation.remove(lead.id);
      } catch (err) {
        // Roll back both customer and portal access on any failure
        if (portalAccessDoc?.id) await portalAccessMutation.remove(portalAccessDoc.id).catch(() => {});
        if (customerDoc?.id) await customerMutation.remove(customerDoc.id).catch(() => {});
        toast({ title: 'Gabim gjatë konvertimit', description: 'Ndodhi një gabim. Statusi nuk u ndryshua.', variant: 'destructive' });
        return;
      }

      // Send notification to Admin + Sales (canAccessCRM) team members (best-effort)
      if (user && teamMembers) {
        const notifyPromises = teamMembers
          .filter(m => m.userId !== user.uid && (m.role === 'Admin' || m.canAccessCRM))
          .map(m => notificationMutation.create({
            userId: m.userId,
            type: 'lead_converted',
            title: '🎉 Lead u konvertua në Klient',
            message: `${lead.name} u konvertua me sukses në klient!`,
            isRead: false,
            actionUrl: '/app/crm',
            actionLabel: 'Shiko CRM',
          }));
        await Promise.all(notifyPromises).catch(err => console.error('[Notifications] lead_converted dërgim dështoi:', err));
      }

      logActivity('lead_converted', `Lead u konvertua: ${lead.name}`, { entityType: 'lead', entityId: lead.id });
      toast({ title: 'Lead u konvertua', description: `${lead.name} tani është klient.` });
      return;
    }

    // Normal status change (not conversion)
    const update: Record<string, any> = { status: newStatus, probability: STAGE_PROBABILITY[newStatus] ?? undefined };
    if (newStatus === 'Follow-up') update.lastFollowUpDate = new Date();
    // Optimistic UI: reflect new status immediately
    setOptimisticStatus(prev => ({ ...prev, [lead.id]: newStatus }));
    try {
      await leadMutation.update(lead.id, update);
      // Clear optimistic entry once Firestore confirms (next snapshot will carry it)
      setOptimisticStatus(prev => {
        const { [lead.id]: _, ...rest } = prev;
        return rest;
      });
    } catch (err) {
      // Roll back
      setOptimisticStatus(prev => {
        const { [lead.id]: _, ...rest } = prev;
        return rest;
      });
      toast({ title: 'Gabim', description: 'Statusi nuk u ndryshua', variant: 'destructive' });
    }
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
    // Apply optimistic status overrides
    const base = Object.keys(optimisticStatus).length === 0
      ? leads
      : leads.map(l => optimisticStatus[l.id] ? { ...l, status: optimisticStatus[l.id] } : l);
    let result = base;
    if (activeTab !== 'all') result = result.filter(l => l.status === activeTab);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.email?.toLowerCase().includes(q) ||
        l.company?.toLowerCase().includes(q) ||
        l.phoneNumber?.toLowerCase().includes(q) ||
        l.phone?.toLowerCase().includes(q)
      );
    }
    if (scoreFilter !== 'all') result = result.filter(l => {
      const s = (l as any).score ?? calculateLeadScore(l);
      if (scoreFilter === 'high') return s >= 70;
      if (scoreFilter === 'medium') return s >= 40 && s < 70;
      if (scoreFilter === 'low') return s < 40;
      return true;
    });
    if (assignedFilter === 'mine') result = result.filter(l => l.assignedToUserId === user?.uid);
    if (assignedFilter === 'unassigned') result = result.filter(l => !l.assignedToUserId);
    if (sourceFilter !== 'all') result = result.filter(l => l.source === sourceFilter);

    // Sort
    const dir = sortDir === 'asc' ? 1 : -1;
    const getFollowMs = (l: Lead) => {
      const nd = l.nextFollowUpDate as any;
      if (!nd) return Number.POSITIVE_INFINITY;
      return nd instanceof Date ? nd.getTime() : (nd?.seconds ? nd.seconds * 1000 : new Date(nd).getTime());
    };
    const sorted = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'name': return a.name.localeCompare(b.name, 'sq') * dir;
        case 'value': return ((a.estimatedValue || 0) - (b.estimatedValue || 0)) * dir;
        case 'score': {
          const sa = (a as any).score ?? calculateLeadScore(a);
          const sb = (b as any).score ?? calculateLeadScore(b);
          return (sa - sb) * dir;
        }
        case 'prob': return ((a.probability ?? STAGE_PROBABILITY[a.status] ?? 0) - (b.probability ?? STAGE_PROBABILITY[b.status] ?? 0)) * dir;
        case 'follow': return (getFollowMs(a) - getFollowMs(b)) * dir;
        case 'createdAt':
        default: return (getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt)) * (sortDir === 'asc' ? -1 : 1);
      }
    });
    return sorted;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, activeTab, searchQuery, scoreFilter, assignedFilter, sourceFilter, sortBy, sortDir, user, optimisticStatus]);

  const hasActiveFilters = searchQuery.trim() !== '' || scoreFilter !== 'all' || assignedFilter !== 'all' || sourceFilter !== 'all';
  const clearAllFilters = () => {
    setSearchQuery('');
    setScoreFilter('all');
    setAssignedFilter('all');
    setSourceFilter('all');
  };

  const needsFollowUp = React.useMemo(() => {
    if (!leads) return [];
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    return leads.filter(lead => {
      if (lead.status === 'Lost' || lead.status === 'Converted') return false;
      if (!lead.lastFollowUpDate) return true;
      return new Date(lead.lastFollowUpDate) < thirtyDaysAgo;
    });
  }, [leads]);

  // Keyboard navigation
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const tag = active?.tagName?.toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || (active as HTMLElement)?.isContentEditable;
      // Allow Escape even in inputs
      if (e.key === 'Escape') {
        if (highlightedIndex >= 0) {
          setHighlightedIndex(-1);
        }
        return;
      }
      if (isTyping) return;
      // Skip when any dialog/drawer is open
      const anyDialogOpen = isCreateDialogOpen || !!editLead || !!selectedLead || !!leadToDelete || !!whatsappLead || !!lostReasonLead || discardOpen || shortcutsOpen;
      if (anyDialogOpen) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        if (!permissions.canEdit) return;
        e.preventDefault();
        setIsCreateDialogOpen(true);
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (e.key === 'j' || e.key === 'ArrowDown') {
        if (filteredLeads.length === 0) return;
        e.preventDefault();
        setHighlightedIndex(i => Math.min(filteredLeads.length - 1, i + 1));
        return;
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        if (filteredLeads.length === 0) return;
        e.preventDefault();
        setHighlightedIndex(i => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        if (highlightedIndex >= 0 && filteredLeads[highlightedIndex]) {
          e.preventDefault();
          setSelectedLead(filteredLeads[highlightedIndex]);
        }
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filteredLeads, highlightedIndex, isCreateDialogOpen, editLead, selectedLead, leadToDelete, whatsappLead, lostReasonLead, discardOpen, shortcutsOpen, permissions.canEdit]);

  // Clamp highlighted index when filtered list shrinks
  useEffect(() => {
    if (highlightedIndex >= filteredLeads.length) {
      setHighlightedIndex(filteredLeads.length - 1);
    }
  }, [filteredLeads.length, highlightedIndex]);

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
          <h1 className="text-h2 text-foreground">Leads</h1>
          <p className="text-body text-muted-foreground mt-1">
            {leads?.length || 0} lead total {needsFollowUp.length > 0 ? `· ${needsFollowUp.length} kërkojnë ndjekje` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="hidden sm:inline-flex items-center rounded-md border border-border bg-card p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${viewMode === 'table' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              aria-pressed={viewMode === 'table'}
            >
              Tabelë
            </button>
            <button
              type="button"
              onClick={() => setViewMode('pipeline')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${viewMode === 'pipeline' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              aria-pressed={viewMode === 'pipeline'}
            >
              Pipeline
            </button>
          </div>
          {permissions.canEdit && (
          <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
            if (open) { setDirty(false); setIsCreateDialogOpen(true); }
            else requestClose(() => setIsCreateDialogOpen(false));
          }}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground w-full sm:w-auto">
                <Plus className="w-4 h-4 mr-2" />
                Lead i Ri
              </Button>
            </DialogTrigger>
            <DialogContent
              className="w-full max-w-full sm:max-w-2xl"
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
                <DialogTitle>Krijo Lead të Ri</DialogTitle>
              </DialogHeader>
              <LeadForm onSubmit={(data) => { setDirty(false); handleCreateLead(data); }} disabled={saving} teamMembers={teamMembers || []} getName={getName} onDirtyChange={setDirty} />
            </DialogContent>
          </Dialog>
        )}
        </div>
      </div>

      {/* Search & Filter bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Kërko sipas emrit, email, telefonit, kompanisë... (shtypni / për fokus)"
            className="pl-9 h-9"
          />
          {searchQuery && (
            <button className="absolute right-3 top-2.5" onClick={() => setSearchQuery('')}>
              <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>

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
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-full sm:w-[140px] h-9">
            <SelectValue placeholder="Burimi" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Të gjitha burimet</SelectItem>
            <SelectItem value="Website">Website</SelectItem>
            <SelectItem value="Referral">Referim</SelectItem>
            <SelectItem value="Cold Call">Cold Call</SelectItem>
            <SelectItem value="Social Media">Social Media</SelectItem>
            <SelectItem value="Email">Email</SelectItem>
            <SelectItem value="Event">Event</SelectItem>
            <SelectItem value="Other">Tjetër</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Active filter chips */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5 -mt-2">
          <span className="text-xs text-muted-foreground">Filtra:</span>
          {searchQuery.trim() && (
            <Badge variant="secondary" className="gap-1 pl-2 pr-1 font-normal">
              "{searchQuery}"
              <button onClick={() => setSearchQuery('')} className="hover:bg-muted rounded-sm p-0.5" aria-label="Hiq kërkimin">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}
          {scoreFilter !== 'all' && (
            <Badge variant="secondary" className="gap-1 pl-2 pr-1 font-normal">
              Pikët: {scoreFilter === 'high' ? 'I lartë' : scoreFilter === 'medium' ? 'Mesatar' : 'I ulët'}
              <button onClick={() => setScoreFilter('all')} className="hover:bg-muted rounded-sm p-0.5" aria-label="Hiq filtrin e pikëve">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}
          {assignedFilter !== 'all' && (
            <Badge variant="secondary" className="gap-1 pl-2 pr-1 font-normal">
              {assignedFilter === 'mine' ? 'Të miat' : 'Pa asignuar'}
              <button onClick={() => setAssignedFilter('all')} className="hover:bg-muted rounded-sm p-0.5" aria-label="Hiq filtrin e asignimit">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}
          {sourceFilter !== 'all' && (
            <Badge variant="secondary" className="gap-1 pl-2 pr-1 font-normal">
              Burimi: {sourceFilter}
              <button onClick={() => setSourceFilter('all')} className="hover:bg-muted rounded-sm p-0.5" aria-label="Hiq filtrin e burimit">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}
          <button
            onClick={clearAllFilters}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1"
          >
            Pastro të gjithë
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3 stagger-children">
        <Card className="p-3 sm:p-4 card-hover">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Building className="w-3.5 h-3.5" />
            <p className="text-xs">Lead Totale</p>
          </div>
          <p className="mt-1.5 text-2xl sm:text-3xl text-foreground font-semibold tabular-nums leading-none">
            {leads?.length || 0}
          </p>
        </Card>

        <Card className="p-3 sm:p-4 card-hover">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <TrendingUp className="w-3.5 h-3.5" />
            <p className="text-xs">Kualifikuara</p>
          </div>
          <p className="mt-1.5 text-2xl sm:text-3xl text-foreground font-semibold tabular-nums leading-none">
            {leads?.filter(l => l.status === 'Qualified').length || 0}
          </p>
        </Card>

        <Card className="p-3 sm:p-4 card-hover">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <DollarSign className="w-3.5 h-3.5" />
            <p className="text-xs">Konvertuara</p>
          </div>
          <p className="mt-1.5 text-2xl sm:text-3xl text-foreground font-semibold tabular-nums leading-none">
            {customers?.filter(c => (c as any).leadId).length || 0}
          </p>
        </Card>

        <Card className={`p-3 sm:p-4 card-hover ${needsFollowUp.length > 0 ? 'border-l-2 border-l-warning' : ''}`}>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <CalendarIcon className="w-3.5 h-3.5" />
            <p className="text-xs">Për ndjekje</p>
          </div>
          <p className={`mt-1.5 text-2xl sm:text-3xl font-semibold tabular-nums leading-none ${needsFollowUp.length > 0 ? 'text-warning' : 'text-foreground'}`}>
            {needsFollowUp.length}
          </p>
        </Card>

        <Card className="p-3 sm:p-4 card-hover border-l-2 border-l-primary">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Percent className="w-3.5 h-3.5" />
            <p className="text-xs">Forecast (i ponderuar)</p>
          </div>
          <p className="mt-1.5 text-2xl sm:text-3xl text-foreground font-semibold tabular-nums leading-none">
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
        </Card>
      </div>

      {viewMode === 'pipeline' ? (
        <PipelineBoard
          leads={
            (Object.keys(optimisticStatus).length === 0
              ? (leads || [])
              : (leads || []).map(l => optimisticStatus[l.id] ? { ...l, status: optimisticStatus[l.id] } : l))
          }
          onStatusChange={handleStatusChange}
          onCardClick={setSelectedLead}
          calculateLeadScore={calculateLeadScore}
        />
      ) : (
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
          {filteredLeads.length === 0 && (
            <Card className="p-12 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <Inbox className="w-6 h-6 text-muted-foreground" />
              </div>
              <h3 className="text-h3 text-foreground mb-1">
                {hasActiveFilters ? 'Asnjë lead nuk përputhet' : 'Asnjë lead ende'}
              </h3>
              <p className="text-body-sm text-muted-foreground mb-4">
                {hasActiveFilters
                  ? 'Provo të ndryshosh filtrat ose krijo një lead të ri.'
                  : 'Filloji shtimin e lead-eve të tu të parë për të ndjekur shitjet.'}
              </p>
              <div className="flex items-center justify-center gap-2">
                {hasActiveFilters && (
                  <Button variant="outline" onClick={clearAllFilters}>
                    Pastro filtrat
                  </Button>
                )}
                {permissions.canEdit && (
                  <Button onClick={() => setIsCreateDialogOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Lead i Ri
                  </Button>
                )}
              </div>
            </Card>
          )}

          {/* Mobile card layout */}
          <div className="sm:hidden space-y-3">
            {filteredLeads.map((lead) => {
              const s = (lead as any).score ?? calculateLeadScore(lead);
              const scoreColor = s >= 70 ? 'text-green-600' : s >= 40 ? 'text-yellow-600' : 'text-red-500';
              const leadPhone = normalizeAlbanianPhone(lead.phoneNumber || lead.phone || '');
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
                      {waUnread > 0 && waEnabled && (
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
                  {(() => {
                    const nd = lead.nextFollowUpDate;
                    if (!nd) return null;
                    const d = nd instanceof Date ? new Date(nd) : new Date((nd as any)?.seconds ? (nd as any).seconds * 1000 : nd);
                    const today = new Date(); today.setHours(0,0,0,0); d.setHours(0,0,0,0);
                    const isOverdue = d < today;
                    const isDueToday = d.getTime() === today.getTime();
                    return (
                      <div className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                        isOverdue ? 'bg-red-100 text-red-700' :
                        isDueToday ? 'bg-amber-100 text-amber-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        <Clock className="w-3 h-3" />
                        {isOverdue ? `Vonuar · ${d.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' })}` :
                         isDueToday ? 'Rikontakto sot' :
                         d.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' })}
                      </div>
                    );
                  })()}
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

          {/* Bulk actions bar (desktop) */}
          {selectedIds.size > 0 && (
            <div className="hidden sm:flex sticky top-0 z-20 items-center gap-2 bg-primary/10 border border-primary/30 rounded-lg px-4 py-2 mb-3 backdrop-blur">
              <Checkbox
                checked
                onCheckedChange={() => setSelectedIds(new Set())}
                aria-label="Hiq zgjedhjen"
              />
              <span className="text-sm font-medium text-foreground">
                {selectedIds.size} të zgjedhura
              </span>
              <div className="flex-1" />
              {permissions.canEdit && (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        Ndrysho status
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {(['New', 'Contacted', 'Qualified', 'Follow-up', 'Lost'] as const).map(s => (
                        <DropdownMenuItem
                          key={s}
                          onClick={async () => {
                            const ids = Array.from(selectedIds);
                            setOptimisticStatus(prev => {
                              const next = { ...prev };
                              ids.forEach(id => { next[id] = s; });
                              return next;
                            });
                            try {
                              await Promise.all(ids.map(id => leadMutation.update(id, {
                                status: s,
                                probability: STAGE_PROBABILITY[s] ?? undefined,
                              })));
                              toast({ title: `${ids.length} lead u përditësuan`, description: `Status i ri: ${getStatusLabel(s)}` });
                              setSelectedIds(new Set());
                            } catch {
                              toast({ title: 'Gabim', description: 'Disa përditësime dështuan', variant: 'destructive' });
                            } finally {
                              setOptimisticStatus(prev => {
                                const next = { ...prev };
                                ids.forEach(id => { delete next[id]; });
                                return next;
                              });
                            }
                          }}
                        >
                          {getStatusLabel(s)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        Asigno te
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                      <DropdownMenuItem
                        onClick={async () => {
                          const ids = Array.from(selectedIds);
                          try {
                            await Promise.all(ids.map(id => leadMutation.update(id, { assignedToUserId: null as any })));
                            toast({ title: `${ids.length} lead u zhasignuan` });
                            setSelectedIds(new Set());
                          } catch {
                            toast({ title: 'Gabim', variant: 'destructive' });
                          }
                        }}
                      >
                        Pa asignuar
                      </DropdownMenuItem>
                      {teamMembers?.map(m => (
                        <DropdownMenuItem
                          key={m.userId}
                          onClick={async () => {
                            const ids = Array.from(selectedIds);
                            try {
                              await Promise.all(ids.map(id => leadMutation.update(id, { assignedToUserId: m.userId })));
                              toast({ title: `${ids.length} lead u asignuan`, description: getName(m.userId, m.name) });
                              setSelectedIds(new Set());
                            } catch {
                              toast({ title: 'Gabim', variant: 'destructive' });
                            }
                          }}
                        >
                          {getName(m.userId, m.name)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Fshi
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Desktop table */}
          <Card className="overflow-hidden hidden sm:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-4 w-10">
                      <Checkbox
                        checked={filteredLeads.length > 0 && filteredLeads.every(l => selectedIds.has(l.id))}
                        onCheckedChange={(v) => {
                          if (v) setSelectedIds(new Set(filteredLeads.map(l => l.id)));
                          else setSelectedIds(new Set());
                        }}
                        aria-label="Zgjidh të gjitha"
                      />
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      <button
                        type="button"
                        onClick={() => toggleSort('name')}
                        className="flex items-center gap-1 hover:text-primary transition-colors"
                      >
                        Kontakti
                        {sortBy === 'name' ? (
                          sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ChevronsUpDown className="w-3 h-3 opacity-40" />
                        )}
                      </button>
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Kompania
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Statusi
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Asignuar
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      <button
                        type="button"
                        onClick={() => toggleSort('value')}
                        className="flex items-center gap-1 hover:text-primary transition-colors"
                      >
                        Vlera Est.
                        {sortBy === 'value' ? (
                          sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ChevronsUpDown className="w-3 h-3 opacity-40" />
                        )}
                      </button>
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      <button
                        type="button"
                        onClick={() => toggleSort('score')}
                        className="flex items-center gap-1 hover:text-primary transition-colors"
                      >
                        Pikët
                        {sortBy === 'score' ? (
                          sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ChevronsUpDown className="w-3 h-3 opacity-40" />
                        )}
                      </button>
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      <button
                        type="button"
                        onClick={() => toggleSort('prob')}
                        className="flex items-center gap-1 hover:text-primary transition-colors"
                      >
                        Prob.
                        {sortBy === 'prob' ? (
                          sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ChevronsUpDown className="w-3 h-3 opacity-40" />
                        )}
                      </button>
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      <button
                        type="button"
                        onClick={() => toggleSort('follow')}
                        className="flex items-center gap-1 hover:text-primary transition-colors"
                      >
                        Rikontakto
                        {sortBy === 'follow' ? (
                          sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ChevronsUpDown className="w-3 h-3 opacity-40" />
                        )}
                      </button>
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Veprime
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredLeads.map((lead, idx) => (
                    <tr
                      key={lead.id}
                      className={`group hover:bg-muted/50 cursor-pointer transition-colors duration-fast ${idx === highlightedIndex ? 'bg-muted/60 ring-1 ring-inset ring-primary/40' : ''} ${selectedIds.has(lead.id) ? 'bg-primary/5' : ''}`}
                      onClick={() => setSelectedLead(lead)}
                    >
                      <td className="px-4 py-4 w-10" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(lead.id)}
                          onCheckedChange={(v) => {
                            setSelectedIds(prev => {
                              const next = new Set(prev);
                              if (v) next.add(lead.id);
                              else next.delete(lead.id);
                              return next;
                            });
                          }}
                          aria-label={`Zgjidh ${lead.name}`}
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          <p className="text-body font-normal text-foreground">{lead.name}</p>
                          {lead.jobTitle && (
                            <p className="text-body-sm text-muted-foreground">{lead.jobTitle}</p>
                          )}
                          {lead.email && (
                            <a
                              href={`mailto:${lead.email}`}
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 text-body-sm text-muted-foreground hover:text-primary hover:underline w-fit"
                            >
                              <Mail className="w-3 h-3" />
                              {lead.email}
                            </a>
                          )}
                          {lead.phoneNumber && (
                            <a
                              href={`tel:${lead.phoneNumber.replace(/\s+/g, '')}`}
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 text-body-sm text-muted-foreground hover:text-primary hover:underline w-fit tabular-nums"
                            >
                              <Phone className="w-3 h-3" />
                              {lead.phoneNumber}
                            </a>
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
                      <td className="px-6 py-4 text-body text-foreground tabular-nums">
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
                              <span className={`font-semibold tabular-nums ${color}`}>{s}</span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4">
                        {(() => {
                          const prob = lead.probability ?? STAGE_PROBABILITY[lead.status] ?? 0;
                          const color = prob >= 60 ? 'text-green-600' : prob >= 30 ? 'text-yellow-600' : 'text-red-500';
                          return (
                            <span className={`font-semibold tabular-nums ${color}`}>{prob}%</span>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4">
                        {(() => {
                          const nd = lead.nextFollowUpDate;
                          if (!nd) return <span className="text-xs text-muted-foreground">—</span>;
                          const d = nd instanceof Date ? new Date(nd) : new Date((nd as any)?.seconds ? (nd as any).seconds * 1000 : nd);
                          const today = new Date(); today.setHours(0,0,0,0); d.setHours(0,0,0,0);
                          const isOverdue = d < today;
                          const isDueToday = d.getTime() === today.getTime();
                          return (
                            <div className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full w-fit ${
                              isOverdue ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                              isDueToday ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                              'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            }`}>
                              <Clock className="w-3 h-3" />
                              {isDueToday ? 'Sot' : d.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' })}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          {lead.phoneNumber && waEnabled && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-[#25D366] hover:bg-[#25D366]/10 h-8 w-8 p-0"
                              onClick={(e) => { e.stopPropagation(); setWhatsappLead(lead); }}
                              title="WhatsApp"
                              aria-label="Dërgo WhatsApp"
                            >
                              <MessageSquare className="w-4 h-4" />
                            </Button>
                          )}
                          {permissions.canEdit && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditLead(lead);
                              }}
                              title="Ndrysho"
                              aria-label="Ndrysho lead"
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                          )}
                          {permissions.canEdit && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8 p-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLeadToDelete(lead);
                              }}
                              title="Fshi"
                              aria-label="Fshi lead"
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
      )}

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
              {selectedLead.phoneNumber && waEnabled && (
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
        extraTabs={selectedLead ? [
          {
            value: 'rikontakto',
            label: (() => {
              const nd = selectedLead.nextFollowUpDate;
              if (!nd) return 'Rikontakto';
              const d = nd instanceof Date ? nd : new Date((nd as any)?.seconds ? (nd as any).seconds * 1000 : nd);
              const today = new Date(); today.setHours(0,0,0,0); d.setHours(0,0,0,0);
              if (d < today) return '🔴 Rikontakto';
              if (d.getTime() === today.getTime()) return '🟡 Rikontakto';
              return '🔵 Rikontakto';
            })(),
            content: (() => {
              const today = new Date(); today.setHours(0,0,0,0);
              const nd = followUpDate ? new Date(followUpDate) : null;
              if (nd) nd.setHours(0,0,0,0);
              const isOverdue = nd && nd < today;
              const isDueToday = nd && nd.getTime() === today.getTime();
              const hasContact = selectedLead.phoneNumber || selectedLead.email;
              return (
                <div className="space-y-5">
                  {/* ── Scheduled reminder ── */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Bell className="w-4 h-4 text-primary" />
                      <p className="text-sm font-semibold">Kujtesë e Caktuar</p>
                    </div>

                    {nd && (
                      <div className={`flex items-center gap-2 p-2.5 rounded-lg text-sm font-medium ${
                        isOverdue ? 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400' :
                        isDueToday ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-400' :
                        'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/20 dark:text-blue-400'
                      }`}>
                        <Clock className="w-4 h-4 shrink-0" />
                        <span>
                          {isOverdue ? `Vonuar · ${nd.toLocaleDateString('sq-AL')}` :
                           isDueToday ? 'Sot' :
                           nd.toLocaleDateString('sq-AL', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </span>
                        {followUpNote && <span className="text-xs font-normal opacity-80 ml-1 truncate">— {followUpNote}</span>}
                      </div>
                    )}

                    <div className="space-y-2">
                      <div>
                        <Label className="text-xs text-muted-foreground">Data e Rikontaktimit</Label>
                        <Input
                          type="date"
                          value={followUpDate}
                          onChange={(e) => setFollowUpDate(e.target.value)}
                          className="mt-1 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Shënim (opsional)</Label>
                        <Textarea
                          value={followUpNote}
                          onChange={(e) => setFollowUpNote(e.target.value)}
                          placeholder="Diskuto çmimin, dërgo ofertën, kujto preferencat..."
                          rows={2}
                          className="mt-1 text-sm resize-none"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleSaveFollowUp} disabled={followUpSaving} className="flex-1">
                          {followUpSaving ? 'Duke ruajtur...' : 'Ruaj Kujtesën'}
                        </Button>
                        {nd && (
                          <Button
                            size="sm" variant="outline"
                            className="text-destructive hover:text-destructive border-destructive/30"
                            onClick={async () => {
                              await leadMutation.update(selectedLead.id, { nextFollowUpDate: null, followUpNote: null });
                              setFollowUpDate(''); setFollowUpNote('');
                              toast({ title: 'Kujtesë e fshirë' });
                            }}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ── Send message now ── */}
                  {hasContact && (
                    <div className="border-t pt-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Send className="w-4 h-4 text-primary" />
                        <p className="text-sm font-semibold">Dërgo Mesazh Tani</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Mesazhi</Label>
                        <Textarea
                          value={recontactMsg}
                          onChange={(e) => setRecontactMsg(e.target.value)}
                          rows={4}
                          className="mt-1 text-sm resize-none"
                        />
                      </div>
                      <div className="flex gap-2">
                        {selectedLead.phoneNumber && waEnabled && (
                          <Button
                            size="sm" variant="outline"
                            className="flex-1 text-[#25D366] border-[#25D366]/30 hover:bg-[#25D366]/10"
                            onClick={handleSendRecontactWhatsApp}
                            disabled={sendingWa || !recontactMsg.trim()}
                          >
                            <MessageSquare className="w-4 h-4 mr-1.5" />
                            {sendingWa ? 'Duke dërguar...' : 'WhatsApp'}
                          </Button>
                        )}
                        {selectedLead.email && (
                          <Button
                            size="sm" variant="outline"
                            className="flex-1"
                            onClick={handleSendRecontactEmail}
                            disabled={sendingEmail || !recontactMsg.trim()}
                          >
                            <Mail className="w-4 h-4 mr-1.5" />
                            {sendingEmail ? 'Duke dërguar...' : 'Email'}
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Pas dërgimit, data e "Ndjekjes së fundit" përditësohet automatikisht.
                      </p>
                    </div>
                  )}
                </div>
              );
            })(),
          },
          {
            value: 'preventiva',
            label: `Preventiva (${(allQuotes || []).filter(q => q.leadId === selectedLead.id).length})`,
            content: (() => {
              const leadQuotes = (allQuotes || []).filter(q => q.leadId === selectedLead.id);
              return (
                <div className="space-y-3">
                  {leadQuotes.length === 0 ? (
                    <div className="text-center py-8 space-y-3">
                      <FileText className="w-10 h-10 mx-auto text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">Nuk ka preventiva për këtë lead.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setSelectedLead(null); navigate('/app/price-calculator'); }}
                      >
                        <Calculator className="w-4 h-4 mr-1.5" />
                        Krijo Preventivë
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {leadQuotes.map(q => {
                          const cur = q.currency === 'EUR' ? '€' : q.currency === 'USD' ? '$' : 'L';
                          return (
                            <div key={q.id} className="p-2.5 rounded-lg border bg-muted/30 text-sm">
                              <div className="flex items-center justify-between">
                                <span className="font-medium">{q.label || q.result?.suggestedLabel}</span>
                                <Badge variant="secondary" className={
                                  q.status === 'Accepted' ? 'bg-green-100 text-green-700' :
                                  q.status === 'Rejected' ? 'bg-red-100 text-red-700' :
                                  q.status === 'Sent' ? 'bg-blue-100 text-blue-700' :
                                  'bg-gray-100 text-gray-700'
                                }>{q.status}</Badge>
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                <span>Total: <strong className="text-foreground">{(q.result?.grandTotal ?? 0).toLocaleString()} {cur}</strong></span>
                                <span>{q.result?.enabledServicesCount ?? 0} shërbime</span>
                                <span>{q.createdAt instanceof Date ? q.createdAt.toLocaleDateString('sq-AL') : ''}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => { setSelectedLead(null); navigate('/app/price-calculator'); }}
                      >
                        <Calculator className="w-4 h-4 mr-1.5" />
                        Krijo Preventivë të Re
                      </Button>
                    </>
                  )}
                </div>
              );
            })(),
          },
        ] : undefined}
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

      {/* Bulk delete confirm */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="w-full max-w-md">
          <DialogHeader><DialogTitle>Fshi {selectedIds.size} lead</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Je i sigurt që dëshiron të fshish <span className="font-semibold text-foreground">{selectedIds.size}</span> lead? Ky veprim nuk mund të zhbëhet menjëherë.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>Anulo</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                const ids = Array.from(selectedIds);
                setBulkDeleteOpen(false);
                try {
                  await Promise.all(ids.map(id => leadMutation.remove(id)));
                  toast({ title: `${ids.length} lead u fshinë` });
                  setSelectedIds(new Set());
                } catch {
                  toast({ title: 'Gabim', description: 'Disa fshirje dështuan', variant: 'destructive' });
                }
              }}
            >
              Fshi {selectedIds.size}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Keyboard shortcuts help */}
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="w-full max-w-md">
          <DialogHeader><DialogTitle>Shkurtoret e tastierës</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            {[
              ['/', 'Fokuso kërkimin'],
              ['n', 'Krijo lead të ri'],
              ['j  /  ↓', 'Zgjidh rreshtin pasardhës'],
              ['k  /  ↑', 'Zgjidh rreshtin paraprak'],
              ['Enter', 'Hap lead-in e zgjedhur'],
              ['Esc', 'Hiq zgjedhjen'],
              ['?', 'Shfaq këtë listë'],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-muted-foreground">{label}</span>
                <kbd className="px-2 py-1 bg-muted border border-border rounded text-xs font-mono">{key}</kbd>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Lead Dialog */}
      <Dialog open={!!editLead} onOpenChange={(open) => {
        if (open) { setDirty(false); }
        else requestClose(() => setEditLead(null));
      }}>
        <DialogContent
          className="w-full max-w-full sm:max-w-2xl"
          onInteractOutside={(e) => {
            if (isDirtyRef.current) {
              e.preventDefault();
              requestClose(() => setEditLead(null));
            }
          }}
          onEscapeKeyDown={(e) => {
            if (isDirtyRef.current) {
              e.preventDefault();
              requestClose(() => setEditLead(null));
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Ndrysho Lead</DialogTitle>
          </DialogHeader>
          {editLead && (
            <LeadForm
              onSubmit={(data) => { setDirty(false); handleEditLead(data); }}
              initialData={editLead}
              disabled={saving}
              teamMembers={teamMembers || []}
              getName={getName}
              onDirtyChange={setDirty}
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
      {whatsappLead && waEnabled && (
        <WhatsAppChatPanel
          phone={whatsappLead.phoneNumber || whatsappLead.phone || ''}
          leadName={whatsappLead.name}
          leadId={whatsappLead.id}
          onClose={() => setWhatsappLead(null)}
        />
      )}

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

const LeadForm: React.FC<{
  onSubmit: (data: FormData) => void;
  initialData?: Lead;
  disabled?: boolean;
  teamMembers?: TeamMember[];
  getName?: (userId: string | null | undefined, fallback?: string) => string;
  onDirtyChange?: (dirty: boolean) => void;
}> = ({ onSubmit, initialData, disabled, teamMembers = [], getName, onDirtyChange }) => {
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
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto px-1" onInput={() => onDirtyChange?.(true)}>
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
            <Select value={phonePrefix} onValueChange={(v) => { setPhonePrefix(v); onDirtyChange?.(true); }}>
              <SelectTrigger className="w-[100px] shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PHONE_PREFIXES.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input id="phoneLocal" name="phoneLocal" type="tel" inputMode="numeric" maxLength={20} onKeyDown={phoneKeyDown} placeholder="69 123 4567" className="flex-1" defaultValue={parsed.local} />
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
            min="0"
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
              <Calendar mode="single" selected={lastFollowUpDate} onSelect={(d) => { setLastFollowUpDate(d); onDirtyChange?.(true); }} />
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
