import React, { useState, useEffect, useMemo } from 'react';
import { ChevronDown, AlertTriangle, Search, Check } from 'lucide-react';
import { Button } from './ui/button';
import { DialogClose } from './ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { projectPickerLabel, sortArchivedLast } from '../lib/projectArchive';
import { REMINDER_PRESETS } from '../lib/taskReminders';
import { useUniqueTeamMembers } from '../hooks/useRoleFilteredData';
import type { Task, Project } from '../types';

// ── Quick-create form ────────────────────────────────────────────────────────
// Redesign v3 (Aug 2026, Claude Design "Krijo Detyre FivoCRM v3" + "Krijo Detyre
// Mobile"): only the title is required. The scheduler is capacity-aware — pick a
// person, a workday cell (with that person's booked hours drawn as a load bar)
// and a time window; the 8h/day bar and the over-capacity warning render inline
// and never block ("vazhdo me vetëdije"). Desktop is a wide dialog with compact
// pickers; mobile (<sm) is a bottom sheet with horizontal chip rails. Editing an
// existing task still goes through TaskDetailPanel.
//
// This is THE create-task form — TasksView and ProjectDetailView both mount it,
// so the two entry points can never drift apart again. The person and the
// project are picked through a searchable popover (SearchPicker), not a native
// <select>, so big teams / long project lists stay usable.

const QUICK_AVATAR_COLORS: Array<[string, string]> = [
  ['#08183A', '#ffffff'],
  ['#dbe7fb', '#2258bb'],
  ['#e8f2ec', '#1e7a46'],
  ['#fdf6e8', '#8a6413'],
  ['#fde8ea', '#b23048'],
  ['#efe8fd', '#6d3fb2'],
];

const SQ_DOW = ['Die', 'Hën', 'Mar', 'Mër', 'Enj', 'Pre', 'Sht'];
const SQ_MONTHS = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor'];
const DAY_CAPACITY_H = 8;
/** Mobile time-window presets: [from, to] in whole hours. */
const QUICK_SLOTS: Array<[number, number]> = [[9, 11], [11, 13], [13, 15], [15, 17], [9, 13], [13, 17]];

