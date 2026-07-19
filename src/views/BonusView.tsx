import React, { useMemo, useState } from 'react';
import { useCollection } from '../hooks/useFirestore';
import { usePermissions } from '../contexts/PermissionsContext';
import { useAuth } from '../contexts/AuthContext';
import { useUserNames } from '../hooks/useUserNames';
import { toAll } from '../lib/utils';
import { Award, TrendingUp, DollarSign, Users, ChevronDown, ChevronUp, Info } from 'lucide-react';
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

  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
    skipTeamFilter: true,
  });

  const { getName, getInitials } = useUserNames(teamMembers || []);
  const { data: projects } = useCollection<Project>('projects', {
    skipTeamFilter: true,
  });
  const { data: expenses } = useCollection<Expense>('expenses', {
    skipTeamFilter: true,
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
    const salaryFromExpenses = new Map<string, number>();
    (expenses || []).forEach(e => {
      if (e.category !== 'Salary') return;
      const memberId = (e as any).memberId as string | undefined;
      if (!memberId) return;
      const d = e.date ? new Date(e.date) : null;
      if (!d || isNaN(d.getTime())) return;
      if (d.getMonth() !== month || d.getFullYear() !== year) return;
      salaryFromExpenses.set(memberId, (salaryFromExpenses.get(memberId) || 0) + toAll(e.amount || 0, e.currency));
    });

    const effectiveSalary = (uid: string, monthlySalary?: number): number =>
      salaryFromExpenses.get(uid) ?? monthlySalary ?? 0;

    // ── 1. Office / general expenses for the selected period ─────────────────
    // Exclude Salary-category and project-specific expenses from office overhead.
    const totalOfficeExpenses = (expenses || []).reduce((sum, e) => {
      if ((e as any).projectId) return sum; // project-specific → skip
      if (e.category === 'Salary') return sum; // salary is tracked separately
      const d = e.date ? new Date(e.date) : null;
      if (!d || isNaN(d.getTime())) return sum;
      if (d.getMonth() !== month || d.getFullYear() !== year) return sum;
      return sum + toAll(e.amount || 0, e.currency);
    }, 0);

    return teamMembers
      .map(member => {
        const salary = effectiveSalary(member.userId, member.monthlySalary);
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
          const directExpenses = (expenses || [])
            .filter(e => (e as any).projectId === p.id)
            .reduce((sum, e) => sum + toAll(e.amount || 0, e.currency), 0);

          // ── office expenses split EQUALLY across the period's projects ──
          // (matches the documented model + in-app explainer: "ndahen barabar").
          const perProjectOffice = periodProjects.length > 0
            ? totalOfficeExpenses / periodProjects.length
            : 0;

          // ── salary cost of each assigned member (prorated by project budget) ─
          // Uses salary from Expenses if linked, else falls back to monthlySalary.
          const memberIds: string[] = (p.memberUserIds as string[] | undefined) || [];
          const salaryCosts = memberIds.reduce((sum, uid) => {
            const tm = teamMembers.find(m => m.userId === uid);
            const tmSalary = effectiveSalary(uid, tm?.monthlySalary);
            if (!tmSalary) return sum;
            const assignedProjects = periodProjects.filter(pp =>
              ((pp.memberUserIds as string[] | undefined) || []).includes(uid) ||
              pp.responsibleUserId === uid
            );
            const totalAssignedBudget = assignedProjects.reduce((s, pp) => s + (pp.budget || 0), 0);
            const fraction = totalAssignedBudget > 0
              ? (p.budget || 0) / totalAssignedBudget
              : 1 / Math.max(1, assignedProjects.length);
            return sum + tmSalary * fraction;
          }, 0);

          const budget = p.budget || 0;
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
          ...bonus,
          netContribution,
          projects: projectDetails,
        } as BonusResult & { member: TeamMember; salarySource: 'expenses' | 'profile'; hasSalary: boolean };
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
                        {result.member.role} · Rroga: {result.threshold ? Math.round(result.threshold / 3).toLocaleString() : '—'} L/muaj
                        {(result as any).salarySource === 'expenses' && (
                          <span className="ml-1 text-blue-500" title="Rroga e marrë nga shpenzimet e muajit">· nga shpenzimet</span>
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
