# System Decisions

*This file is the single source of truth for architectural and implementation decisions in this project.*

## Purpose

Records key technical decisions, their rationale, alternatives considered, and outcomes. This file prevents the same discussions from happening twice and helps future-you (or future-sessions) understand *why* things are the way they are.

## When to Update This File

Update this file when:
- A significant technical or architectural decision is made
- A library, framework, or tool is chosen over alternatives
- A design pattern or approach is selected for a non-trivial problem
- A previous decision is revisited, changed, or reversed
- A constraint or trade-off is discovered that shaped the implementation
- A workaround is chosen due to external limitations (API quirks, library bugs, etc.)

**Do not** log trivial decisions (variable naming, minor formatting). If it wouldn't be worth explaining to a teammate joining the project, skip it.

## Format

Each entry follows this structure:

```
### [YYYY-MM-DD] — [Short Decision Title]

**Status:** Accepted | Superseded | Deprecated
**Context:** Why this decision was needed. What problem or question triggered it.
**Decision:** What was decided.
**Alternatives Considered:**
- [Alternative A] — Why it was rejected.
- [Alternative B] — Why it was rejected.
**Consequences:** What this decision enables, constrains, or risks.
```

If this file gets corrupted, re-create it. 
CRITICAL: Keep this file under 300 lines. You are allowed to summarize, change the format, delete entries, etc., in order to keep it under the limit.

---

## Decisions

<!-- New entries go here, newest first -->

### [2026-08-31] — Payroll is costed from RECORDED salary payments, the plan is only a fallback

**Status:** Accepted
**Context:** /app/finances and /app/expenses disagreed about the same money.
Financat charged `teamMembers.monthlySalary` into every month (770 000 ALL flat)
while every expense total filtered `category: 'Salary'` rows out — so 2 959 000
ALL of actual salary payments (87% of the tenant's expenses) appeared on NO
Financat line, and the money paid to people who are not team members
(freelancers, models) was invisible everywhere. The 2026 P&L also billed 8
months of payroll to a team whose first member record was created on 19 March,
inventing 1 540 000 ALL for January + February alone. Audited live:
`scripts/audit-expense-totals*.mjs`.

**Decision:** `src/lib/finance/payroll.ts` is the single source. A month with
recorded Salary-category rows is costed from those rows; a month with none falls
back to the profile/`salaryHistory` figure, and the returned `basis` is shown in
the UI. Nobody is charged for a month that ended before `hiredAt ?? startDate ??
createdAt`. Only a `profile`-basis figure may be prorated to elapsed days.

**Alternatives Considered:**
- *Keep the plan as the only basis and hide the rows on both pages* — rejected:
  it deletes real payments from the books, and payments to non-employees can
  never be represented at all.
- *Sum the rows on both pages and drop the plan* — rejected: a month whose
  salaries have not been entered yet would report as free, which is the
  most expensive line silently missing.
- *Read recorded payroll per member* — rejected for allocation: `memberId` is
  unset on most rows (they carry a name in the title), so `departmentPnl` scales
  the plan salaries to the real total instead.

**Consequences:** Financat "Rrogat" + "Shpenzime të tjera" now equals the
Shpenzimet page total for the same month, except in a `profile`-basis month,
which every surface labels. On the audited tenant the 2026 fixed pool dropped
from 6 584 200 to 3 803 200 ALL and 6 of 8 months reconcile exactly. The
remaining 420 000 ALL gap is April, where no salary payment was ever recorded —
a data entry to make, now visible instead of silently absorbed.

