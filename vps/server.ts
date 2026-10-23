import express from 'express';
import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
} from 'baileys';
import { Boom } from '@hapi/boom';
import admin from 'firebase-admin';
import QRCode from 'qrcode';
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname, basename, resolve as resolvePath } from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import multer from 'multer';
import pino from 'pino';
import { randomUUID, timingSafeEqual } from 'crypto';
import { lookup as dnsLookup } from 'dns/promises';

/**
 * Crash policy. A rejected promise is logged and survived (Baileys rejects plenty
 * of fire-and-forget promises on a flapping socket). An uncaught EXCEPTION means
 * the process may be in an undefined state — log the stack and exit(1) so pm2
 * restarts a clean one — unless it is known, benign Baileys/socket noise, which
 * used to be the only kind we ever saw and is why exceptions were swallowed.
 */
const BENIGN_EXCEPTION_PATTERNS: RegExp[] = [
  /Connection Closed/i, /Connection Terminated/i, /Connection Failure/i, /Timed Out/i,
  /Stream Errored/i, /WebSocket was closed before the connection was established/i,
  /Bad MAC/i, /No session(s)? (record|found)?/i, /No SenderKeyRecord/i, /Invalid PreKey ID/i,
  /MessageCounterError/i, /Key used already or never filled/i,
  /\bECONNRESET\b/, /\bEPIPE\b/, /\bETIMEDOUT\b/, /\bECONNREFUSED\b/,
];
process.on('unhandledRejection', (err) => { console.error('[WA] Unhandled rejection:', (err as Error)?.stack || err); });
process.on('uncaughtException', (err) => {
  const text = `${err?.name || ''}: ${err?.message || ''}`;
  console.error('[WA] Uncaught exception:', err?.stack || err);
  if (BENIGN_EXCEPTION_PATTERNS.some((re) => re.test(text))) return;
  console.error('[WA] Gabim fatal — dal me kod 1 që pm2 të rinisë procesin');
  setTimeout(() => process.exit(1), 250).unref?.();
});

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
/**
 * In-memory connection state. The first four are live states; the rest are
 * TERMINAL: the agent stopped on purpose and waits for an EXPLICIT request
 * (GET /qr-data/:agentId, /qr/:agentId, POST /sync/:agentId) instead of looping.
 * A logged-out / replaced / banned number used to reconnect every 5 s forever —
 * a QR loop at best, a ping-pong with the other WhatsApp Web session at worst.
 */
type ConnectionStatus =
  | 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
  | 'logged_out' | 'replaced' | 'banned' | 'bad_session' | 'qr_timeout';
const TERMINAL_STATUSES = new Set<ConnectionStatus>(['logged_out', 'replaced', 'banned', 'bad_session', 'qr_timeout']);

interface AgentConfig {
  id: string;
  teamId: string;
  businessId: string | null;
  label: string;
  assignedToUserId?: string;
  enabled: boolean;
  /**
   * The env-based TEAM_ID agent (no Firestore document). It is never logged out
   * and its session is never wiped by the reconciler: the first real account
   * appearing in Firestore used to `logout()` + `rmSync` the legacy ./auth_info.
   */
  fromEnv: boolean;
}

interface DisconnectInfo { code: number | null; name: string; at: string }

/** Minimal CacheStore (get/set/del/flushAll) with a TTL — Baileys' msgRetryCounterCache. */
class TtlCache {
  private m = new Map<string, { v: unknown; exp: number }>();
  constructor(private ttlMs: number, private max = 5000) {}
  get<T>(key: string): T | undefined {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (e.exp < Date.now()) { this.m.delete(key); return undefined; }
    return e.v as T;
  }
  set<T>(key: string, value: T): void {
    if (this.m.size >= this.max && !this.m.has(key)) {
      const first = this.m.keys().next().value;
      if (first !== undefined) this.m.delete(first);
    }
    this.m.set(key, { v: value, exp: Date.now() + this.ttlMs });
  }
  del(key: string): void { this.m.delete(key); }
  flushAll(): void { this.m.clear(); }
}

interface AgentState {
  config: AgentConfig;
  sock: ReturnType<typeof makeWASocket> | null;
  /** `state.creds` of the current session — `registered` tells a pairing attempt from a paired device. */
  authCreds: any | null;
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
  /** /send waits here for the server ack (CB:ack or messages.update status ≥ 2) of a message id. */
  ackWaiters: Map<string, (status: number) => void>;
  /** In-flight connectAgent(): a second caller joins it instead of opening a second socket. */
  connecting: Promise<void> | null;
  reconnectAttempts: number;
  /** A QR was shown on the current socket (an unscanned QR that times out stops, it does not loop). */
  sawQr: boolean;
  lastDisconnect: DisconnectInfo | null;
  lastConnectedAt: Date | null;
  lastExplicitStartAt: number;
  /** ms epoch of the last USync reverse lookup (persisted on the account doc). */
  lastReverseLookupAt: number;
  lookupRunning: boolean;
  /** Phones already looked up by USync (phone → ms), so the daily run rotates instead of repeating. */
  lookedUpPhones: Map<string, number>;
  /** Per-agent outbound queue: one message at a time, ≥ SEND_GAP_MS apart. */
  sendChain: Promise<unknown>;
  nextSendAt: number;
  lastSentAt: number;
  /** whatsappMessages doc ids waiting in the queue (the stale-pending sweeper skips them). */
  queuedDocIds: Set<string>;
  /** WhatsApp ids we sent and have not seen the server ack for yet (id → sent at). */
  outstanding: Map<string, number>;
  msgRetryCache: TtlCache;
}

