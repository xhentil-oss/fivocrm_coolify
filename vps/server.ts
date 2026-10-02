import express from 'express';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
} from 'baileys';
import { Boom } from '@hapi/boom';
import admin from 'firebase-admin';
import QRCode from 'qrcode';
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import cors from 'cors';
import multer from 'multer';
import pino from 'pino';
import { randomUUID, timingSafeEqual } from 'crypto';
import { lookup as dnsLookup } from 'dns/promises';

process.on('unhandledRejection', (err) => { console.error('[WA] Unhandled rejection:', err); });
process.on('uncaughtException', (err) => { console.error('[WA] Uncaught exception:', err); });

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ── CORS ──────────────────────────────────────────────────────────────────────
// Browser origins that may call this server directly (uploads, status polls).
// Server-to-server calls (Vercel → VPS) carry no Origin header and are not
// affected. `https://*.fivocrm.com` matches exactly one subdomain label.
// `cors()` with no options used to reflect ANY origin.
const DEFAULT_CORS_ORIGINS = ['https://fivocrm.vercel.app', 'https://fivocrm.com', 'https://*.fivocrm.com'];
const DEV_CORS_ORIGINS = ['capacitor://localhost', 'https://localhost', 'http://localhost:5173'];
const envCorsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const CORS_ORIGINS: string[] = envCorsOrigins.length ? envCorsOrigins : [...DEFAULT_CORS_ORIGINS];
if (!IS_PRODUCTION) CORS_ORIGINS.push(...DEV_CORS_ORIGINS);

