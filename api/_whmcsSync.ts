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
  mapWhmcsClientFull,
  type MappedInvoice,
  type MappedSubscription,
  type MappedClient,
  type MappedClientFull,
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

// ── Full customer upsert (dedicated client sync) ──────────────────────────────
// Match by whmcsClientId first, then fall back to email so minimal customers
// created earlier by resolveCustomer() get enriched instead of duplicated.
async function upsertCustomer(c: MappedClientFull, teamId: string | null): Promise<'created' | 'updated'> {
  const now = Timestamp.now();
  let ref: FirebaseFirestore.DocumentReference | null = null;

  if (c.whmcsClientId) {
    const s = await db.collection('customers').where('whmcsClientId', '==', c.whmcsClientId).limit(1).get();
    if (!s.empty) ref = s.docs[0].ref;
  }
  if (!ref && c.email) {
    const s = await db.collection('customers').where('email', '==', c.email).limit(1).get();
    if (!s.empty) ref = s.docs[0].ref;
  }
  // Third fallback: exact phone match (only if it's a real number, never empty)
  // so a customer entered manually by phone isn't duplicated.
  if (!ref && c.phone && c.phone.replace(/\D/g, '').length >= 7) {
    const s = await db.collection('customers').where('phone', '==', c.phone).limit(1).get();
    if (!s.empty) ref = s.docs[0].ref;
  }

  const payload: Record<string, any> = {
    whmcsClientId: c.whmcsClientId,
    source: 'whmcs',
    name: c.name,
    email: c.email,
    phone: c.phone,
    company: c.company,
    address: c.address,
    ...(teamId ? { teamId } : {}),
    updatedAt: now,
  };

  if (!ref) {
    await db.collection('customers').add({ ...payload, createdAt: now, createdByUserId: null });
    return 'created';
  }
  await ref.update(payload);
  return 'updated';
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

// Status doc helper — lets the sync report progress incrementally so a later
// phase timing out doesn't leave the UI frozen on a stale run.
async function writeWhmcsStatus(patch: Record<string, any>, teamId: string | null): Promise<void> {
  await db.collection('integrations').doc('whmcs').set(
    { ...patch, ...(teamId ? { teamId } : {}) },
    { merge: true },
  ).catch(() => { /* status write is best-effort */ });
}

// Shared client loop (used by both the full sync and the client-only sync).
// Maps straight from the GetClients list row — NO per-client GetClientsDetails
// call. That extra round-trip (one per client, each through the proxy → VPS →
// WHMCS) was the main cause of the 60s function timeout on larger accounts.
// Phone/address get enriched later by the real-time webhook (syncInvoiceById →
// fetchClient). Optionally seeds `clientCache` so the invoice/subscription
// phases reuse the data instead of re-fetching each client from WHMCS.
async function syncAllClients(
  teamId: string | null,
  errors: string[],
  clientCache?: Map<string, MappedClient | null>,
): Promise<{ clientsCreated: number; clientsUpdated: number }> {
  let clientsCreated = 0, clientsUpdated = 0;
  for (let start = 0; ; start += PAGE) {
    let data: any;
    try {
      data = await whmcsCall('GetClients', { limitstart: start, limitnum: PAGE });
    } catch (e: any) {
      errors.push(`GetClients: ${e?.message || e}`);
      break;
    }
    const list: any[] = data?.clients?.client || [];
    for (const raw of list) {
      try {
        const full: MappedClientFull = mapWhmcsClientFull(raw);
        const r = await upsertCustomer(full, teamId);
        r === 'created' ? clientsCreated++ : clientsUpdated++;
        if (clientCache && raw?.id != null) clientCache.set(String(raw.id), mapWhmcsClient(raw));
      } catch (e: any) {
        errors.push(`client ${raw?.id}: ${e?.message || e}`);
      }
    }
    if (list.length < PAGE) break;
  }
  return { clientsCreated, clientsUpdated };
}

// Stay safely under the 60s function cap: stop starting new pages after this,
// leaving headroom for the in-flight WHMCS call + status write to finish.
const SYNC_BUDGET_MS = 30_000;

// Run one paginated WHMCS phase with a time budget. Returns where it stopped so
// the caller can persist a resume cursor when the budget runs out.
async function runPhase(
  action: string,
  pick: (data: any) => any[],
  handle: (raw: any) => Promise<'created' | 'updated'>,
  startAt: number,
  overBudget: () => boolean,
  errors: string[],
  counters: { created: number; updated: number },
): Promise<{ done: boolean; nextStart: number }> {
  for (let start = startAt; ; start += PAGE) {
    if (overBudget()) return { done: false, nextStart: start };
    let data: any;
    try {
      data = await whmcsCall(action, { limitstart: start, limitnum: PAGE });
    } catch (e: any) {
      errors.push(`${action}: ${e?.message || e}`);
      return { done: true, nextStart: 0 }; // hard error → stop this phase, move on
    }
    const list: any[] = pick(data) || [];
    for (const raw of list) {
      try {
        (await handle(raw)) === 'created' ? counters.created++ : counters.updated++;
      } catch (e: any) {
        errors.push(`${action} ${raw?.id}: ${e?.message || e}`);
      }
    }
    if (list.length < PAGE) return { done: true, nextStart: 0 };
  }
}

export async function runWhmcsSync(): Promise<Record<string, unknown>> {
  if (!whmcsConfigured()) {
    return { skipped: 'WHMCS API nuk është konfiguruar' };
  }
  const startedAt = Date.now();
  const overBudget = () => Date.now() - startedAt > SYNC_BUDGET_MS;

  const teamId = await resolveTeamId();
  const clientCache = new Map<string, MappedClient | null>();
  // whmcsClientId → FivoCRM customerId, resolved from Firestore (no WHMCS call)
  // since clients are synced to customers in the first phase. Falls back to a
  // WHMCS lookup only if the customer isn't found yet (keeps resume runs fast).
  const customerByWhmcsId = new Map<string, string | null>();
  const resolveCustomerId = async (whmcsClientId: string): Promise<string | null> => {
    if (!whmcsClientId) return null;
    if (customerByWhmcsId.has(whmcsClientId)) return customerByWhmcsId.get(whmcsClientId)!;
    let id: string | null = null;
    const snap = await db.collection('customers').where('whmcsClientId', '==', whmcsClientId).limit(1).get();
    if (!snap.empty) id = snap.docs[0].id;
    if (!id) {
      const client = await clientForId(whmcsClientId, clientCache);
      id = await resolveCustomer(client, teamId);
    }
    customerByWhmcsId.set(whmcsClientId, id);
    return id;
  };

  const errors: string[] = [];
  const counters = {
    clients: { created: 0, updated: 0 },
    invoices: { created: 0, updated: 0 },
    subs: { created: 0, updated: 0 },
  };

  // Resume from where the last invocation stopped (if it ran out of budget).
  const statusSnap = await db.collection('integrations').doc('whmcs').get();
  const cursor = (statusSnap.exists ? statusSnap.data()?.syncCursor : null) as { phase?: string; start?: number } | null;
  let phase: string = cursor?.phase || 'clients';
  let start: number = cursor?.start || 0;

  // Mark the run as started immediately (moves "Fundit" the moment it begins)
  // and clear any stale errors from previous runs so the UI doesn't show old
  // failures next to a clean run.
  await writeWhmcsStatus({
    syncStatus: 'running',
    syncStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
    errorCount: 0,
    lastErrors: [],
  }, teamId);

  const pause = async (p: string, nextStart: number): Promise<Record<string, unknown>> => {
    await writeWhmcsStatus({
      syncStatus: 'partial',
      syncCursor: { phase: p, start: nextStart },
      clientsCreated: counters.clients.created, clientsUpdated: counters.clients.updated,
      invoicesCreated: counters.invoices.created, invoicesUpdated: counters.invoices.updated,
      subsCreated: counters.subs.created, subsUpdated: counters.subs.updated,
      errorCount: errors.length, lastErrors: errors.slice(0, 10),
    }, teamId);
    return {
      partial: true, resumePhase: p, resumeStart: nextStart,
      clientsCreated: counters.clients.created, clientsUpdated: counters.clients.updated,
      invoicesCreated: counters.invoices.created, invoicesUpdated: counters.invoices.updated,
      subsCreated: counters.subs.created, subsUpdated: counters.subs.updated,
      errors: errors.length,
      ...(errors.length ? { errorDetail: errors.slice(0, 2).join(' | ').slice(0, 400) } : {}),
    };
  };

  // ── Phase: clients → customers ───────────────────────────────────────────
  if (phase === 'clients') {
    const res = await runPhase('GetClients', d => d?.clients?.client, async (raw) => {
      const r = await upsertCustomer(mapWhmcsClientFull(raw), teamId);
      if (raw?.id != null) clientCache.set(String(raw.id), mapWhmcsClient(raw));
      return r;
    }, start, overBudget, errors, counters.clients);
    await writeWhmcsStatus({ clientsCreated: counters.clients.created, clientsUpdated: counters.clients.updated, errorCount: errors.length, lastErrors: errors.slice(0, 10) }, teamId);
    if (!res.done) return pause('clients', res.nextStart);
    phase = 'invoices'; start = 0;
  }

  // ── Phase: invoices ────────────────────────────────────────────────────────
  if (phase === 'invoices') {
    const res = await runPhase('GetInvoices', d => d?.invoices?.invoice, async (raw) => {
      const inv = mapWhmcsInvoice(raw);
      const customerId = await resolveCustomerId(inv.whmcsClientId);
      return upsertInvoice(inv, customerId, teamId);
    }, start, overBudget, errors, counters.invoices);
    await writeWhmcsStatus({ invoicesCreated: counters.invoices.created, invoicesUpdated: counters.invoices.updated, errorCount: errors.length, lastErrors: errors.slice(0, 10) }, teamId);
    if (!res.done) return pause('invoices', res.nextStart);
    phase = 'subscriptions'; start = 0;
  }

  // ── Phase: client products / subscriptions ──────────────────────────────────
  if (phase === 'subscriptions') {
    const res = await runPhase('GetClientsProducts', d => d?.products?.product, async (raw) => {
      const sub = mapWhmcsProduct(raw);
      const customerId = await resolveCustomerId(sub.whmcsClientId);
      return upsertSubscription(sub, customerId, teamId);
    }, start, overBudget, errors, counters.subs);
    if (!res.done) return pause('subscriptions', res.nextStart);
  }

  // ── Done: clear the cursor and persist the final status ─────────────────────
  await writeWhmcsStatus({
    lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
    syncStatus: 'done',
    syncCursor: admin.firestore.FieldValue.delete(),
    clientsCreated: counters.clients.created, clientsUpdated: counters.clients.updated,
    invoicesCreated: counters.invoices.created, invoicesUpdated: counters.invoices.updated,
    subsCreated: counters.subs.created, subsUpdated: counters.subs.updated,
    errorCount: errors.length,
    lastErrors: errors.slice(0, 10),
  }, teamId);

  return {
    clientsCreated: counters.clients.created, clientsUpdated: counters.clients.updated,
    invoicesCreated: counters.invoices.created, invoicesUpdated: counters.invoices.updated,
    subsCreated: counters.subs.created, subsUpdated: counters.subs.updated,
    errors: errors.length,
    ...(errors.length ? { errorDetail: errors.slice(0, 2).join(' | ').slice(0, 400) } : {}),
  };
}

// ── Client-only sync (WHMCS clients → FivoCRM customers) ──────────────────────
export async function runWhmcsClientSync(): Promise<Record<string, unknown>> {
  if (!whmcsConfigured()) {
    return { skipped: 'WHMCS API nuk është konfiguruar' };
  }
  const teamId = await resolveTeamId();
  const errors: string[] = [];

  const { clientsCreated, clientsUpdated } = await syncAllClients(teamId, errors);

  await db.collection('integrations').doc('whmcs').set({
    clientsLastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
    clientsCreated, clientsUpdated,
    clientErrorCount: errors.length,
    clientLastErrors: errors.slice(0, 10),
    ...(teamId ? { teamId } : {}),
  }, { merge: true });

  return {
    clientsCreated, clientsUpdated,
    errors: errors.length,
    ...(errors.length ? { errorDetail: errors.slice(0, 2).join(' | ').slice(0, 400) } : {}),
  };
}
