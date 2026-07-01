// Usage: node scripts/backfill-user-businessid.cjs [--apply]
// Ensures every staff user can be resolved to a businessId, so isBusinessMember-
// based RLS (chat messages, CRM) works for everyone. Fixes:
//   1) teamMembers.businessId (undefined) -> derived from a teamId->businessId map
//   2) users/{uid}.businessId (missing) -> from that user's teamMember businessId
// teamId->businessId is learned from teamMembers/messages/tasks that already carry both.
const admin = require('firebase-admin');
const fs = require('fs'); const path = require('path');
const APPLY = process.argv.includes('--apply');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(path.join(__dirname,'sa.json'),'utf8'))) });
const db = admin.firestore();

(async () => {
  const teamBiz = {}; // teamId -> businessId
  const learn = (teamId, businessId) => { if (teamId && businessId && !teamBiz[teamId]) teamBiz[teamId] = businessId; };

  const tmSnap = await db.collection('teamMembers').get();
  tmSnap.docs.forEach(d => { const x = d.data(); learn(x.teamId, x.businessId); });
  // Augment the map from team-scoped data that carries both fields.
  for (const col of ['messages', 'tasks', 'invoices', 'projects', 'leads']) {
    const s = await db.collection(col).get();
    s.docs.forEach(d => { const x = d.data(); learn(x.teamId, x.businessId); });
  }
  console.log('teamId->businessId learned for', Object.keys(teamBiz).length, 'teams');

  // 1) teamMembers missing businessId
  let tmFixed = 0, tmUnresolved = 0;
  const tmWrites = [];
  const memberBizByUid = {}; // uid -> businessId (after fix)
  tmSnap.docs.forEach(d => {
    const x = d.data();
    let biz = x.businessId || (x.teamId ? teamBiz[x.teamId] : null);
    if (x.userId && biz) memberBizByUid[x.userId] = biz;
    if (!x.businessId) {
      if (biz) { tmFixed++; if (APPLY) tmWrites.push(d.ref.update({ businessId: biz })); }
      else tmUnresolved++;
    }
  });

  // 2) users docs missing businessId (staff only — those with a teamMember)
  let uFixed = 0, uUnresolved = 0;
  const uWrites = [];
  for (const uid of Object.keys(memberBizByUid)) {
    const uref = db.collection('users').doc(uid);
    const u = await uref.get();
    if (u.exists && u.data().businessId) continue;
    const biz = memberBizByUid[uid];
    if (biz) { uFixed++; if (APPLY) uWrites.push(uref.set({ businessId: biz }, { merge: true })); }
    else uUnresolved++;
  }

  if (APPLY) { await Promise.all(tmWrites); await Promise.all(uWrites); }
  console.log({ mode: APPLY ? 'APPLY' : 'DRY-RUN', teamMembersFixed: tmFixed, teamMembersUnresolved: tmUnresolved, usersFixed: uFixed, usersUnresolved: uUnresolved });
  process.exit(0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
