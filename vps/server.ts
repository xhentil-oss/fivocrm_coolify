import express from 'express';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from 'baileys';
import { Boom } from '@hapi/boom';
import admin from 'firebase-admin';
import QRCode from 'qrcode';
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import cors from 'cors';
import multer from 'multer';
import pino from 'pino';
import { randomUUID } from 'crypto';

process.on('unhandledRejection', (err) => { console.error('[WA] Unhandled rejection:', err); });
process.on('uncaughtException', (err) => { console.error('[WA] Uncaught exception:', err); });

const app = express();
app.set('trust proxy', true); // respect X-Forwarded-Proto for https URLs behind a proxy
app.use(cors());
app.use(express.json());

// ── File hosting (replaces Firebase Storage for chat/comment attachments) ──────
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/files', express.static(UPLOAD_DIR, { maxAge: '7d', immutable: true }));
const uploadMw = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
// Mirror storage.rules: images / audio / video / pdf / office / text only.
// Legacy Office (.doc/.xls/.ppt = msword / vnd.ms-excel / vnd.ms-powerpoint) is
// allowed alongside the OOXML "officedocument" types — the CRM document upload
// accepts both generations.
const ALLOWED_UPLOAD = /^(image\/(png|jpe?g|gif|webp)|audio\/.*|video\/.*|application\/(pdf|msword|vnd\.ms-excel|vnd\.ms-powerpoint)|application\/.*officedocument.*|text\/(plain|csv))$/;

// Verify a Firebase ID token (so clients never need the VPS API secret to upload).
async function requireFirebaseAuth(req: any, res: any, next: any) {
  const h = req.headers.authorization as string | undefined;
  if (!h?.startsWith('Bearer ')) { res.status(401).json({ error: 'Mungon token-i i autentikimit' }); return; }
  try {
    const decoded = await admin.auth().verifyIdToken(h.slice(7));
    req.uid = decoded.uid;
    next();
  } catch {
    res.status(401).json({ error: 'Token i pavlefshëm' });
  }
}

// ── Config ────────────────────────────────────────────────────────────────────
const API_SECRET = process.env.API_SECRET;
const PORT = parseInt(process.env.PORT || '3001');
const DEFAULT_TEAM_ID = process.env.TEAM_ID || '';
// WHMCS API base URL — used by the /whmcs-proxy relay so WHMCS sees this VPS's
// static IP instead of Vercel's dynamic IPs (avoids WHMCS "Invalid IP").
const WHMCS_API_URL = process.env.WHMCS_API_URL || '';

if (!API_SECRET) { console.error('[VPS] ERROR: API_SECRET env variable mungon!'); process.exit(1); }

// ── Firebase Admin ────────────────────────────────────────────────────────────
let saJson: object;
const _saEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;
if (_saEnv) {
  saJson = JSON.parse(_saEnv);
} else if (existsSync('./firebase-service-account.json')) {
  saJson = JSON.parse(readFileSync('./firebase-service-account.json', 'utf8'));
} else { console.error('[VPS] ERROR: Firebase credentials nuk u gjetën!'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(saJson as admin.ServiceAccount) });
const db = admin.firestore();

// ── Types ─────────────────────────────────────────────────────────────────────
type ConnectionStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'connected';

interface AgentConfig {
  id: string;
  teamId: string;
  label: string;
  assignedToUserId?: string;
  enabled: boolean;
}

interface AgentState {
  config: AgentConfig;
  sock: ReturnType<typeof makeWASocket> | null;
  authKeys: any | null;
  connectionStatus: ConnectionStatus;
  qrDataUrl: string | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  lidResyncTimer: ReturnType<typeof setInterval> | null;
  cacheEvictTimer: ReturnType<typeof setInterval> | null;
  isSyncing: boolean;
  lidToPhoneMap: Map<string, string>;
  pendingLidMessages: Map<string, string[]>;
  leadPhoneCache: Map<string, { leadId: string; leadName: string | null }>;
  syncedContactNames: Map<string, string>;
  /** The actual WhatsApp number connected to this agent (digits-only, e.g. "35569…"). Set on connection.open. */
  connectedPhone: string | null;
}

function createAgentState(config: AgentConfig): AgentState {
  return {
    config, sock: null, authKeys: null,
    connectionStatus: 'disconnected', qrDataUrl: null,
    reconnectTimer: null, lidResyncTimer: null, cacheEvictTimer: null,
    isSyncing: false,
    lidToPhoneMap: new Map(),
    pendingLidMessages: new Map(),
    leadPhoneCache: new Map(),
    syncedContactNames: new Map(),
    connectedPhone: null,
  };
}

const agents = new Map<string, AgentState>();

// ── Rate limit (per-agent) ──────────────────────────────────────────────────
const SEND_RATE_WINDOW_MS = 60_000;
const SEND_RATE_MAX = 30;
const sendRateBuckets: Map<string, number[]> = new Map();
function checkSendRate(agentId: string): boolean {
  const now = Date.now();
  const cutoff = now - SEND_RATE_WINDOW_MS;
  const recent = (sendRateBuckets.get(agentId) || []).filter((t) => t > cutoff);
  if (recent.length >= SEND_RATE_MAX) {
    sendRateBuckets.set(agentId, recent);
    return false;
  }
  recent.push(now);
  sendRateBuckets.set(agentId, recent);
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const normalizePhone = (phone: string): string => {
  const digits = phone.replace(/[^\d]/g, '');
  if (/^3550[6-9]/.test(digits)) return '355' + digits.slice(4);
  if (/^0[6-9]/.test(digits)) return '355' + digits.slice(1);
  return digits;
};

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (req.headers['x-api-key'] !== API_SECRET) { res.status(401).json({ error: 'Unauthorized' }); return; }
  next();
}

const authDir = (agentId: string) => {
  // backward compat: if default agent and old auth_info exists, keep using it
  if (agentId === 'default' && existsSync('./auth_info')) return './auth_info';
  return `./auth_info_${agentId}`;
};

// ── Per-agent functions ───────────────────────────────────────────────────────

