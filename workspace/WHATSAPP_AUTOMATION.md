# WhatsApp campaign automation (Baileys + Meta)

Rule-based WhatsApp campaigns: **conditions** decide who gets messaged,
**variants** decide what each person reads, and an **evergreen trigger** keeps the
rule working every day instead of once.

The motivating example, now expressible in the UI:

> Leads we haven't contacted in 30 days, tagged with a service (SEO / Ads / …),
> get a message written for that service that quotes the note we left on the
> lead, plus a link to the matching landing page.

---

## Where the code lives

| Concern | File |
|---|---|
| Rules engine (pure, tested) | `src/lib/marketing/waAutomation.ts` |
| Tests | `src/lib/marketing/waAutomation.test.ts` |
| Server mirror + senders | `api/cron/run.ts` (`waBlockReason`, `resolveWaCampaignTargets`, `sendWaCampaignBatch`) |
| UI (builder + rule list) | `src/components/WhatsappBroadcasts.tsx` (mounted in `MarketingView`) |
| Document shape | `WhatsAppBroadcast` / `WhatsAppMessageVariant` in `src/types/index.ts` |
| Collection | `waBroadcasts` (unchanged — the new fields are additive) |

`api/` never imports from `src/` in this repo, so the engine is **mirrored** in
the cron. The module carries the reasoning and the tests; keep the two in sync —
if they disagree, the count the user approved is not the count that goes out.

---

## The two triggers

| | `trigger: 'manual'` (default) | `trigger: 'dormant'` |
|---|---|---|
| Lifecycle | `draft → queued → sending → completed` | `active ⇄ paused` (never completes) |
| Cron job | `whatsapp-broadcasts` (in `run-all`) | `whatsapp-automations` (**not** in `run-all`) |
| Idempotency | `sentPhones[]` — a permanent exclusion list | the dormancy window itself (see below) |
| Segment | resolved once, resumed across runs | **re-resolved every run** |

A manual campaign is the old behaviour, untouched. An evergreen rule is the new
one, and it is deliberately not part of `run-all`: an always-on sender must be
scheduled once a day, not several times an hour.

### LAW: the dormancy window IS the cooldown

An evergreen rule keeps **no per-person enrollment record** (unlike email's
`campaignEnrollments`). It doesn't need one: sending a message updates the
contact's last-contact date, so a `lastContactMinDays: 30` rule cannot pick the
same person up again for 30 days. They re-enter only if they go quiet again —
which is exactly what a re-engagement rule should do.

Do **not** "optimize" this into a permanent sent-list. That would turn a
recurring rule into a once-per-contact-ever blast, silently, months later.

---

## Conditions (`broadcast.conditions`)

| Field | Meaning |
|---|---|
| `lastContactMinDays` | ≥ N days since the last contact — the dormancy gate. Required for an evergreen rule. |
| `lastContactMaxDays` | …and ≤ M days. Skips ancient, dead contacts. |
| `requireContacted` | Exclude contacts nobody ever touched. |
| `requireNotes` | Only contacts with notes, so `{{notes}}` never renders empty. |
| `dailyCap` | Max sends per run. Required for an evergreen rule. |

These stack on top of the existing segment filters (audience, lead status, tags
ANY/ALL, business category, assignee, source, hasDomain).

### Business category (`segment.categories`)

The CRM's `Lead.businessCategory` ("Makina me qera", "Hoteleri & Turizëm", …),
matched **ANY of the selected**, case-insensitively. The picker in the builder is
the union of `teamSettings.leadCategories` (what the lead form has persisted) and
every category already present on a lead/customer, so a category typed once is
filterable immediately and an old one never disappears.

Two rules that are easy to get wrong:

- **A contact with no category is excluded.** The filter is a statement about
  what the business *is*; "unknown" must not pass as a match.
- **A customer inherits the category of the lead it was converted from.**
  `Customer` has no category field, so `buildCategoryIndex()` maps
  `lead.id` / `lead.customerId` / `customer.leadId` → category, and
  `waSendBlockReason` falls back to it (`ctx.categoryByContactId`). Without it,
  the filter silently dropped every existing client. The index is built ONLY when
  the filter is on — and that is also why the cron loads leads for a
  customers-only audience in that case.

### What counts as "contact"

`resolveLastContactAt()` takes the newest of: the latest **WhatsApp message** for
that phone, `lastActivityAt`, `lastFollowUpDate`, `firstResponseAt`.

