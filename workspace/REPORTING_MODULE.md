# Enterprise Reporting & Accountability — architecture + runbook

Module id `reporting` · routes `/app/reports*` · portal `/portal/reports` ·
plan gate `pro` · permission gate `canAccessReports`

---

## 1. What was built, and what was deliberately reused

The agency needs two different things from "reporting", and they have different
shapes, so they are two stores rather than one:

| | `dailyReports` (pre-existing, EXTENDED) | `reports` (new) |
|---|---|---|
| Grain | one doc per user per day | one rich document per period/subject |
| Shape | flat fields + department-specific `customFields` | ordered, visibility-scoped `blocks[]` |
| Audience | internal | internal AND client-facing in the same doc |
| Workflow | submit | 14-status lifecycle, approvals, versions, publish |
| Feeds | StaffDashboard, DailyReportPopup, Momentum | weekly/monthly/quarterly aggregation |

**Nothing was rebuilt.** `dailyReports` gained optional accountability fields
(`DailyReportAccountability` in `src/types/reporting.ts`) — structured status,
billable split, dependencies, submission timing, manager review, blocker lifecycle.
Every field is optional, so legacy documents and every existing reader stay valid.
Task completion reads `status === 'Done'` + `updatedAt`, and time is measured with
`entryDurationMinutes()`, i.e. the same conventions the Momentum engine already
uses — so the two features can never disagree about "completed this week".

---

## 2. Data model (Firestore)

Firestore is document-oriented, so a report's blocks live INSIDE the report:
one read renders a whole report, no N+1. Everything that must be immutable or
append-only lives in its own collection.

```
reports                 the report document (blocks[], kpiValues[], workflow, health)
  ├── reportVersions    immutable snapshots (submitted / published)         APPEND-ONLY
  ├── reportApprovals   sign-off records, version-pinned, IP + user agent   APPEND-ONLY
  ├── reportEvents      audit trail + status history + views + deliveries   APPEND-ONLY
  └── reportComments    threaded, `internal: boolean` is the leak boundary

reportTemplates         15 seeded system templates + tenant copies (versioned)
reportSchedules         automation (cadence, people, reminders, escalation ladder)
reportKpis              ~110-KPI catalog + scoped targets
reportMetrics           actual values per subject+period, independent of any report
clientHealthScores      monthly snapshot per customer, with factor breakdown
employeeReportScores    monthly accountability rollup per user (CONFIDENTIAL)
```

### Why one event stream instead of five tables

The spec models status history, audit log, views and deliveries as separate tables.
On Firestore a single discriminated stream (`reportEvents.kind`) is the safer choice:
one composite index serves the whole timeline, "who did what when" is one query, and
there is no way to end up with a partial audit trail because a writer forgot one of
five collections.

### Key relationships

- `reports.businessId` is the tenant key; `teamId` is the owning department.
- `reports.customerId` / `projectId` link to `customers` / `projects`.
- `reports.templateKey` + `templateVersion` are **stamped on the report**, so editing
  a template later cannot rewrite a report already generated from it (rule 11/15).
- `reportComments.customerId` and `reportVersions.customerId` are denormalised so the
  Firestore rules can authorise a portal read in ONE clause (rules cannot follow refs).
- `reports.generationKey = scheduleId:periodKey[:subjectId]` is the idempotency key.

---

## 3. The security model

### The single authority

**No client-facing output is ever built from a raw `Report`.** The portal, the PDF
renderer and the email sender all pass through `redactForClient()`
(`src/lib/reporting/visibility.ts`), and only render what comes back.

- `CLIENT_VISIBILITIES` is a **closed allow-list** (`client`, `client_contacts`). A
  visibility value not in it is internal by construction, so adding an internal level
  later can never accidentally become client-visible.
- Redaction is subtractive on a copy and drops blocks, KPI values AND attachments in
  one pass — there is no second place to forget.
- `assertNoClientLeak()` runs on the PDF path and `findClientLeaks()` guards the
  portal render, so a bug fails closed instead of leaking.
- A new block defaults to `internal`, never `client`.
- `custom-html` is admin-only and stripped from every client payload; for staff it is
  displayed as **text**, never executed (no stored-XSS surface).
