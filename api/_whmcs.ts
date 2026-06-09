import crypto from 'crypto';

/**
 * WHMCS API client + helpers (server-side only).
 *
 * WHMCS is the source of truth; FivoCRM only mirrors data one-way.
 * The WHMCS external API is a single endpoint that accepts
 * application/x-www-form-urlencoded POSTs and returns JSON.
 *
 * Required env vars:
 *   WHMCS_API_URL         — base WHMCS install URL, e.g. https://billing.example.com
 *   WHMCS_API_IDENTIFIER  — API credential identifier
 *   WHMCS_API_SECRET      — API credential secret
 *   WHMCS_WEBHOOK_SECRET  — shared secret for HMAC-signing webhook payloads
 */

// ── Config ──────────────────────────────────────────────────────────────────
function apiUrl(): string {
  let base = process.env.WHMCS_API_URL;
  if (!base) throw new Error('WHMCS_API_URL nuk është konfiguruar');
  base = base.trim();
  // Tolerate a URL set without a scheme (e.g. "app.cloudfivo.com") — fetch needs one.
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  return `${base.replace(/\/$/, '')}/includes/api.php`;
}

export function whmcsConfigured(): boolean {
  // Credentials are always needed; the target can be either a direct WHMCS URL
  // or the VPS proxy (static IP) — at least one must be set.
  const hasCreds = !!(process.env.WHMCS_API_IDENTIFIER && process.env.WHMCS_API_SECRET);
  const hasTarget = !!(process.env.WHMCS_API_URL || process.env.WHMCS_PROXY_URL);
  return hasCreds && hasTarget;
}

// ── Core call ─────────────────────────────────────────────────────────────────
export async function whmcsCall(action: string, params: Record<string, string | number> = {}): Promise<any> {
  const identifier = process.env.WHMCS_API_IDENTIFIER;
  const secret = process.env.WHMCS_API_SECRET;
  if (!identifier || !secret) throw new Error('WHMCS_API_IDENTIFIER/SECRET nuk janë konfiguruar');

  const body = new URLSearchParams({
    identifier,
    secret,
    action,
    responsetype: 'json',
  });
  for (const [k, v] of Object.entries(params)) body.set(k, String(v));

  // When WHMCS_PROXY_URL is set, route the call through the VPS (static IP) so
  // WHMCS sees a stable, whitelisted IP instead of Vercel's dynamic ones.
  const proxyUrl = process.env.WHMCS_PROXY_URL;
  const resp = proxyUrl
    ? await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.WHMCS_PROXY_SECRET || '',
        },
        body: JSON.stringify({ form: body.toString() }),
        signal: AbortSignal.timeout(25_000),
      })
    : await fetch(apiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(20_000),
      });

  const text = await resp.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`WHMCS API ktheu përgjigje jo-JSON (${resp.status}): ${text.slice(0, 200)}`);
  }
  if (data?.result !== 'success') {
    throw new Error(`WHMCS API "${action}" dështoi: ${data?.message || 'gabim i panjohur'}`);
  }
  return data;
}

