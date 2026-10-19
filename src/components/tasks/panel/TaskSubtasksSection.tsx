import React, { useEffect, useState } from 'react';
import { Calendar as CalendarIcon, Check, Plus, Trash2, Users } from 'lucide-react';
import { useMutation } from '../../../hooks/useFirestore';
import { useAuth } from '../../../contexts/AuthContext';
import { usePermissions } from '../../../contexts/PermissionsContext';
import { toast } from '../../../hooks/use-toast';
import { completeTask } from '../../../lib/recurringUtils';
import { claimTaskNextCycle, releaseTaskNextCycle } from '../../../lib/taskRecurrenceClaim';
import { deleteTaskCascade } from '../../../lib/deleteCascade';
import { reminderPatchForDeadline, parseTaskDate } from '../../../lib/taskReminders';
import { taskDeepLink } from '../../../lib/deepLinks';
import { taskCompletedNotifications } from '../../../lib/taskNotifications';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Textarea } from '../../ui/textarea';
import { Calendar } from '../../ui/calendar';
import { Checkbox } from '../../ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import type { Task } from '../../../types';
import { getPriorityColor, getPriorityLabel, parseDate, rearmDeadlineAlerts, reopenPatchFor } from './panelShared';

interface TaskSubtasksSectionProps {
  task: Task;
  readOnly: boolean;
  subtasks: Task[] | undefined | null;
  allTasks?: Task[];
  projects: { id: string; name: string; status?: string }[];
  teamMembers: any[];
  getUserDisplayName: (userId: string) => string;
  onSelectSubtask?: (subtask: Task) => void;
}

