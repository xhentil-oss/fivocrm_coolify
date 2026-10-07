/**
 * Comment text format — a small, safe Markdown subset.
 *
 * Task comments are written by the rich composer (`CommentEditor`, Tiptap) but
 * STORED as text, not HTML, on purpose: the same `content` is read raw by the
 * client portal, by every notification preview and by the cron's backfills. A
 * Markdown line like `- [ ] dërgo ofertën` still reads correctly there; an HTML
 * blob would not — and HTML from a user would need sanitising on every surface.
 *
 * Supported (everything else is plain text, so every legacy comment renders as
 * before):
 *   blocks  — one line = one line; `- ` / `* ` bullets, `1. ` numbers, `- [ ] `
 *             / `- [x] ` checklist (nesting by indentation), `> ` quote, ``` code
 *   inline  — `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[text](url)`,
 *             bare URLs (image URLs render as pictures), `@[Name](uid)` mentions
 *             and the legacy `@uid` form.
 *
 * Rendering never goes through innerHTML: `CommentBody` builds React nodes from
 * the AST below, and `commentToHtml` (the editor's load path) escapes every text.
 */

// ── AST ──────────────────────────────────────────────────────────────────────

export type CommentInline =
  | { t: 'text'; v: string }
  | { t: 'b' | 'i' | 's'; c: CommentInline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: CommentInline[] }
  | { t: 'url'; href: string }
  | { t: 'mention'; name: string; uid: string }
  | { t: 'legacyMention'; v: string };

export interface CommentListItem {
  /** null = plain bullet/number, boolean = checklist item */
  checked: boolean | null;
  c: CommentInline[];
  children: CommentBlock[];
}

export type CommentBlock =
  | { t: 'line'; c: CommentInline[] }
  | { t: 'blank' }
  | { t: 'list'; ordered: boolean; start: number; items: CommentListItem[] }
  | { t: 'quote'; c: CommentBlock[] }
  | { t: 'codeblock'; v: string };

// ── Inline parsing ───────────────────────────────────────────────────────────

const SAFE_HREF_RE = /^(https?:\/\/|mailto:)/i;
const TRAILING_PUNCT_RE = /[.,;:!?'")\]]+$/;
const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;

/** One alternation, tried left to right at every position. */
const INLINE_RE = new RegExp(
  [
    /@\[([^\]\n]+)\]\(([^)\s]+)\)/.source,                       // 1,2 mention
    /`([^`\n]+)`/.source,                                         // 3 code
    /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/.source,  // 4,5 link
    /\*\*(\S(?:[^\n]*?\S)?)\*\*(?!\*)/.source,                     // 6 bold
    /~~(\S(?:[^\n]*?\S)?)~~/.source,                              // 7 strike
    /\*(\S(?:[^*\n]*?\S)?)\*/.source,                             // 8 italic
    /(https?:\/\/[^\s<>]+)/.source,                               // 9 url
    /@([^\s@[\]()]+)/.source,                                     // 10 legacy mention
  ].join('|'),
  'g',
);

export function parseInline(src: string): CommentInline[] {
  const out: CommentInline[] = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  const re = new RegExp(INLINE_RE.source, 'g');
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const at = m.index;
    const prev = at > 0 ? src[at - 1] : '';
    // `2*3*4` is arithmetic and `ana@fivo.al` an address, not italic / a mention.
    // (Italic may follow a letter: the editor writes `**a*b***` for "a" bold +
    // "b" bold-italic.)
    if (prev && ((m[8] !== undefined && /\p{N}/u.test(prev)) || (m[10] !== undefined && WORD_CHAR_RE.test(prev)))) {
      buf += src.slice(pos, at + 1);
      pos = at + 1;
      re.lastIndex = at + 1;
      continue;
    }
    buf += src.slice(pos, at);
    pos = at + m[0].length;
    if (m[1] !== undefined) { flush(); out.push({ t: 'mention', name: m[1], uid: m[2] }); }
    else if (m[3] !== undefined) { flush(); out.push({ t: 'code', v: m[3] }); }
    else if (m[4] !== undefined) { flush(); out.push({ t: 'link', href: m[5], c: parseInline(m[4]) }); }
    else if (m[6] !== undefined) { flush(); out.push({ t: 'b', c: parseInline(m[6]) }); }
    else if (m[7] !== undefined) { flush(); out.push({ t: 's', c: parseInline(m[7]) }); }
    else if (m[8] !== undefined) { flush(); out.push({ t: 'i', c: parseInline(m[8]) }); }
    else if (m[9] !== undefined) {
      // "Shiko https://x.al/a." — the full stop belongs to the sentence.
      const trail = m[9].match(TRAILING_PUNCT_RE)?.[0] || '';
      const href = trail ? m[9].slice(0, -trail.length) : m[9];
      flush();
      out.push({ t: 'url', href });
      buf += trail;
    } else if (m[10] !== undefined) { flush(); out.push({ t: 'legacyMention', v: m[10] }); }
  }
  buf += src.slice(pos);
  flush();
  return out;
}

// ── Block parsing ────────────────────────────────────────────────────────────

const LIST_RE = /^(\s*)([-*•]|\d{1,4}[.)])\s+(.*)$/;
const CHECK_RE = /^\[( |x|X)\]\s+(.*)$/;
const FENCE_RE = /^\s*```/;
const QUOTE_RE = /^\s*>\s?(.*)$/;

