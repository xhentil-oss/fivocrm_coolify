# Finance bug audit — 18 Sep 2026

**Status: most of this has now been fixed** (same day, see
`workspace/CHANGELOG.md` and the "Fix status" section at the bottom). This
document is kept as the record of what was found and why each rule exists.

Originally: findings only. Seven parallel passes
(invoices/payments, expenses, recurring engines, Financat analytics, staff-side
finance, server money flows, plus a main-agent pass over the unowned surfaces).

Baseline at audit time: finance unit tests **287 pass / 14 files**, `npm run
typecheck:api` clean, `npm run typecheck` 214 pre-existing errors.

Severity: **P0** = cross-tenant, money lost, or data exposed · **P1** = a wrong
figure a human acts on · **P2** = edge case, race, or cosmetic.

---

## P0

### 1. Any tenant's Admin can dun every other tenant's customers
`api/cron/run.ts:5518` (`invoice-reminders`) and `:5692` (`overdue-reminders`)
call `runInvoiceReminders()` / `runOverdueReminders()` with **no scope argument**,
unlike `recurring-invoices` (`:5524`) which resolves `callerBusinessId(req)`.
`runInvoiceReminders` (`:478-489`) queries `invoices` where status is
Pending/Partial with no `businessId` filter. `authorizeManual` (`:54-80`) accepts
any Admin/Owner of any team, and `src/views/SettingsView.tsx:2270` renders the
"Ekzekuto Tani" button in every tenant's Cilësimet.

One click flips every tenant's late invoices to `Overdue` and SMTP-mails (and,
for `overdue-reminders`, WhatsApps) every tenant's customers. This is the exact
law CLAUDE.md states for `recurring-invoices`: *"Any job that sends something
must be scoped the same way."*

**Fix:** pass `callerBusinessId(req)` into both jobs and filter on
`invoice.businessId`, super-admin excepted.

### 2. `recurring-expenses` has the same hole, plus no suspended-tenant guard
`api/cron/run.ts:1850-1853` reads `expenses where isRecurring == true` across all
tenants; `runRecurringExpenses()` takes no `businessId` and the dispatch at
`:5641-5643` applies none. A manual run creates expense rows in every other
tenant's books and notifies their staff by bell, push and email. A `suspended`
tenant keeps accruing rows (the Admin SDK bypasses `tenantActive()`).

**Fix:** mirror `recurring-invoices` — caller scoping plus the
`suspendedBusinessIds` exclusion used at `:1184-1213`.

### 3. Period keys are machine-local: the browser says August, the cron says July
`src/lib/finance/recurringExpenses.ts:81-89` and its mirror
`api/cron/run.ts:1794-1803` build period keys from
`getFullYear/getMonth/getDate/getDay`. The UI runs in Europe/Tirane; the job body
runs on Vercel in **UTC** (`vps/server.ts:1148` only `fetch`es
`${CRM_BASE_URL}/api/cron/run`). Every date in the app is a local-midnight Date.

Verified empirically — the same instant, `2026-07-31T22:00Z`:

| TZ | key |
|---|---|
| Europe/Tirane | `2026-08` |
| UTC | `2026-07` |

Two failure modes, both on the most common configuration (a bill dated the 1st):

- **Dead series.** UI claims `2026-08`; the cron computes `2026-08` from the next
  date too, returns `already-generated`, and `continue`s without advancing
  `nextRecurringDate` — the series is blocked forever. `stalledSeries`
  (`src/views/ExpensesView.tsx:663-671`) only looks for `unsupported-frequency`
  and `no-next-date`, so nothing surfaces it.
- **Double booking.** A parent booked mid-July with next = 1 Sep generates a child
  for `2026-08` and then one for `2026-09`, both dated in September, and the
  series drifts permanently to the 2nd.

`api/cron/run.ts:1093` (`projectBillingPeriodKey`) and
`src/lib/finance/recurringBilling.ts:60,84-86` /
`src/lib/finance/recurringInvoices.ts:105-114` have the identical defect: a
recurring project created at 01:30 Tirane on the 1st opens a window in which the
cron bills — and emails — an extra invoice for the previous month.

