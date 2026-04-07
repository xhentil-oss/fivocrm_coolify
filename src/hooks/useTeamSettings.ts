import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useGlobalTeamId, setGlobalWaEnabled } from './useFirestore';

export interface BankAccount {
  id: string;
  bankName: string;
  accountHolder: string;
  iban: string;
  swift: string;
  country: string;
}

export interface MetaChannel {
  id: string;
  label: string;
  phone: string;
  phoneNumberId: string;
  accessToken: string;
  businessAccountId?: string;
}

export interface TeamSettings {
  bankAccounts?: BankAccount[];
  eurAllRate?: string;
  whatsappEnabled?: boolean;
  whatsappVpsUrl?: string;
  whatsappVpsSecret?: string;
  metaEnabled?: boolean;
  metaChannels?: MetaChannel[];
  metaWebhookVerifyToken?: string;
  metaPhoneNumberIds?: string[];
  cronSettings?: Record<string, any>;
  cronLastRuns?: Record<string, any>;
  stripePublishableKey?: string;
  stripeMode?: 'test' | 'live';
  taskListOrder?: string[];
}

/** Write partial teamSettings to Firestore (merge, not overwrite). */
export async function saveTeamSettings(teamId: string, partial: Partial<TeamSettings>): Promise<void> {
  const docRef = doc(db, 'teamSettings', teamId);
  await setDoc(docRef, { ...partial, updatedAt: serverTimestamp() }, { merge: true });
}

/**
 * Subscribe to teamSettings/{teamId} and sync values to localStorage on every
 * Firestore update. This keeps all existing synchronous localStorage consumers
 * (getEurToAllRate, whatsapp_enabled check, bank auto-fill, etc.) working
 * correctly across devices without requiring a large refactor.
 *
 * Must be called inside a component that is a child of PermissionsProvider.
 */
export function useTeamSettingsSync(): void {
  const teamId = useGlobalTeamId();

  useEffect(() => {
    if (!teamId) return;

    const docRef = doc(db, 'teamSettings', teamId);
    const unsub = onSnapshot(docRef, (snap) => {
      if (!snap.exists()) return;
      const settings = snap.data() as TeamSettings;

      if (settings.bankAccounts !== undefined) {
        localStorage.setItem('bank_accounts', JSON.stringify(settings.bankAccounts));
        const first = settings.bankAccounts[0];
        if (first) {
          localStorage.setItem('default_bank_name', first.bankName);
          localStorage.setItem('default_bank_iban', first.iban);
          localStorage.setItem('default_bank_swift', first.swift);
          localStorage.setItem('default_bank_holder', first.accountHolder);
          localStorage.setItem('default_bank_country', first.country || '');
        }
      }

      if (settings.eurAllRate !== undefined) {
        localStorage.setItem('eur_all_rate', settings.eurAllRate);
      }

      if (settings.whatsappEnabled !== undefined) {
        localStorage.setItem('whatsapp_enabled', String(settings.whatsappEnabled));
        setGlobalWaEnabled(settings.whatsappEnabled);
      }

      if (settings.whatsappVpsUrl !== undefined) {
        localStorage.setItem('whatsapp_vps_url', settings.whatsappVpsUrl);
      }

      if (settings.whatsappVpsSecret !== undefined) {
        localStorage.setItem('whatsapp_vps_secret', settings.whatsappVpsSecret);
      }

      if (settings.cronSettings !== undefined) {
        localStorage.setItem('cron_settings', JSON.stringify(settings.cronSettings));
      }

      if (settings.cronLastRuns !== undefined) {
        localStorage.setItem('cron_last_runs', JSON.stringify(settings.cronLastRuns));
      }

      if (settings.stripePublishableKey !== undefined) {
        localStorage.setItem('stripe_publishable_key', settings.stripePublishableKey);
      }

      if (settings.stripeMode !== undefined) {
        localStorage.setItem('stripe_mode', settings.stripeMode);
      }

      if (settings.taskListOrder !== undefined) {
        localStorage.setItem('tasks_list_order', JSON.stringify(settings.taskListOrder));
      }
    });

    return unsub;
  }, [teamId]);
}

/**
 * Returns teamSettings as reactive React state, refreshed whenever Firestore
 * updates. Returns null until the first snapshot arrives (teamId not yet
 * resolved or document not yet loaded).
 */
export function useTeamSettingsData(): TeamSettings | null {
  const [settings, setSettings] = useState<TeamSettings | null>(null);
  const teamId = useGlobalTeamId();

  useEffect(() => {
    if (!teamId) return;
    const docRef = doc(db, 'teamSettings', teamId);
    const unsub = onSnapshot(docRef, (snap) => {
      setSettings(snap.exists() ? (snap.data() as TeamSettings) : {});
    });
    return unsub;
  }, [teamId]);

  return settings;
}
