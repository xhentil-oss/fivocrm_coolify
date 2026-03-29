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
}

export function buildInvoiceEmail(data: InvoiceEmailData): { subject: string; html: string } {
  const { customerName, invoiceNumber, amount, dueDate, projectName, type } = data;
  const amountStr = amount.toLocaleString('sq-AL') + ' L';
  const dueDateStr = dueDate.toLocaleDateString('sq-AL', { day: '2-digit', month: 'long', year: 'numeric' });

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
