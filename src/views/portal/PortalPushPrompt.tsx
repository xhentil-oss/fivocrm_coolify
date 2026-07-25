import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Bell, X } from 'lucide-react';

const DISMISS_KEY = 'portal_push_prompt_dismissed';

/**
 * A dismissible banner that asks the portal client to enable browser
 * notifications. Only shown on the web (native apps request permission
 * automatically via usePushNotifications) and only while permission is still
 * "default" (not yet granted or denied). Clicking "Aktivizo" triggers the
 * permission prompt from a real user gesture — required by Safari/iOS — then
 * reloads so usePushNotifications can mint and save the FCM token.
 */
const PortalPushPrompt: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch { /* ignore */ }
    setVisible(true);
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setVisible(false);
  };

  const enable = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        // Reload so usePushNotifications (App.tsx) re-runs and registers the token.
        window.location.reload();
        return;
      }
    } catch { /* ignore */ }
    setBusy(false);
    dismiss();
  };

  if (!visible) return null;

  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-primary/25 bg-gradient-to-r from-primary/[0.06] to-primary/[0.12] px-4 py-3">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/15">
        <Bell className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">Aktivizo njoftimet</p>
        <p className="text-xs text-muted-foreground">
          Merrni njoftime kur ju vjen një faturë, preventivë ose përgjigje nga ekipi.
        </p>
      </div>
      <button
        onClick={enable}
        disabled={busy}
        className="flex-shrink-0 rounded-lg bg-brand-gradient px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-60 transition-opacity"
      >
        {busy ? '...' : 'Aktivizo'}
      </button>
      <button onClick={dismiss} aria-label="Mbyll" className="flex-shrink-0 text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

export default PortalPushPrompt;
