/**
 * The project form's billing + work-cycle inputs, parsed and defaulted in one
 * place (unit-tested) so the create and the edit handler cannot disagree.
 *
 * Price model for quarterly / yearly (decided 2026-10-16): the owner types the
 * MONTHLY fee and a prepay discount; `budget` (the fee per billing cycle) is
 * `monthly × months × (1 − discount)`. The monthly list price and the discount
 * are stored next to it so the form can show them again.
 */
import type { Project } from '../../types';
import {
  CYCLE_MONTHS,
  billingPeriodKey,
  cycleDate,
  cycleFeeFromMonthly,
  isAnchoredFrequency,
  isSupportedBillingFrequency,
  monthStartInZone,
  projectWorkCycle,
  zonedMonthValue,
  type WorkCycle,
} from './projectCycles';

export function parseWorkCycleInput(raw: unknown): WorkCycle | null {
  return raw === 'weekly' || raw === 'monthly' ? raw : null;
}

/** 'YYYY-MM' → the 1st of that month (business zone); anything else → null. */
export function parseAnchorMonthInput(raw: unknown): Date | null {
  const m = typeof raw === 'string' ? /^(\d{4})-(\d{2})$/.exec(raw.trim()) : null;
  if (!m) return null;
  const month = Number(m[2]) - 1;
  if (month < 0 || month > 11) return null;
  return monthStartInZone(Number(m[1]), month);
}

/** Payment terms in days (0–120); empty / invalid → null (the engine's default). */
export function parseDueDaysInput(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 0 && n <= 120 ? n : null;
}

export function parseMoneyInput(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parsePctInput(raw: unknown): number | null {
  const n = parseMoneyInput(raw);
  return n === null ? null : Math.min(100, n);
}

/** Months one invoice of this frequency covers (1 for anything not anchored). */
export function cycleMonthsFor(frequency: string): number {
  return isAnchoredFrequency(frequency) && isSupportedBillingFrequency(frequency) ? CYCLE_MONTHS[frequency] : 1;
}

/**
 * Initial value of the form's "Cikli i punës". A project with the field keeps
 * it; a legacy project shows what the reset job would do for it today; a NEW
 * project starts with none (switching "Faturim periodik" on suggests monthly).
 */
export function initialWorkCycle(project: Partial<Project> | null | undefined): WorkCycle | 'none' {
  if (!project) return 'none';
  return projectWorkCycle(project as any) ?? 'none';
}

/** Initial MONTHLY fee shown for a quarterly / yearly project. */
export function initialMonthlyFee(project: Partial<Project> | null | undefined): string {
  if (!project) return '';
  if (typeof project.listMonthlyFee === 'number' && project.listMonthlyFee > 0) return String(project.listMonthlyFee);
  const budget = Number(project.budget) || 0;
  if (budget <= 0) return '';
  const months = cycleMonthsFor(project.recurringFrequency || 'monthly');
  const pct = Number(project.prepayDiscountPct) || 0;
  const monthly = budget / months / (1 - Math.min(99.99, pct) / 100);
  return String(Math.round(monthly * 100) / 100);
}

/**
 * Default "Muaji i nisjes së kontratës" (YYYY-MM).
 *   · stored anchor → it;
 *   · an existing monthly retainer switching to a long cycle → the first month
 *     NOT yet billed monthly (this month when it is still unbilled, else next
 *     month) — so no month is paid twice, monthly and again inside the year;
 *   · a new project → its start date's month, else the current month.
 */
export function defaultAnchorMonth(project: Partial<Project> | null | undefined, startDateInput: string, now: Date = new Date()): string {
  const stored = cycleDate(project?.billingAnchorAt);
  if (stored) return zonedMonthValue(stored);
  if (project?.isRecurring && project.lastInvoicePeriodKey) {
    const thisMonth = billingPeriodKey('monthly', now);
    if (project.lastInvoicePeriodKey === thisMonth) {
      const next = new Date(monthStartInZone(Number(thisMonth.slice(0, 4)), Number(thisMonth.slice(5, 7)) - 1).getTime() + 32 * 86_400_000);
      return zonedMonthValue(next);
    }
    return thisMonth;
  }
  const start = startDateInput ? cycleDate(startDateInput + 'T12:00:00') : null;
  return zonedMonthValue(start || now);
}

/** The cycle fee (`budget`) the form saves for a quarterly / yearly project. */
export function cycleBudgetFromForm(frequency: string, monthlyFee: number | null, discountPct: number | null): number | null {
  if (!isAnchoredFrequency(frequency) || monthlyFee === null) return null;
  return cycleFeeFromMonthly(monthlyFee, frequency, discountPct);
}
