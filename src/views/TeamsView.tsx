import React, { useState, useMemo } from 'react';
import { useCollection, useMutation, useGlobalBusinessId } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { getDocs, query, where, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Users, Plus, MoreVertical, Mail, UserPlus, Shield, Trash2, CheckCircle, XCircle, Clock, Edit2, Check, X, Settings, Eye, Globe, Search, Share2, PenTool, Palette, Megaphone, Code2, HeadphonesIcon, Briefcase, DollarSign, TrendingUp, UserCheck, Copy, Send } from 'lucide-react';

// Returns icon + colour classes based on the team's department / service category
function getTeamDeptIcon(department?: string) {
  const d = (department || '').toLowerCase();
  if (d.includes('web') || d.includes('zhvillim') || d.includes('development') || d.includes('dev') || d.includes('it') || d.includes('tech'))
    return { Icon: Code2, bg: 'bg-blue-100', color: 'text-blue-600' };
  if (d.includes('seo') || d.includes('search'))
    return { Icon: Search, bg: 'bg-green-100', color: 'text-green-600' };
  if (d.includes('social') || d.includes('media'))
    return { Icon: Share2, bg: 'bg-accent-soft', color: 'text-primary' };
  if (d.includes('content') || d.includes('shkrim') || d.includes('writing'))
    return { Icon: PenTool, bg: 'bg-orange-100', color: 'text-orange-600' };
  if (d.includes('brand') || d.includes('dizajn') || d.includes('design') || d.includes('creative') || d.includes('kreativ'))
    return { Icon: Palette, bg: 'bg-pink-100', color: 'text-pink-600' };
  if (d.includes('ads') || d.includes('paid') || d.includes('advertis') || d.includes('reklamë') || d.includes('marketing'))
    return { Icon: Megaphone, bg: 'bg-yellow-100', color: 'text-yellow-600' };
  if (d.includes('support') || d.includes('suport') || d.includes('helpdesk'))
    return { Icon: HeadphonesIcon, bg: 'bg-sky-100', color: 'text-sky-600' };
  if (d.includes('consult') || d.includes('konsulenc'))
    return { Icon: Briefcase, bg: 'bg-navy-700/10', color: 'text-navy-700' };
  if (d.includes('financ') || d.includes('account') || d.includes('kontabilitet'))
    return { Icon: DollarSign, bg: 'bg-emerald-100', color: 'text-emerald-600' };
  if (d.includes('sales') || d.includes('shitje'))
    return { Icon: TrendingUp, bg: 'bg-teal-100', color: 'text-teal-600' };
  if (d.includes('hr') || d.includes('human') || d.includes('burime njerëzore'))
    return { Icon: UserCheck, bg: 'bg-rose-100', color: 'text-rose-600' };
  return { Icon: Users, bg: 'bg-primary/10', color: 'text-primary' };
}
import { usePermissions } from '../contexts/PermissionsContext';
import { cn } from '../lib/utils';
import { appendSalaryChange } from '../lib/finance/salaryHistory';
import { parseDate } from '../lib/finance/financialAnalytics';
import { toast } from '../hooks/use-toast';
import { useSubscription } from '../hooks/useSubscription';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import ExportButton from '../components/ExportButton';
import { useUserNames } from '../hooks/useUserNames';
import type { Team, TeamMember, TeamInvite } from '../types';
import { positionOptions, positionLabel } from '../lib/productivity/reportTemplates';

