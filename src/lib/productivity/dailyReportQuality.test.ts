import { describe, it, expect } from 'vitest';
import { checkDailyReportQuality, MIN_SUMMARY_CHARS } from './dailyReportQuality';
import { getReportTemplate, perClientKey } from './reportTemplates';
import type { DailyTaskOutcome } from '../../types';

const LONG = 'Përfundova optimizimin e faqes së shërbimeve për Klientin A';

/** A report that passes everything, so each test can break exactly one thing. */
function goodSeoInput(over: Partial<Parameters<typeof checkDailyReportQuality>[0]> = {}) {
  return {
    completedToday: LONG,
    planTomorrow: 'Vazhdoj auditin teknik',
    hoursWorked: 8,
    outcomes: [{ taskId: 't1', title: 'Optimizim', state: 'done' }] as DailyTaskOutcome[],
    template: getReportTemplate('seo'),
    customFields: {
      rankingNotes: 'Faqja e shërbimeve u optimizua për tri fjalë kyçe me volum të lartë.',
      nextStep: 'Audit teknik për Klientin B',
    } as Record<string, string | number>,
    customerIds: [] as string[],
    ...over,
  };
}

describe('a complete report submits cleanly', () => {
  it('has no blockers and a full score', () => {
    const r = checkDailyReportQuality(goodSeoInput());
    expect(r.blockers).toEqual([]);
    expect(r.suggestions).toEqual([]);
    expect(r.canSubmit).toBe(true);
    expect(r.score).toBe(100);
  });
});

describe('unfinished work must be explained', () => {
  it('blocks a planned task left without a reason', () => {
    const r = checkDailyReportQuality(goodSeoInput({
      outcomes: [{ taskId: 't1', title: 'Auditi teknik', state: 'not_started' }],
    }));
    expect(r.canSubmit).toBe(false);
    expect(r.blockers.some(b => b.label.includes('Auditi teknik'))).toBe(true);
  });

  it('accepts it once the reason is there', () => {
    const r = checkDailyReportQuality(goodSeoInput({
      outcomes: [{ taskId: 't1', title: 'Auditi teknik', state: 'not_started', reason: 'Pa akses te Search Console' }],
    }));
    expect(r.canSubmit).toBe(true);
  });

  it('never demands a reason for unplanned work', () => {
    const r = checkDailyReportQuality(goodSeoInput({
      outcomes: [{ title: 'Thirrje urgjente', state: 'in_progress', unplanned: true }],
    }));
    expect(r.canSubmit).toBe(true);
  });

  it('blocks an unplanned row left blank', () => {
    const r = checkDailyReportQuality(goodSeoInput({
      outcomes: [{ title: '', state: 'done', unplanned: true }],
    }));
    expect(r.blockers.some(b => b.key === 'empty-row')).toBe(true);
  });
});

describe('the summary itself', () => {
  it('blocks an empty one', () => {
    const r = checkDailyReportQuality(goodSeoInput({ completedToday: '   ' }));
    expect(r.blockers.some(b => b.key === 'summary-empty')).toBe(true);
  });

  it('blocks "ok"', () => {
    const r = checkDailyReportQuality(goodSeoInput({ completedToday: 'ok' }));
    expect(r.blockers.some(b => b.key === 'summary-short')).toBe(true);
  });

  it('accepts anything at the threshold', () => {
    const r = checkDailyReportQuality(goodSeoInput({ completedToday: 'x'.repeat(MIN_SUMMARY_CHARS) }));
    expect(r.blockers.some(b => b.key.startsWith('summary'))).toBe(false);
  });
});

describe('required template questions', () => {
  it('blocks a missing required field', () => {
    const r = checkDailyReportQuality(goodSeoInput({
      customFields: { rankingNotes: 'x'.repeat(40) },
    }));
    expect(r.blockers.some(b => b.fieldKey === 'nextStep')).toBe(true);
  });

  it('blocks a required field that is too short to mean anything', () => {
    const r = checkDailyReportQuality(goodSeoInput({
      customFields: { rankingNotes: 'do rritet', nextStep: 'audit' },
    }));
    expect(r.blockers.some(b => b.key === 'short:rankingNotes')).toBe(true);
  });

  it('treats 0 as a real answer for a required number', () => {
    // Social asks for unanswered messages. Zero is the BEST possible answer and must
    // not read as "unfilled".
    const social = getReportTemplate('social');
    const base = {
      completedToday: LONG,
      template: social,
      outcomes: [] as DailyTaskOutcome[],
      customFields: { unansweredMessages: 0, tomorrowCalendarReady: 'Po' } as Record<string, string | number>,
    };
    expect(checkDailyReportQuality(base).blockers.some(b => b.fieldKey === 'unansweredMessages')).toBe(false);
    expect(
      checkDailyReportQuality({ ...base, customFields: { tomorrowCalendarReady: 'Po' } })
        .blockers.some(b => b.fieldKey === 'unansweredMessages'),
    ).toBe(true);
  });

  it('asks a required per-client question only when a client was served', () => {
    const template = {
      key: 'x', label: 'X', emoji: '⭐',
      fields: [{ key: 'perClientReq', label: 'Për klient', type: 'text' as const, kind: 'output' as const, required: true, perClient: true }],
    };
    const none = checkDailyReportQuality({ completedToday: LONG, template, customerIds: [] });
    expect(none.blockers.some(b => b.fieldKey === 'perClientReq')).toBe(false);

    const some = checkDailyReportQuality({ completedToday: LONG, template, customerIds: ['c1'] });
    expect(some.blockers.some(b => b.fieldKey === 'perClientReq')).toBe(true);

    const answered = checkDailyReportQuality({
      completedToday: LONG, template, customerIds: ['c1'],
      customFields: { [perClientKey('perClientReq', 'c1')]: 'po' },
    });
    expect(answered.blockers.some(b => b.fieldKey === 'perClientReq')).toBe(false);
  });
});

