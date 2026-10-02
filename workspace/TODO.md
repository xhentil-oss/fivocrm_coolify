<instructions>
This file powers chat suggestion chips. Keep it focused and actionable.

Rules:
- Each task must be wrapped in "<todo>" and "</todo>" tags.
- Inside each <todo> block:
  - First line: title (required)
  - Second line: description (optional)
- You should proactively maintain this file after each response, even if the user did not explicitly ask.
- Add tasks only when there are concrete, project-specific next steps from current progress.
- Do NOT add filler tasks. Skip adding if no meaningful next step exists.
- Keep this list high-signal and concise, usually 1-3 strong tasks.
- If there are already 3 strong open tasks, usually do not add more.
- Remove or rewrite stale tasks when they are completed, obsolete, duplicated, or clearly lower-priority than current work.
- Re-rank remaining tasks by current impact and urgency.
- Prefer specific wording tied to real project scope/files; avoid vague goals.
</instructions>

<!-- Add tasks here only when there are real next steps. -->

<todo>
Deploy audit-in e financave 30 Shtator + konfirmo shkakun e 25 shtatorit
workspace/FINANCE_AUDIT_2026_09_30.md — ~40 gjetje, të gjitha të rregulluara në kod (rregulla 178/178 në emulator, motorët 482 teste). Rregullat u deployuan dhe main u push-ua më 30 Shtator (6159276) — KUJDES: settlement-i i faturave (Paguar/Pjesërisht/Anuluar, këstet) është tani Admin/Manager-only. SHKAKU U GJET më 2 Tetor: VPS-ja ishte e vdekur 14 Shtator → 2 Tetor (një `npm start` i harruar mbante portën 3001, pm2 binte çdo 2 s me EADDRINUSE, 402 250 restarte) — asnjë orar s'u ekzekutua; u rregullua (kill + pm2 restart, uptime i verifikuar). Mbeten: (4) `node scripts/audit-retainer-billing.mjs --at=2026-09-25T08:00:00Z` (vetëm-lexim) — tregon për çdo retainer arsyen e bllokimit atë ditë dhe nëse run-all u regjistrua fare; faturo me dorë periudhat e kapërcyera. Strukturore, e pabërë: run-all mbetet 27 punë në një thirrje 60s — ndaje edhe punët e tjera në thirrje më vete nga VPS-ja.
</todo>

<todo>
Mbetjet e auditeve Android/UI/UX (te dy raundet, 18 Shtator 2026)
workspace/ANDROID_UI_AUDIT_2026_09.md. Te 21 gjetjet e te dy raundeve jane rregulluar. Keto tri mbeten sepse jane pune me e gjere, jo rregullime pikesore: (a) tregues offline/online - Firestore i vendos shkrimet ne radhe heshtazi ne celular, keshtu qe perdoruesi merr toast "u ruajt" per dicka qe s'ka mbritur ne server; (b) zevendeso 8 window.confirm/alert/prompt me AlertDialog - ne WebView shfaqen si dialogje sistemi me titullin "localhost"; (c) aria-label per 71 nga 83 butonat vetem-ikone. Pas cdo ndryshimi web: npm run android:sync.
</todo>

<todo>
Deploy audit-in e financave (rregulla, indekse, VPS)
Kodi i 18 Shtatorit është në pemë, i patestuar kundrejt prodhimit. Duhen: `firebase deploy --only firestore:rules` (klauzolat e reja `quotes` për portalin + `shopOrders` paymentStatus) dhe `--only firestore:indexes` (`quotes (customerId,status)` dhe `(leadId,status)`) — pa to numëruesi i ofertave në portal bie në 0; pastaj push në main (Vercel merr `api/cron/run.ts`) dhe `pm2 restart` në VPS. Provë e shpejtë: nis `invoice-reminders` manualisht nga një qiraxhi dhe shiko që përgjigja kthen `scopedTo` me biznesin e tij.
</todo>

