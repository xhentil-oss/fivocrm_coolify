# Handoff: WorkHub — Ridizajn i ekranit Chat (listë e unifikuar si WhatsApp)

> Shënim gjuhe: ky dokument është shqip për ekipin. Vlerat teknike (hex, px, emra fontesh) janë universale.

## Overview / Përmbledhje
Riorganizim i tab-it **Chat** të WorkHub (CRM / menaxhim klientësh). Versioni aktual i ndan bisedat në katër seksione vertikale (FivoAI, Grupet, Klientët, Mesazhe Direkte) me **dy fusha kërkimi** të ndara — duket i ngarkuar dhe i fragmentuar.

Ridizajni i bashkon të gjitha bisedat në **një listë të vetme, si WhatsApp**: klientë, staf, grupe pune dhe asistenti FivoAI, të renditura sipas kohës, me një kërkim të vetëm, filtra me chip-a lart, dhe një seksion "Të fiksuara".

## About the Design Files / Rreth skedarëve
Skedari `Chat Redesign.dc.html` është një **referencë dizajni e ndërtuar në HTML** — një prototip që tregon pamjen dhe sjelljen e synuar, **jo kod produksioni për t'u kopjuar direkt**. Detyra është të **rikrijohet ky dizajn brenda codebase-it ekzistues të WorkHub** (sipas frameworkut që përdorni — React Native / Flutter / React web / etj.), duke përdorur komponentët, navigimin dhe stilet tuaja ekzistuese. Përdorni README-në si specifikë; mos e importoni HTML-në si është.

`.dc.html` është një format "Design Component" i mjedisit ku u krijua — hapeni në browser për ta parë, por për kod referojuni përshkrimeve më poshtë.

## Fidelity
**High-fidelity (hifi).** Ngjyrat, tipografia, hapësirat dhe ndërveprimet janë finale. Rikrijojeni UI-në pixel-perfect me bibliotekat/komponentët ekzistues të codebase-it. Identiteti vjollcë i WorkHub është ruajtur (nuk ka lidhje me ndonjë design system tjetër).

---

## Screens / Views

### Ekrani: Lista e bisedave (tab "Chat")
**Qëllimi:** përdoruesi (agjent/staf) sheh të gjitha bisedat në një vend, filtron, dhe hap një bisedë.

**Layout (nga lart-poshtë), kolonë e vetme, full-width mobile:**
1. **Status bar** (ora, rrjeti, bateria) — pjesë e OS-it, jo e app-it.
2. **Header** — sfond gradient vjollcë, padding `6px 18px 18px`.
3. **Fusha e kërkimit** — brenda header-it, e vetme.
4. **Shiriti i filtrave** — chip-a horizontalë scroll-ueshëm, sfond i bardhë, border-bottom hairline.
5. **Lista e bisedave** — sfond i bardhë, scroll vertikal, flex:1.
6. **FAB** (buton "kompozo") — i pozicionuar absolute, bottom-right, nuk mbulon listën (lista ka 96px padding-bottom).
7. **Bottom nav** — 5 tab-e, lartësi 78px.

#### Komponenti: Header
- Sfond: `linear-gradient(135deg, #6C5CE7 0%, #5A4FD4 100%)`, tekst i bardhë.
- Rresht i sipërm: ikonë menu (hamburger, stroke 2.2, 22px) · titull · ikonë njoftime · avatar.
  - Titulli: eyebrow "WORKHUB" (11px, weight 600, uppercase, letter-spacing .14em, opacity .7) mbi "Mesazhe" (22px, weight 800, letter-spacing -.02em).
  - Butoni i njoftimeve: 40×40, radius 13px, sfond `rgba(255,255,255,.16)`, me pikë `#FF5C7A` (8px) lart-djathtas.
  - Avatari: 40×40 rreth, `rgba(255,255,255,.2)`, border `1.5px rgba(255,255,255,.35)`, inicial "A".
- **Kërkimi:** margin-top 16px, lartësi 46px, sfond `rgba(255,255,255,.16)`, border `1px rgba(255,255,255,.18)`, radius 14px, backdrop-blur 8px. Ikonë lupë + placeholder "Kërko bisedë, klient ose person…" (15px, weight 500, ngjyrë `rgba(255,255,255,.78)`). **Një kërkim i vetëm** zëvendëson të dy fushat e vjetra.

#### Komponenti: Filter chips (shirit horizontal)
- Container: flex, gap 8px, padding `14px 18px 12px`, overflow-x auto, scrollbar i fshehur, border-bottom `1px #f0eff5`.
- Chip: lartësi 36px, padding `0 16px`, radius 18px, font 13.5px weight 700, `white-space:nowrap`.
  - **Aktiv:** sfond `#6C5CE7`, tekst i bardhë, border transparent.
  - **Joaktiv:** sfond `#fff`, tekst `#6a6680`, border `1px #e8e6f0`.
