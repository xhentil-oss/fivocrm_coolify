// Stamp the denormalized `portalVisible` flag on every existing report.
//
// portalVisible = published status AND client-facing kind AND not soft-deleted.
// The portal's list query and the read rule now key on this single provable
// equality (the old three-conjunct rule was unprovable by any legal query, so
// /portal/reports was denied for every real client). New writes maintain the
// flag (workflow.ts transitionPatch / softDelete / restore, creation paths);
// this covers the documents that predate it.
//
//   node scripts/backfill-report-portalvisible.mjs          (dry-run)
//   node scripts/backfill-report-portalvisible.mjs --apply

import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const sa = JSON.parse(readFileSync('scripts/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

// MIRRORS src/lib/reporting/workflow.ts — keep in sync.
const PUBLISHED = new Set(['published', 'sent', 'viewed', 'acknowledged', 'client_approved', 'client_rejected']);
const CLIENT_KINDS = new Set(['client-monthly', 'qbr', 'project-status', 'project-completion', 'campaign-completion', 'website-launch']);
const computePortalVisible = (r) => PUBLISHED.has(r.status) && CLIENT_KINDS.has(r.kind) && !r.deletedAt;

async function main() {
  console.log(`[reports portalVisible] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  const snap = await db.collection('reports').get();
  const toFix = snap.docs
    .map(d => ({ ref: d.ref, id: d.id, data: d.data() }))
    .filter(({ data }) => data.portalVisible !== computePortalVisible(data));
  const visible = toFix.filter(({ data }) => computePortalVisible(data));
  console.log(`Gjithsej: ${snap.size} · për t'u vulosur: ${toFix.length} (${visible.length} do bëhen të dukshme në portal)`);
  for (const { id, data } of toFix) {
    console.log(`  ${id}: status=${data.status} kind=${data.kind} deleted=${!!data.deletedAt} → portalVisible=${computePortalVisible(data)}`);
  }
  if (APPLY) {
    for (let i = 0; i < toFix.length; i += 400) {
      const batch = db.batch();
      toFix.slice(i, i + 400).forEach(({ ref, data }) =>
        batch.update(ref, { portalVisible: computePortalVisible(data), updatedAt: Timestamp.now() }));
      await batch.commit();
    }
    console.log(`\nU vulosën ${toFix.length} raporte. ✓`);
  } else if (toFix.length) {
    console.log('\nRun again with --apply to write.');
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e.code || '', e.details || e.message); process.exit(1); });
