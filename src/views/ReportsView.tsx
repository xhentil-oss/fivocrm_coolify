/**
 * Reports list — the module's front door.
 *
 * Tabs mirror the four questions people actually arrive with: "what do I owe?",
 * "what am I waiting on?", "what did the client get?", "what is late?". The
 * calendar tab answers the fifth: "what is coming".
 *
 * Everything on screen is already filtered by `visibleReports()` in the hook, so a
 * Member cannot see a colleague's weekly report even by URL.
 */

import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock,
  Eye, FileText, Filter, Inbox, Plus, Search, Send, Users, X,
} from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { toast } from '../hooks/use-toast';
import { useAuth } from '../contexts/AuthContext';
import { useCollection } from '../hooks/useFirestore';
import { useUserNames } from '../hooks/useUserNames';
import { useReports } from '../hooks/useReports';
import {
  EDITABLE_STATUSES, PUBLISHED_STATUSES, REVIEW_STATUSES, SIDE_META, STATUS_LABELS,
  STATUS_TONE, sideOfKind, type ReportSide,
} from '../lib/reporting/workflow';
import { HEALTH_CLASSES, HEALTH_LABELS } from '../lib/reporting/health';
import { dueLabel, isOverdue } from '../lib/reporting/schedule';
import { formatPeriodLabel } from '../lib/reporting/period';
import DailyReportsView from './DailyReportsView';
import type { Customer, Project, Report, ReportFrequency, ReportKind, ReportStatus, TeamMember } from '../types';

const KIND_LABELS: Record<ReportKind, string> = {
  'weekly-staff': 'Javor i punonjësit',
  'project-status': 'Statusi i projektit',
  'client-monthly': 'Mujor i klientit',
  qbr: 'QBR (tremujor)',
  'project-completion': 'Përfundim projekti',
  'campaign-completion': 'Përfundim fushate',
  'website-launch': 'Lansim faqeje',
  incident: 'Incident',
  'client-risk': 'Rrezik klienti',
  custom: 'Personalizuar',
};

const TONE_CLASSES: Record<string, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  info: 'bg-primary/10 text-primary border-primary/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  success: 'bg-success/10 text-success border-success/30',
  error: 'bg-error/10 text-error border-error/30',
};

