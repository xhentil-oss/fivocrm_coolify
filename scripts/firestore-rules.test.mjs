/**
 * Rules-unit tests for `firestore.rules` — the gate before every
 * `firebase deploy --only firestore:rules`. The whole file must pass (168 tests as
 * of the Sep 2026 hardening pass: 1–55 tenant isolation, modules, finance, chat,
 * hosting; 56–73 the C1–C5 / H1–H7 / M1–M8 / L findings). `storage.rules` has its
 * own suite in scripts/storage-rules.test.mjs.
 *
 * Setup (one-time):
 *   npm i -D @firebase/rules-unit-testing firebase-tools
 *
 * Run (JDK 21 for firebase-tools 14+):
 *   npm run test:rules
 *   # = firebase emulators:exec --only firestore --project fivocrm-rules-test \
 *   #     "node --test scripts/firestore-rules.test.mjs"
 *
 * Conventions: tests run in FILE ORDER and share one emulator database, so a seed
 * written by an earlier test is visible to a later one (e.g. bob is re-seeded as a
 * team Admin in 15; finn/eve/zoe are plain Members from 10f/10g). Prefer a fresh
 * uid over assuming a colleague's role. `staffOf` / `portalOf` / `outsider` mint the
 * signed claims exactly as api/_tenantClaims.ts does; `verifiedUser` /
 * `unverifiedUser` are the portal first-login shapes (no tenant claim yet).
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
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, query, where, orderBy, limit } from 'firebase/firestore';

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

    // ── seed for time entries + month close (55+) ──
    await setDoc(doc(db, 'financeMonthCloses', `${MY_BIZ}_2026-01`), {
      businessId: MY_BIZ, periodKey: '2026-01', locked: true, closedAt: new Date(), closedByUserId: 'alice',
    });
    await setDoc(doc(db, 'timeEntries', 'teJanBob'), {
      businessId: MY_BIZ, teamId: MY_TEAM, userId: 'bob', date: '2026-01-15', duration: 60, projectId: 'p1',
    });
    await setDoc(doc(db, 'timeEntries', 'teFebBob'), {
      businessId: MY_BIZ, teamId: MY_TEAM, userId: 'bob', date: '2026-02-10', duration: 60, projectId: 'p1',
    });

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

    // -- seed for the quote/preventive boundary (52+) --
    // A Sent quote the client may answer, a second one so the update test does not
    // depend on the read test's ordering, an internal DRAFT (pricing the client must
    // never see) and another tenant's quote.
    await setDoc(doc(db, 'quotes', 'quoteMineSent'), {
      businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', label: 'Paketa Pro',
      currency: 'EUR', status: 'Sent', result: { grandTotal: 1200, totalMonthly: 100 },
      createdByUserId: 'alice',
    });
    await setDoc(doc(db, 'quotes', 'quoteMineSent2'), {
      businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', label: 'Paketa Pro (2)',
      currency: 'EUR', status: 'Sent', result: { grandTotal: 1200, totalMonthly: 100 },
      createdByUserId: 'alice',
    });
    await setDoc(doc(db, 'quotes', 'quoteMineDraft'), {
      businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', label: 'Draft i brendshem',
      currency: 'EUR', status: 'Draft', result: { grandTotal: 400, totalMonthly: 30 },
      createdByUserId: 'alice',
    });
    await setDoc(doc(db, 'quotes', 'quoteVictim'), {
      businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, customerId: 'custVictim', label: 'Victim quote',
      currency: 'EUR', status: 'Sent', result: { grandTotal: 9999 }, createdByUserId: 'vstaff',
    });
    // The other half of quoteAccessibleByPortal(): a quote attached to a LEAD of
    // the client's customer, carrying no customerId of its own.
    await setDoc(doc(db, 'leads', 'leadMine'), {
      businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', name: 'Carol', status: 'Contacted',
    });
    await setDoc(doc(db, 'quotes', 'quoteMineByLead'), {
      businessId: MY_BIZ, teamId: MY_TEAM, leadId: 'leadMine', label: 'Oferta nga lead-i',
      currency: 'EUR', status: 'Sent', result: { grandTotal: 700 }, createdByUserId: 'alice',
    });

    // -- seed for the tenant scoping of payments / expenseCategories (53) --
    await setDoc(doc(db, 'payments', 'payMine'), {
      businessId: MY_BIZ, teamId: MY_TEAM, invoiceId: 'invMine', customerId: 'cust1',
      amount: 100, currency: 'ALL', method: 'Bank', source: 'manual',
    });
    await setDoc(doc(db, 'payments', 'payVictim'), {
      businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, invoiceId: 'invVictim', customerId: 'custVictim',
      amount: 999, currency: 'ALL', method: 'Stripe', source: 'stripe',
    });
    await setDoc(doc(db, 'expenseCategories', 'catMineExp'), { businessId: MY_BIZ, teamId: MY_TEAM, label: 'Marketing' });
    await setDoc(doc(db, 'expenseCategories', 'catVictimExp'), { businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, label: 'Victim cat' });

    // -- seed for the compensation vault (54): pay lives OUTSIDE teamMembers --
    await setDoc(doc(db, 'teamMemberComp', `${MY_TEAM}_bob`), {
      businessId: MY_BIZ, teamId: MY_TEAM, userId: 'bob', monthlySalary: 80000,
      salaryHistory: [{ monthlySalary: 80000, effectiveFrom: new Date('2026-01-01') }],
    });
    await setDoc(doc(db, 'teamMemberComp', `${MY_TEAM}_carol`), {
      businessId: MY_BIZ, teamId: MY_TEAM, userId: 'carol', monthlySalary: 120000,
    });
    await setDoc(doc(db, 'teamMemberComp', `${VICTIM_TEAM}_victim`), {
      businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, userId: 'victim', monthlySalary: 999999,
    });

    // ── seed for the hosting & domains module (51+) ──
    await setDoc(doc(db, 'hostingServers', 'srvMine'), { businessId: MY_BIZ, teamId: MY_TEAM, name: 'srv1', hostname: 'srv1.mine.al', username: 'root', status: 'Active' });
    await setDoc(doc(db, 'hostingServers', 'srvVictim'), { businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, name: 'v', hostname: 'srv.victim.al', username: 'root', status: 'Active' });
    await setDoc(doc(db, 'hostingServerSecrets', 'srvMine'), { apiToken: 'SECRET-TOKEN', businessId: MY_BIZ });
    await setDoc(doc(db, 'hostingProducts', 'hpMinePublic'), { businessId: MY_BIZ, teamId: MY_TEAM, name: 'Start', serverId: 'srvMine', whmPackage: 'start', status: 'Active', currency: 'EUR', pricing: { monthly: { price: 5 } }, portalVisible: true });
    await setDoc(doc(db, 'hostingProducts', 'hpMineHidden'), { businessId: MY_BIZ, teamId: MY_TEAM, name: 'Internal', serverId: 'srvMine', whmPackage: 'int', status: 'Active', currency: 'EUR', pricing: { monthly: { price: 1 } }, portalVisible: false });
    await setDoc(doc(db, 'hostingProducts', 'hpVictim'), { businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, name: 'V', serverId: 'srvVictim', whmPackage: 'v', status: 'Active', currency: 'EUR', pricing: { monthly: { price: 9 } }, portalVisible: true });
    await setDoc(doc(db, 'domainTlds', 'tldMine'), { businessId: MY_BIZ, teamId: MY_TEAM, tld: 'com', currency: 'EUR', registerPrice: 12, renewPrice: 14, costRegister: 9, status: 'Active' });
    await setDoc(doc(db, 'domainTlds', 'tldVictim'), { businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, tld: 'al', currency: 'EUR', registerPrice: 20, renewPrice: 20, costRegister: 15, status: 'Active' });
    await setDoc(doc(db, 'subscriptions', 'subMine'), { businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', source: 'fivocrm', productName: 'Start', domain: 'cust1.com', status: 'Active', recurringAmount: 5, currency: 'EUR', billingCycle: 'monthly', cpanelUsername: 'cust1' });
    await setDoc(doc(db, 'subscriptions', 'subVictim'), { businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, customerId: 'custVictim', source: 'fivocrm', productName: 'V', status: 'Active', recurringAmount: 9, currency: 'EUR', billingCycle: 'monthly' });
    await setDoc(doc(db, 'domains', 'domMine'), { businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', source: 'fivocrm', registrar: 'dynadot', domainName: 'cust1.com', status: 'Active', recurringAmount: 14, currency: 'EUR', autoRenew: true });
    await setDoc(doc(db, 'domains', 'domVictim'), { businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, customerId: 'custVictim', source: 'fivocrm', registrar: 'dynadot', domainName: 'victim.al', status: 'Active', recurringAmount: 20, currency: 'EUR' });
    await setDoc(doc(db, 'hostingOrders', 'hoMine'), { businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', orderNumber: 'HOS-2026-0001', source: 'portal', status: 'Pending', lines: [], subtotal: 5, total: 5, currency: 'EUR' });
    await setDoc(doc(db, 'hostingOrders', 'hoVictim'), { businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, customerId: 'custVictim', orderNumber: 'HOS-2026-0001', source: 'staff', status: 'Pending', lines: [], subtotal: 9, total: 9, currency: 'EUR' });
    await setDoc(doc(db, 'hostingEvents', 'hevMine'), { businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', subscriptionId: 'subMine', type: 'whm.createacct', ok: true, message: 'ok' });
    await setDoc(doc(db, 'hostingCoupons', 'cpMine'), { businessId: MY_BIZ, teamId: MY_TEAM, code: 'WELCOME10', type: 'percent', value: 10, appliesTo: 'all', status: 'Active', uses: 0 });
    await setDoc(doc(db, 'hostingCoupons', 'cpVictim'), { businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, code: 'SECRET50', type: 'percent', value: 50, appliesTo: 'all', status: 'Active', uses: 0 });
    await setDoc(doc(db, 'hostingBackups', 'bkMine'), { businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', subscriptionId: 'subMine', kind: 'scheduled', path: '/home/cpmove-cust1.tar.gz', ok: true });
    await setDoc(doc(db, 'hostingBackups', 'bkVictim'), { businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, customerId: 'custVictim', subscriptionId: 'subVictim', kind: 'scheduled', path: '/home/cpmove-v.tar.gz', ok: true });
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
test('6a. portal client claims own customer (verified e-mail only)', async () => {
  // The e-mail must be VERIFIED: a password sign-up with the client's address is not the client.
  const carolUnverified = testEnv.authenticatedContext('carol', { email: 'carol@client.com' }).firestore();
  await assertFails(setDoc(doc(carolUnverified, 'users', 'carol'), { customerId: 'cust1', businessId: MY_BIZ }));
  const carol = testEnv.authenticatedContext('carol', { email: 'carol@client.com', email_verified: true }).firestore();
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

// 10c. A DM RECIPIENT marks the message read (ChatView's markAsRead batch: `isRead` only).
// The receiver is not the sender, so this rides on the field-whitelist branch; it must
// hold with and without a businessId on the row (legacy DMs) and across businesses.
test('10c. DM recipient can mark the message read (same tenant, legacy row, cross-tenant)', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'messages', 'dm-same'), { businessId: MY_BIZ, teamId: MY_TEAM, senderId: 'zoe', receiverId: 'alice', content: 'hi', isRead: false });
    await setDoc(doc(db, 'messages', 'dm-legacy'), { senderId: 'zoe', receiverId: 'alice', content: 'old', isRead: false });
    await setDoc(doc(db, 'messages', 'dm-cross'), { businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, senderId: 'vstaff', receiverId: 'alice', content: 'x', isRead: false });
  });
  const alice = testEnv.authenticatedContext('alice', { email: 'alice@mine.com' }).firestore();
  await assertSucceeds(updateDoc(doc(alice, 'messages', 'dm-same'), { isRead: true }));
  await assertSucceeds(updateDoc(doc(alice, 'messages', 'dm-legacy'), { isRead: true }));
  await assertSucceeds(updateDoc(doc(alice, 'messages', 'dm-cross'), { isRead: true }));
  // Someone who is neither party nor a tenant member cannot.
  const mallory = testEnv.authenticatedContext('mallory', { email: 'm@evil.com' }).firestore();
  await assertFails(updateDoc(doc(mallory, 'messages', 'dm-same'), { isRead: true }));
});

// 10d. LIST queries ChatView actually issues on `messages` (rules are not filters: an
// unprovable list is denied outright and the group renders empty).
test('10d. group channel message list: unscoped by channelId (ChatView today) vs businessId-scoped', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'channels', 'grp1'), { businessId: MY_BIZ, teamId: MY_TEAM, isGroup: true, members: ['alice', 'zoe'], name: 'G' });
    await setDoc(doc(db, 'messages', 'gm1'), { businessId: MY_BIZ, teamId: MY_TEAM, channelId: 'grp1', senderId: 'zoe', content: 'g', isRead: false, createdAt: new Date() });
  });
  const alice = testEnv.authenticatedContext('alice', { email: 'alice@mine.com' }).firestore();
  const unscoped = query(collection(alice, 'messages'), where('channelId', '==', 'grp1'), orderBy('createdAt', 'desc'), limit(50));
  const scoped = query(collection(alice, 'messages'), where('businessId', '==', MY_BIZ), where('channelId', '==', 'grp1'), orderBy('createdAt', 'desc'), limit(50));
  // The channelId-only list is what ChatView issues; it is provable through group
  // membership (isGroupChannelMember) — it used to be denied for every non-super-admin.
  await assertSucceeds(getDocs(unscoped));
  await assertSucceeds(getDocs(scoped));
  // A business member who is NOT in the group cannot list it by channelId alone …
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teamMembers', `${MY_TEAM}_bob`), { userId: 'bob', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Member', status: 'Active' });
    await setDoc(doc(ctx.firestore(), 'users', 'bob'), { teamId: MY_TEAM, businessId: MY_BIZ });
  });
  const bob = testEnv.authenticatedContext('bob', { email: 'bob@mine.com' }).firestore();
  await assertFails(getDocs(query(collection(bob, 'messages'), where('channelId', '==', 'grp1'), orderBy('createdAt', 'desc'), limit(50))));
  // … and an outsider cannot even with the tenant predicate.
  const mallory = testEnv.authenticatedContext('mallory', { email: 'm@evil.com' }).firestore();
  await assertFails(getDocs(query(collection(mallory, 'messages'), where('businessId', '==', MY_BIZ), where('channelId', '==', 'grp1'))));
  await assertFails(getDocs(query(collection(mallory, 'messages'), where('channelId', '==', 'grp1'))));
});

test('10e. typing indicators list by channel (ChatView today) vs businessId-scoped', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'typingIndicators', 'ti1'), { businessId: MY_BIZ, teamId: MY_TEAM, channelId: 'grp1', userId: 'zoe', timestamp: new Date() });
  });
  const alice = testEnv.authenticatedContext('alice', { email: 'alice@mine.com' }).firestore();
  // ChatView now reads typing indicators businessId-scoped (teamScopedWhere); the old
  // channelId-only shape is unprovable and stays denied.
  await assertFails(getDocs(query(collection(alice, 'typingIndicators'), where('channelId', '==', 'grp1'))));
  await assertSucceeds(getDocs(query(collection(alice, 'typingIndicators'), where('businessId', '==', MY_BIZ), where('channelId', '==', 'grp1'))));
  // Deterministic-id write path: setDoc(merge) creates, refreshes, and deletes by id.
  const myDoc = doc(alice, 'typingIndicators', 'grp1__alice');
  await assertSucceeds(setDoc(myDoc, { userId: 'alice', channelId: 'grp1', timestamp: new Date(), businessId: MY_BIZ, teamId: MY_TEAM }, { merge: true }));
  await assertSucceeds(setDoc(myDoc, { userId: 'alice', channelId: 'grp1', timestamp: new Date(), businessId: MY_BIZ, teamId: MY_TEAM }, { merge: true }));
  await assertSucceeds(deleteDoc(myDoc));
});

// 10f. Group management is rules-enforced: admins edit, members may only leave or
// write the last-message denormalisation, a non-member business colleague nothing.
test('10f. group channels: admin edits, member leaves / denormalises, outsider-member cannot manage', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'channels', 'grp2'), { businessId: MY_BIZ, teamId: MY_TEAM, isGroup: true, name: 'G2', members: ['alice', 'zoe', 'bob'], admins: ['zoe'], createdByUserId: 'zoe' });
    await setDoc(doc(db, 'teamMembers', `${MY_TEAM}_eve`), { userId: 'eve', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Member', status: 'Active' });
    await setDoc(doc(db, 'users', 'eve'), { teamId: MY_TEAM, businessId: MY_BIZ });
    await setDoc(doc(db, 'teamMembers', `${MY_TEAM}_zoe`), { userId: 'zoe', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Member', status: 'Active' });
    await setDoc(doc(db, 'users', 'zoe'), { teamId: MY_TEAM, businessId: MY_BIZ });
  });
  const alice = testEnv.authenticatedContext('alice', { email: 'alice@mine.com' }).firestore();
  const zoe = testEnv.authenticatedContext('zoe', { email: 'zoe@mine.com' }).firestore();
  const eve = testEnv.authenticatedContext('eve', { email: 'eve@mine.com' }).firestore();
  // member (not admin): may denormalise the last message, may leave, may NOT rename / add self as admin / add members
  await assertSucceeds(updateDoc(doc(alice, 'channels', 'grp2'), { lastMessageAt: new Date(), lastMessagePreview: 'hi', lastMessageSenderId: 'alice' }));
  await assertFails(updateDoc(doc(alice, 'channels', 'grp2'), { name: 'Mine now' }));
  await assertFails(updateDoc(doc(alice, 'channels', 'grp2'), { admins: ['zoe', 'alice'] }));
  await assertFails(updateDoc(doc(alice, 'channels', 'grp2'), { members: ['alice', 'zoe', 'bob', 'eve'] }));
  await assertFails(deleteDoc(doc(alice, 'channels', 'grp2')));
  // a business colleague who is NOT a member cannot join or touch it
  await assertFails(updateDoc(doc(eve, 'channels', 'grp2'), { members: ['alice', 'zoe', 'bob', 'eve'] }));
  await assertFails(updateDoc(doc(eve, 'channels', 'grp2'), { lastMessageAt: new Date() }));
  // admin: full control
  await assertSucceeds(updateDoc(doc(zoe, 'channels', 'grp2'), { name: 'Renamed', members: ['alice', 'zoe', 'bob', 'eve'] }));
  // member leaves (removes ONLY themselves)
  await assertSucceeds(updateDoc(doc(alice, 'channels', 'grp2'), { members: ['zoe', 'bob', 'eve'], admins: ['zoe'] }));
  // group creation must include the creator as member + admin
  await assertFails(setDoc(doc(alice, 'channels', 'grp-bad'), { businessId: MY_BIZ, teamId: MY_TEAM, isGroup: true, name: 'x', members: ['zoe'], admins: ['zoe'], createdByUserId: 'alice' }));
  await assertSucceeds(setDoc(doc(alice, 'channels', 'grp-ok'), { businessId: MY_BIZ, teamId: MY_TEAM, isGroup: true, name: 'x', members: ['alice', 'zoe'], admins: ['alice'], createdByUserId: 'alice' }));
  await assertSucceeds(deleteDoc(doc(alice, 'channels', 'grp-ok')));
});

// 10g. Posting into a group requires membership; legacy channels and client threads unchanged.
test('10g. only group members may post into a group channel', async () => {
  // finn is a business colleague who is NOT in grp2 (eve was added by the admin in 10f).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teamMembers', `${MY_TEAM}_finn`), { userId: 'finn', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Member', status: 'Active' });
    await setDoc(doc(ctx.firestore(), 'users', 'finn'), { teamId: MY_TEAM, businessId: MY_BIZ });
  });
  const finn = testEnv.authenticatedContext('finn', { email: 'finn@mine.com' }).firestore();
  const eve = testEnv.authenticatedContext('eve', { email: 'eve@mine.com' }).firestore();
  const zoe = testEnv.authenticatedContext('zoe', { email: 'zoe@mine.com' }).firestore();
  await assertFails(setDoc(doc(finn, 'messages', 'gm-finn'), { businessId: MY_BIZ, teamId: MY_TEAM, channelId: 'grp2', senderId: 'finn', content: 'sneak', isRead: false, createdAt: new Date() }));
  await assertSucceeds(setDoc(doc(zoe, 'messages', 'gm-zoe'), { businessId: MY_BIZ, teamId: MY_TEAM, channelId: 'grp2', senderId: 'zoe', content: 'ok', isRead: false, createdAt: new Date() }));
  // a channel id with no `channels` doc (legacy fixed channel) still posts
  await assertSucceeds(setDoc(doc(eve, 'messages', 'legacy-eve'), { businessId: MY_BIZ, teamId: MY_TEAM, channelId: 'general-mine', senderId: 'eve', content: 'ok', isRead: false, createdAt: new Date() }));
});

// 10h. dmThreads: participants only.
test('10h. dmThreads readable/writable by the two participants only', async () => {
  const alice = testEnv.authenticatedContext('alice', { email: 'alice@mine.com' }).firestore();
  const mallory = testEnv.authenticatedContext('mallory', { email: 'm@evil.com' }).firestore();
  const id = 'alice__zoe';
  await assertSucceeds(setDoc(doc(alice, 'dmThreads', id), { participants: ['alice', 'zoe'], businessId: MY_BIZ, lastMessage: { content: 'hi', senderId: 'alice', createdAt: new Date() }, updatedAt: new Date() }, { merge: true }));
  await assertSucceeds(setDoc(doc(alice, 'dmThreads', id), { lastMessage: { content: 'again', senderId: 'alice', createdAt: new Date() }, updatedAt: new Date() }, { merge: true }));
  await assertFails(updateDoc(doc(alice, 'dmThreads', id), { participants: ['alice', 'mallory'] }));
  await assertFails(setDoc(doc(mallory, 'dmThreads', 'alice__mallory2'), { participants: ['alice', 'zoe'], updatedAt: new Date() }));
  await assertFails(getDoc(doc(mallory, 'dmThreads', id)));
  await assertSucceeds(getDocs(query(collection(alice, 'dmThreads'), where('participants', 'array-contains', 'alice'))));
  await assertFails(getDocs(query(collection(mallory, 'dmThreads'), where('participants', 'array-contains', 'alice'))));
  // per-thread DM list shapes ChatView issues (senderId == me / receiverId == me + peer)
  await assertSucceeds(getDocs(query(collection(alice, 'messages'), where('senderId', '==', 'alice'), where('receiverId', '==', 'zoe'), orderBy('createdAt', 'desc'), limit(300))));
  await assertSucceeds(getDocs(query(collection(alice, 'messages'), where('senderId', '==', 'zoe'), where('receiverId', '==', 'alice'), orderBy('createdAt', 'desc'), limit(300))));
  await assertFails(getDocs(query(collection(mallory, 'messages'), where('senderId', '==', 'zoe'), where('receiverId', '==', 'alice'), orderBy('createdAt', 'desc'), limit(300))));
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
  const invitee = testEnv.authenticatedContext('newguy', { email: 'someone@victim.com', email_verified: true }).firestore();
  await assertSucceeds(getDoc(doc(invitee, 'teamInvites', 'invVictim')));
});
// The LIST shapes the app actually issues: TeamsView reads a tenant's invites by
// `businessId ==` (staff), PendingInvitesBanner reads the caller's own by `email ==`
// (any signed-in person, across tenants). Both used to be denied — the former outright,
// because no clause of the rule was provable from a businessId-only query.
test('17e. staff list their own tenant invites by businessId; another tenant cannot', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member']);
  await assertSucceeds(getDocs(query(collection(alice, 'teamInvites'), where('businessId', '==', MY_BIZ))));
  await assertFails(getDocs(query(collection(alice, 'teamInvites'), where('businessId', '==', VICTIM_BIZ))));
  await assertFails(getDocs(query(collection(outsider(), 'teamInvites'), where('businessId', '==', MY_BIZ))));
});
test('17f. an invitee with no membership lists their own invites by email only', async () => {
  const invitee = testEnv.authenticatedContext('newguy', { email: 'someone@victim.com', email_verified: true }).firestore();
  await assertSucceeds(getDocs(query(collection(invitee, 'teamInvites'),
    where('email', '==', 'someone@victim.com'), where('status', '==', 'Pending'))));
  await assertFails(getDocs(query(collection(invitee, 'teamInvites'), where('email', '==', 'other@victim.com'))));
  await assertFails(getDocs(query(collection(invitee, 'teamInvites'), where('businessId', '==', VICTIM_BIZ))));
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

// 21b. Two module layers: the owner may switch their own modules off/on
// (`disabledModules`), but `lockedModules` is the platform's entitlement — an owner
// who could edit it would simply re-enable whatever the super-admin withheld.
test('21b. the owner manages disabledModules but cannot touch lockedModules; the platform can', async () => {
  const sa = testEnv.authenticatedContext('root', { email: 'root@fivo.al', superAdmin: true }).firestore();
  await assertSucceeds(setDoc(doc(sa, 'businesses', MY_BIZ), { lockedModules: ['/app/hosting'] }, { merge: true }));

  const owner = testEnv.authenticatedContext('aliceOwner', { email: 'alice@mine.com', bid: MY_BIZ, tid: MY_TEAM, roles: ['owner', 'admin'] }).firestore();
  // Their own layer: fine.
  await assertSucceeds(setDoc(doc(owner, 'businesses', MY_BIZ), { disabledModules: ['/app/products'] }, { merge: true }));
  // Lifting the lock, or widening it, in any shape: denied.
  await assertFails(setDoc(doc(owner, 'businesses', MY_BIZ), { lockedModules: [] }, { merge: true }));
  await assertFails(setDoc(doc(owner, 'businesses', MY_BIZ), { lockedModules: ['/app/hosting', '/app/products'] }, { merge: true }));
  await assertFails(updateDoc(doc(owner, 'businesses', MY_BIZ), { lockedModules: ['/app/products'], disabledModules: [] }));
  // Writing the identical value is not a change — still allowed (merge-writes from
  // the module manager may echo the field back).
  await assertSucceeds(setDoc(doc(owner, 'businesses', MY_BIZ), { lockedModules: ['/app/hosting'], disabledModules: [] }, { merge: true }));

  // Another tenant's admin: no business update at all.
  await assertFails(setDoc(doc(outsider(), 'businesses', MY_BIZ), { lockedModules: [] }, { merge: true }));
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
// 29f. A portal order carries the client's own arithmetic. Prices are re-priced
//      server-side, but the MONEY STATE is pinned by the rules: an order that
//      arrives `paymentStatus: 'Paid'` makes ShopOrdersView issue an invoice
//      already marked paid, and `stockApplied: true` makes the back office skip
//      the stock decrement -- a client-authored fact about our own books.
test('29f. portal client cannot place an order that is already paid or already stocked', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  const base = {
    businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', items: [], currency: 'ALL',
    subtotal: 0, total: 0, status: 'Pending', source: 'portal', createdByUserId: 'carol',
  };
  await assertFails(setDoc(doc(carol, 'shopOrders', 'orderPrepaid'),
    { ...base, orderNumber: 'POR-2026-0005', paymentStatus: 'Paid' }));
  await assertFails(setDoc(doc(carol, 'shopOrders', 'orderPartPaid'),
    { ...base, orderNumber: 'POR-2026-0006', paymentStatus: 'Partial' }));
  await assertFails(setDoc(doc(carol, 'shopOrders', 'orderStocked'),
    { ...base, orderNumber: 'POR-2026-0007', stockApplied: true }));
  // The legitimate shape still works, with the payment state stated explicitly.
  await assertSucceeds(setDoc(doc(carol, 'shopOrders', 'orderUnpaid'),
    { ...base, orderNumber: 'POR-2026-0008', paymentStatus: 'Unpaid', stockApplied: false }));
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

test('39d. a Viewer reads tasks but cannot create, update or delete them', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'tasks', 'taskViewed'), {
      businessId: MY_BIZ, teamId: MY_TEAM, title: 'Read only', status: 'Todo', assignedToUserId: 'alice',
    });
  });
  const vera = staffOf('vera', MY_BIZ, MY_TEAM, ['viewer']);
  await assertSucceeds(getDoc(doc(vera, 'tasks', 'taskViewed')));
  await assertFails(updateDoc(doc(vera, 'tasks', 'taskViewed'), { status: 'Done' }));
  await assertFails(updateDoc(doc(vera, 'tasks', 'taskViewed'), { title: 'renamed by a viewer' }));
  await assertFails(deleteDoc(doc(vera, 'tasks', 'taskViewed')));
  await assertFails(setDoc(doc(vera, 'tasks', 'taskByViewer'), {
    businessId: MY_BIZ, teamId: MY_TEAM, title: 'viewer create', status: 'Todo', createdByUserId: 'vera',
  }));
  // A plain member of the same business still can.
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member']);
  await assertSucceeds(updateDoc(doc(alice, 'tasks', 'taskViewed'), { status: 'In Progress' }));
});

test('39e. a portal MEMBER of a project reads its tasks (by projectId), a stranger does not', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'projects', 'projShared'), {
      businessId: MY_BIZ, teamId: MY_TEAM, name: 'Shared', status: 'Active', customerId: 'cust1',
      memberUserIds: ['dave'],
    });
    await setDoc(doc(ctx.firestore(), 'tasks', 'taskShared'), {
      businessId: MY_BIZ, teamId: MY_TEAM, projectId: 'projShared', customerId: 'cust1',
      title: 'Shared work', status: 'Todo',
    });
  });
  // dave is a portal user of ANOTHER customer, added to the project as a member.
  const dave = portalOf('dave', 'custOther', 'dave@partner.com');
  await assertSucceeds(getDoc(doc(dave, 'tasks', 'taskShared')));
  await assertSucceeds(getDocs(query(collection(dave, 'tasks'), where('projectId', '==', 'projShared'))));
  await assertSucceeds(getDocs(query(collection(dave, 'tasks'), where('projectId', 'in', ['projShared']))));
  await assertFails(updateDoc(doc(dave, 'tasks', 'taskShared'), { status: 'Done' }));
  // Not a member, not the customer → nothing.
  const erin = portalOf('erin', 'custOther', 'erin@partner.com');
  await assertFails(getDoc(doc(erin, 'tasks', 'taskShared')));
  await assertFails(getDocs(query(collection(erin, 'tasks'), where('projectId', '==', 'projShared'))));
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
  const dora = testEnv.authenticatedContext('doraUid', { email: 'dora@mine.com', email_verified: true }).firestore();
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
  const fisnik = testEnv.authenticatedContext('fisnikUid', { email: 'fisnik@mine.com', email_verified: true }).firestore();
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

// ── Inbound WhatsApp (api/_waInbound.ts): businessId is additive on whatsappMessages,
//    conversations/wa-* stay tenant-bound, and the server-only counters are deny-all ──
test('49a. whatsappMessages stamped with businessId: business member reads, other tenant is refused', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'whatsappMessages', 'waMsgMine'), {
      teamId: MY_TEAM, businessId: MY_BIZ, phone: '355691234567', direction: 'inbound',
      message: 'Përshëndetje', channel: 'baileys', status: 'received',
    });
  });
  // A member of the SAME business but a DIFFERENT department: the new businessId
  // clause is what lets them in (the team clause alone would refuse).
  const dept2 = staffOf('dina', MY_BIZ, 'teamDept2', ['member']);
  await assertSucceeds(getDoc(doc(dept2, 'whatsappMessages', 'waMsgMine')));
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member']);
  await assertSucceeds(getDoc(doc(alice, 'whatsappMessages', 'waMsgMine')));
  // Another tenant — even its admin — never reads it.
  await assertFails(getDoc(doc(outsider(), 'whatsappMessages', 'waMsgMine')));
  // A portal client of the same business is not staff.
  const carol = portalOf('carol', 'cust1', 'carol@client.com');
  await assertFails(getDoc(doc(carol, 'whatsappMessages', 'waMsgMine')));
});

test('49b. legacy whatsappMessages (teamId only) stay readable by the team member', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'whatsappMessages', 'waMsgLegacy'), {
      teamId: MY_TEAM, phone: '355691234567', direction: 'inbound', message: 'legacy', channel: 'meta', status: 'received',
    });
  });
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member']);
  await assertSucceeds(getDoc(doc(alice, 'whatsappMessages', 'waMsgLegacy')));
  // No businessId on the row → the business clause has nothing to match; a member
  // of another department is (still) refused, and another tenant certainly is.
  const dept2 = staffOf('dina', MY_BIZ, 'teamDept2', ['member']);
  await assertFails(getDoc(doc(dept2, 'whatsappMessages', 'waMsgLegacy')));
  await assertFails(getDoc(doc(outsider(), 'whatsappMessages', 'waMsgLegacy')));
});

test('49c. conversations/wa-*: business member reads, other tenant does not, outsider cannot clear the SLA flag', async () => {
  const convId = `wa-${MY_TEAM}-355691234567`;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'conversations', convId), {
      channel: 'whatsapp', channelKind: 'baileys', businessId: MY_BIZ, teamId: MY_TEAM, phone: '355691234567',
      ownerId: null, managerId: null, watchers: [], unassigned: true, status: 'open',
      awaitingReply: true, slaBreachNotified: false, leadId: null, customerId: null,
    });
  });
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member']);
  await assertSucceeds(getDoc(doc(alice, 'conversations', convId)));
  const mallory = outsider();
  await assertFails(getDoc(doc(mallory, 'conversations', convId)));
  // Re-arming / silencing the SLA from another tenant is refused.
  await assertFails(updateDoc(doc(mallory, 'conversations', convId), { slaBreachNotified: true }));
  await assertFails(updateDoc(doc(mallory, 'conversations', convId), { awaitingReply: false }));
  // Nor may a portal client (not a watcher, not this thread's client channel) touch it.
  const carol = portalOf('carol', 'cust1', 'carol@client.com');
  await assertFails(updateDoc(doc(carol, 'conversations', convId), { slaBreachNotified: true }));
});

test('49d. waInboundCounters and aiDailyUsage are deny-all (even for the tenant admin and super-admin)', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'waInboundCounters', `${MY_TEAM}_2026-09-12`), {
      teamId: MY_TEAM, businessId: MY_BIZ, date: '2026-09-12', leadsCreated: 50,
    });
    await setDoc(doc(ctx.firestore(), 'aiDailyUsage', `${MY_TEAM}_2026-09-12`), {
      teamId: MY_TEAM, businessId: MY_BIZ, date: '2026-09-12', drafts: 200,
    });
  });
  const admin = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  const sa = testEnv.authenticatedContext('root', { email: 'root@fivo.al', superAdmin: true }).firestore();
  for (const db of [admin, sa]) {
    await assertFails(getDoc(doc(db, 'waInboundCounters', `${MY_TEAM}_2026-09-12`)));
    // Resetting the counter would lift the tenant's own daily lead cap.
    await assertFails(setDoc(doc(db, 'waInboundCounters', `${MY_TEAM}_2026-09-12`), { leadsCreated: 0 }, { merge: true }));
    await assertFails(getDoc(doc(db, 'aiDailyUsage', `${MY_TEAM}_2026-09-12`)));
    await assertFails(setDoc(doc(db, 'aiDailyUsage', `${MY_TEAM}_2026-09-12`), { drafts: 0 }, { merge: true }));
  }
});

// 50. Follow-up state on a customer is STAFF-side. The portal client may edit their
//     own profile but must not touch next step / last touch / owner — otherwise a
//     client could hide themselves from the follow-up queue or re-assign their account.
test('50a. portal client edits own profile field but cannot write follow-up fields on their customer doc', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertSucceeds(updateDoc(doc(carol, 'customers', 'cust1'), { phone: '+355691234567' }));
  await assertFails(updateDoc(doc(carol, 'customers', 'cust1'), { nextFollowUpDate: new Date('2099-01-01') }));
  await assertFails(updateDoc(doc(carol, 'customers', 'cust1'), { awaitingReply: false }));
  await assertFails(updateDoc(doc(carol, 'customers', 'cust1'), { lastActivityAt: new Date() }));
  await assertFails(updateDoc(doc(carol, 'customers', 'cust1'), { assignedToUserId: 'carol' }));
});
test('50b. staff member schedules a next step on a customer of their business', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member']);
  await assertSucceeds(updateDoc(doc(alice, 'customers', 'cust1'), {
    nextFollowUpDate: new Date('2026-09-15T10:00:00Z'), nextFollowUpType: 'call', followUpNote: 'oferta',
  }));
});

// 51. Hosting & domains module. Servers, packages and TLD prices are margin
//     intelligence; subscriptions/domains/orders are customer contracts. A portal
//     client reads only its own rows and never writes any (POST /api/hosting does).
test('51a. cross-tenant staff cannot read another tenant hosting records', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(getDoc(doc(alice, 'hostingServers', 'srvVictim')));
  await assertFails(getDoc(doc(alice, 'hostingProducts', 'hpVictim')));
  await assertFails(getDoc(doc(alice, 'domainTlds', 'tldVictim')));
  await assertFails(getDoc(doc(alice, 'subscriptions', 'subVictim')));
  await assertFails(getDoc(doc(alice, 'domains', 'domVictim')));
  await assertFails(getDoc(doc(alice, 'hostingOrders', 'hoVictim')));
});
test('51b. staff read and manage their own tenant hosting records', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(getDoc(doc(alice, 'hostingServers', 'srvMine')));
  await assertSucceeds(getDoc(doc(alice, 'hostingProducts', 'hpMineHidden')));
  await assertSucceeds(getDoc(doc(alice, 'subscriptions', 'subMine')));
  await assertSucceeds(getDoc(doc(alice, 'hostingEvents', 'hevMine')));
  await assertSucceeds(updateDoc(doc(alice, 'subscriptions', 'subMine'), { notes: 'VIP' }));
  await assertSucceeds(setDoc(doc(alice, 'hostingProducts', 'hpNew'), { businessId: MY_BIZ, teamId: MY_TEAM, name: 'Pro', serverId: 'srvMine', whmPackage: 'pro', status: 'Active', currency: 'EUR', pricing: { monthly: { price: 10 } }, createdByUserId: 'alice' }));
  // The tenant key is immutable: a subscription cannot be moved to another business.
  await assertFails(updateDoc(doc(alice, 'subscriptions', 'subMine'), { businessId: VICTIM_BIZ }));
});
test('51c. portal client reads own subscription/domain/order/events and the public catalog only', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertSucceeds(getDoc(doc(carol, 'subscriptions', 'subMine')));
  await assertSucceeds(getDoc(doc(carol, 'domains', 'domMine')));
  await assertSucceeds(getDoc(doc(carol, 'hostingOrders', 'hoMine')));
  await assertSucceeds(getDoc(doc(carol, 'hostingEvents', 'hevMine')));
  await assertSucceeds(getDoc(doc(carol, 'hostingProducts', 'hpMinePublic')));
  await assertSucceeds(getDoc(doc(carol, 'domainTlds', 'tldMine')));
  await assertFails(getDoc(doc(carol, 'hostingProducts', 'hpMineHidden')));
  await assertFails(getDoc(doc(carol, 'hostingServers', 'srvMine')));
  await assertFails(getDoc(doc(carol, 'subscriptions', 'subVictim')));
  await assertFails(getDoc(doc(carol, 'domains', 'domVictim')));
  await assertFails(getDoc(doc(carol, 'hostingOrders', 'hoVictim')));
  await assertFails(getDoc(doc(carol, 'hostingProducts', 'hpVictim')));
});
test('51d. portal client cannot write hosting records from the browser', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertFails(updateDoc(doc(carol, 'subscriptions', 'subMine'), { status: 'Active', recurringAmount: 0 }));
  await assertFails(updateDoc(doc(carol, 'subscriptions', 'subMine'), { cancelAtPeriodEnd: true }));
  await assertFails(updateDoc(doc(carol, 'domains', 'domMine'), { autoRenew: false }));
  await assertFails(updateDoc(doc(carol, 'hostingOrders', 'hoMine'), { status: 'Paid' }));
  await assertFails(setDoc(doc(carol, 'hostingOrders', 'hoForged'), { businessId: MY_BIZ, customerId: 'cust1', source: 'portal', status: 'Paid', lines: [], subtotal: 0, total: 0, currency: 'EUR', createdByUserId: 'carol' }));
});
test('51e. WHM tokens and the provider audit are server-only, even for admins and the platform super-admin', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  const sa = testEnv.authenticatedContext('root', { email: 'root@fivo.al', superAdmin: true }).firestore();
  for (const db of [alice, sa]) {
    await assertFails(getDoc(doc(db, 'hostingServerSecrets', 'srvMine')));
    await assertFails(setDoc(doc(db, 'hostingServerSecrets', 'srvMine'), { apiToken: 'x' }, { merge: true }));
  }
  await assertFails(setDoc(doc(alice, 'hostingEvents', 'forged'), { businessId: MY_BIZ, type: 'whm.removeacct', ok: true, message: 'x' }));
  await assertFails(updateDoc(doc(alice, 'hostingEvents', 'hevMine'), { message: 'rewritten' }));
  // Nor may staff create an order directly: pricing and availability live in the endpoint.
  await assertFails(setDoc(doc(alice, 'hostingOrders', 'hoStaffForged'), { businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', source: 'staff', status: 'Paid', lines: [], subtotal: 0, total: 0, currency: 'EUR', createdByUserId: 'alice' }));
});
test('51f. provider-binding and billing fields of subscriptions/domains are server-only, even for a tenant admin', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  // Binding a row to an arbitrary WHM account by hand would let staff SSO into it.
  await assertFails(updateDoc(doc(alice, 'subscriptions', 'subMine'), { cpanelUsername: 'victimacct' }));
  await assertFails(updateDoc(doc(alice, 'subscriptions', 'subMine'), { serverId: 'srvVictim' }));
  await assertFails(updateDoc(doc(alice, 'subscriptions', 'subMine'), { status: 'Active', nextDueDate: new Date('2099-01-01') }));
  await assertFails(updateDoc(doc(alice, 'subscriptions', 'subMine'), { recurringAmount: 0 }));
  await assertFails(updateDoc(doc(alice, 'domains', 'domMine'), { expiryDate: new Date('2099-01-01') }));
  await assertFails(updateDoc(doc(alice, 'domains', 'domMine'), { registrar: 'manual', nameservers: ['ns1.evil.com', 'ns2.evil.com'] }));
  // Creating a subscription/domain from the browser is not allowed either: the
  // endpoint verifies the account/domain at the provider before it exists here.
  await assertFails(setDoc(doc(alice, 'subscriptions', 'subForged'), { businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', source: 'fivocrm', productName: 'x', status: 'Active', recurringAmount: 1, cpanelUsername: 'root', serverId: 'srvMine', createdByUserId: 'alice' }));
  await assertFails(setDoc(doc(alice, 'domains', 'domForged'), { businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', source: 'fivocrm', registrar: 'dynadot', domainName: 'forged.com', status: 'Active', recurringAmount: 1, createdByUserId: 'alice' }));
  // A row we bill cannot be deleted from the browser (billing history); a mirror row can.
  await assertFails(deleteDoc(doc(alice, 'subscriptions', 'subMine')));
  await assertFails(getDoc(doc(alice, 'hostingRateLimits', 'alice_domain.check')));
});
test('51g. coupons are staff-only and tenant-bound; the backups ledger is read-only', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertSucceeds(getDoc(doc(alice, 'hostingCoupons', 'cpMine')));
  await assertFails(getDoc(doc(alice, 'hostingCoupons', 'cpVictim')));
  await assertSucceeds(setDoc(doc(alice, 'hostingCoupons', 'cpNew'), { businessId: MY_BIZ, teamId: MY_TEAM, code: 'SUMMER', type: 'fixed', value: 5, currency: 'EUR', appliesTo: 'hosting', status: 'Active', uses: 0, createdByUserId: 'alice' }));
  await assertFails(updateDoc(doc(alice, 'hostingCoupons', 'cpMine'), { businessId: VICTIM_BIZ }));
  // A code is a secret: the portal client validates it through the endpoint, never by reading.
  await assertFails(getDoc(doc(carol, 'hostingCoupons', 'cpMine')));
  await assertFails(setDoc(doc(carol, 'hostingCoupons', 'cpForged'), { businessId: MY_BIZ, code: 'FREE100', type: 'percent', value: 100, appliesTo: 'all', status: 'Active' }));
  // Backups: staff + own client read; nobody writes from the browser.
  await assertSucceeds(getDoc(doc(alice, 'hostingBackups', 'bkMine')));
  await assertSucceeds(getDoc(doc(carol, 'hostingBackups', 'bkMine')));
  await assertFails(getDoc(doc(carol, 'hostingBackups', 'bkVictim')));
  await assertFails(getDoc(doc(alice, 'hostingBackups', 'bkVictim')));
  await assertFails(setDoc(doc(alice, 'hostingBackups', 'bkForged'), { businessId: MY_BIZ, customerId: 'cust1', subscriptionId: 'subMine', kind: 'manual', ok: true }));
});

// 52. Preventiva boundary. A quote holds the tenant's pricing AND is the document a
//     contract's packageSummary is copied from, so the portal clause must be a
//     keyhole, not ownership: the client answers a quote that was SENT to them and
//     writes nothing else. Same shape as the customers rule (50a/50b).
test('52a. portal client cannot read a DRAFT quote, nor another tenant quote', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertSucceeds(getDoc(doc(carol, 'quotes', 'quoteMineSent')));
  // Internal pricing: it used to be fetched and hidden in React, i.e. in devtools.
  await assertFails(getDoc(doc(carol, 'quotes', 'quoteMineDraft')));
  await assertFails(getDoc(doc(carol, 'quotes', 'quoteVictim')));
});
test('52b. the portal LIST query must constrain status, or it is denied outright', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  // Rules are not filters: ownership alone no longer proves the read clause.
  await assertFails(getDocs(query(collection(carol, 'quotes'), where('customerId', '==', 'cust1'))));
  // The shape PortalQuotesView actually issues (CLIENT_VISIBLE_STATUSES).
  await assertSucceeds(getDocs(query(
    collection(carol, 'quotes'),
    where('customerId', '==', 'cust1'),
    where('status', 'in', ['Sent', 'Accepted', 'Rejected']),
  )));
  // The lead-linked half of the same view. Two `in` filters expand to at most
  // 10 x 3 = 30 disjunctions, which is Firestore's limit -- hence the slice(0, 10)
  // on leadIdList in PortalQuotesView.
  await assertFails(getDocs(query(collection(carol, 'quotes'), where('leadId', 'in', ['leadMine']))));
  await assertSucceeds(getDocs(query(
    collection(carol, 'quotes'),
    where('leadId', 'in', ['leadMine']),
    where('status', 'in', ['Sent', 'Accepted', 'Rejected']),
  )));
});
test('52c. portal client cannot rewrite a quote price, nor accept a Draft', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  // The whole point: `result` is the money (and what ContractsView copies verbatim).
  await assertFails(updateDoc(doc(carol, 'quotes', 'quoteMineSent2'), {
    result: { grandTotal: 1, totalMonthly: 0 },
  }));
  await assertFails(updateDoc(doc(carol, 'quotes', 'quoteMineSent2'), {
    status: 'Accepted', result: { grandTotal: 1, totalMonthly: 0 },
  }));
  await assertFails(updateDoc(doc(carol, 'quotes', 'quoteMineSent2'), { label: 'Falas' }));
  await assertFails(updateDoc(doc(carol, 'quotes', 'quoteMineSent2'), { businessId: VICTIM_BIZ }));
  // Not a terminal answer, so not the client's to write.
  await assertFails(updateDoc(doc(carol, 'quotes', 'quoteMineSent2'), { status: 'Draft' }));
  await assertFails(updateDoc(doc(carol, 'quotes', 'quoteMineSent2'), { status: 'Sent' }));
  // A Draft was never sent to them, so it cannot be accepted either.
  await assertFails(updateDoc(doc(carol, 'quotes', 'quoteMineDraft'), { status: 'Accepted' }));
  await assertFails(updateDoc(doc(carol, 'quotes', 'quoteVictim'), { status: 'Rejected' }));
  await assertFails(deleteDoc(doc(carol, 'quotes', 'quoteMineSent2')));
  // The one thing they MAY do -- exactly what PortalQuotesView writes.
  await assertSucceeds(updateDoc(doc(carol, 'quotes', 'quoteMineSent2'), {
    status: 'Accepted', updatedAt: new Date(),
  }));
});
test('52d. staff keep full control of their own tenant quotes', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(getDoc(doc(alice, 'quotes', 'quoteMineDraft')));
  await assertSucceeds(updateDoc(doc(alice, 'quotes', 'quoteMineDraft'), {
    status: 'Sent', result: { grandTotal: 450, totalMonthly: 30 },
  }));
  await assertFails(getDoc(doc(alice, 'quotes', 'quoteVictim')));
  await assertFails(updateDoc(doc(alice, 'quotes', 'quoteVictim'), { status: 'Rejected' }));
});

// 53. payments (Arketimet) and expenseCategories are business-scoped; their LIST
//     queries must carry the tenant predicate (useFirestore registers both now), so
//     an unscoped list -- the shape that made the Arketimet page render empty -- is
//     denied outright.
test('53a. payments: own tenant reads, other tenant does not, unscoped list is denied', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(getDoc(doc(alice, 'payments', 'payMine')));
  await assertFails(getDoc(doc(alice, 'payments', 'payVictim')));
  await assertFails(getDocs(collection(alice, 'payments')));
  await assertSucceeds(getDocs(query(collection(alice, 'payments'), where('businessId', '==', MY_BIZ))));
  await assertFails(getDocs(query(collection(alice, 'payments'), where('businessId', '==', VICTIM_BIZ))));
});
// 54. The compensation vault. Salary used to live on `teamMembers`, which every
// member of the business can read — so a Viewer could pull every colleague's pay
// with one query. It now lives here, readable only by the person it describes and
// by an admin/manager of that business.
test('54a. a plain member reads only their own pay row', async () => {
  const bob = staffOf('bob', MY_BIZ, MY_TEAM, ['member']);
  await assertSucceeds(getDoc(doc(bob, 'teamMemberComp', `${MY_TEAM}_bob`)));
  // The colleague sitting next to them — the whole point of the collection.
  await assertFails(getDoc(doc(bob, 'teamMemberComp', `${MY_TEAM}_carol`)));
  // And a list would hand them the lot, so it must not be provable.
  await assertFails(getDocs(collection(bob, 'teamMemberComp')));
  await assertFails(getDocs(query(collection(bob, 'teamMemberComp'), where('businessId', '==', MY_BIZ))));
});
test('54b. an admin of the business reads the whole tenant, scoped', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(getDoc(doc(alice, 'teamMemberComp', `${MY_TEAM}_carol`)));
  await assertSucceeds(getDocs(query(collection(alice, 'teamMemberComp'), where('businessId', '==', MY_BIZ))));
  // An unscoped list is denied even for them — rules are not filters.
  await assertFails(getDocs(collection(alice, 'teamMemberComp')));
});
test('54c. another tenant sees nothing, however privileged there', async () => {
  const mallory = outsider(); // admin of VICTIM_BIZ
  await assertFails(getDoc(doc(mallory, 'teamMemberComp', `${MY_TEAM}_bob`)));
  await assertFails(getDocs(query(collection(mallory, 'teamMemberComp'), where('businessId', '==', MY_BIZ))));
  await assertFails(setDoc(doc(mallory, 'teamMemberComp', `${MY_TEAM}_bob`), {
    businessId: MY_BIZ, teamId: MY_TEAM, userId: 'bob', monthlySalary: 1,
  }));
});
test('54d. nobody writes their own pay, and a row cannot be re-pointed', async () => {
  const bob = staffOf('bob', MY_BIZ, MY_TEAM, ['member']);
  // Reading your own salary is fine; awarding yourself one is not.
  await assertFails(updateDoc(doc(bob, 'teamMemberComp', `${MY_TEAM}_bob`), { monthlySalary: 500000 }));

  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(updateDoc(doc(alice, 'teamMemberComp', `${MY_TEAM}_bob`), { monthlySalary: 90000 }));
  // The id IS the data model here: a row whose key names one person while its
  // data names another would write pay under somebody else's key.
  await assertFails(setDoc(doc(alice, 'teamMemberComp', 'forged'), {
    businessId: MY_BIZ, teamId: MY_TEAM, userId: 'bob', monthlySalary: 1,
  }));
  // And an edit may never move a record to another tenant, team or person.
  await assertFails(updateDoc(doc(alice, 'teamMemberComp', `${MY_TEAM}_bob`), { businessId: VICTIM_BIZ }));
  await assertFails(updateDoc(doc(alice, 'teamMemberComp', `${MY_TEAM}_bob`), { userId: 'carol' }));
});

test('53b. expenseCategories: tenant taxonomy, not a shared one', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(getDocs(query(collection(alice, 'expenseCategories'), where('businessId', '==', MY_BIZ))));
  await assertFails(getDocs(collection(alice, 'expenseCategories')));
  await assertFails(getDoc(doc(alice, 'expenseCategories', 'catVictimExp')));
  // A create must stamp the writer's OWN business (useFirestore does it now).
  await assertSucceeds(setDoc(doc(alice, 'expenseCategories', 'catNew'), { businessId: MY_BIZ, teamId: MY_TEAM, label: 'Transport' }));
  await assertFails(setDoc(doc(alice, 'expenseCategories', 'catForged'), { businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, label: 'Forged' }));
});

test('55a. timeEntries: I log my own hours; a plain member cannot log a colleague\'s; another tenant cannot log into mine', async () => {
  const bob = staffOf('bob', MY_BIZ, MY_TEAM, ['member']);
  await assertSucceeds(setDoc(doc(bob, 'timeEntries', 'teBobNew'), {
    businessId: MY_BIZ, teamId: MY_TEAM, userId: 'bob', date: '2026-03-03', duration: 90, projectId: 'p1', source: 'manual',
  }));
  await assertFails(setDoc(doc(bob, 'timeEntries', 'teBobForAlice'), {
    businessId: MY_BIZ, teamId: MY_TEAM, userId: 'alice', date: '2026-03-03', duration: 90,
  }));
  // A manager may log on behalf of someone (the timesheet team view).
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(setDoc(doc(alice, 'timeEntries', 'teAliceForBob'), {
    businessId: MY_BIZ, teamId: MY_TEAM, userId: 'bob', date: '2026-03-04', duration: 30,
  }));
  await assertFails(setDoc(doc(outsider(), 'timeEntries', 'teMallory'), {
    businessId: MY_BIZ, teamId: MY_TEAM, userId: 'mallory', date: '2026-03-03', duration: 60,
  }));
  // Own row: edit + delete fine; a colleague's row (as a member): no.
  await assertSucceeds(updateDoc(doc(bob, 'timeEntries', 'teFebBob'), { duration: 120 }));
  await assertFails(updateDoc(doc(bob, 'timeEntries', 'teAliceForBob'), { userId: 'alice' }));
});

test('55b. a closed month freezes its hours — create, edit, delete and re-dating INTO it are all refused', async () => {
  const bob = staffOf('bob', MY_BIZ, MY_TEAM, ['member']);
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(setDoc(doc(bob, 'timeEntries', 'teJanNew'), {
    businessId: MY_BIZ, teamId: MY_TEAM, userId: 'bob', date: '2026-01-20', duration: 60,
  }));
  await assertFails(updateDoc(doc(bob, 'timeEntries', 'teJanBob'), { duration: 600 }));
  await assertFails(deleteDoc(doc(bob, 'timeEntries', 'teJanBob')));
  // Even the admin: the lock is the lock.
  await assertFails(updateDoc(doc(alice, 'timeEntries', 'teJanBob'), { duration: 600 }));
  // Moving an open-month row into the closed month is refused too.
  await assertFails(updateDoc(doc(bob, 'timeEntries', 'teFebBob'), { date: '2026-01-31' }));
  // The open month stays open.
  await assertSucceeds(updateDoc(doc(bob, 'timeEntries', 'teFebBob'), { duration: 45 }));
});

test('55c. financeMonthCloses: admin-only, id pinned to business + period, never deleted, never re-pointed', async () => {
  const bob = staffOf('bob', MY_BIZ, MY_TEAM, ['member']);
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(getDoc(doc(bob, 'financeMonthCloses', `${MY_BIZ}_2026-01`)));
  await assertFails(setDoc(doc(bob, 'financeMonthCloses', `${MY_BIZ}_2026-02`), {
    businessId: MY_BIZ, periodKey: '2026-02', locked: true, closedAt: new Date(), closedByUserId: 'bob',
  }));
  await assertSucceeds(setDoc(doc(alice, 'financeMonthCloses', `${MY_BIZ}_2026-02`), {
    businessId: MY_BIZ, periodKey: '2026-02', locked: true, closedAt: new Date(), closedByUserId: 'alice',
  }));
  await assertFails(setDoc(doc(alice, 'financeMonthCloses', 'wrong-id'), {
    businessId: MY_BIZ, periodKey: '2026-03', locked: true, closedAt: new Date(), closedByUserId: 'alice',
  }));
  await assertFails(setDoc(doc(alice, 'financeMonthCloses', `${VICTIM_BIZ}_2026-02`), {
    businessId: VICTIM_BIZ, periodKey: '2026-02', locked: true, closedAt: new Date(), closedByUserId: 'alice',
  }));
  // Re-opening is an update that keeps the period and the tenant.
  await assertSucceeds(updateDoc(doc(alice, 'financeMonthCloses', `${MY_BIZ}_2026-02`), { locked: false, reopenedAt: new Date(), reopenedByUserId: 'alice' }));
  await assertFails(updateDoc(doc(alice, 'financeMonthCloses', `${MY_BIZ}_2026-02`), { periodKey: '2026-03' }));
  await assertFails(deleteDoc(doc(alice, 'financeMonthCloses', `${MY_BIZ}_2026-02`)));
  await assertFails(getDoc(doc(outsider(), 'financeMonthCloses', `${MY_BIZ}_2026-01`)));
  // Cron-only report ledger.
  await assertFails(setDoc(doc(alice, 'financeReportRuns', `${MY_BIZ}_2026-01`), { businessId: MY_BIZ }));
});

// ══════════════════════════════════════════════════════════════════════════════
// Hardening pass Sep 2026 (C1–C5, H1–H7, M1–M8, L) — every finding gets a NEGATIVE
// test (the attack is denied) and, where a legitimate flow is touched, a POSITIVE
// one (the flow the app actually performs still works).
// ══════════════════════════════════════════════════════════════════════════════

/** A signed-in user with a VERIFIED e-mail and no tenant claims (portal first login). */
const verifiedUser = (uid, email, extra = {}) =>
  testEnv.authenticatedContext(uid, { email, email_verified: true, ...extra }).firestore();
