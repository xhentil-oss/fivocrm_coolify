import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { Search, Plus, List, Users, ChevronDown, MoreVertical, Folder, Trash2 } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Checkbox } from '../components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { useActivityLogger } from '../hooks/useActivityLogger';
import { useFilteredProjects } from '../hooks/useRoleFilteredData';
import { useUserNames } from '../hooks/useUserNames';
import type { Project, Task, Team, TeamMember, Customer } from '../types';

const ProjectsView: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const permissions = usePermissions();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Filters
  const [filterOwner, setFilterOwner] = useState<string>('all');
  const [filterTeam, setFilterTeam] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterMembers, setFilterMembers] = useState<string[]>([]);

  // Firebase hooks
  const { data: rawProjects, loading: projectsLoading } = useCollection<Project>('projects', {
    orderBy: { field: 'updatedAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  const { data: allTasks } = useCollection<Task>('tasks');
  // Role-based filtering: Member/Viewer see only projects they're involved in
  const projects = useFilteredProjects(rawProjects, allTasks);
  const { data: teams } = useCollection<Team>('teams');
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }]
  });
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  
  const projectMutation = useMutation<Project>('projects');
  const taskMutation = useMutation<Task>('tasks');
  const logActivity = useActivityLogger();

  const { getName, getInitials } = useUserNames(teamMembers || []);

  // Get unique owners from projects
  const owners = React.useMemo(() => {
    if (!projects) return [];
    const ownerIds = [...new Set(projects.map(p => p.createdByUserId).filter(Boolean))];
    return ownerIds;
  }, [projects]);

  // Filter projects
  const filteredProjects = React.useMemo(() => {
    if (!projects) return [];
    
    let filtered = [...projects];
    
    // Search filter
    if (searchQuery) {
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    // Owner filter
    if (filterOwner !== 'all') {
      filtered = filtered.filter(p => p.createdByUserId === filterOwner);
    }
    
    // Team filter
    if (filterTeam !== 'all') {
      filtered = filtered.filter(p => p.teamId === filterTeam);
    }
    
    // Status filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter(p => p.status === filterStatus);
    }

    // Members filter
    if (filterMembers.length > 0 && teamMembers) {
      filtered = filtered.filter(p => {
        if (!p.teamId) return false;
        const projectTeamMembers = teamMembers.filter(m => m.teamId === p.teamId);
        return filterMembers.some(memberId => projectTeamMembers.some(m => m.userId === memberId));
      });
    }
    
    return filtered;
  }, [projects, searchQuery, filterOwner, filterTeam, filterStatus, filterMembers, teamMembers]);

  // Get members for a project (based on team)
  const getProjectMembers = (project: Project) => {
    if (!project.teamId || !teamMembers) return [];
    return teamMembers.filter(m => m.teamId === project.teamId);
  };

  // Get team name
  const getTeamName = (teamId?: string) => {
    if (!teamId || !teams) return null;
    return teams.find(t => t.id === teamId);
  };

  // Format relative time
  const formatRelativeTime = (date: Date) => {
    if (!date) return 'Pa kohë';
    const now = new Date();
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) return 'Pa kohë';
    const diff = now.getTime() - dateObj.getTime();
    if (diff < 0) return 'në të ardhmen';
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor(diff / (1000 * 60));
    
    if (minutes < 60) return `${minutes} min më parë`;
    if (hours < 24) return `${hours} orë më parë`;
    if (days === 1) return 'Dje';
    if (days < 7) return `${days} ditë më parë`;
    return new Date(date).toLocaleDateString('sq-AL');
  };

  const handleCreateProject = async (formData: FormData) => {
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;
    const status = formData.get('status') as string;
    const teamId = formData.get('teamId') as string;
    const budgetStr = formData.get('budget') as string;
    const custId = formData.get('customerId') as string;
    const responsibleUserId = formData.get('responsibleUserId') as string;
    const isRecurring = formData.get('isRecurring') === 'true';
    const recurringFrequency = formData.get('recurringFrequency') as string;
    const maxMembersStr = formData.get('maxMembers') as string;

    const newProject = await projectMutation.create({
      name,
      description,
      status,
      teamId: teamId && teamId !== '__none__' ? teamId : undefined,
      budget: budgetStr ? parseFloat(budgetStr) : undefined,
      spent: 0,
      customerId: custId && custId !== '__none__' ? custId : undefined,
      responsibleUserId: responsibleUserId && responsibleUserId !== '__none__' ? responsibleUserId : undefined,
      isRecurring: isRecurring || undefined,
      recurringFrequency: isRecurring && recurringFrequency ? recurringFrequency as any : undefined,
      maxMembers: maxMembersStr && maxMembersStr !== '__unlimited__' ? parseInt(maxMembersStr) : undefined,
    });

    logActivity('project_created', `Projekt i ri: ${name}`, { entityType: 'project', entityId: newProject.id });
    setIsCreateDialogOpen(false);
    navigate(`/app/projects/${newProject.id}`);
  };

  const handleDeleteProject = async (id: string, name: string) => {
    if (window.confirm(`Je i sigurt që dëshiron të fshish projektin "${name}"?\n\nKjo do të fshijë gjithashtu të gjitha detyrat e lidhura.`)) {
      // Cascade delete: remove all tasks belonging to this project
      const projectTasks = allTasks?.filter(t => (t as any).projectId === id) || [];
      await Promise.all(projectTasks.map(t => taskMutation.remove(t.id)));
      await projectMutation.remove(id);
      logActivity('project_deleted', `Projekt i fshirë: ${name}`, { entityType: 'project', entityId: id });
    }
  };

  if (projectsLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 skeleton rounded" />
          <div className="h-10 w-32 skeleton rounded" />
        </div>
        <div className="h-10 w-full skeleton rounded" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 w-full skeleton rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Shfleto projektet</h1>
        {permissions.canEdit && (
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground w-full sm:w-auto">
                <Plus className="w-4 h-4 mr-2" />
                Krijo projekt
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Krijo Projekt të Ri</DialogTitle>
              </DialogHeader>
              <ProjectForm onSubmit={handleCreateProject} teams={teams || []} customers={customers || []} teamMembers={teamMembers || []} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Gjej një projekt"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 h-10"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Owner Filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              Pronari
              <ChevronDown className="w-3 h-3 ml-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" align="start">
            <div className="space-y-1">
              <button
                className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${filterOwner === 'all' ? 'bg-muted' : ''}`}
                onClick={() => setFilterOwner('all')}
              >
                Të gjithë
              </button>
              {user && (
                <button
                  className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${filterOwner === user.uid ? 'bg-muted' : ''}`}
                  onClick={() => setFilterOwner(user.uid)}
                >
                  Unë
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Members Filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              Anëtarët
              <ChevronDown className="w-3 h-3 ml-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="start">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground px-2 py-1">Filtro sipas anëtarëve</p>
              {teamMembers?.slice(0, 30).map(member => (
                <div key={member.id} className="flex items-center gap-2 px-2 py-1.5">
                  <Checkbox
                    checked={filterMembers.includes(member.userId)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setFilterMembers([...filterMembers, member.userId]);
                      } else {
                        setFilterMembers(filterMembers.filter(id => id !== member.userId));
                      }
                    }}
                  />
                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs">
                    {getInitials(member.userId)}
                  </div>
                  <span className="text-sm truncate">{getName(member.userId)}</span>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Teams Filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              Ekipet
              <ChevronDown className="w-3 h-3 ml-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" align="start">
            <div className="space-y-1">
              <button
                className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${filterTeam === 'all' ? 'bg-muted' : ''}`}
                onClick={() => setFilterTeam('all')}
              >
                Të gjitha
              </button>
              {teams?.map(team => (
                <button
                  key={team.id}
                  className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${filterTeam === team.id ? 'bg-muted' : ''}`}
                  onClick={() => setFilterTeam(team.id)}
                >
                  {team.name}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Status Filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              Statusi
              <ChevronDown className="w-3 h-3 ml-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-40 p-2" align="start">
            <div className="space-y-1">
              <button
                className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${filterStatus === 'all' ? 'bg-muted' : ''}`}
                onClick={() => setFilterStatus('all')}
              >
                Të gjitha
              </button>
              {['Active', 'Planning', 'On Hold', 'Completed'].map(status => (
                <button
                  key={status}
                  className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${filterStatus === status ? 'bg-muted' : ''}`}
                  onClick={() => setFilterStatus(status)}
                >
                  {status}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Clear Filters */}
        {(filterOwner !== 'all' || filterTeam !== 'all' || filterStatus !== 'all' || filterMembers.length > 0) && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-8 text-muted-foreground"
            onClick={() => {
              setFilterOwner('all');
              setFilterTeam('all');
              setFilterStatus('all');
              setFilterMembers([]);
            }}
          >
            Pastro filtrat
          </Button>
        )}
      </div>

      {/* Projects Table */}
      <div className="border rounded-lg overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-muted/50 border-b text-sm font-medium text-muted-foreground">
          <div className="col-span-5">Emri</div>
          <div className="col-span-2">Anëtarët</div>
          <div className="col-span-3">Ekipet dhe portfoliot</div>
          <div className="col-span-2 text-right">Modifikuar</div>
        </div>

        {/* Table Body */}
        <div className="divide-y">
          {filteredProjects.map((project) => {
            const members = getProjectMembers(project);
            const team = getTeamName(project.teamId);
            const isJoined = members.some(m => m.userId === user?.uid);
            
            return (
              <div
                key={project.id}
                className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors items-center group"
                onClick={() => navigate(`/app/projects/${project.id}`)}
              >
                {/* Name Column */}
                <div className="col-span-5 flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-pink-100 flex items-center justify-center flex-shrink-0">
                    <List className="w-4 h-4 text-pink-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground truncate">{project.name}</span>
                    </div>
                    {isJoined && (
                      <span className="text-xs text-success">Joined</span>
                    )}
                  </div>
                </div>

                {/* Members Column */}
                <div className="col-span-2">
                  <div className="flex items-center">
                    <div className="flex -space-x-2">
                      {members.slice(0, 3).map((member, idx) => (
                        <div
                          key={member.id}
                          className="w-7 h-7 rounded-full bg-primary/20 border-2 border-background flex items-center justify-center text-xs font-medium"
                          title={getName(member.userId)}
                        >
                          {getInitials(member.userId)}
                        </div>
                      ))}
                    </div>
                    {members.length > 3 && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ...
                      </span>
                    )}
                    {members.length === 0 && (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                </div>

                {/* Teams Column */}
                <div className="col-span-3">
                  {team ? (
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <Badge variant="secondary" className="text-xs font-normal">
                        {team.name}
                      </Badge>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>

                {/* Last Modified Column */}
                <div className="col-span-2 text-right flex items-center justify-end gap-1">
                  <span className="text-sm text-muted-foreground">
                    {formatRelativeTime(project.updatedAt)}
                  </span>
                  {permissions.canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); handleDeleteProject(project.id, project.name); }}
                      title="Fshi projektin"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}

          {filteredProjects.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Folder className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Asnjë projekt u gjet</p>
              {searchQuery && (
                <Button 
                  variant="link" 
                  className="mt-2"
                  onClick={() => setSearchQuery('')}
                >
                  Pastro kërkimin
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Results Count */}
      <div className="text-sm text-muted-foreground">
        {filteredProjects.length} projekt{filteredProjects.length !== 1 ? 'e' : ''}
      </div>
    </div>
  );
};

// Project Form Component
const ProjectForm: React.FC<{
  onSubmit: (data: FormData) => void;
  teams: Team[];
  customers?: Customer[];
  teamMembers?: import('../types').TeamMember[];
  initialData?: Project;
}> = ({ onSubmit, teams, customers, teamMembers, initialData }) => {
  const [teamId, setTeamId] = useState(initialData?.teamId || '__none__');
  const [custId, setCustId] = useState((initialData as any)?.customerId || '__none__');
  const [responsibleUserId, setResponsibleUserId] = useState(initialData?.responsibleUserId || '__none__');
  const [isRecurring, setIsRecurring] = useState(initialData?.isRecurring || false);
  const [recurringFrequency, setRecurringFrequency] = useState(initialData?.recurringFrequency || 'monthly');
  const [maxMembers, setMaxMembers] = useState(initialData?.maxMembers ? String(initialData.maxMembers) : '__unlimited__');
  const { getName } = useUserNames(teamMembers || []);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    if (teamId && teamId !== '__none__') {
      formData.set('teamId', teamId);
    }
    if (custId && custId !== '__none__') {
      formData.set('customerId', custId);
    }
    if (responsibleUserId && responsibleUserId !== '__none__') {
      formData.set('responsibleUserId', responsibleUserId);
    }
    formData.set('isRecurring', isRecurring ? 'true' : 'false');
    if (isRecurring) formData.set('recurringFrequency', recurringFrequency);
    formData.set('maxMembers', maxMembers);
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Emri i Projektit</Label>
        <Input id="name" name="name" required defaultValue={initialData?.name} placeholder="p.sh. Website Redesign" />
      </div>

      <div>
        <Label htmlFor="description">Përshkrimi</Label>
        <Textarea id="description" name="description" defaultValue={initialData?.description} placeholder="Përshkruaj projektin..." rows={3} />
      </div>

      <div>
        <Label htmlFor="status">Statusi</Label>
        <Select name="status" defaultValue={initialData?.status || 'Planning'}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Planning">Planifikim</SelectItem>
            <SelectItem value="Active">Aktiv</SelectItem>
            <SelectItem value="On Hold">Në pritje</SelectItem>
            <SelectItem value="Completed">Përfunduar</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="teamId">Ekipi</Label>
        <Select value={teamId} onValueChange={setTeamId}>
          <SelectTrigger>
            <SelectValue placeholder="Zgjidh ekipin" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Asnjë ekip</SelectItem>
            {teams.map(team => (
              <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Customer */}
      <div>
        <Label htmlFor="customerId">Klienti</Label>
        <Select value={custId} onValueChange={setCustId}>
          <SelectTrigger>
            <SelectValue placeholder="Zgjidh klientin" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Asnjë klient</SelectItem>
            {customers?.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name} {c.company && `(${c.company})`}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Budget */}
      <div>
        <Label htmlFor="budget">Buxheti / Të Ardhurat e Projektit (L)</Label>
        <Input id="budget" name="budget" type="number" step="0.01" defaultValue={(initialData as any)?.budget || ''} placeholder="0.00" />
        <p className="text-xs text-muted-foreground mt-1">Shuma që projekti gjeneron si të ardhura</p>
      </div>

      {/* Responsible Person */}
      {teamMembers && teamMembers.length > 0 && (
        <div>
          <Label htmlFor="responsibleUserId">Përgjegjësi i Projektit</Label>
          <Select value={responsibleUserId} onValueChange={setResponsibleUserId}>
            <SelectTrigger>
              <SelectValue placeholder="Zgjidh punonjësin" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Asnjë i caktuar</SelectItem>
              {teamMembers.map(m => (
                <SelectItem key={m.id} value={m.userId}>
                  {getName(m.userId)} ({m.role})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">Punonjësi që merr kredit për këtë projekt në llogaritjen e bonusit</p>
        </div>
      )}

      {/* Max Members */}
      <div>
        <Label htmlFor="maxMembers">Numri Maksimal i Anëtarëve</Label>
        <Select value={maxMembers} onValueChange={setMaxMembers}>
          <SelectTrigger>
            <SelectValue placeholder="Pa limit" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__unlimited__">Pa limit</SelectItem>
            <SelectItem value="1">1 person</SelectItem>
            <SelectItem value="2">2 persona</SelectItem>
            <SelectItem value="3">3 persona</SelectItem>
            <SelectItem value="4">4 persona</SelectItem>
            <SelectItem value="5">5 persona</SelectItem>
            <SelectItem value="6">6 persona</SelectItem>
            <SelectItem value="8">8 persona</SelectItem>
            <SelectItem value="10">10 persona</SelectItem>
            <SelectItem value="15">15 persona</SelectItem>
            <SelectItem value="20">20 persona</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">Sa anëtarë mund të jenë pjesë e këtij projekti</p>
      </div>

      {/* Recurring Project */}
      <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/40">
        <div>
          <p className="text-sm font-medium">Projekt Periodik</p>
          <p className="text-xs text-muted-foreground">Projekti ripërsëritet automatikisht çdo javë/muaj</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isRecurring}
          onClick={() => setIsRecurring(!isRecurring)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            isRecurring ? 'bg-primary' : 'bg-muted-foreground/30'
          }`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            isRecurring ? 'translate-x-4' : 'translate-x-1'
          }`} />
        </button>
      </div>

      {isRecurring && (
        <div>
          <Label>Frekuenca e Përsëritjes</Label>
          <Select value={recurringFrequency} onValueChange={setRecurringFrequency}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Javore (çdo javë)</SelectItem>
              <SelectItem value="monthly">Mujore (çdo muaj)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Kur të gjitha detyrat mbarojnë, projekti shënohet si kompletuar për atë periudhë dhe rifillon automatikisht.
          </p>
        </div>
      )}

      <Button type="submit" className="w-full">
        {initialData ? 'Ruaj Ndryshimet' : 'Krijo Projektin'}
      </Button>
    </form>
  );
};

export default ProjectsView;
