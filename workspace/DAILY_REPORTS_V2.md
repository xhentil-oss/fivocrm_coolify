# Raporti Ditor v2 — plan zbatimi

> **GJENDJA: Fazat 1–5 janë ZBATUAR (11 gusht 2026).** Kodi është në `main`-in lokal,
> jo ende i deployuar. Mbeten dy veprime jashtë kodit — shih §Deploy:
> dy rreshta në crontab-in e VPS-it dhe `firebase deploy` i rregullave + indekseve.
> Faza 6 (redaktimi i pyetjeve nga Cilësimet) mbetet e pahapur.

**Qëllimi:** raporti ditor të pushojë së qeni "kuti tekstesh" dhe të bëhet dokumenti nga i cili
një CEO merr vendime: çfarë u dorëzua, për cilin klient, çfarë nuk u bë dhe pse, çfarë rrezikohet,
çfarë vjen nesër — i plotësuar nga çdo punonjës çdo ditë, i detyrueshëm, në orën 16:50.

Vendimet e marra (11 gusht 2026):
- **Detyrimi:** popup pa buton shtyrjeje + banner i përhershëm + eskalim; app-i NUK bllokohet.
- **Pyetjet:** në kod tani (të testuara), redaktim nga Cilësimet lihet për Fazën 6.
- **Orari:** popup **16:50**, afat (`dueAt`) **17:30**.
- **Shtrirja:** Fazat 1–5.

---

## 0. Gjendja aktuale (baza mbi të cilën ndërtohet)

| Pjesa | Skedari | Ç'bën sot |
|---|---|---|
| Formulari | `src/components/DailyReportPopup.tsx` | 16:45, `POPUP_HOUR/MINUTE`, `DAILY_DUE_HOUR = 18`, buton "Më vonë" → `localStorage` |
| Pyetjet sipas rolit | `src/lib/productivity/reportTemplates.ts` | 11 shabllone, fusha `number`/`text`/`textarea`, `summable` për totalet javore |
| Renderimi i fushave | `src/components/DepartmentReportFields.tsx` | `useMyServiceLine()` → `position` ‖ `serviceLine` |
| Roli i detyrueshëm | `src/components/RequirePositionDialog.tsx` | pyet një herë, para çdo gjëje |
| Pamja e ekipit | `src/views/DailyReportsView.tsx` | rrjet javor, totale `summable`, përmbledhje AI, zgjidhje bllokuesish |
| Metrikat | `src/lib/reporting/accountability.ts` | numëron `missing`/`late`, `flagNeedsAttention()` |
| Tipi | `src/types/index.ts` (`DailyReport`) + `src/types/reporting.ts` (`DailyReportAccountability`) | `customFields: Record<string, string \| number>` |

**Boshllëqet që zgjidh ky plan**
1. Numra pa kontekst — `backlinks: 5` pa klient, pa URL, pa efekt.
2. Raporti nuk e njeh planin e ditës; një detyrë e pambyllur kalon pa shpjegim.
3. "Më vonë" e hesht deri nesër; asnjë kontroll serveri, asnjë eskalim, asnjë gjurmë mungese.
4. `dueAt = 18:00` ndërsa popup-i hapet 16:45 → `wasLate` s'aktivizohet praktikisht kurrë.
5. Asnjë kontroll cilësie: "ok" kalon si raport.

---

## Faza 1 — Raporti lind nga detyrat e ditës

**Ideja:** punonjësi nuk shkruan ese; ai i përgjigjet planit të vet.

### Modeli i të dhënave
Fushë e re, opsionale, në `DailyReport` (`src/types/index.ts`):

```ts
export type TaskOutcomeState = 'done' | 'in_progress' | 'not_started' | 'dropped';

export interface DailyTaskOutcome {
  taskId?: string;          // mungon kur është punë e paplanifikuar
  title: string;            // fotografi e titullit — historia s'duhet të ndryshojë kur riemërtohet task-u
  state: TaskOutcomeState;
  hours?: number;
  /** I DETYRUESHËM kur state ≠ 'done' — pa këtë nuk dorëzohet dot. */
  reason?: string;
  projectId?: string;
  customerId?: string;
  unplanned?: boolean;
}
```
→ `taskOutcomes?: DailyTaskOutcome[]` në `DailyReport`.

### Logjika e pastër — `src/lib/productivity/dailyReportPlan.ts` (i ri, i testuar)
- `buildPlannedOutcomes(tasks, now)` — kthen rreshtat fillestarë nga detyrat e sotme
  (rikonsumon të njëjtin filtër `todaysAssignedTasks` që sot rron brenda popup-it; ai kod
  **zhvendoset** këtu që ta ndajnë popup-i, StaffDashboard dhe testet).
