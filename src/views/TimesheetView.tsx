import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Lock, Plus, Trash2, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useToast } from '../hooks/use-toast';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import TimeLogDialog from '../components/time/TimeLogDialog';
import type { Customer, FinanceMonthClose, Project, Task, TeamMember, TimeEntry } from '../types';
import { cn } from '../lib/utils';
import {
  dayKeyOf, dayKeyToNoon, entryDayKey, entryHours, entryIsOpen, isDayLocked, lockedMonthSet,
} from '../lib/finance/timeEntries';
import { RECURRENCE_TIMEZONE, toZoned } from '../lib/recurringUtils';

/**
 * Orët (Timesheet) — my week, or the team's week for a manager.
 *
 * Rows = projects (client · project), columns = the 7 days, cell = hours. A click
 * on a cell opens "Regjistro orë" for that day and project. Days inside a closed
 * month show a lock and refuse edits (the rules refuse them too). The manager
 * view lists people instead of projects and marks working days with no hours —
 * the timesheet gap the month close will complain about.
 *
 * Reads are pushed to the server (`teamScopedWhere`) so a week never downloads
 * the tenant's whole history: indexes (businessId, userId, date) and (businessId, date).
 */

const DAY_LABELS = ['Hën', 'Mar', 'Mër', 'Enj', 'Pre', 'Sht', 'Die'];

function weekStartOf(d: Date): Date {
  // Monday in the business zone.
  const z = toZoned(d, RECURRENCE_TIMEZONE);
  const dow = (z.getUTCDay() + 6) % 7; // Mon = 0
  const monday = new Date(Date.UTC(z.getUTCFullYear(), z.getUTCMonth(), z.getUTCDate() - dow, 12));
  return monday; // a zoned-noon "calendar" date; only its Y/M/D are read below
}
function addDays(zonedNoon: Date, n: number): Date {
  return new Date(Date.UTC(zonedNoon.getUTCFullYear(), zonedNoon.getUTCMonth(), zonedNoon.getUTCDate() + n, 12));
}
const keyOfZoned = (z: Date) => `${z.getUTCFullYear()}-${String(z.getUTCMonth() + 1).padStart(2, '0')}-${String(z.getUTCDate()).padStart(2, '0')}`;
const fmt1 = (h: number) => (h === 0 ? '' : (Math.round(h * 10) / 10).toString().replace('.', ','));

