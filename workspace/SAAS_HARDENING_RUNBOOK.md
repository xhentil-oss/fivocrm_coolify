# SaaS hardening — deploy runbook

Two bodies of work land together and **the order matters**. Nothing below is deployed
automatically: every step needs your Firebase/Vercel/Stripe access.

- **Part A — tenant isolation** (business = tenant, team = department inside it)
- **Part B — SaaS mechanics** (subscription billing, seats, cost, lifecycle)

Verified locally before writing this: `npx tsc --noEmit` clean · `npm test` 246/246 ·
`npm run build` ok · Firestore rules tests **53/53** in the emulator.

---

## Part A — tenant isolation

### A0. What changed (why the order matters)

| Layer | Before | Now |
|---|---|---|
| Tenant proof | `users/{uid}.businessId` (client-written doc) | signed claims `bid` / `tid` / `roles`, with the users-doc as fallback |
| Portal proof | same doc | `cid` (customerId) + `pbid` (portal client's tenant, deliberately NOT `bid`) |
| Credentials | `teamSettings` — `read: if isAuth()` | `teamSecrets` — `read, write: if false` (Admin SDK only) |
| Team | could exist with no business | `businessId` required; a team is a department INSIDE one business |
| Portal reads | `teamMembers` / `services` cross-tenant | never `teamMembers`; catalogue scoped to the client's own business |
| Tenant discovery | `businesses` world-readable | `publicTenants/{subdomain}` — the only public slice |
| Suspension | UI only | `tenantActive()` denies writes at the rules layer |
| Audit | none | `auditLogs`, append-only (`update, delete: if false`) |

### A1. Fix the invite hole first (independent, ship immediately)

`teamInvites` was client-creatable and `/api/accept-invite` did not check who issued the
invite → anyone could forge an invite for their own email into ANY team and be handed an
Admin membership. Now the endpoint verifies the inviter still holds owner/Admin/Manager
authority over that team, and a Manager may not mint an Admin.

```bash
git push          # Vercel deploys api/_accept-invite.ts
```

### A2. Run the migrations (super-admin claim required, in this order)

```bash
# 1. every team gets a REAL parent business + publicTenants map is (re)built
curl -X POST "$APP/api/cron/run?job=tenant-hierarchy&dryRun=1" -H "Authorization: Bearer $ID_TOKEN"
curl -X POST "$APP/api/cron/run?job=tenant-hierarchy"          -H "Authorization: Bearer $ID_TOKEN"

# 2. tenant keys on collections whose reads are being hardened
curl -X POST "$APP/api/cron/run?job=backfill-tenant-keys&dryRun=1" -H "Authorization: Bearer $ID_TOKEN"
curl -X POST "$APP/api/cron/run?job=backfill-tenant-keys"          -H "Authorization: Bearer $ID_TOKEN"

# 3. credentials out of teamSettings into the vault (deletes the plaintext copies)
curl -X POST "$APP/api/cron/run?job=migrate-team-secrets&dryRun=1" -H "Authorization: Bearer $ID_TOKEN"
curl -X POST "$APP/api/cron/run?job=migrate-team-secrets"          -H "Authorization: Bearer $ID_TOKEN"

# 4. mint tenant claims for every member (they take effect on the next token refresh)
curl -X POST "$APP/api/cron/run?job=sync-tenant-claims" -H "Authorization: Bearer $ID_TOKEN"
```

`dryRun=1` reports exactly what would change and writes nothing. Run it first, every time.

### A3. Deploy the frontend BEFORE the rules

The hardened rules reject unscoped queries, so the app must already be issuing scoped
ones. Order: **push → wait for Vercel → hard-refresh (Ctrl+Shift+R) → then rules.**

```bash
firebase deploy --only firestore:indexes   # composite indexes first, always
firebase deploy --only firestore:rules
```

Rollback (~30s): `git show <prev>:firestore.rules > firestore.rules && firebase deploy --only firestore:rules`.

### A4. Verify

- Owner sees all their own data; a second tenant's account sees none of it.
- A portal client logs in, sees only their own invoices/projects/catalogue.
- Chat: DMs and client channels work; the unread badge counts only this tenant.
- WhatsApp/email sending still works (credentials now come from `teamSecrets`).
- `Cilësimet → Integrime`: secret fields are empty with “Kredencial i ruajtur…”.

---

## Part B — SaaS mechanics

### B1. Stripe setup (once)

Create three recurring Products/Prices (monthly + yearly) and set in Vercel:

```
STRIPE_PRICE_STARTER_MONTH / _YEAR
STRIPE_PRICE_PRO_MONTH     / _YEAR
STRIPE_PRICE_BUSINESS_MONTH/ _YEAR
APP_BASE_URL=https://fivocrm.vercel.app      # used for success/cancel/return URLs
```

Add these events to the existing `/api/stripe-webhook` endpoint:

```
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
```

The plan is always derived from the **price actually billed** (`planForPriceId`), never
from the checkout request — a tampered body cannot grant a tier. `businesses.plan/status`
are not writable by the tenant (rules), only by the webhook/cron.

### B2. Lifecycle

`subscription-lifecycle` runs inside the daily `run-all`:

```
trialing, 3 days left        → warn the owner (once)
trialing, trialEndsAt passed → past_due  (grace clock starts)
past_due > 7 days            → suspended (writes denied by rules)
invoice.paid                 → active    (grace + suspension cleared)
```

Test without touching data: `?job=subscription-lifecycle&dryRun=1`.

### B3. Seats

`PLAN_SEATS` in `api/_billingPlans.ts`: trial 5 · starter 3 · pro 10 · business 25 ·
enterprise 1000, overridable per tenant via `businesses.limits.seats` (Enterprise
contracts). Enforced in `/api/accept-invite` (fail-closed) and surfaced in TeamsView +
Abonimi before an invite is sent.

### B4. Cost — what got fixed

| Job | Before | Now |
|---|---|---|
| `task-deadline-alerts` | read EVERY task of EVERY tenant | range query on `endDate` (alert window only) |
| `goal-overdue-alerts` | read every goal | two ranged queries, deduped |
| `whatsapp-broadcasts` | read every tenant's leads/customers **per broadcast** | scoped to the broadcast's own `businessId` |
| `email-campaigns` | same | scoped to the campaign's own `businessId` |
| `project-spend-rollup` | full scan of projects+timeEntries+expenses daily | incremental: only projects touched since the last run (`?full=1` forces a full pass) |

The broadcast/campaign one was **also a data-isolation bug**: a tenant's campaign could
reach another tenant's contacts. Worth re-checking any campaign sent recently.

### B5. GDPR / DPA

```bash
curl -X POST "$APP/api/cron/run?job=tenant-export&businessId=<bid>" -H "Authorization: Bearer $ID_TOKEN"
curl -X POST "$APP/api/cron/run?job=tenant-delete&businessId=<bid>&confirm=<bid>&dryRun=1" -H "Authorization: Bearer $ID_TOKEN"
```

Delete requires `confirm=<businessId>`, is resumable, removes `teamSecrets`, the
`publicTenants` entry and the business last, and writes an audit entry that survives.

---

---

## Part C - platform console analytics (improvements #2 and #3)

Two daily rollups feed `/superadmin`. Both are super-admin gated, idempotent and safe
to re-run; both are inside `run-all`, and both have a button in **Punët -> Analitika**.

### C1. Tenant health (`tenant-usage-rollup`)

Writes `businesses.usage` = `{ lastActivityAt, activeUsers7d, docCounts, docsTotal,
computedAt }`. The console can now tell an engaged trial from a dead one, and see whose
volume drives platform cost - without the operator's browser reading tenant data.

Cost discipline: document counts use Firestore `count()` aggregations (billed per ~1000
index entries, not per document) and freshness is one
`orderBy(updatedAt desc).limit(1)` per signal collection. A handful of reads per tenant,
regardless of tenant size.

```bash
curl -X POST "$APP/api/cron/run?job=tenant-usage-rollup&manual=1&dryRun=1" -H "Authorization: Bearer $ID_TOKEN"
curl -X POST "$APP/api/cron/run?job=tenant-usage-rollup&manual=1"          -H "Authorization: Bearer $ID_TOKEN"
```

Health thresholds (days since the last write anywhere in the tenant), in
`src/lib/platformAdmin.ts`: engaged <=3 - quiet <=14 - idle <=45 - dormant beyond that.
A tenant younger than 2 days with no rollup reads as "unknown", never "abandoned".

### C2. Platform trend (`platform-metrics-rollup`)

Writes one document per month at `platformMetrics/{YYYY-MM}`: tenants by status,
signups, `activated` (trial->paid conversions), `churned`, MRR/ARR. Rules:
`read: if isSuperAdmin(); write: if false` - the cron owns it, so nobody can fake the
numbers the business is steered by, and no tenant can read the shape of the customer base.

Conversion and churn are counted from stamps the Stripe webhook now maintains:
`activatedAt` (first ever activation, never overwritten) and `canceledAt`.

**Run once after deploying** to rebuild history from existing signup/activation dates:

```bash
curl -X POST "$APP/api/cron/run?job=platform-metrics-rollup&manual=1&backfill=1" -H "Authorization: Bearer $ID_TOKEN"
```

Without the backfill the trend card shows "not computed yet" and tells the operator
exactly which job to run.

### C3. What the console shows now

- **Trend row** - MRR with month-over-month delta + inline sparkline (no chart library),
  signups this month, trial->paid conversion over 12 months, churn.
- **"Kërkojnë veprim"** - a ranked work queue. A tenant that *still pays but stopped
  using the product* outranks a trial that never started, because that is the revenue
  actually at risk.
- **Tenant list** - a health dot next to each name, a "last activity" column, and a new
  "Më të qetët" sort (stalest first).
- **Tenant detail** - an activity/volume card with per-collection counts.

All eleven items from the console review are now implemented (see C4 below).

### C4. Console operator upgrades (improvements #1, #6-#11)

**#1 Real MRR.** `monthlyAmountCents()` (api/_billingPlans.ts) derives the monthly figure
from the subscription Stripe actually bills: yearly / 12, `interval_count`, quantity and
coupons (`percent_off` / `amount_off`) all applied. The webhook stores it as
`businesses.mrrCents` (+ `billingCurrency`, `billingInterval`, `billingQuantity`,
`stripeLivemode`); `tenantMrr()` prefers it and falls back to the price list for tenants
that predate the field, so no tenant ever shows a blank. Cancellation sets it to 0.

**#6 Quick actions** on the tenant page: `+7 ditë provë` (extends from the current end
date, or from today when the trial already lapsed), `Pezullo` / `Riaktivizo` (with a
confirm, because suspension freezes writes at the rules layer), `Stripe` (test vs live
chosen from `stripeLivemode`), `Email pronarit`, and `Gabimet (Sentry)` filtered by
`tenant:<businessId>` - possible because errors are tagged with the tenant. Everything
goes through the same audited `/api/platform-admin` endpoint as the form.

