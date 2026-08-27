import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { isTypeMutedByPrefs, NOTIFICATION_CATEGORIES, type NotificationCategory } from '../lib/notificationTypes';
import { isInDndWindow, PRESENCE_FRESH_MS } from '../lib/notificationPrefs';

/**
 * The user's notification preferences, live.
 *
 * Why a hook: three surfaces alert the user about a chat message — the ChatView
 * chirp, the Sidebar chime and the bell's toast+chime — and only the bell ever read
 * `userPreferences`. The "Tingull" switch in Cilësimet therefore did nothing for
 * chat, and both chat sounds rang straight through a Do-Not-Disturb window. This is
 * the single gate all three go through now.
 *
 * One document, read with onSnapshot: the prefs must be live or a mute/DND change
 * would not take effect until a reload. `userPreferences/{uid}` is owner-only by the
 * rules, so this never reads anyone else's.
 */
export interface NotifPrefsSnapshot {
  emailEnabled: boolean;
  pushEnabled: boolean;
  soundEnabled: boolean;
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
  categoryEnabled: Partial<Record<NotificationCategory, boolean>>;
}

const ALL_CATEGORIES_ON = NOTIFICATION_CATEGORIES.reduce((acc, c) => {
  acc[c] = true;
  return acc;
}, {} as Record<NotificationCategory, boolean>);

export const DEFAULT_NOTIF_PREFS: NotifPrefsSnapshot = {
  emailEnabled: true,
  pushEnabled: true,
  soundEnabled: true,
  dndEnabled: false,
  dndStart: '22:00',
  dndEnd: '08:00',
  categoryEnabled: { ...ALL_CATEGORIES_ON },
};

/** A category absent from the stored doc defaults to ON, never to muted. */
export function mergeNotifPrefs(raw: any): NotifPrefsSnapshot {
  return {
    ...DEFAULT_NOTIF_PREFS,
    ...(raw || {}),
    categoryEnabled: { ...ALL_CATEGORIES_ON, ...(raw?.categoryEnabled || {}) },
  };
}

export interface UseNotificationPrefsResult {
  prefs: NotifPrefsSnapshot;
  /** May a SOUND be played for this notification type right now? */
  canPlaySound: (type?: string | null) => boolean;
  /** May a visible in-app alert (toast) be shown for this type right now? */
  canAlert: (type?: string | null) => boolean;
}

export function useNotificationPrefs(): UseNotificationPrefsResult {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<NotifPrefsSnapshot>(DEFAULT_NOTIF_PREFS);

  useEffect(() => {
    if (!user?.uid) {
      setPrefs(DEFAULT_NOTIF_PREFS);
      return;
    }
    // Seed from localStorage (the bell writes it) so the very first arriving
    // message is already gated correctly, before the snapshot lands.
    try {
      const stored = localStorage.getItem(`notif_prefs_${user.uid}`);
      if (stored) setPrefs(mergeNotifPrefs(JSON.parse(stored)));
    } catch { /* ignore */ }
    const unsub = onSnapshot(
      doc(db, 'userPreferences', user.uid),
      snap => setPrefs(mergeNotifPrefs(snap.exists() ? snap.data() : {})),
      // A read failure must default to DELIVERING, never to silence.
      () => setPrefs(DEFAULT_NOTIF_PREFS),
    );
    return unsub;
  }, [user?.uid]);

  const canAlert = useCallback(
    (type?: string | null) => !isInDndWindow(prefs) && !isTypeMutedByPrefs(type, prefs.categoryEnabled),
    [prefs],
  );
  const canPlaySound = useCallback(
    (type?: string | null) => prefs.soundEnabled !== false && canAlert(type),
    [prefs.soundEnabled, canAlert],
  );

  return useMemo(() => ({ prefs, canPlaySound, canAlert }), [prefs, canPlaySound, canAlert]);
}

/**
 * Publish "I am reading this conversation right now" so the SENDER's notification
 * does not buzz a phone that is already looking at the message.
 *
 * Stamped onto `userPreferences/{uid}` on purpose: the server loads that document
 * anyway (`getUserPrefs`) to evaluate pushEnabled/DND/mutes, so the presence check
 * adds zero reads. `null` clears the stamp (conversation closed / view unmounted).
 *
 * Heartbeat, not a one-shot write: the stamp must keep proving freshness, because a
 * stale one has to fail OPEN (deliver) — see PRESENCE_FRESH_MS.
 */
export function useConversationPresence(conversationKey: string | null): void {
  const { user } = useAuth();
  const keyRef = useRef(conversationKey);
  keyRef.current = conversationKey;

  useEffect(() => {
    if (!user?.uid) return;
    const ref = doc(db, 'userPreferences', user.uid);
    let lastWritten: string | null | undefined;
    const write = (key: string | null) => {
      // A CLEAR is written once, not once per heartbeat: while the tab is hidden the
      // beat below resolves to null every cycle, and Firestore quota is the real
      // ceiling on this app. A live key is always re-stamped — that write IS the
      // freshness proof the server reads.
      if (key === null && lastWritten === null) return;
      lastWritten = key;
      setDoc(ref, {
        activeConversationKey: key,
        activeConversationAt: key ? new Date() : null,
      }, { merge: true }).catch(() => { /* presence is best-effort */ });
    };
    if (!conversationKey) {
      write(null);
      return;
    }
    // "Reading it" means the tab is actually VISIBLE. Without this, a chat left open
    // on a second monitor kept the stamp fresh forever and permanently suppressed
    // push for that thread — the opposite of the bug being fixed.
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
    const beat = () => write(visible() ? keyRef.current : null);
    beat();
    // Re-stamp comfortably inside the freshness window so a long read never lapses.
    const interval = setInterval(beat, Math.floor(PRESENCE_FRESH_MS / 2));
    document.addEventListener('visibilitychange', beat);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', beat);
      write(null);
    };
  }, [user?.uid, conversationKey]);
}
