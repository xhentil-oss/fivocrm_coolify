# Agjenti Virtual i Shitjeve — Super-plani (31 Tet 2026)

> Moduli `sales-agent`: një agjent shitjesh virtual që punon BRENDA FivoCRM-së —
> gjen leads të rinj (Google Maps), i regjistron pa dublikata, u përgjigjet
> klientëve me AI, i kualifikon, cakton hapin tjetër në Ndjekjen, rezervon
> takime dhe ia dorëzon njeriut në momentin e duhur. Profesional, i matur,
> i auditueshëm. Statusi (31 Tet 2026): Faza 0, 1, 3 dhe pjesë e 4 të NDËRTUARA
> (shih `workspace/SALES_AGENT.md`); të hapura: takimet (Faza 2), preventivi, email-i
> i ftohtë, kanalet portal/landing, niveli 3.

---

## 0. Vizioni në një paragraf

Pronari i një agjencie hap FivoCRM në mëngjes dhe gjen: 40 prospekte të reja nga
"klinika dentare, Tiranë" me fit-score dhe mesazh të parë të propozuar; 6 biseda
WhatsApp të natës ku agjenti u përgjigj brenda 1 minute, mblodhi shërbimin e
kërkuar + buxhetin + afatin, dhe 2 prej tyre i ka rezervuar takim në kalendar;
3 lead-e të vjetra që agjenti i ri-ngjalli; dhe një listë të qartë "ku duhet
NJERIU sot". Çdo veprim i agjentit ka një arsye të emëruar dhe një rresht në
timeline. Agjenti nuk gënjen për çmime, nuk premton afate, nuk flet si bot.

---

## 1. Ligjet e modulit (para se të shkruhet kod)

