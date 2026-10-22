import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BellRing, CheckCircle2, Users, Inbox, AlarmClock, Tag } from 'lucide-react';
import { useCollection } from '../hooks/useFirestore';
import { useFilteredByOwner } from '../hooks/useRoleFilteredData';
import { useUserNames } from '../hooks/useUserNames';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useToast } from '../hooks/use-toast';
import { useFollowUpActions, type FollowUpTarget } from '../hooks/useFollowUpActions';
import { buildFollowUpQueue, isMineItem, type FollowUpItem, type SnoozePresetKey } from '../lib/crm/followUp';
import { useTeamSettingsData } from '../hooks/useTeamSettings';
import { resolvePlaybooks, currentPlaybookStep, nextPlaybookStep, renderPlaybookTemplate } from '../lib/crm/playbooks';
import { FollowUpRow, FollowUpSection } from '../components/crm/FollowUpRow';
import type { NextStepSubmit } from '../components/crm/NextStepPopover';
import WhatsAppChatPanel from '../components/WhatsAppChatPanel';
import EmailComposerDialog, { useContactEmailAvailable, type EmailTarget } from '../components/crm/EmailComposerDialog';
import { Button } from '../components/ui/button';
import type { Customer, FollowUpType, Lead } from '../types';
import { cn } from '../lib/utils';

type Scope = 'mine' | 'all';
type Kind = 'both' | 'lead' | 'customer';

const targetOf = (item: FollowUpItem): FollowUpTarget => ({ kind: item.kind, id: item.id, name: item.name, raw: item.raw });

/**
 * /app/follow-ups — the daily landing page for sales. One list, five sections:
 * Presin përgjigje · Vonuar · Sot · Këtë javë · Pa hap tjetër. Every action on a
 * row goes through `useFollowUpActions` (the single write path).
 */
