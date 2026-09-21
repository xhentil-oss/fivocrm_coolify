import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import { useAuth } from '../../contexts/AuthContext';
import { useMutation } from '../../hooks/useFirestore';
import { useToast } from '../../hooks/use-toast';
import type { Customer, Project, Task, TeamMember, TimeEntry } from '../../types';
import { dayKeyOf, dayKeyToNoon, isDayLocked } from '../../lib/finance/timeEntries';
import { memberCostRole } from '../../lib/finance/costRates';

/**
 * "Regjistro orë" — Klient → Projekt → Detyrë → Orë, in that order, for ANY day.
 *
 * The one manual entry point for hours (the timer and the daily report are the
 * other two). Every write goes through the same shape: `date` (local day),
 * `source: 'manual'`, the project's client stamped on the row, `costRole` from
 * the member, `isBillable` = client work. A day inside a closed month is refused
 * here AND by the rules.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  projects: Project[] | null | undefined;
  tasks?: Task[] | null;
  customers?: Customer[] | null;
  members?: TeamMember[] | null;
  lockedMonths?: Set<string>;
  defaultDate?: string;
  defaultProjectId?: string;
  defaultTaskId?: string;
  /** Log on behalf of someone else (manager). Defaults to the signed-in user. */
  forUserId?: string;
  onSaved?: (entry: { hours: number; projectId?: string }) => void;
}

const HOUR_PRESETS = [0.5, 1, 2, 4, 8];

const TimeLogDialog: React.FC<Props> = ({
  open, onClose, projects, tasks, customers, members, lockedMonths, defaultDate, defaultProjectId, defaultTaskId, forUserId, onSaved,
}) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const timeEntryMutation = useMutation<TimeEntry>('timeEntries');

  const [date, setDate] = useState(defaultDate || dayKeyOf(new Date()));
  const [projectId, setProjectId] = useState(defaultProjectId || '__none__');
  const [taskId, setTaskId] = useState(defaultTaskId || '__none__');
  const [hours, setHours] = useState('');
  const [description, setDescription] = useState('');
  const [billable, setBillable] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(defaultDate || dayKeyOf(new Date()));
    setProjectId(defaultProjectId || '__none__');
    setTaskId(defaultTaskId || '__none__');
    setHours('');
    setDescription('');
  }, [open, defaultDate, defaultProjectId, defaultTaskId]);

  const customerName = useMemo(() => new Map((customers || []).map(c => [c.id, c.name || c.company || 'Klient'])), [customers]);
  const liveProjects = useMemo(
    () => (projects || []).filter(p => p.status !== 'Archived' && p.status !== 'Cancelled')
      .sort((a, b) => (a.customerId ? 0 : 1) - (b.customerId ? 0 : 1) || (a.name || '').localeCompare(b.name || '')),
    [projects],
  );
  const project = liveProjects.find(p => p.id === projectId);
  const projectTasks = useMemo(
    () => (tasks || []).filter(t => t.projectId === projectId && t.status !== 'Done').slice(0, 200),
    [tasks, projectId],
  );
  useEffect(() => { setBillable(!!project?.customerId); }, [project?.customerId]);

  const locked = lockedMonths ? isDayLocked(date, lockedMonths) : false;
  const uid = forUserId || user?.uid;
  const member = (members || []).find(m => m.userId === uid);

  const save = async () => {
    const h = parseFloat(hours);
    if (!uid) return;
    if (!(h > 0) || h > 24) { toast({ title: 'Orët', description: 'Vendos një numër mes 0.25 dhe 24.', variant: 'destructive' }); return; }
    if (locked) { toast({ title: 'Muaj i mbyllur', description: 'Ky muaj është mbyllur nga financa — orët nuk ndryshohen më.', variant: 'destructive' }); return; }
    const noon = dayKeyToNoon(date);
    if (!noon) { toast({ title: 'Data', description: 'Data nuk është e vlefshme.', variant: 'destructive' }); return; }
    const minutes = Math.round(h * 60);
    setSaving(true);
    try {
      await timeEntryMutation.create({
        userId: uid,
        projectId: project?.id,
        customerId: project?.customerId || undefined,
        taskId: taskId !== '__none__' ? taskId : undefined,
        description: description.trim() || (project ? `Punë për ${project.name}` : 'Punë e brendshme'),
        startTime: new Date(noon.getTime() - minutes * 60_000),
        endTime: noon,
        duration: minutes,
        date,
        source: 'manual',
        costRole: member ? memberCostRole(member) : undefined,
        isBillable: !!project?.customerId && billable,
        isPomodoroSession: false,
      } as any);
      toast({ title: `${h} orë u regjistruan`, description: project ? `${project.name}${project.customerId ? ' · ' + customerName.get(project.customerId) : ''}` : 'Punë e brendshme' });
      onSaved?.({ hours: h, projectId: project?.id });
      onClose();
    } catch (err: any) {
      toast({ title: 'Nuk u ruajt', description: err?.message || 'Gabim gjatë ruajtjes.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Regjistro orë</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tl-date">Data</Label>
              <Input id="tl-date" type="date" value={date} onChange={e => setDate(e.target.value)} />
              {locked && <p className="mt-1 text-[11px] font-semibold text-red-600">Muaj i mbyllur — vetëm lexim.</p>}
            </div>
            <div>
              <Label htmlFor="tl-hours">Orë</Label>
              <Input id="tl-hours" type="number" min="0.25" max="24" step="0.25" value={hours} onChange={e => setHours(e.target.value)} placeholder="p.sh. 2.5" />
              <div className="mt-1 flex flex-wrap gap-1">
                {HOUR_PRESETS.map(p => (
                  <button key={p} type="button" onClick={() => setHours(String(p))}
                    className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-primary">
                    {p}h
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <Label>Klienti → Projekti</Label>
            <Select value={projectId} onValueChange={(v) => { setProjectId(v); setTaskId('__none__'); }}>
              <SelectTrigger><SelectValue placeholder="Zgjidh projektin" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="__none__">Punë e brendshme (pa projekt)</SelectItem>
                {liveProjects.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.customerId ? `${customerName.get(p.customerId) || 'Klient'} · ` : '🏠 '}{p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {projectId !== '__none__' && projectTasks.length > 0 && (
            <div>
              <Label>Detyra <span className="text-muted-foreground">(opsionale)</span></Label>
              <Select value={taskId} onValueChange={setTaskId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="__none__">Pa detyrë specifike</SelectItem>
                  {projectTasks.map(t => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="tl-desc">Çfarë bëre</Label>
            <Input id="tl-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="p.sh. 3 reels + korrigjime" />
          </div>

          {project?.customerId && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={billable} onCheckedChange={(v) => setBillable(!!v)} />
              Orë klienti (të faturueshme)
            </label>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Anulo</Button>
            <Button type="button" onClick={save} disabled={saving || locked}>{saving ? 'Duke ruajtur…' : 'Ruaj orët'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TimeLogDialog;