const indentOf = (s: string) => s.replace(/\t/g, '    ').length;

interface RawItem { indent: number; ordered: boolean; num: number; checked: boolean | null; text: string; extra: string[] }

function buildLists(items: RawItem[]): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  let i = 0;
  const build = (indent: number): CommentBlock => {
    const first = items[i];
    const list: Extract<CommentBlock, { t: 'list' }> = { t: 'list', ordered: first.ordered, start: first.ordered ? first.num : 1, items: [] };
    while (i < items.length) {
      const it = items[i];
      if (it.indent < indent) break;
      if (it.indent > indent && list.items.length > 0) {
        list.items[list.items.length - 1].children.push(build(it.indent));
        continue;
      }
      if (it.ordered !== list.ordered && list.items.length > 0) break;
      list.items.push({
        checked: it.checked,
        c: parseInline([it.text, ...it.extra].join(' ')),
        children: [],
      });
      i++;
    }
    return list;
  };
  while (i < items.length) blocks.push(build(items[i].indent));
  return blocks;
}

export function parseComment(src: string | null | undefined): CommentBlock[] {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: CommentBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (FENCE_RE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (or EOF)
      blocks.push({ t: 'codeblock', v: body.join('\n') });
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) body.push(lines[i++].match(QUOTE_RE)![1]);
      blocks.push({ t: 'quote', c: parseComment(body.join('\n')) });
      continue;
    }

    if (LIST_RE.test(line)) {
      const items: RawItem[] = [];
      while (i < lines.length) {
        const lm = lines[i].match(LIST_RE);
        if (lm) {
          const marker = lm[2];
          const ordered = /\d/.test(marker);
          const cm = !ordered ? lm[3].match(CHECK_RE) : null;
          items.push({
            indent: indentOf(lm[1]),
            ordered,
            num: ordered ? parseInt(marker, 10) : 0,
            checked: cm ? cm[1] !== ' ' : null,
            text: cm ? cm[2] : lm[3],
            extra: [],
          });
          i++;
          continue;
        }
        // An indented continuation line belongs to the previous item.
        const cont = lines[i];
        if (cont.trim() && items.length && indentOf(cont.match(/^\s*/)![0]) > items[items.length - 1].indent) {
          items[items.length - 1].extra.push(cont.trim());
          i++;
          continue;
        }
        break;
      }
      blocks.push(...buildLists(items));
      continue;
    }

    blocks.push(line.trim() === '' ? { t: 'blank' } : { t: 'line', c: parseInline(line) });
    i++;
  }
  // Leading/trailing blank lines are noise in a bubble.
  while (blocks[0]?.t === 'blank') blocks.shift();
  while (blocks[blocks.length - 1]?.t === 'blank') blocks.pop();
  return blocks;
}

// ── Helpers shared by the renderers ──────────────────────────────────────────

export const isImageUrl = (url: string) =>
  /\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(url) || /firebasestorage\.googleapis\.com|firebasestorage\.app/i.test(url);

export const isSafeHref = (href: string) => SAFE_HREF_RE.test(href);

/** A line that is nothing but one image URL renders as a picture block. */
export function soleImageUrl(c: CommentInline[]): string | null {
  const meaningful = c.filter(n => !(n.t === 'text' && !n.v.trim()));
  return meaningful.length === 1 && meaningful[0].t === 'url' && isImageUrl(meaningful[0].href) ? meaningful[0].href : null;
}

// ── → plain text (notifications, previews) ───────────────────────────────────

