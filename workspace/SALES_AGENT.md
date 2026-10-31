# Agjentja virtuale e shitjeve ("Ana") — runbook

Plani i plotë dhe ligjet: `workspace/SALES_AGENT_PLAN.md`. Ndërtuar 31 Tet 2026
(Faza 0 + Faza 1 + Faza 3 + pjesë të Fazës 4). Ky dokument = si funksionon ajo
që EKZISTON, si vihet në punë dhe çfarë mbetet.

## 1. Çfarë bën sot

| Aftësia | Ku |
|---|---|
| Përgjigjet në WhatsApp inbound (Baileys + Meta) me nivele autonomie 0–2 | `api/_waInbound.ts` hapi 8 → `runSalesAgentOnInbound` (`api/_salesAgent.ts`) |
| Kualifikon (shërbim, qytet, afat, buxhet, vendimmarrës), shënon lead-in, njofton kur kualifikohet | i njëjti hook; `leads.agent*`, `conversations.agent` |
| Handoff te njeriu (trigger deterministik + vendim modeli), SLA eskalim | hook + `sales-agent-nudges` |
| Nudge-e të matura për prospektin që hesht | `sales-agent-nudges` (orë) |
| Gjen prospekte në Google Maps, fit-score, dedupe me CRM, regjistron si lead | `search.create` → `sales-agent-prospecting` (15 min) → `prospect.register` |
| Mesazh i parë WhatsApp i FTOHTË, i matur (≤10/ditë, ≥1 orë, warm-up, auto-pauzë) | `sales-agent-cold-wa` (15 min), `coldWaBlockReason()` |
| Digest i mëngjesit për menaxherët | `sales-agent-digest` 08:15 lokale |
| TTL 30 ditë për prospektet e pa-regjistruara (termat e Google) | `sales-agent-prospect-ttl` 03:30 lokale (platform-only) |
| Simulator pa dërgim, "Testo lidhjen", baza e njohurive, cilësimet | `/app/sales-agent?tab=settings` |

NUK bën ende (Faza 2/4): rezervim takimi në kalendar (`meeting.book`), draft
preventivi (`quote.draft`), dërgim email-i të ftohtë (`outreachEmail: 'pending'`
stampohet, asnjë job nuk e shkarkon), chat-i i portalit / forma e landing-ut (kanalet
ekzistojnë në cilësime, hook-u është vetëm WhatsApp), niveli 3.

## 2. Arkitektura (ligji: core-i vendos, api ekzekuton)

- `src/lib/salesAgent/core.ts` — IMPORT-FREE: `resolveSalesAgentSettings`,
  `agentGateReason` (para modelit), `detectHandoffTrigger`, `buildSalesAgentPrompt`
  + `renderSalesFacts`, `parseAgentOutput` (JSON tolerant), `decideDelivery`
  (send/draft/handoff/silent), `nextStage`, `qualificationProgress`, `leadAgentScore`,
  `buildLeadSummary`, `ensureDisclosure`, `coldWaBlockReason` + `coldWaDailyQuota`,
  `ensureColdWaCompliance`, `nudgeBlockReason`, `buildSalesDigest`, labels shqip.
  `api/_salesAgentCore.ts` = kopje byte-identike (test).
- `src/lib/salesAgent/prospecting.ts` — `normalizePlace` (telefoni normalizohet me
  funksionin e injektuar `toWaPhone`), `fitScore` (deterministik, me arsye),
  `findDuplicate`, `estimateSearchRequests`, `searchBlockReason`, draft-et e kontaktit
  të parë. `api/_salesAgentProspecting.ts` = kopje byte-identike.
- `api/_placesClient.ts` — Places API (New) `places:searchText`, field mask i plotë
  (SKU Enterprise, 1 kërkesë = deri 20 biznese), ≤ 3 faqe, `PlacesError` me kode.
  Çelësi: `teamSecrets.googlePlacesApiKey` → env `GOOGLE_PLACES_API_KEY`.
- `api/_salesAgent.ts` — `POST /api/sales-agent` (nëpërmjet `api/email.ts`,
  rewrite në `vercel.json`) + hook-u inbound + `loadSalesFacts`.
- `api/_salesAgentJobs.ts` — 5 job-e, regjistruar në `api/cron/run.ts`
  (`SCOPED_JOBS` + `sales-agent-prospect-ttl` në `PLATFORM_ONLY_JOBS`), orari në
  `vps/server.ts`, ASNJË në `run-all`.
- Klienti: `src/views/SalesAgentView.tsx` (Sot / Prospektet / Bisedat / Cilësimet),
  `src/components/salesAgent/*`, `src/lib/salesAgent/api.ts`, banner në
  `WhatsAppChatPanel` (`AgentThreadBanner`).
- Moduli: `id: 'sales-agent'`, `minPlan: 'business'`, `defaultOff`, leja
  `canAccessSalesAgent` (Admin/Manager/Sales/SalesAgent; Member me override).

## 3. Koleksionet

