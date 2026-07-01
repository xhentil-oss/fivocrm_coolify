import React, { useMemo, useState } from 'react';
import { LabelEditor, labelColor } from './TaskLabels';

// Suggested starter tags so users pick from a consistent set instead of retyping
// (and creating near-duplicates like "Prioritet" / "prioritet"). Existing tags in
// the workspace are merged in via the `suggestions` prop.
export const DEFAULT_CONTACT_TAGS = [
  'VIP', 'Prioritet', 'Klient i ri', 'Klient besnik', 'Ndjekje', 'Ofertë', 'Potencial', 'Joaktiv',
];

/** Parse tags stored either as a string[] (leads) or a comma string (customers). */
export function parseTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/** Merge defaults + existing workspace tags, de-duplicated case-insensitively. */
export function mergeTagSuggestions(existing: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...DEFAULT_CONTACT_TAGS, ...existing]) {
    const k = t.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t.trim());
  }
  return out;
}

interface Props {
  /** Form field name — a hidden input with the comma-joined value is emitted for FormData flows. */
  name?: string;
  initial?: string | string[];
  suggestions?: string[];
  /** Controlled mode: notify parent of the array (used by controlled forms like leads). */
  onChange?: (tags: string[]) => void;
}

/**
 * Tag chooser for customers/leads: shows selected tags as chips, offers the
 * default + existing tags as one-click suggestions, and lets you add a new one.
 * Emits a hidden input (comma-joined) so existing FormData submit handlers keep
 * working; also calls onChange for controlled forms.
 */
export const ContactTagsField: React.FC<Props> = ({ name = 'tags', initial, suggestions = [], onChange }) => {
  const [tags, setTags] = useState<string[]>(() => parseTags(initial));
  const merged = useMemo(() => mergeTagSuggestions(suggestions), [suggestions]);

  const update = (next: string[]) => { setTags(next); onChange?.(next); };

  // Quick-pick chips for suggestions not already selected.
  const quickPicks = merged.filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase())).slice(0, 12);

  return (
    <div className="space-y-2">
      <LabelEditor value={tags} onChange={update} suggestions={merged} placeholder="Shto etiketë (Enter)…" />
      {quickPicks.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {quickPicks.map((s) => (
            <button key={s} type="button" onClick={() => update([...tags, s])}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium hover:opacity-80 ${labelColor(s)}`}>
              + {s}
            </button>
          ))}
        </div>
      )}
      <input type="hidden" name={name} value={tags.join(', ')} />
    </div>
  );
};

export default ContactTagsField;
