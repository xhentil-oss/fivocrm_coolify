import { describe, expect, it } from 'vitest';
import { waDisconnectLabel, waDisconnectReasonText } from './waDisconnect';

describe('waDisconnectReasonText', () => {
  it('passes a legacy string through', () => {
    expect(waDisconnectReasonText('logged_out')).toBe('logged_out');
    expect(waDisconnectReasonText('  ')).toBeNull();
    expect(waDisconnectReasonText(null)).toBeNull();
    expect(waDisconnectReasonText(undefined)).toBeNull();
  });
  it('flattens the Baileys 7 { code, name } object — never returns an object', () => {
    expect(waDisconnectReasonText({ code: 401, name: 'loggedOut' })).toBe('loggedOut (401)');
    expect(waDisconnectReasonText({ code: null, name: 'Connection Terminated' })).toBe('Connection Terminated');
    expect(waDisconnectReasonText({ code: 428, name: '' })).toBe('428');
    expect(typeof waDisconnectReasonText({ code: 1, name: 'x' } as any)).toBe('string');
  });
});

describe('waDisconnectLabel', () => {
  it('maps codes and legacy strings to the same Albanian label', () => {
    expect(waDisconnectLabel({ code: 401, name: 'loggedOut' })).toBe('U shkëput nga telefoni — skano QR');
    expect(waDisconnectLabel('logged_out')).toBe('U shkëput nga telefoni — skano QR');
    expect(waDisconnectLabel('401')).toBe('U shkëput nga telefoni — skano QR');
    expect(waDisconnectLabel({ code: 440, name: 'connectionReplaced' })).toBe('U hap në një pajisje tjetër');
    expect(waDisconnectLabel({ code: 403, name: 'forbidden' })).toBe('Numri u bllokua nga WhatsApp');
    expect(waDisconnectLabel({ code: 515, name: 'restartRequired' })).toBe('Po rinis lidhjen');
    expect(waDisconnectLabel({ code: 408, name: 'connectionLost' })).toBe('Lidhja ra — po rilidhet');
    expect(waDisconnectLabel({ code: 500, name: 'badSession' })).toBe('Sesioni u prish — skano QR');
  });
  it('falls back to the flattened text for an unknown reason', () => {
    expect(waDisconnectLabel({ code: null, name: 'Stream Errored (conflict)' })).toBe('Stream Errored (conflict)');
    expect(waDisconnectLabel({ code: 999, name: 'weird' })).toBe('weird (999)');
    expect(waDisconnectLabel(null)).toBeNull();
  });
});
