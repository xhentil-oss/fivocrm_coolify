import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Users } from 'lucide-react';
import { useUniqueTeamMembers } from '../hooks/useRoleFilteredData';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { completeTask } from '../lib/recurringUtils';
import { claimTaskNextCycle, releaseTaskNextCycle } from '../lib/taskRecurrenceClaim';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { Badge } from './ui/badge';
import { taskDeepLink } from '../lib/deepLinks';
import { type MentionCandidate } from './comments/CommentEditor';
import { toast } from '../hooks/use-toast';
import { taskCompletedNotifications } from '../lib/taskNotifications';
import type { Task, TaskComment } from '../types';
import { RowDivider, cardCls, dayLabel, eyebrowCls, reopenPatchFor } from './tasks/panel/panelShared';
import { useTaskPanelDates } from './tasks/panel/useTaskPanelDates';
import TaskPanelHeader from './tasks/panel/TaskPanelHeader';
import TaskPeopleRows from './tasks/panel/TaskPeopleRows';
import { TaskDueDateRow, TaskStartDateRow } from './tasks/panel/TaskDatesSection';
import TaskReminderSection from './tasks/panel/TaskReminderSection';
import TaskRecurrenceSection from './tasks/panel/TaskRecurrenceSection';
import TaskDependenciesSection from './tasks/panel/TaskDependenciesSection';
import { TaskPriorityRow, TaskLabelsRow } from './tasks/panel/TaskPriorityLabelRows';
import TaskActivityTab from './tasks/panel/TaskActivityTab';
import TaskDescriptionSection from './tasks/panel/TaskDescriptionSection';
import TaskTimeTrackingSection from './tasks/panel/TaskTimeTrackingSection';
import TaskSubtasksSection from './tasks/panel/TaskSubtasksSection';
import TaskAttachmentsSection from './tasks/panel/TaskAttachmentsSection';
import TaskChatSection from './tasks/panel/TaskChatSection';
import TaskCommentsSection from './tasks/panel/TaskCommentsSection';
import TaskPanelFooter, { TaskDeleteDialog } from './tasks/panel/TaskPanelFooter';
import TaskClientApprovalSection from './tasks/panel/TaskClientApprovalSection';
import { usePageVisible } from '../hooks/usePageVisible';
import { shouldMarkAssigneeSeen } from '../lib/taskReceipts';
import { markAssigneeSeen } from '../lib/taskReceiptWrites';

// The panel is composed from the sections in src/components/tasks/panel/ (the
// LAYOUT CONTRACT of the Oct 2026 "Task Sheet" design lives in panelShared.tsx).
// All three mounts (TasksView, MyTasksView, ProjectDetailView) render THIS
// component with these exact props.

interface TaskDetailPanelProps {
  task: Task;
  onClose: () => void;
  onExpand?: () => void;
  isExpanded?: boolean;
  comments: TaskComment[];
  /** Returns the created comment (with its id) when the caller can provide it —
   *  that id becomes the deep link carried by the comment notifications. */
  onAddComment: (taskId: string, content: string, opts?: { visibleToClient?: boolean }) => void | Promise<any>;
  /** Comment to scroll to + flash, set when arriving from a notification. */
  focusCommentId?: string | null;
  onEditComment?: (commentId: string, content: string) => void | Promise<any>;
  onDeleteComment?: (commentId: string) => void | Promise<any>;
  onToggleReaction?: (commentId: string, emoji: string) => void | Promise<any>;
  onUpdate: (id: string, data: any) => Promise<any>;
  onDelete: (id: string) => Promise<any>;
  projects?: { id: string; name: string; status?: string }[];
  projectsLoading?: boolean;
  allTasks?: Task[];
  onSelectSubtask?: (subtask: Task) => void;
  isProjectGuest?: boolean;
}

