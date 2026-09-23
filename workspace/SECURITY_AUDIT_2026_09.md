# Security audit — full platform (23 Sep 2026)

Five parallel read-only audits (Firestore/Storage rules, `api/` handlers, cron + VPS,
browser app + portal, secrets/repo/supply chain) followed by five fix streams over
disjoint file sets. This file is the durable record: what was found, what shipped, what
the operator still has to do by hand, and what was deliberately left.

Verification at the end of the pass: `typecheck:api` 0 errors, app 193 (pre-existing,
unchanged), VPS `tsc` 0, vitest 1590/1590, Firestore rules emulator 169/169 (+31),
Storage rules 4/4 (new), `vite build` green, `npm audit --omit=dev` 30 → 12 (all
remaining are moderate and need a major bump of `react-router-dom` or `firebase-admin`).

---

## 1. Operator actions that code cannot do (DO THESE FIRST)

| # | Action | Why |
|---|---|---|
| 1 | **Revoke the GitHub PAT** that was in `vps/test-send.sh` (`ghp_…`, github.com/settings/tokens). | It was committed in Apr 2026 and doubled as the VPS shared secret. Repo is private, but the value is in history. |
| 2 | **Rotate the VPS secret**: new `API_SECRET` on the VPS (`openssl rand -hex 32`), same value as `WHATSAPP_VPS_SECRET` / `WHMCS_PROXY_SECRET` / `HOSTING_PROXY_SECRET` on Vercel, and in `teamSecrets.whatsappVpsSecret` for tenants that store one; `pm2 restart`. | Same leak. |
| 3 | **Purge history** (optional, repo is private): `git filter-repo --path vps/test-send.sh --path .claude/settings.local.json --invert-paths`, force-push, enable GitHub secret scanning + push protection. | `.claude/settings.local.json` carried the Play keystore password in a `keytool` allow-list line. Consider a Play "upload key reset" if the keystore may have left the machine. |
| 4 | Move `scripts/sa.json` and `.env.vercel.local` OUT of the repo folder; rotate the Firebase service-account key afterwards. | Owner-level key sitting next to 64 scripts that `readFileSync` it. They are gitignored, not protected. |
| 5 | VPS env after deploy: `NODE_ENV=production`, `WHMCS_API_URL=https://…` (now REQUIRED by `/whmcs-proxy`), `CRM_BASE_URL` must be https, optional `CORS_ORIGINS`, leave `WA_LOG_BODIES` unset. | New boot checks exit the process otherwise. |
| 6 | Vercel env: `MARKETING_WEBHOOK_SECRET` (the ESP webhook now returns 503 without it), `SUPER_ADMIN_EMAILS` (the `VITE_` fallback is gone server-side), `APP_BASE_URL`. | Fail-closed by design. |
| 7 | Unset `NODE_TLS_REJECT_UNAUTHORIZED=0` in the developer shell. | It disables TLS verification for every Node process on this machine, including `firebase deploy`. |
| 8 | Consider Firebase App Check (reCAPTCHA Enterprise web + Play Integrity), monitoring mode first. | Self-signup and portal registration are otherwise script-callable with only rules as defence. |

## 2. What was found and fixed

### Firestore rules (`firestore.rules`, 169 emulator tests) and Storage
- **Tenant takeover chains closed**: `teamMembers` update pins `businessId`/`teamId`/`userId`;
  `canCreateMembership` requires the team's business on both branches; `teams` create is
  Admin/owner-only and `createdByUserId` is pinned; `businesses` create pins
  `plan: trial`, `status: trialing`, empty `lockedModules`, no `seats/limits`, and refuses
  an id that is an existing team (legacy-tenant claim); owner update cannot touch
  seats/limits/trialEndsAt/stripe fields.