/** "Nën-detyra" — checklist, inline create form and per-row edit form. */
const TaskSubtasksSection: React.FC<TaskSubtasksSectionProps> = ({
  task,
  readOnly,
  subtasks,
  allTasks,
  projects,
  teamMembers,
  getUserDisplayName,
  onSelectSubtask,
}) => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const taskMutation = useMutation<Task>('tasks');
  const notificationMutation = useMutation<any>('notifications');
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const [editingSubtask, setEditingSubtask] = useState<string | null>(null);

  // Subtask form state
  const [subtaskForm, setSubtaskForm] = useState({
    title: '',
    description: '',
    status: 'Todo',
    priority: 'medium',
    startDate: new Date(),
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    assignedToUserId: '',
  });

  const resetSubtaskForm = () => {
    setSubtaskForm({
      title: '',
      description: '',
      status: 'Todo',
      priority: 'medium',
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      assignedToUserId: user?.uid || '',
    });
  };

  // Reset ONLY when switching to a different task (the panel's reset effect —
  // it also runs on mount, which seeds the assignee with the current user).
  useEffect(() => {
    setShowSubtaskForm(false);
    setEditingSubtask(null);
    resetSubtaskForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  const handleCreateSubtask = async () => {
    if (!subtaskForm.title.trim() || !user) return;

    const subtaskAssignee = subtaskForm.assignedToUserId || user.uid;
    let createdSubtask: unknown;
    try {
      createdSubtask = await taskMutation.create({
        title: subtaskForm.title,
        description: subtaskForm.description,
        status: subtaskForm.status,
        priority: subtaskForm.priority,
        startDate: subtaskForm.startDate,
        endDate: subtaskForm.endDate,
        assignedToUserId: subtaskAssignee,
        projectId: task.projectId,
        parentTaskId: task.id,
        collaboratorIds: [],
        // Inherit the parent task's tenancy scope so a subtask of a cross-department
        // task lands in the parent's team/business, not the viewer's active context.
        teamId: (task as any).teamId,
        businessId: (task as any).businessId,
        // …and the client it serves: `customerId` is the portal-visibility switch
        // (rules + portal query key on it), so a subtask without it was invisible
        // to the client and its "Dukshëm për klientin" checkbox never rendered.
        ...((task as any).customerId ? { customerId: (task as any).customerId } : {}),
      } as any);
    } catch (err: any) {
      console.error('[Tasks] krijimi i nën-detyrës dështoi:', err);
      toast({ title: 'Nën-detyra nuk u krijua', description: err?.message, variant: 'destructive' });
      return;
    }

    // Notify assigned user for subtask
    if (subtaskAssignee !== user.uid) {
      await notificationMutation.create({
        userId: subtaskAssignee,
        type: 'task_assigned',
        title: 'Nën-detyrë e Re e Caktuar',
        message: `Ju u caktuat te nën-detyra: ${subtaskForm.title}`,
        isRead: false,
        actionUrl: (createdSubtask as any)?.id
          ? taskDeepLink((createdSubtask as any).id, task.projectId)
          : taskDeepLink(task.id, task.projectId),
        actionLabel: 'Shiko Detyrën',
      }).catch(err => console.error('[Notifications] subtask_assigned dërgim dështoi:', err));
    }

    resetSubtaskForm();
    setShowSubtaskForm(false);
  };

  const handleUpdateSubtask = async (subtaskId: string, rawData: any) => {
    try {
      const sub = (subtasks || []).find(t => t.id === subtaskId);
      let data = { ...rawData };
      // A moved deadline follows the main panel's law: re-arm the due/overdue
      // alerts and carry a RELATIVE reminder along (reminderPatchForDeadline).
      if (sub && data.endDate instanceof Date) {
        const prevEnd = parseTaskDate(sub.endDate);
        if (!prevEnd || prevEnd.getTime() !== data.endDate.getTime()) {
          data = { ...data, ...rearmDeadlineAlerts, ...reminderPatchForDeadline(sub, data.endDate) };
        } else {
          delete data.endDate;
        }
      }
      const prevAssignee = sub?.assignedToUserId;
      // Without canAssignTasks a subtask may only be handed to yourself.
      if (data.assignedToUserId && data.assignedToUserId !== prevAssignee
          && !permissions.canAssignTasks && data.assignedToUserId !== user?.uid) {
        delete data.assignedToUserId;
      }
      const reassigned = !!sub && !!data.assignedToUserId && data.assignedToUserId !== prevAssignee;
      // A new assignee has not seen it yet — clear the old "Parë" mark.
      if (reassigned) data = { ...data, assigneeSeenAt: null, assigneeSeenFor: null };
      // Re-opening (Done → anything else) runs the same rule as the main pill.
      if (sub && data.status && data.status !== 'Done') {
        data = { ...data, ...reopenPatchFor(sub, allTasks || subtasks) };
      }
      // Closing a subtask is a completion like any other: it must run the shared
      // flow (blocker guard, recurrence, task_completed notifications) instead of
      // a raw status write. Everything else on the row is a plain update.
      if (data?.status === 'Done' && sub && sub.status !== 'Done') {
        const { status: _done, ...rest } = data;
        if (Object.keys(rest).length) await taskMutation.update(subtaskId, rest);
        const outcome = await completeTask({ ...sub, ...rest }, {
          createTask: (d) => taskMutation.create(d as any),
          updateTask: (id, d) => taskMutation.update(id, d),
          allTasks: allTasks || subtasks || [],
          projects,
          claimNextCycle: claimTaskNextCycle,
          releaseNextCycle: releaseTaskNextCycle,
        });
        // Blocked: the other fields (incl. a new assignee) were already saved
        // above, so fall through to the reassignment notice instead of returning.
        if (outcome.kind === 'blocked') {
          toast({ title: '⛔ Nën-detyrë e bllokuar', description: `Ka ${outcome.blockers} varësi të pakryera.`, variant: 'destructive' });
        } else if (user?.uid) {
          taskCompletedNotifications(sub, user.uid, user.displayName || undefined).forEach(n =>
            notificationMutation.create(n as any).catch(err => console.error('[Notifications] task_completed (nën-detyrë) dërgim dështoi:', err)));
        }
      } else {
        await taskMutation.update(subtaskId, data);
      }
      // Reassignment notifies exactly like the main assignee picker (assignTo):
      // the new assignee and the previous one, never the actor.
      if (sub && reassigned) {
        const link = taskDeepLink(sub.id, sub.projectId ?? task.projectId);
        const newAssignee = data.assignedToUserId as string;
        const sends: Promise<unknown>[] = [];
        if (newAssignee !== user?.uid) {
          sends.push(notificationMutation.create({
            userId: newAssignee,
            type: 'task_assigned',
            title: 'Nën-detyrë e Re e Caktuar',
            message: `${user?.displayName || 'Dikush'} ju caktoi nën-detyrën: ${data.title || sub.title}`,
            isRead: false,
            actionUrl: link,
            actionLabel: 'Shiko Detyrën',
          }));
        }
        if (prevAssignee && prevAssignee !== user?.uid) {
          sends.push(notificationMutation.create({
            userId: prevAssignee,
            type: 'task_assigned',
            title: 'Nën-detyrë e Ri-caktuar',
            message: `Nën-detyra "${data.title || sub.title}" u ri-caktua te ${getUserDisplayName(newAssignee)}`,
            isRead: false,
            actionUrl: link,
            actionLabel: 'Shiko Detyrën',
          }));
        }
        const results = await Promise.allSettled(sends);
        results.forEach(r => { if (r.status === 'rejected') console.error('[Notifications] task_assigned (nën-detyrë) dërgim dështoi:', r.reason); });
      }
    } catch (err: any) {
      console.error('[Tasks] përditësimi i nën-detyrës dështoi:', err);
      toast({ title: 'Nën-detyra nuk u përditësua', description: err?.message, variant: 'destructive' });
    } finally {
      setEditingSubtask(null);
    }
  };

  // Same delete authority as the main task's footer button: manager rank, or
  // owning the task (creator/assignee) — and never from a read-only panel.
  const canDeleteTask = (t: Task) => !readOnly && permissions.canEdit
    && (permissions.isAdmin || permissions.isManager
        || t.createdByUserId === user?.uid || t.assignedToUserId === user?.uid);
  const [confirmDeleteSubtaskId, setConfirmDeleteSubtaskId] = useState<string | null>(null);

  const handleDeleteSubtask = async (subtaskId: string) => {
    setConfirmDeleteSubtaskId(null);
    const sub = (subtasks || []).find(t => t.id === subtaskId);
    if (!sub || !canDeleteTask(sub)) return;
    // Cascade: the subtask's comments/collaborator records go with it, and any
    // logged hours are unlinked rather than left pointing at a dead id.
    try {
      await deleteTaskCascade(subtaskId);
    } catch (err: any) {
      console.error('[Tasks] fshirja e nën-detyrës dështoi:', err);
      toast({ title: 'Nën-detyra nuk u fshi', description: err?.message, variant: 'destructive' });
    }
  };

  const startEditingSubtask = (subtask: any) => {
    setEditingSubtask(subtask.id);
    setSubtaskForm({
      title: subtask.title,
      description: subtask.description || '',
      status: subtask.status,
      priority: subtask.priority || 'medium',
      startDate: parseDate(subtask.startDate),
      endDate: parseDate(subtask.endDate),
      assignedToUserId: subtask.assignedToUserId,
    });
  };

  const cancelEditingSubtask = () => {
    setEditingSubtask(null);
    resetSubtaskForm();
  };

  return (
    <div className="pt-4 border-t">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
          Nën-detyra ({subtasks?.length || 0})
        </h4>
        {!readOnly && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              resetSubtaskForm();
              setShowSubtaskForm(!showSubtaskForm);
            }}
          >
            <Plus className="w-4 h-4" />
          </Button>
        )}
      </div>

      {showSubtaskForm && (
        <div className="bg-muted/50 rounded-lg p-3 mb-3 space-y-3">
          <Input
            placeholder="Titulli i nën-detyrës"
            value={subtaskForm.title}
            onChange={(e) => setSubtaskForm({ ...subtaskForm, title: e.target.value })}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreateSubtask} disabled={!subtaskForm.title.trim()}>
              Shto
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowSubtaskForm(false)}>
              Anulo
            </Button>
          </div>
        </div>
      )}

      {subtasks && subtasks.length > 0 && (
        <div className="space-y-2">
          {subtasks.map(subtask => (
            <div key={subtask.id}>
              {/* Subtask Card - Clickable to expand */}
              <div 
                className={`group border rounded-lg p-3 cursor-pointer transition-all ${
                  subtask.status === 'Done' ? 'bg-success/10 border-success/20' : 'hover:bg-muted/50 hover:border-primary/30'
                } ${editingSubtask === subtask.id ? 'ring-2 ring-primary' : ''}`}
                onClick={() => {
                  if (onSelectSubtask) {
                    onSelectSubtask(subtask);
                  } else if (!readOnly && editingSubtask !== subtask.id) {
                    startEditingSubtask(subtask);
                  }
                }}
              >
                {/* Top row: Checkbox + Title + Delete */}
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={subtask.status === 'Done'}
                    disabled={readOnly}
                    onClick={(e) => e.stopPropagation()}
                    onCheckedChange={(checked) => {
                      handleUpdateSubtask(subtask.id, { 
                        status: checked ? 'Done' : 'Todo' 
                      });
                    }}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${subtask.status === 'Done' ? 'line-through text-muted-foreground' : ''}`}>
                      {subtask.title}
                    </p>
                    {subtask.description && (
                      // Subtasks are written in a plain textarea, so the
                      // stored value keeps real newlines — render them.
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-line">
                        {subtask.description}
                      </p>
                    )}
                  </div>
                  {canDeleteTask(subtask) && (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {confirmDeleteSubtaskId === subtask.id ? (
                        <span className="inline-flex items-center gap-1.5">
                          <button type="button" onClick={() => handleDeleteSubtask(subtask.id)} className="text-[11px] font-semibold text-red-500 hover:text-red-600">Fshi vërtet</button>
                          <button type="button" onClick={() => setConfirmDeleteSubtaskId(null)} className="text-[11px] text-muted-foreground hover:text-foreground">Jo</button>
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                          aria-label="Fshi nën-detyrën"
                          onClick={() => setConfirmDeleteSubtaskId(subtask.id)}
                        >
                          <Trash2 className="w-3 h-3 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              
                {/* Bottom row: Priority + Assignee + Due Date */}
                <div className="flex items-center gap-2 mt-2 ml-7 flex-wrap">
                  <Badge className={`text-xs ${getPriorityColor(subtask.priority)}`}>
                    {getPriorityLabel(subtask.priority)}
                  </Badge>
                  {subtask.assignedToUserId && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {getUserDisplayName(subtask.assignedToUserId)}
                    </span>
                  )}
                  {subtask.endDate && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <CalendarIcon className="w-3 h-3" />
                      {new Date(subtask.endDate).toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                </div>
              </div>
            
              {/* Expanded Edit Form */}
              {editingSubtask === subtask.id && (
                <div className="mt-2 bg-muted/30 rounded-lg p-3 space-y-3 border border-primary/20">
                  <Input
                    placeholder="Titulli i nën-detyrës"
                    value={subtaskForm.title}
                    onChange={(e) => setSubtaskForm({ ...subtaskForm, title: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm"
                  />
                  <Textarea
                    placeholder="Përshkrimi..."
                    value={subtaskForm.description}
                    onChange={(e) => setSubtaskForm({ ...subtaskForm, description: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm min-h-[60px]"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Select
                      value={subtaskForm.status}
                      onValueChange={(value) => setSubtaskForm({ ...subtaskForm, status: value })}
                    >
                      <SelectTrigger className="text-sm">
                        <SelectValue placeholder="Statusi" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Todo">Për tu bërë</SelectItem>
                        <SelectItem value="In Progress">Në progres</SelectItem>
                        <SelectItem value="Review">Në rishikim</SelectItem>
                        <SelectItem value="Done">Përfunduar</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={subtaskForm.priority}
                      onValueChange={(value) => setSubtaskForm({ ...subtaskForm, priority: value })}
                    >
                      <SelectTrigger className="text-sm">
                        <SelectValue placeholder="Prioriteti" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="urgent">Urgjent</SelectItem>
                        <SelectItem value="high">Lartë</SelectItem>
                        <SelectItem value="medium">Mesatar</SelectItem>
                        <SelectItem value="low">Ulët</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="justify-start text-sm">
                          <CalendarIcon className="w-3 h-3 mr-1" />
                          {subtaskForm.startDate.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' })}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={subtaskForm.startDate}
                          onSelect={(date) => date && setSubtaskForm({ ...subtaskForm, startDate: date })}
                        />
                      </PopoverContent>
                    </Popover>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="justify-start text-sm">
                          <CalendarIcon className="w-3 h-3 mr-1" />
                          {subtaskForm.endDate.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' })}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={subtaskForm.endDate}
                          onSelect={(date) => date && setSubtaskForm({ ...subtaskForm, endDate: date })}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <Select
                    value={subtaskForm.assignedToUserId}
                    onValueChange={(value) => setSubtaskForm({ ...subtaskForm, assignedToUserId: value })}
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="Cakto personin përgjegjës" />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Same rule as the main assignee picker: without
                          canAssignTasks only YOU are pickable; the current
                          assignee stays listed (disabled) so the value renders. */}
                      {permissions.canAssignTasks
                        ? teamMembers?.map(member => (
                            <SelectItem key={member.id} value={member.userId}>
                              {getUserDisplayName(member.userId)}
                            </SelectItem>
                          ))
                        : (
                          <>
                            {user && (
                              <SelectItem value={user.uid}>{getUserDisplayName(user.uid)}</SelectItem>
                            )}
                            {subtask.assignedToUserId && subtask.assignedToUserId !== user?.uid && (
                              <SelectItem value={subtask.assignedToUserId} disabled>
                                {getUserDisplayName(subtask.assignedToUserId)}
                              </SelectItem>
                            )}
                          </>
                        )}
                    </SelectContent>
                  </Select>
                  {!permissions.canAssignTasks && (
                    <p className="text-[11px] text-muted-foreground">Roli yt cakton detyra vetëm për vete.</p>
                  )}
                  <div className="flex gap-2 pt-2">
                    <Button 
                      size="sm" 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUpdateSubtask(subtask.id, {
                          title: subtaskForm.title,
                          description: subtaskForm.description,
                          status: subtaskForm.status,
                          priority: subtaskForm.priority,
                          startDate: subtaskForm.startDate,
                          endDate: subtaskForm.endDate,
                          assignedToUserId: subtaskForm.assignedToUserId,
                        });
                        setEditingSubtask(null);
                      }}
                      disabled={!subtaskForm.title.trim()}
                    >
                      <Check className="w-3 h-3 mr-1" />
                      Ruaj
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={(e) => {
                        e.stopPropagation();
                        cancelEditingSubtask();
                      }}
                    >
                      Anulo
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TaskSubtasksSection;
