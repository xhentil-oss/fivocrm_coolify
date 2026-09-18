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

### [2026-09-18] — Audit Android/UI/UX: 11 bugs të rregulluara (workspace/ANDROID_UI_AUDIT_2026_09.md)
- P0 `src/index.css`: `@media (pointer: coarse)` vendoste `min-width/height: 44px` mbi çdo `<button>` — Radix i jep Switch/Checkbox/Radio si button, pra çdo checkbox bëhej katror 44×44 dhe track-u i switch-it 44×44 me `translate-x-4` që s'shkonte askund (**on/off dukeshin njësoj në Android**); rolet dalin jashtë rregullit. Rregulli `font-size:16px` humbte ndaj çdo klase `text-sm`, pra s'mbronte nga zoom-i i iOS — u zhvendos te `html.plt-ios` (flamur i ri në `src/index.tsx`), Android/desktop pa ndryshim
- P0 `AndroidBackButton.tsx` rishkruar: varej nga `location.pathname` + regjistrim async me cleanup sinkron → dëgjues jetimë, një Back kërcente 2-3 ekrane. Tani regjistrim një herë me `ref` + flamur `cancelled`; `registerBackDismiss()` (i lidhur në `App.tsx` dhe `MobileBottomNav.tsx`) e bën Back të mbyllë së pari overlay-t; pa histori shkon në dashboard, nuk mbyll aplikacionin
- P1: `Sidebar.tsx` lartësia zbret edhe bottom nav-in nën `lg` (footer-i Profili/Cilësimet ishte plotësisht i mbuluar); `ui/toast.tsx` `top-[76px]` → `calc(76px + var(--safe-area-top))` (toast-i dilte nën header në pajisje me notch); kanal FCM `fivocrm_default` në `android-configure.cjs` + `usePushNotifications.ts` (pa të, OEM-të e vinin në importance të ulët → push pa zë e pa banner); `AuthContext.isSignInCancellation()` (anulimi i Google në Android nxirrte gabim të kuq)
- P2: `gap-2` te Dialog/AlertDialog footer (butonat ngjiteshin në telefon); X-i i dialogut në shirit `sticky` (rrëshqiste jashtë në formularët e gjatë) + `max-h` me safe-area; `relative` te butoni "Më shumë"; `image/svg+xml` hequr nga RichTextEditor + TaskDetailPanel (XSS i ruajtur); "Demo Mode" te `UserProfileView` vetëm në DEV; `nativeApi.ts` mbulon `URL` + rindërton `Request` (trupi humbte pa `duplex`); `UserProfile` + 5 fusha → 16 gabime typecheck më pak
- Verifikim: build ✅, 1409/1409 teste ✅, `android-configure.cjs` idempotent ✅. `VERSION_CODE` 30→31 / `1.8.2`→`1.8.3` (ndryshoi manifesti). Mbeten: tregues offline, 8 × `window.confirm`, aria-label



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

### [2026-03-07] — Added Demo Mode to User Profile
- Added Demo Mode toggle in UserProfileView to switch between demo profiles
- 4 demo profiles: Admin, Manager, Member, Viewer with different roles/permissions
- Demo mode shows simulated tasks, projects, goals, and role-specific permissions info
- Albanian language labels throughout the demo mode UI
- File: `src/views/UserProfileView.tsx`

### [2026-03-07] — User Testing Guidance
- Explained OAuth authentication flow to user (Google/GitHub required)
- Clarified that TeamMember links existing OAuth users, doesn't create new accounts
- Suggested testing approach: login with OAuth, add self to team with specific permissions

### [2026-03-07] — Auth System Analysis
- Reviewed authentication flow: uses Anima Playground SDK OAuth (Google, GitHub, etc.)
- TeamMember entity links existing users to teams, does NOT create new loginable users
- TeamInvite creates invitation records but doesn't send actual emails
- Users must register through platform OAuth to be able to login
- Files reviewed: `src/App.tsx`, `src/components/TopNavBar.tsx`, `src/views/TeamsView.tsx`

### [2026-03-07] — Added Direct Member Creation with Role
- Added "Add Member Directly" option in TeamsView to create team members without invitation flow
- New AddMemberForm with role selection (Admin, Manager, Member, Viewer) and granular permissions
- Separated "Invite via Email" and "Add Member Directly" options in team dropdown menu
- Albanian language labels for the new form (Roli, Lejet e Aksesit, etc.)
- File: `src/views/TeamsView.tsx`

### [2026-03-07] — Added User Account Switching & Logout
- Added logout and switch account functionality to TopNavBar user dropdown
- Shows user profile picture, name, and email in dropdown header
- "Ndrysho Llogarinë" option logs out and opens login dialog for new account
- "Dil nga Llogaria" option for simple logout
- File: `src/components/TopNavBar.tsx`

### [2026-03-07] — Unified Task Detail Dialog Component
- Created shared `src/components/TaskDetailDialog.tsx` used by both TasksView and ProjectsView
- Both views now have identical task UI with time tracking, editable dates, comments, subtasks
- Removed duplicate TaskDetailDialog from ProjectsView, now imports shared component
- Cleaned up debug logs from ProjectsView
- Files: `src/components/TaskDetailDialog.tsx`, `src/views/TasksView.tsx`, `src/views/ProjectsView.tsx`

### [2026-03-07] — Fixed Task Detail Dialog UI Layout
- Made start/end dates editable with calendar picker in task detail dialog
- Moved comments section out of tabs to always be visible at bottom
- Removed tabs structure, now shows details, time tracking, and comments in single scrollable view
- Fixed dialog layout to prevent element overlap with flex-col and overflow-y-auto
- File: `src/views/TasksView.tsx`