Set `VITE_SENTRY_ORG` + `VITE_SENTRY_PROJECT` to enable the Sentry button; without them
it stays hidden rather than linking somewhere useless.

**#7 Time-boxed impersonation.** Entering a tenant now lasts 60 minutes
(`IMPERSONATION_MINUTES`), shows a countdown in the banner, can be extended by 30
minutes, and expires on its own - a tab left open overnight is no longer sitting inside a
customer's workspace. Leaving re-mints the operator's own claims and records
`claims.impersonate_end`, so the audit trail has both halves of the visit.

**#8 Missing-claim guard.** The console renders from the build-time
`VITE_SUPER_ADMIN_EMAILS` list, but every cross-tenant read is authorised by the signed
`superAdmin` claim. When they disagree the console used to render normally with empty
lists; it now says so and offers a token refresh.

**#9 Create tenant from the console.** Business + default team + settings + an Admin
invite for the owner (no pre-created account, no password in a support thread). Refuses a
duplicate for an owner email that already has a business unless confirmed. The membership
is still created only by `/api/accept-invite`, so there remains ONE server-validated path
into a tenant.

**#10 Console read cost.** The dashboard read every tenant's `businesses` + `teamMembers`
+ `teams` on each page view - thousands of documents at scale, including staff salary
fields - to show a member count and find a team to enter. `memberCount`, `teamCount` and
`defaultTeamId` are now denormalised on the business (recomputed by the usage rollup,
incremented on invite acceptance), so the console reads ONE collection.

