// Shared marketing mailer. Supports multiple ESP providers so blasts never
// touch the transactional SMTP reputation. Provider + credentials are resolved
// per-team from teamSettings (configured in Settings → Integrime); when a team
// hasn't configured one, we fall back to platform-wide env vars.
//
// Providers: Resend, SendGrid, Mailgun, or custom/plain SMTP.
//
// Per-team config (teamSettings): emailProvider, emailApiKey, emailFromEmail,
//   emailFromName, emailMailgunDomain, emailMailgunRegion, emailSmtp*.
// Env fallback: RESEND_API_KEY | SENDGRID_API_KEY | MAILGUN_API_KEY+MAILGUN_DOMAIN
//   | SMTP_HOST/PORT/USER/PASS, plus MARKETING_FROM_EMAIL / MARKETING_FROM_NAME.
import nodemailer from 'nodemailer';

export type MailProvider = 'resend' | 'sendgrid' | 'mailgun' | 'smtp';

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

// Per-team config as stored in teamSettings (all optional).
export interface MailerConfig {
  emailProvider?: MailProvider;
  emailApiKey?: string;
  emailFromEmail?: string;
  emailFromName?: string;
  emailMailgunDomain?: string;
  emailMailgunRegion?: 'us' | 'eu';
  emailSmtpHost?: string;
  emailSmtpPort?: number;
  emailSmtpUser?: string;
  emailSmtpPass?: string;
}

// Fully-resolved transport (team config merged over env fallback).
interface ResolvedMailer {
  provider: MailProvider | 'none';
  apiKey?: string;
  fromEmail: string;
  fromName: string;
  mailgunDomain?: string;
  mailgunRegion: 'us' | 'eu';
  smtp: { host: string; port: number; user?: string; pass?: string };
}

const RESEND_BATCH_MAX = 100;

