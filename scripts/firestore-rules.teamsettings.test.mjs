/**
 * Regression tests for `businessOfTeam()` — the helper that was CALLED in four
 * places but never DECLARED.
 *
 * The rules compiler reports an undefined call only as a warning ("Invalid function
 * name"), so `firebase deploy` succeeds. At runtime the expression errors and an
 * errored condition DENIES — meaning `teamSettings` reads/writes and the
 * invoice-number `counters` would have been dead for every user once the rules went
 * live. Compilation success is therefore not evidence; these tests are.
 *
 * Run:
 *   npx firebase-tools@13.35.1 emulators:exec --only firestore \
 *     --project fivocrm-teamsettings-rules-test \
 *     "node --test scripts/firestore-rules.teamsettings.test.mjs"
 */
import { readFileSync } from 'node:fs';
import { test, before, after } from 'node:test';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';

const PROJECT_ID = 'fivocrm-teamsettings-rules-test';
const MY_BIZ = 'bizMine';
const MY_TEAM = 'teamMine';
const VICTIM_BIZ = 'bizVictim';
const VICTIM_TEAM = 'teamVictim';

let testEnv;

const staffOf = (uid, bid, tid, roles = ['member'], email = `${uid}@x.com`) =>
  testEnv.authenticatedContext(uid, { email, bid, tid, roles }).firestore();
const portalOf = (uid, cid, email, pbid = MY_BIZ) =>
  testEnv.authenticatedContext(uid, { email, cid, pbid }).firestore();

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, 'businesses', MY_BIZ), { name: 'Mine', ownerId: 'owner', status: 'active' });
    await setDoc(doc(db, 'businesses', VICTIM_BIZ), { name: 'Victim', ownerId: 'vowner', status: 'active' });

    // A team LIVES INSIDE a business — businessOfTeam() resolves through this field.
    await setDoc(doc(db, 'teams', MY_TEAM), { businessId: MY_BIZ, createdByUserId: 'owner', name: 'Mine' });
    await setDoc(doc(db, 'teams', VICTIM_TEAM), { businessId: VICTIM_BIZ, createdByUserId: 'vowner' });

    await setDoc(doc(db, 'teamMembers', `${MY_TEAM}_alice`), {
      userId: 'alice', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Admin', status: 'Active',
    });
    // A plain member of the business who is NOT in the team — the case that only
    // works if businessOfTeam() actually resolves.
    await setDoc(doc(db, 'teamMembers', `${MY_TEAM}_bob`), {
      userId: 'bob', teamId: MY_TEAM, businessId: MY_BIZ, role: 'Member', status: 'Active',
    });
    await setDoc(doc(db, 'customers', 'cust1'), { businessId: MY_BIZ, email: 'carol@client.com' });
    await setDoc(doc(db, 'users', 'alice'), { teamId: MY_TEAM, businessId: MY_BIZ });
    await setDoc(doc(db, 'users', 'carol'), { customerId: 'cust1' });

    await setDoc(doc(db, 'teamSettings', MY_TEAM), {
      companyName: 'Fivo', bankAccounts: [], hasEmailApiKey: true,
    });
    await setDoc(doc(db, 'teamSettings', VICTIM_TEAM), { companyName: 'Victim Ltd' });

    await setDoc(doc(db, 'counters', `invoices_${MY_TEAM}`), { seq: 42 });
    await setDoc(doc(db, 'counters', `invoices_${VICTIM_TEAM}`), { seq: 7 });
  });
});

after(async () => {
  await testEnv?.cleanup();
});

// ── T1. teamSettings must be READABLE inside the tenant (the regression) ──
test('T1a. staff of the business reads its own teamSettings', async () => {
  await assertSucceeds(getDoc(doc(staffOf('alice', MY_BIZ, MY_TEAM, ['admin']), 'teamSettings', MY_TEAM)));
});

test('T1b. a business member NOT in the team still reads it (businessOfTeam path)', async () => {
  // `tid` is deliberately another team: this clause can only pass if
  // businessOfTeam(MY_TEAM) resolves to MY_BIZ. With the helper undefined this
  // errored and denied.
  await assertSucceeds(getDoc(doc(staffOf('bob', MY_BIZ, 'teamOther', ['member']), 'teamSettings', MY_TEAM)));
});

test('T1c. a portal client of the business reads it (upload host lookup)', async () => {
  await assertSucceeds(getDoc(doc(portalOf('carol', 'cust1', 'carol@client.com', MY_BIZ), 'teamSettings', MY_TEAM)));
});

test('T1d. cross-tenant teamSettings read is still denied', async () => {
  await assertFails(getDoc(doc(staffOf('alice', MY_BIZ, MY_TEAM, ['admin']), 'teamSettings', VICTIM_TEAM)));
});

// ── T2. teamSettings writes: admins yes, credentials never ──
test('T2a. a business admin may write non-secret settings', async () => {
  await assertSucceeds(setDoc(doc(staffOf('alice', MY_BIZ, MY_TEAM, ['admin']), 'teamSettings', MY_TEAM),
    { companyName: 'Fivo Shpk' }, { merge: true }));
});

test('T2b. credentials can never be written here, even by an admin', async () => {
  await assertFails(setDoc(doc(staffOf('alice', MY_BIZ, MY_TEAM, ['admin']), 'teamSettings', MY_TEAM),
    { emailApiKey: 'sk-live-123' }, { merge: true }));
});

test('T2c. a plain member cannot write settings', async () => {
  await assertFails(setDoc(doc(staffOf('bob', MY_BIZ, MY_TEAM, ['member']), 'teamSettings', MY_TEAM),
    { companyName: 'Hijack' }, { merge: true }));
});

test('T2d. cross-tenant settings write is denied', async () => {
  await assertFails(setDoc(doc(staffOf('alice', MY_BIZ, MY_TEAM, ['admin']), 'teamSettings', VICTIM_TEAM),
    { companyName: 'Hijack' }, { merge: true }));
});

// ── T3. counters: invoice numbering must keep working ──
test('T3a. staff read + bump their own invoice counter', async () => {
  const alice = staffOf('alice', MY_BIZ, MY_TEAM, ['admin']);
  await assertSucceeds(getDoc(doc(alice, 'counters', `invoices_${MY_TEAM}`)));
  await assertSucceeds(setDoc(doc(alice, 'counters', `invoices_${MY_TEAM}`), { seq: 43 }, { merge: true }));
});

test('T3b. a business member outside the team can still bump it (businessOfTeam path)', async () => {
  await assertSucceeds(setDoc(doc(staffOf('bob', MY_BIZ, 'teamOther', ['member']), 'counters', `invoices_${MY_TEAM}`),
    { seq: 44 }, { merge: true }));
});

test('T3c. another tenant cannot read or bump our counter', async () => {
  const mallory = staffOf('mallory', VICTIM_BIZ, VICTIM_TEAM, ['admin']);
  await assertFails(getDoc(doc(mallory, 'counters', `invoices_${MY_TEAM}`)));
  await assertFails(setDoc(doc(mallory, 'counters', `invoices_${MY_TEAM}`), { seq: 999 }, { merge: true }));
});

// ── T4. fail-closed on an unresolvable team ──
test('T4. an unknown teamId resolves to no business and is denied', async () => {
  // businessOfTeam('teamGhost') → '' and isBusinessMember('') is false.
  await assertFails(getDoc(doc(staffOf('alice', MY_BIZ, MY_TEAM, ['admin']), 'teamSettings', 'teamGhost')));
});