const unverifiedUser = (uid, email, extra = {}) =>
  testEnv.authenticatedContext(uid, { email, email_verified: false, ...extra }).firestore();

async function seedHardeningFixtures() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // The victim tenant's customer (referenced by many seeds, never created before).
    await setDoc(doc(db, 'customers', 'custVictim'), { businessId: VICTIM_BIZ, teamId: VICTIM_TEAM, email: 'vclient@victim.com', name: 'Victim Client' });
    await setDoc(doc(db, 'users', 'vstaff'), { teamId: VICTIM_TEAM, businessId: VICTIM_BIZ });
    await setDoc(doc(db, 'projects', 'projCarol'), { businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', name: 'Carol site', status: 'Active' });
  });
}

// ── C1. teamMembers: the identity keys of a row are immutable ─────────────────
test('56a. a member cannot re-point their own membership row to another tenant/team/person', async () => {
  await seedHardeningFixtures();
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member'], 'alice@mine.com');
  // /api/sync-claims mints `bid` from this row — re-pointing it would mint the victim's.
  await assertFails(updateDoc(doc(alice, 'teamMembers', `${MY_TEAM}_alice`), { businessId: VICTIM_BIZ }));
  await assertFails(updateDoc(doc(alice, 'teamMembers', `${MY_TEAM}_alice`), { teamId: VICTIM_TEAM }));
  await assertFails(updateDoc(doc(alice, 'teamMembers', `${MY_TEAM}_alice`), { displayName: 'A', businessId: VICTIM_BIZ }));
  // Nor may an admin of the tenant move a colleague's row out of it.
  const admin = staffOf('boss', MY_BIZ, MY_TEAM, ['admin'], 'boss@mine.com');
  await assertFails(updateDoc(doc(admin, 'teamMembers', `${MY_TEAM}_alice`), { businessId: VICTIM_BIZ }));
  await assertFails(updateDoc(doc(admin, 'teamMembers', `${MY_TEAM}_alice`), { teamId: VICTIM_TEAM }));
  await assertFails(updateDoc(doc(admin, 'teamMembers', `${MY_TEAM}_alice`), { userId: 'boss' }));
  // The normal roster edit (same keys echoed back, as TeamsView sends them) still works.
  await assertSucceeds(updateDoc(doc(admin, 'teamMembers', `${MY_TEAM}_alice`), {
    teamId: MY_TEAM, businessId: MY_BIZ, userId: 'alice', serviceLines: ['seo'], status: 'Active',
  }));
});