function originAllowed(origin: string): boolean {
  let o: URL;
  try { o = new URL(origin); } catch { return false; }
  const originNorm = `${o.protocol}//${o.host}`.toLowerCase();
  for (const pattern of CORS_ORIGINS) {
    const p = pattern.toLowerCase().replace(/\/$/, '');
    if (!p.includes('*')) { if (p === originNorm) return true; continue; }
    // Wildcard subdomain: "<scheme>://*.<domain>[:port]" — one label, never the apex.
    const m = /^([a-z]+:\/\/)\*\.([^/*]+)$/.exec(p);
    if (!m) continue;
    const scheme = m[1]; const suffix = m[2];
    if (`${o.protocol}//` !== scheme) continue;
    const host = o.host.toLowerCase();
    if (!host.endsWith(`.${suffix}`)) continue;
    const label = host.slice(0, -(suffix.length + 1));
    if (/^[a-z0-9-]+$/.test(label)) return true;
  }
  return false;
}

const app = express();
app.set('trust proxy', true); // respect X-Forwarded-Proto for https URLs behind a proxy
app.disable('x-powered-by');
// Global hardening headers (no helmet dependency needed for two headers).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(cors({
  origin(origin, cb) {
    // No Origin = server-to-server / curl / same-origin navigation → allow (no CORS headers needed).
    if (!origin) { cb(null, true); return; }
    if (originAllowed(origin)) { cb(null, true); return; }
    // Not an error: simply answer without CORS headers so the browser blocks it.
    cb(null, false);
  },
  credentials: false,
  maxAge: 600,
}));
app.use(express.json());

// ── File hosting (replaces Firebase Storage for chat/comment attachments) ──────
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * Upload type policy. The stored extension used to come straight from the client
 * filename while express.static picks Content-Type BY extension — so anyone with
 * a Firebase login could park an .html/.svg on the vps.fivocrm.com origin.
 * Three checks now agree before a byte is written: extension allow-list, the
 * declared mimetype must belong to that extension, and for binary media the
 * magic bytes must match. Mirrors storage.rules (images / audio / video / pdf /
 * office / text). Legacy Office (.doc/.xls/.ppt) stays allowed alongside OOXML.
 */
const UPLOAD_EXT_MIME: Record<string, string[]> = {
  png: ['image/png'],
  jpg: ['image/jpeg', 'image/jpg', 'image/pjpeg'],
  jpeg: ['image/jpeg', 'image/jpg', 'image/pjpeg'],
  gif: ['image/gif'],
  webp: ['image/webp'],
  pdf: ['application/pdf'],
  mp3: ['audio/mpeg', 'audio/mp3', 'audio/mpeg3', 'audio/x-mpeg-3'],
  m4a: ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac'],
  ogg: ['audio/ogg', 'application/ogg', 'video/ogg', 'audio/opus'],
  wav: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
  mp4: ['video/mp4', 'audio/mp4'],
  webm: ['video/webm', 'audio/webm'],
  // Phone cameras / recorders (WhatsAppChatPanel accepts image/*, video/*, audio/*).
  mov: ['video/quicktime'],
  '3gp': ['video/3gpp', 'audio/3gpp'],
  heic: ['image/heic', 'image/heif'],
  heif: ['image/heif', 'image/heic'],
  aac: ['audio/aac', 'audio/x-aac', 'audio/aacp'],
  opus: ['audio/opus', 'audio/ogg'],
  amr: ['audio/amr', 'audio/3gpp'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ppt: ['application/vnd.ms-powerpoint'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  txt: ['text/plain'],
  csv: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
};
/** Never stored, whatever the mimetype says — these execute or script on our origin. */
const FORBIDDEN_UPLOAD_EXT = new Set(['html', 'htm', 'svg', 'js', 'mjs', 'xml', 'shtml', 'xhtml', 'xht', 'php', 'cgi']);
/** Types a browser may render inline; everything else is served as a download. */
const INLINE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'pdf', 'mp3', 'm4a', 'aac', 'opus', 'amr', 'ogg', 'wav', 'mp4', 'mov', '3gp', 'webm']);

/**
 * Magic-byte sniffer for the binary media types we accept. Returns a canonical
 * family tag or null when the content is not one of them (office/text pass through
 * without sniffing — they have no single reliable signature).
 */
function sniffType(buf: Buffer): 'png' | 'jpeg' | 'gif' | 'webp' | 'pdf' | 'wav' | 'ogg' | 'mp3' | 'mp4' | 'webm' | 'aac' | 'amr' | null {
  if (buf.length < 12) return null;
  const ascii = (from: number, len: number) => buf.subarray(from, from + len).toString('latin1');
  if (buf[0] === 0x89 && ascii(1, 3) === 'PNG' && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'wav';
  if (ascii(0, 5) === '%PDF-') return 'pdf';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  // AMR-NB / AMR-WB (Android voice notes).
  if (ascii(0, 5) === '#!AMR') return 'amr';
  // Raw ADTS AAC: 12-bit sync 0xFFF, layer bits 00 (checked BEFORE the MP3 frame sync,
  // which shares the 0xFFE prefix but has non-zero layer bits).
  if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return 'aac';
  // MP3: ID3v2 tag, or a raw MPEG audio frame sync (0xFFE? / 0xFFF?).
  if (ascii(0, 3) === 'ID3') return 'mp3';
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0) return 'mp3';
  // MP4 / M4A / MOV / HEIC / 3GP: ISO BMFF "ftyp" box at offset 4 (brand differs; all
  // are the same container family). Old QuickTime files may start with another atom.
  if (ascii(4, 4) === 'ftyp') return 'mp4';
  if (['moov', 'mdat', 'wide', 'free', 'skip'].includes(ascii(4, 4))) return 'mp4';
  // WebM (and Matroska): EBML header.
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  return null;
}
/** Which sniffed families are acceptable content for a given (allow-listed) extension. */
const EXT_SNIFF: Record<string, Array<ReturnType<typeof sniffType>>> = {
  png: ['png'], jpg: ['jpeg'], jpeg: ['jpeg'], gif: ['gif'], webp: ['webp'], pdf: ['pdf'],
  mp3: ['mp3'], m4a: ['mp4', 'aac'], ogg: ['ogg'], wav: ['wav'], mp4: ['mp4'], webm: ['webm'],
  mov: ['mp4'], '3gp': ['mp4'], heic: ['mp4'], heif: ['mp4'], aac: ['aac', 'mp4'], opus: ['ogg'], amr: ['amr'],
};

function uploadExtension(originalName: string, mimetype: string): string {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(String(originalName || ''));
  if (m) return m[1].toLowerCase();
  // No extension in the name (e.g. a Blob from MediaRecorder): derive it from the mimetype.
  const mt = String(mimetype || '').toLowerCase().split(';')[0].trim();
  for (const [ext, mimes] of Object.entries(UPLOAD_EXT_MIME)) if (mimes.includes(mt)) return ext;
  return '';
}

// /files: only ever serve an allow-listed extension (a file stored before this
// policy existed with a scripting extension is refused, not served), with nosniff,
// a sandboxing CSP and Content-Disposition: attachment for everything a browser
// need not render inline. Documents/text download; images/audio/video/pdf inline.
app.use('/files', (req, res, next) => {
  const ext = (/\.([a-zA-Z0-9]{1,8})$/.exec(req.path) || [])[1]?.toLowerCase() || '';
  if (!ext || !UPLOAD_EXT_MIME[ext] || FORBIDDEN_UPLOAD_EXT.has(ext)) { res.status(404).json({ error: 'Skedari nuk u gjet' }); return; }
  next();
});
app.use('/files', express.static(UPLOAD_DIR, {
  maxAge: '7d', immutable: true, dotfiles: 'deny', index: false, redirect: false,
  setHeaders(res, filePath) {
    const ext = (/\.([a-zA-Z0-9]{1,8})$/.exec(filePath) || [])[1]?.toLowerCase() || '';
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('Content-Disposition', INLINE_EXT.has(ext) ? 'inline' : 'attachment');
  },
}));
const uploadMw = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

// Per-user upload quota: 200 files / 500 MB per rolling 24h, in memory.
const UPLOAD_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
const UPLOAD_QUOTA_MAX_FILES = 200;
const UPLOAD_QUOTA_MAX_BYTES = 500 * 1024 * 1024;
const uploadQuota = new Map<string, Array<{ t: number; size: number }>>();
/** Returns null when allowed (and records the upload), or the reason when over quota. */
function checkUploadQuota(uid: string, size: number): string | null {
  const now = Date.now(); const cutoff = now - UPLOAD_QUOTA_WINDOW_MS;
  const rows = (uploadQuota.get(uid) || []).filter((r) => r.t > cutoff);
  const bytes = rows.reduce((s, r) => s + r.size, 0);
  if (rows.length >= UPLOAD_QUOTA_MAX_FILES) { uploadQuota.set(uid, rows); return 'Kuota e ngarkimeve (200 skedarë / 24 orë) u arrit'; }
  if (bytes + size > UPLOAD_QUOTA_MAX_BYTES) { uploadQuota.set(uid, rows); return 'Kuota e ngarkimeve (500 MB / 24 orë) u arrit'; }
  rows.push({ t: now, size });
  uploadQuota.set(uid, rows);
  return null;
}
// Prune idle users hourly so the map cannot grow with every uid that ever uploaded.
setInterval(() => {
  const cutoff = Date.now() - UPLOAD_QUOTA_WINDOW_MS;
  for (const [uid, rows] of uploadQuota) {
    const live = rows.filter((r) => r.t > cutoff);
    if (live.length) uploadQuota.set(uid, live); else uploadQuota.delete(uid);
  }
}, 60 * 60 * 1000).unref?.();

/** The custom claims we mint (api/_tenantClaims.ts); anything else is a legacy token. */
interface TenantClaims { uid: string; bid: string | null; tid: string | null; pbid: string | null; cid: string | null; superAdmin: boolean }

// Verify a Firebase ID token (so clients never need the VPS API secret to upload).
async function requireFirebaseAuth(req: any, res: any, next: any) {
  const h = req.headers.authorization as string | undefined;
  if (!h?.startsWith('Bearer ')) { res.status(401).json({ error: 'Mungon token-i i autentikimit' }); return; }
  try {
    const decoded = await admin.auth().verifyIdToken(h.slice(7));
    req.uid = decoded.uid;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    req.claims = {
      uid: decoded.uid,
      bid: str((decoded as any).bid), tid: str((decoded as any).tid),
      pbid: str((decoded as any).pbid), cid: str((decoded as any).cid),
      superAdmin: (decoded as any).superAdmin === true,
    } satisfies TenantClaims;
    next();
  } catch {
    res.status(401).json({ error: 'Token i pavlefshëm' });
  }
}

const teamBusinessCache = new Map<string, { bid: string | null; at: number }>();
/** `teams/{teamId}.businessId`, cached 5 min. null = team does not exist / has no business. */
async function businessOfTeam(teamId: string): Promise<string | null> {
  const hit = teamBusinessCache.get(teamId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.bid;
  let bid: string | null = null;
  try {
    const snap = await db.collection('teams').doc(teamId).get();
    bid = snap.exists ? (String((snap.data() as any)?.businessId || '') || null) : null;
  } catch (err) { console.error('[upload] teams lookup failed', err); }
  teamBusinessCache.set(teamId, { bid, at: Date.now() });
  return bid;
}

/**
 * May this token write under `<teamId>/<folder>/…`?
 *  - staff: `tid` equals the team, or the team's business equals `bid`;
 *  - portal client (`pbid`, never `bid`): only portal/client folders (and its own
 *    avatar), and when a real team is named it must belong to the client's tenant;
 *  - a token that predates the claims rollout: membership-backed fallback
 *    (`teamMembers` where teamId + userId), same as the rest of the platform.
 */
async function uploadTeamAllowed(claims: TenantClaims, teamId: string, folder: string): Promise<{ ok: boolean; error?: string }> {
  if (claims.superAdmin) return { ok: true };
  if (claims.bid || claims.tid) {
    if (claims.tid && claims.tid === teamId) return { ok: true };
    if (claims.bid && teamId !== 'shared' && (await businessOfTeam(teamId)) === claims.bid) return { ok: true };
    return { ok: false, error: 'Nuk jeni anëtar i këtij ekipi' };
  }
  if (claims.pbid) {
    const portalFolder = /^(portal|client)/i.test(folder) || folder === 'avatars';
    if (!portalFolder) return { ok: false, error: 'Dosje e palejuar për klientët e portalit' };
    if (teamId !== 'shared' && (await businessOfTeam(teamId)) !== claims.pbid) return { ok: false, error: 'Ekipi nuk i përket llogarisë suaj' };
    return { ok: true };
  }
  // Legacy token without tenant claims → prove membership from Firestore.
  if (teamId === 'shared') return { ok: false, error: 'Mungon ekipi (teamId)' };
  try {
    const snap = await db.collection('teamMembers').where('teamId', '==', teamId).where('userId', '==', claims.uid).limit(1).get();
    if (!snap.empty) return { ok: true };
  } catch (err) { console.error('[upload] teamMembers lookup failed', err); }
  return { ok: false, error: 'Nuk jeni anëtar i këtij ekipi' };
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
  /**
   * Set by unloadAgent(): the account was deleted/disabled in Firestore. The
   * connection.update 'close' handler must NOT schedule a reconnect for it —
   * that is exactly how a deleted account kept sending for a day.
   */
  unloading: boolean;
  /** /send waits here for the server ack (messages.update status ≥ 2) of a message id. */
  ackWaiters: Map<string, (status: number) => void>;
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
    unloading: false,
    ackWaiters: new Map(),
  };
}

const agents = new Map<string, AgentState>();

/**
 * Baileys' own log. `silent` hid every send failure ("no sessions", bad-request,
 * decrypt errors) for the life of this server; `warn` is quiet when healthy.
 */
const BAILEYS_LOG_LEVEL = process.env.BAILEYS_LOG_LEVEL || 'warn';

/**
 * How long /send waits for WhatsApp's server ack before answering. The Vercel
 * relay (api/whatsapp.ts) aborts at 10s, so this must stay well under it. A
 * message that is not acked in time is returned as `status: 'pending'` (still a
 * 200 — it may well be acked a second later) and the messages.update handler
 * upgrades the row when the receipt arrives.
 */
const SEND_ACK_TIMEOUT_MS = 6_000;

/** Baileys WAMessageStatus → the `whatsappMessages.status` we store. */
const RECEIPT_STATUS: Record<number, 'failed' | 'sent' | 'delivered' | 'read'> = {
  0: 'failed', 2: 'sent', 3: 'delivered', 4: 'read', 5: 'read',
};

/**
 * Stop an agent whose Firestore account was deleted or disabled. Before this
 * existed, deleting the account in Cilësimet only removed the document: the VPS
 * kept the socket alive (and reconnecting) until the next pm2 restart, and
 * getAgent() kept picking it for sends — messages left from a number nobody
 * managed any more.
 *
 * - `deleted`  → log the companion device out of WhatsApp and wipe the session.
 * - `disabled` → just close the socket; the session stays so re-enabling works
 *                without a new QR scan.
 */
async function unloadAgent(agent: AgentState, reason: 'deleted' | 'disabled'): Promise<void> {
  const id = agent.config.id;
  agent.unloading = true;
  agents.delete(id);
  if (agent.reconnectTimer) { clearTimeout(agent.reconnectTimer); agent.reconnectTimer = null; }
  if (agent.lidResyncTimer) { clearInterval(agent.lidResyncTimer); agent.lidResyncTimer = null; }
  if (agent.cacheEvictTimer) { clearInterval(agent.cacheEvictTimer); agent.cacheEvictTimer = null; }
  for (const resolve of agent.ackWaiters.values()) resolve(0);
  agent.ackWaiters.clear();
  const sock = agent.sock;
  agent.sock = null;
  agent.connectionStatus = 'disconnected';
  agent.qrDataUrl = null;
  if (sock) {
    if (reason === 'deleted') {
      // logout() needs an open socket; fall back to a plain close.
      try { await Promise.race([sock.logout(), new Promise(r => setTimeout(r, 5000))]); }
      catch { try { sock.end(undefined); } catch {} }
    } else {
      try { sock.end(undefined); } catch {}
    }
  }
  if (reason === 'deleted') {
    try { rmSync(authDir(id), { recursive: true, force: true }); } catch {}
  }
  console.log(`[${id}] Agent u shkarkua (${reason === 'deleted' ? 'llogaria u fshi' : 'llogaria u çaktivizua'})`);
}

/**
 * Bring the in-memory agents in line with `whatsappAccounts`: start every
 * enabled account that is not running, stop every running agent whose account
 * is gone or disabled. Used by the live listener and by POST /reload.
 * Serialised — two snapshots in a row must not race each other.
 */
let reconcileChain: Promise<void> = Promise.resolve();
function reconcileAgents(docs: admin.firestore.QueryDocumentSnapshot[]): Promise<{ added: string[]; removed: string[] }> {
  const run = async () => {
    const added: string[] = []; const removed: string[] = [];
    const enabledIds = new Set<string>();
    const knownIds = new Set(docs.map(d => d.id));

    for (const doc of docs) {
      const data = doc.data();
      if (data.enabled !== true) continue;
      enabledIds.add(doc.id);
      if (agents.has(doc.id)) continue;
      const config: AgentConfig = {
        id: doc.id, teamId: data.teamId || DEFAULT_TEAM_ID,
        label: data.label || doc.id, assignedToUserId: data.assignedToUserId, enabled: true,
      };
      const agent = createAgentState(config);
      agent.cacheEvictTimer = setInterval(() => agent.leadPhoneCache.clear(), 6 * 60 * 60 * 1000);
      agents.set(doc.id, agent);
      await loadLidMappings(agent);
      await loadPendingLidMessages(agent);
      connectAgent(agent).catch(e => console.error(`[${agent.config.id}] connectAgent error:`, e));
      added.push(doc.id);
      console.log(`[VPS] Agent i ri ngarkuar: ${config.id} (${config.label})`);
    }

    // The env-based 'default' agent only exists while the collection is empty.
    const keepEnvDefault = docs.length === 0;
    for (const agent of Array.from(agents.values())) {
      const id = agent.config.id;
      if (enabledIds.has(id)) continue;
      if (id === 'default' && keepEnvDefault && !knownIds.has('default')) continue;
      await unloadAgent(agent, knownIds.has(id) ? 'disabled' : 'deleted');
      removed.push(id);
    }
    return { added, removed };
  };
  const result = reconcileChain.then(run, run);
  reconcileChain = result.then(() => undefined, () => undefined);
  return result;
}

/**
 * Live mirror of `whatsappAccounts`: a delete / disable / add in Cilësimet takes
 * effect within seconds, without a restart. One listener, reads only on change.
 */
function watchAccounts(): void {
  db.collection('whatsappAccounts').onSnapshot(
    (snap) => {
      reconcileAgents(snap.docs)
        .then(({ added, removed }) => {
          if (added.length || removed.length) console.log(`[VPS] whatsappAccounts → +${added.length} / -${removed.length} agjentë`);
        })
        .catch(e => console.error('[VPS] reconcile error:', e));
    },
    (err) => {
      console.error('[VPS] whatsappAccounts listener error — riprovoj në 60s:', err);
      setTimeout(watchAccounts, 60_000);
    },
  );
}

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

/** Constant-time comparison; a length mismatch is simply "not equal". */
function secretEquals(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || !given || !expected) return false;
  const a = Buffer.from(given, 'utf8'); const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!secretEquals(req.headers['x-api-key'], API_SECRET!)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  next();
}

/** HTML-escape for the few server-rendered pages (/qr). Never interpolate raw. */
function escapeHtml(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ── Log hygiene ───────────────────────────────────────────────────────────────
// Phone numbers and message bodies are personal data; by default the log keeps
// the last 4 digits + the length. WA_LOG_BODIES=1 restores full logging for a
// debugging session — never leave it on.
const WA_LOG_BODIES = process.env.WA_LOG_BODIES === '1';
function maskPhone(v: unknown): string {
  const s = String(v ?? '');
  if (WA_LOG_BODIES) return s;
  const digits = s.replace(/\D/g, '');
  if (!digits) return s ? '…' : '';
  return `…${digits.slice(-4)}(${digits.length})`;
}
/** A jid like `355…@s.whatsapp.net` → `…1234(12)@s.whatsapp.net`. */
function maskJid(v: unknown): string {
  const s = String(v ?? '');
  if (WA_LOG_BODIES) return s;
  const at = s.indexOf('@');
  return at === -1 ? maskPhone(s) : `${maskPhone(s.slice(0, at))}${s.slice(at)}`;
}
function maskBody(v: unknown): string {
  const s = String(v ?? '');
  return WA_LOG_BODIES ? s.slice(0, 80) : `[${s.length} karaktere]`;
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
    console.log(`[${agent.config.id}] Backfill: ${maskPhone(lidPhone)} → ${maskPhone(realPhone)} (${count} msgs)`);
  } catch (e) { console.error(`[${agent.config.id}] Backfill error:`, e); }
}

async function registerLidMapping(agent: AgentState, lid: string, phoneJid: string): Promise<void> {
  if (!lid || !phoneJid || agent.lidToPhoneMap.has(lid)) return;
  agent.lidToPhoneMap.set(lid, phoneJid);
  console.log(`[${agent.config.id}] LID: ${maskJid(lid)} → ${maskJid(phoneJid)} (${agent.lidToPhoneMap.size} total)`);
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
      console.log(`[${agent.config.id}] Startup resolved ${docIds.length} LID docs for ${maskJid(lid)}`);
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
    logger: pino({ level: BAILEYS_LOG_LEVEL }),
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
      // Nobody is going to ack a message on a closed socket.
      for (const resolve of agent.ackWaiters.values()) resolve(-1);
      agent.ackWaiters.clear();
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const isLoggedOut = code === DisconnectReason.loggedOut;
      console.log(`[${agent.config.id}] Lidhja u ndërpre (${code})`);
      // Cilësimet reads this so "Lidhur" reflects the socket, not a phone number
      // stamped once at the first successful scan.
      db.collection('whatsappAccounts').doc(agent.config.id).update({
        connectionStatus: 'disconnected',
        lastDisconnectedAt: admin.firestore.Timestamp.fromDate(new Date()),
        ...(isLoggedOut ? { connectedPhone: null } : {}),
      }).catch(() => {});
      if (agent.unloading) return; // account deleted/disabled — never reconnect
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
          await db.collection('whatsappAccounts').doc(agent.config.id).update({ connectedPhone: myPhone, connectionStatus: 'connected', lastConnectedAt: admin.firestore.Timestamp.fromDate(new Date()) }).catch(() => {});
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
      // Only PEOPLE become contacts. Groups (@g.us), WhatsApp Channels (@newsletter)
      // and status posts (@broadcast) carry an 18-digit id, not a phone number — a
      // political news channel used to be minted as a CRM lead per post.
      if (!isPersonJid(rawJid)) continue;

      let resolvedJid = rawJid; let isLid = false;
      if (rawJid.endsWith('@lid')) {
        const phoneJid = agent.lidToPhoneMap.get(rawJid);
        if (phoneJid) { resolvedJid = phoneJid; } else { isLid = true; }
      }

      const phone = normalizePhone(resolvedJid.split('@')[0]);
      if (!phone || !isPlausiblePhone(phone)) continue;

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
          console.log(`[${agent.config.id}] ${isFromMe ? '→' : '←'} ${maskPhone(phone)}: ${maskBody(body)}`);
        }

        // Hand the event to the CRM's shared inbound handler (identity → conversation →
        // notification → auto-reply). The row above is already durable, so this is
        // fire-and-forget with retries; a LID-only jid is skipped until its phone is known.
        // fromMe = the staff answered from the PHONE — the cheapest "replied" signal we have.
        if (!isLid) {
          const m = msg.message as any;
          const kind = m.reactionMessage ? 'reaction'
            : m.protocolMessage ? 'system'
            : (m.conversation || m.extendedTextMessage?.text) ? 'text'
            : 'media';
          void postWaEvent({
            channel: 'baileys',
            direction: isFromMe ? 'outbound' : 'inbound',
            teamId: agent.config.teamId,
            agentId: agent.config.id,
            metaPhoneNumberId: null,
            channelPhone: agent.connectedPhone || agent.config.id,
            waMessageId: docId,
            phone,
            jid: resolvedJid,
            isLid: false,
            text: body,
            kind,
            pushName,
            isAutoReply: false,
            timestamp: ts.toISOString(),
          });
        }
      } catch (e) { console.error(`[${agent.config.id}] Error saving message:`, e); }
    }
  });

  // Receipts: 0 ERROR, 1 PENDING, 2 SERVER_ACK, 3 DELIVERY_ACK, 4 READ, 5 PLAYED.
  // Status 2 is the first proof WhatsApp accepted the message — /send waits for it.
  agent.sock.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      const waMessageId = update.key?.id; if (!waMessageId) continue;
      const code = (update.update as any)?.status;
      if (typeof code !== 'number') continue;
      agent.ackWaiters.get(waMessageId)?.(code);
      const newStatus = RECEIPT_STATUS[code]; if (!newStatus) continue;
      try {
        // Our rows use the WhatsApp id as the document id (one read, no index);
        // fall back to the query for rows that predate that convention.
        const direct = db.collection('whatsappMessages').doc(waMessageId);
        const directSnap = await direct.get();
        const ref = directSnap.exists
          ? direct
          : (await db.collection('whatsappMessages').where('waMessageId', '==', waMessageId).limit(1).get()).docs[0]?.ref;
        if (!ref) continue;
        const current = directSnap.exists ? directSnap.data()?.status : undefined;
        // Receipts can arrive out of order; never downgrade read → delivered → sent.
        const rank: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };
        if (newStatus !== 'failed' && current && (rank[current] ?? -1) > rank[newStatus]) continue;
        await ref.update({ status: newStatus, updatedAt: admin.firestore.Timestamp.fromDate(new Date()) });
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

