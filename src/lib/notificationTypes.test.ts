/**
 * @vitest-environment node
 *
 * Runs in node, not jsdom: the drift and emission guards below read the repository
 * off disk, and the default jsdom environment externalises `node:fs`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  NOTIFICATION_TYPES,
  ALL_NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORIES,
  CATEGORY_TYPES,
  CATEGORY_LABELS,
  categoryOf,
  isTypeMutedByPrefs,
  isKnownNotificationType,
} from './notificationTypes';

const ROOT = resolve(__dirname, '..', '..');

describe('notification type registry', () => {
  it('every type has a category from the declared list', () => {
    for (const t of ALL_NOTIFICATION_TYPES) {
      expect(NOTIFICATION_CATEGORIES).toContain(NOTIFICATION_TYPES[t].category);
    }
  });

  it('every category is labelled and non-empty', () => {
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(CATEGORY_LABELS[c]).toBeTruthy();
      expect(CATEGORY_TYPES[c].length).toBeGreaterThan(0);
    }
  });

  it('an unknown type is never muted (fail-open)', () => {
    expect(categoryOf('brand_new_type_2027')).toBeNull();
    expect(isTypeMutedByPrefs('brand_new_type_2027', { tasks: false, messages: false })).toBe(false);
    expect(isKnownNotificationType('brand_new_type_2027')).toBe(false);
  });

  it('a known type is muted only when its own category is off', () => {
    expect(isTypeMutedByPrefs('task_assigned', { tasks: false })).toBe(true);
    expect(isTypeMutedByPrefs('task_assigned', { invoices: false })).toBe(false);
    expect(isTypeMutedByPrefs('task_assigned', undefined)).toBe(false);
    // Regression: invoice_sent / contract_sent were muted server-side but not
    // client-side, so a user with "Fatura" off saw them in the bell but got no email.
    expect(isTypeMutedByPrefs('invoice_sent', { invoices: false })).toBe(true);
    expect(isTypeMutedByPrefs('contract_sent', { invoices: false })).toBe(true);
  });

  it('billing + config warnings are NOT mutable via the invoices toggle', () => {
    expect(isTypeMutedByPrefs('billing', { invoices: false })).toBe(false);
    expect(isTypeMutedByPrefs('recurring_project_no_budget', { invoices: false })).toBe(false);
  });
});

// ── Drift guard: the server mirror must match the canonical table exactly ──────
describe('api/_notificationTypes.ts mirror', () => {
  const mirrorSrc = readFileSync(join(ROOT, 'api', '_notificationTypes.ts'), 'utf8');

  // Parse the `key: 'category',` entries out of NOTIFICATION_TYPE_CATEGORY.
  const parseMirror = (): Record<string, string> => {
    const body = mirrorSrc.split('NOTIFICATION_TYPE_CATEGORY: Record<string, NotificationCategory> = {')[1];
    expect(body, 'NOTIFICATION_TYPE_CATEGORY not found in the mirror').toBeTruthy();
    const table = body.split('\n};')[0];
    const out: Record<string, string> = {};
    for (const m of table.matchAll(/^\s*([a-z0-9_]+)\s*:\s*'([a-z]+)'\s*,/gim)) {
      out[m[1]] = m[2];
    }
    return out;
  };

  it('covers exactly the same set of types', () => {
    const mirror = parseMirror();
    expect(Object.keys(mirror).sort()).toEqual([...ALL_NOTIFICATION_TYPES].sort());
  });

  it('assigns every type the same category', () => {
    const mirror = parseMirror();
    for (const t of ALL_NOTIFICATION_TYPES) {
      expect(mirror[t], `mirror category for "${t}"`).toBe(NOTIFICATION_TYPES[t].category);
    }
  });

  it('declares the same category union', () => {
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(mirrorSrc).toContain(`'${c}'`);
    }
  });
});

// ── Emission guard: no code may emit a type that is not in the registry ───────
// This is what catches the real-world failure mode: a new feature ships a notification
// with a fresh `type` string, and because nothing maps it, it renders with a generic
// icon, hides behind every category chip and can never be muted. Eleven types were
// live in exactly that state before the registry existed.
describe('emitted notification types', () => {
  const SCAN_DIRS = ['src', 'api'];
  const SKIP = new Set(['node_modules', 'dist', '.claude', 'android', 'ios']);

  const walk = (dir: string, acc: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, acc);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p);
    }
    return acc;
  };

  it('every notification `type:` literal is registered', () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const src = readFileSync(file, 'utf8');
        // Only look at blocks that are clearly notification writes.
        // notifyStaff( is the portal→staff relay — `new_client` shipped unregistered
        // through it because this scan didn't include it.
        const isNotifFile = /collection\('notifications'\)|useMutation<[^>]*>\('notifications'\)|useMutation\('notifications'\)|notifyUser\(|notifyStaff\(/.test(src);
        if (!isNotifFile) continue;
        for (const m of src.matchAll(/\btype:\s*'([a-z][a-z0-9_]*)'/g)) {
          const t = m[1];
          // Ignore unrelated `type:` fields that share the file (chat channel kinds,
          // billing intervals, …) by only flagging values that look like our shape.
          if (!/_/.test(t) && t !== 'report' && t !== 'mention' && t !== 'billing') continue;
          if (!isKnownNotificationType(t)) {
            offenders.push(`${file.replace(ROOT, '').replace(/\\/g, '/')}: "${t}"`);
          }
        }
      }
    }
    expect(offenders, `unregistered notification types:\n${offenders.join('\n')}`).toEqual([]);
  });
});
