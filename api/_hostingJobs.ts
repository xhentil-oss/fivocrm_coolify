/**
 * Hosting & domains — the executor (server-only).
 *
 * Everything that TOUCHES a provider or MOVES money lives here and is shared by
 * the endpoint (`api/_hosting.ts`, a human pressing a button) and the cron
 * (`?job=hosting-lifecycle`, `?job=hosting-sync`). Decisions come from
 * `api/_hostingEngine.ts` (byte-identical to `src/lib/hosting/engine.ts`); this
 * file only fetches facts and executes.
 *
 * Laws:
 *   • A renewal invoice's document id is `hst_sub_<id>_<dueKey>` / `hst_dom_<id>_<expiryKey>`
 *     and is written with `create()` — the database refuses a second one.
 *   • Provisioning is per ORDER LINE and idempotent: a line that already carries a
 *     `subscriptionId`/`domainId` with `provisionStatus: 'provisioned'` is skipped.
 *     A subscription/domain doc id is derived from (orderId, line index).
 *   • A payment is applied once: the subscription's `currentInvoiceId` must equal
 *     the paid invoice; applying it advances the due date and clears the pointer.
 *   • Every provider call is written to `hostingEvents` (ok or not), passwords and
 *     tokens redacted. A failed provider call NEVER throws out of a job loop — it
 *     is stored on the record and counted.
 *   • Suspended tenants are skipped: the Admin SDK bypasses `tenantActive()`.
 */
import nodemailer from 'nodemailer';
import admin, { adminDb as db } from './_firebaseAdmin.js';
import { getTeamConfig } from './_tenantConfig.js';
import { notifyUser, BASE_URL } from './_push.js';
import { buildInvoiceEmail, publicInvoicePayUrl } from './_invoiceEmail.js';
import { safeSenderAddress, senderHeader } from './_emailIdentity.js';
import { formatMoney } from './_money.js';
import { decryptSecret } from './_secretCrypto.js';
import {
  CYCLE_LABELS, DEFAULT_LIFECYCLE, dayKey, decideDomain, decideSubscription, deriveCpanelUsername,
  generateAccountPassword, normalizeLifecycleConfig, nextDueDate, parseDomain, renewSubscriptionPatch,
  renewalInvoiceId, utcNoon, addYearsClamped, isBillingCycle, cycleFromWhmcs, suggestSellPrice, prorationQuote,
  nextRetryDelayMs, usageAlertLevel, buildExpiryReport, normalizeTld, cyclePrice,
  type BillingCycle, type DomainFacts, type LifecycleConfig, type SubscriptionFacts,
} from './_hostingEngine.js';
import { managerIdsForBusiness } from './_staffRecipients.js';
import {
  ProviderError, redactProviderError, isWhmAccountExists,
  whmCreateAccount, whmSuspendAccount, whmUnsuspendAccount, whmTerminateAccount, whmChangePackage, whmBackupAccount,
  whmSetPassword, whmCreateSession, whmAccountSummary, whmListAccounts, whmListPackages, whmVersion, normalizeHostname,
  dynadotRegister, dynadotRenew, dynadotTransfer, dynadotDomainInfo, dynadotSetNameservers, dynadotAccountInfo,
  dynadotTldPrices, dynadotSetDnsToIp,
  type WhmServer,
} from './_hostingProviders.js';

const Timestamp = admin.firestore.Timestamp;
type Ts = admin.firestore.Timestamp;

// ── Small helpers ──────────────────────────────────────────────────────────────

export function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof (v as any).toDate === 'function') return (v as any).toDate();
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isAlreadyExists(err: any): boolean {
  return err?.code === 6 || /ALREADY_EXISTS/i.test(String(err?.message || err?.details || ''));
}

export async function logHostingEvent(ev: {
  businessId?: string | null; teamId?: string | null; customerId?: string | null;
  subscriptionId?: string | null; domainId?: string | null; orderId?: string | null;
  type: string; ok: boolean; message: string; detail?: Record<string, unknown>; actorUserId?: string | null;
}): Promise<void> {
  try {
    await db.collection('hostingEvents').add({
      businessId: ev.businessId ?? null,
      teamId: ev.teamId ?? null,
      customerId: ev.customerId ?? null,
      subscriptionId: ev.subscriptionId ?? null,
      domainId: ev.domainId ?? null,
      orderId: ev.orderId ?? null,
      type: ev.type,
      ok: ev.ok,
      message: String(ev.message || '').slice(0, 500),
      detail: ev.detail ?? null,
      actorUserId: ev.actorUserId ?? null,
      createdAt: Timestamp.now(),
    });
  } catch (err) {
    console.error('[hosting] event write failed', err);
  }
}

export async function suspendedBusinessIds(): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const snap = await db.collection('businesses').where('status', '==', 'suspended').select().get();
    snap.docs.forEach((d) => out.add(d.id));
  } catch { /* a failed lookup must not stop the run */ }
  return out;
}

/** The team whose settings/secrets apply to a record (falls back to the business's first team). */
export async function teamIdForBusiness(businessId: string | null | undefined, hinted?: string | null): Promise<string | null> {
  if (hinted) return hinted;
  if (!businessId) return null;
  const snap = await db.collection('teams').where('businessId', '==', businessId).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

export async function lifecycleConfigFor(teamId: string | null): Promise<LifecycleConfig> {
  if (!teamId) return DEFAULT_LIFECYCLE;
  try {
    const s = await db.collection('teamSettings').doc(teamId).get();
    return normalizeLifecycleConfig(((s.data() as any) || {}).hostingLifecycle);
  } catch { return DEFAULT_LIFECYCLE; }
}

export async function dynadotKeyFor(teamId: string | null): Promise<string | null> {
  if (!teamId) return null;
  const cfg = await getTeamConfig(teamId);
  const key = typeof cfg.dynadotApiKey === 'string' ? cfg.dynadotApiKey.trim() : '';
  return key || null;
}

export async function dynadotCurrencyFor(teamId: string | null): Promise<string | undefined> {
  if (!teamId) return undefined;
  const s = await db.collection('teamSettings').doc(teamId).get();
  const c = ((s.data() as any) || {}).dynadotCurrency;
  return typeof c === 'string' && /^[A-Z]{3}$/.test(c) ? c : undefined;
}

/**
 * Server doc + its token from the deny-all `hostingServerSecrets` collection.
 *
 * The token is BOUND to the hostname + user it was saved for (stored next to it in
 * the secret doc). `hostingServers.hostname` is editable by any staff member with
 * the module; without the binding, re-pointing a server at an attacker's host would
 * make the next call hand them the root token. A mismatch yields an empty token
 * and `tokenIssue`, so every operation fails closed with a clear message.
 */
export async function loadServer(serverId: string): Promise<{ id: string; data: any; whm: WhmServer; tokenIssue?: string } | null> {
  if (!serverId) return null;
  const [doc, secret] = await Promise.all([
    db.collection('hostingServers').doc(serverId).get(),
    db.collection('hostingServerSecrets').doc(serverId).get(),
  ]);
  if (!doc.exists) return null;
  const data = doc.data() as any;
  const sec = (secret.data() as any) || {};
  let apiToken = '';
  let tokenIssue: string | undefined;
  if (sec.apiToken) {
    try { apiToken = decryptSecret(String(sec.apiToken)); } catch (err) { tokenIssue = redactProviderError(err); }
    const boundHost = sec.hostname ? normalizeHostname(String(sec.hostname)) : null;
    const boundUser = sec.username ? String(sec.username) : null;
    if (apiToken && boundHost && boundHost !== normalizeHostname(String(data.hostname || ''))) {
      apiToken = ''; tokenIssue = `Hostname-i ndryshoi pas ruajtjes së token-it (${boundHost} → ${data.hostname}) — rifut token-in`;
    } else if (apiToken && boundUser && boundUser !== String(data.username || 'root')) {
      apiToken = ''; tokenIssue = 'Përdoruesi WHM ndryshoi pas ruajtjes së token-it — rifut token-in';
    }
  }
  return {
    id: doc.id,
    data,
    whm: { hostname: data.hostname, port: Number(data.port) || 2087, username: data.username || 'root', apiToken },
    tokenIssue,
  };
}

function noTokenMessage(server: { data: any; tokenIssue?: string }): string {
  return server.tokenIssue || `Serveri "${server.data?.name || '?'}" nuk ka API token`;
}

/**
 * The WHM account a subscription points at must really be THIS customer's: same
 * primary domain in WHM as on the subscription. Without it, a row that names any
 * username on a shared server would let staff SSO into / reset / delete someone
 * else's account. Throws when the account is missing or belongs to another domain.
 */
export async function assertAccountOwned(server: WhmServer, username: string, domain: string | null | undefined): Promise<void> {
  const acct = await whmAccountSummary(server, username);
  if (!acct) throw new Error(`Llogaria "${username}" nuk ekziston në WHM`);
  const want = parseDomain(domain || '')?.name;
  const have = parseDomain(acct.domain)?.name;
  if (!want || !have || want !== have) {
    throw new Error(`Llogaria "${username}" në WHM i përket domain-it "${acct.domain}", jo "${domain || '?'}" — nuk lejohet`);
  }
}

export async function portalUserIdFor(customerId: string | null | undefined): Promise<string | null> {
  if (!customerId) return null;
  try {
    const snap = await db.collection('clientPortalAccess').where('customerId', '==', customerId).limit(1).get();
    if (snap.empty) return null;
    return String((snap.docs[0].data() as any).userId || '') || null;
  } catch { return null; }
}

async function customerFor(customerId: string | null | undefined): Promise<{ id: string; name: string; email: string | null } | null> {
  if (!customerId) return null;
  const snap = await db.collection('customers').doc(customerId).get();
  if (!snap.exists) return null;
  const c = snap.data() as any;
  return { id: snap.id, name: String(c.name || c.companyName || 'Klient'), email: c.email ? String(c.email) : null };
}

/** Staff who should hear about a hosting event: the record's creator, else the business's Admins. */
async function staffRecipients(businessId: string | null, createdByUserId?: string | null): Promise<string[]> {
  if (createdByUserId) return [createdByUserId];
  if (!businessId) return [];
  try {
    const snap = await db.collection('teamMembers')
      .where('businessId', '==', businessId).where('role', '==', 'Admin').limit(5).get();
    return snap.docs.map((d) => String((d.data() as any).userId || '')).filter(Boolean);
  } catch { return []; }
}

async function notifyMany(userIds: Array<string | null | undefined>, input: Omit<Parameters<typeof notifyUser>[0], 'userId'>): Promise<void> {
  const seen = new Set<string>();
  await Promise.allSettled(
    userIds.filter((u): u is string => !!u && !seen.has(u) && !!seen.add(u))
      .map((userId) => notifyUser({ ...input, userId }).catch((e) => console.error('[hosting] notify failed', e))),
  );
}

function platformTransporter() {
  const smtpUser = safeSenderAddress(process.env.SMTP_USER);
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) return null;
  return {
    transporter: nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'mail.fivoo.net',
      port: Number(process.env.SMTP_PORT) || 465,
      secure: true,
      auth: { user: smtpUser, pass: smtpPass },
    }),
    smtpUser,
  };
}