test('56b. a LEGACY row with no businessId may be filled in once — only with its own team\'s business', async () => {
  // teams/teamLegacy (businessId MY_BIZ) and teamMembers/teamLegacy_ghost (no businessId) come from 35j.
  const owner = testEnv.authenticatedContext('legacyOwner', { email: 'lo@mine.com' }).firestore();
  await assertFails(updateDoc(doc(owner, 'teamMembers', 'teamLegacy_ghost'), { businessId: VICTIM_BIZ }));
  await assertSucceeds(updateDoc(doc(owner, 'teamMembers', 'teamLegacy_ghost'), { businessId: MY_BIZ, status: 'Active' }));
  // Once set, it is pinned like everyone else's.
  await assertFails(updateDoc(doc(owner, 'teamMembers', 'teamLegacy_ghost'), { businessId: VICTIM_BIZ }));
});

test('56c. a team OWNER cannot create a membership that names another business', async () => {
  // teams/teamOwned lives in bizOwned (test 7). Its creator proves authority through
  // isTeamOwner alone — that branch must still agree with the team's real business.
  const owner = testEnv.authenticatedContext('owner', { email: 'owner@o.com' }).firestore();
  await assertFails(setDoc(doc(owner, 'teamMembers', 'teamOwned_eve2'), {
    userId: 'eve2', teamId: 'teamOwned', businessId: VICTIM_BIZ, role: 'Member', status: 'Active',
  }));
  await assertSucceeds(setDoc(doc(owner, 'teamMembers', 'teamOwned_eve2'), {
    userId: 'eve2', teamId: 'teamOwned', businessId: 'bizOwned', role: 'Member', status: 'Active',
  }));
});

