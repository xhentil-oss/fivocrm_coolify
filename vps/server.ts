import express from 'express';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from 'baileys';
import { Boom } from '@hapi/boom';
import admin from 'firebase-admin';
import QRCode from 'qrcode';
import { readFileSync, existsSync } from 'fs';
import pino from 'pino';

// Prevent crash on unhandled rejections/exceptions (e.g. Baileys internal errors)
process.on('unhandledRejection', (err) => {
  console.error('[WA] Unhandled rejection (caught):', err);
});
process.on('uncaughtException', (err) => {
  console.error('[WA] Uncaught exception (caught):', err);
});

const app = express();
app.use(express.json());

// ── Config ────────────────────────────────────────────────────────────────────
const API_SECRET = process.env.API_SECRET;
const PORT = parseInt(process.env.PORT || '3001');
const TEAM_ID = process.env.TEAM_ID || '';

if (!API_SECRET) {
  console.error('[VPS] ERROR: API_SECRET env variable mungon!');
  process.exit(1);
}

// ── Firebase Admin ────────────────────────────────────────────────────────────
let saJson: object;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  saJson = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
} else if (existsSync('./firebase-service-account.json')) {
  saJson = JSON.parse(readFileSync('./firebase-service-account.json', 'utf8'));
} else {
  console.error('[VPS] ERROR: Firebase credentials nuk u gjetën!');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(saJson as admin.ServiceAccount) });
const db = admin.firestore();

// ── Helpers ───────────────────────────────────────────────────────────────────
/** Strip all non-digit characters for consistent phone storage */
const normalizePhone = (phone: string): string => {
  const digits = phone.replace(/[^\d]/g, '');
  // Albanian trunk-prefix: "3550[6-9]…" → strip the extra zero
  if (/^3550[6-9]/.test(digits)) return '355' + digits.slice(4);
  // Local Albanian: "0[6-9]…" → prepend country code
  if (/^0[6-9]/.test(digits)) return '355' + digits.slice(1);
  return digits;
};

function requireApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (req.headers['x-api-key'] !== API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// ── WhatsApp state ────────────────────────────────────────────────────────────
type ConnectionStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'connected';
let sock: ReturnType<typeof makeWASocket> | null = null;
let qrDataUrl: string | null = null;
let connectionStatus: ConnectionStatus = 'disconnected';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lidResyncTimer: ReturnType<typeof setInterval> | null = null;
/** Reference to the auth state keys store — used to read Baileys' internal lid-mapping entries */
let authKeys: { get: (type: string, ids: string[]) => Promise<Record<string, any>> } | null = null;

/** Maps LID JID (e.g. "123456789@lid") → phone JID (e.g. "355691234567@s.whatsapp.net") */
const lidToPhoneMap = new Map<string, string>();

/** Load persisted LID mappings from Firestore on startup */
async function loadLidMappings(): Promise<void> {
  try {
    const snap = await db.collection('lidMappings').where('teamId', '==', TEAM_ID).get();
    for (const doc of snap.docs) {
      const { lid, phoneJid } = doc.data();
      if (lid && phoneJid) lidToPhoneMap.set(lid, phoneJid);
    }
    console.log(`[WA] Loaded ${lidToPhoneMap.size} persisted LID mappings`);
  } catch (e) {
    console.error('[WA] Error loading LID mappings:', e);
  }
}

/** Read LID mappings from Baileys' internal key store (lid-mapping entries in auth_info) */
async function readBaileysLidMappings(): Promise<void> {
  if (!authKeys) return;
  try {
    // Read all session files to find LID user IDs, then check for their reverse mappings
    const { readdirSync, readFileSync: readF } = await import('fs');
    const files = readdirSync('./auth_info');

    // Collect LID user IDs from session files (sessions with LID-like long numbers)
    const lidUsers = new Set<string>();
    for (const f of files) {
      const match = f.match(/^session-(\d+)\.\d+\.json$/);
      if (match) {
        const user = match[1];
        // LID numbers are typically 15+ digits; phone numbers are 7-15
        if (user.length >= 15) lidUsers.add(user);
      }
    }

    // Check for lid-mapping files
    const lidMappingFiles = files.filter(f => f.startsWith('lid-mapping-'));
    if (lidMappingFiles.length) {
      console.log(`[WA] Found ${lidMappingFiles.length} Baileys lid-mapping files`);

      // Read reverse entries: lid-mapping-{lidUser}_reverse.json → pnUser
      const reverseKeys = lidMappingFiles
        .filter(f => f.includes('_reverse'))
        .map(f => f.replace('lid-mapping-', '').replace('.json', ''));
      if (reverseKeys.length) {
        const stored = await authKeys.get('lid-mapping', reverseKeys);
        for (const [key, pnUser] of Object.entries(stored)) {
          if (!pnUser || typeof pnUser !== 'string') continue;
          const lidUser = key.replace('_reverse', '');
          const lid = `${lidUser}@lid`;
          const pn = `${pnUser}@s.whatsapp.net`;
          if (!lidToPhoneMap.has(lid)) {
            console.log(`[WA] Baileys store: ${lid} → ${pn}`);
            registerLidMapping(lid, pn);
          }
        }
      }

      // Read forward entries: lid-mapping-{pnUser}.json → lidUser
      const forwardKeys = lidMappingFiles
        .filter(f => !f.includes('_reverse'))
        .map(f => f.replace('lid-mapping-', '').replace('.json', ''));
      if (forwardKeys.length) {
        const stored = await authKeys.get('lid-mapping', forwardKeys);
        for (const [pnUser, lidUser] of Object.entries(stored)) {
          if (!lidUser || typeof lidUser !== 'string') continue;
          const lid = `${lidUser}@lid`;
          const pn = `${pnUser}@s.whatsapp.net`;
          if (!lidToPhoneMap.has(lid)) {
            console.log(`[WA] Baileys store (fwd): ${lid} → ${pn}`);
            registerLidMapping(lid, pn);
          }
        }
      }
    }

    console.log(`[WA] Baileys key store: ${lidMappingFiles.length} lid-mapping files, ${lidUsers.size} LID sessions found`);
  } catch (e) {
    console.error('[WA] Error reading Baileys LID mappings:', e);
  }
}

/** Persist a LID mapping to Firestore */
async function persistLidMapping(lid: string, phoneJid: string): Promise<void> {
  try {
    const docId = lid.replace(/[@.]/g, '_');
    await db.collection('lidMappings').doc(docId).set({
      lid, phoneJid, teamId: TEAM_ID,
      updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
    }, { merge: true });
  } catch (e) {
    console.error('[WA] Error persisting LID mapping:', e);
  }
}

/** Queue of messages that arrived with unresolved LID JIDs — kept only as in-memory index
 *  for fast processing when mapping arrives. Messages are ALWAYS saved to Firestore (with isLid: true). */
const pendingLidMessages = new Map<string, string[]>(); // LID JID → array of Firestore doc IDs

/** Register a LID→phone mapping and trigger backfill + queue processing */
async function registerLidMapping(lid: string, phoneJid: string): Promise<void> {
  if (!lid || !phoneJid || lidToPhoneMap.has(lid)) return;
  lidToPhoneMap.set(lid, phoneJid);
  console.log(`[WA] LID mapping: ${lid} → ${phoneJid} (total: ${lidToPhoneMap.size})`);
  persistLidMapping(lid, phoneJid);

  // Backfill old messages stored with LID number
  backfillLidMessages(lid, phoneJid);

  // Update queued messages (already in Firestore with isLid: true) with the real phone
  const queuedDocIds = pendingLidMessages.get(lid);
  if (queuedDocIds?.length) {
    const phone = normalizePhone(phoneJid.split('@')[0]);
    console.log(`[WA] Updating ${queuedDocIds.length} queued LID docs for ${lid} → ${phone}`);
    const batch = db.batch();
    for (const docId of queuedDocIds) {
      batch.update(db.collection('whatsappMessages').doc(docId), {
        phone,
        jid: phoneJid,
        isLid: false,
        updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
      });
    }
    try {
      await batch.commit();
    } catch (e) {
      console.error(`[WA] Error updating queued LID docs:`, e);
    }
    pendingLidMessages.delete(lid);
  }
}

/** When a new LID→phone mapping is discovered, backfill old messages stored with the LID number */
async function backfillLidMessages(lidJid: string, phoneJid: string): Promise<void> {
  const lidPhone = normalizePhone(lidJid.split('@')[0]);
  const realPhone = normalizePhone(phoneJid.split('@')[0]);
  if (!lidPhone || !realPhone || lidPhone === realPhone) return;

  try {
    const snap = await db.collection('whatsappMessages')
      .where('teamId', '==', TEAM_ID)
      .where('phone', '==', lidPhone)
      .get();
    if (snap.empty) return;

    const batch = db.batch();
    let count = 0;
    for (const doc of snap.docs) {
      batch.update(doc.ref, {
        phone: realPhone,
        jid: phoneJid,
        updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
      });
      count++;
      // Firestore batch limit is 500
      if (count >= 499) break;
    }
    await batch.commit();
    console.log(`[WA] Backfill: ${lidPhone} → ${realPhone} (${count} mesazhe u përditësuan)`);
  } catch (e) {
    console.error(`[WA] Backfill error for ${lidPhone}:`, e);
  }
}

/** Reverse-resolve known leads: query phone→LID via USyncQuery */
async function reverseLookupLeads(): Promise<void> {
  if (!sock) return;
  try {
    const { USyncQuery, USyncUser } = await import('baileys');

    // 1. Collect all unique phone numbers from leads
    const leadsSnap = await db.collection('leads')
      .where('teamId', '==', TEAM_ID)
      .select('phoneNumber', 'phone')
      .get();

    const phones = new Set<string>();
    for (const doc of leadsSnap.docs) {
      const d = doc.data();
      const p = normalizePhone(String(d.phoneNumber || d.phone || ''));
      if (p && p.length >= 7 && p.length <= 15) phones.add(p);
    }

    // 2. Also collect phones from LID messages (unresolved)
    const lidSnap = await db.collection('whatsappMessages')
      .where('teamId', '==', TEAM_ID)
      .where('isLid', '==', true)
      .select('jid')
      .limit(200)
      .get();

    const unresolvedLids = new Set<string>();
    for (const doc of lidSnap.docs) {
      const jid = doc.data().jid;
      if (jid?.endsWith('@lid')) unresolvedLids.add(jid);
    }

    console.log(`[WA] Reverse lookup: ${phones.size} lead phones, ${unresolvedLids.size} unresolved LIDs`);

    // 3. Query leads' phones via USyncQuery (batch of 20)
    const phoneArr = Array.from(phones);
    let resolved = 0;
    for (let i = 0; i < phoneArr.length; i += 20) {
      const batch = phoneArr.slice(i, i + 20);
      try {
        const query = new USyncQuery();
        query.withMode('query').withContext('interactive');
        for (const phone of batch) {
          const user = new USyncUser();
          user.withPhone('+' + phone);
          query.withUser(user);
        }
        query.withLIDProtocol();
        query.withContactProtocol();
        const result = await sock!.executeUSyncQuery(query);
        for (const item of (result?.list) || []) {
          const lid = (item as any).lid;
          const id = (item as any).id;
          if (lid && id && id !== 'undefined') {
            registerLidMapping(lid, id);
            resolved++;
          }
        }
      } catch (e) {
        console.error(`[WA] USyncQuery batch error:`, e);
      }
    }

    console.log(`[WA] Reverse lookup complete: ${resolved} new mappings from ${phones.size} phones`);
  } catch (e) {
    console.error('[WA] Reverse lookup error:', e);
  }
}

/** Resolve LIDs from group participant metadata — most powerful method.
 *  Group participants carry BOTH phone JID and LID, even for non-contacts. */
async function resolveFromGroups(): Promise<void> {
  if (!sock) return;
  try {
    console.log('[WA] Fetching group participants for LID resolution...');
    const groups = await sock.groupFetchAllParticipating();
    const groupCount = Object.keys(groups).length;
    let newMappings = 0;

    for (const group of Object.values(groups)) {
      for (const participant of group.participants) {
        // Case 1: id is phone JID, lid field has the LID
        if (participant.lid && participant.id && !participant.id.endsWith('@lid')) {
          const lid = participant.lid.endsWith('@lid')
            ? participant.lid
            : `${participant.lid}@lid`;
          const phoneJid = participant.id.endsWith('@s.whatsapp.net')
            ? participant.id
            : `${participant.id}@s.whatsapp.net`;
          if (!lidToPhoneMap.has(lid)) {
            registerLidMapping(lid, phoneJid);
            newMappings++;
          }
        }
        // Case 2: id is LID, phoneNumber field has the real phone
        if ((participant as any).phoneNumber && participant.id?.endsWith('@lid')) {
          const lid = participant.id;
          const pn = (participant as any).phoneNumber;
          const phoneJid = pn.endsWith('@s.whatsapp.net')
            ? pn
            : `${pn}@s.whatsapp.net`;
          if (!lidToPhoneMap.has(lid)) {
            registerLidMapping(lid, phoneJid);
            newMappings++;
          }
        }
      }
    }

    console.log(`[WA] Groups: ${groupCount} groups scanned, ${newMappings} new LID mappings (total: ${lidToPhoneMap.size})`);
  } catch (e) {
    console.error('[WA] Group LID resolution error:', e);
  }
}

// ── Connect WhatsApp ──────────────────────────────────────────────────────────
async function connectWhatsApp(): Promise<void> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  connectionStatus = 'connecting';
  console.log('[WA] Duke u lidhur...');

  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();

  // Save keys reference so we can read Baileys' internal lid-mapping store
  authKeys = state.keys as any;

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['Business CRM', 'Chrome', '1.0.0'],
    printQRInTerminal: true,
    shouldSyncHistoryMessage: () => true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrDataUrl = await QRCode.toDataURL(qr);
      connectionStatus = 'qr_ready';
      console.log(`[WA] QR i gatshëm — hap http://your-vps-ip:${PORT}/qr`);
    }

    if (connection === 'close') {
      connectionStatus = 'disconnected';
      qrDataUrl = null;
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log(`[WA] Lidhja u ndërpre (kod: ${code}). Rilidh: ${shouldReconnect}`);
      if (shouldReconnect) {
        reconnectTimer = setTimeout(connectWhatsApp, 5000);
      }
    }

    if (connection === 'open') {
      connectionStatus = 'connected';
      qrDataUrl = null;
      console.log('[WA] ✅ I lidhur me sukses!');

      // Read any LID mappings from Baileys' internal key store
      setTimeout(() => readBaileysLidMappings(), 3000);
      // After connection opens, resolve known leads via USyncQuery (phone→LID)
      setTimeout(() => reverseLookupLeads(), 8000);
      // Then scan group participants for additional LID→phone mappings
      setTimeout(() => resolveFromGroups(), 20000);

      // Schedule periodic re-sync every 30 minutes
      if (lidResyncTimer) clearInterval(lidResyncTimer);
      lidResyncTimer = setInterval(async () => {
        if (connectionStatus === 'connected' && sock) {
          console.log('[WA] Periodic LID re-sync starting...');
          await reverseLookupLeads();
          await resolveFromGroups();
        }
      }, 30 * 60 * 1000);
    }
  });

  // ── Build LID → phone map from all available sources ─────────────────────────

  // 🔑 PRIMARY: LID migration mapping sync from the connected phone
  // Fires when WhatsApp syncs LID↔phone pairs from the device's contact database
  // Cast to any because older Baileys type defs may not include this event
  (sock.ev as any).on('lid-mapping.update', ({ lid, pn }: { lid: string; pn: string }) => {
    console.log(`[WA] 📱 lid-mapping.update: ${lid} → ${pn}`);
    registerLidMapping(lid, pn);
  });

  sock.ev.on('contacts.upsert', (contacts) => {
    for (const contact of contacts) {
      const lid = (contact as any).lid as string | undefined;
      if (lid && contact.id) registerLidMapping(lid, contact.id);
    }
  });

  sock.ev.on('contacts.update', (updates) => {
    for (const update of updates) {
      const lid = (update as any).lid as string | undefined;
      if (lid && update.id) registerLidMapping(lid, update.id);
    }
  });

  // History sync provides the richest source of LID mappings at connection time
  sock.ev.on('messaging-history.set', (data: any) => {
    // Explicit LID→PN pairs from sync
    const mappings = data.lidPnMappings || data.phoneNumberToLidMappings || [];
    for (const m of mappings) {
      const lid = m.lid || m.lidJid;
      const pn = m.pn || m.pnJid;
      if (lid && pn) registerLidMapping(lid, pn);
    }
    // Also extract from synced contacts
    const contacts = data.contacts || [];
    for (const c of contacts) {
      const lid = (c as any).lid as string | undefined;
      const pn = c.id || (c as any).phoneNumber;
      if (lid && pn) registerLidMapping(lid, pn);
    }
    // Also check chats for LID references
    const chats = data.chats || [];
    for (const ch of chats) {
      const lid = (ch as any).lid || (ch as any).lidJid;
      const pn = ch.id || (ch as any).pnJid;
      if (lid && pn && !pn.endsWith('@g.us')) registerLidMapping(lid, pn);
    }
    console.log(`[WA] History sync: ${mappings.length} LID mappings, ${contacts.length} contacts, ${chats.length} chats`);
  });

  // ── Incoming messages → save to Firestore ──────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const rawJid = msg.key.remoteJid || '';
      if (rawJid.endsWith('@g.us')) continue; // skip group messages

      // Resolve LID to real phone JID if we have the mapping
      let resolvedJid = rawJid;
      let isLid = false;
      if (rawJid.endsWith('@lid')) {
        const phoneJid = lidToPhoneMap.get(rawJid);
        if (phoneJid) {
          resolvedJid = phoneJid;
          console.log(`[WA] LID resolved: ${rawJid} → ${phoneJid}`);
        } else {
          // Save with LID as phone — will be updated when mapping arrives
          isLid = true;
        }
      }

      const phone = normalizePhone(resolvedJid.split('@')[0]);
      if (!phone) continue;

      const body =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '[Media]';

      const ts = new Date(Number(msg.messageTimestamp) * 1000);
      const waMessageId = msg.key.id || null;
      const isFromMe = !!msg.key.fromMe;
      const pushName = (msg as any).pushName || null;

      // Use waMessageId as doc ID to prevent duplicates
      const docId = waMessageId || db.collection('whatsappMessages').doc().id;

      // Skip fromMe messages that were already saved via /send route
      // (identify by checking if doc already exists)
      if (isFromMe && waMessageId) {
        const existing = await db.collection('whatsappMessages').doc(docId).get();
        if (existing.exists) continue;
      }

      // Try to find the lead by phone for auto-linking
      let autoLeadId: string | null = null;
      let autoLeadName: string | null = null;
      try {
        const leadsSnap = await db.collection('leads')
          .where('teamId', '==', TEAM_ID)
          .where('phoneNumber', '==', phone)
          .limit(1)
          .get();
        if (!leadsSnap.empty) {
          const leadDoc = leadsSnap.docs[0];
          autoLeadId = leadDoc.id;
          autoLeadName = leadDoc.data().name || null;
        }
        // fallback: check 'phone' field
        if (!autoLeadId) {
          const snap2 = await db.collection('leads')
            .where('teamId', '==', TEAM_ID)
            .where('phone', '==', phone)
            .limit(1)
            .get();
          if (!snap2.empty) {
            autoLeadId = snap2.docs[0].id;
            autoLeadName = snap2.docs[0].data().name || null;
          }
        }
      } catch { /* non-critical */ }

      try {
        await db.collection('whatsappMessages').doc(docId).set({
          phone,
          jid: resolvedJid,
          direction: isFromMe ? 'outbound' : 'inbound',
          message: body,
          waMessageId,
          leadId: autoLeadId,
          leadName: autoLeadName || pushName,
          pushName,
          teamId: TEAM_ID,
          status: isFromMe ? 'sent' : 'received',
          channel: 'baileys',
          isLid,
          createdAt: admin.firestore.Timestamp.fromDate(ts),
          updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
        }, { merge: true });

        // Track LID docs so we can update them when mapping arrives
        if (isLid) {
          const queue = pendingLidMessages.get(rawJid) || [];
          queue.push(docId);
          pendingLidMessages.set(rawJid, queue);
          console.log(`[WA] LID saved (${queue.length}): ${rawJid} → doc ${docId}`);
        } else {
          console.log(`[WA] ${isFromMe ? '→ (telefon)' : '←'} ${phone}: ${body.slice(0, 80)}`);
        }
      } catch (e) {
        console.error('[WA] Gabim gjatë ruajtjes së mesazhit:', e);
      }
    }
  });

  // ── Delivery / read receipts → update status in Firestore ─────────────────
  sock.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      const waMessageId = update.key?.id;
      if (!waMessageId) continue;

      // Map Baileys receipt status to our status field
      const receiptMap: Record<number, string> = {
        2: 'sent',       // MESSAGE_SENT
        3: 'delivered',  // MESSAGE_DELIVERED
        4: 'read',       // MESSAGE_READ
      };
      const newStatus = receiptMap[(update.update as any)?.status];
      if (!newStatus) continue;

      try {
        const snap = await db.collection('whatsappMessages')
          .where('waMessageId', '==', waMessageId)
          .limit(1).get();
        if (!snap.empty) {
          await snap.docs[0].ref.update({
            status: newStatus,
            updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
          });
          console.log(`[WA] Receipt: ${waMessageId} → ${newStatus}`);
        }
      } catch (e) {
        console.error('[WA] Gabim gjatë update receipt:', e);
      }
    }
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

