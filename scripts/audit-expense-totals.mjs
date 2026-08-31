// READ-ONLY: reconcile the "Totali" on /app/expenses against the expense side of
// /app/finances, computing each exactly the way its page does.
//
//   ExpensesView "Shpenzime Totale" = every countable row  (Salary category INCLUDED)
//   Financat  "− Shpenzime të tjera" = calculateExpensesBetween (Salary EXCLUDED)
//                                     + "− Rrogat" from teamMembers.monthlySalary
//
// Nothing is written. Usage: node scripts/audit-expense-totals.mjs
import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const RATES = { EUR: 100, USD: 92, GBP: 118, ALL: 1, LEK: 1, '': 1 };
const toAll = (a, c) => (Number(a) || 0) * (RATES[(c || 'ALL').toUpperCase()] ?? 1);
const dt = (v) => { if (!v) return null; if (v.toDate) return v.toDate(); const d = new Date(v); return isNaN(d) ? null : d; };
const expDate = (e) => dt(e.date) || dt(e.createdAt);
const countable = (e) => e.approvalStatus !== 'Rejected';
const fmt = (n) => Math.round(n).toLocaleString('en-US');

const all = (await db.collection('expenses').get()).docs.map(d => ({ id: d.id, ...d.data() }));
const members = (await db.collection('teamMembers').get()).docs.map(d => ({ id: d.id, ...d.data() }));
const bizNames = new Map();
for (const d of (await db.collection('businesses').get()).docs) bizNames.set(d.id, d.data().name || d.id);
console.log(`expenses=${all.length}  teamMembers=${members.length}`);

const byBiz = new Map();
for (const e of all) {
  const k = e.businessId || '(NO businessId)';
  if (!byBiz.has(k)) byBiz.set(k, []);
  byBiz.get(k).push(e);
}

for (const [bid, list] of [...byBiz.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log('\n==================================================================');
  console.log(`BUSINESS ${bid}  (${bizNames.get(bid) || '-'})  rows=${list.length}`);
  const c = list.filter(countable);
  const salaryRows = c.filter(e => e.category === 'Salary');
  const salaryTotal = salaryRows.reduce((s, e) => s + toAll(e.amount, e.currency), 0);
  const viewTotal = c.reduce((s, e) => s + toAll(e.amount, e.currency), 0);
  console.log(`  Shpenzimet "Shpenzime Totale" (no filter): ${fmt(viewTotal)} ALL`);
  console.log(`  same rows minus Salary category:          ${fmt(viewTotal - salaryTotal)} ALL`);
  console.log(`  >> DELTA vs Financat basis:               ${fmt(salaryTotal)} ALL  (${salaryRows.length} Salary rows)`);
  console.log(`  rejected rows (in neither total):         ${list.length - c.length}`);

  const noDateAtAll = c.filter(e => !expDate(e));
  const noExplicitDate = list.filter(e => !e.date);
  const badCur = new Set(list.map(e => (e.currency || 'ALL').toUpperCase()).filter(x => !(x in RATES)));
  const inactive = c.filter(e => e.status && e.status !== 'Active');
  const submitted = c.filter(e => (e.approvalStatus || '') === 'Submitted');
  const future = c.filter(e => { const d = expDate(e); return d && d > new Date(); });
  const drift = list.filter(e => { const a = dt(e.date), b = dt(e.createdAt); return a && b && (a.getFullYear() !== b.getFullYear() || a.getMonth() !== b.getMonth()); });
  console.log(`  no explicit date field (booked by createdAt): ${noExplicitDate.length}`);
  console.log(`  NO usable date -> in Totali, absent from every chart/P&L: ${noDateAtAll.length} -> ${fmt(noDateAtAll.reduce((s, e) => s + toAll(e.amount, e.currency), 0))} ALL`);
  console.log(`  unknown currency codes: ${[...badCur].join(', ') || 'none'}`);
  console.log(`  countable rows status != Active: ${inactive.length} -> ${fmt(inactive.reduce((s, e) => s + toAll(e.amount, e.currency), 0))} ALL`);
  console.log(`  countable rows still Submitted:  ${submitted.length} -> ${fmt(submitted.reduce((s, e) => s + toAll(e.amount, e.currency), 0))} ALL`);
  console.log(`  countable rows dated in FUTURE:  ${future.length} -> ${fmt(future.reduce((s, e) => s + toAll(e.amount, e.currency), 0))} ALL`);
  console.log(`  date-month != createdAt-month:   ${drift.length}`);

  const mem = members.filter(m => m.businessId === bid);
  const payroll = mem.filter(m => m.status === 'Active').reduce((s, m) => s + (Number(m.monthlySalary) || 0), 0);
  const withHistory = mem.filter(m => Array.isArray(m.salaryHistory) && m.salaryHistory.length).length;
  console.log(`  payroll basis: ${mem.filter(m => m.status === 'Active').length} active members, ${fmt(payroll)} ALL/month, ${withHistory} with salaryHistory`);

  for (const Y of [2025, 2026]) {
    let cy = 0, fy = 0, sy = 0;
    const lines = [];
    for (let m = 0; m < 12; m++) {
      const inM = c.filter(e => { const d = expDate(e); return d && d.getFullYear() === Y && d.getMonth() === m; });
      if (!inM.length) continue;
      const chart = inM.reduce((s, e) => s + toAll(e.amount, e.currency), 0);
      const fin = inM.filter(e => e.category !== 'Salary').reduce((s, e) => s + toAll(e.amount, e.currency), 0);
      cy += chart; fy += fin; sy += chart - fin;
      lines.push(`   ${Y}-${String(m + 1).padStart(2, '0')}  Shpenzimet=${fmt(chart).padStart(11)}   Financat=${fmt(fin).padStart(11)}   delta=${fmt(chart - fin).padStart(9)}   +rroga=${fmt(payroll).padStart(9)}`);
    }
    if (!lines.length) continue;
    console.log(`  --- ${Y} per month ---`);
    lines.forEach(l => console.log(l));
    console.log(`   TOTAL  Shpenzimet=${fmt(cy)}   Financat=${fmt(fy)}   delta(Salary rows)=${fmt(sy)}`);
  }

  if (salaryRows.length) {
    console.log('  Salary-category rows (invisible on Financat, counted on Shpenzimet):');
    for (const e of salaryRows.slice(0, 20)) {
      const d = expDate(e);
      console.log(`    ${d ? d.toISOString().slice(0, 10) : 'no-date  '}  ${fmt(toAll(e.amount, e.currency)).padStart(10)} ALL  ${(e.title || '').slice(0, 40)} ${e.isRecurring ? '[rec]' : ''}${e.autoGenerated ? '[auto]' : ''}${e.memberId ? '' : ' [no memberId]'}`);
    }
    if (salaryRows.length > 20) console.log(`    ... +${salaryRows.length - 20} more`);
  }
}
process.exit(0);
