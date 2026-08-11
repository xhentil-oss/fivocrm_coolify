/**
 * Daily-report quality checker.
 *
 * Deliberately ADVISORY except where something is genuinely missing. The same rule
 * the enterprise checker follows (src/lib/reporting/quality.ts): a checker that
 * refuses to accept an honest report just teaches people to write filler, and filler
 * is worse than a short answer because it looks like data.
 *
 * So there are exactly two tiers:
 *   • `blockers` — a required question is unanswered, or unfinished work has no
 *     explanation. These stop submission. Every one of them is answerable in seconds.
 *   • `suggestions` — everything else. Shown, never enforced.
 *
 * Pure: same code runs in the form, the manager view and the tests.
 */

import type { DailyTaskOutcome } from '../../types';
import type { ReportTemplate } from './reportTemplates';
import { outcomesMissingReason, outcomesMissingTitle, summariseOutcomes } from './dailyReportPlan';
import { valuesByCustomer, perClientKey } from './reportTemplates';

/** Below this, "çfarë përfundova sot" is not an answer. */
export const MIN_SUMMARY_CHARS = 15;

export interface QualityIssue {
  key: string;
  label: string;
  /** Which field to jump to / highlight, when there is one. */
  fieldKey?: string;
  hint?: string;
}

export interface DailyQualityInput {
  completedToday: string;
  planTomorrow?: string;
  blockers?: string;
  hoursWorked?: number;
  outcomes?: DailyTaskOutcome[];
  template?: ReportTemplate | null;
  customFields?: Record<string, string | number>;
  /** Clients touched today — the audience for `perClient` fields. */
  customerIds?: string[];
  /** Yesterday's `completedToday`, to catch a copy-paste. */
  previousCompletedToday?: string;
  /** A day off answers nothing: the whole form is waived. */
  workingStatus?: 'working' | 'partial' | 'leave' | 'sick' | 'holiday';
}

export interface DailyQualityResult {
  /** 0–100 over the applicable checks. */
  score: number;
  blockers: QualityIssue[];
  suggestions: QualityIssue[];
  /** True when the report may be submitted. */
  canSubmit: boolean;
  /** True when the day is a declared absence and nothing else is asked. */
  waived: boolean;
}

const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** A number field counts as answered when it holds a number — including 0. */
const isBlankNumber = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || isNaN(Number(v));

