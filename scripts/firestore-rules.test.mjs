/**
 * Rules-unit tests for the HARDENED tenant-isolation rules (firestore.rules.hardened).
 * These are the gate before deploying the cutover — all 7 must pass.
 *
 * Setup (one-time):
 *   npm i -D @firebase/rules-unit-testing firebase-tools
 *   node scripts/build-hardened-rules.cjs         # produces firestore.rules.hardened
 *
 * Run:
 *   firebase emulators:exec --only firestore "node --test scripts/firestore-rules.test.mjs"
 *
 * (Uses the Node built-in test runner, so no extra test framework is required.)
 */
import { readFileSync } from 'node:fs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'fivocrm-rules-test';
const VICTIM_BIZ = 'bizVictim';
const VICTIM_TEAM = 'teamVictim';
const MY_BIZ = 'bizMine';
const MY_TEAM = 'teamMine';

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });

  // Seed with rules disabled.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // A legit member "alice" belongs to teamMine/bizMine (deterministic membership id).
    await setDoc(doc(db, 'teamMembers', `${MY_TEAM}_alice`), {
      userId: 'alice', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Member', status: 'Active',
    });
    // A portal customer owned by carol@client.com in bizMine.
    await setDoc(doc(db, 'customers', 'cust1'), {
      businessId: MY_BIZ, email: 'carol@client.com', name: 'Carol',
    });
    // A victim team so we can test forging a membership into it.
    await setDoc(doc(db, 'teams', VICTIM_TEAM), { businessId: VICTIM_BIZ, createdByUserId: 'victimOwner' });

    // users/{uid} tenant markers (chat rules resolve membership/portal via these).
    await setDoc(doc(db, 'users', 'alice'), { teamId: MY_TEAM, businessId: MY_BIZ });
    await setDoc(doc(db, 'users', 'carol'), { customerId: 'cust1' });
    // An existing channel message in bizMine (sent by someone else) for update tests.
    await setDoc(doc(db, 'messages', 'msg1'), {
      businessId: MY_BIZ, teamId: MY_TEAM, channelId: 'general-mine', senderId: 'zoe', content: 'hi',
    });

    // ── seed for the tenant-isolation hardening tests (12+) ──

    await setDoc(doc(db, 'businesses', MY_BIZ), { name: 'Mine', ownerId: 'aliceOwner', status: 'active' });
    await setDoc(doc(db, 'businesses', VICTIM_BIZ), { name: 'Victim', ownerId: 'victimOwner', status: 'active' });
    await setDoc(doc(db, 'businesses', 'bizSuspended'), { name: 'Late payer', ownerId: 'late', status: 'suspended' });
    await setDoc(doc(db, 'teams', MY_TEAM), { businessId: MY_BIZ, createdByUserId: 'aliceOwner', name: 'Mine' });
    await setDoc(doc(db, 'teams', 'teamSuspended'), { businessId: 'bizSuspended', createdByUserId: 'late' });
    await setDoc(doc(db, 'teamMembers', 'teamSuspended_late'), {
      userId: 'late', teamId: 'teamSuspended', businessId: 'bizSuspended', role: 'Admin', status: 'Active',
    });
    // Victim-tenant documents used as the cross-tenant read targets.
    await setDoc(doc(db, 'teamSettings', VICTIM_TEAM), { companyName: 'Victim Ltd', hasEmailApiKey: true });
    await setDoc(doc(db, 'teamSecrets', VICTIM_TEAM), { emailApiKey: 'super-secret' });
    await setDoc(doc(db, 'services', 'svcVictim'), { businessId: VICTIM_BIZ, name: 'Victim service', price: 999 });
    await setDoc(doc(db, 'channels', 'chVictim'), { businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, name: 'victim-general' });
    await setDoc(doc(db, 'teamMembers', `${VICTIM_TEAM}_vstaff`), {
      userId: 'vstaff', teamId: VICTIM_TEAM, businessId: VICTIM_BIZ, role: 'Admin', status: 'Active',
      email: 'vstaff@victim.com', monthlySalary: 250000,
    });
    await setDoc(doc(db, 'clientPortalAccess', 'paVictim'), {
      businessId: VICTIM_BIZ, customerId: 'custVictim', userId: 'vclient', email: 'vclient@victim.com', status: 'Active',
    });
    await setDoc(doc(db, 'counters', `invoices_${VICTIM_TEAM}`), { last: 42 });
    await setDoc(doc(db, 'auditLogs', 'auditVictim'), { businessId: VICTIM_BIZ, action: 'invite.accept', actorUid: 'vstaff' });
    // Duplicate-merge undo trail — holds the FULL absorbed contact, so a cross-tenant
    // read would hand over another tenant's customer record verbatim.
    await setDoc(doc(db, 'contactMerges', 'mergeVictim'), {
      businessId: VICTIM_BIZ, kind: 'customer', primaryId: 'custVictim', duplicateId: 'custVictimDup',
      duplicateSnapshot: { name: 'Victim Dup', email: 'dup@victim.com' },
    });
    await setDoc(doc(db, 'publicTenants', 'victim'), { businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, name: 'Victim' });
    // Operator job history (console improvement #11) — read-only, append-only.
    await setDoc(doc(db, 'platformJobRuns', 'run1'), {
      job: 'tenant-usage-rollup', ok: true, durationMs: 1200, manual: true, dryRun: false,
    });
    // Platform-wide monthly metrics (console improvement #2) — operator-only data.
    await setDoc(doc(db, 'platformMetrics', '2026-07'), {
      month: '2026-07', tenantsTotal: 12, tenantsActive: 5, signups: 6, activated: 2, churned: 1, mrr: 300, arr: 3600,
    });
    await setDoc(doc(db, 'teamInvites', 'invVictim'), {
      teamId: VICTIM_TEAM, businessId: VICTIM_BIZ, email: 'someone@victim.com', role: 'Admin',
      status: 'Pending', token: 'tok-victim', invitedByUserId: 'victimOwner',
    });
    await setDoc(doc(db, 'userProfiles', 'profVictim'), { userId: 'vstaff', displayName: 'V Staff', businessId: VICTIM_BIZ });

    // ── seed for the shop module (24+) ──
    // A published product in MY tenant (what a portal client of bizMine may read),
    // a DRAFT one in the same tenant (which they must not), and a published one in
    // the VICTIM tenant (the cross-tenant read target).
    await setDoc(doc(db, 'products', 'prodMinePublic'), {
      businessId: MY_BIZ, teamId: MY_TEAM, name: 'Karrige', price: 100,
      status: 'Active', visibleInPortal: true, costPrice: 40,
    });
    await setDoc(doc(db, 'products', 'prodMineDraft'), {
      businessId: MY_BIZ, teamId: MY_TEAM, name: 'Prototip i pabotuar', price: 1,
      status: 'Draft', visibleInPortal: false, costPrice: 0.5,
    });
    await setDoc(doc(db, 'products', 'prodVictim'), {
      businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, name: 'Victim product', price: 999,
      status: 'Active', visibleInPortal: true, costPrice: 500,
    });
    await setDoc(doc(db, 'productCategories', 'catVictim'), { businessId: VICTIM_BIZ, name: 'Victim cat' });
    await setDoc(doc(db, 'stockMovements', 'moveVictim'), {
      businessId: VICTIM_BIZ, productId: 'prodVictim', type: 'in', quantity: 10, unitCost: 500,
    });
    await setDoc(doc(db, 'shopOrders', 'orderVictim'), {
      businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, orderNumber: 'POR-2026-0001',
      customerId: 'custVictim', items: [], currency: 'ALL', subtotal: 0, total: 999,
      status: 'Pending', source: 'portal',
    });
    await setDoc(doc(db, 'shopOrders', 'orderMine'), {
      businessId: MY_BIZ, teamId: MY_TEAM, orderNumber: 'POR-2026-0002',
      customerId: 'cust1', items: [], currency: 'ALL', subtotal: 0, total: 100,
      status: 'Pending', source: 'portal',
    });
  });
});

after(async () => { await testEnv?.cleanup(); });

// 1. Attacker sets their own users doc's businessId to a victim tenant → DENIED.
test('1. self-attest into victim business is denied', async () => {
  const mallory = testEnv.authenticatedContext('mallory', { email: 'm@evil.com' }).firestore();
  await assertFails(setDoc(doc(mallory, 'users', 'mallory'), { businessId: VICTIM_BIZ, teamId: VICTIM_TEAM }));
});

// 2. Attacker forges a teamMembers doc into a victim team as Admin → DENIED.
test('2. forge membership into victim team is denied', async () => {
  const mallory = testEnv.authenticatedContext('mallory', { email: 'm@evil.com' }).firestore();
  await assertFails(setDoc(doc(mallory, 'teamMembers', `${VICTIM_TEAM}_mallory`), {
    userId: 'mallory', teamId: VICTIM_TEAM, businessId: VICTIM_BIZ, role: 'Admin', status: 'Active',
  }));
});

// 3. Legit member writes their real tenant keys → ALLOWED.
test('3. legit member sets own real tenant keys', async () => {
  const alice = testEnv.authenticatedContext('alice', { email: 'alice@mine.com' }).firestore();
  await assertSucceeds(setDoc(doc(alice, 'users', 'alice'), { teamId: MY_TEAM, businessId: MY_BIZ }));
});

// 4. Member of two teams switches to the other one they actually belong to → ALLOWED.
test('4. legit team switch among own memberships', async () => {
  const SECOND_TEAM = 'teamMine2';
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teamMembers', `${SECOND_TEAM}_alice`), {
      userId: 'alice', teamId: SECOND_TEAM, businessId: MY_BIZ, role: 'Member', status: 'Active',
    });
  });
  const alice = testEnv.authenticatedContext('alice', { email: 'alice@mine.com' }).firestore();
  await assertSucceeds(setDoc(doc(alice, 'users', 'alice'), { teamId: SECOND_TEAM, businessId: MY_BIZ }));
});

