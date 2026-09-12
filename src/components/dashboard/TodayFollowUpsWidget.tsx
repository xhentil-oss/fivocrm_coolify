import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { BellRing, Check, ArrowRight, MessageSquare } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import FollowUpBadge, { FOLLOW_UP_TYPE_ICON } from '../crm/FollowUpBadge';
import NextStepPopover from '../crm/NextStepPopover';
import SnoozeMenu from '../crm/SnoozeMenu';
import { useFollowUpDue } from '../../hooks/useFollowUpDue';
import { useFollowUpActions } from '../../hooks/useFollowUpActions';
import { followUpItemHref, waitingSince, type FollowUpItem } from '../../lib/crm/followUp';
import { cn } from '../../lib/utils';

interface Props {
  /** Show everyone's items (admins) instead of only mine. */
  scope?: 'mine' | 'all';
  max?: number;
}

/**
 * "Ndjekjet e sotme" — the first thing a salesperson should see. Up to `max`
 * rows: waiting replies first, then overdue, then today. ✓ and Shty only; the
 * full queue is one click away.
 */
const TodayFollowUpsWidget: React.FC<Props> = ({ scope = 'mine', max = 5 }) => {
  const navigate = useNavigate();
  const due = useFollowUpDue();
  const actions = useFollowUpActions();
  const [gone, setGone] = useState<Set<string>>(new Set());

  if (due.error) return null; // index not deployed yet / no permission → stay quiet
  const items = (scope === 'all' ? due.all : due.mine).filter(i => !gone.has(`${i.kind}:${i.id}`));
  const counts = scope === 'all' ? due.counts.all : due.counts.mine;
  const total = counts.awaitingReply + counts.overdue + counts.today;

  const vanish = (item: FollowUpItem) => setGone(s => new Set(s).add(`${item.kind}:${item.id}`));
  const target = (item: FollowUpItem) => ({ kind: item.kind, id: item.id, name: item.name, raw: item.raw });

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className={cn('p-2 rounded-lg', counts.overdue + counts.awaitingReply > 0 ? 'bg-red-100 dark:bg-red-900/30' : 'bg-amber-100 dark:bg-amber-900/30')}>
            <BellRing className={cn('w-5 h-5', counts.overdue + counts.awaitingReply > 0 ? 'text-red-500' : 'text-amber-500')} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Ndjekjet e sotme</h2>
            <p className="text-xs text-muted-foreground">
              {counts.awaitingReply > 0 && <span className="text-red-600 dark:text-red-400 font-medium">{counts.awaitingReply} presin përgjigje · </span>}
              {counts.overdue > 0 && <span className="text-red-600 dark:text-red-400">{counts.overdue} vonuar · </span>}
              {counts.today} sot
            </p>
          </div>
        </div>
        <Badge variant="secondary">{total}</Badge>
      </div>
      <div className="p-3">
        {items.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-3 justify-center">
            <Check className="w-4 h-4 text-green-500" />
            Asgjë për sot. Pipeline i pastër.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {items.slice(0, max).map(item => {
              const Icon = item.awaitingReply ? MessageSquare : FOLLOW_UP_TYPE_ICON[item.type];
              return (
                <li key={`${item.kind}:${item.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
                  <span className={cn('w-6 h-6 rounded-full flex items-center justify-center shrink-0',
                    item.awaitingReply ? 'bg-red-600 text-white' : item.due.state === 'overdue' ? 'bg-red-500 text-white' : 'bg-amber-500 text-white')}>
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link to={followUpItemHref(item)} className="text-sm font-medium truncate block hover:underline">{item.name}</Link>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {item.awaitingReply ? `Pret përgjigje · ${waitingSince(item.raw) || ''}` : (item.note || (item.kind === 'lead' ? 'Lead' : 'Klient'))}
                    </p>
                  </div>
                  {!item.awaitingReply && <FollowUpBadge contact={item.raw} size="sm" showType={false} />}
                  <NextStepPopover
                    contact={item.raw as any}
                    entity={item.kind}
                    mode="complete"
                    trigger={<Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" title="U bë"><Check className="w-4 h-4" /></Button>}
                    onSubmit={async (p) => { const ok = await actions.complete(target(item), p.outcome || { channel: item.type, result: null }, p.next); if (ok) vanish(item); }}
                    onCloseLead={() => navigate(followUpItemHref(item))}
                  />
                  {!item.awaitingReply && (
                    <SnoozeMenu size="icon" onSnooze={async (pr) => { const ok = await actions.snooze(target(item), pr); if (ok) vanish(item); }} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Button variant="ghost" size="sm" className="w-full mt-2 text-xs" onClick={() => navigate('/app/follow-ups')}>
          Shiko të gjitha{total > 0 ? ` (${total})` : ''} <ArrowRight className="w-3.5 h-3.5 ml-1" />
        </Button>
      </div>
    </Card>
  );
};

export default TodayFollowUpsWidget;
