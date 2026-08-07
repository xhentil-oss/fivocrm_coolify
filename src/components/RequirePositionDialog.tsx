/**
 * RequirePositionDialog — every member declares their craft before using the CRM.
 *
 * The daily report, the weekly department totals and the per-department report
 * schedules all key off `TeamMember.position`. A member without one silently gets a
 * generic report and disappears from every department rollup, and nobody notices
 * because nothing errors — it just quietly reports nothing. So the field is collected
 * once, at the door, rather than hoped for.
 *
 * Deliberately blocking: no Esc, no click-outside, no close button. The only way past
 * it is to answer, which is the point.
 *
 * It never blocks someone it cannot help: if the signed-in user has no membership row
 * in the active tenant (a super-admin looking in from the platform console, or a
 * session mid-bootstrap), there is nothing to write and the dialog stays closed.
 */

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Briefcase, Loader2 } from 'lucide-react';
import { useMutation } from '../hooks/useFirestore';
import { useMyTeamMember } from './DepartmentReportFields';
import type { TeamMember } from '../types';
import { positionOptions, normalizeServiceLine } from '../lib/productivity/reportTemplates';

const RequirePositionDialog: React.FC = () => {
  const { member, loading } = useMyTeamMember();
  const { update } = useMutation<TeamMember>('teamMembers');

  // Members created before this field existed usually have a P&L service line that
  // already implies the craft — offer it pre-selected so the answer is one click,
  // but still make them confirm it. An inherited guess is not a declaration.
  const suggested = normalizeServiceLine(member?.serviceLine || member?.serviceLines?.[0]);
  const [choice, setChoice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = choice ?? suggested ?? null;
  const open = !loading && !!member && !member.position;

  const save = async () => {
    if (!member?.id || !selected) return;
    setSaving(true);
    setError(null);
    try {
      // Only `position` (+ updatedAt) — the Firestore rule for a self-update allows
      // exactly these, so any extra field here would deny the whole write.
      await update(member.id, { position: selected } as Partial<TeamMember>);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ruajtja dështoi. Provo përsëri.');
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog open>
      <DialogContent
        className="max-w-lg max-h-[90vh] overflow-y-auto [&>button]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-primary" />
            Cili është pozicioni yt i punës?
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Zgjidh zanatin që bën. Ai përcakton pyetjet e raportit tënd ditor dhe si
            llogaritet kontributi yt në totalet e departamentit. Plotësohet një herë.
          </p>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 pt-2">
          {positionOptions().map((opt) => {
            const on = selected === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setChoice(opt.key)}
                className={`text-left text-sm px-3 py-2.5 rounded-xl border transition-colors ${
                  on
                    ? 'bg-primary/10 text-primary border-primary/40 font-medium'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <span className="mr-1.5">{opt.emoji}</span>
                {opt.label}
              </button>
            );
          })}
        </div>

        {suggested && !choice && (
          <p className="text-[11px] text-muted-foreground">
            E parazgjodhëm nga shërbimi ku je i regjistruar — ndryshoje nëse s'është saktë.
          </p>
        )}

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-[11px] text-muted-foreground">
            Mund ta ndryshojë më vonë administratori te Ekipet.
          </p>
          <Button onClick={save} disabled={!selected || saving} className="min-w-32">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ruaj dhe vazhdo'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RequirePositionDialog;