describe('suggestions never block', () => {
  it('points at a missing plan for tomorrow', () => {
    const r = checkDailyReportQuality(goodSeoInput({ planTomorrow: '' }));
    expect(r.canSubmit).toBe(true);
    expect(r.suggestions.some(s => s.key === 'no-plan')).toBe(true);
    expect(r.score).toBeLessThan(100);
  });

  it('notices a full day with nothing to show for it', () => {
    const r = checkDailyReportQuality(goodSeoInput({
      hoursWorked: 8,
      outcomes: [{ taskId: 't1', title: 'A', state: 'not_started', reason: 'pres' }],
      customFields: { rankingNotes: 'x'.repeat(40), nextStep: 'y' },
    }));
    expect(r.suggestions.some(s => s.key === 'hours-without-output')).toBe(true);
    expect(r.canSubmit).toBe(true);
  });

  it('catches a copy-paste of yesterday', () => {
    const r = checkDailyReportQuality(goodSeoInput({ previousCompletedToday: `  ${LONG.toUpperCase()}  ` }));
    expect(r.suggestions.some(s => s.key === 'same-as-yesterday')).toBe(true);
  });

  it('does not cry copy-paste when the text differs', () => {
    const r = checkDailyReportQuality(goodSeoInput({ previousCompletedToday: 'Dje bëra diçka tjetër fare' }));
    expect(r.suggestions.some(s => s.key === 'same-as-yesterday')).toBe(false);
  });

  it('mentions an empty client breakdown when clients were served', () => {
    const r = checkDailyReportQuality(goodSeoInput({ customerIds: ['c1', 'c2'] }));
    expect(r.suggestions.some(s => s.key === 'no-per-client')).toBe(true);
    expect(r.canSubmit).toBe(true);
  });

  it('stays quiet once one per-client answer exists', () => {
    const r = checkDailyReportQuality(goodSeoInput({
      customerIds: ['c1'],
      customFields: {
        rankingNotes: 'x'.repeat(40),
        nextStep: 'y',
        [perClientKey('backlinks', 'c1')]: 4,
      },
    }));
    expect(r.suggestions.some(s => s.key === 'no-per-client')).toBe(false);
  });

  it('flags a day where the whole plan went untouched', () => {
    const r = checkDailyReportQuality(goodSeoInput({
      hoursWorked: 2,
      outcomes: [
        { taskId: 'a', title: 'A', state: 'not_started', reason: 'pres' },
        { taskId: 'b', title: 'B', state: 'not_started', reason: 'pres' },
      ],
    }));
    expect(r.suggestions.some(s => s.key === 'nothing-touched')).toBe(true);
  });
});

describe('a declared absence waives the form', () => {
  it.each(['leave', 'sick', 'holiday'] as const)('%s asks nothing', (workingStatus) => {
    const r = checkDailyReportQuality({ completedToday: '', workingStatus, template: getReportTemplate('seo') });
    expect(r.waived).toBe(true);
    expect(r.canSubmit).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('still asks on a partial day', () => {
    const r = checkDailyReportQuality({ completedToday: '', workingStatus: 'partial' });
    expect(r.waived).toBe(false);
    expect(r.canSubmit).toBe(false);
  });
});

describe('score', () => {
  it('never leaves the 0–100 range however bad the report is', () => {
    const r = checkDailyReportQuality({
      completedToday: '',
      template: getReportTemplate('ads'),
      outcomes: Array.from({ length: 10 }, (_, i) => ({ title: `T${i}`, state: 'not_started' as const })),
    });
    expect(r.score).toBe(0);
    expect(r.canSubmit).toBe(false);
  });

  it('works with no template at all', () => {
    const r = checkDailyReportQuality({ completedToday: LONG, planTomorrow: 'Nesër vazhdoj' });
    expect(r.canSubmit).toBe(true);
    expect(r.score).toBe(100);
  });
});
