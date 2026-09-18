# Deploy runbook — finance audit of 18 Sep 2026

What is in the tree, in what order it must reach production, and how to tell
whether each step worked. The findings themselves are in
`workspace/FINANCE_BUGS_2026_09_18.md`.

---

## 0. What has already happened

The work is commit `d95d91f` on `main`, pushed and built by Vercel. It is large
on purpose: it closes a cross-tenant mailing bug, a whole class of timezone bugs
in billing, and two portal holes.

```bash
git show --stat d95d91f
```

That commit also carries in-progress work that was already in the tree before the
audit (the module registry, the super-admin tenant console, tenant provisioning).
That was not mine to separate, and splitting it by hand risked breaking it.

Indexes and rules were deployed on 18 Sep 2026, in the order section 1 describes.
What remains is section 3: the compensation backfill, which needs a human,
because its acceptance test is comparing a payroll figure in the running app.

---

## 1. The order matters — DONE on 18 Sep 2026

> **Status: steps 1–3 are done.** Commit `d95d91f` is on `main`, Vercel built it,
> and both `firestore:indexes` and `firestore:rules` were deployed after the app
> went live. Verified before deploying: the live `PortalQuotesView` and
> `PortalDashboard` chunks both send the `status in [...]` constraint the new rule
> requires, and the emulator suite passed 127/127. The site answers 200 after the
> deploy. What is left is section 3 (the pay backfill), which needs a human.


**Push the app BEFORE deploying the rules.** The portal quote screens now send a
`status in ['Sent','Accepted','Rejected']` constraint, and the new rule *requires*
that constraint to be present. Firestore evaluates a list rule against the query
shape, not against the documents — so a browser still running the old bundle,
which sends no status constraint, is denied outright and the client's Preventiva
page goes blank.

So:

1. **Indexes** (safe at any time, do it first anyway)
   ```bash
   firebase deploy --only firestore:indexes
   ```
   Adds `quotes (customerId, status)` and `quotes (leadId, status)`. These are
   probably belt-and-braces — the queries are equality-only and Firestore can
   serve them by merge join — but deploy them so nothing depends on that.

2. **The app** — push to `main`; Vercel builds from it. Wait for the deployment
   before step 3. To confirm it really is live rather than trusting a timer,
   fetch the live `PortalQuotesView` chunk and check it carries
   `field:"status",operator:"in"` — that is the constraint the new rule needs.

3. **Rules**
   ```bash
   firebase deploy --only firestore:rules
   ```
   127 rules tests pass in the emulator. To re-run them yourself, note that the
   default `java` on this machine is 17 and firebase-tools refuses anything below
   21; the Android Studio JBR is 21:
   ```powershell
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   $env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
   npm run test:rules
   ```

**No VPS restart is needed.** `vps/server.ts` was not touched. The scheduler only
triggers the jobs; the job bodies live on Vercel and update with the app.

---

## 2. Smoke tests, in the order they will tell you something

Each one checks a specific fix. Do them on production after step 3.

| Check | How | What proves it worked |
|---|---|---|
| Manual jobs are tenant-scoped | Cilësimet → Automatizime → "Ekzekuto Tani" on Kujtesa faturash, as a normal tenant Admin | The response carries `scopedTo` with that tenant's own business id. Before, it silently touched every tenant. |
| `run-all` is closed | Call `/api/cron/run?job=run-all&manual=1` as a tenant Admin | 403 with an Albanian message. A super-admin still gets through. |
| Portal cannot rewrite a quote | As a portal client, try to change a quote's `result` from the console | Permission denied. Accepting or rejecting a Sent quote still works. |
| Portal cannot see drafts | Open the client's Preventiva page | Only Sent / Accepted / Rejected appear, and the drafts are not in the network response either. |
| Partial invoices read correctly | Open a client with a part-paid invoice, in the portal and in Customer360 | Both show the remainder, not 0 and not the gross. |
| Arkëtimet loads | Open `/app/payments` | Rows appear. It used to be an empty page caused by a denied query. |
| The overdue email is honest | Wait for, or trigger, `overdue-reminders` on a late part-paid invoice | The mail asks for the remainder and names the days late, instead of claiming the deadline expires today. |
| The cron switches work | Turn a job off in Cilësimet, run it | The result reports `toggledOffSkipped` and nothing is sent. |

---

## 3. The compensation migration — this one has a second half

Salaries used to be readable by every member of the business. The client no
longer ships them and the Bonuset page is gated, but the Firestore rule still
grants `teamMembers` reads to any member, so a determined user could still query
them. The fix is a `teamMemberComp` collection, and it rolls out in three steps
of which only the first is in this branch.

**Step A — already in the code.** Compensation is written to BOTH the new
collection and the old fields, and every reader prefers the new document and
falls back to the old fields. That means the code behaves identically before and
after the backfill, which is what makes it safe to ship.

**Step B — you run the backfill.** As a platform super-admin:

```
POST /api/cron/run?job=backfill-member-compensation&manual=1
```

It is idempotent, so running it twice is fine. It reports how many documents it
wrote and how many were already present. Verify by opening Financat for a month
that has no recorded salary payments: the payroll figure must be identical before
and after. If it changed, stop and do not proceed to step C.

**Step C — only after B is verified, and not today.** Clear `monthlySalary`,
`salaryHistory` and `hourlyCostRate` from `teamMembers`, then tighten the
`teamMembers` read rule. A comment above that rule in `firestore.rules` says what
to change and in which order. Until step C is done, the salary data is still
readable by a determined member — the exposure is reduced, not closed.

---

## 4. What is still open after all of this

- **Step C above.** The rules-level salary exposure is not closed until the
  legacy fields are gone.
- **The scheduled cron reads are still unfiltered.** The manual runs are scoped,
  which was the leak. The scheduled run still reads `invoices` without a tenant
  filter, which is a cost problem rather than a security one, and belongs with
  the `tenantScopedDocs()` rollout.
- **Shop order documents still carry client-authored figures.** The money is safe
  because the staff side re-prices from the catalog before billing, but the
  back-office list and the revenue card still display what the client sent. The
  durable fix is a server action on the existing `api/email.ts` rewrite hatch,
  which avoids adding a 13th Vercel function.
- **Almost nothing has been exercised against a live app.** The verification
  behind this work is 1463 unit tests, 127 rules tests in the emulator, a clean
  API typecheck and a green production build, plus a check that the deployed
  bundle and the deployed rules agree on the portal query shape. That is not the
  same as somebody using the product.