**Fix:** route all billing day/period math through `toZoned`/`fromZoned`
(`src/lib/recurringUtils.ts:41-54`), as the task recurrence already does, in both
the `src/` engines and the `api/` mirrors. Add a test that runs the engines under
two `TZ` values and asserts identical keys.

### 4. Every employee can read every colleague's salary
`src/hooks/usePermissions.ts` sets `canAccessProfile: true` for **every** role
including `Viewer` (lines 88, 116, 375, 416, 458, 499, 541). `src/App.tsx:443`
gates `/app/bonus` on exactly that key. `src/views/BonusView.tsx:131-142` then
loads the whole tenant into the browser: all `teamMembers` (with `monthlySalary`
and `salaryHistory`), all `projects`, all `expenses` — the per-member filtering
happens afterwards in React (`:305-309`).

The rules permit the same query directly: `firestore.rules` grants
`teamMembers` and `expenses` reads to any `isBusinessMember`, and salary payments
are `expenses` rows with `category: 'Salary'`. Nothing client-side can fix this.

**Fix:** move compensation out of `teamMembers` into a doc readable by self plus
approvers, or serve BonusView's per-member figures from an endpoint. Also swap the
route's `PermissionGate` for `ModuleGate` — `bonus` has `minPlan: 'business'` in
the registry (`src/lib/modules.ts:130`) and the route currently skips plan and
lock gating entirely.

### 5. Portal shop orders are priced by the client's browser
`src/views/portal/PortalShopView.tsx:190-224` writes `shopOrders` straight from
the browser with client-computed `unitPrice`, `total` and `paymentStatus`. The
rule pins only `source == 'portal'`, `status == 'Pending'` and the customer id —
not price, not payment status. `src/views/ShopOrdersView.tsx:184-201` then bills
`amount: order.total` and marks the invoice `Paid` when `paymentStatus === 'Paid'`.

A client posts `total: 0, paymentStatus: 'Paid'` for a full cart; the back office
shows a settled order and issues a 0 L invoice already marked paid. The hosting
module avoids exactly this by creating orders only through the endpoint
(`api/_hosting.ts:146-205` re-prices from the catalog).

**Fix:** route portal shop orders through a server endpoint that re-prices with
`buildOrderItem`/`computeOrderTotals`; at minimum deny `paymentStatus` on a
portal create.

### 6. A portal client can rewrite their own quote's price
`firestore.rules` quotes block: `allow update: if isBusinessMember(...) ||
quoteAccessibleByPortal() || isSuperAdmin()` — no field constraint and no status
constraint. `quoteAccessibleByPortal()` only proves ownership, so a client can
write any `result` (totals, package contents) and any `status`, including on a
`Draft`. The tampered result is copied verbatim into a contract's
`packageSummary` (`src/views/ContractsView.tsx:246-258`).

Related: `src/views/portal/PortalQuotesView.tsx:94` filters Draft quotes out
**after** fetching them, and the read rule has no status clause, so internal draft
pricing sits in the client's devtools.

**Fix:** restrict the portal update clause with
`affectedKeys().hasOnly(['status','respondedAt','updatedAt'])` and
`resource.data.status == 'Sent'`, the way customers is already done (tests
50a/50b). Add the status predicate to the read rule and to both portal queries.

---

## P1 — a wrong number a human acts on

### Forecast, MRR and P&L

7. **The forecast never asks whether the project still bills.**
   `src/lib/finance/forecast.ts:79-86` checks `billingType`, pause, terminal
   status and end date, but never `isRecurring`. `stopProjectBillingPatch()`
   (`recurringBilling.ts:234-241`) deliberately leaves `billingType` alone. Switch
   "Projekt Periodik" off on a 200 000 L/month retainer: the engine stops billing,
   and the monthly recurring revenue, the forecast and the cash-flow gap keep
   counting it forever. Found independently by two passes. `forecast.test.ts:25-45`
   never sets `isRecurring` on a fixture, which is why it was missed.

8. **Weekly retainers are under-counted about four times.** The same function adds
   `budget` once per month for projects while the invoice loop multiplies by
   `FREQ_TO_MONTHLY` (`forecast.ts:120`). A 50 000 L/week retainer reads as
   50 000 MRR instead of ~216 500.

