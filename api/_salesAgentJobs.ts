/**
 * Ana — the scheduled side. Registered in api/cron/run.ts, fired from vps/server.ts,
 * NEVER in run-all (every job here either spends money or messages a real person).
 *
 *   sales-agent-prospecting   every 15 min  — runs queued `prospectSearches` (Google Places)
 *   sales-agent-cold-wa       every 15 min  — ONE metered cold WhatsApp per sender number per tick
 *   sales-agent-nudges        hourly        — nudges a silent prospect; escalates a stale handoff
 *   sales-agent-digest        08:15 local   — "dje në shitje" to the managers
 *   sales-agent-prospect-ttl  03:30 local   — PLATFORM-ONLY: deletes unregistered prospects > 30 days
 *   sales-agent-pending       every 5 min   — sends a held level-1 reply nobody answered in time
 *
 * Every read is tenant-scoped and capped; a manual run is ONE tenant (`opts.businessId`,
 * filtered BEFORE any send); suspended tenants are skipped; every non-action is a
 * named reason tallied into `teamSettings.salesAgent.lastRun.<job>`.
 */
import admin, { adminDb as db, Timestamp } from './_firebaseAdmin.js';
import { notifyUser } from './_push.js';
import { managerIdsForBusiness } from './_staffRecipients.js';
import { toWaPhone } from './_waPhone.js';
import { makeWaAgentResolver } from './_waAgent.js';
import { withJobLease, isLeaseHeld } from './_jobLease.js';
import { PlacesError, placesTextSearchAll, resolvePlacesKey } from './_placesClient.js';
import {
  SALES_AGENT_TZ as TZ, agentStateOf, baileysCoordsOf, buildDigestFacts, bumpMonthlyUsage, bumpUsage, loadAgentCtx, loadSalesFacts,
  contactOptedOut, lastHumanOutboundMs, notifyHandoff, readMonthlyUsage, readUsage, sendAgentWaText, shiftDateKey, stampAgentSend,
  writeLeadActivity, type AgentCtx,
} from './_salesAgent.js';
import {
  COLD_WA_BLOCK_LABELS, buildNudgeText, buildSalesDigest, coldWaBlockReason, coldWaPauseAfterFailure, ensureColdWaCompliance,
  handoffOverdue, isSupersededInbound, localParts, nudgeBlockReason, pendingSendBlockReason, qualificationProgress, renderTemplate,
  salesAgentRunId, salesDigestDocId,
  type ColdWaBlockReason,
} from './_salesAgentCore.js';
import {
  buildCallScript, buildColdWaDraft, buildFirstEmailDraft, estimateSearchRequests, findDuplicate, fitScore, normalizePlace,
  prospectExpiresAt, type ExistingContactKey, type ProspectDraft,
} from './_salesAgentProspecting.js';

const LEASE_MS = 10 * 60_000;
const SEARCHES_PER_RUN = 3;
const EXISTING_READ_CAP = 500;
const COLD_WA_CANDIDATES = 20;
const NUDGE_READ_CAP = 100;
const TTL_BATCH = 200;
const TTL_MAX_BATCHES = 5;
const COLD_WA_AUTOMATION_KIND = 'sales-agent-cold';
/** Starts with 'sales-agent' so the thread reader counts it as Ana's own row. */
const AGENT_PENDING_AUTOMATION_KIND = 'sales-agent-pending';
const PENDING_READ_CAP = 100;

interface JobOpts { businessId?: string | null; now?: Date }

const isAlreadyExists = (err: any): boolean =>
  err?.code === 6 || err?.code === 'already-exists' || /ALREADY_EXISTS/i.test(String(err?.message || ''));

function toMs(v: unknown): number {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  const o = v as { toMillis?: () => number; toDate?: () => Date };
  if (typeof o.toMillis === 'function') return o.toMillis();
  if (typeof o.toDate === 'function') return o.toDate().getTime();
  const t = new Date(v as any).getTime();
  return Number.isFinite(t) ? t : 0;
}
const toDate = (v: unknown): Date | null => { const ms = toMs(v); return ms ? new Date(ms) : null; };

class Tally {
  counts: Record<string, number> = {};
  add(reason: string, n = 1) { this.counts[reason] = (this.counts[reason] || 0) + n; }
}

async function writeLastRun(teamId: string, job: string, data: Record<string, any>): Promise<void> {
  await db.collection('teamSettings').doc(teamId).set({ salesAgent: { lastRun: { [job]: { ...data, at: Timestamp.now() } } } }, { merge: true }).catch(() => {});
}

