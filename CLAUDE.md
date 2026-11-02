# FivoCRM — Project Reference for Claude

## Project Identity

- **Name:** FivoCRM (package name: `anima-project`)
- **Type:** Full-stack Business Management SaaS Platform
- **Language:** Albanian (sq-AL) UI
- **GitHub:** `xhentil-oss/fivocrm` — branch `main`
- **Deployment:** Vercel (production), GitHub Actions for CI
- **Mobile:** Capacitor (Android)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS + shadcn/ui (Radix UI) |
| Backend/DB | Firebase (Firestore, Auth, Storage) |
| Serverless API | Vercel Functions (`/api/` folder) |
| Mobile | Capacitor v8 (Android + iOS) |
| Email | Nodemailer via VPS server (`/vps/`) |
| Payments | Stripe |
| AI | OpenAI (chat assistant) |
| Messaging | Meta WhatsApp API + Baileys (self-hosted) |
| Testing | Vitest |

---

## Repository Structure

```
/api/              — Vercel serverless functions (Node.js/TypeScript)
/src/
  App.tsx          — Main router, lazy-loaded views
  components/      — Shared UI components
  components/ui/   — shadcn/ui primitives (button, card, dialog, etc.)
  contexts/        — React contexts (Auth, Permissions, GoogleApi)
  hooks/           — Custom hooks (useFirestore, useClientPortal, etc.)
  lib/             — Firebase config, utils, calculator logic
  types/index.ts   — ALL shared TypeScript interfaces
  views/           — Page-level components
  views/portal/    — Client portal views
  views/landing/   — Public landing pages
/vps/              — Self-hosted VPS server for WhatsApp/email
/android/          — Capacitor Android project
/workspace/        — Project memory files (SOUL, PATTERNS, DECISIONS, TODO)
```

---

## Firebase Collections

| Collection | Purpose |
|---|---|
| `customers` | CRM customers |
| `leads` | Sales leads/pipeline |
| `quotes` | Preventiva / price quotes |
| `invoices` | Invoices & billing |
| `projects` | Project management |
| `tasks` | Task management |
| `activities` | CRM activity log |
| `clientRequests` | Client portal requests |
| `clientPortalAccess` | Portal login records |
| `channels` / `messages` | Team chat |
| `teamMembers` | Team roles & permissions |
| `goals` | OKR goals |
| `expenses` | Business expenses |
| `timeEntries` | Logged hours — Klient → Projekt → Detyrë → Orë; `date` (local day), `costRole`, `customerId`, `source`; frozen inside a closed month |
| `financeMonthCloses` / `financeReportRuns` | Month close (Admin-written lock + client-table snapshot) / day-2 report idempotency (cron-written, `write: if false`) |
| `services` | Service catalog |
| `products` | Shop products (variants, inventory, SEO) |
| `productCategories` / `productBrands` | Shop catalog taxonomy |
| `stockMovements` | Append-only inventory ledger |
| `shopOrders` | Shop orders (portal + back office) |
| `hostingServers` / `hostingProducts` / `domainTlds` | Hosting module catalog: WHM servers, packages, TLD sell prices (token in `hostingServerSecrets`, deny-all) |
| `subscriptions` / `domains` | Hosting accounts + registered domains — `source: 'whmcs'` (mirror) or `'fivocrm'` (billed by us) |
| `hostingOrders` / `hostingEvents` | Hosting orders (endpoint-only create) + append-only provider/lifecycle audit |
| `hostingCoupons` / `hostingBackups` | Promo codes (staff-only) + pkgacct backup ledger (server-written) |
| `serviceInquiries` | Landing page form submissions |
| `standups` | Morning standup entries |
| `dailyReports` | Daily staff reports |
| `quotes` | Price calculator quotes (team-scoped) |
| `reports` | Enterprise reports (blocks, workflow, approvals) |
| `reportVersions` / `reportApprovals` / `reportEvents` | Append-only history, sign-off, audit |
| `reportComments` | Report discussion (`internal` = the client boundary) |
| `contactMerges` | Duplicate-merge archive (full snapshot of the absorbed contact; read-only) |
| `dailyReportMisses` | Who did not file a daily report, per tenant per day (cron-written, `write: if false`) |
| `crmAutomationRules` / `crmAutomationRuns` | CRM automation rules (trigger → conditions → actions) + one doc per firing (idempotency + audit, `write: if false`) |
| `reportTemplates` / `reportSchedules` / `reportKpis` / `reportMetrics` | Reporting config + metric values |
| `clientHealthScores` / `employeeReportScores` | Health + accountability rollups |

---

## Key Architectural Rules

### Data Scoping — two-level tenancy (business > team)

**`businessId` is THE tenant/isolation key. `teamId` is a DEPARTMENT INSIDE one business**
(required + immutable on `teams`; a team can never exist outside a business or move
between them). Full architecture + deploy runbook: `workspace/TENANT_ISOLATION_ENTERPRISE.md`.

- `useCollection()` (`useFirestore.ts`) auto-applies `where('businessId','==',active)` to
  everything in `businessIsolatedAlways` — including `teams`, `userProfiles`, `channels`,
  `clientPortalAccess`. `setGlobalBusinessId()` / `getGlobalBusinessId()` hold the context.
- **Firestore rules are NOT filters**: an unscoped query over a scoped collection is
  denied outright. Client scoping and rules must always agree.
- `skipBusinessFilter: true` is only for identity bootstrap (`usePermissions`) and the
  portal — and a portal read MUST then constrain itself (own uid/email, or its own
  `businessId`), or the `isTeamScoped && !scopeId` guard leaves it loading forever.
- Authorization comes from **server-minted custom claims**, not from a client document:
  `bid` (businessId = proof of STAFF membership), `tid`, `roles`, `cid` (portal
  customerId), `pbid` (portal client's tenant — deliberately NOT `bid`), `superAdmin`.
  Minted by `api/_tenantClaims.ts`; reconciled client-side by
  `ensureTenantClaims()` (`src/lib/tenantClaims.ts`). `users/{uid}` remains only as a
  membership-backed fallback for tokens that predate the rollout.
- **Credentials never live in `teamSettings`** (it is readable by the whole business).
  They go to `teamSecrets/{teamId}` (`read, write: if false`) via
  `POST /api/tenant-secrets`; the UI only sees `has*` booleans. Server code reads them
  with `getTeamConfig()` (`api/_tenantConfig.ts`), never `teamSettings` directly.
- The **client portal never reads `teamMembers`**. Notification recipients, conversation
  routing and the sales follow-up task are resolved server-side by `POST /api/notify-staff`.
- Adding a collection? → `businessIsolatedAlways` + stamp `businessId` on create + a rule
  using `isBusinessMember(resource.data.businessId)` + a negative cross-tenant test in
  `scripts/firestore-rules.test.mjs` (35 tests; run them in the emulator before any
  `firebase deploy --only firestore:rules`).

### Tenant credentials are PLATFORM-managed, one vault per TENANT (Nov 2026)

- **A credential belongs to the business, never to a team.** Values live in
  `businessSecrets/{businessId}` (`read, write: if false`, test 86a);
  `getTeamConfig(teamId)` merges business vault > legacy `teamSecrets/{teamId}` >
  `teamSettings`, so every server consumer is unchanged. Per-team keys were why an AI
  key "disappeared" when the active team switched.
- **Only the platform super-admin sets, rotates or clears them**: `POST
  /api/tenant-secrets` refuses everyone else (`code: 'platform-managed'`) and goes
  through `writeBusinessSecrets()`, which records the STATUS on
  `businesses.credentials.<field>` (configured, last4, fingerprint, who/when), mirrors
  `has*` onto every team's `teamSettings`, strips the field from every team vault,
  audits `platform.secrets_update` and notifies the owner
  (`tenant_credentials_changed`). The tenant sees `ManagedCredentialNotice` (status +
  "Kërko ndryshim" → `action: 'request-change'` → `credentials_change_requested` to
  the super-admins, 10-min cooldown). Console: `TenantCredentialsPanel` on
  `/superadmin/tenants/:id`.
- **The AI policy is the platform's too**: `businesses.aiPolicy` (`provider`, `model`,
  `allowPlatformFallback` default true, `disabled` kill switch) via `/api/platform-admin`
  `set-ai-policy`; `resolveAiConfig` honours it. Rules: the owner cannot write
  `aiPolicy` / `credentials*` (86c), a tenant admin cannot write the `has*` flags or
  `aiProvider/aiModel` on `teamSettings` (86b).
- Migration: job `consolidate-business-secrets` (platform-only, dry-run first) moves a
  field to the business when the teams agree on ONE value; different values are
  reported as conflicts (fingerprints only) for the super-admin to resolve.
  Adding a credential? → `SECRET_FIELDS` + `SECRET_FLAGS` + `teamSettingsSecretKeys()` +
  `teamSettingsPlatformKeys()` + `CREDENTIAL_LABELS` + `TenantCredentialField`.

### Security laws (audit Sep 2026 — `workspace/SECURITY_AUDIT_2026_09.md`)

- **An email is an identity only when Firebase says it is verified.** Server
  (`verifiedEmail()` in `api/_callerIdentity.ts`, `_tenantClaims`), rules
  (`verifiedEmail()` on every `token.email` clause) and client (`needsEmailVerification`
  → `VerifyEmailScreen`; `/register` writes nothing before verification) agree. A
  by-email membership match or portal bootstrap for an unverified account is the
  pre-registration takeover the audit found.
- **Authority never comes from a document the caller can write.** `bid` is
  `teams/{tid}.businessId` (immutable), not `membership.businessId`; a team you created
  makes you its Admin only if you are `businesses.ownerId` or already an Admin there;
  `isSelfCreate()` is portal-only and tenant-bound. Every update rule pins
  `businessId`/`teamId`/`userId` (`keepsBusinessId()`); adding a collection means pinning
  them too.
- **A cron job runnable by hand is in exactly one set** (`PLATFORM_ONLY_JOBS` /
  `SCOPED_JOBS` / `BOOTSTRAP_JOBS` in `api/cron/run.ts`); the dispatcher refuses anything
  else for a manual non-super-admin call, and a scoped runner filters by
  `opts.businessId` BEFORE any send. `authorizeManual` checks the role for the resolved
  `bid`, not "Admin anywhere".
- **Nothing that sends, relays or uploads trusts the body for its target**: WhatsApp
  agents are loaded from `whatsappAccounts` and compared with the caller's tenant (Vercel
  AND the VPS `/send`); invite/welcome/report emails derive the recipient from the
  invite/customer record; `actionUrl` is a relative path; redirect/upload hosts pass
  `isPlatformHost` / `trustedFileHost` (`*.fivocrm.com`), never a tenant setting.
- **HTML from users goes through `sanitizeHtml()` (DOMPurify + URL-parsing hook) and
  every `href`/`src` from Firestore through `safeExternalUrl()`** — a regex on the raw
  string misses `java	script:`; parse with `new URL`.
- Storage bucket is deny-all (uploads go to the VPS). Secrets compare with
  `timingSafeEqual`; a missing webhook secret fails CLOSED (503), never open.

### Contact identity & duplicate merge

- **One person, one pair of records.** A contact may legitimately be BOTH a lead and a
  customer; what must never exist is two records for the same person that don't know
  about each other. Matching lives in `src/lib/contactIdentity.ts` + the server mirror
  `api/_contactIdentity.ts`; every write path (CRM, landing form, portal, WHMCS) resolves
  identity through them and cross-links. Portal writes go via `POST /api/link-contact`.
- **Merging duplicates is the repair path** for records that slipped through: pure logic
  (grouping + field resolution) in `src/lib/contactMerge.ts`, execution in
  `api/_merge-contacts.ts` (`POST /api/merge-contacts`, `?type=merge-contacts`).
  UI: `MergeContactsDialog` + `DuplicateContactsPanel`, mounted in CustomersView
  (tab **Dublikatë**) and CRMView (view toggle **Dublikatë**), plus a bulk action when
  exactly two rows are selected.
- Detection **never merges on its own** — it only suggests. A name-only match is refused
  when both records state different emails/phones.
- **The merge is server-side because it spans ~45 collection/field pairs** the acting user
  often cannot read (reports, portal access, conversations). Rules for it: reassign, never
  copy; the absorbed doc is archived to `contactMerges` BEFORE the first write; the
  duplicate is deleted LAST and never when the run was truncated (re-run finishes it);
  portal chat is renamed (`client-<id>` is embedded in the channelId, so it can't be
  re-pointed); a linked lead↔customer pair cascades one level.
- Adding a collection that references `customerId`/`leadId`? → add it to `CUSTOMER_REFS` /
  `LEAD_REFS` in `api/_merge-contacts.ts` and give it a label in
  `MERGE_COLLECTION_LABELS`, or a merge will silently orphan its rows.

### Import Paths
- Use **relative paths** for all local imports (e.g., `'../components/ui/card'`).
- Do NOT use `.tsx` extension in imports — Vite resolves them automatically.
- shadcn/ui components live in `src/components/ui/`.
- Use `@/lib/utils` alias for the utils file inside `components/ui/` files.

### Build / Deployment
- Build command: `npm run build` → `vite build`
- Vercel runs on Linux (case-sensitive filesystem) — import paths must match exact case.
- `dialog.tsx` lives at `src/components/ui/dialog/index.tsx` (moved for Linux compatibility).
- All views are **lazy-loaded** via `lazyRetry()` wrapper for chunk resilience.

### Modules (activation & SaaS plan gating)
- **`src/lib/modules.ts` is the single source of truth** for what a module is: id,
  route(s), label, `permissionKey`, `minPlan`, `optional`, `defaultOff`, group.
- Four gates, resolved together by `moduleBlockReason()`, in this order:
  1. **permission** — the user's role must grant `permissionKey`;
  2. **plan** — `businesses.plan` must reach `minPlan` (`trial` ranks highest so trials
     can evaluate everything; an unknown plan is treated as trial, never as locked);
  3. **locked** — the path must not be in `businesses.lockedModules`: the PLATFORM's
     entitlement layer ("what the contract includes"), written ONLY via
     `POST /api/platform-admin` (`set-modules` / `create-tenant`); the rules deny the
     owner any change to it (test 21b). `ModuleGate` shows "nuk përfshihet në
     kontratën tuaj — kontaktoni FivoCRM", never a link to Cilësimet;
  4. **toggle** — the path must not be in `businesses.disabledModules`: the OWNER's
     own visibility choice (Cilësimet → Modulet), reversible by them.
  Two layers on purpose: with one field the owner could re-enable whatever the
  super-admin had switched off. `ModuleAccessEditor` (superadmin) is the one UI for
  layer 1 — used by TenantDetailView AND CreateTenantDialog — and shows layer 2 as
  information ("Fikur nga pronari", with a one-click "Ndize" support assist).
- `useModules()` reads/writes that state; `<ModuleGate moduleId="…">` guards routes
  (use it **instead of** `<PermissionGate>` — the permission check is in the registry).
- Consumers: Sidebar, MobileBottomNav, CommandPalette, TenantsView (super-admin
  via `ModuleAccessEditor`), `CreateTenantDialog` (super-admin sets the contract's
  modules at creation — `lockedPathsFor()` → `create-tenant` `lockedModules`, plus the
  registry default for `disabledModules`; the server has NO registry copy, so the
  client must always send the lists), Cilësimet →
  **Modulet** (owner self-service via `ModulesSettingsPanel`). Adding a module to
  the registry wires all of them.
- Firestore rules only let the business **owner** write `businesses/{id}`, so a
  non-owner admin gets a read-only module manager.
