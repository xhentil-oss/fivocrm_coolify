/**
 * @vitest-environment node
 *
 * Node, not jsdom: the drift guard reads `api/_nazmijeCore.ts` off disk.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  NAZMIJE_DEFAULTS, NAZMIJE_HUMOR, NAZMIJE_SAYINGS, NAZMIJE_UID, NAZMIJE_BLOCK_LABELS,
  albanianDateLabel, buildAfternoonDigest, buildMorningDigest, buildNazmijePrompt, buildWeeklyDigest,
  dayIndexOf, factsForAudience, humorLineForDay, humorModeFor, inQuietHours, localParts, mentionsNazmije, addressesNazmije,
  mondayOf, nazmijeBlockReason, nazmijeRoleOf, renderFactsForPrompt, resolveNazmijeSettings, sanitizeReply,
  sayingForDay, type NazmijeFacts, type NazmijeBlockReason,
} from './core';

const ROOT = resolve(__dirname, '../../..');

describe('api mirror', () => {
  it('api/_nazmijeCore.ts is byte-identical to the canonical core', () => {
    const canonical = readFileSync(resolve(ROOT, 'src/lib/nazmije/core.ts'), 'utf8');
    const mirror = readFileSync(resolve(ROOT, 'api/_nazmijeCore.ts'), 'utf8');
    expect(mirror).toBe(canonical);
  });
});

const facts = (over: Partial<NazmijeFacts> = {}): NazmijeFacts => ({
  date: '2026-10-02',
  tenantName: 'Fivo',
  people: [{ uid: 'u1', name: 'Arben' }, { uid: 'u2', name: 'Ela' }],
  tasks: {
    dueToday: [
      { id: 't1', title: 'Faqja e rezervimeve', assigneeName: 'Arben', assigneeUid: 'u1', due: '2026-10-02' },
      { id: 't2', title: 'Raporti SEO', assigneeName: 'Ela', assigneeUid: 'u2', due: '2026-10-02' },
      { id: 't3', title: 'Postimi IG', assigneeName: 'Arben', assigneeUid: 'u1', due: '2026-10-02' },
    ],
    overdue: [{ id: 't4', title: 'Oferta Resort', assigneeName: 'Ela', assigneeUid: 'u2', due: '2026-09-29', daysLate: 3 }],
    openTotal: 12,
    doneToday: [{ uid: 'u1', name: 'Arben', count: 2 }, { uid: 'u2', name: 'Ela', count: 0 }],
  },
  projects: [{ id: 'p1', name: 'Resort Durrës', status: 'Active', responsibleName: 'Ela', openTasks: 4, overdueTasks: 1, endDate: '2026-10-06', daysLeft: 4 }],
  reports: { expected: 2, submitted: ['Arben'], missing: ['Ela'] },
  leads: { newToday: 1, noNextStep: 3, wonThisWeek: 2 },
  finance: { overdueCount: 2, overdueAmountAll: 150000, overdueAmountEur: 300, dueThisWeekCount: 1 },
  ...over,
});

describe('identity & mentions', () => {
  it('reacts to @Nazmije in its spellings, not to other words', () => {
    expect(mentionsNazmije('@Nazmije ku jemi?')).toBe(true);
    expect(mentionsNazmije('hej @nazmija, lista?')).toBe(true);
    expect(mentionsNazmije('po @Nazmij')).toBe(true);
    expect(mentionsNazmije('email@nazmije.al')).toBe(false);
    expect(mentionsNazmije('Nazmije pa @')).toBe(false);
    expect(mentionsNazmije(null)).toBe(false);
  });

  it('matches her renamed display name and a reply to her row', () => {
    expect(mentionsNazmije('@Sekretarja ku jemi?', 'Sekretarja')).toBe(true);
    expect(mentionsNazmije('hej @sekretarja ana, lista?', 'Sekretarja Ana')).toBe(true);
    expect(mentionsNazmije('@Sekretarja ku jemi?')).toBe(false);
    expect(mentionsNazmije('@Sekretarjat', 'Sekretarja')).toBe(false);
    expect(mentionsNazmije('@A.B (x)', 'A.B (x)')).toBe(true);
    expect(mentionsNazmije('@Nazmije', 'Sekretarja')).toBe(true);
    expect(addressesNazmije({ text: 'po pse?', repliesToNazmije: true })).toBe(true);
    expect(addressesNazmije({ text: 'po pse?', displayName: 'Nazmije' })).toBe(false);
  });

  it('does not wake on a colleague whose name starts with hers', () => {
    const others = ['Ana Hoxha', 'Arben Leka'];
    expect(mentionsNazmije('@Ana Hoxha e ke ti?', 'Ana', others)).toBe(false);
    expect(mentionsNazmije('@Ana ku jemi? cc @Ana Hoxha', 'Ana', others)).toBe(true);
    expect(mentionsNazmije('@Ana ku jemi?', 'Ana', others)).toBe(true);
    expect(mentionsNazmije('@Analiza', 'Ana', others)).toBe(false);
  });
  it('has a reserved uid that is not an auth user', () => {
    expect(NAZMIJE_UID).toBe('nazmije');
  });
});

describe('settings', () => {
  it('applies the documented defaults to garbage', () => {
    const s = resolveNazmijeSettings({ humor: 'loud', workDays: [9, 'x', 1, 1], quietFrom: '25:00', dailyReplyCap: -3 });
    expect(s.enabled).toBe(false);
    expect(s.humor).toBe('light');
    expect(s.workDays).toEqual([1]);
    expect(s.quietFrom).toBe(NAZMIJE_DEFAULTS.quietFrom);
    expect(s.dailyReplyCap).toBe(NAZMIJE_DEFAULTS.dailyReplyCap);
    expect(s.displayName).toBe('Ana');
  });
  it('maps the pre-rename stored name to Ana, keeps any other custom name', () => {
    expect(resolveNazmijeSettings({ displayName: 'Nazmije' }).displayName).toBe('Ana');
    expect(resolveNazmijeSettings({ displayName: ' nazmija ' }).displayName).toBe('Ana');
    expect(resolveNazmijeSettings({ displayName: 'Drita' }).displayName).toBe('Drita');
  });
  it('keeps a valid custom name and caps the daily reply cap', () => {
    const s = resolveNazmijeSettings({ enabled: true, displayName: '  Drita ', dailyReplyCap: 99999 });
    expect(s.enabled).toBe(true);
    expect(s.displayName).toBe('Drita');
    expect(s.dailyReplyCap).toBe(1000);
  });
});

describe('time helpers', () => {
  it('reads the office zone, not the machine zone', () => {
    // 2026-10-02T05:30Z is 07:30 in Tirane (CEST), a Friday.
    const p = localParts(new Date('2026-10-02T05:30:00Z'), 'Europe/Tirane');
    expect(p).toEqual({ date: '2026-10-02', weekday: 5, hour: 7, minute: 30, hhmm: '07:30' });
  });
  it('quiet hours wrap midnight', () => {
    expect(inQuietHours('19:00', '18:00', '08:00')).toBe(true);
    expect(inQuietHours('03:00', '18:00', '08:00')).toBe(true);
    expect(inQuietHours('09:00', '18:00', '08:00')).toBe(false);
    expect(inQuietHours('12:00', '11:00', '13:00')).toBe(true);
    expect(inQuietHours('12:00', '12:00', '12:00')).toBe(false);
  });
  it('rotation index, monday and the Albanian label', () => {
    expect(dayIndexOf('1970-01-02')).toBe(1);
    expect(mondayOf('2026-10-02')).toBe('2026-09-28');
    expect(mondayOf('2026-09-28')).toBe('2026-09-28');
    expect(albanianDateLabel('2026-10-02')).toBe('e premte, 2 tetor');
  });
});

describe('the gate', () => {
  const on = resolveNazmijeSettings({ enabled: true, channelId: 'ch1' });
  const local = { weekday: 2, hhmm: '10:00' };

  it('module off is the first answer', () => {
    expect(nazmijeBlockReason({ kind: 'reply', settings: NAZMIJE_DEFAULTS, local })).toBe('module-off');
  });
  it('a suspended tenant never hears from her', () => {
    expect(nazmijeBlockReason({ kind: 'reply', settings: on, local, tenantStatus: 'suspended' })).toBe('tenant-suspended');
  });
  it('a reply ignores the clock but respects the person and the budget', () => {
    const night = { weekday: 0, hhmm: '03:00' };
    expect(nazmijeBlockReason({ kind: 'reply', settings: on, local: night })).toBeNull();
    expect(nazmijeBlockReason({ kind: 'reply', settings: on, local, userOptOut: true })).toBe('user-opt-out');
    expect(nazmijeBlockReason({ kind: 'reply', settings: on, local, rateLimited: true })).toBe('rate-limited');
    expect(nazmijeBlockReason({ kind: 'reply', settings: on, local, dailyCapReached: true })).toBe('daily-cap');
    expect(nazmijeBlockReason({ kind: 'reply', settings: on, local, hasAiKey: false })).toBe('no-ai-key');
    expect(nazmijeBlockReason({ kind: 'reply', settings: { ...on, dmAllowed: false }, local, isDm: true })).toBe('dm-disabled');
    expect(nazmijeBlockReason({ kind: 'reply', settings: { ...on, dmAllowed: false }, local, isDm: false })).toBeNull();
  });
  it('an unprompted post respects off days, quiet hours, the channel and the day claim', () => {
    expect(nazmijeBlockReason({ kind: 'morning', settings: on, local: { weekday: 6, hhmm: '09:00' } })).toBe('off-day');
    expect(nazmijeBlockReason({ kind: 'morning', settings: on, local: { weekday: 2, hhmm: '19:30' } })).toBe('quiet-hours');
    expect(nazmijeBlockReason({ kind: 'morning', settings: { ...on, channelId: null }, local })).toBe('channel-missing');
    expect(nazmijeBlockReason({ kind: 'morning', settings: on, local, channelExists: false })).toBe('channel-missing');
    expect(nazmijeBlockReason({ kind: 'morning', settings: on, local, alreadyPosted: true })).toBe('already-posted');
    expect(nazmijeBlockReason({ kind: 'morning', settings: on, local })).toBeNull();
  });
  it('each digest has its own switch and the weekly one waits for Friday', () => {
    expect(nazmijeBlockReason({ kind: 'morning', settings: { ...on, morningDigest: false }, local })).toBe('digest-off');
    expect(nazmijeBlockReason({ kind: 'afternoon', settings: { ...on, afternoonDigest: false }, local })).toBe('digest-off');
    expect(nazmijeBlockReason({ kind: 'weekly', settings: on, local })).toBe('not-friday');
    expect(nazmijeBlockReason({ kind: 'weekly', settings: on, local: { weekday: 5, hhmm: '16:30' } })).toBeNull();
    expect(nazmijeBlockReason({ kind: 'event', settings: on, local })).toBe('digest-off');
  });
  it('every reason has an Albanian label', () => {
    const reasons: NazmijeBlockReason[] = ['module-off', 'tenant-suspended', 'no-ai-key', 'quiet-hours', 'off-day', 'not-friday',
      'digest-off', 'user-opt-out', 'dm-disabled', 'channel-missing', 'rate-limited', 'daily-cap', 'already-posted', 'nothing-to-say', 'not-addressed'];
    reasons.forEach(r => expect(NAZMIJE_BLOCK_LABELS[r]).toBeTruthy());
  });
});

describe('sayings', () => {
  it('rotates deterministically and covers the whole bank', () => {
    const seen = new Set<string>();
    for (let d = 0; d < NAZMIJE_SAYINGS.length; d++) seen.add(sayingForDay(d).text);
    expect(seen.size).toBe(NAZMIJE_SAYINGS.length);
    expect(sayingForDay(5)).toEqual(sayingForDay(5 + NAZMIJE_SAYINGS.length));
    expect(sayingForDay(-1)).toEqual(sayingForDay(NAZMIJE_SAYINGS.length - 1));
  });
  it('is a bank of short, work-related lines without names or placeholders', () => {
    expect(NAZMIJE_SAYINGS.length).toBeGreaterThanOrEqual(40);
    NAZMIJE_SAYINGS.forEach(s => {
      expect(s.text.length).toBeLessThanOrEqual(140);
      expect(s.text).not.toMatch(/\{\{|\$\{/);
      expect(s.text).not.toMatch(/\b(Arben|Ela|Beni)\b/);
    });
  });
});

describe('humour', () => {
  it('no line takes a person (law 3 in code)', () => {
    NAZMIJE_HUMOR.forEach(h => {
      expect(h.text).not.toMatch(/\{\{|\$\{|%s/);
      expect(h.text).not.toMatch(/\b(Arben|Ela|Beni)\b/);
      expect(h.text).not.toMatch(/\b(pag[aë]|rrog[aë]|mungesa|s[eë]mur)\b/i);
      expect(h.tags.length).toBeGreaterThan(0);
    });
  });
  it('picks from the tag pool deterministically', () => {
    expect(humorLineForDay('monday', 3)?.tags).toContain('monday');
    expect(humorLineForDay('monday', 3)).toEqual(humorLineForDay('monday', 3));
  });
  it('the model may improvise only on full, in a group, in the morning/weekly post', () => {
    expect(humorModeFor('off', 'morning', 'group')).toBe('none');
    expect(humorModeFor('light', 'morning', 'group')).toBe('bank');
    expect(humorModeFor('full', 'morning', 'group')).toBe('ai');
    expect(humorModeFor('full', 'weekly', 'group')).toBe('ai');
    expect(humorModeFor('full', 'morning', 'dm')).toBe('none');
    expect(humorModeFor('full', 'afternoon', 'group')).toBe('none');
    expect(humorModeFor('full', 'event', 'group')).toBe('none');
    expect(humorModeFor('full', 'reply', 'dm')).toBe('bank');
    expect(humorModeFor('light', 'reply', 'group')).toBe('bank');
  });
});

describe('facts & roles', () => {
  it('maps claims to the three tiers', () => {
    expect(nazmijeRoleOf(['admin'])).toBe('admin');
    expect(nazmijeRoleOf(['owner'])).toBe('admin');
    expect(nazmijeRoleOf(['manager'])).toBe('manager');
    expect(nazmijeRoleOf(['member'])).toBe('member');
    expect(nazmijeRoleOf([], 'Manager')).toBe('manager');
    expect(nazmijeRoleOf(null)).toBe('member');
  });
  it('a member never gets finance; nobody gets it in a group (law 4)', () => {
    const f = facts();
    expect(factsForAudience(f, 'member', 'dm').finance).toBeNull();
    expect(factsForAudience(f, 'admin', 'group').finance).toBeNull();
    expect(factsForAudience(f, 'manager', 'dm').finance).toEqual(f.finance);
    expect(factsForAudience(f, 'admin', 'dm').finance).toEqual(f.finance);
  });
  it('a group hears how many reports are missing, never who', () => {
    const g = factsForAudience(facts(), 'admin', 'group');
    expect(g.reports?.missing).toEqual([]);
    expect(g.reports?.expected).toBe(2);
    expect(factsForAudience(facts(), 'admin', 'dm').reports?.missing).toEqual(['Ela']);
  });
  it('renders the facts compactly and includes finance only when present', () => {
    const text = renderFactsForPrompt(factsForAudience(facts(), 'admin', 'dm'));
    expect(text).toContain('ME AFAT SOT (3)');
    expect(text).toContain('"Oferta Resort" · Ela · 3 ditë vonë');
    expect(text).toContain('FINANCA');
    expect(renderFactsForPrompt(factsForAudience(facts(), 'member', 'dm'))).not.toContain('FINANCA');
    expect(text.length).toBeLessThanOrEqual(6000);
  });
  it('caps a huge tenant', () => {
    const many = Array.from({ length: 2000 }, (_, i) => ({ id: `t${i}`, title: `Detyra shumë e gjatë numër ${i} me titull të zgjatur`, assigneeName: 'Arben', due: '2026-10-02' }));
    const text = renderFactsForPrompt(facts({ tasks: { dueToday: many, overdue: many, openTotal: 4000, doneToday: null } }));
    expect(text.length).toBeLessThanOrEqual(6000);
  });
});

describe('prompt', () => {
  it('carries the character, the laws and the facts', () => {
    const p = buildNazmijePrompt({
      displayName: 'Nazmije', tenantName: 'Fivo', askerName: 'Arben', askerRole: 'member', audience: 'dm',
      humor: 'bank', factsText: 'DATA: 2026-10-02', nowLabel: 'e premte, 2 tetor, 10:00',
    });
    expect(p).toContain('Ti je Nazmije');
    expect(p).toContain('DATA: 2026-10-02');
    expect(p).toContain('MOS jep shifra financiare');
    expect(p).toContain('KURRË mos shpik');
    expect(p).toContain('Po flet me Arben (anëtar i ekipit) në DM');
  });
  it('forbids finance in a group even for an admin', () => {
    const p = buildNazmijePrompt({
      displayName: 'Nazmije', tenantName: 'Fivo', askerName: 'Ela', askerRole: 'admin', audience: 'group',
      humor: 'none', factsText: '', nowLabel: '',
    });
    expect(p).toContain('MOS përmend asnjë shifër financiare');
    expect(p).toContain('Pa shaka fare');
  });
  it('sanitizes the reply', () => {
    expect(sanitizeReply('Nazmije: Mirë.\n\n\n\nPo.  \n')).toBe('Mirë.\n\nPo.');
    expect(sanitizeReply('x'.repeat(5000)).length).toBeLessThanOrEqual(1200);
    expect(sanitizeReply(null)).toBe('');
  });
});

describe('digests', () => {
  const opts = { humor: 'bank' as const, dayIndex: dayIndexOf('2026-10-02'), weekday: 5 };

  it('morning: plan of the day with people, overdue, projects, saying and one joke', () => {
    const text = buildMorningDigest(facts(), opts)!;
    expect(text).toContain('☕ Mirëmëngjes! Sot, e premte, 2 tetor.');
    expect(text).toContain('• Me afat sot: 3 detyra — Arben 2, Ela 1');
    expect(text).toContain('• Të vonuara: 1 — "Oferta Resort" (Ela, 3 ditë)');
    expect(text).toContain('• Projekte me afat këtë javë: Resort Durrës (4 ditë, 4 hapur)');
    expect(text).toContain('• Lead-e: 1 të reja sot · 3 pa hap tjetër');
    expect(text).toContain(`💬 "${sayingForDay(opts.dayIndex).text}" — Ana`);
    const lines = text.split('\n');
    expect(humorLineForDay('friday', opts.dayIndex)?.text).toBe(lines[lines.length - 1]);
    expect(text).not.toMatch(/FINANCA|fatur/i);
  });
  it('morning: silent when there is nothing to plan', () => {
    const f = facts({ tasks: { dueToday: [], overdue: [], openTotal: 0, doneToday: null }, projects: [] });
    expect(buildMorningDigest(f, opts)).toBeNull();
  });
  it('morning: no joke on off / no saying when asked', () => {
    const text = buildMorningDigest(facts(), { ...opts, humor: 'none', saying: false })!;
    expect(text).not.toContain('💬');
    expect(text.split('\n').length).toBe(5);
  });
  it('afternoon: done so far, still open, report nudge — never a joke', () => {
    const text = buildAfternoonDigest(facts(), { ...opts, humor: 'bank' })!;
    expect(text.startsWith('🕓 Ku jemi sot:')).toBe(true);
    expect(text).toContain('• Mbyllur sot: 2 detyra — Arben 2');
    expect(text).toContain('• Ende hapur me afat sot: 3 — "Faqja e rezervimeve" (Arben)');
    expect(text).toContain('• Raporti ditor: dorëzuar 1 nga 2. Afati 17:30');
    NAZMIJE_HUMOR.forEach(h => expect(text).not.toContain(h.text));
  });
  it('afternoon: an unavailable done-count is omitted, not "0"', () => {
    const text = buildAfternoonDigest(facts({ tasks: { ...facts().tasks, doneToday: null } }), opts)!;
    expect(text).not.toContain('Mbyllur sot');
  });
  it('afternoon: silent with no deadlines and no reports expected', () => {
    const f = facts({ tasks: { dueToday: [], overdue: [], openTotal: 0, doneToday: null }, reports: null });
    expect(buildAfternoonDigest(f, opts)).toBeNull();
  });
  it('weekly: the week in numbers with a different saying', () => {
    const f = facts({ week: { mondayKey: '2026-09-28', doneByPerson: [{ uid: 'u1', name: 'Arben', count: 12 }, { uid: 'u2', name: 'Ela', count: 10 }], doneTotal: 22, leadsWon: 2, reportsSubmitted: 8, reportsExpected: 10 } });
    const text = buildWeeklyDigest(f, opts)!;
    expect(text).toContain('• Detyra të mbyllura: 22 — Arben 12, Ela 10');
    expect(text).toContain('• Lead-e të fituara: 2');
    expect(text).toContain('• Raporte ditore: 8 nga 10 (80 %)');
    expect(text).toContain('• Të vonuara që kalojnë në javën tjetër: 1');
    expect(text).toContain(`"${sayingForDay(opts.dayIndex, 7).text}"`);
    expect(text).not.toContain(`"${sayingForDay(opts.dayIndex).text}"`);
  });
  it('weekly: silent without week facts or with an empty week', () => {
    expect(buildWeeklyDigest(facts(), opts)).toBeNull();
    const empty = facts({ tasks: { dueToday: [], overdue: [], openTotal: 0, doneToday: null }, week: { mondayKey: '2026-09-28', doneByPerson: [], doneTotal: 0, leadsWon: 0, reportsSubmitted: 0, reportsExpected: 0 } });
    expect(buildWeeklyDigest(empty, opts)).toBeNull();
  });
});
