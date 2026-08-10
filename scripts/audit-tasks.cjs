// Read-only audit of the `tasks` collection: duplicates + data-integrity bugs.
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const ROOT = 'c:/Users/User/Downloads/platforma_menaxhimi_biznes_hs289p';
const saPath = path.join(ROOT, 'scripts', 'sa.json');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8'))) });
const db = admin.firestore();

const d = (v) => {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  const x = new Date(v);
  return isNaN(x.getTime()) ? null : x;
};
const iso = (x) => (x ? x.toISOString().slice(0, 10) : '—');
const norm = (s) => (s || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();

(async () => {
  const snap = await db.collection('tasks').get();
  const tasks = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  console.log(`TOTAL tasks: ${tasks.length}`);

  // businesses lookup
  const bizSnap = await db.collection('businesses').get();
  const bizName = {};
  bizSnap.docs.forEach((b) => (bizName[b.id] = b.data().name || b.id));

  // ── Breakdown ──────────────────────────────────────────────────────────────
  const byBiz = {};
  tasks.forEach((t) => {
    const k = t.businessId || '(NO businessId)';
    byBiz[k] = (byBiz[k] || 0) + 1;
  });
  console.log('\n== By businessId ==');
  Object.entries(byBiz).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v.toString().padStart(5)}  ${k}  ${bizName[k] || ''}`));

  const byStatus = {};
  tasks.forEach((t) => (byStatus[t.status || '(none)'] = (byStatus[t.status || '(none)'] || 0) + 1));
  console.log('\n== By status ==', byStatus);

  // ── 1. Exact duplicates: same title+business+assignee+startDate ────────────
  const groups = new Map();
  for (const t of tasks) {
    const key = [t.businessId || '-', norm(t.title), t.assignedToUserId || '-', iso(d(t.startDate)), t.projectId || '-'].join('||');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const dups = [...groups.entries()].filter(([, g]) => g.length > 1).sort((a, b) => b[1].length - a[1].length);
  console.log(`\n== EXACT DUPLICATE GROUPS (title+biz+assignee+startDate+project): ${dups.length} groups, ${dups.reduce((s, [, g]) => s + g.length - 1, 0)} extra rows ==`);
  dups.slice(0, 40).forEach(([key, g]) => {
    console.log(`\n  [${g.length}x] ${key}`);
    g.forEach((t) => console.log(`      ${t.id}  status=${t.status} rec=${!!t.isRecurring} nextCycleCreated=${t.nextCycleCreated} created=${iso(d(t.createdAt))} createdBy=${t.createdByUserId || '-'}`));
  });

  // ── 2. Recurring-series duplicates: same title+series, multiple OPEN rows ──
  const openByTitle = new Map();
  for (const t of tasks) {
    if (t.status === 'Done' || t.status === 'Cancelled') continue;
    const key = [t.businessId || '-', norm(t.title), t.assignedToUserId || '-'].join('||');
    if (!openByTitle.has(key)) openByTitle.set(key, []);
    openByTitle.get(key).push(t);
  }
  const openDups = [...openByTitle.entries()].filter(([, g]) => g.length > 1 && g.some((t) => t.isRecurring)).sort((a, b) => b[1].length - a[1].length);
  console.log(`\n== OPEN RECURRING PILE-UPS (same title+assignee, >1 open, at least one recurring): ${openDups.length} ==`);
  openDups.slice(0, 30).forEach(([key, g]) => {
    console.log(`\n  [${g.length}x open] ${key}`);
    g.forEach((t) => console.log(`      ${t.id}  status=${t.status} start=${iso(d(t.startDate))} next=${iso(d(t.nextRecurringDate))} rec=${!!t.isRecurring} freq=${t.recurringFrequency || '-'} nextCycleCreated=${t.nextCycleCreated}`));
  });

  // ── 3. Data-integrity bugs ────────────────────────────────────────────────
  const noBiz = tasks.filter((t) => !t.businessId);
  const noTitle = tasks.filter((t) => !norm(t.title));
  const badDates = tasks.filter((t) => { const s = d(t.startDate), e = d(t.endDate); return s && e && e < s; });
  const recNoFreq = tasks.filter((t) => t.isRecurring && !t.recurringFrequency);
  const recNoNext = tasks.filter((t) => t.isRecurring && !t.nextRecurringDate);
  const recNoDates = tasks.filter((t) => t.isRecurring && (!t.startDate || !t.endDate));
  const doneNoFlag = tasks.filter((t) => t.isRecurring && t.status === 'Done' && !t.nextCycleCreated);
  const orphanParent = tasks.filter((t) => t.parentTaskId && !tasks.some((x) => x.id === t.parentTaskId));
  const selfParent = tasks.filter((t) => t.parentTaskId && t.parentTaskId === t.id);
  const orphanDep = tasks.filter((t) => Array.isArray(t.dependsOn) && t.dependsOn.some((id) => !tasks.some((x) => x.id === id)));
  const selfDep = tasks.filter((t) => Array.isArray(t.dependsOn) && t.dependsOn.includes(t.id));
  const noAssignee = tasks.filter((t) => !t.assignedToUserId && t.status !== 'Done');

  const projSnap = await db.collection('projects').get();
  const projIds = new Set(projSnap.docs.map((p) => p.id));
  const projBiz = {};
  projSnap.docs.forEach((p) => (projBiz[p.id] = p.data().businessId || null));
  const orphanProject = tasks.filter((t) => t.projectId && !projIds.has(t.projectId));
  const crossTenant = tasks.filter((t) => t.projectId && projBiz[t.projectId] && t.businessId && projBiz[t.projectId] !== t.businessId);

  console.log('\n== INTEGRITY ==');
  const rep = (label, arr, extra) => {
    console.log(`  ${label}: ${arr.length}`);
    arr.slice(0, 12).forEach((t) => console.log(`      ${t.id}  "${(t.title || '').slice(0, 50)}"  ${extra ? extra(t) : `status=${t.status} biz=${t.businessId || '-'}`}`));
  };
  rep('tasks WITHOUT businessId (invisible in list)', noBiz);
  rep('tasks without title', noTitle);
  rep('endDate < startDate', badDates, (t) => `${iso(d(t.startDate))} -> ${iso(d(t.endDate))}`);
  rep('isRecurring but no frequency', recNoFreq);
  rep('isRecurring but no nextRecurringDate (cron skips forever)', recNoNext);
  rep('isRecurring but missing start/end (cron skips)', recNoDates);
  rep('recurring + Done but nextCycleCreated falsy (cron may spawn)', doneNoFlag, (t) => `next=${iso(d(t.nextRecurringDate))} freq=${t.recurringFrequency}`);
  rep('parentTaskId points to missing task', orphanParent);
  rep('parentTaskId === own id', selfParent);
  rep('dependsOn points to missing task', orphanDep);
  rep('dependsOn includes itself (deadlock)', selfDep);
  rep('projectId points to missing project', orphanProject);
  rep('task.businessId != project.businessId (CROSS-TENANT)', crossTenant, (t) => `task=${t.businessId} project=${projBiz[t.projectId]}`);
  console.log(`  open tasks with no assignee: ${noAssignee.length}`);

  // ── 4. Recurring series health ────────────────────────────────────────────
  const rec = tasks.filter((t) => t.isRecurring);
  console.log(`\n== RECURRING: ${rec.length} total ==`);
  const recOpen = rec.filter((t) => t.status !== 'Done');
  const now = new Date();
  const stale = recOpen.filter((t) => { const n = d(t.nextRecurringDate); return n && n < new Date(now.getTime() - 60 * 86400000); });
  console.log(`  open recurring: ${recOpen.length}, with nextRecurringDate >60d in the past: ${stale.length}`);
  stale.slice(0, 15).forEach((t) => console.log(`      ${t.id}  "${(t.title || '').slice(0, 40)}"  next=${iso(d(t.nextRecurringDate))} status=${t.status}`));

  // ── 5. Creation bursts (same title created within 2 min = double-submit) ───
  const bursts = [];
  const byTitleBiz = new Map();
  for (const t of tasks) {
    const key = [t.businessId || '-', norm(t.title)].join('||');
    if (!byTitleBiz.has(key)) byTitleBiz.set(key, []);
    byTitleBiz.get(key).push(t);
  }
  for (const [key, g] of byTitleBiz) {
    if (g.length < 2) continue;
    const sorted = g.filter((t) => d(t.createdAt)).sort((a, b) => d(a.createdAt) - d(b.createdAt));
    for (let i = 1; i < sorted.length; i++) {
      const gap = d(sorted[i].createdAt) - d(sorted[i - 1].createdAt);
      if (gap < 120000) bursts.push({ key, a: sorted[i - 1], b: sorted[i], gapSec: Math.round(gap / 1000) });
    }
  }
  console.log(`\n== DOUBLE-SUBMIT SUSPECTS (same title, created <2 min apart): ${bursts.length} ==`);
  bursts.slice(0, 25).forEach((x) => console.log(`  ${x.gapSec}s  ${x.key}\n      ${x.a.id} @ ${d(x.a.createdAt).toISOString()}\n      ${x.b.id} @ ${d(x.b.createdAt).toISOString()}`));

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