async function lookupLeadByPhone(agent: AgentState, phone: string): Promise<{ leadId: string | null; leadName: string | null }> {
  const cached = agent.leadPhoneCache.get(phone);
  if (cached) return cached;
  try {
    let snap = await db.collection('leads').where('teamId', '==', agent.config.teamId).where('phoneNumber', '==', phone).limit(1).get();
    if (!snap.empty) {
      const result = { leadId: snap.docs[0].id, leadName: snap.docs[0].data().name || null };
      agent.leadPhoneCache.set(phone, result); return result;
    }
    snap = await db.collection('leads').where('teamId', '==', agent.config.teamId).where('phone', '==', phone).limit(1).get();
    if (!snap.empty) {
      const result = { leadId: snap.docs[0].id, leadName: snap.docs[0].data().name || null };
      agent.leadPhoneCache.set(phone, result); return result;
    }
  } catch { /* non-critical */ }
  return { leadId: null, leadName: null };
}

async function persistLidMapping(agent: AgentState, lid: string, phoneJid: string): Promise<void> {
  try {
    const docId = `${agent.config.id}_${lid.replace(/[@.]/g, '_')}`;
    await db.collection('lidMappings').doc(docId).set({
      lid, phoneJid, teamId: agent.config.teamId, agentId: agent.config.id,
      updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
    }, { merge: true });
  } catch (e) { console.error(`[${agent.config.id}] Error persisting LID:`, e); }
}

async function backfillLidMessages(agent: AgentState, lidJid: string, phoneJid: string): Promise<void> {
  const lidPhone = normalizePhone(lidJid.split('@')[0]);
  const realPhone = normalizePhone(phoneJid.split('@')[0]);
  if (!lidPhone || !realPhone || lidPhone === realPhone) return;
  try {
    const snap = await db.collection('whatsappMessages').where('teamId', '==', agent.config.teamId).where('phone', '==', lidPhone).get();
    if (snap.empty) return;
    const batch = db.batch(); let count = 0;
    for (const doc of snap.docs) {
      batch.update(doc.ref, { phone: realPhone, jid: phoneJid, updatedAt: admin.firestore.Timestamp.fromDate(new Date()) });
      if (++count >= 500) break;
    }
    await batch.commit();
    console.log(`[${agent.config.id}] Backfill: ${lidPhone} → ${realPhone} (${count} msgs)`);
  } catch (e) { console.error(`[${agent.config.id}] Backfill error:`, e); }
}

async function registerLidMapping(agent: AgentState, lid: string, phoneJid: string): Promise<void> {
  if (!lid || !phoneJid || agent.lidToPhoneMap.has(lid)) return;
  agent.lidToPhoneMap.set(lid, phoneJid);
  console.log(`[${agent.config.id}] LID: ${lid} → ${phoneJid} (${agent.lidToPhoneMap.size} total)`);
  persistLidMapping(agent, lid, phoneJid);
  backfillLidMessages(agent, lid, phoneJid);

  const queuedDocIds = agent.pendingLidMessages.get(lid);
  if (queuedDocIds?.length) {
    const phone = normalizePhone(phoneJid.split('@')[0]);
    const batch = db.batch();
    for (const docId of queuedDocIds) {
      batch.update(db.collection('whatsappMessages').doc(docId), {
        phone, jid: phoneJid, isLid: false, updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
      });
    }
    try { await batch.commit(); agent.pendingLidMessages.delete(lid); }
    catch (e) { console.error(`[${agent.config.id}] Error updating queued LID docs:`, e); }
  }
}

async function syncContactName(agent: AgentState, jid: string, displayName: string): Promise<void> {
  const phone = normalizePhone(jid.split('@')[0]);
  if (!phone || !displayName || agent.syncedContactNames.get(phone) === displayName) return;
  agent.syncedContactNames.set(phone, displayName);
  try {
    const snap = await db.collection('whatsappMessages').where('teamId', '==', agent.config.teamId).where('phone', '==', phone).limit(500).get();
    if (snap.empty) return;
    const batch = db.batch(); let count = 0;
    for (const doc of snap.docs) {
      const data = doc.data();
      if (!data.leadId && (!data.pushName || data.pushName !== displayName)) {
        batch.update(doc.ref, { pushName: displayName, leadName: displayName, updatedAt: admin.firestore.Timestamp.fromDate(new Date()) });
        count++;
      }
    }
    if (count > 0) await batch.commit();
  } catch (e) { console.error(`[${agent.config.id}] Contact sync error:`, e); }
}

async function readBaileysLidMappings(agent: AgentState): Promise<void> {
  if (!agent.authKeys) return;
  const dir = authDir(agent.config.id);
  if (!existsSync(dir)) return;
  try {
    const { readdirSync } = await import('fs');
    const files = readdirSync(dir);
    const lidMappingFiles = files.filter(f => f.startsWith('lid-mapping-'));
    if (!lidMappingFiles.length) return;

    const reverseKeys = lidMappingFiles.filter(f => f.includes('_reverse')).map(f => f.replace('lid-mapping-', '').replace('.json', ''));
    if (reverseKeys.length) {
      const stored = await agent.authKeys.get('lid-mapping', reverseKeys);
      for (const [key, pnUser] of Object.entries(stored)) {
        if (!pnUser || typeof pnUser !== 'string') continue;
        registerLidMapping(agent, `${key.replace('_reverse', '')}@lid`, `${pnUser}@s.whatsapp.net`);
      }
    }
    const forwardKeys = lidMappingFiles.filter(f => !f.includes('_reverse')).map(f => f.replace('lid-mapping-', '').replace('.json', ''));
    if (forwardKeys.length) {
      const stored = await agent.authKeys.get('lid-mapping', forwardKeys);
      for (const [pnUser, lidUser] of Object.entries(stored)) {
        if (!lidUser || typeof lidUser !== 'string') continue;
        registerLidMapping(agent, `${lidUser}@lid`, `${pnUser}@s.whatsapp.net`);
      }
    }
  } catch (e) { console.error(`[${agent.config.id}] Error reading Baileys LID mappings:`, e); }
}

async function loadLidMappings(agent: AgentState): Promise<void> {
  try {
    // Load agent-specific mappings first
    let snap = await db.collection('lidMappings').where('teamId', '==', agent.config.teamId).where('agentId', '==', agent.config.id).get();
    // Fallback to legacy mappings (no agentId) for backward compatibility
    if (snap.empty) snap = await db.collection('lidMappings').where('teamId', '==', agent.config.teamId).get();
    for (const doc of snap.docs) {
      const { lid, phoneJid } = doc.data();
      if (lid && phoneJid) agent.lidToPhoneMap.set(lid, phoneJid);
    }
    console.log(`[${agent.config.id}] Loaded ${agent.lidToPhoneMap.size} LID mappings`);
  } catch (e) { console.error(`[${agent.config.id}] Error loading LID mappings:`, e); }
}

