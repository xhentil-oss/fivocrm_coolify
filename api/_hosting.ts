/**
 * POST /api/hosting  (rewritten to /api/email?type=hosting — Vercel's 12-function cap)
 *
 * One endpoint, dispatched on `body.action`. Two callers:
 *   • STAFF of a business (`bid` claim, membership-doc fallback) — everything.
 *     Config actions (server tokens, registrar key, lifecycle settings) need Admin/Manager.
 *   • A PORTAL CLIENT (`cid` claim) — only on its OWN subscriptions/domains/orders:
 *     domain availability, placing an order, cPanel SSO/usage/password, nameservers,
 *     auto-renew, cancel-at-period-end, EPP code.
 *
 * The server never trusts ids from the body for tenancy: every record is loaded and
 * its `businessId` / `customerId` compared with the caller's claims.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin, { adminAuth, adminDb as db } from './_firebaseAdmin.js';
import { writeAudit } from './_audit.js';
import { writeTeamSecrets } from './_tenantConfig.js';
import { encryptSecret } from './_secretCrypto.js';
import { normalizeHostname } from './_hostingProviders.js';
import {
  priceOrder, parseDomain, isBillingCycle, type OrderLineInput, type TldPricing, ORDER_ERROR_LABELS,
  applyCoupon, normalizeCouponCode, COUPON_ERROR_LABELS, type CouponFacts, type PricedOrder,
} from './_hostingEngine.js';
import { dynadotSearch, dynadotSetNameservers, dynadotSetPrivacy, dynadotSetRenewOption, dynadotGetAuthCode, redactProviderError } from './_hostingProviders.js';
import {
  invoiceForOrder, provisionOrder, suspendSubscription, unsuspendSubscription, terminateSubscription,
  changeSubscriptionPackage, resetSubscriptionPassword, subscriptionSsoUrl, subscriptionUsage, testServer, testRegistrar,
  runHostingLifecycle, runHostingSync, dynadotKeyFor, dynadotCurrencyFor, teamIdForBusiness, logHostingEvent, onHostingInvoicePaid,
  addExistingSubscription, addExistingDomain, adoptWhmcsSubscription,
  syncTldCosts, quoteUpgrade, requestUpgrade, backupSubscription, pointDomainToHosting, toDate,
} from './_hostingJobs.js';

const Timestamp = admin.firestore.Timestamp;

interface Caller {
  uid: string;
  email: string | null;
  superAdmin: boolean;
  /** Staff tenant (null for a portal client). */
  bid: string | null;
  tid: string | null;
  roles: string[];
  /** Portal client's customer id (null for staff). */
  cid: string | null;
  pbid: string | null;
}

async function resolveCaller(decoded: admin.auth.DecodedIdToken): Promise<Caller> {
  const d = decoded as any;
  const c: Caller = {
    uid: decoded.uid, email: decoded.email ?? null, superAdmin: d.superAdmin === true,
    bid: typeof d.bid === 'string' && d.bid ? d.bid : null,
    tid: typeof d.tid === 'string' && d.tid ? d.tid : null,
    roles: Array.isArray(d.roles) ? d.roles.map(String) : [],
    cid: typeof d.cid === 'string' && d.cid ? d.cid : null,
    pbid: typeof d.pbid === 'string' && d.pbid ? d.pbid : null,
  };
  if (!c.bid && !c.cid && !c.superAdmin) {
    // Tokens minted before the claims rollout: fall back to the membership doc.
    try {
      const m = await db.collection('teamMembers').where('userId', '==', decoded.uid).limit(1).get();
      if (!m.empty) {
        const md = m.docs[0].data() as any;
        if (md.status !== 'Inactive') {
          c.bid = md.businessId || md.teamId || null;
          c.tid = md.teamId || null;
          c.roles = md.role ? [String(md.role)] : [];
        }
      }
    } catch { /* stays anonymous → 403 below */ }
  }
  return c;
}

const isStaff = (c: Caller) => c.superAdmin || !!c.bid;
const isConfigAdmin = (c: Caller) => c.superAdmin || c.roles.some((r) => /^(Admin|Manager|Owner)$/i.test(r));
const sameTenant = (c: Caller, businessId: unknown) => c.superAdmin || (!!c.bid && c.bid === businessId);

class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }
const bad = (msg: string) => new HttpError(400, msg);
const forbidden = (msg = 'Nuk keni të drejta për këtë veprim.') => new HttpError(403, msg);
const notFound = (msg = 'Nuk u gjet.') => new HttpError(404, msg);
// Audit Sep 2026: every action that CHANGES a provider account, a registrar record
// or a lifecycle flag is Admin/Manager/Owner only. Read-only actions (usage, quotes,
// availability, live status) stay open to any staff; portal-client actions on the
// client's OWN records are unchanged.
const MUTATION_NEEDS_ADMIN = 'Vetëm Admin/Manager mund të kryejë këtë veprim.';

/**
 * Fixed-window rate limit per (uid, action) in `hostingRateLimits` (deny-all for
 * clients). `domain.check` hits Dynadot (their quota, our reputation) and
 * `order.create` sends invoices + emails — a portal client must not be able to loop
 * either. One transaction per call; a Firestore hiccup fails OPEN (logged), because a
 * blocked legitimate order costs more than a burst.
 */