/** Every team with the agent switched on (+ the tenant filter for a manual run); suspended tenants skipped. */
async function enabledTenants(scopeId: string | null, tally: Tally): Promise<AgentCtx[]> {
  const out: AgentCtx[] = [];
  const snap = await db.collection('teamSettings').where('salesAgent.enabled', '==', true).limit(500).get();
  for (const d of snap.docs) {
    const ctx = await loadAgentCtx(d.id).catch(() => null);
    if (!ctx) { tally.add('team-missing'); continue; }
    if (scopeId && ctx.businessId !== scopeId) { tally.add('out-of-scope'); continue; }
    if (ctx.tenantStatus === 'suspended') { tally.add('suspended'); continue; }
    if (!ctx.settings.enabled) { tally.add('module-off'); continue; }
    out.push(ctx);
  }
  return out;
}

function serviceLineOf(facts: Awaited<ReturnType<typeof loadSalesFacts>>): string {
  const cat = facts.services.find((s) => s.category)?.category;
  return cat ? cat.toLowerCase() : facts.services[0]?.name?.toLowerCase() || 'marketing dixhital';
}

// ── 1. Prospecting ────────────────────────────────────────────────────────────

async function existingContactKeys(bid: string, excludeSearchId: string): Promise<ExistingContactKey[]> {
  const out: ExistingContactKey[] = [];
  const push = (snap: admin.firestore.QuerySnapshot | null, kind: ExistingContactKey['kind'], phoneField: string) => {
    snap?.docs.forEach((d) => {
      const x = d.data() as any;
      if (kind === 'prospect' && x.searchId === excludeSearchId) return;
      out.push({
        id: d.id, kind,
        phone: toWaPhone(x[phoneField] || x.phone || '') || null,
        website: typeof x.website === 'string' ? x.website : null,
        name: typeof x.name === 'string' ? x.name : typeof x.company === 'string' ? x.company : null,
        city: typeof x.city === 'string' ? x.city : null,
      });
    });
  };
  const [leads, customers, prospects] = await Promise.all([
    db.collection('leads').where('businessId', '==', bid).limit(EXISTING_READ_CAP).get().catch(() => null),
    db.collection('customers').where('businessId', '==', bid).limit(EXISTING_READ_CAP).get().catch(() => null),
    db.collection('prospects').where('businessId', '==', bid).limit(EXISTING_READ_CAP).get().catch(() => null),
  ]);
  push(leads, 'lead', 'phoneNumber');
  push(customers, 'customer', 'phone');
  push(prospects, 'prospect', 'phone');
  return out;
}

