/**
 * Plain-text ⇄ HTML helpers for the rich-text editor.
 *
 * Pasting text copied from WhatsApp (or any chat app) used to collapse into a
 * single glued paragraph. Two separate causes:
 *
 *  1. The clipboard often carries a `text/html` flavour that has NO block
 *     structure — one <span> whose newlines are plain \n characters. HTML
 *     collapses those to spaces, so ProseMirror parsed the whole message as one
 *     paragraph. Its built-in plain-text splitter never ran, because it only
 *     applies when there is no HTML at all.
 *  2. Descriptions written by the server (api/landing.ts joins its lines with
 *     '\n') are stored as PLAIN text. Feeding that straight to TipTap as
 *     `content` had the same effect — and re-saving through the editor then
 *     destroyed the newlines permanently.
 */

/** Tags that mean the pasted HTML already carries real block structure. */
const HTML_BLOCK_RE = /<(p|div|br|li|ul|ol|h[1-6]|table|tr|td|blockquote|pre|section|article)\b/i;

/** Any tag at all — used to tell stored HTML from stored plain text. */
const HTML_TAG_RE = /<[a-z][^>]*>/i;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Turn plain text into HTML that preserves how it looked when it was written:
 * a blank line starts a new paragraph, a single newline is a line break.
 */
export function plainTextToHtml(text: string): string {
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.replace(/\n+$/, ''))
    .filter((block) => block.trim() !== '')
    .map((block) => `<p>${escapeHtml(block).split('\n').join('<br>')}</p>`);
  return blocks.join('') || '<p></p>';
}

/** True when the string already contains markup (so it must not be escaped). */
export function looksLikeHtml(value: string): boolean {
  return HTML_TAG_RE.test(value);
}

/** True when pasted HTML carries block structure worth keeping. */
export function hasBlockStructure(html: string): boolean {
  return HTML_BLOCK_RE.test(html);
}

/**
 * Normalise a stored description for rendering: HTML passes through untouched,
 * plain text is converted so its line breaks survive.
 */
export function normalizeToHtml(value?: string | null): string {
  if (!value) return '';
  return looksLikeHtml(value) ? value : plainTextToHtml(value);
}

/**
 * Decide what to insert for a paste. Returns the HTML to insert, or null to let
 * the editor handle the paste itself (the clipboard HTML is already structured).
 */
export function htmlForPastedText(plain: string, html: string): string | null {
  if (!plain || !/\n/.test(plain)) return null;
  if (html && hasBlockStructure(html)) return null;
  return plainTextToHtml(plain);
}
