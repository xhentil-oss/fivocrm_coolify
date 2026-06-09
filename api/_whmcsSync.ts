import admin, { adminDb as db, Timestamp } from './_firebaseAdmin.js';
import {
  whmcsCall,
  whmcsConfigured,
  fetchInvoice,
  fetchClient,
  fetchClientProduct,
  mapWhmcsInvoice,
  mapWhmcsProduct,
  mapWhmcsClient,
  type MappedInvoice,
  type MappedSubscription,
  type MappedClient,
} from './_whmcs.js';

/**
 * WHMCS → FivoCRM sync layer.
 *
 * Shared by both the real-time webhook (api/whmcs-webhook.ts) and the periodic
 * reconciliation job (api/cron/run.ts). Every write is idempotent, keyed on the
 * WHMCS id, so webhook + cron can run the same upsert without creating dupes.
 */

function toTs(d: Date | null) {
  return d ? Timestamp.fromDate(d) : null;
}

// ── Team resolution (which team the mirrored data attaches to) ────────────────
let cachedTeamId: string | null | undefined;
async function resolveTeamId(): Promise<string | null> {
  if (cachedTeamId !== undefined) return cachedTeamId;
  const envTeam = process.env.WHMCS_TEAM_ID;
  if (envTeam) {
    cachedTeamId = envTeam;
    return cachedTeamId;
  }
  const teamsSnap = await db.collection('teams').limit(1).get();
  cachedTeamId = teamsSnap.empty ? null : teamsSnap.docs[0].id;
  return cachedTeamId;
}

// ── Customer resolution (auto-match by email, create minimal if missing) ──────
const customerCache = new Map<string, string>(); // email → customerId

async function resolveCustomer(client: MappedClient | null, teamId: string | null): Promise<string | null> {
  if (!client?.email) return null;
  const email = client.email;
  if (customerCache.has(email)) return customerCache.get(email)!;

  const existing = await db.collection('customers').where('email', '==', email).limit(1).get();
  if (!existing.empty) {
    const id = existing.docs[0].id;
    customerCache.set(email, id);
    return id;
  }

  // Create a minimal customer purely so invoices/subscriptions can link to it.
  const now = Timestamp.now();
  const ref = await db.collection('customers').add({
    name: client.name || email,
    email,
    phone: client.phone || '',
    company: client.company || '',
    source: 'whmcs',
    ...(teamId ? { teamId } : {}),
    createdAt: now,
    updatedAt: now,
    createdByUserId: null,
  });
  customerCache.set(email, ref.id);
  return ref.id;
}

// ── Invoice upsert ────────────────────────────────────────────────────────────
async function upsertInvoice(inv: MappedInvoice, customerId: string | null, teamId: string | null): Promise<'created' | 'updated'> {
  const now = Timestamp.now();
  const snap = await db.collection('invoices').where('whmcsInvoiceId', '==', inv.whmcsInvoiceId).limit(1).get();

  // Fields WHMCS owns; we never touch FivoCRM-side reminder flags on update.
  const payload: Record<string, any> = {
    whmcsInvoiceId: inv.whmcsInvoiceId,
    source: 'whmcs',
    invoiceNumber: inv.invoiceNumber,
    status: inv.status,
    amount: inv.amount,
    total: inv.total,
    subtotal: inv.subtotal,
    tax: inv.tax,
    currency: inv.currency,
    notes: inv.notes,
    invoiceDate: toTs(inv.invoiceDate),
    dueDate: toTs(inv.dueDate),
    paidAt: toTs(inv.paidAt),
    ...(customerId ? { customerId } : {}),
    ...(teamId ? { teamId } : {}),
    updatedAt: now,
  };

  if (snap.empty) {
    await db.collection('invoices').add({
      ...payload,
      paymentMethod: 'WHMCS',
      emailSent: true,        // WHMCS already emails the client — suppress FivoCRM reminders
      reminderSent: true,
      reminder25Sent: true,
      reminderLastDaySent: true,
      createdByUserId: null,
      createdAt: now,
    });
    return 'created';
  }
  await snap.docs[0].ref.update(payload);
  return 'updated';
}

// ── Subscription upsert ─────────────────────────────────────────────────────
async function upsertSubscription(sub: MappedSubscription, customerId: string | null, teamId: string | null): Promise<'created' | 'updated'> {
  const now = Timestamp.now();
  const snap = await db.collection('subscriptions').where('whmcsServiceId', '==', sub.whmcsServiceId).limit(1).get();

  const payload: Record<string, any> = {
    whmcsServiceId: sub.whmcsServiceId,
    whmcsClientId: sub.whmcsClientId,
    source: 'whmcs',
    productName: sub.productName,
    domain: sub.domain,
    status: sub.status,
    recurringAmount: sub.recurringAmount,
    currency: sub.currency,
    billingCycle: sub.billingCycle,
    nextDueDate: toTs(sub.nextDueDate),
    ...(customerId ? { customerId } : {}),
    ...(teamId ? { teamId } : {}),
    updatedAt: now,
  };

  if (snap.empty) {
    await db.collection('subscriptions').add({ ...payload, createdAt: now });
    return 'created';
  }
  await snap.docs[0].ref.update(payload);
  return 'updated';
}

