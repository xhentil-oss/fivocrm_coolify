/**
 * @vitest-environment node
 *
 * Node, not jsdom: the drift guard reads `api/_emailIdentity.ts` off disk.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PLATFORM_SENDER_NAME,
  SENDER_NAME_MAX,
  safeSenderName,
  safeSenderAddress,
  senderHeader,
  senderNameIssue,
} from './emailIdentity';
import * as serverMirror from '../../api/_emailIdentity';

describe('safeSenderName (Gmail "abnormal characters" guard)', () => {
  it('keeps an ordinary Albanian brand name, diacritics included', () => {
    expect(safeSenderName('Ekipi FivoCRM')).toBe('Ekipi FivoCRM');
    expect(safeSenderName('Agjencia Këshillimore Çelësi')).toBe('Agjencia Këshillimore Çelësi');
    expect(safeSenderName("Fivo & Co. (Tiranë) - Shitje, 24/7!")).toBe("Fivo & Co. (Tiranë) - Shitje, 24/7!");
  });

  it('drops emoji, symbols, invisible and format characters', () => {
    expect(safeSenderName('Ekipi FivoCRM ✅')).toBe('Ekipi FivoCRM');
    expect(safeSenderName('🚀 Oferta e Marsit 🚀')).toBe('Oferta e Marsit');
    expect(safeSenderName('Fivo\u200bCRM\u00a0Ekipi')).toBe('Fivo CRM Ekipi');
    expect(safeSenderName('Fivo – Marketing')).toBe('Fivo Marketing'); // en dash is a symbol to a mail client
  });

  it('decodes HTML entities left over from escapeHtml, then filters the result', () => {
    expect(safeSenderName('Mario &#x27;M&#x27;')).toBe("Mario 'M'");
    expect(safeSenderName('Fivo &amp; Co')).toBe('Fivo & Co');
    expect(safeSenderName('Fivo &lt;script&gt;')).toBe('Fivo script');
    expect(safeSenderName('Fivo &quot;CRM&quot;')).toBe('Fivo CRM');
  });

  it('refuses the characters that let a name imitate an address or break the header', () => {
    expect(safeSenderName('info@fivo.al')).toBe('info fivo.al');
    expect(safeSenderName('"FivoCRM" <x@y.z>')).toBe('FivoCRM x y.z');
    expect(safeSenderName('Fivo\\CRM')).toBe('Fivo CRM');
    expect(safeSenderName('Fivo\r\nBcc: a@b.c')).toBe('Fivo Bcc a b.c');
  });

  it('rejects mixed / non-Latin scripts (homoglyph spoofing)', () => {
    expect(safeSenderName('Fiv\u043e CRM')).toBe('Fiv CRM'); // Cyrillic о
    expect(safeSenderName('Фиво')).toBe(PLATFORM_SENDER_NAME);
  });

  it('never returns an empty name', () => {
    expect(safeSenderName('')).toBe(PLATFORM_SENDER_NAME);
    expect(safeSenderName(null)).toBe(PLATFORM_SENDER_NAME);
    expect(safeSenderName('🚀🚀')).toBe(PLATFORM_SENDER_NAME);
    expect(safeSenderName('...---')).toBe(PLATFORM_SENDER_NAME);
    expect(safeSenderName('', 'Ekipi')).toBe('Ekipi');
  });

  it('caps the length on a word boundary', () => {
    const long = Array(20).fill('Agjencia').join(' ');
    const out = safeSenderName(long);
    expect(out.length).toBeLessThanOrEqual(SENDER_NAME_MAX);
    expect(out.endsWith('Agjencia')).toBe(true);
  });

  it('is idempotent', () => {
    for (const s of ['Ekipi FivoCRM ✅', 'Mario &#x27;M&#x27;', 'info@fivo.al', 'Фиво']) {
      expect(safeSenderName(safeSenderName(s))).toBe(safeSenderName(s));
    }
  });
});

describe('safeSenderAddress', () => {
  it('accepts a plain mailbox and preserves case (it is also the SMTP login)', () => {
    expect(safeSenderAddress('crm@fivoo.net')).toBe('crm@fivoo.net');
    expect(safeSenderAddress('Marketing.Team+x@Fivo.al')).toBe('Marketing.Team+x@Fivo.al');
  });

  it('repairs the two common env/config mistakes', () => {
    expect(safeSenderAddress('"crm@fivoo.net"')).toBe('crm@fivoo.net');
    expect(safeSenderAddress("'crm@fivoo.net'")).toBe('crm@fivoo.net');
    expect(safeSenderAddress('  crm@fivoo.net \n')).toBe('crm@fivoo.net');
    expect(safeSenderAddress('FivoCRM <crm@fivoo.net>')).toBe('crm@fivoo.net');
  });

  it('refuses anything that is not an ASCII mailbox', () => {
    expect(safeSenderAddress('')).toBeUndefined();
    expect(safeSenderAddress(undefined)).toBeUndefined();
    expect(safeSenderAddress('crm@fivoo')).toBeUndefined();
    expect(safeSenderAddress('crm fivoo.net')).toBeUndefined();
    expect(safeSenderAddress('crm@@fivoo.net')).toBeUndefined();
    expect(safeSenderAddress('krëm@fivoo.net')).toBeUndefined();
    expect(safeSenderAddress('crm@fivoo.net\u200b')).toBeUndefined();
    expect(safeSenderAddress('smtp-login-123')).toBeUndefined();
  });
});

describe('senderHeader', () => {
  it('quotes a cleaned name and never lets a quote or backslash escape', () => {
    expect(senderHeader('Ekipi FivoCRM ✅', 'crm@fivoo.net')).toBe('"Ekipi FivoCRM" <crm@fivoo.net>');
    expect(senderHeader('Fivo "CRM" \\', 'crm@fivoo.net')).toBe('"Fivo CRM" <crm@fivoo.net>');
    expect(senderHeader('', 'crm@fivoo.net')).toBe('"FivoCRM" <crm@fivoo.net>');
    expect(senderHeader(`${'Xhentil'} via FivoCRM`, 'crm@fivoo.net')).toBe('"Xhentil via FivoCRM" <crm@fivoo.net>');
  });
});

describe('senderNameIssue (UI hint)', () => {
  it('reports why a typed name will be sent differently', () => {
    expect(senderNameIssue('Ekipi FivoCRM')).toBeNull();
    expect(senderNameIssue('')).toBe('empty');
    expect(senderNameIssue('   ')).toBe('empty');
    expect(senderNameIssue('Ekipi ✅')).toBe('altered');
    expect(senderNameIssue('info@fivo.al')).toBe('altered');
  });
});

describe('server mirror (api/_emailIdentity.ts) has not drifted', () => {
  const FIXTURES = [
    'Ekipi FivoCRM', 'Ekipi FivoCRM ✅', 'Mario &#x27;M&#x27;', 'info@fivo.al', 'Фиво', 'Fiv\u043e CRM',
    'Fivo – Marketing', '"FivoCRM" <x@y.z>', '', '🚀🚀', Array(20).fill('Agjencia').join(' '),
    'crm@fivoo.net', '"crm@fivoo.net"', 'FivoCRM <crm@fivoo.net>', 'krëm@fivoo.net', 'crm@fivoo', 'smtp-login',
  ];

  it('produces identical results on every fixture', () => {
    for (const f of FIXTURES) {
      expect(serverMirror.safeSenderName(f)).toBe(safeSenderName(f));
      expect(serverMirror.safeSenderAddress(f)).toBe(safeSenderAddress(f));
      expect(serverMirror.senderNameIssue(f)).toBe(senderNameIssue(f));
    }
    expect(serverMirror.PLATFORM_SENDER_NAME).toBe(PLATFORM_SENDER_NAME);
    expect(serverMirror.SENDER_NAME_MAX).toBe(SENDER_NAME_MAX);
  });

  it('has the same code (only the header comment may differ)', () => {
    const root = resolve(__dirname, '..', '..');
    const body = (p: string) => readFileSync(p, 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\s*/, '');
    expect(body(resolve(root, 'src/lib/emailIdentity.ts'))).toBe(body(resolve(root, 'api/_emailIdentity.ts')));
  });
});
