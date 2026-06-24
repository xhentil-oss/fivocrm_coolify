import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';

// Routes where pressing Android Back should minimise/exit the app instead of
// navigating (top-level landing spots after auth).
const ROOT_PATHS = new Set<string>(['/', '/app', '/app/dashboard', '/portal', '/portal/dashboard']);

/**
 * Handles the Android hardware Back button. Without this, Back closes the whole
 * app from any screen. We navigate back through history when possible and only
 * exit at a root route. Renders nothing.
 */
export function AndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => void } | undefined;

    (async () => {
      const { App } = await import('@capacitor/app');
      const listener = await App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack && !ROOT_PATHS.has(location.pathname)) {
          navigate(-1);
        } else {
          App.exitApp();
        }
      });
      handle = listener;
    })();

    return () => {
      handle?.remove();
    };
  }, [navigate, location.pathname]);

  return null;
}
