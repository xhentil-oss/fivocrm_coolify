import { describe, expect, it } from 'vitest';
import {
  CLIENT_HEALTH_LABELS,
  DEFAULT_HEALTH_WEIGHTS,
  HEALTH_LABELS,
  computeClientHealth,
  healthCategory,
  overrideNeedsReason,
  suggestProjectHealth,
} from './health';

describe('suggestProjectHealth — lifecycle short-circuits', () => {
  it('reports a completed project as blue, not green', () => {
    const s = suggestProjectHealth({ projectStatus: 'completed', overdueTasks: 10 });
    expect(s.health).toBe('blue');
    expect(s.severity).toBe(0);
  });

  it('reports a paused project as grey', () => {
    expect(suggestProjectHealth({ projectStatus: 'paused', activeBlockers: 5 }).health).toBe('grey');
  });
});

describe('suggestProjectHealth — RAG', () => {
  it('is green with no risk signals', () => {
    const s = suggestProjectHealth({ projectStatus: 'active', overdueTasks: 0, activeBlockers: 0 });
    expect(s.health).toBe('green');
    expect(s.reasons).toEqual(['Nuk u zbulua asnjë sinjal rreziku.']);
  });

  it('goes yellow on a moderate signal', () => {
    const s = suggestProjectHealth({ projectStatus: 'active', activeBlockers: 1 });
    expect(s.health).toBe('yellow');
  });

  it('goes red on a critical issue', () => {
    const s = suggestProjectHealth({ projectStatus: 'active', openCriticalIssues: 1 });
    expect(s.health).toBe('red');
  });

  it('goes red when the deadline has passed', () => {
    expect(suggestProjectHealth({ projectStatus: 'active', daysToDeadline: -5 }).health).toBe('red');
  });

  it('always explains itself', () => {
    const s = suggestProjectHealth({
      projectStatus: 'active',
      overdueTasks: 6,
      totalOpenTasks: 10,
      missedMilestones: 2,
      activeBlockers: 3,
    });
    expect(s.reasons.length).toBeGreaterThanOrEqual(3);
    expect(s.reasons.join(' ')).toContain('6 detyra të vonuara');
    expect(s.reasons.join(' ')).toContain('2 milestone');
  });

  it('orders reasons most-severe first', () => {
    const s = suggestProjectHealth({ projectStatus: 'active', openCriticalIssues: 1, pendingClientApprovals: 1 });
    expect(s.reasons[0]).toContain('kritik');
  });

  it('flags a budget burning faster than the timeline', () => {
    const s = suggestProjectHealth({ projectStatus: 'active', budgetConsumed: 0.9, timeElapsed: 0.4 });
    expect(s.reasons.join(' ')).toContain('Buxheti është konsumuar 90%');
    expect(s.health).toBe('yellow');
  });

  it('does not flag a budget in step with the timeline', () => {
    const s = suggestProjectHealth({ projectStatus: 'active', budgetConsumed: 0.5, timeElapsed: 0.5 });
    expect(s.health).toBe('green');
  });

  it('flags stalled projects by inactivity', () => {
    expect(suggestProjectHealth({ projectStatus: 'active', daysSinceActivity: 20 }).health).toBe('yellow');
  });

  it('labels every RAG value', () => {
    for (const key of ['green', 'yellow', 'red', 'blue', 'grey'] as const) {
      expect(HEALTH_LABELS[key].length).toBeGreaterThan(0);
    }
  });
});

describe('overrideNeedsReason', () => {
  it('demands a reason only when the manager contradicts the system', () => {
    expect(overrideNeedsReason('red', 'green')).toBe(true);
    expect(overrideNeedsReason('red', 'red')).toBe(false);
    expect(overrideNeedsReason(undefined, 'green')).toBe(false);
  });
});

