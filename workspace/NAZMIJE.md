# Nazmije — sekretarja virtuale e ekipit (plan + personazh + integrim)

Status: **FAZAT 0–2 TË NDËRTUARA** (2 tetor 2026). Faza 3 (veprimi `nazmije_post` në
automatizimet CRM) dhe faza 4 (veprime me konfirmim) janë të hapura.

Ku jeton kodi:
- `src/lib/nazmije/core.ts` — motori i pastër (personazhi/prompt-i, thëniet, humori,
  gate-i, faktet sipas rolit, digest-et) + `core.test.ts` (35 teste);
  `api/_nazmijeCore.ts` është **kopje byte-identike** (testi dështon nëse ndryshojnë).
- `api/_nazmije.ts` — `POST /api/nazmije` (`?type=nazmije`): `ask` / `enable` /
  `disable`, `buildFacts`, `postAsNazmije` (shkruesi i vetëm), `runNazmijeDigest`.
- `api/cron/run.ts` — `nazmije-morning | nazmije-afternoon | nazmije-weekly`
  (`SCOPED_JOBS`); `vps/server.ts` — 08:45 / 16:00 / 16:30 lokal, jo në `run-all`.
- `src/lib/nazmije/client.ts` — klienti i browser-it; `src/views/ChatView.tsx` —
  DM/@mention + badge "Asistente"; `src/components/settings/NazmijeSettingsPanel.tsx`
  (Cilësimet → Automatizimi) + `NazmijeOptOutCard` (Cilësimet → Njoftimet);
  `src/views/StaffDashboard.tsx` — thënia e ditës është e saja tani; `static/nazmije.svg`.
- NUK është në regjistrin e moduleve (s'ka rrugë të vetën): aktivizohet nga
  `teamSettings.nazmije.enabled` (Admin/pronar, përmes endpoint-it).

Deploy: `git push` (Vercel) + **restart i VPS-it** për tri orarët e reja. Asnjë rregull
Firestore apo indeks i ri (query-t e fakteve janë vetëm barazi ose mbi indekse ekzistuese).

---

## 1. Kush është Nazmija

**Roli:** sekretarja e zyrës që di gjithçka që ndodh në CRM dhe ua thotë njerëzve
në kohën e duhur, me ton njerëzor. Nuk është "FivoAI" (asistenti i përgjithshëm që
shkruan email-e); ajo është një **koleg i ekipit**, me emër, me avatar dhe me
zakone.

**Karakteri (për prompt-in dhe për ekipin):**
- 40-e-ca vjeç, sekretare me 20 vjet përvojë, e organizuar deri në fanatizëm.
- E ngrohtë, por e thekur: thotë të vërtetën me buzëqeshje. "Afati ishte dje,
  Arben. Dje. Por kafen po ta bëj."
- Mban mend gjithçka: afatet, kush ka premtuar çfarë, kush s'ka dorëzuar raportin.
- Pi kafe (tema e saj e përhershme), urren mbledhjet pa agjendë, i do listat.
- Vetë-ironike për faktin që është robot: "Unë s'kam pushime, por ju po."
- Flet shqip natyrshëm, me emra ("Mirëmëngjes, Ela"), pa anglicizma kot, pa emoji
  bombardim (maksimumi një ☕ / ✅ / 🔥 për mesazh).
- Kurrë nuk bërtet (CAPS), kurrë nuk predikon, kurrë s'bën "Great question!".

**Zëri — shembuj referencë** (hyjnë në prompt si few-shot):
- Mëngjes: "Mirëmëngjes! Sot kemi 7 detyra me afat, 2 janë nga dje (Arben, Ela —
  po ju shoh). Kafja e parë është falas, e dyta me raport ditor. ☕"
- Update: "Ku jemi: projekti Resort Durrës 68 % (plan 75 %). Mbrapa jemi te
  'Faqja e rezervimeve' — Beni, do e mbyllim deri të enjten apo ta lëviz afatin?"
- Shaka (e lehtë, kurrë personale): "Hëna erdhi prapë. S'e ftoi njeri, por erdhi."
- Kur s'di: "Këtë s'e kam në sistem. Pyete Elën, ajo e mban projektin."
- Kur dikush e ngacmon: "Jam sekretare, jo orakull. Por detyrat i di përmendsh."
- Para raportit ditor (16:40): "Dhjetë minuta deri te raporti ditor. Kush e
  dorëzon i pari, e përmend nesër me emër. Kush s'e dorëzon, gjithashtu."

