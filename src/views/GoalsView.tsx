import React, { useState, useMemo } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useUserNames } from '../hooks/useUserNames';
import { getStatusColor } from '../lib/statusColors';
import {
  Target, Plus, CheckCircle2, Calendar, Users, User as UserIcon,
  AlertCircle, Link2, Trash2, ChevronDown, ChevronRight,
  FolderKanban, Briefcase, ListTodo, BarChart3, Pencil,
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
import { useFilteredByOwner } from '../hooks/useRoleFilteredData';
import type { Goal, Team, TeamMember, Milestone, Project, Lead, Task } from '../types';

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
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers');
  const { data: milestones } = useCollection<Milestone>('milestones');
  // CRM collections — lazy-loaded only when a dialog is open
  const needsCRM = isCreateDialogOpen || !!editingGoal || !!selectedGoal;
  const { data: projects } = useCollection<Project>('projects', { skip: !needsCRM });
  const { data: leads } = useCollection<Lead>('leads', { skip: !needsCRM });
  const { data: tasks } = useCollection<Task>('tasks', { skip: !needsCRM });
  const { getName } = useUserNames(teamMembers);

  // Mutations
  const goalMutation = useMutation<Goal>('goals');
  const milestoneMutation = useMutation<Milestone>('milestones');

  // Filtered goals
  const goals = useMemo(() => {
    if (!allGoals) return [];
    let filtered = allGoals;
    if (filterStatus !== 'all') filtered = filtered.filter(g => g.status === filterStatus);
    if (activeTab === 'team') filtered = filtered.filter(g => (g.scope || 'team') === 'team');
    if (activeTab === 'individual') filtered = filtered.filter(g => g.scope === 'individual');
    if (activeTab === 'my') filtered = filtered.filter(g => g.ownerId === user?.uid);
    return filtered;
  }, [allGoals, filterStatus, activeTab, user]);

  // Stats
  const stats = useMemo(() => {
    const all = allGoals || [];
    return {
      total: all.length,
      teamGoals: all.filter(g => (g.scope || 'team') === 'team').length,
      individualGoals: all.filter(g => g.scope === 'individual').length,
      onTrack: all.filter(g => g.status === 'On Track').length,
      atRisk: all.filter(g => g.status === 'At Risk' || g.status === 'Off Track').length,
      achieved: all.filter(g => g.status === 'Achieved').length,
      avgProgress: all.length ? Math.round(all.reduce((s, g) => s + (g.progress || 0), 0) / all.length) : 0,
    };
  }, [allGoals]);

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
    setIsCreateDialogOpen(false);
  };

  const handleUpdate = async (data: Partial<Goal>) => {
    if (!editingGoal) return;
    await goalMutation.update(editingGoal.id, data as any);
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
            <SelectTrigger className="w-[140px]">
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
  onClick: () => void;
}> = ({ goal, childGoals, milestones, completedMilestones, linkedCount, getStatusIcon, getName, onClick }) => {
  const [expanded, setExpanded] = useState(false);
  const isTeam = (goal.scope || 'team') === 'team';
  const progressColor =
    (goal.progress || 0) >= 75 ? 'bg-green-500' :
    (goal.progress || 0) >= 40 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <Card className="p-5 space-y-3 cursor-pointer transition-all hover:shadow-lg">
      <div className="flex items-start justify-between" onClick={onClick}>
        <div className="flex items-start gap-3 flex-1">
          {getStatusIcon(goal.status)}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="font-semibold text-foreground truncate">{goal.title}</h3>
              <Badge variant="outline" className="text-xs">
                {isTeam ? <><Users className="w-3 h-3 mr-1" />Ekipor</> : <><UserIcon className="w-3 h-3 mr-1" />Individual</>}
              </Badge>
            </div>
            {goal.description && (
              <p className="text-sm text-muted-foreground line-clamp-2">{goal.description}</p>
            )}
          </div>
        </div>
        <Badge className={getStatusColor(goal.status)}>{goal.status}</Badge>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1" onClick={onClick}>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Progresi</span>
          <span className="font-medium">{goal.progress || 0}%</span>
        </div>
        <div className="w-full bg-muted rounded-full h-2">
          <div className={`${progressColor} h-2 rounded-full transition-all`} style={{ width: `${goal.progress || 0}%` }} />
        </div>
        {goal.targetValue != null && (
          <p className="text-xs text-muted-foreground">
            {goal.currentValue || 0} / {goal.targetValue} {goal.metricUnit || ''}
          </p>
        )}
      </div>

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
              {childGoals.map(child => (
                <div key={child.id} className="flex items-center gap-2 text-sm p-2 rounded bg-muted/50">
                  {getStatusIcon(child.status)}
                  <span className="flex-1 truncate">{child.title}</span>
                  <span className="text-xs font-medium">{child.progress || 0}%</span>
                  {child.ownerId && (
                    <span className="text-xs text-muted-foreground">{getName(child.ownerId)}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
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
          <Input id="progress" name="progress" type="number" min="0" max="100" defaultValue={initialData?.progress || 0} />
        </div>
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

      {/* Metric Tracking */}
      <div>
        <Label className="mb-2 block text-muted-foreground text-xs uppercase tracking-wider">Metrika (opsionale)</Label>
        <div className="grid grid-cols-3 gap-3">
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
            <Input id="metricUnit" name="metricUnit" placeholder="€, leads..." defaultValue={initialData?.metricUnit || ''} />
          </div>
        </div>
      </div>

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
              {projects.filter(p => !linkedProjects.includes(p.id)).map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
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
  getName: (id: string | null | undefined, fb?: string) => string;
  getStatusIcon: (s: string) => React.ReactNode;
  onUpdate: (id: string, data: any) => Promise<any>;
  onDelete: (id: string) => Promise<any>;
  onEdit: () => void;
  milestoneMutation: ReturnType<typeof useMutation<Milestone>>;
}> = ({ goal, open, onOpenChange, milestones, childGoals, projects, leads, tasks, getName, getStatusIcon, onUpdate, onDelete, onEdit, milestoneMutation }) => {
  const [newMilestone, setNewMilestone] = useState('');
  const isTeam = (goal.scope || 'team') === 'team';
  const progressColor =
    (goal.progress || 0) >= 75 ? 'bg-green-500' :
    (goal.progress || 0) >= 40 ? 'bg-amber-500' : 'bg-red-500';

  const handleAddMilestone = async () => {
    if (!newMilestone.trim()) return;
    await milestoneMutation.create({
      goalId: goal.id,
      title: newMilestone.trim(),
      status: 'Pending',
    } as any);
    setNewMilestone('');
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
              <span className="font-medium">Progresi</span>
              <span className="font-bold text-lg">{goal.progress || 0}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-3">
              <div className={`${progressColor} h-3 rounded-full transition-all`} style={{ width: `${goal.progress || 0}%` }} />
            </div>
            {goal.targetValue != null && (
              <p className="text-sm text-muted-foreground mt-1">
                {goal.currentValue || 0} / {goal.targetValue} {goal.metricUnit || ''}
              </p>
            )}
          </div>

          {/* Meta Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="bg-muted/50 p-3 rounded">
              <p className="text-muted-foreground text-xs mb-1">Statusi</p>
              <Badge className={getStatusColor(goal.status)}>{goal.status}</Badge>
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
                {childGoals.map(child => (
                  <div key={child.id} className="flex items-center gap-3 p-3 bg-muted/50 rounded">
                    {getStatusIcon(child.status)}
                    <div className="flex-1">
                      <p className="font-medium text-sm">{child.title}</p>
                      {child.ownerId && <p className="text-xs text-muted-foreground">{getName(child.ownerId)}</p>}
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-sm">{child.progress || 0}%</p>
                      <div className="w-20 bg-muted rounded-full h-1.5 mt-1">
                        <div className="bg-primary h-1.5 rounded-full" style={{ width: `${child.progress || 0}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
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
                      <ListTodo className="w-4 h-4 text-purple-500" />
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
              {milestones.map(m => (
                <div key={m.id} className="flex items-center gap-3 p-3 bg-muted/50 rounded group">
                  <button onClick={() => toggleMilestone(m)}>
                    <CheckCircle2 className={`w-5 h-5 ${m.status === 'Completed' ? 'text-green-500' : 'text-muted-foreground hover:text-green-400'}`} />
                  </button>
                  <span className={`flex-1 text-sm ${m.status === 'Completed' ? 'line-through text-muted-foreground' : ''}`}>
                    {m.title}
                  </span>
                  <button
                    onClick={() => milestoneMutation.remove(m.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <Input
                  placeholder="Shto etapë të re..."
                  value={newMilestone}
                  onChange={e => setNewMilestone(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddMilestone())}
                  className="h-9"
                />
                <Button size="sm" variant="outline" onClick={handleAddMilestone} disabled={!newMilestone.trim()}>
                  <Plus className="w-4 h-4" />
                </Button>
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
