import React from 'react';
import { Bell } from 'lucide-react';
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
import { IconTile, SheetRow, formatDateCompact, pillCls, pillInputCls, rowBodyCls, timeStr } from './panelShared';

interface TaskReminderSectionProps {
  task: Task;
  readOnly: boolean;
  /** The panel's local deadline (fallback anchor for a custom time). */
  endDate: Date | null;
  onUpdate: (id: string, data: any) => Promise<any>;
  open: boolean;
  onToggle: () => void;
}

/** "Kujtesë" row (Koha card) — "Më kujto" (Asana/Salesforce-style reminder). */
const TaskReminderSection: React.FC<TaskReminderSectionProps> = ({ task, readOnly, endDate, onUpdate, open, onToggle }) => {
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
  // (setReminderPatch returns the clear patch), and the presets are hidden.
  const hasDeadline = !!parseTaskDate(task.endDate);
  const handleReminderPreset = async (minutes: number) => {
    // Tapping the active preset clears it (pills toggle, like labels).
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

  const valueText = reminderAt
    ? (reminderPreset ? reminderPreset.label : describeReminder(task))
    : 'Asnjë';

  return (
    <>
      <SheetRow
        tile={<IconTile tone="warning"><Bell className="h-[17px] w-[17px]" strokeWidth={2} /></IconTile>}
        label="Kujtesë"
        value={valueText}
        valueClassName={`text-[15px] ${reminderAt ? (task.reminderSentAt ? 'text-muted-foreground line-through' : 'text-foreground/80') : 'text-muted-foreground'}`}
        title={reminderAt ? describeReminder(task) : undefined}
        open={open}
        disabled={readOnly}
        onToggle={onToggle}
      />
      {open && !readOnly && (
        <div className={rowBodyCls} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={handleReminderClear} className={pillCls(!reminderAt)}>Asnjë</button>
          {/* Presets are "X before the deadline" — meaningless without one. */}
          {hasDeadline && REMINDER_PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => handleReminderPreset(p.minutes)}
              className={pillCls(reminderPreset?.key === p.key)}
              title={p.minutes === 0 ? 'Njoftim në momentin e afatit' : `Njoftim ${p.label.toLowerCase()} afatit`}
            >
              {p.label}
            </button>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={pillCls(reminderIsCustom)} title="Zgjidh datën dhe orën e kujtesës">
                📅 {reminderIsCustom && reminderAt ? formatDateCompact(reminderAt) : 'Tjetër…'}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={reminderAt ?? undefined} onSelect={handleReminderCustomDate} />
            </PopoverContent>
          </Popover>
          {reminderAt && (
            <input type="time" value={timeStr(reminderAt)} onChange={handleReminderCustomTime} className={pillInputCls} title="Ora e kujtesës" aria-label="Ora e kujtesës" />
          )}
          {!hasDeadline && !reminderAt && (
            <div className="w-full text-[13px] text-muted-foreground">Vendos një afat për kujtesat relative, ose zgjidh një datë.</div>
          )}
          {reminderAt && (
            <div className={`w-full text-[13px] ${task.reminderSentAt ? 'text-muted-foreground' : 'text-primary'}`}>
              {task.reminderSentAt ? 'U dërgua · ' : ''}{describeReminder(task)}
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default TaskReminderSection;