/**
 * Loose lookup for the legacy single-agent routes (/qr, /sync redirects): any
 * agent will do because nothing tenant-scoped is written. NOT for /send.
 */
function getAgent(agentId?: string): AgentState | null {
  if (agentId && agents.has(agentId)) return agents.get(agentId)!;
  for (const agent of agents.values()) { if (agent.connectionStatus === 'connected') return agent; }
  return agents.size > 0 ? agents.values().next().value : null;
}

/**
 * Tenant-safe agent resolution for /send. Until Sep 2026 the fallback was "the
 * first connected agent of ANY tenant", and `teamId || agent.config.teamId` let
 * the body relabel the row — so a tenant with no connected number sent through a
 * stranger's WhatsApp, and the message was filed under the caller's team.
 *
 *  - `agentId` given → that agent, and if `teamId` is also given it must be the
 *    agent's own team (mismatch = 400, never a silent relabel);
 *  - only `teamId` given → a CONNECTED agent whose config.teamId is that team;
 *    never one from another tenant;
 *  - neither → 400. The row is always stamped with the AGENT's team.
 */
interface SendAgentResolution { ok: boolean; agent?: AgentState; status?: number; error?: string }
function resolveSendAgent(agentId: string | undefined, teamId: string | undefined): SendAgentResolution {
  if (!agentId && !teamId) return { ok: false, status: 400, error: 'Kërkohet "agentId" ose "teamId"' };
  if (agentId) {
    const agent = agents.get(agentId);
    if (!agent) return { ok: false, status: 404, error: 'Agenti nuk u gjet' };
    if (teamId && agent.config.teamId !== teamId) return { ok: false, status: 400, error: 'agentId dhe teamId nuk përputhen' };
    if (agent.connectionStatus !== 'connected' || !agent.sock) return { ok: false, status: 503, error: 'WhatsApp jo i lidhur. Hap /qr/:agentId dhe skano.' };
    return { ok: true, agent };
  }
  let sameTeam = 0;
  for (const agent of agents.values()) {
    if (agent.config.teamId !== teamId) continue;
    sameTeam++;
    if (agent.connectionStatus === 'connected' && agent.sock) return { ok: true, agent };
  }
  return sameTeam
    ? { ok: false, status: 503, error: 'Asnjë agent WhatsApp i këtij ekipi nuk është i lidhur. Hap /qr/:agentId dhe skano.' }
    : { ok: false, status: 404, error: 'Ky ekip nuk ka asnjë agent WhatsApp të konfiguruar' };
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
    statuses[id] = {
      label: a.config.label, status: a.connectionStatus, teamId: a.config.teamId, assignedToUserId: a.config.assignedToUserId,
      connectedPhone: a.connectionStatus === 'connected' ? a.connectedPhone : null,
      lidMappings: a.lidToPhoneMap.size, pendingLids: a.pendingLidMessages.size,
    };
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

// Hot-reload: reconcile agents with Firestore without restarting (adds new
// enabled accounts AND unloads deleted/disabled ones — same as the live listener).
app.post('/reload', requireApiKey, async (_req: any, res: any) => {
  try {
    const snap = await db.collection('whatsappAccounts').get();
    const { added, removed } = await reconcileAgents(snap.docs);
    res.json({ ok: true, added: added.length, removed: removed.length, addedIds: added, removedIds: removed, total: agents.size });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Gabim' });
  }
});

// QR per agent
app.get('/qr/:agentId', requireApiKey, (req: any, res: any) => {
  const agent = agents.get(req.params.agentId);
  if (!agent) return res.status(404).send('<html><body style="font-family:sans-serif;padding:40px"><h2>Agent nuk u gjet</h2></body></html>');
  // `label` comes from a Firestore document any tenant admin can edit — escape it.
  const label = escapeHtml(agent.config.label);
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
  if (agent.connectionStatus === 'connected') {
    return res.send(`<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;background:#f0fdf4"><h2 style="color:#16a34a">✅ ${label} — I lidhur!</h2><p style="color:#555">WhatsApp është aktiv.</p></body></html>`);
  }
  if (!agent.qrDataUrl) {
    return res.send(`<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column"><h2>⏳ Duke pritur QR — ${label}...</h2><p style="color:#666">Prit disa sekonda dhe rifresko faqen.</p><script>setTimeout(() => location.reload(), 3000)</script></body></html>`);
  }
  // qrDataUrl is generated by us (QRCode.toDataURL) — still only ever emitted as a data: PNG.
  const qrSrc = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(agent.qrDataUrl) ? agent.qrDataUrl : '';
  res.send(`<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px"><h2 style="color:#111">📱 ${label}</h2><img src="${escapeHtml(qrSrc)}" style="width:260px;border:1px solid #eee;border-radius:12px;padding:8px"/><p style="color:#666;text-align:center;max-width:300px">Hap <strong>WhatsApp</strong> → <strong>Cilësimet</strong> → <strong>Pajisjet e lidhura</strong> → <strong>Lidh pajisje</strong></p><script>setTimeout(() => location.reload(), 30000)</script></body></html>`);
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
  const { to, message, leadId, leadName, teamId: rawTeamId, jid: rawJidFromBody, agentId: rawAgentId, isAutoReply, sentByUid } = (req.body || {}) as {
    to: string; message: string; leadId?: string; leadName?: string;
    teamId?: string | null; jid?: string; agentId?: string | null;
    /** Auto-reply echo (from api/_waInbound.ts) — must never count as a staff answer. */
    isAutoReply?: boolean;
    /** The staff uid that pressed send (api/whatsapp.ts); null for automation. */
    sentByUid?: string | null;
  };
  // Callers send `null` for "unknown"; treat anything but a non-empty string as absent.
  const agentId = typeof rawAgentId === 'string' && rawAgentId ? rawAgentId : undefined;
  const teamId = typeof rawTeamId === 'string' && rawTeamId ? rawTeamId : undefined;

  if (!to || !message || typeof to !== 'string' || typeof message !== 'string') {
    res.status(400).json({ error: 'Fushat "to" dhe "message" janë të detyrueshme' }); return;
  }

  // Tenant-safe resolution — never a foreign tenant's number, never a relabelled row.
  const resolved = resolveSendAgent(agentId, teamId);
  if (!resolved.ok || !resolved.agent) {
    res.status(resolved.status || 500).json({ error: resolved.error || 'Agenti nuk u zgjidh', agentId: agentId || null, teamId: teamId || null });
    return;
  }
  const agent: AgentState = resolved.agent;

  // Defence-in-depth rate limit: max 30 sends/min per RESOLVED agent (VPS-side
  // guard in addition to the per-user limit on Vercel). Keyed on the agent that
  // will actually send, so a teamId-only call cannot bypass it.
  if (!checkSendRate(agent.config.id)) {
    res.status(429).json({ error: 'Limiti i dërgimeve nga ky agent u arrit. Provoni pas pak.', agentId: agent.config.id });
    return;
  }

  const cleanPhone = normalizePhone(String(to));
  const isValidJid = rawJidFromBody && (rawJidFromBody.endsWith('@s.whatsapp.net') || rawJidFromBody.endsWith('@lid'));
  const jid = isValidJid ? rawJidFromBody : `${cleanPhone}@s.whatsapp.net`;
  if (!isValidJid && (cleanPhone.length < 7 || cleanPhone.length > 15)) {
    res.status(400).json({ error: 'Numri i telefonit është i pavlefshëm' }); return;
  }

  // Honest status. Baileys' sendMessage() resolves as soon as the stanza is
  // written to the socket — it says nothing about WhatsApp accepting it. The row
  // therefore starts as `pending` and becomes `sent` only on the server ack
  // (messages.update status 2). The id is generated HERE so the row exists before
  // the receipt can arrive (the ack used to race the write and hit a missing doc).
  // The row belongs to the AGENT's team, unconditionally — the body cannot relabel it
  // (resolveSendAgent already rejected a teamId that disagrees with the agent).
  const resolvedTeamId = agent.config.teamId;
  const waMessageId = generateMessageIDV2((agent.sock as any)?.user?.id);
  const ref = db.collection('whatsappMessages').doc(waMessageId);
  const now = () => admin.firestore.Timestamp.fromDate(new Date());
  await ref.set({
    phone: cleanPhone, jid, direction: 'outbound', message,
    leadId: leadId || null, leadName: leadName || null, waMessageId,
    teamId: resolvedTeamId, agentId: agent.config.id, channelPhone: agent.connectedPhone || agent.config.id,
    status: 'pending', channel: 'baileys',
    isAutoReply: !!isAutoReply,
    sentByUid: typeof sentByUid === 'string' && sentByUid ? sentByUid : null,
    createdAt: now(), updatedAt: now(),
  });

  const ack = new Promise<number>((resolve) => { agent.ackWaiters.set(waMessageId, resolve); });
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await agent.sock.sendMessage(jid, { text: message }, { messageId: waMessageId });
    const code = await Promise.race([
      ack,
      new Promise<number>((resolve) => { timer = setTimeout(() => resolve(-2), SEND_ACK_TIMEOUT_MS); }),
    ]);
    // -1 = socket closed before the ack, -2 = timed out, 0 = WhatsApp rejected it.
    if (code === 0 || code === -1) {
      const error = code === 0 ? 'WhatsApp e refuzoi mesazhin' : 'Lidhja u ndërpre para konfirmimit';
      await ref.update({ status: 'failed', error, updatedAt: now() }).catch(() => {});
      console.warn(`[${agent.config.id}] ✗ ${maskPhone(cleanPhone)}: ${error}`);
      res.status(502).json({ error, id: waMessageId, agentId: agent.config.id, teamId: resolvedTeamId });
      return;
    }
    const status = code >= 2 ? 'sent' : 'pending';
    if (status === 'pending') console.warn(`[${agent.config.id}] ? ${maskPhone(cleanPhone)}: pa ack pas ${SEND_ACK_TIMEOUT_MS}ms — mbetet pending`);
    else console.log(`[${agent.config.id}] → ${maskPhone(cleanPhone)}: ${maskBody(message)}${isAutoReply ? ' (auto-reply)' : ''}`);
    // teamId is returned so the caller (api/whatsapp.ts) can key the conversation
    // even when it did not know the agent's team.
    res.json({ success: true, id: waMessageId, status, agentId: agent.config.id, teamId: resolvedTeamId });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Dërgimi dështoi';
    await ref.update({ status: 'failed', error, updatedAt: now() }).catch(() => {});
    console.error(`[${agent.config.id}] ✗ ${maskPhone(cleanPhone)}: ${error}`);
    res.status(500).json({ error, id: waMessageId });
  } finally {
    if (timer) clearTimeout(timer);
    agent.ackWaiters.delete(waMessageId);
  }
});

