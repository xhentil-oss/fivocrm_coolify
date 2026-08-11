/**
 * @vitest-environment node
 *
 * Runs in node, not jsdom: this reads the repository off disk, and the default
 * jsdom environment externalises `node:fs`.
 *
 * Guard: every relative import inside `api/` must carry a `.js` extension.
 *
 * This exists because of an outage that nothing else could see. `package.json`
 * declares `"type": "module"`, so the deployed Vercel functions run as NATIVE ESM,
 * where `import … from '../_money'` throws ERR_MODULE_NOT_FOUND at MODULE LOAD —
 * before the handler runs, before auth is checked. Vercel reports that as
 * `FUNCTION_INVOCATION_FAILED`, i.e. an opaque 500 on every single request, so
 * `api/cron/run.ts` returned 500 for EVERY job (the VPS scheduler logged hundreds of
 * them) and the failure looked like a Firestore quota problem rather than a typo.
 *
 * Why a test and not a type error: `tsconfig.api.json` uses
 * `moduleResolution: "node"`, which resolves extensionless specifiers happily, so
 * `npm run typecheck:api` reports CLEAN. `vite build` never touches `api/` either.
 * One missing `.js` was therefore invisible to every check in the repo.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const API_DIR = join(process.cwd(), 'api');

function tsFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFilesIn(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** `import … from '…'`, `export … from '…'` and dynamic `import('…')`. */
const SPECIFIER_RE = /(?:from|import)\s*\(?\s*['"](\.[^'"]*)['"]/g;

describe('api/ ESM imports', () => {
  const files = tsFilesIn(API_DIR);

  it('finds the api directory', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('gives every relative import an explicit .js extension', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(SPECIFIER_RE)) {
        const spec = match[1];
        // A directory import would be equally broken, but there are none and
        // allowing one would need its own index resolution rule.
        if (spec.endsWith('.js') || spec.endsWith('.json')) continue;
        const line = src.slice(0, match.index).split('\n').length;
        offenders.push(`${file.replace(process.cwd(), '.')}:${line} → '${spec}'`);
      }
    }

    expect(
      offenders,
      `Relative imports in api/ must end in .js — native ESM throws at load time otherwise, `
      + `which takes the whole function down with FUNCTION_INVOCATION_FAILED:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
