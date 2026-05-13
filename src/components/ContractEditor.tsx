import React, { forwardRef, useImperativeHandle, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Italic, Underline as ULIcon, Strikethrough,
  Heading1, Heading2, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight,
  Highlighter, Undo2, Redo2, Minus,
} from 'lucide-react';
import { cn } from '../lib/utils';

export interface ContractEditorHandle {
  insertContent: (html: string) => void;
  setContent: (html: string) => void;
}

interface Props {
  content: string;
  onChange: (html: string) => void;
  minHeight?: string;
}

const ContractEditor = forwardRef<ContractEditorHandle, Props>(
  ({ content, onChange, minHeight = '100%' }, ref) => {
    const editor = useEditor({
      extensions: [
        StarterKit,
        Underline,
        TextStyle,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Highlight,
        Placeholder.configure({ placeholder: 'Shkruani tekstin e kontratës...' }),
      ],
      content,
      onUpdate: ({ editor }) => onChange(editor.getHTML()),
      editorProps: {
        attributes: { class: 'contract-body outline-none p-4' },
      },
    });

    useImperativeHandle(ref, () => ({
      insertContent: (html) => editor?.chain().focus().insertContent(html).run(),
      setContent: (html) => editor?.commands.setContent(html),
    }), [editor]);

    // Sync external content changes (e.g. template applied, quote selected)
    // Track the last content we set so we don't fight with the user's own typing
    const lastExternalContent = useRef(content);
    useEffect(() => {
      if (!editor || content === lastExternalContent.current) return;
      lastExternalContent.current = content;
      if (content !== editor.getHTML()) {
        editor.commands.setContent(content);
      }
    }, [content, editor]);

    if (!editor) return null;

    const TB = ({
      onClick, active, title, children,
    }: { onClick: () => void; active?: boolean; title: string; children: React.ReactNode }) => (
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); onClick(); }}
        title={title}
        className={cn(
          'p-1.5 rounded hover:bg-muted/80 transition-colors',
          active && 'bg-primary/10 text-primary',
        )}
      >
        {children}
      </button>
    );

    const Sep = () => <div className="w-px h-4 bg-border mx-0.5 shrink-0" />;

    return (
      <div className="border rounded-lg overflow-hidden bg-white flex flex-col h-full">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b bg-muted/30 shrink-0">
          <TB onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
            <Bold className="w-3.5 h-3.5" />
          </TB>
          <TB onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
            <Italic className="w-3.5 h-3.5" />
          </TB>
          <TB onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline">
            <ULIcon className="w-3.5 h-3.5" />
          </TB>
          <TB onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strike">
            <Strikethrough className="w-3.5 h-3.5" />
          </TB>
          <Sep />
          <TB onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Titull i madh">
            <Heading1 className="w-3.5 h-3.5" />
          </TB>
          <TB onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Titull i mesëm">
            <Heading2 className="w-3.5 h-3.5" />
          </TB>
          <Sep />
          <TB onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Listë me pika">
            <List className="w-3.5 h-3.5" />
          </TB>
          <TB onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Listë me numra">
            <ListOrdered className="w-3.5 h-3.5" />
          </TB>
          <Sep />
          <TB onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Majtas">
            <AlignLeft className="w-3.5 h-3.5" />
          </TB>
          <TB onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Qendër">
            <AlignCenter className="w-3.5 h-3.5" />
          </TB>
          <TB onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Djathtas">
            <AlignRight className="w-3.5 h-3.5" />
          </TB>
          <Sep />
          <TB onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive('highlight')} title="Thekso">
            <Highlighter className="w-3.5 h-3.5" />
          </TB>
          <TB onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Vijë ndarëse">
            <Minus className="w-3.5 h-3.5" />
          </TB>
          <Sep />
          <TB onClick={() => editor.chain().focus().undo().run()} title="Zhbëj (Ctrl+Z)">
            <Undo2 className="w-3.5 h-3.5" />
          </TB>
          <TB onClick={() => editor.chain().focus().redo().run()} title="Ribëj (Ctrl+Y)">
            <Redo2 className="w-3.5 h-3.5" />
          </TB>
        </div>

        {/* Editor content */}
        <EditorContent
          editor={editor}
          className="flex-1 overflow-y-auto"
          style={{ minHeight }}
        />
      </div>
    );
  },
);

ContractEditor.displayName = 'ContractEditor';
export default ContractEditor;
