/**
 * Deep links carried by notifications.
 *
 * A notification must land on the *thing* it is about. For a comment that means
 * the comment itself — not merely the page that contains it — so every link built
 * here carries the record id AND the comment id. The receiving view opens the
 * record and `useCommentFocus` scrolls the comment into view and flashes it.
 *
 * Query params (kept stable — notifications already stored in Firestore must keep
 * working, so never rename these):
 *   `taskId`         — task to open in the detail panel (staff views)
 *   `comment`        — comment inside the opened record (task / report / portal project)
 *   `projectComment` — project-level client↔staff comment on the project page
 */

const withParams = (base: string, params: Record<string, string | null | undefined>) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
};

/**
 * Open a task (and optionally one of its comments). A task inside a project opens
 * on the project page, which is where its board/list context lives; a standalone
 * task opens in Detyrat.
 */
export const taskDeepLink = (
  taskId: string,
  projectId?: string | null,
  commentId?: string | null,
) => withParams(
  projectId ? `/app/projects/${projectId}` : '/app/tasks',
  { taskId, comment: commentId },
);

/** Project page, focused on a project-level comment from the client discussion. */
export const projectCommentDeepLink = (projectId: string, commentId?: string | null) =>
  withParams(`/app/projects/${projectId}`, { projectComment: commentId });

/** Report page, focused on one comment in the discussion. */
export const reportDeepLink = (reportId: string, commentId?: string | null) =>
  withParams(`/app/reports/${reportId}`, { comment: commentId });

/** Client portal: the project page, focused on one comment of the discussion. */
export const portalProjectCommentDeepLink = (projectId: string, commentId?: string | null) =>
  withParams(`/portal/projects/${projectId}`, { comment: commentId });
