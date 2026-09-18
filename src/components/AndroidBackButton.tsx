import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';

// Routes where pressing Android Back should minimise/exit the app instead of
// navigating (top-level landing spots after auth).
const ROOT_PATHS = new Set<string>(['/', '/app', '/app/dashboard', '/portal', '/portal/dashboard']);

// Where Back lands when there is nothing to go back to but we are not on a root
// screen — the cold-start-from-a-push-notification case.
const HOME_PATH = (pathname: string) => (pathname.startsWith('/portal') ? '/portal/dashboard' : '/app/dashboard');

/**
 * Overlays that are NOT part of the route (the mobile sidebar drawer, the
 * "Më shumë" sheet) register a dismiss function while they are open. Android
 * users expect Back to close what is on top of the screen, not to navigate out
 * from under it — and because those two live outside the <Routes>, navigating
 * away used to leave them hanging open over the new page.
 *
 * Radix overlays (Dialog, AlertDialog, Popover, Select, DropdownMenu) need no
 * registration: they all close on Escape, which `dismissTopOverlay` dispatches.
 */
type Dismiss = () => void;
const dismissStack: Dismiss[] = [];

/** Register while an overlay is open; call the returned function to unregister. */
export function registerBackDismiss(fn: Dismiss): () => void {
  dismissStack.push(fn);
  return () => {
    const i = dismissStack.lastIndexOf(fn);
    if (i !== -1) dismissStack.splice(i, 1);
  };
}

/** Closes the top-most open overlay. Returns true when it handled the press. */
function dismissTopOverlay(): boolean {
  // Radix first: it is always rendered in a portal ABOVE anything we register.
  const radixOpen = document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]'
  );
  if (radixOpen) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  }
  const top = dismissStack[dismissStack.length - 1];
  if (top) {
    top();
    return true;
  }
  return false;
}

/**
 * Handles the Android hardware Back button. Without this, Back closes the whole
 * app from any screen. Renders nothing.
 *
 * The listener is registered ONCE. It used to depend on `location.pathname`, so
 * it re-ran on every navigation — and because `addListener` is awaited inside an
 * async IIFE while React's cleanup is synchronous, a navigation that landed
 * mid-registration left `handle` undefined and the previous listener alive
 * forever. Each orphan popped its own history entry, which is why one Back press
 * eventually jumped two or three screens. The current route is read from a ref
 * instead, so nothing re-subscribes.
 */
export function AndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // Survives the await below: a cleanup that runs before registration finishes
    // still stops the listener from being installed, instead of leaking it.
    let cancelled = false;
    let handle: { remove: () => void } | undefined;

    (async () => {
      const { App } = await import('@capacitor/app');
      const listener = await App.addListener('backButton', ({ canGoBack }) => {
        // 1. Something is open on top of the page — close that, nothing else.
        if (dismissTopOverlay()) return;

        const pathname = pathRef.current;
        // 2. A root screen is where the app is allowed to close.
        if (ROOT_PATHS.has(pathname)) {
          void App.exitApp();
          return;
        }
        // 3. Normal case: step back through history.
        if (canGoBack) {
          navigateRef.current(-1);
          return;
        }
        // 4. No history but not on a root screen — opened cold from a push
        //    notification deep link. Exiting here closed the app on the first
        //    Back press; go home instead.
        navigateRef.current(HOME_PATH(pathname), { replace: true });
      });
      if (cancelled) {
        void listener.remove();
        return;
      }
      handle = listener;
    })();

    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, []);

  return null;
}