// ── Webhook signature (HMAC-SHA256) ───────────────────────────────────────────
export function verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined): boolean {
  const secret = process.env.WHMCS_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Typed shapes returned to the sync layer ───────────────────────────────────
export type FivoInvoiceStatus = 'Draft' | 'Pending' | 'Paid' | 'Overdue' | 'Partial';

export interface MappedInvoice {
  whmcsInvoiceId: string;
  whmcsClientId: string;
  status: FivoInvoiceStatus;
  amount: number;
  total: number;
  subtotal: number;
  tax: number;
  currency: 'ALL' | 'EUR';
  invoiceNumber: string;
  invoiceDate: Date | null;
  dueDate: Date | null;
  paidAt: Date | null;
  notes: string;
}

export interface MappedSubscription {
  whmcsServiceId: string;
  whmcsClientId: string;
  productName: string;
  domain: string;
  status: 'Active' | 'Suspended' | 'Terminated' | 'Pending' | 'Cancelled';
  recurringAmount: number;
  currency: 'ALL' | 'EUR';
  billingCycle: string;
  nextDueDate: Date | null;
}

export interface MappedClient {
  email: string;
  name: string;
  phone: string;
  company: string;
}

export interface MappedClientFull extends MappedClient {
  whmcsClientId: string;
  address: string;
  status: string;
}

// ── Pure mappers (no I/O) ─────────────────────────────────────────────────────
function parseWhmcsDate(v: unknown): Date | null {
  if (!v || typeof v !== 'string') return null;
  // WHMCS uses '0000-00-00' for "not set"
  if (v.startsWith('0000')) return null;
  const d = new Date(v.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

function normalizeCurrency(code: unknown): 'ALL' | 'EUR' {
  const c = String(code || '').toUpperCase();
  return c === 'ALL' || c === 'LEK' ? 'ALL' : 'EUR';
}

/** Map a WHMCS invoice status (+ duedate) to a FivoCRM invoice status. */
export function mapWhmcsStatus(whmcsStatus: string, dueDate: Date | null): FivoInvoiceStatus {
  const s = (whmcsStatus || '').toLowerCase();
  if (s === 'paid') return 'Paid';
  if (s === 'cancelled' || s === 'refunded' || s === 'collections' || s === 'draft') return 'Draft';
  if (s === 'overdue') return 'Overdue';
  // 'unpaid' / 'payment pending' → Pending, but flip to Overdue if past due
  if (dueDate && dueDate < new Date()) return 'Overdue';
  return 'Pending';
}

/** Map a raw WHMCS invoice object (from GetInvoice/GetInvoices) to FivoCRM shape. */
export function mapWhmcsInvoice(inv: any): MappedInvoice {
  const dueDate = parseWhmcsDate(inv.duedate);
  const total = Number(inv.total ?? 0);
  return {
    whmcsInvoiceId: String(inv.id ?? inv.invoiceid),
    whmcsClientId: String(inv.userid ?? inv.clientid ?? ''),
    status: mapWhmcsStatus(String(inv.status || ''), dueDate),
    amount: total,
    total,
    subtotal: Number(inv.subtotal ?? total),
    tax: Number(inv.tax ?? 0) + Number(inv.tax2 ?? 0),
    currency: normalizeCurrency(inv.currencycode || inv.currency_code),
    invoiceNumber: inv.invoicenum ? String(inv.invoicenum) : `WHMCS-${inv.id ?? inv.invoiceid}`,
    invoiceDate: parseWhmcsDate(inv.date),
    dueDate,
    paidAt: parseWhmcsDate(inv.datepaid),
    notes: String(inv.notes || '').slice(0, 2000),
  };
}

const WHMCS_SERVICE_STATUS: Record<string, MappedSubscription['status']> = {
  active: 'Active',
  suspended: 'Suspended',
  terminated: 'Terminated',
  cancelled: 'Cancelled',
  pending: 'Pending',
  fraud: 'Cancelled',
  completed: 'Active',
};

/** Map a raw WHMCS client product (from GetClientsProducts) to FivoCRM subscription shape. */
export function mapWhmcsProduct(p: any): MappedSubscription {
  return {
    whmcsServiceId: String(p.id),
    whmcsClientId: String(p.clientid ?? p.userid ?? ''),
    productName: String(p.name || p.productname || p.translated_name || 'Shërbim'),
    domain: String(p.domain || ''),
    status: WHMCS_SERVICE_STATUS[String(p.status || '').toLowerCase()] || 'Pending',
    recurringAmount: Number(p.recurringamount ?? 0),
    currency: normalizeCurrency(p.currencycode),
    billingCycle: String(p.billingcycle || ''),
    nextDueDate: parseWhmcsDate(p.nextduedate),
  };
}

export function mapWhmcsClient(c: any): MappedClient {
  const first = c.firstname || '';
  const last = c.lastname || '';
  const fullName = `${first} ${last}`.trim();
  return {
    email: String(c.email || '').trim().toLowerCase(),
    name: c.companyname ? String(c.companyname) : (fullName || String(c.email || '').trim()),
    phone: String(c.phonenumber || c.phone || '').trim(),
    company: String(c.companyname || '').trim(),
  };
}

/** Richer client mapping (adds id, address, status) for the dedicated client sync. */
export function mapWhmcsClientFull(c: any): MappedClientFull {
  const base = mapWhmcsClient(c);
  const address = [c.address1, c.address2, c.city, c.state, c.postcode, c.country]
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(', ');
  return {
    ...base,
    whmcsClientId: String(c.id ?? c.userid ?? c.client_id ?? c.clientid ?? ''),
    address,
    status: String(c.status || ''),
  };
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────
export async function fetchInvoice(invoiceId: string | number): Promise<MappedInvoice> {
  const data = await whmcsCall('GetInvoice', { invoiceid: invoiceId });
  return mapWhmcsInvoice(data);
}

export async function fetchClient(clientId: string | number): Promise<MappedClient> {
  const data = await whmcsCall('GetClientsDetails', { clientid: clientId, stats: 'false' });
  // GetClientsDetails returns client fields at top level (and nested under `client`)
  return mapWhmcsClient(data.client || data);
}

export async function fetchClientProduct(serviceId: string | number): Promise<MappedSubscription | null> {
  const data = await whmcsCall('GetClientsProducts', { serviceid: serviceId });
  const product = data?.products?.product?.[0];
  return product ? mapWhmcsProduct(product) : null;
}
