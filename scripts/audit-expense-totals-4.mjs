// READ-ONLY pass 4: replicate the FIXED logic (lib/finance/payroll.ts) against
// production data and show whether the two pages now reconcile, month by month.
import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const RATES = { EUR: 100, USD: 92, GBP: 118, ALL: 1, LEK: 1 };
const toAll = (a, c) => (Number(a) || 0) * (RATES[(c || 'ALL').toUpperCase()] ?? 1);
const dt = (v) => { if (!v) return null; if (v.toDate) return v.toDate(); const d = new Date(v); return isNaN(d) ? null : d; };
const expDate = (e) => dt(e.date) || dt(e.createdAt);
const ok = (e) => e.approvalStatus !== 'Rejected';
const fmt = (n) => Math.round(n).toLocaleString('en-US');

const BID = 'Ni4TMKwoSLARWwCILjTp';
const exps = (await db.collection('expenses').where('businessId', '==', BID).get()).docs.map(d => ({ id: d.id, ...d.data() }));
const mems = (await db.collection('teamMembers').where('businessId', '==', BID).get()).docs.map(d => ({ id: d.id, ...d.data() }));

// memberSalaryForMonth, with the new hire-date guard
const memberSalary = (m, monthEnd) => {
  if (m.status !== 'Active') return 0;
  const startD = dt(m.hiredAt) || dt(m.startDate) || dt(m.createdAt);
  if (startD && startD > monthEnd) return 0;
  const hist = (m.salaryHistory || []).map(h => ({ v: Number(h.monthlySalary) || 0, f: dt(h.effectiveFrom) }))
    .filter(h => h.f).sort((a, b) => a.f - b.f);
  if (hist.length) {
    let applicable = 0;
    for (const h of hist) { if (h.f <= monthEnd) applicable = h.v; else break; }
    return applicable;
  }
  return Number(m.monthlySalary) || 0;
};

console.log('MONTH   Shpenzimet(total)   Financat: rroga + të tjera = gjithsej   bazë        gap');
console.log('-------------------------------------------------------------------------------------');
let tShp = 0, tFin = 0;
for (let m = 0; m < 8; m++) {
  const s = new Date(2026, m, 1, 0, 0, 0, 0);
  const e = new Date(2026, m + 1, 0, 23, 59, 59, 999);
  const inM = exps.filter(x => ok(x)).filter(x => { const d = expDate(x); return d && d >= s && d <= e; });
  const shp = inM.reduce((a, x) => a + toAll(x.amount, x.currency), 0);
  const recorded = inM.filter(x => x.category === 'Salary').reduce((a, x) => a + toAll(x.amount, x.currency), 0);
  const other = inM.filter(x => x.category !== 'Salary').reduce((a, x) => a + toAll(x.amount, x.currency), 0);
  const plan = mems.reduce((a, x) => a + memberSalary(x, e), 0);
  const payroll = recorded > 0 ? recorded : plan;
  const basis = recorded > 0 ? 'pagesa' : (plan > 0 ? 'listë-pagave' : 'pa pagë');
  const fin = payroll + other;
  tShp += shp; tFin += fin;
  console.log(`2026-${String(m + 1).padStart(2, '0')} ${fmt(shp).padStart(14)}   ${fmt(payroll).padStart(9)} + ${fmt(other).padStart(8)} = ${fmt(fin).padStart(10)}   ${basis.padEnd(11)} ${fmt(fin - shp).padStart(9)}`);
}
console.log('-------------------------------------------------------------------------------------');
console.log(`TOTAL   ${fmt(tShp).padStart(14)}   ${' '.repeat(22)}${fmt(tFin).padStart(10)}   ${' '.repeat(11)} ${fmt(tFin - tShp).padStart(9)}`);
console.log('\n(gap != 0 only for a month with no recorded salary payments — the UI now labels that case)');

// year P&L fixed pool, new logic
let salaries = 0, fallback = 0;
for (let m = 0; m <= 7; m++) {
  const s = new Date(2026, m, 1, 0, 0, 0, 0);
  const e = new Date(2026, m + 1, 0, 23, 59, 59, 999);
  const rec = exps.filter(x => ok(x) && x.category === 'Salary')
    .filter(x => { const d = expDate(x); return d && d >= s && d <= e; })
    .reduce((a, x) => a + toAll(x.amount, x.currency), 0);
  const plan = mems.reduce((a, x) => a + memberSalary(x, e), 0);
  if (rec > 0) salaries += rec; else { salaries += plan; if (plan > 0) fallback++; }
}
const nonSal2026 = exps.filter(x => ok(x) && x.category !== 'Salary')
  .filter(x => { const d = expDate(x); return d && d.getFullYear() === 2026; });
const otherFixed = nonSal2026.filter(x => !x.projectId).reduce((a, x) => a + toAll(x.amount, x.currency), 0);
const direct = nonSal2026.filter(x => x.projectId).reduce((a, x) => a + toAll(x.amount, x.currency), 0);
console.log(`\nP&L 2026 (Jan-Aug): rroga ${fmt(salaries)} (${fallback} muaj nga lista) + fikse ${fmt(otherFixed)} + direkte ${fmt(direct)} = ${fmt(salaries + otherFixed + direct)}`);
console.log(`më parë:            rroga 6,160,000 + fikse ${fmt(otherFixed)} + direkte ${fmt(direct)} = ${fmt(6160000 + otherFixed + direct)}`);
process.exit(0);
