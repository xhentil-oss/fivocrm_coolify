// Usage: node scripts/diagnose-whmcs.cjs
// Diagnoses why WHMCS clients don't show: sync status, whmcs customers + their
// businessId/teamId, teams + their businessId, and the whmcs env presence.
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const saPath = path.join(__dirname, 'sa.json');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8'))) });
const db = admin.firestore();

(async () => {
  // 1) Sync status
  const st = await db.collection('integrations').doc('whmcs').get();
  console.log('=== integrations/whmcs (sync status) ===');
  if (st.exists) {
    const d = st.data();
    const fmt = (t) => t && t.toDate ? t.toDate().toISOString() : t;
    console.log(JSON.stringify({
      syncStatus: d.syncStatus, syncCursor: d.syncCursor,
      lastSyncAt: fmt(d.lastSyncAt), syncStartedAt: fmt(d.syncStartedAt),
      clientsCreated: d.clientsCreated, clientsUpdated: d.clientsUpdated,
      invoicesCreated: d.invoicesCreated, invoicesUpdated: d.invoicesUpdated,
      subsCreated: d.subsCreated, subsUpdated: d.subsUpdated,
      teamId: d.teamId, errorCount: d.errorCount, lastErrors: d.lastErrors,
    }, null, 2));
  } else {
    console.log('  (does not exist — the full sync has NEVER completed a write)');
  }

  // 2) Teams + businessId
  const teams = await db.collection('teams').get();
  console.log(`\n=== teams (${teams.size}) ===`);
  teams.docs.forEach(d => {
    const x = d.data();
    console.log(`  team=${d.id}  name="${x.name||''}"  businessId=${x.businessId || '(NONE)'}`);
  });

  // 3) WHMCS customers
  const whmcs = await db.collection('customers').where('source', '==', 'whmcs').get();
  console.log(`\n=== customers source=whmcs (${whmcs.size}) ===`);
  const missingBiz = [];
  whmcs.docs.map(d => {
    const x = d.data();
    const c = x.createdAt?.toMillis ? x.createdAt.toMillis() : 0;
    return { id: d.id, name: x.name, email: x.email, wid: x.whmcsClientId || null, teamId: x.teamId || null, businessId: x.businessId || null, createdAt: c };
  }).sort((a, b) => b.createdAt - a.createdAt).forEach(c => {
    if (!c.businessId) missingBiz.push(c.id);
    const day = c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 10) : '??????????';
    console.log(`  ${day}  biz=${String(c.businessId).padEnd(24)} team=${String(c.teamId).padEnd(24)} wid=${String(c.wid).padEnd(6)} ${c.name} <${c.email}>`);
  });
  console.log(`  → ${missingBiz.length} of ${whmcs.size} WHMCS customers have NO businessId`);

  // 4) Env presence (from process env — likely empty locally, but shows what's set)
  console.log('\n=== WHMCS env locally (names only) ===');
  ['WHMCS_API_URL','WHMCS_API_IDENTIFIER','WHMCS_API_SECRET','WHMCS_WEBHOOK_SECRET','WHMCS_TEAM_ID','WHMCS_BUSINESS_ID','WHMCS_PROXY_URL']
    .forEach(k => console.log(`  ${k}: ${process.env[k] ? 'set' : '(unset here)'}`));

  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