<todo>
Nxirr rrogat jashtë `teamMembers` (P0 i mbetur i auditit)
workspace/FINANCE_BUGS_2026_09_18.md → "Still open". Rregullat ende i japin çdo anëtari biznesi leximin e `monthlySalary`/`salaryHistory` dhe të rreshtave `category: 'Salary'` te `expenses`; klienti nuk i dërgon më, por pyetja e drejtpërdrejtë punon. Plani: koleksion `teamMemberComp/{teamId}_{uid}` me `read` vetëm për vetveten dhe aprovuesit, backfill nga cron, periudhë me lexim të dyfishtë, dhe vetëm pastaj fshirja e fushave të vjetra. Kërkon ekzekutim kundrejt prodhimit, ndaj nuk u bë bashkë me pjesën tjetër.
</todo>

<todo>
Deploy WHMCS payment write-back + WhatsApp invoice reminders
Code shipped 2026-09-14 (workspace/WHMCS_SYNC.md). Left: `firebase deploy --only firestore:indexes` (new `invoices (status, dueDate)`), push to main (Vercel: /api/whmcs-payment + cron logic + UI), then Cilësimet → Automatizime → Kujtesa → switch on "Kujtesa faturash në WhatsApp" (burimi WHMCS, kanali, fazat) and — for Meta — an approved Utility template. Smoke test: mark a WHMCS test invoice Paid → badge `WHMCS ✓`, transid `fivocrm-…` visible in WHMCS.
</todo>

<todo>
Restart the VPS so the hourly `crm-automations` tick starts
Rules + indexes deployed and code pushed on 2026-09-07 (Vercel deploys from main). Left: `pm2 restart` on the VPS (vps/server.ts schedules the job), then CRM → Automatizime → Receta → arm the first rules. Checklist: workspace/CRM_AUTOMATION.md.
</todo>

<todo>
CRM enterprise roadmap — next after the rules engine
(2) customer lifecycle: `lifecycleStage` (onboarding/active/at-risk/churned), `renewalDate`, `contractValue`, `accountOwner` on Customer + renewal/NPS triggers in the engine; (3) multi-step sequences per segment (email + WA + task) replacing the single team-wide `leadCadenceDays`; (4) behavioural scoring (WA reply, email open, portal login, quote viewed) with per-tenant weights + routing by capacity/service; (5) Lead/Deal split (phase 5). Assessment in the 2026-09-07 conversation; the rules engine is the foundation all four sit on.
</todo>

