import { describe, it, expect } from 'vitest';
import { safeRedirectPath } from './safeNavigation';

describe('safeRedirectPath', () => {
  it('keeps a plain in-app path, with query and hash', () => {
    expect(safeRedirectPath('/app/dashboard')).toBe('/app/dashboard');
    expect(safeRedirectPath('/portal/invoices?tab=open#top')).toBe('/portal/invoices?tab=open#top');
    expect(safeRedirectPath('/')).toBe('/');
  });

  it('falls back for absolute and scheme-relative URLs', () => {
    expect(safeRedirectPath('https://evil.com')).toBe('/');
    expect(safeRedirectPath('http://evil.com/app')).toBe('/');
    expect(safeRedirectPath('//evil.com')).toBe('/');
    expect(safeRedirectPath('//evil.com/app')).toBe('/');
    expect(safeRedirectPath('/\\evil.com')).toBe('/');
    expect(safeRedirectPath('\\\\evil.com')).toBe('/');
    expect(safeRedirectPath('javascript:alert(1)')).toBe('/');
    expect(safeRedirectPath('/\tevil.com')).toBe('/');
  });

  it('falls back for empty, missing and non-string values', () => {
    expect(safeRedirectPath(null)).toBe('/');
    expect(safeRedirectPath(undefined)).toBe('/');
    expect(safeRedirectPath('')).toBe('/');
    expect(safeRedirectPath('   ')).toBe('/');
    expect(safeRedirectPath('app/dashboard')).toBe('/');
  });

  it('honours a custom fallback', () => {
    expect(safeRedirectPath('https://evil.com', '/app')).toBe('/app');
    expect(safeRedirectPath(null, '/portal')).toBe('/portal');
  });
});