// ── C2. clientPortalAccess: a portal identity is minted only for yourself ─────
test('57a. nobody mints a portal identity for a customer whose e-mail is not their own (verified) e-mail', async () => {
  const mallory = verifiedUser('mallory', 'm@evil.com');
  await assertFails(setDoc(doc(mallory, 'clientPortalAccess', 'paForged'), {
    customerId: 'cust1', userId: 'mallory', email: 'm@evil.com', status: 'Active', createdByUserId: 'mallory',
  }));
  // Even with the CUSTOMER's e-mail typed into the row: the customer's own e-mail must match the token.
  await assertFails(setDoc(doc(mallory, 'clientPortalAccess', 'paForged2'), {
    customerId: 'cust1', userId: 'mallory', email: 'carol@client.com', status: 'Active', createdByUserId: 'mallory',
  }));
  // The real client, but with an UNVERIFIED e-mail (a password sign-up with her address) — refused.
  const carolUnverified = unverifiedUser('carol', 'carol@client.com');
  await assertFails(setDoc(doc(carolUnverified, 'clientPortalAccess', 'paCarolUnverified'), {
    customerId: 'cust1', userId: 'carol', email: 'carol@client.com', status: 'Active', createdByUserId: 'carol', businessId: MY_BIZ,
  }));
  // Verified, but for somebody else's uid, or for another customer, or carrying access fields — refused.
  const carol = verifiedUser('carol', 'carol@client.com');
  await assertFails(setDoc(doc(carol, 'clientPortalAccess', 'paCarolOther'), {
    customerId: 'cust1', userId: 'mallory', email: 'carol@client.com', status: 'Active', createdByUserId: 'carol',
  }));
  await assertFails(setDoc(doc(carol, 'clientPortalAccess', 'paCarolVictim'), {
    customerId: 'custVictim', userId: 'carol', email: 'carol@client.com', status: 'Active', createdByUserId: 'carol',
  }));
  await assertFails(setDoc(doc(carol, 'clientPortalAccess', 'paCarolAdmin'), {
    customerId: 'cust1', userId: 'carol', email: 'carol@client.com', status: 'Active', createdByUserId: 'carol', accessLevel: 'admin',
  }));
});

