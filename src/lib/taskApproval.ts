/**
 * Client approval of a task — "Kërko miratim nga klienti" (Preventiva-style
 * accept / request changes, but on a single deliverable).
 *
 * Import-free (no React, no Firebase) and unit-tested. Every decision the UI
 * makes about an approval lives here; the Firestore rules mirror the same
 * transitions (tasks rule → `taskApprovalStaffAllowed` + `taskClientDecision`):
 *
 *   staff:  (none | approved | changes_requested | cancelled) → pending   [request a round]
 *           pending → cancelled                                         [withdraw]
 *   client: pending → approved             (status untouched)
 *           pending → changes_requested    (note REQUIRED; status may go → In Progress)
 *
 * WHY APPROVAL DOES NOT COMPLETE THE TASK. Completion in this product is one flow,
 * `completeTask()` (recurringUtils): blocker guard, the next recurring cycle
 * (claimed in a transaction), `completedAt`, project auto-completion and the
 * task_completed notifications. A portal client's write cannot run any of that —
 * the rules can only check a field diff. Letting the client set `status: 'Done'`
 * would leave a recurring series to the cron backstop alone and skip the rest
 * silently. So the client's "Prano" records the decision (who, when, which round)
 * and the assignee + requester are notified; staff close the task with one click
 * ("Përfundo detyrën") which runs the real completion flow.
 */

import type { Task, ClientApproval, ClientApprovalState } from '../types';

export type { ClientApproval, ClientApprovalState };

export const MAX_APPROVAL_NOTE = 2000;
export const MAX_DECISION_NOTE = 2000;

export type ClientDecision = 'approved' | 'changes_requested';

function approvalOf(task: Pick<Task, 'clientApproval'> | null | undefined): ClientApproval | null {
  const a = task?.clientApproval as ClientApproval | null | undefined;
  return a && typeof a === 'object' && typeof a.state === 'string' ? a : null;
}

export function isApprovalPending(task: Pick<Task, 'clientApproval'> | null | undefined): boolean {
  return approvalOf(task)?.state === 'pending';
}

// ── Staff: may this person ask the client for approval? ──────────────────────

export type ApprovalRequestBlock =
  | 'read-only'      // guest / Viewer
  | 'not-owner'      // not Admin/Manager, not the assignee, not the creator
  | 'no-client'      // task is not portal-visible (no customerId)
  | 'no-project'     // the portal shows tasks only inside a project page
  | 'done'           // re-open the task first
  | 'already-pending';

export interface ApprovalActor {
  uid: string | null | undefined;
  readOnly: boolean;
  /** Admin / Manager / owner (permissions.isAdmin || permissions.isManager). */
  isManagerTier: boolean;
}

export function approvalRequestBlockReason(task: Task, actor: ApprovalActor): ApprovalRequestBlock | null {
  if (actor.readOnly || !actor.uid) return 'read-only';
  if (!actor.isManagerTier && task.assignedToUserId !== actor.uid && task.createdByUserId !== actor.uid) return 'not-owner';
  if (!task.customerId) return 'no-client';
  if (!task.projectId) return 'no-project';
  if (task.status === 'Done') return 'done';
  if (isApprovalPending(task)) return 'already-pending';
  return null;
}

export const APPROVAL_REQUEST_BLOCK_LABELS: Record<ApprovalRequestBlock, string> = {
  'read-only': 'Vetëm lexim',
  'not-owner': 'Miratimin e kërkon i caktuari, krijuesi ose një menaxher',
  'no-client': 'Detyra nuk është e dukshme për klientin (pa klient)',
  'no-project': 'Klienti i sheh detyrat vetëm brenda një projekti',
  'done': 'Rihape detyrën për të kërkuar miratim',
  'already-pending': 'Një kërkesë është tashmë në pritje',
};

/** Round number the next request gets. */
export function nextApprovalRound(task: Pick<Task, 'clientApproval' | 'clientApprovalHistory'>): number {
  const current = approvalOf(task)?.round || 0;
  const past = Array.isArray(task.clientApprovalHistory)
    ? task.clientApprovalHistory.reduce((m, r) => Math.max(m, Number((r as any)?.round) || 0), 0)
    : 0;
  return Math.max(current, past) + 1;
}

/**
 * The staff write that opens a round: the previous round (if any) is archived into
 * `clientApprovalHistory` (the client may write only `clientApproval`, so history is
 * kept by staff), status → Review.
 */
export function buildApprovalRequestPatch(
  task: Task,
  args: { uid: string; now: Date; note?: string | null; attachmentUrl?: string | null; attachmentName?: string | null },
): Partial<Task> {
  const previous = approvalOf(task);
  const history = Array.isArray(task.clientApprovalHistory) ? [...task.clientApprovalHistory] : [];
  if (previous && !history.some(r => r?.round === previous.round)) history.push({ ...previous });
  const note = (args.note || '').trim().slice(0, MAX_APPROVAL_NOTE);
  const approval: ClientApproval = {
    state: 'pending',
    round: nextApprovalRound(task),
    requestedAt: args.now,
    requestedByUserId: args.uid,
    note: note || null,
    attachmentUrl: args.attachmentUrl || null,
    attachmentName: args.attachmentUrl ? (args.attachmentName || null) : null,
    decidedAt: null,
    decidedByUid: null,
    decisionNote: null,
  };
  return {
    status: 'Review',
    clientApproval: approval,
    ...(history.length > 0 ? { clientApprovalHistory: history } : {}),
  };
}

