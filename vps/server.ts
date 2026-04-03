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

  // ── Incoming messages → save to Firestore ──────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const rawJid = msg.key.remoteJid || '';
      if (rawJid.endsWith('@g.us')) continue; // skip group messages

      const phone = normalizePhone(rawJid.split('@')[0]);
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

  const { to, message, leadId, leadName, teamId } = req.body as {
    to: string;
    message: string;
    leadId?: string;
    leadName?: string;
    teamId?: string;
  };

  if (!to || !message) {
    res.status(400).json({ error: 'Fushat "to" dhe "message" janë të detyrueshme' });
    return;
  }

  const cleanPhone = normalizePhone(String(to));
  if (cleanPhone.length < 7 || cleanPhone.length > 15) {
    res.status(400).json({ error: 'Numri i telefonit është i pavlefshëm' });
    return;
  }

  const jid = `${cleanPhone}@s.whatsapp.net`;

  try {
    const sent = await sock.sendMessage(jid, { text: message });
    const resolvedTeamId = teamId || TEAM_ID;
    const waMessageId = sent?.key?.id || null;
    const docId = waMessageId || db.collection('whatsappMessages').doc().id;

    const docRef = db.collection('whatsappMessages').doc(docId);
    await docRef.set({
      phone: cleanPhone,
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