test('57b. the portal bootstrap (useClientPortal.createDoc shape) and the staff "Krijo akses" shape both work', async () => {
  // useClientPortal: verified token e-mail == row e-mail == customer e-mail, own uid, tenant stamp.
  const carol = verifiedUser('carol', 'carol@client.com');
  await assertSucceeds(setDoc(doc(carol, 'clientPortalAccess', 'paCarolNew'), {
    customerId: 'cust1', userId: 'carol', email: 'carol@client.com', status: 'Active',
    teamId: MY_TEAM, businessId: MY_BIZ, createdAt: new Date(), updatedAt: new Date(), createdByUserId: 'carol',
  }));
  // A tenant stamp that disagrees with the customer's business is refused.
  await assertFails(setDoc(doc(carol, 'clientPortalAccess', 'paCarolWrongBiz'), {
    customerId: 'cust1', userId: 'carol', email: 'carol@client.com', status: 'Active', businessId: VICTIM_BIZ, createdByUserId: 'carol',
  }));
  // CustomersView / CRMView / InvoicesView: staff of the customer's tenant, userId '', no businessId stamped.
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member'], 'alice@mine.com');
  await assertSucceeds(setDoc(doc(alice, 'clientPortalAccess', 'paByStaff'), {
    customerId: 'cust1', userId: '', email: 'carol@client.com', status: 'Active', createdByUserId: 'alice',
  }));
  await assertFails(setDoc(doc(alice, 'clientPortalAccess', 'paByStaffVictim'), {
    customerId: 'custVictim', userId: '', email: 'vclient@victim.com', status: 'Active', createdByUserId: 'alice',
  }));
  // Staff may revoke/edit within the tenant but never re-point the row.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), 'clientPortalAccess', 'paByStaff'), { businessId: MY_BIZ });
  });
  await assertSucceeds(updateDoc(doc(alice, 'clientPortalAccess', 'paByStaff'), { status: 'Revoked' }));
  await assertFails(updateDoc(doc(alice, 'clientPortalAccess', 'paByStaff'), { customerId: 'custVictim' }));
});

test('57c. the "initial claim" of an unlinked access row needs a VERIFIED matching e-mail', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'clientPortalAccess', 'paUnclaimed'), {
      businessId: MY_BIZ, customerId: 'cust1', userId: '', email: 'carol@client.com', status: 'Active',
    });
  });
  await assertFails(updateDoc(doc(unverifiedUser('carol', 'carol@client.com'), 'clientPortalAccess', 'paUnclaimed'), { userId: 'carol' }));
  await assertFails(updateDoc(doc(verifiedUser('mallory', 'm@evil.com'), 'clientPortalAccess', 'paUnclaimed'), { userId: 'mallory' }));
  // The claim may not smuggle access/tenant fields, and must name the claimant.
  await assertFails(updateDoc(doc(verifiedUser('carol', 'carol@client.com'), 'clientPortalAccess', 'paUnclaimed'), { userId: 'carol', accessLevel: 'admin' }));
  await assertFails(updateDoc(doc(verifiedUser('carol', 'carol@client.com'), 'clientPortalAccess', 'paUnclaimed'), { userId: 'mallory' }));
  await assertSucceeds(updateDoc(doc(verifiedUser('carol', 'carol@client.com'), 'clientPortalAccess', 'paUnclaimed'), { userId: 'carol', updatedAt: new Date() }));
  // Reading one's own access row by e-mail also needs the verified e-mail.
  await assertFails(getDocs(query(collection(unverifiedUser('eve', 'carol@client.com'), 'clientPortalAccess'), where('email', '==', 'carol@client.com'))));
  await assertSucceeds(getDocs(query(collection(verifiedUser('carol', 'carol@client.com'), 'clientPortalAccess'), where('email', '==', 'carol@client.com'))));
});

// ── C3. isSelfCreate is tenant-bound; the portal bootstrap is e-mail-bound ─────
test('58a. first-login bootstrap: a verified user creates a customer ABOUT THEIR OWN e-mail, nothing else', async () => {
  const newbie = verifiedUser('newbie', 'newbie@x.com');
  await assertSucceeds(setDoc(doc(newbie, 'customers', 'custNewbie'), {
    name: 'Newbie', email: 'newbie@x.com', status: 'Pending', teamId: MY_TEAM, businessId: MY_BIZ,
    createdAt: new Date(), updatedAt: new Date(), createdByUserId: 'newbie',
  }));
  // Somebody else's address on "my" record — refused.
  await assertFails(setDoc(doc(newbie, 'customers', 'custImpersonate'), {
    name: 'Carol', email: 'carol@client.com', status: 'Pending', businessId: MY_BIZ, createdByUserId: 'newbie',
  }));
  // Not as yourself — refused.
  await assertFails(setDoc(doc(newbie, 'customers', 'custAsOther'), {
    name: 'Newbie', email: 'newbie@x.com', status: 'Pending', businessId: MY_BIZ, createdByUserId: 'someoneElse',
  }));
  // Unverified e-mail — refused (the whole point: a password sign-up is not proof of the address).
  await assertFails(setDoc(doc(unverifiedUser('newbie2', 'newbie2@x.com'), 'customers', 'custNewbie2'), {
    name: 'Newbie2', email: 'newbie2@x.com', status: 'Pending', businessId: MY_BIZ, createdByUserId: 'newbie2',
  }));
  // Reading a customer by e-mail (the bootstrap query) needs the verified e-mail too.
  await assertFails(getDocs(query(collection(unverifiedUser('eve', 'carol@client.com'), 'customers'), where('email', '==', 'carol@client.com'))));
  await assertSucceeds(getDocs(query(collection(verifiedUser('carol', 'carol@client.com'), 'customers'), where('email', '==', 'carol@client.com'))));
});

