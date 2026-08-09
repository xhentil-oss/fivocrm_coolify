/** Reproduction + regression: the invited-staff path (join page, identity bootstrap). */
import { readFileSync } from 'node:fs';
import { test, before, after } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';

const PROJECT_ID = 'fivocrm-rules-test';
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'businesses', 'biz1'), { name: 'Fivo', status: 'active' });
    await setDoc(doc(db, 'teams', 'team1'), { businessId: 'biz1', createdByUserId: 'owner1', name: 'Ekipi Social Media' });
    await setDoc(doc(db, 'teamInvites', 'inv1'), {
      email: 'migena@fivo.al', teamId: 'team1', businessId: 'biz1', teamName: 'Ekipi Social Media',
      role: 'Member', status: 'Pending', token: 'tok1', invitedByUserId: 'owner1',
      expiresAt: new Date(Date.now() + 7 * 864e5),
    });
    // Someone else's invite — must stay invisible to her.
    await setDoc(doc(db, 'teamInvites', 'inv2'), {
      email: 'dikushtjeter@fivo.al', teamId: 'team1', businessId: 'biz1',
      role: 'Admin', status: 'Pending', token: 'tok2', invitedByUserId: 'owner1',
      expiresAt: new Date(Date.now() + 7 * 864e5),
    });
    await setDoc(doc(db, 'teamMembers', 'team1_owner1'), {
      userId: 'owner1', email: 'owner@fivo.al', teamId: 'team1', businessId: 'biz1',
      role: 'Admin', status: 'Active', monthlySalary: 120000,
    });
    // She was auto-provisioned as a PORTAL CLIENT on first login (the reported bug).
    await setDoc(doc(db, 'customers', 'cust1'), { businessId: 'biz1', email: 'migena@fivo.al' });
    await setDoc(doc(db, 'users', 'migena'), { customerId: 'cust1' });
  });
});

after(async () => { await testEnv.cleanup(); });

const asMigena = () => testEnv.authenticatedContext('migena', { email: 'migena@fivo.al', email_verified: true }).firestore();

test('JoinInviteView lookup: token + own email → allowed', async () => {
  const db = asMigena();
  const snap = await assertSucceeds(getDocs(query(collection(db, 'teamInvites'),
    where('token', '==', 'tok1'), where('email', '==', 'migena@fivo.al'))));
  if (snap.size !== 1) throw new Error(`expected 1 invite, got ${snap.size}`);
});

test('token-only lookup stays denied (rules are not filters)', async () => {
  const db = asMigena();
  await assertFails(getDocs(query(collection(db, 'teamInvites'), where('token', '==', 'tok1'))));
});

test('cannot read someone else\'s invite by token+their email', async () => {
  const db = asMigena();
  await assertFails(getDocs(query(collection(db, 'teamInvites'),
    where('token', '==', 'tok2'), where('email', '==', 'dikushtjeter@fivo.al'))));
});

test('staffIdentity: own pending invites by email → allowed', async () => {
  const db = asMigena();
  await assertSucceeds(getDocs(query(collection(db, 'teamInvites'),
    where('email', '==', 'migena@fivo.al'))));
});

test('identity bootstrap: teamMembers where userId == uid (no membership yet)', async () => {
  const db = asMigena();
  await assertSucceeds(getDocs(query(collection(db, 'teamMembers'),
    where('userId', '==', 'migena'))));
});

test('identity bootstrap: teamMembers where email == own address', async () => {
  const db = asMigena();
  await assertSucceeds(getDocs(query(collection(db, 'teamMembers'),
    where('email', '==', 'migena@fivo.al'))));
});

test('still cannot list a colleague\'s membership (salary stays private)', async () => {
  const db = asMigena();
  await assertFails(getDocs(query(collection(db, 'teamMembers'),
    where('email', '==', 'owner@fivo.al'))));
});

test('identity bootstrap works once the membership exists', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teamMembers', 'team1_migena'), {
      userId: 'migena', email: 'migena@fivo.al', teamId: 'team1', businessId: 'biz1',
      role: 'Member', status: 'Active',
    });
  });
  const db = asMigena();
  const a = await assertSucceeds(getDocs(query(collection(db, 'teamMembers'), where('userId', '==', 'migena'))));
  if (a.size !== 1) throw new Error(`expected own membership, got ${a.size}`);
});

test('invitee may mark their own invite Accepted', async () => {
  const db = asMigena();
  await assertSucceeds(updateDoc(doc(db, 'teamInvites', 'inv1'), {
    status: 'Accepted', acceptedByUserId: 'migena', acceptedAt: new Date(), updatedAt: new Date(),
  }));
});

test('invitee may NOT touch someone else\'s invite', async () => {
  const db = asMigena();
  await assertFails(updateDoc(doc(db, 'teamInvites', 'inv2'), { status: 'Accepted' }));
});
