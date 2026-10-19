import React from 'react';
import {
  Flag,
  MoreVertical,
  MessageSquare,
  Target,
  Check,
  ListChecks,
  Edit2,
  AlertTriangle,
  GripVertical,
  Bell as ReminderBellIcon,
} from 'lucide-react';
import { Checkbox } from '../ui/checkbox';
import { Calendar } from '../ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { TaskLabels } from '../TaskLabels';
import { getTaskStatusLabel } from '../../lib/statusColors';
import { parseTaskDate } from '../../lib/taskReminders';
import type { Task } from '../../types';
import { approvalBadge } from '../../lib/taskApproval';
import { assigneeSeenLabel, isAssigneeSeen } from '../../lib/taskReceipts';
import { formatDateCompact, hashColor, isOverdueDate, taskPropsEqual } from './taskListUtils';

export interface TaskRowProps {
  task: Task;
  /** The task open in the detail panel. */
  isSelected: boolean;
  /** Ticked for a bulk action. */
  isChecked: boolean;
  /** Any row ticked → checkboxes stay visible on touch. */
  selectionActive: boolean;
  isBlocked: boolean;
  isBeingWorkedOn: boolean;
  projectName: string | null;
  subtaskDone?: number;
  subtaskTotal?: number;
  commentCount: number;
  assigneeName: string;
  /** Viewer (canEdit=false) is read-only. */
  canEdit: boolean;
  /** Edit rights + manager rank or owning the task (creator/assignee). */
  canDelete: boolean;
  // Callbacks MUST be stable (see TasksView) or the memo is pointless.
  onSelect: (task: Task) => void;
  onToggleChecked: (id: string) => void;
  /** Completion toggle: Done → reopen, otherwise complete. */
  onToggleDone: (task: Task) => void | Promise<unknown>;
  /** Quick action "Shëno si Përfunduar". */
  onMarkDone: (task: Task) => void | Promise<unknown>;
  onSetPriority: (task: Task, priority: NonNullable<Task['priority']>) => void;
  onReschedule: (task: Task, day: Date) => void | Promise<unknown>;
  onCopy: (task: Task) => void | Promise<unknown>;
  onRequestDelete: (id: string) => void;
}

const PRIORITY_CHOICES = [['urgent', 'Urgjent'], ['high', 'I lartë'], ['medium', 'Mesatar'], ['low', 'I ulët']] as const;

/** One list row — shared by the flat (drag-sortable) list and the grouped view.
 *  Memoized: a change to one task re-renders that row only. */
