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
- [ ] Faza 2: proratë / faturë diference te ndryshimi i paketës brenda periudhës
- [ ] Faza 2: menaxhim DNS në portal (`dynadotSetDnsToIp` ekziston në driver, s'ka UI)
- [ ] Faza 2: abonimet hosting në MRR / parashikimin e arkëtimeve të Financave (burim i tretë për predikatin "do të faturohet")
- [ ] Faza 2: ri-provë automatike me backoff për rreshtat e dështuar të provisioning-ut (sot klikim nga stafi)
- [ ] Faza 2: bundle (domain falas me hosting vjetor) dhe kupona

