import { describe, expect, it } from 'vitest';
import { extractPortalSubdomain, isReservedPortalSubdomain } from './usePortalTenant';

describe('extractPortalSubdomain', () => {
  it('reads a tenant slug from <slug>.fivocrm.com', () => {
    expect(extractPortalSubdomain('acme.fivocrm.com')).toBe('acme');
  });

  it('never reads an infrastructure host as a tenant (self-hosting migration)', () => {
    for (const h of ['legacy.fivocrm.com', 'staging.fivocrm.com', 'vercel.fivocrm.com', 'vps.fivocrm.com', 'wa.fivocrm.com', 'app.fivocrm.com', 'www.fivocrm.com']) {
      expect(extractPortalSubdomain(h), h).toBeNull();
    }
  });

  it('apex, vercel.app, localhost and foreign hosts have no tenant', () => {
    for (const h of ['fivocrm.com', 'fivocrm.vercel.app', 'localhost', '10.0.0.1', 'example.com']) {
      expect(extractPortalSubdomain(h), h).toBeNull();
    }
  });

  it('isReservedPortalSubdomain is case/space-insensitive', () => {
    expect(isReservedPortalSubdomain(' Legacy ')).toBe(true);
    expect(isReservedPortalSubdomain('acme')).toBe(false);
  });
});
