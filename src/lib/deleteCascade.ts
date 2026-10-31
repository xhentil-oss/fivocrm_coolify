import {
  arrayRemove,
  collection,
  deleteDoc,
  doc as docRefOf,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { getGlobalBusinessId } from '../hooks/useFirestore';

// ── Delete cascades (tasks & projects) ───────────────────────────────────────
//
// Deleting a task or a project used to be a bare `remove(id)`, which left two
// classes of wreckage:
//
//  · ORPHANS — a deleted parent task's subtasks keep `parentTaskId` pointing at
//    nothing: the list renders only `!parentTaskId` rows and the parent's panel
//    (the only place subtasks show) is gone, so they become unreachable forever
//    while still counting in project progress and overdue KPIs. Same for
//    `taskComments`, `taskCollaborators` and the task's own draft invoice.
//
//  · HISTORY — logged hours and issued invoices are payroll/accounting records:
//    they must SURVIVE, unlinked, never deleted.
//
// Two views delete projects (ProjectsView row + ProjectDetailView menu) and
// three surfaces delete tasks; this module is the single implementation so the
// two can never drift again (the detail view used to have NO cascade at all).
//
// Every query here filters on businessId: Firestore rules are NOT filters, so a
// query constrained only by projectId/taskId is unprovable and rejected outright
// for everyone but a super-admin — which is exactly why the old ProjectsView
// cascade failed with "Gabim gjatë fshirjes" for normal admins.

export interface TaskCascadeSummary {
  tasks: number;
  comments: number;
  collaborators: number;
  /** Task-chat rows (`messages` with `taskId`) deleted with their task. */
  chatMessages: number;
  timeEntriesUnlinked: number;
  draftInvoicesDeleted: number;
  invoicesUnlinked: number;
  failed: number;
}

const emptySummary = (): TaskCascadeSummary => ({
  tasks: 0,
  comments: 0,
  collaborators: 0,
  chatMessages: 0,
  timeEntriesUnlinked: 0,
  draftInvoicesDeleted: 0,
  invoicesUnlinked: 0,
  failed: 0,
});

function scoped(col: string, businessId: string, field: string, value: string) {
  return query(
    collection(db, col),
    where('businessId', '==', businessId),
    where(field, '==', value),
  );
}

/** Shown when logged hours cannot be unlinked by the caller (the rules let a
 *  non-Admin/Manager write only their OWN time entries, and nobody touches a
 *  row inside a closed month). The task is then NOT deleted: a deleted task
 *  with rows still pointing at it is exactly the dangling state this module
 *  exists to prevent. */
export const TIME_ENTRIES_UNLINK_DENIED =
  "Detyra ka orë të regjistruara që s'mund t'i shkëpusësh — kërko një Admin/Manager.";

/** Deferred writes — built first, run in phases (hours, other satellites,
 *  subtasks, the task) so a refused phase stops before anything is lost. */
type Op = () => Promise<unknown>;

/** Satellites of ONE task id: delete comments/collaborators, unlink hours,
 *  delete its never-sent draft invoice (an issued one is unlinked instead).
 *  `processedInvoices` dedupes invoices linked by BOTH taskId and projectId,
 *  so the project cascade doesn't count (or write) them twice. Hours go into
 *  `timeOps` — they run FIRST, because they are the writes the rules most
 *  often refuse (someone else's row / a closed month). */
async function cascadeOneTask(
  taskId: string,
  businessId: string,
  summary: TaskCascadeSummary,
  ops: Op[],
  processedInvoices: Set<string>,
  timeOps: Op[],
) {
  const [commentsSnap, collaboratorsSnap, timeSnap, invoicesSnap, dependantsSnap, chatSnap] = await Promise.all([
    getDocs(scoped('taskComments', businessId, 'taskId', taskId)),
    getDocs(scoped('taskCollaborators', businessId, 'taskId', taskId)),
    getDocs(scoped('timeEntries', businessId, 'taskId', taskId)),
    getDocs(scoped('invoices', businessId, 'taskId', taskId)),
    getDocs(query(collection(db, 'tasks'), where('businessId', '==', businessId), where('dependsOn', 'array-contains', taskId))),
    // The task's chat thread (`messages` with `taskId`, business-scoped so the
    // list is provable). A denied read here must not block the delete — the
    // rows then stay behind as before, which is the lesser evil — so it is the
    // one lookup that degrades instead of throwing.
    getDocs(scoped('messages', businessId, 'taskId', taskId)).catch(err => {
      console.warn('[deleteCascade] mesazhet e detyrës nuk u lexuan dot:', err);
      return null;
    }),
  ]);
  // Tasks that were BLOCKED by this one: drop the dead id, or their 🔒 chip
  // keeps pointing at nothing ("S'mund të përfundohet para varësisë" for a
  // task that no longer exists).
  ops.push(...dependantsSnap.docs.map(d => () => updateDoc(d.ref, { dependsOn: arrayRemove(taskId), updatedAt: new Date() })));
  summary.comments += commentsSnap.size;
  summary.collaborators += collaboratorsSnap.size;
  summary.timeEntriesUnlinked += timeSnap.size;
  ops.push(...commentsSnap.docs.map(d => () => deleteDoc(d.ref)));
  ops.push(...collaboratorsSnap.docs.map(d => () => deleteDoc(d.ref)));
  // Chat rows are meaningless without their task (and an orphan with
  // `isRead: false` sits in the group-unread window forever).
  if (chatSnap) {
    summary.chatMessages += chatSnap.size;
    ops.push(...chatSnap.docs.map(d => () => deleteDoc(d.ref)));
  }
  // Hours are payroll history: unlink the dead task, keep the row (and its
  // projectId — the project cascade clears that separately when relevant).
  // A RUNNING entry (endTime null/missing) is stopped first: the task panel was
  // the only stop UI and it disappears with the task, so an unlinked running
  // entry would tick invisibly forever and count 0 in every total.
  for (const d of timeSnap.docs) {
    const entry = d.data() as { endTime?: unknown; startTime?: any };
    const running = entry.endTime === null || entry.endTime === undefined;
    if (running && entry.startTime) {
      const start = entry.startTime?.toDate ? entry.startTime.toDate() : new Date(entry.startTime);
      const end = new Date();
      const duration = isNaN(start.getTime()) ? 0 : Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
      timeOps.push(() => updateDoc(d.ref, { taskId: '', endTime: end, duration, updatedAt: end }));
    } else {
      timeOps.push(() => updateDoc(d.ref, { taskId: '', updatedAt: new Date() }));
    }
  }
  for (const d of invoicesSnap.docs) {
    if (processedInvoices.has(d.id)) continue;
    processedInvoices.add(d.id);
    const inv = d.data() as { status?: string; autoGenerated?: boolean };
    if (inv.status === 'Draft' && inv.autoGenerated) {
      summary.draftInvoicesDeleted += 1;
      // Its line items go with it, or they'd dangle on a dead invoiceId.
      const itemsSnap = await getDocs(scoped('invoiceItems', businessId, 'invoiceId', d.id));
      ops.push(...itemsSnap.docs.map(i => () => deleteDoc(i.ref)));
      ops.push(() => deleteDoc(d.ref));
    } else {
      summary.invoicesUnlinked += 1;
      ops.push(() => updateDoc(d.ref, { taskId: '', updatedAt: new Date() }));
    }
  }
}

/** Run one phase; returns how many writes were refused. */
async function runPhase(ops: Op[]): Promise<number> {
  const results = await Promise.allSettled(ops.map(op => op()));
  return results.filter(r => r.status === 'rejected').length;
}

/** The tenant of the task ITSELF — the active business is only a fallback. A
 *  task opened from another context (super-admin, a stale business switch) must
 *  have its satellites looked up in ITS business, or the scoped queries find
 *  nothing and the cascade silently degrades into a bare delete. */
async function taskBusinessId(taskId: string, explicit?: string | null): Promise<string | null> {
  try {
    const snap = await getDoc(docRef('tasks', taskId));
    const bid = snap.exists() ? (snap.data() as { businessId?: unknown }).businessId : undefined;
    if (typeof bid === 'string' && bid) return bid;
  } catch { /* unreadable — fall back */ }
  return explicit || getGlobalBusinessId() || null;
}

/**
 * Delete one task AND everything that is meaningless without it: its subtasks,
 * their comments/collaborator records, its draft auto-invoice; unlink logged
 * hours. Returns what happened so the caller can toast the blast radius.
 */
export async function deleteTaskCascade(
  taskId: string,
  opts?: { businessId?: string | null },
): Promise<TaskCascadeSummary> {
  const businessId = await taskBusinessId(taskId, opts?.businessId);
  const summary = emptySummary();
  if (!businessId) {
    // No tenant context — fall back to the bare delete rather than doing nothing.
    await deleteDoc(docRef('tasks', taskId));
    summary.tasks = 1;
    return summary;
  }

  // One level of nesting is all the UI can create, so one subtask query suffices.
  const subtasksSnap = await getDocs(scoped('tasks', businessId, 'parentTaskId', taskId));
  const allIds = [taskId, ...subtasksSnap.docs.map(d => d.id)];

  const ops: Op[] = [];
  const timeOps: Op[] = [];
  const processedInvoices = new Set<string>();
  for (const id of allIds) {
    await cascadeOneTask(id, businessId, summary, ops, processedInvoices, timeOps);
  }
  // Satellites first, tasks last — and every phase must COMPLETE before the
  // next one starts. A refused write throws with the task (and whatever is
  // left) still in place, so the cascade can simply be re-run; rows already
  // unlinked/deleted stay so, which is idempotent.
  //
  // Phase 1 — hours (the write the rules most often refuse: a colleague's row,
  // or a row inside a closed month).
  if (await runPhase(timeOps)) throw new Error(TIME_ENTRIES_UNLINK_DENIED);

  // Phase 2 — comments, collaborators, dependants, draft invoices.
  const satelliteFailed = await runPhase(ops);
  if (satelliteFailed) {
    throw new Error(`${satelliteFailed} veprime lidhëse dështuan — detyra nuk u fshi; provo sërish ose kërko një Admin/Manager.`);
  }

  // Phase 3 — subtasks; one that survives keeps its parent (the parent's panel
  // is the only place a subtask is reachable from).
  const subtaskResults = await Promise.allSettled(subtasksSnap.docs.map(d => deleteDoc(d.ref)));
  summary.tasks += subtaskResults.filter(r => r.status === 'fulfilled').length;
  const failedSubtasks = subtaskResults.filter(r => r.status === 'rejected').length;
  if (failedSubtasks) {
    throw new Error(`${failedSubtasks} nën-detyra nuk u fshinë dot — detyra nuk u fshi; provo sërish.`);
  }

  // The main task delete must THROW on failure — a caller that toasts "u fshi"
  // off a settled rejection would be reporting success for a task still there.
  await deleteDoc(docRef('tasks', taskId));
  summary.tasks += 1;
  return summary;
}

function docRef(col: string, id: string) {
  return docRefOf(db, col, id);
}

export interface ProjectCascadeSummary extends TaskCascadeSummary {
  expensesUnlinked: number;
  projectComments: number;
}

/**
 * Delete a project the honest way: remove what is meaningless without it
 * (tasks + their satellites, project comments, never-sent draft auto-invoices)
 * and UNLINK what must survive (issued invoices, expenses, logged hours).
 */
export async function deleteProjectCascade(
  project: { id: string; name: string },
  opts?: {
    businessId?: string | null;
    /**
     * May the caller read Salary rows (Admin/Manager/Owner — the predicate
     * ExpensesView uses)? Rules are not filters: a non-approver's expense list
     * MUST carry `category != 'Salary'` or it is denied outright — and that
     * clause also drops rows with NO category, which then keep a dangling
     * projectId. An approver's list is unconstrained, so every row of the
     * project (uncategorised and Salary alike) is unlinked. Unset = the
     * non-approver query, which is provable for everyone.
     */
    isExpenseApprover?: boolean;
  },
): Promise<ProjectCascadeSummary> {
  const businessId = opts?.businessId ?? getGlobalBusinessId();
  const summary: ProjectCascadeSummary = { ...emptySummary(), expensesUnlinked: 0, projectComments: 0 };
  if (!businessId) throw new Error('deleteProjectCascade: missing businessId');

  const [tasksSnap, invoicesSnap, expensesSnap, timeSnap, commentsSnap] = await Promise.all([
    getDocs(scoped('tasks', businessId, 'projectId', project.id)),
    getDocs(scoped('invoices', businessId, 'projectId', project.id)),
    // Same shape as `expenseListQueryOptions(isApprover)` (finance/expenseSeries.ts):
    // approver → plain read; otherwise `category != 'Salary'`, the only
    // provable non-approver list (it cannot express "no category OR not Salary").
    getDocs(opts?.isExpenseApprover
      ? scoped('expenses', businessId, 'projectId', project.id)
      : query(scoped('expenses', businessId, 'projectId', project.id), where('category', '!=', 'Salary'))),
    getDocs(scoped('timeEntries', businessId, 'projectId', project.id)),
    getDocs(scoped('projectComments', businessId, 'projectId', project.id)),
  ]);

  const ops: Op[] = [];
  const timeOps: Op[] = [];
  const processedInvoices = new Set<string>();

  // Task satellites (comments, collaborator records, per-task draft invoices).
  for (const t of tasksSnap.docs) {
    await cascadeOneTask(t.id, businessId, summary, ops, processedInvoices, timeOps);
  }

  // Project comments are meaningless without the project.
  summary.projectComments = commentsSnap.size;
  ops.push(...commentsSnap.docs.map(d => () => deleteDoc(d.ref)));

  // A draft auto-generated invoice was never sent and has no accounting value;
  // everything else is an accounting document — unlink it and say why.
  // (Invoices linked by BOTH taskId and projectId were already handled above.)
  for (const d of invoicesSnap.docs) {
    if (processedInvoices.has(d.id)) continue;
    processedInvoices.add(d.id);
    const inv = d.data() as { status?: string; autoGenerated?: boolean; notes?: string };
    if (inv.status === 'Draft' && inv.autoGenerated) {
      summary.draftInvoicesDeleted += 1;
      const itemsSnap = await getDocs(scoped('invoiceItems', businessId, 'invoiceId', d.id));
      ops.push(...itemsSnap.docs.map(i => () => deleteDoc(i.ref)));
      ops.push(() => deleteDoc(d.ref));
    } else {
      summary.invoicesUnlinked += 1;
      ops.push(() => updateDoc(d.ref, {
        projectId: '',
        taskId: '',
        notes: `${inv.notes ? `${inv.notes}\n` : ''}[Projekti "${project.name}" u fshi më ${new Date().toLocaleDateString('sq-AL')} — fatura u shkëputur.]`,
      }));
    }
  }

  // Costs & hours survive, unlinked (payroll and accounting history).
  summary.expensesUnlinked = expensesSnap.size;
  ops.push(...expensesSnap.docs.map(d => () => updateDoc(d.ref, { projectId: '', updatedAt: new Date() })));
  summary.timeEntriesUnlinked += timeSnap.size;
  timeOps.push(...timeSnap.docs.map(d => () => updateDoc(d.ref, { projectId: '', taskId: '', updatedAt: new Date() })));

  // Hours first: a row the caller may not unlink stops the cascade before any
  // task is deleted (same law as deleteTaskCascade).
  if (await runPhase(timeOps)) throw new Error(TIME_ENTRIES_UNLINK_DENIED);

  // allSettled, not all: one denied write must not abort the rest and leave a
  // half-detached project behind.
  const satelliteFailed = await runPhase(ops);
  summary.failed += satelliteFailed;
  // A refused satellite keeps the tasks and the project: deleting them would
  // leave comments/invoices pointing at nothing with no surface to re-run from.
  if (satelliteFailed) {
    throw new Error(`${satelliteFailed} veprime lidhëse dështuan — projekti nuk u fshi; provo sërish ose kërko një Admin/Manager.`);
  }

  const taskResults = await Promise.allSettled(tasksSnap.docs.map(d => deleteDoc(d.ref)));
  summary.tasks = taskResults.filter(r => r.status === 'fulfilled').length;
  const failedTasks = taskResults.filter(r => r.status === 'rejected').length;
  summary.failed += failedTasks;

  // The project itself goes LAST, and ONLY when its tasks actually went: the
  // project page is the sole surface from which this cascade can be re-run, so
  // deleting it over failed task deletes would strand orphans forever.
  if (failedTasks > 0) {
    throw new Error(`${failedTasks} detyra nuk u fshinë dot — projekti nuk u prek; provo sërish.`);
  }
  await deleteDoc(docRef('projects', project.id));
  return summary;
}

/** Toast description parts for a project cascade — shared by both views. */
export function projectCascadeToastParts(s: ProjectCascadeSummary): string[] {
  const parts: string[] = [];
  if (s.tasks) parts.push(`${s.tasks} detyra u fshinë`);
  if (s.draftInvoicesDeleted) parts.push(`${s.draftInvoicesDeleted} fatura draft u fshinë`);
  if (s.invoicesUnlinked) parts.push(`${s.invoicesUnlinked} fatura u shkëputën (nuk u fshinë)`);
  const unlinkedCost = s.expensesUnlinked + s.timeEntriesUnlinked;
  if (unlinkedCost) parts.push(`${unlinkedCost} shpenzime/orë u shkëputën`);
  if (s.failed) parts.push(`${s.failed} veprime dështuan`);
  return parts;
}
