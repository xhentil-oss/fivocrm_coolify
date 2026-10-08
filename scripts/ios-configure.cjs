#!/usr/bin/env node
/**
 * Applies every FivoCRM-specific change to the generated `ios/` project.
 *
 * `ios/` is gitignored (same as `android/`), so the native project is a build
 * artefact that anyone — or CI — can recreate with `npx cap add ios`. Everything
 * that would otherwise be a manual click in Xcode lives in this script instead,
 * and it is idempotent: run it after every `npx cap sync ios`.
 *
 * What it does:
 *   1. Rewrites the Windows backslashes that `cap sync` writes into
 *      CapApp-SPM/Package.swift (they are invalid Swift escapes → Xcode can't
 *      resolve the local plugin packages).
 *   2. Adds the Info.plist keys the app actually needs: camera + microphone
 *      (video calls, voice notes), photo library, remote-notification background
 *      mode, the Google Sign-In callback URL scheme, export-compliance flag.
 *   3. Writes App.entitlements (push + Sign in with Apple) and wires
 *      CODE_SIGN_ENTITLEMENTS.
 *   4. Writes PrivacyInfo.xcprivacy (Apple requires the required-reason API
 *      declarations) and adds it to the target's Resources.
 *   5. Bundles GoogleService-Info.plist when present, and copies its
 *      REVERSED_CLIENT_ID into the URL scheme.
 *   6. Regenerates the AppIcon/Splash artwork from the brand mark.
 *
 * Usage: node scripts/ios-configure.cjs
 */
const fs = require('fs');
const path = require('path');
const { generate: generateAssets } = require('./ios-brand-assets.cjs');
const { checkCapacitorVersions } = require('./capacitor-versions.cjs');

const ROOT = path.resolve(__dirname, '..');
const IOS = path.join(ROOT, 'ios');
const APP_DIR = path.join(IOS, 'App', 'App');
const PBXPROJ = path.join(IOS, 'App', 'App.xcodeproj', 'project.pbxproj');
const PACKAGE_SWIFT = path.join(IOS, 'App', 'CapApp-SPM', 'Package.swift');
const INFO_PLIST = path.join(APP_DIR, 'Info.plist');
const ENTITLEMENTS = path.join(APP_DIR, 'App.entitlements');
const PRIVACY = path.join(APP_DIR, 'PrivacyInfo.xcprivacy');
const GOOGLE_PLIST = path.join(APP_DIR, 'GoogleService-Info.plist');

const BUNDLE_ID = 'com.fivocrm.app';
const URL_SCHEME_PLACEHOLDER = 'REPLACE_WITH_REVERSED_CLIENT_ID';

// Deterministic object ids (24 hex chars, like Xcode's) so re-running the script
// never adds a second copy of the same file.
const IDS = {
  privacyFileRef: 'FF0CB0000000000000000A01',
  privacyBuildFile: 'FF0CB0000000000000000A02',
  googleFileRef: 'FF0CB0000000000000000B01',
  googleBuildFile: 'FF0CB0000000000000000B02',
};

const notes = [];
const warnings = [];
const done = [];

// ── 1. Package.swift: Windows paths → POSIX ──────────────────────────────────
function fixSpmPaths() {
  if (!fs.existsSync(PACKAGE_SWIFT)) return;
  const before = fs.readFileSync(PACKAGE_SWIFT, 'utf8');
  // Only touch the `path:` string literals — `\n` inside `..\node_modules` is a
  // newline escape and `\@` is not a valid escape at all, so Xcode fails to load
  // the package when `cap sync` runs on Windows.
  const after = before.replace(/path:\s*"([^"]*)"/g, (m, p) => `path: "${p.replace(/\\/g, '/')}"`);
  if (after !== before) {
    fs.writeFileSync(PACKAGE_SWIFT, after);
    done.push('Package.swift: plugin paths converted to forward slashes');
  }
}

