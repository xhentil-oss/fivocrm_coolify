import { Capacitor } from '@capacitor/core';
import { getApiBase } from './nativeApi';

/**
 * Build a return URL (e.g. for Stripe success/cancel) that actually loads.
 * On web it stays same-origin. On native the WebView origin is `https://localhost`,
 * which Stripe can't redirect back to, so we point at the deployed web origin
 * and prefix the hash (HashRouter is used on native).
 */
export function appReturnUrl(path: string): string {
  if (Capacitor.isNativePlatform()) {
    return `${getApiBase()}/#${path}`;
  }
  return `${window.location.origin}${path}`;
}

/**
 * Open a Stripe Checkout (or any payment) URL. On native we use the in-app
 * browser so the user keeps a close button back into the app; on web we keep
 * the standard same-tab redirect.
 */
export async function openCheckout(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } else {
    window.location.href = url;
  }
}

/**
 * Open an external URL. In a Capacitor WebView, `window.open`/`target=_blank`
 * either no-op or launch the system browser unreliably (and can ANR the
 * emulator), so on native we use the in-app browser. On web we keep the normal
 * new-tab behaviour.
 */
export async function openExternal(url: string): Promise<void> {
  if (!url) return;
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Android safe-area fallback. The layout reads var(--safe-area-*), which
 * prefers the --safe-area-inset-* variables Capacitor's SystemBars plugin
 * injects on Android 15+ and falls back to env(safe-area-inset-*). On
 * Android ≤14 neither exists: SystemBars only injects on API 35+, and the
 * Android WebView reports env() as 0 even though overlaysWebView draws the
 * app under the status bar — so the fixed header sat half-hidden ("cut").
 * Here we measure what env() really resolves to; when it yields 0 while the
 * status bar overlays the WebView, we stamp the plugin-reported height as
 * the same inline variable SystemBars would have injected. On Android 15+
 * the variable is already (or later) injected natively and this is a no-op.
 */
export async function applyAndroidSafeAreaFallback(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  const root = document.documentElement;
  if (root.style.getPropertyValue('--safe-area-inset-top')) return;

  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px)';
  document.body.appendChild(probe);
  const envTop = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  if (envTop > 0) return; // env() works on this WebView — nothing to patch

  try {
    const { StatusBar } = await import('@capacitor/status-bar');
    // Android returns `height` (dp) in getInfo(), but the shared TS type omits it.
    const info = (await StatusBar.getInfo()) as { overlays?: boolean; height?: number };
    // Re-check: SystemBars may have injected while we awaited.
    if (
      info.overlays &&
      typeof info.height === 'number' &&
      info.height > 0 &&
      !root.style.getPropertyValue('--safe-area-inset-top')
    ) {
      root.style.setProperty('--safe-area-inset-top', `${info.height}px`);
    }
  } catch {
    // leave the env() fallback in place
  }
}

let linkHandlerInstalled = false;

/**
 * On native, intercept clicks on external links (`target="_blank"` or absolute
 * URLs to another host) and open them in the in-app browser instead of letting
 * the WebView try to navigate away or no-op. Covers every external anchor in
 * the app without touching each call site. Internal HashRouter links (href
 * `#/...` or same-host) are left untouched.
 */
export function installExternalLinkHandler(): void {
  if (linkHandlerInstalled || !Capacitor.isNativePlatform()) return;
  linkHandlerInstalled = true;

  document.addEventListener(
    'click',
    (e) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('blob:') || href.startsWith('data:')) return;

      let url: URL;
      try {
        url = new URL(anchor.href); // resolved absolute URL
      } catch {
        return;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return; // mailto/tel → let OS handle
      if (url.hostname === window.location.hostname) return; // internal link

      e.preventDefault();
      void openExternal(url.href);
    },
    true // capture, so we run before React handlers
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // strip the `data:...;base64,` prefix that Filesystem doesn't want
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Save or share a generated file (PDF, CSV, JSON...). On web this triggers a
 * normal browser download. On native, `<a download>`/blob downloads are a
 * no-op, so we write the file to the cache directory and open the native share
 * sheet (save to Files, send via WhatsApp/email, etc.).
 */
export async function saveOrShareFile(
  blob: Blob,
  fileName: string,
  opts?: { shareTitle?: string }
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const base64 = await blobToBase64(blob);
    const written = await Filesystem.writeFile({
      path: fileName,
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({
      title: opts?.shareTitle || fileName,
      url: written.uri,
    });
    return;
  }

  // Web: standard download.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
