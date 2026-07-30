/**
 * Report quality checker (§37).
 *
 * Explicitly ADVISORY: it returns suggestions and a 0–100 score, and only the
 * `blocking: true` items (genuinely missing REQUIRED fields) can stop a submission.
 * Everything else is a nudge, because a checker that refuses to let a person file
 * an honest report just teaches them to write filler.
 *
 * Pure — same code runs in the editor sidebar and in the nightly "report health"
 * cron summary.
 */

import type { Report, ReportBlock } from '../../types';
import { isBlockEmpty, isClientFacingKind } from './workflow';
import { CLIENT_VISIBILITIES, countByAudience } from './visibility';
import { findMetricContradictions } from './kpi';

export interface QualityCheck {
  key: string;
  label: string;
  /** Passed / failed / not applicable to this report. */
  state: 'pass' | 'fail' | 'n/a';
  /** Weight in the score. Ignored when `state === 'n/a'`. */
  weight: number;
  /** A failed blocking check prevents submission; everything else is advice. */
  blocking?: boolean;
  hint?: string;
}

export interface QualityResult {
  /** 0–100 over the applicable checks only. */
  score: number;
  checks: QualityCheck[];
  /** Failed checks worth acting on, most valuable first. */
  suggestions: QualityCheck[];
  /** Failed blocking checks — the submit button reads this. */
  blockers: QualityCheck[];
}

const has = (b: ReportBlock | undefined) => !!b && !isBlockEmpty(b);
const findBlock = (r: Report, type: ReportBlock['type']) => (r.blocks || []).find(b => b.type === type);

/**
 * Evaluate a report. `opts.staleAfterDays` controls the data-freshness check
 * (default 45 days: a monthly report built on 6-week-old numbers is stale).
 */
