#!/usr/bin/env node
/**
 * Guards the ONE Capacitor invariant npm cannot enforce for us: the runtime
 * (`@capacitor/core`), the tooling (`@capacitor/cli`) and each native platform
 * (`@capacitor/android`, `@capacitor/ios`) must be the SAME version.
 *
 * Why this exists: those four were declared with caret ranges (`^8.2.0`), so npm
 * was free to resolve them independently — and did. The lockfile ended up with
 * core 8.4.2 against android/cli 8.2.0, i.e. a JS bridge talking to a native
 * bridge three patch releases behind it. `cap sync` says so, but as ONE grey
 * `[warn]` line in the middle of a plugin list nobody reads, and the mismatch
 * survives all the way into a Play upload where the symptom is a plugin that
 * silently rejects at runtime on real devices only.
 *
 * The versions are therefore pinned EXACTLY in package.json (so they can only
 * move together, in a deliberate commit) and this check is the tripwire: the
 * configure scripts call it, so `npm run android:sync` / `ios:sync` fail loudly
 * instead of warning quietly.
 *
 * Exported rather than inlined twice — a copy in each configure script would
 * drift the first time the rule changes.
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** Installed version of a package, or null when it isn't installed. */
function installedVersion(pkg) {
  try {
    return require(path.join(ROOT, 'node_modules', pkg, 'package.json')).version || null;
  } catch {
    return null;
  }
}

/** `8.5.0` → `8.5`. A patch-level split is a warning; a minor/major one is fatal. */
const minorOf = (v) => String(v).split('.').slice(0, 2).join('.');

/**
 * @param {'android'|'ios'} platform
 * @returns {{ fatal: string[], warnings: string[], versions: Record<string,string|null> }}
 */
function checkCapacitorVersions(platform) {
  const packages = ['@capacitor/core', '@capacitor/cli', `@capacitor/${platform}`];
  const versions = {};
  for (const p of packages) versions[p] = installedVersion(p);

  const fatal = [];
  const warnings = [];

  const missing = packages.filter((p) => !versions[p]);
  if (missing.length) {
    // Not this check's job to fix a broken install — say what happened and stop.
    warnings.push(`not installed: ${missing.join(', ')} → run \`npm install\``);
    return { fatal, warnings, versions };
  }

  const present = packages.map((p) => `${p}@${versions[p]}`).join(', ');
  const unique = [...new Set(packages.map((p) => versions[p]))];
  if (unique.length === 1) return { fatal, warnings, versions };

  // Align ON THE CORE version: it is the one the app code is written against.
  const fix = `npm i --save-exact ${packages
    .map((p) => `${p}@${versions['@capacitor/core']}`)
    .join(' ')}`;

  const spread = [...new Set(packages.map((p) => minorOf(versions[p])))];
  if (spread.length > 1) {
    fatal.push(
      `Capacitor versions disagree across a MINOR release: ${present}.\n` +
      `    The JS bridge and the native bridge are not the same generation — a plugin\n` +
      `    can then fail on a device while everything builds fine. Align them:\n` +
      `      ${fix}`
    );
  } else {
    warnings.push(
      `Capacitor patch versions disagree: ${present}. Align them before a store upload:\n` +
      `      ${fix}`
    );
  }
  return { fatal, warnings, versions };
}

module.exports = { checkCapacitorVersions, installedVersion };
