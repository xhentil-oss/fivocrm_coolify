/**
 * Rules-unit tests for the REPORTING & ACCOUNTABILITY module.
 *
 * Self-contained (own project id + own seed) so it can run alongside
 * `firestore-rules.test.mjs` without sharing state.
 *
 * The invariant under test — the one the whole module rests on:
 *
 *   A portal client may read ONLY their own customer's PUBLISHED, client-facing,
 *   not-deleted report and its NON-INTERNAL comments. They may never write report
 *   content, never read the audit trail, approvals, templates, raw metrics, client
 *   health or employee accountability data. Staff never cross the tenant boundary.
 *   Versions, approvals and events are append-only for everyone.
 *
 * Run:
 *   firebase emulators:exec --only firestore "node --test scripts/firestore-rules.reporting.test.mjs"
 * or both suites at once:
 *   firebase emulators:exec --only firestore "node --test scripts/*.test.mjs"
 */
import { readFileSync } from 'node:fs';
import { test, before, after } from 'node:test';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'fivocrm-reporting-rules-test';
const MY_BIZ = 'bizMine';
const MY_TEAM = 'teamMine';
const VICTIM_BIZ = 'bizVictim';
const VICTIM_TEAM = 'teamVictim';

let testEnv;

/** Staff of a tenant, authorised by signed claims (bid/tid/roles). */
const staffOf = (uid, bid, tid, roles = ['member'], email = `${uid}@x.com`) =>
  testEnv.authenticatedContext(uid, { email, bid, tid, roles }).firestore();

/** Portal client: `cid` = their customer, `pbid` = their tenant (never `bid`). */
const portalOf = (uid, cid, email, pbid = MY_BIZ) =>
  testEnv.authenticatedContext(uid, { email, cid, pbid }).firestore();

/**
 * A plain MEMBER of our own tenant. The write rules used to accept anyone who was
 * merely a member (`canCreateBusinessDoc` / `canManageBusinessDoc`), so this is the
 * actor that could rewrite colleagues' reports and their own accountability score.
 */
const memberOf = (uid, bid, tid) =>
  testEnv.authenticatedContext(uid, { email: `${uid}@x.com`, bid, tid, roles: ['member'] }).firestore();