const TeamsView: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [isMembersDialogOpen, setIsMembersDialogOpen] = useState(false);
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [isEditMemberDialogOpen, setIsEditMemberDialogOpen] = useState(false);
  const [memberToDelete, setMemberToDelete] = useState<TeamMember | null>(null);
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null);

  const businessId = useGlobalBusinessId();
  const { seats } = useSubscription();
  // A team is a DEPARTMENT INSIDE a business, so this page NEVER leaves the active
  // business — super-admins included. useCollection now scopes these three
  // collections for everyone, so the explicit predicate below is belt-and-braces:
  // it is what made this page correct while the super-admin bypass still existed
  // (every tenant's department showed up here, reading as "teams created
  // themselves"). Cross-tenant listing lives in the console (/superadmin).
  const businessScope = useMemo(
    () => (businessId ? [{ field: 'businessId', operator: '==', value: businessId }] : undefined),
    [businessId]
  );
  const { data: allTeams, loading: teamsLoading } = useCollection<Team>('teams', {
    skip: !businessId,
    where: businessScope,
    skipTeamFilter: true,
  });
  const teams = useMemo(() => {
    const list = (allTeams || []).filter(t => (t as any).businessId === businessId);
    // Sorted here rather than server-side: `where + orderBy` on different fields
    // would need a composite index for no benefit at this size.
    return [...list].sort((a, b) => {
      const ta = (a as any).createdAt instanceof Date ? (a as any).createdAt.getTime() : 0;
      const tb = (b as any).createdAt instanceof Date ? (b as any).createdAt.getTime() : 0;
      return tb - ta;
    });
  }, [allTeams, businessId]);
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', {
    skip: !businessId,
    where: businessScope,
  });
  const { data: teamInvites } = useCollection<TeamInvite>('teamInvites', {
    skip: !businessId,
    where: businessScope,
  });

  const { getName, getInitials } = useUserNames(teamMembers || []);
  
  const teamMutation = useMutation<Team>('teams');
  const memberMutation = useMutation<TeamMember>('teamMembers');
  const inviteMutation = useMutation<TeamInvite>('teamInvites');

  const handleCreateTeam = async (formData: FormData) => {
    if (!user) return;
    const name = formData.get('name') as string;
    const department = formData.get('department') as string;

    // Every team must live inside a business — a team without a parent tenant would
    // be invisible to business-scoped queries and unreachable by the hardened rules.
    if (!businessId) {
      toast({
        title: 'Biznesi nuk u zgjidh',
        description: 'Ekipi krijohet brenda një biznesi. Rifresko faqen dhe provo përsëri.',
        variant: 'destructive',
      });
      return;
    }

    const newTeam = await teamMutation.create({
      name,
      department,
      businessId,
    } as any);

    // Auto-add creator as Admin member so they appear in mentions
    if (newTeam?.id) {
      await memberMutation.create({
        userId: user.uid,
        teamId: newTeam.id,
        businessId,
        role: 'Admin',
        email: user.email || '',
        displayName: user.displayName || user.email?.split('@')[0] || '',
        canAccessProjects: true,
        canAccessTasks: true,
        canAccessCRM: true,
        canAccessInvoices: true,
        canAccessReports: true,
        canAccessSettings: true,
        canAccessGoals: true,
        canAccessTeams: true,
        canAccessChat: true,
        canAccessCustomers: true,
        canAccessServices: true,
        canAccessProducts: true,
        canAccessExpenses: true,
        canAccessProfile: true,
        invitedByUserId: user.uid,
        invitedAt: new Date(),
        status: 'Active',
      });
    }

    setIsCreateDialogOpen(false);
  };

  // Build the join link from a STABLE public base — window.location.origin can be
  // https://localhost inside the Capacitor app (or a preview URL), which would make
  // the emailed link useless. Prefer VITE_APP_URL, then a non-localhost origin, then
  // the known production URL.
  const buildInviteLink = (token: string) => {
    const envUrl = (import.meta.env.VITE_APP_URL as string | undefined)?.replace(/\/$/, '');
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const base = envUrl
      || (origin && !/localhost|127\.0\.0\.1|capacitor:/i.test(origin) ? origin : 'https://fivocrm.vercel.app');
    return `${base}/join/${token}`;
  };

  // Copy an invite link to the clipboard — the reliable fallback so adding someone
  // never depends solely on email delivery.
  const copyInviteLink = async (token: string) => {
    const link = buildInviteLink(token);
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: 'Linku u kopjua', description: 'Ngjite dhe dërgoja personit (WhatsApp / email tjetër).' });
    } catch {
      toast({ title: 'Linku i ftesës', description: link });
    }
  };

  // Re-send the invite email for an existing pending invite (falls back to copying
  // the link if the email fails again).
  const handleResendInvite = async (invite: any) => {
    if (!user) return;
    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          to: invite.email,
          teamName: invite.teamName || 'Ekip',
          inviteLink: buildInviteLink(invite.token),
          senderName: user.displayName || 'FivoCRM',
        }),
      });
      if (response.ok) {
        toast({ title: 'Email-i u ridërgua', description: `Ftesa iu ridërgua ${invite.email}.` });
      } else {
        const errBody = await response.json().catch(() => ({}));
        await copyInviteLink(invite.token);
        toast({ title: 'Email nuk u dërgua — linku u kopjua', description: `Dërgoja manualisht. (${response.status}: ${errBody.detail ?? errBody.error ?? 'unknown'})`, variant: 'destructive' });
      }
    } catch {
      await copyInviteLink(invite.token);
      toast({ title: 'Email nuk u dërgua — linku u kopjua', description: 'Dërgoja personit manualisht.', variant: 'destructive' });
    }
  };

  const handleInviteMember = async (formData: FormData) => {
    if (!selectedTeam || !user) return;

    // Seat limit — surfaced BEFORE the invite is sent. /api/accept-invite enforces the
    // same cap server-side, so this is UX, not the security boundary.
    const activeCount = (teamMembers || []).filter(m => m.status === 'Active').length;
    if (seats && activeCount >= seats) {
      toast({
        title: 'Vendet e planit u mbushën',
        description: `Plani aktual përfshin ${seats} vende (${activeCount} të zëna). Përmirëso planin për të ftuar më shumë anëtarë.`,
        variant: 'destructive',
      });
      return;
    }

    const email = formData.get('email') as string;
    const role = formData.get('role') as string;
    const canAccessProjects = formData.get('canAccessProjects') === 'on';
    const canAccessTasks = formData.get('canAccessTasks') === 'on';
    const canAccessCRM = formData.get('canAccessCRM') === 'on';
    const canAccessInvoices = formData.get('canAccessInvoices') === 'on';
    const canAccessReports = formData.get('canAccessReports') === 'on';
    const canAccessSettings = formData.get('canAccessSettings') === 'on';
    const canAccessGoals = formData.get('canAccessGoals') === 'on';
    const canAccessTeams = formData.get('canAccessTeams') === 'on';
    const canAccessChat = formData.get('canAccessChat') === 'on';
    const canAccessCustomers = formData.get('canAccessCustomers') === 'on';
    const canAccessServices = formData.get('canAccessServices') === 'on';
    const canAccessProducts = formData.get('canAccessProducts') === 'on';
    const canAccessExpenses = formData.get('canAccessExpenses') === 'on';
    const canAccessProfile = formData.get('canAccessProfile') === 'on';

    // Prevent duplicate pending invite for same email + team (case-insensitive)
    const normalizedEmail = email.toLowerCase().trim();
    const existingInvite = teamInvites?.find(
      i => i.email?.toLowerCase() === normalizedEmail && i.teamId === selectedTeam.id && i.status === 'Pending'
    );
    if (existingInvite) {
      toast({ title: 'Ftesë ekzistuese', description: `${email} ka tashmë një ftesë aktive për këtë ekip.`, variant: 'destructive' });
      return;
    }

    // Also check if user is already a member of this team
    const alreadyMember = teamMembers?.find(m => m.email?.toLowerCase() === normalizedEmail && m.teamId === selectedTeam.id && m.status === 'Active');
    if (alreadyMember) {
      toast({ title: 'Anëtar ekzistues', description: `${email} është tashmë anëtar i këtij ekipi.`, variant: 'destructive' });
      return;
    }

    // Generate unique token
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days

    await inviteMutation.create({
      email,
      teamId: selectedTeam.id,
      // The tenant key comes from the TEAM being invited into, not the active session.
      businessId: (selectedTeam as any).businessId || businessId,
      teamName: selectedTeam.name,
      role,
      invitedByUserId: user.uid,
      token,
      expiresAt,
      canAccessProjects,
      canAccessTasks,
      canAccessCRM,
      canAccessInvoices,
      canAccessReports,
      canAccessSettings,
      canAccessGoals,
      canAccessTeams,
      canAccessChat,
      canAccessCustomers,
      canAccessServices,
      canAccessProducts,
      canAccessExpenses,
      canAccessProfile,
      status: 'Pending',
    });

    // Send invitation email via API
    try {
      const inviteLink = buildInviteLink(token);
      const idToken = await user.getIdToken();
      const response = await fetch('/api/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          to: email,
          teamName: selectedTeam.name,
          inviteLink,
          senderName: user.displayName || 'FivoCRM'
        })
      });

      if (response.ok) {
        toast({ title: 'Ftesa u dërgua!', description: `Email-i i ftesës u dërgua te ${email}.` });
      } else {
        const errBody = await response.json().catch(() => ({}));
        console.error('[send-invite] error:', response.status, errBody);
        // Email failed but the invite is saved — copy the link so the admin can share
        // it manually instead of being stranded.
        await copyInviteLink(token);
        toast({ title: 'Ftesa u ruajt — linku u kopjua', description: `Email nuk u dërgua; dërgoja linkun manualisht. (${response.status}: ${errBody.detail ?? errBody.error ?? 'unknown'})`, variant: 'destructive' });
      }
    } catch (error) {
      console.error('Email error:', error);
      await copyInviteLink(token);
      toast({ title: 'Ftesa u ruajt — linku u kopjua', description: 'Email-i nuk u dërgua (gabim rrjeti); dërgoja linkun manualisht.', variant: 'destructive' });
    }
    
    setIsInviteDialogOpen(false);
  };

  const handleAddMember = async (formData: FormData) => {
    if (!selectedTeam || !user) return;

    const userId = formData.get('userId') as string;
    const email = (formData.get('email') as string)?.trim();
    const role = formData.get('role') as string;

    // Duplicate check: same userId in same team
    const existing = teamMembers?.find(m => m.userId === userId && m.teamId === selectedTeam.id);
    if (existing) {
      toast({ title: 'Anëtar ekzistues', description: 'Ky përdorues është tashmë anëtar i këtij ekipi!', variant: 'destructive' });
      return;
    }

    const canAccessProjects = formData.get('canAccessProjects') === 'on';
    const canAccessTasks = formData.get('canAccessTasks') === 'on';
    const canAccessCRM = formData.get('canAccessCRM') === 'on';
    const canAccessInvoices = formData.get('canAccessInvoices') === 'on';
    const canAccessReports = formData.get('canAccessReports') === 'on';
    const canAccessSettings = formData.get('canAccessSettings') === 'on';
    const canAccessGoals = formData.get('canAccessGoals') === 'on';
    const canAccessTeams = formData.get('canAccessTeams') === 'on';
    const canAccessChat = formData.get('canAccessChat') === 'on';
    const canAccessCustomers = formData.get('canAccessCustomers') === 'on';
    const canAccessServices = formData.get('canAccessServices') === 'on';
    const canAccessProducts = formData.get('canAccessProducts') === 'on';
    const canAccessExpenses = formData.get('canAccessExpenses') === 'on';
    const canAccessProfile = formData.get('canAccessProfile') === 'on';

    await memberMutation.create({
      userId,
      teamId: selectedTeam.id,
      role,
      email: email || undefined,
      canAccessProjects,
      canAccessTasks,
      canAccessCRM,
      canAccessInvoices,
      canAccessReports,
      canAccessSettings,
      canAccessGoals,
      canAccessTeams,
      canAccessChat,
      canAccessCustomers,
      canAccessServices,
      canAccessProducts,
      canAccessExpenses,
      canAccessProfile,
      invitedByUserId: user.uid,
      invitedAt: new Date(),
      status: 'Active',
    });

    // Send notification email if an address was provided
    if (email) {
      try {
        const appLink = window.location.origin + '/app';
        const idToken = await user.getIdToken();
        const response = await fetch('/api/send-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
          body: JSON.stringify({
            to: email,
            teamName: selectedTeam.name,
            inviteLink: appLink,
            senderName: user.displayName || 'FivoCRM',
            directAdd: true,
          }),
        });
        if (response.ok) {
          toast({ title: 'Anëtari u shtua!', description: `Email-i i njoftimit u dërgua te ${email}.` });
        } else {
          toast({ title: 'Anëtari u shtua', description: 'Nuk u dërgua email. Kontrolloni konfigurimin SMTP.', variant: 'destructive' });
        }
      } catch {
        toast({ title: 'Anëtari u shtua', description: 'Nuk u dërgua email. Gabim rrjeti.' });
      }
    } else {
      toast({ title: 'Anëtari u shtua!', description: 'Anëtari u shtua direkt në ekip.' });
    }

    setIsAddMemberDialogOpen(false);
  };

  const handleAcceptInvite = async (invite: TeamInvite) => {
    if (!user) return;

    // Check token expiry
    const expiresAt = (invite as any).expiresAt?.toDate
      ? (invite as any).expiresAt.toDate()
      : invite.expiresAt ? new Date(invite.expiresAt as any) : null;
    if (expiresAt && expiresAt < new Date()) {
      toast({ title: 'Ftesë e skaduar', description: 'Kjo ftesë ka skaduar. Kërko një ftesë të re.', variant: 'destructive' });
      return;
    }

    // Prevent duplicate membership
    const alreadyMember = teamMembers?.find(m => m.userId === user.uid && m.teamId === invite.teamId && m.status === 'Active');
    if (alreadyMember) {
      toast({ title: 'Tashmë anëtar', description: 'Je tashmë anëtar i këtij ekipi.' });
      await inviteMutation.update(invite.id, { status: 'Accepted' });
      return;
    }

    // Create team member with permissions from the invite
    await memberMutation.create({
      userId: user.uid,
      teamId: invite.teamId,
      role: invite.role,
      canAccessProjects: invite.canAccessProjects ?? false,
      canAccessTasks: invite.canAccessTasks ?? false,
      canAccessCRM: invite.canAccessCRM ?? false,
      canAccessInvoices: invite.canAccessInvoices ?? false,
      canAccessReports: invite.canAccessReports ?? false,
      canAccessSettings: invite.canAccessSettings ?? false,
      invitedByUserId: invite.invitedByUserId,
      invitedAt: new Date(),
      status: 'Active',
    });

    // Update invite status
    await inviteMutation.update(invite.id, { status: 'Accepted' });
    toast({ title: 'Ftesa u pranua!', description: 'Je shtuar me sukses në ekip.' });
  };

  const handleRemoveMember = async (member: TeamMember) => {
    try {
      await memberMutation.remove(member.id);

      // Cascade: cancel any pending invites for this member's email in this team
      if (member.email) {
        const invitesSnap = await getDocs(
          query(collection(db, 'teamInvites'),
            where('email', '==', member.email),
            where('teamId', '==', member.teamId),
            where('status', '==', 'Pending')
          )
        );
        await Promise.all(invitesSnap.docs.map(d => deleteDoc(doc(db, 'teamInvites', d.id))));
      }

      // Cascade: remove userId from memberUserIds in this team's projects only
      const projectsSnap = await getDocs(query(collection(db, 'projects'), where('teamId', '==', member.teamId)));
      await Promise.all(
        projectsSnap.docs
          .filter(d => ((d.data().memberUserIds as string[]) || []).includes(member.userId))
          .map(d => updateDoc(doc(db, 'projects', d.id), {
            memberUserIds: (d.data().memberUserIds as string[]).filter((id: string) => id !== member.userId),
          }))
      );

      toast({ title: 'Anëtari u hoq nga ekipi.' });
    } catch (err) {
      console.error('Failed to remove member:', err);
      toast({ title: 'Gabim!', description: 'Nuk u arrit të hiqej anëtari. Provoni përsëri.', variant: 'destructive' });
    } finally {
      setMemberToDelete(null);
    }
  };

  const getTeamMembers = (teamId: string) => {
    return teamMembers?.filter(m => m.teamId === teamId) || [];
  };

  const getTeamInvites = (teamId: string) => {
    return teamInvites?.filter(i => i.teamId === teamId && i.status === 'Pending') || [];
  };

  const startEditing = (teamId: string, field: string, currentValue: any) => {
    setEditingTeamId(teamId);
    setEditingField(field);
    setEditValue(String(currentValue || ''));
  };

  const cancelEditing = () => {
    setEditingTeamId(null);
    setEditingField(null);
    setEditValue('');
  };

  const saveEdit = async (teamId: string, field: string) => {
    await teamMutation.update(teamId, { [field]: editValue });
    cancelEditing();
  };

  if (teamsLoading) {
    return <div className="flex items-center justify-center h-96">Loading teams...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h2 text-foreground">Ekipet</h1>
          <p className="text-body text-muted-foreground mt-1">
            {teams?.length || 0} ekipe
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButton 
            data={teams || []} 
            filename="teams"
            columns={['name', 'department']}
          />
          {(permissions.isAdmin || permissions.isOwner) && (
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-primary text-primary-foreground">
                  <Plus className="w-4 h-4 mr-2" />
                  Ekip i Ri
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Krijo Ekip të Ri</DialogTitle>
                </DialogHeader>
                <TeamForm onSubmit={handleCreateTeam} />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {teams?.map((team) => {
          const members = getTeamMembers(team.id);
          const invites = getTeamInvites(team.id);
          const { Icon: TeamIcon, bg: teamIconBg, color: teamIconColor } = getTeamDeptIcon(team.department);

          return (
            <Card key={team.id} className="p-6 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${teamIconBg}`}>
                    <TeamIcon className={`w-6 h-6 ${teamIconColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    {editingTeamId === team.id && editingField === 'name' ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="flex-1 px-2 py-1 border rounded text-sm"
                          autoFocus
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => saveEdit(team.id, 'name')}
                        >
                          <Check className="w-4 h-4 text-success" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={cancelEditing}
                        >
                          <X className="w-4 h-4 text-error" />
                        </Button>
                      </div>
                    ) : (
                      <div 
                        className={cn(
                          'px-2 py-1 rounded -ml-2',
                          (permissions.isAdmin || permissions.isOwner) && 'cursor-pointer hover:bg-muted/50'
                        )}
                        onClick={() => (permissions.isAdmin || permissions.isOwner) && startEditing(team.id, 'name', team.name)}
                      >
                        <h3 className="text-h4 text-foreground">{team.name}</h3>
                      </div>
                    )}
                    {editingTeamId === team.id && editingField === 'department' ? (
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="flex-1 px-2 py-1 border rounded text-sm"
                          autoFocus
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => saveEdit(team.id, 'department')}
                        >
                          <Check className="w-4 h-4 text-success" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={cancelEditing}
                        >
                          <X className="w-4 h-4 text-error" />
                        </Button>
                      </div>
                    ) : (
                      team.department && (
                        <div 
                          className={cn(
                            'px-2 py-1 rounded -ml-2',
                            (permissions.isAdmin || permissions.isOwner) && 'cursor-pointer hover:bg-muted/50'
                          )}
                          onClick={() => (permissions.isAdmin || permissions.isOwner) && startEditing(team.id, 'department', team.department)}
                        >
                          <p className="text-body-sm text-muted-foreground">{team.department}</p>
                        </div>
                      )
                    )}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => {
                      setSelectedTeam(team);
                      setIsMembersDialogOpen(true);
                    }}>
                      <Users className="w-4 h-4 mr-2" />
                      Shiko Anëtarët
                    </DropdownMenuItem>
                    {(permissions.isAdmin || permissions.isOwner) && (
                      <>
                        <DropdownMenuItem onClick={() => {
                          setSelectedTeam(team);
                          setIsInviteDialogOpen(true);
                        }}>
                          <Mail className="w-4 h-4 mr-2" />
                          Fto me Email
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => {
                          setSelectedTeam(team);
                          setIsAddMemberDialogOpen(true);
                        }}>
                          <UserPlus className="w-4 h-4 mr-2" />
                          Shto Anëtar Direkt
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => startEditing(team.id, 'name', team.name)}>
                          <Edit2 className="w-4 h-4 mr-2" />
                          Ndrysho Emrin
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-error" onClick={() => setTeamToDelete(team)}>
                          <Trash2 className="w-4 h-4 mr-2" />
                          Fshi
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="flex items-center gap-4 pt-2 border-t">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm">{members.length} anëtarë</span>
                </div>
                {invites.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-warning" />
                    <span className="text-sm">{invites.length} në pritje</span>
                  </div>
                )}
              </div>

              {(permissions.isAdmin || permissions.isOwner) && (
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => {
                    setSelectedTeam(team);
                    setIsInviteDialogOpen(true);
                  }}
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  Fto Anëtar
                </Button>
              )}
            </Card>
          );
        })}
      </div>

      {/* Add Member Directly Dialog */}
      <Dialog open={isAddMemberDialogOpen} onOpenChange={setIsAddMemberDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Shto Anëtar në {selectedTeam?.name}</DialogTitle>
          </DialogHeader>
          <AddMemberForm onSubmit={handleAddMember} />
        </DialogContent>
      </Dialog>

      {/* Invite Member Dialog */}
      <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Fto Anëtar në {selectedTeam?.name}</DialogTitle>
          </DialogHeader>
          <InviteMemberForm onSubmit={handleInviteMember} />
        </DialogContent>
      </Dialog>

      {/* Edit Member Permissions Dialog */}
      <Dialog open={isEditMemberDialogOpen} onOpenChange={setIsEditMemberDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ndrysho Lejet e Anëtarit</DialogTitle>
          </DialogHeader>
          {editingMember && (
            <EditMemberForm 
              member={editingMember} 
              onSubmit={async (data) => {
                // The success toast used to fire before anything could reject, so a
                // rules denial (e.g. an owner editing their own row) looked like a
                // save that simply did not stick. Report what actually happened.
                try {
                  await memberMutation.update(editingMember.id, data);
                } catch (err) {
                  const denied = (err as any)?.code === 'permission-denied';
                  const isSelf = editingMember.userId === user?.uid;
                  toast({
                    title: 'Ruajtja dështoi',
                    description: denied
                      ? isSelf && data.role !== editingMember.role
                        ? 'Rolin tënd nuk mund ta ndryshosh vetë — kërkoji një pronari ose admini tjetër.'
                        : 'Nuk ke leje për këtë ndryshim. Anëtarët menaxhohen nga pronari ose admini i biznesit. Nëse ky rol të takon, dil dhe hyr përsëri që të rifreskohen lejet.'
                      : ((err as Error)?.message || 'Gabim i panjohur.'),
                    variant: 'destructive',
                  });
                  return;
                }
                toast({
                  title: 'Anëtari u përditësua',
                  description: data.monthlySalary != null
                    ? `Roli: ${data.role} · rroga: ${data.monthlySalary.toLocaleString()} L`
                    : `Roli: ${data.role}`,
                });
                setIsEditMemberDialogOpen(false);
                setEditingMember(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm Remove Member Dialog */}
      <Dialog open={!!memberToDelete} onOpenChange={(open) => { if (!open) setMemberToDelete(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Hiq Anëtarin</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Je i sigurt që dëshiron të heqësh <span className="font-semibold text-foreground">{memberToDelete ? getName(memberToDelete.userId) : ''}</span> nga ekipi? Ky veprim nuk mund të zhbëhet.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setMemberToDelete(null)}>Anulo</Button>
            <Button
              variant="destructive"
              onClick={() => memberToDelete && handleRemoveMember(memberToDelete)}
            >
              Hiq
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete Team Dialog */}
      <Dialog open={!!teamToDelete} onOpenChange={(open) => { if (!open) setTeamToDelete(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Fshi Ekipin</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Je i sigurt që dëshiron të fshish ekipin <span className="font-semibold text-foreground">{teamToDelete?.name}</span>? Të gjithë anëtarët dhe ftesat do të fshihen gjithashtu. Ky veprim nuk mund të zhbëhet.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setTeamToDelete(null)}>Anulo</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!teamToDelete) return;
                await teamMutation.remove(teamToDelete.id);
                const [membersSnap, invitesSnap] = await Promise.all([
                  getDocs(query(collection(db, 'teamMembers'), where('teamId', '==', teamToDelete.id))),
                  getDocs(query(collection(db, 'teamInvites'), where('teamId', '==', teamToDelete.id))),
                ]);
                await Promise.all([
                  ...membersSnap.docs.map(d => deleteDoc(doc(db, 'teamMembers', d.id))),
                  ...invitesSnap.docs.map(d => deleteDoc(doc(db, 'teamInvites', d.id))),
                ]);
                toast({ title: 'Ekipi u fshi!', description: 'Anëtarët dhe ftesat u fshinë gjithashtu.' });
                setTeamToDelete(null);
              }}
            >
              Fshi
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Team Members Dialog */}
      <Dialog open={isMembersDialogOpen} onOpenChange={setIsMembersDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedTeam?.name} - Anëtarët dhe Ftesat</DialogTitle>
          </DialogHeader>
          
          <Tabs defaultValue="members">
            <TabsList className="w-full">
              <TabsTrigger value="members" className="flex-1">
                Anëtarë Aktivë ({selectedTeam ? getTeamMembers(selectedTeam.id).length : 0})
              </TabsTrigger>
              <TabsTrigger value="invites" className="flex-1">
                Ftesa në Pritje ({selectedTeam ? getTeamInvites(selectedTeam.id).length : 0})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="members" className="space-y-4">
              {selectedTeam && getTeamMembers(selectedTeam.id).map(member => (
                <Card key={member.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-3">
                        <Badge variant="secondary">{member.role}</Badge>
                        <span className="text-sm font-medium">{getName(member.userId)}</span>
                        {positionLabel(member.position) && (
                          <Badge variant="outline" className="text-xs font-normal">
                            {positionLabel(member.position)}
                          </Badge>
                        )}
                        <Badge className={member.status === 'Active' ? 'bg-success' : 'bg-muted'}>
                          {member.status}
                        </Badge>
                        {member.monthlySalary && (
                          <Badge variant="outline" className="text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700 text-xs">
                            {member.monthlySalary.toLocaleString()} L
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {member.canAccessProjects && <Badge variant="outline">Projektet</Badge>}
                        {member.canAccessTasks && <Badge variant="outline">Detyrat</Badge>}
                        {member.canAccessCRM && <Badge variant="outline">CRM</Badge>}
                        {member.canAccessInvoices && <Badge variant="outline">Faturat</Badge>}
                        {member.canAccessReports && <Badge variant="outline">Raportet</Badge>}
                        {member.canAccessSettings && <Badge variant="outline">Cilësimet</Badge>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {(permissions.isAdmin || permissions.isOwner) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingMember(member);
                            setIsEditMemberDialogOpen(true);
                          }}
                        >
                          <Settings className="w-4 h-4 text-primary" />
                        </Button>
                      )}
                      {(permissions.isAdmin || permissions.isOwner) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setMemberToDelete(member)}
                        >
                          <Trash2 className="w-4 h-4 text-error" />
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
              {!permissions.isAdmin && !permissions.isOwner && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Vetëm administratorët mund të ndryshojnë lejet e anëtarëve
                </p>
              )}
            </TabsContent>

            <TabsContent value="invites" className="space-y-4">
              {selectedTeam && getTeamInvites(selectedTeam.id).map(invite => (
                <Card key={invite.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <Mail className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">{invite.email}</span>
                        <Badge variant="secondary">{invite.role}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Skadon: {new Date(invite.expiresAt).toLocaleDateString('sq-AL')}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => copyInviteLink(invite.token)} title="Kopjo linkun e ftesës">
                        <Copy className="w-4 h-4 mr-1" />
                        Kopjo linkun
                      </Button>
                      {(permissions.isAdmin || permissions.isOwner) && (
                        <>
                          <Button variant="outline" size="sm" onClick={() => handleResendInvite(invite)} title="Ridërgo email-in">
                            <Send className="w-4 h-4 mr-1" />
                            Ridërgo
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => inviteMutation.update(invite.id, { status: 'Cancelled' })}
                          >
                            <XCircle className="w-4 h-4 mr-1" />
                            Anulo
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const TeamForm: React.FC<{
  onSubmit: (data: FormData) => void;
  initialData?: Team;
}> = ({ onSubmit, initialData }) => {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Emri i Ekipit</Label>
        <Input id="name" name="name" required defaultValue={initialData?.name} placeholder="p.sh., Ekipi SEO, Ekipi Web" />
      </div>

      <div>
        <Label htmlFor="department">Departamenti</Label>
        <Input id="department" name="department" defaultValue={initialData?.department} placeholder="p.sh., Marketing, Zhvillim" />
      </div>

      <Button type="submit" className="w-full">
        {initialData ? 'Përditëso Ekipin' : 'Krijo Ekipin'}
      </Button>
    </form>
  );
};

const AddMemberForm: React.FC<{
  onSubmit: (data: FormData) => void;
}> = ({ onSubmit }) => {
  const { user } = useAuth();
  const [role, setRole] = useState('Member');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <Label htmlFor="userId">User ID *</Label>
        <Input 
          id="userId" 
          name="userId" 
          required 
          placeholder="user-id i përdoruesit" 
        />
        <p className="text-xs text-muted-foreground mt-1">
          ID e Firebase-it. Për veten tënde: <code className="bg-muted px-1 rounded">{user?.uid}</code>
        </p>
      </div>

      <div>
        <Label htmlFor="email">Email për njoftim <span className="text-muted-foreground">(opsionale)</span></Label>
        <Input 
          id="email" 
          name="email" 
          type="email"
          placeholder="email@shembull.com" 
        />
        <p className="text-xs text-muted-foreground mt-1">
          Nëse plotësohet, anëtarit do t'i dërgohet email njoftimi që është shtuar në ekip.
        </p>
      </div>

      <div>
        <Label htmlFor="role">Roli</Label>
        <Select name="role" value={role} onValueChange={setRole}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Admin">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Admin - Akses i plotë në gjithçka
              </div>
            </SelectItem>
            <SelectItem value="Sales">Sales - Ekipi i shitjes (Klientë &amp; CRM)</SelectItem>
            <SelectItem value="SalesAgent">SalesAgent - Agjent shitje (vetëm të vetat)</SelectItem>
            <SelectItem value="Manager">Manager - Menaxhon ekipin dhe projektet</SelectItem>
            <SelectItem value="Member">Member - Akses standard</SelectItem>
            <SelectItem value="Viewer">Viewer - Vetëm lexim</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        <Label>Lejet e Aksesit</Label>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <Checkbox id="addCanAccessProjects" name="canAccessProjects" defaultChecked />
            <Label htmlFor="addCanAccessProjects" className="font-normal">Projektet</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="addCanAccessTasks" name="canAccessTasks" defaultChecked />
            <Label htmlFor="addCanAccessTasks" className="font-normal">Detyrat</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="addCanAccessCRM" name="canAccessCRM" />
            <Label htmlFor="addCanAccessCRM" className="font-normal">CRM</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="addCanAccessInvoices" name="canAccessInvoices" />
            <Label htmlFor="addCanAccessInvoices" className="font-normal">Faturat</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="addCanAccessReports" name="canAccessReports" />
            <Label htmlFor="addCanAccessReports" className="font-normal">Raportet</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="addCanAccessSettings" name="canAccessSettings" />
            <Label htmlFor="addCanAccessSettings" className="font-normal">Cilësimet</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="addCanAccessGoals" name="canAccessGoals" />
            <Label htmlFor="addCanAccessGoals" className="font-normal">Qëllimet</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="addCanAccessChat" name="canAccessChat" defaultChecked />
            <Label htmlFor="addCanAccessChat" className="font-normal">Chat</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="addCanAccessCustomers" name="canAccessCustomers" />
            <Label htmlFor="addCanAccessCustomers" className="font-normal">Klientët</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="addCanAccessServices" name="canAccessServices" />
            <Label htmlFor="addCanAccessServices" className="font-normal">Shërbimet</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="addCanAccessProducts" name="canAccessProducts" />
            <Label htmlFor="addCanAccessProducts" className="font-normal">Dyqani & Produktet</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="addCanAccessExpenses" name="canAccessExpenses" />
            <Label htmlFor="addCanAccessExpenses" className="font-normal">Shpenzimet</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="addCanAccessProfile" name="canAccessProfile" defaultChecked />
            <Label htmlFor="addCanAccessProfile" className="font-normal">Profili</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="addCanAccessTeams" name="canAccessTeams" />
            <Label htmlFor="addCanAccessTeams" className="font-normal">Ekipi</Label>
          </div>
        </div>
      </div>

      <Button type="submit" className="w-full">
        <UserPlus className="w-4 h-4 mr-2" />
        Shto Anëtarin
      </Button>
    </form>
  );
};

const InviteMemberForm: React.FC<{
  onSubmit: (data: FormData) => void;
}> = ({ onSubmit }) => {
  const [role, setRole] = useState('Member');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <Label htmlFor="email">Adresa Email</Label>
        <Input 
          id="email" 
          name="email" 
          type="email" 
          required 
          placeholder="koleg@shembull.com" 
        />
      </div>

      <div>
        <Label htmlFor="role">Roli</Label>
        <Select name="role" value={role} onValueChange={setRole}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Admin">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Admin - Akses i plotë në gjithçka
              </div>
            </SelectItem>
            <SelectItem value="Sales">Sales - Ekipi i shitjes (Klientë & CRM)</SelectItem>
            <SelectItem value="SalesAgent">Agjent Shitje - CRM & Klientë</SelectItem>
            <SelectItem value="Manager">Manager - Menaxhon ekipin dhe projektet</SelectItem>
            <SelectItem value="Member">Member - Akses standard</SelectItem>
            <SelectItem value="Viewer">Viewer - Vetëm lexim</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        <Label>Lejet e Aksesit</Label>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2">
            <Checkbox id="canAccessProjects" name="canAccessProjects" defaultChecked />
            <Label htmlFor="canAccessProjects" className="font-normal">Projektet</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="canAccessTasks" name="canAccessTasks" defaultChecked />
            <Label htmlFor="canAccessTasks" className="font-normal">Detyrat</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="canAccessCRM" name="canAccessCRM" />
            <Label htmlFor="canAccessCRM" className="font-normal">CRM</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="canAccessInvoices" name="canAccessInvoices" />
            <Label htmlFor="canAccessInvoices" className="font-normal">Faturat</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="canAccessReports" name="canAccessReports" />
            <Label htmlFor="canAccessReports" className="font-normal">Raportet</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="canAccessSettings" name="canAccessSettings" />
            <Label htmlFor="canAccessSettings" className="font-normal">Cilësimet</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="canAccessGoals" name="canAccessGoals" />
            <Label htmlFor="canAccessGoals" className="font-normal">Qëllimet</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="canAccessChat" name="canAccessChat" defaultChecked />
            <Label htmlFor="canAccessChat" className="font-normal">Chat</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="canAccessCustomers" name="canAccessCustomers" />
            <Label htmlFor="canAccessCustomers" className="font-normal">Klientët</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="canAccessServices" name="canAccessServices" />
            <Label htmlFor="canAccessServices" className="font-normal">Shërbimet</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="canAccessProducts" name="canAccessProducts" />
            <Label htmlFor="canAccessProducts" className="font-normal">Dyqani & Produktet</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="canAccessExpenses" name="canAccessExpenses" />
            <Label htmlFor="canAccessExpenses" className="font-normal">Shpenzimet</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="canAccessProfile" name="canAccessProfile" defaultChecked />
            <Label htmlFor="canAccessProfile" className="font-normal">Profili</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="canAccessTeams" name="canAccessTeams" />
            <Label htmlFor="canAccessTeams" className="font-normal">Ekipi</Label>
          </div>
        </div>
      </div>

      <Button type="submit" className="w-full">
        <Mail className="w-4 h-4 mr-2" />
        Dërgo Ftesën
      </Button>
    </form>
  );
};

// Edit Member Permissions Form
const EditMemberForm: React.FC<{
  member: TeamMember;
  onSubmit: (data: Partial<TeamMember>) => void;
}> = ({ member, onSubmit }) => {
  const { getName } = useUserNames([member]);
  const [role, setRole] = useState(member.role);
  const [canAccessProjects, setCanAccessProjects] = useState(member.canAccessProjects ?? true);
  const [canAccessTasks, setCanAccessTasks] = useState(member.canAccessTasks ?? true);
  const [canAccessCRM, setCanAccessCRM] = useState(member.canAccessCRM ?? false);
  const [canAccessInvoices, setCanAccessInvoices] = useState(member.canAccessInvoices ?? false);
  const [canAccessReports, setCanAccessReports] = useState(member.canAccessReports ?? false);
  const [canAccessSettings, setCanAccessSettings] = useState(member.canAccessSettings ?? false);
  const [status, setStatus] = useState(member.status);
  const [monthlySalary, setMonthlySalary] = useState(member.monthlySalary?.toString() || '');
  // Salary-history: date a salary change takes effect (used only when the salary
  // value actually changes) + a flag to wipe the recorded history.
  const [salaryEffectiveFrom, setSalaryEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [clearSalaryHistory, setClearSalaryHistory] = useState(false);
  const [hourlyCostRate, setHourlyCostRate] = useState(member.hourlyCostRate?.toString() || '');
  // The member's CRAFT. Distinct from `role` (authorisation) and from `serviceLines`
  // (P&L allocation) — see TeamMember.position.
  const [position, setPosition] = useState<string>(member.position || '');
  const [serviceLines, setServiceLines] = useState<string[]>(
    Array.isArray(member.serviceLines) && member.serviceLines.length
      ? member.serviceLines
      : (member.serviceLine ? [member.serviceLine] : [])
  );
  const toggleServiceLine = (c: string) =>
    setServiceLines(prev => (prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]));
  const [displayName, setDisplayName] = useState(member.displayName || member.email?.split('@')[0] || '');
  const [email, setEmail] = useState(member.email || '');

  // Service categories (for charging this member's salary as a direct cost
  // of the service line they work on, in the financial P&L).
  const { data: svcForLines } = useCollection<any>('services', { skipTeamFilter: true });
  const serviceLineOptions = React.useMemo(
    () => Array.from(new Set((svcForLines || []).map((s: any) => (s.category || '').trim()).filter(Boolean))).sort(),
    [svcForLines]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newSalary = monthlySalary ? parseFloat(monthlySalary) : undefined;

    // Maintain the effective-dated salary timeline. Record a new entry only when
    // the amount actually changed; seed the old amount as a baseline first time.
    let salaryHistory = member.salaryHistory;
    const salaryChanged = (newSalary || 0) !== (member.monthlySalary || 0);
    if (clearSalaryHistory) {
      salaryHistory = [];
    } else if (salaryChanged && newSalary != null && newSalary > 0) {
      salaryHistory = appendSalaryChange(
        member,
        newSalary,
        new Date(salaryEffectiveFrom + 'T12:00:00'),
      );
    }

    onSubmit({
      role,
      canAccessProjects,
      canAccessTasks,
      canAccessCRM,
      canAccessInvoices,
      canAccessReports,
      canAccessSettings,
      status,
      displayName: displayName.trim() || undefined,
      email: email.trim() || undefined,
      monthlySalary: newSalary,
      hourlyCostRate: hourlyCostRate ? parseFloat(hourlyCostRate) : undefined,
      position: position || undefined,
      serviceLines: serviceLines.length ? serviceLines : undefined,
      // Only include when we changed it, so unrelated edits don't clobber history.
      ...(salaryHistory !== member.salaryHistory ? { salaryHistory } : {}),
    });
  };

  const isFirstRender = React.useRef(true);

  // Auto-adjust permissions when role changes — skip on initial mount (preserve existing values)
  React.useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (role === 'Admin') {
      // Admin gets everything
      setCanAccessProjects(true);
      setCanAccessTasks(true);
      setCanAccessCRM(true);
      setCanAccessInvoices(true);
      setCanAccessReports(true);
      setCanAccessSettings(true);
    } else if (role === 'Member' || role === 'Viewer') {
      // Reset to baseline — admin configures explicitly
      setCanAccessProjects(false);
      setCanAccessTasks(false);
      setCanAccessCRM(false);
      setCanAccessInvoices(false);
      setCanAccessReports(false);
      setCanAccessSettings(false);
    }
    // Manager: keep existing checkboxes — admin decides per-person
  }, [role]);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="p-4 bg-muted rounded-lg space-y-1">
        <p className="text-sm font-medium">Anëtari: <span className="text-primary">{getName(member.userId)}</span></p>
        {member.email && <p className="text-xs text-muted-foreground">{member.email}</p>}
        {!member.email && <p className="text-xs text-amber-600 dark:text-amber-400">Nuk ka email — shto një më poshtë</p>}
      </div>

      {/* Display name override */}
      <div>
        <Label htmlFor="displayName">Emri dhe Mbiemri</Label>
        <Input
          id="displayName"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="p.sh. Emir Mbiemri"
        />
        <p className="text-xs text-muted-foreground mt-1">Ky emër shfaqet kudo në platformë</p>
      </div>

      {/* Email field */}
      <div>
        <Label htmlFor="editEmail">Email</Label>
        <Input
          id="editEmail"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="email@shembull.com"
        />
        <p className="text-xs text-muted-foreground mt-1">Përdoret për ftesa dhe njoftime</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="editRole">Roli</Label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Admin">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Admin
                </div>
              </SelectItem>
              <SelectItem value="Sales">Sales</SelectItem>
              <SelectItem value="SalesAgent">Agjent Shitje</SelectItem>
              <SelectItem value="Manager">Manager</SelectItem>
              <SelectItem value="Member">Member</SelectItem>
              <SelectItem value="Viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="editStatus">Statusi</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Active">Aktiv</SelectItem>
              <SelectItem value="Inactive">Joaktiv</SelectItem>
              <SelectItem value="Pending">Në Pritje</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-3">
        <Label>Lejet e Aksesit</Label>
        {role === 'Admin' && (
          <p className="text-xs text-muted-foreground">Administratorët kanë akses të plotë automatikisht</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <Checkbox 
              id="editCanAccessProjects" 
              checked={canAccessProjects}
              onCheckedChange={(checked) => setCanAccessProjects(checked as boolean)}
              disabled={role === 'Admin'}
            />
            <Label htmlFor="editCanAccessProjects" className="font-normal">Projektet</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox 
              id="editCanAccessTasks" 
              checked={canAccessTasks}
              onCheckedChange={(checked) => setCanAccessTasks(checked as boolean)}
              disabled={role === 'Admin'}
            />
            <Label htmlFor="editCanAccessTasks" className="font-normal">Detyrat</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox 
              id="editCanAccessCRM" 
              checked={canAccessCRM}
              onCheckedChange={(checked) => setCanAccessCRM(checked as boolean)}
              disabled={role === 'Admin'}
            />
            <Label htmlFor="editCanAccessCRM" className="font-normal">CRM</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox 
              id="editCanAccessInvoices" 
              checked={canAccessInvoices}
              onCheckedChange={(checked) => setCanAccessInvoices(checked as boolean)}
              disabled={role === 'Admin'}
            />
            <Label htmlFor="editCanAccessInvoices" className="font-normal">Faturat</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox 
              id="editCanAccessReports" 
              checked={canAccessReports}
              onCheckedChange={(checked) => setCanAccessReports(checked as boolean)}
              disabled={role === 'Admin'}
            />
            <Label htmlFor="editCanAccessReports" className="font-normal">Raportet</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox 
              id="editCanAccessSettings" 
              checked={canAccessSettings}
              onCheckedChange={(checked) => setCanAccessSettings(checked as boolean)}
              disabled={role === 'Admin'}
            />
            <Label htmlFor="editCanAccessSettings" className="font-normal">Cilësimet</Label>
          </div>
        </div>
      </div>

      {/* Salary */}
      <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/30 rounded-lg space-y-2">
        <Label htmlFor="monthlySalary" className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-medium">
          � Rroga Mujore (L)
        </Label>
        <p className="text-xs text-muted-foreground">Kjo përdoret për llogaritjen e sistemit të bonusit</p>
        <input
          id="monthlySalary"
          type="number"
          min="0"
          step="0.01"
          value={monthlySalary}
          onChange={(e) => setMonthlySalary(e.target.value)}
          placeholder="p.sh. 800"
          className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />

        {/* Effective date — used when the salary above changes, so historical
            months keep the old figure in the financial P&L. */}
        {(parseFloat(monthlySalary) || 0) !== (member.monthlySalary || 0) && (parseFloat(monthlySalary) || 0) > 0 && (
          <div className="pt-1">
            <Label htmlFor="salaryEffectiveFrom" className="text-xs text-amber-800 dark:text-amber-300">Rroga e re efektive nga</Label>
            <p className="text-[11px] text-muted-foreground">Muajt para kësaj date ruajnë rrogën e vjetër në llogaritjen e fitimit.</p>
            <input
              id="salaryEffectiveFrom"
              type="date"
              value={salaryEffectiveFrom}
              onChange={(e) => setSalaryEffectiveFrom(e.target.value)}
              className="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}

        {/* Recorded salary timeline */}
        {(member.salaryHistory?.length ?? 0) > 0 && !clearSalaryHistory && (
          <div className="pt-1">
            <Label className="text-xs text-amber-800 dark:text-amber-300">Historiku i rrogës</Label>
            <ul className="mt-1 space-y-0.5">
              {[...(member.salaryHistory || [])]
                .map(h => ({ amount: Number(h.monthlySalary) || 0, from: parseDate(h.effectiveFrom) }))
                .filter(h => !!h.from)
                .sort((a, b) => (b.from!.getTime() - a.from!.getTime()))
                .map((h, i) => (
                  <li key={i} className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>nga {h.from!.toLocaleDateString('sq-AL', { month: '2-digit', year: 'numeric' })}</span>
                    <span className="tabular-nums font-medium text-foreground">{h.amount.toLocaleString()} L</span>
                  </li>
                ))}
            </ul>
            <button
              type="button"
              onClick={() => setClearSalaryHistory(true)}
              className="mt-1 text-[11px] text-red-600 hover:underline"
            >
              Pastro historikun
            </button>
          </div>
        )}
        {clearSalaryHistory && (
          <p className="text-[11px] text-red-600 pt-1">
            Historiku do të fshihet me ruajtjen. <button type="button" onClick={() => setClearSalaryHistory(false)} className="underline">Anulo</button>
          </p>
        )}

        <div className="pt-1">
          <Label htmlFor="hourlyCostRate" className="text-xs text-amber-800 dark:text-amber-300">Tarifa e kostos / orë (L)</Label>
          <p className="text-[11px] text-muted-foreground">Kosto e brendshme për orë pune (P&amp;L per-klient + buxheti). Bosh = llogaritet nga rroga / 160.</p>
          <input
            id="hourlyCostRate"
            type="number"
            min="0"
            step="0.01"
            value={hourlyCostRate}
            onChange={(e) => setHourlyCostRate(e.target.value)}
            placeholder={monthlySalary ? `auto ≈ ${Math.round((parseFloat(monthlySalary) || 0) / 160)}` : 'p.sh. 5'}
            className="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {/* Craft first, money second. The two were conflated before: the daily report
            read the P&L allocation as if it were the person's department, so a Web
            Designer billed to "Development" was asked about bugs fixed. */}
        <div className="pt-1">
          <Label className="text-xs">Pozicioni</Label>
          <p className="text-[11px] text-muted-foreground">
            Zanati i personit. Përcakton pyetjet e raportit ditor dhe shfaqet te ekipi.
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {positionOptions().map(opt => {
              const on = position === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setPosition(on ? '' : opt.key)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                    on
                      ? 'bg-primary/10 text-primary border-primary/40 font-medium'
                      : 'border-border text-muted-foreground hover:border-primary/40'}`}
                >
                  {opt.emoji} {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-1">
          <Label className="text-xs text-amber-800 dark:text-amber-300">Shërbimet (për P&L)</Label>
          <p className="text-[11px] text-muted-foreground">Zgjidh një ose disa shërbime. Rroga ndahet baras mes tyre si kosto direkte. Asnjë = overhead i përbashkët.</p>
          {serviceLineOptions.length === 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground italic">Krijo shërbime me kategori më parë (te Shërbimet).</p>
          ) : (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {serviceLineOptions.map((c: string) => {
                const on = serviceLines.includes(c);
                return (
                  <button
                    type="button"
                    key={c}
                    onClick={() => toggleServiceLine(c)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${on ? 'bg-amber-500 text-white border-amber-500' : 'border-input bg-background hover:bg-muted'}`}
                  >
                    {on ? '✓ ' : ''}{c}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Button type="submit" className="w-full">
        <Check className="w-4 h-4 mr-2" />
        Ruaj Ndryshimet
      </Button>
    </form>
  );
};

export default TeamsView;
