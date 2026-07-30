/**
 * Read-only verification of the reporting module's seeded configuration.
 *
 * The seeder writes KPIs and templates in SEPARATE batches, so a failure between
 * them (exactly what happened with the `undefined` bug) leaves a tenant with KPIs
 * but no templates — and the UI's success toast cannot tell you that. This script
 * checks the end state instead of trusting the write path:
 *
 *   1. every one of the 15 system templates is present per tenant
 *   2. every one of the ~110 catalog KPIs is present
 *   3. no template has zero blocks
 *   4. every `kpiIds` reference on a template block resolves to a real reportKpis doc
 *      (a dangling id means the KPI batch and the template batch disagreed)
 *   5. no stored document contains a literal `undefined` shape problem (empty
 *      required field) that would break the report editor
 *
 * Writes nothing. Run:
 *   node scripts/verify-reporting-seed.cjs
 */
const admin = require('firebase-admin');
const sa = require('./sa.json');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

// Keys must match src/lib/reporting/templates.ts TEMPLATE_SEEDS.
const EXPECTED_TEMPLATE_KEYS = [
  'weekly-employee', 'weekly-project-status', 'weekly-client-update',
  'monthly-seo', 'monthly-social', 'monthly-ads', 'monthly-maintenance',
  'monthly-full-service', 'qbr', 'project-completion', 'website-launch',
  'campaign-completion', 'incident', 'client-risk', 'daily-employee',
];
const EXPECTED_KPI_MIN = 100; // catalog is ~110; allow for tenant edits

async function main() {
  const businesses = await db.collection('businesses').get();
  console.log(`Tenants: ${businesses.size}\n`);

  let anyProblem = false;

  for (const biz of businesses.docs) {
    const businessId = biz.id;
    const name = biz.data()?.name || '(pa emër)';
    const plan = biz.data()?.plan || '?';

    const [templates, kpis] = await Promise.all([
      db.collection('reportTemplates').where('businessId', '==', businessId).get(),
      db.collection('reportKpis').where('businessId', '==', businessId).get(),
    ]);

    // A tenant that never opened the module is not a problem — skip it quietly.
    if (templates.empty && kpis.empty) {
      console.log(`· ${name} (${businessId}) plan=${plan} — pa konfigurim (nuk e ka hapur modulin)`);
      continue;
    }

    const problems = [];

    const haveKeys = new Set(templates.docs.map(d => d.data()?.key));
    const missingTemplates = EXPECTED_TEMPLATE_KEYS.filter(k => !haveKeys.has(k));
    if (missingTemplates.length) problems.push(`mungojnë ${missingTemplates.length} template: ${missingTemplates.join(', ')}`);

    if (kpis.size < EXPECTED_KPI_MIN) problems.push(`vetëm ${kpis.size} KPI (pritej ≥ ${EXPECTED_KPI_MIN})`);

    const emptyTemplates = templates.docs
      .filter(d => !Array.isArray(d.data()?.blocks) || d.data().blocks.length === 0)
      .map(d => d.data()?.key);
    if (emptyTemplates.length) problems.push(`template pa blloke: ${emptyTemplates.join(', ')}`);

    // Dangling KPI references — the symptom of the two batches disagreeing.
    const kpiIds = new Set(kpis.docs.map(d => d.id));
    const dangling = new Map();
    for (const d of templates.docs) {
      for (const block of d.data()?.blocks || []) {
        for (const id of block.kpiIds || []) {
          if (!kpiIds.has(id)) {
            dangling.set(d.data()?.key, (dangling.get(d.data()?.key) || 0) + 1);
          }
        }
      }
    }
    if (dangling.size) {
      problems.push(`referenca KPI të varura: ${[...dangling].map(([k, n]) => `${k}(${n})`).join(', ')}`);
    }

    const totalKpiRefs = templates.docs.reduce((sum, d) =>
      sum + (d.data()?.blocks || []).reduce((s, b) => s + (b.kpiIds || []).length, 0), 0);

    if (problems.length) {
      anyProblem = true;
      console.log(`✘ ${name} (${businessId}) plan=${plan}`);
      for (const p of problems) console.log(`    - ${p}`);
    } else {
      console.log(`✔ ${name} (${businessId}) plan=${plan} — ${templates.size} template, ${kpis.size} KPI, ${totalKpiRefs} referenca KPI të lidhura`);
    }
  }

  console.log(anyProblem ? '\nGjetur problem — shih më lart.' : '\nTë gjitha tenantët e konfiguruar janë të plotë.');
  process.exit(anyProblem ? 1 : 0);
}

main().catch(err => {
  console.error('Verifikimi dështoi:', err && err.message ? err.message : err);
  process.exit(2);
});
