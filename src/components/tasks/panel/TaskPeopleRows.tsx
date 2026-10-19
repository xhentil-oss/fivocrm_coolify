import React, { useMemo, useRef } from 'react';
import { Check } from 'lucide-react';
import { collection, getDocs, query as fsQuery, where as fsWhere } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useMutation, getGlobalBusinessId } from '../../../hooks/useFirestore';
import { useAuth } from '../../../contexts/AuthContext';
import { usePermissions } from '../../../contexts/PermissionsContext';
import { useActivityLogger } from '../../../hooks/useActivityLogger';
import { taskDeepLink } from '../../../lib/deepLinks';
import { Input } from '../../ui/input';
import type { Task } from '../../../types';
import { PickerPanel, hashColor, rowCls, rowLabelCls } from './panelShared';

interface TaskPeopleRowsProps {
  task: Task;
  readOnly: boolean;
  projects: { id: string; name: string; status?: string }[];
  projectsLoading: boolean;
  allTasks?: Task[];
  subtasks: Task[] | undefined | null;
  teamMembers: any[];
  getUserDisplayName: (userId: string) => string;
  onUpdate: (id: string, data: any) => Promise<any>;
  // Picker state lives in the panel: a click anywhere on it closes every picker.
  projectOpen: boolean;
  setProjectOpen: React.Dispatch<React.SetStateAction<boolean>>;
  projectQuery: string;
  setProjectQuery: (q: string) => void;
  assignOpen: boolean;
  setAssignOpen: React.Dispatch<React.SetStateAction<boolean>>;
  assignQuery: string;
  setAssignQuery: (q: string) => void;
  /** Closes the status menu (opening one picker closes the others). */
  closeStatus: () => void;
}

