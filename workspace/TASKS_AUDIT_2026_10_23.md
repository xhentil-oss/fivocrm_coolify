# Auditim i modulit Tasks — 23 tetor 2026

> **Statusi (23 tetor 2026, mbrëmje): TË GJITHA gjetjet u rregulluan** në të njëjtën
> ditë (pesë agjentë paralelë + verifikim), përveç: **A5 fushat e brendshme**
> (description / attachments / value te detyrat e dukshme në portal — strukturore,
> i njëjti boshllëk i njohur si te projektet; nën-detyrat NUK shkojnë më në portal),
> **D10** (orët e të gjithëve me `hourlyRate` lexohen nga çdo anëtar — vendim produkti),
> **TasksView:100** (Member sheh emrat e të gjitha projekteve — vendim produkti).
> Detajet e zbatimit: `workspace/CHANGELOG.md` [2026-10-23]; rules teste 84a–84n.
> Hapat manualë: `firebase deploy --only firestore:indexes` (index i ri
> `messages (businessId, taskId, createdAt)`), `firebase deploy --only firestore:rules`,
> `node scripts/strip-subtask-customer-id.mjs` (dry-run) → `--apply`.


Pesë agjentë paralelë (paneli i ri "Task Sheet", listat/board/kalendar, motori +
cron, siguria/rules/portal, krijimi/komentet/orët/faqja e projektit) + verifikim
i dorës për çdo gjetje HIGH dhe për regresionet e rindërtimit të sotëm
(commit-et 34f929c, 1c7a638, 4e80dab). Gjetjet e shënuara **KONF.** janë ndjekur
në kod deri në fund; **MUND.** janë të besueshme por të paprovuara me të dhëna.
Boshllëqet që CLAUDE.md / auditimet e mëparshme i kanë lënë qëllimisht hapur
(p.sh. "çdo anëtar fshin çdo detyrë nga konsola") nuk rilistohen.

Baza e kodit: `main` @ 4e80dab. Rreshtat e `firestore.rules` janë ato të datës.

---

## A. HIGH — siguri dhe shifra të gabuara

