# Client & Project Profitability — runbook (Sep 2026)

**Pyetja që përgjigjet:** "Sa fitoj realisht nga çdo klient, sa më kushton çdo rol
(Graphic Designer, SMM, fotograf, PM), ku po konsumoj kapacitet pa fituar, dhe cili
projekt shkon drejt humbjes para se të mbarojë."

## Modeli (vendosur me pronarin, 2026-09-21)

| Hapi | Rregulli | Ku jeton |
|---|---|---|
| Kosto/orë e personit | `paga × (1 + kontributet e punëdhënësit) ÷ kapaciteti praktik për klientë` (default 16.7 %, 120 h — **jo 176 h**). `hourlyCostRate` = mbivendosje. Paga sipas historikut të muajit. | `profitabilityCore.costRateFor`, `costRates.memberCostRate` |
| Punë direkte | `orë të regjistruara × kosto/orë`, për projekt, për rol, për person | `laborAllocation.allocateLabor` |
| **Invarianti** | `absorbed + internal + unabsorbed == payrollBetween().total`. Pagat që orët nuk mbulojnë (bench, mbledhje, pa orë) shkojnë në overhead, kurrë s'humbin. Orë × tarifa > paga reale → `overAbsorbed` (tarifat janë gabim), jo humbje fantazmë. | `laborAllocation` |
| Të ardhura të FITUARA | retainer: tarifa × muaj; projekt fiks: `kontratë × min(1, orë deri sot / orë në mbyllje)` (POC me orë); pa plan por me data: lineare; asgjë: në muajin e mbylljes (legacy). Tejkalimi kurrë s'rrit të ardhurën. | `revenueRecognition`, `profitabilityCore.earnedCumulative` |
| Katër shifra | Contract Value ≠ Revenue Earned ≠ Invoiced ≠ Cash Collected. `unbilledEarned` = fituar − faturuar; `deferred` = faturuar − fituar. | `revenueRecognition.projectWip` |
| Tre nivele fitimi | Të ardhura − pass-through = AGI; − punë − kosto direkte = **BRUTO** (shifra e vendimit: 🟢 ≥55 % · 🟡 ≥40 % · 🔴); − overhead = **NETO** | `clientProfitability` |
| Overhead | `shpenzime pa projekt + punë e paabsorbuar`, ndarë sipas **orëve të punës** (ose të ardhurave, cilësim). Klienti që konsumon ekipin mban overhead-in. | `clientProfitability`, `projectPnl`/`departmentPnl` me `opts.labor` |
| Plan vs real | Buxhet orësh për rol × kosto/orë (snapshot) + kosto direkte → çmim = kosto/(1−marzh). Alarme 70/85/100 % (një herë secila). EAC = kosto deri sot + orë të mbetura × mesatare. | `projectBudget`, cron `project-spend-rollup` |
| Kapaciteti | utilizim = orë klientësh ÷ kapacitet praktik; nën 60 % i lirë, mbi 85 % i mbingarkuar | `capacity` |
| Kategori klienti | A–D = marzh × fërkim (L/orë ndaj mesatares) | `profitabilityCore.classifyClient` |

**Pasqyra në server:** `api/_profitabilityCore.ts` është kopje byte-identike e
`src/lib/finance/profitabilityCore.ts` (`profitabilityCore.test.ts` e detyron). Vetëm
bërthama pasqyrohet — motorët me tipe (allocation, recognition, client table) rrinë në
browser; cron-i lexon fakte dhe ekzekuton, nuk vendos.

**Basis gjithmonë i shfaqur:** pa orë në periudhë → `basis: 'none'`, tabela thotë
"vlerësim", `projectPnl`/`departmentPnl` kthehen te rregulli i vjetër (`laborBasis: 'legacy'`).
Ligji i payroll-it: një fallback i heshtur duket si bug.

## Ku futen orët (tre rrugë, një formë të dhënash)

