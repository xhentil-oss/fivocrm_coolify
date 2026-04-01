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
import { CheckCircle2, Clock, AlertTriangle, ArrowRight, Smile, Meh, Frown, Sparkles } from 'lucide-react';
import { toast } from '../hooks/use-toast';
import type { DailyReport, Project } from '../types';

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
  const [submitting, setSubmitting] = useState(false);

  const today = getTodayString();

  const { data: todayReports } = useCollection<DailyReport>('dailyReports', {
    where: [
      { field: 'userId', operator: '==', value: user?.uid || '__never__' },
      { field: 'date', operator: '==', value: today },
    ],
  });

  const { data: projects } = useCollection<Project>('projects');
  const reportMutation = useMutation<DailyReport>('dailyReports');

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

  const handleSubmit = async () => {
    if (!user || !permissions.teamId) return;
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

  // Don't render if already submitted
  if (alreadySubmitted) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleDismiss(); }}>
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