- `summariseOutcomes(outcomes)` — `{ done, inProgress, notStarted, unplanned, hoursLogged }`.
- `outcomeBlockers(outcomes)` — rreshtat pa `reason` kur duhet → gabimet e dorëzimit.
- `narrativeFromOutcomes(outcomes)` — gjeneron tekstin e `completedToday`/`openItems`
  automatikisht, që punonjësi të mos e shkruajë dy herë.

### UI
Në popup, seksioni "Detyrat e sotme" bëhet listë rreshtash, jo checkbox-e:
`[titulli]  ( Përfunduar | Në progres | Nuk u prek )  [orë]  [arsyeja — shfaqet vetëm kur s'është 'Përfunduar']`
plus butoni **"+ Punë e paplanifikuar"**.

Në dorëzim: `state: 'done'` → task-u shkon `Done` (siç bën sot `selectedTaskIds`);
`in_progress` → task-u shkon `In Progress`. `completedToday` mbushet automatikisht dhe mbetet i redaktueshëm.

**Prekën:** `DailyReportPopup.tsx`, `types/index.ts`, `dailyReportPlan.ts` (+ test), `DailyReportsView.tsx` (shfaqja e rreshtave në dialogun e detajeve).

---

## Faza 2 — Pyetje CEO-grade sipas rolit

`reportTemplates.ts` zgjerohet nga "listë fushash" në **shabllone me kallëp të përbashkët**:

> **Output** (çfarë doli) → **Impakt** (çfarë ndryshoi për klientin) → **Rrezik** (çfarë mund të prishet) → **Hapi tjetër**

Shtesa te `ReportField`:
```ts
kind?: 'output' | 'impact' | 'risk' | 'next';   // grupimi vizual + rollup-et
required?: boolean;
minChars?: number;                               // vetëm për text/textarea
perClient?: boolean;                             // plotësohet një herë për çdo klient të prekur
type: … | 'url' | 'select';
options?: string[];                              // për 'select'
```
Prapa-përputhshmëria: `customFields` mbetet i njëjti `Record<string, string|number>`;
fushat `perClient` ruhen si `customFields['seo.pages.<customerId>']` — asnjë lexues ekzistues nuk prishet.

### Pyetjet për rol (drafti)

**🖥️ Web Design** — faqe/seksione të dorëzuara *(numër)*, **link i preview-t** *(url)*, raunde revizioni,
a kaloi te zhvillimi *(po/jo/pjesërisht)*, **çfarë pret nga klienti** *(tekst)*, **hapi tjetër konkret**.

**🔍 SEO** — klientët e prekur *(perClient)*, URL të optimizuara *(url + numër)*, backlinks + cilësia e tyre,
lëvizje pozicionesh: hyrje në top-3 / top-10 *(numër)*, probleme teknike të zgjidhura,
**"çfarë do lëvizë renditjen muajin tjetër"** *(impakt, i detyrueshëm)*.

**📱 Social Media** — postime/reels/stories **sipas klientit**, reach & engagement *(numër)*,
komente/mesazhe pa përgjigje *(rrezik)*, a është gati kalendari i nesërm *(po/jo)*,
materialet që mungojnë nga klienti *(rrezik)*.

**🎯 Ads** — shpenzim €, leads, **CPL**, ROAS, ndryshimet e bëra sot *(tekst)*,
fushata në rrezik + arsyeja, buxheti i mbetur.

**📞 Sales** — telefonata/takime/propozime, vlera e pipeline-it të lëvizur €, marrëveshje të fituara/humbura + arsyeja,
follow-up të vonuar *(rrezik)*.

**💻 Dev** — features të dorëzuara + **link PR/deploy**, bug-e të rregulluar, borxh teknik i hasur,
çfarë bllokon release-in.

**✍️ Content** — artikuj/tekste + klienti, fjalë, tema, çfarë pret aprovim.

**🎥 Foto/Video** & **🎬 Regji** — të njëjtin kallëp, me dorëzimet dhe materialin e xhiruar.

**🎨 Design** — dizajne, revizione, materiale të dorëzuara + link.

**🧭 Menaxhim** — takime, vendime, pengesa të hequra ekipit, klientë të kontaktuar,
**rreziqet e portofolit** *(i detyrueshëm)*.

**Prekën:** `reportTemplates.ts` (+ `reportTemplates.test.ts` zgjerohet), `DepartmentReportFields.tsx`
(render për `url`/`select`/`perClient` + grupim sipas `kind`).

---

## Faza 3 — I detyrueshëm në 16:50

