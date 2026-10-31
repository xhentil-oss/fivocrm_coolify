import { useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { toast } from './use-toast';
import { findSameDayTasks } from '../lib/taskConflicts';
import { setReminderPatch } from '../lib/taskReminders';
import { recurrenceSeedFromForm } from '../lib/taskCreateSeed';
import { applyValuedTaskSideEffects } from '../lib/finance/taskValue';
import { canSeeFinancials } from '../lib/utils';
import { taskDeepLink } from '../lib/deepLinks';
import type { Task, Project } from '../types';

/** Same-day conflict parked while the user decides (TaskDateConflictDialog). */
export interface TaskDateConflict {
  formData: FormData;
  tasks: Task[];
  assigneeName: string;
  date: Date;
}

interface CreateMutation { create: (data: any) => Promise<any> }

interface UseCreateTaskArgs {
  rawTasks: Task[] | undefined | null;
  projects: Project[] | undefined | null;
  getUserName: (userId?: string) => string;
  taskMutation: CreateMutation;
  collaboratorMutation: CreateMutation;
  notificationMutation: CreateMutation;
  /** Runs after a successful create (dialog close + open the task). */
  onCreated: (task: Task, options?: { createAnother?: boolean }) => void;
}

/**
 * The Tasks page's "Detyrë e Re" submission — extracted verbatim from
 * TasksView: same-day conflict check, recurrence seed, reminder preset,
 * valued-task draft invoice, collaborator records and notifications.
 */
export function useCreateTask({
  rawTasks,
  projects,
  getUserName,
  taskMutation,
  collaboratorMutation,
  notificationMutation,
  onCreated,
}: UseCreateTaskArgs) {
  const { user } = useAuth();
  const permissions = usePermissions();
  // Set when the assignee already has work on the day being scheduled — the form
  // submission is parked here until the user confirms (or cancels).
  const [dateConflict, setDateConflict] = useState<TaskDateConflict | null>(null);
  // In-flight guard: a second submit while the first create is on the wire
  // (double Enter, the conflict dialog's "Po, vazhdo" racing the form's own
  // button) used to create the task twice. The quick form's `saving` flag
  // covers its button only; this covers every entry into the handler.
  const inFlightRef = useRef(false);

  const handleCreateTask = async (formData: FormData, options?: { skipDateConflictCheck?: boolean; createAnother?: boolean }) => {
    if (inFlightRef.current) return;
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    // Dates are optional (only the title is required) — guard against Invalid Date.
    const startRaw = formData.get('startDate') as string;
    const endRaw = formData.get('endDate') as string;
    const sd = startRaw ? new Date(startRaw) : null;
    const ed = endRaw ? new Date(endRaw) : null;
    const startDate = sd && !isNaN(sd.getTime()) ? sd : undefined;
    const endDate = ed && !isNaN(ed.getTime()) ? ed : undefined;
    // Default to current user if not specified
    const assignedToUserId = (formData.get('assignedToUserId') as string) || user?.uid || '';

    // Same-day check: if this person already has an open task on the scheduled day,
    // ask before stacking another one on it. Detection runs on the raw (unfiltered)
    // task list so the role filter can't hide a conflicting task from the check.
    const scheduledDate = endDate || startDate;
    if (!options?.skipDateConflictCheck && scheduledDate && assignedToUserId) {
      const sameDay = findSameDayTasks(rawTasks || [], {
        assigneeId: assignedToUserId,
        date: scheduledDate,
      });
      if (sameDay.length > 0) {
        setDateConflict({
          formData,
          tasks: sameDay,
          assigneeName: assignedToUserId === user?.uid ? 'Ti' : getUserName(assignedToUserId),
          date: scheduledDate,
        });
        return;
      }
    }

    const projectId = formData.get('projectId') as string;
    const priority = formData.get('priority') as string;
    const status = formData.get('status') as string;
    const parentTaskId = formData.get('parentTaskId') as string;
    const collaboratorIdsRaw = formData.get('collaboratorIds') as string;
    const estimatedHoursRaw = formData.get('estimatedHours') as string;
    const valueRaw = formData.get('value') as string;
    const dependsOnRaw = formData.get('dependsOn') as string;
    // "Më kujto" preset, minutes before the deadline (QuickTaskForm). Resolved
    // through the ONE reminder helper (src/lib/taskReminders.ts) so the three
    // fields agree — including `reminderSetByUserId` = the CREATOR: a manager
    // who creates a task for a colleague and asks for "1 orë para" is the one
    // reminded, exactly as in the panel. No deadline → no reminder.
    const reminderOffsetRaw = formData.get('reminderOffsetMinutes') as string;
    const reminderOffsetMinutes = reminderOffsetRaw !== null && reminderOffsetRaw !== '' && !isNaN(Number(reminderOffsetRaw))
      ? Math.max(0, Number(reminderOffsetRaw)) : undefined;
    const reminderPatch = reminderOffsetMinutes !== undefined && endDate
      ? setReminderPatch({ endDate }, { offsetMinutes: reminderOffsetMinutes }, user?.uid)
      : {};

    let dependsOn: string[] = [];
    try { dependsOn = dependsOnRaw ? JSON.parse(dependsOnRaw) : []; } catch { dependsOn = []; }
    let collaboratorIds: string[] = [];
    try { collaboratorIds = collaboratorIdsRaw ? JSON.parse(collaboratorIdsRaw) : []; } catch { collaboratorIds = []; }
    const labelsRaw = formData.get('labels') as string;
    let labels: string[] = [];
    try { labels = labelsRaw ? JSON.parse(labelsRaw) : []; } catch { labels = []; }

    // Recurrence seeded from the task's OWN start day (+ one frequency, in
    // Europe/Tirane) — never from "now": a next cycle before `startDate` is
    // inherited as a negative offset by every child (src/lib/taskCreateSeed.ts).
    const recurrence = recurrenceSeedFromForm(formData, { startDate, endDate });

    inFlightRef.current = true;
    let newTask: any;
    try {
      newTask = await taskMutation.create({
        title,
        description,
        startDate,
        endDate,
        assignedToUserId,
        projectId: projectId || undefined,
        status: status as Task['status'],
        priority: priority as Task['priority'],
        parentTaskId: parentTaskId || undefined,
        collaboratorIds: collaboratorIds,
        labels: labels.length > 0 ? labels : undefined,
        dueNotificationSent: false,
        isRecurring: !!recurrence,
        ...(recurrence || {}),
        ...reminderPatch,
        estimatedHours: estimatedHoursRaw ? (v => !isNaN(v) ? v : undefined)(parseFloat(estimatedHoursRaw)) : undefined,
        value: valueRaw ? (v => !isNaN(v) && v >= 0 ? v : undefined)(parseFloat(valueRaw)) : undefined,
        dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
      });
    } catch (err) {
      inFlightRef.current = false;
      throw err;
    }

    // From here on the TASK EXISTS. Every side-effect below is contained: a
    // refused collaborator record or notification must never reject this
    // handler, or the dialog stays open on a task that is already there and the
    // next click creates it a second time. `finally` closes the dialog.
    try {
      // A priced task means the SAME thing from every surface: draft invoice +
      // budget increment only on one-time projects (src/lib/finance/taskValue.ts).
      // This path used to store `value` with none of the side-effects, leaving it
      // to a manual backfill script with different behaviour.
      const createdValue = Number((newTask as any).value) || (valueRaw ? parseFloat(valueRaw) : 0) || 0;
      if (createdValue > 0) {
        try {
          const proj = projectId ? (projects || []).find(p => p.id === projectId) : undefined;
          const result = await applyValuedTaskSideEffects({
            taskId: (newTask as any).id,
            taskTitle: title,
            value: createdValue,
            project: proj ? ({ ...(proj as any), id: proj.id }) : null,
            canEditBudget: canSeeFinancials(permissions),
          });
          if (!result.skipped) {
            toast({
              title: 'Faturë Draft për detyrën ✓',
              description: result.appliedToBudget
                ? `${result.invoiceNumber} për ${createdValue.toLocaleString()} · buxheti i projektit u rrit.`
                : `${result.invoiceNumber} për ${createdValue.toLocaleString()}${proj ? ' · tarifa periodike nuk u prek' : ''}.`,
            });
          }
        } catch (err: any) {
          console.error('[Tasks] draft invoice for valued task failed:', err);
          toast({ title: 'Detyra u ruajt, fatura jo', description: err?.message, variant: 'destructive' });
        }
      }

      // Collaborator records, in parallel and SETTLED: one refused record (rules)
      // is a warning on an existing task, not a failed creation.
      const collabResults = await Promise.allSettled(
        collaboratorIds.map(collabId =>
          collaboratorMutation.create({
            taskId: newTask.id,
            userId: collabId,
            role: 'collaborator',
          })
        )
      );
      const collabFailed = collabResults.filter(r => r.status === 'rejected').length;
      if (collabFailed) {
        console.warn(`[Tasks] ${collabFailed} bashkëpunëtorë nuk u regjistruan:`, collabResults);
        toast({
          title: 'Detyra u krijua, bashkëpunëtorët jo të gjithë',
          description: `${collabFailed} nga ${collaboratorIds.length} bashkëpunëtorë nuk u shtuan — shtoji nga paneli i detyrës.`,
        });
      }

      // Send notifications in parallel
      const notificationPromises: Promise<any>[] = [];
      if (assignedToUserId && assignedToUserId !== user?.uid) {
        notificationPromises.push(
          notificationMutation.create({
            userId: assignedToUserId,
            type: 'task_assigned',
            title: 'Detyrë e Re e Caktuar',
            message: `Ju u caktuat te detyra: ${title}`,
            isRead: false,
            // Deep link straight to the task — a bare '/app/tasks' landed on the
            // list and nothing opened or scrolled.
            actionUrl: taskDeepLink((newTask as any).id, projectId || undefined),
            actionLabel: 'Shiko Detyrën',
          })
        );
      }
      for (const collabId of collaboratorIds) {
        // Skip the assignee too — they were just told "detyrë e re" above; a second
        // "u shtuat si bashkëpunëtor" for the same creation is a duplicate ping.
        if (collabId !== user?.uid && collabId !== assignedToUserId) {
          notificationPromises.push(
            notificationMutation.create({
              userId: collabId,
              type: 'task_collaborator_added',
              title: 'U shtuat si bashkëpunëtor',
              message: `U shtuat si bashkëpunëtor te detyra: ${title}`,
              isRead: false,
              actionUrl: taskDeepLink((newTask as any).id, projectId || undefined),
              actionLabel: 'Shiko Detyrën',
            })
          );
        }
      }
      // allSettled, not all: the task is already created by this point. A rejected
      // notification used to reject this whole handler, so the dialog stayed open on a
      // task that existed — and the user created it a second time.
      await Promise.allSettled(notificationPromises);
    } catch (err) {
      console.error('[Tasks] detyra u krijua, veprimet pasuese dështuan:', err);
    } finally {
      inFlightRef.current = false;
      setDateConflict(null);
      // "Krijo & shto tjetër" keeps the dialog open for the next entry — the form
      // resets itself and shows its own confirmation, so don't steal focus either.
      onCreated(newTask, options);
    }
  };

  /** "Po, vazhdo" on the same-day warning — re-runs the parked submission. */
  const handleConfirmDateConflict = async () => {
    if (!dateConflict) return;
    const { formData } = dateConflict;
    setDateConflict(null);
    await handleCreateTask(formData, { skipDateConflictCheck: true });
  };

  return { handleCreateTask, handleConfirmDateConflict, dateConflict, setDateConflict };
}
