// READ-ONLY: pse (nuk) u faturua një retainer në një datë të caktuar.
//
//   node scripts/audit-retainer-billing.mjs                 → gjendja tani
//   node scripts/audit-retainer-billing.mjs --at=2026-09-25T08:00:00Z
//   node scripts/audit-retainer-billing.mjs --generate=2026-09          → cilat retainer-ë s'kanë faturë shtatori
//   node scripts/audit-retainer-billing.mjs --generate=2026-09 --apply  → i KRIJON (pa email)
//
// --generate krijon për çdo retainer mujor aktiv pa faturë për atë periudhë
// saktësisht faturën që do shkruante cron-i Part 2 (id `auto_<projectId>_<periudha>`,
// create() — kurrë dy herë, rreshti invoiceItems, status Pending, emailSent false:
// pronari e dërgon me "Dërgo" pasi e kontrollon) dhe e çon pretendimin
// `lastInvoicePeriodKey` përpara vetëm nëse ka mbetur pas. Një muaj i mbyllur
// refuzohet. Ky është backfill-i që motori lë qëllimisht në dorë të pronarit.
//
// Për çdo projekt `isRecurring` (ose me `billingDayOfMonth`) printon fushat që
// motori lexon dhe ARSYEN e bllokimit sipas projectBillingBlockReason (pasqyrë
// e src/lib/finance/recurringBilling.ts) në çastin `--at`. Pastaj liston faturat
// automatike të periudhës dhe ekzekutimet e `platformJobRuns` (run-all /
// recurring-invoices) ±3 ditë rreth `--at`. Nuk shkruan asgjë.

import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const TZ = 'Europe/Tirane';
const atArg = process.argv.find((a) => a.startsWith('--at='));
const AT = atArg ? new Date(atArg.slice(5)) : new Date();
if (isNaN(AT.getTime())) { console.error('--at i pavlefshëm'); process.exit(1); }
const genArg = process.argv.find((a) => a.startsWith('--generate='));
const GENERATE = genArg ? genArg.slice(11) : null;
const APPLY = process.argv.includes('--apply');
if (GENERATE && !/^\d{4}-\d{2}$/.test(GENERATE)) { console.error('--generate duhet YYYY-MM'); process.exit(1); }

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