function createAgentState(config: AgentConfig): AgentState {
  return {
    config, sock: null, authCreds: null,
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
    connecting: null,
    reconnectAttempts: 0,
    sawQr: false,
    lastDisconnect: null,
    lastConnectedAt: null,
    lastExplicitStartAt: 0,
    lastReverseLookupAt: 0,
    lookupRunning: false,
    lookedUpPhones: new Map(),
    sendChain: Promise.resolve(),
    nextSendAt: 0,
    lastSentAt: 0,
    queuedDocIds: new Set(),
    outstanding: new Map(),
    msgRetryCache: new TtlCache(60 * 60 * 1000),
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
 * relay (api/whatsapp.ts) aborts at 10s, so the WHOLE request is held to
 * REQUEST_BUDGET_MS and the ack wait is whatever is left of it (never more than
 * this). A message that is not acked in time is returned as `status: 'pending'`
 * (still a 200 — it may well be acked a second later) and the ack handlers
 * upgrade the row when the receipt arrives.
 */
const SEND_ACK_TIMEOUT_MS = 6_000;
const REQUEST_BUDGET_MS = 8_500;
/** A queue wait longer than this is not waited for inline: the row stays `pending`, the answer is `queued`. */
const QUEUE_INLINE_MAX_MS = 3_000;
/**
 * Minimum spacing between two outbound messages of ONE number (+ jitter). A
 * parallel blast — a campaign tick plus three staff replies in the same second —
 * is exactly the pattern WhatsApp bans companion devices for.
 */
const SEND_GAP_MS = 1_200;
const SEND_GAP_JITTER_MS = 800;
/** A queued (background) send waits this long for its ack before letting the receipt handlers finish the job. */
const BACKGROUND_ACK_WAIT_MS = 30_000;
const ON_WA_TIMEOUT_MS = 3_000;
const ON_WA_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** A row still `pending` this long after creation never got an ack → `failed` / `no-ack`. */
const PENDING_STALE_MS = 10 * 60 * 1000;
/** Process start: a message older than this may have a legacy (bare-id) row. */
const BOOT_AT_MS = Date.now();

/** Baileys WAMessageStatus → the `whatsappMessages.status` we store. 1 (PENDING) is not a receipt. */
const RECEIPT_STATUS: Record<number, 'failed' | 'sent' | 'delivered' | 'read'> = {
  0: 'failed', 2: 'sent', 3: 'delivered', 4: 'read', 5: 'read',
};
/** Receipts can arrive out of order; never downgrade read → delivered → sent. */
const STATUS_RANK: Record<string, number> = { pending: 0, queued: 0, sent: 1, delivered: 2, read: 3 };

/** DisconnectReason (same codes in Baileys 6.7 and 7) → a readable name for logs and the account doc. 408 is both lost/timedOut. */
const DISCONNECT_NAMES: Record<number, string> = {
  [DisconnectReason.connectionClosed]: 'connectionClosed',
  [DisconnectReason.connectionLost]: 'connectionLost',
  [DisconnectReason.connectionReplaced]: 'connectionReplaced',
  [DisconnectReason.loggedOut]: 'loggedOut',
  [DisconnectReason.badSession]: 'badSession',
  [DisconnectReason.restartRequired]: 'restartRequired',
  [DisconnectReason.multideviceMismatch]: 'multideviceMismatch',
  [DisconnectReason.forbidden]: 'forbidden',
  [DisconnectReason.unavailableService]: 'unavailableService',
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
const nowTs = () => admin.firestore.Timestamp.fromDate(new Date());
/** Firestore Timestamp | Date | ISO | ms → ms epoch (0 when unknown). */
function tsMs(v: any): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Best-effort write of connection facts to the account doc (the cron alerts staff from these). */
function writeAccountStatus(agent: AgentState, patch: Record<string, unknown>): void {
  if (agent.config.fromEnv) return;
  db.collection('whatsappAccounts').doc(agent.config.id).update(patch)
    .catch((e) => console.warn(`[${agent.config.id}] whatsappAccounts update dështoi:`, (e as Error)?.message || e));
}

// ── Socket lifecycle ──────────────────────────────────────────────────────────

/** Every ev channel we subscribe to — removed on teardown so a dead socket can never write again. */
const SOCKET_EVENTS = ['creds.update', 'connection.update', 'contacts.upsert', 'contacts.update', 'messaging-history.set', 'messages.upsert', 'messages.update', 'lid-mapping.update'] as const;
const SERVER_ACK_FRAME = 'CB:ack,class:message';

function detachSocket(sock: ReturnType<typeof makeWASocket>): void {
  for (const ev of SOCKET_EVENTS) { try { (sock.ev as any).removeAllListeners(ev); } catch {} }
  try { (sock.ws as any).removeAllListeners(SERVER_ACK_FRAME); } catch {}
}
/** Detach + end + close the raw websocket. Each step on its own: one throwing must not keep the others from running. */
function closeSocket(sock: ReturnType<typeof makeWASocket>): void {
  detachSocket(sock);
  try { sock.end(undefined); } catch {}
  try { (sock.ws as any).close(); } catch {}
}
/** Drop the agent's current socket (the close it causes is ignored: agent.sock no longer points at it). */
function teardownSocket(agent: AgentState): void {
  const sock = agent.sock;
  agent.sock = null;
  if (sock) closeSocket(sock);
}

function rejectAckWaiters(agent: AgentState, code: number): void {
  for (const resolve of agent.ackWaiters.values()) resolve(code);
  agent.ackWaiters.clear();
}

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
 * Whatever logout() does (times out, throws), the socket is ended, the raw ws
 * closed and every listener removed — a half-dead socket used to keep sending.
 */
async function unloadAgent(agent: AgentState, reason: 'deleted' | 'disabled'): Promise<void> {
  const id = agent.config.id;
  agent.unloading = true;
  if (agents.get(id) === agent) agents.delete(id);
  if (agent.reconnectTimer) { clearTimeout(agent.reconnectTimer); agent.reconnectTimer = null; }
  if (agent.lidResyncTimer) { clearInterval(agent.lidResyncTimer); agent.lidResyncTimer = null; }
  if (agent.cacheEvictTimer) { clearInterval(agent.cacheEvictTimer); agent.cacheEvictTimer = null; }
  rejectAckWaiters(agent, 0);
  const sock = agent.sock;
  agent.sock = null;
  agent.connectionStatus = 'disconnected';
  agent.qrDataUrl = null;
  const wipe = reason === 'deleted' && !agent.config.fromEnv;
  if (sock) {
    if (wipe) {
      // logout() needs an open socket; whatever happens, fall through to the hard close.
      try { await Promise.race([sock.logout(), sleep(5000)]); } catch {}
    }
    closeSocket(sock);
  }
  if (wipe) {
    try { rmSync(authDir(id), { recursive: true, force: true }); } catch {}
  }
  console.log(`[${id}] Agent u shkarkua (${reason === 'deleted' ? 'llogaria u fshi' : 'llogaria u çaktivizua'})`);
}

/** Account doc → config. No `teamId` → null: an account is NEVER filed under the env default team. */
function accountConfig(doc: admin.firestore.QueryDocumentSnapshot): AgentConfig | null {
  const data = doc.data() || {};
  const teamId = typeof data.teamId === 'string' ? data.teamId.trim() : '';
  if (!teamId) return null;
  return {
    id: doc.id, teamId,
    businessId: typeof data.businessId === 'string' && data.businessId ? data.businessId : null,
    label: data.label || doc.id,
    assignedToUserId: typeof data.assignedToUserId === 'string' && data.assignedToUserId ? data.assignedToUserId : undefined,
    enabled: true, fromEnv: false,
  };
}

async function startAgent(config: AgentConfig, data?: Record<string, any>): Promise<AgentState> {
  const agent = createAgentState(config);
  agent.lastReverseLookupAt = tsMs(data?.lastReverseLookupAt);
  agent.cacheEvictTimer = setInterval(() => agent.leadPhoneCache.clear(), 6 * 60 * 60 * 1000);
  // Hourly CHECK; maybeRunDailyLookups itself enforces the 24h gate.
  agent.lidResyncTimer = setInterval(() => { void maybeRunDailyLookups(agent); }, 60 * 60 * 1000);
  agents.set(config.id, agent);
  await loadLidMappings(agent);
  await loadPendingLidMessages(agent);
  if (!agent.unloading) connectAgent(agent).catch(e => console.error(`[${config.id}] connectAgent error:`, e));
  return agent;
}

/**
 * Bring the in-memory agents in line with `whatsappAccounts`: start every
 * enabled account that is not running, stop every running agent whose account
 * is gone or disabled, and apply edited fields to the running ones. Used by the
 * live listener, by POST /reload and at boot. Serialised — two snapshots in a
 * row must not race each other.
 */
let reconcileChain: Promise<void> = Promise.resolve();
const warnedNoTeam = new Set<string>();
function reconcileAgents(docs: admin.firestore.QueryDocumentSnapshot[]): Promise<{ added: string[]; removed: string[] }> {
  const run = async () => {
    const added: string[] = []; const removed: string[] = [];
    const enabledIds = new Set<string>();
    const knownIds = new Set(docs.map(d => d.id));

    for (const doc of docs) {
      const data = doc.data();
      if (data.enabled !== true) continue;
      const config = accountConfig(doc);
      if (!config) {
        if (!warnedNoTeam.has(doc.id)) { warnedNoTeam.add(doc.id); console.warn(`[VPS] whatsappAccounts/${doc.id} pa teamId — nuk ngarkohet`); }
        continue;
      }
      warnedNoTeam.delete(doc.id);
      enabledIds.add(doc.id);
      const existing = agents.get(doc.id);
      if (existing) {
        if (existing.config.teamId === config.teamId && !existing.config.fromEnv) {
          // Hot fields: applied to the running agent, no reconnect needed.
          existing.config.label = config.label;
          existing.config.assignedToUserId = config.assignedToUserId;
          existing.config.businessId = config.businessId;
          continue;
        }
        // The team moved: every cache (leads, LID queue, conversation keys) is keyed
        // on it, so restart cleanly. The session is kept — no new QR.
        await unloadAgent(existing, 'disabled');
        removed.push(doc.id);
      }
      await startAgent(config, data);
      added.push(doc.id);
      console.log(`[VPS] Agent i ri ngarkuar: ${config.id} (${config.label})`);
    }

    // The env-based 'default' agent only exists while the collection is empty.
    const keepEnvDefault = docs.length === 0 && !!DEFAULT_TEAM_ID;
    for (const agent of Array.from(agents.values())) {
      const id = agent.config.id;
      if (enabledIds.has(id)) continue;
      if (agent.config.fromEnv && keepEnvDefault) continue;
      // The env agent is only ever CLOSED, never logged out / wiped (see AgentConfig.fromEnv).
      await unloadAgent(agent, agent.config.fromEnv || knownIds.has(id) ? 'disabled' : 'deleted');
      removed.push(id);
    }
    if (keepEnvDefault && !agents.has('default')) {
      console.log('[VPS] Asnjë agent në Firestore — duke përdorur default nga env');
      await startAgent({ id: 'default', teamId: DEFAULT_TEAM_ID, businessId: null, label: 'Default', enabled: true, fromEnv: true });
      added.push('default');
    }
    return { added, removed };
  };
  const result = reconcileChain.then(run, run);
  reconcileChain = result.then(() => undefined, () => undefined);
  return result;
}

/**
 * Live mirror of `whatsappAccounts`: a delete / disable / add / edit in
 * Cilësimet takes effect within seconds, without a restart. One listener, reads
 * only on change.
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
/**
 * The same rules as src/lib/messaging/waPhone.ts `toWaPhone` (copied, not
 * imported — the VPS builds alone): digits only, `00` stripped, Albanian local
 * forms → 355, and only 8–15 digits survive (else ''). Never feed it a jid from
 * @lid / @newsletter / @g.us / status — isPersonJid() + the LID branch keep
 * those out, a privacy id is not a phone.
 */
const normalizePhone = (phone: string): string => {
  let digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^3550[6-9]/.test(digits)) digits = '355' + digits.slice(4);
  else if (/^0[6-9]\d{7,8}$/.test(digits)) digits = '355' + digits.slice(1);
  else if (/^[6-9]\d{8}$/.test(digits)) digits = '355' + digits;
  return digits.length >= 8 && digits.length <= 15 ? digits : '';
};

/** `355…:12@s.whatsapp.net` → `355…` (device suffix and server dropped). */
function jidUser(jid: string): string {
  return String(jid || '').split('@')[0].split(':')[0];
}
/** A privacy id → `<digits>@lid`, or null. Requires the @lid server: bare digits are ambiguous. */
function canonicalLidJid(v: unknown): string | null {
  const s = String(v || '');
  if (!s.endsWith('@lid')) return null;
  const user = jidUser(s);
  return /^\d{6,20}$/.test(user) ? `${user}@lid` : null;
}
/**
 * A phone jid → `<8–15 digits>@s.whatsapp.net`, or null. Refuses @lid, groups,
 * channels, broadcasts and 16+ digit ids — exactly the values that must never
 * be stored as a LID → phone mapping.
 */
function canonicalPhoneJid(v: unknown): string | null {
  const s = String(v || '').trim();
  if (!s) return null;
  const at = s.indexOf('@');
  const server = at === -1 ? 's.whatsapp.net' : s.slice(at + 1);
  if (server !== 's.whatsapp.net' && server !== 'c.us') return null;
  const user = jidUser(s);
  if (!/^\d{8,15}$/.test(user)) return null;
  return `${user}@s.whatsapp.net`;
}

/**
 * `whatsappMessages` doc id for a WhatsApp message seen by ONE agent. It used to
 * be the bare WhatsApp id, so when two of our numbers talked to each other (or
 * two tenants' numbers did) the receiver's inbound row overwrote the sender's
 * outbound row. `waMessageId` stays a field.
 */
function rowId(agentId: string, waId: string): string {
  return `${agentId}_${waId}`;
}
/** The row for (agent, WhatsApp id): the new id first, the legacy bare id only when it is THIS agent's. */
async function findRowRef(agent: AgentState, waId: string): Promise<{ ref: admin.firestore.DocumentReference; data: Record<string, any> } | null> {
  const ref = db.collection('whatsappMessages').doc(rowId(agent.config.id, waId));
  const snap = await ref.get();
  if (snap.exists) return { ref, data: snap.data() || {} };
  const legacyRef = db.collection('whatsappMessages').doc(waId);
  const legacy = await legacyRef.get();
  if (legacy.exists && legacy.data()?.agentId === agent.config.id) return { ref: legacyRef, data: legacy.data() || {} };
  return null;
}

/** Firestore batches cap at 500 ops; chunk at 450 so a big backfill never fails as a whole. */
async function commitUpdatesInChunks(updates: Array<{ ref: admin.firestore.DocumentReference; data: Record<string, unknown> }>): Promise<void> {
  for (let i = 0; i < updates.length; i += 450) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + 450)) batch.update(u.ref, u.data);
    await batch.commit();
  }
}

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

/**
 * Session folders live next to this server (vps/), resolved ABSOLUTELY: a
 * relative './auth_info_x' followed pm2's cwd, so starting from another
 * directory (or running dist/server.js) silently opened an empty session and
 * asked for a new QR. Folder names are unchanged so existing sessions survive;
 * a session that only exists under the old cwd-relative path is still used.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const VPS_ROOT = process.env.WA_AUTH_BASE_DIR
  ? resolvePath(process.env.WA_AUTH_BASE_DIR)
  : (basename(HERE) === 'dist' ? resolvePath(HERE, '..') : HERE);
const authDir = (agentId: string) => {
  const safeId = /[\\/]|\.\./.test(agentId) ? agentId.replace(/[^a-zA-Z0-9_-]/g, '_') : agentId;
  const candidates = agentId === 'default'
    ? [resolvePath(VPS_ROOT, 'auth_info'), resolvePath(process.cwd(), 'auth_info')] // backward compat: the legacy single-agent folder
    : [];
  candidates.push(resolvePath(VPS_ROOT, `auth_info_${safeId}`), resolvePath(process.cwd(), `auth_info_${safeId}`));
  for (const c of candidates) if (existsSync(c)) return c;
  return resolvePath(VPS_ROOT, `auth_info_${safeId}`);
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
      updatedAt: nowTs(),
    }, { merge: true });
  } catch (e) { console.error(`[${agent.config.id}] Error persisting LID:`, e); }
}

/** Rows stored while only the LID was known carry the LID digits in `phone` — move them to the real number. */
async function backfillLidMessages(agent: AgentState, lidJid: string, phoneJid: string): Promise<void> {
  const lidDigits = jidUser(lidJid);
  const realPhone = normalizePhone(jidUser(phoneJid));
  if (!lidDigits || !realPhone || lidDigits === realPhone) return;
  try {
    const snap = await db.collection('whatsappMessages').where('teamId', '==', agent.config.teamId).where('phone', '==', lidDigits).limit(2000).get();
    if (snap.empty) return;
    const updates = snap.docs
      .filter(d => !d.data().agentId || d.data().agentId === agent.config.id)
      .map(d => ({ ref: d.ref, data: { phone: realPhone, jid: phoneJid, isLid: false, updatedAt: nowTs() } as Record<string, unknown> }));
    await commitUpdatesInChunks(updates);
    console.log(`[${agent.config.id}] Backfill: ${maskPhone(lidDigits)} → ${maskPhone(realPhone)} (${updates.length} msgs)`);
  } catch (e) { console.error(`[${agent.config.id}] Backfill error:`, e); }
}

/** Is this jid (any device / domain) our own account - its phone number or its LID? */
function isOwnDeviceJid(agent: AgentState, jid: unknown): boolean {
  const user = String(jid || '').split('@')[0].split(':')[0];
  if (!user) return false;
  const me: any = (agent.sock as any)?.user || agent.authCreds?.me || {};
  const ownPn = String(me.id || '').split('@')[0].split(':')[0];
  const ownLid = String(me.lid || '').split('@')[0].split(':')[0];
  return user === ownPn || user === ownLid || (!!agent.connectedPhone && user === agent.connectedPhone);
}

/**
 * 479 (smax-invalid) = the server rejected our stanza for that device: a stale
 * Signal session. Force a fresh prekey fetch + session for it - at most once an
 * hour per device, so a device that keeps refusing cannot turn into a loop.
 */
