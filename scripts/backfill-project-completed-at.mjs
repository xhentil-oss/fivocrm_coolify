// One-off: stamp `lastCompletedAt` on projects that are already Completed but
// never recorded a completion date (they were closed manually before the app
// started stamping it). Without it a one-time project's revenue is recognised on
// `updatedAt`, which drifts on any later edit.
//
// Best available date, in order:
//   1. the newest Done task's completion/update date  (closest to reality)
//   2. the project's own updatedAt                    (what the P&L uses today)
//
//   node scripts/backfill-project-completed-at.mjs          (dry-run)
//   node scripts/backfill-project-completed-at.mjs --apply

import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const dt = (v) => (v?.toDate ? v.toDate() : (v ? new Date(v) : null));
const day = (d) => (d ? d.toISOString().slice(0, 10) : '—');

async function main() {
  console.log(`[completedAt] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  // Only Completed projects — a targeted query, not a full-collection scan.
  const projSnap = await db.collection('projects').where('status', '==', 'Completed').get();
  const targets = projSnap.docs.filter(d => !d.data().lastCompletedAt);
  console.log(`Projekte Completed: ${projSnap.size} | pa lastCompletedAt: ${targets.length}`);
  if (!targets.length) { console.log('Asgjë për të rregulluar. ✓'); return; }

  let fromTask = 0, fromUpdated = 0;
  for (const doc of targets) {
    const p = doc.data();
    // Newest Done task for this project (scoped query per project).
    let best = null;
    try {
      const tasks = await db.collection('tasks')
        .where('projectId', '==', doc.id).where('status', '==', 'Done').get();
      tasks.docs.forEach(t => {
        const d = dt(t.data().completedAt) || dt(t.data().updatedAt);
        if (d && (!best || d > best)) best = d;
      });
    } catch { /* fall through to updatedAt */ }

    const source = best ? 'detyra e fundit' : 'updatedAt';
    const when = best || dt(p.updatedAt) || dt(p.createdAt);
    if (!when) { console.log(`  ⚠ "${p.name}" — s'ka asnjë datë të përdorshme, u kapërcye`); continue; }
    if (best) fromTask++; else fromUpdated++;

    console.log(`  ${APPLY ? 'SET' : 'WOULD SET'}: "${p.name}" → ${day(when)}  (burimi: ${source}, buxhet ${p.budget ?? 0}, ${p.billingType || '—'})`);
    if (APPLY) {
      await doc.ref.update({
        lastCompletedAt: Timestamp.fromDate(when),
        completedAtBackfilled: true,   // traceable / reversible
      });
    }
  }

  console.log(`\nBurimi: ${fromTask} nga detyrat · ${fromUpdated} nga updatedAt`);
  if (!APPLY) console.log('Run again with --apply to write.');
}
main().then(() => process.exit(0)).catch(e => { console.error(e.code || '', e.details || e.message); process.exit(1); });
