/**
 * @vitest-environment node
 *
 * The send-failure classifiers and the agent ranking in api/_waSend.ts — pure,
 * Firestore-free, shared by every automated WhatsApp sender in the cron.
 */
import { describe, it, expect } from 'vitest';
import {
  isPermanentWaError, isChannelWaError, isUndeliverableNumberError, pickWaAgent,
} from '../../../api/_waSend';

describe('isPermanentWaError', () => {
  it('never retries what can never succeed', () => {
    expect(isPermanentWaError({ status: 422, error: 'not-on-whatsapp' })).toBe(true);
    expect(isPermanentWaError({ status: 400, error: 'Numri i telefonit është i pavlefshëm' })).toBe(true);
    for (const code of [131026, 131047, 131051, 131008, 131009, 132000, 132001, 132012, 100]) {
      expect(isPermanentWaError({ status: 400, code, error: 'x' })).toBe(true);
    }
    expect(isPermanentWaError('contact opted-out')).toBe(true);
  });
  it('transient and config errors are NOT permanent for the recipient', () => {
    expect(isPermanentWaError({ status: 503, error: 'WhatsApp jo i lidhur' })).toBe(false);
    expect(isPermanentWaError({ status: 0, error: 'The operation was aborted due to timeout' })).toBe(false);
    expect(isPermanentWaError({ status: 429 })).toBe(false);
    expect(isPermanentWaError({ status: 400, code: 131049, error: 'not delivered to maintain healthy ecosystem' })).toBe(false);
    // The VPS answers 400 for an agent/team mismatch too — that is OUR config.
    expect(isPermanentWaError({ status: 400, error: 'agentId dhe teamId nuk përputhen' })).toBe(false);
    expect(isPermanentWaError(null)).toBe(false);
  });
});

describe('isChannelWaError', () => {
  it('our side being down is never an attempt against the recipient', () => {
    expect(isChannelWaError({ status: 503, error: 'Asnjë agent WhatsApp i këtij ekipi nuk është i lidhur' })).toBe(true);
    expect(isChannelWaError({ status: 0, error: 'fetch failed' })).toBe(true);
    expect(isChannelWaError({ status: 429 })).toBe(true);
    expect(isChannelWaError({ status: 401, code: 190, error: 'token expired' })).toBe(true);
    expect(isChannelWaError({ status: 502, error: 'Lidhja u ndërpre para konfirmimit' })).toBe(true);
    // VPS contract: 400/404/429/503 are rejected BEFORE sending.
    expect(isChannelWaError({ status: 400, error: 'agentId dhe teamId nuk përputhen' })).toBe(true);
    expect(isChannelWaError({ status: 404, error: 'Agenti nuk u gjet' })).toBe(true);
  });
  it('500/502 = the send was attempted: an attempt against the recipient, not channel-down', () => {
    expect(isChannelWaError({ status: 500, error: 'Dërgimi dështoi' })).toBe(false);
  });
  it('a recipient-level refusal is not a channel error', () => {
    expect(isChannelWaError({ status: 502, error: 'WhatsApp e refuzoi mesazhin' })).toBe(false);
    expect(isChannelWaError({ status: 422, error: 'not-on-whatsapp' })).toBe(false);
    expect(isChannelWaError({ status: 400, code: 132000 })).toBe(false);
    // Meta's per-recipient transient refusal must not stall a whole batch.
    expect(isChannelWaError({ status: 400, code: 131049, error: 'healthy ecosystem' })).toBe(false);
  });
});

describe('isUndeliverableNumberError', () => {
  it('only a NUMBER problem marks the contact', () => {
    expect(isUndeliverableNumberError({ status: 422, error: 'not-on-whatsapp' })).toBe(true);
    expect(isUndeliverableNumberError({ status: 400, code: 131026, error: 'Message undeliverable' })).toBe(true);
    expect(isUndeliverableNumberError({ status: 400, code: 132000, error: 'param count mismatch' })).toBe(false);
    expect(isUndeliverableNumberError({ status: 503 })).toBe(false);
  });
});

describe('pickWaAgent — connected first, then same team; preferred only while connected', () => {
  const A = { id: 'a', teamId: 'sales', connected: true };
  const B = { id: 'b', teamId: 'social', connected: true };
  const C = { id: 'c', teamId: 'social', connected: false };
  it('a connected agent of another team beats a disconnected one of the same team', () => {
    expect(pickWaAgent([A, C], 'social')?.id).toBe('a');
  });
  it('same team wins among connected agents', () => {
    expect(pickWaAgent([A, B], 'social')?.id).toBe('b');
  });
  it('the preferred agent wins only when connected', () => {
    expect(pickWaAgent([A, B], 'social', 'a')?.id).toBe('a');
    expect(pickWaAgent([A, C], 'social', 'c')?.id).toBe('a');
  });
  it('nothing connected → still returns the best candidate (the caller reports channel-down)', () => {
    expect(pickWaAgent([C], 'sales')?.id).toBe('c');
    expect(pickWaAgent([], 'sales')).toBeNull();
  });
});
