import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, SmilePlus } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { toast } from '../../../hooks/use-toast';
import { useFileUpload } from '../../../hooks/useFileUpload';
import { useCommentFocus, COMMENT_FLASH_CLASS } from '../../../hooks/useCommentFocus';
import CommentEditor, { type MentionCandidate } from '../../comments/CommentEditor';
import CommentBody from '../../comments/CommentBody';
import type { Task, TaskComment } from '../../../types';
import { COMMENT_REACTIONS } from './panelShared';
import { useTaskCommentSubmit } from './useTaskCommentSubmit';
import { usePageVisible } from '../../../hooks/usePageVisible';
import { commentReceipt, commentsToMarkRead } from '../../../lib/taskReceipts';
import { markTaskCommentsRead } from '../../../lib/taskReceiptWrites';

interface TaskCommentsSectionProps {
  task: Task;
  readOnly: boolean;
  comments: TaskComment[];
  onAddComment: (taskId: string, content: string, opts?: { visibleToClient?: boolean }) => void | Promise<any>;
  /** Comment to scroll to + flash, set when arriving from a notification. */
  focusCommentId?: string | null;
  onEditComment?: (commentId: string, content: string) => void | Promise<any>;
  onDeleteComment?: (commentId: string) => void | Promise<any>;
  onToggleReaction?: (commentId: string, emoji: string) => void | Promise<any>;
  mentionCandidates: MentionCandidate[];
  resolveLegacyMention: (value: string) => string | null;
  getUserDisplayName: (userId: string) => string;
}

