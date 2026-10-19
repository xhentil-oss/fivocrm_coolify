import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { toast } from './use-toast';
import { findSameDayTasks } from '../lib/taskConflicts';
import { reminderAtFromOffset } from '../lib/taskReminders';
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

  const handleCreateTask = async (formData: FormData, options?: { skipDateConflictCheck?: boolean; createAnother?: boolean }) => {
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
    const isRecurringRaw = formData.get('isRecurring') as string;
    const recurringFrequency = formData.get('recurringFrequency') as string;
    const recurringIntervalRaw = formData.get('recurringInterval') as string;
    const recurringDayOfWeekRaw = formData.get('recurringDayOfWeek') as string;
    const recurringDayOfMonthRaw = formData.get('recurringDayOfMonth') as string;
    const recurringDaysOfWeekRaw = formData.get('recurringDaysOfWeek') as string;
    const recurringEndDateRaw = formData.get('recurringEndDate') as string;
    const estimatedHoursRaw = formData.get('estimatedHours') as string;
    const valueRaw = formData.get('value') as string;
    const dependsOnRaw = formData.get('dependsOn') as string;
    // "Më kujto" preset, minutes before the deadline (QuickTaskForm). Resolved
    // here against the deadline the form actually sent; no deadline → no reminder.
    const reminderOffsetRaw = formData.get('reminderOffsetMinutes') as string;
    const reminderOffsetMinutes = reminderOffsetRaw !== null && reminderOffsetRaw !== '' && !isNaN(Number(reminderOffsetRaw))
      ? Math.max(0, Number(reminderOffsetRaw)) : undefined;
    const reminderAt = reminderOffsetMinutes !== undefined && endDate ? reminderAtFromOffset(endDate, reminderOffsetMinutes) : undefined;

    let dependsOn: string[] = [];
    try { dependsOn = dependsOnRaw ? JSON.parse(dependsOnRaw) : []; } catch { dependsOn = []; }
    let collaboratorIds: string[] = [];
    try { collaboratorIds = collaboratorIdsRaw ? JSON.parse(collaboratorIdsRaw) : []; } catch { collaboratorIds = []; }
    const labelsRaw = formData.get('labels') as string;
    let labels: string[] = [];
    try { labels = labelsRaw ? JSON.parse(labelsRaw) : []; } catch { labels = []; }
    const isRecurring = isRecurringRaw === 'true';
    const recurringDayOfWeek = recurringDayOfWeekRaw ? parseInt(recurringDayOfWeekRaw) : undefined;
    const recurringDayOfMonth = recurringDayOfMonthRaw ? parseInt(recurringDayOfMonthRaw) : undefined;

    let nextRecurringDate: Date | undefined;
    if (isRecurring && recurringFrequency) {
      const now = new Date();
      if (recurringFrequency === 'daily') {
        // Next day that is in the selected days-of-week list (default Mon-Fri)
        const activeDays = recurringDaysOfWeekRaw ? JSON.parse(recurringDaysOfWeekRaw) as number[] : [1,2,3,4,5];
        nextRecurringDate = new Date(now);
        nextRecurringDate.setDate(nextRecurringDate.getDate() + 1);
        nextRecurringDate.setHours(9, 0, 0, 0);
        if (activeDays.length > 0) {
          let tries = 0;
          while (!activeDays.includes(nextRecurringDate.getDay()) && tries < 7) {
            nextRecurringDate.setDate(nextRecurringDate.getDate() + 1);
            tries++;
          }
        }
      } else if (recurringFrequency === 'weekly' && recurringDayOfWeek !== undefined) {
        // Next occurrence of selected weekday
        nextRecurringDate = new Date(now);
        const currentDay = now.getDay();
        let daysUntil = recurringDayOfWeek - currentDay;
        if (daysUntil <= 0) daysUntil += 7;
        nextRecurringDate.setDate(nextRecurringDate.getDate() + daysUntil);
        nextRecurringDate.setHours(9, 0, 0, 0);
      } else if (recurringFrequency === 'monthly' && recurringDayOfMonth !== undefined) {
        // Next occurrence of selected day of month, clamped to the month's last
        // day (e.g. day 31 in February becomes the 28th/29th, not March 3rd).
        const buildMonthly = (year: number, month: number) => {
          const lastDay = new Date(year, month + 1, 0).getDate();
          return new Date(year, month, Math.min(recurringDayOfMonth, lastDay), 9, 0, 0);
        };
        nextRecurringDate = buildMonthly(now.getFullYear(), now.getMonth());
        if (nextRecurringDate <= now) {
          nextRecurringDate = buildMonthly(now.getFullYear(), now.getMonth() + 1);
        }
      } else if (recurringFrequency === 'yearly') {
        const baseDate = new Date(endDate || now);
        nextRecurringDate = new Date(baseDate.setFullYear(baseDate.getFullYear() + 1));
      }
    }

    const newTask = await taskMutation.create({
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
      isRecurring,
      recurringFrequency: isRecurring ? recurringFrequency as Task['recurringFrequency'] : undefined,
      recurringInterval: isRecurring ? Math.max(1, Math.round(parseInt(recurringIntervalRaw) || 1)) : undefined,
      recurringDayOfWeek: isRecurring && recurringFrequency === 'weekly' ? recurringDayOfWeek : undefined,
      recurringDayOfMonth: isRecurring && recurringFrequency === 'monthly' ? recurringDayOfMonth : undefined,
      recurringDaysOfWeek: isRecurring && recurringFrequency === 'daily' && recurringDaysOfWeekRaw
        ? (() => { try { return JSON.parse(recurringDaysOfWeekRaw); } catch { return [1,2,3,4,5]; } })()
        : undefined,
      recurringEndDate: isRecurring && recurringEndDateRaw
        ? (() => { const [y, mo, d] = recurringEndDateRaw.split('-').map(Number); return new Date(y, mo - 1, d); })()
        : undefined,
      nextRecurringDate,
      reminderAt,
      reminderOffsetMinutes: reminderAt ? reminderOffsetMinutes : undefined,
      estimatedHours: estimatedHoursRaw ? (v => !isNaN(v) ? v : undefined)(parseFloat(estimatedHoursRaw)) : undefined,
      value: valueRaw ? (v => !isNaN(v) && v >= 0 ? v : undefined)(parseFloat(valueRaw)) : undefined,
      dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
    });

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

    // Create collaborator records in parallel
    await Promise.all(
      collaboratorIds.map(collabId =>
        collaboratorMutation.create({
          taskId: newTask.id,
          userId: collabId,
          role: 'collaborator',
        })
      )
    );

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

    setDateConflict(null);
    // "Krijo & shto tjetër" keeps the dialog open for the next entry — the form
    // resets itself and shows its own confirmation, so don't steal focus either.
    onCreated(newTask, options);
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
