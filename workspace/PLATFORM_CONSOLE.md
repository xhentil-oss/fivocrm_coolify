# Platform console vs. tenant workspace (plan, Jul 2026)

> **What this is:** the architecture plan for splitting the FivoCRM **platform
> console** (us, the SaaS operator) from the **tenant workspace** (Agjencia, our own
> business — which is just another tenant). Written as a plan only; **no code has
> been changed** beyond the TeamsView scoping fix described in §2.1.
>
> Read `TENANT_ISOLATION_ENTERPRISE.md` first — it defines `businessId` as the
> isolation key and the claims model this plan builds on.

---

## 1. Why split at all

Today "super-admin" is not a **context** you enter — it is a **role that replaces
your tenant identity**. In `usePermissions.ts` the super-admin branch returns:

```ts
// src/hooks/usePermissions.ts:237-250
role: 'SuperAdmin', dataScope: 'all', teamId: null,
teamName: 'Të gjitha ekipet', isOwner: false, isSuperAdmin: true,
```

So the owner of Agjencia **loses their owner identity** (`isOwner: false`,
`teamId: null`, see also line 210 and 226) and gains a platform identity that
belongs to no business. Three concrete consequences:

1. **Identity collections leak across tenants.**
   `SUPER_ADMIN_BYPASS_COLLECTIONS` (`useFirestore.ts:229`) drops the automatic
   `businessId` predicate for `teams`, `teamMembers`, `teamInvites` whenever the
   super-admin flag is on. This is what made `/app/teams` list every tenant's
   department — it looked like teams had been created by themselves, when they
   were simply the June/July SaaS signups (each signup creates 1 business + 1
   `Përgjithshëm` team, `createTenant.ts:58`).
2. **The console lives inside day-to-day work.** "Relax CRM" is one more sidebar
   entry (`Sidebar.tsx:38`) in the same shell as Projektet/CRM/Faturat, and
   `/app/tenants` is one more `/app` route (`App.tsx:361`).
3. **Write-context risk.** For a super-admin the active team is picked
   semi-arbitrarily — first candidate, preferring one with WhatsApp configured
   (`usePermissions.ts:600-628`) — and every team-scoped create stamps it.

**The server boundary is already correct.** `api/_tenantClaims.ts` mints a signed
`superAdmin` claim and `firestore.rules` honours it (`isSuperAdmin()` at line 30,
used by `isTeamAdmin`, `canManageBusinessDoc`, `canCreateBusinessDoc`,
`keepsBusinessId`). Nothing in this plan weakens or re-implements that. **The
problem is entirely in the client identity/UX layer.**

---

## 2. Inventory — every super-admin touchpoint

### 2.1 Scoping bypass (the leak surface)

| Where | What it does | Fate |
|---|---|---|
| `useFirestore.ts:229` `SUPER_ADMIN_BYPASS_COLLECTIONS` | dropped `businessId` filter for `teams`/`teamMembers`/`teamInvites` | ✅ deleted (Phase 1) |
| `useFirestore.ts:326-339` `superAdminBypass` | applied the above inside `useCollection` | ✅ deleted (Phase 1) |
| `useFirestore.ts:101-120` `setSuperAdmin` / `useIsSuperAdmin` | reactive global flag feeding the bypass | ✅ deleted — nothing consumed it once the bypass was gone |
| `TeamsView.tsx:76-100` | explicit `businessId` predicate for all three collections (commit `60bc2b7`) | kept as defence in depth |
| `CRMView.tsx:129`, `ProjectsView.tsx:80`, `InvoicesView.tsx:119`, `DealsView.tsx:76` | read `teamMembers` relying on the bypass for name resolution | ✅ fixed by Phase 1; their re-filters kept |
| `TenantsView.tsx` `members` / `businesses` | passed `skipBusinessFilter: true` **explicitly** | kept — the legitimate cross-tenant reader |
| `TenantsView.tsx` `teams` | relied on the implicit bypass | ✅ now opts out explicitly (else "Hyr" breaks) |
| `usePermissions.ts:196-200` | `allTeams` unscoped, `skipBusinessFilter: true` | kept, but move behind the console (Phase 3) |