- **Portal identity**: `clientPortalAccess` self-create requires a VERIFIED email that
  matches both the row and the referenced customer; `isSelfCreate()` is portal-only and
  tenant-bound; first-login bootstrap (`isPortalBootstrapContact`) requires the verified
  email. `usersCustomerFieldOk`, `teamMembers` read-by-email/self-heal, `teamInvites`
  accept-by-email all require `email_verified`.
- **Chat**: `messages` create pins `senderId`, requires the sender's business, DM target
  in the same tenant, `client-*` channels provable; update limited to content keys.
  `taskComments` create pinned; `chatScheduledMessages` update pins target/sender.
- **Portal writes narrowed**: contracts only `Sent|Pending → Signed|Rejected` with the
  signature keys; projects/customers no portal update/delete.
- **Cross-tenant injection**: the `|| isTeamMember(request.resource.data.teamId)` create
  branches are gone (marketing, workspace, snippets, typing, LID mappings).
- `keepsBusinessId()` on ~30 more update rules; role gates (`whatsappAccounts`,
  `hostingServers`, `productivitySettings` → admin; `dailyReports` author/admin; Viewer
  blocked per collection); `teamSettings` no longer portal-readable and its deny-list is
  test-pinned to `SECRET_FIELDS`; inactive members fail `isBusinessMember`/`isTeamMember`.
- **Storage**: bucket is unused by the client (uploads go to the VPS) → `read, write: if false`
  with the tenant-scoped template left as a comment. `npm run test:rules:storage`.
  Deploy note: Firebase Storage is NOT set up on project `fivocrm` (no bucket exists), so
  `firebase deploy --only storage` fails with "has not been set up" — nothing to protect
  today; the deny-all file is what lands the day someone clicks "Get Started".

### API handlers (`api/`)
- New `api/_callerIdentity.ts`: verified-email identity, portal-only token detection,
  active-membership lookups, platform URL allow-list, timing-safe compare.
- `whatsapp.ts` rewritten: staff only, agent loaded from `whatsappAccounts` and compared
  with the caller's tenant, status filtered server-side, QR/reload Admin/Manager.
- `_tenantClaims.ts`: `bid` from the TEAM document; a self-created team grants Admin only
  to the business owner / an existing Admin; email identity only when `email_verified`;
  self-created `clientPortalAccess` rows must corroborate the customer's email.
- `_accept-invite.ts`: closed role list, verified email, seat check + write in one
  transaction, rate limits. `_send-invite.ts` / `_send-welcome-email.ts` no longer open
  relays; `_reports` send-email capped and role-gated; redirect allow-lists lose
  `localhost`/`vercel.app` in production.
- `_hosting.ts`: every mutating staff action needs Admin/Manager. `_social-api.ts` scope
  is AND-gated like GMB. Notification `actionUrl` must be a relative app/portal path.
  Inactive memberships rejected everywhere. `meta-send-media` allow-list is platform-only.
  Persistent rate limits replace per-instance maps; `ai-chat` never spends the platform
  key for an unproven tenant; `landing.ts` lost its unscoped services fallback.
- Timing-safe secret compares (`_waInbound`, `meta-webhook`, `_marketing-webhook`,
  cron `authorize()`), CSPRNG platform invite tokens, generic error bodies.

### Cron (`api/cron/run.ts`)
- Every job is in exactly one of `PLATFORM_ONLY_JOBS` / `SCOPED_JOBS` / `BOOTSTRAP_JOBS`;
  a manual non-super-admin run of anything else is refused, and a scoped run passes
  `{ businessId }` into the runner (query filter or in-memory filter BEFORE any send).
- `authorizeManual` verifies Admin/Owner **for the resolved `bid`**; `daily-report-check`
  validates `date`, forces the caller's tenant and refuses `escalate`; suspended tenants are
  skipped by every sender; campaigns whose `teamId` is not in their `businessId` fail with
  `team-business-mismatch`; `set-superadmin-claim` needs a verified email.
- UI: the WHMCS "Sinkronizo" card in Cilësimet is super-admin only (the job is platform-wide).

