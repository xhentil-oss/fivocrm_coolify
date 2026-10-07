import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, Node, mergeAttributes, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {
  AtSign, Bold, Code, ImageIcon, Italic, Link as LinkIcon, List, ListChecks,
  ListOrdered, Loader2, Quote, Send, SquareCode, Strikethrough, Type,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { commentToHtml, docToComment } from '../../lib/commentMarkdown';

/**
 * Asana-style comment composer: Tiptap underneath, the small Markdown subset of
 * `lib/commentMarkdown.ts` on the way out (so the portal, notifications and the
 * cron keep reading plain text). Typing shortcuts work too: `- `, `1. `,
 * `[] `, `> `, `**bold**`, `` `code` ``.
 *
 * Keys: Enter sends (outside lists/quotes/code, where it makes a new item),
 * Shift+Enter is a new line, Ctrl/⌘+Enter always sends, @ opens the people list.
 */

export interface MentionCandidate { id: string; name: string }

interface CommentEditorProps {
  /** Stored comment text to start from (edit mode). */
  initialValue?: string;
  placeholder?: string;
  mentionables?: MentionCandidate[];
  /** Return false to keep the text (save failed). */
  onSubmit: (text: string) => Promise<boolean | void> | boolean | void;
  onCancel?: () => void;
  submitLabel?: string;
  /** Upload a pasted/dropped/picked image; resolves to its URL or null. */
  onUploadImage?: (file: File) => Promise<string | null>;
  autoFocus?: boolean;
  /** Start with the formatting bar open (edit mode); otherwise it opens on focus. */
  toolbarOpen?: boolean;
  avatar?: React.ReactNode;
  className?: string;
}

const MentionNode = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      id: { default: null, parseHTML: el => el.getAttribute('data-id'), renderHTML: a => ({ 'data-id': a.id }) },
      label: { default: '', parseHTML: el => el.getAttribute('data-label'), renderHTML: a => ({ 'data-label': a.label }) },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'mention', class: 'comment-mention' }), `@${node.attrs.label}`];
  },
  renderText({ node }) {
    return `@${node.attrs.label}`;
  },
});

interface MentionState { query: string; from: number; to: number }

const MENTION_TRIGGER_RE = /(?:^|\s)@([\p{L}\p{N}._-]{0,30})$/u;

function detectMention(editor: Editor): MentionState | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  if ($from.parent.type.spec.code) return null;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 40), $from.parentOffset, undefined, '￼');
  const m = before.match(MENTION_TRIGGER_RE);
  if (!m) return null;
  return { query: m[1], from: $from.pos - m[1].length - 1, to: $from.pos };
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const ToolButton: React.FC<{
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}> = ({ onClick, active, disabled, title, children }) => (
  <button
    type="button"
    // mousedown, not click: keep the editor's selection/focus while formatting.
    onMouseDown={e => { e.preventDefault(); if (!disabled) onClick(); }}
    disabled={disabled}
    title={title}
    aria-label={title}
    aria-pressed={active}
    className={cn(
      'h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors',
      'hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed',
      active && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
    )}
  >
    {children}
  </button>
);

const Divider = () => <span className="w-px h-4 bg-border mx-0.5" aria-hidden />;