### Klienti
- `POPUP_MINUTE 45 → 50`; `DAILY_DUE_HOUR 18` → `DAILY_DUE_HOUR 17` + `DAILY_DUE_MINUTE 30`.
- Butoni **"Më vonë"** hiqet. Dialogu mbyllet vetëm me `Esc`/klik jashtë, dhe atëherë shfaqet
  **banner i kuq i përhershëm** ("Raporti i sotëm nuk është dorëzuar — afati 17:30") me buton rihapjeje.
  Banner-i rron në një komponent të ri `DailyReportBanner.tsx`, i montuar pranë `DailyReportPopup` në `App.tsx`.
- `localStorage` s'e hesht më ditën — heq `handleDismiss`.
- Përjashtim: `workingStatus ∈ {leave, sick, holiday}` → dorëzim me një klik, pa fushat e tjera.

### Serveri — job i ri `daily-report-check` në `api/cron/run.ts`
Idempotent, i skeduar **17:35** dhe **18:35** (kërkon dy rreshta në crontab-in e VPS-it — shih §Deploy):
1. Për çdo tenant (`tenantScopedDocs`, kurrë lexim i pafiltruar), merr `teamMembers` aktivë
   me `position` të caktuar, dhe `dailyReports` të datës së sotme.
2. Anashkalon fundjavat dhe festat e tenant-it.
3. **17:35** → `notifyUser()` te punonjësi (tipi `daily_report_due`).
   **18:35** → `notifyUser()` te Admin/Manager me listën e mungesave (tipi `daily_report_missing`).
4. Regjistron gjurmën në `dailyReportMisses/{businessId}_{date}` — një dokument për ditë me
   `{ missingUserIds, lateUserIds, notifiedAt, escalatedAt }`, që `AccountabilityView` ta lexojë
   pa e rillogaritur dhe që eskalimi të mos përsëritet dy herë (`escalatedAt` = çelësi i idempotencës).

### Tipe njoftimesh të reja
Një rresht në `src/lib/notificationTypes.ts` **dhe** në pasqyrën `api/_notificationTypes.ts`
(testi `notificationTypes.test.ts` e rrëzon build-in nëse ndryshojnë):
```
daily_report_due:     { category: 'reports', priority: 'warning',  groupLabel: 'raporte në pritje' }
daily_report_missing: { category: 'reports', priority: 'critical', groupLabel: 'raporte që mungojnë' }
```

**Prekën:** `DailyReportPopup.tsx`, `DailyReportBanner.tsx` (i ri), `App.tsx`, `api/cron/run.ts`,
`notificationTypes.ts` + mirror, `firestore.rules` + test negativ ndër-tenant për `dailyReportMisses`,
`useFirestore.ts` (`businessIsolatedAlways`), `firestore.indexes.json`.

---

## Faza 4 — Kontroll cilësie (anti-"ok")

`src/lib/productivity/dailyReportQuality.ts` (i ri, i pastër, i testuar) — i njëjti kallëp si
`src/lib/reporting/quality.ts`: kthen `score` 0–100, `suggestions[]` dhe `blockers[]`.

**Bllokues (nuk dorëzohet):** fushat `required` bosh; një `taskOutcome` jo-`done` pa `reason`;
`completedToday` nën `minChars`.
**Sugjerime (vetëm nxitje):** asnjë klient/projekt i zgjedhur ndonëse ka detyra me projekt;
"hapi tjetër" bosh; orë të deklaruara 8 por zero output; i njëjti tekst si dje *(kopjo-ngjit)*.

Shiriti i cilësisë shfaqet live në popup dhe si distinktiv në `DailyReportsView`.

---

## Faza 5 — Ekrani i CEO-s

Tab i ri **"Sot"** në `DailyReportsView` (para rrjetit javor):
- **Semafori i dorëzimit:** dorëzuar / vonuar / mungon — me foto dhe një klik për ta kujtuar.
- **Bllokuesit e hapur** të gjithë ekipit, të renditur sipas moshës (`blockerResolvedAt` ekziston).
- **Output i agreguar sipas roli** (nga `summableFields`) dhe **sipas klienti** (nga `perClient` + `customerIds`).
- **Devijimi plan↔realitet:** sa detyra ishin planifikuar vs `done`, dhe arsyet më të shpeshta.
- **Përmbledhja AI e ditës** — zgjerohet ajo ekzistuese që të lexojë `taskOutcomes` dhe rreziqet.

Rollup javor per rol dhe per klient shtohet te tab-i javor ekzistues.

---

## Testet