/** Health check + connection status */
app.get('/status', (_req, res) => {
  res.json({ status: connectionStatus });
});

/** QR code page for initial WhatsApp link */
app.get('/qr', (_req, res) => {
  if (connectionStatus === 'connected') {
    return res.send(`
      <html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;
        height:100vh;flex-direction:column;background:#f0fdf4">
        <h2 style="color:#16a34a">✅ WhatsApp është i lidhur!</h2>
        <p style="color:#555">Sistemi është aktiv dhe gati për mesazhe.</p>
      </body></html>
    `);
  }

  if (!qrDataUrl) {
    return res.send(`
      <html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;
        height:100vh;flex-direction:column">
        <h2>⏳ Duke pritur QR code...</h2>
        <p style="color:#666">Prit disa sekonda dhe rifresko faqen.</p>
        <script>setTimeout(() => location.reload(), 3000)</script>
      </body></html>
    `);
  }

  res.send(`
    <html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;
      height:100vh;flex-direction:column;gap:16px">
      <h2 style="color:#111">Skano me WhatsApp</h2>
      <img src="${qrDataUrl}" style="width:260px;border:1px solid #eee;border-radius:12px;padding:8px"/>
      <p style="color:#666;text-align:center;max-width:300px">
        Hap <strong>WhatsApp</strong> → <strong>Cilësimet</strong> →
        <strong>Pajisjet e lidhura</strong> → <strong>Lidh pajisje</strong>
      </p>
      <script>setTimeout(() => location.reload(), 30000)</script>
    </body></html>
  `);
});

