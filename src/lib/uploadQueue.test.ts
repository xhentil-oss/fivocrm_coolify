import { describe, it, expect } from 'vitest';
import { runLimited, settleLimited, batchLabel, isHeic } from './uploadQueue';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('runLimited', () => {
  it('never runs more than `limit` at once and keeps input order', async () => {
    let active = 0;
    let peak = 0;
    const out = await Promise.all(runLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++; peak = Math.max(peak, active);
      await tick(); await tick();
      active--;
      return n * 10;
    }));
    expect(peak).toBe(3);
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });

  it('a failed item does not stop the rest', async () => {
    const res = await settleLimited(['a', 'b', 'c', 'd'], 2, async (s) => {
      await tick();
      if (s === 'b') throw new Error('boom');
      return s.toUpperCase();
    });
    expect(res.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
    expect(res.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled').map((r) => r.value))
      .toEqual(['A', 'C', 'D']);
  });

  it('treats a bad limit as 1', async () => {
    let active = 0; let peak = 0;
    await Promise.all(runLimited([1, 2, 3], 0, async () => { active++; peak = Math.max(peak, active); await tick(); active--; }));
    expect(peak).toBe(1);
  });
});

describe('batchLabel', () => {
  it('shows N/total only for multi-file batches', () => {
    expect(batchLabel(null)).toBeNull();
    expect(batchLabel({ done: 0, total: 1 })).toBeNull();
    expect(batchLabel({ done: 2, total: 20 })).toBe('Po ngarkohet 3/20');
    expect(batchLabel({ done: 20, total: 20 })).toBe('Po ngarkohet 20/20');
  });
});

describe('isHeic', () => {
  it('detects by mime or by extension (Windows reports an empty mime)', () => {
    expect(isHeic({ type: 'image/heic', name: 'x' })).toBe(true);
    expect(isHeic({ type: '', name: 'IMG_0001.HEIC' })).toBe(true);
    expect(isHeic({ type: 'image/jpeg', name: 'a.jpg' })).toBe(false);
  });
});
