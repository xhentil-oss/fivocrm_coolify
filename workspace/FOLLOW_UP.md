# Follow-up ("Ndjekja") — leads + klientë, WhatsApp inbound, auto-reply, email dalës

Shtator 2026. Plani i miratuar: `~/.claude/plans/dua-te-permiresoj-pjesen-idempotent-sunbeam.md`.

## Modeli

**Një hap tjetër për kontakt, i ruajtur në dokument.** `FollowUpFields` (types/index.ts) është
i përbashkët për `Lead` DHE `Customer`:

| Fusha | Kuptimi |
|---|---|
| `nextFollowUpDate` | dita e hapit tjetër (krahasohet në Europe/Tirane, ruhet mesditë) |
| `nextFollowUpType` | `call \| whatsapp \| email \| meeting \| other` — butoni primar + tipi i aktivitetit |
| `followUpNote` | një rresht |
| `lastFollowUpDate` | ndjekja e fundit e kryer |
| `lastActivityAt` | çdo aktivitet (temperatura / staleness). **Nuk ka `lastContactAt`** — sinonim = drift |
| `lastReminderSentAt` | debounce i cron-it (23h) |
| `lastInboundAt`, `awaitingReply` | klienti na shkroi dhe pret ("Presin përgjigje") — shkruhen nga `api/_waInbound.ts` |
| `waOptOut` | STOP/NDALO/HIQ |

Historia është timeline-i (`leadActivities` / `activities`), jo këto fusha.

## Logjika (pure, e testuar)

`src/lib/crm/followUp.ts` — `dueState`, presete (`NEXT_STEP_PRESETS`, `SNOOZE_PRESETS` —
relative ndaj SOTIT), `touchContactPatch`, `completeFollowUpPatch`, `scheduleNextStepPatch`
(null eksplicit), `statusAfterTouch` (New → Contacted), `needsNextStep`, `buildFollowUpQueue`,
`daysSinceContact`. Matematika e ditës përdor `toZoned/fromZoned` nga `recurringUtils.ts` —
**kurrë `setHours(0,0,0,0)`**.

## Rruga e vetme e shkrimit

`src/hooks/useFollowUpActions.ts` — `complete / snooze / schedule / touch / logContact`.
Çdo sipërfaqe (FollowUpsView, widget-i i Dashboard-it, CRMView, CustomersView, Customer360)
kalon këtu. Undo në toast. Rreshti i timeline-it shkruhet nga KLIENTI për WA/thirrje;
nga SERVERI vetëm për `contact-email` (dërgimi ndodh në server) — kurrë të dy.

## Sipërfaqet

- `/app/follow-ups` (`FollowUpsView`, extraPath i modulit `crm`): Presin përgjigje · Vonuar ·
  Sot · Këtë javë · Pa hap tjetër. Të miat / Të gjitha; Leads / Klientë. `?focus=lead:<id>`.
- Komponentët: `src/components/crm/` — `FollowUpBadge` (i vetmi pill), `NextStepPopover`
  (schedule|complete; **për lead të hapur hapi tjetër është i detyrueshëm**, dalja = Mbyll
  lead-in), `SnoozeMenu`, `ContactQuickActions` (Thirr/WA/Email + "A e kontaktove?"),
  `EmailComposerDialog` (POST `/api/contact-email`), `FollowUpRow`.
- Dashboard: `TodayFollowUpsWidget` (hook `useFollowUpDue` — listener i kufizuar, kërkon
  indekset `(businessId, nextFollowUpDate)` + `(businessId, awaitingReply)`; gabim → fshihet).
  Sidebar badge = presin përgjigje + vonuar + sot (të miat).
- Klientët: `CustomersView` filtër "Ndjekja" + sort; `Customer360` header me strip ndjekjeje +
  `ClientHealthBadge` (`src/lib/reporting/clientHealthSignals.ts`, i përbashkët me ClientHealthView).

## Serveri

- `api/_waInbound.ts` — NJË handler për Meta + Baileys (VPS poston `POST /api/wa-inbound` me
  Bearer CRON_SECRET). Identitet (lead ‖ klient via `_contactIdentity`), lead i ri (gate
  `waAutoCreateLead`, cap ditor), `conversations/wa-{teamId}-{phone}` (owner, SLA vetëm në
  tranzicion), stampa `awaitingReply`, `notifyUser('whatsapp_message')` me debounce 2 min,
  auto-reply (`_waAutoReply.ts`, pasqyrë `src/lib/messaging/autoReply.ts`), draft AI
  (`_aiReply.ts`, `waAiAssist: 'off'|'draft'` — **kurrë auto-send**).
- `markConversationAnswered` — i vetmi touch "stafi u përgjigj" (whatsapp.ts, meta-send*.ts,
  fromMe nga telefoni). Jo në kampanja.
- Cron: `conversation-sla` (15 min, VPS), `lead-follow-up-reminders` (08:30 lokale, leads +
  klientë, jo në run-all).
- Email 1:1: `?type=contact-email` — From = "Stafi · Kompania", Reply-To = stafi; inbound
  email jashtë fushës.
- Cilësimet: `FollowUpSettingsPanel` (Cilësimet → Automatizime) — cadence, SLA, stale, auto-reply
  v2, AI, rikujtues, lead i ri nga WA. Pragjet: `src/lib/crm/followUpConfig.ts` + `api/_followUpConfig.ts`.

## Deploy

1. `firebase deploy --only firestore:indexes`
2. teste rregullash (emulator, JDK 21) → `firebase deploy --only firestore:rules`
3. Vercel (push) **para** VPS-it
4. VPS: `git pull && npm run build && pm2 restart`

## Qëllimisht jo

Inbound email; bashkimi i 4 store-ve WA; mode WA në ChatView; AI auto-send.
