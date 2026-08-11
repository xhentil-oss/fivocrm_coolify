import { describe, it, expect } from 'vitest';
import { plainTextToHtml, normalizeToHtml, hasBlockStructure, htmlForPastedText } from './richText';

// The message that exposed the bug: section headings on their own lines,
// paragraphs separated by blank lines.
const WHATSAPP = `WELCOME TO SO CLASSY

OUR STORY

Founded in 2020 by Agnesa Neziri, So Classy was born from a vision.

What began as a creative vision has evolved into a growing fashion brand.`;

describe('plainTextToHtml', () => {
  it('turns each blank-line-separated block into its own paragraph', () => {
    const html = plainTextToHtml(WHATSAPP);
    expect(html.match(/<p>/g)).toHaveLength(4);
    expect(html).toContain('<p>WELCOME TO SO CLASSY</p>');
    expect(html).toContain('<p>OUR STORY</p>');
  });

  it('keeps a single newline as a line break inside the paragraph', () => {
    expect(plainTextToHtml('She is confident.\nShe is feminine.'))
      .toBe('<p>She is confident.<br>She is feminine.</p>');
  });

  it('collapses runs of blank lines instead of emitting empty paragraphs', () => {
    expect(plainTextToHtml('A\n\n\n\nB')).toBe('<p>A</p><p>B</p>');
  });

  it('normalises CRLF from Windows clipboards', () => {
    expect(plainTextToHtml('A\r\n\r\nB')).toBe('<p>A</p><p>B</p>');
  });

  it('escapes HTML so pasted text can never inject markup', () => {
    expect(plainTextToHtml('<img src=x onerror=alert(1)>'))
      .toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });

  it('returns an empty paragraph for empty input', () => {
    expect(plainTextToHtml('')).toBe('<p></p>');
    expect(plainTextToHtml('\n\n')).toBe('<p></p>');
  });
});

describe('normalizeToHtml', () => {
  it('leaves stored HTML untouched', () => {
    const html = '<h3>Titulli</h3><p>Teksti</p>';
    expect(normalizeToHtml(html)).toBe(html);
  });

  it('converts stored plain text (api/landing.ts joins lines with \\n)', () => {
    const stored = 'Lead i ri nga faqja SEO.\nEmail: a@b.com\nTelefon: 067';
    expect(normalizeToHtml(stored))
      .toBe('<p>Lead i ri nga faqja SEO.<br>Email: a@b.com<br>Telefon: 067</p>');
  });

  it('handles null/undefined/empty', () => {
    expect(normalizeToHtml(null)).toBe('');
    expect(normalizeToHtml(undefined)).toBe('');
    expect(normalizeToHtml('')).toBe('');
  });
});

describe('hasBlockStructure', () => {
  it('recognises real block markup', () => {
    expect(hasBlockStructure('<p>a</p>')).toBe(true);
    expect(hasBlockStructure('<div>a</div>')).toBe(true);
    expect(hasBlockStructure('a<br>b')).toBe(true);
    expect(hasBlockStructure('<ul><li>a</li></ul>')).toBe(true);
  });

  it('does not mistake inline-only markup for structure', () => {
    expect(hasBlockStructure('<span style="x">a\nb</span>')).toBe(false);
    expect(hasBlockStructure('<b>a</b>')).toBe(false);
    expect(hasBlockStructure('')).toBe(false);
  });
});

describe('htmlForPastedText', () => {
  it('rebuilds paragraphs when the clipboard HTML is structure-less', () => {
    const out = htmlForPastedText(WHATSAPP, '<span>WELCOME TO SO CLASSY\n\nOUR STORY</span>');
    expect(out).not.toBeNull();
    expect(out!.match(/<p>/g)).toHaveLength(4);
  });

  it('rebuilds paragraphs when there is no clipboard HTML at all', () => {
    expect(htmlForPastedText('A\n\nB', '')).toBe('<p>A</p><p>B</p>');
  });

  it('defers to the editor when the HTML already has structure', () => {
    expect(htmlForPastedText('A\n\nB', '<p>A</p><p>B</p>')).toBeNull();
  });

  it('defers for single-line text — nothing to preserve', () => {
    expect(htmlForPastedText('just one line', '')).toBeNull();
  });
});