<todo>
Decide the group-channel unread model (chat bug #11)
markAsRead writes a SHARED `isRead: true` on a group message, so the first member to open the channel zeroes everyone else's badge — and channelUnreadMap ignores `readBy` entirely. channel_message notifications now arrive while the badge beside them can read 0. Cheap fix (stop writing isRead for groups) vs correct fix (per-user channelReads lastReadAt): trade-off written up in workspace/CHAT_NOTIFICATIONS_AUDIT_2026_08.md.
</todo>

<todo>
Verify the chat-notification fixes on real devices
All 9 are implemented (workspace/CHAT_NOTIFICATIONS_AUDIT_2026_08.md). Left to confirm in production: a web push tap now lands on the conversation (the SW fix only applies after a deploy), a group-channel message reaches every member's bell/push exactly once, and DND/Tingull actually silence the chat chirp. The notificationThrottle rule rides along with the next firestore:rules deploy.
</todo>


<todo>
Deploy the invoice-module audit fixes
Rules deploy (invoiceItems is now staff-only write), VPS cron restart for the new period-key recurrence engine, then `node scripts/fix-orphan-invoice-items.mjs --apply`. Full checklist: workspace/INVOICES_AUDIT_2026_08.md.
</todo>

<todo>
Ndaj leximet e cron-it sipas qiraxhiut (vetëm çështje kostoje tani)
Nisja MANUALE e `invoice-reminders`/`overdue-reminders`/`recurring-expenses` u skopua më 18 Shtator (`manualScopeId()` në `api/cron/run.ts`), pra vrima ndër-qiraxhinj është mbyllur. Mbetet vetëm gjysma e kostos: nisja e planifikuar ende lexon `invoices` pa filtër (`where('status','==',…)`), kundër rregullit të dokumentuar "asnjë punë të mos lexojë një koleksion pa filtër". Shkon bashkë me nxjerrjen e `tenantScopedDocs()` — backlog #24.
</todo>

<todo>
Deploy Expense Rules + Indexes
Rules tests pass 96/96 in the emulator. Deploy: firebase deploy --only firestore:rules,firestore:indexes (expenses rule now enforces keepsBusinessId, approver-only approvalStatus, re-approval on amount/date edit; indexes moved teamId -> businessId). See workspace/EXPENSES_AUDIT_2026_08.md.
</todo>

<todo>
Standup History View
Add a dedicated view (or tab in DailyReportsView) to browse past morning standups by date/member.
</todo>

<todo>
Workload Reassign
From WorkloadView, allow drag-and-drop or quick-assign to move tasks between team members.
</todo>

## Hosting & Domain-e (Sep 15, 2026) — kodi gati, deploy në pritje
- [ ] `firebase deploy --only firestore:rules,firestore:indexes` (rules test 111/111 me JDK 21)
- [ ] Vercel env: `HOSTING_PROXY_URL=https://wa.fivocrm.com/provider-proxy` (ose lihet WHMCS_PROXY_URL) — `WHMCS_PROXY_SECRET` ekziston
- [ ] VPS: pull + pm2 restart (shton `/provider-proxy`, orarët `hosting-lifecycle` 60min / `hosting-sync` 360min)
- [ ] Whitelist IP-në e VPS te Dynadot (Tools → API) dhe te firewall-i WHM (porti 2087)
- [ ] Ndez modulin te tenant-i (Cilësimet → Modulet), shto serverin + token, paketat, TLD-të, çelësin Dynadot
- [x] Tab "Hosting" te Customer360View (abonimet + domain-et e klientit, lidhje te moduli)
- [x] "Shto llogari ekzistuese" / "Shto domain ekzistues" (migrim jashtë WHMCS; `.al` me `registrar: 'manual'`, rinovim me dorë pas pagesës)
- [x] Badge + filtër "Hosting & Domain-e" te Faturat (`source: 'hosting'`, lidhje te rekordi)
- [x] Siguria (10 pika): terminim opt-in + backup pkgacct para fshirjes; verifikim pronësie llogarie në WHM para SSO/passwd/suspend/terminate/add; refuzim çmimi 0; rate limit `domain.check`/`order.create`; relay vetëm te hoste WHM të regjistruar + pa IP private; ACL të kufizuara për token-in (runbook); enkriptim AES-GCM i kredencialeve (`SECRETS_ENC_KEY`); token i lidhur me hostname; SSO/passwd vetëm Admin/Manager + audit + njoftim klienti; email pa fjalëkalim; fushat lidhëse/faturuese vetëm server-side (rregulla + test 51f)
- [ ] Vercel env: `SECRETS_ENC_KEY` (openssl rand -base64 32) — pa të kasaforta mbetet plaintext (paralajmërim në log)
- [ ] Faza 2: kontakte WHOIS për klient te Dynadot (`create_contact` + `registrant_contact`) — sot regjistranti është llogaria jonë
- [ ] Faza 2: driver Plesk + regjistrues alternativ për .al; tiketa suporti të lidhura me abonimin; WordPress me një klik / SSL i menaxhuar
- [x] Upgrade paketë me proratë (kuotë + faturë diference, aplikohet pas pagesës; portal + staf)
- [x] DNS në portal: "Drejto te hosting-u" (set_dns2 A apex+www te IP e serverit ose IP manuale)
- [x] Hosting në Financat: MRR + rinovimet e muajit tjetër (kartelë + forecast + cashflow)
- [x] Sinkronizim javor i kostove TLD nga Dynadot + çmime të propozuara me marzh + alarm nën kosto
- [x] Backup i planifikuar pkgacct (çdo N ditë, 2 llogari/30 min) + lista e backup-eve; alarme disku ≥90 % dhe drift WHM 1/ditë; raport javor skadencash te menaxherët (e hënë 08:00)
- [x] Ri-provë automatike me backoff (15m→24h) për provisioning-un e dështuar
- [x] Domain falas me hosting vjetor (rregull per paketë) + kupona (percent/fixed, kufij, skadencë)
- [x] Rregullime: merge i dublikatave ri-drejton domains/hostingOrders/hostingEvents/hostingBackups; eksporti/fshirja GDPR përfshin gjithë koleksionet e hosting-ut
- [ ] VPS: pas pull-it shtohen `hosting-backups` (30 min) dhe `hosting-expiry-report` (e hënë 08:00) — restart pm2

