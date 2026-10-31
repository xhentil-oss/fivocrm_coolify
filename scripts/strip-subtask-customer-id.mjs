// Nulls `customerId` on every SUBTASK (`parentTaskId` set).
//
// `customerId` on a task IS the portal-visibility switch (the portal reads
// `customerId == mine` and the rules grant it), and the portal never shows a
// subtask (every portal list filters `!parentTaskId`). useMutation.create and
// TaskSubtasksSection used to stamp the project's / parent's customerId on
// subtasks anyway, so every subtask document (description, attachments, value,
// estimatedHours, approval history) was readable in the client's browser. The
// write paths are fixed (audit A5, Oct 2026); this repairs the documents
// already stamped.
//
//   node scripts/strip-subtask-customer-id.mjs                  (dry-run)
//   node scripts/strip-subtask-customer-id.mjs --apply
//   node scripts/strip-subtask-customer-id.mjs --business <bid> (one tenant)
//
// Needs scripts/sa.json (service account). Read-only unless --apply is passed.
import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const bIdx = args.indexOf('--business');
const onlyBusiness = bIdx >= 0 ? args[bIdx + 1] : null;

const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

async function main() {
  console.log(`[subtask customerId] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}${onlyBusiness ? ` business=${onlyBusiness}` : ''}`);
  let scanned = 0, exposed = 0, fixed = 0;
  const perBusiness = new Map();
  let last = null;
  for (;;) {
    // Every task with a parent, in id order, 500 at a time (no composite index needed).
    let q = db.collection('tasks').where('parentTaskId', '!=', null).orderBy('parentTaskId').limit(500);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    let batch = db.batch();
    let inBatch = 0;
    for (const d of snap.docs) {
      scanned++;
      const t = d.data();
      if (!t.parentTaskId) continue;
      if (onlyBusiness && t.businessId !== onlyBusiness) continue;
      if (t.customerId === undefined || t.customerId === null || t.customerId === '') continue;
      exposed++;
      const key = t.businessId || t.teamId || '(none)';
      perBusiness.set(key, (perBusiness.get(key) || 0) + 1);
      if (exposed <= 40) console.log(`  ${d.id}: parent=${t.parentTaskId} customer=${t.customerId} "${String(t.title || '').slice(0, 50)}"`);
      if (APPLY) {
        // `updatedAt` is left alone on purpose: this is a repair, not an edit.
        batch.update(d.ref, { customerId: null, customerIdStrippedAt: FieldValue.serverTimestamp() });
        inBatch++;
        if (inBatch >= 400) { await batch.commit(); fixed += inBatch; batch = db.batch(); inBatch = 0; }
      }
    }
    if (APPLY && inBatch > 0) { await batch.commit(); fixed += inBatch; }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 500) break;
  }
  console.log(`\nNën-detyra të skanuara: ${scanned} · me customerId (të ekspozuara): ${exposed}`);
  for (const [b, n] of perBusiness) console.log(`  ${b}: ${n}`);
  if (APPLY) console.log(`U riparuan: ${fixed} ✓`);
  else if (exposed) console.log('Dry-run — rishkruaj me --apply për t\'i riparuar.');
  else console.log('Asgjë për të riparuar. ✓');
}

main().catch(err => { console.error(err); process.exit(1); });