- **A self-serve signup gets NO modules until the super-admin opens them** (27 Oct
  2026). `createTenant.ts` writes `lockedModules: signupLockedModulePaths()` (every
  optional module) + `moduleSetup: 'pending'`; the `trial` plan ranks above every tier,
  so before this a fresh signup saw the whole product. `/api/sync-claims` (the
  signup's only server hop) notifies every `SUPER_ADMIN_EMAILS` account once
  (`platform_tenant_signup`, deep link `/superadmin/tenants/<id>`, stamp
  `moduleSetupNotifiedAt`); the console lists the tenant in "Kërkojnë veprim" and on
  the tenant page; `set-modules` writes `moduleSetup: 'done'` and notifies the owner
  (`modules_configured`). Rules: a signup may lock anything but can never be born
  `'done'`, and the owner cannot touch `moduleSetup*` (tests 60a/60c). The owner
  sees `ModuleSetupBanner` + "po aktivizohet" copy in `ModuleGate`/Modulet instead
  of "nuk përfshihet në kontratën tuaj". A console-created tenant is `'done'` at birth.

### Shop / Products module (`id: 'shop'`, `minPlan: 'pro'`, off by default)
- Staff: `/app/products` (catalog, inventory, taxonomy tabs) + `/app/shop-orders`.
- Client portal: `/portal/shop` (catalog → cart → order). The "Dyqani" portal nav
  item appears only when the tenant has ≥1 portal-visible product.
- Pure logic lives in `src/lib/shop/` and is unit-tested (no Firestore):
  `pricing.ts` (variant/tier resolution, net-vs-gross tax, order totals, margin),
  `inventory.ts` (stock state, fulfilment checks, movement signs, valuation),
  `variants.ts` (option axes → variant matrix, preserving typed-in data),
  `product.ts` (slug/SKU/order numbering, validation, CSV mapping).
- Stock is never set directly — every change is a `stockMovements` entry, and orders
  decrement stock once, guarded by `shopOrder.stockApplied`.
- Order lines are price **snapshots**, so later catalog edits never rewrite history.

### Hosting & Domains module (`id: 'hosting'`, `minPlan: 'pro'`, off by default)

Full runbook: `workspace/HOSTING_MODULE.md`. Staff `/app/hosting`, portal `/portal/hosting`,
permission `canAccessHosting`.

- **`src/lib/hosting/engine.ts` decides, `api/_hostingJobs.ts` executes.** The engine is
  pure (cycles, `parseDomain`, `deriveCpanelUsername`, `priceOrder`, `decideSubscription`,
  `decideDomain`) and `api/_hostingEngine.ts` is a **byte-identical copy** (test-enforced).
  Every non-action is a named `SubscriptionBlockReason` / `DomainBlockReason` shown on
  the row — never add a silent `continue` to the job loop.
- **`subscriptions` / `domains` are shared with the WHMCS mirror.** `source: 'whmcs'` rows
  are read-only mirrors WHMCS bills (`not-ours`); `source: 'fivocrm'` rows are ours.
  "Merr nën menaxhim" flips a row and leaves `lastInvoicedDueKey` null, so FivoCRM
  invoices the CURRENT due date (pre-claiming it made the lifecycle read the period
  as invoiced-but-unpaid and suspend on the due date). "Shto ekzistues" creates
  provisioned rows without touching a provider; a domain whose `registrar` is not
  `dynadot` is renewed BY HAND after payment (`domain.renewManual` + staff notice).
- **Renewal invoice id = `hst_sub_<id>_<dueKey>` / `hst_dom_<id>_<expiryKey>`**, written
  with `create()`; the order invoice is `hst_ord_<orderId>`. Same law as recurring
  billing: the period is the idempotency token, never a timestamp. `nextDueDate` moves
  only in `applySubscriptionRenewal` (when `currentInvoiceId` == the paid invoice) via
  `addMonthsClamped` with `anchorDay`.
- **Drivers (`api/_hostingProviders.ts`) know nothing about Firestore.** WHM API 1 (POST,
  `Authorization: whm user:token`) and Dynadot api3. Both whitelist IPs, so calls relay
  through the VPS `/provider-proxy` (https + `api.dynadot.com` or port 2087/2083 only)
  when `HOSTING_PROXY_URL` / `WHMCS_PROXY_URL` is set.
- **Credentials:** WHM token → `hostingServerSecrets/{serverId}` (`read, write: if false`,
  written only by `server.saveToken`); Dynadot key → `teamSecrets.dynadotApiKey`
  (`SECRET_FIELDS`, flag `hasDynadotApiKey`). The cPanel password exists ONLY in the
  welcome email; `sub.resetPassword` returns a new one once.
- **Orders are created only by `POST /api/hosting` (`order.create`)** — prices come from
  the catalog, availability is checked live, rules deny browser creates for everyone.
  Paid (Stripe webhook `source: 'hosting'`, or the hourly job noticing a manual
  "Paguar") → `provisionOrder`, idempotent per line (`sub_<orderId>_<i>`,
  `dom_<orderId>_<i>`; an account/domain that already exists is adopted, not recreated).
- **Registrar auto-renew stays OFF**: a domain renews at Dynadot only after OUR renewal
  invoice is paid (`renewedAtRegistrarForKey` guards a double renew). Unpaid → `Grace`
  → `Expired` after `domainGraceDays`; `terminateDaysAfter: 0` disables account
  deletion (`removeacct` deletes files).
- Cron: `hosting-lifecycle` hourly, `hosting-sync` every 6h, from `vps/server.ts`, **NOT
  in `run-all`**; manual runs scoped to the caller's `bid`. Suspended tenants skipped.
- **Security laws** (audit Sep 2026, full table in the runbook §9): a subscription's
  WHM account must prove it serves the row's domain (`assertAccountOwned`) before
  SSO / passwd / suspend / terminate / add / adopt; provider-binding + billing fields
  of `subscriptions`/`domains` are server-only (rules, test 51f) and rows are created
  only by the endpoint; terminate is opt-in (`terminateDaysAfter: 0`) and takes a
  `pkgacct` backup first, refusing to delete without one; portal calls are
  rate-limited (`hostingRateLimits`); the VPS relay only reaches registered WHM hosts
  and never private IPs; secrets are AES-GCM at rest (`api/_secretCrypto.ts`,
  `SECRETS_ENC_KEY`) and a WHM token is bound to the hostname/user it was saved for;
  staff SSO/passwd = Admin/Manager, audited, and the customer is notified.
- **Promotions and money helpers live in the engine too**: `priceOrder` applies the
  product's `freeDomainTlds` rule (first year of ONE matching domain, hosting cycle ≥
  `freeDomainMinCycle`), `applyCoupon` (staff-only `hostingCoupons`, validated by
  `order.quote`/`order.create`, `uses` bumped on order creation), `prorationQuote`
  (upgrade mid-period → invoice `hst_upg_<sub>_<day>` with `hostingUpgrade`, applied
  when PAID; downgrades apply immediately, refund nothing). `src/lib/hosting/finance.ts`
  is the hosting MRR/renewals source for Financat (`monthlyRecurringRevenue` 4th arg).
- **Operations jobs**: `hosting-sync` also emits disk (≥90 %) and drift alerts once a day
  and refreshes Dynadot TLD costs weekly (`syncTldCosts`, margin `hostingTldMarginPct`);
  `hosting-backups` (30 min, 2 accounts/run, `hostingBackupIntervalDays`) writes
  `hostingBackups`; `hosting-expiry-report` (Mon 08:00 local) digests to managers;
  failed provisioning retries with `nextRetryDelayMs` backoff and notifies staff only on
  the first failure and on exhaustion.
- Adding an action? → `api/_hosting.ts` switch (load the record, compare `businessId` /
  `customerId` with claims — never trust ids from the body) + `hostingApi()` caller.
  Adding a collection? → `businessIsolatedAlways` + `teamScopedCollections` + rules +
  test 51x + indexes.

### Invoice ↔ Project link & recurring project billing

- **A recurring PROJECT bills its own fee; the invoice does not recurse.** Two
  independent engines exist and must not overlap: `recurring-invoices` **Part 1**
  drives user-created recurring *invoices* (skips `autoGenerated`), **Part 2** drives
  recurring *projects*. The invoice ProjectsView creates at project-creation time is
  therefore `autoGenerated: true, isRecurring: false`.
- **The idempotency token is the billing PERIOD KEY**, not a timestamp:
  `lastInvoicePeriodKey` on the project (`'2026-08'` monthly, `'W2026-08-03'` weekly)
  is written by BOTH the UI (first invoice) and the cron. The old
  "is `lastInvoiceGeneratedAt` in the current month?" check let the UI's invoice slip
  through unrecorded, so every new retainer was billed — and emailed — twice.
- All "may this project bill?" logic lives in `src/lib/finance/recurringBilling.ts`
  (`projectBillingBlockReason`, unit-tested) and is **mirrored** in `api/cron/run.ts`
  — keep the two in sync. Blocks: terminal status (`Cancelled`/`Archived`, which
  clear `isRecurring`), `isRecurringPaused`, `recurringEndDate`, unsupported
  frequency, `billingType: 'one-time'` (contradicts a cycle), already-billed.
  `Completed` still bills — for a retainer it means "this cycle's work is done".
- **The cron never emails a 0-value invoice.** A retainer with no `budget` (priced
  only via attached services) gets a notification to the responsible user instead;
  a contradictory `one-time` + `isRecurring` setup notifies too, never fails silently.
- **The billing ANCHOR is a property of the series, not of the last occurrence.**
  `invoice.recurringAnchorDay` is written once and read through
  `resolveInvoiceAnchorDay()` (mirrored in the cron). Computing the next due date
  from `nextRecurringDate.getDate()` re-anchors the series on every clamp: a 31st
  retainer went 31 Jan → 28 Feb → 28 Mar → … and billed three days early for the
  rest of the contract. Same law as `recurringAnchorDay` for expenses; never
  overwrite it on edit unless the user changed the date themselves.
- **A recurring invoice IS the first occurrence of its own series**, so the form
  stamps `lastGeneratedPeriodKey` for its own `invoiceDate` period at creation.
  Without that claim, a user-chosen "generate again" date inside the invoice's own
  month produced a SECOND invoice for that month and emailed it. A frequency
  change must RE-EXPRESS the claim in the new frequency, never keep it — keys of
  different frequencies are never equal, so a kept claim guards nothing.
- **The occurrence's document id IS the idempotency guarantee.**
  `recurringOccurrenceId('rec'|'auto', parentId, periodKey)` + `create()` (never
  `set()`): the database refuses a second invoice for the same period, so a failed
  claim write, a died run or a manual trigger racing the cron can no longer produce
  a duplicate. `ALREADY_EXISTS` = record the claim and move on, never a second email.
- **A SUSPENDED tenant must not be billed for, or billed by, the cron.**
  `tenantActive()` in the rules does not protect anything the cron does — the Admin
  SDK bypasses rules — so money jobs must exclude `businesses.status == 'suspended'`
  themselves.
- **Both engines report the periods they missed, and never backfill them**:
  Part 1 `recurringPeriodsSkipped`, Part 2 `billingPeriodsSkipped` (via
  `projectPeriodsSkipped`). Reported in the UI too — a notification alone is
  swallowed when `createdByUserId` is null.
- **A manual money job runs inside ONE tenant.** `?job=recurring-invoices&manual=1`
  is scoped to the caller's `bid` claim (super-admin excepted): `authorizeManual`
  accepts any Admin of any team, so an unscoped run let one tenant generate — and
  SMTP-send — invoices to every other tenant's customers. Any job that *sends*
  something must be scoped the same way.
- **"Will this bill?" has one answer.** MRR / the cash-flow gap / the forecast ask
  the billing engine's predicate, not a hand-written status allow-list — the old
  one dropped `Completed` retainers (which do bill) and kept paused ones.
- **A cancelled invoice owes nothing** (`getInvoiceOutstandingAll`), and
  `getInvoiceCollectedBetween` is the ONLY definition of "cash collected in a
  window". Full audit: `workspace/FINANCE_AUDIT_2026_09.md`.
- **`projectId` on an invoice is optional but consequential**: on the `'invoiced'`
  revenue basis `computeProjectPnl` drops unlinked invoices from revenue while still
  allocating the FULL fixed pool, so unlinked invoices read as loss. That is why the
  result carries `unlinkedInvoices` + `revenueBasis`, InvoicesView has a project
  column + `?project=none` filter, and ProjectDetailView has a **Faturimi** panel
  (billed / collected / outstanding, over- and under-billed guards).
- **Deleting a project never deletes an issued invoice.** The cascade in
  `handleDeleteProject` removes tasks, project comments and *draft auto* invoices,
  and UNLINKS everything else (issued invoices, expenses, timeEntries) — accounting
  documents and payroll history must survive. Adding a collection that references
  `projectId`? → add it to that cascade.
- **`project-spend-rollup` must not touch `updatedAt`** (it writes `spendRolledUpAt`):
  `projectPnl.projectDate()` falls back to `updatedAt`, so bumping it dragged
  un-completed one-time projects into the current month's P&L.

### Project cycles: WORK vs BILLING (Oct 2026)

- **Two independent cycles, one import-free core**: `src/lib/finance/projectCycles.ts`
  (byte-identical copy `api/_projectCycles.ts`, test-enforced). `workCycle`
  (`weekly | monthly | null`) = when the tasks start again; `isRecurring` +
  `recurringFrequency` (`weekly | monthly | quarterly | yearly`) = when the client is
  invoiced. A project without `workCycle` falls back to the legacy coupling
  (`projectWorkCycle()`); every new/edited project writes it explicitly.
  `stopProjectBillingPatch(at, project)` / `archiveProjectPatch` call
  `materializeWorkCyclePatch` first — stopping the invoices must never stop the work.
- **Long cycles are anchored on the contract's start month** (`billingAnchorAt` →
  `startDate` → `createdAt`): keys `Q2026-03` / `Y2026-03`, invoice issued in the
  period's FIRST month on `billingDayOfMonth`, due `invoiceDueDays` later (default 15
  — never the period end). A contract that starts later is `before-contract-start`.
  `budget` stays the fee PER CYCLE; the form computes it as `listMonthlyFee × months ×
  (1 − prepayDiscountPct)` (`projectBillingForm.ts`) and `monthlyFeeOf()` divides it
  back, so every P&L earns 1/12 per month and the rest is deferred
  (`retainerSummary.ts` → Faturimi panel "Paguar përpara"). A frequency OR anchor
  change re-expresses the claim (`reexpressBillingClaim`).
- **`recurring-project-reset` opens a cycle at the start of every period**, idempotent
  on `workCycleLastPeriodKey` (server-owned, rules): Done → Todo, unfinished →
  CARRIED (`carriedOverFromPeriod`, `carriedOverCount`, badge "mbartur"), a recurring
  task is left to its own engine, dates move by the periods that passed. First
  meeting seeds the current period (no mid-month reopen). Every non-reset is a named
  `WorkCycleBlock` in `workCycleLastBlock`. It no longer waits for "all tasks Done".
- Part 2 sends `project_renewal_upcoming` ~30 days before a quarterly/yearly invoice
  (`renewalNoticePeriodKey`, server-owned). Rules test 81k.

### Project archive (the reversible alternative to delete)

- **Archiving never writes `status: 'Archived'` by hand.** All of it lives in
  `src/lib/projectArchive.ts` (`archiveProjectPatch` / `restoreProjectPatch`,
  unit-tested) because `Archived` is a TERMINAL billing status: a hand-archived
  retainer keeps `isRecurring: true` until the cron notices and kills the series,
  so restoring it later gives back a retainer that silently never bills again.
  Archiving therefore stops the cycle itself (`recurringBillingStoppedReason:
  'archived'`) and records `wasRecurringBeforeArchive` so restore can switch it
  back on.
- `statusBeforeArchive` is what makes restore honest — without it every restored
  project flattens to `Active`. Nothing is ever deleted: `project.status` is the
  only answer to "is this archived", and `archivedAt` reads as "last archived at".
- **The archive is a separate shelf, not a status you scroll past.** ProjectsView
  shows live projects OR the archive (toggle **Arkiva**, or the `Arkivuar` status
  filter), never a mix, and archived projects are out of the portfolio KPIs so
  their leftover overdue tasks stop colouring "në rrezik" red.
- Both entry points (the row button / detail-page menu AND the edit dialog's status
  select) go through the same two patches — that is the point of the module.
- **An archived (or cancelled) project's recurring TASKS stop too.**
  `projectRecurrenceBlockReason()` in `src/lib/recurringUtils.ts` runs BEFORE the
  claim in `completeTask` (every caller passes `projects`) and is mirrored in the
  `recurring-tasks` cron; the calendar ghosts skip such series. The tip is left
  Done with `nextCycleCreated: false`, so restoring the project resumes the
  series via the cron — claiming it would kill it for good, the same trap
  `wasRecurringBeforeArchive` exists for. `RECURRENCE_STOPPING_PROJECT_STATUSES`
  is pinned to the billing `TERMINAL_PROJECT_STATUSES` by a test.

### Recurring EXPENSES (same period-key law as project billing)

- **The idempotency token is the period key, never a timestamp.**
  `lastGeneratedPeriodKey` on the parent (`'2026-08'` monthly, `'W2026-08-03'`
  weekly, `'Y2026'` yearly) + `periodKey` on each generated child. The old guard
  (`lastChildCreatedAt >= nextRecurringDate`) killed a series permanently as soon
  as it lagged one cycle: the catch-up child is created "now", which is newer
  than every remaining due date, so the guard stayed true forever.
- **A recurring PARENT is itself a real expense row that counts in its own
  month.** Generation therefore starts in the period AFTER the parent's
  (`firstGenerationDate`), and the UI stamps `lastGeneratedPeriodKey` at
  creation. Without that, a retainer created on the 17th with a due date on the
  30th booked the month twice.
