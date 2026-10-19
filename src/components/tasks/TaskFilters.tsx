import React from 'react';
import { User, Users, X, Play, Clock, CheckCircle2, CircleDot, AlertTriangle, Tag as TagIcon } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

export type TaskGroupBy = 'none' | 'assignee' | 'priority' | 'project' | 'dueDate';

export interface TaskStats { todo: number; inProgress: number; review: number; done: number; overdue: number }

interface TaskFiltersProps {
  searchQuery: string;
  onSearch: (q: string) => void;
  /** Count of every (non-status-filtered) task — the "Të gjitha" chip. */
  totalCount: number;
  stats: TaskStats;
  filterStatus: string;
  onFilterStatus: (s: string) => void;
  currentUserId?: string;
  filterAssignee: string;
  onFilterAssignee: (v: string) => void;
  assigneeOptions: { userId: string; label: string; email: string }[];
  showGroupBy: boolean;
  groupBy: TaskGroupBy;
  onGroupBy: (g: TaskGroupBy) => void;
  allLabels: string[];
  filterLabel: string;
  onFilterLabel: (l: string) => void;
}

/** Search + status chips + assignee / grouping / label filters. */
const TaskFilters: React.FC<TaskFiltersProps> = ({
  searchQuery,
  onSearch,
  totalCount,
  stats: taskStats,
  filterStatus,
  onFilterStatus,
  currentUserId,
  filterAssignee,
  onFilterAssignee,
  assigneeOptions,
  showGroupBy,
  groupBy,
  onGroupBy,
  allLabels,
  filterLabel,
  onFilterLabel,
}) => (
  <div className="shrink-0 border-b bg-muted/20 px-4 py-2.5 space-y-2.5">
    {/* Search */}
    <div className="relative">
      <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        placeholder="Kërko detyra..."
        value={searchQuery}
        onChange={(e) => onSearch(e.target.value)}
        className="w-full h-9 pl-9 pr-9 text-base sm:text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
      />
      {searchQuery && (
        <button onClick={() => onSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
    {/* Status chips — horizontally scrollable */}
    <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {([
        { key: 'all', label: 'Të gjitha', count: totalCount, Icon: null, on: 'bg-slate-600 text-white', off: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
        { key: 'Todo', label: 'Për të bërë', count: taskStats.todo, Icon: CircleDot, on: 'bg-slate-700 text-white', off: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
        { key: 'In Progress', label: 'Në progres', count: taskStats.inProgress, Icon: Play, on: 'bg-blue-500 text-white', off: 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300' },
        { key: 'Review', label: 'Rishikim', count: taskStats.review, Icon: Clock, on: 'bg-amber-500 text-white', off: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300' },
        { key: 'Done', label: 'Përfunduar', count: taskStats.done, Icon: CheckCircle2, on: 'bg-emerald-500 text-white', off: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300' },
        // Also shown when the persisted filter IS 'overdue' — otherwise, once
        // the overdue tasks are cleared, the user is stranded inside an
        // invisible filter ("Asnjë detyrë") with no active chip to click off.
        ...(taskStats.overdue > 0 || filterStatus === 'overdue' ? [{ key: 'overdue', label: 'Vonuar', count: taskStats.overdue, Icon: AlertTriangle, on: 'bg-red-500 text-white', off: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300' }] : []),
      ]).map(({ key, label, count, Icon, on, off }) => (
        <button
          key={key}
          onClick={() => onFilterStatus(key)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${filterStatus === key ? on : off}`}
        >
          {Icon && <Icon className="w-3 h-3" />}{label}
          <span className="tabular-nums opacity-80">{count}</span>
        </button>
      ))}
    </div>
    {/* Assignee + grouping */}
    <div className="flex items-center gap-2">
      {/* One-tap "my tasks" (Asana's most-used filter) */}
      {currentUserId && (
        <button
          onClick={() => onFilterAssignee(filterAssignee === currentUserId ? 'all' : currentUserId)}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
            filterAssignee === currentUserId
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:text-foreground'
          }`}
        >
          <User className="w-3 h-3" />Të miat
        </button>
      )}
      <Select value={filterAssignee} onValueChange={onFilterAssignee}>
        <SelectTrigger className="h-9 text-xs flex-1 min-w-0">
          <User className="w-3.5 h-3.5 mr-1 shrink-0 text-muted-foreground" />
          <SelectValue placeholder="Të gjithë personat" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Të gjithë personat</SelectItem>
          <SelectItem value="unassigned">Pa caktuar</SelectItem>
          {assigneeOptions.map((m) => (
            <SelectItem key={m.userId} value={m.userId}>
              {m.label}{m.email ? ` · ${m.email}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showGroupBy && (
        <Select value={groupBy} onValueChange={(v) => onGroupBy(v as TaskGroupBy)}>
          <SelectTrigger className="h-9 text-xs flex-1 min-w-0">
            <Users className="w-3.5 h-3.5 mr-1 shrink-0 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Pa grupim</SelectItem>
            <SelectItem value="assignee">Sipas personit</SelectItem>
            <SelectItem value="priority">Sipas prioritetit</SelectItem>
            <SelectItem value="project">Sipas projektit</SelectItem>
            <SelectItem value="dueDate">Sipas afatit</SelectItem>
          </SelectContent>
        </Select>
      )}
      {allLabels.length > 0 && (
        <Select value={filterLabel} onValueChange={onFilterLabel}>
          <SelectTrigger className="h-9 text-xs flex-1 min-w-0">
            <TagIcon className="w-3.5 h-3.5 mr-1 shrink-0 text-muted-foreground" />
            <SelectValue placeholder="Të gjitha etiketat" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Të gjitha etiketat</SelectItem>
            {allLabels.map(l => (
              <SelectItem key={l} value={l}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {(filterAssignee !== 'all' || filterLabel !== 'all') && (
        <button
          onClick={() => { onFilterAssignee('all'); onFilterLabel('all'); }}
          className="text-xs text-muted-foreground hover:text-foreground underline whitespace-nowrap shrink-0"
        >
          Pastro
        </button>
      )}
    </div>
  </div>
);

export default TaskFilters;
