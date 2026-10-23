/**
 * Cron job `crm-automations` — runs the CRM automation rules
 * (`crmAutomationRules`, built in CRM → Automatizime) against every tenant that has
 * at least one ACTIVE rule.
 *
 * Wiring: `api/cron/run.ts` (`?job=crm-automations`, manual runs scoped to the
 * caller's tenant) ← `vps/server.ts` (hourly). NOT part of `run-all`: an hourly
 * tick is what makes "pa pronar prej 2 orësh" mean two hours and not "sometime
 * tomorrow", and every firing is idempotent so the cadence is free to change.
 *
 * Laws:
 *  - Evaluation is the shared pure engine (`_crmAutomationEngine.ts`, byte-identical
 *    to `src/lib/crm/automationRules.ts`). This file only fetches facts and executes
 *    actions; it never decides on its own whether something fires.
 *  - The run document `crmAutomationRuns/{ruleId}_{entityId}_{fireKey}` is CREATED
 *    (never set) BEFORE the actions execute — the database refuses the second
 *    firing of the same occurrence, so two overlapping runs cannot double-notify,
 *    double-assign or double-email. ALREADY_EXISTS = skip silently.
 *  - Reads are per tenant (`businessId ==`, legacy `teamId ==` fallback); a tenant
 *    without active rules costs zero reads. Suspended tenants are skipped.
 *  - A rule that throws is PAUSED with its error, never left retrying forever.
 *  - A failed action never fails the run: each action records ok/detail on the run
 *    doc, and the rule's stats show it.
 */
import admin, { adminDb as db } from './_firebaseAdmin.js';
import { notifyUser, escapeHtml } from './_push.js';
import { sendBulkEmail } from './_mailer.js';
import { getTeamConfig } from './_tenantConfig.js';
import { makeWaAgentResolver } from './_waAgent.js';
import { sendBaileysText } from './_waSend.js';
import { toWaPhone } from './_waPhone.js';
import {
  AUTOMATION_RECIPES,
  MS_PER_DAY,
  buildRunsIndex,
  customerFacts,
  evaluateRule,
  leadFacts,
  overdueInvoiceFact,
  pickRoundRobin,
  renderAutomationText,
  ruleSendsWhatsapp,
  runDocId,
  toMs,
  type AutomationAction,
  type AutomationRule,
  type AutomationRun,
  type EntityFacts,
  type FireOccurrence,
  type OverdueInvoiceFact,
} from './_crmAutomationEngine.js';

// Referenced so the recipes stay in the api bundle's type graph (the UI seeds them).
void AUTOMATION_RECIPES;

type Doc = { id: string; data: Record<string, any> };

interface MemberRow {
  userId: string;
  role?: string;
  status?: string;
  canAccessCRM?: boolean;
  name?: string;
  displayName?: string;
  email?: string;
}

interface TenantContext {
  businessId: string;
  members: MemberRow[];
  managerIds: string[];
  salesPool: string[];
  nameOf: (uid?: string | null) => string;
  leads?: Doc[];
  customers?: Doc[];
  invoicesByCustomer?: Map<string, Doc[]>;
  projectTouchByCustomer?: Map<string, number>;
  /** Resolved once per tenant, only when a rule sends WhatsApp. */
  wa?: { agent: { id: string; teamId: string; connected: boolean } | null; vpsUrl: string; vpsSecret: string };
}

const MANAGER_ROLES = new Set(['Admin', 'Manager', 'Owner', 'SuperAdmin']);
const SALES_ROLES = new Set(['Sales', 'SalesAgent', 'Manager', 'Admin', 'Owner']);

async function scopedDocs(collection: string, businessId: string, teamIds: Set<string>): Promise<Doc[]> {
  const out: Doc[] = [];
  const seen = new Set<string>();
  const push = (snap: admin.firestore.QuerySnapshot) => {
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push({ id: d.id, data: d.data() });
    }
  };
  push(await db.collection(collection).where('businessId', '==', businessId).get());
  // Legacy rows stamped only with teamId (pre-businessId backfill).
  for (const tid of teamIds) {
    if (!tid || tid === businessId) continue;
    push(await db.collection(collection).where('teamId', '==', tid).get());
  }
  return out;
}

