#!/usr/bin/env node
/**
 * Applies every FivoCRM-specific change to the generated `android/` project.
 *
 * `android/` is gitignored (same as `ios/`), so the native project is a build
 * artefact that anyone — or CI — can recreate with `npx cap add android`.
 * Everything that would otherwise be a hand edit inside that folder lives in
 * this script instead, and it is idempotent: run it after every
 * `npx cap sync android` (`npm run android:sync` already does).
 *
 * What it does:
 *   1. app/build.gradle — release signing from keystore.properties, R8 +
 *      resource shrinking, NDK debug symbols, and the version numbers (this
 *      script is their SOURCE OF TRUTH — see VERSION_CODE below).
 *   2. app/proguard-rules.pro — keep rules for Capacitor/Firebase reflection
 *      and the -dontwarn lines that stop R8 failing on the Facebook auth
 *      classes we deliberately don't bundle.
 *   3. AndroidManifest.xml — allowBackup=false, the FCM default notification
 *      icon/colour, POST_NOTIFICATIONS and RECORD_AUDIO.
 *   4. res/drawable/ic_stat_notify.xml + res/values/colors.xml — the
 *      monochrome status-bar mark and its brand tint.
 *   5. variables.gradle — rgcfaIncludeGoogle (native Google sign-in deps).
 *   6. Checks the three files this script CANNOT regenerate (keystore,
 *      keystore.properties, google-services.json) and prints how to restore
 *      them. Set ANDROID_SECRETS_DIR to a backup folder to auto-restore.
 *
 * Usage: node scripts/android-configure.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ANDROID = path.join(ROOT, 'android');
const APP = path.join(ANDROID, 'app');
const MAIN = path.join(APP, 'src', 'main');
const RES = path.join(MAIN, 'res');

const { checkCapacitorVersions } = require('./capacitor-versions.cjs');

const BUILD_GRADLE = path.join(APP, 'build.gradle');
const PROGUARD = path.join(APP, 'proguard-rules.pro');
const MANIFEST = path.join(MAIN, 'AndroidManifest.xml');
const VARIABLES = path.join(ANDROID, 'variables.gradle');
const COLORS = path.join(RES, 'values', 'colors.xml');
const NOTIFY_ICON = path.join(RES, 'drawable', 'ic_stat_notify.xml');

/**
 * Play Store version. THIS is the source of truth — android/app/build.gradle is
 * a build artefact, so a version that lives only there is lost the moment the
 * folder is regenerated, and Play then rejects the upload as a duplicate
 * versionCode. Bump VERSION_CODE by 1 for every upload.
 */
const VERSION_CODE = 30;
const VERSION_NAME = '1.8.2';

const done = [];
const warnings = [];

// ── helpers ──────────────────────────────────────────────────────────────────

const read = (p) => fs.readFileSync(p, 'utf8');

function write(p, contents, label) {
  const existed = fs.existsSync(p);
  if (existed && read(p) === contents) return false;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contents);
  done.push(`${label}: ${existed ? 'updated' : 'created'}`);
  return true;
}

/**
 * Replaces the body of a `name {` … `}` block, matching braces rather than
 * using a regex, so anything Capacitor adds inside a block we don't own is
 * preserved and a re-run never nests a second copy.
 * Returns null when the block isn't there.
 */
function replaceBlockBody(src, name, body, fromIndex = 0) {
  const header = new RegExp(`(^|\\n)(\\s*)${name}\\s*\\{`);
  const match = header.exec(src.slice(fromIndex));
  if (!match) return null;
  const open = fromIndex + match.index + match[0].length - 1; // at '{'
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(0, open + 1) + body + src.slice(i);
    }
  }
  return null;
}

function indexOfBlock(src, name) {
  const m = new RegExp(`(^|\\n)\\s*${name}\\s*\\{`).exec(src);
  return m ? m.index : -1;
}

// ── 1. app/build.gradle ──────────────────────────────────────────────────────

