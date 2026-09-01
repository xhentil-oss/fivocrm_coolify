# Finance module — audit & remediation (Shtator 2026)

Second-pass audit of the finance surface, with the emphasis the owner asked for:
**recurring invoices**. Scope: `src/lib/finance/*`, `api/cron/run.ts`
(`recurring-invoices` Part 1 = invoice recurrence, Part 2 = project retainers,
`invoice-reminders`), `src/views/InvoicesView.tsx`, `src/views/ProjectsView.tsx`
(first-invoice path), `src/views/FinancesView.tsx`.

Baseline at audit time: **226/226 `src/lib/finance/` tests green**, invoices
module already remediated once (`workspace/INVOICES_AUDIT_2026_08.md`). Every
finding below is NEW — it survived that audit because it sits either in the
*anchor/period arithmetic between two runs* (which no test walked) or outside the
invoice module proper.

Status: ✅ fixed · 📋 backlog (reason given)

---

## Kritike

| # | Finding | Status |
|---|---|---|
| 1 | **A 31st retainer silently re-anchors to the 28th, forever.** The cron computed the next due date with `anchorDay = scheduled.getDate()` — i.e. from the PREVIOUS occurrence, which is already clamped. One February clamps the series permanently: 31 Jan → 28 Feb → 28 Mar → 28 Apr → … The client is billed three days early for the rest of the contract, and `recurringEndDate` arrives a cycle early. This is precisely the drift `recurringAnchorDay` exists to prevent for recurring EXPENSES (CLAUDE.md names it); invoices never got the field. Proven by a walk-forward regression test. | ✅ |
| 2 | **The parent invoice's own period was not claimed, so it could be billed twice.** `ExpensesView` has stamped `lastGeneratedPeriodKey` at creation since the expense audit; the invoice form never did. Any user who sets "generate again" to a date inside the invoice's own period — e.g. invoice dated 5 Sept, next generation the 20th, a natural way to say "bill on the 20th" — got a second September invoice, **emailed to the client**, with nothing blocking it. `invoiceBillingBlockReason` returned `null` and `periodAlreadyCovered` only looks at children, of which there were none. | ✅ |
| 3 | **Any tenant Admin could bill — and email — every other tenant's customers.** "Gjenero Periodike" calls `?job=recurring-invoices&manual=1`; `authorizeManual` accepts any Admin/Owner of any team, and the job then iterated `invoices`/`projects` **cross-tenant** with no scope. One button press generated invoices for the whole platform and sent them by SMTP, at a moment those tenants never chose. (Backlog #24 of the previous audit called this a *cost* problem; the side effects make it a tenancy breach.) | ✅ |

## Të rënda