1. **Raporti ditor** — çdo rresht detyre ka `hours`; në submit bëhen `timeEntries` me id
   `${uid}_${taskId}_${date}` (`source: 'daily-report'`, ri-dorëzimi përditëson, s'dyfishon).
   `timeEntries.timeEntriesFromOutcomes`.
2. **Orët e mia** (`/app/timesheet`, modul `timesheet`, leje `canAccessTasks`) — grid javor
   projekte × ditë, klik në qelizë → `TimeLogDialog` (Klient → Projekt → Detyrë → Orë).
   Menaxheri: pamja e ekipit me "ditë pune pa orë". Lexim server-side me `teamScopedWhere`
   → indekse `timeEntries (businessId, userId, date)` dhe `(businessId, date)`.
3. **Timer-i** (TaskDetailPanel) dhe **Focus** — tani shkruajnë `customerId`, `date`,
   `source`, `isBillable` sipas projektit (para: `isBillable: false` i fiksuar → utilizim 0).

Çdo hyrje: `date` (dita lokale Europe/Tirane), `costRole` (nga anëtari), `customerId`
(nga projekti). Rules: shkruaj vetëm orët e mia (admin/menaxher të gjithëve), asgjë në
muaj të mbyllur (`monthLockedFor`), test 55a–55c.

## Mbyllja e muajit

Financat → Fitimi (tabela e klientëve) → **Mbyll muajin** (Admin): `monthCloseChecks()` liston çka mungon
(orë 0, persona pa pagë, projekte pa plan, fatura pa projekt, orë × tarifa > pagë, paga nga
plani) → `financeMonthCloses/{businessId}_{YYYY-MM}` me `locked: true` + snapshot i tabelës
+ warnings e pranuara. Pas kësaj orët e muajit janë read-only (rules + UI 🔒). Rihapja =
update `locked: false` + `reopenedAt`; fshirja e ndaluar.

## Cron

- `project-spend-rollup` (ekzistues): tarifat nga bërthama me `financeSettings`/`rateCard`
  të ekipit, shkruan `hoursByRole`, dhe **alarmet e buxhetit** 70/85/100 % → `notifyUser`
  te përgjegjësi (+ menaxherët në 100 %), tip `project_budget_alert`, një herë për prag
  (`budgetAlertsSent`). Projektet terminale s'alarmohen.
- `client-profitability-report` (i ri): dita 2, 08:05 lokal (`vps/server.ts`,
  `scheduleDailyInZone` + `dayOfMonthInZone`), JO në run-all. Për çdo tenant aktiv: ditët
  pa orë për person, projektet fikse me orë pa plan, dhe titujt nga snapshot-i i mbylljes
  nëse muaji u mbyll. `notifyUser('client_profitability_report')` te menaxherët, deep-link
  `/app/finances?tab=clients&period=YYYY-M` (M zero-based si `monthOptions`). Idempotent
  `financeReportRuns/{bid}_{period}`. Manual: i skopuar te `bid` i thirrësit.

## Deploy

1. `firebase emulators:exec --only firestore "node --test scripts/firestore-rules.test.mjs"` → `firebase deploy --only firestore:rules`
2. `firebase deploy --only firestore:indexes` (dy indekse të reja `timeEntries`)
3. Vercel: `api/_profitabilityCore.ts` + `api/cron/run.ts` shkojnë me push.
4. VPS: `pm2 restart` që `vps/server.ts` të marrë orarin e ri.
5. Cilësimet → Financat: kontributet, kapaciteti, pragjet, rate card; Ekipet → anëtari:
   roli në rate card + kapaciteti.

## Kufizime të njohura

- FinancesView lexon gjithë `timeEntries` e tenantit client-side (skopim businessId);
  për tenantë me histori shumë të gjatë duhet një dritare `teamScopedWhere`.
- `BonusView` përdor ende peshën e buxhetit të projektit (faza 2 e dokumentit: bonusi
  veçmas, i lidhur me marzhin mbi objektiv + cilësi).
- Njohja "sipas punës" varet nga plani i orëve: pa `plannedRoles` një projekt fiks bie te
  lineare/mbyllje — tabela e thotë (`projectsWithoutPlan`).
- Cron-i i rollup-it koston orët me pagën AKTUALE (jo historikun e muajit) — të
  denormalizuarat `laborCost/spent` janë orientuese; tabela e klientëve (browser) është
  burimi i vërtetë dhe përdor `memberSalaryForMonth`.
