/**
 * "Sugjerim AI" for a WhatsApp thread — AI PROPOSES, a person SENDS.
 *
 * `draftWaReply()` reads the last ≤10 messages of the thread, the conversation
 * and the contact, asks the tenant's AI provider for a short Albanian reply and
 * stores it ON THE CONVERSATION DOCUMENT:
 *
 *   conversations/wa-{teamId}-{phone} {
 *     suggestedReply:         string   — the text the UI offers ("Dërgo / Ndrysho / Rigjenero")
 *     suggestedAt:            Timestamp
 *     suggestedForMessageId:  string   — the inbound `whatsappMessages` id it answers
 *     suggestedModel:         string   — e.g. "gemini-2.5-flash"
 *   }
 *
 * Nothing here sends anything. `waAiAssist: 'auto'` deliberately does not exist
 * (owner decision) — an unsupervised bot talking to prospects is the one thing
 * that cannot be undone.
 *
 * Callers: `_waInbound.ts` step 8 (best-effort, after every inbound text) and
 * `POST /api/ai-reply` (staff pressed "Rigjenero"; `force` skips the burst guard,
 * the endpoint's own per-user rate limit covers abuse).
 *
 * Limits (all named, never silent):
 *   burst      — a suggestion was stored < 60s ago for this thread
 *   daily-cap  — `waAiDailyCap` (200) per team per local day, counted in
 *                `aiDailyUsage/{teamId}_{yyyy-mm-dd}` inside a transaction
 *   every call — one `aiUsageLogs` row (teamId, feature 'wa-reply', tokens, model)
 */
import { adminDb, Timestamp } from './_firebaseAdmin.js';
import { getTeamConfig } from './_tenantConfig.js';
import { generateChatWith, resolveAiConfig, type ChatMsg } from './_aiProvider.js';

export const WA_REPLY_MAX_CHARS = 400;
export const WA_REPLY_BURST_MS = 60_000;
export const DEFAULT_WA_AI_DAILY_CAP = 200;
const HISTORY_LIMIT = 10;
const TIMEZONE = 'Europe/Tirane';

export type WaAiAssistMode = 'off' | 'draft';

export interface WaReplyPromptInput {
  businessName: string;
  /** `teamSettings.waAiContext` — services, hours, pricing POLICY (never a secret). */
  aiContext: string;
  contactName: string;
  contactKind: 'lead' | 'customer' | 'unknown';
  leadStatus?: string | null;
  /** Oldest → newest. */
  lastMessages: Array<{ direction: 'inbound' | 'outbound'; text: string }>;
}

export type DraftBlockReason =
  | 'off'              // waAiAssist === 'off'
  | 'no-key'           // neither the tenant nor the platform has an AI key
  | 'burst'            // a suggestion was stored < 60s ago
  | 'daily-cap'        // waAiDailyCap reached for today
  | 'no-conversation'  // conversation id does not resolve to a phone
  | 'no-messages'      // nothing inbound to answer
  | 'empty'            // the model returned nothing usable
  | 'error';

export type DraftWaReplyResult =
  | { ok: true; conversationId: string; suggestedReply: string; model: string; forMessageId: string | null }
  | { ok: false; blocked: DraftBlockReason; error?: string };

export interface DraftWaReplyOptions {
  /** Skip the 60s burst guard (on-demand "Rigjenero"). */
  force?: boolean;
  /** Staff uid for the usage log (null for the inbound handler). */
  byUid?: string | null;
  /** Already-resolved tenant config (saves a read when the handler has it). */
  settings?: Record<string, any>;
  businessId?: string | null;
  /** The inbound message this suggestion answers (defaults to the newest inbound in the thread). */
  forMessageId?: string | null;
}

