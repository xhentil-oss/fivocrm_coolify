// Resolve duplicate FAT-### invoice numbers (caused by the old per-TEAM counter)
// and seed the new per-BUSINESS counter.
//
// Rule: within each colliding group the OLDEST invoice keeps its number (it is the
// original document); every later one gets a fresh number continuing the business
// sequence. The previous number is kept in `previousInvoiceNumber` for audit.
//
//   node scripts/fix-invoice-number-collisions.mjs          (dry-run)
//   node scripts/fix-invoice-number-collisions.mjs --apply

import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const dt = (v) => (v?.toDate ? v.toDate() : (v ? new Date(v) : null));
const fmt = (n) => `FAT-${String(n).padStart(3, '0')}`;

async function main() {
  console.log(`[renumber] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  const invSnap = await db.collection('invoices').get();
  const invs = invSnap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));

  // Business scope (single tenant in this data set; group per business to be safe).
  const byBusiness = new Map();
  invs.forEach(i => {
    const b = i.businessId || '__none__';
    if (!byBusiness.has(b)) byBusiness.set(b, []);
    byBusiness.get(b).push(i);
  });

  for (const [businessId, list] of byBusiness) {
    const seqOf = (i) => { const m = (i.invoiceNumber || '').match(/^FAT-(\d+)$/i); return m ? parseInt(m[1], 10) : null; };
    let maxSeq = Math.max(0, ...list.map(i => seqOf(i) || 0));

    const groups = new Map();
    list.forEach(i => {
      const n = (i.invoiceNumber || '').trim();
      if (!n.startsWith('FAT-')) return;
      if (!groups.has(n)) groups.set(n, []);
      groups.get(n).push(i);
    });
    const dups = [...groups.entries()].filter(([, a]) => a.length > 1).sort();
    console.log(`\n=== business ${businessId} | fatura=${list.length} | max FAT=${maxSeq} | kolizione=${dups.length} ===`);

    for (const [num, group] of dups) {
      // Oldest keeps the number; the rest are renumbered.
      group.sort((a, b) => (dt(a.createdAt)?.getTime() || 0) - (dt(b.createdAt)?.getTime() || 0));
      const [keep, ...renumber] = group;
      console.log(`  ${num}: mban "${keep.invoiceNumber}" (${dt(keep.createdAt)?.toISOString().slice(0, 10)}, ${keep.total ?? keep.amount})`);
      for (const inv of renumber) {
        maxSeq += 1;
        const next = fmt(maxSeq);
        console.log(`     ${APPLY ? '→' : 'do bëhet'} ${next}  (ish ${inv.invoiceNumber} | ${dt(inv.createdAt)?.toISOString().slice(0, 10)} | ${inv.total ?? inv.amount} | ${inv.status})`);
        if (APPLY) {
          await inv.ref.update({
            invoiceNumber: next,
            previousInvoiceNumber: inv.invoiceNumber,
            renumberedReason: 'per-team-counter-collision',
            updatedAt: Timestamp.now(),
          });
        }
      }
    }

    // Seed the new per-business counter past everything in use.
    console.log(`  numëratori i biznesit → counters/invoices_${businessId} = ${maxSeq}`);
    if (APPLY && businessId !== '__none__') {
      await db.collection('counters').doc(`invoices_${businessId}`).set(
        { last: maxSeq, updatedAt: Timestamp.now() }, { merge: true },
      );
    }
  }
  if (!APPLY) console.log('\nRun again with --apply to write.');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
