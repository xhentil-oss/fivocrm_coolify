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
/**
 * Coerce an env-provided URL to a valid https URL. Tolerates a missing scheme
 * ("wa.fivocrm.com") AND a malformed/typo scheme ("ttps://", "htps://", "http//")
 * — both are common when pasting into a dashboard. A correct http(s):// is kept.
 */
function normalizeUrl(raw: string): string {
  let u = (raw || '').trim();
  if (/^https?:\/\//i.test(u)) return u;          // already valid http/https
  u = u.replace(/^[a-zA-Z][\w+.-]*:?\/\/+/, '');  // strip any broken scheme prefix
  return `https://${u}`;
}

function apiUrl(): string {
  const base = process.env.WHMCS_API_URL;
  if (!base) throw new Error('WHMCS_API_URL nuk është konfiguruar');
  return `${normalizeUrl(base).replace(/\/$/, '')}/includes/api.php`;
}

export function whmcsConfigured(): boolean {
  // WHMCS_API_URL + credentials are always required (the URL is built on Vercel
  // even in proxy mode). WHMCS_PROXY_URL is optional — when set, calls are
  // relayed through the VPS's static IP instead of hitting WHMCS directly.
  return !!(
    process.env.WHMCS_API_URL &&
    process.env.WHMCS_API_IDENTIFIER &&
    process.env.WHMCS_API_SECRET
  );
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
  const rawProxy = process.env.WHMCS_PROXY_URL?.trim();
  const proxyUrl = rawProxy ? normalizeUrl(rawProxy) : undefined;
  let resp: Response;
  try {
    resp = proxyUrl
      ? await fetch(proxyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.WHMCS_PROXY_SECRET || '',
          },
          // Send the WHMCS target URL too (built from Vercel's WHMCS_API_URL) so
          // the VPS relay needs no WHMCS env of its own.
          body: JSON.stringify({ url: apiUrl(), form: body.toString() }),
          signal: AbortSignal.timeout(28_000),
        })
      : await fetch(apiUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          signal: AbortSignal.timeout(20_000),
        });
  } catch (err: any) {
    // Bare "fetch failed" hides the real reason. undici always attaches it to
    // `err.cause` — surface code/message + whether it was our timeout, so the
    // sync's errorDetail tells us DNS vs refused vs timeout vs TLS at a glance.
    const cause = err?.cause;
    const isTimeout = err?.name === 'TimeoutError' || cause?.name === 'TimeoutError';
    const reason = isTimeout
      ? `timeout pas ${proxyUrl ? 28 : 20}s`
      : (cause?.code || cause?.message || err?.message || 'arsye e panjohur');
    const where = proxyUrl ? `proxy (${proxyUrl})` : 'WHMCS direkt';
    throw new Error(`Lidhja me ${where} dështoi: ${reason}`);
  }

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
  // Trim the secret: a stray trailing newline/space when pasted into the Vercel
  // env (or the PHP define) silently breaks every signature → 401. The PHP hook
  // trims its side too, so both compute the HMAC over the same key bytes.
  const secret = process.env.WHMCS_WEBHOOK_SECRET?.trim();
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Typed shapes returned to the sync layer ───────────────────────────────────
export type FivoInvoiceStatus = 'Draft' | 'Pending' | 'Paid' | 'Overdue' | 'Partial' | 'Cancelled';

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
  /** Line items — present only when fetched via GetInvoice (single), e.g. the webhook path. */
  lineItems?: { description: string; amount: number; type: string }[];
  /** Short product/services summary derived from line items (for list display). */
  productSummary?: string;
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