async function loadPendingLidMessages(agent: AgentState): Promise<void> {
  try {
    const snap = await db.collection('whatsappMessages').where('teamId', '==', agent.config.teamId).where('isLid', '==', true).get();
    for (const doc of snap.docs) {
      const jid: string = doc.data().jid || '';
      if (jid.endsWith('@lid')) {
        const queue = agent.pendingLidMessages.get(jid) || [];
        queue.push(doc.id);
        agent.pendingLidMessages.set(jid, queue);
      }
    }
    // Resolve any known LIDs immediately
    for (const [lid, docIds] of Array.from(agent.pendingLidMessages.entries())) {
      const phoneJid = agent.lidToPhoneMap.get(lid);
      if (!phoneJid) continue;
      const phone = normalizePhone(phoneJid.split('@')[0]);
      const batch = db.batch();
      for (const docId of docIds) {
        batch.update(db.collection('whatsappMessages').doc(docId), {
          phone, jid: phoneJid, isLid: false, updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
        });
      }
      await batch.commit();
      agent.pendingLidMessages.delete(lid);
      console.log(`[${agent.config.id}] Startup resolved ${docIds.length} LID docs for ${lid}`);
    }
    console.log(`[${agent.config.id}] ${agent.pendingLidMessages.size} pending LID queues remaining`);
  } catch (e) { console.error(`[${agent.config.id}] Error loading pending LID messages:`, e); }
}

async function reverseLookupLeads(agent: AgentState): Promise<void> {
  if (!agent.sock) return;
  try {
    const { USyncQuery, USyncUser } = await import('baileys');
    const leadsSnap = await db.collection('leads').where('teamId', '==', agent.config.teamId).select('phoneNumber', 'phone', 'name').get();
    const phones = new Set<string>();
    for (const doc of leadsSnap.docs) {
      const d = doc.data();
      const p = normalizePhone(String(d.phoneNumber || d.phone || ''));
      if (p && p.length >= 7 && p.length <= 15) phones.add(p);
    }
    const phoneArr = Array.from(phones); let resolved = 0;
    for (let i = 0; i < phoneArr.length; i += 20) {
      try {
        const query = new USyncQuery();
        query.withMode('query').withContext('interactive');
        for (const phone of phoneArr.slice(i, i + 20)) { const u = new USyncUser(); u.withPhone('+' + phone); query.withUser(u); }
        query.withLIDProtocol().withContactProtocol();
        const result = await agent.sock!.executeUSyncQuery(query);
        for (const item of (result?.list) || []) {
          const lid = (item as any).lid; const id = (item as any).id;
          if (lid && id && id !== 'undefined') { registerLidMapping(agent, lid, id); resolved++; }
        }
      } catch (e) { console.error(`[${agent.config.id}] USyncQuery batch error:`, e); }
    }
    // Refresh lead cache
    agent.leadPhoneCache.clear();
    for (const doc of leadsSnap.docs) {
      const d = doc.data();
      const p = normalizePhone(String(d.phoneNumber || d.phone || ''));
      if (p) agent.leadPhoneCache.set(p, { leadId: doc.id, leadName: d.name || null });
    }
    console.log(`[${agent.config.id}] Reverse lookup: ${resolved} new mappings from ${phones.size} phones`);
  } catch (e) { console.error(`[${agent.config.id}] Reverse lookup error:`, e); }
}

async function resolveFromGroups(agent: AgentState): Promise<void> {
  if (!agent.sock) return;
  try {
    const groups = await agent.sock.groupFetchAllParticipating();
    let newMappings = 0;
    for (const group of Object.values(groups)) {
      for (const p of group.participants) {
        if (p.lid && p.id && !p.id.endsWith('@lid')) {
          const lid = p.lid.endsWith('@lid') ? p.lid : `${p.lid}@lid`;
          const pjid = p.id.endsWith('@s.whatsapp.net') ? p.id : `${p.id}@s.whatsapp.net`;
          if (!agent.lidToPhoneMap.has(lid)) { registerLidMapping(agent, lid, pjid); newMappings++; }
        }
        if ((p as any).phoneNumber && p.id?.endsWith('@lid')) {
          const pn = (p as any).phoneNumber;
          const pjid = pn.endsWith('@s.whatsapp.net') ? pn : `${pn}@s.whatsapp.net`;
          if (!agent.lidToPhoneMap.has(p.id)) { registerLidMapping(agent, p.id, pjid); newMappings++; }
        }
      }
    }
    console.log(`[${agent.config.id}] Groups: ${Object.keys(groups).length} scanned, ${newMappings} new mappings`);
  } catch (e) { console.error(`[${agent.config.id}] Group resolution error:`, e); }
}