// ── --generate: faturat e një periudhe të kaluar, si do t'i bënte cron-i ─────
if (GENERATE) {
  const [gy, gm] = GENERATE.split('-').map(Number);
  const lastDay = new Date(Date.UTC(gy, gm, 0)).getUTCDate();
  /** Mesditë Europe/Tirane e ditës së kërkuar. */
  const zonedNoon = (y, m, day) => {
    const guess = new Date(Date.UTC(y, m - 1, day, 12));
    const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(guess));
    return new Date(guess.getTime() - (h - 12) * 3600_000);
  };
  const periodEnd = new Date(zonedNoon(gy, gm, lastDay).getTime() + 11 * 3600_000 + 59 * 60_000 + 59_000);
  const periodLabel = zonedNoon(gy, gm, 1).toLocaleDateString('sq-AL', { month: 'long', year: 'numeric', timeZone: TZ });
  const today = periodKey('monthly', new Date());
  if (GENERATE >= today) { console.error(`--generate duhet të jetë periudhë e KALUAR (sot: ${today}); periudhën aktuale e bën cron-i.`); process.exit(1); }

  console.log(`\n══ Faturat për ${GENERATE} (${periodLabel}) ${APPLY ? '*** APPLY ***' : '— vetëm lexim, shto --apply'} ══`);
  const closeCache = new Map();
  const monthLocked = async (bid) => {
    const k = `${bid}_${GENERATE}`;
    if (!closeCache.has(k)) { const sn = await db.collection('financeMonthCloses').doc(k).get(); closeCache.set(k, !!(sn.exists && sn.data().locked)); }
    return closeCache.get(k);
  };
  const gen = {};
  const tally = (r) => { gen[r] = (gen[r] || 0) + 1; };
  let made = 0;
  for (const d of projects.values()) {
    const p = d.data();
    const freq = p.recurringFrequency || 'monthly';
    let why = null;
    if (!p.isRecurring) why = 'not-recurring';
    else if (freq !== 'monthly') why = `frekuencë ${freq} (vetëm mujoret)`;
    else if (p.status && ['Cancelled', 'Archived'].includes(p.status)) why = 'terminal-status';
    else if (p.isRecurringPaused) why = 'paused';
    else if (p.billingType === 'one-time') why = 'one-time';
    else if (!(Number(p.budget) > 0)) why = 'zero-budget';
    else {
      const created = dt(p.createdAt);
      if (created && periodKey('monthly', created) > GENERATE) why = 'projekti u krijua pas kësaj periudhe';
      const end = dt(p.recurringEndDate);
      if (!why && end && periodKey('monthly', end) < GENERATE) why = 'series-ended';
    }
    if (!why) {
      const existing = await db.collection('invoices').where('projectId', '==', d.id).where('billingPeriodKey', '==', GENERATE).limit(1).get();
      if (!existing.empty) why = `OK — ekziston (${existing.docs[0].data().invoiceNumber})`;
      else if (p.lastInvoicePeriodKey === GENERATE) why = 'pretendimi ekziston por fatura jo (fshirë me dorë?)';
    }
    const missing = !why;
    tally(missing ? 'MUNGON' : (why.startsWith('OK') ? 'OK' : why));
    console.log(`· ${p.name}  ${p.budget ?? '—'} ${p.currency ?? 'ALL'}  ⇒ ${why ?? 'MUNGON'}`);
    if (!missing || !APPLY) continue;
    if (await monthLocked(p.businessId)) { console.log('  ✗ muaji është i mbyllur (financeMonthCloses.locked) — rihape në Financat para se ta krijosh'); tally('month-closed'); continue; }

    const day = Math.min(Number(p.billingDayOfMonth) || 1, lastDay);
    const invoiceDate = zonedNoon(gy, gm, day);
    const budget = Number(p.budget);
    const currency = p.currency === 'EUR' ? 'EUR' : 'ALL';
    const invoiceLabel = `AUTO-${GENERATE}-${d.id.slice(0, 6).toUpperCase()}`;
    const ref = db.collection('invoices').doc(`auto_${d.id}_${GENERATE}`);
    const now = Timestamp.now();
    const invoice = {
      invoiceNumber: invoiceLabel, projectId: d.id, customerId: p.customerId || null, teamId: p.teamId || null, businessId: p.businessId || null,
      amount: budget, subtotal: budget, total: budget, tax: 0, discount: 0, discountType: 'fixed', currency, status: 'Pending',
      notes: `Faturë e gjeneruar automatikisht për projektin periodik "${p.name}" – ${periodLabel}.`,
      invoiceDate: Timestamp.fromDate(invoiceDate), dueDate: Timestamp.fromDate(periodEnd),
      isRecurring: false, autoGenerated: true, billingPeriodKey: GENERATE,
      emailSent: false, reminderSent: false, reminder25Sent: false, reminderLastDaySent: false,
      createdByUserId: p.createdByUserId || null, createdAt: now, updatedAt: now,
      backfilledBy: 'scripts/audit-retainer-billing.mjs',
    };
    try { await ref.create(invoice); } catch (err) {
      if (String(err?.code) === '6' || /ALREADY_EXISTS/i.test(String(err?.message))) { console.log('  = ekzistonte tashmë (id determinist)'); continue; }
      throw err;
    }
    await db.collection('invoiceItems').doc().set({
      invoiceId: ref.id, description: `${p.name} – ${periodLabel}`, quantity: 1, unitPrice: budget, totalPrice: budget,
      teamId: p.teamId || null, businessId: p.businessId || null, customerId: p.customerId || null, createdAt: now, updatedAt: now,
    });
    // Pretendimi: vetëm nëse s'ka asnjë ose është më i vjetër se kjo periudhë.
    const patch = { updatedAt: now };
    if (!p.lastInvoicePeriodKey || p.lastInvoicePeriodKey < GENERATE) {
      patch.lastInvoicePeriodKey = GENERATE;
      patch.lastInvoiceGeneratedAt = Timestamp.fromDate(invoiceDate);
    }
    await d.ref.update(patch);
    made++;
    console.log(`  ✓ u krijua ${invoiceLabel} (${ref.id}) me datë ${invoiceDate.toISOString().slice(0, 10)}, afat ${periodEnd.toISOString().slice(0, 10)} — pa email`);
  }
  console.log('\nPërmbledhje:', gen, APPLY ? `— u krijuan ${made}` : '');
  if (!APPLY && gen.MUNGON) console.log(`\nPër t'i krijuar: node scripts/audit-retainer-billing.mjs --generate=${GENERATE} --apply`);
}
