/**
 * @vitest-environment node
 *
 * Node, not jsdom: the drift guard reads `api/_followUpConfig.ts` off disk.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_FOLLOW_UP_CONFIG,
  FOLLOW_UP_LIMITS,
  isDefaultFollowUpConfig,
  normalizeCadenceDays,
  resolveFollowUpConfig,
  businessMinutesBetween,
  DEFAULT_BUSINESS_HOURS,
} from './followUpConfig';

describe('api mirror', () => {
  it('api/_followUpConfig.ts is byte-identical to the canonical module', () => {
    const root = resolve(__dirname, '../../..');
    const canonical = readFileSync(resolve(root, 'src/lib/crm/followUpConfig.ts'), 'utf8');
    const mirror = readFileSync(resolve(root, 'api/_followUpConfig.ts'), 'utf8');
    expect(mirror).toBe(canonical);
  });
});

describe('resolveFollowUpConfig', () => {
  it('returns the defaults for undefined / null / {}', () => {
    expect(resolveFollowUpConfig()).toEqual(DEFAULT_FOLLOW_UP_CONFIG);
    expect(resolveFollowUpConfig(null)).toEqual(DEFAULT_FOLLOW_UP_CONFIG);
    expect(resolveFollowUpConfig({})).toEqual(DEFAULT_FOLLOW_UP_CONFIG);
    expect(isDefaultFollowUpConfig(resolveFollowUpConfig({}))).toBe(true);
  });

  it('returns a fresh cadence array, never the frozen default', () => {
    const cfg = resolveFollowUpConfig({});
    expect(() => cfg.leadCadenceDays.push(30)).not.toThrow();
    expect(DEFAULT_FOLLOW_UP_CONFIG.leadCadenceDays).toEqual([1, 3, 7, 14]);
  });

  it('accepts valid values, including numeric strings', () => {
    const cfg = resolveFollowUpConfig({
      followUpSlaHours: 48, followUpStaleDays: '30', waResponseSlaMinutes: 60, leadCadenceDays: [2, 5],
    });
    expect(cfg).toEqual({ followUpSlaHours: 48, followUpStaleDays: 30, waResponseSlaMinutes: 60, leadCadenceDays: [2, 5] });
    expect(isDefaultFollowUpConfig(cfg)).toBe(false);
  });

  it('falls back per field — one bad key never resets the others', () => {
    const cfg = resolveFollowUpConfig({ followUpSlaHours: 0, followUpStaleDays: 20, waResponseSlaMinutes: 'abc' });
    expect(cfg.followUpSlaHours).toBe(24);
    expect(cfg.followUpStaleDays).toBe(20);
    expect(cfg.waResponseSlaMinutes).toBe(120);
  });

  it('enforces the ranges (hours 1–168, days 1–365, minutes 15–1440)', () => {
    const L = FOLLOW_UP_LIMITS;
    expect(resolveFollowUpConfig({ followUpSlaHours: L.followUpSlaHours.max }).followUpSlaHours).toBe(168);
    expect(resolveFollowUpConfig({ followUpSlaHours: 169 }).followUpSlaHours).toBe(24);
    expect(resolveFollowUpConfig({ followUpStaleDays: 366 }).followUpStaleDays).toBe(14);
    expect(resolveFollowUpConfig({ followUpStaleDays: 365 }).followUpStaleDays).toBe(365);
    expect(resolveFollowUpConfig({ waResponseSlaMinutes: 14 }).waResponseSlaMinutes).toBe(120);
    expect(resolveFollowUpConfig({ waResponseSlaMinutes: 15 }).waResponseSlaMinutes).toBe(15);
    expect(resolveFollowUpConfig({ waResponseSlaMinutes: 1441 }).waResponseSlaMinutes).toBe(120);
  });

  it('refuses non-integers, NaN, Infinity and negatives', () => {
    expect(resolveFollowUpConfig({ followUpSlaHours: 1.5 }).followUpSlaHours).toBe(24);
    expect(resolveFollowUpConfig({ followUpSlaHours: NaN }).followUpSlaHours).toBe(24);
    expect(resolveFollowUpConfig({ followUpSlaHours: Infinity }).followUpSlaHours).toBe(24);
    expect(resolveFollowUpConfig({ followUpStaleDays: -3 }).followUpStaleDays).toBe(14);
  });
});

describe('normalizeCadenceDays', () => {
  it('sorts and de-duplicates', () => {
    expect(normalizeCadenceDays([7, 1, 3, 3, 14])).toEqual([1, 3, 7, 14]);
    expect(normalizeCadenceDays(['2', 1])).toEqual([1, 2]);
  });

  it('refuses the whole list when any entry is invalid', () => {
    expect(normalizeCadenceDays([1, 0])).toBeNull();          // 0 is below min
    expect(normalizeCadenceDays([1, 91])).toBeNull();         // above max
    expect(normalizeCadenceDays([1, 2.5])).toBeNull();        // not an integer
    expect(normalizeCadenceDays([1, 'x'])).toBeNull();
    expect(normalizeCadenceDays([])).toBeNull();
    expect(normalizeCadenceDays('1,3,7')).toBeNull();
    expect(normalizeCadenceDays(undefined)).toBeNull();
  });

  it('caps the number of steps at 8', () => {
    expect(normalizeCadenceDays([1, 2, 3, 4, 5, 6, 7, 8])).toHaveLength(8);
    expect(normalizeCadenceDays([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBeNull();
    // Duplicates collapse BEFORE the cap is applied.
    expect(normalizeCadenceDays([1, 1, 1, 1, 1, 1, 1, 1, 1, 2])).toEqual([1, 2]);
  });

  it('an invalid cadence in settings resolves to the default cadence', () => {
    expect(resolveFollowUpConfig({ leadCadenceDays: [0, 3] }).leadCadenceDays).toEqual([1, 3, 7, 14]);
    expect(resolveFollowUpConfig({ leadCadenceDays: 'nope' }).leadCadenceDays).toEqual([1, 3, 7, 14]);
  });
});

describe('businessMinutesBetween', () => {
  // 2026-10-16 is a Friday; Tirane is UTC+2 (CEST) until 25 Oct.
  const at = (iso: string) => Date.parse(iso);
  it('counts only Mon–Fri 09:00–18:00 local', () => {
    // Fri 10:00 → 12:00 local = 120 min.
    expect(businessMinutesBetween(at('2026-10-16T08:00:00Z'), at('2026-10-16T10:00:00Z'))).toBe(120);
  });
  it('a message on Friday 17:50 has used 10 minutes by Monday 09:00', () => {
    expect(businessMinutesBetween(at('2026-10-16T15:50:00Z'), at('2026-10-19T07:00:00Z'))).toBe(10);
    // …and 40 by Monday 09:30.
    expect(businessMinutesBetween(at('2026-10-16T15:50:00Z'), at('2026-10-19T07:30:00Z'))).toBe(40);
  });
  it('nights and weekends are zero', () => {
    expect(businessMinutesBetween(at('2026-10-17T08:00:00Z'), at('2026-10-18T16:00:00Z'))).toBe(0); // Sat → Sun
    expect(businessMinutesBetween(at('2026-10-15T17:00:00Z'), at('2026-10-16T06:59:00Z'))).toBe(0); // Thu 19:00 → Fri 08:59
  });
  it('a full working day is 540 minutes; empty/negative ranges are 0', () => {
    expect(businessMinutesBetween(at('2026-10-15T22:00:00Z'), at('2026-10-16T22:00:00Z'))).toBe(540);
    expect(businessMinutesBetween(at('2026-10-16T10:00:00Z'), at('2026-10-16T09:00:00Z'))).toBe(0);
    expect(businessMinutesBetween(NaN, 0)).toBe(0);
  });
  it('honours custom hours', () => {
    expect(businessMinutesBetween(at('2026-10-17T08:00:00Z'), at('2026-10-17T09:00:00Z'),
      { ...DEFAULT_BUSINESS_HOURS, days: [6] })).toBe(60);
  });
});
