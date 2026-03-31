import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { adminAuth, adminDb } from './_firebaseAdmin';

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

  const { messages, context } = req.body;

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
    systemMessage += '\n\nKonteksti aktual i përdoruesit:';
    if (context.currentView) systemMessage += `\n- Faqja aktuale: ${context.currentView}`;
    if (context.userRole) systemMessage += `\n- Roli: ${context.userRole}`;
    if (context.teamName) systemMessage += `\n- Ekipi: ${context.teamName}`;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'AI service not configured' });
  }

  try {
    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemMessage },
        ...messages.slice(-10).map((m: any) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content.slice(0, 4000),
        })),
      ],
      max_tokens: 1500,
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content || 'Nuk munda të gjeneroj përgjigje.';

    // Log usage (non-blocking)
    adminDb.collection('aiUsageLogs').add({
      userId: uid,
      tokensUsed: completion.usage?.total_tokens || 0,
      model: 'gpt-4o-mini',
      createdAt: new Date(),
    }).catch(() => {});

    return res.status(200).json({ reply });
  } catch (err: any) {
    console.error('AI Chat error:', err);
    if (err?.status === 429) {
      return res.status(429).json({ error: 'Serveri AI është i ngarkuar. Provoni përsëri.' });
    }
    return res.status(500).json({ error: 'Gabim i brendshëm' });
  }
}
