import React, { useMemo, useState } from 'react';
import { useCollection } from '../hooks/useFirestore';
import { usePermissions } from '../contexts/PermissionsContext';
import { useAuth } from '../contexts/AuthContext';
import { useUserNames } from '../hooks/useUserNames';
import { toAll } from '../lib/utils';
import {
  getExpenseDate,
  expenseIsCountable,
  isProjectDirectExpense,
  EXPENSE_CATEGORY_SALARY,
} from '../lib/finance/financialAnalytics';
import { memberSalaryForMonth } from '../lib/finance/salaryHistory';
import { useMemberCompensation } from '../hooks/useMemberCompensation';
import { Award, TrendingUp, DollarSign, Users, ChevronDown, ChevronUp, Info, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import type { Project, TeamMember, Expense } from '../types';

// ─── Bonus Calculation Logic ──────────────────────────────────────────────────
//
//  MODEL: "Tiered Net Revenue Sharing" — used by top digital agencies
//
//  1. Net contribution per project =
//       project.budget
//       − direct project expenses  (Expense.projectId == project.id)
//       − allocated office expenses (general Expense with no projectId, same month,
//                                    divided equally across all completed projects)
//       − member salary costs       (for each memberUserId: salary ÷ projectCount
//                                    to avoid double-counting across projects)
//
//  2. Threshold = monthly salary × 3
//     (covers: 1× salary paid + 1× employer costs/overhead + 1× company margin)
//
//  3. Bonus tiers (on the surplus above threshold):
//     · 3× → 4× salary band   →  8% of that band
//     · 4× → 5× salary band   → 12% of that band
//     · above 5× salary       → 18% of the remainder
//
//  Example @ 80,000 L/mo salary, buxhet 600,000 L, shp.direkte 20,000 L,
//           shp.zyrë 10,000 L, rroga anëtarësh 30,000 L  → neto = 540,000 L
//     Threshold  = 240,000 L  (no bonus below this)
//     Surplus    = 300,000 L
//     Tier 1     = min(300,000 L, 80,000 L) × 8%  =  6,400 L
//     Tier 2     = min(220,000 L, 80,000 L) × 12% =  9,600 L
//     Tier 3     = 140,000 L × 18%                = 25,200 L
//     TOTAL BONUS = 41,200 L
//
// ─────────────────────────────────────────────────────────────────────────────

interface BonusTier {
  label: string;
  band: number;
  rate: number;
  amount: number;
  reached: boolean;
}

interface BonusResult {
  totalBonus: number;
  netContribution: number;
  threshold: number;
  surplus: number;
  tiers: BonusTier[];
  projects: { id: string; name: string; budget: number; expenses: number; officeExpenses: number; salaryCosts: number; net: number }[];
}

function calculateBonus(salary: number, netContribution: number, salary_tiers = [3, 4, 5], rates = [0.08, 0.12, 0.18]): Omit<BonusResult, 'projects'> {
  const threshold = salary * salary_tiers[0];
  const surplus = Math.max(0, netContribution - threshold);
  const band = salary; // each tier spans 1× salary width

  const tier1Amount = Math.min(surplus, band) * rates[0];
  const tier2Amount = Math.min(Math.max(0, surplus - band), band) * rates[1];
  const tier3Amount = Math.max(0, surplus - band * 2) * rates[2];
  const totalBonus = tier1Amount + tier2Amount + tier3Amount;

  return {
    totalBonus,
    netContribution,
    threshold,
    surplus,
    tiers: [
      {
        label: `${salary_tiers[0]}× → ${salary_tiers[1]}× rrogë`,
        band,
        rate: rates[0] * 100,
        amount: tier1Amount,
        reached: surplus > 0,
      },
      {
        label: `${salary_tiers[1]}× → ${salary_tiers[2]}× rrogë`,
        band,
        rate: rates[1] * 100,
        amount: tier2Amount,
        reached: surplus > band,
      },
      {
        label: `Mbi ${salary_tiers[2]}× rrogë`,
        band: Math.max(0, surplus - band * 2),
        rate: rates[2] * 100,
        amount: tier3Amount,
        reached: surplus > band * 2,
      },
    ],
  };
}

function getProgressWidth(value: number, max: number) {
  if (max <= 0) return '0%';
  return `${Math.min(100, (value / max) * 100).toFixed(1)}%`;
}

// ─────────────────────────────────────────────────────────────────────────────

const MONTHS = [
  'Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor',
  'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor',
];

const BonusView: React.FC = () => {
  const permissions = usePermissions();
  const { user } = useAuth();
  // Only actual admins/owners/managers can see everyone's bonuses
  const isAdmin = permissions.isAdmin || permissions.isOwner || permissions.isManager;
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth().toString());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear().toString());
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [showExplainer, setShowExplainer] = useState(false);

  // ── The page is admin/manager-only DATA, not just an admin-only VIEW ───────
  //
  // Every figure here is derived from the whole tenant: all `teamMembers` (with
  // `monthlySalary` and `salaryHistory`), all `projects`, all `expenses` — and
  // salary payments ARE expenses (`category: 'Salary'`, `memberId` set). The
  // per-member filtering used to happen in React AFTER the fetch, so any signed-in
  // employee — a Viewer included — had every colleague's salary sitting in their
  // browser. Filtering in the UI is not access control.
  //
  // There is no narrower query that still produces a correct bonus: the office
  // overhead split needs every project of the period and every general expense of
  // the month. So a non-privileged viewer fetches NOTHING and is told where the
  // number comes from, instead of being served a tenant-wide dump or a figure
  // computed from data they may not read. Serving per-member figures from a
  // server endpoint is the follow-up (workspace/FINANCE_BUGS_2026_09_18.md #4).
  const { data: rawTeamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
    skipTeamFilter: true,
    skip: !isAdmin,
  });
  // Salary now lives in `teamMemberComp`, readable only by the member themselves
  // and the tenant's admins/managers — the rules half of the fix above. Dual
  // read: the comp document wins where it exists, the legacy `teamMembers`
  // fields are the fallback until the backfill has run.
  const { members: teamMembers } = useMemberCompensation(rawTeamMembers, { skip: !isAdmin });

  const { getName, getInitials } = useUserNames(teamMembers || []);
  const { data: projects } = useCollection<Project>('projects', {
    skipTeamFilter: true,
    skip: !isAdmin,
  });
  const { data: expenses } = useCollection<Expense>('expenses', {
    skipTeamFilter: true,
    skip: !isAdmin,
  });

  // Filter projects completed in the selected month/year
  // Uses lastCompletedAt (set on completion) first, falls back to updatedAt
  const periodProjects = useMemo(() => {
    if (!projects) return [];
    const month = parseInt(selectedMonth);
    const year = parseInt(selectedYear);
    return projects.filter(p => {
      // Count recurring projects by lastCompletedAt; regular by status=Completed
      const isCompleted = p.status === 'Completed' || ((p as any).isRecurring && (p as any).lastCompletedAt);
      if (!isCompleted) return false;
      // Use responsibleUserId first; fall back to createdByUserId so projects
      // created before the responsibleUserId field existed are still counted
      const owner = p.responsibleUserId || p.createdByUserId;
      if (!owner) return false;
      // Prefer lastCompletedAt over updatedAt for accuracy
      const raw = (p as any).lastCompletedAt || p.updatedAt;
      const date = raw ? new Date(raw) : null;
      if (!date || isNaN(date.getTime())) return false;
      return date.getMonth() === month && date.getFullYear() === year;
    });
  }, [projects, selectedMonth, selectedYear]);

  // Build per-member bonus calculations (all members)
  const allMemberResults = useMemo(() => {
    if (!teamMembers) return [];

    const month = parseInt(selectedMonth);
    const year = parseInt(selectedYear);

    // ── 0. Salary lookup from Expenses (category='Salary', memberId set) ─────
    // If an expense with category 'Salary' is linked to a member via memberId,
    // use that amount as their salary for this period instead of monthlySalary.
    // `getExpenseDate()` — NOT `e.date`. This was the only place in the codebase
    // reading `e.date` without the createdAt fallback, and since the form never
    // wrote `date` at all, every manually-entered expense was silently skipped:
    // this map stayed empty and `totalOfficeExpenses` below stayed 0, so bonus
    // maths saw only cron-generated rows.
    // Last instant of the selected month — the shape `memberSalaryForMonth` wants.
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
    /** Is this expense booked inside the bonus period? */
    const inPeriod = (d: Date | null | undefined): boolean =>
      !!d && d.getMonth() === month && d.getFullYear() === year;

    const salaryFromExpenses = new Map<string, number>();
    (expenses || []).forEach(e => {
      if (e.category !== EXPENSE_CATEGORY_SALARY) return;
      if (!expenseIsCountable(e)) return;
      const memberId = e.memberId;
      if (!memberId) return;
      if (!inPeriod(getExpenseDate(e))) return;
      salaryFromExpenses.set(memberId, (salaryFromExpenses.get(memberId) || 0) + toAll(e.amount || 0, e.currency));
    });

    /** What the plan says this person's salary was in this month — effective-dated
     *  (`salaryHistory`), start/termination aware. Never read `monthlySalary` raw:
     *  it is today's figure, and would re-price closed months. */
    const planSalary = (tm?: TeamMember): number => (tm ? memberSalaryForMonth(tm, monthEnd) : 0);
    const recordedSalary = (uid: string): number => salaryFromExpenses.get(uid) ?? 0;

    /** What the month actually COST: a recorded payment wins over the plan —
     *  it is what left the bank (payroll law, src/lib/finance/payroll.ts). */
    const chargedSalary = (uid: string, tm?: TeamMember): number =>
      salaryFromExpenses.has(uid) ? recordedSalary(uid) : planSalary(tm);

    /** What the bonus THRESHOLD is sized on. Deliberately NOT the recorded amount:
     *  a 30 000 advance against an 80 000 salary is still an 80 000 salary, and
     *  preferring the recorded row dropped the bar from 240 000 to 90 000 and
     *  shrank every tier band with it. */
    const thresholdSalary = (uid: string, tm?: TeamMember): number =>
      Math.max(recordedSalary(uid), planSalary(tm));

    // ── 1. Office / general expenses for the selected period ─────────────────
    // Exclude Salary-category and project-specific expenses from office overhead.
    const totalOfficeExpenses = (expenses || []).reduce((sum, e) => {
      if (e.projectId) return sum;                            // project-specific → skip
      if (e.category === EXPENSE_CATEGORY_SALARY) return sum; // salary is tracked separately
      if (!expenseIsCountable(e)) return sum;                 // rejected rows never hit the books
      if (!inPeriod(getExpenseDate(e))) return sum;
      return sum + toAll(e.amount || 0, e.currency);
    }, 0);

    /** Everyone whose salary this project consumes: the assigned members AND the
     *  person responsible for it. One set, used for BOTH the charge and the
     *  denominator that prorates it — they used to disagree (the charge looked at
     *  `memberUserIds`, the denominator also at `responsibleUserId`), so part of
     *  the salary was never charged and every bonus came out too high. */
    const participantsOf = (p: Project): string[] => {
      const s = new Set<string>();
      ((p.memberUserIds as string[] | undefined) || []).forEach(u => { if (u) s.add(u); });
      if (p.responsibleUserId) s.add(p.responsibleUserId);
      return Array.from(s);
    };

    return teamMembers
      .map(member => {
        // The tier ladder is sized on the FULL salary (see `thresholdSalary`);
        // `recordedThisMonth` is what we still report to the user.
        const salary = thresholdSalary(member.userId, member);
        const recordedThisMonth = recordedSalary(member.userId);
        const salarySource = salaryFromExpenses.has(member.userId) ? 'expenses' : 'profile';

        // Match owner by uid OR email — member docs may store either, and
        // projects may reference either (mirrors ReportsView identity logic).
        const memberIdentifiers = new Set<string>(
          [member.userId, (member as any).email]
            .map(v => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
            .filter(Boolean)
        );
        const matchesMember = (v?: string | null) =>
          !!v && memberIdentifiers.has(String(v).trim().toLowerCase());
        const memberProjects = periodProjects.filter(p => {
          const owner = p.responsibleUserId || p.createdByUserId;
          return matchesMember(owner);
        });

        const projectDetails = memberProjects.map(p => {
          // ── direct project expenses ─────────────────────────────────────
          // Shared predicate: rejected rows and Salary-category rows are not
          // project-direct cost anywhere else, and were counted here.
          // Period-filtered, the way staffRevenue does it: an all-time sum let a
          // cost booked three months LATER retroactively lower an already-paid
          // bonus, and the completion month's net was never final.
          const directExpenses = (expenses || [])
            .filter(e => e.projectId === p.id && isProjectDirectExpense(e) && inPeriod(getExpenseDate(e)))
            .reduce((sum, e) => sum + toAll(e.amount || 0, e.currency), 0);

          // ── office expenses split EQUALLY across the period's projects ──
          // (matches the documented model + in-app explainer: "ndahen barabar").
          const perProjectOffice = periodProjects.length > 0
            ? totalOfficeExpenses / periodProjects.length
            : 0;

          // ── salary cost of every PARTICIPANT (prorated by project budget) ───
          // Uses the salary recorded in the month if there is one, else the plan.
          const salaryCosts = participantsOf(p).reduce((sum, uid) => {
            const tm = teamMembers.find(m => m.userId === uid);
            const tmSalary = chargedSalary(uid, tm);
            if (!tmSalary) return sum;
            const assignedProjects = periodProjects.filter(pp => participantsOf(pp).includes(uid));
            const totalAssignedBudget = assignedProjects.reduce((s, pp) => s + toAll(pp.budget || 0, pp.currency), 0);
            const fraction = totalAssignedBudget > 0
              ? toAll(p.budget || 0, p.currency) / totalAssignedBudget
              : 1 / Math.max(1, assignedProjects.length);
            return sum + tmSalary * fraction;
          }, 0);

          // Normalizo në ALL që fitimi neto të mos përziejë EUR me kostot në Lekë.
          const budget = toAll(p.budget || 0, p.currency);
          const net = budget - directExpenses - perProjectOffice - salaryCosts;

          return {
            id: p.id,
            name: p.name,
            budget,
            expenses: directExpenses,
            officeExpenses: perProjectOffice,
            salaryCosts,
            net,
          };
        });

        const netContribution = projectDetails.reduce((sum, p) => sum + p.net, 0);
        // Bonus needs a salary to size the tiers; without it we still SHOW the
        // member (so nobody disappears) but the bonus stays 0 with a hint.
        const bonus = salary > 0
          ? calculateBonus(salary, netContribution)
          : calculateBonus(0, 0);

        return {
          member,
          salarySource,
          hasSalary: salary > 0,
          salary,
          recordedThisMonth,
          ...bonus,
          netContribution,
          projects: projectDetails,
        } as BonusResult & {
          member: TeamMember;
          salarySource: 'expenses' | 'profile';
          hasSalary: boolean;
          salary: number;
          recordedThisMonth: number;
        };
      })
      // Keep members who are paid OR who actually worked on projects this period;
      // drop only the ones with neither (they'd be empty rows).
      .filter(r => r.hasSalary || r.projects.length > 0)
      .sort((a, b) => b.totalBonus - a.totalBonus || b.netContribution - a.netContribution);
  }, [teamMembers, periodProjects, expenses, selectedMonth, selectedYear]);

  // Workers only see their own row
  const memberResults = useMemo(() => {
    if (isAdmin) return allMemberResults;
    return allMemberResults.filter(r => r.member.userId === user?.uid);
  }, [allMemberResults, isAdmin, user?.uid]);

  // My own result (for worker personal view)
  const myResult = useMemo(() =>
    allMemberResults.find(r => r.member.userId === user?.uid),
    [allMemberResults, user?.uid]
  );

  const totalBonusPayout = useMemo(
    () => allMemberResults.reduce((sum, r) => sum + r.totalBonus, 0),
    [allMemberResults]
  );

  const membersWithSalary = teamMembers?.filter(m => m.monthlySalary && m.monthlySalary > 0).length || 0;
  const membersEarningBonus = allMemberResults.filter(r => r.totalBonus > 0).length;

  // Everything above is memoised, so every hook has already run — a guarded
  // return here is safe. Nothing tenant-wide was fetched for this viewer
  // (`skip: !isAdmin` on all three collections), so there is nothing to show.
  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto py-10">
        <Card className="border-dashed border-2 p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center mx-auto mb-4">
            {permissions.isLoading
              ? <Award className="w-7 h-7 animate-pulse" />
              : <ShieldAlert className="w-7 h-7" />}
          </div>
          <p className="font-medium text-foreground/80">
            {permissions.isLoading ? 'Duke ngarkuar…' : 'Bonuset shihen nga menaxhimi'}
          </p>
          {!permissions.isLoading && (
            <p className="text-sm text-muted-foreground mt-2">
              Llogaritja e bonusit bazohet në buxhetet, shpenzimet dhe rrogat e gjithë ekipit —
              të dhëna që i sheh vetëm administratori ose menaxheri. Për bonusin tënd të këtij
              muaji, pyet menaxherin tënd.
            </p>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
            <Award className="h-6 w-6 text-amber-500" />
            Sistemi i Bonusit
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Llogaritja automatike e bonusit bazuar në kontributin neto të projekteve
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setShowExplainer(!showExplainer)}
          >
            <Info className="h-4 w-4 mr-1" />
            Si funksionon?
          </Button>
        </div>
      </div>

      {/* Formula Explainer */}
      {showExplainer && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="pt-5 space-y-3">
            <h3 className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2">
              📐 Modeli: "Tiered Net Revenue Sharing"
            </h3>
            <div className="space-y-2 text-sm text-foreground/80">
              <p><strong>1. Kontributi neto</strong> = Σ(buxheti − shpenzime direkte − shpenzime zyrë − rrogat e anëtarëve) për të gjitha projektet e mbyllura të muajit</p>
              <ul className="ml-4 space-y-0.5 text-muted-foreground list-disc">
                <li><strong className="text-foreground">Shpenzime direkte</strong> — shpenzimet e lidhura drejtpërdrejt me projektin</li>
                <li><strong className="text-foreground">Shpenzime zyrë</strong> — shpenzimet e përgjithshme (qira, fatura etj.) ndahen barabar mes projekteve të muajit</li>
                <li><strong className="text-foreground">Rroga anëtarësh</strong> — rroga e secilit person të caktuar në projekt, proporcionale me numrin e projekteve ku marrin pjesë atë muaj</li>
              </ul>
              <p><strong>2. Pragu minimal</strong> = rroga mujore × 3 <span className="text-muted-foreground">(mbulon: rrogën + kostot e punëdhënësit + marzhin e kompanisë)</span></p>
              <p><strong>3. Bonusi ndahet në 3 nivele</strong> mbi pragun:</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
                <div className="p-3 bg-green-100 dark:bg-green-950/40 rounded-lg text-center">
                  <div className="text-lg font-bold text-green-700 dark:text-green-400">8%</div>
                  <div className="text-xs text-green-700/70 dark:text-green-400/70">Niveli 1 · 3× → 4× rrogë</div>
                </div>
                <div className="p-3 bg-blue-100 dark:bg-blue-950/40 rounded-lg text-center">
                  <div className="text-lg font-bold text-blue-700 dark:text-blue-400">12%</div>
                  <div className="text-xs text-blue-700/70 dark:text-blue-400/70">Niveli 2 · 4× → 5× rrogë</div>
                </div>
                <div className="p-3 bg-accent-soft dark:bg-primary/10 rounded-lg text-center">
                  <div className="text-lg font-bold text-primary">18%</div>
                  <div className="text-xs text-primary/70">Niveli 3 · mbi 5× rrogë</div>
                </div>
              </div>
              <div className="mt-3 p-3 bg-muted/60 rounded-lg text-xs">
                <strong>Shembull:</strong> Rroga 80,000 L · Buxhet 600,000 L · Shp.direkte 20,000 L · Shp.zyrë 10,000 L · Rroga anëtarësh 30,000 L<br />
                Neto: 540,000 L · Pragu: 240,000 L · Teprica: 300,000 L<br />
                N1: min(300,000 L, 80,000 L) × 8% = 6,400 L · N2: 80,000 L × 12% = 9,600 L · N3: 140,000 L × 18% = 25,200 L<br />
                <strong>Bonus total: 41,200 L</strong>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Period Selector */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">Muaji:</label>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i} value={i.toString()}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">Viti:</label>
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => (
                <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Badge variant="outline" className="text-muted-foreground">
          {periodProjects.length} projekte të mbyllura në {MONTHS[parseInt(selectedMonth)]} {selectedYear}
        </Badge>
      </div>

      {/* KPI Summary — admin only */}
      {isAdmin && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                <Award className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Bonus Total</p>
                <p className="text-lg font-bold text-foreground">{totalBonusPayout.toLocaleString(undefined, { maximumFractionDigits: 0 })} L</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Marrin Bonus</p>
                <p className="text-lg font-bold text-foreground">{membersEarningBonus} / {membersWithSalary}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <DollarSign className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Projekte të Mbyllura</p>
                <p className="text-lg font-bold text-foreground">{periodProjects.length}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-accent-soft dark:bg-primary/10 rounded-lg">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Me Rroge Caktuar</p>
                <p className="text-lg font-bold text-foreground">{membersWithSalary}</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Worker personal motivation banner */}
      {!isAdmin && myResult && (
        <Card className={`p-5 ${myResult.totalBonus > 0 ? 'border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20' : ''}`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Bonusi yt këtë muaj</p>
              <p className={`text-3xl font-bold mt-1 ${myResult.totalBonus > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                {myResult.totalBonus > 0 ? `${myResult.totalBonus.toLocaleString(undefined, { maximumFractionDigits: 0 })} L` : 'Ende pa arritur pragun'}
              </p>
              {myResult.totalBonus === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Ke bërë {myResult.netContribution.toLocaleString(undefined, { maximumFractionDigits: 0 })} L nga {myResult.threshold.toLocaleString()} L pragu
                </p>
              )}
            </div>
            <div className="flex-1 max-w-xs">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Progresi drejt pragut</span>
                <span>{myResult.threshold > 0 ? Math.min(100, Math.round((myResult.netContribution / myResult.threshold) * 100)) : 0}%</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: getProgressWidth(myResult.netContribution, myResult.threshold),
                    background: myResult.totalBonus > 0
                      ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                      : 'hsl(var(--primary) / 0.6)',
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Pragu: {myResult.threshold.toLocaleString()} L · Çfarë ke bërë: {myResult.netContribution.toLocaleString(undefined, { maximumFractionDigits: 0 })} L
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Worker: no salary configured yet */}
      {!isAdmin && !myResult && (
        <Card className="border-dashed border-2 p-6 text-center">
          <Award className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="font-medium text-foreground/70">Rroga jote nuk është caktuar ende</p>
          <p className="text-sm text-muted-foreground mt-1">
            Administratori duhet të caktojë rrogën tënde mujore te <strong>Ekipet</strong> për të aktivizuar bonusin.
          </p>
        </Card>
      )}

      {/* Admin: setup hint if no salaries set */}
      {isAdmin && membersWithSalary === 0 && (
        <Card className="border-dashed border-2 p-6 text-center">
          <Award className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="font-medium text-foreground/70">Sistemi i bonusit është gati</p>
          <p className="text-sm text-muted-foreground mt-1">
            Shko te <strong>Ekipet</strong> → edito anëtarët dhe cakto rrogën mujore për secilin,
            ose shto shpenzim me kategori <strong>Paga</strong> te Shpenzimet dhe lidhe me anëtarin.
            Edito gjithashtu projektet dhe cakto <strong>Përgjegjësin e Projektit</strong>.
          </p>
        </Card>
      )}
      {memberResults.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">
            {isAdmin ? 'Detajet për Punonësit' : `Projektet e mia — ${MONTHS[parseInt(selectedMonth)]} ${selectedYear}`}
          </h2>
          {memberResults.map(result => {
            const isExpanded = expandedMember === result.member.id;
            const hasBonus = result.totalBonus > 0;
            const progressMax = result.threshold; // label & bar both measure progress toward the threshold

            return (
              <Card
                key={result.member.id}
                className={`overflow-hidden transition-all ${hasBonus ? 'border-amber-200 dark:border-amber-800' : ''}`}
              >
                {/* Header row */}
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedMember(isExpanded ? null : result.member.id)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${hasBonus ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' : 'bg-muted text-muted-foreground'}`}>
                      {getInitials(result.member.userId, result.member.displayName || result.member.email?.split('@')[0])}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{getName(result.member.userId, result.member.displayName || result.member.email?.split('@')[0])}</p>
                      <p className="text-xs text-muted-foreground">
                        {result.member.role} · Rroga: {(result as any).salary ? (result as any).salary.toLocaleString() : '—'} L/muaj
                        {(result as any).salarySource === 'expenses' && (
                          <span className="ml-1 text-blue-500" title="Rroga e marrë nga shpenzimet e muajit">· nga shpenzimet</span>
                        )}
                        {/* A part-payment must not shrink the bar — we show it, we don't
                            size the threshold on it. */}
                        {(result as any).recordedThisMonth > 0 && (result as any).recordedThisMonth < (result as any).salary && (
                          <span className="ml-1 text-amber-600 dark:text-amber-400" title="Shuma e regjistruar këtë muaj është më e vogël se rroga — pragu llogaritet mbi rrogën e plotë">
                            · paguar {(result as any).recordedThisMonth.toLocaleString()} L
                          </span>
                        )}
                        {!(result as any).hasSalary && (
                          <span className="ml-1 text-amber-600 dark:text-amber-400" title="Vendos pagën te profili i punonjësit që të llogaritet bonusi">· vendos pagën për bonus</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                    {/* Progress to threshold */}
                    <div className="hidden sm:block text-right">
                      <p className="text-xs text-muted-foreground">Kontribut neto</p>
                      <p className="text-sm font-semibold text-foreground">{result.netContribution.toLocaleString(undefined, { maximumFractionDigits: 0 })} L</p>
                    </div>
                    <div className={`text-right ${hasBonus ? '' : 'opacity-50'}`}>
                      <p className="text-xs text-muted-foreground">Bonus</p>
                      <p className={`text-sm font-bold ${hasBonus ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                        {hasBonus ? `${result.totalBonus.toLocaleString(undefined, { maximumFractionDigits: 0 })} L` : '—'}
                      </p>
                    </div>
                    {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>

                {/* Progress bar to threshold */}
                <div className="px-4 pb-3">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                    <span>Progresi drejt pragut (3× rrogë)</span>
                    <span>{result.threshold > 0 ? Math.min(100, Math.round((result.netContribution / result.threshold) * 100)) : 0}% · Pragu: {result.threshold.toLocaleString()} L</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: getProgressWidth(result.netContribution, progressMax),
                        background: hasBonus
                          ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                          : 'hsl(var(--primary) / 0.6)',
                      }}
                    />
                  </div>
                  {hasBonus && (
                    <div className="flex gap-1 mt-1">
                      {result.tiers.map((tier, i) => tier.reached && (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                          N{i + 1}: {tier.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })} L
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t bg-muted/20 px-4 py-4 space-y-4">
                    {/* Tier breakdown */}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Zbërtim i niveleve të bonusit</p>
                      <div className="space-y-2">
                        {result.tiers.map((tier, i) => (
                          <div key={i} className={`flex items-center justify-between p-2.5 rounded-lg ${tier.reached ? 'bg-background border' : 'bg-muted/40 opacity-50'}`}>
                            <div className="flex items-center gap-2">
                              <div className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${i === 0 ? 'bg-green-100 text-green-700' : i === 1 ? 'bg-blue-100 text-blue-700' : 'bg-accent-soft text-primary'}`}>
                                {i + 1}
                              </div>
                              <span className="text-sm">{tier.label}</span>
                              <Badge variant="outline" className="text-xs">{tier.rate}%</Badge>
                            </div>
                            <span className={`text-sm font-semibold ${tier.reached ? 'text-foreground' : 'text-muted-foreground'}`}>
                              {tier.reached ? `${tier.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} L` : 'Pa arritur'}
                            </span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 mt-1">
                          <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">BONUS TOTAL</span>
                          <span className="text-base font-bold text-amber-700 dark:text-amber-400">{result.totalBonus.toLocaleString(undefined, { maximumFractionDigits: 2 })} L</span>
                        </div>
                      </div>
                    </div>

                    {/* Projects */}
                    {result.projects.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Projektet e mbyllura ({result.projects.length})</p>
                        <div className="space-y-1.5">
                          {result.projects.map(p => (
                            <div key={p.id} className="py-2 px-3 rounded-lg bg-background border space-y-1">
                              <div className="flex items-center justify-between text-sm">
                                <span className="truncate font-medium flex-1">{p.name}</span>
                                <span className="font-semibold text-foreground ml-3">{p.net.toLocaleString(undefined, { maximumFractionDigits: 0 })} L neto</span>
                              </div>
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                                <span className="text-muted-foreground">Buxhet: {p.budget.toLocaleString()} L</span>
                                {p.expenses > 0 && <span className="text-destructive/70">− {p.expenses.toLocaleString(undefined, { maximumFractionDigits: 0 })} L shp.direkte</span>}
                                {p.officeExpenses > 0 && <span className="text-orange-500/80">− {p.officeExpenses.toLocaleString(undefined, { maximumFractionDigits: 0 })} L shp.zyrë</span>}
                                {p.salaryCosts > 0 && <span className="text-blue-500/80">− {p.salaryCosts.toLocaleString(undefined, { maximumFractionDigits: 0 })} L rroga</span>}
                              </div>
                            </div>
                          ))}
                          <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/40 font-medium">
                            <span>Total neto</span>
                            <span className="text-foreground">{result.netContribution.toLocaleString(undefined, { maximumFractionDigits: 0 })} L</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {result.projects.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-2">
                        Asnjë projekt i mbyllur në këtë periudhë me këtë person si përgjegjës.
                      </p>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* No data with salaries but nothing this month */}
      {membersWithSalary > 0 && memberResults.length === 0 && (
        <Card className="border-dashed p-8 text-center">
          <TrendingUp className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="font-medium text-foreground/70">Asnjë projekt i mbyllur</p>
          <p className="text-sm text-muted-foreground mt-1">
            Nuk ka projekte të mbyllura me person përgjegjës caktuar për {MONTHS[parseInt(selectedMonth)]} {selectedYear}.
          </p>
        </Card>
      )}
    </div>
  );
};

export default BonusView;
