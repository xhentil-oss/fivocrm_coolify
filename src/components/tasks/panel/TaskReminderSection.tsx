import React from 'react';
import { Bell, BellOff } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { Calendar } from '../../ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import {
  REMINDER_PRESETS,
  setReminderPatch,
  activeReminderPreset,
  describeReminder,
  parseTaskDate,
} from '../../../lib/taskReminders';
import type { Task } from '../../../types';
import { chipCls, formatDateCompact, rowCls, rowLabelCls, timeStr } from './panelShared';

interface TaskReminderSectionProps {
  task: Task;
  readOnly: boolean;
  /** The panel's local deadline (fallback anchor for a custom time). */
  endDate: Date | null;
  onUpdate: (id: string, data: any) => Promise<any>;
}

/** "Kujtesë" row — "Më kujto" (Asana/Salesforce-style reminder). */
const TaskReminderSection: React.FC<TaskReminderSectionProps> = ({ task, readOnly, endDate, onUpdate }) => {
  const { user } = useAuth();
  // Presets resolve against the deadline; a custom moment is absolute. All
  // writes go through setReminderPatch so the three fields never disagree.
  const reminderAt = parseTaskDate(task.reminderAt);
  const reminderPreset = activeReminderPreset(task);
  const reminderIsCustom = !!reminderAt && !reminderPreset;
  // `reminderSetByUserId` = who asked to be reminded: the cron delivers to that
  // person (not to the assignee), so it is stamped on every SET and cleared
  // (explicit null) on every clear.
  const clearReminderPatch = (): Partial<Task> => ({ ...setReminderPatch(task, null), reminderSetByUserId: null });
  const setByMe = (p: Partial<Task>): Partial<Task> =>
    ({ ...p, reminderSetByUserId: p.reminderAt ? (user?.uid ?? null) : null });
  // A preset is RELATIVE to the deadline, so it resolves against the TASK's
  // stored deadline — never the panel's local state. No deadline → no reminder
  // (setReminderPatch returns the clear patch), and the chips are hidden.
  const hasDeadline = !!parseTaskDate(task.endDate);
  const handleReminderPreset = async (minutes: number) => {
    // Tapping the active preset clears it (chips toggle, like labels).
    if (reminderPreset?.minutes === minutes) { await onUpdate(task.id, clearReminderPatch()); return; }
    if (!hasDeadline) return;
    await onUpdate(task.id, setByMe(setReminderPatch(task, { offsetMinutes: minutes })));
  };
  const handleReminderClear = async () => { await onUpdate(task.id, clearReminderPatch()); };
  const handleReminderCustomDate = async (date: Date | undefined) => {
    if (!date) return;
    const at = new Date(date);
    // Keep the time-of-day already chosen; default to 09:00 for a fresh pick.
    if (reminderAt) at.setHours(reminderAt.getHours(), reminderAt.getMinutes(), 0, 0);
    else at.setHours(9, 0, 0, 0);
    await onUpdate(task.id, setByMe(setReminderPatch(task, { at })));
  };
  const handleReminderCustomTime = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const [h, m] = e.target.value.split(':').map(Number);
    const at = new Date(reminderAt ?? endDate ?? new Date()); at.setHours(h || 0, m || 0, 0, 0);
    await onUpdate(task.id, setByMe(setReminderPatch(task, { at })));
  };

  return (
    <div className={rowCls}>
      <span className={rowLabelCls}>Kujtesë</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Presets are "X before the deadline" — meaningless without one. */}
        {!readOnly && !hasDeadline && !reminderAt && (
          <span className="text-[11.5px] text-muted-foreground">Vendos një afat për kujtesat relative, ose zgjidh një datë.</span>
        )}
        {hasDeadline && REMINDER_PRESETS.map(p => (
          <button
            key={p.key}
            type="button"
            disabled={readOnly}
            onClick={() => handleReminderPreset(p.minutes)}
            className={chipCls(reminderPreset?.key === p.key)}
            title={p.minutes === 0 ? 'Njoftim në momentin e afatit' : `Njoftim ${p.label.toLowerCase()} afatit`}
          >
            {p.label}
          </button>
        ))}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" disabled={readOnly} className={chipCls(reminderIsCustom)} title="Zgjidh datën dhe orën e kujtesës">
              📅 {reminderIsCustom && reminderAt ? formatDateCompact(reminderAt) : 'Tjetër…'}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={reminderAt ?? undefined} onSelect={handleReminderCustomDate} />
          </PopoverContent>
        </Popover>
        {!readOnly && reminderAt && (
          <input
            type="time"
            value={timeStr(reminderAt)}
            onChange={handleReminderCustomTime}
            className="h-7 rounded border border-border/50 bg-muted/40 px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            title="Ora e kujtesës"
          />
        )}
        {reminderAt && (
          <span className={`inline-flex items-center gap-1 text-[11.5px] ${task.reminderSentAt ? 'text-muted-foreground' : 'text-primary'}`}>
            {task.reminderSentAt ? <BellOff className="h-3 w-3" /> : <Bell className="h-3 w-3" />}
            {describeReminder(task)}
          </span>
        )}
        {reminderAt && !readOnly && (
          <button type="button" onClick={handleReminderClear} className="text-xs font-bold text-muted-foreground hover:text-foreground" title="Hiq kujtesën">✕</button>
        )}
      </div>
    </div>
  );
};

export default TaskReminderSection;
