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
