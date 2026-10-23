import React from 'react';
import { CalendarDays, Clock } from 'lucide-react';
import { Calendar } from '../../ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import { IconTile, SheetRow, dayTimeLabel, formatDateCompact, pillCls, pillInputCls, rowBodyCls, timeStr } from './panelShared';

// Quick-date pills (design): Sot / Nesër / Kjo javë (e premtja) / Javën tjetër
// (e hëna) / 📅 datë e lirë.
const dayKeyOf = (d: Date) => {
  const today = new Date();
  const tom = new Date(); tom.setDate(tom.getDate() + 1);
  const fri = new Date(); fri.setDate(fri.getDate() + ((5 - fri.getDay() + 7) % 7));
  const nextMon = new Date(); nextMon.setDate(nextMon.getDate() + ((1 - nextMon.getDay() + 7) % 7 || 7));
  if (d.toDateString() === today.toDateString()) return 'sot';
  if (d.toDateString() === tom.toDateString()) return 'neser';
  if (d.toDateString() === fri.toDateString()) return 'jave';
  if (d.toDateString() === nextMon.toDateString()) return 'javentjeter';
  return 'date';
};
const quickDate = (k: string) => {
  const d = new Date();
  if (k === 'neser') d.setDate(d.getDate() + 1);
  if (k === 'jave') d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
  if (k === 'javentjeter') d.setDate(d.getDate() + ((1 - d.getDay() + 7) % 7 || 7));
  return d;
};

const isPastDay = (d: Date) => d.getTime() < Date.now();
const isTodayDay = (d: Date) => d.toDateString() === new Date().toDateString();

/** "Afati" row (Koha card) — deadline pills, free date and time-of-day. The
 *  tile and the value turn red for an overdue/today deadline. */
export const TaskDueDateRow: React.FC<{
  readOnly: boolean;
  endDate: Date | null;
  onDateChange: (date: Date | undefined) => void | Promise<void>;
  onTimeChange: (e: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  open: boolean;
  onToggle: () => void;
}> = ({ readOnly, endDate, onDateChange, onTimeChange, open, onToggle }) => {
  // 'none' matches no pill: an undated task must not light up "Sot".
  const dueKey = endDate ? dayKeyOf(endDate) : 'none';
  const urgent = !!endDate && (isPastDay(endDate) || isTodayDay(endDate));
  return (
    <>
      <SheetRow
        tile={<IconTile tone={urgent ? 'danger' : 'brand'}><CalendarDays className="h-[17px] w-[17px]" strokeWidth={2} /></IconTile>}
        label="Afati"
        value={endDate ? dayTimeLabel(endDate) : 'Pa afat'}
        valueClassName={`text-[15px] ${urgent ? 'font-semibold text-red-600 dark:text-red-400' : endDate ? 'text-foreground/80' : 'text-muted-foreground'}`}
        open={open}
        disabled={readOnly}
        onToggle={onToggle}
      />
      {open && !readOnly && (
        <div className={rowBodyCls} onClick={(e) => e.stopPropagation()}>
          {([['sot', 'Sot'], ['neser', 'Nesër'], ['jave', 'Kjo javë'], ['javentjeter', 'Javën tjetër']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => onDateChange(quickDate(k))} className={pillCls(dueKey === k)}>
              {l}
            </button>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={pillCls(dueKey === 'date')}>📅 {endDate ? formatDateCompact(endDate) : 'Zgjidh datën'}</button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={endDate ?? undefined} onSelect={onDateChange} />
            </PopoverContent>
          </Popover>
          {endDate && (
            <input type="time" value={timeStr(endDate)} onChange={onTimeChange} className={pillInputCls} aria-label="Ora e afatit" />
          )}
        </div>
      )}
    </>
  );
};

/** "Fillimi" row (Koha card) — start pills, free date and time-of-day. */
export const TaskStartDateRow: React.FC<{
  readOnly: boolean;
  startDate: Date;
  onDateChange: (date: Date | undefined) => void | Promise<void>;
  onTimeChange: (e: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  open: boolean;
  onToggle: () => void;
}> = ({ readOnly, startDate, onDateChange, onTimeChange, open, onToggle }) => {
  const startKey = dayKeyOf(startDate);
  return (
    <>
      <SheetRow
        tile={<IconTile tone="brand"><Clock className="h-[17px] w-[17px]" strokeWidth={2} /></IconTile>}
        label="Fillimi"
        value={dayTimeLabel(startDate)}
        open={open}
        disabled={readOnly}
        onToggle={onToggle}
      />
      {open && !readOnly && (
        <div className={rowBodyCls} onClick={(e) => e.stopPropagation()}>
          {([['sot', 'Sot'], ['neser', 'Nesër'], ['jave', 'Kjo javë']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => onDateChange(quickDate(k))} className={pillCls(startKey === k)}>
              {l}
            </button>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={pillCls(startKey === 'date' || startKey === 'javentjeter')}>📅 {formatDateCompact(startDate)}</button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={startDate} onSelect={onDateChange} />
            </PopoverContent>
          </Popover>
          <input type="time" value={timeStr(startDate)} onChange={onTimeChange} className={pillInputCls} aria-label="Ora e fillimit" />
        </div>
      )}
    </>
  );
};
