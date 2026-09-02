// READ-ONLY health check of recurring billing, month by month.
//
// Answers, for every recurring series (both engines):
//   · GAP   — a month with no invoice BETWEEN two months that do have one. This is
//             the only kind of hole we can assert: a series that billed May..Aug but
//             not April may simply have started in May, so "April is missing" would
//             be an invented expectation. A hole in the middle cannot be explained
//             away — the cycle ran, then skipped, then ran again.
//   · STALE — the series is live and due, but nothing has been billed since period X.
//             This is the shape the dead-guard bug produced.
//   · DOUBLE— two invoices covering one period.
// Writes nothing.
//
// Engine 1 (Part 1): a recurring INVOICE parent spawns children (parentInvoiceId).
// Engine 2 (Part 2): a recurring PROJECT bills its own fee (projectId + billingPeriodKey).
//
// Mirrors src/lib/finance/recurringInvoices.ts. Writes nothing.

import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const NOW = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const dt = (v) => (v?.toDate ? v.toDate() : (v ? new Date(v) : null));
const ok = (d) => d instanceof Date && !isNaN(d.getTime());

function periodKey(freq, at) {
  if (freq === 'weekly') {
    const m = new Date(at.getFullYear(), at.getMonth(), at.getDate());
    const dow = m.getDay();
    m.setDate(m.getDate() - (dow === 0 ? 6 : dow - 1));
    return `W${m.getFullYear()}-${p2(m.getMonth() + 1)}-${p2(m.getDate())}`;
  }
  if (freq === 'quarterly') return `Q${at.getFullYear()}-${Math.floor(at.getMonth() / 3) + 1}`;
  if (freq === 'yearly') return `Y${at.getFullYear()}`;
  return `${at.getFullYear()}-${p2(at.getMonth() + 1)}`;
}
function addMonthsClamped(from, months, anchorDay) {
  const day = anchorDay ?? from.getDate();
  const out = new Date(from.getFullYear(), from.getMonth() + months, 1);
  const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(day, last));
  return out;
}
function nextOcc(from, freq, anchorDay) {
  if (freq === 'weekly') { const o = new Date(from); o.setDate(o.getDate() + 7); return o; }
  if (freq === 'yearly') return addMonthsClamped(from, 12, anchorDay);
  if (freq === 'quarterly') return addMonthsClamped(from, 3, anchorDay);
  return addMonthsClamped(from, 1, anchorDay);
}
/** Every period key from `start` up to and including the period containing `until`. */
function periodsFrom(start, freq, until = NOW) {
  const keys = [];
  let cur = new Date(start);
  const anchor = start.getDate();
  const untilKey = periodKey(freq, until);
  let guard = 0;
  while (guard++ < 400) {
    const k = periodKey(freq, cur);
    keys.push(k);
    if (k === untilKey) break;
    if (cur > until) break;
    cur = nextOcc(cur, freq, anchor);
  }
  return keys;
}

/**
 * Every period key from `fromKey` to `toKey` inclusive, derived from the KEYS
 * themselves rather than from an assumed anchor date.
 *
 * This is the whole point: an earlier version walked the cycle from the project's
 * `startDate`, and when the first invoice landed in a different period than that
 * date implied, the walk was abandoned and gap detection silently returned nothing —
 * a series billed Mar,May,Jun,Jul,Aug reported "no gaps" while April was missing.
 */
function enumeratePeriods(freq, fromKey, toKey) {
  const out = [];
  if (freq === 'yearly') {
    const a = +fromKey.slice(1), b = +toKey.slice(1);
    for (let y = a; y <= b; y++) out.push(`Y${y}`);
    return out;
  }
  if (freq === 'quarterly') {
    let [ay, aq] = fromKey.slice(1).split('-').map(Number);
    const [by, bq] = toKey.slice(1).split('-').map(Number);
    let guard = 0;
    while ((ay < by || (ay === by && aq <= bq)) && guard++ < 400) {
      out.push(`Q${ay}-${aq}`);
      aq++; if (aq > 4) { aq = 1; ay++; }
    }
    return out;
  }
  if (freq === 'weekly') {
    let cur = new Date(fromKey.slice(1) + 'T12:00:00');
    let guard = 0;
    while (guard++ < 500) {
      const k = periodKey('weekly', cur);
      out.push(k);
      if (k >= toKey) break;
      cur.setDate(cur.getDate() + 7);
    }
    return out;
  }
  let [ay, am] = fromKey.split('-').map(Number);
  const [by, bm] = toKey.split('-').map(Number);
  let guard = 0;
  while ((ay < by || (ay === by && am <= bm)) && guard++ < 400) {
    out.push(`${ay}-${p2(am)}`);
    am++; if (am > 12) { am = 1; ay++; }
  }
  return out;
}

