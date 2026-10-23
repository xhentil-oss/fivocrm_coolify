import React, { useMemo, useState } from 'react';
import { Link2, X } from 'lucide-react';
import { wouldCreateDependencyCycle } from '../../../lib/taskDependencies';
import { toast } from '../../../hooks/use-toast';
import { Input } from '../../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import type { Task } from '../../../types';
import { IconTile, SheetRow, rowBodyCls } from './panelShared';

interface TaskDependenciesSectionProps {
  task: Task;
  readOnly: boolean;
  allTasks?: Task[];
  onUpdate: (id: string, data: any) => Promise<any>;
  open: boolean;
  onToggle: () => void;
}

/** "Bllokohet nga" row (Organizimi card) — blocker chips + the blocker picker.
 *  Always mounted (renders nothing when hidden) so the picker's search
 *  survives as before. */
const TaskDependenciesSection: React.FC<TaskDependenciesSectionProps> = ({ task, readOnly, allTasks, onUpdate, open, onToggle }) => {
  const [blockerSearch, setBlockerSearch] = useState('');
  const taskById = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of allTasks || []) if (!map.has(t.id)) map.set(t.id, t);
    return map;
  }, [allTasks]);

  if (!(!readOnly || (task.dependsOn && task.dependsOn.length > 0))) return null;

  const deps = task.dependsOn || [];
  const openBlockers = deps.filter(id => (allTasks ? taskById.get(id)?.status : undefined) !== 'Done').length;
  const candidates = (allTasks || [])
    .filter((t) => t.id !== task.id && !deps.includes(t.id) && (!blockerSearch.trim() || t.title.toLowerCase().includes(blockerSearch.toLowerCase())));

  const valueText = deps.length === 0
    ? 'Asnjë'
    : deps.length === 1
      ? (taskById.get(deps[0])?.title || deps[0].slice(0, 8) + '…')
      : `${deps.length} detyra${openBlockers > 0 ? ` · ${openBlockers} hapur` : ''}`;

  return (
    <>
      <SheetRow
        tile={<IconTile tone={openBlockers > 0 ? 'warning' : 'neutral'}><Link2 className="h-[17px] w-[17px]" strokeWidth={2} /></IconTile>}
        label="Bllokohet nga"
        value={valueText}
        valueClassName={`text-[15px] ${deps.length > 0 ? (openBlockers > 0 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-foreground/80') : 'text-muted-foreground'}`}
        open={open}
        onToggle={onToggle}
        disabled={readOnly && deps.length === 0}
      />
      {open && (
        <div className={`${rowBodyCls} flex-col items-stretch`} onClick={(e) => e.stopPropagation()}>
          {deps.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {deps.map((depId) => {
                const dep = allTasks ? taskById.get(depId) : undefined;
                const isDone = dep?.status === 'Done';
                return (
                  <span
                    key={depId}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold ${
                      isDone
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300'
                    }`}
                  >
                    {isDone ? '✓' : '🔒'}
                    <span className="max-w-[180px] truncate">{dep?.title || depId.slice(0, 8) + '…'}</span>
                    {!readOnly && (
                      <button type="button" onClick={() => onUpdate(task.id, { dependsOn: deps.filter((x) => x !== depId) } as any)} className="hover:opacity-70" aria-label="Hiq bllokuesin">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          )}
          {!readOnly && (
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="h-10 w-full rounded-full border-[1.5px] border-dashed border-border bg-transparent text-[14px] font-bold text-primary transition-colors hover:border-primary">
                  + Zgjidh detyrën bllokuese
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2" align="start">
                <Input value={blockerSearch} onChange={(e) => setBlockerSearch(e.target.value)} placeholder="Kërko detyrë…" className="mb-2 h-8 text-sm" />
                <div className="max-h-52 space-y-0.5 overflow-y-auto">
                  {candidates
                    .slice(0, 25)
                    .map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          // A blocker that already waits (directly or through a chain)
                          // on THIS task would lock both forever — completeTask's
                          // blocker guard refuses either side.
                          if (wouldCreateDependencyCycle(task.id, t.id, allTasks)) {
                            toast({ title: 'Varësi rrethore', description: `"${t.title}" pret tashmë këtë detyrë — nuk mund ta bllokojë.`, variant: 'destructive' });
                            return;
                          }
                          onUpdate(task.id, { dependsOn: [...deps, t.id] } as any);
                          setBlockerSearch('');
                        }}
                        className="w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                      >
                        {t.title}
                      </button>
                    ))}
                  {candidates.length === 0 && (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">Asnjë detyrë.</p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          )}
          <div className="text-[13px] text-muted-foreground">Kjo detyrë nuk mund të përfundohet para detyrës që e bllokon.</div>
        </div>
      )}
    </>
  );
};

export default TaskDependenciesSection;