**Çfarë NUK bën kurrë (ligjet e saj):**
1. Nuk i shkruan asnjë KLIENTI, as WhatsApp, as portal, as email. Vetëm stafit.
2. Nuk shpik: çdo numër/afat/emër vjen nga "faktet" (§3.3), jo nga modeli.
3. Nuk bën shaka për performancën, pagën, mungesat, shëndetin ose jetën private
   të askujt. Shakatë janë për kafen, të hënën, robotët, afatet në përgjithësi.
4. Nuk thotë shifra financiare (fatura, pagesa, fitim) në kanal grupi — vetëm në
   DM, dhe vetëm nëse pyetësi ka rolin (claim `roles` Admin/Manager).
5. Nuk vendos dhe nuk ndryshon asgjë vetë (faza 1–3 janë read-only). Kur do të
   mund të veprojë (faza 4), çdo veprim ka buton konfirmimi nga njeriu.
6. Nuk shkruan jashtë orarit (quiet hours) dhe respekton DND-në e secilit.
7. Nuk e ngacmon dikë që ka bërë opt-out ("Nazmije, mos më përmend").

---

## 2. Tre mënyra ndërveprimi

| Mënyra | Shkas | Ku përgjigjet | Motor |
|---|---|---|---|
| **Reaktive** | DM te Nazmija, ose `@Nazmije …` në një grup | Në të njëjtën bisedë | `POST /api/email?type=nazmije` (sinkron, nga ChatView pas dërgimit) |
| **Me orar** | 08:45 plani i ditës · 16:00 "ku jemi" + kujtesë raporti · e premte 16:30 përmbledhja e javës | Kanali i zgjedhur i grupit | Cron në VPS (`scheduleDailyInZone`), **jo** në `run-all` |
| **Nga ngjarje** | Detyrë e madhe u mbyll, lead u fitua, projekt mbaroi, 3 ditë pa raport | Grup (lajme të mira) ose DM (kujtesa) | Veprim i ri `nazmije_post` në motorin e automatizimeve CRM + hooks në cron-et ekzistuese |

"Here pas here" = me orar + nga ngjarje. Të dyja kalojnë nga **i njëjti gate**
(`nazmijeBlockReason`, §3.5) dhe i njëjti shkrues (`postAsNazmije`, §3.2).

---

## 3. Arkitektura

### 3.1 Identiteti — një uid i rezervuar, pa llogari Auth DHE pa rresht `teamMembers`

`NAZMIJE_UID = 'nazmije'` (`core.ts`). **Vendimi i ndërtimit (ndryshe nga plani):**
ajo NUK merr rresht në `teamMembers`. Një rresht i tillë do të binte në numërimin e
vendeve (seats), te pagat, te `daily-report-check` ("Nazmija s'dorëzoi raportin"),
te Momentum dhe në çdo picker caktimi — një listë kurthesh që s'mbaron kurrë. Në
vend të kësaj, kur Admini e aktivizon, serveri krijon vetëm:

- `userProfiles/nazmije_{bid}`: `{ userId: 'nazmije', displayName, avatarUrl:
  '/nazmije.svg', jobTitle: 'Sekretare virtuale', businessId, isBot: true }` —
  emri/avatari për çdo sipërfaqe chat-i (koleksioni është i izoluar për biznes);
- grupin "Zyra" me gjithë anëtarët aktivë + `'nazmije'` në `members` (ose shton
  `'nazmije'` te grupi që zgjodhi Admini) → `teamSettings.nazmije.channelId`.

ChatView e shton **me dorë** (kur `teamSettings.nazmije.enabled`): në cache-in e
emrave, te `otherMembers` (DM search, @mention picker, anëtar grupi), te lista e
unifikuar e DM-ve (gjithmonë "online"). `notifyUser()` kthen `skipped: 'bot'` për
`userId === 'nazmije'` (fan-out-i i grupit nuk logon gabim), dhe ChatView s'i dërgon
kurrë notifikim mention-i. `TeamMember.isBot` ekziston në tip vetëm si mbrojtje
për lexuesit (asnjë rresht i tillë nuk shkruhet sot).

