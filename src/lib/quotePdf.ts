import { jsPDF } from 'jspdf';
import type { Quote } from '../types';
import { currencySymbol } from './utils';

const NAVY = '#12468C';
const CYAN = '#0EA5E9';

const money = (n: number, cur: string) => `${Math.round(n || 0).toLocaleString('sq-AL')} ${cur}`;

/** Company identity from team settings mirrored into localStorage (best-effort). */
function companyInfo(): { name: string; email?: string; phone?: string } {
  try {
    return {
      name: localStorage.getItem('company_name') || 'FivoCRM',
      email: localStorage.getItem('company_email') || undefined,
      phone: localStorage.getItem('company_phone') || undefined,
    };
  } catch {
    return { name: 'FivoCRM' };
  }
}

/**
 * Generate & download a proposal PDF for a quote (Preventivë).
 * Mirrors the on-screen package breakdown: categories with one-time/monthly,
 * discounts and grand total.
 */
export function downloadQuotePdf(q: Quote): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const cur = currencySymbol(q.currency);
  const co = companyInfo();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = 48;

  // Header band
  doc.setFillColor(NAVY);
  doc.rect(0, 0, pageW, 8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(NAVY);
  doc.text(co.name, margin, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor('#6b7280');
  const contact = [co.email, co.phone].filter(Boolean).join('  ·  ');
  if (contact) { y += 16; doc.text(contact, margin, y); }

  // Title
  y += 34;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor('#111827');
  const title = q.label || q.result?.suggestedLabel || 'Preventivë';
  doc.text(`Preventivë: ${title}${q.version ? `  (v${q.version})` : ''}`, margin, y);

  // Meta
  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor('#6b7280');
  const client = q.customerName || q.leadName || '';
  const dateStr = q.createdAt instanceof Date ? q.createdAt.toLocaleDateString('sq-AL') : '';
  doc.text([client && `Klienti: ${client}`, dateStr && `Data: ${dateStr}`, q.market && `Tregu: ${q.market}`].filter(Boolean).join('   ·   '), margin, y);

  // Category table
  y += 26;
  doc.setDrawColor('#e5e7eb');
  doc.setFillColor('#f3f4f6');
  doc.rect(margin, y - 12, pageW - margin * 2, 20, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(NAVY);
  doc.text('Shërbimi', margin + 6, y + 2);
  doc.text('Njëherësh', pageW - margin - 180, y + 2);
  doc.text('Mujore', pageW - margin - 70, y + 2);
  y += 18;

  doc.setFont('helvetica', 'normal');
  doc.setTextColor('#111827');
  for (const cat of q.result?.categories || []) {
    if (y > 760) { doc.addPage(); y = 48; }
    doc.text(String(cat.category), margin + 6, y);
    doc.text(money(cat.oneTime, cur), pageW - margin - 180, y);
    doc.text(money(cat.monthly, cur), pageW - margin - 70, y);
    y += 16;
  }

  // Discounts
  const disc = (q.result?.bundleDiscountAmount || 0) + (q.result?.manualDiscountAmount || 0);
  if (disc > 0) {
    if (y > 760) { doc.addPage(); y = 48; }
    y += 6;
    doc.setTextColor('#16a34a');
    doc.text(`Zbritje${q.result?.bundleDiscountLabel ? ` (${q.result.bundleDiscountLabel})` : ''}`, margin + 6, y);
    doc.text(`- ${money(disc, cur)}`, pageW - margin - 180, y);
    y += 16;
  }

  // Totals band
  if (y > 760) { doc.addPage(); y = 48; }
  y += 10;
  doc.setDrawColor('#e5e7eb');
  doc.line(margin, y, pageW - margin, y);
  y += 18;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor('#111827');
  doc.text('Totali njëherësh:', margin + 6, y);
  doc.text(money(q.result?.totalOneTime ?? 0, cur), pageW - margin - 180, y);
  y += 16;
  doc.text('Totali mujor:', margin + 6, y);
  doc.text(money(q.result?.totalMonthly ?? 0, cur), pageW - margin - 180, y);
  y += 20;
  if (y > 760) { doc.addPage(); y = 48; }
  doc.setFontSize(13);
  doc.setTextColor(CYAN);
  doc.text('GRAND TOTAL:', margin + 6, y);
  doc.text(money(q.result?.grandTotal ?? 0, cur), pageW - margin - 180, y);

  // Notes / validity
  if (q.notes || q.validUntil) {
    y += 30;
    if (y > 760) { doc.addPage(); y = 48; }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor('#6b7280');
    if (q.validUntil) {
      const vu = q.validUntil instanceof Date ? q.validUntil.toLocaleDateString('sq-AL') : '';
      if (vu) { doc.text(`Vlen deri: ${vu}`, margin, y); y += 14; }
    }
    if (q.notes) doc.text(doc.splitTextToSize(`Shënime: ${q.notes}`, pageW - margin * 2), margin, y);
  }

  const safe = title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'Preventive';
  doc.save(`Preventive-${safe}${q.version ? `-v${q.version}` : ''}.pdf`);
}