const healedSessions = new Map<string, number>();
async function healDeviceSession(agent: AgentState, jid: unknown, code: string): Promise<void> {
  const target = String(jid || '');
  if (!target || !agent.sock) return;
  const k = `${agent.config.id}|${target}`;
  if (Date.now() - (healedSessions.get(k) || 0) < 60 * 60_000) return;
  healedSessions.set(k, Date.now());
  try {
    await (agent.sock as any).assertSessions([target], true);
    console.warn(`[${agent.config.id}] NACK ${code} nga ${maskJid(target)} - sesioni u rikrijua`);
  } catch (e) {
    console.warn(`[${agent.config.id}] rikrijimi i sesionit ${maskJid(target)} dështoi:`, (e as Error)?.message || e);
  }
}

/** A Baileys 7 contact: `id` is the LID OR the phone jid, with `lid` / `phoneNumber` for the other half. */
function contactLidPn(c: any): { lid: string | null; pn: string | null } {
  const id = typeof c?.id === 'string' ? c.id : '';
  const lid = (typeof c?.lid === 'string' && c.lid) || (id.endsWith('@lid') ? id : null);
  const pn = (typeof c?.phoneNumber === 'string' && c.phoneNumber) || (id.endsWith('@s.whatsapp.net') ? id : null);
  return { lid: lid || null, pn: pn || null };
}

/** Baileys' own LID store (v7). Never throws; null when unknown. */
async function lidStorePnFor(agent: AgentState, lid: string): Promise<string | null> {
  try { return (await (agent.sock as any)?.signalRepository?.lidMapping?.getPNForLID(lid)) || null; } catch { return null; }
}
async function lidStoreLidFor(agent: AgentState, pnJid: string): Promise<string | null> {
  try { return (await (agent.sock as any)?.signalRepository?.lidMapping?.getLIDForPN(pnJid)) || null; } catch { return null; }
}

/**
 * Record LID → phone. Every source (senderPn, contacts, history, USync, groups,
 * Firestore) goes through the same validation: the LID must be a real @lid, the
 * phone a real 8–15 digit @s.whatsapp.net jid that is neither the LID itself nor
 * OUR own number. A bad mapping is worse than none — it files a stranger's
 * messages under someone else's lead.
 */
async function registerLidMapping(agent: AgentState, lidRaw: unknown, phoneRaw: unknown): Promise<void> {
  const lid = canonicalLidJid(lidRaw);
  const phoneJid = canonicalPhoneJid(phoneRaw);
  if (!lid || !phoneJid) return;
  const phoneDigits = jidUser(phoneJid);
  if (phoneDigits === jidUser(lid)) return;
  if (agent.connectedPhone && phoneDigits === agent.connectedPhone) return;
  const previous = agent.lidToPhoneMap.get(lid);
  if (previous === phoneJid) return;
  agent.lidToPhoneMap.set(lid, phoneJid);
  console.log(`[${agent.config.id}] LID: ${maskJid(lid)} → ${maskJid(phoneJid)}${previous ? ` (zëvendëson ${maskJid(previous)})` : ''} (${agent.lidToPhoneMap.size} total)`);
  void persistLidMapping(agent, lid, phoneJid);
  void backfillLidMessages(agent, lid, phoneJid);

  const queuedDocIds = agent.pendingLidMessages.get(lid);
  if (queuedDocIds?.length) {
    const phone = normalizePhone(phoneDigits);
    try {
      await commitUpdatesInChunks(queuedDocIds.map(docId => ({
        ref: db.collection('whatsappMessages').doc(docId),
        data: { phone, jid: phoneJid, isLid: false, updatedAt: nowTs() },
      })));
      agent.pendingLidMessages.delete(lid);
    } catch (e) { console.error(`[${agent.config.id}] Error updating queued LID docs:`, e); }
  }
}

async function syncContactName(agent: AgentState, jid: string, displayName: string): Promise<void> {
  const phone = normalizePhone(jidUser(jid));
  if (!phone || !displayName || agent.syncedContactNames.get(phone) === displayName) return;
  agent.syncedContactNames.set(phone, displayName);
  try {
    const snap = await db.collection('whatsappMessages').where('teamId', '==', agent.config.teamId).where('phone', '==', phone).limit(500).get();
    if (snap.empty) return;
    const updates: Array<{ ref: admin.firestore.DocumentReference; data: Record<string, unknown> }> = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      if (!data.leadId && (!data.pushName || data.pushName !== displayName)) {
        updates.push({ ref: doc.ref, data: { pushName: displayName, leadName: displayName, updatedAt: nowTs() } });
      }
    }
    if (updates.length) await commitUpdatesInChunks(updates);
  } catch (e) { console.error(`[${agent.config.id}] Contact sync error:`, e); }
}

async function loadLidMappings(agent: AgentState): Promise<void> {
  try {
    // Load agent-specific mappings first
    let snap = await db.collection('lidMappings').where('teamId', '==', agent.config.teamId).where('agentId', '==', agent.config.id).get();
    // Fallback to legacy mappings (no agentId) for backward compatibility
    if (snap.empty) snap = await db.collection('lidMappings').where('teamId', '==', agent.config.teamId).get();
    let rejected = 0;
    for (const doc of snap.docs) {
      const lid = canonicalLidJid(doc.data().lid);
      const phoneJid = canonicalPhoneJid(doc.data().phoneJid);
      // Validated on the way IN too: mappings stored before the guard may be lid→lid or 18-digit ids.
      if (lid && phoneJid && jidUser(lid) !== jidUser(phoneJid)) agent.lidToPhoneMap.set(lid, phoneJid);
      else rejected++;
    }
    console.log(`[${agent.config.id}] Loaded ${agent.lidToPhoneMap.size} LID mappings${rejected ? ` (${rejected} të pavlefshme u injoruan)` : ''}`);
  } catch (e) { console.error(`[${agent.config.id}] Error loading LID mappings:`, e); }
}

async function loadPendingLidMessages(agent: AgentState): Promise<void> {
  try {
    const snap = await db.collection('whatsappMessages').where('teamId', '==', agent.config.teamId).where('isLid', '==', true).get();
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.agentId && data.agentId !== agent.config.id) continue;
      const lid = canonicalLidJid(data.lid || data.jid);
      if (!lid) continue;
      const queue = agent.pendingLidMessages.get(lid) || [];
      queue.push(doc.id);
      agent.pendingLidMessages.set(lid, queue);
    }
    // Resolve any known LIDs immediately
    for (const [lid, docIds] of Array.from(agent.pendingLidMessages.entries())) {
      const phoneJid = agent.lidToPhoneMap.get(lid);
      if (!phoneJid) continue;
      const phone = normalizePhone(jidUser(phoneJid));
      await commitUpdatesInChunks(docIds.map(docId => ({
        ref: db.collection('whatsappMessages').doc(docId),
        data: { phone, jid: phoneJid, isLid: false, updatedAt: nowTs() },
      })));
      agent.pendingLidMessages.delete(lid);
      console.log(`[${agent.config.id}] Startup resolved ${docIds.length} LID docs for ${maskJid(lid)}`);
    }
    console.log(`[${agent.config.id}] ${agent.pendingLidMessages.size} pending LID queues remaining`);
  } catch (e) { console.error(`[${agent.config.id}] Error loading pending LID messages:`, e); }
}

// ── LID discovery (USync) — rationed ──────────────────────────────────────────
// A USync query per lead every 30 minutes and on every reconnect is a textbook
// automation fingerprint (ban risk). Now: at most once per 24h per agent, only
// numbers not already resolved and not looked up in the last week, ≤ 50 per run,
// in batches of 10 with a pause between them.
const LOOKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LOOKUP_FORCE_MIN_INTERVAL_MS = 60 * 60 * 1000;
const LOOKUP_MAX_PHONES = 50;
const LOOKUP_BATCH = 10;
const LOOKUP_REPEAT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

async function maybeRunDailyLookups(agent: AgentState, force = false): Promise<{ ran: boolean; reason?: string; resolved?: number }> {
  if (agent.lookupRunning) return { ran: false, reason: 'running' };
  if (agent.connectionStatus !== 'connected' || !agent.sock) return { ran: false, reason: 'not-connected' };
  const since = Date.now() - agent.lastReverseLookupAt;
  if (since < (force ? LOOKUP_FORCE_MIN_INTERVAL_MS : LOOKUP_INTERVAL_MS)) return { ran: false, reason: 'too-soon' };
  agent.lookupRunning = true;
  agent.lastReverseLookupAt = Date.now();
  writeAccountStatus(agent, { lastReverseLookupAt: nowTs() });
  try {
    const resolved = await reverseLookupLeads(agent);
    await resolveFromGroups(agent);
    return { ran: true, resolved };
  } finally { agent.lookupRunning = false; }
}

async function reverseLookupLeads(agent: AgentState): Promise<number> {
  if (!agent.sock) return 0;
  let resolved = 0;
  try {
    const { USyncQuery, USyncUser } = await import('baileys');
    const leadsSnap = await db.collection('leads').where('teamId', '==', agent.config.teamId).select('phoneNumber', 'phone', 'name').get();
    const known = new Set(Array.from(agent.lidToPhoneMap.values()).map(j => jidUser(j)));
    const cutoff = Date.now() - LOOKUP_REPEAT_AFTER_MS;
    const phones: string[] = [];
    agent.leadPhoneCache.clear();
    for (const doc of leadsSnap.docs) {
      const d = doc.data();
      const p = normalizePhone(String(d.phoneNumber || d.phone || ''));
      if (!p) continue;
      agent.leadPhoneCache.set(p, { leadId: doc.id, leadName: d.name || null });
      if (known.has(p) || (agent.lookedUpPhones.get(p) || 0) > cutoff || phones.includes(p)) continue;
      if (phones.length < LOOKUP_MAX_PHONES) phones.push(p);
    }
    for (let i = 0; i < phones.length; i += LOOKUP_BATCH) {
      if (agent.connectionStatus !== 'connected' || !agent.sock) break;
      const batch = phones.slice(i, i + LOOKUP_BATCH);
      try {
        const query = new USyncQuery();
        query.withMode('query').withContext('interactive');
        for (const phone of batch) { const u = new USyncUser(); u.withPhone('+' + phone); query.withUser(u); }
        query.withLIDProtocol().withContactProtocol();
        const result = await agent.sock.executeUSyncQuery(query);
        for (const p of batch) agent.lookedUpPhones.set(p, Date.now());
        for (const item of (result?.list) || []) {
          const lid = (item as any).lid; const id = (item as any).id;
          const phoneJid = canonicalPhoneJid(id);
          if (phoneJid) onWaCache.set(jidUser(phoneJid), { exists: !!(item as any).contact, jid: phoneJid, at: Date.now() });
          if (lid && phoneJid && !agent.lidToPhoneMap.has(String(lid))) { await registerLidMapping(agent, lid, phoneJid); resolved++; }
        }
      } catch (e) { console.error(`[${agent.config.id}] USyncQuery batch error:`, e); }
      if (i + LOOKUP_BATCH < phones.length) await sleep(4_000 + Math.floor(Math.random() * 3_000));
    }
    console.log(`[${agent.config.id}] Reverse lookup: ${resolved} mappings të reja nga ${phones.length} numra (${leadsSnap.size} leads)`);
  } catch (e) { console.error(`[${agent.config.id}] Reverse lookup error:`, e); }
  return resolved;
}

async function resolveFromGroups(agent: AgentState): Promise<void> {
  if (!agent.sock) return;
  try {
    const groups = await agent.sock.groupFetchAllParticipating();
    let newMappings = 0;
    for (const group of Object.values(groups)) {
      for (const p of group.participants) {
        const anyP = p as any;
        if (anyP.lid && p.id && !p.id.endsWith('@lid')) {
          const lid = String(anyP.lid).endsWith('@lid') ? anyP.lid : `${anyP.lid}@lid`;
          if (!agent.lidToPhoneMap.has(lid)) { await registerLidMapping(agent, lid, p.id); newMappings++; }
        }
        if (anyP.phoneNumber && p.id?.endsWith('@lid')) {
          const pn = String(anyP.phoneNumber);
          const pjid = pn.includes('@') ? pn : `${pn}@s.whatsapp.net`;
          if (!agent.lidToPhoneMap.has(p.id)) { await registerLidMapping(agent, p.id, pjid); newMappings++; }
        }
      }
    }
    console.log(`[${agent.config.id}] Groups: ${Object.keys(groups).length} scanned, ${newMappings} new mappings`);
  } catch (e) { console.error(`[${agent.config.id}] Group resolution error:`, e); }
}

