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
const normalizePhone = (phone: string): string => phone.replace(/[^\d]/g, '');

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

/** Maps LID JID (e.g. "123456789@lid") → phone JID (e.g. "355691234567@s.whatsapp.net") */
const lidToPhoneMap = new Map<string, string>();

/** Queue of messages that arrived with unresolved LID JIDs */
const pendingLidMessages = new Map<string, Array<{ msg: any; body: string; ts: Date; waMessageId: string | null; isFromMe: boolean }>>();

/** Register a LID→phone mapping and trigger backfill + queue processing */
async function registerLidMapping(lid: string, phoneJid: string): Promise<void> {
  if (!lid || !phoneJid || lidToPhoneMap.has(lid)) return;
  lidToPhoneMap.set(lid, phoneJid);
  console.log(`[WA] LID mapping: ${lid} → ${phoneJid} (total: ${lidToPhoneMap.size})`);

  // Backfill old messages stored with LID number
  backfillLidMessages(lid, phoneJid);

  // Process queued messages for this LID
  const queued = pendingLidMessages.get(lid);
  if (queued?.length) {
    const phone = normalizePhone(phoneJid.split('@')[0]);
    console.log(`[WA] Processing ${queued.length} queued messages for ${lid} → ${phone}`);
    for (const item of queued) {
      try {
        const docId = item.waMessageId || db.collection('whatsappMessages').doc().id;
        await db.collection('whatsappMessages').doc(docId).set({
          phone,
          jid: phoneJid,
          direction: item.isFromMe ? 'outbound' : 'inbound',
          message: item.body,
          waMessageId: item.waMessageId,
          leadId: null,
          leadName: null,
          teamId: TEAM_ID,
          status: item.isFromMe ? 'sent' : 'received',
          createdAt: admin.firestore.Timestamp.fromDate(item.ts),
          updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
        }, { merge: true });
      } catch (e) {
        console.error(`[WA] Error saving queued message:`, e);
      }
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

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['Business CRM', 'Chrome', '1.0.0'],
    printQRInTerminal: true,
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
    }
  });

  // ── Build LID → phone map from all available sources ─────────────────────────
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
    if (mappings.length || contacts.length) {
      console.log(`[WA] History sync: ${mappings.length} LID mappings, ${contacts.length} contacts`);
    }
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
      if (rawJid.endsWith('@lid')) {
        const phoneJid = lidToPhoneMap.get(rawJid);
        if (phoneJid) {
          resolvedJid = phoneJid;
          console.log(`[WA] LID resolved: ${rawJid} → ${phoneJid}`);
        } else {
          // Queue message for later processing when mapping arrives
          const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '[Media]';
          const ts = new Date(Number(msg.messageTimestamp) * 1000);
          const queue = pendingLidMessages.get(rawJid) || [];
          queue.push({ msg, body, ts, waMessageId: msg.key.id || null, isFromMe: !!msg.key.fromMe });
          pendingLidMessages.set(rawJid, queue);
          console.log(`[WA] LID queued (${queue.length}): ${rawJid}`);
          continue;
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
          leadName: autoLeadName,
          teamId: TEAM_ID,
          status: isFromMe ? 'sent' : 'received',
          createdAt: admin.firestore.Timestamp.fromDate(ts),
          updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
        }, { merge: true });
        console.log(`[WA] ${isFromMe ? '→ (telefon)' : '←'} ${phone}: ${body.slice(0, 80)}`);
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
  connectWhatsApp();
});
