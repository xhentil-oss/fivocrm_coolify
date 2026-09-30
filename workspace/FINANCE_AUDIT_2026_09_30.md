# Audit i financave — 30 Shtator 2026

Pesë agjentë lexuan: motorët e pastër (`src/lib/finance/*`), faturimin periodik
(dy motorët + pasqyra në `api/cron/run.ts`), faturat/pagesat/Stripe/WHMCS, UI-në
e Financave/Shpenzimeve, dhe rregullat/cron-in server-side. Pikënisja: 436/436
teste kalonin, `typecheck:api` 0 gabime, të katër kopjet e pasqyruara në `api/`
byte-identike. Pra bug-et janë në atë që testet **nuk** mbulojnë.

Statusi i çdo gjetjeje është në §4. Skripti diagnostik: §3.

---

## 1. Gjetjet

### 1.1 Të rënda

| # | Ku | Çfarë | Pasoja |
|---|---|---|---|
| H1 | `firestore.rules` `counters/{docId}` | Klienti shkruan `counters/invoices_{businessId}`, rregulli e trajton id-në si teamId (`businessOfTeam(businessId)` → bosh) | Çdo staf jo-super-admin refuzohet → fallback jo-atomik `FAT-max+1` → numra dublikatë; te ProjectsView s'ka `catch` → fatura e parë e retainer-it + pretendimi i periudhës nuk shkruhen |
| H2 | `api/stripe-webhook.ts` ~337 | Pagesa Stripe për faturë WHMCS dërgohet direkt, jo përmes radhës `whmcsPendingPayments` | Nëse WHMCS dështon, `upsertInvoice` e rikthen faturën në `Pending, paidAt: null` natën; portali e ofron prapë për pagesë |
| H3 | `laborAllocation.ts` + konsumatorët | `unabsorbed = payroll − absorbed − internal.cost`, por projectPnl/departmentPnl/clientProfitability fusin në pool vetëm `unabsorbed` | Orët pa projekt (dhe orët në projekte jashtë periudhës/arkivuara) s'janë në asnjë shifër; teksti i UI-së thotë të kundërtën |
| H4 | `FinancesView` + `ClientProfitabilityPanel` | "Mbyll muajin" shfaqet edhe për muajin që po ecën | Një klik më 10-shin bllokon çdo orë stafi deri në fund të muajit; snapshot 10-ditor; s'ka rihapje |
| H5 | `api/cron/run.ts` `runRecurringExpenses` | Backfill një periudhë për natë kur `nextRecurringDate` është pas (pauzë→rifillim), `.add()` me id të rastësishme, s'lexon `financeMonthCloses` | Rishkruan muaj të mbyllur; dy ekzekutime paralele = dy rreshta |

### 1.2 Mesatare

- **M1** `run.ts:2346` ankora e shpenzimit nga `nextDate.getDate()` (UTC) — data e picker-it (22:00Z dje) i jep serisë së 1-shit ankorën 30/31, përgjithmonë.
- **M2** `InvoicesView` ~3163 — afati i plotësuar automatikisht bëhet ankora e serisë; net-30 nga 31 jan → next 2 mars, shkurti s'faturohet kurrë.
- **M3** `firestore.rules` `invoices` update — çdo anëtar jo-Viewer shkruan `status: 'Paid'`, `paidAt`, `total`, `payments`; te `projects` shkruan `spent/laborCost/budgetAlertsSent`.
- **M4** `expenseIsCountable` përjashton vetëm `Rejected` — një `Salary` 5M "Submitted" nga një anëtar e kalon payroll-in e muajit në bazë "recorded".
- **M5** Bllokimi i muajit te `timeEntries` lexon vetëm `date`; motorët lexojnë `startTime` së pari — rresht pa `date` ose me `startTime` në muaj tjetër anashkalon bllokimin.
- **M6** Stripe pas një kësti të sinkronizuar s'shkon në WHMCS (`whmcsPaymentSyncedAt` vendoset nga çdo kësti).
- **M7** Pagesë Stripe me shumë ≠ total: para të marra, asnjë rresht `payments`, portali ofron pagesë të plotë prapë, ri-njofton në çdo redelivery.
- **M8** Anulimi/rikthimi i një fature të paguar lë rreshtat e `payments` → Arkëtimet ≠ Financat.
- **M9** EAC dhe `consumedPct` në tabelën e klientëve relative ndaj periudhës, jo ndaj angazhimit (muaj pa orë + shpenzim → EAC 99 %).
- **M10** Retainer-i njeh të ardhurat për gjithë muajin, kostoja deri sot → marzhi 95 % më 2-shin, 60 % më 30-in.
- **M11** Snapshot-i i mbylljes s'lexohet askund; etiketa "Muaj i mbyllur" pranë numrave live.
- **M12** Alarmet e buxhetit 70/85/100 në kaskadë të përmbysur pas kërcimi (🔴 → 🟠 105 % → 🟡 105 %).
- **M13** `invoice-reminders` kthen `Partial` në `Overdue`; `overdue-reminders` premton të kundërtën.
- **M14** `before-billing-day` në cron llogaritet me `now.getDate()` (zona e makinës), jo Europe/Tirane.
- **M15** `departmentPnl` hedh gjithë pool-in kur të ardhurat = 0.
- **M16** Njoftimet e webhook-ut (pagesë dyfishe, mismatch, refund) shkojnë askund për `createdByUserId: null` (çdo faturë WHMCS/hosting/cron).
- **M17** Cancelled nga drawer/formulari te faturë WHMCS ringjallet nga sync-u (vetëm `handleDeleteInvoice` vendos `locallyCancelled`).
- **M18** `financeMonthCloses` shkruhet edhe nga Manager (doku thotë Admin); update pa `tenantActive()`.
- **M19** Jo-aprovuesi mund të ri-etiketojë `category/projectId/departmentId` te një shpenzim i aprovuar (vetëm shuma/data janë të pinuara).