// ── 2. Info.plist ────────────────────────────────────────────────────────────
const PLIST_KEYS = [
  // Video calls (Daily.co) run inside the WebView; iOS needs both strings or
  // getUserMedia fails silently.
  ['NSCameraUsageDescription', '<string>Kamera përdoret për videotelefonata me ekipin dhe klientët.</string>'],
  ['NSMicrophoneUsageDescription', '<string>Mikrofoni përdoret për mesazhe zanore në chat dhe për videotelefonata.</string>'],
  ['NSPhotoLibraryUsageDescription', '<string>Galeria përdoret për të bashkëngjitur foto në chat, oferta dhe raporte.</string>'],
  ['NSPhotoLibraryAddUsageDescription', '<string>Ruajtja në galeri e skedarëve dhe faturave të krijuara nga aplikacioni.</string>'],
  // FCM delivery while backgrounded.
  ['UIBackgroundModes', '<array>\n\t\t<string>remote-notification</string>\n\t</array>'],
  // Answers the export-compliance question automatically on every upload
  // (the app only uses standard HTTPS/system crypto).
  ['ITSAppUsesNonExemptEncryption', '<false/>'],
  // Google Sign-In callback. The value is the REVERSED_CLIENT_ID from
  // GoogleService-Info.plist; step 5 fills it in when that file is present.
  ['CFBundleURLTypes', `<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>${URL_SCHEME_PLACEHOLDER}</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>`],
];

function patchInfoPlist() {
  let plist = fs.readFileSync(INFO_PLIST, 'utf8');
  const added = [];
  for (const [key, value] of PLIST_KEYS) {
    if (plist.includes(`<key>${key}</key>`)) continue;
    plist = plist.replace(/\n<\/dict>\n<\/plist>/, `\n\t<key>${key}</key>\n\t${value}\n</dict>\n</plist>`);
    added.push(key);
  }
  if (added.length) {
    fs.writeFileSync(INFO_PLIST, plist);
    done.push(`Info.plist: added ${added.join(', ')}`);
  }
}

// ── 3. Entitlements (push notifications + Sign in with Apple) ────────────────
const ENTITLEMENTS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<!-- Xcode swaps this for "production" when archiving with a distribution
	     profile, so the same file works for local device builds and TestFlight. -->
	<key>aps-environment</key>
	<string>development</string>
	<!-- Needs the "Sign In with Apple" capability on the App ID
	     (developer.apple.com → Identifiers → com.fivocrm.app), or signing fails. -->
	<key>com.apple.developer.applesignin</key>
	<array>
		<string>Default</string>
	</array>
</dict>
</plist>
`;

function writeEntitlements() {
  if (!fs.existsSync(ENTITLEMENTS)) {
    fs.writeFileSync(ENTITLEMENTS, ENTITLEMENTS_XML);
    done.push('App.entitlements: created (aps-environment, applesignin)');
    return;
  }
  // A project generated before Sign in with Apple existed keeps its file — add the key.
  const current = fs.readFileSync(ENTITLEMENTS, 'utf8');
  if (!current.includes('com.apple.developer.applesignin')) {
    fs.writeFileSync(
      ENTITLEMENTS,
      current.replace(
        /<\/dict>\s*<\/plist>/,
        '\t<key>com.apple.developer.applesignin</key>\n\t<array>\n\t\t<string>Default</string>\n\t</array>\n</dict>\n</plist>',
      ),
    );
    done.push('App.entitlements: added com.apple.developer.applesignin');
  }
}

// ── 4. Privacy manifest ──────────────────────────────────────────────────────
const PRIVACY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSPrivacyTracking</key>
	<false/>
	<key>NSPrivacyTrackingDomains</key>
	<array/>
	<key>NSPrivacyCollectedDataTypes</key>
	<array>
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypeEmailAddress</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<true/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			</array>
		</dict>
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypeName</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<true/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			</array>
		</dict>
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypeUserID</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<true/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			</array>
		</dict>
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypeCrashData</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<false/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			</array>
		</dict>
	</array>
	<key>NSPrivacyAccessedAPITypes</key>
	<array>
		<dict>
			<!-- Capacitor + plugins store state in UserDefaults. -->
			<key>NSPrivacyAccessedAPIType</key>
			<string>NSPrivacyAccessedAPICategoryUserDefaults</string>
			<key>NSPrivacyAccessedAPITypeReasons</key>
			<array>
				<string>CA92.1</string>
			</array>
		</dict>
		<dict>
			<!-- @capacitor/filesystem writes shared PDFs/CSVs into the container. -->
			<key>NSPrivacyAccessedAPIType</key>
			<string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
			<key>NSPrivacyAccessedAPITypeReasons</key>
			<array>
				<string>C617.1</string>
			</array>
		</dict>
		<dict>
			<key>NSPrivacyAccessedAPIType</key>
			<string>NSPrivacyAccessedAPICategoryDiskSpace</string>
			<key>NSPrivacyAccessedAPITypeReasons</key>
			<array>
				<string>E174.1</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
`;