async function loadTenant(businessId: string, teamIds: Set<string>): Promise<TenantContext> {
  const memberDocs = await scopedDocs('teamMembers', businessId, teamIds);
  const members: MemberRow[] = memberDocs
    .map(d => d.data as MemberRow)
    .filter(m => m.userId && (m.status ?? 'Active') === 'Active');
  const uniq = new Map<string, MemberRow>();
  for (const m of members) if (!uniq.has(m.userId)) uniq.set(m.userId, m);
  const list = [...uniq.values()];
  const managerIds = list.filter(m => MANAGER_ROLES.has(m.role || '')).map(m => m.userId);
  let salesPool = list.filter(m => SALES_ROLES.has(m.role || '') && m.canAccessCRM !== false).map(m => m.userId);
  if (!salesPool.length) salesPool = list.filter(m => m.role !== 'Viewer').map(m => m.userId);
  const nameOf = (uid?: string | null): string => {
    if (!uid) return '';
    const m = uniq.get(uid);
    return m?.name || m?.displayName || m?.email || '';
  };
  return { businessId, members: list, managerIds, salesPool, nameOf };
}

function needsLeads(rules: AutomationRule[]): boolean { return rules.some(r => r.entity === 'lead'); }
function needsCustomers(rules: AutomationRule[]): boolean { return rules.some(r => r.entity === 'customer'); }
function needsInvoices(rules: AutomationRule[]): boolean { return rules.some(r => r.trigger.kind === 'customer_invoice_overdue'); }
function needsCustomerActivity(rules: AutomationRule[]): boolean {
  return rules.some(r => r.trigger.kind === 'customer_inactive' || r.conditions.some(c => c.field === 'daysSinceActivity'));
}

/** Fast mode looks back this far — wider than any tick gap, so a missed tick is caught up. */
const FAST_WINDOW_MS = 48 * 3_600_000;
/** Triggers the fast tick evaluates: "a record was born", the only ones a minute matters for. */
const FAST_TRIGGERS = new Set(['lead_created']);

async function recentLeadDocs(businessId: string, sinceMs: number): Promise<Doc[]> {
  const snap = await db.collection('leads')
    .where('businessId', '==', businessId)
    .where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(sinceMs))
    .get();
  return snap.docs.map(d => ({ id: d.id, data: d.data() }));
}

async function buildPopulation(ctx: TenantContext, rules: AutomationRule[], teamIds: Set<string>, nowMs: number, fast = false): Promise<{ leads: EntityFacts[]; customers: EntityFacts[] }> {
  const leads: EntityFacts[] = [];
  const customers: EntityFacts[] = [];
  if (needsLeads(rules)) {
    // Fast tick: only leads born in the window (index businessId+createdAt) —
    // the hourly full run still covers legacy teamId-only rows.
    ctx.leads = fast ? await recentLeadDocs(ctx.businessId, nowMs - FAST_WINDOW_MS) : await scopedDocs('leads', ctx.businessId, teamIds);
    for (const d of ctx.leads) leads.push(leadFacts(d.id, d.data, nowMs));
  }
  if (needsCustomers(rules)) {
    ctx.customers = await scopedDocs('customers', ctx.businessId, teamIds);
    const wantInvoices = needsInvoices(rules) || needsCustomerActivity(rules);
    const invoicesByCustomer = new Map<string, Doc[]>();
    const lastTouch = new Map<string, number>();
    if (wantInvoices) {
      for (const inv of await scopedDocs('invoices', ctx.businessId, teamIds)) {
        const cid = String(inv.data.customerId || '');
        if (!cid) continue;
        const arr = invoicesByCustomer.get(cid) || [];
        arr.push(inv);
        invoicesByCustomer.set(cid, arr);
        const t = Math.max(toMs(inv.data.createdAt) || 0, toMs(inv.data.paidAt) || 0, toMs(inv.data.updatedAt) || 0);
        if (t > (lastTouch.get(cid) || 0)) lastTouch.set(cid, t);
      }
    }
    if (needsCustomerActivity(rules)) {
      for (const p of await scopedDocs('projects', ctx.businessId, teamIds)) {
        const cid = String(p.data.customerId || '');
        if (!cid) continue;
        const t = Math.max(toMs(p.data.updatedAt) || 0, toMs(p.data.createdAt) || 0);
        if (t > (lastTouch.get(cid) || 0)) lastTouch.set(cid, t);
      }
    }
    ctx.invoicesByCustomer = invoicesByCustomer;
    ctx.projectTouchByCustomer = lastTouch;
    for (const d of ctx.customers) {
      const overdue: OverdueInvoiceFact[] = [];
      for (const inv of invoicesByCustomer.get(d.id) || []) {
        const f = overdueInvoiceFact(inv.id, inv.data, nowMs);
        if (f) overdue.push(f);
      }
      customers.push(customerFacts(d.id, d.data, { lastActivityMs: lastTouch.get(d.id) ?? null, overdueInvoices: overdue }, nowMs));
    }
  }
  return { leads, customers };
}

