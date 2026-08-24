import { describe, it, expect } from 'vitest';
import { createValue, updateValue, isNoneValue, updateDateValue, createDateValue } from './formValue';

describe('formValue', () => {
  it('never lets a Select sentinel reach the database', () => {
    // `departmentId || undefined` used to keep '__none__' because it is truthy,
    // and the row then matched neither the "no department" nor any real filter.
    for (const sentinel of ['__none__', '__all__', '__add__', '', '   ']) {
      expect(createValue(sentinel)).toBeUndefined();
      expect(updateValue(sentinel)).toBeNull();
      expect(isNoneValue(sentinel)).toBe(true);
    }
  });

  it('keeps a real value, trimmed', () => {
    expect(createValue(' team-1 ')).toBe('team-1');
    expect(updateValue('team-1')).toBe('team-1');
    expect(isNoneValue('team-1')).toBe(false);
  });

  it('omits on create but CLEARS on update — the difference is the point', () => {
    // undefined is stripped by removeUndefined() so the old value survives;
    // only null actually removes it. Unlinking a project needs the null.
    expect(createValue(null)).toBeUndefined();
    expect(updateValue(null)).toBeNull();
  });

  it('handles non-string FormData values (File, etc.) as empty', () => {
    expect(createValue(new Blob())).toBeUndefined();
    expect(updateValue(42)).toBeNull();
  });

  it('parses dates and rejects junk', () => {
    const iso = new Date(2026, 7, 22, 12).toISOString();
    expect(updateDateValue(iso)?.getFullYear()).toBe(2026);
    expect(createDateValue(iso)?.getMonth()).toBe(7);
    expect(updateDateValue('not-a-date')).toBeNull();
    expect(createDateValue('__none__')).toBeUndefined();
    expect(updateDateValue('')).toBeNull();
  });
});