/** An admin of ANOTHER tenant — the cross-tenant attacker. */
const outsider = () =>
  testEnv.authenticatedContext('mallory', {
    email: 'm@evil.com', bid: VICTIM_BIZ, tid: VICTIM_TEAM, roles: ['admin'],
  }).firestore();

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // ── tenancy scaffolding ──
    await setDoc(doc(db, 'businesses', MY_BIZ), { name: 'Mine', ownerId: 'owner', status: 'active' });
    await setDoc(doc(db, 'businesses', VICTIM_BIZ), { name: 'Victim', ownerId: 'vowner', status: 'active' });
    await setDoc(doc(db, 'businesses', 'bizSuspended'), { name: 'Late', ownerId: 'late', status: 'suspended' });
    await setDoc(doc(db, 'teams', MY_TEAM), { businessId: MY_BIZ, createdByUserId: 'owner' });
    await setDoc(doc(db, 'teams', 'teamSuspended'), { businessId: 'bizSuspended', createdByUserId: 'late' });
    await setDoc(doc(db, 'teamMembers', `${MY_TEAM}_alice`), {
      userId: 'alice', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Admin', status: 'Active',
    });
    await setDoc(doc(db, 'teamMembers', 'teamSuspended_late'), {
      userId: 'late', teamId: 'teamSuspended', businessId: 'bizSuspended', role: 'Admin', status: 'Active',
    });
    await setDoc(doc(db, 'customers', 'cust1'), { businessId: MY_BIZ, email: 'carol@client.com', name: 'Carol' });
    await setDoc(doc(db, 'customers', 'custVictim'), { businessId: VICTIM_BIZ, email: 'v@client.com', name: 'V' });
    await setDoc(doc(db, 'users', 'alice'), { teamId: MY_TEAM, businessId: MY_BIZ });
    await setDoc(doc(db, 'users', 'carol'), { customerId: 'cust1' });

    // ── reports ──
    // Published, client-facing, mine → the ONLY report carol may read.
    await setDoc(doc(db, 'reports', 'repMinePublished'), {
      businessId: MY_BIZ, teamId: MY_TEAM, kind: 'client-monthly', status: 'published',
      customerId: 'cust1', title: 'Raport Korrik', authorUserId: 'alice', version: 2,
      deletedAt: null,
      blocks: [
        { id: 'b1', type: 'executive-summary', order: 0, visibility: 'client', text: 'Rezultate' },
        { id: 'b2', type: 'rich-text', order: 1, visibility: 'management', text: 'Marzhi 12%' },
      ],
    });
    // Draft for the same client — internal work in progress.
    await setDoc(doc(db, 'reports', 'repMineDraft'), {
      businessId: MY_BIZ, kind: 'client-monthly', status: 'draft', customerId: 'cust1',
      title: 'Draft Gusht', authorUserId: 'alice', version: 1, deletedAt: null,
    });
    // An INTERNAL kind wrongly marked published — the rules must still hide it.
    await setDoc(doc(db, 'reports', 'repMineRisk'), {
      businessId: MY_BIZ, kind: 'client-risk', status: 'published', customerId: 'cust1',
      title: 'Rreziku i llogarise', authorUserId: 'alice', version: 1, deletedAt: null,
    });
    // Soft-deleted → must stop being readable.
    await setDoc(doc(db, 'reports', 'repMineDeleted'), {
      businessId: MY_BIZ, kind: 'client-monthly', status: 'published', customerId: 'cust1',
      title: 'Fshire', authorUserId: 'alice', version: 1, deletedAt: new Date(),
    });
    // The cross-tenant target.
    await setDoc(doc(db, 'reports', 'repVictim'), {
      businessId: VICTIM_BIZ, kind: 'client-monthly', status: 'published', customerId: 'custVictim',
      title: 'Raporti i viktimes', authorUserId: 'vstaff', version: 1, deletedAt: null,
    });

    // ── versions ──
    await setDoc(doc(db, 'reportVersions', 'verMinePublished'), {
      businessId: MY_BIZ, reportId: 'repMinePublished', customerId: 'cust1',
      version: 2, reason: 'published', status: 'published', title: 'Raport Korrik', blocks: [],
    });
    await setDoc(doc(db, 'reportVersions', 'verMineDraft'), {
      businessId: MY_BIZ, reportId: 'repMinePublished', customerId: 'cust1',
      version: 3, reason: 'submitted', status: 'submitted', title: 'Raport Korrik', blocks: [],
    });
    await setDoc(doc(db, 'reportVersions', 'verVictim'), {
      businessId: VICTIM_BIZ, reportId: 'repVictim', customerId: 'custVictim',
      version: 1, reason: 'published', status: 'published', title: 'X', blocks: [],
    });

    // ── comments ──
    await setDoc(doc(db, 'reportComments', 'cmtInternal'), {
      businessId: MY_BIZ, reportId: 'repMinePublished', customerId: 'cust1', internal: true,
      body: 'Klienti po vonon pagesat', authorUserId: 'alice', createdByUserId: 'alice',
    });
    await setDoc(doc(db, 'reportComments', 'cmtShared'), {
      businessId: MY_BIZ, reportId: 'repMinePublished', customerId: 'cust1', internal: false,
      body: 'Faleminderit', authorUserId: 'alice', createdByUserId: 'alice',
    });
    await setDoc(doc(db, 'reportComments', 'cmtVictim'), {
      businessId: VICTIM_BIZ, reportId: 'repVictim', customerId: 'custVictim', internal: false,
      body: 'x', authorUserId: 'vstaff', createdByUserId: 'vstaff',
    });

    // ── approvals / events / config ──
    await setDoc(doc(db, 'reportApprovals', 'apprMine'), {
      businessId: MY_BIZ, reportId: 'repMinePublished', version: 2, step: 1,
      stage: 'management', decision: 'approved', approverUserId: 'owner',
    });
    await setDoc(doc(db, 'reportEvents', 'evtMine'), {
      businessId: MY_BIZ, reportId: 'repMinePublished', kind: 'published',
      actorType: 'staff', actorUserId: 'alice',
    });
    await setDoc(doc(db, 'reportEvents', 'evtVictim'), {
      businessId: VICTIM_BIZ, reportId: 'repVictim', kind: 'published', actorType: 'staff',
    });
    await setDoc(doc(db, 'reportTemplates', 'tmplVictim'), {
      businessId: VICTIM_BIZ, key: 'monthly-seo', name: 'SEO', kind: 'client-monthly',
      frequency: 'monthly', version: 1, blocks: [],
    });
    await setDoc(doc(db, 'reportKpis', 'kpiVictim'), {
      businessId: VICTIM_BIZ, key: 'gross_margin', name: 'Marzhi', unit: 'percent',
      higherIsBetter: true, clientVisible: false, active: true,
    });
    await setDoc(doc(db, 'reportMetrics', 'metVictim'), {
      businessId: VICTIM_BIZ, periodKey: '2026-07', periodStart: '2026-07-01',
      periodEnd: '2026-07-31', values: { gross_margin: 41 },
    });
    await setDoc(doc(db, 'reportSchedules', 'schVictim'), {
      businessId: VICTIM_BIZ, name: 'Mujor', active: true, kind: 'client-monthly',
      frequency: 'monthly', hour: 9,
    });
    await setDoc(doc(db, 'clientHealthScores', 'chsVictim'), {
      businessId: VICTIM_BIZ, customerId: 'custVictim', periodKey: '2026-07',
      score: 41, category: 'at_risk', factors: [],
    });
    await setDoc(doc(db, 'employeeReportScores', 'ersVictim'), {
      businessId: VICTIM_BIZ, userId: 'vstaff', periodKey: '2026-07', metrics: {},
    });
    await setDoc(doc(db, 'employeeReportScores', 'ersMine'), {
      businessId: MY_BIZ, userId: 'alice', periodKey: '2026-07', metrics: {},
      managerFeedback: 'Duhet te permiresoje raportimin',
    });

    // ── write-integrity seed (R12) ──
    // `bob` is a plain Member of our tenant.
    await setDoc(doc(db, 'teamMembers', `${MY_TEAM}_bob`), {
      userId: 'bob', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Member', status: 'Active',
    });
    await setDoc(doc(db, 'users', 'bob'), { teamId: MY_TEAM, businessId: MY_BIZ });
    // A draft authored by alice — bob is not involved in it in any role.
    await setDoc(doc(db, 'reports', 'repAliceDraft'), {
      businessId: MY_BIZ, kind: 'weekly-staff', status: 'draft',
      title: 'Javori i Alices', authorUserId: 'alice', version: 1, deletedAt: null,
    });
    // A draft where bob IS the reviewer — he may edit that one.
    await setDoc(doc(db, 'reports', 'repBobReviews'), {
      businessId: MY_BIZ, kind: 'weekly-staff', status: 'draft',
      title: 'Per shqyrtim nga bob', authorUserId: 'alice', reviewerUserId: 'bob',
      version: 1, deletedAt: null,
    });
    await setDoc(doc(db, 'clientHealthScores', 'chsMine'), {
      businessId: MY_BIZ, customerId: 'cust1', periodKey: '2026-07',
      score: 80, category: 'healthy', factors: [],
    });
    await setDoc(doc(db, 'reportMetrics', 'metMine'), {
      businessId: MY_BIZ, customerId: 'cust1', periodKey: '2026-07',
      periodStart: '2026-07-01', periodEnd: '2026-07-31', values: { social_reach: 1000 },
    });
  });
});

