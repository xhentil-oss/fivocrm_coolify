import React from 'react';
import { DndContext, DragOverlay, closestCorners, type DragStartEvent, type DragEndEvent, type SensorDescriptor, type SensorOptions } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Target, ListChecks } from 'lucide-react';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import type { Task } from '../../types';
import { KanbanColumn, SortableTaskCard } from './taskDnd';
import { isTaskOverdue, taskDeadline } from '../../lib/taskDue';
import { TASK_BOARD_COLUMNS, formatDateCompact, taskPropsEqual } from './taskListUtils';

interface TaskBoardCardProps {
  task: Task;
  isSelected: boolean;
  isBlocked: boolean;
  isBeingWorkedOn: boolean;
  projectName: string | null;
  subtaskDone?: number;
  subtaskTotal?: number;
  assigneeName: string;
  onSelect: (task: Task) => void;
}

/** One kanban card. Memoized like TaskRow — callbacks must be stable. */
const TaskBoardCard = React.memo<TaskBoardCardProps>(({
  task,
  isSelected,
  isBlocked,
  isBeingWorkedOn,
  projectName,
  subtaskDone,
  subtaskTotal,
  assigneeName,
  onSelect,
}) => {
  const dateInfo = formatDateCompact(taskDeadline(task), task.status);
  const isOverdue = isTaskOverdue(task);
  const subtaskInfo = subtaskTotal !== undefined ? { done: subtaskDone ?? 0, total: subtaskTotal } : undefined;
  const priorityBorder = task.priority === 'urgent' ? 'border-l-red-500' : task.priority === 'high' ? 'border-l-orange-500' : task.priority === 'medium' ? 'border-l-blue-400' : 'border-l-gray-300';

  return (
    <Card
      className={`p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-all border-l-[3px] ${priorityBorder} ${
        isSelected ? 'ring-2 ring-primary shadow-md' : ''
      } ${isOverdue ? 'bg-error/5' : ''}`}
      onClick={() => onSelect(task)}
    >
      {/* Title + Working / Blocked indicator */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className={`text-sm font-medium leading-snug ${task.status === 'Done' ? 'line-through text-muted-foreground' : ''}`}>
          {task.title}
        </p>
        <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
          {isBeingWorkedOn && (
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
          )}
          {isBlocked && (
            <span className="text-[9px] text-orange-600 bg-orange-50 dark:bg-orange-950 px-1 py-0.5 rounded-full border border-orange-200 dark:border-orange-800">🔒</span>
          )}
        </div>
      </div>

      {/* Project badge */}
      {projectName && (
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded mb-2">
          <Target className="w-2.5 h-2.5" />
          {projectName}
        </span>
      )}

      {/* Subtask progress bar */}
      {subtaskInfo && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
            <span className="flex items-center gap-1">
              <ListChecks className="w-2.5 h-2.5" />
              Nën-detyra
            </span>
            <span>{subtaskInfo.done}/{subtaskInfo.total}</span>
          </div>
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${subtaskInfo.total > 0 ? (subtaskInfo.done / subtaskInfo.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer: Assignee + Date */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-semibold text-primary">
            {assigneeName.slice(0, 2).toUpperCase()}
          </div>
          <span className="text-xs text-muted-foreground max-w-[80px] truncate">
            {assigneeName}
          </span>
        </div>
        <span className={`text-[11px] ${dateInfo.className}`}>
          {dateInfo.text}
        </span>
      </div>
    </Card>
  );
}, taskPropsEqual);
TaskBoardCard.displayName = 'TaskBoardCard';

interface TaskBoardViewProps {
  boardColumns: Map<string, Task[]>;
  sensors: SensorDescriptor<SensorOptions>[];
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  dragOverlayTitle: string | null | undefined;
  showOverlay: boolean;
  /** Props of one card, from the parent's precomputed lookup maps. */
  cardPropsFor: (task: Task) => Omit<TaskBoardCardProps, 'task' | 'onSelect'>;
  onSelect: (task: Task) => void;
}

const TaskBoardView: React.FC<TaskBoardViewProps> = ({
  boardColumns,
  sensors,
  onDragStart,
  onDragEnd,
  dragOverlayTitle,
  showOverlay,
  cardPropsFor,
  onSelect,
}) => (
  <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
    <div className="flex gap-3 sm:gap-4 p-3 sm:p-4 h-full overflow-x-auto pb-4">
      {TASK_BOARD_COLUMNS.map((column) => {
        const columnTasks = boardColumns.get(column.status) || [];
        const columnColor = column.status === 'Todo' ? 'bg-gray-400' : column.status === 'In Progress' ? 'bg-blue-500' : column.status === 'Review' ? 'bg-amber-500' : 'bg-emerald-500';

        return (
          <KanbanColumn key={column.id} id={column.status}>
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-2 h-2 rounded-full ${columnColor}`} />
              <h3 className="text-sm font-medium text-foreground">{column.title}</h3>
              <Badge variant="secondary" className="text-xs ml-auto">
                {columnTasks.length}
              </Badge>
            </div>

            <SortableContext items={columnTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2 flex-1 overflow-y-auto min-h-[60px]">
                {columnTasks.map((task) => (
                  <SortableTaskCard key={task.id} id={task.id}>
                    <TaskBoardCard task={task} onSelect={onSelect} {...cardPropsFor(task)} />
                  </SortableTaskCard>
                ))}
              </div>
            </SortableContext>
          </KanbanColumn>
        );
      })}
    </div>
    <DragOverlay>
      {showOverlay ? (
        <Card className="p-3 shadow-xl rotate-2 opacity-90 border-l-[3px] border-l-primary">
          <p className="text-sm font-medium">{dragOverlayTitle}</p>
        </Card>
      ) : null}
    </DragOverlay>
  </DndContext>
);

export default TaskBoardView;