// ── Connect per agent ─────────────────────────────────────────────────────────
async function connectAgent(agent: AgentState): Promise<void> {
  if (agent.reconnectTimer) { clearTimeout(agent.reconnectTimer); agent.reconnectTimer = null; }
  agent.connectionStatus = 'connecting';
  console.log(`[${agent.config.id}] Duke u lidhur...`);

  const dir = authDir(agent.config.id);
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  let version: [number, number, number] = [2, 3000, 1015901307];
  try { const v = await fetchLatestBaileysVersion(); version = v.version; } catch (e) { console.warn(`[${agent.config.id}] fetchLatestBaileysVersion dështoi, duke përdorur version fallback:`, e); }
  agent.authKeys = state.keys as any;

  agent.sock = makeWASocket({
    version, auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['Business CRM', 'Chrome', '1.0.0'],
    printQRInTerminal: false,
    shouldSyncHistoryMessage: () => true,
  });

  agent.sock.ev.on('creds.update', saveCreds);

  agent.sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      agent.qrDataUrl = await QRCode.toDataURL(qr);
      agent.connectionStatus = 'qr_ready';
      console.log(`[${agent.config.id}] QR gati → http://your-vps-ip:${PORT}/qr/${agent.config.id}`);
    }
    if (connection === 'close') {
      agent.connectionStatus = 'disconnected'; agent.qrDataUrl = null;
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const isLoggedOut = code === DisconnectReason.loggedOut;
      console.log(`[${agent.config.id}] Lidhja u ndërpre (${code})`);
      if (isLoggedOut) {
        try { rmSync(dir, { recursive: true, force: true }); } catch {}
        console.log(`[${agent.config.id}] Sesion u fshi — QR i ri në 3s...`);
        agent.reconnectTimer = setTimeout(() => connectAgent(agent).catch(e => console.error(`[${agent.config.id}] reconnect error:`, e)), 3000);
        return;
      }
      agent.reconnectTimer = setTimeout(() => connectAgent(agent).catch(e => console.error(`[${agent.config.id}] reconnect error:`, e)), 5000);
    }
    if (connection === 'open') {
      agent.connectionStatus = 'connected'; agent.qrDataUrl = null;
      console.log(`[${agent.config.id}] ✅ I lidhur!`);
      // Save connected phone to Firestore for UI display
      try {
        const rawId = (agent.sock as any)?.user?.id?.split(':')[0]?.split('@')[0] || '';
        const myPhone = normalizePhone(rawId);
        if (myPhone) {
          agent.connectedPhone = myPhone;
          await db.collection('whatsappAccounts').doc(agent.config.id).update({ connectedPhone: myPhone, lastConnectedAt: admin.firestore.Timestamp.fromDate(new Date()) }).catch(() => {});
        }
      } catch {}
      setTimeout(() => readBaileysLidMappings(agent), 3000);
      setTimeout(() => reverseLookupLeads(agent), 8000);
      setTimeout(() => resolveFromGroups(agent), 20000);
      if (agent.lidResyncTimer) clearInterval(agent.lidResyncTimer);
      agent.lidResyncTimer = setInterval(async () => {
        if (agent.connectionStatus === 'connected' && agent.sock) {
          await reverseLookupLeads(agent); await resolveFromGroups(agent);
        }
      }, 30 * 60 * 1000);
    }
  });

  (agent.sock.ev as any).on('lid-mapping.update', ({ lid, pn }: { lid: string; pn: string }) => { registerLidMapping(agent, lid, pn); });

  agent.sock.ev.on('contacts.upsert', (contacts) => {
    for (const c of contacts) {
      const lid = (c as any).lid as string | undefined;
      if (lid && c.id) registerLidMapping(agent, lid, c.id);
      const name = (c as any).notify || (c as any).name || null;
      if (name && c.id?.endsWith('@s.whatsapp.net')) syncContactName(agent, c.id, name);
    }
  });

  agent.sock.ev.on('contacts.update', (updates) => {
    for (const u of updates) {
      const lid = (u as any).lid as string | undefined;
      if (lid && u.id) registerLidMapping(agent, lid, u.id);
      const name = (u as any).notify || (u as any).name || null;
      if (name && u.id?.endsWith('@s.whatsapp.net')) syncContactName(agent, u.id, name);
    }
  });

  agent.sock.ev.on('messaging-history.set', (data: any) => {
    for (const m of (data.lidPnMappings || data.phoneNumberToLidMappings || [])) {
      const lid = m.lid || m.lidJid; const pn = m.pn || m.pnJid;
      if (lid && pn) registerLidMapping(agent, lid, pn);
    }
    for (const c of (data.contacts || [])) {
      const lid = (c as any).lid as string | undefined; const pn = c.id || (c as any).phoneNumber;
      if (lid && pn) registerLidMapping(agent, lid, pn);
      const name = (c as any).notify || (c as any).name || null;
      if (name && c.id?.endsWith('@s.whatsapp.net')) syncContactName(agent, c.id, name);
    }
    for (const ch of (data.chats || [])) {
      const lid = (ch as any).lid || (ch as any).lidJid; const pn = ch.id || (ch as any).pnJid;
      if (lid && pn && !pn.endsWith('@g.us')) registerLidMapping(agent, lid, pn);
    }
  });

  agent.sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      if (!msg.message) continue;
      const isFromMe = !!msg.key.fromMe;

      // Process 'notify' (live) messages for both directions.
      // Also process recent inbound 'append' messages — these are messages that arrived
      // while the VPS was briefly offline and are replayed on reconnect.
      if (type !== 'notify') {
        if (type !== 'append') continue;
        if (isFromMe) continue;
        const msgTs = Number(msg.messageTimestamp) * 1000;
        if (Date.now() - msgTs > 24 * 60 * 60 * 1000) continue;
      }

      const rawJid = msg.key.remoteJid || '';
      if (rawJid.endsWith('@g.us')) continue;

      let resolvedJid = rawJid; let isLid = false;
      if (rawJid.endsWith('@lid')) {
        const phoneJid = agent.lidToPhoneMap.get(rawJid);
        if (phoneJid) { resolvedJid = phoneJid; } else { isLid = true; }
      }

      const phone = normalizePhone(resolvedJid.split('@')[0]);
      if (!phone) continue;

      const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '[Media]';
      const ts = new Date(Number(msg.messageTimestamp) * 1000);
      const waMessageId = msg.key.id || null;
      const pushName = (msg as any).pushName || null;
      const docId = waMessageId || db.collection('whatsappMessages').doc().id;

      if (isFromMe && waMessageId) {
        const existing = await db.collection('whatsappMessages').doc(docId).get();
        if (existing.exists) continue;
      }

      const { leadId: autoLeadId, leadName: autoLeadName } = await lookupLeadByPhone(agent, phone);
      try {
        await db.collection('whatsappMessages').doc(docId).set({
          phone, jid: resolvedJid,
          direction: isFromMe ? 'outbound' : 'inbound',
          message: body, waMessageId,
          leadId: autoLeadId, leadName: autoLeadName || pushName, pushName,
          teamId: agent.config.teamId,
          agentId: agent.config.id,
          channelPhone: agent.connectedPhone || agent.config.id,
          status: isFromMe ? 'sent' : 'received',
          channel: 'baileys', isLid,
          createdAt: admin.firestore.Timestamp.fromDate(ts),
          updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
        }, { merge: true });

        // Track last inbound for 24h-window awareness (baileys side).
        if (!isFromMe && agent.config.teamId) {
          try {
            const convId = `${agent.config.teamId}_${phone}`;
            await db.collection('whatsappConversations').doc(convId).set({
              teamId: agent.config.teamId,
              phone,
              lastInboundAt: admin.firestore.Timestamp.fromDate(ts),
              channel: 'baileys',
              updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
            }, { merge: true });
          } catch (e) { /* non-critical */ }
        }

        if (isLid) {
          const queue = agent.pendingLidMessages.get(rawJid) || [];
          queue.push(docId);
          agent.pendingLidMessages.set(rawJid, queue);
        } else {
          console.log(`[${agent.config.id}] ${isFromMe ? '→' : '←'} ${phone}: ${body.slice(0, 80)}`);
        }
      } catch (e) { console.error(`[${agent.config.id}] Error saving message:`, e); }
    }
  });

  agent.sock.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      const waMessageId = update.key?.id; if (!waMessageId) continue;
      const receiptMap: Record<number, string> = { 2: 'sent', 3: 'delivered', 4: 'read' };
      const newStatus = receiptMap[(update.update as any)?.status]; if (!newStatus) continue;
      try {
        const snap = await db.collection('whatsappMessages').where('waMessageId', '==', waMessageId).limit(1).get();
        if (!snap.empty) await snap.docs[0].ref.update({ status: newStatus, updatedAt: admin.firestore.Timestamp.fromDate(new Date()) });
      } catch (e) { console.error(`[${agent.config.id}] Error updating receipt:`, e); }
    }
  });
}

