// Read-only deep dive: recurring series lineage + inverted date origins.
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(path.join(__dirname, 'sa.json'), 'utf8'))) });
const db = admin.firestore();

const d = (v) => (v && v.toDate ? v.toDate() : v ? new Date(v) : null);
const f = (x) => (x ? x.toISOString().replace('T', ' ').slice(0, 19) + ' (' + ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][x.getUTCDay()] + ')' : '—');

(async () => {
  const snap = await db.collection('tasks').get();
  const tasks = snap.docs.map((x) => ({ id: x.id, ...x.data() }));

  const series = ['rea seo', 'plumber', 'mirembajtje webi', 'jona academy', 'seo - pronto'];
  for (const s of series) {
    const g = tasks.filter((t) => (t.title || '').toLowerCase().replace(/\s+/g, ' ').trim() === s)
      .sort((a, b) => (d(a.createdAt) || 0) - (d(b.createdAt) || 0));
    console.log(`\n\n========= SERIES "${s}" (${g.length} rows) =========`);
    g.forEach((t) => {
      console.log(`  ${t.id} created=${f(d(t.createdAt))} by=${(t.createdByUserId || '-').slice(0, 8)}`);
      console.log(`      status=${t.status} start=${f(d(t.startDate))} end=${f(d(t.endDate))}`);
      console.log(`      next=${f(d(t.nextRecurringDate))} freq=${t.recurringFrequency} int=${t.recurringInterval} dow=${t.recurringDayOfWeek} doms=${t.recurringDayOfMonth} dows=${JSON.stringify(t.recurringDaysOfWeek)} end=${f(d(t.recurringEndDate))} flag=${t.nextCycleCreated} upd=${f(d(t.updatedAt))}`);
    });
  }

  // Inverted dates full dump
  console.log('\n\n========= INVERTED / ZERO-LENGTH DATES =========');
  tasks.filter((t) => { const s = d(t.startDate), e = d(t.endDate); return s && e && e <= s; })
    .sort((a, b) => (d(a.createdAt) || 0) - (d(b.createdAt) || 0))
    .forEach((t) => console.log(`  ${t.id} "${t.title}" start=${f(d(t.startDate))} end=${f(d(t.endDate))} rec=${!!t.isRecurring} freq=${t.recurringFrequency} dow=${t.recurringDayOfWeek} created=${f(d(t.createdAt))}`));

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
