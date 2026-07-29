import React, { useEffect, useMemo, useState } from 'react';
import { useCollection, useDocument, useGlobalBusinessId } from '../../hooks/useFirestore';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../contexts/PermissionsContext';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import { UserCheck, Users, ShieldCheck, Eye, UserPlus, RefreshCw, AlertCircle } from 'lucide-react';
import {
  ensureConversation, reassignConversationOwner, addConversationWatcher,
  type RoutingMember,
} from '../../lib/conversationRouting';
import type { Conversation, TeamMember } from '../../types';

/**
 * Owner + watchers header strip for a client conversation (Request 1). Shows the
 * responsible person, their team, the team manager, the linked sales agent and the
 * watcher list, with controls to reassign the owner and add an observer. Reads its
 * own conversation doc so it stays decoupled from ChatView's state.
 */
const ConversationOwnerBar: React.FC<{ channelId: string }> = ({ channelId }) => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const globalBusinessId = useGlobalBusinessId();
  const [reassigning, setReassigning] = useState(false);
  const [addingWatcher, setAddingWatcher] = useState(false);

  // Parse client-<customerId>[-project-<projectId>]
  const { customerId } = useMemo(() => {
    const m = channelId.match(/^client-(.+?)(?:-project-(.+))?$/);
    return { customerId: m?.[1] || null };
  }, [channelId]);

  const { data: conversation } = useDocument<Conversation>('conversations', channelId || undefined);
  const { data: customer } = useDocument<any>('customers', customerId || undefined);
  // Business-scoped: an unscoped read of teamMembers/teams is denied outright by the
  // hardened rules (they would touch other tenants' documents), and this bar only ever
  // needs the active tenant's staff anyway.
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
    skipTeamFilter: true,
  });
  const { data: teams } = useCollection<any>('teams', { skipTeamFilter: true });

  const routingMembers: RoutingMember[] = useMemo(
    () => (teamMembers || []).map((m) => ({
      userId: m.userId, teamId: m.teamId, role: m.role, status: m.status,
      businessId: (m as any).businessId, canAccessCRM: (m as any).canAccessCRM,
    })),
    [teamMembers],
  );

  // Members eligible to be an owner within this conversation's business.
  const assignableMembers = useMemo(() => {
    const bizId = conversation?.businessId || (customer as any)?.businessId;
    return (teamMembers || []).filter((m) =>
      m.role !== 'Viewer' && m.role !== 'Guest' &&
      (!bizId || !(m as any).businessId || (m as any).businessId === bizId));
  }, [teamMembers, conversation, customer]);

  const nameOf = (uid?: string | null): string => {
    if (!uid) return '—';
    if (uid === user?.uid) return 'Ti';
    const m = (teamMembers || []).find((x) => x.userId === uid);
    return m?.displayName || m?.email?.split('@')[0] || uid.slice(0, 6);
  };
  const teamNameOf = (tid?: string | null): string => {
    if (!tid) return '—';
    return (teams || []).find((t: any) => t.id === tid)?.name || tid.slice(0, 6);
  };

  // Self-heal: if a legacy thread has no conversation doc yet, create it from the
  // customer's account owner so it enters the owner/watchers model on first view.
  useEffect(() => {
    if (!channelId || !customerId || !user) return;
    if (conversation) return; // exists (or still loading → null; effect re-runs on load)
    if (!customer || !teamMembers) return;
    ensureConversation({
      channelId,
      channel: 'portal',
      businessId: (customer as any)?.businessId || globalBusinessId || null,
      teamId: (customer as any)?.teamId || permissions.teamId || null,
      customerId,
      ownerId: (customer as any)?.assignedToUserId || null,
      salesAgentId: (customer as any)?.salesAgentId || null,
      subject: customer?.name || undefined,
      teamMembers: routingMembers,
      actorUserId: user.uid,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, customerId, conversation, customer, teamMembers]);

  if (!channelId.startsWith('client-')) return null;

  const canManage = permissions.isAdmin || permissions.isManager || permissions.isOwner
    || conversation?.ownerId === user?.uid;

  const doReassign = async (newOwnerId: string) => {
    if (!conversation) return;
    setReassigning(false);
    await reassignConversationOwner(channelId, newOwnerId, {
      businessId: conversation.businessId,
      teamId: conversation.teamId,
      ownerId: newOwnerId,
      salesAgentId: conversation.salesAgentId,
      teamMembers: routingMembers,
    }).catch(() => {});
  };

  const doAddWatcher = async (uid: string) => {
    setAddingWatcher(false);
    await addConversationWatcher(channelId, uid).catch(() => {});
  };

  const watchers = conversation?.watchers || [];

  return (
    <div className="border-b bg-muted/20 px-5 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
      {/* Owner */}
      <span className="flex items-center gap-1.5">
        <UserCheck className="h-3.5 w-3.5 text-primary" />
        <span className="text-muted-foreground">Përgjegjës:</span>
        {conversation?.ownerId ? (
          <span className="font-semibold text-foreground">{nameOf(conversation.ownerId)}</span>
        ) : (
          <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 text-[10px] px-1.5 py-0 gap-1">
            <AlertCircle className="h-3 w-3" /> Pa përgjegjës
          </Badge>
        )}
      </span>

      {/* Team */}
      {conversation?.teamId && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> Ekipi: <span className="text-foreground">{teamNameOf(conversation.teamId)}</span>
        </span>
      )}

      {/* Manager */}
      {conversation?.managerId && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Menaxher: <span className="text-foreground">{nameOf(conversation.managerId)}</span>
        </span>
      )}

      {/* Sales agent */}
      {conversation?.salesAgentId && (
        <span className="text-muted-foreground">Agjent: <span className="text-foreground">{nameOf(conversation.salesAgentId)}</span></span>
      )}

      {/* Watchers */}
      {watchers.length > 0 && (
        <span className="flex items-center gap-1.5 text-muted-foreground" title={watchers.map(nameOf).join(', ')}>
          <Eye className="h-3.5 w-3.5" /> {watchers.length} vëzhgues
        </span>
      )}

      {/* Controls */}
      {canManage && (
        <span className="flex items-center gap-1.5 ml-auto">
          {reassigning ? (
            <Select onValueChange={doReassign}>
              <SelectTrigger className="h-7 w-44 text-xs"><SelectValue placeholder="Zgjidh përgjegjësin" /></SelectTrigger>
              <SelectContent>
                {assignableMembers.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>{m.displayName || m.email || m.userId.slice(0, 6)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setReassigning(true)}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Ricakto përgjegjës
            </Button>
          )}
          {addingWatcher ? (
            <Select onValueChange={doAddWatcher}>
              <SelectTrigger className="h-7 w-40 text-xs"><SelectValue placeholder="Shto vëzhgues" /></SelectTrigger>
              <SelectContent>
                {assignableMembers.filter((m) => !watchers.includes(m.userId)).map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>{m.displayName || m.email || m.userId.slice(0, 6)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAddingWatcher(true)}>
              <UserPlus className="h-3.5 w-3.5 mr-1" /> Shto vëzhgues
            </Button>
          )}
        </span>
      )}
    </div>
  );
};

export default ConversationOwnerBar;
