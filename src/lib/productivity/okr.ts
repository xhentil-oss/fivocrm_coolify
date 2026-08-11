/**
 * OKR engine — Measure What Matters (John Doerr), applied to FivoCRM Goals.
 *
 *   Objective  = the goal (qualitative, ambitious "what").
 *   Key Result = a measurable checkpoint (quantitative "how we know").
 *
 * Progress on an Objective is DERIVED as the average of its Key Results' progress
 * — never typed in by hand. Three kinds of KR:
 *   • metric    — a number you update (e.g. "reach 50k L", start 0 → target 50000)
 *   • milestone — binary done/not-done (0% or 100%)
 *   • auto      — currentValue pulled LIVE from CRM data (tasks done, revenue,
 *                 leads won, …) so the goal moves on its own as work happens.
 *
 * Health follows Doerr's pace logic: compare progress-% against time-elapsed-%.
 * Pure functions only — no React, no Firestore.
 */

import { getTimestampMs, toAll } from '../utils';
import type { Goal, KeyResult, KeyResultAutoSource, Task, Project, Lead, Invoice } from '../../types';

export interface OkrContext {
  tasks?: Task[];
  projects?: Project[];
  leads?: Lead[];
  invoices?: Invoice[];
}

export type GoalHealth = 'On Track' | 'At Risk' | 'Off Track' | 'Achieved';

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ────────────────────────────────────────────────────────────────────────────
// Auto Key Results — derive currentValue from live CRM data
// ────────────────────────────────────────────────────────────────────────────

/** Human labels for the auto sources (Albanian UI). */
export const AUTO_SOURCE_LABELS: Record<KeyResultAutoSource, string> = {
  tasksCompleted: 'Detyra të përfunduara',
  projectsCompleted: 'Projekte të përfunduara',
  leadsWon: 'Lead-e të fituara',
  revenue: 'Të ardhura (fatura të paguara)',
  invoicesPaid: 'Fatura të paguara (numër)',
};

/** Default unit shown for each auto source. */
export const AUTO_SOURCE_UNIT: Record<KeyResultAutoSource, string> = {
  tasksCompleted: 'detyra',
  projectsCompleted: 'projekte',
  leadsWon: 'leads',
  revenue: 'L',
  invoicesPaid: 'fatura',
};

/**
 * Compute the live current value of an 'auto' KR from CRM data, scoped to the
 * goal's time window, its linked projects, and — for individual goals — its owner.
 */
export function computeAutoKRValue(
  source: KeyResultAutoSource,
  goal: Goal,
  ctx: OkrContext,
  now: number = Date.now(),
): number {
  const start = getTimestampMs(goal.startDate) || 0;
  const end = getTimestampMs(goal.dueDate) || now;
  const within = (ms: number) => ms >= start && ms <= Math.max(end, now);

  const ownerId = goal.scope === 'individual' ? goal.ownerId : undefined;
  const linked = new Set(goal.linkedProjects || []);
  const hasLinked = linked.size > 0;

  switch (source) {
    case 'tasksCompleted': {
      return (ctx.tasks || []).filter(
        (t) =>
          t.status === 'Done' &&
          !t.parentTaskId &&
          within(getTimestampMs(t.updatedAt)) &&
          (!hasLinked || (t.projectId ? linked.has(t.projectId) : false)) &&
          (!ownerId || t.assignedToUserId === ownerId),
      ).length;
    }
    case 'projectsCompleted': {
      return (ctx.projects || []).filter((p) => {
        const done = p.status === 'Completed';
        const ts = getTimestampMs((p as any).lastCompletedAt) || getTimestampMs(p.updatedAt);
        return (
          done &&
          within(ts) &&
          (!hasLinked || linked.has(p.id)) &&
          (!ownerId || (p as any).responsibleUserId === ownerId)
        );
      }).length;
    }
    case 'leadsWon': {
      return (ctx.leads || []).filter(
        (l) =>
          (l.status === 'Won' || l.status === 'Converted') &&
          within(getTimestampMs(l.updatedAt)) &&
          (!ownerId || (l as any).assignedToUserId === ownerId),
      ).length;
    }
    case 'revenue': {
      return (ctx.invoices || [])
        .filter((inv) => inv.status === 'Paid' && within(getTimestampMs((inv as any).paidAt) || getTimestampMs(inv.updatedAt)))
        // Normalizo ne ALL: mbledhja e papershtatur e `total` numeronte
        // 1 € si 1 Lek, dhe rezultati etiketohej si €.
        .reduce((s, inv) => s + toAll(inv.total ?? inv.amount ?? 0, (inv as any).currency), 0);
    }
    case 'invoicesPaid': {
      return (ctx.invoices || []).filter(
        (inv) => inv.status === 'Paid' && within(getTimestampMs((inv as any).paidAt) || getTimestampMs(inv.updatedAt)),
      ).length;
    }
    default:
      return 0;
  }
}