after(async () => {
  await testEnv?.cleanup();
});

// ── R1. Tenant boundary for staff ──────────────────────────────────────────────
test('R1a. staff read their own tenant report', async () => {
  await assertSucceeds(getDoc(doc(staffOf('alice', MY_BIZ, MY_TEAM, ['admin']), 'reports', 'repMinePublished')));
});
test('R1b. cross-tenant staff cannot read another tenant report', async () => {
  await assertFails(getDoc(doc(staffOf('alice', MY_BIZ, MY_TEAM, ['admin']), 'reports', 'repVictim')));
});
test('R1c. an outsider admin cannot read our report', async () => {
  await assertFails(getDoc(doc(outsider(), 'reports', 'repMinePublished')));
});
test('R1d. an unauthenticated reader gets nothing', async () => {
  await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'reports', 'repMinePublished')));
});

// ── R2. THE client-visibility boundary ─────────────────────────────────────────
test('R2a. portal client reads their own PUBLISHED report', async () => {
  await assertSucceeds(getDoc(doc(portalOf('carol', 'cust1', 'carol@client.com'), 'reports', 'repMinePublished')));
});
test('R2b. portal client cannot read a DRAFT of their own report', async () => {
  await assertFails(getDoc(doc(portalOf('carol', 'cust1', 'carol@client.com'), 'reports', 'repMineDraft')));
});
test('R2c. portal client cannot read an internal report KIND even when published', async () => {
  await assertFails(getDoc(doc(portalOf('carol', 'cust1', 'carol@client.com'), 'reports', 'repMineRisk')));
});
test('R2d. portal client cannot read a soft-deleted report', async () => {
  await assertFails(getDoc(doc(portalOf('carol', 'cust1', 'carol@client.com'), 'reports', 'repMineDeleted')));
});
test('R2e. portal client cannot read another tenant published report', async () => {
  await assertFails(getDoc(doc(portalOf('carol', 'cust1', 'carol@client.com'), 'reports', 'repVictim')));
});

