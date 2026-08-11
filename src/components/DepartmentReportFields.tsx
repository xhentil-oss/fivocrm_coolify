import React from 'react';
import { useCollection } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import type { TeamMember } from '../types';
import {
  getReportTemplate,
  normalizeServiceLine,
  fieldsByKind,
  perClientKey,
  FIELD_KINDS,
  type ReportField,
  type ReportFieldKind,
} from '../lib/productivity/reportTemplates';

/**
 * Resolve which department template the current user's daily report should show.
 *
 * `position` (their craft) wins. `serviceLines` is a P&L allocation — the services
 * their salary is charged to — and using it as the department meant a Web Designer
 * billed to "Development" was asked about bugs fixed, and anyone whose services did
 * not match a template key got no department fields at all. It stays as the fallback
 * so members who predate `position` keep the behaviour they had.
 */
export function useMyServiceLine(): string | undefined {
  const { member } = useMyTeamMember();
  return member?.position || member?.serviceLine || member?.serviceLines?.[0];
}

/**
 * The signed-in user's own membership row.
 *
 * Deliberately unscoped by team/business: this is identity bootstrap — it runs before
 * (and independently of) any tenant switch, and the rules already allow reading your
 * own row by `userId`. `loading` is distinguished from "no row" so callers can avoid
 * acting on an answer that hasn't arrived yet.
 */
export function useMyTeamMember(): { member?: TeamMember; loading: boolean } {
  const { user } = useAuth();
  const { data: members, loading } = useCollection<TeamMember>('teamMembers', {
    skip: !user,
    where: user ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
    skipTeamFilter: true,
    skipBusinessFilter: true,
  });
  return {
    member: members?.find((m) => m.userId === user?.uid),
    loading: !user || loading,
  };
}

/** Colour per movement — semantic, not decorative: risk must not read like output. */
const KIND_STYLE: Record<ReportFieldKind, string> = {
  output: 'text-primary',
  impact: 'text-success',
  risk:   'text-warning',
  next:   'text-sky-600 dark:text-sky-400',
};

export interface DepartmentCustomer {
  id: string;
  name: string;
}

interface DepartmentReportFieldsProps {
  serviceLine?: string;
  values: Record<string, string | number>;
  onChange: (key: string, value: string | number) => void;
  /**
   * Clients served today, derived from the answered tasks. Fields marked
   * `perClient` are asked once per entry here — and, when the list is empty, once
   * globally, so a person whose tasks carry no client can still answer.
   */
  customers?: DepartmentCustomer[];
  /** Field keys that failed a blocking check, highlighted in red. */
  invalidKeys?: string[];
}

/**
 * Department-specific report fields, grouped into the four movements the templates
 * declare (Output → Impakt → Rrezik → Hapi tjetër). Renders nothing when the position
 * has no matching template.
 */
const DepartmentReportFields: React.FC<DepartmentReportFieldsProps> = ({
  serviceLine,
  values,
  onChange,
  customers = [],
  invalidKeys = [],
}) => {
  const template = getReportTemplate(serviceLine);
  if (!template) return null;

  const invalid = new Set(invalidKeys);

  const control = (f: ReportField, storedKey: string) => {
    const val = values[storedKey] ?? '';
    const bad = invalid.has(f.key) || invalid.has(storedKey);
    const ring = bad ? 'border-error focus-visible:ring-error' : '';

    if (f.type === 'textarea') {
      return (
        <Textarea
          rows={2}
          className={ring}
          value={String(val)}
          placeholder={f.placeholder}
          onChange={(e) => onChange(storedKey, e.target.value)}
        />
      );
    }
    if (f.type === 'number') {
      return (
        <Input
          type="number"
          min="0"
          step="any"
          className={ring}
          value={val === '' ? '' : Number(val)}
          placeholder="0"
          onChange={(e) => onChange(storedKey, e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
        />
      );
    }
    if (f.type === 'select') {
      return (
        <select
          value={String(val)}
          onChange={(e) => onChange(storedKey, e.target.value)}
          className={`w-full h-9 rounded-md border bg-background px-2 text-sm ${bad ? 'border-error' : 'border-border'}`}
        >
          <option value="">— zgjidh —</option>
          {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    // text + url. `type="url"` is deliberately NOT set: browser URL validation
    // rejects a pasted Figma deep-link often enough to be a nuisance, and the value
    // is never fetched — it is read by a human.
    return (
      <Input
        className={`${ring} ${f.type === 'url' ? 'font-mono text-xs' : ''}`}
        value={String(val)}
        placeholder={f.placeholder}
        onChange={(e) => onChange(storedKey, e.target.value)}
      />
    );
  };

  const fieldBlock = (f: ReportField) => {
    const wide = f.type === 'textarea' || f.type === 'url';
    const perClient = f.perClient && customers.length > 0;

    return (
      <div key={f.key} className={wide || perClient ? 'col-span-2' : ''}>
        <Label className="text-xs mb-1 flex flex-wrap items-center gap-1.5">
          <span>{f.label}{f.unit ? ` (${f.unit})` : ''}</span>
          {f.required && <span className="text-error" title="E detyrueshme">*</span>}
          {f.perClient && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 font-normal text-muted-foreground">
              për klient
            </Badge>
          )}
        </Label>

        {perClient ? (
          <div className="space-y-1.5">
            {customers.map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground w-28 truncate shrink-0" title={c.name}>
                  {c.name}
                </span>
                <div className="flex-1">{control(f, perClientKey(f.key, c.id))}</div>
              </div>
            ))}
          </div>
        ) : (
          control(f, f.key)
        )}
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-4">
      <Label className="flex items-center gap-2 text-sm font-semibold">
        <span>{template.emoji}</span> Raporti i departamentit — {template.label}
      </Label>

      {FIELD_KINDS.map((kind) => {
        const fields = fieldsByKind(template, kind.key);
        if (!fields.length) return null;
        return (
          <div key={kind.key} className="space-y-2">
            <p className="flex items-baseline gap-2">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${KIND_STYLE[kind.key]}`}>
                {kind.label}
              </span>
              <span className="text-[10px] text-muted-foreground">{kind.hint}</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              {fields.map(fieldBlock)}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export { normalizeServiceLine };
export default DepartmentReportFields;
