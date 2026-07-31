import React, { useState, useMemo } from 'react';
import { useCollection, useMutation, getGlobalTeamId } from '../hooks/useFirestore';
import { auth } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useUserNames } from '../hooks/useUserNames';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import ExportButton from '../components/ExportButton';
import {
  FileText, CheckCircle2, Clock, AlertTriangle,
  ArrowRight, Smile, Meh, Frown, User, Plus, ChevronLeft, ChevronRight,
  Sparkles, Eye, Bot, Loader2,
} from 'lucide-react';
import { toast } from '../hooks/use-toast';
import DepartmentReportFields, { useMyServiceLine } from '../components/DepartmentReportFields';
import { normalizeServiceLine, getReportTemplate, summableFields } from '../lib/productivity/reportTemplates';
import type { DailyReport, TeamMember, Project } from '../types';

function getTodayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function getWeekDates(offset: number): { start: string; end: string; days: string[] } {
  const now = new Date();
  now.setDate(now.getDate() + offset * 7);
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));

  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return { start: days[0], end: days[6], days };
}

/** §3.1 daily status — the structured counterpart to the free-text `mood`. */
const DAILY_STATUS_META: Record<string, { label: string; cls: string }> = {
  on_track: { label: 'Në rrugë', cls: 'bg-success/10 text-success border-success/30' },
  needs_attention: { label: 'Kërkon vëmendje', cls: 'bg-warning/10 text-warning border-warning/30' },
  blocked: { label: 'Bllokuar', cls: 'bg-error/10 text-error border-error/30' },
  at_risk: { label: 'Në rrezik', cls: 'bg-error/10 text-error border-error/30' },
  completed: { label: 'Përfunduar', cls: 'bg-primary/10 text-primary border-primary/30' },
};

const WORK_LOCATION_LABELS: Record<string, string> = {
  office: 'Zyrë', remote: 'Remote', client_site: 'Tek klienti', field: 'Terren', travel: 'Udhëtim',
};

const WORKING_STATUS_LABELS: Record<string, string> = {
  working: 'Punë', partial: 'Ditë e pjesshme', leave: 'Leje', sick: 'Sëmundje', holiday: 'Festë',
};

const moodIcons: Record<string, { icon: React.ComponentType<any>; color: string; label: string }> = {
  great: { icon: Smile, color: 'text-success', label: 'Shkëlqyer' },
  good: { icon: Smile, color: 'text-primary', label: 'Mirë' },
  neutral: { icon: Meh, color: 'text-warning', label: 'Normale' },
  struggling: { icon: Frown, color: 'text-error', label: 'Vështirë' },
};

interface DailyReportsViewProps {
  /**
   * Rendered inside the reporting hub (`/app/reports` → Brenda agjencisë → Ditore)
   * rather than as a standalone page. Suppresses the page title so the hub's own
   * heading is not duplicated; everything else is identical.
   */
  embedded?: boolean;
}

