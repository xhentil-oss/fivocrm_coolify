// Remove unused IMPORT specifiers that `tsc -p tsconfig.app.json` reports (TS6133).
// Surgical on purpose: it only edits lines that sit inside an `import … from '…'`
// statement, and only removes the exact identifier tsc named. Unused *variables*
// are left alone — those often mean half-wired features, not stale imports.
//
//   node scripts/strip-unused-imports.mjs          (dry-run)
//   node scripts/strip-unused-imports.mjs --apply

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');

function tscErrors() {
  let out = '';
  try {
    out = execSync('npx tsc -p tsconfig.app.json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const rx = /^(.+?)\((\d+),(\d+)\): error TS6133: '(.+?)' is declared but its value is never read\.$/;
  return out.split(/\r?\n/).map(l => l.match(rx)).filter(Boolean).map(m => ({
    file: m[1].replace(/\\/g, '/'), line: +m[2], name: m[4],
  }));
}

/** Index of the line that starts the import statement covering `line`, or null. */
function importStart(lines, line) {
  for (let i = line - 1; i >= 0 && i > line - 12; i--) {
    const t = lines[i].trim();
    if (t.startsWith('import ')) return i;
    // A statement boundary before finding `import` ⇒ this is not an import.
    if (t.endsWith(';') && i !== line - 1) return null;
  }
  return null;
}

const errors = tscErrors();
const byFile = new Map();
errors.forEach(e => {
  if (!byFile.has(e.file)) byFile.set(e.file, []);
  byFile.get(e.file).push(e);
});

let removed = 0, skipped = 0, statementsDropped = 0;
const skippedDetail = [];

for (const [file, list] of byFile) {
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { continue; }
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  let lines = src.split(/\r?\n/);

  // Bottom-up: every edit happens BELOW the targets not yet processed, so their
  // line numbers stay valid. Top-down, the first splice that changes the line
  // count shifted every later target and we edited the wrong statement.
  list.sort((a, b) => b.line - a.line);

  for (const { line, name } of list) {
    const startIdx = importStart(lines, line);
    if (startIdx === null) { skipped++; skippedDetail.push(`${file}:${line} ${name} (nuk është import)`); continue; }

    // Find the end of the statement (the line containing `from` or `;`).
    let endIdx = startIdx;
    while (endIdx < lines.length && !/from\s+['"]/.test(lines[endIdx]) && !lines[endIdx].trim().endsWith(';')) endIdx++;
    const block = lines.slice(startIdx, endIdx + 1).join(eol);

    // Only touch NAMED imports: `import X from` / `import * as X` are whole-module.
    if (!/\{[\s\S]*\}/.test(block)) { skipped++; skippedDetail.push(`${file}:${line} ${name} (import default/namespace)`); continue; }

    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // `Name`, `type Name`, `Other as Name` — drop the whole specifier.
    const spec = new RegExp(`(?:\\btype\\s+)?\\b[A-Za-z0-9_$]+\\s+as\\s+${esc}\\b|(?:\\btype\\s+)?\\b${esc}\\b`);
    const inner = block.match(/\{([\s\S]*)\}/);
    if (!inner) { skipped++; continue; }

    const parts = inner[1].split(',').map(s => s.trim()).filter(Boolean);
    const keep = parts.filter(p => !spec.test(p) || !new RegExp(`\\b${esc}\\b`).test(p));
    if (keep.length === parts.length) { skipped++; skippedDetail.push(`${file}:${line} ${name} (nuk u gjet te lista)`); continue; }

    let next;
    if (keep.length === 0) {
      // Whole statement is now empty — drop it (verified: these are local UI modules
      // with no side effects; a side-effect import has no braces and is skipped above).
      next = null;
      statementsDropped++;
    } else {
      const multiline = /\n/.test(block) || block.length > 100;
      const joined = multiline ? `{${eol}  ${keep.join(`,${eol}  `)},${eol}}` : `{ ${keep.join(', ')} }`;
      next = block.replace(/\{[\s\S]*\}/, joined);
    }

    const replacement = next === null ? [] : next.split(eol);
    lines.splice(startIdx, endIdx - startIdx + 1, ...replacement);
    removed++;
  }

  if (APPLY) writeFileSync(file, lines.join(eol), 'utf8');
}

console.log(`[strip-unused-imports] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);
console.log(`  TS6133 raportuar        : ${errors.length}`);
console.log(`  specifikues të hequr    : ${removed}`);
console.log(`  deklarata të fshira     : ${statementsDropped}`);
console.log(`  të kapërcyer (me qëllim): ${skipped}`);
skippedDetail.slice(0, 15).forEach(s => console.log(`      · ${s}`));
if (!APPLY) console.log('\nRun again with --apply to write.');
