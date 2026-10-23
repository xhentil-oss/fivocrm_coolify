import React, { useMemo, useRef } from 'react';
import { Check, FolderOpen, Search } from 'lucide-react';
import { collection, getDocs, query as fsQuery, where as fsWhere } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useMutation, getGlobalBusinessId } from '../../../hooks/useFirestore';
import { useAuth } from '../../../contexts/AuthContext';
import { usePermissions } from '../../../contexts/PermissionsContext';
import { useActivityLogger } from '../../../hooks/useActivityLogger';
import { taskDeepLink } from '../../../lib/deepLinks';
import { Input } from '../../ui/input';
import type { Task } from '../../../types';
import { IconTile, RowDivider, SheetRow, hashColor, pillCls, rowBodyCls } from './panelShared';
import { assigneeSeenLabel, assigneeSeenMs, receiptTimeLabel, reassignPatch } from '../../../lib/taskReceipts';

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

/** "Projekti" + "Caktuar te" rows (Detajet card) — a tap opens the inline
 *  pill options under the row (search box once the list grows). */
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
    // A new assignee has not seen it yet — the old "Parë" mark is cleared.
    await onUpdate(task.id, reassignPatch(task, newUserId));
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

  // One member as an inline pill option (design: 40px pills under the row).
  const memberOption = (uid: string, email: string | undefined, isYou: boolean) => {
    const name = isYou ? (user?.displayName || 'Ti') : getUserDisplayName(uid);
    const n = activeCountOf(uid);
    const on = task.assignedToUserId === uid;
    return (
      <button
        key={uid}
        type="button"
        onClick={() => assignTo(uid)}
        title={email ? `${email} · ${n} detyra aktive` : `${n} detyra aktive`}
        className={`${pillCls(on)} max-w-full gap-2 pl-1.5`}
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold ${on ? 'bg-primary-foreground/20 text-primary-foreground' : 'text-white'}`}
          style={on ? undefined : { background: hashColor(name) }}
        >
          {name.slice(0, 2).toUpperCase()}
        </span>
        <span className="truncate">{name}</span>
        {isYou && <span className={`shrink-0 rounded-[5px] px-1.5 py-px text-[9.5px] font-extrabold ${on ? 'bg-primary-foreground/20' : 'bg-primary/10 text-primary'}`}>Ti</span>}
        <span className={`shrink-0 text-[11px] font-semibold ${on ? 'text-primary-foreground/80' : loadToneOf(n)}`}>{n}</span>
        {on && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.6} />}
      </button>
    );
  };

  // Inline search box shown above long option lists (the design's pills alone
  // stop scaling past a handful of projects/people).
  const searchBox = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <div className="mb-1 flex w-full items-center gap-2 rounded-full border border-border bg-muted px-3.5">
      <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full min-w-[40px] bg-transparent text-[14px] font-medium text-foreground outline-none placeholder:text-muted-foreground/70"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} className="shrink-0 text-[11px] text-muted-foreground">✕</button>
      )}
    </div>
  );

  const seenMs = task.assignedToUserId && task.assignedToUserId !== user?.uid ? assigneeSeenMs(task) : null;
  const showSeen = !!task.assignedToUserId && task.assignedToUserId !== user?.uid;

  return (
    <>
      {/* Projekti */}
      <SheetRow
        tile={<IconTile tone="brand"><FolderOpen className="h-[17px] w-[17px]" strokeWidth={2} /></IconTile>}
        label="Projekti"
        value={
          <span className="inline-flex max-w-full items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: currentProject ? hashColor(currentProject.name) : '#C3CEDD' }} />
            <span className="truncate">{projectsLoading ? 'Duke ngarkuar…' : (currentProject?.name || 'Pa projekt')}</span>
          </span>
        }
        valueClassName={`text-[15px] ${currentProject ? 'text-foreground/80' : 'text-muted-foreground'}`}
        open={projectOpen}
        disabled={readOnly}
        onToggle={() => { closeStatus(); setAssignOpen(false); setProjectQuery(''); setProjectOpen(v => !v); }}
      />
      {projectOpen && !readOnly && (
        <div className={rowBodyCls} onClick={(e) => e.stopPropagation()}>
          {projects.length > 6 && searchBox(projectQuery, setProjectQuery, 'Kërko projektin…')}
          {projectOptions.length === 0 && (
            <div className="w-full py-2 text-center text-xs text-muted-foreground">Asnjë projekt nuk përputhet me "{projectQuery}"</div>
          )}
          {projectOptions.map(p => {
            const on = (task.projectId || '') === p.id;
            return (
              <button
                key={p.id || '__none__'}
                type="button"
                onClick={() => changeProject(p.id)}
                title={p.sub || undefined}
                className={`${pillCls(on)} max-w-full gap-2`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: on ? 'currentColor' : p.dot }} />
                <span className="truncate">{p.name}</span>
                {p.sub && <span className={`shrink-0 text-[11px] font-semibold ${on ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{p.sub.split(' ')[0]}</span>}
              </button>
            );
          })}
        </div>
      )}

      <RowDivider />

      {/* Caktuar te */}
      <SheetRow
        tile={
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-white" style={{ background: task.assignedToUserId ? hashColor(assigneeName) : '#C3CEDD' }}>
            {task.assignedToUserId ? assigneeName.slice(0, 2).toUpperCase() : '?'}
          </span>
        }
        label="Caktuar te"
        value={
          <span className="flex flex-col items-end gap-0.5">
            <span className={`truncate text-[15px] ${task.assignedToUserId ? 'text-foreground/80' : 'text-muted-foreground'}`}>{assigneeName}</span>
            {/* "Parë 14:32" / "Pa parë ende" — for the assigner and everyone else
                (the assignee themselves just opened it). */}
            {showSeen && (
              <span
                title={seenMs !== null ? `${assigneeName} e hapi detyrën ${receiptTimeLabel(seenMs)}` : `${assigneeName} nuk e ka hapur ende detyrën`}
                className={`text-[12px] ${seenMs !== null ? 'text-sky-600 dark:text-sky-400' : 'text-muted-foreground'}`}
              >
                {seenMs !== null ? '✓✓ ' : ''}{assigneeSeenLabel(task)}
              </span>
            )}
          </span>
        }
        valueClassName="text-right"
        open={assignOpen}
        disabled={readOnly}
        onToggle={() => { closeStatus(); setProjectOpen(false); setAssignQuery(''); setAssignOpen(v => !v); }}
      />
      {assignOpen && !readOnly && (
        <div className={`${rowBodyCls} flex-col items-stretch`} onClick={(e) => e.stopPropagation()}>
          {(teamMembers || []).length > 6 && searchBox(assignQuery, setAssignQuery, 'Kërko anëtarin…')}
          <div className="flex flex-wrap gap-2">
            {showSelfOption && user && memberOption(user.uid, user.email || undefined, true)}
            {permissions.canAssignTasks && assignMembers.map((m: any) => memberOption(m.userId, m.email, false))}
          </div>
          {!permissions.canAssignTasks && (
            <div className="text-[13px] leading-relaxed text-muted-foreground">
              Roli yt cakton detyra vetëm për vete. Lejen «Cakto detyra te të tjerët» e jep një admin te Ekipet → Ndrysho Lejet.
            </div>
          )}
          {!showSelfOption && permissions.canAssignTasks && assignMembers.length === 0 && (
            <div className="py-2 text-center text-xs text-muted-foreground">Asnjë anëtar nuk përputhet me "{assignQuery}"</div>
          )}
          {permissions.canAssignTasks && (
            <div className="mt-1 border-t border-border pt-2">
              <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Ose shkruaj User ID:</p>
              <Input
                placeholder="User ID…"
                className="h-9 rounded-full text-xs"
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
        </div>
      )}
    </>
  );
};

export default TaskPeopleRows;
