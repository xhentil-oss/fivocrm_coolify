#!/usr/bin/env node
/**
 * Cleanup: leads/conversations/messages created from WhatsApp NON-PERSON senders
 * (channels `@newsletter`, status `@broadcast`, groups `@g.us`). Those jids carry
 * an 18-digit id, not a phone number, so the inbound handler minted a "lead" per
 * channel post. Dry-run by default; `--delete` removes them; `--archive` snapshots
 * each deleted lead into `waNonPersonCleanup` first.
 *
 *   node scripts/cleanup-wa-non-person-leads.mjs            # report only
 *   node scripts/cleanup-wa-non-person-leads.mjs --delete   # remove
 */
import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();
const DELETE = process.argv.includes('--delete');
const ARCHIVE = process.argv.includes('--archive');

// A real phone is 8–15 digits (E.164). WhatsApp channel/group ids are 15+ digits
// starting with 1203…, so anything above 15 digits is never a person.
const isPersonPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 8 && d.length <= 15; };

const leads = await db.collection('leads').where('source', '==', 'whatsapp').get();
const bogus = leads.docs.filter(d => !isPersonPhone(d.data().phoneNumber || d.data().phone));
console.log(`leads(source=whatsapp): ${leads.size} · non-person: ${bogus.length}`);

let msgCount = 0, convCount = 0, actCount = 0;
const ops = [];
for (const d of bogus) {
  const L = d.data();
  const digits = String(L.phoneNumber || L.phone || '').replace(/\D/g, '');
  const msgs = await db.collection('whatsappMessages').where('teamId', '==', L.teamId).where('phone', '==', digits).get();
  const acts = await db.collection('leadActivities').where('leadId', '==', d.id).get();
  const convRef = db.collection('conversations').doc(`wa-${L.teamId}-${digits}`);
  const conv = await convRef.get();
  const wac = db.collection('whatsappConversations').doc(`${L.teamId}_${digits}`);
  const thr = db.collection('whatsappThreads').doc(`${L.teamId}_${digits}`);
  msgCount += msgs.size; actCount += acts.size; if (conv.exists) convCount++;
  const sampleJid = msgs.docs[0]?.data().jid || '?';
  console.log(`- lead ${d.id} "${L.name}" team=${L.teamId} jid=${sampleJid} msgs=${msgs.size} acts=${acts.size} conv=${conv.exists}`);
  if (!DELETE) continue;
  if (ARCHIVE) ops.push(db.collection('waNonPersonCleanup').doc(d.id).set({ lead: L, leadId: d.id, deletedAt: new Date(), messageCount: msgs.size }));
  msgs.docs.forEach(m => ops.push(m.ref.delete()));
  acts.docs.forEach(a => ops.push(a.ref.delete()));
  if (conv.exists) ops.push(convRef.delete());
  ops.push(wac.delete().catch(() => {}));
  ops.push(thr.delete().catch(() => {}));
  ops.push(d.ref.delete());
}
console.log(`\nmessages: ${msgCount} · activities: ${actCount} · conversations: ${convCount}`);
if (DELETE) { await Promise.all(ops); console.log(`deleted ${bogus.length} leads + related docs`); }
else console.log('dry run — re-run with --delete to remove');
