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
| `timeEntries` | Time tracking |
| `services` | Service catalog |
| `products` | Shop products (variants, inventory, SEO) |
| `productCategories` / `productBrands` | Shop catalog taxonomy |
| `stockMovements` | Append-only inventory ledger |
| `shopOrders` | Shop orders (portal + back office) |
| `serviceInquiries` | Landing page form submissions |
| `standups` | Morning standup entries |
| `dailyReports` | Daily staff reports |
| `quotes` | Price calculator quotes (team-scoped) |
| `reports` | Enterprise reports (blocks, workflow, approvals) |
| `reportVersions` / `reportApprovals` / `reportEvents` | Append-only history, sign-off, audit |
| `reportComments` | Report discussion (`internal` = the client boundary) |
| `contactMerges` | Duplicate-merge archive (full snapshot of the absorbed contact; read-only) |
| `dailyReportMisses` | Who did not file a daily report, per tenant per day (cron-written, `write: if false`) |
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
- Three gates, resolved together by `moduleBlockReason()`:
  1. **permission** — the user's role must grant `permissionKey`;
  2. **plan** — `businesses.plan` must reach `minPlan` (`trial` ranks highest so trials
     can evaluate everything; an unknown plan is treated as trial, never as locked);
  3. **toggle** — the path must not be in `businesses.disabledModules`.
- `useModules()` reads/writes that state; `<ModuleGate moduleId="…">` guards routes
  (use it **instead of** `<PermissionGate>` — the permission check is in the registry).
- Consumers: Sidebar, MobileBottomNav, CommandPalette, TenantsView (super-admin
  per-tenant chips), Cilësimet → **Modulet** (owner self-service via
  `ModulesSettingsPanel`). Adding a module to the registry wires all of them.
- Firestore rules only let the business **owner** write `businesses/{id}`, so a
  non-owner admin gets a read-only module manager.

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
  `auto-generated`, `paused`, `unsupported-frequency`, `no-next-date`,
  `not-due`, `series-ended`, `already-generated`.
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
- A platform-only API must be branched on `Capacitor.getPlatform()`
  (`StatusBar.setBackgroundColor` = Android-only, `Keyboard.setAccessoryBarVisible`
  = iOS-only) — an unguarded call rejects and surfaces as a startup error.
- iOS builds/archives need macOS: `.github/workflows/ios.yml` (manual, `verify` =
  unsigned simulator build, `testflight` = signed upload). Full runbook, Apple
  account steps and the App Store IAP/`Sign in with Apple` decisions:
  `workspace/IOS_BUILD.md`.

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
- Cron reads over `notifications` must be scoped and capped (`businessId` +
  `limit`). Index requirements live in `firestore.indexes.json`; the retention sweep
  needs `(isRead, createdAt)` and without it nothing was ever purged.

### Roles & Permissions
- Roles: `Admin`, `Manager`, `Sales`, `SalesAgent`, `Member`, `Viewer`
- Permission checks via `usePermissions()` hook and `<PermissionGate>` component.
- Adding a `canAccessX` flag means touching: `UserPermissions`, `fullAccessPermissions`,
  `restrictedPermissions`, every role branch in `usePermissions.ts`, `simulateRole` in
  `PermissionsContext.tsx`, `MODULES`/`DEFAULT_TEMPLATES` in `SettingsView.tsx`,
  `TeamMember`/`TeamInvite` types, TeamsView checkboxes, and `createTenant.ts`.
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
OPENAI_API_KEY           — AI chat
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