// ── File upload (chat / comment attachments) ─────────────────────────────────
// POST /upload  (multipart: file, teamId, folder)  — auth via Firebase ID token.
// Returns { url, path, name, size, type }.  Files served publicly under /files.
app.post('/upload', requireFirebaseAuth, uploadMw.single('file'), async (req: any, res: any) => {
  try {
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'Mungon skedari' }); return; }
    const teamId = String(req.body.teamId || 'shared').replace(/[^a-zA-Z0-9_-]/g, '_') || 'shared';
    const folder = String(req.body.folder || 'uploads').replace(/[^a-zA-Z0-9_-]/g, '_') || 'uploads';

    // 1. The token must be allowed to write under this team (claims, never the body).
    const allowed = await uploadTeamAllowed(req.claims as TenantClaims, teamId, folder);
    if (!allowed.ok) { res.status(403).json({ error: allowed.error || 'Nuk lejohet' }); return; }

    // 2. Extension allow-list + mimetype consistency + magic bytes (see UPLOAD_EXT_MIME).
    const mimetype = String(file.mimetype || '').toLowerCase().split(';')[0].trim();
    const ext = uploadExtension(file.originalname, mimetype);
    if (!ext || FORBIDDEN_UPLOAD_EXT.has(ext) || !UPLOAD_EXT_MIME[ext]) {
      res.status(400).json({ error: `Prapashtesë skedari e palejuar: .${ext || '?'}` }); return;
    }
    if (!UPLOAD_EXT_MIME[ext].includes(mimetype)) {
      res.status(400).json({ error: `Tipi "${mimetype}" nuk përputhet me prapashtesën .${ext}` }); return;
    }
    const expectedSniff = EXT_SNIFF[ext];
    if (expectedSniff) {
      const sniffed = sniffType(file.buffer);
      if (!expectedSniff.includes(sniffed)) { res.status(400).json({ error: `Përmbajtja e skedarit nuk është .${ext}` }); return; }
    }

    // 3. Per-user quota (200 files / 500 MB per rolling 24h).
    const quota = checkUploadQuota(String(req.uid), file.size);
    if (quota) { res.status(429).json({ error: quota }); return; }

    // Unguessable filename (capability URL) — files are served publicly under
    // /files, so a predictable timestamp+originalname could be enumerated. A random
    // UUID makes the URL itself the secret, like Slack/WhatsApp attachment CDNs.
    // The original name is still returned as `name` for display/download.
    const safeName = `${randomUUID()}.${ext}`;
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
      type: UPLOAD_EXT_MIME[ext][0],
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
// ── Provider relay (cPanel/WHM + Dynadot) ─────────────────────────────────────
const whmHostCache = new Map<string, { ok: boolean; at: number }>();
async function isRegisteredWhmHost(hostname: string): Promise<boolean> {
  const key = hostname.toLowerCase();
  const hit = whmHostCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.ok;
  let ok = false;
  try {
    const snap = await db.collection('hostingServers').where('hostname', '==', key).limit(1).get();
    ok = !snap.empty;
  } catch (err) { console.error('[relay] hostingServers lookup failed', err); }
  whmHostCache.set(key, { ok, at: Date.now() });
  return ok;
}
/**
 * Private / loopback / link-local / unspecified / CGNAT / multicast, v4 and v6 —
 * including the `::ffff:a.b.c.d` (and hex `::ffff:xxxx:xxxx`) IPv4-mapped forms
 * that a dual-stack resolver hands back. Kept in sync with `isPrivateAddress`
 * in api/_hostingProviders.ts (direct mode applies the same predicate).
 */
