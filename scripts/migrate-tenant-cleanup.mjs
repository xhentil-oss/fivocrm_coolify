// Tenant data cleanup migration.
//   DRY-RUN (default): prints exactly what WOULD change, writes nothing.
//   APPLY: set APPLY=1 to perform the writes (batched).
//
// Fixes:
//   A) teamId contamination — a record whose teamId belongs to a DIFFERENT
//      business than the record's own businessId is re-pointed to the correct
//      business's default team.
//   B) missing businessId — backfilled from the record's customer/parent/team.
//
// Run: node --env-file=.env.pull scripts/migrate-tenant-cleanup.mjs        (dry-run)
//      APPLY=1 node --env-file=.env.pull scripts/migrate-tenant-cleanup.mjs (apply)

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { writeFileSync } from 'fs';
if (!getApps().length) initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g,'\n') }) });
const db = getFirestore();
const APPLY = process.env.APPLY === '1';

const AGJ = 'Ni4TMKwoSLARWwCILjTp';        // Agjencia (main tenant)
const COLLS = ['customers','leads','clientPortalAccess','invoices','projects','tasks','quotes','deals','services','expenses','goals','contracts','serviceInquiries','activities','teamMembers','teamInvites'];

// Maps
const teamsSnap = await db.collection('teams').get();
const teamBiz = {}; teamsSnap.forEach(d => teamBiz[d.id] = d.data().businessId || null);
const bizSnap = await db.collection('businesses').get();
const bizName = {}; bizSnap.forEach(d => bizName[d.id] = d.data().name || d.id);
const nm = (id) => id ? (bizName[id] || id.slice(0,8)) : '(asnjë)';

// ── Default team per business (target for contaminated records) ──
// Prefer a team OWNED by the business that already holds the most correctly-
// assigned records; Agjencia gets a dedicated "Përgjithshëm" (created on apply).
async function ensureAgjenciaGeneralTeam() {
  const existing = teamsSnap.docs.find(d => d.data().businessId === AGJ && (d.data().name || '').toLowerCase() === 'përgjithshëm');
  if (existing) return existing.id;
  if (!APPLY) return '<NEW: Përgjithshëm (Agjencia)>';
  const ref = db.collection('teams').doc();
  await ref.set({ name: 'Përgjithshëm', businessId: AGJ, createdByUserId: 'migration', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
  teamBiz[ref.id] = AGJ;
  return ref.id;
}
const defaultTeam = {};
async function defaultTeamFor(bid) {
  if (defaultTeam[bid]) return defaultTeam[bid];
  if (bid === AGJ) { defaultTeam[bid] = await ensureAgjenciaGeneralTeam(); return defaultTeam[bid]; }
  const owned = teamsSnap.docs.filter(d => d.data().businessId === bid);
  defaultTeam[bid] = owned.length ? owned[0].id : null;   // its own team
  return defaultTeam[bid];
}

// ── Backfill businessId helper (from customer → team) ──
async function deriveBusinessId(x) {
  if (x.customerId) {
    try { const c = await db.collection('customers').doc(x.customerId).get(); const b = c.exists ? c.data().businessId : null; if (b) return b; } catch {}
  }
  if (x.teamId && teamBiz[x.teamId]) return teamBiz[x.teamId];
  return null;
}

const plan = { fixTeam: [], fixBiz: [], skipped: [] };

for (const coll of COLLS) {
  const snap = await db.collection(coll).get();
  for (const d of snap.docs) {
    const x = d.data(); const t = x.teamId, b = x.businessId;
    // A) contamination: teamId owned by another business
    if (t && b && teamBiz[t] !== undefined && teamBiz[t] !== b) {
      const target = await defaultTeamFor(b);
      if (target) plan.fixTeam.push({ coll, id: d.id, from: t, to: target, biz: b });
      else plan.skipped.push({ coll, id: d.id, why: `s'ka ekip për ${nm(b)}` });
      continue;
    }
    // B) missing businessId → backfill (only when derivable)
    if (!b) {
      const derived = await deriveBusinessId(x);
      if (derived) plan.fixBiz.push({ coll, id: d.id, to: derived, addTeam: !t && teamBiz && Object.keys(teamBiz).find(tid=>teamBiz[tid]===derived) ? null : null });
      else plan.skipped.push({ coll, id: d.id, why: 'businessId i paderivueshëm' });
    }
  }
}

// ── Report ──
const byPair = {};
plan.fixTeam.forEach(p => { const k = `${p.coll}: ${nm(p.biz)} (ekip ${p.from.slice(0,6)} → ${String(p.to).slice(0,10)})`; byPair[k]=(byPair[k]||0)+1; });
console.log(`\n=== A) teamId contamination → ${plan.fixTeam.length} rekorde ===`);
Object.entries(byPair).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${String(v).padStart(4)} × ${k}`));
const bizByColl = {};
plan.fixBiz.forEach(p => { const k = `${p.coll} → ${nm(p.to)}`; bizByColl[k]=(bizByColl[k]||0)+1; });
console.log(`\n=== B) backfill businessId → ${plan.fixBiz.length} rekorde ===`);
Object.entries(bizByColl).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${String(v).padStart(4)} × ${k}`));
console.log(`\n=== SKIPPED (s'preken) → ${plan.skipped.length} ===`);
const skipBy = {}; plan.skipped.forEach(s=>{const k=`${s.coll}: ${s.why}`;skipBy[k]=(skipBy[k]||0)+1;});
Object.entries(skipBy).forEach(([k,v])=>console.log(`  ${String(v).padStart(4)} × ${k}`));

if (!APPLY) { console.log('\n[DRY-RUN] Asgjë s\'u shkrua. Vendos APPLY=1 për të aplikuar.\n'); process.exit(0); }

// ── APPLY (batched, ≤450/batch) ──
console.log('\n[APPLY] Po shkruaj…');
console.log(`[APPLY] Agjencia "Përgjithshëm" teamId = ${defaultTeam[AGJ]}  ← vendose te VITE_DEFAULT_TEAM_ID + WHMCS_TEAM_ID`);
// Rollback backup: old values for every record we touch (fixTeam→restore teamId
// to `from`; fixBiz→restore businessId to null since it was missing).
const backup = { ts: Date.now(), fixTeam: plan.fixTeam.map(p => ({ coll: p.coll, id: p.id, oldTeamId: p.from })), fixBiz: plan.fixBiz.map(p => ({ coll: p.coll, id: p.id, oldBusinessId: null })) };
const backupFile = `migration-backup-${backup.ts}.json`;
writeFileSync(backupFile, JSON.stringify(backup, null, 2));
console.log(`[APPLY] Backup për rollback: ${backupFile}`);
let batch = db.batch(), n = 0, written = 0;
const flush = async () => { if (n) { await batch.commit(); written += n; batch = db.batch(); n = 0; } };
for (const p of plan.fixTeam) { batch.update(db.collection(p.coll).doc(p.id), { teamId: p.to, updatedAt: Timestamp.now() }); if (++n>=450) await flush(); }
for (const p of plan.fixBiz) { batch.update(db.collection(p.coll).doc(p.id), { businessId: p.to, updatedAt: Timestamp.now() }); if (++n>=450) await flush(); }
await flush();
console.log(`[APPLY] U përditësuan ${written} rekorde.\n`);
process.exit(0);