| # | Ku | Defekti | Skenari |
|---|----|---------|---------|
| A1 | `src/components/tasks/panel/TaskAttachmentsSection.tsx:173,183,192` | `file.url` shkon direkt në `href`/`src` pa `safeExternalUrl()`; `task.attachments` është JSON që çdo anëtar jo-Viewer e shkruan (rules s'e kufizojnë). | Member shkruan nga konsola `attachments:[{name:'Brief.pdf',url:'javascript:…'}]` → admini hap fletën, klikon emrin → XSS në sesionin e adminit. Portal-i dhe seksioni i miratimit E FILTROJNË; vetëm ky seksion jo. **KONF.** |
| A2 | `src/components/tasks/panel/TaskChatSection.tsx:20-30` + `firestore.rules` `match /messages` read (1851-1856) | Pyetja `taskId == X` me `skipTeamFilter` dhe `messages` NUK është në `businessIsolatedAlways` → asnjë klauzolë e rregullit (businessId / senderId / receiverId / channelId) s'provohet → listener-i REFUZOHET për këdo që s'është super-admin. Create-i kalon, pra rreshtat grumbullohen me `isRead:false` dhe zënë dritaren e unread-it të grupeve. | Stafi hap "Chat" te një detyrë → bosh / gabim leje; pronari (super-admin) s'e vë re. **KONF.** |
| A3 | `src/views/ProjectDetailView.tsx:473-487` (kolona "Orë", 1723) | `duration` ruhet në MINUTA (`floor(ms/60000)` te timer-i dhe TimeLogDialog), kodi e pjesëton me 60 sikur të ishte sekonda. | Rresht 120 min → "2m"; totali i orëve të projektit 60× më i vogël për çdo rresht me `duration`, i saktë për rreshtat vetëm me span → shuma përzien dy njësi. Financat (`laborForEntries`) e ka saktë → dy faqe, dy shifra. **KONF.** |
| A4 | `firestore.rules:2080-2095` (taskComments update, dega "Re-point on a task move") | Lejon ndryshimin e `customerId` te customerId-i aktual i detyrës pa kërkuar që komenti ta KETË pasur një më parë. | Çdo koleg publikon një koment të BRENDSHËM te portali i klientit me një shkrim nga konsola. UI (`repointClientComments`) prek vetëm rreshtat që kanë customerId; testi 82i e mbjell komentin me customerId, pra rruga internal→client s'testohet. **KONF.** |
| A5 | `firestore.rules:512-519` (tasks read) + `PortalProjectDetailView.tsx:153-176`, `PortalDashboard.tsx:244-260` | Klienti merr GJITHË dokumentin e detyrës: `description` (shënimet e brendshme), `attachments` (URL-të e VPS-së), `value`, `estimatedHours`, `collaboratorIds`, `clientApprovalHistory`, fushat e kujtesës; plus ÇDO nën-detyrë (trashëgon customerId, filtrohet vetëm në klient me `!parentTaskId`). | UI-ja tregon titull/status/prioritet/afat, por snapshot-i është në browser-in e klientit. Boshllëku i njohur i CLAUDE.md mbulon vetëm dokumentet e PROJEKTIT. **KONF.** |
| A6 | `firestore.rules:540-550` (tasks update) | `value` / `valueAppliedToBudget` (para: fatura draft + rritja e buxhetit te projektet one-time) nuk kanë gate çelësi; vetëm UI-ja i fsheh (`canEditBudget`). | Member vendos `value: 900000` te detyra e kolegut → çmimimi task-by-task dhe fatura draft e shohin (buxheti i projektit mbrohet nga `projectFinanceKeys`, pra dëmi kufizohet). Ligji "Money rules" thotë në RULES. **KONF.** |

## B. Regresione nga rindërtimi i sotëm i panelit (34f929c / 1c7a638)

| # | Ku | Defekti |
|---|----|---------|
| B1 | `TaskDetailPanel.tsx:279-280` + `TaskPeopleRows.tsx:268,323` | **Projekti / Caktuar te nuk mbyllen me tap të dytë**: wrapper-i vendos `false` e pastaj `v => !v` në të njëjtin batch → gjithmonë `true`. Mbyllen vetëm me klik diku tjetër. **KONF.** |
| B2 | `TaskDatesSection.tsx:43` | Afati i kuq (tile + "Dje, 17:00") edhe për detyrë **Done** me afat të kaluar; lista nuk e quan Done "vonuar". **KONF.** |
| B3 | `TaskDetailPanel.tsx:420-447` (Dupliko) | Kopjon `startDate/endDate` verbatim (kopja lind "vonuar" dhe `task-deadline-alerts` njofton), humb `parentTaskId` (nën-detyra bëhet detyrë kryesore), nuk njofton përgjegjësin (`task_assigned`), nuk bën kontrollin e ditës; Member pa `canAssignTasks` merr gabim leje nga rules (jo bypass, por veprim i vdekur). **KONF.** |
| B4 | `TaskDetailPanel.tsx:408` (Kopjo lidhjen) | Në app-in Capacitor `window.location.origin` = `https://localhost` → lidhja e kopjuar është e papërdorshme. **KONF.** |
| B5 | `TaskDetailPanel.tsx:253-260` vs `393` | Blur-i ruan titullin PA trim, `dirty` krahason ME trim → hapësirë fundore nga tastiera mobile = "Ruaj" i ndezur përgjithmonë. **KONF.** |
| B6 | `TaskReminderSection.tsx:83` | Pill-i "Asnjë" shkruan `clearReminderPatch()` edhe kur s'ka kujtesë (shkrim bosh + `updatedAt`). **KONF.** |
| B7 | `TaskPriorityLabelRows.tsx:34` | "Mesatar" nuk shkruan kur dokumenti s'ka `priority` (segmenti ndizet për një vlerë që s'është në dokument). **KONF.** |
| B8 | `TaskRecurrenceSection.tsx:142` | Viewer/guest nuk sheh më "Deri më" dhe ditët e serisë (trupi i rreshtit fshihet për readOnly). **KONF.** |
| B9 | `TaskDetailPanel.tsx:103-109` | Titulli auto-grow nuk rimatet në rotation/resize; `paste` fut `\n` në titull (Enter kapet, paste jo). MUND. |
| B10 | `TaskRecurrenceSection.tsx:32`, `useTaskPanelDates.ts:15` | Javore pa `recurringDayOfWeek` → "Çdo javë, Diel"; Fillimi pa datë → "Sot, 14:43" si fakt. MUND. |
| B11 | `TaskPeopleRows.tsx:300` | `#C3CEDD` + tekst i bardhë (kontrast ~1.4:1) dhe literal i vetëm light-theme në dark mode. KONF. |
| B12 | `TaskDetailPanel.tsx:377-388` | "Ndryshuar · data" ndizet edhe nga shkrimet e cron-it (flag-et e alarmit). MUND. |

