import React from 'react';
import { Calendar } from '../../ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import { chipCls, formatDateCompact, rowCls, rowLabelCls, timeStr } from './panelShared';

// Quick-date chips: Sot / Nesër / Kjo javë (e premtja) / 📅 datë e lirë.
const dayKeyOf = (d: Date) => {
  const today = new Date();
  const tom = new Date(); tom.setDate(tom.getDate() + 1);
  const fri = new Date(); fri.setDate(fri.getDate() + ((5 - fri.getDay() + 7) % 7));
  if (d.toDateString() === today.toDateString()) return 'sot';
  if (d.toDateString() === tom.toDateString()) return 'neser';
  if (d.toDateString() === fri.toDateString()) return 'jave';
  return 'date';
};
const quickDate = (k: string) => {
  const d = new Date();
  if (k === 'neser') d.setDate(d.getDate() + 1);
  if (k === 'jave') d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
  return d;
};

/** "Afati" row — deadline chips, free date and time-of-day. */
export const TaskDueDateRow: React.FC<{
  readOnly: boolean;
  endDate: Date | null;
  onDateChange: (date: Date | undefined) => void | Promise<void>;
  onTimeChange: (e: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>;
}> = ({ readOnly, endDate, onDateChange, onTimeChange }) => {
  // 'none' matches no chip: an undated task must not light up "Sot".
  const dueKey = endDate ? dayKeyOf(endDate) : 'none';
  return (
    <div className={rowCls}>
      <span className={rowLabelCls}>Afati</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {([['sot', 'Sot'], ['neser', 'Nesër'], ['jave', 'Kjo javë']] as const).map(([k, l]) => (
          <button key={k} type="button" disabled={readOnly} onClick={() => onDateChange(quickDate(k))} className={chipCls(dueKey === k)}>
            {l}
          </button>
        ))}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" disabled={readOnly} className={chipCls(dueKey === 'date')}>📅 {endDate ? formatDateCompact(endDate) : 'Pa afat'}</button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={endDate ?? undefined} onSelect={onDateChange} />
          </PopoverContent>
        </Popover>
        {!readOnly && endDate && (
          <input
            type="time"
            value={timeStr(endDate)}
            onChange={onTimeChange}
            className="h-7 rounded border border-border/50 bg-muted/40 px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
        )}
      </div>
    </div>
  );
};

/** "Fillimi" row — start chips, free date and time-of-day. */
export const TaskStartDateRow: React.FC<{
  readOnly: boolean;
  startDate: Date;
  onDateChange: (date: Date | undefined) => void | Promise<void>;
  onTimeChange: (e: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>;
}> = ({ readOnly, startDate, onDateChange, onTimeChange }) => {
  const startKey = dayKeyOf(startDate);
  return (
    <div className={rowCls}>
      <span className={rowLabelCls}>Fillimi</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {([['sot', 'Sot'], ['neser', 'Nesër']] as const).map(([k, l]) => (
          <button key={k} type="button" disabled={readOnly} onClick={() => onDateChange(quickDate(k))} className={chipCls(startKey === k)}>
            {l}
          </button>
        ))}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" disabled={readOnly} className={chipCls(startKey === 'date' || startKey === 'jave')}>📅 {formatDateCompact(startDate)}</button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={startDate} onSelect={onDateChange} />
          </PopoverContent>
        </Popover>
        {!readOnly && (
          <input
            type="time"
            value={timeStr(startDate)}
            onChange={onTimeChange}
            className="h-7 rounded border border-border/50 bg-muted/40 px-1.5 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        )}
      </div>
    </div>
  );
};
