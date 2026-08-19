// Add each valued task's value into its project's budget, once.
// Idempotent: only tasks without `valueAppliedToBudget` are counted, and each one
// is marked as it is applied — so re-running adds nothing.
//
//   node scripts/backfill-task-value-into-budget.mjs          (dry-run)
//   node scripts/backfill-task-value-into-budget.mjs --apply

import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

async function main() {
  console.log(`[task→budget] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  const tasks = await db.collection('tasks').get();
  const pending = tasks.docs
    .map(d => ({ id: d.id, ref: d.ref, ...d.data() }))
    .filter(t => Number(t.value) > 0 && !t.valueAppliedToBudget && t.projectId);

  const skipped = tasks.docs.filter(d => Number(d.data().value) > 0 && d.data().valueAppliedToBudget).length;
  const noProject = tasks.docs.filter(d => Number(d.data().value) > 0 && !d.data().projectId).length;
  console.log(`Detyra me vlerë: pa aplikuar=${pending.length} · tashmë të aplikuara=${skipped} · pa projekt=${noProject}`);
  if (!pending.length) { console.log('Asgjë për të shtuar. ✓'); return; }

  // Group by project so the log reads per project.
  const byProject = new Map();
  for (const t of pending) {
    if (!byProject.has(t.projectId)) byProject.set(t.projectId, []);
    byProject.get(t.projectId).push(t);
  }

  for (const [pid, list] of byProject) {
    const snap = await db.collection('projects').doc(pid).get();
    if (!snap.exists) { console.log(`  ⚠ projekti ${pid} nuk ekziston — ${list.length} detyra u kapërcyen`); continue; }
    const p = snap.data();
    // GUARD (mirrors src/lib/finance/taskValue.ts): a recurring project's
    // `budget` is its per-period fee — pushing task value into it raises every
    // future auto-invoice and double-bills work the task's own draft invoice
    // already carries. Flag such tasks as applied WITHOUT touching the budget.
    const billsRecurring = p.billingType === 'monthly' || (p.billingType !== 'one-time' && !!p.isRecurring);
    const add = list.reduce((s, t) => s + Number(t.value), 0);
    if (billsRecurring) {
      console.log(`\n  "${p.name}": projekt periodik — buxheti (tarifa) NUK preket; ${list.length} detyra (+${add.toLocaleString()}) u shënuan si të aplikuara`);
      if (APPLY) {
        for (const t of list) await t.ref.update({ valueAppliedToBudget: true });
      }
      continue;
    }
    console.log(`\n  "${p.name}": buxhet ${Number(p.budget || 0).toLocaleString()} → ${(Number(p.budget || 0) + add).toLocaleString()}  (+${add.toLocaleString()})`);
    list.forEach(t => console.log(`      ${t.title} +${Number(t.value).toLocaleString()}`));
    if (APPLY) {
      await snap.ref.update({ budget: FieldValue.increment(add), updatedAt: Timestamp.now() });
      for (const t of list) await t.ref.update({ valueAppliedToBudget: true });
    }
  }
  if (!APPLY) console.log('\nRun again with --apply to write.');
}
main().then(() => process.exit(0)).catch(e => { console.error(e.code || '', e.details || e.message); process.exit(1); });