// ── R3. A client never writes report content ───────────────────────────────────
test('R3a. portal client cannot edit a report', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com');
  await assertFails(setDoc(doc(carol, 'reports', 'repMinePublished'), { title: 'Rishkruar' }, { merge: true }));
});
test('R3b. portal client cannot self-approve by writing the status field', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com');
  await assertFails(setDoc(doc(carol, 'reports', 'repMinePublished'),
    { status: 'client_approved', clientApprovedVersion: 2 }, { merge: true }));
});
test('R3c. portal client cannot create a report', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com');
  await assertFails(setDoc(doc(carol, 'reports', 'repForged'), {
    businessId: MY_BIZ, kind: 'client-monthly', status: 'published', customerId: 'cust1',
    title: 'Vete-shpikur', authorUserId: 'carol', version: 1, createdByUserId: 'carol', deletedAt: null,
  }));
});
test('R3d. staff cannot stamp a report into another tenant', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(setDoc(doc(alice, 'reports', 'repSmuggled'), {
    businessId: VICTIM_BIZ, kind: 'client-monthly', status: 'draft',
    title: 'Smuggled', authorUserId: 'alice', version: 1, deletedAt: null,
  }));
});
test('R3e. a report can never be moved to another tenant by update', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(setDoc(doc(alice, 'reports', 'repMinePublished'), { businessId: VICTIM_BIZ }, { merge: true }));
});
test('R3f. a report cannot be hard-deleted by the tenant (soft delete only)', async () => {
  await assertFails(deleteDoc(doc(staffOf('alice', MY_BIZ, MY_TEAM, ['admin']), 'reports', 'repMinePublished')));
});
test('R3g. staff of the tenant may edit their own report', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(setDoc(doc(alice, 'reports', 'repMineDraft'), { title: 'Draft i ndryshuar' }, { merge: true }));
});

