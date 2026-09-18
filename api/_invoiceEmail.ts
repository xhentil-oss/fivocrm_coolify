/**
 * Shared invoice email HTML builder + sender.
 * Imported by recurring-invoices cron and invoice-reminders cron.
 * NOT a Vercel route (underscore prefix is ignored by Vercel routing).
 */

import { randomBytes } from 'node:crypto';
import { adminDb as db } from './_firebaseAdmin.js';

export interface InvoiceEmailData {
  customerName: string;
  invoiceNumber: string;
  /** Gross invoice total. */
  amount: number;
  /**
   * Already settled against this invoice (cash instalments recorded by staff, or a
   * partial Stripe payment). A reminder used to demand `amount` while labelling it
   * "Shuma e papaguar", so a client who had paid half was chased for the whole
   * thing — while create-checkout-session correctly charged only the remainder.
   */
  paidAmount?: number;
  dueDate: Date;
  projectName: string;
  /**
   * `reminder2` is the FINAL NOTICE on the due day itself ("skadon sot").
   * `overdue` is the weekly chase for an invoice that is already late — it used
   * to reuse `reminder2`, so a customer 45 days late was told the deadline
   * expired today, every week.
   */
  type: 'initial' | 'reminder1' | 'reminder2' | 'overdue';
  /** Whole days past the due date. Only read by the `overdue` variant. */
  daysOverdue?: number;
  currency?: 'ALL' | 'EUR';
  paymentMethod?: string;
  bankName?: string;
  bankIBAN?: string;
  bankSWIFT?: string;
  bankAccountHolder?: string;
  bankCountry?: string;
  /** "Paguaj Tani" deep link into the client portal (login → this invoice). */
  payUrl?: string;
}

/**
 * Portal deep link for paying a specific invoice. The portal route auto-opens the
 * invoice's detail dialog (with its Stripe "Paguaj" button); an unauthenticated
 * client is bounced through /login, which preserves the redirect and lands them
 * back on this exact invoice.
 */
export function invoicePayUrl(invoiceId: string): string {
  const base = (process.env.VITE_APP_URL || process.env.APP_URL || process.env.PUBLIC_BASE_URL || 'https://fivocrm.vercel.app')
    .replace(/\/$/, '');
  return `${base}/portal/invoices?invoice=${encodeURIComponent(invoiceId)}`;
}

/**
 * PUBLIC pay link — /pay/:id?t=<token> opens and pays WITHOUT login (the token is
 * the authorization; create-checkout-session verifies it against the invoice's
 * `publicPayToken`). Mints the token on first use with the Admin SDK and reuses it
 * afterwards, so the link in every email for the same invoice stays stable.
 *
 * Pass the already-loaded invoice data when you have it (saves the read). Falls
 * back to the login-gated portal link if the token can't be minted — an email with
 * a working-but-gated link beats a failed send.
 */
export async function publicInvoicePayUrl(
  invoiceId: string,
  invoiceData?: Record<string, any> | null,
): Promise<string> {
  const base = (process.env.VITE_APP_URL || process.env.APP_URL || process.env.PUBLIC_BASE_URL || 'https://fivocrm.vercel.app')
    .replace(/\/$/, '');
  try {
    let token: string | undefined =
      typeof invoiceData?.publicPayToken === 'string' && invoiceData.publicPayToken.length >= 32
        ? invoiceData.publicPayToken
        : undefined;
    if (!token && invoiceData === undefined) {
      const snap = await db.collection('invoices').doc(invoiceId).get();
      const t = (snap.data() as any)?.publicPayToken;
      if (typeof t === 'string' && t.length >= 32) token = t;
    }
    if (!token) {
      token = randomBytes(24).toString('hex');
      await db.collection('invoices').doc(invoiceId).set({ publicPayToken: token }, { merge: true });
    }
    return `${base}/pay/${encodeURIComponent(invoiceId)}?t=${token}`;
  } catch (err: any) {
    console.error(`[publicInvoicePayUrl] token mint failed for ${invoiceId}:`, err?.message || err);
    return invoicePayUrl(invoiceId);
  }
}

