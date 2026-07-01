// Usage: node scripts/backfill-message-businessid.cjs [--apply]
// Stamps businessId on `messages` that lack it, so the tightened messages RLS
// (isBusinessMember(businessId) || sender/receiver || client-channel) doesn't
// deny channel queries that return legacy messages. businessId is derived from:
//   1) the channel's customer (client-<cid>), else
//   2) the message's teamId → businessId map (from teamMembers), else
//   3) left unset (true orphan) and reported.
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(path.join(__dirname, 'sa.json'), 'utf8'))) });
const db = admin.firestore();

const cidFromChannel = (ch) => { const m = (ch || '').match(/^client-([A-Za-z0-9]+)/); return m ? m[1] : null; };

(async () => {
  // teamId -> businessId map (from teamMembers, then businesses/teams as fallback)
  const tmSnap = await db.collection('teamMembers').get();
  const teamBiz = {};
  tmSnap.docs.forEach(d => { const x = d.data(); if (x.teamId && x.businessId) teamBiz[x.teamId] = x.businessId; });

  const snap = await db.collection('messages').get();

  // cid (client channel customer) -> businessId, learned from ANY sibling message
  // in that customer's channel that already has a businessId.
  const cidBiz = {};
  snap.docs.forEach(d => {
    const x = d.data();
    const cid = cidFromChannel(x.channelId);
    if (cid && x.businessId && !cidBiz[cid]) cidBiz[cid] = x.businessId;
  });

  const custBiz = {};
  let noBiz = 0, fixFromSibling = 0, fixFromCustomer = 0, fixFromTeam = 0, orphan = 0;
  const orphanList = [];
  const writes = [];

  for (const d of snap.docs) {
    const x = d.data();
    if (x.businessId) continue;
    noBiz++;
    let biz = null;
    const cid = cidFromChannel(x.channelId);
    if (cid && cidBiz[cid]) { biz = cidBiz[cid]; fixFromSibling++; }
    if (!biz && cid) {
      if (!(cid in custBiz)) { const c = await db.collection('customers').doc(cid).get(); custBiz[cid] = c.exists ? (c.data().businessId || null) : null; }
      biz = custBiz[cid];
      if (biz) fixFromCustomer++;
    }
    if (!biz && x.teamId && teamBiz[x.teamId]) { biz = teamBiz[x.teamId]; fixFromTeam++; }
    if (!biz) { orphan++; orphanList.push({ id: d.id, channelId: x.channelId || '(none)', senderType: x.senderType, teamId: x.teamId || null, senderId: x.senderId || null, receiverId: x.receiverId || null }); continue; }
    if (APPLY) writes.push(d.ref.update({ businessId: biz }));
  }

  if (APPLY) await Promise.all(writes);
  console.log({ mode: APPLY ? 'APPLY' : 'DRY-RUN', total: snap.size, noBiz, fixFromSibling, fixFromCustomer, fixFromTeam, orphanRemaining: orphan, wrote: APPLY ? writes.length : 0 });
  if (orphanList.length) { console.log('ORPHANS (no businessId, no customer, no team map):'); orphanList.forEach(o => console.log('  ', JSON.stringify(o))); }
  process.exit(0);
})().catch(e => { console.error(e.message || e); process.exit(1); });
