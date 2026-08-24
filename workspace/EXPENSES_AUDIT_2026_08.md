# Expenses module — audit (Gusht 2026)

Full-stack audit i modulit të shpenzimeve dhe i **çdo elementi që lidhet me të**:

| Shtresë | Skedarë të lexuar |
|---|---|
| UI | `src/views/ExpensesView.tsx` (1692 rreshta), `ExpenseForm`, `src/views/FinancesView.tsx`, `src/views/BonusView.tsx`, `src/views/ProjectDetailView.tsx`, `src/views/Customer360View.tsx` |
| Logjikë e pastër | `src/lib/finance/recurringExpenses.ts`, `financialAnalytics.ts`, `projectPnl.ts`, `departmentPnl.ts`, `cashflowAlarms.ts`, `forecast.ts`, `staffRevenue.ts`, `salaryHistory.ts` |
| Server | `api/cron/run.ts` (`runRecurringExpenses`, `runProjectSpendRollup`, `tenant-export/delete`), `api/_merge-contacts.ts` |
| Infra | `firestore.rules`, `firestore.indexes.json`, `src/hooks/useFirestore.ts`, `src/hooks/useRoleFilteredData.ts`, `src/lib/deleteCascade.ts`, `src/lib/projectArchive.ts`, `src/types/index.ts` |

