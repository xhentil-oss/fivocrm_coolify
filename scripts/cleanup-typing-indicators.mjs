// Removes leaked `typingIndicators` documents.
//
// Until Sep 2026 ChatView read typing indicators with an UNSCOPED list (channelId
// only) that the rules could not prove, so the list was empty for every non-super-
// admin — and the writer, finding "no existing doc of mine", CREATED a new one for
// every second of typing and never deleted any. This deletes every indicator whose
// `timestamp` is older than --older-than (default 5 minutes); a live indicator is
// refreshed every second and removed 3 s after the last keystroke, so anything
// older is garbage.
//
// Usage:
//   node scripts/cleanup-typing-indicators.mjs            # dry run: counts only
//   node scripts/cleanup-typing-indicators.mjs --apply    # delete
//   node scripts/cleanup-typing-indicators.mjs --apply --older-than 60   # seconds
//
// Needs scripts/sa.json (service account). Read-only unless --apply is passed.
import { readFileSync } from 'node:fs';
import admin from 'firebase-admin';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const idx = args.indexOf('--older-than');
const olderThanSec = idx >= 0 ? Number(args[idx + 1]) : 300;
if (!Number.isFinite(olderThanSec) || olderThanSec < 10) {
  console.error('--older-than must be a number of seconds >= 10');
  process.exit(1);
}

const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const toMs = (v) => (v?.toMillis ? v.toMillis() : v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : typeof v === 'number' ? v : NaN);

const cutoff = Date.now() - olderThanSec * 1000;
let scanned = 0, stale = 0, deleted = 0;
const perBusiness = new Map();

let last = null;
for (;;) {
  let q = db.collection('typingIndicators').orderBy(admin.firestore.FieldPath.documentId()).limit(500);
  if (last) q = q.startAfter(last);
  const snap = await q.get();
  if (snap.empty) break;
  const batch = db.batch();
  let inBatch = 0;
  for (const d of snap.docs) {
    scanned++;
    const x = d.data();
    const t = toMs(x.timestamp);
    // No timestamp at all = broken row, also garbage.
    if (Number.isNaN(t) || t < cutoff) {
      stale++;
      const key = x.businessId || x.teamId || '(none)';
      perBusiness.set(key, (perBusiness.get(key) || 0) + 1);
      if (apply) { batch.delete(d.ref); inBatch++; }
    }
  }
  if (apply && inBatch > 0) { await batch.commit(); deleted += inBatch; }
  last = snap.docs[snap.docs.length - 1];
  if (snap.size < 500) break;
}

console.log(`typingIndicators scanned: ${scanned}`);
console.log(`stale (older than ${olderThanSec}s or no timestamp): ${stale}`);
for (const [k, v] of [...perBusiness.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
console.log(apply ? `deleted: ${deleted}` : 'dry run — pass --apply to delete');
