import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin, { adminDb as db, Timestamp } from './_firebaseAdmin.js';
import {
  authenticate, activeMembership, businessIdOfTeam, hasAdminRole, hasManagerRole, isBusinessOwner, isPortalOnlyToken,
  type CallerIdentity,
} from './_callerIdentity.js';
import { checkPersistentRateLimit } from './_rateLimit.js';
import { getTeamConfig } from './_tenantConfig.js';
import { generateChatWith, resolveAiConfig, type ChatMsg, type ResolvedAiConfig } from './_aiProvider.js';
import { classifyAiError } from './_aiErrors.js';
import { notifyUser } from './_push.js';
import { managerIdsForBusiness } from './_staffRecipients.js';
import { sendBaileysText, sendMetaText } from './_waSend.js';
import { toWaPhone } from './_waPhone.js';
import { findCustomerForContact, findLeadForContact } from './_contactIdentity.js';
import { placesKeyProbe, resolvePlacesKey } from './_placesClient.js';
import {
  SALES_AGENT_AVATAR_PATH, SALES_AGENT_BLOCK_LABELS, SALES_AGENT_LIMITS, SALES_AGENT_TITLE, SALES_AGENT_UID,
  agentGateReason, allowedIntentsForAutonomy, buildLeadSummary, buildSalesAgentPromptParts, buildSalesDigest, decideDelivery,
  detectHandoffTrigger, ensureDisclosure, handoffAutoResumeDue, inWindow, isSupersededInbound, leadAgentScore, localParts, mergeCollected, monthKeyOf, nextStage,
  shouldNotifyDraft,
  parseAgentOutput, qualificationProgress, resolveSalesAgentSettings, salesAgentProfileDocId, salesAgentRunId,
  type AgentModelOutput, type AgentStage, type ConversationAgentLike, type DeliveryDecision, type DeliveryMode,
  type HandoffReason, type SalesAgentAutonomy, type SalesAgentBlockReason, type SalesAgentSettings, type SalesDigestFacts,
  type SalesFacts, type KnowledgeFact, type ServiceFact,
} from './_salesAgentCore.js';
import { SEARCH_BLOCK_LABELS, buildCallScript, estimateSearchRequests, prospectServiceLine, searchBlockReason, type SalesAgentPersona } from './_salesAgentProspecting.js';

/**
 * Ana — the virtual sales agent. Server side.
 *
 *   POST /api/sales-agent  (?type=sales-agent)   body.action:
 *     enable | disable               Admin/owner: switch the module on/off for a team (profile doc, no Auth user).
 *     settings.test                  Verify the AI key + the Places key (free IDs-only probe).
 *     search.create | search.cancel  Google Maps prospecting searches (queued; the cron runs them).
 *     prospect.register | prospect.reject
 *     conversation.handoff | conversation.resume
 *     conversation.simulate          Sandbox: the real prompt + facts, no writes except aiUsageLogs.
 *     reply.draft                    "Rigjenero" — a draft on the conversation, never a send.
 *     digest.preview                 Yesterday's digest text.
 *
 *   runSalesAgentOnInbound()  — called by api/_waInbound.ts step 8 when the module owns WhatsApp.
 *
 * Laws (workspace/SALES_AGENT_PLAN.md §1): the core (api/_salesAgentCore.ts) decides,
 * this file fetches and executes; every non-action is a named reason; a run doc is
 * `create()`d BEFORE anything is sent; ids from the body are never trusted — every
 * record is loaded and its businessId compared with the caller's claims; nothing is
 * stamped "sent" before the channel accepted it.
 */

const TZ = 'Europe/Tirane';
const HISTORY_LIMIT = SALES_AGENT_LIMITS.historyLimit;
const REPLY_TO_AUTOMATED_MS = 72 * 3_600_000;
const SIMULATE_PER_HOUR = 20;
const DRAFT_PER_HOUR = 30;
const SEARCH_PER_HOUR = 10;
const HANDOFF_LINE = 'Ju lidh me një koleg, do t\'ju përgjigjet sa më shpejt.';
const AGENT_AUTOMATION_KIND = 'sales-agent';
const WEEKDAYS_SQ = ['e diel', 'e hënë', 'e martë', 'e mërkurë', 'e enjte', 'e premte', 'e shtunë'];
const MONTHS_SQ = ['janar', 'shkurt', 'mars', 'prill', 'maj', 'qershor', 'korrik', 'gusht', 'shtator', 'tetor', 'nëntor', 'dhjetor'];

// ── Helpers ───────────────────────────────────────────────────────────────────

const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function toMs(v: unknown): number {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const o = v as { toMillis?: () => number; toDate?: () => Date; seconds?: number };
  if (typeof o.toMillis === 'function') return o.toMillis();
  if (typeof o.toDate === 'function') return o.toDate().getTime();
  if (typeof o.seconds === 'number') return o.seconds * 1000;
  const t = new Date(v as any).getTime();
  return Number.isFinite(t) ? t : 0;
}
const toDate = (v: unknown): Date | null => { const ms = toMs(v); return ms ? new Date(ms) : null; };

const isAlreadyExists = (err: any): boolean =>
  err?.code === 6 || err?.code === 'already-exists' || /ALREADY_EXISTS/i.test(String(err?.message || ''));

async function readJsonBody(req: VercelRequest): Promise<Record<string, any> | null> {
  let body: any = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return null; } }
  return body && typeof body === 'object' ? body : {};
}

function zoneOffsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(at).find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
}

/** UTC instant of `HH:MM` local on a `YYYY-MM-DD` key. */
function zonedTimeMs(dateKey: string, hour: number, minute = 0): number {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, hour, minute);
  return guess - zoneOffsetMinutes(new Date(guess)) * 60_000;
}

