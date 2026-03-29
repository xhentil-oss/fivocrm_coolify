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
import type { Project, Task, Team, TeamMember, Customer, Invoice, Service, InvoiceItem } from '../types';

const ProjectsView: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const permissions = usePermissions();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string } | null>(null);
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
  const { data: services } = useCollection<Service>('services', { skipTeamFilter: true });
  
  const projectMutation = useMutation<Project>('projects');
  const taskMutation = useMutation<Task>('tasks');
  const invoiceMutation = useMutation<Invoice>('invoices');
  const invoiceItemMutation = useMutation<InvoiceItem>('invoiceItems');
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

    // Members filter — checks memberUserIds first, falls back to team membership
    if (filterMembers.length > 0 && teamMembers) {
      filtered = filtered.filter(p => {
        const explicit = (p.memberUserIds as string[] | undefined);
        if (explicit && explicit.length > 0) {
          return filterMembers.some(id => explicit.includes(id));
        }
        // fallback: any member of the project's team
        if (!p.teamId) return false;
        const projectTeamMembers = teamMembers.filter(m => m.teamId === p.teamId);
        return filterMembers.some(memberId => projectTeamMembers.some(m => m.userId === memberId));
      });
    }
    
    return filtered;
  }, [projects, searchQuery, filterOwner, filterTeam, filterStatus, filterMembers, teamMembers]);

  // Get members for a project:
  //  - if memberUserIds is set → show exactly those people
  //  - otherwise fall back to everyone on the project's team
  const getProjectMembers = (project: Project) => {
    if (!teamMembers) return [];
    const explicit = (project.memberUserIds as string[] | undefined);
    if (explicit && explicit.length > 0) {
      return teamMembers.filter(m => explicit.includes(m.userId));
    }
    if (!project.teamId) return [];
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
    const memberUserIdsStr = formData.get('memberUserIds') as string;
    let memberUserIds: string[] | undefined;
    if (memberUserIdsStr) {
      try { memberUserIds = JSON.parse(memberUserIdsStr); } catch { memberUserIds = undefined; }
    }
    const selectedServiceIdsStr = formData.get('selectedServiceIds') as string;
    let selectedServiceIds: string[] | undefined;
    if (selectedServiceIdsStr) {
      try { selectedServiceIds = JSON.parse(selectedServiceIdsStr); } catch { selectedServiceIds = undefined; }
    }

    const budgetRaw = budgetStr ? parseFloat(budgetStr) : undefined;
    const budget = budgetRaw !== undefined && !isNaN(budgetRaw) ? budgetRaw : undefined;
    const resolvedCustomerId = custId && custId !== '__none__' ? custId : undefined;
    const resolvedTeamId = teamId && teamId !== '__none__' ? teamId : undefined;

    const newProject = await projectMutation.create({
      name,
      description,
      status,
      teamId: resolvedTeamId,
      budget,
      spent: 0,
      customerId: resolvedCustomerId,
      responsibleUserId: responsibleUserId && responsibleUserId !== '__none__' ? responsibleUserId : undefined,
      isRecurring: isRecurring || undefined,
      recurringFrequency: isRecurring && recurringFrequency ? recurringFrequency as any : undefined,
      memberUserIds: memberUserIds && memberUserIds.length > 0 ? memberUserIds : undefined,
      serviceIds: selectedServiceIds && selectedServiceIds.length > 0 ? selectedServiceIds : undefined,
    });

    // Always create a Draft invoice when a project is created
    const now = new Date();
    const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day of month

    if (isRecurring) {
      const invoiceLabel = `AUTO-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${newProject.id.slice(0, 6).toUpperCase()}`;
      const newInvoice = await invoiceMutation.create({
        invoiceNumber: invoiceLabel,
        projectId: newProject.id,
        customerId: resolvedCustomerId,
        teamId: resolvedTeamId,
        amount: budget || 0,
        subtotal: budget || 0,
        total: budget || 0,
        tax: 0,
        status: 'Draft',
        notes: `Faturë e gjeneruar automatikisht për projektin periodik "${name}".`,
        dueDate,
        isRecurring: true,
        recurringFrequency: (recurringFrequency || 'monthly') as any,
        autoGenerated: true,
        emailSent: false,
        reminderSent: false,
        reminder25Sent: false,
        reminderLastDaySent: false,
      } as any);

      // Create invoiceItems for selected services
      if (selectedServiceIds && selectedServiceIds.length > 0 && services) {
        for (const serviceId of selectedServiceIds) {
          const service = services.find(s => s.id === serviceId);
          if (service) {
            await invoiceItemMutation.create({
              invoiceId: (newInvoice as any).id,
              serviceId: service.id,
              quantity: 1,
              unitPrice: service.price || 0,
              totalPrice: service.price || 0,
            } as any);
          }
        }
      }

      // Send invoice email to customer via API (sets status → Pending)
      if (resolvedCustomerId) {
        try {
          const authToken = await user?.getIdToken();
          await fetch('/api/send-invoice-email', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            },
            body: JSON.stringify({ invoiceId: (newInvoice as any).id }),
          });
        } catch {
          // email failure is non-blocking
        }
      }
    } else {
      // Non-recurring project: create a plain Draft invoice
      const invoiceLabel = `DRAFT-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${newProject.id.slice(0, 6).toUpperCase()}`;
      const newInvoice = await invoiceMutation.create({
        invoiceNumber: invoiceLabel,
        projectId: newProject.id,
        customerId: resolvedCustomerId,
        teamId: resolvedTeamId,
        amount: budget || 0,
        subtotal: budget || 0,
        total: budget || 0,
        tax: 0,
        status: 'Draft',
        notes: `Faturë draft e krijuar automatikisht për projektin "${name}".`,
        dueDate,
      } as any);

      // Create invoiceItems for selected services
      if (selectedServiceIds && selectedServiceIds.length > 0 && services) {
        for (const serviceId of selectedServiceIds) {
          const service = services.find(s => s.id === serviceId);
          if (service) {
            await invoiceItemMutation.create({
              invoiceId: (newInvoice as any).id,
              serviceId: service.id,
              quantity: 1,
              unitPrice: service.price || 0,
              totalPrice: service.price || 0,
            } as any);
          }
        }
      }
    }

    logActivity('project_created', `Projekt i ri: ${name}`, { entityType: 'project', entityId: newProject.id });
    setIsCreateDialogOpen(false);
    navigate(`/app/projects/${newProject.id}`);
  };

  const handleDeleteProject = async (id: string, name: string) => {
    const projectTasks = allTasks?.filter(t => (t as any).projectId === id) || [];
    await Promise.all(projectTasks.map(t => taskMutation.remove(t.id)));
    await projectMutation.remove(id);
    logActivity('project_deleted', `Projekt i fshiër: ${name}`, { entityType: 'project', entityId: id });
    setProjectToDelete(null);
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
              <ProjectForm onSubmit={handleCreateProject} teams={teams || []} customers={customers || []} teamMembers={teamMembers || []} services={services || []} />
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
              {['Active', 'Planning', 'In Review', 'On Hold', 'Completed', 'Archived', 'Cancelled'].map(status => (
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
                      onClick={(e) => { e.stopPropagation(); setProjectToDelete({ id: project.id, name: project.name }); }}
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

      {/* Delete Project Confirmation */}
      <Dialog open={!!projectToDelete} onOpenChange={(open) => { if (!open) setProjectToDelete(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Fshi Projektin</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Je i sigurt që dëshiron të fshish projektin <span className="font-semibold">"{projectToDelete?.name}"</span>? Të gjitha detyrat e lidhura do të fshihen gjithashtu.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setProjectToDelete(null)}>Anulo</Button>
            <Button variant="destructive" onClick={() => projectToDelete && handleDeleteProject(projectToDelete.id, projectToDelete.name)}>Fshi</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Project Form Component
const ProjectForm: React.FC<{
  onSubmit: (data: FormData) => void;
  teams: Team[];
  customers?: Customer[];
  teamMembers?: import('../types').TeamMember[];
  services?: Service[];
  initialData?: Project;
}> = ({ onSubmit, teams, customers, teamMembers, services, initialData }) => {
  const [teamId, setTeamId] = useState(initialData?.teamId || '__none__');
  const [custId, setCustId] = useState((initialData as any)?.customerId || '__none__');
  const [responsibleUserId, setResponsibleUserId] = useState(initialData?.responsibleUserId || '__none__');
  const [isRecurring, setIsRecurring] = useState(initialData?.isRecurring || false);
  const [recurringFrequency, setRecurringFrequency] = useState(initialData?.recurringFrequency || 'monthly');
  const [memberUserIds, setMemberUserIds] = useState<string[]>(initialData?.memberUserIds || []);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [serviceCategory, setServiceCategory] = useState<string>('__all__');
  const { getName } = useUserNames(teamMembers || []);

  const serviceCategories = React.useMemo(() => {
    if (!services) return [];
    const cats = [...new Set(services.map(s => s.category).filter(Boolean))] as string[];
    return cats.sort();
  }, [services]);

  const filteredServices = React.useMemo(() => {
    if (!services) return [];
    if (serviceCategory === '__all__') return services;
    return services.filter(s => s.category === serviceCategory);
  }, [services, serviceCategory]);

  const serviceBudget = React.useMemo(() => {
    if (!services || selectedServiceIds.length === 0) return null;
    return services
      .filter(s => selectedServiceIds.includes(s.id))
      .reduce((sum, s) => sum + (s.price || 0), 0);
  }, [services, selectedServiceIds]);

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
    formData.set('memberUserIds', JSON.stringify(memberUserIds));
    formData.set('selectedServiceIds', JSON.stringify(selectedServiceIds));
    // Override budget with computed service total if services are selected
    if (serviceBudget !== null) {
      formData.set('budget', String(serviceBudget));
    }
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
            <SelectItem value="In Review">Nën Vlerësim</SelectItem>
            <SelectItem value="On Hold">Në pritje</SelectItem>
            <SelectItem value="Completed">Përfunduar</SelectItem>
            <SelectItem value="Archived">Arkivuar</SelectItem>
            <SelectItem value="Cancelled">Anuluar</SelectItem>
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

      {/* Services → Budget */}
      {services && services.length > 0 && (
        <div>
          <Label>Shërbimet e Projektit</Label>
          <p className="text-xs text-muted-foreground mb-2">Zgjidh kategorinë dhe mëpas shërbimet — totali llogaritet automatikisht si buxhet</p>

          {/* Category filter pills */}
          {serviceCategories.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              <button
                type="button"
                onClick={() => setServiceCategory('__all__')}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  serviceCategory === '__all__'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted text-muted-foreground border-border hover:bg-muted/70'
                }`}
              >
                Të gjitha
              </button>
              {serviceCategories.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setServiceCategory(cat)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    serviceCategory === cat
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-border hover:bg-muted/70'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {/* Services list filtered by category */}
          <div className="space-y-1.5 max-h-44 overflow-y-auto border rounded-md p-2">
            {filteredServices.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2 text-center">Nuk ka shërbime në këtë kategori</p>
            ) : filteredServices.map(s => (
              <label key={s.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 px-2 py-1 rounded">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-primary"
                  checked={selectedServiceIds.includes(s.id)}
                  onChange={(e) => {
                    setSelectedServiceIds(prev =>
                      e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id)
                    );
                  }}
                />
                <div className="flex-1 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{s.name || s.title}</span>
                    {s.category && serviceCategory === '__all__' && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{s.category}</span>
                    )}
                  </div>
                  <span className="text-sm text-primary font-medium shrink-0">{(s.price || 0).toLocaleString()} {s.currency || 'ALL'}</span>
                </div>
              </label>
            ))}
          </div>

          {selectedServiceIds.length > 0 && (
            <p className="text-xs text-primary font-medium mt-1">
              {selectedServiceIds.length} shërbim{selectedServiceIds.length !== 1 ? 'e' : ''} zgjedhur · Total: {serviceBudget?.toLocaleString()} {services[0]?.currency || 'ALL'}
            </p>
          )}
        </div>
      )}

      {/* Budget */}
      <div>
        <Label htmlFor="budget">Buxheti / Të Ardhurat e Projektit (L)</Label>
        <Input
          id="budget"
          name="budget"
          type="number"
          step="0.01"
          value={serviceBudget !== null ? String(serviceBudget) : undefined}
          defaultValue={serviceBudget !== null ? undefined : ((initialData as any)?.budget || '')}
          onChange={() => {}}
          placeholder="0.00"
          readOnly={serviceBudget !== null}
          className={serviceBudget !== null ? 'bg-muted cursor-not-allowed' : ''}
        />
        <p className="text-xs text-muted-foreground mt-1">
          {serviceBudget !== null ? 'Llogaritet automatikisht nga shërbimet e zgjedhura' : 'Shuma që projekti gjeneron si të ardhura'}
        </p>
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

      {/* Project Members */}
      {teamMembers && teamMembers.length > 0 && (
        <div>
          <Label>Anëtarët e Projektit</Label>
          <p className="text-xs text-muted-foreground mb-2">Zgjidh personat që do të marrin pjesë në këtë projekt</p>
          <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-2">
            {teamMembers.map(m => (
              <label key={m.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 px-2 py-1 rounded">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-primary"
                  checked={memberUserIds.includes(m.userId)}
                  onChange={(e) => {
                    setMemberUserIds(prev =>
                      e.target.checked ? [...prev, m.userId] : prev.filter(id => id !== m.userId)
                    );
                  }}
                />
                <div className="flex items-center gap-2 flex-1">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                    {getName(m.userId).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{getName(m.userId)}</p>
                    <p className="text-xs text-muted-foreground">{m.role}</p>
                  </div>
                </div>
              </label>
            ))}
          </div>
          {memberUserIds.length > 0 && (
            <p className="text-xs text-primary mt-1">{memberUserIds.length} person{memberUserIds.length !== 1 ? 'a' : ''} të zgjedhur</p>
          )}
        </div>
      )}

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
