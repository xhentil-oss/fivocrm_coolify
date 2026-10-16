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

/**
 * Was `member` employed (on payroll) during the month ending at `monthEnd`?
 * The date half of `memberSalaryForMonth` — start, leave, status — without
 * the amount, so capacity can be counted over exactly the months salary is.
 */
export function memberEmployedInMonth(member: TeamMember, monthEnd: Date): boolean {
  const left = memberEndDate(member);
  if (left) {
    if (monthEnd.getTime() >= left.getTime()) return false;
  } else if (member.status !== 'Active') {
    if (member.status !== 'Inactive') return false;
    // LEGACY fallback only: an Inactive row with no `leftAt` predates TeamsView
    // stamping it on deactivation. `updatedAt` is the last write, which for an
    // untouched leaver is the deactivation — but ANY later edit moves it and
    // resurrects past months, which is why the status change now writes
    // `leftAt` explicitly (and clears it with `null` on reactivation). The
    // types carry no `statusChangedAt` / `deactivatedAt`, so there is no better
    // signal for the legacy rows.
    const observedAt = parseDate((member as any).updatedAt);
    if (!observedAt || monthEnd.getTime() >= observedAt.getTime()) return false;
  }
  const start = memberStartDate(member);
  if (start && start.getTime() > monthEnd.getTime()) return false;
  return true;
}

/**
 * The `leftAt` a member edit must write, so leaving payroll is always an event
 * WITH A DATE (the `updatedAt` fallback is legacy and moves with every edit):
 *
 *   · new status not Inactive → `null` (explicit clear; reactivated / pending);
 *   · a date was picked → that date;
 *   · no date, was already Inactive WITHOUT a stored one (legacy row — the
 *     form's date box loaded EMPTY, so the empty box is not a choice the owner
 *     made) → freeze the pre-edit `updatedAt` (the legacy signal, before this
 *     very edit moves it); `now` when there is none;
 *   · no date otherwise → `now`. That covers "just switched to Inactive" AND
 *     "had a `leftAt` and the owner emptied the box": the form pre-fills the
 *     stored date, so an empty box there is the owner clearing it, and the UI
 *     copy promises "Bosh = nga sot e tutje". Keeping the old date (the
 *     previous rule) silently ignored that edit.
 * Returns `undefined` when nothing should be written (no date before or after).
 */