Rregullat: asnjë ndryshim. `messages.create` kërkon `senderId == uid`, kështu askush
nuk "bëhet Nazmije" nga browser-i; rreshtat e saj mbajnë `businessId` (lexohen nga
anëtarët e biznesit) ose `receiverId` (lexohen nga marrësi).

### 3.2 Shkruesi i vetëm: `postAsNazmije()`

`api/_nazmije.ts` → `postAsNazmije({ businessId, teamId, channelId | directUserId,
content, kind })` shkruan `messages` me `senderId: 'nazmije'`, `botId: 'nazmije'`,
`nazmijeKind: 'reply' | 'morning' | 'afternoon' | 'weekly' | 'event'`,
`createdByUserId: null`, dhe bën fan-out me `notifyUser` (DM → `direct_message`,
grup → `channel_message`) saktësisht si `api/_chatScheduled.ts` (kopjo atë
model, mos shpik të ri). `botId` është ajo që i lejon UI-së të vendosë badge-in
"🤖 Asistente" dhe analitikës së chat-it ta përjashtojë.

### 3.3 Faktet — Nazmija lexon, nuk mendon

`api/_nazmijeFacts.ts` → `buildFacts(businessId, askerUid, askerRoles)` kthen një
JSON kompakt (≤ ~6 KB) i cili është E VETMJA gjë që modeli di për tenant-in:

- detyrat: me afat sot / të vonuara / të mbyllura sot, për person (max 300 rreshta,
  `where businessId` + `status != Done`, `limit`) — rregulli i kostos: asnjë
  lexim i pafiltruar;
- projektet aktive: progres (detyra done/total), afati, përgjegjësi, `billingLastBlock`;
- raportet ditore: kush e ka dorëzuar sot, kush jo (`dailyReports` për datën);
- Momentum: pikët e javës (`src/lib/productivity/momentum.ts` → kopje e pastër
  në api ose vetëm shifrat e ruajtura);
- lead-et: të reja sot, "Pa hap tjetër" (`needsNextStep`), fituara këtë javë;
- **vetëm për Admin/Manager dhe vetëm në DM**: fatura të vonuara (count + shumë),
  arkëtimet e muajit, periudha të anashkaluara (`billingPeriodsSkipped`).

Faktet filtrohen sipas ROLIT të pyetësit **para** se të hyjnë në prompt: një
Member nuk merr fakte financiare fare, kështu modeli s'ka çfarë të rrjedhë.
Logjika "cilat fakte i takojnë cilit rol" është e pastër dhe e testuar
(`src/lib/nazmije/facts.ts` + kopje byte-identike `api/_nazmijeFactsCore.ts`,
test si `_hostingEngine`).

### 3.4 Rruga reaktive

1. ChatView: **DM-ja te Nazmija kalon e tëra nga serveri** (`askNazmije({ text })`):
   rregullat s'mund të provojnë që `receiverId: 'nazmije'` është "përdorues i
   tenant-it tim" (s'ka `users/nazmije`, s'ka `teamMembers/{tid}_nazmije`), prandaj
   `api/_nazmije.ts` shkruan edhe rreshtin e personit (`senderId: uid`) edhe
   përgjigjen. Një `@Nazmije` në grup shkruhet nga browser-i si zakonisht dhe
   vetëm përgjigjja kërkohet (`askNazmije({ messageId })`). "Nazmija po shkruan…"
   vjen nga `typingIndicators/<key>__nazmije` që serveri e krijon/fshin.
2. Serveri (`api/_nazmije.ts`): `authenticate` → ngarkon mesazhin → verifikon
   `senderId == uid` dhe `businessId == bid` (asnjë id nga body nuk besohet) →
   `nazmijeBlockReason` → `buildFacts` → 10 mesazhet e fundit të bisedës si
   kontekst → `generateChatWith(resolveAiConfig(teamId))` me `SYSTEM_PROMPT` e
   personazhit + faktet → `postAsNazmije({ kind: 'reply' })`.
3. Rate limit: `checkPersistentRateLimit('nazmije', uid, 20)` për orë, plus
   `nazmijeUsage/{bid}_{YYYY-MM-DD}` ≤ 200 përgjigje/ditë për tenant.
4. Gabimi i provider-it kalon nga `classifyAiError` — Nazmija përgjigjet
   "Më fal, më iku kafja (API). Provo pas pak." dhe logon `detail`.

