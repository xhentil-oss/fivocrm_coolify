# Audit Android / UI / UX — 18 Shtator 2026

14 gjetje. P0–P2 u rregulluan në të njëjtin seancë; tri të fundit mbeten në `TODO.md`.
Verifikimi: `npm run build` ✅, `npm run test` 1409/1409 ✅, `node scripts/android-configure.cjs`
idempotent ✅.

---

## P0 — prekin çdo pajisje me prekje

### 1. Checkbox-et dhe Switch-et shtrembëroheshin në 44×44 px
`src/index.css` — rregulli `@media (pointer: coarse)`.

Radix i jep `Switch`, `Checkbox` dhe `Radio` si `<button role="…">`. Rregulli i
target-it të prekjes vendoste `min-height/min-width: 44px` mbi çdo `button`, dhe
`min-*` fiton **gjithmonë** mbi `height/width` — pa lidhje me renditjen e
`@layer`. Pasoja: çdo checkbox 16×16 bëhej katror 44×44 me bordin e dukshëm, dhe
track-u i switch-it 36×20 bëhej 44×44, ku `translate-x-4` (16px) nuk e çonte
pikën askund pranë skajit — **on dhe off dukeshin njësoj në aplikacionin Android**.

Rregullimi: rolet `checkbox` / `switch` / `radio` (plus `[data-touch-target="none"]`)
dalin nga rregulli dhe mbajnë përmasën që deklaron komponenti. Etiketa pranë tyre
mbetet target-i i madh i prekjes.

### 2. `font-size: 16px` për input-et nuk aplikohej fare
Po aty. Selektori `input` (specificitet 0,0,1) humbet ndaj çdo klase Tailwind
`text-sm`/`text-xs` (0,1,0), pra mbrojtja kundër zoom-it të iOS nuk bënte asgjë.

Rregullimi: rregulli u zhvendos te `html.plt-ios input:not([type=checkbox])…`
(0,1,2 — e mund një klasë) dhe flamuri `plt-ios` vihet në `src/index.tsx` nga
user-agent-i. Android dhe desktop-i mbajnë tabelat e dendura pa ndryshim; vetëm
iOS ngrihet në 16px, ku zoom-i është bug real.

### 3. Butoni Back i Android regjistronte dëgjues të dublikuar
`src/components/AndroidBackButton.tsx`.

`useEffect` varej nga `location.pathname`, pra riekzekutohej në çdo navigim.
`handle` caktohej brenda një IIFE async me dy `await`, ndërsa cleanup-i i React-it
është sinkron — një navigim në mes të regjistrimit e linte `handle` `undefined`
dhe dëgjuesin e vjetër gjallë përgjithmonë. Çdo jetim hiqte hyrjen e vet nga
historiku: **një shtypje Back kërcente dy-tre ekrane**.

Rregullimi (i njëjti file):
- dëgjuesi regjistrohet **një herë**; route-i lexohet nga një `ref`;
- një flamur `cancelled` e heq dëgjuesin edhe kur cleanup-i vjen para regjistrimit;
- `registerBackDismiss()` — Back tani mbyll së pari atë që është hapur sipër:
  overlay-t Radix (me Escape) dhe, të regjistruar shprehimisht, sirtari i
  Sidebar-it (`App.tsx`) dhe fleta "Më shumë" (`MobileBottomNav.tsx`), të cilat
  rrojnë jashtë `<Routes>` dhe më parë mbeteshin hapur mbi faqen e re;
- pa histori dhe jashtë një ekrani rrënjë (hapje e ftohtë nga një njoftim push)
  shkon në dashboard në vend që ta **mbyllë aplikacionin**.

---

## P1

### 4. Footer-i i Sidebar-it fshihej nën bottom nav
`src/components/Sidebar.tsx`. Lartësia ishte `100vh - 72px - safe-top`, ndërsa
`MobileBottomNav` (i njëjti `z-40`, më vonë në DOM, pra sipër) zë `4rem + safe-bottom`
të fundit. Rreshti Profili / Cilësimet mbulohej plotësisht në çdo telefon.
Tani lartësia zbret edhe lartësinë e nav-it nën `lg`, dhe njësia u bë `dvh` që të
përputhet me bazën e shell-it të aplikacionit.

