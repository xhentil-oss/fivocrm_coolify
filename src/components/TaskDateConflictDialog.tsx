import React from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { getStatusColor, getTaskStatusLabel } from '../lib/statusColors';
import type { SchedulableTask } from '../lib/taskConflicts';

/**
 * Asked before a task is saved onto a day where the assignee already has work.
 * It only warns — the answer is always the user's ("po, hape prapë atë ditë").
 */
const TaskDateConflictDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Who the task is being assigned to. */
  assigneeName: string;
  /** The date being scheduled. */
  date?: Date;
  /** Tasks that person already has on that day. */
  tasks: SchedulableTask[];
  onConfirm: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
  loading?: boolean;
}> = ({ open, onOpenChange, assigneeName, date, tasks, onConfirm, onCancel, confirmLabel = 'Po, vazhdo', loading = false }) => {
  const dateLabel = date
    ? date.toLocaleDateString('sq-AL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  const timeLabel = (value: any) => {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Ekziston një detyrë në këtë datë
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{assigneeName}</span> ka tashmë{' '}
            {tasks.length === 1 ? 'një detyrë' : `${tasks.length} detyra`}
            {dateLabel ? <> më <span className="font-medium text-foreground">{dateLabel}</span></> : null}.
            A dëshiron ta hapësh përsëri një detyrë në këtë datë?
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-56 overflow-y-auto space-y-2">
          {tasks.slice(0, 8).map((t, i) => {
            const time = timeLabel(t.startDate) || timeLabel(t.endDate);
            return (
              <div key={t.id || i} className="flex items-start justify-between gap-2 rounded-md border p-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{t.title || 'Pa titull'}</p>
                  {time && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Clock className="h-3 w-3" /> {time}
                    </p>
                  )}
                </div>
                <Badge className={`${getStatusColor(t.status)} shrink-0 text-xs`}>
                  {getTaskStatusLabel(t.status)}
                </Badge>
              </div>
            );
          })}
          {tasks.length > 8 && (
            <p className="text-xs text-muted-foreground">+{tasks.length - 8} të tjera</p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => { onCancel?.(); onOpenChange(false); }}
            disabled={loading}
          >
            Anulo
          </Button>
          <Button onClick={onConfirm} disabled={loading}>
            {loading ? 'Duke ruajtur...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TaskDateConflictDialog;
