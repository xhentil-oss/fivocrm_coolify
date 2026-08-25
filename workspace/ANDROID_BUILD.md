# Android build & release runbook

`android/` is **gitignored** — it is a build artefact, exactly like `ios/`. Anyone
(or CI) recreates it with `npx cap add android`. That only works if nothing lives
*only* inside it, which is what `scripts/android-configure.cjs` guarantees.

```bash
npm run android:add        # cap add android + configure (first time / after a wipe)
npm run android:configure  # re-apply every android/ customisation (idempotent)
npm run android:sync       # vite build + cap sync android + configure
npm run android:aab        # the above + gradlew bundleRelease (signed AAB)
```

`android:sync` and `android:aab` run the configure step for you, so a plain
`cap sync` never silently drops a setting.

---

## What the configure script owns

Run it after every `cap sync`; it is idempotent and prints what it changed.

| File | What it applies |
|---|---|
| `app/build.gradle` | release signing from `keystore.properties`, R8 + `shrinkResources`, `proguard-android-optimize`, NDK `debugSymbolLevel FULL`, **versionCode / versionName** |
| `app/proguard-rules.pro` | keep rules for Capacitor/Firebase reflection; `-dontwarn com.facebook.**` (the Firebase Auth plugin references Facebook classes we don't bundle — without this `minifyReleaseWithR8` fails) |
| `AndroidManifest.xml` | `allowBackup=false`, FCM default notification icon + colour, `POST_NOTIFICATIONS`, `RECORD_AUDIO` |
| `res/drawable/ic_stat_notify.xml` | monochrome status-bar "X" (Android renders it as an alpha mask) |
| `res/values/colors.xml` | `notification_color` = FivoCRM cyan |
| `variables.gradle` | `rgcfaIncludeGoogle = true` — native Google sign-in deps |

`namespace`, `applicationId`, `strings.xml` and `MainActivity.java` are **not** in
the script: `cap add` derives them from `appId`/`appName` in `capacitor.config.ts`,
which is versioned.

### The version number is in the script, not in build.gradle

`VERSION_CODE` / `VERSION_NAME` at the top of `scripts/android-configure.cjs` are
the source of truth, and the script writes them into `build.gradle` on every run.

**Bump `VERSION_CODE` by 1 for every Play upload.** It used to live only in the
gitignored `build.gradle`, so regenerating `android/` silently reset it to 1 and
Play rejected the upload as a duplicate — with no record anywhere of which number
had already been used.

---

## The three files the script cannot recreate

These carry secrets or come from a console, so they are neither in git nor in the
script. It checks for them and prints how to restore each:

| File | Where it comes from |
|---|---|
| `app/google-services.json` | Firebase Console → Project settings → Android app `com.fivocrm.app` |
| `app/fivocrm-release.jks` | **your off-machine backup.** Lose it and the app can never be updated on Play again |
| `keystore.properties` | hand-written: `storeFile=fivocrm-release.jks`, `storePassword=…`, `keyAlias=fivocrm`, `keyPassword=…` |

Keep all three in one folder outside the repo and point `ANDROID_SECRETS_DIR` at
it — the script then copies them in automatically:

```bash
ANDROID_SECRETS_DIR=/c/Users/User/Secure/fivocrm-android npm run android:configure
```

---

## Building

The machine's default `java` is 17; Gradle needs **21** (Android Studio's bundled
JBR). The Build menu inside Android Studio sets it automatically; from a terminal:

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export PATH="$JAVA_HOME/bin:$PATH"
npm run android:aab
```

If Gradle still says *"Cannot find a Java installation … matching
{languageVersion=21}"*, spell the toolchain out:

```bash
cd android && ./gradlew.bat bundleRelease \
  -Dorg.gradle.java.installations.paths="C:\Program Files\Android\Android Studio\jbr"
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`.

---

## Google Sign-In after the first Play upload

Play uses *App Signing by Google Play* and re-signs with **its own** key, so the
SHA fingerprints Firebase knows about no longer match the shipped app.

**Symptom:** the Play build throws "No credentials available"
(`NoCredentialException`) on Google login while the local build works fine.

**Fix:** Play Console → App integrity → copy the **App signing key** SHA-1 and
SHA-256 into Firebase Console → Android app → Add fingerprint. Takes effect
immediately, no rebuild needed (force-stop the app to drop the cached response).
Add the upload-key fingerprints too:

- SHA-1 `AD:D1:A0:96:C8:E6:50:5C:70:B7:64:56:8F:DA:DE:26:5B:DB:66:C3`
- SHA-256 `C1:54:22:05:5C:5F:C2:66:7D:CE:8C:36:31:7C:2C:BC:23:4A:B2:9C:52:50:D1:7B:0A:D6:AB:D3:D7:79:78:EC`

---

## Keyboard / viewport — do not re-enable `resizeOnFullScreen`

`capacitor.config.ts` sets `Keyboard.resizeOnFullScreen: false` deliberately.
While it was `true`, showing the keyboard pinned a **fixed pixel height** on the
activity's content view (`Keyboard.java` → `possiblyResizeChildOfContent`), and
the only code that restores it is the window-insets *animation* callback — the
insets *listener* never resets it. When the keyboard went away without that
animation firing (app backgrounded mid-typing, Google sign-in, Samsung's dismiss
gesture), the WebView stayed a keyboard-height short **permanently**: the app
rendered correctly inside a viewport that ended mid-screen, with the bottom nav
floating above a blank strip. Users saw it right after login, which is the one
screen that always opens the keyboard.

That option is for *immersive fullscreen* apps. We are edge-to-edge, which is a
different thing, and Capacitor 8's own `SystemBars` already handles the IME inset.

`resize` is iOS-only — Android's `KeyboardPlugin.java` never reads it.
