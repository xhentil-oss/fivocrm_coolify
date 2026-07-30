/**
 * Health scoring — project RAG suggestion and client health score.
 *
 * Two hard product rules shape this file:
 *
 *   • A suggested status is a SUGGESTION. `suggestProjectHealth()` returns the RAG
 *     *and the reasons*, and the manager may override it — but the override needs a
 *     written reason (enforced in the UI + the workflow guard).
 *
 *   • A score is never shown unexplained. `computeClientHealth()` returns every
 *     factor with its own sub-score, weight and point impact, so the dashboard can
 *     always answer "why 62?".
 *
 * Everything is a pure function over plain inputs the caller has already gathered,
 * so the same code runs in the browser dashboard and in the nightly cron rollup.
 */

import type {
  ClientHealthCategory,
  ClientHealthFactor,
  ReportHealth,
} from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// Project / report RAG
// ─────────────────────────────────────────────────────────────────────────────

/** Observable signals that decide a project's RAG. All optional — missing = unknown. */
export interface ProjectHealthSignals {
  /** Project lifecycle, so a finished/paused project isn't flagged "red". */
  projectStatus?: 'active' | 'completed' | 'paused' | 'cancelled';
  overdueTasks?: number;
  totalOpenTasks?: number;
  missedMilestones?: number;
  /** Fraction of budget consumed (0.85 = 85%). */
  budgetConsumed?: number;
  /** Fraction of the timeline elapsed (0.5 = halfway). */
  timeElapsed?: number;
  /** Fraction of scoped hours consumed. */
  hoursConsumed?: number;
  /** Client requests with no staff answer yet. */
  unansweredClientRequests?: number;
  /** Approvals the client owes us. */
  pendingClientApprovals?: number;
  openCriticalIssues?: number;
  /** Blockers reported in daily reports for this project, still unresolved. */
  activeBlockers?: number;
  /** Days since the last activity (task/time entry/comment) on the project. */
  daysSinceActivity?: number;
  /** Days until the deadline; negative = already past. */
  daysToDeadline?: number;
  /** Reported completion, 0–100. */
  progressPercent?: number;
}

/** Accumulated severity at which the suggestion turns red / yellow. */
export const RED_THRESHOLD = 45;
export const YELLOW_THRESHOLD = 18;

export interface HealthSuggestion {
  health: ReportHealth;
  /** Human-readable, Albanian, ordered most-severe first. */
  reasons: string[];
  /** 0–100 internal severity, exposed for sorting "worst first" lists. */
  severity: number;
}

/**
 * Suggest a RAG status from CRM signals.
 *
 * The scoring is additive severity with named thresholds rather than a black-box
 * formula, so every point of severity maps to a sentence the manager can read.
 */