/** Sync: reconnect WhatsApp to trigger fresh history + LID mappings */
app.post('/sync', requireApiKey, async (_req, res) => {
  if (!sock) {
    res.status(503).json({ error: 'WhatsApp jo i inicializuar' });
    return;
  }
  console.log('[WA] Sync requested — rilidh për sinkronizim...');
  const beforeMappings = lidToPhoneMap.size;
  try {
    // Close and reconnect — triggers full history sync with LID mappings
    sock.end(undefined);
    await new Promise(r => setTimeout(r, 2000));
    await connectWhatsApp();
    // Wait for history sync to arrive (typically 5-15s)
    await new Promise(r => setTimeout(r, 12000));
    // Run all resolution strategies
    await reverseLookupLeads();
    await resolveFromGroups();
    const newMappings = lidToPhoneMap.size - beforeMappings;
    console.log(`[WA] Sync complete: ${newMappings} new LID mappings (total: ${lidToPhoneMap.size})`);
    res.json({
      success: true,
      status: connectionStatus,
      lidMappings: lidToPhoneMap.size,
      newMappings,
      pendingLids: pendingLidMessages.size,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Sync dështoi';
    console.error('[WA] Sync error:', err);
    res.status(500).json({ error: msg });
  }
});

/** Send a WhatsApp message */
app.post('/send', requireApiKey, async (req, res) => {
  if (connectionStatus !== 'connected' || !sock) {
    res.status(503).json({ error: 'WhatsApp jo i lidhur. Hap /qr dhe skano kodin.' });
    return;
  }

  const { to, message, leadId, leadName, teamId, jid: rawJidFromBody } = req.body as {
    to: string;
    message: string;
    leadId?: string;
    leadName?: string;
    teamId?: string;
    jid?: string;
  };

  if (!to || !message) {
    res.status(400).json({ error: 'Fushat "to" dhe "message" janë të detyrueshme' });
    return;
  }

  const cleanPhone = normalizePhone(String(to));

  // Use the provided jid directly (handles LID contacts), or construct from phone
  const isValidJid = rawJidFromBody &&
    (rawJidFromBody.endsWith('@s.whatsapp.net') || rawJidFromBody.endsWith('@lid'));
  const jid = isValidJid ? rawJidFromBody : `${cleanPhone}@s.whatsapp.net`;

  if (!isValidJid && (cleanPhone.length < 7 || cleanPhone.length > 15)) {
    res.status(400).json({ error: 'Numri i telefonit është i pavlefshëm' });
    return;
  }

  try {
    const sent = await sock.sendMessage(jid, { text: message });
    const resolvedTeamId = teamId || TEAM_ID;
    const waMessageId = sent?.key?.id || null;
    const docId = waMessageId || db.collection('whatsappMessages').doc().id;

    const docRef = db.collection('whatsappMessages').doc(docId);
    await docRef.set({
      phone: cleanPhone,
      jid,
      direction: 'outbound',
      message,
      leadId: leadId || null,
      leadName: leadName || null,
      waMessageId,
      teamId: resolvedTeamId,
      status: 'sent',
      channel: 'baileys',
      createdAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
    });

    console.log(`[WA] → ${cleanPhone}: ${message.slice(0, 80)}`);
    res.json({ success: true, id: docRef.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Dërgimi dështoi';
    console.error('[WA] Gabim gjatë dërgimit:', err);
    res.status(500).json({ error: msg });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n[VPS Server] ✅ Aktiv në port ${PORT}`);
  console.log(`[VPS Server]  → Status: http://localhost:${PORT}/status`);
  console.log(`[VPS Server]  → QR:     http://localhost:${PORT}/qr\n`);
  loadLidMappings().then(() => connectWhatsApp());
});
