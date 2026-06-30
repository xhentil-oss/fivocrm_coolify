// Usage: node scripts/diagnose-messages.cjs
// Audits the `messages` collection to plan the RLS tightening:
//  - how many messages have businessId, teamId, both, neither
//  - whether businessId === teamId on staff vs client messages
//  - channelId shapes (client-*, group, team)
//  - whether users/{uid}.businessId === their teamId (the rule's trust field)
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const saPath = path.join(__dirname, 'sa.json');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8'))) });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('messages').get();
  console.log(`\n=== messages total: ${snap.size} ===`);

  let hasBiz = 0, hasTeam = 0, both = 0, neither = 0, bizEqTeam = 0, bizNeTeam = 0;
  const byType = {};            // senderType -> count
  const channelShapes = { client: 0, group: 0, dm_nochannel: 0, other_channel: 0 };
  const clientMsgBizState = { hasBiz: 0, noBiz: 0, bizEqTeam: 0, bizNeTeam: 0 };

  snap.docs.forEach(d => {
    const x = d.data();
    const b = x.businessId, t = x.teamId;
    if (b) hasBiz++; if (t) hasTeam++;
    if (b && t) { both++; if (b === t) bizEqTeam++; else bizNeTeam++; }
    if (!b && !t) neither++;

    const st = x.senderType || '(none)';
    byType[st] = (byType[st] || 0) + 1;

    const ch = x.channelId || '';
    if (/^client-/.test(ch)) channelShapes.client++;
    else if (/^group-/.test(ch)) channelShapes.group++;
    else if (!ch) channelShapes.dm_nochannel++;
    else channelShapes.other_channel++;

    if (st === 'client') {
      if (b) clientMsgBizState.hasBiz++; else clientMsgBizState.noBiz++;
      if (b && t) { if (b === t) clientMsgBizState.bizEqTeam++; else clientMsgBizState.bizNeTeam++; }
    }
  });

  console.log({ hasBiz, hasTeam, both, neither, bizEqTeam, bizNeTeam });
  console.log('senderType:', byType);
  console.log('channelShapes:', channelShapes);
  console.log('client-message businessId state:', clientMsgBizState);

  // Cross-check: staff users — is users/{uid}.businessId === their teamMembers.teamId?
  const usersSnap = await db.collection('users').get();
  const tmSnap = await db.collection('teamMembers').get();
  const teamByUser = {};
  tmSnap.docs.forEach(d => { const x = d.data(); if (x.userId) teamByUser[x.userId] = x.teamId; });
  let uEq = 0, uNe = 0, uNoBiz = 0, uIsClient = 0;
  usersSnap.docs.forEach(d => {
    const x = d.data();
    if (x.customerId) { uIsClient++; return; }
    if (!x.businessId) { uNoBiz++; return; }
    const tm = teamByUser[d.id];
    if (tm && x.businessId === tm) uEq++;
    else if (tm) uNe++;
  });
  console.log('staff users businessId vs teamMembers.teamId:', { eq: uEq, ne: uNe, noBiz: uNoBiz, portalClients: uIsClient });

  // Sample 5 client messages + 5 team messages with their key fields
  const sample = (pred, n) => snap.docs.filter(pred).slice(0, n).map(d => {
    const x = d.data(); return { id: d.id, ch: x.channelId, st: x.senderType, biz: x.businessId, team: x.teamId, sender: x.senderId, recv: x.receiverId };
  });
  console.log('sample client msgs:', sample(d => d.data().senderType === 'client', 5));
  console.log('sample channel msgs:', sample(d => /^client-/.test(d.data().channelId || '') && d.data().senderType !== 'client', 5));
  console.log('sample team-channel msgs:', sample(d => d.data().channelId && !/^client-|^group-/.test(d.data().channelId), 5));

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
