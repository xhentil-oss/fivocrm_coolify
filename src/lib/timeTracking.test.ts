import { describe, it, expect } from 'vitest';
import { entryDurationMinutes, totalTrackedMinutes } from './timeTracking';

const d = (iso: string) => new Date(iso);

describe('entryDurationMinutes', () => {
  it('computes minutes from start/end (~2h)', () => {
    // 11:17 → 13:11 = 1h 54m = 114 min (the real-world reported entry)
    expect(entryDurationMinutes({ startTime: d('2026-07-04T11:17:00'), endTime: d('2026-07-04T13:11:00') })).toBe(114);
  });

  it('ignores a stale/corrupt stored `duration` and trusts start/end', () => {
    // Bug repro: stored duration says 2993 (=49h53m) but the entry only spans ~2h.
    const entry = { startTime: d('2026-07-04T11:17:00'), endTime: d('2026-07-04T13:11:00'), duration: 2993 };
    expect(entryDurationMinutes(entry)).toBe(114);
  });

  it('returns 0 for a running entry (no endTime), even if a duration is stored', () => {
    expect(entryDurationMinutes({ startTime: d('2026-07-04T11:00:00'), endTime: null, duration: 9999 })).toBe(0);
    expect(entryDurationMinutes({ startTime: d('2026-07-04T11:00:00') })).toBe(0);
  });

  it('returns 0 for negative ranges (clock skew)', () => {
    expect(entryDurationMinutes({ startTime: d('2026-07-04T13:00:00'), endTime: d('2026-07-04T12:00:00') })).toBe(0);
  });

  it('accepts Firestore Timestamp-like objects (toMillis / toDate / seconds)', () => {
    const start = { toMillis: () => Date.parse('2026-07-04T10:00:00') };
    const end = { toDate: () => d('2026-07-04T10:30:00') };
    expect(entryDurationMinutes({ startTime: start, endTime: end })).toBe(30);
    const secs = { seconds: Math.floor(Date.parse('2026-07-04T10:00:00') / 1000) };
    const secsEnd = { seconds: Math.floor(Date.parse('2026-07-04T11:00:00') / 1000) };
    // getTimestampMs handles Date/toMillis/toDate/number; seconds objects fall through to new Date(obj)=Invalid → 0.
    expect(entryDurationMinutes({ startTime: secs, endTime: secsEnd })).toBe(0);
  });

  it('is timezone-agnostic (uses absolute epoch ms)', () => {
    expect(entryDurationMinutes({ startTime: d('2026-07-04T09:00:00Z'), endTime: d('2026-07-04T10:30:00Z') })).toBe(90);
  });
});

describe('totalTrackedMinutes', () => {
  it('sums only completed entries and skips running/invalid ones', () => {
    const entries = [
      { startTime: d('2026-07-04T09:00:00'), endTime: d('2026-07-04T10:00:00') }, // 60
      { startTime: d('2026-07-04T11:17:00'), endTime: d('2026-07-04T13:11:00'), duration: 2993 }, // 114 (stored is bogus)
      { startTime: d('2026-07-04T14:00:00'), endTime: null, duration: 500 }, // running → 0
    ];
    expect(totalTrackedMinutes(entries)).toBe(174);
  });

  it('handles null/empty input', () => {
    expect(totalTrackedMinutes(null)).toBe(0);
    expect(totalTrackedMinutes([])).toBe(0);
  });

  it('does not inflate when a single stale timer was left running for ~2 days', () => {
    // Even if one entry legitimately spans a long time, the total equals the sum of
    // per-entry start/end spans — total and log line can never diverge.
    const entries = [
      { startTime: d('2026-07-02T11:17:00'), endTime: d('2026-07-04T13:11:00'), duration: 5 }, // ~49h53m
    ];
    expect(totalTrackedMinutes(entries)).toBe(entryDurationMinutes(entries[0]));
  });
});