export async function runSalesAgentProspecting(opts: JobOpts = {}): Promise<Record<string, unknown>> {
  const scopeId = opts.businessId || null;
  const r = await withJobLease('sales-agent-prospecting', scopeId, LEASE_MS, async () => {
    const now = opts.now || new Date();
    const tally = new Tally();
    let q: admin.firestore.Query = db.collection('prospectSearches').where('status', '==', 'queued');
    if (scopeId) q = q.where('businessId', '==', scopeId);
    const snap = await q.limit(SEARCHES_PER_RUN).get();
    let ran = 0, failed = 0, prospectsWritten = 0;
    for (const doc of snap.docs) {
      const search = doc.data() as any;
      // Claim queued → running in a transaction: two ticks can never run the same search.
      const claimed = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        if ((fresh.data() as any)?.status !== 'queued') return false;
        tx.update(doc.ref, { status: 'running', startedAt: Timestamp.fromDate(now), updatedAt: Timestamp.fromDate(now) });
        return true;
      }).catch(() => false);
      if (!claimed) { tally.add('already-claimed'); continue; }
      const fail = async (reason: string, error: string) => {
        failed++; tally.add(reason);
        await doc.ref.set({ status: 'failed', error: error.slice(0, 300), finishedAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });
      };
      try {
        const ctx = await loadAgentCtx(String(search.teamId || ''), String(search.businessId || ''));
        if (!ctx || ctx.businessId !== search.businessId) { await fail('team-missing', 'Ekipi nuk u gjet'); continue; }
        if (ctx.tenantStatus === 'suspended') { await fail('suspended', 'Hapësira është e pezulluar'); continue; }
        if (!ctx.settings.enabled) { await fail('module-off', 'Agjentja është e çaktivizuar'); continue; }
        const key = resolvePlacesKey(ctx.cfg);
        if (!key.key) { await fail('places-not-configured', 'Çelësi i Google Places nuk është konfiguruar'); continue; }
        const dateKey = localParts(now, TZ).date;
        const monthly = await readMonthlyUsage(ctx.businessId, dateKey);
        const maxResults = Number(search.maxResults) || 20;
        if ((Number(monthly.placesRequests) || 0) + estimateSearchRequests(maxResults) > ctx.settings.placesMonthlyBudget) {
          await fail('budget-exceeded', 'Buxheti mujor i kërkimeve Places u tejkalua'); continue;
        }
        const textQuery = `${String(search.query || '').trim()} ${String(search.city || '').trim()}`.trim();
        const res = await placesTextSearchAll(key.key, textQuery, maxResults, { regionCode: String(search.region || 'AL') });
        if (res.requests) {
          await Promise.all([
            bumpMonthlyUsage(ctx.businessId, ctx.teamId, dateKey, { placesRequests: res.requests }),
            bumpUsage(ctx.businessId, ctx.teamId, dateKey, { placesRequests: res.requests }),
          ]);
        }
        if (res.error && !res.places.length) { await fail(`places-${res.error.code}`, res.error.message); continue; }
        const [existing, facts] = await Promise.all([existingContactKeys(ctx.businessId, doc.id), loadSalesFacts(ctx)]);
        const serviceLine = serviceLineOf(facts);
        const counts = { found: res.places.length, new: 0, duplicate: 0, registered: 0, requests: res.requests };
        const seen = new Set<string>();
        for (const place of res.places) {
          const draft: ProspectDraft | null = normalizePlace(place, { fallbackCity: String(search.city || '') || null, normalizePhone: toWaPhone });
          if (!draft || seen.has(draft.placeId)) continue;
          seen.add(draft.placeId);
          const dup = findDuplicate(draft, existing);
          const fit = fitScore(draft, ctx.settings.icp);
          const input = { prospect: draft, persona: ctx.settings.persona, serviceLine, senderName: null };
          const ts = Timestamp.fromDate(now);
          const row = {
            businessId: ctx.businessId, teamId: ctx.teamId, searchId: doc.id, placeId: draft.placeId, name: draft.name,
            category: draft.category, address: draft.address, city: draft.city, phone: draft.phone, website: draft.website,
            rating: draft.rating, reviewCount: draft.reviewCount, fitScore: fit.score, fitReasons: fit.reasons,
            status: dup ? 'duplicate' : 'new', matchedContactId: dup?.id ?? null, matchedContactKind: dup ? (dup.kind === 'prospect' ? null : dup.kind) : null,
            matchedProspectId: dup?.kind === 'prospect' ? dup.id : null, leadId: dup?.kind === 'lead' ? dup.id : null,
            firstMessageDraft: buildFirstEmailDraft(input).body, callScript: buildCallScript(input), serviceLine, waVerified: null,
            outreachWa: null, outreachEmail: null, expiresAt: Timestamp.fromDate(prospectExpiresAt(now)), registeredAt: null, registeredByUserId: null,
            createdAt: ts, updatedAt: ts,
          };
          try {
            await db.collection('prospects').doc(`${doc.id}_${draft.placeId}`).create(row);
            if (dup) counts.duplicate++; else counts.new++;
            prospectsWritten++;
            existing.push({ id: `${doc.id}_${draft.placeId}`, kind: 'prospect', phone: draft.phone, website: draft.website, name: draft.name, city: draft.city });
          } catch (err) {
            if (!isAlreadyExists(err)) throw err;
            tally.add('prospect-exists');
          }
        }
        await doc.ref.set({
          status: 'done', counts, error: res.error ? `Faqja e fundit dështoi: ${res.error.message}`.slice(0, 300) : null,
          finishedAt: Timestamp.now(), updatedAt: Timestamp.now(),
        }, { merge: true });
        await bumpUsage(ctx.businessId, ctx.teamId, dateKey, { prospectsNew: counts.new, searches: 1 });
        ran++;
        if (search.requestedByUserId) {
          await notifyUser({
            userId: String(search.requestedByUserId), type: 'prospects_ready',
            title: `🔎 ${ctx.settings.persona.name}: ${counts.new} prospekte të reja për "${search.query}" në ${search.city}`,
            message: counts.duplicate ? `${counts.duplicate} ishin tashmë në CRM.` : 'Shqyrtoji dhe regjistro ato që do t\'i kontaktosh.',
            actionUrl: `/app/sales-agent?tab=prospects&search=${encodeURIComponent(doc.id)}`, actionLabel: 'Shiko prospektet',
            businessId: ctx.businessId, teamId: ctx.teamId,
          }).catch(() => {});
        }
        await writeLastRun(ctx.teamId, 'prospecting', { searchId: doc.id, counts, blocked: null, error: null });
      } catch (err: any) {
        const msg = err instanceof PlacesError ? err.message : String(err?.message || err);
        console.error('[CRON:sales-agent-prospecting] search failed', doc.id, err);
        await fail('error', msg);
      }
    }
    return { scanned: snap.size, ran, failed, prospectsWritten, blocked: tally.counts };
  });
  return isLeaseHeld(r) ? r : (r as Record<string, unknown>);
}

// ── 2. Cold WhatsApp (law 7) ──────────────────────────────────────────────────

const PER_SENDER_BLOCKS = new Set<ColdWaBlockReason>(['cold-wa-off', 'cold-wa-paused', 'no-sender', 'weekend', 'outside-window', 'quota-reached', 'min-gap', 'budget-exhausted']);
const PERMANENT_PROSPECT_BLOCKS = new Set<ColdWaBlockReason>(['no-phone', 'not-on-whatsapp', 'opted-out', 'already-contacted']);

