import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb } from './_firebaseAdmin.js';
import { generateChatWith, resolveAiConfig, type ChatMsg } from './_aiProvider.js';
import { classifyAiError } from './_aiErrors.js';
import { checkPersistentRateLimit } from './_rateLimit.js';
import { authenticate, isPortalOnlyToken, activeMembership, businessIdOfTeam } from './_callerIdentity.js';

const SYSTEM_PROMPT = `Ti je FivoAI, asistenti inteligjent i platformës FivoCRM. Flet shqip dhe ndihmon stafin dhe klientët me detyra specifike biznesi.

Mundësitë e tua:
- Shkruaj email profesionale për klientë
- Gjenero përshkrime projektesh dhe propozime
- Ndihmo me planifikimin e detyrave dhe prioritizimin
- Shkruaj postime për rrjete sociale (Instagram, Facebook, LinkedIn)
- Gjenero tekste marketing dhe copy
- Analizo të dhëna dhe jep rekomandime biznesi
- Ndihmo me çmime dhe oferta
- Shkruaj përgjigje profesionale për klientë

Rregullat:
- Përgjigju GJITHMONË në shqip, përveç kur kërkohet ndryshe
- Ji profesional por miqësor
- Jep përgjigje të strukturuara me bullet points kur duhet
- Kur shkruan email apo propozime, përdor format HTML bazik (bold, paragrafë, lista)
- Mos shpik informacion. Nëse nuk di, thuaj "Nuk kam informacion të mjaftueshëm"
- Ji konciz — mos shkruaj paragrafë të gjata pa nevojë`;

// Persistent (Firestore-backed) per-user ceiling. The old in-memory Map was per
// instance and reset on every cold start, so it never limited anything under load.
const CHAT_PER_HOUR = 30;

