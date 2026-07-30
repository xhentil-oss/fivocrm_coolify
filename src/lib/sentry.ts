import * as Sentry from '@sentry/react';
import { Capacitor } from '@capacitor/core';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;

export function initSentry() {
  if (!SENTRY_DSN) return;

  const isNative = Capacitor.isNativePlatform();

  // Session Replay instruments the whole DOM and ships recordings — too heavy
  // for a low-end phone in a WebView, so we disable it on native and keep only
  // lightweight tracing.
  const integrations = isNative
    ? [Sentry.browserTracingIntegration()]
    : [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
      ];

  const run = () =>
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: import.meta.env.MODE,
      integrations,
      tracesSampleRate: isNative ? 0.05 : 0.2,
      replaysSessionSampleRate: isNative ? 0 : 0.1,
      replaysOnErrorSampleRate: isNative ? 0 : 1.0,
      beforeSend(event) {
        // Don't send events in development
        if (import.meta.env.DEV) return null;
        return event;
      },
    });

  // Defer off the critical path so it never blocks first paint.
  const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void) => void);
  if (ric) ric(run);
  else setTimeout(run, 0);
}

/**
 * Tag every error with the tenant it happened in.
 *
 * Without this, a SaaS error feed is unusable: you can see that something broke but
 * not whether it is one tenant's data/config or a platform-wide regression. Tags are
 * queryable in Sentry, so `tenant:<businessId>` + `plan:<plan>` turn the feed into
 * "which customer is affected".
 */
export function setTenantScope(ctx: {
  businessId?: string | null;
  teamId?: string | null;
  plan?: string | null;
  status?: string | null;
  role?: string | null;
}): void {
  if (!SENTRY_DSN) return;
  try {
    Sentry.setTag('tenant', ctx.businessId || 'unknown');
    if (ctx.plan) Sentry.setTag('plan', ctx.plan);
    if (ctx.status) Sentry.setTag('tenant_status', ctx.status);
    if (ctx.role) Sentry.setTag('role', ctx.role);
    Sentry.setContext('tenant', {
      businessId: ctx.businessId || null,
      teamId: ctx.teamId || null,
      plan: ctx.plan || null,
      status: ctx.status || null,
    });
  } catch { /* telemetry must never break the app */ }
}

export { Sentry };
