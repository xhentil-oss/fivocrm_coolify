// Give every timeEntry an EXPLICIT `endTime` field.
//
// Firestore's `where('endTime','==',null)` matches only documents that HAVE the
// field as null — a missing field is invisible to it. startTimer never wrote the
// field, so the single-timer enforcement, the "Duke punuar" badge and every
// running-timer view matched nothing, and abandoned timers could never be found.
//
// Policy per entry missing the field:
//   · started within the last 12h → `endTime: null` (a genuinely running timer,
//     now visible; the next start will close it correctly)
//   · older → auto-close at startTime with duration 0 + `autoClosed: true`
//     (the hours were already counting 0 — closing at start fabricates nothing)
//
//   node scripts/backfill-timeentry-endtime.mjs          (dry-run)
//   node scripts/backfill-timeentry-endtime.mjs --apply

import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

async function main() {
  console.log(`[timeEntries endTime] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  const snap = await db.collection('timeEntries').get();
  const missing = snap.docs.filter(d => !('endTime' in d.data()));
  console.log(`Gjithsej: ${snap.size} · pa fushën endTime: ${missing.length}`);
  if (!missing.length) { console.log('Asgjë për të rregulluar. ✓'); return; }

  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  let running = 0, closed = 0, broken = 0;
  for (const d of missing) {
    const e = d.data();
    const start = e.startTime?.toDate ? e.startTime.toDate() : (e.startTime ? new Date(e.startTime) : null);
    if (!start || isNaN(start.getTime())) {
      broken++;
      console.log(`  ⚠ ${d.id}: pa startTime të vlefshëm — auto-mbyllet me duration 0`);
      if (APPLY) await d.ref.update({ endTime: null, updatedAt: Timestamp.now() });
      continue;
    }
    if (start.getTime() >= cutoff) {
      running++;
      console.log(`  ▶ ${d.id}: aktiv (${start.toISOString()}) → endTime: null`);
      if (APPLY) await d.ref.update({ endTime: null, updatedAt: Timestamp.now() });
    } else {
      closed++;
      console.log(`  ■ ${d.id}: i braktisur (${start.toISOString()}) → mbyllet me duration 0`);
      if (APPLY) await d.ref.update({
        endTime: Timestamp.fromDate(start),
        duration: Number(e.duration) || 0,
        autoClosed: true,
        updatedAt: Timestamp.now(),
      });
    }
  }
  console.log(`\nAktivë: ${running} · Të mbyllur auto: ${closed} · Pa startTime: ${broken}`);
  if (!APPLY) console.log('Run again with --apply to write.');
}
main().then(() => process.exit(0)).catch(e => { console.error(e.code || '', e.details || e.message); process.exit(1); });