const TimesheetView: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const { toast } = useToast();
  const canSeeTeam = !!(permissions.isAdmin || permissions.isManager || permissions.isOwner || permissions.isSuperAdmin);
  const [teamMode, setTeamMode] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [log, setLog] = useState<{ open: boolean; date?: string; projectId?: string; forUserId?: string }>({ open: false });
  const [focusUser, setFocusUser] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);
  const weekStart = useMemo(() => addDays(weekStartOf(today), weekOffset * 7), [today, weekOffset]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => keyOfZoned(addDays(weekStart, i))), [weekStart]);
  const todayKey = dayKeyOf(today);
  const showTeam = teamMode && canSeeTeam;

  const { data: entries, loading } = useCollection<TimeEntry>('timeEntries', {
    where: [
      ...(showTeam ? [] : [{ field: 'userId', operator: '==', value: focusUser || user?.uid || '__never__' }]),
      { field: 'date', operator: '>=', value: days[0] },
      { field: 'date', operator: '<=', value: days[6] },
    ],
    teamScopedWhere: true,
    skip: !user,
  });
  const { data: projects } = useCollection<Project>('projects', { skipTeamFilter: true });
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  const { data: tasks } = useCollection<Task>('tasks', { skipTeamFilter: true });
  const { data: members } = useCollection<TeamMember>('teamMembers', { skipTeamFilter: true });
  const { data: closes } = useCollection<FinanceMonthClose>('financeMonthCloses', { skipTeamFilter: true });
  const locked = useMemo(() => lockedMonthSet(closes), [closes]);
  const timeEntryMutation = useMutation<TimeEntry>('timeEntries');

  const projectById = useMemo(() => new Map((projects || []).map(p => [p.id, p])), [projects]);
  const customerName = useMemo(() => new Map((customers || []).map(c => [c.id, c.name || c.company || 'Klient'])), [customers]);
  const memberName = useMemo(() => new Map((members || []).map(m => [m.userId, m.displayName || m.email || 'Pa emër'])), [members]);

  const closedEntries = useMemo(() => (entries || []).filter(e => !entryIsOpen(e) && entryHours(e) > 0), [entries]);

  // ── My week: project rows × days ──
  const myGrid = useMemo(() => {
    const rows = new Map<string, { key: string; label: string; sub?: string; cells: number[]; total: number }>();
    for (const e of closedEntries) {
      const day = entryDayKey(e);
      const col = day ? days.indexOf(day) : -1;
      if (col < 0) continue;
      const key = e.projectId || '__internal__';
      let row = rows.get(key);
      if (!row) {
        const p = e.projectId ? projectById.get(e.projectId) : undefined;
        row = {
          key,
          label: p ? p.name : (e.projectId ? 'Projekt i fshirë' : 'Punë e brendshme'),
          sub: p?.customerId ? customerName.get(p.customerId) : undefined,
          cells: [0, 0, 0, 0, 0, 0, 0], total: 0,
        };
        rows.set(key, row);
      }
      const h = entryHours(e);
      row.cells[col] += h; row.total += h;
    }
    const list = Array.from(rows.values()).sort((a, b) => b.total - a.total);
    const dayTotals = days.map((_, i) => list.reduce((s, r) => s + r.cells[i], 0));
    return { rows: list, dayTotals, total: dayTotals.reduce((s, x) => s + x, 0) };
  }, [closedEntries, days, projectById, customerName]);

  // ── Team week: person rows × days ──
  const teamGrid = useMemo(() => {
    if (!showTeam) return null;
    const active = (members || []).filter(m => m.status === 'Active' && m.userId);
    const rows = active.map(m => ({ key: m.userId, label: memberName.get(m.userId) || m.userId, cells: [0, 0, 0, 0, 0, 0, 0], total: 0, missing: 0 }));
    const byUid = new Map(rows.map(r => [r.key, r]));
    for (const e of closedEntries) {
      const day = entryDayKey(e);
      const col = day ? days.indexOf(day) : -1;
      const row = byUid.get(e.userId);
      if (col < 0 || !row) continue;
      const h = entryHours(e);
      row.cells[col] += h; row.total += h;
    }
    for (const r of rows) {
      r.missing = days.filter((d, i) => i < 5 && d < todayKey && r.cells[i] === 0).length;
    }
    rows.sort((a, b) => b.missing - a.missing || a.label.localeCompare(b.label));
    return rows;
  }, [showTeam, members, memberName, closedEntries, days, todayKey]);

  const removeEntry = async (e: TimeEntry) => {
    const day = entryDayKey(e) || '';
    if (isDayLocked(day, locked)) { toast({ title: 'Muaj i mbyllur', variant: 'destructive' }); return; }
    try { await timeEntryMutation.remove(e.id); } catch (err: any) { toast({ title: 'Nuk u fshi', description: err?.message, variant: 'destructive' }); }
  };

  const [dayDetail, setDayDetail] = useState<string | null>(null);
  const detailEntries = useMemo(
    () => closedEntries.filter(e => entryDayKey(e) === dayDetail).sort((a, b) => entryHours(b) - entryHours(a)),
    [closedEntries, dayDetail],
  );

  const weekLabel = `${days[0].slice(8)}.${days[0].slice(5, 7)} – ${days[6].slice(8)}.${days[6].slice(5, 7)}.${days[6].slice(0, 4)}`;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground"><Clock className="h-5 w-5" /> Orët {showTeam ? 'e ekipit' : 'e mia'}</h1>
          <p className="text-sm text-muted-foreground">Klient → projekt → orë. Këto orë janë kosto reale në Financat → Fitimi (tabela e klientëve).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSeeTeam && (
            <Button variant={teamMode ? 'default' : 'outline'} size="sm" onClick={() => { setTeamMode(v => !v); setFocusUser(null); }}>
              <Users className="mr-1.5 h-4 w-4" /> Ekipi
            </Button>
          )}
          <Button size="sm" onClick={() => setLog({ open: true, date: todayKey, forUserId: focusUser || undefined })}>
            <Plus className="mr-1.5 h-4 w-4" /> Regjistro orë
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2">
        <Button variant="ghost" size="sm" onClick={() => setWeekOffset(o => o - 1)} aria-label="Java e kaluar"><ChevronLeft className="h-4 w-4" /></Button>
        <div className="text-sm font-semibold">
          Java {weekLabel}
          {weekOffset !== 0 && <button type="button" className="ml-2 text-xs text-primary underline" onClick={() => setWeekOffset(0)}>sot</button>}
          {focusUser && <Badge variant="secondary" className="ml-2">{memberName.get(focusUser)} <button type="button" className="ml-1" onClick={() => setFocusUser(null)}>×</button></Badge>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setWeekOffset(o => o + 1)} aria-label="Java tjetër" disabled={weekOffset >= 0}><ChevronRight className="h-4 w-4" /></Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 text-left">{showTeam ? 'Personi' : 'Projekti'}</th>
              {days.map((d, i) => (
                <th key={d} className={cn('px-2 py-2 text-right font-semibold', d === todayKey && 'text-primary', i >= 5 && 'text-muted-foreground/70')}>
                  <button type="button" onClick={() => setDayDetail(d === dayDetail ? null : d)} className="hover:underline">
                    {DAY_LABELS[i]} <span className="font-mono">{d.slice(8)}</span>
                  </button>
                  {isDayLocked(d, locked) && <Lock className="ml-1 inline h-3 w-3" />}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Σ</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Duke ngarkuar…</td></tr>}
            {!loading && !showTeam && myGrid.rows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Asnjë orë këtë javë. Shto orë nga raporti ditor, timer-i i detyrës ose butoni lart.</td></tr>
            )}
            {!showTeam && myGrid.rows.map(r => (
              <tr key={r.key} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2">
                  <div className="font-medium">{r.label}</div>
                  {r.sub && <div className="text-xs text-muted-foreground">{r.sub}</div>}
                </td>
                {r.cells.map((h, i) => {
                  const lockedDay = isDayLocked(days[i], locked);
                  return (
                    <td key={i} className="px-1 py-1 text-right">
                      <button
                        type="button"
                        disabled={lockedDay}
                        onClick={() => setLog({ open: true, date: days[i], projectId: r.key === '__internal__' ? undefined : r.key, forUserId: focusUser || undefined })}
                        className={cn('w-full rounded-md px-2 py-1 font-mono tabular-nums', h > 0 ? 'bg-primary/5 text-foreground' : 'text-muted-foreground/40', !lockedDay && 'hover:bg-primary/10')}
                        title={lockedDay ? 'Muaj i mbyllur' : 'Shto orë'}
                      >
                        {fmt1(h) || '·'}
                      </button>
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{fmt1(r.total) || '0'}</td>
              </tr>
            ))}
            {showTeam && teamGrid && teamGrid.map(r => (
              <tr key={r.key} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2">
                  <button type="button" className="font-medium hover:underline" onClick={() => { setTeamMode(false); setFocusUser(r.key); }}>{r.label}</button>
                  {r.missing > 0 && <div className="text-[11px] font-semibold text-red-600">{r.missing} ditë pune pa orë</div>}
                </td>
                {r.cells.map((h, i) => {
                  const workday = i < 5 && days[i] < todayKey;
                  return (
                    <td key={i} className={cn('px-2 py-2 text-right font-mono tabular-nums', h === 0 && workday && 'text-red-500', h === 0 && !workday && 'text-muted-foreground/40')}>
                      {fmt1(h) || (workday ? '—' : '·')}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{fmt1(r.total) || '0'}</td>
              </tr>
            ))}
          </tbody>
          {!showTeam && myGrid.rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-border bg-muted/40 text-xs font-semibold">
                <td className="px-3 py-2">Gjithsej</td>
                {myGrid.dayTotals.map((h, i) => <td key={i} className="px-2 py-2 text-right font-mono tabular-nums">{fmt1(h) || '·'}</td>)}
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt1(myGrid.total) || '0'}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {dayDetail && (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Regjistrimet e {dayDetail.split('-').reverse().join('.')}</h2>
            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setDayDetail(null)}>Mbyll</button>
          </div>
          {detailEntries.length === 0 && <p className="text-sm text-muted-foreground">Asnjë regjistrim këtë ditë.</p>}
          <ul className="divide-y divide-border/60">
            {detailEntries.map(e => {
              const p = e.projectId ? projectById.get(e.projectId) : undefined;
              const own = e.userId === user?.uid;
              return (
                <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-14 shrink-0 font-mono font-semibold tabular-nums">{fmt1(entryHours(e))}h</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{p ? p.name : 'Punë e brendshme'}</span>
                    {p?.customerId && <span className="text-muted-foreground"> · {customerName.get(p.customerId)}</span>}
                    {showTeam && <span className="text-muted-foreground"> · {memberName.get(e.userId)}</span>}
                    {e.description && <span className="block truncate text-xs text-muted-foreground">{e.description}</span>}
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">{e.source || 'timer'}</Badge>
                  {(own || canSeeTeam) && !isDayLocked(dayDetail, locked) && (
                    <button type="button" onClick={() => removeEntry(e)} className="text-muted-foreground hover:text-red-600" aria-label="Fshi"><Trash2 className="h-4 w-4" /></button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <TimeLogDialog
        open={log.open}
        onClose={() => setLog({ open: false })}
        projects={projects}
        tasks={tasks}
        customers={customers}
        members={members}
        lockedMonths={locked}
        defaultDate={log.date}
        defaultProjectId={log.projectId}
        forUserId={log.forUserId}
      />
      {/* The noon helper is what every writer uses for the stored instant. */}
      <span className="hidden">{dayKeyToNoon(todayKey)?.toISOString()}</span>
    </div>
  );
};

export default TimesheetView;