9. **Cancelled and archived retainers book full revenue in the Fitimi tab.**
   `src/lib/finance/projectPnl.ts:193-206` and `:290-314` (mirrored in
   `departmentPnl.ts:154-166`) put a monthly project in the period whenever
   `createdAt <= periodEnd && (lastCompletedAt ?? periodEnd) >= periodStart`, with
   no status, `isRecurring` or end-date guard. A 50 000 L/month retainer cancelled
   in February, viewed in September, credits 450 000 L that will never be billed —
   to the project row, its department, and its responsible person. The forecast on
   the same page excludes terminal statuses, so the two cards contradict each other.

10. **An unknown invoice frequency invents a full month of revenue.**
    `forecast.ts:120` uses `?? 1`; the expense side deliberately contributes 0.

### Invoices and payments

11. **The overdue email demands the gross total, not the remainder.**
    `api/cron/run.ts:662-666` calls `buildInvoiceEmail` without `paidAmount`, so
    `api/_invoiceEmail.ts:93` computes `settled = 0`. A 100 000 L invoice with
    60 000 L already paid is dunned for 100 000 L. The other two callers pass it.

12. **Creating an invoice already marked Paid silently drops the payment date.**
    The `paidAt` assignment in `src/views/InvoicesView.tsx:2519-2532` lives
    entirely inside `if (isEditing)`, yet the create form offers the status and a
    date picker. A back-entered August receipt lands in September cash revenue.

13. **Opening the drawer and saving moves the due date back a day.**
    `InvoicesView.tsx:668` seeds the input with `toISOString().slice(0,10)` (UTC)
    and `:704` saves it back as local noon. A 30 Sep due date becomes 29 Sep on any
    save, so the invoice goes overdue a day early. Same round-trip at `:671-673`
    and `:2202`.

14. **An invoice is marked Overdue on its own due date.** `api/cron/run.ts:500`
    compares `dueDate < now` against a local-midnight date while the job runs at
    10:00 Tirane. The client still has the whole day to pay.

15. **Suspended tenants keep dunning their customers.** Neither
    `runInvoiceReminders` (`:478`) nor `runOverdueReminders` (`:576`) filters
    `suspendedBusinessIds`, unlike every other money job.

16. **Refunds are recorded and then ignored.** `api/stripe-webhook.ts:395-410`
    stamps `stripeRefundedCents`, `stripeFullyRefunded`, `refunded`. A grep over
    `src/` finds no consumer. A fully refunded €1 000 stays in Financat, in the
    monthly recurring revenue, in staff revenue and in the Arkëtimet totals, with
    no badge anywhere.

17. **Partial invoices read as zero on two summary screens.**
    `src/views/Customer360View.tsx:248-249` counts only `status === 'Paid'` for
    paid and Pending/Overdue for outstanding, excluding Partial entirely;
    `src/views/portal/PortalDashboard.tsx:159-161` and `:268` do the same **for the
    client**. A 100 000 L invoice with 60 000 L paid shows "Totali për t'u paguar:
    0 ALL" in the portal, while `PortalInvoicesView` on the next screen correctly
    shows 40 000. The canonical helpers exist and `CustomersView.tsx:155` uses them.

18. **The WHMCS payment queue is written outside the instalment transaction.**
    `src/lib/firebase.ts:116-170` writes status and payments transactionally;
    `InvoicesView.tsx:625-628` then does a separate update with a bare
    `.catch(console.error)`. If that second write is lost, the overnight sync finds
    no queue entry and flips the invoice back to Pending, erasing `paidAt`.
    CLAUDE.md requires the queue entry in the same update as the status change.

19. **The Arkëtimet page is a permission-denied query.** `payments` is in neither
    `businessIsolatedAlways` nor `teamScopedCollections` in
    `src/hooks/useFirestore.ts`, so `PaymentsView.tsx:26` issues an unconstrained
    collection query while the rule is `isBusinessMember(resource.data.businessId)`.
    An unscoped list over a scoped collection is denied outright. The page renders
    empty and every Stripe receipt is invisible. The route is live
    (`App.tsx:436`, sidebar `Arkëtimet`).