describe('computeClientHealth', () => {
  it('scores a healthy account high', () => {
    const r = computeClientHealth({
      status: 'active',
      kpiAttainment: 1.1,
      reportsDelivered: 3,
      reportsDue: 3,
      satisfaction: 5,
      openIssues: 0,
      overdueClientApprovals: 0,
      overdueInvoices: 0,
      worstProjectHealth: 'green',
      touchpoints: 8,
      expectedTouchpoints: 8,
      unansweredMessages: 0,
      scopeChanges: 0,
      margin: 0.45,
      daysToRenewal: 200,
      supportTickets: 0,
      negativeFeedbackCount: 0,
    });
    expect(r.score).toBeGreaterThanOrEqual(95);
    expect(r.category).toBe('excellent');
    expect(r.topRisks).toEqual([]);
  });

  it('scores a failing account low and names the risks', () => {
    const r = computeClientHealth({
      status: 'active',
      kpiAttainment: 0.3,
      reportsDelivered: 0,
      reportsDue: 3,
      satisfaction: 2,
      openIssues: 5,
      overdueClientApprovals: 4,
      overdueInvoices: 3,
      worstProjectHealth: 'red',
      unansweredMessages: 6,
      margin: 0.05,
    });
    expect(r.score).toBeLessThan(35);
    expect(r.category).toBe('critical');
    expect(r.topRisks.length).toBeGreaterThan(0);
    expect(r.topRisks.map(f => f.key)).toContain('results');
  });

  it('never returns a score without factors that explain it', () => {
    const r = computeClientHealth({ status: 'active', kpiAttainment: 0.8, reportsDelivered: 2, reportsDue: 2 });
    expect(r.factors.length).toBe(2);
    for (const f of r.factors) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.detail).toBeTruthy();
      expect(f.weight).toBeGreaterThan(0);
    }
  });

  it('excludes missing factors from the denominator instead of scoring them 0.5', () => {
    // A client with only "results" data at 100% must score 100, not be dragged
    // toward the middle by eleven unknown factors.
    const r = computeClientHealth({ status: 'active', kpiAttainment: 1 });
    expect(r.factors).toHaveLength(1);
    expect(r.score).toBe(100);
  });

  it('reports a paused client as paused rather than failing', () => {
    const r = computeClientHealth({ status: 'paused', kpiAttainment: 0.1, openIssues: 9 });
    expect(r.category).toBe('paused');
  });

  it('handles a client with no data at all', () => {
    const r = computeClientHealth({});
    expect(r.score).toBe(0);
    expect(r.factors).toEqual([]);
  });

  it('caps over-achievement so one metric cannot inflate the score past 100', () => {
    const r = computeClientHealth({ status: 'active', kpiAttainment: 5, reportsDelivered: 9, reportsDue: 3 });
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('respects custom weights', () => {
    const signals = { status: 'active' as const, kpiAttainment: 0, satisfaction: 5 };
    const resultsHeavy = computeClientHealth(signals, { ...DEFAULT_HEALTH_WEIGHTS, results: 90, satisfaction: 10 });
    const satisfactionHeavy = computeClientHealth(signals, { ...DEFAULT_HEALTH_WEIGHTS, results: 10, satisfaction: 90 });
    expect(satisfactionHeavy.score).toBeGreaterThan(resultsHeavy.score);
  });

  it('flags a lapsed contract as a renewal risk', () => {
    const r = computeClientHealth({ status: 'active', kpiAttainment: 1, daysToRenewal: -10 });
    const renewal = r.factors.find(f => f.key === 'renewal');
    expect(renewal?.score).toBe(0);
    expect(renewal?.detail).toContain('skaduar');
  });

  it('penalises unanswered messages even when touchpoint volume is fine', () => {
    const busy = computeClientHealth({ status: 'active', touchpoints: 10, expectedTouchpoints: 8, unansweredMessages: 0 });
    const ignoring = computeClientHealth({ status: 'active', touchpoints: 10, expectedTouchpoints: 8, unansweredMessages: 5 });
    expect(ignoring.score).toBeLessThan(busy.score);
  });
});

describe('healthCategory', () => {
  it('bands the whole 0–100 range', () => {
    expect(healthCategory(95)).toBe('excellent');
    expect(healthCategory(75)).toBe('healthy');
    expect(healthCategory(60)).toBe('attention');
    expect(healthCategory(40)).toBe('at_risk');
    expect(healthCategory(10)).toBe('critical');
  });

  it('labels every category', () => {
    for (const key of Object.keys(CLIENT_HEALTH_LABELS) as Array<keyof typeof CLIENT_HEALTH_LABELS>) {
      expect(CLIENT_HEALTH_LABELS[key].length).toBeGreaterThan(0);
    }
  });
});
