import React, { useEffect, useState } from 'react';
import { parseTaskDate, reminderPatchForDeadline } from '../../../lib/taskReminders';
import type { Task } from '../../../types';
import { rearmDeadlineAlerts } from './panelShared';

/**
 * The panel's start/deadline state and every handler that writes them
 * (extracted verbatim from TaskDetailPanel).
 */
export function useTaskPanelDates(task: Task, onUpdate: (id: string, data: any) => Promise<any>) {
  // Date editing state. BOTH dates are nullable: an undated task used to get
  // "now" here, so the Afati row lit up "Sot", a reminder preset resolved
  // against that phantom deadline (and fired at once), moving the START date
  // past it wrote a deadline the user never chose — and the Fillimi row showed
  // the current time as if the task had a start.
  const [startDate, setStartDate] = useState<Date | null>(parseTaskDate(task.startDate));
  const [endDate, setEndDate] = useState<Date | null>(parseTaskDate(task.endDate));

  // Reset ONLY when switching to a different task (see the panel's reset effect).
  useEffect(() => {
    setStartDate(parseTaskDate(task.startDate));
    setEndDate(parseTaskDate(task.endDate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  // Dates, unlike title/description, are NOT a typed draft — every date/time
  // edit persists immediately — so they can safely follow live Firestore
  // updates. Without this, a reschedule made elsewhere while the panel is open
  // left these stale, and the next time-of-day tweak wrote the OLD date back
  // over the fresh one. (Missing dates key as 0.)
  const startDateKey = parseTaskDate(task.startDate)?.getTime() ?? 0;
  const endDateKey = parseTaskDate(task.endDate)?.getTime() ?? 0;
  useEffect(() => {
    setStartDate(parseTaskDate(task.startDate));
    setEndDate(parseTaskDate(task.endDate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDateKey, endDateKey]);

  // Auto-adjust instead of silently blocking, so intra-day edits always apply
  // (Asana-style): if start moves past end, end follows; if end moves before
  // start, start follows.
  // A moved deadline also carries a RELATIVE reminder ("1 orë para") with it —
  // see reminderPatchForDeadline. Every path that writes endDate spreads it.
  // An undated task stays undated: only an EXISTING deadline is pushed along
  // when the start moves past it.
  const handleStartDateChange = async (date: Date | undefined) => {
    if (!date) return;
    const nd = new Date(date);
    // Keep the start's time-of-day; a first start lands at 09:00 (start of
    // the working day) rather than the calendar's midnight.
    if (startDate) nd.setHours(startDate.getHours(), startDate.getMinutes(), 0, 0);
    else nd.setHours(9, 0, 0, 0);
    setStartDate(nd);
    const patch: Partial<Task> = { startDate: nd };
    if (endDate && nd > endDate) { setEndDate(nd); Object.assign(patch, { endDate: nd }, rearmDeadlineAlerts, reminderPatchForDeadline(task, nd)); }
    await onUpdate(task.id, patch);
  };

  const handleEndDateChange = async (date: Date | undefined) => {
    if (!date) return;
    const nd = new Date(date);
    // Keep the deadline's time-of-day; a first deadline lands at 17:00 (end of
    // the working day) rather than the calendar's midnight, which read as
    // overdue from the first minute of that day.
    if (endDate) nd.setHours(endDate.getHours(), endDate.getMinutes(), 0, 0);
    else nd.setHours(17, 0, 0, 0);
    setEndDate(nd);
    const patch: Partial<Task> = { endDate: nd, ...rearmDeadlineAlerts, ...reminderPatchForDeadline(task, nd) };
    if (startDate && nd < startDate) { setStartDate(nd); patch.startDate = nd; }
    await onUpdate(task.id, patch);
  };

  // Intra-day scheduling: edit just the time-of-day (same-day tasks, e.g. 09:00–11:00).
  const handleStartTimeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // The time input only renders for a dated task; never invent a start here.
    if (!startDate) return;
    const [h, m] = e.target.value.split(':').map(Number);
    const nd = new Date(startDate); nd.setHours(h || 0, m || 0, 0, 0);
    setStartDate(nd);
    const patch: Partial<Task> = { startDate: nd };
    if (endDate && nd > endDate) { setEndDate(nd); Object.assign(patch, { endDate: nd }, rearmDeadlineAlerts, reminderPatchForDeadline(task, nd)); }
    await onUpdate(task.id, patch);
  };
  const handleEndTimeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // The time input only renders for a dated task; never invent a deadline here.
    if (!endDate) return;
    const [h, m] = e.target.value.split(':').map(Number);
    const nd = new Date(endDate); nd.setHours(h || 0, m || 0, 0, 0);
    setEndDate(nd);
    const patch: Partial<Task> = { endDate: nd, ...rearmDeadlineAlerts, ...reminderPatchForDeadline(task, nd) };
    if (startDate && nd < startDate) { setStartDate(nd); patch.startDate = nd; }
    await onUpdate(task.id, patch);
  };

  return {
    startDate,
    endDate,
    handleStartDateChange,
    handleEndDateChange,
    handleStartTimeChange,
    handleEndTimeChange,
  };
}