### 3.5 Gate-i i vetëm: `nazmijeBlockReason()`

Në `src/lib/nazmije/gate.ts` (i pastër, i testuar) + kopje byte-identike në api.
Arsye të emërtuara, kurrë `continue` i heshtur:
`module-off` · `tenant-suspended` · `no-ai-key` · `quiet-hours` · `weekend` ·
`user-opt-out` · `user-dnd` · `channel-missing` · `rate-limited` ·
`daily-cap` · `nothing-to-say` (mëngjes pa detyra = heshtje, jo "s'ka asgjë").
Çdo cron shkruan `teamSettings.nazmije.lastRun = { at, kind, blocked: {...} }`
që paneli i cilësimeve të thotë pse s'foli sot.

### 3.6 Me orar (VPS, `vps/server.ts`)

```
scheduleDailyInZone(CRON_LOCAL_TZ,  8, 45, () => triggerCronJob('nazmije-morning'));
scheduleDailyInZone(CRON_LOCAL_TZ, 16,  0, () => triggerCronJob('nazmije-afternoon'));
scheduleDailyInZone(CRON_LOCAL_TZ, 16, 30, () => triggerCronJob('nazmije-weekly'));  // vetëm e premte
```

Të tre janë `SCOPED_JOBS` (manual = vetëm `bid` i thirrësit), kalojnë çdo tenant
me `nazmije.enabled` (query `teamSettings where nazmije.enabled == true`, jo skan),
anashkalojnë `status == 'suspended'`, dhe janë idempotentë për ditë:
`nazmijePosts/{bid}_{date}_{kind}` me `create()` — dy VPS të nisur gabimisht
(rasti i 14 shtatorit) nuk japin dy "mirëmëngjes".

Përmbajtja e postimeve me orar NUK kalon domosdoshmërisht nga AI: skeleti
(numra, emra, lista) ndërtohet nga templates deterministe në
`src/lib/nazmije/digests.ts` (i testuar — shifrat janë gjithmonë të sakta);
AI-ja vetëm e "vesh" me zërin e saj (opsion `tone: 'template' | 'ai'`; pa çelës
AI → template i pastër, moduli punon prapë).

### 3.7 Nga ngjarje

- Veprim i ri `nazmije_post` në motorin e automatizimeve CRM
  (`src/lib/crm/automationRules.ts` + kopje api + `executeAction`): pronari bën
  rregulla "lead → Won ⇒ Nazmija uron në grup". Zero logjikë e re për shkas/idempotencë —
  e ka `crmAutomationRuns`.
- Hooks në cron-et ekzistuese (opsionale, pas vlerësimit të zhurmës):
  `daily-report-check` stage=remind → DM nga Nazmija në vend të notifikimit të
  thatë; `task-deadline-alerts` → një rresht i saj në grup për detyrat e sotme.
  Rregull: një hook zëvendëson një notifikim ekzistues, nuk e dyfishon.

### 3.8 Humori — dy nivele, një bankë

`src/lib/nazmije/humor.ts`: ~50 rreshta të kuruar shqip (kafe, e hëna, robotë,
afate, zyrë), me `tags` (`morning`, `friday`, `late-task`, `self`) dhe me ligjin
nr. 3 të zbatuar në kod (asnjë rresht nuk merr emër personi si parametër).
- `humor: 'off'` — zero shaka;
- `humor: 'light'` (default) — vetëm nga banka, max 1 në ditë në grup, kurrë në DM
  kujtese;
- `humor: 'full'` — AI gjeneron brenda rregullave, por **vetëm** në kanalin e grupit
  dhe vetëm `kind: morning | weekly`.

### 3.9 Cilësimet (Cilësimet → **Nazmija**, `NazmijeSettingsPanel`)

`teamSettings.nazmije`: `{ enabled, channelId, humor, morningAt: '08:45',
afternoonAt: '16:00', weeklyDigest: true, eventPosts: true, quietHours:
{ from: '18:00', to: '08:00' }, workDays: [1..5], dmAllowed: true, lastRun }`.
Vetëm pronari/Admin e ndryshon (rregulla ekzistuese e `teamSettings`).
Per-person: `userPreferences.nazmijeOptOut: boolean` (butoni "Mos më përmend" në
profilin e Nazmijes). Preview i personazhit (emri, avatari, 3 shembuj) në panel.