/**
 * Diagnose a series from the periods it ACTUALLY billed — never from an assumed
 * start date. `covered` is key -> count.
 */
function diagnose(covered, freq, opts = {}) {
  const keys = [...covered.keys()].sort();
  const doubled = [...covered.entries()].filter(([, c]) => c > 1).map(([k]) => k);
  if (!keys.length) {
    // A live series that has NEVER produced an invoice is the loudest case of all,
    // and the previous version passed it as healthy.
    return { gaps: [], stale: null, doubled, first: null, last: null, never: !opts.dormant };
  }

  // The series can only be judged from when it could exist at all.
  const firstBilled = keys[0];
  const first = opts.minKey && opts.minKey > keys[0] ? opts.minKey : keys[0];
  const last = keys[keys.length - 1];
  if (last < first) {
    // Everything billed predates the series (historical links only).
    return { gaps: [], stale: null, doubled, first: keys[0], last, never: false, preHistory: true };
  }
  const between = enumeratePeriods(freq, first, last);
  const gaps = between.filter(k => !covered.has(k));
  const inWindow = between.filter(k => covered.has(k)).length;
  const historical = keys.filter(k => k < first).length;

  // Trailing gap: periods after the last billed one that are already due.
  let stale = null;
  if (!opts.dormant) {
    const nowKey = periodKey(freq, opts.lastDate || NOW);
    const due = enumeratePeriods(freq, first, nowKey)
      .filter(k => k > last && !(opts.notYetDue && k === periodKey(freq, NOW)));
    // A series with no billing at all inside its window is "never", not "stale".

    if (due.length) stale = due;
  }
  return { gaps, stale, doubled, first, last, firstBilled, inWindow,
           windowLen: between.length, historical, never: false };
}
const money = (n, c) => `${Math.round(n || 0).toLocaleString('en-US')} ${c === 'EUR' ? '€' : 'L'}`;

