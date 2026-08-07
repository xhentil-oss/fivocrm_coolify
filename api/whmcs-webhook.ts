import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyWebhookSignature } from './_whmcs.js';
import { syncInvoiceById, syncSubscriptionById, syncClientById } from './_whmcsSync.js';

/**
 * Real-time receiver for WHMCS hook events (see scripts/whmcs/whmcs-hook-fivocrm.php).
 *
 * The WHMCS hook POSTs a small JSON body { event, invoiceId?, serviceId?, clientId? }
 * signed with HMAC-SHA256 (header `x-whmcs-signature`). We re-fetch the full record
 * from the WHMCS API and upsert it — WHMCS stays the source of truth.
 */

// Raw body is required for signature verification.
export const config = {
  api: { bodyParser: false },
};

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const INVOICE_EVENTS = new Set([
  'InvoiceCreated', 'InvoiceCreation', 'InvoiceModified', 'AfterInvoiceModified',
  'InvoicePaid', 'InvoiceUnpaid', 'InvoiceCancelled', 'InvoiceRefunded',
  'UpdateInvoiceTotal', 'AddInvoicePayment',
]);

const SERVICE_EVENTS = new Set([
  'AfterModuleCreate', 'AcceptOrder', 'AfterModuleSuspend', 'AfterModuleUnsuspend',
  'AfterModuleTerminate', 'ServiceEdit', 'ServiceStatusChange', 'ServiceUnsuspend',
  'ServiceSuspend', 'ServiceTerminate',
]);

const CLIENT_EVENTS = new Set([
  'ClientAdd', 'ClientEdit', 'AcceptRegistration', 'ClientDetailsEdit',
  'ClientChangePassword', 'UserEdit',
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let rawBody: Buffer;
  try {
    rawBody = await getRawBody(req);
  } catch {
    return res.status(400).json({ error: 'Could not read body' });
  }

  const signature = req.headers['x-whmcs-signature'] as string | undefined;
  if (!verifyWebhookSignature(rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString('utf8') || '{}');
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const event = String(payload.event || '');
  // Acknowledge immediately; do the WHMCS round-trip then respond.
  try {
    if (CLIENT_EVENTS.has(event) && payload.clientId) {
      await syncClientById(payload.clientId);
    } else if (INVOICE_EVENTS.has(event) && payload.invoiceId) {
      await syncInvoiceById(payload.invoiceId, payload.clientId);
    } else if (SERVICE_EVENTS.has(event) && payload.serviceId) {
      await syncSubscriptionById(payload.serviceId);
    } else {
      // Unknown / unhandled event — ack so WHMCS doesn't retry forever.
      return res.status(200).json({ received: true, handled: false, event });
    }
  } catch (err: any) {
    console.error(`[whmcs-webhook] event=${event} failed:`, err?.message || err);
    return res.status(500).json({ error: 'Sync failed', detail: err?.message });
  }

  return res.status(200).json({ received: true, handled: true, event });
}