**#11 Job history + dryRun.** Every execution (manual or cron) appends to
`platformJobRuns` - job, actor, duration, ok/error, a compacted summary - readable by the
console and immutable (`write: if false`). The Jobs view gained a **Provë (dryRun)**
switch: every hardening/analytics job already accepted `dryRun=1` server-side, but the UI
had no way to send it, so the safe option existed and was unreachable.

## Still open (deliberately)

- **Cursor pagination adoption** — `useCursorCollection` + the composite indexes are in,
  but Invoices/Leads/Tasks/Customers still use the fetch-all `usePaginatedCollection`.
  Migrating them means moving their filters/sorting server-side; do it per view, with the
  index deployed first. Until then a tenant with tens of thousands of rows pays a read
  per row per visit.
- **Usage metering** (docs/storage/emails per tenant) — needed for usage-based pricing
  and for spotting a noisy neighbour. Seats are enforced; nothing else is counted.
- **Demo-data seeding** — the activation checklist replaced the empty-workspace problem,
  but there is no "fill my workspace with a sample project" button.
- **E2 per-tenant sending domain** (Resend verified domain). E1 is live: a tenant's client
  now receives mail as “<Tenant name>” with Reply-To pointing at the tenant.
- **i18n** — the UI is hardcoded sq-AL. A market outside AL/KS needs an extraction pass.
- **Compensation split** — `teamMembers` still carries `monthlySalary`/`salaryHistory`, so
  any member of the business who can read the staff list can read salaries. Tenant
  isolation is intact (no other tenant sees it); this is an in-tenant RBAC gap, and fixing
  it means moving those fields into `memberCompensation` and updating the finance engine.