const ReportsView: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    reports, templates, loading, viewer, createFromTemplate,
  } = useReports();
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', { skipTeamFilter: true });
  const { data: customers } = useCollection<Customer>('customers');
  const { data: projects } = useCollection<Project>('projects');
  const { getName } = useUserNames(teamMembers);

  // Audience is the PRIMARY axis and lives in the URL, so "send me the client
  // reports" is a link rather than a set of instructions. `?side=` also lets the old
  // /app/daily-reports route redirect straight to the right place.
  const [searchParams, setSearchParams] = useSearchParams();
  const side: ReportSide = searchParams.get('side') === 'client' ? 'client' : 'internal';
  const internalTab = searchParams.get('tab') === 'daily' ? 'daily' : 'list';

  const setSide = (next: ReportSide) => {
    const p = new URLSearchParams(searchParams);
    p.set('side', next);
    p.delete('tab');
    setSearchParams(p, { replace: true });
  };
  const setInternalTab = (next: 'daily' | 'list') => {
    const p = new URLSearchParams(searchParams);
    p.set('side', 'internal');
    if (next === 'daily') p.set('tab', 'daily'); else p.delete('tab');
    setSearchParams(p, { replace: true });
  };

  const [tab, setTab] = useState('mine');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [customerFilter, setCustomerFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);

  const now = useMemo(() => new Date(), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reports.filter(r => {
      // Audience first: a client deliverable never appears under "Brenda agjencisë"
      // and vice versa. Same function that draws the badge, so the two can't drift.
      if (sideOfKind(r.kind) !== side) return false;
      if (q && !`${r.title} ${r.customerName || ''} ${r.projectName || ''}`.toLowerCase().includes(q)) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false;
      if (customerFilter !== 'all' && r.customerId !== customerFilter) return false;
      return true;
    });
  }, [reports, search, statusFilter, kindFilter, customerFilter, side]);

  const buckets = useMemo(() => ({
    mine: filtered.filter(r => r.authorUserId === user?.uid),
    review: filtered.filter(r =>
      REVIEW_STATUSES.has(r.status)
      && (r.reviewerUserId === user?.uid || r.approverUserId === user?.uid || viewer.isManagement)),
    client: filtered.filter(r => PUBLISHED_STATUSES.has(r.status)),
    overdue: filtered.filter(r => isOverdue(r, now)),
    all: filtered,
  }), [filtered, user?.uid, viewer.isManagement, now]);

  const stats = useMemo(() => ({
    open: reports.filter(r => EDITABLE_STATUSES.has(r.status)).length,
    awaitingMe: buckets.review.length,
    overdue: buckets.overdue.length,
    published: reports.filter(r => PUBLISHED_STATUSES.has(r.status)).length,
  }), [reports, buckets]);

  const activeFilters = [statusFilter, kindFilter, customerFilter].filter(f => f !== 'all').length;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Raportimi</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{SIDE_META[side].hint}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="w-4 h-4" /> Raport i re
        </Button>
      </div>

      {/* THE primary split. Deliberately larger and louder than the tabs below it:
          "who is this for" is the question people actually arrive with, and the old
          layout answered it nowhere. */}
      <div className="flex items-center gap-1.5 p-1 bg-muted rounded-xl w-fit">
        {(['internal', 'client'] as const).map(s2 => (
          <button
            key={s2}
            type="button"
            onClick={() => setSide(s2)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              side === s2
                ? s2 === 'client'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'}`}
          >
            {s2 === 'client' ? <Eye className="w-4 h-4" /> : <Users className="w-4 h-4" />}
            {SIDE_META[s2].label}
          </button>
        ))}
      </div>

      {/* Internal side has two shapes of thing: the daily habit, and the reviewable
          weekly/management reports. Client side has only reports. */}
      {side === 'internal' && (
        <div className="flex items-center gap-1 p-1 bg-muted/60 rounded-lg w-fit">
          {([
            { key: 'daily', label: 'Ditore' },
            { key: 'list', label: 'Javore & menaxhimi' },
          ] as const).map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setInternalTab(t.key)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                internalTab === t.key ? 'bg-card shadow-sm text-foreground font-medium' : 'text-muted-foreground'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* The daily habit lives here now — same screen, no separate nav entry. */}
      {side === 'internal' && internalTab === 'daily' ? (
        <DailyReportsView embedded />
      ) : (
      <>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={FileText} label="Në punë" value={stats.open} />
        <StatTile icon={Inbox} label="Presin mua" value={stats.awaitingMe} tone={stats.awaitingMe ? 'info' : undefined} />
        <StatTile icon={AlertTriangle} label="Të vonuara" value={stats.overdue} tone={stats.overdue ? 'error' : undefined} />
        <StatTile icon={Send} label="Publikuara" value={stats.published} tone="success" />
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Kërko raport, klient, projekt…"
            className="pl-9 text-base sm:text-sm"
          />
        </div>
        <Button
          variant={activeFilters ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowFilters(v => !v)}
          className="gap-1.5"
        >
          <Filter className="w-4 h-4" /> Filtra{activeFilters ? ` (${activeFilters})` : ''}
        </Button>
      </div>

      {showFilters && (
        <Card className="p-4 grid sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Statusi</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Të gjitha</SelectItem>
                {(Object.keys(STATUS_LABELS) as ReportStatus[]).map(s => (
                  <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tipi</Label>
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Të gjithë</SelectItem>
                {(Object.keys(KIND_LABELS) as ReportKind[]).map(k => (
                  <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Klienti</Label>
            <Select value={customerFilter} onValueChange={setCustomerFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Të gjithë</SelectItem>
                {(customers || []).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {activeFilters > 0 && (
            <Button
              variant="ghost" size="sm" className="gap-1.5 justify-self-start"
              onClick={() => { setStatusFilter('all'); setKindFilter('all'); setCustomerFilter('all'); }}
            >
              <X className="w-3.5 h-3.5" /> Pastro filtrat
            </Button>
          )}
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="mine">Të miat ({buckets.mine.length})</TabsTrigger>
          <TabsTrigger value="review">Për shqyrtim ({buckets.review.length})</TabsTrigger>
          <TabsTrigger value="client">Të klientit ({buckets.client.length})</TabsTrigger>
          <TabsTrigger value="overdue">Vonuar ({buckets.overdue.length})</TabsTrigger>
          {(viewer.capabilities.canViewAllReports || viewer.isManagement) && (
            <TabsTrigger value="all">Të gjitha ({buckets.all.length})</TabsTrigger>
          )}
          <TabsTrigger value="calendar" className="gap-1.5">
            <CalendarDays className="w-3.5 h-3.5" /> Kalendari
          </TabsTrigger>
        </TabsList>

        {(['mine', 'review', 'client', 'overdue', 'all'] as const).map(key => (
          <TabsContent key={key} value={key} className="mt-4">
            <ReportList
              reports={buckets[key]}
              loading={loading}
              now={now}
              getName={getName}
              onOpen={id => navigate(`/app/reports/${id}`)}
            />
          </TabsContent>
        ))}

        <TabsContent value="calendar" className="mt-4">
          <ReportCalendar
            reports={filtered}
            monthOffset={monthOffset}
            onShift={setMonthOffset}
            onOpen={id => navigate(`/app/reports/${id}`)}
          />
        </TabsContent>
      </Tabs>

      </>
      )}

      <CreateReportDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        templates={templates}
        customers={customers || []}
        projects={projects || []}
        members={(teamMembers || []).filter(m => m.status === 'Active')}
        onCreate={async args => {
          try {
            const created = await createFromTemplate(args);
            toast({ title: 'Raporti u krijua', description: created.title });
            setCreateOpen(false);
            navigate(`/app/reports/${created.id}`);
          } catch (err: any) {
            toast({ title: 'Nuk u krijua', description: err?.message, variant: 'destructive' });
          }
        }}
      />
    </div>
  );
};

// ── pieces ──────────────────────────────────────────────────────────────────────

const StatTile: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: 'info' | 'error' | 'success';
}> = ({ icon: Icon, label, value, tone }) => (
  <Card className="p-4">
    <div className="flex items-center gap-2.5">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
        tone === 'error' ? 'bg-error/10 text-error'
          : tone === 'success' ? 'bg-success/10 text-success'
            : tone === 'info' ? 'bg-primary/10 text-primary'
              : 'bg-muted text-muted-foreground'}`}>
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-foreground tabular-nums leading-none">{value}</p>
        <p className="text-xs text-muted-foreground truncate mt-1">{label}</p>
      </div>
    </div>
  </Card>
);

const ReportList: React.FC<{
  reports: Report[];
  loading: boolean;
  now: Date;
  getName: (id: string) => string;
  onOpen: (id: string) => void;
}> = ({ reports, loading, now, getName, onOpen }) => {
  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map(i => <Card key={i} className="p-4 h-20 animate-pulse bg-muted/40" />)}
      </div>
    );
  }
  if (!reports.length) {
    return (
      <Card className="p-10 text-center">
        <FileText className="w-8 h-8 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">Nuk ka raporte në këtë listë.</p>
      </Card>
    );
  }
  const sorted = [...reports].sort((a, b) => {
    const ad = a.dueAt?.getTime() ?? Infinity;
    const bd = b.dueAt?.getTime() ?? Infinity;
    if (ad !== bd) return ad - bd;
    return (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0);
  });

  return (
    <div className="space-y-2">
      {sorted.map(r => {
        const overdue = isOverdue(r, now);
        return (
          <Card
            key={r.id}
            className={`p-4 cursor-pointer hover:border-primary/50 transition-colors ${
              overdue ? 'border-l-4 border-l-error' : ''}`}
            onClick={() => onOpen(r.id)}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-foreground truncate">{r.title}</p>
                  <Badge variant="outline" className={`text-[10px] font-semibold ${SIDE_META[sideOfKind(r.kind)].className}`}>
                    {SIDE_META[sideOfKind(r.kind)].short}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] ${TONE_CLASSES[STATUS_TONE[r.status]]}`}>
                    {STATUS_LABELS[r.status]}
                  </Badge>
                  {r.health && (
                    <Badge variant="outline" className={`text-[10px] ${HEALTH_CLASSES[r.health]}`}>
                      {HEALTH_LABELS[r.health]}
                    </Badge>
                  )}
                  {r.hasUnpublishedChanges && (
                    <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/30">
                      ndryshime pa publikuar
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {KIND_LABELS[r.kind]} · {formatPeriodLabel(r.period)}
                  {r.customerName ? ` · ${r.customerName}` : ''}
                  {r.projectName ? ` · ${r.projectName}` : ''}
                  {` · ${getName(r.authorUserId)}`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-xs font-medium ${overdue ? 'text-error' : 'text-muted-foreground'}`}>
                  {r.dueAt ? dueLabel(r.dueAt, now) : '—'}
                </p>
                <div className="flex items-center gap-2 justify-end mt-1">
                  {typeof r.viewCount === 'number' && r.viewCount > 0 && (
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Eye className="w-3 h-3" /> {r.viewCount}
                    </span>
                  )}
                  {r.acknowledgedAt && <CheckCircle2 className="w-3.5 h-3.5 text-success" />}
                  {typeof r.qualityScore === 'number' && (
                    <span className="text-[11px] text-muted-foreground">C {r.qualityScore}</span>
                  )}
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
};

/** Month grid of due dates + publications. Drag-rescheduling is intentionally not
 *  wired here: a schedule change must be audited, so it happens in the schedule
 *  manager rather than by dragging a chip. */
const ReportCalendar: React.FC<{
  reports: Report[];
  monthOffset: number;
  onShift: (v: number) => void;
  onOpen: (id: string) => void;
}> = ({ reports, monthOffset, onShift, onOpen }) => {
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + monthOffset);
  const year = base.getFullYear();
  const month = base.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = (first.getDay() + 6) % 7; // Monday-first

  const byDay = useMemo(() => {
    const map = new Map<number, Array<{ report: Report; type: 'due' | 'published' }>>();
    for (const r of reports) {
      const push = (d: Date | undefined, type: 'due' | 'published') => {
        if (!d || d.getFullYear() !== year || d.getMonth() !== month) return;
        const day = d.getDate();
        map.set(day, [...(map.get(day) || []), { report: r, type }]);
      };
      push(r.dueAt, 'due');
      push(r.publishedAt, 'published');
    }
    return map;
  }, [reports, year, month]);

  const monthName = base.toLocaleDateString('sq-AL', { month: 'long', year: 'numeric' });

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={() => onShift(monthOffset - 1)} aria-label="Muaji i mëparshëm">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <p className="font-semibold text-foreground capitalize">{monthName}</p>
        <Button variant="ghost" size="icon" onClick={() => onShift(monthOffset + 1)} aria-label="Muaji tjetër">
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['Hën', 'Mar', 'Mër', 'Enj', 'Pre', 'Sht', 'Die'].map(d => (
              <div key={d} className="text-[11px] text-muted-foreground text-center font-medium py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: startWeekday }).map((_, i) => <div key={`pad-${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
              const items = byDay.get(day) || [];
              return (
                <div key={day} className="min-h-[72px] border border-border rounded-md p-1 space-y-1">
                  <p className="text-[11px] text-muted-foreground">{day}</p>
                  {items.slice(0, 3).map(({ report, type }) => (
                    <button
                      key={`${report.id}-${type}`}
                      type="button"
                      onClick={() => onOpen(report.id)}
                      title={report.title}
                      className={`w-full text-left text-[10px] px-1 py-0.5 rounded truncate ${
                        type === 'due'
                          ? 'bg-warning/15 text-warning'
                          : 'bg-success/15 text-success'}`}
                    >
                      {type === 'due' ? '⏰ ' : '✓ '}{report.customerName || report.title}
                    </button>
                  ))}
                  {items.length > 3 && (
                    <p className="text-[10px] text-muted-foreground px-1">+{items.length - 3}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-warning" /> Afati</span>
        <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-success" /> Publikuar</span>
      </div>
    </Card>
  );
};

const CreateReportDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  templates: Array<{ id: string; name: string; kind: ReportKind; frequency: ReportFrequency }>;
  customers: Customer[];
  projects: Project[];
  members: TeamMember[];
  onCreate: (args: any) => Promise<void>;
}> = ({ open, onClose, templates, customers, projects, members, onCreate }) => {
  const [templateId, setTemplateId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [reviewerUserId, setReviewerUserId] = useState('');
  const [periodDate, setPeriodDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const template = templates.find(t => t.id === templateId);

  const submit = async () => {
    if (!template) return;
    setBusy(true);
    try {
      const customer = customers.find(c => c.id === customerId);
      const project = projects.find(p => p.id === projectId);
      await onCreate({
        kind: template.kind,
        frequency: template.frequency,
        templateId: template.id,
        periodDate,
        customerId: customerId || undefined,
        customerName: customer?.name,
        projectId: projectId || undefined,
        projectName: project?.name,
        reviewerUserId: reviewerUserId || null,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Raport i re</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue placeholder="Zgjidh template…" /></SelectTrigger>
              <SelectContent>
                {templates.length === 0 && <SelectItem value="__none" disabled>Pa template — krijoni një në Cilësimet</SelectItem>}
                {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Data brenda periudhës</Label>
            <Input type="date" value={periodDate} onChange={e => setPeriodDate(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">
              Periudha kalkulohet automatikisht nga kadenca e template-it.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Klienti</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger><SelectValue placeholder="Pa klient" /></SelectTrigger>
                <SelectContent>
                  {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Projekti</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue placeholder="Pa projekt" /></SelectTrigger>
                <SelectContent>
                  {projects
                    .filter(p => !customerId || p.customerId === customerId)
                    .map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5"><Users className="w-3 h-3" /> Shqyrtuesi</Label>
            <Select value={reviewerUserId} onValueChange={setReviewerUserId}>
              <SelectTrigger><SelectValue placeholder="Pa shqyrtues" /></SelectTrigger>
              <SelectContent>
                {members.map(m => (
                  <SelectItem key={m.id} value={m.userId}>{m.displayName || m.email || m.userId}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Anulo</Button>
            <Button onClick={submit} disabled={!template || busy}>
              {busy ? 'Duke krijuar…' : 'Krijo raportin'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReportsView;
