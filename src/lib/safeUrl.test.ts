import { describe, it, expect } from 'vitest';
import { safeExternalUrl, trustedFileHost } from './safeUrl';

describe('safeExternalUrl', () => {
  it('passes http and https URLs through unchanged', () => {
    expect(safeExternalUrl('https://vps.fivocrm.com/files/a.pdf')).toBe('https://vps.fivocrm.com/files/a.pdf');
    expect(safeExternalUrl('http://legacy.example.com/x.jpg')).toBe('http://legacy.example.com/x.jpg');
    expect(safeExternalUrl('  https://x.y/z  ')).toBe('https://x.y/z');
  });

  it('rejects executable and data schemes', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('JavaScript:alert(1)')).toBeNull();
    // The URL parser strips tabs/newlines — a regex on the raw string misses this.
    expect(safeExternalUrl('java\tscript:alert(1)')).toBeNull();
    expect(safeExternalUrl('java\nscript:alert(1)')).toBeNull();
    expect(safeExternalUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeExternalUrl('vbscript:msgbox(1)')).toBeNull();
    expect(safeExternalUrl('file:///etc/passwd')).toBeNull();
  });

  it('rejects relative paths, empty and non-string values', () => {
    expect(safeExternalUrl('/files/a.pdf')).toBeNull();
    expect(safeExternalUrl('//evil.com/a.pdf')).toBeNull();
    expect(safeExternalUrl('')).toBeNull();
    expect(safeExternalUrl('   ')).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
    expect(safeExternalUrl(42)).toBeNull();
    expect(safeExternalUrl({ toString: () => 'https://x.y' })).toBeNull();
  });

  it('accepts blob: only when the caller opts in', () => {
    const blob = 'blob:https://app.fivocrm.com/9c4d2a1e-0000-4000-8000-000000000000';
    expect(safeExternalUrl(blob)).toBeNull();
    expect(safeExternalUrl(blob, { allowBlob: true })).toBe(blob);
    // Opting in to blob never re-opens javascript:
    expect(safeExternalUrl('javascript:alert(1)', { allowBlob: true })).toBeNull();
  });
});

describe('trustedFileHost', () => {
  it('accepts our https hosts and returns the origin only', () => {
    expect(trustedFileHost('https://vps.fivocrm.com')).toBe('https://vps.fivocrm.com');
    expect(trustedFileHost('https://vps.fivocrm.com/')).toBe('https://vps.fivocrm.com');
    expect(trustedFileHost('https://wa.fivocrm.com/upload?x=1')).toBe('https://wa.fivocrm.com');
    expect(trustedFileHost('https://Files.FivoCRM.com')).toBe('https://files.fivocrm.com');
  });

  it('rejects foreign hosts, look-alikes and plain http', () => {
    expect(trustedFileHost('https://evil.com')).toBeNull();
    expect(trustedFileHost('https://fivocrm.com.evil.com')).toBeNull();
    expect(trustedFileHost('https://vps.fivocrm.com.evil.com')).toBeNull();
    expect(trustedFileHost('https://notfivocrm.com')).toBeNull();
    expect(trustedFileHost('http://vps.fivocrm.com')).toBeNull();
    expect(trustedFileHost('https://evil.com@vps.fivocrm.com')).toBe('https://vps.fivocrm.com');
    expect(trustedFileHost('https://vps.fivocrm.com@evil.com')).toBeNull();
  });

  it('rejects empty, relative and non-string values', () => {
    expect(trustedFileHost('')).toBeNull();
    expect(trustedFileHost('vps.fivocrm.com')).toBeNull();
    expect(trustedFileHost('/upload')).toBeNull();
    expect(trustedFileHost(null)).toBeNull();
    expect(trustedFileHost(undefined)).toBeNull();
  });
});