// ── R4. Internal comments are the private discussion of the account ────────────
test('R4a. portal client reads a shared comment on their report', async () => {
  await assertSucceeds(getDoc(doc(portalOf('carol', 'cust1', 'carol@client.com'), 'reportComments', 'cmtShared')));
});
test('R4b. portal client cannot read an INTERNAL comment', async () => {
  await assertFails(getDoc(doc(portalOf('carol', 'cust1', 'carol@client.com'), 'reportComments', 'cmtInternal')));
});
test('R4c. portal client cannot read another tenant comment', async () => {
  await assertFails(getDoc(doc(portalOf('carol', 'cust1', 'carol@client.com'), 'reportComments', 'cmtVictim')));
});
test('R4d. portal client may post a NON-internal comment as themselves', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com');
  await assertSucceeds(setDoc(doc(carol, 'reportComments', 'cmtFromClient'), {
    businessId: MY_BIZ, reportId: 'repMinePublished', customerId: 'cust1', internal: false,
    body: 'Nje pyetje', authorUserId: 'carol', authorCustomerId: 'cust1', createdByUserId: 'carol',
  }));
});
test('R4e. portal client cannot forge an INTERNAL comment', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com');
  await assertFails(setDoc(doc(carol, 'reportComments', 'cmtForgedInternal'), {
    businessId: MY_BIZ, reportId: 'repMinePublished', customerId: 'cust1', internal: true,
    body: 'Shtirem si ekipi', authorUserId: 'carol', authorCustomerId: 'cust1', createdByUserId: 'carol',
  }));
});
test('R4f. portal client cannot comment on another customer report', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com');
  await assertFails(setDoc(doc(carol, 'reportComments', 'cmtCross'), {
    businessId: MY_BIZ, reportId: 'repVictim', customerId: 'custVictim', internal: false,
    body: 'x', authorUserId: 'carol', authorCustomerId: 'custVictim', createdByUserId: 'carol',
  }));
});
test('R4g. an internal comment cannot be flipped to client-visible after the fact', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(setDoc(doc(alice, 'reportComments', 'cmtInternal'), { internal: false }, { merge: true }));
});

// ── R5. Version snapshots ──────────────────────────────────────────────────────
test('R5a. portal client reads the published version snapshot', async () => {
  await assertSucceeds(getDoc(doc(portalOf('carol', 'cust1', 'carol@client.com'), 'reportVersions', 'verMinePublished')));
});
test('R5b. portal client cannot read an unpublished snapshot', async () => {
  await assertFails(getDoc(doc(portalOf('carol', 'cust1', 'carol@client.com'), 'reportVersions', 'verMineDraft')));
});
test('R5c. a version snapshot is immutable, even for an admin', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(setDoc(doc(alice, 'reportVersions', 'verMinePublished'), { title: 'Rishkruar' }, { merge: true }));
  await assertFails(deleteDoc(doc(alice, 'reportVersions', 'verMinePublished')));
});
test('R5d. cross-tenant version read is denied', async () => {
  await assertFails(getDoc(doc(staffOf('alice', MY_BIZ, MY_TEAM, ['admin']), 'reportVersions', 'verVictim')));
});

// ── R6. Approvals are evidence ─────────────────────────────────────────────────
test('R6a. an approval cannot be edited or deleted, even by an admin', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(setDoc(doc(alice, 'reportApprovals', 'apprMine'), { decision: 'rejected' }, { merge: true }));
  await assertFails(deleteDoc(doc(alice, 'reportApprovals', 'apprMine')));
});
test('R6b. a client cannot read an internal approval record', async () => {
  await assertFails(getDoc(doc(portalOf('carol', 'cust1', 'carol@client.com'), 'reportApprovals', 'apprMine')));
});

