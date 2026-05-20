import React, { useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Image from '@tiptap/extension-image';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code,
  Heading1, Heading2, Heading3, List, ListOrdered, ListChecks,
  Quote, Minus, Link as LinkIcon, AlignLeft, AlignCenter, AlignRight,
  Highlighter, Undo, Redo, RemoveFormatting, ImageIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useFileUpload } from '../hooks/useFileUpload';
import { toast } from '../hooks/use-toast';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];

interface RichTextEditorProps {
  content: string;
  onChange?: (html: string) => void;
  onBlur?: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  minHeight?: string;
  className?: string;
  autoFocus?: boolean;
}

const MenuButton: React.FC<{
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}> = ({ onClick, isActive, disabled, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={cn(
      'p-1.5 rounded hover:bg-muted transition-colors',
      isActive && 'bg-primary/10 text-primary',
      disabled && 'opacity-40 cursor-not-allowed'
    )}
  >
    {children}
  </button>
);

const MenuDivider = () => <div className="w-px h-5 bg-border mx-0.5" />;

const RichTextEditor: React.FC<RichTextEditorProps> = ({
  content,
  onChange,
  onBlur,
  placeholder = 'Shkruaj diçka...',
  editable = true,
  minHeight = '150px',
  className,
  autoFocus = false,
}) => {
  const { upload, uploading } = useFileUpload();
  const uploadRef = useRef(upload);
  uploadRef.current = upload;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleImageFile = useCallback(async (file: File): Promise<string | null> => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast({ title: 'Format i pasaktë', description: 'Lejohen vetëm PNG, JPG, GIF, WEBP, SVG.', variant: 'destructive' });
      return null;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast({ title: 'Imazhi shumë i madh', description: 'Madhësia maksimale 5 MB.', variant: 'destructive' });
      return null;
    }
    try {
      const res = await uploadRef.current(file, 'rte-images');
      return res.url;
    } catch (err) {
      toast({ title: 'Ngarkimi dështoi', description: (err as Error)?.message || 'Provo përsëri.', variant: 'destructive' });
      return null;
    }
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
        underline: false,
        link: false,
      }),
      Placeholder.configure({ placeholder }),
      Underline,
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: { class: 'max-w-full h-auto rounded-md my-2' },
      }),
      Link.configure({
        openOnClick: !editable,
        HTMLAttributes: { class: 'text-primary underline cursor-pointer' },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TextStyle,
      Color,
    ],
    content,
    editable,
    autofocus: autoFocus,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML());
    },
    onBlur: ({ editor }) => {
      onBlur?.(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'outline-none prose prose-sm dark:prose-invert max-w-none',
        style: `min-height: ${minHeight}`,
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (!file) continue;
            event.preventDefault();
            (async () => {
              const url = await handleImageFile(file);
              if (url && editor) editor.chain().focus().setImage({ src: url }).run();
            })();
            return true;
          }
        }
        // Strip any pasted HTML with data:image base64 (defense in depth)
        const html = event.clipboardData?.getData('text/html');
        if (html && /<img[^>]+src="data:image\//i.test(html)) {
          event.preventDefault();
          const text = event.clipboardData?.getData('text/plain') || '';
          editor?.chain().focus().insertContent(text).run();
          toast({ title: 'Imazhi inline u hoq', description: 'Përdor butonin e imazhit për ta ngarkuar.' });
          return true;
        }
        return false;
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files || []);
        const images = files.filter(f => f.type.startsWith('image/'));
        if (images.length === 0) return false;
        event.preventDefault();
        (async () => {
          for (const file of images) {
            const url = await handleImageFile(file);
            if (url && editor) editor.chain().focus().setImage({ src: url }).run();
          }
        })();
        return true;
      },
    },
  });

  const onPickImage = useCallback(() => fileInputRef.current?.click(), []);
  const onImageInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editor) return;
    const url = await handleImageFile(file);
    if (url) editor.chain().focus().setImage({ src: url }).run();
  }, [editor, handleImageFile]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL:', previousUrl);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    // Validate URL protocol to prevent javascript: XSS
    try {
      const parsed = new URL(url, window.location.origin);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return;
    } catch {
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  if (!editor) return null;

  // Read-only mode — just render content
  if (!editable) {
    return (
      <div className={cn('rich-text-readonly', className)}>
        <EditorContent editor={editor} />
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg border bg-background', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 flex-wrap px-2 py-1.5 border-b bg-muted/30">
        {/* Undo/Redo */}
        <MenuButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Zhbëj">
          <Undo className="w-3.5 h-3.5" />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Ribëj">
          <Redo className="w-3.5 h-3.5" />
        </MenuButton>

        <MenuDivider />

        {/* Text formatting */}
        <MenuButton onClick={() => editor.chain().focus().toggleBold().run()} isActive={editor.isActive('bold')} title="Bold (Ctrl+B)">
          <Bold className="w-3.5 h-3.5" />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleItalic().run()} isActive={editor.isActive('italic')} title="Italic (Ctrl+I)">
          <Italic className="w-3.5 h-3.5" />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleUnderline().run()} isActive={editor.isActive('underline')} title="Underline (Ctrl+U)">
          <UnderlineIcon className="w-3.5 h-3.5" />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleStrike().run()} isActive={editor.isActive('strike')} title="Strikethrough">
          <Strikethrough className="w-3.5 h-3.5" />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleCode().run()} isActive={editor.isActive('code')} title="Inline Code">
          <Code className="w-3.5 h-3.5" />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleHighlight().run()} isActive={editor.isActive('highlight')} title="Highlight">
          <Highlighter className="w-3.5 h-3.5" />
        </MenuButton>

        <MenuDivider />

        {/* Headings */}
        <MenuButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} isActive={editor.isActive('heading', { level: 1 })} title="Heading 1">
          <Heading1 className="w-3.5 h-3.5" />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} isActive={editor.isActive('heading', { level: 2 })} title="Heading 2">
          <Heading2 className="w-3.5 h-3.5" />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} isActive={editor.isActive('heading', { level: 3 })} title="Heading 3">
          <Heading3 className="w-3.5 h-3.5" />
        </MenuButton>

        <MenuDivider />

        {/* Lists */}
        <MenuButton onClick={() => editor.chain().focus().toggleBulletList().run()} isActive={editor.isActive('bulletList')} title="Listë me pika">
          <List className="w-3.5 h-3.5" />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleOrderedList().run()} isActive={editor.isActive('orderedList')} title="Listë me numra">
          <ListOrdered className="w-3.5 h-3.5" />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleTaskList().run()} isActive={editor.isActive('taskList')} title="Checklist">
          <ListChecks className="w-3.5 h-3.5" />
        </MenuButton>

        <MenuDivider />

        {/* Block elements */}
        <MenuButton onClick={() => editor.chain().focus().toggleBlockquote().run()} isActive={editor.isActive('blockquote')} title="Citim">
          <Quote className="w-3.5 h-3.5" />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Vijë ndarëse">
          <Minus className="w-3.5 h-3.5" />
        </MenuButton>

        <MenuDivider />

        {/* Alignment */}
        <MenuButton onClick={() => editor.chain().focus().setTextAlign('left').run()} isActive={editor.isActive({ textAlign: 'left' })} title="Majtas">
          <AlignLeft className="w-3.5 h-3.5" />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().setTextAlign('center').run()} isActive={editor.isActive({ textAlign: 'center' })} title="Qendër">
          <AlignCenter className="w-3.5 h-3.5" />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().setTextAlign('right').run()} isActive={editor.isActive({ textAlign: 'right' })} title="Djathtas">
          <AlignRight className="w-3.5 h-3.5" />
        </MenuButton>

        <MenuDivider />

        {/* Link */}
        <MenuButton onClick={setLink} isActive={editor.isActive('link')} title="Link">
          <LinkIcon className="w-3.5 h-3.5" />
        </MenuButton>

        {/* Image */}
        <MenuButton onClick={onPickImage} disabled={uploading} title={uploading ? 'Po ngarkohet…' : 'Shto imazh'}>
          <ImageIcon className="w-3.5 h-3.5" />
        </MenuButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          className="hidden"
          onChange={onImageInputChange}
        />

        {/* Clear formatting */}
        <MenuButton onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()} title="Pastro formatin">
          <RemoveFormatting className="w-3.5 h-3.5" />
        </MenuButton>
      </div>

      {/* Editor content */}
      <div className="px-3 py-2">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};

// Read-only renderer for displaying rich text content
export const RichTextDisplay: React.FC<{ content: string; className?: string }> = ({ content, className }) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        underline: false,
        link: false,
      }),
      Underline,
      Image.configure({ inline: false, allowBase64: false, HTMLAttributes: { class: 'max-w-full h-auto rounded-md my-2' } }),
      Link.configure({ openOnClick: true, HTMLAttributes: { class: 'text-primary underline cursor-pointer', target: '_blank', rel: 'noopener noreferrer' } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight,
      TaskList,
      TaskItem,
      TextStyle,
      Color,
    ],
    content,
    editable: false,
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none',
      },
    },
  });

  if (!editor) return null;
  return (
    <div className={cn('rich-text-display', className)}>
      <EditorContent editor={editor} />
    </div>
  );
};

export default RichTextEditor;