// ── Message content ───────────────────────────────────────────────────────────

/** Peel the wrappers WhatsApp puts around real content (disappearing, view-once, captioned documents). */
function unwrapMessage(m: any, depth = 0): any {
  if (!m || typeof m !== 'object' || depth > 8) return m;
  const inner = m.ephemeralMessage?.message
    || m.viewOnceMessage?.message
    || m.viewOnceMessageV2?.message
    || m.viewOnceMessageV2Extension?.message
    || m.documentWithCaptionMessage?.message;
  return inner ? unwrapMessage(inner, depth + 1) : m;
}

/** Keys that carry no user content on their own (key distribution, context metadata). */
const NON_CONTENT_KEYS = new Set(['senderKeyDistributionMessage', 'messageContextInfo']);

/**
 * What a message is, for the inbox. Reactions, protocol messages (revoke,
 * ephemeral settings, history notifications), edits and bare key-distribution
 * stanzas used to become a `[Media]` row each — they are not messages.
 */
function classifyContent(c: any): 'reaction' | 'skip' | 'message' {
  if (!c || typeof c !== 'object') return 'skip';
  if (c.reactionMessage) return 'reaction';
  if (c.protocolMessage || c.editedMessage || c.pollUpdateMessage || c.keepInChatMessage || c.encReactionMessage) return 'skip';
  const keys = Object.keys(c).filter(k => c[k] != null && !NON_CONTENT_KEYS.has(k));
  return keys.length ? 'message' : 'skip';
}

function extractContent(c: any): { text: string; kind: 'text' | 'media' } {
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v : '');
  if (s(c.conversation)) return { text: c.conversation, kind: 'text' };
  if (s(c.extendedTextMessage?.text)) return { text: c.extendedTextMessage.text, kind: 'text' };
  if (c.imageMessage) return { text: s(c.imageMessage.caption) || '[Foto]', kind: 'media' };
  if (c.videoMessage || c.ptvMessage) return { text: s(c.videoMessage?.caption) || '[Video]', kind: 'media' };
  if (c.documentMessage) {
    return { text: s(c.documentMessage.caption) || `[Dokument: ${s(c.documentMessage.fileName) || s(c.documentMessage.title) || 'skedar'}]`, kind: 'media' };
  }
  if (c.audioMessage) return { text: '[Audio]', kind: 'media' };
  if (c.stickerMessage) return { text: '[Stiker]', kind: 'media' };
  const br = c.buttonsResponseMessage;
  if (br) return { text: s(br.selectedDisplayText) || s(br.selectedButtonId) || '[Përgjigje]', kind: 'text' };
  const lr = c.listResponseMessage;
  if (lr) return { text: s(lr.title) || s(lr.singleSelectReply?.selectedRowId) || s(lr.description) || '[Përgjigje]', kind: 'text' };
  const tr = c.templateButtonReplyMessage;
  if (tr) return { text: s(tr.selectedDisplayText) || s(tr.selectedId) || '[Përgjigje]', kind: 'text' };
  const ir = c.interactiveResponseMessage;
  if (ir) return { text: s(ir.body?.text) || '[Përgjigje]', kind: 'text' };
  if (c.locationMessage || c.liveLocationMessage) return { text: '[Vendndodhje]', kind: 'media' };
  if (c.contactMessage) return { text: `[Kontakt: ${s(c.contactMessage.displayName) || '—'}]`, kind: 'media' };
  if (c.contactsArrayMessage) return { text: '[Kontakte]', kind: 'media' };
  if (c.pollCreationMessage || c.pollCreationMessageV2 || c.pollCreationMessageV3) return { text: '[Sondazh]', kind: 'media' };
  return { text: '[Media]', kind: 'media' };
}

/** A reaction updates `reactions.me|contact` on the row it reacts to (if we have it) — never a new row. */
async function applyReaction(agent: AgentState, reaction: any, isFromMe: boolean): Promise<void> {
  const targetId = reaction?.key?.id;
  if (!targetId) return;
  try {
    const found = await findRowRef(agent, String(targetId));
    if (!found) return;
    const emoji = typeof reaction.text === 'string' ? reaction.text : '';
    await found.ref.update({
      [`reactions.${isFromMe ? 'me' : 'contact'}`]: emoji ? emoji : admin.firestore.FieldValue.delete(),
      updatedAt: nowTs(),
    });
  } catch (e) { console.warn(`[${agent.config.id}] reaction update dështoi:`, (e as Error)?.message || e); }
}

/** Baileys `getMessage`: the retry path asks for a message we sent — answer from our own row. */
async function getStoredMessage(agent: AgentState, key: any): Promise<{ conversation: string } | undefined> {
  try {
    if (!key?.id) return undefined;
    const found = await findRowRef(agent, String(key.id));
    const text = found?.data?.message;
    if (found && found.data.direction === 'outbound' && typeof text === 'string' && text) return { conversation: text };
  } catch { /* fall through */ }
  return undefined;
}

/**
 * Apply a receipt to OUR outbound row. Never downgrades (read → delivered), never
 * touches an inbound row (a "read-self" receipt is about a message we received),
 * and lets a late receipt rescue a row the sweeper had marked `no-ack`.
 */
async function applyReceipt(agent: AgentState, waId: string, newStatus: 'failed' | 'sent' | 'delivered' | 'read', error?: string): Promise<void> {
  try {
    const found = await findRowRef(agent, waId);
    if (!found || found.data.direction !== 'outbound') return;
    const current = String(found.data.status || '');
    if (newStatus === 'failed') {
      if (current === 'failed' || (STATUS_RANK[current] ?? -1) >= STATUS_RANK.delivered) return;
      await found.ref.update({ status: 'failed', error: error || 'WhatsApp e refuzoi mesazhin', updatedAt: nowTs() });
      return;
    }
    // A delivery/read receipt is PROOF the contact got it - it beats an earlier
    // "failed" (a NACK from one of OUR other devices used to fail the row and then
    // swallow the recipient's ✓✓). A bare 'sent' still only revives a no-ack row.
    if (current === 'failed' && newStatus === 'sent' && found.data.error !== 'no-ack') return;
    if (current !== 'failed' && (STATUS_RANK[current] ?? -1) >= STATUS_RANK[newStatus]) return;
    await found.ref.update({
      status: newStatus,
      ...(current === 'failed' ? { error: admin.firestore.FieldValue.delete() } : {}),
      updatedAt: nowTs(),
    });
  } catch (e) { console.error(`[${agent.config.id}] Error updating receipt:`, e); }
}

// ── Connect per agent ─────────────────────────────────────────────────────────

/** Exponential backoff 5 s → 5 min with ±20 % jitter (a fleet of agents must not reconnect in lockstep). */
function backoffDelay(attempt: number): number {
  const base = Math.min(5 * 60_000, 5_000 * 2 ** Math.min(attempt, 10));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

function scheduleReconnect(agent: AgentState, why: string, delayMs?: number): void {
  if (agent.unloading || TERMINAL_STATUSES.has(agent.connectionStatus)) return;
  if (agent.reconnectTimer) clearTimeout(agent.reconnectTimer);
  const delay = delayMs ?? backoffDelay(agent.reconnectAttempts++);
  console.log(`[${agent.config.id}] Rilidhje pas ${Math.round(delay / 1000)}s (${why})`);
  agent.reconnectTimer = setTimeout(() => {
    agent.reconnectTimer = null;
    connectAgent(agent).catch(e => console.error(`[${agent.config.id}] reconnect error:`, e));
  }, delay);
}

let cachedBaileysVersion: { v: [number, number, number]; at: number } | null = null;
async function baileysVersion(agentId: string): Promise<[number, number, number]> {
  if (cachedBaileysVersion && Date.now() - cachedBaileysVersion.at < 6 * 60 * 60 * 1000) return cachedBaileysVersion.v;
  try {
    const r = await Promise.race([fetchLatestBaileysVersion(), sleep(8_000).then(() => null)]);
    if (r?.version) { cachedBaileysVersion = { v: r.version as [number, number, number], at: Date.now() }; return cachedBaileysVersion.v; }
  } catch (e) { console.warn(`[${agentId}] fetchLatestBaileysVersion dështoi, duke përdorur version fallback:`, e); }
  return cachedBaileysVersion?.v || [2, 3000, 1015901307];
}

/**
 * Open the agent's socket. Concurrent callers (boot, reconcile, /sync, a reconnect
 * timer, an explicit QR request) JOIN the in-flight attempt — two of them used to
 * open two sockets for one number, which WhatsApp answers with 440 on both.
 */
function connectAgent(agent: AgentState): Promise<void> {
  if (agent.connecting) return agent.connecting;
  const p: Promise<void> = doConnect(agent).finally(() => { if (agent.connecting === p) agent.connecting = null; });
  agent.connecting = p;
  return p;
}

async function doConnect(agent: AgentState): Promise<void> {
  const id = agent.config.id;
  if (agent.unloading) return;
  if (agent.reconnectTimer) { clearTimeout(agent.reconnectTimer); agent.reconnectTimer = null; }
  if (agent.sock) teardownSocket(agent); // never two sockets for one number
  agent.connectionStatus = 'connecting';
  agent.qrDataUrl = null;
  agent.sawQr = false;
  console.log(`[${id}] Duke u lidhur...`);
  try {
    const dir = authDir(id);
    const { state, saveCreds } = await useMultiFileAuthState(dir);
    const version = await baileysVersion(id);
    if (agent.unloading) return;
    if (agent.sock) teardownSocket(agent);
    const sock = makeWASocket({
      version,
      // Baileys 7 keeps LID<->PN mappings, device lists and tc-tokens in the key
      // store and reads them on EVERY 1:1 send (that lookup is what encrypts for
      // a LID-addressed contact's devices) - the cache keeps it off the disk.
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }) as any) },
      logger: pino({ level: BAILEYS_LOG_LEVEL }),
      browser: ['Business CRM', 'Chrome', '1.0.0'],
      printQRInTerminal: false,
      shouldSyncHistoryMessage: () => true,
      // A CRM companion must not flip the phone's presence to "online" (and kill
      // its push notifications) every time the VPS reconnects.
      markOnlineOnConnect: false,
      // Retry bookkeeping across reconnects + the message body for retry requests;
      // without these a recipient that failed to decrypt gets "Waiting for this message".
      msgRetryCounterCache: agent.msgRetryCache,
      getMessage: (key) => getStoredMessage(agent, key),
    });
    agent.sock = sock;
    agent.authCreds = state.creds;
    attachSocketHandlers(agent, sock, saveCreds, dir);
  } catch (e) {
    console.error(`[${id}] connectAgent dështoi:`, e);
    agent.connectionStatus = 'disconnected';
    scheduleReconnect(agent, 'connect-error');
  }
}

/** Explicit "show me a QR / reconnect" (the user is looking): leaves a terminal state, at most once a minute. */
function requestFreshConnection(agent: AgentState): boolean {
  if (agent.unloading || agent.connecting || agent.sock) return false;
  if (!TERMINAL_STATUSES.has(agent.connectionStatus) && agent.connectionStatus !== 'disconnected') return false;
  if (Date.now() - agent.lastExplicitStartAt < 60_000) return false;
  agent.lastExplicitStartAt = Date.now();
  if (agent.reconnectTimer) { clearTimeout(agent.reconnectTimer); agent.reconnectTimer = null; }
  agent.reconnectAttempts = 0;
  agent.connectionStatus = 'connecting';
  console.log(`[${agent.config.id}] Rilidhje e kërkuar nga përdoruesi`);
  connectAgent(agent).catch(e => console.error(`[${agent.config.id}] connectAgent error:`, e));
  return true;
}

