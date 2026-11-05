# FivoCRM në Coolify (self-hosted) — runbook

Vendosur: 5 Nov 2026. Kalon VETËM atë që ishte në Vercel (SPA + `/api`).
WhatsApp (Baileys) dhe planifikuesi i cron-eve MBETEN në VPS (`vps/server.ts`), pa ndryshim.

## Arkitektura

```
fivocrm.com ──► Coolify (Traefik, SSL) ──► kontejneri `Dockerfile`
                                             node dist-server/index.mjs
                                             ├─ dist/          (SPA, Vite)
                                             └─ api/*.ts       (TË NJËJTAT skedarë si në Vercel)
vps.fivocrm.com / wa.fivocrm.com ──► VPS (pm2) — WhatsApp + cron scheduler → CRM_BASE_URL
fivocrm.vercel.app / legacy.fivocrm.com ──► Vercel (rezervë, për app-et mobile të vjetra)
```

- `server/index.ts` = një proces Node: skedar statik nga `dist/` (si Vercel: filesystem
  para rewrite-ve), pastaj rewrite-et dhe header-at **të lexuara nga `vercel.json`** —
  një burim i vetëm, nuk ka kopje që mund të ndryshojë.
- `server/vercelShim.ts` = pjesa e runtime-it të Vercel që përdorin handler-at
  (`req.query/body`, `res.status/json/send/redirect`), `bodyParser: false` respektohet
  (Stripe/Meta/WHMCS verifikojnë nënshkrimin mbi bytes origjinale).
- Çdo `api/<emër>.ts` pa `_` duhet të jetë në `ROUTES` te `server/index.ts` — testi
  `server/vercelShim.test.ts` dështon nëse mungon. Funksionet ngarkohen në boot; nëse
  njëri dështon, `/healthz` kthen 503 dhe Coolify NUK e kalon deploy-in.
- Nuk ka kufi 12 funksionesh dhe as 60 s: `API_TIMEOUT_MS` (default 300 s) → 504.

## Subdomain-et

| Host | Ku | Shënim |
|---|---|---|
| `fivocrm.com`, `www`, `app` | Coolify | domain-i kryesor, pa ndryshim për përdoruesit |
| `staging.fivocrm.com` | Coolify (test) | provë para se të kalojë DNS-ja kryesore |
| `legacy.fivocrm.com` | Vercel | rezervë/rollback; `fivocrm.vercel.app` mbetet për app-et mobile |
| `vps`, `wa` | VPS | pa ndryshim |

Të gjitha janë te `RESERVED_SUBDOMAINS` (`src/hooks/usePortalTenant.ts`): çdo
`<x>.fivocrm.com` tjetër lexohet si portal i një tenant-i. **Shto host-in atje PARA se
ta drejtosh DNS-në.** Superadmin nuk lejon më një tenant me slug të rezervuar.

## Hapat në Coolify

1. **VPS i ri** (2 vCPU / 4 GB mjafton). MOS e instalo Coolify në VPS-në e WhatsApp-it:
   Traefik merr 80/443 dhe përplaset me `vps.fivocrm.com`.
2. New Resource → Public/Private Repository → `xhentil-oss/fivocrm`, branch `main`,
   **Build Pack: Dockerfile**, port **3000**, health check path `/healthz`.
3. **Environment variables** — të gjitha ato të Vercel (Settings → Environment Variables
   → kopjo). Ato `VITE_*` duhen me **"Build Variable"** të aktivizuar (Vite i fut në
   bundle gjatë build-it). `VERCEL_ENV=production` e vendos Dockerfile-i.
   Runtime: `FIREBASE_*`, `STRIPE_*`, `SMTP_*`, `CRON_SECRET`, `WHATSAPP_VPS_*`,
   `WHMCS_*`, `META_*`, `GOOGLE_*`, `OPENAI/GEMINI/ANTHROPIC_*`, `SECRETS_ENC_KEY`,
   `SUPER_ADMIN_EMAILS`, `APP_URL`/`PUBLIC_APP_URL` = `https://fivocrm.com`, etj.
4. Domains: fillimisht `https://staging.fivocrm.com`. Aktivizo gzip/compression te
   Coolify (serveri vetë nuk kompreson).
5. Testo në staging: login (Firebase Auth → shto `staging.fivocrm.com` te
   **Authorized domains**), një faturë me email, një pagesë Stripe test, portal-i,
   `curl -H "Authorization: Bearer $CRON_SECRET" "https://staging.fivocrm.com/api/cron/run?job=<job>&manual=1"`.
6. **Kalimi:**
   - Vercel: shto domain `legacy.fivocrm.com`, hiq `fivocrm.com`/`www`/`app`.
   - DNS: `fivocrm.com`, `www`, `app` → IP e Coolify; shto domain-et në Coolify.
   - Webhook-ët: Stripe, Meta, WHMCS → `https://fivocrm.com/api/...` (nëse tregonin
     `fivocrm.vercel.app`).
   - VPS: `CRM_BASE_URL=https://fivocrm.com` → `pm2 restart` **vetëm procesi i
     serverit** (asnjë proces i dytë mbi dosjen auth të Baileys).
   - Google OAuth (GMB/GSC/Social) redirect URI-të nëse tregonin `vercel.app`.
7. **App-et mobile**: `src/lib/nativeApi.ts` ka default `https://fivocrm.vercel.app`.
   Version i ri me `VITE_API_BASE_URL=https://fivocrm.com`. Vercel mbetet ndezur deri
   sa përdoruesit të kenë përditësuar.

## Rollback

DNS-ja e `fivocrm.com` kthehet te Vercel (Vercel ende ka të njëjtin kod dhe env) dhe
`CRM_BASE_URL` në VPS kthehet. Asgjë në Firestore nuk varet nga hosti.

## Lokal

```bash
npm run build && npm run build:server && VERCEL_ENV=production npm run start:server
```