function writePrivacyManifest() {
  if (!fs.existsSync(PRIVACY)) {
    fs.writeFileSync(PRIVACY, PRIVACY_XML);
    done.push('PrivacyInfo.xcprivacy: created');
  }
}

// ── 5. GoogleService-Info.plist → URL scheme ─────────────────────────────────
function syncGoogleConfig() {
  if (!fs.existsSync(GOOGLE_PLIST)) {
    warnings.push(
      'GoogleService-Info.plist is MISSING from ios/App/App/. The app will crash on\n' +
      '    launch (FirebaseApp.configure) — download it from the Firebase console for an\n' +
      `    iOS app with bundle id ${BUNDLE_ID}, then re-run this script.`
    );
    return;
  }
  const google = fs.readFileSync(GOOGLE_PLIST, 'utf8');
  const reversed = /<key>REVERSED_CLIENT_ID<\/key>\s*<string>([^<]+)<\/string>/.exec(google)?.[1];
  const bundle = /<key>BUNDLE_ID<\/key>\s*<string>([^<]+)<\/string>/.exec(google)?.[1];

  if (bundle && bundle !== BUNDLE_ID) {
    warnings.push(`GoogleService-Info.plist is for bundle id "${bundle}", but the app is "${BUNDLE_ID}".`);
  }
  if (!reversed) {
    warnings.push('GoogleService-Info.plist has no REVERSED_CLIENT_ID — enable Google sign-in in Firebase Auth first.');
    return;
  }
  const plist = fs.readFileSync(INFO_PLIST, 'utf8');
  if (plist.includes(`<string>${reversed}</string>`)) return;
  const next = plist.replace(
    new RegExp(`<string>${URL_SCHEME_PLACEHOLDER}</string>`),
    `<string>${reversed}</string>`
  );
  if (next === plist) {
    warnings.push(`Could not set the Google URL scheme automatically — put ${reversed} into CFBundleURLSchemes.`);
    return;
  }
  fs.writeFileSync(INFO_PLIST, next);
  done.push('Info.plist: Google Sign-In URL scheme set from GoogleService-Info.plist');
}

// ── 6. project.pbxproj ───────────────────────────────────────────────────────
function readPbxproj() {
  return fs.readFileSync(PBXPROJ, 'utf8');
}

/** Adds `CODE_SIGN_ENTITLEMENTS` to every build configuration of the App target. */
function patchEntitlementsSetting(pbx) {
  if (pbx.includes('CODE_SIGN_ENTITLEMENTS')) return pbx;
  const next = pbx.replace(
    /(\t+)INFOPLIST_FILE = App\/Info\.plist;/g,
    '$1CODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n$1INFOPLIST_FILE = App/Info.plist;'
  );
  if (next !== pbx) done.push('project.pbxproj: CODE_SIGN_ENTITLEMENTS wired');
  return next;
}

/**
 * Adds a file to the App group and to the Resources build phase, so it ends up
 * inside the .app bundle.
 */
