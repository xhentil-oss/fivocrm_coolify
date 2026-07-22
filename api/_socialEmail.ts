/**
 * Emails the monthly social-media report to the client (Customer.email).
 * Used by both the monthly cron (auto-send after sync) and the manual
 * "Dërgo raportin" button (api/social?action=send-report).
 *
 * Format: an HTML summary of the headline metrics per connected account + a CTA
 * button to the full interactive report in the client portal (/portal/social).
 * The client only ever sees their own data.
 */
import { adminDb } from './_firebaseAdmin.js';
import { sendBulkEmail } from './_mailer.js';
import type { MailerConfig } from './_mailer.js';

const MONTHS_SQ = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor'];
const periodLabel = (p: string): string => {
  const [y, m] = p.split('-').map(Number);
  return `${MONTHS_SQ[(m || 1) - 1]} ${y}`;
};
// Group thousands with a dot (Albanian style) without relying on ICU locale data.
const fmt = (n?: number): string => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

function appUrl(): string {
  return (process.env.VITE_APP_URL || process.env.APP_URL || 'https://fivocrm.vercel.app').replace(/\/$/, '');
}

const NAVY = '#12468C';
const CYAN = '#0EA5E9';

function metricCell(label: string, value: string, sub?: string): string {
  return `
    <td style="padding:10px 14px;border:1px solid #e5e7eb;border-radius:10px;background:#f8fafc;text-align:center;">
      <div style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#64748b;margin-bottom:4px;">${label}</div>
      <div style="font-size:22px;font-weight:700;color:#0f172a;line-height:1;">${value}</div>
      ${sub ? `<div style="font-size:11px;color:#94a3b8;margin-top:3px;">${sub}</div>` : ''}
    </td>`;
}

function accountBlock(a: any): string {
  const m = a.metrics || {};
  const isIg = a.platform === 'instagram';
  const badge = isIg ? 'Instagram' : 'Facebook';
  const badgeColor = isIg ? '#E1306C' : NAVY;
  const growth = (m.followerGrowth ?? 0) >= 0 ? `+${fmt(m.followerGrowth)}` : fmt(m.followerGrowth);
  return `
  <div style="border:1px solid #e5e7eb;border-radius:14px;padding:18px;margin:0 0 16px;">
    <div style="margin-bottom:12px;">
      <span style="display:inline-block;font-size:11px;font-weight:600;color:#fff;background:${badgeColor};border-radius:999px;padding:3px 10px;">${badge}</span>
      <span style="font-size:15px;font-weight:700;color:#0f172a;margin-left:8px;">${a.accountName || ''}</span>
    </div>
    <table role="presentation" cellpadding="0" cellspacing="6" style="width:100%;border-collapse:separate;">
      <tr>
        ${metricCell('Ndjekës', fmt(m.followers), `${growth} këtë muaj`)}
        ${metricCell('Reach', fmt(m.reach), `${fmt(m.impressions)} shfaqje`)}
      </tr>
      <tr>
        ${metricCell('Angazhim', fmt(m.engagement), `${m.engagementRate ?? 0}% rate`)}
        ${metricCell('Postime', fmt(m.postsCount), m.profileViews ? `${fmt(m.profileViews)} vizita profili` : '')}
      </tr>
    </table>
  </div>`;
}

function buildReportEmailHtml(customerName: string, period: string, accounts: any[]): string {
  const link = `${appUrl()}/portal/social`;
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;">
    <div style="background:linear-gradient(135deg,${NAVY},${CYAN});border-radius:16px 16px 0 0;padding:28px 24px;color:#fff;">
      <div style="font-size:13px;opacity:.85;margin-bottom:4px;">Raporti i Rrjeteve Sociale</div>
      <div style="font-size:24px;font-weight:800;">${periodLabel(period)}</div>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;padding:24px;">
      <p style="font-size:15px;margin:0 0 18px;">Përshëndetje ${customerName || ''},</p>
      <p style="font-size:14px;color:#475569;margin:0 0 20px;">Ky është raporti mujor i performancës së rrjeteve tuaja sociale, i menaxhuar nga ekipi ynë.</p>
      ${accounts.map(accountBlock).join('')}
      <div style="text-align:center;margin:24px 0 8px;">
        <a href="${link}" style="display:inline-block;background:${NAVY};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:10px;">Shiko raportin e plotë →</a>
      </div>
      <p style="font-size:12px;color:#94a3b8;text-align:center;margin:16px 0 0;">Grafikët e detajuar, demografia dhe postimet kryesore janë në portal.</p>
    </div>
  </div>`;
}

export interface ReportEmailResult { customerId: string; ok: boolean; skipped?: string; error?: string }

// Build + send one customer's report for `period`. Skips gracefully when the
// customer has no email or no snapshots for that month.
export async function sendCustomerReport(customerId: string, period: string): Promise<ReportEmailResult> {
  try {
    const custSnap = await adminDb.collection('customers').doc(customerId).get();
    if (!custSnap.exists) return { customerId, ok: false, skipped: 'no-customer' };
    const cust = custSnap.data()!;
    const email = (cust.email || '').trim();
    if (!email) return { customerId, ok: false, skipped: 'no-email' };

    const snap = await adminDb.collection('socialSnapshots').where('customerId', '==', customerId).get();
    const accounts = snap.docs
      .map((d) => d.data())
      .filter((s) => s.period === period)
      .sort((a, b) => (a.platform || '').localeCompare(b.platform || ''));
    if (!accounts.length) return { customerId, ok: false, skipped: 'no-data' };

    // Resolve the team's email provider config (falls back to env inside mailer).
    let cfg: MailerConfig = {};
    if (cust.teamId) {
      const ts = await adminDb.collection('teamSettings').doc(cust.teamId).get();
      if (ts.exists) cfg = ts.data() as MailerConfig;
    }

    const html = buildReportEmailHtml(cust.name || '', period, accounts);
    const subject = `Raporti i rrjeteve sociale — ${periodLabel(period)}`;
    const [res] = await sendBulkEmail([{ to: email, subject, html }], cfg);
    return { customerId, ok: !!res?.ok, error: res?.ok ? undefined : res?.error };
  } catch (err) {
    return { customerId, ok: false, error: err instanceof Error ? err.message : 'send failed' };
  }
}

// Send reports to every customer that has a snapshot for `period` (monthly cron).
export async function sendReportsForPeriod(period: string): Promise<{ sent: number; skipped: number; failed: number }> {
  const snap = await adminDb.collection('socialSnapshots').where('period', '==', period).get();
  const customerIds = [...new Set(snap.docs.map((d) => d.data().customerId).filter(Boolean))];
  let sent = 0, skipped = 0, failed = 0;
  for (const cid of customerIds) {
    const r = await sendCustomerReport(cid, period);
    if (r.ok) sent++;
    else if (r.skipped) skipped++;
    else failed++;
  }
  return { sent, skipped, failed };
}
