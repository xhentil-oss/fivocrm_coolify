// Stamp an explicit `date` on legacy expense rows that have none.
//
// `getExpenseDate()` = `date || createdAt`, so these rows ARE booked in a month
// already — this only makes the booking date explicit and therefore editable
// (a bill entered in August for July cannot be corrected while the field is
// empty). The value written is exactly what every reader already infers, so no
// figure moves.
//
//   node scripts/backfill-expense-booking-date.mjs                 # dry run
//   node scripts/backfill-expense-booking-date.mjs --apply         # write
//   node scripts/backfill-expense-booking-date.mjs --apply --businessId=XXX
import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const APPLY = process.argv.includes('--apply');
const bidArg = process.argv.find(a => a.startsWith('--businessId='));
const ONLY_BID = bidArg ? bidArg.split('=')[1] : null;

const dt = (v) => { if (!v) return null; if (v.toDate) return v.toDate(); const d = new Date(v); return isNaN(d) ? null : d; };

let q = db.collection('expenses');
if (ONLY_BID) q = q.where('businessId', '==', ONLY_BID);
const snap = await q.get();

const targets = [];
const unfixable = [];
for (const doc of snap.docs) {
  const e = doc.data();
  if (e.date) continue;
  const created = dt(e.createdAt);
  if (!created) { unfixable.push({ id: doc.id, title: e.title }); continue; }
  targets.push({ ref: doc.ref, id: doc.id, title: e.title || '', category: e.category, amount: e.amount, created });
}

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${snap.size} expenses scanned, ${targets.length} missing an explicit date`);
for (const t of targets) {
  console.log(`  ${t.created.toISOString().slice(0, 10)}  ${String(t.amount).padStart(9)}  [${t.category}]  ${t.title.slice(0, 40)}`);
}
if (unfixable.length) {
  console.log(`\n${unfixable.length} rows have NO createdAt either — they need a date typed in the UI:`);
  for (const u of unfixable) console.log(`  ${u.id}  ${u.title}`);
}

if (!APPLY) {
  console.log('\nNothing written. Re-run with --apply to stamp `date = createdAt` on the rows above.');
  process.exit(0);
}

// `updatedAt` is deliberately NOT touched: `projectPnl.projectDate()` falls back
// to it, and the spend rollup finds work via `expenses.updatedAt` — bumping it
// here would drag rows into the current month's P&L and trigger a pointless
// rollup of every project.
let done = 0;
for (let i = 0; i < targets.length; i += 400) {
  const batch = db.batch();
  for (const t of targets.slice(i, i + 400)) {
    batch.update(t.ref, { date: Timestamp.fromDate(t.created), bookingDateBackfilledAt: Timestamp.now() });
    done++;
  }
  await batch.commit();
}
console.log(`\nStamped ${done} rows.`);
process.exit(0);
