// Strip `customerId` from task comments the CLIENT did not author.
//
// customerId on a taskComment IS the client-visibility switch: the portal reads
// `where customerId == mine` and the rules grant that read. useMutation.create
// used to auto-derive customerId from the parent task, which silently made every
// internal staff comment on a client-project task readable in the portal. The
// write paths are fixed (internal by default, opt-in "Dukshëm për klientin");
// this repairs the documents already stamped.
//
//   node scripts/fix-taskcomment-visibility.mjs          (dry-run)
//   node scripts/fix-taskcomment-visibility.mjs --apply
//
// Kept visible: senderType == 'client' (portal-authored). Everything else loses
// customerId and becomes internal again. If a staff reply was MEANT for the
// client, re-send it with the new checkbox.

import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

async function main() {
  console.log(`[taskComments visibility] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  const snap = await db.collection('taskComments').get();
  const exposed = snap.docs.filter(d => {
    const c = d.data();
    return c.customerId && c.senderType !== 'client';
  });
  console.log(`Gjithsej: ${snap.size} · të ekspozuara (customerId + jo nga klienti): ${exposed.length}`);
  if (!exposed.length) { console.log('Asgjë për të riparuar. ✓'); return; }

  for (const d of exposed) {
    const c = d.data();
    console.log(`  ${d.id}: task=${c.taskId} nga=${c.createdByUserId || '?'} → hiqet customerId (bëhet internal)`);
  }
  if (APPLY) {
    for (let i = 0; i < exposed.length; i += 400) {
      const batch = db.batch();
      exposed.slice(i, i + 400).forEach(d =>
        batch.update(d.ref, { customerId: FieldValue.delete(), updatedAt: Timestamp.now() }));
      await batch.commit();
    }
    console.log(`\nU riparuan ${exposed.length} komente. ✓`);
  } else {
    console.log('\nRun again with --apply to write.');
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e.code || '', e.details || e.message); process.exit(1); });
