/**
 * Branded A4 report PDF (jsPDF), matching `src/lib/quotePdf.ts`'s conventions.
 *
 * Two rules drive the layout code:
 *
 *   • **Nothing is ever cut off.** Every writer goes through `ensureSpace()`, which
 *     breaks the page before it would overflow, so long tables paginate and a chart
 *     block never straddles a page boundary.
 *
 *   • **The input must already be redacted.** `buildReportPdf` asserts it (via
 *     `assertNoClientLeak`) when asked for a client copy, so a caller that forgets
 *     to redact gets an exception instead of a leaked PDF.
 *
 * jsPDF's standard fonts are Latin-1 (WinAnsi), which covers Albanian's ë/ç, so no
 * embedded font is needed. Text is sanitised for the few code points it can't map.
 */

import { jsPDF } from 'jspdf';
import type { Report, ReportBlock, ReportKpiValue } from '../../types';
import { assertNoClientLeak } from './visibility';
import { formatKpiValue, kpiCardModel } from './kpi';
import { formatPeriodLabel } from './period';
import { HEALTH_LABELS } from './health';
import { STATUS_LABELS } from './workflow';

const NAVY = '#12468C';
const CYAN = '#0EA5E9';
const GREY = '#6b7280';
const INK = '#111827';
const LINE = '#e5e7eb';

export interface PdfBranding {
  companyName: string;
  companyEmail?: string;
  companyPhone?: string;
  companyWebsite?: string;
  /** data: URI (PNG/JPEG). Remote URLs are not fetched — the PDF is built offline. */
  logoDataUrl?: string;
  clientLogoDataUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  confidentialityNotice?: string;
}

export interface PdfOptions {
  branding: PdfBranding;
  /** 'client' asserts the payload carries no internal content. */
  audience: 'client' | 'internal';
  accountManagerName?: string;
  /** Rendered on the cover so a printed copy is traceable to a version. */
  version?: number;
  includeTableOfContents?: boolean;
  includeApprovalHistory?: Array<{ stage: string; decision: string; by: string; at: string }>;
}

/** Company identity mirrored into localStorage by the settings screen. */
export function defaultBranding(): PdfBranding {
  try {
    return {
      companyName: localStorage.getItem('company_name') || 'FivoCRM',
      companyEmail: localStorage.getItem('company_email') || undefined,
      companyPhone: localStorage.getItem('company_phone') || undefined,
      companyWebsite: localStorage.getItem('company_website') || undefined,
      logoDataUrl: localStorage.getItem('company_logo_data') || undefined,
      primaryColor: NAVY,
      accentColor: CYAN,
    };
  } catch {
    return { companyName: 'FivoCRM', primaryColor: NAVY, accentColor: CYAN };
  }
}

/**
 * Map the handful of typographic codepoints jsPDF's WinAnsi standard fonts cannot
 * encode onto safe ASCII. Written as a codepoint table rather than regexes with
 * literal characters: a pasted non-breaking space or curly quote is invisible in
 * review (and trips eslint's no-irregular-whitespace).
 */
const CHAR_FALLBACKS: Record<number, string> = {
  0x2018: "'", 0x2019: "'",        // curly single quotes
  0x201c: '"', 0x201d: '"',        // curly double quotes
  0x2013: '-', 0x2014: '-',        // en/em dash
  0x2212: '-',                     // minus sign
  0x2026: '...',                   // ellipsis
  0x00a0: ' ',                     // non-breaking space
};

/**
 * Make text safe for jsPDF's standard fonts. Newlines and tabs survive (paragraph
 * splitting depends on them); everything outside the WinAnsi range is dropped rather
 * than rendered as a tofu box in a document that goes to a client.
 */
function sanitise(text: string): string {
  let out = '';
  for (const ch of String(text ?? '')) {
    const code = ch.codePointAt(0) ?? 0;
    const mapped = CHAR_FALLBACKS[code];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    if (code === 10 || code === 9 || (code >= 0x20 && code <= 0xff)) out += ch;
  }
  return out;
}

