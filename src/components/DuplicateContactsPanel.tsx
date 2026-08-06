import React, { useMemo, useState } from 'react';
import { CheckCircle2, Copy, Merge, ShieldCheck } from 'lucide-react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  duplicateReasonLabel, findDuplicateGroups, contactKindLabel,
  type ContactKind, type DuplicateGroup,
} from '../lib/contactMerge';
import type { MergeableContact } from './MergeContactsDialog';

interface Props {
  kind: ContactKind;
  records: MergeableContact[];
  /** Opens the merge dialog with the survivor pre-selected. */
  onMerge: (primaryId: string, duplicateId: string) => void;
  canMerge?: boolean;
  /** Rendered above the list — used for the "manual merge" entry point. */
  action?: React.ReactNode;
}

/**
 * The duplicate list: records that look like the same person, grouped, with the
 * fullest record pre-picked as the one to keep.
 *
 * Detection is a suggestion, never an action — merging is irreversible enough
 * that it stays a deliberate click. A group where only the NAME matches is shown
 * with a weaker badge, because two people can share a name.
 */
const DuplicateContactsPanel: React.FC<Props> = ({ kind, records, onMerge, canMerge = true, action }) => {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const groups = useMemo(
    () => findDuplicateGroups(records as any) as DuplicateGroup<MergeableContact>[],
    [records],
  );
  const visible = groups.filter(g => !dismissed.has(g.key));

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Copy className="w-4 h-4 text-muted-foreground" />
            {visible.length === 0
              ? 'Asnjë dublikatë e mundshme'
              : `${visible.length} grup${visible.length === 1 ? '' : 'e'} me dublikatë të mundshme`}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Kontrolli bëhet me email, telefon dhe emër. Bashkimi kryhet vetëm manualisht.
          </p>
        </div>
        {action}
      </div>

      {visible.length === 0 && (
        <Card className="p-8 text-center">
          <CheckCircle2 className="w-10 h-10 mx-auto text-success mb-3" />
          <p className="text-sm text-muted-foreground">
            Nuk u gjetën {contactKindLabel(kind, true)} të dyfishuar.
          </p>
        </Card>
      )}

      {visible.map(group => {
        const [keep, ...others] = group.records;
        return (
          <Card key={group.key} className="p-3 sm:p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Badge variant={group.reason === 'name' ? 'outline' : 'secondary'} className="font-normal">
                {duplicateReasonLabel(group.reason)}
              </Badge>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{group.records.length} rekorde</span>
                <Button
                  variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => setDismissed(prev => new Set(prev).add(group.key))}
                >
                  Nuk është dublikatë
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <ContactRow record={keep} highlight />
              {others.map(other => (
                <div key={other.id} className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <ContactRow record={other} />
                  </div>
                  {canMerge && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 shrink-0"
                      onClick={() => onMerge(keep.id, other.id)}
                    >
                      <Merge className="w-3.5 h-3.5" /> Bashko
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
};

const ContactRow: React.FC<{ record: MergeableContact; highlight?: boolean }> = ({ record, highlight }) => (
  <div className={`rounded-md border px-3 py-2 ${highlight ? 'border-primary/50 bg-primary/5' : 'border-border'}`}>
    <div className="flex items-center gap-2 min-w-0">
      <p className="text-sm font-medium truncate">{record.name || '(pa emër)'}</p>
      {highlight && (
        <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-primary shrink-0">
          <ShieldCheck className="w-3 h-3" /> mbetet
        </span>
      )}
    </div>
    <p className="text-xs text-muted-foreground truncate">
      {[record.email, record.phone || record.phoneNumber, record.company].filter(Boolean).join(' · ') || '—'}
    </p>
  </div>
);

export default DuplicateContactsPanel;
