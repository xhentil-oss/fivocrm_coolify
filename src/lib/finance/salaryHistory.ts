// Effective-dated salary lookup, so historical months are costed with the
// salary that applied then instead of today's figure.
//
// Model: TeamMember.salaryHistory is a list of { monthlySalary, effectiveFrom }.
// Each entry holds from its date until the next entry supersedes it.
//   - With history: the applicable salary for a month = the latest entry whose
//     effectiveFrom is on or before that month. If every entry starts AFTER the
//     month (e.g. the member was hired later), the salary is 0 for that month.
//   - Without history: fall back to the current monthlySalary for Active members
//     (0 for Inactive) — identical to the pre-history behavior, so numbers only
//     change once the owner records an actual change.
//   - Either way, nobody is charged for a month that ENDED before they existed
//     (see `memberStartDate`): the fallback used to bill today's salary back to
//     the beginning of time, so a year-to-date P&L charged 8 months of payroll
//     for a team hired in March. That is fabricated cost, not conservatism.

import type { TeamMember } from '../../types';
import { parseDate } from './financialAnalytics';

/**
 * The earliest month this member can cost anything.
 *
 * `hiredAt`/`startDate` when the owner recorded one, else `createdAt` — the day
 * the member record entered the system, which is the only employment signal the
 * data actually carries. `null` = unknown, and an unknown start never blocks a
 * charge (a member fixture with no dates behaves exactly as before).
 */
export function memberStartDate(member: Pick<TeamMember, 'createdAt'> & {
  hiredAt?: unknown; startDate?: unknown;
}): Date | null {
  return parseDate((member as any).hiredAt)
    || parseDate((member as any).startDate)
    || parseDate(member.createdAt);
}

/** Monthly salary in effect for `member` during the month ending at `monthEnd`. */
export function memberSalaryForMonth(member: TeamMember, monthEnd: Date): number {
  // Inactive members are off payroll — consistent with projectPnl/staffRevenue,
  // which only pool Active members. Prevents a departed employee (whose history
  // never drops to 0) from being charged into current/future months.
  if (member.status !== 'Active') return 0;

  // Not yet employed in this month → no cost. Compared against monthEnd so
  // someone who joined mid-month still costs that whole month (their salary is
  // recorded monthly, not pro-rated).
  const start = memberStartDate(member);
  if (start && start.getTime() > monthEnd.getTime()) return 0;

  const hist = (member.salaryHistory || [])
    .map(e => ({ monthlySalary: Number(e.monthlySalary) || 0, from: parseDate(e.effectiveFrom) }))
    .filter((e): e is { monthlySalary: number; from: Date } => !!e.from)
    .sort((a, b) => a.from.getTime() - b.from.getTime());

  if (hist.length > 0) {
    let applicable: number | null = null;
    for (const e of hist) {
      if (e.from.getTime() <= monthEnd.getTime()) applicable = e.monthlySalary;
      else break;
    }
    return applicable ?? 0;
  }

  // No recorded history → current salary for active members only.
  return member.status === 'Active' ? (member.monthlySalary || 0) : 0;
}

/** Total monthly salary across all members for the month ending at `monthEnd`. */
export function totalSalaryForMonth(members: TeamMember[] | undefined | null, monthEnd: Date): number {
  if (!members) return 0;
  return members.reduce((sum, m) => sum + memberSalaryForMonth(m, monthEnd), 0);
}

/**
 * Append a salary change to a member's history, keeping the timeline complete.
 * If the member has no history yet, a baseline entry for the OLD salary is
 * seeded first (from `baselineFrom`, e.g. their start date) so months before
 * the change still use the old amount rather than dropping to 0.
 * Returns the new history array (does not mutate the input).
 */
export function appendSalaryChange(
  member: Pick<TeamMember, 'monthlySalary' | 'salaryHistory'>,
  newSalary: number,
  effectiveFrom: Date,
  baselineFrom: Date = new Date(2000, 0, 1),
): Array<{ monthlySalary: number; effectiveFrom: Date }> {
  const existing = [...(member.salaryHistory || [])];
  const oldSalary = member.monthlySalary || 0;

  if (existing.length === 0 && oldSalary > 0 && baselineFrom.getTime() < effectiveFrom.getTime()) {
    existing.push({ monthlySalary: oldSalary, effectiveFrom: baselineFrom });
  }
  existing.push({ monthlySalary: newSalary, effectiveFrom });

  // De-dupe entries on the same day (keep the last) and sort ascending.
  const byDay = new Map<string, { monthlySalary: number; effectiveFrom: Date }>();
  for (const e of existing) {
    const d = parseDate(e.effectiveFrom);
    if (!d) continue;
    byDay.set(d.toISOString().slice(0, 10), { monthlySalary: Number(e.monthlySalary) || 0, effectiveFrom: d });
  }
  return Array.from(byDay.values()).sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
}
