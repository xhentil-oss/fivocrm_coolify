# Hosting & Domain-e — moduli "WHMCS brenda FivoCRM" (Sep 2026)

Shitje hosting-u (cPanel/WHM) dhe domain-esh (Dynadot) me faturim periodik,
pezullim/terminim automatik për mospagesë, rinovim domain-esh pas pagesës dhe
portal klienti. Moduli `hosting` (`src/lib/modules.ts`), Pro, i fikur si default,
leje `canAccessHosting`. Staf: `/app/hosting`. Klient: `/portal/hosting`.

## 1. Arkitektura (kush vendos, kush ekzekuton)

```
src/lib/hosting/engine.ts  ── kopje byte-identike ──►  api/_hostingEngine.ts
   (cikle, çmime, parse domain, deriveCpanelUsername,
    decideSubscription / decideDomain me ARSYE të emërtuara,
    priceOrder, renewalInvoiceId)          ▲ test: engine.test.ts (34)
                                            │
UI (HostingView, PortalHostingView) ────────┘ shpjegon të njëjtën arsye që
        │ hostingApi(action)                  cron-i regjistroi
        ▼
api/_hosting.ts  (POST /api/hosting, ?type=hosting)  ─┐
api/cron/run.ts  ?job=hosting-lifecycle (çdo orë)     ├─► api/_hostingJobs.ts (ekzekutuesi)
                 ?job=hosting-sync      (çdo 6 orë)   │        │
api/stripe-webhook.ts (source: 'hosting' → paguar) ───┘        ▼
                                                    api/_hostingProviders.ts
                                                    (WHM API 1 · Dynadot api3)
                                                              │
                                              vps/server.ts /provider-proxy (IP statike)
```

- **Motori nuk njeh Firestore.** Çdo mos-veprim është një `SubscriptionBlockReason`
  / `DomainBlockReason` (etiketa në `*_BLOCK_LABELS`), kurrë një `continue` i heshtur.
- **Ekzekutuesi nuk vendos.** `_hostingJobs.ts` mbledh faktet, thërret motorin dhe
  ekzekuton: faturë, suspend, terminate, renew te regjistruesi, provisioning.
- **Driver-at nuk njohin asgjë.** `_hostingProviders.ts` = HTTP + parse; çdo gabim i
  ofruesit është një `ProviderError` me arsyen e ofruesit (redaktuar me
  `redactProviderError` para se të ruhet).

## 2. Koleksionet

| Koleksion | Çfarë | Kush shkruan |
|---|---|---|
| `hostingServers` | server WHM: hostname, port, user, NS, IP, `hasApiToken`, `packages`, shëndeti | stafi (Firestore) |
| `hostingServerSecrets/{serverId}` | `apiToken` i WHM — **`read, write: if false`** | vetëm `server.saveToken` (server) |
| `hostingProducts` | paketa: server + `whmPackage` + `pricing` për cikël + `portalVisible` | stafi |
| `domainTlds` | çmimet e shitjes për TLD (register/renew/transfer) + kosto Dynadot | stafi |
| `subscriptions` | llogaria hosting. **`source: 'whmcs'`** = pasqyrë WHMCS (ekzistuese), **`'fivocrm'`** = e faturuar nga ne | stafi + server |
| `domains` | domain-i i regjistruar (e njëjta ndarje `source`) | stafi + server |
| `hostingOrders` | porosia = 1 faturë + N rreshta; `status: Pending→Paid→Provisioning→Active/Failed` | **vetëm endpoint-i** |
| `hostingEvents` | audit append-only i çdo thirrjeje ofruesi / hapi cikli | **vetëm serveri** |
| `teamSecrets.dynadotApiKey` | çelësi Dynadot (përmes `writeTeamSecrets`, flag `hasDynadotApiKey`) | `registrar.saveKey` |
| `teamSettings.hostingLifecycle / hostingDefaultNameservers / dynadotCurrency / hostingLastRun` | konfigurimi + përmbledhja e ekzekutimit | stafi / cron |

Të gjitha janë në `businessIsolatedAlways` + `teamScopedCollections`; rregullat +
testet 51a–51e (`scripts/firestore-rules.test.mjs`, 111/111); indekset në
`firestore.indexes.json` (21 të reja).

## 3. Rrjedha e porosisë

1. `order.create` (staf me `customerId`, ose klient me `cid`): çmimet vijnë **nga
   katalogu**, kurrë nga body; domain-et që regjistrohen kontrollohen live te
   Dynadot; krijohet `hostingOrders/{id}` + fatura `hst_ord_<orderId>`
   (`source: 'hosting'`, `hostingOrderId`) + `invoiceItems`; fatura i dërgohet
   klientit me email (link "Paguaj").
