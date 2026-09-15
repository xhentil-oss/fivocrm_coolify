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
import {
  CYCLE_LABELS, DEFAULT_LIFECYCLE, dayKey, decideDomain, decideSubscription, deriveCpanelUsername,
  generateAccountPassword, normalizeLifecycleConfig, nextDueDate, parseDomain, renewSubscriptionPatch,
  renewalInvoiceId, utcNoon, addYearsClamped, isBillingCycle,
  type BillingCycle, type DomainFacts, type LifecycleConfig, type SubscriptionFacts,
} from './_hostingEngine.js';
import {
  ProviderError, redactProviderError, isWhmAccountExists,
  whmCreateAccount, whmSuspendAccount, whmUnsuspendAccount, whmTerminateAccount, whmChangePackage,
  whmSetPassword, whmCreateSession, whmAccountSummary, whmListAccounts, whmListPackages, whmVersion,
  dynadotRegister, dynadotRenew, dynadotTransfer, dynadotDomainInfo, dynadotSetNameservers, dynadotAccountInfo,
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

/** Server doc + its token from the deny-all `hostingServerSecrets` collection. */
export async function loadServer(serverId: string): Promise<{ id: string; data: any; whm: WhmServer } | null> {
  if (!serverId) return null;
  const [doc, secret] = await Promise.all([
    db.collection('hostingServers').doc(serverId).get(),
    db.collection('hostingServerSecrets').doc(serverId).get(),
  ]);
  if (!doc.exists) return null;
  const data = doc.data() as any;
  const apiToken = String((secret.data() as any)?.apiToken || '');
  return {
    id: doc.id,
    data,
    whm: { hostname: data.hostname, port: Number(data.port) || 2087, username: data.username || 'root', apiToken },
  };
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
  await ref.update({
    status, lines,
    lastError: errors.length ? errors.join(' | ').slice(0, 900) : null,
    ...(allDone ? { provisionedAt: Timestamp.now() } : {}),
    updatedAt: Timestamp.now(),
  });

  if (errors.length) {
    await notifyMany(await staffRecipients(businessId, order.createdByUserId), {
      type: 'hosting_provision_failed',
      title: `⚠️ Aktivizimi i porosisë ${order.orderNumber || ''} dështoi`,
      message: errors[0].slice(0, 200),
      actionUrl: '/app/hosting?tab=orders',
      actionLabel: 'Shiko porositë',
      businessId, teamId, customerId: order.customerId,
    });
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
  if (!server.whm.apiToken) throw new Error(`Serveri "${server.data.name}" nuk ka API token`);
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
    // Welcome mail with the credentials — the ONLY place the password ever exists.
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
            <tr><td style="padding:6px 12px;color:#555">Fjalëkalimi</td><td style="padding:6px 12px"><code>${esc(password)}</code></td></tr>
            <tr><td style="padding:6px 12px;color:#555">Nameservers</td><td style="padding:6px 12px">${nameservers.map(esc).join('<br>') || '—'}</td></tr>
          </table>
          <p>Mund të hyni edhe pa fjalëkalim nga portali juaj: <a href="${BASE_URL}/portal/hosting">${BASE_URL}/portal/hosting</a></p>
          <p style="color:#777;font-size:12px">Ju lutemi ndryshoni fjalëkalimin pas hyrjes së parë.</p>
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
    if (await applySubscriptionRenewal(String(inv.subscriptionId), invoiceId, actorUid)) handled.push('subscription-renewed');
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
  if (!server?.whm.apiToken) throw new Error('Serveri nuk ka API token');
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
  if (!server?.whm.apiToken) throw new Error('Serveri nuk ka API token');
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

/** DESTRUCTIVE: removes the cPanel account. Files are gone. */
export async function terminateSubscription(subscriptionId: string, reason: string, actorUid: string | null): Promise<void> {
  const ref = db.collection('subscriptions').doc(subscriptionId);
  const s = (await ref.get()).data() as any;
  if (!s) throw new Error('Abonimi nuk u gjet');
  if (s.cpanelUsername && s.serverId) {
    const server = await loadServer(String(s.serverId));
    if (server?.whm.apiToken) {
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
    if (!server?.whm.apiToken) throw new Error('Serveri nuk ka API token');
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

export async function resetSubscriptionPassword(subscriptionId: string, actorUid: string | null): Promise<string> {
  const s = (await db.collection('subscriptions').doc(subscriptionId).get()).data() as any;
  if (!s?.cpanelUsername || !s.serverId) throw new Error('Abonimi nuk ka llogari cPanel');
  const server = await loadServer(String(s.serverId));
  if (!server?.whm.apiToken) throw new Error('Serveri nuk ka API token');
  const password = generateAccountPassword();
  try {
    await whmSetPassword(server.whm, String(s.cpanelUsername), password);
  } catch (err) {
    await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.passwd', ok: false, message: redactProviderError(err), actorUserId: actorUid });
    throw err;
  }
  await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.passwd', ok: true, message: `Fjalëkalimi i ${s.cpanelUsername} u ndryshua`, actorUserId: actorUid });
  return password;
}

export async function subscriptionSsoUrl(subscriptionId: string, actorUid: string | null): Promise<string> {
  const s = (await db.collection('subscriptions').doc(subscriptionId).get()).data() as any;
  if (!s?.cpanelUsername || !s.serverId) throw new Error('Abonimi nuk ka llogari cPanel');
  if (s.status !== 'Active') throw new Error('Llogaria nuk është aktive');
  const server = await loadServer(String(s.serverId));
  if (!server?.whm.apiToken) throw new Error('Serveri nuk ka API token');
  const url = await whmCreateSession(server.whm, String(s.cpanelUsername));
  await logHostingEvent({ businessId: s.businessId, teamId: s.teamId, customerId: s.customerId, subscriptionId, type: 'whm.sso', ok: true, message: `Sesion cPanel për ${s.cpanelUsername}`, actorUserId: actorUid });
  return url;
}

export async function subscriptionUsage(subscriptionId: string): Promise<{ diskUsedMb: number | null; diskLimitMb: number | null; suspended: boolean; ip?: string; plan?: string } | null> {
  const s = (await db.collection('subscriptions').doc(subscriptionId).get()).data() as any;
  if (!s?.cpanelUsername || !s.serverId) return null;
  const server = await loadServer(String(s.serverId));
  if (!server?.whm.apiToken) return null;
  const a = await whmAccountSummary(server.whm, String(s.cpanelUsername));
  if (!a) return null;
  return { diskUsedMb: a.diskUsedMb ?? null, diskLimitMb: a.diskLimitMb ?? null, suspended: a.suspended, ip: a.ip, plan: a.plan };
}

export async function testServer(serverId: string, actorUid: string | null): Promise<{ ok: boolean; version?: string; packages?: string[]; accounts?: number; error?: string }> {
  const server = await loadServer(serverId);
  if (!server) throw new Error('Serveri nuk u gjet');
  const ref = db.collection('hostingServers').doc(serverId);
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
    const pending = await scoped(db.collection('hostingOrders').where('status', 'in', ['Pending', 'Paid'])).limit(200).get();
    for (const doc of pending.docs) {
      const o = doc.data() as any;
      if (o.businessId && suspendedTenants.has(o.businessId)) { r.suspendedTenantsSkipped++; continue; }
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
  const out = { servers: 0, serversFailed: 0, domainsSynced: 0, domainsFailed: 0, transfersCompleted: 0, drift: 0, businessId: scopeId };

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
      for (const s of subs.docs) {
        const d = s.data() as any;
        if (!d.cpanelUsername || d.status === 'Terminated' || d.status === 'Cancelled' || d.status === 'Pending') continue;
        const a = byUser.get(String(d.cpanelUsername));
        const whmState = !a ? 'missing' : a.suspended ? 'Suspended' : 'Active';
        if (whmState !== d.status) {
          out.drift++;
          await logHostingEvent({ businessId: d.businessId, teamId: d.teamId, customerId: d.customerId, subscriptionId: s.id, type: 'sync.drift', ok: false, message: `WHM: ${whmState}, FivoCRM: ${d.status} (${d.cpanelUsername})` });
        }
        if (a) await s.ref.update({ diskUsedMb: a.diskUsedMb ?? null, diskLimitMb: a.diskLimitMb ?? null, lastSyncAt: Timestamp.now() }).catch(() => {});
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
  return out;
}
