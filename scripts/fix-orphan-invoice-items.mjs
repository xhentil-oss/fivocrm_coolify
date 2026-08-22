// Repair `invoiceItems` rows that carry no tenant key.
//
// The recurring-invoice cron (`api/cron/run.ts`, both Part 1 and Part 2) used to copy
// line items with only `teamId`. But `invoiceItems` is in `businessIsolatedAlways`, so
// `useCollection` forces `where('businessId','==',…)`, and the Firestore rule is
//
//     isBusinessMember(resource.data.businessId) || isPortalClientFor(resource.data.customerId)
//
// A row with neither key is readable by NOBODY: every auto-generated invoice showed
// "Nuk ka artikuj në këtë faturë" to staff and to the portal client, and printed an
// empty PDF items table against a correct total.
//
// The cron is fixed, so no new orphans appear. This backfills the ones already in the
// database, taking both keys from the parent invoice (the same source the fix uses).
//
//   node scripts/fix-orphan-invoice-items.mjs           (dry-run)
//   node scripts/fix-orphan-invoice-items.mjs --apply
//
// Safe to re-run: it only ever FILLS a missing field, never overwrites one, and never
// touches a row whose parent invoice is gone (that is a different problem — reported).

import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const BATCH_LIMIT = 400; // Firestore caps a write batch at 500

async function main() {
  console.log(`[fix-orphan-items] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  const [itemsSnap, invoicesSnap] = await Promise.all([
    db.collection('invoiceItems').get(),
    db.collection('invoices').get(),
  ]);

  const invoices = new Map(invoicesSnap.docs.map(d => [d.id, d.data()]));
  console.log(`[fix-orphan-items] ${itemsSnap.size} line items, ${invoicesSnap.size} invoices`);

  const fixes = [];
  const orphanNoParent = [];
  const unfixable = [];

  for (const doc of itemsSnap.docs) {
    const item = doc.data();
    // Only rows that are actually unreadable need touching.
    const readable = !!item.businessId || !!item.customerId;
    if (readable && item.businessId) continue;

    const parent = item.invoiceId ? invoices.get(item.invoiceId) : undefined;
    if (!parent) {
      // No parent invoice: filling keys would resurrect a line belonging to a
      // deleted invoice. Report it instead — deciding its fate is the owner's call.
      orphanNoParent.push({ id: doc.id, invoiceId: item.invoiceId || '(none)' });
      continue;
    }

    const patch = {};
    if (!item.businessId && parent.businessId) patch.businessId = parent.businessId;
    if (!item.customerId && parent.customerId) patch.customerId = parent.customerId;
    if (!item.teamId && parent.teamId) patch.teamId = parent.teamId;

    if (!patch.businessId && !item.businessId) {
      // The parent itself has no businessId — a pre-tenancy invoice. Fixing the item
      // without fixing the invoice would be pointless (the invoice is invisible too).
      unfixable.push({ id: doc.id, invoiceId: item.invoiceId, invoiceNumber: parent.invoiceNumber });
      continue;
    }
    if (Object.keys(patch).length === 0) continue;

    fixes.push({ ref: doc.ref, id: doc.id, invoiceNumber: parent.invoiceNumber || item.invoiceId, patch });
  }

  console.log(`\n[fix-orphan-items] ${fixes.length} line items to repair`);
  for (const f of fixes.slice(0, 25)) {
    console.log(`  · ${f.id}  invoice=${f.invoiceNumber}  +${Object.keys(f.patch).join(',')}`);
  }
  if (fixes.length > 25) console.log(`  … and ${fixes.length - 25} more`);

  if (orphanNoParent.length) {
    console.log(`\n[fix-orphan-items] ⚠ ${orphanNoParent.length} line items whose invoice no longer exists (NOT touched):`);
    for (const o of orphanNoParent.slice(0, 15)) console.log(`  · ${o.id} → invoiceId=${o.invoiceId}`);
  }
  if (unfixable.length) {
    console.log(`\n[fix-orphan-items] ⚠ ${unfixable.length} line items whose INVOICE has no businessId either (fix the invoice first):`);
    for (const u of unfixable.slice(0, 15)) console.log(`  · ${u.id} → ${u.invoiceNumber || u.invoiceId}`);
  }

  if (!APPLY) {
    console.log('\n[fix-orphan-items] dry-run — re-run with --apply to write.');
    return;
  }

  let written = 0;
  for (let i = 0; i < fixes.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const f of fixes.slice(i, i + BATCH_LIMIT)) {
      // `updatedAt` is deliberately NOT bumped: nothing about the line changed, and
      // several rollups fall back to updatedAt for period attribution.
      batch.update(f.ref, { ...f.patch, tenantKeysBackfilledAt: Timestamp.now() });
      written++;
    }
    await batch.commit();
    console.log(`[fix-orphan-items] committed ${Math.min(i + BATCH_LIMIT, fixes.length)}/${fixes.length}`);
  }
  console.log(`\n[fix-orphan-items] ✓ repaired ${written} line items.`);
}

main().then(() => process.exit(0)).catch(err => {
  console.error('[fix-orphan-items] failed:', err);
  process.exit(1);
});