/**
 * Closed socket → what next, by DisconnectReason:
 *   loggedOut (401)        → wipe the session, stop (`logged_out`); a new QR only on request
 *   connectionReplaced(440)→ stop (`replaced`) — reconnecting just kicks the other session, forever
 *   forbidden (403)        → stop (`banned`)
 *   badSession (500)       → wipe, stop (`bad_session`)
 *   restartRequired (515)  → reconnect immediately (normal right after pairing)
 *   unscanned QR timed out → stop (`qr_timeout`)
 *   anything else          → exponential backoff 5 s → 5 min
 */
function onSocketClosed(agent: AgentState, sock: ReturnType<typeof makeWASocket>, error: unknown, dir: string): void {
  if (agent.sock !== sock) return; // a socket we already replaced or tore down
  agent.sock = null;
  detachSocket(sock);
  agent.qrDataUrl = null;
  // Nobody is going to ack a message on a closed socket.
  rejectAckWaiters(agent, -1);
  const code: number | null = (error as Boom)?.output?.statusCode ?? null;
  const name = (code != null && DISCONNECT_NAMES[code]) || (error as Error)?.message?.slice(0, 80) || 'unknown';
  agent.lastDisconnect = { code, name, at: new Date().toISOString() };
  const registered = !!agent.authCreds?.registered;

  let next: ConnectionStatus = 'disconnected';
  let action: 'stop' | 'wipe-stop' | 'now' | 'backoff' = 'backoff';
  if (code === DisconnectReason.loggedOut) { next = 'logged_out'; action = 'wipe-stop'; }
  else if (code === DisconnectReason.connectionReplaced) { next = 'replaced'; action = 'stop'; }
  else if (code === DisconnectReason.forbidden) { next = 'banned'; action = 'stop'; }
  else if (code === DisconnectReason.badSession) { next = 'bad_session'; action = 'wipe-stop'; }
  else if (code === DisconnectReason.restartRequired) { next = 'connecting'; action = 'now'; }
  else if (!registered && agent.sawQr && code === DisconnectReason.timedOut) { next = 'qr_timeout'; action = 'stop'; }

  agent.connectionStatus = next;
  console.log(`[${agent.config.id}] Lidhja u ndërpre (${code} ${name}) → ${next}`);
  if (action === 'wipe-stop') {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    agent.connectedPhone = null;
  }
  // Cilësimet reads this so "Lidhur" reflects the socket, and the cron alerts
  // staff from connectionStatus + lastDisconnectReason.
  writeAccountStatus(agent, {
    connectionStatus: next,
    lastDisconnectedAt: nowTs(),
    lastDisconnectReason: { code, name },
    ...(action === 'wipe-stop' ? { connectedPhone: null } : {}),
  });
  if (agent.unloading) return; // account deleted/disabled — never reconnect
  if (action === 'now') scheduleReconnect(agent, name, 0);
  else if (action === 'backoff') scheduleReconnect(agent, name);
}

function onSocketOpen(agent: AgentState, sock: ReturnType<typeof makeWASocket>): void {
  if (agent.sock !== sock) return;
  agent.connectionStatus = 'connected'; agent.qrDataUrl = null;
  agent.reconnectAttempts = 0;
  agent.lastConnectedAt = new Date();
  console.log(`[${agent.config.id}] ✅ I lidhur!`);
  const myPhone = normalizePhone(jidUser(sock.user?.id || ''));
  if (myPhone) agent.connectedPhone = myPhone;
  writeAccountStatus(agent, {
    connectionStatus: 'connected',
    lastConnectedAt: nowTs(),
    ...(myPhone ? { connectedPhone: myPhone } : {}),
  });
  // Rationed (24h gate inside) — a reconnect no longer triggers a USync burst.
  setTimeout(() => { if (agent.sock === sock) void maybeRunDailyLookups(agent); }, 30_000);
}

function attachSocketHandlers(agent: AgentState, sock: ReturnType<typeof makeWASocket>, saveCreds: () => Promise<void>, dir: string): void {
  const live = () => agent.sock === sock && !agent.unloading;

  sock.ev.on('creds.update', () => { if (live()) saveCreds().catch(e => console.error(`[${agent.config.id}] saveCreds:`, e)); });

  sock.ev.on('connection.update', async (update) => {
    if (!live()) return;
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      agent.sawQr = true;
      try { agent.qrDataUrl = await QRCode.toDataURL(qr); } catch {}
      if (!live()) return;
      agent.connectionStatus = 'qr_ready';
      console.log(`[${agent.config.id}] QR gati → /qr/${agent.config.id}`);
    }
    if (connection === 'close') onSocketClosed(agent, sock, lastDisconnect?.error, dir);
    if (connection === 'open') onSocketOpen(agent, sock);
  });

  // The SERVER ack of a message we sent. Baileys (6.7 and 7) handles this frame only
  // for errors, so messages.update never reports SERVER_ACK — the first status we
  // used to see was the PHONE's delivery receipt, and a phone that is off kept a
  // message "pending" all night. This frame is WhatsApp saying "accepted".
  (sock.ws as any).on(SERVER_ACK_FRAME, (node: any) => {
    if (!live()) return;
    const id = node?.attrs?.id;
    if (!id || !agent.outstanding.has(id)) return; // only ids /send handed to this socket
    agent.outstanding.delete(id);
    const err = node?.attrs?.error;
    if (err && isOwnDeviceJid(agent, node?.attrs?.from)) {
      // A NACK from one of OUR other devices (phone, Web, hosted) concerns only
      // the self-copy - the contact's copy is unaffected. Heal, don't fail.
      void healDeviceSession(agent, node?.attrs?.from, String(err));
      return;
    }
    agent.ackWaiters.get(id)?.(err ? 0 : 2);
    void applyReceipt(agent, id, err ? 'failed' : 'sent', err ? `server-ack-error-${err}` : undefined);
  });

  const onContacts = (list: any[]) => {
    if (!live()) return;
    for (const c of list) {
      const { lid, pn } = contactLidPn(c);
      if (lid && pn) void registerLidMapping(agent, lid, pn);
      const name = c.notify || c.name || null;
      if (name && pn) void syncContactName(agent, pn, name);
    }
  };
  sock.ev.on('contacts.upsert', onContacts);
  sock.ev.on('contacts.update', onContacts as any);

  // Baileys 7 announces every LID<->PN pair it learns (usync, history, receipts...).
  sock.ev.on('lid-mapping.update', (m: any) => {
    if (!live()) return;
    for (const pair of Array.isArray(m) ? m : [m]) {
      if (pair?.lid && pair?.pn) void registerLidMapping(agent, pair.lid, pair.pn);
    }
  });

  // History sync: harvest LID ↔ phone pairs only. Its messages are NOT written —
  // a replay must never resurrect rows or flip read state.
  sock.ev.on('messaging-history.set', (data: any) => {
    if (!live()) return;
    for (const m of (data.lidPnMappings || data.phoneNumberToLidMappings || [])) {
      const lid = m.lid || m.lidJid; const pn = m.pn || m.pnJid;
      if (lid && pn) void registerLidMapping(agent, lid, pn);
    }
    for (const c of (data.contacts || [])) {
      const { lid, pn } = contactLidPn(c);
      if (lid && pn) void registerLidMapping(agent, lid, pn);
      const name = (c as any).notify || (c as any).name || null;
      if (name && pn) void syncContactName(agent, pn, name);
    }
    for (const ch of (data.chats || [])) {
      const lid = (ch as any).lid || (ch as any).lidJid; const pn = ch.id || (ch as any).pnJid;
      if (lid && pn) void registerLidMapping(agent, lid, pn);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (!live()) return;
    for (const msg of messages) {
      try { await handleUpsertMessage(agent, msg, type); }
      catch (e) { console.error(`[${agent.config.id}] Error saving message:`, e); }
    }
  });

  // Receipts: 0 ERROR, 1 PENDING, 2 SERVER_ACK, 3 DELIVERY_ACK, 4 READ, 5 PLAYED.
  sock.ev.on('messages.update', async (updates) => {
    if (!live()) return;
    for (const update of updates) {
      const waMessageId = update.key?.id; if (!waMessageId) continue;
      const code = (update.update as any)?.status;
      if (typeof code !== 'number') continue;
      const newStatus = RECEIPT_STATUS[code]; if (!newStatus) continue; // 1 = PENDING is not a receipt
      // Baileys 7 puts the server's NACK code in messageStubParameters[0]
      // (463 = no privacy token / restricted for new chats, 479 = stale device
      // session, …). Keep it: "refused" alone cannot be acted on.
      const nack = code === 0 ? (update.update as any)?.messageStubParameters?.[0] : undefined;
      if (code === 0) {
        const from = String(update.key?.remoteJid || '');
        // Baileys 7 turns every NACK into ERROR - also one sent by OUR other
        // device for its self-copy (479 = stale session). That is not the
        // contact refusing the message: rebuild that session, keep the status
        // (and do not resolve the /send waiter as a failure).
        if (isOwnDeviceJid(agent, from)) { void healDeviceSession(agent, from, String(nack ?? '?')); continue; }
        if (String(nack) === '479') void healDeviceSession(agent, from, '479');
      }
      agent.outstanding.delete(waMessageId);
      agent.ackWaiters.get(waMessageId)?.(code);
      await applyReceipt(agent, waMessageId, newStatus, code === 0
        ? (nack ? `WhatsApp e refuzoi mesazhin (kodi ${nack})` : 'WhatsApp e refuzoi mesazhin')
        : undefined);
      if (code === 0) console.warn(`[${agent.config.id}] NACK ${nack ?? '?'} për ${waMessageId} → ${maskJid(String(update.key?.remoteJid || ''))}`);
    }
  });
}

/**
 * One upserted message → one `whatsappMessages` row (created, never overwritten)
 * → the CRM's inbound handler.
 */
