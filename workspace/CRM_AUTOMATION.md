# CRM automation rules (leads + customers)

Rule-based automation for the CRM: **kur** something is true about a lead or a
customer (the trigger), **nëse** its fields pass the conditions, **atëherë** the
platform acts — assigns an owner, creates a task, notifies people, tags the record,
moves the stage, starts the follow-up cadence or emails the contact.

Motivating examples, all shipped as one-click recipes:

> A new lead with no owner is routed round-robin to sales and gets a "contact
> within 24h" task. A proposal with no activity for 5 days puts a follow-up on
> the owner's desk. A new customer gets a welcome email, an "onboarding" tag and a
> kickoff task. An invoice 14 days overdue becomes a collection task for the
> account owner and a heads-up for managers. A customer silent for 45 days is
> flagged "në rrezik".

---

## Where the code lives

| Concern | File |
|---|---|
| Rules engine (pure, tested) | `src/lib/crm/automationRules.ts` |
| Tests (36, incl. the drift guard) | `src/lib/crm/automationRules.test.ts` |
| Server mirror — **byte-identical copy** | `api/_crmAutomationEngine.ts` |
| Cron job (facts + action execution) | `api/_crmAutomationJob.ts` → `runCrmAutomations()` |
| Router | `api/cron/run.ts` — `?job=crm-automations` (`&manual=1&ruleId=…&dryRun=1`) |
| Schedule | `vps/server.ts` — hourly `setInterval`; **not** in `run-all` |
| UI (list, builder, recipes, run history) | `src/views/crm/AutomationRulesPanel.tsx`, mounted in `CRMView` as view toggle **Automatizime** (Admin/Manager/Owner) |
| Collections | `crmAutomationRules` (the rules), `crmAutomationRuns` (one doc per firing) |
| Rules | `firestore.rules` + tests 48a/48b in `scripts/firestore-rules.test.mjs` |
| Index | `crmAutomationRuns (businessId ASC, ruleId ASC, firedAt DESC)` — run history |
| Notification type | `crm_automation` (both registries) |

`api/` never imports from `src/`, so the engine is a **copy**, not an import. Unlike
the older mirrors (waAutomation, recurringBilling) the copy is byte-for-byte: the
test reads both files and fails on any difference. Edit the `src` file, copy it to
`api/`, done — there is nothing to "keep in sync" by hand.

---

## The model

```
AutomationRule {
  entity: 'lead' | 'customer'
  status: 'active' | 'paused'
  trigger: { kind, status?, days?, hours? }
  conditions: [{ field, op, values? | value? }]      // AND
  actions: [assign | create_task | notify | add_tags | set_status | start_cadence | send_email]
  enrollExisting: boolean       // apply to records older than the rule?
  cooldownDays?: number         // recurring triggers only; default = the trigger window
  maxPerRun?: number            // safety valve, default 50
  roundRobinCursor, lastRun*, totalFired, error   // written by the cron
}
```

### Triggers

| kind | entity | fires | fire key |
|---|---|---|---|
| `lead_created` | lead | once per lead | `created` |
| `lead_stage` (status X) | lead | once per lead per stage | `stage:X` |
| `lead_inactive` (N days) | lead | recurring, after the cooldown | `inactive:<day-bucket>` |
| `lead_unassigned` (N hours) | lead | recurring, after the cooldown | `unassigned:<hour-bucket>` |
| `lead_no_response` (N hours) | lead | once (first-response SLA) | `no-response` |
| `customer_created` | customer | once per customer | `created` |
| `customer_inactive` (N days) | customer | recurring, after the cooldown | `inactive:<day-bucket>` |
| `customer_invoice_overdue` (N days) | customer | once **per invoice** | `invoice:<invoiceId>` |

A closed lead (`Won` / `Converted` / `Lost`) never fires a non-stage trigger
(`terminal-status`). `lead_stage` deliberately does — "Lead humbur → win-back pas 60
ditësh" is a recipe.

### Conditions

`status source tags businessCategory estimatedValue score temperature assigned
assignedToUserId daysSinceCreated daysSinceActivity hasEmail hasPhone`, with the
operators each field supports declared in `CONDITION_META`. List matches are
case-insensitive; a record with no activity at all is *infinitely* inactive.

### Actions (executed in order, each recorded on the run doc)

| action | what the cron does |
|---|---|
| `assign` | `assignedToUserId` ← a chosen user or round-robin over `userIds` (default: active Sales/SalesAgent/Manager/Admin with CRM access); `leadActivities` row; `lead_assigned` notification. Later actions see the new owner. |
| `create_task` | `tasks` row like `lead-cadence-steps` (`relatedLeadId` / `customerId`, `automationRuleId`), assignee = owner (fallback: first manager) or a user; `task_assigned` notification. |
| `notify` | `notifyUser()` type `crm_automation` to owner (fallback: managers) / managers / chosen users. Bell + push + email through the shared gates. |
| `add_tags` | `arrayUnion` — never overwrites existing tags. |
| `set_status` | lead only; stamps `lastActivityAt`; `lostReason` when moving to Lost. Refused when it would re-enter the trigger stage (loop). |
| `start_cadence` | lead only: `cadenceActive/cadenceStartedAt/cadenceStep` → the existing `lead-cadence-steps` job takes it from there. |
| `send_email` | tenant mailer (`getTeamConfig` → `sendBulkEmail`), plain text → HTML. Stamps `lastActivityAt` (+ `firstResponseAt` if empty) so the SLA/stale jobs stop chasing the lead. `no email` = recorded, not thrown. |

