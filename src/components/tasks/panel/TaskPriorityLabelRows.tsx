import React, { useMemo, useState } from 'react';
import { Flag, Tag, X } from 'lucide-react';
import { labelColor } from '../../TaskLabels';
import type { Task } from '../../../types';
import { IconTile } from './panelShared';

const PRIORITIES = [['low', 'I ulët'], ['medium', 'Mesatar'], ['high', 'I lartë'], ['urgent', 'Urgjent']] as const;

/** "Prioriteti" segmented control (Organizimi card). Selected = raised white
 *  segment; a selected "Urgjent" fills red. */
export const TaskPriorityRow: React.FC<{
  task: Task;
  readOnly: boolean;
  onUpdate: (id: string, data: any) => Promise<any>;
}> = ({ task, readOnly, onUpdate }) => {
  const current = task.priority || 'medium';
  return (
    <div className="flex flex-col gap-2.5 px-4 pb-3.5 pt-3">
      <div className="grid grid-cols-[30px_1fr] items-center gap-3">
        <IconTile tone="brand"><Flag className="h-[17px] w-[17px]" strokeWidth={2} /></IconTile>
        <span className="text-[16px] font-semibold text-foreground">Prioriteti</span>
      </div>
      <div className="grid grid-cols-4 gap-0.5 rounded-full bg-muted p-[3px]" role="radiogroup" aria-label="Prioriteti">
        {PRIORITIES.map(([k, l]) => {
          const on = current === k;
          const urgent = k === 'urgent';
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={readOnly}
              // Compare with the DOCUMENT's value, not the defaulted one: a task
              // with no `priority` shows "Mesatar" lit, and tapping it must
              // still write `medium`.
              onClick={() => task.priority !== k && onUpdate(task.id, { priority: k })}
              className={`h-9 min-w-0 truncate rounded-full px-1 text-[13px] font-bold transition-colors disabled:cursor-default sm:text-[14px] ${
                on
                  ? urgent
                    ? 'bg-red-600 text-white shadow-sm'
                    : 'bg-card text-foreground shadow-sm'
                  : urgent
                    ? 'text-red-600 hover:bg-card/60 dark:text-red-400'
                    : 'text-foreground/70 hover:bg-card/60'
              }`}
            >
              {l}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/** "Etiketat" row (Organizimi card) — label badges inline with a bare
 *  "Shto etiketë" input (Enter adds, Backspace on empty removes the last),
 *  plus workspace suggestions while typing. */
export const TaskLabelsRow: React.FC<{
  task: Task;
  readOnly: boolean;
  labelSuggestions: string[];
  onUpdate: (id: string, data: any) => Promise<any>;
}> = ({ task, readOnly, labelSuggestions, onUpdate }) => {
  const rawLabels = (task as any).labels as string[] | undefined;
  const labels = useMemo<string[]>(() => rawLabels || [], [rawLabels]);
  const [draft, setDraft] = useState('');
  const commit = (next: string[]) => onUpdate(task.id, { labels: next } as any);
  const add = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    if (!labels.some(x => x.toLowerCase() === v.toLowerCase())) commit([...labels, v]);
    setDraft('');
  };
  const remove = (l: string) => commit(labels.filter(x => x !== l));
  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return [];
    const used = new Set(labels.map(v => v.toLowerCase()));
    return labelSuggestions.filter(s => !used.has(s.toLowerCase()) && s.toLowerCase().includes(q)).slice(0, 6);
  }, [draft, labelSuggestions, labels]);

  return (
    <div className="grid min-h-[52px] grid-cols-[30px_1fr] items-center gap-3 px-4 py-[11px]">
      <IconTile tone="neutral"><Tag className="h-[17px] w-[17px]" strokeWidth={2} /></IconTile>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {labels.map(l => (
          <span key={l} className={`inline-flex h-[22px] items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold ${labelColor(l)}`}>
            {l}
            {!readOnly && (
              <button type="button" onClick={() => remove(l)} title="Hiq" aria-label={`Hiq ${l}`} className="hover:opacity-70">
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        {readOnly && labels.length === 0 && <span className="text-[15px] text-muted-foreground">Pa etiketa</span>}
        {!readOnly && (
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); }
              else if (e.key === 'Backspace' && !draft && labels.length) remove(labels[labels.length - 1]);
            }}
            placeholder={labels.length ? 'Shto…' : 'Shto etiketë'}
            className="h-[30px] min-w-[120px] flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted-foreground/70"
          />
        )}
        {suggestions.length > 0 && (
          <div className="flex w-full flex-wrap gap-1 pt-0.5">
            {suggestions.map(s => (
              <button key={s} type="button" onClick={() => add(s)} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold hover:opacity-80 ${labelColor(s)}`}>
                + {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