- Report narrative is rendered as plain paragraphs, never HTML.

### Three independent layers

| Layer | Mechanism |
|---|---|
| Query | portal asks `businessId == mine && customerId == mine`, filters published + client-facing |
| Rules | `firestore.rules` enforces exactly that per-document; drafts, internal kinds and other tenants are denied |
| Render | `redactForClient()` output only |

### What the rules enforce

- A client reads only their own **published**, **client-facing**, **non-deleted** report.
- A client **never** writes `reports`, `reportEvents` or `reportApprovals`. Their two
  legitimate actions (decide, comment) go through `POST /api/reports`, which re-checks
  ownership, publication state and the transition server-side.
- `reportComments.internal` is **immutable on update** — a private note cannot be
  flipped into the client's view after the fact.
- Versions, approvals and events are append-only for everyone, super-admin included.
- `reports` has no client delete path at all: the module soft-deletes (`deletedAt`),
  and a client-approved report carries `legalHold: true` (rule 8).
- `employeeReportScores` is confidential employee information: tenant-scoped, and a
  client can never reach it.

### Test coverage

- **319 unit tests** across 10 pure-logic modules (`npm run test`).
- **40 rules tests** in the emulator (`scripts/firestore-rules.reporting.test.mjs`),
  covering cross-tenant reads, the client boundary, forged internal comments,
  append-only violations and the suspended-tenant case.
- The pre-existing 53-test rules suite still passes → **93 rules tests green**.

---

## 4. Permissions

`canAccessReports` (which already existed as a declared-but-unrouted flag) is the
module gate, and it is **true for every internal role** — everyone files their own
daily/weekly report. What escalates by role are six capability flags:

| Flag | Owner/Admin | Manager | Sales | SalesAgent | Member | Viewer | Guest |
|---|---|---|---|---|---|---|---|
| `canAccessReports` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| `canReviewReports` | ✔ | ✔ | — | — | — | — | — |
| `canApproveReports` | ✔ | ✔ | — | — | — | — | — |
| `canPublishReports` | ✔ | ✔ | ✔ | — | — | — | — |
| `canViewAllReports` | ✔ | ✔ | — | — | — | — | — |
| `canViewConfidentialReports` | ✔ | ✔ | — | — | — | — | — |
| `canManageReportTemplates` | ✔ | ✔ | — | — | — | — | — |
| `canViewFinancialMetrics` | ✔ | — | — | — | — | — | — |

Defaults live in ONE place (`src/lib/reporting/permissions.ts`) and are spread into
every role branch, so `usePermissions`, `simulateRole` and the Cilësimet role
templates cannot drift. Per-member overrides on the `teamMembers` record win.

The spec's longer permission list (edit own draft, submit own, view department…) is
**capability × relationship**, not 25 independent switches: `reportActor()` and
`reportAudience()` combine the flags with the user's relationship to the specific
report, and hand the result to `canTransition()` / `redactForAudience()`.

---

## 5. Files

### New — pure logic (`src/lib/reporting/`, all unit-tested)
| File | Responsibility |
|---|---|
| `period.ts` | canonical period keys, ISO weeks, comparisons, working days, due dates |
| `visibility.ts` | **the leak boundary**: audiences, redaction, leak assertions |
| `workflow.ts` | 14-status machine, every §38 business rule, transition patches |
| `blocks.ts` | block registry (29 types), reorder/remove, validation, URL allow-list |
| `templates.ts` | 15 seeded templates, instantiation with version stamping |
| `kpi.ts` | ~110-KPI catalog, deterministic formatting, direction-aware deltas, RAG, targets |
| `health.ts` | project RAG suggestion + client health with explained factors |
| `accountability.ts` | ~20 employee metrics, trends, attention flags, optional composite |
| `quality.ts` | advisory report-quality checker |
| `schedule.ts` | idempotent generation, reminders, escalation ladders, DST-correct slots |
| `permissions.ts` | role capabilities → per-report authority |
| `pdf.ts` | branded A4 PDF, paginating tables, redaction assertion |

