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
Firestore "Quota exceeded" (RESOURCE_EXHAUSTED) eshte AKTIV ne VPS - kaloje projektin ne Blaze
Pare 13 Tetor 16:45 UTC ne /root/.pm2/logs/server-error.log (742 MB, 3 520 goditje "Quota exceeded", te fundit pas restart-it te dites: "Error updating receipt" nga agjenti WhatsApp). Kuota ditore e planit Spark (50K lexime) mbaron brenda dites, keshtu qe cdo pune cron ne Vercel qe prek Firestore pas asaj ore deshton heshtazi. Hapat: (1) Firebase Console -> Usage -> Blaze; (2) `pm2 install pm2-logrotate` ne VPS qe logu te mos rritet pa fund; (3) pasi te kaloje, kontrollo `platformJobRuns` per punet e sotme.
</todo>

<todo>
Vercel env + whitelist IP per hosting-un, pastaj ndez modulet ne UI
Vercel (CLI eshte i dale nga llogaria ketu): `HOSTING_PROXY_URL=https://wa.fivocrm.com/provider-proxy` (ose lihet WHMCS_PROXY_URL) dhe `SECRETS_ENC_KEY` (openssl rand -base64 32), pastaj redeploy. Whitelist IP-ne e VPS (65.109.132.203) te Dynadot (Tools -> API) dhe te firewall-i WHM (porti 2087). Ne app: Cilesimet -> Modulet -> Hosting; shto serverin + token, paketat, TLD-te, celesin Dynadot; Cilesimet -> Automatizime -> Kujtesa -> "Kujtesa faturash ne WhatsApp" (burimi WHMCS). Mbetur nga auditi i faturave: `node scripts/fix-orphan-invoice-items.mjs --apply` (shkrim ne prodhim, dry-run pa flamur).
</todo>

<todo>
Pas auditit te financave 30 Shtator: dergo faturat e shtatorit dhe kontrollo rolet
Gjithcka teknike u mbyll me 2 Tetor: shkaku i faturave/pagave te munguara ishte VPS-ja e vdekur 14 Shtator -> 2 Tetor (npm start i harruar mbante porten 3001; pm2 binte cdo 2 s) - u rregullua, uptime i verifikuar; 13 pagat e shtatorit dhe 22 faturat AUTO-2026-09-* u krijuan me scripts/audit-recurring-expenses.mjs / audit-retainer-billing.mjs --generate. Mbeten per pronarin: (1) Faturat -> filtro shtatorin -> kontrollo 22 faturat "Ne pritje" dhe dergoji me "Dergo" (nuk u derguan automatikisht); (2) nga 30 Shtatori "Paguar/Pjeserisht/Anuluar", kestet dhe kategoria "Paga" jane vetem Admin/Manager/pronar - ngri ne Manager ata qe i bejne; (3) me 25 Tetor verifiko qe 22 retainer-et u faturuan vete (paneli Faturimi i projektit tregon "Kontrolli i fundit"). Strukturore, e pabere: run-all mbetet 27 pune ne nje thirrje 60s.
</todo>

<todo>
Mbetjet e auditeve Android/UI/UX (te dy raundet, 18 Shtator 2026)
workspace/ANDROID_UI_AUDIT_2026_09.md. Te 21 gjetjet e te dy raundeve jane rregulluar. Keto tri mbeten sepse jane pune me e gjere, jo rregullime pikesore: (a) tregues offline/online - Firestore i vendos shkrimet ne radhe heshtazi ne celular, keshtu qe perdoruesi merr toast "u ruajt" per dicka qe s'ka mbritur ne server; (b) zevendeso 8 window.confirm/alert/prompt me AlertDialog - ne WebView shfaqen si dialogje sistemi me titullin "localhost"; (c) aria-label per 71 nga 83 butonat vetem-ikone. Pas cdo ndryshimi web: npm run android:sync.
</todo>

<todo>
Nxirr rrogat jashtë `teamMembers` (P0 i mbetur i auditit)
workspace/FINANCE_BUGS_2026_09_18.md → "Still open". Rregullat ende i japin çdo anëtari biznesi leximin e `monthlySalary`/`salaryHistory` dhe të rreshtave `category: 'Salary'` te `expenses`; klienti nuk i dërgon më, por pyetja e drejtpërdrejtë punon. Plani: koleksion `teamMemberComp/{teamId}_{uid}` me `read` vetëm për vetveten dhe aprovuesit, backfill nga cron, periudhë me lexim të dyfishtë, dhe vetëm pastaj fshirja e fushave të vjetra. Kërkon ekzekutim kundrejt prodhimit, ndaj nuk u bë bashkë me pjesën tjetër.
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
Ndaj leximet e cron-it sipas qiraxhiut (vetëm çështje kostoje tani)
Nisja MANUALE e `invoice-reminders`/`overdue-reminders`/`recurring-expenses` u skopua më 18 Shtator (`manualScopeId()` në `api/cron/run.ts`), pra vrima ndër-qiraxhinj është mbyllur. Mbetet vetëm gjysma e kostos: nisja e planifikuar ende lexon `invoices` pa filtër (`where('status','==',…)`), kundër rregullit të dokumentuar "asnjë punë të mos lexojë një koleksion pa filtër". Shkon bashkë me nxjerrjen e `tenantScopedDocs()` — backlog #24.
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
- [x] `firebase deploy --only firestore:rules,firestore:indexes` (verifikuar ne prodhim 13 Tetor 2026: 150/150 indekse, rregullat e 10 Tetorit)
- [ ] Vercel env: `HOSTING_PROXY_URL=https://wa.fivocrm.com/provider-proxy` (ose lihet WHMCS_PROXY_URL) — `WHMCS_PROXY_SECRET` ekziston
- [x] VPS: pull + pm2 restart (bere 13 Tetor 2026, commit 05306112; `hosting-lifecycle` tik ok)
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
- [x] VPS: pas pull-it shtohen `hosting-backups` (30 min) dhe `hosting-expiry-report` (e hënë 08:00) — restart pm2 (13 Tetor 2026)