Text fields accept `{{name}} {{firstName}} {{company}} {{email}} {{phone}} {{status}}
{{value}} {{days}} {{owner}} {{invoice}} {{amount}}`; an unknown token renders empty.

---

## The laws

1. **The engine decides, the cron obeys.** `evaluateRule()` is the only place that
   answers "does this fire". The job fetches facts, calls it, executes actions.
   The builder's preview calls the same function over the same facts, so the
   number the owner sees is the number that fires (minus the run history, which the
   preview deliberately ignores — it answers "who qualifies now").
2. **Every non-firing has a name.** `terminal-status · not-due · predates-rule ·
   already-fired · cooldown · condition-failed · run-cap`, counted per run into
   `lastRunBlocked` and shown as chips on the rule card. Never add a silent
   `continue` to the job loop — add a reason.
3. **The run document is the idempotency guarantee.**
   `crmAutomationRuns/{ruleId}_{entityId}_{fireKey}` is created with `create()`
   BEFORE any action runs. `ALREADY_EXISTS` means another run got there first: skip,
   no second email. Rules make the collection `write: if false` — a client that could
   delete a run would re-arm the occurrence; one that could create would silence it.
4. **The window is the cooldown.** A recurring trigger cannot fire again on the same
   record until `cooldownDays` (default: the trigger's own window) have passed since
   the last firing, and the day/hour bucket in the key keeps two runs inside the same
   window from colliding.
5. **Nothing is retroactive unless asked.** `enrollExisting: false` (the default, and
   what every recipe uses) blocks records created — or, for `lead_stage`, last
   changed — before the rule existed (`predates-rule`). Recurring, SLA and invoice
   triggers describe the present and are never retroactive.
6. **Reads are per tenant, and only for tenants with an active rule.** Leads,
   customers, invoices and projects are read with `businessId ==` (legacy `teamId`
   fallback), only when a rule needs them (`needsInvoices`, `needsCustomerActivity`).
   Suspended tenants are skipped. A manual run is scoped to the caller's `bid`.
7. **A broken rule is paused, not retried forever.** A thrown error pauses the rule
   with `error` set; the card shows it. A failed *action* never fails the run: it is
   recorded as `ok: false` on the run doc.
8. **Only elevated roles author rules** (`isBusinessAdmin` in the rules); every
   member may read them. A rule cannot be moved to another tenant.

---

## Runtime

- **Cadence:** hourly from the VPS. Latency for "event-like" triggers (`lead_created`,
  `lead_stage`) is therefore ≤ 1h — acceptable for routing and tasks; not a real-time
  webhook. If a tenant needs minutes, lower the interval: every firing is idempotent,
  so the cadence is free to change.
- **Manual:** "Ekzekuto tani" on a rule card → `POST /api/cron/run?job=crm-automations&manual=1&ruleId=<id>`
  with the user's ID token. Scoped to the caller's tenant unless super-admin.
- **Dry run:** `&dryRun=1` evaluates and counts without writing anything.
- **Cost:** a tenant with no active rule costs 0 reads. A tenant with lead rules reads
  its leads once per hour; customer rules add customers (+ invoices / projects only
  when a trigger or condition needs them). `crmAutomationRuns` grows by one small doc
  per firing; the per-rule read is `where ruleId ==` — add a retention sweep if a rule
  passes ~10k firings.

---

## Deploy checklist

1. `npm run test` (engine + drift guard + notification registry).
2. `npm run test:rules` in the emulator (JDK 21) — tests 48a/48b cover the two collections.
3. `firebase deploy --only firestore:rules,firestore:indexes`.
4. Deploy the api (Vercel) — `api/_crmAutomationJob.ts` is imported by `cron/run.ts`,
   so no new function (Hobby cap untouched).
5. Restart the VPS process so `startCronSchedulers()` picks up the hourly tick.
6. In the app: CRM → **Automatizime** → **Receta** → pick one → "Ruaj dhe aktivizo".

---

## Limitations / next steps

- Triggers are **state-based and polled**, not event-based. "Lead-i hyn në fazën X"
  means "is in stage X and has not fired for X under this rule" — re-entering the
  same stage later does not re-fire.
- Customer "activity" is derived from the customer doc, its invoices and projects —
  chat and tasks are not consulted (would need per-tenant reads of `messages`).
- `send_email` is plain text → HTML. No template picker yet (`emailTemplates` could
  be wired in the same way `email-campaigns` does it).
- No WhatsApp action: Baileys/Meta sending lives in the WA campaign engine with its
  own consent and template rules; reuse `sendWaCampaignBatch` if it is ever added.
- No per-rule analytics beyond counts (fired / blocked). Conversion attribution
  ("leads touched by rule R that became customers") is a natural follow-up.
