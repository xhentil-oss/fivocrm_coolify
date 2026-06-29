import React, { useMemo, useState } from 'react';
import { X, Tag } from 'lucide-react';

// Reusable task labels/tags (Asana/Jira-style). Deterministic color per label
// so the same tag always looks the same across list, board, and detail panel.

const PALETTE = [
  'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
];

export function labelColor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Read-only colored chips for a task's labels. */
export const TaskLabels: React.FC<{ labels?: string[]; className?: string; max?: number }> = ({ labels, className, max }) => {
  if (!labels || labels.length === 0) return null;
  const shown = max ? labels.slice(0, max) : labels;
  const extra = max && labels.length > max ? labels.length - max : 0;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className || ''}`}>
      {shown.map(l => (
        <span key={l} className={`px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${labelColor(l)}`}>{l}</span>
      ))}
      {extra > 0 && <span className="px-1 py-0.5 rounded text-[10px] font-medium leading-none bg-muted text-muted-foreground">+{extra}</span>}
    </span>
  );
};

interface EditorProps {
  value: string[];
  onChange: (labels: string[]) => void;
  /** All labels already used in the workspace, for autocomplete. */
  suggestions?: string[];
  placeholder?: string;
}

/** Add/remove labels with free-typing + suggestions from existing workspace labels. */
export const LabelEditor: React.FC<EditorProps> = ({ value, onChange, suggestions = [], placeholder }) => {
  const [input, setInput] = useState('');
  const norm = (s: string) => s.trim();

  const add = (raw: string) => {
    const v = norm(raw);
    if (!v) return;
    if (!value.some(x => x.toLowerCase() === v.toLowerCase())) onChange([...value, v]);
    setInput('');
  };
  const remove = (l: string) => onChange(value.filter(x => x !== l));

  const filtered = useMemo(() => {
    const q = input.trim().toLowerCase();
    const used = new Set(value.map(v => v.toLowerCase()));
    return suggestions
      .filter(s => !used.has(s.toLowerCase()) && (!q || s.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [input, suggestions, value]);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map(l => (
          <span key={l} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${labelColor(l)}`}>
            {l}
            <button type="button" onClick={() => remove(l)} className="hover:opacity-70" aria-label={`Hiq ${l}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="relative">
        <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input); }
            else if (e.key === 'Backspace' && !input && value.length) remove(value[value.length - 1]);
          }}
          placeholder={placeholder || 'Shto etiketë (Enter)…'}
          className="w-full h-8 pl-8 pr-2 text-xs rounded-md bg-muted/40 border border-border/50 focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      {filtered.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {filtered.map(s => (
            <button key={s} type="button" onClick={() => add(s)} className={`px-1.5 py-0.5 rounded text-[10px] font-medium hover:opacity-80 ${labelColor(s)}`}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
