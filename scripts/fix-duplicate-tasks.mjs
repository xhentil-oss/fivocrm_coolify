// Repair path for the recurring-task duplicates + the data damage they left.
//
// DRY RUN BY DEFAULT — prints the plan and changes nothing.
//   node scripts/fix-duplicate-tasks.mjs                  # plan only
//   node scripts/fix-duplicate-tasks.mjs --apply          # execute
//   node scripts/fix-duplicate-tasks.mjs --apply --only=duplicates
//
// Steps (each can be run alone with --only=<step>):
//   duplicates  archive + delete duplicate occurrences (same business+title+
//               assignee+project+start day). The SURVIVOR is the oldest row;
//               a Done row always beats a Todo row so history is preserved,
//               and comments/subtasks pointing at a victim are re-pointed.
//   dates       repair endDate < startDate by restoring the intended span.
//   orphans     unlink tasks whose projectId points at a deleted project.
//   businessid  backfill the missing businessId so the row is visible again.
//
// Every deleted row is snapshotted to `taskDuplicatesArchive` BEFORE deletion.
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;
const step = (name) => !ONLY || ONLY === name;

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(path.join(__dirname, 'sa.json'), 'utf8'))) });
const db = admin.firestore();

const toDate = (v) => {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};
const day = (d) => (d ? d.toISOString().slice(0, 10) : '-');
const norm = (s) => (s || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
const ts = (d) => admin.firestore.Timestamp.fromDate(d);

const plan = { deletes: [], updates: [] };
const queueDelete = (t, reason) => plan.deletes.push({ t, reason });
const queueUpdate = (id, data, reason) => plan.updates.push({ id, data, reason });

// Collections that reference a task and must follow the survivor.
const TASK_REFS = [
  { collection: 'taskComments', field: 'taskId' },
  { collection: 'tasks', field: 'parentTaskId' },
  { collection: 'timeEntries', field: 'taskId' },
  { collection: 'activities', field: 'entityId' },
];

async function main() {
  const snap = await db.collection('tasks').get();
  const tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${tasks.length} tasks loaded\n`);

  const victims = new Map(); // victimId -> survivorId

  // ── 1. Duplicate occurrences ───────────────────────────────────────────────
  if (step('duplicates')) {
    const groups = new Map();
    for (const t of tasks) {
      const key = [t.businessId || '-', norm(t.title), t.assignedToUserId || '-', t.projectId || '-', day(toDate(t.startDate))].join('||');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    const dupGroups = [...groups.entries()].filter(([, g]) => g.length > 1);
    console.log(`== DUPLICATES: ${dupGroups.length} groups ==`);
    for (const [key, g] of dupGroups) {
      // Prefer a Done row (it carries the real history), then the oldest.
      const sorted = [...g].sort((a, b) => {
        const doneA = a.status === 'Done' ? 0 : 1;
        const doneB = b.status === 'Done' ? 0 : 1;
        if (doneA !== doneB) return doneA - doneB;
        return (toDate(a.createdAt)?.getTime() ?? 0) - (toDate(b.createdAt)?.getTime() ?? 0);
      });
      const [survivor, ...dups] = sorted;
      console.log(`\n  ${key}`);
      console.log(`    KEEP   ${survivor.id} (${survivor.status}, created ${day(toDate(survivor.createdAt))})`);
      for (const v of dups) {
        console.log(`    DELETE ${v.id} (${v.status}, created ${day(toDate(v.createdAt))})`);
        victims.set(v.id, survivor.id);
        queueDelete(v, `duplicate of ${survivor.id}`);
      }
      // The survivor must be able to continue the series: if any row in the group
      // still had an unspawned cycle, keep that on the survivor.
      const anyOpenCycle = g.some((t) => t.nextCycleCreated !== true);
      if (survivor.nextCycleCreated === true && anyOpenCycle && survivor.status !== 'Done') {
        queueUpdate(survivor.id, { nextCycleCreated: false }, 'survivor keeps the open cycle');
      }
    }
    console.log(`\n  → ${plan.deletes.length} rows to delete\n`);
  }

  // ── 1b. Series with more than one OPEN tip ─────────────────────────────────
  // These are duplicates the key-based pass cannot see, because the date drift
  // bug gave the two tips DIFFERENT start dates (e.g. Jona Academy sits open on
  // both 16 and 23 August). A recurring series may only have one open
  // occurrence; the earliest one is the real current cycle.
  if (step('duplicates') || step('series')) {
    const openSeries = new Map();
    for (const t of tasks) {
      if (victims.has(t.id) || t.status === 'Done' || t.status === 'Cancelled') continue;
      if (!t.isRecurring) continue;
      const key = [t.businessId || '-', norm(t.title), t.assignedToUserId || '-', t.projectId || '-'].join('||');
      if (!openSeries.has(key)) openSeries.set(key, []);
      openSeries.get(key).push(t);
    }
    const multi = [...openSeries.entries()].filter(([, g]) => g.length > 1);
    console.log(`== SERIES ME >1 CIKËL TË HAPUR: ${multi.length} ==`);
    for (const [key, g] of multi) {
      const sorted = [...g].sort((a, b) => (toDate(a.startDate)?.getTime() ?? 0) - (toDate(b.startDate)?.getTime() ?? 0));
      const [keep, ...extra] = sorted;
      console.log(`\n  ${key}`);
      console.log(`    KEEP   ${keep.id} (fillon ${day(toDate(keep.startDate))})`);
      for (const v of extra) {
        console.log(`    DELETE ${v.id} (fillon ${day(toDate(v.startDate))} — cikël i dyfishuar)`);
        victims.set(v.id, keep.id);
        queueDelete(v, `second open cycle of the same series as ${keep.id}`);
      }
      // The kept tip must still be able to spawn the next cycle.
      if (keep.nextCycleCreated === true) {
        queueUpdate(keep.id, { nextCycleCreated: false }, 'kept tip must continue the series');
      }
    }
    console.log('');
  }

  // ── 2. Inverted / zero-length dates ────────────────────────────────────────
  if (step('dates')) {
    const broken = tasks.filter((t) => {
      if (victims.has(t.id)) return false;
      const s = toDate(t.startDate), e = toDate(t.endDate);
      return s && e && e < s;
    });
    console.log(`== INVERTED DATES: ${broken.length} ==`);
    for (const t of broken) {
      const s = toDate(t.startDate), e = toDate(t.endDate);
      // The span was lost when start/end were snapped independently. Restore the
      // task as a same-day occurrence ending at the hour the endDate carries —
      // that is the shape every healthy row in these series has.
      const fixed = new Date(s);
      fixed.setUTCHours(e.getUTCHours(), e.getUTCMinutes(), 0, 0);
      if (fixed < s) fixed.setUTCDate(fixed.getUTCDate() + 1);
      console.log(`  ${t.id} "${t.title}"  ${s.toISOString()} .. ${e.toISOString()}  ->  end ${fixed.toISOString()}`);
      queueUpdate(t.id, { endDate: ts(fixed) }, 'restore end after start');
    }
    console.log('');
  }

  // ── 3. Orphaned projectId ──────────────────────────────────────────────────
  if (step('orphans')) {
    const projIds = new Set((await db.collection('projects').get()).docs.map((p) => p.id));
    const orphans = tasks.filter((t) => t.projectId && !projIds.has(t.projectId) && !victims.has(t.id));
    console.log(`== ORPHANED projectId: ${orphans.length} ==`);
    for (const t of orphans) {
      console.log(`  ${t.id} "${t.title}" (${t.status}) -> projectId ${t.projectId} është fshirë`);
      queueUpdate(t.id, { projectId: admin.firestore.FieldValue.delete() }, 'unlink deleted project');
    }
    console.log('');
  }

  // ── 4. Missing businessId ──────────────────────────────────────────────────
  if (step('businessid')) {
    const missing = tasks.filter((t) => !t.businessId && !victims.has(t.id));
    console.log(`== MISSING businessId: ${missing.length} ==`);
    const projects = new Map((await db.collection('projects').get()).docs.map((p) => [p.id, p.data().businessId]));
    for (const t of missing) {
      let bid = t.projectId ? projects.get(t.projectId) : null;
      if (!bid && t.teamId) {
        const tm = await db.collection('teamMembers').where('teamId', '==', t.teamId).limit(1).get();
        bid = tm.empty ? null : tm.docs[0].data().businessId;
      }
      if (!bid && t.createdByUserId) {
        const tm = await db.collection('teamMembers').where('userId', '==', t.createdByUserId).limit(1).get();
        bid = tm.empty ? null : tm.docs[0].data().businessId;
      }
      if (bid) {
        console.log(`  ${t.id} "${t.title}" -> businessId ${bid}`);
        queueUpdate(t.id, { businessId: bid }, 'backfill businessId');
      } else {
        console.log(`  ${t.id} "${t.title}" -> NUK u gjet businessId (kërkon vendim manual)`);
      }
    }
    console.log('');
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n=== PLAN: ${plan.deletes.length} delete, ${plan.updates.length} update ===`);
  if (!APPLY) {
    console.log('\nDRY RUN — asgjë nuk u ndryshua. Rishtypeje me --apply për ta zbatuar.');
    process.exit(0);
  }

  // ── Execute ────────────────────────────────────────────────────────────────
  console.log('\nDuke zbatuar...');

  // Re-point references before deleting anything.
  let repointed = 0;
  for (const [victimId, survivorId] of victims) {
    for (const { collection, field } of TASK_REFS) {
      const refs = await db.collection(collection).where(field, '==', victimId).get();
      for (const r of refs.docs) {
        if (collection === 'activities' && r.data().entityType !== 'task') continue;
        await r.ref.update({ [field]: survivorId, updatedAt: admin.firestore.Timestamp.now() });
        repointed++;
      }
    }
  }
  console.log(`  ${repointed} referenca u ridrejtuan te mbijetuesi`);

  // Archive, then delete.
  for (const { t, reason } of plan.deletes) {
    await db.collection('taskDuplicatesArchive').doc(t.id).set({
      ...t, archivedAt: admin.firestore.Timestamp.now(), archiveReason: reason,
    });
  }
  console.log(`  ${plan.deletes.length} rreshta u arkivuan te taskDuplicatesArchive`);

  for (const { t } of plan.deletes) await db.collection('tasks').doc(t.id).delete();
  console.log(`  ${plan.deletes.length} dublikatë u fshinë`);

  for (const { id, data } of plan.updates) {
    await db.collection('tasks').doc(id).update({ ...data, updatedAt: admin.firestore.Timestamp.now() });
  }
  console.log(`  ${plan.updates.length} rreshta u përditësuan`);

  console.log('\nU krye.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
