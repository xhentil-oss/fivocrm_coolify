import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Eye, AlertTriangle } from 'lucide-react';
import { useCollection } from '../hooks/useFirestore';
import { useUserNames } from '../hooks/useUserNames';
import DailyReportForm, { getTodayString } from './DailyReportForm';
import { positionOptions, positionLabel, normalizeServiceLine } from '../lib/productivity/reportTemplates';
import type { DailyReport, TeamMember } from '../types';

/** Roles whose people legitimately work a sales pipeline — see `showCrmSection`. */
const CRM_ROLES = ['Admin', 'Manager', 'Sales', 'SalesAgent'];

interface DailyReportPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Active members of the current team — the people who can be previewed. */
  members: TeamMember[];
}

/**
 * "Shiko raportin si …" — an admin opens the daily report exactly as a chosen
 * employee would see it.
 *
 * It is a PREVIEW, not a login: it renders the same `DailyReportForm` the employee
 * gets, loaded with that person's real tasks, leads and standup, but writes nothing.
 * Signing in as somebody else would let an admin file a report in their name and
 * would quietly corrupt the submission/lateness numbers this very screen is used to
 * judge — so the switch stops at what the question actually needs: seeing the form.
 *
 * The position picker is deliberately independent of the person, so a CEO can also
 * inspect a craft nobody currently holds (there is no Regjia hire yet, but the
 * questions exist and should be reviewable).
 */
const DailyReportPreviewDialog: React.FC<DailyReportPreviewDialogProps> = ({ open, onOpenChange, members }) => {
  const [memberId, setMemberId] = useState<string>('');
  // null = follow the member's own position; a key = inspect that craft instead.
  const [positionOverride, setPositionOverride] = useState<string | null>(null);

  const { getName } = useUserNames(members);
  const today = getTodayString();

  const selected = useMemo(
    () => members.find(m => m.userId === memberId) || members[0],
    [members, memberId],
  );

  const effectivePosition = positionOverride
    ?? selected?.position
    ?? selected?.serviceLine
    ?? selected?.serviceLines?.[0];

  // Did this person already report today? Worth knowing before reading their form.
  const { data: theirReports } = useCollection<DailyReport>('dailyReports', {
    where: [
      { field: 'userId', operator: '==', value: selected?.userId || '__never__' },
      { field: 'date', operator: '==', value: today },
    ],
    skip: !open || !selected?.userId,
  });
  const submittedToday = (theirReports?.length || 0) > 0;

  const withCrm = CRM_ROLES.includes(selected?.role || '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-primary" />
            Parapamje e raportit ditor
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Shiko formularin ashtu siç e sheh punonjësi, me detyrat e tij të vërteta.
          </p>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 text-xs">Punonjësi</Label>
              <select
                value={selected?.userId || ''}
                onChange={(e) => { setMemberId(e.target.value); setPositionOverride(null); }}
                className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                {members.map(m => (
                  <option key={m.userId} value={m.userId}>
                    {getName(m.userId)}{m.role ? ` — ${m.role}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="mb-1.5 text-xs">Pyetjet e rolit</Label>
              <select
                value={normalizeServiceLine(effectivePosition) || ''}
                onChange={(e) => setPositionOverride(e.target.value || null)}
                className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="">— pa pyetje departamenti —</option>
                {positionOptions().map(p => (
                  <option key={p.key} value={p.key}>{p.emoji} {p.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Say plainly whose data is on screen and that nothing will be written —
              an admin must never be in doubt about which of those two is true. */}
          <div className="rounded-lg border border-amber-200/60 dark:border-amber-800/50 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2">
            <p className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
              <span>
                Parapamje e <strong>{selected ? getName(selected.userId) : '—'}</strong>. Detyrat, leads-et dhe
                standup-i janë të tijat e vërteta; asgjë nuk ruhet dhe askush nuk njoftohet.
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {positionLabel(effectivePosition)
                ? <Badge variant="outline" className="text-[10px]">{positionLabel(effectivePosition)}</Badge>
                : <Badge variant="outline" className="text-[10px] text-muted-foreground">pa pozicion të caktuar</Badge>}
              {positionOverride && (
                <Badge variant="secondary" className="text-[10px]">pyetje të një roli tjetër</Badge>
              )}
              <Badge
                variant="outline"
                className={`text-[10px] ${submittedToday ? 'text-success border-success/40' : 'text-muted-foreground'}`}
              >
                {submittedToday ? 'ka raportuar sot' : 's\'ka raportuar ende sot'}
              </Badge>
            </div>
          </div>

          {selected && (
            // Remount on every switch: the form holds its own draft state, and
            // carrying one person's typing into the next preview would be a lie.
            <DailyReportForm
              key={`${selected.userId}:${effectivePosition || 'none'}`}
              targetUserId={selected.userId}
              serviceLine={effectivePosition}
              preview
              showCrmSection={withCrm}
              showProjectsSection
            />
          )}

          {!selected && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nuk ka anëtarë aktivë për të parapamë.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DailyReportPreviewDialog;