function addResource(pbx, { fileRef, buildFile, name }) {
  if (pbx.includes(fileRef)) return pbx;

  pbx = pbx.replace(
    '/* Begin PBXBuildFile section */\n',
    `/* Begin PBXBuildFile section */\n\t\t${buildFile} /* ${name} in Resources */ = {isa = PBXBuildFile; fileRef = ${fileRef} /* ${name} */; };\n`
  );
  pbx = pbx.replace(
    '/* Begin PBXFileReference section */\n',
    `/* Begin PBXFileReference section */\n\t\t${fileRef} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = "${name}"; sourceTree = "<group>"; };\n`
  );
  // The "App" PBXGroup — matched by its own header, so the insert can't land in
  // the root or Products group.
  const appGroup = /([0-9A-F]{24} \/\* App \*\/ = \{\n\t+isa = PBXGroup;\n\t+children = \()/;
  if (!appGroup.test(pbx)) throw new Error('Could not find the App PBXGroup in project.pbxproj.');
  pbx = pbx.replace(appGroup, `$1\n\t\t\t\t${fileRef} /* ${name} */,`);
  pbx = pbx.replace(
    /(isa = PBXResourcesBuildPhase;\n\t+buildActionMask = \d+;\n\t+files = \()/,
    `$1\n\t\t\t\t${buildFile} /* ${name} in Resources */,`
  );
  done.push(`project.pbxproj: ${name} added to Resources`);
  return pbx;
}

function patchPbxproj() {
  let pbx = readPbxproj();
  const before = pbx;

  pbx = patchEntitlementsSetting(pbx);
  pbx = addResource(pbx, {
    fileRef: IDS.privacyFileRef,
    buildFile: IDS.privacyBuildFile,
    name: 'PrivacyInfo.xcprivacy',
  });
  // Only reference GoogleService-Info.plist once it exists — a missing build
  // input is a hard Xcode error.
  if (fs.existsSync(GOOGLE_PLIST)) {
    pbx = addResource(pbx, {
      fileRef: IDS.googleFileRef,
      buildFile: IDS.googleBuildFile,
      name: 'GoogleService-Info.plist',
    });
  }

  if (pbx !== before) {
    // Cheap structural sanity check before overwriting the project file.
    const balanced = (pbx.match(/\{/g) || []).length === (pbx.match(/\}/g) || []).length;
    if (!balanced) throw new Error('project.pbxproj patch produced unbalanced braces — aborting.');
    fs.writeFileSync(PBXPROJ, pbx);
  }
}

// ── 7. Shared scheme ─────────────────────────────────────────────────────────
/**
 * `cap add ios` ships no shared scheme — Xcode autocreates a private one on first
 * open, which `xcodebuild -scheme App` on a CI runner never sees. Write it out so
 * headless builds work from a freshly generated project.
 */
function writeScheme() {
  const schemeDir = path.join(IOS, 'App', 'App.xcodeproj', 'xcshareddata', 'xcschemes');
  const schemePath = path.join(schemeDir, 'App.xcscheme');
  if (fs.existsSync(schemePath)) return;

  const targetId = /([0-9A-F]{24}) \/\* App \*\/ = \{\n\t+isa = PBXNativeTarget;/.exec(readPbxproj())?.[1];
  if (!targetId) {
    warnings.push('Could not find the App target id — open the project in Xcode once to create its scheme.');
    return;
  }

  const buildableRef =
    `            <BuildableReference\n` +
    `               BuildableIdentifier = "primary"\n` +
    `               BlueprintIdentifier = "${targetId}"\n` +
    `               BuildableName = "App.app"\n` +
    `               BlueprintName = "App"\n` +
    `               ReferencedContainer = "container:App.xcodeproj">\n` +
    `            </BuildableReference>\n`;

  const scheme = `<?xml version="1.0" encoding="UTF-8"?>
<Scheme
   LastUpgradeVersion = "1500"
   version = "1.7">
   <BuildAction
      parallelizeBuildables = "YES"
      buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry
            buildForTesting = "YES"
            buildForRunning = "YES"
            buildForProfiling = "YES"
            buildForArchiving = "YES"
            buildForAnalyzing = "YES">
${buildableRef}         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      shouldUseLaunchSchemeArgsEnv = "YES">
      <Testables>
      </Testables>
   </TestAction>
   <LaunchAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      launchStyle = "0"
      useCustomWorkingDirectory = "NO"
      ignoresPersistentStateOnLaunch = "NO"
      debugDocumentVersioning = "YES"
      debugServiceExtension = "internal"
      allowLocationSimulation = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
${buildableRef}      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction
      buildConfiguration = "Release"
      shouldUseLaunchSchemeArgsEnv = "YES"
      savedToolIdentifier = ""
      useCustomWorkingDirectory = "NO"
      debugDocumentVersioning = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
${buildableRef}      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction
      buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction
      buildConfiguration = "Release"
      revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
`;
  fs.mkdirSync(schemeDir, { recursive: true });
  fs.writeFileSync(schemePath, scheme);
  done.push('App.xcscheme: shared scheme created (needed by xcodebuild -scheme App)');
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
  checkVersionParity('ios');
  if (!fs.existsSync(PBXPROJ)) {
    console.error('ios/ project not found. Run:\n  npm i && npx cap add ios && npm run ios:configure');
    process.exit(1);
  }

  fixSpmPaths();
  patchInfoPlist();
  writeEntitlements();
  writePrivacyManifest();
  syncGoogleConfig();
  patchPbxproj();
  writeScheme();
  generateAssets(IOS, (line) => done.push(line.trim()));

  console.log('\niOS project configured (ios/App).');
  if (done.length) {
    console.log('\nChanges:');
    for (const d of done) console.log(`  • ${d}`);
  } else {
    console.log('  Already up to date.');
  }
  if (notes.length) {
    console.log('\nNotes:');
    for (const n of notes) console.log(`  • ${n}`);
  }
  if (warnings.length) {
    console.log('\n⚠  Before building:');
    for (const w of warnings) console.log(`  • ${w}`);
  }
  console.log('\nRunbook: workspace/IOS_BUILD.md\n');
}

main();
