import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { adminAuth, adminDb } from './_firebaseAdmin.js';
import { getTeamConfig } from './_tenantConfig.js';

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

  // Resolve AI config: per-team settings (from CRM Settings) take priority,
  // then fall back to environment variables.
  let teamProvider: 'gemini' | 'openai' | undefined;
  let teamApiKey: string | undefined;
  let teamModel: string | undefined;
  let teamAuthorized = false; // caller verified as member/portal-client of teamId

  if (teamId && typeof teamId === 'string') {
    try {
      // Authorize the caller for this team, either as a staff member OR as a
      // portal client linked to it (clientPortalAccess). The AI key is only
      // ever used server-side and never returned to the client, so this gate
      // exists to prevent cross-team quota abuse — not key exfiltration.
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
      if (teamAuthorized) {
        // Credentials come from the server-only vault (teamSecrets), merged in.
        const s = await getTeamConfig(teamId);
        if (s.aiApiKey) {
          teamApiKey = s.aiApiKey;
          teamProvider = s.aiProvider === 'openai' ? 'openai' : 'gemini';
          teamModel = s.aiModel || undefined;
        }
      }
    } catch (e) {
      console.error('Failed to load team AI settings:', e);
    }
  }

  const geminiKey = teamProvider === 'gemini' ? teamApiKey : process.env.GEMINI_API_KEY;
  const openaiKey = teamProvider === 'openai' ? teamApiKey : process.env.OPENAI_API_KEY;

  if (!geminiKey && !openaiKey) {
    return res.status(500).json({
      error: 'AI service not configured',
      detail: `teamId=${teamId ? 'sent' : 'none'}, authorized=${teamAuthorized}, teamKey=${!!teamApiKey}, envGemini=${!!process.env.GEMINI_API_KEY}, envOpenAI=${!!process.env.OPENAI_API_KEY}`,
    });
  }

  // Last 10 messages, capped at 4000 chars each
  const recent = messages.slice(-10).map((m: any) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content.slice(0, 4000),
  }));

  // Which provider goes first: the team's explicit choice, else whatever key exists.
  const preferGemini = teamProvider ? teamProvider === 'gemini' : !!geminiKey;

  try {
    let result: { reply: string; tokensUsed: number; model: string };

    if (preferGemini && geminiKey) {
      try {
        result = await callGemini(geminiKey, systemMessage, recent, teamModel);
      } catch (gerr: any) {
        if (openaiKey) {
          console.error('Gemini failed, falling back to OpenAI:', gerr?.message || gerr);
          result = await callOpenAI(openaiKey, systemMessage, recent);
        } else {
          throw gerr;
        }
      }
    } else if (openaiKey) {
      try {
        result = await callOpenAI(openaiKey, systemMessage, recent, teamModel);
      } catch (oerr: any) {
        if (geminiKey) {
          console.error('OpenAI failed, falling back to Gemini:', oerr?.message || oerr);
          result = await callGemini(geminiKey, systemMessage, recent);
        } else {
          throw oerr;
        }
      }
    } else {
      result = await callGemini(geminiKey!, systemMessage, recent, teamModel);
    }

    // Log usage (non-blocking)
    adminDb.collection('aiUsageLogs').add({
      userId: uid,
      tokensUsed: result.tokensUsed,
      model: result.model,
      createdAt: new Date(),
    }).catch(() => {});

    return res.status(200).json({ reply: result.reply });
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

type ChatMsg = { role: 'user' | 'assistant'; content: string };

// --- Google Gemini (free tier via Google AI Studio) ---
async function callGemini(
  apiKey: string,
  systemMessage: string,
  msgs: ChatMsg[],
  modelOverride?: string,
): Promise<{ reply: string; tokensUsed: number; model: string }> {
  const model = modelOverride || process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Gemini uses 'user' / 'model' roles instead of 'user' / 'assistant'
  const contents = msgs.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemMessage }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 1500 },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    const err: any = new Error(`Gemini API ${resp.status}: ${body.slice(0, 300)}`);
    err.statusCode = resp.status;
    throw err;
  }

  const data: any = await resp.json();
  const reply =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ||
    'Nuk munda të gjeneroj përgjigje.';
  const tokensUsed = data?.usageMetadata?.totalTokenCount || 0;

  return { reply, tokensUsed, model };
}

// --- OpenAI (fallback) ---
async function callOpenAI(
  apiKey: string,
  systemMessage: string,
  msgs: ChatMsg[],
  modelOverride?: string,
): Promise<{ reply: string; tokensUsed: number; model: string }> {
  const model = modelOverride || 'gpt-4o-mini';
  const openai = new OpenAI({ apiKey });

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemMessage },
      ...msgs.map((m) => ({ role: m.role, content: m.content })),
    ],
    max_tokens: 1500,
    temperature: 0.7,
  });

  const reply = completion.choices[0]?.message?.content || 'Nuk munda të gjeneroj përgjigje.';
  return { reply, tokensUsed: completion.usage?.total_tokens || 0, model };
}
