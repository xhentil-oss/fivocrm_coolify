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
Standup History View
Add a dedicated view (or tab in DailyReportsView) to browse past morning standups by date/member.
</todo>

<todo>
Workload Reassign
From WorkloadView, allow drag-and-drop or quick-assign to move tasks between team members.
</todo>

<todo>
Blocked Task Notifications
When a dependency task gets marked Done, automatically notify the blocker's assignee that they are now unblocked.
</todo>