**`createdAt` is deliberately NOT a contact.** An imported lead nobody ever
touched must read as *never contacted*, not *contacted on import day*. A
never-contacted contact is treated as maximally dormant (so `lastContactMinDays`
passes) unless `requireContacted` or a `lastContactMaxDays` ceiling is set — a
ceiling is a statement about a real past contact, so "never" can't satisfy it.

### Why the dormancy query is cheap

The cron does **not** read every message ever sent. `recentWaContactsByPhone()`
queries only *inside* the window:

```
whatsappMessages where teamId == … and createdAt >= (now − minDays) order by createdAt desc
```

Anyone absent from the result has not been contacted in the window. That's the
inverse of the question, and it uses the existing `(teamId, createdAt DESC)`
index — no new index needed. Capped at 5 000 docs; on truncation it logs a
warning, because a truncated exclusion set can only ever **under-exclude** (a few
people messaged sooner than intended), never leak.

The lookup is skipped entirely when no dormancy condition is set.

---

## Variants — one rule, per-service text

`broadcast.variants[]` replaces "one body for the whole segment":

```ts
{ id, label?, tags: string[], body, landingUrl? }
```

The variant is chosen by the **contact's own tags**, most specific match first
(most matched tags wins, not declaration order). A variant with `tags: []` is the
fallback. If a campaign has variants and none matches a contact, that contact is
blocked with `no-variant` rather than receiving empty text.

### Tokens

`{{name}}` (first name), `{{fullname}}`, `{{company}}`, `{{notes}}`,
`{{service}}` (the matched tag), `{{link}}` (the UTM-tagged landing page).

- An **unknown token renders empty** — a customer must never receive `{{foo}}`.
- If the body has no `{{link}}` but a link exists, it is **appended** on its own
  line. Forgetting the token shouldn't silently drop the link.
- `{{notes}}` is `summarizeNotes()`: the first meaningful line of the internal
  notes, stripped of bullet/date noise and capped at 160 chars on a word
  boundary. Notes are a scratchpad; the message wants a one-clause callback
  ("…për faqen e-commerce që diskutuam"), not a paste of the CRM.

### Channel limits — read this before blaming the cron

**Meta only delivers approved templates** outside the 24h window, so free-text
variants are a **Baileys** capability. The UI says so and validation refuses a
Meta campaign without a `templateId`.

Meta campaigns still get the personalization, through the template's own
placeholders: `waTemplates.paramFields` now understands the pseudo-fields
`firstName`, `notes`, `service` and `link` alongside real contact fields. So an
approved `"Përshëndetje {{1}}, për {{2}} shiko {{3}}"` carries the whole idea.

### Links & attribution

