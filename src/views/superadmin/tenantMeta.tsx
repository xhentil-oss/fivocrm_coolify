import { getTimestampMs } from '../../lib/utils';

/**
 * Shared presentation bits for the platform console, so the tenant list and the
 * tenant detail page always label a status or a plan the same way.
 */

export const STATUS_META: Record<string, { label: string; cls: string }> = {
  trialing: { label: 'Provë', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  active: { label: 'Aktiv', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  past_due: { label: 'Pa paguar', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  suspended: { label: 'Pezulluar', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  canceled: { label: 'Anuluar', cls: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
};

export const PLAN_LABEL: Record<string, string> = {
  trial: 'Provë',
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
  enterprise: 'Enterprise',
};

/** Seats included per plan — mirrors PLAN_SEATS in api/_billingPlans.ts. */
export const PLAN_SEATS: Record<string, number> = {
  trial: 5,
  starter: 3,
  pro: 10,
  business: 25,
  enterprise: 1000,
};

export const fmtDate = (d: unknown): string => {
  const ms = getTimestampMs(d);
  return ms ? new Date(ms).toLocaleDateString('sq-AL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
};

/** yyyy-mm-dd for <input type="date">, or '' when there is no usable date. */
export const toDateInput = (d: unknown): string => {
  const ms = getTimestampMs(d);
  if (!ms) return '';
  const dt = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};
