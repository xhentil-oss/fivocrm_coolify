// One-time repair for the "a client is never an open lead" law (Nov 2026,
// src/lib/crm/contactRoute.ts). Before it, a client could keep — or get — an
// OPEN lead next to their customer record. This closes every such lead as
// `Converted` (linked via `customerId`, activity row written), exactly as the
// live paths now do.
//
// Who counts as a client: a `customers` doc whose status is not `Pending`
// (Pending = a portal signup that bought nothing — its lead stays open).
// Identity = the lead's own `customerId`, else email OR phone in the same business.
//
// What happens to each open lead of a client:
//   - created BEFORE the customer  → the original pre-sale lead nobody closed: close it;
//   - created AFTER the customer   → new business from a client that landed in the
//     lead pipeline: close it AND (with --apply) open a Deal "Kërkesë e re" carrying
//     its value, owner and notes (deal id `mig_lead_<leadId>`, written with create(),
//     so a re-run never duplicates);
//   - matched ONLY by phone while both records state DIFFERENT emails → listed as
//     RISHIKO and left alone (a shared office / family number); pass
//     --include-phone-conflicts to treat them like the rest.
//
// Dry-run by default. Usage:
//   node scripts/close-client-leads.mjs [--apply] [--business=<id>] [--include-phone-conflicts]
import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const APPLY = process.argv.includes('--apply');
const PHONE_CONFLICTS = process.argv.includes('--include-phone-conflicts');
const bizArg = process.argv.find((a) => a.startsWith('--business='));
const onlyBusiness = bizArg ? bizArg.split('=')[1] : null;

// Same rules as src/lib/contactIdentity.ts / api/_contactIdentity.ts.
const normEmail = (raw) => (raw || '').toLowerCase().trim();
function normPhone(raw) {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  let n = digits;
  if (/^3550[6-9]/.test(digits)) n = '355' + digits.slice(4);
  else if (/^0[6-9]/.test(digits)) n = '355' + digits.slice(1);
  else if (/^[6-9]\d{8}$/.test(digits)) n = '355' + digits;
  return n.length >= 7 ? n : '';
}
const CLOSED = new Set(['Won', 'Converted', 'Lost']);
const isOpen = (status) => !CLOSED.has(String(status || 'New'));
const isClient = (c) => String(c.status || 'Active') !== 'Pending';
const ms = (v) => (v?.toMillis ? v.toMillis() : v ? new Date(v).getTime() : NaN);
const day = (v) => (Number.isFinite(ms(v)) ? new Date(ms(v)).toISOString().slice(0, 10) : '—');

const [leadSnap, custSnap] = await Promise.all([
  onlyBusiness ? db.collection('leads').where('businessId', '==', onlyBusiness).get() : db.collection('leads').get(),
  onlyBusiness ? db.collection('customers').where('businessId', '==', onlyBusiness).get() : db.collection('customers').get(),
]);
const customers = custSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const byId = new Map(customers.map((c) => [c.id, c]));
const byEmail = new Map();
const byPhone = new Map();
for (const c of customers) {
  const biz = c.businessId || '—';
  const e = normEmail(c.email);
  const p = normPhone(c.phone);
  if (e && !byEmail.has(`${biz}|${e}`)) byEmail.set(`${biz}|${e}`, c);
  if (p && !byPhone.has(`${biz}|${p}`)) byPhone.set(`${biz}|${p}`, c);
}