20. **The payment ledger and "cash collected" disagree on cancelled invoices.**
    `src/lib/finance/payments.ts:38-63` emits a row per instalment regardless of
    status, contradicting its own docstring, while
    `financialAnalytics.ts:100` returns 0 for Draft and Cancelled. The "Sinkronizo"
    button therefore creates receipts for a cancelled invoice's instalments.
    A legacy `Partial` invoice carrying only `paidAmount` (no instalment array) is
    the mirror gap: counted as collected, never entering the ledger.

### Recurring engines

21. **The period claim and the schedule use different anchors.**
    `InvoicesView.tsx:2429-2441`: the claim is anchored on `invoiceDate`, the next
    date on `dueDate`. On the ordinary net-30 case (invoice 5 Sep, due 5 Oct) the
    claim covers September and the schedule jumps to November — **October is never
    billed**, and `periodsSkipped` returns 0 so the gap is not even reported.

22. **The anchor day is born already clamped.** `InvoicesView.tsx:2462-2464` falls
    back to `resolvedNextRecurring.getDate()`, which is the output of
    `nextInvoiceOccurrence` — already clamped. A monthly invoice due 31 Jan starts
    life with anchor 28 and can never return to the 31st. This is the exact drift
    `recurringAnchorDay` exists to prevent.

23. **A project's first invoice is not written at the deterministic occurrence id.**
    `ProjectsView.tsx:355` uses a random id and claims the period in a separate
    write at `:389-392`; the cron creates `auto_<projectId>_<periodKey>`
    (`api/cron/run.ts:1591`), which cannot collide with it. If the claim write
    fails, the next hourly run issues a second invoice **and emails it**. Part 1
    has a back-compat coverage query; Part 2 has none, even though the UI already
    stamps `billingPeriodKey`.

24. **Changing a project's billing frequency does not re-express the claim.**
    `ProjectsView.tsx:707-716` writes the new frequency and keeps the old key. A
    weekly key can never equal a monthly one, so the guard goes dead and the month
    is billed again. The invoice form does this correctly at `:2471-2483`.

25. **Part 1 will email a zero-value invoice.** Part 2 refuses
    (`api/cron/run.ts:1556-1582`); Part 1 (`:1300-1470`) creates and mails
    `total || amount || 0` whatever it is.

### Expenses

26. **Marking a project dirty rewrites a closed month's P&L.**
    `ExpensesView.tsx:82-90` writes `spendRollupDirty` through the mutation helper,
    which stamps `updatedAt` (`useFirestore.ts:786-788`). `projectPnl.projectDate()`
    falls back to `updatedAt`, so touching an old expense in September drags a
    March project into September's P&L. The cron deliberately avoids this
    (`api/cron/run.ts:5410-5415`); the client half breaks the same law.

27. **Custom expense categories cannot work at all.** `expenseCategories` is in
    neither scope list in `useFirestore.ts`, so the read is an unscoped list over a
    scoped collection (denied) and the create stamps no `businessId` (denied).
    `customIndustries`, which has the identical rule shape, is listed.

28. **A custom category named "Paga" shadows the built-in Salary category.**
    `ExpensesView.tsx:1614` dedupes on value (`'Salary'`), not on the displayed
    label (`'Paga'`). Rows stored as `category: 'Paga'` are excluded by no expense
    filter and seen by no payroll reader, so the money is counted once as "other
    expenses" **and** again as the salary plan fallback — the exact reconciliation
    break the previous audit closed, reopened by one user typing a category name.

### Staff-side finance

29. **Marking a leaver Inactive retro-zeroes their salary in every past month.**
    `src/lib/finance/salaryHistory.ts:41` returns 0 on `status !== 'Active'` with
    no comparison to `monthEnd`, and there is no termination date field. Eight
    months at 60 000 L vanish from the P&L, the project fixed pool, the department
    labour line and the profit trend the moment someone leaves.

30. **Clearing a salary cannot stop the charge.** Once `salaryHistory` is
    non-empty, `salaryHistory.ts:53-60` never consults `monthlySalary`.
    `TeamsView.tsx:1404-1441` deletes the field but only appends history when the
    new salary is `> 0`, so the old amount is charged forever. Typing `0` behaves
    identically.