const KEYSTORE_LOADER = `
// Release signing — credentials read from android/keystore.properties (gitignored).
def keystorePropsFile = rootProject.file("keystore.properties")
def keystoreProps = new Properties()
if (keystorePropsFile.exists()) {
    keystoreProps.load(new FileInputStream(keystorePropsFile))
}
`;

const SIGNING_CONFIGS = `
    signingConfigs {
        release {
            if (keystorePropsFile.exists()) {
                storeFile file(keystoreProps['storeFile'])
                storePassword keystoreProps['storePassword']
                keyAlias keystoreProps['keyAlias']
                keyPassword keystoreProps['keyPassword']
            }
        }
    }
`;

const RELEASE_BUILD_TYPE = `
            // Sign with the release config when keystore.properties is present.
            if (keystorePropsFile.exists()) {
                signingConfig signingConfigs.release
            }
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
            // Bundle native debug symbols into the AAB so Play Console can
            // symbolicate crashes/ANRs — clears the "no debug symbols" warning.
            ndk {
                debugSymbolLevel 'FULL'
            }
        `;

function patchBuildGradle() {
  let src = read(BUILD_GRADLE);
  const before = src;

  // Keystore loader — must sit above `android {` so signingConfigs can read it.
  if (!src.includes('keystorePropsFile')) {
    src = src.replace(/(apply plugin: 'com\.android\.application'\n)/, `$1${KEYSTORE_LOADER}`);
  }

  // Version numbers: always rewritten from the constants above.
  src = src.replace(/versionCode\s+\d+/, `versionCode ${VERSION_CODE}`);
  src = src.replace(/versionName\s+"[^"]*"/, `versionName "${VERSION_NAME}"`);

  // signingConfigs — insert before buildTypes when absent.
  if (indexOfBlock(src, 'signingConfigs') === -1) {
    src = src.replace(/\n(\s*)buildTypes\s*\{/, `\n${SIGNING_CONFIGS}$1buildTypes {`);
  }

  // release buildType — replace its body wholesale (it is entirely ours).
  const buildTypesAt = indexOfBlock(src, 'buildTypes');
  if (buildTypesAt !== -1) {
    const patched = replaceBlockBody(src, 'release', RELEASE_BUILD_TYPE, buildTypesAt);
    if (patched) src = patched;
    else warnings.push('app/build.gradle: no release buildType found — check it by hand');
  }

  if (src !== before) {
    fs.writeFileSync(BUILD_GRADLE, src);
    done.push(`app/build.gradle: signing + R8 + version ${VERSION_NAME} (${VERSION_CODE})`);
  }
}

// ── 2. proguard-rules.pro ────────────────────────────────────────────────────

const PROGUARD_MARKER = '# ── FivoCRM ──';
const PROGUARD_RULES = `
${PROGUARD_MARKER}
# Preserve line numbers for readable crash stack traces (Sentry).
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ── Capacitor core + plugins (registered via reflection) ──────────────────
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keep class io.capawesome.capacitorjs.** { *; }

# ── Firebase (Auth, Firestore, Messaging) ─────────────────────────────────
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# ── Google Identity / Credential Manager (native Google sign-in) ──────────
-keep class com.google.android.libraries.identity.googleid.** { *; }
-keep class androidx.credentials.** { *; }

# Keep JS-facing interfaces on the WebView bridge.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ── Ignore optional providers we don't use ────────────────────────────────
# The Firebase Authentication plugin references Facebook login classes; we only
# use Google, so the Facebook SDK isn't bundled. Tell R8 not to fail on them.
-dontwarn com.facebook.**
-dontwarn io.capawesome.capacitorjs.plugins.firebase.authentication.handlers.FacebookAuthProviderHandler*
-dontwarn io.capawesome.capacitorjs.plugins.firebase.authentication.handlers.PlayGamesAuthProviderHandler*
`;

function patchProguard() {
  const src = fs.existsSync(PROGUARD) ? read(PROGUARD) : '';
  // Sentinels, not just the marker: a file hand-edited before this script
  // existed already carries these rules, and appending them again would double
  // every line on the first run.
  const applied =
    src.includes(PROGUARD_MARKER) ||
    (src.includes('-keep class com.getcapacitor.**') && src.includes('-dontwarn com.facebook.**'));
  if (applied) return;
  write(PROGUARD, `${src.trimEnd()}\n${PROGUARD_RULES}`, 'app/proguard-rules.pro');
}

// ── 3. AndroidManifest.xml ───────────────────────────────────────────────────

const FCM_META = `
        <!-- FCM push: status-bar icon (monochrome white "X") + brand tint, so
             notifications show our mark like WhatsApp/Maps instead of a generic
             square. Used when a payload doesn't set its own icon/color. -->
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_icon"
            android:resource="@drawable/ic_stat_notify" />
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_color"
            android:resource="@color/notification_color" />
`;

const PERMISSIONS = `    <!-- Push notifications (Android 13+ runtime permission) -->
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <!-- Voice notes in chat -->
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
`;

function patchManifest() {
  let src = read(MANIFEST);
  const before = src;

  // A CRM holds client data — never let adb/cloud backup pull it off the device.
  src = src.replace(/android:allowBackup="true"/, 'android:allowBackup="false"');

  if (!src.includes('default_notification_icon')) {
    src = src.replace(/\n(\s*)<\/application>/, `\n${FCM_META}$1</application>`);
  }
  if (!src.includes('POST_NOTIFICATIONS')) {
    src = src.replace(/\n<\/manifest>/, `\n${PERMISSIONS}</manifest>`);
  }

  if (src !== before) {
    fs.writeFileSync(MANIFEST, src);
    done.push('AndroidManifest.xml: allowBackup=false, FCM icon/colour, notification + audio permissions');
  }
}

// ── 4. notification icon + colour ────────────────────────────────────────────

const COLORS_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Tint applied to the status-bar notification icon (FivoCRM cyan). -->
    <color name="notification_color">#0EA5E9</color>
</resources>
`;

const NOTIFY_ICON_XML = `<!-- Monochrome status-bar notification icon (Android renders it as an alpha mask
     and tints it with default_notification_color). White "X" brand mark. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M6.8,4.2 L12,9.4 L17.2,4.2 L19.8,6.8 L14.6,12 L19.8,17.2 L17.2,19.8 L12,14.6 L6.8,19.8 L4.2,17.2 L9.4,12 L4.2,6.8 Z" />
</vector>
`;

function writeNotificationAssets() {
  write(COLORS, COLORS_XML, 'res/values/colors.xml');
  write(NOTIFY_ICON, NOTIFY_ICON_XML, 'res/drawable/ic_stat_notify.xml');
}

// ── 5. variables.gradle ──────────────────────────────────────────────────────

function patchVariables() {
  let src = read(VARIABLES);
  if (src.includes('rgcfaIncludeGoogle')) return;
  const addition = `
    // @capacitor-firebase/authentication — bundle native Google sign-in deps
    rgcfaIncludeGoogle = true
    rgcfaIncludeFacebook = false
`;
  const patched = replaceBlockBody(src, 'ext', `${src.match(/ext\s*\{([\s\S]*)\}/)[1].trimEnd()}\n${addition}`);
  if (!patched) {
    warnings.push('variables.gradle: no ext block — add rgcfaIncludeGoogle = true by hand');
    return;
  }
  fs.writeFileSync(VARIABLES, patched);
  done.push('variables.gradle: rgcfaIncludeGoogle (native Google sign-in)');
}

// ── 6. local.properties (sdk.dir) ────────────────────────────────────────────

/**
 * Android Studio writes this on first open; `cap add` does not. Without it a
 * TERMINAL build dies at `minifyReleaseWithR8` with "SDK location not found",
 * which reads like a broken project rather than a missing one-line file.
 * The path is machine-specific, so it is generated here, never copied.
 */
function writeLocalProperties() {
  const target = path.join(ANDROID, 'local.properties');
  if (fs.existsSync(target) && /^\s*sdk\.dir=/m.test(read(target))) return;

  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    process.env.HOME && path.join(process.env.HOME, 'Library', 'Android', 'sdk'), // macOS
    process.env.HOME && path.join(process.env.HOME, 'Android', 'Sdk'), // Linux
  ].filter(Boolean);

  const sdk = candidates.find((dir) => fs.existsSync(dir));
  if (!sdk) {
    warnings.push(
      'local.properties: Android SDK not found — set ANDROID_HOME, or open the project once in Android Studio'
    );
    return;
  }

  // Gradle reads this as a .properties file: backslashes and ':' must be escaped.
  const escaped = sdk.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
  write(
    target,
    `# Generated by scripts/android-configure.cjs — machine-specific, never commit.\nsdk.dir=${escaped}\n`,
    'local.properties'
  );
}

