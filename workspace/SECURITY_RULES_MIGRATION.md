# Firestore Read-Rule Tightening — Migration Plan

**Status:** PROPOSED — not yet applied to `firestore.rules` (would break production if deployed
without the prerequisite steps below).

## The problem

Almost every team-scoped collection in `firestore.rules` uses:

```
allow read: if isAuth();
```

This means **any authenticated user can read every team's data** (invoices, customers, DMs,
expenses, pricing) via a raw SDK/`curl` call — the `teamId` filter only exists client-side in
`useFirestore.ts`. This is a multi-tenant data-isolation gap.

The `whatsapp*` collections already demonstrate the correct, deployed pattern:

```
allow read: if isTeamMember(resource.data.teamId);
```

`isTeamMember(teamId)` compares the doc's `teamId` against `users/{uid}.teamId`, which
`usePermissions` writes on every authenticated load.

## Why it can't just be flipped

1. **Legacy docs without `teamId`.** `globalReadCollections` (`customers, leads, invoices,
   quotes, contracts, services`) are read with NO teamId filter today because many old/portal/
   landing docs have no `teamId`. Tightening their reads would make those docs unreadable.
2. **Query constraint requirement.** With `isTeamMember(resource.data.teamId)`, Firestore rejects
   any list query NOT constrained by `where('teamId','==', myTeam)`. Every reader must add that
   filter. `useFirestore` already does for team-scoped collections — but portal views and the
   ChatView unread-sweeps use `skipTeamFilter: true` and would break.
3. **Super-admin global reads.** `setSuperAdmin(true)` skips the team filter to read across teams;
   `isTeamMember` would lock super-admins out.
4. **Portal clients.** Their `users/{uid}.teamId` may not equal the staff team, so per-team reads
   on `messages`/`clientRequests`/`projects` they legitimately access would fail.

## Phased migration

### Phase 0 — Prerequisites (runnable scripts, Admin SDK)

**0a. Backfill `teamId`** — `scripts/backfill-team-id.cjs` (dry-run by default).
Stamps `teamId` on docs missing one, inferring from `createdByUserId` →
`users/{uid}.teamId`, then `assignedToUserId`, then related `customerId`, then an
optional `--default-team`.
```
node scripts/backfill-team-id.cjs                      # see what's missing
node scripts/backfill-team-id.cjs --default-team TID --apply
```
Goal: every team-scoped doc has a `teamId`; resolve any `unresolved` docs the report lists.

**0b. Super-admin custom claim** — `scripts/set-super-admin-claims.cjs` (dry-run by default).
Promotes the `VITE_SUPER_ADMIN_EMAILS` users to a real `superAdmin: true` auth claim so the
`isSuperAdmin()` rule helper works.
```
node scripts/set-super-admin-claims.cjs                # preview
node scripts/set-super-admin-claims.cjs --apply        # set claims (users must re-login)
```

### Phase 1 — Tighten reads, ALWAYS with the super-admin escape hatch

> ⚠️ **Corrected finding (verified by grep):** `skipTeamFilter: true` is far more
> widespread than first assumed. **Customer360View** reads `tasks, activities, projects,
> clientRequests, services, quotes, contracts, leads, customers, invoices` ALL globally;
> **BonusView** reads `projects, expenses` globally; CRMView/ContractsView/ChatView/
> CustomersView do the same for several collections. A global (un-`where('teamId')`-d)
> query is REJECTED outright by an `isTeamMember(resource.data.teamId)` read rule.
> So there is **no collection that can be tightened without first refactoring its
> global readers** to be teamId-scoped (or giving them a super-admin token).

Every tightened read rule MUST therefore include the escape hatch:
```
match /tasks/{docId} {
  allow read: if isTeamMember(resource.data.teamId) || isSuperAdmin();
  allow create: if isAuth();
  allow update, delete: if isAuth();
}
```
`isSuperAdmin()` is already defined in `firestore.rules` (reads the `superAdmin` custom
claim). Grant the claim with `scripts/set-super-admin-claims.cjs` BEFORE deploying, so
admin global-read views keep working.

