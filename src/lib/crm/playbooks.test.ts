/**
 * @vitest-environment node
 *
 * Node, not jsdom: the drift guard reads `api/_playbooks.ts` off disk.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PLAYBOOK_RECIPES, currentPlaybookStep, enrollPlaybookPatch, matchPlaybookByKeywords, matchPlaybookByTags,
  nextPlaybookStep, normalizePlaybook, playbookRecipe, renderPlaybookTemplate, resolvePlaybooks, withPlaybookTag,
  type Playbook,
} from './playbooks';

describe('playbooks — api mirror', () => {
  it('api/_playbooks.ts is byte-identical to src/lib/crm/playbooks.ts', () => {
    const root = resolve(__dirname, '../../..');
    const canonical = readFileSync(resolve(root, 'src/lib/crm/playbooks.ts'), 'utf8');
    const mirror = readFileSync(resolve(root, 'api/_playbooks.ts'), 'utf8');
    expect(mirror).toBe(canonical);
  });
});

const seo = () => playbookRecipe('seo')!;

describe('normalizePlaybook / resolvePlaybooks', () => {
  it('recipes are valid and sorted by day with unique days', () => {
    for (const r of PLAYBOOK_RECIPES) {
      const pb = normalizePlaybook(r)!;
      expect(pb).not.toBeNull();
      const days = pb.steps.map(s => s.day);
      expect(days).toEqual([...days].sort((a, b) => a - b));
      expect(new Set(days).size).toBe(days.length);
    }
  });

  it('drops invalid steps, duplicate days and unknown channels; sorts steps', () => {
    const pb = normalizePlaybook({
      id: 'x y!', name: ' Test ', tag: 'T', keywords: ['A', 'a', ' b '],
      steps: [
        { day: 7, channel: 'email', title: 'Ofertë' },
        { day: 1, channel: 'call', title: 'Thirr' },
        { day: 1, channel: 'call', title: 'dup' },
        { day: 500, channel: 'call', title: 'too late' },
        { day: 3, channel: 'fax', title: 'unknown channel' },
        { day: 4, channel: 'whatsapp', title: '' },
      ],
    })!;
    expect(pb.id).toBe('xy');
    expect(pb.name).toBe('Test');
    expect(pb.keywords).toEqual(['a', 'b']);
    expect(pb.steps.map(s => s.day)).toEqual([1, 7]);
    expect(pb.active).toBe(true);
  });

  it('rejects playbooks without id/name/tag and de-duplicates by id', () => {
    expect(normalizePlaybook({ name: 'x', tag: 'y' })).toBeNull();
    expect(normalizePlaybook(null)).toBeNull();
    const list = resolvePlaybooks({ followUpPlaybooks: [seo(), seo(), { id: 'bad' }, 'junk'] });
    expect(list.map(p => p.id)).toEqual(['seo']);
    expect(resolvePlaybooks(null)).toEqual([]);
    expect(resolvePlaybooks({ followUpPlaybooks: 'nope' })).toEqual([]);
  });
});

describe('matching', () => {
  const books: Playbook[] = [playbookRecipe('seo')!, playbookRecipe('ads')!];

  it('matches whole words, accent- and case-insensitively', () => {
    expect(matchPlaybookByKeywords('Pershendetje, jam i interesuar per SEO.', books)?.id).toBe('seo');
    expect(matchPlaybookByKeywords('Dua KËRKIM më të mirë në Google', books)?.id).toBe('seo');
    expect(matchPlaybookByKeywords('Kam nje pyetje per reklamat', books)?.id).toBe('ads');
  });

  it('longest keyword wins across playbooks; no partial-word matches', () => {
    expect(matchPlaybookByKeywords('sa kushton google ads?', books)?.id).toBe('ads'); // "google ads" > "google"
    expect(matchPlaybookByKeywords('seoul trip', books)).toBeNull();
    expect(matchPlaybookByKeywords('interesohem per reklamave ne facebook', books)?.id).toBe('ads'); // inflection of a 5+ char keyword
    expect(matchPlaybookByKeywords('kerkimi i tregut', books)?.id).toBe('seo');
    expect(matchPlaybookByKeywords('', books)).toBeNull();
  });

  it('ignores inactive playbooks', () => {
    const inactive = { ...seo(), active: false };
    expect(matchPlaybookByKeywords('seo', [inactive])).toBeNull();
    expect(matchPlaybookByTags(['seo'], [inactive])).toBeNull();
    expect(matchPlaybookByTags(['Seo', 'vip'], books)?.id).toBe('seo');
    expect(matchPlaybookByTags(undefined, books)).toBeNull();
  });
});

describe('templates', () => {
  it('renders tokens, derives firstName, empties unknown tokens', () => {
    const out = renderPlaybookTemplate('Përshëndetje {{firstName}} ({{name}}) nga {{company}} — {{service}} {{unknown}}!', {
      name: 'Arben Hoxha', company: 'Hoxha Shpk', service: 'SEO',
    });
    expect(out).toBe('Përshëndetje Arben (Arben Hoxha) nga Hoxha Shpk — SEO !');
    expect(renderPlaybookTemplate('{{staffName}} këtu', { staffName: 'Blerta' })).toBe('Blerta këtu');
    expect(renderPlaybookTemplate('', {})).toBe('');
  });
});

describe('enrolment + steps', () => {
  const books = [seo()];
  it('enroll starts at step 0; next/current steps follow cadenceStep', () => {
    const now = new Date('2026-09-12T10:00:00Z');
    const patch = enrollPlaybookPatch(seo(), now);
    expect(patch).toEqual({ playbookId: 'seo', cadenceActive: true, cadenceStartedAt: now, cadenceStep: 0 });

    const lead = { ...patch };
    expect(currentPlaybookStep(lead, books)).toBeNull();          // nothing fired yet
    expect(nextPlaybookStep(lead, books)?.step.day).toBe(1);

    const after2 = { ...lead, cadenceStep: 2 };
    expect(currentPlaybookStep(after2, books)?.step.day).toBe(3);
    expect(nextPlaybookStep(after2, books)?.step.day).toBe(7);

    const done = { ...lead, cadenceStep: 7, cadenceActive: false };
    expect(nextPlaybookStep(done, books)).toBeNull();
    expect(currentPlaybookStep(done, books)?.step.day).toBe(30);

    expect(nextPlaybookStep({ playbookId: 'missing', cadenceStep: 0 }, books)).toBeNull();
    expect(nextPlaybookStep({}, books)).toBeNull();
  });

  it('withPlaybookTag merges once, case-insensitively', () => {
    expect(withPlaybookTag(['vip', 'seo'], seo())).toEqual(['vip', 'seo']);
    expect(withPlaybookTag(['vip'], seo())).toEqual(['vip', 'SEO']);
    expect(withPlaybookTag(undefined, seo())).toEqual(['SEO']);
  });
});
