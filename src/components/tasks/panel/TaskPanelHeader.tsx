import React from 'react';
import { Check, Eye, Maximize2, Minimize2, X } from 'lucide-react';
import type { Task } from '../../../types';
import { STATUS_OPTS } from './panelShared';
import { approvalBadge } from '../../../lib/taskApproval';

interface TaskPanelHeaderProps {
  task: Task;
  readOnly: boolean;
  statusOpen: boolean;
  /** Toggles the status menu and closes the other pickers. */
  onToggleStatus: () => void;
  onPickStatus: (status: string) => void;
  justCreated: boolean;
  activeWorkersCount: number;
  onExpand?: () => void;
  isExpanded?: boolean;
  onClose: () => void;
}

/** Mobile drag handle + header (status pill, freshness, expand/close) + the
 *  mobile status chips row. */
const TaskPanelHeader: React.FC<TaskPanelHeaderProps> = ({
  task,
  readOnly,
  statusOpen,
  onToggleStatus,
  onPickStatus,
  justCreated,
  activeWorkersCount,
  onExpand,
  isExpanded,
  onClose,
}) => {
  const statusMeta = STATUS_OPTS.find(s => s.v === task.status) || STATUS_OPTS[0];
  const approval = approvalBadge(task);
  return (
    <>
      {/* Mobile drag handle */}
      <div className="flex justify-center pb-0.5 pt-2 sm:hidden">
        <span className="h-[5px] w-[38px] rounded-full bg-border" />
      </div>

      {/* Header: status pill + freshness + expand/close */}
      <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 sm:px-[18px] sm:py-3">
        <div className="relative">
          <button
            type="button"
            disabled={readOnly}
            onClick={(e) => { e.stopPropagation(); onToggleStatus(); }}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold ${statusMeta.pill} disabled:cursor-default`}
          >
            {task.status === 'Done' && <Check className="h-3 w-3" />}
            {statusMeta.label}
            {!readOnly && <span className="text-[9px]">▼</span>}
          </button>
          {statusOpen && (
            <div
              className="absolute left-0 top-[calc(100%+6px)] z-40 hidden w-[190px] flex-col gap-px rounded-xl border bg-background p-1.5 shadow-[0_14px_36px_rgba(12,27,51,.2)] sm:flex"
              onClick={(e) => e.stopPropagation()}
            >
              {STATUS_OPTS.map(s => (
                <button
                  key={s.v}
                  type="button"
                  onClick={() => onPickStatus(s.v)}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-semibold text-foreground hover:bg-muted ${task.status === s.v ? 'bg-primary/10' : ''}`}
                >
                  <span className="h-[9px] w-[9px] rounded-full" style={{ background: s.dot }} />
                  <span className="flex-1">{s.label}</span>
                  {task.status === s.v && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>
        {approval && (
          <span title={approval.title} className={`max-w-[150px] truncate rounded-md px-2 py-0.5 text-[10.5px] font-bold sm:max-w-none ${approval.className}`}>{approval.label}</span>
        )}
        {justCreated && (
          <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700 dark:text-emerald-400">✓ U krijua tani</span>
        )}
        {activeWorkersCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-success">
            <Eye className="h-3 w-3 animate-pulse" />
            {activeWorkersCount} duke punuar
          </span>
        )}
        <span className="flex-1" />
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            title={isExpanded ? 'Palos' : 'Zgjero'}
            className="hidden h-[30px] w-[30px] items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground sm:flex"
          >
            {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          title="Mbyll"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Mobile: status as a chips row (design mobile), not an anchored menu */}
      {statusOpen && (
        <div className="flex flex-wrap gap-1.5 border-b px-4 py-2.5 sm:hidden">
          {STATUS_OPTS.map(s => (
            <button
              key={s.v}
              type="button"
              onClick={() => onPickStatus(s.v)}
              className={`flex min-h-[34px] items-center gap-1.5 rounded-full border-[1.5px] px-3 text-[11.5px] font-bold ${
                task.status === s.v ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-muted-foreground'
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: s.dot }} />
              {s.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
};

export default TaskPanelHeader;