Note that `TenantsView` already opts out explicitly, which is why the global
bypass can be deleted without breaking the console.

### 2.2 Capability checks (harmless — super-admin as "also an admin")

`FinancesView.tsx:66`, `PaymentsView.tsx:24`, `ExpensesView.tsx:69,266`,
`Customer360View.tsx:33`, `AccountabilityView.tsx:53`, `ReportingAdminView.tsx:59`,
`useReports.ts:126`, `useClientPortal.ts:44`, `useSubscription.ts:58`,
`modules.ts:177,189` (`isPathEnabled` → super-admin ignores plan/toggle gates).

These only ever **widen** permissions inside the already-scoped active business.
After Phase 3 they keep working unchanged, because the agency owner satisfies
`isOwner`/`isAdmin` on their own. No change needed.

### 2.3 Console surface that exists today

`TenantsView.tsx` — tenant list, per-tenant module chips, plan/status badges, and
the hardening/migration job runners (`tenant-hierarchy`, `backfill-tenant-keys`,
`migrate-team-secrets`, `sync-tenant-claims`, `backfill-customerid`).

---

## 3. Target model — two contexts, one codebase

| | `/app/*` | `/admin/*` (new) |
|---|---|---|
| What it is | ONE tenant's workspace, always | The FivoCRM SaaS console |
| Who you are | owner/admin/member of that business | platform operator |
| Contents | projects, CRM, invoices, reports… | tenants, plan/status/MRR, seats, per-tenant modules, jobs, audit log |
| Scoping | zero bypass — every query inside `businessId` | `skipBusinessFilter` explicitly, only here |
| Shell | current sidebar | its own sidebar + a visually distinct top bar |

**Crossing between them is an explicit, audited act**, not a standing state. The
plumbing already exists: `POST /api/sync-claims` with `preferBusinessId` mints
claims for the target tenant and writes an audit entry `claims.impersonate`
(`api/_sync-claims.ts:50-58`, rendered by `AuditLogPanel.tsx:29`). A tenant
switcher is therefore: call that endpoint → `setGlobalBusinessId` /
`setGlobalTeamId` → navigate to `/app`.

This mirrors how Stripe/Vercel/Shopify separate "your account" from "the platform
console", with entering someone else's account being a recorded action.

---

## 4. Phases

### Phase 1 — SHIPPED (31 Jul 2026), after Phase 2

Done second on purpose: removing the bypass leaves no way to see another tenant, so
the switcher had to exist first.

`SUPER_ADMIN_BYPASS_COLLECTIONS`, the `superAdminBypass` branch in `useCollection`,
and the whole reactive `setSuperAdmin`/`useIsSuperAdmin` store are **gone**. Scoping
is now identical for every user: a read is business-scoped unless the caller passes
`skipBusinessFilter`. `permissions.isSuperAdmin` stays as the capability flag.

- **Files:** `src/hooks/useFirestore.ts` (three blocks removed), `usePermissions.ts`
  (no longer publishes the flag), plus refreshed comments in `CRMView`/`ProjectsView`/
  `InvoicesView`/`DealsView` — their defensive `businessId` re-filters were kept as
  defence in depth.
- **The one place that had to be updated:** `TenantsView`'s `teams` query relied on
  the implicit bypass and now passes `skipBusinessFilter: true` explicitly. Without
  it the console cannot resolve a tenant's default team, which breaks "Hyr" and the
  subdomain mapping.
- `usePermissions`' `allTeams` and the two identity queries already opted out
  explicitly, so the bootstrap was unaffected.
- **Precondition (verified 31 Jul 2026):** all 18 `teamMembers` and all 62
  `teamInvites` carry a `businessId`, so nothing disappeared behind the filter.
- **Effect:** `/app` shows nothing from other tenants. Inspecting another tenant is
  now a deliberate act: enter it from the console.

### Phase 2 — SHIPPED (31 Jul 2026) as `/superadmin`

Built as described below, with three deliberate deviations noted at the end.

