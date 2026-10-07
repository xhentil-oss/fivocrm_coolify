import { describe, expect, it } from 'vitest';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Editor, Node, mergeAttributes } from '@tiptap/react';
import { commentToHtml, docToComment } from '../../lib/commentMarkdown';

// Same schema as CommentEditor — the stored text must survive load → save untouched,
// or every "Edito" would silently rewrite the comment.
const Mention = Node.create({
  name: 'mention', group: 'inline', inline: true, atom: true,
  addAttributes() {
    return {
      id: { default: null, parseHTML: el => el.getAttribute('data-id'), renderHTML: a => ({ 'data-id': a.id }) },
      label: { default: '', parseHTML: el => el.getAttribute('data-label'), renderHTML: a => ({ 'data-label': a.label }) },
    };
  },
  parseHTML() { return [{ tag: 'span[data-type="mention"]' }]; },
  renderHTML({ node, HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'mention' }), `@${node.attrs.label}`]; },
});

const roundTrip = (src: string) => {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ heading: false, horizontalRule: false, underline: false, link: false }),
      Link.configure({ openOnClick: false }), Image, TaskList, TaskItem.configure({ nested: true }), Mention,
    ],
    content: commentToHtml(src),
  });
  const out = docToComment(editor.getJSON() as any);
  editor.destroy();
  return out;
};

describe('comment editor round-trip', () => {
  it.each([
    'Përshëndetje, si je?',
    'Rreshti 1\nRreshti 2\n\nParagraf i ri',
    '**E trashë** dhe *kursiv* dhe ~~e vizatuar~~ dhe `kod`',
    'Për @[Ana Koci](u1): shiko [ofertën](https://fivo.al/oferta)',
    'Hapat:\n- një\n  - nën\n- dy\n1. a\n2. b',
    '- [ ] dërgo ofertën\n- [x] telefono klientin',
    '> citim i shkurtër\nPas citimit',
    '```\nconst a = 1;\n```',
    'https://fivo.al dhe imazhi:\nhttps://vps.fivocrm.com/f/a.png',
  ])('%s', src => {
    expect(roundTrip(src)).toBe(src);
  });
});