### 1.3 Të lehta

Formulari i projektit s'pastron dot `billingDayOfMonth` (`undefined` hiqet); editimi i shpenzimit s'respekton ditën e re të zgjedhur; seri vjetore 29 shkurt → 1 mars; PDF-ja e portalit pa zbritje, butoni i pagesës pa `Partial`; `now` ngrin në mount te FinancesView; `confirmClose` pa toast gabimi; ri-mbyllja mbishkruan `reopenedAt`; pika e trend-it ≠ hero për muajin aktual; kësti pa `paidAt` humbet nga cash-i mujor; rreshtat >12 orë të raportit ditor bien në ditën e mëparshme; `StaffDashboard` mbledh EUR+ALL pa `toAll`; data e pagesës në WHMCS dërgohet UTC; `subscription.updated` mbi tenant të pezulluar e rihap; numri i Part 1 me zonën e makinës; kolizion id `hst_upg_<sub>_<day>` kur e para u anulua; `counters` pa mbrojtje monotonike (test 68c pohon që reset-i kalon); pause/resume i faturës dhe ri-aktivizimi i projektit ngrenë alarme false "N periudhë pa faturë"; `wasRecurringBeforeArchive` mbetet edhe pas `series-ended`; kurset e monedhës nga `localStorage` para settings.

### 1.4 Çfarë rezultoi në rregull

Përjashtimi i pagave nga çdo total shpenzimesh; `toAll` në çdo shumë; mbrojtja nga pjesëtimi me zero; çelësat e periudhës + `create()` + ALREADY_EXISTS në të dy motorët e faturave (asnjë email dyfish); përjashtimi i tenantëve të pezulluar; scoping i ekzekutimeve manuale; checkout/webhook Stripe (nënshkrim, shumë, idempotencë); tri shtigjet manuale "Paguar" me radhën WHMCS; kaskada e fshirjes; arkivimi/rikthimi; totalet e faturës në një funksion; `getInvoiceOutstandingAll`; period-key W/M/Q/Y identike UI↔cron; pasqyrat byte-identike.

---

## 2. Pse s'u prenë faturat e 25 shtatorit (analizë nga kodi)

Leximi i të dhënave live nuk u lejua në këtë sesion, kështu që më poshtë janë
shkaqet e mundshme **të verifikuara në kod**, të renditura sipas gjasës, dhe
skripti që i dallon (§3).

### 2.1 Si punon

`runRecurringInvoices` Part 2 (`api/cron/run.ts` ~1872) ekzekutohet vetëm brenda
`run-all`, që VPS-ja e thërret **një herë në ditë në 08:00 UTC** (10:00 Tiranë).
Për çdo projekt `isRecurring` vlerëson `projectBillingBlockReason`; retainer-i
me `billingDayOfMonth: 25` merr `before-billing-day` deri më 24, dhe më 25 duhet
të krijojë `invoices/auto_<projectId>_2026-09`.

### 2.2 Shkaqet e mundshme