function shiftDateKey(dateKey: string, days: number): string {
  const [y, mo, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

/** "e hënë, 3 nëntor 2026, 10:15" */
export function nowLabelFor(now: Date): string {
  const lp = localParts(now, TZ);
  const [y, m, d] = lp.date.split('-').map(Number);
  return `${WEEKDAYS_SQ[lp.weekday]}, ${d} ${MONTHS_SQ[m - 1]} ${y}, ${lp.hhmm}`;
}

const platformMaxAutonomy = (): SalesAgentAutonomy => {
  const n = Number(process.env.SALES_AGENT_MAX_AUTONOMY);
  return (n === 0 || n === 1 || n === 2 || n === 3) ? (n as SalesAgentAutonomy) : 2;
};

// ── Tenant context ────────────────────────────────────────────────────────────

export interface AgentCtx {
  teamId: string;
  businessId: string;
  tenantName: string;
  tenantStatus: string | null;
  /** Raw team config (teamSettings + secrets) — never sent to a browser. */
  cfg: Record<string, any>;
  settings: SalesAgentSettings;
}

export async function loadAgentCtx(teamId: string, businessIdHint?: string | null): Promise<AgentCtx | null> {
  const [teamSnap, cfg] = await Promise.all([
    db.collection('teams').doc(teamId).get(),
    getTeamConfig(teamId).catch(() => ({} as Record<string, any>)),
  ]);
  const team = teamSnap.exists ? (teamSnap.data() as any) : null;
  const businessId = (typeof team?.businessId === 'string' && team.businessId) || businessIdHint || (await businessIdOfTeam(teamId).catch(() => ''));
  if (!businessId) return null;
  const biz = await db.collection('businesses').doc(businessId).get().catch(() => null);
  const bizData = biz?.exists ? (biz.data() as any) : null;
  const settings = resolveSalesAgentSettings(cfg?.salesAgent, { maxAutonomy: platformMaxAutonomy() });
  if (!settings.persona.businessName) settings.persona.businessName = str(bizData?.name) || str(team?.name) || '';
  return {
    teamId, businessId,
    tenantName: str(bizData?.name) || str(team?.name) || 'biznesi',
    tenantStatus: typeof bizData?.status === 'string' ? bizData.status : null,
    cfg: cfg || {},
    settings,
  };
}

/** Facts the model may state — the ONLY source of figures in a reply (law 4). */
export async function loadSalesFacts(ctx: AgentCtx): Promise<SalesFacts> {
  const services: ServiceFact[] = [];
  try {
    // Same scope as /app/services (business-wide, skipTeamFilter), plus legacy rows that
    // carry only the team id. The catalogue is read on EVERY reply — no cache — so an
    // edit in Shërbimet reaches Ana on the next message.
    const [byBiz, byTeam] = await Promise.all([
      db.collection('services').where('businessId', '==', ctx.businessId).limit(80).get(),
      db.collection('services').where('teamId', '==', ctx.teamId).limit(80).get(),
    ]);
    const seen = new Set<string>();
    [...byBiz.docs, ...byTeam.docs].forEach((d) => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      const s = d.data() as any;
      if (s?.isActive === false || s?.active === false) return;
      // ServicesView writes `title`; older/imported rows use `name`.
      const name = str(s?.name, 120) || str(s?.title, 120);
      if (!name) return;
      const features = Array.isArray(s?.features) ? s.features.map((x: unknown) => str(x, 80)).filter(Boolean).slice(0, 6) : null;
      services.push({
        name,
        category: str(s?.category, 60) || null,
        price: typeof s?.price === 'number' && Number.isFinite(s.price) ? s.price : null,
        currency: str(s?.currency, 6) || null,
        unit: str(s?.billingPeriod || s?.unit, 30) || null,
        description: str(s?.description, 200) || null,
        duration: str(s?.duration, 60) || null,
        features: features && features.length ? features : null,
      });
    });
  } catch (err) { console.error('[salesAgent] services read failed', err); }
  const knowledge: KnowledgeFact[] = [];
  try {
    const snap = await db.collection('salesKnowledge').where('businessId', '==', ctx.businessId).limit(SALES_AGENT_LIMITS.knowledgeMaxItems).get();
    snap.docs.forEach((d) => {
      const k = d.data() as any;
      if (k?.enabled === false) return;
      const kind = ['faq', 'objection', 'policy', 'service-note'].includes(k?.kind) ? k.kind : 'faq';
      const question = str(k?.question, 300); const answer = str(k?.answer, 600);
      if (question && answer) knowledge.push({ kind, question, answer });
    });
  } catch (err) { console.error('[salesAgent] salesKnowledge read failed', err); }
  const s = ctx.settings;
  return {
    businessName: s.persona.businessName || ctx.tenantName,
    officeHours: `Hën–Pre ${s.officeFrom}–${s.officeTo}`,
    services,
    knowledge,
    about: str(ctx.cfg?.waAiContext, 1200),
  };
}

// ── Usage counters (ONE doc per tenant per day; the digest reads it, no index) ──

const usageDayRef = (bid: string, dateKey: string) => db.collection('salesAgentUsage').doc(`${bid}_${dateKey}`);
const usageMonthRef = (bid: string, dateKey: string) => db.collection('salesAgentUsage').doc(`${bid}_${monthKeyOf(dateKey)}`);

export async function bumpUsage(bid: string, teamId: string, dateKey: string, fields: Record<string, number>, extra: Record<string, any> = {}): Promise<void> {
  const patch: Record<string, any> = { businessId: bid, teamId, date: dateKey, updatedAt: Timestamp.now(), ...extra };
  for (const [k, v] of Object.entries(fields)) patch[k] = admin.firestore.FieldValue.increment(v);
  await usageDayRef(bid, dateKey).set(patch, { merge: true }).catch((e) => console.error('[salesAgent] usage bump failed', e));
}

export async function bumpMonthlyUsage(bid: string, teamId: string, dateKey: string, fields: Record<string, number>): Promise<void> {
  const patch: Record<string, any> = { businessId: bid, teamId, month: monthKeyOf(dateKey), updatedAt: Timestamp.now() };
  for (const [k, v] of Object.entries(fields)) patch[k] = admin.firestore.FieldValue.increment(v);
  await usageMonthRef(bid, dateKey).set(patch, { merge: true }).catch((e) => console.error('[salesAgent] monthly usage bump failed', e));
}

export async function readUsage(bid: string, dateKey: string): Promise<Record<string, any>> {
  const s = await usageDayRef(bid, dateKey).get().catch(() => null);
  return (s?.exists ? (s.data() as any) : {}) || {};
}

export async function readMonthlyUsage(bid: string, dateKey: string): Promise<Record<string, any>> {
  const s = await usageMonthRef(bid, dateKey).get().catch(() => null);
  return (s?.exists ? (s.data() as any) : {}) || {};
}

// ── Conversation state ────────────────────────────────────────────────────────

export function agentStateOf(conv: any): ConversationAgentLike & { nudgesSent: number; lastNudgeAt: Date | null; handoffAt: Date | null; handoffReason: string | null; resumedAt: Date | null; handoffNotifiedAt: Date | null } | null {
  const a = conv?.agent;
  if (!a || typeof a !== 'object') return null;
  const stages: AgentStage[] = ['greeting', 'qualifying', 'proposing', 'booking', 'handoff', 'closed'];
  return {
    active: a.active !== false,
    stage: stages.includes(a.stage) ? a.stage : 'greeting',
    collected: a.collected && typeof a.collected === 'object' ? a.collected : {},
    turns: Number(a.turns) || 0,
    turnsWithoutProgress: Number(a.turnsWithoutProgress) || 0,
    lastReplyAt: toDate(a.lastReplyAt),
    lastDraftAt: toDate(a.lastDraftAt),
    nudgesSent: Number(a.nudgesSent) || 0,
    lastNudgeAt: toDate(a.lastNudgeAt),
    handoffAt: toDate(a.handoffAt),
    handoffReason: typeof a.handoffReason === 'string' ? a.handoffReason : null,
    resumedAt: toDate(a.resumedAt),
    handoffNotifiedAt: toDate(a.handoffNotifiedAt),
  };
}

interface ThreadFacts {
  history: ChatMsg[];
  /** ms of the newest outbound row written by a PERSON (not automated). */
  lastHumanOutboundMs: number | null;
  /** The newest outbound row is an automation that is NOT the agent, within 72h. */
  replyToAutomated: boolean;
  agentSpokeBefore: boolean;
}

/** One read: the thread's newest rows (oldest→newest for the prompt) + the facts the gate needs. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** ms of the newest outbound row a PERSON wrote in this thread (automations excluded). */
export async function lastHumanOutboundMs(teamId: string, phone: string): Promise<number | null> {
  return (await loadThreadFacts(teamId, phone, new Date(), '')).lastHumanOutboundMs;
}

/** STOP/NDALO is stamped on the lead and/or customer (per phone, by the inbound handler). */
export async function contactOptedOut(leadId: string | null, customerId: string | null): Promise<boolean> {
  const [l, c] = await Promise.all([
    leadId ? db.collection('leads').doc(leadId).get().catch(() => null) : Promise.resolve(null),
    customerId ? db.collection('customers').doc(customerId).get().catch(() => null) : Promise.resolve(null),
  ]);
  return (l?.data() as any)?.waOptOut === true || (c?.data() as any)?.waOptOut === true;
}

/** Did a newer TEXT message from the client land on this conversation after `waMessageId`? */
async function supersededNow(conversationId: string, waMessageId: string): Promise<boolean> {
  const snap = await db.collection('conversations').doc(conversationId).get().catch(() => null);
  const c = (snap?.data() as any) || {};
  return isSupersededInbound({ waMessageId, lastInboundMessageId: c.lastInboundMessageId ?? null, lastInboundKind: c.lastInboundKind ?? null });
}

async function loadThreadFacts(teamId: string, phone: string, now: Date, currentText: string): Promise<ThreadFacts> {
  let rows: any[] = [];
  try {
    const snap = await db.collection('whatsappMessages')
      .where('teamId', '==', teamId).where('phone', '==', phone)
      .orderBy('createdAt', 'desc').limit(HISTORY_LIMIT + 6).get();
    rows = snap.docs.map((d) => d.data() as any);
  } catch (err) { console.error('[salesAgent] thread read failed', err); }
  const isAgentRow = (r: any) => typeof r?.automationKind === 'string' && r.automationKind.startsWith(AGENT_AUTOMATION_KIND);
  const isAutomated = (r: any) => r?.automated === true || (typeof r?.automationKind === 'string' && !!r.automationKind) || !!r?.campaignId || !!r?.broadcastId || r?.isCampaign === true || r?.isAutoReply === true;
  const newestOut = rows.find((r) => r.direction === 'outbound');
  const newestHuman = rows.find((r) => r.direction === 'outbound' && !isAutomated(r));
  const replyToAutomated = !!newestOut && isAutomated(newestOut) && !isAgentRow(newestOut) && now.getTime() - toMs(newestOut.createdAt) < REPLY_TO_AUTOMATED_MS;
  const history: ChatMsg[] = rows
    .filter((r) => typeof r.message === 'string' && r.message.trim() && r.status !== 'failed')
    .slice(0, HISTORY_LIMIT)
    .reverse()
    .map((r) => ({ role: r.direction === 'inbound' ? 'user' as const : 'assistant' as const, content: String(r.message).trim().slice(0, 800) }));
  // The current inbound must be the last USER turn (the channel may not have written it yet).
  const last = history[history.length - 1];
  if (!last || last.role !== 'user' || last.content !== currentText.trim().slice(0, 800)) history.push({ role: 'user', content: currentText.trim().slice(0, 800) || '…' });
  // Providers want the first turn to be a user turn.
  while (history.length && history[0].role !== 'user') history.shift();
  return {
    history,
    lastHumanOutboundMs: newestHuman ? toMs(newestHuman.createdAt) || null : null,
    replyToAutomated,
    agentSpokeBefore: rows.some(isAgentRow),
  };
}

// ── The decision (shared by inbound, reply.draft and simulate) ────────────────

export interface DecideInput {
  ctx: AgentCtx;
  aiCfg: ResolvedAiConfig;
  facts: SalesFacts;
  channel: 'whatsapp' | 'email' | 'portal' | 'landingForm';
  contactName: string;
  contactKind: 'lead' | 'customer' | 'unknown';
  leadStatus?: string | null;
  agentState: ConversationAgentLike | null;
  history: ChatMsg[];
  clientText: string;
  isFirstAgentMessage: boolean;
  minutesSinceHumanReply: number | null;
  now: Date;
  /** Skip the model (a deterministic trigger already decided). */
  trigger: HandoffReason | null;
}

export interface DecideResult {
  output: AgentModelOutput;
  decision: DeliveryDecision;
  stage: AgentStage;
  collected: Record<string, string>;
  progressed: boolean;
  qualified: boolean;
  model: string | null;
  provider: string | null;
  tokens: number;
  /** Anthropic prompt caching (0 on other providers). */
  cacheReadTokens: number;
  cacheWriteTokens: number;
  prompt: string;
  error: string | null;
}

export async function decideReply(i: DecideInput): Promise<DecideResult> {
  const s = i.ctx.settings;
  const prevCollected = i.agentState?.collected || {};
  const stage: AgentStage = i.agentState?.stage || 'greeting';
  const promptParts = buildSalesAgentPromptParts({
    settings: s, facts: i.facts, contactName: i.contactName, contactKind: i.contactKind, leadStatus: i.leadStatus ?? null,
    stage, collected: prevCollected, channel: i.channel, nowLabel: nowLabelFor(i.now), isFirstAgentMessage: i.isFirstAgentMessage,
  });
  const prompt = `${promptParts.stable}\n\n${promptParts.dynamic}`;
  let output: AgentModelOutput;
  let model: string | null = null; let provider: string | null = null; let tokens = 0; let cacheReadTokens = 0; let cacheWriteTokens = 0; let error: string | null = null;
  if (i.trigger) {
    // A deterministic trigger needs no model call: the decision is a handoff whatever the model would say.
    output = { reply: '', intent: i.trigger === 'complaint' ? 'complaint' : i.trigger === 'asked-for-human' ? 'human' : 'other', confidence: 1, collected: {}, priceFromFacts: false, handoff: i.trigger, language: 'sq' };
  } else {
    try {
      const r = await generateChatWith(i.aiCfg, promptParts, i.history, { maxTokens: 500, temperature: 0.3 });
      output = parseAgentOutput(r.reply);
      model = r.model; provider = r.provider; tokens = r.tokensUsed || 0;
      cacheReadTokens = r.cacheReadTokens || 0; cacheWriteTokens = r.cacheWriteTokens || 0;
    } catch (err) {
      const c = classifyAiError(err);
      error = `${c.code}: ${String((err as Error)?.message || err).slice(0, 200)}`;
      output = { reply: '', intent: 'other', confidence: 0, collected: {}, priceFromFacts: false, handoff: null, language: 'sq' };
    }
  }
  const collected = mergeCollected(prevCollected, output.collected);
  const progressed = Object.keys(collected).length > Object.keys(prevCollected).length;
  const lp = localParts(i.now, TZ);
  const insideOfficeHours = lp.weekday >= 1 && lp.weekday <= 5 && inWindow(lp.hhmm, s.officeFrom, s.officeTo);
  const decision: DeliveryDecision = error
    ? { mode: 'draft', blockReason: 'error', handoffReason: null }
    : decideDelivery({
      settings: s, output, trigger: i.trigger, clientText: i.clientText, insideOfficeHours,
      minutesSinceHumanReply: i.minutesSinceHumanReply,
      turnsWithoutProgress: i.agentState?.turnsWithoutProgress || 0, progressed,
    });
  const progress = qualificationProgress(collected, s.qualificationFields);
  const next = nextStage(stage, { decision, intent: output.intent, progress, autonomy: s.autonomy });
  return { output, decision, stage: next, collected, progressed, qualified: progress.qualified, model, provider, tokens, cacheReadTokens, cacheWriteTokens, prompt, error };
}

// ── Sending as the agent ──────────────────────────────────────────────────────

export interface AgentSendTarget {
  channel: 'baileys' | 'meta';
  agentId: string | null;
  metaPhoneNumberId: string | null;
  phone: string;
  jid?: string | null;
  channelPhone?: string | null;
}

export interface AgentSendArgs {
  ctx: AgentCtx;
  target: AgentSendTarget;
  text: string;
  idempotencyKey: string;
  automationKind: string;
  leadId: string | null;
  customerId: string | null;
  contactName: string;
}

function metaChannelFor(cfg: Record<string, any>, phoneNumberId?: string | null) {
  const channels: any[] = Array.isArray(cfg.metaChannels) ? cfg.metaChannels : [];
  const ch = (phoneNumberId && channels.find((c) => c?.phoneNumberId === phoneNumberId)) || null;
  if (ch?.accessToken && ch?.phoneNumberId) return { phoneNumberId: String(ch.phoneNumberId), accessToken: String(ch.accessToken), phone: String(ch.phone || '') };
  if (cfg.metaAccessToken && cfg.metaPhoneNumberId && (!phoneNumberId || cfg.metaPhoneNumberId === phoneNumberId)) {
    return { phoneNumberId: String(cfg.metaPhoneNumberId), accessToken: String(cfg.metaAccessToken), phone: '' };
  }
  return null;
}

export function baileysCoordsOf(cfg: Record<string, any>): { vpsUrl: string; vpsSecret: string } {
  return {
    vpsUrl: String(cfg.whatsappVpsUrl || process.env.WHATSAPP_VPS_URL || ''),
    vpsSecret: String(cfg.whatsappVpsSecret || process.env.WHATSAPP_VPS_SECRET || ''),
  };
}

/** Sends one WhatsApp text AS the agent. Resolves only when the channel ACCEPTED it. */
export async function sendAgentWaText(a: AgentSendArgs): Promise<{ ok: boolean; id: string | null; error: string | null; permanent: boolean }> {
  const { ctx, target } = a;
  const now = Timestamp.now();
  if (target.channel === 'meta') {
    const ch = metaChannelFor(ctx.cfg, target.metaPhoneNumberId);
    if (!ch) return { ok: false, id: null, error: 'no-channel', permanent: false };
    try {
      const id = await sendMetaText(ch, target.phone, a.text);
      if (!id) return { ok: false, id: null, error: 'meta-send-failed', permanent: false };
      await db.collection('whatsappMessages').doc(id).set({
        phone: target.phone, jid: `${target.phone}@s.whatsapp.net`, direction: 'outbound', message: a.text, waMessageId: id,
        leadId: a.leadId, customerId: a.customerId, leadName: a.contactName, teamId: ctx.teamId, businessId: ctx.businessId,
        status: 'sent', channel: 'meta', channelPhone: target.channelPhone || toWaPhone(ch.phone), metaPhoneNumberId: ch.phoneNumberId,
        isLid: false, sentByUid: null, automated: true, automationKind: a.automationKind, source: AGENT_AUTOMATION_KIND,
        senderId: SALES_AGENT_UID, createdAt: now, updatedAt: now,
      }, { merge: true });
      return { ok: true, id, error: null, permanent: false };
    } catch (err: any) {
      return { ok: false, id: null, error: String(err?.message || err).slice(0, 200), permanent: false };
    }
  }
  const { vpsUrl, vpsSecret } = baileysCoordsOf(ctx.cfg);
  if (!vpsUrl || !vpsSecret) return { ok: false, id: null, error: 'no-channel', permanent: false };
  const r = await sendBaileysText(vpsUrl, vpsSecret, target.agentId, target.phone, a.text, {
    teamId: ctx.teamId, leadId: a.leadId, leadName: a.contactName, jid: target.jid || undefined, sentByUid: null,
    automated: true, automationKind: a.automationKind, source: AGENT_AUTOMATION_KIND, idempotencyKey: a.idempotencyKey,
    customerId: a.customerId || undefined, businessId: ctx.businessId,
  });
  if (r.ok) return { ok: true, id: r.id, error: null, permanent: false };
  const permanent = r.status === 422 || /not-on-whatsapp/i.test(String(r.error || ''));
  return { ok: false, id: r.id, error: r.error || `VPS ${r.status}`, permanent };
}

// ── The inbound hook ──────────────────────────────────────────────────────────

export interface InboundHookArgs {
  teamId: string;
  businessId: string;
  cfg: Record<string, any>;
  event: {
    channel: 'baileys' | 'meta';
    agentId?: string | null;
    metaPhoneNumberId?: string | null;
    phone: string;
    jid: string;
    channelPhone?: string | null;
    text: string;
    kind: 'text' | 'media' | 'reaction' | 'system';
    waMessageId: string;
  };
  conversationId: string;
  leadId: string | null;
  customerId: string | null;
  lead: any;
  customer: any;
  contactName: string;
  optedOut: boolean;
  lidOnly: boolean;
  conversationOwnerId?: string | null;
}

export type SalesAgentInboundSummary =
  | { decision: DeliveryMode; blockReason: SalesAgentBlockReason | null; handoffReason: HandoffReason | null; intent: string | null; model: string | null }
  | { blocked: SalesAgentBlockReason };

/** Never throws. Called by api/_waInbound.ts after the contact + conversation are stamped. */
export async function runSalesAgentOnInbound(a: InboundHookArgs): Promise<SalesAgentInboundSummary> {
  const now = new Date();
  const dateKey = localParts(now, TZ).date;
  const runRef = db.collection('salesAgentRuns').doc(salesAgentRunId(a.businessId, 'reply', a.conversationId, a.event.waMessageId));
  const tally = async (reason: string) => bumpUsage(a.businessId, a.teamId, dateKey, { [`blocked.${reason}`]: 1 }).catch(() => {});
  try {
    const ctx = await loadAgentCtx(a.teamId, a.businessId);
    if (!ctx) return { blocked: 'error' };
    const s = ctx.settings;
    if (!s.enabled) return { blocked: 'module-off' };
    const convRef = db.collection('conversations').doc(a.conversationId);
    const recordGate = (reason: SalesAgentBlockReason) =>
      db.collection('salesAgentRuns').doc(`${runRef.id}_gate`).set({ businessId: a.businessId, teamId: a.teamId, kind: 'reply', entityId: a.conversationId, decision: 'blocked', blockReason: reason, createdAt: Timestamp.now() }, { merge: true }).catch(() => {});
    // Settle: a client who writes three lines in five seconds gets ONE answer, to the
    // last line (its history carries the other two). This replaced the old 60s "burst"
    // gate, which simply threw away any message that came soon after Ana had spoken.
    if (a.event.kind === 'text') {
      await sleep(SALES_AGENT_LIMITS.settleMs);
      if (await supersededNow(a.conversationId, a.event.waMessageId)) {
        await tally('superseded');
        await recordGate('superseded');
        return { blocked: 'superseded' };
      }
    }
    const [convSnap, aiCfg, usage, thread] = await Promise.all([
      convRef.get(),
      resolveAiConfig(a.teamId),
      readUsage(a.businessId, dateKey),
      a.lidOnly ? Promise.resolve<ThreadFacts>({ history: [{ role: 'user', content: a.event.text || '…' }], lastHumanOutboundMs: null, replyToAutomated: false, agentSpokeBefore: false }) : loadThreadFacts(a.teamId, a.event.phone, now, a.event.text),
    ]);
    const conv = (convSnap.data() as any) || {};
    let agentState = agentStateOf(conv);
    // A handoff nobody answered for `handoffAutoResumeHours` (opt-in) goes back to Ana.
    const resumable = !!agentState && agentState.active === false && agentState.stage === 'handoff'
      && handoffAutoResumeDue({ autoResumeHours: s.handoffAutoResumeHours, handoffAt: agentState.handoffAt, lastHumanOutboundMs: thread.lastHumanOutboundMs, now });
    const gate = agentGateReason({
      settings: s, channel: 'whatsapp', hasAiKey: aiCfg.hasKey, hasText: a.event.kind === 'text' && !!a.event.text.trim(),
      optedOut: a.optedOut, isPerson: !a.lidOnly, agentState, replyToAutomated: thread.replyToAutomated,
      repliesToday: Number(usage.replies) || 0, now, handoffResumable: resumable,
    });
    if (gate) {
      await tally(gate);
      if (gate === 'daily-cap') await notifyCapOnce(ctx, dateKey, 'replies');
      // A gate block is recorded under its own id: a retry of the same message after a
      // transient block (daily-cap) must still be able to claim the real run doc.
      await recordGate(gate);
      return { blocked: gate };
    }
    // Claim BEFORE anything else happens (idempotency = the run doc).
    try {
      await runRef.create({ businessId: a.businessId, teamId: a.teamId, kind: 'reply', entityId: a.conversationId, decision: 'pending', waMessageId: a.event.waMessageId, createdAt: Timestamp.now() });
    } catch (err) {
      if (isAlreadyExists(err)) { await tally('duplicate-run'); return { blocked: 'duplicate-run' }; }
      throw err;
    }
    if (resumable && agentState) {
      await convRef.set({ agent: { active: true, stage: 'qualifying', resumedAt: Timestamp.now(), resumedBy: 'auto', handoffReason: null, handoffNotifiedAt: null } }, { merge: true });
      agentState = { ...agentState, active: true, stage: 'qualifying' };
      if (a.leadId) await writeLeadActivity(ctx, a.leadId, `${s.persona.name} e mori sërish bisedën`, `Askush nuk u përgjigj për ${s.handoffAutoResumeHours} orë pas dorëzimit.`, { conversationId: a.conversationId, autoResumed: true });
    }
    const facts = await loadSalesFacts(ctx);
    const trigger = detectHandoffTrigger(a.event.text);
    const isFirstAgentMessage = !thread.agentSpokeBefore && !(agentState && agentState.turns > 0);
    const result = await decideReply({
      ctx, aiCfg, facts, channel: 'whatsapp', contactName: a.contactName,
      contactKind: a.leadId ? 'lead' : a.customerId ? 'customer' : 'unknown', leadStatus: a.lead?.status ?? null,
      agentState, history: thread.history, clientText: a.event.text, isFirstAgentMessage,
      minutesSinceHumanReply: thread.lastHumanOutboundMs ? (now.getTime() - thread.lastHumanOutboundMs) / 60_000 : null,
      now, trigger,
    });
    await bumpUsage(a.businessId, a.teamId, dateKey, { aiCalls: result.model ? 1 : 0, conversations: agentState ? 0 : 1 });
    if (result.model) {
      db.collection('aiUsageLogs').add({
        userId: null, teamId: a.teamId, businessId: a.businessId, feature: AGENT_AUTOMATION_KIND, conversationId: a.conversationId,
        tokensUsed: result.tokens, cacheReadTokens: result.cacheReadTokens, cacheWriteTokens: result.cacheWriteTokens, model: result.model, provider: result.provider, createdAt: new Date(),
      }).catch(() => {});
    }
    const target: AgentSendTarget = {
      channel: a.event.channel, agentId: a.event.agentId ?? null, metaPhoneNumberId: a.event.metaPhoneNumberId ?? null,
      phone: a.event.phone, jid: a.event.jid, channelPhone: a.event.channelPhone ?? null,
    };
    // The client wrote again while the model was thinking: the newer run answers with the
    // full history, so this reply (or held reply) would be a stale double. A handoff still
    // goes through: a complaint must not be lost to a later "ok".
    if (result.decision.mode !== 'handoff' && result.decision.mode !== 'silent' && a.event.kind === 'text'
      && await supersededNow(a.conversationId, a.event.waMessageId)) {
      await tally('superseded');
      await runRef.set({ decision: 'blocked', blockReason: 'superseded', intent: result.output.intent, model: result.model, tokens: result.tokens, updatedAt: Timestamp.now() }, { merge: true }).catch(() => {});
      return { blocked: 'superseded' };
    }
    const outcome = await executeDecision({ ctx, result, target, conversationId: a.conversationId, conv, agentState, leadId: a.leadId, lead: a.lead, customerId: a.customerId, contactName: a.contactName, waMessageId: a.event.waMessageId, isFirstAgentMessage, dateKey, now, conversationOwnerId: a.conversationOwnerId ?? conv?.ownerId ?? null });
    await runRef.set({
      decision: outcome.decision, blockReason: outcome.blockReason, handoffReason: result.decision.handoffReason,
      intent: result.output.intent, confidence: result.output.confidence, model: result.model, tokens: result.tokens, cacheReadTokens: result.cacheReadTokens, cacheWriteTokens: result.cacheWriteTokens,
      replyText: outcome.replyText, error: result.error || outcome.error, stage: result.stage, updatedAt: Timestamp.now(),
    }, { merge: true }).catch(() => {});
    return { decision: outcome.decision, blockReason: outcome.blockReason, handoffReason: result.decision.handoffReason, intent: result.output.intent, model: result.model };
  } catch (err) {
    console.error('[salesAgent] inbound hook failed', err);
    await runRef.set({ decision: 'blocked', blockReason: 'error', error: String((err as Error)?.message || err).slice(0, 300), updatedAt: Timestamp.now() }, { merge: true }).catch(() => {});
    await tally('error');
    return { blocked: 'error' };
  }
}

interface ExecuteArgs {
  ctx: AgentCtx;
  result: DecideResult;
  target: AgentSendTarget;
  conversationId: string;
  conv: any;
  agentState: ReturnType<typeof agentStateOf>;
  leadId: string | null;
  lead: any;
  customerId: string | null;
  contactName: string;
  waMessageId: string;
  isFirstAgentMessage: boolean;
  dateKey: string;
  now: Date;
  conversationOwnerId: string | null;
}

/** Executes send / draft / handoff / silent. Stamps only AFTER a successful send. */
async function executeDecision(e: ExecuteArgs): Promise<{ decision: DeliveryMode; blockReason: SalesAgentBlockReason | null; replyText: string | null; error: string | null }> {
  const { ctx, result, agentState } = e;
  const s = ctx.settings;
  const now = Timestamp.fromDate(e.now);
  const convRef = db.collection('conversations').doc(e.conversationId);
  const prevTurns = agentState?.turns || 0;
  const prevTwp = agentState?.turnsWithoutProgress || 0;
  const baseAgent: Record<string, any> = {
    active: true, stage: result.stage, collected: result.collected, turns: prevTurns + 1,
    turnsWithoutProgress: result.progressed ? 0 : prevTwp + 1, lastIntent: result.output.intent, lastInboundMessageId: e.waMessageId,
    // A newer decision always replaces a reply that was waiting to be sent.
    pendingSend: admin.firestore.FieldValue.delete(), pendingDueAt: admin.firestore.FieldValue.delete(),
  };

  if (result.decision.mode === 'silent') {
    await convRef.set({ agent: { ...baseAgent }, updatedAt: now }, { merge: true }).catch(() => {});
    return { decision: 'silent', blockReason: result.decision.blockReason, replyText: null, error: null };
  }

  if (result.decision.mode === 'handoff') {
    const reason = result.decision.handoffReason || 'manual';
    let sentLine: string | null = null;
    if (s.autonomy >= 1) {
      const r = await sendAgentWaText({ ctx, target: e.target, text: HANDOFF_LINE, idempotencyKey: `sa_${e.conversationId}_${e.waMessageId}_handoff`, automationKind: AGENT_AUTOMATION_KIND, leadId: e.leadId, customerId: e.customerId, contactName: e.contactName });
      if (r.ok) sentLine = HANDOFF_LINE;
    }
    await convRef.set({
      agent: { ...baseAgent, active: false, stage: 'handoff', handoffReason: reason, handoffAt: now, handoffNotifiedAt: null, resumedAt: null },
      awaitingReply: true, ...(sentLine ? { lastOutboundAt: now } : {}), updatedAt: now,
    }, { merge: true }).catch(() => {});
    await bumpUsage(ctx.businessId, ctx.teamId, e.dateKey, { handoffs: 1 });
    await notifyHandoff(ctx, e.conversationId, e.contactName, reason, e.target.phone, e.conversationOwnerId, e.customerId, false);
    if (e.leadId) await writeLeadActivity(ctx, e.leadId, `${s.persona.name} ia kaloi bisedën një personi`, HANDOFF_REASON_TEXT(reason), { conversationId: e.conversationId, handoffReason: reason });
    return { decision: 'handoff', blockReason: null, replyText: sentLine, error: null };
  }

  if (result.decision.mode === 'draft') {
    const text = result.output.reply ? ensureDisclosure(result.output.reply, s.persona, ctx.tenantName, e.isFirstAgentMessage) : '';
    // Level 1 in office hours: the reply is HELD, and `sales-agent-pending` sends it when
    // the wait is over unless a person answered first. Everything the send needs later is
    // stored with it, so the job never has to re-run the model.
    const deferMin = result.decision.deferMinutes;
    const pending = deferMin && text ? {
      text, forMessageId: e.waMessageId, createdAt: now, dueAt: Timestamp.fromMillis(e.now.getTime() + deferMin * 60_000),
      target: {
        channel: e.target.channel, agentId: e.target.agentId ?? null, metaPhoneNumberId: e.target.metaPhoneNumberId ?? null,
        phone: e.target.phone, jid: e.target.jid ?? null, channelPhone: e.target.channelPhone ?? null,
      },
      leadId: e.leadId, customerId: e.customerId, contactName: e.contactName, conversationOwnerId: e.conversationOwnerId,
      collected: result.collected, qualified: result.qualified, intent: result.output.intent, stage: result.stage, model: result.model,
    } : null;
    const notify = !!text && shouldNotifyDraft(toDate(e.conv?.agent?.draftNotifiedAt), e.now);
    await convRef.set({
      agent: {
        ...baseAgent, lastDraftAt: now,
        ...(pending ? { pendingSend: pending, pendingDueAt: pending.dueAt } : {}),
        ...(notify ? { draftNotifiedAt: now } : {}),
      },
      ...(text ? { suggestedReply: text, suggestedAt: now, suggestedForMessageId: e.waMessageId, suggestedModel: result.model || 'sales-agent', suggestedBy: AGENT_AUTOMATION_KIND } : {}),
      updatedAt: now,
    }, { merge: true }).catch(() => {});
    await bumpUsage(ctx.businessId, ctx.teamId, e.dateKey, { drafts: 1, ...(result.decision.blockReason ? { [`blocked.${result.decision.blockReason}`]: 1 } : {}) });
    // A draft nobody knows about is silence: tell the person who owns the thread.
    if (notify) await notifyDraft(ctx, e.conversationId, e.contactName, e.target.phone, e.conversationOwnerId, e.customerId, pending ? toDate(pending.dueAt) : null, result.decision.blockReason);
    return { decision: 'draft', blockReason: result.decision.blockReason, replyText: text || null, error: null };
  }

  // send
  const text = ensureDisclosure(result.output.reply, s.persona, ctx.tenantName, e.isFirstAgentMessage);
  const r = await sendAgentWaText({ ctx, target: e.target, text, idempotencyKey: `sa_${e.conversationId}_${e.waMessageId}`, automationKind: AGENT_AUTOMATION_KIND, leadId: e.leadId, customerId: e.customerId, contactName: e.contactName });
  if (!r.ok) {
    // The channel refused: keep the text as a draft so a person can send it; never claim "sent".
    await convRef.set({ agent: { ...baseAgent, lastDraftAt: now }, suggestedReply: text, suggestedAt: now, suggestedForMessageId: e.waMessageId, suggestedModel: result.model || 'sales-agent', suggestedBy: AGENT_AUTOMATION_KIND, updatedAt: now }, { merge: true }).catch(() => {});
    await bumpUsage(ctx.businessId, ctx.teamId, e.dateKey, { 'blocked.send-failed': 1 });
    return { decision: 'draft', blockReason: 'error', replyText: text, error: r.error };
  }
  await stampAgentSend({
    ctx, conversationId: e.conversationId, conv: e.conv, agentPatch: baseAgent, now, dateKey: e.dateKey, text, sentId: r.id,
    leadId: e.leadId, lead: e.lead, customerId: e.customerId, contactName: e.contactName, conversationOwnerId: e.conversationOwnerId,
    collected: result.collected, qualified: result.qualified, intent: result.output.intent, stage: result.stage,
  });
  return { decision: 'send', blockReason: null, replyText: text, error: null };
}

export interface StampSendArgs {
  ctx: AgentCtx;
  conversationId: string;
  conv: any;
  /** Merged into `conversations.agent` together with `lastReplyAt`. */
  agentPatch: Record<string, any>;
  now: admin.firestore.Timestamp;
  dateKey: string;
  text: string;
  sentId: string | null;
  leadId: string | null;
  lead: any;
  customerId: string | null;
  contactName: string;
  conversationOwnerId: string | null;
  collected: Record<string, string>;
  qualified: boolean;
  intent: string;
  stage: string;
}

/** Everything that follows a SUCCESSFUL send: the inbound hook and `sales-agent-pending` share it. */
export async function stampAgentSend(a: StampSendArgs): Promise<void> {
  const { ctx, now } = a;
  const s = ctx.settings;
  const convRef = db.collection('conversations').doc(a.conversationId);
  const qualifiedBefore = !!toMs(a.lead?.agentQualifiedAt);
  const qualifiedNow = a.qualified && !qualifiedBefore && !!a.leadId;
  await Promise.allSettled([
    convRef.set({
      agent: { ...a.agentPatch, lastReplyAt: now },
      lastOutboundAt: now, awaitingReply: s.autonomy >= 2 ? false : true, ...(conv_firstResponse(a.conv) ? {} : { firstResponseAt: now }),
      suggestedReply: admin.firestore.FieldValue.delete(), suggestedAt: admin.firestore.FieldValue.delete(), suggestedForMessageId: admin.firestore.FieldValue.delete(),
      updatedAt: now,
    }, { merge: true }),
    bumpUsage(ctx.businessId, ctx.teamId, a.dateKey, { replies: 1, ...(qualifiedNow ? { qualified: 1 } : {}) }, qualifiedNow ? { qualifiedNames: admin.firestore.FieldValue.arrayUnion(`${a.contactName}: ${buildLeadSummary(a.contactName, a.collected).split('\n')[0]}`) } : {}),
    a.leadId ? db.collection('leads').doc(a.leadId).set({
      agentCollected: a.collected, agentScore: leadAgentScore(a.collected, s.qualificationFields),
      agentSummary: buildLeadSummary(a.contactName, a.collected), lastActivityAt: now, lastFollowUpDate: now,
      ...(a.lead?.status === 'New' ? { status: 'Contacted' } : {}), ...(qualifiedNow ? { agentQualifiedAt: now } : {}), updatedAt: now,
    }, { merge: true }) : Promise.resolve(),
    a.customerId ? db.collection('customers').doc(a.customerId).set({ lastActivityAt: now, updatedAt: now }, { merge: true }) : Promise.resolve(),
    a.leadId ? writeLeadActivity(ctx, a.leadId, `${s.persona.name} u përgjigj në WhatsApp`, a.text.slice(0, 200), { conversationId: a.conversationId, direction: 'outbound', waMessageId: a.sentId, intent: a.intent, stage: a.stage }) : Promise.resolve(),
  ]);
  if (qualifiedNow && a.leadId) await notifyQualified(ctx, a.leadId, a.contactName, buildLeadSummary(a.contactName, a.collected), a.lead?.assignedToUserId ?? a.conversationOwnerId ?? null);
}

/**
 * "Ana has a draft for X" / "Ana answers X at 10:42 unless you do". Reuses the
 * registered `sales_agent_handoff` type (same audience, same mute switch).
 */
async function notifyDraft(ctx: AgentCtx, conversationId: string, contactName: string, phone: string, ownerId: string | null, customerId: string | null, sendsAt: Date | null, reason: SalesAgentBlockReason | null): Promise<void> {
  const recipients = ownerId ? [ownerId] : await managerIdsForBusiness(ctx.businessId, ctx.teamId);
  const name = ctx.settings.persona.name;
  const at = sendsAt ? localParts(sendsAt, TZ).hhmm : null;
  const title = at ? `⏳ ${name} i përgjigjet ${contactName} në ${at}` : `✍️ ${name} ka një draft për ${contactName}`;
  const message = at
    ? 'Nëse do të përgjigjesh vetë, shkruaj para kësaj ore — përgjigjja e saj anulohet.'
    : `Draft-i pret te biseda në WhatsApp. ${reason ? (SALES_AGENT_BLOCK_LABELS[reason] || '') : ''}`.trim();
  await Promise.allSettled(recipients.map((uid) => notifyUser({
    userId: uid, type: 'sales_agent_handoff', title, message,
    actionUrl: `/app/whatsapp?phone=${encodeURIComponent(phone)}`, actionLabel: at ? 'Përgjigju vetë' : 'Shiko draft-in',
    businessId: ctx.businessId, teamId: ctx.teamId, customerId, conversationKey: conversationId,
  })));
}

const conv_firstResponse = (conv: any): boolean => !!toMs(conv?.firstResponseAt);

const HANDOFF_REASON_TEXT = (reason: string): string => {
  const map: Record<string, string> = {
    'asked-for-human': 'Klienti kërkoi një person', complaint: 'Ankesë / pakënaqësi', 'sensitive-topic': 'Temë e ndjeshme',
    'custom-price': 'Kërkoi çmim të personalizuar / zbritje', 'low-confidence': 'Agjentja nuk ishte e sigurt', 'no-progress': 'Shumë kthesa pa përparim',
    'unsupported-language': 'Gjuhë e pambuluar', 'booking-failed': 'Rezervimi dështoi', manual: 'E mori një person',
  };
  return map[reason] || reason;
};

export async function writeLeadActivity(ctx: AgentCtx, leadId: string, title: string, body: string, meta: Record<string, any>): Promise<void> {
  await db.collection('leadActivities').add({
    leadId, teamId: ctx.teamId, businessId: ctx.businessId, type: 'whatsapp', title, body: body.slice(0, 300),
    meta: { ...meta, automated: true, automationKind: AGENT_AUTOMATION_KIND }, userId: null, userName: ctx.settings.persona.name, automated: true, createdAt: Timestamp.now(),
  }).catch((err) => console.error('[salesAgent] leadActivities write failed', err));
}

async function notifyHandoff(ctx: AgentCtx, conversationId: string, contactName: string, reason: string, phone: string, ownerId: string | null, customerId: string | null, escalation: boolean): Promise<number> {
  const recipients = ownerId && !escalation ? [ownerId] : await managerIdsForBusiness(ctx.businessId, ctx.teamId);
  const results = await Promise.allSettled(recipients.map((uid) => notifyUser({
    userId: uid, type: 'sales_agent_handoff',
    title: escalation ? `⏰ ${contactName} pret ende një person` : `🤝 ${ctx.settings.persona.name} kërkon një person: ${contactName}`,
    message: HANDOFF_REASON_TEXT(reason),
    actionUrl: `/app/whatsapp?phone=${encodeURIComponent(phone)}`, actionLabel: 'Merre bisedën',
    businessId: ctx.businessId, teamId: ctx.teamId, customerId, conversationKey: conversationId,
  })));
  return results.filter((r) => r.status === 'fulfilled' && (r.value as any)?.written).length;
}

async function notifyQualified(ctx: AgentCtx, leadId: string, contactName: string, summary: string, assigneeId: string | null): Promise<void> {
  const recipients = assigneeId ? [assigneeId] : await managerIdsForBusiness(ctx.businessId, ctx.teamId);
  await Promise.allSettled(recipients.map((uid) => notifyUser({
    userId: uid, type: 'sales_agent_qualified', title: `✅ Lead i kualifikuar nga ${ctx.settings.persona.name}: ${contactName}`, message: summary,
    actionUrl: `/app/crm?lead=${encodeURIComponent(leadId)}`, actionLabel: 'Hap lead-in', businessId: ctx.businessId, teamId: ctx.teamId,
  })));
}

/** One `sales_agent_budget` per tenant per day per cap. */
async function notifyCapOnce(ctx: AgentCtx, dateKey: string, cap: 'replies' | 'places'): Promise<void> {
  const ref = usageDayRef(ctx.businessId, dateKey);
  const field = cap === 'replies' ? 'capNotifiedReplies' : 'capNotifiedPlaces';
  const won = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if ((snap.data() as any)?.[field]) return false;
    tx.set(ref, { [field]: Timestamp.now(), businessId: ctx.businessId, teamId: ctx.teamId, date: dateKey }, { merge: true });
    return true;
  }).catch(() => false);
  if (!won) return;
  const recipients = await managerIdsForBusiness(ctx.businessId, ctx.teamId);
  await Promise.allSettled(recipients.map((uid) => notifyUser({
    userId: uid, type: 'sales_agent_budget',
    title: cap === 'replies' ? `${ctx.settings.persona.name}: kuota ditore e përgjigjeve u arrit` : `${ctx.settings.persona.name}: buxheti mujor i kërkimeve Places u arrit`,
    message: cap === 'replies' ? `${ctx.settings.dailyReplyCap} përgjigje sot — mesazhet e tjera ruhen si draft deri nesër.` : 'Kërkimet e reja do të refuzohen deri muajin tjetër ose derisa të rritet buxheti.',
    actionUrl: '/app/sales-agent?tab=settings', actionLabel: 'Hap cilësimet', businessId: ctx.businessId, teamId: ctx.teamId,
  })));
}