| File | Role |
|---|---|
| `src/lib/platformContext.ts` (new) | the active-tenant override — `sessionStorage`, reactive via `useSyncExternalStore`. Per-tab on purpose: visiting another tenant must not outlive the tab. |
| `src/views/superadmin/SuperAdminConsole.tsx` (new) | the console shell: own slate/amber header, nav (Tenantët · Audit), own `<Routes>`, gated on `isSuperAdmin` |
| `src/components/ImpersonationBanner.tsx` (new) | amber banner in `/app` while inside another tenant, with "Dil" |
| `src/App.tsx` | `/superadmin/*` mounted OUTSIDE the `/app` shell (before the `/*` catch-all); `/app/tenants` → redirect |
| `src/components/Sidebar.tsx` | the entry now points at `/superadmin` and is labelled "Konsola e Platformës" |
| `src/views/TenantsView.tsx` | per-tenant **"Hyr"** button → `enterTenant()` |
| `src/hooks/usePermissions.ts` | the super-admin effect honours the override before its own heuristic; `users/{uid}` is NOT rewritten while visiting |
| `src/lib/tenantClaims.ts` | `ensureTenantClaims` forwards `businessId` **only** when the token says `superAdmin` (the endpoint 403s everyone else) |
| `api/_tenantClaims.ts` | on impersonation `tid` is dropped unless the requested team really belongs to the target business |

**The switch order is load-bearing:** mint claims first, verify `claims.bid === target`,
*then* pin the UI override. Reversed, the app would scope reads to a tenant the token
has no claim for and every listener would fail `permission-denied`.

Failure mode to know: if the operator's ID token predates the `superAdmin` claim,
`/api/sync-claims` answers **403** and the button reports it — sign out and back in
(or run `scripts/set-super-admin-claims.cjs`).

Deviations from the original sketch: (a) the path is `/superadmin`, not `/admin`;
(b) the sidebar entry was **kept** (repointed) rather than removed — it is the only
navigation affordance into the console; (c) `TenantsView` was not split into
Tenants/Jobs tabs — it is mounted whole, so the migration runners still live on the
tenant page. Splitting it is cosmetic and can wait.

### Phase 2 — original sketch (for reference)

1. New route namespace `/admin/*` with its own layout component (own sidebar,
   distinct colour/badge so the context is unmistakable), gated by
   `PermissionGate permissionKey="isSuperAdmin"` at the layout level.
2. Move `TenantsView` to `/admin/tenants`; keep a redirect from `/app/tenants`.
   Remove the "Relax CRM" entry from the tenant sidebar (`Sidebar.tsx:38`).
3. Split the current TenantsView into: **Tenants** (list + detail), **Jobs**
   (the migration runners), **Audit** (existing `AuditLogPanel`).
4. Tenant switcher on each tenant row: "Hyr në këtë tenant" → `sync-claims`
   with `preferBusinessId` → set globals → `/app/dashboard`. Show a persistent
   banner in `/app` while the active business is not your own, with "Dil".
5. Nice-to-have on the tenant list: MRR/plan mix and seat usage, both derivable
   from `businesses` + `teamMembers` without new collections.

### Phase 2b — the console itself (31 Jul 2026)

The first cut mounted the old tenant list inside the new shell. That list was a row
of chips; running a SaaS needs the commercial terms to be editable and the money to
be visible. The console is now three pages:

| Route | View | What it is |
|---|---|---|
| `/superadmin` | `PlatformDashboard.tsx` | MRR/ARR, tenants by lifecycle state, trials ending within 7 days, tenants needing attention; searchable, status-filtered, sortable tenant table (created / MRR / members / name); "Hyr" per row |
| `/superadmin/tenants/:businessId` | `TenantDetailView.tsx` | plan · status · trial end · seat override (+ audit note), module toggles, team roster, portal subdomain, GDPR export/delete |
| `/superadmin/jobs` | `PlatformJobsView.tsx` | the migration/backfill runners, moved off the tenant page |
| `/superadmin/audit` | `AuditLogPanel` | the active tenant's trail |

`TenantsView.tsx` is **deleted** — its list became the dashboard, its job runners
became the jobs page. Shared labels live in `superadmin/tenantMeta.tsx`.

