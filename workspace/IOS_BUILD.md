# iOS app — setup & build runbook

FivoCRM ships on iOS as the same Capacitor shell Android uses: the web bundle in
`dist/` runs inside a WKWebView, so **no feature has to be rewritten**. What follows
is everything that is already done, and the parts that need a Mac or an Apple
account and therefore cannot be done from this Windows machine.

Verified on Windows before writing this: `npx cap add ios` + `npm run ios:configure`
generate a complete, configured Xcode project · `npx tsc --noEmit` clean ·
`npm run lint` 0 errors · `npm test` 586/586 · `npm run build` ok.
**Not verified:** the actual Xcode compile / archive — that needs macOS.

---

## 1. What is already in the repo

| Piece | Where |
|---|---|
| `@capacitor/ios` dependency | `package.json` |
| iOS platform block (`contentInset: never`, dark background) | `capacitor.config.ts` |
| Every Xcode-side setting, applied by script | `scripts/ios-configure.cjs` |
| AppIcon + splash generated from the brand mark | `scripts/ios-brand-assets.cjs` |
| macOS CI (simulator verify + TestFlight upload) | `.github/workflows/ios.yml` |
| npm scripts | `ios:add`, `ios:configure`, `ios:sync`, `ios:open`, `ios:run` |

`ios/` is **gitignored**, exactly like `android/` — the native project is a build
artefact. Anything that would otherwise be a manual click in Xcode lives in
`scripts/ios-configure.cjs`, which is idempotent and must run after every
`npx cap sync ios` (the `ios:sync` script does both). It owns:

1. **`CapApp-SPM/Package.swift` paths.** `cap sync` on Windows writes
   `..\..\..\node_modules\@capacitor\app` — invalid Swift escapes, so Xcode cannot
   resolve a single plugin. The script rewrites them to forward slashes. This is
   the one thing that would otherwise break every build made from Windows.
2. **`Info.plist`** — camera + microphone (video calls, voice notes), photo
   library, `remote-notification` background mode, `ITSAppUsesNonExemptEncryption`
   (kills the export-compliance prompt on every upload), and the Google Sign-In
   `CFBundleURLSchemes` entry.
3. **`App.entitlements`** (`aps-environment`) + `CODE_SIGN_ENTITLEMENTS` in both
   build configurations — push notifications.
4. **`PrivacyInfo.xcprivacy`** + wiring it into the target's Resources — Apple
   rejects uploads without the required-reason API declarations.
5. **`GoogleService-Info.plist`** — bundled when present, and its
   `REVERSED_CLIENT_ID` copied into the URL scheme.
6. **`App.xcscheme`** — Capacitor ships no shared scheme, so `xcodebuild -scheme App`
   fails on a CI runner without it.
7. **AppIcon (1024²) + splash (2732²)** rasterised from the same vector "X" the
   Android launcher icon uses, so the two platforms match.

---

## 2. Before the first build (needs your accounts)

