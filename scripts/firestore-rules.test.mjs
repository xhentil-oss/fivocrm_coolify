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
import { doc, setDoc, getDoc } from 'firebase/firestore';

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
    await setDoc(doc(db, 'publicTenants', 'victim'), { businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, name: 'Victim' });
    await setDoc(doc(db, 'teamInvites', 'invVictim'), {
      teamId: VICTIM_TEAM, businessId: VICTIM_BIZ, email: 'someone@victim.com', role: 'Admin',
      status: 'Pending', token: 'tok-victim', invitedByUserId: 'victimOwner',
    });
    await setDoc(doc(db, 'userProfiles', 'profVictim'), { userId: 'vstaff', displayName: 'V Staff', businessId: VICTIM_BIZ });
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
