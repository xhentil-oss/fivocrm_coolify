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
Auditi Android/UI/UX (18 Shtator 2026) — rregullimet e mbetura
14 gjetje, P0-P2 u rregulluan (shih workspace/ANDROID_UI_AUDIT_2026_09.md). Mbeten: (a) tregues offline/online — Firestore i vendos shkrimet ne radhe heshtazi ne celular dhe perdoruesi merr toast "u ruajt" per dicka qe s'ka mbritur ne server; (b) zevendeso 8 window.confirm/alert/prompt me AlertDialog — ne WebView shfaqen si dialogje sistemi me titullin "localhost"; (c) aria-label per 71 nga 83 butonat vetem-ikone. Pas rregullimeve: `npm run android:sync` dhe nje build i ri (versionCode u ngrit ne 31 sepse ndryshoi AndroidManifest).
</todo>

<todo>
Rregullo 6 P0-të e financave (audit 18 Shtator 2026)
Lista e plotë: workspace/FINANCE_BUGS_2026_09_18.md. (1) `invoice-reminders`/`overdue-reminders`/`recurring-expenses` pa skop biznesi në nisje manuale — një Admin i një qiraxhiu u dërgon email/WhatsApp klientëve të të gjithëve; (2) çelësat e periudhave llogariten në zonën e makinës, por cron-i ekzekutohet në UTC në Vercel dhe UI-ja në Europe/Tirane — seritë e shpenzimeve ose ngecin ose dyfishohen; (3) /app/bonus e hapur për çdo rol dhe shkarkon të gjitha rrogat; (4) porositë e dyqanit nga portali vijnë me çmim e status pagese nga shfletuesi; (5) klienti i portalit mund të rishkruajë çmimin e ofertës së vet.
</todo>

<todo>
Rregullo P1-të e financave: parashikimi, faturat dhe rrogat
workspace/FINANCE_BUGS_2026_09_18.md §P1. Parashikimi/MRR nuk pyet `isRecurring` dhe nuk normalizon frekuencën javore; projectPnl/departmentPnl numërojnë retainerë të anuluar; email-i i vonesës kërkon totalin bruto; `paidAt` humbet kur fatura krijohet e paguar; data e afatit zhvendoset një ditë në ruajtje; koleksionet `payments` dhe `expenseCategories` mungojnë te listat e skopit (query e mohuar); `status !== 'Active'` i zeron rrogat edhe në muajt e shkuar.
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
Scope the cron's invoice reads per tenant
`invoice-reminders`, `overdue-reminders` and `recurring-invoices` still read `invoices` cross-tenant (`where('status','==',…)`, `where('isRecurring','==',true)`), against the documented per-tenant cost rule. Belongs with the `tenantScopedDocs()` rollout — backlog #24 in the audit.
</todo>

<todo>
Deploy Expense Rules + Indexes
Rules tests pass 96/96 in the emulator. Deploy: firebase deploy --only firestore:rules,firestore:indexes (expenses rule now enforces keepsBusinessId, approver-only approvalStatus, re-approval on amount/date edit; indexes moved teamId -> businessId). See workspace/EXPENSES_AUDIT_2026_08.md.
</todo>

<todo>
Scope Expense Reads Per Role
Close the read half of finding #8: a Member can still read colleagues' Salary expenses from the console. Needs a per-role query (teamScopedWhere + createdByUserId), a (businessId, createdByUserId) index, and a fix for ProjectDetailView's burn-down read. Verify with real roles before deploying.
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

