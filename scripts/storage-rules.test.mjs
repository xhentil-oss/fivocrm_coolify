/**
 * Rules-unit tests for `storage.rules` — Firebase Storage is NOT used by the app
 * (every upload goes to the VPS via useFileUpload), so the bucket is deny-all.
 * These tests pin that: no read, no write, for anyone, on any path — signed in,
 * anonymous, staff claims or super-admin alike.
 *
 * Run (needs the Storage emulator, JDK 21 like the Firestore suite):
 *   firebase emulators:exec --only storage --project fivocrm-rules-test \
 *     "node --test scripts/storage-rules.test.mjs"
 *
 * If Firebase Storage is ever re-adopted, replace these with the tenant-scoped
 * template commented at the bottom of storage.rules and test the claim paths
 * (`tid` / `bid` / `pbid`) the same way scripts/firestore-rules.test.mjs does.
 */
import { readFileSync } from 'node:fs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';

const PROJECT_ID = 'fivocrm-rules-test';
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });
  // Seed one object with rules disabled so the READ assertions hit a real file.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), 'teamMine/chat-attachments/seed.png'), new Uint8Array([137, 80, 78, 71]), { contentType: 'image/png' });
  });
});

after(async () => { await testEnv?.cleanup(); });

const png = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

test('S1. the rules file is deny-all (no `allow` other than `if false`)', () => {
  const src = readFileSync('storage.rules', 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const allows = [...src.matchAll(/allow\s+[a-z, ]+:\s*if\s+([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(allows.length >= 1, 'expected at least one allow statement');
  for (const cond of allows) assert.equal(cond, 'false', `storage.rules must be deny-all, found: allow … if ${cond}`);
});

test('S2. an anonymous visitor cannot read or write', async () => {
  const anon = testEnv.unauthenticatedContext().storage();
  await assertFails(getBytes(ref(anon, 'teamMine/chat-attachments/seed.png')));
  await assertFails(getDownloadURL(ref(anon, 'teamMine/chat-attachments/seed.png')));
  await assertFails(uploadBytes(ref(anon, 'teamMine/chat-attachments/anon.png'), png(), { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(anon, 'shared/avatars/anon.png'), png(), { contentType: 'image/png' }));
});

test('S3. a signed-in staff user (with tenant claims) cannot read, write, list or delete — any tenant path', async () => {
  const alice = testEnv.authenticatedContext('alice', { email: 'alice@mine.com', bid: 'bizMine', tid: 'teamMine', roles: ['admin'] }).storage();
  await assertFails(getBytes(ref(alice, 'teamMine/chat-attachments/seed.png')));
  await assertFails(uploadBytes(ref(alice, 'teamMine/chat-attachments/mine.png'), png(), { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(alice, 'teamVictim/chat-attachments/planted.pdf'), png(), { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(alice, 'shared/avatars/mine.png'), png(), { contentType: 'image/png' }));
  await assertFails(listAll(ref(alice, 'teamMine/chat-attachments')));
  await assertFails(deleteObject(ref(alice, 'teamMine/chat-attachments/seed.png')));
});

test('S4. a portal client and the platform super-admin are refused too', async () => {
  const carol = testEnv.authenticatedContext('carol', { email: 'carol@client.com', cid: 'cust1', pbid: 'bizMine' }).storage();
  await assertFails(getBytes(ref(carol, 'teamMine/chat-attachments/seed.png')));
  await assertFails(uploadBytes(ref(carol, 'teamMine/portal/carol.png'), png(), { contentType: 'image/png' }));
  const sa = testEnv.authenticatedContext('root', { email: 'root@fivo.al', superAdmin: true }).storage();
  await assertFails(getBytes(ref(sa, 'teamMine/chat-attachments/seed.png')));
  await assertFails(uploadBytes(ref(sa, 'teamMine/chat-attachments/root.png'), png(), { contentType: 'image/png' }));
});