31. **`profitSplit` is write-only.** Written by `ProjectsView.tsx:1469-1476`,
    typed at `types/index.ts:488`, read only by
    `src/lib/finance/staffRevenue.ts:68` — which nothing imports. The shipped panel
    (`FinancesView.tsx:531-570`) credits the whole project to the responsible user.
    A 50/50 split shows 100/0. The dialog only warns when the split misses 100 %
    and saves anyway.

32. **`computeStaffRevenue` is dead code whose header claims to be the source of
    truth.** 224 lines, zero importers, no route, no test file — the only finance
    module without one. Line 189 charges `monthlySalary × months` directly,
    ignoring recorded payments, history and start dates, so re-wiring it as-is
    would break the payroll law.

33. **Bonuses are over-paid because part of the salary is never charged.**
    `BonusView.tsx:243-256` iterates `memberUserIds` for the charge but builds the
    denominator from projects matching `responsibleUserId` too. Half the salary
    goes uncharged, raising the surplus and the bonus every month.

34. **A partial salary month collapses the bonus threshold.**
    `BonusView.tsx:183-194` prefers the amount recorded in the month over the plan.
    An advance of 30 000 against an 80 000 salary drops the threshold from 240 000
    to 90 000 and shrinks every tier band.

35. **A retainer only exists in its latest completion month.**
    `BonusView.tsx:151-162` keys on `lastCompletedAt`, a single overwritten field,
    so July's already-paid bonus stops reproducing the moment September closes.

36. **Hosting: a paying customer can stay suspended and be billed again.**
    `api/_hostingJobs.ts:723-741` advances `nextDueDate` and clears
    `currentInvoiceId` even when `whmUnsuspendAccount` throws, with no retry and no
    staff notification. The next cycle issues a fresh invoice for a site that is
    still down.

37. **Hosting upgrade proration mixes currencies.**
    `api/_hostingJobs.ts:1584-1586` subtracts the subscription's amount (its
    currency) from the product's price (its own), and `quoteUpgrade` never compares
    them. A 12 EUR/month subscription upgraded to a 1 500 ALL package invoices
    **1 488 EUR**. The reverse direction reads as a downgrade and is applied free.

---

## P2 — races, edges, cosmetics

**Money math and display**
- `InvoicesView.tsx:751-753` hand-rolls pending/overdue/partial totals three ways
  in one file instead of using `getInvoiceOutstandingAll`, and reads `paidAmount`
  where the canonical helper prefers the instalment array.
- Discount clamping differs between the form (`:2376`), the detail view (`:3489`)
  and the PDF (`:3832-3834`); a fixed discount larger than the subtotal prints a
  box that does not add up. The PDF also falls back to `subtotal = total`.
- The PDF forces ALL or EUR (`:3644-3646`), so a WHMCS-mirrored USD or GBP invoice
  prints Lek amounts.
- Shop: tax-inclusive products lose a cent per line at quantity above one
  (`src/lib/shop/pricing.ts:62-71`); the shop invoice omits shipping from its own
  arithmetic while charging it (`ShopOrdersView.tsx:184-199`).
- The calculator adds a one-off to a monthly rate in `grandTotal`
  (`src/lib/calculator/calculations.ts:306`), which feeds the margin, the minimum
  acceptable price and the printed contract total.

**Races and idempotency**
- `applySubscriptionRenewal` / `applyDomainRenewal` are read-modify-write with a
  provider call in the middle (`api/_hostingJobs.ts:717-790`); a collision between
  the Stripe webhook and the hourly loop can renew a domain twice at the registrar,
  which costs real money.
- Coupon `maxUses` is checked and incremented outside a transaction
  (`api/_hosting.ts:192-201`, `:356`).
- The Stripe webhook has no `event.id` dedupe and no ordering guard
  (`api/stripe-webhook.ts:588-627`); a retry landing after a cancellation
  reactivates a non-paying tenant.
- `applyStock` is non-atomic and never compensates on cancel or refund
  (`ShopOrdersView.tsx:119-151`).