1. **Run-all u vra nga Vercel para se Part 2 të arrinte projektet.** `run-all`
   ekzekuton **27 punë njëherësh** (`Promise.allSettled`) brenda **një** thirrjeje
   me `maxDuration: 60`. `project-spend-rollup` vetëm ka buxhet 45 s; `whmcs-sync`,
   `digest`, fushatat lexojnë shumë. Kur funksioni vritet, s'ka përgjigje, VPS-ja
   logon `dështoi`/HTTP 504, dhe në `platformJobRuns` **s'ka rresht fare** për atë
   ditë (regjistrimi bëhet në fund). Nesër (26-i) periudha `2026-09` ende s'është
   pretenduar → faturohet me vonesë, nëse run-all e nesërm mbijeton.
2. **Part 1 hodhi gabim dhe vrau Part 2.** Të dyja janë në një funksion; një
   `create()` që dështon me gabim ≠ ALREADY_EXISTS (`throw err`, ~1717), një gabim
   SMTP, ose RESOURCE_EXHAUSTED i Firestore-it e refuzon gjithë `runRecurringInvoices`.
   `run-all` prapë regjistrohet `ok: true`, dhe meqë `recordJobRun` ruan **vetëm
   vlera skalare**, objekti `recurringInvoices: { error }` **hidhet poshtë** — historia
   s'e tregon kurrë.
