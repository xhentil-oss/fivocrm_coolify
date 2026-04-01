/**
 * Shared invoice email HTML builder + sender.
 * Imported by recurring-invoices cron and invoice-reminders cron.
 * NOT a Vercel route (underscore prefix is ignored by Vercel routing).
 */

export interface InvoiceEmailData {
  customerName: string;
  invoiceNumber: string;
  amount: number;
  dueDate: Date;
  projectName: string;
  type: 'initial' | 'reminder1' | 'reminder2';
  currency?: 'ALL' | 'EUR';
  paymentMethod?: string;
  bankName?: string;
  bankIBAN?: string;
  bankSWIFT?: string;
  bankAccountHolder?: string;
  bankCountry?: string;
}

export function buildInvoiceEmail(data: InvoiceEmailData): { subject: string; html: string } {
  const { customerName, invoiceNumber, amount, dueDate, projectName, type, currency, paymentMethod, bankName, bankIBAN, bankSWIFT, bankAccountHolder, bankCountry } = data;
  const currencySymbol = currency === 'EUR' ? '€' : 'L';
  const currencyLabel = currency === 'EUR' ? 'EUR' : 'ALL';
  const amountStr = amount.toLocaleString('sq-AL') + ' ' + currencySymbol;
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
                <td style="padding: 10px 14px; color: #92400e; font-weight: bold; font-size: 16px;">${amountStr}</td>
              </tr>
              <tr>
                <td style="padding: 10px 14px; color: #6b7280; font-size: 14px;">Afati i pagesës</td>
                <td style="padding: 10px 14px; color: #111827;">${dueDateStr}</td>
              </tr>
            </table>
            ${bankDetailsHtml}
            <p style="color: #374151;">Ju lutemi kryeni pagesën sa më shpejt për të shmangur kamatat e vonimit.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">FivoCRM — Njoftime automatike &bull; Mos iu përgjigjeni këtij emaili direkt.</p>
          </div>
        </div>
      `,
    };
  }

  // reminder2 — final notice
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
              <td style="padding: 10px 14px; color: #991b1b; font-weight: bold; font-size: 16px;">${amountStr}</td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; color: #6b7280; font-size: 14px;">Afati skadon</td>
              <td style="padding: 10px 14px; color: #111827; font-weight: bold;">${dueDateStr}</td>
            </tr>
          </table>
          ${bankDetailsHtml}
          <p style="color: #dc2626; font-weight: bold;">Pagesa duhet të kryhet sot. Pas kësaj date fatura do të shënohet si e skalur.</p>
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
