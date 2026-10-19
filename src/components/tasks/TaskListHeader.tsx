import React from 'react';
import { Plus, List, LayoutGrid, CalendarDays, GanttChart } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../ui/dialog';
import { QUICK_TASK_DIALOG_CLASS } from '../QuickTaskForm';

export type TaskViewMode = 'board' | 'calendar' | 'list' | 'timeline';

const VIEW_OPTIONS = [
  { v: 'list' as const, label: 'Listë', Icon: List },
  { v: 'board' as const, label: 'Bordi', Icon: LayoutGrid },
  { v: 'timeline' as const, label: 'Kronologji', Icon: GanttChart },
  { v: 'calendar' as const, label: 'Kalendar', Icon: CalendarDays },
];

interface TaskListHeaderProps {
  taskCount: number;
  myTaskCount: number;
  canEdit: boolean;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  /** The create form rendered inside the dialog (QuickTaskForm). */
  createForm: React.ReactNode;
  viewMode: TaskViewMode;
  onViewMode: (v: TaskViewMode) => void;
}

/** Title + "Detyrë e Re" dialog + the view switcher (segmented control). */
const TaskListHeader: React.FC<TaskListHeaderProps> = ({
  taskCount,
  myTaskCount,
  canEdit,
  createOpen,
  onCreateOpenChange,
  createForm,
  viewMode,
  onViewMode,
}) => (
  <div className="shrink-0 border-b bg-background">
    {/* Title + primary action */}
    <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-3">
      <div className="min-w-0">
        <h1 className="text-lg sm:text-xl font-semibold text-foreground leading-tight">Detyrat</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {taskCount} detyra · <span className="font-medium text-foreground/70">{myTaskCount} të miat</span>
        </p>
      </div>
      {canEdit && (
        <Dialog open={createOpen} onOpenChange={onCreateOpenChange}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-primary text-primary-foreground shadow-sm gap-1.5 rounded-lg shrink-0">
              <Plus className="w-4 h-4" />
              <span className="hidden xs:inline">Detyrë e Re</span>
            </Button>
          </DialogTrigger>
          <DialogContent className={QUICK_TASK_DIALOG_CLASS}>
            <DialogTitle className="sr-only">Detyrë e re</DialogTitle>
            {createForm}
          </DialogContent>
        </Dialog>
      )}
    </div>
    {/* View switcher — segmented control, full width on mobile */}
    <div className="px-4 pb-3">
      <div className="flex sm:inline-flex w-full sm:w-auto items-center rounded-lg bg-muted p-1 gap-0.5">
        {VIEW_OPTIONS.map(({ v, label, Icon }) => (
          <button
            key={v}
            type="button"
            onClick={() => onViewMode(v)}
            className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
              viewMode === v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="w-4 h-4" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>
    </div>
  </div>
);

export default TaskListHeader;
