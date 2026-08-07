import React from 'react';
import { useCollection } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import type { TeamMember } from '../types';
import { getReportTemplate, normalizeServiceLine } from '../lib/productivity/reportTemplates';

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
  const { user } = useAuth();
  const { data: members } = useCollection<TeamMember>('teamMembers', {
    skip: !user,
    where: user ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
    skipTeamFilter: true,
    skipBusinessFilter: true,
  });
  const me = members?.find((m) => m.userId === user?.uid);
  return me?.position || me?.serviceLine || me?.serviceLines?.[0];
}

/**
 * Department-specific report fields, rendered from the serviceLine's fixed
 * template. Renders nothing when the serviceLine has no matching template.
 */
const DepartmentReportFields: React.FC<{
  serviceLine?: string;
  values: Record<string, string | number>;
  onChange: (key: string, value: string | number) => void;
}> = ({ serviceLine, values, onChange }) => {
  const template = getReportTemplate(serviceLine);
  if (!template) return null;

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-3">
      <Label className="flex items-center gap-2 text-sm font-semibold">
        <span>{template.emoji}</span> Raporti i departamentit — {template.label}
      </Label>
      <div className="grid grid-cols-2 gap-3">
        {template.fields.map((f) => {
          const val = values[f.key] ?? '';
          if (f.type === 'textarea') {
            return (
              <div key={f.key} className="col-span-2">
                <Label className="text-xs mb-1 block">{f.label}</Label>
                <Textarea
                  rows={2}
                  value={String(val)}
                  placeholder={f.placeholder}
                  onChange={(e) => onChange(f.key, e.target.value)}
                />
              </div>
            );
          }
          if (f.type === 'number') {
            return (
              <div key={f.key}>
                <Label className="text-xs mb-1 block">{f.label}{f.unit ? ` (${f.unit})` : ''}</Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={val === '' ? '' : Number(val)}
                  placeholder="0"
                  onChange={(e) => onChange(f.key, e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                />
              </div>
            );
          }
          return (
            <div key={f.key} className="col-span-2">
              <Label className="text-xs mb-1 block">{f.label}</Label>
              <Input value={String(val)} placeholder={f.placeholder} onChange={(e) => onChange(f.key, e.target.value)} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export { normalizeServiceLine };
export default DepartmentReportFields;
