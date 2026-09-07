import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCollection, useDocument, useMutation, useGlobalTeamId, useGlobalBusinessId, useWhatsappEnabled } from '../hooks/useFirestore';
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
import { LeadFiltersBar } from './crm/LeadFiltersBar';
import LeadAnalytics from './crm/LeadAnalytics';
import AutomationRulesPanel from './crm/AutomationRulesPanel';
import ExportButton from '../components/ExportButton';
import LeadImportDialog from '../components/LeadImportDialog';
import {
  Mail,
  Phone,
  Building,
  DollarSign,
  TrendingUp,
  Plus,
  Calendar as CalendarIcon,
  Zap,
  Trash2,
  MoreVertical,
  X,
  UserCircle,
  Edit2,
  Percent,
  MessageSquare,
  ExternalLink,
  Calculator,
  FileText,
  Clock,
  Bell,
  Send,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  Inbox,
  Upload,
} from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import ContactTagsField, { parseTags } from '../components/ContactTagsField';
import { Calendar } from '../components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import DetailDrawer from '../components/DetailDrawer';
import { LeadDocumentsPanel } from '../components/LeadAttachments';
import LeadTimeline, { logLeadActivity } from '../components/LeadTimeline';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import WhatsAppChatPanel from '../components/WhatsAppChatPanel';
import { useFilteredByOwner, useUniqueTeamMembers } from '../hooks/useRoleFilteredData';
import { useUserNames } from '../hooks/useUserNames';
import { safeHref, phoneKeyDown, normalizeAlbanianPhone, getTimestampMs, currencySymbol } from '../lib/utils';
import { TEMP_META } from '../lib/leadIntel';
import { LEAD_STAGES, SELECTABLE_STATUSES, leadStageLabel } from '../lib/leadStages';
import { calculateLeadScore } from '../lib/leadScore';
import { findContactMatch, matchFieldLabel, type MatchField } from '../lib/contactIdentity';
import { findDuplicateGroups } from '../lib/contactMerge';
import MergeContactsDialog from '../components/MergeContactsDialog';
import DuplicateContactsPanel from '../components/DuplicateContactsPanel';
import { useLeadIntel } from '../hooks/useLeadIntel';
import { useSavedSegments, type LeadSegment } from '../hooks/useSavedSegments';
import { useTeamSettingsData, saveTeamSettings } from '../hooks/useTeamSettings';
import type { Lead, ClientPortalAccess, Customer, Notification, TeamMember, Quote, Deal } from '../types';

// Built-in business categories. Custom ones typed in the lead form are merged in
// from teamSettings.leadCategories + the categories already on existing leads.
const DEFAULT_BUSINESS_CATEGORIES = [
  'Teknologji', 'Tregti', 'Shërbime', 'Prodhim', 'Ndërtim', 'Arsim', 'Shëndetësi',
  'Transport', 'Hoteleri & Turizëm', 'Bujqësi', 'Financa & Sigurime',
  'Pasuri të Paluajtshme', 'Marketing & Media', 'Ushqim & Pije', 'Tjetër',
];