- All of it lives in `src/lib/finance/recurringExpenses.ts` (unit-tested) and is
  **mirrored** in `runRecurringExpenses` / `expenseGenerationBlockReason` in
  `api/cron/run.ts` — keep the two in sync. Blocks: `not-recurring`,
  `auto-generated`, `paused`, `inactive`, `unsupported-frequency`, `no-next-date`,
  `not-due`, `series-ended`, `already-generated`.
- **`status: 'Inactive'` stops a series like a pause** — in the engine AND in
  `isActiveRecurringParent` (the monthly commitment rate). The form's own on/off
  switch used to change nothing at all, so a series the owner had switched off
  kept generating rows every month and kept feeding the cash-flow gap. It never
  touches occurrences already booked: a bill that was paid stays paid.
- **Never `setMonth(+1)` on a date.** The 31st overflows into the month after
  next, silently skipping a month; use `addMonthsClamped` with the anchor day.
- **The cron self-heals a series with no `nextRecurringDate` FORWARD only.**
  Backfilling the months it missed would rewrite closed books — that is the
  owner's call, so the missing months are surfaced in the UI instead.
- Duplicate detection (`findDuplicateExpenseGroups`) only ever SUGGESTS: same
  normalised title + amount + currency + month, `Rejected` rows excluded.
  ExpensesView shows a banner, a "Shiko dublikatat" filter and a per-row badge;
  `scripts/dedupe-expenses.mjs` is the repair path (dry-run by default,
  `--archive` snapshots into `expenseDeduped`, a recurring parent is never
  deleted).
- **`expense.date` is THE booking date** and the form must always write it
  (defaulting to today). Every P&L, chart, cashflow alarm and forecast reads
  `getExpenseDate()` = `date || createdAt`; while the form wrote no `date` at
  all, a July bill entered in August was booked in August with no way to fix it.
  Read it ONLY through `getExpenseDate()` — a bare `e.date` (BonusView did this)
  silently drops every row that has none.
- **`firstGenerationDate` always lands in a period AFTER the parent's.** A
  `!==` comparison is not enough: a date typed in the PAST is also "a different
  period", and the cron then generates one row per missed period — rewriting
  closed books, which `seedNextRecurringDate` documents as the owner's call.
- **Supported cycles are `weekly | monthly | quarterly | yearly`**, declared in
  `SUPPORTED_EXPENSE_FREQUENCIES` and mirrored in `api/cron/run.ts`. Keep
  `FREQ_TO_MONTHLY` a subset of it: `quarterly` used to live only in the table,
  so the cash-flow alarm costed money the engine refused to generate. An
  unknown frequency contributes 0 to the rate, never a default month.
- **Never overwrite `recurringAnchorDay` on edit.** Setting it to
  `nextDate.getDate()` degraded a 31st series to the 28th forever the first time
  any field was touched — the exact drift `addMonthsClamped` exists to prevent.
- **A recurring expense is an ENTITY: `/app/expenses/:expenseId`**
  (`ExpenseDetailView`). The ledger is built from the rows alone by
  `src/lib/finance/expenseSeries.ts` (`buildExpenseSeriesLedger`, unit-tested):
  every period from the parent's own to the current one — `booked` / `missing` /
  `pending` (due later this period) / `upcoming` — plus totals, average, amount
  changes (Δ between consecutive booked periods), paid/unpaid, duplicates, and
  `expenseSeriesHealth` (the engine's block reason in Albanian + monthly/yearly
  commitment). A paused/stopped/inactive series ends at its LAST BOOKED period —
  the months it was off are not "missing". A generated occurrence opens its
  SERIES with that period focused. Title clicks in ExpensesView and a
  **Historiku** button lead there; the page edits through the list's ONE form
  (`/app/expenses?edit=<id>`), never a second form.
- **"Shto manualisht" is the owner's backfill the cron refuses to do**:
  `backfillOccurrenceDraft` writes the EXACT document the cron would have
  (id `rec_exp_<parentId>_<periodKey>` via `create(data, docId)`, same shape;
  `teamId`/`businessId` left `undefined` so the hook stamps them — a literal
  `null` fails `businessOfTeam()` in the rules), `backfillBlockReason` refuses a
  closed month / a future period / a Salary row for a non-approver, and
  `backfillParentPatch` moves the claim/pointer forward ONLY if the period is
  newer than them. A non-approver's row is always `Submitted`.
  `togglePausePlan` (`recurringExpenses.ts`) is the one pause/resume write for
  both the list and the page; `findUnlinkedSiblings` offers same-title rows
  outside the series for linking (never links on its own). Activity rows now
  carry `entityId` (`expense_added` / `expense_updated`) so the page's timeline
  can show who paused/stopped/backfilled.

### Expense attribution & write hygiene

- **`isProjectDirectExpense` / `sumProjectDirectExpenses`
  (`financialAnalytics.ts`) are the ONLY answer to "what did this project
  cost"** — used by `projectPnl`, `departmentPnl`, `staffRevenue`, BonusView,
  ProjectDetailView's burn-down, and mirrored in the `project-spend-rollup`
  cron. ProjectDetailView used a bare `reduce` with neither guard, so the
  project page, `project.spent` and Financat gave three different numbers.
- **A cost must never evaporate.** An expense tagged to a project outside the
  period is POOLED as overhead (and reported via `unallocatedDirect`), never
  dropped: it used to land in a per-project bucket with no row and vanish, so
  `directCost + otherFixed` did not equal the period's expenses.
- **`expense.departmentId` is a `teams` doc id; `project.department` is free
  text.** `computeDepartmentPnl` needs `opts.teams` to join them, otherwise the
  field is write-only (it was, for its whole life) and a department's own cost
  is spread by revenue weight across every department. A team that matches no
  department falls back to the shared pool and is reported
  (`unmatchedDepartmentFixed`).
- **Salary-category rows are in NO expense-ROW total** (`calculateExpensesBetween`,
  `isProjectDirectExpense`, `buildExpensesByMonth`, the `otherFixed` pool). They
  are not "excluded", they are counted ONCE — as payroll, by
  `src/lib/finance/payroll.ts`. Adding them to an expense total AND the payroll
  term is the double-charge every one of those filters exists to prevent.
- **Use `src/lib/formValue.ts` for every form write.** `'__none__'` is truthy,
  so `x || undefined` wrote the sentinel as a real id; and `removeUndefined()`
  strips `undefined` by design, so only an explicit `null` CLEARS a field —
  which is why an expense could never be unlinked from its project.
- **Deleting or re-pointing an expense must flag the project**
  (`spendRollupDirty`). The rollup finds work via `expenses.updatedAt`, which
  structurally cannot see a deleted document or the project a cost moved AWAY
  from; a weekly full pass is the backstop.
- **The approval workflow lives in the RULES, not the UI.** Only
  `isExpenseApprover` (role claim OR membership doc) may write `approvalStatus`;
  a non-approver changing amount/currency/date must send the row back to
  `Submitted`; an approved row is not a member's to delete; `keepsBusinessId()`
  is mandatory. Covered by tests 43–45 in `scripts/firestore-rules.test.mjs`.
  Full audit + what was deliberately left: `workspace/EXPENSES_AUDIT_2026_08.md`.

### Payroll: one figure, two possible sources

- **`src/lib/finance/payroll.ts` is the ONLY answer to "what did the salaries
  cost"**: `payrollForMonth` / `payrollBetween` / `forwardPayrollEstimate`. Every
  consumer goes through it — FinancesView's hero + trend, `projectPnl`'s fixed
  pool, `departmentPnl`'s labour, `cashflowAlarms`, `forecast`.
