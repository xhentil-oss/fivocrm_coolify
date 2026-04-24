/**
 * Unified status → color token mapping.
 *
 * Uses the semantic color tokens from tailwind.config.js:
 *   success  (green)  — Paid, Active, Completed, Won, Achieved, Done, Converted, On Track
 *   warning  (amber)  — Pending, In Progress, Planning, At Risk, Review, On Hold, Follow-up, Draft
 *   error    (red)    — Overdue, Rejected, Lost, Off Track, Cancelled, Suspended, Urgent
 *   info     (blue)   — New, Contacted, In Review, Reviewed
 *   tertiary (indigo) — In Progress (tasks), Qualified, Proposal
 *   accent   (pink)   — VIP, special
 *   muted    (gray)   — Unknown / default / Todo / Archived
 */

const STATUS_MAP: Record<string, string> = {
  // ── Success (green) ──
  paid:        'bg-success text-success-foreground',
  active:      'bg-success text-success-foreground',
  completed:   'bg-success text-success-foreground',
  won:         'bg-success text-success-foreground',
  achieved:    'bg-success text-success-foreground',
  done:        'bg-success text-success-foreground',
  converted:   'bg-success text-success-foreground',
  'on track':  'bg-success text-success-foreground',

  // ── Warning (amber) ──
  pending:     'bg-warning text-warning-foreground',
  'in progress': 'bg-warning text-warning-foreground',
  planning:    'bg-warning text-warning-foreground',
  'at risk':   'bg-warning text-warning-foreground',
  review:      'bg-warning text-warning-foreground',
  'on hold':   'bg-warning text-warning-foreground',
  'follow-up': 'bg-warning text-warning-foreground',
  draft:       'bg-warning text-warning-foreground',

  // ── Error (red) ──
  overdue:     'bg-error text-error-foreground',
  rejected:    'bg-error text-error-foreground',
  lost:        'bg-error text-error-foreground',
  'off track': 'bg-error text-error-foreground',
  cancelled:   'bg-error text-error-foreground',
  suspended:   'bg-error text-error-foreground',

  // ── Info (blue) ──
  new:         'bg-info text-info-foreground',
  contacted:   'bg-info text-info-foreground',
  'in review': 'bg-info text-info-foreground',
  reviewed:    'bg-info text-info-foreground',

  // ── Tertiary (indigo) ──
  qualified:   'bg-tertiary text-tertiary-foreground',
  proposal:    'bg-tertiary text-tertiary-foreground',

  // ── Partial payment (cyan/teal) ──
  partial:     'bg-cyan-500/20 text-cyan-700 dark:text-cyan-400',

  // ── Accent (pink) ──
  vip:         'bg-accent text-accent-foreground',

  // ── Muted (gray) ──
  todo:        'bg-muted text-muted-foreground',
  archived:    'bg-muted text-muted-foreground',
};

/** Returns a semantic Tailwind class string for any status label. */
export function getStatusColor(status: string | null | undefined): string {
  if (!status) return 'bg-muted text-muted-foreground';
  return STATUS_MAP[status.toLowerCase()] || 'bg-muted text-muted-foreground';
}

const PRIORITY_MAP: Record<string, string> = {
  urgent:  'bg-error text-error-foreground',
  high:    'bg-warning text-warning-foreground',
  medium:  'bg-info text-info-foreground',
  low:     'bg-muted text-muted-foreground',
};

/** Returns a semantic Tailwind class string for priority levels. */
export function getPriorityColor(priority: string | null | undefined): string {
  if (!priority) return 'bg-muted text-muted-foreground';
  return PRIORITY_MAP[priority.toLowerCase()] || 'bg-muted text-muted-foreground';
}