// ── HTTP: auth gates ──────────────────────────────────────────────────────────

type Caller = NonNullable<Awaited<ReturnType<typeof authenticate>>>;
interface Gate { ctx: AgentCtx; membership: Awaited<ReturnType<typeof activeMembership>>; isAdmin: boolean; isManager: boolean; role: string }
type GateResult = Gate | { error: string; status: number };

async function requireStaff(c: Caller, teamIdRaw: string): Promise<GateResult> {
  const teamId = teamIdRaw || c.tid || '';
  if (!teamId) return { error: 'teamId mungon', status: 400 };
  const membership = await activeMembership(c.uid, { teamId });
  if (!membership && !c.superAdmin) return { error: 'Nuk jeni anëtar i këtij ekipi', status: 403 };
  const ctx = await loadAgentCtx(teamId, membership?.businessId || c.bid);
  if (!ctx) return { error: 'Ekipi nuk u gjet', status: 404 };
  if (c.bid && c.bid !== ctx.businessId && !c.superAdmin) return { error: 'Jashtë hapësirës suaj', status: 403 };
  const role = String(membership?.role || '');
  if (role === 'Viewer' && !c.superAdmin) return { error: 'Roli Viewer nuk mund të përdorë agjenten', status: 403 };
  const isAdmin = !!c.superAdmin || hasAdminRole(c.roles) || role === 'Admin' || (await isBusinessOwner(c.uid, ctx.businessId));
  const isManager = isAdmin || hasManagerRole(c.roles) || role === 'Manager';
  return { ctx, membership, isAdmin, isManager, role };
}

