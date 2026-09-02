// Read-only July 2026 reconciliation: recomputes the numbers exactly as the app
// does and cross-checks them for inconsistencies.
import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const Y = 2026, M = 6; // July
const START = new Date(Y, M, 1, 0, 0, 0, 0);
const END = new Date(Y, M + 1, 0, 23, 59, 59, 999);
const RATES = { EUR: 100, USD: 92, GBP: 118, ALL: 1, LEK: 1 };
const toAll = (a, c) => (Number(a) || 0) * (RATES[(c || 'ALL').toUpperCase()] ?? 1);
const dt = (v) => (v?.toDate ? v.toDate() : (v ? new Date(v) : null));
const inRange = (d) => !!d && d >= START && d <= END;
const fmt = (n) => Math.round(n).toLocaleString();

const ACCRUAL = ['Paid', 'Pending', 'Overdue', 'Partial'];

function collectedAll(i) {
  if (i.status === 'Draft' || i.status === 'Cancelled') return 0;
  if (i.status === 'Paid') return toAll(i.total ?? i.amount ?? 0, i.currency);
  if (Array.isArray(i.partialPayments) && i.partialPayments.length)
    return i.partialPayments.reduce((s, p) => s + toAll(p.amount ?? 0, i.currency), 0);
  return toAll(i.paidAmount ?? 0, i.currency);
}
function collectedBetween(i) {
  if (i.status === 'Draft' || i.status === 'Cancelled') return 0;
  if (i.status === 'Paid') return inRange(dt(i.paidAt) || dt(i.createdAt)) ? toAll(i.total ?? i.amount ?? 0, i.currency) : 0;
  if (Array.isArray(i.partialPayments) && i.partialPayments.length)
    return i.partialPayments.reduce((s, p) => s + (inRange(dt(p.paidAt)) ? toAll(p.amount ?? 0, i.currency) : 0), 0);
  return inRange(dt(i.paidAt) || dt(i.createdAt)) ? toAll(i.paidAmount ?? 0, i.currency) : 0;
}
function billedBetween(i) {
  if (!ACCRUAL.includes(i.status)) return 0;
  return inRange(dt(i.invoiceDate) || dt(i.createdAt)) ? toAll(i.total ?? i.amount ?? 0, i.currency) : 0;
}