// ── Agent loading from Firestore ──────────────────────────────────────────────
async function loadAgents(): Promise<void> {
  try {
    const snap = await db.collection('whatsappAccounts').where('enabled', '==', true).get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const config: AgentConfig = {
        id: doc.id,
        teamId: data.teamId || DEFAULT_TEAM_ID,
        label: data.label || doc.id,
        assignedToUserId: data.assignedToUserId,
        enabled: true,
      };
      const agent = createAgentState(config);
      agent.cacheEvictTimer = setInterval(() => agent.leadPhoneCache.clear(), 6 * 60 * 60 * 1000);
      agents.set(doc.id, agent);
      console.log(`[VPS] Agent ngarkuar: ${config.id} (${config.label})`);
    }
  } catch (e) { console.error('[VPS] Error loading agents:', e); }

  // Backward compat: if no agents in Firestore, use env TEAM_ID as default
  if (agents.size === 0) {
    console.log('[VPS] Asnjë agent në Firestore — duke përdorur default nga env');
    const config: AgentConfig = { id: 'default', teamId: DEFAULT_TEAM_ID, label: 'Default', enabled: true };
    const agent = createAgentState(config);
    agent.cacheEvictTimer = setInterval(() => agent.leadPhoneCache.clear(), 6 * 60 * 60 * 1000);
    agents.set('default', agent);
  }
}