### New — UI
`src/components/reporting/ReportBlockRenderer.tsx` (shared staff+portal+print),
`ReportBuilder.tsx` (dnd-kit + visibility control), `ReportDiscussion.tsx`
(comments + audit timeline);
`src/views/ReportsView.tsx`, `ReportDetailView.tsx`, `ReportingAdminView.tsx`,
`AccountabilityView.tsx`, `ClientHealthView.tsx`,
`src/views/portal/PortalReportsView.tsx`;
`src/hooks/useReports.ts` (the single write path).

### New — server
`api/_reports.ts` (client actions + email delivery),
`api/_reportJobs.ts` (three idempotent cron jobs).

### Modified
`src/types/index.ts` (+`reporting.ts` re-export, `DailyReport` extended),
`src/hooks/useFirestore.ts` (11 collections registered in both isolation sets),
`src/hooks/usePermissions.ts`, `src/contexts/PermissionsContext.tsx`,
`src/views/SettingsView.tsx` (role templates), `src/lib/modules.ts`,
`src/App.tsx` (7 staff + 1 portal route), `src/components/Sidebar.tsx`,
`src/views/portal/PortalLayout.tsx`, `firestore.rules` (11 collections),
`firestore.indexes.json` (+36 indexes), `api/email.ts`, `api/cron/run.ts`,
`vercel.json`.

---

## 6. Installation

There are **no SQL migrations** — Firestore is schemaless and every added field is
optional, so existing documents stay valid. The steps are:

```bash
# 1. Deploy the rules. RUN THE TESTS FIRST — never deploy rules blind.
firebase emulators:exec --only firestore "node --test scripts/*.test.mjs"
firebase deploy --only firestore:rules

# 2. Deploy the 36 new composite indexes BEFORE the app that queries them,
#    or the narrowed queries fail with FAILED_PRECONDITION.
firebase deploy --only firestore:indexes
#    Wait until every index reads "Enabled" in the console (a few minutes).

# 3. Ship the app.
npm run build && git push       # Vercel deploys

# 4. Per tenant, ONCE: Raportimi → Konfigurimi → "Instalo konfigurimin bazë".
#    Writes the 15 system templates + ~110 KPIs. Idempotent — safe to re-press;
#    it only fills gaps and never overwrites a customised template.
```

**Emulator note:** `firebase-tools` ≥ 14 requires JDK 21. This machine has JDK 17,
so the suites above were verified with `npx firebase-tools@13.35.1`, which accepts
Java 17. Either install JDK 21 or pin the CLI version in CI.

### Cron

There is no system `crontab`. Scheduling lives in `vps/server.ts`
(`startCronSchedulers`), which triggers the Vercel function
`/api/cron/run?job=…` with `CRON_SECRET`. The three reporting jobs are already
registered there:

| Job | Cadence | Why that cadence |
|---|---|---|
| `report-schedules` | every 60 min | a schedule carries a per-tenant LOCAL hour and fires once that hour passes; a daily tick would collapse every tenant's chosen hour into `CRON_DAILY_HOUR`. Reads only active schedules, so it is cheap. |
| `report-reminders` | every 120 min | range query on `status` + `dueAt` (indexed), not a scan |
| `client-health-rollup` | monthly, 1st at 04:00 UTC | previous month's numbers are complete |

`report-schedules` and `report-reminders` also run inside `?job=run-all` (the daily
08:00 UTC tick), so generation still happens even if the intervals are disabled.

All three are **idempotent**: generation is keyed on
`generationKey = scheduleId:periodKey[:subjectId]`, reminder/escalation rungs record
themselves on the report, and the health rollup uses a deterministic document id.

To deploy the schedule change on the VPS:

```bash
cd /root/fivocrm && git pull
pm2 list                 # find the process name
pm2 restart <name> --update-env
pm2 logs <name> --lines 50 | grep CRON
```

`CRM_BASE_URL` and `CRON_SECRET` must be present in the PM2 env
(`ecosystem.config.cjs`), otherwise `startCronSchedulers` logs a warning and does
nothing.

### Configuration variables

No new required variables. Optional/reused:

| Variable | Used for | Consequence if unset |
|---|---|---|
| `SMTP_HOST/PORT/USER/PASS` | emailing reports (existing vars) | send-email returns 503; portal still works |
| `PUBLIC_APP_URL` | portal link inside the email | falls back to `https://fivocrm.vercel.app` |
| `CRON_SECRET` | cron auth (existing) | cron rejects the call |

---

## 7. Testing

```bash
npm run test        # 565 tests, 31 files (319 of them this module's)
npm run lint        # 0 errors introduced by this module
npm run build       # production build

# Firestore rules (emulator; JDK 17 → pin the CLI as shown above)
npx firebase-tools@13.35.1 emulators:exec --only firestore \
  --project fivocrm-reporting-rules-test \
  "node --test scripts/firestore-rules.reporting.test.mjs"
```

The suites that matter most, and what they prove:

- `visibility.test.ts` — every internal visibility level is hidden from a client;
  attachments, KPI values, unapproved AI content and `custom-html` are all stripped;
  redaction does not mutate its input.
- `workflow.test.ts` — publish requires internal approval; the author cannot approve
  their own report; staff cannot fake a client approval; reopening a published report
  bumps the version and forces re-approval; client sign-off pins the exact version.
- `schedule.test.ts` — the idempotency key is stable; a missed cron slot catches up
  without duplicating; reminders never burst; escalation jumps to the highest rung.
- `firestore-rules.reporting.test.mjs` — the same guarantees, enforced server-side.

---

## 8. Known limitations

Stated plainly, with the cost of closing each:

1. **Task reopen count is always 0.** `tasks` persists no status history, so
   `reopenedTasks` reads an optional `reopenCount` that nothing writes yet. One-line
   fix in the task status-change path; deliberately not done here to avoid touching
   the tasks module.
2. **Charts in the PDF render as KPI cards.** Rasterising a Recharts SVG needs a
   canvas pass; the PDF states the same numbers instead of shipping an empty frame.
   The portal shows the interactive chart.
3. **Data integrations are not implemented.** KPI values are entered manually (or by
   the existing `socialSnapshots` sync). The architecture is ready — `reportMetrics`
   is provider-agnostic with an `origins` map and `syncedAt` — but no GA4 / GSC /
   Google Ads / Meta adapters ship in this change.
4. **Email carries a summary + portal link, not the PDF.** This is a design choice,
   not an omission: it makes "no internal data in email" true by construction rather
   than by careful template authoring. Attaching the redacted PDF server-side needs
   the PDF built in Node (jsPDF works there; wiring is ~40 lines).
5. **No signed expiring links for unauthenticated recipients.** Clients read reports
   authenticated in the portal. A public share link would need a token collection and
   its own rule — deliberately out of scope until asked for.
6. **AI assistance is prepared, not implemented.** `ReportBlock.aiSuggested` /
   `aiApprovedByUserId` exist, publishing is blocked while unapproved AI content
   remains, and the UI flags it — but nothing generates suggestions yet.
7. **Bulk operations are partial.** Filtering, search and per-report actions ship;
   multi-select bulk assign/reschedule/publish does not.
8. **`reportMetrics` is written by nothing yet.** KPI values are snapshotted onto
   reports directly. The collection, rules and indexes exist for the integration
   layer to populate.
9. **The calendar is read-only.** Drag-to-reschedule is intentionally absent: a
   schedule change must be audited, so it happens in the schedule manager.

## 9. Recommended next steps, in value order

1. **GA4 + Search Console adapters** writing into `reportMetrics`, with a
   `report-metrics-sync` cron job. This is what turns monthly reports from a typing
   exercise into an automated deliverable, and everything downstream already reads
   from that collection.
2. **Server-side PDF + attachment**, so the emailed report is self-contained.
3. **Prefill from CRM on generation** — the schedule already carries
   `prefillFromCrm`, and the `auto:*` block sources are declared; the generator
   currently copies the template without filling task/milestone/time data.
4. **Task reopen tracking** (limitation 1) to complete the accountability picture.
5. **AI executive-summary drafting**, using the existing approval gate.
6. **Bulk operations** over the filtered list.