test('58b. portal self-creates (lead, request, comment, inquiry) are bound to the client\'s OWN tenant', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  // PortalInquiryView lead: the client's own tenant, any contact e-mail they typed.
  await assertSucceeds(setDoc(doc(carol, 'leads', 'leadFromInquiry'), {
    name: 'Contact', email: 'other-contact@x.com', status: 'New', source: 'Service Questionnaire',
    teamId: MY_TEAM, businessId: MY_BIZ, createdByUserId: 'carol',
  }));
  await assertFails(setDoc(doc(carol, 'leads', 'leadIntoVictim'), {
    name: 'Contact', email: 'other-contact@x.com', status: 'New', businessId: VICTIM_BIZ, createdByUserId: 'carol',
  }));
  // clientRequests: own customer inside own tenant; never another customer's, never another tenant's.
  await assertSucceeds(setDoc(doc(carol, 'clientRequests', 'reqCarol'), {
    customerId: 'cust1', businessId: MY_BIZ, teamId: MY_TEAM, title: 'Ndrysho logon', status: 'New', createdByUserId: 'carol',
  }));
  await assertFails(setDoc(doc(carol, 'clientRequests', 'reqAsVictim'), {
    customerId: 'custVictim', businessId: MY_BIZ, title: 'x', createdByUserId: 'carol',
  }));
  // The OLD hole: staff of another tenant "self-creating" a request into mine.
  await assertFails(setDoc(doc(outsider(), 'clientRequests', 'reqInjected'), {
    customerId: 'cust1', businessId: MY_BIZ, title: 'injected', createdByUserId: 'mallory',
  }));
  // Portal client edits the content of their request, never its keys.
  await assertSucceeds(updateDoc(doc(carol, 'clientRequests', 'reqCarol'), { description: 'më shumë detaje' }));
  await assertFails(updateDoc(doc(carol, 'clientRequests', 'reqCarol'), { customerId: 'custVictim' }));
  await assertFails(updateDoc(doc(carol, 'clientRequests', 'reqCarol'), { businessId: VICTIM_BIZ }));
  // projectComments (PortalProjectDetailView shape).
  await assertSucceeds(setDoc(doc(carol, 'projectComments', 'pcCarol'), {
    projectId: 'projCarol', content: 'Faleminderit', userId: 'carol', senderType: 'client',
    teamId: MY_TEAM, customerId: 'cust1', businessId: MY_BIZ, createdByUserId: 'carol',
  }));
  await assertFails(setDoc(doc(carol, 'projectComments', 'pcCarolVictim'), {
    projectId: 'projCarol', content: 'x', userId: 'carol', senderType: 'client', customerId: 'cust1', businessId: VICTIM_BIZ, createdByUserId: 'carol',
  }));
  await assertFails(setDoc(doc(outsider(), 'projectComments', 'pcInjected'), {
    projectId: 'projCarol', content: 'x', businessId: MY_BIZ, createdByUserId: 'mallory',
  }));
  // A portal MEMBER of a shared project (39e) may still comment on it.
  const dave = portalOf('dave', 'custOther', 'dave@partner.com');
  await assertSucceeds(setDoc(doc(dave, 'projectComments', 'pcDave'), {
    projectId: 'projShared', content: 'ok', userId: 'dave', senderType: 'client', customerId: 'custOther', businessId: MY_BIZ, createdByUserId: 'dave',
  }));
  // serviceInquiries (useStartInquiry shape) + PortalInquiryView edits.
  await assertSucceeds(setDoc(doc(carol, 'serviceInquiries', 'inqCarol'), {
    status: 'Draft', isDraft: true, lastSavedStep: 1, customerId: 'cust1', clientUserId: 'carol',
    teamId: MY_TEAM, businessId: MY_BIZ, createdByUserId: 'carol',
  }));
  await assertFails(setDoc(doc(outsider(), 'serviceInquiries', 'inqInjected'), {
    status: 'Draft', clientUserId: 'mallory', businessId: MY_BIZ, createdByUserId: 'mallory',
  }));
  await assertSucceeds(updateDoc(doc(carol, 'serviceInquiries', 'inqCarol'), { contactName: 'Carol', lastSavedStep: 2, leadId: 'leadFromInquiry' }));
  await assertFails(updateDoc(doc(carol, 'serviceInquiries', 'inqCarol'), { clientUserId: 'mallory' }));
  await assertFails(updateDoc(doc(carol, 'serviceInquiries', 'inqCarol'), { businessId: VICTIM_BIZ }));
});

// ── C4. Departments are created by roster authority; no self-promotion via a team ──
test('59a. a plain Member cannot create a department (the self-promotion ladder)', async () => {
  const bob = staffOf('bob', MY_BIZ, MY_TEAM, ['member'], 'bob@mine.com');
  await assertFails(setDoc(doc(bob, 'teams', 'teamByBob'), { name: 'Bob dept', businessId: MY_BIZ, createdByUserId: 'bob' }));
  // A legacy team he did manage to create earlier: he still cannot make himself its Admin.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teams', 'teamGrab'), { name: 'Grab', businessId: MY_BIZ, createdByUserId: 'bob' });
  });
  await assertFails(setDoc(doc(bob, 'teamMembers', 'teamGrab_bob'), {
    userId: 'bob', teamId: 'teamGrab', businessId: MY_BIZ, role: 'Admin', status: 'Active',
  }));
  await assertFails(setDoc(doc(bob, 'teamMembers', 'teamGrab_bob'), {
    userId: 'bob', teamId: 'teamGrab', businessId: MY_BIZ, role: 'Manager', status: 'Active',
  }));
  await assertSucceeds(setDoc(doc(bob, 'teamMembers', 'teamGrab_bob'), {
    userId: 'bob', teamId: 'teamGrab', businessId: MY_BIZ, role: 'Member', status: 'Active',
  }));
  // The team's creator is pinned: nobody hands isTeamOwner() to somebody else.
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(updateDoc(doc(alice, 'teams', 'teamDept2'), { createdByUserId: 'bob' }));
  await assertSucceeds(updateDoc(doc(alice, 'teams', 'teamDept2'), { name: 'Dept 2 renamed' }));
});

test('59b. self-signup (createTenant.ts order) still provisions business → team → own Admin row → settings → users', async () => {
  const founder = testEnv.authenticatedContext('founder', { email: 'founder@new.com' }).firestore();
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  await assertSucceeds(setDoc(doc(founder, 'businesses', 'bizNew'), {
    name: 'New Co', ownerId: 'founder', ownerEmail: 'founder@new.com', plan: 'trial', status: 'trialing',
    trialEndsAt, disabledModules: ['/app/products'], createdAt: new Date(), updatedAt: new Date(),
  }));
  await assertSucceeds(setDoc(doc(founder, 'teams', 'teamNew'), {
    name: 'Përgjithshëm', businessId: 'bizNew', createdByUserId: 'founder', ownerEmail: 'founder@new.com',
  }));
  await assertSucceeds(setDoc(doc(founder, 'teamMembers', 'teamNew_founder'), {
    teamId: 'teamNew', businessId: 'bizNew', userId: 'founder', email: 'founder@new.com', displayName: 'F',
    role: 'Admin', status: 'Active', createdByUserId: 'founder',
  }));
  await assertSucceeds(setDoc(doc(founder, 'teamSettings', 'teamNew'), { companyName: 'New Co', eurAllRate: '100' }, { merge: true }));
  await assertSucceeds(setDoc(doc(founder, 'users', 'founder'), { teamId: 'teamNew', businessId: 'bizNew' }, { merge: true }));
  // TeamsView: an ADMIN creating a second department and adding themselves as its Admin.
  const admin = staffOf('boss', MY_BIZ, MY_TEAM, ['admin'], 'boss@mine.com');
  await assertSucceeds(setDoc(doc(admin, 'teams', 'teamDept3'), { name: 'Dept 3', businessId: MY_BIZ, createdByUserId: 'boss' }));
  await assertSucceeds(setDoc(doc(admin, 'teamMembers', 'teamDept3_boss'), {
    userId: 'boss', teamId: 'teamDept3', businessId: MY_BIZ, role: 'Admin', status: 'Active',
  }));
});

// ── C5 / H1. businesses: a signup is a fresh trial and cannot squat a legacy tenant ──
test('60a. a business cannot be founded over an existing team id, nor born with a plan/status/seats', async () => {
  const squatter = testEnv.authenticatedContext('squatter', { email: 's@evil.com' }).firestore();
  // Legacy tenants have businessId == teamId and no businesses doc: claiming that id = owning the tenant.
  await assertFails(setDoc(doc(squatter, 'businesses', VICTIM_TEAM), { name: 'Mine now', ownerId: 'squatter', plan: 'trial', status: 'trialing' }));
  const founder = testEnv.authenticatedContext('founder2', { email: 'f2@new.com' }).firestore();
  await assertFails(setDoc(doc(founder, 'businesses', 'bizPro'), { name: 'x', ownerId: 'founder2', plan: 'enterprise', status: 'trialing' }));
  await assertFails(setDoc(doc(founder, 'businesses', 'bizPro'), { name: 'x', ownerId: 'founder2', plan: 'trial', status: 'active' }));
  await assertFails(setDoc(doc(founder, 'businesses', 'bizPro'), { name: 'x', ownerId: 'founder2', plan: 'trial', status: 'trialing', lockedModules: ['/app/hosting'] }));
  await assertFails(setDoc(doc(founder, 'businesses', 'bizPro'), { name: 'x', ownerId: 'founder2', plan: 'trial', status: 'trialing', seats: 99 }));
  await assertFails(setDoc(doc(founder, 'businesses', 'bizPro'), { name: 'x', ownerId: 'founder2', plan: 'trial', status: 'trialing', limits: { users: 999 } }));
  await assertFails(setDoc(doc(founder, 'businesses', 'bizPro'), {
    name: 'x', ownerId: 'founder2', plan: 'trial', status: 'trialing', trialEndsAt: new Date(Date.now() + 400 * 24 * 3600 * 1000),
  }));
  await assertSucceeds(setDoc(doc(founder, 'businesses', 'bizPro'), {
    name: 'x', ownerId: 'founder2', plan: 'trial', status: 'trialing', trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
  }));
});

test('60b. the owner cannot set their own seats / limits / trial end / owner; the platform (Admin SDK) does', async () => {
  const owner = testEnv.authenticatedContext('aliceOwner', { email: 'alice@mine.com', bid: MY_BIZ, tid: MY_TEAM, roles: ['owner', 'admin'] }).firestore();
  await assertFails(updateDoc(doc(owner, 'businesses', MY_BIZ), { seats: 50 }));
  await assertFails(updateDoc(doc(owner, 'businesses', MY_BIZ), { limits: { users: 500 } }));
  await assertFails(updateDoc(doc(owner, 'businesses', MY_BIZ), { trialEndsAt: new Date('2099-01-01') }));
  await assertFails(updateDoc(doc(owner, 'businesses', MY_BIZ), { ownerId: 'mallory' }));
  await assertFails(updateDoc(doc(owner, 'businesses', MY_BIZ), { stripeSubscriptionId: 'sub_fake' }));
  await assertSucceeds(updateDoc(doc(owner, 'businesses', MY_BIZ), { name: 'Mine Ltd', updatedAt: new Date() }));
});

// ── H2. messages: sent as yourself, inside your tenant, to people in your tenant ──
test('61a. a DM cannot leave the tenant, a message cannot be sent as somebody else', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member'], 'alice@mine.com');
  // vstaff is staff of the victim tenant (users/vstaff carries its businessId).
  await assertFails(setDoc(doc(alice, 'messages', 'dm-to-victim'), {
    businessId: MY_BIZ, teamId: MY_TEAM, senderId: 'alice', receiverId: 'vstaff', content: 'phish', isRead: false,
  }));
  await assertSucceeds(setDoc(doc(alice, 'messages', 'dm-to-zoe'), {
    businessId: MY_BIZ, teamId: MY_TEAM, senderId: 'alice', receiverId: 'zoe', content: 'hi', isRead: false,
  }));
  // senderId / createdByUserId must be the caller.
  await assertFails(setDoc(doc(alice, 'messages', 'as-zoe'), {
    businessId: MY_BIZ, teamId: MY_TEAM, senderId: 'zoe', channelId: 'general-mine', content: 'not me', isRead: false,
  }));
  await assertFails(setDoc(doc(alice, 'messages', 'as-zoe2'), {
    businessId: MY_BIZ, teamId: MY_TEAM, senderId: 'alice', createdByUserId: 'zoe', channelId: 'general-mine', content: 'x', isRead: false,
  }));
  // The old teamId-only branch: my team + the victim's businessId — closed.
  await assertFails(setDoc(doc(alice, 'messages', 'stamp-victim'), {
    businessId: VICTIM_BIZ, teamId: MY_TEAM, senderId: 'alice', channelId: 'general-victim', content: 'x', isRead: false,
  }));
  // Staff→client thread: only a customer of MY tenant.
  await assertFails(setDoc(doc(alice, 'messages', 'to-victim-client'), {
    businessId: MY_BIZ, teamId: MY_TEAM, senderId: 'alice', senderType: 'staff', channelId: 'client-custVictim', content: 'x', isRead: true,
  }));
  await assertSucceeds(setDoc(doc(alice, 'messages', 'to-my-client'), {
    businessId: MY_BIZ, teamId: MY_TEAM, senderId: 'alice', senderType: 'staff', channelId: 'client-cust1', content: 'hi', isRead: true,
  }));
  // The portal client cannot pose as staff.
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertFails(setDoc(doc(carol, 'messages', 'client-as-staff'), {
    businessId: MY_BIZ, teamId: MY_TEAM, senderId: 'carol', senderType: 'staff', channelId: 'client-cust1', content: 'x', isRead: true,
  }));
});

