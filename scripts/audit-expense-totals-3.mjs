// READ-ONLY pass 3: (a) exact off-payroll salary rows, (b) how much fabricated
// payroll the year-2026 P&L charges for months before anyone was employed.
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
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const norm = (s) => String(s || '').trim().toLowerCase();

const BID = 'Ni4TMKwoSLARWwCILjTp';
const exps = (await db.collection('expenses').where('businessId', '==', BID).get()).docs.map(d => ({ id: d.id, ...d.data() }));
const mems = (await db.collection('teamMembers').where('businessId', '==', BID).get()).docs.map(d => ({ id: d.id, ...d.data() }));

// first-token name match, both directions
const tokens = new Set();
for (const m of mems) {
  for (const v of [m.displayName, m.email]) {
    if (!v) continue;
    norm(v).split(/[\s@.]+/).filter(t => t.length > 2).forEach(t => tokens.add(t));
  }
}
const sal = exps.filter(e => e.category === 'Salary' && e.approvalStatus !== 'Rejected');
const off = [];
for (const e of sal) {
  const t = norm(e.title).split(/\s+/).filter(Boolean);
  const hit = t.some(x => tokens.has(x)) || (e.memberId && mems.some(m => norm(m.userId) === norm(e.memberId)));
  if (!hit) off.push(e);
}
console.log('--- Salary rows for people NOT on the payroll list ---');
const byName = new Map();
for (const e of off) byName.set(e.title || '(pa titull)', (byName.get(e.title || '(pa titull)') || 0) + toAll(e.amount, e.currency));
for (const [k, v] of [...byName.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${fmt(v).padStart(9)} ALL  ${k}`);
console.log(`  TOTAL invisible on Financat: ${fmt(off.reduce((s, e) => s + toAll(e.amount, e.currency), 0))} ALL over ${off.length} rows`);

console.log('\n--- when did people / data start? ---');
const memCreated = mems.map(m => dt(m.createdAt)).filter(Boolean).sort((a, b) => a - b);
console.log(`  earliest teamMember createdAt: ${memCreated[0]?.toISOString().slice(0, 10)}  latest: ${memCreated.at(-1)?.toISOString().slice(0, 10)}`);
const expDates = exps.map(expDate).filter(Boolean).sort((a, b) => a - b);
console.log(`  earliest expense: ${expDates[0]?.toISOString().slice(0, 10)}`);
const biz = (await db.collection('businesses').doc(BID).get()).data();
console.log(`  business createdAt: ${dt(biz?.createdAt)?.toISOString().slice(0, 10)}  plan=${biz?.plan} status=${biz?.status}`);

console.log('\n--- year-2026 P&L fixed pool as computed by projectPnl ---');
const now = new Date();
const payroll = mems.filter(m => m.status === 'Active').reduce((s, m) => s + (Number(m.monthlySalary) || 0), 0);
let salaries = 0;
for (let m = 0; m <= now.getMonth(); m++) salaries += payroll; // no salaryHistory for 11/14 -> flat
const nonSalIn2026 = exps.filter(e => e.category !== 'Salary' && e.approvalStatus !== 'Rejected')
  .filter(e => { const d = expDate(e); return d && d.getFullYear() === 2026; });
const otherFixed = nonSalIn2026.filter(e => !e.projectId).reduce((s, e) => s + toAll(e.amount, e.currency), 0);
const direct = nonSalIn2026.filter(e => e.projectId).reduce((s, e) => s + toAll(e.amount, e.currency), 0);
console.log(`  rroga  (${now.getMonth() + 1} months x ${fmt(payroll)}): ${fmt(salaries)} ALL`);
console.log(`  fikse (non-project rows):               ${fmt(otherFixed)} ALL`);
console.log(`  kosto direkte (project rows):           ${fmt(direct)} ALL`);
console.log(`  => Financat total cost 2026:            ${fmt(salaries + otherFixed + direct)} ALL`);
const shpenzimet2026 = exps.filter(e => e.approvalStatus !== 'Rejected')
  .filter(e => { const d = expDate(e); return d && d.getFullYear() === 2026; })
  .reduce((s, e) => s + toAll(e.amount, e.currency), 0);
console.log(`  => Shpenzimet page total 2026:          ${fmt(shpenzimet2026)} ALL`);
console.log(`  => GAP:                                 ${fmt(salaries + otherFixed + direct - shpenzimet2026)} ALL`);
const recordedSal = sal.filter(e => { const d = expDate(e); return d && d.getFullYear() === 2026; })
  .reduce((s, e) => s + toAll(e.amount, e.currency), 0);
console.log(`  (payroll actually recorded as rows in 2026: ${fmt(recordedSal)} ALL — Financat charges ${fmt(salaries)})`);
process.exit(0);