2. Pagesa: Stripe webhook → `onHostingInvoicePaid` → `provisionOrder`.
   Pagesa manuale ("Paguar" te Faturat) → e kap `hosting-lifecycle` (çdo orë) ose
   butoni **Aktivizo** te Porositë.
3. `provisionOrder` — për rresht, idempotent (`sub_<orderId>_<i>`, `dom_<orderId>_<i>`):
   - hosting: `deriveCpanelUsername(domain, të zënat në server)` → WHM `createacct`
     (adopton nëse llogaria ekziston me të njëjtin domain) → email mirëseardhjeje
     me kredencialet (**e vetmja vend ku ekziston fjalëkalimi**) → `Active`,
     `nextDueDate = tani + cikli`, `anchorDay`.
   - domain: Dynadot `register` (adopton nëse është tashmë në llogari) → `set_ns`
     (NS të llogarisë hosting në të njëjtën porosi → default i ekipit → të Dynadot)
     → `Active` me `expiryDate` nga regjistruesi.
   - transferim: Dynadot `transfer` → mbetet `Pending`; `hosting-sync` e kalon
     `Active` kur regjistruesi e liston.
   - një rresht i dështuar ruan `provisionError`; porosia → `Failed`; stafi
     njoftohet (`hosting_provision_failed`) dhe riprovon.

## 4. Cikli i jetës (`hosting-lifecycle`, çdo orë nga VPS, JO në run-all)

Konfigurimi `teamSettings.hostingLifecycle` (default 14 / 7 / 30 / 30 / 30):

| Abonim | Kur | Veprim |
|---|---|---|
| `invoiceDaysBefore` ditë para `nextDueDate`, një herë për afat (`lastInvoicedDueKey`) | faturë `hst_sub_<id>_<dueKey>` me `create()` → `currentInvoiceId`, email + `hosting_renewal_invoice` |
| fatura paguar (`currentInvoiceId` == fatura e paguar) | `applySubscriptionRenewal`: `nextDueDate += cikli` (me `anchorDay`, kurrë `setMonth`), unsuspend nëse ishte për mospagesë, `currentInvoiceId = null` |
| e papaguar, `suspendDaysAfter` ditë pas afatit | WHM `suspendacct` (`suspendReason: 'non-payment'`) + `hosting_suspended` |
| e pezulluar, `terminateDaysAfter` ditë pas afatit (0 = kurrë) | WHM `removeacct` (**fshin skedarët**) + `hosting_terminated` |
| `cancelAtPeriodEnd` | asnjë faturë; terminohet në ditën e afatit |
| `lifecycleHold` | asgjë automatike |

| Domain | Kur | Veprim |
|---|---|---|
| `domainInvoiceDaysBefore` ditë para `expiryDate`, një herë (`lastInvoicedExpiryKey`) | faturë `hst_dom_<id>_<expiryKey>` |
| fatura paguar | Dynadot `renew` → `expiryDate` i ri, `renewedAtRegistrarForKey` (guard dyfishimi) |
| e papaguar, pas skadencës | `Grace` + `domain_expiring`; pas `domainGraceDays` → `Expired`, fatura anulohet |
| `autoRenew: false` | asnjë faturë, vetëm Grace → Expired |

Rregulla: rinovimi automatik **te Dynadot** mbetet i fikur — rinovojmë vetëm pas
pagesës së faturës sonë (stafi mund ta ndezë me `domain.registrarAutoRenew`).
Tenant-ët `status: 'suspended'` anashkalohen. Përmbledhja për ekip →
`teamSettings.hostingLastRun` (shfaqet te Cilësimet).

## 5. Endpoint-i `POST /api/hosting` (body.action)

Staf: `server.saveToken` `server.test` `registrar.saveKey` `registrar.test`
(Admin/Manager) · `domain.check` · `order.create` `order.provision` `order.cancel` ·
`sub.suspend` `sub.unsuspend` `sub.terminate` (Admin + `confirm` = username/domain)
`sub.changePackage` (nga fatura tjetër, pa proratë) `sub.setHold` ·
`domain.setHold` `domain.registrarAutoRenew` · `lifecycle.run` `sync.run` (scoped te `bid`).