function resolveMailer(cfg: MailerConfig = {}, fromNameOverride?: string): ResolvedMailer {
  // Pick provider: explicit team choice wins, else auto-detect from whatever
  // credentials exist (team config first, then env).
  let provider: MailProvider | 'none';
  if (cfg.emailProvider) {
    provider = cfg.emailProvider;
  } else if (cfg.emailApiKey) {
    provider = 'resend'; // a bare API key with no provider defaults to Resend
  } else if (process.env.RESEND_API_KEY) {
    provider = 'resend';
  } else if (process.env.SENDGRID_API_KEY) {
    provider = 'sendgrid';
  } else if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
    provider = 'mailgun';
  } else if ((cfg.emailSmtpUser && cfg.emailSmtpPass) || (process.env.SMTP_USER && process.env.SMTP_PASS)) {
    provider = 'smtp';
  } else {
    provider = 'none';
  }

  const apiKey =
    cfg.emailApiKey ||
    (provider === 'resend' ? process.env.RESEND_API_KEY : undefined) ||
    (provider === 'sendgrid' ? process.env.SENDGRID_API_KEY : undefined) ||
    (provider === 'mailgun' ? process.env.MAILGUN_API_KEY : undefined);

  const fromEmail =
    cfg.emailFromEmail ||
    process.env.MARKETING_FROM_EMAIL ||
    cfg.emailSmtpUser ||
    process.env.SMTP_USER ||
    'onboarding@resend.dev';

  const fromName = (fromNameOverride || cfg.emailFromName || process.env.MARKETING_FROM_NAME || 'FivoCRM')
    .replace(/["<>]/g, '');

  return {
    provider,
    apiKey,
    fromEmail,
    fromName,
    mailgunDomain: cfg.emailMailgunDomain || process.env.MAILGUN_DOMAIN,
    mailgunRegion: cfg.emailMailgunRegion || (process.env.MAILGUN_REGION as 'eu') || 'us',
    smtp: {
      host: cfg.emailSmtpHost || process.env.SMTP_HOST || 'mail.fivoo.net',
      port: cfg.emailSmtpPort || Number(process.env.SMTP_PORT) || 465,
      user: cfg.emailSmtpUser || process.env.SMTP_USER,
      pass: cfg.emailSmtpPass || process.env.SMTP_PASS,
    },
  };
}

function fromHeader(r: ResolvedMailer): string {
  return `"${r.fromName}" <${r.fromEmail}>`;
}

// ── Resend (native batch) ────────────────────────────────────────────────────
async function sendViaResend(messages: MailMessage[], r: ResolvedMailer, campaignId?: string): Promise<SendResult[]> {
  const from = fromHeader(r);
  const tags = campaignId ? [{ name: 'campaignId', value: campaignId }] : undefined;
  const results: SendResult[] = [];
  for (let i = 0; i < messages.length; i += RESEND_BATCH_MAX) {
    const chunk = messages.slice(i, i + RESEND_BATCH_MAX);
    try {
      const resp = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${r.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk.map((m) => ({ from, to: [m.to], subject: m.subject, html: m.html, ...(tags ? { tags } : {}) }))),
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

// ── SendGrid (one request per message; merge tokens differ per recipient) ─────
async function sendViaSendgrid(messages: MailMessage[], r: ResolvedMailer, campaignId?: string): Promise<SendResult[]> {
  const results: SendResult[] = [];
  for (const m of messages) {
    try {
      const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${r.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: m.to }] }],
          from: { email: r.fromEmail, name: r.fromName },
          subject: m.subject,
          content: [{ type: 'text/html', value: m.html }],
          ...(campaignId ? { custom_args: { campaignId } } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      // SendGrid returns 202 Accepted on success (empty body).
      const ok = resp.status === 202 || resp.ok;
      const detail = ok ? '' : await resp.text().catch(() => `HTTP ${resp.status}`);
      results.push({ to: m.to, ok, ...(ok ? {} : { error: detail.slice(0, 200) }) });
    } catch (err: any) {
      results.push({ to: m.to, ok: false, error: err?.message || 'SendGrid error' });
    }
  }
  return results;
}

// ── Mailgun (form-encoded, HTTP basic auth "api:KEY") ─────────────────────────
async function sendViaMailgun(messages: MailMessage[], r: ResolvedMailer, campaignId?: string): Promise<SendResult[]> {
  const results: SendResult[] = [];
  if (!r.mailgunDomain) {
    return messages.map((m) => ({ to: m.to, ok: false, error: 'Mailgun domain mungon' }));
  }
  const base = r.mailgunRegion === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
  const auth = Buffer.from(`api:${r.apiKey}`).toString('base64');
  const from = fromHeader(r);
  for (const m of messages) {
    try {
      const form = new URLSearchParams({ from, to: m.to, subject: m.subject, html: m.html });
      if (campaignId) form.set('v:campaignId', campaignId);
      const resp = await fetch(`${base}/v3/${r.mailgunDomain}/messages`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: AbortSignal.timeout(20_000),
      });
      const ok = resp.ok;
      const detail = ok ? '' : await resp.text().catch(() => `HTTP ${resp.status}`);
      results.push({ to: m.to, ok, ...(ok ? {} : { error: detail.slice(0, 200) }) });
    } catch (err: any) {
      results.push({ to: m.to, ok: false, error: err?.message || 'Mailgun error' });
    }
  }
  return results;
}

// ── SMTP (nodemailer) ─────────────────────────────────────────────────────────
async function sendViaSmtp(messages: MailMessage[], r: ResolvedMailer): Promise<SendResult[]> {
  if (!r.smtp.user || !r.smtp.pass) {
    return messages.map((m) => ({ to: m.to, ok: false, error: 'SMTP credentials mungojnë' }));
  }
  const transporter = nodemailer.createTransport({
    host: r.smtp.host,
    port: r.smtp.port,
    secure: r.smtp.port === 465,
    auth: { user: r.smtp.user, pass: r.smtp.pass },
  });
  const from = `"${r.fromName}" <${r.smtp.user}>`;
  const results: SendResult[] = [];
  // Sequential + tiny delay: shared SMTP can't handle a burst and we don't want
  // to trip rate limits that would also hurt invoices/invites.
  for (const m of messages) {
    try {
      await transporter.sendMail({ from, to: m.to, subject: m.subject, html: m.html });
      results.push({ to: m.to, ok: true });
    } catch (err: any) {
      results.push({ to: m.to, ok: false, error: err?.message || 'SMTP error' });
    }
    await new Promise((res) => setTimeout(res, 150));
  }
  return results;
}

/** Which provider will actually be used for the given team config (for status UI/logs). */
export function resolveProvider(cfg: MailerConfig = {}): MailProvider | 'none' {
  return resolveMailer(cfg).provider;
}

/**
 * Send a batch of marketing emails via the team's configured provider (with env
 * fallback). Never throws — returns a per-recipient result array for idempotent
 * accounting.
 */
export async function sendBulkEmail(
  messages: MailMessage[],
  cfg: MailerConfig = {},
  fromNameOverride?: string,
  campaignId?: string,
): Promise<SendResult[]> {
  if (messages.length === 0) return [];
  const r = resolveMailer(cfg, fromNameOverride);
  switch (r.provider) {
    case 'resend': return sendViaResend(messages, r, campaignId);
    case 'sendgrid': return sendViaSendgrid(messages, r, campaignId);
    case 'mailgun': return sendViaMailgun(messages, r, campaignId);
    case 'smtp': return sendViaSmtp(messages, r); // SMTP has no event webhooks
    default:
      return messages.map((m) => ({ to: m.to, ok: false, error: 'Asnjë ofrues email i konfiguruar (Settings → Integrime)' }));
  }
}

// Fill {{name}} / {{company}} / {{email}} merge tokens (case-insensitive, trims
// surrounding spaces). Unknown tokens are left blank rather than literal.
export function renderMergeTokens(html: string, vars: Record<string, string>): string {
  return (html || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[String(key).toLowerCase()];
    return v == null ? '' : String(v);
  });
}
