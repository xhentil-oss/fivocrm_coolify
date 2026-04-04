import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Coffee, AlertTriangle, ArrowRight, ClipboardList } from 'lucide-react';
import { toast } from '../hooks/use-toast';
import type { StandupEntry } from '../types';

// Fire the popup at 09:00, Mon–Fri
const STANDUP_HOUR = 9;
const STANDUP_MINUTE = 0;
const STORAGE_KEY = 'standup_dismissed';

function getTodayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const StandupPopup: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [yesterday, setYesterday] = useState('');
  const [today, setToday] = useState('');
  const [blockers, setBlockers] = useState('');

  const todayStr = getTodayString();

  const { data: todayStandups } = useCollection<StandupEntry>('standups', {
    skip: !user?.uid,
    where: user?.uid
      ? [
          { field: 'userId', operator: '==', value: user.uid },
          { field: 'date', operator: '==', value: todayStr },
        ]
      : undefined,
  });

  const standupMutation = useMutation<StandupEntry>('standups');

  const alreadySubmitted = useMemo(() => (todayStandups?.length || 0) > 0, [todayStandups]);

  useEffect(() => {
    if (!user || !permissions.teamId) return;

    const checkTime = () => {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      const day = now.getDay(); // 0=Sun, 6=Sat

      // Weekends off
      if (day === 0 || day === 6) return;

      const dismissed = localStorage.getItem(STORAGE_KEY);
      if (dismissed === todayStr) return;
      if (alreadySubmitted) return;

      // Show from 09:00 until 12:00 (so late joiners still see it)
      if (
        (hour > STANDUP_HOUR || (hour === STANDUP_HOUR && minute >= STANDUP_MINUTE)) &&
        hour < 12
      ) {
        setOpen(true);
      }
    };

    checkTime();
    const interval = setInterval(checkTime, 60_000);
    return () => clearInterval(interval);
  }, [user, permissions.teamId, todayStr, alreadySubmitted]);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, todayStr);
    setOpen(false);
  };

  const handleSubmit = async () => {
    if (!user || !permissions.teamId) return;
    if (!today.trim()) {
      toast({ title: 'Plotëso "Çfarë do bësh sot"', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      await standupMutation.create({
        userId: user.uid,
        date: todayStr,
        yesterday: yesterday.trim(),
        today: today.trim(),
        blockers: blockers.trim() || undefined,
      } as any);

      toast({ title: '☀️ Standup u dërgua!', description: 'Ditë të mirë pune!' });
      localStorage.setItem(STORAGE_KEY, todayStr);
      setOpen(false);
      setYesterday('');
      setToday('');
      setBlockers('');
    } catch (err) {
      console.error('Standup submit error:', err);
      toast({ title: 'Gabim gjatë ruajtjes', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-md"
        // Prevent closing on overlay click — must explicitly Dismiss or Submit
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Coffee className="w-5 h-5 text-amber-500" />
            Morning Standup
            <Badge variant="outline" className="ml-auto text-[10px]">
              {new Date().toLocaleDateString('sq-AL', { weekday: 'long', day: 'numeric', month: 'long' })}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Yesterday */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-sm font-medium">
              <ClipboardList className="w-3.5 h-3.5 text-muted-foreground" />
              Çfarë bëre dje?
            </Label>
            <Textarea
              value={yesterday}
              onChange={(e) => setYesterday(e.target.value)}
              placeholder="Detyrat e përfunduara, progresi..."
              rows={2}
              className="resize-none text-sm"
            />
          </div>

          {/* Today */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-sm font-medium">
              <ArrowRight className="w-3.5 h-3.5 text-primary" />
              Çfarë do të bësh sot?
              <span className="text-destructive ml-0.5">*</span>
            </Label>
            <Textarea
              value={today}
              onChange={(e) => setToday(e.target.value)}
              placeholder="Plani i ditës, prioritetet..."
              rows={2}
              className="resize-none text-sm"
            />
          </div>

          {/* Blockers */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-sm font-medium">
              <AlertTriangle className="w-3.5 h-3.5 text-warning" />
              Bllokues apo probleme?
              <span className="text-muted-foreground text-xs font-normal ml-1">(opsionale)</span>
            </Label>
            <Textarea
              value={blockers}
              onChange={(e) => setBlockers(e.target.value)}
              placeholder="Asnjë bllokues... ose ..."
              rows={2}
              className="resize-none text-sm"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={handleDismiss}
            disabled={submitting}
          >
            Kalo
          </Button>
          <Button
            className="flex-1 bg-primary text-primary-foreground"
            onClick={handleSubmit}
            disabled={submitting || !today.trim()}
          >
            {submitting ? 'Duke dërguar...' : '☀️ Dërgo Standup'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default StandupPopup;
