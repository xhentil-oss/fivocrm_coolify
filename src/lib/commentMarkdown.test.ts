import { describe, expect, it } from 'vitest';
import {
  commentMentionUids,
  commentToHtml,
  commentToPlainText,
  docToComment,
  parseComment,
  parseInline,
  type PMNode,
} from './commentMarkdown';

const p = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const t = (text: string, ...marks: string[]): PMNode => ({ type: 'text', text, marks: marks.map(type => ({ type })) });
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });

describe('parseInline', () => {
  it('keeps legacy plain text untouched', () => {
    expect(parseInline('Përshëndetje, si je?')).toEqual([{ t: 'text', v: 'Përshëndetje, si je?' }]);
  });

  it('parses marks, mentions and links', () => {
    expect(parseInline('**a** *b* ~~c~~ `d` @[Ana Koci](u1) [x](https://x.al)')).toEqual([
      { t: 'b', c: [{ t: 'text', v: 'a' }] },
      { t: 'text', v: ' ' },
      { t: 'i', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 's', c: [{ t: 'text', v: 'c' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'd' },
      { t: 'text', v: ' ' },
      { t: 'mention', name: 'Ana Koci', uid: 'u1' },
      { t: 'text', v: ' ' },
      { t: 'link', href: 'https://x.al', c: [{ t: 'text', v: 'x' }] },
    ]);
  });

  it('does not treat arithmetic or e-mail addresses as markup', () => {
    expect(parseInline('2*3*4')).toEqual([{ t: 'text', v: '2*3*4' }]);
    expect(parseInline('ana@fivo.al')).toEqual([{ t: 'text', v: 'ana@fivo.al' }]);
  });

  it('leaves sentence punctuation outside a bare URL', () => {
    expect(parseInline('Shiko https://fivo.al/a.')).toEqual([
      { t: 'text', v: 'Shiko ' },
      { t: 'url', href: 'https://fivo.al/a' },
      { t: 'text', v: '.' },
    ]);
  });

  it('never makes a javascript: link', () => {
    expect(parseInline('[x](javascript:alert(1))').some(n => n.t === 'link')).toBe(false);
  });
});

describe('parseComment', () => {
  it('builds nested lists and checklists', () => {
    const blocks = parseComment('Hapat:\n- një\n  - nën\n- [x] bërë\n1. a\n2. b');
    expect(blocks[0].t).toBe('line');
    const bullets = blocks[1] as any;
    expect(bullets.t).toBe('list');
    expect(bullets.ordered).toBe(false);
    expect(bullets.items[0].children[0].items[0].c).toEqual([{ t: 'text', v: 'nën' }]);
    expect(bullets.items[1].checked).toBe(true);
    const numbers = blocks[2] as any;
    expect(numbers.ordered).toBe(true);
    expect(numbers.items).toHaveLength(2);
  });

  it('parses quotes and code fences', () => {
    const blocks = parseComment('> citim\n```\nconst a = 1;\n```');
    expect(blocks[0].t).toBe('quote');
    expect(blocks[1]).toEqual({ t: 'codeblock', v: 'const a = 1;' });
  });
});

describe('docToComment (editor → stored text)', () => {
  it('serialises marks with whitespace outside the markers', () => {
    expect(docToComment(doc(p(t('shumë ', 'bold'), t('e rëndësishme'))))).toBe('**shumë** e rëndësishme');
  });

  it('keeps one marker open across adjacent nodes', () => {
    expect(docToComment(doc(p(t('a', 'bold'), t('b', 'bold', 'italic'))))).toBe('**a*b***');
    expect(parseInline('**a*b***')).toEqual([{ t: 'b', c: [{ t: 'text', v: 'a' }, { t: 'i', c: [{ t: 'text', v: 'b' }] }] }]);
  });

  it('serialises lists, checklists, mentions and images', () => {
    const json = doc(
      p(t('Për '), { type: 'mention', attrs: { id: 'u1', label: 'Ana' } }),
      { type: 'bulletList', content: [
        { type: 'listItem', content: [p(t('një')), { type: 'orderedList', attrs: { start: 1 }, content: [
          { type: 'listItem', content: [p(t('nën'))] },
        ] }] },
      ] },
      { type: 'taskList', content: [
        { type: 'taskItem', attrs: { checked: true }, content: [p(t('bërë'))] },
        { type: 'taskItem', attrs: { checked: false }, content: [p(t('pa bërë'))] },
      ] },
      { type: 'image', attrs: { src: 'https://vps.fivocrm.com/f/a.png' } },
    );
    expect(docToComment(json)).toBe(
      'Për @[Ana](u1)\n- një\n  1. nën\n- [x] bërë\n- [ ] pa bërë\nhttps://vps.fivocrm.com/f/a.png',
    );
  });

  it('round-trips through the editor HTML', () => {
    const src = '**Hapat**\n- [ ] dërgo ofertën\n- [x] telefono @[Ana](u1)\n> shënim';
    const html = commentToHtml(src);
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-type="mention" data-id="u1"');
    expect(html).toContain('<blockquote>');
  });

  it('escapes HTML when loading into the editor', () => {
    expect(commentToHtml('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });
});

describe('plain text + mentions', () => {
  it('reads like a message', () => {
    expect(commentToPlainText('**Ok** @[Ana](u1)\n- [ ] a\n1. b')).toBe('Ok @Ana\n☐ a\n1. b');
  });

  it('collects mention uids', () => {
    expect(commentMentionUids('@[Ana](u1) dhe @[Beni](u2) @[Ana](u1)')).toEqual(['u1', 'u2']);
  });
});