**Baseline në kohën e auditit: 193/193 teste `src/lib/finance` + `FinancesView` jeshile.**
Çdo gjetje më poshtë ndodhet **jashtë** territorit të testuar — në formë, në view, në
cron dhe në rregulla. Tre gjetjet kryesore (#1, #2, #12) u **provuan me test probe**
para se të raportoheshin.

Status: ✅ e riparuar · 📋 e mbetur (arsyeja e dhënë)

**Gjendja pas riparimit:** 1 064 teste vitest jeshile (nga 1 057 — 7 të reja për këto
gjetje), **97/97 teste rregullash në emulator** (nga 93 — katër të reja: 43–46),
`typecheck:api` 0 gabime, `typecheck` app 215 (nga 235 në baseline), `npm run build`
kalon, `cap sync android` i bërë.

---

## Kritike

| # | Gjetje | Status |
|---|---|---|
| 1 | **Nuk ekziston fushë "Data e shpenzimit" në formë.** `ExpenseForm` ofron vetëm *Data e Pagesës* (`paidDate`), *Data e Ardhshme Periodike* dhe *Përsërit deri më*. `handleCreateExpense`/`handleUpdateExpense` **nuk shkruajnë kurrë `date`** (`grep 'date:' ExpensesView.tsx` → 0 rezultate). Meqë `getExpenseDate() = date \|\| createdAt`, çdo shpenzim libërzohet në momentin e futjes në sistem. Pasojë: një faturë e korrikut e futur në gusht hyn në P&L-in e **gushtit** — dhe është e pariparueshme nga UI. Kjo është arsyeja pse ekzistojnë `scripts/backfill-july-expenses.mjs` dhe `scripts/reconcile-july.mjs`. `paidDate` mblidhet nga forma por **asnjë analitikë nuk e lexon** për libërzim. | ✅ |
| 2 | **BonusView e injoron çdo shpenzim të futur manualisht.** I vetmi vend në kodbazë që lexon `e.date` **pa fallback në `createdAt`** (`BonusView.tsx:176` dhe `:190`) — të gjithë të tjerët kalojnë nga `getExpenseDate()`. Kombinuar me #1: `totalOfficeExpenses` është praktikisht **gjithmonë 0** dhe `salaryFromExpenses` gjithmonë bosh, ndaj rroga bie te `monthlySalary` e profilit dhe overhead-i i zyrës nuk alokohet kurrë në bonuse. Vetëm rreshtat e gjeneruar nga cron-i (që *e vendosin* `date`) numërohen. | ✅ |
| 3 | **`departmentId: '__none__'` shkruhet si tekst literal.** `projectId` dhe `memberId` kontrollohen me `!== '__none__'`; `departmentId` **nuk** (`ExpensesView.tsx:115` dhe `:210` → `departmentId \|\| undefined`, ku `'__none__'` është truthy). Rreshti bëhet i pakapshëm në **të dy** anët e filtrit: `departmentFilter === '__none__'` filtron `!e.departmentId` (dhe `'__none__'` është truthy → jashtë), dhe `departmentFilter === <id real>` nuk përputhet. Zhduket nga çdo ndarje sipas departamentit. | ✅ |
| 4 | **Fushat nuk mund të pastrohen — shkëputja nga projekti është e pamundur.** `removeUndefined()` (`useFirestore.ts:562`) heq `undefined` para shkrimit *me dizajn*; vetëm `null` e fshin fushën. `handleUpdateExpense` kthen `projectId`/`memberId`/`description`/`paidDate` në `undefined` kur zgjedh "Asnjë" → shkrimi hiqet, lidhja e vjetër **mbetet**. Pra P&L-i i projektit vazhdon të ngarkohet me shpenzimin edhe pasi ta kesh shkëputur në UI. Fushat periodike janë të sakta (`null` eksplicit) — vetëm këto katër jo. | ✅ |

## Të rënda

| # | Gjetje | Status |
|---|---|---|
| 5 | **Një shpenzim i lidhur me projekt jashtë periudhës avullon nga P&L-i.** Në `projectPnl.ts` cikli mbi shpenzimet ndan `pid ? directByProject : otherFixed`. Nëse projekti nuk është në `periodProjects` (i mbyllur në një vit tjetër, `mode:'completed'`, i arkivuar), `directByProject` merr një çelës që **nuk ka rresht** — dhe shuma nuk shtohet as në `otherFixed`. **Provuar:** 500 ALL shpenzim i marsit 2026 mbi një projekt të mbyllur në 2025 → `totals.directCost = 0`, `fixedPool.otherFixed = 0`. `directCost + otherFixed ≠ shpenzimet e periudhës`. E njëjta strukturë në `departmentPnl.ts:167`. | ✅ |
| 6 | **`ProjectDetailView` numëron shpenzimet e refuzuara dhe pagat.** `budgetStats.expensesTotal` (`ProjectDetailView.tsx:337`) është një `reduce` i thjeshtë **pa** `approvalStatus !== 'Rejected'` dhe **pa** `category !== 'Salary'` — ndërsa `runProjectSpendRollup` (`cron/run.ts:4649-4650`) dhe `projectPnl.directCost` përjashtojnë të dyja. Tre numra të ndryshëm për të njëjtën gjë: faqja e projektit, `project.spent` (Raportet/Customer360) dhe Financat. | ✅ |
| 7 | **`project-spend-rollup` nuk e shikon kurrë një shpenzim të fshirë.** Modaliteti inkremental nxjerr projektet e prekura nga `expenses.updatedAt > lastRunAt`; një dokument i fshirë nuk ka `updatedAt`, ndaj projekti nuk rikompjutohet — `project.spent` mban përgjithmonë shumën e fshirë (derisa të kalojë `?full=1`). I njëjti hendek kur `projectId` **ndryshon**: projekti i **ri** kapet, i **vjetri** jo. Drift i heshtur në marzhet e projektit, Raportet dhe Customer360. | ✅ |
| 8 | **Çdo anëtar i biznesit mund të fshijë, ndryshojë dhe vetë-aprovojë çdo shpenzim.** `firestore.rules` → `allow update, delete: if canManageBusinessDoc()`, që kontrollonte **vetëm anëtarësinë**, pa rol dhe pa validim fushe. **Shkrimet u ngurtësuan:** vetëm `isExpenseApprover` (rol claim *ose* dokument anëtarësie, që një token para claims-rollout-it të mos bllokojë një Admin real) shkruan `approvalStatus`; fshirja kërkon aprovues ose «rreshti i vetes dhe i paaprovuar». **Leximi mbeti** anëtarësi biznesi — shih «Çfarë mbetet» më poshtë. | ✅ shkrimet / 📋 leximet |
| 9 | **Ndryshimi pas aprovimit nuk e rihap aprovimin.** `handleUpdateExpense` nuk e prek `approvalStatus`. Rrjedha: anëtari dorëzon 1 000 → admini aprovon → anëtari e ndryshon në 100 000 → mbetet **Aprovuar**. Butoni "Ndrysho" gatohet nga `permissions.canEdit`, jo nga `isAdminOrManager`. | ✅ |
| 10 | **`keepsBusinessId()` mungon në `expenses`.** `expenseCategories` e ka (`allow update: if canManageBusinessDoc() && keepsBusinessId()`), `expenses` jo. Një anëtar mund t'i lëvizë `businessId`-in e shpenzimit në një qiramarrës tjetër ose në bosh (orfanizim). Sistemik, jo vetëm i shpenzimeve: `invoices`, `payments`, `timeEntries`, `projects` kanë të njëjtin hendek (17 nga 95 blloqe `match` e kanë guard-in). | ✅ |
| 11 | **`Salary` + `projectId` bie mes dy karrigeve.** Në `projectPnl.ts` një shpenzim `Salary` me `projectId` bën `continue` — as direkt, as në pool. Për një kontraktor pa `monthlySalary` në `teamMembers`, kostoja **nuk numërohet askund**. Në përgjithësi: `calculateExpensesBetween` / `buildExpensesByMonth` / `cashflowAlarms` / `forecast` **të gjitha** përjashtojnë kategorinë `Salary`, ndërsa forma e ofron aktivisht (bashkë me zgjedhësin e anëtarit). Një bonus i regjistruar si `Salary` humb heshturazi. | ✅ |

## Të moderuara

| # | Gjetje | Status |
|---|---|---|
| 12 | **Një `nextRecurringDate` në të shkuarën e detyron motorin të mbushë muajt e mbyllur.** `firstGenerationDate(now, freq, picked)` kthen `picked` të pandryshuar kur ai bie në një periudhë tjetër nga ajo e prindit — përfshi periudhat e **kaluara**. **Provuar:** krijim 22 gusht 2026 me datë të zgjedhur 5 janar 2026 → seria gjeneron janar…gusht, një rresht për ekzekutim cron-i. Kjo bie ndesh drejtpërdrejt me ligjin e dokumentuar në `seedNextRecurringDate` ("backfilling the months it missed would rewrite closed books — that is the owner's call"). Nuk ka mbrojtje as në formë (kalendari lejon data të kaluara) as në cron. | ✅ |
| 13 | **Ndryshimi i një serie ekzistuese fshin `recurringAnchorDay`.** `recurringAnchorDay: nextDate ? nextDate.getDate() : null` — një seri e 31-shit që aktualisht tregon nga 28 shkurti degradon **përgjithmonë** në ditën 28 sapo redaktohet çfarëdo fushë (edhe vetëm shuma). Pikërisht driftin që `addMonthsClamped(anchorDay)` u ndërtua për ta ndalur. | ✅ |
| 14 | **`departmentId` është shkrim-vetëm.** Mblidhet në formë, ruhet, filtrohet dhe shfaqet në ExpensesView, kopjohet nga cron-i (`run.ts:1515`) — dhe **asnjë raport financiar nuk e lexon**. `departmentPnl.ts` atribuon kosto vetëm nga projekti → departament. Pra një kosto e nivelit departament (veglat e ekipit SEO) mbetet overhead i përgjithshëm, i ndarë me peshë të ardhurash mbi *të gjithë* departamentet. Etiketimi nuk ka efekt. | ✅ |
| 15 | **`quarterly` ekziston vetëm në gjysmën e sistemit.** `FREQ_TO_MONTHLY` në `cashflowAlarms.ts:41` e njeh (`1/3`), ndërsa `SUPPORTED_EXPENSE_FREQUENCIES` (libraria **dhe** cron-i) është `['weekly','monthly','yearly']`. Një seri e vjetër `quarterly` ushqen alarmin e cash-flow-it me para që **nuk gjenerohen kurrë**, dhe bllokohet me `unsupported-frequency` — që **nuk ka asnjë sipërfaqe në UI** (ndryshe nga `paused`, që ka filtër). Seri e vdekur pa asnjë shenjë. | ✅ |
| 16 | **Dy metoda konkurruese për parashikimin e shpenzimeve.** `forecast.ts` parashikon nga mesatarja e 3 muajve të fundit *aktualë*; `cashflowAlarms.ts` nga norma e normalizuar e prindërve periodikë. Dy kartela në të njëjtën faqe (`FinancesView`) parashikojnë të njëjtin muaj me dy metoda dhe do të mospërputhen sistematikisht. | ✅ |
| 17 | **Indekset e deklaruara për `expenses` nuk i shërbejnë asnjë query-je të gjallë.** `firestore.indexes.json` mban `(teamId, date DESC)` dhe `(teamId, projectId, date DESC)` — por aplikacioni tashmë shkon me `businessId` dhe `date` nuk shkruhet kurrë (#1). Query-ja reale (`where businessId ==` + `orderBy` në klient) nuk kërkon indeks. Indekse të vjetërsuar. | ✅ |
| 18 | **ExpensesView shkarkon të gjithë koleksionin `expenses` të qiramarrësit në çdo mount**, si `onSnapshot` i gjallë, pa `limit`. `visibleCount = 50` kufizon vetëm DOM-in, jo lexuesit. Dhe **gjashtë** view-e paralele abonohen njëkohësisht (Expenses, Finances, Bonus, StaffRevenue, ProjectDetail, Customer360), ndërsa motori periodik shton një rresht/seri/muaj. Rritje e palimituar e kostos Firestore për qiramarrës. | ✅ |
| 19 | **`useMutation('notifications')` në `handleCreateExpense` mund të njoftojë anëtarë të gabuar.** Njoftimi `expense_submitted` shkon te **të gjithë** Admin/Manager aktivë, pa marrë parasysh se anëtari mund të shohë vetëm shpenzimet e vetes; dhe `.catch()` është i lidhur pas `Promise.all` **jashtë** `await`-it, ndaj një dështim i vetëm i heq të gjitha njoftimet e tjera (`Promise.all`, jo `allSettled` — bie ndesh me ligjin "a failed notification must never fail the action" të CLAUDE.md). | ✅ |

## Të lehta / higjienë

| # | Gjetje | Status |
|---|---|---|
| 20 | **Drift tipesh:** `Expense` në `src/types/index.ts:1236` **nuk deklaron** `periodKey`, `lastGeneratedPeriodKey`, `recurringAnchorDay` — pikërisht fushat mbi të cilat varet gjithë idempotenca. Çdo qasje kalon nga `(e as any)`, ndaj kompajleri nuk mbron asnjë prej tyre. | ✅ |
| 21 | **Kod i vdekur me bug brenda:** `calculateTotalExpenses`, `buildExpensesByMonth`, `buildCashflowByMonth` përdoren **vetëm nga testet**. Të tria mbajnë të njëjtin defekt: `buildExpensesByMonth` shton `totalMonthlySalary` **e sotme** në çdo muaj të kaluar të çdo viti (rrogë historike e fabrikuar, ndërsa `salaryHistory.ts` ekziston pikërisht për këtë), dhe `calculateTotalExpenses` shton **një** muaj rrogë mbi një total *all-time* — përzierje njësish. | ✅ |
| 22 | **`api/_merge-contacts.ts:59` riasocion `expenses.customerId`** — fushë që `Expense` nuk e ka dhe që asnjë rrugë shkrimi nuk e prodhon. No-op i padëmshëm, por rresht i rremë në `CUSTOMER_REFS`. | ✅ |
| 23 | **Kategoritë e personalizuara janë të papërmirësueshme.** `expenseCategories` ruhet **sipas etiketës** dhe përdoret si `value`; nuk ka UI për riemërtim/fshirje. Një kategori e shkruar gabim ngec përgjithmonë, dhe një riemërtim do t'i orfanizonte rreshtat ekzistues. `handleAddCategory` dështon në heshtje (pa `catch`, pa toast). | ✅ |
| 24 | **Numërime të vogla që nuk përjashtojnë `Rejected`:** `activeExpenses` dhe `recurringExpenses` (kartelat KPI) numërojnë rreshtat e refuzuar, ndryshe nga `totalExpenses` dhe `categoryBreakdown` pranë tyre. Eksporti CSV gjithashtu i përfshin pa kolonë që të thotë se nuk numërohen (kolona **Miratimi** e nënkupton, jo më shumë). | ✅ |
| 25 | **`deleteMode: 'one'` mbi një prind lë fëmijë me `parentExpenseId` pezull.** Nuk prodhon gjenerim të gabuar (prindi u zhduk, motori ndalet), por rreshtat "Gjeneruar automatikisht" mbeten pa seri prindërore — dhe kontrolli mbrojtës `existingChildSnap` në cron mban një query që nuk përputhet me asgjë. | ✅ |

---

## Çfarë NUK është bug (verifikuar, mos e "rregullo")

- **Çelësi i periudhës si token idempotence** — `expensePeriodKey` / `lastGeneratedPeriodKey`
  është i saktë dhe pasqyrimi `src/lib/finance/recurringExpenses.ts` ↔ `api/cron/run.ts`
  është në sinkron rresht-për-rresht (`expensePeriodKey`, `addMonthsClamped`,
  `nextExpenseOccurrence`, `expenseGenerationBlockReason`). Të dyja mbrojtjet
  (çelësi + `existingChildSnap`) funksionojnë; një `add()` i suksesshëm me
  `update()` të dështuar kapet nga `child.periodKey` në ekzekutimin tjetër.
- **`prindi është rresht real, gjenerimi fillon periudhën pasardhëse`** — i saktë, i
  testuar, dhe i shpjeguar në UI me tekstin ndihmës nën kalendar.
- **Detektimi i dublikatave** — `findDuplicateExpenseGroups` sillet si dokumentohet
  (titull i normalizuar + shumë e saktë + monedhë + periudhë, `Rejected` jashtë,
  vetëm sugjeron). Provuar me tre rreshta; `70001 ≠ 70000` nuk grupohet — strikt me qëllim.
- **Vetë-shërimi FORWARD-only** i një serie pa `nextRecurringDate` — vendim i
  dokumentuar, i zbatuar saktë (`anchor = max(own, now)`, `lastGeneratedPeriodKey`
  vulosur menjëherë).
- **Kaskada e fshirjes së projektit** shkëput shpenzimet (`projectId: ''`) në vend që
  t'i fshijë — `''` është falsy, ndaj `projectPnl` i kalon si mbi `otherFixed`. Saktë.

---

## Rendi i sugjeruar i riparimit

1. **#1 + #2** — një fushë `date` në formë, e paracaktuar në `today`, dhe
   `BonusView` kaloi në `getExpenseDate()`. Pa këtë, gjysma e modulit financiar
   punon mbi datën e futjes në sistem.
2. **#3 + #4** — një helper i vetëm `pickValue(raw)` që kthen `null` për
   `'__none__'`/bosh dhe vlerën përndryshe, i aplikuar në të katër fushat.
3. **#8 + #9 + #10** — rregullat: `keepsBusinessId()`, `approvalStatus` i shkruajtshëm
   vetëm nga Admin/Manager, `date`/`amount` që rihapin aprovimin. Kërkon
   teste negative në `scripts/firestore-rules.test.mjs` para `firebase deploy`.
4. **#5 + #6 + #7** — pajtimi i tre lexuesve të "sa u shpenzua për këtë projekt"
   në një helper të përbashkët, dhe një rrugë rikompjutimi për fshirjet.
5. Pjesa tjetër sipas radhës.

---

## Çfarë mbetet me dashje

**Leximi i shpenzimeve të pagave nga një `Member` (gjysma e leximit të #8).**
Rregulla e leximit mbeti `isBusinessMember(...)`, ndaj një anëtar mund të lexojë
nga konsola shpenzimet e kategorisë «Paga» të kolegëve. Fshehja aktuale është
vetëm në UI (`useFilteredByOwner`).

Kjo NUK u ngushtua sepse **rregullat e Firestore nuk janë filtra**: një klauzolë
`resource.data.createdByUserId == uid` do të kërkonte që ÇDO query listë të
provohej me `where('createdByUserId','==',uid)`. Pasojat, të verifikuara në kod:

- `useCollection` e aplikon `where`-in **në klient** për një koleksion
  business-scoped, ndaj query-ja e dërguar do të mbetej e paprovueshme dhe do
  të refuzohej tërësisht — Members do të mos shihnin **asnjë** shpenzim;
- me `teamScopedWhere: true` query-ja shkon në server, por duhet një indeks i ri
  `(businessId, createdByUserId)` **dhe** një degë e dytë query-je për
  Admin/Manager;
- [ProjectDetailView.tsx:296](src/views/ProjectDetailView.tsx#L296) lexon
  shpenzimet e projektit për burn-down-in dhe është e hapur për çdo rol — një
  `Member` do të merrte «permission denied» në faqen e projektit.

Është ndryshim i shtresës së të dhënave, jo i një rregulle, dhe nuk verifikohet
pa e provuar aplikacionin me role reale — ndaj nuk u dërgua bashkë me pjesën
tjetër. Është në `workspace/TODO.md`.

**Backfill i `date` për rreshtat historikë.** Forma tani shkruan `date`, por
rreshtat e vjetër vazhdojnë të libërzohen nga `createdAt` (fallback-u është i
ruajtur me qëllim). Një backfill do të «gdhendte» datën aktuale; nëse është ajo
që duhet, është vendim i pronarit — gjithashtu në TODO.
