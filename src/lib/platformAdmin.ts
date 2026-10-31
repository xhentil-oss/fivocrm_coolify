import { auth } from './firebase';
import type { Business, PlatformMetrics } from '../types';
import { PLANS } from './billing';

/**
 * Client side of the platform console's write path (`POST /api/platform-admin`).
 *
 * Every mutation here is a super-admin OVERRIDE of a tenant's commercial terms, so
 * none of it is written straight to Firestore even though the rules would allow it:
 * the server validates the values, records before/after in `auditLogs`, and reports
 * whether the change collides with a live Stripe subscription.
 */

export interface PlanUpdate {
  plan?: string;
  status?: string;
  /** ISO date, or null to clear. */
  trialEndsAt?: string | null;
  /** Negotiated seat override, or null to fall back to the plan's allowance. */
  seats?: number | null;
  note?: string;
}

async function post(payload: Record<string, unknown>): Promise<Record<string, any>> {
  const user = auth.currentUser;
  if (!user) throw new Error('Nuk je i identifikuar.');
  const token = await user.getIdToken();
  const res = await fetch('/api/platform-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  let data: any = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok || data?.error) {
    // Preserve the server's structured hints (e.g. existingBusinessId on a duplicate)
    // so the caller can act on them instead of only showing the message.
    const err = new Error(data?.error || `Gabim serveri (${res.status})`) as Error & Record<string, any>;
    Object.assign(err, data || {});
    throw err;
  }
  return data;
}

export function updateTenantPlan(businessId: string, update: PlanUpdate) {
  return post({ action: 'update-plan', businessId, ...update });
}

/**
 * The two module layers. Send only the one you changed:
 *   - `lockedModules`   — layer 1, the platform's entitlement (owner cannot undo);
 *   - `disabledModules` — layer 2, the owner's own visibility choice (a support assist
 *                         when the console writes it).
 */
export interface TenantModulesPatch {
  lockedModules?: string[];
  disabledModules?: string[];
}

export function setTenantModules(businessId: string, patch: TenantModulesPatch) {
  return post({ action: 'set-modules', businessId, ...patch });
}

export interface CreateTenantResult {
  businessId?: string;
  teamId?: string;
  inviteToken?: string;
  inviteUrl?: string;
  existingBusinessId?: string;
}

/**
 * Sales-assisted onboarding: create a tenant + invite its owner as Admin.
 *
 * The server refuses a duplicate for an owner email that already has a business unless
 * `force` is set — the mistake this prevents is quietly creating a second workspace for
 * a customer who already signed up, which is very hard to untangle afterwards.
 */
export function createTenantFromConsole(input: {
  name: string;
  ownerEmail: string;
  plan?: string;
  trialDays?: number;
  /**
   * Layer 1 — module paths the platform withholds from this tenant
   * (`businesses.lockedModules`, computed with `lockedPathsFor()`).
   */
  lockedModules?: string[];
  /**
   * Layer 2 — the owner's initial "off" set (`businesses.disabledModules`). The
   * console sends the registry default (`defaultDisabledModulePaths()`) because the
   * server has no copy of the registry and would otherwise create the tenant with
   * every module visible.
   */
  disabledModules?: string[];
  force?: boolean;
}): Promise<CreateTenantResult> {
  return post({ action: 'create-tenant', ...input }) as Promise<CreateTenantResult>;
}

// ── Read-side helpers (pure — unit-testable, no Firestore) ───────────────────

/**
 * Monthly recurring revenue in EUR for one tenant. 0 unless it is actually paying.
 *
 * Prefers `mrrCents` — the amount Stripe really bills, normalised to a month by the
 * webhook (yearly ÷ 12, quantity, coupons applied). Falls back to the price-list
 * estimate for tenants that predate that field or were set by a platform override,
 * because showing nothing would be worse than showing an approximation.
 */
export function tenantMrr(biz: Pick<Business, 'plan' | 'status' | 'mrrCents'>): number {
  // Only a live subscription counts: a trial is not revenue, and a suspended or
  // canceled tenant has stopped paying even though the plan field still says "pro".
  if (biz.status !== 'active') return 0;
  if (typeof biz.mrrCents === 'number' && biz.mrrCents > 0) return Math.round(biz.mrrCents) / 100;
  return PLANS.find(p => p.key === biz.plan)?.monthlyEur ?? 0;
}

/** True when this tenant's MRR is the real billed amount rather than a list-price guess. */
export function isMrrExact(biz: Pick<Business, 'mrrCents'>): boolean {
  return typeof biz.mrrCents === 'number' && biz.mrrCents > 0;
}

