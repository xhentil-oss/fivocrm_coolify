# Tenant isolation — enterprise hardening (Jul 2026)

> **What this is:** the architecture and the DEPLOY RUNBOOK for the pass that made
> `businessId` a real isolation boundary instead of a convention. Supersedes the
> "root cause" section of `SECURITY_TENANT_ISOLATION_TODO.md`.
>
> Gate: `firebase emulators:exec --only firestore "node --test scripts/firestore-rules.test.mjs"`
> → **35/35 pass**. `npm run test` → 232 pass. `npm run build` → clean.

---

## 1. The model

```
businesses/{businessId}          ← THE TENANT (isolation boundary)
   └── teams/{teamId}            ← DEPARTMENT inside exactly one business
          └── teamMembers/{teamId}_{uid}   ← staff membership (deterministic id)
   └── every data doc            ← carries businessId (+ teamId as sub-group)
```

**A team can never exist outside a business, and never move between businesses**
(`teams.businessId` is required on create and immutable on update — rules-enforced).

### Identity: signed claims, not a client-written document

`api/_tenantClaims.ts` mints Firebase Auth custom claims from authoritative data:

| claim | meaning | who gets it |
|---|---|---|
| `bid` | businessId — **proof of STAFF membership** | staff only |
| `tid` | teamId (department) | staff only |
| `roles` | `['owner'\|'admin'\|'manager'\|…]` | staff |
| `cid` | customerId | portal clients |
| `pbid` | portal client's tenant | portal clients |
| `superAdmin` | platform console (Relax CRM) | agency owner |

`bid` and `pbid` are deliberately **different claims**. A portal client legitimately
has a tenant, but is not staff of it — collapsing them into one claim would have
promoted every client to staff of their agency (read access to expenses, salaries,
goals, reports). Emulator test 15 exists precisely to keep that separated.

Rules read the token first and fall back to the `users/{uid}` marker only for sessions
whose token predates the rollout. The fallback additionally requires an existing
`teamMembers/{teamId}_{uid}` document, so the marker alone grants nothing.

Client side: `src/lib/tenantClaims.ts` → `ensureTenantClaims()` is called by
`usePermissions` whenever the resolved tenant differs from the token, then force-refreshes
the ID token so live Firestore listeners re-authorize.

### Reads are tenant-scoped by construction

`useFirestore.useCollection` applies a **mandatory tenant predicate**
(`where('businessId','==',activeBusiness)`) to everything in `businessIsolatedAlways`
— now including `teams`, `userProfiles`, `channels`, `clientPortalAccess`, `auditLogs`.
Firestore rules are *not* filters: an unscoped query over a scoped collection is denied
outright, so client scoping and server rules must agree. Only two escapes exist:

- `skipBusinessFilter: true` — identity bootstrap (`usePermissions`) and the portal,
  which must constrain the query itself (own uid/email, or its own businessId).
- super-admin, for `teams`/`teamMembers`/`teamInvites` only (the platform console).

### Credentials are not in Firestore-readable config

`teamSecrets/{teamId}` = `allow read, write: if false`. Written only through
`POST /api/tenant-secrets` (Admin SDK, team-admin authorized) and read only through
`getTeamConfig()` (`api/_tenantConfig.ts`). The browser sees only `has*` booleans
mirrored onto `teamSettings`. `saveTeamSettings()` strips credential fields defensively.

### The portal is a BFF client, not a Firestore client, for anything tenant-wide

The portal no longer reads `teamMembers` at all. `POST /api/notify-staff` resolves
recipients from the client's own customer → businessId and (optionally) upserts the
conversation thread with owner+watchers and creates the sales follow-up task.

### Enterprise controls added

- `auditLogs` — append-only (`update, delete: if false`), readable by tenant admins.
  Written server-side: `invite.accept`, `claims.impersonate`, `secrets.update`.
- `tenantActive()` — a business with `status: 'suspended'` is **read-only at the
  database layer**; a tenant cannot lift its own suspension or change its own plan.
- `publicTenants/{subdomain}` — the ONLY world-readable tenant metadata
  (businessId, teamId, name), so `businesses` no longer has to be public for the
  portal subdomain to resolve.

---

## 2. What was actually broken (and is now closed)

| # | Finding | Status |
|---|---|---|
| 1 | **Invite forgery → tenant takeover.** `teamInvites` was client-creatable by anyone; `/api/accept-invite` validated only "token + your email", so a forged invite into ANY team granted an Admin membership there. | FIXED — provenance check server-side (issuer must still be owner/Admin/Manager; a Manager may not mint an Admin) + `teamInvites` create/update/delete locked to team admins |
| 2 | **Every tenant's credentials were world-readable.** `teamSettings` was `read: if isAuth()` while holding `emailApiKey`, `emailSmtpPass`, `aiApiKey`, `whatsappVpsSecret`, Meta page tokens. | FIXED — `teamSecrets` vault (deny-all) + migration job + write-only endpoint |
| 3 | **Every tenant's staff records readable by anyone** (incl. `monthlySalary`, `salaryHistory`, hourly rates) — and by every portal client. | FIXED — `teamMembers` read scoped; portal reads it no more |
| 4 | ~15 collections still `read: if isAuth()` (`services`, `channels`, `teams`, `businesses`, `counters`, `clientPortalAccess`, `typingIndicators`, `workspace*`, `roleTemplates`, `chatSnippets`, categories, `whatsappAccounts`, `lidMappings`, `userProfiles`, `teamInvites`). | FIXED — all tenant-scoped; **zero `if isAuth()` reads remain** |
| 5 | Notification injection into any user's feed (`notifications create: if isAuth()`). | FIXED — self, or a user in your own tenant (staff or portal client) |
| 6 | Invoice-counter tampering across tenants (`counters read, write: if isAuth()`). | FIXED — membership check on the `invoices_{teamId}` key |
| 7 | Public registration + portal auto-create picked "the first team member found" across all tenants → registrants landed in an arbitrary business. | FIXED — subdomain (`publicTenants`) → `VITE_DEFAULT_*` → fail closed |
| 8 | Portal client with a `businessId` marker counted as staff. | FIXED — `bid`/`pbid` split + membership-backed fallback (test 15) |

