// One-off helper: list every tenant (business) with its teamId, businessId,
// admins and customer count, so we can pick the MAIN tenant's ids for
// VITE_DEFAULT_TEAM_ID / VITE_DEFAULT_BUSINESS_ID.
//
// Needs Firebase Admin credentials (bypasses security rules). Provide ONE of:
//   1) A service account JSON file, then run:
//        GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/find-tenants.mjs
//   2) The full JSON in an env var:
//        FIREBASE_SERVICE_ACCOUNT_JSON='{...}' node scripts/find-tenants.mjs
//   3) The three split vars (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
//      FIREBASE_PRIVATE_KEY) — e.g. after `vercel env pull .env.local`, then:
//        node --env-file=.env.local scripts/find-tenants.mjs
//
// The service-account.json is gitignored-safe: keep it out of git.

import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function initAdmin() {
  if (getApps().length) return;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    initializeApp({ credential: cert(JSON.parse(json)) });
    return;
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (projectId && clientEmail && privateKey) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
    return;
  }
  // Falls back to GOOGLE_APPLICATION_CREDENTIALS (a service-account.json path).
  initializeApp({ credential: applicationDefault() });
}

initAdmin();
const db = getFirestore();

const [businessesSnap, teamsSnap, membersSnap, customersSnap] = await Promise.all([
  db.collection('businesses').get(),
  db.collection('teams').get(),
  db.collection('teamMembers').get(),
  db.collection('customers').get(),
]);

// businessId -> customer count
const custCount = {};
customersSnap.forEach((d) => {
  const b = d.data().businessId || '(none)';
  custCount[b] = (custCount[b] || 0) + 1;
});

// businessId -> { teamIds:Set, admins:[], memberCount }
const byBiz = {};
membersSnap.forEach((d) => {
  const m = d.data();
  const b = m.businessId || '(none)';
  byBiz[b] = byBiz[b] || { teamIds: new Set(), admins: [], memberCount: 0 };
  byBiz[b].memberCount++;
  if (m.teamId) byBiz[b].teamIds.add(m.teamId);
  if (m.role === 'Admin') byBiz[b].admins.push(m.email || m.userId);
});

const bizName = {};
businessesSnap.forEach((d) => {
  const b = d.data();
  bizName[d.id] = { name: b.name || '(pa emër)', ownerId: b.ownerId, portalSubdomain: b.portalSubdomain || null };
});

console.log('\n===== TENANTS (businesses) =====\n');
const rows = Object.keys({ ...bizName, ...byBiz }).map((bid) => ({
  businessId: bid,
  name: bizName[bid]?.name || '(business doc mungon)',
  portalSubdomain: bizName[bid]?.portalSubdomain || '—',
  teamIds: byBiz[bid] ? [...byBiz[bid].teamIds] : [],
  members: byBiz[bid]?.memberCount || 0,
  customers: custCount[bid] || 0,
  admins: byBiz[bid]?.admins || [],
}));
// Sort by customer count desc — the busiest tenant is usually the main one.
rows.sort((a, b) => b.customers - a.customers);

for (const r of rows) {
  console.log(`• ${r.name}`);
  console.log(`    businessId : ${r.businessId}`);
  console.log(`    teamId(s)  : ${r.teamIds.join(', ') || '—'}`);
  console.log(`    subdomain  : ${r.portalSubdomain}`);
  console.log(`    klientë    : ${r.customers}   anëtarë: ${r.members}`);
  console.log(`    admins     : ${r.admins.join(', ') || '—'}`);
  console.log('');
}
console.log('Kryesori zakonisht = ai me më shumë klientë. Vendos VITE_DEFAULT_TEAM_ID + VITE_DEFAULT_BUSINESS_ID nga rreshti i tij.\n');
process.exit(0);