- Portal shop order numbers are derived from the client's own orders only, so two
  clients collide (`PortalShopView.tsx:189`).
- `project-spend-rollup` takes its cursor after the reads
  (`api/cron/run.ts:5397`, `:5426-5429`), losing anything written during the run.

**Recurring edges**
- A cancelled project clears `isRecurring` without recording
  `wasRecurringBeforeArchive` (`api/cron/run.ts:1512-1519`), so cancel-then-reopen
  gives back a retainer that never bills.
- Archive then restore raises a false "periods missed" alarm.
- Legacy rows with no `businessId` bypass the suspended-tenant exclusion
  (`:1212`, `:1504`).
- `billingPeriodsSkipped` is written but has no reader and is not on the `Project`
  type; its invoice twin is rendered.
- Mirror drift: `resolveInvoiceAnchorDay` disagrees on a string anchor
  (`recurringInvoices.ts:129-131` vs `api/cron/run.ts:937`); the cron's inline
  timestamp parse rejects raw `{seconds}` objects the client accepts.
- The expense edit form lets a series be re-pointed into the past, and a frequency
  change keeps the old-frequency claim (`ExpensesView.tsx:262-265`, `:308-310`).
- The `no-next-date` self-heal overwrites `recurringAnchorDay` with a UTC-shifted
  day (`api/cron/run.ts:1870-1876`).
- Duplicate detection always groups monthly, so every weekly series is flagged as
  four duplicates with a fake waste figure (`ExpensesView.tsx:479`).
- A hosting package priced 0 for a cycle sells and then never bills
  (`src/lib/hosting/engine.ts:141-153`); domains have the guard, hosting does not.
- `requestUpgrade` reuses a day-keyed invoice id, so a second upgrade the same day
  points at a dead cancelled invoice (`api/_hostingJobs.ts:1609-1620`).

**Analytics edges**
- The Fitimi tab charges a whole month's payroll against a part-month of cash; the
  hero prorates and the tab does not.
- A recurring expense series past its end date still inflates fixed outflow
  (`recurringExpenses.ts:250-256`).
- Misconfigured recurring invoices count as revenue while the same page flags them
  as "s'do gjenerohet kurrë".
- The hero's month-over-month delta compares a whole month against a part month.
- Department payroll evaporates when a tenant has recorded salary payments but no
  Active members (`departmentPnl.ts:200-207`).
- `appendSalaryChange` de-dupes by the **UTC** day (`salaryHistory.ts:99`), so two
  changes a day apart can collapse into one.
- `toAll` reads the rate from `localStorage` non-reactively
  (`src/lib/utils.ts:90-101`). A memo computed before the tenant's settings sync
  uses the default EUR = 100 and never recomputes for the session.
- `FinancesView.tsx:536` runs the whole project allocation a second time with
  identical arguments.
- The hosting finance window ends at `23:59:59.000`, dropping a renewal in the
  last second of the month.
- The concentration alarm window is four months while the copy says three.
- `revenueAttribution.ts:104` uses `responsibleUserId` alone where the accrual row
  it merges into falls back to `createdByUserId`, so a legacy project shows revenue
  with zero collected.
- Six expense handlers write with no try/catch and no toast, so a rules denial is
  a silent no-op (`ExpensesView.tsx:341`, `:349`, `:357`, `:361`, `:380`, `:405`).
- The per-tenant cron toggles in Cilësimet are never read by `api/cron/run.ts`.
- Deleting an invoice orphans its `payments` ledger rows.
- The portal offers no "pay" button on a `Partial` invoice
  (`PortalInvoicesView.tsx:369`) although the checkout endpoint charges the
  remainder correctly.
- `hiredAt` has no UI and `startDate` is not on `TeamMember`, so `memberStartDate`
  always falls back to `createdAt`.
- `monthlySalary` and `hourlyCostRate` carry no currency and are always read as
  ALL.
- The salary category string is duplicated in five places
  (`financialAnalytics.ts:160` plus local redeclarations and bare literals in
  `departmentPnl.ts:86`, `projectPnl.ts:134`, `recurringExpenses.ts:273`,
  `api/cron/run.ts:5392`).

---

## Verified sound

Worth recording, so these are not re-audited:

