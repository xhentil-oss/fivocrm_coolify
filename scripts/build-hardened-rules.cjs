#!/usr/bin/env node
/**
 * Generates `firestore.rules.hardened` from the live `firestore.rules` by patching in
 * the tenant-isolation hardening (see workspace/SECURITY_RULES_CUTOVER_RUNBOOK.md).
 *
 * Why a generator instead of a checked-in second copy: the hardened file stays in sync
 * with the live rules automatically, and there's no risk of a transcription error in a
 * 700-line hand-copied file. Run this, review the diff, load the output into the Firestore
 * emulator, run the rules tests, and only then replace firestore.rules with it.
 *
 *   node scripts/build-hardened-rules.cjs
 *   diff firestore.rules firestore.rules.hardened
 *
 * PREREQUISITE: run the `backfill-member-keys` cron job first so every teamMembers doc is
 * keyed `{teamId}_{uid}` — the hardened users rule validates tenant keys via exists() on
 * that deterministic id.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'firestore.rules');
const OUT = path.join(__dirname, '..', 'firestore.rules.hardened');

// Normalize to LF so multi-line anchors match regardless of the source's line endings.
let rules = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

function replaceOnce(haystack, needle, replacement, label) {
  const idx = haystack.indexOf(needle);
  if (idx === -1) throw new Error(`Anchor not found for "${label}". The live rules changed — update this script.`);
  if (haystack.indexOf(needle, idx + needle.length) !== -1) {
    throw new Error(`Anchor for "${label}" is not unique — refusing to patch ambiguously.`);
  }
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
}

// 1) Insert tenant-key validation helpers before the team-scoped collections section.
const HELPERS_ANCHOR = '    // ── Team-Scoped Collections ──';
const HELPERS = `    // ── Tenant-key validation (hardened cutover) ──
    // The tenant boundary must NOT trust a client-written users/{uid}.businessId.
    // These validate that the tenant keys a user writes to their own doc correspond to
    // a REAL membership (deterministically keyed {teamId}_{uid}) or, for portal clients,
    // to a customer whose email matches their verified token email.
    function membershipRef(teamId, uid) {
      return /databases/$(database)/documents/teamMembers/$(teamId + '_' + uid);
    }
    function usersTeamKeyOk(userId) {
      // Changing team/business requires BOTH keys present and matching a real membership.
      return (!('teamId' in request.resource.data) && !('businessId' in request.resource.data))
        || (request.resource.data.teamId is string
            && exists(membershipRef(request.resource.data.teamId, userId))
            && get(membershipRef(request.resource.data.teamId, userId)).data.businessId
                 == request.resource.data.businessId);
    }
    function usersCustomerKeyOk(userId) {
      return !('customerId' in request.resource.data)
        || (request.resource.data.customerId is string
            && exists(/databases/$(database)/documents/customers/$(request.resource.data.customerId))
            && request.auth.token.email != null
            && get(/databases/$(database)/documents/customers/$(request.resource.data.customerId)).data.email
                 == request.auth.token.email.lower());
    }

${HELPERS_ANCHOR}`;
rules = replaceOnce(rules, HELPERS_ANCHOR, HELPERS, 'insert helpers');

// 2) Lock teamMembers.create to the team owner (invites go through api/accept-invite).
const TM_ANCHOR = `    match /teamMembers/{docId} {
      allow read: if isAuth();
      allow create: if isAuth();`;
const TM_REPLACEMENT = `    match /teamMembers/{docId} {
      allow read: if isAuth();
      // HARDENED: only the team owner may create memberships client-side. The one
      // legitimate non-owner path — accepting an invite — goes through the Admin SDK
      // (api/accept-invite), which validates the token + email and bypasses rules.
      allow create: if isTeamOwner(request.resource.data.teamId) || isSuperAdmin();`;
rules = replaceOnce(rules, TM_ANCHOR, TM_REPLACEMENT, 'teamMembers.create');

// 3) Harden the users doc: tenant keys are validated, not trusted.
const USERS_ANCHOR = `    match /users/{userId} {
      allow read: if isAuth() && request.auth.uid == userId;
      allow write: if isAuth() && request.auth.uid == userId;
    }`;
const USERS_REPLACEMENT = `    match /users/{userId} {
      allow read: if isAuth() && request.auth.uid == userId;
      // HARDENED: a user may write their own doc, but may only set the tenant keys
      // (teamId/businessId/customerId) to values backed by a real membership / their
      // own customer. Super-admins (claim) bypass. This is what stops an attacker from
      // self-attesting into a victim tenant via users/{uid}.businessId.
      allow create, update: if request.auth.uid == userId
        && (isSuperAdmin() || (usersTeamKeyOk(userId) && usersCustomerKeyOk(userId)));
    }`;
rules = replaceOnce(rules, USERS_ANCHOR, USERS_REPLACEMENT, 'users rule');

fs.writeFileSync(OUT, rules, 'utf8');
console.log(`✓ Wrote ${OUT}`);
console.log('  Next: diff firestore.rules firestore.rules.hardened, load into the emulator,');
console.log('  run the rules tests, then replace firestore.rules and deploy (app first!).');