/** "Projekti" + "Caktuar te" rows with their searchable pickers. */
const TaskPeopleRows: React.FC<TaskPeopleRowsProps> = ({
  task,
  readOnly,
  projects,
  projectsLoading,
  allTasks,
  subtasks,
  teamMembers,
  getUserDisplayName,
  onUpdate,
  projectOpen,
  setProjectOpen,
  projectQuery,
  setProjectQuery,
  assignOpen,
  setAssignOpen,
  assignQuery,
  setAssignQuery,
  closeStatus,
}) => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const logActivity = useActivityLogger();
  const taskMutation = useMutation<Task>('tasks');
  const notificationMutation = useMutation<any>('notifications');
  const commentMutation = useMutation<any>('taskComments');
  const manualInputRef = useRef<string>('');

  // Reassign — notifies the new assignee AND the previous one, and logs, exactly
  // like the old popover handlers did.
  const assignTo = async (newUserId: string) => {
    setAssignOpen(false);
    setAssignQuery('');
    const prevAssignee = task.assignedToUserId;
    if (!newUserId || newUserId === prevAssignee) return;
    await onUpdate(task.id, { assignedToUserId: newUserId });
    const link = taskDeepLink(task.id, task.projectId);
    if (newUserId !== user?.uid) {
      await notificationMutation.create({
        userId: newUserId,
        type: 'task_assigned',
        title: 'Detyrë e Re e Caktuar',
        message: `${user?.displayName || 'Dikush'} ju caktoi detyrën: ${task.title}`,
        isRead: false,
        actionUrl: link,
        actionLabel: 'Shiko Detyrën',
      }).catch(err => console.error('[Notifications] task_assigned dërgim dështoi:', err));
    }
    if (prevAssignee && prevAssignee !== newUserId && prevAssignee !== user?.uid) {
      await notificationMutation.create({
        userId: prevAssignee,
        type: 'task_assigned',
        title: 'Detyrë e Ri-caktuar',
        message: `Detyra "${task.title}" u ri-caktua te ${getUserDisplayName(newUserId)}`,
        isRead: false,
        actionUrl: link,
        actionLabel: 'Shiko Detyrën',
      }).catch(err => console.error('[Notifications] task_assigned dërgim dështoi:', err));
    }
    logActivity('update' as any, `Detyra "${task.title}" u ri-caktua`, {
      description: `Nga: ${prevAssignee || 'Pa caktuar'} → Te: ${newUserId}`,
      entityType: 'task',
      entityId: task.id,
    });
  };

  const changeProject = async (pid: string) => {
    setProjectOpen(false);
    setProjectQuery('');
    if ((task.projectId || '') === pid) return;
    // customerId RIDES on the project (it is what grants the portal client read
    // access to the task) — it must be re-derived on every move, or the OLD
    // project's client keeps seeing a task that now belongs to another client.
    // '' (not undefined — the mutation layer strips undefined) clears it when
    // the new project has no customer or the task leaves projects altogether.
    const newProject = pid ? projects.find(p => p.id === pid) : undefined;
    const patch = { projectId: pid || null, customerId: (newProject as any)?.customerId || '' };
    await onUpdate(task.id, patch as any);
    // Subtasks ride along: they carry the parent's projectId/customerId, and
    // leaving them behind keeps the OLD client's portal read access alive (and
    // deleting the old project later would cascade-delete them).
    await Promise.allSettled(
      (subtasks || []).map(st => taskMutation.update(st.id, patch as any)),
    );
    // Client-VISIBLE comments carry the client's customerId too (it is what the
    // portal's `customerId == mine` query and the rules key on). Left behind,
    // the OLD client kept reading the discussion of a task that is no longer
    // theirs. Only comments that already HAVE a customerId are touched — an
    // internal comment must never become visible by a move. Best effort: the
    // move itself is already saved.
    void repointClientComments([task.id, ...(subtasks || []).map(st => st.id)], patch.customerId || null);
  };

  const repointClientComments = async (taskIds: string[], customerId: string | null) => {
    const businessId = (task as any).businessId || getGlobalBusinessId();
    // businessId makes the list provable for staff under the rules (rules are
    // not filters) — without it the query is denied outright.
    if (!businessId || taskIds.length === 0) return;
    try {
      const chunks: string[][] = [];
      for (let i = 0; i < taskIds.length; i += 30) chunks.push(taskIds.slice(i, i + 30));
      const snaps = await Promise.all(chunks.map(ids => getDocs(fsQuery(
        collection(db, 'taskComments'),
        fsWhere('businessId', '==', businessId),
        fsWhere('taskId', 'in', ids),
      ))));
      const toUpdate = snaps.flatMap(s => s.docs).filter(d => {
        const cur = (d.data() as any).customerId;
        return !!cur && cur !== customerId;
      });
      const results = await Promise.allSettled(
        toUpdate.map(d => commentMutation.update(d.id, { customerId } as any)),
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed) console.warn(`[Tasks] ${failed} komente të dukshme për klientin nuk u ri-lidhën me klientin e ri`);
    } catch (err) {
      console.warn('[Tasks] ri-lidhja e komenteve të klientit dështoi:', err);
    }
  };

  // Open-task counts per assignee and per project, in ONE pass over allTasks
  // (the pickers used to filter the whole list once per option).
  const { openByAssignee, openByProject } = useMemo(() => {
    const byAssignee = new Map<string, number>();
    const byProject = new Map<string, number>();
    for (const t of allTasks || []) {
      if (t.status === 'Done') continue;
      if (t.assignedToUserId) byAssignee.set(t.assignedToUserId, (byAssignee.get(t.assignedToUserId) || 0) + 1);
      if (t.projectId) byProject.set(t.projectId, (byProject.get(t.projectId) || 0) + 1);
    }
    return { openByAssignee: byAssignee, openByProject: byProject };
  }, [allTasks]);

  // Assignee load: open tasks per person — colours match the create form's bars.
  // (A falsy id falls back to the literal scan — it never hits the map.)
  const activeCountOf = (uid: string) => uid
    ? openByAssignee.get(uid) || 0
    : (allTasks || []).filter(t => t.assignedToUserId === uid && t.status !== 'Done').length;
  const loadToneOf = (n: number) => (n >= 8 ? 'text-red-600 dark:text-red-400' : n >= 6 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground');

  const currentProject = projects.find(p => p.id === task.projectId);

  const pq = projectQuery.trim().toLowerCase();
  const projectOptions = [
    { id: '', name: 'Pa projekt', dot: '#C3CEDD', sub: '' },
    ...projects.map(p => {
      const n = p.id
        ? openByProject.get(p.id) || 0
        : (allTasks || []).filter(t => t.projectId === p.id && t.status !== 'Done').length;
      return { id: p.id, name: p.name, dot: hashColor(p.name), sub: n > 0 ? `${n} detyra aktive` : '' };
    }),
  ].filter(o => !pq || o.name.toLowerCase().includes(pq));

  const aq = assignQuery.trim().toLowerCase();
  const assignMembers = (teamMembers || [])
    .filter((m: any) => m.userId !== user?.uid)
    .filter((m: any) => {
      if (!aq) return true;
      const nm = getUserDisplayName(m.userId).toLowerCase();
      return nm.includes(aq) || (m.email || '').toLowerCase().includes(aq);
    });
  const showSelfOption = !!user && (!aq || (user.displayName || '').toLowerCase().includes(aq) || (user.email || '').toLowerCase().includes(aq));
  const assigneeName = getUserDisplayName(task.assignedToUserId || '') || 'Pa caktuar';

  const memberOption = (uid: string, email: string | undefined, isYou: boolean) => {
    const name = isYou ? (user?.displayName || 'Ti') : getUserDisplayName(uid);
    const n = activeCountOf(uid);
    const on = task.assignedToUserId === uid;
    return (
      <button
        key={uid}
        type="button"
        onClick={() => assignTo(uid)}
        className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-muted max-sm:min-h-[52px] ${on ? 'bg-primary/10' : ''}`}
      >
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold text-white" style={{ background: hashColor(name) }}>
          {name.slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
            <span className="truncate">{name}</span>
            {isYou && <span className="shrink-0 rounded-[5px] bg-primary/10 px-1.5 py-px text-[9.5px] font-extrabold text-primary">Ti</span>}
          </span>
          {email && <span className="mt-px block truncate text-[11px] text-muted-foreground">{email}</span>}
        </span>
        <span title="Detyra aktive" className={`shrink-0 whitespace-nowrap text-[10.5px] font-semibold ${loadToneOf(n)}`}>{n} aktive</span>
        {on && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
      </button>
    );
  };

  return (
    <>
      {/* Projekti */}
      <div className={rowCls}>
        <span className={rowLabelCls}>Projekti</span>
        <div className="relative max-w-full justify-self-start">
          <button
            type="button"
            disabled={readOnly}
            onClick={(e) => { e.stopPropagation(); closeStatus(); setAssignOpen(false); setProjectQuery(''); setProjectOpen(v => !v); }}
            className={`flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 transition-colors disabled:cursor-default ${projectOpen ? 'border-primary bg-primary/10' : 'border-border bg-background hover:border-primary/50'}`}
          >
            <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: currentProject ? hashColor(currentProject.name) : '#C3CEDD' }} />
            <span className="truncate text-[13px] font-bold text-foreground">
              {projectsLoading ? 'Duke ngarkuar…' : (currentProject?.name || 'Pa projekt')}
            </span>
            {!readOnly && <span className="text-[10px] text-muted-foreground">{projectOpen ? '▲' : '▼'}</span>}
          </button>
          {projectOpen && (
            <PickerPanel
              title="Zgjidh projektin"
              searchPlaceholder="Kërko projektin…"
              query={projectQuery}
              onQuery={setProjectQuery}
              onClose={() => { setProjectOpen(false); setProjectQuery(''); }}
            >
              {projectOptions.length === 0 && (
                <div className="px-3 py-5 text-center text-xs text-muted-foreground">Asnjë projekt nuk përputhet me "{projectQuery}"</div>
              )}
              {projectOptions.map(p => (
                <button
                  key={p.id || '__none__'}
                  type="button"
                  onClick={() => changeProject(p.id)}
                  className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-muted max-sm:min-h-[52px] ${(task.projectId || '') === p.id ? 'bg-primary/10' : ''}`}
                >
                  <span className="h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: p.dot }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-foreground">{p.name}</span>
                    {p.sub && <span className="mt-px block text-[11px] text-muted-foreground">{p.sub}</span>}
                  </span>
                  {(task.projectId || '') === p.id && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
              ))}
            </PickerPanel>
          )}
        </div>
      </div>

      {/* Caktuar te */}
      <div className={rowCls}>
        <span className={rowLabelCls}>Caktuar te</span>
        <div className="relative max-w-full justify-self-start">
          <button
            type="button"
            disabled={readOnly}
            onClick={(e) => { e.stopPropagation(); closeStatus(); setProjectOpen(false); setAssignQuery(''); setAssignOpen(v => !v); }}
            className={`flex max-w-full items-center gap-2 rounded-full border py-1 pl-1 pr-3 transition-colors disabled:cursor-default ${assignOpen ? 'border-primary bg-primary/10' : 'border-border bg-background hover:border-primary/50'}`}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold text-white" style={{ background: hashColor(assigneeName) }}>
              {assigneeName.slice(0, 2).toUpperCase()}
            </span>
            <span className="truncate text-[13.5px] font-bold text-foreground">{assigneeName}</span>
            {!readOnly && <span className="text-[10px] text-muted-foreground">{assignOpen ? '▲' : '▼'}</span>}
          </button>
          {assignOpen && (
            <PickerPanel
              title="Cakto anëtarin"
              searchPlaceholder="Kërko anëtarin…"
              query={assignQuery}
              onQuery={setAssignQuery}
              onClose={() => { setAssignOpen(false); setAssignQuery(''); }}
            >
              {showSelfOption && user && (
                <>
                  <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">Përdoruesi aktual</div>
                  {memberOption(user.uid, user.email || undefined, true)}
                </>
              )}
              {permissions.canAssignTasks && assignMembers.length > 0 && (
                <div className="px-2.5 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">Anëtarët e ekipit</div>
              )}
              {permissions.canAssignTasks && assignMembers.map((m: any) => memberOption(m.userId, m.email, false))}
              {!permissions.canAssignTasks && (
                <div className="px-3 py-3 text-center text-[11px] leading-relaxed text-muted-foreground">
                  Roli yt cakton detyra vetëm për vete. Lejen «Cakto detyra te të tjerët» e jep një admin te Ekipet → Ndrysho Lejet.
                </div>
              )}
              {!showSelfOption && permissions.canAssignTasks && assignMembers.length === 0 && (
                <div className="px-3 py-5 text-center text-xs text-muted-foreground">Asnjë anëtar nuk përputhet me "{assignQuery}"</div>
              )}
              {permissions.canAssignTasks && (
                <div className="mt-1 border-t px-2.5 pb-1 pt-2">
                  <p className="mb-1 text-[10px] font-semibold text-muted-foreground">Ose shkruaj User ID:</p>
                  <Input
                    placeholder="User ID…"
                    className="h-8 text-xs"
                    defaultValue={task.assignedToUserId || ''}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const v = (e.target as HTMLInputElement).value.trim();
                        if (v) { manualInputRef.current = v; assignTo(v); }
                      }
                    }}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (manualInputRef.current === v) { manualInputRef.current = ''; return; }
                      if (v && v !== task.assignedToUserId) assignTo(v);
                    }}
                  />
                </div>
              )}
            </PickerPanel>
          )}
        </div>
      </div>
    </>
  );
};

export default TaskPeopleRows;