function isPrivateIp(raw: string): boolean {
  let ip = String(raw || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!ip) return true;
  const zone = ip.indexOf('%'); if (zone !== -1) ip = ip.slice(0, zone); // fe80::1%eth0
  // IPv4-mapped IPv6 → the embedded IPv4.
  const mappedDotted = /^(?:0*:)*:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mappedDotted) ip = mappedDotted[1];
  const mappedHex = /^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16); const lo = parseInt(mappedHex[2], 16);
    ip = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const o = ip.split('.').map(Number);
    if (o.some((n) => n > 255)) return true;
    if (o[0] === 0 || o[0] === 10 || o[0] === 127) return true;             // 0/8, 10/8, 127/8
    if (o[0] === 169 && o[1] === 254) return true;                          // 169.254/16
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;              // 172.16/12
    if (o[0] === 192 && o[1] === 168) return true;                          // 192.168/16
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true;             // 100.64/10 (CGNAT)
    if (o[0] === 192 && o[1] === 0 && (o[2] === 0 || o[2] === 2)) return true; // 192.0.0/24, 192.0.2/24
    if (o[0] === 198 && (o[1] === 18 || o[1] === 19)) return true;          // 198.18/15
    if (o[0] >= 224) return true;                                           // multicast + reserved + broadcast
    return false;
  }
  if (!ip.includes(':')) return true; // not an IP literal at all — refuse
  // IPv6: strip leading zeros per group so "0000:…:0001" and "::1" compare equal.
  const groups = ip.split(':').map((g) => g.replace(/^0+(?=[0-9a-f])/, ''));
  const norm = groups.join(':');
  if (norm === '::' || norm === '::1' || norm === '0:0:0:0:0:0:0:0' || norm === '0:0:0:0:0:0:0:1') return true;
  if (groups.every((g) => g === '' || g === '0')) return true; // any spelling of ::
  if (/(^|:)ffff:\d{1,3}\./.test(norm) || /(^|:)ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(norm)) return true; // mapped form we did not parse → refuse
  const first = parseInt(groups[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 (multicast)
  if (first === 0x2001 && /^2001:db8:/.test(ip)) return true; // documentation
  if (/^64:ff9b:/.test(ip)) return true; // NAT64 well-known prefix (embeds IPv4; refuse rather than parse)
  return false;
}
/** true = refuse. Resolves ONCE and refuses if ANY returned address is private. */
async function resolvesToPrivate(hostname: string): Promise<boolean> {
  const h = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')) return isPrivateIp(h);
  try {
    const addrs = await dnsLookup(h, { all: true, verbatim: true });
    if (!addrs.length) return true;
    return addrs.some((a) => isPrivateIp(a.address));
  } catch { return true; }
}
// Same idea as /whmcs-proxy: Vercel has no static egress IP, WHM firewalls and
// Dynadot's API whitelist by IP, so FivoCRM sends the fully-built request here and
// this VPS performs it. Allow-list: https only, and either api.dynadot.com or a
// WHM port (2087/2083) — so it cannot be turned into an open relay. The VPS stores
// no provider credential; they travel inside the forwarded request and are never
// logged.
app.post('/provider-proxy', requireApiKey, async (req, res) => {
  const { url, method, headers, body } = (req.body as any) || {};
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) { res.status(400).json({ error: 'URL e pavlefshme (duhet https)' }); return; }
  let target: URL;
  try { target = new URL(url); } catch { res.status(400).json({ error: 'URL e pavlefshme' }); return; }
  if (target.username || target.password) { res.status(400).json({ error: 'URL me kredenciale e refuzuar' }); return; }
  // Dynadot: exactly api.dynadot.com on 443 (an explicit ":443" is fine, anything else is not).
  const isDynadot = target.hostname === 'api.dynadot.com' && (target.port === '' || target.port === '443');
  const isWhm = target.hostname !== 'api.dynadot.com' && (target.port === '2087' || target.port === '2083');
  if (!isDynadot && !isWhm) { res.status(400).json({ error: 'Host/port i palejuar për relay' }); return; }
  // A WHM target must be a server some tenant REGISTERED (hostingServers.hostname) —
  // otherwise the relay is an SSRF primitive towards anything listening on :2087.
  // And never a private / loopback address, whatever the hostname resolves to
  // (ANY private address among the results refuses the whole call).
  if (isWhm) {
    if (!(await isRegisteredWhmHost(target.hostname))) { res.status(403).json({ error: 'Serveri WHM nuk është i regjistruar në FivoCRM' }); return; }
    if (await resolvesToPrivate(target.hostname)) { res.status(403).json({ error: 'Adresë private/loopback e refuzuar' }); return; }
  }
  const fwdHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries((headers as Record<string, unknown>) || {})) {
    if (/^(authorization|content-type|accept)$/i.test(k) && typeof v === 'string') fwdHeaders[k] = v;
  }
  try {
    // redirect: 'manual' — a 3xx from the provider is an error here, never followed:
    // following it would let the target host bounce the relay (and the Authorization
    // header) to any other address, past every check above.
    const r = await fetch(target.toString(), {
      method: method === 'GET' ? 'GET' : 'POST',
      headers: fwdHeaders,
      body: method === 'GET' ? undefined : (typeof body === 'string' ? body : undefined),
      redirect: 'manual',
      signal: AbortSignal.timeout(40_000),
    });
    if (r.status >= 300 && r.status < 400) {
      res.status(502).json({ error: `Ofruesi ktheu ridrejtim (${r.status}) — nuk ndiqet` });
      return;
    }
    const text = await r.text();
    res.status(200).json({ status: r.status, body: text });
  } catch (err: unknown) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Provider relay dështoi' });
  }
});