const isGateError = (g: GateResult): g is { error: string; status: number } => 'error' in g;

// ── HTTP: actions ─────────────────────────────────────────────────────────────

async function handleEnable(res: VercelResponse, c: Caller, body: Record<string, any>, enabled: boolean) {
  const gate = await requireStaff(c, str(body.teamId, 128));
  if (isGateError(gate)) return res.status(gate.status).json({ error: gate.error });
  if (!gate.isAdmin) return res.status(403).json({ error: 'Vetëm një Admin ose pronari mund ta aktivizojë agjenten' });
  const { ctx } = gate;
  if (enabled && ctx.tenantStatus === 'suspended') return res.status(402).json({ error: 'Hapësira është e pezulluar' });
  const now = Timestamp.now();
  const incoming = resolveSalesAgentSettings({ ...ctx.cfg?.salesAgent, ...(body.settings && typeof body.settings === 'object' ? body.settings : {}), enabled }, { maxAutonomy: platformMaxAutonomy() });
  if (!incoming.persona.businessName) incoming.persona.businessName = ctx.tenantName;
  await db.collection('userProfiles').doc(salesAgentProfileDocId(ctx.businessId)).set({
    userId: SALES_AGENT_UID, displayName: incoming.persona.name, avatarUrl: SALES_AGENT_AVATAR_PATH, jobTitle: SALES_AGENT_TITLE,
    bio: `Asistentja virtuale e shitjeve e ${incoming.persona.businessName}. Përgjigjet klientëve, kualifikon lead-et, gjen prospekte. Nuk shpik çmime.`,
    businessId: ctx.businessId, teamId: ctx.teamId, isBot: true, enabled, updatedAt: now, createdAt: now,
  }, { merge: true });
  const { lastRun: _lr, ...toStore } = { ...incoming } as any;
  await db.collection('teamSettings').doc(ctx.teamId).set({ salesAgent: toStore, updatedAt: now }, { merge: true });
  return res.status(200).json({ ok: true, settings: toStore });
}