/**
 * POST /api/ai-chat — FivoAI assistant.
 *
 * Provider resolution (tenant key from teamSecrets, env fallback, Gemini ⇄ OpenAI
 * fallback) lives in `api/_aiProvider.ts`, shared with the GMB review drafts and
 * the WhatsApp "Sugjerim AI". This file keeps only what is specific to the chat:
 * auth, the per-user rate limit, the team-membership gate and the usage log.
 *
 * Who pays (audit Sep 2026): the PLATFORM's API key is spent only for a caller with
 * a proven STAFF tenant (claim `bid`, or an active membership in the requested
 * team). A portal client may chat only when THEIR tenant configured its own key
 * (`cfg.preferred` set) — otherwise 403, never the platform's budget.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const c = await authenticate(req);
  if (!c) return res.status(401).json({ error: 'Missing or invalid token' });
  const uid = c.uid;

  if (!(await checkPersistentRateLimit('aiChat', uid, CHAT_PER_HOUR))) {
    return res.status(429).json({ error: 'Keni arritur limitin e kërkesave. Provoni përsëri pas pak.' });
  }

  const { messages, context, teamId } = (req.body || {}) as Record<string, any>;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages array required' });
  }

  // Validate message format
  for (const msg of messages) {
    if (!msg.role || !msg.content || typeof msg.content !== 'string') {
      return res.status(400).json({ error: 'Invalid message format' });
    }
    if (!['user', 'assistant'].includes(msg.role)) {
      return res.status(400).json({ error: 'Invalid message role' });
    }
    if (msg.content.length > 4000) {
      return res.status(400).json({ error: 'Message too long (max 4000 chars)' });
    }
  }

  // Build context-aware system message
  let systemMessage = SYSTEM_PROMPT;
  if (context) {
    const sanitize = (v: unknown) => typeof v === 'string' ? v.slice(0, 100).replace(/[\n\r]/g, ' ') : '';
    systemMessage += '\n\nKonteksti aktual i përdoruesit:';
    if (context.currentView) systemMessage += `\n- Faqja aktuale: ${sanitize(context.currentView)}`;
    if (context.userRole) systemMessage += `\n- Roli: ${sanitize(context.userRole)}`;
    if (context.teamName) systemMessage += `\n- Ekipi: ${sanitize(context.teamName)}`;
  }

  // The team's AI key is used only when the caller is an ACTIVE member OR a portal
  // client of that team. The key never reaches the client either way — this gate
  // exists to prevent cross-team quota abuse, not key exfiltration.
  let staffOfTeam = false;
  let portalOfTeam = false;
  const wantedTeam = typeof teamId === 'string' && teamId ? teamId : null;
  if (wantedTeam) {
    try {
      // The platform operator manages every tenant's key and tests it from the
      // console ("Testo lidhjen" on /superadmin/tenants/:id).
      if (c.superAdmin) staffOfTeam = true;
      else if (!isPortalOnlyToken(c)) {
        staffOfTeam = c.tid === wantedTeam && !!c.bid
          ? true
          : !!(await activeMembership(uid, { teamId: wantedTeam }));
      }
      if (!staffOfTeam) {
        const teamBid = await businessIdOfTeam(wantedTeam);
        if (c.pbid && c.pbid === teamBid) portalOfTeam = true;
        else {
          const portalSnap = await adminDb.collection('clientPortalAccess').where('userId', '==', uid).limit(20).get();
          portalOfTeam = portalSnap.docs.some((d) => {
            const a = d.data() || {};
            return (a.status ?? 'Active') === 'Active' && (a.teamId === wantedTeam || a.businessId === teamBid);
          });
        }
      }
    } catch (e) {
      console.error('Failed to verify team membership for AI chat:', e);
    }
  }

  // A proven staff tenant: the requested team, or the token's own `bid` (no team named).
  const provenStaff = staffOfTeam || (!wantedTeam && !!c.bid && !isPortalOnlyToken(c)) || c.superAdmin;
  const scopedTeamId = (staffOfTeam || portalOfTeam) && wantedTeam ? wantedTeam : null;
  const cfg = await resolveAiConfig(scopedTeamId);

  // Only a tenant's OWN key may serve a caller who is not proven staff.
  if (!provenStaff && !cfg.preferred) {
    return res.status(403).json({ error: 'Asistenti AI nuk është i disponueshëm për këtë llogari.' });
  }
  if (!cfg.hasKey) {
    console.error('[ai-chat] no AI key', { teamId: wantedTeam, staffOfTeam, portalOfTeam, teamKey: !!cfg.preferred });
    return res.status(503).json({ error: 'AI nuk është konfiguruar (Cilësimet → Integrime).' });
  }

  // Last 10 messages, capped at 4000 chars each
  const recent: ChatMsg[] = messages.slice(-10).map((m: any) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content.slice(0, 4000),
  }));

  try {
    const result = await generateChatWith(cfg, systemMessage, recent, { maxTokens: 1500, temperature: 0.7 });
    const reply = result.reply || 'Nuk munda të gjeneroj përgjigje.';

    // Log usage (non-blocking)
    adminDb.collection('aiUsageLogs').add({
      userId: uid,
      teamId: scopedTeamId,
      businessId: c.bid || c.pbid || null,
      feature: 'chat',
      tokensUsed: result.tokensUsed,
      model: result.model,
      provider: result.provider,
      createdAt: new Date(),
    }).catch(() => {});

    // `provider` / `model` let Cilësimet → FivoAI "Testo lidhjen" say WHAT answered.
    return res.status(200).json({ reply, provider: result.provider, model: result.model });
  } catch (err: any) {
    // Never an opaque 500: the provider's failure is classified (invalid key, model
    // typo, quota, timeout, …) into a status + an actionable sentence, and the
    // redacted provider message travels as `detail` so the browser console shows
    // the real reason without anyone opening the Vercel logs.
    const classified = classifyAiError(err);
    console.error('[ai-chat] provider call failed', {
      code: classified.code,
      provider: cfg.preferred ?? 'platform-env',
      providerMismatch: cfg.providerMismatch,
      model: cfg.model || '(default)',
      teamId: scopedTeamId,
      detail: classified.detail,
    });
    // The provider layer already retried a configured model that 404s with the
    // default, so a `model-not-found` that reaches here means the DEFAULT is gone
    // too (or `opts.model` named it): "clear the Modeli field" would be wrong advice.
    const error = classified.code === 'model-not-found' && !cfg.model
      ? 'Modeli i parazgjedhur AI nuk ekziston më te ofruesi — shkruani një model aktual te Cilësimet → Integrime → FivoAI (fusha "Modeli").'
      : classified.message;
    return res.status(classified.httpStatus).json({
      error,
      code: classified.code,
      detail: classified.detail,
      model: cfg.model || null,
    });
  }
}
