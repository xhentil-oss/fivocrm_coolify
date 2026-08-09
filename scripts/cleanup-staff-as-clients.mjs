// Undo the "invited colleague became a customer/lead" pollution.
//
// A team invite creates a `teamInvites` row and nothing else — the membership only
// appears once the invite is accepted. Until then the person had no role, so the app
// read them as a client: the default redirect sent them to /portal and
// useClientPortal auto-created a Customer + clientPortalAccess + Lead in their own
// company's CRM. The code paths are fixed (src/lib/staffIdentity.ts); this repairs
// the rows already written.
//
// Scope, deliberately narrow — only records that are UNMISTAKABLY auto-provisioned:
//   • the email belongs to a staff member or to a pending invite,
//   • the record was created BY THAT PERSON'S OWN uid (portal auto-create /
//     public registration always stamps createdByUserId = the new user),
//   • the customer/lead carries no business history (no invoices, projects, quotes
//     or orders pointing at it) — anything with history is REPORTED, never touched.
// It also clears `users/{uid}.customerId`, which is what makes Firestore treat a
// staff account as a portal client.
//
// Dry-run by default. Every deletion is snapshotted into `staffClientCleanup` first.
//
// Usage: node scripts/cleanup-staff-as-clients.mjs [--apply] [--email=<addr>]
import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const APPLY = process.argv.includes('--apply');
const emailArg = process.argv.find((a) => a.startsWith('--email='));
const onlyEmail = emailArg ? emailArg.split('=')[1].toLowerCase() : null;

const lower = (v) => (typeof v === 'string' ? v.toLowerCase().trim() : '');

// Collections that would make a customer/lead "real" — if any row points at the
// record, a human decides, not this script.
const CUSTOMER_HISTORY = ['invoices', 'projects', 'quotes', 'contracts', 'shopOrders', 'clientRequests'];
const LEAD_HISTORY = ['quotes', 'leadActivities', 'invoices'];

async function hasHistory(collections, field, id) {
  for (const coll of collections) {
    const snap = await db.collection(coll).where(field, '==', id).limit(1).get();
    if (!snap.empty) return `${coll}`;
  }
  return null;
}

(async () => {
  // ── 1. Who is staff (or invited)? ──
  const staffEmails = new Map(); // email → { reason, uids:Set }
  const note = (email, reason) => {
    const e = lower(email);
    if (!e) return;
    if (!staffEmails.has(e)) staffEmails.set(e, { reason, uids: new Set() });
  };

  const members = await db.collection('teamMembers').get();
  members.forEach((d) => {
    const m = d.data();
    if (m.status === 'Inactive') return;
    note(m.email, 'anëtar stafi');
    if (m.email && m.userId) staffEmails.get(lower(m.email))?.uids.add(m.userId);
  });

  const invites = await db.collection('teamInvites').get();
  const now = Date.now();
  invites.forEach((d) => {
    const i = d.data();
    if (i.status === 'Accepted' || i.status === 'Cancelled') return;
    const exp = i.expiresAt?.toDate ? i.expiresAt.toDate() : (i.expiresAt ? new Date(i.expiresAt) : null);
    if (exp && exp.getTime() < now) return;
    note(i.email, 'ftesë në pritje');
  });

  const targets = [...staffEmails.entries()].filter(([e]) => !onlyEmail || e === onlyEmail);
  console.log(`Staf/të ftuar: ${staffEmails.size}${onlyEmail ? ` (filtruar: ${onlyEmail})` : ''}\n`);

  const plan = [];   // { kind, coll, id, data }
  const kept = [];   // { kind, id, why }

  for (const [email, info] of targets) {
    // The uid that would have created the auto-provisioned rows.
    const uids = new Set(info.uids);
    try {
      const authUser = await (await import('firebase-admin/auth')).getAuth().getUserByEmail(email);
      if (authUser?.uid) uids.add(authUser.uid);
    } catch { /* no auth account — the rows below simply won't match */ }
    if (!uids.size) continue;

    for (const [coll, historyColls, historyField] of [
      ['customers', CUSTOMER_HISTORY, 'customerId'],
      ['leads', LEAD_HISTORY, 'leadId'],
    ]) {
      const snap = await db.collection(coll).where('email', '==', email).get();
      for (const d of snap.docs) {
        const data = d.data();
        if (!uids.has(data.createdByUserId)) {
          kept.push({ kind: coll, id: d.id, why: 'nuk u krijua nga vetë personi (mund të jetë klient i vërtetë)' });
          continue;
        }
        const history = await hasHistory(historyColls, historyField, d.id);
        if (history) {
          kept.push({ kind: coll, id: d.id, why: `ka histori në ${history}` });
          continue;
        }
        plan.push({ kind: `${coll} (${email}) — ${info.reason}`, coll, id: d.id, data });
      }
    }

    // Portal access + the users/{uid}.customerId marker that makes rules see a client.
    for (const uid of uids) {
      const pa = await db.collection('clientPortalAccess').where('userId', '==', uid).get();
      pa.forEach((d) => plan.push({ kind: `clientPortalAccess (${email})`, coll: 'clientPortalAccess', id: d.id, data: d.data() }));

      const uDoc = await db.collection('users').doc(uid).get();
      if (uDoc.exists && uDoc.data().customerId) {
        plan.push({ kind: `users/${uid}.customerId`, coll: 'users', id: uid, data: uDoc.data(), fieldOnly: 'customerId' });
      }
    }
  }

  if (kept.length) {
    console.log('RUHEN (kërkojnë vendim njerëzor):');
    kept.forEach((k) => console.log(`  · ${k.kind}/${k.id} — ${k.why}`));
    console.log('');
  }

  if (!plan.length) { console.log('Asgjë për të pastruar.'); process.exit(0); }

  console.log(`PËR T'U HEQUR (${plan.length}):`);
  plan.forEach((p) => console.log(`  ✗ ${p.kind} → ${p.coll}/${p.id}${p.fieldOnly ? ` (vetëm fusha ${p.fieldOnly})` : ''}`));

  if (!APPLY) {
    console.log('\nDRY RUN — asgjë nuk u ndryshua. Shto --apply për ta zbatuar.');
    process.exit(0);
  }

  for (const p of plan) {
    // Snapshot first: these deletes must be reversible.
    await db.collection('staffClientCleanup').add({
      collection: p.coll, docId: p.id, fieldOnly: p.fieldOnly || null,
      snapshot: p.data, cleanedAt: new Date(),
    });
    if (p.fieldOnly) {
      const { FieldValue } = await import('firebase-admin/firestore');
      await db.collection(p.coll).doc(p.id).update({ [p.fieldOnly]: FieldValue.delete() });
    } else {
      await db.collection(p.coll).doc(p.id).delete();
    }
  }
  console.log(`\nU pastruan ${plan.length} regjistrime (arkivi: staffClientCleanup).`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