### [2026-03-07] — Created Time Tracking & Pomodoro Timer View
- Added TimeEntry entity with fields: taskId, projectId, userId, description, startTime, endTime, duration, isBillable, hourlyRate, tags, isPomodoroSession, pomodoroCount
- Built TimeTrackingView with running timer, Pomodoro timer (25/5 min cycles), manual time entries, billable time tracking
- Features: start/stop timer, Pomodoro focus/break cycles, time analytics (total, billable, revenue), task/project linking
- Added route `/app/time-tracking` with Clock icon in sidebar navigation
- Files: `src/views/TimeTrackingView.tsx`, `src/App.tsx`, `src/components/Sidebar.tsx`

### [2026-03-06] — Fixed Dialog JSX Structure in InvoicesView
- Corrected misplaced Dialog/DialogTrigger/DialogContent nesting causing build error
- DialogContent must be inside Dialog wrapper, not a sibling
- File: `src/views/InvoicesView.tsx` line 107-127

### [2026-03-06] — Added Inline Editing and Export to Teams View
- Implemented click-to-edit for team name and department fields
- Added ExportButton component for CSV/JSON export of teams data
- Included Edit2, Check, X icons for inline editing UI
- Files: `src/views/TeamsView.tsx`

### [2026-03-06] — Removed Dashboard, Kept Reports Only
- Deleted DashboardView.tsx as it duplicated Reports functionality
- Set Reports as default landing page (redirects from "/" to "/app/reports")
- Removed Dashboard from sidebar navigation
- Files: `src/App.tsx`, `src/components/Sidebar.tsx`, deleted `src/views/DashboardView.tsx`

### [2026-03-06] — Phase 1: Created Dashboard with KPIs and Charts
- Built comprehensive DashboardView with real-time KPIs for revenue, projects, tasks, leads, goals
- Added interactive charts: revenue trend (6 months), task distribution, goals progress, recent activity
- Calculated metrics: completion rates, conversion rates, profit margins, overdue tasks
- Financial summary cards showing revenue, expenses, net profit with trend indicators
- Set dashboard as default landing page, added to sidebar navigation
- Files: `src/views/DashboardView.tsx`, `src/App.tsx`, `src/components/Sidebar.tsx`

### [2026-03-06] — Fixed Select.Item Empty Value Error in ExpensesView
- Changed department Select "None" option from empty string value to "none"
- Radix UI Select.Item requires non-empty value prop to distinguish from placeholder
- File: `src/views/ExpensesView.tsx` line 394

### [2026-03-06] — Fixed JSX Syntax Error in ServicesView
- Escaped HTML tag examples in help text that were being parsed as JSX elements
- Changed `<h1>, <p>, <ul>, <strong>, <em>` to use curly brace escaping `{'<h1>'}` etc.
- File: `src/views/ServicesView.tsx` line 257

### [2026-03-05] — Enhanced Lead and Customer Forms with All Fields
- Lead form now includes all fields: phoneNumber, address, company, jobTitle, website, source, notes, estimatedValue
- Customer form includes all enterprise fields: website, industry, taxId, billing/shipping addresses, contact person, credit limit, payment terms, tags
- Both forms use scrollable 2-column grid layout with Textarea for address fields
- Tables display comprehensive information including company details, contact info, and financial data
- Forms properly handle optional fields with undefined fallbacks

### [2026-03-05] — Added All Lead and Customer Fields
- Extended Lead form with all fields: phoneNumber, address, company, jobTitle, website, source, notes, estimatedValue
- Enhanced Lead table to show company info, source, and estimated value columns
- Extended Customer form with all enterprise fields: website, industry, taxId, billing/shipping addresses, contact person, credit limit, payment terms, tags
- Converted Customer view from cards to table layout showing all key information
- Both forms now use scrollable 2-column grid layout for better organization

### [2026-03-05] — Fixed Task Status and Priority Update Bug
- Fixed Select components in TaskForm not submitting values to FormData
- Added state management for status, priority, and projectId in TaskForm
- Enabled inline status/priority editing directly from TaskDetailDialog
- Added debug logging for status/priority changes to track user interactions

### [2026-03-05] — Enhanced Task Management with Asana-Inspired Features
- Added collaborators support to tasks via TaskCollaborator entity and collaboratorIds field
- Implemented subtasks with parentTaskId field for hierarchical task organization
- Created UserProfile entity with jobTitle, department, bio, skills, phone, location fields
- Built GoalsView with nested goals, progress tracking, milestones, and team association
- Created UserProfileView showing user's tasks, projects, goals with editable profile fields

### [2026-03-05] — Implemented Phase 3 Advanced Features
- Created `src/views/ChatView.tsx` with Message entity for internal chat system
- Added real-time messaging with channels (general, team, support) and unread badges
- Enhanced `src/views/ReportsView.tsx` with revenue tracking by department
- Revenue breakdown shows paid/pending amounts per department with visual progress bars
- Updated navigation in `src/components/Sidebar.tsx` and `src/App.tsx` to include Chat route

### [2026-03-05] — Verified Teams and Invoices Views Implementation
- Both `src/views/TeamsView.tsx` and `src/views/InvoicesView.tsx` are fully implemented
- Teams view includes create/list functionality with department tracking
- Invoices view includes full CRUD, revenue stats, payment tracking, and project linking
- Both views use Anima Playground React SDK with proper loading/error states

### [2026-03-05] — Retry: Added Teams and Invoices to Sidebar Navigation
- Rewrote `src/components/Sidebar.tsx` with complete file content
- Added Teams (UsersRound icon) and Invoices (Receipt icon) to navItems array
- Navigation now includes all 7 sections: Projects, CRM, Tasks, Teams, Invoices, Reports, Settings
</changelog>
