import { describe, expect, it } from 'vitest';
import {
  BLOCK_DEFS,
  BLOCK_DEF_BY_TYPE,
  createBlock,
  isSafeUrl,
  normaliseOrder,
  removeBlock,
  reorderBlocks,
  validateBlock,
  validateBlocks,
} from './blocks';
import type { ReportBlock } from '../../types';

const b = (over: Partial<ReportBlock> = {}): ReportBlock => ({
  id: over.id || 'b1',
  type: over.type || 'rich-text',
  order: over.order ?? 0,
  visibility: over.visibility || 'internal',
  ...over,
});

describe('registry', () => {
  it('has a unique entry per block type', () => {
    const types = BLOCK_DEFS.map(d => d.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('gives every block a label, hint, group and icon', () => {
    for (const d of BLOCK_DEFS) {
      expect(d.label.length, d.type).toBeGreaterThan(0);
      expect(d.hint.length, d.type).toBeGreaterThan(0);
      expect(d.icon.length, d.type).toBeGreaterThan(0);
    }
  });

  it('marks raw HTML as admin-only and never-client', () => {
    expect(BLOCK_DEF_BY_TYPE['custom-html'].adminOnly).toBe(true);
    expect(BLOCK_DEF_BY_TYPE['custom-html'].neverClient).toBe(true);
  });
});

describe('createBlock', () => {
  it('defaults a new block to internal, never client', () => {
    expect(createBlock('rich-text', 0).visibility).toBe('internal');
  });

  it('applies registry defaults', () => {
    expect(createBlock('client-action', 0).visibility).toBe('client');
    expect(createBlock('page-break', 0).inPortal).toBe(false);
    expect(createBlock('chart', 0).chart).toBe('line');
  });

  it('lets an explicit override win over the registry default', () => {
    expect(createBlock('client-action', 0, { visibility: 'management' }).visibility).toBe('management');
  });
});

describe('reorderBlocks', () => {
  const list = [b({ id: 'a', order: 0 }), b({ id: 'b', order: 1 }), b({ id: 'c', order: 2 })];

  it('moves a block and renumbers order', () => {
    const out = reorderBlocks(list, 2, 0);
    expect(out.map(x => x.id)).toEqual(['c', 'a', 'b']);
    expect(out.map(x => x.order)).toEqual([0, 1, 2]);
  });

  it('is a no-op for an out-of-range index but still normalises', () => {
    const out = reorderBlocks(list, 9, 0);
    expect(out.map(x => x.id)).toEqual(['a', 'b', 'c']);
    expect(out.map(x => x.order)).toEqual([0, 1, 2]);
  });
});

describe('removeBlock', () => {
  it('removes an unlocked block and closes the gap', () => {
    const { blocks, removed } = removeBlock(
      [b({ id: 'a', order: 0 }), b({ id: 'b', order: 1 }), b({ id: 'c', order: 2 })],
      'b',
    );
    expect(removed).toBe(true);
    expect(blocks.map(x => x.id)).toEqual(['a', 'c']);
    expect(blocks.map(x => x.order)).toEqual([0, 1]);
  });

  it('refuses to remove a template-locked block', () => {
    const list = [b({ id: 'a', locked: true })];
    const { blocks, removed } = removeBlock(list, 'a');
    expect(removed).toBe(false);
    expect(blocks).toBe(list);
  });

  it('is a no-op for an unknown id', () => {
    expect(removeBlock([b({ id: 'a' })], 'zzz').removed).toBe(false);
  });
});

describe('normaliseOrder', () => {
  it('rewrites gapped order values without changing the sequence', () => {
    const out = normaliseOrder([b({ id: 'x', order: 10 }), b({ id: 'y', order: 3 })]);
    expect(out.map(o => o.id)).toEqual(['y', 'x']);
    expect(out.map(o => o.order)).toEqual([0, 1]);
  });
});

describe('isSafeUrl — media allow-list', () => {
  it('accepts plain https', () => {
    expect(isSafeUrl('https://firebasestorage.googleapis.com/v0/b/x/o/y.png')).toBe(true);
    expect(isSafeUrl('https://www.loom.com/share/abc')).toBe(true);
  });

  it('rejects javascript: and data: URIs', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isSafeUrl('JavaScript:alert(1)')).toBe(false);
  });

  it('rejects plain http', () => {
    expect(isSafeUrl('http://example.com/a.png')).toBe(false);
  });

  it('rejects credentials embedded in the host', () => {
    expect(isSafeUrl('https://user:pass@evil.com/a.png')).toBe(false);
  });

  it('rejects whitespace and quote smuggling', () => {
    expect(isSafeUrl('https://x.com/a.png" onerror="alert(1)')).toBe(false);
    expect(isSafeUrl('https://x.com/a .png')).toBe(false);
  });
});

describe('validateBlock', () => {
  it('rejects an unknown block type', () => {
    const issues = validateBlock(b({ type: 'nonsense' as any }));
    expect(issues[0].severity).toBe('error');
  });

  it('stops a non-admin adding raw HTML', () => {
    expect(validateBlock(b({ type: 'custom-html', html: '<b>x</b>' }), { isAdmin: false })
      .some(i => i.severity === 'error')).toBe(true);
    expect(validateBlock(b({ type: 'custom-html', html: '<b>x</b>' }), { isAdmin: true })
      .some(i => i.severity === 'error')).toBe(false);
  });

  it('stops raw HTML being marked client-visible even for an admin', () => {
    const issues = validateBlock(b({ type: 'custom-html', html: 'x', visibility: 'client' }), { isAdmin: true });
    expect(issues.some(i => i.field === 'visibility' && i.severity === 'error')).toBe(true);
  });

  it('rejects an out-of-range progress value', () => {
    expect(validateBlock(b({ type: 'progress', progress: 150 })).some(i => i.severity === 'error')).toBe(true);
    expect(validateBlock(b({ type: 'progress', progress: 50 })).some(i => i.severity === 'error')).toBe(false);
  });

  it('rejects duplicate table column keys', () => {
    const issues = validateBlock(b({
      type: 'table',
      columns: [{ key: 'a', label: 'A' }, { key: 'a', label: 'B' }],
      rows: [{ a: 1 }],
    }));
    expect(issues.some(i => i.message.includes('dyfishuar'))).toBe(true);
  });

  it('rejects table rows with no columns defined', () => {
    const issues = validateBlock(b({ type: 'table', columns: [], rows: [{ a: 1 }] }));
    expect(issues.some(i => i.field === 'columns')).toBe(true);
  });

  it('rejects an unsafe media URL', () => {
    expect(validateBlock(b({ type: 'image', url: 'javascript:alert(1)' }))
      .some(i => i.field === 'url' && i.severity === 'error')).toBe(true);
  });

  it('warns about custom_roles with no roles chosen', () => {
    const issues = validateBlock(b({ visibility: 'custom_roles', visibleRoles: [] }));
    expect(issues.some(i => i.severity === 'warning')).toBe(true);
  });

  it('warns about unapproved AI in a client block', () => {
    const issues = validateBlock(b({ visibility: 'client', aiSuggested: true }));
    expect(issues.some(i => i.message.includes('AI'))).toBe(true);
  });
});

describe('validateBlocks', () => {
  it('catches duplicate block ids', () => {
    const issues = validateBlocks([b({ id: 'same' }), b({ id: 'same' })]);
    expect(issues.some(i => i.message.includes('dyfishuar'))).toBe(true);
  });

  it('passes a clean list', () => {
    const issues = validateBlocks([b({ id: 'a' }), b({ id: 'b' })]);
    expect(issues.filter(i => i.severity === 'error')).toEqual([]);
  });
});