/** `'draft'` when explicitly set, or by default when a key exists; `'off'` otherwise. */
export function resolveWaAiAssist(settings: Record<string, any> | null | undefined, hasKey: boolean): WaAiAssistMode {
  const v = settings?.waAiAssist;
  if (v === 'off') return 'off';
  if (v === 'draft') return hasKey ? 'draft' : 'off';
  return hasKey ? 'draft' : 'off';
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function buildWaReplyPrompt(i: WaReplyPromptInput): { system: string; messages: ChatMsg[] } {
  const biz = clip(i.businessName, 120) || 'biznesi';
  const ctx = clip(i.aiContext, 2500);
  const who = i.contactKind === 'customer' ? 'klient ekzistues'
    : i.contactKind === 'lead' ? `klient potencial (lead${i.leadStatus ? `, statusi: ${clip(i.leadStatus, 40)}` : ''})`
    : 'kontakt i panjohur';

  const system = [
    `Ti shkruan draftin e përgjigjes në WhatsApp për stafin e "${biz}". Një person do ta lexojë, ndryshojë dhe dërgojë — ti vetëm propozon.`,
    '',
    'RREGULLA TË PANEGOCIUESHME:',
    '1. Vetëm shqip, ton profesional dhe i ngrohtë, në vetën e parë shumës ("ne").',
    `2. 2–3 fjali, maksimumi ${WA_REPLY_MAX_CHARS} karaktere. Tekst i thjeshtë: pa emoji, pa markdown, pa thonjëza rreth përgjigjes, pa etiketa si "Përgjigje:".`,
    '3. KURRË mos shpik çmime, data, afate, disponueshmëri, zbritje ose premtime që nuk gjenden fjalë për fjalë në KONTEKSTIN e biznesit më poshtë. Kur pyetja kërkon një të tillë, thuaj se një koleg do ta konfirmojë shpejt.',
    '4. Kur pyetja është komerciale (ofertë, çmim, kontratë, takim), mbyll me një handoff të butë: p.sh. "Një koleg nga ekipi ju kontakton sot për detajet."',
    '5. Mos përsërit pyetjen e klientit, mos kërko falje pa arsye, mos përmend që je AI.',
    '6. Nëse mesazhi i fundit nuk kërkon përgjigje (p.sh. "faleminderit"), përgjigju shkurt dhe miqësisht me një fjali.',
    '',
    `KONTEKSTI I BIZNESIT (i vetmi burim faktesh):`,
    ctx || '(pa kontekst — mos jep asnjë fakt konkret; ofro vetëm ndihmë dhe handoff te një koleg)',
  ].join('\n');

  const transcript = i.lastMessages
    .filter((m) => clip(m.text, 1).length > 0)
    .map((m) => `${m.direction === 'inbound' ? 'KLIENTI' : 'NE'}: ${clip(m.text, 600)}`)
    .join('\n');

  const user = [
    `Kontakti: ${clip(i.contactName, 80) || 'pa emër'} (${who}).`,
    'Biseda e fundit (nga më e vjetra te më e reja):',
    transcript || '(bosh)',
    '',
    'Shkruaj VETËM tekstin e përgjigjes sonë për mesazhin e fundit të klientit.',
  ].join('\n');

  return { system, messages: [{ role: 'user', content: user }] };
}

// ── Post-processing (the guardrails the model may ignore) ─────────────────────

const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;

/** Strips quotes/markdown/emoji/labels and cuts to ≤400 chars at a sentence boundary. */
export function postProcessWaReply(raw: string): string {
  let t = String(raw ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(EMOJI_RE, '')
    .replace(/^\s*(përgjigj[ae]|pergjigj[ae]|drafti?|reply|mesazhi)\s*:\s*/i, '')
    .replace(/(\*\*|__|`|~~|#+\s?)/g, '')
    .replace(/(^|\n)\s*[-*•]\s+/g, '$1')
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
  // Surrounding quotes around the whole answer.
  if (/^["'].*["']$/s.test(t) && t.length > 2) t = t.slice(1, -1).trim();
  t = t.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  if (t.length <= WA_REPLY_MAX_CHARS) return t;
  const head = t.slice(0, WA_REPLY_MAX_CHARS);
  const lastStop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('.\n'));
  if (lastStop > WA_REPLY_MAX_CHARS * 0.4) return head.slice(0, lastStop + 1).trim();
  if (/[.!?]$/.test(head.trim())) return head.trim();
  const lastSpace = head.lastIndexOf(' ');
  return `${head.slice(0, lastSpace > 0 ? lastSpace : head.length).trim()}…`;
}

// ── Draft ─────────────────────────────────────────────────────────────────────

const toMs = (v: any): number => {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
};

function dayKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Reserve one slot of the team's daily AI budget; false when the cap is reached. */
async function reserveDailySlot(teamId: string, businessId: string | null, cap: number): Promise<boolean> {
  const now = Timestamp.now();
  const day = dayKey(new Date());
  const ref = adminDb.collection('aiDailyUsage').doc(`${teamId}_${day}`);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = Number((snap.data() as any)?.count || 0);
    if (count >= cap) return false;
    tx.set(ref, {
      teamId,
      businessId: businessId ?? null,
      date: day,
      count: count + 1,
      updatedAt: now,
      ...(snap.exists ? {} : { createdAt: now }),
    }, { merge: true });
    return true;
  });
}

/** `wa-{teamId}-{phone}` → phone (the id embeds both; the doc may not exist yet). */
function phoneFromConversationId(teamId: string, conversationId: string): string | null {
  const prefix = `wa-${teamId}-`;
  if (!conversationId.startsWith(prefix)) return null;
  const phone = conversationId.slice(prefix.length).replace(/\D/g, '');
  return phone || null;
}

export async function draftWaReply(
  teamId: string,
  conversationId: string,
  opts: DraftWaReplyOptions = {},
): Promise<DraftWaReplyResult> {
  try {
    const settings = opts.settings ?? await getTeamConfig(teamId);
    const aiCfg = await resolveAiConfig(teamId);
    const mode = resolveWaAiAssist(settings, aiCfg.hasKey);
    if (mode === 'off') return { ok: false, blocked: aiCfg.hasKey ? 'off' : 'no-key' };

    const convRef = adminDb.collection('conversations').doc(conversationId);
    const convSnap = await convRef.get();
    const conv = (convSnap.data() as any) || null;
    const phone: string | null = (conv?.phone as string | undefined) || phoneFromConversationId(teamId, conversationId);
    if (!phone) return { ok: false, blocked: 'no-conversation' };

    if (!opts.force && conv?.suggestedForMessageId && Date.now() - toMs(conv.suggestedAt) < WA_REPLY_BURST_MS) {
      return { ok: false, blocked: 'burst' };
    }

    // Facts: thread (existing index teamId+phone+createdAt), contact, business name.
    const [msgSnap, businessName] = await Promise.all([
      adminDb.collection('whatsappMessages')
        .where('teamId', '==', teamId)
        .where('phone', '==', phone)
        .orderBy('createdAt', 'desc')
        .limit(HISTORY_LIMIT)
        .get(),
      resolveBusinessName(settings, opts.businessId ?? conv?.businessId ?? null),
    ]);
    const docs = msgSnap.docs.slice().reverse();
    const lastMessages = docs.map((d) => {
      const m = d.data() as any;
      return { direction: (m.direction === 'outbound' ? 'outbound' : 'inbound') as 'inbound' | 'outbound', text: String(m.message ?? m.text ?? ''), id: d.id };
    }).filter((m) => m.text && m.text !== '[Media]');
    const newestInbound = [...lastMessages].reverse().find((m) => m.direction === 'inbound') || null;
    if (!newestInbound) return { ok: false, blocked: 'no-messages' };
    const forMessageId = opts.forMessageId ?? newestInbound.id;

    let contactName = String(conv?.subject || '');
    let contactKind: WaReplyPromptInput['contactKind'] = 'unknown';
    let leadStatus: string | null = null;
    try {
      if (conv?.customerId) {
        const c = (await adminDb.collection('customers').doc(conv.customerId).get()).data() as any;
        if (c) { contactKind = 'customer'; contactName = c.name || contactName; }
      } else if (conv?.leadId) {
        const l = (await adminDb.collection('leads').doc(conv.leadId).get()).data() as any;
        if (l) { contactKind = 'lead'; contactName = l.name || contactName; leadStatus = l.status || null; }
      }
    } catch { /* the name is cosmetic */ }

    const capRaw = Number(settings?.waAiDailyCap);
    const cap = Number.isFinite(capRaw) && capRaw > 0 ? Math.floor(capRaw) : DEFAULT_WA_AI_DAILY_CAP;
    const businessId = opts.businessId ?? conv?.businessId ?? null;
    if (!(await reserveDailySlot(teamId, businessId, cap))) return { ok: false, blocked: 'daily-cap' };

    const prompt = buildWaReplyPrompt({
      businessName,
      aiContext: typeof settings?.waAiContext === 'string' ? settings.waAiContext : '',
      contactName,
      contactKind,
      leadStatus,
      lastMessages: lastMessages.map(({ direction, text }) => ({ direction, text })),
    });
    const result = await generateChatWith(aiCfg, prompt.system, prompt.messages, { maxTokens: 300, temperature: 0.4 });
    const suggestedReply = postProcessWaReply(result.reply);

    adminDb.collection('aiUsageLogs').add({
      userId: opts.byUid ?? null,
      teamId,
      businessId,
      feature: 'wa-reply',
      conversationId,
      tokensUsed: result.tokensUsed,
      model: result.model,
      provider: result.provider,
      createdAt: new Date(),
    }).catch(() => {});

    if (!suggestedReply) return { ok: false, blocked: 'empty' };

    const now = Timestamp.now();
    await convRef.set({
      // Minimal identity when the doc does not exist yet (on-demand for a thread
      // the inbound handler has not seen) — enough for the business-scoped read rule.
      ...(convSnap.exists ? {} : { channel: 'whatsapp', teamId, phone, businessId, createdAt: now }),
      suggestedReply,
      suggestedAt: now,
      suggestedForMessageId: forMessageId,
      suggestedModel: result.model,
      suggestedByUid: opts.byUid ?? null,
      updatedAt: now,
    }, { merge: true });

    return { ok: true, conversationId, suggestedReply, model: result.model, forMessageId };
  } catch (err: any) {
    console.error('[aiReply] draft failed', { teamId, conversationId, err: err?.message || err });
    return { ok: false, blocked: 'error', error: String(err?.message || err).slice(0, 300) };
  }
}

async function resolveBusinessName(settings: Record<string, any> | null | undefined, businessId: string | null): Promise<string> {
  const fromSettings = settings?.companyName || settings?.emailFromName;
  if (typeof fromSettings === 'string' && fromSettings.trim()) return fromSettings.trim();
  if (businessId) {
    try {
      const b = (await adminDb.collection('businesses').doc(businessId).get()).data() as any;
      if (b?.name) return String(b.name);
    } catch { /* fall through */ }
  }
  return '';
}