| Koleksioni | Shkruan | Rregulla |
|---|---|---|
| `prospectSearches` | endpoint (`search.create`), cron (status/counts) | create: anëtar jo-Viewer, `status 'queued'`, counts 0; update vetëm serveri; delete Admin/Manager kur `queued` |
| `prospects` (`<searchId>_<placeId>`) | cron; endpoint për register/reject | staff: vetëm `status` new/approved/rejected + `rejectReason`; `registered`/`leadId`/`outreach*` server-only |
| `salesKnowledge` | Admin/Manager nga browser-i | CRUD Admin/Manager, `keepsBusinessId` |
| `salesAgentRuns` | server (idempotencë + audit, `create()` PARA veprimit) | `write: if false` |
| `salesAgentUsage` (`{bid}_{YYYY-MM-DD}` replies/blocked; `{bid}_{YYYY-MM}` placesRequests) | server | `write: if false` |
| `salesAgentSenders` (`{bid}_{agentId}`: warm-up, sentToday, lastSentAt, failureAts, pausedUntil) | cron | `write: if false` |
| `salesAgentDigests` (`{bid}_{date}`) | cron | `write: if false` |
| `conversations.agent` | server; staff vetëm përmes `conversation.handoff/resume` | `conversationAgentUntouched()` |
| `leads.agent*`, `prospectId`, `coldWaSentAt`, `coldEmailSentAt` | server | `leadAgentKeys*()` |
| `teamSettings.salesAgent` | owner/Admin (browser), `lastRun` nga serveri | në `teamSettingsFinanceKeys()` |
| `userProfiles/salesagent_<bid>` | endpoint `enable` | browser-i s'mund ta krijojë |

Indekse (11): `prospects (businessId,status,fitScore)`, `(businessId,searchId,fitScore)`,
`(businessId,outreachWa,fitScore)`, `(status,expiresAt)`; `prospectSearches
(businessId,createdAt)`, `(status,createdAt)`; `salesKnowledge (businessId,enabled,createdAt)`;
`salesAgentRuns (businessId,createdAt)`, `(businessId,kind,createdAt)`; `conversations
(businessId,agent.active,lastMessageAt)`, `(businessId,agent.stage,lastMessageAt)`.

## 4. Endpoint-i (`POST /api/sales-agent`, body `{ action, teamId?, … }`)

`enable`/`disable` (Admin/owner) · `settings.test` · `search.create { query, city,
maxResults }` (409 `blockReason`) · `search.cancel` · `prospect.register { prospectIds,
outreach: { wa, email } }` → `{ created, linked, skipped }` · `prospect.reject` ·
`conversation.handoff` / `conversation.resume` · `conversation.simulate { messages }`
(pa shkrime) · `reply.draft { conversationId }` (ruan `suggestedReply`) ·
`digest.preview`. Çdo rekord krahasohet me `bid` nga claims; portal-i refuzohet.

## 5. Si vihet në punë (deploy)

1. `firebase deploy --only firestore:indexes` (11 indekse të reja).
2. Push → Vercel (endpoint + hook).
3. `firebase deploy --only firestore:rules` (pas suitës së emulatorit: 234/234).
4. VPS: `git pull` + `npm run prod` / `pm2 restart` që orari i ri të hyjë
   (prospecting/cold-wa 15 min, nudges 1 orë, digest 08:15, TTL 03:30).
5. Env opsional në Vercel: `GOOGLE_PLACES_API_KEY` (fallback platforme — 1 000
   kërkesa falas/muaj për projekt Google), `SALES_AGENT_MAX_AUTONOMY` (default 2).
6. Për tenant-in: super-admin hap modulin `sales-agent` (`lockedModules`), Admin-i
   → `/app/sales-agent?tab=settings` → Aktivizo → persona "Ana / Bos Marketing" →
   çelësi AI (FivoAI) + çelësi Places → "Testo lidhjen" → "Simulo bisedë" → niveli 1,
   pastaj 2.

## 6. Diagnozë

- `/app/sales-agent?tab=today` → "Pse nuk veproi": `salesAgentRuns` 24h grupuar sipas
  `blockReason`/`handoffReason` (etiketa shqip), + `teamSettings.salesAgent.lastRun`.
- Një mesazh pa përgjigje: gjej `salesAgentRuns/{bid}_reply_{conversationId}_{waMessageId}`
  (ose `…_gate`) — `decision`, `blockReason`, `intent`, `confidence`, `model`.
- Cold WA s'dërgon: `salesAgentSenders/{bid}_{agentId}` (pausedUntil, failureAts,
  sentToday) + `prospects.outreachWaReason`.
- Prospecting: `prospectSearches.status/error`, `salesAgentUsage/{bid}_{YYYY-MM}.placesRequests`.

## 7. Kufizime të njohura

- `waVerified` mbetet `null` derisa dërgimi i parë të kthejë 422 (VPS-ja s'ka endpoint
  `onWhatsApp` të veçantë).
- Prospektet nga Places rrallë kanë email → `outreachEmail` do të jetë pothuajse
  gjithmonë i pamundur pa pasurim nga website-i (vendim i hapur i pronarit).
- Inbound media / reaction → `no-text`. Gjuhë jashtë `persona.languages` → handoff.
- `conversation-sla` e numëron përgjigjen e Anës (niveli ≥ 2) si përgjigje të parë;
  handoff-i ri-armatos `awaitingReply: true`.