### 5. Toast-et dilnin nën header-in fiks
`src/components/ui/toast.tsx` — `top-[76px]` e fortë, ndërsa header-i është
`72px + var(--safe-area-top)`. Me inset 40px fshiheshin 36px e sipërme.
Tani `top-[calc(76px + var(--safe-area-top))]`, plus `sm:pb-[max(1rem,var(--safe-area-bottom))]`
për desktop-in.

### 6. FCM pa kanal njoftimesh (Android 8+)
`scripts/android-configure.cjs` + `src/hooks/usePushNotifications.ts`.

Manifesti kishte vetëm ikonën dhe ngjyrën; pa `default_notification_channel_id`
FCM binte në kanalin e vet fallback ("Miscellaneous"), të cilin disa OEM
(Xiaomi, Samsung) e krijojnë me importance të ulët — **pushet vinin pa zë dhe pa
banner**. Tani manifesti tregon te `fivocrm_default` dhe aplikacioni e krijon
kanalin me `importance: 5` para `register()`. Të dy vendet e mbajnë të njëjtin id;
mbaji të sinkronizuara.

`VERSION_CODE` 30 → 31, `VERSION_NAME` 1.8.2 → 1.8.3 (ndryshoi AndroidManifest-i,
pra duhet upload i ri).

### 7. Anulimi i Google Sign-In shfaqte gabim
`src/contexts/AuthContext.tsx`. Filtroheshin vetëm kodet `auth/popup-*`, por në
Android rrjedha kalon nga Credential Manager, që e raporton anulimin si gabim
plugin-i pa kod `auth/`. Mbyllja e fletës së Google nxirrte "Gabim gjatë hyrjes me
Google" me të kuqe. Tani `isSignInCancellation()` mbulon edhe kodet e Play
Services / Credential Manager dhe mesazhet e anulimit.

---

## P2

### 8. Butonat e dialogëve pa hapësirë në mobile
`ui/dialog.tsx` + `ui/alert-dialog.tsx`: hapësira ishte `sm:space-x-2`, pra vetëm
nga `sm` lart — të stivosur në telefon ngjiteshin. Tani `gap-2`.

### 9. Butoni X i dialogut rrëshqiste jashtë pamjes
`ui/dialog.tsx`. X-i ishte `absolute` kundrejt kutisë së përmbajtjes, e cila është
edhe kontejneri i scroll-it, pra zhdukej në formularët e gjatë. Tani rri në një
shirit `sticky top-0 h-0` si fëmija i parë (me `-mb-4` që të mos shtojë gap).
Gjithashtu `max-h` e dialogut llogarit tani safe-area.

### 10. Pika aktive e "Më shumë" te fundi i ekranit
`MobileBottomNav.tsx`: as `<nav>` as butoni nuk kishin `relative`, pra pika
`absolute bottom-1` zgjidhej kundrejt viewport-it. Shtuar `relative` (+ `aria-label`,
`aria-expanded`).

### 11. Ngarkimi i SVG-ve (XSS i ruajtur)
`RichTextEditor.tsx` dhe `TaskDetailPanel.tsx` ende pranonin `image/svg+xml` — një
SVG mban `<script>` dhe shërbehet nga origin-i i Storage-it. Hequr nga të dyja
(chat-i ishte rregulluar në Maj 2026; këto dy vende ishin lënë jashtë).

### 12. "Demo Mode" i dukshëm për klientët realë
`UserProfileView.tsx`: çdo pronar/menaxher shihte një çelës "Demo Mode" me profile
fiktive (`admin@demo.com`). Tani `import.meta.env.DEV &&`. Etiketa "Job Title" →
"Titulli i punës".

Bonus: `UserProfile` në `types/index.ts` nuk i deklaronte `jobTitle`, `department`,
`location`, `phoneNumber`, `skills` — që formulari i shkruan dhe i lexon. 16 gabime
typecheck më pak. (`skills` është `string` me JSON brenda, ashtu siç ruhet — mos e
"rregullo" në `string[]` pa migrim.)