async function handleUpsertMessage(agent: AgentState, msg: any, type: string): Promise<void> {
  if (!msg?.message) return;
  const isFromMe = !!msg.key?.fromMe;

  // Process 'notify' (live) messages for both directions.
  // Also process recent inbound 'append' messages — these are messages that arrived
  // while the VPS was briefly offline and are replayed on reconnect. Rows are
  // created with create(), so a replay of a message we already have is a no-op
  // (it never re-marks anything unread).
  if (type !== 'notify') {
    if (type !== 'append') return;
    if (isFromMe) return;
    const msgTs = Number(msg.messageTimestamp) * 1000;
    if (Date.now() - msgTs > 24 * 60 * 60 * 1000) return;
  }

  const rawJid: string = msg.key.remoteJid || '';
  // Only PEOPLE become contacts. Groups (@g.us), WhatsApp Channels (@newsletter)
  // and status posts (@broadcast) carry an 18-digit id, not a phone number — a
  // political news channel used to be minted as a CRM lead per post.
  if (!isPersonJid(rawJid)) return;

  const content = unwrapMessage(msg.message);
  const cls = classifyContent(content);
  if (cls === 'reaction') { await applyReaction(agent, content.reactionMessage, isFromMe); return; }
  if (cls === 'skip') return;

  // ── Who is this? ──
  // Baileys 7: a 1:1 key carries the chat's OTHER address in `remoteJidAlt`
  // (LID chat -> its phone jid, phone chat -> its LID) in BOTH directions - it
  // names the contact, never us. Fallbacks: our map, then Baileys' own LID
  // store, then the 6.x `senderPn` attrs (old stanzas replayed on reconnect).
  const key = msg.key as any;
  const alt: string | undefined = key.remoteJidAlt || undefined;
  let resolvedJid = rawJid; let isLid = false; let lidJid: string | null = null;
  if (rawJid.endsWith('@lid')) {
    lidJid = canonicalLidJid(rawJid);
    if (!lidJid) return;
    let phoneJid = agent.lidToPhoneMap.get(lidJid) || null;
    if (!phoneJid) {
      const pn = canonicalPhoneJid(alt)
        || canonicalPhoneJid(await lidStorePnFor(agent, lidJid))
        || (!isFromMe ? (canonicalPhoneJid(key.senderPn) || canonicalPhoneJid(key.participantPn)) : null);
      if (pn) { await registerLidMapping(agent, lidJid, pn); phoneJid = agent.lidToPhoneMap.get(lidJid) || null; }
    }
    if (phoneJid) resolvedJid = phoneJid; else isLid = true;
  } else if (alt && alt.endsWith('@lid')) {
    void registerLidMapping(agent, alt, rawJid);
  } else if (!isFromMe && key.senderLid) {
    void registerLidMapping(agent, key.senderLid, rawJid);
  }

  // An unresolved LID row keeps the LID digits in `phone` (one thread per LID in
  // the inbox, backfilled to the real number once the mapping is learnt) — the
  // LID is NOT run through normalizePhone, it is not a phone.
  const phone = isLid ? jidUser(lidJid!) : normalizePhone(jidUser(resolvedJid));
  if (!phone) return;

  const { text: body, kind } = extractContent(content);
  const ts = new Date(Number(msg.messageTimestamp) * 1000 || Date.now());
  const waId: string | null = msg.key.id || null;
  // pushName on a fromMe stanza is OUR profile name, not the contact's.
  const pushName = !isFromMe ? (msg.pushName || null) : null;
  const docId = waId ? rowId(agent.config.id, waId) : db.collection('whatsappMessages').doc().id;

  // A message older than this process may already have a row under the legacy bare id.
  if (waId && ts.getTime() < BOOT_AT_MS) {
    const legacy = await db.collection('whatsappMessages').doc(waId).get();
    if (legacy.exists && legacy.data()?.agentId === agent.config.id) return;
  }

  const { leadId: autoLeadId, leadName: autoLeadName } = isLid
    ? { leadId: null, leadName: null }
    : await lookupLeadByPhone(agent, phone);
  try {
    await db.collection('whatsappMessages').doc(docId).create({
      phone, jid: resolvedJid,
      direction: isFromMe ? 'outbound' : 'inbound',
      message: body, waMessageId: waId, kind,
      leadId: autoLeadId, leadName: autoLeadName || pushName, pushName,
      teamId: agent.config.teamId,
      agentId: agent.config.id,
      channelPhone: agent.connectedPhone || agent.config.id,
      status: isFromMe ? 'sent' : 'received',
      channel: 'baileys', isLid,
      ...(lidJid ? { lid: lidJid } : {}),
      createdAt: admin.firestore.Timestamp.fromDate(ts),
      updatedAt: nowTs(),
    });
  } catch (e: any) {
    // ALREADY_EXISTS: our own /send echo, or a redelivery/replay — the row is there, leave it alone.
    if (e?.code === 6 || /already exists/i.test(String(e?.message))) return;
    throw e;
  }

  // Track last inbound for 24h-window awareness (baileys side).
  if (!isFromMe && !isLid && agent.config.teamId) {
    try {
      const convId = `${agent.config.teamId}_${phone}`;
      await db.collection('whatsappConversations').doc(convId).set({
        teamId: agent.config.teamId,
        phone,
        lastInboundAt: admin.firestore.Timestamp.fromDate(ts),
        channel: 'baileys',
        updatedAt: nowTs(),
      }, { merge: true });
    } catch { /* non-critical */ }
  }

  if (isLid) {
    const queue = agent.pendingLidMessages.get(lidJid!) || [];
    queue.push(docId);
    agent.pendingLidMessages.set(lidJid!, queue);
    console.log(`[${agent.config.id}] ${isFromMe ? '→' : '←'} ${maskJid(lidJid)} (LID pa numër): ${maskBody(body)}`);
  } else {
    console.log(`[${agent.config.id}] ${isFromMe ? '→' : '←'} ${maskPhone(phone)}: ${maskBody(body)}`);
  }

  // Hand the event to the CRM's shared inbound handler (identity → conversation →
  // notification → auto-reply). The row above is already durable; delivery is
  // durable too (outbox). fromMe = the staff answered from the PHONE — the
  // cheapest "replied" signal we have. A still-unresolved LID is forwarded with
  // phone '' + `lid`, so the CRM is at least told something arrived.
  void postWaEvent({
    channel: 'baileys',
    direction: isFromMe ? 'outbound' : 'inbound',
    teamId: agent.config.teamId,
    agentId: agent.config.id,
    metaPhoneNumberId: null,
    channelPhone: agent.connectedPhone || agent.config.id,
    // == the whatsappMessages document id (the contract of api/_waInbound.ts).
    waMessageId: docId,
    messageDocId: docId,
    docId,
    waId,
    phone: isLid ? '' : phone,
    jid: resolvedJid,
    isLid,
    // Bare LID (no @lid), as the api expects.
    lid: lidJid ? jidUser(lidJid) : null,
    text: body,
    kind,
    pushName,
    isAutoReply: false,
    timestamp: ts.toISOString(),
  }, docId);
}

// ── Agent lookup ──────────────────────────────────────────────────────────────

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

// ── Outbound: existence check, queue, idempotency ─────────────────────────────

/**
 * "Is this number on WhatsApp?" — per phone, cached 24h both ways. Without it a
 * send to a number without WhatsApp never gets a receipt, so without this check
 * the row stayed `pending` forever. exists: null = unknown (timeout/error) → send anyway.
 */
const onWaCache = new Map<string, { exists: boolean; jid: string | null; at: number }>();
async function checkOnWhatsApp(agent: AgentState, phone: string, timeoutMs: number): Promise<{ exists: boolean | null; jid: string | null }> {
  const hit = onWaCache.get(phone);
  if (hit && Date.now() - hit.at < ON_WA_TTL_MS) return hit;
  const unknown = { exists: null, jid: null };
  if (!agent.sock || timeoutMs < 300) return unknown;
  try {
    const res = await Promise.race([agent.sock.onWhatsApp(`${phone}@s.whatsapp.net`), sleep(timeoutMs).then(() => 'timeout' as const)]);
    if (res === 'timeout' || !Array.isArray(res)) return unknown;
    const row = res.find((r) => r && r.exists);
    const entry = row
      ? { exists: true, jid: canonicalPhoneJid(String(row.jid)) || `${phone}@s.whatsapp.net`, at: Date.now() }
      : { exists: false, jid: null, at: Date.now() };
    // Baileys 7 no longer returns `lid` here; it learns the pair during the
    // usync and keeps it in its LID store - read it back from there.
    if (entry.jid) { const pnJid = entry.jid; void lidStoreLidFor(agent, pnJid).then((lid) => { if (lid) void registerLidMapping(agent, lid, pnJid); }); }
    onWaCache.set(phone, entry);
    return entry;
  } catch (e) {
    console.warn(`[${agent.config.id}] onWhatsApp(${maskPhone(phone)}) dështoi:`, (e as Error)?.message || e);
    return unknown;
  }
}

/**
 * Serialise one agent's sends: each runs alone, at least SEND_GAP_MS (+ jitter)
 * after the previous one actually went out. Returns the task's result.
 */
function enqueueSend<T>(agent: AgentState, docId: string, task: () => Promise<T>): Promise<T> {
  agent.queuedDocIds.add(docId);
  const run = async () => {
    try {
      const gap = SEND_GAP_MS + Math.floor(Math.random() * SEND_GAP_JITTER_MS);
      await sleep(agent.lastSentAt + gap - Date.now());
      return await task();
    } finally {
      agent.queuedDocIds.delete(docId);
    }
  };
  const p = agent.sendChain.then(run, run);
  agent.sendChain = p.catch(() => undefined);
  return p;
}
/** Estimated wait before a send enqueued now would start (for the inline-vs-queued decision). */
function estimatedQueueWaitMs(agent: AgentState): number {
  const ahead = agent.queuedDocIds.size;
  const sinceLast = Date.now() - agent.lastSentAt;
  const first = Math.max(0, SEND_GAP_MS + SEND_GAP_JITTER_MS / 2 - sinceLast);
  return ahead === 0 ? first : first + ahead * (SEND_GAP_MS + SEND_GAP_JITTER_MS / 2 + 300);
}

/**
 * Write the stanza and wait for the ack. Codes: ≥2 acked, 0 rejected,
 * -1 socket closed / not connected, -2 no ack in time, -3 sendMessage threw.
 */
async function transmit(agent: AgentState, waId: string, jid: string, message: string, ackWaitMs: () => number): Promise<{ code: number; error?: string }> {
  const sock = agent.sock;
  if (!sock || agent.connectionStatus !== 'connected') return { code: -1, error: 'WhatsApp jo i lidhur' };
  const ack = new Promise<number>((resolve) => { agent.ackWaiters.set(waId, resolve); });
  agent.outstanding.set(waId, Date.now());
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await sock.sendMessage(jid, { text: message }, { messageId: waId });
    agent.lastSentAt = Date.now();
    const code = await Promise.race([
      ack,
      new Promise<number>((resolve) => { timer = setTimeout(() => resolve(-2), Math.max(300, ackWaitMs())); }),
    ]);
    return { code };
  } catch (err: unknown) {
    agent.lastSentAt = Date.now();
    agent.outstanding.delete(waId);
    return { code: -3, error: err instanceof Error ? err.message : 'Dërgimi dështoi' };
  } finally {
    if (timer) clearTimeout(timer);
    agent.ackWaiters.delete(waId);
  }
}

function failureText(code: number, error?: string): string {
  if (code === 0) return 'WhatsApp e refuzoi mesazhin';
  if (code === -1) return error || 'Lidhja u ndërpre para konfirmimit';
  return error || 'Dërgimi dështoi';
}

interface SendOutcome { httpStatus: number; body: Record<string, unknown>; attempted: boolean }
interface SendInput {
  message: string; cleanPhone: string; jid: string;
  leadId: string | null; leadName: string | null;
  isAutoReply: boolean; sentByUid: string | null;
  idempotencyKey: string | null;
  automated?: boolean; automationKind?: string; source?: string;
}

