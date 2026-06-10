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
if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
  console.error('missing env values');
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});
const db = admin.firestore();
(async () => {
  console.log('Querying teamMembers by email and userId...');
  const email = 'dori@fivo.al';
  const userQ = db.collection('teamMembers').where('email', '==', email.toLowerCase());
  const userSnap = await userQ.get();
  console.log('teamMembers by email:', userSnap.size);
  for (const doc of userSnap.docs) {
    const data = doc.data();
    console.log('---');
    console.log('id:', doc.id);
    console.log(JSON.stringify(data, null, 2));
  }
  const teamIds = Array.from(new Set(userSnap.docs.map(d => d.data().teamId).filter(Boolean)));
  for (const teamId of teamIds) {
    const ts = await db.collection('teamSettings').doc(teamId).get();
    console.log('teamSettings', teamId, ts.exists ? JSON.stringify(ts.data(), null, 2) : 'missing');
  }
  console.log('Querying users by email...');
  const users = await db.collection('users').where('email', '==', email.toLowerCase()).get();
  console.log('users:', users.size);
  for (const doc of users.docs) {
    console.log('user id:', doc.id, JSON.stringify(doc.data(), null, 2));
  }
})();
