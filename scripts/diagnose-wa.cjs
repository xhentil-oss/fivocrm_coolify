// Usage: node scripts/diagnose-wa.cjs
// Shows which teams have WhatsApp enabled (teamSettings) and where WA accounts live.
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(path.join(__dirname, 'sa.json'), 'utf8'))) });
const db = admin.firestore();

(async () => {
  const teams = {};
  (await db.collection('teams').get()).docs.forEach(d => { teams[d.id] = d.data().name; });

  console.log('\n=== teamSettings: whatsappEnabled / metaEnabled / vps ===');
  const ts = await db.collection('teamSettings').get();
  ts.docs.forEach(d => {
    const x = d.data();
    console.log(`  ${(teams[d.id] || d.id).padEnd(24)} waEnabled=${x.whatsappEnabled} metaEnabled=${x.metaEnabled} vps=${!!x.whatsappVpsUrl} channels=${(x.metaChannels||[]).length}`);
  });

  for (const coll of ['whatsappAccounts', 'whatsappThreads']) {
    const snap = await db.collection(coll).get();
    const byTeam = {};
    snap.docs.forEach(d => { const t = d.data().teamId || '(none)'; byTeam[t] = (byTeam[t] || 0) + 1; });
    console.log(`\n=== ${coll} by team (${snap.size}) ===`);
    Object.entries(byTeam).forEach(([t, n]) => console.log(`  ${n}  ${teams[t] || t}`));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
