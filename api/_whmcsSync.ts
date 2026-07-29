import admin, { adminDb as db, Timestamp } from './_firebaseAdmin.js';
import {
  whmcsCall,
  whmcsConfigured,
  fetchInvoice,
  fetchClient,
  fetchClientFull,
  fetchClientProduct,
  mapWhmcsInvoice,
  mapWhmcsProduct,
  mapWhmcsDomain,
  mapWhmcsClient,
  mapWhmcsClientFull,
  type MappedInvoice,
  type MappedSubscription,
  type MappedDomain,
  type MappedClient,
  type MappedClientFull,
} from './_whmcs.js';
import { findLeadForContact, crossLinkLeadCustomer } from './_contactIdentity.js';

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
  // 1) Explicit env wins — the deterministic, recommended control.
  const envTeam = process.env.WHMCS_TEAM_ID;
  if (envTeam) { cachedTeamId = envTeam; return cachedTeamId; }

  // 2) Derive a team that BELONGS to the WHMCS business, so mirrored data can
  //    never land on ANOTHER tenant's team. The old code used the first team in
  //    the whole collection (`teams limit 1`), which was a different tenant's
  //    team → 398 Agjencia records ended up on KB Group's team. Never again:
  //    every candidate team is verified to share the resolved businessId.
  const businessId = await resolveBusinessId(null);
  if (businessId) {
    // Prefer the dominant team already used by this business's WHMCS customers…
    const existing = await db.collection('customers')
      .where('source', '==', 'whmcs').where('businessId', '==', businessId).limit(80).get();
    const counts = new Map<string, number>();
    existing.docs.forEach((d) => { const t = (d.data() as any)?.teamId; if (t) counts.set(t, (counts.get(t) || 0) + 1); });
    for (const [t] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      const td = await db.collection('teams').doc(t).get();
      if (td.exists && (td.data() as any)?.businessId === businessId) { cachedTeamId = t; return cachedTeamId; }
    }
    // …else any team owned by this business.
    const owned = await db.collection('teams').where('businessId', '==', businessId).limit(1).get();
    if (!owned.empty) { cachedTeamId = owned.docs[0].id; return cachedTeamId; }
  }

  // 3) Fresh install (no WHMCS customers, no business): first team as last resort.
  const teamsSnap = await db.collection('teams').limit(1).get();
  cachedTeamId = teamsSnap.empty ? null : teamsSnap.docs[0].id;
  return cachedTeamId;
}