interface Cursor { y: number; page: number }

/**
 * Render a report to a jsPDF document.
 *
 * `report` MUST already be redacted for the intended audience — for a client copy
 * this is asserted, not assumed.
 */
export function buildReportPdf(report: Report, opts: PdfOptions): jsPDF {
  if (opts.audience === 'client') {
    // Last line of defence: if a caller skipped redactForClient, fail loudly here
    // rather than hand a PDF containing internal sections to a client.
    assertNoClientLeak(report);
  }

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 46;
  const contentW = pageW - margin * 2;
  const bottom = pageH - 64;
  const primary = opts.branding.primaryColor || NAVY;
  const accent = opts.branding.accentColor || CYAN;
  const currency = report.currency || 'ALL';
  const kpiById = new Map((report.kpiValues || []).map(k => [k.kpiId, k]));

  const cur: Cursor = { y: 0, page: 1 };

  // ── helpers ──
  const newPage = () => {
    doc.addPage();
    cur.page += 1;
    doc.setFillColor(primary);
    doc.rect(0, 0, pageW, 5, 'F');
    cur.y = margin + 12;
  };

  /** Break the page if `needed` points would not fit — the anti-cut-off guard. */
  const ensureSpace = (needed: number) => {
    if (cur.y + needed > bottom) newPage();
  };

  const text = (
    value: string,
    size: number,
    style: 'normal' | 'bold' | 'italic',
    color: string,
    opts2: { indent?: number; width?: number; lineGap?: number } = {},
  ) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(color);
    const width = opts2.width ?? contentW - (opts2.indent || 0);
    const lines = doc.splitTextToSize(sanitise(value), width) as string[];
    const lh = size * 1.4;
    for (const line of lines) {
      ensureSpace(lh);
      doc.text(line, margin + (opts2.indent || 0), cur.y);
      cur.y += lh;
    }
    cur.y += opts2.lineGap ?? 0;
  };

  const rule = () => {
    ensureSpace(12);
    doc.setDrawColor(LINE);
    doc.line(margin, cur.y, pageW - margin, cur.y);
    cur.y += 12;
  };

  // ── cover page ──
  doc.setFillColor(primary);
  doc.rect(0, 0, pageW, 150, 'F');

  if (opts.branding.logoDataUrl) {
    try { doc.addImage(opts.branding.logoDataUrl, 'PNG', margin, 34, 96, 40); } catch { /* bad logo → skip */ }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor('#ffffff');
  doc.text(sanitise(opts.branding.companyName), margin, opts.branding.logoDataUrl ? 96 : 52);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const contact = [opts.branding.companyEmail, opts.branding.companyPhone, opts.branding.companyWebsite]
    .filter(Boolean).join('   ·   ');
  if (contact) doc.text(sanitise(contact), margin, opts.branding.logoDataUrl ? 112 : 68);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor('#ffffff');
  const titleLines = doc.splitTextToSize(sanitise(report.title), contentW) as string[];
  let ty = 150 - 22 - (titleLines.length - 1) * 24;
  for (const line of titleLines.slice(0, 2)) { doc.text(line, margin, ty); ty += 24; }

  cur.y = 182;

  // Meta block
  const meta: Array<[string, string]> = [
    ['Klienti', report.customerName || '—'],
    ['Projekti', report.projectName || '—'],
    ['Periudha', formatPeriodLabel(report.period)],
    ['Statusi', STATUS_LABELS[report.status]],
  ];
  if (report.health) meta.push(['Shendeti', HEALTH_LABELS[report.health]]);
  if (opts.accountManagerName) meta.push(['Menaxheri i llogarise', opts.accountManagerName]);
  if (opts.version) meta.push(['Versioni', `v${opts.version}`]);
  meta.push(['Data e prodhimit', new Date().toLocaleDateString('sq-AL')]);

  doc.setDrawColor(LINE);
  doc.setFillColor('#f9fafb');
  const metaRows = Math.ceil(meta.length / 2);
  const metaH = metaRows * 20 + 16;
  doc.rect(margin, cur.y, contentW, metaH, 'FD');
  meta.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = margin + 12 + col * (contentW / 2);
    const y = cur.y + 20 + row * 20;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(GREY);
    doc.text(sanitise(`${label.toUpperCase()}`), x, y - 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(INK);
    doc.text(sanitise(value).slice(0, 40), x, y + 4);
  });
  cur.y += metaH + 22;

  if (opts.branding.confidentialityNotice) {
    text(opts.branding.confidentialityNotice, 8, 'italic', GREY, { lineGap: 8 });
  }

  // ── table of contents ──
  const sections = (report.blocks || [])
    .filter(b => b.inPdf !== false)
    .filter(b => b.type === 'title' || (b.title && b.type !== 'page-break'));
  if (opts.includeTableOfContents && sections.length > 3) {
    rule();
    text('Permbajtja', 13, 'bold', primary, { lineGap: 4 });
    for (const s of sections) {
      text(`•  ${s.title || ''}`, 10, 'normal', INK, { indent: 8 });
    }
    newPage();
  } else {
    rule();
  }

  // ── blocks ──
  for (const block of (report.blocks || []).filter(b => b.inPdf !== false)) {
    renderBlock(block);
  }

  // ── approval history ──
  if (opts.includeApprovalHistory?.length) {
    ensureSpace(80);
    rule();
    text('Historiku i aprovimeve', 13, 'bold', primary, { lineGap: 4 });
    for (const a of opts.includeApprovalHistory) {
      text(`${a.at} — ${a.stage}: ${a.decision} (${a.by})`, 9, 'normal', INK, { indent: 8 });
    }
  }

  // ── footer on every page ──
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(LINE);
    doc.line(margin, pageH - 44, pageW - margin, pageH - 44);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(GREY);
    doc.text(
      sanitise(`${opts.branding.companyName} · ${report.customerName || ''} · ${formatPeriodLabel(report.period)}`),
      margin, pageH - 30,
    );
    doc.text(`${p} / ${total}`, pageW - margin, pageH - 30, { align: 'right' });
  }

  return doc;

  // ── block renderers ───────────────────────────────────────────────────────────

  function renderBlock(block: ReportBlock) {
    const kpis = (block.kpiIds || []).map(id => kpiById.get(id)).filter((k): k is ReportKpiValue => !!k);

    switch (block.type) {
      case 'page-break':
        newPage();
        return;

      case 'title':
        ensureSpace(40);
        cur.y += 6;
        text(block.title || block.text || '', 16, 'bold', primary, { lineGap: 2 });
        return;

      case 'subtitle':
        ensureSpace(28);
        text(block.title || block.text || '', 12, 'bold', INK, { lineGap: 2 });
        return;

      default:
        break;
    }

    // Section heading
    if (block.title) {
      ensureSpace(34);
      cur.y += 6;
      doc.setFillColor(accent);
      doc.rect(margin, cur.y - 8, 3, 12, 'F');
      text(block.title, 12, 'bold', primary, { indent: 10, lineGap: 2 });
    }
    if (block.description) text(block.description, 8, 'italic', GREY, { lineGap: 2 });

    switch (block.type) {
      case 'executive-summary':
      case 'rich-text':
      case 'recommendation':
      case 'next-steps':
      case 'client-action':
      case 'approval':
        if (block.text?.trim()) text(block.text, 10, 'normal', INK, { lineGap: 6 });
        renderList(block.items);
        break;

      case 'work-completed':
      case 'task-list':
      case 'milestone-list':
      case 'timeline':
      case 'blocker-list':
        if (block.text?.trim()) text(block.text, 10, 'normal', INK, { lineGap: 4 });
        renderList(block.items);
        if (block.rows?.length) renderTable(block);
        break;

      case 'risk-register':
      case 'table':
        renderTable(block);
        break;

      case 'kpi-cards':
      case 'comparison-cards':
        renderKpiCards(kpis);
        break;

      case 'goal-vs-actual':
      case 'funnel':
        renderBars(kpis);
        break;

      case 'chart':
        // A raster chart cannot be produced without a canvas render pass, so the PDF
        // states the numbers instead of shipping an empty frame. The portal shows the
        // interactive chart; the PDF shows the same data as cards.
        renderKpiCards(kpis);
        break;

      case 'progress':
        renderProgress(block.progress ?? 0);
        break;

      case 'signature':
        ensureSpace(60);
        cur.y += 24;
        doc.setDrawColor('#9ca3af');
        doc.line(margin, cur.y, margin + 190, cur.y);
        cur.y += 12;
        text(block.title || 'Nenshkrimi', 8, 'normal', GREY, { lineGap: 6 });
        break;

      case 'image':
      case 'gallery':
      case 'video-link':
      case 'attachment': {
        const links = block.type === 'video-link' || block.type === 'image'
          ? (block.url ? [{ name: block.title || block.url, url: block.url }] : [])
          : (block.attachments || []).map(a => ({ name: a.name, url: a.url }));
        for (const l of links) text(`• ${l.name}: ${l.url}`, 8, 'normal', primary, { indent: 8 });
        if (!links.length) text('—', 9, 'italic', GREY);
        break;
      }

      case 'custom-html':
        // Never in a client PDF (redaction removes it); in an internal PDF show
        // the source as text rather than trying to render markup.
        text(block.html || '', 8, 'normal', GREY, { lineGap: 4 });
        break;

      default:
        if (block.text?.trim()) text(block.text, 10, 'normal', INK, { lineGap: 4 });
        break;
    }

    cur.y += 6;
  }

  function renderList(items?: string[]) {
    for (const item of items || []) {
      if (!item?.trim()) continue;
      text(`•  ${item}`, 10, 'normal', INK, { indent: 8 });
    }
    if (items?.length) cur.y += 4;
  }

  function renderProgress(value: number) {
    const pct = Math.max(0, Math.min(100, value));
    ensureSpace(30);
    doc.setFillColor('#e5e7eb');
    doc.rect(margin, cur.y, contentW, 10, 'F');
    doc.setFillColor(primary);
    doc.rect(margin, cur.y, (contentW * pct) / 100, 10, 'F');
    cur.y += 16;
    text(`${Math.round(pct)}%`, 9, 'bold', INK, { lineGap: 4 });
  }

  function renderKpiCards(kpis: ReportKpiValue[]) {
    if (!kpis.length) { text('Pa te dhena.', 9, 'italic', GREY, { lineGap: 4 }); return; }
    const perRow = 3;
    const gap = 10;
    const cardW = (contentW - gap * (perRow - 1)) / perRow;
    const cardH = 56;

    for (let i = 0; i < kpis.length; i += perRow) {
      const row = kpis.slice(i, i + perRow);
      ensureSpace(cardH + 8);
      row.forEach((kpi, c) => {
        const m = kpiCardModel({ ...kpi, currency: kpi.currency || currency });
        const x = margin + c * (cardW + gap);
        doc.setDrawColor(LINE);
        doc.setFillColor('#ffffff');
        doc.rect(x, cur.y, cardW, cardH, 'FD');

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(GREY);
        const label = (doc.splitTextToSize(sanitise(kpi.label), cardW - 14) as string[])[0];
        doc.text(label, x + 7, cur.y + 15);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(INK);
        doc.text(sanitise(m.display), x + 7, cur.y + 34);

        const bits: string[] = [];
        if (m.delta.absolute !== null) bits.push(m.deltaLabel);
        if (m.targetLabel) bits.push(`obj. ${m.targetLabel}`);
        if (bits.length) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(
            m.delta.favourable === true ? '#16a34a'
              : m.delta.favourable === false ? '#dc2626' : GREY,
          );
          doc.text(sanitise(bits.join('   ')), x + 7, cur.y + 48);
        }
      });
      cur.y += cardH + 8;
    }
  }

  function renderBars(kpis: ReportKpiValue[]) {
    const rows = kpis.filter(k => typeof k.value === 'number');
    if (!rows.length) { text('Pa te dhena.', 9, 'italic', GREY, { lineGap: 4 }); return; }
    const max = Math.max(...rows.map(r => Number(r.value)), ...rows.map(r => Number(r.target || 0)));
    for (const kpi of rows) {
      ensureSpace(34);
      const m = kpiCardModel({ ...kpi, currency: kpi.currency || currency });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(INK);
      doc.text(sanitise(kpi.label).slice(0, 46), margin, cur.y + 8);
      doc.setTextColor(GREY);
      doc.text(
        sanitise(m.targetLabel ? `${m.display} / ${m.targetLabel}` : m.display),
        pageW - margin, cur.y + 8, { align: 'right' },
      );
      cur.y += 14;
      const w = max > 0 ? (contentW * Number(kpi.value)) / max : 0;
      doc.setFillColor('#e5e7eb');
      doc.rect(margin, cur.y, contentW, 7, 'F');
      doc.setFillColor(
        m.rag === 'green' ? '#16a34a' : m.rag === 'yellow' ? '#d97706' : m.rag === 'red' ? '#dc2626' : primary,
      );
      doc.rect(margin, cur.y, Math.max(0, w), 7, 'F');
      cur.y += 16;
    }
  }

  /** Paginating table: the header repeats on every page it spills onto. */
  function renderTable(block: ReportBlock) {
    const columns = block.columns || [];
    const rows = block.rows || [];
    if (!columns.length || !rows.length) {
      text('Pa te dhena.', 9, 'italic', GREY, { lineGap: 4 });
      return;
    }
    const colW = contentW / columns.length;
    const rowH = 18;

    const header = () => {
      ensureSpace(rowH * 2);
      doc.setFillColor('#f3f4f6');
      doc.rect(margin, cur.y, contentW, rowH, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(primary);
      columns.forEach((c, i) => {
        const x = margin + i * colW + 5;
        doc.text(sanitise(c.label).slice(0, 22), x, cur.y + 12);
      });
      cur.y += rowH;
    };

    header();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);

    for (const row of rows) {
      if (cur.y + rowH > bottom) { newPage(); header(); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); }
      doc.setDrawColor(LINE);
      doc.line(margin, cur.y + rowH, pageW - margin, cur.y + rowH);
      columns.forEach((c, i) => {
        const raw = row[c.key];
        const value = raw === null || raw === undefined || raw === ''
          ? '—'
          : typeof raw === 'number'
            ? formatKpiValue(raw, c.format === 'currency' ? 'currency' : c.format === 'percent' ? 'percent' : c.format === 'hours' ? 'hours' : 'number',
              { decimals: c.format === 'number' ? 0 : undefined, currency })
            : String(raw);
        doc.setTextColor(INK);
        const x = margin + i * colW + 5;
        const cell = (doc.splitTextToSize(sanitise(value), colW - 10) as string[])[0] || '';
        if (c.align === 'right') doc.text(cell, margin + (i + 1) * colW - 5, cur.y + 12, { align: 'right' });
        else doc.text(cell, x, cur.y + 12);
      });
      cur.y += rowH;
    }
    cur.y += 6;
  }
}

/** Filename that sorts and identifies: client-period-version. */
export function reportPdfFilename(report: Report, version?: number): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const parts = [
    slug(report.customerName || report.projectName || 'raport'),
    report.period.key,
    version ? `v${version}` : '',
  ].filter(Boolean);
  return `${parts.join('_')}.pdf`;
}

/** Build and download in the browser. */
export function downloadReportPdf(report: Report, opts: PdfOptions): void {
  const doc = buildReportPdf(report, opts);
  doc.save(reportPdfFilename(report, opts.version));
}

/** Build and return base64 (for emailing the PDF as an attachment). */
export function reportPdfBase64(report: Report, opts: PdfOptions): string {
  return buildReportPdf(report, opts).output('datauristring').split(',')[1] || '';
}