export interface PlatformStats {
  total: number;
  active: number;
  trialing: number;
  pastDue: number;
  suspended: number;
  canceled: number;
  mrr: number;
  arr: number;
  /** Tenants whose trial ends within the next 7 days (and are still trialing). */
  trialsEndingSoon: number;
}

export function platformStats(
  businesses: Array<Pick<Business, 'plan' | 'status' | 'trialEndsAt' | 'mrrCents'>>,
  now = new Date(),
): PlatformStats {
  const s: PlatformStats = {
    total: businesses.length,
    active: 0, trialing: 0, pastDue: 0, suspended: 0, canceled: 0,
    mrr: 0, arr: 0, trialsEndingSoon: 0,
  };
  const weekOut = now.getTime() + 7 * 24 * 60 * 60 * 1000;
  for (const b of businesses) {
    switch (b.status) {
      case 'active': s.active++; break;
      case 'trialing': s.trialing++; break;
      case 'past_due': s.pastDue++; break;
      case 'suspended': s.suspended++; break;
      case 'canceled': s.canceled++; break;
      default: break;
    }
    s.mrr += tenantMrr(b);
    if (b.status === 'trialing' && b.trialEndsAt instanceof Date) {
      const t = b.trialEndsAt.getTime();
      if (t <= weekOut) s.trialsEndingSoon++;
    }
  }
  s.arr = s.mrr * 12;
  return s;
}

