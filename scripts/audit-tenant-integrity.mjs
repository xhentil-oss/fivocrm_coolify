// READ-ONLY audit: finds records whose teamId belongs to a DIFFERENT business
// than the record's own businessId (cross-tenant contamination), plus records
// missing businessId/teamId. No writes.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
if (!getApps().length) initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\n/g,'\n') }) });
const db = getFirestore();

const teamsSnap = await db.collection('teams').get();
const teamBiz = {};                        // teamId -> owning businessId
teamsSnap.forEach(d => { teamBiz[d.id] = d.data().businessId || null; });
const bizSnap = await db.collection('businesses').get();
const bizName = {}; bizSnap.forEach(d => bizName[d.id] = d.data().name || d.id);
const nm = (id) => id ? (bizName[id] || id.slice(0,8)) : '(asnjë)';

// Focus set (customer-facing + core). Excludes high-volume messages/typing.
const COLLS = ['customers','leads','clientPortalAccess','invoices','projects','tasks','quotes','deals','services','expenses','goals','contracts','serviceInquiries','activities','teamMembers','teamInvites'];

let grand = { contaminated: 0, orphanTeam: 0, noBiz: 0, noTeam: 0, ok: 0, total: 0 };
const pairTally = {};                       // "docBiz -> teamOwnerBiz" : count

for (const c of COLLS) {
  const snap = await db.collection(c).get();
  let contaminated=0, orphanTeam=0, noBiz=0, noTeam=0, ok=0;
  snap.forEach(d => {
    const x = d.data(); const t = x.teamId, b = x.businessId;
    if (!t) { noTeam++; return; }
    if (!b) { noBiz++; return; }
    const owner = teamBiz[t];
    if (owner === undefined) { orphanTeam++; return; }      // team doc missing
    if (owner !== b) {
      contaminated++;
      const key = `${nm(b)}  →  ekip i ${nm(owner)}`;
      pairTally[key] = (pairTally[key]||0)+1;
    } else ok++;
  });
  grand.contaminated+=contaminated; grand.orphanTeam+=orphanTeam; grand.noBiz+=noBiz; grand.noTeam+=noTeam; grand.ok+=ok; grand.total+=snap.size;
  const flag = (contaminated||orphanTeam) ? '  ⚠️' : '';
  console.log(`${c.padEnd(18)} total=${String(snap.size).padStart(5)}  kontaminuar=${String(contaminated).padStart(4)}  ekipJoekzistues=${String(orphanTeam).padStart(3)}  paBiz=${String(noBiz).padStart(3)}  paEkip=${String(noTeam).padStart(4)}${flag}`);
}
console.log('\n=== KONTAMINIMI sipas (biznesi i rekordit → ekipi i kujt) ===');
Object.entries(pairTally).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${v.toString().padStart(4)} × ${k}`));
console.log('\n=== TOTALE ===', JSON.stringify(grand));
process.exit(0);