// ── 7. the files this script cannot regenerate ───────────────────────────────

const SECRETS = [
  {
    file: path.join(APP, 'google-services.json'),
    name: 'app/google-services.json',
    how: 'Firebase Console → Project settings → Android app com.fivocrm.app → google-services.json',
  },
  {
    file: path.join(APP, 'fivocrm-release.jks'),
    name: 'app/fivocrm-release.jks',
    how: 'restore from your off-machine backup — WITHOUT it the app can never be updated on Play',
  },
  {
    file: path.join(ANDROID, 'keystore.properties'),
    name: 'keystore.properties',
    how: 'recreate: storeFile=fivocrm-release.jks / storePassword=… / keyAlias=fivocrm / keyPassword=… (see workspace/ANDROID_BUILD.md)',
  },
];

function checkSecrets() {
  const backupDir = process.env.ANDROID_SECRETS_DIR;
  for (const s of SECRETS) {
    if (fs.existsSync(s.file)) continue;
    if (backupDir) {
      const candidate = path.join(backupDir, path.basename(s.file));
      if (fs.existsSync(candidate)) {
        fs.mkdirSync(path.dirname(s.file), { recursive: true });
        fs.copyFileSync(candidate, s.file);
        done.push(`${s.name}: restored from ANDROID_SECRETS_DIR`);
        continue;
      }
    }
    warnings.push(`${s.name} is missing → ${s.how}`);
  }
}