// ── Business resolution (the tenant isolation key) ────────────────────────────
// `customers`/`invoices`/`subscriptions` are business-isolated in the client
// (businessIsolatedAlways): a doc WITHOUT a businessId is filtered out by the
// active-tenant query — it flashes in the list then vanishes. So every mirrored
// doc must carry the same businessId the staff user's active team resolves to.
let cachedBusinessId: string | null | undefined;
async function resolveBusinessId(teamId: string | null): Promise<string | null> {
  if (cachedBusinessId !== undefined) return cachedBusinessId;
  // 1) Explicit env wins (set WHMCS_BUSINESS_ID for a deterministic target).
  const envBiz = process.env.WHMCS_BUSINESS_ID;
  if (envBiz) { cachedBusinessId = envBiz; return cachedBusinessId; }

  let bid: string | null = null;

  // 2) Prefer the business where existing WHMCS customers ALREADY live. This is
  //    critical: the sync's teamId may map to a different tenant than the one the
  //    staff user actually works in, and deriving from the team would relocate all
  //    mirrored customers into an empty business — hiding them. Reuse the dominant
  //    businessId already present on synced customers so we never move them.
  const existing = await db.collection('customers').where('source', '==', 'whmcs').limit(80).get();
  const counts = new Map<string, number>();
  existing.docs.forEach((d) => {
    const b = (d.data() as any)?.businessId;
    if (b) counts.set(b, (counts.get(b) || 0) + 1);
  });
  if (counts.size) {
    bid = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  // 3) Fresh install (no WHMCS customers yet): fall back to the sync team's
  //    businessId (team doc, then a team member — mirrors the recurring self-heal).
  if (!bid && teamId) {
    const teamDoc = await db.collection('teams').doc(teamId).get();
    bid = teamDoc.exists ? ((teamDoc.data() as any)?.businessId ?? null) : null;
    if (!bid) {
      const tm = await db.collection('teamMembers').where('teamId', '==', teamId).limit(1).get();
      if (!tm.empty) bid = (tm.docs[0].data() as any)?.businessId ?? null;
    }
  }

  cachedBusinessId = bid;
  return cachedBusinessId;
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
  const businessId = await resolveBusinessId(teamId);
  const ref = await db.collection('customers').add({
    name: client.name || email,
    email,
    phone: client.phone || '',
    company: client.company || '',
    source: 'whmcs',
    ...(teamId ? { teamId } : {}),
    ...(businessId ? { businessId } : {}),
    createdAt: now,
    updatedAt: now,
    createdByUserId: null,
  });
  customerCache.set(email, ref.id);
  // A prospect we were already working in the CRM just became a paying client
  // in WHMCS — pair the two records instead of leaving a lead and a customer
  // for the same person side by side.
  await linkExistingLead(ref.id, { email, phone: client.phone, teamId });
  return ref.id;
}

/**
 * Cross-links a WHMCS-sourced customer with a matching CRM lead, when one
 * exists. Best-effort: a failed link must never fail the sync.
 */
async function linkExistingLead(
  customerId: string,
  lookup: { email?: string | null; phone?: string | null; teamId: string | null }
): Promise<void> {
  try {
    const businessId = await resolveBusinessId(lookup.teamId);
    const lead = await findLeadForContact(db, { ...lookup, businessId });
    if (lead) await crossLinkLeadCustomer(db, lead.id, customerId);
  } catch (err) {
    console.error('[whmcsSync] lead cross-link failed', { customerId, err });
  }
}

// ── Full customer upsert (dedicated client sync) ──────────────────────────────
// Match by whmcsClientId first, then fall back to email so minimal customers
// created earlier by resolveCustomer() get enriched instead of duplicated.
async function upsertCustomer(c: MappedClientFull, teamId: string | null): Promise<'created' | 'updated'> {
  const now = Timestamp.now();
  let ref: FirebaseFirestore.DocumentReference | null = null;
  let alreadyLinked = false;

  if (c.whmcsClientId) {
    const s = await db.collection('customers').where('whmcsClientId', '==', c.whmcsClientId).limit(1).get();
    if (!s.empty) { ref = s.docs[0].ref; alreadyLinked = !!s.docs[0].data().leadId; }
  }
  if (!ref && c.email) {
    const s = await db.collection('customers').where('email', '==', c.email).limit(1).get();
    if (!s.empty) { ref = s.docs[0].ref; alreadyLinked = !!s.docs[0].data().leadId; }
  }
  // Third fallback: exact phone match (only if it's a real number, never empty)
  // so a customer entered manually by phone isn't duplicated.
  if (!ref && c.phone && c.phone.replace(/\D/g, '').length >= 7) {
    const s = await db.collection('customers').where('phone', '==', c.phone).limit(1).get();
    if (!s.empty) { ref = s.docs[0].ref; alreadyLinked = !!s.docs[0].data().leadId; }
  }

  const businessId = await resolveBusinessId(teamId);
  const payload: Record<string, any> = {
    whmcsClientId: c.whmcsClientId,
    source: 'whmcs',
    name: c.name,
    email: c.email,
    phone: c.phone,
    company: c.company,
    address: c.address,
    ...(teamId ? { teamId } : {}),
    ...(businessId ? { businessId } : {}),
    updatedAt: now,
  };

  if (!ref) {
    const created = await db.collection('customers').add({ ...payload, createdAt: now, createdByUserId: null });
    await linkExistingLead(created.id, { email: c.email, phone: c.phone, teamId });
    return 'created';
  }
  await ref.update(payload);
  // Also link on update — the lead may have been created after the customer.
  // Skipped once linked: this runs for every client on every sync and Firestore
  // quota, not CPU, is the bottleneck here.
  if (!alreadyLinked) await linkExistingLead(ref.id, { email: c.email, phone: c.phone, teamId });
  return 'updated';
}

// ── Invoice upsert ────────────────────────────────────────────────────────────
async function upsertInvoice(inv: MappedInvoice, customerId: string | null, teamId: string | null): Promise<'created' | 'updated'> {
  const now = Timestamp.now();
  const businessId = await resolveBusinessId(teamId);
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
    // Only set line items when we actually have them (GetInvoice/webhook path),
    // so a bulk GetInvoices update never erases items captured earlier.
    ...(inv.lineItems && inv.lineItems.length ? { lineItems: inv.lineItems, productSummary: inv.productSummary } : {}),
    ...(customerId ? { customerId } : {}),
    ...(teamId ? { teamId } : {}),
    ...(businessId ? { businessId } : {}),
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
  // Preserve a local cancellation: if the user cancelled this mirrored invoice
  // in FivoCRM, don't let the sync revert its status (which would resurrect it
  // into revenue). All other fields still refresh from WHMCS.
  if (snap.docs[0].data()?.locallyCancelled) {
    delete payload.status;
  }
  await snap.docs[0].ref.update(payload);
  return 'updated';
}

// ── Subscription upsert ─────────────────────────────────────────────────────
async function upsertSubscription(sub: MappedSubscription, customerId: string | null, teamId: string | null): Promise<'created' | 'updated'> {
  const now = Timestamp.now();
  const businessId = await resolveBusinessId(teamId);
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
    ...(businessId ? { businessId } : {}),
    updatedAt: now,
  };

  if (snap.empty) {
    await db.collection('subscriptions').add({ ...payload, createdAt: now });
    return 'created';
  }
  await snap.docs[0].ref.update(payload);
  return 'updated';
}

