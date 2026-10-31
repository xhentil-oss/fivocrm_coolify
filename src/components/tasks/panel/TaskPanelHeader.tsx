import React from 'react';
import { Check, ChevronDown, Copy, Eye, Link2, Maximize2, Minimize2, MoreHorizontal, Trash2, X } from 'lucide-react';
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
  /** Statuses the rules would refuse (a recurring series the user may not
   *  drive) — rendered disabled, with `lockNote` under the list. */
  lockedStatuses?: string[];
  lockNote?: string;
  /** True once the body scrolled past the big title — the header shows it. */
  scrolled: boolean;
  activeWorkersCount: number;
  onExpand?: () => void;
  isExpanded?: boolean;
  onClose: () => void;
  // "⋯" menu (design): Dupliko detyrën · Kopjo lidhjen · Fshi detyrën.
  menuOpen: boolean;
  onToggleMenu: () => void;
  canDuplicate: boolean;
  onDuplicate: () => void;
  onCopyLink: () => void;
  canDelete: boolean;
  onRequestDelete: () => void;
}

const menuItemCls = 'flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[15px] text-foreground transition-colors hover:bg-muted';

/** Sticky translucent header: status pill · (scrolled) title · "⋯" menu + expand + close. */
const TaskPanelHeader: React.FC<TaskPanelHeaderProps> = ({
  task,
  readOnly,
  statusOpen,
  onToggleStatus,
  onPickStatus,
  lockedStatuses,
  lockNote,
  scrolled,
  activeWorkersCount,
  onExpand,
  isExpanded,
  onClose,
  menuOpen,
  onToggleMenu,
  canDuplicate,
  onDuplicate,
  onCopyLink,
  canDelete,
  onRequestDelete,
}) => {
  const statusMeta = STATUS_OPTS.find(s => s.v === task.status) || STATUS_OPTS[0];
  const approval = approvalBadge(task);
  const showStrip = !!approval || activeWorkersCount > 0;
  const iconBtnCls = 'flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-muted';
  return (
    <div className="sticky top-0 z-20 shrink-0">
      {/* Mobile drag handle */}
      <div className="flex justify-center bg-background/80 pb-0.5 pt-2 backdrop-blur-xl sm:hidden">
        <span className="h-[5px] w-[38px] rounded-full bg-border" />
      </div>

      <div
        className={`grid h-[60px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 bg-background/80 px-3 backdrop-blur-xl transition-colors duration-200 ${
          scrolled ? 'border-b border-border' : 'border-b border-transparent'
        }`}
      >
        {/* Status pill + anchored menu */}
        <div className="relative justify-self-start">
          <button
            type="button"
            disabled={readOnly}
            onClick={(e) => { e.stopPropagation(); onToggleStatus(); }}
            className="flex h-9 max-w-[46vw] items-center gap-2 rounded-full border border-border bg-card pl-2.5 pr-3 text-[14px] font-bold sm:max-w-none text-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:hover:bg-card"
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: statusMeta.dot }} />
            {task.status === 'Done' && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
            <span className="truncate">{statusMeta.label}</span>
            {!readOnly && <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2.4} />}
          </button>
          {statusOpen && (
            <div
              className="absolute left-0 top-[44px] z-40 flex w-[210px] flex-col rounded-xl border border-border bg-popover/90 p-1.5 shadow-[0_18px_48px_rgba(12,27,51,.18)] backdrop-blur-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {STATUS_OPTS.map(s => {
                const locked = !!lockedStatuses?.includes(s.v);
                return (
                <button
                  key={s.v}
                  type="button"
                  disabled={locked}
                  title={locked ? lockNote : undefined}
                  onClick={() => onPickStatus(s.v)}
                  className="grid h-10 grid-cols-[8px_1fr_auto] items-center gap-2.5 rounded-lg px-2.5 text-left text-[15px] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: s.dot }} />
                  <span>{s.label}</span>
                  {task.status === s.v && <Check className="h-4 w-4 text-primary" strokeWidth={2.6} />}
                </button>
                );
              })}
              {lockNote && (lockedStatuses?.length ?? 0) > 0 && (
                <div className="px-2.5 pb-1 pt-1.5 text-[12px] leading-snug text-muted-foreground">{lockNote}</div>
              )}
            </div>
          )}
        </div>

        {/* Title — fades in once the big heading scrolled away */}
        <div
          className={`min-w-0 truncate text-center text-[15px] font-bold text-foreground transition-opacity duration-200 ${scrolled ? 'opacity-100' : 'opacity-0'}`}
          aria-hidden={!scrolled}
        >
          {task.title}
        </div>

        {/* Right: ⋯ menu · expand (desktop) · close */}
        <div className="relative flex justify-self-end gap-2">
          <button
            type="button"
            aria-label="Më shumë"
            onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
            className={iconBtnCls}
          >
            <MoreHorizontal className="h-[18px] w-[18px]" />
          </button>
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              title={isExpanded ? 'Palos' : 'Zgjero'}
              className={`${iconBtnCls} hidden sm:flex`}
            >
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Mbyll" title="Mbyll" className={iconBtnCls}>
            <X className="h-4 w-4" strokeWidth={2.4} />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-[44px] z-40 flex w-[220px] flex-col rounded-xl border border-border bg-popover/90 p-1.5 shadow-[0_18px_48px_rgba(12,27,51,.18)] backdrop-blur-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {canDuplicate && (
                <button type="button" onClick={onDuplicate} className={menuItemCls}>
                  <Copy className="h-4 w-4 text-muted-foreground" /> Dupliko detyrën
                </button>
              )}
              <button type="button" onClick={onCopyLink} className={menuItemCls}>
                <Link2 className="h-4 w-4 text-muted-foreground" /> Kopjo lidhjen
              </button>
              {canDelete && (
                <>
                  <div className="mx-1.5 my-1 h-px bg-border" />
                  <button
                    type="button"
                    onClick={onRequestDelete}
                    className={`${menuItemCls} font-semibold text-red-600 hover:bg-red-500/10 dark:text-red-400`}
                  >
                    <Trash2 className="h-4 w-4" /> Fshi detyrën
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Client approval state + "duke punuar" — outside the design's header, kept as a thin strip */}
      {showStrip && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background/80 px-4 py-1.5 backdrop-blur-xl">
          {approval && (
            <span title={approval.title} className={`max-w-[220px] truncate rounded-md px-2 py-0.5 text-[10.5px] font-bold ${approval.className}`}>{approval.label}</span>
          )}
          {activeWorkersCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-success">
              <Eye className="h-3 w-3 animate-pulse" />
              {activeWorkersCount} duke punuar
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default TaskPanelHeader;