### VPS (`vps/server.ts`)
- `/send` resolves the agent by `agentId`/`teamId` inside ONE tenant and stamps the
  account's `teamId`; `/upload` has an extension allow-list, magic-byte sniffing, a per-uid
  quota and a tenant check on `teamId`; `/files` served with `nosniff`, a sandbox CSP and
  `Content-Disposition: attachment` for non-media; `/whmcs-proxy` ignores the body URL;
  `/provider-proxy` refuses redirects and every private/loopback/mapped range; CORS list;
  timing-safe API key; masked phone/body logs; escaped QR page; https-only `CRM_BASE_URL`.
- `api/_hostingProviders.ts` direct mode: DNS check + port allow-list + no redirects.

### Browser app (`src/`)
- `sanitizeHtml()` is DOMPurify with a URL-parsing hook (the homegrown one was bypassable;
  tests in `utils.test.ts`); `safeHref`/`safeExternalUrl`/`safeRedirectPath` helpers used
  at every attachment/link/redirect sink.
- Upload host is the platform VPS unless the tenant value is `*.fivocrm.com`; the portal
  no longer reads `teamSettings`; meta CSP in `index.html` for the native WebView.
- Email verification: the by-email membership match and the portal bootstrap run only for
  verified accounts; `VerifyEmailScreen` (staff shell and portal); `/register` writes
  nothing until verification and parks the form in `portalRegistrationDraft`.
- Logout resets tenant globals, the static collection cache, platform override and
  tenant-specific localStorage keys (`sessionReset.ts`).

### Repo / CI / dependencies
- `vps/test-send.sh` deleted; `.claude/settings.local.json` + worktree gitlinks untracked;
  `.gitignore` covers signing material, pulled env, Baileys sessions, uploads.
- CI type-checks `api/` for real (the root tsconfig is a solution file), reports the app
  count, runs `npm audit`; `permissions: contents: read`; iOS build number via `env:`.
- `vercel.json`: HSTS, `Permissions-Policy`, `frame-ancestors 'none'`, `form-action`.
- `nodemailer` 6 → 10 (12 advisories), `@tiptap/*` 3.31.3 (prototype pollution),
  `dompurify` 3.4.15, `react-router-dom` 6.30.6, transitive fixes via `npm audit fix`.
- `scripts/backfill-recurring-products.mjs` is dry-run by default like every other script.

## 3. Deliberately left (and why)

- `'unsafe-eval'` / `'unsafe-inline'` stay in the CSP — not verified which dependency
  needs them; removing blind would break the app silently.
- `react-router-dom` 7 / `firebase-admin` 14 majors (remaining moderate advisories):
  separate, tested upgrades.
- `customerId` on invoices/projects/contracts is still staff-writable (Sales re-assign the
  customer in the UI).
- `chatScheduledMessages` is not in `teamScopedCollections` (adding it changes the LIST
  query shape); the rule validates `businessId` only when present.
- DNS-rebinding TOCTOU in the two VPS relays needs a pinned-address dispatcher.
- Salary fields still on `teamMembers` until `clear-legacy-member-pay` runs.
- `useStartInquiry` reads `teamMembers` from the portal (denied, always was) — take the
  team from `useClientPortal()`.
- `_hosting.ts` `order.create` stays open to any staff (sales flow).
- Upload allow-list may need more phone formats; `mov/3gp/heic/heif/aac/opus/amr` added.

## 4. Deploy order used

1. `npm run test:rules` + `npm run test:rules:storage` (JDK 21).
2. Commit + push (Vercel builds the app and the API together).
3. `firebase deploy --only firestore:rules` AFTER the app build is live (add `,storage` once a bucket exists) (the rules
   refuse unverified portal writes and the old bundle still attempted them).
4. VPS: pull, set env (§1.5), `pm2 restart`.
5. `npm run android:sync`.