- **Stripe invoice checkout.** The amount is server-authoritative, remainder-only
  for partially paid invoices, Draft/Paid/Cancelled refused server-side, redirect
  hosts allow-listed, raw body and signature verified. The ALL→EUR conversion uses
  the tenant's bounded rate, snapshotted into metadata and re-checked by the
  webhook, which refuses to mark Paid on a mismatch. Per-line rounding is pinned so
  the sum equals the authoritative total.
- **Double payment and redelivery** of an invoice checkout: all guards and writes
  run in one transaction with a deterministic ledger id, and the duplicate branch
  escalates rather than overwriting.
- **Plan derivation** reads the price actually billed; a missing env var leaves the
  plan unwritten rather than downgrading the tenant. Seats agree across both halves.
- **Hosting renewal idempotency.** The period key is the document id, written with
  `create()`, and `nextDueDate` moves only in `applySubscriptionRenewal` via
  `addMonthsClamped` with the anchor day.
- **Recurring occurrence ids** use `create()` in both parts, the email is pushed
  after the awaited create, and `ALREADY_EXISTS` is treated as "record the claim
  and move on".
- **Block-reason mirrors** for invoices and projects match reason-for-reason and in
  order; the expense mirror matches too, modulo the shared timezone defect.
- **The reconciliation invariant** holds: the payroll and expense terms use the
  same date source, the same rejected-row filter, the same conversion and the same
  inclusive month bounds, and the salary split partitions every row exactly once.
  One unreported edge remains: a month whose salary rows sum to zero or less
  silently falls back to the plan.
- **No hosting double count** — hosting invoices are `autoGenerated` and never
  `isRecurring`, so the invoice loop cannot see them.
- **Cancelled invoices owe nothing** everywhere the canonical helpers are used, and
  partial payments are counted exactly once.
- **Time entries are consistently in minutes** across every writer and reader.
- **Invoice numbering** is atomic, business-scoped and self-healing.
- **The portal invoice query** is server-side constrained to the client's own
  customer id, with drafts filtered; no cross-client leak.
- **The expense approval workflow** matches its rules, and tests 43-45 cover
  self-approval, a silent amount raise, a tenant hop and deleting an approved row.
- **`getExpenseDate` is used everywhere**; no bare `e.date` survives.
- **WHMCS**: deterministic transaction ids, duplicate treated as success, local
  status preserved while the queue is non-empty, and all three manual mark-paid
  paths spread the queue patch.

---

## Fix status — 18 Sep 2026

Everything below was fixed the same day unless the row says otherwise. Verified
with the full unit suite (1449+ tests), the Firestore rules suite in the emulator
(123 tests), a production build, and a clean `npm run typecheck:api`. The app-side
typecheck fell from 214 pre-existing errors to about 199.

### Closed

- **P0 1, 2 — unscoped manual jobs.** `manualScopeId()` in `api/cron/run.ts`
  confines a hand-triggered `invoice-reminders`, `overdue-reminders` and
  `recurring-expenses` to the caller's own tenant, super-admin excepted, and all
  three now skip suspended tenants. A hole found while fixing this was closed
  too: `run-all` could be triggered manually by any Admin and ran every job
  unscoped, side-stepping every per-job limit. It is now super-admin only.
- **P0 3 — machine-local period keys.** All billing calendar arithmetic moved to
  the declared business zone. New helpers in `src/lib/recurringUtils.ts`
  (`zonedParts`, `zonedDate`, `addZonedDays`, `addZonedYears`,
  `addZonedMonthsClamped`, `startOfZonedWeek`, `daysInZonedMonth`), mirrored
  function-for-function in `api/cron/run.ts`. `recurringBilling.ts`,
  `recurringInvoices.ts` and `recurringExpenses.ts` all route through them, and
  the suites now pass under both `TZ=UTC` and `TZ=Europe/Tirane` with explicit
  tests pinning the keys of a local-midnight 1 August, 1 January and Monday.
- **P0 4 — salary exposure**, partially. The route is now behind `ModuleGate`
  with the Financat permission key, and a user without it fetches nothing. See
  "Still open" for the half that remains.