function inlineToPlain(c: CommentInline[]): string {
  return c.map(n => {
    switch (n.t) {
      case 'text': case 'code': return n.v;
      case 'b': case 'i': case 's': return inlineToPlain(n.c);
      case 'link': return inlineToPlain(n.c);
      case 'url': return isImageUrl(n.href) ? '🖼️' : n.href;
      case 'mention': return `@${n.name}`;
      case 'legacyMention': return `@${n.v}`;
    }
  }).join('');
}

function blocksToPlain(blocks: CommentBlock[], indent = ''): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.t === 'line') out.push(indent + inlineToPlain(b.c));
    else if (b.t === 'blank') out.push('');
    else if (b.t === 'codeblock') out.push(...b.v.split('\n').map(l => indent + l));
    else if (b.t === 'quote') out.push(...blocksToPlain(b.c, indent).map(l => `“${l}”`));
    else b.items.forEach((it, idx) => {
      const marker = it.checked === true ? '☑' : it.checked === false ? '☐' : b.ordered ? `${b.start + idx}.` : '•';
      out.push(`${indent}${marker} ${inlineToPlain(it.c)}`);
      out.push(...blocksToPlain(it.children, indent + '  '));
    });
  }
  return out;
}

/** Human-readable text of a comment — markers stripped, mentions as `@Name`. */
export function commentToPlainText(src: string | null | undefined): string {
  return blocksToPlain(parseComment(src)).join('\n').trim();
}

/** Every uid mentioned with the `@[Name](uid)` form. */
export function commentMentionUids(src: string | null | undefined): string[] {
  const out = new Set<string>();
  const re = /@\[[^\]\n]+\]\(([^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(src ?? ''))) !== null) out.add(m[1]);
  return [...out];
}

// ── → HTML (only to LOAD a stored comment into the Tiptap editor) ────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inlineToHtml(c: CommentInline[]): string {
  return c.map(n => {
    switch (n.t) {
      case 'text': return esc(n.v);
      case 'code': return `<code>${esc(n.v)}</code>`;
      case 'b': return `<strong>${inlineToHtml(n.c)}</strong>`;
      case 'i': return `<em>${inlineToHtml(n.c)}</em>`;
      case 's': return `<s>${inlineToHtml(n.c)}</s>`;
      case 'link': return isSafeHref(n.href) ? `<a href="${esc(n.href)}">${inlineToHtml(n.c)}</a>` : inlineToHtml(n.c);
      case 'url': return `<a href="${esc(n.href)}">${esc(n.href)}</a>`;
      case 'mention': return `<span data-type="mention" data-id="${esc(n.uid)}" data-label="${esc(n.name)}">@${esc(n.name)}</span>`;
      case 'legacyMention': return esc(`@${n.v}`);
    }
  }).join('');
}

function blocksToHtml(blocks: CommentBlock[]): string {
  return blocks.map(b => {
    if (b.t === 'blank') return '<p></p>';
    if (b.t === 'line') {
      const img = soleImageUrl(b.c);
      return img ? `<img src="${esc(img)}">` : `<p>${inlineToHtml(b.c)}</p>`;
    }
    if (b.t === 'codeblock') return `<pre><code>${esc(b.v)}</code></pre>`;
    if (b.t === 'quote') return `<blockquote>${blocksToHtml(b.c) || '<p></p>'}</blockquote>`;
    const isTask = b.items.length > 0 && b.items.every(it => it.checked !== null);
    if (isTask) {
      return `<ul data-type="taskList">${b.items.map(it =>
        `<li data-type="taskItem" data-checked="${it.checked ? 'true' : 'false'}"><p>${inlineToHtml(it.c)}</p>${blocksToHtml(it.children)}</li>`,
      ).join('')}</ul>`;
    }
    const tag = b.ordered ? 'ol' : 'ul';
    const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
    return `<${tag}${start}>${b.items.map(it => `<li><p>${inlineToHtml(it.c)}</p>${blocksToHtml(it.children)}</li>`).join('')}</${tag}>`;
  }).join('');
}

export function commentToHtml(src: string | null | undefined): string {
  return blocksToHtml(parseComment(src)) || '<p></p>';
}

// ── Tiptap JSON → stored text ────────────────────────────────────────────────

export interface PMNode {
  type: string;
  text?: string;
  attrs?: Record<string, any>;
  marks?: { type: string; attrs?: Record<string, any> }[];
  content?: PMNode[];
}

const MARK_ORDER = ['link', 'bold', 'italic', 'strike'] as const;
type OpenMark = { type: (typeof MARK_ORDER)[number]; href?: string };
const sameMark = (a: OpenMark, b: OpenMark) => a.type === b.type && (a.type !== 'link' || a.href === b.href);
const opener = (m: OpenMark) => (m.type === 'link' ? '[' : m.type === 'bold' ? '**' : m.type === 'italic' ? '*' : '~~');
const closer = (m: OpenMark) => (m.type === 'link' ? `](${m.href})` : opener(m));

