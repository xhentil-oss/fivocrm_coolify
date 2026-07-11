// Usage: node scripts/diagnose-whmcs-products.cjs
// Shows what product/subscription data we have to target campaigns by purchase.
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(path.join(__dirname, 'sa.json'), 'utf8'))) });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('subscriptions').get();
  console.log(`subscriptions total: ${snap.size}`);
  const byProduct = new Map();
  let withCustomer = 0, withDomain = 0;
  const domainSamples = [];
  snap.docs.forEach(d => {
    const x = d.data();
    const p = x.productName || '(none)';
    byProduct.set(p, (byProduct.get(p) || 0) + 1);
    if (x.customerId) withCustomer++;
    if (x.domain) { withDomain++; if (domainSamples.length < 8) domainSamples.push(`${x.productName} → ${x.domain}`); }
  });
  console.log(`with customerId: ${withCustomer}/${snap.size}   with domain field: ${withDomain}/${snap.size}`);
  console.log('\n=== productName counts ===');
  [...byProduct.entries()].sort((a, b) => b[1] - a[1]).forEach(([p, c]) => console.log(`  ${String(c).padStart(3)}  ${p}`));
  console.log('\n=== sample domain values ===');
  domainSamples.forEach(s => console.log('  ' + s));

  // Does WHMCS domain registrations exist anywhere? (we only sync GetClientsProducts)
  const domainsCol = await db.collection('domains').limit(1).get().catch(() => ({ size: 0, empty: true }));
  console.log(`\ncollection 'domains' exists: ${!domainsCol.empty} (size sample: ${domainsCol.size})`);
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