- **A month with recorded salary payments is costed from those rows; a month with
  none falls back to `monthlySalary`/`salaryHistory`.** Recorded rows win because
  they are what left the bank — including payments to people who are NOT team
  members (freelancers, models), which the plan can never account for. Before
  this, Financat charged the plan into every month while every expense total
  filtered the rows out, so the money appeared on NO Financat line and the
  Shpenzimet page counted it: the two pages disagreed by the whole payroll
  (2.96M ALL, 87% of the tenant's expenses) and the year P&L invented 2.78M.
- **`basis` is returned, never hidden.** `'recorded' | 'profile' | 'none'` is the
  only reason the two pages can still differ, so every surface says which it is
  (hero row note, the reconciliation line under it, `fixedPool.payrollFallbackMonths`).
  A silent fallback reads as a bug — it is a missing data entry.
- **Nobody is charged for a month that ended before they existed.**
  `memberStartDate` = `hiredAt ?? startDate ?? createdAt`; unknown never blocks.
  Without it the plan fallback billed today's salary back to the beginning of
  time (8 months of payroll for a team hired in March).
- **Only the PLAN may be prorated.** `proratedPayroll` scales a month-to-date
  figure only when `basis === 'profile'` — scaling a recorded payment by "days
  elapsed" invents a number nobody paid.
- `departmentPnl` splits the ACTUAL payroll across members using the plan
  salaries as weights (a recorded row identifies its person only when `memberId`
  is set, and most carry just a name), so its labour total always equals
  `projectPnl`'s pool.
- Reconciliation invariant, worth re-checking after any change here:
  **Financat "Rrogat" + "Shpenzime të tjera" == the Shpenzimet page total for the
  same month**, except in a `profile`-basis month. `scripts/audit-expense-totals*.mjs`
  verify it against live data (read-only).

### Client & project profitability (orë × kosto/orë — the owner's "sa fitoj nga çdo klient")

Full runbook: `workspace/CLIENT_PROFITABILITY.md`. Decided 2026-09-21.

- **`src/lib/finance/profitabilityCore.ts` is the import-free core** (settings, cost
  rate, revenue recognition, EAC, alarms, margin bands) and `api/_profitabilityCore.ts`
  is its **byte-identical copy** (test-enforced). The typed engines wrap it:
  `costRates` → `laborAllocation` → `revenueRecognition` → `clientProfitability`,
  `projectBudget`, `capacity`. `projectPeriod.ts` holds the helpers projectPnl and
  departmentPnl used to own (`retainerEarningEnd`, `billingTypeOf`, …).
- **Cost/hour = loaded salary ÷ PRACTICAL client capacity**: `memberSalaryForMonth × (1 +
  employerCostPct)` / (`clientCapacityHours` ‖ rate-card role default ‖ 120). Never
  `salary / 160` again — `laborCost.memberHourlyCost` and the rollup cron both go through
  the core. `hourlyCostRate` stays an explicit override. Settings live in
  `teamSettings.financeSettings` (+ `rateCard`), edited in Cilësimet → **Financat**.
- **`allocateLabor()` is the ONE allocation of people's cost to projects**, by logged
  hours. Invariant: `absorbed + internal.cost + unabsorbed == payrollBetween().total`.
  Unabsorbed payroll (bench, meetings, nobody logged) is overhead, never dropped; hours ×
  rates above real payroll is `overAbsorbed` (the rates are wrong), never a phantom loss.
  `computeProjectPnl` / `computeDepartmentPnl` accept `opts.labor` (+ `timeEntries`) and
  switch to hours (`laborBasis: 'hours'`, overhead by labour hours, one-time revenue by
  effort); without it they are byte-for-byte the legacy engines. **No hours in the period
  ⇒ `basis: 'none'`, shown as "vlerësim"** — same law as payroll's `basis`.
- **Revenue is EARNED, not invoiced**: retainer = fee × months; fixed fee = `contract ×
  min(1, hoursToDate / hoursAtCompletion)` (POC by effort; `remainingHoursEstimate`
  stretches the denominator; Completed trues up; an overrun never inflates revenue);
  no plan but dates → straight-line; nothing → completion month (legacy). Four figures
  side by side: contract / earned / invoiced / collected (`projectWip`).
- **Gross first, overhead after**: earned − pass-through − labour − direct = GROSS (🟢 ≥55 %
  · 🟡 ≥40 % · 🔴), − overhead (other fixed + unabsorbed payroll, by labour hours) = NET.
  Cash is a separate column set. Σ client net + unallocated == company operating profit.
- **Projects are budgeted before they are sold**: `plannedRoles[]` (role, hours, cost
  rate SNAPSHOTTED, optional person) + `plannedDirectExpenses` + `targetMarginPct` →
  price = cost / (1 − margin). `project-spend-rollup` writes `hoursByRole` and fires the
  70/85/100 % alarms once each (`budgetAlertsSent`, type `project_budget_alert`).
  `profitSplit` and `staffRevenue.ts` are gone: staff are cost allocated by hours, not
  shareholders of revenue.
- **Hours enter three ways, one shape**: the daily report's task rows (`hours` →
  `timeEntries` id `${uid}_${taskId}_${date}`, `source: 'daily-report'`), `/app/timesheet`
  + `TimeLogDialog` (`source: 'manual'`), the task timer / Focus (`timer` / `pomodoro`).
  Every row carries `date` (Europe/Tirane day), `costRole`, `customerId`, `isBillable` =
  client work. Rules: own rows only (admin/manager anyone's), nothing in a closed month.
- **Month close** = `financeMonthCloses/{bid}_{YYYY-MM}` (`locked`, snapshot, acknowledged
  warnings), Admin-written, never deleted; `monthCloseChecks()` is the pre-close list.
  `client-profitability-report` (day 2, 08:05 local, VPS, NOT in run-all) nudges managers
  with timesheet gaps + unplanned projects and deep-links `/app/finances?tab=clients`
  (lands on the Fitimi tab; the client table is its first panel).
- **Financat has THREE tabs and ONE revenue basis** (`'earned' | 'collected'`, labels
  Fituar/Arkëtuar) shared by the client table, the department table, the responsible
  fold and the department trend; every engine gets the same `periodRange` ("Ky muaj"
  ends NOW) and the same `labor`. The hero stays cash-of-the-month and says so. Do not
  add a fourth basis or a second period control.
- Adding a cost figure anywhere? → read hours through `allocateLabor`/`laborForEntries`,
  never `project.spent`/`laborCost` (those are the cron's denormalised, current-salary copies).

### Department profit by SERVICE line (one project → several departments)

- **`src/lib/finance/serviceMix.ts` is the only answer to "which department(s) does
  this project / invoice feed"** (unit-tested, `serviceMix.test.ts`). A department is
  a service line = `Service.category`. Project mix: `project.serviceMix` (explicit
  %) → `serviceIds` × catalogue price → `project.department` whole. Invoice mix: its
  own `invoiceItems` (as WEIGHTS — lines rarely sum to the total) → the project mix.
- `computeDepartmentPnl` slices every project by its mix: revenue and direct cost by
  weight, LABOUR by the logger's `teamMember.serviceLines` inside the project's lines
  (`memberLaborSplit`; none/no overlap → the project mix), shared overhead by line
  hours (labour-hours basis) else weight. Σ slices == project, so totals never move.
  `attributeCollectedRevenue` splits cash with the same mix. Without `services` /
  `invoiceItems` both are byte-identical to the old one-department result.
- **Labels go through `labelerFor(services, projects)`** (case/space-insensitive,
  catalogue spelling wins) in BOTH engines — Financat merges the two by label.
- **A project invoice's lines come from `projectInvoiceLines()`**
  (`src/lib/finance/projectInvoiceLines.ts`, import-free; `api/_projectInvoiceLines.ts`
  is a byte-identical copy, test-enforced): the TOTAL split per service (explicit
  `serviceMix` → price weights → one project-name line), summing to the total exactly.
  Used by ProjectsView (first invoice) AND the Part 2 cron — never write a single
  free-text line again, or the invoice can no longer be split by department.
- The split is edited in the project form ("Ndarja sipas shërbimit", Admin/Manager —
  `canSeeBudget`); `cleanServiceMixInput` cleans it, an emptied editor writes `null`,
  a form without the editor leaves the field untouched.

### Finance bug sweep 16 Oct 2026 — laws added

- **Loaded rates, unloaded payroll, a pool that is never negative.** Rows are costed at
  the LOADED rate (salary × (1 + employerCostPct) ÷ capacity). The pool's labour is
  `poolLabor()` = `unabsorbed` (≥ 0) + `laborOutsideRows` — NEVER a signed credit (that
  made every client's overhead negative under the defaults: net > gross). The excess of
  row labour over the unloaded payroll (`overAbsorbed`) is its own reconciliation line,
  `loadCredit` (`loadCreditOf()`; `company.loadCredit`, `fixedPool.loadCredit`,
  `departmentPnl.loadCredit`; panel: "Kontributet e punëdhënësit të ngarkuara mbi pagën e
  regjistruar"). Exact identities (tested): Σ rows' labour + poolLabor == payroll +
  loadCredit; **Σ client net − unallocatedOverhead + loadCredit − directOutsideRows ==
  operatingProfit** (earned basis; same shape for projectPnl / departmentPnl). The
  "kontrollo tarifat" warning reads `overAbsorbedVsLoaded` (vs payroll × load).
- **One person = several rows, resolved PER MONTH.** teamMembers has one row per TEAM
  (sometimes an old Inactive row with its own leftAt/history next to the new one).
  `groupMembersByPerson()` (`salaryHistory.ts`) groups them; money is never read from
  a merged record: salary in month M = max over the rows of `memberSalaryForMonth`
  (`personSalaryForMonth`), employed if ANY row is (`personEmployedInMonth`), override =
  an Active row's `hourlyCostRate` else any row's (`personHourlyCostOverride`); the
  `profile` (Active first, then highest salary, gaps filled) is identity only. Used by
  totalSalaryForMonth, `personCostRate` (allocateLabor + laborByProjectForEntries: rate
  of month M from month M's salary), capacity, buildRateCard, departmentPnl's legacy
  split, and mirrored in the `project-spend-rollup` cron (`costRateForUser`, rate per
  user per booking month). Capacity counts only employed months.
- **Hours = the span for timer/pomodoro rows** (`entryHours`: duration may only shorten
  it; no endTime = open = 0); `duration` is authoritative only for `source: 'manual' |
  'daily-report'`. Mirrored in the cron (`timeEntryHoursServer`). Test fixtures with
  duration and no real span must say `source: 'manual'`.
- **Inactive needs `leftAt`** — `leftAtForStatusChange()` stamps it in TeamsView; the
  `updatedAt` fallback is legacy only (an unrelated edit used to resurrect salaries).
  An empty date box = "nga sot" (`now`), also when the owner EMPTIES a stored date; only
  a legacy Inactive row with no `leftAt` (box loaded empty) freezes its pre-edit `updatedAt`.
- With hours, a one-time project is in the period when it has hours or earned revenue
  there (not only by `updatedAt`). A weekly retainer earns `monthlyFeeOf(p)` =
  budget × 52/12 per month, and its "Kontrata · vlerë" is the same monthly fee × the
  months its span overlaps the period, the running month whole
  (`contractValueInPeriod`); one-time = `budget`. Invoices on a deleted project count as
  unlinked (`unresolvedInvoices`) and FinancesView says so ("N fatura me projekt të
  fshirë · X L" — they have a projectId, so `?project=none` cannot list them). Refunds
  reduce collected in BOTH engines.
- **Customer360's P&L runs the engine over the WHOLE business** (all projects + invoices)
  and picks `clientRowFor(customerId)` — fed only one client's projects, that client
  absorbed the entire company overhead pool.
- Invoice lines carry `serviceLine`; `invoiceServiceMix` reads it first, an
  uncategorised service lands in the project's own department.
- **Month close snapshots the EARNED basis** (`revenueBasis` stored); a snapshot is shown
  only under the same basis. The page CSV/alarms/bridge read the DISPLAYED result
  (`shownClientProfit`). Hero payroll is cut at now like every other month-to-date figure.
- **The snapshot is private.** The lock doc `financeMonthCloses/{bid}_{YYYY-MM}` stays
  member-readable (timesheet/expense lock) and carries no figures (`snapshotPrivate:
  true`); the snapshot goes to `financeMonthCloses/{id}/private/snapshot` (`businessId`,
  `periodKey`, `closedAt`, `closedByUserId`, `snapshot`) in ONE `writeBatch` with the
  close (FinancesView), Owner/Admin read+write in the rules. FinancesView fetches it only
  for admin/owner; `resolveCloseSnapshot()` falls back to the legacy inline `snapshot` of
  old closes, and a re-close deletes that inline field. Reopen touches neither. The day-2
  `client-profitability-report` reads the subdoc first, the inline field second.

### Money rules (Oct 2026 hardening — tests 81a–81j)

- **Money fields are Admin/Manager only, in the RULES**: a project's `projectFinanceKeys()`
  (budget, billing cycle, claim, bank*, serviceMix, plan fields) — a Member may only
  stop/pause/archive/restore and write the first claim; a settled invoice's amounts;
  an invoice's bank keys (any status); delete of a non-Draft invoice; items of a
  settled invoice; teamSettings `bankAccounts`/`financeSettings`/`rateCard` (owner/Admin).
  The UI hides what the rules deny (ProjectsView `financeFields`, InvoicesView
  `invoiceEditLocked`/`invoiceDeleteLocked`, `canEditFinanceSettings`, `taskValue`
  `canEditBudget`; `tasks.value` / `valueAppliedToBudget` via `taskMoneyAllowed`,
  test 84b). Adding a money field? → add it to the key list + a test.
- **Salary rows are unreadable for non-approvers.** Rules are not filters: every
  `expenses` query a non-approver runs must carry `category != 'Salary'`
  (`expenseListQueryOptions(isApprover)`; `deleteCascade` always adds it). In rules use
  direct field access (`'category' in resource.data && …`), never `.get(f, default)` —
  the emulator proved `.get()` lets an unconstrained list through.
- Expenses: own rows only for non-approvers (`createdByUserId`), and a closed month
  (`financeMonthCloses`) blocks create/delete/booking changes (month read from the
  timestamp +2h — documented approximation). Month-close snapshot lives in
  `financeMonthCloses/{id}/private/snapshot` (owner/Admin), the parent stays member-readable.
- Known gap (deliberate): the portal still receives whole project docs, internal cost
  fields included — fixing it means moving them to a staff-only `projectFinance/{id}`.

### Finance audit 30 Sep 2026 — laws added (`workspace/FINANCE_AUDIT_2026_09_30.md`)

- **Labour that lands on no row is overhead, never dropped.** `allocateLabor` splits
  payroll into absorbed / internal (no project) / unabsorbed; every consumer pools
  `unabsorbed + laborOutsideRows()` (internal hours + hours on projects that got no
  row in the period). Invariant: Σ rows + pool == payroll. `clientProfitability`
  reports `company.poolLabor` / `directOutsideRows` so the reconciliation sentence
  is an identity, not a hope.
- **EAC, `consumedPct` and the budget alert are cumulative** (all-time hours via
  `laborByProjectForEntries`, all-time direct expenses), never period-relative — the
  plan is for the whole engagement. A month with no hours must not read as 99 %.
- **A month the period END cuts short earns its elapsed share** (`retainerRevenueInPeriod`
  prorates by `monthCoverage`, exactly like `proratePlanPayroll`); month-end periods are
  byte-identical to before.
- **`timeEntries.date` IS the booking day** in the engines too (`entryInstantMs` reads
  the well-formed `YYYY-MM-DD` first, then `startTime`, then `createdAt`) and the rules
  require it on create and update — so the month lock and the P&L agree on the day.
- **A month can be closed only after it ended** (`monthCloseBlockReason` in
  `src/lib/finance/monthClose.ts`), by an Admin/owner (not Manager), and can be
  reopened (`reopenMonthPatch`: `locked: false` + `reopenedAt`, via `update` so the
  snapshot survives). While locked the client table renders the SNAPSHOT and says by
  how much live differs.
- **Recurring expenses follow the invoice engines' law now**: deterministic occurrence
  id `rec_exp_<parentId>_<periodKey>` + `create()`; only the period containing `now` is
  generated; a lagging series is `'stale-period'` (skipped, reported on the parent as
  `recurringPeriodsSkipped`, pointer advanced) and a `financeMonthCloses` lock blocks
  the row (`'month-closed'`). Pause → resume re-seeds `nextRecurringDate` forward in the
  UI too. Yearly steps are months-clamped (29 Feb stays in February).
- **Settlement is Admin/Manager work.** Rules (`invoiceSettlementAllowed`) deny a
  Member `status` Paid/Partial/Cancelled, `paidAt/paidAmount/partialPayments`, the
  `payments` ledger and the WHMCS/Stripe sync fields; `projects.spent/laborCost/
  hoursByRole/spendRolledUpAt/budgetAlertsSent` are cron-only; `counters` are keyed by
  BUSINESS id and monotonic; a `Salary`-category expense is approver-only, and
  re-tagging `category/projectId/departmentId` on an Approved row sends it back to
  Submitted. The UI hides what the rules deny (`canSettleInvoices`).
- **Reverting a settlement clears its ledger** (`invoiceStatusTransition` in
  `src/lib/finance/invoiceStatus.ts`): Paid/Partial → Pending/Draft/Cancelled deletes
  the invoice's `payments` rows and nulls `paidAt/paidAmount/partialPayments`; Cancelled
  on a WHMCS mirror sets `locallyCancelled` so the sync does not resurrect it.
- **The Stripe webhook queues the WHMCS write-back** in the same transaction that marks
  Paid/Partial (`whmcsPendingPayments`, key `full`/`p<i>`), then drains; a failure
  leaves the queue non-empty so `upsertInvoice` keeps the local status. An amount
  mismatch books the money actually received (ledger row + Partial/Paid), never nothing.
  Escalations for `createdByUserId: null` invoices go to the owner + managers.
- **The recurring-invoice form never anchors on the auto-filled due date**
  (`resolveRecurringSchedule`: an explicit pick wins, else stored, else invoiceDate + 1
  cycle). Resume/re-enable paths re-point the claim to the PREVIOUS period
  (`resumedInvoiceClaimPatch` / `resumedBillingClaimPatch`) so nothing older is reported
  as "skipped" and the current period bills once.
- **Every retainer says why it did not bill**: Part 2 stamps `billingLastBlock` +
  `billingLastCheckedAt` (written only on change); ProjectDetailView's Faturimi panel
  shows "Kontrolli i fundit … — Pret ditën e faturimit (25)". Part 1 and Part 2 run in
  separate try/catch (`part1Error`/`part2Error`), `recordJobRun` flattens sub-job
  results one level so `platformJobRuns` shows `recurringInvoices.legacyCreated`, and
  the VPS calls `recurring-invoices` (07:00 local) and `recurring-expenses` (07:10) on
  their OWN tick before run-all — run-all is 27 jobs in one 60 s invocation and a kill
  there used to leave no trace. `scripts/audit-retainer-billing.mjs --at=<iso>` answers
  "why did this retainer not bill on that day" from live data (read-only).
- `invoice-reminders` keeps `Partial` as the stored status (notice once via
  `overdueNoticeSentAt`); budget alarms record every crossed threshold at once
  (`budgetAlertsDue`), so a jump 60 → 105 % fires one 🔴, not a descending cascade.

### FivoAI provider layer (`api/_aiProvider.ts` + `api/_aiErrors.ts`)

- **`resolveAiConfig()` is the one answer to "which key, which provider, which model"**
  for chat (`ai-chat.ts`), the WhatsApp draft (`_aiReply.ts`) and GMB replies (`_gmb.ts`):
  tenant key from `teamSecrets.aiApiKey` (+ `teamSettings.aiProvider` / `aiModel`), else
  the platform env `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`; the
  preferred provider goes first, then every other provider with a key (`providerOrder`).
  **The key's SHAPE decides the provider** (`AIza…` = Gemini, `sk-ant-…` = Anthropic —
  tested BEFORE `sk-…` = OpenAI, which it also matches;
  `resolveProviderChoice` in the import-free `_aiErrors.ts`): the Settings form stores
  `aiProvider` apart from the key, so an OpenAI key saved under "Gemini" was sent to
  Gemini, refused as "API key not valid", and surfaced as an opaque 500. On a mismatch the
  stored `aiModel` is ignored too (typed for the other provider) and `providerMismatch`
  is logged.
- **A failed provider call is never an opaque 500.** `classifyAiError()` maps it to a
  named code + status + Albanian sentence (`invalid-key` 502, `model-not-found` 502,
  `rate-limited` 429, `timeout` 504, `not-configured` 503, `bad-request`/`upstream` 502)
  and the redacted provider message travels as `detail`; when both legs fail the PRIMARY
  (tenant-key) error is reported. Every browser caller reads it through
  `aiResponseError()` (`src/lib/aiClient.ts`) — never `throw new Error(\`HTTP ${status}\`)`.
  `ai-chat.ts` has `maxDuration: 60` in `vercel.json` (provider timeout is 25 s + a
  fallback leg; the platform default would cut it off first). Tests:
  `src/lib/aiErrors.test.ts`.
- **Anthropic (Claude) goes through the official `@anthropic-ai/sdk`** (Oct 2026;
  Gemini/OpenAI stay on `fetch`), `maxRetries: 0` (our fallback IS the retry), default
  model `claude-opus-5-5` (`ANTHROPIC_MODEL`). No `temperature` (5.x rejects sampling
  params); on 4.6+ models `output_config.effort: 'low'` and `max_tokens` gets
  `ANTHROPIC_THINKING_HEADROOM` on top of the reply cap because thinking counts
  against it; the history is trimmed to a `user` first turn with non-empty text. Opus 5
  / Fable 5 / Sonnet 5.5 are called on the beta endpoint with `fallbacks: 'default'`
  (a safety decline is re-run on another Claude server-side); a bare
  `stop_reason: 'refusal'` throws `code: 'ai-refusal'` → classified `refused` (502),
  never "invalid key". The form's radio cards / links / placeholders come from
  `AI_PROVIDER_META` (`src/lib/aiClient.ts`) and a pasted key re-selects its provider.
- **Prompt caching is opt-in per caller** (1 Nov 2026): `generateChatWith` takes a
  `SystemPrompt` = string | `{ stable, dynamic }`. Only the split form gets
  `cache_control: ephemeral` on the `stable` block (Anthropic); Gemini/OpenAI get the
  two joined. `stable` must be byte-identical between calls (persona, rules, facts,
  JSON contract) — a clock, a name or an id in it turns every call into a cache WRITE
  (+25 %). Ana uses it (`buildSalesAgentPromptParts`, test-pinned); `cacheReadTokens` /
  `cacheWriteTokens` land on `salesAgentRuns` + `aiUsageLogs`. A plain-string caller
  is unchanged.

### WhatsApp via Baileys (VPS): agent lifecycle & honest send status

- **Firestore `whatsappAccounts` IS the agent set.** `vps/server.ts` mirrors it live
  (`watchAccounts` → `reconcileAgents` → `unloadAgent`): deleted → `logout()` + session
  wiped, `enabled: false` → socket closed, session kept. `agent.unloading` stops the
  reconnect loop. Before this, deleting an account in Cilësimet removed only the
  document; the VPS kept the socket alive until the next restart and `getAgent()`
  (first connected agent) kept sending through it — messages left from a number nobody
  managed any more, "sent" in the CRM and absent from the user's phone.
- **`sendMessage()` resolving proves nothing.** Baileys only wrote the stanza to the
  socket. `/send` generates the id itself, writes `status: 'pending'`, waits ≤6s
  (`SEND_ACK_TIMEOUT_MS`, under the relay's 10s abort) for the server ack (status 2)
  → `sent`; 0 or a closed socket → `failed` + `error`. `messages.update` maps
  0/2/3/4/5 and never downgrades a status. The UI shows the WhatsApp vocabulary:
  clock / ✓ / ✓✓ / ✓✓ green / Dështoi — never ✓ for a row WhatsApp did not accept.
- **"Lidhur" comes from the socket, not from `connectedPhone`.** The VPS `/status`
  returns `{ agents }` (+ `connectedPhone`), `api/whatsapp.ts?action=status` relays it,
  `useWhatsAppStatus` polls it, and Cilësimet renders that; `connectionStatus` /
  `lastDisconnectedAt` on the doc are the offline fallback. Baileys' own logger is
  `warn` (`BAILEYS_LOG_LEVEL`) — `silent` hid every send failure for a year.
- WhatsAppChatPanel now sends the conversation's `agentId` (last inbound → last
  outbound → connected agent of the team). `/send` without one still picks by team.

### WhatsApp hardening (Oct 2026 — every sender, both channels)

- **One phone rule**: `src/lib/messaging/waPhone.ts` (`toWaPhone`; byte-identical
  `api/_waPhone.ts`, the VPS carries the same rules). `069…`/`69…`/`00355…`/`3550…` →
  `355…`. Never write another normaliser.
- **One agent picker**: `api/_waAgent.ts` (`pickWaAgent` in `_waSend.ts`): connected
  first, then same team; preferred only if connected; legacy accounts found via
  `teams.businessId`. Always send with the AGENT's teamId.
- **Opt-out is per PHONE, every sender honours it**: STOP/NDALO sets `waOptOut` on every
  lead+customer of the business with that phone, START/FILLO clears it; campaigns,
  automations, lead reminders, follow-ups and invoices block `opted-out`. A number
  WhatsApp rejects is stamped `waUndeliverablePhone` (re-armed when the phone changes).
  Portal clients cannot write `waLid`/`waOptOut*`/`waUndeliverable*` (rules test 50a).
- **Nothing is "sent" before it is sent**: stamps, counters, escalations and timeline
  rows happen only after a successful result. Errors are classified once
  (`isPermanentWaError` / `isUndeliverableNumberError` / `isChannelWaError`).
- **Idempotency everywhere**: VPS `/send` takes `idempotencyKey` (24h); keys are
  deterministic (`inv_<id>_<stage>_<n>`, `bc_<broadcast>_<phone>`,
  `auto_<rule>_<phone>_<day>`, `fu_<lead>_<day>`). Inbound claims
  `waInboundEvents/{key}` (`Idempotency-Key` header / `meta_<wamid>`); the VPS keeps a
  durable `waInboundOutbox`. WA crons run under `withJobLease` (`api/_jobLease.ts`).
  Broadcasts claim `inFlightPhones`, write `sentPhones` per message, record
  `failedPhones` (permanent / 3 attempts) so a bad head never stalls the queue.
- **Row ids**: Baileys rows are `${agentId}_${waMessageId}` (two of our numbers no longer
  overwrite each other); Meta rows are the wamid (cron included) so status callbacks
  land. Meta status never regresses. Automated rows carry `automated`,
  `automationKind`, `source` (badged in the UI, and auto-reply is blocked
  `reply-to-automated` for 72h after one).
- **Quiet hours** 09:00–20:00 Tirane for broadcasts/automations; SLA counts business
  minutes only (`businessMinutesBetween`). Staff get `whatsapp_send_failed` (per run,
  throttled) and `whatsapp_disconnected` (from conversation-sla).
- **VPS**: reconnect by `DisconnectReason` (401/440/403/500 stop and say why in
  `connectionStatus`), `onWhatsApp` check before a new number (422 `not-on-whatsapp`),
  raw `CB:ack` = sent, `pending` > 10 min → `failed/no-ack`, per-agent send queue
  (≥1.2s), LID resolved via `senderPn`, LID lookups ≤ once/24h, `getMessage`,
  `markOnlineOnConnect: false`. `npm run prod` now BUILDS first — the old
  `dist/server.js` was months stale.
- **Inbound media is DOWNLOADED, not described** (26 Oct 2026). Until then a photo
  reached the CRM as the text "[Foto]" — the stanza was classified `media` and never
  fetched, on both channels. `attachInboundMedia` (`vps/server.ts`) runs AFTER the
  row's `create()` (never delays the message or its notification), both directions
  (a photo the staff sent from the phone belongs in the thread), only for
  image/video/ptv/audio/document/sticker, ≤ 15 MB, 45 s timeout, and stores under
  the SAME policy as `/upload` (allow-listed extension chosen by the magic bytes,
  UUID name, `<UPLOAD_DIR>/<teamId>/whatsapp-media/`), URL base `PUBLIC_URL`
  (fallback `https://vps.fivocrm.com`). Row gets `mediaType/mediaUrl/mediaMime/
  mediaFilename/mediaSize`; a failure is `mediaError` on the row and the text stays.
  Meta inbound media is still not downloaded (no phone, needs the Graph media API).
- **Baileys 7 (`7.0.0-rc14`, pinned exactly) since 23 Oct 2026.** 6.7.x cannot
  encrypt 1:1 for LID-migrated contacts → "Waiting for this message". Inbound
  resolves LID via `remoteJidAlt` → Baileys' `signalRepository.lidMapping` →
  6.x `senderPn`; keys go through `makeCacheableSignalKeyStore`.
  `vps/scripts/patch-baileys.mjs` (postinstall, idempotent, version-guarded)
  fixes upstream #2781 (a 1:1 retry resend encrypted twice → 479). Re-check it
  on every Baileys bump. A NACK from one of OUR devices (`isOwnDeviceJid`) never
  fails the row (479 → `assertSessions(force)` hourly); a ✓✓ beats `failed`.
- **pm2 is the ONLY process manager on the VPS.** A systemd `whatsapp-vps.service`
  (`npm start`) ran the server too until 23 Oct 2026 — whichever won port 3001
  was live, the other crash-looped, and `pm2 restart` changed nothing. It is
  disabled; `pm2-root.service` is enabled. Two processes on one auth dir corrupt
  the Signal state for good: the fix was a fresh QR pairing.

### WhatsApp campaign automation (conditions + variants + evergreen rules)

- **`src/lib/marketing/waAutomation.ts` is the rules engine** (pure, unit-tested)
  and is **mirrored** in `api/cron/run.ts` (`waBlockReason`,
  `resolveWaCampaignTargets`, `sendWaCampaignBatch`) — `api/` never imports from
  `src/`. If the two drift, the target count the user approved is not the count
  that goes out. Full runbook: `workspace/WHATSAPP_AUTOMATION.md`.
- **`waSendBlockReason()` is the only gate.** Every filter returns a NAMED reason
  (`contacted-too-recently`, `no-notes`, `no-variant`, …) instead of a silent
  `continue`, so the builder can show "1 240 shqyrtuar → 340 target, 900
  kontaktuar së fundmi" and `lastRunBlocked` records it per run. Never add a
  filter inline in the cron loop.
- **The dormancy window IS the cooldown.** An evergreen rule
  (`trigger: 'dormant'`, `status: active⇄paused`, job `whatsapp-automations`)
  keeps NO per-person enrollment record: sending resets the contact's
  last-contact date, so a `lastContactMinDays: 30` rule can't reach them again
  for 30 days. Turning that into a permanent `sentPhones` list would silently
  make a recurring rule fire once per contact, ever. One-shot campaigns
  (`trigger: 'manual'`, job `whatsapp-broadcasts`) DO use `sentPhones`.
- **`createdAt` is not a contact.** `resolveLastContactAt()` reads the newest of
  the last WhatsApp message, `lastActivityAt`, `lastFollowUpDate`,
  `firstResponseAt`. An imported lead nobody touched is "never contacted" —
  maximally dormant, unless `requireContacted` or a `lastContactMaxDays` ceiling
  is set.
- **The dormancy query only reads INSIDE the window**
  (`recentWaContactsByPhone`: `teamId` + `createdAt >=` cutoff, existing
  `(teamId, createdAt DESC)` index) — anyone absent was not contacted in it. It
  is skipped entirely when no dormancy condition is set. Truncation can only
  under-exclude, never leak, and logs.
- **Variants, not one body**: `variants[]` is picked by the CONTACT's tags (most
  specific match wins; `tags: []` = fallback), each with its own `landingUrl`.
  Tokens `{{name}} {{company}} {{notes}} {{service}} {{link}}`; an unknown token
  renders EMPTY (never leak `{{foo}}` to a customer), and a missing `{{link}}`
  appends the link instead of dropping it. `{{notes}}` is `summarizeNotes()` — the
  first de-noised line, capped — not a paste of the CRM.
- **Free-text variants are Baileys-only** — Meta delivers approved templates
  only. Meta still personalizes via `waTemplates.paramFields`, which now accepts
  the pseudo-fields `firstName`/`notes`/`service`/`link`.
- `whatsapp-automations` is **NOT in `run-all`** — it messages real people
  unprompted, so it fires on a chosen hour: `scheduleDailyInZone(CRON_LOCAL_TZ,
  10, 0, …)` in `vps/server.ts`. Nothing goes in `vercel.json` (it has no `crons`
  block — the schedule lives on the VPS; only the job LOGIC is on Vercel). A
  broken rule is PAUSED, never left retrying forever.
- **A campaign send STAMPS the lead** (`stampWaCampaignTouch`: `lastActivityAt`,
  `lastFollowUpDate`, `waAutoReminderAt` + a `leadActivities` row). This is not
  cosmetic: the older team-wide reminder (`lead-wa-auto-reminders`, configured in
  `WhatsappAutomation.tsx` → `teamSettings.waAutoReminder*`) decides from those
  lead fields ALONE and never reads `whatsappMessages`, so without the stamp both
  jobs would message the same lead days apart. The two features coexist — the old
  one is a single team-wide rule, these are many per-service ones.

### CRM automation rules (leads + customers: trigger → conditions → actions)

- **`src/lib/crm/automationRules.ts` is the engine** (pure, 36 tests) and
  `api/_crmAutomationEngine.ts` is a **byte-identical copy** — the test reads both
  files and fails on any difference, so "keeping them in sync" means copying the
  file. The cron (`api/_crmAutomationJob.ts`, `?job=crm-automations`, hourly from
  `vps/server.ts`, NOT in `run-all`) only fetches facts and executes actions; it
  never decides on its own whether something fires. Runbook:
  `workspace/CRM_AUTOMATION.md`.
- **Every non-firing is a named `AutomationBlockReason`** (`terminal-status`,
  `not-due`, `predates-rule`, `already-fired`, `cooldown`, `condition-failed`,
  `run-cap`), counted into `lastRunBlocked` and shown on the rule card. Never add a
  silent `continue` to the job loop.
- **The run doc is the idempotency guarantee**:
  `crmAutomationRuns/{ruleId}_{entityId}_{fireKey}` via `create()` BEFORE actions
  run; `ALREADY_EXISTS` = skip. The collection is `write: if false` (a client
  delete would re-arm an occurrence, a create would silence it). Fire keys:
  `created`, `stage:X`, `inactive:<day>`, `unassigned:<hour>`, `no-response`,
  `invoice:<id>` (one per overdue invoice).
- **The window is the cooldown** (same law as WA dormancy) and **nothing is
  retroactive unless `enrollExisting`** — `predates-rule` blocks records born (or,
  for `lead_stage`, last changed) before the rule existed. Recipes ship
  `status: 'paused'`, `enrollExisting: false`.
- Reads are per tenant and only for tenants with an active rule (invoices /
  projects only when a trigger or condition needs them); suspended tenants skipped;
  manual runs scoped to the caller's `bid`. A thrown rule is PAUSED with `error`;
  a failed action is recorded on the run doc, never thrown.
- Adding a trigger/condition/action? → the engine's union + `*_META` table +
  `validateRule` + (actions) `executeAction` in the job + a test. The UI
  (`AutomationRulesPanel`, CRM view toggle **Automatizime**) renders from the META
  tables, so it needs no change for a new condition field.

### Nazmije — the virtual secretary (chat bot for STAFF only)

Runbook: `workspace/NAZMIJE.md`. Built 2 Oct 2026 (phases 0–2; the CRM-automation
action and "actions with confirmation" are open).

- **`src/lib/nazmije/core.ts` decides, `api/_nazmije.ts` executes.** The core is
  import-free (persona prompt, 46 work sayings, humour bank, `nazmijeBlockReason`,
  role-filtered facts, deterministic digests) and `api/_nazmijeCore.ts` is a
  **byte-identical copy** (test-enforced). Numbers never come from the model: the
  digests are templates, the reply prompt only sees `renderFactsForPrompt()` output.
- **She has NO Auth user and NO `teamMembers` row** (a row would hit seats, payroll,
  `daily-report-check` and every assignee picker). Only `userProfiles/nazmije_<bid>`.
  ChatView injects `NAZMIJE_UID` by hand when `teamSettings.nazmije.enabled`; a DM to
  her goes THROUGH `POST /api/nazmije` (`action: 'ask'`, the server writes both rows —
  the rules cannot prove a bot uid is in the tenant); a group `@Nazmije` is written by
  the browser and only the reply is requested. `notifyUser()` answers `skipped: 'bot'`.
- **Law 4 in code:** `factsForAudience()` strips finance unless DM + Admin/Manager
  (claims `roles` / membership role), and strips the missing-report NAMES in a group.
  Humour: `humorModeFor()` — the model may improvise only on `full`, in a group, in
  the morning/weekly post; the bank never takes a person's name (tested).
- **Scheduled from `vps/server.ts`** (`nazmije-morning` 08:45, `-afternoon` 16:00,
  `-weekly` 16:30 local; the job answers `not-friday` on other days), `SCOPED_JOBS`,
  NOT in `run-all`. Idempotent per tenant/day/kind: `nazmijePosts/{bid}_{date}_{kind}`
  via `create()`. `nothing-to-say` is silence, never "asgjë sot". Every non-post is
  written to `teamSettings.nazmije.lastRun` and shown in Cilësimet → Automatizimi.
- Replies: 20/user/hour (`rateLimits`), `dailyReplyCap`/tenant/day (`nazmijeUsage`),
  tenant AI key via `resolveAiConfig`; a provider failure posts a fixed line, never a
  500. Per-user opt-out: `userPreferences.nazmijeOptOut` (Cilësimet → Njoftimet).
- The StaffDashboard "quote of the day" IS her saying (`sayingForDay`); the portal
  keeps its own quotes — she never speaks to clients.

### Ana — the virtual SALES agent (talks to CLIENTS; module `sales-agent`)

Runbook: `workspace/SALES_AGENT.md`; plan + laws: `workspace/SALES_AGENT_PLAN.md`.
Built 31 Oct 2026. `minPlan: 'business'`, `defaultOff`, permission `canAccessSalesAgent`.
Nazmije speaks to staff, Ana speaks to clients — they never merge.

- **`src/lib/salesAgent/core.ts` decides, `api/_salesAgent.ts` executes.** Core +
  `prospecting.ts` are import-free; `api/_salesAgentCore.ts` / `api/_salesAgentProspecting.ts`
  are **byte-identical copies** (test-enforced). Numbers never come from the model:
  prices/hours/policies are FACTS (`renderSalesFacts`: `services` + `salesKnowledge` +
  `waAiContext`); a price the facts do not state → handoff `custom-price`.
- **Autonomy opens in LEVELS** (`teamSettings.salesAgent.autonomy`, capped at
  `SALES_AGENT_MAX_AUTONOMY` = 2 — env `SALES_AGENT_MAX_AUTONOMY` raises it): 0 =
  drafts only (default; the old "no auto-send" decision), 1 = FAQ answers outside
  office hours / after `humanSilenceMinutes`, 2 = qualifies + books + sequences.
  `decideDelivery()` is the ONE send/draft/handoff decision (deterministic triggers →
  model handoff → custom price → no-progress → level → intent allow-list →
  confidence 0.8/0.4). `ensureDisclosure()` puts "asistentja virtuale" on the first
  message (law 8, not switchable).
- **Every non-action is a named `SalesAgentBlockReason` / `ColdWaBlockReason` /
  `HandoffReason`** with an Albanian label, written to `salesAgentRuns` (`create()`
  BEFORE acting — the idempotency doc, `write: if false`) and tallied in
  `teamSettings.salesAgent.lastRun`; `/app/sales-agent?tab=today` shows "Pse nuk veproi".
- **Inbound**: `_waInbound.ts` step 7 answers `agent-active` (legacy auto-reply off)
  and step 8 calls `runSalesAgentOnInbound` instead of `draftWaReply` when the module
  is on. Sends carry `automated: true, automationKind: 'sales-agent', source:
  'sales-agent', idempotencyKey 'sa_<conv>_<msg>'`; state in `conversations.agent`
  (server-only; staff handoff/resume ONLY via the endpoint) and `leads.agent*`
  (server-only, `leadAgentKeys*()` in the rules).
- **Cold WhatsApp is allowed but metered PER SENDER NUMBER** (owner decision):
  `coldWaBlockReason()` — ≤ `perDay` (max 10), ≥ `minGapMinutes` (min 60), window +
  weekdays, warm-up (3/day for a young number), never on the registration day,
  `onWhatsApp`-verified, opt-out; 1 failure/24h halves the quota, 2 pause the sender
  7 days (`salesAgentSenders/{bid}_{agentId}`, `sales_agent_paused`). ONE attempt per
  sender per 15-min tick. A human "send now" goes through the same gate.
- **Google Places (New) Text Search bills per REQUEST (≤ 20 results)**, Enterprise SKU
  ($35/1 000, 1 000 free/month per Google project). Only `placeId` is stored
  indefinitely; unregistered `prospects` expire after 30 days (`sales-agent-prospect-ttl`).
  Budget per tenant in requests (`placesMonthlyBudget`, usage in
  `salesAgentUsage/{bid}_{YYYY-MM}`); `searchBlockReason` refuses over budget.
  Registering a prospect goes through `_contactIdentity` (law: one person, one pair).
- Jobs (`api/_salesAgentJobs.ts`, VPS, NOT in run-all): `sales-agent-prospecting` +
  `sales-agent-cold-wa` every 15 min, `sales-agent-nudges` hourly (+ handoff SLA
  escalation), `sales-agent-digest` 08:15 local, `sales-agent-prospect-ttl` 03:30
  (platform-only). Manual runs scoped to `bid`; suspended tenants skipped.
- Adding an action? → `api/_salesAgent.ts` switch (load record, compare `businessId`
  with claims) + `src/lib/salesAgent/api.ts`. Adding a collection? → the usual six
  places (tests 85a–85h are the pattern). Open: `meeting.book`, `quote.draft`, cold
  EMAIL drain, portal/landing channels, level 3.

### Daily staff report (mandatory, 16:50)

- **One form, two mounts.** `DailyReportForm` is the ONLY place the daily questions
  are rendered — `DailyReportPopup` (the employee, on schedule) and
  `DailyReportPreviewDialog` ("Shiko si punonjës", admin) both mount it. A second
  copy would drift the first time a field is added, and the preview would then show
  a form nobody fills.
- **The report is the day's PLAN, answered.** Every task the day planned becomes a
  `DailyTaskOutcome` (`done` / `in_progress` / `not_started`), and the two unfinished
  states REQUIRE a `reason`. That rule is the feature: before it, an untouched task
  simply vanished from the report. Pure logic in
  `src/lib/productivity/dailyReportPlan.ts`; `completedToday`/`openItems` are
  GENERATED from the rows and stay editable, so every existing reader still works.
- **Questions are declared once**, in `src/lib/productivity/reportTemplates.ts` —
  the same registry that defines the position picker, so a new craft can never exist
  without its questions. Each template runs Output → Impakt → Rrezik → Hapi tjetër.
- **Per-client answers live in the SAME flat `customFields`**, keyed
  `"<field>.<customerId>"` (`perClientKey`). Never read `customFields[key]` for a
  summable field — use `sumFieldValue()`, or per-client answers silently total 0.
  The client list is DERIVED from the answered tasks, never typed twice.
- **Timing is one source of truth**: `DAILY_PROMPT_*` (16:50) and `DAILY_DUE_*`
  (17:30) in `DailyReportForm`. These used to disagree (popup 16:45, `dueAt` 18:00),
  so `wasLate` never fired and the accountability dashboard reported 0 late reports
  forever.
- **There is no "Më vonë".** Closing the dialog leaves a permanent banner, and
  `?job=daily-report-check&stage=remind|escalate` (`api/cron/run.ts`) notifies the
  person at ~17:35 and their managers at ~18:35. `stage` is explicit because the
  server does not know the tenant's timezone — the VPS scheduler decides, via
  `scheduleDailyInZone(CRON_LOCAL_TZ, …)` in `vps/server.ts`. Use that, never
  `scheduleDailyUtc`, for anything that is a wall-clock promise to a person: Albania
  shifts an hour twice a year, and a UTC-pinned deadline escalates before it is due
  all winter. Idempotent
  per tenant/day/stage via `dailyReportMisses/{businessId}_{date}`, which is
  `write: if false` (a person who skipped the report must not be able to erase the
  evidence). NOT part of `run-all`.
- **Quality is advisory except where something is missing**
  (`dailyReportQuality.ts`): only unanswered required fields and unexplained
  unfinished work block submission. A declared absence (`leave`/`sick`/`holiday`)
  waives the whole form.
- Adding a field to a template? → nothing else to touch. Adding a `required` one?
  → keep the per-template total under ~12 fields and ≤4 required (the tests enforce
  both) — the daily habit dies the moment it stops being a 60-second job.
- Full runbook, crontab lines and limitations: `workspace/DAILY_REPORTS_V2.md`.

### Reporting & Accountability module (`id: 'reporting'`, `minPlan: 'pro'`)

- Staff: `/app/reports` (+ `/reports/:id`), `/app/report-templates` (config: templates,
  KPI, schedules), `/app/accountability`, `/app/client-health`.
  Client portal: `/portal/reports`.
- **`dailyReports` was EXTENDED, not replaced** — it stays the daily staff submission
  (StaffDashboard, DailyReportPopup, Momentum all keep working). The new `reports`
  collection is the versioned, block-based document behind weekly/monthly/quarterly
  and client-facing reports; daily reports FEED it.
- **The leak boundary is one function.** Portal, PDF and email all render
  `redactForClient()` output (`src/lib/reporting/visibility.ts`). `CLIENT_VISIBILITIES`
  is a closed allow-list, a new block defaults to `internal`, and `assertNoClientLeak()`
  guards the publish/PDF path. Never build a client payload from a raw `Report`.
- **Clients never write `reports`.** Their decisions and comments go through
  `POST /api/reports` (`api/_reports.ts`), which re-checks ownership + publication +
  transition legality. Firestore rules deny every client write, and versions,
  approvals and events are append-only for everyone.
- Workflow rules (publish needs internal approval, no self-approval, editing a
  published report bumps the version and forces re-approval, client sign-off pins the
  version, no hard delete once published) live in `src/lib/reporting/workflow.ts` and
  are shared by the UI and the server — never re-implement a guard inline.
- Editing a template must NEVER rewrite history: reports carry `templateKey` +
  `templateVersion` and a deep copy of the blocks. System templates are duplicate-only.
- Cron: `report-schedules`, `report-reminders`, `client-health-rollup`
  (`api/_reportJobs.ts`) — all idempotent, keyed on
  `generationKey = scheduleId:periodKey[:subjectId]` and per-rung `remindersSent` /
  `escalationsSent`.
- Permissions: `canAccessReports` is the module gate and is TRUE for every internal
  role (everyone reports). Six capability flags escalate by role, defaulted in ONE
  place (`src/lib/reporting/permissions.ts`) — do not hand-roll them per branch.
- Full architecture, install steps and limitations: `workspace/REPORTING_MODULE.md`.

### SaaS billing & tenant lifecycle

- **Plans** live in two halves that must agree: `src/lib/billing.ts` (display: price,
  seats, highlights) and `api/_billingPlans.ts` (Stripe price ids from env, `PLAN_SEATS`,
  Stripe-status → tenant-status mapping). Modules are gated by `minPlan` in
  `src/lib/modules.ts` — do not duplicate that list.
- **The tenant never sets its own tier.** `businesses.plan/status` are written ONLY by
  `api/stripe-webhook.ts` (plan derived from the price actually billed), the
  `subscription-lifecycle` cron, and — as an explicit, audited OVERRIDE — a platform
  super-admin via `POST /api/platform-admin` (`api/_platformAdmin.ts`). Firestore rules
  block a tenant from editing either. An override on a tenant with a live subscription
  is transient: the next Stripe event rewrites it, and both the UI and the endpoint
  response say so.
- **Lifecycle:** trialing → (trial ends) past_due → (7 days grace) suspended → (paid)
  active. `tenantActive()` in the rules denies writes for a suspended tenant, and
  `<SubscriptionGate>` turns that into an explicit screen instead of silent failures.
  `/app/billing` + `/app/settings` stay reachable while suspended so the owner can pay.
- **Seats** are enforced server-side in `api/_accept-invite.ts` (fail-closed). TeamsView
  warns before sending an invite; Abonimi shows used/total.
- **Credentials** never live in `teamSettings` (readable by the whole business) — they go
  to `teamSecrets/{teamId}` (`read, write: if false`) via `POST /api/tenant-secrets`, and
  server code reads them with `getTeamConfig()` (`api/_tenantConfig.ts`). The UI only sees
  `has*` booleans.
- **New API endpoints must go through `api/email.ts`** + a `vercel.json` rewrite — Vercel
  Hobby caps the project at 12 functions and it is already at 12.
- **Cost rule of thumb:** a cron job must never read a collection unfiltered. Scope by
  `businessId` (or a range on an indexed field). `tenantScopedDocs()` in `api/cron/run.ts`
  is the helper for audience reads; `project-spend-rollup` is incremental via a state doc.
- **GDPR:** `?job=tenant-export&businessId=…` and
  `?job=tenant-delete&businessId=…&confirm=…` (super-admin only). Full runbook:
  `workspace/SAAS_HARDENING_RUNBOOK.md`.

### Native apps (Capacitor: Android + iOS)
- `android/` and `ios/` are **gitignored build artefacts** — regenerate with
  `npx cap add <platform>`. Nothing may live only inside them.
- **Every Xcode-side setting for iOS lives in `scripts/ios-configure.cjs`**, never in
  a manual Xcode click: Info.plist usage strings + URL scheme, `App.entitlements`
  (push) + `CODE_SIGN_ENTITLEMENTS`, `PrivacyInfo.xcprivacy`, the shared
  `App.xcscheme`, `GoogleService-Info.plist` bundling, and the AppIcon/splash
  (generated from the same vector "X" as the Android icon by
  `scripts/ios-brand-assets.cjs`). It is idempotent — run it after **every**
  `cap sync ios` (`npm run ios:sync` does both).
- `cap sync` on Windows writes Windows paths into `ios/App/CapApp-SPM/Package.swift`,
  which are invalid Swift escapes and break every plugin. The configure script fixes
  them; do not "clean up" that step.
- **Every `android/` setting lives in `scripts/android-configure.cjs`**, the exact
  mirror of the iOS one: release signing wiring, R8 + proguard keep/dontwarn rules,
  manifest (`allowBackup=false`, FCM notification icon/colour, POST_NOTIFICATIONS,
  RECORD_AUDIO), `ic_stat_notify` + `notification_color`, `rgcfaIncludeGoogle`, and
  the **versionCode/versionName** — which are the script's constants, not
  build.gradle's, because a version that lives only in a gitignored file resets to 1
  on regeneration and Play then rejects the upload. Idempotent; `npm run
  android:sync` / `android:aab` run it for you. Only `google-services.json`, the
  keystore and `keystore.properties` stay outside it (secrets/console downloads) —
  the script checks for them and says how to restore each.
- **`@capacitor/core`, `cli`, `android` and `ios` are pinned EXACTLY** (no `^`) and
  must always share one version — the JS bridge and the native bridge are two halves
  of the same thing. With carets npm resolved them apart (`core@8.4.2` vs
  `cli/android@8.2.0`) and the only signal was one grey `[warn]` inside `cap sync`.
  `scripts/capacitor-versions.cjs` is called first by both configure scripts: a
  minor/major split FAILS the run, a patch split warns. Upgrade all four together.
  Plugins version independently (peer `core >=8.0.0`) and need not match.
- A platform-only API must be branched on `Capacitor.getPlatform()`
  (`StatusBar.setBackgroundColor` = Android-only, `Keyboard.setAccessoryBarVisible`
  = iOS-only) — an unguarded call rejects and surfaces as a startup error.
- **`Keyboard.resizeOnFullScreen` must stay `false`.** While it was on, showing the
  keyboard pinned a fixed pixel height on the activity's content view that only the
  insets *animation* callback restores — so a keyboard dismissed without that
  animation left the WebView a keyboard-height short FOREVER (the app rendered
  correctly inside a viewport ending mid-screen). It is for immersive-fullscreen
  apps; we are edge-to-edge, and Capacitor 8's `SystemBars` already handles the IME
  inset. `resize` is iOS-only — Android's `KeyboardPlugin.java` never reads it.
- iOS builds/archives need macOS: `.github/workflows/ios.yml` (manual, `verify` =
  unsigned simulator build, `testflight` = signed upload). Full runbook, Apple
  account steps and the App Store IAP/`Sign in with Apple` decisions:
  `workspace/IOS_BUILD.md`. Android build, signing, JDK 21 toolchain and the
  Play/Google-Sign-In fingerprint trap: `workspace/ANDROID_BUILD.md`.

### Notifications (bell + push + email)

- **A notification type is declared ONCE**, in `src/lib/notificationTypes.ts`
  (category, priority, group label). `api/_notificationTypes.ts` is the server
  mirror — `src/lib/notificationTypes.test.ts` fails the run if the two drift, and
  also scans the codebase for any `type:` literal that is not registered. An
  unregistered type gets no icon, hides behind every category chip and can never be
  muted; `NotificationType` therefore no longer ends in `| string`.
- **Two write paths, one delivery path.**
  Browser → `useMutation('notifications').create` (the choke point) → the document
  + `POST /api/send-notification-email`.
  Server (cron, webhooks, `/api/notify-staff`, report jobs) → **`notifyUser()` in
  `api/_push.ts`**, which writes the document AND pushes AND emails.
  Never call `db.collection('notifications').add()` directly — that produces a red
  dot nobody sees until they happen to open the app.
- **Gates are shared and evaluated in this order**: `pushEnabled`/`emailEnabled` per
  channel, then Do-Not-Disturb, then category mute. An UNKNOWN type is never muted
  (fail-open) on both sides.
- **DND is wall-clock time in the USER's zone.** The client stamps `dndTimeZone` +
  `dndUtcOffsetMinutes` onto `userPreferences`; the server reconstructs local time
  from them. Reading the hours as UTC shifted the window by the whole offset.
- **Push tokens are per device**: `userPushTokens/{uid}/tokens/{deviceKey}`. The
  parent doc is the legacy single-token record, still read as a fallback. Logout
  MUST call `clearPushToken()` or the device keeps receiving the previous user's
  notifications.
- **Stamp `businessId`** on every notification. `notifications` is in
  `TENANT_DATA_COLLECTIONS`, so GDPR export/delete query it by that field.
- **A failed notification must never fail the action that raised it.** Use
  `Promise.allSettled` / per-call `.catch` — the task, comment or report is already
  saved by then, and surfacing an error made users submit duplicates.
- **`expense-daily-reminder`** (17:00 local from the VPS, NOT in run-all): one
  `expense_daily_reminder` notification per finance person (Admin/Manager/Owner via
  `managerIdsForBusiness`) per working day — "A ke shpenzime për të shtuar sot?" with
  the count already booked and a button to `/app/expenses?new=1` (opens the form).
  Idempotent per team/day via `teamSettings.expenseReminderLastDate` (stamped BEFORE
  the sends), deduped per person across teams, per-team toggle
  `cronSettings.expense_daily_reminder` (Cilësimet → Automatizime), suspended tenants
  skipped, manual runs scoped to the caller's tenant.
- Cron reads over `notifications` must be scoped and capped (`businessId` +
  `limit`). Index requirements live in `firestore.indexes.json`; the retention sweep
  needs `(isRead, createdAt)` and without it nothing was ever purged.

### Email sender identity (From / Reply-To)

- **Every From / Reply-To header goes through `api/_emailIdentity.ts`**
  (`safeSenderName`, `safeSenderAddress`, `senderHeader`), mirrored in
  `src/lib/emailIdentity.ts` (Settings + campaign form preview the exact From the
  recipient will see; `emailIdentity.test.ts` fails the run if the two drift).
  Gmail shows **"This message might be dangerous — the sender's email address uses
  abnormal characters"** for HTML entities left by `escapeHtml` (`&#x27;`), emoji or
  symbols (an en dash counts), invisible/format characters, mixed scripts, an `@`
  inside the display name, or a sender ADDRESS that is not a plain ASCII mailbox (an
  env value pasted with its quotes, a `Name <addr>` string, trailing whitespace).
  One flagged mail and every invoice, invite and campaign from that sender is red.
- A display name keeps Latin letters (ë, ç included), digits, space and a small
  punctuation set; an empty result falls back to `FivoCRM`, never to `""`. An
  address that fails validation is `undefined` so the caller falls through to the
  next candidate (`emailFromEmail` → `MARKETING_FROM_EMAIL` → SMTP user). In
  `_mailer.ts` a tenant SMTP LOGIN is passed raw (it need not be a mailbox); the
  platform `SMTP_USER` is a mailbox and is read through `safeSenderAddress()`
  everywhere, so a value pasted with quotes still logs in AND still sends.
- Never `escapeHtml` a header value and never hand-write `"${name}" <${addr}>` —
  use `senderHeader()` or nodemailer's `{ name, address }` form. Adding a new
  sender? → read `SMTP_USER` through `safeSenderAddress()` like the others.

### Chat read/unread model (one predicate set, four surfaces)

- **`src/lib/chat/unread.ts` is the ONLY definition of "unread for me"** (unit-tested) and
  `useUnreadChat()` (`src/hooks/useUnreadChat.ts`) is the only place the three listeners
  live: DMs `receiverId == me && isRead == false` (cap 200), client
  `senderType == 'client' && isRead == false` (newest 300, tenant-scoped) and the tenant
  `isRead == false` window (newest 200, the GROUP source). ChatView list badges + header
  total, Sidebar and MobileBottomNav all read that hook — before, each had its own
  filter and the DM badge in ChatView was counted from a DIFFERENT window (the 100
  newest received rows of any state) than the one the mark-as-read pass wrote to, so a
  row could be counted, read in the thread and never marked. **Counted == marked** is
  now structural: the mark pass unions every DM source it holds (`unionById`) and
  filters with the same predicates.
- **Three read models, do not mix them**: DM → `isRead` (receiver flips it); client
  thread → a CLIENT row is unread for staff until `isRead`, a STAFF row is read by the
  client via `readAt` (portal only — staff never write `readAt`, it is the "✓✓ Parë"
  receipt and used to be forged by a colleague opening the thread); group → PER MEMBER
  via `readBy`, and `isRead` flips only when every other member has read
  (`groupFullyReadAfter`) so the row can leave the shared window. Staff→client rows are
  created `isRead: true`; a soft delete sets `isRead: true` (a deleted row is never
  unread) and clears `editHistory`.
- **A failed read-mark is surfaced, not looped.** `commitReadMarks` chunks the batch,
  retries per document on failure, toasts once with the error code and leaves the ids
  in `markedAsReadRef` until the next conversation switch. The old catch removed them
  and the effect re-fired on every snapshot forever, silently.
- **Group message lists are provable ONLY through `isGroupChannelMember()`**
  (`firestore.rules`, one `get()` on the channel doc): ChatView lists `messages` by
  `channelId` alone, and `isBusinessMember(resource.data.businessId)` is unconstrained
  in that query, so every group thread was DENIED for anyone who was not a super-admin
  (rules test 10d). Typing indicators are read tenant-scoped (`teamScopedWhere`) at a
  deterministic id `<conversationKey>__<uid>` (test 10e); the old channelId-only read was
  denied too, so every keystroke created a new doc nothing deleted —
  `scripts/cleanup-typing-indicators.mjs` (dry-run by default) removes the leak.
- **Group management is rules-enforced** (tests 10f/10g): only `admins` / the creator
  edit a group or delete it; a member may write the last-message denormalisation
  (`lastMessageAt/Preview/SenderId`) or LEAVE; only members may post into it. A group
  is created with its creator in `members` AND `admins`.
- **DM thread heads live in `dmThreads/{uidA__uidB}`** (participants only, test 10h),
  written by the sender on every DM and by the `chat-scheduled` cron — the list
  preview / recency. The open thread loads the PAIR (`senderId == me AND receiverId ==
  peer` and the reverse), newest `DM_THREAD_LIMIT` each, index
  `messages(senderId, receiverId, createdAt DESC)`; it used to download every message
  the user ever sent anywhere.
- **Scheduled messages ("Programo") are sent by `?job=chat-scheduled`**
  (`api/_chatScheduled.ts`, every 5 min from `vps/server.ts`, NOT in `run-all`): the
  row is claimed in a transaction (`sent: true`) before the send — the browser poll
  claims first too, so the two can never both send. Recipients are notified exactly as
  a live send does (DM / group fan-out / portal client).
- `useCollection(..., { live: true })` bypasses the static 5-min cache for a listed
  collection — ChatView reads `userProfiles` that way for the online dots.

### Chat notifications (the three surfaces + presence)

Full audit: `workspace/CHAT_NOTIFICATIONS_AUDIT_2026_08.md`.

- **Every message type notifies.** A DM → `direct_message`, an @mention → `mention`,
  a group-channel message → `channel_message`, a client-portal message →
  `staff_message` / `client_message`. A group message used to notify NOBODY (and was
  in no badge) — if a new conversation kind appears, it needs its own registered type.
- **The audience is the channel, never the business.** `channelMemberIds()` resolves
  it and BOTH the mention picker and the notifier use it: a mention that reaches a
  non-member ships message text plus a link the rules refuse to open.
- **A channel fan-out is ONE server call** (`channelFanout` →
  `api/_send-notification-email.ts` → `notifyUser()` per member), the single
  documented exception to the browser choke point. The relay is rate limited per
  CALLER (300/h) and fires once per notification DOCUMENT, so a per-member fan-out
  from the browser would burn a chatty user's whole budget and silently drop their
  task/invoice notifications with it. The endpoint re-derives members, `businessId`
  and `teamId` from the CHANNEL document — never from the request body.
- **Sound ownership is decided by the ROUTE, not the type.** On `/app/chat` the
  ChatView chirp owns it; anywhere else the bell chime does. Suppressing chat types
  in the bell instead (the old rule) meant an @mention made no sound at all whenever
  the chat page was closed. Every surface gates on `useNotificationPrefs()` —
  `soundEnabled`, DND and category mute were invisible to ChatView and the Sidebar.
- **Presence lives in `userPreferences/{uid}`** (`activeConversationKey` +
  `activeConversationAt`, heartbeat via `useConversationPresence`) because the
  delivery path already reads that document — so skipping push+email for someone who
  is looking at the message costs no extra read. It is stamped only while the tab is
  VISIBLE, and a stale stamp fails OPEN (`PRESENCE_FRESH_MS`, mirrored in
  `api/_push.ts` and guarded by a test). The bell row is ALWAYS written.
- **The `messages` category is email-throttled, not muted** (15 min per recipient,
  `notificationThrottle/{uid}`, server-only). Push and the bell are never throttled —
  chat is realtime, and one email per message both spammed the recipient and burned
  the relay budget.
- **Chat notifications carry `conversationKey` + `messageId`.** The rules let only the
  RECIPIENT write a notification, so the sender cannot clean up after deleting a
  message — the reader's ChatView dismisses rows whose `messageId` is deleted.

### WHMCS mirror: payments back to WHMCS + WhatsApp invoice reminders

Full runbook: `workspace/WHMCS_SYNC.md`.

- **WHMCS is the source of truth; FivoCRM writes back exactly ONE fact: "this
  payment was received."** Two write paths, one primitive (`pushInvoicePayment`
  in `api/_whmcs.ts`): the Stripe webhook (transid = payment_intent) and the
  manual-payment queue. A payment marked by hand ("Paguar", an instalment) on a
  `source: 'whmcs'` invoice is queued on `whmcsPendingPayments` **in the same
  update as the status change** (`whmcsPendingPatch`, `src/lib/whmcsPayment.ts`),
  then drained by `POST /api/whmcs-payment` (`api/_whmcs-payment.ts`) or by the
  next `whmcs-sync` (`drainPendingWhmcsPayments`). transid is deterministic
  (`fivocrm-<docId>-<key>`, key `full` | `p<index>`), so WHMCS's duplicate error
  is success and a re-mark never double-posts.
- **While the queue is non-empty the sync PRESERVES the local status/paidAt.**
  `upsertInvoice` used to rewrite both from WHMCS unconditionally, so a
  hand-settled invoice flipped back to Pending overnight and its `paidAt`
  vanished. WHMCS reporting `Paid` clears the queue; a WHMCS reversal (→ Draft)
  still wins over a local Paid. `Partial` is FivoCRM-only and is kept.
- Every manual write path (drawer, full form, instalment) must spread the
  queue patch — adding a fourth "mark paid" path without it recreates the bug.
  `whmcsPaymentSyncError` is SHOWN (badge + "Riprovo WHMCS"), never just logged.
- **WhatsApp invoice reminders live in `overdue-reminders`**, decided by
  `invoiceWaDecision()` in `src/lib/finance/invoiceWaReminders.ts` — the api copy
  `api/_invoiceWaReminders.ts` is **byte-identical** (test-enforced). Three
  stages with their own stamps (`preDueWaSentAt`, `dueWaSentAt`,
  `overdueWaSentAt`), source filter (`all|whmcs|fivocrm`), Meta template OR
  Baileys free text, a local send window (the job ticks every 2h — the window
  is what stops a 3 a.m. message), `waOptOut` honoured, and every non-send a
  named reason tallied into `teamSettings.waInvoiceLastRun`. Never add a filter
  inline in the cron loop. Needs index `invoices (status, dueDate)`.
- **Email first, then WhatsApp** (Oct 2026): the overdue email goes out from day 1
  late (Overdue AND Partial/Pending past due), the overdue WA stage from day
  `waOverdueDays` (default 4 = "more than 3 days") and only after
  `overdueEmailSentAt` (`awaiting-email`), unless no email can go out (no address /
  email opted out / WHMCS-skipped / no SMTP). ONE predicate (`emailCanSend` in
  `runOverdueReminders`) feeds both legs; never compute it twice. WA repeats every
  `waInvoiceRenotifyDays` (7) up to `waOverdueMaxSends` (3, `overdueWaCount`) →
  `max-sends-reached`; the last send notifies creator + managers once
  (`invoice_overdue_escalation`, `overdueWaMaxNotifiedAt`). The Baileys agent is
  resolved in the job from `whatsappAccounts` of the invoice's BUSINESS (configured
  agent → invoice team's → any, connected first) and sent with the AGENT's teamId —
  the number often lives on another department. `normalizeInvoiceWaPhone` turns
  Albanian local numbers (`69…`, `069…`, `00355…`) into `355…`.
- **WHMCS invoices are chased BEFORE the due date on a cadence** (1 Nov 2026,
  `whmcsCadence`, default ON): from 20 days ahead every 5 calendar days, from ≤10
  days every 2, plus "skadon sot" on the due day (`waWhmcs*` settings). The
  interval is CALENDAR days in Tirane (the job ticks every 2h inside a window),
  each send increments `preDueWaCount` (its idempotency `n`). FivoCRM invoices keep
  the once-only `preDueDays` stage.
- **WHMCS reminders are configured ONCE per business**: the sync stamps every mirror
  with one team, so a WHMCS invoice whose own team does not cover WHMCS
  (`coversWhmcs`) uses the business's team whose panel says Burimi = WHMCS
  (`whmcsWaTeamByBusiness` in `runOverdueReminders`); its run summary lands there.
- WHMCS invoices are created with every FivoCRM reminder flag already `true`
  and `createdByUserId: null` — WHMCS emails them itself. `overdueEmailSkipWhmcs`
  stops FivoCRM's weekly overdue email duplicating that.

### Follow-up ("Ndjekja"): one next step per contact, leads AND customers

Full runbook: `workspace/FOLLOW_UP.md`.

- **`FollowUpFields` (types) is shared by `Lead` and `Customer`**: `nextFollowUpDate`
  (day, stored at noon Europe/Tirane), `nextFollowUpType`, `followUpNote`,
  `lastFollowUpDate`, `lastActivityAt`, `lastReminderSentAt`, `lastInboundAt`,
  `awaitingReply`, `waOptOut`. There is deliberately **no `lastContactAt`** — every
  engine (temperature, staleness, WA dormancy, automation facts) reads
  `lastActivityAt`; a synonym would drift.
- **`src/lib/crm/followUp.ts` is the only follow-up logic** (unit-tested): `dueState`
  (day math via `toZoned/fromZoned` from `recurringUtils.ts` — never
  `setHours(0,0,0,0)`), presets (snooze is relative to TODAY), `touchContactPatch`,
  `completeFollowUpPatch`, `scheduleNextStepPatch` (explicit `null` on clear),
  `statusAfterTouch` (New → Contacted), `needsNextStep`, `buildFollowUpQueue`.
- **`useFollowUpActions` is the only client write path** (complete / snooze /
  schedule / touch / logContact, with Undo). The timeline row for a WhatsApp send or
  a confirmed call is written by the CLIENT (`WhatsAppChatPanel.onSent` →
  `logContact`); the server stamps fields only (`markConversationAnswered` in
  `api/_waInbound.ts`) — except `contact-email`, where the server writes the row
  because the send happens there. Never both.
- **An open lead with no next step is a defect the queue exposes** ("Pa hap
  tjetër"); `NextStepPopover` makes the next step mandatory for an open lead — the
  only exit is closing the lead. Customers may have none.
- **Inbound WhatsApp has ONE handler for both channels**: `api/_waInbound.ts`
  (`POST /api/wa-inbound`, Bearer `CRON_SECRET` from the VPS; the Meta webhook calls
  `processWaEvent` in-process and now responds `200` AFTER processing). It resolves
  lead ‖ customer via `_contactIdentity`, upserts `conversations/wa-{teamId}-{phone}`
  (owner chain incl. `whatsappThreads`, SLA armed only on the `awaitingReply`
  transition), notifies via `notifyUser('whatsapp_message')` with a 2-min burst
  debounce, decides auto-reply through `_waAutoReply.ts` (mirror
  `src/lib/messaging/autoReply.ts`, named block reasons) and drafts an AI reply
  (`waAiAssist: 'off'|'draft'` — **there is no auto-send, on purpose**).
  `conversation-sla` (15 min) enforces `slaFirstResponseDueAt`.
- `lead-follow-up-reminders` covers leads AND customers, runs at **08:30 local** via
  `scheduleDailyInZone` (not in `run-all`), and deep-links to
  `/app/follow-ups?focus=<kind>:<id>`. Thresholds (`followUpSlaHours`,
  `followUpStaleDays`, `waResponseSlaMinutes`, `leadCadenceDays`) come from
  `src/lib/crm/followUpConfig.ts` / `api/_followUpConfig.ts`, edited in Cilësimet →
  Automatizime (`FollowUpSettingsPanel`). The automation engine is untouched.
- **Playbooks** (`src/lib/crm/playbooks.ts`, byte-identical `api/_playbooks.ts`): label →
  steps (day, channel, title, template) in `teamSettings.followUpPlaybooks`. The inbound
  WhatsApp handler auto-enrols a lead by keyword/tag (`playbookId` + the cadence fields +
  `serviceInterest`); `lead-cadence-steps` then creates each step's task WITH the rendered
  text and sets the lead's next step, so the queue shows the right action and the WhatsApp
  panel opens pre-filled (`initialText`). Never auto-sends. Recipes SEO/Ads/Social/Web.
- Rules: the portal client may edit their own `customers` doc but the follow-up
  fields + `assignedToUserId/status/tags` are denied (tests 50a/50b). Badges/widget
  need indexes `(businessId, nextFollowUpDate)` and `(businessId, awaitingReply)` on
  leads + customers; `useFollowUpDue` hides itself on a listener error.

### Task reminders ("Më kujto") & task ordering

- **One reminder per task, three fields that must agree**: `reminderAt` (absolute
  instant, what the cron queries), `reminderOffsetMinutes` (set when chosen
  relative to the deadline — "1 orë para"), `reminderSentAt` (delivery mark).
  Every write goes through `setReminderPatch()` / `reminderPatchForDeadline()` in
  `src/lib/taskReminders.ts` (unit-tested); clear with explicit `null`, never
  `undefined` (`removeUndefined()` would strip it and clear nothing).
- **A moved deadline carries a RELATIVE reminder with it and re-arms it** (Asana);
  a custom absolute one stays put. Every path that writes `endDate`
  (TaskDetailPanel's four handlers, TasksView's inline calendar) spreads
  `reminderPatchForDeadline`. `buildNextRecurringTask` and its cron mirror carry
  the offset into the next occurrence, never the absolute date.
- **A reminder consumed without a send says why**: `reminderSkippedAt` +
  `reminderSkippedReason` (`task-done`, `no-recipient`; older than 48h = `stale`),
  never `reminderSentAt` for nobody. `setReminderPatch` / `reminderPatchForDeadline`
  clear the skip marks on re-arm; a snooze UNDO carries the previous delivery marks
  back so a delivered reminder is never re-armed.
- **Delivery is `task-reminders`** in `api/cron/run.ts`, every 5 min from the VPS
  (`vps/server.ts`), NOT in `run-all` — "15:00" is a wall-clock promise. It reads
  only `reminderAt ∈ [now − 48h, now]` (same-field range, no index) and goes
  through `notifyUser()` → bell + push + email, type `task_reminder`.
  `taskReminderBlockReason()` is mirrored there — keep the two in sync.
- **Every task list sorts through `src/lib/taskSort.ts`** (unit-tested): one date
  normaliser (`taskDateMs`: Date | Timestamp | ISO | number → ms | null) and total
  orders that end in the document id. Never `a.endDate - b.endDate`, never
  `?.getTime()` on a raw field, missing dates go LAST. Manual drag order puts
  UNKNOWN ids (tasks created after the last drag) FIRST — a 99999 sentinel sank
  every new task onto the last page. `useCollection`'s client-side `orderBy`
  normalises mixed Date/string values and honours `limit` on the business-scoped
  path.
- Grouping in TasksView is built from the WHOLE ordered list and paginated
  afterwards (`group.total` vs on-page count); a Done task is its own bucket under
  "Sipas afatit". Project board columns have no persisted order and sort
  urgent-first then earliest deadline; a same-column drag is not persisted.

### Recurring tasks (engine laws — audit 22 Sep 2026)

- **`addFrequency` never `setMonth(+n)`.** Monthly steps go through
  `addZonedMonthsClamped` with the anchor day (31 Jan → 28 Feb → 31 Mar); yearly
  clamps 29 Feb. The overflow-before-clamp version turned Jan 31 into MAR 31 and
  every short month vanished from month-end series, in both engines, for years —
  because no test ever took a monthly step. `api/cron/run.ts` mirrors it.
- **A series is identified by `seriesId`** (= root parent id, carried onto every
  child by `buildNextRecurringTask` and the cron). `sameSeries()` /
  `hasLiveSeriesSibling()` key on it, falling back to title+assignee+project for
  legacy rows — never on frequency (changing "çdo javë" → "çdo muaj" on a Done
  tip used to disown its live child and fork the series). The cron's duplicate
  check uses the same key and records `recurringSkippedReason:
  'duplicate-occurrence'` on the parent it closes — never a silent close.
- **`dependsOn` on a child follows the LIVE blocker**
  (`remapDependsOnForNextCycle`, mirrored as `remapDependsOn` in the cron): a Done
  recurring blocker → its live sibling, a Done one-off → dropped, unknown/open →
  kept. Pass `allTasks` to `completeTask` for this to work.
- **`recurringOccurrencesInMonth()` is the ONE calendar projection** (TasksView
  and ProjectDetailView). A recurring doc renders only through it: anchor day
  always, forward walk unless `nextCycleCreated` or the project is
  archived/cancelled (`projectRecurrenceBlockReason`).
- **`TaskDetailPanel` must be mounted with `allTasks`.** Without it the blocker
  guard is off and re-opening a Done tip re-arms `nextCycleCreated` while the
  child is alive (double series). The panel is read-only for `!canEdit` (Viewer)
  as well as for guests — and the rules now deny Viewer writes (`isViewerRole()`,
  test 39d); a portal project MEMBER reads its tasks by projectId
  (`isPortalProjectMember`, test 39e).
- **The claim, the child and the Done write are ONE transaction** (audit 23 Oct
  2026): `claimTaskNextCycle(taskId, plan)` (`src/lib/taskRecurrenceClaim.ts`) writes
  the next occurrence, `nextCycleCreated`, `nextCycleTaskId`, `status: 'Done'` and
  `completedAt` together — a claim can no longer exist without its child (the old
  three-round-trip sequence left Todo tips with `nextCycleCreated: true` and a dead
  series). `nextCycleClaimIsStale()` re-arms a legacy broken row on re-complete; the
  cron stamps `'child-missing'` and never re-spawns (deleting the live occurrence is
  how a user stops a series). Every non-spawn is a `RecurringSkippedReason`
  (`duplicate-occurrence` / `series-ended` / `child-missing`). Engine flags
  (`nextCycleCreated`, `nextCycleTaskId`, `recurringSkippedReason`, `reminderSentAt`,
  `reminderSkippedAt/Reason`, `dueNotificationSent`, `overdueNotificationSent`) are
  rules-gated to the ASSIGNEE / CREATOR / Admin / Manager (`taskEngineFlagsAllowed`,
  test 84f); other staff may only re-arm them. The UI mirrors that with
  `canManageTaskSeries()` (`src/lib/taskSeriesAccess.ts`) / `canDriveTaskSeries()`
  (panel): a colleague cannot Done / re-open / "Deri më" someone else's RECURRING task.
- **One deadline, one "overdue"**: `taskDeadline(task)` = `endDate ?? dueDate` and
  `isTaskOverdue(task, todayKey)` in `src/lib/taskDue.ts` are the only definitions
  (list chip, filter, row text, groups, MyTasks, calendar, SmartSuggestions, and the
  cron's `task_overdue` — overdue once the Tirane DAY has passed, never the instant).
  "Today" comes from `useTodayKey()` (Tirane day key, re-evaluated at midnight and
  on focus) — never computed inside a memo without it.
- **The task jobs skip suspended tenants and archived/cancelled projects, and a
  manual run is one tenant** (`task-deadline-alerts`, `project-completion-reminder`,
  `recurring-project-reset` all take `{ businessId }` from `manualScopeId`).
  `recurring-project-reset` cycles only a `Completed` project and moves the task
  dates by one cycle — re-opening tasks with last cycle's deadline fired
  "vonuar" for every task at the next run. Server-created follow-up tasks carry
  `createdByUserId: null` (never the portal client) and link a customer via
  `relatedCustomerId` — `customerId` on a task IS the portal-visibility switch.

### Roles & Permissions
- Roles: `Admin`, `Manager`, `Sales`, `SalesAgent`, `Member`, `Viewer`
- Permission checks via `usePermissions()` hook and `<PermissionGate>` component.
- Adding a `canAccessX` flag means touching: `UserPermissions`, `fullAccessPermissions`,
  `restrictedPermissions`, every role branch in `usePermissions.ts`, `simulateRole` in
  `PermissionsContext.tsx`, `MODULES`/`DEFAULT_TEMPLATES` in `SettingsView.tsx`,
  `TeamMember`/`TeamInvite` types, TeamsView checkboxes, and `createTenant.ts`.
- `canAssignTasks` ("may hand work to a colleague") is role-derived for
  Admin/Manager/SalesAgent, and a **per-member override** for Member/Sales:
  `teamMembers.canAssignTasks`, set from Ekipet → Ndrysho Lejet (or Cilësimet →
  Rolet → Apliko te të gjithë — which only ever GRANTS it; a template with it off
  leaves individual grants alone). A Viewer can never have it. Without it the
  assignee picker in QuickTaskForm/TaskDetailPanel is filtered to the user
  themselves and says so — the reason a Member sees "no other users" when
  assigning. The grant is read by `grantsCanAssignTasks()`
  (`src/lib/permissions/memberOverrides.ts`) across EVERY active row of the
  business, not only `bestMembership` (a person on several teams has one row per
  team and the admin ticks one of them), and the identity queries in
  `usePermissions` are `live: true`, so a right granted in Ekipet applies without
  a reload.
- Client portal users are separate — they use `clientPortalAccess` collection.

---

## Client Portal

- Portal routes: `/portal/*`
- Client authentication via Firebase Auth (separate from staff).
- Hook: `useClientPortal()` — resolves `customerId` for the logged-in client.
- Auto-creates `Customer` + `ClientPortalAccess` + `Lead` on first login.
- Portal views: Dashboard, Invoices, Projects, Requests, Chat, Quotes (Preventiva), Services.

### Quote/Preventiva Flow
1. Admin creates quote in **Price Calculator** → saved as `status: 'Draft'`.
2. Admin opens **Customer360View** → Preventiva tab → clicks **"Dërgo"** button → status becomes `'Sent'`.
3. Client logs into portal → sees quote in **Preventiva** tab with full package breakdown.
4. Client clicks **"Prano Ofertën"** (Accept) or **"Mos Prano"** (Reject) → status updates in Firestore.
5. `'Draft'` quotes are never shown to clients.

---

## Landing Pages

Located in `src/views/landing/`. Each is a standalone public marketing page.

| File | URL | Niche |
|---|---|---|
| `RealEstateLandingPage.tsx` | `/real-estate` | Real Estate |
| `EstetikeLandingPage.tsx` | `/estetike` | Aesthetics/Beauty |
| `ResortLandingPage.tsx` | `/resort` | Hotels/Resorts |
| `RecruitLandingPage.tsx` | `/recruit` | HR/Recruitment |
| `SeoLandingPage.tsx` | `/seo` | SEO Services |
| `InteriorDesignLandingPage.tsx` | `/interior-design` | Interior Design |

All landing pages have: Hero, Pain Points, Results/Stats, Packages, Process, Add-ons, Testimonials, FAQ, Contact Form.

### Interior Design Package Structure
Each package includes:
- Social Media Management (content, reels, posting)
- SEO management with description
- Google Ads / Meta Ads management with description
- Pricing in EUR + ad spend separate

---

## API Endpoints (`/api/`)

| File | Route | Purpose |
|---|---|---|
| `landing.ts` | `POST /api/landing` | Landing page form submissions → creates Lead in Firestore |
| `send-invoice-email.ts` | `POST /api/send-invoice-email` | Sends invoice PDF via email |
| `send-invite.ts` | `POST /api/send-invite` | Team invite emails |
| `send-welcome-email.ts` | `POST /api/send-welcome-email` | Welcome emails for new users |
| `create-checkout-session.ts` | `POST /api/create-checkout-session` | Stripe checkout |
| `stripe-webhook.ts` | `POST /api/stripe-webhook` | Stripe payment events |
| `ai-chat.ts` | `POST /api/ai-chat` | OpenAI chat assistant |
| `meta-webhook.ts` | `POST /api/meta-webhook` | Meta WhatsApp webhook |
| `send-whatsapp.ts` | `POST /api/send-whatsapp` | Send WhatsApp messages |
| `migrate-emails.ts` | `POST /api/migrate-emails` | Data migration utility |
| `_reports.ts` | `POST /api/reports` | Client report actions (view/ack/approve/reject/comment) + staff email send |
| `_platformAdmin.ts` | `POST /api/platform-admin` | Platform console writes: tenant plan/status/trial/seats + module toggles (super-admin only, audited) |
| `_link-contact.ts` | `POST /api/link-contact` | Pairs a customer with the lead for the same person (portal bootstrap) |
| `_hosting.ts` | `POST /api/hosting` | Hosting & domains: servers/registrar config, domain check, orders, provisioning, cPanel SSO/suspend/terminate, Dynadot NS/privacy/EPP (staff; portal client on own records) |
| `_merge-contacts.ts` | `POST /api/merge-contacts` | Manual duplicate merge: moves invoices/projects/quotes/chat onto the surviving contact (Admin/Manager, archived + audited) |
| `_reportJobs.ts` | Cron | report-schedules, report-reminders, client-health-rollup |
| `cron/run.ts` | Cron | Scheduled jobs (recurring invoices, etc.) |

---

## Common Commands

```bash
# Development
npm run dev

# Build (same as Vercel)
npm run build

# Tests
npm run test

# Typecheck — NEVER use bare `tsc --noEmit`
# The root tsconfig.json is a SOLUTION file ("files": [] + references), so
# `tsc --noEmit` on it checks NOTHING and exits 0. `vite build` does not
# type-check either (esbuild strips types), so a build passing proves nothing.
npm run typecheck       # app (src/) — has pre-existing errors: compare the count
npm run typecheck:api   # api/ — currently CLEAN, keep it at 0
npm run typecheck:all   # app + node + api

# Android
npm run android:sync   # build + cap sync
npm run android:open   # open in Android Studio
npm run android:run    # run on device/emulator

# iOS (ios:add/configure/sync run on Windows; open/run/build need macOS)
npm run ios:add        # cap add ios + configure (first time only)
npm run ios:sync       # build + cap sync ios + configure
npm run ios:configure  # re-apply every Xcode-side setting (idempotent)
npm run ios:open       # open in Xcode (macOS)

# Lint
npm run lint
npm run lint:fix

# Push to GitHub (triggers Vercel deploy)
git add . && git commit -m "message" && git push
```

---

## Known Issues / History

- `AdminTestPopup.tsx` — removed (was a temporary test component).
- `dialog/index.tsx` — moved from `dialog.tsx` to fix Vercel Linux module resolution.
- All views use `lazyRetry()` to handle stale chunk errors on deployments.
- WhatsApp integration uses both Meta Cloud API and self-hosted Baileys (VPS).
- `toAll()` utility normalizes ALL/EUR amounts for cross-currency totals.

---

## Environment Variables (required)

```
VITE_FIREBASE_*               — Firebase config (client)
# Firebase Admin SDK (server) — set EITHER the three vars OR the JSON one:
FIREBASE_PROJECT_ID           — Service account project_id
FIREBASE_CLIENT_EMAIL         — Service account client_email
FIREBASE_PRIVATE_KEY          — Service account private_key (use \n for newlines)
FIREBASE_SERVICE_ACCOUNT_JSON — Full service account JSON (alternative)
STRIPE_SECRET_KEY             — Stripe
STRIPE_WEBHOOK_SECRET    — Stripe webhooks
OPENAI_API_KEY           — AI chat (platform fallback; tenants bring their own key)
GEMINI_API_KEY           — AI chat (platform fallback)
ANTHROPIC_API_KEY        — AI chat (platform fallback, Claude)
META_VERIFY_TOKEN        — Meta webhook verification
META_ACCESS_TOKEN        — Meta WhatsApp API
```

---

## Project Memory Files

- `workspace/SOUL.md` — Agent personality & principles
- `workspace/PATTERNS.md` — Code patterns & conventions
- `workspace/DECISIONS.md` — Architectural decisions log
- `workspace/TODO.md` — Pending tasks
- `workspace/CHANGELOG.md` — History of changes
- `workspace/DEBUGGING.md` — Debugging notes
- `workspace/REPORTING_MODULE.md` — Reporting & accountability module (ERD, security, runbook)
- `workspace/FINANCE_AUDIT_2026_09.md` — Finance/recurring-billing audit (anchor drift, period claims, tenant scoping)
- `workspace/HOSTING_MODULE.md` — Hosting & domains module (cPanel/WHM + Dynadot): architecture, lifecycle table, endpoint actions, deploy steps
- `workspace/SECURITY_AUDIT_2026_09.md` — Full-platform security audit (rules, api, cron, VPS, client, secrets): what shipped, operator actions (secret rotation), what was left
- `workspace/FINANCE_AUDIT_2026_09_30.md` — Finance audit 30 Sep 2026 (~40 findings, all fixed) + why the 25 Sep retainer invoices did not bill (run-all kill / Part 1 error / prior claim) and the read-only diagnosis script
- `workspace/CLIENT_PROFITABILITY.md` — Client & project profitability (hours × cost rate, earned revenue, gross→net, plan vs actual, month close): model, capture paths, cron, deploy
- `workspace/SALES_AGENT.md` / `workspace/SALES_AGENT_PLAN.md` — Ana, the virtual sales agent (autonomy levels, Google Maps prospecting, metered cold WhatsApp, handoff): runbook + the 10 laws, phases and owner decisions

---

## Chat Feature — Deep Audit (May 2026)

### Issues identified in `src/views/ChatView.tsx` (~2353 lines)

**Architecture / data flow**
- 5 always-on background Firestore listeners (`bgDmQuery`, `bgSentDMsQuery`, `bgReceivedDMs` (duplicate), `allUnreadClientQuery`, `allUnreadChannelQuery`) regardless of `chatMode` → ~60% wasted reads.
- Missing composite indexes for DMs (`senderId,createdAt`, `receiverId,createdAt`) and WhatsApp (`teamId,phone,createdAt`); sorting done client-side.
- Pagination naive: `channelLimit: 100` hardcoded, +50 increments re-fetch all old messages (no cursor / `startAfter`).
- Typing-indicator docs may leak in Firestore if user switches channels fast.

**Performance**
- No virtualization — 100+ DOM bubbles rendered at once.
- `getUserDisplayName()` called per message, not memoized (300 map lookups / render).
- `filteredMessages.sort()` runs every render.
- 85+ `useState` hooks in a single file; cascading re-renders.

**UX gaps vs Slack/Linear**
- No threading panel, no `@mentions`, no pinned messages, no reaction-user popover, no link previews, no markdown, no scheduled send, no voice notes, no global search filters.

**UI / a11y**
- iOS zoom on textarea (`text-[16px] sm:text-sm` should be `text-base`).
- Missing ARIA labels on emoji/reaction buttons.
- No focus trap inside emoji picker.
- Typing dots `text-muted-foreground/40` too low contrast in dark mode.
- Albanian names truncate mid-word.

**Security**
- XSS risk: `replyToContent` rendered unsanitized.
- `attachmentUrl` accepts `javascript:` URIs (no domain whitelist).
- `image/svg+xml` upload allows embedded scripts.
- Firestore rules `allow read: if isAuth()` lets any signed-in user read all DMs.

### Implementation status (May 2026)

✅ = done, 🟡 = partial, ⬜ = pending

| # | Item | Status |
|---|---|---|
| 1 | Background queries gated by `chatMode` | ✅ |
| 2 | Removed duplicate `bgReceivedDMs` | ✅ |
| 3 | Sanitize `replyToContent` (HTML escape) | ✅ |
| 4 | Remove `image/svg+xml` from allowed types | ✅ |
| 5 | Memoize `getUserDisplayName` via Map cache | ✅ |
| 6 | Validate attachment URL (https/Firebase only) | ✅ |
| 7 | `@mentions` autocomplete + highlight | ✅ |
| 8 | Pinned messages bar + toggle | ✅ |
| 9 | Reaction-user popover | ✅ |
| 10 | iOS zoom fix on composer | ✅ |
| 11 | Basic markdown (`**bold**`, `*italic*`, `` `code` ``) | ✅ |
| 12 | Online dot near avatar (last-seen <2 min) | ✅ |
| 13 | Cursor pagination with `startAfter()` | 🟡 (limit+100 with “load older” button — Firestore-side cursor TBD) |
| 14 | Firestore indexes for DM/WA | ✅ (added to `firestore.indexes.json`, incl. `messages: receiverId,createdAt`) |
| 15 | Tightened Firestore rules for messages | ⬜ (skipped — would break unread sweep query; needs query refactor first) |
| 16 | Search filters (date / sender) | ✅ |
| 17 | Voice notes via `MediaRecorder` + Firebase Storage | ✅ |
| 18 | Split `ChatView` into modules | ⬜ (deferred — risky for stability) |
| 19 | `react-virtual` for message list | ⬜ (deferred — needs perf-test) |
| 20 | Link previews (OG card) | ⬜ (needs serverless endpoint) |
| 21 | Scheduled messages | ⬜ (needs cron) |

### Storage Rules
- `storage.rules` added — auth required for write, public read, max 15 MB, image/PDF/office/text.
- Deploy with: `firebase deploy --only storage`.