async function main() {
  const [invSnap, projSnap] = await Promise.all([
    db.collection('invoices').get(),
    db.collection('projects').get(),
  ]);
  const invoices = invSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const projects = projSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const projById = new Map(projects.map(p => [p.id, p]));

  console.log(`\n${'='.repeat(78)}`);
  console.log(`RECURRING BILLING HEALTH — ${NOW.toISOString().slice(0, 10)}`);
  console.log(`${invoices.length} invoices · ${projects.length} projects`);
  console.log('='.repeat(78));

  // ── ENGINE 1: recurring INVOICE parents ────────────────────────────────────
  const parents = invoices.filter(i => i.isRecurring === true && !i.autoGenerated);
  const childrenBy = new Map();
  for (const i of invoices) {
    if (!i.parentInvoiceId) continue;
    if (!childrenBy.has(i.parentInvoiceId)) childrenBy.set(i.parentInvoiceId, []);
    childrenBy.get(i.parentInvoiceId).push(i);
  }

  console.log(`\n\n### ENGINE 1 — recurring INVOICE parents (${parents.length})\n`);
  if (!parents.length) console.log('  (none)');

  for (const p of parents) {
    const freq = p.recurringFrequency || 'monthly';
    const kids = childrenBy.get(p.id) || [];
    const start = dt(p.invoiceDate) || dt(p.createdAt);
    const next = dt(p.nextRecurringDate);
    const end = dt(p.recurringEndDate);
    const proj = p.projectId ? projById.get(p.projectId) : null;
    const overlap = !!proj && proj.isRecurring === true && !proj.isRecurringPaused
      && proj.billingType !== 'one-time'
      && proj.status !== 'Cancelled' && proj.status !== 'Archived';

    // Periods the PARENT itself covers + every child's period.
    const covered = new Map(); // key -> count
    if (ok(start)) covered.set(periodKey(freq, start), 1);
    for (const k of kids) {
      const kd = k.periodKey || (ok(dt(k.invoiceDate)) ? periodKey(freq, dt(k.invoiceDate)) : null);
      if (kd) covered.set(kd, (covered.get(kd) || 0) + 1);
    }
    const endKey = ok(end) ? periodKey(freq, end) : null;
    const seriesOver = endKey && periodKey(freq, NOW) > endKey;
    const d = diagnose(covered, freq, {
      dormant: !!p.isRecurringPaused || seriesOver,
      lastDate: ok(end) && seriesOver ? end : NOW,
      minKey: ok(start) ? periodKey(freq, start) : null,
    });

    const flag = (d.gaps.length || d.stale || d.never) ? '🔴' : d.doubled.length ? '🟠'
      : p.isRecurringPaused ? '⏸' : '✅';
    console.log(`${flag} ${p.invoiceNumber || p.id.slice(0, 8)}  ${freq}  ${money(p.total ?? p.amount, p.currency)}`);
    console.log(`    dritarja ${d.first || '—'} → ${d.last || '—'}` +
      `  ·  faturuar ${d.inWindow ?? 0}/${d.windowLen ?? 0} periudha  ·  ${kids.length} fëmijë`);
    console.log(`    next ${ok(next) ? next.toISOString().slice(0, 10) : 'NONE'}` +
      `  ·  lastKey ${p.lastGeneratedPeriodKey || '—'}` +
      `${p.isRecurringPaused ? '  ·  ⏸ PAUZUAR' : ''}` +
      `${endKey ? `  ·  deri ${endKey}` : ''}`);
    if (overlap) console.log(`    ⚠️  MBIVENDOSJE: projekti "${proj.name}" faturohet vetë (dyfish)`);
    if (d.never) console.log(`    🔴 KURRË: seri aktive që nuk ka nxjerrë asnjë faturë`);
    if (d.gaps.length) console.log(`    🔴 VRIMË: ${d.gaps.join(', ')}`);
    if (d.stale) console.log(`    🔴 NDALUAR: pa faturë prej ${d.last} → mungon ${d.stale.join(', ')}`);
    if (d.doubled.length) console.log(`    🟠 DYFISH: ${d.doubled.join(', ')}`);
    console.log('');
  }

  // ── ENGINE 2: recurring PROJECTS ───────────────────────────────────────────
  const recProjects = projects.filter(p => p.isRecurring === true);
  const invByProject = new Map();
  for (const i of invoices) {
    if (!i.projectId) continue;
    if (!invByProject.has(i.projectId)) invByProject.set(i.projectId, []);
    invByProject.get(i.projectId).push(i);
  }

  console.log(`\n### ENGINE 2 — recurring PROJECTS (${recProjects.length})\n`);
  if (!recProjects.length) console.log('  (none)');

  const summary = { ok: 0, missing: 0, doubled: 0, paused: 0, terminal: 0, noBudget: 0 };
  const unbilled = []; // { name, amount, periods[] } — genuinely due, never billed

  for (const p of recProjects) {
    const freq = p.recurringFrequency || 'monthly';
    const terminal = p.status === 'Cancelled' || p.status === 'Archived';
    const budget = Number(p.budget) || 0;
    const start = dt(p.startDate) || dt(p.createdAt);
    const end = dt(p.recurringEndDate);
    const mine = invByProject.get(p.id) || [];

    // Draft and Cancelled are NOT billed, so neither counts as coverage — and a
    // month "covered" only by a draft is a genuine gap, not a false alarm.
    const covered = new Map();
    let drafts = 0;
    for (const i of mine) {
      if (i.status === 'Cancelled') continue;
      if (i.status === 'Draft') { drafts++; continue; }
      const k = i.billingPeriodKey || (ok(dt(i.invoiceDate)) ? periodKey(freq, dt(i.invoiceDate)) : null);
      if (k) covered.set(k, (covered.get(k) || 0) + 1);
    }
    const endKey = ok(end) ? periodKey(freq, end) : null;
    const seriesOver = endKey && periodKey(freq, NOW) > endKey;
    // A billingDayOfMonth later than today means the CURRENT period isn't due yet.
    const notYetDue = freq === 'monthly' && p.billingDayOfMonth
      && NOW.getDate() < Number(p.billingDayOfMonth);
    // The window CANNOT open before the project existed. An invoice from March
    // linked to a project created in August is a historical link, not a billing
    // period the series was ever meant to cover — treating it as the series start
    // invented months of "missing" invoices for a project that did not yet exist.
    const born = dt(p.createdAt);
    const d = diagnose(covered, freq, {
      dormant: terminal || !!p.isRecurringPaused || seriesOver || !budget,
      notYetDue,
      lastDate: ok(end) && seriesOver ? end : NOW,
      minKey: ok(born) ? periodKey(freq, born) : null,
    });

    let flag = '✅';
    if (terminal) { flag = '⚫'; summary.terminal++; }
    else if (p.isRecurringPaused) { flag = '⏸'; summary.paused++; }
    else if (!budget) { flag = '🟡'; summary.noBudget++; }
    else if (d.gaps.length || d.stale || d.never) { flag = '🔴'; summary.missing++; }
    else if (d.doubled.length) { flag = '🟠'; summary.doubled++; }
    else summary.ok++;

    const name = (p.name || p.id.slice(0, 8)).slice(0, 42);
    console.log(`${flag} ${name.padEnd(44)} ${freq.padEnd(9)} ${money(budget, p.currency).padStart(14)}  ${p.status || '?'}`);
    console.log(`    dritarja ${d.first || '—'} → ${d.last || '—'}` +
      `  ·  faturuar ${d.inWindow ?? 0}/${d.windowLen ?? 0} periudha` +
      `${d.historical ? `  ·  +${d.historical} para krijimit (lidhje historike)` : ''}` +
      `${drafts ? `  ·  ${drafts} draft (nuk numërohen)` : ''}` +
      `  ·  lastKey ${p.lastInvoicePeriodKey || '—'}` +
      `${p.billingDayOfMonth ? `  ·  dita ${p.billingDayOfMonth}` : ''}`);
    if (!budget && !terminal) console.log(`    🟡 PA BUXHET — cron-i nuk fatura (njofton përgjegjësin)`);
    if (d.never) console.log(`    🔴 KURRË: retainer aktiv që nuk ka nxjerrë asnjë faturë`);
    if (d.gaps.length) console.log(`    🔴 VRIMË: ${d.gaps.join(', ')}`);
    if (d.stale) console.log(`    🔴 NDALUAR: pa faturë prej ${d.last} → mungon ${d.stale.join(', ')}`);
    if (d.doubled.length) console.log(`    🟠 DYFISH: ${d.doubled.join(', ')}`);
    console.log('');

    const live = budget && !terminal && !p.isRecurringPaused;
    const due = [...d.gaps, ...(d.stale || [])];
    if (live && due.length) {
      unbilled.push({ name: p.name || p.id.slice(0, 8), amount: budget * (p.currency === 'EUR' ? 100 : 1), periods: due });
    } else if (live && d.never) {
      const born2 = dt(p.createdAt);
      const win = ok(born2)
        ? enumeratePeriods(freq, periodKey(freq, born2), periodKey(freq, NOW))
            .filter(k => !(notYetDue && k === periodKey(freq, NOW)))
        : [];
      if (win.length) unbilled.push({ name: p.name || p.id.slice(0, 8), amount: budget * (p.currency === 'EUR' ? 100 : 1), periods: win });
    }
  }

  // ── Month-by-month totals from the project engine ──────────────────────────
  console.log(`\n### AUTO-FATURA SIPAS MUAJIT (të dy motorët)\n`);
  const byMonth = new Map();
  for (const i of invoices) {
    if (!i.autoGenerated) continue;
    const d = dt(i.invoiceDate) || dt(i.createdAt);
    if (!ok(d)) continue;
    const k = `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
    if (!byMonth.has(k)) byMonth.set(k, { n: 0, all: 0, cancelled: 0 });
    const row = byMonth.get(k);
    row.n++;
    if (i.status === 'Cancelled') row.cancelled++;
    row.all += (Number(i.total ?? i.amount) || 0) * ((i.currency === 'EUR') ? 100 : 1);
  }
  for (const k of [...byMonth.keys()].sort()) {
    const r = byMonth.get(k);
    console.log(`  ${k}   ${String(r.n).padStart(3)} fatura   ${money(r.all, 'ALL').padStart(16)}${r.cancelled ? `   (${r.cancelled} anuluar)` : ''}`);
  }

  console.log(`
### PERIUDHA TË PAFATURUARA (agregat)
`);
  const byPeriod = new Map();
  let lostTotal = 0;
  for (const r of unbilled) {
    for (const k of r.periods) {
      if (!byPeriod.has(k)) byPeriod.set(k, { n: 0, all: 0, who: [] });
      const row = byPeriod.get(k);
      row.n++; row.all += r.amount; row.who.push(r.name);
      lostTotal += r.amount;
    }
  }
  for (const k of [...byPeriod.keys()].sort()) {
    const r = byPeriod.get(k);
    console.log(`  ${k}   ${String(r.n).padStart(2)} retainer   ${money(r.all, 'ALL').padStart(14)}`);
    console.log(`            ${r.who.join(', ')}`);
  }
  console.log(`
  TOTAL i pafaturuar: ${money(lostTotal, 'ALL')}`);

  console.log(`\n${'='.repeat(78)}`);
  console.log(`PËRMBLEDHJE (motori i projekteve): ✅ ${summary.ok} ok · 🔴 ${summary.missing} me mungesa · ` +
    `🟠 ${summary.doubled} dyfish · 🟡 ${summary.noBudget} pa buxhet · ⏸ ${summary.paused} pauzuar · ⚫ ${summary.terminal} terminal`);
  console.log('='.repeat(78) + '\n');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
