// Shared marketing mailer. Prefers a dedicated ESP (Resend) for bulk sends so
// marketing blasts never touch the transactional SMTP reputation; falls back to
// the existing SMTP transport when RESEND_API_KEY is not configured (dev/test).
//
// Env:
//   RESEND_API_KEY        — Resend API key (enables ESP path)
//   MARKETING_FROM_EMAIL  — verified sender, e.g. "marketing@fivocrm.com"
//   MARKETING_FROM_NAME   — default display name (fallback "FivoCRM")
//   SMTP_HOST/PORT/USER/PASS — fallback transactional transport (already used)
import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
}
export interface SendResult {
  to: string;
  ok: boolean;
  error?: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails/batch';
const RESEND_BATCH_MAX = 100; // Resend batch API hard limit

export function mailerMode(): 'resend' | 'smtp' | 'none' {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  return 'none';
}

function resolveFrom(fromName?: string, viaResend?: boolean): string {
  const name = (fromName || process.env.MARKETING_FROM_NAME || 'FivoCRM').replace(/["<>]/g, '');
  const email = viaResend
    ? process.env.MARKETING_FROM_EMAIL || process.env.SMTP_USER || 'onboarding@resend.dev'
    : process.env.SMTP_USER!;
  return `"${name}" <${email}>`;
}

async function sendViaResend(messages: MailMessage[], from: string): Promise<SendResult[]> {
  const results: SendResult[] = [];
  for (let i = 0; i < messages.length; i += RESEND_BATCH_MAX) {
    const chunk = messages.slice(i, i + RESEND_BATCH_MAX);
    try {
      const resp = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          chunk.map((m) => ({ from, to: [m.to], subject: m.subject, html: m.html })),
        ),
        signal: AbortSignal.timeout(20_000),
      });
      const ok = resp.ok;
      const detail = ok ? '' : await resp.text().catch(() => `HTTP ${resp.status}`);
      for (const m of chunk) results.push({ to: m.to, ok, ...(ok ? {} : { error: detail.slice(0, 200) }) });
    } catch (err: any) {
      for (const m of chunk) results.push({ to: m.to, ok: false, error: err?.message || 'Resend error' });
    }
  }
  return results;
}

async function sendViaSmtp(messages: MailMessage[], from: string): Promise<SendResult[]> {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.fivoo.net',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  });
  const results: SendResult[] = [];
  // Sequential + tiny delay: shared transactional SMTP can't handle a burst and
  // we don't want to trip rate limits that would also hurt invoices/invites.
  for (const m of messages) {
    try {
      await transporter.sendMail({ from, to: m.to, subject: m.subject, html: m.html });
      results.push({ to: m.to, ok: true });
    } catch (err: any) {
      results.push({ to: m.to, ok: false, error: err?.message || 'SMTP error' });
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return results;
}

/**
 * Send a batch of marketing emails via the best available transport.
 * Never throws — returns a per-recipient result array for idempotent accounting.
 */
export async function sendBulkEmail(messages: MailMessage[], fromName?: string): Promise<SendResult[]> {
  if (messages.length === 0) return [];
  const mode = mailerMode();
  if (mode === 'none') {
    return messages.map((m) => ({ to: m.to, ok: false, error: 'No mailer configured (set RESEND_API_KEY or SMTP_*)' }));
  }
  const from = resolveFrom(fromName, mode === 'resend');
  return mode === 'resend' ? sendViaResend(messages, from) : sendViaSmtp(messages, from);
}

// Fill {{name}} / {{company}} / {{email}} merge tokens (case-insensitive, trims
// surrounding spaces). Unknown tokens are left blank rather than literal.
export function renderMergeTokens(html: string, vars: Record<string, string>): string {
  return (html || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[String(key).toLowerCase()];
    return v == null ? '' : String(v);
  });
}
