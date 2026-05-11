import React, { useState, useMemo } from 'react';
import { useCollection } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import {
  AlertTriangle, CheckCircle2, CircleDot, Play, Clock, Loader2,
  ChevronDown, ChevronUp, User, FolderKanban,
} from 'lucide-react';
import type { Task, TeamMember, UserProfile, Project } from '../types';

/** Deterministic colour from a string */
function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 42%)`;
}

const WorkloadView: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [filterProject, setFilterProject] = useState<string>('__all__');

  const { data: rawTasks, loading: tasksLoading } = useCollection<Task>('tasks', {
    skip: !permissions.teamId,
    orderBy: { field: 'createdAt', direction: 'desc' },
  });

  const { data: teamMembers, loading: membersLoading } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
    skipTeamFilter: true,
  });

  const { data: userProfiles } = useCollection<UserProfile>('userProfiles');

  const { data: projects } = useCollection<Project>('projects');

  // Exclude subtasks
  const tasks = useMemo(() => {
    if (!rawTasks) return [];
    const filtered = rawTasks.filter((t) => !t.parentTaskId);
    if (filterProject === '__all__') return filtered;
    return filtered.filter((t) => (t as any).projectId === filterProject);
  }, [rawTasks, filterProject]);

  // Filter team members to this team
  const members = useMemo(() => {
    if (!teamMembers || !permissions.teamId) return [];
    return teamMembers.filter((m) => m.teamId === permissions.teamId);
  }, [teamMembers, permissions.teamId]);

  // Resolve display name for a userId
  const getDisplayName = (userId: string): string => {
    if (userId === user?.uid) return user?.displayName || 'Ti';
    const profile = userProfiles?.find((p) => p.userId === userId || p.id === userId);
    if (profile?.displayName) return profile.displayName;
    const member = members.find((m) => m.userId === userId);
    if (member?.displayName) return member.displayName;
    if (member?.email) return member.email.split('@')[0];
    return userId.slice(0, 8);
  };

  const getProjectName = (projectId?: string): string | null => {
    if (!projectId) return null;
    return projects?.find((p) => p.id === projectId)?.name || null;
  };

  // Per-member workload data
  const workloadData = useMemo(() => {
    const now = new Date();
    return members.map((m) => {
      const memberTasks = tasks.filter((t) => t.assignedToUserId === m.userId);
      const todo = memberTasks.filter((t) => t.status === 'Todo').length;
      const inProgress = memberTasks.filter((t) => t.status === 'In Progress').length;
      const review = memberTasks.filter((t) => t.status === 'Review').length;
      const done = memberTasks.filter((t) => t.status === 'Done').length;
      const overdue = memberTasks.filter(
        (t) => t.status !== 'Done' && t.endDate && new Date(t.endDate) < now
      ).length;
      const active = todo + inProgress + review;
      const total = active + done;

      let workloadLevel: 'low' | 'medium' | 'high' | 'critical';
      if (active <= 3) workloadLevel = 'low';
      else if (active <= 6) workloadLevel = 'medium';
      else if (active <= 10) workloadLevel = 'high';
      else workloadLevel = 'critical';

      // Per-project breakdown for this member
      const projectBreakdown = new Map<string, { name: string; active: number; done: number }>();
      for (const t of memberTasks) {
        const pid = (t as any).projectId;
        if (!pid) continue;
        const entry = projectBreakdown.get(pid) ?? { name: getProjectName(pid) || pid.slice(0, 8), active: 0, done: 0 };
        if (t.status === 'Done') entry.done++;
        else entry.active++;
        projectBreakdown.set(pid, entry);
      }

      return {
        member: m,
        name: getDisplayName(m.userId),
        tasks: memberTasks,
        todo,
        inProgress,
        review,
        done,
        overdue,
        active,
        total,
        workloadLevel,
        projectBreakdown: Array.from(projectBreakdown.values()).sort((a, b) => b.active - a.active),
      };
    });
  }, [members, tasks, userProfiles, user, projects]);

  // Unassigned tasks
  const unassignedTasks = useMemo(
    () => tasks.filter((t) => !t.assignedToUserId && t.status !== 'Done'),
    [tasks]
  );

  const workloadColors: Record<string, string> = {
    low: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    high: 'bg-orange-100 text-orange-700 border-orange-200',
    critical: 'bg-red-100 text-red-700 border-red-200',
  };
  const workloadLabels: Record<string, string> = {
    low: 'E lirë',
    medium: 'Normale',
    high: 'E ngarkuar',
    critical: 'Mbingarkuar',
  };
  const workloadBarColor: Record<string, string> = {
    low: 'bg-emerald-500',
    medium: 'bg-yellow-500',
    high: 'bg-orange-500',
    critical: 'bg-red-500',
  };

  if (tasksLoading || membersLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Sort: critical → high → medium → low; secondary: active desc
  const sorted = [...workloadData].sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    const diff = order[a.workloadLevel] - order[b.workloadLevel];
    if (diff !== 0) return diff;
    return b.active - a.active;
  });

  const totalActive = tasks.filter((t) => t.status !== 'Done').length;
  const totalDone = tasks.filter((t) => t.status === 'Done').length;
  const totalOverdue = tasks.filter(
    (t) => t.status !== 'Done' && t.endDate && new Date(t.endDate) < new Date()
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Ngarkesa e Ekipit</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {members.length} anëtarë · {totalActive} detyra aktive · {totalDone} përfunduara
          </p>
        </div>

        {/* Project filter */}
        <Select value={filterProject} onValueChange={setFilterProject}>
          <SelectTrigger className="w-48 h-9 text-sm">
            <FolderKanban className="w-4 h-4 mr-2 flex-shrink-0 text-muted-foreground" />
            <SelectValue placeholder="Të gjitha projektet" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Të gjitha projektet</SelectItem>
            {(projects || []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Detyra Aktive</p>
          <p className="text-2xl font-bold text-foreground">{totalActive}</p>
        </Card>
        <Card className="p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Përfunduara</p>
          <p className="text-2xl font-bold text-emerald-600">{totalDone}</p>
        </Card>
        <Card className="p-4 space-y-1">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-destructive" /> Vonuara
          </p>
          <p className="text-2xl font-bold text-destructive">{totalOverdue}</p>
        </Card>
        <Card className="p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Pa caktuar</p>
          <p className="text-2xl font-bold text-warning">{unassignedTasks.length}</p>
        </Card>
      </div>

      {/* Member Workload Cards */}
      <div className="space-y-3">
        {sorted.map((wd) => {
          const isExpanded = expandedMember === wd.member.userId;
          const initials = wd.name.slice(0, 2).toUpperCase();
          const avatarBg = hashColor(wd.name);
          const maxActive = Math.max(...sorted.map((x) => x.active), 1);

          return (
            <Card key={wd.member.id} className="overflow-hidden">
              {/* Summary row */}
              <div
                className="p-4 flex items-center gap-4 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedMember(isExpanded ? null : wd.member.userId)}
              >
                {/* Avatar */}
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                  style={{ backgroundColor: avatarBg }}
                >
                  {initials}
                </div>

                {/* Name + role */}
                <div className="min-w-[120px]">
                  <p className="text-sm font-medium text-foreground leading-snug">{wd.name}</p>
                  <p className="text-xs text-muted-foreground">{wd.member.role}</p>
                </div>

                {/* Workload bar */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">{wd.active} aktive</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 ${workloadColors[wd.workloadLevel]}`}
                    >
                      {workloadLabels[wd.workloadLevel]}
                    </Badge>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${workloadBarColor[wd.workloadLevel]}`}
                      style={{ width: `${(wd.active / maxActive) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Status mini counters */}
                <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
                  {wd.todo > 0 && (
                    <span className="flex items-center gap-1">
                      <CircleDot className="w-3 h-3 text-slate-400" />
                      {wd.todo}
                    </span>
                  )}
                  {wd.inProgress > 0 && (
                    <span className="flex items-center gap-1">
                      <Play className="w-3 h-3 text-blue-500" />
                      {wd.inProgress}
                    </span>
                  )}
                  {wd.review > 0 && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-amber-500" />
                      {wd.review}
                    </span>
                  )}
                  {wd.done > 0 && (
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                      {wd.done}
                    </span>
                  )}
                  {wd.overdue > 0 && (
                    <span className="flex items-center gap-1 text-destructive font-medium">
                      <AlertTriangle className="w-3 h-3" />
                      {wd.overdue} vonuar
                    </span>
                  )}
                </div>

                {/* Expand toggle */}
                <div className="text-muted-foreground flex-shrink-0">
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div className="border-t bg-muted/20">
                  {/* Per-project breakdown */}
                  {filterProject === '__all__' && wd.projectBreakdown.length > 0 && (
                    <div className="px-4 py-2.5 border-b flex flex-wrap gap-2">
                      {wd.projectBreakdown.map((pb) => (
                        <span
                          key={pb.name}
                          className="inline-flex items-center gap-1.5 text-xs bg-background border rounded-full px-2.5 py-1"
                        >
                          <FolderKanban className="w-3 h-3 text-primary" />
                          <span className="font-medium">{pb.name}</span>
                          {pb.active > 0 && (
                            <span className="text-muted-foreground">{pb.active} aktive</span>
                          )}
                          {pb.done > 0 && (
                            <span className="text-emerald-600">· {pb.done} ✓</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Active task list */}
                  {wd.tasks.filter((t) => t.status !== 'Done').length === 0 ? (
                    <p className="px-4 py-3 text-sm text-muted-foreground italic">
                      Asnjë detyrë aktive
                    </p>
                  ) : (
                    <div className="divide-y">
                      {wd.tasks
                        .filter((t) => t.status !== 'Done')
                        .map((t) => {
                          const isOverdue =
                            t.endDate && new Date(t.endDate) < new Date();
                          const projName = getProjectName((t as any).projectId);
                          return (
                            <div
                              key={t.id}
                              className={`flex items-center gap-3 px-4 py-2.5 ${isOverdue ? 'bg-destructive/5' : ''}`}
                            >
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                                  t.status === 'In Progress'
                                    ? 'bg-blue-100 text-blue-700'
                                    : t.status === 'Review'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {t.status === 'In Progress'
                                  ? 'Në progres'
                                  : t.status === 'Review'
                                  ? 'Rishikim'
                                  : 'Për të bërë'}
                              </span>
                              <span className="text-sm text-foreground flex-1 min-w-0 truncate">
                                {t.title}
                              </span>
                              {projName && filterProject === '__all__' && (
                                <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5 flex-shrink-0 hidden md:block truncate max-w-[100px]">
                                  {projName}
                                </span>
                              )}
                              {isOverdue && (
                                <AlertTriangle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />
                              )}
                              {t.endDate && (
                                <span
                                  className={`text-xs flex-shrink-0 ${
                                    isOverdue ? 'text-destructive font-medium' : 'text-muted-foreground'
                                  }`}
                                >
                                  {new Date(t.endDate).toLocaleDateString('sq-AL', {
                                    day: 'numeric',
                                    month: 'short',
                                  })}
                                </span>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
                  {wd.tasks.filter((t) => t.status === 'Done').length > 0 && (
                    <p className="px-4 py-2 text-xs text-muted-foreground border-t bg-muted/10">
                      + {wd.tasks.filter((t) => t.status === 'Done').length} të përfunduara
                    </p>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Unassigned tasks block */}
      {unassignedTasks.length > 0 && (
        <Card className="overflow-hidden">
          <div
            className="p-4 flex items-center gap-4 cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() =>
              setExpandedMember(expandedMember === '__unassigned__' ? null : '__unassigned__')
            }
          >
            <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
              <User className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Pa caktuar</p>
              <p className="text-xs text-muted-foreground">
                {unassignedTasks.length} detyra pa anëtar
              </p>
            </div>
            <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 text-[10px]">
              Kërkon vëmendje
            </Badge>
            {expandedMember === '__unassigned__' ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
          {expandedMember === '__unassigned__' && (
            <div className="border-t bg-muted/20 divide-y">
              {unassignedTasks.map((t) => {
                const projName = getProjectName((t as any).projectId);
                return (
                  <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                        t.status === 'In Progress'
                          ? 'bg-blue-100 text-blue-700'
                          : t.status === 'Review'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {t.status === 'In Progress'
                        ? 'Në progres'
                        : t.status === 'Review'
                        ? 'Rishikim'
                        : 'Për të bërë'}
                    </span>
                    <span className="text-sm text-foreground flex-1 min-w-0 truncate">{t.title}</span>
                    {projName && (
                      <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5 flex-shrink-0 hidden md:block">
                        {projName}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default WorkloadView;