/** Normalised for comparison, so "  Punova. " and "punova" are the same answer. */
const normalise = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function checkDailyReportQuality(input: DailyQualityInput): DailyQualityResult {
  const blockers: QualityIssue[] = [];
  const suggestions: QualityIssue[] = [];

  // A declared absence is a complete answer. Asking someone on sick leave to justify
  // an empty task list is how a mandatory report turns into a joke people route around.
  if (input.workingStatus && input.workingStatus !== 'working' && input.workingStatus !== 'partial') {
    return { score: 100, blockers: [], suggestions: [], canSubmit: true, waived: true };
  }

  const outcomes = input.outcomes || [];
  const customFields = input.customFields || {};
  const customerIds = input.customerIds || [];
  const summary = summariseOutcomes(outcomes);

  // ── Blocking: unfinished work with no explanation ──
  for (const o of outcomesMissingReason(outcomes)) {
    blockers.push({
      key: `reason:${o.taskId || o.title}`,
      label: `Shkruaj pse nuk u mbyll: "${o.title}"`,
      hint: 'Një fjali mjafton. Kjo është e vetmja gjë që raporti nuk e nxjerr dot vetë.',
    });
  }

  // ── Blocking: an empty extra line the person forgot to fill ──
  if (outcomesMissingTitle(outcomes).length) {
    blockers.push({
      key: 'empty-row',
      label: 'Ke një rresht pune të paplotësuar',
      hint: 'Shkruaj çfarë ishte, ose hiqe rreshtin.',
    });
  }

  // ── Blocking: the summary itself ──
  const summaryText = (input.completedToday || '').trim();
  if (!summaryText) {
    blockers.push({ key: 'summary-empty', label: 'Plotëso "Çfarë përfundova sot"', fieldKey: 'completedToday' });
  } else if (summaryText.length < MIN_SUMMARY_CHARS) {
    blockers.push({
      key: 'summary-short',
      label: 'Përmbledhja është shumë e shkurtër',
      fieldKey: 'completedToday',
      hint: `Të paktën ${MIN_SUMMARY_CHARS} karaktere — mjafton një fjali e vërtetë.`,
    });
  }

  // ── Blocking: required template questions ──
  const fields = input.template?.fields || [];
  for (const f of fields) {
    if (!f.required) continue;

    if (f.perClient) {
      // Nobody is asked about clients they did not touch; but if they touched some,
      // at least one answer is owed.
      if (!customerIds.length) continue;
      const answered = valuesByCustomer(customFields, f.key).length > 0;
      if (!answered) {
        blockers.push({ key: `required:${f.key}`, label: `Plotëso "${f.label}"`, fieldKey: f.key });
      }
      continue;
    }

    const value = customFields[f.key];
    const missing = f.type === 'number' ? isBlankNumber(value) : isBlank(value);
    if (missing) {
      blockers.push({ key: `required:${f.key}`, label: `Plotëso "${f.label}"`, fieldKey: f.key });
      continue;
    }
    if (f.minChars && typeof value === 'string' && value.trim().length < f.minChars) {
      blockers.push({
        key: `short:${f.key}`,
        label: `"${f.label}" është shumë i shkurtër`,
        fieldKey: f.key,
        hint: `Të paktën ${f.minChars} karaktere.`,
      });
    }
  }

  // ── Suggestions ──
  for (const f of fields) {
    if (f.required || !f.minChars) continue;
    const value = customFields[f.key];
    if (typeof value === 'string' && value.trim() && value.trim().length < f.minChars) {
      suggestions.push({ key: `short:${f.key}`, label: `"${f.label}" mund të thotë pak më shumë`, fieldKey: f.key });
    }
  }

  if (isBlank(input.planTomorrow)) {
    suggestions.push({
      key: 'no-plan',
      label: 'Nuk ke shkruar planin e nesërm',
      fieldKey: 'planTomorrow',
      hint: 'Ky bëhet plani yt i mëngjesit — pa të, dita nis nga e para.',
    });
  }

  const hours = Number(input.hoursWorked || 0);
  // Only countable output rescues a full day: a closed task, unplanned work, or a
  // metric above zero. Prose does not count here on purpose — "hapi tjetër: audit"
  // is a promise about tomorrow, not something that came out of today.
  const numericOutput = Object.values(customFields).some(v => {
    const n = Number(v);
    return !isBlank(v) && !isNaN(n) && n > 0;
  });
  const producedSomething = summary.done > 0 || summary.unplanned > 0 || numericOutput;
  if (hours >= 6 && !producedSomething) {
    suggestions.push({
      key: 'hours-without-output',
      label: `${hours} orë pa asnjë rezultat të regjistruar`,
      hint: 'Nëse dita shkoi në takime ose mbështetje, shkruaje si punë e paplanifikuar.',
    });
  }

  if (
    input.previousCompletedToday
    && summaryText
    && normalise(input.previousCompletedToday) === normalise(summaryText)
  ) {
    suggestions.push({
      key: 'same-as-yesterday',
      label: 'Përmbledhja është fjalë për fjalë si dje',
      fieldKey: 'completedToday',
      hint: 'Nëse dita ishte vërtet e njëjtë, shkruaj çfarë e bllokoi përparimin.',
    });
  }

  // Clients were served but no per-client field was filled — the client breakdown is
  // the reason those fields exist, so an empty one is worth pointing at (never blocking).
  const perClientFields = fields.filter(f => f.perClient && !f.required);
  if (customerIds.length && perClientFields.length) {
    const anyFilled = perClientFields.some(f =>
      customerIds.some(cid => !isBlank(customFields[perClientKey(f.key, cid)])));
    if (!anyFilled) {
      suggestions.push({
        key: 'no-per-client',
        label: 'Asnjë e dhënë sipas klientit',
        hint: 'Këto janë numrat që shkojnë në raportin e klientit.',
      });
    }
  }

  if (summary.planned > 0 && summary.done === 0 && summary.notStarted === summary.planned) {
    suggestions.push({
      key: 'nothing-touched',
      label: 'Asnjë nga detyrat e planifikuara nuk u prek',
      hint: 'Nëse plani ishte i gabuar, thuaje — kjo është informacion, jo dështim.',
    });
  }

  // ── Score ──
  // Blockers cost far more than suggestions: an unanswered required question is a
  // hole in the report, a missing plan is only a weakness.
  const penalty = blockers.length * 20 + suggestions.length * 6;
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return { score, blockers, suggestions, canSubmit: blockers.length === 0, waived: false };
}