function getAgent(agentId?: string): AgentState | null {
  if (agentId && agents.has(agentId)) return agents.get(agentId)!;
  for (const agent of agents.values()) { if (agent.connectionStatus === 'connected') return agent; }
  return agents.size > 0 ? agents.values().next().value : null;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Public health/info root — confirms server is alive without exposing secrets.
app.get('/', (_req, res) => {
  res.json({
    service: 'whatsapp-vps-server',
    status: 'ok',
    agents: agents.size,
    uptimeSec: Math.round(process.uptime()),
    hint: 'Use /status, /send, /qr/:agentId with header x-api-key',
  });
});

app.get('/status', requireApiKey, (_req, res) => {
  const statuses: Record<string, any> = {};
  for (const [id, a] of agents) {
    statuses[id] = { label: a.config.label, status: a.connectionStatus, teamId: a.config.teamId, assignedToUserId: a.config.assignedToUserId, lidMappings: a.lidToPhoneMap.size, pendingLids: a.pendingLidMessages.size };
  }
  res.json({ agents: statuses });
});

app.get('/agents', requireApiKey, (_req, res) => {
  res.json({ agents: Array.from(agents.values()).map(a => ({ id: a.config.id, label: a.config.label, teamId: a.config.teamId, assignedToUserId: a.config.assignedToUserId, status: a.connectionStatus })) });
});

// QR data JSON (used by FivoCRM UI via Vercel proxy)
app.get('/qr-data/:agentId', requireApiKey, (req: any, res: any) => {
  const agent = agents.get(req.params.agentId);
  if (!agent) { res.status(404).json({ error: 'Agent nuk u gjet' }); return; }
  res.json({
    agentId: agent.config.id,
    label: agent.config.label,
    status: agent.connectionStatus,
    qrDataUrl: agent.qrDataUrl || null,
    connectedPhone: agent.connectionStatus === 'connected'
      ? ((agent.sock as any)?.user?.id?.split(':')[0] || null)
      : null,
  });
});

// Hot-reload: load new agents from Firestore without restarting
app.post('/reload', requireApiKey, async (_req: any, res: any) => {
  try {
    const snap = await db.collection('whatsappAccounts').where('enabled', '==', true).get();
    let added = 0;
    for (const doc of snap.docs) {
      if (agents.has(doc.id)) continue; // already running
      const data = doc.data();
      const config: AgentConfig = {
        id: doc.id, teamId: data.teamId || DEFAULT_TEAM_ID,
        label: data.label || doc.id, assignedToUserId: data.assignedToUserId, enabled: true,
      };
      const agent = createAgentState(config);
      agent.cacheEvictTimer = setInterval(() => agent.leadPhoneCache.clear(), 6 * 60 * 60 * 1000);
      agents.set(doc.id, agent);
      await loadLidMappings(agent);
      connectAgent(agent).catch(e => console.error(`[${agent.config.id}] connectAgent error:`, e));
      added++;
      console.log(`[VPS] Hot-reload: agent i ri ngarkuar ${config.id} (${config.label})`);
    }
    res.json({ ok: true, added, total: agents.size });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Gabim' });
  }
});

// QR per agent
app.get('/qr/:agentId', requireApiKey, (req: any, res: any) => {
  const agent = agents.get(req.params.agentId);
  if (!agent) return res.status(404).send('<html><body style="font-family:sans-serif;padding:40px"><h2>Agent nuk u gjet</h2></body></html>');
  if (agent.connectionStatus === 'connected') {
    return res.send(`<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;background:#f0fdf4"><h2 style="color:#16a34a">✅ ${agent.config.label} — I lidhur!</h2><p style="color:#555">WhatsApp është aktiv.</p></body></html>`);
  }
  if (!agent.qrDataUrl) {
    return res.send(`<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column"><h2>⏳ Duke pritur QR — ${agent.config.label}...</h2><p style="color:#666">Prit disa sekonda dhe rifresko faqen.</p><script>setTimeout(() => location.reload(), 3000)</script></body></html>`);
  }
  res.send(`<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px"><h2 style="color:#111">📱 ${agent.config.label}</h2><img src="${agent.qrDataUrl}" style="width:260px;border:1px solid #eee;border-radius:12px;padding:8px"/><p style="color:#666;text-align:center;max-width:300px">Hap <strong>WhatsApp</strong> → <strong>Cilësimet</strong> → <strong>Pajisjet e lidhura</strong> → <strong>Lidh pajisje</strong></p><script>setTimeout(() => location.reload(), 30000)</script></body></html>`);
});

// Backward compat /qr
app.get('/qr', requireApiKey, (_req, res) => {
  const agent = getAgent();
  if (!agent) return res.status(503).send('No agents configured');
  res.redirect(`/qr/${agent.config.id}`);
});

// Sync per agent
app.post('/sync/:agentId', requireApiKey, async (req, res) => {
  const agent = agents.get(req.params.agentId);
  if (!agent) { res.status(404).json({ error: 'Agent nuk u gjet' }); return; }
  if (!agent.sock) { res.status(503).json({ error: 'WhatsApp jo i inicializuar' }); return; }
  if (agent.isSyncing) { res.status(409).json({ error: 'Sync tashmë në progres' }); return; }
  agent.isSyncing = true;
  const before = agent.lidToPhoneMap.size;
  try {
    agent.sock.end(undefined);
    await new Promise(r => setTimeout(r, 2000));
    await connectAgent(agent);
    await new Promise(r => setTimeout(r, 12000));
    await reverseLookupLeads(agent);
    await resolveFromGroups(agent);
    res.json({ success: true, status: agent.connectionStatus, lidMappings: agent.lidToPhoneMap.size, newMappings: agent.lidToPhoneMap.size - before });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Sync dështoi' });
  } finally { agent.isSyncing = false; }
});

// Backward compat /sync
app.post('/sync', requireApiKey, async (req, res) => {
  const agent = getAgent(); if (!agent) { res.status(503).json({ error: 'No agents' }); return; }
  res.redirect(307, `/sync/${agent.config.id}`);
});

// Send message
app.post('/send', requireApiKey, async (req, res) => {
  const { to, message, leadId, leadName, teamId, jid: rawJidFromBody, agentId } = req.body as {
    to: string; message: string; leadId?: string; leadName?: string;
    teamId?: string; jid?: string; agentId?: string;
  };

  // Defence-in-depth rate limit: max 30 sends/min per agent (VPS-side guard
  // in addition to the per-user limit on Vercel).
  if (agentId) {
    if (!checkSendRate(agentId)) {
      res.status(429).json({ error: 'Limiti i dërgimeve nga ky agent u arrit. Provoni pas pak.' });
      return;
    }
  }

  const agent = getAgent(agentId);
  if (!agent || agent.connectionStatus !== 'connected' || !agent.sock) {
    res.status(503).json({ error: 'WhatsApp jo i lidhur. Hap /qr/:agentId dhe skano.', agentId });
    return;
  }
  if (!to || !message) { res.status(400).json({ error: 'Fushat "to" dhe "message" janë të detyrueshme' }); return; }

  const cleanPhone = normalizePhone(String(to));
  const isValidJid = rawJidFromBody && (rawJidFromBody.endsWith('@s.whatsapp.net') || rawJidFromBody.endsWith('@lid'));
  const jid = isValidJid ? rawJidFromBody : `${cleanPhone}@s.whatsapp.net`;
  if (!isValidJid && (cleanPhone.length < 7 || cleanPhone.length > 15)) {
    res.status(400).json({ error: 'Numri i telefonit është i pavlefshëm' }); return;
  }

  try {
    const sent = await agent.sock.sendMessage(jid, { text: message });
    const resolvedTeamId = teamId || agent.config.teamId;
    const waMessageId = sent?.key?.id || null;
    const docId = waMessageId || db.collection('whatsappMessages').doc().id;
    await db.collection('whatsappMessages').doc(docId).set({
      phone: cleanPhone, jid, direction: 'outbound', message,
      leadId: leadId || null, leadName: leadName || null, waMessageId,
      teamId: resolvedTeamId, agentId: agent.config.id, channelPhone: agent.connectedPhone || agent.config.id,
      status: 'sent', channel: 'baileys',
      createdAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
    });
    console.log(`[${agent.config.id}] → ${cleanPhone}: ${message.slice(0, 80)}`);
    res.json({ success: true, id: docId, agentId: agent.config.id });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Dërgimi dështoi' });
  }
});

// ── File upload (chat / comment attachments) ─────────────────────────────────
// POST /upload  (multipart: file, teamId, folder)  — auth via Firebase ID token.
// Returns { url, path, name, size, type }.  Files served publicly under /files.
app.post('/upload', requireFirebaseAuth, uploadMw.single('file'), async (req: any, res: any) => {
  try {
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'Mungon skedari' }); return; }
    if (!ALLOWED_UPLOAD.test(file.mimetype)) { res.status(400).json({ error: `Tip skedari i palejuar: ${file.mimetype}` }); return; }
    const teamId = String(req.body.teamId || 'shared').replace(/[^a-zA-Z0-9_-]/g, '_') || 'shared';
    const folder = String(req.body.folder || 'uploads').replace(/[^a-zA-Z0-9_-]/g, '_') || 'uploads';
    // Unguessable filename (capability URL) — files are served publicly under
    // /files, so a predictable timestamp+originalname could be enumerated. A random
    // UUID makes the URL itself the secret, like Slack/WhatsApp attachment CDNs.
    // The original name is still returned as `name` for display/download.
    const orig = String(file.originalname || 'file');
    const extMatch = orig.match(/\.[a-zA-Z0-9]{1,8}$/);
    const ext = extMatch ? extMatch[0].toLowerCase() : '';
    const safeName = `${randomUUID()}${ext}`;
    const relPath = `${teamId}/${folder}/${safeName}`;
    const absDir = join(UPLOAD_DIR, teamId, folder);
    mkdirSync(absDir, { recursive: true });
    writeFileSync(join(absDir, safeName), file.buffer);
    const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    res.json({
      url: `${base}/files/${relPath}`,
      path: relPath,
      name: file.originalname,
      size: file.size,
      type: file.mimetype,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Ngarkimi dështoi' });
  }
});