export function suggestProjectHealth(s: ProjectHealthSignals): HealthSuggestion {
  if (s.projectStatus === 'completed') {
    return { health: 'blue', reasons: ['Projekti është përfunduar.'], severity: 0 };
  }
  if (s.projectStatus === 'paused' || s.projectStatus === 'cancelled') {
    return {
      health: 'grey',
      reasons: [s.projectStatus === 'paused' ? 'Projekti është në pauzë.' : 'Projekti është anuluar.'],
      severity: 0,
    };
  }

  const reasons: Array<{ text: string; weight: number }> = [];
  const add = (weight: number, text: string) => reasons.push({ text, weight });

  // Red on its own: a single unresolved critical issue is not an "amber" situation,
  // and neither is a deadline that has already passed. Both are weighted at or
  // above the red threshold so they cannot be averaged away by healthy signals.
  if (s.openCriticalIssues && s.openCriticalIssues > 0) {
    add(RED_THRESHOLD, `${s.openCriticalIssues} problem${s.openCriticalIssues === 1 ? '' : 'e'} kritik${s.openCriticalIssues === 1 ? '' : 'e'} të hapur${s.openCriticalIssues === 1 ? '' : 'a'}.`);
  }
  if (s.activeBlockers && s.activeBlockers > 0) {
    add(s.activeBlockers >= 3 ? 30 : 18, `${s.activeBlockers} bllokues aktiv${s.activeBlockers === 1 ? '' : 'ë'} nga raportet ditore.`);
  }
  if (s.missedMilestones && s.missedMilestones > 0) {
    add(Math.min(35, 15 + s.missedMilestones * 8), `${s.missedMilestones} milestone të humbur.`);
  }
  if (s.overdueTasks && s.overdueTasks > 0) {
    const share = s.totalOpenTasks && s.totalOpenTasks > 0 ? s.overdueTasks / s.totalOpenTasks : 1;
    add(
      share > 0.4 ? 30 : share > 0.2 ? 20 : 10,
      `${s.overdueTasks} detyra të vonuara${s.totalOpenTasks ? ` nga ${s.totalOpenTasks} të hapura` : ''}.`,
    );
  }
  // Budget/timeline mismatch: burning money faster than delivering time.
  if (s.budgetConsumed !== undefined && s.timeElapsed !== undefined) {
    const gap = s.budgetConsumed - s.timeElapsed;
    if (gap > 0.25) add(28, `Buxheti është konsumuar ${pct(s.budgetConsumed)} ndërsa afati ka kaluar ${pct(s.timeElapsed)}.`);
    else if (gap > 0.12) add(14, `Buxheti ecën më shpejt se afati (${pct(s.budgetConsumed)} vs ${pct(s.timeElapsed)}).`);
  } else if (s.budgetConsumed !== undefined && s.budgetConsumed > 0.95) {
    add(24, `Buxheti është konsumuar ${pct(s.budgetConsumed)}.`);
  }
  if (s.hoursConsumed !== undefined && s.hoursConsumed > 1) {
    add(26, `Orët e planifikuara janë tejkaluar (${pct(s.hoursConsumed)}).`);
  }
  if (s.unansweredClientRequests && s.unansweredClientRequests > 0) {
    add(s.unansweredClientRequests >= 3 ? 20 : 12, `${s.unansweredClientRequests} kërkesa të klientit pa përgjigje.`);
  }
  if (s.pendingClientApprovals && s.pendingClientApprovals > 0) {
    add(s.pendingClientApprovals >= 3 ? 18 : 10, `${s.pendingClientApprovals} aprovime presin klientin.`);
  }
  if (s.daysSinceActivity !== undefined && s.daysSinceActivity >= 14) {
    add(22, `Pa aktivitet për ${s.daysSinceActivity} ditë.`);
  } else if (s.daysSinceActivity !== undefined && s.daysSinceActivity >= 7) {
    add(12, `Pa aktivitet për ${s.daysSinceActivity} ditë.`);
  }
  if (s.daysToDeadline !== undefined) {
    if (s.daysToDeadline < 0) add(RED_THRESHOLD, `Afati ka kaluar ${Math.abs(s.daysToDeadline)} ditë.`);
    else if (s.daysToDeadline <= 7 && (s.progressPercent ?? 100) < 80) {
      add(20, `${s.daysToDeadline} ditë deri në afat me progres ${Math.round(s.progressPercent ?? 0)}%.`);
    }
  }

  const severity = Math.min(100, reasons.reduce((sum, r) => sum + r.weight, 0));
  const health: ReportHealth = severity >= RED_THRESHOLD ? 'red' : severity >= YELLOW_THRESHOLD ? 'yellow' : 'green';
  const ordered = reasons.sort((a, b) => b.weight - a.weight).map(r => r.text);
  return {
    health,
    reasons: ordered.length ? ordered : ['Nuk u zbulua asnjë sinjal rreziku.'],
    severity,
  };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const HEALTH_LABELS: Record<ReportHealth, string> = {
  green: 'Në rrugë të mirë',
  yellow: 'Kërkon vëmendje',
  red: 'Kritik / bllokuar',
  blue: 'Përfunduar',
  grey: 'Në pauzë / në pritje',
};

/** Tailwind token classes, matching the palette used elsewhere in the app. */
export const HEALTH_CLASSES: Record<ReportHealth, string> = {
  green: 'bg-success/10 text-success border-success/30',
  yellow: 'bg-warning/10 text-warning border-warning/30',
  red: 'bg-error/10 text-error border-error/30',
  blue: 'bg-primary/10 text-primary border-primary/30',
  grey: 'bg-muted text-muted-foreground border-border',
};

/** Does an override need a written reason? Only when it contradicts the suggestion. */
export function overrideNeedsReason(suggested: ReportHealth | undefined, chosen: ReportHealth): boolean {
  if (!suggested) return false;
  return suggested !== chosen;
}

// ─────────────────────────────────────────────────────────────────────────────
// Client health
// ─────────────────────────────────────────────────────────────────────────────

/** Signals for one client over a period. Every field optional — missing = skipped. */
export interface ClientHealthSignals {
  /** Client relationship state; a paused client is reported as paused, not "critical". */
  status?: 'active' | 'paused' | 'churned';
  /** Mean KPI attainment across the client's client-visible KPIs (1 = on target). */
  kpiAttainment?: number | null;
  /** Reports delivered / reports due in the window. */
  reportsDelivered?: number;
  reportsDue?: number;
  /** Latest client satisfaction, 1–5. */
  satisfaction?: number | null;
  openIssues?: number;
  overdueClientApprovals?: number;
  overdueInvoices?: number;
  /** Worst project RAG among the client's active projects. */
  worstProjectHealth?: ReportHealth;
  /** Messages/calls logged in the window. */
  touchpoints?: number;
  /** Expected touchpoints for the window (from the service agreement). */
  expectedTouchpoints?: number;
  unansweredMessages?: number;
  scopeChanges?: number;
  /** Gross margin on the account as a fraction (0.35 = 35%). */
  margin?: number | null;
  /** Days until contract renewal; negative = expired. */
  daysToRenewal?: number | null;
  supportTickets?: number;
  negativeFeedbackCount?: number;
}

/** Weight per factor. Tenants may override; the defaults are the shipped model. */
export interface ClientHealthWeights {
  results: number;
  reporting: number;
  satisfaction: number;
  issues: number;
  approvals: number;
  payments: number;
  projects: number;
  communication: number;
  scope: number;
  profitability: number;
  renewal: number;
  support: number;
}

export const DEFAULT_HEALTH_WEIGHTS: ClientHealthWeights = {
  results: 22,
  reporting: 12,
  satisfaction: 12,
  issues: 8,
  approvals: 6,
  payments: 8,
  projects: 10,
  communication: 8,
  scope: 4,
  profitability: 6,
  renewal: 2,
  support: 2,
};

export interface ClientHealthResult {
  score: number;
  category: ClientHealthCategory;
  factors: ClientHealthFactor[];
  /** Factors that pulled the score down most — the "what to fix" list. */
  topRisks: ClientHealthFactor[];
}

/**
 * Blend the signals into a 0–100 score.
 *
 * Only factors with data participate: the weights of missing factors are removed
 * from the denominator, so a client with no satisfaction survey isn't punished for
 * it (the alternative — treating "unknown" as 0.5 — silently drags every score to
 * the middle and makes the number useless).
 */
export function computeClientHealth(
  s: ClientHealthSignals,
  weights: ClientHealthWeights = DEFAULT_HEALTH_WEIGHTS,
): ClientHealthResult {
  const factors: ClientHealthFactor[] = [];
  const push = (
    key: keyof ClientHealthWeights,
    label: string,
    score: number | null,
    detail?: string,
  ) => {
    if (score === null || Number.isNaN(score)) return;
    factors.push({
      key,
      label,
      detail,
      score: clamp01(score),
      weight: weights[key],
      impact: 0, // filled in below, once the denominator is known
    });
  };

  // Results against targets — the single biggest factor.
  if (s.kpiAttainment !== undefined && s.kpiAttainment !== null) {
    push('results', 'Rezultatet ndaj objektivave', Math.min(1, s.kpiAttainment),
      `Arritja mesatare ${Math.round(s.kpiAttainment * 100)}% e targetit`);
  }

  // Reporting consistency.
  if (s.reportsDue && s.reportsDue > 0) {
    const ratio = (s.reportsDelivered || 0) / s.reportsDue;
    push('reporting', 'Konsistenca e raportimit', Math.min(1, ratio),
      `${s.reportsDelivered || 0}/${s.reportsDue} raporte të dorëzuara`);
  }

  if (s.satisfaction !== undefined && s.satisfaction !== null) {
    push('satisfaction', 'Kënaqësia e klientit', (s.satisfaction - 1) / 4, `${s.satisfaction}/5`);
  }

  if (s.openIssues !== undefined) {
    push('issues', 'Probleme të hapura', decay(s.openIssues, 4),
      s.openIssues === 0 ? 'Pa probleme të hapura' : `${s.openIssues} probleme të hapura`);
  }

  if (s.overdueClientApprovals !== undefined) {
    push('approvals', 'Aprovime të vonuara', decay(s.overdueClientApprovals, 3),
      s.overdueClientApprovals === 0 ? 'Pa aprovime të vonuara' : `${s.overdueClientApprovals} aprovime të vonuara`);
  }

  if (s.overdueInvoices !== undefined) {
    push('payments', 'Pagesa në kohë', decay(s.overdueInvoices, 2),
      s.overdueInvoices === 0 ? 'Pa fatura të vonuara' : `${s.overdueInvoices} fatura të vonuara`);
  }

  if (s.worstProjectHealth) {
    const map: Record<ReportHealth, number> = { green: 1, blue: 1, grey: 0.6, yellow: 0.55, red: 0.15 };
    push('projects', 'Shëndeti i projekteve', map[s.worstProjectHealth],
      `Projekti më i rrezikuar: ${HEALTH_LABELS[s.worstProjectHealth]}`);
  }

  if (s.expectedTouchpoints && s.expectedTouchpoints > 0) {
    const ratio = (s.touchpoints || 0) / s.expectedTouchpoints;
    let commScore = Math.min(1, ratio);
    let detail = `${s.touchpoints || 0}/${s.expectedTouchpoints} kontakte`;
    if (s.unansweredMessages && s.unansweredMessages > 0) {
      commScore = Math.min(commScore, decay(s.unansweredMessages, 3));
      detail += `, ${s.unansweredMessages} mesazhe pa përgjigje`;
    }
    push('communication', 'Komunikimi', commScore, detail);
  } else if (s.unansweredMessages !== undefined) {
    push('communication', 'Komunikimi', decay(s.unansweredMessages, 3),
      s.unansweredMessages === 0 ? 'Pa mesazhe pa përgjigje' : `${s.unansweredMessages} mesazhe pa përgjigje`);
  }

  if (s.scopeChanges !== undefined) {
    push('scope', 'Stabiliteti i qëllimit', decay(s.scopeChanges, 5),
      s.scopeChanges === 0 ? 'Pa ndryshime qëllimi' : `${s.scopeChanges} ndryshime qëllimi`);
  }

  if (s.margin !== undefined && s.margin !== null) {
    // 0% margin → 0, 40%+ margin → 1. Negative margin scores 0.
    push('profitability', 'Profitabiliteti', clamp01(s.margin / 0.4), `Marzh ${Math.round(s.margin * 100)}%`);
  }

  if (s.daysToRenewal !== undefined && s.daysToRenewal !== null) {
    // Imminent (or lapsed) renewal is a risk signal, not a judgement of the client.
    const score = s.daysToRenewal < 0 ? 0 : s.daysToRenewal < 30 ? 0.5 : 1;
    push('renewal', 'Rinovimi i kontratës', score,
      s.daysToRenewal < 0 ? `Kontrata ka skaduar ${Math.abs(s.daysToRenewal)} ditë më parë`
        : `${s.daysToRenewal} ditë deri në rinovim`);
  }

  if (s.supportTickets !== undefined || s.negativeFeedbackCount !== undefined) {
    const tickets = s.supportTickets || 0;
    const negative = s.negativeFeedbackCount || 0;
    push('support', 'Suporti & feedback-u', Math.min(decay(tickets, 8), decay(negative, 2)),
      `${tickets} tiketa, ${negative} feedback negativ`);
  }

  // Paused clients are reported as paused rather than scored as failing.
  if (s.status === 'paused') {
    return { score: 0, category: 'paused', factors: withImpacts(factors, 0), topRisks: [] };
  }

  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  if (totalWeight === 0) {
    return { score: 0, category: 'attention', factors: [], topRisks: [] };
  }
  const weighted = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
  const score = Math.round((weighted / totalWeight) * 100);
  const withImpact = withImpacts(factors, totalWeight);

  return {
    score,
    category: healthCategory(score),
    factors: withImpact,
    // Biggest point losses first — "what to fix", not "what scored lowest".
    topRisks: [...withImpact]
      .map(f => ({ f, loss: (1 - f.score) * (f.weight / totalWeight) * 100 }))
      .filter(x => x.loss >= 1)
      .sort((a, b) => b.loss - a.loss)
      .slice(0, 4)
      .map(x => x.f),
  };
}

function withImpacts(factors: ClientHealthFactor[], totalWeight: number): ClientHealthFactor[] {
  if (totalWeight <= 0) return factors.map(f => ({ ...f, impact: 0 }));
  return factors.map(f => ({
    ...f,
    impact: Math.round((f.score * f.weight / totalWeight) * 1000) / 10,
  }));
}

export function healthCategory(score: number): ClientHealthCategory {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'healthy';
  if (score >= 55) return 'attention';
  if (score >= 35) return 'at_risk';
  return 'critical';
}

export const CLIENT_HEALTH_LABELS: Record<ClientHealthCategory, string> = {
  excellent: 'Shkëlqyer',
  healthy: 'Shëndetshëm',
  attention: 'Kërkon vëmendje',
  at_risk: 'Në rrezik',
  critical: 'Kritik',
  paused: 'Në pauzë',
};

export const CLIENT_HEALTH_CLASSES: Record<ClientHealthCategory, string> = {
  excellent: 'bg-success/10 text-success border-success/30',
  healthy: 'bg-success/10 text-success border-success/20',
  attention: 'bg-warning/10 text-warning border-warning/30',
  at_risk: 'bg-error/10 text-error border-error/20',
  critical: 'bg-error/10 text-error border-error/40',
  paused: 'bg-muted text-muted-foreground border-border',
};

/** 1 when count is 0, decaying toward 0 as count approaches `tolerance`. */
function decay(count: number, tolerance: number): number {
  if (count <= 0) return 1;
  return clamp01(1 - count / Math.max(1, tolerance));
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
