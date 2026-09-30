// READ-ONLY: pse (nuk) u faturua një retainer në një datë të caktuar.
//
//   node scripts/audit-retainer-billing.mjs                 → gjendja tani
//   node scripts/audit-retainer-billing.mjs --at=2026-09-25T08:00:00Z
//
// Për çdo projekt `isRecurring` (ose me `billingDayOfMonth`) printon fushat që
// motori lexon dhe ARSYEN e bllokimit sipas projectBillingBlockReason (pasqyrë
// e src/lib/finance/recurringBilling.ts) në çastin `--at`. Pastaj liston faturat
// automatike të periudhës dhe ekzekutimet e `platformJobRuns` (run-all /
// recurring-invoices) ±3 ditë rreth `--at`. Nuk shkruan asgjë.

import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const TZ = 'Europe/Tirane';
const atArg = process.argv.find((a) => a.startsWith('--at='));
const AT = atArg ? new Date(atArg.slice(5)) : new Date();
if (isNaN(AT.getTime())) { console.error('--at i pavlefshëm'); process.exit(1); }

const dt = (v) => (v?.toDate ? v.toDate() : (v ? new Date(v) : null));
const iso = (d) => (d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 16) : null);
const p2 = (n) => String(n).padStart(2, '0');
function zoned(d) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const [y, m, day] = f.format(d).split('-').map(Number);
  return { year: y, month: m, day };
}
function periodKey(freq, at) {
  const z = zoned(at);
  if (freq === 'weekly') {
    const m = new Date(Date.UTC(z.year, z.month - 1, z.day));
    const dow = m.getUTCDay();
    m.setUTCDate(m.getUTCDate() - (dow === 0 ? 6 : dow - 1));
    return `W${m.getUTCFullYear()}-${p2(m.getUTCMonth() + 1)}-${p2(m.getUTCDate())}`;
  }
  return `${z.year}-${p2(z.month)}`;
}
function blockReason(p, now) {
  if (!p.isRecurring) return 'not-recurring';
  const freq = p.recurringFrequency || 'monthly';
  if (!['weekly', 'monthly'].includes(freq)) return 'unsupported-frequency';
  if (p.status && ['Cancelled', 'Archived'].includes(p.status)) return 'terminal-status';
  const end = dt(p.recurringEndDate);
  if (end && now > end) return 'series-ended';
  if (p.isRecurringPaused) return 'paused';
  if (p.billingType === 'one-time') return 'one-time';
  const key = periodKey(freq, now);
  if (p.lastInvoicePeriodKey) { if (p.lastInvoicePeriodKey === key) return 'already-billed'; }
  else { const last = dt(p.lastInvoiceGeneratedAt); if (last && periodKey(freq, last) === key) return 'already-billed'; }
  if (freq === 'monthly' && p.billingDayOfMonth) {
    const z = zoned(now);
    const lastDay = new Date(Date.UTC(z.year, z.month, 0)).getUTCDate();
    const day = Math.min(Math.max(1, Math.round(Number(p.billingDayOfMonth))), lastDay);
    if (z.day < day) return 'before-billing-day';
  }
  if (!(Number(p.budget) > 0)) return 'zero-budget (nuk faturohet, vetëm njoftim)';
  return null;
}

console.log(`Vlerësim në: ${AT.toISOString()}  (periudha ${periodKey('monthly', AT)})\n`);

const [recSnap, daySnap, bizSnap] = await Promise.all([
  db.collection('projects').where('isRecurring', '==', true).get(),
  db.collection('projects').where('billingDayOfMonth', '>', 0).get(),
  db.collection('businesses').get(),
]);
const bizStatus = new Map(bizSnap.docs.map((d) => [d.id, `${d.data().name || d.id} [${d.data().status || 'pa status'}]`]));
const projects = new Map();
for (const d of [...recSnap.docs, ...daySnap.docs]) projects.set(d.id, d);
console.log(`Projekte periodike / me ditë faturimi: ${projects.size}`);
const byReason = {};
for (const d of projects.values()) {
  const p = d.data();
  const reason = blockReason(p, AT) ?? 'DO TË FATUROHEJ';
  byReason[reason] = (byReason[reason] || 0) + 1;
  console.log(`\n· ${p.name}  (${d.id})`);
  console.log(`  biznes: ${bizStatus.get(p.businessId) || p.businessId}   status: ${p.status}   isRecurring: ${p.isRecurring}   paused: ${!!p.isRecurringPaused}`);
  console.log(`  billingType: ${p.billingType ?? '—'}   freq: ${p.recurringFrequency ?? 'monthly'}   dita: ${p.billingDayOfMonth ?? '—'}   buxheti: ${p.budget ?? '—'} ${p.currency ?? ''}`);
  console.log(`  lastInvoicePeriodKey: ${p.lastInvoicePeriodKey ?? '—'}   lastInvoiceGeneratedAt: ${iso(dt(p.lastInvoiceGeneratedAt)) ?? '—'}   endDate: ${iso(dt(p.recurringEndDate)) ?? '—'}`);
  console.log(`  stoppedReason: ${p.recurringBillingStoppedReason ?? '—'}   billingLastBlock: ${p.billingLastBlock ?? '—'}   periudha të kapërcyera: ${p.billingPeriodsSkipped ?? 0}`);
  console.log(`  ⇒ ${reason}`);
}
console.log('\nPërmbledhje sipas arsyes:', byReason);

// Faturat automatike të periudhës
const key = periodKey('monthly', AT);
const inv = await db.collection('invoices').where('billingPeriodKey', '==', key).get();
console.log(`\nFatura automatike me billingPeriodKey=${key}: ${inv.size}`);
for (const d of inv.docs) {
  const i = d.data();
  console.log(`  ${i.invoiceNumber}  projekt=${i.projectId}  ${i.total} ${i.currency}  ${i.status}  krijuar=${iso(dt(i.createdAt))}  email=${i.emailSent}`);
}

// Ekzekutimet e cron-it rreth datës
const from = new Date(AT.getTime() - 3 * 86400000), to = new Date(AT.getTime() + 3 * 86400000);
const runs = await db.collection('platformJobRuns').where('createdAt', '>=', from).where('createdAt', '<=', to).get();
console.log(`\nplatformJobRuns ${iso(from)} … ${iso(to)}: ${runs.size}`);
for (const d of runs.docs.sort((a, b) => dt(a.data().createdAt) - dt(b.data().createdAt))) {
  const r = d.data();
  if (!['run-all', 'recurring-invoices'].includes(r.job)) continue;
  const s = r.summary || {};
  const rec = Object.entries(s).filter(([k]) => k.startsWith('recurringInvoices')).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`  ${iso(dt(r.createdAt))}  ${r.job}  ok=${r.ok}  ${r.durationMs}ms  manual=${r.manual}  ${r.error ? 'GABIM: ' + r.error : ''}  ${rec}`);
}
console.log('\nNëse për 25-shin nuk ka asnjë rresht run-all: VPS-ja nuk e thirri (pm2 logs), ose Vercel e vrau para përgjigjes (60s).');