**Per-collection precondition:** before tightening collection X, audit every
`useCollection('X', { skipTeamFilter: true })` reader. Either (a) drop `skipTeamFilter`
so the server adds `where('teamId','==', activeTeam)`, or (b) confirm the reader is only
ever used by a super-admin. Customer360View is the main blocker — it loads a customer's
full history across many collections globally and needs each of those queries scoped to
the active team (the customer already belongs to one team).

**Progress — Customer360View (done):** `invoices, projects, clientRequests, activities,
contracts` now query `where('customerId','==', id)` server-side (and `customers` is a
single `useDocument` read) instead of loading whole collections. This cuts reads and
cross-team exposure to one customer's docs. It does NOT yet flip the rules: the queries
are still customerId-scoped, not teamId-scoped. `tasks` (joined via projectId), `quotes`
(customerId OR leadId), `leads` (customerId OR email) and `services` (full catalog) were
left as broader loads on purpose.

**`useFirestore` enhancement — DONE (opt-in, staged, not yet wired):**
`useCollection` now accepts `teamScopedWhere: true`. For a team-scoped collection it pushes
`teamId` AND the caller's `where` together server-side (e.g. `teamId==t` + `customerId==c`),
so the query is both narrow AND satisfies an `isTeamMember` rule. It is OFF by default — no
existing caller changes behaviour.

Composite indexes `teamId + customerId` were added to `firestore.indexes.json` for
`invoices, projects, clientRequests, activities, contracts`.

**To activate (coordinated deploy — do in this order):**
1. `firebase deploy --only firestore:indexes` and WAIT for the indexes to finish building
   (Firebase console → Firestore → Indexes shows "Enabled"). A query using
   `teamScopedWhere` throws until its index is Enabled.
2. In Customer360View, drop `skipTeamFilter: true` and add `teamScopedWhere: true` on the
   `byCustomer` query (so it becomes `teamId==active + customerId==id`). Do the same for any
   other per-customer/per-entity view.
3. Only then tighten the read rules for those collections to
   `isTeamMember(resource.data.teamId) || isSuperAdmin()`.

> Not wired now on purpose: this repo auto-deploys to Vercel on push, so shipping a
> `teamScopedWhere` caller before its index is Enabled would briefly break that view.
> The capability + indexes are staged so step 1 can be done first.

### Phase 2 — `messages` / `directMessages` (DMs)
Scope to participants + team channel members:
```
match /messages/{docId} {
  allow read: if isAuth() && (
    resource.data.senderId == request.auth.uid ||
    resource.data.receiverId == request.auth.uid ||
    isTeamMember(resource.data.teamId)
  );
  ...
}
```
**Blocker:** the unread-sweep queries (`allUnreadClientQuery`, `allUnreadChannelQuery`) in
`ChatView.tsx` query `messages` with `skipTeamFilter` and no participant filter — refactor them to
be teamId-scoped (or move unread-count aggregation to a server counter) BEFORE deploying this.

### Phase 3 — `globalReadCollections` (after Phase 0 backfill)
Once every doc has a `teamId` and portal queries are teamId-scoped, flip these to `isTeamMember`.
Portal flows need their own read path (e.g. `resource.data.customerId` matches the caller's
`clientPortalAccess`).

### Phase 4 — Lock down cross-user writes (server migration)
- `notifications`: today `allow create: if isAuth()` because the client creates notifications for
  OTHER users (task-assignee, portal→staff). Move notification creation to an Admin-SDK endpoint,
  then tighten to `allow create: if false` (server-only) or `userId == request.auth.uid`.

## Deploy checklist (per phase)
1. Deploy the frontend changes (teamId-scoped queries) FIRST.
2. Test in the Firebase Rules Playground with: staff user, second-team user, portal client,
   super-admin.
3. Deploy rules: `firebase deploy --only firestore:rules`.
4. Watch Firestore "denied requests" metrics for 24h; roll back if denials spike.
