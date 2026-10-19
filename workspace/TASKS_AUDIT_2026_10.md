# Tasks audit — 19 Oct 2026

Four read-only sweeps (Tasks UI · recurrence engine + cron · rules/notifications ·
other surfaces). Every finding below is fixed in the same pass; owners = the fix
group (A–E). `completedAt` + `taskCompletedMs()` (taskSort.ts) and
`reminderSetByUserId` were added to `Task` up front as shared contracts.

## 🔴 High
- [x] 1 (A) Internal task comment pushed/emailed to the portal client — participants built from `c.userId` (only portal comments have it); preview ignores visibility. Client-visible reply never notifies the client.
- [x] 2 (C) ProjectDetailView list checkbox writes raw status (no completeTask: blocker guard, next cycle, notifications); not gated on canEdit.
- [x] 3 (C) Last recurring task completion auto-completes the project from a stale snapshot (child not yet in list).
- [x] 4 (B) TasksView `canSeeFinancials` not imported → valued task never creates its draft invoice.
- [x] 5 (A) Reminder preset on an undated task resolves against panel's "now" endDate → fires immediately.
- [x] 6 (D) Browser next cycle: `useMutation.create` overwrites `createdByUserId` with the completer.
- [x] 7 (D) `recurring-project-reset` shifts every task by the whole gap regardless of its own dates; month-end drift (no anchor day).
- [x] 8 (D) "Completed today" read from `updatedAt` (daily report, StaffDashboard, Momentum) → add `completedAt`.

## 🟠 Medium
- [x] 9 (C/D) Kanban drag + daily report pass a partial `allTasks` to completeTask → blocker guard off.
- [x] 10 (A) Dependency cycles allowed (A↔B both blocked forever).
- [x] 11 (A/C/D) Reopen from project board / daily report / subtask checkbox skips the series re-arm.
- [x] 12 (B) Bulk delete: no confirmation, no ownership check.
- [x] 13 (A) Read-only panel: subtask checkbox/delete + recurrence section + "Hiq" not gated by readOnly.
- [x] 14 (E) tasks rule: canAssignTasks / customerId / createdByUserId / teamId not enforced; ChatView task-from-message + AI tasks bypass canAssignTasks.
- [x] 15 (E) taskComments create not bound to task/tenant; author edit can retarget.
- [x] 16 (A) Viewer comment notifies nobody (collaboratorIds write denied → catch returns early).
- [x] 17 (E) Portal project members can't read/post task comments.
- [x] 18 (A) Undated task: endDate state defaults to now → start-date change writes a deadline; "Sot" shown.
- [x] 19 (A/D) enableRecurring takes weekday/day from endDate, engine snaps startDate; calendar ghosts project from endDate.
- [x] 20 (C) overdue/today = instant or machine-local math (projectProgress, ProjectDetailView, ProjectsView label, StaffDashboard).
- [x] 21 (C) Relative labels Math.ceil over raw ms (ProjectDetailView, StaffDashboard).
- [x] 22 (D) Cron spawn not atomic; duplicate key misses root tips.
- [x] 23 (C) projectNextDeadlines includes subtasks + closed projects.
- [x] 24 (B) Drag reorder after doneLast saves Done tasks last in the shared order; Member drag silently lost (Admin-only write, unhandled).
- [x] 25 (C) StaffDashboard / Customer360 progress counts subtasks over filtered list.
- [x] 26 (C) StaffDashboard counts tasks of archived/cancelled projects.
- [x] 27 (C) useFilteredProjects ignores responsibleUserId.
- [x] 28 (E) Task delete cascade leaves timeEntries pointing at a deleted task when the unlink is rules-denied.

## 🟡 Low
- [x] 29 (B) Calendar `sod()` uses setHours(0,0,0,0).
- [x] 30 (B) "Kopjo" keeps carriedOverFromPeriod/Count.
- [x] 31 (B) QuickTaskForm after 22:00 defaults to a past slot.
- [x] 32 (A) Subtask edit form writes endDate without rearm/reminder patch; ignores canAssignTasks.
- [x] 33 (D) Yearly series never return to 29 Feb (no anchor).
- [x] 34 (D) Cron remapDependsOn drops blockers spawned in the same run.
- [x] 35 (D) businessId self-heal runs after the suspended-tenant check.
- [x] 36 (A) Extending "Përsërit deri" on an ended series leaves it dead.
- [x] 37 (E) Portal shows legacy `dueDate` (no deadline visible).
- [x] 38 (C) Momentum pomodoro never linked to a project; frog un-toggle writes `completedAt: undefined`.
- [x] 39 (C) TaskTimeline columns = start + i·24h (DST shift).
- [x] 40 (B) CommandPalette "Krijo Detyrë" doesn't open a form.
- [x] 41 (D/A) "Më kujto" goes to the assignee, not the person who set it (`reminderSetByUserId`).
- [x] 42 (E) Any member/Viewer can delete anyone's task comment; taskCollaborators no Viewer gate.
- [x] 43 (E) Moving a task/changing project customer doesn't re-point client-visible comments.

## Status — all fixed 19 Oct 2026
New contracts: `completedAt` (stamped by every Done path in `completeTask`, cleared by
`reopenTaskPatch`), `taskCompletedMs()`, `seriesCreatedByUserId` (series author — the
create rule pins `createdByUserId == auth.uid`), `reminderSetByUserId` +
`taskReminderRecipient()`, `src/lib/taskDue.ts` (Tirane-day overdue/today),
`src/lib/taskDependencies.ts` (cycle guard). Cron child id `rec_task_<series>_<day>` +
transaction. Rules tests 82a–82i.

Left open on purpose:
- 22 browser path: the spawn keeps its claim transaction but not a deterministic id
  (`useMutation.create(data, id)` is `setDoc`, which overwrites instead of failing).
- 14: a canAssignTasks grant that lives only on a THIRD team's membership row is
  refused by the rules (they can only read the active `tid` row and the task's team row).
- Portal members: comment query is `taskId in [...]` capped at 30 ids (expanded task first).
- Momentum frog has `taskId` in the model but no picker sets it yet.
- ProjectDetailView month calendar still uses `toDateString()` (browser zone).