const TaskDetailPanel: React.FC<TaskDetailPanelProps> = ({
  task,
  onClose,
  onExpand,
  isExpanded,
  comments,
  onAddComment,
  focusCommentId,
  onEditComment,
  onDeleteComment,
  onToggleReaction,
  onUpdate,
  onDelete,
  projects = [],
  projectsLoading = false,
  allTasks,
  onSelectSubtask,
  isProjectGuest = false,
}) => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const isGuestMode = permissions.isGuest || isProjectGuest;
  // Read-only for a portal/project guest AND for the Viewer role: every control
  // below used to gate on `isGuestMode` alone, so a Viewer (canEdit: false) could
  // mark Done, retitle, reassign and redate from the panel while the list hid
  // the same actions — and the rules accept any member's write.
  const readOnly = isGuestMode || !permissions.canEdit;

  // (a `showSubtasks` toggle used to live here; the collapse control it drove was
  //  removed, so the state was dead — subtasks are always shown.)
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleText, setTitleText] = useState(task.title);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionText, setDescriptionText] = useState(task.description || '');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Start/deadline state + every handler that writes them.
  const {
    startDate,
    endDate,
    handleStartDateChange,
    handleEndDateChange,
    handleStartTimeChange,
    handleEndTimeChange,
  } = useTaskPanelDates(task, onUpdate);

  // Checklist order = creation order. Without orderBy the snapshot came back in
  // document-id order (random auto-ids), so a new subtask landed anywhere.
  // (Read here: a project move carries the subtasks along — TaskPeopleRows.)
  const { data: subtasks } = useCollection<Task>('tasks', {
    where: [{ field: 'parentTaskId', operator: '==', value: task.id }],
    orderBy: { field: 'createdAt', direction: 'asc' },
  });

  const { data: taskCollaborators } = useCollection<any>('taskCollaborators', {
    where: [{ field: 'taskId', operator: '==', value: task.id }]
  });

  const { data: allActiveTimeEntries } = useCollection<any>('timeEntries', {
    where: [{ field: 'endTime', operator: '==', value: null }]
  });

  const { data: rawTeamMembers } = useCollection<any>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }]
  });
  const teamMembers = useUniqueTeamMembers(rawTeamMembers);
  // Label autocomplete: every label already used across the workspace's tasks.
  const labelSuggestions = useMemo(() => {
    const s = new Set<string>();
    (allTasks || []).forEach(t => ((t as any).labels as string[] | undefined)?.forEach(l => s.add(l)));
    return Array.from(s).sort();
  }, [allTasks]);

  const { data: userProfiles } = useCollection<any>('userProfiles');
  const { data: teams } = useCollection<any>('teams');

  const taskMutation = useMutation<Task>('tasks');
  const notificationMutation = useMutation<any>('notifications');

  // Users currently working on this task
  const activeWorkers = React.useMemo(() => {
    if (!allActiveTimeEntries) return [];
    return allActiveTimeEntries.filter(entry => entry.taskId === task.id && entry.userId !== user?.uid);
  }, [allActiveTimeEntries, task.id, user?.uid]);

  // userId → profile / member lookups. FIRST match wins, exactly like the
  // `.find()` calls they replace (called once per comment, member and option).
  const profileByUserId = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of userProfiles || []) if (!map.has(p.userId)) map.set(p.userId, p);
    return map;
  }, [userProfiles]);
  const memberByUserId = useMemo(() => {
    const map = new Map<string, any>();
    for (const m of teamMembers || []) if (!map.has(m.userId)) map.set(m.userId, m);
    return map;
  }, [teamMembers]);

  // Resolve display name for a user ID
  const getUserDisplayName = React.useCallback((userId: string) => {
    if (userId === user?.uid) return user.displayName || user.email?.split('@')[0] || 'Ti';
    const profile = profileByUserId.get(userId);
    if (profile?.displayName) return profile.displayName;
    const member = memberByUserId.get(userId);
    if (member?.displayName) return member.displayName;
    if (member?.email) return member.email.split('@')[0];
    return userId.slice(0, 12);
  }, [user, profileByUserId, memberByUserId]);

  // Build full mentionable list: teamMembers + team owners who may lack a teamMembers record
  const allMentionable = React.useMemo(() => {
    const list = [...(teamMembers || [])];
    const existingUserIds = new Set(list.map(m => m.userId));
    // Include team owners (Admin/CEO) who don't have a teamMembers entry
    if (teams) {
      for (const team of teams) {
        const ownerId = team.createdByUserId;
        if (ownerId && !existingUserIds.has(ownerId)) {
          existingUserIds.add(ownerId);
          list.push({ id: `owner-${ownerId}`, userId: ownerId, role: 'Admin', status: 'Active' });
        }
      }
    }
    return list;
  }, [teamMembers, teams]);

  // People the comment composer offers after "@" (one entry per person — a
  // member of several teams has one teamMembers row per team).
  const mentionCandidates = React.useMemo(() => {
    const byId = new Map<string, MentionCandidate>();
    for (const m of allMentionable) {
      if (!m.userId || m.userId === user?.uid || byId.has(m.userId)) continue;
      byId.set(m.userId, { id: m.userId, name: getUserDisplayName(m.userId) });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'sq'));
  }, [allMentionable, getUserDisplayName, user?.uid]);

  // Old comments stored a mention as a bare `@uid`. Show a name only when the id
  // is a known person — otherwise it is just text someone typed ("@ekipi").
  const resolveLegacyMention = (value: string) => {
    const known = allMentionable.some(m => m.userId === value) || !!userProfiles?.some(p => p.userId === value);
    return known ? getUserDisplayName(value) : null;
  };

  // "Parë": the ASSIGNEE opening the task (tab visible) stamps it once — the
  // assigner sees "Parë 14:32" in the assignee row. Guests are not staff of the
  // business (the rules would refuse it). One attempt per task+assignee per mount.
  const pageVisible = usePageVisible();
  const seenAttemptRef = useRef<string | null>(null);
  useEffect(() => {
    if (isGuestMode || !user?.uid) return;
    if (!shouldMarkAssigneeSeen(task, user.uid, { visible: pageVisible })) return;
    const key = `${task.id}:${task.assignedToUserId}`;
    if (seenAttemptRef.current === key) return;
    seenAttemptRef.current = key;
    markAssigneeSeen(task.id, user.uid).catch(err => console.warn('[Tasks] shënimi "Parë" dështoi:', err));
  }, [task, user?.uid, pageVisible, isGuestMode]);

  // Reset local edit state ONLY when switching to a different task. Keying on
  // task.title/description/dates would re-run on every live Firestore update and
  // clobber an in-progress edit (e.g. rescheduling the date while typing the
  // description would wipe the draft). The sections reset their own drafts
  // (dates, subtask form, chat draft) on the same key.
  useEffect(() => {
    setTitleText(task.title);
    setDescriptionText(task.description || '');
    setIsEditingTitle(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  // Focus title input when editing
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  const handleSaveTitle = async () => {
    if (titleText.trim() && titleText !== task.title) {
      await onUpdate(task.id, { title: titleText });
    } else {
      setTitleText(task.title);
    }
    setIsEditingTitle(false);
  };

  // ── Sheet state: status menu, "⋯" menu, ONE open row at a time ──
  const [statusOpen, setStatusOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [assignOpen, setAssignOpenRaw] = useState(false);
  const [assignQuery, setAssignQuery] = useState('');
  const [projectOpen, setProjectOpenRaw] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  // The Koha/Organizimi/Aktiviteti rows that open inline (design: a tap on a
  // row expands it under itself and folds whichever row was open).
  type SheetRowKey = 'due' | 'start' | 'remind' | 'repeat' | 'block' | 'hist';
  const [openRow, setOpenRow] = useState<SheetRowKey | null>(null);
  const toggleRow = (k: SheetRowKey) => {
    setOpenRow(prev => (prev === k ? null : k));
    setProjectOpenRaw(false); setAssignOpenRaw(false); setStatusOpen(false); setMenuOpen(false);
  };
  // The people rows keep their own open flags (they also drive the queries);
  // opening one folds every other row.
  const setProjectOpen: React.Dispatch<React.SetStateAction<boolean>> = (v) => { setOpenRow(null); setAssignOpenRaw(false); setProjectOpenRaw(v); };
  const setAssignOpen: React.Dispatch<React.SetStateAction<boolean>> = (v) => { setOpenRow(null); setProjectOpenRaw(false); setAssignOpenRaw(v); };
  const closePickers = () => { setStatusOpen(false); setAssignOpenRaw(false); setProjectOpenRaw(false); setMenuOpen(false); };

  // Header: the big title scrolls away → the header shows it + its hairline.
  const [scrolled, setScrolled] = useState(false);
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const v = e.currentTarget.scrollTop > 40;
    setScrolled(prev => (prev === v ? prev : v));
  }, []);

  // In-sheet toast ("Detyra u krijua", "Lidhja u kopjua", …) — a dark pill at
  // the top of the sheet, gone after 2.4 s.
  const [flash, setFlash] = useState<{ text: string; on: boolean }>({ text: '', on: false });
  const flashTimer = useRef<number | null>(null);
  const showFlash = useCallback((text: string) => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    setFlash({ text, on: true });
    flashTimer.current = window.setTimeout(() => setFlash(f => ({ ...f, on: false })), 2400);
  }, []);
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);

  // Status change — the completeTask flow (recurring next-cycle, blockers) is the
  // same one the old header select ran; both status dropdowns call this.
  const changeStatus = async (newStatus: string) => {
    if (newStatus === task.status) return;
    if (newStatus === 'Done') {
      const outcome = await completeTask(task, {
        createTask: (data) => taskMutation.create(data as any),
        updateTask: (id, data) => onUpdate(id, data),
        allTasks,
        // An archived/cancelled project stops the series (no next cycle).
        projects,
        claimNextCycle: claimTaskNextCycle,
        releaseNextCycle: releaseTaskNextCycle,
      });
      const freqLabel: Record<string, string> = { daily: 'ditore', weekly: 'javore', monthly: 'mujore', yearly: 'vjetore' };
      // Every non-blocked outcome ends with the task Done — tell the creator,
      // assignee and collaborators (never the actor themselves).
      if (outcome.kind !== 'blocked' && user?.uid) {
        taskCompletedNotifications(task, user.uid, user.displayName || undefined).forEach(n =>
          notificationMutation.create(n as any).catch(err => console.error('[Notifications] task_completed dërgim dështoi:', err)));
      }
      switch (outcome.kind) {
        case 'blocked':
          toast({ title: '⛔ Detyrë e Bllokuar', description: `Ka ${outcome.blockers} varësi të pakryera para se ta mbyllësh këtë.`, variant: 'destructive' });
          return;
        case 'recurring-created':
          toast({ title: '✅ Detyrë e kryer + cikli i ri!', description: `Detyra periodike ${freqLabel[task.recurringFrequency ?? ''] ?? ''} u rigjenerua automatikisht.` });
          return;
        case 'recurring-ended':
          toast({ title: '✅ Detyrë e kryer', description: 'Cikli i fundit i përsëritjes — nuk u krijua tjetër.' });
          return;
        case 'recurring-stopped':
          toast({ title: '✅ Detyrë e kryer', description: outcome.reason === 'project-archived' ? 'Projekti është i arkivuar — përsëritja ndalon derisa të kthehet nga Arkiva.' : 'Projekti është anuluar — nuk u krijua cikël tjetër.' });
          return;
        case 'error':
          console.error('[Recurring] krijimi i ciklit tjetër dështoi:', outcome.error);
          toast({ title: 'Statusi u ndryshua ✓', description: `"${task.title}" → Përfunduar` });
          return;
        default:
          toast({ title: 'Statusi u ndryshua ✓', description: `"${task.title}" → Përfunduar` });
          return;
      }
    }
    await onUpdate(task.id, { status: newStatus as Task['status'], ...reopenPatchFor(task, allTasks) });
    const labels: Record<string, string> = { Todo: 'Për të bërë', 'In Progress': 'Në progres', Review: 'Rishikim', Done: 'Përfunduar' };
    toast({ title: 'Statusi u ndryshua ✓', description: `"${task.title}" → ${labels[newStatus] ?? newStatus}` });
  };

  const currentProject = projects.find(p => p.id === task.projectId);
  const assigneeName = getUserDisplayName(task.assignedToUserId || '') || 'Pa caktuar';

  // "krijuar sot 09:40 nga ti" — the subtitle under the title (per the design).
  const createdDate = (() => {
    const raw: any = (task as any).createdAt;
    if (!raw) return null;
    const d = raw instanceof Date ? raw : raw?.toDate?.() ? raw.toDate() : new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  })();
  const justCreated = !!createdDate && Date.now() - createdDate.getTime() < 10 * 60 * 1000;
  const createdLabel = createdDate ? (() => {
    const hm = `${String(createdDate.getHours()).padStart(2, '0')}:${String(createdDate.getMinutes()).padStart(2, '0')}`;
    if (createdDate.toDateString() === new Date().toDateString()) return `sot ${hm}`;
    const months = ['jan', 'shk', 'mar', 'pri', 'maj', 'qer', 'kor', 'gus', 'sht', 'tet', 'nën', 'dhj'];
    return `${createdDate.getDate()} ${months[createdDate.getMonth()]}`;
  })() : null;
  const creatorLabel = (task as any).createdByUserId
    ? ((task as any).createdByUserId === user?.uid ? 'ti' : getUserDisplayName((task as any).createdByUserId))
    : '';
  // "Krijuar sot 14:43 nga ti" — the line under the title (the project has
  // its own row in the Detajet card).
  const subtitleText = createdLabel
    ? `Krijuar ${createdLabel}${creatorLabel ? ` nga ${creatorLabel}` : ''}`
    : (currentProject?.name || '');

  // Footer: "Ndryshuar · 22 Tet" (the document carries no updater id) — until
  // the first edit it reads "Krijuar nga …".
  const updatedDate = (() => {
    const raw: any = (task as any).updatedAt;
    if (!raw) return null;
    const d = raw instanceof Date ? raw : raw?.toDate?.() ? raw.toDate() : new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  })();
  const wasEdited = !!updatedDate && !!createdDate && updatedDate.getTime() - createdDate.getTime() > 60_000;
  const footerSummary = wasEdited && updatedDate
    ? `Ndryshuar · ${dayLabel(updatedDate)}`
    : createdDate
      ? `Krijuar${creatorLabel ? ` nga ${creatorLabel}` : ''} · ${dayLabel(createdDate)}`
      : `${assigneeName.split(' ')[0]}${endDate ? ` · ${dayLabel(endDate)}` : ''}`;

  // Typed drafts (title/description) are the only fields that do not save on
  // tap — the footer's Ruaj commits them; everything else already saved.
  const cleanedDraftDesc = descriptionText === '<p></p>' ? '' : descriptionText;
  const dirty = (titleText.trim() !== '' && titleText.trim() !== task.title)
    || (isEditingDescription && cleanedDraftDesc !== (task.description || ''));

  // "Ruaj" — commits any in-progress title/description edit and closes.
  const handleFooterSave = async () => {
    const patch: any = {};
    if (titleText.trim() && titleText.trim() !== task.title) patch.title = titleText.trim();
    if (isEditingDescription && cleanedDraftDesc !== (task.description || '')) patch.description = cleanedDraftDesc;
    if (Object.keys(patch).length > 0) await onUpdate(task.id, patch);
    onClose();
  };

  // "⋯" → Kopjo lidhjen: the same deep link the notifications carry.
  const handleCopyLink = async () => {
    setMenuOpen(false);
    const url = `${window.location.origin}${taskDeepLink(task.id, task.projectId)}`;
    try {
      await navigator.clipboard.writeText(url);
      showFlash('Lidhja u kopjua');
    } catch {
      toast({ title: 'Lidhja nuk u kopjua', description: url });
    }
  };

  // "⋯" → Dupliko detyrën: a fresh Todo with the same plan (title, dates,
  // people, labels, blockers, description) and NONE of the history — no
  // recurrence/series, reminder, receipts, approval round or billed value.
  const handleDuplicate = async () => {
    setMenuOpen(false);
    try {
      const copy: any = {
        title: `${task.title} (kopje)`,
        description: task.description || undefined,
        status: 'Todo',
        priority: task.priority,
        projectId: task.projectId || undefined,
        customerId: task.customerId || undefined,
        assignedToUserId: task.assignedToUserId || undefined,
        startDate: task.startDate || undefined,
        endDate: task.endDate || undefined,
        labels: (task as any).labels?.length ? [...(task as any).labels] : undefined,
        section: task.section || undefined,
        estimatedHours: task.estimatedHours,
        dependsOn: task.dependsOn?.length ? [...task.dependsOn] : undefined,
        serviceLabel: task.serviceLabel,
        serviceId: task.serviceId,
        dueNotificationSent: false,
      };
      await taskMutation.create(copy);
      showFlash('Detyra u duplikua');
    } catch (err: any) {
      console.error('[Tasks] duplikimi dështoi:', err);
      toast({ title: 'Detyra nuk u duplikua', description: err?.message, variant: 'destructive' });
    }
  };

  // The design flashes "Detyra u krijua" when the sheet opens on a brand-new task.
  useEffect(() => {
    if (justCreated) { const t = window.setTimeout(() => showFlash('Detyra u krijua'), 300); return () => window.clearTimeout(t); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  // Delete: manager rank or owning the task (creator/assignee) — the rules
  // accept any member's delete, so the UI must not offer more than the role is
  // meant to have.
  const canDeleteThis = !readOnly && permissions.canEdit
    && (permissions.isAdmin || permissions.isManager
        || task.createdByUserId === user?.uid || task.assignedToUserId === user?.uid);

  return (
    <>
    {/* The parents position the panel (side panel on desktop, bottom sheet on
        mobile) — the panel only brings the design's content. Header and footer
        are sticky INSIDE the scroller so their blur shows the cards beneath. */}
      <div
        className="relative flex h-full min-h-0 flex-col overflow-hidden bg-muted/40"
        onClick={closePickers}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" onScroll={handleScroll}>
          <TaskPanelHeader
            task={task}
            readOnly={readOnly}
            statusOpen={statusOpen}
            onToggleStatus={() => { setAssignOpenRaw(false); setProjectOpenRaw(false); setMenuOpen(false); setStatusOpen(v => !v); }}
            onPickStatus={(s) => { setStatusOpen(false); changeStatus(s); }}
            scrolled={scrolled}
            activeWorkersCount={activeWorkers.length}
            onExpand={onExpand}
            isExpanded={isExpanded}
            onClose={onClose}
            menuOpen={menuOpen}
            onToggleMenu={() => { setStatusOpen(false); setMenuOpen(v => !v); }}
            canDuplicate={!readOnly}
            onDuplicate={handleDuplicate}
            onCopyLink={handleCopyLink}
            canDelete={canDeleteThis}
            onRequestDelete={() => { setMenuOpen(false); setDeleteConfirm(true); }}
          />

          <div className="flex flex-col gap-6 px-4 pb-6 pt-4">
            {/* Title + created info */}
            <div className="flex flex-col gap-1.5 px-1">
              <input
                ref={titleInputRef}
                value={titleText}
                disabled={readOnly}
                onChange={(e) => setTitleText(e.target.value)}
                onBlur={handleSaveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setTitleText(task.title);
                }}
                aria-label="Titulli i detyrës"
                className="w-full border-none bg-transparent text-[28px] font-bold leading-[1.1] tracking-[-0.02em] text-foreground outline-none disabled:opacity-100 sm:text-[30px]"
              />
              {subtitleText && <div className="text-[14px] text-muted-foreground">{subtitleText}</div>}
            </div>

            {/* DETAJET — Projekti · Caktuar te */}
            <div className="flex flex-col gap-2">
              <div className={eyebrowCls}>Detajet</div>
              <div className={cardCls}>
                <TaskPeopleRows
                  task={task}
                  readOnly={readOnly}
                  projects={projects}
                  projectsLoading={projectsLoading}
                  allTasks={allTasks}
                  subtasks={subtasks}
                  teamMembers={teamMembers}
                  getUserDisplayName={getUserDisplayName}
                  onUpdate={onUpdate}
                  projectOpen={projectOpen}
                  setProjectOpen={setProjectOpen}
                  projectQuery={projectQuery}
                  setProjectQuery={setProjectQuery}
                  assignOpen={assignOpen}
                  setAssignOpen={setAssignOpen}
                  assignQuery={assignQuery}
                  setAssignQuery={setAssignQuery}
                  closeStatus={() => { setStatusOpen(false); setMenuOpen(false); }}
                />
              </div>
            </div>

            {/* KOHA — Afati · Fillimi · Kujtesë · Përsëritje */}
            <div className="flex flex-col gap-2">
              <div className={eyebrowCls}>Koha</div>
              <div className={cardCls}>
                <TaskDueDateRow
                  readOnly={readOnly}
                  endDate={endDate}
                  onDateChange={handleEndDateChange}
                  onTimeChange={handleEndTimeChange}
                  open={openRow === 'due'}
                  onToggle={() => toggleRow('due')}
                />
                <RowDivider />
                <TaskStartDateRow
                  readOnly={readOnly}
                  startDate={startDate}
                  onDateChange={handleStartDateChange}
                  onTimeChange={handleStartTimeChange}
                  open={openRow === 'start'}
                  onToggle={() => toggleRow('start')}
                />
                <RowDivider />
                <TaskReminderSection
                  task={task}
                  readOnly={readOnly}
                  endDate={endDate}
                  onUpdate={onUpdate}
                  open={openRow === 'remind'}
                  onToggle={() => toggleRow('remind')}
                />
                {(task.isRecurring || !readOnly) && <RowDivider />}
                <TaskRecurrenceSection
                  task={task}
                  readOnly={readOnly}
                  allTasks={allTasks}
                  onUpdate={onUpdate}
                  open={openRow === 'repeat'}
                  onToggle={() => toggleRow('repeat')}
                />
              </div>
            </div>

            {/* ORGANIZIMI — Prioriteti · Bllokohet nga · Etiketat */}
            <div className="flex flex-col gap-2">
              <div className={eyebrowCls}>Organizimi</div>
              <div className={cardCls}>
                <TaskPriorityRow task={task} readOnly={readOnly} onUpdate={onUpdate} />
                {(!readOnly || (task.dependsOn && task.dependsOn.length > 0)) && <RowDivider />}
                <TaskDependenciesSection
                  task={task}
                  readOnly={readOnly}
                  allTasks={allTasks}
                  onUpdate={onUpdate}
                  open={openRow === 'block'}
                  onToggle={() => toggleRow('block')}
                />
                <RowDivider />
                <TaskLabelsRow task={task} readOnly={readOnly} labelSuggestions={labelSuggestions} onUpdate={onUpdate} />
              </div>
            </div>

            {/* PËRSHKRIMI */}
            <TaskDescriptionSection
              task={task}
              readOnly={readOnly}
              isEditing={isEditingDescription}
              setIsEditing={setIsEditingDescription}
              draft={descriptionText}
              setDraft={setDescriptionText}
              onUpdate={onUpdate}
            />

            {/* AKTIVITETI (audit trail) */}
            <TaskActivityTab
              taskId={task.id}
              getUserDisplayName={getUserDisplayName}
              open={openRow === 'hist'}
              onToggle={() => toggleRow('hist')}
            />

            {/* ── Beyond the design's scope: the sections FivoCRM already had,
                   rendered as the same kind of card ── */}

            {/* Client approval (portal-visible tasks) — Prano / Kërko ndryshime in the portal */}
            {!isGuestMode && (
              <TaskClientApprovalSection
                task={task}
                readOnly={readOnly}
                onUpdate={onUpdate}
                getUserDisplayName={getUserDisplayName}
                onComplete={() => changeStatus('Done')}
              />
            )}

            {/* Collaborators */}
            {taskCollaborators && taskCollaborators.length > 0 && (
              <div className={`${cardCls} px-4 py-3.5`}>
                <h4 className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">Bashkëpunëtorët</h4>
                <div className="flex flex-wrap gap-2">
                  {taskCollaborators.map(collab => (
                    <Badge key={collab.id} variant="secondary" className="text-xs">
                      <Users className="mr-1 h-3 w-3" />
                      {getUserDisplayName(collab.userId)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Time Tracking - with live timer + entry log */}
            <TaskTimeTrackingSection task={task} allActiveTimeEntries={allActiveTimeEntries} />

            {/* Subtasks */}
            {!task.parentTaskId && (
              <TaskSubtasksSection
                task={task}
                readOnly={readOnly}
                subtasks={subtasks}
                allTasks={allTasks}
                projects={projects}
                teamMembers={teamMembers}
                getUserDisplayName={getUserDisplayName}
                onSelectSubtask={onSelectSubtask}
              />
            )}

            {/* Attachments */}
            <TaskAttachmentsSection task={task} readOnly={readOnly} onUpdate={onUpdate} />

            {/* Chat — a live conversation about this task, separate from the comment
                log. Collapsed by default: the listener only runs while it is open. */}
            <TaskChatSection taskId={task.id} getUserDisplayName={getUserDisplayName} />

            {/* Comments */}
            <TaskCommentsSection
              task={task}
              readOnly={readOnly}
              comments={comments}
              onAddComment={onAddComment}
              focusCommentId={focusCommentId}
              onEditComment={onEditComment}
              onDeleteComment={onDeleteComment}
              onToggleReaction={onToggleReaction}
              mentionCandidates={mentionCandidates}
              resolveLegacyMention={resolveLegacyMention}
              getUserDisplayName={getUserDisplayName}
            />
          </div>

          {/* Footer: "Ndryshuar · date" + Ruaj (design) */}
          <TaskPanelFooter
            readOnly={readOnly}
            isGuestMode={isGuestMode}
            summary={footerSummary}
            dirty={dirty}
            onSave={handleFooterSave}
          />
        </div>

        {/* In-sheet toast (design): dark pill, springs in under the header */}
        <div
          aria-live="polite"
          className={`pointer-events-none absolute left-1/2 top-[72px] z-30 flex items-center gap-2 whitespace-nowrap rounded-full bg-foreground px-4 py-2.5 text-[14px] font-semibold text-background shadow-[0_8px_24px_rgba(12,27,51,.18)] transition-all duration-300 ${
            flash.on ? '-translate-x-1/2 translate-y-0 opacity-100' : '-translate-x-1/2 -translate-y-3 opacity-0'
          }`}
        >
          <span className="font-extrabold text-emerald-400">✓</span>{flash.text}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <TaskDeleteDialog
        open={deleteConfirm}
        onOpenChange={setDeleteConfirm}
        taskTitle={task.title}
        onConfirm={() => { onDelete(task.id); onClose(); setDeleteConfirm(false); }}
      />
    </>
  );
};

export default TaskDetailPanel;