async function assertRate(uid: string, action: string, max: number, windowMs: number): Promise<void> {
  const ref = db.collection('hostingRateLimits').doc(`${uid}_${action}`);
  let over = false;
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      const d = snap.exists ? (snap.data() as any) : null;
      const start = d && typeof d.windowStart === 'number' && now - d.windowStart < windowMs ? d.windowStart : now;
      const count = start === d?.windowStart ? Number(d.count) || 0 : 0;
      if (count >= max) { over = true; return; }
      tx.set(ref, { uid, action, windowStart: start, count: count + 1, updatedAt: Timestamp.now() });
    });
  } catch (err) { console.error('[hosting] rate-limit write failed (failing open)', err); }
  if (over) throw new HttpError(429, 'Shumë kërkesa — provo sërish më vonë.');
}

async function loadOwned(collection: 'subscriptions' | 'domains' | 'hostingOrders', id: string, c: Caller): Promise<{ id: string; data: any }> {
  if (!id || typeof id !== 'string') throw bad('Mungon id');
  const snap = await db.collection(collection).doc(id).get();
  if (!snap.exists) throw notFound();
  const data = snap.data() as any;
  if (isStaff(c)) {
    if (!sameTenant(c, data.businessId)) throw forbidden();
  } else if (c.cid) {
    if (data.customerId !== c.cid) throw forbidden();
  } else throw forbidden();
  return { id: snap.id, data };
}

async function loadTlds(businessId: string): Promise<TldPricing[]> {
  const snap = await db.collection('domainTlds').where('businessId', '==', businessId).where('status', '==', 'Active').get();
  return snap.docs.map((d) => {
    const t = d.data() as any;
    return { tld: String(t.tld || ''), currency: t.currency === 'ALL' ? 'ALL' : 'EUR', registerPrice: Number(t.registerPrice) || 0, renewPrice: Number(t.renewPrice) || 0, transferPrice: t.transferPrice != null ? Number(t.transferPrice) : undefined, minYears: t.minYears, maxYears: t.maxYears, status: 'Active', portalVisible: t.portalVisible } as TldPricing & { portalVisible?: boolean };
  });
}

async function nextOrderNumber(businessId: string): Promise<string> {
  const year = new Date().getFullYear();
  const snap = await db.collection('hostingOrders').where('businessId', '==', businessId).orderBy('createdAt', 'desc').limit(1).get().catch(() => null);
  let n = 1;
  if (snap && !snap.empty) {
    const last = String((snap.docs[0].data() as any).orderNumber || '');
    const m = /HOS-(\d{4})-(\d+)/.exec(last);
    if (m && Number(m[1]) === year) n = Number(m[2]) + 1;
  }
  return `HOS-${year}-${String(n).padStart(4, '0')}`;
}

/**
 * Price an order request from the CATALOG (never from the body), apply the
 * free-domain rule and an optional coupon. Shared by `order.quote` and
 * `order.create`, so what the cart shows is exactly what gets invoiced.
 */