/** The value a KR should display: live-computed for 'auto', stored otherwise. */
export function keyResultCurrent(kr: KeyResult, goal: Goal, ctx: OkrContext, now: number = Date.now()): number {
  if (kr.type === 'milestone') return kr.done ? kr.targetValue || 1 : kr.startValue || 0;
  if (kr.type === 'auto' && kr.autoSource) return computeAutoKRValue(kr.autoSource, goal, ctx, now);
  return kr.currentValue ?? 0;
}

/** Progress of a single KR, 0–100. */
export function keyResultProgress(kr: KeyResult, goal: Goal, ctx: OkrContext, now: number = Date.now()): number {
  if (kr.type === 'milestone') return kr.done ? 100 : 0;
  const current = keyResultCurrent(kr, goal, ctx, now);
  const start = kr.startValue || 0;
  const target = kr.targetValue;
  const denom = target - start;
  if (denom === 0) return current >= target ? 100 : 0;
  return Math.round(clamp(((current - start) / denom) * 100, 0, 100));
}

// ────────────────────────────────────────────────────────────────────────────
// Goal-level derivation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Derived goal progress (0–100). Average of KR progress when KRs exist;
 * otherwise falls back to the legacy manual `progress` field so old goals are
 * unaffected.
 */
export function goalDerivedProgress(goal: Goal, ctx: OkrContext = {}, now: number = Date.now()): number {
  const krs = goal.keyResults;
  if (!krs || krs.length === 0) return Math.round(goal.progress || 0);
  const sum = krs.reduce((s, kr) => s + keyResultProgress(kr, goal, ctx, now), 0);
  return Math.round(sum / krs.length);
}

/** True when the goal is driven by real Key Results (vs the legacy manual field). */
export function hasKeyResults(goal: Goal): boolean {
  return !!goal.keyResults && goal.keyResults.length > 0;
}

/**
 * Health of a goal, Doerr-style: progress vs elapsed time.
 *  • ≥100%                     → Achieved
 *  • progress ≥ expected − 5   → On Track
 *  • progress ≥ expected − 25  → At Risk
 *  • else                      → Off Track
 * With no dates, thresholds fall back to progress alone.
 */
export function goalHealth(goal: Goal, progress: number, now: number = Date.now()): GoalHealth {
  if (progress >= 100) return 'Achieved';

  const start = getTimestampMs(goal.startDate);
  const end = getTimestampMs(goal.dueDate);
  if (start && end && end > start) {
    const elapsed = clamp(((now - start) / (end - start)) * 100, 0, 100);
    if (progress >= elapsed - 5) return 'On Track';
    if (progress >= elapsed - 25) return 'At Risk';
    return 'Off Track';
  }

  if (progress >= 70) return 'On Track';
  if (progress >= 40) return 'At Risk';
  return 'Off Track';
}

/**
 * Google-style OKR score 0.0–1.0. The "sweet spot" for stretch goals is 0.6–0.7;
 * a consistent 1.0 means the objective wasn't ambitious enough.
 */
export function goalScore(progress: number): number {
  return Math.round(clamp(progress, 0, 100)) / 100;
}