// ── WHMCS API proxy ───────────────────────────────────────────────────────────
// Relays a pre-built urlencoded WHMCS API body to the configured WHMCS install
// from this VPS's static IP. FivoCRM (Vercel) builds the body (incl. identifier
// + secret); the VPS never stores WHMCS credentials and only ever forwards to
// its own WHMCS_API_URL (so it can't be abused as an open SSRF relay).
app.post('/whmcs-proxy', requireApiKey, async (req, res) => {
  const { url, form } = (req.body as any) || {};
  if (typeof form !== 'string' || !form) { res.status(400).json({ error: 'Mungon fusha "form"' }); return; }
  // Target: prefer the URL sent by FivoCRM (Vercel has WHMCS_API_URL); fall back
  // to the VPS env only if present. Must be https to avoid open-relay abuse.
  const target = (typeof url === 'string' && url)
    ? url
    : (WHMCS_API_URL ? `${WHMCS_API_URL.replace(/\/$/, '')}/includes/api.php` : '');
  if (!target) { res.status(503).json({ error: 'Mungon URL-ja e WHMCS (as nga kërkesa, as nga env)' }); return; }
  if (!/^https:\/\//i.test(target)) { res.status(400).json({ error: 'URL e WHMCS e pavlefshme' }); return; }
  try {
    const r = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await r.text();
    res.status(r.status).type('application/json').send(text);
  } catch (err: unknown) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'WHMCS proxy dështoi' });
  }
});

// ── Scheduled jobs (replaces Vercel cron) ──────────────────────────────────────
// Vercel Hobby caps crons at 2/day. We keep ALL job logic in the Vercel function
// (api/cron/run.ts, guarded by CRON_SECRET) and just trigger it here on a schedule,
// so time-sensitive jobs can run far more often than once a day.
// Requires env: CRM_BASE_URL (e.g. https://fivocrm.vercel.app) and CRON_SECRET
// (same value set in Vercel). If either is missing, scheduling is disabled.
const CRM_BASE_URL = (process.env.CRM_BASE_URL || '').replace(/\/$/, '');
const CRON_SECRET = process.env.CRON_SECRET || '';
const CRON_DAILY_HOUR = parseInt(process.env.CRON_DAILY_HOUR || '8'); // UTC, matches old "0 8 * * *"
// The office's wall clock, for deadlines that are promises to people rather than
// machine schedules (the daily report). IANA name, e.g. 'Europe/Tirane'.
const CRON_LOCAL_TZ = process.env.CRON_LOCAL_TZ || 'Europe/Tirane';
const cronInFlight = new Set<string>();