/** Inline content → Markdown, keeping marks open across adjacent text nodes and
 *  whitespace OUTSIDE the markers (`** x**` would not parse back as bold). */
function serializeInline(nodes: PMNode[] = []): string {
  let out = '';
  let stack: OpenMark[] = [];
  const closeTo = (keep: number) => {
    if (stack.length <= keep) return;
    const ws = out.match(/\s+$/)?.[0] || '';
    if (ws) out = out.slice(0, -ws.length);
    for (let k = stack.length - 1; k >= keep; k--) out += closer(stack[k]);
    out += ws;
    stack = stack.slice(0, keep);
  };
  for (const n of nodes) {
    if (n.type === 'hardBreak') { closeTo(0); out += '\n'; continue; }
    if (n.type === 'mention') { closeTo(0); out += `@[${n.attrs?.label ?? ''}](${n.attrs?.id ?? ''})`; continue; }
    if (n.type !== 'text' || !n.text) continue;
    const marks = n.marks || [];
    const link = marks.find(m => m.type === 'link');
    const href = link?.attrs?.href as string | undefined;
    if (marks.some(m => m.type === 'code')) { closeTo(0); out += '`' + n.text.replace(/`/g, "'") + '`'; continue; }
    // A link whose text IS its address is stored bare — it reads better raw.
    if (href && n.text === href && marks.length === 1) { closeTo(0); out += href; continue; }
    const wanted: OpenMark[] = MARK_ORDER
      .filter(t => marks.some(m => m.type === t) && (t !== 'link' || (href && isSafeHref(href))))
      .map(t => (t === 'link' ? { type: t, href } : { type: t }));
    let keep = 0;
    while (keep < stack.length && keep < wanted.length && sameMark(stack[keep], wanted[keep])) keep++;
    // Anything still open that this node does not carry must close first.
    closeTo(keep);
    const toOpen = wanted.slice(keep);
    if (toOpen.length) {
      const lead = n.text.match(/^\s+/)?.[0] || '';
      out += lead + toOpen.map(opener).join('') + n.text.slice(lead.length);
      stack = [...stack, ...toOpen];
    } else {
      out += n.text;
    }
  }
  closeTo(0);
  return out;
}

function serializeBlocks(nodes: PMNode[] = [], indent = ''): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case 'paragraph':
      case 'heading': {
        const text = serializeInline(n.content);
        out.push(...(text ? text.split('\n').map(l => indent + l) : ['']));
        break;
      }
      case 'image':
        if (n.attrs?.src) out.push(indent + n.attrs.src);
        break;
      case 'codeBlock': {
        const text = (n.content || []).map(c => c.text || '').join('');
        out.push(indent + '```', ...text.split('\n').map(l => indent + l), indent + '```');
        break;
      }
      case 'blockquote':
        out.push(...serializeBlocks(n.content).map(l => `${indent}> ${l}`.replace(/\s+$/, '')));
        break;
      case 'bulletList':
      case 'orderedList':
      case 'taskList': {
        let num = n.type === 'orderedList' ? Number(n.attrs?.start ?? 1) || 1 : 0;
        for (const item of n.content || []) {
          const marker = n.type === 'orderedList' ? `${num++}.` : n.type === 'taskList' ? `- [${item.attrs?.checked ? 'x' : ' '}]` : '-';
          const childIndent = indent + ' '.repeat(n.type === 'orderedList' ? 3 : 2);
          const [first, ...rest] = item.content || [];
          const firstText = first && (first.type === 'paragraph' || first.type === 'heading')
            ? serializeInline(first.content).replace(/\n/g, ' ')
            : '';
          out.push(`${indent}${marker} ${firstText}`.replace(/\s+$/, marker.endsWith(']') ? ' ' : ''));
          const restNodes = first && (first.type === 'paragraph' || first.type === 'heading') ? rest : item.content || [];
          out.push(...serializeBlocks(restNodes, childIndent));
        }
        break;
      }
      default:
        if (n.content) out.push(...serializeBlocks(n.content, indent));
    }
  }
  return out;
}

/** Tiptap `editor.getJSON()` → the stored comment text. */
export function docToComment(doc: PMNode): string {
  return serializeBlocks(doc.content)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*\n+/, '')
    .replace(/\s+$/, '');
}
