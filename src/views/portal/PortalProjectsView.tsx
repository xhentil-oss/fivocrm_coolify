import React from 'react';
import { Link } from 'react-router-dom';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useAuth } from '../../contexts/AuthContext';
import { useCollection } from '../../hooks/useFirestore';
import { getStatusColor } from '../../lib/statusColors';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { FolderKanban, ArrowRight, CheckCircle2, Clock, Pause, ClipboardList } from 'lucide-react';
import type { Project, Task, ServiceInquiry } from '../../types';

const PortalProjectsView: React.FC = () => {
  const { customerId } = useClientPortal();
  const { user } = useAuth();

  const { data: projectsByCustomer, loading: loadingByCustomer } = useCollection<Project>('projects', {
    skip: !customerId,
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });
  const { data: projectsByMember, loading: loadingByMember } = useCollection<Project>('projects', {
    where: user?.uid ? [{ field: 'memberUserIds', operator: 'array-contains', value: user.uid }] : [{ field: 'customerId', operator: '==', value: '' }],
    skipTeamFilter: true,
  });

  // ── Kërkesat/anketat e klientit (draft + të dërguara) ──
  const { data: myInquiries } = useCollection<ServiceInquiry>('serviceInquiries', {
    where: user?.uid ? [{ field: 'clientUserId', operator: '==', value: user.uid }] : [],
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });

  const rawProjects = React.useMemo(() => {
    const all = [...(projectsByCustomer || []), ...(projectsByMember || [])];
    const seen = new Set<string>();
    return all.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  }, [projectsByCustomer, projectsByMember]);

  const loading = loadingByCustomer || loadingByMember;

  const { data: projectTasks } = useCollection<Task>('tasks', {
    skip: !customerId,
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });

  const projects = React.useMemo(() => {
    if (!rawProjects) return [];
    return rawProjects.map(p => {
      const pTasks = projectTasks?.filter(t => t.projectId === p.id) || [];
      const done = pTasks.filter(t => t.status === 'Done').length;
      const total = pTasks.length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      return { ...p, done, total, pct };
    }).sort((a, b) => {
      const order: Record<string, number> = { Active: 0, Planning: 1, 'On Hold': 2, Completed: 3 };
      return (order[a.status] ?? 4) - (order[b.status] ?? 4);
    });
  }, [rawProjects, projectTasks]);

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'Active': return { color: getStatusColor('Active'), icon: <Clock className="h-4 w-4" /> };
      case 'Planning': return { color: getStatusColor('Planning'), icon: <FolderKanban className="h-4 w-4" /> };
      case 'On Hold': return { color: getStatusColor('On Hold'), icon: <Pause className="h-4 w-4" /> };
      case 'Completed': return { color: getStatusColor('Completed'), icon: <CheckCircle2 className="h-4 w-4" /> };
      default: return { color: getStatusColor(status), icon: null };
    }
  };
  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'Active': return 'Aktiv';
      case 'Planning': return 'Planifikim';
      case 'On Hold': return 'Në Pritje';
      case 'Completed': return 'Përfunduar';
      default: return status;
    }
  };

  // Inquiry status → pill + progress hint
  const inquiryMeta = (s: string) => {
    switch (s) {
      case 'Draft': return { label: 'Anketa e papërfunduar', pill: 'bg-yellow-100 text-yellow-800', cta: 'Vazhdo anketën', pct: 25 };
      case 'New': return { label: 'Në shqyrtim', pill: 'bg-blue-100 text-blue-800', cta: 'Shiko', pct: 100 };
      case 'Reviewed': return { label: 'Në shqyrtim', pill: 'bg-purple-100 text-purple-800', cta: 'Shiko', pct: 100 };
      case 'Converted': return { label: 'Konvertuar', pill: 'bg-green-100 text-green-800', cta: 'Shiko', pct: 100 };
      default: return { label: s, pill: 'bg-gray-100 text-gray-800', cta: 'Shiko', pct: 100 };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground">Duke ngarkuar projektet...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Projektet</h1>
        <p className="text-muted-foreground mt-1">Shikoni progresin dhe detajet e projekteve tuaja</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="rounded-2xl"><CardContent className="pt-6 text-center"><p className="text-2xl font-bold">{projects.length}</p><p className="text-sm text-muted-foreground">Totale</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="pt-6 text-center"><p className="text-2xl font-bold text-green-600">{projects.filter(p => p.status === 'Active').length}</p><p className="text-sm text-muted-foreground">Aktive</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="pt-6 text-center"><p className="text-2xl font-bold text-emerald-600">{projects.filter(p => p.status === 'Completed').length}</p><p className="text-sm text-muted-foreground">Përfunduara</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="pt-6 text-center"><p className="text-2xl font-bold text-yellow-600">{projects.filter(p => p.status === 'On Hold').length}</p><p className="text-sm text-muted-foreground">Në Pritje</p></CardContent></Card>
      </div>

      {/* ── Kërkesat & Anketat ── */}
      {myInquiries && myInquiries.length > 0 && (
        <div>
          <div className="flex items-center gap-2.5 mb-4">
            <h2 className="text-lg font-semibold tracking-tight">Kërkesat & Anketat</h2>
            <span className="text-xs font-semibold text-muted-foreground bg-muted rounded-full px-2.5 py-0.5">{myInquiries.length}</span>
          </div>
          <div className="space-y-3">
            {myInquiries.map(inq => {
              const meta = inquiryMeta(inq.status);
              const title = (inq as any).serviceTitle || inq.servicesInterestedIn?.[0] || 'Kërkesë shërbimi';
              const isDraft = inq.status === 'Draft';
              return (
                <Link key={inq.id} to={`/portal/projects/inquiry/${inq.id}`}>
                  <Card className={`rounded-2xl transition-all hover:-translate-y-0.5 hover:shadow-md cursor-pointer ${isDraft ? 'border-primary/40 ring-1 ring-primary/20 bg-gradient-to-br from-primary/[0.04] to-transparent' : ''}`}>
                    <CardContent className="py-4">
                      <div className="flex items-center gap-4">
                        <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${isDraft ? 'bg-brand-gradient shadow-lg shadow-primary/30' : 'bg-primary/10'}`}>
                          <ClipboardList className={`h-5 w-5 ${isDraft ? 'text-white' : 'text-primary'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold truncate">{title}</p>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta.pill}`}>{meta.label}</span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {isDraft ? 'Plotësoni anketën që ekipi të përgatisë propozimin tuaj.' : 'Ekipi po e shqyrton kërkesën tuaj.'}
                          </p>
                        </div>
                        <div className="hidden sm:block w-36">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-muted-foreground">Anketa</span>
                            <span className="font-medium">{meta.pct}%</span>
                          </div>
                          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-brand-gradient rounded-full transition-all" style={{ width: `${meta.pct}%` }} />
                          </div>
                        </div>
                        <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${isDraft ? 'text-primary' : 'text-muted-foreground'}`}>
                          {meta.cta}<ArrowRight className="h-4 w-4" />
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Project List */}
      <div>
        {myInquiries && myInquiries.length > 0 && (
          <h2 className="text-lg font-semibold tracking-tight mb-4">Projektet e Mia</h2>
        )}
        {projects.length === 0 ? (
          <Card className="rounded-2xl">
            <CardContent className="py-12 text-center">
              <FolderKanban className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground font-medium">Nuk ka projekte akoma</p>
              <p className="text-sm text-muted-foreground mt-1">Projektet tuaja do të shfaqen këtu kur ekipi t'i krijojë ato.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {projects.map(project => {
              const statusConfig = getStatusConfig(project.status);
              return (
                <Link key={project.id} to={`/portal/projects/${project.id}`}>
                  <Card className="rounded-2xl transition-all hover:-translate-y-0.5 hover:shadow-md cursor-pointer">
                    <CardContent className="py-4">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="p-2 bg-primary/10 rounded-xl flex-shrink-0">
                            <FolderKanban className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold truncate">{project.name}</p>
                            {project.description && (
                              <p className="text-sm text-muted-foreground truncate mt-0.5">{project.description}</p>
                            )}
                            <div className="flex items-center gap-3 mt-2">
                              <Badge className={statusConfig.color} variant="secondary">{getStatusLabel(project.status)}</Badge>
                              <span className="text-xs text-muted-foreground">{project.done}/{project.total} detyra</span>
                              {project.budget != null && project.budget > 0 && (
                                <span className="text-xs text-muted-foreground">Buxheti: {project.budget.toLocaleString()} ALL</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="w-32 hidden sm:block">
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="text-muted-foreground">Progresi</span>
                              <span className="font-medium">{project.pct}%</span>
                            </div>
                            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${project.pct}%` }} />
                            </div>
                          </div>
                          <ArrowRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default PortalProjectsView;