- Chip "Pa përgjegjës" ka një pikë portokalli `#E8943A` (7px) para tekstit + numërues "3".
  - Numëruesi (aktiv): `rgba(255,255,255,.28)` / i bardhë; (joaktiv): `#f0eff5` / `#8a869c`, font 11px, padding `1px 7px`, radius 10px.
- Filtrat: **Të gjitha · Pa përgjegjës (3) · Klientë · Grupe · Staf.**

#### Komponenti: Section labels
- "TË FIKSUARA" (me ikonë pin) dhe "TË GJITHA BISEDAT": 11.5px, weight 700, letter-spacing .1em, ngjyrë `#b0acc0`, padding `13–14px 18px 4px`.

#### Komponenti: Rresht biseje (Conversation row) — i përbashkët për klient/staf/grup/AI
Struktura: `[avatar] [body: emër+tag / preview ........ kohë+badge]`. Divider hairline `1px #f3f2f8`, **i indentuar** (fillon pas avatarit — divider-i është border-top i bllokut "body", jo full-width). Rreshti i parë dhe rreshti që fillon një seksion të ri nuk kanë divider.

- **Row container:** flex, align stretch, padding-left 16px, cursor pointer; hover `background:#faf9fd`.
- **Avatar:** 48×48, `border-radius:50%`.
  - Klient/staf: sfond pastel + inicial(e) (15px, weight 700). Çiftet ngjyrë (sfond/tekst):
    - jeshile `#e3f3ea`/`#3a9e69`, jeshile-staf `#d8f0e6`/`#2f8d70`, teal `#e0f1f4`/`#2f8da0`, portokalli `#fbeede`(ose `#fbe7cf`)/`#c77a1e`(ose `#d98a2b`), blu `#dde6fb`/`#3f63d9`.
  - FivoAI: `linear-gradient(135deg,#7B5CF0,#9D6BF5)` + ikonë sparkle e bardhë, shadow `0 5px 14px -4px rgba(123,92,240,.6)`.
  - Grup: sfond `#ece8fb` + ikonë "users" stroke `#6C5CE7`.
  - **Pikë online** (vetëm staf): 13px, `#3FCB7E`, border `2.5px #fff`, bottom-right.
  - **Pin badge** (vetëm të fiksuara): rreth 20px i bardhë me ikonë pin `#8a7df0`, top-right, shadow `0 1px 4px rgba(40,30,80,.18)`.
- **Body:** flex:1, min-width:0, padding `12px 16px 12px 12px`, align center.
  - **Emri:** 15.5px, weight 700, ngjyrë `#1c1733`, ellipsis në një rresht.
  - **Tag** (pranë emrit, opsional): 10px, weight 700, uppercase, padding `2px 8px`, radius 8px. `AI` → `#ece6ff`/`#7B5CF0`; `Grup` → `#ece8fb`/`#6C5CE7`; `Klient` → `#e0f1f4`/`#2f8da0`.
  - **Preview:** 13.5px, ellipsis. Normal: weight 500, ngjyrë `#8a869c` (ose `#5a5670` nëse ka unread). **Pa përgjegjës:** weight 700, ngjyrë `#C77A1E`, me ikonë "alert-triangle" portokalli (13px) para tekstit.
  - **Meta djathtas:** kolonë, align end, gap 6px.
    - **Kohë:** 11.5px; me unread → weight 700 ngjyrë `#6C5CE7`, pa unread → weight 500 ngjyrë `#b3afc2`.
    - **Unread badge:** min 20px, lartësi 20px, padding `0 6px`, radius 10px, sfond `#6C5CE7`, tekst i bardhë 11px weight 700.

#### Komponenti: FAB
- position absolute, right 18px, bottom 96px, 58×58, radius 20px, `linear-gradient(135deg,#7B5CF0,#6C5CE7)`, shadow `0 12px 28px -6px rgba(108,92,231,.7)`, ikonë "message-plus" e bardhë.

#### Komponenti: Bottom nav
- Lartësi 78px, sfond `#fff`, border-top `1px #f0eff5`, shadow `0 -4px 20px -10px rgba(40,30,80,.12)`.
- 5 tab-e (flex:1 secili): **Home, Detyrat, Chat, Klientët, Më shumë.** Ikonë 24px stroke 2px + label 11px.
- Aktiv (Chat): ikonë & label `#6C5CE7` (weight 700); joaktiv `#a8a4b8` (weight 600).
- Chat ka badge "4" (`#FF5C7A`, i bardhë, border `2px #fff`) lart ikonës.