export function buildInvoiceEmail(data: InvoiceEmailData): { subject: string; html: string } {
  const { customerName, invoiceNumber, amount, paidAmount, dueDate, projectName, type, daysOverdue, currency, paymentMethod, bankName, bankIBAN, bankSWIFT, bankAccountHolder, bankCountry, payUrl } = data;
  const currencySymbol = currency === 'EUR' ? '€' : 'L';
  const currencyLabel = currency === 'EUR' ? 'EUR' : 'ALL';
  const money = (n: number) => n.toLocaleString('sq-AL') + ' ' + currencySymbol;
  const amountStr = money(amount);
  // What the client actually still owes. `amountStr` stays the gross total (the
  // "Shuma" row of a new invoice); every "unpaid" figure uses the remainder.
  const settled = Number.isFinite(paidAmount) && (paidAmount as number) > 0 ? (paidAmount as number) : 0;
  const outstanding = Math.max(0, amount - settled);
  const outstandingStr = money(outstanding);
  // Shown only when something has already been paid, so a normal invoice email is
  // unchanged and a partially-paid one explains its own number.
  const settledRowHtml = settled > 0 ? `
              <tr>
                <td style="padding: 10px 14px; color: #6b7280; font-size: 14px;">Paguar deri tani</td>
                <td style="padding: 10px 14px; color: #16a34a; font-weight: bold;">${money(settled)}</td>
              </tr>
              <tr>
                <td style="padding: 10px 14px; color: #6b7280; font-size: 14px;">Totali i faturës</td>
                <td style="padding: 10px 14px; color: #111827;">${amountStr}</td>
              </tr>` : '';
  const dueDateStr = dueDate.toLocaleDateString('sq-AL', { day: '2-digit', month: 'long', year: 'numeric' });

  // Bank details HTML block (reused across email types)
  const bankDetailsHtml = paymentMethod === 'Bank' && bankIBAN ? `
            <div style="margin: 16px 0; padding: 16px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px;">
              <p style="color: #0369a1; font-weight: bold; margin: 0 0 8px 0; font-size: 14px;">🏦 Detajet Bankare për Pagesë</p>
              <table style="width: 100%; border-collapse: collapse;">
                ${bankName ? `<tr><td style="padding: 4px 0; color: #6b7280; font-size: 13px;">Banka</td><td style="padding: 4px 0; color: #111827; font-size: 13px; font-weight: 500;">${escHtml(bankName)}</td></tr>` : ''}
                ${bankAccountHolder ? `<tr><td style="padding: 4px 0; color: #6b7280; font-size: 13px;">Mbajtësi</td><td style="padding: 4px 0; color: #111827; font-size: 13px; font-weight: 500;">${escHtml(bankAccountHolder)}</td></tr>` : ''}
                <tr><td style="padding: 4px 0; color: #6b7280; font-size: 13px;">IBAN</td><td style="padding: 4px 0; color: #111827; font-size: 13px; font-family: monospace; font-weight: 500;">${escHtml(bankIBAN)}</td></tr>
                ${bankSWIFT ? `<tr><td style="padding: 4px 0; color: #6b7280; font-size: 13px;">SWIFT / BIC</td><td style="padding: 4px 0; color: #111827; font-size: 13px; font-family: monospace; font-weight: 500;">${escHtml(bankSWIFT)}</td></tr>` : ''}
                ${bankCountry ? `<tr><td style="padding: 4px 0; color: #6b7280; font-size: 13px;">Shteti</td><td style="padding: 4px 0; color: #111827; font-size: 13px; font-weight: 500;">${escHtml(bankCountry)}</td></tr>` : ''}
                <tr><td style="padding: 4px 0; color: #6b7280; font-size: 13px;">Monedha</td><td style="padding: 4px 0; color: #111827; font-size: 13px; font-weight: 500;">${currencyLabel}</td></tr>
              </table>
              <p style="color: #0369a1; font-size: 12px; margin: 8px 0 0 0;">Ju lutemi përdorni numrin e faturës <strong>#${escHtml(invoiceNumber)}</strong> si referencë pagese.</p>
            </div>` : '';

  // "Paguaj Tani" CTA (reused across email types) — normally the PUBLIC pay link
  // (publicInvoicePayUrl: opens and pays by card without any login); falls back to
  // the login-gated portal deep link only if token minting failed. payUrl is built
  // server-side, never caller-supplied free text, but attribute-escape it anyway.
  const payButtonHtml = payUrl ? `
            <div style="text-align: center; margin: 24px 0 8px 0;">
              <a href="${escHtml(payUrl)}" style="display: inline-block; background: #12468C; color: #ffffff; padding: 14px 36px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">💳 Paguaj Tani</a>
              <p style="color: #6b7280; font-size: 12px; margin: 10px 0 0 0;">Pagesë e sigurt online me kartë përmes Stripe.</p>
            </div>` : '';

  if (type === 'initial') {
    return {
      subject: `Faturë e re: #${invoiceNumber} — ${projectName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9fafb; border-radius: 8px;">
          <div style="background: #3b82f6; padding: 20px 24px; border-radius: 6px 6px 0 0;">
            <h2 style="color: white; margin: 0; font-size: 20px;">🧾 Faturë e Re</h2>
          </div>
          <div style="background: white; padding: 24px; border-radius: 0 0 6px 6px; border: 1px solid #e5e7eb;">
            <p style="color: #374151; margin-top: 0;">I/E dashur <strong>${escHtml(customerName)}</strong>,</p>
            <p style="color: #374151;">Ju kemi lëshuar faturën e mëposhtme për shërbimin <strong>${escHtml(projectName)}</strong>:</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tr style="background: #f3f4f6;">
                <td style="padding: 10px 14px; color: #6b7280; font-size: 14px;">Nr. faturës</td>
                <td style="padding: 10px 14px; color: #111827; font-weight: bold;">#${escHtml(invoiceNumber)}</td>
              </tr>
              <tr>
                <td style="padding: 10px 14px; color: #6b7280; font-size: 14px;">Shërbimi</td>
                <td style="padding: 10px 14px; color: #111827;">${escHtml(projectName)}</td>
              </tr>
              <tr style="background: #f3f4f6;">
                <td style="padding: 10px 14px; color: #6b7280; font-size: 14px;">Shuma</td>
                <td style="padding: 10px 14px; color: #111827; font-weight: bold; font-size: 16px;">${amountStr}</td>
              </tr>
              <tr>
                <td style="padding: 10px 14px; color: #6b7280; font-size: 14px;">Afati i pagesës</td>
                <td style="padding: 10px 14px; color: #111827;">${dueDateStr}</td>
              </tr>
            </table>
            ${bankDetailsHtml}
            ${payButtonHtml}
            <p style="color: #374151;">Ju lutemi kryeni pagesën deri në datën e sipërpërmendur.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">FivoCRM — Njoftime automatike &bull; Mos iu përgjigjeni këtij emaili direkt.</p>
          </div>
        </div>
      `,
    };
  }

  if (type === 'reminder1') {
    return {
      subject: `⏰ Kujtesë pagese: Fatura #${invoiceNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9fafb; border-radius: 8px;">
          <div style="background: #f59e0b; padding: 20px 24px; border-radius: 6px 6px 0 0;">
            <h2 style="color: white; margin: 0; font-size: 20px;">⏰ Kujtesë Pagese</h2>
          </div>
          <div style="background: white; padding: 24px; border-radius: 0 0 6px 6px; border: 1px solid #e5e7eb;">
            <p style="color: #374151; margin-top: 0;">I/E dashur <strong>${escHtml(customerName)}</strong>,</p>
            <p style="color: #374151;">Ju kujtojmë se fatura juaj <strong>#${escHtml(invoiceNumber)}</strong> për shërbimin <strong>${escHtml(projectName)}</strong> është ende e papaguar.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tr style="background: #fef3c7;">
                <td style="padding: 10px 14px; color: #6b7280; font-size: 14px;">Shuma e papaguar</td>
                <td style="padding: 10px 14px; color: #92400e; font-weight: bold; font-size: 16px;">${outstandingStr}</td>
              </tr>${settledRowHtml}
              <tr>
                <td style="padding: 10px 14px; color: #6b7280; font-size: 14px;">Afati i pagesës</td>
                <td style="padding: 10px 14px; color: #111827;">${dueDateStr}</td>
              </tr>
            </table>
            ${bankDetailsHtml}
            ${payButtonHtml}
            <p style="color: #374151;">Ju lutemi kryeni pagesën sa më shpejt për të shmangur kamatat e vonimit.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">FivoCRM — Njoftime automatike &bull; Mos iu përgjigjeni këtij emaili direkt.</p>
          </div>
        </div>
      `,
    };
  }

  // overdue — the invoice is already late; say so honestly.
  if (type === 'overdue') {
    const late = Math.max(1, Math.round(daysOverdue ?? 1));
    const lateLabel = late === 1 ? '1 ditë' : `${late} ditë`;
    return {
      subject: `🔴 Faturë e papaguar #${invoiceNumber} — ${lateLabel} vonesë`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9fafb; border-radius: 8px;">
          <div style="background: #ef4444; padding: 20px 24px; border-radius: 6px 6px 0 0;">
            <h2 style="color: white; margin: 0; font-size: 20px;">🔴 Faturë e Papaguar</h2>
          </div>
          <div style="background: white; padding: 24px; border-radius: 0 0 6px 6px; border: 1px solid #e5e7eb;">
            <p style="color: #374151; margin-top: 0;">I/E dashur <strong>${escHtml(customerName)}</strong>,</p>
            <p style="color: #374151;">Fatura <strong>#${escHtml(invoiceNumber)}</strong> — shërbimi <strong>${escHtml(projectName)}</strong> — ka kaluar afatin e pagesës prej <strong>${lateLabel}</strong>.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tr style="background: #fee2e2;">
                <td style="padding: 10px 14px; color: #6b7280; font-size: 14px;">Shuma e papaguar</td>
                <td style="padding: 10px 14px; color: #991b1b; font-weight: bold; font-size: 16px;">${outstandingStr}</td>
              </tr>${settledRowHtml}
              <tr>
                <td style="padding: 10px 14px; color: #6b7280; font-size: 14px;">Afati ishte</td>
                <td style="padding: 10px 14px; color: #111827; font-weight: bold;">${dueDateStr}</td>
              </tr>
            </table>
            ${bankDetailsHtml}
            ${payButtonHtml}
            <p style="color: #dc2626; font-weight: bold;">Ju lutemi kryeni pagesën sa më shpejt. Nëse pagesa është kryer tashmë, na njoftoni që ta regjistrojmë.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">FivoCRM — Njoftime automatike &bull; Mos iu përgjigjeni këtij emaili direkt.</p>
          </div>
        </div>
      `,
    };
  }

  // reminder2 — final notice, sent ON the due day.
  return {
    subject: `🔴 Njoftim i fundit: Fatura #${invoiceNumber} skadon sot`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9fafb; border-radius: 8px;">
        <div style="background: #ef4444; padding: 20px 24px; border-radius: 6px 6px 0 0;">
          <h2 style="color: white; margin: 0; font-size: 20px;">🔴 Njoftim i Fundit</h2>
        </div>
        <div style="background: white; padding: 24px; border-radius: 0 0 6px 6px; border: 1px solid #e5e7eb;">
          <p style="color: #374151; margin-top: 0;">I/E dashur <strong>${escHtml(customerName)}</strong>,</p>
          <p style="color: #374151;">Ju njoftojmë se sot është dita e fundit e pagesës për faturën <strong>#${escHtml(invoiceNumber)}</strong> — shërbimi <strong>${escHtml(projectName)}</strong>.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr style="background: #fee2e2;">
              <td style="padding: 10px 14px; color: #6b7280; font-size: 14px;">Shuma e papaguar</td>
              <td style="padding: 10px 14px; color: #991b1b; font-weight: bold; font-size: 16px;">${outstandingStr}</td>
            </tr>${settledRowHtml}
            <tr>
              <td style="padding: 10px 14px; color: #6b7280; font-size: 14px;">Afati skadon</td>
              <td style="padding: 10px 14px; color: #111827; font-weight: bold;">${dueDateStr}</td>
            </tr>
          </table>
          ${bankDetailsHtml}
          ${payButtonHtml}
          <p style="color: #dc2626; font-weight: bold;">Pagesa duhet të kryhet sot. Pas kësaj date fatura do të shënohet si e skaduar.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">FivoCRM — Njoftime automatike &bull; Mos iu përgjigjeni këtij emaili direkt.</p>
        </div>
      </div>
    `,
  };
}

function escHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