async function performSend(agent: AgentState, input: SendInput, started: number): Promise<SendOutcome> {
  const base = { agentId: agent.config.id, teamId: agent.config.teamId };
  const remaining = () => REQUEST_BUDGET_MS - (Date.now() - started);

  // Defence-in-depth rate limit: max 30 sends/min per RESOLVED agent (VPS-side
  // guard in addition to the per-user limit on Vercel). Keyed on the agent that
  // will actually send, so a teamId-only call cannot bypass it.
  if (!checkSendRate(agent.config.id)) {
    return { httpStatus: 429, attempted: false, body: { ok: false, error: 'Limiti i dërgimeve nga ky agent u arrit. Provoni pas pak.', ...base } };
  }

  let jid = input.jid;
  // Honest status. Baileys' sendMessage() resolves as soon as the stanza is
  // written to the socket — it says nothing about WhatsApp accepting it. The row
  // therefore starts as `pending` and becomes `sent` only on the server ack. The
  // id is generated HERE so the row exists before the receipt can arrive. The row
  // belongs to the AGENT's team, unconditionally — the body cannot relabel it.
  const waId = generateMessageIDV2(agent.sock?.user?.id);
  const docId = rowId(agent.config.id, waId);
  const ref = db.collection('whatsappMessages').doc(docId);
  const row: Record<string, unknown> = {
    phone: input.cleanPhone, jid, direction: 'outbound', message: input.message,
    leadId: input.leadId, leadName: input.leadName, waMessageId: waId,
    teamId: agent.config.teamId, agentId: agent.config.id, channelPhone: agent.connectedPhone || agent.config.id,
    status: 'pending', channel: 'baileys',
    isAutoReply: input.isAutoReply,
    sentByUid: input.sentByUid,
    idempotencyKey: input.idempotencyKey,
    ...(typeof input.automated === 'boolean' ? { automated: input.automated } : {}),
    ...(input.automationKind ? { automationKind: input.automationKind } : {}),
    ...(input.source ? { source: input.source } : {}),
    createdAt: nowTs(), updatedAt: nowTs(),
  };

  if (jid.endsWith('@s.whatsapp.net')) {
    const wa = await checkOnWhatsApp(agent, jidUser(jid), Math.min(ON_WA_TIMEOUT_MS, remaining() - 3_000));
    if (wa.exists === false) {
      await ref.create({ ...row, status: 'failed', error: 'not-on-whatsapp' }).catch(() => {});
      console.warn(`[${agent.config.id}] ✗ ${maskPhone(input.cleanPhone)}: nuk është në WhatsApp`);
      return { httpStatus: 422, attempted: true, body: { ok: false, success: false, error: 'not-on-whatsapp', id: docId, waMessageId: waId, status: 'failed', ...base } };
    }
    if (wa.jid && wa.jid !== jid) { jid = wa.jid; row.jid = jid; }
  }

  await ref.create(row);

  const ackBudget = () => Math.min(SEND_ACK_TIMEOUT_MS, remaining() - 300);
  const wait = estimatedQueueWaitMs(agent);
  if (wait > QUEUE_INLINE_MAX_MS || remaining() - wait < 2_500) {
    // Too long to hold the HTTP request: answer now, send in order in the background.
    void enqueueSend(agent, docId, () => transmit(agent, waId, jid, input.message, () => BACKGROUND_ACK_WAIT_MS))
      .then(async (r) => {
        if (r.code >= 2 || r.code === -2) return; // acked, or the receipt handlers finish it
        await ref.update({ status: 'failed', error: failureText(r.code, r.error), updatedAt: nowTs() }).catch(() => {});
        console.warn(`[${agent.config.id}] ✗ (radhë) ${maskPhone(input.cleanPhone)}: ${failureText(r.code, r.error)}`);
      })
      .catch((e) => console.error(`[${agent.config.id}] queued send error:`, e));
    console.log(`[${agent.config.id}] ⏳ ${maskPhone(input.cleanPhone)}: në radhë (~${Math.round(wait / 1000)}s)`);
    return { httpStatus: 200, attempted: true, body: { ok: true, success: true, status: 'queued', id: docId, waMessageId: waId, ...base } };
  }

  const r = await enqueueSend(agent, docId, () => transmit(agent, waId, jid, input.message, ackBudget));
  if (r.code === 0 || r.code === -1 || r.code === -3) {
    const error = failureText(r.code, r.error);
    await ref.update({ status: 'failed', error, updatedAt: nowTs() }).catch(() => {});
    console.warn(`[${agent.config.id}] ✗ ${maskPhone(input.cleanPhone)}: ${error}`);
    return { httpStatus: r.code === -3 ? 500 : 502, attempted: true, body: { ok: false, success: false, error, id: docId, waMessageId: waId, status: 'failed', ...base } };
  }
  const status = r.code >= 2 ? 'sent' : 'pending';
  if (status === 'pending') console.warn(`[${agent.config.id}] ? ${maskPhone(input.cleanPhone)}: pa ack brenda afatit — mbetet pending`);
  else console.log(`[${agent.config.id}] → ${maskPhone(input.cleanPhone)}: ${maskBody(input.message)}${input.isAutoReply ? ' (auto-reply)' : ''}`);
  // teamId is returned so the caller (api/whatsapp.ts) can key the conversation
  // even when it did not know the agent's team.
  return { httpStatus: 200, attempted: true, body: { ok: true, success: true, id: docId, waMessageId: waId, status, ...base } };
}

/**
 * Idempotency: the same `idempotencyKey` (per agent, or per team when no agent
 * is named) within 24h never sends twice. In-process: the first request's
 * promise is shared (set synchronously, before any await). Across restarts /
 * instances: a row carrying the key wins. A request that never reached the
 * socket (validation, not connected, rate limit) is not remembered — retrying it
 * is exactly what the key is for.
 */
const idemCache = new Map<string, { at: number; promise: Promise<SendOutcome> }>();
function outcomeForExistingRow(id: string, d: Record<string, any>): SendOutcome {
  const base = { id, waMessageId: d.waMessageId || null, agentId: d.agentId || null, teamId: d.teamId || null, status: d.status || null, idempotent: true };
  if (d.status === 'failed') {
    if (d.error === 'not-on-whatsapp') return { httpStatus: 422, attempted: true, body: { ok: false, success: false, error: 'not-on-whatsapp', ...base } };
    return { httpStatus: 502, attempted: true, body: { ok: false, success: false, error: d.error || 'Dërgimi dështoi', ...base } };
  }
  return { httpStatus: 200, attempted: true, body: { ok: true, success: true, ...base } };
}
async function findIdempotentRow(key: string, agentId: string | undefined, teamId: string | undefined): Promise<SendOutcome | null> {
  const snap = await db.collection('whatsappMessages').where('idempotencyKey', '==', key).limit(10).get();
  for (const doc of snap.docs) {
    const d = doc.data();
    if (agentId ? d.agentId !== agentId : d.teamId !== teamId) continue;
    if (Date.now() - tsMs(d.createdAt) > IDEMPOTENCY_TTL_MS) continue;
    return outcomeForExistingRow(doc.id, d);
  }
  return null;
}

// ── Stale `pending` sweeper ───────────────────────────────────────────────────
// A row nobody acked within 10 min is `failed` / `no-ack` (a late receipt still
// upgrades it, see applyReceipt). Two equality filters (no composite index) and a
// cap; the createdAt window is applied in code because no (status, createdAt)
// index exists for whatsappMessages.
async function sweepStalePending(): Promise<void> {
  try {
    const snap = await db.collection('whatsappMessages').where('channel', '==', 'baileys').where('status', '==', 'pending').limit(300).get();
    if (snap.empty) return;
    const now = Date.now();
    const queued = new Set<string>();
    for (const a of agents.values()) for (const id of a.queuedDocIds) queued.add(id);
    const updates = snap.docs
      .filter((d) => {
        const created = tsMs(d.data().createdAt);
        return created > 0 && created < now - PENDING_STALE_MS && created > now - 30 * 24 * 60 * 60 * 1000 && !queued.has(d.id);
      })
      .map((d) => ({ ref: d.ref, data: { status: 'failed', error: 'no-ack', updatedAt: nowTs() } as Record<string, unknown> }));
    if (!updates.length) return;
    await commitUpdatesInChunks(updates);
    console.warn(`[WA] ${updates.length} mesazhe pending > 10 min → failed (no-ack)`);
  } catch (e) { console.error('[WA] sweepStalePending dështoi:', e); }
}

/** Hourly housekeeping of the in-memory caches (24h TTLs, outstanding ids). */
function pruneWaCaches(): void {
  const now = Date.now();
  for (const [k, v] of onWaCache) if (now - v.at > ON_WA_TTL_MS) onWaCache.delete(k);
  for (const [k, v] of idemCache) if (now - v.at > IDEMPOTENCY_TTL_MS) idemCache.delete(k);
  for (const a of agents.values()) {
    for (const [id, at] of a.outstanding) if (now - at > 60 * 60 * 1000) a.outstanding.delete(id);
    for (const [p, at] of a.lookedUpPhones) if (now - at > LOOKUP_REPEAT_AFTER_MS) a.lookedUpPhones.delete(p);
  }
}

function startWaMaintenance(): void {
  setInterval(() => { void sweepStalePending(); }, 5 * 60 * 1000);
  setInterval(() => { void drainWaInboundOutbox(); }, 60 * 1000);
  setInterval(() => { void refreshOutboxCounts(); }, 5 * 60 * 1000);
  setInterval(pruneWaCaches, 60 * 60 * 1000).unref?.();
  setTimeout(() => { void sweepStalePending(); void drainWaInboundOutbox(); void refreshOutboxCounts(); }, 30_000);
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
    const connected = a.connectionStatus === 'connected' && !!a.sock;
    statuses[id] = {
      id, label: a.config.label,
      // `status` is what api/whatsapp.ts relays; `connectionStatus` is the same value, explicit.
      status: a.connectionStatus, connectionStatus: a.connectionStatus, connected,
      teamId: a.config.teamId, businessId: a.config.businessId, assignedToUserId: a.config.assignedToUserId,
      connectedPhone: connected ? a.connectedPhone : null,
      lastDisconnectReason: a.lastDisconnect,
      lastConnectedAt: a.lastConnectedAt ? a.lastConnectedAt.toISOString() : null,
      reconnectAttempts: a.reconnectAttempts,
      outboxPending: outboxPendingByAgent.get(id) || 0,
      queuedSends: a.queuedDocIds.size,
      lidMappings: a.lidToPhoneMap.size, pendingLids: a.pendingLidMessages.size,
    };
  }
  res.json({ agents: statuses, outbox: { inFlight: outboxInFlight.size } });
});

app.get('/agents', requireApiKey, (_req, res) => {
  res.json({ agents: Array.from(agents.values()).map(a => ({ id: a.config.id, label: a.config.label, teamId: a.config.teamId, assignedToUserId: a.config.assignedToUserId, status: a.connectionStatus })) });
});