export function checkReportQuality(
  report: Report,
  opts: { now?: Date; staleAfterDays?: number } = {},
): QualityResult {
  const now = opts.now ?? new Date();
  const staleAfter = opts.staleAfterDays ?? 45;
  const clientFacing = isClientFacingKind(report.kind);
  const blocks = report.blocks || [];
  const checks: QualityCheck[] = [];

  const add = (c: QualityCheck) => checks.push(c);
  const yn = (cond: boolean): QualityCheck['state'] => (cond ? 'pass' : 'fail');

  // ── Required content ──
  const requiredBlocks = blocks.filter(b => b.required);
  const unfilledRequired = requiredBlocks.filter(isBlockEmpty);
  add({
    key: 'required-fields',
    label: 'Fushat e detyrueshme janë plotësuar',
    state: requiredBlocks.length === 0 ? 'n/a' : yn(unfilledRequired.length === 0),
    weight: 20,
    blocking: true,
    hint: unfilledRequired.length
      ? `Mungojnë: ${unfilledRequired.map(b => b.title || b.type).join(', ')}`
      : undefined,
  });

  add({
    key: 'exec-summary',
    label: 'Përmbledhja ekzekutive është shkruar',
    state: yn(has(findBlock(report, 'executive-summary'))),
    weight: 12,
    hint: 'Shpjegoni me 3–5 fjali çfarë ndodhi dhe pse ka vlerë për klientin.',
  });

  add({
    key: 'work-explained',
    label: 'Puna e kryer është shpjeguar',
    state: yn(has(findBlock(report, 'work-completed')) || has(findBlock(report, 'task-list'))),
    weight: 10,
    hint: 'Lidhni rezultatet me punën konkrete të dorëzuar.',
  });

  add({
    key: 'problems-explained',
    label: 'Problemet / kufizimet janë trajtuar',
    state: yn(
      has(findBlock(report, 'risk-register'))
      || has(findBlock(report, 'blocker-list'))
      || blocks.some(b => b.type === 'rich-text' && /problem|kufizim|vështirësi|rrezik/i.test(b.text || '')),
    ),
    weight: 8,
    hint: 'Një raport pa probleme lexohet si raport i pashkruar.',
  });

  add({
    key: 'recommendations',
    label: 'Rekomandime të konkrete',
    state: yn(has(findBlock(report, 'recommendation'))),
    weight: 10,
    hint: 'Çfarë propozoni dhe pse — jo vetëm çfarë ndodhi.',
  });

  add({
    key: 'next-steps',
    label: 'Hapat e radhës',
    state: yn(has(findBlock(report, 'next-steps'))),
    weight: 8,
  });

  add({
    key: 'client-actions',
    label: 'Veprimet e kërkuara nga klienti',
    state: clientFacing ? yn(has(findBlock(report, 'client-action'))) : 'n/a',
    weight: 6,
    hint: 'Aprovimet/materialet që presni nga klienti duhen thënë hapur.',
  });

  // ── Metrics ──
  const kpis = report.kpiValues || [];
  const withValues = kpis.filter(k => k.value !== null && k.value !== undefined);
  add({
    key: 'kpi-present',
    label: 'Ka të dhëna KPI',
    state: kpis.length === 0 ? 'fail' : yn(withValues.length > 0),
    weight: 12,
    hint: 'Shtoni të paktën një KPI me vlerë për periudhën.',
  });

  add({
    key: 'kpi-complete',
    label: 'KPI-të janë plotësuar',
    state: kpis.length === 0 ? 'n/a' : yn(withValues.length >= Math.ceil(kpis.length * 0.7)),
    weight: 6,
    hint: kpis.length ? `${withValues.length}/${kpis.length} KPI kanë vlerë.` : undefined,
  });

  add({
    key: 'comparison',
    label: 'Krahasim me periudhën e mëparshme',
    state: withValues.length === 0
      ? 'n/a'
      : yn(withValues.some(k => k.previousValue !== null && k.previousValue !== undefined)),
    weight: 8,
    hint: 'Pa krahasim, një numër nuk tregon a është mirë apo keq.',
  });

  add({
    key: 'targets',
    label: 'Objektiva të caktuara',
    state: withValues.length === 0
      ? 'n/a'
      : yn(withValues.some(k => k.target !== null && k.target !== undefined)),
    weight: 6,
    hint: 'Caktoni target-e në Menaxheri i KPI-ve për të matur arritjen.',
  });

  const contradictions = findMetricContradictions(kpis);
  add({
    key: 'metric-consistency',
    label: 'Metrikat nuk kundërshtojnë njëra-tjetrën',
    state: kpis.length === 0 ? 'n/a' : yn(contradictions.length === 0),
    weight: 10,
    hint: contradictions.length ? contradictions.join(' ') : undefined,
  });

  // ── Freshness ──
  const syncTimes = kpis.map(k => k.syncedAt).filter((d): d is Date => !!d);
  const newest = syncTimes.length ? Math.max(...syncTimes.map(d => d.getTime())) : null;
  add({
    key: 'freshness',
    label: 'Të dhënat janë të freskëta',
    state: newest === null
      ? 'n/a'
      : yn((now.getTime() - newest) / 86_400_000 <= staleAfter),
    weight: 6,
    hint: newest !== null ? `Sinkronizimi më i fundit: ${new Date(newest).toLocaleDateString('sq-AL')}.` : undefined,
  });

  // ── Client-safety ──
  const { client: clientBlocks } = countByAudience(report);
  add({
    key: 'client-content',
    label: 'Ka përmbajtje për klientin',
    state: clientFacing ? yn(clientBlocks > 0) : 'n/a',
    weight: 12,
    blocking: false,
    hint: 'Shënoni si "I dukshëm për klientin" bllokët që duhet t\'i shohë.',
  });

  const leakyInternal = blocks.filter(b =>
    CLIENT_VISIBILITIES.has(b.visibility)
    && /marzh|profit|kosto e brendshme|paga|rrog|konfidencial|internal/i.test(`${b.title || ''} ${b.text || ''}`));
  add({
    key: 'no-internal-in-client',
    label: 'Asnjë shënim i brendshëm në seksionet e klientit',
    state: clientBlocks === 0 ? 'n/a' : yn(leakyInternal.length === 0),
    weight: 15,
    hint: leakyInternal.length
      ? `Kontrolloni: ${leakyInternal.map(b => b.title || b.type).join(', ')} — dukshëm nga klienti.`
      : undefined,
  });

  const unapprovedAi = blocks.filter(b => b.aiSuggested && !b.aiApprovedByUserId);
  add({
    key: 'ai-approved',
    label: 'Përmbajtja nga AI është aprovuar',
    state: blocks.some(b => b.aiSuggested) ? yn(unapprovedAi.length === 0) : 'n/a',
    weight: 10,
    hint: unapprovedAi.length ? `${unapprovedAi.length} blok(e) presin aprovim njerëzor.` : undefined,
  });

  // ── Readability ──
  const longParagraphs = blocks.filter(b =>
    (b.type === 'rich-text' || b.type === 'executive-summary')
    && (b.text || '').split(/\n\s*\n/).some(p => p.trim().split(/\s+/).length > 180));
  add({
    key: 'readability',
    label: 'Paragrafë të lexueshëm',
    state: blocks.some(b => b.text) ? yn(longParagraphs.length === 0) : 'n/a',
    weight: 4,
    hint: longParagraphs.length ? 'Ndani paragrafët e gjatë (>180 fjalë) në pjesë më të vogla.' : undefined,
  });

  add({
    key: 'approved',
    label: 'Raporti është aprovuar brenda',
    state: clientFacing ? yn(!!report.internallyApprovedAt) : 'n/a',
    weight: 6,
  });

  // ── Score over applicable checks only ──
  const applicable = checks.filter(c => c.state !== 'n/a');
  const totalWeight = applicable.reduce((s, c) => s + c.weight, 0);
  const earned = applicable.filter(c => c.state === 'pass').reduce((s, c) => s + c.weight, 0);
  const score = totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 0;

  const failed = applicable.filter(c => c.state === 'fail');

  return {
    score,
    checks,
    suggestions: [...failed].sort((a, b) => b.weight - a.weight),
    blockers: failed.filter(c => c.blocking),
  };
}

/** Score → label + token class for the quality chip. */
export function qualityBand(score: number): { label: string; className: string } {
  if (score >= 85) return { label: 'Shkëlqyer', className: 'bg-success/10 text-success border-success/30' };
  if (score >= 70) return { label: 'Mirë', className: 'bg-success/10 text-success border-success/20' };
  if (score >= 50) return { label: 'Për përmirësim', className: 'bg-warning/10 text-warning border-warning/30' };
  return { label: 'I dobët', className: 'bg-error/10 text-error border-error/30' };
}