---

## 4. Fazat

| Faza | Çfarë | Skedarë | Vlerësim |
|---|---|---|---|
| **0 — Personazhi** ✅ | Prompt-i, 46 thënie, 28 rreshta humori, avatari SVG; thënia e ditës në StaffDashboard | `src/lib/nazmije/core.ts`, `static/nazmije.svg`, `StaffDashboard.tsx` | bërë |
| **1 — Reaktive** ✅ | `enable` (profil + grup + hello), `@Nazmije` + DM, faktet read-only sipas rolit, badge "Asistente", paneli i cilësimeve, opt-out | `api/_nazmije.ts`, `email.ts` + rewrite, ChatView, `NazmijeSettingsPanel`, `_push.ts` | bërë |
| **2 — Me orar** ✅ | Tri cron-et, digests deterministe, orë të qeta/ditë pune, `lastRun` në panel, humor AI vetëm në `full` | `api/cron/run.ts`, `vps/server.ts`, core | bërë |
| **3 — Nga ngjarje** | Veprimi `nazmije_post`, hook-u i raportit ditor | motori i automatizimeve + `_crmAutomationJob.ts`, `daily-report-check` | 1–2 ditë |
| **4 — Veprime (opsionale)** | "Nazmije, krijo detyrë për Benin deri të enjten" → kartë konfirmimi në chat → shkrim nga serveri me `createdByUserId: uid i pyetësit`; "Nazmije, kujtoje Elën në 15:00" → `taskReminders`; "Nazmije, çfarë bëra javën e kaluar" → nga `timeEntries` | `_nazmijeActions.ts`, kartë `NazmijeActionCard` në ChatView | 3 ditë |

Faza 4 kërkon vendim të veçantë: deri atëherë Nazmija s'shkruan asnjë dokument
përveç `messages`.

---

## 5. Teste dhe deploy

- Unit: `gate.test.ts` (çdo arsye), `facts.test.ts` (filtrimi sipas rolit — një
  Member nuk sheh kurrë fusha financiare), `digests.test.ts` (shifrat), `humor.test.ts`
  (asnjë rresht me placeholder emri), testi byte-identik api/src.
- Rules: asnjë rregull i ri; një test negativ që `senderId: 'nazmije'` nga browser
  refuzohet (duhet të dalë PASS tashmë).
- Deploy: `npm run typecheck:api` = 0; indeks `teamSettings (nazmije.enabled)`
  nëse query-ja e kërkon; VPS restart për cron-et; aktivizimi te tenant-i i parë
  (fivo.al) me `humor: 'light'` për një javë para se ta hapim për të tjerët.

---

## 6. Rreziqe & vendime të hapura

1. **Zhurma.** Tre postime në ditë + ngjarje mund të bëhen "mute". Mbrojtja:
   `nothing-to-say` në gate, max 1 shaka/ditë, çdo postim me orar i çaktivizueshëm
   veçmas. Matet: nëse >30 % e stafit bën opt-out, ulim default-in në 1 postim/ditë.
2. **Kostoja AI.** Përgjigjet reaktive ~1–2 k token secila; 200/ditë/tenant ≈ brenda
   buxhetit të një çelësi tenant-i. Postimet me orar s'kanë nevojë për AI (template).
   Çelësi i platformës përdoret vetëm për staf me `bid` (ligji i `ai-chat`).
3. **Privatësia.** Faktet për personin X (vonesa, raporte të munguara) shkojnë
   vetëm në DM te X ose te menaxheri i tij, kurrë në grup me emër — përveç listës
   neutrale "kush ka detyra sot". Shakatë kurrë me emër.
4. **Vendim i hapur:** Nazmija "kujton" preferenca (p.sh. "Beni do përgjigje të
   shkurtra") në `nazmijeMemory/{bid}`? Propozim: JO në fazat 1–3; e rishikojmë pas
   fazës 4 me opt-in për person.
5. **Vendim i hapur:** një Nazmije për platformë apo emër i personalizueshëm për
   tenant (`displayName` i ndryshueshëm, personazhi i njëjtë)? Propozim: emri i
   ndryshueshëm që nga faza 1 — kushton një fushë, dhe disa tenant-ë do ta duan.