/**
 * The call script with the persona as it is NOW. Stored drafts are a snapshot from
 * the search; renaming the persona ("Agjencia" → "Bos Marketing") must not leave the
 * old name in what staff read or what lands on the lead.
 */
function liveCallScript(p: any, persona: SalesAgentPersona): string {
  const serviceLine = prospectServiceLine(p);
  if (!serviceLine) return p?.callScript ? String(p.callScript) : '';
  return buildCallScript({
    prospect: { name: String(p.name || ''), category: p.category ?? null, city: p.city ?? null, website: p.website ?? null, rating: p.rating ?? null, reviewCount: p.reviewCount ?? null },
    persona, serviceLine, senderName: null,
  });
}

async function handleSettingsTest(res: VercelResponse, c: Caller, body: Record<string, any>) {
  const gate = await requireStaff(c, str(body.teamId, 128));
  if (isGateError(gate)) return res.status(gate.status).json({ error: gate.error });
  if (!gate.isManager) return res.status(403).json({ error: 'Vetëm Admin/Manager' });
  const { ctx } = gate;
  const ai: Record<string, any> = { ok: false, provider: null, model: null };
  try {
    const cfg = await resolveAiConfig(ctx.teamId);
    if (!cfg.hasKey) { ai.code = 'not-configured'; ai.detail = 'Asnjë çelës AI (Cilësimet → FivoAI)'; }
    else {
      const r = await generateChatWith(cfg, 'Përgjigju vetëm me fjalën: OK', [{ role: 'user', content: 'Test' }], { maxTokens: 5, timeoutMs: 15_000, totalBudgetMs: 25_000 });
      ai.ok = true; ai.provider = r.provider; ai.model = r.model;
    }
  } catch (err) {
    const cl = classifyAiError(err);
    ai.code = cl.code; ai.detail = cl.message;
  }
  const key = resolvePlacesKey(ctx.cfg);
  const places: Record<string, any> = { ok: false, configured: !!key.key, source: key.source };
  if (key.key) {
    const p = await placesKeyProbe(key.key);
    places.ok = p.ok; if (!p.ok) { places.code = p.code; places.error = p.error; }
  } else {
    places.error = 'Çelësi i Google Places nuk është konfiguruar';
  }
  return res.status(200).json({ ok: true, ai, places });
}

