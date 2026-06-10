// Usage: node scripts/find-by-email.cjs mentor.grulaj@gmail.com
// Searches customers, leads, clientPortalAccess for a given email and prints
// exactly where the record lives and its key fields (teamId, status, assignee).
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const target = (process.argv[2] || '').toLowerCase().trim();
if (!target) { console.error('Pass an email: node scripts/find-by-email.cjs someone@example.com'); process.exit(1); }

// Credentials: prefer a downloaded service-account JSON at scripts/sa.json,
// otherwise fall back to the three vars in .env.vercel.local.
const saPath = path.join(__dirname, 'sa.json');
let cred;
if (fs.existsSync(saPath)) {
  cred = admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8')));
} else {
  const envText = fs.readFileSync(path.join(__dirname, '..', '.env.vercel.local'), 'utf8');
  const env = {};
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=("(.*)"|(.*))$/);
    if (m) env[m[1]] = m[3] !== undefined ? m[3] : m[4];
  }
  cred = admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  });
}
admin.initializeApp({ credential: cred });
const db = admin.firestore();

async function scan(coll) {
  const snap = await db.collection(coll).get();
  const hits = [];
  for (const d of snap.docs) {
    const x = d.data();
    const email = (x.email || '').toLowerCase();
    if (email === target) {
      hits.push({
        id: d.id,
        name: x.name,
        email: x.email,
        phone: x.phone || x.phoneNumber || null,
        teamId: x.teamId || '(none)',
        status: x.status || null,
        assignedToUserId: x.assignedToUserId || null,
        createdByUserId: x.createdByUserId || null,
      });
    }
  }
  console.log(`\n=== ${coll} (${snap.size} total) — matches: ${hits.length} ===`);
  hits.forEach((h) => console.log(JSON.stringify(h, null, 2)));
}

(async () => {
  for (const c of ['customers', 'leads', 'clientPortalAccess']) await scan(c);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