---

## Interactions & Behavior
- **Filtër:** prekja e një chip-i vendos `filter` dhe rifiltron të njëjtën listë (nuk navigon).
  - `all` → tregon "Të fiksuara" + "Të gjitha bisedat" (të gjitha llojet).
  - `unassigned` → vetëm bisedat me `unassigned: true`.
  - `clients` / `groups` / `staff` → vetëm ai lloj. Në çdo filtër ≠ `all`, seksioni "Të fiksuara" fshihet (listë e sheshtë).
- **Renditja:** të fiksuarat lart; pjesa tjetër sipas kohës më të fundit (recency).
- **Prekja e rreshtit:** hap bisedën përkatëse (navigim te ekrani i bisedës — jashtë këtij dizajni).
- **Hover (web):** rreshti → `#faf9fd`.
- **Të rekomanduara për t'u shtuar** (jo në prototip): swipe-actions (Arkivo, Cakto përgjegjës), pull-to-refresh.

## State Management
- `filter`: njëra nga `'all' | 'unassigned' | 'clients' | 'groups' | 'staff'` (default `'all'`).
- Modeli i bisedës (fusha): `type` (`ai|group|client|staff`), `name`, `tag`, `preview`, `time`, `unread?`, `online?`, `pinned?`, `unassigned?`, `avatar`.
- Numri "3 pa përgjegjës" duhet të jetë i derivuar nga `chats.filter(c => c.unassigned).length`, jo i koduar.
- Badge "4" në bottom nav = numri total i bisedave me mesazhe të palexuara.

## Design Tokens
**Ngjyra**
- Primare/brand: `#6C5CE7`; gradient header `#6C5CE7 → #5A4FD4`; gradient FAB/AI `#7B5CF0 → #6C5CE7` / `#9D6BF5`.
- Tekst: kryesor `#1c1733`, dytësor `#8a869c` / `#5a5670`, i zbehtë `#b3afc2` / `#b0acc0` / `#a8a4b8`.
- Sfonde: `#fff`, hover `#faf9fd`, divider `#f3f2f8`, border `#efeef4`/`#e8e6f0`/`#f0eff5`.
- Warning (pa përgjegjës): tekst `#C77A1E`, pikë/ikonë `#E8943A`, tint `#fcf1e2`/`#fbeede`.
- Online: `#3FCB7E`. Njoftime/badge: `#FF5C7A`. Teal (klient): `#2f8da0`/`#e0f1f4`.
- Avatar pastel: shih çiftet te "Rresht biseje".

**Tipografi**
- UI: **Plus Jakarta Sans** (400/500/600/700/800). Mono (ora): **JetBrains Mono** 500.
- Shkallët kryesore: titull header 22/800; emër 15.5/700; preview 13.5/500-700; kohë 11.5; tag/eyebrow 10–11.5/700 uppercase.

**Hapësira & forma**
- Radius: chip/avatar full (50%/18px), buton header 13px, FAB 20px, badge 10px, tag 8px.
- Padding rreshti: `12px 16px 12px 12px`; chips `0 16px`; header `6px 18px 18px`.

**Shadows**
- AI avatar: `0 5px 14px -4px rgba(123,92,240,.6)`
- FAB: `0 12px 28px -6px rgba(108,92,231,.7)`
- Bottom nav: `0 -4px 20px -10px rgba(40,30,80,.12)`

## Assets
- **Ikonat** janë SVG inline me stroke 2px, rounded join (stil Lucide/Feather): menu, bell, search, message-plus, users, alert-triangle, sparkle, home (grid), check-square, message, contacts, pin. Rekomandohet të përdorni librarinë tuaj ekzistuese të ikonave (p.sh. Lucide) me të njëjtët emra.
- **Avatarët** janë inicialë mbi sfond pastel — në produksion zëvendësoni me foto kur ka, ose mbani inicialin si fallback.
- Nuk ka imazhe binare; gjithçka është CSS/SVG.

## Screenshots
- `screenshots/01-lista-te-gjitha.png` — filtri "Të gjitha": seksioni "Të fiksuara" (FivoAI + grup) dhe "Të gjitha bisedat".
- `screenshots/02-filter-pa-pergjegjes.png` — filtri "Pa përgjegjës": vetëm klientët pa përgjegjës, me ikonë & tekst portokalli.

## Files
- `Chat Redesign.dc.html` — prototipi i plotë (listë e unifikuar si WhatsApp). Hapeni në browser për referencë vizuale; logjika e filtrave & modeli i të dhënave janë në klasën `Component` brenda tij.
