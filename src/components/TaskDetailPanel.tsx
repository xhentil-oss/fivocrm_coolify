import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Users } from 'lucide-react';
import { useUniqueTeamMembers } from '../hooks/useRoleFilteredData';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { completeTask } from '../lib/recurringUtils';
import { claimTaskNextCycle, releaseTaskNextCycle } from '../lib/taskRecurrenceClaim';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { type MentionCandidate } from './comments/CommentEditor';
import { toast } from '../hooks/use-toast';
import { taskCompletedNotifications } from '../lib/taskNotifications';
import type { Task, TaskComment } from '../types';
import { formatDateCompact, reopenPatchFor } from './tasks/panel/panelShared';
import { useTaskPanelDates } from './tasks/panel/useTaskPanelDates';
import TaskPanelHeader from './tasks/panel/TaskPanelHeader';
import TaskPeopleRows from './tasks/panel/TaskPeopleRows';
import { TaskDueDateRow, TaskStartDateRow } from './tasks/panel/TaskDatesSection';
import TaskReminderSection from './tasks/panel/TaskReminderSection';
import TaskRecurrenceSection from './tasks/panel/TaskRecurrenceSection';
import TaskDependenciesSection from './tasks/panel/TaskDependenciesSection';
import TaskPriorityLabelRows from './tasks/panel/TaskPriorityLabelRows';
import TaskActivityTab from './tasks/panel/TaskActivityTab';
import TaskDescriptionSection from './tasks/panel/TaskDescriptionSection';
import TaskTimeTrackingSection from './tasks/panel/TaskTimeTrackingSection';
import TaskSubtasksSection from './tasks/panel/TaskSubtasksSection';
import TaskAttachmentsSection from './tasks/panel/TaskAttachmentsSection';
import TaskChatSection from './tasks/panel/TaskChatSection';
import TaskCommentsSection from './tasks/panel/TaskCommentsSection';
import TaskPanelFooter, { TaskDeleteDialog } from './tasks/panel/TaskPanelFooter';

// The panel is composed from the sections in src/components/tasks/panel/ (the
// design notes live in panelShared.tsx). Both mounts (TasksView,
// ProjectDetailView) render THIS component with these exact props.

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

  // ── Redesign state: pill dropdowns + searchable pickers ──
  const [statusOpen, setStatusOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignQuery, setAssignQuery] = useState('');
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const closePickers = () => { setStatusOpen(false); setAssignOpen(false); setProjectOpen(false); };

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
  const subtitleText = [
    currentProject?.name || 'Pa projekt',
    createdLabel ? `krijuar ${createdLabel}${creatorLabel ? ` nga ${creatorLabel}` : ''}` : null,
  ].filter(Boolean).join(' · ');

  const footerSummary = `${assigneeName.split(' ')[0]} · ${endDate ? formatDateCompact(endDate) : 'pa afat'}${task.isRecurring ? ' · përsëritet' : ''}`;

  // "Ruaj ndryshimet" — commits any in-progress title/description edit and closes.
  // Every other field already saved on tap (chips/pickers write straight through).
  const handleFooterSave = async () => {
    const patch: any = {};
    if (titleText.trim() && titleText.trim() !== task.title) patch.title = titleText.trim();
    const cleanedDesc = descriptionText === '<p></p>' ? '' : descriptionText;
    if (isEditingDescription && cleanedDesc !== (task.description || '')) patch.description = cleanedDesc;
    if (Object.keys(patch).length > 0) await onUpdate(task.id, patch);
    onClose();
  };

  // Delete: manager rank or owning the task (creator/assignee) — the rules
  // accept any member's delete, so the UI must not offer more than the role is
  // meant to have.
  const canDeleteThis = !readOnly && permissions.canEdit
    && (permissions.isAdmin || permissions.isManager
        || task.createdByUserId === user?.uid || task.assignedToUserId === user?.uid);

  return (
    <>
    {/* The parents position the panel (side panel on desktop, bottom sheet on
        mobile) — the panel only brings the design's content. */}
      <div
        className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
        onClick={closePickers}
      >
        <TaskPanelHeader
          task={task}
          readOnly={readOnly}
          statusOpen={statusOpen}
          onToggleStatus={() => { setAssignOpen(false); setProjectOpen(false); setStatusOpen(v => !v); }}
          onPickStatus={(s) => { setStatusOpen(false); changeStatus(s); }}
          justCreated={justCreated}
          activeWorkersCount={activeWorkers.length}
          onExpand={onExpand}
          isExpanded={isExpanded}
          onClose={onClose}
        />

        {/* Scrollable Content */}
        <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4 sm:space-y-5 sm:px-6 sm:py-5">
          {/* Title + created info */}
          <div>
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
              className="w-full border-none bg-transparent text-[21px] font-extrabold tracking-tight text-foreground outline-none disabled:opacity-100 sm:text-[23px]"
            />
            <div className="mt-0.5 text-xs text-muted-foreground">{subtitleText}</div>
          </div>

          {/* Meta rows — label grid per the design */}
          <div className="flex flex-col">
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
              closeStatus={() => setStatusOpen(false)}
            />

            <TaskDueDateRow
              readOnly={readOnly}
              endDate={endDate}
              onDateChange={handleEndDateChange}
              onTimeChange={handleEndTimeChange}
            />

            <TaskReminderSection task={task} readOnly={readOnly} endDate={endDate} onUpdate={onUpdate} />

            <TaskStartDateRow
              readOnly={readOnly}
              startDate={startDate}
              onDateChange={handleStartDateChange}
              onTimeChange={handleStartTimeChange}
            />

            <TaskRecurrenceSection task={task} readOnly={readOnly} allTasks={allTasks} onUpdate={onUpdate} />

            <TaskDependenciesSection task={task} readOnly={readOnly} allTasks={allTasks} onUpdate={onUpdate} />

            <TaskPriorityLabelRows task={task} readOnly={readOnly} labelSuggestions={labelSuggestions} onUpdate={onUpdate} />
          </div>

          {/* Activity history (audit trail) */}
          <TaskActivityTab taskId={task.id} getUserDisplayName={getUserDisplayName} />

          {/* Description - Rich Text Editor */}
          <TaskDescriptionSection
            task={task}
            readOnly={readOnly}
            isEditing={isEditingDescription}
            setIsEditing={setIsEditingDescription}
            draft={descriptionText}
            setDraft={setDescriptionText}
            onUpdate={onUpdate}
          />

          {/* Collaborators */}
          {taskCollaborators && taskCollaborators.length > 0 && (
            <div className="pt-4 border-t">
              <h4 className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground mb-2">Bashkëpunëtorët</h4>
              <div className="flex flex-wrap gap-2">
                {taskCollaborators.map(collab => (
                  <Badge key={collab.id} variant="secondary" className="text-xs">
                    <Users className="w-3 h-3 mr-1" />
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
      </ScrollArea>

        {/* Footer: Fshi · përmbledhja · Ruaj (design) */}
        <TaskPanelFooter
          readOnly={readOnly}
          isGuestMode={isGuestMode}
          canDelete={canDeleteThis}
          summary={footerSummary}
          onSave={handleFooterSave}
          onRequestDelete={() => setDeleteConfirm(true)}
        />
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