`landingUrl` per variant (falling back to the campaign's `landingUrl`), passed
through `withUtm()` → `utm_source=whatsapp`, `utm_medium=crm`,
`utm_campaign=<campaign name or override>`. A UTM the user already put in the URL
is never overwritten, and a non-URL is returned untouched rather than throwing.

---

## Diagnostics: nobody vanishes

`waSendBlockReason()` returns a **named reason** instead of a silent `continue`,
and both the preview and the cron aggregate them:

`no-phone`, `status-mismatch`, `tag-mismatch`, `category-mismatch`, `assignee-mismatch`,
`source-mismatch`, `domain-mismatch`, `never-contacted`,
`contacted-too-recently`, `contact-too-old`, `no-notes`, `no-variant`,
`already-sent`.

The builder shows them as chips ("900 kontaktuar së fundmi") and the last run's
counts are persisted to `broadcast.lastRunBlocked` + `lastRunAt`. This is the
difference between "340 targets" and understanding *why* it isn't 1 240.

**Known preview gap:** the browser has only the CRM's activity dates, not the
WhatsApp message history (that's a server-side bounded query). So a dormancy
preview can read slightly **high**. The UI states this under the count.

---

## Relationship to the older `WhatsappAutomation` panel

`src/components/WhatsappAutomation.tsx` (Cilësimet → Automatizime WhatsApp) is a
**different, still-live feature**: team-wide switches stored on `teamSettings` —
out-of-hours auto-reply, follow-up-on-due-date, the stale-lead reminder
(`waAutoReminder*`, job `lead-wa-auto-reminders`) and overdue-invoice escalation.

| | Old stale-lead reminder | New `dormant` campaigns |
|---|---|---|
| How many rules | ONE per team | as many as you like, each named |
| Who | lead statuses + days quiet | + tags, assignee, source, notes, customers |
| Text | one template for everyone | per-service variant + landing page |
| Channel | Meta only | Meta or Baileys |
| Config | `teamSettings` | `waBroadcasts` docs |

They coexist. The new rules are the multi-rule, per-service generalization; the
old one remains the simple team-wide default.

### How they avoid double-messaging the same lead

The old job decides from `lead.lastActivityAt` / `lastFollowUpDate` **only** — it
never reads `whatsappMessages`. So after a campaign send, the cron calls
`stampWaCampaignTouch()`, which writes `lastActivityAt`, `lastFollowUpDate` and
`waAutoReminderAt` on the lead and adds a `leadActivities` entry. That makes the
suppression mutual: the old job already stamps the same fields, and now so does
this one. Without the stamp, a lead could get a campaign message and then the
stale reminder days later, each job believing the lead had gone quiet.

The stamp also puts the outreach on the CRM timeline — a message the user can't
see in the lead's history looks like it never happened.

**One deliberate difference:** the old job falls back to `createdAt` when a lead
has no activity, so an untouched lead becomes "quiet" N days after creation. The
new engine does not (see *What counts as "contact"*) — an untouched lead reads as
*never contacted*, which passes a min-days gate but is excluded by
`requireContacted` or a `lastContactMaxDays` ceiling. Turn on `requireContacted`
if you want the older behaviour's exclusion instead.

Customers are not stamped — `customers` has no activity field. Their dormancy
comes from the WhatsApp message history alone.

## Scheduling — the VPS, never Vercel

**Nothing to add in Vercel.** Job *logic* lives on Vercel (`api/cron/run.ts`,
guarded by `CRON_SECRET`), but the *schedule* was moved off it in June 2026
because Vercel Hobby caps crons at 2/day — `vercel.json` has no `crons` block at
all. The VPS calls `POST {CRM_BASE_URL}/api/cron/run?job=…` from
`startCronSchedulers()` in `vps/server.ts`. Adding a Vercel cron would either be
refused by the plan or double-fire the job.

Already wired, once a day at **10:00 local**:

```ts
scheduleDailyInZone(CRON_LOCAL_TZ, 10, 0, () => { void triggerCronJob('whatsapp-automations'); });
```

`scheduleDailyInZone`, never `scheduleDailyUtc`: a re-engagement message must land
during working hours when a reply can be answered, and Albania shifts an hour
twice a year — a UTC-pinned send drifts into the wrong hour all winter.

It is deliberately **not** in `run-all`. This job messages real people unprompted,
so it fires on an hour someone chose rather than piggybacking on whatever else
`run-all` happens to do.

Deploying the schedule change (see `vps-cron-setup`): the VPS runs `server.ts`
directly under ts-node, so it is `git pull` + `pm2 restart` at `/root/fivocrm/vps`
— **no** `npm run build`.

Manual trigger (admin): `POST /api/cron/run?job=whatsapp-automations&manual=1`.

---

## Failure behaviour

- A broken evergreen rule is **paused**, not left retrying every run — it would
  otherwise log the same failure forever with nobody looking. The reason lands in
  `broadcast.error` and is shown in the rule list.
- A rule with no `lastContactMinDays` is paused on sight: without a dormancy
  threshold it would message the whole segment on every run.
- Baileys pacing is unchanged: 8 per run, 1.5–4 s randomized gaps. `dailyCap`
  lowers that further but never raises it. The ban warning still stands — mass
  sending from a personal number can get the number blocked.

---

## Extending it

- **A new condition?** → add it to `WaConditions`, gate it in
  `waSendBlockReason()`, mirror it in `waBlockReason()` in the cron, add a label
  to `WA_BLOCK_LABELS`, and add a test. The gate is the only place conditions are
  evaluated — do not add a filter inline in the cron loop.
- **A new token?** → `renderWaMessage()` in both copies. Unknown tokens render
  empty, so an un-mirrored token silently disappears from messages instead of
  erroring; the tests are what catch it.
- **A new trigger** (e.g. "abandoned quote")? → follow `dormant`: a `trigger`
  value, a job, and its own idempotency reasoning. State explicitly what stops it
  from re-sending, the way the dormancy window does here.
