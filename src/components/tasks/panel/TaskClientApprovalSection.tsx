import React, { useMemo, useState } from 'react';
import { BadgeCheck, ChevronDown, ChevronRight, Paperclip, Send, Undo2 } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { usePermissions } from '../../../contexts/PermissionsContext';
import { useMutation } from '../../../hooks/useFirestore';
import { useActivityLogger } from '../../../hooks/useActivityLogger';
import { toast } from '../../../hooks/use-toast';
import { resolvePortalUserId } from '../../../lib/notifyClient';
import { portalTaskDeepLink } from '../../../lib/deepLinks';
import { safeExternalUrl } from '../../../lib/safeUrl';
import {
  APPROVAL_REQUEST_BLOCK_LABELS,
  APPROVAL_STATE_LABELS,
  approvalBadge,
  approvalRequestBlockReason,
  approvalRounds,
  buildApprovalCancelPatch,
  buildApprovalRequestPatch,
  MAX_APPROVAL_NOTE,
} from '../../../lib/taskApproval';
import { receiptMs, receiptTimeLabel } from '../../../lib/taskReceipts';
import { Button } from '../../ui/button';
import { Textarea } from '../../ui/textarea';
import type { ClientApproval, Task } from '../../../types';
import { sectionTitleCls } from './panelShared';

interface Props {
  task: Task;
  readOnly: boolean;
  onUpdate: (id: string, data: any) => Promise<any>;
  getUserDisplayName: (userId: string) => string;
  /** Runs the panel's completion flow (completeTask) — approval never completes by itself. */
  onComplete: () => void | Promise<unknown>;
}

const when = (v: unknown) => {
  const ms = receiptMs(v);
  return ms === null ? '' : receiptTimeLabel(ms);
};

/**
 * "Miratimi i klientit" — ask the portal client to approve this deliverable
 * (Prano / Kërko ndryshime in the portal), see the decision, withdraw a pending
 * request and browse earlier rounds. Pure rules: src/lib/taskApproval.ts.
 */
