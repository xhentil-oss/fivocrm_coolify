import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Scroll a deep-linked comment into view and flash it.
 *
 * Clicking a comment notification has to land on the comment, so the view opens
 * the record and hands the comment id here. The comment list normally mounts a
 * few frames *after* the route does (Firestore snapshot → render → panel
 * animation), so this retries for a couple of seconds instead of scrolling to
 * nothing and giving up silently.
 *
 * Usage:
 *   const { registerComment, isFlashing } = useCommentFocus(focusCommentId);
 *   <div ref={registerComment(c.id)} className={isFlashing(c.id) ? COMMENT_FLASH_CLASS : ''}>
 */

/** Ring + tint applied to the deep-linked comment for a few seconds. */
export const COMMENT_FLASH_CLASS =
  'rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background bg-primary/5 transition-shadow';

const RETRIES = 20;      // ×150ms ≈ 3s of waiting for the list to render
const RETRY_MS = 150;
const FLASH_MS = 3000;

export function useCommentFocus(commentId?: string | null) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const handled = useRef<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  /** ref callback for a comment node: `ref={registerComment(comment.id)}` */
  const registerComment = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) nodes.current.set(id, el);
      else nodes.current.delete(id);
    },
    [],
  );

  useEffect(() => {
    if (!commentId || handled.current === commentId) return;
    let cancelled = false;
    const timers: number[] = [];

    const attempt = (left: number) => {
      if (cancelled) return;
      const el = nodes.current.get(commentId);
      if (!el) {
        if (left > 0) timers.push(window.setTimeout(() => attempt(left - 1), RETRY_MS));
        return;
      }
      handled.current = commentId;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFlashId(commentId);
      timers.push(window.setTimeout(() => { if (!cancelled) setFlashId(null); }, FLASH_MS));
    };
    attempt(RETRIES);

    return () => { cancelled = true; timers.forEach(t => window.clearTimeout(t)); };
  }, [commentId]);

  const isFlashing = useCallback((id: string) => flashId === id, [flashId]);

  return { registerComment, isFlashing };
}

export default useCommentFocus;