3. **Periudha `2026-09` ishte pretenduar që para 25-ës.** ProjectsView krijon faturën
   e parë **në momentin e krijimit** të projektit dhe stampon `lastInvoicePeriodKey =
   periudha e sotme` (~432-482). Një retainer i krijuar/ri-krijuar në shtator (p.sh.
   për t'i vënë ditën 25) e ka shtatorin "already-billed" nga fatura e krijimit;
   faturimi i parë automatik do jetë 25 tetor. Po ashtu ndryshimi i frekuencës në
   editim ri-shpreh pretendimin (~801-809).
4. **`billingType: 'one-time'` + `isRecurring: true`.** Blloku `one-time` nuk fik
   serinë por s'faturon dhe dërgon njoftim `recurring_project_billing_misconfigured`
   një herë në muaj te `responsibleUserId || createdByUserId`. Kontrollo zilen.
5. **Buxheti 0** (retainer i çmuar vetëm me shërbime): njoftim
   `recurring_project_no_budget`, asnjë faturë.
6. **Tenant `status: 'suspended'`** (cron-i `subscription-lifecycle` pezullon pas
   provës + 7 ditë kur s'ka Stripe): e gjithë faturimi kapërcehet. Do ta vëreje
   nga `SubscriptionGate`, ndaj pak e mundshme.
7. **VPS-ja s'e thirri run-all** (pm2 poshtë, `CRM_BASE_URL`/`CRON_SECRET` gabim →
   401 në log). Shenja: asnjë rresht run-all në `platformJobRuns` për disa ditë.

Zona e kohës **nuk** është shkaku për 25-ën: run-all në 08:00 UTC → `getDate()` = 25.

### 2.3 Çfarë u rregullua që të mos përsëritet pa gjurmë

- Part 1 dhe Part 2 të izoluara (gabimi i njërës nuk e ndal tjetrën; `part1Error`/`part2Error` në rezultat).
- `recordJobRun` ruan përmbledhjet e nën-punëve (`recurringInvoices.legacyCreated`, `.blockedReasons.*`, `.error`).
- Çdo projekt periodik mban `billingLastCheckedAt` + `billingLastBlock` (shkruhet vetëm kur ndryshon) dhe paneli Faturimi i projektit e tregon ("Kontrolli i fundit: … — Pret ditën e faturimit (25)").
- `before-billing-day` në Europe/Tirane në të dy kopjet.
- Fallback i numëratorit me paralajmërim dhe `catch` te ProjectsView (rrënja: rregulli i `counters`).

Ajo që mbetet strukturore dhe **nuk** u ndryshua këtu: run-all si një thirrje 60 s
me 27 punë. Zgjidhja e duhur është ta ndash `recurring-invoices` (dhe punët e tjera
të parave) në thirrje më vete nga VPS-ja (`scheduleDailyInZone`), si `task-reminders`.
Shih TODO.

---

## 3. Skripti diagnostik (vetëm-lexim)

```
node scripts/audit-retainer-billing.mjs --at=2026-09-25T08:00:00Z
node scripts/audit-retainer-billing.mjs            # gjendja tani
node scripts/audit-recurring-billing.mjs           # boshllëqe muaj-për-muaj
```

Printon për çdo retainer fushat që motori lexon dhe arsyen e bllokimit në atë çast,
faturat automatike me `billingPeriodKey=2026-09`, dhe rreshtat e `platformJobRuns`
±3 ditë. Leximi: **asnjë rresht run-all më 25** → shkaku 1 ose 7 (shiko `pm2 logs`);
**run-all ok pa `recurringInvoices.*`** → shkaku 2 (para rregullimit s'ruhej);
**`already-billed`** → shkaku 3; **`one-time`/`zero-budget`** → 4/5.

---

## 4. Statusi i rregullimeve

**Të gjitha gjetjet e §1 u rregulluan në të njëjtin sesion** (5 agjentë paralelë me
pronësi të ndarë skedarësh + gating i UI-së). Përmbledhje sipas zone:

| Zona | Skedarët kryesorë | Çfarë u bë |
|---|---|---|
| Rregulla | `firestore.rules`, `scripts/firestore-rules.test.mjs` (169 → 178 teste) | `counters` sipas businessId + monotonik; settlement Admin/Manager (`invoiceSettlementAllowed`, `payments`); fushat e rollup-it të projektit cron-only; `timeEntries.date` i detyrueshëm `YYYY-MM-DD`; `financeMonthCloses` Admin/owner + `tenantActive` në update; shpenzime: `category/projectId/departmentId` të pinuara, `Salary` vetëm aprovues |
| Server | `api/cron/run.ts`, `api/stripe-webhook.ts`, `api/_whmcs.ts`, `api/_hostingJobs.ts`, `api/_profitabilityCore.ts` | Part 1/Part 2 të izoluara; `before-billing-day` zoned; `billingLastBlock` në projekt; `recordJobRun` i sheshuar; shpenzime periodike: id determinist + `create()`, vetëm periudha aktuale, `stale-period`/`month-closed`, ankorë zoned, vjetore e klampuar; `Partial` s'bëhet `Overdue`; alarmet e buxhetit pa kaskadë; Stripe→WHMCS përmes radhës, dedupe për çelës, mismatch i kontabilizuar, njoftim owner/menaxherëve, `suspended` mbetet; data WHMCS lokale; kolizion id upgrade |
| Motorët | `laborAllocation`, `projectPnl`, `departmentPnl`, `clientProfitability`, `projectPeriod`, `financialAnalytics`, `timeEntries`, `recurringExpenses` (426 → 482 teste) | orët pa rresht → pool; EAC/consumedPct gjithë-kohore; retainer i proratuar në periudhë të prerë; pool i departamentit me ndarje të barabartë; kësti pa `paidAt`; `date` = dita e regjistrimit; vjetore 29 shkurt; `stale-period` |
| Financat/Shpenzimet | `FinancesView`, `ExpensesView`, `MonthCloseDialog`, `ClientProfitabilityPanel`, `monthClose.ts` (i ri) | mbyllje vetëm pas fundit të muajit; rihapje; snapshot i shfaqur + drift; toast gabimi; `now` tik-tak; trend = hero; pause→resume ri-vendos datën; ankora sipas datës së ndryshuar; `toAll` te StaffDashboard; dedupe monedhe te PaymentsView |
| Faturat/Projektet | `InvoicesView`, `ProjectsView`, `ProjectDetailView`, `PortalInvoicesView`, `recurringInvoices.ts`, `invoiceStatus.ts` (i ri), `projectArchive.ts` | fallback numëratori me paralajmërim + `catch`; afati s'bëhet ankorë; rikthimi i Paguar pastron ledger-in; `locallyCancelled`; PDF me zbritje + `Partial`; `billingDayOfMonth: null`; resume ri-drejton pretendimin; `series-ended` s'ringjallet; "Kontrolli i fundit" në Faturimi; statuset e settlement-it të fshehura për anëtarët |
| VPS | `vps/server.ts` | `recurring-invoices` 07:00 + `recurring-expenses` 07:10 Tiranë, jashtë run-all |

**Mbetet për operatorin** (shih TODO): deploy i rregullave, push në main, `pm2 restart`
në VPS, dhe ekzekutimi i `scripts/audit-retainer-billing.mjs --at=2026-09-25T08:00:00Z`
për të konfirmuar shkakun konkret të 25 shtatorit dhe për t'i faturuar me dorë
periudhat që raportohen si të kapërcyera.

**U la qëllimisht**: ndarja e run-all në thirrje më vete për çdo punë (u shtuan vetëm
dy punët e parave); `financeMonthCloses.snapshot` i lexueshëm nga çdo anëtar biznesi
(rreshti i një klienti me një person zbulon pagën e tij të ngarkuar — lidhet me TODO-n
e `teamMemberComp`); kurset e monedhës nga `localStorage` para se të vijnë settings.
