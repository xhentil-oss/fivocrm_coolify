/**
 * @vitest-environment node
 * (node: the last test reads the api mirror off disk.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  REPORT_REASONS, isReportReason, blockedUserIdsOf, isFromBlockedUser, canBlockSender,
  cleanReportNote, MAX_BLOCKED_USERS, REPORT_NOTE_MAX,
} from './moderation';

describe('chat moderation', () => {
  it('accepts only the declared report reasons', () => {
    for (const r of REPORT_REASONS) expect(isReportReason(r.key)).toBe(true);
    expect(isReportReason('nope')).toBe(false);
    expect(isReportReason(undefined)).toBe(false);
  });

  it('reads blocked ids defensively', () => {
    expect(blockedUserIdsOf(undefined)).toEqual([]);
    expect(blockedUserIdsOf({ blockedUserIds: 'x' })).toEqual([]);
    expect(blockedUserIdsOf({ blockedUserIds: ['a', '', 3, 'a', 'b'] })).toEqual(['a', 'b']);
    const many = Array.from({ length: MAX_BLOCKED_USERS + 10 }, (_, i) => `u${i}`);
    expect(blockedUserIdsOf({ blockedUserIds: many })).toHaveLength(MAX_BLOCKED_USERS);
  });

  it('never hides your own message', () => {
    const blocked = new Set(['me', 'x']);
    expect(isFromBlockedUser('me', 'me', blocked)).toBe(false);
    expect(isFromBlockedUser('x', 'me', blocked)).toBe(true);
    expect(isFromBlockedUser('y', 'me', blocked)).toBe(false);
    expect(isFromBlockedUser(undefined, 'me', blocked)).toBe(false);
  });

  it('cannot block yourself', () => {
    expect(canBlockSender('me', 'me')).toBe(false);
    expect(canBlockSender('x', 'me')).toBe(true);
    expect(canBlockSender('', 'me')).toBe(false);
  });

  it('cleans the report note', () => {
    expect(cleanReportNote('  a \n\n b  ')).toBe('a b');
    expect(cleanReportNote(42)).toBe('');
    expect(cleanReportNote('x'.repeat(REPORT_NOTE_MAX + 50))).toHaveLength(REPORT_NOTE_MAX);
  });

  it('the server mirror agrees on reasons and limits', () => {
    const api = readFileSync('api/_chatModeration.ts', 'utf8');
    for (const r of REPORT_REASONS) expect(api).toContain(`'${r.key}'`);
    expect(api).toContain(`MAX_BLOCKED_USERS = ${MAX_BLOCKED_USERS}`);
    expect(api).toContain(`REPORT_NOTE_MAX = ${REPORT_NOTE_MAX}`);
  });
});