**Writes go through the server, not Firestore.** `POST /api/platform-admin`
(`api/_platformAdmin.ts`, dispatched by `api/email.ts?type=platform-admin` + a
`vercel.json` rewrite, so the function count stays at 12) handles `update-plan` and
`set-modules`. Rules would let a super-admin write `businesses/{id}` directly; the
endpoint exists for what the client cannot give: validation against one list of
plans/statuses, an audit entry with before/after, and detection of a conflict with a
live Stripe subscription.

Three behaviours worth remembering:

- **Seats follow the plan.** Changing the plan rewrites `seats`, or a downgrade would
  silently keep the old allowance. `limits.seats` is the negotiated override and is
  left alone unless explicitly set (empty = back to the plan's).
- **Status changes fix their own timestamps.** Setting `suspended` stamps
  `suspendedAt`; anything else clears it (and clears `pastDueSince` unless the new
  status is `past_due`), otherwise the `subscription-lifecycle` cron would re-derive
  a state contradicting what was just set by hand.
- **Stripe wins in the end.** A manual tier on a subscribed tenant is overwritten by
  the next webhook. The detail page shows an amber warning before the edit and the
  save toast repeats it.

Deletion is resumable server-side (`complete: false` when the time budget runs out),
so the UI loops until it reports complete — a half-erased tenant is the opposite of
what a DPA request asks for. The confirm prompt asks for the tenant NAME (what a
human can verify), while the API is sent `confirm=<businessId>` (what it demands).

`platformAdmin.ts` also holds the pure read-side logic — `tenantMrr`,
`platformStats`, `daysUntil` — unit-tested in `platformAdmin.test.ts` (9 tests). MRR
counts only `status === 'active'`: a trial is not revenue, and a suspended tenant
still has `plan: 'pro'` written on it.

### Phase 3 — restore the real identity (risky, do separately)

Make a super-admin **also** their real self: owner of Agjencia, plus a separate
`isPlatformAdmin` flag.

- `usePermissions.ts`: drop the early-return branch at 237-250; stop forcing
  `activeTeamId = null` (210), `isOwner = false` (226) and `teams = allTeams`
  (215). The super-admin then flows through the normal OWNER branch and gets a
  real `teamId`/`businessId`; `isSuperAdmin` survives only as a capability flag.
- The arbitrary active-team picker (600-628) can then be deleted: the owner path
  already resolves a deterministic team.
- **Why risky:** this is the identity bootstrap every screen depends on, and the
  branch also feeds `ensureTenantClaims`. Needs a full pass over the roles matrix
  and a manual smoke test of `/app` as owner, as member, as portal client.
- Keep `role: 'SuperAdmin'` out of `simulateRole` (`PermissionsContext.tsx`) —
  simulation is about tenant roles, not platform access.

---

## 5. Verification

- `npm run test` (currently 232 passing) and `npm run build` for every phase.
- Rules unchanged by Phases 1-2 → no `firestore-rules.test.mjs` run needed; if
  Phase 3 touches claims minting, re-run the emulator suite (35/35) before any
  `firebase deploy --only firestore:rules`.
- Manual matrix per phase: super-admin, agency owner (same person after Phase 3),
  a Member of Agjencia, an owner of another tenant, a portal client.
- Phase 2 specifically: after switching into tenant X, confirm `/app/teams`,
  `/app/crm` and Chat all show X's data and nothing of Agjencia's — and that an
  audit entry `claims.impersonate` was written.

## 6. Rollback

Phases 1 and 2 are pure client changes on `main` → `git revert` of the phase
commit is sufficient; no data migration, no rules deploy. Phase 3 additionally
rewrites `users/{uid}.teamId|businessId` for the super-admin on first load; the
previous value is recoverable from the audit log and from `teamMembers`.

## 7. Open questions

- Does the platform console belong on a separate host (`admin.fivocrm.com`)
  rather than a path? A path is cheaper and enough for one operator; a subdomain
  becomes attractive when non-owner staff get console access.
- Should the empty migration team `Përgjithshëm` (`303s0gWqepyogoAjKedL`,
  created by `migrate-tenant-cleanup.mjs` on 12 Jul 2026, 0 members) be deleted?
  Blocked on checking `VITE_DEFAULT_TEAM_ID` in Vercel — it may be the landing
  team for new portal clients.
