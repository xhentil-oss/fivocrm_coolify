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
