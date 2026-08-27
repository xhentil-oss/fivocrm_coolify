/**
 * @vitest-environment node
 *
 * Node, not jsdom: the mirror guard at the bottom reads api/_push.ts off disk, and
 * the default jsdom environment externalises `node:fs`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isInDndWindow,
  channelConversationKey,
  dmConversationKey,
  PRESENCE_FRESH_MS,
} from './notificationPrefs';

const at = (h: number, m = 0) => new Date(2026, 7, 27, h, m, 0);

describe('isInDndWindow', () => {
  it('is off unless enabled with both bounds', () => {
    expect(isInDndWindow(undefined, at(23))).toBe(false);
    expect(isInDndWindow({ dndEnabled: false, dndStart: '22:00', dndEnd: '08:00' }, at(23))).toBe(false);
    expect(isInDndWindow({ dndEnabled: true, dndStart: '22:00' }, at(23))).toBe(false);
  });

  it('handles a same-day window', () => {
    const p = { dndEnabled: true, dndStart: '09:00', dndEnd: '17:00' };
    expect(isInDndWindow(p, at(8, 59))).toBe(false);
    expect(isInDndWindow(p, at(9))).toBe(true);
    expect(isInDndWindow(p, at(16, 59))).toBe(true);
    // End is exclusive — a window ending at 17:00 must not silence 17:00.
    expect(isInDndWindow(p, at(17))).toBe(false);
  });

  it('handles an overnight window', () => {
    const p = { dndEnabled: true, dndStart: '22:00', dndEnd: '08:00' };
    expect(isInDndWindow(p, at(21, 59))).toBe(false);
    expect(isInDndWindow(p, at(22))).toBe(true);
    expect(isInDndWindow(p, at(3))).toBe(true);
    expect(isInDndWindow(p, at(8))).toBe(false);
  });

  it('reads equal bounds as the WHOLE day', () => {
    // The window has no outside; `start <= end` alone made 22:00-22:00 never active,
    // so DND looked on and delivered all day. Must match api/_push.ts isDndActive.
    const p = { dndEnabled: true, dndStart: '22:00', dndEnd: '22:00' };
    expect(isInDndWindow(p, at(22))).toBe(true);
    expect(isInDndWindow(p, at(4))).toBe(true);
    expect(isInDndWindow(p, at(13))).toBe(true);
  });

  it('never silences on an unparseable window', () => {
    expect(isInDndWindow({ dndEnabled: true, dndStart: 'x', dndEnd: 'y' }, at(23))).toBe(false);
  });
});

describe('conversation keys', () => {
  it('namespaces channels and DMs apart', () => {
    expect(channelConversationKey('client-abc')).toBe('ch:client-abc');
    expect(dmConversationKey('uid1')).toBe('dm:uid1');
    // A channel id and a uid can never collide into the same key.
    expect(channelConversationKey('uid1')).not.toBe(dmConversationKey('uid1'));
  });

  it('keys a DM on the PEER, which is what the sender stamps', () => {
    // A→B: the notification carries dm:A (A is B's peer), and B's open thread with A
    // publishes dm:A too. Keying either side on the recipient would never match.
    const sender = 'A';
    const notificationKey = dmConversationKey(sender);
    const readerKeyWhileViewingThatThread = dmConversationKey(sender);
    expect(notificationKey).toBe(readerKeyWhileViewingThatThread);
  });
});

describe('presence freshness mirror', () => {
  it('agrees with api/_push.ts', () => {
    // The client stamps the presence heartbeat and the server decides whether it is
    // still fresh. If the two constants drift, either the stamp lapses between beats
    // (push arrives while reading) or a closed tab keeps suppressing push.
    const server = readFileSync(resolve(__dirname, '../../api/_push.ts'), 'utf8');
    const match = server.match(/export const PRESENCE_FRESH_MS\s*=\s*([^;]+);/);
    expect(match, 'PRESENCE_FRESH_MS not found in api/_push.ts').toBeTruthy();
    // eslint-disable-next-line no-eval
    expect(eval(match![1])).toBe(PRESENCE_FRESH_MS);
  });
});