- **P0 5 — portal shop pricing.** Portal orders are re-priced from the live
  catalog before they are billed, an invoice is settled only on staff
  confirmation, and the rules refuse a portal order that arrives claiming to be
  paid.
- **P0 6 — portal quote tampering.** The portal update clause is restricted to a
  response on a Sent quote, drafts are unreadable, and both portal queries carry
  the matching status constraint (`src/lib/quoteVisibility.ts` is the one list).
- **P1 7, 8, 10 — forecast.** `projectBillsNextMonth` now asks
  `projectBillingBlockReason` instead of a hand-written allow-list, weekly
  retainers are normalised per month, and an unknown frequency contributes zero.
- **P1 9 — dead retainers.** A shared `retainerEarningEnd` ends a retainer's
  earning span at the first real end signal, and a live retainer is no longer cut
  short by `lastCompletedAt`.
- **P1 11 to 20 — invoices and payments.** The overdue email asks for the
  remainder and got its own honest variant (it used to tell a customer 45 days
  late that the deadline expired today); `paidAt` survives creating an invoice as
  paid; date inputs round-trip in the business zone; overdue starts after the due
  day ends; suspended tenants stop dunning; refunds are excluded from the
  receipts total and badged; Partial invoices read correctly on both summary screens
  and in the portal; the WHMCS payment queue is written inside the instalment
  transaction; `payments` and `expenseCategories` are registered in the scope
  lists so their queries are no longer denied; the ledger and "cash collected"
  agree on Draft and Cancelled.
- **P1 21 to 25 — recurring engines.** The claim and the schedule share one
  anchor; `recurringAnchorDay` is taken from the input date, never from a clamped
  output; a project's first invoice is written at the deterministic occurrence id
  inside a transaction that refuses to overwrite; a frequency change re-expresses
  the claim; Part 1 no longer emails a zero-value invoice.
- **P1 29, 30 — salary history.** A leaver keeps costing the months they worked
  (`leftAt`, with an `updatedAt` fallback) and clearing a salary now appends a
  zero history entry instead of being ignored.
- **P1 31 to 35 — bonuses.** The salary charge and its denominator share one
  participant set, a partial salary month no longer collapses the threshold, and
  direct costs are filtered to the bonus period.
- **P1 36, 37 — hosting.** Covered in the shop and hosting passes; the currency
  guard on upgrade proration is the one that mattered.
- **All five per-tenant cron switches in Cilësimet now do something.** They were
  written to `teamSettings.cronSettings` and read by nobody, so switching a job
  off changed nothing. One shared `cronToggleReader()` in `api/cron/run.ts`
  serves `task_alerts`, `task_reminders`, `invoice_reminders` and
  `recurring_tasks` (one settings read per team, not per row), and
  `runWhmcsSync` checks `whmcs_sync` once at the top. Absent still means on.
- **Assorted P2s**, including the project-spend rollup cursor, the expense
  self-heal overwriting its own anchor, a cancelled retainer that could never be
  reopened, shop tax rounding, non-atomic stock moves, colliding portal order
  numbers, and the discount box that did not add up (now one tested module,
  `src/lib/finance/invoiceTotals.ts`).

### Still open

- **The rules still let any business member read salaries.** `teamMembers`
  carries `monthlySalary` and `salaryHistory`, and salary payments are `expenses`
  rows, both readable by `isBusinessMember`. The client no longer ships that data
  to an unprivileged user, but a determined one can still issue the query.
  Closing it properly means moving compensation into its own collection
  (`teamMemberComp/{teamId}_{uid}`, deny-all but self and approvers) with a
  backfill, a dual-read period, and only then clearing the legacy fields. That
  cannot be completed without running the backfill against production, so it is
  deliberately left as its own piece of work.
- **Shop order documents still carry client-authored figures.** The money is
  safe because the staff side re-prices before billing, but the back-office list
  and the revenue stat card still display what the client sent. The durable fix
  is a server action on the existing `api/email.ts` rewrite hatch.
- **Deploy steps.** `firebase deploy --only firestore:rules` and
  `firestore:indexes` are required before the portal quote changes work in
  production, and the VPS should be restarted so the cron picks up the new job
  signatures.