// ── R7. The audit stream is append-only and staff-only ─────────────────────────
test('R7a. report events cannot be edited or deleted', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(setDoc(doc(alice, 'reportEvents', 'evtMine'), { kind: 'created' }, { merge: true }));
  await assertFails(deleteDoc(doc(alice, 'reportEvents', 'evtMine')));
});
test('R7b. a client cannot read the audit stream', async () => {
  await assertFails(getDoc(doc(portalOf('carol', 'cust1', 'carol@client.com'), 'reportEvents', 'evtMine')));
});
test('R7c. cross-tenant audit read is denied', async () => {
  await assertFails(getDoc(doc(staffOf('alice', MY_BIZ, MY_TEAM, ['admin']), 'reportEvents', 'evtVictim')));
});

// ── R8. Templates, KPI definitions, raw metrics, schedules ─────────────────────
test('R8a. cross-tenant template read is denied', async () => {
  await assertFails(getDoc(doc(staffOf('alice', MY_BIZ, MY_TEAM, ['admin']), 'reportTemplates', 'tmplVictim')));
});
test('R8b. a client cannot read a template', async () => {
  await assertFails(getDoc(doc(portalOf('carol', 'cust1', 'carol@client.com'), 'reportTemplates', 'tmplVictim')));
});
test('R8c. cross-tenant KPI, metric and schedule reads are denied', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(getDoc(doc(alice, 'reportKpis', 'kpiVictim')));
  await assertFails(getDoc(doc(alice, 'reportMetrics', 'metVictim')));
  await assertFails(getDoc(doc(alice, 'reportSchedules', 'schVictim')));
});
test('R8d. a client cannot read raw metric values', async () => {
  await assertFails(getDoc(doc(portalOf('carol', 'cust1', 'carol@client.com'), 'reportMetrics', 'metVictim')));
});

// ── R9. Client health is internal account intelligence ─────────────────────────
test('R9. client health is staff-only and tenant-scoped', async () => {
  await assertFails(getDoc(doc(staffOf('alice', MY_BIZ, MY_TEAM, ['admin']), 'clientHealthScores', 'chsVictim')));
  await assertFails(getDoc(doc(portalOf('carol', 'cust1', 'carol@client.com'), 'clientHealthScores', 'chsVictim')));
});

// ── R10. Employee accountability data is confidential ──────────────────────────
test('R10a. a client cannot read employee accountability data', async () => {
  await assertFails(getDoc(doc(portalOf('carol', 'cust1', 'carol@client.com'), 'employeeReportScores', 'ersMine')));
});
test('R10b. cross-tenant employee data read is denied', async () => {
  await assertFails(getDoc(doc(staffOf('alice', MY_BIZ, MY_TEAM, ['admin']), 'employeeReportScores', 'ersVictim')));
});

// ── R11. Lifecycle: a suspended tenant is read-only ────────────────────────────
test('R11. a suspended tenant cannot create reports', async () => {
  const late = staffOf('late', 'bizSuspended', 'teamSuspended', ['admin']);
  await assertFails(setDoc(doc(late, 'reports', 'repSuspended'), {
    businessId: 'bizSuspended', kind: 'client-monthly', status: 'draft',
    title: 'X', authorUserId: 'late', version: 1, deletedAt: null,
  }));
});

// ── R12. Write integrity: being a MEMBER is not authority ────────────────────
// Reads were always scoped correctly; writes were not. `canCreateBusinessDoc()` and
// `canManageBusinessDoc()` only ask "are you in this business", so a plain Member
// could rewrite a colleague's report and author their own accountability score.

test('R12a. a member cannot edit a colleague report they are not involved in', async () => {
  const bob = memberOf('bob', MY_BIZ, MY_TEAM);
  await assertFails(setDoc(doc(bob, 'reports', 'repAliceDraft'),
    { title: 'Rishkruar nga bob' }, { merge: true }));
});