### 13. `installNativeApiBase()` nuk mbulonte `URL` dhe prishte trupin e `Request`
`src/lib/nativeApi.ts`. `fetch(new URL('/api/x', origin))` shkonte drejt te
`https://localhost/api/x`, dhe `new Request(url, oldRequest)` e lexon `body` si
ReadableStream, të cilin Chrome e refuzon pa `duplex: 'half'`. Tani objektet `URL`
mbulohen, URL-të absolute same-origin rishkruhen, dhe `Request`-i rindërtohet
fushë për fushë me trupin e lexuar me `arrayBuffer()`.

---

## Mbeten (në `TODO.md`)

- **Tregues offline/online.** Firestore i vendos shkrimet në radhë heshtazi; në
  celular përdoruesi merr toast "u ruajt" për diçka që s'ka mbërritur në server.
- **8 × `window.confirm/alert/prompt`** (`TenantDetailView`, `CRMView`,
  `EmailTemplateManager`, `ReportDetailView`, `ReportingAdminView`,
  `CreateTenantDialog`, `CalculatorSettings`, `RichTextEditor`) → `AlertDialog`.
  Në WebView shfaqen si dialogë sistemi me titullin `localhost`.
- **`aria-label` për 71 nga 83 butonat vetëm-ikonë.**

## Shënim mbi typecheck-un

`npm run typecheck` nuk është portë pastër/e ndotur — kishte dhe ka gabime
ekzistuese (206 pas këtij ndryshimi). Asnjë prej tyre nuk është në kodin e prekur
këtu; `UserProfileView` kaloi nga 16 gabime në 0.

---

# Raundi 2 — analizë e thellë (i njëjti datë)

Fusha që raundi 1 nuk i preku: rrjedhje kujtese, kosto Firestore, gara asinkrone,
performancë, siguri në shtresën UI. 10 gjetje, të gjitha të rregulluara.
Verifikim: build ✅, 1463/1463 teste ✅.

## Tema: daljet native ekzistojnë, por shtatë vende i anashkalojnë

`saveOrShareFile()` dhe `openExternal()` janë në `src/lib/native.ts` pikërisht sepse
`<a download>` dhe `window.open` janë no-op në WebView. Shtatë thirrje nuk i përdornin,
dhe secila ishte një buton që në Android nuk bënte absolutisht asgjë — pa file, pa
gabim, pa toast.

| # | Vendi | Ishte | Tani |
|---|---|---|---|
| 1 | `CustomersView` eksport CSV | `<a download>` | `saveOrShareFile()` |
| 2 | `ExpensesView` eksport CSV | `<a download>` | `saveOrShareFile()` |
| 3 | `FinancesView` eksport CSV | `<a download>` | `saveOrShareFile()` |
| 4 | `TenantDetailView` eksport GDPR | `<a download>` | `saveOrShareFile()` |
| 5 | `HostingView` → Hyr në cPanel | `window.open` | `openExternal()` |
| 6 | `PortalHostingView` → Hyr në cPanel | `window.open` | `openExternal()` |
| 7 | `GmbReviewsView` → raporti Google | `window.open` | `openExternal()` |

`installExternalLinkHandler()` nuk i mbulonte këto: ai dëgjon klikime mbi `<a>`, kurse
`window.open` shkon drejt e te WebView.

## 8. Portali nuk i kishte marrë rregullimet e aplikacionit të stafit

`PortalLayout` u soll në të njëjtin model si `App.tsx`: një kolonë `h-[100dvh] flex flex-col`,
me navin e poshtëm si fëmijë **në rrjedhë** dhe jo `position: fixed` — modeli që stafi e
braktisi sepse mospërputhja layout-vs-visual viewport e Android WebView e shtyn një
shirit fiks jashtë ekranit në faqen e chat-it. Ana anësore tani ndalon mbi navin
(`bottom-[calc(4rem_+_var(--safe-area-bottom))] lg:bottom-0`), përndryshe navi i mbulonte
zërat e fundit — e njëjta gjë që u rregullua te `Sidebar` në raundin 1.