/** Staff withdraws a pending request. A task left in Review goes back to In Progress. */
export function buildApprovalCancelPatch(task: Task, args: { uid: string; now: Date }): Partial<Task> | null {
  const a = approvalOf(task);
  if (!a || a.state !== 'pending') return null;
  return {
    clientApproval: { ...a, state: 'cancelled', cancelledAt: args.now, cancelledByUserId: args.uid },
    ...(task.status === 'Review' ? { status: 'In Progress' as const } : {}),
  };
}

// ── Client: the decision ─────────────────────────────────────────────────────

export type ClientDecisionBlock = 'not-pending' | 'note-required' | 'note-too-long';

export function clientDecisionBlockReason(
  task: Pick<Task, 'clientApproval'>,
  decision: ClientDecision,
  note?: string | null,
): ClientDecisionBlock | null {
  if (!isApprovalPending(task)) return 'not-pending';
  const n = (note || '').trim();
  if (decision === 'changes_requested' && !n) return 'note-required';
  if (n.length > MAX_DECISION_NOTE) return 'note-too-long';
  return null;
}

/**
 * The portal client's update, as DOTTED field paths: only the four decision keys
 * of `clientApproval` are written, so the request half (requestedAt, round …) is
 * byte-identical — rewriting it from the snapshot would round-trip the
 * Timestamps through Date and the rules would see them as changed.
 * `serverNow` is the caller's `serverTimestamp()` sentinel (rules pin it to
 * request.time). Changes requested also moves a task in Review back to work.
 */
export function clientDecisionUpdate<TS>(
  task: Pick<Task, 'clientApproval' | 'status'>,
  decision: ClientDecision,
  args: { uid: string; note?: string | null; serverNow: TS },
): Record<string, unknown> {
  const note = (args.note || '').trim();
  return {
    'clientApproval.state': decision,
    'clientApproval.decidedAt': args.serverNow,
    'clientApproval.decidedByUid': args.uid,
    'clientApproval.decisionNote': note || null,
    ...(decision === 'changes_requested' && task.status === 'Review' ? { status: 'In Progress' } : {}),
  };
}

// ── Display ──────────────────────────────────────────────────────────────────

export interface ApprovalBadge {
  state: ClientApprovalState;
  label: string;
  /** Tailwind classes for a small pill. */
  className: string;
  title: string;
}

export function approvalBadge(task: Pick<Task, 'clientApproval'> | null | undefined): ApprovalBadge | null {
  const a = approvalOf(task);
  if (!a) return null;
  const round = a.round > 1 ? ` · raundi ${a.round}` : '';
  switch (a.state) {
    case 'pending':
      return {
        state: a.state,
        label: 'Në miratim te klienti',
        className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
        title: `Pret miratimin e klientit${round}`,
      };
    case 'approved':
      return {
        state: a.state,
        label: '✓ Miratuar nga klienti',
        className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
        title: `Klienti e miratoi${round}${a.decisionNote ? ` — "${a.decisionNote}"` : ''}`,
      };
    case 'changes_requested':
      return {
        state: a.state,
        label: '↺ Klienti kërkoi ndryshime',
        className: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
        title: `Klienti kërkoi ndryshime${round}${a.decisionNote ? ` — "${a.decisionNote}"` : ''}`,
      };
    default:
      return null; // a withdrawn request is history, not a state worth a badge
  }
}

export const APPROVAL_STATE_LABELS: Record<ClientApprovalState, string> = {
  pending: 'Në pritje',
  approved: 'Miratuar',
  changes_requested: 'Kërkoi ndryshime',
  cancelled: 'Tërhequr',
};

/** Every round, newest first (current one included). */
export function approvalRounds(task: Pick<Task, 'clientApproval' | 'clientApprovalHistory'>): ClientApproval[] {
  const all: ClientApproval[] = [];
  if (Array.isArray(task.clientApprovalHistory)) {
    for (const r of task.clientApprovalHistory) if (r && typeof r === 'object' && typeof (r as any).state === 'string') all.push(r as ClientApproval);
  }
  const cur = approvalOf(task);
  if (cur && !all.some(r => r.round === cur.round)) all.push(cur);
  return all.sort((a, b) => (b.round || 0) - (a.round || 0));
}

/** Staff recipients of the client's decision: the assignee + whoever asked (never duplicated). */
export function approvalDecisionRecipients(task: Pick<Task, 'assignedToUserId' | 'clientApproval'>): string[] {
  const a = approvalOf(task);
  return [...new Set([task.assignedToUserId, a?.requestedByUserId].filter((x): x is string => !!x))];
}