// ── By-id entrypoints (used by the real-time webhook) ─────────────────────────
export async function syncInvoiceById(invoiceId: string | number): Promise<void> {
  const teamId = await resolveTeamId();
  const inv = await fetchInvoice(invoiceId);
  let client: MappedClient | null = null;
  if (inv.whmcsClientId) {
    try { client = await fetchClient(inv.whmcsClientId); } catch { /* non-blocking */ }
  }
  const customerId = await resolveCustomer(client, teamId);
  await upsertInvoice(inv, customerId, teamId);
}

export async function syncSubscriptionById(serviceId: string | number): Promise<void> {
  const teamId = await resolveTeamId();
  const sub = await fetchClientProduct(serviceId);
  if (!sub) return;
  let client: MappedClient | null = null;
  if (sub.whmcsClientId) {
    try { client = await fetchClient(sub.whmcsClientId); } catch { /* non-blocking */ }
  }
  const customerId = await resolveCustomer(client, teamId);
  await upsertSubscription(sub, customerId, teamId);
}

// ── Full reconciliation (cron + manual backfill) ──────────────────────────────
const PAGE = 100;

async function clientForId(clientId: string, cache: Map<string, MappedClient | null>): Promise<MappedClient | null> {
  if (!clientId) return null;
  if (cache.has(clientId)) return cache.get(clientId)!;
  let client: MappedClient | null = null;
  try { client = await fetchClient(clientId); } catch { /* skip */ }
  cache.set(clientId, client);
  return client;
}

export async function runWhmcsSync(): Promise<Record<string, unknown>> {
  if (!whmcsConfigured()) {
    return { skipped: 'WHMCS API nuk është konfiguruar' };
  }
  const teamId = await resolveTeamId();
  const clientCache = new Map<string, MappedClient | null>();
  let invoicesCreated = 0, invoicesUpdated = 0, subsCreated = 0, subsUpdated = 0;
  const errors: string[] = [];

  // ── Invoices (paginated) ────────────────────────────────────────────────
  for (let start = 0; ; start += PAGE) {
    let data: any;
    try {
      data = await whmcsCall('GetInvoices', { limitstart: start, limitnum: PAGE });
    } catch (e: any) {
      errors.push(`GetInvoices: ${e?.message || e}`);
      break;
    }
    const list: any[] = data?.invoices?.invoice || [];
    for (const raw of list) {
      try {
        const inv = mapWhmcsInvoice(raw);
        const client = await clientForId(inv.whmcsClientId, clientCache);
        const customerId = await resolveCustomer(client, teamId);
        const r = await upsertInvoice(inv, customerId, teamId);
        r === 'created' ? invoicesCreated++ : invoicesUpdated++;
      } catch (e: any) {
        errors.push(`invoice ${raw?.id}: ${e?.message || e}`);
      }
    }
    if (list.length < PAGE) break;
  }

  // ── Client products / subscriptions (paginated) ──────────────────────────
  for (let start = 0; ; start += PAGE) {
    let data: any;
    try {
      data = await whmcsCall('GetClientsProducts', { limitstart: start, limitnum: PAGE });
    } catch (e: any) {
      errors.push(`GetClientsProducts: ${e?.message || e}`);
      break;
    }
    const list: any[] = data?.products?.product || [];
    for (const raw of list) {
      try {
        const sub = mapWhmcsProduct(raw);
        const client = await clientForId(sub.whmcsClientId, clientCache);
        const customerId = await resolveCustomer(client, teamId);
        const r = await upsertSubscription(sub, customerId, teamId);
        r === 'created' ? subsCreated++ : subsUpdated++;
      } catch (e: any) {
        errors.push(`product ${raw?.id}: ${e?.message || e}`);
      }
    }
    if (list.length < PAGE) break;
  }

  // ── Persist last-sync status (for the Settings UI) ────────────────────────
  await db.collection('integrations').doc('whmcs').set({
    lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
    invoicesCreated, invoicesUpdated, subsCreated, subsUpdated,
    errorCount: errors.length,
    lastErrors: errors.slice(0, 10),
    ...(teamId ? { teamId } : {}),
  }, { merge: true });

  return { invoicesCreated, invoicesUpdated, subsCreated, subsUpdated, errors: errors.length };
}
