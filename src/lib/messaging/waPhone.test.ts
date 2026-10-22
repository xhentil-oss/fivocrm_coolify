/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toWaPhone, sameWaPhone, waPhoneVariants, isSendableWaPhone } from './waPhone';

describe('toWaPhone', () => {
  it('normalises every Albanian form to 355…', () => {
    for (const p of ['0691234567', '691234567', '+355 69 123 4567', '00355691234567', '3550691234567', '355691234567']) {
      expect(toWaPhone(p)).toBe('355691234567');
    }
  });
  it('keeps foreign numbers', () => {
    expect(toWaPhone('+39 333 1234567')).toBe('393331234567');
    expect(toWaPhone('0044 7700 900123')).toBe('447700900123');
  });
  it('rejects garbage', () => {
    expect(toWaPhone('')).toBe('');
    expect(toWaPhone(null)).toBe('');
    expect(toWaPhone('12345')).toBe('');
    expect(toWaPhone('1234567890123456789')).toBe('');
    expect(isSendableWaPhone('abc')).toBe(false);
  });
  it('compares and expands', () => {
    expect(sameWaPhone('069 123 4567', '+355691234567')).toBe(true);
    expect(sameWaPhone('', '')).toBe(false);
    expect(waPhoneVariants('0691234567')).toEqual(expect.arrayContaining(['355691234567', '+355691234567', '691234567', '0691234567']));
  });
  it('api/_waPhone.ts is byte-identical', () => {
    const root = resolve(__dirname, '../../..');
    expect(readFileSync(resolve(root, 'api/_waPhone.ts'), 'utf8')).toBe(readFileSync(resolve(root, 'src/lib/messaging/waPhone.ts'), 'utf8'));
  });
});