// ── Action execution ──────────────────────────────────────────────────────────

interface ActionOutcome { type: AutomationAction['type']; ok: boolean; detail?: string }

const entityRef = (f: EntityFacts) => db.collection(f.entity === 'lead' ? 'leads' : 'customers').doc(f.id);
const entityUrl = (f: EntityFacts) => f.entity === 'lead' ? `/app/crm?lead=${f.id}` : `/app/customers/${f.id}`;

async function logLeadActivity(f: EntityFacts, rule: AutomationRule, activityType: string, title: string, body?: string): Promise<void> {
  if (f.entity !== 'lead') return;
  const raw = (rule as any);
  await db.collection('leadActivities').add({
    leadId: f.id,
    teamId: raw.teamId || null,
    businessId: rule.businessId,
    type: activityType,
    title,
    body: body || `Rregulli “${rule.name}”.`,
    meta: { automationRuleId: rule.id },
    userId: null,
    userName: 'Automatizim',
    createdAt: admin.firestore.Timestamp.now(),
  }).catch(() => {});
}

function textToHtml(body: string): string {
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f2937">${escapeHtml(body).replace(/\r?\n/g, '<br/>')}</div>`;
}

async function executeAction(
  a: AutomationAction,
  f: EntityFacts,
  occ: FireOccurrence,
  rule: AutomationRule,
  ctx: TenantContext,
  raw: Record<string, any>,
  state: { ownerId: string | null; cursor: number; cursorDirty: boolean },
): Promise<ActionOutcome> {
  const now = admin.firestore.Timestamp.now();
  const render = (s: string) => renderAutomationText(s, f, { ownerName: ctx.nameOf(state.ownerId), days: occ.days, invoice: occ.invoice });
  const teamId: string | null = raw.teamId || rule.teamId || null;

  switch (a.type) {
    case 'assign': {
      let userId: string | null = null;
      if (a.mode === 'user') userId = a.userId || null;
      else {
        const pool = (a.userIds && a.userIds.length ? a.userIds : ctx.salesPool).filter(u => ctx.members.some(m => m.userId === u));
        const pick = pickRoundRobin(pool, state.cursor);
        userId = pick.userId;
        if (userId) { state.cursor = pick.nextCursor; state.cursorDirty = true; }
      }
      if (!userId) return { type: a.type, ok: false, detail: 'asnjë person në dispozicion' };
      await entityRef(f).update({ assignedToUserId: userId, updatedAt: now });
      state.ownerId = userId;
      await logLeadActivity(f, rule, 'assigned', `Caktuar automatikisht te ${ctx.nameOf(userId) || 'një koleg'}`);
      await notifyUser({
        userId, type: 'lead_assigned',
        title: f.entity === 'lead' ? `Lead i ri për ty: ${f.name}` : `Klient i caktuar: ${f.name}`,
        message: `Caktuar nga rregulli “${rule.name}”.`,
        actionUrl: entityUrl(f), actionLabel: 'Hape',
        businessId: rule.businessId, teamId,
      }).catch(() => {});
      return { type: a.type, ok: true, detail: ctx.nameOf(userId) || userId };
    }

    case 'create_task': {
      const assignee = a.assignTo === 'user' ? (a.userId || null) : (state.ownerId || ctx.managerIds[0] || null);
      const due = admin.firestore.Timestamp.fromDate(new Date(Date.now() + Math.max(0, Number(a.dueInDays) || 0) * MS_PER_DAY));
      const title = render(a.title).trim() || `Detyrë: ${f.name}`;
      await db.collection('tasks').add({
        title,
        description: render(a.description || ''),
        status: 'Todo',
        priority: a.priority || 'medium',
        assignedToUserId: assignee || '',
        createdByUserId: rule.createdByUserId || null,
        teamId,
        businessId: rule.businessId,
        startDate: due,
        endDate: due,
        dueDate: due,
        dueNotificationSent: false,
        // `customerId` on a task is the PORTAL-VISIBILITY switch (rules +
        // portal query key on it), so an internal "Klient i ftohtë — ofro
        // zbritje" task was delivered to that customer's browser. Link it
        // under a name the portal never reads.
        ...(f.entity === 'lead' ? { relatedLeadId: f.id } : { relatedCustomerId: f.id }),
        automationRuleId: rule.id,
        createdAt: now,
        updatedAt: now,
      });
      if (assignee) {
        await notifyUser({
          userId: assignee, type: 'task_assigned',
          title: `Detyrë e re: ${title}`,
          message: `Krijuar nga rregulli “${rule.name}” për ${f.name}.`,
          actionUrl: '/app/tasks', actionLabel: 'Shiko detyrat',
          businessId: rule.businessId, teamId,
        }).catch(() => {});
      }
      return { type: a.type, ok: true, detail: assignee ? (ctx.nameOf(assignee) || assignee) : 'pa përgjegjës (asnjë pronar/menaxher)' };
    }

    case 'notify': {
      let recipients: string[] = [];
      if (a.to === 'owner') recipients = state.ownerId ? [state.ownerId] : ctx.managerIds;
      else if (a.to === 'managers') recipients = ctx.managerIds;
      else recipients = (a.userIds || []);
      recipients = [...new Set(recipients.filter(Boolean))];
      if (!recipients.length) return { type: a.type, ok: false, detail: 'asnjë marrës' };
      const title = render(a.title).trim() || rule.name;
      const message = render(a.message || '');
      await Promise.allSettled(recipients.map(uid => notifyUser({
        userId: uid, type: 'crm_automation', title, message,
        actionUrl: entityUrl(f), actionLabel: f.entity === 'lead' ? 'Hap lead-in' : 'Hap klientin',
        businessId: rule.businessId, teamId,
        ...(f.entity === 'customer' ? { customerId: f.id } : {}),
      })));
      return { type: a.type, ok: true, detail: `${recipients.length} marrës` };
    }

    case 'add_tags': {
      const tags = (a.tags || []).map(t => String(t).trim()).filter(Boolean);
      if (!tags.length) return { type: a.type, ok: false, detail: 'pa etiketa' };
      await entityRef(f).update({ tags: admin.firestore.FieldValue.arrayUnion(...tags), updatedAt: now });
      return { type: a.type, ok: true, detail: tags.join(', ') };
    }

    case 'set_status': {
      if (f.entity !== 'lead') return { type: a.type, ok: false, detail: 'vetëm për lead' };
      if (!a.status || a.status === f.status) return { type: a.type, ok: false, detail: 'faza e pandryshuar' };
      const patch: Record<string, any> = { status: a.status, updatedAt: now, lastActivityAt: now };
      if (a.status === 'Lost' && !raw.lostReason) patch.lostReason = `Automatizim: ${rule.name}`;
      await entityRef(f).update(patch);
      await logLeadActivity(f, rule, 'status_changed', `Faza: ${f.status || '—'} → ${a.status}`);
      return { type: a.type, ok: true, detail: a.status };
    }

    case 'start_cadence': {
      if (f.entity !== 'lead') return { type: a.type, ok: false, detail: 'vetëm për lead' };
      if (raw.cadenceActive) return { type: a.type, ok: true, detail: 'ishte tashmë aktive' };
      await entityRef(f).update({ cadenceActive: true, cadenceStartedAt: now, cadenceStep: 0, updatedAt: now });
      return { type: a.type, ok: true };
    }

    case 'send_email': {
      if (!f.email) return { type: a.type, ok: false, detail: 'kontakti s’ka email' };
      const ts = await getTeamConfig(teamId || '');
      const subject = render(a.subject).trim();
      const html = textToHtml(render(a.body));
      const [res] = await sendBulkEmail([{ to: f.email, subject, html }], {
        emailProvider: ts.emailProvider as any,
        emailApiKey: ts.emailApiKey,
        emailFromEmail: ts.emailFromEmail,
        emailFromName: ts.emailFromName,
        emailMailgunDomain: ts.emailMailgunDomain,
        emailMailgunRegion: ts.emailMailgunRegion as any,
        emailSmtpHost: ts.emailSmtpHost,
        emailSmtpPort: ts.emailSmtpPort,
        emailSmtpUser: ts.emailSmtpUser,
        emailSmtpPass: ts.emailSmtpPass,
      });
      if (!res?.ok) return { type: a.type, ok: false, detail: res?.error || 'dërgimi dështoi' };
      // An automated email IS an outbound touch: stamp what the SLA/stale jobs read,
      // so they do not chase a lead we just wrote to.
      const touch: Record<string, any> = { lastActivityAt: now, updatedAt: now };
      if (f.entity === 'lead' && !raw.firstResponseAt) touch.firstResponseAt = now;
      await entityRef(f).update(touch).catch(() => {});
      await logLeadActivity(f, rule, 'email', `Email automatik: ${subject}`);
      return { type: a.type, ok: true, detail: f.email };
    }

    case 'send_whatsapp': {
      // Guards the engine already applied (opt-out, import, phone, window, cap)
      // are re-checked on the live doc: the population can be minutes old.
      if (raw.waOptOut === true) return { type: a.type, ok: false, detail: 'ka refuzuar WhatsApp' };
      const phone = toWaPhone(f.phone);
      if (!phone) return { type: a.type, ok: false, detail: 'pa numër të vlefshëm' };
      const wa = ctx.wa;
      if (!wa?.agent || !wa.vpsUrl) return { type: a.type, ok: false, detail: 'asnjë numër WhatsApp i lidhur' };
      const text = render(a.text).trim();
      if (!text) return { type: a.type, ok: false, detail: 'mesazh bosh' };
      const res = await sendBaileysText(wa.vpsUrl, wa.vpsSecret, wa.agent.id, phone, text, {
        teamId: wa.agent.teamId,
        leadId: f.entity === 'lead' ? f.id : null,
        customerId: f.entity === 'customer' ? f.id : null,
        leadName: f.name || null,
        automated: true,
        automationKind: 'automation',
        source: 'cron',
        businessId: rule.businessId,
        // One message per rule per record, ever — the VPS refuses a repeat for 24h
        // and the run doc refuses it forever.
        idempotencyKey: `crm_${rule.id}_${f.id}`,
      });
      if (!res.ok) return { type: a.type, ok: false, detail: res.error || `VPS ${res.status}` };
      // A real outbound touch: the dormancy/stale jobs must see it. NOT
      // firstResponseAt — an automatic intro is not a human answering the lead.
      await entityRef(f).update({ lastActivityAt: now, updatedAt: now }).catch(() => {});
      await logLeadActivity(f, rule, 'whatsapp', 'WhatsApp automatik', text.slice(0, 500));
      return { type: a.type, ok: true, detail: res.duplicate ? 'tashmë i dërguar (VPS)' : phone };
    }

    default:
      return { type: (a as any).type, ok: false, detail: 'veprim i panjohur' };
  }
}

