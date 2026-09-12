import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminAuth, adminDb } from './_firebaseAdmin.js';
import { generateChatWith, resolveAiConfig, type ChatMsg } from './_aiProvider.js';

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

// Rate limiting: max 20 requests per user per hour
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();

  // Purge expired entries to prevent unbounded memory growth
  for (const [key, val] of rateLimitMap) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }

  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + 3600000 });
    return true;
  }
  if (entry.count >= 20) return false;
  entry.count++;
  return true;
}

/**
 * POST /api/ai-chat — FivoAI assistant.
 *
 * Provider resolution (tenant key from teamSecrets, env fallback, Gemini ⇄ OpenAI
 * fallback) lives in `api/_aiProvider.ts`, shared with the GMB review drafts and
 * the WhatsApp "Sugjerim AI". This file keeps only what is specific to the chat:
 * auth, the per-user rate limit, the team-membership gate and the usage log.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify Firebase Auth token
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
    uid = decoded.uid;
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Rate limit
  if (!checkRateLimit(uid)) {
    return res.status(429).json({ error: 'Keni arritur limitin e kërkesave. Provoni përsëri pas pak.' });
  }

  const { messages, context, teamId } = req.body;

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

  // The team's AI key is used only when the caller is a member OR a portal client
  // of that team. The key never reaches the client either way — this gate exists
  // to prevent cross-team quota abuse, not key exfiltration.
  let teamAuthorized = false;
  if (teamId && typeof teamId === 'string') {
    try {
      const [memberSnap, portalSnap] = await Promise.all([
        adminDb.collection('teamMembers')
          .where('teamId', '==', teamId)
          .where('userId', '==', uid)
          .limit(1)
          .get(),
        adminDb.collection('clientPortalAccess')
          .where('userId', '==', uid)
          .limit(20)
          .get(),
      ]);
      const isMember = !memberSnap.empty;
      const isPortalClient = portalSnap.docs.some((d) => d.data()?.teamId === teamId);
      teamAuthorized = isMember || isPortalClient;
    } catch (e) {
      console.error('Failed to verify team membership for AI chat:', e);
    }
  }

  const scopedTeamId = teamAuthorized && typeof teamId === 'string' ? teamId : null;
  const cfg = await resolveAiConfig(scopedTeamId);

  if (!cfg.hasKey) {
    return res.status(500).json({
      error: 'AI service not configured',
      detail: `teamId=${teamId ? 'sent' : 'none'}, authorized=${teamAuthorized}, teamKey=${!!cfg.preferred}, envGemini=${!!process.env.GEMINI_API_KEY}, envOpenAI=${!!process.env.OPENAI_API_KEY}`,
    });
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
      feature: 'chat',
      tokensUsed: result.tokensUsed,
      model: result.model,
      provider: result.provider,
      createdAt: new Date(),
    }).catch(() => {});

    return res.status(200).json({ reply });
  } catch (err: any) {
    console.error('AI Chat error:', err);
    if (err?.status === 429 || err?.statusCode === 429) {
      return res.status(429).json({
        error: 'Serveri AI është i ngarkuar. Provoni përsëri.',
        detail: String(err?.message || err).slice(0, 400),
      });
    }
    return res.status(500).json({
      error: 'Gabim i brendshëm',
      detail: String(err?.message || err).slice(0, 400),
    });
  }
}
