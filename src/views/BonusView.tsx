import React, { useMemo, useState } from 'react';
import { useCollection } from '../hooks/useFirestore';
import { usePermissions } from '../hooks/usePermissions';
import { useAuth } from '../contexts/AuthContext';
import { useUserNames } from '../hooks/useUserNames';
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
//  1. Net contribution = sum(project.budget - project_expenses) for all
//     COMPLETED projects where the worker is responsibleUserId
//
//  2. Threshold = monthly salary × 3
//     (covers: 1× salary paid + 1× employer costs/overhead + 1× company margin)
//
//  3. Bonus tiers (on the surplus above threshold):
//     · 3× → 4× salary band   →  8% of that band
//     · 4× → 5× salary band   → 12% of that band
//     · above 5× salary       → 18% of the remainder
//
//  Example @ €800/mo salary, €5,000 net contribution:
//     Threshold  = €2,400  (no bonus below this)
//     Surplus    = €2,600
//     Tier 1     = min(€2,600, €800) × 8%  = €64
//     Tier 2     = min(€1,800, €800) × 12% = €96
//     Tier 3     = €1,000 × 18%            = €180
//     TOTAL BONUS = €340
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
  projects: { id: string; name: string; budget: number; expenses: number; net: number }[];
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
  const isAdmin = permissions.canAccessReports; // managers/admins see everyone
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

    return teamMembers
      .filter(m => m.monthlySalary && m.monthlySalary > 0)
      .map(member => {
        // Match by responsibleUserId first; fall back to createdByUserId
        const memberProjects = periodProjects.filter(p => {
          const owner = p.responsibleUserId || p.createdByUserId;
          return owner === member.userId;
        });

        const projectDetails = memberProjects.map(p => {
          const projectExpenses = expenses?.filter(e => (e as any).projectId === p.id) || [];
          const totalExpenses = projectExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
          const budget = p.budget || 0;
          return {
            id: p.id,
            name: p.name,
            budget,
            expenses: totalExpenses,
            net: budget - totalExpenses,
          };
        });

        const netContribution = projectDetails.reduce((sum, p) => sum + p.net, 0);
        const bonus = calculateBonus(member.monthlySalary!, netContribution);

        return {
          member,
          ...bonus,
          projects: projectDetails,
        } as BonusResult & { member: TeamMember };
      })
      .sort((a, b) => b.totalBonus - a.totalBonus);
  }, [teamMembers, periodProjects, expenses]);

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
              <p><strong>1. Kontributi neto</strong> = Σ(buxheti i projektit − shpenzimet e projektit) për të gjitha projektet e mbyllura të muajit</p>
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
                <div className="p-3 bg-purple-100 dark:bg-purple-950/40 rounded-lg text-center">
                  <div className="text-lg font-bold text-purple-700 dark:text-purple-400">18%</div>
                  <div className="text-xs text-purple-700/70 dark:text-purple-400/70">Niveli 3 · mbi 5× rrogë</div>
                </div>
              </div>
              <div className="mt-3 p-3 bg-muted/60 rounded-lg text-xs">
                <strong>Shembull:</strong> Rroga €800 · Kontributi €5,000<br />
                Pragu: €2,400 · Teprica: €2,600<br />
                N1: min(€2,600, €800) × 8% = €64 · N2: €800 × 12% = €96 · N3: €1,000 × 18% = €180<br />
                <strong>Bonus total: €340</strong>
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
                <p className="text-lg font-bold text-foreground">€{totalBonusPayout.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
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
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                <Users className="h-5 w-5 text-purple-600 dark:text-purple-400" />
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
                {myResult.totalBonus > 0 ? `€${myResult.totalBonus.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'Ende pa arritur pragun'}
              </p>
              {myResult.totalBonus === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Ke bërë €{myResult.netContribution.toLocaleString(undefined, { maximumFractionDigits: 0 })} nga €{myResult.threshold.toLocaleString()} pragu
                </p>
              )}
            </div>
            <div className="flex-1 max-w-xs">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Progresi drejt pragut</span>
                <span>{Math.min(100, Math.round((myResult.netContribution / myResult.threshold) * 100))}%</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: getProgressWidth(myResult.netContribution, myResult.threshold * (5/3)),
                    background: myResult.totalBonus > 0
                      ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                      : 'hsl(var(--primary) / 0.6)',
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Pragu: €{myResult.threshold.toLocaleString()} · Çfarë ke bërë: €{myResult.netContribution.toLocaleString(undefined, { maximumFractionDigits: 0 })}
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
            Shko te <strong>Ekipet</strong> → edito anëtarët dhe cakto rrogën mujore për secilin.
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
            const progressMax = result.member.monthlySalary! * 5;

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
                      {getInitials(result.member.userId)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{getName(result.member.userId)}</p>
                      <p className="text-xs text-muted-foreground">{result.member.role} · Rroga: €{result.member.monthlySalary?.toLocaleString()}/muaj</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                    {/* Progress to threshold */}
                    <div className="hidden sm:block text-right">
                      <p className="text-xs text-muted-foreground">Kontribut neto</p>
                      <p className="text-sm font-semibold text-foreground">€{result.netContribution.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                    </div>
                    <div className={`text-right ${hasBonus ? '' : 'opacity-50'}`}>
                      <p className="text-xs text-muted-foreground">Bonus</p>
                      <p className={`text-sm font-bold ${hasBonus ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                        {hasBonus ? `€${result.totalBonus.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                      </p>
                    </div>
                    {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>

                {/* Progress bar to threshold */}
                <div className="px-4 pb-3">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                    <span>Progresi drejt pragut (3× rrogë)</span>
                    <span>{Math.min(100, Math.round((result.netContribution / result.threshold) * 100))}% · Pragu: €{result.threshold.toLocaleString()}</span>
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
                          N{i + 1}: €{tier.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
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
                              <div className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${i === 0 ? 'bg-green-100 text-green-700' : i === 1 ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                                {i + 1}
                              </div>
                              <span className="text-sm">{tier.label}</span>
                              <Badge variant="outline" className="text-xs">{tier.rate}%</Badge>
                            </div>
                            <span className={`text-sm font-semibold ${tier.reached ? 'text-foreground' : 'text-muted-foreground'}`}>
                              {tier.reached ? `€${tier.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : 'Pa arritur'}
                            </span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 mt-1">
                          <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">BONUS TOTAL</span>
                          <span className="text-base font-bold text-amber-700 dark:text-amber-400">€{result.totalBonus.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                    </div>

                    {/* Projects */}
                    {result.projects.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Projektet e mbyllura ({result.projects.length})</p>
                        <div className="space-y-1.5">
                          {result.projects.map(p => (
                            <div key={p.id} className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-background border">
                              <span className="truncate font-medium flex-1">{p.name}</span>
                              <div className="flex items-center gap-3 text-xs ml-3 flex-shrink-0">
                                <span className="text-muted-foreground">Buxhet: €{p.budget.toLocaleString()}</span>
                                {p.expenses > 0 && <span className="text-destructive/70">−€{p.expenses.toLocaleString()}</span>}
                                <span className="font-semibold text-foreground">= €{p.net.toLocaleString()}</span>
                              </div>
                            </div>
                          ))}
                          <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/40 font-medium">
                            <span>Total neto</span>
                            <span className="text-foreground">€{result.netContribution.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
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