### 2.1 Apple Developer Program — €/$99 per year
Required for: a device build, TestFlight, and the App Store. A free account can
only side-load to your own device for 7 days. Bundle id: **`com.fivocrm.app`**
(same as Android's `applicationId`).

### 2.2 Register the iOS app in Firebase
Firebase console → project → *Add app* → iOS → bundle id `com.fivocrm.app` →
download **`GoogleService-Info.plist`** → put it in `ios/App/App/` and re-run
`npm run ios:configure`.

**Without this file the app crashes on launch** — the
`@capacitor-firebase/authentication` plugin calls `FirebaseApp.configure()` and
there is nothing to configure from.

### 2.3 APNs key for push
Apple Developer → *Keys* → new key with **Apple Push Notifications service (APNs)**
→ download the `.p8` → Firebase console → *Project settings → Cloud Messaging →
Apple app configuration* → upload the key + Key ID + Team ID.
Push already works end-to-end in the app (`usePushNotifications` saves the token to
`userPushTokens` with `platform: 'ios'`, and the cron jobs read it) — the only
missing link is that Firebase must be able to talk to APNs.

### 2.4 Google Sign-In
Add the iOS OAuth client (Firebase creates it with the iOS app) and make sure
`REVERSED_CLIENT_ID` exists in `GoogleService-Info.plist`. The configure script
puts it into `Info.plist` for you; without it the Google login sheet returns to a
blank screen.

---

## 3. Building

### Path A — GitHub Actions (no Mac needed)
`.github/workflows/ios.yml`, **manual trigger only** (macOS minutes bill 10x on
private repos, so it must never run on push).

- **`mode: verify`** — compiles for the simulator with `CODE_SIGNING_ALLOWED=NO`.
  Needs no Apple account. Run this first: it proves the native project and all 10
  plugins compile.
- **`mode: testflight`** — archives, signs with automatic provisioning and uploads.

Secrets it expects:

| Secret | Why |
|---|---|
| `GOOGLE_SERVICE_INFO_PLIST_BASE64` | `base64 -i GoogleService-Info.plist` |
| `APPLE_TEAM_ID` | 10-char team id |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64` | App Store Connect API key (Users and Access → Integrations) |
| `VITE_*` | same values as Vercel — the web bundle is built in CI |

The `VITE_*` set matters: a bundle built without them ships a broken Firebase
config. `VITE_API_BASE_URL` must point at the deployed origin (default
`https://fivocrm.vercel.app`) because `/api/*` calls cannot resolve inside the
WebView — see `src/lib/nativeApi.ts`.

### Path B — a Mac (own, borrowed, or rented: MacStadium / MacinCloud / Scaleway)
```bash
npm ci
npm run ios:sync          # vite build + cap sync ios + configure
npm run ios:open          # Xcode
```
In Xcode: select the *App* target → *Signing & Capabilities* → pick your team.
Signing is the only thing left to click; entitlements and capabilities are already
in the project.

### Path C — Codemagic / Bitrise / Appflow
Same three commands as Path B plus `xcodebuild archive`. Codemagic's free tier
includes macOS minutes and reads `ios/App/App.xcodeproj` directly.

### After any web change
`npm run ios:sync` — the iOS equivalent of `npm run android:sync`. Both are needed
when both platforms are live.

### Capacitor version parity
`@capacitor/core`, `@capacitor/cli` and `@capacitor/ios` must be the SAME version,
so they are pinned exactly (no `^`) in `package.json`. `ios-configure.cjs` calls
`scripts/capacitor-versions.cjs` before anything else and stops the run on a
minor/major split — see *Capacitor version parity* in
`workspace/ANDROID_BUILD.md` for why, and for the four-package upgrade command.

---

## 4. App Store review — the two real blockers

### 4.1 In-app purchases (guideline 3.1.1) — decide before submitting
The app sells subscriptions through Stripe (`/app/billing`,
`api/create-checkout-session.ts`). Apple requires digital subscriptions consumed in
the app to go through In-App Purchase, and rejects apps that link out to an
external checkout. Three options:

1. **Hide the purchase path on iOS** (cheapest, most common for B2B SaaS): on
   `Capacitor.getPlatform() === 'ios'`, render Abonimi as read-only — plan, seats,
   renewal date, no "Upgrade"/"Pay" button and no link to Stripe. Accounts are
   bought on the web; the app is a client for an existing account
   (guideline 3.1.3(b), "multiplatform services"). This is not implemented yet — it
   is a product decision.
2. **Add StoreKit IAP** for iOS purchases — 15–30% Apple commission plus a second
   billing source of truth to reconcile against `businesses.plan`. Expensive.
3. **Ship as an internal-distribution app** (Apple Business Manager / custom app),
   which skips public review entirely. Viable if FivoCRM is sold per-company.

Option 1 is the recommendation; say the word and it is a small change in
`BillingView` + the plan CTAs.

### 4.2 Sign in with Apple (guideline 4.8)
The app offers Google sign-in **and** email/password, which normally satisfies 4.8.
Reviewers do sometimes still ask for Apple sign-in when a third-party login is
prominent. Adding it later is small — the plugin already supports it
(`@capacitor-firebase/authentication` → `signInWithApple`) and Firebase Auth has an
Apple provider — but it also needs the *Sign in with Apple* capability and an Apple
Services ID.

### 4.3 Everything else the reviewer will need
- A **demo account** (staff login + a portal client login) in the review notes —
  the whole app is behind auth, and a reviewer who cannot log in rejects.
- The **App Privacy questionnaire** in App Store Connect must agree with
  `PrivacyInfo.xcprivacy`: email, name, user id, crash data — collected, linked to
  the user, not used for tracking.
- Screenshots for 6.7" and 6.5" iPhones, and iPad if `TARGETED_DEVICE_FAMILY`
  stays `1,2` (it currently does — the app would be reviewed as an iPad app too).
  Set it to `1` in `scripts/ios-configure.cjs` if iPad support is not wanted.
- Privacy policy URL + support URL.

---

## 5. iOS-specific behaviour already handled in the web layer

| Concern | Where |
|---|---|
| `/api/*` cannot resolve in the WebView | `src/lib/nativeApi.ts` rewrites to the deployed origin |
| Stripe/external links | `src/lib/native.ts` → in-app browser, `appReturnUrl()` |
| Downloads (PDF/CSV) do not work in a WebView | `saveOrShareFile()` → Filesystem + share sheet |
| Routing | `HashRouter` on native (`src/App.tsx`) |
| Notch / home indicator | `env(safe-area-inset-*)` + `contentInset: 'never'` |
| Keyboard accessory bar (iOS-only API) | guarded in `src/index.tsx` |
| Status bar background (Android-only API) | guarded in `src/index.tsx` |
| Voice notes record as `audio/mp4` on iOS, not webm | extension derived from the blob in `ChatView` |
| Video calls need camera + mic strings | `Info.plist`, via the configure script |

---

## 6. Known gaps

- **The Xcode build itself is unverified.** Everything above was produced and
  checked on Windows; the first `mode: verify` CI run is what confirms the native
  side compiles. Expect the usual first-run friction (SPM resolving
  `firebase-ios-sdk` takes several minutes).
- **Push on iOS is untestable in the simulator** — it needs a real device plus the
  APNs key from §2.3.
- **`aps-environment` is `development`** in `App.entitlements`; Xcode substitutes
  `production` when archiving with a distribution profile. If TestFlight pushes
  ever arrive on a debug build but not a release build, this is the first thing to
  check.
- **No iPad-specific layout.** The app is responsive, but `TARGETED_DEVICE_FAMILY`
  includes iPad, so review will look at it on an iPad screen.