async function handleSearchCreate(res: VercelResponse, c: Caller, body: Record<string, any>) {
  const gate = await requireStaff(c, str(body.teamId, 128));
  if (isGateError(gate)) return res.status(gate.status).json({ error: gate.error });
  const { ctx } = gate;
  if (!ctx.settings.enabled) return res.status(409).json({ error: 'Agjentja është e çaktivizuar', blockReason: 'module-off' });
  if (ctx.tenantStatus === 'suspended') return res.status(402).json({ error: 'Hapësira është e pezulluar' });
  if (!(await checkPersistentRateLimit('sales-agent-search', c.uid, SEARCH_PER_HOUR))) return res.status(429).json({ error: 'Shumë kërkime brenda një ore' });
  const query = str(body.query, 120);
  const city = str(body.city, 80);
  const maxResults = Math.max(1, Math.min(SALES_AGENT_LIMITS.maxResultsPerSearch, Number(body.maxResults) || 20));
  const dateKey = localParts(new Date(), TZ).date;
  const [monthly, queuedSnap] = await Promise.all([
    readMonthlyUsage(ctx.businessId, dateKey),
    db.collection('prospectSearches').where('businessId', '==', ctx.businessId).where('status', '==', 'queued').limit(11).get(),
  ]);
  const block = searchBlockReason({ query, city, maxResults, requestsUsedThisMonth: Number(monthly.placesRequests) || 0, monthlyBudget: ctx.settings.placesMonthlyBudget, queuedCount: queuedSnap.size });
  if (block) {
    if (block === 'budget-exceeded') await notifyCapOnce(ctx, dateKey, 'places');
    return res.status(409).json({ error: SEARCH_BLOCK_LABELS[block], blockReason: block });
  }
  if (!resolvePlacesKey(ctx.cfg).key) return res.status(409).json({ error: 'Çelësi i Google Places nuk është konfiguruar', blockReason: 'places-not-configured' });
  const now = Timestamp.now();
  const ref = db.collection('prospectSearches').doc();
  await ref.set({
    businessId: ctx.businessId, teamId: ctx.teamId, query, city, region: str(body.region, 2).toUpperCase() || 'AL', maxResults,
    status: 'queued', error: null, counts: { found: 0, new: 0, duplicate: 0, registered: 0, requests: 0 },
    estimatedRequests: estimateSearchRequests(maxResults), requestedByUserId: c.uid, startedAt: null, finishedAt: null, createdAt: now, updatedAt: now,
  });
  return res.status(200).json({ ok: true, searchId: ref.id, estimatedRequests: estimateSearchRequests(maxResults) });
}

