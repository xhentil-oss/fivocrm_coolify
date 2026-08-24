# Invoices module — audit & remediation (Gusht 2026)

Full-stack audit of the invoice module: `src/views/InvoicesView.tsx`,
`src/views/portal/PortalInvoicesView.tsx`, `api/_send-invoice-email.ts`,
`api/_invoiceEmail.ts`, `api/create-checkout-session.ts`, `api/stripe-webhook.ts`,
`api/cron/run.ts` (Part 1 = invoice recurrence), `firestore.rules`.

Baseline at audit time: **150/150 `src/lib/finance/` tests green** — every finding
below sat in untested territory (the view, cron Part 1, the API, the PDF).

Status: ✅ fixed · 📋 backlog (deliberately deferred, reason given)

---

## Kritike

| # | Finding | Status |
|---|---|---|
| 1 | **Recurring invoice series died permanently after lagging one cycle.** `lastChildCreatedAt >= nextDate` — the catch-up child is created "now", newer than every remaining due date, so the guard stayed true forever. Exactly the anti-pattern CLAUDE.md forbids by name for expenses; the invoice engine never migrated to a period key. | ✅ |
| 2 | **Auto-generated invoices' line items were unreadable by everyone.** The cron's `invoiceItems` copy stamped only `teamId` — no `businessId` (forced filter in `businessIsolatedAlways` + rules) and no `customerId` (portal RLS). Staff, portal and PDF all showed an empty items table against a correct total. Present in **both** engines (Part 1's copy and Part 2's project line); both fixed, plus `scripts/fix-orphan-invoice-items.mjs` to repair the rows already written. | ✅ |
| 3 | **The client portal listed Draft invoices** (and offered a "Skicë" filter). Drafts are unissued documents, including the 0 L ones ProjectsView auto-creates. The analogous rule for quotes is explicit in CLAUDE.md. | ✅ |
| 4 | **Two billing engines could bill one retainer twice** with no code-level guard — `scripts/stop-duplicate-invoice-engines.mjs` was the only (manual) defence. | ✅ |

## Të rënda

| # | Finding | Status |
|---|---|---|
| 5 | The quick-edit **drawer wrote `status: 'Paid'` without `paidAt`**, unlike `saveEdit` and the full form. Cash-basis revenue then fell back to `createdAt` — into the wrong month. Row-click opens this drawer, so it was the most-used path. | ✅ |
| 6 | **`setMonth(+1)` on the due date** in `defaultNextRecurring` — 31 Jan → 3 March, skipping February for good. The cron already had the clamped helper; the UI didn't use it. | ✅ |
| 7 | **No double-submit guard** on the invoice form (no `isSubmitting`, no `disabled`, no `try/catch`) → two invoices with the same number. The number is also reserved on form OPEN, burning numbers on cancel, and the transaction-failure fallback bypassed the counter entirely. | ✅ |
| 8 | **Reminder emails demanded the full total** from a partially-paid invoice, labelled "Shuma e papaguar". `create-checkout-session` charged the remainder correctly; the email did not. | ✅ |
| 9 | **Partial payment was a non-atomic read-modify-write** (`[...existingPayments, newPayment]` + `sourceKey: #p${length}`) → concurrent payments lost one and collided on the ledger key. `try/finally` with **no `catch`** meant a failed write showed the user nothing at all. | ✅ |
| 10 | **A portal client could update/delete their own invoice's line items** — the hole closed on `/invoices` was left open on `/invoiceItems`. | ✅ |

## Të moderuara

| # | Finding | Status |
|---|---|---|
| 11 | **Bank details rendered from `localStorage` first**, invoice fields only as fallback — so the PDF could print a different IBAN than the invoice was issued with, print *all* configured banks, and differ per browser. `teamSettings.bankAccounts` was ignored. | ✅ |
| 12 | **Free-text lines lost their description**: `services[item.serviceId]?.title \|\| 'Duke ngarkuar...'` in the detail dialog, `'Shërbim'` in the PDF. | ✅ |
| 13 | **A deleted service silently dropped its `serviceId`** on edit (the total survived via the loaded `unitPrice`, the analytics link did not), and the row rendered an empty service picker with no explanation. | ✅ |
| 14 | **PDF had no page break** (`y += 9` unbounded) and a hardcoded `Faqe 1 / 1`. ~15+ items ran off the page. | ✅ |
| 15 | **`Partial` missing from the status filter pills**, and the form's status select offered no `Partial`/`Cancelled` — editing a partial invoice showed a blank status and could not be restored. | ✅ |
| 16 | After the cron flipped `Partial → Overdue`, **the row stopped showing how much was paid** (display keyed on `status === 'Partial'` while the aggregates were status-robust). | ✅ |
| 17 | **Cash-basis revenue of closed months mutated**: the `status === 'Paid'` branch of `getInvoiceCollectedBetween` credited the whole total to `paidAt` and ignored `partialPayments`, so a June instalment moved to August on final settlement. | ✅ |
| 18 | Mobile menu labels **"Shëno si Dërguar" / "Shëno Kujtesën" actually sent real email** to the client; the drawer's "Dërgo" sent with no confirmation. | ✅ |
| 19 | The delete dialog promised **"Përsëritja vazhdon"** while deleting the parent that drives the cycle, orphaning its children. | ✅ |

