// Effective-dated salary lookup, so historical months are costed with the
// salary that applied then instead of today's figure.
//
// Model: TeamMember.salaryHistory is a list of { monthlySalary, effectiveFrom }.
// Each entry holds from its date until the next entry supersedes it.
//   - With history: the applicable salary for a month = the latest entry whose
//     effectiveFrom is on or before that month. If every entry starts AFTER the
//     month (e.g. the member was hired later), the salary is 0 for that month.
//   - Without history: fall back to the current monthlySalary for members still
//     on payroll that month (see `leftAt` below) — identical to the pre-history
//     behavior, so numbers only change once the owner records an actual change.
//   - Either way, nobody is charged for a month that ENDED before they existed
//     (see `memberStartDate`): the fallback used to bill today's salary back to
//     the beginning of time, so a year-to-date P&L charged 8 months of payroll
//     for a team hired in March. That is fabricated cost, not conservatism.

import type { TeamMember } from '../../types';
import { parseDate } from './financialAnalytics';
import { RECURRENCE_TIMEZONE, toZoned } from '../recurringUtils';

/**
 * Calendar day of an instant in the business timezone, as `YYYY-MM-DD`.
 *
 * `toISOString().slice(0,10)` reads the day in UTC, which is a DIFFERENT day
 * from the one the user picked for a good part of every Europe/Tirane evening:
 * a salary made effective at local midnight on 1 September is 31 August in UTC,
 * so two changes a day apart collapsed into one history entry. Same law as the
 * rest of the codebase — day math is zone-explicit (src/lib/recurringUtils.ts).
 */
function zonedDayKey(d: Date): string {
  const z = toZoned(d, RECURRENCE_TIMEZONE);
  const mm = String(z.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(z.getUTCDate()).padStart(2, '0');
  return `${z.getUTCFullYear()}-${mm}-${dd}`;
}

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

/**
 * The month this member stopped costing anything, if the owner recorded one.
 * `null` = still on payroll, or nobody wrote a termination date.
 */
export function memberEndDate(member: Pick<TeamMember, 'status'> & { leftAt?: unknown }): Date | null {
  return parseDate((member as any).leftAt);
}

/** Monthly salary in effect for `member` during the month ending at `monthEnd`. */
export function memberSalaryForMonth(member: TeamMember, monthEnd: Date): number {
  // ── Leaving payroll is an EVENT WITH A DATE, not a status ────────────────
  //
  // `status !== 'Active' → 0` with no date comparison silently improved the
  // P&L of every CLOSED month the moment someone left: eight months at 60 000 L
  // disappeared from the profit trend, the project fixed pool and the
  // department labour line, all from one dropdown change. A month that has
  // already been paid cannot become free.
  //
  // So:
  //   • `leftAt` recorded → months ENDING BEFORE it keep their cost, months at
  //     or after it cost 0. (Not pro-rated: the same whole-month convention as
  //     `memberStartDate` on the hiring side.)
  //   • No `leftAt`, status Inactive → we do not know when they left, and the
  //     only observable signal the record carries is `updatedAt` — the moment
  //     the row was last written, which for a leaver IS the moment they were
  //     flipped to Inactive. Months that ended before that instant are closed
  //     books and keep their cost; from that instant on, cost 0. With no
  //     `updatedAt` either there is no date at all, so we keep the historical
  //     behaviour (0 everywhere) rather than invent cost.
  //   • Any other non-Active status (`Pending` = invited, never accepted) was
  //     never on payroll → 0, unchanged.
  const left = memberEndDate(member);
  if (left) {
    if (monthEnd.getTime() >= left.getTime()) return 0;
  } else if (member.status !== 'Active') {
    if (member.status !== 'Inactive') return 0;
    const observedAt = parseDate((member as any).updatedAt);
    if (!observedAt || monthEnd.getTime() >= observedAt.getTime()) return 0;
  }

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

  // No recorded history → the current salary. The "is this member still on
  // payroll for THIS month" question was already answered above (leftAt /
  // status), so re-testing `status === 'Active'` here would undo that answer
  // for a leaver's closed months.
  return member.monthlySalary || 0;
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
  // The day is read in the business timezone — see `zonedDayKey`.
  const byDay = new Map<string, { monthlySalary: number; effectiveFrom: Date }>();
  for (const e of existing) {
    const d = parseDate(e.effectiveFrom);
    if (!d) continue;
    byDay.set(zonedDayKey(d), { monthlySalary: Number(e.monthlySalary) || 0, effectiveFrom: d });
  }
  return Array.from(byDay.values()).sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
}