// 5. Super-admin sets a team they don't belong to → ALLOWED (claim bypass).
test('5. super-admin bypass', async () => {
  const sa = testEnv.authenticatedContext('root', { email: 'root@fivo.al', superAdmin: true }).firestore();
  await assertSucceeds(setDoc(doc(sa, 'users', 'root'), { teamId: VICTIM_TEAM, businessId: VICTIM_BIZ }));
});

// 6. Portal client sets customerId for their OWN customer (email match) → ALLOWED;
//    for someone else's customer → DENIED.
test('6a. portal client claims own customer', async () => {
  const carol = testEnv.authenticatedContext('carol', { email: 'carol@client.com' }).firestore();
  await assertSucceeds(setDoc(doc(carol, 'users', 'carol'), { customerId: 'cust1', businessId: MY_BIZ }));
});
test('6b. portal client cannot claim a customer they do not own', async () => {
  const evil = testEnv.authenticatedContext('evil', { email: 'evil@x.com' }).firestore();
  await assertFails(setDoc(doc(evil, 'users', 'evil'), { customerId: 'cust1', businessId: MY_BIZ }));
});

// 7. Owner may create a membership in their own team → ALLOWED; a non-owner may not.
test('7. only team owner creates memberships client-side', async () => {
  const OWNED = 'teamOwned';
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teams', OWNED), { businessId: 'bizOwned', createdByUserId: 'owner' });
  });
  const owner = testEnv.authenticatedContext('owner', { email: 'owner@o.com' }).firestore();
  await assertSucceeds(setDoc(doc(owner, 'teamMembers', `${OWNED}_bob`), {
    userId: 'bob', teamId: OWNED, businessId: 'bizOwned', role: 'Member', status: 'Active',
  }));
  const stranger = testEnv.authenticatedContext('stranger', { email: 's@s.com' }).firestore();
  await assertFails(setDoc(doc(stranger, 'teamMembers', `${OWNED}_stranger`), {
    userId: 'stranger', teamId: OWNED, businessId: 'bizOwned', role: 'Admin', status: 'Active',
  }));
});

// ── Chat message rules (hardening pass) ──

// 8. Staff posts into their own team's channel → ALLOWED; a stranger can't stamp that team.
test('8a. staff posts in own team channel', async () => {
  const alice = testEnv.authenticatedContext('alice', { email: 'alice@mine.com' }).firestore();
  await assertSucceeds(setDoc(doc(alice, 'messages', 'm-a1'), {
    teamId: MY_TEAM, businessId: MY_BIZ, channelId: 'general-mine', senderId: 'alice', content: 'hi',
  }));
});
test('8b. stranger cannot post stamped with a team they are not in', async () => {
  const mallory = testEnv.authenticatedContext('mallory', { email: 'm@evil.com' }).firestore();
  await assertFails(setDoc(doc(mallory, 'messages', 'm-m1'), {
    teamId: VICTIM_TEAM, businessId: VICTIM_BIZ, channelId: 'general-victim', senderId: 'mallory', content: 'x',
  }));
});

// 9. Portal client posts into their OWN client channel → ALLOWED; into another's → DENIED.
test('9a. portal client posts in own client channel', async () => {
  const carol = testEnv.authenticatedContext('carol', { email: 'carol@client.com' }).firestore();
  await assertSucceeds(setDoc(doc(carol, 'messages', 'm-c1'), {
    senderType: 'client', channelId: 'client-cust1', senderId: 'carol', content: 'hello',
  }));
});
test('9b. portal client cannot post in another customer channel', async () => {
  const carol = testEnv.authenticatedContext('carol', { email: 'carol@client.com' }).firestore();
  await assertFails(setDoc(doc(carol, 'messages', 'm-c2'), {
    senderType: 'client', channelId: 'client-someoneElse', senderId: 'carol', content: 'sneaky',
  }));
});

// 10. Reactions/read (field-whitelist update): a business member may; an outsider may not.
test('10a. business member can react to a message in their tenant', async () => {
  const alice = testEnv.authenticatedContext('alice', { email: 'alice@mine.com' }).firestore();
  await assertSucceeds(setDoc(doc(alice, 'messages', 'msg1'), { reactions: { '👍': ['alice'] } }, { merge: true }));
});
test('10b. outsider cannot react to a message in another tenant', async () => {
  const mallory = testEnv.authenticatedContext('mallory', { email: 'm@evil.com' }).firestore();
  await assertFails(setDoc(doc(mallory, 'messages', 'msg1'), { reactions: { '💀': ['mallory'] } }, { merge: true }));
});

// 11. The dead directMessages collection is fully locked.
test('11. directMessages is denied for everyone', async () => {
  const alice = testEnv.authenticatedContext('alice', { email: 'alice@mine.com' }).firestore();
  await assertFails(setDoc(doc(alice, 'directMessages', 'dm1'), { teamId: MY_TEAM, x: 1 }));
});

// ══════════════════════════════════════════════════════════════════════════════
// Tenant-isolation hardening pass (claims + team-inside-business + closed reads)
// ══════════════════════════════════════════════════════════════════════════════

/** Signed tenant claims, the way api/_tenantClaims.ts mints them. */
const staffOf = (uid, bid, tid, roles = ['member'], email = `${uid}@x.com`) =>
  testEnv.authenticatedContext(uid, { email, bid, tid, roles }).firestore();
const portalOf = (uid, cid, email, pbid = MY_BIZ) =>
  testEnv.authenticatedContext(uid, { email, cid, pbid }).firestore();
const outsider = () => testEnv.authenticatedContext('mallory', { email: 'm@evil.com', bid: VICTIM_BIZ, tid: VICTIM_TEAM, roles: ['admin'] }).firestore();

// 12. The credential vault is unreachable from any client, super-admin included.
test('12. teamSecrets is deny-all (even for super-admin)', async () => {
  const sa = testEnv.authenticatedContext('root', { email: 'root@fivo.al', superAdmin: true }).firestore();
  await assertFails(getDoc(doc(sa, 'teamSecrets', VICTIM_TEAM)));
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(getDoc(doc(alice, 'teamSecrets', MY_TEAM)));
  await assertFails(setDoc(doc(alice, 'teamSecrets', MY_TEAM), { emailApiKey: 'x' }));
});

// 13. teamSettings: readable inside the tenant, not across it; credential fields are
//     rejected even for an admin of the tenant (they'd become member-readable).
test('13a. cross-tenant teamSettings read is denied', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(getDoc(doc(alice, 'teamSettings', VICTIM_TEAM)));
});
test('13b. own-tenant teamSettings read is allowed', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teamSettings', MY_TEAM), { companyName: 'Mine Ltd' });
  });
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(getDoc(doc(alice, 'teamSettings', MY_TEAM)));
});
test('13c. writing a credential into teamSettings is denied', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(setDoc(doc(alice, 'teamSettings', MY_TEAM), { emailApiKey: 'leak-me' }, { merge: true }));
});

// 14. Cross-tenant reads of the collections that used to be `read: if isAuth()`.
test('14. cross-tenant reads are denied across the board', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  for (const [col, id] of [
    ['services', 'svcVictim'],
    ['channels', 'chVictim'],
    ['teamMembers', `${VICTIM_TEAM}_vstaff`],
    ['clientPortalAccess', 'paVictim'],
    ['counters', `invoices_${VICTIM_TEAM}`],
    ['auditLogs', 'auditVictim'],
    ['contactMerges', 'mergeVictim'],
    ['teams', VICTIM_TEAM],
    ['businesses', VICTIM_BIZ],
    ['userProfiles', 'profVictim'],
    ['teamInvites', 'invVictim'],
  ]) {
    await assertFails(getDoc(doc(alice, col, id)));
  }
});

// 15. A portal client cannot read the staff directory of ANY tenant (salary data).
test('15. portal client cannot read teamMembers', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com');
  await assertFails(getDoc(doc(carol, 'teamMembers', `${VICTIM_TEAM}_vstaff`)));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teamMembers', `${MY_TEAM}_bob`), {
      userId: 'bob', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Admin', status: 'Active', monthlySalary: 1,
    });
  });
  await assertFails(getDoc(doc(carol, 'teamMembers', `${MY_TEAM}_bob`)));
});

// 16. A portal client reads their OWN tenant's service catalogue, never another's.
test('16. portal client reads own business services only', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'services', 'svcMine'), { businessId: MY_BIZ, name: 'SEO' });
  });
  const carol = portalOf('carol', 'cust1', 'carol@client.com');
  await assertSucceeds(getDoc(doc(carol, 'services', 'svcMine')));
  await assertFails(getDoc(doc(carol, 'services', 'svcVictim')));
});

