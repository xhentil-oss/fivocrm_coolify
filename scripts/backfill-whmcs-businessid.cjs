// Usage: node scripts/backfill-whmcs-businessid.cjs [--apply]
// Sets businessId on WHMCS customers/invoices/subscriptions that are missing it,
// using the dominant businessId already present on synced WHMCS customers.
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(path.join(__dirname, 'sa.json'), 'utf8'))) });
const db = admin.firestore();

(async () => {
  // Determine the dominant businessId among existing WHMCS customers.
  const whmcs = await db.collection('customers').where('source', '==', 'whmcs').get();
  const counts = new Map();
  whmcs.docs.forEach(d => { const b = d.data().businessId; if (b) counts.set(b, (counts.get(b) || 0) + 1); });
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  console.log('Dominant WHMCS businessId:', dominant, '(counts:', JSON.stringify([...counts.entries()]), ')');
  if (!dominant) { console.log('No dominant businessId found — aborting.'); process.exit(1); }

  let fixed = 0;
  const targets = [];
  for (const col of ['customers', 'invoices', 'subscriptions']) {
    const snap = await db.collection(col).where('source', '==', 'whmcs').get();
    for (const d of snap.docs) {
      if (!d.data().businessId) { targets.push({ col, ref: d.ref, name: d.data().name || d.data().invoiceNumber || d.data().productName || d.id }); }
    }
  }
  console.log(`\n${targets.length} docs missing businessId:`);
  targets.forEach(t => console.log(`  [${t.col}] ${t.name}`));

  if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply to write.'); process.exit(0); }

  for (const t of targets) {
    await t.ref.update({ businessId: dominant, updatedAt: admin.firestore.Timestamp.now() });
    fixed++;
  }
  console.log(`\nApplied businessId=${dominant} to ${fixed} docs.`);
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