interface SenderState {
  warmupStartedAt: Date | null;
  sentDateKey: string | null;
  sentToday: number;
  lastSentAt: Date | null;
  failureAts: number[];
  pausedUntil: Date | null;
}

function readSenderState(d: any, dateKey: string, nowMs: number): SenderState {
  const fails: number[] = Array.isArray(d?.failureAts) ? d.failureAts.map(toMs).filter((ms: number) => ms > nowMs - 86_400_000) : [];
  return {
    warmupStartedAt: toDate(d?.warmupStartedAt),
    sentDateKey: typeof d?.sentDateKey === 'string' ? d.sentDateKey : null,
    sentToday: d?.sentDateKey === dateKey ? Number(d?.sentToday) || 0 : 0,
    lastSentAt: toDate(d?.lastSentAt),
    failureAts: fails,
    pausedUntil: toDate(d?.pausedUntil),
  };
}

const isBlockLikeError = (error: string | null): boolean => /not-on-whatsapp|blocked|spam|banned|forbidden|no-ack|failed/i.test(String(error || ''));

export async function runSalesAgentColdWa(opts: JobOpts = {}): Promise<Record<string, unknown>> {
  const scopeId = opts.businessId || null;
  const r = await withJobLease('sales-agent-cold-wa', scopeId, LEASE_MS, async () => {
    const now = opts.now || new Date();
    const nowMs = now.getTime();
    const dateKey = localParts(now, TZ).date;
    const tally = new Tally();
    let sent = 0, failed = 0, tenants = 0;
    const resolver = makeWaAgentResolver();
    for (const ctx of await enabledTenants(scopeId, tally)) {
      const s = ctx.settings;
      if (!s.coldWa.enabled) { tally.add('cold-wa-off'); continue; }
      tenants++;
      const perTenant = new Tally();
      const cand = await db.collection('prospects')
        .where('businessId', '==', ctx.businessId).where('status', '==', 'registered').where('outreachWa', '==', 'pending')
        .limit(COLD_WA_CANDIDATES).get().catch(() => null);
      const rows = (cand?.docs || []).map((d) => ({ id: d.id, ref: d.ref, data: d.data() as any })).sort((a, b) => (Number(b.data.fitScore) || 0) - (Number(a.data.fitScore) || 0));
      if (!rows.length) { perTenant.add('no-candidates'); await writeLastRun(ctx.teamId, 'coldWa', { sent: 0, blocked: perTenant.counts }); continue; }
      // Sender: the dedicated outreach number, else the team's connected agent.
      let agent = null as Awaited<ReturnType<typeof resolver.resolve>>;
      if (s.coldWa.senderAgentId) {
        agent = (await resolver.agentsFor(ctx.businessId)).find((a) => a.id === s.coldWa.senderAgentId && a.connected) || null;
      }
      if (!agent) agent = await resolver.resolve(ctx.businessId, ctx.teamId);
      const senderRef = agent ? db.collection('salesAgentSenders').doc(`${ctx.businessId}_${agent.id}`) : null;
      const senderDoc = senderRef ? (await senderRef.get().catch(() => null)) : null;
      const sender = readSenderState(senderDoc?.exists ? senderDoc.data() : null, dateKey, nowMs);
      const relay = agent ? await resolver.relayFor(ctx.teamId, agent.teamId) : baileysCoordsOf(ctx.cfg);
      const facts = await loadSalesFacts(ctx);
      const serviceLine = serviceLineOf(facts);
      for (const row of rows) {
        const p = row.data;
        const leadSnap = p.leadId ? await db.collection('leads').doc(String(p.leadId)).get().catch(() => null) : null;
        const lead = leadSnap?.exists ? (leadSnap.data() as any) : null;
        const phone = toWaPhone(p.phone || lead?.phoneNumber || lead?.phone || '');
        const reason = coldWaBlockReason({
          settings: s.coldWa, senderWarmupStartedAt: sender.warmupStartedAt, failures24h: sender.failureAts.length, now, timeZone: TZ,
          senderAgentId: agent?.id ?? null, pausedUntil: sender.pausedUntil, sentTodayBySender: sender.sentToday, lastSentAtBySender: sender.lastSentAt,
          prospect: {
            phone: phone || null, waVerified: typeof p.waVerified === 'boolean' ? p.waVerified : null,
            optedOut: lead?.waOptOut === true, registeredAt: toDate(p.registeredAt),
            contactedAt: toDate(lead?.coldWaSentAt) || toDate(lead?.lastInboundAt) || toDate(p.outreachWaAt),
          },
        });
        if (reason) {
          perTenant.add(reason); tally.add(reason);
          if (PERMANENT_PROSPECT_BLOCKS.has(reason)) await row.ref.set({ outreachWa: 'skipped', outreachWaReason: reason, updatedAt: Timestamp.now() }, { merge: true });
          if (PER_SENDER_BLOCKS.has(reason)) break;
          continue;
        }
        const runRef = db.collection('salesAgentRuns').doc(salesAgentRunId(ctx.businessId, 'cold-wa', row.id, dateKey));
        try {
          await runRef.create({ businessId: ctx.businessId, teamId: ctx.teamId, kind: 'cold-wa', entityId: row.id, leadId: p.leadId ?? null, decision: 'pending', createdAt: Timestamp.now() });
        } catch (err) {
          if (isAlreadyExists(err)) { perTenant.add('duplicate-run'); continue; }
          throw err;
        }
        const text = ensureColdWaCompliance(buildColdWaDraft(s.coldWa.template, {
          prospect: { name: p.name || lead?.name || '', category: p.category ?? null, city: p.city ?? null, website: p.website ?? null, rating: p.rating ?? null, reviewCount: p.reviewCount ?? null },
          persona: s.persona, serviceLine,
        }, renderTemplate), s.persona);
        // Always send with the AGENT's teamId + relay (the number often lives on another department).
        const sendCtx: AgentCtx = { ...ctx, teamId: agent!.teamId, cfg: { ...ctx.cfg, whatsappVpsUrl: relay.vpsUrl, whatsappVpsSecret: relay.vpsSecret } };
        const res = await sendAgentWaText({
          ctx: sendCtx, target: { channel: 'baileys', agentId: agent!.id, metaPhoneNumberId: null, phone },
          text, idempotencyKey: `sa_cold_${row.id}`, automationKind: COLD_WA_AUTOMATION_KIND, leadId: p.leadId ?? null, customerId: null, contactName: p.name || phone,
        });
        const ts = Timestamp.fromDate(now);
        if (res.ok) {
          sent++;
          await Promise.allSettled([
            row.ref.set({ outreachWa: 'sent', outreachWaAt: ts, outreachWaMessageId: res.id, waVerified: true, updatedAt: ts }, { merge: true }),
            p.leadId ? db.collection('leads').doc(String(p.leadId)).set({
              coldWaSentAt: ts, lastActivityAt: ts, lastFollowUpDate: ts, ...(lead?.status === 'New' ? { status: 'Contacted' } : {}), updatedAt: ts,
            }, { merge: true }) : Promise.resolve(),
            p.leadId ? writeLeadActivity(ctx, String(p.leadId), `${s.persona.name} dërgoi mesazhin e parë në WhatsApp`, text, { prospectId: row.id, waMessageId: res.id, cold: true }) : Promise.resolve(),
            senderRef!.set({
              businessId: ctx.businessId, agentId: agent!.id, teamId: agent!.teamId, sentDateKey: dateKey, sentToday: sender.sentToday + 1, lastSentAt: ts,
              warmupStartedAt: sender.warmupStartedAt ? Timestamp.fromDate(sender.warmupStartedAt) : ts, totalSent: admin.firestore.FieldValue.increment(1), updatedAt: ts,
            }, { merge: true }),
            bumpUsage(ctx.businessId, ctx.teamId, dateKey, { coldWaSent: 1 }),
            runRef.set({ decision: 'send', replyText: text, messageId: res.id, updatedAt: ts }, { merge: true }),
          ]);
        } else {
          failed++;
          const blockLike = res.permanent || isBlockLikeError(res.error);
          await runRef.set({ decision: 'blocked', blockReason: res.permanent ? 'not-on-whatsapp' : 'send-failed', error: res.error, updatedAt: ts }, { merge: true });
          if (res.permanent) {
            await Promise.allSettled([
              row.ref.set({ outreachWa: 'failed', outreachWaReason: 'not-on-whatsapp', waVerified: false, updatedAt: ts }, { merge: true }),
              p.leadId ? db.collection('leads').doc(String(p.leadId)).set({ waUndeliverablePhone: phone, waUndeliverableAt: ts, updatedAt: ts }, { merge: true }) : Promise.resolve(),
            ]);
          }
          if (blockLike && senderRef) {
            const fails = [...sender.failureAts, nowMs];
            const pausedUntil = coldWaPauseAfterFailure(fails.length, now);
            await senderRef.set({
              businessId: ctx.businessId, agentId: agent!.id, teamId: agent!.teamId, failureAts: fails.map((ms) => Timestamp.fromMillis(ms)),
              ...(pausedUntil ? { pausedUntil: Timestamp.fromDate(pausedUntil) } : {}), lastError: String(res.error || '').slice(0, 200), updatedAt: ts,
            }, { merge: true });
            if (pausedUntil) {
              perTenant.add('cold-wa-paused');
              const recipients = await managerIdsForBusiness(ctx.businessId, ctx.teamId);
              await Promise.allSettled(recipients.map((uid) => notifyUser({
                userId: uid, type: 'sales_agent_paused', title: `${s.persona.name}: mesazhet e ftohta u ndalën për 7 ditë`,
                message: `Dy dështime/bllokime brenda 24 orësh nga numri ${agent!.id}. Kontrollo numrin dhe mesazhin para se të vazhdosh.`,
                actionUrl: '/app/sales-agent?tab=settings', actionLabel: 'Hap cilësimet', businessId: ctx.businessId, teamId: ctx.teamId,
              })));
            }
          }
        }
        break; // ONE attempt per sender per tick — the gap law
      }
      await writeLastRun(ctx.teamId, 'coldWa', { sent: perTenant.counts['sent'] || 0, blocked: perTenant.counts, labels: Object.fromEntries(Object.keys(perTenant.counts).map((k) => [k, (COLD_WA_BLOCK_LABELS as Record<string, string>)[k] || k])) });
    }
    return { date: dateKey, tenants, sent, failed, blocked: tally.counts };
  });
  return isLeaseHeld(r) ? r : (r as Record<string, unknown>);
}

