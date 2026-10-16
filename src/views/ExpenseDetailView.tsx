// A recurring expense as an ENTITY: `/app/expenses/:expenseId`.
//
// The list shows a row with a 🔄 badge; this page shows the series — every
// period from the first booking to today, which ones are missing, what it
// cost over the year, when the amount changed, who paused it and when. Nothing
// here is stored anew: the ledger is built from the rows by
// `src/lib/finance/expenseSeries.ts` (unit-tested), so the list, this page and
// any report agree by construction.
//
// Writes stay few and go through the same paths as the list: pause/resume
// (`togglePausePlan`), stop, approve/reject, mark paid, and two owner-only
// decisions the cron deliberately refuses — booking a MISSED period by hand
// (same id + shape the cron would have written, so it can never book it twice)
// and adopting a hand-typed row into the series. Editing fields opens the list's
// ONE form (`?edit=<id>`) — a second form here would drift on the first new field.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Repeat, Pause, Play, CircleStop, Pencil, Check, X, Clock, ThumbsUp, ThumbsDown,
  AlertTriangle, CalendarDays, Wallet, TrendingUp, TrendingDown, Link2, Plus, Download,
  Building2, FolderKanban, User as UserIcon, History, BadgeCheck, CircleDashed, Info,
} from 'lucide-react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useToast } from '../hooks/use-toast';
import { useActivityLogger } from '../hooks/useActivityLogger';
import { useFilteredByOwner, useUniqueTeamMembers } from '../hooks/useRoleFilteredData';
import { useUserNames } from '../hooks/useUserNames';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { currencySymbol, toAll } from '../lib/utils';
import { saveOrShareFile } from '../lib/native';
import { getExpenseDate } from '../lib/finance/financialAnalytics';
import { togglePausePlan, toExpenseDate } from '../lib/finance/recurringExpenses';
import {
  buildExpenseSeriesLedger,
  expenseSeriesHealth,
  findUnlinkedSiblings,
  linkSiblingPatch,
  linkSiblingParentPatch,
  isExpenseMonthClosed,
  monthClosedMessage,
  expenseListQueryOptions,
  backfillBlockReason,
  backfillOccurrenceDraft,
  backfillParentPatch,
  periodShortLabel,
  rowPeriodKey,
  BACKFILL_BLOCK_LABELS,
  type SeriesPeriod,
} from '../lib/finance/expenseSeries';
import { expenseFreqLabel, expenseCategoryLabel, expenseCategoryClass } from '../lib/finance/expenseLabels';
import type { Expense, Team, Project, TeamMember, Activity, FinanceMonthClose } from '../types';

const fmtDate = (d: Date | null | undefined) => (d ? d.toLocaleDateString('sq-AL') : '—');
const fmtMoney = (n: number, currency?: string | null) =>
  `${Math.round(n).toLocaleString('sq-AL')} ${currencySymbol(currency || 'ALL')}`;
const fmtAll = (n: number) => `${Math.round(n).toLocaleString('sq-AL')} L`;
const daysBetween = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86_400_000);

type ApprovalBadgeProps = { status?: string | null; size?: 'sm' | 'xs' };
const ApprovalBadge: React.FC<ApprovalBadgeProps> = ({ status, size = 'xs' }) => {
  const cls = size === 'xs' ? 'text-[10px] py-0' : 'text-xs';
  if (status === 'Approved') return <Badge className={`bg-green-100 text-green-800 ${cls}`}><Check className="w-3 h-3 mr-0.5" />Aprovuar</Badge>;
  if (status === 'Rejected') return <Badge className={`bg-red-100 text-red-800 ${cls}`}><X className="w-3 h-3 mr-0.5" />Refuzuar</Badge>;
  if (status === 'Submitted') return <Badge className={`bg-amber-100 text-amber-800 ${cls}`}><Clock className="w-3 h-3 mr-0.5" />Në pritje</Badge>;
  if (status === 'mixed') return <Badge className={`bg-amber-100 text-amber-800 ${cls}`}>Të përziera</Badge>;
  return null;
};

const PeriodStateBadge: React.FC<{ period: SeriesPeriod }> = ({ period }) => {
  switch (period.state) {
    case 'booked':
      if (period.approval === 'Rejected') return <Badge className="bg-brand-neg-tint text-brand-neg-ink text-[11px]"><X className="w-3 h-3 mr-0.5" />Refuzuar</Badge>;
      if (period.paid) return <Badge className="bg-brand-pos-tint text-brand-pos text-[11px]"><BadgeCheck className="w-3 h-3 mr-0.5" />Paguar</Badge>;
      return <Badge className="bg-brand-blue-tint text-brand-blue-hover text-[11px]"><Check className="w-3 h-3 mr-0.5" />Regjistruar</Badge>;
    case 'missing':
      return <Badge className="bg-brand-neg-tint text-brand-neg-ink text-[11px]"><AlertTriangle className="w-3 h-3 mr-0.5" />Mungon</Badge>;
    case 'pending':
      return <Badge className="bg-brand-warn-tint text-brand-warn-ink text-[11px]"><Clock className="w-3 h-3 mr-0.5" />Pritet më {period.scheduledAt.getDate()}</Badge>;
    default:
      return <Badge className="bg-brand-chip text-brand-chip-ink text-[11px]"><CircleDashed className="w-3 h-3 mr-0.5" />Në ardhje</Badge>;
  }
};

