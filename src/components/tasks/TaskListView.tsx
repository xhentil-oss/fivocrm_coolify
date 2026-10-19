import React from 'react';
import { DndContext, DragOverlay, closestCorners, type DragStartEvent, type DragEndEvent, type SensorDescriptor, type SensorOptions } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import type { Task } from '../../types';
import { SortableListItem } from './taskDnd';
import type { TaskGroup } from '../../hooks/useTaskGroups';

interface TaskListViewProps {
  groupBy: string;
  /** The page window of the flat list. */
  visibleTasks: Task[];
  /** The page window of the grouped list (groupBy !== 'none'). */
  taskGroups: TaskGroup[];
  /** Whether the filtered list is empty (empty state). */
  isEmpty: boolean;
  sensors: SensorDescriptor<SensorOptions>[];
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  /** Title shown in the drag overlay (null = no drag running). */
  dragOverlayTitle: string | null | undefined;
  showOverlay: boolean;
  onCreateFirst: () => void;
  renderRow: (task: Task) => React.ReactNode;
}

/** List view: drag-sortable flat list, or the grouped (non-draggable) list. */
const TaskListView: React.FC<TaskListViewProps> = ({
  groupBy,
  visibleTasks,
  taskGroups,
  isEmpty,
  sensors,
  onDragStart,
  onDragEnd,
  dragOverlayTitle,
  showOverlay,
  onCreateFirst,
  renderRow,
}) => {
  const sortableIds = React.useMemo(() => visibleTasks.map(t => t.id), [visibleTasks]);

  if (groupBy === 'none') {
    return (
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-2 p-3">
            {visibleTasks.map((task) => (
              <SortableListItem key={task.id} id={task.id}>
                {renderRow(task)}
              </SortableListItem>
            ))}

            {isEmpty && (
              <div className="text-center py-12 text-muted-foreground">
                <p>Asnjë detyrë</p>
                <Button variant="link" className="mt-2" onClick={onCreateFirst}>
                  Krijo detyrën e parë
                </Button>
              </div>
            )}
          </div>
        </SortableContext>
        <DragOverlay>
          {showOverlay ? (
            <div className="flex items-center gap-3 px-4 py-3 bg-background border shadow-xl rounded-md opacity-95">
              <div className="w-4 h-4 rounded-full bg-muted-foreground/20" />
              <span className="text-sm font-medium">{dragOverlayTitle}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    );
  }

  return (
    <div>
      {taskGroups.map(group => (
        <div key={group.key}>
          <div className="sticky top-0 z-[1] flex items-center gap-2 px-4 py-1.5 bg-muted/60 backdrop-blur border-b">
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">{group.label}</span>
            <span className="text-xs text-muted-foreground" title={group.tasks.length < group.total ? `${group.tasks.length} në këtë faqe nga ${group.total} gjithsej` : undefined}>
              {group.tasks.length < group.total ? `${group.tasks.length}/${group.total}` : group.total}
            </span>
          </div>
          <div className="space-y-2 p-3">
            {group.tasks.map(task => (
              <div key={task.id}>{renderRow(task)}</div>
            ))}
          </div>
        </div>
      ))}
      {isEmpty && (
        <div className="text-center py-12 text-muted-foreground">
          <p>Asnjë detyrë</p>
        </div>
      )}
    </div>
  );
};

/** Loading placeholder of the Tasks page (4 skeleton columns). */
export const TaskListSkeleton: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 w-32 skeleton rounded" />
          <div className="h-4 w-48 skeleton rounded" />
        </div>
        <div className="flex gap-3">
          <div className="h-10 w-48 skeleton rounded" />
          <div className="h-10 w-32 skeleton rounded" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map((col) => (
          <div key={col} className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="h-5 w-24 skeleton rounded" />
              <div className="h-5 w-8 skeleton rounded-full" />
            </div>
            <div className="space-y-3">
              {[1, 2, 3].map((card) => (
                <div key={card} className="p-4 bg-card rounded-lg border space-y-3">
                  <div className="h-5 w-3/4 skeleton rounded" />
                  <div className="h-4 w-full skeleton rounded" />
                  <div className="flex gap-2">
                    <div className="h-5 w-16 skeleton rounded" />
                    <div className="h-5 w-20 skeleton rounded" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TaskListView;
