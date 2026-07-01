// Usage: node scripts/diagnose-elton-recurring.cjs
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(path.join(__dirname, 'sa.json'), 'utf8'))) });
const db = admin.firestore();
const fmt = (t) => { if (!t) return null; const d = t.toDate ? t.toDate() : new Date(t); return isNaN(d) ? String(t) : d.toISOString().slice(0,10) + ' (' + ['Die','Hën','Mar','Mër','Enj','Pre','Sht'][d.getDay()] + ')'; };

(async () => {
  // find elton's uid
  const tm = await db.collection('teamMembers').get();
  const elton = tm.docs.map(d => d.data()).find(m => (m.email||'').toLowerCase().includes('elton'));
  console.log('Elton:', elton ? { email: elton.email, userId: elton.userId, businessId: elton.businessId } : 'NOT FOUND');
  const uid = elton?.userId;

  const snap = await db.collection('tasks').where('isRecurring','==', true).get();
  console.log(`\n=== ALL recurring tasks: ${snap.size} ===`);
  snap.docs.forEach(d => {
    const x = d.data();
    const mine = uid && x.assignedToUserId === uid ? ' <== ELTON' : '';
    console.log(`- "${x.title}" freq=${x.recurringFrequency} dow=${x.recurringDayOfWeek} daysOfWeek=${JSON.stringify(x.recurringDaysOfWeek)} dom=${x.recurringDayOfMonth} status=${x.status} tip=${!x.nextCycleCreated} start=${fmt(x.startDate)} end=${fmt(x.endDate)} until=${fmt(x.recurringEndDate)}${mine}`);
  });
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