// 17. The invite-forgery chain: an outsider cannot mint an invite into another team,
//     and cannot smuggle an Admin invite into a team they only manage.
test('17a. forging an invite into a victim team is denied', async () => {
  const mallory = outsider();
  await assertFails(setDoc(doc(mallory, 'teamInvites', 'inv-forged'), {
    teamId: MY_TEAM, businessId: MY_BIZ, email: 'm@evil.com', role: 'Admin', status: 'Pending', token: 'tok-forged',
  }));
});
test('17b. team owner may invite', async () => {
  const owner = testEnv.authenticatedContext('aliceOwner', { email: 'owner@mine.com', bid: MY_BIZ, tid: MY_TEAM, roles: ['owner', 'admin'] }).firestore();
  await assertSucceeds(setDoc(doc(owner, 'teamInvites', 'inv-ok'), {
    teamId: MY_TEAM, businessId: MY_BIZ, email: 'new@mine.com', role: 'Member', status: 'Pending', token: 'tok-ok',
  }));
});
test('17c. a Manager cannot mint an Admin invite', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teamMembers', `${MY_TEAM}_mgr`), {
      userId: 'mgr', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Manager', status: 'Active',
    });
  });
  const mgr = staffOf('mgr', MY_BIZ, MY_TEAM, ['manager'], 'mgr@mine.com');
  await assertFails(setDoc(doc(mgr, 'teamInvites', 'inv-esc'), {
    teamId: MY_TEAM, businessId: MY_BIZ, email: 'x@mine.com', role: 'Admin', status: 'Pending', token: 'tok-esc',
  }));
  await assertSucceeds(setDoc(doc(mgr, 'teamInvites', 'inv-mgr'), {
    teamId: MY_TEAM, businessId: MY_BIZ, email: 'y@mine.com', role: 'Member', status: 'Pending', token: 'tok-mgr',
  }));
});
test('17d. the invitee can read their own invite', async () => {
  const invitee = testEnv.authenticatedContext('newguy', { email: 'someone@victim.com' }).firestore();
  await assertSucceeds(getDoc(doc(invitee, 'teamInvites', 'invVictim')));
});

// 18. A team must live inside a business, and can never be moved between tenants.
test('18a. creating a team outside your business is denied', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(setDoc(doc(alice, 'teams', 'teamHijack'), {
    name: 'Hijack', businessId: VICTIM_BIZ, createdByUserId: 'alice',
  }));
});
test('18b. creating a team without a business is denied', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(setDoc(doc(alice, 'teams', 'teamOrphan'), { name: 'Orphan', createdByUserId: 'alice' }));
});
test('18c. creating a team inside your own business is allowed', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(setDoc(doc(alice, 'teams', 'teamDept2'), {
    name: 'Dept 2', businessId: MY_BIZ, createdByUserId: 'alice',
  }));
});
test('18d. moving a team to another business is denied', async () => {
  const owner = testEnv.authenticatedContext('aliceOwner', { email: 'owner@mine.com', bid: MY_BIZ, tid: MY_TEAM, roles: ['owner', 'admin'] }).firestore();
  await assertFails(setDoc(doc(owner, 'teams', MY_TEAM), { businessId: VICTIM_BIZ }, { merge: true }));
});

// 19. A suspended tenant is read-only (billing enforcement at the data layer).
test('19. suspended tenant cannot write', async () => {
  const late = staffOf('late', 'bizSuspended', 'teamSuspended', ['admin'], 'late@x.com');
  await assertFails(setDoc(doc(late, 'customers', 'custNew'), { businessId: 'bizSuspended', name: 'New' }));
});

// 20. Notification injection into another tenant's user is denied.
test('20. cannot inject a notification for a user outside your tenant', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', 'vstaff'), { teamId: VICTIM_TEAM, businessId: VICTIM_BIZ });
  });
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(setDoc(doc(alice, 'notifications', 'notifEvil'), {
    userId: 'vstaff', type: 'invoice_paid', title: 'Klikoni këtu', actionUrl: 'https://evil.example',
  }));
});

// 21. A tenant cannot un-suspend itself / change its own plan.
test('21. tenant cannot lift its own suspension', async () => {
  const late = testEnv.authenticatedContext('late', { email: 'late@x.com', bid: 'bizSuspended', tid: 'teamSuspended', roles: ['owner', 'admin'] }).firestore();
  await assertFails(setDoc(doc(late, 'businesses', 'bizSuspended'), { status: 'active' }, { merge: true }));
});

// 22. The audit trail can never be rewritten or erased.
test('22. auditLogs are append-only', async () => {
  const sa = testEnv.authenticatedContext('root', { email: 'root@fivo.al', superAdmin: true }).firestore();
  await assertFails(setDoc(doc(sa, 'auditLogs', 'auditVictim'), { action: 'nothing.happened' }, { merge: true }));
});

// 23. The public subdomain map is world-readable but never client-writable.
test('23. publicTenants is readable, not writable', async () => {
  const anon = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(anon, 'publicTenants', 'victim')));
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(setDoc(doc(alice, 'publicTenants', 'victim'), { businessId: MY_BIZ }, { merge: true }));
});

// ══════════════════════════════════════════════════════════════════════════════
// Shop module (products / taxonomy / inventory ledger / orders)
// Invariant 5 of TENANT_ISOLATION_ENTERPRISE.md: a new collection ships with a
// negative cross-tenant test.
// ══════════════════════════════════════════════════════════════════════════════

// 24. Staff of another tenant cannot read this tenant's catalog — not even the
//     published part, which carries costPrice (margin intelligence).
test('24a. cross-tenant staff cannot read another tenant products', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(getDoc(doc(alice, 'products', 'prodVictim')));
});
test('24b. staff read their own tenant products', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(getDoc(doc(alice, 'products', 'prodMinePublic')));
  await assertSucceeds(getDoc(doc(alice, 'products', 'prodMineDraft')));
});

// 25. The portal client sees ONLY their own tenant's PUBLISHED catalog. This is the
//     pair that makes the shop read rule safe: tenant match AND visibleInPortal.
test('25a. portal client reads a published product of their own tenant', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertSucceeds(getDoc(doc(carol, 'products', 'prodMinePublic')));
});
test('25b. portal client cannot read an unpublished product of their own tenant', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertFails(getDoc(doc(carol, 'products', 'prodMineDraft')));
});
test('25c. portal client cannot read another tenant published product', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertFails(getDoc(doc(carol, 'products', 'prodVictim')));
});

// 26. A portal client is never staff: publishing/editing the catalog is staff-only.
test('26a. portal client cannot create a product', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertFails(setDoc(doc(carol, 'products', 'prodInjected'), {
    businessId: MY_BIZ, name: 'Free stuff', price: 0, status: 'Active', visibleInPortal: true,
  }));
});
test('26b. portal client cannot reprice a product', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertFails(setDoc(doc(carol, 'products', 'prodMinePublic'), { price: 1 }, { merge: true }));
});
test('26c. staff cannot stamp a product into another tenant', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(setDoc(doc(alice, 'products', 'prodSmuggled'), {
    businessId: VICTIM_BIZ, name: 'Smuggled', price: 1, status: 'Active',
  }));
});
test('26d. a product can never be moved to another tenant by update', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(setDoc(doc(alice, 'products', 'prodMinePublic'), { businessId: VICTIM_BIZ }, { merge: true }));
});

// 27. Taxonomy follows the same boundary (the portal renders category filters).
test('27. cross-tenant product categories are unreadable', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(getDoc(doc(alice, 'productCategories', 'catVictim')));
});

// 28. The inventory ledger is staff-only AND append-only: it carries unit costs and
//     is the audit trail every stock number depends on.
test('28a. portal client cannot read the inventory ledger', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertFails(getDoc(doc(carol, 'stockMovements', 'moveVictim')));
});
test('28b. cross-tenant staff cannot read the inventory ledger', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(getDoc(doc(alice, 'stockMovements', 'moveVictim')));
});
test('28c. a stock movement cannot be rewritten', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'stockMovements', 'moveMine'), {
      businessId: MY_BIZ, productId: 'prodMinePublic', type: 'in', quantity: 5,
    });
  });
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(setDoc(doc(alice, 'stockMovements', 'moveMine'), { quantity: 500 }, { merge: true }));
});

// 29. Orders: a client may place their own, read their own, and nothing else.
test('29a. portal client creates their own Pending order', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertSucceeds(setDoc(doc(carol, 'shopOrders', 'orderNew'), {
    businessId: MY_BIZ, teamId: MY_TEAM, orderNumber: 'POR-2026-0003',
    customerId: 'cust1', items: [], currency: 'ALL', subtotal: 0, total: 100,
    status: 'Pending', source: 'portal', createdByUserId: 'carol',
  }));
});
test('29b. portal client cannot place an order as another customer', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertFails(setDoc(doc(carol, 'shopOrders', 'orderSpoofed'), {
    businessId: MY_BIZ, teamId: MY_TEAM, orderNumber: 'POR-2026-0004',
    customerId: 'custVictim', items: [], currency: 'ALL', subtotal: 0, total: 1,
    status: 'Pending', source: 'portal', createdByUserId: 'carol',
  }));
});
test('29c. portal client cannot self-approve an order (no update)', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertFails(setDoc(doc(carol, 'shopOrders', 'orderMine'),
    { status: 'Delivered', paymentStatus: 'Paid' }, { merge: true }));
});
test('29d. portal client reads their own order but not another tenant order', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertSucceeds(getDoc(doc(carol, 'shopOrders', 'orderMine')));
  await assertFails(getDoc(doc(carol, 'shopOrders', 'orderVictim')));
});
test('29e. cross-tenant staff cannot read another tenant orders', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(getDoc(doc(alice, 'shopOrders', 'orderVictim')));
});

// ── platformMetrics: platform history is operator-only (console improvement #2) ──
test('30a. a tenant cannot read platform-wide metrics', async () => {
  // It would expose the size and shape of the whole customer base to one customer.
  const alice = testEnv.authenticatedContext('alice', { email: 'alice@mine.com', bid: MY_BIZ, tid: MY_TEAM, roles: ['admin'] }).firestore();
  await assertFails(getDoc(doc(alice, 'platformMetrics', '2026-07')));
});

