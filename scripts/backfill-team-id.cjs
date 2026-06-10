// Backfill `teamId` on documents that are missing it, so the Firestore read
// rules can later be tightened from `allow read: if isAuth()` to
// `allow read: if isTeamMember(resource.data.teamId)` (see
// workspace/SECURITY_RULES_MIGRATION.md).
//
// Inference order for each doc lacking teamId:
//   1. createdByUserId  -> users/{uid}.teamId
//   2. assignedToUserId -> users/{uid}.teamId
//   3. related customer (customerId) -> customers/{id}.teamId
//   4. --default-team <id> fallback (only if provided)
//
// SAFETY: dry-run by default. Nothing is written unless you pass --apply.
//
// Usage:
//   node scripts/backfill-team-id.cjs                 # dry-run, all collections
//   node scripts/backfill-team-id.cjs --apply         # actually write
//   node scripts/backfill-team-id.cjs --only invoices,customers
//   node scripts/backfill-team-id.cjs --default-team TEAM_ID --apply
//
// Credentials: scripts/sa.json if present, else FIREBASE_* in ../.env.vercel.local
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// ── args ──
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx >= 0 ? (args[onlyIdx + 1] || '').split(',').map(s => s.trim()).filter(Boolean) : null;
const defIdx = args.indexOf('--default-team');
const DEFAULT_TEAM = defIdx >= 0 ? args[defIdx + 1] : null;

// Collections whose docs should carry a teamId (mirrors teamScopedCollections
// in src/hooks/useFirestore.ts). Order chosen so reference sources resolve first.
const COLLECTIONS = [
  'customers', 'leads', 'invoices', 'invoiceItems', 'quotes', 'contracts', 'services',
  'projects', 'tasks', 'taskComments', 'taskCollaborators', 'milestones',
  'expenses', 'expenseCategories', 'goals', 'timeEntries', 'activities',
  'channels', 'messages', 'directMessages', 'clientRequests', 'serviceInquiries',
  'standups', 'dailyReports', 'customIndustries', 'serviceCategories',
  'workspaceFolders', 'workspaceDriveFiles', 'roleTemplates', 'chatSnippets',
];

// ── credentials (same convention as other scripts/) ──
const saPath = path.join(__dirname, 'sa.json');
let cred;
if (fs.existsSync(saPath)) {
  cred = admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8')));
} else {
  const envText = fs.readFileSync(path.join(__dirname, '..', '.env.vercel.local'), 'utf8');
  const env = {};
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=("(.*)"|(.*))$/);
    if (m) env[m[1]] = m[3] !== undefined ? m[3] : m[4];
  }
  cred = admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  });
}
admin.initializeApp({ credential: cred });
const db = admin.firestore();

// ── caches so we don't re-read the same user/customer repeatedly ──
const userTeamCache = new Map();   // uid -> teamId|null
const customerTeamCache = new Map(); // customerId -> teamId|null

async function userTeam(uid) {
  if (!uid) return null;
  if (userTeamCache.has(uid)) return userTeamCache.get(uid);
  let teamId = null;
  try {
    const s = await db.collection('users').doc(uid).get();
    if (s.exists) teamId = s.data().teamId || null;
  } catch { /* ignore */ }
  userTeamCache.set(uid, teamId);
  return teamId;
}

async function customerTeam(customerId) {
  if (!customerId) return null;
  if (customerTeamCache.has(customerId)) return customerTeamCache.get(customerId);
  let teamId = null;
  try {
    const s = await db.collection('customers').doc(customerId).get();
    if (s.exists) teamId = s.data().teamId || null;
  } catch { /* ignore */ }
  customerTeamCache.set(customerId, teamId);
  return teamId;
}

async function resolveTeamId(data) {
  return (
    (await userTeam(data.createdByUserId)) ||
    (await userTeam(data.assignedToUserId)) ||
    (await customerTeam(data.customerId)) ||
    DEFAULT_TEAM ||
    null
  );
}

async function processCollection(coll) {
  const snap = await db.collection(coll).get();
  let missing = 0, resolved = 0, unresolved = 0, written = 0;
  const unresolvedIds = [];
  let batch = db.batch();
  let batchCount = 0;

  for (const d of snap.docs) {
    const data = d.data();
    if (typeof data.teamId === 'string' && data.teamId) continue; // already scoped
    missing++;
    const teamId = await resolveTeamId(data);
    if (!teamId) { unresolved++; if (unresolvedIds.length < 10) unresolvedIds.push(d.id); continue; }
    resolved++;
    if (APPLY) {
      batch.update(d.ref, { teamId });
      batchCount++;
      if (batchCount >= 400) { await batch.commit(); written += batchCount; batch = db.batch(); batchCount = 0; }
    }
  }
  if (APPLY && batchCount > 0) { await batch.commit(); written += batchCount; }

  const tag = APPLY ? `wrote ${written}` : 'DRY-RUN';
  console.log(
    `${coll.padEnd(20)} total=${String(snap.size).padStart(5)}  missing=${String(missing).padStart(4)}  ` +
    `resolved=${String(resolved).padStart(4)}  unresolved=${String(unresolved).padStart(4)}  [${tag}]`
  );
  if (unresolved > 0) console.log(`    ↳ sample unresolved ids: ${unresolvedIds.join(', ')}${unresolved > unresolvedIds.length ? ', …' : ''}`);
  return { missing, resolved, unresolved };
}

(async () => {
  const list = ONLY ? COLLECTIONS.filter(c => ONLY.includes(c)) : COLLECTIONS;
  console.log(`\nteamId backfill — ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}${DEFAULT_TEAM ? `  default-team=${DEFAULT_TEAM}` : ''}\n`);
  let totals = { missing: 0, resolved: 0, unresolved: 0 };
  for (const c of list) {
    try {
      const r = await processCollection(c);
      totals.missing += r.missing; totals.resolved += r.resolved; totals.unresolved += r.unresolved;
    } catch (e) {
      console.log(`${c.padEnd(20)} ERROR: ${e.message}`);
    }
  }
  console.log(`\nTOTAL  missing=${totals.missing}  resolved=${totals.resolved}  unresolved=${totals.unresolved}`);
  if (!APPLY) console.log('\nDry-run only. Re-run with --apply to write. Resolve any "unresolved" docs first (pass --default-team if they belong to one org).');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