async function main() {
  const [invS, expS, memS, projS] = await Promise.all([
    db.collection('invoices').get(), db.collection('expenses').get(),
    db.collection('teamMembers').get(), db.collection('projects').get(),
  ]);
  const invs = invS.docs.map(d => ({ id: d.id, ...d.data() }));
  const exps = expS.docs.map(d => ({ id: d.id, ...d.data() }));
  const mems = memS.docs.map(d => d.data());
  const projs = projS.docs.map(d => ({ id: d.id, ...d.data() }));

  console.log('════════ KORRIK 2026 — RAKORDIM ════════\n');

  // ── REVENUE ──
  const collected = invs.reduce((s, i) => s + collectedBetween(i), 0);
  const billed = invs.reduce((s, i) => s + billedBetween(i), 0);
  const julyInvoices = invs.filter(i => inRange(dt(i.invoiceDate) || dt(i.createdAt)));
  console.log('TË ARDHURA');
  console.log(`  Arkëtuar (cash, hyri në Korrik)  : ${fmt(collected)}`);
  console.log(`  Faturuar (akrual, lëshuar Korrik): ${fmt(billed)}`);
  console.log(`  Diferenca (papaguara nga Korriku): ${fmt(billed - collected)}`);
  console.log(`  Fatura me datë Korrik: ${julyInvoices.length}`);
  const byStatus = {};
  julyInvoices.forEach(i => { byStatus[i.status] = (byStatus[i.status] || 0) + toAll(i.total ?? i.amount ?? 0, i.currency); });
  Object.entries(byStatus).forEach(([s, v]) => console.log(`     ${s}: ${fmt(v)}`));

  // ── EXPENSES ──
  const expJuly = exps.filter(e => e.approvalStatus !== 'Rejected' && inRange(dt(e.date) || dt(e.createdAt)));
  const salaryCat = expJuly.filter(e => e.category === 'Salary');
  const nonSalary = expJuly.filter(e => e.category !== 'Salary');
  const nonSalaryTotal = nonSalary.reduce((s, e) => s + toAll(e.amount, e.currency), 0);
  const salaryCatTotal = salaryCat.reduce((s, e) => s + toAll(e.amount, e.currency), 0);
  const payroll = mems.filter(m => m.status === 'Active').reduce((s, m) => s + (Number(m.monthlySalary) || 0), 0);

  console.log('\nSHPENZIME');
  console.log(`  Jo-rrogë (numërohen në P&L)      : ${fmt(nonSalaryTotal)}  (${nonSalary.length} rreshta)`);
  console.log(`  Kategoria "Salary" (PËRJASHTOHET): ${fmt(salaryCatTotal)}  (${salaryCat.length} rreshta)`);
  console.log(`  Listëpagesa nga teamMembers      : ${fmt(payroll)}  (${mems.filter(m => m.status === 'Active').length} aktivë)`);
  console.log(`  → P&L përdor: jo-rrogë + listëpagesë = ${fmt(nonSalaryTotal + payroll)}`);
  if (Math.abs(salaryCatTotal - payroll) > 1000) {
    console.log(`  ⚠ MOSPËRPUTHJE: rreshtat "Salary" (${fmt(salaryCatTotal)}) ≠ listëpagesa (${fmt(payroll)}) → dif ${fmt(salaryCatTotal - payroll)}`);
  }

  // ── PROFIT ──
  const profit = collected - nonSalaryTotal - payroll;
  console.log('\nFITIMI (si e llogarit faqja Financat)');
  console.log(`  Arkëtuar ${fmt(collected)} − shpenzime ${fmt(nonSalaryTotal)} − rroga ${fmt(payroll)} = ${fmt(profit)}`);

  // ── LINKAGE CHECKS ──
  console.log('\nKONTROLLE KOHERENCE');
  const noProject = julyInvoices.filter(i => !i.projectId && ACCRUAL.includes(i.status));
  const noProjectVal = noProject.reduce((s, i) => s + toAll(i.total ?? i.amount ?? 0, i.currency), 0);
  console.log(`  Fatura Korriku PA projekt: ${noProject.length} → ${fmt(noProjectVal)} (nuk hyjnë te fitimi per-projekt/departament)`);
  const noInvoiceDate = julyInvoices.filter(i => !i.invoiceDate).length;
  console.log(`  Fatura pa invoiceDate: ${noInvoiceDate}`);
  const noCurrency = julyInvoices.filter(i => !i.currency).length;
  console.log(`  Fatura pa currency: ${noCurrency}`);
  const noDept = projs.filter(p => !p.department).length;
  console.log(`  Projekte pa departament: ${noDept} / ${projs.length}`);
  const expNoProject = nonSalary.filter(e => !e.projectId).reduce((s, e) => s + toAll(e.amount, e.currency), 0);
  console.log(`  Shpenzime Korriku pa projekt (overhead): ${fmt(expNoProject)} nga ${fmt(nonSalaryTotal)}`);

  // Backfilled rows
  const bf = expJuly.filter(e => e.backfill === 'july-2026');
  console.log(`  Rreshta backfill: ${bf.length} → ${fmt(bf.reduce((s, e) => s + toAll(e.amount, e.currency), 0))}`);
  const bfSalary = bf.filter(e => e.category === 'Salary');
  if (bfSalary.length) console.log(`     nga to "Salary" (s'ndikojnë P&L): ${bfSalary.length} → ${fmt(bfSalary.reduce((s, e) => s + toAll(e.amount, e.currency), 0))}`);

  // Duplicate expense rows in July
  const seen = new Map();
  expJuly.forEach(e => {
    const k = `${(e.title || '').trim().toLowerCase()}|${e.amount}|${e.currency || 'ALL'}`;
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(e);
  });
  const dupExp = [...seen.entries()].filter(([, a]) => a.length > 1);
  console.log(`  Shpenzime të dyfishta në Korrik: ${dupExp.length} grupe`);
  dupExp.forEach(([k, a]) => console.log(`     ⚠ ${a[0].title} × ${a.length} = ${fmt(Number(a[0].amount) * (a.length - 1))} tepricë`));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