test('30b. a super-admin reads platform metrics', async () => {
  const sa = testEnv.authenticatedContext('root', { email: 'root@fivo.al', superAdmin: true }).firestore();
  await assertSucceeds(getDoc(doc(sa, 'platformMetrics', '2026-07')));
});

test('30c. nobody writes platform metrics from a client — not even a super-admin', async () => {
  // The rollup cron owns this collection through the Admin SDK; a client write would
  // let someone fake the growth numbers the business is steered by.
  const sa = testEnv.authenticatedContext('root', { email: 'root@fivo.al', superAdmin: true }).firestore();
  await assertFails(setDoc(doc(sa, 'platformMetrics', '2026-07'), { mrr: 999999 }, { merge: true }));
  const alice = testEnv.authenticatedContext('alice', { email: 'alice@mine.com', bid: MY_BIZ }).firestore();
  await assertFails(setDoc(doc(alice, 'platformMetrics', '2026-08'), { mrr: 1 }));
});

test('31. usage rollup data rides on the business doc, so tenant isolation still applies', async () => {
  // `businesses.usage` is written by the cron; a cross-tenant read of it must fail for
  // the same reason any other cross-tenant business read does.
  const alice = testEnv.authenticatedContext('alice', { email: 'alice@mine.com', bid: MY_BIZ, tid: MY_TEAM }).firestore();
  await assertFails(getDoc(doc(alice, 'businesses', VICTIM_BIZ)));
  const sa = testEnv.authenticatedContext('root', { email: 'root@fivo.al', superAdmin: true }).firestore();
  await assertSucceeds(getDoc(doc(sa, 'businesses', VICTIM_BIZ)));
});

// ── platformJobRuns: the operations log must be unforgeable (improvement #11) ──
test('32a. a tenant cannot read the platform job history', async () => {
  const alice = testEnv.authenticatedContext('alice', { email: 'alice@mine.com', bid: MY_BIZ, tid: MY_TEAM, roles: ['admin'] }).firestore();
  await assertFails(getDoc(doc(alice, 'platformJobRuns', 'run1')));
});

test('32b. a super-admin reads it but cannot write or rewrite it', async () => {
  const sa = testEnv.authenticatedContext('root', { email: 'root@fivo.al', superAdmin: true }).firestore();
  await assertSucceeds(getDoc(doc(sa, 'platformJobRuns', 'run1')));
  // An operations log you can edit is worthless when reconstructing what a migration did.
  await assertFails(setDoc(doc(sa, 'platformJobRuns', 'run1'), { ok: false }, { merge: true }));
  await assertFails(setDoc(doc(sa, 'platformJobRuns', 'forged'), { job: 'never-ran', ok: true }));
});

// ── contactMerges: the only copy of a merged-away contact ──────────────────────
test('33a. the merge undo trail is readable by its own tenant admin, nobody else', async () => {
  const victimAdmin = staffOf('vadmin', VICTIM_BIZ, VICTIM_TEAM, ['admin']);
  await assertSucceeds(getDoc(doc(victimAdmin, 'contactMerges', 'mergeVictim')));
  // A member of the same tenant is not an admin — the archive holds full contact data.
  const victimMember = staffOf('vmember', VICTIM_BIZ, VICTIM_TEAM, ['member']);
  await assertFails(getDoc(doc(victimMember, 'contactMerges', 'mergeVictim')));
});

test('33b. no client may write the merge trail — it is the undo source of truth', async () => {
  const victimAdmin = staffOf('vadmin', VICTIM_BIZ, VICTIM_TEAM, ['admin']);
  await assertFails(setDoc(doc(victimAdmin, 'contactMerges', 'mergeVictim'), { duplicateSnapshot: {} }, { merge: true }));
  await assertFails(setDoc(doc(victimAdmin, 'contactMerges', 'forged'), { businessId: VICTIM_BIZ, kind: 'customer' }));
  const sa = testEnv.authenticatedContext('root', { email: 'root@fivo.al', superAdmin: true }).firestore();
  await assertFails(setDoc(doc(sa, 'contactMerges', 'mergeVictim'), { kind: 'lead' }, { merge: true }));
});

// ── teamMembers.position: mandatory at login, so it must be self-writable ──────
// Declaring your own craft cannot be an admin-only field (nobody would be there at
// 09:00 to unblock a new hire), but it must not open a hole next to role/salary.
test('34a. a member may declare their own position', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member'], 'alice@mine.com');
  await assertSucceeds(updateDoc(doc(alice, 'teamMembers', `${MY_TEAM}_alice`), {
    position: 'web', updatedAt: new Date(),
  }));
});

test('34b. the position write is not a lever for role or pay', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member'], 'alice@mine.com');
  // Smuggled alongside a legitimate field.
  await assertFails(updateDoc(doc(alice, 'teamMembers', `${MY_TEAM}_alice`), {
    position: 'web', role: 'Admin',
  }));
  await assertFails(updateDoc(doc(alice, 'teamMembers', `${MY_TEAM}_alice`), {
    position: 'web', monthlySalary: 999999,
  }));
  // serviceLines drives the P&L, not the daily report — still owner-only.
  await assertFails(updateDoc(doc(alice, 'teamMembers', `${MY_TEAM}_alice`), {
    position: 'web', serviceLines: ['seo'],
  }));
});

test('34c. nobody sets another member position', async () => {
  const mallory = testEnv.authenticatedContext('mallory', { email: 'm@evil.com', bid: VICTIM_BIZ, tid: VICTIM_TEAM, roles: ['admin'] }).firestore();
  await assertFails(updateDoc(doc(mallory, 'teamMembers', `${MY_TEAM}_alice`), { position: 'web' }));
});

// ── 35. The owner's OWN membership row (reported bug: "nuk më ruhet rroga") ──
// The owner branch of the update rule used to carry
// `resource.data.userId != request.auth.uid`, so the owner's own row could only
// ever be matched by the narrow SELF allow-list
// (displayName/email/position/updatedAt). Setting their own monthlySalary was
// therefore denied — silently, since the UI awaited the write and still showed a
// success toast. Their payroll then stayed missing from every P&L that reads
// teamMembers.monthlySalary (project overhead, department labour, cashflow).
const OWNER_UID = 'aliceOwner';
const ownerCtx = () => testEnv.authenticatedContext(OWNER_UID, {
  email: 'owner@mine.com', bid: MY_BIZ, tid: MY_TEAM, roles: ['owner', 'admin'],
}).firestore();

async function seedOwnerMembership() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teamMembers', `${MY_TEAM}_${OWNER_UID}`), {
      userId: OWNER_UID, teamId: MY_TEAM, businessId: MY_BIZ, role: 'Admin',
      status: 'Active', email: 'owner@mine.com', displayName: 'Alice Owner',
    });
  });
}

test('35a. the team owner may set their OWN salary and salary history', async () => {
  await seedOwnerMembership();
  const owner = ownerCtx();
  await assertSucceeds(updateDoc(doc(owner, 'teamMembers', `${MY_TEAM}_${OWNER_UID}`), {
    monthlySalary: 90000,
    salaryHistory: [{ monthlySalary: 90000, effectiveFrom: '2026-08-01' }],
    updatedAt: new Date(),
  }));
});

test('35b. the owner may set their own P&L allocation and status', async () => {
  await seedOwnerMembership();
  const owner = ownerCtx();
  await assertSucceeds(updateDoc(doc(owner, 'teamMembers', `${MY_TEAM}_${OWNER_UID}`), {
    serviceLines: ['seo'], hourlyCostRate: 12, status: 'Active',
  }));
});

test('35c. but the owner still cannot change their OWN role', async () => {
  await seedOwnerMembership();
  const owner = ownerCtx();
  // Pinning `role` on the self-edit keeps this from being a self-escalation path
  // and stops an owner locking themselves out by accident.
  await assertFails(updateDoc(doc(owner, 'teamMembers', `${MY_TEAM}_${OWNER_UID}`), {
    role: 'Viewer',
  }));
  await assertFails(updateDoc(doc(owner, 'teamMembers', `${MY_TEAM}_${OWNER_UID}`), {
    monthlySalary: 1, role: 'Member',
  }));
});

test('35d. a plain MEMBER still cannot set their own pay', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member'], 'alice@mine.com');
  await assertFails(updateDoc(doc(alice, 'teamMembers', `${MY_TEAM}_alice`), {
    monthlySalary: 999999,
  }));
  await assertFails(updateDoc(doc(alice, 'teamMembers', `${MY_TEAM}_alice`), {
    salaryHistory: [{ monthlySalary: 999999, effectiveFrom: '2026-01-01' }],
  }));
});

test('35d2. a MANAGER has no roster authority either', async () => {
  // canManageMembers() deliberately excludes `manager`, which isBusinessAdmin()
  // would have included: roster writes carry salary and role, and a department
  // lead should not hold that. If this ever needs to change, change it here.
  const lead = staffOf('lead', MY_BIZ, MY_TEAM, ['manager'], 'lead@mine.com');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teamMembers', `${MY_TEAM}_lead`), {
      userId: 'lead', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Manager',
      status: 'Active', email: 'lead@mine.com',
    });
  });
  await assertFails(updateDoc(doc(lead, 'teamMembers', `${MY_TEAM}_lead`), { monthlySalary: 5 }));
  await assertFails(updateDoc(doc(lead, 'teamMembers', `${MY_TEAM}_alice`), { monthlySalary: 5 }));
});

