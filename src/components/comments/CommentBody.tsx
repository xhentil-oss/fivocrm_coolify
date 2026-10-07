import React from 'react';
import { CheckSquare, Square } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  isImageUrl,
  isSafeHref,
  parseComment,
  soleImageUrl,
  type CommentBlock,
  type CommentInline,
} from '../../lib/commentMarkdown';

interface CommentBodyProps {
  content: string;
  /** On the sender's own (primary-coloured) bubble, primary-on-primary is invisible. */
  onPrimary?: boolean;
  /** Resolve the legacy `@uid` form to a name; null = render the text as typed. */
  resolveLegacyMention?: (value: string) => string | null;
  className?: string;
}

/**
 * Renders a stored comment (see `lib/commentMarkdown.ts`) as React nodes — never
 * through innerHTML, so nothing a user typed can become markup.
 */
const CommentBody: React.FC<CommentBodyProps> = ({ content, onPrimary = false, resolveLegacyMention, className }) => {
  const mentionCls = onPrimary
    ? 'text-primary-foreground font-semibold bg-white/25 px-1 rounded'
    : 'text-primary font-medium bg-primary/10 px-1 rounded';
  const codeCls = onPrimary
    ? 'bg-white/20 rounded px-1 py-px font-mono text-[0.85em]'
    : 'bg-background/70 border border-border/50 rounded px-1 py-px font-mono text-[0.85em]';
  const linkCls = 'underline underline-offset-2 break-all';

  const inline = (nodes: CommentInline[], key = ''): React.ReactNode[] => nodes.map((n, i) => {
    const k = `${key}${i}`;
    switch (n.t) {
      case 'text': return <React.Fragment key={k}>{n.v}</React.Fragment>;
      case 'b': return <strong key={k} className="font-semibold">{inline(n.c, k)}</strong>;
      case 'i': return <em key={k}>{inline(n.c, k)}</em>;
      case 's': return <s key={k} className="opacity-80">{inline(n.c, k)}</s>;
      case 'code': return <code key={k} className={codeCls}>{n.v}</code>;
      case 'mention': return <span key={k} className={mentionCls}>@{n.name}</span>;
      case 'legacyMention': {
        const name = resolveLegacyMention?.(n.v);
        return name ? <span key={k} className={mentionCls}>@{name}</span> : <React.Fragment key={k}>@{n.v}</React.Fragment>;
      }
      case 'link':
        return isSafeHref(n.href)
          ? <a key={k} href={n.href} target="_blank" rel="noopener noreferrer" className={linkCls}>{inline(n.c, k)}</a>
          : <React.Fragment key={k}>{inline(n.c, k)}</React.Fragment>;
      case 'url':
        return isImageUrl(n.href) ? (
          <a key={k} href={n.href} target="_blank" rel="noopener noreferrer" className="block my-1">
            <img src={n.href} alt="imazh" className="max-w-[260px] max-h-[260px] rounded-lg border border-border/40 object-cover" loading="lazy" />
          </a>
        ) : (
          <a key={k} href={n.href} target="_blank" rel="noopener noreferrer" className={linkCls}>{n.href}</a>
        );
    }
  });

  const blocks = (list: CommentBlock[], key = ''): React.ReactNode[] => list.map((b, i) => {
    const k = `${key}${i}`;
    switch (b.t) {
      case 'blank': return <div key={k} className="h-2" aria-hidden />;
      case 'line': {
        const img = soleImageUrl(b.c);
        if (img) return <div key={k}>{inline(b.c, k)}</div>;
        return <div key={k} className="whitespace-pre-wrap break-words">{inline(b.c, k)}</div>;
      }
      case 'codeblock':
        return (
          <pre key={k} className={cn('my-1 rounded-md px-2.5 py-2 overflow-x-auto font-mono text-[12px] leading-snug whitespace-pre', onPrimary ? 'bg-black/20' : 'bg-background/70 border border-border/50')}>
            <code>{b.v}</code>
          </pre>
        );
      case 'quote':
        return (
          <blockquote key={k} className={cn('my-1 border-l-2 pl-2.5 italic', onPrimary ? 'border-white/50 opacity-90' : 'border-primary/40 text-muted-foreground')}>
            {blocks(b.c, k)}
          </blockquote>
        );
      case 'list': {
        const isChecklist = b.items.every(it => it.checked !== null);
        if (isChecklist) {
          return (
            <ul key={k} className="my-0.5 space-y-0.5">
              {b.items.map((it, j) => (
                <li key={`${k}-${j}`} className="flex gap-1.5 items-start">
                  {it.checked
                    ? <CheckSquare className="w-3.5 h-3.5 mt-[3px] flex-shrink-0 opacity-80" aria-label="Kryer" />
                    : <Square className="w-3.5 h-3.5 mt-[3px] flex-shrink-0 opacity-60" aria-label="Pa kryer" />}
                  <div className={cn('min-w-0 break-words', it.checked && 'line-through opacity-70')}>
                    {inline(it.c, `${k}-${j}`)}
                    {blocks(it.children, `${k}-${j}-`)}
                  </div>
                </li>
              ))}
            </ul>
          );
        }
        const Tag = b.ordered ? 'ol' : 'ul';
        return (
          <Tag key={k} start={b.ordered ? b.start : undefined} className={cn('my-0.5 pl-5 space-y-0.5', b.ordered ? 'list-decimal' : 'list-disc')}>
            {b.items.map((it, j) => (
              <li key={`${k}-${j}`} className="break-words">
                {it.checked !== null && <span className="mr-1">{it.checked ? '☑' : '☐'}</span>}
                {inline(it.c, `${k}-${j}`)}
                {blocks(it.children, `${k}-${j}-`)}
              </li>
            ))}
          </Tag>
        );
      }
    }
  });

  return <div className={cn('comment-body', className)}>{blocks(parseComment(content))}</div>;
};

export default CommentBody;
