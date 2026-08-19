// Normalize LEGACY email-keyed teamMembers to real Firebase Auth uids, and
// rewrite every field that copied the email out of the roster.
//
// `teamMembers.userId` was sometimes an email (rows created before the uid was
// known). Every assignment picker copies that value verbatim, so one legacy row
// mints fresh email-keyed assignments daily — and every uid-only consumer
// (myTasks, daily-report plan, daily-report-check, Momentum, cron notifications)
// silently misses them. The daily-report checker even flags such a member
// "missing" every day AFTER they filed, and escalates to their managers.
//
// For each teamMembers row whose userId contains '@':
//   1. resolve the uid via Auth (by the row's email, falling back to userId)
//   2. RE-KEY the document to {teamId}_{uid} (delete + recreate — the docId is
//      part of the data model: rules resolve membership via exists() on it)
//   3. rewrite every referencing field within that businessId:
//        tasks/leads/customers/contracts/whatsappThreads.assignedToUserId,
//        projects.responsibleUserId + memberUserIds[] + profitSplit[].userId,
//        conversations.ownerId, reports.authorUserId/subjectUserId
//   No auth user for the email → skipped and reported (invite them first).
//
//   node scripts/normalize-member-userids.mjs          (dry-run)
//   node scripts/normalize-member-userids.mjs --apply

import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();
const auth = getAuth();

const SIMPLE_REFS = [
  ['tasks', 'assignedToUserId'],
  ['leads', 'assignedToUserId'],
  ['customers', 'assignedToUserId'],
  ['contracts', 'assignedToUserId'],
  ['whatsappThreads', 'assignedToUserId'],
  ['projects', 'responsibleUserId'],
  ['conversations', 'ownerId'],
  ['reports', 'authorUserId'],
  ['reports', 'subjectUserId'],
];

async function rewriteRefs(businessId, fromId, toId) {
  let total = 0;
  for (const [coll, field] of SIMPLE_REFS) {
    // whatsappThreads is team-scoped, not businessId-stamped — sweep unscoped
    // (admin SDK; the email value itself is the selector).
    const base = coll === 'whatsappThreads'
      ? db.collection(coll).where(field, '==', fromId)
      : db.collection(coll).where('businessId', '==', businessId).where(field, '==', fromId);
    const snap = await base.get();
    if (snap.empty) continue;
    console.log(`    ${coll}.${field}: ${snap.size} dokumente`);
    total += snap.size;
    if (APPLY) {
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = db.batch();
        snap.docs.slice(i, i + 400).forEach(d => batch.update(d.ref, { [field]: toId, updatedAt: Timestamp.now() }));
        await batch.commit();
      }
    }
  }
  // Array/nested fields on projects (memberUserIds[], profitSplit[].userId).
  const projSnap = await db.collection('projects').where('businessId', '==', businessId).get();
  for (const d of projSnap.docs) {
    const p = d.data();
    const patch = {};
    if (Array.isArray(p.memberUserIds) && p.memberUserIds.includes(fromId)) {
      patch.memberUserIds = p.memberUserIds.map(u => (u === fromId ? toId : u));
    }
    if (Array.isArray(p.profitSplit) && p.profitSplit.some(s => s?.userId === fromId)) {
      patch.profitSplit = p.profitSplit.map(s => (s?.userId === fromId ? { ...s, userId: toId } : s));
    }
    if (Object.keys(patch).length) {
      console.log(`    projects/${d.id}: memberUserIds/profitSplit`);
      total += 1;
      if (APPLY) await d.ref.update({ ...patch, updatedAt: Timestamp.now() });
    }
  }
  return total;
}

async function main() {
  console.log(`[normalize member userIds] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  const snap = await db.collection('teamMembers').get();
  const legacy = snap.docs.filter(d => String(d.data().userId || '').includes('@'));
  console.log(`teamMembers gjithsej: ${snap.size} · me email si userId: ${legacy.length}`);
  if (!legacy.length) { console.log('Asgjë për të normalizuar. ✓'); return; }

  for (const d of legacy) {
    const m = d.data();
    const email = String(m.email || m.userId).trim().toLowerCase();
    let uid;
    try {
      uid = (await auth.getUserByEmail(email)).uid;
    } catch {
      console.log(`  ⚠ ${d.id} (${email}): asnjë llogari Auth me këtë email — kapërcehet (ftojeni së pari)`);
      continue;
    }
    const newId = `${m.teamId}_${uid}`;
    console.log(`  ${d.id} → ${newId} (${email} → ${uid})`);
    const moved = await rewriteRefs(m.businessId || m.teamId, m.userId, uid);
    console.log(`    fusha të rishkruara: ${moved}`);
    if (APPLY) {
      // Re-key: the docId encodes {teamId}_{userId} and the rules' exists()
      // checks depend on it — an email-keyed row also has a broken membership key.
      await db.collection('teamMembers').doc(newId).set({ ...m, userId: uid, updatedAt: Timestamp.now() });
      if (d.id !== newId) await d.ref.delete();
    }
  }
  if (!APPLY) console.log('\nRun again with --apply to write.');
}
main().then(() => process.exit(0)).catch(e => { console.error(e.code || '', e.details || e.message); process.exit(1); });