// The requested policy: owner AND admin manage the roster. An admin is NOT
// necessarily the team's creator, so isTeamOwner() alone locked them out — which
// is how the business owner ended up unable to save their own salary when the
// team had been created by somebody else.
test('35f. an ADMIN who did not create the team manages the roster', async () => {
  const admin = staffOf('boss', MY_BIZ, MY_TEAM, ['admin'], 'boss@mine.com');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teamMembers', `${MY_TEAM}_boss`), {
      userId: 'boss', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Admin',
      status: 'Active', email: 'boss@mine.com',
    });
  });
  // Their own pay …
  await assertSucceeds(updateDoc(doc(admin, 'teamMembers', `${MY_TEAM}_boss`), {
    monthlySalary: 120000,
    salaryHistory: [{ monthlySalary: 120000, effectiveFrom: '2026-08-01' }],
  }));
  // … and somebody else's, including their role.
  await assertSucceeds(updateDoc(doc(admin, 'teamMembers', `${MY_TEAM}_alice`), {
    monthlySalary: 45000, role: 'Manager',
  }));
  // But never their own role.
  await assertFails(updateDoc(doc(admin, 'teamMembers', `${MY_TEAM}_boss`), { role: 'Owner' }));
});

test('35i. a membership must be keyed {teamId}_{userId}', async () => {
  const admin = staffOf('boss', MY_BIZ, MY_TEAM, ['admin'], 'boss@mine.com');
  // The exploit the key pinning closes: authority is proved with the row's OWN
  // (legitimate) team, while the DOCUMENT ID names the victim team. isTeamMember()
  // only checks that the id exists, so this used to mint access to teamVictim.
  await assertFails(setDoc(doc(admin, 'teamMembers', `${VICTIM_TEAM}_boss`), {
    userId: 'boss', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Admin', status: 'Active',
  }));
  // A generated/random id is refused too — it would leave a member whose own
  // tenant checks fail until backfill-member-keys re-keys them.
  await assertFails(setDoc(doc(admin, 'teamMembers', 'randomLookingId123'), {
    userId: 'newbie2', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Member', status: 'Active',
  }));
  // Claiming someone else's uid in the id while the data says you is refused.
  await assertFails(setDoc(doc(admin, 'teamMembers', `${MY_TEAM}_someoneelse`), {
    userId: 'boss', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Member', status: 'Active',
  }));
  // The correct key is accepted.
  await assertSucceeds(setDoc(doc(admin, 'teamMembers', `${MY_TEAM}_newbie3`), {
    userId: 'newbie3', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Member', status: 'Active',
  }));
});

test('35j. a legacy row with no businessId is still manageable, not bricked', async () => {
  // `resource.data.businessId` THREW on such a row, and a thrown expression denies
  // for everyone — the owner included. Reading it with .get() turns that into a
  // clean evaluation so team ownership can still carry the edit.
  const OWNED2 = 'teamLegacy';
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'teams', OWNED2), { businessId: MY_BIZ, createdByUserId: 'legacyOwner' });
    await setDoc(doc(db, 'teamMembers', `${OWNED2}_ghost`), {
      userId: 'ghost', teamId: OWNED2, role: 'Member', status: 'Active',
    });
  });
  const owner = testEnv.authenticatedContext('legacyOwner', { email: 'lo@mine.com' }).firestore();
  await assertSucceeds(updateDoc(doc(owner, 'teamMembers', `${OWNED2}_ghost`), {
    monthlySalary: 30000,
  }));
});

test('35h. an admin cannot name ANOTHER business team on a new membership', async () => {
  // The dangerous shape: prove authority with your OWN businessId while naming a
  // team from someone else's. `isTeamMember()` is satisfied by the mere existence
  // of `teamMembers/{teamId}_{uid}`, and many rules grant access on that alone, so
  // this would be a self-service door into the victim team.
  const admin = staffOf('boss', MY_BIZ, MY_TEAM, ['admin'], 'boss@mine.com');
  await assertFails(setDoc(doc(admin, 'teamMembers', `${VICTIM_TEAM}_boss`), {
    userId: 'boss', teamId: VICTIM_TEAM, businessId: MY_BIZ, role: 'Admin', status: 'Active',
  }));
  // Nor by naming the victim business outright — the claim does not cover it.
  await assertFails(setDoc(doc(admin, 'teamMembers', `${VICTIM_TEAM}_boss2`), {
    userId: 'boss', teamId: VICTIM_TEAM, businessId: VICTIM_BIZ, role: 'Admin', status: 'Active',
  }));
});

test('35g. an admin may add and remove members', async () => {
  const admin = staffOf('boss', MY_BIZ, MY_TEAM, ['admin'], 'boss@mine.com');
  await assertSucceeds(setDoc(doc(admin, 'teamMembers', `${MY_TEAM}_newbie`), {
    userId: 'newbie', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Member', status: 'Active',
  }));
  await assertSucceeds(deleteDoc(doc(admin, 'teamMembers', `${MY_TEAM}_newbie`)));
});

test('35e. an owner of ANOTHER team cannot touch this team member', async () => {
  const victimOwner = testEnv.authenticatedContext('victimOwner', {
    email: 'vo@victim.com', bid: VICTIM_BIZ, tid: VICTIM_TEAM, roles: ['owner', 'admin'],
  }).firestore();
  await assertFails(updateDoc(doc(victimOwner, 'teamMembers', `${MY_TEAM}_alice`), {
    monthlySalary: 1,
  }));
});

// ── Notifications & push tokens ───────────────────────────────────────────────

test('36a. a push token belongs to exactly one user', async () => {
  // Tokens moved from a single doc `userPushTokens/{uid}` to a per-device
  // subcollection so a phone and a laptop stop overwriting each other. The
  // subcollection must inherit the same owner-only rule as the parent — a device
  // token is enough to receive somebody else's notifications.
  const alice = testEnv.authenticatedContext('alice', { email: 'a@mine.com', bid: MY_BIZ }).firestore();
  const mallory = testEnv.authenticatedContext('mallory', { email: 'm@victim.com', bid: VICTIM_BIZ }).firestore();

  await assertSucceeds(setDoc(doc(alice, 'userPushTokens', 'alice', 'tokens', 'dev1'), {
    token: 'fcm-token-1', platform: 'web',
  }));
  // Same user, second device — both coexist.
  await assertSucceeds(setDoc(doc(alice, 'userPushTokens', 'alice', 'tokens', 'dev2'), {
    token: 'fcm-token-2', platform: 'android',
  }));
  // Logout removes only this device.
  await assertSucceeds(deleteDoc(doc(alice, 'userPushTokens', 'alice', 'tokens', 'dev2')));

  // Nobody else may read or write them.
  await assertFails(getDoc(doc(mallory, 'userPushTokens', 'alice', 'tokens', 'dev1')));
  await assertFails(setDoc(doc(mallory, 'userPushTokens', 'alice', 'tokens', 'evil'), {
    token: 'attacker-device',
  }));
  await assertFails(deleteDoc(doc(mallory, 'userPushTokens', 'alice', 'tokens', 'dev1')));
});

test('36b. notifications stay readable only by their addressee', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'notifications', 'notifAlice'), {
      userId: 'alice', type: 'task_assigned', title: 'Detyrë', isRead: false, businessId: MY_BIZ,
    });
  });
  const alice = testEnv.authenticatedContext('alice', { email: 'a@mine.com', bid: MY_BIZ }).firestore();
  const mallory = testEnv.authenticatedContext('mallory', { email: 'm@victim.com', bid: VICTIM_BIZ }).firestore();

  await assertSucceeds(getDoc(doc(alice, 'notifications', 'notifAlice')));
  await assertSucceeds(updateDoc(doc(alice, 'notifications', 'notifAlice'), { isRead: true }));
  // A tenant stamp does not make it readable by that tenant — only the addressee.
  await assertFails(getDoc(doc(mallory, 'notifications', 'notifAlice')));
  await assertFails(updateDoc(doc(mallory, 'notifications', 'notifAlice'), { isRead: true }));
  await assertFails(deleteDoc(doc(mallory, 'notifications', 'notifAlice')));
});

test('36e. a notification cannot be re-addressed or rewritten after creation', async () => {
  // The create rule limits WHO you may notify (self or same tenant). Without a field
  // guard on update, the check was bypassable: create a notification for yourself,
  // then update userId to any uid on the platform — phishing with an attacker-chosen
  // actionUrl, cross-tenant. Update must stay strictly "mark as read".
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'notifications', 'notifSelf'), {
      userId: 'alice', type: 'task_assigned', title: 'Detyrë', isRead: false, businessId: MY_BIZ,
    });
  });
  const alice = testEnv.authenticatedContext('alice', { email: 'a@mine.com', bid: MY_BIZ }).firestore();

  // Re-addressing to another user (even alongside a legal field) must fail.
  await assertFails(updateDoc(doc(alice, 'notifications', 'notifSelf'), { userId: 'vstaff' }));
  await assertFails(updateDoc(doc(alice, 'notifications', 'notifSelf'), { userId: 'vstaff', isRead: true }));
  // Rewriting content/link after the fact must fail — only read-state may change.
  await assertFails(updateDoc(doc(alice, 'notifications', 'notifSelf'), { actionUrl: 'https://evil.example' }));
  await assertFails(updateDoc(doc(alice, 'notifications', 'notifSelf'), { title: 'Klikoni këtu' }));
  // The legitimate mark-as-read shapes keep working.
  await assertSucceeds(updateDoc(doc(alice, 'notifications', 'notifSelf'), { isRead: true }));
  await assertSucceeds(updateDoc(doc(alice, 'notifications', 'notifSelf'), { isRead: false, readAt: new Date() }));
});

