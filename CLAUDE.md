# FivoCRM — Project Reference for Claude

## Project Identity

- **Name:** FivoCRM (package name: `anima-project`)
- **Type:** Full-stack Business Management SaaS Platform
- **Language:** Albanian (sq-AL) UI
- **GitHub:** `xhentil-oss/fivocrm` — branch `main`
- **Deployment:** Vercel (production), GitHub Actions for CI
- **Mobile:** Capacitor (Android)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS + shadcn/ui (Radix UI) |
| Backend/DB | Firebase (Firestore, Auth, Storage) |
| Serverless API | Vercel Functions (`/api/` folder) |
| Mobile | Capacitor v8 (Android) |
| Email | Nodemailer via VPS server (`/vps/`) |
| Payments | Stripe |
| AI | OpenAI (chat assistant) |
| Messaging | Meta WhatsApp API + Baileys (self-hosted) |
| Testing | Vitest |

---

## Repository Structure

```
/api/              — Vercel serverless functions (Node.js/TypeScript)
/src/
  App.tsx          — Main router, lazy-loaded views
  components/      — Shared UI components
  components/ui/   — shadcn/ui primitives (button, card, dialog, etc.)
  contexts/        — React contexts (Auth, Permissions, GoogleApi)
  hooks/           — Custom hooks (useFirestore, useClientPortal, etc.)
  lib/             — Firebase config, utils, calculator logic
  types/index.ts   — ALL shared TypeScript interfaces
  views/           — Page-level components
  views/portal/    — Client portal views
  views/landing/   — Public landing pages
/vps/              — Self-hosted VPS server for WhatsApp/email
/android/          — Capacitor Android project
/workspace/        — Project memory files (SOUL, PATTERNS, DECISIONS, TODO)
```

---

## Firebase Collections

| Collection | Purpose |
|---|---|
| `customers` | CRM customers |
| `leads` | Sales leads/pipeline |
| `quotes` | Preventiva / price quotes |
| `invoices` | Invoices & billing |
| `projects` | Project management |
| `tasks` | Task management |
| `activities` | CRM activity log |
| `clientRequests` | Client portal requests |
| `clientPortalAccess` | Portal login records |
| `channels` / `messages` | Team chat |
| `teamMembers` | Team roles & permissions |
| `goals` | OKR goals |
| `expenses` | Business expenses |
| `timeEntries` | Time tracking |
| `services` | Service catalog |
| `serviceInquiries` | Landing page form submissions |
| `standups` | Morning standup entries |
| `dailyReports` | Daily staff reports |
| `quotes` | Price calculator quotes (team-scoped) |

---

## Key Architectural Rules

### Data Scoping
- All collections are **team-scoped** via `teamId` field.
- `useCollection()` hook from `useFirestore.ts` automatically applies `teamId` filter.
- Use `skipTeamFilter: true` only for portal views and cross-team lookups.
- `setGlobalTeamId()` / `getGlobalTeamId()` manage the active team context.

### Import Paths
- Use **relative paths** for all local imports (e.g., `'../components/ui/card'`).
- Do NOT use `.tsx` extension in imports — Vite resolves them automatically.
- shadcn/ui components live in `src/components/ui/`.
- Use `@/lib/utils` alias for the utils file inside `components/ui/` files.

### Build / Deployment
- Build command: `npm run build` → `vite build`
- Vercel runs on Linux (case-sensitive filesystem) — import paths must match exact case.
- `dialog.tsx` lives at `src/components/ui/dialog/index.tsx` (moved for Linux compatibility).
- All views are **lazy-loaded** via `lazyRetry()` wrapper for chunk resilience.

### Roles & Permissions
- Roles: `Admin`, `Manager`, `Sales`, `SalesAgent`, `Member`, `Viewer`
- Permission checks via `usePermissions()` hook and `<PermissionGate>` component.
- Client portal users are separate — they use `clientPortalAccess` collection.

---

## Client Portal

- Portal routes: `/portal/*`
- Client authentication via Firebase Auth (separate from staff).
- Hook: `useClientPortal()` — resolves `customerId` for the logged-in client.
- Auto-creates `Customer` + `ClientPortalAccess` + `Lead` on first login.
- Portal views: Dashboard, Invoices, Projects, Requests, Chat, Quotes (Preventiva), Services.

