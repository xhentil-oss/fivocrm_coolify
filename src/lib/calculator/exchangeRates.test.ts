import { describe, expect, it, beforeEach } from 'vitest';
import { buildExchangeRatesFromShared } from './defaults';

describe('buildExchangeRatesFromShared', () => {
  beforeEach(() => localStorage.clear());

  it('derives all six pairwise rates from the shared EUR/USD base (defaults)', () => {
    // Defaults from lib/utils: EUR=100, USD=92 ALL per unit.
    const r = buildExchangeRatesFromShared();
    expect(r.EUR_to_ALL).toBe(100);
    expect(r.USD_to_ALL).toBe(92);
    expect(r.ALL_to_EUR).toBeCloseTo(1 / 100, 6);
    expect(r.ALL_to_USD).toBeCloseTo(1 / 92, 6);
    expect(r.EUR_to_USD).toBeCloseTo(100 / 92, 6);
    expect(r.USD_to_EUR).toBeCloseTo(92 / 100, 6);
  });

  it('tracks the admin-set rate from localStorage', () => {
    localStorage.setItem('eur_all_rate', '105');
    localStorage.setItem('usd_all_rate', '98');
    const r = buildExchangeRatesFromShared();
    expect(r.EUR_to_ALL).toBe(105);
    expect(r.USD_to_ALL).toBe(98);
    expect(r.EUR_to_USD).toBeCloseTo(105 / 98, 6);
  });
});
