<instructions>
## 🚨 MANDATORY: CHANGELOG TRACKING 🚨

You MUST maintain this file to track your work across messages. This is NON-NEGOTIABLE.

---

## INSTRUCTIONS

- **MAX 5 lines** per entry - be concise but informative
- **Include file paths** of key files modified or discovered
- **Note patterns/conventions** found in the codebase
- **Sort entries by date** in DESCENDING order (most recent first)
- If this file gets corrupted, messy, or unsorted -> re-create it. 
- CRITICAL: Updating this file at the END of EVERY response is MANDATORY.
- CRITICAL: Keep this file under 300 lines. You are allowed to summarize, change the format, delete entries, etc., in order to keep it under the limit.

</instructions>

<changelog>
<!-- NEXT_ENTRY_HERE -->
### [2026-09-18] — Auditi i thellë Android/UI/UX: 10 bugs (raundi 2)
- Temë: `saveOrShareFile()`/`openExternal()` ekzistojnë pikërisht sepse `<a download>` dhe `window.open` janë no-op në WebView, por 7 thirrje i anashkalonin — eksportet CSV (CustomersView/ExpensesView/FinancesView) + eksporti GDPR (TenantDetailView), dhe "Hyr në cPanel" (HostingView + PortalHostingView) + raporti GMB. Secila ishte një buton që në Android **nuk bënte asgjë**: pa file, pa gabim, pa toast. `installExternalLinkHandler` s'i kapte — ai dëgjon klikime mbi `<a>`, jo `window.open`
- `PortalLayout` u soll në modelin e `App.tsx`: kolonë `h-[100dvh] flex flex-col` me navin si fëmijë NË RRJEDHË, jo `position: fixed` — modeli që stafi e braktisi sepse mospërputhja layout-vs-visual viewport e Android WebView e shtyn një shirit fiks jashtë ekranit në chat. Ana anësore ndalon mbi navin (e njëjta gjë si Sidebar në raundin 1). `PortalChatView` hoqi `h-[calc(100dvh-140px)]` → `flex-1 min-h-0`: kroma reale është 160px pa insete dhe 220px me notch, pra composer-i dilte 20–80px jashtë; `WhatsappInboxView` e njëjta familje
- I ri `src/lib/clipboard.ts` (`copyText`/`copyWithToast`, me fallback `execCommand`): 5 nga 9 thirrjet e clipboard-it nuk e prisnin Promise-in dhe shfaqnin "U kopjua" në rreshtin tjetër — përdoruesi lexonte se linku ishte kopjuar, ngjiste, dhe s'kishte gjë. Thirrësit: ChatView ×2, LandingPagesView, SettingsView
- I ri `src/components/EmailHtmlPreview.tsx` (`<iframe sandbox="" srcDoc>`): EmailCampaigns ×2 + EmailTemplateManager renderonin `dangerouslySetInnerHTML` të pasanitizuar (3 nga 11 vende; 8 të tjerat kalojnë nga DOMPurify/sanitizeHtml). `emailTemplates` shkruhet nga `canCreateBusinessDoc()` = çdo anëtar, pra një Member ruante `<script>` dhe Admini e ekzekutonte duke e hapur. Sandbox e jo sanitizues, që email-i të duket siç dërgohet
- Kontrolluar e gjetur e shëndetshme: cache-i i listener-ave (`teamScopedWhere` ËSHTË në çelës si `tsw`; Sidebar+MobileBottomNav e ndajnë listener-in, s'e dublojnë); asnjë `catch {}` bosh; `useFileUpload` me URL absolute. **Korrigjim:** `PriceSummary.handlePrint` u raportua gabimisht si bug — dega native me PDF+share ekziston që më parë. Verifikim: build ✅, 1463/1463 teste ✅


### [2026-09-18] — Audit financash: ~60 gjetje, P0/P1-të e rregulluara (workspace/FINANCE_BUGS_2026_09_18.md)
- P0 skopimi: `invoice-reminders` / `overdue-reminders` / `recurring-expenses` nuk merrnin `businessId` në nisje manuale, ndërsa `authorizeManual` pranon çdo Admin të çdo ekipi — një klikim te Cilësimet u dërgonte email e WhatsApp klientëve të ÇDO qiraxhiu. Tani `manualScopeId()` në `api/cron/run.ts` + përjashtimi i të pezulluarve; `run-all` manual u kufizua te super-admini (ishte vrima që i anashkalonte të gjitha)
- P0 zona kohore: çelësat e periudhave llogariteshin me getters të makinës — UI në Europe/Tirane, trupi i cron-it në Vercel/UTC — pra një faturë e datës 1 keyed `2026-08` në shfletues dhe `2026-07` në server: seria ose bllokohej përgjithmonë (`already-generated`) ose e dyfishonte muajin. Ndihmësit `zonedParts/zonedDate/addZonedMonthsClamped/startOfZonedWeek` në `src/lib/recurringUtils.ts`, të pasqyruar fjalë për fjalë në `api/cron/run.ts`; `recurringBilling/recurringInvoices/recurringExpenses` kaluan te ta + teste që kalojnë nën TZ=UTC dhe Europe/Tirane
- P0 portali: klienti mund të rishkruante çmimin e ofertës së vet dhe të lexonte draftet, dhe porositë e dyqanit vinin me `total`+`paymentStatus` nga shfletuesi. Tani `quotePortalResponse()`/`quoteVisibleToClient()` në `firestore.rules` (+`src/lib/quoteVisibility.ts` si burim i vetëm i statuseve), rillogaritje nga katalogu te `ShopOrdersView.convertToInvoice`, fatura Paguar vetëm me konfirmim stafi
- P1: `/app/bonus` e hapur për çdo rol dhe shkarkonte çdo rrogë (tani `ModuleGate` + `canAccessExpenses`); `status !== 'Active'` i zeronte rrogat edhe në muajt e shkuar (tani `leftAt`); parashikimi/MRR nuk pyeste `isRecurring` dhe s'normalizonte frekuencën javore; projectPnl/departmentPnl numëronin retainerë të anuluar; `paidAt` humbte kur fatura krijohej e paguar; datat humbnin një ditë në ruajtje; email-i i vonesës kërkonte totalin bruto dhe thoshte "skadon sot"; `payments`/`expenseCategories` mungonin te listat e skopit (query e mohuar)
- Verifikim mbi 01f9e12: 1449/1449 teste ✅, 123/123 teste rregullash në emulator ✅, build ✅, typecheck:api i pastër, typecheck 214→199. **Mbetet i hapur**: zhvendosja e fushave të pagës jashtë `teamMembers` (rregullat ende ia japin leximin çdo anëtari) — kërkon migrim me backfill; plus deploy i rules/indexes


### [2026-09-18] — Audit Android/UI/UX: 11 bugs të rregulluara (workspace/ANDROID_UI_AUDIT_2026_09.md)
- P0 `src/index.css`: `@media (pointer: coarse)` vendoste `min-width/height: 44px` mbi çdo `<button>` — Radix i jep Switch/Checkbox/Radio si button, pra çdo checkbox bëhej katror 44×44 dhe track-u i switch-it 44×44 me `translate-x-4` që s'shkonte askund (**on/off dukeshin njësoj në Android**); rolet dalin jashtë rregullit. Rregulli `font-size:16px` humbte ndaj çdo klase `text-sm`, pra s'mbronte nga zoom-i i iOS — u zhvendos te `html.plt-ios` (flamur i ri në `src/index.tsx`), Android/desktop pa ndryshim
- P0 `AndroidBackButton.tsx` rishkruar: varej nga `location.pathname` + regjistrim async me cleanup sinkron → dëgjues jetimë, një Back kërcente 2-3 ekrane. Tani regjistrim një herë me `ref` + flamur `cancelled`; `registerBackDismiss()` (i lidhur në `App.tsx` dhe `MobileBottomNav.tsx`) e bën Back të mbyllë së pari overlay-t; pa histori shkon në dashboard, nuk mbyll aplikacionin
- P1: `Sidebar.tsx` lartësia zbret edhe bottom nav-in nën `lg` (footer-i Profili/Cilësimet ishte plotësisht i mbuluar); `ui/toast.tsx` `top-[76px]` → `calc(76px + var(--safe-area-top))` (toast-i dilte nën header në pajisje me notch); kanal FCM `fivocrm_default` në `android-configure.cjs` + `usePushNotifications.ts` (pa të, OEM-të e vinin në importance të ulët → push pa zë e pa banner); `AuthContext.isSignInCancellation()` (anulimi i Google në Android nxirrte gabim të kuq)
- P2: `gap-2` te Dialog/AlertDialog footer (butonat ngjiteshin në telefon); X-i i dialogut në shirit `sticky` (rrëshqiste jashtë në formularët e gjatë) + `max-h` me safe-area; `relative` te butoni "Më shumë"; `image/svg+xml` hequr nga RichTextEditor + TaskDetailPanel (XSS i ruajtur); "Demo Mode" te `UserProfileView` vetëm në DEV; `nativeApi.ts` mbulon `URL` + rindërton `Request` (trupi humbte pa `duplex`); `UserProfile` + 5 fusha → 16 gabime typecheck më pak
- Verifikim: build ✅, 1409/1409 teste ✅, `android-configure.cjs` idempotent ✅. `VERSION_CODE` 30→31 / `1.8.2`→`1.8.3` (ndryshoi manifesti). Mbeten: tregues offline, 8 × `window.confirm`, aria-label

### [2026-09-17] — Modules: two layers (platform entitlement vs owner toggle)
- Problem: super-admin and owner wrote the SAME field (`disabledModules`), so a module the platform switched off at /superadmin could be re-enabled by the owner from Cilësimet → Modulet — the console toggle was a suggestion
- `businesses.lockedModules` = layer 1 (platform, server-written via `set-modules`/`create-tenant`, rules deny the owner — test 21b, 116/116 rules tests green); `disabledModules` stays layer 2 (owner). `moduleBlockReason()` order: permission → plan → `locked` → `disabled`
- New `src/views/superadmin/ModuleAccessEditor.tsx`: one switch per module = "in the contract", plan badge, "Fikur nga pronari" + "Ndize" assist, presets Hap të gjitha / Sipas paketës / Kyç të gjitha; used by TenantDetailView (replaces the chips) and CreateTenantDialog
- Owner side: `ModulesSettingsPanel` shows locked rows as "E menaxhuar nga FivoCRM" (inert switch), `ModuleGate` has a `locked` screen, `useModules().setModuleEnabled` refuses a locked module with a clear message
- Deploy: `firebase deploy --only firestore:rules` (owner lock protection is rules-enforced)

### [2026-09-17] — Super-admin: per-module switches when creating a tenant
- Gap: `CreateTenantDialog` sent no `disabledModules`, so a console-created tenant was born with EVERY module on (shop/hosting/gmb/landing included) while the self-serve `/signup` path honoured `defaultOff`
- `src/lib/modules.ts`: `disabledPathsFor(enabledPaths)` (only optional modules, unknown paths ignored, core never written) + `groupedOptionalModules()` / `MODULE_GROUP_ORDER`; 5 new tests in `modules.test.ts`
- `CreateTenantDialog.tsx`: "Modulet" section — a Switch per optional module grouped by area, presets Të gjitha / Standard (registry default) / Asnjë, plan-lock badge per module + a warning count for modules switched on above the chosen plan
- `api/_platformAdmin.ts` `create-tenant`: validates the list (strings, `/app/…`, dedup, ≤200), stamps `businesses.disabledModules` and records it in the `platform.tenant_created` audit meta; client `createTenantFromConsole({ disabledModules })`

### [2026-09-15] — WhatsApp (Baileys): agents follow Firestore, honest send status
- Root cause of "shows sent, not on my phone": a `whatsappAccounts` doc deleted in Cilësimet left its agent alive on the VPS and `getAgent()` (first connected) kept routing sends through it — messages left from the OLD number (…6087), not the new "Puna" account
- `vps/server.ts`: `whatsappAccounts` onSnapshot → `reconcileAgents()` / `unloadAgent()` (deleted = logout + wipe session, disabled = close socket; `agent.unloading` stops the reconnect); `/reload` reconciles both ways
- `/send` pre-generates the id, writes `status: 'pending'`, waits ≤6s for server ack (2) → `sent`; 0/close → `failed` + `error`; `messages.update` maps 0/2/3/4/5 and never downgrades; Baileys logger `warn` (`BAILEYS_LOG_LEVEL`)
- `api/whatsapp.ts` status read `data.statuses` but VPS returns `agents` → always empty; fixed + `connectedPhone`. `SettingsView` shows LIVE state (`useWhatsAppStatus`) instead of the stamped phone; `WhatsAppChatPanel` ticks: clock / ✓ / ✓✓ / ✓✓ green / Dështoi
- Still open: `/send` with no `agentId` picks the first connected agent regardless of team/user (item 1 of the review)

### [2026-09-07] — Customers: ranking by revenue
- `src/views/CustomersView.tsx`: sort "Sipas të ardhurave" (cash collected desc → billed → name, rank #N shown), column "Të ardhura" (arkëtuar / faturuar / hapur, header click toggles the sort), CSV gains the three ALL columns
- Figures come from `getInvoiceCollectedAll / getInvoiceTotalAll / getInvoiceOutstandingAll` (financialAnalytics) so Draft/Cancelled count 0 and partials count what was banked; column hidden when the invoices read is denied

### [2026-09-07] — CRM automation rules engine (leads + customers)
- `src/lib/crm/automationRules.ts` (+36 tests) = pure engine: 8 triggers, 13 condition fields, 7 actions, named block reasons, deterministic fire keys, `enrollExisting`, cooldown = window; `api/_crmAutomationEngine.ts` is a byte-identical copy guarded by the test
- `api/_crmAutomationJob.ts` (`?job=crm-automations`, hourly in `vps/server.ts`, not run-all): per-tenant facts (leads/customers/invoices/projects), `crmAutomationRuns` created BEFORE actions (idempotency + audit), rule paused on error, manual run scoped to caller's tenant
- UI `src/views/crm/AutomationRulesPanel.tsx` in CRMView toggle **Automatizime**: 7 recipes, builder with live preview via the same engine, run history, "Ekzekuto tani"; rules + tests 48a/48b, index, type `crm_automation`; runbook `workspace/CRM_AUTOMATION.md`

### [2026-09-03] — Task reminders ("Më kujto") + task-ordering audit fixes
- `src/lib/taskReminders.ts` (+19 tests): `reminderAt` / `reminderOffsetMinutes` / `reminderSentAt` on Task; presets (Në afat, 30 min, 1 orë, 1 ditë para) + custom date/time; a moved deadline carries a relative reminder (`reminderPatchForDeadline`); recurring next cycle keeps the offset (`recurringUtils.ts` + cron mirror)
- UI: TaskDetailPanel row "Kujtesë", QuickTaskForm section "Kujtesë" (both variants), TasksView row bell + create handler; SettingsView cron card. Cron `task-reminders` in `api/cron/run.ts` (every 5 min via `vps/server.ts`, NOT run-all; range on `reminderAt`, idempotent); type `task_reminder` registered in both registries
- `src/lib/taskSort.ts` (+12 tests): one date normaliser + total-order comparators. Fixed: manual-order sentinel sank new tasks to last page (TasksView), grouping over the current page only + Done tasks under "Më vonë", project list `'~~~'` section sentinel sorted FIRST, kanban columns unsorted, subtasks in doc-id order, StaffDashboard comparator could throw on non-Date + excluded today's earlier tasks, `useFirestore` orderBy mixed Date/string + ignored `limit`, timeline/portal tie-breakers
- Not persisted: same-column drag on the PROJECT board (no order field) — columns now sort urgent-first/earliest-deadline instead

### [2026-08-06] — Manual duplicate merge for customers & leads
- `src/lib/contactMerge.ts` (+22 tests): duplicate grouping (email/phone/name, union-find, name match refused when emails contradict), field-by-field plan with data-preserving defaults (tags unioned, notes concatenated), allow-listed field resolution
- `api/_merge-contacts.ts` (routed `?type=merge-contacts` + vercel.json rewrite, `api/email.ts` maxDuration 60): reassigns ~45 collection/field pairs (invoices, invoiceItems, payments, projects, tasks, quotes, contracts, deals, reports, portal access, `dailyReports.customerIds`, portal chat channel rename) onto the survivor; Admin/Manager + same-business only; archives the absorbed doc to `contactMerges` BEFORE writing; duplicate deleted last and never when truncated; cascades to the linked lead↔customer pair
- UI: `MergeContactsDialog` (survivor picker, swap, per-field choice, server dry-run preview) + `DuplicateContactsPanel`; wired into CustomersView (tab "Dublikatë" + 2-selected bulk action) and CRMView (view toggle "Dublikatë" + bulk action)
- `firestore.rules`: `contactMerges` = tenant-admin read, `write: if false` (+2 negative tests in `scripts/firestore-rules.test.mjs`, NOT run locally — firebase-tools needs JDK 21, this machine has 17)

### [2026-03-25] — Full Security & Bug Fix Pass (33 issues fixed)
- **Firestore Rules**: `allow read` now uses `canReadTeamDoc()` (team-member check) instead of just `isAuth()` — prevents data leaks across teams
- **API Auth**: `create-checkout-session.ts` now requires Firebase Bearer token + validates redirect URLs
- **collaboratorIds**: Changed type from `string` (JSON) to `string[]` (array); updated usages in TasksView, ProjectDetailView, TaskDetailPanel, useRoleFilteredData
- **Invites**: Duplicate invite prevention, token expiry check in accept, replaced all `alert()` with toast in TeamsView
- **InvoicesView**: Payment success verifies Firestore invoice status; amount edit validates positive numbers; auth token sent to Stripe API
- **CRMView**: Added `saving` state to prevent double-submit on lead creation
- **ProjectsView**: Cascade delete — deleting a project now deletes all its tasks too
- **SettingsView**: Removed unused `stripeSecretKey` state variable
- **usePermissions**: `hasError` flag — returns restrictedPermissions on Firestore error (fail-safe)

### [2026-03-08] — Full Code Review & Productivity Analysis
- Analyzed entire codebase: 15 views, 9 components, comprehensive ERP/CRM system
- Identified existing features: Tasks, Projects, Time Tracking, Goals, Teams, CRM, Invoices, Chat, Reports
- Researched productivity patterns from Asana, Monday.com, ClickUp, Notion, Todoist
- Suggested 8 new features: Daily Standup, Task Dependencies, Workload View, Automations, Templates, Focus Mode, Weekly Digest, Quick Add
- Recommended top 3 priorities: Daily Standup, Task Dependencies, Workload View
- Files reviewed: All views in src/views/, Sidebar, TaskDetailPanel, App.tsx


### [2026-03-08] — Enhanced Customers View with Search and Filters
- Added search bar filtering by name, email, phone, NIPT, company, industry
- Added filter dropdowns: Status, Industry, Credit Limit
- 5 customer statuses: Aktiv, Joaktiv, VIP, Në Pritje, Pezulluar with icons/colors
- Status summary cards showing count per status (clickable for quick filter)
- Industry dropdown with predefined Albanian options in customer form
- Full Albanian language labels throughout the view
- File: `src/views/CustomersView.tsx`

### [2026-03-08] — Show Assignee in Task List View
- Task list now displays assignee with user icon and truncated name/ID
- Shows email username (before @) or first 8 chars of user ID
- Unassigned tasks show "Pa caktuar" label
- File: `src/views/TasksView.tsx`

### [2026-03-08] — Show Assignee in Project Detail Tasks
- Task list and board views now display assignee name/ID with avatar
- Shows truncated email username or user ID for better readability
- Unassigned tasks show "Pa caktuar" warning badge with icon
- File: `src/views/ProjectDetailView.tsx`

### [2026-03-08] — Unified Task Creation Form in ProjectDetailView
- Replaced QuickTaskForm with full TaskForm component in ProjectDetailView
- Task creation in projects now has same UI as TasksView: status, priority, dates, recurring options
- Form auto-selects current project by default via `defaultProjectId` prop
- File: `src/views/ProjectDetailView.tsx`

### [2026-03-08] — Removed Non-Functional ContextToolbar
- Deleted `src/components/ContextToolbar.tsx` - had non-working filters, search, view toggles, and "Save View" button
- Removed ContextToolbar import and usage from `src/App.tsx`
- Each view already has its own functional filters (ProjectsView, TasksView, etc.)
- Files: `src/App.tsx`, deleted `src/components/ContextToolbar.tsx`

### [2026-03-08] — Fixed Code Bugs After Analysis
- Removed duplicate `getStatusColor` function in InvoicesView.tsx (was defined twice)
- Fixed ExpensesView.tsx Select value from "none" to "__none__" (Radix UI requires non-empty values)
- Full code analysis completed: reviewed App.tsx, Sidebar, TasksView, TaskDetailPanel, ProjectsView, TeamsView, InvoicesView, ReportsView, ChatView, GoalsView, CustomersView, ExpensesView, ServicesView, usePermissions
- Files: `src/views/InvoicesView.tsx`, `src/views/ExpensesView.tsx`


### [2026-03-08] — Fixed UX Issues: Albanian Language, Search, Delete Confirmation
- Unified Albanian language across all views (Settings, Reports, Teams, Invoices)
- Added search bar in Tasks list view with real-time filtering
- Task creation now defaults to current user (no manual User ID required)
- Added delete confirmation dialogs before removing tasks and team members
- Comments now show commenter name/avatar with timestamp
- Files: `src/views/TasksView.tsx`, `src/components/TaskDetailPanel.tsx`, `src/views/ReportsView.tsx`, `src/views/SettingsView.tsx`, `src/views/TeamsView.tsx`, `src/views/InvoicesView.tsx`

### [2026-03-08] — Redesigned Projects View like Asana
- Full page project detail view instead of popup dialog
- Search bar and filter dropdowns (Owner, Members, Teams, Status)
- Table layout with columns: Name, Members (avatars), Teams, Last modified
- Created `src/views/ProjectDetailView.tsx` for full project page with tasks
- Project detail has List/Board/Calendar views with task panel
- Added route `/app/projects/:projectId` for project detail
- Removed debug logs from TaskDetailPanel
- Files: `src/views/ProjectsView.tsx`, `src/views/ProjectDetailView.tsx`, `src/App.tsx`


### [2026-03-08] — Fixed Assignee Selector in Task Detail Panel
- Made "Caktuar te" (Assign to) field clickable with popover selector
- Shows current user, team members, and manual User ID input option
- Added debug logs to trace assignee selection flow
- File: `src/components/TaskDetailPanel.tsx`

### [2026-03-08] — Redesigned Task View with Split Panel Layout
- Changed task detail from popup dialog to full side panel (Asana-style)
- Left side shows task list, right side shows selected task details
- Made task title editable with click-to-edit functionality
- Compact date display (e.g., "Mar 8") with inline calendar pickers
- Description moved below assignee, larger text area
- Created new `TaskDetailPanel.tsx` component for panel layout
- Albanian language labels throughout the UI
- Files: `src/views/TasksView.tsx`, `src/components/TaskDetailPanel.tsx`


### [2026-03-08] — Made Task Title Clickable in List View
- Task titles in list view are now clickable to open task detail dialog
- Added hover effects (underline, primary color) for better UX
- File: `src/views/TasksView.tsx`

### [2026-03-08] — Simplified Task List Display
- Removed task description from task cards in board view
- Removed task description from list view table
- Task cards now show only title for cleaner UI
- File: `src/views/TasksView.tsx`

### [2026-03-07] — Direct Messages Between Team Members
- Added "Mesazhe Direkte" section in ChatView for private conversations
- Team members can now chat directly with each other (1-on-1)
- Shows existing conversations and available team members separately
- Unread message badges for direct conversations
- Albanian language labels throughout DM UI
- File: `src/views/ChatView.tsx`

### [2026-03-07] — Task-Based Chat with Auto-Label
- Added `taskId` field to Message entity to link messages to specific tasks
- Integrated chat directly into TaskDetailDialog with collapsible chat panel
- Auto-generated task label from title (first 2-3 words) shown as chat channel name
- Real-time messaging within task context with sender identification
- Chat separate from comments - chat for discussion, comments for formal notes
- Files: `src/components/TaskDetailDialog.tsx`, Message entity patched

### [2026-03-07] — Full Subtask Management
- Added subtask creation form with all task fields: title, description, status, priority, dates, assignee
- Subtasks limited to one level only (subtasks cannot have their own subtasks)
- Edit and delete functionality for subtasks with inline status toggle
- Albanian language labels throughout subtask UI
- File: `src/components/TaskDetailDialog.tsx`

### [2026-03-07] — Stripe Integration UI
- Added Integrations tab in SettingsView with Stripe API key configuration
- Test/Live mode selection with warning for live payments
- Publishable key, Secret key, and Webhook secret fields
- Added "Paguaj me Stripe" button on pending invoices in InvoicesView
- Payment simulation for demo (marks invoice as Paid)
- Files: `src/views/SettingsView.tsx`, `src/views/InvoicesView.tsx`

### [2026-03-07] — Professional Solution Guidance (Albanian)
- Analyzed full project structure: ERP/CRM system with 14 modules
- Recommended Supabase as most professional solution for production
- Explained 3 options: Supabase (recommended), Full-Stack Custom, Firebase
- Supabase benefits: easy migration, PostgreSQL, real-time, RLS security, free tier


### [2026-03-07] — Node.js Backend Guidance (Albanian)
- Explained current SDK limitations (works only in Anima Playground)
- Recommended Supabase as easiest migration path for Node.js backend
- Provided Express.js + Supabase code example
- Outlined architecture: React → Node.js API → Database


### [2026-03-07] — Deployment Guidance (Albanian)
- Explained hosting options: Vercel, Netlify, GitHub Pages (Firebase not required)
- Clarified that Anima Playground SDK only works in playground environment
- For production: need real backend (Supabase, Firebase, PlanetScale, etc.)
- Recommended Supabase as easiest migration path from current SDK


### [2026-03-07] — Due Date Indicators & Quick Status Change
- Added overdue task indicators with red banner and styling for tasks past due date
- Added "due today" warning with orange/yellow styling
- Implemented quick status change dropdown directly from task card badge
- Task cards now show relative due date labels (e.g., "2 ditë vonuar", "Sot", "3 ditë")
- File: `src/views/TasksView.tsx`

### [2026-03-07] — Task UI Analysis
- Analyzed TasksView.tsx and TaskDetailDialog.tsx for improvement opportunities
- Identified missing features: search, labels/tags, due date indicators, bulk actions, keyboard shortcuts
- Explained WhatsApp login limitations: requires backend server, WhatsApp Business API approval
- Current auth uses Anima Playground SDK OAuth (Google/GitHub only)
- Files reviewed: `src/views/TasksView.tsx`, `src/components/TaskDetailDialog.tsx`

### [2026-03-07] — Collaboration Enhancements
- Added admin permission management: admins can edit member roles and permissions from Teams view
- Implemented @mentions in comments with autocomplete suggestions and notifications
- Added real-time collaboration indicators showing who's working on each task
- Built file attachments UI with upload, view, and delete functionality
- Task cards now show visual indicator when someone is actively working on them
- Files: `src/views/TeamsView.tsx`, `src/components/TaskDetailDialog.tsx`, `src/views/TasksView.tsx`, `src/hooks/usePermissions.ts`

### [2026-03-07] — Deployment Guidance
- Explained hosting options: Vercel, Netlify, GitHub Pages
- Noted that Anima Playground SDK works within playground environment
- For production deployment, would need separate backend (Firebase, Supabase, etc.)


### [2026-03-07] — Investigated Accordion Warning
- Warning "Accordion is changing from uncontrolled to controlled" comes from Radix UI internals
- Not a bug in project code - Radix uses Accordion internally for Tabs and other components
- Warning only appears in development/StrictMode, doesn't affect production
- No code changes needed - warning can be safely ignored

### [2026-03-07] — Debug Permission System
- Added debug logs to `usePermissions.ts` to trace user ID matching
- Fixed userId matching to check both user.id AND user.email (since members may be added with email)
- Updated AddMemberForm to show current user's ID for easy copying
- Query all active TeamMembers then filter client-side for flexible matching
- Files: `src/hooks/usePermissions.ts`, `src/views/TeamsView.tsx`

### [2026-03-07] — Permission-Based Navigation System
- Created `src/hooks/usePermissions.ts` hook to fetch user's team membership and permissions
- Updated Sidebar to filter navigation items based on TeamMember permission flags
- Shows user's role and team name in sidebar when they have team membership
- Navigation items filtered by: canAccessProjects, canAccessTasks, canAccessCRM, canAccessInvoices, etc.
- Admin role gets full access; no membership = full access (owner mode)

<!-- Hyrjet para kesaj date u hoqen per ta mbajtur skedarin nen 300 rreshta
     (udhezimi ne krye). Historiku i plote eshte ne git. -->
</changelog>
