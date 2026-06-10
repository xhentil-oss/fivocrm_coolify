const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env.vercel.local');
const envText = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=("(.*)"|(.*))$/);
  if (m) env[m[1]] = m[3] !== undefined ? m[3] : m[4];
}
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});
const db = admin.firestore();
const norm = (p) => String(p || '').replace(/\D/g, '');
const hasPhone = (p) => norm(p).length >= 7;

(async () => {
  const leadsSnap = await db.collection('leads').get();
  const custSnap = await db.collection('customers').get();

  // Leads
  const byStatus = {};
  let leadsWithPhone = 0, leadsNoTeam = 0;
  const teamCounts = {};
  for (const d of leadsSnap.docs) {
    const l = d.data();
    byStatus[l.status || '(none)'] = (byStatus[l.status || '(none)'] || 0) + 1;
    if (hasPhone(l.phone || l.phoneNumber)) leadsWithPhone++;
    if (!l.teamId) leadsNoTeam++;
    teamCounts[l.teamId || '(none)'] = (teamCounts[l.teamId || '(none)'] || 0) + 1;
  }

  // Customers
  let custWithPhone = 0, custNoTeam = 0;
  const custTeamCounts = {};
  for (const d of custSnap.docs) {
    const c = d.data();
    if (hasPhone(c.phone)) custWithPhone++;
    if (!c.teamId) custNoTeam++;
    custTeamCounts[c.teamId || '(none)'] = (custTeamCounts[c.teamId || '(none)'] || 0) + 1;
  }

  console.log('===== LEADS =====');
  console.log('total leads:', leadsSnap.size);
  console.log('leads with phone (>=7 digits):', leadsWithPhone);
  console.log('leads without teamId:', leadsNoTeam);
  console.log('by status:', JSON.stringify(byStatus, null, 2));
  console.log('by teamId:', JSON.stringify(teamCounts, null, 2));

  console.log('\n===== CUSTOMERS =====');
  console.log('total customers:', custSnap.size);
  console.log('customers with phone:', custWithPhone);
  console.log('customers without teamId:', custNoTeam);
  console.log('by teamId:', JSON.stringify(custTeamCounts, null, 2));

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
