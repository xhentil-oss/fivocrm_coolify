# WHMCS ↔ FivoCRM — pagesat dhe kujtesat (Sep 2026)

Runbook për dy pyetjet e 14 shtatorit 2026: *"nëse një pagesë bëhet brenda në
FivoCRM, a pasqyrohet në WHMCS?"* dhe *"a mund t'i çojmë njoftimet e faturave të
papaguara edhe në WhatsApp për WHMCS?"*. Arkitektura e sinkronizimit
WHMCS → FivoCRM (klientë, fatura, produkte, domain-e) është e pandryshuar; shih
`api/_whmcsSync.ts` dhe kujtesën `whmcs-sync-clients`.

## 1. Pagesa FivoCRM → WHMCS

### Si ishte
- **Vetëm Stripe** shkruante te WHMCS: `stripe-webhook.ts` → `pushInvoicePayment`
  (`AddInvoicePayment`, transid = payment_intent).
- "Shëno si Paguar" (drawer, forma e plotë) dhe "Regjistro pagesë" (e pjesshme)
  nga InvoicesView **nuk** thërrisnin WHMCS. WHMCS mbetej me faturën të papaguar,
  vazhdonte kujtesat e veta, mund të pezullonte shërbimin.
- **Sinkronizimi e kthente mbrapsht:** `upsertInvoice` rishkruante gjithmonë
  `status` + `paidAt` nga WHMCS (mbrojtja `locallyCancelled` vlente vetëm për
  anulime). Në `run-all` të nesërmen fatura rikthehej Pending/Overdue dhe
  `paidAt` fshihej.

### Si është tani (radha `whmcsPendingPayments`)
```
UI (InvoicesView)                     Server
─────────────────                     ──────
status → Paid  ┐ NJË update:          POST /api/whmcs-payment {invoiceId}
paidAt         ├ + whmcsPendingPayments:[{key,amount?,method,paidAt}]
               ┘ + whmcsPaymentPendingAt      │
      │                                       ▼
      └── pushWhmcsPayment() ──────►  drainPendingWhmcsPayments(writeBack:true)
                                        transid = fivocrm-<docId>-<key>
                                        gateway = whmcsGatewayForMethod(method)
                                        OK  → whmcsPaymentSyncedAt, whmcsSyncedPaymentKeys+=key,
                                              radha zbrazet, error fshihet
                                        KO  → whmcsPaymentSyncError, radha mbetet

whmcs-sync (run-all) → upsertInvoice:
  • radha jo bosh & WHMCS ≠ Paid → drain (retry) + RUAN status/paidAt lokal
  • WHMCS = Paid                 → zbraz radhën, fshi error/pendingAt
  • lokal Paid + çelësa të sinkronizuar & WHMCS Pending/Overdue → ruan lokalen
    (pagesa u postua; WHMCS ende sheh balancë — rakordim manual në WHMCS)
  • lokal Partial (paidAmount>0) & WHMCS ≠ Draft → ruan 'Partial'
```
- **Çelësat:** `'full'` = mbyll gjithë balancën (amount nuk dërgohet, WHMCS e
  mbyll në monedhën e vet); `p<index>` = kësti me indeksin e tij në
  `partialPayments` (i njëjti skemë me ledger-in `payments.sourceKey`).
- **Idempotencë:** transid deterministik; "transaction id already exists" në
  WHMCS = sukses. Ri-shënimi pas një çshënimi nuk poston dy herë
  (`whmcsSyncedPaymentKeys`).
- **Gateway:** `Cash/kesh` → `mailin`, `Bank/Transfer` → `banktransfer`,
  `Card/Stripe` → `stripe`, `PayPal` → `paypal`, tjetër → env
  `WHMCS_MANUAL_GATEWAY` (default `banktransfer`).
- **Autorizimi** (`api/_whmcs-payment.ts`): staf i biznesit të faturës (`bid`
  claim; fallback doc `teamMembers`), kurrë `cid`. Serveri lexon vetëm
  `invoiceId` nga body — shumat/çelësat vijnë nga dokumenti.
- **UI:** badge `WHMCS` (gri = pasqyrë, verdhë `…` = në pritje, kuq `✕` = gabim
  me mesazhin në tooltip, jeshil `✓` në drawer) + butoni **Riprovo WHMCS** në
  drawer. Toast-i i gabimit thotë qartë "pagesa u ruajt, WHMCS nuk u përditësua"
  — kurrë "pagesa dështoi".
- Endpoint-i kalon përmes `api/email.ts` (`?type=whmcs-payment`) + rewrite në
  `vercel.json` — kufiri 12 funksione.

### Çfarë NUK bën
- Nuk krijon fatura në WHMCS dhe nuk ndryshon shuma/afate — WHMCS mbetet burimi
  i së vërtetës për gjithçka përveç *"kjo pagesë u mor"*.