Staf **dhe** klient (vetëm rekordet e veta, `customerId == cid`): `domain.check`,
`order.create`, `sub.sso` (URL një-herëshe `create_user_session`), `sub.usage`,
`sub.resetPassword`, `sub.cancelAtPeriodEnd`, `domain.setNameservers`,
`domain.setAutoRenew`, `domain.setPrivacy`, `domain.authCode`.

Autorizimi: `bid` (staf) / `cid` (portal) nga claims; fallback te `teamMembers` për
token-a të vjetër. Çdo rekord ngarkohet dhe krahasohet me claims — id-të nga body
nuk besohen kurrë për tenancy.

## 6. Ofruesit

**cPanel/WHM** (API 1, `https://host:2087/json-api/<fn>`, header
`Authorization: whm user:token`, gjithmonë POST): `version`, `listpkgs`,
`listaccts`, `accountsummary`, `createacct`, `suspendacct`, `unsuspendacct`,
`removeacct`, `changepackage`, `passwd`, `create_user_session`.
Token: WHM → Development → Manage API Tokens (privilegje: `create-acct`,
`suspend-acct`, `kill-acct`, `passwd`, `list-accts`, `create-user-session`,
`list-pkgs`, `basic-whm-functions`).

**Dynadot** (API v3, `https://api.dynadot.com/api3.json`, `key=&command=`):
`account_info`, `search` (+`show_price`), `register`, `renew`, `transfer`,
`domain_info`, `set_ns`, `set_dns2`, `set_privacy`, `set_renew_option`,
`get_transfer_auth_code`, `list_domain`. Çelësi: Dynadot → Tools → API.
**Dynadot pranon vetëm IP të whitelist-uara** → shto IP-në e VPS-së.

**Relay-i** (`vps/server.ts` → `POST /provider-proxy`, `x-api-key` = `API_SECRET`):
lejon vetëm `https` dhe (host `api.dynadot.com` ose port `2087/2083`); përcjell
vetëm header-at `authorization/content-type/accept`; nuk ruan asgjë.
Në Vercel: `HOSTING_PROXY_URL=https://wa.fivocrm.com/provider-proxy` (ose lihet
`WHMCS_PROXY_URL` — rruga `/whmcs-proxy` rishkruhet automatikisht) +
`WHMCS_PROXY_SECRET`. Pa proxy → thirrje direkte (vetëm për zhvillim me IP të
whitelist-uar).

## 7. Migrim nga WHMCS

Rreshtat `source: 'whmcs'` vazhdojnë të pasqyrohen nga `whmcs-sync` dhe **nuk**
faturohen nga ne (`not-ours`). Te Shërbimet → rreshti WHMCS → **"Merr nën
menaxhim"**: stafi zgjedh serverin + username-in e cPanel-it; rreshti bëhet
`source: 'fivocrm'`, cikli përkthehet me `cycleFromWhmcs`, `anchorDay` = dita e
afatit, dhe FivoCRM lëshon faturën për afatin **aktual** (`lastInvoicedDueKey` mbetet
`null` — një version i parë e pretendonte afatin dhe cikli e trajtonte periudhën si
"e faturuar, e papaguar" dhe e pezullonte llogarinë në ditën e afatit). Anulo
shërbimin dhe faturën e papaguar në WHMCS që të mos faturohet dy herë — kjo është e
vetmja hapi manual.

**Llogari/domain-e që s'vijnë nga WHMCS** shtohen me "Shto llogari ekzistuese" /
"Shto domain ekzistues" (Shërbimet / Domain-et): rekordi krijohet i provizionuar, me
afatin e radhës që shkruan stafi; nuk thirret asnjë ofrues. Një domain me
`registrar` të ndryshëm nga `dynadot` (p.sh. `.al`) faturohet normalisht, por pas
pagesës `applyDomainRenewal` vetëm shtyn skadencën, regjistron
`domain.renewManual` dhe njofton stafin ta rinovojë me dorë te regjistruesi.

## 8. Instalimi / deploy

1. `firebase deploy --only firestore:rules,firestore:indexes` (pas `npm run test:rules`
   me JDK 21 — 111/111).
2. Vercel env: `HOSTING_PROXY_URL` (ose `WHMCS_PROXY_URL`) + `WHMCS_PROXY_SECRET`.
3. VPS: `git pull`, `pm2 restart` — shton `/provider-proxy` dhe orarët
   `hosting-lifecycle` (60 min) / `hosting-sync` (360 min). Whitelist IP-në e VPS te
   Dynadot dhe te firewall-i i WHM (porti 2087).