const CommentEditor: React.FC<CommentEditorProps> = ({
  initialValue,
  placeholder = 'Shto koment… @emri për të përmendur',
  mentionables = [],
  onSubmit,
  onCancel,
  submitLabel = 'Komento',
  onUploadImage,
  autoFocus = false,
  toolbarOpen = false,
  avatar,
  className,
}) => {
  const [focused, setFocused] = useState(false);
  const [showToolbar, setShowToolbar] = useState(toolbarOpen);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [hasText, setHasText] = useState(!!initialValue?.trim());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const suggestions = useMemo(() => {
    if (!mention) return [];
    const q = fold(mention.query);
    return mentionables.filter(m => !q || fold(m.name).includes(q)).slice(0, 6);
  }, [mention, mentionables]);

  // The editor's key handler is created once — it reads everything through refs.
  const live = useRef({ mention, suggestions, mentionIndex, submit: async () => {}, pick: (_c: MentionCandidate) => {}, onCancel });

  const uploadImages = useCallback(async (files: File[], ed: Editor | null) => {
    if (!onUploadImage || !ed) return;
    setUploading(true);
    try {
      for (const f of files) {
        const url = await onUploadImage(f);
        if (url) ed.chain().focus().setImage({ src: url }).run();
      }
    } finally {
      setUploading(false);
    }
  }, [onUploadImage]);
  const uploadRef = useRef(uploadImages);
  uploadRef.current = uploadImages;

  const editor = useEditor({
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        underline: false, // the stored format has no underline — don't offer what won't survive
        link: false,
      }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, protocols: ['http', 'https', 'mailto'] }),
      Image.configure({ inline: false, allowBase64: false, HTMLAttributes: { class: 'max-w-[220px] max-h-[220px] rounded-md border my-1' } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      MentionNode,
    ],
    content: initialValue ? commentToHtml(initialValue) : '',
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        class: 'comment-editor outline-none text-base sm:text-sm leading-relaxed min-h-[22px] break-words',
        'aria-label': 'Koment',
      },
      handleKeyDown: (_view, event) => {
        const s = live.current;
        if (s.mention && s.suggestions.length) {
          if (event.key === 'ArrowDown') { setMentionIndex(i => (i + 1) % s.suggestions.length); return true; }
          if (event.key === 'ArrowUp') { setMentionIndex(i => (i - 1 + s.suggestions.length) % s.suggestions.length); return true; }
          if (event.key === 'Enter' || event.key === 'Tab') { s.pick(s.suggestions[Math.min(s.mentionIndex, s.suggestions.length - 1)]); return true; }
          if (event.key === 'Escape') { setMention(null); return true; }
        }
        if (event.key === 'Escape' && s.onCancel) { s.onCancel(); return true; }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { void s.submit(); return true; }
        if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
          const ed = editorRef.current;
          const structured = ed && (ed.isActive('listItem') || ed.isActive('taskItem') || ed.isActive('codeBlock') || ed.isActive('blockquote'));
          if (!structured) { void s.submit(); return true; }
        }
        return false;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || []).filter(f => f.type.startsWith('image/'));
        if (!files.length || !onUploadImage) return false;
        event.preventDefault();
        void uploadRef.current(files, editorRef.current);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
        if (!files.length || !onUploadImage) return false;
        event.preventDefault();
        void uploadRef.current(files, editorRef.current);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      setHasText(!ed.isEmpty);
      setMention(detectMention(ed));
    },
    onSelectionUpdate: ({ editor: ed }) => setMention(detectMention(ed)),
    onFocus: () => { setFocused(true); setShowToolbar(true); },
    onBlur: () => { setFocused(false); setMention(null); },
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  useEffect(() => setMentionIndex(0), [mention?.query]);

  const pick = useCallback((c: MentionCandidate) => {
    if (!editor || !mention) return;
    editor.chain().focus()
      .insertContentAt({ from: mention.from, to: mention.to }, [
        { type: 'mention', attrs: { id: c.id, label: c.name } },
        { type: 'text', text: ' ' },
      ])
      .run();
    setMention(null);
  }, [editor, mention]);

  const submit = useCallback(async () => {
    if (!editor || busy || uploading) return;
    const text = docToComment(editor.getJSON());
    if (!text.trim()) return;
    setBusy(true);
    try {
      const ok = await onSubmit(text);
      if (ok !== false && !onCancel) {
        editor.commands.clearContent(true);
        setShowToolbar(toolbarOpen);
      }
    } finally {
      setBusy(false);
    }
  }, [editor, busy, uploading, onSubmit, onCancel, toolbarOpen]);

  live.current = { mention, suggestions, mentionIndex, submit, pick, onCancel };

  const setLink = useCallback(() => {
    if (!editor) return;
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Adresa e linkut (https://…):', previous || 'https://');
    if (url === null) return;
    if (url.trim() === '' || url.trim() === 'https://') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    let href = url.trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) href = `https://${href}`;
    try {
      const parsed = new URL(href);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return;
    } catch {
      return;
    }
    if (editor.state.selection.empty && !editor.isActive('link')) {
      editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).insertContent(' ').run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
  }, [editor]);

  const startMention = useCallback(() => {
    if (!editor) return;
    const { $from } = editor.state.selection;
    const prev = $from.parentOffset > 0 ? $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset, undefined, '￼') : '';
    editor.chain().focus().insertContent(prev && !/\s/.test(prev) ? ' @' : '@').run();
  }, [editor]);

  if (!editor) return null;

  const canSend = hasText && !busy && !uploading;

  return (
    <div className={cn('relative', className)}>
      <div
        className={cn(
          'rounded-xl border bg-muted/40 transition-colors',
          focused ? 'border-primary/50 bg-background shadow-sm' : 'border-border/60',
        )}
        onClick={() => { if (!focused) editor.commands.focus(); }}
      >
        <div className="flex items-start gap-2 px-3 pt-2.5 pb-2">
          {avatar}
          <div className="flex-1 min-w-0 max-h-72 overflow-y-auto">
            <EditorContent editor={editor} />
          </div>
        </div>

        <div className="flex items-center gap-1 px-1.5 pb-1.5" onClick={e => e.stopPropagation()}>
          {showToolbar ? (
            <div className="flex items-center gap-0.5 flex-wrap min-w-0">
              <ToolButton title="E trashë (Ctrl+B)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
                <Bold className="w-3.5 h-3.5" />
              </ToolButton>
              <ToolButton title="Kursiv (Ctrl+I)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
                <Italic className="w-3.5 h-3.5" />
              </ToolButton>
              <ToolButton title="E vizatuar" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
                <Strikethrough className="w-3.5 h-3.5" />
              </ToolButton>
              <ToolButton title="Kod" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
                <Code className="w-3.5 h-3.5" />
              </ToolButton>
              <Divider />
              <ToolButton title="Listë me pika" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
                <List className="w-3.5 h-3.5" />
              </ToolButton>
              <ToolButton title="Listë me numra" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
                <ListOrdered className="w-3.5 h-3.5" />
              </ToolButton>
              <ToolButton title="Checklist" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}>
                <ListChecks className="w-3.5 h-3.5" />
              </ToolButton>
              <Divider />
              <ToolButton title="Citim" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
                <Quote className="w-3.5 h-3.5" />
              </ToolButton>
              <ToolButton title="Bllok kodi" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
                <SquareCode className="w-3.5 h-3.5" />
              </ToolButton>
              <ToolButton title="Link" active={editor.isActive('link')} onClick={setLink}>
                <LinkIcon className="w-3.5 h-3.5" />
              </ToolButton>
              <Divider />
              {mentionables.length > 0 && (
                <ToolButton title="Përmend dikë (@)" onClick={startMention}>
                  <AtSign className="w-3.5 h-3.5" />
                </ToolButton>
              )}
              {onUploadImage && (
                <ToolButton title={uploading ? 'Po ngarkohet…' : 'Shto imazh'} disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" /> : <ImageIcon className="w-3.5 h-3.5" />}
                </ToolButton>
              )}
            </div>
          ) : (
            <ToolButton title="Formatimi" onClick={() => { setShowToolbar(true); editor.commands.focus(); }}>
              <Type className="w-3.5 h-3.5" />
            </ToolButton>
          )}

          <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
            {focused && (
              <span className="hidden md:inline text-[10px] text-muted-foreground whitespace-nowrap">
                Enter dërgon · Shift+Enter rresht i ri
              </span>
            )}
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="h-7 px-2.5 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Anulo
              </button>
            )}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSend}
              className={cn(
                'h-7 px-3 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors',
                canSend ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-muted text-muted-foreground cursor-not-allowed',
              )}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" /> : <Send className="w-3.5 h-3.5" />}
              {submitLabel}
            </button>
          </div>
        </div>
      </div>

      {onUploadImage && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={e => {
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            if (files.length) void uploadImages(files, editor);
          }}
        />
      )}

      {mention && suggestions.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-popover border rounded-lg shadow-lg z-50 p-1" role="listbox" aria-label="Përmend dikë">
          <p className="text-xs text-muted-foreground px-2 py-1">Përmend dikë</p>
          {suggestions.map((m, i) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={i === mentionIndex}
              onMouseDown={e => { e.preventDefault(); pick(m); }}
              onMouseEnter={() => setMentionIndex(i)}
              className={cn('w-full text-left px-2 py-1.5 text-sm rounded flex items-center gap-2', i === mentionIndex ? 'bg-accent' : 'hover:bg-accent')}
            >
              <span className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-medium flex-shrink-0">
                {m.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="truncate">{m.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default CommentEditor;