### Known residual (next step, NOT done here)

**Compensation fields still live on `teamMembers`**, so every *staff member* of a tenant
can read colleagues' salaries. That is intra-tenant RBAC, not tenant isolation, and the
fix (move `monthlySalary`/`salaryHistory`/`hourlyCostRate`/`hourlyBillRate` to
`memberCompensation/{teamId}_{uid}`, admin-only) touches the finance engine
(`computeStaffRevenue`, per-project P&L, momentum, salary history). Do it as its own pass.

---

## 3. DEPLOY RUNBOOK — order matters

Deploying rules before the data/frontend is in place **locks people out**. Follow exactly.

### Step 0 — prerequisites (once)
```bash
# Vercel env (build-time for VITE_*, runtime for the rest):
#   VITE_DEFAULT_TEAM_ID, VITE_DEFAULT_BUSINESS_ID   ← the agency's own tenant
#   SUPER_ADMIN_EMAILS=xhentil@fivo.al               ← server-side claim minting
node scripts/set-super-admin-claims.cjs --apply      # ensure the superAdmin claim exists
```

### Step 1 — data migrations (Admin SDK; safe under the CURRENT rules)
Run from Relax CRM, or `GET /api/cron/run?job=<name>` with a super-admin bearer token.
Add `&dryRun=1` first to see what each would touch.

```
1. backfill-member-keys      # memberships → {teamId}_{uid}   (idempotent; already run in the Jul 20 cutover)
2. tenant-hierarchy          # every team gets a REAL parent business + publicTenants map
3. backfill-tenant-keys      # businessId on channels / userProfiles / clientPortalAccess
4. migrate-team-secrets      # credentials teamSettings → teamSecrets, has* flags, strip plaintext
5. sync-tenant-claims        # mint bid/tid/roles for every active member
```
Verify: `node scripts/audit-tenant-integrity.mjs` (no docs missing tenant keys).

### Step 2 — deploy the FRONTEND (Vercel) and let it settle
The new client code scopes every query it will need scoped. It still works under the
OLD rules, so this step is reversible on its own.

```bash
git push                      # Vercel builds
npm run android:sync          # keep the Android bundle in step (standing instruction)
```
Then hard-refresh (Ctrl+Shift+R) — the app uses `lazyRetry`, and a stale chunk during a
deploy transition is what caused the 4.3 rollback in June. Confirm, with a real login:
- staff: CRM, invoices, chat, teams page, settings all load
- portal client: dashboard, services, quotes, chat, project detail all load
- Relax CRM: tenant list + member counts non-zero

### Step 3 — deploy the RULES
```bash
export JAVA_HOME="$LOCALAPPDATA/jdk21/jdk-21.0.11+10"
firebase emulators:exec --only firestore --project fivocrm-rules-test \
  "node --test scripts/firestore-rules.test.mjs"          # must be 35/35
firebase deploy --only firestore:rules --project fivocrm
```

### Step 4 — post-deploy smoke test (5 min, both roles)
Staff: teams list, invite a member, chat unread badge, invoice create (counter!),
Settings → Integrime save (secret shows "i ruajtur"), daily report.
Portal: services list, accept a quote, send a chat message (staff must get the
notification), submit the questionnaire (a follow-up task must appear for sales).

### Rollback
Rules are independent of the app and revert in ~30s:
```bash
git show HEAD~1:firestore.rules > firestore.rules
firebase deploy --only firestore:rules --project fivocrm
```
Roll the frontend back only if the app itself misbehaves; the data migrations are
additive (they only ADD tenant keys) and never need rolling back.

---

## 4. Invariants to keep (for future work)

1. **Never read a tenant collection unscoped.** Rules are not filters — the query dies.
   If a view needs cross-tenant data, it belongs in Relax CRM with `skipBusinessFilter`.
2. **A portal read of a scoped collection must pass `skipBusinessFilter: true` AND
   constrain itself** (own uid/email, or its own businessId). Otherwise the
   `isTeamScoped && !scopeId` guard leaves the portal spinning forever.
3. **Credentials go to `teamSecrets` via `/api/tenant-secrets`.** Never to `teamSettings`.
4. **A team is created only inside a business you belong to or own.**
5. **New collection?** Add it to `businessIsolatedAlways`, stamp `businessId` on create,
   add a rule with `isBusinessMember(resource.data.businessId)`, and add a negative
   cross-tenant test to `scripts/firestore-rules.test.mjs`.
6. **`bid` means staff.** Portal tenancy is `pbid`. Never merge them.
