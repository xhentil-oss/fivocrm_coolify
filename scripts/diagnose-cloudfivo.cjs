// Usage: node scripts/diagnose-cloudfivo.cjs
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(path.join(__dirname, 'sa.json'), 'utf8'))) });
const db = admin.firestore();

const fmt = (t) => { if (!t) return null; const d = t.toDate ? t.toDate() : new Date(t); return isNaN(d) ? String(t) : d.toISOString(); };

(async () => {
  const snap = await db.collection('tasks').get();
  const matches = snap.docs.filter(d => (d.data().title || '').toLowerCase().includes('cloudfivo'));
  console.log(`\n=== tasks matching "cloudfivo": ${matches.length} ===`);
  matches.forEach(d => {
    const x = d.data();
    console.log({
      id: d.id,
      title: x.title,
      status: x.status,
      isRecurring: x.isRecurring,
      freq: x.recurringFrequency,
      interval: x.recurringInterval,
      daysOfWeek: x.recurringDaysOfWeek,
      dayOfMonth: x.recurringDayOfMonth,
      nextCycleCreated: x.nextCycleCreated,
      startDate: fmt(x.startDate),
      endDate: fmt(x.endDate),
      nextRecurringDate: fmt(x.nextRecurringDate),
      assignedToUserId: x.assignedToUserId,
      businessId: x.businessId,
      parentTaskId: x.parentTaskId || null,
    });
  });
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