export interface MappedDomain {
  whmcsDomainId: string;
  whmcsClientId: string;
  domainName: string;
  status: string;              // Active / Pending / Expired / Cancelled / ...
  registrationDate: Date | null;
  expiryDate: Date | null;
  recurringAmount: number;
  currency: 'ALL' | 'EUR';
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
  // Line items only exist on GetInvoice (single). WHMCS returns items.item as an
  // array or a single object — normalize. Each description holds the product name.
  const rawItems = inv.items?.item;
  const itemsArr = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  const lineItems = itemsArr
    .map((it: any) => ({ description: String(it.description || '').slice(0, 500), amount: Number(it.amount ?? 0), type: String(it.type || '') }))
    .filter((it: any) => it.description);
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
    ...(lineItems.length ? { lineItems, productSummary: lineItems.map((i: any) => i.description).join('; ').slice(0, 500) } : {}),
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

/** Map a raw WHMCS domain (from GetClientsDomains) to FivoCRM shape. */
export function mapWhmcsDomain(d: any): MappedDomain {
  return {
    whmcsDomainId: String(d.id ?? d.domainid ?? ''),
    whmcsClientId: String(d.userid ?? d.clientid ?? d.client_id ?? ''),
    domainName: String(d.domainname || d.domain || '').trim().toLowerCase(),
    status: String(d.status || ''),
    registrationDate: parseWhmcsDate(d.registrationdate || d.regdate),
    expiryDate: parseWhmcsDate(d.expirydate || d.nextduedate),
    recurringAmount: Number(d.recurringamount ?? 0),
    currency: normalizeCurrency(d.currencycode),
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
export async function fetchInvoice(invoiceId: string | number, clientId?: string | number): Promise<MappedInvoice> {
  try {
    const data = await whmcsCall('GetInvoice', { invoiceid: invoiceId });
    return mapWhmcsInvoice(data);
  } catch (err: any) {
    // Many WHMCS API roles allow GetInvoices (list) but NOT GetInvoice (single).
    // On a permission error, fall back to the permitted list endpoint, filtered
    // by the client when the webhook told us who it is, and pick the id out.
    if (!/not allowed|invalid permissions|permission/i.test(String(err?.message || ''))) throw err;
    const baseParams: Record<string, string | number> = clientId ? { userid: clientId } : {};
    for (let start = 0; ; start += 100) {
      const data = await whmcsCall('GetInvoices', { ...baseParams, limitstart: start, limitnum: 100 });
      const raw = data?.invoices?.invoice;
      const list: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const found = list.find((i) => String(i.id ?? i.invoiceid) === String(invoiceId));
      if (found) return mapWhmcsInvoice(found);
      if (list.length < 100) break;
    }
    throw new Error(`Fatura ${invoiceId} nuk u gjet përmes GetInvoices (GetInvoice i palejuar)`);
  }
}

export async function fetchClient(clientId: string | number): Promise<MappedClient> {
  const data = await whmcsCall('GetClientsDetails', { clientid: clientId, stats: 'false' });
  // GetClientsDetails returns client fields at top level (and nested under `client`)
  return mapWhmcsClient(data.client || data);
}

/** Full client details (id, address, status) for the real-time client webhook. */
export async function fetchClientFull(clientId: string | number): Promise<MappedClientFull> {
  const data = await whmcsCall('GetClientsDetails', { clientid: clientId, stats: 'false' });
  // Ensure the id survives even if GetClientsDetails omits it from the client block.
  return mapWhmcsClientFull({ id: clientId, ...(data.client || data) });
}

export async function fetchClientProduct(serviceId: string | number): Promise<MappedSubscription | null> {
  const data = await whmcsCall('GetClientsProducts', { serviceid: serviceId });
  const product = data?.products?.product?.[0];
  return product ? mapWhmcsProduct(product) : null;
}

// ── Manual payments (FivoCRM UI → WHMCS) ──────────────────────────────────────
/**
 * WHMCS `transid` for a payment recorded inside FivoCRM. Deterministic on
 * (invoice, key) so a retry — from the endpoint, the sync, or a re-mark after an
 * un-mark — hits WHMCS's "transaction id already exists" and is a no-op.
 */
export function manualPaymentTransId(invoiceDocId: string, key: string): string {
  return `fivocrm-${invoiceDocId}-${String(key || 'full').replace(/[^\w-]/g, '')}`;
}

/**
 * FivoCRM payment-method label → WHMCS gateway SYSTEM name. WHMCS shows the
 * gateway on the transaction; an unknown name is accepted but renders blank, so
 * offline methods fall back to `WHMCS_MANUAL_GATEWAY` (default `banktransfer`,
 * which every WHMCS install ships with).
 */
export function whmcsGatewayForMethod(method: string | undefined | null): string {
  const fallback = (process.env.WHMCS_MANUAL_GATEWAY || 'banktransfer').trim() || 'banktransfer';
  const m = String(method || '').trim().toLowerCase();
  if (!m) return fallback;
  if (/stripe|card|kart/.test(m)) return 'stripe';
  if (/paypal/.test(m)) return 'paypal';
  if (/bank|transfer|iban|swift/.test(m)) return 'banktransfer';
  if (/cash|kesh|dor/.test(m)) return 'mailin';
  return fallback;
}

// ── Write-back: record a payment on a WHMCS invoice (FivoCRM → WHMCS) ──────────
/**
 * Record a payment against a WHMCS invoice when a WHMCS-sourced invoice is paid
 * inside FivoCRM (e.g. via Stripe). This is the ONE place FivoCRM writes to WHMCS.
 *
 * `transId` MUST be unique (use the Stripe payment_intent / session id). WHMCS
 * rejects a duplicate transid, which gives us natural idempotency — we treat that
 * specific error as success so Stripe retries don't double-post.
 *
 * No infinite loop: WHMCS will fire its own InvoicePaid hook back to us, but the
 * inbound handler only re-syncs (status → Paid, already Paid) and never calls back.
 */
export async function pushInvoicePayment(args: {
  whmcsInvoiceId: string | number;
  transId: string;
  gateway?: string;
  amount?: number;
  date?: Date;
}): Promise<{ ok: boolean; alreadyRecorded?: boolean; message?: string }> {
  const params: Record<string, string | number> = {
    invoiceid: args.whmcsInvoiceId,
    transid: args.transId,
    gateway: args.gateway || 'stripe',
  };
  // Amount in the invoice's own currency. If omitted, WHMCS pays the full balance.
  if (typeof args.amount === 'number' && args.amount > 0) params.amount = args.amount.toFixed(2);
  if (args.date) params.date = args.date.toISOString().slice(0, 19).replace('T', ' ');

  try {
    await whmcsCall('AddInvoicePayment', params);
    return { ok: true };
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (/transaction id already exists/i.test(msg) || /duplicate/i.test(msg)) {
      return { ok: true, alreadyRecorded: true, message: msg };
    }
    return { ok: false, message: msg };
  }
}