app.post('/whmcs-proxy', requireApiKey, async (req, res) => {
  const { form } = (req.body as any) || {};
  if (typeof form !== 'string' || !form) { res.status(400).json({ error: 'Mungon fusha "form"' }); return; }
  // Target: ALWAYS the VPS's own WHMCS_API_URL. The body's `url` used to win, which
  // made this an authenticated open relay (any https host, from our static IP,
  // with the WHMCS identifier+secret inside `form`). It is now ignored.
  const target = WHMCS_API_URL
    ? (/\/includes\/api\.php$/i.test(WHMCS_API_URL) ? WHMCS_API_URL : `${WHMCS_API_URL.replace(/\/$/, '')}/includes/api.php`)
    : '';
  if (!target) { res.status(503).json({ error: 'WHMCS_API_URL nuk është vendosur në VPS' }); return; }
  if (!/^https:\/\//i.test(target)) { res.status(500).json({ error: 'WHMCS_API_URL duhet të jetë https' }); return; }
  try {
    const r = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    if (r.status >= 300 && r.status < 400) { res.status(502).json({ error: `WHMCS ktheu ridrejtim (${r.status}) — nuk ndiqet` }); return; }
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
// CRON_SECRET travels as a Bearer header to this URL on every tick, and every
// inbound WhatsApp event is POSTed there — plain http would put both on the wire.
// Boot-time check, same stance as the missing-API_SECRET exit.
if (CRM_BASE_URL) {
  const httpsOk = /^https:\/\/[^/]+/i.test(CRM_BASE_URL);
  const devOk = !IS_PRODUCTION && /^http:\/\/localhost(:\d+)?$/i.test(CRM_BASE_URL);
  if (!httpsOk && !devOk) {
    console.error(`[VPS] ERROR: CRM_BASE_URL duhet të fillojë me https:// (http://localhost lejohet vetëm kur NODE_ENV != production). Vlera: ${CRM_BASE_URL}`);
    process.exit(1);
  }
}
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

// ── Inbound WhatsApp → CRM handler (POST /api/wa-inbound) ──────────────────────
// Same authorised channel as triggerCronJob (CRM_BASE_URL + Bearer CRON_SECRET).
// The whatsappMessages row is already written before this is called, so the
// event is fire-and-forget: 3 attempts with 1s/3s/9s back-off, 20s timeout each,
// and a loud log on the final failure. A retried POST re-runs idempotent upserts
// on the CRM side, so a duplicate delivery is harmless.
interface WaEventPayload {
  channel: 'baileys' | 'meta';
  direction: 'inbound' | 'outbound';
  teamId: string;
  agentId: string | null;
  metaPhoneNumberId: string | null;
  channelPhone: string;
  waMessageId: string;
  phone: string;
  jid: string;
  isLid: boolean;
  text: string;
  kind: 'text' | 'media' | 'reaction' | 'system';
  pushName: string | null;
  isAutoReply: boolean;
  timestamp: string;
}
const WA_EVENT_RETRY_DELAYS_MS = [1_000, 3_000, 9_000];

/** Person-to-person jids only: `@s.whatsapp.net` (phone) or `@lid` (privacy id). */
function isPersonJid(jid: string): boolean {
  return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid');
}

/** E.164 is 8–15 digits; WhatsApp channel/group ids are longer (1203…, 18 digits). */
function isPlausiblePhone(digits: string): boolean {
  const d = String(digits || '').replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15;
}

async function postWaEvent(event: WaEventPayload): Promise<void> {
  if (!CRM_BASE_URL || !CRON_SECRET) return;
  const label = `${event.direction} ${maskPhone(event.phone)} ${event.waMessageId}`;
  let lastErr = '';
  for (let attempt = 0; attempt < WA_EVENT_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 20_000);
      const res = await fetch(`${CRM_BASE_URL}/api/wa-inbound`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        signal: ctrl.signal,
      });
      clearTimeout(to);
      if (res.ok) return;
      // 4xx = the payload is wrong, retrying cannot fix it; 5xx/timeouts are retried.
      const text = await res.text().catch(() => '');
      lastErr = `HTTP ${res.status} ${text.slice(0, 200)}`;
      if (res.status >= 400 && res.status < 500) break;
    } catch (err) {
      lastErr = (err as Error)?.message || String(err);
    }
    await new Promise(r => setTimeout(r, WA_EVENT_RETRY_DELAYS_MS[attempt]));
  }
  console.error(`[WA→CRM] wa-inbound "${label}" dështoi pas ${WA_EVENT_RETRY_DELAYS_MS.length} provave: ${lastErr}`);
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
/** 0 = Sunday … 6 = Saturday, in the given zone. */
function weekdayInZone(d: Date, timeZone: string): number {
  const w = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(w);
}
function dayOfMonthInZone(d: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone, day: 'numeric' }).format(d));
}
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
  // Scheduled chat messages ("Programo"): until Sep 2026 they were sent only by a
  // poll inside an OPEN chat tab, so closing the app delayed them to the next
  // visit. One single-field range read of a tiny collection; rows are claimed in
  // a transaction, so a restart can never double-send.
  setInterval(() => { void triggerCronJob('chat-scheduled'); }, 5 * MIN);
  // Unanswered WhatsApp threads past the tenant's response SLA (default 120 min).
  // The job reads ONLY conversations that are due (awaitingReply + slaBreachNotified
  // + slaFirstResponseDueAt, one composite index) and marks each breach once, so a
  // 15-minute cadence costs a handful of reads and a restart cannot double-notify.
  setInterval(() => { void triggerCronJob('conversation-sla'); }, 15 * MIN);
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
  // Hosting & domains: renewal invoices / suspend / terminate / registrar renewals
  // hourly; server + registrar facts every 6h. Neither is in run-all — they touch
  // live cPanel servers and Dynadot, so they run on their own cadence.
  setInterval(() => { void triggerCronJob('hosting-lifecycle'); }, 60 * MIN);
  setInterval(() => { void triggerCronJob('hosting-sync'); }, 360 * MIN);
  // Scheduled cPanel backups: a couple of the most overdue accounts every 30 min.
  setInterval(() => { void triggerCronJob('hosting-backups'); }, 30 * MIN);
  // Weekly expiry digest to managers — Mondays 08:00 local (wall-clock promise).
  scheduleDailyInZone(CRON_LOCAL_TZ, 8, 0, () => {
    if (weekdayInZone(new Date(), CRON_LOCAL_TZ) === 1) void triggerCronJob('hosting-expiry-report');
  });
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
  // The money jobs get a tick of their OWN, before run-all. run-all is 27 jobs
  // inside ONE 60s Vercel invocation: when it is killed, nothing is recorded and
  // the retainers due that day (billingDayOfMonth) simply do not bill — that is
  // how the 25 September 2026 invoices went missing. A dedicated call has the
  // whole 60s to itself. Re-running inside run-all is free: the period key + the
  // deterministic occurrence id (`create()`) make a second pass a no-op, never a
  // second invoice or email. 07:00 local: after midnight's day change in Tirane,
  // before the office opens.
  scheduleDailyInZone(CRON_LOCAL_TZ, 7, 0, () => { void triggerCronJob('recurring-invoices'); });
  scheduleDailyInZone(CRON_LOCAL_TZ, 7, 10, () => { void triggerCronJob('recurring-expenses'); });
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
  // ── Client profitability: "last month's table is ready — review and close" ──
  // Day 2 of every month, 08:05 local, to the tenant's managers. A wall-clock
  // promise to a person, so scheduleDailyInZone; NOT in run-all (it notifies).
  // Idempotent per tenant/period (financeReportRuns), so a restart-day double fire is silent.
  scheduleDailyInZone(CRON_LOCAL_TZ, 8, 5, () => {
    if (dayOfMonthInZone(new Date(), CRON_LOCAL_TZ) === 2) void triggerCronJob('client-profitability-report');
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
  // Follow-up reminders ("Ndjekja": leads + customers due today/overdue → the
  // owner's bell/push/email) — 08:30 local, before the working day starts. A
  // wall-clock promise to a person, so scheduleDailyInZone (never UTC) and NOT in
  // run-all. The job debounces per contact (23h), so a restart-day double fire is silent.
  scheduleDailyInZone(CRON_LOCAL_TZ, 8, 30, () => {
    void triggerCronJob('lead-follow-up-reminders');
  });
  // ── Nazmije, the virtual secretary (api/_nazmije.ts) ──
  // Three wall-clock promises into each tenant's group channel: the day's plan,
  // "ku jemi" before the daily report, and the week in numbers on Friday. The job
  // itself applies the tenant's off days / quiet hours / per-digest switches and is
  // idempotent per tenant/day/kind, so a restart-day double fire is silent. NOT in
  // run-all: she speaks to real people unprompted, on an hour someone chose.
  scheduleDailyInZone(CRON_LOCAL_TZ, 8, 45, () => { void triggerCronJob('nazmije-morning'); });
  scheduleDailyInZone(CRON_LOCAL_TZ, 16, 0, () => { void triggerCronJob('nazmije-afternoon'); });
  scheduleDailyInZone(CRON_LOCAL_TZ, 16, 30, () => { void triggerCronJob('nazmije-weekly'); }); // the job answers not-friday on other days

  // Kick the frequent set shortly after boot so a restart doesn't stall a broadcast.
  setTimeout(() => { void triggerCronJob('whatsapp-broadcasts'); }, MIN);
  console.log(`[CRON] ✅ Schedulerët aktiv → ${CRM_BASE_URL} (daily run-all @ ${CRON_DAILY_HOUR}:00 UTC, raporti ditor 17:35/18:35 ${CRON_LOCAL_TZ}, automatizimet WhatsApp 10:00 ${CRON_LOCAL_TZ}, kujtesat e ndjekjes 08:30 ${CRON_LOCAL_TZ})`);
}

// ── Final error handler ───────────────────────────────────────────────────────
// Express's default handler answers with an HTML page that includes the stack in
// non-production. Every error (multer limits, bad JSON, thrown route code) now
// answers `{ error }` JSON with no stack; the stack goes to the log only.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = Number(err?.status || err?.statusCode) || (err?.code === 'LIMIT_FILE_SIZE' ? 413 : err?.type === 'entity.parse.failed' ? 400 : 500);
  const known = status < 500 && typeof err?.message === 'string';
  if (status >= 500) console.error('[VPS] Unhandled route error:', err);
  if (res.headersSent) { try { res.end(); } catch {} return; }
  res.status(status).json({ error: known ? err.message : 'Gabim i brendshëm' });
});

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

  // From here on Firestore drives the agent set: a deleted or disabled account
  // is unloaded within seconds instead of living on until the next restart.
  watchAccounts();
});