async function triggerCronJob(job: string, params?: Record<string, string>): Promise<void> {
  if (!CRM_BASE_URL || !CRON_SECRET) return;
  // The in-flight key includes the params, so two stages of the same job (e.g.
  // daily-report-check remind vs escalate) never block each other.
  const query = new URLSearchParams({ job, ...(params || {}) }).toString();
  const label = params ? `${job} ${new URLSearchParams(params).toString()}` : job;
  if (cronInFlight.has(query)) {
    console.warn(`[CRON] anashkalo "${label}" — ekzekutimi i mëparshëm ende në punë`);
    return;
  }
  cronInFlight.add(query);
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 90_000);
    const res = await fetch(`${CRM_BASE_URL}/api/cron/run?${query}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      signal: ctrl.signal,
    });
    clearTimeout(to);
    const ms = Date.now() - started;
    if (!res.ok) console.error(`[CRON] "${label}" → HTTP ${res.status} (${ms}ms)`);
    else console.log(`[CRON] "${label}" ok (${ms}ms)`);
  } catch (err) {
    console.error(`[CRON] "${label}" dështoi:`, (err as Error)?.message || err);
  } finally {
    cronInFlight.delete(query);
  }
}

function scheduleDailyUtc(hour: number, minute: number, fn: () => void): void {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  const run = () => { fn(); setTimeout(run, DAY); };
  setTimeout(run, next.getTime() - now.getTime());
}

/** Wall-clock date + time in an IANA zone, without pulling in a date library. */
function partsInZone(d: Date, timeZone: string): { day: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '0';
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    // Intl can emit "24" for midnight in some locales/engines.
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
  };
}

/**
 * Fire once per LOCAL day, at or after `hour:minute` in `timeZone`.
 *
 * Not `scheduleDailyUtc`: an office deadline is wall-clock. Albania is UTC+2 in
 * summer and UTC+1 in winter, so a fixed UTC time silently drifts an hour twice a
 * year — for the daily-report escalation that means notifying managers BEFORE the
 * deadline all winter.
 *
 * "At or after" rather than "exactly at" is also deliberate: a PM2 restart at 17:34
 * must not swallow the day's run. The minute ticker costs nothing — it only makes a
 * network call when it actually fires.
 */
function scheduleDailyInZone(timeZone: string, hour: number, minute: number, fn: () => void): void {
  let lastFiredDay = partsInZone(new Date(), timeZone).day;
  // Boot-day guard: if the process starts AFTER the target time, do not fire
  // immediately for a moment that has already passed unnoticed — wait for tomorrow.
  const boot = partsInZone(new Date(), timeZone);
  const alreadyPast = boot.hour > hour || (boot.hour === hour && boot.minute >= minute);
  if (!alreadyPast) lastFiredDay = '';

  setInterval(() => {
    const p = partsInZone(new Date(), timeZone);
    if (p.day === lastFiredDay) return;
    if (p.hour > hour || (p.hour === hour && p.minute >= minute)) {
      lastFiredDay = p.day;
      fn();
    }
  }, 60_000);
}

function startCronSchedulers(): void {
  if (!CRM_BASE_URL || !CRON_SECRET) {
    console.warn('[CRON] CRM_BASE_URL / CRON_SECRET nuk janë vendosur — punët me orar janë çaktivizuar');
    return;
  }
  const MIN = 60_000;
  // Frequencies are kept conservative because lead jobs do a full `leads`
  // collection scan each run — running them too often pins Firestore read quota.
  // whatsapp-broadcasts only reads queued broadcasts (tiny), so it stays frequent.
  setInterval(() => { void triggerCronJob('whatsapp-broadcasts'); }, 5 * MIN);
  // Task reminders ("Më kujto") are a wall-clock promise to a person — "15:00"
  // means 15:00, so this cannot ride the daily run-all. The job reads ONLY tasks
  // whose reminderAt falls in [now − 48h, now] (same-field range, no composite
  // index) and marks each one reminderSentAt, so a 5-minute cadence costs a few
  // reads per run and a restart can never double-notify.
  setInterval(() => { void triggerCronJob('task-reminders'); }, 5 * MIN);
  setInterval(() => { void triggerCronJob('lead-sla-stale-alerts'); }, 60 * MIN);
  // CRM automation rules (CRM → Automatizime). Hourly: "pa pronar prej 2 orësh"
  // must mean two hours, not "at tomorrow's run-all". The job reads ONLY tenants
  // that have an active rule (leads/customers/invoices scoped by businessId) and
  // every firing is keyed per (rule, record, occurrence), so a tick is idempotent.
  setInterval(() => { void triggerCronJob('crm-automations'); }, 60 * MIN);
  // Google Reviews: hourly pull. The job reads ONLY connected gmbAccounts and
  // diffs reviews per location, so an hour with no new reviews costs a handful of
  // reads and zero writes. A tenant can opt out via teamSettings.gmbAutoSync.
  setInterval(() => { void triggerCronJob('gmb-sync'); }, 60 * MIN);
  setInterval(() => { void triggerCronJob('overdue-reminders'); }, 120 * MIN);
  // ── Reporting module ──
  // report-schedules reads ONLY active schedules (tiny), so it can tick hourly.
  // That matters: a schedule carries a per-tenant local hour, and the job fires when
  // that hour has passed. Ticking once a day would collapse every tenant's chosen
  // hour into whatever CRON_DAILY_HOUR happens to be. Re-runs are free — generation
  // is keyed on `generationKey = scheduleId:periodKey[:subjectId]` and skips itself.
  setInterval(() => { void triggerCronJob('report-schedules'); }, 60 * MIN);
  // report-reminders is a range query on an indexed field (status + dueAt), not a
  // collection scan, and each reminder/escalation rung records itself on the report
  // so nothing is ever sent twice. Same cadence as overdue-reminders.
  setInterval(() => { void triggerCronJob('report-reminders'); }, 120 * MIN);
  // lead-wa-auto-reminders runs only in the daily run-all — it's a 7-day-inactivity
  // reminder, so a full-collection scan every 15 min was needless read pressure.
  // Everything else: once a day at ~08:00 UTC (same as the old Vercel daily cron).
  scheduleDailyUtc(CRON_DAILY_HOUR, 0, () => { void triggerCronJob('run-all'); });
  // Housekeeping at 03:00 UTC.
  scheduleDailyUtc(3, 0, () => { void triggerCronJob('cleanup-old-notifications'); });
  // Social-media analytics — pulled ONCE per month (last day, 22:00 UTC) to keep
  // Firebase writes negligible. The daily tick fires the job only when tomorrow is
  // a new month (i.e. today is the last day of the month). Insights for the ending
  // month are still fully available at that time (stories retention is 24h).
  scheduleDailyUtc(22, 0, () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(now.getUTCDate() + 1);
    if (tomorrow.getUTCMonth() !== now.getUTCMonth()) {
      void triggerCronJob('social-monthly-sync');
    }
  });
  // Client-health snapshots: once a month, on the 1st at 04:00 UTC. The daily tick
  // fires only on day 1, which is when the previous month's numbers are complete.
  // The job uses a deterministic doc id per (tenant, customer, period), so a repeat
  // run overwrites its own row instead of appending a duplicate.
  scheduleDailyUtc(4, 0, () => {
    if (new Date().getUTCDate() === 1) void triggerCronJob('client-health-rollup');
  });
  // Social → reportMetrics. Runs on the 1st, AFTER social-monthly-sync has pulled the
  // month that just ended (that job fires on the last day at 22:00), so the monthly
  // client report finds real figures rather than an empty KPI block.
  scheduleDailyUtc(5, 0, () => {
    if (new Date().getUTCDate() === 1) void triggerCronJob('report-metrics-social');
  });
  // ── Daily staff report (mandatory, prompted 16:50, due 17:30 LOCAL) ──
  // Two rungs: the person first, their managers an hour later. Scheduled in the
  // office's own timezone because the deadline is a wall-clock promise — see
  // scheduleDailyInZone. The job itself skips weekends and is idempotent per
  // tenant/day/stage (dailyReportMisses), so a restart cannot double-notify.
  scheduleDailyInZone(CRON_LOCAL_TZ, 17, 35, () => {
    void triggerCronJob('daily-report-check', { stage: 'remind' });
  });
  scheduleDailyInZone(CRON_LOCAL_TZ, 18, 35, () => {
    void triggerCronJob('daily-report-check', { stage: 'escalate' });
  });

  // ── Evergreen WhatsApp rules (dormancy re-engagement) ──
  // ONCE a day, and deliberately not inside run-all: this job messages real people
  // unprompted, so it must fire on a schedule someone chose rather than piggybacking
  // on whatever else run-all does. 10:00 LOCAL, in the office's timezone — a
  // re-engagement message should land during working hours, when a reply can be
  // answered, and Albania shifts an hour twice a year (that's why it is
  // scheduleDailyInZone and not scheduleDailyUtc). Each rule is capped by its own
  // `dailyCap`, and the dormancy window is the cooldown, so a restart-triggered
  // extra run cannot re-message anyone.
  scheduleDailyInZone(CRON_LOCAL_TZ, 10, 0, () => {
    void triggerCronJob('whatsapp-automations');
  });

  // Kick the frequent set shortly after boot so a restart doesn't stall a broadcast.
  setTimeout(() => { void triggerCronJob('whatsapp-broadcasts'); }, MIN);
  console.log(`[CRON] ✅ Schedulerët aktiv → ${CRM_BASE_URL} (daily run-all @ ${CRON_DAILY_HOUR}:00 UTC, raporti ditor 17:35/18:35 ${CRON_LOCAL_TZ}, automatizimet WhatsApp 10:00 ${CRON_LOCAL_TZ})`);
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n[VPS Server] ✅ Aktiv në port ${PORT}`);
  console.log(`[VPS Server]  → Status:  http://localhost:${PORT}/status`);
  console.log(`[VPS Server]  → Agents:  http://localhost:${PORT}/agents`);
  console.log(`[VPS Server]  → QR:      http://localhost:${PORT}/qr/{agentId}\n`);

  startCronSchedulers();

  await loadAgents();

  for (const agent of agents.values()) {
    await loadLidMappings(agent);
    await loadPendingLidMessages(agent);
    connectAgent(agent).catch(e => console.error(`[${agent.config.id}] connectAgent error:`, e));
  }
});