## Të vogla

| # | Finding | Status |
|---|---|---|
| 20 | Dead code re-scanning the whole invoice list every render: `totalRevenue`, `draftAmount`. | ✅ |
| 21 | `successUrl` / `cancelUrl` were protocol-checked but not host-allowlisted in `create-checkout-session` — with a public pay link the post-payment redirect could point anywhere. | ✅ |
| 22 | The 25th/last-day reminder query `where(flagField,'==',false)` silently excluded legacy/WHMCS invoices that lack the field. | ✅ |
| 23 | No rate limit on the invoice-email path (the chat-notify path has one). | ✅ |
| 24 | Cron invoice jobs read `invoices` cross-tenant (`where('status','==',…)`, `where('isRecurring','==',true)`), against the documented per-tenant cost rule. | 📋 |
| 25 | The view reads every invoice + **every** `invoiceItem` + projects + customers with no `limit` (orderBy/limit are client-side for business-scoped collections). `visibleCount` caps rendering, not reading. | 📋 |

### Backlog rationale

- **#24** touches every cron job's read shape, not just invoices — it belongs with the
  `tenantScopedDocs()` rollout, not a module fix. Doing it here would leave the other
  jobs inconsistent.
- **#25** needs `teamScopedWhere` + a composite index + cursor pagination in the view;
  it is a perf project with its own index deploy, not a correctness fix.

---

## What the fix established (rules to keep)

1. **The idempotency token for invoice recurrence is the billing PERIOD KEY**, never a
   timestamp — the same law as recurring projects and recurring expenses.
   `src/lib/finance/recurringInvoices.ts` is the single source of truth (unit-tested)
   and is **mirrored** in `api/cron/run.ts`. Keep the two in sync.
2. **A lagging series bills the CURRENT period, never a back-dated closed month.**
   `billingDateFor()` clamps a stale `nextRecurringDate` to today; the skipped periods
   are surfaced (`recurringPeriodsSkipped`), never silently backfilled — rewriting
   closed books is the owner's call.
3. **One retainer, one engine.** `projectAlsoBills()` blocks invoice-driven recurrence
   when the linked project bills itself, and the form warns before you can create the
   overlap.
4. **Anything the cron writes must carry `businessId`** — and `customerId` too when the
   collection is read by the portal (`invoiceItems`, per `isPortalClientFor`). The
   client-side `useMutation` stamps these; server code must do it by hand.
5. **A money write is a transaction.** `recordInvoicePartialPayment()` in
   `src/lib/firebase.ts` is the only way to record an instalment.
6. **The invoice document is the authority on its own bank details** — settings are a
   fallback for legacy invoices that stored none, never an override.

---

## Verification

| Gate | Result |
|---|---|
| `npx vitest run` | **1041 passed / 53 files** (was 1008; +33 new: 30 `recurringInvoices`, 3 cash-attribution regressions) |
| `npm run test:rules` (emulator, JDK 21) | **93 passed / 93**, including the two new `invoiceItems` cases (37b, 37c) |
| `npm run typecheck:api` | **clean (0)** — kept at 0 as required |
| `npm run typecheck` (app) | **219 errors vs 235 baseline** → 16 fewer, 0 new; **0 remaining in the invoice module** |
| `npm run build` | ✓ built |

New tests worth knowing about:
- `recurringInvoices.test.ts` — two explicit regressions: *"a series that lagged a cycle
  still bills"* and *"does not bill twice for one period after a catch-up"*. These are the
  two halves of finding #1 and they pin the period-key law in place.
- `financialAnalytics.test.ts` — *"keeps an instalment in ITS OWN month after the invoice
  is fully settled"* pins finding #17: a closed month's cash figure must not move.
- `firestore-rules.test.mjs` **37c** asserts that a line item with no tenant key is
  readable by nobody — the property that made finding #2 invisible in the first place.

## Deploy notes

1. **`firebase deploy --only firestore:rules`** — required for finding #10
   (`invoiceItems` update/delete is now staff-only). Run `npm run test:rules` first.
2. **No VPS restart is needed.** `vps/server.ts` only fires
   `POST {CRM_BASE_URL}/api/cron/run?job=…` on a schedule — the job LOGIC lives on
   Vercel, so the period-key engine ships with the normal push-triggered deploy.
   A VPS restart is only required when `vps/server.ts` itself changes (e.g. adding
   or re-timing a schedule), which this change did not.
3. **`node scripts/fix-orphan-invoice-items.mjs`** (dry-run) then `--apply` — repairs the
   line items already written without tenant keys. Existing auto-generated invoices keep
   showing an empty items table until this runs.
4. The first cron run after deploy writes `lastGeneratedPeriodKey` on every live series,
   deriving coverage from existing occurrences (`periodAlreadyCovered`) so nothing is
   billed twice on the migration run.
5. Watch for `recurringPeriodsSkipped` notifications: any series that had silently died
   under the old guard will report the periods it missed. Those are **not** auto-billed —
   decide per client whether to raise them manually.