// QR data JSON (used by FivoCRM UI via Vercel proxy). Opening it IS the explicit
// request that restarts an agent stopped in a terminal state (logged out, QR
// expired, replaced …) — the only way a new QR is generated after a logout.
app.get('/qr-data/:agentId', requireApiKey, (req: any, res: any) => {
  const agent = agents.get(req.params.agentId);
  if (!agent) { res.status(404).json({ error: 'Agent nuk u gjet' }); return; }
  const restarted = requestFreshConnection(agent);
  res.json({
    agentId: agent.config.id,
    label: agent.config.label,
    status: agent.connectionStatus,
    qrDataUrl: agent.qrDataUrl || null,
    connectedPhone: agent.connectionStatus === 'connected' ? (agent.connectedPhone || null) : null,
    lastDisconnectReason: agent.lastDisconnect,
    restarted,
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
  requestFreshConnection(agent);
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

// Sync per agent. It used to end() the socket and connect a second time, even
// while connected or mid-connect — two sockets for one number. Now: connected →
// run the (rationed) LID lookups on the existing socket; connecting → refuse;
// stopped/disconnected → one guarded connect.
app.post('/sync/:agentId', requireApiKey, async (req, res) => {
  const agent = agents.get(req.params.agentId);
  if (!agent) { res.status(404).json({ error: 'Agent nuk u gjet' }); return; }
  if (agent.isSyncing) { res.status(409).json({ error: 'Sync tashmë në progres' }); return; }
  const before = agent.lidToPhoneMap.size;
  if (agent.connectionStatus === 'connected' && agent.sock) {
    agent.isSyncing = true;
    try {
      const r = await maybeRunDailyLookups(agent, true);
      res.json({ success: true, status: agent.connectionStatus, lookup: r, lidMappings: agent.lidToPhoneMap.size, newMappings: agent.lidToPhoneMap.size - before });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Sync dështoi' });
    } finally { agent.isSyncing = false; }
    return;
  }
  if (agent.connecting || agent.connectionStatus === 'connecting' || agent.connectionStatus === 'qr_ready') {
    res.status(409).json({ error: 'Agenti po lidhet tashmë', status: agent.connectionStatus });
    return;
  }
  const restarted = requestFreshConnection(agent);
  res.json({ success: restarted, status: agent.connectionStatus, lidMappings: agent.lidToPhoneMap.size });
});

// Backward compat /sync
app.post('/sync', requireApiKey, async (req, res) => {
  const agent = getAgent(); if (!agent) { res.status(503).json({ error: 'No agents' }); return; }
  res.redirect(307, `/sync/${agent.config.id}`);
});

/**
 * Send a text message.
 *
 * Body: { to, message, agentId?, teamId?, jid?, leadId?, leadName?, isAutoReply?,
 *         sentByUid?, idempotencyKey?, automated?, automationKind?, source? }
 * Answers (all JSON, `id` = the whatsappMessages doc id `${agentId}_${waMessageId}`):
 *   200 { ok, success, id, waMessageId, status: 'sent'|'pending'|'queued', agentId, teamId[, idempotent] }
 *   422 { ok:false, error:'not-on-whatsapp', id, status:'failed' }
 *   400/404/429/503 before anything was sent; 502/500 = the send failed (row `failed`).
 */
app.post('/send', requireApiKey, async (req, res) => {
  const started = Date.now();
  const b = (req.body || {}) as Record<string, any>;
  const { to, message } = b;
  // Callers send `null` for "unknown"; treat anything but a non-empty string as absent.
  const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const agentId = str(b.agentId);
  const teamId = str(b.teamId);

  if (!to || !message || typeof to !== 'string' || typeof message !== 'string') {
    res.status(400).json({ error: 'Fushat "to" dhe "message" janë të detyrueshme' }); return;
  }
  const idempotencyKey = str(b.idempotencyKey) ?? null;

  const cleanPhone = normalizePhone(String(to));
  const rawJid = typeof b.jid === 'string' ? b.jid : '';
  const bodyJid = rawJid.endsWith('@lid') ? canonicalLidJid(rawJid) : (rawJid ? canonicalPhoneJid(rawJid) : null);
  const jid = bodyJid || (cleanPhone ? `${cleanPhone}@s.whatsapp.net` : '');
  if (!jid) { res.status(400).json({ error: 'Numri i telefonit është i pavlefshëm' }); return; }

  const input: SendInput = {
    message, cleanPhone: cleanPhone || (jid.endsWith('@s.whatsapp.net') ? jidUser(jid) : ''), jid,
    leadId: str(b.leadId) ?? null, leadName: str(b.leadName) ?? null,
    // Auto-reply echo (from api/_waInbound.ts) — must never count as a staff answer.
    isAutoReply: b.isAutoReply === true,
    // The staff uid that pressed send (api/whatsapp.ts); null for automation.
    sentByUid: str(b.sentByUid) ?? null,
    idempotencyKey,
    automated: typeof b.automated === 'boolean' ? b.automated : undefined,
    automationKind: str(b.automationKind, 64),
    source: str(b.source, 64),
  };

  const resolveAndSend = async (): Promise<SendOutcome> => {
    // Tenant-safe resolution — never a foreign tenant's number, never a relabelled row.
    const resolved = resolveSendAgent(agentId, teamId);
    if (!resolved.ok || !resolved.agent) {
      return { httpStatus: resolved.status || 500, attempted: false, body: { ok: false, error: resolved.error || 'Agenti nuk u zgjidh', agentId: agentId || null, teamId: teamId || null } };
    }
    return performSend(resolved.agent, input, started);
  };
  const failOutcome = (err: unknown): SendOutcome => {
    console.error(`[send] ✗ ${maskPhone(cleanPhone)}:`, err);
    return { httpStatus: 500, attempted: false, body: { ok: false, error: err instanceof Error ? err.message : 'Dërgimi dështoi' } };
  };

  if (!idempotencyKey) {
    let out: SendOutcome;
    try { out = await resolveAndSend(); } catch (err) { out = failOutcome(err); }
    res.status(out.httpStatus).json(out.body);
    return;
  }

  const mapKey = `${agentId || ''}|${teamId || ''}|${idempotencyKey}`;
  const hit = idemCache.get(mapKey);
  if (hit && Date.now() - hit.at < IDEMPOTENCY_TTL_MS) {
    const out = await hit.promise;
    res.status(out.httpStatus).json({ ...out.body, idempotent: true });
    return;
  }
  // Registered synchronously (no await since the get) — a concurrent duplicate joins this promise.
  let settle!: (o: SendOutcome) => void;
  idemCache.set(mapKey, { at: Date.now(), promise: new Promise<SendOutcome>((r) => { settle = r; }) });
  let out: SendOutcome;
  try {
    out = (await findIdempotentRow(idempotencyKey, agentId, teamId)) ?? await resolveAndSend();
  } catch (err) { out = failOutcome(err); }
  if (!out.attempted) idemCache.delete(mapKey);
  settle(out);
  res.status(out.httpStatus).json(out.body);
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
// The whatsappMessages row is already written before this is called. Delivery
// is DURABLE: one immediate attempt (55 s timeout — the function may run 60 s;
// the old 20 s abort killed slow-but-successful runs and retried them), and on a
// network error / timeout / 5xx / 429 the payload goes to the Firestore outbox
// `waInboundOutbox/{agentId_msgId}` (server-only: Admin SDK, no client rules),
// retried every minute with backoff for up to 24 h, then parked in
// `waInboundOutboxDead`. Every attempt carries `Idempotency-Key: <agentId>_<msgId>`
// so the CRM can dedupe a delivery that succeeded but whose answer was lost.
interface WaEventPayload {
  channel: 'baileys' | 'meta';
  direction: 'inbound' | 'outbound';
  teamId: string;
  agentId: string | null;
  metaPhoneNumberId: string | null;
  channelPhone: string;
  /** == the `whatsappMessages` document id (`${agentId}_${waId}`), as api/_waInbound.ts expects. */
  waMessageId: string;
  /** The row the api updates (it tries messageDocId → `${agentId}_${waMessageId}` → bare id). */
  messageDocId?: string;
  /** Same as messageDocId (kept for readers of the earlier shape). */
  docId?: string;
  /** The raw WhatsApp message id. */
  waId?: string | null;
  /** '' when only the LID is known (then `lid` — bare digits, no @lid — is set and isLid is true). */
  phone: string;
  jid: string;
  isLid: boolean;
  lid?: string | null;
  text: string;
  kind: 'text' | 'media' | 'reaction' | 'system';
  pushName: string | null;
  isAutoReply: boolean;
  timestamp: string;
}
const WA_INBOUND_TIMEOUT_MS = 55_000;
const OUTBOX = 'waInboundOutbox';
const OUTBOX_DEAD = 'waInboundOutboxDead';
const OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const OUTBOX_BATCH = 25;
/** Idempotency keys with an attempt in flight — never two concurrent deliveries of one event. */
const outboxInFlight = new Set<string>();
const outboxPendingByAgent = new Map<string, number>();
let outboxDraining = false;

/** Person-to-person jids only: `@s.whatsapp.net` (phone) or `@lid` (privacy id). */
function isPersonJid(jid: string): boolean {
  return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid');
}

/** E.164 is 8–15 digits; WhatsApp channel/group ids are longer (1203…, 18 digits). */
function isPlausiblePhone(digits: string): boolean {
  const d = String(digits || '').replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15;
}

const outboxDocId = (key: string) => key.replace(/\//g, '_').slice(0, 700);

/** 'ok' = delivered, 'rejected' = 4xx (the payload is wrong, retrying cannot fix it), 'retry' = try again later. */
async function deliverWaEvent(event: WaEventPayload, key: string): Promise<{ result: 'ok' | 'rejected' | 'retry'; error?: string }> {
  try {
    const res = await fetch(`${CRM_BASE_URL}/api/wa-inbound`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(WA_INBOUND_TIMEOUT_MS),
    });
    if (res.ok) return { result: 'ok' };
    const text = await res.text().catch(() => '');
    const error = `HTTP ${res.status} ${text.slice(0, 200)}`;
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) return { result: 'rejected', error };
    return { result: 'retry', error };
  } catch (err) {
    return { result: 'retry', error: (err as Error)?.message || String(err) };
  }
}

async function moveToDead(ref: admin.firestore.DocumentReference, data: Record<string, any>, why: string): Promise<void> {
  await db.collection(OUTBOX_DEAD).doc(ref.id).set({ ...data, deadReason: why, deadAt: nowTs() }).catch(() => {});
  await ref.delete().catch(() => {});
  const a = String(data.agentId || '');
  if (a) outboxPendingByAgent.set(a, Math.max(0, (outboxPendingByAgent.get(a) || 1) - 1));
}

async function postWaEvent(event: WaEventPayload, key: string): Promise<void> {
  if (!CRM_BASE_URL || !CRON_SECRET) return;
  if (outboxInFlight.has(key)) return;
  outboxInFlight.add(key);
  const label = `${event.direction} ${event.phone ? maskPhone(event.phone) : maskJid(event.jid)} ${event.waMessageId}`;
  try {
    const r = await deliverWaEvent(event, key);
    if (r.result === 'ok') return;
    if (r.result === 'rejected') { console.error(`[WA→CRM] wa-inbound "${label}" u refuzua: ${r.error}`); return; }
    try {
      await db.collection(OUTBOX).doc(outboxDocId(key)).set({
        key, agentId: event.agentId || null, teamId: event.teamId, payload: event,
        attempts: 1, lastError: r.error || null,
        createdAt: nowTs(),
        nextAttemptAt: admin.firestore.Timestamp.fromMillis(Date.now() + 120_000), // the api re-admits a failed claim after 2 min
      });
      if (event.agentId) outboxPendingByAgent.set(event.agentId, (outboxPendingByAgent.get(event.agentId) || 0) + 1);
      console.warn(`[WA→CRM] wa-inbound "${label}" dështoi (${r.error}) — në outbox`);
    } catch (e) {
      console.error(`[WA→CRM] wa-inbound "${label}" dështoi DHE outbox-i nuk u shkrua:`, e);
    }
  } finally {
    outboxInFlight.delete(key);
  }
}

/** Every minute: retry due outbox rows (one drain at a time, rows in flight skipped). */
async function drainWaInboundOutbox(): Promise<void> {
  if (!CRM_BASE_URL || !CRON_SECRET || outboxDraining) return;
  outboxDraining = true;
  try {
    const snap = await db.collection(OUTBOX)
      .where('nextAttemptAt', '<=', admin.firestore.Timestamp.now())
      .orderBy('nextAttemptAt').limit(OUTBOX_BATCH).get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const key = String(data.key || doc.id);
      if (outboxInFlight.has(key)) continue;
      if (Date.now() - tsMs(data.createdAt) > OUTBOX_MAX_AGE_MS) {
        console.error(`[WA→CRM] outbox ${doc.id}: hoqa dorë pas 24 orësh (${data.attempts} prova, ${data.lastError || '—'})`);
        await moveToDead(doc.ref, data, 'expired');
        continue;
      }
      outboxInFlight.add(key);
      try {
        const r = await deliverWaEvent(data.payload as WaEventPayload, key);
        if (r.result === 'ok') {
          await doc.ref.delete();
          const a = String(data.agentId || '');
          if (a) outboxPendingByAgent.set(a, Math.max(0, (outboxPendingByAgent.get(a) || 1) - 1));
        } else if (r.result === 'rejected') {
          console.error(`[WA→CRM] outbox ${doc.id} u refuzua: ${r.error}`);
          await moveToDead(doc.ref, data, `rejected: ${r.error || ''}`.slice(0, 300));
        } else {
          const attempts = Number(data.attempts || 0) + 1;
          const delay = Math.min(60 * 60_000, 60_000 * 2 ** Math.min(attempts - 1, 6));
          await doc.ref.update({ attempts, lastError: r.error || null, nextAttemptAt: admin.firestore.Timestamp.fromMillis(Date.now() + delay) });
        }
      } finally {
        outboxInFlight.delete(key);
      }
    }
  } catch (e) {
    console.error('[WA→CRM] outbox drain dështoi:', e);
  } finally {
    outboxDraining = false;
  }
}

/** /status shows the outbox backlog per agent — an aggregate count, one read per 1000 rows. */
async function refreshOutboxCounts(): Promise<void> {
  for (const id of agents.keys()) {
    try {
      const c = await db.collection(OUTBOX).where('agentId', '==', id).count().get();
      outboxPendingByAgent.set(id, c.data().count);
    } catch { /* keep the previous estimate */ }
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
  // ── "Any expenses to add today?" to the finance people, 17:00 local ──
  // Wall-clock promise, so scheduleDailyInZone; the job skips weekends and is
  // idempotent per team/day (teamSettings.expenseReminderLastDate). NOT in run-all.
  scheduleDailyInZone(CRON_LOCAL_TZ, 17, 0, () => { void triggerCronJob('expense-daily-reminder'); });
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
  console.log(`[VPS Server]  → QR:      http://localhost:${PORT}/qr/{agentId}`);
  console.log(`[VPS Server]  → Sesionet: ${VPS_ROOT}\n`);

  startCronSchedulers();

  // The first load goes through the same reconciler as the live listener, so the
  // env-default rules (only while the collection is empty, never wiped) and the
  // "no teamId → not loaded" rule are one code path.
  try {
    const snap = await db.collection('whatsappAccounts').get();
    await reconcileAgents(snap.docs);
  } catch (e) { console.error('[VPS] Error loading agents:', e); }

  // From here on Firestore drives the agent set: a deleted or disabled account
  // is unloaded within seconds instead of living on until the next restart.
  watchAccounts();
  startWaMaintenance();
});
