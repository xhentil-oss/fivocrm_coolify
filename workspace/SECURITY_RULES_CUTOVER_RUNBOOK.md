# Tenant-isolation rules cutover — RUNBOOK (must be emulator-tested)

This is the ONE remaining step of the tenant-takeover fix. The code half is already
shipped (see "Shipped" below). This step flips `firestore.rules` so that the tenant key
can no longer be spoofed. **Do NOT deploy these rules blind** — a logic error locks every
tenant out. Follow the order and run the emulator tests first.

## Why a runbook and not an auto-applied edit
The takeover works because `isBusinessMember(b)` trusts `users/{uid}.businessId`, which is
client-writable. To stop trusting it, the rules must *validate* the tenant key against a
real membership — but `teamMembers` used random doc ids, so rules couldn't `get()` a
membership deterministically. The fix requires (a) all memberships keyed `{teamId}_{uid}`,
(b) a data backfill of existing random-keyed memberships, and (c) locking
`teamMembers.create`. That's a migration + multi-deploy — inherently staged.

## Shipped (already in this branch — safe, additive, no rules dependency yet)
- `api/accept-invite.ts` — server-side invite acceptance (Admin SDK). Validates token +
  **hard email match**, writes the membership with the deterministic id `{teamId}_{uid}`,
  sets `users/{uid}` tenant keys server-side. This is the piece that lets
  `teamMembers.create` be locked to owner-only.
- `JoinInviteView.tsx` — now calls `/api/accept-invite` first; falls back to the legacy
  client flow on 5xx/network so it works BEFORE the rules are hardened.
- `src/lib/createTenant.ts` already writes the owner membership as `{teamId}_{uid}`.
- API relay/authz hardening (send-invoice / checkout / lead-reminder / notification).

## Step 1 — Backfill existing memberships to `{teamId}_{uid}`
Add a one-shot job (mirror the existing `backfill-businessid` in `api/cron/run.ts`):
for every `teamMembers` doc whose id !== `{teamId}_{uid}`, copy it to the deterministic id
(Admin SDK), then delete the old doc. Verify counts before/after. Keep a dry-run mode.
Until this completes, users with legacy-keyed memberships would fail the hardened `users`
rule — so this MUST finish first.

## Step 2 — Deploy the app (Vercel) — already contains the endpoint + wiring
Push this branch. Vercel deploys app + `api/*` atomically. Verify `/api/accept-invite`
works in production (accept a test invite) BEFORE touching rules.

## Step 3 — Apply + emulator-test the hardened rules, THEN deploy
Add these helpers and swap the four rules below. Test with
`@firebase/rules-unit-testing` against `firebase emulators:start --only firestore`.

```
// helpers
function membershipRef(teamId, uid) {
  return /databases/$(database)/documents/teamMembers/$(teamId + '_' + uid);
}
function teamKeyOk(userId) {
  // Changing team/business requires BOTH keys present and matching a real membership.
  return (!('teamId' in request.resource.data) && !('businessId' in request.resource.data))
    || (request.resource.data.teamId is string
        && exists(membershipRef(request.resource.data.teamId, userId))
        && get(membershipRef(request.resource.data.teamId, userId)).data.businessId
             == request.resource.data.businessId);
}
function customerKeyOk(userId) {
  // Portal clients set customerId + the tenant's businessId. Validate via the customer's email.
  return !('customerId' in request.resource.data)
    || (request.resource.data.customerId is string
        && exists(/databases/$(database)/documents/customers/$(request.resource.data.customerId))
        && request.auth.token.email != null
        && get(/databases/$(database)/documents/customers/$(request.resource.data.customerId)).data.email
             == request.auth.token.email.lower());
}

// users: tenant keys validated, not trusted
match /users/{userId} {
  allow read: if isAuth() && request.auth.uid == userId;
  allow create, update: if request.auth.uid == userId
    && (isSuperAdmin() || (teamKeyOk(userId) && customerKeyOk(userId)));
}

// teamMembers: only the team owner creates client-side; invites go through api/accept-invite (Admin SDK)
match /teamMembers/{docId} {
  allow read: if isAuth();
  allow create: if isTeamOwner(request.resource.data.teamId);   // was: if isAuth()
  allow update: if isAuth() && ( /* keep existing self-safe-fields + owner branches */ );
  allow delete: if isAuth() && (resource.data.userId == request.auth.uid || isTeamOwner(resource.data.teamId));
}
```
Note: `customerKeyOk` intentionally does NOT constrain `businessId` for the portal path
beyond the customer-email proof; if you want to also pin the portal `businessId`, compare
it to the customer doc's `businessId` in `customerKeyOk`.

### Required emulator tests (all must pass before deploy)
1. Attacker sets `users/{self}.businessId = victimBiz` → **DENIED**.
2. Attacker `create teamMembers/{victimTeam}_{self}` as Admin → **DENIED**.
3. Legit member login: `users` write with their real `{teamId,businessId}` → **ALLOWED**.
4. Legit team switch (member of both) → **ALLOWED** for either team.
5. Super-admin switches to a team they don't belong to → **ALLOWED** (claim bypass).
6. Portal client sets `users.customerId` for their own customer (email match) → **ALLOWED**;
   for someone else's customer → **DENIED**.
7. Invite accept via `/api/accept-invite` (Admin SDK) → membership created; the same
   create attempted directly by the client → **DENIED**.

## Step 4 — Follow-up (separate, lower severity)
- Scope the portal `services` query by `businessId`, then tighten the `services` read rule.
- Split sensitive `teamSettings` fields (bank/Meta) out before restricting its read.
- Move the public `portalSubdomain → businessId` mapping to a minimal public collection so
  the rest of `businesses` read can be restricted.
- Scope `directMessages` / `channels` / `counters` by businessId (refactor unread-sweep queries first).
