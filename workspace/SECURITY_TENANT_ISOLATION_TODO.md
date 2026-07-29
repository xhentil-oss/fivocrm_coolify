# CRITICAL — Firestore rules tenant-isolation remediation

> ## ⚠️ SUPERSEDED — see `workspace/TENANT_ISOLATION_ENTERPRISE.md`
>
> Every item below is now **RESOLVED** (Jul 2026 enterprise-hardening pass), and the
> "Root cause" section is out of date in two ways:
>
> 1. `users/{uid}` is no longer freely self-writable — the Jul 20 cutover validates the
>    tenant keys on write (`usersTenantOk`), and the boundary now comes from
>    server-minted custom claims (`bid`/`tid`/`roles`/`cid`/`pbid`) with the users doc
>    only as a membership-backed fallback.
> 2. The vector that actually stayed open was not self-attestation but **invite forgery**:
>    `teamInvites` was client-creatable, so a forged invite + `/api/accept-invite`
>    granted an Admin membership in any tenant. That is fixed (provenance check +
>    locked invite rules), together with the credential leak via `teamSettings`, the
>    staff/salary leak via `teamMembers`, and all ~15 remaining `read: if isAuth()`
>    collections.
>
> Keep this file only as the historical record of the audit. The current architecture,
> the residual work (compensation split), and the DEPLOY RUNBOOK live in
> `workspace/TENANT_ISOLATION_ENTERPRISE.md`.

---

> Found in the Jul 2026 full-platform QA/security audit. These are the highest-severity
> findings, but they **cannot be safely deployed blind** — a bad `firestore.rules`
> deploy locks real tenants out of production. Each item below needs a coordinated
> app change + Firestore-emulator test before `firebase deploy --only firestore:rules`.
>
> The contained, safely-shippable half of the audit (API endpoints) is **already fixed**
> — see the "Done" section at the bottom.

## Root cause

The tenant boundary functions `isBusinessMember()` / `isTeamMember()` / `isPortalClientFor()`
(`firestore.rules:49-103`) decide access purely by reading `users/{uid}.businessId` /
`.teamId` / `.customerId` — and `users/{uid}` is **fully self-writable** (`rules:701-704`).
An attacker signs up, sets `users/{myUid}.businessId = <victimBiz>` via the raw SDK, and
`isBusinessMember(victimBiz)` returns true → full read/write/delete of that tenant's
customers, invoices, leads, quotes, expenses, contracts, projects, tasks.

The discovery surface that makes this trivial is also open (`read: if isAuth()`):
`businesses`, `teamMembers`, `teamInvites`, `teamSettings`, `services`, `counters`,
`directMessages`, `channels`.

`users` can't be validated at the rules layer today because `teamMembers` uses random
doc IDs — rules can't `get()` a membership by a deterministic path to corroborate the
self-attestation. So the fix is architectural, not a one-line rule edit.

## Fix plan (in order)

### 1. Move the tenant key to a server-set custom claim  ← the real fix
- Extend `scripts/set-super-admin-claims.cjs` (or a Cloud Function triggered on
  teamMembers create/delete) to set `businessId` / `teamId` custom claims from the
  user's **actual** membership.
- Change `isBusinessMember(b)` to `request.auth.token.businessId == b` and
  `isTeamMember(t)` to `request.auth.token.teamId == t`.
- Force a token refresh (`getIdToken(true)`) after membership changes.
- Then `users/{uid}` self-writes no longer grant any access — the hole closes.

### 2. Lock `teamMembers.create` (privilege escalation → self-insert as Admin)
- Route invite-acceptance and new-team-owner membership creation through an Admin-SDK
  endpoint (Cloud Function / Vercel fn). Client `create` becomes deny.
- JoinInviteView (`handleAccept`) and RegisterView / createTenant currently `addDoc`
  memberships client-side — they must call the endpoint instead.

### 3. Validate invite acceptance server-side (`teamInvites`)
- Restrict `teamInvites` read to the team owner / an Admin-SDK callable.
- The accept endpoint (see #2) must hard-require `token.email == invite.email` (today
  JoinInviteView only *warns* on mismatch — `JoinInviteView.tsx:309`).

### 4. Close the discovery surface — needs app coordination, do NOT lock blind
- `businesses` read: still needed broadly for **subdomain→tenant resolution**
  (`usePortalTenant`). Split the public `portalSubdomain → businessId` mapping into a
  minimal public collection, keep the rest owner/super-admin only.
- `teamSettings` read: contains bank accounts + WhatsApp/Meta config, but is read by
  `PortalChatView` (portal clients). Split sensitive fields out before restricting read.
- `services` read: portal reads cross-tenant with `skipTeamFilter`. Scope the portal
  query by the client's `businessId` first, then gate read by a portal-of-business clause.
- `counters` (`invoices_{teamId}`): scope to the team; keep super-admin cross-team path.
- `directMessages` / `channels` / `typingIndicators`: still `read: if isAuth()`
  (the `messages` rule was tightened, these were not). Scope by `businessId` /
  participant IDs — but first refactor the unread-sweep queries (this is why the
  original `messages` tightening was deferred, per CLAUDE.md item #15).

### Test protocol before deploying rules
1. `firebase emulators:start --only firestore`
2. Run the app against the emulator; exercise: staff login, portal-client login,
   invite accept, invoice send, chat unread sweep, super-admin cross-tenant view.
3. Add rules unit tests (`@firebase/rules-unit-testing`) for the attack in "Root cause".
4. Only then `firebase deploy --only firestore:rules`.

## Done (shipped in this pass — API layer, safe & contained)
- `api/_send-invoice-email.ts` `notify-client`: recipient + authorization now derived
  from the channel's customer (no more arbitrary-recipient open relay); `senderName` /
  `messagePreview` / name HTML-escaped (was raw → phishing HTML). Fail-closed staff
  authz with businessId fallback on the invoice path.
- `api/create-checkout-session.ts` & `api/_send-lead-reminder-email.ts`: fail-closed
  authz — a doc with a null `teamId` is checked against its `businessId` instead of
  skipping the check (closed the "auth-skip when teamId missing" bypass).
- `api/_send-notification-email.ts`: caller may only push/email a user in their own
  business (blocks cross-tenant push/email spam & phishing); super-admin bypasses.