### Quote/Preventiva Flow
1. Admin creates quote in **Price Calculator** → saved as `status: 'Draft'`.
2. Admin opens **Customer360View** → Preventiva tab → clicks **"Dërgo"** button → status becomes `'Sent'`.
3. Client logs into portal → sees quote in **Preventiva** tab with full package breakdown.
4. Client clicks **"Prano Ofertën"** (Accept) or **"Mos Prano"** (Reject) → status updates in Firestore.
5. `'Draft'` quotes are never shown to clients.

---

## Landing Pages

Located in `src/views/landing/`. Each is a standalone public marketing page.

| File | URL | Niche |
|---|---|---|
| `RealEstateLandingPage.tsx` | `/real-estate` | Real Estate |
| `EstetikeLandingPage.tsx` | `/estetike` | Aesthetics/Beauty |
| `ResortLandingPage.tsx` | `/resort` | Hotels/Resorts |
| `RecruitLandingPage.tsx` | `/recruit` | HR/Recruitment |
| `SeoLandingPage.tsx` | `/seo` | SEO Services |
| `InteriorDesignLandingPage.tsx` | `/interior-design` | Interior Design |

All landing pages have: Hero, Pain Points, Results/Stats, Packages, Process, Add-ons, Testimonials, FAQ, Contact Form.

### Interior Design Package Structure
Each package includes:
- Social Media Management (content, reels, posting)
- SEO management with description
- Google Ads / Meta Ads management with description
- Pricing in EUR + ad spend separate

---

## API Endpoints (`/api/`)

| File | Route | Purpose |
|---|---|---|
| `landing.ts` | `POST /api/landing` | Landing page form submissions → creates Lead in Firestore |
| `send-invoice-email.ts` | `POST /api/send-invoice-email` | Sends invoice PDF via email |
| `send-invite.ts` | `POST /api/send-invite` | Team invite emails |
| `send-welcome-email.ts` | `POST /api/send-welcome-email` | Welcome emails for new users |
| `create-checkout-session.ts` | `POST /api/create-checkout-session` | Stripe checkout |
| `stripe-webhook.ts` | `POST /api/stripe-webhook` | Stripe payment events |
| `ai-chat.ts` | `POST /api/ai-chat` | OpenAI chat assistant |
| `meta-webhook.ts` | `POST /api/meta-webhook` | Meta WhatsApp webhook |
| `send-whatsapp.ts` | `POST /api/send-whatsapp` | Send WhatsApp messages |
| `migrate-emails.ts` | `POST /api/migrate-emails` | Data migration utility |
| `cron/run.ts` | Cron | Scheduled jobs (recurring invoices, etc.) |

---

## Common Commands

```bash
# Development
npm run dev

# Build (same as Vercel)
npm run build

# Tests
npm run test

# Android
npm run android:sync   # build + cap sync
npm run android:open   # open in Android Studio
npm run android:run    # run on device/emulator

# Lint
npm run lint
npm run lint:fix

# Push to GitHub (triggers Vercel deploy)
git add . && git commit -m "message" && git push
```

---

## Known Issues / History

- `AdminTestPopup.tsx` — removed (was a temporary test component).
- `dialog/index.tsx` — moved from `dialog.tsx` to fix Vercel Linux module resolution.
- All views use `lazyRetry()` to handle stale chunk errors on deployments.
- WhatsApp integration uses both Meta Cloud API and self-hosted Baileys (VPS).
- `toAll()` utility normalizes ALL/EUR amounts for cross-currency totals.

---

## Environment Variables (required)

```
VITE_FIREBASE_*               — Firebase config (client)
# Firebase Admin SDK (server) — set EITHER the three vars OR the JSON one:
FIREBASE_PROJECT_ID           — Service account project_id
FIREBASE_CLIENT_EMAIL         — Service account client_email
FIREBASE_PRIVATE_KEY          — Service account private_key (use \n for newlines)
FIREBASE_SERVICE_ACCOUNT_JSON — Full service account JSON (alternative)
STRIPE_SECRET_KEY             — Stripe
STRIPE_WEBHOOK_SECRET    — Stripe webhooks
OPENAI_API_KEY           — AI chat
META_VERIFY_TOKEN        — Meta webhook verification
META_ACCESS_TOKEN        — Meta WhatsApp API
```