/** Days until a date — negative once it has passed. null when there is no date. */
export function daysUntil(date: unknown, now = new Date()): number | null {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

// ── Tenant health (improvement #3) ───────────────────────────────────────────

/**
 * How alive is this tenant?
 *
 * The commercial status says whether they PAY; this says whether they USE it — the
 * difference between a trial that will convert and one that is already lost, and the
 * earliest churn signal a paying tenant gives. Derived from the `usage` snapshot the
 * `tenant-usage-rollup` cron writes, so the console never has to scan tenant data.
 */
export type TenantHealth = 'engaged' | 'quiet' | 'idle' | 'dormant' | 'unknown';

export const HEALTH_META: Record<TenantHealth, { label: string; cls: string; dot: string }> = {
  engaged: { label: 'Aktiv', cls: 'text-green-600 dark:text-green-400', dot: 'bg-green-500' },
  quiet:   { label: 'I qetë', cls: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' },
  idle:    { label: 'Pa aktivitet', cls: 'text-orange-600 dark:text-orange-400', dot: 'bg-orange-500' },
  dormant: { label: 'I braktisur', cls: 'text-red-600 dark:text-red-400', dot: 'bg-red-500' },
  unknown: { label: 'E panjohur', cls: 'text-muted-foreground', dot: 'bg-muted-foreground/40' },
};

/** Thresholds in days since the last write anywhere in the tenant. */
export const HEALTH_THRESHOLDS = { engaged: 3, quiet: 14, idle: 45 };

export function tenantHealth(
  biz: Pick<Business, 'usage' | 'createdAt'> | null | undefined,
  now = new Date(),
): TenantHealth {
  const last = biz?.usage?.lastActivityAt;
  if (!(last instanceof Date) || Number.isNaN(last.getTime())) {
    // A brand-new tenant has no rollup yet — that is not the same as abandoned.
    const created = biz?.createdAt;
    if (created instanceof Date && (now.getTime() - created.getTime()) < 2 * 86_400_000) return 'unknown';
    return biz?.usage ? 'dormant' : 'unknown';
  }
  const days = (now.getTime() - last.getTime()) / 86_400_000;
  if (days <= HEALTH_THRESHOLDS.engaged) return 'engaged';
  if (days <= HEALTH_THRESHOLDS.quiet) return 'quiet';
  if (days <= HEALTH_THRESHOLDS.idle) return 'idle';
  return 'dormant';
}

/** "3 ditë më parë" / "sot" — compact last-seen label for the tenant list. */
export function lastSeenLabel(date: unknown, now = new Date()): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return 'sot';
  if (days === 1) return 'dje';
  if (days < 30) return `${days} ditë më parë`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 muaj më parë' : `${months} muaj më parë`;
}

/**
 * Tenants worth acting on today, most urgent first. Combines commercial state with
 * engagement, which is exactly the pair a human needs to decide whom to call:
 * a paying tenant that went dormant outranks a trial that never started.
 */
export interface AttentionItem {
  businessId: string;
  name: string;
  reason: string;
  severity: 'high' | 'medium';
}

export function attentionList(
  businesses: Array<Business & { id: string }>,
  now = new Date(),
): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const b of businesses) {
    const name = b.name || 'Pa emër';
    const health = tenantHealth(b, now);
    const trialLeft = daysUntil(b.trialEndsAt, now);

    // A self-serve signup sees NOTHING until the platform opens its modules — the
    // most time-sensitive item on this list, independent of billing state.
    if (b.moduleSetup === 'pending') {
      out.push({ businessId: b.id, name, reason: 'Tenant i ri — modulet presin konfigurim', severity: 'high' });
    }

    if (b.status === 'suspended') {
      out.push({ businessId: b.id, name, reason: 'I pezulluar — pa pagesë', severity: 'high' });
    } else if (b.status === 'past_due') {
      out.push({ businessId: b.id, name, reason: 'Pagesa dështoi', severity: 'high' });
    } else if (b.status === 'active' && (health === 'idle' || health === 'dormant')) {
      // The expensive kind of churn: they still pay, but they stopped showing up.
      out.push({ businessId: b.id, name, reason: `Paguan, por pa aktivitet (${HEALTH_META[health].label.toLowerCase()})`, severity: 'high' });
    } else if (b.status === 'trialing' && trialLeft !== null && trialLeft <= 3 && trialLeft >= 0) {
      out.push({
        businessId: b.id, name,
        reason: health === 'engaged'
          ? `Provja mbaron pas ${trialLeft}d — aktiv, shanse konvertimi`
          : `Provja mbaron pas ${trialLeft}d — pa aktivitet`,
        severity: health === 'engaged' ? 'high' : 'medium',
      });
    } else if (b.status === 'trialing' && trialLeft !== null && trialLeft < 0) {
      out.push({ businessId: b.id, name, reason: `Provja skadoi ${-trialLeft}d më parë`, severity: 'medium' });
    }
  }
  const rank = { high: 0, medium: 1 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ── Platform trend (improvement #2) ──────────────────────────────────────────

/** 'YYYY-MM' key for a date — the id of a `platformMetrics` document. */
export function monthKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface TrendSummary {
  /** Chronological series (oldest → newest) of MRR, for the sparkline. */
  mrrSeries: number[];
  months: string[];
  currentMrr: number;
  /** MRR change vs the previous month, in EUR and percent (null with no history). */
  mrrDeltaEur: number | null;
  mrrDeltaPct: number | null;
  signupsThisMonth: number;
  activatedThisMonth: number;
  churnedThisMonth: number;
  /** activated / signups over the whole window, as a percentage (null if no signups). */
  conversionPct: number | null;
  /** churned / tenants at the start of the month, as a percentage. */
  churnPct: number | null;
}

/**
 * Turn the stored monthly documents into the few numbers an operator reads.
 * Pure and order-independent: it sorts by month key itself.
 */
export function summarizeTrend(
  metrics: Array<Partial<PlatformMetrics> & { month?: string; id?: string }>,
  windowMonths = 12,
): TrendSummary {
  const rows = [...metrics]
    .map(m => ({ ...m, month: m.month || m.id || '' }))
    .filter(m => /^\d{4}-\d{2}$/.test(m.month))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-windowMonths);

  const months = rows.map(r => r.month);
  const mrrSeries = rows.map(r => Number(r.mrr) || 0);
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];

  const currentMrr = Number(last?.mrr) || 0;
  const prevMrr = prev ? Number(prev.mrr) || 0 : null;
  const mrrDeltaEur = prevMrr === null ? null : currentMrr - prevMrr;
  const mrrDeltaPct = prevMrr === null || prevMrr === 0
    ? (prevMrr === 0 && currentMrr > 0 ? 100 : null)
    : Math.round(((currentMrr - prevMrr) / prevMrr) * 1000) / 10;

  const totalSignups = rows.reduce((n, r) => n + (Number(r.signups) || 0), 0);
  const totalActivated = rows.reduce((n, r) => n + (Number(r.activated) || 0), 0);

  const startOfMonthTenants = prev ? Number(prev.tenantsTotal) || 0 : Number(last?.tenantsTotal) || 0;
  const churnedThisMonth = Number(last?.churned) || 0;

  return {
    mrrSeries,
    months,
    currentMrr,
    mrrDeltaEur,
    mrrDeltaPct,
    signupsThisMonth: Number(last?.signups) || 0,
    activatedThisMonth: Number(last?.activated) || 0,
    churnedThisMonth,
    conversionPct: totalSignups === 0 ? null : Math.round((totalActivated / totalSignups) * 1000) / 10,
    churnPct: startOfMonthTenants === 0 ? null : Math.round((churnedThisMonth / startOfMonthTenants) * 1000) / 10,
  };
}