async function handleSearchCancel(res: VercelResponse, c: Caller, body: Record<string, any>) {
  const gate = await requireStaff(c, str(body.teamId, 128));
  if (isGateError(gate)) return res.status(gate.status).json({ error: gate.error });
  const id = str(body.searchId, 128);
  const snap = id ? await db.collection('prospectSearches').doc(id).get() : null;
  const d = snap?.exists ? (snap.data() as any) : null;
  if (!d || d.businessId !== gate.ctx.businessId) return res.status(404).json({ error: 'Kërkimi nuk u gjet' });
  if (d.status !== 'queued') return res.status(409).json({ error: 'Vetëm një kërkim në radhë mund të anulohet', blockReason: 'not-queued' });
  await snap!.ref.set({ status: 'failed', error: 'Anuluar nga përdoruesi', finishedAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });
  return res.status(200).json({ ok: true });
}

async function handleProspectRegister(res: VercelResponse, c: Caller, body: Record<string, any>) {
  const gate = await requireStaff(c, str(body.teamId, 128));
  if (isGateError(gate)) return res.status(gate.status).json({ error: gate.error });
  const { ctx } = gate;
  if (ctx.tenantStatus === 'suspended') return res.status(402).json({ error: 'Hapësira është e pezulluar' });
  const ids: string[] = Array.isArray(body.prospectIds) ? body.prospectIds.filter((x: unknown) => typeof x === 'string').slice(0, 50) : [];
  if (!ids.length) return res.status(400).json({ error: 'prospectIds mungon' });
  const outreach = body.outreach && typeof body.outreach === 'object' ? body.outreach : {};
  const wantWa = outreach.wa === true && ctx.settings.coldWa.enabled;
  const wantEmail = outreach.email === true;
  const now = Timestamp.now();
  const lp = localParts(new Date(), TZ);
  const tomorrowNoon = Timestamp.fromMillis(zonedTimeMs(shiftDateKey(lp.date, 1), 12, 0));
  const created: string[] = []; const linked: Array<{ prospectId: string; contactId: string; kind: string }> = []; const skipped: Array<{ prospectId: string; reason: string }> = [];
  for (const pid of ids) {
    const snap = await db.collection('prospects').doc(pid).get();
    const p = snap.exists ? (snap.data() as any) : null;
    if (!p || p.businessId !== ctx.businessId) { skipped.push({ prospectId: pid, reason: 'not-found' }); continue; }
    if (p.status === 'registered') { skipped.push({ prospectId: pid, reason: 'already-registered' }); continue; }
    const phone = p.phone ? toWaPhone(p.phone) : '';
    const lookup = { phone: phone || null, teamId: ctx.teamId, businessId: ctx.businessId };
    const [leadHit, customerHit] = phone ? await Promise.all([findLeadForContact(db, lookup), findCustomerForContact(db, lookup)]) : [null, null];
    let matchId: string | null = leadHit?.id || customerHit?.id || null;
    let matchKind: 'lead' | 'customer' | null = leadHit ? 'lead' : customerHit ? 'customer' : null;
    if (!matchId && p.website) {
      const w = await db.collection('leads').where('businessId', '==', ctx.businessId).where('website', '==', p.website).limit(1).get().catch(() => null);
      if (w && !w.empty) { matchId = w.docs[0].id; matchKind = 'lead'; }
    }
    if (matchId) {
      await snap.ref.set({ status: 'duplicate', matchedContactId: matchId, matchedContactKind: matchKind, leadId: matchKind === 'lead' ? matchId : null, updatedAt: now }, { merge: true });
      linked.push({ prospectId: pid, contactId: matchId, kind: matchKind! });
      continue;
    }
    const leadRef = db.collection('leads').doc();
    const notes = [
      `Gjetur në Google Maps nga ${ctx.settings.persona.name}.`,
      p.rating != null ? `Vlerësimi: ${p.rating}★${p.reviewCount != null ? ` (${p.reviewCount} vlerësime)` : ''}` : 'Pa vlerësime në Google',
      p.category ? `Kategoria: ${p.category}` : '', p.address ? `Adresa: ${p.address}` : '',
      Array.isArray(p.fitReasons) && p.fitReasons.length ? `Pse: ${p.fitReasons.join('; ')}` : '',
    ].filter(Boolean).join('\n');
    await leadRef.set({
      name: p.name, company: p.name, phoneNumber: phone || null, phone: phone || null, website: p.website || null, address: p.address || null,
      businessCategory: p.category || null, source: 'maps-prospecting', status: 'New', score: Number(p.fitScore) || 0, notes,
      tags: ['maps'], prospectId: pid, teamId: ctx.teamId, businessId: ctx.businessId, createdByUserId: c.uid, assignedToUserId: c.uid,
      nextFollowUpDate: tomorrowNoon, nextFollowUpType: 'call', followUpNote: `Kontakt i parë (${ctx.settings.persona.name})`,
      lastActivityAt: now, createdAt: now, updatedAt: now,
    });
    await db.collection('leadActivities').add({
      leadId: leadRef.id, teamId: ctx.teamId, businessId: ctx.businessId, type: 'created', title: 'Lead i regjistruar nga prospektimi në Google Maps',
      body: liveCallScript(p, ctx.settings.persona).slice(0, 300), meta: { prospectId: pid, placeId: p.placeId, fitScore: p.fitScore }, userId: c.uid, userName: null, createdAt: now,
    }).catch(() => {});
    await snap.ref.set({
      status: 'registered', leadId: leadRef.id, registeredAt: now, registeredByUserId: c.uid,
      outreachWa: wantWa && phone ? 'pending' : null, outreachEmail: wantEmail ? 'pending' : null, updatedAt: now,
    }, { merge: true });
    created.push(leadRef.id);
  }
  await bumpUsage(ctx.businessId, ctx.teamId, lp.date, { prospectsRegistered: created.length });
  return res.status(200).json({ ok: true, created, linked, skipped });
}

async function handleProspectReject(res: VercelResponse, c: Caller, body: Record<string, any>) {
  const gate = await requireStaff(c, str(body.teamId, 128));
  if (isGateError(gate)) return res.status(gate.status).json({ error: gate.error });
  const id = str(body.prospectId, 128);
  const snap = id ? await db.collection('prospects').doc(id).get() : null;
  const p = snap?.exists ? (snap.data() as any) : null;
  if (!p || p.businessId !== gate.ctx.businessId) return res.status(404).json({ error: 'Prospekti nuk u gjet' });
  if (p.status === 'registered') return res.status(409).json({ error: 'Një prospekt i regjistruar nuk refuzohet — fshi lead-in', blockReason: 'already-registered' });
  await snap!.ref.set({ status: 'rejected', rejectReason: str(body.reason, 200) || null, rejectedByUserId: c.uid, updatedAt: Timestamp.now() }, { merge: true });
  return res.status(200).json({ ok: true });
}

async function loadOwnConversation(ctx: AgentCtx, id: string) {
  const snap = id ? await db.collection('conversations').doc(id).get() : null;
  const d = snap?.exists ? (snap.data() as any) : null;
  if (!d || d.businessId !== ctx.businessId) return null;
  return { ref: snap!.ref, data: d };
}

async function handleConversationHandoff(res: VercelResponse, c: Caller, body: Record<string, any>, resume: boolean) {
  const gate = await requireStaff(c, str(body.teamId, 128));
  if (isGateError(gate)) return res.status(gate.status).json({ error: gate.error });
  const conv = await loadOwnConversation(gate.ctx, str(body.conversationId, 200));
  if (!conv) return res.status(404).json({ error: 'Biseda nuk u gjet' });
  const now = Timestamp.now();
  const prev = agentStateOf(conv.data);
  if (resume) {
    await conv.ref.set({ agent: { active: true, stage: prev?.stage === 'handoff' || !prev ? (Object.keys(prev?.collected || {}).length ? 'qualifying' : 'greeting') : prev.stage, resumedAt: now, resumedByUserId: c.uid, handoffReason: null, handoffAt: null, handoffNotifiedAt: null, turnsWithoutProgress: 0 }, updatedAt: now }, { merge: true });
  } else {
    await conv.ref.set({ agent: { active: false, stage: 'handoff', handoffReason: 'manual', handoffAt: now, handoffNotifiedAt: now, resumedAt: null, handoffByUserId: c.uid }, updatedAt: now }, { merge: true });
  }
  return res.status(200).json({ ok: true });
}

function historyFromBody(raw: unknown): { history: ChatMsg[]; clientText: string } | null {
  const msgs = Array.isArray(raw) ? raw.slice(-HISTORY_LIMIT) : [];
  const history: ChatMsg[] = [];
  for (const m of msgs) {
    const text = str(m?.text, 800);
    if (!text) continue;
    history.push({ role: m?.role === 'agent' ? 'assistant' : 'user', content: text });
  }
  while (history.length && history[0].role !== 'user') history.shift();
  const last = history[history.length - 1];
  if (!last || last.role !== 'user') return null;
  return { history, clientText: last.content };
}

