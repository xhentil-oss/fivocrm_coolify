import { auth } from './firebase';
import type { NotificationType } from './notificationTypes';

/**
 * Portal → staff notification (and optional conversation routing), performed by the
 * server so the browser never needs the tenant's staff directory.
 *
 * Previously every portal view read `teamMembers` with `skipTeamFilter: true` — i.e.
 * every tenant's staff records (salary fields included) were readable by any signed-in
 * client, and recipients were filtered client-side. /api/notify-staff resolves the
 * client's own customer → businessId and picks recipients inside that tenant only.
 *
 * Fire-and-forget: never blocks the client's action.
 */
export interface NotifyStaffInput {
  /** Must be registered — a bare string let `new_client` ship unregistered (no
   *  icon, un-mutable) and dodge the registry guard test. The server coerces an
   *  unknown value to `client_request`. */
  type: NotificationType;
  title: string;
  message?: string;
  actionUrl?: string;
  actionLabel?: string;
  /** Chat channel id (used for push deep-links). */
  linkTo?: string;
  /** Chat only: `ch:<channelId>` — delivery skips push+email while the recipient is reading it. */
  conversationKey?: string;
  /** Chat only: the message document id, so the reader can dismiss the row if it is deleted. */
  messageId?: string;
  projectId?: string;
  /** The task this is about. REQUIRED for `task_approval_decided`: the server then
   *  verifies the caller may act on that task and notifies its assignee + the
   *  person who requested the approval (not the whole management team). */
  taskId?: string;
  /** The responsible person, when the portal already knows it (validated server-side). */
  responsibleUserId?: string | null;
  /** Also upsert the persistent conversation thread (owner + watchers). */
  conversation?: {
    channelId: string;
    channel?: 'portal' | 'whatsapp' | 'email';
    teamId?: string | null;
    salesAgentId?: string | null;
    subject?: string;
  };
  /** Also create a follow-up task, assigned to a sales/admin member of the tenant. */
  task?: {
    title: string;
    description?: string;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    dueInDays?: number;
    leadId?: string;
  };
}

export async function notifyStaff(input: NotifyStaffInput): Promise<boolean> {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return false;
    const res = await fetch('/api/notify-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
    return res.ok;
  } catch {
    return false;
  }
}
