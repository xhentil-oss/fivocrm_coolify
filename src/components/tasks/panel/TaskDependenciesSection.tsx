import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { wouldCreateDependencyCycle } from '../../../lib/taskDependencies';
import { toast } from '../../../hooks/use-toast';
import { Input } from '../../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import type { Task } from '../../../types';
import { rowCls, rowLabelCls } from './panelShared';

interface TaskDependenciesSectionProps {
  task: Task;
  readOnly: boolean;
  allTasks?: Task[];
  onUpdate: (id: string, data: any) => Promise<any>;
}

/** "Bllokohet nga" row — blocker chips + the blocker picker. Always mounted
 *  (renders nothing when hidden) so the picker's search survives as before. */
const TaskDependenciesSection: React.FC<TaskDependenciesSectionProps> = ({ task, readOnly, allTasks, onUpdate }) => {
  const [blockerSearch, setBlockerSearch] = useState('');
  const taskById = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of allTasks || []) if (!map.has(t.id)) map.set(t.id, t);
    return map;
  }, [allTasks]);

  if (!(!readOnly || (task.dependsOn && task.dependsOn.length > 0))) return null;

  const candidates = (allTasks || [])
    .filter((t) => t.id !== task.id && !(task.dependsOn || []).includes(t.id) && (!blockerSearch.trim() || t.title.toLowerCase().includes(blockerSearch.toLowerCase())));

  return (
    <div className={`${rowCls} items-start`}>
      <span className={`${rowLabelCls} pt-1`}>Bllokohet nga</span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {(task.dependsOn || []).map((depId) => {
            const dep = allTasks ? taskById.get(depId) : undefined;
            const isDone = dep?.status === 'Done';
            return (
              <span
                key={depId}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  isDone
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'border-orange-200 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300'
                }`}
              >
                {isDone ? '✓' : '🔒'}
                <span className="max-w-[160px] truncate">{dep?.title || depId.slice(0, 8) + '…'}</span>
                {!readOnly && (
                  <button type="button" onClick={() => onUpdate(task.id, { dependsOn: (task.dependsOn || []).filter((x) => x !== depId) } as any)} className="hover:opacity-70" aria-label="Hiq bllokuesin">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            );
          })}
          {!readOnly && (
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="rounded-full border-[1.5px] border-dashed border-border bg-background px-3 py-[5px] text-xs font-semibold text-muted-foreground transition-colors hover:border-primary">
                  ⛓ + Zgjidh detyrën bllokuese
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
                          onUpdate(task.id, { dependsOn: [...(task.dependsOn || []), t.id] } as any);
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
        </div>
        <span className="text-[11px] text-muted-foreground">S'mund të përfundohet para varësisë</span>
      </div>
    </div>
  );
};

export default TaskDependenciesSection;