test('61b. the sender edits content but never re-points a message; dmThreads need a same-tenant peer', async () => {
  const zoe = staffOf('zoe', MY_BIZ, MY_TEAM, ['member'], 'zoe@mine.com');
  // msg1 was sent by zoe (seed). ChatView's edit / soft-delete / pin writes:
  await assertSucceeds(updateDoc(doc(zoe, 'messages', 'msg1'), { content: 'edited', editedAt: new Date(), editHistory: [{ content: 'hi' }] }));
  await assertSucceeds(updateDoc(doc(zoe, 'messages', 'msg1'), { isPinned: true }));
  await assertSucceeds(updateDoc(doc(zoe, 'messages', 'msg1'), {
    deletedAt: new Date(), content: 'Ky mesazh u fshi.', attachmentUrl: null, reactions: {}, isPinned: false, isRead: true, editHistory: [],
  }));
  await assertFails(updateDoc(doc(zoe, 'messages', 'msg1'), { receiverId: 'vstaff' }));
  await assertFails(updateDoc(doc(zoe, 'messages', 'msg1'), { channelId: 'client-custVictim' }));
  await assertFails(updateDoc(doc(zoe, 'messages', 'msg1'), { businessId: VICTIM_BIZ }));
  await assertFails(updateDoc(doc(zoe, 'messages', 'msg1'), { senderId: 'alice' }));
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member'], 'alice@mine.com');
  await assertFails(setDoc(doc(alice, 'dmThreads', 'alice__vstaff'), {
    participants: ['alice', 'vstaff'], businessId: MY_BIZ, lastMessage: { content: 'x', senderId: 'alice', createdAt: new Date() }, updatedAt: new Date(),
  }, { merge: true }));
});

// ── H3. taskComments: as yourself, in your tenant / on your own customer's task ──
test('62. a task comment is authored by its writer and stays inside the tenant', async () => {
  // The old rule accepted `teamId is string` from ANYONE.
  await assertFails(setDoc(doc(outsider(), 'taskComments', 'tcInjected'), {
    taskId: 'taskCarol', content: 'injected', teamId: MY_TEAM, businessId: MY_BIZ, createdByUserId: 'mallory',
  }));
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member'], 'alice@mine.com');
  await assertFails(setDoc(doc(alice, 'taskComments', 'tcAsZoe'), {
    taskId: 'taskCarol', content: 'x', teamId: MY_TEAM, businessId: MY_BIZ, createdByUserId: 'zoe',
  }));
  await assertSucceeds(setDoc(doc(alice, 'taskComments', 'tcAlice'), {
    taskId: 'taskCarol', content: 'ok', teamId: MY_TEAM, businessId: MY_BIZ, createdByUserId: 'alice',
  }));
  // PortalProjectDetailView shape: senderType client + the client's own customerId.
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertSucceeds(setDoc(doc(carol, 'taskComments', 'tcCarol'), {
    taskId: 'taskCarol', content: 'Faleminderit', userId: 'carol', senderType: 'client', createdByUserId: 'carol',
    teamId: MY_TEAM, customerId: 'cust1', businessId: MY_BIZ,
  }));
  await assertFails(setDoc(doc(carol, 'taskComments', 'tcCarolVictim'), {
    taskId: 'taskV', content: 'x', userId: 'carol', senderType: 'client', createdByUserId: 'carol', customerId: 'custVictim', businessId: VICTIM_BIZ,
  }));
  // The author's edit may not re-tenant the comment.
  await assertFails(updateDoc(doc(alice, 'taskComments', 'tcAlice'), { content: 'moved', businessId: VICTIM_BIZ }));
});

// ── H4. contracts / projects / customers: the portal's writes are keyholes ──────
test('63a. a portal client only ANSWERS a sent contract — sign as themselves or reject — never edits or deletes it', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'contracts', 'ctrSent'), { businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', title: 'SEO 12m', amount: 1200, status: 'Sent' });
    await setDoc(doc(db, 'contracts', 'ctrSent2'), { businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', title: 'Ads', amount: 300, status: 'Sent' });
    await setDoc(doc(db, 'contracts', 'ctrDraft'), { businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', title: 'Draft', amount: 500, status: 'Draft' });
  });
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertFails(updateDoc(doc(carol, 'contracts', 'ctrSent'), { amount: 1 }));
  await assertFails(updateDoc(doc(carol, 'contracts', 'ctrSent'), { status: 'Signed', amount: 1, signedByUserId: 'carol' }));
  await assertFails(updateDoc(doc(carol, 'contracts', 'ctrSent'), { status: 'Signed', signedByUserId: 'alice' }));
  await assertFails(updateDoc(doc(carol, 'contracts', 'ctrDraft'), { status: 'Signed', signedByUserId: 'carol' }));
  await assertFails(updateDoc(doc(carol, 'contracts', 'ctrDraft'), { status: 'Sent' }));
  await assertFails(deleteDoc(doc(carol, 'contracts', 'ctrSent')));
  // PortalContractsView.handleSign — the exact write.
  await assertSucceeds(updateDoc(doc(carol, 'contracts', 'ctrSent'), {
    status: 'Signed', signedAt: new Date(), signedByUserId: 'carol', signedByEmail: 'carol@client.com',
    signatureData: 'Carol', signatureType: 'typed', updatedAt: new Date(),
  }));
  // Un-signing is not a thing.
  await assertFails(updateDoc(doc(carol, 'contracts', 'ctrSent'), { status: 'Sent' }));
  // handleReject.
  await assertSucceeds(updateDoc(doc(carol, 'contracts', 'ctrSent2'), { status: 'Rejected', rejectedAt: new Date(), rejectionReason: 'çmimi', updatedAt: new Date() }));
  // Staff keep full control inside the tenant.
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member'], 'alice@mine.com');
  await assertSucceeds(updateDoc(doc(alice, 'contracts', 'ctrDraft'), { status: 'Sent', sentAt: new Date() }));
  await assertFails(updateDoc(doc(alice, 'contracts', 'ctrDraft'), { businessId: VICTIM_BIZ }));
  await assertSucceeds(deleteDoc(doc(alice, 'contracts', 'ctrDraft')));
});

test('63b. the portal client cannot write or delete their project, nor delete their own customer record', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertSucceeds(getDoc(doc(carol, 'projects', 'projCarol')));
  await assertFails(updateDoc(doc(carol, 'projects', 'projCarol'), { name: 'renamed by client' }));
  await assertFails(updateDoc(doc(carol, 'projects', 'projCarol'), { status: 'Archived' }));
  await assertFails(deleteDoc(doc(carol, 'projects', 'projCarol')));
  await assertFails(deleteDoc(doc(carol, 'customers', 'cust1')));
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member'], 'alice@mine.com');
  await assertSucceeds(updateDoc(doc(alice, 'projects', 'projCarol'), { status: 'On Hold' }));
  await assertFails(updateDoc(doc(alice, 'projects', 'projCarol'), { businessId: VICTIM_BIZ }));
});

// ── H5. teamId-only create branches: a teamId names no tenant ──────────────────
test('64. marketing / workspace / typing rows are created inside the writer\'s business, never "my team + your business"', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member'], 'alice@mine.com');
  for (const col of ['waTemplates', 'waBroadcasts', 'emailTemplates', 'emailCampaigns', 'campaignEnrollments', 'chatSnippets', 'workspaceFolders', 'workspaceDriveFiles']) {
    await assertFails(setDoc(doc(alice, col, `${col}-hop`), { teamId: MY_TEAM, businessId: VICTIM_BIZ, name: 'hop', createdByUserId: 'alice' }));
    await assertFails(setDoc(doc(alice, col, `${col}-noBiz`), { teamId: MY_TEAM, name: 'no tenant', createdByUserId: 'alice' }));
    await assertSucceeds(setDoc(doc(alice, col, `${col}-ok`), { teamId: MY_TEAM, businessId: MY_BIZ, name: 'ok', createdByUserId: 'alice' }));
    await assertFails(updateDoc(doc(alice, col, `${col}-ok`), { businessId: VICTIM_BIZ }));
  }
  // typingIndicators: as yourself, in your business.
  await assertFails(setDoc(doc(alice, 'typingIndicators', 'grp1__alice-hop'), { userId: 'alice', channelId: 'grp1', timestamp: new Date(), businessId: VICTIM_BIZ, teamId: MY_TEAM }));
  await assertFails(setDoc(doc(alice, 'typingIndicators', 'grp1__zoe'), { userId: 'zoe', channelId: 'grp1', timestamp: new Date(), businessId: MY_BIZ, teamId: MY_TEAM }));
  // lidMappings are written by the VPS only.
  await assertFails(setDoc(doc(alice, 'lidMappings', 'lid1'), { businessId: MY_BIZ, teamId: MY_TEAM, lid: '1', phone: '355' }));
});

// ── H6. chatScheduledMessages: the cron sends them unchecked, so the target is checked here ──
test('65. a scheduled message cannot target another tenant, and its routing cannot be re-aimed', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member'], 'alice@mine.com');
  const base = { senderId: 'alice', content: 'later', attachmentUrl: null, scheduledAt: new Date(Date.now() + 3600e3).toISOString(), sent: false, createdByUserId: 'alice' };
  await assertFails(setDoc(doc(alice, 'chatScheduledMessages', 'sch-victim'), { ...base, channelId: null, directUserId: 'vstaff' }));
  await assertFails(setDoc(doc(alice, 'chatScheduledMessages', 'sch-victim-ch'), { ...base, channelId: 'client-custVictim', directUserId: null }));
  await assertFails(setDoc(doc(alice, 'chatScheduledMessages', 'sch-as-zoe'), { ...base, senderId: 'zoe', channelId: null, directUserId: 'zoe' }));
  await assertSucceeds(setDoc(doc(alice, 'chatScheduledMessages', 'sch-ok'), { ...base, channelId: null, directUserId: 'zoe' }));
  await assertSucceeds(setDoc(doc(alice, 'chatScheduledMessages', 'sch-ok-client'), { ...base, channelId: 'client-cust1', directUserId: null }));
  await assertFails(updateDoc(doc(alice, 'chatScheduledMessages', 'sch-ok'), { directUserId: 'vstaff' }));
  await assertFails(updateDoc(doc(alice, 'chatScheduledMessages', 'sch-ok'), { channelId: 'client-custVictim' }));
  await assertFails(updateDoc(doc(alice, 'chatScheduledMessages', 'sch-ok'), { senderId: 'zoe' }));
  await assertSucceeds(updateDoc(doc(alice, 'chatScheduledMessages', 'sch-ok'), { content: 'edited', sent: true, sentAt: new Date() }));
  await assertFails(getDoc(doc(staffOf('zoe', MY_BIZ, MY_TEAM, ['member']), 'chatScheduledMessages', 'sch-ok')));
});

// ── M2. teamSettings: staff-only, and the secret deny-list mirrors api/_tenantConfig.ts ──
test('66a. a portal client no longer reads teamSettings', async () => {
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertFails(getDoc(doc(carol, 'teamSettings', MY_TEAM)));
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member']);
  await assertSucceeds(getDoc(doc(alice, 'teamSettings', MY_TEAM)));
});