/** The next `count` workdays (Mon–Fri) starting today. */
const nextWorkdays = (count: number): Date[] => {
  const out: Date[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (out.length < count) {
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
};

const sameCalendarDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Load-bar colour: red at/over capacity, amber when close, blue otherwise. */
const loadColorOf = (h: number) => (h >= 8 ? '#d64545' : h >= 6 ? '#e0a33f' : '#2f6fe0');

/** Native select in the design's pill style, with its own chevron. */
const PillSelect: React.FC<React.SelectHTMLAttributes<HTMLSelectElement> & { wrapClass?: string }> = ({
  wrapClass = '',
  className = '',
  children,
  ...props
}) => (
  <div className={`relative ${wrapClass}`}>
    <select
      {...props}
      className={`w-full cursor-pointer appearance-none border border-border bg-background pr-7 font-bold text-foreground outline-none ${className}`}
    >
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
  </div>
);

type PickerOption = { value: string; label: string; hint?: string };

/** Pill-styled trigger that opens a searchable option list — used for the
 * person and the project so long lists are typed-into, not scrolled. */
const SearchPicker: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: PickerOption[];
  searchPlaceholder: string;
  buttonLabel: string;
  disabled?: boolean;
  wrapClass?: string;
  buttonClass?: string;
  emptyText?: string;
}> = ({ value, onChange, options, searchPlaceholder, buttonLabel, disabled = false, wrapClass = '', buttonClass = '', emptyText = 'Asnjë rezultat.' }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => { if (!open) setQ(''); }, [open]);
  const needle = q.trim().toLowerCase();
  const filtered = needle ? options.filter(o => o.label.toLowerCase().includes(needle)) : options;
  const pick = (v: string) => { onChange(v); setOpen(false); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={`relative cursor-pointer border border-border bg-background pr-7 text-left font-bold text-foreground outline-none disabled:cursor-default disabled:opacity-70 ${buttonClass} ${wrapClass}`}
        >
          <span className="block truncate">{buttonLabel}</span>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[260px] p-0">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              // Enter picks the first hit; plain Enter must not bubble into the
              // form's Ctrl/Cmd+Enter "create" shortcut.
              if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
                if (filtered.length > 0) pick(filtered[0].value);
              }
            }}
            placeholder={searchPlaceholder}
            className="w-full bg-transparent text-[13px] font-semibold text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <div className="max-h-[240px] overflow-y-auto p-1">
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-center text-xs font-semibold text-muted-foreground">{emptyText}</div>
          )}
          {filtered.map(o => (
            <button
              key={o.value || '__none__'}
              type="button"
              onClick={() => pick(o.value)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold transition-colors hover:bg-muted ${
                o.value === value ? 'text-primary' : 'text-foreground'
              }`}
            >
              <span className="flex-1 truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 text-[10px] font-bold uppercase text-muted-foreground/70">{o.hint}</span>}
              {o.value === value && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};

const QuickTaskForm: React.FC<{
  onSubmit: (data: FormData, opts?: { createAnother?: boolean }) => Promise<unknown> | void;
  projects: Project[];
  /** Raw (unfiltered) task list — the role filter must not hide booked work. */
  conflictTasks: Task[];
  teamMembers?: any[];
  canAssignTasks?: boolean;
  currentUserId?: string;
  allLabels?: string[];
  /** Pre-select a project (e.g. opening the form from inside that project). */
  defaultProjectId?: string;
  /** With defaultProjectId: the project is fixed — render it as a static pill
   * instead of a picker (a task created inside Project X belongs to X). */
  lockProject?: boolean;
}> = ({ onSubmit, projects, conflictTasks, teamMembers = [], canAssignTasks = false, currentUserId = '', allLabels = [], defaultProjectId = '', lockProject = false }) => {
  // Dedupe by userId — a user on several teams has one teamMember record per team
  // and would otherwise render as several chips for the same person.
  const uniqueMembers = useUniqueTeamMembers(teamMembers);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [who, setWho] = useState(currentUserId);
  const [whoQuery, setWhoQuery] = useState('');
  const [prio, setPrio] = useState('medium');
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [labels, setLabels] = useState<string[]>([]);
  const [dayIdx, setDayIdx] = useState(0);
  const [timeFrom, setTimeFrom] = useState(9);
  const [timeTo, setTimeTo] = useState(11);
  const [rec, setRec] = useState<'never' | 'weekly' | 'monthly' | 'custom'>('never');
  const [recInterval, setRecInterval] = useState(2);
  const [recUnit, setRecUnit] = useState<'dite' | 'jave' | 'muaj'>('jave');
  const [recDays, setRecDays] = useState<number[]>([1]);
  // "Përsërit deri" (YYYY-MM-DD) — the engine, cron and the create handler all
  // support recurringEndDate; this form just never offered it.
  const [recUntil, setRecUntil] = useState('');
  // "Më kujto" — minutes before the deadline as a string ('' = no reminder).
  // Resolved against the deadline by the create handler (src/lib/taskReminders.ts).
  const [remind, setRemind] = useState('');
  const [createMore, setCreateMore] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const memberName = (m: any) => m?.displayName || m?.email?.split('@')[0] || m?.userId || 'Ti';
  const assignableMembers = canAssignTasks
    ? uniqueMembers
    : uniqueMembers.filter((m: any) => m.userId === currentUserId);
  const whoName = memberName(uniqueMembers.find((m: any) => m.userId === who));
  const whoFirst = who === currentUserId ? 'Ti' : whoName.split(' ')[0];

  const days = useMemo(() => nextWorkdays(10), []);

  // Booked hours per visible day for the selected person — open tasks only,
  // estimatedHours (fallback 1h) summed on the task's scheduled calendar day.
  const bookedByDay = useMemo(
    () =>
      days.map(day => {
        let sum = 0;
        for (const t of conflictTasks) {
          if (t.assignedToUserId !== who || t.status === 'Done') continue;
          const raw = (t as any).endDate || (t as any).startDate;
          if (!raw) continue;
          const td = new Date(raw);
          if (isNaN(td.getTime()) || !sameCalendarDay(td, day)) continue;
          const h = Number((t as any).estimatedHours);
          sum += !isNaN(h) && h > 0 ? h : 1;
        }
        return Math.round(sum * 10) / 10;
      }),
    [conflictTasks, who, days]
  );

  const dur = Math.max(0, timeTo - timeFrom);
  const cur = bookedByDay[dayIdx] ?? 0;
  const after = Math.round((cur + dur) * 10) / 10;
  const over = after > DAY_CAPACITY_H;
  const selDay = days[dayIdx];
  const dayName = dayIdx === 0 ? 'sot' : `${SQ_DOW[selDay.getDay()]} ${selDay.getDate()} ${SQ_MONTHS[selDay.getMonth()]}`;
  const fmtH = (h: number) => `${String(h).padStart(2, '0')}:00`;
  const afterColor = over ? '#d64545' : after >= 6 ? '#e0a33f' : '#1e7a46';
  const warn = over
    ? `${whoFirst === 'Ti' ? 'Ti del' : `${whoName} del`} mbi kapacitet ${dayName} (${after}h të planifikuara nga 8h). Zgjidh një ditë tjetër, shkurto orarin, ose vazhdo me vetëdije.`
    : dur <= 0
      ? 'Ora e mbarimit duhet të jetë pas orës së fillimit.'
      : '';

  const toggleLabel = (l: string) =>
    setLabels(prev => (prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l]));

  const unitLabels = { dite: 'ditë', jave: 'javë', muaj: 'muaj' } as const;
  const pickedDayNames = [1, 2, 3, 4, 5, 6, 0].filter(d => recDays.includes(d)).map(d => SQ_DOW[d]);
  // The engine can express "several days EVERY week" (daily + days-of-week) or
  // "one day every N weeks" (weekly + interval) — but not both. The summary must
  // describe what will actually be stored, not what was clicked (it used to show
  // every picked day while only the first one survived).
  const multiDayDropped = rec === 'custom' && recUnit === 'jave' && recInterval > 1 && recDays.length > 1;
  const effectiveDayNames = multiDayDropped ? pickedDayNames.slice(0, 1) : pickedDayNames;
  const recSummary =
    rec === 'weekly' ? 'çdo javë, ditën e zgjedhur'
    : rec === 'monthly' ? 'çdo muaj, në të njëjtën datë'
    : rec === 'custom'
      ? `çdo ${recInterval > 1 ? `${recInterval} ` : ''}${unitLabels[recUnit]}${recUnit === 'jave' && effectiveDayNames.length ? ` (${effectiveDayNames.join(', ')})` : ''}${multiDayDropped ? ' — me interval >1 javë mbahet vetëm dita e parë' : ''}`
      : '';

  const canCreate = title.trim().length > 0;

  const doCreate = async (createAnother: boolean) => {
    if (!canCreate || saving || dur <= 0) return;
    const fd = new FormData();
    fd.set('title', title.trim());
    fd.set('description', desc.trim());
    fd.set('status', 'Todo');
    fd.set('priority', prio);
    fd.set('assignedToUserId', who || currentUserId);
    const start = new Date(selDay);
    start.setHours(timeFrom, 0, 0, 0);
    const end = new Date(selDay);
    end.setHours(timeTo, 0, 0, 0);
    fd.set('startDate', start.toISOString());
    fd.set('endDate', end.toISOString());
    // The chosen time window IS the estimate — that's what feeds the load bars.
    fd.set('estimatedHours', String(dur));
    if (projectId) fd.set('projectId', projectId);
    if (labels.length > 0) fd.set('labels', JSON.stringify(labels));
    if (remind !== '') fd.set('reminderOffsetMinutes', remind);
    if (rec !== 'never') {
      fd.set('isRecurring', 'true');
      if (rec === 'weekly') {
        fd.set('recurringFrequency', 'weekly');
        fd.set('recurringInterval', '1');
        fd.set('recurringDayOfWeek', String(selDay.getDay()));
      } else if (rec === 'monthly') {
        fd.set('recurringFrequency', 'monthly');
        fd.set('recurringInterval', '1');
        fd.set('recurringDayOfMonth', String(selDay.getDate()));
      } else if (recUnit === 'dite') {
        fd.set('recurringFrequency', 'daily');
        fd.set('recurringInterval', String(recInterval));
        fd.set('recurringDaysOfWeek', JSON.stringify([1, 2, 3, 4, 5, 6, 0]));
      } else if (recUnit === 'jave') {
        // Several weekdays every single week map to the daily engine (it carries
        // a days-of-week list); a single day every N weeks is a true weekly series.
        if (recDays.length > 1 && recInterval === 1) {
          fd.set('recurringFrequency', 'daily');
          fd.set('recurringInterval', '1');
          fd.set('recurringDaysOfWeek', JSON.stringify(recDays));
        } else {
          fd.set('recurringFrequency', 'weekly');
          fd.set('recurringInterval', String(recInterval));
          fd.set('recurringDayOfWeek', String(recDays[0] ?? selDay.getDay()));
        }
      } else {
        fd.set('recurringFrequency', 'monthly');
        fd.set('recurringInterval', String(recInterval));
        fd.set('recurringDayOfMonth', String(selDay.getDate()));
      }
      if (recUntil) fd.set('recurringEndDate', recUntil);
    }
    setSaving(true);
    try {
      await Promise.resolve(onSubmit(fd, { createAnother }));
      if (createAnother) {
        setSavedMsg(`"${title.trim()}" u planifikua — ${whoName}, ${dayName} ${fmtH(timeFrom)}–${fmtH(timeTo)}.`);
        setTitle(''); setDesc(''); setLabels([]);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setSavedMsg(''), 3500);
      }
    } finally {
      setSaving(false);
    }
  };

  const dayNames = ['D', 'H', 'M', 'M', 'E', 'P', 'Sh'];
  const prioDefs: Array<[string, string, string]> = [
    ['urgent', 'Urgjent', '#d64545'],
    ['high', 'I lartë', '#e07a3f'],
    ['medium', 'Mesatar', '#d9a021'],
    ['low', 'I ulët', '#94a5bd'],
  ];
  const prioTextColor: Record<string, string> = { urgent: '#b23030', high: '#c25f1e', medium: '#8a6413', low: '#7286a3' };

  const railCls = '-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
  const sectionLabelCls = 'text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground';

  const warnBanner = (text: string) => (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-300/70 bg-amber-50 px-3.5 py-2.5 dark:border-amber-500/30 dark:bg-amber-500/10">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="text-xs font-semibold leading-relaxed text-amber-800 dark:text-amber-300">{text}</span>
    </div>
  );

  const toastBanner = (
    <div className="rounded-xl border border-emerald-300/70 bg-emerald-50 px-3.5 py-2.5 text-xs font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
      ✓ {savedMsg}
    </div>
  );

  const dayCell = (d: Date, i: number, mobile: boolean) => {
    const sel = dayIdx === i;
    const h = bookedByDay[i];
    return (
      <button
        key={i}
        type="button"
        onClick={() => setDayIdx(i)}
        className={`flex flex-col items-center transition-colors hover:border-primary ${
          mobile ? 'min-h-[44px] w-[58px] shrink-0 gap-1 rounded-[14px] border-[1.5px] px-1 pb-2 pt-[9px]' : 'gap-[5px] rounded-[10px] border-[1.5px] px-1 pb-[7px] pt-2'
        } ${sel ? 'border-primary bg-primary/10' : 'border-border bg-background'}`}
      >
        <span className={`${mobile ? 'text-[9.5px]' : 'text-[9px]'} font-extrabold uppercase tracking-wider ${sel ? 'text-primary' : i === 0 ? 'text-primary/80' : 'text-muted-foreground'}`}>
          {i === 0 ? 'Sot' : SQ_DOW[d.getDay()]}
        </span>
        <span className={`${mobile ? 'text-base' : 'text-sm'} font-extrabold tabular-nums ${sel ? 'text-foreground' : 'text-foreground/80'}`}>
          {d.getDate()}
        </span>
        <span className={`block h-1 ${mobile ? 'w-[30px]' : 'w-[26px]'} overflow-hidden rounded-full bg-border/60`}>
          <span className="block h-full" style={{ width: `${Math.min(100, (h / DAY_CAPACITY_H) * 100)}%`, background: loadColorOf(h) }} />
        </span>
        <span className={`text-[9px] font-bold tabular-nums ${h >= DAY_CAPACITY_H ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>{h}h</span>
      </button>
    );
  };

  const capacityBar = (
    <div className="flex items-center gap-2">
      <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-border/60">
        <span
          className="block h-full transition-all duration-200"
          style={{ width: `${Math.min(100, (after / DAY_CAPACITY_H) * 100)}%`, background: afterColor }}
        />
      </span>
      <span className={`whitespace-nowrap text-[11px] font-bold tabular-nums ${over ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
        Pas kësaj: {after}h / {DAY_CAPACITY_H}h
      </span>
    </div>
  );

  const dayPills = (size: 'sm' | 'lg') =>
    [1, 2, 3, 4, 5, 6, 0].map(d => {
      const on = recDays.includes(d);
      return (
        <button
          key={d}
          type="button"
          onClick={() => setRecDays(prev => (on ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => a - b)))}
          className={`${size === 'sm' ? 'h-[26px] w-[28px] rounded-lg text-[10.5px]' : 'h-10 rounded-[10px] text-xs'} border-[1.5px] font-extrabold transition-colors ${
            on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:border-primary/50'
          }`}
        >
          {dayNames[d]}
        </button>
      );
    });

  const customStepper = (compact: boolean) => (
    <>
      <span className={`${compact ? 'text-xs' : 'text-[12.5px]'} font-bold text-muted-foreground`}>çdo</span>
      <button
        type="button"
        onClick={() => setRecInterval(v => Math.max(1, v - 1))}
        className={`${compact ? 'h-[26px] w-[26px] rounded-lg text-[13px]' : 'h-[34px] w-[34px] rounded-[10px] text-[15px]'} border border-border bg-background font-extrabold text-muted-foreground hover:border-primary`}
      >
        −
      </button>
      <span className={`${compact ? 'min-w-[18px] text-[13px]' : 'min-w-[22px] text-[15px]'} text-center font-mono font-bold text-foreground`}>{recInterval}</span>
      <button
        type="button"
        onClick={() => setRecInterval(v => Math.min(30, v + 1))}
        className={`${compact ? 'h-[26px] w-[26px] rounded-lg text-[13px]' : 'h-[34px] w-[34px] rounded-[10px] text-[15px]'} border border-border bg-background font-extrabold text-muted-foreground hover:border-primary`}
      >
        +
      </button>
      <PillSelect
        value={recUnit}
        onChange={e => setRecUnit(e.target.value as 'dite' | 'jave' | 'muaj')}
        wrapClass={compact ? '' : 'flex-1'}
        className={`${compact ? 'rounded-lg py-1 pl-2.5 text-xs' : 'min-h-[34px] rounded-[10px] py-1.5 pl-3 text-[13px]'}`}
      >
        <option value="dite">ditë</option>
        <option value="jave">javë</option>
        <option value="muaj">muaj</option>
      </PillSelect>
    </>
  );

  // Person options for the searchable picker.
  const memberOptions: PickerOption[] = assignableMembers.map((m: any) => ({
    value: m.userId,
    label: memberName(m),
    hint: m.userId === currentUserId ? 'ti' : undefined,
  }));

  // Project options: "Pa projekt" first; archived projects stay selectable
  // (a task may belong to one) but sink to the bottom, marked as such.
  const projectPickOptions: PickerOption[] = [
    { value: '', label: 'Pa projekt' },
    ...sortArchivedLast(projects).map(p => ({ value: p.id, label: projectPickerLabel(p) })),
  ];
  const projectLabelOf = (id: string) => {
    if (!id) return 'Pa projekt';
    const p = projects.find(x => x.id === id);
    return p ? projectPickerLabel(p) : 'Projekti';
  };
  const projectLocked = lockProject && !!defaultProjectId;

  const projectPicker = (buttonClass: string, wrapClass = '') =>
    projectLocked ? (
      <span className={`inline-flex items-center truncate border border-border bg-muted/50 font-bold text-foreground ${buttonClass} ${wrapClass}`}>
        ▣ {projectLabelOf(projectId)}
      </span>
    ) : (
      <SearchPicker
        value={projectId}
        onChange={setProjectId}
        options={projectPickOptions}
        searchPlaceholder="Kërko projektin…"
        buttonLabel={`▣ ${projectLabelOf(projectId)}`}
        emptyText="Asnjë projekt nuk u gjet."
        buttonClass={buttonClass}
        wrapClass={wrapClass}
      />
    );

  // Mobile chip rail, filtered by the search box (shown when the team is big
  // enough that scrolling the rail stops being quick).
  const showWhoSearch = assignableMembers.length > 6;
  const whoNeedle = whoQuery.trim().toLowerCase();

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          doCreate(createMore);
        }
      }}
    >
      {/* ═══ MOBILE — bottom sheet ═══ */}
      <div className="flex min-h-0 flex-col sm:hidden">
        <div className="flex justify-center pb-0.5 pt-2">
          <span className="h-[5px] w-[38px] rounded-full bg-border" />
        </div>
        <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1">
          <DialogClose className="p-2 text-sm font-bold text-muted-foreground">Anulo</DialogClose>
          <span className="text-sm font-extrabold text-foreground">Detyrë e re</span>
          <button
            type="button"
            onClick={() => doCreate(false)}
            className={`p-2 text-sm font-extrabold ${canCreate ? 'text-primary' : 'text-muted-foreground/40'}`}
          >
            Krijo
          </button>
        </div>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Çfarë duhet bërë?"
              className="w-full border-none bg-transparent py-1 text-[19px] font-extrabold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50"
            />
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={2}
              placeholder="Përshkrimi… (opsionale)"
              className="w-full resize-none border-0 border-b border-border bg-transparent pb-2 text-[13.5px] font-medium leading-relaxed text-muted-foreground outline-none placeholder:text-muted-foreground/50"
            />
          </div>

          <div>
            <div className={`${sectionLabelCls} mb-2`}>Personi</div>
            {showWhoSearch && (
              <div className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={whoQuery}
                  onChange={e => setWhoQuery(e.target.value)}
                  placeholder="Kërko anëtarin…"
                  className="w-full bg-transparent text-[13px] font-semibold text-foreground outline-none placeholder:text-muted-foreground/60"
                />
              </div>
            )}
            <div className={railCls}>
              {assignableMembers.map((m: any, i: number) => {
                const name = memberName(m);
                // The selected person always stays visible so the choice is never hidden.
                if (whoNeedle && who !== m.userId && !name.toLowerCase().includes(whoNeedle)) return null;
                const on = who === m.userId;
                const [avBg, avFg] = QUICK_AVATAR_COLORS[i % QUICK_AVATAR_COLORS.length];
                return (
                  <button
                    key={m.userId}
                    type="button"
                    onClick={() => setWho(m.userId)}
                    className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border-[1.5px] py-1.5 pl-1.5 pr-3.5 text-[13px] font-bold transition-colors ${
                      on ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground'
                    }`}
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold"
                      style={{ background: avBg, color: avFg }}
                    >
                      {name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
                    </span>
                    {name.split(' ')[0]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className={sectionLabelCls}>Kur — {whoFirst}</span>
              <span className="text-[10.5px] font-bold text-muted-foreground/60">{DAY_CAPACITY_H}h kapacitet/ditë</span>
            </div>
            <div className={railCls}>{days.slice(0, 8).map((d, i) => dayCell(d, i, true))}</div>
          </div>

          <div>
            <div className={`${sectionLabelCls} mb-2`}>Ora</div>
            <div className={railCls}>
              {QUICK_SLOTS.map(([a, b], i) => {
                const sel = timeFrom === a && timeTo === b;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setTimeFrom(a); setTimeTo(b); }}
                    className={`min-h-[44px] shrink-0 whitespace-nowrap rounded-xl border-[1.5px] px-3.5 font-mono text-xs font-bold transition-colors ${
                      sel ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground'
                    }`}
                  >
                    {fmtH(a)}–{fmtH(b)} · {b - a}h
                  </button>
                );
              })}
            </div>
            <div className="mt-2.5">{capacityBar}</div>
            {over && (
              <div className="mt-2.5">
                {warnBanner(`${whoFirst === 'Ti' ? 'Ti del' : `${whoFirst} del`} mbi kapacitet ${dayName} (${after}h nga ${DAY_CAPACITY_H}h). Zgjidh ditë a orar tjetër.`)}
              </div>
            )}
          </div>

          <div>
            <div className={`${sectionLabelCls} mb-2`}>Prioriteti</div>
            <div className="grid grid-cols-4 gap-[7px]">
              {prioDefs.map(([id, label, dot]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPrio(id)}
                  className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border-[1.5px] px-1 text-xs font-bold transition-colors ${
                    prio === id ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground'
                  }`}
                >
                  <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: dot }} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className={`${sectionLabelCls} mb-2`}>Përsëritet</div>
            <div className="grid grid-cols-4 gap-[7px]">
              {([['never', 'Jo'], ['weekly', 'Çdo javë'], ['monthly', 'Çdo muaj'], ['custom', 'Tjetër…']] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setRec(id)}
                  className={`min-h-[44px] rounded-xl border-[1.5px] px-0.5 text-[11.5px] font-bold transition-colors ${
                    rec === id ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {rec === 'custom' && (
              <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                {customStepper(false)}
              </div>
            )}
            {rec === 'custom' && recUnit === 'jave' && (
              <div className="mt-2 grid grid-cols-7 gap-1.5">{dayPills('lg')}</div>
            )}
            {rec !== 'never' && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11.5px] font-semibold text-muted-foreground">Përsërit deri</span>
                <input
                  type="date"
                  value={recUntil}
                  onChange={e => setRecUntil(e.target.value)}
                  className="h-9 rounded-lg border border-border bg-background px-2 text-xs"
                />
                {recUntil && (
                  <button type="button" onClick={() => setRecUntil('')} className="text-xs font-bold text-muted-foreground hover:text-foreground">✕</button>
                )}
              </div>
            )}
            {recSummary && (
              <div className="mt-2 text-[11.5px] font-semibold text-muted-foreground">{recSummary}</div>
            )}
          </div>

          <div>
            <div className={`${sectionLabelCls} mb-2`}>Kujtesë</div>
            <div className="grid grid-cols-5 gap-[7px]">
              {[{ key: 'none', minutes: '', label: 'Jo' }, ...REMINDER_PRESETS.map(p => ({ key: p.key, minutes: String(p.minutes), label: p.label }))].map(o => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setRemind(o.minutes)}
                  className={`min-h-[44px] rounded-xl border-[1.5px] px-0.5 text-[11.5px] font-bold transition-colors ${
                    remind === o.minutes ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {remind !== '' && (
              <div className="mt-2 text-[11.5px] font-semibold text-muted-foreground">
                Njoftim në telefon dhe në web {Number(remind) === 0 ? 'në orën e mbarimit' : `${REMINDER_PRESETS.find(p => String(p.minutes) === remind)?.label.toLowerCase()} mbarimit`} ({fmtH(timeTo)} {dayName}).
              </div>
            )}
          </div>

          <div className="pb-1">
            <div className={`${sectionLabelCls} mb-2`}>Projekti</div>
            {projectPicker('min-h-[44px] w-full rounded-xl py-2.5 pl-3.5 text-[13px]')}
          </div>
        </div>
        <div className="border-t bg-muted/30 px-4 pb-4 pt-2.5">
          {savedMsg && <div className="mb-2.5">{toastBanner}</div>}
          <button
            type="button"
            disabled={!canCreate || saving}
            onClick={() => doCreate(false)}
            className={`min-h-[50px] w-full rounded-[14px] text-[15px] font-extrabold text-white transition-colors ${
              canCreate && !saving ? 'bg-primary shadow-lg shadow-primary/30' : 'cursor-default bg-muted-foreground/40'
            }`}
          >
            {canCreate ? 'Krijo detyrën' : 'Shkruaj titullin për të vazhduar'}
          </button>
        </div>
      </div>

      {/* ═══ DESKTOP — wide planner dialog ═══ */}
      <div className="hidden min-h-0 flex-col overflow-y-auto sm:flex">
        <div className="flex items-center gap-2 border-b bg-muted/30 px-5 py-3">
          <span className="rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] font-extrabold text-foreground">FivoCRM</span>
          <span className="text-xs font-semibold text-muted-foreground">Detyrat</span>
          <span className="text-xs text-muted-foreground/50">›</span>
          <span className="text-xs font-bold text-foreground">Detyrë e re</span>
          <span className="ml-auto rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">esc</span>
          <DialogClose className="px-1 text-[15px] leading-none text-muted-foreground transition-colors hover:text-red-600">✕</DialogClose>
        </div>

        <div className="px-6 pt-4">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
            placeholder="Titulli i detyrës"
            className="w-full border-none bg-transparent pb-1.5 pt-0.5 text-[19px] font-extrabold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            rows={2}
            placeholder="Përshkrimi — konteksti, linqet, kriteret e pranimit… (opsionale)"
            className="w-full resize-none border-none bg-transparent pb-2.5 text-[13px] font-medium leading-relaxed text-muted-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <div className="flex flex-wrap items-center gap-2 border-t pb-4 pt-2.5">
            <SearchPicker
              value={who}
              onChange={setWho}
              options={memberOptions}
              searchPlaceholder="Kërko anëtarin…"
              buttonLabel={`◉ ${whoName}${who === currentUserId ? ' (ti)' : ''}`}
              emptyText="Asnjë anëtar nuk u gjet."
              disabled={!canAssignTasks}
              buttonClass="rounded-lg py-1.5 pl-3 text-xs"
              wrapClass="max-w-[200px]"
            />
            <PillSelect
              value={prio}
              onChange={e => setPrio(e.target.value)}
              className="rounded-lg py-1.5 pl-3 text-xs"
              style={{ color: prioTextColor[prio] }}
            >
              {prioDefs.map(([id, label]) => (
                <option key={id} value={id}>⚑ {label}</option>
              ))}
            </PillSelect>
            {projectPicker('rounded-lg py-1.5 pl-3 text-xs', 'max-w-[220px]')}
            {allLabels.map(l => {
              const on = labels.includes(l);
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() => toggleLabel(l)}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11.5px] font-bold transition-colors hover:border-primary ${
                    on ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground'
                  }`}
                >
                  {on ? `✓ ${l}` : `# ${l}`}
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t bg-muted/30 px-6 pb-4 pt-4">
          <div className="flex items-baseline justify-between">
            <span className={sectionLabelCls}>Planifikimi — {whoName}</span>
            <span className="text-[11px] font-semibold text-muted-foreground/70">Kapaciteti ditor: {DAY_CAPACITY_H} orë</span>
          </div>
          <div className="mt-3 grid grid-cols-10 gap-1.5">{days.map((d, i) => dayCell(d, i, false))}</div>

          <div className="mt-3.5 flex flex-wrap items-center gap-3.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-muted-foreground">Ora</span>
              <PillSelect
                value={String(timeFrom)}
                onChange={e => setTimeFrom(Number(e.target.value))}
                className="rounded-lg py-1.5 pl-2.5 font-mono text-xs"
              >
                {[9, 10, 11, 12, 13, 14, 15, 16].map(h => (
                  <option key={h} value={h}>{fmtH(h)}</option>
                ))}
              </PillSelect>
              <span className="text-xs font-bold text-muted-foreground/60">–</span>
              <PillSelect
                value={String(timeTo)}
                onChange={e => setTimeTo(Number(e.target.value))}
                className="rounded-lg py-1.5 pl-2.5 font-mono text-xs"
              >
                {[10, 11, 12, 13, 14, 15, 16, 17, 18].map(h => (
                  <option key={h} value={h}>{fmtH(h)}</option>
                ))}
              </PillSelect>
              <span className="font-mono text-[11px] font-bold text-muted-foreground">({dur} orë)</span>
            </div>
            <div className="min-w-[200px] flex-1">{capacityBar}</div>
          </div>

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <span className="mr-0.5 text-xs font-bold text-muted-foreground">Përsëritet</span>
            {([['never', 'Jo'], ['weekly', 'Çdo javë'], ['monthly', 'Çdo muaj'], ['custom', 'E personalizuar']] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setRec(id)}
                className={`rounded-lg border-[1.5px] px-3 py-1.5 text-xs font-bold transition-colors hover:border-primary ${
                  rec === id ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground'
                }`}
              >
                {label}
              </button>
            ))}
            {rec === 'custom' && (
              <div className="ml-0.5 flex items-center gap-1.5 border-l pl-3">{customStepper(true)}</div>
            )}
            {rec === 'custom' && recUnit === 'jave' && (
              <div className="flex items-center gap-1">{dayPills('sm')}</div>
            )}
            {rec !== 'never' && (
              <span className="ml-0.5 flex items-center gap-1.5 border-l pl-3">
                <span className="text-xs font-bold text-muted-foreground">deri</span>
                <input
                  type="date"
                  value={recUntil}
                  onChange={e => setRecUntil(e.target.value)}
                  className="h-7 rounded-lg border border-border bg-background px-1.5 text-[11px]"
                />
                {recUntil && (
                  <button type="button" onClick={() => setRecUntil('')} className="text-xs font-bold text-muted-foreground hover:text-foreground">✕</button>
                )}
              </span>
            )}
            {recSummary && (
              <span className="text-[11.5px] font-semibold text-muted-foreground/80">→ {recSummary}</span>
            )}
          </div>

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <span className="mr-0.5 text-xs font-bold text-muted-foreground">Kujtesë</span>
            {[{ key: 'none', minutes: '', label: 'Jo' }, ...REMINDER_PRESETS.map(p => ({ key: p.key, minutes: String(p.minutes), label: p.label }))].map(o => (
              <button
                key={o.key}
                type="button"
                onClick={() => setRemind(o.minutes)}
                title={o.minutes === '' ? 'Pa kujtesë' : 'Njoftim në telefon dhe në web'}
                className={`rounded-lg border-[1.5px] px-3 py-1.5 text-xs font-bold transition-colors hover:border-primary ${
                  remind === o.minutes ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {warn && <div className="mt-3">{warnBanner(warn)}</div>}
        </div>

        {savedMsg && <div className="px-6 pt-3">{toastBanner}</div>}

        <div className="mt-3.5 flex items-center gap-3.5 border-t px-6 py-3.5">
          <button type="button" onClick={() => setCreateMore(!createMore)} className="flex items-center gap-2">
            <span className={`relative inline-block h-[17px] w-[30px] rounded-full transition-colors ${createMore ? 'bg-primary' : 'bg-border'}`}>
              <span
                className={`absolute top-[2px] h-[13px] w-[13px] rounded-full bg-white shadow transition-all ${createMore ? 'left-[15px]' : 'left-[2px]'}`}
              />
            </span>
            <span className="text-xs font-bold text-muted-foreground">Krijo të tjera pas kësaj</span>
          </button>
          <span className="ml-auto font-mono text-[10px] font-bold text-muted-foreground">⌘⏎</span>
          <Button
            type="button"
            size="sm"
            disabled={!canCreate || saving || dur <= 0}
            onClick={() => doCreate(createMore)}
            className="rounded-[9px] text-[13px] font-bold"
          >
            Krijo detyrën
          </Button>
        </div>
      </div>
    </div>
  );
};

/** DialogContent className for the quick form: wide planner on desktop, bottom
 * sheet on mobile. Shared so both mounts (TasksView, ProjectDetailView) render
 * the dialog identically. The built-in ✕ is hidden because each layout brings
 * its own close control (breadcrumb ✕ on desktop, "Anulo" on mobile). */
export const QUICK_TASK_DIALOG_CLASS =
  'flex max-w-[780px] flex-col gap-0 overflow-hidden rounded-2xl p-0 max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:w-full max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-[22px] max-sm:border-b-0 max-h-[92dvh] [&>button.absolute]:hidden';

export default QuickTaskForm;