test('R12b. a member CAN edit a report where they are the reviewer', async () => {
  const bob = memberOf('bob', MY_BIZ, MY_TEAM);
  await assertSucceeds(setDoc(doc(bob, 'reports', 'repBobReviews'),
    { title: 'Shqyrtuar' }, { merge: true }));
});

test('R12c. the author can still edit their own report', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(setDoc(doc(alice, 'reports', 'repAliceDraft'),
    { title: 'Vazhdim' }, { merge: true }));
});

test('R12d. a member cannot create a report authored by someone else', async () => {
  const bob = memberOf('bob', MY_BIZ, MY_TEAM);
  await assertFails(setDoc(doc(bob, 'reports', 'repForgedAuthor'), {
    businessId: MY_BIZ, kind: 'weekly-staff', status: 'draft',
    title: 'Ne emer te Alices', authorUserId: 'alice', version: 1, deletedAt: null,
    createdByUserId: 'bob',
  }));
});

test('R12e. a member CAN create a report authored by themselves', async () => {
  const bob = memberOf('bob', MY_BIZ, MY_TEAM);
  await assertSucceeds(setDoc(doc(bob, 'reports', 'repBobOwn'), {
    businessId: MY_BIZ, kind: 'weekly-staff', status: 'draft',
    title: 'Javori i bobit', authorUserId: 'bob', version: 1, deletedAt: null,
    createdByUserId: 'bob',
  }));
});

// The one that matters most: a person must not be able to write their own score.
test('R12f. a member cannot write their OWN accountability score', async () => {
  const bob = memberOf('bob', MY_BIZ, MY_TEAM);
  await assertFails(setDoc(doc(bob, 'employeeReportScores', `${MY_BIZ}_bob_2026-07`), {
    businessId: MY_BIZ, userId: 'bob', periodKey: '2026-07',
    metrics: {}, compositeScore: 100,
  }));
});

test('R12g. a member cannot overwrite an existing accountability score', async () => {
  const bob = memberOf('bob', MY_BIZ, MY_TEAM);
  await assertFails(setDoc(doc(bob, 'employeeReportScores', 'ersMine'),
    { compositeScore: 100, managerFeedback: 'Shkelqyer' }, { merge: true }));
});

test('R12h. a member cannot redraw a client health score', async () => {
  const bob = memberOf('bob', MY_BIZ, MY_TEAM);
  await assertFails(setDoc(doc(bob, 'clientHealthScores', 'chsMine'),
    { score: 100, category: 'excellent' }, { merge: true }));
});

test('R12i. a member cannot hand-edit the metrics a client report is built from', async () => {
  const bob = memberOf('bob', MY_BIZ, MY_TEAM);
  await assertFails(setDoc(doc(bob, 'reportMetrics', 'metMine'),
    { values: { social_reach: 999999 } }, { merge: true }));
});

test('R12j. an admin may still write all three (manual correction stays possible)', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(setDoc(doc(alice, 'employeeReportScores', 'ersMine'),
    { managerFeedback: 'Sipas bisedes' }, { merge: true }));
  await assertSucceeds(setDoc(doc(alice, 'clientHealthScores', 'chsMine'),
    { score: 82 }, { merge: true }));
  await assertSucceeds(setDoc(doc(alice, 'reportMetrics', 'metMine'),
    { values: { social_reach: 1200 } }, { merge: true }));
});

test('R12k. tightening writes did not break the READ side', async () => {
  const bob = memberOf('bob', MY_BIZ, MY_TEAM);
  await assertSucceeds(getDoc(doc(bob, 'clientHealthScores', 'chsMine')));
  await assertSucceeds(getDoc(doc(bob, 'reportMetrics', 'metMine')));
  await assertSucceeds(getDoc(doc(bob, 'reports', 'repAliceDraft')));
});