- Një rimbursim/anulim në WHMCS (status → Draft) **fiton** ndaj statusit lokal
  Paid: është një kthim real, jo një mospërputhje.

## 2. Kujtesa faturash në WhatsApp (edhe për WHMCS)

### Si ishte
- `overdue-reminders` (VPS, çdo 2 orë) dërgonte email javor vonese për **çdo**
  faturë Overdue — përfshirë ato WHMCS, që WHMCS i dërgon vetë (dublim).
- WhatsApp: vetëm Meta + template, vetëm pas `waOverdueDays` (60), pa
  `waOptOut`, pa orar, pa arsye bllokimi (heshtje).
- Faturat WHMCS krijohen me `reminderSent/reminder25Sent/reminderLastDaySent =
  true` dhe `createdByUserId = null`, kështu asnjë kujtesë FivoCRM nuk dilte për
  to — as për stafin.

### Si është tani
- **Motori:** `src/lib/finance/invoiceWaReminders.ts` (i pastër, 32 teste) —
  `api/_invoiceWaReminders.ts` është kopje **byte-identike**; testi lexon të dy
  skedarët dhe bie në çdo ndryshim. `invoiceWaDecision()` është **porta e
  vetme**; çdo mos-dërgim ka arsye të emërtuar:
  `disabled · source-mismatch · settled · zero-balance · no-due-date · not-due ·
  already-sent · no-customer · customer-opt-out · wa-opt-out · no-phone ·
  outside-hours · no-channel · no-template`.
- **Fazat** (stampë idempotence në faturë): `pre-due` → `preDueWaSentAt`
  ("skadon për N ditë", një herë), `due` → `dueWaSentAt` ("skadon sot", një
  herë), `overdue` → `overdueWaSentAt` (pas `waOverdueDays`, çdo
  `waInvoiceRenotifyDays`). Dita numërohet kalendarikisht në Europe/Tirane.
- **Burimi:** `waInvoiceSources` = `all | whmcs | fivocrm`.
- **Kanali:** `meta` (template i aprovuar; `paramFields` pranon `name,
  firstName, invoiceNumber, amount, currency, dueDate, dueText, daysLate, link,
  whmcsLink`) ose `baileys` (tekst i lirë `waInvoiceText` me token-e; token i
  panjohur = bosh; pa `{{link}}` linku shtohet në fund; `waInvoiceAgentId`
  opsional).
- **Orari:** `waInvoiceHourStart/End` (default 09–19 lokal) — job-i ecën çdo 2
  orë, dritarja është ajo që ndalon mesazhin e orës 03:00.
- **Email:** `overdueEmailSkipWhmcs` — mos dërgo email-in javor FivoCRM për
  faturat WHMCS.
- **Raport:** `teamSettings.waInvoiceLastRun = {at, sent, considered, blocked}`
  → paneli tregon "38 shqyrtuar → 5 dërguar · 20 jashtë orarit · 9 pa telefon".
- **Stafi:** krijuesi i faturës merr `invoice_reminder_sent` (bell, pa email).
  Faturat WHMCS s'kanë krijues — asgjë.
- UI: Cilësimet → Automatizime → "Ndjekja & Përgjigjet automatike" → karta
  **Kujtesa** (`FollowUpSettingsPanel`, seksioni `reminders`).

### Query + indeks
`overdue-reminders` lexon `status == 'Overdue'` (si më parë) **plus**
`status in ['Pending','Partial'] && dueDate <= now+30d` → indeks i ri
`invoices (status ASC, dueDate ASC)` në `firestore.indexes.json`. Pa indeks
query-ja e dytë logon dhe anashkalohet; email-et e vonesës vazhdojnë.

## Deploy
1. `firebase deploy --only firestore:indexes` (indeksi i ri).
2. Push në `main` → Vercel (endpoint + cron logic + UI).
3. Vercel env (opsional): `WHMCS_MANUAL_GATEWAY` nëse WHMCS s'ka `banktransfer`.
4. Ndiz: Cilësimet → Automatizime → Kujtesa → "Kujtesa faturash në WhatsApp",
   zgjidh burimin `WHMCS`, kanalin, fazat. Për Meta: template Utility i
   aprovuar me parametrat e mësipërm.
5. Provë: shëno një faturë WHMCS testuese si Paguar → badge `WHMCS ✓` brenda
   sekondash; kontrollo transaksionin në WHMCS (transid `fivocrm-…`).

## Kufizime të njohura
- `overdue-reminders` lexon `invoices` kryq-tenant (si `invoice-reminders`) dhe
  ekzekutimi manual s'është i kufizuar në `bid` — backlog #24 i auditit të
  faturave.
- Meta jashtë dritares 24h kërkon template të aprovuar; Baileys është numër
  jo-oficial (rrezik bllokimi për volume të mëdha).
- Pagesa e pjesshme në WHMCS mbetet "Unpaid me balancë"; statusi `Partial`
  jeton vetëm në FivoCRM.