/** "Komente" — thread (reactions, edit, delete) + composer. */
const TaskCommentsSection: React.FC<TaskCommentsSectionProps> = ({
  task,
  readOnly,
  comments,
  onAddComment,
  focusCommentId,
  onEditComment,
  onDeleteComment,
  onToggleReaction,
  mentionCandidates,
  resolveLegacyMention,
  getUserDisplayName,
}) => {
  const { user } = useAuth();
  // Deep link from a comment notification → scroll to that comment and flash it.
  const { registerComment, isFlashing } = useCommentFocus(focusCommentId);
  const { upload: uploadCommentImage } = useFileUpload();
  // Images in comments: uploaded to the file server, stored as their URL line.
  // No SVG — it is a document that can carry script (see RichTextEditor).
  const handleCommentImageUpload = async (file: File): Promise<string | null> => {
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) {
      toast({ title: 'Format i pasaktë', description: 'Lejohen vetëm PNG, JPG, GIF, WEBP.', variant: 'destructive' });
      return null;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Imazhi shumë i madh', description: 'Maksimumi 5 MB.', variant: 'destructive' });
      return null;
    }
    try {
      const res = await uploadCommentImage(file, 'comment-images');
      return res.url;
    } catch (err) {
      toast({ title: 'Ngarkimi dështoi', description: (err as Error)?.message || 'Provo përsëri.', variant: 'destructive' });
      return null;
    }
  };
  // Per-comment client visibility (opt-in; resets after every send).
  const [commentVisibleToClient, setCommentVisibleToClient] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [confirmDeleteCommentId, setConfirmDeleteCommentId] = useState<string | null>(null);
  // Which comment's emoji picker is open (WhatsApp/Slack-style reactions on comments).
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  const toggleReaction = (commentId: string, emoji: string) => {
    setReactionPickerId(null);
    onToggleReaction?.(commentId, emoji);
  };

  const startEditComment = (c: TaskComment) => {
    setConfirmDeleteCommentId(null);
    setEditingCommentId(c.id);
  };
  // The editor loads the stored text as-is, so @[Name](uid) mentions survive an
  // edit (the old textarea flattened them to "@Name" and lost the uid).
  const saveEditComment = async (id: string, text: string): Promise<boolean> => {
    if (!text.trim()) return false;
    try {
      await onEditComment?.(id, text);
      setEditingCommentId(null);
      return true;
    } catch (err: any) {
      toast({ title: 'Ndryshimi nuk u ruajt', description: err?.message, variant: 'destructive' });
      return false;
    }
  };
  const deleteComment = async (id: string) => {
    await onDeleteComment?.(id);
    setConfirmDeleteCommentId(null);
  };

  // "✓✓ Parë": every comment rendered here while the tab is visible is marked read
  // for me (never my own; once per comment per mount). Viewers mark too — seen is
  // not an edit (rules test 83g). A failure is logged once and NOT retried in a
  // loop: the ids stay in the sent set until the panel remounts.
  const pageVisible = usePageVisible();
  const readSentRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!user?.uid || !pageVisible || comments.length === 0) return;
    const ids = commentsToMarkRead(comments, user.uid, readSentRef.current);
    if (ids.length === 0) return;
    ids.forEach(id => readSentRef.current.add(id));
    markTaskCommentsRead(ids, user.uid)
      .then(failed => { if (failed) console.warn(`[Tasks] ${failed} komente nuk u shënuan si të lexuara`); })
      .catch(err => console.warn('[Tasks] shënimi i komenteve si të lexuara dështoi:', err));
  }, [comments, user?.uid, pageVisible]);
  // Readers are staff (names) or the portal client (no staff record → "Klienti").
  const readerName = (uid: string) => {
    const n = getUserDisplayName(uid);
    return n === uid.slice(0, 12) ? 'Klienti' : n;
  };

  const handleAddCommentSubmit = useTaskCommentSubmit({
    task,
    comments,
    readOnly,
    onAddComment,
    commentVisibleToClient,
    setCommentVisibleToClient,
  });


  return (
    <div className="pt-4 border-t">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground flex items-center gap-1.5">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          Komente
          {comments.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({comments.length})</span>
          )}
        </h4>
      </div>

      {comments.length > 0 && (
        <div className="space-y-1 mb-4">
          {[...comments]
            .sort((a, b) => {
              const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toMillis?.() ?? new Date(a.createdAt as any).getTime() ?? 0;
              const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toMillis?.() ?? new Date(b.createdAt as any).getTime() ?? 0;
              return ta - tb;
            })
            .map((comment, idx, arr) => {
              const isCurrentUser = (comment.createdByUserId || comment.userId) === user?.uid;
              const commenterName = getUserDisplayName(comment.createdByUserId || comment.userId || '');
              const initials = commenterName.slice(0, 2).toUpperCase();
              const createdAt = comment.createdAt instanceof Date
                ? comment.createdAt
                : (comment.createdAt as any)?.toDate?.()
                  ? (comment.createdAt as any).toDate()
                  : new Date(comment.createdAt as any);
              const now = new Date();
              const diffMs = now.getTime() - createdAt.getTime();
              const diffMin = Math.floor(diffMs / 60000);
              const timeLabel = diffMin < 1 ? 'tani'
                : diffMin < 60 ? `${diffMin} min`
                : diffMin < 1440 ? `${Math.floor(diffMin / 60)} orë`
                : createdAt.toLocaleDateString('sq-AL', { day: '2-digit', month: 'short' });

              // Show name only when author changes
              const prevComment = idx > 0 ? arr[idx - 1] : null;
              const showName = !prevComment || (prevComment.createdByUserId || prevComment.userId) !== (comment.createdByUserId || comment.userId);

              return (
                <div
                  key={comment.id}
                  ref={registerComment(comment.id)}
                  className={`flex gap-2 scroll-mt-24 ${isCurrentUser ? 'flex-row-reverse' : 'flex-row'} ${
                    isFlashing(comment.id) ? `${COMMENT_FLASH_CLASS} p-2 -mx-1` : ''
                  }`}
                >
                  {/* Avatar — only show when author changes */}
                  <div className="flex-shrink-0 w-7">
                    {showName && (
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold
                        ${isCurrentUser
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted-foreground/20 text-muted-foreground'}`}>
                        {initials}
                      </div>
                    )}
                  </div>

                  <div className={`${editingCommentId === comment.id ? 'w-full max-w-full flex-1' : 'max-w-[75%]'} ${isCurrentUser ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                    {showName && (
                      <span className={`text-[11px] font-medium text-muted-foreground px-1 flex items-center gap-1 ${isCurrentUser ? 'justify-end' : 'justify-start'}`}>
                        {isCurrentUser ? 'Ti' : commenterName}
                        {(comment as any).senderType === 'client' && (
                          <span className="text-[9px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1 py-0.5 rounded font-medium">Klient</span>
                        )}
                      </span>
                    )}
                    {editingCommentId === comment.id ? (
                      <CommentEditor
                        className="w-full"
                        initialValue={comment.content}
                        mentionables={mentionCandidates}
                        onSubmit={text => saveEditComment(comment.id, text)}
                        onCancel={() => setEditingCommentId(null)}
                        onUploadImage={handleCommentImageUpload}
                        submitLabel="Ruaj"
                        autoFocus
                        toolbarOpen
                      />
                    ) : (
                      <>
                        <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed
                          ${isCurrentUser
                            ? 'bg-primary text-primary-foreground rounded-tr-sm'
                            : 'bg-muted text-foreground rounded-tl-sm'}`}>
                          <CommentBody content={comment.content} onPrimary={isCurrentUser} resolveLegacyMention={resolveLegacyMention} />
                          {(comment as any).edited && <span className="opacity-60 text-[10px] ml-1">(edituar)</span>}
                        </div>
                        {/* Reaction chips — one pill per emoji with its count; click to toggle your own. */}
                        {(() => {
                          const reactions = (comment as any).reactions as Record<string, string[]> | undefined;
                          const entries = reactions ? Object.entries(reactions).filter(([, ids]) => Array.isArray(ids) && ids.length > 0) : [];
                          if (entries.length === 0) return null;
                          return (
                            <div className={`flex flex-wrap gap-1 ${isCurrentUser ? 'justify-end' : 'justify-start'}`}>
                              {entries.map(([emoji, ids]) => {
                                const mine = !!user?.uid && ids.includes(user.uid);
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => onToggleReaction && toggleReaction(comment.id, emoji)}
                                    disabled={!onToggleReaction}
                                    title={ids.map(id => getUserDisplayName(id)).join(', ')}
                                    className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] border transition-colors ${mine ? 'bg-primary/10 border-primary/40 text-foreground' : 'bg-muted/60 border-transparent hover:bg-muted text-muted-foreground'}`}
                                  >
                                    <span>{emoji}</span>
                                    <span className="font-medium">{ids.length}</span>
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })()}
                        <div className={`flex items-center gap-2 px-1 ${isCurrentUser ? 'justify-end' : 'justify-start'}`}>
                          <span className="text-[10px] text-muted-foreground">{timeLabel}</span>
                          {(() => {
                            // WhatsApp-style receipt: who (else) has seen this comment.
                            const r = commentReceipt(comment, readerName);
                            if (!isCurrentUser && r.kind === 'sent') return null;
                            return (
                              <span
                                title={r.title}
                                className={`text-[10px] ${r.kind === 'read' ? 'text-sky-600 dark:text-sky-400' : 'text-muted-foreground'}`}
                              >
                                {r.label}
                              </span>
                            );
                          })()}
                          {onToggleReaction && (
                            <div className="relative">
                              <button type="button" onClick={() => setReactionPickerId(reactionPickerId === comment.id ? null : comment.id)} aria-label="Reago" className="text-muted-foreground hover:text-foreground transition-colors flex items-center">
                                <SmilePlus className="w-3.5 h-3.5" />
                              </button>
                              {reactionPickerId === comment.id && (
                                <div className={`absolute bottom-full mb-1 z-20 flex gap-0.5 bg-popover border rounded-full shadow-lg px-1.5 py-1 ${isCurrentUser ? 'right-0' : 'left-0'}`}>
                                  {COMMENT_REACTIONS.map(emoji => (
                                    <button key={emoji} type="button" onClick={() => toggleReaction(comment.id, emoji)} className="text-base hover:scale-125 transition-transform leading-none">{emoji}</button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {isCurrentUser && onEditComment && (
                            <button type="button" onClick={() => startEditComment(comment)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">Edito</button>
                          )}
                          {isCurrentUser && onDeleteComment && (
                            confirmDeleteCommentId === comment.id ? (
                              <span className="inline-flex items-center gap-1.5">
                                <button type="button" onClick={() => deleteComment(comment.id)} className="text-[10px] font-semibold text-red-500 hover:text-red-600">Fshi vërtet</button>
                                <button type="button" onClick={() => setConfirmDeleteCommentId(null)} className="text-[10px] text-muted-foreground hover:text-foreground">Jo</button>
                              </span>
                            ) : (
                              <button type="button" onClick={() => setConfirmDeleteCommentId(comment.id)} className="text-[10px] text-muted-foreground hover:text-red-500 transition-colors">Fshi</button>
                            )
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {comments.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4 italic">Ende nuk ka komente</p>
      )}

      {/* Comment Input */}
      <div>
        <CommentEditor
          placeholder="Shto koment… @emri për të përmendur"
          mentionables={mentionCandidates}
          onSubmit={handleAddCommentSubmit}
          onUploadImage={handleCommentImageUpload}
          avatar={
            <div className="w-6 h-6 mt-px rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-primary-foreground flex-shrink-0">
              {user?.displayName?.slice(0, 2).toUpperCase() || user?.email?.slice(0, 2).toUpperCase() || 'U'}
            </div>
          }
        />
        {/* Client visibility is OPT-IN per comment: comments are internal
            by default; checking this stamps customerId, which is what the
            portal's query (and the rules) key client access on. */}
        {!!(task as any).customerId && !readOnly && (
          <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={commentVisibleToClient}
              onChange={(e) => setCommentVisibleToClient(e.target.checked)}
              className="h-3 w-3 accent-primary"
            />
            Dukshëm për klientin në portal
            {commentVisibleToClient && <span className="font-semibold text-amber-600">— klienti do ta lexojë</span>}
          </label>
        )}
      </div>
    </div>
  );
};

export default TaskCommentsSection;