// ── 3. Nudges + handoff SLA ───────────────────────────────────────────────────

export async function runSalesAgentNudges(opts: JobOpts = {}): Promise<Record<string, unknown>> {
  const scopeId = opts.businessId || null;
  const r = await withJobLease('sales-agent-nudges', scopeId, LEASE_MS, async () => {
    const now = opts.now || new Date();
    const dateKey = localParts(now, TZ).date;
    const tally = new Tally();
    let nudged = 0, escalated = 0;
    for (const ctx of await enabledTenants(scopeId, tally)) {
      const s = ctx.settings;
      const active = await db.collection('conversations').where('businessId', '==', ctx.businessId).where('agent.active', '==', true).limit(NUDGE_READ_CAP).get().catch(() => null);
      for (const d of active?.docs || []) {
        const conv = d.data() as any;
        const a = agentStateOf(conv);
        if (!a) continue;
        const reason = nudgeBlockReason({ settings: s, agent: a, lastInboundAt: toDate(conv.lastInboundAt), lastOutboundAt: toDate(conv.lastOutboundAt), now, timeZone: TZ });
        if (reason) { tally.add(reason); continue; }
        const phone = toWaPhone(conv.phone || '');
        if (!phone || conv.channel !== 'whatsapp') { tally.add('no-phone'); continue; }
        const runRef = db.collection('salesAgentRuns').doc(salesAgentRunId(ctx.businessId, 'nudge', d.id, String(a.nudgesSent)));
        try {
          await runRef.create({ businessId: ctx.businessId, teamId: ctx.teamId, kind: 'nudge', entityId: d.id, decision: 'pending', createdAt: Timestamp.now() });
        } catch (err) { if (isAlreadyExists(err)) { tally.add('duplicate-run'); continue; } throw err; }
        const text = buildNudgeText(s.persona, String(conv.subject || ''), a.nudgesSent, qualificationProgress(a.collected, s.qualificationFields));
        const res = await sendAgentWaText({
          ctx, target: { channel: conv.channelKind === 'meta' ? 'meta' : 'baileys', agentId: conv.agentId ?? null, metaPhoneNumberId: conv.metaPhoneNumberId ?? null, phone },
          text, idempotencyKey: `sa_nudge_${d.id}_${a.nudgesSent}`, automationKind: 'sales-agent-nudge', leadId: conv.leadId ?? null, customerId: conv.customerId ?? null, contactName: String(conv.subject || phone),
        });
        const ts = Timestamp.fromDate(now);
        if (res.ok) {
          nudged++;
          await Promise.allSettled([
            d.ref.set({ agent: { nudgesSent: a.nudgesSent + 1, lastNudgeAt: ts }, lastOutboundAt: ts, updatedAt: ts }, { merge: true }),
            runRef.set({ decision: 'send', replyText: text, updatedAt: ts }, { merge: true }),
            bumpUsage(ctx.businessId, ctx.teamId, dateKey, { nudges: 1 }),
          ]);
        } else {
          tally.add('send-failed');
          await runRef.set({ decision: 'blocked', blockReason: 'send-failed', error: res.error, updatedAt: ts }, { merge: true });
        }
      }
      // Handoff SLA: nobody picked the thread up → escalate to the managers, once.
      const handoffs = await db.collection('conversations').where('businessId', '==', ctx.businessId).where('agent.stage', '==', 'handoff').limit(50).get().catch(() => null);
      for (const d of handoffs?.docs || []) {
        const conv = d.data() as any;
        const a = agentStateOf(conv);
        if (!a || a.handoffNotifiedAt || !handoffOverdue(a.handoffAt, a.resumedAt, s.handoffSlaMinutes, now)) continue;
        const n = await notifyHandoff(ctx, d.id, String(conv.subject || conv.phone || 'Kontakt'), a.handoffReason || 'manual', toWaPhone(conv.phone || ''), null, conv.customerId ?? null, true);
        await d.ref.set({ agent: { handoffNotifiedAt: Timestamp.fromDate(now) }, updatedAt: Timestamp.fromDate(now) }, { merge: true });
        if (n > 0) escalated++;
      }
      await writeLastRun(ctx.teamId, 'nudges', { nudged, escalated, blocked: tally.counts });
    }
    return { date: dateKey, nudged, escalated, blocked: tally.counts };
  });
  return isLeaseHeld(r) ? r : (r as Record<string, unknown>);
}