const FollowUpsView: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const permissions = usePermissions();
  const { toast } = useToast();
  const actions = useFollowUpActions();

  const isLeadRole = permissions.isAdmin || permissions.isManager || (permissions as any).isOwner;
  const [scope, setScope] = useState<Scope>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('followups_scope') : null;
    return (saved as Scope) || (isLeadRole ? 'all' : 'mine');
  });
  const [kind, setKind] = useState<Kind>(() => (typeof window !== 'undefined' && (window.localStorage.getItem('followups_kind') as Kind)) || 'both');
  useEffect(() => { try { window.localStorage.setItem('followups_scope', scope); } catch { /* ignore */ } }, [scope]);
  useEffect(() => { try { window.localStorage.setItem('followups_kind', kind); } catch { /* ignore */ } }, [kind]);

  // "Sot" must roll over without a reload.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const { data: rawLeads, loading: leadsLoading } = useCollection<Lead>('leads', { skipTeamFilter: true });
  const leads = useFilteredByOwner(rawLeads);
  const canCustomers = !!permissions.canAccessCustomers;
  const { data: rawCustomers, loading: customersLoading } = useCollection<Customer>('customers', { skipTeamFilter: true, skip: !canCustomers });
  const customers = useFilteredByOwner(rawCustomers);
  const { getName } = useUserNames();
  const teamSettings = useTeamSettingsData();
  const playbooks = useMemo(() => resolvePlaybooks(teamSettings), [teamSettings]);
  // Label filter — tags carried by the contacts in the queue (playbook tags first).
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const queue = useMemo(() => {
    const ls = kind === 'customer' ? [] : leads;
    const cs = kind === 'lead' || !canCustomers ? [] : customers;
    const q = buildFollowUpQueue(ls, cs, now);
    const tagOk = (i: FollowUpItem) => !tagFilter || ((i.raw as any).tags || []).some((t: string) => String(t).toLowerCase() === tagFilter.toLowerCase());
    const keep = (i: FollowUpItem) => tagOk(i) && (scope === 'all' || isMineItem(i, user?.uid));
    if (scope === 'all' && !tagFilter) return q;
    const mine = (arr: FollowUpItem[]) => arr.filter(keep);
    const awaitingReply = mine(q.awaitingReply), overdue = mine(q.overdue), today = mine(q.today), thisWeek = mine(q.thisWeek), noNextStep = mine(q.noNextStep);
    return {
      awaitingReply, overdue, today, thisWeek, noNextStep,
      counts: { awaitingReply: awaitingReply.length, overdue: overdue.length, today: today.length, thisWeek: thisWeek.length, noNextStep: noNextStep.length, due: overdue.length + today.length },
    };
  }, [leads, customers, kind, scope, now, user?.uid, canCustomers, tagFilter]);

  // Tags available for the filter: every playbook tag + tags present on contacts.
  const tagOptions = useMemo(() => {
    const set = new Map<string, string>();
    playbooks.forEach(p => set.set(p.tag.toLowerCase(), p.tag));
    [...(leads || []), ...(customers || [])].forEach(c => ((c as any).tags || []).forEach((t: string) => {
      const k = String(t).trim(); if (k) set.set(k.toLowerCase(), set.get(k.toLowerCase()) || k);
    }));
    return [...set.values()].slice(0, 12);
  }, [playbooks, leads, customers]);

  // Playbook context per lead: "SEO · hapi 2/7" + the WhatsApp text ready to send.
  const playbookFor = (item: FollowUpItem) => {
    if (item.kind !== 'lead' || !playbooks.length) return null;
    const lead = item.raw as Lead;
    const cur = currentPlaybookStep(lead, playbooks) || nextPlaybookStep(lead, playbooks);
    if (!cur) return null;
    return {
      hint: `${cur.playbook.name} · hapi ${cur.index + 1}/${cur.playbook.steps.length}`,
      text: cur.step.template
        ? renderPlaybookTemplate(cur.step.template, { name: lead.name, company: lead.company, service: cur.playbook.name, staffName: user?.displayName || '' })
        : '',
    };
  };

  // Rows that were just acted on fade out until the subscription catches up.
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const markLeaving = (item: FollowUpItem) => {
    const key = `${item.kind}:${item.id}`;
    setLeaving(s => new Set(s).add(key));
    setTimeout(() => setLeaving(s => { const n = new Set(s); n.delete(key); return n; }), 2500);
  };

  // WhatsApp panel (mounted once, like CRMView) + the in-app email composer.
  const [waItem, setWaItem] = useState<FollowUpItem | null>(null);
  const emailAvailable = useContactEmailAvailable();
  const [emailTarget, setEmailTarget] = useState<EmailTarget | null>(null);

  // ?focus=lead:<id> from a notification → highlight + scroll.
  const focus = searchParams.get('focus');
  useEffect(() => {
    if (!focus) return;
    const el = document.querySelector(`[data-followup-id="${focus}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const t = setTimeout(() => setSearchParams(prev => { const p = new URLSearchParams(prev); p.delete('focus'); return p; }, { replace: true }), 4000);
      return () => clearTimeout(t);
    }
  }, [focus, queue, setSearchParams]);

  const onComplete = async (item: FollowUpItem, p: NextStepSubmit) => {
    const snap = await actions.complete(targetOf(item), p.outcome || { channel: item.type, result: null }, p.next);
    if (snap) markLeaving(item);
  };
  const onSchedule = async (item: FollowUpItem, p: NextStepSubmit) => {
    const snap = await actions.schedule(targetOf(item), p.next);
    if (snap) markLeaving(item);
  };
  const onSnooze = async (item: FollowUpItem, preset: SnoozePresetKey | Date) => {
    const snap = await actions.snooze(targetOf(item), preset);
    if (snap) markLeaving(item);
  };
  const onLogged = (item: FollowUpItem, channel: FollowUpType) => {
    void actions.logContact(targetOf(item), channel);
    toast({ title: 'Kontakti u regjistrua', description: `${item.name} · ${channel === 'call' ? 'Telefonatë' : channel}` });
  };
  const onCloseLead = (item: FollowUpItem, status: 'Won' | 'Lost') => {
    // Won/Lost carry side effects (deal sync, conversion, lost reason) that live
    // in the CRM drawer — send the user there instead of half-doing it here.
    navigate(`/app/crm?lead=${item.id}`);
    toast({ title: status === 'Won' ? 'Shëno si Fituar' : 'Shëno si Humbur', description: 'Ndrysho statusin te kartela e lead-it.' });
  };
  const snoozeAllOverdue = async () => {
    const items = queue.overdue;
    if (!items.length) return;
    await Promise.allSettled(items.map(i => actions.snooze(targetOf(i), '1d', { silent: true })));
    items.forEach(markLeaving);
    toast({ title: `${items.length} ndjekje u shtynë për nesër` });
  };

  const loading = leadsLoading || (canCustomers && customersLoading);
  const totalShown = queue.counts.awaitingReply + queue.counts.due + queue.counts.thisWeek + queue.counts.noNextStep;
  const allClear = !loading && totalShown === 0;
  const dueClear = !loading && queue.counts.awaitingReply + queue.counts.due === 0 && queue.counts.noNextStep > 0;

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const rowProps = {
    now, getName, onComplete, onSchedule, onSnooze, onLogged, onCloseLead,
    onOpenWhatsApp: (item: FollowUpItem) => setWaItem(item),
    onOpenEmail: emailAvailable
      ? (item: FollowUpItem) => { if (item.email) setEmailTarget({ kind: item.kind, id: item.id, name: item.name, email: item.email, company: item.company }); }
      : undefined,
  };

  const renderRows = (items: FollowUpItem[], section: 'awaitingReply' | 'overdue' | 'today' | 'thisWeek' | 'noNextStep') =>
    items.map(item => (
      <FollowUpRow
        key={`${item.kind}:${item.id}`}
        item={item}
        section={section}
        hint={playbookFor(item)?.hint}
        tags={(item.raw as any).tags || null}
        focused={focus === `${item.kind}:${item.id}`}
        leaving={leaving.has(`${item.kind}:${item.id}`)}
        {...rowProps}
      />
    ));

  const [weekLimit, setWeekLimit] = useState(10);

  const chip = (label: string, count: number, tone: string, id: string) => (
    <button
      type="button"
      onClick={() => scrollTo(id)}
      className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors', count === 0 && 'opacity-50', tone)}
    >
      {label} <span className="font-mono">{count}</span>
    </button>
  );

  const seg = <T extends string>(value: T, current: T, set: (v: T) => void, label: string) => (
    <button
      type="button"
      onClick={() => set(value)}
      className={cn('px-2.5 py-1 text-xs font-medium rounded-md transition-colors', current === value ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground')}
    >
      {label}
    </button>
  );

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10"><BellRing className="w-5 h-5 text-primary" /></div>
            <div>
              <h1 className="text-xl font-bold">Ndjekjet</h1>
              <p className="text-xs text-muted-foreground capitalize">
                {now.toLocaleDateString('sq-AL', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex rounded-md bg-muted p-0.5">
              {seg<Scope>('mine', scope, setScope, 'Të miat')}
              {seg<Scope>('all', scope, setScope, 'Të gjitha')}
            </div>
            {canCustomers && (
              <div className="inline-flex rounded-md bg-muted p-0.5">
                {seg<Kind>('both', kind, setKind, 'Të dy')}
                {seg<Kind>('lead', kind, setKind, 'Leads')}
                {seg<Kind>('customer', kind, setKind, 'Klientë')}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {chip('Presin përgjigje', queue.counts.awaitingReply, 'border-red-300 text-red-700 dark:text-red-400', 'sec-waiting')}
          {chip('Vonuar', queue.counts.overdue, 'border-red-200 text-red-600 dark:text-red-400', 'sec-overdue')}
          {chip('Sot', queue.counts.today, 'border-amber-200 text-amber-700 dark:text-amber-400', 'sec-today')}
          {chip('Këtë javë', queue.counts.thisWeek, 'border-blue-200 text-blue-700 dark:text-blue-400', 'sec-week')}
          {chip('Pa hap tjetër', queue.counts.noNextStep, 'border-border text-muted-foreground', 'sec-none')}
        </div>
        {tagOptions.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Tag className="w-3.5 h-3.5 text-muted-foreground" />
            <button type="button" onClick={() => setTagFilter(null)}
              className={cn('rounded-full border px-2 py-0.5 text-[11px] transition-colors', !tagFilter ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted')}>
              Të gjitha
            </button>
            {tagOptions.map(t => (
              <button key={t} type="button" onClick={() => setTagFilter(tagFilter?.toLowerCase() === t.toLowerCase() ? null : t)}
                className={cn('rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                  tagFilter?.toLowerCase() === t.toLowerCase() ? 'bg-violet-600 text-white border-violet-600' : 'hover:bg-muted')}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Duke ngarkuar…</p>}

      {allClear && (
        <div className="rounded-xl border bg-card p-10 text-center space-y-3">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
          <p className="font-semibold">Pipeline i pastër.</p>
          <p className="text-sm text-muted-foreground">Asnjë ndjekje e planifikuar{scope === 'mine' ? ' për ty' : ''}. Çdo lead i hapur ka hapin e tij tjetër.</p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/app/crm')}><Users className="w-4 h-4 mr-1.5" />Shko te Leads</Button>
            {scope === 'mine' && <Button variant="ghost" size="sm" onClick={() => setScope('all')}>Shiko të gjitha</Button>}
          </div>
        </div>
      )}

      {dueClear && (
        <div className="rounded-lg border border-dashed p-4 flex items-center gap-3 text-sm">
          <Inbox className="w-5 h-5 text-muted-foreground" />
          <span>Asgjë për sot. <b>{queue.counts.noNextStep}</b> lead pa hap tjetër ↓</span>
          <Button variant="link" size="sm" className="ml-auto" onClick={() => scrollTo('sec-none')}>Shiko</Button>
        </div>
      )}

      {!allClear && (
        <div className="space-y-6">
          {queue.counts.awaitingReply > 0 && (
            <FollowUpSection id="sec-waiting" title="Presin përgjigje" count={queue.counts.awaitingReply} tone="crimson" collapsible={false}
              hint="Na kanë shkruar dhe askush s'është përgjigjur">
              {renderRows(queue.awaitingReply, 'awaitingReply')}
            </FollowUpSection>
          )}

          <FollowUpSection id="sec-overdue" title="Vonuar" count={queue.counts.overdue} tone="red" collapsible={false}
            emptyText="Asgjë e vonuar. Kështu duhet."
            action={queue.counts.overdue > 1 ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={snoozeAllOverdue}>
                <AlarmClock className="w-3.5 h-3.5 mr-1" />Shty të gjitha +1 ditë
              </Button>
            ) : null}>
            {renderRows(queue.overdue, 'overdue')}
          </FollowUpSection>

          <FollowUpSection id="sec-today" title="Sot" count={queue.counts.today} tone="amber" emptyText="Asgjë e planifikuar për sot.">
            {renderRows(queue.today, 'today')}
          </FollowUpSection>

          <FollowUpSection id="sec-week" title="Këtë javë" count={queue.counts.thisWeek} tone="blue" hint="7 ditët e ardhshme" emptyText="Asgjë e planifikuar këtë javë.">
            {renderRows(queue.thisWeek.slice(0, weekLimit), 'thisWeek')}
            {queue.thisWeek.length > weekLimit && (
              <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setWeekLimit(l => l + 20)}>
                Shfaq më shumë ({queue.thisWeek.length - weekLimit})
              </Button>
            )}
          </FollowUpSection>

          {kind !== 'customer' && (
            <FollowUpSection id="sec-none" title="Pa hap tjetër" count={queue.counts.noNextStep} tone="gray"
              hint="Leads të hapur pa asgjë të planifikuar — rrezik për t'u harruar" defaultOpen={queue.counts.due === 0}
              emptyText="Çdo lead i hapur ka hapin e tij tjetër.">
              {renderRows(queue.noNextStep, 'noNextStep')}
            </FollowUpSection>
          )}
        </div>
      )}

      <EmailComposerDialog target={emailTarget} onOpenChange={(o) => { if (!o) setEmailTarget(null); }} />

      {waItem && waItem.phone && (
        <WhatsAppChatPanel
          phone={waItem.phone}
          leadName={waItem.name}
          leadId={waItem.kind === 'lead' ? waItem.id : undefined}
          customerId={waItem.kind === 'customer' ? waItem.id : undefined}
          onClose={() => setWaItem(null)}
          initialText={playbookFor(waItem)?.text || undefined}
          onSent={(e) => void actions.logContact(targetOf(waItem), 'whatsapp', e.body, { countsAsFollowUp: true })}
        />
      )}
    </div>
  );
};

export default FollowUpsView;