## C. MED — sjellje e gabuar (jo siguri)

| # | Ku | Defekti |
|---|----|---------|
| C1 | `src/hooks/useCreateTask.ts:222-230` + `ProjectDetailView.handleCreateTask` | Bashkëpunëtorët krijohen me `Promise.all` PAS detyrës, pa catch → një refuzim rules hedh gjithë handler-in, dialogu mbetet hapur me titullin → klikim i dytë = detyrë e dyfishtë. **KONF.** |
| C2 | `TaskSubtasksSection.tsx:85-134`, `TaskChatSection.tsx:254-269` | Pa guard in-flight: dy Enter/tap gjatë round-trip-it = dy nën-detyra (+2 njoftime) / dy mesazhe. **KONF.** |
| C3 | `TasksView.tsx:116-118` | Pika "Duke punuar" dëgjon `timeEntries` me `endTime == null` të aplikuar në KLIENT → çdo hapje e /app/tasks shkarkon dhe mban live gjithë librin e orëve të tenant-it (mijëra rreshta/vit). **KONF.** |
| C4 | `TasksView.tsx:235-277`, `useTaskGroups.ts:26,74`, `MyTasksView.tsx:103` | "Sot" llogaritet brenda memo-ve pa `todayKey` → pas mesnatës chip-i "Vonuar", filtri `overdue`, grupet "Sot/Të vonuara" dhe përmbledhja e MyTasks përshkruajnë ditën e djeshme. **KONF.** |
| C5 | `taskListUtils.ts:20` vs `useTaskGroups.ts:61`/`taskDue.ts:180`/`myTasks.ts:85` | Dy përkufizime "vonuar": chip/filtri/rreshti lexojnë vetëm `endDate`, grupimi/MyTasks lexojnë `endDate ?? dueDate`. Detyrë legacy vetëm me `dueDate` → te "Të vonuara" por jo te chip-i; rreshti thotë "Pa afat". KONF. kod / MUND. të dhëna. |
| C6 | `TasksView.tsx:377` | Drop në board mbi një KARTË të kolonës tjetër thërret `applyReorder` → ndryshon renditjen e listës së GJITHË ekipit (ose toast "u ruajt vetëm për ty" te Member) si efekt anësor i ndryshimit të statusit. Ligji: drag-u i board-it nuk ruhet si renditje. MUND. (koment inline e quan të qëllimshëm). |
| C7 | `TasksView.tsx:418-432` (markTaskDone) | `completeTask` kthen `{kind:'error'}` (cikli tjetër s'u krijua) → s'ka degë → toast "Statusi u ndryshua ✓". MyTasksView e trajton. **KONF.** |
| C8 | `TasksView.tsx:546-554` + `TaskRow.tsx:290-297` | Kalendari inline: dita = mesnatë LOKALE e browser-it + `setHours` lokale, jo Tirane → browser jashtë Shqipërisë ruan një ditë më vonë. KONF. logjikë. |
| C9 | `useCreateTask.ts:135-157`, `ProjectDetailView.tsx:763-800` | `nextRecurringDate` javore mbillet nga TANI, jo nga dita e fillimit (deri 10 ditë pune përpara) → data e ciklit tjetër PARA startDate; offset-i negativ trashëgohet te çdo fëmijë → seria "due" një javë më herët përgjithmonë. `recurringEndDate` = mesnatë lokale (ligji i zonës). **KONF.** |
| C10 | `useCreateTask.ts:185`, `ProjectDetailView.tsx:745` | Kujtesa te krijimi s'shkruan `reminderSetByUserId` → menaxheri që krijon për kolegun dhe kërkon "1 orë para" nuk kujtohet vetë, kujtohet kolegu (e kundërta e panelit). **KONF.** |
| C11 | `useTaskCommentHandlers.ts:291-307`, `ProjectDetailView.tsx:946-962` | Reagimet: read-modify-write i gjithë map-it nga snapshot-i → dy kolegë brenda latencës mbishkruajnë njëri-tjetrin. MUND. |
| C12 | `TaskTimeTrackingSection.tsx:621-669` | Timer-i: kontrolli "vetëm një i hapur" lexon snapshot-in e panelit (garë → dy rreshta të hapur), listener-i është team-scoped (timer i hapur në departament tjetër s'shihet). Rreshtat e timer-it s'shkruajnë `costRole` → rikostohen kur ndryshon roli. KONF. (costRole) / MUND. (gara). |
| C13 | `TaskAttachmentsSection.tsx:81-118` | "Hiq materialin" fshin vetëm nga JSON-i, skedari mbetet në VPS përgjithmonë; dy njerëz që bashkëngjisin njëkohësisht → njëra humbet (read-modify-write i një string-u). KONF./MUND. |
| C14 | `ProjectDetailView.tsx:899-907` | Komenti i dukshëm për klientin stampohet me `project.customerId`, rules kërkojnë `== task.customerId` → kur ndryshojnë (projekt me klient të ndryshuar, detyrë e lëvizur) create REFUZOHET pa shpjegim. MUND. |
| C15 | `TaskSubtasksSection.tsx:248-259,503-517` | Edit i nën-detyrës: `parseDate` → sot si fallback dhe "Ruaj" shkruan gjithmonë start/end + `assignedToUserId:''` → ndryshimi i titullit i jep datat e sotme një nën-detyre pa datë dhe `''` në vend të null. **KONF.** |
| C16 | `recurringUtils.ts:477-489`, `taskRecurrenceClaim.ts:24` | Claim-i vendos `nextCycleCreated:true` kur detyra është ende Todo, PARA create-it dhe Done-it → tab i mbyllur / rrjet i rënë mes tyre = Todo me `nextCycleCreated:true` pa fëmijë; cron e kapërcen, ri-Done s'e rihap, s'stampohet arsye. MUND. |
| C17 | `api/cron/run.ts:1427,1460-1462` | Backstop-i vepron vetëm kur `nextRecurringDate <= now` e pastaj rrotullon përpara çdo ditë < sot → okurenca të humbura kur offset-i është i gabuar (C9) ose ora e serisë është pas tick-ut 08:00 UTC. MUND. |
| C18 | `api/cron/run.ts:608-618` vs `src/lib/taskDue.ts:35-57` | Cron-i shënon `task_overdue` në ÇAST (`endDate < now`), taskDue.ts thotë "vonuar" vetëm kur ka kaluar DITA Tirane → push "e ka kaluar afatin sot" në orën 10:00 për detyrë me afat 09:00 sot, dhe flag-u konsumohet. KONF. (koment inline e quan të qëllimshëm, por kundërshton ligjin). |
| C19 | `api/cron/run.ts:2606-2626` + `api/_projectCycles.ts:582` | `taskPeriodsBehind` lexon `endDate ‖ dueDate ‖ startDate`, shift-i shkruan `dueDate` vetëm kur ka `endDate` → detyrë legacy vetëm me `dueDate` mbartet çdo cikël (`carriedOverCount++`) pa u datuar kurrë. KONF. kod. |
| C20 | `api/cron/run.ts:1349-1350,1532-1550` vs `recurringUtils.ts:265` | Pasqyra e `remapDependsOn` divergon: cron-i mban bllokuesin one-off Done (lib e heq); fëmija i planifikuar futet para transaksionit → `dependsOn` drejt një `rec_task_…` që s'ekziston kur spawn-i del 'claimed-elsewhere'. MUND. |
| C21 | `useTaskListOrder.ts:27-47` | `listOrderLoaded` ref s'resetohet → pas ndërrimit të ekipit mbetet renditja e ekipit të vjetër deri në reload. MUND. |
| C22 | `MyTasksView.tsx:206-212` | Undo i snooze-it rikthen `reminderSentAt:null` → kujtesë e dorëzuar dërgohet për herë të dytë. KONF. |
| C23 | `TaskCalendarView.tsx:73` + `recurringOccurrencesInMonth` | `isRecurring:true` pa `recurringFrequency` → detyra zhduket nga kalendari (as në qelizë, as te "Pa afat"). MUND. |

## D. Siguri — MED/LOW (rules më të gjera se UI)

| # | Ku | Defekti |
|---|----|---------|
| D1 | `firestore.rules:672-681` (`taskCustomerAllowed`) | `customerId == previousCustomerId` pranohet pavarësisht ndryshimit të `projectId` → detyrë e lëvizur te projekti i klientit tjetër mban customerId-in e vjetër → klienti i vjetër vazhdon ta lexojë. `ProjectsView.tsx:1041-1050` ristampon detyrat kur ndryshon klienti i projektit, por jo komentet e tyre të dukshme. KONF. (rules) / MUND. (ProjectsView). |
| D2 | `firestore.rules:1962-1966` (activities) | Create s'pin-on `userId == uid` dhe s'përjashton Viewer → çdo staf falsifikon rreshta timeline në emër të kolegut. Asnjë test për `activities`. KONF. |
| D3 | `firestore.rules:575-587` | Vetëm `clientApproval` ruhet; `clientApprovalHistory` është e lirë → raund i falsifikuar "approved" te "Raundet e mëparshme". KONF. |
| D4 | `firestore.rules:540-550` | Flag-et e motorit (`nextCycleCreated`, `recurringSkippedReason`, `reminderSentAt`, `dueNotificationSent`, `overdueNotificationSent`) i shkruan çdo Member → `nextCycleCreated:true` te seria e kolegut e vret serinë pa zë. KONF. (rules). |
| D5 | `firestore.rules:540-556` + `683-687` | `projectId` validohet vetëm kur vendoset `customerId` → Member mund ta drejtojë detyrën te projekt i një tenant-i tjetër (vetë-rrjedhje insider). KONF. (rules). |
| D6 | `firestore.rules:2031-2041` | `senderType` s'pin-ohet te create-i i stafit → staf poston si 'client'. KONF. |
| D7 | `firestore.rules:2151-2156` (taskCollaborators) | `taskId`/`userId` të lira. KONF. |
| D8 | `firestore.rules:2804-2808` | `actionUrl[0:1]=='/'` pranon `//evil.com` (serveri e refuzon me `isSafeAppPath`; rregulli më i dobët se serveri). MUND. |
| D9 | `api/_notify-staff.ts:264-305` | Klienti i portalit krijon detyra urgjente te stafi 120/orë (spam detyrash + njoftimesh); `dueInDays` i pakufizuar → `Timestamp` hedh ose data në vitin 5000. MUND. |
| D10 | `firestore.rules:1491` (timeEntries read) | Çdo anëtar (Viewer përfshirë) lexon orët e të gjithëve me `hourlyRate`. Për vendim. |
| D11 | `firestore.rules:529` | Komenti përmend testin 82d që s'ekziston; degë pa test: activities, taskCollaborators, A4, D3, D6, chat i detyrës, D1, D4. KONF. |
| D12 | `useTaskCommentSubmit.ts:82-136` | Uid-et e @mention lexohen nga teksti pa rivalidim → uid i huaj bëhet follower në `collaboratorIds`. MUND., ndikim i ulët. |

## E. LOW

- `SmartSuggestions.tsx:50-62` — afati me ditë çasti (`ceil`), jo ditë kalendarike Tirane → "Afati sot!" për detyrë të djeshme 23:00.
- `TaskFilters.tsx:95` vs `TasksView.tsx:213` — "Të miat" filtron vetëm uid, numërimi përfshin email → "3 të miat" tregon 2.
- `MyTasksView.tsx:66,111` — `getTodayString`/`toLocaleDateString('sv')` lokale, cron-i Tirane.
- `taskListUtils.ts:47` — `formatDateCompact` ditë/muaj lokale, gjykimi Sot/Nesër Tirane.
- `TaskCalendarView.tsx:41,68-85` — filtër + sort për 31 qeliza në çdo render, pa memo.
- `TasksView.tsx:282-295` — `?taskId=` fshin parametrat e tjerë; detyrë e palexueshme rimbush efektin çdo snapshot.
- `TasksView.tsx:155-166` — `subtaskCounts` nga lista e FILTRUAR → "1/1" në vend të "1/4" për Member.
- `TaskListView.tsx:55-61` — "Krijo detyrën e parë" shfaqet për Viewer, dialogu s'montohet.
- `TasksView.tsx:100` — Member sheh të gjitha projektet e biznesit në picker/grupim (emra).
- `useTaskListOrder.ts:68` — O(renditje × detyra) në çdo drop.
- `TasksView.tsx:313-318` — `JSON.stringify` dy herë për çdo snapshot sa paneli është hapur.
- `TaskCommentsSection.tsx:406-409` — `deleteComment` pa catch.
- `deleteCascade.ts:234-321` — kaskada e projektit s'prek `messages` me `taskId` (rreshta jetimë chat-i).
- `deleteCascade.ts:248` — `category != 'Salary'` përjashton edhe shpenzimet PA kategori → `projectId` i varur.
- `ProjectDetailView.tsx:585-594` — detyrë e fshirë/lëvizur nga kolegu mbetet hapur dhe e editueshme (çdo update hedh).
- `api/cron/run.ts:1470-1472` — mbyllja "deri më" pa `recurringSkippedReason`.
- `api/cron/run.ts:738` — kujtesë pa marrës stampohet `reminderSentAt` → "U dërgua" për askënd.
- `api/cron/run.ts:694-695` — kujtesa e detyrës Done s'konsumohet; rihapja brenda 48h e ndez vonë.
- `api/cron/run.ts:708-712` vs `taskReminders.ts:123` — cron hedh >48h, lib s'ka arsye 'stale' → UI tregon "pending" përgjithmonë.
- `api/cron/run.ts:1319` vs `recurringUtils.ts:245` — çelësi legacy i dublikatës normalizon titullin, `sameSeries` jo.
- `QuickTaskForm.tsx:317-322` — "disa ditë çdo N>1 javë" bie te dita e parë pa paralajmërim.
- `api/cron/run.ts:2610-2663` — claim-i i periudhës s'është atomik me shkrimet e detyrave; ri-run dyfishon `carriedOverCount`.
- `api/_projectCycles.ts:543-546` — nën-detyrat jo-recurring të një tip-i Done rihapen nën prind Done.
- `taskValue.ts:99` — `dueDate` e faturës draft = fund muaji lokal.
- `MyTasksView.tsx:~531` + `TaskPanelFooter.tsx:25` — safe-area dy herë te fleta mobile (pre-ekzistuese).
- `TaskDetailPanel.tsx:255,397` + `TaskDescriptionSection.tsx:36` — blur-save + "Ruaj" shkruajnë të njëjtën vlerë dy herë.

## F. Të verifikuara në rregull (për rekord)

Rules: klienti shkruan vetëm `clientApproval.{state,decidedAt,decidedByUid,decisionNote}` (83d-f); "Parë" vetëm nga vetja (83a/b); Viewer i bllokuar (39d, 82h); businessId/teamId/createdByUserId të pin-uar (82b, 39c); portal-i kurrë nga businessId; `/api/notify-staff` nxjerr tenant-in nga rekordi i thirrësit. UI: çdo Done kalon nga `completeTask` me `rawTasks` + `projects`; rihapja nga `reopenPatchFor`; `allTasks` në të tria montimet; bulk reassign njofton + pastron "Parë"; inline reschedule shpërndan `reminderPatchForDeadline`; picker-at e përgjegjësit të kufizuar pa `canAssignTasks`; kujtesat në panel nga `setReminderPatch` me null eksplicit; `addFrequency` mujore/vjetore me clamp në të dy kopjet; `seriesId`/`sameSeries` pa frekuencë; claim = transaksion; job-et skip-ojnë tenant-ët e pezulluar; `useMutation.create` nxjerr `customerId` nga projekti; upload host via `trustedFileHost`; komentet rendërohen si elemente React me `isSafeHref`; përshkrimi via Tiptap (pa `dangerouslySetInnerHTML`).