const TaskClientApprovalSection: React.FC<Props> = ({ task, readOnly, onUpdate, getUserDisplayName, onComplete }) => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const logActivity = useActivityLogger();
  const notificationMutation = useMutation<any>('notifications');
  const [formOpen, setFormOpen] = useState(false);
  const [note, setNote] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const actor = { uid: user?.uid, readOnly, isManagerTier: !!(permissions.isAdmin || permissions.isManager) };
  const block = approvalRequestBlockReason(task, actor);
  const current = (task.clientApproval || null) as ClientApproval | null;
  const badge = approvalBadge(task);
  const rounds = approvalRounds(task);
  const pastRounds = rounds.filter(r => !current || r.round !== current.round);
  // Who may withdraw = who may ask (Admin/Manager, assignee, creator).
  const canManage = !readOnly && !!user?.uid && (actor.isManagerTier
    || task.assignedToUserId === user.uid || task.createdByUserId === user.uid);

  const attachments: Array<{ name?: string; url?: string }> = useMemo(() => {
    try { return task.attachments ? JSON.parse(task.attachments) : []; } catch { return []; }
  }, [task.attachments]);

  // Nothing to show on an internal task that never had a round.
  if (!task.customerId && !current) return null;

  const request = async () => {
    if (!user?.uid || block) return;
    setBusy(true);
    try {
      const att = attachments.find(a => a.url === attachmentUrl);
      const patch = buildApprovalRequestPatch(task, {
        uid: user.uid,
        now: new Date(),
        note,
        attachmentUrl: att?.url || null,
        attachmentName: att?.name || null,
      });
      await onUpdate(task.id, patch);
      setFormOpen(false);
      setNote('');
      setAttachmentUrl('');
      toast({ title: 'Kërkesa për miratim u dërgua', description: 'Klienti e sheh te portali, te projekti.' });
      logActivity('update' as any, `Detyra "${task.title}" u dërgua për miratim te klienti`, {
        description: `Raundi ${patch.clientApproval?.round ?? 1}`,
        entityType: 'task',
        entityId: task.id,
      });
      // The client hears about it on the portal project page. Best effort — the
      // request is already saved.
      try {
        const portalUid = await resolvePortalUserId(task.customerId);
        if (portalUid && portalUid !== user.uid && task.projectId) {
          await notificationMutation.create({
            userId: portalUid,
            type: 'task_approval_requested',
            title: `Pret miratimin tuaj — ${task.title}`,
            message: (note || '').trim().slice(0, 160) || 'Ekipi ju kërkon të miratoni këtë detyrë.',
            isRead: false,
            actionUrl: portalTaskDeepLink(task.projectId, task.id),
            actionLabel: 'Shiko dhe mirato',
          });
        }
      } catch (err) {
        console.error('[Notifications] task_approval_requested dërgim dështoi:', err);
      }
    } catch (err: any) {
      toast({ title: 'Kërkesa nuk u dërgua', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!user?.uid) return;
    const patch = buildApprovalCancelPatch(task, { uid: user.uid, now: new Date() });
    if (!patch) return;
    setBusy(true);
    try {
      await onUpdate(task.id, patch);
      toast({ title: 'Kërkesa për miratim u tërhoq' });
    } catch (err: any) {
      toast({ title: 'Nuk u tërhoq', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const attachmentLink = (a: ClientApproval) => {
    const href = safeExternalUrl(a.attachmentUrl);
    if (!href) return null;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-primary hover:underline">
        <Paperclip className="h-3 w-3" />{a.attachmentName || 'Materiali'}
      </a>
    );
  };

  return (
    <div className="overflow-hidden rounded-[18px] border border-border bg-card px-4 py-3.5 shadow-[0_1px_2px_rgba(12,27,51,0.06)]">
      <div className="mb-2 flex items-center gap-2">
        <h4 className={`${sectionTitleCls} flex items-center gap-1.5`}>
          <BadgeCheck className="h-4 w-4" />Miratimi i klientit
        </h4>
        {badge && (
          <span title={badge.title} className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${badge.className}`}>{badge.label}</span>
        )}
        {current && current.round > 1 && <span className="text-[10.5px] text-muted-foreground">raundi {current.round}</span>}
      </div>

      {current && current.state !== 'cancelled' && (
        <div className={`rounded-xl border p-3 text-[12.5px] ${
          current.state === 'approved' ? 'border-emerald-300/60 bg-emerald-50/60 dark:bg-emerald-950/20'
          : current.state === 'changes_requested' ? 'border-rose-300/60 bg-rose-50/60 dark:bg-rose-950/20'
          : 'border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20'
        }`}>
          <div className="text-muted-foreground">
            Dërguar {when(current.requestedAt)}{current.requestedByUserId ? ` nga ${getUserDisplayName(current.requestedByUserId)}` : ''}
          </div>
          {current.note && <div className="mt-1 whitespace-pre-wrap text-foreground">"{current.note}"</div>}
          {attachmentLink(current)}
          {current.state === 'pending' && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="font-semibold text-amber-800 dark:text-amber-300">Pret përgjigjen e klientit…</span>
              {canManage && (
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={cancel} className="h-7 px-2 text-xs">
                  <Undo2 className="mr-1 h-3.5 w-3.5" />Tërhiq kërkesën
                </Button>
              )}
            </div>
          )}
          {current.state === 'approved' && (
            <div className="mt-2">
              <div className="font-semibold text-emerald-800 dark:text-emerald-300">✓ Klienti e miratoi {when(current.decidedAt)}</div>
              {current.decisionNote && <div className="mt-0.5 whitespace-pre-wrap">"{current.decisionNote}"</div>}
              {!readOnly && task.status !== 'Done' && (
                <Button type="button" size="sm" className="mt-2 h-8" disabled={busy} onClick={() => { void onComplete(); }}>
                  Përfundo detyrën
                </Button>
              )}
            </div>
          )}
          {current.state === 'changes_requested' && (
            <div className="mt-2">
              <div className="font-semibold text-rose-800 dark:text-rose-300">↺ Klienti kërkoi ndryshime {when(current.decidedAt)}</div>
              {current.decisionNote && <div className="mt-0.5 whitespace-pre-wrap">"{current.decisionNote}"</div>}
            </div>
          )}
        </div>
      )}

      {/* Ask (or ask again) */}
      {block === null && !formOpen && (
        <Button type="button" size="sm" variant="outline" className="mt-2 h-8" onClick={() => setFormOpen(true)}>
          <Send className="mr-1.5 h-3.5 w-3.5" />
          {current && current.state !== 'cancelled' ? 'Kërko miratim përsëri' : 'Kërko miratim nga klienti'}
        </Button>
      )}
      {block === null && formOpen && (
        <div className="mt-2 space-y-2 rounded-xl border p-3">
          <Textarea
            value={note}
            onChange={e => setNote(e.target.value.slice(0, MAX_APPROVAL_NOTE))}
            rows={2}
            placeholder="Shënim për klientin (opsional) — p.sh. çfarë të kontrollojë"
            className="text-sm"
          />
          {attachments.some(a => safeExternalUrl(a.url)) && (
            <select
              value={attachmentUrl}
              onChange={e => setAttachmentUrl(e.target.value)}
              className="h-8 w-full rounded-md border bg-background px-2 text-xs"
            >
              <option value="">Pa material të bashkangjitur</option>
              {attachments.filter(a => safeExternalUrl(a.url)).map(a => (
                <option key={a.url} value={a.url}>{a.name || a.url}</option>
              ))}
            </select>
          )}
          <p className="text-[11px] text-muted-foreground">
            Statusi kalon në «Rishikim» dhe klienti njoftohet. Shënimi dhe materiali shihen nga klienti.
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" className="h-8" disabled={busy} onClick={request}>Dërgo te klienti</Button>
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setFormOpen(false)}>Anulo</Button>
          </div>
        </div>
      )}
      {block !== null && block !== 'already-pending' && block !== 'read-only' && !current && (
        <p className="text-[11px] text-muted-foreground">{APPROVAL_REQUEST_BLOCK_LABELS[block]}</p>
      )}

      {/* Earlier rounds */}
      {pastRounds.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setHistoryOpen(v => !v)} className="flex items-center gap-1 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground">
            {historyOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Raundet e mëparshme ({pastRounds.length})
          </button>
          {historyOpen && (
            <ul className="mt-1.5 space-y-1.5">
              {pastRounds.map(r => (
                <li key={r.round} className="rounded-lg bg-muted/50 px-2.5 py-1.5 text-[11.5px]">
                  <span className="font-semibold">Raundi {r.round}</span>
                  {' · '}{APPROVAL_STATE_LABELS[r.state] || r.state}
                  {' · '}{when(r.decidedAt || r.cancelledAt || r.requestedAt)}
                  {r.decisionNote && <div className="mt-0.5 whitespace-pre-wrap text-muted-foreground">"{r.decisionNote}"</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default TaskClientApprovalSection;
