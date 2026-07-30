/**
 * Report collaboration: the comment thread and the audit timeline.
 *
 * The comment composer's defining feature is that **internal is the default and the
 * client-visible mode is loud**: switching to "client visible" recolours the whole
 * composer and restates who will read it. The failure mode this guards against is a
 * team member typing "the client is being difficult" into a box they thought was
 * private.
 */

import React, { useMemo, useState } from 'react';
import {
  CheckCircle2, Clock, Eye, Lock, MessageSquare, Send, User as UserIcon,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { Textarea } from '../ui/textarea';
import { isCommentVisibleTo, type ReportAudience } from '../../lib/reporting/visibility';
import { useCommentFocus, COMMENT_FLASH_CLASS } from '../../hooks/useCommentFocus';
import type { ReportComment, ReportEvent, ReportEventKind } from '../../types';

// ── comments ────────────────────────────────────────────────────────────────────

interface CommentsProps {
  comments: ReportComment[];
  audience: ReportAudience;
  /** Client mode hides the internal toggle entirely. */
  mode: 'staff' | 'client';
  currentUserId?: string | null;
  onSubmit: (body: string, internal: boolean) => Promise<void>;
  onResolve?: (commentId: string, resolved: boolean) => Promise<void>;
  getName?: (userId: string) => string;
  /** Comment to scroll to + flash, set when arriving from a notification. */
  focusCommentId?: string | null;
}

export const ReportComments: React.FC<CommentsProps> = ({
  comments, audience, mode, currentUserId, onSubmit, onResolve, getName, focusCommentId,
}) => {
  const { registerComment, isFlashing } = useCommentFocus(focusCommentId);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(true);
  const [sending, setSending] = useState(false);

  // Belt and braces: the query is already scoped, and the renderer filters again.
  const visible = useMemo(
    () => comments.filter(c => isCommentVisibleTo(c, audience)),
    [comments, audience],
  );

  const roots = visible.filter(c => !c.parentId);
  const repliesOf = (id: string) => visible.filter(c => c.parentId === id);

  const send = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await onSubmit(text, mode === 'client' ? false : internal);
      setBody('');
    } finally {
      setSending(false);
    }
  };

  const clientMode = mode === 'client' || !internal;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-semibold text-foreground">Diskutimi</h3>
        <Badge variant="outline" className="text-xs">{visible.length}</Badge>
      </div>

      {!visible.length && (
        <p className="text-sm text-muted-foreground">Pa komente.</p>
      )}

      <div className="space-y-3">
        {roots.map(c => (
          <div key={c.id} className="space-y-2">
            <CommentBubble comment={c} currentUserId={currentUserId} onResolve={onResolve} getName={getName}
              nodeRef={registerComment(c.id)} flash={isFlashing(c.id)} />
            {repliesOf(c.id).length > 0 && (
              <div className="ml-6 space-y-2 border-l border-border pl-3">
                {repliesOf(c.id).map(r => (
                  <CommentBubble key={r.id} comment={r} currentUserId={currentUserId} onResolve={onResolve} getName={getName}
                    nodeRef={registerComment(r.id)} flash={isFlashing(r.id)} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Composer */}
      <Card className={`p-3 space-y-3 border-2 transition-colors ${
        clientMode ? 'border-primary/50 bg-primary/5' : 'border-border'}`}>
        {mode === 'staff' && (
          <div className="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit">
            <button
              type="button"
              onClick={() => setInternal(true)}
              className={`text-xs px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors ${
                internal ? 'bg-card shadow-sm text-foreground font-medium' : 'text-muted-foreground'}`}
            >
              <Lock className="w-3 h-3" /> Vetëm brenda
            </button>
            <button
              type="button"
              onClick={() => setInternal(false)}
              className={`text-xs px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors ${
                !internal ? 'bg-primary text-primary-foreground shadow-sm font-semibold' : 'text-muted-foreground'}`}
            >
              <Eye className="w-3 h-3" /> I dukshëm për klientin
            </button>
          </div>
        )}

        {clientMode && mode === 'staff' && (
          <p className="text-xs text-primary font-medium flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5" /> Klienti do t'i lexojë këto fjalë në portal.
          </p>
        )}

        <Textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={3}
          className="text-base sm:text-sm"
          placeholder={clientMode ? 'Shkruani klientit…' : 'Shënim i brendshëm për ekipin…'}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(); }
          }}
        />

        <div className="flex justify-end">
          <Button size="sm" onClick={send} disabled={!body.trim() || sending} className="gap-1.5">
            <Send className="w-3.5 h-3.5" /> {sending ? 'Duke dërguar…' : 'Dërgo'}
          </Button>
        </div>
      </Card>
    </div>
  );
};

const CommentBubble: React.FC<{
  comment: ReportComment;
  currentUserId?: string | null;
  onResolve?: (id: string, resolved: boolean) => Promise<void>;
  getName?: (userId: string) => string;
  /** Set by the deep-link focus hook so a notification can scroll here. */
  nodeRef?: (el: HTMLElement | null) => void;
  flash?: boolean;
}> = ({ comment, currentUserId, onResolve, getName, nodeRef, flash }) => {
  const mine = comment.authorUserId === currentUserId;
  const name = comment.authorName
    || (comment.authorCustomerId ? 'Klienti' : getName?.(comment.authorUserId))
    || 'Anëtar';
  return (
    <div ref={nodeRef} className={`scroll-mt-24 rounded-lg border p-3 ${comment.internal
      ? 'bg-muted/40 border-border'
      : 'bg-primary/5 border-primary/25'} ${comment.resolvedAt ? 'opacity-60' : ''} ${
      flash ? COMMENT_FLASH_CLASS : ''}`}>
      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-foreground truncate">{name}{mine ? ' (ju)' : ''}</span>
          <Badge variant="outline" className={`text-[10px] gap-1 shrink-0 ${comment.internal
            ? 'bg-muted text-muted-foreground'
            : 'bg-primary/10 text-primary border-primary/30'}`}>
            {comment.internal ? <><Lock className="w-2.5 h-2.5" /> brenda</> : <><Eye className="w-2.5 h-2.5" /> klienti</>}
          </Badge>
          {comment.resolvedAt && (
            <Badge variant="outline" className="text-[10px] gap-1 shrink-0 bg-success/10 text-success border-success/30">
              <CheckCircle2 className="w-2.5 h-2.5" /> zgjidhur
            </Badge>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0">{fmtDateTime(comment.createdAt)}</span>
      </div>
      <p className="text-sm text-foreground whitespace-pre-line">{comment.body}</p>
      {onResolve && (
        <button
          type="button"
          onClick={() => void onResolve(comment.id, !comment.resolvedAt)}
          className="text-[11px] text-muted-foreground hover:text-foreground mt-2"
        >
          {comment.resolvedAt ? 'Rihap' : 'Shëno si zgjidhur'}
        </button>
      )}
    </div>
  );
};

// ── audit timeline ──────────────────────────────────────────────────────────────

const EVENT_LABELS: Partial<Record<ReportEventKind, string>> = {
  created: 'Raporti u krijua',
  updated: 'Përmbajtja u përditësua',
  'status-changed': 'Statusi ndryshoi',
  submitted: 'U dorëzua për shqyrtim',
  'changes-requested': 'U kërkuan ndryshime',
  approved: 'U aprovua brenda',
  published: 'U publikua për klientin',
  unpublished: 'U hoq nga publikimi',
  viewed: 'Klienti e hapi raportin',
  'pdf-downloaded': 'PDF-i u shkarkua',
  emailed: 'U dërgua me email',
  'email-failed': 'Dërgimi me email dështoi',
  'client-acknowledged': 'Klienti konfirmoi marrjen',
  'client-approved': 'Klienti aprovoi',
  'client-rejected': 'Klienti refuzoi',
  commented: 'Koment i shtuar',
  archived: 'U arkivua',
  restored: 'U riaktivizua',
  deleted: 'U fshi (soft)',
  generated: 'U generua automatikisht',
  'generation-failed': 'Generimi dështoi',
  reminded: 'U dërgua kujtesë',
  escalated: 'U eskalua',
  'ai-suggested': 'AI sugjeroi përmbajtje',
  'sync-failed': 'Sinkronizimi i të dhënave dështoi',
  'block-added': 'Bllok i shtuar',
  'block-removed': 'Bllok i hequr',
  'block-reordered': 'Bllokët u riorganizuan',
  'visibility-changed': 'Dukshmëria ndryshoi',
};

export const ReportAuditTimeline: React.FC<{
  events: ReportEvent[];
  getName?: (userId: string) => string;
  limit?: number;
}> = ({ events, getName, limit = 50 }) => {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? events : events.slice(0, limit);

  if (!events.length) {
    return <p className="text-sm text-muted-foreground">Pa aktivitet të regjistruar.</p>;
  }

  return (
    <div className="space-y-3">
      <ol className="relative border-l border-border ml-1.5 space-y-3">
        {shown.map(e => (
          <li key={e.id} className="ml-4">
            <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-border" aria-hidden />
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <p className="text-sm text-foreground">
                {EVENT_LABELS[e.kind] || e.kind}
                {e.field === 'status' && e.toValue && (
                  <span className="text-muted-foreground"> → {String(e.toValue)}</span>
                )}
              </p>
              <span className="text-[11px] text-muted-foreground shrink-0">{fmtDateTime(e.createdAt)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {e.actorType === 'client' ? 'Klienti'
                : e.actorType === 'system' ? 'Sistemi'
                  : e.actorName || (e.actorUserId ? getName?.(e.actorUserId) : null) || 'Anëtar'}
              {e.version ? ` · v${e.version}` : ''}
            </p>
            {(e.reason || e.comment) && (
              <p className="text-xs text-foreground mt-1 italic">"{e.reason || e.comment}"</p>
            )}
          </li>
        ))}
      </ol>
      {events.length > limit && !showAll && (
        <Button variant="ghost" size="sm" onClick={() => setShowAll(true)} className="gap-1.5">
          <Clock className="w-3.5 h-3.5" /> Shfaq të gjitha ({events.length})
        </Button>
      )}
    </div>
  );
};

function fmtDateTime(d: Date | undefined): string {
  if (!(d instanceof Date)) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

export default ReportComments;
