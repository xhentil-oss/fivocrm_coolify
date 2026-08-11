import React, { useState, useMemo, useEffect } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useUserNames } from '../hooks/useUserNames';
import { getStatusColor } from '../lib/statusColors';
import { projectPickerLabel, sortArchivedLast } from '../lib/projectArchive';
import {
  Target, Plus, CheckCircle2, Calendar, Users, User as UserIcon,
  AlertCircle, Link2, Trash2, ChevronDown, ChevronRight,
  FolderKanban, Briefcase, ListTodo, BarChart3, Pencil,
  Zap, Flag, Hash, Minus, Sparkles,
} from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Calendar as CalendarComponent } from '../components/ui/calendar';
import { useFilteredByOwner, useUniqueTeamMembers } from '../hooks/useRoleFilteredData';
import type {
  Goal, Team, TeamMember, Milestone, Project, Lead, Task, Invoice,
  KeyResult, KeyResultType, KeyResultAutoSource,
} from '../types';
import {
  goalDerivedProgress, goalHealth, hasKeyResults, keyResultProgress, keyResultCurrent,
  goalScore, AUTO_SOURCE_LABELS, AUTO_SOURCE_UNIT, type OkrContext,
} from '../lib/productivity/okr';

// ─── Main View ───────────────────────────────────────────────────────────────
const GoalsView: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('all');

  // Data — core collections always loaded
  const { data: rawGoals, loading } = useCollection<Goal>('goals', {
    orderBy: { field: 'dueDate', direction: 'asc' },
  });
  const allGoals = useFilteredByOwner(rawGoals);
  const { data: teams } = useCollection<Team>('teams');
  const { data: rawTeamMembers } = useCollection<TeamMember>('teamMembers');
  const teamMembers = useUniqueTeamMembers(rawTeamMembers);
  const { data: milestones } = useCollection<Milestone>('milestones');
  // CRM collections — loaded always so OKR auto Key Results derive live progress
  // (their currentValue is pulled from tasks/projects/leads/invoices).
  const { data: projects } = useCollection<Project>('projects');
  const { data: leads } = useCollection<Lead>('leads');
  const { data: tasks } = useCollection<Task>('tasks');
  const { data: invoices } = useCollection<Invoice>('invoices');
  const { getName } = useUserNames(teamMembers);

  // Live context for OKR auto Key Results.
  const okrCtx: OkrContext = useMemo(
    () => ({ tasks: tasks || [], projects: projects || [], leads: leads || [], invoices: invoices || [] }),
    [tasks, projects, leads, invoices],
  );
  // Derived (OKR) progress + health — replaces the manual field when KRs exist.
  const progressOf = useMemo(() => (g: Goal) => goalDerivedProgress(g, okrCtx), [okrCtx]);
  const statusOf = useMemo(
    () => (g: Goal): Goal['status'] => (hasKeyResults(g) ? goalHealth(g, goalDerivedProgress(g, okrCtx)) : g.status),
    [okrCtx],
  );

  // Mutations
  const goalMutation = useMutation<Goal>('goals');
  const milestoneMutation = useMutation<Milestone>('milestones');
  const notificationMutation = useMutation<any>('notifications');

  // Filtered goals
  const goals = useMemo(() => {
    if (!allGoals) return [];
    let filtered = allGoals;
    if (filterStatus !== 'all') filtered = filtered.filter(g => statusOf(g) === filterStatus);
    if (activeTab === 'team') filtered = filtered.filter(g => (g.scope || 'team') === 'team');
    if (activeTab === 'individual') filtered = filtered.filter(g => g.scope === 'individual');
    if (activeTab === 'my') filtered = filtered.filter(g => g.ownerId === user?.uid);
    return filtered;
  }, [allGoals, filterStatus, activeTab, user, statusOf]);

  // Stats
  const stats = useMemo(() => {
    const all = allGoals || [];
    const st = all.map(g => statusOf(g));
    return {
      total: all.length,
      teamGoals: all.filter(g => (g.scope || 'team') === 'team').length,
      individualGoals: all.filter(g => g.scope === 'individual').length,
      onTrack: st.filter(s => s === 'On Track').length,
      atRisk: st.filter(s => s === 'At Risk' || s === 'Off Track').length,
      achieved: st.filter(s => s === 'Achieved').length,
      avgProgress: all.length ? Math.round(all.reduce((s, g) => s + progressOf(g), 0) / all.length) : 0,
    };
  }, [allGoals, statusOf, progressOf]);

  const getChildGoals = (parentId: string) =>
    (allGoals || []).filter(g => g.parentGoalId === parentId);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'On Track': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'At Risk': return <AlertCircle className="w-4 h-4 text-amber-500" />;
      case 'Off Track': return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'Achieved': return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
      default: return <Target className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const handleCreate = async (data: Partial<Goal>) => {
    await goalMutation.create({ ...data, scope: data.scope || 'team' } as any);
    // Notify assigned owner if different from creator
    if (data.ownerId && data.ownerId !== user?.uid) {
      await notificationMutation.create({
        userId: data.ownerId,
        type: 'goal_assigned',
        title: 'Objektiv i Ri i Caktuar',
        message: `Ju u caktuat si përgjegjës i objektivit: "${data.title}"`,
        isRead: false,
        actionUrl: '/app/goals',
        actionLabel: 'Shiko Objektivat',
      }).catch(err => console.error('[Notifications] goal_assigned dërgim dështoi:', err));
    }
    setIsCreateDialogOpen(false);
  };

  const handleUpdate = async (data: Partial<Goal>) => {
    if (!editingGoal) return;
    await goalMutation.update(editingGoal.id, data as any);
    // Notify team when a goal is marked Achieved
    if (data.status === 'Achieved' && editingGoal.status !== 'Achieved') {
      const recipients = (teamMembers || []).filter(m => m.userId !== user?.uid && m.status === 'Active');
      if (recipients.length > 0) {
        await Promise.all(recipients.map(m =>
          notificationMutation.create({
            userId: m.userId,
            type: 'goal_achieved',
            title: `🏆 Objektiv i Arritur`,
            message: `Objektivi "${editingGoal.title || data.title}" u shënua si i arritur!`,
            isRead: false,
            actionUrl: '/app/goals',
            actionLabel: 'Shiko Objektivat',
          })
        )).catch(err => console.error('[Notifications] goal_achieved dërgim dështoi:', err));
      }
    }
    setEditingGoal(null);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96">Duke ngarkuar objektivat...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Target className="w-4 h-4" /> Totale
          </div>
          <p className="text-2xl font-bold">{stats.total}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <BarChart3 className="w-4 h-4" /> Mesatarja
          </div>
          <p className="text-2xl font-bold">{stats.avgProgress}%</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-green-600 mb-1">
            <CheckCircle2 className="w-4 h-4" /> Arritur
          </div>
          <p className="text-2xl font-bold">{stats.achieved}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-amber-600 mb-1">
            <AlertCircle className="w-4 h-4" /> Në Rrezik
          </div>
          <p className="text-2xl font-bold">{stats.atRisk}</p>
        </Card>
      </div>

      {/* Header with tabs + filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="all">Të Gjitha ({stats.total})</TabsTrigger>
            <TabsTrigger value="team">
              <Users className="w-4 h-4 mr-1" /> Ekipore ({stats.teamGoals})
            </TabsTrigger>
            <TabsTrigger value="individual">
              <UserIcon className="w-4 h-4 mr-1" /> Individuale ({stats.individualGoals})
            </TabsTrigger>
            <TabsTrigger value="my">Të Miat</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue placeholder="Statusi" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Të gjitha</SelectItem>
              <SelectItem value="On Track">Në Rrugë</SelectItem>
              <SelectItem value="At Risk">Në Rrezik</SelectItem>
              <SelectItem value="Off Track">Jashtë Rrugës</SelectItem>
              <SelectItem value="Achieved">Arritur</SelectItem>
            </SelectContent>
          </Select>

          {permissions.canEdit && (
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-primary text-primary-foreground">
                  <Plus className="w-4 h-4 mr-2" /> Objektiv i Ri
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Krijo Objektiv të Ri</DialogTitle>
                </DialogHeader>
                <GoalForm
                  onSubmit={handleCreate}
                  teams={teams || []}
                  teamMembers={teamMembers || []}
                  projects={projects || []}
                  leads={leads || []}
                  tasks={tasks || []}
                  parentGoals={(allGoals || []).filter(g => (g.scope || 'team') === 'team')}
                  currentUserId={user?.uid}
                  getName={getName}
                />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Goals Grid */}
      {goals.length === 0 ? (
        <Card className="p-12 text-center">
          <Target className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">Asnjë objektiv</h3>
          <p className="text-muted-foreground">Krijo objektivin e parë për të filluar gjurmimin e progresit.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goals.map((goal) => {
            const goalMilestones = milestones?.filter(m => m.goalId === goal.id) || [];
            const completedMilestones = goalMilestones.filter(m => m.status === 'Completed').length;
            const childGoals = getChildGoals(goal.id);
            const linkedCount = (goal.linkedProjects?.length || 0) + (goal.linkedLeads?.length || 0) + (goal.linkedTasks?.length || 0);

            // Skip child goals in grid — they're nested under parent
            if (goal.parentGoalId) return null;

            return (
              <GoalCard
                key={goal.id}
                goal={goal}
                childGoals={childGoals}
                milestones={goalMilestones}
                completedMilestones={completedMilestones}
                linkedCount={linkedCount}
                getStatusIcon={getStatusIcon}
                getName={getName}
                okrCtx={okrCtx}
                onClick={() => setSelectedGoal(goal)}
              />
            );
          })}
        </div>
      )}

      {/* Goal Detail Dialog */}
      {selectedGoal && (
        <GoalDetailDialog
          goal={selectedGoal}
          open={!!selectedGoal}
          onOpenChange={(open) => !open && setSelectedGoal(null)}
          milestones={milestones?.filter(m => m.goalId === selectedGoal.id) || []}
          childGoals={getChildGoals(selectedGoal.id)}
          projects={projects || []}
          leads={leads || []}
          tasks={tasks || []}
          okrCtx={okrCtx}
          getName={getName}
          getStatusIcon={getStatusIcon}
          onUpdate={goalMutation.update}
          onDelete={goalMutation.remove}
          onEdit={() => { setEditingGoal(selectedGoal); setSelectedGoal(null); }}
          milestoneMutation={milestoneMutation}
        />
      )}

      {/* Edit Dialog */}
      {editingGoal && (
        <Dialog open={!!editingGoal} onOpenChange={(open) => !open && setEditingGoal(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Përditëso Objektivin</DialogTitle>
            </DialogHeader>
            <GoalForm
              onSubmit={handleUpdate}
              initialData={editingGoal}
              teams={teams || []}
              teamMembers={teamMembers || []}
              projects={projects || []}
              leads={leads || []}
              tasks={tasks || []}
              parentGoals={(allGoals || []).filter(g => (g.scope || 'team') === 'team' && g.id !== editingGoal.id)}
              currentUserId={user?.uid}
              getName={getName}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

// ─── Goal Card ───────────────────────────────────────────────────────────────
const GoalCard: React.FC<{
  goal: Goal;
  childGoals: Goal[];
  milestones: Milestone[];
  completedMilestones: number;
  linkedCount: number;
  getStatusIcon: (s: string) => React.ReactNode;
  getName: (id: string | null | undefined, fb?: string) => string;
  okrCtx: OkrContext;
  onClick: () => void;
}> = ({ goal, childGoals, milestones, completedMilestones, linkedCount, getStatusIcon, getName, okrCtx, onClick }) => {
  const [expanded, setExpanded] = useState(false);
  const isTeam = (goal.scope || 'team') === 'team';
  const okr = hasKeyResults(goal);
  const progress = goalDerivedProgress(goal, okrCtx);
  const status = okr ? goalHealth(goal, progress) : goal.status;
  const krs = goal.keyResults || [];
  const progressColor =
    progress >= 75 ? 'bg-green-500' :
    progress >= 40 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <Card className="p-5 space-y-3 cursor-pointer transition-all hover:shadow-lg">
      <div className="flex items-start justify-between" onClick={onClick}>
        <div className="flex items-start gap-3 flex-1">
          {getStatusIcon(status)}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="font-semibold text-foreground truncate">{goal.title}</h3>
              <Badge variant="outline" className="text-xs">
                {isTeam ? <><Users className="w-3 h-3 mr-1" />Ekipor</> : <><UserIcon className="w-3 h-3 mr-1" />Individual</>}
              </Badge>
              {okr && (
                <Badge variant="secondary" className="text-[10px] gap-0.5">
                  <Sparkles className="w-3 h-3" /> OKR · {krs.length} KR
                </Badge>
              )}
            </div>
            {goal.description && (
              <p className="text-sm text-muted-foreground line-clamp-2">{goal.description}</p>
            )}
          </div>
        </div>
        <Badge className={getStatusColor(status)}>{status}</Badge>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1" onClick={onClick}>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{okr ? 'Progresi (auto nga KR)' : 'Progresi'}</span>
          <span className="font-medium">{progress}%</span>
        </div>
        <div className="w-full bg-muted rounded-full h-2">
          <div className={`${progressColor} h-2 rounded-full transition-all`} style={{ width: `${progress}%` }} />
        </div>
        {!okr && goal.targetValue != null && (
          <p className="text-xs text-muted-foreground">
            {goal.currentValue || 0} / {goal.targetValue} {goal.metricUnit || ''}
          </p>
        )}
      </div>

      {/* Key Results mini-list */}
      {okr && (
        <div className="space-y-1.5" onClick={onClick}>
          {krs.slice(0, 3).map((kr) => {
            const p = keyResultProgress(kr, goal, okrCtx);
            return (
              <div key={kr.id} className="flex items-center gap-2 text-xs">
                {kr.type === 'auto' ? <Zap className="w-3 h-3 text-indigo-500 shrink-0" />
                  : kr.type === 'milestone' ? <Flag className="w-3 h-3 text-amber-500 shrink-0" />
                  : <Hash className="w-3 h-3 text-blue-500 shrink-0" />}
                <span className="flex-1 truncate text-muted-foreground">{kr.title}</span>
                <span className="font-medium tabular-nums">{p}%</span>
              </div>
            );
          })}
          {krs.length > 3 && <p className="text-[11px] text-muted-foreground pl-5">+{krs.length - 3} të tjera…</p>}
        </div>
      )}

      {/* Footer Row */}
      <div className="flex items-center justify-between pt-2 border-t text-xs text-muted-foreground" onClick={onClick}>
        <div className="flex items-center gap-3">
          {goal.dueDate && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {new Date(goal.dueDate).toLocaleDateString()}
            </span>
          )}
          {milestones.length > 0 && (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> {completedMilestones}/{milestones.length}
            </span>
          )}
          {linkedCount > 0 && (
            <span className="flex items-center gap-1">
              <Link2 className="w-3.5 h-3.5" /> {linkedCount}
            </span>
          )}
        </div>
        {goal.scope === 'individual' && goal.ownerId && (
          <span className="flex items-center gap-1">
            <UserIcon className="w-3.5 h-3.5" /> {getName(goal.ownerId)}
          </span>
        )}
      </div>

      {/* Child Goals */}
      {childGoals.length > 0 && (
        <div className="pt-2 border-t">
          <button
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {childGoals.length} nën-objektiva
          </button>
          {expanded && (
            <div className="mt-2 space-y-2 pl-4 border-l-2 border-muted">
              {childGoals.map(child => {
                const cp = goalDerivedProgress(child, okrCtx);
                const cs = hasKeyResults(child) ? goalHealth(child, cp) : child.status;
                return (
                <div key={child.id} className="flex items-center gap-2 text-sm p-2 rounded bg-muted/50">
                  {getStatusIcon(cs)}
                  <span className="flex-1 truncate">{child.title}</span>
                  <span className="text-xs font-medium">{cp}%</span>
                  {child.ownerId && (
                    <span className="text-xs text-muted-foreground">{getName(child.ownerId)}</span>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

// ─── Key Results Editor (OKR) ────────────────────────────────────────────────
const makeKR = (): KeyResult => ({
  id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2),
  title: '', type: 'metric', startValue: 0, currentValue: 0, targetValue: 100, unit: '',
});

const KR_TYPES: { value: KeyResultType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'metric', label: 'Metrikë', icon: Hash },
  { value: 'auto', label: 'Auto (CRM)', icon: Zap },
  { value: 'milestone', label: 'Etapë', icon: Flag },
];

const KeyResultsEditor: React.FC<{ value: KeyResult[]; onChange: (v: KeyResult[]) => void }> = ({ value, onChange }) => {
  const patch = (id: string, p: Partial<KeyResult>) => onChange(value.map(k => (k.id === id ? { ...k, ...p } : k)));
  const num = (v: string) => (v === '' ? 0 : parseFloat(v) || 0);

  return (
    <div className="space-y-3">
      {value.map((kr, i) => {
        const TypeIcon = KR_TYPES.find(t => t.value === kr.type)?.icon || Hash;
        return (
          <div key={kr.id} className="p-3 rounded-lg border bg-muted/30 space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-md bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                {i + 1}
              </span>
              <Input
                value={kr.title}
                onChange={(e) => patch(kr.id, { title: e.target.value })}
                placeholder={`Key Result ${i + 1} — çfarë mat?`}
                className="h-8 flex-1"
              />
              <button type="button" onClick={() => onChange(value.filter(k => k.id !== kr.id))} className="text-muted-foreground hover:text-destructive shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Type toggle */}
            <div className="flex gap-1">
              {KR_TYPES.map(t => {
                const Icon = t.icon;
                const active = kr.type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => patch(kr.id, {
                      type: t.value,
                      ...(t.value === 'auto' && !kr.autoSource ? { autoSource: 'tasksCompleted' as KeyResultAutoSource, unit: AUTO_SOURCE_UNIT.tasksCompleted } : {}),
                    })}
                    className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs border transition ${active ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground hover:text-foreground'}`}
                  >
                    <Icon className="w-3 h-3" /> {t.label}
                  </button>
                );
              })}
            </div>

            {/* Type-specific fields */}
            {kr.type === 'metric' && (
              <div className="grid grid-cols-4 gap-2">
                <div><Label className="text-[10px]">Fillimi</Label><Input type="number" value={kr.startValue} onChange={e => patch(kr.id, { startValue: num(e.target.value) })} className="h-8" /></div>
                <div><Label className="text-[10px]">Aktuale</Label><Input type="number" value={kr.currentValue} onChange={e => patch(kr.id, { currentValue: num(e.target.value) })} className="h-8" /></div>
                <div><Label className="text-[10px]">Target</Label><Input type="number" value={kr.targetValue} onChange={e => patch(kr.id, { targetValue: num(e.target.value) })} className="h-8" /></div>
                <div><Label className="text-[10px]">Njësia</Label><Input value={kr.unit || ''} onChange={e => patch(kr.id, { unit: e.target.value })} placeholder="L" className="h-8" /></div>
              </div>
            )}
            {kr.type === 'auto' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px]">Burimi (auto nga CRM)</Label>
                  <Select
                    value={kr.autoSource || 'tasksCompleted'}
                    onValueChange={(v) => patch(kr.id, { autoSource: v as KeyResultAutoSource, unit: AUTO_SOURCE_UNIT[v as KeyResultAutoSource] })}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(AUTO_SOURCE_LABELS) as KeyResultAutoSource[]).map(s => (
                        <SelectItem key={s} value={s}>{AUTO_SOURCE_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="text-[10px]">Target</Label><Input type="number" value={kr.targetValue} onChange={e => patch(kr.id, { targetValue: num(e.target.value) })} className="h-8" /></div>
                <p className="col-span-2 text-[10px] text-muted-foreground flex items-center gap-1">
                  <Zap className="w-3 h-3 text-indigo-500" /> Vlera aktuale llogaritet automatikisht nga të dhënat e CRM-së brenda periudhës së objektivit.
                </p>
              </div>
            )}
            {kr.type === 'milestone' && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Flag className="w-3 h-3 text-amber-500" /> Etapë binare — 0% deri sa të shënohet e përfunduar, pastaj 100%.
              </p>
            )}
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" className="w-full gap-1" onClick={() => onChange([...value, makeKR()])}>
        <Plus className="w-4 h-4" /> Shto Key Result
      </Button>
    </div>
  );
};

// ─── Goal Form ───────────────────────────────────────────────────────────────
const GoalForm: React.FC<{
  onSubmit: (data: Partial<Goal>) => void;
  teams: Team[];
  teamMembers: TeamMember[];
  projects: Project[];
  leads: Lead[];
  tasks: Task[];
  parentGoals: Goal[];
  initialData?: Goal;
  currentUserId?: string;
  getName: (id: string | null | undefined, fb?: string) => string;
}> = ({ onSubmit, teams, teamMembers, projects, leads, tasks, parentGoals, initialData, currentUserId, getName }) => {
  const [scope, setScope] = useState<'team' | 'individual'>(initialData?.scope || 'team');
  const [startDate, setStartDate] = useState<Date | undefined>(
    initialData?.startDate ? new Date(initialData.startDate) : undefined
  );
  const [dueDate, setDueDate] = useState<Date | undefined>(
    initialData?.dueDate ? new Date(initialData.dueDate) : undefined
  );
  const [linkedProjects, setLinkedProjects] = useState<string[]>(initialData?.linkedProjects || []);
  const [linkedLeads, setLinkedLeads] = useState<string[]>(initialData?.linkedLeads || []);
  const [linkedTasks, setLinkedTasks] = useState<string[]>(initialData?.linkedTasks || []);
  const [ownerId, setOwnerId] = useState(initialData?.ownerId || currentUserId || '');
  const [parentGoalId, setParentGoalId] = useState(initialData?.parentGoalId || '');
  const [status, setStatus] = useState(initialData?.status || 'On Track');
  const [teamId, setTeamId] = useState(initialData?.teamId || '');
  const [keyResults, setKeyResults] = useState<KeyResult[]>(initialData?.keyResults || []);
  const hasKRs = keyResults.filter(k => k.title.trim()).length > 0;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const data: Partial<Goal> = {
      title: fd.get('title') as string,
      description: fd.get('description') as string,
      scope,
      status: status as Goal['status'],
      progress: parseInt(fd.get('progress') as string) || 0,
      startDate: startDate || undefined,
      dueDate: dueDate || undefined,
      ownerId: scope === 'individual' ? ownerId : (currentUserId || undefined),
      parentGoalId: parentGoalId || undefined,
      linkedProjects: linkedProjects.length ? linkedProjects : undefined,
      linkedLeads: linkedLeads.length ? linkedLeads : undefined,
      linkedTasks: linkedTasks.length ? linkedTasks : undefined,
    };
    // Only set teamId when explicitly chosen; otherwise let useMutation auto-inject it
    if (teamId) data.teamId = teamId;

    // OKR Key Results — sanitized so no `undefined` reaches Firestore arrays.
    const cleanKRs: KeyResult[] = keyResults
      .filter(k => k.title.trim())
      .map(k => {
        const base: KeyResult = {
          id: k.id, title: k.title.trim(), type: k.type,
          startValue: k.startValue || 0, currentValue: k.currentValue || 0,
          targetValue: k.targetValue || 0, unit: k.unit || '',
        };
        if (k.type === 'auto') base.autoSource = k.autoSource || 'tasksCompleted';
        if (k.type === 'milestone') base.done = !!k.done;
        return base;
      });
    data.keyResults = cleanKRs.length ? cleanKRs : undefined;

    const tv = fd.get('targetValue') as string;
    if (tv) {
      data.targetValue = parseFloat(tv);
      data.currentValue = parseFloat(fd.get('currentValue') as string) || 0;
      data.metricUnit = (fd.get('metricUnit') as string) || undefined;
    }

    if (data.startDate && data.dueDate && data.startDate >= data.dueDate) {
      alert('Data e fillimit nuk mund të jetë pas datës së mbarimit!');
      return;
    }

    onSubmit(data);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Scope Selection */}
      <div>
        <Label className="mb-2 block">Lloji i Objektivit</Label>
        <div className="flex gap-2">
          <Button type="button" variant={scope === 'team' ? 'default' : 'outline'} className="flex-1" onClick={() => setScope('team')}>
            <Users className="w-4 h-4 mr-2" /> Ekipor
          </Button>
          <Button type="button" variant={scope === 'individual' ? 'default' : 'outline'} className="flex-1" onClick={() => setScope('individual')}>
            <UserIcon className="w-4 h-4 mr-2" /> Individual
          </Button>
        </div>
      </div>

      <div>
        <Label htmlFor="title">Titulli</Label>
        <Input id="title" name="title" required defaultValue={initialData?.title} />
      </div>

      <div>
        <Label htmlFor="description">Përshkrimi</Label>
        <Textarea id="description" name="description" defaultValue={initialData?.description} rows={2} />
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Data e Fillimit</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start">
                <Calendar className="mr-2 h-4 w-4" />
                {startDate ? startDate.toLocaleDateString() : "Zgjidh"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0"><CalendarComponent mode="single" selected={startDate} onSelect={setStartDate} /></PopoverContent>
          </Popover>
        </div>
        <div>
          <Label>Afati</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start">
                <Calendar className="mr-2 h-4 w-4" />
                {dueDate ? dueDate.toLocaleDateString() : "Zgjidh"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0"><CalendarComponent mode="single" selected={dueDate} onSelect={setDueDate} /></PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Status + Progress */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Statusi</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="On Track">Në Rrugë</SelectItem>
              <SelectItem value="At Risk">Në Rrezik</SelectItem>
              <SelectItem value="Off Track">Jashtë Rrugës</SelectItem>
              <SelectItem value="Achieved">Arritur</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="progress">Progresi (%)</Label>
          {hasKRs ? (
            <div className="h-10 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="w-3.5 h-3.5 text-primary" /> Auto nga Key Results
              <input type="hidden" name="progress" value={initialData?.progress || 0} />
            </div>
          ) : (
            <Input id="progress" name="progress" type="number" min="0" max="100" defaultValue={initialData?.progress || 0} />
          )}
        </div>
      </div>

      {/* Key Results (OKR) */}
      <div className="pt-2 border-t">
        <Label className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="w-4 h-4 text-primary" /> Key Results (OKR)
        </Label>
        <p className="text-[11px] text-muted-foreground mb-3">
          Rezultate të matshme që përcaktojnë suksesin. Progresi i objektivit llogaritet automatikisht si mesatarja e tyre. Përdor <b>Auto</b> për t'i lidhur me të dhënat e CRM-së.
        </p>
        <KeyResultsEditor value={keyResults} onChange={setKeyResults} />
      </div>

      {/* Owner (for individual) */}
      {scope === 'individual' && (
        <div>
          <Label>Antari i Skuadrës</Label>
          <Select value={ownerId} onValueChange={setOwnerId}>
            <SelectTrigger><SelectValue placeholder="Zgjidh antarin" /></SelectTrigger>
            <SelectContent>
              {teamMembers.filter(m => m.status === 'Active').map(m => (
                <SelectItem key={m.userId} value={m.userId}>{getName(m.userId)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Team selector */}
      {scope === 'team' && teams.length > 0 && (
        <div>
          <Label>Ekipi</Label>
          <Select value={teamId} onValueChange={setTeamId}>
            <SelectTrigger><SelectValue placeholder="Zgjidh ekipin" /></SelectTrigger>
            <SelectContent>
              {teams.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Parent Goal */}
      {parentGoals.length > 0 && (
        <div>
          <Label>Objektivi Prind (opsional)</Label>
          <Select value={parentGoalId} onValueChange={setParentGoalId}>
            <SelectTrigger><SelectValue placeholder="Asnjë — objektiv i pavarur" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">Asnjë</SelectItem>
              {parentGoals.map(g => <SelectItem key={g.id} value={g.id}>{g.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Metric Tracking — legacy single-metric, only when no Key Results are set */}
      {!hasKRs && (
      <div>
        <Label className="mb-2 block text-muted-foreground text-xs uppercase tracking-wider">Metrika e thjeshtë (opsionale)</Label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="targetValue" className="text-xs">Vlera Target</Label>
            <Input id="targetValue" name="targetValue" type="number" placeholder="p.sh. 50000" defaultValue={initialData?.targetValue || ''} />
          </div>
          <div>
            <Label htmlFor="currentValue" className="text-xs">Aktuale</Label>
            <Input id="currentValue" name="currentValue" type="number" placeholder="0" defaultValue={initialData?.currentValue || ''} />
          </div>
          <div>
            <Label htmlFor="metricUnit" className="text-xs">Njësia</Label>
            <Input id="metricUnit" name="metricUnit" placeholder="L, leads..." defaultValue={initialData?.metricUnit || ''} />
          </div>
        </div>
      </div>
      )}

      {/* Linked CRM Elements */}
      <div className="space-y-3 pt-2 border-t">
        <Label className="text-muted-foreground text-xs uppercase tracking-wider">Lidh me elemente CRM</Label>

        {/* Linked Projects */}
        <div>
          <Label className="text-xs flex items-center gap-1 mb-1"><FolderKanban className="w-3.5 h-3.5" /> Projekte</Label>
          <div className="flex flex-wrap gap-1 mb-1">
            {linkedProjects.map(id => {
              const p = projects.find(x => x.id === id);
              return (
                <Badge key={id} variant="secondary" className="gap-1">
                  {p?.name || id}
                  <button type="button" onClick={() => setLinkedProjects(prev => prev.filter(x => x !== id))} className="hover:text-destructive">×</button>
                </Badge>
              );
            })}
          </div>
          <Select onValueChange={(v) => { if (v && !linkedProjects.includes(v)) setLinkedProjects(prev => [...prev, v]); }}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="+ Shto projekt" /></SelectTrigger>
            <SelectContent>
              {sortArchivedLast(projects.filter(p => !linkedProjects.includes(p.id))).map(p => (
                <SelectItem key={p.id} value={p.id}>{projectPickerLabel(p)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Linked Leads */}
        <div>
          <Label className="text-xs flex items-center gap-1 mb-1"><Briefcase className="w-3.5 h-3.5" /> Leads</Label>
          <div className="flex flex-wrap gap-1 mb-1">
            {linkedLeads.map(id => {
              const l = leads.find(x => x.id === id);
              return (
                <Badge key={id} variant="secondary" className="gap-1">
                  {l?.name || id}
                  <button type="button" onClick={() => setLinkedLeads(prev => prev.filter(x => x !== id))} className="hover:text-destructive">×</button>
                </Badge>
              );
            })}
          </div>
          <Select onValueChange={(v) => { if (v && !linkedLeads.includes(v)) setLinkedLeads(prev => [...prev, v]); }}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="+ Shto lead" /></SelectTrigger>
            <SelectContent>
              {leads.filter(l => !linkedLeads.includes(l.id)).map(l => (
                <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Linked Tasks */}
        <div>
          <Label className="text-xs flex items-center gap-1 mb-1"><ListTodo className="w-3.5 h-3.5" /> Detyra</Label>
          <div className="flex flex-wrap gap-1 mb-1">
            {linkedTasks.map(id => {
              const t = tasks.find(x => x.id === id);
              return (
                <Badge key={id} variant="secondary" className="gap-1">
                  {t?.title || id}
                  <button type="button" onClick={() => setLinkedTasks(prev => prev.filter(x => x !== id))} className="hover:text-destructive">×</button>
                </Badge>
              );
            })}
          </div>
          <Select onValueChange={(v) => { if (v && !linkedTasks.includes(v)) setLinkedTasks(prev => [...prev, v]); }}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="+ Shto detyrë" /></SelectTrigger>
            <SelectContent>
              {tasks.filter(t => !linkedTasks.includes(t.id)).map(t => (
                <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button type="submit" className="w-full">
        {initialData ? 'Përditëso Objektivin' : 'Krijo Objektivin'}
      </Button>
    </form>
  );
};

// ─── Goal Detail Dialog ──────────────────────────────────────────────────────
const GoalDetailDialog: React.FC<{
  goal: Goal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  milestones: Milestone[];
  childGoals: Goal[];
  projects: Project[];
  leads: Lead[];
  tasks: Task[];
  okrCtx: OkrContext;
  getName: (id: string | null | undefined, fb?: string) => string;
  getStatusIcon: (s: string) => React.ReactNode;
  onUpdate: (id: string, data: any) => Promise<any>;
  onDelete: (id: string) => Promise<any>;
  onEdit: () => void;
  milestoneMutation: ReturnType<typeof useMutation<Milestone>>;
}> = ({ goal, open, onOpenChange, milestones, childGoals, projects, leads, tasks, okrCtx, getName, getStatusIcon, onUpdate, onDelete, onEdit, milestoneMutation }) => {
  const [newMilestone, setNewMilestone] = useState('');
  const [newMilestoneDueDate, setNewMilestoneDueDate] = useState<Date | undefined>();
  const isTeam = (goal.scope || 'team') === 'team';

  // Local, editable copy of Key Results for instant inline feedback.
  const [krs, setKrs] = useState<KeyResult[]>(goal.keyResults || []);
  useEffect(() => { setKrs(goal.keyResults || []); }, [goal.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveGoal: Goal = useMemo(() => ({ ...goal, keyResults: krs }), [goal, krs]);
  const okr = hasKeyResults(liveGoal);
  const progress = goalDerivedProgress(liveGoal, okrCtx);
  const derivedStatus = okr ? goalHealth(liveGoal, progress) : goal.status;
  const score = goalScore(progress);
  const progressColor =
    progress >= 75 ? 'bg-green-500' :
    progress >= 40 ? 'bg-amber-500' : 'bg-red-500';

  const persistKRs = (next: KeyResult[]) => { setKrs(next); onUpdate(goal.id, { keyResults: next }); };
  const patchKR = (id: string, p: Partial<KeyResult>) => persistKRs(krs.map(k => (k.id === id ? { ...k, ...p } : k)));

  const handleAddMilestone = async () => {
    if (!newMilestone.trim()) return;
    await milestoneMutation.create({
      goalId: goal.id,
      title: newMilestone.trim(),
      status: 'Pending',
      dueDate: newMilestoneDueDate || undefined,
    } as any);
    setNewMilestone('');
    setNewMilestoneDueDate(undefined);
  };

  const toggleMilestone = async (m: Milestone) => {
    const next = m.status === 'Completed' ? 'Pending' : 'Completed';
    await milestoneMutation.update(m.id, { status: next, completed: next === 'Completed' } as any);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="w-5 h-5" />
            {goal.title}
            <Badge variant="outline" className="ml-2 text-xs">
              {isTeam ? 'Ekipor' : 'Individual'}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {goal.description && (
            <p className="text-muted-foreground">{goal.description}</p>
          )}

          {/* Progress */}
          <div>
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="font-medium flex items-center gap-1.5">
                Progresi {okr && <Badge variant="secondary" className="text-[10px] gap-0.5"><Sparkles className="w-3 h-3" />OKR · score {score.toFixed(1)}</Badge>}
              </span>
              <span className="font-bold text-lg">{progress}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-3">
              <div className={`${progressColor} h-3 rounded-full transition-all`} style={{ width: `${progress}%` }} />
            </div>
            {!okr && goal.targetValue != null && (
              <p className="text-sm text-muted-foreground mt-1">
                {goal.currentValue || 0} / {goal.targetValue} {goal.metricUnit || ''}
              </p>
            )}
            {okr && (
              <p className="text-xs text-muted-foreground mt-1">
                Llogaritur automatikisht si mesatarja e {krs.length} Key Results.
                {score >= 0.6 && score <= 0.7 && ' 🎯 Zonë ideale për objektiva ambicioze (0.6–0.7).'}
              </p>
            )}
          </div>

          {/* Key Results */}
          {okr && (
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" /> Key Results ({krs.length})
              </h4>
              <div className="space-y-3">
                {krs.map((kr) => {
                  const p = keyResultProgress(kr, liveGoal, okrCtx);
                  const cur = keyResultCurrent(kr, liveGoal, okrCtx);
                  const barColor = p >= 75 ? 'bg-green-500' : p >= 40 ? 'bg-amber-500' : 'bg-red-500';
                  return (
                    <div key={kr.id} className="p-3 rounded-lg border bg-muted/30">
                      <div className="flex items-center gap-2 mb-2">
                        {kr.type === 'auto' ? <Zap className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                          : kr.type === 'milestone' ? <Flag className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          : <Hash className="w-3.5 h-3.5 text-blue-500 shrink-0" />}
                        <span className="text-sm font-medium flex-1 min-w-0 truncate">{kr.title}</span>
                        <span className="text-sm font-bold tabular-nums">{p}%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2 mb-2">
                        <div className={`${barColor} h-2 rounded-full transition-all`} style={{ width: `${p}%` }} />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        {kr.type === 'milestone' ? (
                          <button
                            onClick={() => patchKR(kr.id, { done: !kr.done })}
                            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md ${kr.done ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-muted hover:bg-muted/70'}`}
                          >
                            <CheckCircle2 className={`w-3.5 h-3.5 ${kr.done ? 'text-green-500' : 'text-muted-foreground'}`} />
                            {kr.done ? 'E përfunduar' : 'Shëno të përfunduar'}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {Math.round(cur).toLocaleString()} / {Math.round(kr.targetValue).toLocaleString()} {kr.unit}
                            {kr.type === 'auto' && <span className="ml-1 text-indigo-500">· auto</span>}
                          </span>
                        )}
                        {kr.type === 'metric' && (
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => patchKR(kr.id, { currentValue: Math.max(0, (kr.currentValue || 0) - 1) })}>
                              <Minus className="w-3 h-3" />
                            </Button>
                            <Input
                              type="number"
                              value={kr.currentValue}
                              onChange={(e) => setKrs(krs.map(k => k.id === kr.id ? { ...k, currentValue: e.target.value === '' ? 0 : parseFloat(e.target.value) || 0 } : k))}
                              onBlur={() => onUpdate(goal.id, { keyResults: krs })}
                              className="h-7 w-20 text-center text-xs"
                            />
                            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => patchKR(kr.id, { currentValue: (kr.currentValue || 0) + 1 })}>
                              <Plus className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Meta Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="bg-muted/50 p-3 rounded">
              <p className="text-muted-foreground text-xs mb-1">Statusi{okr ? ' (auto)' : ''}</p>
              <Badge className={getStatusColor(derivedStatus)}>{derivedStatus}</Badge>
            </div>
            <div className="bg-muted/50 p-3 rounded">
              <p className="text-muted-foreground text-xs mb-1">{isTeam ? 'Lloji' : 'Pronari'}</p>
              <p className="font-medium">{isTeam ? 'Objektiv Ekipor' : getName(goal.ownerId)}</p>
            </div>
            {goal.startDate && (
              <div className="bg-muted/50 p-3 rounded">
                <p className="text-muted-foreground text-xs mb-1">Fillimi</p>
                <p className="font-medium">{new Date(goal.startDate).toLocaleDateString()}</p>
              </div>
            )}
            {goal.dueDate && (
              <div className="bg-muted/50 p-3 rounded">
                <p className="text-muted-foreground text-xs mb-1">Afati</p>
                <p className="font-medium">{new Date(goal.dueDate).toLocaleDateString()}</p>
              </div>
            )}
          </div>

          {/* Child Goals */}
          {childGoals.length > 0 && (
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <ChevronRight className="w-4 h-4" /> Nën-Objektiva ({childGoals.length})
              </h4>
              <div className="space-y-2">
                {childGoals.map(child => {
                  const cp = goalDerivedProgress(child, okrCtx);
                  const cs = hasKeyResults(child) ? goalHealth(child, cp) : child.status;
                  return (
                  <div key={child.id} className="flex items-center gap-3 p-3 bg-muted/50 rounded">
                    {getStatusIcon(cs)}
                    <div className="flex-1">
                      <p className="font-medium text-sm">{child.title}</p>
                      {child.ownerId && <p className="text-xs text-muted-foreground">{getName(child.ownerId)}</p>}
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-sm">{cp}%</p>
                      <div className="w-20 bg-muted rounded-full h-1.5 mt-1">
                        <div className="bg-primary h-1.5 rounded-full" style={{ width: `${cp}%` }} />
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Linked CRM Elements */}
          {(goal.linkedProjects?.length || goal.linkedLeads?.length || goal.linkedTasks?.length) ? (
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <Link2 className="w-4 h-4" /> Elemente të Lidhura
              </h4>
              <div className="space-y-2">
                {goal.linkedProjects?.map(id => {
                  const p = projects.find(x => x.id === id);
                  return p ? (
                    <div key={id} className="flex items-center gap-2 p-2 bg-muted/50 rounded text-sm">
                      <FolderKanban className="w-4 h-4 text-blue-500" />
                      <span className="flex-1">{p.name}</span>
                      <Badge variant="outline" className="text-xs">{p.status}</Badge>
                    </div>
                  ) : null;
                })}
                {goal.linkedLeads?.map(id => {
                  const l = leads.find(x => x.id === id);
                  return l ? (
                    <div key={id} className="flex items-center gap-2 p-2 bg-muted/50 rounded text-sm">
                      <Briefcase className="w-4 h-4 text-orange-500" />
                      <span className="flex-1">{l.name}</span>
                      <Badge variant="outline" className="text-xs">{l.status}</Badge>
                    </div>
                  ) : null;
                })}
                {goal.linkedTasks?.map(id => {
                  const t = tasks.find(x => x.id === id);
                  return t ? (
                    <div key={id} className="flex items-center gap-2 p-2 bg-muted/50 rounded text-sm">
                      <ListTodo className="w-4 h-4 text-primary" />
                      <span className="flex-1">{t.title}</span>
                      <Badge variant="outline" className="text-xs">{t.status}</Badge>
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          ) : null}

          {/* Milestones */}
          <div className="border-t pt-4">
            <h4 className="font-medium mb-3">Etapat ({milestones.length})</h4>
            <div className="space-y-2">
              {milestones.map(m => {
                const mDue = m.dueDate ? new Date(m.dueDate as any) : null;
                const mOverdue = mDue && m.status !== 'Completed' && mDue < new Date();
                return (
                <div key={m.id} className={`flex items-center gap-3 p-3 rounded group ${mOverdue ? 'bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800' : 'bg-muted/50'}`}>
                  <button onClick={() => toggleMilestone(m)}>
                    <CheckCircle2 className={`w-5 h-5 ${m.status === 'Completed' ? 'text-green-500' : mOverdue ? 'text-red-400 hover:text-green-400' : 'text-muted-foreground hover:text-green-400'}`} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm ${m.status === 'Completed' ? 'line-through text-muted-foreground' : ''}`}>
                      {m.title}
                    </span>
                    {mDue && (
                      <p className={`text-xs mt-0.5 ${mOverdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                        {mOverdue ? '⚠ Vonuar · ' : ''}{mDue.toLocaleDateString('sq-AL')}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => milestoneMutation.remove(m.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
              })}
              <div className="space-y-2 pt-1">
                <div className="flex gap-2">
                  <Input
                    placeholder="Shto etapë të re..."
                    value={newMilestone}
                    onChange={e => setNewMilestone(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddMilestone())}
                    className="h-9"
                  />
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button size="sm" variant="outline" className={`h-9 gap-1 ${newMilestoneDueDate ? 'text-primary border-primary' : ''}`}>
                        <Calendar className="w-3.5 h-3.5" />
                        {newMilestoneDueDate ? newMilestoneDueDate.toLocaleDateString('sq-AL') : 'Afat'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <CalendarComponent mode="single" selected={newMilestoneDueDate} onSelect={setNewMilestoneDueDate} />
                    </PopoverContent>
                  </Popover>
                  <Button size="sm" variant="outline" onClick={handleAddMilestone} disabled={!newMilestone.trim()}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4 border-t">
            <Button variant="outline" onClick={onEdit} className="flex-1">
              <Pencil className="w-4 h-4 mr-2" /> Përditëso
            </Button>
            <Button variant="destructive" onClick={() => { onDelete(goal.id); onOpenChange(false); }}>
              <Trash2 className="w-4 h-4 mr-2" /> Fshi
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GoalsView;
