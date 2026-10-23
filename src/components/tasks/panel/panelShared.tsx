// Shared pieces of the task detail panel (extracted verbatim from
// TaskDetailPanel — no behaviour change).
//
// ── Redesign (Oct 2026, Claude Design "Task Sheet") ──────────────────────────
// LAYOUT CONTRACT (from `Task Sheet.dc.html`, MedRise design system — tokens
// mapped onto the app's own navy/cyan palette and DM Sans):
//   · a sticky translucent header (status pill · title that fades in on scroll
//     · "⋯" menu [Dupliko / Kopjo lidhjen / Fshi] · close);
//   · the body is a column of GROUPED CARDS with an eyebrow label above each
//     (Detajet / Koha / Organizimi / Përshkrimi / Aktiviteti): every row is
//     `[30px icon tile] [label] [value] [chevron]`, min-height 52px, divider
//     indented to the label (58px), and a tap expands the row INLINE into
//     40px pill options (one open row at a time);
//   · priority is a 4-segment control; labels live inline in the tag row;
//   · a dark pill toast at the top; a bottom bar "Ndryshuar nga X · date" +
//     Ruaj; a centred two-button delete confirmation.
// The parents still position the panel (side panel on desktop, bottom sheet on
// mobile) — the panel only brings the content. The sections below the design's
// scope (approval, time, subtasks, attachments, chat, comments) keep their
// behaviour and render as the same kind of card.
//
// ── Previous redesign (Aug 2026, "Detyrat e Krijuara" + "Detyra e Krijuar
// Mobile") ─────────────────────────────────────────────────────────────────────
// Status is a pill dropdown; the project and the assignee are searchable; the
// dates/recurrence/priority are one-tap chips. Both mounts (TasksView,
// ProjectDetailView) render the SAME component with no wrapper.
import React from 'react';
import { ChevronRight } from 'lucide-react';
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

/** Section heading inside the scrollable body. */
export const sectionTitleCls = 'text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground';

// ── Task Sheet primitives ──────────────────────────────────────────────────────

/** Eyebrow above a card group ("DETAJET", "KOHA", …). */
export const eyebrowCls = 'px-4 text-[12px] font-bold uppercase tracking-[0.08em] text-muted-foreground';

/** Grouped card: white surface, hairline border, 18px radius, xs shadow. */
export const cardCls = 'overflow-hidden rounded-[18px] border border-border bg-card shadow-[0_1px_2px_rgba(12,27,51,0.06)]';

/** The indented hairline between two rows of a card (starts at the label). */
export const RowDivider: React.FC = () => <div className="ml-[58px] h-px bg-border" />;

/** 40px pill option (the design's inline choices). Selected = filled primary. */
export const pillCls = (on: boolean) =>
  `inline-flex h-10 items-center rounded-full border px-4 text-[14px] font-semibold transition-colors disabled:cursor-default ${
    on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:border-primary/60'
  }`;

/** Rounded time/date input that sits next to the pills (mono digits). */
export const pillInputCls = 'h-10 rounded-full border border-border bg-muted px-3.5 font-mono text-[14px] text-foreground outline-none focus:ring-2 focus:ring-primary/30';

/** Padding of the area that opens under a row (aligned with the label). */
export const rowBodyCls = 'flex flex-wrap gap-2 px-4 pb-3.5 pl-[58px] pt-0.5';

export type TileTone = 'brand' | 'danger' | 'warning' | 'info' | 'neutral';
const TILE_TONES: Record<TileTone, string> = {
  brand: 'bg-primary/10 text-primary',
  danger: 'bg-red-500/10 text-red-600 dark:text-red-400',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  neutral: 'bg-muted text-muted-foreground',
};

/** 30px icon tile at the start of a row. */
export const IconTile: React.FC<{ tone?: TileTone; className?: string; children: React.ReactNode }> = ({ tone = 'brand', className = '', children }) => (
  <span className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg ${TILE_TONES[tone]} ${className}`}>
    {children}
  </span>
);

/**
 * One row of a card: `[tile] [label] [value] [chevron]`, 52px tall. When `onToggle`
 * is given the row is a button and the chevron rotates while `open`; the caller
 * renders what opens underneath (`rowBodyCls`). `static` rows keep the grid
 * but no chevron.
 */
export const SheetRow: React.FC<{
  tile: React.ReactNode;
  label: React.ReactNode;
  value?: React.ReactNode;
  /** Class of the value cell (colour/weight per state). */
  valueClassName?: string;
  open?: boolean;
  onToggle?: () => void;
  disabled?: boolean;
  chevron?: boolean;
  title?: string;
}> = ({ tile, label, value, valueClassName = 'text-[15px] text-foreground/80', open = false, onToggle, disabled, chevron = true, title }) => {
  // The label column sizes to its word (labels are short, fixed Albanian
  // words); the VALUE gets every remaining pixel and truncates. A percentage
  // max-width on the value resolved against its own auto track, so it was
  // clamped to half of itself ("9 Te…", "Asnj…").
  const grid = `grid w-full items-center gap-3 px-4 py-[11px] text-left min-h-[52px] ${chevron ? 'grid-cols-[30px_auto_minmax(0,1fr)_16px]' : 'grid-cols-[30px_auto_minmax(0,1fr)]'}`;
  const inner = (
    <>
      {tile}
      <span className="whitespace-nowrap text-[16px] font-semibold text-foreground">{label}</span>
      <span className={`min-w-0 justify-self-end max-w-full truncate text-right ${valueClassName}`}>{value}</span>
      {chevron && (
        <ChevronRight
          className={`h-4 w-4 text-muted-foreground/70 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          strokeWidth={2.4}
        />
      )}
    </>
  );
  if (!onToggle) return <div className={grid} title={title}>{inner}</div>;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-expanded={open}
      title={title}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className={`${grid} bg-transparent transition-colors hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-transparent`}
    >
      {inner}
    </button>
  );
};

/** Human day label for the sheet values: "Sot", "Nesër", "Dje", else "22 Tet". */
export const dayLabel = (d: Date, now: Date = new Date()) => {
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const tom = new Date(now); tom.setDate(now.getDate() + 1);
  const yes = new Date(now); yes.setDate(now.getDate() - 1);
  if (same(d, now)) return 'Sot';
  if (same(d, tom)) return 'Nesër';
  if (same(d, yes)) return 'Dje';
  return formatDateCompact(d);
};

/** "Sot, 17:00" / "22 Tet, 09:30" — the value cell of a dated row. */
export const dayTimeLabel = (d: Date) => `${dayLabel(d)}, ${timeStr(d)}`;

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
