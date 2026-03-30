import React, { useState } from 'react';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useAuth } from '../../contexts/AuthContext';
import { useCollection, useMutation } from '../../hooks/useFirestore';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Clock, CheckCircle2, XCircle, AlertTriangle, Eye, Palette, Megaphone, MessageSquare, Lightbulb, ArrowRight, FileText, ChevronRight, Circle, Trash2, Cloud, X as XIcon, ExternalLink } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { useGoogleApi } from '../../contexts/GoogleApiContext';
import type { DriveFile } from '../../contexts/GoogleApiContext';
import GoogleDrivePicker from '../../components/GoogleDrivePicker';
import type { ClientRequest, Team, Service, TeamMember } from '../../types';

const CATEGORIES = [
  { value: 'Design', label: 'Dizajn' },
  { value: 'Development', label: 'Zhvillim' },
  { value: 'Support', label: 'Suport Teknik' },
  { value: 'Marketing', label: 'Marketing' },
  { value: 'Consulting', label: 'Konsulencë' },
  { value: 'Other', label: 'Tjetër' },
] as const;

const PRIORITIES = [
  { value: 'low', label: 'E Ulët', color: 'bg-gray-100 text-gray-800' },
  { value: 'medium', label: 'Mesatare', color: 'bg-blue-100 text-blue-800' },
  { value: 'high', label: 'E Lartë', color: 'bg-orange-100 text-orange-800' },
  { value: 'urgent', label: 'Urgjente', color: 'bg-red-100 text-red-800' },
] as const;