test('36c. notification preferences are private to their owner', async () => {
  const alice = testEnv.authenticatedContext('alice', { email: 'a@mine.com', bid: MY_BIZ }).firestore();
  const mallory = testEnv.authenticatedContext('mallory', { email: 'm@victim.com', bid: VICTIM_BIZ }).firestore();
  await assertSucceeds(setDoc(doc(alice, 'userPreferences', 'alice'), {
    dndEnabled: true, dndStart: '22:00', dndEnd: '08:00', dndTimeZone: 'Europe/Tirane',
  }));
  await assertFails(getDoc(doc(mallory, 'userPreferences', 'alice')));
  await assertFails(setDoc(doc(mallory, 'userPreferences', 'alice'), { emailEnabled: false }));
});

test('37. dailyReportMisses is readable inside the tenant and writable by nobody', async () => {
  // The absence record behind the mandatory daily report. It is written only by the
  // daily-report-check cron (Admin SDK, which bypasses rules). If a client could
  // write here, the person who skipped the report could erase the evidence — and the
  // escalation to their manager would never fire.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'dailyReportMisses', `${MY_BIZ}_2026-08-11`), {
      businessId: MY_BIZ, date: '2026-08-11', missingUserIds: ['alice'], expectedCount: 3, submittedCount: 2,
    });
  });
  const alice = testEnv.authenticatedContext('alice', { email: 'a@mine.com', bid: MY_BIZ }).firestore();
  const mallory = testEnv.authenticatedContext('mallory', { email: 'm@victim.com', bid: VICTIM_BIZ }).firestore();

  await assertSucceeds(getDoc(doc(alice, 'dailyReportMisses', `${MY_BIZ}_2026-08-11`)));
  // Cross-tenant read is denied.
  await assertFails(getDoc(doc(mallory, 'dailyReportMisses', `${MY_BIZ}_2026-08-11`)));
  // Nobody writes — not even a member of the tenant it belongs to.
  await assertFails(updateDoc(doc(alice, 'dailyReportMisses', `${MY_BIZ}_2026-08-11`), { missingUserIds: [] }));
  await assertFails(deleteDoc(doc(alice, 'dailyReportMisses', `${MY_BIZ}_2026-08-11`)));
  await assertFails(setDoc(doc(mallory, 'dailyReportMisses', `${VICTIM_BIZ}_2026-08-11`), {
    businessId: VICTIM_BIZ, date: '2026-08-11', missingUserIds: [],
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// Google Reviews module (gmbAccounts / gmbReviews / gmbPosts)
// Invariant 5 of TENANT_ISOLATION_ENTERPRISE.md: a new collection ships with a
// negative cross-tenant test.
// ══════════════════════════════════════════════════════════════════════════════

test('38a. gmbAccounts (refresh tokens) is unreadable and unwritable — even by its own tenant', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'gmbAccounts', `${MY_BIZ}_gmb_loc1`), {
      businessId: MY_BIZ, teamId: MY_TEAM, name: 'Biznesi Im',
      accountName: 'accounts/1', locationName: 'locations/1', refreshToken: 'g-refresh-secret', connected: true,
    });
  });
  const alice = testEnv.authenticatedContext('alice', { email: 'a@mine.com', bid: MY_BIZ }).firestore();
  await assertFails(getDoc(doc(alice, 'gmbAccounts', `${MY_BIZ}_gmb_loc1`)));
  await assertFails(setDoc(doc(alice, 'gmbAccounts', `${MY_BIZ}_gmb_loc1`), { connected: false }, { merge: true }));
});

test('38b. gmbReviews: own tenant reads, cross-tenant cannot, nobody writes', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'gmbReviews', 'revMine'), {
      businessId: MY_BIZ, teamId: MY_TEAM, accountId: `${MY_BIZ}_gmb_loc1`,
      reviewId: 'r1', author: 'Klient', starRating: 2, comment: 'Shërbim i ngadaltë',
    });
    await setDoc(doc(ctx.firestore(), 'gmbReviews', 'revVictim'), {
      businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, accountId: `${VICTIM_BIZ}_gmb_locV`,
      reviewId: 'rV', author: 'Klient V', starRating: 1, comment: 'Victim review',
    });
  });
  const alice = testEnv.authenticatedContext('alice', { email: 'a@mine.com', bid: MY_BIZ }).firestore();
  await assertSucceeds(getDoc(doc(alice, 'gmbReviews', 'revMine')));
  await assertFails(getDoc(doc(alice, 'gmbReviews', 'revVictim')));
  // Replies/report marks go ONLY through /api/gmb (Admin SDK) — a client edit could
  // make the mirror claim a reply Google doesn't have.
  await assertFails(updateDoc(doc(alice, 'gmbReviews', 'revMine'), { replyComment: 'forged' }));
  await assertFails(deleteDoc(doc(alice, 'gmbReviews', 'revMine')));
});

test('38c. gmbPosts follow the same boundary', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'gmbPosts', 'postVictim'), {
      businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, accountId: `${VICTIM_BIZ}_gmb_locV`, summary: 'Oferta',
    });
  });
  const alice = testEnv.authenticatedContext('alice', { email: 'a@mine.com', bid: MY_BIZ }).firestore();
  await assertFails(getDoc(doc(alice, 'gmbPosts', 'postVictim')));
  await assertFails(setDoc(doc(alice, 'gmbPosts', 'postInjected'), {
    businessId: MY_BIZ, teamId: MY_TEAM, accountId: 'x', summary: 'injected',
  }));
});

// 37. Invoices are STAFF-ONLY writes. The portal client may read their own invoice
// but must never update it (self-marking Paid without paying) or delete it (an
// accounting record). Payment goes Stripe -> webhook (Admin SDK), never the client.
test('37. portal client cannot mark own invoice Paid or delete it', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'invoices', 'invCarol'), {
      businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1',
      invoiceNumber: 'INV-2026-0100', total: 1000, currency: 'EUR', status: 'Pending',
    });
  });
  const carol = portalOf('carol', 'cust1', 'carol@client.com');

  // Own invoice stays readable in the portal.
  await assertSucceeds(getDoc(doc(carol, 'invoices', 'invCarol')));
  // ...but is never client-writable: no self-paying, no partial edits, no delete.
  await assertFails(updateDoc(doc(carol, 'invoices', 'invCarol'), { status: 'Paid' }));
  await assertFails(updateDoc(doc(carol, 'invoices', 'invCarol'), { total: 1 }));
  await assertFails(deleteDoc(doc(carol, 'invoices', 'invCarol')));

  // Staff of the tenant still manage it normally.
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(updateDoc(doc(alice, 'invoices', 'invCarol'), { status: 'Paid' }));
});

// 37b. The SAME rule for the invoice's line items. `/invoiceItems` kept an
// `isPortalClientFor(customerId)` clause on update/delete long after it was removed
// from `/invoices`, so a client could rewrite or delete the itemisation of their own
// invoice from the browser console. The itemisation is part of the accounting record.
test('37b. portal client reads own invoice items but cannot rewrite or delete them', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'invoiceItems', 'itemCarol'), {
      businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1',
      invoiceId: 'invCarol', description: 'SEO retainer', quantity: 1,
      unitPrice: 1000, totalPrice: 1000,
    });
  });
  const carol = portalOf('carol', 'cust1', 'carol@client.com');

  // Readable — the client must be able to see what they are being billed for.
  await assertSucceeds(getDoc(doc(carol, 'invoiceItems', 'itemCarol')));
  // Never writable.
  await assertFails(updateDoc(doc(carol, 'invoiceItems', 'itemCarol'), { totalPrice: 1 }));
  await assertFails(updateDoc(doc(carol, 'invoiceItems', 'itemCarol'), { description: 'free' }));
  await assertFails(deleteDoc(doc(carol, 'invoiceItems', 'itemCarol')));

  // Staff of the tenant still manage it normally.
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(updateDoc(doc(alice, 'invoiceItems', 'itemCarol'), { quantity: 2 }));
});

// 37c. A line item written WITHOUT businessId/customerId is readable by nobody.
// This is why the recurring-invoice cron must stamp both: it used to copy only
// `teamId`, so every auto-generated invoice showed an empty items table to staff
// and to the client while its total was correct.
test('37c. line item with no tenant key is unreadable by staff and client alike', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'invoiceItems', 'itemOrphan'), {
      teamId: MY_TEAM, invoiceId: 'invCarol', description: 'orphaned copy',
      quantity: 1, unitPrice: 500, totalPrice: 500,
    });
  });
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  const carol = portalOf('carol', 'cust1', 'carol@client.com');

  await assertFails(getDoc(doc(alice, 'invoiceItems', 'itemOrphan')));
  await assertFails(getDoc(doc(carol, 'invoiceItems', 'itemOrphan')));
});

// 39. Tasks are STAFF-ONLY writes. The portal client may read their own project's
// tasks (customerId derived from the parent project) but must never complete,
// edit or delete internal work items; and no signed-in user may create a task
// stamped into a foreign tenant (the old isSelfCreate clause allowed exactly that).
test('39a. portal client reads own task but cannot write or delete it', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'tasks', 'taskCarol'), {
      businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1',
      title: 'Internal work item', status: 'Todo', assignedToUserId: 'alice',
    });
  });
  const carol = portalOf('carol', 'cust1', 'carol@client.com');

  await assertSucceeds(getDoc(doc(carol, 'tasks', 'taskCarol')));
  await assertFails(updateDoc(doc(carol, 'tasks', 'taskCarol'), { status: 'Done' }));
  await assertFails(deleteDoc(doc(carol, 'tasks', 'taskCarol')));
  await assertFails(setDoc(doc(carol, 'tasks', 'taskInjected'), {
    businessId: MY_BIZ, customerId: 'cust1', title: 'injected', createdByUserId: 'carol',
  }));

  // Staff of the tenant still manage it normally.
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(updateDoc(doc(alice, 'tasks', 'taskCarol'), { status: 'Done' }));
});