4. Tenant: Cilësimet → Modulet → ndez "Hosting & Domain-e"; roli duhet të ketë
   `canAccessHosting` (Admin/Sales/SalesAgent e kanë; Member/Manager me kuti).
5. `/app/hosting` → Serverët (hostname + token → "Testo" mbush paketat) → Paketat →
   TLD-të (kosto + marzh → "Propozo çmimet") → Cilësimet (çelësi Dynadot, ditët).

## 9. Siguria (rishikimi i 15 shtatorit 2026)

| Rrezik | Mbrojtja |
|---|---|
| Terminimi fshin skedarët | `terminateDaysAfter` default **0** (opt-in). Kur terminohet, `pkgacct` (backup i plotë në `/home/cpmove-<user>.tar.gz`) bëhet PARA `removeacct`; nëse dështon, terminimi **ndalet** (vetëm `force: true` nga një njeri e kalon). `lastBackupAt/Path` te abonimi. |
| Marrja e një llogarie të huaj në server të ndarë | `assertAccountOwned`: para SSO / passwd / suspend / unsuspend / terminate / changepackage / addExisting / adoptWhmcs, `accountsummary` duhet të kthejë të njëjtin domain si abonimi. Krijimi dhe fushat lidhëse (`cpanelUsername`, `serverId`, `status`, `nextDueDate`, …) janë **vetëm server-side** (rregullat, test 51f). |
| Porosi me çmim 0 | motori refuzon domain me çmim 0 (`domain-zero-price`); porosia e portalit me total 0 refuzohet. |
| Spam te Dynadot / fatura | `hostingRateLimits/{uid}_{action}` (deny-all): `domain.check` 30/orë klient, 120/orë staf; `order.create` 10/ditë klient, 60/ditë staf; max 3 porosi të papaguara per klient. |
| Relay si SSRF | `/provider-proxy`: https vetëm; host `api.dynadot.com` ose portë 2087/2083 **dhe** hostname i regjistruar te `hostingServers`; refuzon IP private/loopback (edhe pas DNS). |
| Token root i plotë | UI dhe runbook kërkojnë token me ACL të kufizuara (lista te §6). |
| Kredenciale në tekst të hapur | `api/_secretCrypto.ts`: AES-256-GCM me `SECRETS_ENC_KEY` (32 byte base64) për `teamSecrets` dhe `hostingServerSecrets`; plaintext i vjetër lexohet ende dhe ri-enkriptohet në shkrimin tjetër; `SECRETS_ENC_KEY_PREVIOUS` për rotacion. |
| Rrjedhje token-i me ndryshim hostname | token-i ruhet **i lidhur** me hostname + user; nëse `hostingServers.hostname` ndryshon, `loadServer` kthen token bosh + `tokenIssue` ("rifut token-in"). |
| SSO/passwd nga çdo anëtar | vetëm Admin/Manager për stafin; `writeAudit` (`hosting.sub.sso`, `hosting.sub.resetPassword`); klienti njoftohet (`hosting_staff_login`) për çdo hyrje ose ndryshim fjalëkalimi nga stafi. |
| Fjalëkalim me email | email-i i mirëseardhjes s'ka fjalëkalim: hyrje me SSO nga portali, "Fjalëkalim i ri" shfaqet një herë. |

Env i ri në Vercel: `SECRETS_ENC_KEY` (gjenero: `openssl rand -base64 32`). Pa të,
kasaforta shkruan plaintext dhe logon një paralajmërim — asgjë nuk prishet.

## 10. Kufizime të njohura (me qëllim)

- **Pa proratë** te ndryshimi i paketës — çmimi i ri vlen nga fatura tjetër.
- **Pa kontakte WHOIS për klient** — regjistrimi përdor kontaktet default të
  llogarisë Dynadot (privatësia ndizet nga UI). Faza 2: `create_contact` +
  `registrant_contact` për klient.
- **Domain-et `.al`**: Dynadot nuk i ofron; TLD-ja mund të shitet vetëm si "manual"
  (regjistrim jashtë sistemit, stafi krijon rreshtin `registrar: 'manual'`).
- **Termini fshin skedarët** (`removeacct`) — i fikur si default; me backup para fshirjes kur ndizet.
- Rinovimi te regjistruesi ndodh vetëm pas pagesës; nëse Dynadot dështon, fatura
  mbetet e paguar, `provisionError` shfaqet dhe stafi njoftohet
  (`domain_action_failed`) — nuk ka ri-provë automatike përtej ekzekutimit tjetër.
- Vlera "MRR" e kartelës në HostingView është orientuese (ALL përafrohet).
