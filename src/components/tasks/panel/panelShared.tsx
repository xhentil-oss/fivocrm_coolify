// Shared pieces of the task detail panel (extracted verbatim from
// TaskDetailPanel — no behaviour change).
//
// ── Redesign (Aug 2026, Claude Design "Detyrat e Krijuara" + "Detyra e Krijuar
// Mobile") ─────────────────────────────────────────────────────────────────────
// The panel owns its own overlay: a centered 660px dialog on desktop, a bottom
// sheet on mobile. Status is a pill dropdown; the project and the assignee are
// picked through searchable pickers (anchored dropdown on desktop, full-screen
// sheet on mobile); dates/recurrence/priority are one-tap chips. Both mounts
// (TasksView, ProjectDetailView) render the SAME component with no wrapper.
import React from 'react';
import { Search } from 'lucide-react';
import { hasLiveSeriesSibling } from '../../../lib/recurringUtils';
import type { Task } from '../../../types';

export { hashColor } from '../taskListUtils';

// Quick-reaction emoji set — mirrors the chat reactions for a consistent feel.
export const COMMENT_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

export const STATUS_OPTS: Array<{ v: string; label: string; dot: string; pill: string }> = [
  { v: 'Todo', label: 'Për të bërë', dot: '#94A5BD', pill: 'bg-slate-200/80 text-slate-700 dark:bg-slate-700 dark:text-slate-300' },
  { v: 'In Progress', label: 'Në progres', dot: '#0EA5E9', pill: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  { v: 'Review', label: 'Rishikim', dot: '#D9A514', pill: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  { v: 'Done', label: 'E përfunduar', dot: '#22A565', pill: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
];

/** One-tap selection chip (dates, recurrence, priority). Active = filled navy. */
export const chipCls = (on: boolean) =>
  `rounded-full border-[1.5px] px-3 py-[5px] text-xs font-semibold transition-colors ${
    on ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-muted-foreground hover:border-primary'
  }`;

/** Label-grid row of the meta section (per the design). */
export const rowCls = 'grid grid-cols-[92px_1fr] items-center gap-2.5 border-b border-border/60 py-2 sm:grid-cols-[118px_1fr]';
export const rowLabelCls = 'text-[12.5px] font-semibold text-muted-foreground';

/** Section heading inside the scrollable body. */
export const sectionTitleCls = 'text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground';

/** Safe date parser for Firestore Timestamps / Date / string / undefined
 *  (falls back to NOW — only for fields that always have a value, like startDate). */
export const parseDate = (date: any): Date => {
  if (!date) return new Date();
  if (date instanceof Date) return date;
  if (date.toDate) return date.toDate();
  const parsed = new Date(date);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
};

// Format date compactly (Albanian months — the rest of this panel is sq-AL).
export const formatDateCompact = (date: Date) => {
  const months = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gush', 'Sht', 'Tet', 'Nën', 'Dhj'];
  return `${date.getDate()} ${months[date.getMonth()]}`;
};

export const timeStr = (d?: Date) => d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';

// Helper for priority colors
export const getPriorityColor = (priority?: string) => {
  switch (priority) {
    case 'urgent':
      return 'bg-error text-error-foreground';
    case 'high':
      return 'bg-warning text-warning-foreground';
    case 'medium':
      return 'bg-info text-info-foreground';
    case 'low':
      return 'bg-success text-success-foreground';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

export const getPriorityLabel = (priority?: string) => {
  switch (priority) {
    case 'urgent': return 'Urgjent';
    case 'high': return 'Lartë';
    case 'medium': return 'Mesatar';
    case 'low': return 'Ulët';
    default: return 'Mesatar';
  }
};

// A moved deadline RE-ARMS the due/overdue alerts: the cron marks
// dueNotificationSent/overdueNotificationSent once and skips flagged tasks, so
// without this reset a postponed task never alerted again — the new deadline
// came and went in silence.
export const rearmDeadlineAlerts: Partial<Task> = { dueNotificationSent: false, overdueNotificationSent: false };

// What leaving Done must also write — ONE rule for the main status pill and
// the subtask checkbox/form. Re-opening a Done recurring tip re-arms it ONLY
// when the series has no live occurrence left (child deleted by mistake →
// revive); re-arming while the child is alive would double the series on
// re-complete. `completedAt` is cleared (explicit null) so a re-opened task
// stops counting as "completed today".
export const reopenPatchFor = (t: Task, pool: Task[] | undefined | null): Partial<Task> => {
  if (t.status !== 'Done') return {};
  const rearm = !!t.isRecurring && !hasLiveSeriesSibling(t, pool);
  return { completedAt: null, ...(rearm ? { nextCycleCreated: false } : {}) };
};

/** Searchable picker body — anchored dropdown on sm+, full-screen bottom sheet
 * on mobile (the two design variants share this one implementation). */
export const PickerPanel: React.FC<{
  title: string;
  searchPlaceholder: string;
  query: string;
  onQuery: (v: string) => void;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, searchPlaceholder, query, onQuery, onClose, children }) => (
  <div
    className="max-sm:fixed max-sm:inset-0 max-sm:z-[70] max-sm:flex max-sm:flex-col max-sm:justify-end max-sm:bg-[#0C1B33]/50 sm:absolute sm:left-0 sm:top-[calc(100%+6px)] sm:z-40"
    onClick={(e) => { e.stopPropagation(); onClose(); }}
  >
    <div
      className="flex flex-col bg-background max-sm:h-[78dvh] max-sm:rounded-t-[22px] max-sm:shadow-[0_-12px_40px_rgba(4,12,30,.4)] sm:w-[330px] sm:overflow-hidden sm:rounded-[14px] sm:border sm:shadow-[0_14px_36px_rgba(12,27,51,.22)]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex justify-center pb-0.5 pt-2 sm:hidden">
        <span className="h-[5px] w-[38px] rounded-full bg-border" />
      </div>
      <div className="flex items-center gap-2 px-4 pb-1.5 pt-1 sm:hidden">
        <span className="flex-1 text-[14.5px] font-extrabold text-foreground">{title}</span>
        <button type="button" onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">✕</button>
      </div>
      <div className="px-3 pb-2 pt-2.5">
        <div className="flex items-center gap-2 rounded-full border bg-muted/50 px-3.5 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full min-w-[40px] bg-transparent text-[13px] font-semibold text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          {query && (
            <button type="button" onClick={() => onQuery('')} className="shrink-0 text-[11px] text-muted-foreground">✕</button>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-px overflow-y-auto px-2 pb-3 sm:max-h-[258px]">{children}</div>
    </div>
  </div>
);