| Skedari | Mbulon |
|---|---|
| `dailyReportPlan.test.ts` | detyrat e sotme, arsyeja e detyrueshme, narrativa e gjeneruar, puna e paplanifikuar |
| `reportTemplates.test.ts` (zgjerohet) | çdo rol ka `output`+`next`; çdo `position` ka shabllon; sinonimet |
| `dailyReportQuality.test.ts` | bllokues vs sugjerime, raporti i kopjuar, raporti bosh |
| `accountability.test.ts` (zgjerohet) | `dueAt` 17:30 → `wasLate`; leje/sëmundje nuk numërohet mungesë |
| `notificationTypes.test.ts` | tipet e reja ekzistojnë në të dyja anët |
| `scripts/firestore-rules.test.mjs` | `dailyReportMisses` — lexim ndër-tenant i mohuar |

---

## Deploy / kujdes

1. **Crontab i VPS-it — E DETYRUESHME, pa këtë Faza 3 nuk funksionon.**
   Job-i NUK e merr me mend orën e tenant-it: `stage` jepet shprehimisht, dhe skeduluesi
   (që rri në orën e zyrës) vendos kur. Dy rreshta:

   ```cron
   35 17 * * 1-5 curl -s -H "Authorization: Bearer $CRON_SECRET" \
     "https://fivocrm.vercel.app/api/cron/run?job=daily-report-check&stage=remind"
   35 18 * * 1-5 curl -s -H "Authorization: Bearer $CRON_SECRET" \
     "https://fivocrm.vercel.app/api/cron/run?job=daily-report-check&stage=escalate"
   ```

   Job-i është idempotent: `dailyReportMisses/{businessId}_{date}` mban `remindedAt` /
   `escalatedAt`, kështu që një rerun nuk njofton askënd dy herë. **Nuk është pjesë e
   `run-all`** — është i ndjeshëm ndaj orës.
2. **Rregullat Firestore + indekset** — deploy vetëm pas testeve në emulator:
   ```bash
   firebase emulators:exec --only firestore "node --test scripts/firestore-rules.test.mjs"
   firebase deploy --only firestore:rules,firestore:indexes
   ```
   Të reja: rregulli `dailyReportMisses` (lexim brenda tenant-it, shkrim nga askush) +
   indekset `teamMembers(businessId,status)` dhe `dailyReportMisses(businessId,date)`.
   Pa indeksin e parë, cron-i dështon në lexim.
3. **Android:** `npm run android:sync` pas ndryshimeve.
4. Asnjë ndryshim prishës: `customFields`, `completedToday`, `openItems`, `blockers`,
   `planTomorrow` mbeten të njëjtat fusha — raportet e vjetra lexohen normalisht.
   `taskOutcomes` është opsional, ndaj raportet para sotme thjesht nuk e kanë.

## Çfarë u ndërtua (hartë skedarësh)

| Skedar | Roli |
|---|---|
| `src/lib/productivity/dailyReportPlan.ts` (+test) | Plani i ditës i përgjigjur; arsyeja e detyrueshme; narrativa e gjeneruar |
| `src/lib/productivity/reportTemplates.ts` (+test) | Pyetjet Output→Impakt→Rrezik→Hapi tjetër; ruajtja `key.customerId` |
| `src/lib/productivity/dailyReportQuality.ts` (+test) | Bllokues vs sugjerime; leja/sëmundja e heq formularin |
| `src/components/DailyReportForm.tsx` | I VETMI render i pyetjeve — popup + parapamje |
| `src/components/DailyReportPopup.tsx` | Orari 16:50, dialogu, banner-i që nuk ikën |
| `src/components/DailyReportPreviewDialog.tsx` | "Shiko si punonjës" për admin |
| `src/components/DepartmentReportFields.tsx` | Grupimi sipas lëvizjeve, url/select, per-klient |
| `api/cron/run.ts` → `runDailyReportCheck` | 17:35 punonjësit, 18:35 menaxherit, idempotent |
| `src/views/DailyReportsView.tsx` | Paneli "Sot" + `taskOutcomes` në detaje + totalet per-klient |

### Kufizime të njohura
- Mungesat regjistrohen vetëm kur cron-i ekzekutohet; nëse crontab-i s'vihet, `dailyReportMisses`
  mbetet bosh dhe paneli "Sot" llogarit mungesat nga klienti (siç bënte më parë).
- Leja/sëmundja e heq formularin, por cron-i nuk e di se dikush është me leje derisa ai
  ta dorëzojë raportin një-klikësh — pra do të marrë një kujtesë në 17:35.

## Faza 6 (jashtë këtij raundi)
`reportQuestionSets` per business + editor në Cilësimet: kodi mbetet default, Firestore mbivendos.