`PortalChatView` hoqi `h-[calc(100dvh-140px)]`. Numri nuk qëndronte: kroma reale është
4rem header + 4rem nav + 2rem padding = **160px pa insete**, dhe me një notch 40px +
gesture bar 20px shkon në **220px** — pra composer-i dilte 20px poshtë faqes në një
telefon të thjeshtë dhe ~80px nën navin në një Android edge-to-edge. Modaliteti
"shiko si klient" shtonte edhe 40px banner që formula s'i njihte fare. Tani është
`flex-1 min-h-0` brenda kolonës së layout-it, pra nuk ka numra për t'u mbajtur në sinkron.

## 9. `WhatsappInboxView` — i njëjti familje gabimi

`h-[calc(100dvh-180px)]` → kroma e numëruar: header + inset lart, padding-u i kolonës,
dhe (nën `lg`) navi + inset poshtë.

## 10. "U kopjua" shfaqej pa e ditur nëse u kopjua

`navigator.clipboard.writeText()` kthen Promise dhe refuzon pa një gjest të freskët
përdoruesi, në kontekst jo të sigurt, dhe në disa versione të Android WebView. Pesë nga
nëntë thirrjet nuk e prisnin fare rezultatin dhe shfaqnin toast-in në rreshtin tjetër —
përdoruesi lexonte "U kopjua", ngjiste, dhe s'kishte gjë. Refuzimi dilte vetëm si
`unhandled promise rejection`.

I ri: `src/lib/clipboard.ts` — `copyText()` (me fallback `execCommand` për WebView pa
Clipboard API) dhe `copyWithToast()`. Thirrësit: `ChatView` (×2), `LandingPagesView`,
`SettingsView`.

## 11. XSS brenda tenantit te pamja paraprake e email-eve

`EmailCampaigns` (×2) dhe `EmailTemplateManager` renderonin `dangerouslySetInnerHTML`
**pa sanitizim** — 3 nga 11 vendet; 8 të tjerat kalojnë nga DOMPurify ose `sanitizeHtml`.

Rëndësia: `emailTemplates` / `emailCampaigns` shkruhen nga `canCreateBusinessDoc()`
(= `isBusinessMember`, çdo rol). Një Member ruan `<script>` në një shabllon, Admini e
hap për ta parë, dhe kodi ekzekutohet në sesionin e Adminit me të drejtat e tij.

Zgjidhja **nuk** është `sanitizeHtml` — ai heq `<style>` dhe atributet e tabelave, pra
do t'i tregonte Adminit një pamje që s'përputhet me email-in që merr marrësi. I ri:
`src/components/EmailHtmlPreview.tsx` — `<iframe sandbox="" srcDoc={html}>`. Pa
`allow-scripts` dhe pa `allow-same-origin`: skriptet nuk ekzekutohen, frame-i nuk e
prek origin-in, cookie-t apo sesionin tonë Firebase, dhe layout-i del saktësisht si do
të dërgohet. **Mos i shto asnjërën nga ato dy vlera** — pa to kjo është dekor, jo kufi.

## Çfarë u kontrollua dhe doli e shëndetshme

- **Cache-i i listener-ave** (`useFirestore.ts`) është korrekt. Dyshimi fillestar —
  `teamScopedWhere` jashtë çelësit — ishte i pabazuar: është i palosur brenda `whereKey`
  si `tsw`, dhe `skipBusinessFilter` ndryshon `scopeId`, që gjithashtu është në çelës.
  `Sidebar` dhe `MobileBottomNav` **ndajnë** listener-in, nuk e dublojnë.
- `PriceSummary.handlePrint` u raportua gabimisht si bug në analizën e parë: dega
  `Capacitor.isNativePlatform()` me PDF + share ekziston që më parë; `window.open` është
  vetëm rruga web.
- Asnjë `catch {}` bosh në `src/`. `useFileUpload` përdor URL absolute (punon native).
  `addEventListener` pa `remove` vetëm në dy instalime globale njëhershe.
- Listat e mëdha nuk janë të virtualizuara por paginohen.

## Mbeten

Tregues offline/online · 8 × `window.confirm/alert/prompt` → `AlertDialog` ·
`aria-label` për 71 nga 83 butonat vetëm-ikonë.
