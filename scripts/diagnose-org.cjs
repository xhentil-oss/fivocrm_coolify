// Usage: node scripts/diagnose-org.cjs
// Dumps teams (with owner), all teamMembers (role+team), and task counts per team.
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const saPath = path.join(__dirname, 'sa.json');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8'))) });
const db = admin.firestore();

(async () => {
  const teamsSnap = await db.collection('teams').get();
  const teamNameById = {};
  console.log(`\n=== teams (${teamsSnap.size}) ===`);
  teamsSnap.docs.forEach(d => {
    const x = d.data();
    teamNameById[d.id] = x.name;
    console.log(`  ${d.id}  name="${x.name}"  owner=${x.createdByUserId || '(none)'}`);
  });

  const tmSnap = await db.collection('teamMembers').get();
  console.log(`\n=== teamMembers (${tmSnap.size}) ===`);
  tmSnap.docs.forEach(d => {
    const x = d.data();
    console.log(`  ${(x.email||'').padEnd(32)} role=${(x.role||'').padEnd(10)} status=${(x.status||'').padEnd(8)} team=${teamNameById[x.teamId]||x.teamId} userId=${x.userId}`);
  });
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