test('39b. cross-tenant task create/read/write are denied', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'tasks', 'taskVictim'), {
      businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, title: 'Victim task', status: 'Todo',
    });
  });
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(getDoc(doc(alice, 'tasks', 'taskVictim')));
  await assertFails(updateDoc(doc(alice, 'tasks', 'taskVictim'), { status: 'Done' }));
  // Forging a task INTO the victim tenant (isSelfCreate used to allow this).
  await assertFails(setDoc(doc(alice, 'tasks', 'taskForged'), {
    businessId: VICTIM_BIZ, title: 'forged', createdByUserId: 'alice',
  }));
});

test('39c. task update may never move the task to another business', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'tasks', 'taskHop'), {
      businessId: MY_BIZ, teamId: MY_TEAM, title: 'Hop attempt', status: 'Todo',
    });
  });
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(updateDoc(doc(alice, 'tasks', 'taskHop'), { businessId: VICTIM_BIZ }));
  await assertSucceeds(updateDoc(doc(alice, 'tasks', 'taskHop'), { status: 'InProgress', businessId: MY_BIZ }));
});

// 40. Deals & leadActivities — these two collections had NO rule at all
// (default-deny killed the pipeline module for every non-super-admin), so the
// new blocks must both work for tenant staff and hold the tenant boundary.
test('40a. staff manage own-tenant deals; cross-tenant denied', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'deals', 'dealMine'), {
      businessId: MY_BIZ, teamId: MY_TEAM, title: 'Upsell', stage: 'Qualified', leadId: 'leadX',
    });
    await setDoc(doc(ctx.firestore(), 'deals', 'dealVictim'), {
      businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, title: 'Victim deal', stage: 'Qualified',
    });
  });
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member']);
  await assertSucceeds(getDoc(doc(alice, 'deals', 'dealMine')));
  await assertSucceeds(updateDoc(doc(alice, 'deals', 'dealMine'), { stage: 'Won', businessId: MY_BIZ }));
  await assertFails(getDoc(doc(alice, 'deals', 'dealVictim')));
  await assertFails(updateDoc(doc(alice, 'deals', 'dealMine'), { businessId: VICTIM_BIZ }));
  await assertFails(setDoc(doc(alice, 'deals', 'dealForged'), { businessId: VICTIM_BIZ, title: 'forged' }));
});

test('40b. leadActivities are readable/creatable in-tenant, append-only', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'leadActivities', 'actMine'), {
      businessId: MY_BIZ, leadId: 'leadX', type: 'note', note: 'called them',
    });
    await setDoc(doc(ctx.firestore(), 'leadActivities', 'actVictim'), {
      businessId: VICTIM_BIZ, leadId: 'leadV', type: 'note', note: 'secret',
    });
  });
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member']);
  await assertSucceeds(getDoc(doc(alice, 'leadActivities', 'actMine')));
  await assertSucceeds(setDoc(doc(alice, 'leadActivities', 'actNew'), {
    businessId: MY_BIZ, leadId: 'leadX', type: 'note', note: 'follow-up',
  }));
  await assertFails(getDoc(doc(alice, 'leadActivities', 'actVictim')));
  // Append-only: history can't be rewritten or erased from the client.
  await assertFails(updateDoc(doc(alice, 'leadActivities', 'actMine'), { note: 'rewritten' }));
  await assertFails(deleteDoc(doc(alice, 'leadActivities', 'actMine')));
});

// 41. teamMembers identity self-heal: a LEGACY row keyed by the signer's email
// may re-point userId to their own uid (and nothing else) — the old self-branch
// required userId == uid, false for exactly the rows needing repair.
test('41. email-keyed member row can self-heal to own uid, nothing more', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teamMembers', `${MY_TEAM}_dora@mine.com`), {
      userId: 'dora@mine.com', email: 'dora@mine.com',
      teamId: MY_TEAM, businessId: MY_BIZ, role: 'Member', status: 'Active',
    });
  });
  const dora = testEnv.authenticatedContext('doraUid', { email: 'dora@mine.com' }).firestore();
  // The legitimate repair: userId → own uid.
  await assertSucceeds(updateDoc(doc(dora, 'teamMembers', `${MY_TEAM}_dora@mine.com`), {
    userId: 'doraUid',
  }));
  // A different email cannot hijack the row.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teamMembers', `${MY_TEAM}_eda@mine.com`), {
      userId: 'eda@mine.com', email: 'eda@mine.com',
      teamId: MY_TEAM, businessId: MY_BIZ, role: 'Member', status: 'Active',
    });
  });
  await assertFails(updateDoc(doc(dora, 'teamMembers', `${MY_TEAM}_eda@mine.com`), {
    userId: 'doraUid',
  }));
  // The self-heal cannot smuggle a role change alongside.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teamMembers', `${MY_TEAM}_fisnik@mine.com`), {
      userId: 'fisnik@mine.com', email: 'fisnik@mine.com',
      teamId: MY_TEAM, businessId: MY_BIZ, role: 'Member', status: 'Active',
    });
  });
  const fisnik = testEnv.authenticatedContext('fisnikUid', { email: 'fisnik@mine.com' }).firestore();
  await assertFails(updateDoc(doc(fisnik, 'teamMembers', `${MY_TEAM}_fisnik@mine.com`), {
    userId: 'fisnikUid', role: 'Admin',
  }));
});

// 42. Reports portal visibility keys on the denormalized portalVisible flag.
test('42. portal client reads only portalVisible reports of their own customer', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'reports', 'repVisible'), {
      businessId: MY_BIZ, customerId: 'cust1', kind: 'client-monthly',
      status: 'published', portalVisible: true, title: 'Raporti mujor',
    });
    await setDoc(doc(ctx.firestore(), 'reports', 'repDraft'), {
      businessId: MY_BIZ, customerId: 'cust1', kind: 'client-monthly',
      status: 'draft', portalVisible: false, title: 'Draft i brendshëm',
    });
    await setDoc(doc(ctx.firestore(), 'reports', 'repLegacy'), {
      businessId: MY_BIZ, customerId: 'cust1', kind: 'client-monthly',
      status: 'published', title: 'Pa flamur (para backfill-it)',
    });
  });
  const carol = portalOf('carol', 'cust1', 'carol@client.com');
  await assertSucceeds(getDoc(doc(carol, 'reports', 'repVisible')));
  await assertFails(getDoc(doc(carol, 'reports', 'repDraft')));
  // Missing flag = not visible (fail-closed until the backfill stamps it).
  await assertFails(getDoc(doc(carol, 'reports', 'repLegacy')));
  // Staff of the tenant still read everything.
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member']);
  await assertSucceeds(getDoc(doc(alice, 'reports', 'repDraft')));
});

// ── Expenses: the approval workflow is a RULE, not just hidden buttons ──────
// Before this, `allow update, delete: if canManageBusinessDoc()` meant any member
// of the business (a Viewer included) could self-approve, silently raise an
// approved amount, delete a colleague's booked cost, or move the row into
// another tenant — the entire workflow lived in the UI.
test('43. a Member cannot self-approve an expense (create or update)', async () => {
  const bob = staffOf('bobM', MY_BIZ, MY_TEAM, ['member']);
  // Creating one already approved is refused …
  await assertFails(setDoc(doc(bob, 'expenses', 'expSelfApproveNew'), {
    businessId: MY_BIZ, teamId: MY_TEAM, title: 'Laptop', amount: 1200, currency: 'EUR',
    category: 'Office', approvalStatus: 'Approved', createdByUserId: 'bobM',
  }));
  // … submitting one is fine.
  await assertSucceeds(setDoc(doc(bob, 'expenses', 'expBobSubmitted'), {
    businessId: MY_BIZ, teamId: MY_TEAM, title: 'Laptop', amount: 1200, currency: 'EUR',
    category: 'Office', approvalStatus: 'Submitted', createdByUserId: 'bobM',
  }));
  // Flipping the verdict afterwards is not.
  await assertFails(updateDoc(doc(bob, 'expenses', 'expBobSubmitted'), { approvalStatus: 'Approved' }));

  // An Admin of the same tenant may do both.
  const admin = staffOf('adminA', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(updateDoc(doc(admin, 'expenses', 'expBobSubmitted'), { approvalStatus: 'Approved' }));
});

test('44. raising an APPROVED amount requires sending it back for approval', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'expenses', 'expApproved'), {
      businessId: MY_BIZ, teamId: MY_TEAM, title: 'Qira', amount: 1000, currency: 'ALL',
      category: 'Rent', approvalStatus: 'Approved', createdByUserId: 'bobM',
    });
  });
  const bob = staffOf('bobM', MY_BIZ, MY_TEAM, ['member']);
  // 1 000 → 100 000 while still reading "Aprovuar": denied.
  await assertFails(updateDoc(doc(bob, 'expenses', 'expApproved'), { amount: 100000 }));
  // Editing something the approval was not granted for is fine.
  await assertSucceeds(updateDoc(doc(bob, 'expenses', 'expApproved'), { description: 'qira e zyrës' }));
  // Changing the amount AND re-opening the approval is the supported path.
  await assertSucceeds(updateDoc(doc(bob, 'expenses', 'expApproved'), {
    amount: 100000, approvalStatus: 'Submitted',
  }));
});