| # | Finding | Status |
|---|---|---|
| 4 | **A project retainer that missed a period lost the money silently.** Part 2 derives everything from `now`, so a month the cron never ran in is simply never billed — no field, no notification, no count. Part 1 has reported its gap since the last audit (`recurringPeriodsSkipped`); the engine that carries the recurring revenue had nothing. | ✅ |
| 5 | **Cancelled invoices were counted as money owed.** `getInvoiceOutstandingAll` zeroed `Paid` and `Draft` but not `Cancelled`, while `getInvoiceCollectedAll` DID zero it — so a voided invoice reported its full value as receivable in the AR total (FinancesView), the aging report, and the ">60 ditë" cash alarm. Worst where it matters most: the older a void invoice gets, the louder the alarm shouts. | ✅ |
| 6 | **`recurringPeriodsSkipped` / `recurringStoppedReason` were written and rendered nowhere.** The last audit's promise was "surfaced, never backfilled" — half of it shipped. If `createdByUserId` was null (imported/WHMCS series) there was no notification either, so the one case where revenue is genuinely missing was invisible in the product. | ✅ |
| 7 | **Recurring revenue (MRR) disagreed with the engine that bills it, in both directions.** `monthlyRecurringRevenue` used a hand-written status allow-list: it dropped `Completed` retainers (which `projectBillingBlockReason` bills — for a retainer, "Completed" means this cycle's work is done) and kept `isRecurringPaused` / expired ones. The cash-flow gap alarm is the number meant to warn the owner *before* the money runs out; one that under-reports is worse than none. | ✅ |
| 7b | **A suspended tenant kept invoicing and emailing its own customers** — the cron bypasses the rules that stop them (see #16 below). | ✅ |
| 8 | **Changing a series' frequency left a stale period claim.** A monthly key (`'2026-09'`) can never equal a weekly one (`'W2026-09-14'`), so after a frequency switch the claim stopped blocking anything and the new cycle could re-bill a period that had already been invoiced. | ✅ |

## Të moderuara

| # | Finding | Status |
|---|---|---|
| 9 | **`emailSent` could be written before the invoice existed.** `newInvoiceRef.set(...)` and the `sendMail().then(() => newInvoiceRef.update({emailSent:true}))` were both pushed into the same *unordered* `ops` array. A slow create + a fast SMTP send throws NOT_FOUND, leaving the invoice marked un-emailed — and the 25th/last-day reminder job then mails the client again. Both engines. | ✅ |
| 10 | **Two cash-collected implementations disagreed.** `getInvoiceCollectedBetween` was fixed in the last audit (an instalment stays in its own month); `calculateRevenueBetween` and `buildCashflowByMonth`'s inflow still credited a `Paid` invoice's whole total to `paidAt` and counted instalments only while the status was literally `Partial` — so the cash-flow chart and the revenue chart could not agree about the same month. Both now delegate to the canonical helper. | ✅ |
| 11 | **A recurring invoice series past its `recurringEndDate` still counted as MRR** until the cron's next pass noticed and cleared `isRecurring`. | ✅ |
| 12 | The `Invoice` type declared **none** of the recurrence fields the cron writes (`lastGeneratedPeriodKey`, `lastGeneratedAt`, `periodKey`, `recurringPeriodsSkipped`, `recurringStoppedReason`), so every reader reached them through `(invoice as any)` and a typo was unfindable. | ✅ |

## Të mëparshmet e backlog-ut — të mbyllura në të njëjtin kalim

| # | Finding | Status |
|---|---|---|
| 13 | **Fatura e parë e një retainer-i projekt ishte `Draft`, të gjitha të tjerat `Pending` + email.** `Draft` është jashtë të DYJA bazave të të ardhurave (accrual dhe cash) dhe jashtë portalit — pra muaji i parë i çdo retainer-i binte heshturazi nga librat, ndërsa muajt 2..n faturoheshin normalisht. Tani lëshohet `Pending`, si çdo okurencë tjetër. Nuk dërgohet automatikisht me email: pronari e dërgon me "Dërgo" pasi e kontrollon. | ✅ |
| 14 | **Motorët nuk ishin transaksionalë.** Okurenca shkonte në një id të rastësishëm dhe pretendimi i periudhës ishte një shkrim i dytë, i parenditur; nëse ai dështonte (ose ekzekutimi vdiste midis të dyjave, ose një trigger manual garonte me cron-in), kalimi tjetër e faturonte periudhën sërish. Tani id-ja e dokumentit është **determinist** — `rec_<parentId>_<periodKey>` / `auto_<projectId>_<periodKey>` — dhe shkrimi është `create()`, jo `set()`: dublikata nuk është më e pagjasë, është e pamundur. Një `ALREADY_EXISTS` regjistron pretendimin dhe vazhdon. | ✅ |
| 15 | **N+1 lexime për seri.** Projekti i lidhur lexohej një-nga-një për ÇDO faturë periodike (para se të vlerësohej qoftë edhe një bllok i lirë), pastaj **rilexohej** për emrin në email; dhe historiku i plotë i fëmijëve pyetej për çdo seri në çdo kalim, edhe kur pretendimi ekzistonte. Tani: një `getAll` në blloqe prej 300, projekti ripërdoret për emrin, dhe pyetja e fëmijëve bëhet vetëm për prindërit pa `lastGeneratedPeriodKey`. | ✅ |
| 16 | **Një tenant i PEZULLUAR vazhdonte të faturonte klientët e vet.** `tenantActive()` në `firestore.rules` i ndalon shkrimet, por cron-i punon me Admin SDK, që i anashkalon rregullat plotësisht — pra një tenant i papaguar gjeneronte fatura dhe ua dërgonte klientëve të vet me email, në emrin tonë, për aq kohë sa ekzistonin të dhënat. Një pyetje e vetme (`businesses where status == 'suspended'`) i përjashton, dhe numri raportohet si `suspendedSkipped`. | ✅ |
| 17 | **Tri baza datash në një grafik.** Seria `pending` e `buildRevenueByMonth` grupohej sipas `createdAt`, ndërsa `value`/`paid` sipas datës së pagesës dhe pamja accrual sipas `invoiceDate` — pra një faturë e prapa-datuar shfaqej në muajin kur u shkrua, jo në atë ku bën pjesë. Tani grupohet sipas datës së lëshimit, si gjithçka tjetër. | ✅ |
| 18 | **Nuk kishte si ta gjeje "nënën" e një fature periodike.** Fatura-bijë tregonte 8 shkronja të id-së së prindit, pa link; nuk kishte as filtër për seritë. Tani: butoni **↻ Periodike (nënat)** në filtrat e listës, dhe në detajet e së bijës një link i klikueshëm me NUMRIN e faturës-nënë (+ periudha që mbulon). Prindi tregon sa okurenca ka gjeneruar. | ✅ |

### Ende me qëllim jashtë fushës

- **Cron-i i planifikuar mbetet kryq-tenant.** Kjo është natyra e tij: ai vepron për
  gjithë platformën një herë në ditë, dhe dokumentet legacy pa `businessId` duhet të
  faturohen gjithsesi. Nuk është anti-pattern-i i "koleksionit të pafiltruar" — pyetja
  filtrohet nga një fushë e indeksuar (`isRecurring`), dhe fan-out-i për-tenant do të
  lexonte saktësisht të njëjtat dokumente. Rreziku real që fshihej pas atij artikulli
  ishte tenant-i i pezulluar (#16) dhe trigger-i manual (#3) — të dyja të mbyllura.

---

## What the fix established (rules to keep)

1. **The billing anchor is a property of the SERIES, never of the last
   occurrence.** `recurringAnchorDay` is written once (at creation, or backfilled
   by the cron) and re-derived only when the user explicitly changes the next
   date. Read it through `resolveInvoiceAnchorDay()` — mirrored in
   `api/cron/run.ts`. Re-deriving it from `nextRecurringDate.getDate()` is the
   drift, not a shortcut around it.
2. **The parent occurrence claims its own period at creation.** A recurring
   invoice IS the first occurrence of its series, so the form stamps
   `lastGeneratedPeriodKey` for the period of its own `invoiceDate` — the same law
   `ExpensesView` follows. Nothing else has to validate the user's chosen
   next-date: the claim makes a same-period generation impossible, and the series
   resumes by itself when the period rolls over.
3. **A frequency change re-expresses the claim, it does not keep it.** Keys from
   different frequencies are never equal, so a kept claim is a claim that has
   stopped guarding anything.
4. **A manual money job runs inside one tenant.** `recurring-invoices?manual=1`
   is scoped to the caller's `bid` claim unless they are a platform super-admin;
   no resolvable business = 403, never a cross-tenant run. Any future job that
   *sends* something (email, WhatsApp, an invoice) must do the same.
5. **Both engines report the periods they missed.** Part 1 via
   `recurringPeriodsSkipped`, Part 2 via `billingPeriodsSkipped` +
   `projectPeriodsSkipped()`. Reported, never auto-backfilled (rewriting closed
   books is the owner's call) — and reported in the UI, not only as a notification
   that a null `createdByUserId` swallows.
6. **"Will this bill?" has exactly one answer.** MRR, the cash-flow gap and the
   forecast ask the billing engine's own predicate, not a status allow-list.
7. **A cancelled invoice owes nothing** — in every receivables reader.
8. **One definition of "cash collected in a window"**:
   `getInvoiceCollectedBetween`. Any second implementation will diverge; two of
   them already had.

---

## Verification

| Gate | Result |
|---|---|
| `npx vitest run src/lib/finance` | **249 passed / 12 files** (was 226; +23 new) |
| `npx vitest run` (full) | **1128 passed / 57 files**, 0 failed |
| `npm run typecheck:api` | **clean (0)** — kept at 0 |
| `npm run typecheck` (app) | **216 errors, identical to the pre-change baseline** (0 new; the one `recurringBilling.ts` error is pre-existing) |
| `npm run build` | ✓ built |

New tests worth knowing about:
- `recurringInvoices.test.ts` — *"REGRESSION: a 31st series does not drift to the
  28th after February"* walks four cycles both ways and pins finding #1; *"BUG:
  without a period claim, a next-date inside the parent month re-bills it"* keeps
  finding #2 visible next to its fix.
- `recurringBilling.test.ts` — `projectPeriodsSkipped`, including *"never
  guesses"*: no key, a key older than the window, or a key from another frequency
  all report 0 rather than inventing a gap.
- `financialAnalytics.test.ts` — the cancelled invoice is out of the AR total AND
  the aging report; and the cash-flow chart and the revenue chart are asserted
  equal for the same month.
- `forecast.test.ts` — a `Completed` retainer counts, a paused/cancelled/expired
  one does not. The old test asserted the opposite for `Completed`; it encoded the
  allow-list, not the billing rule.

## Deploy notes

1. **Push-triggered Vercel deploy is enough.** No Firestore rules change, no new
   index (two equality filters merge single-field indexes), **no VPS restart** —
   `vps/server.ts` is untouched, it only pokes `?job=…` on a schedule.
1b. **Occurrence ids change shape** (`rec_<parentId>_<periodKey>`). Existing
   children keep their random ids and are still found by `parentInvoiceId`; the
   `periodAlreadyCovered` back-compat path is what stops the first run after
   deploy re-billing a period that a random-id child already covers. Nothing to
   migrate.
2. **The anchor backfill is best-effort for a series that has already drifted.**
   The cron pins whatever day the series is currently on. To restore an intended
   31st, open the invoice and set the next date to the 31st — an explicitly
   changed date re-derives the anchor by design.
3. **The first run after deploy claims a period for every live series** it
   generates, and (unchanged) derives coverage from existing occurrences for
   parents that predate `lastGeneratedPeriodKey`, so nothing bills twice.
4. Watch the `recurring-invoices` job summary for **`projectPeriodsMissed > 0`**:
   those retainers lost whole periods under the old engine. They are NOT
   auto-billed — decide per client.
5. A manual "Gjenero Periodike" now reports only the caller's tenant. A
   super-admin still gets the platform-wide run.
6. Watch `suspendedSkipped` in the job summary: those tenants are past the grace
   period and are no longer invoicing their clients. If a number appears there
   that you did not expect, check `businesses/{id}.status` before assuming a
   billing outage.