async function handleSimulate(res: VercelResponse, c: Caller, body: Record<string, any>) {
  const gate = await requireStaff(c, str(body.teamId, 128));
  if (isGateError(gate)) return res.status(gate.status).json({ error: gate.error });
  const { ctx } = gate;
  if (!(await checkPersistentRateLimit('sales-agent-sim', c.uid, SIMULATE_PER_HOUR))) return res.status(429).json({ error: 'Shumë simulime brenda një ore (20)' });
  const h = historyFromBody(body.messages);
  if (!h) return res.status(400).json({ error: 'Mesazhi i fundit duhet të jetë i klientit' });
  const aiCfg = await resolveAiConfig(ctx.teamId);
  if (!aiCfg.hasKey) return res.status(503).json({ error: 'Asnjë çelës AI (Cilësimet → FivoAI)', code: 'not-configured' });
  const facts = await loadSalesFacts(ctx);
  const stages: AgentStage[] = ['greeting', 'qualifying', 'proposing', 'booking', 'handoff', 'closed'];
  const stage: AgentStage = stages.includes(body.stage) ? body.stage : 'greeting';
  const collected = body.collected && typeof body.collected === 'object' ? mergeCollected(null, body.collected) : {};
  const agentState: ConversationAgentLike = { active: true, stage, collected, turns: Math.max(0, h.history.length - 1), turnsWithoutProgress: 0, lastReplyAt: null, lastDraftAt: null };
  const now = new Date();
  const r = await decideReply({
    ctx, aiCfg, facts, channel: 'whatsapp', contactName: str(body.contactName, 60) || 'Klienti', contactKind: 'lead', leadStatus: 'New',
    agentState, history: h.history, clientText: h.clientText, isFirstAgentMessage: !h.history.some((m) => m.role === 'assistant'),
    minutesSinceHumanReply: null, now, trigger: detectHandoffTrigger(h.clientText),
  });
  if (r.model) {
    db.collection('aiUsageLogs').add({ userId: c.uid, teamId: ctx.teamId, businessId: ctx.businessId, feature: 'sales-agent-sim', tokensUsed: r.tokens, cacheReadTokens: r.cacheReadTokens, cacheWriteTokens: r.cacheWriteTokens, model: r.model, provider: r.provider, createdAt: new Date() }).catch(() => {});
  }
  if (r.error) return res.status(502).json({ error: 'Modeli nuk u përgjigj', detail: r.error });
  const reply = r.decision.mode === 'handoff' ? (ctx.settings.autonomy >= 1 ? HANDOFF_LINE : '') : ensureDisclosure(r.output.reply, ctx.settings.persona, ctx.tenantName, !h.history.some((m) => m.role === 'assistant'));
  return res.status(200).json({
    ok: true, reply, output: r.output, decision: r.decision, stage: r.stage, collected: r.collected, qualified: r.qualified,
    allowedIntents: [...allowedIntentsForAutonomy(ctx.settings.autonomy)], model: r.model, ...(gate.isAdmin && body.includePrompt ? { prompt: r.prompt } : {}),
  });
}

async function handleReplyDraft(res: VercelResponse, c: Caller, body: Record<string, any>) {
  const gate = await requireStaff(c, str(body.teamId, 128));
  if (isGateError(gate)) return res.status(gate.status).json({ error: gate.error });
  const { ctx } = gate;
  if (!(await checkPersistentRateLimit('sales-agent-draft', c.uid, DRAFT_PER_HOUR))) return res.status(429).json({ error: 'Shumë kërkesa brenda një ore' });
  const conv = await loadOwnConversation(ctx, str(body.conversationId, 200));
  if (!conv) return res.status(404).json({ error: 'Biseda nuk u gjet' });
  const phone = toWaPhone(conv.data.phone || '');
  if (!phone) return res.status(409).json({ error: 'Biseda nuk ka numër telefoni', blockReason: 'no-phone' });
  const aiCfg = await resolveAiConfig(ctx.teamId);
  if (!aiCfg.hasKey) return res.status(503).json({ error: 'Asnjë çelës AI (Cilësimet → FivoAI)', code: 'not-configured' });
  const now = new Date();
  const lastInText = str(conv.data.lastInboundText, 800);
  const thread = await loadThreadFacts(ctx.teamId, phone, now, lastInText);
  const lastUser = [...thread.history].reverse().find((m) => m.role === 'user');
  const clientText = lastUser?.content || lastInText;
  if (!clientText || clientText === '…') return res.status(409).json({ error: 'Asgjë për t\'u përgjigjur', blockReason: 'no-messages' });
  const [facts, leadSnap] = await Promise.all([loadSalesFacts(ctx), conv.data.leadId ? db.collection('leads').doc(String(conv.data.leadId)).get() : Promise.resolve(null)]);
  const lead = leadSnap?.exists ? (leadSnap.data() as any) : null;
  const agentState = agentStateOf(conv.data);
  const r = await decideReply({
    ctx, aiCfg, facts, channel: 'whatsapp', contactName: str(conv.data.subject, 60) || lead?.name || phone,
    contactKind: conv.data.leadId ? 'lead' : conv.data.customerId ? 'customer' : 'unknown', leadStatus: lead?.status ?? null,
    agentState, history: thread.history, clientText, isFirstAgentMessage: !thread.agentSpokeBefore,
    minutesSinceHumanReply: null, now, trigger: null,
  });
  if (r.model) {
    db.collection('aiUsageLogs').add({ userId: c.uid, teamId: ctx.teamId, businessId: ctx.businessId, feature: AGENT_AUTOMATION_KIND, conversationId: conv.ref.id, tokensUsed: r.tokens, cacheReadTokens: r.cacheReadTokens, cacheWriteTokens: r.cacheWriteTokens, model: r.model, provider: r.provider, createdAt: new Date() }).catch(() => {});
  }
  if (r.error) return res.status(502).json({ error: 'Modeli nuk u përgjigj', detail: r.error });
  const text = r.decision.mode === 'handoff' ? HANDOFF_LINE : ensureDisclosure(r.output.reply, ctx.settings.persona, ctx.tenantName, !thread.agentSpokeBefore);
  if (!text) return res.status(409).json({ error: 'Modeli nuk ktheu asgjë të përdorshme', blockReason: 'empty' });
  const ts = Timestamp.fromDate(now);
  await conv.ref.set({ suggestedReply: text, suggestedAt: ts, suggestedForMessageId: conv.data.lastInboundMessageId || null, suggestedModel: r.model || 'sales-agent', suggestedBy: AGENT_AUTOMATION_KIND, agent: { lastDraftAt: ts }, updatedAt: ts }, { merge: true });
  return res.status(200).json({ ok: true, suggestedReply: text, decision: r.decision, intent: r.output.intent, model: r.model });
}

// ── Digest facts (one usage doc + one handoff query — no range index) ─────────

export async function buildDigestFacts(ctx: AgentCtx, dateKey: string, now: Date): Promise<SalesDigestFacts> {
  const usage = await readUsage(ctx.businessId, dateKey);
  const handoffsOpen: SalesDigestFacts['handoffsOpen'] = [];
  try {
    const snap = await db.collection('conversations').where('businessId', '==', ctx.businessId).where('agent.stage', '==', 'handoff').limit(20).get();
    snap.docs.forEach((d) => {
      const a = agentStateOf(d.data());
      if (!a || a.resumedAt) return;
      const minutesOpen = a.handoffAt ? Math.max(0, (now.getTime() - a.handoffAt.getTime()) / 60_000) : 0;
      handoffsOpen.push({ name: str((d.data() as any)?.subject, 60) || 'Kontakt', reason: (a.handoffReason as HandoffReason) || 'manual', minutesOpen });
    });
  } catch (err) { console.error('[salesAgent] handoff read failed', err); }
  const blocked: Record<string, number> = {};
  const b = usage.blocked && typeof usage.blocked === 'object' ? usage.blocked : {};
  for (const [k, v] of Object.entries(b)) if (typeof v === 'number' && v > 0) blocked[k] = v;
  const qualifiedNames: string[] = Array.isArray(usage.qualifiedNames) ? usage.qualifiedNames.slice(0, 10) : [];
  return {
    date: dateKey,
    prospectsNew: Number(usage.prospectsNew) || 0,
    prospectsRegistered: Number(usage.prospectsRegistered) || 0,
    conversationsHeld: Number(usage.replies) || 0,
    qualified: qualifiedNames.map((line) => { const i = line.indexOf(':'); return i > 0 ? { name: line.slice(0, i), summary: line.slice(i + 1).trim() } : { name: line, summary: '' }; }),
    meetingsBooked: Number(usage.meetingsBooked) || 0,
    handoffsOpen,
    coldWaSent: Number(usage.coldWaSent) || 0,
    coldEmailSent: Number(usage.coldEmailSent) || 0,
    blocked: blocked as SalesDigestFacts['blocked'],
    aiCalls: Number(usage.aiCalls) || 0,
    placesRequests: Number(usage.placesRequests) || 0,
  };
}

async function handleDigestPreview(res: VercelResponse, c: Caller, body: Record<string, any>) {
  const gate = await requireStaff(c, str(body.teamId, 128));
  if (isGateError(gate)) return res.status(gate.status).json({ error: gate.error });
  const now = new Date();
  const yesterday = shiftDateKey(localParts(now, TZ).date, -1);
  const facts = await buildDigestFacts(gate.ctx, yesterday, now);
  return res.status(200).json({ ok: true, date: yesterday, text: buildSalesDigest(facts, gate.ctx.settings.persona), facts });
}

// ── HTTP entry ────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const c = await authenticate(req);
  if (!c) return res.status(401).json({ error: 'Missing or invalid token' });
  if (isPortalOnlyToken(c)) return res.status(403).json({ error: 'Agjentja e shitjeve është vetëm për stafin' });
  const body = await readJsonBody(req);
  if (!body) return res.status(400).json({ error: 'Invalid JSON' });
  const action = str(body.action, 40);
  try {
    switch (action) {
      case 'enable': return await handleEnable(res, c, body, true);
      case 'disable': return await handleEnable(res, c, body, false);
      case 'settings.test': return await handleSettingsTest(res, c, body);
      case 'search.create': return await handleSearchCreate(res, c, body);
      case 'search.cancel': return await handleSearchCancel(res, c, body);
      case 'prospect.register': return await handleProspectRegister(res, c, body);
      case 'prospect.reject': return await handleProspectReject(res, c, body);
      case 'conversation.handoff': return await handleConversationHandoff(res, c, body, false);
      case 'conversation.resume': return await handleConversationHandoff(res, c, body, true);
      case 'conversation.simulate': return await handleSimulate(res, c, body);
      case 'reply.draft': return await handleReplyDraft(res, c, body);
      case 'digest.preview': return await handleDigestPreview(res, c, body);
      default: return res.status(400).json({ error: 'Unknown action', detail: 'enable|disable|settings.test|search.create|search.cancel|prospect.register|prospect.reject|conversation.handoff|conversation.resume|conversation.simulate|reply.draft|digest.preview' });
    }
  } catch (err: any) {
    console.error('[salesAgent]', action, 'failed', err);
    return res.status(500).json({ error: 'Agjentja pati një gabim', detail: String(err?.message || err).slice(0, 300) });
  }
}

export { notifyHandoff, HANDOFF_LINE, AGENT_AUTOMATION_KIND, TZ as SALES_AGENT_TZ, shiftDateKey, zonedTimeMs };
export type { CallerIdentity };