1. **Agjenti PROPOZON, njeriu APROVON — derisa pronari ta hapë autonominë
   shkallë-shkallë.** Vendimi i vjetër (`_aiReply.ts`: "`waAiAssist: 'auto'`
   deliberately does not exist") mbetet DEFAULT. Autonomia hapet me nivele
   (§5) dhe çdo nivel ka guardrails të emëruara. Një gabim i agjentit duhet të
   jetë i gjetshëm dhe i rikthyeshëm (handoff), kurrë i heshtur.
2. **`src/lib/salesAgent/core.ts` vendos, `api/_salesAgent*.ts` ekzekuton.**
   Core-i import-free (persona, kualifikim, scoring, block reasons, state
   machine e bisedës, template-t e mesazheve) + `api/_salesAgentCore.ts` kopje
   byte-identike (test-enforced), si Nazmije / hosting / CRM automations.
3. **Çdo mos-veprim është një `SalesAgentBlockReason` i emëruar** (`outside-
   autonomy`, `handoff-active`, `opted-out`, `no-knowledge`, `low-confidence`,
   `daily-cap`, `quiet-hours`, `duplicate-contact`, `not-a-person`, …), i
   numëruar në `lastRun` dhe i shfaqur në UI. Kurrë `continue` i heshtur.
4. **Numrat dhe çmimet NUK vijnë nga modeli.** Çmime, shërbime, orare, politika
   vijnë nga `salesKnowledge` (katalogu `services`, kalkulatori, FAQ i
   pronarit). Modeli formulon; faktet injektohen (`renderFactsForPrompt`, si
   Nazmije). Pa fakt → agjenti thotë "do t'ju konfirmojë kolegu im" dhe bën
   handoff, kurrë nuk shpik.
5. **Identiteti i kontaktit kalon GJITHMONË nga `contactIdentity`**: çdo lead
   që agjenti regjistron (nga Maps, forma, WA) kalon `resolve + cross-link`;
   një prospekt që përputhet me lead/klient ekzistues NUK krijon rresht të ri,
   por lidhet (`duplicate-contact` → "Lidh me ekzistuesin").
6. **Idempotencë me dokument**: `salesAgentRuns/{bid}_{kind}_{entityId}_{key}`
   me `create()` PARA veprimit; `ALREADY_EXISTS` = skip. Koleksioni
   `write: if false` nga browser-i.
7. **Mesazhi i ftohtë në WhatsApp është i LEJUAR, por i matur** (vendim i
   pronarit, 31 Tet 2026, pas paralajmërimit për rrezikun e bllokimit).
   Kufijtë jetojnë në core (`coldWaBlockReason`), jo në checkbox:
   `coldWaPerDay` ≤ 10 dhe `coldWaMinGapMinutes` ≥ 60 PËR NUMËR dërgues (jo
   për tenant), vetëm 09:00–19:00 lokale Hën–Pre, vetëm numra që `onWhatsApp`
   i konfirmon, kurrë në ditën e regjistrimit (prospekti "ngrohet" 1 ditë),
   mesazhi i parë mban prezantimin + "shkruani NDALO për të mos marrë më",
   dhe **çdo bllokim/raportim e ul kuotën**: 1 `failed`/`blocked` në 24h →
   kuota përgjysmohet, 2 → pauzë automatike 7 ditë + njoftim pronarit
   (`cold-wa-paused`). Numri i ri fillon me warm-up: 3/ditë javën e parë.
   Rekomandim i fortë: një numër i DEDIKUAR outreach-i, jo numri kryesor i
   biznesit. Email-i mbetet kanali paralel për të njëjtin prospekt.
8. **Transparencë**: agjenti prezantohet si asistent virtual i biznesit
   (emër persona + "asistent virtual") të paktën në mesazhin e parë dhe kur
   pyetet "je robot?". (EU AI Act art. 50; Shqipëria po harmonizohet.)
   Pronari NUK mund ta fikë këtë.
9. **Kosto e kontrolluar për tenant**: cap ditor AI (`aiDailyUsage`, si
   `waAiDailyCap`), buxhet mujor Places (`placesMonthlyBudget`), çdo thirrje
   një rresht `aiUsageLogs` / `placesUsageLogs`. Mbi cap → `daily-cap`, njoftim
   pronarit, kurrë heshtje.
10. **Të dhënat e Google Places ruhen sipas termave**: `placeId` përgjithmonë;
    lat/lng ≤ 30 ditë; emri/telefoni/website-i i një prospekti ruhen vetëm kur
    NJERIU e regjistron si lead (atëherë është e dhënë e CRM-së së tenant-it,
    jo cache i Google). Prospektet e pa-regjistruara fshihen pas 30 ditësh
    (cron `sales-agent-prospect-ttl`).

---

## 2. Çfarë ekziston tashmë dhe RIPËRDORET (jo rindërtim)

| Nevoja e agjentit | Ekziston në FivoCRM | Si lidhet |
|---|---|---|
| Përgjigje AI në WhatsApp | `_waInbound.ts` + `_aiReply.ts` (draft), `_waAutoReply.ts` (greeting/outside-hours) | Agjenti bëhet hapi 8 i ri i inbound-it: zëvendëson `draftWaReply` kur moduli është aktiv; `waAiAssist` mbetet për tenant-ët pa modul |
| Cili AI, cili çelës | `resolveAiConfig()` (`_aiProvider.ts`) + `classifyAiError` | Asnjë provider i ri; `feature: 'sales-agent'` në `aiUsageLogs` |
| Hapi tjetër / radha | `src/lib/crm/followUp.ts` (`scheduleNextStepPatch`, `touchContactPatch`), `/app/follow-ups` | Agjenti shkruan hapin tjetër me të njëjtat patch-e; radha e njeriut mbetet e vetmja radhë |
| Sekuenca / cadence | `playbooks.ts` + `lead-cadence-steps` | Sekuencat e outreach-it = playbooks me kanal `email` që agjenti mund t'i DËRGOJË (niveli i autonomisë), `call` = detyrë për njeriun |
| Rregulla trigger→action | `automationRules.ts` (36 teste) | Veprim i ri `sales_agent_engage` (agjenti merr bisedën) dhe kusht `agentQualified` |
| Dedupe & lidhje | `contactIdentity.ts` / `_contactIdentity.ts`, `merge-contacts` | Ligji 5 |
| Email dërgim | Marketing (Resend/SMTP), `_mailer.ts`, `senderHeader()` | Outreach i ftohtë + follow-up me email |
| Kalendar | `GoogleApiContext`, GMB OAuth (`_gmb.ts` client, refresh-token pinning) | Rezervim takimi = Google Calendar event + task + hap tjetër |
| Oferta | Price Calculator → `quotes` (Draft → Sent) | Agjenti përgatit DRAFT preventivi nga paketat; njeriu e dërgon (Dërgo) |
| Deals | `DealsView`, `Deal.stage` | Lead i kualifikuar → propozim deal-i (me konfirmim) |
| Persona bot pa user | Nazmije (`userProfiles/nazmije_<bid>`, pa Auth, pa `teamMembers`) | I njëjti model për agjentin: `userProfiles/salesagent_<bid>`; asnjë seat, asnjë payroll |
| Njoftime | `notifyUser()` + regjistri i tipeve | 5 tipe të reja (§4.5) |
| Modul-gating | `src/lib/modules.ts` → `ModuleGate` | `id: 'sales-agent'`, `minPlan: 'business'`, `defaultOff: true`, group `Shitje` |
| Sekrete | `teamSecrets` + `SECRET_FIELDS` | `googlePlacesApiKey` (+ flag `hasGooglePlacesApiKey`) |
| Cron | `vps/server.ts` `scheduleDailyInZone` / `setInterval`, `SCOPED_JOBS` | 4 job-e të reja (§4.4), ASNJË në `run-all` |
| Endpoint | `api/email.ts` switch (cap 12 funksione Vercel) | `case 'sales-agent'` → `api/_salesAgent.ts` |

Nazmije dhe agjenti i shitjeve janë DY persona të ndryshme: Nazmije flet vetëm
me stafin, agjenti flet me klientët. Nuk bashkohen kurrë (ligji i Nazmijes:
"she never speaks to clients").

---

## 3. Autonomia me nivele (`teamSettings.salesAgent.autonomy`)

| Niveli | Emri në UI | Çfarë bën vetë | Çfarë kërkon njeri |
|---|---|---|---|
| 0 | **Vetëm sugjerime** (default) | Draft përgjigjeje, draft mesazhi të parë, scoring, propozim hapi | Çdo dërgim |
| 1 | **Përgjigjet në pyetje të thjeshta** | Përgjigjet vetë vetëm kur: pyetja përputhet me FAQ/katalog me `confidence ≥ 0.8`, jashtë orarit OSE pas `humanSilenceMinutes` (p.sh. 10 min pa përgjigje njeriu), brenda `quietHours` | Çdo pyetje për çmim të personalizuar, zbritje, ankesë, afat |
| 2 | **Kualifikon dhe rezervon** | Niveli 1 + bën pyetjet e kualifikimit (shërbimi, buxheti, afati, vendimmarrësi), cakton hapin tjetër, propozon 3 orare dhe rezervon takimin, dërgon email follow-up të sekuencës | Oferta (preventivi), negocimi, mbyllja |
| 3 | **Dërgon oferta standarde** | Niveli 2 + dërgon preventivin kur paketa është STANDARDE nga kalkulatori (pa zbritje) | Çdo gjë jashtë listës |

Rregulla të pandryshueshme në çdo nivel: handoff i menjëhershëm kur klienti
kërkon njeri, shpreh pakënaqësi (sentiment < prag), përmend "ankesë / rimbursim /
ligj / avokat", shkruan në gjuhë që agjenti s'e mbulon, ose pas N (default 6)
kthesave pa progres (`handoff-reason` i emëruar). Pas handoff-it agjenti HESHT
në atë bisedë derisa njeriu ta kthejë ("Ktheja agjentit").

---

## 4. Arkitektura

### 4.1 Skedarët

```
src/lib/salesAgent/
  core.ts            — persona prompt builder, state machine e bisedës,
                       qualification schema, scoring (ICP fit), block reasons,
                       handoff rules, template-t e mesazhit të parë. IMPORT-FREE.
  core.test.ts       — + testi "api copy is byte-identical"
  prospecting.ts     — normalizim i rezultateve Places → Prospect, fit-score,
                       dedupe keys (phone/website/name+city), TTL
  prospecting.test.ts
  sequences.ts       — hapat e outreach-it mbi playbooks (kanali email auto,
                       call = task), reply-detection, stop-on-reply
api/
  _salesAgentCore.ts — kopje byte-identike e core.ts
  _salesAgent.ts     — POST /api/sales-agent (actions, §4.3)
  _salesAgentJobs.ts — cron runners (§4.4)
  _placesClient.ts   — Google Places API (New): textSearch + placeDetails,
                       field masks minimale, buxhet, usage log. Nuk di Firestore.
src/views/SalesAgentView.tsx          — /app/sales-agent (4 tab-e, §6)
src/components/salesAgent/*           — ProspectsInbox, AgentConversationBadge,
                                        AgentSettingsPanel, HandoffBanner
workspace/SALES_AGENT.md              — runbook pas ndërtimit
```

### 4.2 Koleksionet (të gjitha me `businessId`, në `businessIsolatedAlways` + rregulla + test negativ cross-tenant)

| Koleksioni | Përmbajtja | Kush shkruan |
|---|---|---|
| `prospectSearches` | `{ query, city, radiusKm, category, status: queued/running/done/failed, requestedByUserId, counts: {found, new, duplicate, registered}, costUnits, placesPageToken }` | Browser krijon (`queued`), cron-i ekzekuton |
| `prospects` | `{ searchId, placeId, name, category, address, city, phone?, website?, rating, reviewCount, fitScore, fitReasons[], status: new/approved/rejected/registered/duplicate, leadId?, matchedContactId?, firstMessageDraft, expiresAt }` | Cron krijon; staff ndryshon `status`; `register` = endpoint |
| `salesAgentRuns` | Idempotencë + audit: `{ kind: 'reply'/'qualify'/'book'/'sequence-step'/'register', entityId, decision, blockReason?, model, tokens, confidence }` | **Vetëm serveri** (`write: if false`) |
| `conversations` (ekzistues) | Fusha të reja `agent: { active, stage: greeting/qualifying/proposing/booking/handoff/closed, collected: {service, budget, timeline, decisionMaker, city}, turns, handoffReason?, handoffAt?, resumedByUserId? }` | Serveri; staff vetëm `agent.active` / handoff-resume |
| `leads` (ekzistues) | Fusha të reja `agentQualifiedAt`, `agentScore`, `agentSummary` (3 rreshta), `prospectId?`, `source: 'maps-prospecting'` | Serveri + patch-et e Ndjekjes |
| `salesKnowledge` | `{ kind: 'faq'/'objection'/'policy'/'service-note', question, answer, serviceId?, enabled }` (max ~200/tenant, renderohen si fakte; pa embeddings në Fazën 1) | Staff (Admin/Manager) |
| `teamSettings.salesAgent` | persona (emri, toni, gjuhët), autonomy 0–3, quietHours, humanSilenceMinutes, handoff rules, channels {wa, email, portalChat, landingForm}, qualification fields, meeting {calendarId, durationMin, slots}, placesMonthlyBudget, icp {categories[], cities[], minRating, mustHaveWebsite?}, lastRun | Admin |
| `teamSecrets.googlePlacesApiKey` | Çelësi Places i tenant-it (fallback env `GOOGLE_PLACES_API_KEY` i platformës, me buxhet më të ulët) | `POST /api/tenant-secrets` |

### 4.3 `POST /api/sales-agent` (nëpërmjet `api/email.ts` `case 'sales-agent'`)

Çdo action ngarkon rekordin dhe krahason `businessId` me claims (`bid`); id-të e
body-t nuk besohen kurrë. Portal-i NUK e thërret këtë endpoint.

- `settings.test` — verifikon çelësin AI + Places (1 thirrje Text Search "ID only", kosto 0) dhe kthen kodin e klasifikuar (`aiResponseError()` në klient).
- `search.create` — validon query/city/ICP, krijon `prospectSearches` (`queued`), kthen vlerësim kostoje; refuzon mbi buxhet (`budget-exceeded`).
- `prospect.register` — `{ prospectIds[] }`: për secilin `resolveContactIdentity` → ose krijon `leads` (`source: 'maps-prospecting'`, `status: 'New'`, hap tjetër "Kontakt i parë" + draft mesazhi) ose lidh me ekzistuesin (`duplicate-contact`). Kthen `{ created, linked, skipped[] }`.
- `prospect.reject` — status + arsye (ushqen fit-score-in e ardhshëm si feedback i thjeshtë).
- `reply.draft` — "Rigjenero" në panel: i njëjti core si inbound, `force` kalon burst-in.
- `reply.approve` — niveli 0: staff aprovon draft-in → dërgohet me `_waSend` (idempotency key `sa_<conv>_<msgId>`), stampohet `logContact`.
- `conversation.handoff` / `conversation.resume` — njeriu merr / ia kthen bisedën.
- `meeting.book` — krijon event-in në Google Calendar (OAuth-i ekzistues), task + hap tjetër, konfirmim klientit (kanali i bisedës).
- `quote.draft` — ndërton draft `quotes` nga paketat e kalkulatorit sipas `collected.service`; statusi mbetet `Draft` (njeriu shtyp Dërgo), përveç nivelit 3 për paketa standarde.
- `digest.preview` — çfarë do të thoshte digesti i mëngjesit (për Cilësimet).

### 4.4 Cron (VPS, `SCOPED_JOBS`, JO në `run-all`, tenant-ët e pezulluar skip, manual run = `bid` i thirrësit)

| Job | Orari | Çfarë bën |
|---|---|---|
| `sales-agent-prospecting` | çdo 15 min | Merr ≤ 3 kërkime `queued`/tenant, Text Search (New) me field mask minimal + Place Details vetëm për rezultatet mbi `minFitScore`, dedupe kundër `leads`/`customers` (phone/website/emër+qytet), shkruan `prospects`, njofton `prospects_ready`. Lease `withJobLease`. |
| `sales-agent-sequences` | çdo orë, brenda 09–19 lokale | Hapat e sekuencës: email → dërgon (niveli ≥ 2) ose krijon draft; call → task; stop-on-reply (çdo inbound ndal sekuencën: `replied`). |
| `sales-agent-nudges` | çdo orë | Biseda `qualifying` pa përgjigje klienti > 24h → 1 nudge (max 2, `nudge:<n>`); `handoff` pa njeri > `handoffSlaMinutes` → eskalim te menaxherët. |
| `sales-agent-digest` | 08:15 lokale (`scheduleDailyInZone`) | Digest për ekipin e shitjeve: prospekte të reja, biseda të kualifikuara, takime, handoff-e të hapura, kostoja e djeshme. Idempotent `salesAgentDigests/{bid}_{date}`. |
| `sales-agent-prospect-ttl` | 03:30 lokale | Fshin `prospects` të pa-regjistruara > 30 ditë (ligji 10). |

Inbound (jo cron): `_waInbound.ts` hapi 8 → `salesAgentDecide()`; forma e landing-ut
(`api/landing.ts`) → pas krijimit të lead-it, agjenti dërgon përgjigjen e parë
me EMAIL (niveli ≥ 1) dhe cakton hapin tjetër; chat-i i portalit (`senderType:
'client'`) → i njëjti core, kanali `portal`.

### 4.5 Tipet e reja të njoftimeve (regjistri `notificationTypes.ts` + mirror)

`sales_agent_handoff` (urgent), `sales_agent_meeting_booked`, `prospects_ready`,
`sales_agent_qualified` (lead i kualifikuar, me përmbledhje 3 rreshta),
`sales_agent_daily_digest`, `sales_agent_budget` (cap AI/Places i arritur).

### 4.6 Rregullat Firestore (test-et në `firestore-rules.test.mjs`)

- `prospects` / `prospectSearches` / `salesKnowledge`: `isBusinessMember`, `keepsBusinessId()`, shkrim vetëm staff (jo Viewer, jo portal); `prospects.leadId/status: registered` vetëm serveri.
- `salesAgentRuns` / `salesAgentDigests`: `write: if false`.
- `conversations.agent.*`: serveri; staff vetëm `agent.active` + handoff/resume.
- `leads.agent*`: serveri (si engine-flags e detyrave).
- `teamSettings.salesAgent.autonomy ≥ 1` vetëm Owner/Admin (si `financeSettings`).
- Test negativ cross-tenant për secilin koleksion të ri.

---

## 5. Si "mendon" agjenti (core state machine)

```
inbound message
  → guards (opted-out, not-a-person jid, handoff-active, quiet, cap, autonomy)
  → classify intent: greeting | question | price | booking | complaint | human |
                     off-topic | opt-out
  → stage transition (greeting → qualifying → proposing → booking → closed)
  → facts = knowledge (FAQ, services, prices policy, hours) + lead/customer record
           + collected fields + last 10 messages
  → model: reply (≤ 400 chars, gjuha e klientit, sq/en/it) + structured JSON
           { intent, confidence, collected: {...}, nextStep?, handoff?: reason }
  → policy: confidence < 0.8 ose intent ∉ allowed(autonomy) → DRAFT (jo send)
  → run doc (create) → send → logContact + followUp patches + notifications
```

Kualifikimi (BANT i thjeshtuar, i konfigurueshëm): **Shërbimi** → **Qyteti/sektori**
→ **Afati** → **Buxheti (interval, jo shifër)** → **Vendimmarrësi**. Një pyetje
për kthesë, kurrë formular. Kur ≥ 3 fusha janë mbledhur → `agentQualifiedAt`,
score, `sales_agent_qualified`, propozim deal-i (konfirmim njeriu), hapi tjetër
"Takim prezantimi" me 3 orare nga kalendari.

Profesionalizmi — rregullat e prompt-it (të testuara me fixtures):
- Prezantohet me emrin e personës + "asistent virtual i <Biznesi>"; "ju"; pa emoji
  përveç kur klienti i përdor; asnjë premtim ("do ta bëjmë", "garantojmë");
  çmime VETËM nga faktet, ndryshe "varet nga … — ju dërgoj një ofertë";
  nuk komenton konkurrentët; nuk kërkon të dhëna sensitive (karta, ID);
  mesazh ≤ 400 karaktere, 1 pyetje; gjuha e klientit (default sq).
- Bankë "refuzimesh profesionale" (si humour-bank i Nazmijes): si i përgjigjet
  "jeni shumë shtrenjtë", "do mendohem", "kam ofertë tjetër" — nga
  `salesKnowledge.objection`, kurrë improvizim mbi çmim.

---

## 6. UI — `/app/sales-agent` (4 tab-e) + 3 pika integrimi

1. **Sot** — 4 kuti: handoff-e të hapura (me SLA), biseda që agjenti po i mban,
   takime të rezervuara, prospekte për shqyrtim; poshtë: "Pse nuk veproi"
   (`lastRun` block reasons me etiketa shqip), kostoja e ditës (AI + Places).
2. **Prospektet** — Kërkim i ri (query, qytet, rreze, kategori ICP, vlerësim
   kostoje), lista e kërkimeve, inbox prospektesh me fit-score dhe arsye
   ("website pa SEO", "4.2★ / 38 vlerësime", "pa rrjete sociale"), veprime:
   Regjistro (bulk), Refuzo, "Dublikatë → hap kontaktin". Mesazhi i parë i
   propozuar për email + skripti i telefonatës.
3. **Bisedat** — bisedat ku agjenti është aktiv ose në handoff; hap panelin
   ekzistues WhatsApp/portal me `HandoffBanner` ("Agjenti e mbajti deri 14:05 —
   arsyeja: kërkoi çmim të personalizuar") + butonat "Merre" / "Ktheja agjentit".
4. **Cilësimet** — persona, autonomia (kartat 0–3 me shembuj), orari, kanalet,
   fushat e kualifikimit, kalendari, njohuritë (FAQ/objeksione/politika),
   buxhetet, "Testo lidhjen", "Simulo bisedë" (sandbox pa dërgim).

Pika integrimi: `WhatsAppChatPanel` (badge "🤖 Agjenti" te rreshtat automated,
draft-i i agjentit në vend të "Sugjerim AI"), `FollowUpsView` (hapat e vendosura
nga agjenti me ikonë), `CRMView` lead drawer (seksioni "Agjenti: përmbledhje +
fushat e mbledhura"), Customer360 (timeline rows `agent_reply`, `agent_booked`).

---

## 7. Google Maps — zbulimi i leads (detaje)

- **API**: Google Places API (New) — `places:searchText` (field mask `places.id,
  places.displayName, places.formattedAddress, places.rating,
  places.userRatingCount, places.primaryType, places.websiteUri,
  places.nationalPhoneNumber`) me `pageToken` deri në 3 faqe (60 rezultate) për
  kërkim; `places/{id}` vetëm kur duhet fushë shtesë. Çelësi i tenant-it
  (`teamSecrets`), i kufizuar nga Google Console vetëm për Places API.
- **Fit-score (0–100, deterministik, në `prospecting.ts`)**: kategoria ∈ ICP
  (+30), qyteti ∈ ICP (+15), rating 3.5–4.6 me ≥ 10 vlerësime (+15 — kanë
  klientë por kanë vend për përmirësim), pa website ose website jo-https (+20 për
  agjenci web/SEO; i konfigurueshëm sipas shërbimit që shitet), telefon i
  pranishëm (+10), jo zinxhir/korporatë (-20 sipas fjalëve kyçe). Arsyet shfaqen.
- **Dedupe**: `toWaPhone()` mbi telefonin, host-i i website-it, `normalizeName +
  city` — kundër `leads`, `customers`, `prospects` të tjera (kërkim i skopuar
  `businessId`, me `in`-batch).
- **Pasurim opsional (Faza 2b)**: nga website-i i prospektit marrim VETËM
  faqen kryesore (fetch i skopuar, timeout 8s, pa ndjekje linkesh, `robots.txt`
  i respektuar) për email-in publik `mailto:`/`@domain` dhe sinjalet (ka
  Facebook/Instagram, ka pixel, gjuhë). Pa scraping Maps, pa Outscraper/Apify
  (shkelje e termave të Google dhe rrezik ligjor për tenant-in).
- **Ligjore**: lead-i B2B me të dhëna PUBLIKE biznesi (telefon/email i
  biznesit) përpunohet me bazë "interes legjitim"; mesazhi i parë ofron
  çregjistrim; opt-out-i respektohet nga çdo dërgues (`waOptOut` ekzistues +
  `emailOptOut`). Ligji 124/2024 (Shqipëri) ≈ GDPR — regjistri i përpunimit e
  përmend këtë burim. Njoftim i qartë në UI: "Këto janë të dhëna publike
  biznesi; regjistroji vetëm ato që do t'i kontaktosh."
- **Kosto (Places API New, verifikuar 31 Tet 2026 nga burime dytësore — konfirmo
  në faqen zyrtare para shipping-ut)**: Text Search faturohet PËR KËRKESË (jo
  për rezultat), dhe një kërkesë kthen deri në 20 biznese. Telefoni dhe
  website-i e çojnë kërkesën në SKU-në **Enterprise: $35 / 1 000 kërkesa, me
  1 000 kërkesa FALAS në muaj për projekt Google**. Pra:
  - 1 000 kërkesa falas × 20 = deri në **20 000 biznese/muaj pa pagesë**;
  - mbi këtë, 1 000 biznese ≈ 50 kërkesa ≈ **$1.75**;
  - Place Details nuk nevojitet (Text Search i jep të gjitha fushat tona).
  Niveli falas është për projekt Google, jo për tenant → me çelës platforme
  ndahet mes tenant-ëve; me çelës tenant-i secili ka 1 000-shin e vet.
  Buxheti mujor për tenant në kërkesa (default 300 = 6 000 biznese); vlerësimi
  shfaqet PARA kërkimit; mbi buxhet → `budget-exceeded`.

---

## 8. Fazat e ndërtimit

### Faza 0 — Themeli (≈ 1 javë)
- Modul në regjistër, route + `ModuleGate`, `userProfiles/salesagent_<bid>`,
  `teamSettings.salesAgent` + `AgentSettingsPanel` (persona, autonomi 0, orari).
- `core.ts` + api copy + testi byte-identical; block reasons; `salesAgentRuns`.
- `salesKnowledge` (CRUD i thjeshtë) + "Simulo bisedë" (sandbox).
- Rregulla + 6 teste; tipet e njoftimeve; `api/email.ts` case.
- **Pranimi**: pronari konfiguron personën, simulon 5 biseda, sheh faktet që
  u injektuan dhe arsyen e çdo refuzimi.

### Faza 1 — Përgjigje inteligjente (≈ 2 javë)
- Inbound WA → `salesAgentDecide()`; niveli 0 (draft) dhe 1 (FAQ auto, jashtë
  orarit / pas heshtjes); handoff rules + `HandoffBanner`; `sales-agent-nudges`.
- Forma e landing-ut → përgjigje e parë me email + hap tjetër; portal chat.
- Timeline rows + badge-et; `sales_agent_handoff` me SLA.
- **Pranimi**: 100 % e bisedave kanë run doc; asnjë dërgim pa run doc; test
  "çmim i panjohur → handoff, jo shifër"; "kërkoi njeri → heshtje".

### Faza 2 — Kualifikim + takime (≈ 2 javë)
- State machine qualifying → `collected`, `agentQualifiedAt`, score, përmbledhje.
- `meeting.book` me Google Calendar + 3 orare; `quote.draft` nga kalkulatori.
- Propozim deal-i; integrim në CRMView drawer + Customer360.
- **Pranimi**: lead i ri nga WA → 4 kthesa → takim në kalendar + task + hap tjetër,
  gjithçka e dukshme në Ndjekje.

### Faza 3 — Zbulimi i leads në Google Maps (≈ 2 javë)
- `_placesClient.ts`, `prospectSearches`/`prospects`, cron prospecting + TTL,
  fit-score, dedupe, inbox-i i prospekteve, `prospect.register` (bulk), draft
  i mesazhit të parë (email) + skript telefonate, buxheti.
- **Pranimi**: "klinika dentare Tiranë" → ≤ 60 prospekte në < 2 min, 0 dublikata
  kundër CRM-së, regjistrimi i 10 bëhet në 1 klik dhe secili ka hap tjetër.

### Faza 4 — Outreach & nurturing (≈ 2 javë)
- `sequences.ts` mbi playbooks: email auto (niveli ≥ 2), call = task, stop-on-
  reply, re-engagement i lead-eve të fjetura (lidhje me WA dormancy VETËM për
  kontakte me historik inbound), `sales-agent-digest`.
- Veprimi `sales_agent_engage` në automation rules.
- **Pranimi**: sekuenca 3-hapëshe email → përgjigja ndal sekuencën brenda 1 ore
  dhe agjenti e merr bisedën në nivelin e lejuar.

### Faza 5 — Niveli 3 + matje (≈ 1 javë)
- Oferta standarde auto; raporti i performancës së agjentit (§9) në
  `/app/sales-agent` + Accountability; A/B i mesazhit të parë (2 variante).

Jashtë planit (vendoset më vonë): telefonata me zë (Twilio/ElevenLabs), Instagram/
Messenger DM (kërkon Meta App Review si Social), embeddings/RAG mbi dokumente.

---

## 9. KPI-të që moduli vetë i mat (nga `salesAgentRuns` + leads)

- Koha mesatare e përgjigjes së parë (agjent vs njeri), % bisedash të mbajtura
  pa handoff, % handoff-e brenda SLA.
- Lead-e të kualifikuara / javë, takime të rezervuara, no-show.
- Prospekte: gjetur → regjistruar → kontaktuar → u përgjigj → kualifikuar → Won
  (funnel për kërkim dhe për kategori ICP).
- Kosto për lead të kualifikuar (AI + Places) dhe kosto për takim.
- Cilësia: % mesazhesh të agjentit të ndryshuara nga njeriu para dërgimit
  (niveli 0/1) — kur bie nën 20 % për 2 javë, UI propozon nivelin tjetër.

---

## 10. Siguria (checklist para deploy-it)

- Asnjë id nga body; `bid` nga claims; portal-i s'thërret endpoint-in.
- Prompt-injection: teksti i klientit hyn si DATA (blloku "mesazhet e klientit"),
  faktet veç; modeli kthen JSON të validuar (schema), teksti i përgjigjes kalon
  `sanitizeHtml` para render-it; linket vetëm `safeExternalUrl`.
- Çelësi Places vetëm në `teamSecrets` (AES-GCM), i kufizuar në Console.
- Fetch-i i website-it të prospektit: vetëm https, pa IP private (si VPS relay),
  timeout, 200 KB max, pa ekzekutim JS.
- Rate limits: `search.create` 10/orë/user, `reply.draft` si `ai-reply`.
- Çdo mesazh automatik mban `automated: true, automationKind: 'sales-agent'`
  (auto-reply-i ekzistues bllokohet `reply-to-automated` — testohet që të dy
  motorët nuk i përgjigjen të njëjtit mesazh).
- Opt-out: STOP/NDALO ndal edhe agjentin edhe sekuencat; `emailOptOut` i ri.

---

## 11. Rreziqet dhe si mbrohemi

| Rreziku | Mbrojtja |
|---|---|
| Ban i numrit WhatsApp nga outreach i ftohtë | Ligji 7: ≤10/ditë, ≥1 orë gap, warm-up, numër i dedikuar, auto-pauzë në bllokim; rreziku mbetet dhe pronari e ka pranuar |
| Agjenti shpik çmim / premton | Ligji 4; test fixtures; handoff në çmim të panjohur |
| Kosto AI/Places pa kontroll | Cap ditor/mujor + `sales_agent_budget` + usage logs |
| Dy motorë i përgjigjen të njëjtit mesazh (auto-reply + agjent) | Një vendimmarrës në inbound: kur moduli është aktiv, auto-reply-i i vjetër del në `agent-active`; test |
| Termat e Google (cache) | Ligji 10 + TTL cron |
| Humbje besimi te klienti ("fola me bot") | Prezantim i detyruar + handoff i shpejtë + ton profesional |
| Dublikata lead-esh | Ligji 5 (`contactIdentity`) + dedupe në prospecting |
| Vercel 12-function cap | Gjithçka nën `api/email.ts` |

---

## 12. Vendimet e pronarit

Vendosur 31 Tet 2026:
1. **Persona default: "Ana nga Bos Marketing"** — prezantohet "Ana, asistentja
   virtuale e Bos Marketing"; emri/biznesi të konfigurueshëm për tenant
   (`salesAgent.persona.name`, default `Ana`).
2. **Niveli maksimal i autonomisë në v1: 2** (kualifikon + rezervon + email
   sekuence). Niveli 3 mbetet i fshehur pas një flag-u platforme.
3. **Cold WhatsApp: PO, i kufizuar** — ligji 7 (10/ditë, 1/orë, warm-up,
   auto-pauzë).

Ende të hapura:
4. **Plani minimal**: rekomandoj `business`.
5. **Çelësi Places**: me 1 000 kërkesa falas/muaj për projekt, çelësi i
   PLATFORMËS mjafton për fillim (≈ 20 000 biznese/muaj falas për të gjithë);
   kalon te çelësi i tenant-it kur tenant-i e kalon kuotën e tij.
6. **Email cold outreach**: nga SMTP-ja e tenant-it, kurrë nga `fivocrm.com`.
7. **Pasurimi nga website-i i prospektit** (Faza 2b): po/jo.

---

## 13. Rendi i punës (checklist për Faza 0 → kod)

1. `src/lib/modules.ts` + `UserPermissions.canAccessSalesAgent` (të gjitha 9
   vendet e listës "Adding a canAccessX flag").
2. Tipet në `src/types/index.ts` (Prospect, ProspectSearch, SalesKnowledgeItem,
   SalesAgentSettings, ConversationAgentState, SalesAgentRun).
3. `core.ts` + teste + `api/_salesAgentCore.ts` + testi byte-identical.
4. `useFirestore.ts`: `businessIsolatedAlways` + `teamScopedCollections` për 4
   koleksionet; `firestore.rules` + teste; `firestore.indexes.json`
   (`prospects (businessId, status, fitScore DESC)`, `prospectSearches
   (businessId, status, createdAt)`, `conversations (businessId, agent.stage)`).
5. `api/_salesAgent.ts` (+ `case 'sales-agent'`), `_tenantConfig.ts` SECRET_FIELDS.
6. `SalesAgentView` (tab Cilësimet + Sot), `AgentSettingsPanel`, sandbox.
7. Njoftimet (regjistër + mirror + test), `vps/server.ts` schedule, `SCOPED_JOBS`.
8. `CLAUDE.md` seksion i ri + `workspace/SALES_AGENT.md` runbook.
9. Deploy: indexes → push → rules → VPS restart (rendi i zakonshëm).

Burime të konsultuara për §7 dhe ligjin 7 (për verifikim para implementimit):
Google Maps Platform Service Specific Terms (cache: place ID pa afat, lat/lng ≤ 30
ditë), udhëzuesit e Meta për WhatsApp Business Messaging Policy (mesazhet e
pakërkuara = shkak kryesor bllokimi).