const DailyReportsView: React.FC<DailyReportsViewProps> = ({ embedded = false }) => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const isManagerOrAbove = permissions.isAdmin || permissions.isOwner || permissions.isManager;
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedReport, setSelectedReport] = useState<DailyReport | null>(null);
  const [filterUserId, setFilterUserId] = useState<string>('all');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const { data: reports, loading } = useCollection<DailyReport>('dailyReports', {
    orderBy: { field: 'date', direction: 'desc' },
  });
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', { skipTeamFilter: true });
  const { data: projects } = useCollection<Project>('projects');
  // Managers resolve blockers from the detail dialog. (`CreateReportDialog` further
  // down has its OWN mutation — that one is out of scope here.)
  const reportMutation = useMutation<DailyReport>('dailyReports');
  const { getName, getInitials } = useUserNames(teamMembers);

  const activeMembers = useMemo(() => {
    if (!teamMembers || !permissions.teamId) return [];
    return teamMembers.filter(m => m.teamId === permissions.teamId && m.status === 'Active');
  }, [teamMembers, permissions.teamId]);

  const week = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  // Filter reports by selected week and user
  const weekReports = useMemo(() => {
    if (!reports) return [];
    return reports.filter(r => {
      if (r.date < week.start || r.date > week.end) return false;
      if (!isManagerOrAbove && r.userId !== user?.uid) return false;
      if (filterUserId !== 'all' && r.userId !== filterUserId) return false;
      return true;
    });
  }, [reports, week, filterUserId, isManagerOrAbove, user]);

  // Today's report for current user
  const today = getTodayString();
  const myTodayReport = useMemo(() => {
    return reports?.find(r => r.userId === user?.uid && r.date === today);
  }, [reports, user, today]);

  // Stats
  const totalHours = weekReports.reduce((s, r) => s + (r.hoursWorked || 0), 0);
  const avgMood = useMemo(() => {
    const moodValues = { great: 4, good: 3, neutral: 2, struggling: 1 };
    const moods = weekReports.filter(r => r.mood).map(r => moodValues[r.mood!] || 0);
    if (moods.length === 0) return null;
    const avg = moods.reduce((a, b) => a + b, 0) / moods.length;
    if (avg >= 3.5) return 'great';
    if (avg >= 2.5) return 'good';
    if (avg >= 1.5) return 'neutral';
    return 'struggling';
  }, [weekReports]);
  const blockerCount = weekReports.filter(r => r.blockers?.trim()).length;

  // Members who haven't reported today
  const missingToday = useMemo(() => {
    if (!isManagerOrAbove) return [];
    const reportedUids = new Set(reports?.filter(r => r.date === today).map(r => r.userId) || []);
    return activeMembers.filter(m => !reportedUids.has(m.userId));
  }, [isManagerOrAbove, activeMembers, reports, today]);

  // Group reports by date for timeline
  const reportsByDate = useMemo(() => {
    const map = new Map<string, DailyReport[]>();
    for (const day of [...week.days].reverse()) {
      map.set(day, weekReports.filter(r => r.date === day));
    }
    return map;
  }, [weekReports, week.days]);

  // Weekly "what we achieved" — sum summable department metrics per serviceLine.
  const weeklyDeptTotals = useMemo(() => {
    const byLine = new Map<string, { template: ReturnType<typeof getReportTemplate>; totals: Map<string, number>; reports: number }>();
    for (const r of weekReports) {
      const key = normalizeServiceLine(r.serviceLine);
      const tmpl = getReportTemplate(key);
      if (!key || !tmpl || !r.customFields) continue;
      let entry = byLine.get(key);
      if (!entry) { entry = { template: tmpl, totals: new Map(), reports: 0 }; byLine.set(key, entry); }
      entry.reports++;
      for (const f of summableFields(tmpl)) {
        const v = Number(r.customFields[f.key]);
        if (!isNaN(v) && v) entry.totals.set(f.key, (entry.totals.get(f.key) || 0) + v);
      }
    }
    return Array.from(byLine.values()).filter((e) => e.totals.size > 0);
  }, [weekReports]);

  const handleAiSummary = async () => {
    const todayReports = weekReports.filter(r => r.date === today);
    if (todayReports.length === 0) {
      toast({ title: 'Asnjë raport sot për të analizuar', variant: 'destructive' });
      return;
    }

    setAiLoading(true);
    setAiSummary(null);
    try {
      const reportText = todayReports.map(r => {
        const name = getName(r.userId);
        return [
          `[${name}]`,
          `Përfundoi: ${r.completedToday}`,
          r.openItems?.trim() ? `Hapur: ${r.openItems}` : null,
          r.blockers?.trim() ? `Pengesa: ${r.blockers}` : null,
          r.planTomorrow?.trim() ? `Nesër: ${r.planTomorrow}` : null,
          `Orë: ${r.hoursWorked || 8}, Humor: ${r.mood || 'good'}`,
        ].filter(Boolean).join('\n');
      }).join('\n\n');

      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `Analizoji raportet ditore të ekipit dhe jepe një përmbledhje të shkurtër (3-5 pika) në shqip. Identifiko produktivitetin, problemet dhe pengesat kryesore.\n\nRaportet:\n${reportText}`,
          }],
          teamId: getGlobalTeamId(),
        }),
      });

      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      setAiSummary(data.reply || data.message || 'Nuk mund të gjeneroj analizë.');
    } catch {
      toast({ title: 'Gabim AI', description: 'Nuk mund të lidhem me AI-n.', variant: 'destructive' });
    } finally {
      setAiLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 skeleton rounded" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-24 skeleton rounded-lg" />)}
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-32 skeleton rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header — omitted when embedded, so the hub heading is not duplicated. */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {embedded ? <div /> : (
          <div>
            <h1 className="text-lg sm:text-h2 text-foreground flex items-center gap-2">
              <FileText className="w-5 h-5 sm:w-6 sm:h-6" />
              Raportet Ditore
            </h1>
            <p className="text-xs sm:text-body text-muted-foreground mt-0.5">
              {isManagerOrAbove ? 'Pamje e raporteve të ekipit' : 'Raportet e mia ditore'}
            </p>
          </div>
        )}
        <div className="flex gap-2">
          {isManagerOrAbove && (
            <Button size="sm" variant="outline" onClick={handleAiSummary} disabled={aiLoading}>
              {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4 sm:mr-2" />}
              <span className="hidden sm:inline">{aiLoading ? 'Duke analizuar...' : 'Analizë AI'}</span>
            </Button>
          )}
          <ExportButton
            data={weekReports.map(r => ({
              ...r,
              userName: getName(r.userId),
              date: formatDate(r.date),
            }))}
            filename="daily-reports"
            columns={['userName', 'date', 'completedToday', 'openItems', 'blockers', 'planTomorrow', 'hoursWorked', 'mood']}
          />
          {!myTodayReport && (
            <Button size="sm" onClick={() => setShowCreateDialog(true)}>
              <Plus className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Plotëso Raportin</span>
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3 sm:p-4">
          <p className="text-[10px] sm:text-xs text-muted-foreground">Raporte këtë javë</p>
          <p className="text-lg sm:text-2xl font-bold mt-1">{weekReports.length}</p>
        </Card>
        <Card className="p-3 sm:p-4">
          <p className="text-[10px] sm:text-xs text-muted-foreground">Orë totale</p>
          <p className="text-lg sm:text-2xl font-bold mt-1">{totalHours.toFixed(1)}</p>
        </Card>
        <Card className="p-3 sm:p-4">
          <p className="text-[10px] sm:text-xs text-muted-foreground">Pengesa</p>
          <p className="text-lg sm:text-2xl font-bold mt-1 text-error">{blockerCount}</p>
        </Card>
        <Card className="p-3 sm:p-4">
          <p className="text-[10px] sm:text-xs text-muted-foreground">Humor mesatar</p>
          <div className="flex items-center gap-2 mt-1">
            {avgMood && (() => {
              const m = moodIcons[avgMood];
              const Icon = m.icon;
              return <>
                <Icon className={`w-5 h-5 ${m.color}`} />
                <span className="text-sm font-medium">{m.label}</span>
              </>;
            })()}
            {!avgMood && <span className="text-sm text-muted-foreground">—</span>}
          </div>
        </Card>
      </div>

      {/* Weekly "what we achieved" — department metric totals */}
      {weeklyDeptTotals.length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Arritjet e javës sipas departamentit
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {weeklyDeptTotals.map((e) => (
              <div key={e.template!.key} className="rounded-lg border bg-muted/20 p-3">
                <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <span>{e.template!.emoji}</span> {e.template!.label}
                  <span className="text-[11px] text-muted-foreground font-normal ml-auto">{e.reports} raporte</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {e.template!.fields.filter((f) => e.totals.has(f.key)).map((f) => (
                    <span key={f.key} className="text-xs px-2 py-1 rounded-md bg-primary/10 text-foreground">
                      <span className="font-semibold tabular-nums">{Math.round((e.totals.get(f.key) || 0) * 100) / 100}{f.unit ? ` ${f.unit}` : ''}</span>
                      <span className="text-muted-foreground"> {f.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* AI Summary (manager only) */}
      {isManagerOrAbove && aiSummary && (
        <Card className="p-4 border-primary/20 bg-primary/5">
          <div className="flex items-start gap-3">
            <Bot className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium mb-2">Analizë AI — Raportet e Sot</p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{aiSummary}</p>
            </div>
            <Button size="sm" variant="ghost" className="flex-shrink-0 text-xs" onClick={() => setAiSummary(null)}>✕</Button>
          </div>
        </Card>
      )}

      {/* Missing reports banner (manager only) */}
      {isManagerOrAbove && missingToday.length > 0 && (
        <Card className="p-3 border-warning/30 bg-warning/5">
          <p className="text-sm font-medium text-warning flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {missingToday.length} anëtar nuk kanë raportuar sot:
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {missingToday.map(m => (
              <Badge key={m.id} variant="outline" className="text-xs">
                {getName(m.userId)}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {/* Week Navigation + Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setWeekOffset(w => w - 1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium min-w-[160px] text-center">
            {formatDate(week.start)} — {formatDate(week.end)}
          </span>
          <Button variant="outline" size="icon" onClick={() => setWeekOffset(w => w + 1)} disabled={weekOffset >= 0}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          {weekOffset !== 0 && (
            <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>
              Sot
            </Button>
          )}
        </div>

        {isManagerOrAbove && (
          <Select value={filterUserId} onValueChange={setFilterUserId}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Të gjithë" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Të gjithë anëtarët</SelectItem>
              {activeMembers.map(m => (
                <SelectItem key={m.id} value={m.userId}>
                  {getName(m.userId)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Reports Timeline */}
      <div className="space-y-4">
        {Array.from(reportsByDate.entries()).map(([date, dayReports]) => {
          const dayNames = ['E Dielë', 'E Hënë', 'E Martë', 'E Mërkurë', 'E Enjte', 'E Premte', 'E Shtunë'];
          const d = new Date(date + 'T12:00:00');
          const dayName = dayNames[d.getDay()];
          const isToday = date === today;

          return (
            <div key={date}>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  {dayName}, {formatDate(date)}
                </h3>
                {isToday && <Badge className="text-[10px]">Sot</Badge>}
                <span className="text-xs text-muted-foreground">({dayReports.length} raporte)</span>
              </div>

              {dayReports.length === 0 ? (
                <Card className="p-4 text-center text-sm text-muted-foreground">
                  Asnjë raport për këtë ditë
                </Card>
              ) : (
                <div className="space-y-2">
                  {dayReports.map(report => {
                    const moodInfo = report.mood ? moodIcons[report.mood] : null;
                    const MoodIcon = moodInfo?.icon || Meh;

                    return (
                      <Card
                        key={report.id}
                        className="p-3 sm:p-4 cursor-pointer hover:border-primary/30 transition-colors"
                        onClick={() => setSelectedReport(report)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                              {getInitials(report.userId)}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{getName(report.userId)}</p>
                              <p className="text-xs text-muted-foreground line-clamp-1">
                                {report.completedToday}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {moodInfo && <MoodIcon className={`w-4 h-4 ${moodInfo.color}`} />}
                            {report.hoursWorked && (
                              <Badge variant="outline" className="text-[10px]">{report.hoursWorked}h</Badge>
                            )}
                            {report.blockers?.trim() && (
                              <AlertTriangle className="w-4 h-4 text-error" />
                            )}
                            <Eye className="w-4 h-4 text-muted-foreground" />
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Report Detail Dialog */}
      {selectedReport && (
        <Dialog open={!!selectedReport} onOpenChange={() => setSelectedReport(null)}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                  {getInitials(selectedReport.userId)}
                </div>
                {getName(selectedReport.userId)} — {formatDate(selectedReport.date)}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              <div>
                <Label className="flex items-center gap-2 mb-1 text-success">
                  <CheckCircle2 className="w-4 h-4" /> Çfarë përfundova sot
                </Label>
                <p className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded-lg">
                  {selectedReport.completedToday || '—'}
                </p>
              </div>

              {selectedReport.customFields && Object.keys(selectedReport.customFields).length > 0 && (() => {
                const tmpl = getReportTemplate(selectedReport.serviceLine);
                const fields = tmpl?.fields || [];
                const entries = Object.entries(selectedReport.customFields).filter(([, v]) => v !== '' && v != null);
                if (entries.length === 0) return null;
                return (
                  <div>
                    <Label className="flex items-center gap-2 mb-1 text-primary">
                      <FileText className="w-4 h-4" /> Raporti i departamentit{tmpl ? ` — ${tmpl.emoji} ${tmpl.label}` : ''}
                    </Label>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 bg-primary/5 border border-primary/20 p-3 rounded-lg">
                      {entries.map(([k, v]) => {
                        const f = fields.find((x) => x.key === k);
                        return (
                          <div key={k} className={f?.type === 'textarea' ? 'col-span-2' : ''}>
                            <span className="text-muted-foreground text-xs block">{f?.label || k}</span>
                            <span className="font-medium text-sm whitespace-pre-wrap">{String(v)}{f?.unit ? ` ${f.unit}` : ''}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {selectedReport.openItems?.trim() && (
                <div>
                  <Label className="flex items-center gap-2 mb-1 text-warning">
                    <Clock className="w-4 h-4" /> Çfarë mbeti hapur
                  </Label>
                  <p className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded-lg">
                    {selectedReport.openItems}
                  </p>
                </div>
              )}

              {selectedReport.blockers?.trim() && (
                <div>
                  <Label className="flex items-center gap-2 mb-1 text-error">
                    <AlertTriangle className="w-4 h-4" /> Pengesa
                  </Label>
                  <p className="text-sm whitespace-pre-wrap bg-error/5 border border-error/20 p-3 rounded-lg">
                    {selectedReport.blockers}
                  </p>
                </div>
              )}

              {/* Blocker lifecycle: marking a blocker resolved is what makes "average
                  blocker resolution time" measurable. Without it every blocker reads as
                  permanently unresolved and the accountability panel over-flags people. */}
              {selectedReport.blockers?.trim() && isManagerOrAbove && (
                <div className="flex items-center justify-between gap-2 -mt-2">
                  {selectedReport.blockerResolvedAt ? (
                    <span className="text-xs text-success flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Pengesa u zgjidh
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Pengesa është e hapur</span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const resolved = !!selectedReport.blockerResolvedAt;
                      try {
                        await reportMutation.update(selectedReport.id, {
                          blockerResolvedAt: resolved ? null : new Date(),
                        } as any);
                        setSelectedReport({
                          ...selectedReport,
                          blockerResolvedAt: resolved ? undefined : new Date(),
                        });
                        toast({ title: resolved ? 'Pengesa u rihap' : 'Pengesa u shënua e zgjidhur' });
                      } catch (err: any) {
                        toast({ title: 'Nuk u ruajt', description: err?.message, variant: 'destructive' });
                      }
                    }}
                  >
                    {selectedReport.blockerResolvedAt ? 'Rihap' : 'Shëno të zgjidhur'}
                  </Button>
                </div>
              )}

              {(selectedReport.risks?.trim() || selectedReport.helpNeeded?.trim()
                || selectedReport.clientDependencies?.trim() || selectedReport.internalDependencies?.trim()) && (
                <div className="space-y-3">
                  {selectedReport.risks?.trim() && (
                    <div>
                      <Label className="flex items-center gap-2 mb-1 text-warning">
                        <AlertTriangle className="w-4 h-4" /> Në rrezik
                      </Label>
                      <p className="text-sm whitespace-pre-wrap bg-warning/5 border border-warning/20 p-3 rounded-lg">
                        {selectedReport.risks}
                      </p>
                    </div>
                  )}
                  {selectedReport.helpNeeded?.trim() && (
                    <div>
                      <Label className="mb-1 text-primary">Kërkon ndihmë / aprovim</Label>
                      <p className="text-sm whitespace-pre-wrap bg-primary/5 border border-primary/20 p-3 rounded-lg">
                        {selectedReport.helpNeeded}
                      </p>
                    </div>
                  )}
                  {(selectedReport.clientDependencies?.trim() || selectedReport.internalDependencies?.trim()) && (
                    <div className="grid sm:grid-cols-2 gap-2">
                      {selectedReport.clientDependencies?.trim() && (
                        <div className="bg-muted/50 p-2.5 rounded-lg">
                          <span className="text-xs text-muted-foreground block">Pret nga klienti</span>
                          <span className="text-sm">{selectedReport.clientDependencies}</span>
                        </div>
                      )}
                      {selectedReport.internalDependencies?.trim() && (
                        <div className="bg-muted/50 p-2.5 rounded-lg">
                          <span className="text-xs text-muted-foreground block">Pret nga ekipi</span>
                          <span className="text-sm">{selectedReport.internalDependencies}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Management-only note — honours the visibility promised in the form. */}
              {selectedReport.notes?.trim() && isManagerOrAbove && (
                <div>
                  <Label className="mb-1 flex items-center gap-1.5">
                    Për menaxhimin
                    <Badge variant="outline" className="text-[10px]">vetëm menaxhimi</Badge>
                  </Label>
                  <p className="text-sm whitespace-pre-wrap bg-muted p-3 rounded-lg">
                    {selectedReport.notes}
                  </p>
                </div>
              )}

              {selectedReport.planTomorrow?.trim() && (
                <div>
                  <Label className="flex items-center gap-2 mb-1 text-primary">
                    <ArrowRight className="w-4 h-4" /> Plani për nesër
                  </Label>
                  <p className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded-lg">
                    {selectedReport.planTomorrow}
                  </p>
                </div>
              )}

              <div className="flex items-center gap-3 flex-wrap pt-2 text-sm text-muted-foreground">
                {selectedReport.dailyStatus && (
                  <Badge variant="outline" className={`text-[10px] ${DAILY_STATUS_META[selectedReport.dailyStatus].cls}`}>
                    {DAILY_STATUS_META[selectedReport.dailyStatus].label}
                  </Badge>
                )}
                {selectedReport.workLocation && (
                  <span className="text-xs">{WORK_LOCATION_LABELS[selectedReport.workLocation]}</span>
                )}
                {selectedReport.workingStatus && selectedReport.workingStatus !== 'working' && (
                  <Badge variant="outline" className="text-[10px]">
                    {WORKING_STATUS_LABELS[selectedReport.workingStatus]}
                  </Badge>
                )}
                {selectedReport.hoursWorked && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> {selectedReport.hoursWorked} orë
                    {/* Absent split means "not measured" — never rendered as 0h. */}
                    {selectedReport.billableHours !== undefined && (
                      <span className="text-xs">({selectedReport.billableHours}h të faturueshme)</span>
                    )}
                  </span>
                )}
                {selectedReport.wasLate && (
                  <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/30">
                    dorëzuar me vonesë
                  </Badge>
                )}
                {selectedReport.mood && (() => {
                  const m = moodIcons[selectedReport.mood];
                  const Icon = m.icon;
                  return (
                    <span className="flex items-center gap-1">
                      <Icon className={`w-3.5 h-3.5 ${m.color}`} /> {m.label}
                    </span>
                  );
                })()}
              </div>

              {selectedReport.projectIds && selectedReport.projectIds.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Projekte</Label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedReport.projectIds.map(pid => {
                      const proj = projects?.find(p => p.id === pid);
                      return (
                        <Badge key={pid} variant="outline" className="text-xs">
                          {proj?.name || pid.slice(0, 8)}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Create Report Dialog */}
      {showCreateDialog && (
        <CreateReportDialog
          onClose={() => setShowCreateDialog(false)}
          projects={projects}
        />
      )}
    </div>
  );
};

// Inline create dialog (reuses same form as popup but in a dedicated page context)
const CreateReportDialog: React.FC<{ onClose: () => void; projects?: Project[] | null }> = ({ onClose, projects }) => {
  const { user } = useAuth();
  const reportMutation = useMutation<DailyReport>('dailyReports');
  const [completedToday, setCompletedToday] = useState('');
  const [openItems, setOpenItems] = useState('');
  const [blockers, setBlockers] = useState('');
  const [planTomorrow, setPlanTomorrow] = useState('');
  const [hoursWorked, setHoursWorked] = useState('8');
  const [mood, setMood] = useState<'great' | 'good' | 'neutral' | 'struggling'>('good');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [customFields, setCustomFields] = useState<Record<string, string | number>>({});
  const [submitting, setSubmitting] = useState(false);

  const serviceLine = useMyServiceLine();
  const today = getTodayString();

  const handleSubmit = async () => {
    if (!user) return;
    if (!completedToday.trim()) {
      toast({ title: 'Plotëso "Çfarë përfundova sot"', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      await reportMutation.create({
        userId: user.uid,
        date: today,
        completedToday: completedToday.trim(),
        openItems: openItems.trim(),
        blockers: blockers.trim(),
        planTomorrow: planTomorrow.trim(),
        hoursWorked: parseFloat(hoursWorked) || 8,
        projectIds: selectedProjectIds,
        mood,
        serviceLine: normalizeServiceLine(serviceLine) || undefined,
        customFields: Object.keys(customFields).length ? customFields : undefined,
      } as any);
      toast({ title: 'Raporti u ruajt!' });
      onClose();
    } catch {
      toast({ title: 'Gabim!', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleProject = (id: string) => {
    setSelectedProjectIds(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Raporti Ditor — {formatDate(today)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div>
            <Label className="flex items-center gap-2 mb-1.5">
              <CheckCircle2 className="w-4 h-4 text-success" /> Çfarë përfundova sot *
            </Label>
            <Textarea value={completedToday} onChange={e => setCompletedToday(e.target.value)} rows={3}
              placeholder="p.sh. Përfundova 3 postime për Klientin A..." />
          </div>

          <DepartmentReportFields
            serviceLine={serviceLine}
            values={customFields}
            onChange={(k, v) => setCustomFields((prev) => ({ ...prev, [k]: v }))}
          />

          <div>
            <Label className="flex items-center gap-2 mb-1.5">
              <Clock className="w-4 h-4 text-warning" /> Çfarë mbeti hapur
            </Label>
            <Textarea value={openItems} onChange={e => setOpenItems(e.target.value)} rows={2}
              placeholder="p.sh. Landing page për Klientin B..." />
          </div>
          <div>
            <Label className="flex items-center gap-2 mb-1.5">
              <AlertTriangle className="w-4 h-4 text-error" /> Çfarë pengese kam
            </Label>
            <Textarea value={blockers} onChange={e => setBlockers(e.target.value)} rows={2}
              placeholder="p.sh. Mungojnë materialet nga klienti..." />
          </div>
          <div>
            <Label className="flex items-center gap-2 mb-1.5">
              <ArrowRight className="w-4 h-4 text-primary" /> Çfarë kam plan nesër
            </Label>
            <Textarea value={planTomorrow} onChange={e => setPlanTomorrow(e.target.value)} rows={2}
              placeholder="p.sh. Finalizoj landing page, nis A/B test..." />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-1.5">Sa orë punova</Label>
              <Input type="number" min="0" max="24" step="0.5" value={hoursWorked} onChange={e => setHoursWorked(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5">Si u ndjeva sot</Label>
              <div className="flex gap-2 mt-1">
                {(['great', 'good', 'neutral', 'struggling'] as const).map(key => {
                  const m = moodIcons[key];
                  const Icon = m.icon;
                  return (
                    <button key={key} type="button" onClick={() => setMood(key)}
                      className={`p-2 rounded-lg border transition-all ${mood === key ? 'border-primary bg-primary/10 scale-110' : 'border-border hover:border-muted-foreground'}`}>
                      <Icon className={`w-5 h-5 ${m.color}`} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {projects && projects.length > 0 && (
            <div>
              <Label className="mb-1.5">Në cilat projekte punova</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {projects.filter(p => p.status === 'Active' || p.status === 'In Review').map(p => (
                  <Badge key={p.id} variant={selectedProjectIds.includes(p.id) ? 'default' : 'outline'}
                    className="cursor-pointer" onClick={() => toggleProject(p.id)}>
                    {p.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Anulo</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Duke ruajtur...' : 'Dërgo Raportin'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DailyReportsView;
