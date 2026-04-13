import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { CheckCircle2, Clock, AlertTriangle, ArrowRight, Smile, Meh, Frown, Sparkles, Square, CheckSquare } from 'lucide-react';
import { toast } from '../hooks/use-toast';
import type { DailyReport, Project, Task } from '../types';

const POPUP_HOUR = 16;
const POPUP_MINUTE = 55;
const STORAGE_KEY = 'daily_report_dismissed';

function getTodayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DailyReportPopup: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const [open, setOpen] = useState(false);

  // Form state
  const [completedToday, setCompletedToday] = useState('');
  const [openItems, setOpenItems] = useState('');
  const [blockers, setBlockers] = useState('');
  const [planTomorrow, setPlanTomorrow] = useState('');
  const [hoursWorked, setHoursWorked] = useState<string>('8');
  const [mood, setMood] = useState<'great' | 'good' | 'neutral' | 'struggling'>('good');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const today = getTodayString();

  const { data: todayReports } = useCollection<DailyReport>('dailyReports', {
    where: [
      { field: 'userId', operator: '==', value: user?.uid || '__never__' },
      { field: 'date', operator: '==', value: today },
    ],
  });

  const { data: projects } = useCollection<Project>('projects');
  const { data: myTasks } = useCollection<Task>('tasks', {
    where: [{ field: 'assignedToUserId', operator: '==', value: user?.uid || '__never__' }],
  });
  const reportMutation = useMutation<DailyReport>('dailyReports');
  const taskMutation = useMutation<Task>('tasks');

  // Tasks completed today (status=Done, updatedAt is today)
  const completedTodayTasks = useMemo(() => {
    if (!myTasks) return [];
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return myTasks.filter(t => {
      if (t.status !== 'Done') return false;
      const updated = t.updatedAt instanceof Date ? t.updatedAt : new Date(t.updatedAt);
      return updated >= todayStart;
    });
  }, [myTasks]);

  // Tasks assigned for today: due today, started today, or created/assigned today
  const todaysAssignedTasks = useMemo(() => {
    if (!myTasks) return [];
    const todayStr = getTodayString();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    return myTasks.filter(t => {
      if (t.status === 'Done') return false;
      // Due date is today
      const due = t.endDate || t.dueDate;
      if (due) {
        const d = due instanceof Date ? due : new Date(due);
        const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (dStr === todayStr) return true;
        // Also include overdue tasks
        if (d < todayStart) return true;
      }
      // Start date is today or earlier (task should be active)
      if (t.startDate) {
        const s = t.startDate instanceof Date ? t.startDate : new Date(t.startDate);
        if (s <= todayEnd) {
          const due2 = t.endDate || t.dueDate;
          if (!due2 || new Date(due2) >= todayStart) return true;
        }
      }
      // Status is "In Progress" — actively being worked on
      if (t.status === 'In Progress') return true;
      // Created/assigned today (new assignment)
      const created = t.createdAt instanceof Date ? t.createdAt : new Date(t.createdAt);
      if (created >= todayStart) return true;
      return false;
    });
  }, [myTasks]);

  // Other pending tasks (not today's and not done)
  const otherPendingTasks = useMemo(() => {
    if (!myTasks) return [];
    const todayIds = new Set(todaysAssignedTasks.map(t => t.id));
    return myTasks.filter(t => t.status !== 'Done' && !todayIds.has(t.id));
  }, [myTasks, todaysAssignedTasks]);

  const alreadySubmitted = useMemo(() => {
    return (todayReports?.length || 0) > 0;
  }, [todayReports]);

  // Timer: check every minute if it's time to show popup
  useEffect(() => {
    if (!user || !permissions.teamId) return;

    const checkTime = () => {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      const day = now.getDay(); // 0=Sun, 6=Sat

      // Skip weekends
      if (day === 0 || day === 6) return;

      // Check if already dismissed or submitted today
      const dismissed = localStorage.getItem(STORAGE_KEY);
      if (dismissed === today) return;
      if (alreadySubmitted) return;

      // Show at 16:55 or later (until end of day)
      if (hour > POPUP_HOUR || (hour === POPUP_HOUR && minute >= POPUP_MINUTE)) {
        setOpen(true);
      }
    };

    checkTime();
    const interval = setInterval(checkTime, 60_000);
    return () => clearInterval(interval);
  }, [user, permissions.teamId, today, alreadySubmitted]);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, today);
    setOpen(false);
  };

  // Close without persisting — popup will reappear on next timer tick (1 min)
  const handleClose = () => {
    setOpen(false);
  };

  const handleSubmit = async () => {
    if (!user || !permissions.teamId) return;
    if (!completedToday.trim()) {
      toast({ title: 'Plotëso "Çfarë përfundova sot"', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      // Mark selected pending tasks as Done
      const allCompletedIds = [
        ...completedTodayTasks.map(t => t.id),
        ...selectedTaskIds,
      ];
      for (const taskId of selectedTaskIds) {
        await taskMutation.update(taskId, { status: 'Done' } as any);
      }

      await reportMutation.create({
        userId: user.uid,
        date: today,
        completedToday: completedToday.trim(),
        openItems: openItems.trim(),
        blockers: blockers.trim(),
        planTomorrow: planTomorrow.trim(),
        hoursWorked: parseFloat(hoursWorked) || 8,
        projectIds: selectedProjectIds,
        completedTaskIds: allCompletedIds.length > 0 ? allCompletedIds : undefined,
        mood,
      } as any);

      toast({ title: 'Raporti ditor u ruajt!', description: 'Faleminderit për raportimin.' });
      localStorage.setItem(STORAGE_KEY, today);
      setOpen(false);
      // Reset form
      setCompletedToday('');
      setOpenItems('');
      setBlockers('');
      setPlanTomorrow('');
      setHoursWorked('8');
      setMood('good');
      setSelectedProjectIds([]);
      setSelectedTaskIds([]);
    } catch (err) {
      console.error('Failed to submit daily report:', err);
      toast({ title: 'Gabim!', description: 'Nuk u ruajt raporti. Provo përsëri.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleProject = (id: string) => {
    setSelectedProjectIds(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const toggleTask = (id: string) => {
    setSelectedTaskIds(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  // Don't render if already submitted
  if (alreadySubmitted) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Raporti Ditor
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Plotëso raportin e ditës në 2 minuta para se të mbyllësh ditën.
          </p>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* 1. Completed today */}
          <div>
            <Label className="flex items-center gap-2 mb-1.5">
              <CheckCircle2 className="w-4 h-4 text-success" />
              Çfarë përfundova sot *
            </Label>
            <Textarea
              value={completedToday}
              onChange={(e) => setCompletedToday(e.target.value)}
              placeholder="p.sh. Përfundova 3 postime për Klientin A, optimizova fushatën Meta Ads..."
              rows={3}
            />
          </div>

          {/* Tasks section */}
          {(completedTodayTasks.length > 0 || todaysAssignedTasks.length > 0 || otherPendingTasks.length > 0) && (
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-primary" />
                Detyrat e sotme
              </Label>

              {/* Tasks assigned for today (most important — shown first) */}
              {todaysAssignedTasks.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">
                    📋 Të caktuara për sot ({todaysAssignedTasks.length}):
                  </p>
                  {todaysAssignedTasks.map(task => {
                    const due = task.endDate || task.dueDate;
                    const isOverdue = due && new Date(due) < new Date(new Date().setHours(0, 0, 0, 0));
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => toggleTask(task.id)}
                        className={`flex items-center gap-2 p-2 rounded-lg text-sm w-full text-left transition-all ${
                          selectedTaskIds.includes(task.id)
                            ? 'bg-primary/10 border border-primary/30'
                            : isOverdue
                            ? 'bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/30 border border-red-200 dark:border-red-800'
                            : 'bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-100/50 dark:hover:bg-amber-950/30 border border-amber-200/50 dark:border-amber-800/50'
                        }`}
                      >
                        {selectedTaskIds.includes(task.id) ? (
                          <CheckSquare className="w-4 h-4 text-primary flex-shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        )}
                        <span className={`truncate flex-1 ${selectedTaskIds.includes(task.id) ? 'line-through text-muted-foreground' : ''}`}>
                          {task.title}
                        </span>
                        {isOverdue && <Badge variant="destructive" className="text-[10px] ml-auto flex-shrink-0">Vonuar</Badge>}
                        {task.priority === 'urgent' && <Badge variant="destructive" className="text-[10px] ml-auto flex-shrink-0">Urgjent</Badge>}
                        {task.priority === 'high' && !isOverdue && <Badge className="text-[10px] ml-auto bg-orange-500 flex-shrink-0">E lartë</Badge>}
                        {task.status === 'In Progress' && <Badge variant="secondary" className="text-[10px] ml-auto flex-shrink-0">Në progres</Badge>}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Tasks completed today (auto-detected) */}
              {completedTodayTasks.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">✅ Të përfunduara sot ({completedTodayTasks.length}):</p>
                  {completedTodayTasks.map(task => (
                    <div key={task.id} className="flex items-center gap-2 p-2 rounded-lg bg-success/10 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
                      <span className="line-through text-muted-foreground truncate">{task.title}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Other pending tasks */}
              {otherPendingTasks.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Detyra të tjera aktive:</p>
                  {otherPendingTasks.slice(0, 8).map(task => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => toggleTask(task.id)}
                      className={`flex items-center gap-2 p-2 rounded-lg text-sm w-full text-left transition-all ${
                        selectedTaskIds.includes(task.id)
                          ? 'bg-primary/10 border border-primary/30'
                          : 'bg-muted/50 hover:bg-muted border border-transparent'
                      }`}
                    >
                      {selectedTaskIds.includes(task.id) ? (
                        <CheckSquare className="w-4 h-4 text-primary flex-shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      )}
                      <span className={`truncate ${selectedTaskIds.includes(task.id) ? 'line-through text-muted-foreground' : ''}`}>
                        {task.title}
                      </span>
                      {task.priority === 'urgent' && <Badge variant="destructive" className="text-[10px] ml-auto">Urgjent</Badge>}
                      {task.priority === 'high' && <Badge className="text-[10px] ml-auto bg-orange-500">E lartë</Badge>}
                    </button>
                  ))}
                  {otherPendingTasks.length > 8 && (
                    <p className="text-[11px] text-muted-foreground text-center py-1">
                      +{otherPendingTasks.length - 8} detyra të tjera
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 2. Open items */}
          <div>
            <Label className="flex items-center gap-2 mb-1.5">
              <Clock className="w-4 h-4 text-warning" />
              Çfarë mbeti hapur
            </Label>
            <Textarea
              value={openItems}
              onChange={(e) => setOpenItems(e.target.value)}
              placeholder="p.sh. Landing page për Klientin B, review i materialeve..."
              rows={2}
            />
          </div>

          {/* 3. Blockers */}
          <div>
            <Label className="flex items-center gap-2 mb-1.5">
              <AlertTriangle className="w-4 h-4 text-error" />
              Çfarë pengese kam
            </Label>
            <Textarea
              value={blockers}
              onChange={(e) => setBlockers(e.target.value)}
              placeholder="p.sh. Mungojnë materialet nga klienti, pres miratim..."
              rows={2}
            />
          </div>

          {/* 4. Plan for tomorrow */}
          <div>
            <Label className="flex items-center gap-2 mb-1.5">
              <ArrowRight className="w-4 h-4 text-primary" />
              Çfarë kam plan nesër
            </Label>
            <Textarea
              value={planTomorrow}
              onChange={(e) => setPlanTomorrow(e.target.value)}
              placeholder="p.sh. Finalizoj landing page, nis A/B test..."
              rows={2}
            />
          </div>

          {/* Hours + Mood row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-1.5">Sa orë punova</Label>
              <Input
                type="number"
                min="0"
                max="24"
                step="0.5"
                value={hoursWorked}
                onChange={(e) => setHoursWorked(e.target.value)}
              />
            </div>
            <div>
              <Label className="mb-1.5">Si u ndjeva sot</Label>
              <div className="flex gap-2 mt-1">
                {([
                  { key: 'great', icon: Smile, color: 'text-success', label: 'Shkëlqyer' },
                  { key: 'good', icon: Smile, color: 'text-primary', label: 'Mirë' },
                  { key: 'neutral', icon: Meh, color: 'text-warning', label: 'Normale' },
                  { key: 'struggling', icon: Frown, color: 'text-error', label: 'Vështirë' },
                ] as const).map(({ key, icon: Icon, color }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMood(key)}
                    className={`p-2 rounded-lg border transition-all ${
                      mood === key
                        ? 'border-primary bg-primary/10 scale-110'
                        : 'border-border hover:border-muted-foreground'
                    }`}
                  >
                    <Icon className={`w-5 h-5 ${color}`} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Projects */}
          {projects && projects.length > 0 && (
            <div>
              <Label className="mb-1.5">Në cilat projekte punova</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {projects.filter(p => p.status === 'Active' || p.status === 'In Review').map(p => (
                  <Badge
                    key={p.id}
                    variant={selectedProjectIds.includes(p.id) ? 'default' : 'outline'}
                    className="cursor-pointer transition-all"
                    onClick={() => toggleProject(p.id)}
                  >
                    {p.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={handleDismiss}>
              Më vonë
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Duke ruajtur...' : 'Dërgo Raportin'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DailyReportPopup;