const CRMView: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeLeadId = searchParams.get('lead');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [whatsappLead, setWhatsappLead] = useState<Lead | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const { setDirty, isDirtyRef, discardOpen, requestClose, confirmDiscard, cancelDiscard } = useUnsavedChanges();
  const [lostReasonLead, setLostReasonLead] = useState<Lead | null>(null);
  const [lostReason, setLostReason] = useState('');
  // The new lead turned out to be an existing CLIENT — the user picks what that means
  // (open the client / log a new deal / keep the lead, linked) instead of being blocked.
  const [dupCustomerPrompt, setDupCustomerPrompt] = useState<{
    payload: Record<string, any>;
    customer: Customer;
    on: MatchField;
  } | null>(null);
  const [dupResolving, setDupResolving] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [saving, setSaving] = useState(false);
  const [leadToDelete, setLeadToDelete] = useState<Lead | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [scoreFilter, setScoreFilter] = useState('all');
  const [assignedFilter, setAssignedFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
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
  const [importOpen, setImportOpen] = useState(false);
  // Manual duplicate merge (Admin/Manager/Owner; the endpoint re-checks the role).
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergePair, setMergePair] = useState<{ primaryId?: string; duplicateId?: string }>({});
  // View mode (table | pipeline | analytics | duplicates) — persisted
  const [viewMode, setViewMode] = useState<'table' | 'pipeline' | 'analytics' | 'duplicates' | 'automations'>(() => {
    if (typeof window === 'undefined') return 'table';
    return (window.localStorage.getItem('crm_view_mode') as 'table' | 'pipeline' | 'analytics' | 'duplicates' | 'automations') || 'table';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('crm_view_mode', viewMode);
  }, [viewMode]);
  // Windowing — render at most N rows; "Shfaq më shumë" reveals more.
  // NOTE: this bounds DOM/render work, not Firestore reads. Reads follow the
  // app-wide businessId-only scoping (useFirestore deliberately avoids composite
  // indexes), so read-bounding for leads is a separate, index-gated change.
  const PAGE_SIZE = 100;
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
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
  // P2.3 — deep link: /app/crm/:leadId opens the drawer. Fallback fetch for a lead
  // not in the loaded list (e.g. opened via a shared link before the list loads).
  const { data: routeLead } = useDocument<Lead>('leads', routeLeadId || '');
  const { data: rawTeamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }]
  });
  const teamMembers = useUniqueTeamMembers(rawTeamMembers);
  // Defence in depth: reads are already business-scoped, but assignee pickers and
  // notification recipients re-check businessId so a stray unscoped member can never
  // reach a dropdown or an email.
  const activeBusinessId = useGlobalBusinessId();
  const scopedMembers = useMemo(
    () => (teamMembers || []).filter((m: any) => !activeBusinessId || !m.businessId || m.businessId === activeBusinessId),
    [teamMembers, activeBusinessId]
  );
  const leadMutation = useMutation<Lead>('leads');
  const leadActivityMutation = useMutation('leadActivities');
  const dealMutation = useMutation<Deal>('deals');
  const customerMutation = useMutation<Customer>('customers');
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  // Read with skipTeamFilter, and a super-admin's read bypasses the per-business
  // rule — so scope to the active business before matching a lead to a client,
  // or a link could be written across tenants.
  const scopedCustomers = useMemo(
    () => (customers || []).filter((c: any) => !activeBusinessId || !c.businessId || c.businessId === activeBusinessId),
    [customers, activeBusinessId]
  );
  // Same scoping for the lead side — the duplicate finder and the merge dialog work
  // on the whole tenant (not the role-filtered `leads`), because a duplicate pair is
  // a tenant-level problem and half a pair can belong to a colleague.
  const scopedLeads = useMemo(
    () => (rawLeads || []).filter((l: any) => !activeBusinessId || !l.businessId || l.businessId === activeBusinessId),
    [rawLeads, activeBusinessId]
  );
  const duplicateLeadGroups = useMemo(() => findDuplicateGroups(scopedLeads as any), [scopedLeads]);
  // Merging rewrites quotes/contracts/deals/activities across the tenant.
  const canMerge = permissions.isAdmin || permissions.isManager || permissions.isOwner;
  const openMerge = (primaryId?: string, duplicateId?: string) => {
    setMergePair({ primaryId, duplicateId });
    setMergeOpen(true);
  };
  const waTeamId = useGlobalTeamId();
  const waEnabled = useWhatsappEnabled();
  const teamSettingsData = useTeamSettingsData();

  // Dropdown i kategorive = lista bazë + kategoritë e ruajtura në teamSettings +
  // çdo kategori që ekziston tashmë në leads (self-healing edhe kur shkrimi në
  // teamSettings s'u lejua për rolin që e shtoi).
  const categoryOptions = useMemo(() => {
    const seen = new Set(DEFAULT_BUSINESS_CATEGORIES.map(c => c.toLowerCase()));
    const custom: string[] = [];
    const add = (c?: string) => {
      const v = (c || '').trim();
      if (!v || seen.has(v.toLowerCase())) return;
      seen.add(v.toLowerCase());
      custom.push(v);
    };
    (teamSettingsData?.leadCategories || []).forEach(add);
    (scopedLeads || []).forEach((l: any) => add(l.businessCategory));
    custom.sort((a, b) => a.localeCompare(b, 'sq'));
    return [...DEFAULT_BUSINESS_CATEGORIES, ...custom];
  }, [teamSettingsData?.leadCategories, scopedLeads]);

  // Best-effort: shkrimi në teamSettings kërkon admin — nëse dështon, kategoria
  // mbetet gjithsesi te vetë lead-i dhe rifutet në dropdown nga aty.
  const persistLeadCategory = (cat: string) => {
    const v = (cat || '').trim();
    if (!v || !waTeamId) return;
    const stored = teamSettingsData?.leadCategories || [];
    const known = new Set(
      [...DEFAULT_BUSINESS_CATEGORIES, ...stored].map(c => c.toLowerCase())
    );
    if (known.has(v.toLowerCase())) return;
    saveTeamSettings(waTeamId, { leadCategories: [...stored, v] }).catch(() => {});
  };
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

  // Derived from the single source of truth (src/lib/leadStages.ts) so board,
  // table, dropdown and analytics never drift apart again.
  const STAGE_PROBABILITY: Record<string, number> = Object.fromEntries(
    LEAD_STAGES.map(s => [s.key, s.prob])
  );

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



  const getStatusLabel = leadStageLabel;

  /**
   * Writes a lead + its notification/activity trail. Shared by the normal create
   * path and the "this is an existing client — create it anyway and link" path,
   * so both produce identical records.
   */
  const persistLead = async (payload: Record<string, any>, linkedCustomer?: Customer) => {
    const createdLead = await leadMutation.create({
      ...payload,
      ...(linkedCustomer ? { customerId: linkedCustomer.id } : {}),
    } as any);
    logLead(createdLead.id, 'created', 'Lead u krijua', payload.source ? `Burimi: ${payload.source}` : undefined);

    // Reverse link, so the client profile knows about this new opportunity too.
    // Never overwrite an existing pairing.
    if (linkedCustomer && !(linkedCustomer as any).leadId) {
      customerMutation.update(linkedCustomer.id, { leadId: createdLead.id } as any)
        .catch(err => console.error('[CRMView] customer→lead link failed', err));
    }

    // Notify assigned user
    if (payload.assignedToUserId && user && payload.assignedToUserId !== user.uid) {
      await notificationMutation.create({
        userId: payload.assignedToUserId,
        type: 'lead_assigned',
        title: 'Lead i asignuar ty',
        message: `${user.displayName || 'Një admin'} të asignoi lead-in "${payload.name}"`,
        isRead: false,
        actionUrl: '/app/crm',
        actionLabel: 'Shiko CRM',
      }).catch(err => console.error('[Notifications] lead_assigned dërgim dështoi:', err));
    }

    logActivity('lead_created', `Lead i ri: ${payload.name}`, { entityType: 'lead', description: payload.company || payload.email || '' });
    setIsCreateDialogOpen(false);
    return createdLead;
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

    // Mandatory owner: every lead must have a responsible person so it never
    // lands in the "Pa asignuar" pile that kills conversion.
    if (!resolvedAssigned) {
      toast({ title: 'Cakto një përgjegjës', description: 'Çdo lead duhet të ketë një person përgjegjës.', variant: 'destructive' });
      setSaving(false); return;
    }

    persistLeadCategory(businessCategory);

    const parsedValue = estimatedValue && !isNaN(parseFloat(estimatedValue)) ? parseFloat(estimatedValue) : undefined;
    const payload: Record<string, any> = {
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
      tags: (() => { const t = parseTags(formData.get('tags') as string); return t.length ? t : undefined; })(),
      estimatedValue: parsedValue,
      probability: STAGE_PROBABILITY[status] ?? 10,
      score: calculateLeadScore({ name, email, phoneNumber, company, estimatedValue: parsedValue }),
      assignedToUserId: resolvedAssigned,
    };

    // Identity check against the UNFILTERED sources, so a restricted role can't
    // bypass a teammate's record. A second lead for the same person is always
    // wrong — block it. An existing CLIENT is a different story: a client asking
    // for a new service is a legitimate lead, so we offer a choice instead of a
    // dead end (see the dialog below).
    const candidate = { email, phone: phoneNumber, phoneNumber };
    const dupLead = findContactMatch(candidate, rawLeads);
    if (dupLead) {
      toast({
        title: `Lead ekzistues — ${matchFieldLabel(dupLead.on)} përputhet`,
        description: `"${dupLead.record.name}" është tashmë në pipeline.`,
        variant: 'destructive',
        action: <ToastAction altText="Hap lead-in" onClick={() => openLead(dupLead.record)}>Hap lead-in</ToastAction>,
      });
      setSaving(false); return;
    }
    const dupCustomer = findContactMatch(candidate, scopedCustomers as any);
    if (dupCustomer) {
      setDupCustomerPrompt({ payload, customer: dupCustomer.record as Customer, on: dupCustomer.on });
      setSaving(false); return;
    }

    await persistLead(payload);
    } finally {
      setSaving(false);
    }
  };

  // ── "This contact is already a client" — the three ways out ────────────────
  const dupOpenCustomer = () => {
    if (!dupCustomerPrompt) return;
    const { customer } = dupCustomerPrompt;
    setDupCustomerPrompt(null);
    setIsCreateDialogOpen(false);
    navigate(`/app/customers/${customer.id}`);
  };

  /** Repeat business from an existing client belongs in the deal pipeline. */
  const dupCreateDeal = async () => {
    if (!dupCustomerPrompt || dupResolving) return;
    setDupResolving(true);
    const { payload, customer } = dupCustomerPrompt;
    try {
      await dealMutation.create({
        title: payload.name + (payload.company ? ` — ${payload.company}` : ''),
        customerId: customer.id,
        customerName: customer.name,
        amount: payload.estimatedValue || 0,
        currency: 'ALL', // the form's "Vlera e Parashikuar (L)" is in Lek
        stage: 'Qualification',
        ownerId: payload.assignedToUserId || undefined,
        notes: payload.notes || undefined,
        lastActivityAt: new Date(),
      } as any);
      toast({ title: 'Marrëveshje e krijuar', description: `${customer.name} → marrëveshje e re në "Kualifikim".` });
      setDupCustomerPrompt(null);
      setIsCreateDialogOpen(false);
    } catch (err) {
      console.error('[CRMView] deal create failed', err);
      toast({ title: 'Gabim', description: 'Marrëveshja nuk u krijua.', variant: 'destructive' });
    } finally {
      setDupResolving(false);
    }
  };

  /** Keep the lead, but pair it with the client so neither record is an orphan. */
  const dupCreateLinkedLead = async () => {
    if (!dupCustomerPrompt || dupResolving) return;
    setDupResolving(true);
    const { payload, customer } = dupCustomerPrompt;
    try {
      await persistLead(payload, customer);
      toast({ title: 'Lead u krijua dhe u lidh', description: `I lidhur me klientin "${customer.name}".` });
      setDupCustomerPrompt(null);
    } catch (err) {
      console.error('[CRMView] linked lead create failed', err);
      toast({ title: 'Gabim', description: 'Lead-i nuk u krijua.', variant: 'destructive' });
    } finally {
      setDupResolving(false);
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

      // A second lead for the same person is still wrong — block it. Matching a
      // CLIENT is not: it means this lead IS that client, so we link the two
      // instead of blocking (the old check also blocked editing any converted
      // lead, since its own customer always matched).
      const candidate = { email, phone: phoneNumber, phoneNumber };
      const dupLead = findContactMatch(candidate, rawLeads, editLead.id);
      if (dupLead) {
        toast({
          title: `Lead ekzistues — ${matchFieldLabel(dupLead.on)} përputhet`,
          description: `"${dupLead.record.name}" është tashmë në pipeline.`,
          variant: 'destructive',
          action: <ToastAction altText="Hap lead-in" onClick={() => openLead(dupLead.record)}>Hap lead-in</ToastAction>,
        });
        setSaving(false); return;
      }
      const matchedCustomer = editLead.customerId
        ? null
        : findContactMatch(candidate, scopedCustomers as any)?.record as Customer | undefined;

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

      // Mandatory owner: keep the responsible person set on edit too.
      if (!resolvedAssigned) {
        toast({ title: 'Cakto një përgjegjës', description: 'Çdo lead duhet të ketë një person përgjegjës.', variant: 'destructive' });
        setSaving(false); return;
      }

      persistLeadCategory(businessCategory);

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
        tags: (() => { const t = parseTags(formData.get('tags') as string); return t.length ? t : undefined; })(),
        estimatedValue: estimatedValue && !isNaN(parseFloat(estimatedValue)) ? parseFloat(estimatedValue) : undefined,
        probability: STAGE_PROBABILITY[status] ?? editLead.probability,
        score: calculateLeadScore({ name, email, phoneNumber, company, estimatedValue: estimatedValue && !isNaN(parseFloat(estimatedValue)) ? parseFloat(estimatedValue) : undefined }),
        assignedToUserId: resolvedAssigned,
        ...(matchedCustomer ? { customerId: matchedCustomer.id } : {}),
      });

      // The edited contact details now match an existing client — pair the two so
      // the CRM never shows an unlinked lead next to that client's profile.
      if (matchedCustomer) {
        if (!(matchedCustomer as any).leadId) {
          customerMutation.update(matchedCustomer.id, { leadId: editLead.id } as any)
            .catch(err => console.error('[CRMView] customer→lead link failed', err));
        }
        toast({ title: 'U lidh me klientin', description: `Ky lead u lidh me klientin "${matchedCustomer.name}".` });
      }

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

      // Timeline: log meaningful changes
      if (status !== editLead.status) {
        logLead(editLead.id, 'status_changed', `Statusi: ${getStatusLabel(editLead.status)} → ${getStatusLabel(status)}`, undefined, { from: editLead.status, to: status });
      }
      if (resolvedAssigned !== editLead.assignedToUserId) {
        logLead(editLead.id, 'assigned', resolvedAssigned ? `Caktuar te ${getName(resolvedAssigned)}` : 'Hequr caktimi');
      }
      if (status === editLead.status && resolvedAssigned === editLead.assignedToUserId) {
        logLead(editLead.id, 'field_updated', 'Detajet u përditësuan');
      }

      toast({ title: 'Lead u përditësua', description: `${name} u përditësua me sukses.` });
      setEditLead(null);
    } finally {
      setSaving(false);
    }
  };

  // Bump a lead's recency signals after an activity. Outbound touches also set
  // firstResponseAt (once) — the basis for the first-response SLA.
  const bumpLeadActivity = (leadId: string, type: string) => {
    const patch: Record<string, any> = { lastActivityAt: new Date() };
    if (['call', 'email', 'whatsapp', 'meeting'].includes(type)) {
      const l = leads?.find(x => x.id === leadId);
      if (l && !l.firstResponseAt) patch.firstResponseAt = new Date();
    }
    leadMutation.update(leadId, patch).catch(() => { /* non-critical */ });
  };

  // Append an entry to a lead's activity timeline (fire-and-forget) + bump recency.
  const logLead = (leadId: string, type: any, title: string, body?: string, meta?: Record<string, any>) => {
    logLeadActivity(leadActivityMutation.create, {
      leadId, type, title, body, meta,
      userName: user?.displayName || user?.email || undefined,
    });
    bumpLeadActivity(leadId, type);
  };

  // Lead scoring + per-lead intel (score/temperature/SLA), extracted to a hook (P3).
  const { leadIntelMap, getScore, getTemp, getSla } = useLeadIntel(leads);

  // P2.3 — open/close the lead drawer with the URL in sync (deep-linkable via
  // ?lead=<id>; a query param keeps us on the same route so filters/scroll persist).
  const openLead = React.useCallback((lead: Lead) => {
    setSelectedLead(lead);
    setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('lead', lead.id); return p; });
  }, [setSearchParams]);
  const closeLead = React.useCallback(() => {
    setSelectedLead(null);
    setSearchParams(prev => { const p = new URLSearchParams(prev); p.delete('lead'); return p; }, { replace: true });
  }, [setSearchParams]);
  // Hydrate the drawer from a direct link / refresh once the lead is available.
  React.useEffect(() => {
    if (!routeLeadId || selectedLead?.id === routeLeadId) return;
    const found = (leads || []).find(l => l.id === routeLeadId)
      || (routeLead && (routeLead as any).id === routeLeadId ? routeLead : null);
    if (found) setSelectedLead(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeLeadId, leads, routeLead]);

  const handleAssignLead = async (lead: Lead, assignedToUserId: string) => {
    const resolved = assignedToUserId && assignedToUserId !== 'unassigned' ? assignedToUserId : undefined;
    await leadMutation.update(lead.id, { assignedToUserId: resolved });
    logLead(lead.id, 'assigned', resolved ? `Caktuar te ${getName(resolved)}` : 'Hequr caktimi');
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

  // Round-robin distribute leads among eligible reps (CRM-capable roles).
  const handleAutoDistribute = async (ids: string[]) => {
    if (ids.length === 0) return;
    const eligible = scopedMembers.filter((m: any) =>
      ['Sales', 'SalesAgent', 'Manager', 'Admin'].includes(m.role) || m.canAccessCRM === true
    );
    const pool = eligible.length ? eligible : scopedMembers;
    if (pool.length === 0) { toast({ title: 'Asnjë anëtar i disponueshëm për caktim', variant: 'destructive' }); return; }
    try {
      await Promise.all(ids.map((id, i) => {
        const m = pool[i % pool.length];
        logLead(id, 'assigned', `Caktuar te ${getName(m.userId, m.name)} (round-robin)`);
        return leadMutation.update(id, { assignedToUserId: m.userId });
      }));
      toast({ title: `${ids.length} lead u shpërndanë`, description: `Mes ${pool.length} anëtarëve (round-robin)` });
      setSelectedIds(new Set());
    } catch {
      toast({ title: 'Gabim', description: 'Shpërndarja dështoi', variant: 'destructive' });
    }
  };

  // Bulk-create leads from a parsed CSV import, skipping email/phone duplicates.
  const handleImportLeads = async (rows: Record<string, any>[]) => {
    let created = 0, skipped = 0, errors = 0;
    const seenEmail = new Set((leads || []).map(l => l.email?.toLowerCase().trim()).filter(Boolean));
    const seenPhone = new Set((leads || []).map(l => l.phoneNumber?.replace(/\D/g, '')).filter(p => p && p.length >= 7));
    (customers || []).forEach(c => {
      if (c.email) seenEmail.add(c.email.toLowerCase().trim());
      const p = c.phone?.replace(/\D/g, '');
      if (p && p.length >= 7) seenPhone.add(p);
    });
    for (const r of rows) {
      try {
        const email = (r.email || '').toLowerCase().trim();
        const phone = (r.phoneNumber || '').replace(/\D/g, '');
        if ((email && seenEmail.has(email)) || (phone && phone.length >= 7 && seenPhone.has(phone))) { skipped++; continue; }
        const status = ['New', 'Contacted', 'Qualified', 'Follow-up', 'Proposal', 'Won', 'Lost'].includes(r.status) ? r.status : 'New';
        const estimatedValue = r.estimatedValue ? parseFloat(String(r.estimatedValue).replace(/[^\d.]/g, '')) : undefined;
        const newLead = await leadMutation.create({
          name: r.name,
          email: email || undefined,
          phoneNumber: r.phoneNumber || undefined,
          company: r.company || undefined,
          jobTitle: r.jobTitle || undefined,
          website: r.website || undefined,
          source: r.source || 'Import CSV',
          businessCategory: r.businessCategory || undefined,
          address: r.address || undefined,
          notes: r.notes || undefined,
          status,
          estimatedValue: estimatedValue && !isNaN(estimatedValue) ? estimatedValue : undefined,
          probability: STAGE_PROBABILITY[status] ?? 10,
          score: calculateLeadScore({ name: r.name, email, phoneNumber: r.phoneNumber, company: r.company, estimatedValue }),
        });
        if (email) seenEmail.add(email);
        if (phone && phone.length >= 7) seenPhone.add(phone);
        logLead(newLead.id, 'created', 'Lead u importua nga CSV');
        created++;
      } catch { errors++; }
    }
    return { created, skipped, errors };
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
      if (followUpDate) {
        logLead(selectedLead.id, 'followup_scheduled', `Rikontakt i planifikuar: ${followUpDate}`, followUpNote.trim() || undefined);
      }
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
      await leadMutation.update(selectedLead.id, { lastFollowUpDate: new Date(), ...(selectedLead.firstResponseAt ? {} : { firstResponseAt: new Date() }) });
      logLead(selectedLead.id, 'whatsapp', 'WhatsApp i dërguar', recontactMsg.trim());
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
      await leadMutation.update(selectedLead.id, { lastFollowUpDate: new Date(), ...(selectedLead.firstResponseAt ? {} : { firstResponseAt: new Date() }) });
      logLead(selectedLead.id, 'email', 'Email i dërguar', recontactMsg.trim());
    } catch (err: unknown) {
      toast({ title: 'Gabim Email', description: err instanceof Error ? err.message : 'Dërgimi dështoi', variant: 'destructive' });
    } finally {
      setSendingEmail(false);
    }
  };

  // Keep the linked deal in sync when a lead is won/lost/converted (single
  // source of truth). Finds the deal by leadId and advances its stage.
  const syncDealFromLead = async (leadId: string, stage: 'Won' | 'Lost') => {
    try {
      // businessId makes the query provable under the deals rule — a leadId-only
      // list is denied outright for non-super-admins ("rules are not filters").
      const snap = await getDocs(query(
        collection(db, 'deals'),
        ...(activeBusinessId ? [where('businessId', '==', activeBusinessId)] : []),
        where('leadId', '==', leadId),
      ));
      await Promise.all(snap.docs
        .filter(d => { const s = d.data().stage; return s !== 'Won' && s !== 'Lost'; })
        .map(d => dealMutation.update(d.id, { stage, ...(stage === 'Won' ? { wonAt: new Date() } : { lostAt: new Date() }), lastActivityAt: new Date() } as any)));
    } catch { /* best-effort */ }
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
      // This person may already be a client (e.g. imported from WHMCS). Adopt that
      // record instead of refusing the conversion — the old check dead-ended here,
      // which is how leads ended up stuck next to their own client profile.
      const existing = findContactMatch(
        { email: lead.email, phone: lead.phoneNumber || lead.phone },
        scopedCustomers as any
      )?.record as Customer | undefined;
      if (existing) {
        try {
          await leadMutation.update(lead.id, {
            status: 'Converted',
            probability: 100,
            convertedAt: new Date(),
            customerId: existing.id,
          });
          if (!(existing as any).leadId) {
            await customerMutation.update(existing.id, { leadId: lead.id } as any);
          }
          logLead(lead.id, 'converted', `🎉 U lidh me klientin ekzistues "${existing.name}"`);
          toast({
            title: 'U lidh me klientin ekzistues',
            description: `"${existing.name}" ishte tashmë klient — lead-i u lidh me të, pa krijuar dublikatë.`,
            action: <ToastAction altText="Hap klientin" onClick={() => navigate(`/app/customers/${existing.id}`)}>Hap klientin</ToastAction>,
          });
        } catch (err) {
          console.error('[CRMView] adopt existing customer failed', err);
          toast({ title: 'Gabim', description: 'Lidhja me klientin ekzistues dështoi.', variant: 'destructive' });
        }
        return;
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
        // Mark the lead as Converted (keep it for history/audit) and link the
        // new customer. Non-destructive: the lead record + its activity timeline
        // survive instead of being hard-deleted.
        await leadMutation.update(lead.id, {
          status: 'Converted',
          probability: 100,
          convertedAt: new Date(),
          customerId: customerDoc!.id,
        });
      } catch (err) {
        // Roll back both customer and portal access on any failure
        if (portalAccessDoc?.id) await portalAccessMutation.remove(portalAccessDoc.id).catch(() => {});
        if (customerDoc?.id) await customerMutation.remove(customerDoc.id).catch(() => {});
        toast({ title: 'Gabim gjatë konvertimit', description: 'Ndodhi një gabim. Statusi nuk u ndryshua.', variant: 'destructive' });
        return;
      }

      // Send notification to Admin + Sales (canAccessCRM) team members (best-effort)
      if (user && teamMembers) {
        const notifyPromises = scopedMembers
          .filter(m => (m.status ?? 'Active') === 'Active' && m.userId !== user.uid && (m.role === 'Admin' || m.canAccessCRM))
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
      logLead(lead.id, 'converted', '🎉 Lead u konvertua në klient');

      // Spin up an Opportunity/Deal from the converted lead (Salesforce-style).
      dealMutation.create({
        title: lead.name + (lead.company ? ` — ${lead.company}` : ''),
        customerId: customerDoc!.id,
        customerName: lead.name,
        leadId: lead.id,
        amount: lead.estimatedValue || 0,
        currency: 'ALL', // lead.estimatedValue is entered in Lek ("Vlera e Parashikuar (L)")
        stage: 'Qualification',
        ownerId: lead.assignedToUserId || undefined,
        lastActivityAt: new Date(),
      }).catch(() => { /* non-critical */ });

      toast({ title: 'Lead u konvertua', description: `${lead.name} → klient + marrëveshje e re.` });
      return;
    }

    // Normal status change (not conversion)
    const update: Record<string, any> = { status: newStatus, probability: STAGE_PROBABILITY[newStatus] ?? undefined };
    if (newStatus === 'Follow-up') update.lastFollowUpDate = new Date();
    // Optimistic UI: reflect new status immediately
    setOptimisticStatus(prev => ({ ...prev, [lead.id]: newStatus }));
    try {
      await leadMutation.update(lead.id, update);
      if (newStatus === 'Won') syncDealFromLead(lead.id, 'Won');
      logLead(lead.id, 'status_changed', `Statusi: ${getStatusLabel(lead.status)} → ${getStatusLabel(newStatus)}`, undefined, { from: lead.status, to: newStatus });
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
    syncDealFromLead(lostReasonLead.id, 'Lost');
    logLead(lostReasonLead.id, 'lost', 'Shënuar si i humbur', lostReason || undefined);
    toast({ title: 'Lead u shënja si i humbur', description: lostReason ? `Arsyeja: ${lostReason}` : undefined });
    setLostReasonLead(null);
    setLostReason('');
  };

  // Enroll / stop the automated follow-up cadence for a lead.
  const toggleCadence = async (lead: Lead) => {
    const active = !lead.cadenceActive;
    try {
      await leadMutation.update(lead.id, active
        ? ({ cadenceActive: true, cadenceStartedAt: new Date(), cadenceStep: 0 } as any)
        : ({ cadenceActive: false } as any));
      logLead(lead.id, 'followup_scheduled', active ? 'Sekuenca e ndjekjes u aktivizua' : 'Sekuenca e ndjekjes u ndal');
      toast({ title: active ? '🔁 Sekuenca e ndjekjes u aktivizua' : 'Sekuenca u ndal' });
    } catch { toast({ title: 'Gabim', variant: 'destructive' }); }
  };

  const filteredLeads = React.useMemo(() => {
    if (!leads) return [];
    // Apply optimistic status overrides
    const base = Object.keys(optimisticStatus).length === 0
      ? leads
      : leads.map(l => optimisticStatus[l.id] ? { ...l, status: optimisticStatus[l.id] } : l);
    let result = base;
    // "all" hides Converted leads (they're customers now) — still visible via the Converted tab.
    if (activeTab !== 'all') result = result.filter(l => l.status === activeTab);
    else result = result.filter(l => l.status !== 'Converted');
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
      const s = getScore(l);
      if (scoreFilter === 'high') return s >= 70;
      if (scoreFilter === 'medium') return s >= 40 && s < 70;
      if (scoreFilter === 'low') return s < 40;
      return true;
    });
    if (assignedFilter === 'mine') result = result.filter(l => l.assignedToUserId === user?.uid);
    if (assignedFilter === 'unassigned') result = result.filter(l => !l.assignedToUserId);
    if (sourceFilter !== 'all') result = result.filter(l => l.source === sourceFilter);
    if (tagFilter !== 'all') result = result.filter(l => Array.isArray(l.tags) && l.tags.includes(tagFilter));

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
          return (getScore(a) - getScore(b)) * dir;
        }
        case 'prob': return ((a.probability ?? STAGE_PROBABILITY[a.status] ?? 0) - (b.probability ?? STAGE_PROBABILITY[b.status] ?? 0)) * dir;
        case 'follow': return (getFollowMs(a) - getFollowMs(b)) * dir;
        case 'createdAt':
        default: return (getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt)) * (sortDir === 'asc' ? -1 : 1);
      }
    });
    return sorted;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, activeTab, searchQuery, scoreFilter, assignedFilter, sourceFilter, tagFilter, sortBy, sortDir, user, optimisticStatus]);

  // Distinct tags across leads (for the tag filter dropdown)
  const allTags = React.useMemo(() => {
    const s = new Set<string>();
    (leads || []).forEach(l => (l.tags || []).forEach(t => t && s.add(t)));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [leads]);
  // Suggestions for the tag picker in the lead form — leads + customers, so tags
  // stay consistent across both and users don't create near-duplicates.
  const tagSuggestions = React.useMemo(() => {
    const s = new Set<string>();
    (leads || []).forEach((l: any) => parseTags(l.tags).forEach(t => s.add(t)));
    (customers || []).forEach((c: any) => parseTags(c.tags).forEach(t => s.add(t)));
    return Array.from(s);
  }, [leads, customers]);

  // Reset window when filters/sort change
  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
  }, [activeTab, searchQuery, scoreFilter, assignedFilter, sourceFilter, sortBy, sortDir]);

  const hasActiveFilters = searchQuery.trim() !== '' || scoreFilter !== 'all' || assignedFilter !== 'all' || sourceFilter !== 'all' || tagFilter !== 'all';
  const clearAllFilters = () => {
    setSearchQuery('');
    setScoreFilter('all');
    setAssignedFilter('all');
    setSourceFilter('all');
    setTagFilter('all');
  };

  // P2.2 — saved segments (named filter sets).
  const { segments, saveSegment, deleteSegment } = useSavedSegments();
  const applySegment = (seg: LeadSegment) => {
    const f = seg.filters;
    setSearchQuery(f.searchQuery || '');
    setScoreFilter(f.scoreFilter || 'all');
    setAssignedFilter(f.assignedFilter || 'all');
    setSourceFilter(f.sourceFilter || 'all');
    setTagFilter(f.tagFilter || 'all');
    setSortBy((f.sortBy as any) || 'createdAt');
    setSortDir((f.sortDir as any) || 'desc');
    setActiveTab(f.activeTab || 'all');
  };
  const handleSaveSegment = () => {
    const name = window.prompt('Emri i segmentit:');
    if (!name) return;
    saveSegment(name, { searchQuery, scoreFilter, assignedFilter, sourceFilter, tagFilter, sortBy, sortDir, activeTab });
    toast({ title: 'Segmenti u ruajt', description: name });
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

  // Forecast (weighted) — current value + 30d sparkline + delta vs prior 30d
  const forecastData = React.useMemo(() => {
    const active = (leads || []).filter(l => l.status !== 'Lost' && l.status !== 'Converted');
    const currentValue = active.reduce((sum, l) => {
      const prob = (l.probability ?? STAGE_PROBABILITY[l.status] ?? 0) / 100;
      return sum + (l.estimatedValue || 0) * prob;
    }, 0);

    // Build cumulative forecast per day for the last 60 days, using createdAt as
    // "lead became part of pipeline". Single pass: bucket each active lead's
    // weighted value at the day it first enters the 60-day window, then prefix-sum.
    // points[k] = cutoff (today - (59-k) days); O(n + 60) instead of O(60·n).
    const DAY = 86400000;
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const todayMs = today.getTime();
    const add = new Array(60).fill(0);
    for (const l of active) {
      const createdMs = getTimestampMs(l.createdAt);
      const diff = todayMs - createdMs;
      if (!createdMs || diff < 0) continue; // no/invalid date or created after today
      const prob = (l.probability ?? STAGE_PROBABILITY[l.status] ?? 0) / 100;
      const w = (l.estimatedValue || 0) * prob;
      let k0 = 59 - Math.floor(diff / DAY);
      if (k0 < 0) k0 = 0;      // older than the window → counts from day 0
      if (k0 > 59) continue;   // outside the window
      add[k0] += w;
    }
    const points: number[] = [];
    let running = 0;
    for (let k = 0; k < 60; k++) { running += add[k]; points.push(running); }
    const last30 = points.slice(30);
    const prev30 = points.slice(0, 30);
    const avgPrev = prev30.reduce((a, b) => a + b, 0) / Math.max(prev30.length, 1);
    const avgLast = last30.reduce((a, b) => a + b, 0) / Math.max(last30.length, 1);
    const deltaPct = avgPrev > 0 ? ((avgLast - avgPrev) / avgPrev) * 100 : 0;
    return { currentValue, spark: last30, deltaPct };
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
      const anyDialogOpen = isCreateDialogOpen || !!editLead || !!selectedLead || !!leadToDelete || !!whatsappLead || !!lostReasonLead || !!dupCustomerPrompt || discardOpen || shortcutsOpen;
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
          openLead(filteredLeads[highlightedIndex]);
        }
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filteredLeads, highlightedIndex, isCreateDialogOpen, editLead, selectedLead, leadToDelete, whatsappLead, lostReasonLead, dupCustomerPrompt, discardOpen, shortcutsOpen, permissions.canEdit]);

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
    <div className="space-y-8 w-full min-w-0">
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
            <button
              type="button"
              onClick={() => setViewMode('analytics')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${viewMode === 'analytics' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              aria-pressed={viewMode === 'analytics'}
            >
              Analitikë
            </button>
            {canMerge && (
              <button
                type="button"
                onClick={() => setViewMode('duplicates')}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${viewMode === 'duplicates' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                aria-pressed={viewMode === 'duplicates'}
              >
                Dublikatë{duplicateLeadGroups.length > 0 ? ` (${duplicateLeadGroups.length})` : ''}
              </button>
            )}
            {canMerge && (
              <button
                type="button"
                onClick={() => setViewMode('automations')}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${viewMode === 'automations' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                aria-pressed={viewMode === 'automations'}
              >
                Automatizime
              </button>
            )}
          </div>
          <div className="hidden sm:block">
            <ExportButton
              data={filteredLeads}
              filename={`leads-${new Date().toISOString().slice(0, 10)}`}
              columns={['name', 'email', 'phoneNumber', 'company', 'jobTitle', 'website', 'status', 'source', 'estimatedValue', 'score', 'probability', 'businessCategory', 'notes']}
            />
          </div>
          {permissions.canEdit && (
            <Button variant="outline" className="hidden sm:inline-flex" onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4 mr-2" />
              Importo
            </Button>
          )}
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
              <LeadForm onSubmit={(data) => { setDirty(false); handleCreateLead(data); }} disabled={saving} teamMembers={scopedMembers} getName={getName} onDirtyChange={setDirty} tagSuggestions={tagSuggestions} categoryOptions={categoryOptions} currentUserId={user?.uid} />
            </DialogContent>
          </Dialog>
        )}
        </div>
      </div>

      {/* Search & Filter bar */}
      <LeadFiltersBar
        searchQuery={searchQuery} setSearchQuery={setSearchQuery} searchInputRef={searchInputRef}
        scoreFilter={scoreFilter} setScoreFilter={setScoreFilter}
        assignedFilter={assignedFilter} setAssignedFilter={setAssignedFilter}
        sourceFilter={sourceFilter} setSourceFilter={setSourceFilter}
        tagFilter={tagFilter} setTagFilter={setTagFilter}
        allTags={allTags}
      />

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

      {/* Saved segments (P2.2) */}
      <div className="flex flex-wrap items-center gap-1.5 -mt-1">
        <span className="text-xs text-muted-foreground">Segmentet:</span>
        {segments.length === 0 && (
          <span className="text-xs text-muted-foreground/70 italic">asnjë ende</span>
        )}
        {segments.map(seg => (
          <Badge key={seg.name} variant="outline" className="gap-1 pl-2 pr-1 font-normal">
            <button onClick={() => applySegment(seg)} className="hover:underline" aria-label={`Apliko segmentin ${seg.name}`}>
              {seg.name}
            </button>
            <button onClick={() => deleteSegment(seg.name)} className="hover:bg-muted rounded-sm p-0.5" aria-label={`Fshi segmentin ${seg.name}`}>
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
        {hasActiveFilters && (
          <button
            onClick={handleSaveSegment}
            className="text-xs text-primary hover:underline underline-offset-2 ml-1 flex items-center gap-0.5"
          >
            <Plus className="w-3 h-3" /> Ruaj filtrin
          </button>
        )}
      </div>

      <div className="grid gap-2 sm:gap-3 stagger-children" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
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
          <div className="mt-1.5 flex items-end justify-between gap-2">
            <p className="text-2xl sm:text-3xl text-foreground font-semibold tabular-nums leading-none">
              {`${Math.round(forecastData.currentValue).toLocaleString()} L`}
            </p>
            {(() => {
              const spark = forecastData.spark;
              if (!spark.length) return null;
              const max = Math.max(...spark, 1);
              const min = Math.min(...spark);
              const range = max - min || 1;
              const w = 60;
              const h = 24;
              const step = spark.length > 1 ? w / (spark.length - 1) : 0;
              const points = spark.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`).join(' ');
              const trendUp = forecastData.deltaPct >= 0;
              const strokeColor = trendUp ? 'rgb(34 197 94)' : 'rgb(239 68 68)';
              return (
                <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" aria-hidden="true">
                  <polyline fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={points} />
                </svg>
              );
            })()}
          </div>
          {(() => {
            const d = forecastData.deltaPct;
            if (!isFinite(d) || d === 0) return null;
            const up = d > 0;
            return (
              <p className={`mt-1 text-xs tabular-nums ${up ? 'text-success' : 'text-destructive'}`}>
                {up ? '▲' : '▼'} {Math.abs(d).toFixed(1)}% vs 30 ditët para
              </p>
            );
          })()}
        </Card>
      </div>

      {viewMode === 'duplicates' && canMerge ? (
        <DuplicateContactsPanel
          kind="lead"
          records={scopedLeads as any}
          onMerge={(primaryId, duplicateId) => openMerge(primaryId, duplicateId)}
          action={
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openMerge()}>
              Bashko dy lead manualisht
            </Button>
          }
        />
      ) : viewMode === 'automations' && canMerge ? (
        <AutomationRulesPanel
          leads={scopedLeads as any}
          customers={scopedCustomers as any}
          teamMembers={scopedMembers as any}
          getName={getName}
          canManage={canMerge}
        />
      ) : viewMode === 'analytics' ? (
        <LeadAnalytics leads={leads || []} teamMembers={teamMembers || []} getName={getName} />
      ) : viewMode === 'pipeline' ? (
        <PipelineBoard
          leads={
            (Object.keys(optimisticStatus).length === 0
              ? (leads || [])
              : (leads || []).map(l => optimisticStatus[l.id] ? { ...l, status: optimisticStatus[l.id] } : l))
          }
          onStatusChange={handleStatusChange}
          onCardClick={openLead}
          calculateLeadScore={calculateLeadScore}
          intel={leadIntelMap}
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
            {filteredLeads.slice(0, visibleLimit).map((lead) => {
              const s = getScore(lead);
              const scoreColor = s >= 70 ? 'text-green-600' : s >= 40 ? 'text-yellow-600' : 'text-red-500';
              const leadPhone = normalizeAlbanianPhone(lead.phoneNumber || lead.phone || '');
              const waUnread = leadPhone ? (waUnreadByPhone.get(leadPhone) || 0) : 0;
              const nd = lead.nextFollowUpDate;
              let followBadge: React.ReactNode = null;
              if (nd) {
                const d = nd instanceof Date ? new Date(nd) : new Date((nd as any)?.seconds ? (nd as any).seconds * 1000 : nd);
                const today = new Date(); today.setHours(0,0,0,0); d.setHours(0,0,0,0);
                const isOverdue = d < today;
                const isDueToday = d.getTime() === today.getTime();
                followBadge = (
                  <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
                    isOverdue ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                    isDueToday ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  }`}>
                    <Clock className="w-3 h-3" />
                    {isOverdue ? 'Vonuar' : isDueToday ? 'Sot' : d.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' })}
                  </span>
                );
              }
              return (
                <Card key={lead.id} className="p-3 active:bg-muted/40 transition-colors" onClick={() => openLead(lead)}>
                  {/* Tier 1 — name + status + score + menu */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="shrink-0">{TEMP_META[getTemp(lead)].emoji}</span>
                      <p className="font-medium text-foreground truncate">{lead.name}</p>
                      {getSla(lead).breached && <span className="text-[10px] px-1 py-0.5 rounded-full font-medium bg-red-500 text-white shrink-0">SLA</span>}
                      <Badge className={`${getStatusColor(lead.status)} text-[10px] py-0 px-1.5 shrink-0`}>
                        {getStatusLabel(lead.status)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {waUnread > 0 && waEnabled && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setWhatsappLead(lead); }}
                          className="flex items-center gap-0.5 bg-[#25D366] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          aria-label={`${waUnread} mesazhe të palexuara`}
                        >
                          <MessageSquare className="w-3 h-3" />
                          {waUnread}
                        </button>
                      )}
                      <div className="flex items-center gap-0.5">
                        <Zap className={`w-3 h-3 ${scoreColor}`} />
                        <span className={`text-xs font-semibold tabular-nums ${scoreColor}`}>{s}</span>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => e.stopPropagation()} aria-label="Veprime">
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

                  {/* Tier 2 — company · value · follow-up */}
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground min-w-0">
                    {lead.company && (
                      <span className="truncate">{lead.company}</span>
                    )}
                    {lead.estimatedValue ? (
                      <>
                        {lead.company && <span className="opacity-50">·</span>}
                        <span className="text-foreground font-medium tabular-nums shrink-0">{lead.estimatedValue.toLocaleString()} L</span>
                      </>
                    ) : null}
                    {followBadge && (
                      <>
                        <span className="ml-auto">{followBadge}</span>
                      </>
                    )}
                  </div>

                  {/* Tier 3 — quick contact actions */}
                  {(lead.email || lead.phoneNumber || lead.assignedToUserId) && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs">
                      {lead.email && (
                        <a
                          href={`mailto:${lead.email}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted hover:bg-muted/70 text-foreground"
                          aria-label={`Email ${lead.email}`}
                        >
                          <Mail className="w-3 h-3" />
                          <span className="truncate max-w-[140px]">{lead.email}</span>
                        </a>
                      )}
                      {lead.phoneNumber && (
                        <a
                          href={`tel:${lead.phoneNumber.replace(/\s/g, '')}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted hover:bg-muted/70 text-foreground tabular-nums shrink-0"
                          aria-label={`Telefono ${lead.phoneNumber}`}
                        >
                          <Phone className="w-3 h-3" />
                          {lead.phoneNumber}
                        </a>
                      )}
                      {lead.assignedToUserId && (
                        <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground">
                          <UserCircle className="w-3 h-3" />
                          <span className="truncate max-w-[80px]">{getName(lead.assignedToUserId, '…')}</span>
                        </span>
                      )}
                    </div>
                  )}

                  {lead.status === 'Lost' && lead.lostReason && (
                    <p className="mt-1.5 text-[11px] text-destructive">Arsyeja: {lead.lostReason}</p>
                  )}
                </Card>
              );
            })}
            {filteredLeads.length > visibleLimit && (
              <div className="flex items-center justify-between gap-2 px-1 pt-1">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {visibleLimit} nga {filteredLeads.length}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setVisibleLimit(v => v + PAGE_SIZE)}
                >
                  Shfaq më shumë
                </Button>
              </div>
            )}
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
                      {(['New', 'Contacted', 'Qualified', 'Proposal', 'Follow-up', 'Lost'] as const).map(s => (
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
                      {scopedMembers.map(m => (
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

                  {/* Exactly two selected rows = "these are the same person". */}
                  {canMerge && selectedIds.size === 2 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const [a, b] = Array.from(selectedIds);
                        openMerge(a, b);
                      }}
                      title="Bashko dy lead dublikatë"
                    >
                      Bashko dublikatat
                    </Button>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAutoDistribute(Array.from(selectedIds))}
                    title="Shpërndaj në mënyrë të barabartë (round-robin) mes ekipit"
                  >
                    <UserCircle className="w-4 h-4 mr-1" />
                    Shpërndaj auto
                  </Button>

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
            <div className="w-full min-w-0 overflow-x-auto">
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
                      Aktiviteti i fundit
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Veprime
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredLeads.slice(0, visibleLimit).map((lead, idx) => (
                    <tr
                      key={lead.id}
                      className={`group hover:bg-muted/50 cursor-pointer transition-colors duration-fast ${idx === highlightedIndex ? 'bg-muted/60 ring-1 ring-inset ring-primary/40' : ''} ${selectedIds.has(lead.id) ? 'bg-primary/5' : ''}`}
                      onClick={() => openLead(lead)}
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
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {(() => { const t = getTemp(lead); return (
                              <span title={`Temperatura: ${TEMP_META[t].label}`} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TEMP_META[t].className}`}>
                                {TEMP_META[t].emoji}
                              </span>
                            ); })()}
                            <p className="text-body font-normal text-foreground">{lead.name}</p>
                            {(() => { const s = getSla(lead); return (<>
                              {s.breached && <span title="Pa përgjigje brenda 24h" className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-red-500 text-white">⏰ SLA</span>}
                              {!s.breached && s.stale && <span title="Pa aktivitet prej 14+ ditësh" className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300">💤 Ngrirë</span>}
                            </>); })()}
                          </div>
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
                          <SelectTrigger className="w-full sm:w-[140px]" onClick={(e) => e.stopPropagation()}>
                            <SelectValue>
                              <Badge className={getStatusColor(lead.status)}>
                                {getStatusLabel(lead.status)}
                              </Badge>
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {SELECTABLE_STATUSES.map(s => (
                              <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-6 py-4" onClick={e => e.stopPropagation()}>
                        {permissions.canEdit ? (
                          <Select
                            value={lead.assignedToUserId || 'unassigned'}
                            onValueChange={val => handleAssignLead(lead, val === 'unassigned' ? '' : val)}
                          >
                            <SelectTrigger className="w-full sm:w-[130px] h-8 text-xs">
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
                              {scopedMembers.filter(m => m.status === 'Active').map(m => (
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
                          const s = getScore(lead);
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
                      <td className="px-6 py-4 text-xs text-muted-foreground">
                        {(() => {
                          const raw = lead.lastFollowUpDate;
                          if (!raw) return <span>—</span>;
                          const d = raw instanceof Date ? raw : new Date((raw as any)?.seconds ? (raw as any).seconds * 1000 : (raw as any));
                          if (isNaN(d.getTime())) return <span>—</span>;
                          const now = Date.now();
                          const diffMs = now - d.getTime();
                          const days = Math.floor(diffMs / 86400000);
                          let label: string;
                          if (days <= 0) label = 'Sot';
                          else if (days === 1) label = 'Dje';
                          else if (days < 7) label = `${days} ditë më parë`;
                          else if (days < 30) label = `${Math.floor(days / 7)} javë më parë`;
                          else label = d.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short', year: days > 365 ? 'numeric' : undefined });
                          const stale = days > 14;
                          return (
                            <span className={stale ? 'text-warning' : ''} title={d.toLocaleString('sq-AL')}>
                              {label}
                            </span>
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
            {filteredLeads.length > visibleLimit && (
              <div className="border-t border-border p-3 flex items-center justify-between text-xs text-muted-foreground">
                <span className="tabular-nums">
                  Po shfaqen {visibleLimit} nga {filteredLeads.length} lead
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setVisibleLimit(v => v + PAGE_SIZE)}
                >
                  Shfaq edhe {Math.min(PAGE_SIZE, filteredLeads.length - visibleLimit)}
                </Button>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
      )}

      <DetailDrawer
        open={!!selectedLead}
        onClose={closeLead}
        title={selectedLead?.name || ''}
        data={selectedLead}
        onSaveNotes={selectedLead ? async (notes) => {
          await leadMutation.update(selectedLead.id, { notes });
          logLead(selectedLead.id, 'note', 'Shënim u përditësua');
        } : undefined}
        activityContent={selectedLead ? <LeadTimeline leadId={selectedLead.id} onLogged={(type) => bumpLeadActivity(selectedLead.id, type)} /> : undefined}
        actions={selectedLead ? (
          <div className="space-y-3">
            {(() => { const t = getTemp(selectedLead); const s = getSla(selectedLead); return (
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TEMP_META[t].className}`}>{TEMP_META[t].emoji} {TEMP_META[t].label}</span>
                {s.breached && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-500 text-white">⏰ SLA e shkelur</span>}
                {!s.breached && s.stale && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300">💤 Ngrirë</span>}
              </div>
            ); })()}
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

                  {/* ── Automated follow-up cadence ── */}
                  <div className="border-t pt-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Bell className="w-4 h-4 text-primary" />
                      <p className="text-sm font-semibold">Sekuencë Automatike Ndjekjeje</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Krijon automatikisht detyra rikontakti sipas ditëve të konfiguruara (parazgjedhje: 1, 3, 7, 14 ditë), derisa lead-i të mbyllet.
                    </p>
                    <Button
                      size="sm"
                      variant={selectedLead.cadenceActive ? 'outline' : 'default'}
                      className={selectedLead.cadenceActive ? 'w-full text-destructive border-destructive/30' : 'w-full'}
                      onClick={() => toggleCadence(selectedLead)}
                    >
                      {selectedLead.cadenceActive
                        ? `Ndal sekuencën (hapi ${(selectedLead.cadenceStep || 0) + 1})`
                        : 'Nis sekuencën e ndjekjes'}
                    </Button>
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
                          const cur = currencySymbol(q.currency);
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
          {
            value: 'dokumente',
            label: (() => {
              const live = (leads || []).find(l => l.id === selectedLead.id) || selectedLead;
              const n = live.attachments?.length || 0;
              return n ? `Dokumente (${n})` : 'Dokumente';
            })(),
            content: (
              <LeadDocumentsPanel
                key={selectedLead.id}
                lead={(leads || []).find(l => l.id === selectedLead.id) || selectedLead}
                canEdit={!!permissions.canEdit}
              />
            ),
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

      {/* CSV import */}
      <LeadImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImport={handleImportLeads} />

      {/* Manual merge of two duplicate leads (moves quotes, deals, activities, …) */}
      {canMerge && (
        <MergeContactsDialog
          kind="lead"
          open={mergeOpen}
          onOpenChange={(open) => { setMergeOpen(open); if (!open) setMergePair({}); }}
          records={scopedLeads as any}
          initialPrimaryId={mergePair.primaryId}
          initialDuplicateId={mergePair.duplicateId}
          onMerged={() => setSelectedIds(new Set())}
        />
      )}

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
              tagSuggestions={tagSuggestions}
              categoryOptions={categoryOptions}
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
      {/* Existing client detected — a repeat request from a client is legitimate,
          so offer the three sensible outcomes instead of blocking the save. */}
      <Dialog open={!!dupCustomerPrompt} onOpenChange={(open) => { if (!open && !dupResolving) setDupCustomerPrompt(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ky kontakt është klient</DialogTitle>
          </DialogHeader>
          {dupCustomerPrompt && (
            <>
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{dupCustomerPrompt.customer.name}</span> është
                tashmë klient dhe {matchFieldLabel(dupCustomerPrompt.on)} përputhet. Zgjidh si të vazhdojmë:
              </p>
              <div className="space-y-2 pt-1">
                <Button variant="outline" className="w-full justify-start" onClick={dupOpenCustomer} disabled={dupResolving}>
                  <UserCircle className="w-4 h-4 mr-2 shrink-0" />
                  <span className="text-left">Hap klientin<span className="block text-xs text-muted-foreground font-normal">Shiko historikun, faturat dhe projektet</span></span>
                </Button>
                <Button variant="outline" className="w-full justify-start" onClick={dupCreateDeal} disabled={dupResolving}>
                  <TrendingUp className="w-4 h-4 mr-2 shrink-0" />
                  <span className="text-left">Krijo marrëveshje të re<span className="block text-xs text-muted-foreground font-normal">Shërbim i re për një klient ekzistues</span></span>
                </Button>
                <Button variant="outline" className="w-full justify-start" onClick={dupCreateLinkedLead} disabled={dupResolving}>
                  <Plus className="w-4 h-4 mr-2 shrink-0" />
                  <span className="text-left">Krijo lead dhe lidhe<span className="block text-xs text-muted-foreground font-normal">Mbaje në pipeline, i lidhur me klientin</span></span>
                </Button>
              </div>
              <div className="flex justify-end pt-1">
                <Button variant="ghost" onClick={() => setDupCustomerPrompt(null)} disabled={dupResolving}>Anulo</Button>
              </div>
            </>
          )}
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
  tagSuggestions?: string[];
  categoryOptions?: string[];
  /** Lead i ri asignohet automatikisht te personi i loguar (ndryshohet me dorë). */
  currentUserId?: string;
}> = ({ onSubmit, initialData, disabled, teamMembers = [], getName, onDirtyChange, tagSuggestions = [], categoryOptions = DEFAULT_BUSINESS_CATEGORIES, currentUserId }) => {
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

  // Kategoria: listë + mundësi për të shtuar një të re me dorë. Kategoria e një
  // lead-i ekzistues futet në listë edhe nëse s'është më ndër opsionet.
  const [category, setCategory] = useState(initialData?.businessCategory || '');
  const [customCategory, setCustomCategory] = useState(false);
  const allCategories = useMemo(() => {
    const initial = (initialData?.businessCategory || '').trim();
    if (initial && !categoryOptions.some(c => c.toLowerCase() === initial.toLowerCase())) {
      return [...categoryOptions, initial];
    }
    return categoryOptions;
  }, [categoryOptions, initialData?.businessCategory]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    if (lastFollowUpDate) {
      formData.set('lastFollowUpDate', lastFollowUpDate.toISOString());
    }
    formData.set('businessCategory', category.trim());
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
              <SelectTrigger className="w-full sm:w-[100px] sm:shrink-0">
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
        {customCategory ? (
          <>
            <div className="flex gap-1">
              <Input
                id="businessCategory"
                required
                autoFocus
                maxLength={60}
                placeholder="Shkruaj kategorinë e re…"
                value={category}
                onChange={(e) => { setCategory(e.target.value); onDirtyChange?.(true); }}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => { setCustomCategory(false); setCategory(initialData?.businessCategory || ''); }}
                title="Kthehu te lista"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Kategoria e re ruhet dhe do të shfaqet në listë herës tjetër.
            </p>
          </>
        ) : (
          <Select
            required
            value={category}
            onValueChange={(v) => {
              if (v === '__new__') { setCustomCategory(true); setCategory(''); }
              else setCategory(v);
              onDirtyChange?.(true);
            }}
          >
            <SelectTrigger id="businessCategory">
              <SelectValue placeholder="Zgjidh kategorinë" />
            </SelectTrigger>
            <SelectContent>
              {allCategories.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
              <SelectItem value="__new__" className="text-primary font-medium">
                + Shto kategori të re…
              </SelectItem>
            </SelectContent>
          </Select>
        )}
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
              {SELECTABLE_STATUSES.map(s => (
                <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
              ))}
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
          {/* Lead i ri: parazgjedhja është vetë personi i loguar (nëse është në listë),
              jo "Pa asignuar" — çdo lead duhet të ketë një përgjegjës gjithsesi. */}
          <Select
            name="assignedToUserId"
            defaultValue={
              initialData?.assignedToUserId
                || (currentUserId && teamMembers.some(m => m.userId === currentUserId && m.status === 'Active')
                  ? currentUserId
                  : 'unassigned')
            }
          >
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
        <Label>Etiketat</Label>
        <ContactTagsField name="tags" initial={initialData?.tags} suggestions={tagSuggestions} />
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