const originLabel = (o: SeriesPeriod['origin']) =>
  o === 'parent' ? 'Origjinali' : o === 'auto' ? 'Automatik' : o === 'manual' ? 'Manual' : o === 'mixed' ? 'Të përziera' : '—';

const KpiTile: React.FC<{ label: string; value: React.ReactNode; hint?: React.ReactNode; icon: React.ReactNode; tone?: 'default' | 'warn' | 'neg' }> =
  ({ label, value, hint, icon, tone = 'default' }) => (
    <Card className={`p-4 ${tone === 'warn' ? 'border-brand-warn-line bg-brand-warn-tint/40' : tone === 'neg' ? 'border-brand-neg-line bg-brand-neg-tint/40' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-brand-muted">{label}</p>
        <span className="text-brand-muted-2">{icon}</span>
      </div>
      <p className="mt-1.5 truncate text-[20px] font-extrabold tracking-[-0.01em] text-brand-navy">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-brand-muted">{hint}</p>}
    </Card>
  );

/**
 * One series, one hue: booked periods as filled bars, a missing period as a
 * dashed outline, pending/upcoming as a tint at the committed amount. The
 * table below is the "table view" of the same numbers.
 */
const PeriodBars: React.FC<{ periods: SeriesPeriod[]; committedAll: number; focusKey: string | null; onPick: (key: string) => void }> =
  ({ periods, committedAll, focusKey, onPick }) => {
    const max = Math.max(committedAll, ...periods.map(p => p.amountAll), 1);
    const shown = periods.slice(-24);
    return (
      <div className="overflow-x-auto">
        <div className="flex h-[120px] min-w-[420px] items-end gap-1.5 px-1" role="img" aria-label="Shuma sipas periudhës">
          {shown.map(p => {
            const amt = p.state === 'booked' ? p.amountAll : committedAll;
            const h = Math.max(4, Math.round((amt / max) * 96));
            const base = 'w-full rounded-t-[4px] transition-colors';
            const cls = p.state === 'booked'
              ? (p.approval === 'Rejected' ? 'bg-brand-muted-2/40' : 'bg-brand-navy hover:bg-brand-navy-mid')
              : p.state === 'missing'
                ? 'border-2 border-dashed border-brand-neg bg-brand-neg-tint'
                : 'bg-brand-blue-tint';
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => onPick(p.key)}
                title={`${p.label}: ${p.state === 'booked' ? fmtAll(p.amountAll) : p.state === 'missing' ? 'mungon' : 'pritet ' + fmtAll(committedAll)}`}
                className={`group flex h-full flex-1 flex-col items-center justify-end gap-1 ${focusKey === p.key ? 'rounded-md bg-brand-surface' : ''}`}
              >
                <div className={`${base} ${cls}`} style={{ height: h }} />
                <span className="text-[10px] font-semibold text-brand-muted-2 whitespace-nowrap">{periodShortLabel(p.key)}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

const ExpenseDetailView: React.FC = () => {
  const { expenseId } = useParams<{ expenseId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const permissions = usePermissions();
  const { toast } = useToast();
  const logActivity = useActivityLogger();
  const isApprover = permissions.isAdmin || permissions.isManager || permissions.isOwner || permissions.isSuperAdmin;

  // Same query options as ExpensesView, so the module-level listener is SHARED
  // when the user comes from the list — no second subscription over the same rows.
  // A non-approver's read carries `category != 'Salary'` (rules are not filters).
  const { data: rawExpenses, loading } = useCollection<Expense>('expenses', expenseListQueryOptions(isApprover));
  const expenses = useFilteredByOwner(rawExpenses);
  const { data: teams } = useCollection<Team>('teams');
  const { data: projects } = useCollection<Project>('projects', { skipTeamFilter: true });
  const { data: rawTeamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
  });
  const teamMembers = useUniqueTeamMembers(rawTeamMembers);
  const { getName } = useUserNames(teamMembers);
  const { data: closes } = useCollection<FinanceMonthClose>('financeMonthCloses', { skipTeamFilter: true });
  const expenseMutation = useMutation<Expense>('expenses');

  // The row the URL names; a generated occurrence opens its SERIES with that
  // period focused — the entity is the series, never one of its months.
  const requested = useMemo(() => (expenses || []).find(e => e.id === expenseId) || null, [expenses, expenseId]);
  const entity = useMemo(() => {
    if (!requested) return null;
    if (requested.parentExpenseId) {
      const parent = (expenses || []).find(e => e.id === requested.parentExpenseId);
      if (parent) return parent;
    }
    return requested;
  }, [requested, expenses]);
  const children = useMemo(
    () => (entity ? (expenses || []).filter(e => e.parentExpenseId === entity.id && e.id !== entity.id) : []),
    [expenses, entity],
  );
  const isSeries = !!entity && (!!entity.isRecurring || children.length > 0);
  const now = useMemo(() => new Date(), [expenses]); // eslint-disable-line react-hooks/exhaustive-deps
  const ledger = useMemo(() => (entity && isSeries ? buildExpenseSeriesLedger(entity, children, now) : null), [entity, children, isSeries, now]);
  const health = useMemo(() => (entity ? expenseSeriesHealth(entity, now) : null), [entity, now]);
  const siblings = useMemo(() => (entity ? findUnlinkedSiblings(entity, expenses || []) : []), [entity, expenses]);

  const activityQuery = useMemo(() => ({
    where: [{ field: 'entityId', operator: '==' as const, value: entity?.id || '__none__' }],
    skipTeamFilter: true,
    skip: !entity,
  }), [entity?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: activities } = useCollection<Activity>('activities', activityQuery);

  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  useEffect(() => {
    if (!requested || !entity || requested.id === entity.id) return;
    const key = rowPeriodKey(requested, (entity.recurringFrequency as string) || 'monthly');
    if (key) setFocusKey(key);
  }, [requested, entity]);
  useEffect(() => {
    if (!focusKey) return;
    // Desktop row or mobile card — whichever is actually laid out.
    const el = [rowRefs.current.get(focusKey), rowRefs.current.get(`m:${focusKey}`)]
      .find(n => n && n.getClientRects().length > 0);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusKey]);

  const team = teams?.find(t => t.id === entity?.departmentId);
  const project = projects?.find(p => p.id === entity?.projectId);
  const member = teamMembers?.find(m => m.userId === entity?.memberId);

  // ── Writes ──────────────────────────────────────────────────────────────
  const fail = (err: any, title: string) => {
    console.error(`[ExpenseDetail] ${title}:`, err);
    toast({ title, description: err?.message || 'Nuk ke leje për këtë veprim ose ndodhi një gabim.', variant: 'destructive' });
  };
  /** A row dated in a CLOSED month is part of the closed books — refuse, and say why. */
  const refuseClosedRows = (rows: Expense[]): boolean => {
    const locked = rows.find(r => isExpenseMonthClosed(getExpenseDate(r), r.businessId, closes));
    if (!locked) return false;
    const at = getExpenseDate(locked);
    toast({ title: 'Muaji është i mbyllur', description: monthClosedMessage(at), variant: 'destructive' });
    return true;
  };

  const handleTogglePause = async () => {
    if (!entity) return;
    const { paused, patch, resumedNext, moved } = togglePausePlan(entity, new Date());
    try { await expenseMutation.update(entity.id, patch as any); }
    catch (err: any) { fail(err, paused ? 'Seria nuk u pauzua' : 'Seria nuk u rinis'); return; }
    logActivity('expense_updated', paused ? `Seria u pauzua: ${entity.title}` : `Seria u rinis: ${entity.title}`, { entityType: 'expense', entityId: entity.id });
    toast({
      title: paused ? 'Seria u pauzua' : 'Seria u rinis ✓',
      description: moved && resumedNext ? `Data e ardhshme: ${fmtDate(resumedNext)} — muajt e pauzës nuk gjenerohen.` : undefined,
    });
  };

  const handleStop = async () => {
    if (!entity) return;
    if (!confirm(`Të ndalet përsëritja e "${entity.title}"? Rreshtat ekzistues mbeten; nuk gjenerohet më asnjë periudhë.`)) return;
    try { await expenseMutation.update(entity.id, { isRecurring: false, isRecurringPaused: false, nextRecurringDate: null } as any); }
    catch (err: any) { fail(err, 'Përsëritja nuk u ndalua'); return; }
    logActivity('expense_updated', `Përsëritja u ndal: ${entity.title}`, { entityType: 'expense', entityId: entity.id });
    toast({ title: 'Përsëritja u ndal ✓', description: 'Historiku mbetet i paprekur.' });
  };

  const handleApproval = async (row: Expense, verdict: 'Approved' | 'Rejected') => {
    if (refuseClosedRows([row])) return;
    try { await expenseMutation.update(row.id, { approvalStatus: verdict, approvedByUserId: user?.uid } as any); }
    catch (err: any) { fail(err, verdict === 'Approved' ? 'Nuk u miratua' : 'Nuk u refuzua'); return; }
    toast({ title: verdict === 'Approved' ? 'U miratua ✓' : 'U refuzua' });
  };

  // Mark every countable row of the period paid (or clear it). `paidDate` is
  // outside `expenseValueUnchanged()` in the rules, so a Member may do this on
  // an approved row without re-opening the approval.
  const handleTogglePaid = async (period: SeriesPeriod) => {
    const rows = period.rows.filter(r => r.approvalStatus !== 'Rejected');
    if (!rows.length) return;
    if (refuseClosedRows(rows)) return;
    const value = period.paid ? null : new Date();
    setBusyKey(period.key);
    const results = await Promise.allSettled(rows.map(r => expenseMutation.update(r.id, { paidDate: value } as any)));
    setBusyKey(null);
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length) { fail((failed[0] as PromiseRejectedResult).reason, 'Pagesa nuk u shënua'); return; }
    toast({ title: value ? `${period.label}: shënuar si paguar ✓` : `${period.label}: pagesa u hoq` });
  };

  // The owner's decision the cron refuses to take: book a MISSED period. Same
  // id + shape the cron would have written; a parent patch only when this
  // period is newer than the claim/pointer (an old month moves nothing).
  const handleBackfill = async (period: SeriesPeriod) => {
    if (!entity) return;
    const block = backfillBlockReason(period, entity, closes, new Date(), isApprover);
    if (block) { toast({ title: 'Nuk mund të shtohet', description: BACKFILL_BLOCK_LABELS[block], variant: 'destructive' }); return; }
    if (!confirm(`Të regjistrohet ${period.label} me ${fmtMoney(Number(entity.amount) || 0, entity.currency)} (data ${fmtDate(period.scheduledAt)})?`)) return;
    const draft = backfillOccurrenceDraft(entity, period, user?.uid || null, isApprover);
    setBusyKey(period.key);
    try {
      await expenseMutation.create(draft.data as any, draft.id);
      const parentPatch = backfillParentPatch(entity, period);
      if (parentPatch) await expenseMutation.update(entity.id, parentPatch as any);
    } catch (err: any) {
      setBusyKey(null);
      fail(err, 'Periudha nuk u regjistrua');
      return;
    }
    setBusyKey(null);
    logActivity('expense_updated', `Periudha u shtua manualisht: ${period.label}`, {
      entityType: 'expense', entityId: entity.id, description: fmtMoney(Number(entity.amount) || 0, entity.currency),
    });
    toast({ title: `${period.label} u regjistrua ✓`, description: 'Me të njëjtin id që do shkruante cron-i — nuk dyfishohet.' });
  };

  // Adopting a hand-typed row makes it THAT period's occurrence, so the parent's
  // claim/pointer move forward exactly as for a backfill — otherwise the cron
  // books a second row for the same period.
  const handleLink = async (row: Expense) => {
    if (!entity) return;
    if (refuseClosedRows([row])) return;
    try {
      await expenseMutation.update(row.id, linkSiblingPatch(entity, row) as any);
      const parentPatch = linkSiblingParentPatch(entity, row);
      if (parentPatch) await expenseMutation.update(entity.id, parentPatch as any);
    }
    catch (err: any) { fail(err, 'Rreshti nuk u lidh'); return; }
    logActivity('expense_updated', `Rresht i lidhur me serinë: ${fmtDate(getExpenseDate(row))}`, { entityType: 'expense', entityId: entity.id });
    toast({ title: 'Rreshti u lidh me serinë ✓' });
  };

  const exportCsv = async () => {
    if (!entity || !ledger) return;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Periudha', 'Data', 'Shuma', 'Monedha', 'Ndryshimi', 'Statusi', 'Burimi', 'Paguar më', 'Miratimi', 'Rreshta'];
    const lines = ledger.periods.map(p => [
      p.label, p.state === 'booked' ? fmtDate(getExpenseDate(p.rows[0])) : fmtDate(p.scheduledAt),
      p.state === 'booked' ? p.amount : '', p.currency, p.delta ?? '',
      p.state, originLabel(p.origin), fmtDate(p.paidAt), p.approval ?? '', p.rows.length,
    ].map(esc).join(','));
    const csv = '﻿' + [header.map(esc).join(','), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    await saveOrShareFile(blob, `seria-${entity.title.replace(/[^\w-]+/g, '_')}.csv`, { shareTitle: entity.title });
  };

  // ── Timeline: logged activity + the facts the rows themselves carry ────
  const timeline = useMemo(() => {
    if (!entity) return [];
    type Ev = { at: Date; title: string; detail?: string; who?: string | null };
    const out: Ev[] = [];
    const created = toExpenseDate(entity.createdAt);
    if (created) out.push({ at: created, title: 'Shpenzimi u krijua', who: entity.createdByUserId, detail: fmtMoney(Number(entity.amount) || 0, entity.currency) });
    const skippedAt = toExpenseDate(entity.recurringPeriodsSkippedAt);
    if (skippedAt && entity.recurringPeriodsSkipped) {
      out.push({ at: skippedAt, title: `Cron-i kapërceu ${entity.recurringPeriodsSkipped} periudhë`, detail: 'Nuk rishkruhen automatikisht — shtoji manualisht nga tabela nëse duhen.' });
    }
    for (const c of children) {
      const bf = toExpenseDate(c.backfilledAt);
      if (bf) out.push({ at: bf, title: `Periudha ${c.periodKey || ''} u shtua manualisht`, who: c.createdByUserId });
    }
    for (const a of activities || []) {
      const at = toExpenseDate(a.createdAt);
      if (!at) continue;
      out.push({ at, title: a.title, detail: a.description || undefined, who: a.userId });
    }
    return out.sort((x, y) => y.at.getTime() - x.at.getTime()).slice(0, 40);
  }, [entity, children, activities]);

  // ── Render ──────────────────────────────────────────────────────────────
  if (loading && !rawExpenses) {
    return (
      <div className="mx-auto max-w-[1140px] space-y-4 p-4 sm:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!entity) {
    return (
      <div className="mx-auto max-w-[720px] p-6">
        <Card className="p-8 text-center">
          <Info className="mx-auto h-8 w-8 text-brand-muted-2" />
          <p className="mt-3 font-semibold text-brand-navy">Shpenzimi nuk u gjet</p>
          <p className="mt-1 text-sm text-brand-muted">Mund të jetë fshirë, ose nuk ke leje ta shohësh.</p>
          <Button variant="outline" className="mt-4 gap-1.5" onClick={() => navigate('/app/expenses')}>
            <ArrowLeft className="h-3.5 w-3.5" /> Shpenzimet
          </Button>
        </Card>
      </div>
    );
  }

  const stateBadge = (() => {
    if (!entity.isRecurring && children.length > 0) return <Badge className="bg-brand-chip text-brand-chip-ink"><CircleStop className="w-3 h-3 mr-1" />Ndalur</Badge>;
    if (!entity.isRecurring) return null;
    if (health?.block === 'series-ended') return <Badge className="bg-brand-chip text-brand-chip-ink">Mbaruar</Badge>;
    if (entity.isRecurringPaused) return <Badge className="bg-amber-100 text-amber-800"><Pause className="w-3 h-3 mr-1" />Në pauzë</Badge>;
    if (entity.status && entity.status !== 'Active') return <Badge variant="secondary">Joaktiv</Badge>;
    return <Badge className="bg-brand-pos-tint text-brand-pos"><Repeat className="w-3 h-3 mr-1" />Aktive</Badge>;
  })();

  const committedAll = toAll(Number(entity.amount) || 0, entity.currency);
  const nextDue = health?.nextDueAt ?? null;
  const dueIn = nextDue ? daysBetween(nextDue, now) : null;
  // A non-approver may only change rows they created (`createdByUserId == uid`
  // in the expenses update/delete rules) — hide the action instead of failing.
  const canModify = (e: Expense) => isApprover || (!!user?.uid && (e as any).createdByUserId === user.uid);
  const canEdit = permissions.canEdit && canModify(entity);
  const canEditRows = (rows: Expense[]) => permissions.canEdit && rows.length > 0 && rows.every(canModify);
  const missing = ledger?.periods.filter(p => p.state === 'missing') ?? [];

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-[1140px] space-y-5">

        {/* ── Header ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3.5">
            <button
              type="button"
              onClick={() => navigate('/app/expenses')}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12.5px] font-bold text-brand-muted transition-colors hover:text-brand-navy"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Shpenzimet
            </button>
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[17px] font-extrabold text-white shadow-[0_4px_12px_rgba(8,24,58,.25)]"
              style={{ background: 'linear-gradient(135deg, #0c2456, #08183A)' }}
              aria-hidden="true"
            >
              {entity.title?.trim()?.charAt(0)?.toUpperCase() || 'S'}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-[18px] font-extrabold tracking-[-0.01em] text-brand-navy">{entity.title}</h1>
                <Badge className={expenseCategoryClass(entity.category)}>{expenseCategoryLabel(entity.category)}</Badge>
                {stateBadge}
                <ApprovalBadge status={entity.approvalStatus} size="sm" />
              </div>
              <p className="mt-0.5 truncate text-xs font-semibold text-brand-muted">
                {[
                  isSeries ? `${expenseFreqLabel(entity.recurringFrequency || 'monthly')} · ${fmtMoney(Number(entity.amount) || 0, entity.currency)} / cikël` : fmtMoney(Number(entity.amount) || 0, entity.currency),
                  team?.name, project?.name, member?.displayName,
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isApprover && entity.approvalStatus === 'Submitted' && (
              <>
                <Button variant="outline" size="sm" className="gap-1 border-green-200 text-green-700" onClick={() => handleApproval(entity, 'Approved')}><ThumbsUp className="h-3.5 w-3.5" /> Aprovo</Button>
                <Button variant="outline" size="sm" className="gap-1 border-red-200 text-red-700" onClick={() => handleApproval(entity, 'Rejected')}><ThumbsDown className="h-3.5 w-3.5" /> Refuzo</Button>
              </>
            )}
            {canEdit && entity.isRecurring && (
              <Button variant="outline" size="sm" className="gap-1 border-amber-200 text-amber-700" onClick={handleTogglePause}>
                {entity.isRecurringPaused ? <><Play className="h-3.5 w-3.5" /> Rifillo</> : <><Pause className="h-3.5 w-3.5" /> Pauzo</>}
              </Button>
            )}
            {canEdit && entity.isRecurring && (
              <Button variant="outline" size="sm" className="gap-1 text-destructive" onClick={handleStop}><CircleStop className="h-3.5 w-3.5" /> Ndalo</Button>
            )}
            {canEdit && (
              <Button size="sm" className="gap-1" onClick={() => navigate(`/app/expenses?edit=${entity.id}`)}><Pencil className="h-3.5 w-3.5" /> Ndrysho</Button>
            )}
          </div>
        </div>

        {/* ── KPI tiles (series) ── */}
        {isSeries && ledger && health && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiTile
              label="Shuma për cikël" icon={<Wallet className="h-4 w-4" />}
              value={fmtMoney(Number(entity.amount) || 0, entity.currency)}
              hint={health.running ? `≈ ${fmtAll(health.monthlyAll)} / muaj` : 'nuk angazhon më'}
            />
            <KpiTile
              label="Regjistruar gjithsej" icon={<History className="h-4 w-4" />}
              value={ledger.mixedCurrency ? fmtAll(ledger.totalAll) : fmtMoney(ledger.totalNative, ledger.currency)}
              hint={`${ledger.bookedCount} periudha · që nga ${fmtDate(ledger.firstBookedAt)}`}
            />
            <KpiTile
              label="Mesatarja / periudhë" icon={<TrendingUp className="h-4 w-4" />}
              value={fmtAll(ledger.averageAll)}
              hint={ledger.amountChanges.length ? `${ledger.amountChanges.length} ndryshime shume` : 'shumë e pandryshuar'}
            />
            <KpiTile
              label="Angazhimi vjetor" icon={<CalendarDays className="h-4 w-4" />}
              value={health.running ? fmtAll(health.yearlyAll) : '—'}
              hint={health.endsAt ? `deri më ${fmtDate(health.endsAt)}` : health.running ? 'pa datë mbarimi' : 'seria nuk vazhdon'}
            />
            <KpiTile
              label="Hapi tjetër" icon={<Repeat className="h-4 w-4" />}
              tone={health.isProblem ? 'neg' : missing.length ? 'warn' : 'default'}
              value={health.running && nextDue ? fmtDate(nextDue) : health.block === 'paused' ? 'Në pauzë' : health.block === 'not-recurring' ? 'Ndalur' : '—'}
              hint={health.running && dueIn !== null
                ? (dueIn > 0 ? `pas ${dueIn} ditësh` : dueIn === 0 ? 'sot' : `vonuar ${-dueIn} ditë — cron-i e regjistron në ekzekutimin e radhës`)
                : health.label}
            />
          </div>
        )}

        {/* ── Health strip ── */}
        {isSeries && ledger && health && (health.isProblem || missing.length > 0 || ledger.duplicateCount > 0 || (entity.recurringPeriodsSkipped ?? 0) > 0) && (
          <Card className={`space-y-1.5 p-4 text-sm ${health.isProblem ? 'border-brand-neg-line bg-brand-neg-tint/50' : 'border-brand-warn-line bg-brand-warn-tint/50'}`}>
            {health.isProblem && (
              <p className="flex items-start gap-2 text-brand-neg-ink"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>Seria nuk gjeneron:</strong> {health.label}. Hap "Ndrysho" dhe vendos datën/frekuencën.</span></p>
            )}
            {missing.length > 0 && (
              <p className="flex items-start gap-2 text-brand-warn-ink"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>{missing.length} periudhë pa rresht:</strong> {missing.map(p => p.label).slice(0, 5).join(', ')}{missing.length > 5 ? ` (+${missing.length - 5})` : ''}. Librat e mbyllur nuk rishkruhen automatikisht — shtoji nga tabela nëse duhen.</span></p>
            )}
            {ledger.duplicateCount > 0 && (
              <p className="flex items-start gap-2 text-brand-warn-ink"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>{ledger.duplicateCount} periudhë me rreshta të dyfishtë</strong> — totali i periudhës i numëron të dyja. Kontrolloji te lista (filtri "Dublikatat").</span></p>
            )}
            {(entity.recurringPeriodsSkipped ?? 0) > 0 && (
              <p className="flex items-start gap-2 text-brand-muted"><Info className="mt-0.5 h-4 w-4 shrink-0" /><span>Cron-i raportoi {entity.recurringPeriodsSkipped} periudhë të kapërcyer më {fmtDate(toExpenseDate(entity.recurringPeriodsSkippedAt))}.</span></p>
            )}
          </Card>
        )}

        {/* ── Series ledger ── */}
        {isSeries && ledger ? (
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-line px-4 py-3 sm:px-5">
              <div>
                <h2 className="text-[15px] font-extrabold text-brand-navy">Historiku periudhë për periudhë</h2>
                <p className="text-xs text-brand-muted">
                  {ledger.bookedCount} të regjistruara · {ledger.paidCount} të paguara · {ledger.unpaidCount} pa pagesë
                  {ledger.missingCount > 0 && <> · <span className="font-semibold text-brand-neg-ink">{ledger.missingCount} mungojnë</span></>}
                </p>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCsv}><Download className="h-3.5 w-3.5" /> CSV</Button>
            </div>

            <div className="border-b border-brand-line-soft px-4 pb-2 pt-4 sm:px-5">
              <PeriodBars periods={ledger.periods} committedAll={committedAll} focusKey={focusKey} onPick={setFocusKey} />
            </div>

            {/* Desktop table */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr className="text-left text-body-sm font-medium text-foreground">
                    <th className="px-5 py-3">Periudha</th>
                    <th className="px-5 py-3">Data</th>
                    <th className="px-5 py-3">Shuma</th>
                    <th className="px-5 py-3">Statusi</th>
                    <th className="px-5 py-3">Burimi</th>
                    <th className="px-5 py-3">Miratimi</th>
                    <th className="px-5 py-3">Veprime</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[...ledger.periods].reverse().map(p => {
                    const bookedDate = p.state === 'booked' ? getExpenseDate(p.rows[0]) : null;
                    const block = p.state === 'missing' ? backfillBlockReason(p, entity, closes, now, isApprover) : null;
                    return (
                      <tr
                        key={p.key}
                        ref={el => { if (el) rowRefs.current.set(p.key, el); else rowRefs.current.delete(p.key); }}
                        className={`transition-colors ${focusKey === p.key ? 'bg-brand-blue-tint/40' : 'hover:bg-muted/50'} ${p.state === 'upcoming' ? 'opacity-60' : ''}`}
                      >
                        <td className="px-5 py-3">
                          <p className="font-semibold text-brand-navy">{p.label}</p>
                          {p.duplicate && <p className="text-[11px] text-brand-warn-ink">{p.rows.length} rreshta në këtë periudhë</p>}
                        </td>
                        <td className="px-5 py-3 text-body-sm text-muted-foreground whitespace-nowrap">{fmtDate(bookedDate || p.scheduledAt)}</td>
                        <td className="px-5 py-3">
                          {p.state === 'booked' ? (
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">{fmtMoney(p.amount, p.currency)}</span>
                              {p.delta !== null && p.delta !== 0 && (
                                <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${p.delta > 0 ? 'text-brand-neg-ink' : 'text-brand-pos'}`}>
                                  {p.delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                  {p.delta > 0 ? '+' : ''}{Math.round(p.delta).toLocaleString('sq-AL')}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-body-sm text-muted-foreground">{p.state === 'missing' ? '—' : `pritet ${fmtMoney(Number(entity.amount) || 0, entity.currency)}`}</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-col gap-1">
                            <PeriodStateBadge period={p} />
                            {p.paid && p.paidAt && <span className="text-[11px] text-muted-foreground">më {fmtDate(p.paidAt)}</span>}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-body-sm text-muted-foreground">{originLabel(p.origin)}</td>
                        <td className="px-5 py-3"><ApprovalBadge status={p.approval} /></td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {p.state === 'booked' && canEditRows(p.rows) && p.approval !== 'Rejected' && (
                              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={busyKey === p.key} onClick={() => handleTogglePaid(p)}>
                                <BadgeCheck className="h-3 w-3" /> {p.paid ? 'Hiq pagesën' : 'Paguar'}
                              </Button>
                            )}
                            {p.state === 'booked' && isApprover && p.rows.some(r => r.approvalStatus === 'Submitted') && (
                              <>
                                <Button variant="outline" size="sm" className="h-7 gap-1 border-green-200 text-xs text-green-700" onClick={() => p.rows.filter(r => r.approvalStatus === 'Submitted').forEach(r => handleApproval(r, 'Approved'))}><ThumbsUp className="h-3 w-3" /> Aprovo</Button>
                                <Button variant="outline" size="sm" className="h-7 gap-1 border-red-200 text-xs text-red-700" onClick={() => p.rows.filter(r => r.approvalStatus === 'Submitted').forEach(r => handleApproval(r, 'Rejected'))}><ThumbsDown className="h-3 w-3" /> Refuzo</Button>
                              </>
                            )}
                            {p.state === 'booked' && canEditRows(p.rows) && p.rows.length === 1 && (
                              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => navigate(`/app/expenses?edit=${p.rows[0].id}`)}><Pencil className="h-3 w-3" /> Ndrysho</Button>
                            )}
                            {p.state === 'missing' && canEdit && (
                              <Button
                                variant="outline" size="sm" className="h-7 gap-1 text-xs"
                                disabled={!!block || busyKey === p.key}
                                title={block ? BACKFILL_BLOCK_LABELS[block] : 'Regjistro këtë periudhë me shumën e serisë'}
                                onClick={() => handleBackfill(p)}
                              >
                                <Plus className="h-3 w-3" /> Shto manualisht
                              </Button>
                            )}
                            {p.state === 'missing' && block && <span className="self-center text-[11px] text-muted-foreground">{BACKFILL_BLOCK_LABELS[block]}</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="divide-y divide-border sm:hidden">
              {[...ledger.periods].reverse().map(p => {
                const bookedDate = p.state === 'booked' ? getExpenseDate(p.rows[0]) : null;
                const block = p.state === 'missing' ? backfillBlockReason(p, entity, closes, now, isApprover) : null;
                return (
                  <div
                    key={p.key}
                    ref={el => { if (el) rowRefs.current.set(`m:${p.key}`, el); }}
                    className={`space-y-2 p-4 ${focusKey === p.key ? 'bg-brand-blue-tint/40' : ''} ${p.state === 'upcoming' ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-brand-navy">{p.label}</p>
                        <p className="text-xs text-muted-foreground">{fmtDate(bookedDate || p.scheduledAt)} · {originLabel(p.origin)}</p>
                      </div>
                      <PeriodStateBadge period={p} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{p.state === 'booked' ? fmtMoney(p.amount, p.currency) : p.state === 'missing' ? '—' : `pritet ${fmtMoney(Number(entity.amount) || 0, entity.currency)}`}</span>
                      {p.delta !== null && p.delta !== 0 && (
                        <span className={`text-[11px] font-semibold ${p.delta > 0 ? 'text-brand-neg-ink' : 'text-brand-pos'}`}>{p.delta > 0 ? '+' : ''}{Math.round(p.delta).toLocaleString('sq-AL')}</span>
                      )}
                      <ApprovalBadge status={p.approval} />
                    </div>
                    {permissions.canEdit && (
                      <div className="flex flex-wrap gap-1.5">
                        {p.state === 'booked' && canEditRows(p.rows) && p.approval !== 'Rejected' && (
                          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={busyKey === p.key} onClick={() => handleTogglePaid(p)}><BadgeCheck className="h-3 w-3" /> {p.paid ? 'Hiq pagesën' : 'Paguar'}</Button>
                        )}
                        {p.state === 'booked' && canEditRows(p.rows) && p.rows.length === 1 && (
                          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => navigate(`/app/expenses?edit=${p.rows[0].id}`)}><Pencil className="h-3 w-3" /> Ndrysho</Button>
                        )}
                        {p.state === 'missing' && canEdit && (
                          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={!!block || busyKey === p.key} onClick={() => handleBackfill(p)}><Plus className="h-3 w-3" /> Shto manualisht</Button>
                        )}
                        {p.state === 'missing' && block && <span className="self-center text-[11px] text-muted-foreground">{BACKFILL_BLOCK_LABELS[block]}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ) : (
          <Card className="p-5">
            <h2 className="text-[15px] font-extrabold text-brand-navy">Shpenzim njëherësh</h2>
            <p className="mt-1 text-sm text-brand-muted">Ky rresht nuk përsëritet. Hap "Ndrysho" dhe aktivizo "Periodik" që të bëhet seri me historik.</p>
          </Card>
        )}

        {/* ── Details + amount changes + siblings ── */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="space-y-3 p-5 lg:col-span-1">
            <h2 className="text-[15px] font-extrabold text-brand-navy">Të dhënat</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-brand-muted">Shuma</dt><dd className="font-semibold">{fmtMoney(Number(entity.amount) || 0, entity.currency)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-brand-muted">Data e regjistrimit</dt><dd>{fmtDate(getExpenseDate(entity))}</dd></div>
              {isSeries && <div className="flex justify-between gap-3"><dt className="text-brand-muted">Frekuenca</dt><dd>{expenseFreqLabel(entity.recurringFrequency || 'monthly')}{entity.recurringAnchorDay ? ` · dita ${entity.recurringAnchorDay}` : ''}</dd></div>}
              {isSeries && <div className="flex justify-between gap-3"><dt className="text-brand-muted">Data e ardhshme</dt><dd>{fmtDate(nextDue)}</dd></div>}
              {health?.endsAt && <div className="flex justify-between gap-3"><dt className="text-brand-muted">Deri më</dt><dd>{fmtDate(health.endsAt)}</dd></div>}
              <div className="flex justify-between gap-3"><dt className="flex items-center gap-1 text-brand-muted"><Building2 className="h-3.5 w-3.5" />Departamenti</dt><dd>{team?.name || '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="flex items-center gap-1 text-brand-muted"><FolderKanban className="h-3.5 w-3.5" />Projekti</dt><dd className="truncate">{project?.name || '—'}</dd></div>
              {entity.category === 'Salary' && <div className="flex justify-between gap-3"><dt className="flex items-center gap-1 text-brand-muted"><UserIcon className="h-3.5 w-3.5" />Punonjësi</dt><dd>{member?.displayName || getName(entity.memberId)}</dd></div>}
              <div className="flex justify-between gap-3"><dt className="text-brand-muted">Krijuar nga</dt><dd>{getName(entity.createdByUserId, 'Sistemi')}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-brand-muted">Paguar</dt><dd>{entity.paidDate ? fmtDate(toExpenseDate(entity.paidDate)) : 'jo'}</dd></div>
            </dl>
            {entity.description && <p className="rounded-md bg-brand-surface p-3 text-sm text-brand-ink">{entity.description}</p>}
          </Card>

          <Card className="p-5 lg:col-span-1">
            <h2 className="text-[15px] font-extrabold text-brand-navy">Ndryshimet e shumës</h2>
            {!ledger || ledger.amountChanges.length === 0 ? (
              <p className="mt-1 text-sm text-brand-muted">Shuma nuk ka ndryshuar që nga fillimi i serisë.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {[...ledger.amountChanges].reverse().map(c => (
                  <li key={c.periodKey} className="flex items-center justify-between gap-2 text-sm">
                    <button type="button" className="text-left font-medium text-brand-navy hover:underline" onClick={() => setFocusKey(c.periodKey)}>{c.label}</button>
                    <span className="whitespace-nowrap text-brand-muted">{Math.round(c.from).toLocaleString('sq-AL')} → <strong className="text-foreground">{Math.round(c.to).toLocaleString('sq-AL')}</strong></span>
                    <span className={`whitespace-nowrap text-[11px] font-semibold ${c.pct > 0 ? 'text-brand-neg-ink' : 'text-brand-pos'}`}>{c.pct > 0 ? '+' : ''}{c.pct.toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5 lg:col-span-1">
            <h2 className="text-[15px] font-extrabold text-brand-navy">Rreshta me të njëjtin emër jashtë serisë</h2>
            {siblings.length === 0 ? (
              <p className="mt-1 text-sm text-brand-muted">Asnjë — çdo "{entity.title}" është pjesë e kësaj serie.</p>
            ) : (
              <>
                <p className="mt-1 text-xs text-brand-muted">Shtuar me dorë kur cron-i mungoi, ose nga një seri e vjetër. Lidhi që historiku të jetë i plotë.</p>
                <ul className="mt-2 space-y-2">
                  {siblings.slice(0, 8).map(r => (
                    <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{fmtDate(getExpenseDate(r))} · {fmtMoney(Number(r.amount) || 0, r.currency)}</span>
                      {canEdit && canModify(r) && <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => handleLink(r)}><Link2 className="h-3 w-3" /> Lidhe</Button>}
                    </li>
                  ))}
                </ul>
                {siblings.length > 8 && <p className="mt-1 text-[11px] text-brand-muted">+{siblings.length - 8} të tjerë</p>}
              </>
            )}
          </Card>
        </div>

        {/* ── Timeline ── */}
        <Card className="p-5">
          <h2 className="text-[15px] font-extrabold text-brand-navy">Aktiviteti</h2>
          {timeline.length === 0 ? (
            <p className="mt-1 text-sm text-brand-muted">Ende asnjë veprim i regjistruar.</p>
          ) : (
            <ol className="mt-3 space-y-3 border-l border-brand-line pl-4">
              {timeline.map((ev, i) => (
                <li key={i} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-blue" aria-hidden="true" />
                  <p className="font-medium text-foreground">{ev.title}</p>
                  <p className="text-xs text-brand-muted">
                    {fmtDate(ev.at)} {ev.at.toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' })}
                    {ev.who ? ` · ${getName(ev.who)}` : ''}
                    {ev.detail ? ` · ${ev.detail}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
};

export default ExpenseDetailView;