// ── Domain upsert ────────────────────────────────────────────────────────────
async function upsertDomain(dom: MappedDomain, customerId: string | null, teamId: string | null): Promise<'created' | 'updated'> {
  const now = Timestamp.now();
  const businessId = await resolveBusinessId(teamId);
  const snap = await db.collection('domains').where('whmcsDomainId', '==', dom.whmcsDomainId).limit(1).get();

  const payload: Record<string, any> = {
    whmcsDomainId: dom.whmcsDomainId,
    whmcsClientId: dom.whmcsClientId,
    source: 'whmcs',
    domainName: dom.domainName,
    status: dom.status,
    recurringAmount: dom.recurringAmount,
    currency: dom.currency,
    registrationDate: toTs(dom.registrationDate),
    expiryDate: toTs(dom.expiryDate),
    ...(customerId ? { customerId } : {}),
    ...(teamId ? { teamId } : {}),
    ...(businessId ? { businessId } : {}),
    updatedAt: now,
  };

  if (snap.empty) {
    await db.collection('domains').add({ ...payload, createdAt: now });
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

// Real-time client upsert (WHMCS ClientAdd/ClientEdit → FivoCRM customer). This
// is what makes a brand-new WHMCS client appear immediately, without waiting for
// the daily cron or the client's first invoice.
export async function syncClientById(clientId: string | number): Promise<void> {
  const teamId = await resolveTeamId();
  const client = await fetchClientFull(clientId);
  await upsertCustomer(client, teamId);
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
    domains: { created: 0, updated: 0 },
  };

  // Resume from where the last invocation stopped (if it ran out of budget).
  const statusSnap = await db.collection('integrations').doc('whmcs').get();
  const status = statusSnap.exists ? statusSnap.data() : null;

  // Concurrency guard: rapid manual clicks (and the daily cron) can launch
  // overlapping invocations that race on the shared cursor — making it jump
  // backwards and never converge. If a run is already in flight (started < 70s
  // ago, i.e. still within the function's lifetime), skip this one. The 70s
  // staleness window auto-releases the lock if a run was hard-killed.
  if (status?.syncStatus === 'running') {
    const startedMs: number = status.syncStartedAt?.toMillis ? status.syncStartedAt.toMillis() : 0;
    if (startedMs && Date.now() - startedMs < 70_000) {
      return { skipped: 'sinkronizimi është tashmë në progres — prit pak para se ta klikosh sërish' };
    }
  }

  // The resume cursor tracks the invoices/subscriptions/domains backfill. The
  // clients phase runs in full ONCE PER CYCLE — at the start of a fresh cycle
  // (no cursor), NOT on every resume. Running it every invocation starved the
  // backfill: the clients pass alone (2 slow WHMCS API calls through the proxy)
  // can eat the whole 30s budget, so invoices/subscriptions/domains never ran and
  // the cursor stuck on 'invoices' forever. Once a cycle completes the cursor is
  // cleared, so the next run is "fresh" and clients refresh again.
  const cursor = (status?.syncCursor || null) as { phase?: string; start?: number } | null;
  const isFreshCycle = !cursor;
  const resumable = cursor?.phase === 'invoices' || cursor?.phase === 'subscriptions' || cursor?.phase === 'domains';
  let phase: string = resumable ? cursor!.phase! : 'invoices';
  let start: number = resumable ? (cursor?.start || 0) : 0;

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
      domainsCreated: counters.domains.created, domainsUpdated: counters.domains.updated,
      errorCount: errors.length, lastErrors: errors.slice(0, 10),
    }, teamId);
    return {
      partial: true, resumePhase: p, resumeStart: nextStart,
      clientsCreated: counters.clients.created, clientsUpdated: counters.clients.updated,
      invoicesCreated: counters.invoices.created, invoicesUpdated: counters.invoices.updated,
      subsCreated: counters.subs.created, subsUpdated: counters.subs.updated,
      domainsCreated: counters.domains.created, domainsUpdated: counters.domains.updated,
      errors: errors.length,
      ...(errors.length ? { errorDetail: errors.slice(0, 2).join(' | ').slice(0, 400) } : {}),
    };
  };

  // ── Phase: clients → customers (once per cycle, only on a fresh start) ────
  // syncAllClients has no time budget; on slow accounts it can consume the whole
  // window, so we run it only when starting a fresh cycle and let the backfill
  // resume without it on subsequent invocations.
  if (isFreshCycle) {
    const res = await syncAllClients(teamId, errors, clientCache);
    counters.clients.created = res.clientsCreated;
    counters.clients.updated = res.clientsUpdated;
    await writeWhmcsStatus({ clientsCreated: counters.clients.created, clientsUpdated: counters.clients.updated, errorCount: errors.length, lastErrors: errors.slice(0, 10) }, teamId);

    // If the clients pass alone exhausted the budget, pause into the backfill so
    // the NEXT run skips clients and spends its full budget on invoices→…→domains.
    if (overBudget()) return pause(phase, start);
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
    await writeWhmcsStatus({ subsCreated: counters.subs.created, subsUpdated: counters.subs.updated, errorCount: errors.length, lastErrors: errors.slice(0, 10) }, teamId);
    if (!res.done) return pause('subscriptions', res.nextStart);
    phase = 'domains'; start = 0;
  }

  // ── Phase: domain registrations ──────────────────────────────────────────────
  if (phase === 'domains') {
    const res = await runPhase('GetClientsDomains', d => d?.domains?.domain, async (raw) => {
      const dom = mapWhmcsDomain(raw);
      const customerId = await resolveCustomerId(dom.whmcsClientId);
      return upsertDomain(dom, customerId, teamId);
    }, start, overBudget, errors, counters.domains);
    if (!res.done) return pause('domains', res.nextStart);
  }

  // ── Done: clear the cursor and persist the final status ─────────────────────
  await writeWhmcsStatus({
    lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
    syncStatus: 'done',
    syncCursor: admin.firestore.FieldValue.delete(),
    clientsCreated: counters.clients.created, clientsUpdated: counters.clients.updated,
    invoicesCreated: counters.invoices.created, invoicesUpdated: counters.invoices.updated,
    subsCreated: counters.subs.created, subsUpdated: counters.subs.updated,
    domainsCreated: counters.domains.created, domainsUpdated: counters.domains.updated,
    errorCount: errors.length,
    lastErrors: errors.slice(0, 10),
  }, teamId);

  return {
    clientsCreated: counters.clients.created, clientsUpdated: counters.clients.updated,
    invoicesCreated: counters.invoices.created, invoicesUpdated: counters.invoices.updated,
    subsCreated: counters.subs.created, subsUpdated: counters.subs.updated,
    domainsCreated: counters.domains.created, domainsUpdated: counters.domains.updated,
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
