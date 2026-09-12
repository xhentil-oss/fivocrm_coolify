import { useMemo } from 'react';
import { useCollection } from './useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { buildFollowUpQueue, dayAtNoon, isMineItem, type FollowUpItem } from '../lib/crm/followUp';
import type { Customer, Lead } from '../types';

/**
 * Bounded listener for badges and the dashboard widget: only contacts whose
 * next step is due by the end of today (Europe/Tirane), capped. Needs the
 * `(businessId, nextFollowUpDate)` composite indexes on leads + customers — if
 * they are not deployed yet the listener errors and callers hide the badge
 * (never a red page). Also surfaces contacts awaiting a reply.
 */
export function useFollowUpDue() {
  const { user } = useAuth();
  const permissions = usePermissions();
  // End of today in the follow-up zone (noon of tomorrow is safely past it, but
  // "<= tonight" needs the actual boundary): tomorrow's noon minus 12h.
  const endOfToday = useMemo(() => new Date(dayAtNoon(new Date(), 1).getTime() - 12 * 3_600_000), []);

  const dueQuery = useMemo(() => ({
    where: [{ field: 'nextFollowUpDate', operator: '<=', value: endOfToday }],
    limit: 99,
    skipTeamFilter: true,
  }), [endOfToday]);
  const waitingQuery = useMemo(() => ({
    where: [{ field: 'awaitingReply', operator: '==', value: true }],
    limit: 50,
    skipTeamFilter: true,
  }), []);

  const { data: dueLeads, error: e1 } = useCollection<Lead>('leads', dueQuery);
  const { data: waitingLeads, error: e2 } = useCollection<Lead>('leads', waitingQuery);
  const canCustomers = !!permissions.canAccessCustomers;
  const { data: dueCustomers, error: e3 } = useCollection<Customer>('customers', { ...dueQuery, skip: !canCustomers });
  const { data: waitingCustomers, error: e4 } = useCollection<Customer>('customers', { ...waitingQuery, skip: !canCustomers });

  const error = e1 || e2 || e3 || e4 || null;

  return useMemo(() => {
    const leads = new Map<string, Lead>();
    for (const l of [...(dueLeads || []), ...(waitingLeads || [])]) leads.set(l.id, l);
    const customers = new Map<string, Customer>();
    for (const c of [...(dueCustomers || []), ...(waitingCustomers || [])]) customers.set(c.id, c);
    const q = buildFollowUpQueue([...leads.values()], [...customers.values()], new Date());
    const all: FollowUpItem[] = [...q.awaitingReply, ...q.overdue, ...q.today];
    const mine = all.filter(i => isMineItem(i, user?.uid));
    const count = (arr: FollowUpItem[]) => ({
      awaitingReply: arr.filter(i => i.awaitingReply).length,
      overdue: arr.filter(i => !i.awaitingReply && i.due.state === 'overdue').length,
      today: arr.filter(i => !i.awaitingReply && i.due.state === 'today').length,
    });
    return {
      error,
      all,
      mine,
      counts: { all: count(all), mine: count(mine) },
      queue: q,
    };
  }, [dueLeads, waitingLeads, dueCustomers, waitingCustomers, user?.uid, error]);
}