// ── 4. Daily digest ───────────────────────────────────────────────────────────

export async function runSalesAgentDigest(opts: JobOpts = {}): Promise<Record<string, unknown>> {
  const now = opts.now || new Date();
  const scopeId = opts.businessId || null;
  const today = localParts(now, TZ).date;
  const yesterday = shiftDateKey(today, -1);
  const tally = new Tally();
  let posted = 0;
  const seenBusiness = new Set<string>();
  for (const ctx of await enabledTenants(scopeId, tally)) {
    if (seenBusiness.has(ctx.businessId)) { tally.add('same-business'); continue; }
    seenBusiness.add(ctx.businessId);
    try {
      const facts = await buildDigestFacts(ctx, yesterday, now);
      const text = buildSalesDigest(facts, ctx.settings.persona);
      if (!text) { tally.add('nothing-to-say'); await writeLastRun(ctx.teamId, 'digest', { posted: false, blocked: 'nothing-to-say' }); continue; }
      try {
        await db.collection('salesAgentDigests').doc(salesDigestDocId(ctx.businessId, yesterday)).create({ businessId: ctx.businessId, teamId: ctx.teamId, date: yesterday, text, facts, createdAt: Timestamp.now() });
      } catch (err) { if (isAlreadyExists(err)) { tally.add('already-posted'); continue; } throw err; }
      const recipients = await managerIdsForBusiness(ctx.businessId, ctx.teamId);
      await Promise.allSettled(recipients.map((uid) => notifyUser({
        userId: uid, type: 'sales_agent_daily_digest', title: `${ctx.settings.persona.name} — dje në shitje (${yesterday})`, message: text.slice(0, 1500),
        actionUrl: '/app/sales-agent', actionLabel: 'Hap agjenten', businessId: ctx.businessId, teamId: ctx.teamId,
      })));
      posted++;
      await writeLastRun(ctx.teamId, 'digest', { posted: true, date: yesterday, blocked: null });
    } catch (err: any) {
      tally.add('error');
      console.error('[CRON:sales-agent-digest] failed', ctx.businessId, err);
      await writeLastRun(ctx.teamId, 'digest', { posted: false, error: String(err?.message || err).slice(0, 300) });
    }
  }
  return { date: yesterday, posted, blocked: tally.counts };
}

