import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  setTenantOverride, getTenantOverride, clearTenantOverride,
  extendTenantOverride, overrideMinutesLeft,
  IMPERSONATION_MINUTES, IMPERSONATION_EXTEND_MINUTES,
} from './platformContext';

/**
 * Impersonation is time-boxed (console improvement #7): an operator who forgets they
 * are inside a customer's workspace is one careless click from writing to the wrong
 * tenant, so the session has to end on its own.
 */
describe('tenant override expiry', () => {
  beforeEach(() => {
    clearTenantOverride();
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    clearTenantOverride();
  });

  const enter = () => setTenantOverride({ businessId: 'bizX', teamId: 'teamX', name: 'Acme' });

  it('applies a default expiry so no caller can create an endless session', () => {
    enter();
    expect(getTenantOverride()?.businessId).toBe('bizX');
    expect(overrideMinutesLeft()).toBe(IMPERSONATION_MINUTES);
  });

  it('ends by itself once the window passes', () => {
    enter();
    vi.setSystemTime(new Date(Date.now() + (IMPERSONATION_MINUTES + 1) * 60_000));
    expect(getTenantOverride()).toBeNull();
  });

  it('is still active one minute before expiry', () => {
    enter();
    vi.setSystemTime(new Date(Date.now() + (IMPERSONATION_MINUTES - 1) * 60_000));
    expect(getTenantOverride()).not.toBeNull();
    expect(overrideMinutesLeft()).toBe(1);
  });

  it('can be extended deliberately', () => {
    enter();
    vi.setSystemTime(new Date(Date.now() + (IMPERSONATION_MINUTES - 5) * 60_000));
    extendTenantOverride();
    expect(overrideMinutesLeft()).toBe(IMPERSONATION_EXTEND_MINUTES);
    vi.setSystemTime(new Date(Date.now() + (IMPERSONATION_EXTEND_MINUTES - 1) * 60_000));
    expect(getTenantOverride()).not.toBeNull();
  });

  it('extending does nothing when not impersonating', () => {
    extendTenantOverride();
    expect(getTenantOverride()).toBeNull();
    expect(overrideMinutesLeft()).toBeNull();
  });

  it('clears the stored value on expiry, so a stale session cannot come back', () => {
    enter();
    vi.setSystemTime(new Date(Date.now() + (IMPERSONATION_MINUTES + 1) * 60_000));
    expect(getTenantOverride()).toBeNull();
    expect(sessionStorage.getItem('fivocrm_platform_tenant')).toBeNull();
  });

  it('honours an explicit expiry passed by the caller', () => {
    setTenantOverride({ businessId: 'b', teamId: null, name: 'X', expiresAt: Date.now() + 5 * 60_000 });
    expect(overrideMinutesLeft()).toBe(5);
  });
});
