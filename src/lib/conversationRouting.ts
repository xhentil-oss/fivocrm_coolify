import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Owner + watchers routing for client conversations (Request 1).
 *
 * Hierarchy who sees a client/lead conversation:
 *   1. Owner (responsible person)
 *   2. Owner's team (department)
 *   3. Manager of that team (supervision + can reassign)
 *   4. Sales agent linked to the customer (continuity)
 *   5. All admins (always)
 *
 * `buildRouting` is a pure function so the exact same logic runs on the portal,
 * on staff, and (mirrored) in the WhatsApp webhook. `ensureConversation` upserts
 * the `conversations/{channelId}` doc idempotently: it computes owner+watchers on
 * first sight (or while still unassigned) but never clobbers a manual reassignment.
 */

export interface RoutingMember {
  userId: string;
  teamId?: string;
  role?: string;
  status?: string;
  businessId?: string;
  canAccessCRM?: boolean;
}

export interface RoutingInput {
  businessId?: string | null;
  teamId?: string | null;
  ownerId?: string | null;
  salesAgentId?: string | null;
  teamMembers: RoutingMember[];
}

export interface RoutingResult {
  ownerId: string | null;
  teamId: string | null;
  managerId: string | null;
  salesAgentId: string | null;
  watchers: string[];
  unassigned: boolean;
}

const isActive = (m: RoutingMember) => (m.status ?? 'Active') === 'Active';

/** SLA target for first response to a client message (business-hours-ish; the
 *  escalation cron refines this). Kept here so ingest and cron agree. */
export const FIRST_RESPONSE_SLA_HOURS = 2;

export function buildRouting(input: RoutingInput): RoutingResult {
  const members = (input.teamMembers || []).filter(isActive);
  const ownerId = input.ownerId || null;

  // Team of the conversation: prefer the owner's own team, else the passed-in
  // team (from the customer/project/lead), else none.
  const ownerMember = ownerId ? members.find((m) => m.userId === ownerId) : undefined;
  const teamId = ownerMember?.teamId || input.teamId || null;

  const sameBusiness = (m: RoutingMember) =>
    !input.businessId || !m.businessId || m.businessId === input.businessId;

  // Manager of that team.
  const managerId =
    (teamId
      ? members.find((m) => m.teamId === teamId && m.role === 'Manager' && sameBusiness(m))?.userId
      : undefined) || null;

  // Everyone on the owner's team.
  const teamMemberIds = teamId
    ? members.filter((m) => m.teamId === teamId && sameBusiness(m)).map((m) => m.userId)
    : [];

  // All admins in the business (always watchers).
  const adminIds = members
    .filter((m) => m.role === 'Admin' && sameBusiness(m))
    .map((m) => m.userId);

  const salesAgentId = input.salesAgentId || null;

  // When unassigned we still want the manager + admins (and, if we couldn't even
  // resolve a team, ALL managers) on the thread so it lands in a triage queue
  // rather than vanishing.
  const fallbackManagers =
    !ownerId && !managerId
      ? members.filter((m) => m.role === 'Manager' && sameBusiness(m)).map((m) => m.userId)
      : [];

  const watchers = Array.from(
    new Set(
      [
        ownerId,
        ...teamMemberIds,
        managerId,
        salesAgentId,
        ...adminIds,
        ...fallbackManagers,
      ].filter((x): x is string => !!x),
    ),
  );

  return { ownerId, teamId, managerId, salesAgentId, watchers, unassigned: !ownerId };
}

export interface EnsureConversationArgs extends RoutingInput {
  /** Deterministic conversation id = the messages' channelId. */
  channelId: string;
  channel: 'portal' | 'whatsapp' | 'email';
  customerId?: string | null;
  leadId?: string | null;
  phone?: string | null;
  subject?: string;
  actorUserId?: string | null;
}

/**
 * Upsert the conversation doc. Idempotent:
 *  - first create → compute owner+watchers, set SLA target, status 'open'.
 *  - already exists & still unassigned but we now have an owner → upgrade it.
 *  - otherwise → only bump lastMessageAt (never overwrite a manual reassignment).
 */
export async function ensureConversation(args: EnsureConversationArgs): Promise<void> {
  const ref = doc(db, 'conversations', args.channelId);
  const now = Timestamp.now();

  let snap;
  try {
    snap = await getDoc(ref);
  } catch {
    return; // read denied / offline — never block the message send
  }

  const routing = buildRouting(args);

  const base: Record<string, any> = {
    lastMessageAt: now,
    updatedAt: now,
  };

  if (!snap.exists()) {
    const slaDue = Timestamp.fromMillis(now.toMillis() + FIRST_RESPONSE_SLA_HOURS * 3600_000);
    await setDoc(ref, {
      channel: args.channel,
      businessId: args.businessId || null,
      teamId: routing.teamId,
      customerId: args.customerId || null,
      leadId: args.leadId || null,
      phone: args.phone || null,
      subject: args.subject || null,
      ownerId: routing.ownerId,
      managerId: routing.managerId,
      salesAgentId: routing.salesAgentId,
      watchers: routing.watchers,
      unassigned: routing.unassigned,
      status: 'open',
      slaFirstResponseDueAt: slaDue,
      slaBreachNotified: false,
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
      createdByUserId: args.actorUserId || null,
    }).catch(() => {});
    return;
  }

  const existing = snap.data() as any;
  // Upgrade an ownerless thread the moment we can resolve an owner (e.g. the
  // customer got an assignedToUserId after the first message).
  if (existing.unassigned && routing.ownerId) {
    Object.assign(base, {
      ownerId: routing.ownerId,
      teamId: routing.teamId,
      managerId: routing.managerId,
      salesAgentId: routing.salesAgentId,
      watchers: Array.from(new Set([...(existing.watchers || []), ...routing.watchers])),
      unassigned: false,
    });
  }
  await updateDoc(ref, base).catch(() => {});
}

/** Manually reassign the owner and recompute watchers, preserving any manually
 *  added watchers. Used by the "Ricakto përgjegjës" button. */
export async function reassignConversationOwner(
  channelId: string,
  newOwnerId: string,
  input: RoutingInput,
  extraWatchers: string[] = [],
): Promise<void> {
  const routing = buildRouting({ ...input, ownerId: newOwnerId });
  await updateDoc(doc(db, 'conversations', channelId), {
    ownerId: routing.ownerId,
    teamId: routing.teamId,
    managerId: routing.managerId,
    salesAgentId: routing.salesAgentId,
    watchers: Array.from(new Set([...routing.watchers, ...extraWatchers])),
    unassigned: false,
    updatedAt: Timestamp.now(),
  });
}

/** Add a watcher (observer) without touching ownership. */
export async function addConversationWatcher(channelId: string, userId: string): Promise<void> {
  const ref = doc(db, 'conversations', channelId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const watchers: string[] = (snap.data() as any).watchers || [];
  if (watchers.includes(userId)) return;
  await updateDoc(ref, { watchers: [...watchers, userId], updatedAt: Timestamp.now() });
}