// ── The job ───────────────────────────────────────────────────────────────────

export interface CrmAutomationRunOptions {
  /** Manual run: only this tenant. */
  businessId?: string | null;
  /** Manual run: only this rule (still must be active). */
  ruleId?: string | null;
  dryRun?: boolean;
  /** Every-few-minutes tick: only `lead_created` rules, only leads born in the last 48h. */
  fast?: boolean;
}

export async function runCrmAutomations(opts: CrmAutomationRunOptions = {}) {
  const nowMs = Date.now();
  const now = admin.firestore.Timestamp.now();

  let q: admin.firestore.Query = db.collection('crmAutomationRules').where('status', '==', 'active');
  if (opts.businessId) q = q.where('businessId', '==', opts.businessId);
  const snap = await q.get();
  let ruleDocs = snap.docs;
  if (opts.ruleId) ruleDocs = ruleDocs.filter(d => d.id === opts.ruleId);
  if (opts.fast) ruleDocs = ruleDocs.filter(d => FAST_TRIGGERS.has(String((d.data() as any)?.trigger?.kind || '')));
  if (!ruleDocs.length) return { rules: 0, tenants: 0, fired: 0, considered: 0 };

  const suspended = new Set<string>();
  try {
    const s = await db.collection('businesses').where('status', '==', 'suspended').get();
    s.docs.forEach(d => suspended.add(d.id));
  } catch { /* best effort */ }

  const byTenant = new Map<string, admin.firestore.QueryDocumentSnapshot[]>();
  for (const d of ruleDocs) {
    const bid = String((d.data() as any).businessId || '');
    if (!bid) { console.warn(`[CRON:crm-automations] rule ${d.id} has no businessId — skipped`); continue; }
    if (suspended.has(bid)) continue;
    const arr = byTenant.get(bid) || [];
    arr.push(d);
    byTenant.set(bid, arr);
  }

  let fired = 0, considered = 0, tenants = 0;

  for (const [businessId, docs] of byTenant) {
    tenants++;
    const rules: AutomationRule[] = docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    const teamIds = new Set<string>(rules.map(r => String(r.teamId || '')).filter(Boolean));
    let ctx: TenantContext;
    let population: { leads: EntityFacts[]; customers: EntityFacts[] };
    try {
      ctx = await loadTenant(businessId, teamIds);
      population = await buildPopulation(ctx, rules, teamIds, nowMs, !!opts.fast);
      if (rules.some(ruleSendsWhatsapp)) {
        const resolver = makeWaAgentResolver();
        const preferTeam = rules.find(ruleSendsWhatsapp)?.teamId || null;
        const agent = await resolver.resolve(businessId, preferTeam, null);
        const relay = agent ? await resolver.relayFor(preferTeam, agent.teamId) : { vpsUrl: '', vpsSecret: '' };
        ctx.wa = { agent: agent && agent.connected ? agent : null, ...relay };
      }
    } catch (err: any) {
      console.error(`[CRON:crm-automations] tenant ${businessId} load failed:`, err);
      continue;
    }
    const rawById = new Map<string, Record<string, any>>();
    for (const d of ctx.leads || []) rawById.set(`lead:${d.id}`, d.data);
    for (const d of ctx.customers || []) rawById.set(`customer:${d.id}`, d.data);

    for (const doc of docs) {
      const rule = rules.find(r => r.id === doc.id)!;
      try {
        // Fast tick: runs of the window only (index businessId+ruleId+firedAt) — a
        // lead born in the window can only have fired inside it, and the daily cap
        // needs 24h. The run doc's create() stays the hard idempotency guarantee.
        // A missing index must not PAUSE the rule (this block's catch does that) —
        // fall back to the full per-rule read the hourly run uses.
        const allRuns = () => db.collection('crmAutomationRuns').where('ruleId', '==', rule.id).get();
        const runsSnap = opts.fast
          ? await db.collection('crmAutomationRuns')
            .where('businessId', '==', businessId).where('ruleId', '==', rule.id)
            .where('firedAt', '>=', admin.firestore.Timestamp.fromMillis(nowMs - FAST_WINDOW_MS)).get()
            .catch((err: any) => { console.warn(`[CRON:crm-automations] fast runs query failed (${err?.code}), full read`); return allRuns(); })
          : await allRuns();
        const runs = buildRunsIndex(runsSnap.docs.map(d => d.data() as any));
        const pop = rule.entity === 'lead' ? population.leads : population.customers;
        const result = evaluateRule(rule, pop, { ruleCreatedAtMs: toMs(rule.createdAt), runs }, nowMs);
        considered += result.considered;
        if (ruleSendsWhatsapp(rule) && !ctx.wa?.agent && result.fires.length) {
          // No connected number: claiming the run doc now would burn the lead's
          // one and only intro. Hold every due record for the next tick.
          result.blocked['channel-down'] = (result.blocked['channel-down'] || 0) + result.fires.length;
          result.fires = [];
        }

        let ruleFired = 0;
        const state = { ownerId: null as string | null, cursor: Number(rule.roundRobinCursor) || 0, cursorDirty: false };

        for (const { facts, occurrence } of result.fires) {
          if (opts.dryRun) { ruleFired++; continue; }
          const runRef = db.collection('crmAutomationRuns').doc(runDocId(rule.id, facts.id, occurrence.key));
          const runDoc: Omit<AutomationRun, 'id'> = {
            businessId,
            ruleId: rule.id,
            ruleName: rule.name,
            entity: facts.entity,
            entityId: facts.id,
            entityName: facts.name,
            fireKey: occurrence.key,
            firedAt: now,
            results: [],
          };
          try {
            await runRef.create({ ...runDoc, teamId: rule.teamId || null });
          } catch (err: any) {
            if (err?.code === 6 || /ALREADY_EXISTS/i.test(String(err?.message))) continue; // someone else fired it
            throw err;
          }
          state.ownerId = facts.assignedToUserId;
          const raw = rawById.get(`${facts.entity}:${facts.id}`) || {};
          const results: ActionOutcome[] = [];
          for (const a of rule.actions || []) {
            try {
              results.push(await executeAction(a, facts, occurrence, rule, ctx, raw, state));
            } catch (err: any) {
              results.push({ type: a.type, ok: false, detail: err?.message || 'gabim' });
            }
          }
          await runRef.update({ results }).catch(() => {});
          ruleFired++;
        }

        fired += ruleFired;
        if (!opts.dryRun && (!opts.fast || ruleFired > 0 || Object.keys(result.blocked).some(k => k === 'channel-down' || k === 'daily-cap'))) {
          await doc.ref.update({
            lastRunAt: now,
            lastRunConsidered: result.considered,
            lastRunFired: ruleFired,
            lastRunBlocked: result.blocked,
            lastRunFailedConditions: result.failedConditions,
            totalFired: admin.firestore.FieldValue.increment(ruleFired),
            ...(state.cursorDirty ? { roundRobinCursor: state.cursor } : {}),
            error: null,
          });
        }
        if (ruleFired) console.log(`[CRON:crm-automations] ${rule.name}: ${ruleFired} ndezur nga ${result.considered} (${businessId})`);
      } catch (err: any) {
        console.error(`[CRON:crm-automations] rule ${rule.id} failed:`, err);
        if (!opts.dryRun) {
          await doc.ref.update({ status: 'paused', error: err?.message || 'Gabim', lastRunAt: now }).catch(() => {});
        }
      }
    }
  }

  return { rules: ruleDocs.length, tenants, fired, considered, dryRun: !!opts.dryRun };
}
