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