const PortalRequestsView: React.FC = () => {
  const { user } = useAuth();
  const { customerId } = useClientPortal();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ClientRequest | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('__all__');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  const { data: rawRequests, loading } = useCollection<ClientRequest>('clientRequests', {
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });

  const requests = React.useMemo(() => {
    if (!rawRequests) return [];
    return [...rawRequests].sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toMillis?.() ?? 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toMillis?.() ?? 0;
      return tb - ta;
    });
  }, [rawRequests]);

  const { data: teams } = useCollection<Team>('teams');
  const { data: services } = useCollection<Service>('services', { skipTeamFilter: true });
  const { data: allTeamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
  });

  const requestMutation = useMutation<ClientRequest>('clientRequests');

  const [requestToDelete, setRequestToDelete] = useState<string | null>(null);
  const [isDrivePickerOpen, setIsDrivePickerOpen] = useState(false);
  const [driveAttachments, setDriveAttachments] = useState<DriveFile[]>([]);
  const { isConnected: isDriveConnected, connectGoogle, isLoading: driveApiLoading } = useGoogleApi();

  const handleDeleteRequest = async (id: string) => {
    await requestMutation.remove(id);
    setSelectedRequest(null);
    toast({ title: 'Kërkesa u fshi me sukses!' });
    setRequestToDelete(null);
  };
  const notificationMutation = useMutation<any>('notifications');

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'New': return 'bg-blue-100 text-blue-800';
      case 'In Review': return 'bg-purple-100 text-purple-800';
      case 'In Progress': return 'bg-yellow-100 text-yellow-800';
      case 'Completed': return 'bg-green-100 text-green-800';
      case 'Rejected': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'New': return 'E Re';
      case 'In Review': return 'Në Shqyrtim';
      case 'In Progress': return 'Në Progres';
      case 'Completed': return 'Përfunduar';
      case 'Rejected': return 'Refuzuar';
      default: return status;
    }
  };

  const getPriorityInfo = (priority: string) => {
    return PRIORITIES.find(p => p.value === priority) || PRIORITIES[1];
  };

  const getCategoryLabel = (category: string) => {
    return CATEGORIES.find(c => c.value === category)?.label || category;
  };

  // Smart routing: map category to team by department
  const getTeamForCategory = (category: string): string | undefined => {
    if (!teams) return undefined;
    const deptMap: Record<string, string[]> = {
      'Design': ['design', 'dizajn', 'kreativ', 'creative'],
      'Development': ['development', 'zhvillim', 'dev', 'it', 'tech', 'teknologji'],
      'Support': ['support', 'suport', 'helpdesk', 'help desk'],
      'Marketing': ['marketing'],
      'Consulting': ['consulting', 'konsulencë', 'management', 'menaxhim'],
    };

    const keywords = deptMap[category] || [];
    const match = teams.find(team => {
      const dept = (team.department || '').toLowerCase();
      const name = (team.name || '').toLowerCase();
      return keywords.some(k => dept.includes(k) || name.includes(k));
    });
    return match?.id;
  };

  const handleCreateRequest = async (formData: FormData) => {
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const category = (formData.get('category') as string) || (formData.get('category2') as string);
    const priority = (formData.get('priority') as string) || (formData.get('priority2') as string);
    const serviceId = formData.get('serviceId') as string;

    if (!title || !description || !category || !priority || !user || !customerId) return;

    const assignedTeamId = getTeamForCategory(category);

    const mappedAttachments = driveAttachments.map(f => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      webViewLink: f.webViewLink || '',
    }));

    await requestMutation.create({
      customerId,
      clientUserId: user.uid,
      title,
      description,
      category: category as ClientRequest['category'],
      status: 'New',
      priority: priority as ClientRequest['priority'],
      serviceId: serviceId || undefined,
      assignedTeamId,
      driveAttachments: mappedAttachments.length > 0 ? mappedAttachments : undefined,
    });  

    // Notify admin team members about new request
    const adminMembers = allTeamMembers?.filter(
      (m) => m.role === 'Admin'
    ) || [];
    // Also notify members of the assigned team
    const assignedMembers = assignedTeamId
      ? allTeamMembers?.filter(m => m.teamId === assignedTeamId) || []
      : [];
    const notifyIds = new Set([...adminMembers.map(m => m.userId), ...assignedMembers.map(m => m.userId)]);

    for (const uid of notifyIds) {
      notificationMutation.create({
        userId: uid,
        type: 'client_request',
        title: 'Kërkesë e re nga klienti',
        message: `${title} — ${getCategoryLabel(category)}`,
        isRead: false,
        actionType: 'navigate',
        actionUrl: '/app/customers',
        actionLabel: 'Shiko Kërkesën',
      }).catch(() => { /* non-critical */ });
    }

    setIsCreateOpen(false);
    setSelectedTemplate(null);
    setDriveAttachments([]);
    toast({
      title: 'Kërkesa u dërgua',
      description: 'Ekipi ynë do ta shqyrtojë kërkesën tuaj së shpejti.',
    });
  };

  // Quick request templates
  const REQUEST_TEMPLATES = [
    { id: 'design', icon: Palette, label: 'Ndryshim dizajni', category: 'Design', priority: 'medium', color: 'bg-purple-50 text-purple-600 border-purple-200', desc: 'Ndryshime vizuale, logo, grafika' },
    { id: 'bug', icon: AlertTriangle, label: 'Problem teknik', category: 'Support', priority: 'high', color: 'bg-red-50 text-red-600 border-red-200', desc: 'Diçka nuk punon si duhet' },
    { id: 'feature', icon: Lightbulb, label: 'Funksion i ri', category: 'Development', priority: 'medium', color: 'bg-amber-50 text-amber-600 border-amber-200', desc: 'Shtoni diçka të re' },
    { id: 'question', icon: MessageSquare, label: 'Kam një pyetje', category: 'Consulting', priority: 'low', color: 'bg-blue-50 text-blue-600 border-blue-200', desc: 'Pyetje rreth projektit' },
    { id: 'content', icon: Megaphone, label: 'Marketing', category: 'Marketing', priority: 'medium', color: 'bg-green-50 text-green-600 border-green-200', desc: 'Promovim, rrjetet sociale' },
    { id: 'other', icon: FileText, label: 'Tjetër', category: 'Other', priority: 'medium', color: 'bg-gray-50 text-gray-600 border-gray-200', desc: 'Një kërkesë e përgjithshme' },
  ];

  const filteredRequests = React.useMemo(() => {
    if (!requests) return [];
    if (statusFilter === '__all__') return requests;
    return requests.filter(r => r.status === statusFilter);
  }, [requests, statusFilter]);

  const stats = React.useMemo(() => {
    if (!requests) return { total: 0, active: 0, completed: 0 };
    return {
      total: requests.length,
      active: requests.filter(r => r.status !== 'Completed' && r.status !== 'Rejected').length,
      completed: requests.filter(r => r.status === 'Completed').length,
    };
  }, [requests]);

  const openTemplateForm = (templateId: string) => {
    setSelectedTemplate(templateId);
    setIsCreateOpen(true);
  };

  const formatDate = (date: any) => {
    if (!date) return '';
    const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // Status timeline steps
  const STATUS_STEPS = [
    { key: 'New', label: 'Dërguar', icon: Circle },
    { key: 'In Review', label: 'Në Shqyrtim', icon: Eye },
    { key: 'In Progress', label: 'Në Punë', icon: AlertTriangle },
    { key: 'Completed', label: 'Përfunduar', icon: CheckCircle2 },
  ];

  const getStepIndex = (status: string) => {
    if (status === 'Rejected') return -1;
    return STATUS_STEPS.findIndex(s => s.key === status);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">Duke ngarkuar kërkesat...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Si mund t'ju ndihmojmë?</h1>
        <p className="text-muted-foreground mt-1">Zgjidhni çfarë ju nevojitet ose dërgoni një kërkesë të lirë</p>
      </div>

      {/* Quick Template Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {REQUEST_TEMPLATES.map((tpl) => {
          const Icon = tpl.icon;
          return (
            <button
              key={tpl.id}
              onClick={() => openTemplateForm(tpl.id)}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border ${tpl.color} hover:shadow-md hover:scale-[1.02] transition-all text-center group`}
            >
              <div className="w-10 h-10 rounded-full bg-white/80 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Icon className="h-5 w-5" />
              </div>
              <span className="font-medium text-sm">{tpl.label}</span>
              <span className="text-[11px] opacity-70 leading-tight">{tpl.desc}</span>
            </button>
          );
        })}
      </div>

      {/* Active Requests Summary */}
      {requests && requests.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-semibold">Kërkesat tuaja</h2>
              <div className="flex items-center gap-2 text-sm">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
                  {stats.active} aktive
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
                  {stats.completed} përfunduara
                </span>
              </div>
            </div>
          </div>

          {/* Status Filter Pills */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {[
              { key: '__all__', label: 'Të gjitha' },
              { key: 'New', label: 'Të reja' },
              { key: 'In Review', label: 'Në shqyrtim' },
              { key: 'In Progress', label: 'Në punë' },
              { key: 'Completed', label: 'Përfunduara' },
              { key: 'Rejected', label: 'Refuzuara' },
            ].map(s => (
              <button
                key={s.key}
                onClick={() => setStatusFilter(s.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  statusFilter === s.key
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Request Cards */}
          {filteredRequests.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground text-sm">Nuk ka kërkesa me këtë status.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRequests.map(request => {
                const priorityInfo = getPriorityInfo(request.priority);
                const stepIdx = getStepIndex(request.status);
                const isRejected = request.status === 'Rejected';

                return (
                  <Card
                    key={request.id}
                    className="hover:shadow-md transition-all cursor-pointer group border-border/60 hover:border-primary/30"
                    onClick={() => setSelectedRequest(request)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        {/* Status indicator */}
                        <div className={`mt-0.5 flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
                          isRejected ? 'bg-red-100' :
                          request.status === 'Completed' ? 'bg-emerald-100' :
                          request.status === 'In Progress' ? 'bg-amber-100' :
                          request.status === 'In Review' ? 'bg-purple-100' :
                          'bg-blue-100'
                        }`}>
                          {isRejected ? <XCircle className="h-4 w-4 text-red-600" /> :
                           request.status === 'Completed' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> :
                           request.status === 'In Progress' ? <AlertTriangle className="h-4 w-4 text-amber-600" /> :
                           request.status === 'In Review' ? <Eye className="h-4 w-4 text-purple-600" /> :
                           <Clock className="h-4 w-4 text-blue-600" />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-sm truncate group-hover:text-primary transition-colors">{request.title}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {getCategoryLabel(request.category)} · {formatDate(request.createdAt)}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <Badge className={`${priorityInfo.color} text-[10px] px-1.5 py-0`} variant="secondary">
                                {priorityInfo.label}
                              </Badge>
                              <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                            </div>
                          </div>

                          {/* Mini Progress Steps */}
                          {!isRejected && (
                            <div className="flex items-center gap-1 mt-2.5">
                              {STATUS_STEPS.map((step, i) => (
                                <React.Fragment key={step.key}>
                                  <div className={`h-1.5 flex-1 rounded-full transition-all ${
                                    i <= stepIdx ? 'bg-primary' : 'bg-muted'
                                  }`} />
                                </React.Fragment>
                              ))}
                            </div>
                          )}
                          {isRejected && (
                            <p className="text-xs text-red-500 mt-1.5">Kjo kërkesë u refuzua</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Empty State - When no requests at all */}
      {(!requests || requests.length === 0) && (
        <div className="text-center py-8">
          <p className="text-muted-foreground text-sm">Ende nuk keni dërguar kërkesa. Zgjidhni një opsion më sipër për të filluar.</p>
        </div>
      )}

      {/* Create Request Dialog - Simplified */}
      <GoogleDrivePicker
        open={isDrivePickerOpen}
        onOpenChange={setIsDrivePickerOpen}
        multiple
        onSelect={(file) => setDriveAttachments(prev => prev.find(f => f.id === file.id) ? prev : [...prev, file])}
        onSelectMultiple={(files) => setDriveAttachments(prev => {
          const existingIds = new Set(prev.map(f => f.id));
          return [...prev, ...files.filter(f => !existingIds.has(f.id))];
        })}
      />

      <Dialog open={isCreateOpen} onOpenChange={(open) => { setIsCreateOpen(open); if (!open) { setSelectedTemplate(null); setDriveAttachments([]); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedTemplate 
                ? REQUEST_TEMPLATES.find(t => t.id === selectedTemplate)?.label || 'Kërkesë e Re'
                : 'Kërkesë e Re'}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateRequest(new FormData(e.currentTarget));
            }}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="title">Çfarë ju nevojitet?</Label>
              <Input id="title" name="title" required placeholder="P.sh. Ndryshoni ngjyrën e logos" className="mt-1" />
            </div>
            
            {/* Hidden category/priority from template */}
            <input type="hidden" name="category" value={selectedTemplate ? REQUEST_TEMPLATES.find(t => t.id === selectedTemplate)?.category || 'Other' : ''} />
            <input type="hidden" name="priority" value={selectedTemplate ? REQUEST_TEMPLATES.find(t => t.id === selectedTemplate)?.priority || 'medium' : ''} />
            
            {/* Show category/priority selectors only if no template */}
            {!selectedTemplate && (
              <>
                <div>
                  <Label>Kategoria</Label>
                  <Select name="category2" required>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Zgjidhni kategorinë" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(cat => (
                        <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Prioriteti</Label>
                  <Select name="priority2" required>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Zgjidhni prioritetin" />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map(p => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            
            {services && services.length > 0 && (
              <div>
                <Label>Shërbimi (opsionale)</Label>
                <Select name="serviceId">
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Lidheni me një shërbim" />
                  </SelectTrigger>
                  <SelectContent>
                    {services.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.title || s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label htmlFor="description">Na tregoni më shumë detaje</Label>
              <Textarea
                id="description"
                name="description"
                required
                rows={4}
                placeholder="Përshkruani sa më shumë detaje që të mund..."
                className="mt-1"
              />
            </div>
            <div>
              <Label>Skedarë nga Google Drive (opsionale)</Label>
              <div className="mt-1 space-y-2">
                {driveAttachments.length > 0 && (
                  <div className="space-y-1">
                    {driveAttachments.map(f => (
                      <div key={f.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-sm">
                        <Cloud className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                        <span className="flex-1 truncate text-blue-800">{f.name}</span>
                        <button
                          type="button"
                          onClick={() => setDriveAttachments(prev => prev.filter(x => x.id !== f.id))}
                          className="text-blue-400 hover:text-red-500 transition-colors"
                        >
                          <XIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {isDriveConnected ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2 text-blue-600 border-blue-200 hover:bg-blue-50"
                    onClick={() => setIsDrivePickerOpen(true)}
                  >
                    <Cloud className="h-4 w-4" />
                    Zgjidhni skedarë nga Drive
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2 text-blue-600 border-blue-200 hover:bg-blue-50"
                    onClick={connectGoogle}
                    disabled={driveApiLoading}
                  >
                    <Cloud className="h-4 w-4" />
                    {driveApiLoading ? 'Duke u lidhur...' : 'Lidhu me Google Drive'}
                  </Button>
                )}
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => { setIsCreateOpen(false); setSelectedTemplate(null); }}>
                Anulo
              </Button>
              <Button type="submit" className="flex-1 gap-2">
                <ArrowRight className="h-4 w-4" />
                Dërgo
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Request Detail Dialog - Enhanced with Timeline */}
      <Dialog open={!!selectedRequest} onOpenChange={(open) => !open && setSelectedRequest(null)}>
        <DialogContent className="max-w-lg">
          {selectedRequest && (
            <div className="space-y-5">
              {/* Title + badges */}
              <div>
                <h2 className="text-lg font-bold pr-6">{selectedRequest.title}</h2>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <Badge className={getStatusColor(selectedRequest.status)} variant="secondary">
                    {getStatusLabel(selectedRequest.status)}
                  </Badge>
                  <Badge className={getPriorityInfo(selectedRequest.priority).color} variant="secondary">
                    {getPriorityInfo(selectedRequest.priority).label}
                  </Badge>
                  <Badge variant="outline" className="text-[11px]">
                    {getCategoryLabel(selectedRequest.category)}
                  </Badge>
                </div>
              </div>

              {/* Visual Status Timeline */}
              {selectedRequest.status !== 'Rejected' && (
                <div className="bg-muted/50 rounded-xl p-4">
                  <p className="text-xs font-medium text-muted-foreground mb-3">Progresi i kërkesës</p>
                  <div className="flex items-center justify-between">
                    {STATUS_STEPS.map((step, i) => {
                      const stepIdx = getStepIndex(selectedRequest.status);
                      const isCompleted = i <= stepIdx;
                      const isCurrent = i === stepIdx;
                      const Icon = step.icon;
                      return (
                        <React.Fragment key={step.key}>
                          {i > 0 && (
                            <div className={`flex-1 h-0.5 mx-1 rounded ${isCompleted ? 'bg-primary' : 'bg-muted-foreground/20'}`} />
                          )}
                          <div className="flex flex-col items-center gap-1">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                              isCurrent ? 'bg-primary text-primary-foreground ring-4 ring-primary/20' :
                              isCompleted ? 'bg-primary text-primary-foreground' :
                              'bg-muted text-muted-foreground'
                            }`}>
                              {isCompleted && i < stepIdx ? (
                                <CheckCircle2 className="h-4 w-4" />
                              ) : (
                                <Icon className="h-3.5 w-3.5" />
                              )}
                            </div>
                            <span className={`text-[10px] font-medium ${isCurrent ? 'text-primary' : 'text-muted-foreground'}`}>
                              {step.label}
                            </span>
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedRequest.status === 'Rejected' && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
                  <XCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
                  <p className="text-sm text-red-700 font-medium">Kjo kërkesë u refuzua</p>
                </div>
              )}

              {/* Description */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Përshkrimi</p>
                <div className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded-lg leading-relaxed">
                  {selectedRequest.description}
                </div>
              </div>

              {selectedRequest.driveAttachments && selectedRequest.driveAttachments.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Skedarë nga Google Drive</p>
                  <div className="space-y-1.5">
                    {selectedRequest.driveAttachments.map(f => (
                      <a
                        key={f.id}
                        href={f.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-2 rounded-lg transition-colors"
                      >
                        <Cloud className="h-4 w-4 flex-shrink-0" />
                        <span className="flex-1 truncate">{f.name}</span>
                        <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 opacity-60" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {!selectedRequest.driveAttachments?.length && selectedRequest.attachmentUrl && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Skedar i bashkëngjitur</p>
                  <a
                    href={selectedRequest.attachmentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-primary bg-primary/5 hover:bg-primary/10 px-3 py-2 rounded-lg transition-colors"
                  >
                    <FileText className="h-4 w-4" />
                    Hap skedarin
                  </a>
                </div>
              )}

              {/* Team Response */}
              {selectedRequest.adminNotes && (
                <div className="border-t pt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                      <MessageSquare className="h-3 w-3 text-primary-foreground" />
                    </div>
                    <p className="text-xs font-semibold text-foreground">Përgjigja e Ekipit</p>
                  </div>
                  <div className="text-sm whitespace-pre-wrap bg-primary/5 border border-primary/10 p-3 rounded-lg leading-relaxed">
                    {selectedRequest.adminNotes}
                  </div>
                </div>
              )}

              {/* Meta info */}
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground pt-2 border-t">
                <span>Dërguar: {formatDate(selectedRequest.createdAt)}</span>
                {teams?.find(t => t.id === selectedRequest.assignedTeamId) && (
                  <span>Ekipi: {teams.find(t => t.id === selectedRequest.assignedTeamId)?.name}</span>
                )}
              </div>

              {/* Delete button */}
              <div className="pt-3 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive gap-1.5 w-full"
                  onClick={() => setRequestToDelete(selectedRequest.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Fshi Kërkesën
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Request Confirmation */}
      <Dialog open={!!requestToDelete} onOpenChange={(open) => { if (!open) setRequestToDelete(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Fshi Kërkesën</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Je i sigurt që dëshiron të fshish këtë kërkesë? Ky veprim nuk mund të zhbëhet.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setRequestToDelete(null)}>Anulo</Button>
            <Button variant="destructive" onClick={() => requestToDelete && handleDeleteRequest(requestToDelete)}>Fshi</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PortalRequestsView;
