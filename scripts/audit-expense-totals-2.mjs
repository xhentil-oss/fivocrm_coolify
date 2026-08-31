// READ-ONLY pass 2: split the Salary-category expense rows into
//   (a) rows for a real teamMember  -> legitimately excluded (payroll covers them)
//   (b) rows for someone who is NOT on payroll (freelancer/model) -> money that
//       appears on NO Financat line at all.
// Also compares recorded salary payments against the monthlySalary basis Financat uses.
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

console.log('--- team members (payroll basis Financat uses) ---');
for (const m of mems) {
  console.log(`  ${m.status.padEnd(8)} ${fmt(m.monthlySalary || 0).padStart(9)} ALL/mo  ${(m.displayName || m.email || m.userId || '').slice(0, 34)}  hist=${(m.salaryHistory || []).length}`);
}
const active = mems.filter(m => m.status === 'Active');
console.log(`  => payroll charged by Financat: ${fmt(active.reduce((s, m) => s + (Number(m.monthlySalary) || 0), 0))} ALL every month\n`);

const memberKeys = new Set();
for (const m of mems) { [m.userId, m.email, m.displayName].forEach(v => { if (v) memberKeys.add(norm(v)); }); }

const sal = exps.filter(e => e.category === 'Salary' && e.approvalStatus !== 'Rejected');
let onPayroll = 0, offPayroll = 0;
const offRows = [];
for (const e of sal) {
  const amt = toAll(e.amount, e.currency);
  const matched = (e.memberId && memberKeys.has(norm(e.memberId))) || memberKeys.has(norm(e.title));
  if (matched) onPayroll += amt; else { offPayroll += amt; offRows.push(e); }
}
console.log('--- Salary-category expense rows ---');
console.log(`  rows matching a teamMember (payroll already covers them): ${fmt(onPayroll)} ALL`);
console.log(`  rows matching NOBODY on payroll  -> invisible on Financat: ${fmt(offPayroll)} ALL  (${offRows.length} rows)`);
const byName = new Map();
for (const e of offRows) {
  const k = e.title || '(pa titull)';
  byName.set(k, (byName.get(k) || 0) + toAll(e.amount, e.currency));
}
for (const [k, v] of [...byName.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${fmt(v).padStart(9)} ALL  ${k}`);

console.log('\n--- recorded salary payments per month vs the flat payroll figure ---');
const payroll = active.reduce((s, m) => s + (Number(m.monthlySalary) || 0), 0);
for (let m = 0; m < 12; m++) {
  const rows = sal.filter(e => { const d = expDate(e); return d && d.getFullYear() === 2026 && d.getMonth() === m; });
  if (!rows.length) continue;
  const paid = rows.reduce((s, e) => s + toAll(e.amount, e.currency), 0);
  console.log(`  2026-${String(m + 1).padStart(2, '0')}  recorded=${fmt(paid).padStart(9)}  Financat charges=${fmt(payroll).padStart(9)}  diff=${fmt(paid - payroll).padStart(10)}`);
}

console.log('\n--- rows with no explicit `date` (booked on createdAt) ---');
const nod = exps.filter(e => !e.date);
console.log(`  ${nod.length} rows, ${fmt(nod.reduce((s, e) => s + toAll(e.amount, e.currency), 0))} ALL`);
for (const e of nod.slice(0, 10)) console.log(`    created ${dt(e.createdAt)?.toISOString().slice(0, 10)}  ${fmt(toAll(e.amount, e.currency)).padStart(9)} ALL  ${(e.title || '').slice(0, 40)}  [${e.category}]`);

console.log('\n--- countable but still Submitted (unapproved, yet in every total) ---');
const sub = exps.filter(e => (e.approvalStatus || '') === 'Submitted');
for (const e of sub) console.log(`    ${expDate(e)?.toISOString().slice(0, 10)}  ${fmt(toAll(e.amount, e.currency)).padStart(9)} ALL  ${(e.title || '').slice(0, 40)}  [${e.category}]`);

console.log('\n--- project-linked (direct) vs overhead, countable non-Salary ---');
const nonSal = exps.filter(e => e.category !== 'Salary' && e.approvalStatus !== 'Rejected');
const direct = nonSal.filter(e => e.projectId);
console.log(`  direct: ${direct.length} rows ${fmt(direct.reduce((s, e) => s + toAll(e.amount, e.currency), 0))} ALL`);
console.log(`  overhead: ${nonSal.length - direct.length} rows ${fmt(nonSal.filter(e => !e.projectId).reduce((s, e) => s + toAll(e.amount, e.currency), 0))} ALL`);
const projIds = new Set((await db.collection('projects').where('businessId', '==', BID).get()).docs.map(d => d.id));
const orphan = direct.filter(e => !projIds.has(e.projectId));
console.log(`  direct rows pointing at a DELETED/unknown project: ${orphan.length} -> ${fmt(orphan.reduce((s, e) => s + toAll(e.amount, e.currency), 0))} ALL`);

console.log('\n--- category mix (countable) ---');
const cat = new Map();
for (const e of exps.filter(e => e.approvalStatus !== 'Rejected')) {
  cat.set(e.category || '(none)', (cat.get(e.category || '(none)') || 0) + toAll(e.amount, e.currency));
}
for (const [k, v] of [...cat.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).padEnd(14)} ${fmt(v).padStart(11)} ALL`);
process.exit(0);