test('45. an expense can never be moved to another tenant, nor deleted once approved', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'expenses', 'expLocked'), {
      businessId: MY_BIZ, teamId: MY_TEAM, title: 'Hosting', amount: 50, currency: 'EUR',
      category: 'Hosting', approvalStatus: 'Approved', createdByUserId: 'bobM',
    });
    await setDoc(doc(ctx.firestore(), 'expenses', 'expOthersDraft'), {
      businessId: MY_BIZ, teamId: MY_TEAM, title: 'Taksi', amount: 20, currency: 'EUR',
      category: 'Travel', approvalStatus: 'Submitted', createdByUserId: 'someoneElse',
    });
    await setDoc(doc(ctx.firestore(), 'expenses', 'expBobOwnDraft'), {
      businessId: MY_BIZ, teamId: MY_TEAM, title: 'Bileta', amount: 15, currency: 'EUR',
      category: 'Travel', approvalStatus: 'Submitted', createdByUserId: 'bobM',
    });
    await setDoc(doc(ctx.firestore(), 'expenses', 'expVictim'), {
      businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, title: 'Victim rent', amount: 9999,
      currency: 'EUR', category: 'Rent', approvalStatus: 'Approved', createdByUserId: 'vstaff',
    });
  });
  const bob = staffOf('bobM', MY_BIZ, MY_TEAM, ['member']);
  // keepsBusinessId(): no tenant-hopping via update.
  await assertFails(updateDoc(doc(bob, 'expenses', 'expLocked'), { businessId: VICTIM_BIZ }));
  // An approved, booked cost is not a Member's to delete …
  await assertFails(deleteDoc(doc(bob, 'expenses', 'expLocked')));
  // … nor is someone else's row, even unapproved.
  await assertFails(deleteDoc(doc(bob, 'expenses', 'expOthersDraft')));
  // Their own unapproved row is. (NOT expBobSubmitted — test 43 leaves that one
  // Approved, which is exactly the case that must be refused.)
  await assertSucceeds(deleteDoc(doc(bob, 'expenses', 'expBobOwnDraft')));
  // Cross-tenant reads/writes stay closed.
  await assertFails(getDoc(doc(bob, 'expenses', 'expVictim')));
  await assertFails(updateDoc(doc(bob, 'expenses', 'expVictim'), { amount: 1 }));
  // An Admin may delete an approved row of their own tenant.
  const admin = staffOf('adminA', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(deleteDoc(doc(admin, 'expenses', 'expLocked')));
});

test('46. a Member may still edit a LEGACY approved expense that has no date field', async () => {
  // Regression guard for the interaction between the new booking date and the
  // new rule: stamping `date` on a legacy row flips null -> timestamp, which
  // expenseValueUnchanged() reads as "what was approved changed". The client
  // therefore leaves a missing `date` missing unless the user really moved it.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'expenses', 'expLegacyNoDate'), {
      businessId: MY_BIZ, teamId: MY_TEAM, title: 'Qira e vjetër', amount: 500,
      currency: 'ALL', category: 'Rent', approvalStatus: 'Approved', createdByUserId: 'bobM',
      // deliberately NO `date` — the state every row was in before the fix
    });
  });
  const bob = staffOf('bobM', MY_BIZ, MY_TEAM, ['member']);
  // Editing a non-material field must still work.
  await assertSucceeds(updateDoc(doc(bob, 'expenses', 'expLegacyNoDate'), { description: 'sqarim' }));
  // Re-booking it into another month without re-approval must not.
  await assertFails(updateDoc(doc(bob, 'expenses', 'expLegacyNoDate'), { date: new Date(2020, 0, 1) }));
  // With re-approval it is allowed.
  await assertSucceeds(updateDoc(doc(bob, 'expenses', 'expLegacyNoDate'), {
    date: new Date(2020, 0, 1), approvalStatus: 'Submitted',
  }));
});

test('47. a colleague may react to a comment but not rewrite it', async () => {
  // Reactions on task/project comments were denied for everyone but the author
  // (`allow update: createdByUserId == uid`), so the emoji picker silently did
  // nothing on anyone else's comment. The fix is a reactions-only diff branch.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'taskComments', 'tcMine'), {
      businessId: MY_BIZ, teamId: MY_TEAM, taskId: 'task1',
      content: 'Kjo detyrë është gati', createdByUserId: 'zoe',
    });
    await setDoc(doc(db, 'taskComments', 'tcClientVisible'), {
      businessId: MY_BIZ, teamId: MY_TEAM, taskId: 'task1', customerId: 'cust1',
      content: 'Faleminderit', createdByUserId: 'zoe',
    });
    await setDoc(doc(db, 'taskComments', 'tcVictim'), {
      businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, taskId: 'taskV',
      content: 'Victim comment', createdByUserId: 'vstaff',
    });
    await setDoc(doc(db, 'projectComments', 'pcMine'), {
      businessId: MY_BIZ, teamId: MY_TEAM, projectId: 'proj1',
      content: 'Nisim javën tjetër', createdByUserId: 'zoe',
    });
  });
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member']);
  // The write the UI actually sends: the reaction map + useMutation's updatedAt.
  await assertSucceeds(updateDoc(doc(alice, 'taskComments', 'tcMine'), {
    reactions: { '👍': ['alice'] }, updatedAt: new Date(),
  }));
  await assertSucceeds(updateDoc(doc(alice, 'projectComments', 'pcMine'), {
    reactions: { '🔥': ['alice'] }, updatedAt: new Date(),
  }));
  // Un-reacting (the map goes empty) must work too.
  await assertSucceeds(updateDoc(doc(alice, 'taskComments', 'tcMine'), {
    reactions: {}, updatedAt: new Date(),
  }));
  // Editing stays author-only — a reaction must not become a licence to rewrite.
  await assertFails(updateDoc(doc(alice, 'taskComments', 'tcMine'), {
    reactions: { '👍': ['alice'] }, content: 'kjo nuk është ajo që shkrova', updatedAt: new Date(),
  }));
  // Nor to move the comment into another tenant.
  await assertFails(updateDoc(doc(alice, 'taskComments', 'tcMine'), {
    reactions: { '👍': ['alice'] }, businessId: VICTIM_BIZ,
  }));
  // Cross-tenant: reacting by doc id stays closed.
  await assertFails(updateDoc(doc(alice, 'taskComments', 'tcVictim'), {
    reactions: { '👍': ['alice'] }, updatedAt: new Date(),
  }));
  // A portal client may react on a comment shared with them, and only on that one.
  const carol = portalOf('carol', 'cust1', 'carol@client.com');
  await assertSucceeds(updateDoc(doc(carol, 'taskComments', 'tcClientVisible'), {
    reactions: { '❤️': ['carol'] }, updatedAt: new Date(),
  }));
  await assertFails(updateDoc(doc(carol, 'taskComments', 'tcMine'), {
    reactions: { '❤️': ['carol'] }, updatedAt: new Date(),
  }));
});

// ── CRM automation rules: authored by the tenant's elevated roles, fired only by the cron ──
test('48a. only a tenant admin/manager authors an automation rule, and only inside their own tenant', async () => {
  const ruleBody = {
    businessId: MY_BIZ, teamId: MY_TEAM, name: 'Lead i ri → cakto', entity: 'lead', status: 'paused',
    trigger: { kind: 'lead_created' }, conditions: [], actions: [{ type: 'assign', mode: 'round_robin' }],
    enrollExisting: false, createdByUserId: 'alice',
  };
  const admin = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(setDoc(doc(admin, 'crmAutomationRules', 'ruleMine'), ruleBody));
  const manager = staffOf('mia', MY_BIZ, MY_TEAM, ['manager']);
  await assertSucceeds(setDoc(doc(manager, 'crmAutomationRules', 'ruleMine2'), { ...ruleBody, createdByUserId: 'mia' }));
  // A plain member reads the rules but cannot author or arm one.
  const member = staffOf('bob', MY_BIZ, MY_TEAM, ['member']);
  await assertSucceeds(getDoc(doc(member, 'crmAutomationRules', 'ruleMine')));
  await assertFails(setDoc(doc(member, 'crmAutomationRules', 'ruleBob'), { ...ruleBody, createdByUserId: 'bob' }));
  await assertFails(updateDoc(doc(member, 'crmAutomationRules', 'ruleMine'), { status: 'active' }));
  // The tenant key is immutable, and a rule can never be stamped for another tenant.
  await assertFails(updateDoc(doc(admin, 'crmAutomationRules', 'ruleMine'), { businessId: VICTIM_BIZ }));
  await assertFails(setDoc(doc(admin, 'crmAutomationRules', 'ruleForged'), { ...ruleBody, businessId: VICTIM_BIZ }));
  // Cross-tenant read stays closed.
  const mallory = outsider();
  await assertFails(getDoc(doc(mallory, 'crmAutomationRules', 'ruleMine')));
});

test('48b. the firing log is readable by the tenant and writable by nobody', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'crmAutomationRuns', 'ruleMine_lead1_created'), {
      businessId: MY_BIZ, ruleId: 'ruleMine', entity: 'lead', entityId: 'lead1', fireKey: 'created', results: [],
    });
  });
  const admin = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(getDoc(doc(admin, 'crmAutomationRuns', 'ruleMine_lead1_created')));
  // Deleting a run would re-arm the occurrence; creating one would silence it forever.
  await assertFails(deleteDoc(doc(admin, 'crmAutomationRuns', 'ruleMine_lead1_created')));
  await assertFails(setDoc(doc(admin, 'crmAutomationRuns', 'ruleMine_lead2_created'), { businessId: MY_BIZ, ruleId: 'ruleMine', entityId: 'lead2', fireKey: 'created' }));
  const sa = testEnv.authenticatedContext('root', { email: 'root@fivo.al', superAdmin: true }).firestore();
  await assertFails(setDoc(doc(sa, 'crmAutomationRuns', 'ruleMine_lead1_created'), { results: [] }, { merge: true }));
  await assertFails(getDoc(doc(outsider(), 'crmAutomationRuns', 'ruleMine_lead1_created')));
});
