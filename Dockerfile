# FivoCRM web (SPA + /api) for Coolify / any Docker host.
# WhatsApp (Baileys) and the cron scheduler are NOT here — they stay on the VPS
# (vps/server.ts); point its CRM_BASE_URL at this deployment.
# Runbook: workspace/COOLIFY_DEPLOY.md

# ── build ────────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS build
WORKDIR /app

# Vite bakes VITE_* into the bundle (and the Firebase config into the messaging
# service worker) at BUILD time. In Coolify tick "Build Variable" on each of these.
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_VAPID_KEY
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_STRIPE_PUBLISHABLE_KEY
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_ORG
ARG VITE_SENTRY_PROJECT
ARG VITE_SUPER_ADMIN_EMAILS
ARG VITE_API_BASE_URL
ARG VITE_APP_URL
ARG VITE_APP_BASE_URL
ARG VITE_VPS_URL
ARG VITE_VPS_FILES_URL
ARG VITE_DEFAULT_BUSINESS_ID
ARG VITE_DEFAULT_TEAM_ID

COPY package.json package-lock.json ./
# `npm install`, not `npm ci`: package-lock.json is currently out of sync with
# package.json (@types/react), and Vercel installs the same way.
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build && npm run build:server && npm prune --omit=dev --no-audit --no-fund

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    # Production trust boundary: without it platformHosts() / the WhatsApp relay also
    # accept localhost (api/_callerIdentity.ts, api/whatsapp.ts).
    VERCEL_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/vercel.json ./vercel.json

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/index.mjs"]