test('66b. every SECRET_FIELDS key of api/_tenantConfig.ts is refused on teamSettings, and the two lists are identical', async () => {
  const src = readFileSync('api/_tenantConfig.ts', 'utf8');
  const block = src.match(/export const SECRET_FIELDS = \[([\s\S]*?)\] as const;/);
  assert.ok(block, 'SECRET_FIELDS not found in api/_tenantConfig.ts');
  const secretFields = [...block[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map(m => m[1]);
  assert.ok(secretFields.length >= 6, `too few SECRET_FIELDS parsed: ${secretFields.join(',')}`);
  const rules = readFileSync('firestore.rules', 'utf8');
  const fn = rules.match(/function teamSettingsSecretKeys\(\) \{\s*return \[([\s\S]*?)\];/);
  assert.ok(fn, 'teamSettingsSecretKeys() not found in firestore.rules');
  const ruleKeys = [...fn[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map(m => m[1]);
  assert.deepEqual([...ruleKeys].sort(), [...secretFields].sort(), 'firestore.rules teamSettingsSecretKeys() must mirror SECRET_FIELDS');
  const admin = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  for (const field of secretFields) {
    await assertFails(setDoc(doc(admin, 'teamSettings', MY_TEAM), { [field]: 'leak-me' }, { merge: true }));
  }
  await assertSucceeds(setDoc(doc(admin, 'teamSettings', MY_TEAM), { hasDynadotApiKey: true, companyName: 'Mine Ltd' }, { merge: true }));
});

// ── M3. expenses: the approving department is a department OF the business ─────
test('67. an expense cannot be routed to a team of another business, nor re-routed by a non-approver', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member'], 'alice@mine.com');
  await assertFails(setDoc(doc(alice, 'expenses', 'expForeignTeam'), {
    businessId: MY_BIZ, teamId: VICTIM_TEAM, title: 'x', amount: 10, currency: 'ALL', date: '2026-09-01', approvalStatus: 'Submitted', createdByUserId: 'alice',
  }));
  await assertSucceeds(setDoc(doc(alice, 'expenses', 'expTeamOk'), {
    businessId: MY_BIZ, teamId: MY_TEAM, title: 'x', amount: 10, currency: 'ALL', date: '2026-09-01', approvalStatus: 'Submitted', createdByUserId: 'alice',
  }));
  // finn is a plain Member (10g) — bob's membership row was re-seeded as Admin in 15,
  // which makes him a legitimate approver (isTeamAdmin), not the case under test.
  const finn = staffOf('finn', MY_BIZ, MY_TEAM, ['member'], 'finn@mine.com');
  await assertFails(updateDoc(doc(finn, 'expenses', 'expTeamOk'), { teamId: VICTIM_TEAM }));
  await assertFails(updateDoc(doc(finn, 'expenses', 'expTeamOk'), { teamId: 'teamDept2' }));
  await assertSucceeds(updateDoc(doc(finn, 'expenses', 'expTeamOk'), { title: 'renamed' }));
  // A Viewer books no costs.
  const vera = staffOf('vera', MY_BIZ, MY_TEAM, ['viewer']);
  await assertFails(setDoc(doc(vera, 'expenses', 'expByViewer'), {
    businessId: MY_BIZ, teamId: MY_TEAM, title: 'x', amount: 10, currency: 'ALL', date: '2026-09-01', approvalStatus: 'Submitted', createdByUserId: 'vera',
  }));
});

// ── M4. Role gates ─────────────────────────────────────────────────────────────
test('68a. WhatsApp agents, hosting servers and Momentum targets are Admin/Manager writes', async () => {
  const bob = staffOf('bob', MY_BIZ, MY_TEAM, ['member'], 'bob@mine.com');
  const admin = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertFails(setDoc(doc(bob, 'whatsappAccounts', 'waByBob'), { businessId: MY_BIZ, teamId: MY_TEAM, label: 'x', enabled: true, createdByUserId: 'bob' }));
  await assertSucceeds(setDoc(doc(admin, 'whatsappAccounts', 'waByAdmin'), { businessId: MY_BIZ, teamId: MY_TEAM, label: 'x', enabled: true, createdByUserId: 'alice' }));
  await assertFails(updateDoc(doc(bob, 'whatsappAccounts', 'waByAdmin'), { enabled: false }));
  await assertFails(deleteDoc(doc(bob, 'whatsappAccounts', 'waByAdmin')));
  await assertSucceeds(getDoc(doc(bob, 'whatsappAccounts', 'waByAdmin')));
  await assertFails(updateDoc(doc(admin, 'whatsappAccounts', 'waByAdmin'), { businessId: VICTIM_BIZ }));
  await assertFails(setDoc(doc(bob, 'hostingServers', 'srvByBob'), { businessId: MY_BIZ, teamId: MY_TEAM, name: 'x', hostname: 'h.al', username: 'root', status: 'Active' }));
  await assertFails(updateDoc(doc(bob, 'hostingServers', 'srvMine'), { hostname: 'evil.example' }));
  await assertSucceeds(updateDoc(doc(admin, 'hostingServers', 'srvMine'), { name: 'srv1 renamed' }));
  await assertFails(setDoc(doc(bob, 'productivitySettings', 'psByBob'), { businessId: MY_BIZ, teamId: MY_TEAM, targets: { tasksPerDay: 1 } }));
  await assertSucceeds(setDoc(doc(admin, 'productivitySettings', 'psByAdmin'), { businessId: MY_BIZ, teamId: MY_TEAM, targets: { tasksPerDay: 5 } }));
  await assertFails(updateDoc(doc(bob, 'productivitySettings', 'psByAdmin'), { targets: { tasksPerDay: 1 } }));
});

test('68b. a daily report is edited by its author or a manager — not by a colleague', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'dailyReports', 'drAlice'), { businessId: MY_BIZ, teamId: MY_TEAM, userId: 'alice', date: '2026-09-01', summary: 'ok' });
  });
  const bob = staffOf('bob', MY_BIZ, MY_TEAM, ['member'], 'bob@mine.com');
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member'], 'alice@mine.com');
  const boss = staffOf('boss', MY_BIZ, MY_TEAM, ['admin'], 'boss@mine.com');
  await assertFails(updateDoc(doc(bob, 'dailyReports', 'drAlice'), { summary: 'rewritten' }));
  await assertFails(deleteDoc(doc(bob, 'dailyReports', 'drAlice')));
  await assertFails(setDoc(doc(bob, 'dailyReports', 'drForAlice'), { businessId: MY_BIZ, teamId: MY_TEAM, userId: 'alice', date: '2026-09-02', createdByUserId: 'bob' }));
  await assertSucceeds(setDoc(doc(bob, 'dailyReports', 'drBob'), { businessId: MY_BIZ, teamId: MY_TEAM, userId: 'bob', date: '2026-09-02', createdByUserId: 'bob' }));
  await assertSucceeds(updateDoc(doc(alice, 'dailyReports', 'drAlice'), { summary: 'updated by author' }));
  await assertFails(updateDoc(doc(alice, 'dailyReports', 'drAlice'), { userId: 'bob' }));
  await assertSucceeds(updateDoc(doc(boss, 'dailyReports', 'drAlice'), { blockerResolvedAt: new Date() }));
});

test('68c. a Viewer creates no CRM/finance rows and bumps no invoice counter', async () => {
  const vera = staffOf('vera', MY_BIZ, MY_TEAM, ['viewer']);
  await assertFails(setDoc(doc(vera, 'invoices', 'invByViewer'), { businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', total: 1, status: 'Draft', createdByUserId: 'vera' }));
  await assertFails(setDoc(doc(vera, 'customers', 'custByViewer'), { businessId: MY_BIZ, teamId: MY_TEAM, name: 'x', email: 'x@x.com', createdByUserId: 'vera' }));
  await assertFails(setDoc(doc(vera, 'leads', 'leadByViewer'), { businessId: MY_BIZ, teamId: MY_TEAM, name: 'x', status: 'New', createdByUserId: 'vera' }));
  await assertFails(setDoc(doc(vera, 'projects', 'projByViewer'), { businessId: MY_BIZ, teamId: MY_TEAM, name: 'x', status: 'Active', createdByUserId: 'vera' }));
  await assertFails(updateDoc(doc(vera, 'customers', 'cust1'), { name: 'renamed by viewer' }));
  await assertFails(setDoc(doc(vera, 'counters', `invoices_${MY_TEAM}`), { last: 1 }, { merge: true }));
  await assertSucceeds(getDoc(doc(vera, 'customers', 'cust1')));
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member']);
  await assertSucceeds(setDoc(doc(alice, 'counters', `invoices_${MY_TEAM}`), { last: 1 }, { merge: true }));
});

// ── M5. Report history rows name their real actor ─────────────────────────────
test('69. versions / approvals / events are signed by the writer', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member'], 'alice@mine.com');
  await assertFails(setDoc(doc(alice, 'reportVersions', 'rvForged'), { businessId: MY_BIZ, teamId: MY_TEAM, reportId: 'r1', version: 1, reason: 'submitted', createdByUserId: 'zoe' }));
  await assertSucceeds(setDoc(doc(alice, 'reportVersions', 'rvOk'), { businessId: MY_BIZ, teamId: MY_TEAM, reportId: 'r1', version: 1, reason: 'submitted', createdByUserId: 'alice' }));
  await assertFails(setDoc(doc(alice, 'reportApprovals', 'raForged'), { businessId: MY_BIZ, teamId: MY_TEAM, reportId: 'r1', version: 1, stage: 'internal', decision: 'approved', approverUserId: 'zoe', createdByUserId: 'alice' }));
  await assertSucceeds(setDoc(doc(alice, 'reportApprovals', 'raOk'), { businessId: MY_BIZ, teamId: MY_TEAM, reportId: 'r1', version: 1, stage: 'internal', decision: 'approved', approverUserId: 'alice', createdByUserId: 'alice' }));
  await assertFails(setDoc(doc(alice, 'reportEvents', 'reForged'), { businessId: MY_BIZ, teamId: MY_TEAM, reportId: 'r1', kind: 'approved', actorUserId: 'zoe', actorType: 'staff', createdByUserId: 'alice' }));
  await assertSucceeds(setDoc(doc(alice, 'reportEvents', 'reOk'), { businessId: MY_BIZ, teamId: MY_TEAM, reportId: 'r1', kind: 'approved', actorUserId: 'alice', actorType: 'staff', createdByUserId: 'alice' }));
});

// ── M6. conversations: the portal's write is an activity bump, nothing else ────
test('70. a portal client cannot re-own or re-watch their thread; staff cannot re-tenant it', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'conversations', 'client-cust1'), {
      businessId: MY_BIZ, teamId: MY_TEAM, customerId: 'cust1', channel: 'portal', ownerId: 'alice', watchers: ['alice'], status: 'open',
    });
  });
  const carol = portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ);
  await assertFails(updateDoc(doc(carol, 'conversations', 'client-cust1'), { ownerId: 'carol' }));
  await assertFails(updateDoc(doc(carol, 'conversations', 'client-cust1'), { watchers: ['carol'] }));
  await assertFails(updateDoc(doc(carol, 'conversations', 'client-cust1'), { slaBreachNotified: true }));
  await assertSucceeds(updateDoc(doc(carol, 'conversations', 'client-cust1'), { lastMessageAt: new Date(), awaitingReply: true }));
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member'], 'alice@mine.com');
  await assertFails(updateDoc(doc(alice, 'conversations', 'client-cust1'), { businessId: VICTIM_BIZ }));
  await assertSucceeds(updateDoc(doc(alice, 'conversations', 'client-cust1'), { status: 'closed' }));
  // A portal client creating a thread stamped with another tenant — refused.
  await assertFails(setDoc(doc(carol, 'conversations', 'client-cust1-project-p9'), { businessId: VICTIM_BIZ, customerId: 'cust1', channel: 'portal', watchers: [] }));
});

// ── M7. userProfiles: your name goes into YOUR tenant's directory only ─────────
test('71. a profile is planted only in a tenant the user belongs to, and never moves', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member'], 'alice@mine.com');
  await assertFails(setDoc(doc(alice, 'userProfiles', 'upAliceHop'), { userId: 'alice', displayName: 'CEO', businessId: VICTIM_BIZ, teamId: VICTIM_TEAM }));
  await assertSucceeds(setDoc(doc(alice, 'userProfiles', 'upAlice'), { userId: 'alice', displayName: 'Alice', businessId: MY_BIZ, teamId: MY_TEAM }));
  await assertFails(updateDoc(doc(alice, 'userProfiles', 'upAlice'), { businessId: VICTIM_BIZ }));
  await assertFails(updateDoc(doc(alice, 'userProfiles', 'upAlice'), { userId: 'zoe' }));
  await assertSucceeds(updateDoc(doc(alice, 'userProfiles', 'upAlice'), { customStatus: 'në takim', lastSeen: new Date() }));
  // JoinInviteView: right after /api/accept-invite created the membership, before the claims refresh.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teamMembers', `${MY_TEAM}_joiner`), { userId: 'joiner', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Member', status: 'Active' });
  });
  const joiner = testEnv.authenticatedContext('joiner', { email: 'joiner@mine.com' }).firestore();
  await assertSucceeds(setDoc(doc(joiner, 'userProfiles', 'upJoiner'), { userId: 'joiner', displayName: 'J', teamId: MY_TEAM, businessId: MY_BIZ, createdByUserId: 'joiner' }));
  await assertFails(setDoc(doc(joiner, 'userProfiles', 'upJoinerHop'), { userId: 'joiner', displayName: 'J', teamId: VICTIM_TEAM, businessId: VICTIM_BIZ, createdByUserId: 'joiner' }));
});

// ── M8. An Inactive membership grants nothing through the users/{uid} fallback ──
test('72. an off-boarded (Inactive) member with a stale users marker reads nothing', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'teamMembers', `${MY_TEAM}_gone`), { userId: 'gone', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Member', status: 'Inactive' });
    await setDoc(doc(db, 'users', 'gone'), { teamId: MY_TEAM, businessId: MY_BIZ });
  });
  const gone = testEnv.authenticatedContext('gone', { email: 'gone@mine.com' }).firestore();
  await assertFails(getDoc(doc(gone, 'customers', 'cust1')));
  await assertFails(getDoc(doc(gone, 'services', 'svcMine')));
  await assertFails(getDocs(query(collection(gone, 'invoices'), where('businessId', '==', MY_BIZ))));
  // The same fallback still works for an ACTIVE member without claims (finn, seeded in 10g).
  const finn = testEnv.authenticatedContext('finn', { email: 'finn@mine.com' }).firestore();
  await assertSucceeds(getDoc(doc(finn, 'services', 'svcMine')));
});

// ── L. notifications: the deep link is a path ──────────────────────────────────
test('73. a notification actionUrl must be an in-app path', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['member'], 'alice@mine.com');
  await assertFails(setDoc(doc(alice, 'notifications', 'nSelfEvil'), { userId: 'alice', type: 'task_assigned', title: 'Klikoni', actionUrl: 'https://evil.example/login', businessId: MY_BIZ }));
  await assertFails(setDoc(doc(alice, 'notifications', 'nSelfJs'), { userId: 'alice', type: 'task_assigned', title: 'Klikoni', actionUrl: 'javascript:alert(1)', businessId: MY_BIZ }));
  await assertSucceeds(setDoc(doc(alice, 'notifications', 'nSelfOk'), { userId: 'alice', type: 'task_assigned', title: 'Detyrë', actionUrl: '/app/tasks?task=t1', businessId: MY_BIZ }));
  await assertSucceeds(setDoc(doc(alice, 'notifications', 'nSelfNoUrl'), { userId: 'alice', type: 'task_assigned', title: 'Detyrë', businessId: MY_BIZ }));
});

// ── An UNVERIFIED e-mail is not identity anywhere (staff side) ─────────────────
test('74. an unverified password sign-up with a colleague\'s address reads no invite token and claims no seat', async () => {
  // Same address as the pending victim invite (17d) and as dora's legacy e-mail-keyed row (41).
  const impostor = unverifiedUser('impostor', 'someone@victim.com');
  await assertFails(getDoc(doc(impostor, 'teamInvites', 'invVictim')));
  await assertFails(getDocs(query(collection(impostor, 'teamInvites'), where('email', '==', 'someone@victim.com'), where('status', '==', 'Pending'))));
  await assertFails(updateDoc(doc(impostor, 'teamInvites', 'invVictim'), { status: 'Accepted', acceptedByUserId: 'impostor' }));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teamMembers', `${MY_TEAM}_greta@mine.com`), {
      userId: 'greta@mine.com', email: 'greta@mine.com', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Member', status: 'Active',
    });
  });
  const fakeGreta = unverifiedUser('fakeGreta', 'greta@mine.com');
  await assertFails(getDoc(doc(fakeGreta, 'teamMembers', `${MY_TEAM}_greta@mine.com`)));
  await assertFails(updateDoc(doc(fakeGreta, 'teamMembers', `${MY_TEAM}_greta@mine.com`), { userId: 'fakeGreta' }));
  // The verified owner of the address still self-heals (41) and reads their invite (17d).
  const greta = verifiedUser('gretaUid', 'greta@mine.com');
  await assertSucceeds(getDoc(doc(greta, 'teamMembers', `${MY_TEAM}_greta@mine.com`)));
  await assertSucceeds(updateDoc(doc(greta, 'teamMembers', `${MY_TEAM}_greta@mine.com`), { userId: 'gretaUid' }));
});