const close = [];
const review = [];
for (const d of leadSnap.docs) {
  const l = { id: d.id, ...d.data() };
  if (!isOpen(l.status)) continue;
  const biz = l.businessId || '—';
  let customer = l.customerId ? byId.get(l.customerId) : undefined;
  let on = customer ? 'link' : null;
  if (!customer) {
    const e = normEmail(l.email);
    const p = normPhone(l.phoneNumber || l.phone);
    if (e && byEmail.has(`${biz}|${e}`)) { customer = byEmail.get(`${biz}|${e}`); on = 'email'; }
    else if (p && byPhone.has(`${biz}|${p}`)) { customer = byPhone.get(`${biz}|${p}`); on = 'phone'; }
  }
  if (!customer || !isClient(customer)) continue;
  const emailsDiffer = on === 'phone' && normEmail(l.email) && normEmail(customer.email) && normEmail(l.email) !== normEmail(customer.email);
  const row = {
    lead: l, customer, on,
    newBusiness: Number.isFinite(ms(l.createdAt)) && Number.isFinite(ms(customer.createdAt)) && ms(l.createdAt) > ms(customer.createdAt),
  };
  if (emailsDiffer && !PHONE_CONFLICTS) review.push(row); else close.push(row);
}

const fmt = (r) => `  ${r.lead.id}  "${r.lead.name}" [${r.lead.status}] ${day(r.lead.createdAt)}  →  klient "${r.customer.name}" (${r.customer.status || 'Active'}, ${day(r.customer.createdAt)})  sipas ${r.on}${r.newBusiness ? '  + MARRËVESHJE' : ''}`;
console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — ${leadSnap.size} lead-e, ${customers.length} klientë${onlyBusiness ? ` (biznesi ${onlyBusiness})` : ''}`);
console.log(`\nMBYLL (${close.length}) — ${close.filter((r) => r.newBusiness).length} me marrëveshje të re:`);
close.forEach((r) => console.log(fmt(r)));
console.log(`\nRISHIKO (${review.length}) — vetëm telefoni përputhet, email-et ndryshojnë; nuk preken:`);
review.forEach((r) => console.log(`${fmt(r)}  (${r.lead.email} ≠ ${r.customer.email})`));

if (!APPLY) {
  console.log('\nAsgjë nuk u shkrua. Shto --apply për t\'i mbyllur.');
  process.exit(0);
}

const now = Timestamp.now();
let closed = 0, deals = 0, failed = 0;
for (const r of close) {
  const { lead: l, customer: c } = r;
  try {
    await db.collection('leads').doc(l.id).update({
      status: 'Converted', probability: 100, convertedAt: now, customerId: c.id, updatedAt: now,
    });
    if (!c.leadId) await db.collection('customers').doc(c.id).update({ leadId: l.id, updatedAt: now }).catch(() => {});
    await db.collection('leadActivities').add({
      leadId: l.id, teamId: l.teamId ?? null, businessId: l.businessId ?? null, type: 'converted',
      title: 'U mbyll: personi është klient',
      body: 'Riparim i ligjit "një klient nuk mban lead të hapur" (scripts/close-client-leads.mjs).',
      meta: { customerId: c.id, auto: true, script: 'close-client-leads' }, userId: null, userName: 'Sistemi', createdAt: now,
    });
    closed++;
    if (r.newBusiness) {
      const winBack = String(c.status || '') === 'Inactive';
      await db.collection('deals').doc(`mig_lead_${l.id}`).create({
        title: `${winBack ? 'Rikthim' : 'Kërkesë e re'}: ${l.serviceInterest || l.source || 'shërbim i ri'} — ${c.name || 'Klient'}`,
        customerId: c.id, customerName: c.name || null, leadId: l.id,
        amount: Number(l.estimatedValue) > 0 ? Number(l.estimatedValue) : 0, currency: 'ALL',
        stage: 'Qualification', ownerId: l.assignedToUserId || c.assignedToUserId || null,
        notes: l.notes || null, source: l.source || null, kind: winBack ? 'win-back' : 'new-business',
        ...(l.teamId ? { teamId: l.teamId } : {}), ...(l.businessId ? { businessId: l.businessId } : {}),
        lastActivityAt: now, createdAt: now, updatedAt: now, createdByUserId: null,
      }).then(() => { deals++; }, (err) => { if (err?.code !== 6) throw err; });
    }
  } catch (err) {
    failed++;
    console.error(`  ✗ ${l.id}: ${err?.message || err}`);
  }
}
console.log(`\nU mbyllën ${closed}, marrëveshje të reja ${deals}, dështuan ${failed}.`);