// ── 6. Held level-1 replies (every 5 min) ────────────────────────────────────

/**
 * Level 1 inside office hours holds Ana's reply for `humanSilenceMinutes` so a person
 * can answer first (`conversations.agent.pendingSend`). This job sends the ones whose
 * wait is over, after asking `pendingSendBlockReason()` again: a person who answered,
 * a newer client message, a handoff, an opt-out or a lowered level cancels it (the
 * text stays as the thread's draft). Reads only due rows — a range on one indexed field.
 */
export async function runSalesAgentPending(opts: JobOpts = {}): Promise<Record<string, unknown>> {
  const scopeId = opts.businessId || null;
  const r = await withJobLease('sales-agent-pending', scopeId, LEASE_MS, async () => {
    const now = opts.now || new Date();
    const dateKey = localParts(now, TZ).date;
    const tally = new Tally();
    let sent = 0, cancelled = 0;
    const due = await db.collection('conversations').where('agent.pendingDueAt', '<=', Timestamp.fromDate(now)).limit(PENDING_READ_CAP).get().catch((err) => {
      console.error('[salesAgent] pending read failed', err); return null;
    });
    const ctxByTeam = new Map<string, AgentCtx | null>();
    for (const d of due?.docs || []) {
      const conv = d.data() as any;
      const bid = String(conv.businessId || '');
      if (scopeId && bid !== scopeId) { tally.add('out-of-scope'); continue; }
      const p = conv.agent?.pendingSend;
      const forMessageId = typeof p?.forMessageId === 'string' ? p.forMessageId : '';
      // Claim: only the run that clears the due date may send (overlapping ticks, retries).
      const claimed = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(d.ref);
        const fp = (fresh.data() as any)?.agent?.pendingSend;
        if (!fp || fp.forMessageId !== forMessageId || !(fresh.data() as any)?.agent?.pendingDueAt) return false;
        tx.set(d.ref, { agent: { pendingDueAt: admin.firestore.FieldValue.delete() } }, { merge: true });
        return true;
      }).catch(() => false);
      if (!claimed || !forMessageId) { tally.add('claimed-elsewhere'); continue; }
      const runRef = db.collection('salesAgentRuns').doc(salesAgentRunId(bid, 'reply', d.id, forMessageId));
      const cancel = async (reason: string) => {
        cancelled++; tally.add(reason);
        await d.ref.set({ agent: { pendingSend: admin.firestore.FieldValue.delete() } }, { merge: true }).catch(() => {});
        await runRef.set({ decision: 'draft', blockReason: reason, pendingCancelledAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true }).catch(() => {});
      };
      const teamId = String(conv.teamId || '');
      if (!ctxByTeam.has(teamId)) ctxByTeam.set(teamId, await loadAgentCtx(teamId, bid).catch(() => null));
      const ctx = ctxByTeam.get(teamId) || null;
      if (!ctx) { await cancel('team-missing'); continue; }
      if (ctx.tenantStatus === 'suspended') { await cancel('suspended'); continue; }
      const target = p.target || {};
      const phone = toWaPhone(String(target.phone || conv.phone || ''));
      if (!phone) { await cancel('no-phone'); continue; }
      const [usage, humanMs, optedOut] = await Promise.all([
        readUsage(ctx.businessId, dateKey),
        lastHumanOutboundMs(ctx.teamId, phone),
        contactOptedOut(p.leadId ?? conv.leadId ?? null, p.customerId ?? conv.customerId ?? null),
      ]);
      const reason = pendingSendBlockReason({
        settings: ctx.settings, dueAt: toDate(p.dueAt), createdAt: toDate(p.createdAt), now,
        agentState: agentStateOf(conv),
        superseded: isSupersededInbound({ waMessageId: forMessageId, lastInboundMessageId: conv.lastInboundMessageId ?? null, lastInboundKind: conv.lastInboundKind ?? null }),
        lastHumanOutboundMs: humanMs, optedOut, repliesToday: Number(usage.replies) || 0,
      });
      if (reason) { await cancel(reason); continue; }
      const text = String(p.text || '');
      const res = await sendAgentWaText({
        ctx, target: { channel: target.channel === 'meta' ? 'meta' : 'baileys', agentId: target.agentId ?? null, metaPhoneNumberId: target.metaPhoneNumberId ?? null, phone, jid: target.jid ?? null, channelPhone: target.channelPhone ?? null },
        // The SAME key the immediate send would have used: one message per inbound, whoever sends it.
        text, idempotencyKey: `sa_${d.id}_${forMessageId}`, automationKind: AGENT_PENDING_AUTOMATION_KIND,
        leadId: p.leadId ?? null, customerId: p.customerId ?? null, contactName: String(p.contactName || conv.subject || phone),
      });
      if (!res.ok) { await cancel('send-failed'); continue; }
      sent++;
      const ts = Timestamp.fromDate(now);
      const lead = p.leadId ? ((await db.collection('leads').doc(p.leadId).get().catch(() => null))?.data() ?? null) : null;
      await stampAgentSend({
        ctx, conversationId: d.id, conv, agentPatch: { pendingSend: admin.firestore.FieldValue.delete() }, now: ts, dateKey, text, sentId: res.id,
        leadId: p.leadId ?? null, lead, customerId: p.customerId ?? null, contactName: String(p.contactName || conv.subject || phone),
        conversationOwnerId: p.conversationOwnerId ?? conv.ownerId ?? null,
        collected: p.collected && typeof p.collected === 'object' ? p.collected : {}, qualified: p.qualified === true,
        intent: String(p.intent || 'question'), stage: String(p.stage || 'qualifying'),
      });
      await runRef.set({ decision: 'send', blockReason: null, sentAfterWait: true, replyText: text, sentAt: ts, updatedAt: ts }, { merge: true }).catch(() => {});
    }
    return { scanned: due?.size || 0, sent, cancelled, blocked: tally.counts };
  });
  return isLeaseHeld(r) ? r : (r as Record<string, unknown>);
}

// ── 5. Prospect TTL (platform-only; Places terms) ─────────────────────────────

export async function runSalesAgentProspectTtl(opts: { now?: Date } = {}): Promise<Record<string, unknown>> {
  const now = Timestamp.fromDate(opts.now || new Date());
  let deleted = 0, kept = 0, batches = 0;
  for (let i = 0; i < TTL_MAX_BATCHES; i++) {
    const snap = await db.collection('prospects').where('expiresAt', '<=', now).limit(TTL_BATCH).get();
    if (snap.empty) break;
    batches++;
    const batch = db.batch();
    let n = 0;
    for (const d of snap.docs) {
      const status = (d.data() as any)?.status;
      if (status === 'registered') {
        // A registered prospect is CRM data now — keep the row, stop re-reading it.
        batch.set(d.ref, { expiresAt: Timestamp.fromMillis(now.toMillis() + 365 * 86_400_000), updatedAt: now }, { merge: true });
        kept++;
      } else {
        batch.delete(d.ref); n++;
      }
    }
    await batch.commit();
    deleted += n;
    if (snap.size < TTL_BATCH) break;
  }
  return { deleted, kept, batches };
}
