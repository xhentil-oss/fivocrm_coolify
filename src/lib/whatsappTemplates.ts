// Helpers for WhatsApp template variable substitution.
import type { Lead } from '../types';

// Lead fields that can auto-fill a template's positional parameters.
export const LEAD_FIELD_OPTIONS: { key: string; label: string }[] = [
  { key: 'custom', label: 'Manual (shkruaj vetë)' },
  { key: 'name', label: 'Emri' },
  { key: 'company', label: 'Kompania' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Telefoni' },
  { key: 'jobTitle', label: 'Pozicioni' },
];

// Replace {{1}}, {{2}}… in a template body with the given param values.
// Missing params keep their placeholder so gaps are visible in previews.
export function fillTemplateBody(body: string, params: (string | undefined)[]): string {
  return (body || '').replace(/\{\{(\d+)\}\}/g, (_m, n: string) => {
    const v = params[Number(n) - 1];
    return v != null && v !== '' ? String(v) : `{{${n}}}`;
  });
}

// Count the distinct {{n}} placeholders in a body (max index).
export function countTemplateParams(body: string): number {
  let max = 0;
  for (const m of (body || '').matchAll(/\{\{(\d+)\}\}/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

// Resolve a single paramField against a Lead.  'custom' (or unknown) → ''.
export function resolveLeadParam(field: string | undefined, lead: Partial<Lead> | null | undefined): string {
  if (!field || field === 'custom' || !lead) return '';
  const v = (lead as Record<string, unknown>)[field];
  return v == null ? '' : String(v);
}

// Resolve all of a template's paramFields against a Lead into an ordered array.
export function resolveLeadParams(
  paramFields: string[] | undefined,
  lead: Partial<Lead> | null | undefined
): string[] {
  return (paramFields || []).map((f) => resolveLeadParam(f, lead));
}
