// Postinstall patch for baileys@7.0.0-rc14 — WhiskeySockets/Baileys#2781 (PR #2839, unmerged).
//
// Answering a 1:1 retry receipt, relayMessage ran BOTH the 1:1 device fan-out
// (whose loop is not guarded by isRetryResend, so the retry participant was
// encrypted into a `participants` node) AND the dedicated retry block (which
// encrypts the same message again as a bare `enc`). One stanza, two shapes,
// two ratchet steps: the server rejects it with 479 smax-invalid and the
// device that asked for the retry shows "Waiting for this message" forever.
// Fix: a retry resend skips the fan-out loop; only the retry block encrypts.
//
// Idempotent, version-guarded, and LOUD when the anchor is missing — a silent
// no-op after an upgrade would bring the bug back unnoticed.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..', 'node_modules', 'baileys');
let version = '';
try { version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version; } catch { /* not installed */ }
if (version !== '7.0.0-rc14') {
  console.warn(`[patch-baileys] baileys ${version || '(missing)'} != 7.0.0-rc14 — patch not applied; re-check issue #2781 for this version.`);
  process.exit(0);
}
const file = join(pkgDir, 'lib', 'Socket', 'messages-send.js');
let src = readFileSync(file, 'utf8');
const MARK = '/* fivocrm-patch-2781 */';
if (src.includes(MARK)) { console.log('[patch-baileys] #2781 already applied'); process.exit(0); }
const anchor = `                const { user: meLidUser } = meLid ? jidDecode(meLid) : { user: null };
                for (const { user, jid } of devices) {`;
const count = src.split(anchor).length - 1;
if (count !== 1) {
  console.error(`[patch-baileys] anchor found ${count}x (expected 1) — #2781 patch NOT applied`);
  process.exit(1);
}
src = src.replace(anchor, `                const { user: meLidUser } = meLid ? jidDecode(meLid) : { user: null };
                ${MARK} for (const { user, jid } of (isRetryResend ? [] : devices)) {`);
writeFileSync(file, src);
console.log('[patch-baileys] #2781 applied (1:1 retry resend encrypts once)');