async function priceOrderRequest(c: Caller, body: Record<string, any>): Promise<{
  businessId: string; customerId: string; source: 'staff' | 'portal'; priced: PricedOrder; coupon: { id: string; data: any } | null; couponError: string | null;
}> {
  let businessId: string; let customerId: string; let source: 'staff' | 'portal';
  if (isStaff(c)) {
    customerId = String(body.customerId || '');
    if (!customerId) throw bad('Mungon klienti');
    const cust = await db.collection('customers').doc(customerId).get();
    if (!cust.exists) throw notFound('Klienti nuk u gjet');
    businessId = String((cust.data() as any).businessId || c.bid || '');
    if (!sameTenant(c, businessId)) throw forbidden();
    source = 'staff';
  } else if (c.cid) {
    customerId = c.cid;
    const cust = await db.collection('customers').doc(customerId).get();
    if (!cust.exists) throw notFound('Klienti nuk u gjet');
    businessId = String((cust.data() as any).businessId || c.pbid || '');
    source = 'portal';
  } else throw forbidden();
  const linesIn: any[] = Array.isArray(body.lines) ? body.lines : [];
  if (!linesIn.length) throw bad(ORDER_ERROR_LABELS.empty);
  const productIds = Array.from(new Set(linesIn.filter((l) => l.kind === 'hosting').map((l) => String(l.productId || ''))));
  const products = new Map<string, any>();
  for (const pid of productIds) {
    if (!pid) continue;
    const p = await db.collection('hostingProducts').doc(pid).get();
    if (!p.exists) throw bad('Paketa nuk ekziston');
    const pd = p.data() as any;
    if (pd.businessId !== businessId || pd.status !== 'Active' || (source === 'portal' && !pd.portalVisible)) throw bad('Paketa nuk është në shitje');
    products.set(pid, { ...pd, id: pid });
  }
  const tlds = await loadTlds(businessId);
  const inputs: OrderLineInput[] = linesIn.map((l) => {
    if (l.kind === 'hosting') {
      const p = products.get(String(l.productId || ''));
      return { kind: 'hosting', productId: p?.id, productName: p?.name, cycle: isBillingCycle(l.cycle) ? l.cycle : undefined, pricing: p ? { ...p.pricing, currency: p.currency } : null, domainName: String(l.domainName || ''), freeDomainTlds: Array.isArray(p?.freeDomainTlds) ? p.freeDomainTlds : null, freeDomainMinCycle: isBillingCycle(p?.freeDomainMinCycle) ? p.freeDomainMinCycle : null };
    }
    return { kind: l.kind === 'domain-transfer' ? 'domain-transfer' : 'domain-register', domainName: String(l.domainName || ''), years: Number(l.years) || 1, authCode: l.authCode ? String(l.authCode) : undefined };
  });
  const priced = priceOrder(inputs, tlds.filter((t: any) => source === 'staff' || t.portalVisible !== false));
  if (!priced.ok) throw bad(ORDER_ERROR_LABELS[priced.error] + (priced.index !== undefined ? ` (rreshti ${priced.index + 1})` : ''));
  let order = priced.order;
  let coupon: { id: string; data: any } | null = null;
  let couponError: string | null = null;
  const code = normalizeCouponCode(body.couponCode);
  if (code) {
    const snap = await db.collection('hostingCoupons').where('businessId', '==', businessId).where('code', '==', code).limit(1).get();
    const doc = snap.empty ? null : snap.docs[0];
    const cd = doc ? (doc.data() as any) : null;
    const facts: CouponFacts | null = cd ? {
      code, type: cd.type === 'fixed' ? 'fixed' : 'percent', value: Number(cd.value) || 0, currency: cd.currency || null,
      appliesTo: cd.appliesTo === 'hosting' || cd.appliesTo === 'domains' ? cd.appliesTo : 'all', status: cd.status,
      validFrom: toDate(cd.validFrom), validUntil: toDate(cd.validUntil), maxUses: cd.maxUses ?? null, uses: Number(cd.uses) || 0, minTotal: cd.minTotal ?? null,
    } : null;
    const applied = applyCoupon(order, facts, new Date());
    if (applied.ok) { order = applied.order; coupon = doc ? { id: doc.id, data: cd } : null; }
    else couponError = COUPON_ERROR_LABELS[applied.error];
  }
  return { businessId, customerId, source, priced: order, coupon, couponError };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const authHeader = req.headers.authorization as string | undefined;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  let decoded: admin.auth.DecodedIdToken;
  try { decoded = await adminAuth.verifyIdToken(authHeader.slice(7)); }
  catch { return res.status(401).json({ error: 'Invalid token' }); }
  const c = await resolveCaller(decoded);
  const body = (req.body || {}) as Record<string, any>;
  const action = String(body.action || '');
  const audit = (act: string, target: string | null, meta?: Record<string, any>) =>
    writeAudit({ businessId: c.bid || c.pbid, actorUid: c.uid, actorEmail: c.email, action: `hosting.${act}`, target, meta }).catch(() => {});

  try {
    switch (action) {
      // ── Config (staff Admin/Manager) ──────────────────────────────────────
      case 'server.saveToken': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden('Vetëm Admin/Manager mund të ruajë token-in e serverit.');
        const serverId = String(body.serverId || '');
        const token = String(body.apiToken || '').trim();
        const snap = await db.collection('hostingServers').doc(serverId).get();
        if (!snap.exists) throw notFound('Serveri nuk u gjet');
        if (!sameTenant(c, (snap.data() as any).businessId)) throw forbidden();
        if (token) {
          const sd = snap.data() as any;
          // Encrypted at rest and BOUND to the hostname/user it was issued for — see loadServer().
          await db.collection('hostingServerSecrets').doc(serverId).set({
            apiToken: encryptSecret(token), hostname: normalizeHostname(String(sd.hostname || '')), username: String(sd.username || 'root'),
            businessId: sd.businessId ?? null, updatedAt: Timestamp.now(), updatedBy: c.uid,
          }, { merge: true });
        } else {
          await db.collection('hostingServerSecrets').doc(serverId).delete().catch(() => {});
        }
        await snap.ref.update({ hasApiToken: !!token, updatedAt: Timestamp.now() });
        await audit('server.token', `server:${serverId}`, { set: !!token });
        const test = token ? await testServer(serverId, c.uid) : null;
        return res.status(200).json({ ok: true, test });
      }
      case 'server.test': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden(MUTATION_NEEDS_ADMIN);
        const serverId = String(body.serverId || '');
        const snap = await db.collection('hostingServers').doc(serverId).get();
        if (!snap.exists) throw notFound('Serveri nuk u gjet');
        if (!sameTenant(c, (snap.data() as any).businessId)) throw forbidden();
        return res.status(200).json(await testServer(serverId, c.uid));
      }
      case 'registrar.saveKey': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden('Vetëm Admin/Manager mund të ruajë çelësin e Dynadot.');
        const teamId = String(body.teamId || c.tid || '');
        if (!teamId) throw bad('Mungon teamId');
        const team = await db.collection('teams').doc(teamId).get();
        if (!team.exists || !sameTenant(c, (team.data() as any).businessId || teamId)) throw forbidden();
        await writeTeamSecrets(teamId, { dynadotApiKey: String(body.apiKey || '').trim() });
        await audit('registrar.key', `team:${teamId}`, { set: !!String(body.apiKey || '').trim() });
        const test = String(body.apiKey || '').trim() ? await testRegistrar(teamId, c.uid) : null;
        return res.status(200).json({ ok: true, test });
      }
      case 'registrar.test': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden(MUTATION_NEEDS_ADMIN);
        const teamId = String(body.teamId || c.tid || (await teamIdForBusiness(c.bid)) || '');
        if (!teamId) throw bad('Mungon teamId');
        const team = await db.collection('teams').doc(teamId).get();
        if (!team.exists || !sameTenant(c, (team.data() as any).businessId || teamId)) throw forbidden();
        return res.status(200).json(await testRegistrar(teamId, c.uid));
      }

      // ── Domain availability (staff + portal) ──────────────────────────────
      case 'domain.check': {
        await assertRate(c.uid, 'domain.check', isStaff(c) ? 120 : 30, 60 * 60_000);
        const businessId = isStaff(c) ? (String(body.businessId || c.bid || '')) : (c.pbid || '');
        if (!businessId || (!c.superAdmin && !sameTenant(c, businessId) && c.pbid !== businessId)) throw forbidden();
        const raw: string[] = Array.isArray(body.domains) ? body.domains.map(String) : [String(body.domain || '')];
        const tlds = await loadTlds(businessId);
        const sellable = tlds.filter((t: any) => isStaff(c) || t.portalVisible !== false);
        const parsed = raw.map((r) => parseDomain(r)).filter((p): p is NonNullable<typeof p> => !!p);
        if (!parsed.length) throw bad('Emër domain-i i pavlefshëm');
        const names = Array.from(new Set(parsed.map((p) => p.name))).slice(0, 10);
        const teamId = await teamIdForBusiness(businessId, isStaff(c) ? c.tid : null);
        const apiKey = await dynadotKeyFor(teamId);
        let live: Map<string, { status: string; price?: number | null; priceCurrency?: string | null }> = new Map();
        let registrarError: string | null = null;
        if (apiKey) {
          try {
            const results = await dynadotSearch(apiKey, names, { showPrice: isStaff(c), currency: await dynadotCurrencyFor(teamId) });
            live = new Map(results.map((r) => [r.domain, r]));
          } catch (err) { registrarError = redactProviderError(err); }
        } else registrarError = 'Çelësi i Dynadot nuk është konfiguruar';
        const results = names.map((name) => {
          const p = parseDomain(name)!;
          const t = sellable.find((x) => x.tld === p.tld);
          const l = live.get(name);
          return {
            domain: name, tld: p.tld,
            sold: !!t,
            status: l?.status || 'unknown',
            registerPrice: t ? t.registerPrice : null,
            renewPrice: t ? t.renewPrice : null,
            currency: t ? t.currency : null,
            ...(isStaff(c) ? { cost: l?.price ?? null, costCurrency: l?.priceCurrency ?? null } : {}),
          };
        });
        return res.status(200).json({ results, registrarError });
      }

      // ── Orders ────────────────────────────────────────────────────────────
      case 'order.quote': {
        await assertRate(c.uid, 'order.quote', isStaff(c) ? 300 : 60, 60 * 60_000);
        const q = await priceOrderRequest(c, body);
        return res.status(200).json({ ok: true, order: q.priced, couponError: q.couponError });
      }
      case 'order.create': {
        await assertRate(c.uid, 'order.create', isStaff(c) ? 60 : 10, 24 * 60 * 60_000);
        const q = await priceOrderRequest(c, body);
        const { businessId, customerId, source, coupon, couponError } = q;
        const priced = { ok: true as const, order: q.priced };
        if (couponError) throw bad(couponError);
        // A 0-total order provisions without payment. Staff may do that deliberately
        // (an internal/free account); a portal client never — a package saved with a
        // 0 price is a misconfiguration, not an offer. A coupon that zeroes the
        // total is a legitimate promotion and passes.
        if (source === 'portal' && !(priced.order.total > 0) && !priced.order.couponDiscount) throw bad('Kjo porosi nuk ka çmim — kontaktoni stafin.');
        if (source === 'portal') {
          const open = await db.collection('hostingOrders').where('customerId', '==', customerId).where('status', '==', 'Pending').limit(3).get();
          if (open.size >= 3) throw bad('Keni tashmë 3 porosi të papaguara. Paguani ose anuloni një prej tyre para se të porositni sërish.');
        }
        // A domain we are about to register must be available NOW.
        const toRegister = priced.order.lines.filter((l) => l.kind === 'domain-register').map((l) => l.domainName!);
        if (toRegister.length) {
          const teamId = await teamIdForBusiness(businessId, isStaff(c) ? c.tid : null);
          const apiKey = await dynadotKeyFor(teamId);
          if (!apiKey) throw bad('Regjistruesi (Dynadot) nuk është konfiguruar — kontaktoni stafin.');
          const avail = await dynadotSearch(apiKey, toRegister);
          const taken = avail.filter((a) => a.status !== 'available').map((a) => a.domain);
          if (taken.length) throw bad(`Nuk janë të lira: ${taken.join(', ')}`);
        }
        const teamId = await teamIdForBusiness(businessId, isStaff(c) ? c.tid : null);
        const orderNumber = await nextOrderNumber(businessId);
        const ref = db.collection('hostingOrders').doc();
        await ref.set({
          businessId, teamId, orderNumber, customerId, source, status: 'Pending',
          lines: priced.order.lines.map((l) => ({ ...l, provisionStatus: 'pending', provisionError: null })),
          subtotal: priced.order.subtotal, discountTotal: priced.order.discountTotal, total: priced.order.total, currency: priced.order.currency,
          couponCode: priced.order.couponCode || null, couponDiscount: priced.order.couponDiscount || 0,
          invoiceId: null, paidAt: null, provisionedAt: null, lastError: null, retryCount: 0, nextRetryAt: null, retryExhausted: false,
          notes: body.notes ? String(body.notes).slice(0, 500) : null,
          createdAt: Timestamp.now(), updatedAt: Timestamp.now(), createdByUserId: c.uid,
        });
        if (coupon) {
          // Count the use now (the order exists); a cancelled order does not give it back.
          await db.collection('hostingCoupons').doc(coupon.id).update({ uses: admin.firestore.FieldValue.increment(1), lastUsedAt: Timestamp.now() }).catch(() => {});
        }
        await logHostingEvent({ businessId, teamId, customerId, orderId: ref.id, type: 'order.created', ok: true, message: `${orderNumber}: ${priced.order.lines.map((l) => l.description).join('; ')}`.slice(0, 500), actorUserId: c.uid });
        const inv = await invoiceForOrder(ref.id, c.uid);
        let provisioned: any = null;
        if (!inv.invoiceId) {
          // Free order → provision right away.
          try { provisioned = await provisionOrder(ref.id, c.uid); } catch (err) { provisioned = { error: redactProviderError(err) }; }
        }
        await audit('order.create', `order:${ref.id}`, { total: priced.order.total, currency: priced.order.currency, source });
        return res.status(200).json({ ok: true, orderId: ref.id, orderNumber, invoiceId: inv.invoiceId || null, total: priced.order.total, currency: priced.order.currency, provisioned });
      }
      case 'order.provision': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden(MUTATION_NEEDS_ADMIN);
        const o = await loadOwned('hostingOrders', String(body.orderId || ''), c);
        if (o.data.status === 'Pending') {
          // Staff may push a manually-settled order through: verify the invoice really is Paid.
          if (o.data.invoiceId) {
            const inv = await db.collection('invoices').doc(String(o.data.invoiceId)).get();
            if (!inv.exists || (inv.data() as any).status !== 'Paid') throw bad('Fatura e porosisë nuk është paguar. Shënoje si Paguar te Faturat më parë.');
            await onHostingInvoicePaid(String(o.data.invoiceId), c.uid);
            const fresh = (await db.collection('hostingOrders').doc(o.id).get()).data() as any;
            await audit('order.provision', `order:${o.id}`);
            return res.status(200).json({ ok: true, status: fresh?.status, lines: fresh?.lines, errors: fresh?.lastError ? [fresh.lastError] : [] });
          }
        }
        const result = await provisionOrder(o.id, c.uid);
        await audit('order.provision', `order:${o.id}`, { status: result.status });
        return res.status(200).json({ ok: true, ...result });
      }
      case 'order.cancel': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden(MUTATION_NEEDS_ADMIN);
        const o = await loadOwned('hostingOrders', String(body.orderId || ''), c);
        if (!['Pending', 'Failed'].includes(o.data.status)) throw bad('Vetëm një porosi në pritje ose e dështuar mund të anulohet');
        await db.collection('hostingOrders').doc(o.id).update({ status: 'Cancelled', updatedAt: Timestamp.now() });
        if (o.data.invoiceId) {
          const invRef = db.collection('invoices').doc(String(o.data.invoiceId));
          const inv = await invRef.get();
          if (inv.exists && (inv.data() as any).status !== 'Paid') await invRef.update({ status: 'Cancelled', updatedAt: Timestamp.now() });
        }
        await logHostingEvent({ businessId: o.data.businessId, teamId: o.data.teamId, customerId: o.data.customerId, orderId: o.id, type: 'order.cancelled', ok: true, message: `${o.data.orderNumber} u anulua`, actorUserId: c.uid });
        await audit('order.cancel', `order:${o.id}`);
        return res.status(200).json({ ok: true });
      }

      // ── Subscriptions ─────────────────────────────────────────────────────
      case 'sub.suspend': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden(MUTATION_NEEDS_ADMIN);
        const s = await loadOwned('subscriptions', String(body.subscriptionId || ''), c);
        await suspendSubscription(s.id, String(body.reason || 'manual').slice(0, 200), c.uid);
        await audit('sub.suspend', `subscription:${s.id}`);
        return res.status(200).json({ ok: true });
      }
      case 'sub.unsuspend': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden(MUTATION_NEEDS_ADMIN);
        const s = await loadOwned('subscriptions', String(body.subscriptionId || ''), c);
        await unsuspendSubscription(s.id, c.uid);
        await audit('sub.unsuspend', `subscription:${s.id}`);
        return res.status(200).json({ ok: true });
      }
      case 'sub.terminate': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden('Vetëm Admin/Manager mund të terminojë një llogari.');
        const s = await loadOwned('subscriptions', String(body.subscriptionId || ''), c);
        if (body.confirm !== s.data.cpanelUsername && body.confirm !== s.data.domain) throw bad('Konfirmimi nuk përputhet (shkruaj username-in ose domain-in).');
        await terminateSubscription(s.id, String(body.reason || 'manual').slice(0, 200), c.uid, { force: body.force === true });
        await audit('sub.terminate', `subscription:${s.id}`, { force: body.force === true });
        return res.status(200).json({ ok: true });
      }
      case 'sub.changePackage': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden(MUTATION_NEEDS_ADMIN);
        const s = await loadOwned('subscriptions', String(body.subscriptionId || ''), c);
        await changeSubscriptionPackage(s.id, String(body.productId || ''), isBillingCycle(body.cycle) ? body.cycle : null, c.uid);
        await audit('sub.changePackage', `subscription:${s.id}`, { productId: body.productId });
        return res.status(200).json({ ok: true });
      }
      case 'sub.resetPassword': {
        // Entering or re-keying a CUSTOMER's account: Admin/Manager only on the staff
        // side, audited, and the customer is notified (see the executor).
        if (isStaff(c) && !isConfigAdmin(c)) throw forbidden('Vetëm Admin/Manager mund të ndryshojë fjalëkalimin e një klienti.');
        const s = await loadOwned('subscriptions', String(body.subscriptionId || ''), c);
        if (s.data.status !== 'Active') throw bad('Llogaria nuk është aktive');
        const password = await resetSubscriptionPassword(s.id, c.uid, { byStaff: isStaff(c) });
        await audit('sub.resetPassword', `subscription:${s.id}`, { byStaff: isStaff(c), customerId: s.data.customerId });
        return res.status(200).json({ ok: true, password });
      }
      case 'sub.sso': {
        if (isStaff(c) && !isConfigAdmin(c)) throw forbidden('Vetëm Admin/Manager mund të hyjë në cPanel-in e një klienti.');
        const s = await loadOwned('subscriptions', String(body.subscriptionId || ''), c);
        const url = await subscriptionSsoUrl(s.id, c.uid, { byStaff: isStaff(c) });
        await audit('sub.sso', `subscription:${s.id}`, { byStaff: isStaff(c), customerId: s.data.customerId });
        return res.status(200).json({ ok: true, url });
      }
      case 'sub.addExisting': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden(MUTATION_NEEDS_ADMIN);
        const customerId = String(body.customerId || '');
        const cust = await db.collection('customers').doc(customerId).get();
        if (!cust.exists) throw notFound('Klienti nuk u gjet');
        const businessId = String((cust.data() as any).businessId || c.bid || '');
        if (!sameTenant(c, businessId)) throw forbidden();
        if (!isBillingCycle(body.cycle)) throw bad('Cikël i pavlefshëm');
        const due = body.nextDueDate ? new Date(String(body.nextDueDate)) : null;
        if (!due || Number.isNaN(due.getTime())) throw bad('Afati i pagesës së radhës mungon');
        const id = await addExistingSubscription({
          businessId, teamId: await teamIdForBusiness(businessId, c.tid), customerId, productId: body.productId ? String(body.productId) : null,
          serverId: String(body.serverId || ''), cpanelUsername: String(body.cpanelUsername || ''), domain: String(body.domain || ''),
          cycle: body.cycle, amount: Math.max(0, Number(body.amount) || 0), currency: body.currency === 'ALL' ? 'ALL' : 'EUR',
          nextDueDate: due, status: body.status === 'Suspended' ? 'Suspended' : 'Active',
        }, c.uid);
        await audit('sub.addExisting', `subscription:${id}`, { customerId, cpanelUsername: String(body.cpanelUsername || '') });
        return res.status(200).json({ ok: true, subscriptionId: id });
      }
      case 'domain.addExisting': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden(MUTATION_NEEDS_ADMIN);
        const customerId = String(body.customerId || '');
        const cust = await db.collection('customers').doc(customerId).get();
        if (!cust.exists) throw notFound('Klienti nuk u gjet');
        const businessId = String((cust.data() as any).businessId || c.bid || '');
        if (!sameTenant(c, businessId)) throw forbidden();
        const expiry = body.expiryDate ? new Date(String(body.expiryDate)) : null;
        const id = await addExistingDomain({
          businessId, teamId: await teamIdForBusiness(businessId, c.tid), customerId, domainName: String(body.domainName || ''),
          registrar: String(body.registrar || 'manual'), expiryDate: expiry && !Number.isNaN(expiry.getTime()) ? expiry : null,
          years: Number(body.years) || 1, amount: Math.max(0, Number(body.amount) || 0), currency: body.currency === 'ALL' ? 'ALL' : 'EUR',
          autoRenew: body.autoRenew !== false, nameservers: Array.isArray(body.nameservers) ? body.nameservers.map((x: unknown) => String(x).trim().toLowerCase()).filter(Boolean) : [],
        }, c.uid);
        await audit('domain.addExisting', `domain:${id}`, { customerId, domainName: String(body.domainName || '') });
        return res.status(200).json({ ok: true, domainId: id });
      }
      case 'sub.adoptWhmcs': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden(MUTATION_NEEDS_ADMIN);
        const s = await loadOwned('subscriptions', String(body.subscriptionId || ''), c);
        await adoptWhmcsSubscription(s.id, String(body.serverId || ''), String(body.cpanelUsername || ''), c.uid);
        await audit('sub.adoptWhmcs', `subscription:${s.id}`, { serverId: body.serverId, cpanelUsername: body.cpanelUsername });
        return res.status(200).json({ ok: true });
      }
      case 'sub.usage': {
        const s = await loadOwned('subscriptions', String(body.subscriptionId || ''), c);
        return res.status(200).json({ ok: true, usage: await subscriptionUsage(s.id) });
      }
      case 'sub.setHold': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden(MUTATION_NEEDS_ADMIN);
        const s = await loadOwned('subscriptions', String(body.subscriptionId || ''), c);
        await db.collection('subscriptions').doc(s.id).update({ lifecycleHold: body.hold === true, updatedAt: Timestamp.now() });
        await audit('sub.hold', `subscription:${s.id}`, { hold: body.hold === true });
        return res.status(200).json({ ok: true });
      }
      case 'sub.cancelAtPeriodEnd': {
        const s = await loadOwned('subscriptions', String(body.subscriptionId || ''), c);
        const value = body.value === true;
        await db.collection('subscriptions').doc(s.id).update({ cancelAtPeriodEnd: value, updatedAt: Timestamp.now() });
        await logHostingEvent({ businessId: s.data.businessId, teamId: s.data.teamId, customerId: s.data.customerId, subscriptionId: s.id, type: 'sub.cancelRequest', ok: true, message: value ? 'Kërkesë anulimi në fund të periudhës' : 'Kërkesa e anulimit u tërhoq', actorUserId: c.uid });
        return res.status(200).json({ ok: true });
      }

      // ── Domains ───────────────────────────────────────────────────────────
      case 'domain.setNameservers': {
        const d = await loadOwned('domains', String(body.domainId || ''), c);
        if (d.data.source !== 'fivocrm' || d.data.registrar !== 'dynadot') throw bad('Ky domain nuk menaxhohet nga FivoCRM');
        const ns: string[] = Array.isArray(body.nameservers) ? body.nameservers.map((x: unknown) => String(x).trim().toLowerCase()).filter(Boolean) : [];
        if (ns.length < 2 || ns.some((n) => !parseDomain(n) && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(n))) throw bad('Duhen të paktën dy nameserver-a të vlefshëm');
        const teamId = await teamIdForBusiness(d.data.businessId, d.data.teamId);
        const apiKey = await dynadotKeyFor(teamId);
        if (!apiKey) throw bad('Çelësi i Dynadot mungon');
        try {
          await dynadotSetNameservers(apiKey, String(d.data.domainName), ns);
        } catch (err) {
          await logHostingEvent({ businessId: d.data.businessId, teamId, customerId: d.data.customerId, domainId: d.id, type: 'dynadot.set_ns', ok: false, message: redactProviderError(err), actorUserId: c.uid });
          throw new HttpError(502, redactProviderError(err));
        }
        await db.collection('domains').doc(d.id).update({ nameservers: ns, updatedAt: Timestamp.now() });
        await logHostingEvent({ businessId: d.data.businessId, teamId, customerId: d.data.customerId, domainId: d.id, type: 'dynadot.set_ns', ok: true, message: `NS: ${ns.join(', ')}`, actorUserId: c.uid });
        return res.status(200).json({ ok: true });
      }
      case 'domain.setAutoRenew': {
        const d = await loadOwned('domains', String(body.domainId || ''), c);
        const value = body.value !== false;
        await db.collection('domains').doc(d.id).update({ autoRenew: value, updatedAt: Timestamp.now() });
        // Registrar-side auto-renew stays OFF: we renew only after OUR invoice is paid.
        await logHostingEvent({ businessId: d.data.businessId, teamId: d.data.teamId, customerId: d.data.customerId, domainId: d.id, type: 'domain.autoRenew', ok: true, message: value ? 'Rinovimi automatik u ndez' : 'Rinovimi automatik u fik', actorUserId: c.uid });
        return res.status(200).json({ ok: true });
      }
      case 'domain.setPrivacy': {
        const d = await loadOwned('domains', String(body.domainId || ''), c);
        if (d.data.registrar !== 'dynadot') throw bad('Ky domain nuk menaxhohet nga FivoCRM');
        const option = body.option === 'off' ? 'off' : body.option === 'partial' ? 'partial' : 'full';
        const teamId = await teamIdForBusiness(d.data.businessId, d.data.teamId);
        const apiKey = await dynadotKeyFor(teamId);
        if (!apiKey) throw bad('Çelësi i Dynadot mungon');
        try { await dynadotSetPrivacy(apiKey, String(d.data.domainName), option); }
        catch (err) { throw new HttpError(502, redactProviderError(err)); }
        await db.collection('domains').doc(d.id).update({ privacy: option !== 'off', updatedAt: Timestamp.now() });
        return res.status(200).json({ ok: true });
      }
      case 'domain.authCode': {
        const d = await loadOwned('domains', String(body.domainId || ''), c);
        if (d.data.registrar !== 'dynadot') throw bad('Ky domain nuk menaxhohet nga FivoCRM');
        const teamId = await teamIdForBusiness(d.data.businessId, d.data.teamId);
        const apiKey = await dynadotKeyFor(teamId);
        if (!apiKey) throw bad('Çelësi i Dynadot mungon');
        let code: string;
        try { code = await dynadotGetAuthCode(apiKey, String(d.data.domainName)); }
        catch (err) { throw new HttpError(502, redactProviderError(err)); }
        await logHostingEvent({ businessId: d.data.businessId, teamId, customerId: d.data.customerId, domainId: d.id, type: 'dynadot.authcode', ok: true, message: 'Kodi EPP u kërkua', actorUserId: c.uid });
        return res.status(200).json({ ok: true, authCode: code });
      }
      case 'domain.setHold': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden(MUTATION_NEEDS_ADMIN);
        const d = await loadOwned('domains', String(body.domainId || ''), c);
        await db.collection('domains').doc(d.id).update({ lifecycleHold: body.hold === true, updatedAt: Timestamp.now() });
        return res.status(200).json({ ok: true });
      }
      case 'domain.registrarAutoRenew': {
        // Explicit staff choice to let Dynadot renew by itself (bypasses our invoice).
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden();
        const d = await loadOwned('domains', String(body.domainId || ''), c);
        const teamId = await teamIdForBusiness(d.data.businessId, d.data.teamId);
        const apiKey = await dynadotKeyFor(teamId);
        if (!apiKey) throw bad('Çelësi i Dynadot mungon');
        try { await dynadotSetRenewOption(apiKey, String(d.data.domainName), body.value === true ? 'auto' : 'donot'); }
        catch (err) { throw new HttpError(502, redactProviderError(err)); }
        return res.status(200).json({ ok: true });
      }

      // ── Jobs (staff, scoped to the caller's tenant) ───────────────────────
      case 'lifecycle.run': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden();
        const scope = c.superAdmin && body.businessId ? String(body.businessId) : c.bid;
        if (!scope) throw bad('Nuk u përcaktua biznesi');
        const result = await runHostingLifecycle({ businessId: scope });
        await audit('lifecycle.run', `business:${scope}`, { invoiced: result.invoiced, suspended: result.suspended, terminated: result.terminated });
        return res.status(200).json({ ok: true, result });
      }
      case 'sync.run': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden(MUTATION_NEEDS_ADMIN);
        const scope = c.superAdmin && body.businessId ? String(body.businessId) : c.bid;
        if (!scope) throw bad('Nuk u përcaktua biznesi');
        return res.status(200).json({ ok: true, result: await runHostingSync({ businessId: scope }) });
      }
      case 'tld.syncCosts': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden();
        const businessId = c.superAdmin && body.businessId ? String(body.businessId) : c.bid;
        if (!businessId) throw bad('Nuk u përcaktua biznesi');
        const teamId = String(body.teamId || c.tid || (await teamIdForBusiness(businessId)) || '');
        if (!teamId) throw bad('Mungon teamId');
        const r = await syncTldCosts(businessId, teamId, c.uid);
        await audit('tld.syncCosts', `business:${businessId}`, { updated: r.updated, belowCost: r.belowCost });
        return res.status(200).json({ ok: true, ...r });
      }
      case 'sub.quoteUpgrade': {
        const s = await loadOwned('subscriptions', String(body.subscriptionId || ''), c);
        const productId = String(body.productId || '');
        if (!isStaff(c)) {
          const p = (await db.collection('hostingProducts').doc(productId).get()).data() as any;
          if (!p || !p.portalVisible) throw bad('Paketa nuk është e disponueshme');
        }
        return res.status(200).json({ ok: true, quote: await quoteUpgrade(s.id, productId, isBillingCycle(body.cycle) ? body.cycle : null) });
      }
      case 'sub.requestUpgrade': {
        const s = await loadOwned('subscriptions', String(body.subscriptionId || ''), c);
        if (s.data.status !== 'Active') throw bad('Vetëm një llogari aktive mund të ndryshojë paketë');
        const productId = String(body.productId || '');
        if (!isStaff(c)) {
          await assertRate(c.uid, 'sub.requestUpgrade', 5, 24 * 60 * 60_000);
          const p = (await db.collection('hostingProducts').doc(productId).get()).data() as any;
          if (!p || !p.portalVisible) throw bad('Paketa nuk është e disponueshme');
        }
        const r = await requestUpgrade(s.id, productId, isBillingCycle(body.cycle) ? body.cycle : null, c.uid, { portal: !isStaff(c) });
        await audit('sub.requestUpgrade', `subscription:${s.id}`, { productId, applied: r.applied, amount: r.amount });
        return res.status(200).json({ ok: true, ...r });
      }
      case 'backup.run': {
        if (!isStaff(c) || !isConfigAdmin(c)) throw forbidden(MUTATION_NEEDS_ADMIN);
        const s = await loadOwned('subscriptions', String(body.subscriptionId || ''), c);
        await assertRate(c.uid, 'backup.run', 20, 60 * 60_000);
        const r = await backupSubscription(s.id, 'manual', c.uid);
        await audit('backup.run', `subscription:${s.id}`, { ok: r.ok });
        return res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true, path: r.path } : { error: r.error });
      }
      case 'domain.pointToHosting': {
        const d = await loadOwned('domains', String(body.domainId || ''), c);
        if (body.subscriptionId) await loadOwned('subscriptions', String(body.subscriptionId), c); // same caller must own both
        if (isStaff(c) && !isConfigAdmin(c)) throw forbidden(MUTATION_NEEDS_ADMIN);
        if (!isStaff(c)) await assertRate(c.uid, 'domain.pointToHosting', 20, 60 * 60_000);
        let r: { ip: string };
        try { r = await pointDomainToHosting(d.id, { subscriptionId: body.subscriptionId ? String(body.subscriptionId) : null, ip: body.ip ? String(body.ip) : null }, c.uid); }
        catch (err) { throw new HttpError(502, redactProviderError(err)); }
        return res.status(200).json({ ok: true, ip: r.ip });
      }
      default:
        throw bad(`Veprim i panjohur: "${action}"`);
    }
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    const msg = redactProviderError(err);
    console.error('[hosting]', action, msg);
    return res.status(500).json({ error: msg || 'Gabim i brendshëm' });
  }
}
