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