---

## Project Memory Files

- `workspace/SOUL.md` — Agent personality & principles
- `workspace/PATTERNS.md` — Code patterns & conventions
- `workspace/DECISIONS.md` — Architectural decisions log
- `workspace/TODO.md` — Pending tasks
- `workspace/CHANGELOG.md` — History of changes
- `workspace/DEBUGGING.md` — Debugging notes

---

## Chat Feature — Deep Audit (May 2026)

### Issues identified in `src/views/ChatView.tsx` (~2353 lines)

**Architecture / data flow**
- 5 always-on background Firestore listeners (`bgDmQuery`, `bgSentDMsQuery`, `bgReceivedDMs` (duplicate), `allUnreadClientQuery`, `allUnreadChannelQuery`) regardless of `chatMode` → ~60% wasted reads.
- Missing composite indexes for DMs (`senderId,createdAt`, `receiverId,createdAt`) and WhatsApp (`teamId,phone,createdAt`); sorting done client-side.
- Pagination naive: `channelLimit: 100` hardcoded, +50 increments re-fetch all old messages (no cursor / `startAfter`).
- Typing-indicator docs may leak in Firestore if user switches channels fast.

**Performance**
- No virtualization — 100+ DOM bubbles rendered at once.
- `getUserDisplayName()` called per message, not memoized (300 map lookups / render).
- `filteredMessages.sort()` runs every render.
- 85+ `useState` hooks in a single file; cascading re-renders.

**UX gaps vs Slack/Linear**
- No threading panel, no `@mentions`, no pinned messages, no reaction-user popover, no link previews, no markdown, no scheduled send, no voice notes, no global search filters.

**UI / a11y**
- iOS zoom on textarea (`text-[16px] sm:text-sm` should be `text-base`).
- Missing ARIA labels on emoji/reaction buttons.
- No focus trap inside emoji picker.
- Typing dots `text-muted-foreground/40` too low contrast in dark mode.
- Albanian names truncate mid-word.

**Security**
- XSS risk: `replyToContent` rendered unsanitized.
- `attachmentUrl` accepts `javascript:` URIs (no domain whitelist).
- `image/svg+xml` upload allows embedded scripts.
- Firestore rules `allow read: if isAuth()` lets any signed-in user read all DMs.

### Implementation status (May 2026)

✅ = done, 🟡 = partial, ⬜ = pending

| # | Item | Status |
|---|---|---|
| 1 | Background queries gated by `chatMode` | ✅ |
| 2 | Removed duplicate `bgReceivedDMs` | ✅ |
| 3 | Sanitize `replyToContent` (HTML escape) | ✅ |
| 4 | Remove `image/svg+xml` from allowed types | ✅ |
| 5 | Memoize `getUserDisplayName` via Map cache | ✅ |
| 6 | Validate attachment URL (https/Firebase only) | ✅ |
| 7 | `@mentions` autocomplete + highlight | ✅ |
| 8 | Pinned messages bar + toggle | ✅ |
| 9 | Reaction-user popover | ✅ |
| 10 | iOS zoom fix on composer | ✅ |
| 11 | Basic markdown (`**bold**`, `*italic*`, `` `code` ``) | ✅ |
| 12 | Online dot near avatar (last-seen <2 min) | ✅ |
| 13 | Cursor pagination with `startAfter()` | 🟡 (limit+100 with “load older” button — Firestore-side cursor TBD) |
| 14 | Firestore indexes for DM/WA | ✅ (added to `firestore.indexes.json`, incl. `messages: receiverId,createdAt`) |
| 15 | Tightened Firestore rules for messages | ⬜ (skipped — would break unread sweep query; needs query refactor first) |
| 16 | Search filters (date / sender) | ✅ |
| 17 | Voice notes via `MediaRecorder` + Firebase Storage | ✅ |
| 18 | Split `ChatView` into modules | ⬜ (deferred — risky for stability) |
| 19 | `react-virtual` for message list | ⬜ (deferred — needs perf-test) |
| 20 | Link previews (OG card) | ⬜ (needs serverless endpoint) |
| 21 | Scheduled messages | ⬜ (needs cron) |

### Storage Rules
- `storage.rules` added — auth required for write, public read, max 15 MB, image/PDF/office/text.
- Deploy with: `firebase deploy --only storage`.
