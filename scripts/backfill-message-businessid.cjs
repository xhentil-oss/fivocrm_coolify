// Usage: node scripts/backfill-message-businessid.cjs [--apply]
// Stamps businessId on `messages` that lack it, for client-channel messages
// (channelId = client-<customerId>[...]). businessId is taken from the channel's
// customer doc. Without --apply it's a dry run. DM messages (no channelId) are
// left alone — the RLS rule authorizes those by senderId/receiverId.
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const saPath = path.join(__dirname, 'sa.json');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8'))) });
const db = admin.firestore();

const cidFromChannel = (ch) => {
  const m = (ch || '').match(/^client-([A-Za-z0-9]+)/);
  return m ? m[1] : null;
};

(async () => {
  const snap = await db.collection('messages').get();
  const customerBiz = {}; // cid -> businessId (cache)
  let toFix = 0, fixed = 0, skippedNoCustomer = 0, skippedNoCid = 0;

  const batchWrites = [];
  for (const d of snap.docs) {
    const x = d.data();
    if (x.businessId) continue;            // already has it
    const cid = cidFromChannel(x.channelId);
    if (!cid) { skippedNoCid++; continue; } // DM or non-client channel — leave it
    if (!(cid in customerBiz)) {
      const cust = await db.collection('customers').doc(cid).get();
      customerBiz[cid] = cust.exists ? (cust.data().businessId || null) : null;
    }
    const biz = customerBiz[cid];
    if (!biz) { skippedNoCustomer++; continue; }
    toFix++;
    if (APPLY) batchWrites.push(d.ref.update({ businessId: biz }));
  }

  if (APPLY) { await Promise.all(batchWrites); fixed = batchWrites.length; }
  console.log({ mode: APPLY ? 'APPLY' : 'DRY-RUN', total: snap.size, wouldFix: toFix, fixed, skippedNoCid, skippedNoCustomer });
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