const TaskRowInner: React.FC<TaskRowProps> = ({
  task,
  isSelected,
  isChecked,
  selectionActive,
  isBlocked,
  isBeingWorkedOn,
  projectName,
  subtaskDone,
  subtaskTotal,
  commentCount,
  assigneeName,
  canEdit: canEditRow,
  canDelete: canDeleteRow,
  onSelect,
  onToggleChecked,
  onToggleDone,
  onMarkDone,
  onSetPriority,
  onReschedule,
  onCopy,
  onRequestDelete,
}) => {
  const dateInfo = formatDateCompact(new Date(task.endDate as any), task.status);
  const isOverdue = isOverdueDate(task.endDate) && task.status !== 'Done';
  const subtaskInfo = subtaskTotal !== undefined ? { done: subtaskDone ?? 0, total: subtaskTotal } : undefined;
  const initials = assigneeName.slice(0, 2).toUpperCase();
  const approval = approvalBadge(task);
  // "Parë 14:32" / "Pa parë ende" — the assigner's answer to "has she opened it?"
  const seenLabel = task.status !== 'Done' ? assigneeSeenLabel(task) : null;
  const seen = isAssigneeSeen(task);
  const initialsColor = hashColor(assigneeName);
  const priorityFlagColor = task.priority === 'urgent' || task.priority === 'high'
    ? '#EF4444' : task.priority === 'medium' ? '#F97316' : '#9CA3AF';
  // Status-coded left accent bar color.
  const accentColor = task.status === 'Todo' ? '#f59e0b'
    : task.status === 'Done' ? '#10b981'
    : task.status === 'In Progress' ? '#3b82f6'
    : '#12468C'; // Review / default
  return (
    <div
      className={`group relative rounded-[14px] bg-white dark:bg-card border shadow-sm cursor-pointer overflow-hidden transition-all duration-[180ms] ease-[cubic-bezier(.4,0,.2,1)] hover:-translate-y-0.5 hover:shadow-md ${
        isSelected
          ? 'border-[rgba(18,70,140,0.5)] ring-1 ring-[rgba(18,70,140,0.3)]'
          : 'border-black/5 dark:border-white/10 hover:border-[rgba(18,70,140,0.3)]'
      }`}
      onClick={() => onSelect(task)}
    >
      {/* Status accent bar — brightens & widens slightly on hover */}
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-1 group-hover:w-1.5 transition-all duration-[180ms] ease-[cubic-bezier(.4,0,.2,1)] group-hover:brightness-110"
        style={{ backgroundColor: accentColor }}
      />
      <div className={`flex items-start gap-3 pl-4 pr-3 py-3 ${isOverdue ? 'bg-destructive/5' : ''}`}>
      {/* Bulk-select checkbox — hover on desktop; hidden on touch unless a selection is active */}
      {canEditRow && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`items-center pt-1 flex-shrink-0 transition-opacity ${selectionActive ? 'flex opacity-100' : 'hidden sm:flex opacity-0 group-hover:opacity-100'}`}
        >
          <Checkbox checked={isChecked} onCheckedChange={() => onToggleChecked(task.id)} aria-label="Përzgjidh detyrën" />
        </div>
      )}
      {/* Drag handle */}
      <div className="mt-1.5 cursor-grab opacity-0 group-hover:opacity-30 hover:!opacity-70 text-muted-foreground flex-shrink-0 hidden sm:block">
        <GripVertical className="w-3.5 h-3.5" />
      </div>
      {/* Completion toggle — compact circular checkbox (Todoist-style): small
          visual, comfortable tap area, satisfying fill-and-check on complete. */}
      <button
        type="button"
        disabled={!canEditRow}
        aria-label={task.status === 'Done' ? 'Shëno si të pabërë' : 'Shëno si të përfunduar'}
        aria-pressed={task.status === 'Done'}
        onClick={async (e) => {
          e.stopPropagation();
          if (!canEditRow) return;
          await onToggleDone(task);
        }}
        className="group/check mt-0.5 -m-1 p-1 flex items-center justify-center shrink-0 active:scale-90 transition-transform"
      >
        <span
          className={`flex items-center justify-center w-5 h-5 rounded-full border-2 transition-all duration-200 ${
            task.status === 'Done'
              ? 'bg-emerald-500 border-emerald-500'
              : 'border-muted-foreground/30 group-hover/check:border-emerald-500/60'
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`w-3 h-3 transition-opacity duration-150 ${
              task.status === 'Done'
                ? 'text-white opacity-100'
                : 'text-emerald-500 opacity-0 group-hover/check:opacity-40'
            }`}
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </span>
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Priority flag — inline change (read-only roles just see the flag) */}
          {canEditRow ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button onClick={(e) => e.stopPropagation()} title="Ndrysho prioritetin" className="flex-shrink-0 hover:opacity-70">
                  <Flag className="w-3 h-3" style={{ color: priorityFlagColor }} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                {PRIORITY_CHOICES.map(([p, label]) => (
                  <DropdownMenuItem key={p} onClick={() => onSetPriority(task, p)}>{label}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Flag className="w-3 h-3 flex-shrink-0" style={{ color: priorityFlagColor }} />
          )}
          <span className={`text-sm font-medium ${task.status === 'Done' ? 'line-through text-muted-foreground' : ''}`}>
            {task.title}
          </span>
          {isBeingWorkedOn && (
            <span className="flex items-center gap-0.5 text-[10px] text-success bg-success/10 px-1.5 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              Duke punuar
            </span>
          )}
          {isBlocked && (
            <span className="flex items-center gap-0.5 text-[10px] text-orange-600 bg-orange-50 dark:bg-orange-950 dark:text-orange-300 px-1.5 py-0.5 rounded-full border border-orange-200 dark:border-orange-800">
              🔒 Bllokuar
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {/* Status badge */}
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
            task.status === 'Done' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
            : task.status === 'In Progress' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
            : task.status === 'Review' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
          }`}>
            {getTaskStatusLabel(task.status)}
          </span>
          {/* Client approval state (portal Prano / Kërko ndryshime) */}
          {approval && (
            <span title={approval.title} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${approval.className}`}>
              {approval.label}
            </span>
          )}
          {/* Project name */}
          {projectName && (
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex items-center gap-1">
              <Target className="w-2.5 h-2.5" />{projectName}
            </span>
          )}
          {/* Comment count */}
          {commentCount > 0 && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <MessageSquare className="w-2.5 h-2.5" />{commentCount}
            </span>
          )}
          {/* Labels */}
          <TaskLabels labels={(task as any).labels} max={4} />
        </div>
        {/* Subtask progress bar */}
        {subtaskInfo && (
          <div className="mt-1.5">
            <div className="flex items-center gap-1.5 mb-0.5">
              <ListChecks className="w-2.5 h-2.5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">{subtaskInfo.done}/{subtaskInfo.total}</span>
            </div>
            <div className="h-1 bg-muted rounded-full overflow-hidden w-24">
              <div className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${subtaskInfo.total > 0 ? (subtaskInfo.done / subtaskInfo.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}
      </div>
      {/* Assignee initials — 28px, hash color, tooltip */}
      <div
        className="hidden sm:flex items-center gap-1.5 flex-shrink-0"
        title={seenLabel ? `${assigneeName} · ${seenLabel}` : assigneeName}
      >
        <div
          className="relative w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 ring-2 ring-white dark:ring-white/80 shadow-sm transition-transform duration-[180ms] ease-[cubic-bezier(.4,0,.2,1)] group-hover:scale-[1.06]"
          style={{ backgroundColor: initialsColor }}
        >
          {initials}
          {seenLabel && seen && (
            <span
              aria-label={seenLabel}
              className="absolute -bottom-1 -right-1 rounded-full bg-white px-[3px] text-[8px] font-extrabold leading-[11px] text-sky-600 shadow-sm dark:bg-card"
            >
              ✓✓
            </span>
          )}
        </div>
      </div>
      {/* Date — inline reschedule (preserves time-of-day) */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            onClick={(e) => e.stopPropagation()}
            disabled={!canEditRow}
            title={canEditRow ? 'Ndrysho afatin' : undefined}
            className={`flex items-center gap-1 text-xs whitespace-nowrap flex-shrink-0 mt-0.5 ${canEditRow ? 'hover:bg-muted' : ''} rounded px-1 py-0.5 transition-colors ${dateInfo.className}`}
          >
            {dateInfo.overdue && <AlertTriangle className="w-3 h-3" />}
            {dateInfo.text}
            {parseTaskDate(task.reminderAt) && !task.reminderSentAt && task.status !== 'Done' && (
              <ReminderBellIcon className="w-3 h-3 text-primary" aria-label="Ka kujtesë" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end" onClick={(e) => e.stopPropagation()}>
          <Calendar
            mode="single"
            selected={task.endDate ? new Date(task.endDate) : undefined}
            onSelect={async (d) => {
              if (!d) return;
              await onReschedule(task, d);
            }}
          />
        </PopoverContent>
      </Popover>
      {/* Hover quick actions */}
      {canEditRow && (
      <div
        className="absolute right-4 top-2.5 hidden group-hover:flex items-center gap-0.5 bg-background border border-border rounded-md shadow-sm px-0.5 py-0.5 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mark Done */}
        <button
          title="Shëno si Përfunduar"
          className="px-1.5 py-1 rounded text-xs hover:bg-muted text-emerald-600"
          onClick={async (e) => {
            e.stopPropagation();
            if (task.status === 'Done') return;
            await onMarkDone(task);
          }}
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        {/* Edit */}
        <button
          title="Edito"
          className="px-1.5 py-1 rounded text-xs hover:bg-muted text-foreground"
          onClick={(e) => { e.stopPropagation(); onSelect(task); }}
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
        {/* More */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="px-1.5 py-1 rounded text-xs hover:bg-muted text-foreground">
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="text-sm">
            <DropdownMenuItem onClick={() => { void onCopy(task); }}>
              Kopjo
            </DropdownMenuItem>
            {canDeleteRow && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => onRequestDelete(task.id)}
                >
                  Fshi
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      )}
      </div>
    </div>
  );
};

const TaskRow = React.memo(TaskRowInner, taskPropsEqual);
TaskRow.displayName = 'TaskRow';

export default TaskRow;