// ── run ──────────────────────────────────────────────────────────────────────


// ── Capacitor version parity ─────────────────────────────────────────────────
// Runs FIRST: configuring (or building) a native project whose native bridge is
// a different Capacitor generation than the JS one is not worth doing. The
// mismatch is otherwise a single grey `[warn]` line inside `cap sync` output.
function checkVersionParity(platform) {
  const { fatal, warnings: warns } = checkCapacitorVersions(platform);
  if (fatal.length) {
    console.error('');
    console.error('Capacitor version mismatch');
    console.error('');
    for (const f of fatal) console.error(`  - ${f}`);
    console.error('');
    process.exit(1);
  }
  for (const w of warns) warnings.push(w);
}

function main() {
  checkVersionParity('android');
  if (!fs.existsSync(BUILD_GRADLE)) {
    console.error('android/ project not found. Run:\n  npm i && npx cap add android && npm run android:configure');
    process.exit(1);
  }

  patchBuildGradle();
  patchProguard();
  patchManifest();
  writeNotificationAssets();
  patchVariables();
  writeLocalProperties();
  checkSecrets();

  console.log('\nAndroid project configured (android/app).');
  if (done.length) {
    console.log('\nChanges:');
    for (const d of done) console.log(`  • ${d}`);
  } else {
    console.log('  Already up to date.');
  }
  if (warnings.length) {
    console.log('\n⚠  Before building a release:');
    for (const w of warnings) console.log(`  • ${w}`);
  }
  console.log('\nRunbook: workspace/ANDROID_BUILD.md\n');
}

main();