async function sendTenantMail(teamId: string | null, to: string, subject: string, html: string): Promise<boolean> {
  const t = platformTransporter();
  if (!t) return false;
  let fromName = 'FivoCRM';
  try {
    if (teamId) {
      const s = await db.collection('teamSettings').doc(teamId).get();
      const d = (s.data() as any) || {};
      fromName = d.emailFromName || d.companyName || fromName;
    }
  } catch { /* fall back to the platform name */ }
  try {
    await t.transporter.sendMail({ from: senderHeader(fromName, t.smtpUser), to, subject, html });
    return true;
  } catch (err) {
    console.error('[hosting] mail failed', err);
    return false;
  }
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ── Invoices raised by the module ──────────────────────────────────────────────

interface HostingInvoiceInput {
  id: string;
  label: string;
  businessId: string | null;
  teamId: string | null;
  customerId: string;
  currency: 'ALL' | 'EUR';
  amount: number;
  dueDate: Date;
  notes: string;
  items: Array<{ description: string; quantity: number; unitPrice: number }>;
  link: { hostingOrderId?: string; subscriptionId?: string; domainId?: string };
  createdByUserId: string | null;
}

/** `create()` — a second invoice with the same id is refused by the database. Returns false when it already existed. */
async function createHostingInvoice(inp: HostingInvoiceInput): Promise<boolean> {
  const ref = db.collection('invoices').doc(inp.id);
  const now = Timestamp.now();
  const total = Math.round(inp.amount * 100) / 100;
  const doc = {
    invoiceNumber: inp.label,
    customerId: inp.customerId,
    teamId: inp.teamId,
    businessId: inp.businessId,
    amount: total, subtotal: total, total, tax: 0, discount: 0, discountType: 'fixed',
    currency: inp.currency,
    status: 'Pending',
    notes: inp.notes,
    invoiceDate: now,
    dueDate: Timestamp.fromDate(inp.dueDate),
    isRecurring: false,
    autoGenerated: true,
    source: 'hosting',
    ...inp.link,
    lineItems: inp.items.map((i) => ({ description: i.description, amount: Math.round(i.unitPrice * i.quantity * 100) / 100, type: 'hosting' })),
    productSummary: inp.items.map((i) => i.description).join(', ').slice(0, 200),
    emailSent: false, reminderSent: false, reminder25Sent: false, reminderLastDaySent: false,
    createdByUserId: inp.createdByUserId,
    createdAt: now, updatedAt: now,
  };
  try {
    await ref.create(doc);
  } catch (err) {
    if (isAlreadyExists(err)) return false;
    throw err;
  }
  await Promise.allSettled(inp.items.map((i) => db.collection('invoiceItems').add({
    invoiceId: inp.id, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice,
    totalPrice: Math.round(i.unitPrice * i.quantity * 100) / 100,
    teamId: inp.teamId, businessId: inp.businessId, customerId: inp.customerId,
    createdAt: now, updatedAt: now,
  })));
  return true;
}

async function emailInvoiceToCustomer(invoiceId: string, customerId: string, teamId: string | null, opts: { amount: number; currency: 'ALL' | 'EUR'; dueDate: Date; subject: string; label: string }): Promise<boolean> {
  const customer = await customerFor(customerId);
  if (!customer?.email) return false;
  const { html } = buildInvoiceEmail({
    customerName: customer.name,
    invoiceNumber: opts.label,
    amount: opts.amount,
    dueDate: opts.dueDate,
    projectName: opts.subject,
    type: 'initial',
    currency: opts.currency,
    payUrl: await publicInvoicePayUrl(invoiceId, null),
  });
  const ok = await sendTenantMail(teamId, customer.email, `Faturë ${opts.label} — ${opts.subject}`, html);
  if (ok) await db.collection('invoices').doc(invoiceId).update({ emailSent: true, updatedAt: Timestamp.now() }).catch(() => {});
  return ok;
}

// ── Orders → invoice ───────────────────────────────────────────────────────────

/** Creates the first invoice of an order (id `hst_ord_<orderId>`). Idempotent. */
export async function invoiceForOrder(orderId: string, actorUid: string | null): Promise<{ invoiceId: string; created: boolean }> {
  const ref = db.collection('hostingOrders').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Porosia nuk u gjet');
  const o = snap.data() as any;
  const invoiceId = `hst_ord_${orderId}`;
  const total = Number(o.total) || 0;
  if (total <= 0) {
    // Free order (a 0-price package): nothing to collect, provision straight away.
    await ref.update({ status: 'Paid', invoiceId: null, paidAt: Timestamp.now(), updatedAt: Timestamp.now() });
    return { invoiceId: '', created: false };
  }
  const created = await createHostingInvoice({
    id: invoiceId,
    label: `HST-${o.orderNumber || orderId.slice(0, 6).toUpperCase()}`,
    businessId: o.businessId ?? null,
    teamId: o.teamId ?? null,
    customerId: o.customerId,
    currency: o.currency === 'EUR' ? 'EUR' : 'ALL',
    amount: total,
    dueDate: utcNoon(new Date(Date.now() + 7 * 86_400_000)),
    notes: `Porosi hosting/domain ${o.orderNumber || ''}`.trim(),
    items: (o.lines || []).map((l: any) => ({ description: l.description, quantity: 1, unitPrice: Number(l.total) || 0 })),
    link: { hostingOrderId: orderId },
    createdByUserId: actorUid,
  });
  await ref.update({ invoiceId, updatedAt: Timestamp.now() });
  if (created) {
    await emailInvoiceToCustomer(invoiceId, o.customerId, o.teamId ?? null, {
      amount: total, currency: o.currency === 'EUR' ? 'EUR' : 'ALL', dueDate: new Date(Date.now() + 7 * 86_400_000),
      subject: `Porosi ${o.orderNumber || ''}`.trim(), label: `HST-${o.orderNumber || orderId.slice(0, 6).toUpperCase()}`,
    }).catch(() => {});
  }
  return { invoiceId, created };
}

// ── Provisioning ───────────────────────────────────────────────────────────────

function orderNsFor(order: any, server: any, teamSettings: any): string[] {
  const fromSettings = Array.isArray(teamSettings?.hostingDefaultNameservers) ? teamSettings.hostingDefaultNameservers : [];
  const fromServer = Array.isArray(server?.nameservers) ? server.nameservers : [];
  const ns = (fromServer.length >= 2 ? fromServer : fromSettings).map((x: unknown) => String(x || '').trim().toLowerCase()).filter(Boolean);
  void order;
  return ns;
}

/**
 * Provision every unfulfilled line of a PAID order. Safe to call repeatedly: a
 * provisioned line is skipped, a failed one is retried. Returns the final order status.
 */
export async function provisionOrder(orderId: string, actorUid: string | null = null): Promise<{ status: string; lines: any[]; errors: string[] }> {
  const ref = db.collection('hostingOrders').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Porosia nuk u gjet');
  const order = snap.data() as any;
  if (order.status === 'Cancelled') throw new Error('Porosia është anuluar');
  if (order.status === 'Pending') throw new Error('Fatura e porosisë nuk është paguar ende');

  const lines: any[] = Array.isArray(order.lines) ? [...order.lines] : [];
  const errors: string[] = [];
  const businessId: string | null = order.businessId ?? null;
  const teamId = await teamIdForBusiness(businessId, order.teamId);
  const teamSettings = teamId ? ((await db.collection('teamSettings').doc(teamId).get()).data() as any) || {} : {};
  const customer = await customerFor(order.customerId);
  const portalUid = await portalUserIdFor(order.customerId);
  await ref.update({ status: 'Provisioning', updatedAt: Timestamp.now() });

  // Hosting lines first, so a domain in the same order can point at the new account's nameservers.
  const orderIdx = lines.map((_, i) => i).sort((a, b) => (lines[a].kind === 'hosting' ? 0 : 1) - (lines[b].kind === 'hosting' ? 0 : 1));
  let hostingNs: string[] = [];

  for (const i of orderIdx) {
    const line = lines[i];
    if (line.provisionStatus === 'provisioned') {
      if (line.kind === 'hosting' && line.subscriptionId) {
        const s = await db.collection('subscriptions').doc(line.subscriptionId).get();
        const srv = s.exists ? await loadServer(String((s.data() as any).serverId || '')) : null;
        if (srv) hostingNs = orderNsFor(order, srv.data, teamSettings);
      }
      continue;
    }
    try {
      if (line.kind === 'hosting') {
        const res = await provisionHostingLine({ order, orderId, index: i, line, teamId, teamSettings, customer, actorUid });
        lines[i] = { ...line, subscriptionId: res.subscriptionId, provisionStatus: 'provisioned', provisionError: null };
        hostingNs = res.nameservers;
      } else {
        const res = await provisionDomainLine({ order, orderId, index: i, line, teamId, teamSettings, nameservers: hostingNs, actorUid });
        lines[i] = { ...line, domainId: res.domainId, provisionStatus: res.pending ? 'pending' : 'provisioned', provisionError: null };
      }
    } catch (err) {
      const msg = redactProviderError(err);
      errors.push(`${line.description}: ${msg}`);
      lines[i] = { ...line, provisionStatus: 'failed', provisionError: msg };
    }
    await ref.update({ lines, updatedAt: Timestamp.now() });
  }

  const allDone = lines.every((l) => l.provisionStatus === 'provisioned' || l.provisionStatus === 'pending');
  const status = allDone ? 'Active' : 'Failed';
  // Transient provider failures retry on their own with exponential backoff
  // (15m → 1h → 4h → 12h → 24h); after the table a human must act.
  const retryCount = allDone ? 0 : (Number(order.retryCount) || 0) + 1;
  const delay = allDone ? null : nextRetryDelayMs(retryCount);
  await ref.update({
    status, lines,
    lastError: errors.length ? errors.join(' | ').slice(0, 900) : null,
    ...(allDone ? { provisionedAt: Timestamp.now(), retryCount: 0, nextRetryAt: null, retryExhausted: false } : {
      retryCount, nextRetryAt: delay ? Timestamp.fromDate(new Date(Date.now() + delay)) : null, retryExhausted: delay === null,
    }),
    updatedAt: Timestamp.now(),
  });

  if (errors.length) {
    // Tell staff on the FIRST failure and when retries are exhausted — not on
    // every automatic attempt in between.
    if (retryCount === 1 || delay === null) {
      await notifyMany(await staffRecipients(businessId, order.createdByUserId), {
        type: 'hosting_provision_failed',
        title: delay === null ? `⛔ Porosia ${order.orderNumber || ''}: ri-provat u shteruan` : `⚠️ Aktivizimi i porosisë ${order.orderNumber || ''} dështoi`,
        message: `${errors[0].slice(0, 160)}${delay ? ` — riprovohet automatikisht pas ${Math.round(delay / 60_000)} min.` : ' — nevojitet ndërhyrje.'}`,
        actionUrl: '/app/hosting?tab=orders',
        actionLabel: 'Shiko porositë',
        businessId, teamId, customerId: order.customerId,
      });
    }
  } else if (portalUid) {
    await notifyMany([portalUid], {
      type: 'hosting_provisioned',
      title: 'Shërbimet tuaja janë aktive ✓',
      message: `Porosia ${order.orderNumber || ''} u aktivizua. Detajet janë te "Hosting & Domain-e".`,
      actionUrl: '/portal/hosting',
      actionLabel: 'Shiko shërbimet',
      businessId, teamId, customerId: order.customerId,
    });
  }
  return { status, lines, errors };
}

async function provisionHostingLine(args: {
  order: any; orderId: string; index: number; line: any; teamId: string | null; teamSettings: any;
  customer: { id: string; name: string; email: string | null } | null; actorUid: string | null;
}): Promise<{ subscriptionId: string; nameservers: string[] }> {
  const { order, orderId, index, line, teamId, teamSettings, customer, actorUid } = args;
  const businessId: string | null = order.businessId ?? null;
  const subscriptionId = line.subscriptionId || `sub_${orderId}_${index}`;
  const subRef = db.collection('subscriptions').doc(subscriptionId);

  const productSnap = line.productId ? await db.collection('hostingProducts').doc(line.productId).get() : null;
  const product = productSnap?.exists ? (productSnap.data() as any) : null;
  if (!product) throw new Error('Paketa e hosting-ut nuk ekziston më');
  const server = await loadServer(String(product.serverId || ''));
  if (!server) throw new Error('Serveri i paketës nuk u gjet');
  if (!server.whm.apiToken) throw new Error(noTokenMessage(server));
  const dom = parseDomain(line.domainName);
  if (!dom) throw new Error('Domain i pavlefshëm për llogarinë');
  const cycle: BillingCycle = isBillingCycle(line.cycle) ? line.cycle : 'monthly';

  // Reuse the subscription doc across retries; create it Pending the first time.
  const existing = await subRef.get();
  const now = new Date();
  if (!existing.exists) {
    await subRef.create({
      businessId, teamId, customerId: order.customerId, source: 'fivocrm',
      productId: line.productId, productName: product.name, domain: dom.name,
      status: 'Pending', recurringAmount: Number(line.unitPrice) || 0, currency: line.currency || product.currency || 'EUR',
      billingCycle: cycle, nextDueDate: Timestamp.fromDate(nextDueDate(utcNoon(now), cycle, now.getUTCDate())), anchorDay: now.getUTCDate(),
      registrationDate: Timestamp.fromDate(utcNoon(now)),
      serverId: server.id, whmPackage: product.whmPackage,
      provisionStatus: 'pending', provisionError: null,
      // The first cycle is paid by the order's invoice — claim it so the lifecycle
      // never issues a second invoice for the same period.
      lastInvoicedDueKey: null, currentInvoiceId: null,
      orderId, createdAt: Timestamp.now(), updatedAt: Timestamp.now(), createdByUserId: actorUid,
    }).catch((e) => { if (!isAlreadyExists(e)) throw e; });
  }
  const sub = (await subRef.get()).data() as any;

  // Username: derived from the domain, unique on THIS server (our records + WHM itself).
  let username: string = sub.cpanelUsername || '';
  if (!username) {
    const taken = new Set<string>();
    const ours = await db.collection('subscriptions').where('serverId', '==', server.id).select('cpanelUsername').get();
    ours.docs.forEach((d) => { const u = (d.data() as any).cpanelUsername; if (u) taken.add(String(u)); });
    username = deriveCpanelUsername(dom.name, taken);
  }

  let nameservers: string[] = orderNsFor(order, server.data, teamSettings);
  const alreadyThere = await whmAccountSummary(server.whm, username).catch(() => null);
  if (alreadyThere && alreadyThere.domain?.toLowerCase() === dom.name) {
    // A previous run created it but died before recording — adopt it.
    await logHostingEvent({ businessId, teamId, customerId: order.customerId, subscriptionId, orderId, type: 'whm.createacct', ok: true, message: `Llogaria ${username} ekzistonte tashmë në WHM — u adoptua`, actorUserId: actorUid });
  } else {
    const password = generateAccountPassword();
    let attempt = 0;
    for (;;) {
      try {
        const created = await whmCreateAccount(server.whm, {
          username, domain: dom.name, plan: product.whmPackage, password, contactEmail: customer?.email || undefined,
        });
        if (created.nameservers.length >= 2) nameservers = created.nameservers;
        await logHostingEvent({ businessId, teamId, customerId: order.customerId, subscriptionId, orderId, type: 'whm.createacct', ok: true, message: `Llogaria ${username} u krijua për ${dom.name} (${product.whmPackage})`, detail: { ip: created.ip ?? null }, actorUserId: actorUid });
        break;
      } catch (err) {
        if (isWhmAccountExists(err) && attempt < 5 && !/domain/i.test(String((err as Error).message))) {
          attempt++;
          username = deriveCpanelUsername(dom.name, [username, `${username}${attempt}`]);
          continue;
        }
        await logHostingEvent({ businessId, teamId, customerId: order.customerId, subscriptionId, orderId, type: 'whm.createacct', ok: false, message: redactProviderError(err), actorUserId: actorUid });
        await subRef.update({ provisionStatus: 'failed', provisionError: redactProviderError(err), cpanelUsername: username, updatedAt: Timestamp.now() });
        throw err;
      }
    }
    // Welcome mail — WITHOUT the password: the customer logs in through the portal
    // (one-click cPanel SSO) and sets a password of their own from there. A password
    // in a mailbox outlives the mailbox's security; the generated one is discarded.
    if (customer?.email) {
      const cpanelUrl = `https://${server.data.hostname}:2083`;
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111">
          <h2 style="color:#12468C">Llogaria juaj e hosting-ut është gati</h2>
          <p>Përshëndetje ${esc(customer.name)},</p>
          <p>Paketa <strong>${esc(product.name)}</strong> për <strong>${esc(dom.name)}</strong> u aktivizua.</p>
          <table style="border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:6px 12px;color:#555">cPanel</td><td style="padding:6px 12px"><a href="${cpanelUrl}">${cpanelUrl}</a></td></tr>
            <tr><td style="padding:6px 12px;color:#555">Përdoruesi</td><td style="padding:6px 12px"><code>${esc(username)}</code></td></tr>
            <tr><td style="padding:6px 12px;color:#555">Nameservers</td><td style="padding:6px 12px">${nameservers.map(esc).join('<br>') || '—'}</td></tr>
          </table>
          <p>Hyni në cPanel me një klik nga portali juaj: <a href="${BASE_URL}/portal/hosting">${BASE_URL}/portal/hosting</a> → "Hyr në cPanel".</p>
          <p style="color:#777;font-size:12px">Për arsye sigurie fjalëkalimi nuk dërgohet me email. Nga portali mund të gjeneroni një fjalëkalim tuajin ("Fjalëkalim i ri").</p>
        </div>`;
      await sendTenantMail(teamId, customer.email, `Llogaria e hosting-ut për ${dom.name} është gati`, html);
    }
  }

  await subRef.update({
    status: 'Active', cpanelUsername: username, provisionStatus: 'provisioned', provisionError: null,
    provisionedAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
  return { subscriptionId, nameservers };
}

async function provisionDomainLine(args: {
  order: any; orderId: string; index: number; line: any; teamId: string | null; teamSettings: any; nameservers: string[]; actorUid: string | null;
}): Promise<{ domainId: string; pending: boolean }> {
  const { order, orderId, index, line, teamId, teamSettings, actorUid } = args;
  const businessId: string | null = order.businessId ?? null;
  const domainId = line.domainId || `dom_${orderId}_${index}`;
  const domRef = db.collection('domains').doc(domainId);
  const dom = parseDomain(line.domainName);
  if (!dom) throw new Error('Domain i pavlefshëm');
  const years = Math.max(1, Math.floor(Number(line.years) || 1));
  const isTransfer = line.kind === 'domain-transfer';

  const existing = await domRef.get();
  if (!existing.exists) {
    await domRef.create({
      businessId, teamId, customerId: order.customerId, source: 'fivocrm', registrar: 'dynadot',
      domainName: dom.name, tld: dom.tld, status: 'Pending', years,
      recurringAmount: Number(line.unitPrice) || 0, currency: line.currency || 'EUR', autoRenew: true,
      provisionStatus: 'pending', provisionError: null, orderId,
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(), createdByUserId: actorUid,
    }).catch((e) => { if (!isAlreadyExists(e)) throw e; });
  }
  const apiKey = await dynadotKeyFor(teamId);
  if (!apiKey) throw new Error('Çelësi i Dynadot nuk është konfiguruar (Hosting → Cilësimet)');
  const currency = await dynadotCurrencyFor(teamId);

  // Did a previous run already register it? Ask the registrar before paying again.
  const info = await dynadotDomainInfo(apiKey, dom.name).catch(() => null);
  if (info && !isTransfer) {
    await logHostingEvent({ businessId, teamId, customerId: order.customerId, domainId, orderId, type: 'dynadot.register', ok: true, message: `${dom.name} ishte tashmë në llogarinë Dynadot — u adoptua`, actorUserId: actorUid });
  } else if (isTransfer) {
    try {
      await dynadotTransfer(apiKey, dom.name, String(line.authCode || ''), { currency });
      await logHostingEvent({ businessId, teamId, customerId: order.customerId, domainId, orderId, type: 'dynadot.transfer', ok: true, message: `Transferimi i ${dom.name} u nis`, actorUserId: actorUid });
    } catch (err) {
      await logHostingEvent({ businessId, teamId, customerId: order.customerId, domainId, orderId, type: 'dynadot.transfer', ok: false, message: redactProviderError(err), actorUserId: actorUid });
      await domRef.update({ provisionStatus: 'failed', provisionError: redactProviderError(err), updatedAt: Timestamp.now() });
      throw err;
    }
    // A transfer completes days later; `hosting-sync` flips it to Active when the registrar lists it.
    await domRef.update({ status: 'Pending', provisionStatus: 'pending', provisionError: null, updatedAt: Timestamp.now() });
    return { domainId, pending: true };
  } else {
    try {
      const reg = await dynadotRegister(apiKey, dom.name, years, { currency });
      await logHostingEvent({ businessId, teamId, customerId: order.customerId, domainId, orderId, type: 'dynadot.register', ok: true, message: `${dom.name} u regjistrua për ${years} vit(e)`, detail: { expiration: reg.expiration?.toISOString() ?? null }, actorUserId: actorUid });
    } catch (err) {
      await logHostingEvent({ businessId, teamId, customerId: order.customerId, domainId, orderId, type: 'dynadot.register', ok: false, message: redactProviderError(err), actorUserId: actorUid });
      await domRef.update({ provisionStatus: 'failed', provisionError: redactProviderError(err), updatedAt: Timestamp.now() });
      throw err;
    }
  }

  // Nameservers: the hosting account in this order → the tenant default → leave Dynadot's.
  const ns = (args.nameservers.length >= 2 ? args.nameservers
    : (Array.isArray(teamSettings?.hostingDefaultNameservers) ? teamSettings.hostingDefaultNameservers : [])) as string[];
  let nsSet: string[] | undefined;
  if (ns.length >= 2) {
    try {
      await dynadotSetNameservers(apiKey, dom.name, ns);
      nsSet = ns;
      await logHostingEvent({ businessId, teamId, customerId: order.customerId, domainId, orderId, type: 'dynadot.set_ns', ok: true, message: `NS për ${dom.name}: ${ns.join(', ')}`, actorUserId: actorUid });
    } catch (err) {
      // Not fatal: the domain IS registered. Staff can retry from the domain row.
      await logHostingEvent({ businessId, teamId, customerId: order.customerId, domainId, orderId, type: 'dynadot.set_ns', ok: false, message: redactProviderError(err), actorUserId: actorUid });
    }
  }

  const fresh = await dynadotDomainInfo(apiKey, dom.name).catch(() => null);
  const expiry = fresh?.expiration ?? info?.expiration ?? addYearsClamped(utcNoon(new Date()), years);
  await domRef.update({
    status: 'Active', provisionStatus: 'provisioned', provisionError: null,
    registrationDate: Timestamp.fromDate(fresh?.registration ?? utcNoon(new Date())),
    expiryDate: Timestamp.fromDate(utcNoon(expiry)),
    ...(nsSet ? { nameservers: nsSet } : fresh?.nameservers?.length ? { nameservers: fresh.nameservers } : {}),
    ...(fresh?.locked !== undefined ? { locked: fresh.locked } : {}),
    lastSyncAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
  const portalUid = await portalUserIdFor(order.customerId);
  await notifyMany([portalUid, ...(await staffRecipients(businessId, order.createdByUserId))], {
    type: 'domain_registered',
    title: `Domain ${dom.name} u regjistrua ✓`,
    message: `Skadon më ${utcNoon(expiry).toLocaleDateString('sq-AL')}.`,
    actionUrl: portalUid ? '/portal/hosting' : '/app/hosting?tab=domains',
    actionLabel: 'Shiko',
    businessId, teamId, customerId: order.customerId,
  });
  return { domainId, pending: false };
}

// ── Payments ───────────────────────────────────────────────────────────────────

/**
 * Called when an invoice raised by this module is PAID (Stripe webhook, or the
 * lifecycle job noticing a manual "Paguar"). Idempotent for each of the three links.
 */
export async function onHostingInvoicePaid(invoiceId: string, actorUid: string | null = null): Promise<{ handled: string[] }> {
  const snap = await db.collection('invoices').doc(invoiceId).get();
  if (!snap.exists) return { handled: [] };
  const inv = snap.data() as any;
  if (inv.status !== 'Paid') return { handled: [] };
  const handled: string[] = [];

  if (inv.hostingOrderId) {
    const oRef = db.collection('hostingOrders').doc(String(inv.hostingOrderId));
    const o = await oRef.get();
    if (o.exists && (o.data() as any).status === 'Pending') {
      await oRef.update({ status: 'Paid', paidAt: Timestamp.now(), updatedAt: Timestamp.now() });
      handled.push('order-paid');
      try { await provisionOrder(o.id, actorUid); handled.push('order-provisioned'); }
      catch (err) { console.error('[hosting] provision after payment failed', err); }
    }
  }
  if (inv.subscriptionId) {
    if (inv.hostingUpgrade) {
      if (await applyPendingUpgrade(String(inv.subscriptionId), invoiceId, actorUid)) handled.push('subscription-upgraded');
    } else if (await applySubscriptionRenewal(String(inv.subscriptionId), invoiceId, actorUid)) handled.push('subscription-renewed');
  }
  if (inv.domainId) {
    if (await applyDomainRenewal(String(inv.domainId), invoiceId, actorUid)) handled.push('domain-renewed');
  }
  return { handled };
}

/** Advance the due date one cycle and unsuspend a non-payment suspension. Once per invoice. */
export async function applySubscriptionRenewal(subscriptionId: string, invoiceId: string, actorUid: string | null): Promise<boolean> {
  const ref = db.collection('subscriptions').doc(subscriptionId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const s = snap.data() as any;
  if (s.currentInvoiceId !== invoiceId) return false; // already applied, or not this period's invoice
  const due = toDate(s.nextDueDate);
  if (!due) return false;
  const patch = renewSubscriptionPatch({ billingCycle: s.billingCycle, nextDueDate: due, anchorDay: s.anchorDay ?? null }, due);
  if (!patch) return false;

  let unsuspended = false;
  if (s.status === 'Suspended' && s.suspendReason === 'non-payment' && s.cpanelUsername && s.serverId) {
    const server = await loadServer(String(s.serverId));
    if (server?.whm.apiToken) {
      try {
        await whmUnsuspendAccount(server.whm, String(s.cpanelUsername));
        unsuspended = true;
        await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.unsuspend', ok: true, message: `${s.cpanelUsername} u riaktivizua pas pagesës`, actorUserId: actorUid });
      } catch (err) {
        await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.unsuspend', ok: false, message: redactProviderError(err), actorUserId: actorUid });
      }
    }
  }
  await ref.update({
    nextDueDate: Timestamp.fromDate(patch.nextDueDate),
    ...(s.status === 'Suspended' && s.suspendReason === 'non-payment' && unsuspended ? { status: 'Active', suspendedAt: null, suspendReason: null } : {}),
    currentInvoiceId: null,
    updatedAt: Timestamp.now(),
  });
  await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'billing.renewed', ok: true, message: `Afati u shty në ${dayKey(patch.nextDueDate)} (fatura ${invoiceId})`, actorUserId: actorUid });
  return true;
}

/** Renew at Dynadot once the renewal invoice is paid. Once per expiry key. */
export async function applyDomainRenewal(domainId: string, invoiceId: string, actorUid: string | null): Promise<boolean> {
  const ref = db.collection('domains').doc(domainId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const d = snap.data() as any;
  if (d.currentInvoiceId !== invoiceId) return false;
  const expiry = toDate(d.expiryDate);
  if (!expiry) return false;
  const expiryKey = dayKey(expiry);
  if (d.renewedAtRegistrarForKey === expiryKey) return false;
  const teamId = await teamIdForBusiness(d.businessId, d.teamId);
  const years = Math.max(1, Math.floor(Number(d.years) || 1));
  if (d.registrar !== 'dynadot') {
    // External registrar (.al etc.): the customer paid us; a human renews it there.
    // Book the renewal so the lifecycle never asks twice, and tell staff what to do.
    const newExpiry = addYearsClamped(utcNoon(expiry), years);
    await ref.update({
      expiryDate: Timestamp.fromDate(newExpiry), status: 'Active',
      renewedAtRegistrarForKey: expiryKey, currentInvoiceId: null, provisionError: null, updatedAt: Timestamp.now(),
    });
    await logHostingEvent({ businessId: d.businessId, teamId, customerId: d.customerId, domainId, type: 'domain.renewManual', ok: true, message: `${d.domainName}: pagesa u mor — rinovoje me dorë te ${d.registrar || 'regjistruesi'} deri më ${dayKey(newExpiry)}`, actorUserId: actorUid });
    await notifyMany(await staffRecipients(d.businessId, d.createdByUserId), {
      type: 'domain_renewed', title: `Rinovo me dorë: ${d.domainName}`,
      message: `Klienti pagoi rinovimin për ${years} vit(e). Domain-i është te ${d.registrar || 'një regjistrues i jashtëm'} — rinovoje atje. Skadenca e re e regjistruar: ${newExpiry.toLocaleDateString('sq-AL')}.`,
      actionUrl: '/app/hosting?tab=domains', actionLabel: 'Shiko domain-et', businessId: d.businessId, teamId, customerId: d.customerId,
    });
    return true;
  }
  const apiKey = await dynadotKeyFor(teamId);
  if (!apiKey) {
    await ref.update({ provisionError: 'Çelësi i Dynadot mungon — rinovimi nuk u ekzekutua', updatedAt: Timestamp.now() });
    return false;
  }
  try {
    const res = await dynadotRenew(apiKey, String(d.domainName), years, { currency: await dynadotCurrencyFor(teamId) });
    const newExpiry = res.expiration ?? addYearsClamped(utcNoon(expiry), years);
    await ref.update({
      expiryDate: Timestamp.fromDate(utcNoon(newExpiry)), status: 'Active',
      renewedAtRegistrarForKey: expiryKey, currentInvoiceId: null, provisionError: null,
      lastSyncAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    await logHostingEvent({ businessId: d.businessId, teamId, customerId: d.customerId, domainId, type: 'dynadot.renew', ok: true, message: `${d.domainName} u rinovua deri më ${dayKey(newExpiry)}`, actorUserId: actorUid });
    const portalUid = await portalUserIdFor(d.customerId);
    await notifyMany([portalUid, ...(await staffRecipients(d.businessId, d.createdByUserId))], {
      type: 'domain_renewed', title: `Domain ${d.domainName} u rinovua ✓`,
      message: `Skadenca e re: ${utcNoon(newExpiry).toLocaleDateString('sq-AL')}.`,
      actionUrl: portalUid ? '/portal/hosting' : '/app/hosting?tab=domains', actionLabel: 'Shiko',
      businessId: d.businessId, teamId, customerId: d.customerId,
    });
    return true;
  } catch (err) {
    const msg = redactProviderError(err);
    await ref.update({ provisionError: msg, updatedAt: Timestamp.now() });
    await logHostingEvent({ businessId: d.businessId, teamId, customerId: d.customerId, domainId, type: 'dynadot.renew', ok: false, message: msg, actorUserId: actorUid });
    await notifyMany(await staffRecipients(d.businessId, d.createdByUserId), {
      type: 'domain_action_failed', title: `⚠️ Rinovimi i ${d.domainName} dështoi te Dynadot`, message: msg.slice(0, 200),
      actionUrl: '/app/hosting?tab=domains', actionLabel: 'Shiko', businessId: d.businessId, teamId, customerId: d.customerId,
    });
    return false;
  }
}

// ── Manual account operations (endpoint) ──────────────────────────────────────

export async function suspendSubscription(subscriptionId: string, reason: string, actorUid: string | null): Promise<void> {
  const ref = db.collection('subscriptions').doc(subscriptionId);
  const s = (await ref.get()).data() as any;
  if (!s) throw new Error('Abonimi nuk u gjet');
  if (!s.cpanelUsername || !s.serverId) throw new Error('Abonimi nuk ka llogari cPanel');
  const server = await loadServer(String(s.serverId));
  if (!server?.whm.apiToken) throw new Error(server ? noTokenMessage(server) : 'Serveri nuk u gjet');
  await assertAccountOwned(server.whm, String(s.cpanelUsername), s.domain);
  try {
    await whmSuspendAccount(server.whm, String(s.cpanelUsername), reason);
  } catch (err) {
    if (!(err instanceof ProviderError && /already suspended/i.test(err.message))) {
      await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.suspend', ok: false, message: redactProviderError(err), actorUserId: actorUid });
      throw err;
    }
  }
  await ref.update({ status: 'Suspended', suspendedAt: Timestamp.now(), suspendReason: reason, updatedAt: Timestamp.now() });
  await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.suspend', ok: true, message: `${s.cpanelUsername} u pezullua: ${reason}`, actorUserId: actorUid });
  const portalUid = await portalUserIdFor(s.customerId);
  await notifyMany([portalUid], {
    type: 'hosting_suspended', title: `Llogaria ${s.domain || s.productName} u pezullua`,
    message: reason === 'non-payment' ? 'Fatura e rinovimit nuk është paguar. Paguajeni për ta riaktivizuar menjëherë.' : reason,
    actionUrl: '/portal/invoices', actionLabel: 'Shiko faturat', businessId: s.businessId, teamId: s.teamId, customerId: s.customerId,
  });
}

export async function unsuspendSubscription(subscriptionId: string, actorUid: string | null): Promise<void> {
  const ref = db.collection('subscriptions').doc(subscriptionId);
  const s = (await ref.get()).data() as any;
  if (!s) throw new Error('Abonimi nuk u gjet');
  const server = await loadServer(String(s.serverId || ''));
  if (!server?.whm.apiToken) throw new Error(server ? noTokenMessage(server) : 'Serveri nuk u gjet');
  await assertAccountOwned(server.whm, String(s.cpanelUsername), s.domain);
  try {
    await whmUnsuspendAccount(server.whm, String(s.cpanelUsername));
  } catch (err) {
    if (!(err instanceof ProviderError && /not suspended/i.test(err.message))) {
      await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.unsuspend', ok: false, message: redactProviderError(err), actorUserId: actorUid });
      throw err;
    }
  }
  await ref.update({ status: 'Active', suspendedAt: null, suspendReason: null, updatedAt: Timestamp.now() });
  await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.unsuspend', ok: true, message: `${s.cpanelUsername} u riaktivizua`, actorUserId: actorUid });
}

/**
 * DESTRUCTIVE: removes the cPanel account. A full `pkgacct` backup is taken FIRST
 * (cpmove-<user>.tar.gz in /home on the server) and the deletion is REFUSED when the
 * backup fails — unless `opts.force` (a human who read the warning). The account must
 * also prove it is this customer's (`assertAccountOwned`).
 */
export async function terminateSubscription(subscriptionId: string, reason: string, actorUid: string | null, opts: { force?: boolean } = {}): Promise<void> {
  const ref = db.collection('subscriptions').doc(subscriptionId);
  const s = (await ref.get()).data() as any;
  if (!s) throw new Error('Abonimi nuk u gjet');
  if (s.cpanelUsername && s.serverId) {
    const server = await loadServer(String(s.serverId));
    if (server?.whm.apiToken) {
      const exists = await whmAccountSummary(server.whm, String(s.cpanelUsername)).catch(() => null);
      if (exists) {
        await assertAccountOwned(server.whm, String(s.cpanelUsername), s.domain);
        try {
          const b = await whmBackupAccount(server.whm, String(s.cpanelUsername));
          await ref.update({ lastBackupAt: Timestamp.now(), lastBackupPath: b.path ?? null, updatedAt: Timestamp.now() });
          await db.collection('hostingBackups').add({ businessId: s.businessId ?? null, teamId: s.teamId ?? null, customerId: s.customerId ?? null, subscriptionId, serverId: s.serverId, cpanelUsername: s.cpanelUsername, domain: s.domain || null, kind: 'pre-terminate', path: b.path ?? null, ok: true, createdAt: Timestamp.now(), createdByUserId: actorUid });
          await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.pkgacct', ok: true, message: `Backup i ${s.cpanelUsername} para terminimit${b.path ? `: ${b.path}` : ''}`, actorUserId: actorUid });
        } catch (err) {
          const msg = redactProviderError(err);
          await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.pkgacct', ok: false, message: msg, actorUserId: actorUid });
          if (!opts.force) {
            await notifyMany(await staffRecipients(s.businessId, s.createdByUserId), {
              type: 'hosting_provision_failed', title: `Terminimi i ${s.domain || s.cpanelUsername} u ndal: backup-i dështoi`,
              message: `${msg.slice(0, 160)} — llogaria NUK u fshi. Bëj backup me dorë ose termino me "force".`,
              actionUrl: '/app/hosting', actionLabel: 'Shiko', businessId: s.businessId, teamId: s.teamId, customerId: s.customerId,
            });
            throw new Error(`Backup-i (pkgacct) dështoi — terminimi u ndal që të mos humbin të dhënat: ${msg}`);
          }
        }
      }
      try {
        await whmTerminateAccount(server.whm, String(s.cpanelUsername));
      } catch (err) {
        if (!(err instanceof ProviderError && /does not exist|not exist|no such/i.test(err.message))) {
          await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.removeacct', ok: false, message: redactProviderError(err), actorUserId: actorUid });
          throw err;
        }
      }
    }
  }
  await ref.update({ status: 'Terminated', terminatedAt: Timestamp.now(), suspendReason: reason, currentInvoiceId: null, updatedAt: Timestamp.now() });
  await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.removeacct', ok: true, message: `${s.cpanelUsername || s.domain} u terminua: ${reason}`, actorUserId: actorUid });
  const portalUid = await portalUserIdFor(s.customerId);
  await notifyMany([portalUid, ...(await staffRecipients(s.businessId, s.createdByUserId))], {
    type: 'hosting_terminated', title: `Llogaria ${s.domain || s.productName} u terminua`, message: reason,
    actionUrl: portalUid ? '/portal/hosting' : '/app/hosting', actionLabel: 'Shiko', businessId: s.businessId, teamId: s.teamId, customerId: s.customerId,
  });
}

export async function changeSubscriptionPackage(subscriptionId: string, productId: string, cycle: BillingCycle | null, actorUid: string | null): Promise<void> {
  const ref = db.collection('subscriptions').doc(subscriptionId);
  const s = (await ref.get()).data() as any;
  if (!s) throw new Error('Abonimi nuk u gjet');
  const p = (await db.collection('hostingProducts').doc(productId).get()).data() as any;
  if (!p) throw new Error('Paketa nuk u gjet');
  if (p.businessId && s.businessId && p.businessId !== s.businessId) throw new Error('Paketa i përket një biznesi tjetër');
  if (s.serverId && p.serverId && s.serverId !== p.serverId) throw new Error('Paketa është në një server tjetër — migrimi nuk mbështetet');
  const newCycle: BillingCycle = cycle && isBillingCycle(cycle) ? cycle : (isBillingCycle(s.billingCycle) ? s.billingCycle : 'monthly');
  const price = p.pricing?.[newCycle]?.price;
  if (typeof price !== 'number') throw new Error('Paketa nuk shitet me këtë cikël');
  if (s.cpanelUsername) {
    const server = await loadServer(String(p.serverId || s.serverId));
    if (!server?.whm.apiToken) throw new Error(server ? noTokenMessage(server) : 'Serveri nuk u gjet');
    await assertAccountOwned(server.whm, String(s.cpanelUsername), s.domain);
    try {
      await whmChangePackage(server.whm, String(s.cpanelUsername), String(p.whmPackage));
    } catch (err) {
      await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.changepackage', ok: false, message: redactProviderError(err), actorUserId: actorUid });
      throw err;
    }
  }
  // Price/cycle changes apply from the NEXT invoice — no proration, no rewrite of history.
  await ref.update({
    productId, productName: p.name, whmPackage: p.whmPackage, serverId: p.serverId || s.serverId,
    recurringAmount: price, currency: p.currency || s.currency, billingCycle: newCycle, updatedAt: Timestamp.now(),
  });
  await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.changepackage', ok: true, message: `Paketa → ${p.name} (${p.whmPackage}), ${CYCLE_LABELS[newCycle]} ${price} ${p.currency || ''}`, actorUserId: actorUid });
}

export async function resetSubscriptionPassword(subscriptionId: string, actorUid: string | null, opts: { byStaff?: boolean } = {}): Promise<string> {
  const s = (await db.collection('subscriptions').doc(subscriptionId).get()).data() as any;
  if (!s?.cpanelUsername || !s.serverId) throw new Error('Abonimi nuk ka llogari cPanel');
  const server = await loadServer(String(s.serverId));
  if (!server?.whm.apiToken) throw new Error(server ? noTokenMessage(server) : 'Serveri nuk u gjet');
  await assertAccountOwned(server.whm, String(s.cpanelUsername), s.domain);
  const password = generateAccountPassword();
  try {
    await whmSetPassword(server.whm, String(s.cpanelUsername), password);
  } catch (err) {
    await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.passwd', ok: false, message: redactProviderError(err), actorUserId: actorUid });
    throw err;
  }
  await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.passwd', ok: true, message: `Fjalëkalimi i ${s.cpanelUsername} u ndryshua${opts.byStaff ? ' nga stafi' : ''}`, actorUserId: actorUid });
  if (opts.byStaff) {
    await notifyMany([await portalUserIdFor(s.customerId)], {
      type: 'hosting_staff_login', title: `Stafi ndryshoi fjalëkalimin e cPanel për ${s.domain || s.cpanelUsername}`,
      message: 'Nëse nuk e keni kërkuar ju, na kontaktoni menjëherë.', actionUrl: '/portal/hosting', actionLabel: 'Shiko',
      businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, actorUserId: actorUid,
    });
  }
  return password;
}

export async function subscriptionSsoUrl(subscriptionId: string, actorUid: string | null, opts: { byStaff?: boolean } = {}): Promise<string> {
  const s = (await db.collection('subscriptions').doc(subscriptionId).get()).data() as any;
  if (!s?.cpanelUsername || !s.serverId) throw new Error('Abonimi nuk ka llogari cPanel');
  if (s.status !== 'Active') throw new Error('Llogaria nuk është aktive');
  const server = await loadServer(String(s.serverId));
  if (!server?.whm.apiToken) throw new Error(server ? noTokenMessage(server) : 'Serveri nuk u gjet');
  await assertAccountOwned(server.whm, String(s.cpanelUsername), s.domain);
  const url = await whmCreateSession(server.whm, String(s.cpanelUsername));
  await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.sso', ok: true, message: `Sesion cPanel për ${s.cpanelUsername}${opts.byStaff ? ' (staf)' : ''}`, actorUserId: actorUid });
  if (opts.byStaff) {
    // The customer is told every time staff enters their account — it is their data.
    await notifyMany([await portalUserIdFor(s.customerId)], {
      type: 'hosting_staff_login', title: `Stafi hyri në cPanel-in e ${s.domain || s.cpanelUsername}`,
      message: 'Hyrje për mirëmbajtje/suport. Nëse nuk e prisnit, na kontaktoni.', actionUrl: '/portal/hosting', actionLabel: 'Shiko',
      businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, actorUserId: actorUid,
    });
  }
  return url;
}

// ── Existing accounts / domains (migration) — verified at the provider first ───

export interface AddExistingSubscriptionInput {
  businessId: string; teamId: string | null; customerId: string; productId?: string | null; serverId: string;
  cpanelUsername: string; domain: string; cycle: BillingCycle; amount: number; currency: 'ALL' | 'EUR';
  nextDueDate: Date; status: 'Active' | 'Suspended';
}

/** Creates a `source: 'fivocrm'` subscription for an account that already lives on the server. */
export async function addExistingSubscription(inp: AddExistingSubscriptionInput, actorUid: string | null): Promise<string> {
  const dom = parseDomain(inp.domain);
  if (!dom) throw new Error('Domain i pavlefshëm');
  const server = await loadServer(inp.serverId);
  if (!server) throw new Error('Serveri nuk u gjet');
  if (server.data.businessId !== inp.businessId) throw new Error('Serveri i përket një biznesi tjetër');
  if (!server.whm.apiToken) throw new Error(noTokenMessage(server));
  const username = inp.cpanelUsername.trim().toLowerCase();
  // The account must exist AND serve this domain — otherwise "adding" it is taking it.
  await assertAccountOwned(server.whm, username, dom.name);
  const dup = await db.collection('subscriptions').where('serverId', '==', inp.serverId).where('cpanelUsername', '==', username).limit(1).get();
  if (!dup.empty) throw new Error(`Llogaria ${username} është tashmë e regjistruar (abonimi ${dup.docs[0].id})`);
  const product = inp.productId ? ((await db.collection('hostingProducts').doc(inp.productId).get()).data() as any) : null;
  const due = utcNoon(inp.nextDueDate);
  const ref = db.collection('subscriptions').doc();
  await ref.set({
    businessId: inp.businessId, teamId: inp.teamId, customerId: inp.customerId, source: 'fivocrm',
    productId: inp.productId || null, productName: product?.name || 'Hosting', domain: dom.name,
    status: inp.status, recurringAmount: inp.amount, currency: inp.currency, billingCycle: inp.cycle,
    nextDueDate: Timestamp.fromDate(due), anchorDay: due.getUTCDate(), registrationDate: Timestamp.now(),
    serverId: inp.serverId, whmPackage: product?.whmPackage || null, cpanelUsername: username,
    provisionStatus: 'provisioned', provisionError: null, lastInvoicedDueKey: null, currentInvoiceId: null,
    notes: 'Shtuar manualisht (llogari ekzistuese, verifikuar në WHM)',
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(), createdByUserId: actorUid,
  });
  await logHostingEvent({ businessId: inp.businessId, teamId: inp.teamId, customerId: inp.customerId, subscriptionId: ref.id, type: 'sub.addExisting', ok: true, message: `${username} (${dom.name}) u shtua si llogari ekzistuese`, actorUserId: actorUid });
  return ref.id;
}

export interface AddExistingDomainInput {
  businessId: string; teamId: string | null; customerId: string; domainName: string; registrar: string;
  expiryDate: Date | null; years: number; amount: number; currency: 'ALL' | 'EUR'; autoRenew: boolean; nameservers: string[];
}

/** Creates a `source: 'fivocrm'` domain. A Dynadot one must exist in the account (facts come from the registrar). */
export async function addExistingDomain(inp: AddExistingDomainInput, actorUid: string | null): Promise<string> {
  const dom = parseDomain(inp.domainName);
  if (!dom) throw new Error('Domain i pavlefshëm');
  const dup = await db.collection('domains').where('businessId', '==', inp.businessId).where('domainName', '==', dom.name).limit(1).get();
  if (!dup.empty && (dup.docs[0].data() as any).source === 'fivocrm') throw new Error(`${dom.name} është tashmë i regjistruar (${dup.docs[0].id})`);
  let expiry = inp.expiryDate ? utcNoon(inp.expiryDate) : null;
  let registration: Date | null = null;
  let ns = inp.nameservers;
  let locked: boolean | undefined;
  if (inp.registrar === 'dynadot') {
    const apiKey = await dynadotKeyFor(inp.teamId);
    if (!apiKey) throw new Error('Çelësi i Dynadot mungon');
    const info = await dynadotDomainInfo(apiKey, dom.name);
    if (!info) throw new Error(`${dom.name} nuk është në llogarinë tuaj Dynadot`);
    expiry = info.expiration ? utcNoon(info.expiration) : expiry;
    registration = info.registration;
    if (info.nameservers.length) ns = info.nameservers;
    locked = info.locked;
  }
  if (!expiry) throw new Error('Skadenca mungon');
  const ref = db.collection('domains').doc();
  await ref.set({
    businessId: inp.businessId, teamId: inp.teamId, customerId: inp.customerId, source: 'fivocrm',
    registrar: inp.registrar === 'dynadot' ? 'dynadot' : (inp.registrar.trim() || 'manual'),
    domainName: dom.name, tld: dom.tld, status: 'Active', years: Math.max(1, Math.floor(inp.years || 1)),
    recurringAmount: inp.amount, currency: inp.currency, autoRenew: inp.autoRenew,
    expiryDate: Timestamp.fromDate(expiry), ...(registration ? { registrationDate: Timestamp.fromDate(utcNoon(registration)) } : {}),
    nameservers: ns, ...(locked !== undefined ? { locked } : {}),
    provisionStatus: 'provisioned', provisionError: null, lastInvoicedExpiryKey: null, currentInvoiceId: null,
    lastSyncAt: Timestamp.now(), createdAt: Timestamp.now(), updatedAt: Timestamp.now(), createdByUserId: actorUid,
  });
  await logHostingEvent({ businessId: inp.businessId, teamId: inp.teamId, customerId: inp.customerId, domainId: ref.id, type: 'domain.addExisting', ok: true, message: `${dom.name} (${inp.registrar}) u shtua si domain ekzistues`, actorUserId: actorUid });
  return ref.id;
}

/** WHMCS mirror row → ours. The WHM account named must exist and serve the row's domain. */
export async function adoptWhmcsSubscription(subscriptionId: string, serverId: string, cpanelUsername: string, actorUid: string | null): Promise<void> {
  const ref = db.collection('subscriptions').doc(subscriptionId);
  const s = (await ref.get()).data() as any;
  if (!s) throw new Error('Abonimi nuk u gjet');
  if (s.source === 'fivocrm') throw new Error('Abonimi është tashmë nën menaxhimin e FivoCRM');
  const server = await loadServer(serverId);
  if (!server) throw new Error('Serveri nuk u gjet');
  if (server.data.businessId !== s.businessId) throw new Error('Serveri i përket një biznesi tjetër');
  if (!server.whm.apiToken) throw new Error(noTokenMessage(server));
  const username = cpanelUsername.trim().toLowerCase();
  await assertAccountOwned(server.whm, username, s.domain);
  const cycle = cycleFromWhmcs(s.billingCycle) || 'monthly';
  const due = toDate(s.nextDueDate);
  await ref.update({
    source: 'fivocrm', serverId, cpanelUsername: username, billingCycle: cycle,
    anchorDay: due ? due.getUTCDate() : new Date().getUTCDate(), provisionStatus: 'provisioned', provisionError: null,
    // FivoCRM invoices the CURRENT due date; pre-claiming it made the lifecycle read
    // the period as invoiced-but-unpaid and suspend on the due date.
    lastInvoicedDueKey: null, currentInvoiceId: null, updatedAt: Timestamp.now(),
  });
  await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'sub.adoptWhmcs', ok: true, message: `${username} (${s.domain}) u mor nën menaxhim nga WHMCS`, actorUserId: actorUid });
}

export async function subscriptionUsage(subscriptionId: string): Promise<{ diskUsedMb: number | null; diskLimitMb: number | null; suspended: boolean; ip?: string; plan?: string } | null> {
  const s = (await db.collection('subscriptions').doc(subscriptionId).get()).data() as any;
  if (!s?.cpanelUsername || !s.serverId) return null;
  const server = await loadServer(String(s.serverId));
  if (!server?.whm.apiToken) return null;
  const a = await whmAccountSummary(server.whm, String(s.cpanelUsername));
  if (!a) return null;
  if (parseDomain(a.domain)?.name !== parseDomain(s.domain || '')?.name) throw new Error(`Llogaria "${s.cpanelUsername}" në WHM i përket një domain-i tjetër`);
  return { diskUsedMb: a.diskUsedMb ?? null, diskLimitMb: a.diskLimitMb ?? null, suspended: a.suspended, ip: a.ip, plan: a.plan };
}

export async function testServer(serverId: string, actorUid: string | null): Promise<{ ok: boolean; version?: string; packages?: string[]; accounts?: number; error?: string }> {
  const server = await loadServer(serverId);
  if (!server) throw new Error('Serveri nuk u gjet');
  const ref = db.collection('hostingServers').doc(serverId);
  if (!server.whm.apiToken) {
    const msg = noTokenMessage(server);
    await ref.update({ lastCheckedAt: Timestamp.now(), lastCheckOk: false, lastCheckError: msg, updatedAt: Timestamp.now() });
    return { ok: false, error: msg };
  }
  try {
    const [version, packages, accounts] = await Promise.all([
      whmVersion(server.whm), whmListPackages(server.whm), whmListAccounts(server.whm).catch(() => null),
    ]);
    await ref.update({
      lastCheckedAt: Timestamp.now(), lastCheckOk: true, lastCheckError: null, whmVersion: version,
      packages, ...(accounts ? { accountsCount: accounts.length } : {}), updatedAt: Timestamp.now(),
    });
    await logHostingEvent({ businessId: server.data.businessId, teamId: server.data.teamId, type: 'whm.test', ok: true, message: `WHM ${version}, ${packages.length} paketa`, actorUserId: actorUid });
    return { ok: true, version, packages, accounts: accounts?.length };
  } catch (err) {
    const msg = redactProviderError(err);
    await ref.update({ lastCheckedAt: Timestamp.now(), lastCheckOk: false, lastCheckError: msg, updatedAt: Timestamp.now() });
    await logHostingEvent({ businessId: server.data.businessId, teamId: server.data.teamId, type: 'whm.test', ok: false, message: msg, actorUserId: actorUid });
    return { ok: false, error: msg };
  }
}

export async function testRegistrar(teamId: string, actorUid: string | null): Promise<{ ok: boolean; username?: string; balances?: Array<{ currency: string; amount: number }>; error?: string }> {
  const apiKey = await dynadotKeyFor(teamId);
  if (!apiKey) return { ok: false, error: 'Çelësi i Dynadot nuk është ruajtur' };
  try {
    const info = await dynadotAccountInfo(apiKey);
    await logHostingEvent({ teamId, type: 'dynadot.test', ok: true, message: `Dynadot OK (${info.username || '?'})`, actorUserId: actorUid });
    return { ok: true, ...info };
  } catch (err) {
    const msg = redactProviderError(err);
    await logHostingEvent({ teamId, type: 'dynadot.test', ok: false, message: msg, actorUserId: actorUid });
    return { ok: false, error: msg };
  }
}

// ── Lifecycle job ──────────────────────────────────────────────────────────────

export interface LifecycleRunResult extends Record<string, unknown> {
  considered: number;
  invoiced: number;
  suspended: number;
  terminated: number;
  renewed: number;
  provisioned: number;
  domainsInvoiced: number;
  domainsRenewed: number;
  domainsGrace: number;
  domainsExpired: number;
  blocked: Record<string, number>;
  errors: number;
  suspendedTenantsSkipped: number;
  businessId: string | null;
}

/**
 * `?job=hosting-lifecycle` — hourly from the VPS. One pass over OUR subscriptions,
 * domains and pending orders. `businessId` scopes a manual run to one tenant.
 */
export async function runHostingLifecycle(opts: { businessId?: string | null } = {}): Promise<LifecycleRunResult> {
  const now = new Date();
  const scopeId = opts.businessId || null;
  const r: LifecycleRunResult = {
    considered: 0, invoiced: 0, suspended: 0, terminated: 0, renewed: 0, provisioned: 0,
    domainsInvoiced: 0, domainsRenewed: 0, domainsGrace: 0, domainsExpired: 0,
    blocked: {}, errors: 0, suspendedTenantsSkipped: 0, businessId: scopeId,
  };
  const block = (reason: string) => { r.blocked[reason] = (r.blocked[reason] || 0) + 1; };
  const suspendedTenants = await suspendedBusinessIds();
  const cfgCache = new Map<string, LifecycleConfig>();
  const teamCache = new Map<string, string | null>();
  const perTeam = new Map<string, { invoiced: number; suspended: number; terminated: number; renewed: number; provisioned: number; errors: number; blocked: Record<string, number> }>();
  const tally = (teamId: string | null, k: 'invoiced' | 'suspended' | 'terminated' | 'renewed' | 'provisioned' | 'errors', reason?: string) => {
    if (!teamId) return;
    const t = perTeam.get(teamId) || { invoiced: 0, suspended: 0, terminated: 0, renewed: 0, provisioned: 0, errors: 0, blocked: {} };
    if (reason) t.blocked[reason] = (t.blocked[reason] || 0) + 1; else t[k]++;
    perTeam.set(teamId, t);
  };
  const teamFor = async (businessId: string | null, hinted?: string | null) => {
    if (hinted) return hinted;
    const k = businessId || '';
    if (!teamCache.has(k)) teamCache.set(k, await teamIdForBusiness(businessId));
    return teamCache.get(k) ?? null;
  };
  const cfgFor = async (teamId: string | null) => {
    const k = teamId || '';
    if (!cfgCache.has(k)) cfgCache.set(k, await lifecycleConfigFor(teamId));
    return cfgCache.get(k)!;
  };
  const scoped = <T extends FirebaseFirestore.Query>(q: T): T => (scopeId ? q.where('businessId', '==', scopeId) : q) as T;

  // 1. Orders whose invoice was paid by hand (Stripe calls us directly; this is the backstop).
  try {
    const pending = await scoped(db.collection('hostingOrders').where('status', 'in', ['Pending', 'Paid', 'Failed'])).limit(200).get();
    for (const doc of pending.docs) {
      const o = doc.data() as any;
      if (o.businessId && suspendedTenants.has(o.businessId)) { r.suspendedTenantsSkipped++; continue; }
      if (o.status === 'Failed') {
        // Automatic retry with backoff; exhausted or not-yet-due ones wait.
        if (o.retryExhausted) { block('retry-exhausted'); continue; }
        const nextAt = toDate(o.nextRetryAt);
        if (nextAt && nextAt > now) { block('retry-not-due'); continue; }
      }
      try {
        if (o.status === 'Pending') {
          if (!o.invoiceId) continue;
          const inv = await db.collection('invoices').doc(String(o.invoiceId)).get();
          if (!inv.exists || (inv.data() as any).status !== 'Paid') continue;
          await doc.ref.update({ status: 'Paid', paidAt: Timestamp.now(), updatedAt: Timestamp.now() });
        }
        const res = await provisionOrder(doc.id, null);
        if (res.status === 'Active') { r.provisioned++; tally(await teamFor(o.businessId, o.teamId), 'provisioned'); }
        else { r.errors++; tally(await teamFor(o.businessId, o.teamId), 'errors'); }
      } catch (err) {
        r.errors++;
        console.error('[hosting-lifecycle] order', doc.id, err);
      }
    }
  } catch (err) { console.error('[hosting-lifecycle] orders query failed', err); }

  // 2. Subscriptions.
  try {
    const subs = await scoped(db.collection('subscriptions').where('source', '==', 'fivocrm').where('status', 'in', ['Active', 'Suspended', 'Pending'])).limit(1000).get();
    for (const doc of subs.docs) {
      const s = doc.data() as any;
      r.considered++;
      if (s.businessId && suspendedTenants.has(s.businessId)) { r.suspendedTenantsSkipped++; continue; }
      const teamId = await teamFor(s.businessId, s.teamId);
      const cfg = await cfgFor(teamId);
      const due = toDate(s.nextDueDate);
      let currentInvoice: { status: string } | null = null;
      if (s.currentInvoiceId) {
        const inv = await db.collection('invoices').doc(String(s.currentInvoiceId)).get();
        currentInvoice = inv.exists ? { status: String((inv.data() as any).status) } : null;
        // A paid renewal (manual "Paguar") that nobody applied yet.
        if (currentInvoice?.status === 'Paid') {
          try {
            if (await applySubscriptionRenewal(doc.id, String(s.currentInvoiceId), null)) { r.renewed++; tally(teamId, 'renewed'); }
          } catch (err) { r.errors++; tally(teamId, 'errors'); console.error('[hosting-lifecycle] renew', doc.id, err); }
          continue;
        }
      }
      // An upgrade invoice settled by hand ("Paguar" at Faturat) — apply the package.
      if (s.pendingUpgrade?.invoiceId) {
        const up = await db.collection('invoices').doc(String(s.pendingUpgrade.invoiceId)).get();
        if (up.exists && (up.data() as any).status === 'Paid') {
          try { await applyPendingUpgrade(doc.id, String(s.pendingUpgrade.invoiceId), null); } catch (err) { r.errors++; console.error('[hosting-lifecycle] upgrade', doc.id, err); }
        }
      }
      const facts: SubscriptionFacts = {
        id: doc.id, status: s.status, source: s.source, billingCycle: s.billingCycle, nextDueDate: due,
        recurringAmount: Number(s.recurringAmount) || 0, lastInvoicedDueKey: s.lastInvoicedDueKey ?? null,
        currentInvoice, cancelAtPeriodEnd: !!s.cancelAtPeriodEnd, lifecycleHold: !!s.lifecycleHold,
        provisionStatus: s.provisionStatus ?? null, suspendedAt: toDate(s.suspendedAt),
      };
      const decision = decideSubscription(facts, now, cfg);
      if (!decision.action) { if (decision.reason) { block(decision.reason); tally(teamId, 'errors', decision.reason); } continue; }
      try {
        switch (decision.action) {
          case 'issue-renewal-invoice': {
            const invoiceId = renewalInvoiceId('sub', doc.id, due!);
            const label = `HST-R-${dayKey(due!).replace(/-/g, '')}-${doc.id.slice(-4).toUpperCase()}`;
            const cycle: BillingCycle | null = isBillingCycle(s.billingCycle) ? s.billingCycle : null;
            const cycleLabel = cycle ? CYCLE_LABELS[cycle] : '';
            const subject = `${s.productName}${s.domain ? ` — ${s.domain}` : ''}`;
            const created = await createHostingInvoice({
              id: invoiceId, label, businessId: s.businessId ?? null, teamId, customerId: String(s.customerId),
              currency: s.currency === 'EUR' ? 'EUR' : 'ALL', amount: Number(s.recurringAmount) || 0, dueDate: due!,
              notes: `Rinovim ${cycleLabel.toLowerCase()} i hosting-ut për periudhën që fillon më ${due!.toLocaleDateString('sq-AL')}.`,
              items: [{ description: `Rinovim hosting ${subject} (${cycleLabel})`, quantity: 1, unitPrice: Number(s.recurringAmount) || 0 }],
              link: { subscriptionId: doc.id }, createdByUserId: s.createdByUserId ?? null,
            });
            await doc.ref.update({ lastInvoicedDueKey: dayKey(due!), currentInvoiceId: invoiceId, updatedAt: Timestamp.now() });
            if (created) {
              r.invoiced++; tally(teamId, 'invoiced');
              await emailInvoiceToCustomer(invoiceId, String(s.customerId), teamId, {
                amount: Number(s.recurringAmount) || 0, currency: s.currency === 'EUR' ? 'EUR' : 'ALL', dueDate: due!, subject: `Rinovim ${subject}`, label,
              }).catch(() => {});
              const portalUid = await portalUserIdFor(s.customerId);
              await notifyMany([portalUid, ...(await staffRecipients(s.businessId ?? null, s.createdByUserId))], {
                type: 'hosting_renewal_invoice', title: `Faturë rinovimi: ${subject}`,
                message: `${formatMoney(Number(s.recurringAmount) || 0, s.currency)} me afat ${due!.toLocaleDateString('sq-AL')}.`,
                actionUrl: portalUid ? '/portal/invoices' : '/app/invoices', actionLabel: 'Shiko faturën',
                businessId: s.businessId ?? null, teamId, customerId: s.customerId ?? null,
              });
            } else block('already-invoiced');
            break;
          }
          case 'suspend':
            await suspendSubscription(doc.id, 'non-payment', null);
            r.suspended++; tally(teamId, 'suspended');
            break;
          case 'terminate':
            await terminateSubscription(doc.id, 'non-payment', null);
            r.terminated++; tally(teamId, 'terminated');
            break;
          case 'cancel-at-period-end':
            await terminateSubscription(doc.id, 'cancelled-by-customer', null);
            r.terminated++; tally(teamId, 'terminated');
            break;
        }
      } catch (err) {
        r.errors++; tally(teamId, 'errors');
        console.error('[hosting-lifecycle] subscription', doc.id, decision.action, err);
      }
    }
  } catch (err) { console.error('[hosting-lifecycle] subscriptions query failed', err); }

  // 3. Domains.
  try {
    const doms = await scoped(db.collection('domains').where('source', '==', 'fivocrm').where('status', 'in', ['Active', 'Grace'])).limit(1000).get();
    for (const doc of doms.docs) {
      const d = doc.data() as any;
      r.considered++;
      if (d.businessId && suspendedTenants.has(d.businessId)) { r.suspendedTenantsSkipped++; continue; }
      const teamId = await teamFor(d.businessId, d.teamId);
      const cfg = await cfgFor(teamId);
      const expiry = toDate(d.expiryDate);
      let currentInvoice: { status: string } | null = null;
      if (d.currentInvoiceId) {
        const inv = await db.collection('invoices').doc(String(d.currentInvoiceId)).get();
        currentInvoice = inv.exists ? { status: String((inv.data() as any).status) } : null;
      }
      const facts: DomainFacts = {
        id: doc.id, status: d.status, source: d.source, registrar: d.registrar, expiryDate: expiry, years: Number(d.years) || 1,
        recurringAmount: Number(d.recurringAmount) || 0, autoRenew: d.autoRenew !== false,
        lastInvoicedExpiryKey: d.lastInvoicedExpiryKey ?? null, currentInvoice, lifecycleHold: !!d.lifecycleHold,
        renewedAtRegistrarForKey: d.renewedAtRegistrarForKey ?? null,
      };
      const decision = decideDomain(facts, now, cfg);
      if (!decision.action) { if (decision.reason) { block(decision.reason); tally(teamId, 'errors', decision.reason); } continue; }
      try {
        switch (decision.action) {
          case 'issue-renewal-invoice': {
            const invoiceId = renewalInvoiceId('dom', doc.id, expiry!);
            const years = Math.max(1, Math.floor(Number(d.years) || 1));
            const label = `HST-D-${dayKey(expiry!).replace(/-/g, '')}-${doc.id.slice(-4).toUpperCase()}`;
            const created = await createHostingInvoice({
              id: invoiceId, label, businessId: d.businessId ?? null, teamId, customerId: String(d.customerId),
              currency: d.currency === 'EUR' ? 'EUR' : 'ALL', amount: Number(d.recurringAmount) || 0, dueDate: expiry!,
              notes: `Rinovim domain ${d.domainName} për ${years} vit(e). Skadon më ${expiry!.toLocaleDateString('sq-AL')}.`,
              items: [{ description: `Rinovim domain ${d.domainName} (${years} ${years === 1 ? 'vit' : 'vjet'})`, quantity: 1, unitPrice: Number(d.recurringAmount) || 0 }],
              link: { domainId: doc.id }, createdByUserId: d.createdByUserId ?? null,
            });
            await doc.ref.update({ lastInvoicedExpiryKey: dayKey(expiry!), currentInvoiceId: invoiceId, updatedAt: Timestamp.now() });
            if (created) {
              r.domainsInvoiced++; tally(teamId, 'invoiced');
              await emailInvoiceToCustomer(invoiceId, String(d.customerId), teamId, {
                amount: Number(d.recurringAmount) || 0, currency: d.currency === 'EUR' ? 'EUR' : 'ALL', dueDate: expiry!, subject: `Rinovim domain ${d.domainName}`, label,
              }).catch(() => {});
              const portalUid = await portalUserIdFor(d.customerId);
              await notifyMany([portalUid, ...(await staffRecipients(d.businessId ?? null, d.createdByUserId))], {
                type: 'hosting_renewal_invoice', title: `Faturë rinovimi: ${d.domainName}`,
                message: `${formatMoney(Number(d.recurringAmount) || 0, d.currency)} — domain-i skadon më ${expiry!.toLocaleDateString('sq-AL')}.`,
                actionUrl: portalUid ? '/portal/invoices' : '/app/invoices', actionLabel: 'Shiko faturën',
                businessId: d.businessId ?? null, teamId, customerId: d.customerId ?? null,
              });
            } else block('already-invoiced');
            break;
          }
          case 'renew-at-registrar':
            if (await applyDomainRenewal(doc.id, String(d.currentInvoiceId), null)) { r.domainsRenewed++; tally(teamId, 'renewed'); }
            else { r.errors++; tally(teamId, 'errors'); }
            break;
          case 'mark-grace': {
            await doc.ref.update({ status: 'Grace', updatedAt: Timestamp.now() });
            r.domainsGrace++;
            const portalUid = await portalUserIdFor(d.customerId);
            await notifyMany([portalUid, ...(await staffRecipients(d.businessId ?? null, d.createdByUserId))], {
              type: 'domain_expiring', title: `⚠️ Domain ${d.domainName} ka skaduar`,
              message: d.autoRenew === false ? 'Rinovimi automatik është i fikur. Domain-i do të lirohet pas periudhës së tolerancës.' : 'Paguani faturën e rinovimit brenda periudhës së tolerancës për të mos e humbur.',
              actionUrl: portalUid ? '/portal/invoices' : '/app/hosting?tab=domains', actionLabel: 'Shiko',
              businessId: d.businessId ?? null, teamId, customerId: d.customerId ?? null,
            });
            break;
          }
          case 'mark-expired':
            await doc.ref.update({ status: 'Expired', currentInvoiceId: null, updatedAt: Timestamp.now() });
            if (d.currentInvoiceId) {
              await db.collection('invoices').doc(String(d.currentInvoiceId)).update({ status: 'Cancelled', updatedAt: Timestamp.now() }).catch(() => {});
            }
            r.domainsExpired++;
            await logHostingEvent({ businessId: d.businessId, teamId, customerId: d.customerId, domainId: doc.id, type: 'domain.expired', ok: true, message: `${d.domainName} u shënua i skaduar` });
            break;
        }
      } catch (err) {
        r.errors++; tally(teamId, 'errors');
        console.error('[hosting-lifecycle] domain', doc.id, decision.action, err);
      }
    }
  } catch (err) { console.error('[hosting-lifecycle] domains query failed', err); }

  // Per-tenant summary for the UI (same shape as waInvoiceLastRun).
  await Promise.allSettled(Array.from(perTeam.entries()).map(([teamId, t]) =>
    db.collection('teamSettings').doc(teamId).set({ hostingLastRun: { at: Timestamp.now(), ...t } }, { merge: true })));
  return r;
}

// ── Sync job ───────────────────────────────────────────────────────────────────

/**
 * `?job=hosting-sync` — every few hours. Refreshes server health/packages and
 * mirrors registrar facts (expiry, NS, lock; a completed transfer) onto our domains.
 * Never changes a BILLING status: our status is the billing truth; drift is logged.
 */
export async function runHostingSync(opts: { businessId?: string | null } = {}): Promise<Record<string, unknown>> {
  const scopeId = opts.businessId || null;
  const scoped = <T extends FirebaseFirestore.Query>(q: T): T => (scopeId ? q.where('businessId', '==', scopeId) : q) as T;
  const out: Record<string, unknown> & { servers: number; serversFailed: number; domainsSynced: number; domainsFailed: number; transfersCompleted: number; drift: number; usageAlerts?: number; tldCostSyncs?: number } =
    { servers: 0, serversFailed: 0, domainsSynced: 0, domainsFailed: 0, transfersCompleted: 0, drift: 0, usageAlerts: 0, tldCostSyncs: 0, businessId: scopeId };

  const servers = await scoped(db.collection('hostingServers').where('status', '==', 'Active')).limit(100).get();
  for (const doc of servers.docs) {
    const res = await testServer(doc.id, null).catch(() => ({ ok: false }));
    if (res.ok) out.servers++; else out.serversFailed++;
    // Drift: an account WHM says is suspended while we say Active (or vice versa) — log only.
    try {
      const server = await loadServer(doc.id);
      if (!server?.whm.apiToken) continue;
      const accts = await whmListAccounts(server.whm);
      const byUser = new Map(accts.map((a) => [a.user, a]));
      const subs = await db.collection('subscriptions').where('serverId', '==', doc.id).where('source', '==', 'fivocrm').get();
      const DAY = 86_400_000;
      for (const s of subs.docs) {
        const d = s.data() as any;
        if (!d.cpanelUsername || d.status === 'Terminated' || d.status === 'Cancelled' || d.status === 'Pending') continue;
        const a = byUser.get(String(d.cpanelUsername));
        const whmState = !a ? 'missing' : a.suspended ? 'Suspended' : 'Active';
        const patch: Record<string, unknown> = { lastSyncAt: Timestamp.now() };
        if (whmState !== d.status) {
          out.drift++;
          await logHostingEvent({ businessId: d.businessId, teamId: d.teamId, customerId: d.customerId, subscriptionId: s.id, type: 'sync.drift', ok: false, message: `WHM: ${whmState}, FivoCRM: ${d.status} (${d.cpanelUsername})` });
          // Someone changed the account outside FivoCRM (or it vanished): staff must
          // know, once a day, not once per sync.
          const last = toDate(d.driftAlertAt);
          if (!last || Date.now() - last.getTime() > DAY) {
            patch.driftAlertAt = Timestamp.now();
            await notifyMany(await staffRecipients(d.businessId, d.createdByUserId), {
              type: 'hosting_drift', title: `Mospërputhje WHM: ${d.domain || d.cpanelUsername}`,
              message: whmState === 'missing' ? 'Llogaria nuk ekziston më në server, por FivoCRM e ka aktive.' : `WHM e ka "${whmState}", FivoCRM "${d.status}". Ndryshim jashtë FivoCRM?`,
              actionUrl: '/app/hosting?tab=subscriptions', actionLabel: 'Shiko', businessId: d.businessId, teamId: d.teamId, customerId: d.customerId,
            });
          }
        }
        if (a) {
          patch.diskUsedMb = a.diskUsedMb ?? null; patch.diskLimitMb = a.diskLimitMb ?? null;
          const level = usageAlertLevel(a.diskUsedMb, a.diskLimitMb);
          const last = toDate(d.usageAlertAt);
          if (level && (!last || Date.now() - last.getTime() > DAY)) {
            patch.usageAlertAt = Timestamp.now();
            const pct = Math.round(((a.diskUsedMb || 0) / (a.diskLimitMb || 1)) * 100);
            const portalUid = await portalUserIdFor(d.customerId);
            await notifyMany([portalUid, ...(await staffRecipients(d.businessId, d.createdByUserId))], {
              type: 'hosting_usage_alert', title: `${level === 'critical' ? '⛔' : '⚠️'} Disku ${pct}% — ${d.domain || d.cpanelUsername}`,
              message: `${a.diskUsedMb} MB nga ${a.diskLimitMb} MB. ${level === 'critical' ? 'Faqja mund të ndalojë së funksionuari.' : 'Konsideroni një paketë më të madhe.'}`,
              actionUrl: portalUid ? '/portal/hosting' : '/app/hosting?tab=subscriptions', actionLabel: 'Shiko',
              businessId: d.businessId, teamId: d.teamId, customerId: d.customerId,
            });
            out.usageAlerts = (Number(out.usageAlerts) || 0) + 1;
          }
        }
        await s.ref.update(patch).catch(() => {});
      }
    } catch (err) { console.error('[hosting-sync] drift check', doc.id, err); }
  }

  const doms = await scoped(db.collection('domains').where('source', '==', 'fivocrm').where('registrar', '==', 'dynadot')).limit(300).get();
  const keyCache = new Map<string, string | null>();
  for (const doc of doms.docs) {
    const d = doc.data() as any;
    if (['Cancelled', 'Transferred Away', 'Expired'].includes(d.status)) continue;
    const teamId = await teamIdForBusiness(d.businessId, d.teamId);
    const k = teamId || '';
    if (!keyCache.has(k)) keyCache.set(k, await dynadotKeyFor(teamId));
    const apiKey = keyCache.get(k);
    if (!apiKey) continue;
    try {
      const info = await dynadotDomainInfo(apiKey, String(d.domainName));
      if (!info) { out.domainsFailed++; continue; }
      const patch: Record<string, unknown> = { lastSyncAt: Timestamp.now(), updatedAt: Timestamp.now() };
      if (info.expiration) patch.expiryDate = Timestamp.fromDate(utcNoon(info.expiration));
      if (info.registration) patch.registrationDate = Timestamp.fromDate(utcNoon(info.registration));
      if (info.nameservers.length) patch.nameservers = info.nameservers;
      if (info.locked !== undefined) patch.locked = info.locked;
      if (info.privacy) patch.privacy = /full|partial|on|yes/i.test(info.privacy);
      if (d.status === 'Pending' && d.provisionStatus === 'pending') {
        // Transfer completed at the registrar.
        patch.status = 'Active'; patch.provisionStatus = 'provisioned'; patch.provisionError = null;
        out.transfersCompleted++;
        await logHostingEvent({ businessId: d.businessId, teamId, customerId: d.customerId, domainId: doc.id, type: 'dynadot.transfer', ok: true, message: `Transferimi i ${d.domainName} përfundoi` });
      }
      await doc.ref.update(patch);
      out.domainsSynced++;
    } catch (err) {
      out.domainsFailed++;
      console.error('[hosting-sync] domain', d.domainName, redactProviderError(err));
    }
  }

  // Weekly wholesale-cost refresh per tenant that has a TLD price list.
  try {
    const tldBiz = await scoped(db.collection('domainTlds').where('status', '==', 'Active')).select('businessId', 'teamId').limit(500).get();
    const seen = new Set<string>();
    for (const doc of tldBiz.docs) {
      const d = doc.data() as any;
      const bid = String(d.businessId || '');
      if (!bid || seen.has(bid)) continue;
      seen.add(bid);
      const teamId = await teamIdForBusiness(bid, d.teamId);
      if (!teamId) continue;
      const ts = ((await db.collection('teamSettings').doc(teamId).get()).data() as any) || {};
      const last = toDate(ts.hostingTldCostsSyncedAt);
      if (last && Date.now() - last.getTime() < 7 * 86_400_000) continue;
      const r = await syncTldCosts(bid, teamId, null).catch((err) => { console.error('[hosting-sync] tld costs', bid, redactProviderError(err)); return null; });
      if (r) out.tldCostSyncs = (Number(out.tldCostSyncs) || 0) + 1;
    }
  } catch (err) { console.error('[hosting-sync] tld cost pass failed', err); }
  return out;
}

// ── TLD wholesale costs → suggested sell prices ────────────────────────────────

export async function syncTldCosts(businessId: string, teamId: string, actorUid: string | null): Promise<{ updated: number; unmatched: string[]; belowCost: string[]; currency: string | null }> {
  const apiKey = await dynadotKeyFor(teamId);
  if (!apiKey) throw new Error('Çelësi i Dynadot nuk është konfiguruar');
  const settings = ((await db.collection('teamSettings').doc(teamId).get()).data() as any) || {};
  const marginPct = Number.isFinite(Number(settings.hostingTldMarginPct)) ? Number(settings.hostingTldMarginPct) : 40;
  const currency = await dynadotCurrencyFor(teamId);
  const prices = await dynadotTldPrices(apiKey, currency);
  const byTld = new Map(prices.map((p) => [p.tld, p]));
  const snap = await db.collection('domainTlds').where('businessId', '==', businessId).get();
  let updated = 0;
  const unmatched: string[] = [];
  const belowCost: string[] = [];
  const now = Timestamp.now();
  for (const doc of snap.docs) {
    const t = doc.data() as any;
    const p = byTld.get(normalizeTld(t.tld));
    if (!p || (p.register == null && p.renew == null)) { unmatched.push(String(t.tld)); continue; }
    const sameCurrency = !!p.currency && p.currency === t.currency;
    const suggestedRegister = p.register != null ? suggestSellPrice(p.register, marginPct) : null;
    const suggestedRenew = p.renew != null ? suggestSellPrice(p.renew, marginPct) : (suggestedRegister ?? null);
    const isBelow = sameCurrency && ((p.register != null && Number(t.registerPrice) < p.register) || (p.renew != null && Number(t.renewPrice) < p.renew));
    if (isBelow) belowCost.push(String(t.tld));
    await doc.ref.update({
      costRegister: p.register, costRenew: p.renew ?? p.register, costTransfer: p.transfer,
      costCurrency: p.currency, costSyncedAt: now,
      suggestedRegisterPrice: suggestedRegister, suggestedRenewPrice: suggestedRenew, suggestedMarginPct: marginPct,
      costCurrencyMismatch: !sameCurrency, belowCost: isBelow, updatedAt: now,
    });
    updated++;
  }
  await db.collection('teamSettings').doc(teamId).set({ hostingTldCostsSyncedAt: now, hostingTldCostsLastResult: { updated, unmatched: unmatched.slice(0, 30), belowCost } }, { merge: true });
  await logHostingEvent({ businessId, teamId, type: 'dynadot.tld_price', ok: true, message: `Kostot e ${updated} TLD u sinkronizuan${belowCost.length ? ` — NËN KOSTO: ${belowCost.join(', ')}` : ''}`, actorUserId: actorUid });
  if (belowCost.length) {
    await notifyMany(await staffRecipients(businessId, null), {
      type: 'hosting_drift', title: `TLD nën kosto: ${belowCost.join(', ')}`,
      message: 'Çmimi i shitjes është më i ulët se kostoja te Dynadot. Apliko çmimet e propozuara te Hosting → TLD-të.',
      actionUrl: '/app/hosting?tab=tlds', actionLabel: 'Shiko TLD-të', businessId, teamId,
    });
  }
  return { updated, unmatched, belowCost, currency: currency || null };
}

// ── Package upgrade with proration ─────────────────────────────────────────────

export async function quoteUpgrade(subscriptionId: string, productId: string, cycleIn: BillingCycle | null): Promise<{ amount: number; currency: 'ALL' | 'EUR'; oldPrice: number; newPrice: number; cycle: BillingCycle; daysRemaining: number; daysInPeriod: number; product: any }> {
  const s = (await db.collection('subscriptions').doc(subscriptionId).get()).data() as any;
  if (!s) throw new Error('Abonimi nuk u gjet');
  if (s.source !== 'fivocrm') throw new Error('Abonimi nuk menaxhohet nga FivoCRM');
  const p = (await db.collection('hostingProducts').doc(productId).get()).data() as any;
  if (!p || p.status !== 'Active') throw new Error('Paketa nuk u gjet');
  if (p.businessId !== s.businessId) throw new Error('Paketa i përket një biznesi tjetër');
  if (s.serverId && p.serverId && s.serverId !== p.serverId) throw new Error('Paketa është në një server tjetër — migrimi nuk mbështetet');
  const cycle: BillingCycle = cycleIn && isBillingCycle(cycleIn) ? cycleIn : (isBillingCycle(s.billingCycle) ? s.billingCycle : 'monthly');
  const np = cyclePrice(p.pricing, cycle);
  if (!np) throw new Error('Paketa nuk shitet me këtë cikël');
  const due = toDate(s.nextDueDate);
  const sameCycle = cycle === s.billingCycle;
  // Proration only makes sense inside the SAME cycle; a cycle change applies from
  // the next invoice with no charge now.
  const q = due && sameCycle
    ? prorationQuote({ oldPrice: Number(s.recurringAmount) || 0, newPrice: np.price, cycle, nextDueDate: due, now: new Date() })
    : { amount: 0, daysRemaining: 0, daysInPeriod: 0, fraction: 0 };
  return { amount: q.amount, currency: (p.currency === 'ALL' ? 'ALL' : 'EUR'), oldPrice: Number(s.recurringAmount) || 0, newPrice: np.price, cycle, daysRemaining: q.daysRemaining, daysInPeriod: q.daysInPeriod, product: { id: productId, name: p.name } };
}

/**
 * Upgrade now. Owes something → invoice `hst_upg_<sub>_<day>` and the package
 * changes when it is PAID (webhook / lifecycle). Owes nothing (downgrade, cycle
 * change) → applied immediately, effective from the next invoice.
 */
export async function requestUpgrade(subscriptionId: string, productId: string, cycleIn: BillingCycle | null, actorUid: string | null, opts: { portal?: boolean } = {}): Promise<{ applied: boolean; invoiceId?: string; amount: number; currency: string }> {
  const q = await quoteUpgrade(subscriptionId, productId, cycleIn);
  const ref = db.collection('subscriptions').doc(subscriptionId);
  const s = (await ref.get()).data() as any;
  if (s.pendingUpgrade?.invoiceId) {
    const inv = await db.collection('invoices').doc(String(s.pendingUpgrade.invoiceId)).get();
    if (inv.exists && (inv.data() as any).status !== 'Paid' && (inv.data() as any).status !== 'Cancelled') {
      return { applied: false, invoiceId: inv.id, amount: Number(s.pendingUpgrade.amount) || 0, currency: q.currency };
    }
  }
  if (q.amount <= 0) {
    await changeSubscriptionPackage(subscriptionId, productId, q.cycle, actorUid);
    return { applied: true, amount: 0, currency: q.currency };
  }
  const teamId = await teamIdForBusiness(s.businessId, s.teamId);
  const day = dayKey(new Date());
  const baseId = `hst_upg_${subscriptionId}_${day}`;
  const baseLabel = `HST-U-${day.replace(/-/g, '')}-${subscriptionId.slice(-4).toUpperCase()}`;
  const subject = `Upgrade ${s.productName} → ${q.product.name}${s.domain ? ` (${s.domain})` : ''}`;
  // The id is per (subscription, day). A second request the same day — after the
  // first invoice was CANCELLED, say — used to collide: `createHostingInvoice`
  // returned false unchecked, the cancelled invoice's `hostingUpgrade` was
  // overwritten, and the customer was emailed for an invoice they could not pay.
  // Now: the create result is checked, a collision with a still-open invoice for
  // the same package is REUSED (no second email), anything else gets a suffixed
  // id, and mail/notifications go out only for an invoice this call created.
  let invoiceId: string | null = null;
  let label = baseLabel;
  for (let n = 1; n <= 9 && !invoiceId; n++) {
    const candidate = n === 1 ? baseId : `${baseId}_${n}`;
    label = n === 1 ? baseLabel : `${baseLabel}-${n}`;
    const created = await createHostingInvoice({
      id: candidate, label, businessId: s.businessId ?? null, teamId, customerId: String(s.customerId), currency: q.currency, amount: q.amount,
      dueDate: utcNoon(new Date(Date.now() + 7 * 86_400_000)),
      notes: `Diferenca e paketës për ${q.daysRemaining} ditët e mbetura të periudhës aktuale (${q.daysInPeriod} ditë). Paketa ndryshon sapo paguhet.`,
      items: [{ description: `${subject} — proratë ${q.daysRemaining}/${q.daysInPeriod} ditë`, quantity: 1, unitPrice: q.amount }],
      link: { subscriptionId }, createdByUserId: actorUid,
    });
    if (created) { invoiceId = candidate; break; }
    const prev = (await db.collection('invoices').doc(candidate).get()).data() as any;
    const open = !!prev && prev.status !== 'Paid' && prev.status !== 'Cancelled';
    if (open && prev.hostingUpgrade?.productId === productId && String(prev.customerId) === String(s.customerId)) {
      const amount = Number(prev.total) || q.amount;
      await ref.update({ pendingUpgrade: { productId, cycle: q.cycle, invoiceId: candidate, amount, requestedAt: Timestamp.now() }, updatedAt: Timestamp.now() });
      return { applied: false, invoiceId: candidate, amount, currency: q.currency };
    }
  }
  if (!invoiceId) throw new Error('Fatura e upgrade-it nuk u krijua dot: shumë fatura për këtë abonim sot.');
  await db.collection('invoices').doc(invoiceId).update({ hostingUpgrade: { productId, cycle: q.cycle, requestedBy: opts.portal ? 'portal' : 'staff' } }).catch(() => {});
  await ref.update({ pendingUpgrade: { productId, cycle: q.cycle, invoiceId, amount: q.amount, requestedAt: Timestamp.now() }, updatedAt: Timestamp.now() });
  await logHostingEvent({ businessId: s.businessId, teamId, customerId: s.customerId, subscriptionId, type: 'sub.upgradeRequested', ok: true, message: `${subject}: ${q.amount} ${q.currency} (proratë)`, actorUserId: actorUid });
  await emailInvoiceToCustomer(invoiceId, String(s.customerId), teamId, { amount: q.amount, currency: q.currency, dueDate: new Date(Date.now() + 7 * 86_400_000), subject, label }).catch(() => {});
  const portalUid = await portalUserIdFor(s.customerId);
  await notifyMany([portalUid, ...(await staffRecipients(s.businessId, s.createdByUserId))], {
    type: 'hosting_upgrade_invoice', title: `Faturë upgrade: ${q.product.name}`,
    message: `${formatMoney(q.amount, q.currency)} për ditët e mbetura. Paketa ndryshon pas pagesës.`,
    actionUrl: portalUid ? `/portal/invoices?invoice=${invoiceId}` : `/app/invoices?invoice=${invoiceId}`, actionLabel: 'Shiko faturën',
    businessId: s.businessId ?? null, teamId, customerId: s.customerId ?? null,
  });
  return { applied: false, invoiceId, amount: q.amount, currency: q.currency };
}

export async function applyPendingUpgrade(subscriptionId: string, invoiceId: string, actorUid: string | null): Promise<boolean> {
  const ref = db.collection('subscriptions').doc(subscriptionId);
  const s = (await ref.get()).data() as any;
  if (!s?.pendingUpgrade || s.pendingUpgrade.invoiceId !== invoiceId) return false;
  await changeSubscriptionPackage(subscriptionId, String(s.pendingUpgrade.productId), isBillingCycle(s.pendingUpgrade.cycle) ? s.pendingUpgrade.cycle : null, actorUid);
  await ref.update({ pendingUpgrade: null, updatedAt: Timestamp.now() });
  const portalUid = await portalUserIdFor(s.customerId);
  await notifyMany([portalUid], {
    type: 'hosting_provisioned', title: 'Paketa u ndryshua ✓', message: 'Upgrade-i u aplikua pas pagesës.',
    actionUrl: '/portal/hosting', actionLabel: 'Shiko', businessId: s.businessId, teamId: s.teamId, customerId: s.customerId,
  });
  return true;
}

// ── Scheduled backups ──────────────────────────────────────────────────────────

export async function backupSubscription(subscriptionId: string, kind: 'scheduled' | 'manual', actorUid: string | null): Promise<{ ok: boolean; path?: string; error?: string }> {
  const ref = db.collection('subscriptions').doc(subscriptionId);
  const s = (await ref.get()).data() as any;
  if (!s?.cpanelUsername || !s.serverId) return { ok: false, error: 'Abonimi nuk ka llogari cPanel' };
  const server = await loadServer(String(s.serverId));
  if (!server?.whm.apiToken) return { ok: false, error: server ? noTokenMessage(server) : 'Serveri nuk u gjet' };
  try {
    await assertAccountOwned(server.whm, String(s.cpanelUsername), s.domain);
    const b = await whmBackupAccount(server.whm, String(s.cpanelUsername));
    await ref.update({ lastBackupAt: Timestamp.now(), lastBackupPath: b.path ?? null, lastBackupError: null, updatedAt: Timestamp.now() });
    await db.collection('hostingBackups').add({ businessId: s.businessId ?? null, teamId: s.teamId ?? null, customerId: s.customerId ?? null, subscriptionId, serverId: s.serverId, cpanelUsername: s.cpanelUsername, domain: s.domain || null, kind, path: b.path ?? null, ok: true, createdAt: Timestamp.now(), createdByUserId: actorUid });
    await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.pkgacct', ok: true, message: `Backup ${kind} i ${s.cpanelUsername}${b.path ? `: ${b.path}` : ''}`, actorUserId: actorUid });
    return { ok: true, path: b.path };
  } catch (err) {
    const msg = redactProviderError(err);
    await ref.update({ lastBackupError: msg, lastBackupAttemptAt: Timestamp.now(), updatedAt: Timestamp.now() }).catch(() => {});
    await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.pkgacct', ok: false, message: msg, actorUserId: actorUid });
    await notifyMany(await staffRecipients(s.businessId, s.createdByUserId), {
      type: 'hosting_backup_failed', title: `Backup dështoi: ${s.domain || s.cpanelUsername}`, message: msg.slice(0, 200),
      actionUrl: '/app/hosting?tab=subscriptions', actionLabel: 'Shiko', businessId: s.businessId, teamId: s.teamId, customerId: s.customerId,
    });
    return { ok: false, error: msg };
  }
}

/**
 * `?job=hosting-backups` — every 30 min from the VPS. Backs up the `max` most
 * overdue active accounts (pkgacct is slow; one function run must stay under the
 * budget). Interval per tenant: `teamSettings.hostingBackupIntervalDays` (default 7,
 * 0 = off). Failed attempts wait 12h before being retried.
 */
export async function runHostingBackups(opts: { businessId?: string | null; max?: number } = {}): Promise<Record<string, unknown>> {
  const scopeId = opts.businessId || null;
  const max = Math.max(1, Math.min(5, opts.max ?? 2));
  const scoped = <T extends FirebaseFirestore.Query>(q: T): T => (scopeId ? q.where('businessId', '==', scopeId) : q) as T;
  const suspendedTenants = await suspendedBusinessIds();
  const subs = await scoped(db.collection('subscriptions').where('source', '==', 'fivocrm').where('status', 'in', ['Active', 'Suspended'])).limit(1000).get();
  const intervalCache = new Map<string, number>();
  const due: Array<{ id: string; overdueMs: number }> = [];
  const now = Date.now();
  for (const doc of subs.docs) {
    const s = doc.data() as any;
    if (!s.cpanelUsername || !s.serverId) continue;
    if (s.businessId && suspendedTenants.has(s.businessId)) continue;
    const teamId = await teamIdForBusiness(s.businessId, s.teamId);
    const k = teamId || '';
    if (!intervalCache.has(k)) {
      const ts = teamId ? ((await db.collection('teamSettings').doc(teamId).get()).data() as any) || {} : {};
      const v = ts.hostingBackupIntervalDays;
      intervalCache.set(k, v === undefined || v === null ? 7 : Math.max(0, Number(v) || 0));
    }
    const days = intervalCache.get(k)!;
    if (days <= 0) continue;
    const last = toDate(s.lastBackupAt);
    const attempt = toDate(s.lastBackupAttemptAt);
    if (attempt && now - attempt.getTime() < 12 * 3_600_000 && (!last || attempt > last)) continue;
    const overdueMs = now - ((last?.getTime() ?? 0) + days * 86_400_000);
    if (overdueMs >= 0) due.push({ id: doc.id, overdueMs });
  }
  due.sort((a, b) => b.overdueMs - a.overdueMs);
  let ok = 0, failed = 0;
  for (const d of due.slice(0, max)) {
    const r = await backupSubscription(d.id, 'scheduled', null);
    if (r.ok) ok++; else failed++;
  }
  return { due: due.length, backedUp: ok, failed, businessId: scopeId };
}

// ── Weekly expiry digest ───────────────────────────────────────────────────────

/** `?job=hosting-expiry-report` — Mondays 08:00 local. One digest per tenant to its managers. */
export async function runHostingExpiryReport(opts: { businessId?: string | null } = {}): Promise<Record<string, unknown>> {
  const scopeId = opts.businessId || null;
  const scoped = <T extends FirebaseFirestore.Query>(q: T): T => (scopeId ? q.where('businessId', '==', scopeId) : q) as T;
  const suspendedTenants = await suspendedBusinessIds();
  const now = new Date();
  const [subsSnap, domsSnap] = await Promise.all([
    scoped(db.collection('subscriptions').where('source', '==', 'fivocrm').where('status', 'in', ['Active', 'Suspended'])).limit(2000).get(),
    scoped(db.collection('domains').where('source', '==', 'fivocrm').where('status', 'in', ['Active', 'Grace'])).limit(2000).get(),
  ]);
  const byBiz = new Map<string, { subs: any[]; doms: any[]; teamId: string | null }>();
  const bucket = (bid: string, teamId: string | null) => {
    if (!byBiz.has(bid)) byBiz.set(bid, { subs: [], doms: [], teamId });
    const b = byBiz.get(bid)!;
    if (!b.teamId && teamId) b.teamId = teamId;
    return b;
  };
  subsSnap.docs.forEach((d) => { const s = d.data() as any; if (s.businessId) bucket(String(s.businessId), s.teamId || null).subs.push({ id: d.id, ...s, nextDueDate: toDate(s.nextDueDate) }); });
  domsSnap.docs.forEach((d) => { const x = d.data() as any; if (x.businessId) bucket(String(x.businessId), x.teamId || null).doms.push({ id: d.id, ...x, expiryDate: toDate(x.expiryDate) }); });
  let sent = 0, tenants = 0;
  for (const [bid, b] of byBiz) {
    if (suspendedTenants.has(bid)) continue;
    tenants++;
    const report = buildExpiryReport(b.subs, b.doms, now);
    const teamId = await teamIdForBusiness(bid, b.teamId);
    if (teamId) {
      await db.collection('teamSettings').doc(teamId).set({ hostingExpiryReport: { at: Timestamp.now(), domains30: report.domainsWithin30.length, domains60: report.domainsWithin60.length, subsDue30: report.subscriptionsDueWithin30.length, unpaid: report.unpaidRenewals.length, suspended: report.suspended.length } }, { merge: true });
    }
    if (report.total === 0) continue;
    const fmt = (r: { name: string; daysLeft: number; amount: number; currency?: string | null }) => `${r.name} (${r.daysLeft} ditë, ${formatMoney(r.amount, r.currency)})`;
    const parts: string[] = [];
    if (report.domainsWithin30.length) parts.push(`Domain-e ≤30 ditë: ${report.domainsWithin30.slice(0, 8).map(fmt).join('; ')}${report.domainsWithin30.length > 8 ? ' …' : ''}`);
    if (report.domainsWithin60.length) parts.push(`Domain-e 31–60 ditë: ${report.domainsWithin60.length}`);
    if (report.subscriptionsDueWithin30.length) parts.push(`Hosting me afat ≤30 ditë: ${report.subscriptionsDueWithin30.slice(0, 8).map(fmt).join('; ')}`);
    if (report.unpaidRenewals.length) parts.push(`Rinovime TË PAPAGUARA pas afatit: ${report.unpaidRenewals.map(fmt).join('; ')}`);
    if (report.suspended.length) parts.push(`Të pezulluara: ${report.suspended.map((r) => r.name).join(', ')}`);
    const managers = await managerIdsForBusiness(bid, teamId);
    await notifyMany(managers, {
      type: 'hosting_expiry_report',
      title: `Raporti javor hosting & domain-e (${report.total} artikuj)`,
      message: parts.join(' • ').slice(0, 1500),
      actionUrl: '/app/hosting?tab=domains', actionLabel: 'Hape modulin', businessId: bid, teamId,
    });
    sent += managers.length;
  }
  return { tenants, notificationsSent: sent, businessId: scopeId };
}

// ── DNS: point a domain at the customer's hosting (Dynadot DNS) ────────────────

export async function pointDomainToHosting(domainId: string, target: { subscriptionId?: string | null; ip?: string | null }, actorUid: string | null): Promise<{ ip: string }> {
  const ref = db.collection('domains').doc(domainId);
  const d = (await ref.get()).data() as any;
  if (!d) throw new Error('Domain-i nuk u gjet');
  if (d.source !== 'fivocrm' || d.registrar !== 'dynadot') throw new Error('Ky domain nuk menaxhohet nga FivoCRM/Dynadot');
  let ip = String(target.ip || '').trim();
  let subscriptionId: string | null = null;
  if (target.subscriptionId) {
    const s = (await db.collection('subscriptions').doc(String(target.subscriptionId)).get()).data() as any;
    if (!s) throw new Error('Abonimi nuk u gjet');
    if (s.customerId !== d.customerId || s.businessId !== d.businessId) throw new Error('Abonimi nuk i përket të njëjtit klient');
    const server = await loadServer(String(s.serverId || ''));
    ip = String(server?.data?.ipAddress || '').trim();
    if (!ip) throw new Error(`Serveri "${server?.data?.name || '?'}" nuk ka IP publike të vendosur (Hosting → Serverët)`);
    subscriptionId = String(target.subscriptionId);
  }
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error('IP e pavlefshme');
  const teamId = await teamIdForBusiness(d.businessId, d.teamId);
  const apiKey = await dynadotKeyFor(teamId);
  if (!apiKey) throw new Error('Çelësi i Dynadot mungon');
  try {
    await dynadotSetDnsToIp(apiKey, String(d.domainName), ip);
  } catch (err) {
    await logHostingEvent({ businessId: d.businessId, teamId, customerId: d.customerId, domainId, type: 'dynadot.set_dns2', ok: false, message: redactProviderError(err), actorUserId: actorUid });
    throw err;
  }
  await ref.update({ dnsMode: 'dynadot-dns', dnsTargetIp: ip, ...(subscriptionId ? { subscriptionId } : {}), updatedAt: Timestamp.now() });
  await logHostingEvent({ businessId: d.businessId, teamId, customerId: d.customerId, domainId, type: 'dynadot.set_dns2', ok: true, message: `${d.domainName} → A ${ip} (apex + www) me DNS të Dynadot`, actorUserId: actorUid });
  return { ip };
}