export function leftAtForStatusChange(
  prev: Pick<TeamMember, 'status'> & { leftAt?: unknown; updatedAt?: unknown },
  nextStatus: TeamMember['status'] | string,
  pickedDate: Date | null,
  now: Date = new Date(),
): Date | null | undefined {
  const prevLeft = parseDate(prev.leftAt);
  if (nextStatus !== 'Inactive') return prevLeft ? null : undefined;
  if (pickedDate) return pickedDate;
  if (prev.status === 'Inactive' && !prevLeft) return parseDate(prev.updatedAt) || now;
  return now;
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
  //   • No `leftAt`, status Inactive → LEGACY rows only (TeamsView now stamps
  //     `leftAt` on deactivation). The only observable signal is `updatedAt`;
  //     months that ended before it keep their cost, from it on cost 0. It is
  //     fragile — any later edit of the row moves it — hence the explicit stamp.
  //     With no `updatedAt` either there is no date at all, so we keep the
  //     historical behaviour (0 everywhere) rather than invent cost.
  //   • Any other non-Active status (`Pending` = invited, never accepted) was
  //     never on payroll → 0, unchanged.
  //   • Not yet employed in this month → no cost. Compared against monthEnd so
  //     someone who joined mid-month still costs that whole month (salary is
  //     recorded monthly, not pro-rated).
  if (!memberEmployedInMonth(member, monthEnd)) return 0;

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

/** Total monthly salary across all PEOPLE (rows grouped per userId) for the month ending at `monthEnd`. */
export function totalSalaryForMonth(members: TeamMember[] | undefined | null, monthEnd: Date): number {
  if (!members) return 0;
  return groupMembersByPerson(members).reduce((sum, p) => sum + personSalaryForMonth(p, monthEnd), 0);
}

const isEmptyValue = (v: unknown) => v === undefined || v === null || v === '';

/**
 * One PERSON = every `teamMembers` row with the same userId. The table holds one
 * row per (team, user): a person on two departments has two rows, often with the
 * salary on only one of them, and sometimes an old Inactive row (with its own
 * `leftAt` and history) next to the row of the team they moved to.
 *
 * Money and employment are resolved PER MONTH over the rows, never from one
 * merged record (a merge picked the highest-salary row even when it was the
 * Inactive one: a leaver's 80 000 L was charged into months after they had moved
 * to a 60 000 L row, its `leftAt` was dropped, and the other row's history
 * replaced theirs — so months before that history began cost 0):
 *   · salary in month M  = max over the rows of `memberSalaryForMonth(row, M)`
 *     (max, not sum: two rows of one person are one salary, not two);
 *   · employed in month M = ANY row is employed in M;
 *   · override rate       = `hourlyCostRate` of an active row, else of any row.
 * `profile` is for identity only — name, cost role, capacity, service lines —
 * taken from the preferred row (active first, then the highest salary) with
 * empty fields filled from the others. Never read money from it.
 */
export interface PersonRecord<T extends TeamMember = TeamMember> {
  /** `''` for a row with no userId (it is its own person). */
  userId: string;
  rows: T[];
  profile: T;
}

/** Group member rows into people (rows without a userId stay one person each), in first-seen order. */
export function groupMembersByPerson<T extends TeamMember>(members: readonly T[] | null | undefined): PersonRecord<T>[] {
  const out: PersonRecord<T>[] = [];
  const byUid = new Map<string, T[]>();
  const order: Array<T[]> = [];
  for (const m of members || []) {
    if (!m) continue;
    if (!m.userId) { order.push([m]); continue; }
    const g = byUid.get(m.userId);
    if (g) g.push(m); else { const rows = [m]; byUid.set(m.userId, rows); order.push(rows); }
  }
  for (const rows of order) out.push({ userId: rows[0].userId || '', rows, profile: personProfile(rows) });
  return out;
}

/** The one-row person (a single member treated as a person). */
export function personOf<T extends TeamMember>(member: T): PersonRecord<T> {
  return { userId: member.userId || '', rows: [member], profile: member };
}

function personProfile<T extends TeamMember>(rows: T[]): T {
  if (rows.length === 1) return rows[0];
  const sorted = [...rows].sort((a, b) =>
    (Number(b.status === 'Active') - Number(a.status === 'Active'))
    || ((Number(b.monthlySalary) || 0) - (Number(a.monthlySalary) || 0)));
  const merged: any = { ...sorted[0] };
  for (const r of sorted.slice(1)) {
    for (const [k, v] of Object.entries(r)) if (isEmptyValue(merged[k]) && !isEmptyValue(v)) merged[k] = v;
  }
  return merged as T;
}

/** Salary of the person for the month ending at `monthEnd`: the highest of their rows' salaries that month. */
export function personSalaryForMonth(person: Pick<PersonRecord, 'rows'>, monthEnd: Date): number {
  let best = 0;
  for (const r of person.rows) best = Math.max(best, memberSalaryForMonth(r, monthEnd));
  return best;
}

/** The row that pays `personSalaryForMonth` that month (`null` when it is 0). */
export function personSalaryRowForMonth<T extends TeamMember>(person: Pick<PersonRecord<T>, 'rows'>, monthEnd: Date): T | null {
  let best: T | null = null, bestSal = 0;
  for (const r of person.rows) {
    const s = memberSalaryForMonth(r, monthEnd);
    if (s > bestSal) { best = r; bestSal = s; }
  }
  return best;
}

/** Was the person employed in the month ending at `monthEnd` — on ANY of their rows? */
export function personEmployedInMonth(person: Pick<PersonRecord, 'rows'>, monthEnd: Date): boolean {
  return person.rows.some(r => memberEmployedInMonth(r, monthEnd));
}

/** Is any of the person's rows Active today? */
export function personIsActive(person: Pick<PersonRecord, 'rows'>): boolean {
  return person.rows.some(r => r.status === 'Active');
}

/** The explicit `hourlyCostRate` override: from an Active row first, else from any row. */
export function personHourlyCostOverride(person: Pick<PersonRecord, 'rows'>): number | undefined {
  const pick = (rows: TeamMember[]) => rows.map(r => Number(r.hourlyCostRate) || 0).filter(v => v > 0);
  const active = pick(person.rows.filter(r => r.status === 'Active'));
  if (active.length) return Math.max(...active);
  const any = pick(person.rows);
  return any.length ? Math.max(...any) : undefined;
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
