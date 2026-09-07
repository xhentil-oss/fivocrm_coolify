<instructions>
This file powers chat suggestion chips. Keep it focused and actionable.

Rules:
- Each task must be wrapped in "<todo>" and "</todo>" tags.
- Inside each <todo> block:
  - First line: title (required)
  - Second line: description (optional)
- You should proactively maintain this file after each response, even if the user did not explicitly ask.
- Add tasks only when there are concrete, project-specific next steps from current progress.
- Do NOT add filler tasks. Skip adding if no meaningful next step exists.
- Keep this list high-signal and concise, usually 1-3 strong tasks.
- If there are already 3 strong open tasks, usually do not add more.
- Remove or rewrite stale tasks when they are completed, obsolete, duplicated, or clearly lower-priority than current work.
- Re-rank remaining tasks by current impact and urgency.
- Prefer specific wording tied to real project scope/files; avoid vague goals.
</instructions>

<!-- Add tasks here only when there are real next steps. -->

<todo>
Deploy the CRM automation rules (CRM → Automatizime)
`firebase deploy --only firestore:rules,firestore:indexes` (crmAutomationRules/crmAutomationRuns + the run-history index), deploy the api, restart the VPS so the hourly `crm-automations` tick starts, then arm the first recipes in the app. Checklist + laws: workspace/CRM_AUTOMATION.md.
</todo>

<todo>
CRM enterprise roadmap — next after the rules engine
(2) customer lifecycle: `lifecycleStage` (onboarding/active/at-risk/churned), `renewalDate`, `contractValue`, `accountOwner` on Customer + renewal/NPS triggers in the engine; (3) multi-step sequences per segment (email + WA + task) replacing the single team-wide `leadCadenceDays`; (4) behavioural scoring (WA reply, email open, portal login, quote viewed) with per-tenant weights + routing by capacity/service; (5) Lead/Deal split (phase 5). Assessment in the 2026-09-07 conversation; the rules engine is the foundation all four sit on.
</todo>

<todo>
Decide the group-channel unread model (chat bug #11)
markAsRead writes a SHARED `isRead: true` on a group message, so the first member to open the channel zeroes everyone else's badge — and channelUnreadMap ignores `readBy` entirely. channel_message notifications now arrive while the badge beside them can read 0. Cheap fix (stop writing isRead for groups) vs correct fix (per-user channelReads lastReadAt): trade-off written up in workspace/CHAT_NOTIFICATIONS_AUDIT_2026_08.md.
</todo>

<todo>
Verify the chat-notification fixes on real devices
All 9 are implemented (workspace/CHAT_NOTIFICATIONS_AUDIT_2026_08.md). Left to confirm in production: a web push tap now lands on the conversation (the SW fix only applies after a deploy), a group-channel message reaches every member's bell/push exactly once, and DND/Tingull actually silence the chat chirp. The notificationThrottle rule rides along with the next firestore:rules deploy.
</todo>


<todo>
Deploy the invoice-module audit fixes
Rules deploy (invoiceItems is now staff-only write), VPS cron restart for the new period-key recurrence engine, then `node scripts/fix-orphan-invoice-items.mjs --apply`. Full checklist: workspace/INVOICES_AUDIT_2026_08.md.
</todo>

<todo>
Scope the cron's invoice reads per tenant
`invoice-reminders`, `overdue-reminders` and `recurring-invoices` still read `invoices` cross-tenant (`where('status','==',…)`, `where('isRecurring','==',true)`), against the documented per-tenant cost rule. Belongs with the `tenantScopedDocs()` rollout — backlog #24 in the audit.
</todo>

<todo>
Deploy Expense Rules + Indexes
Rules tests pass 96/96 in the emulator. Deploy: firebase deploy --only firestore:rules,firestore:indexes (expenses rule now enforces keepsBusinessId, approver-only approvalStatus, re-approval on amount/date edit; indexes moved teamId -> businessId). See workspace/EXPENSES_AUDIT_2026_08.md.
</todo>

<todo>
Scope Expense Reads Per Role
Close the read half of finding #8: a Member can still read colleagues' Salary expenses from the console. Needs a per-role query (teamScopedWhere + createdByUserId), a (businessId, createdByUserId) index, and a fix for ProjectDetailView's burn-down read. Verify with real roles before deploying.
</todo>

<todo>
Standup History View
Add a dedicated view (or tab in DailyReportsView) to browse past morning standups by date/member.
</todo>

<todo>
Workload Reassign
From WorkloadView, allow drag-and-drop or quick-assign to move tasks between team members.
</todo>


