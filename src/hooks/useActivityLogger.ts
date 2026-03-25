import { useCallback } from 'react';
import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { getGlobalTeamId } from './useFirestore';
import type { Activity } from '../types';

/**
 * Hook to log activities to Firestore for the activity timeline.
 * Usage: const logActivity = useActivityLogger();
 *        logActivity('invoice_created', 'Faturë e re u krijua', { entityType: 'invoice', entityId: '...' });
 */
export function useActivityLogger() {
  const { user } = useAuth();

  const logActivity = useCallback(
    async (
      type: Activity['type'],
      title: string,
      opts?: {
        description?: string;
        entityType?: Activity['entityType'];
        entityId?: string;
        customerId?: string;
      }
    ) => {
      if (!user) return;
      try {
        await addDoc(collection(db, 'activities'), {
          type,
          title,
          description: opts?.description || null,
          entityType: opts?.entityType || null,
          entityId: opts?.entityId || null,
          customerId: opts?.customerId || null,
          userId: user.uid,
          teamId: getGlobalTeamId() || null,
          createdAt: Timestamp.now(),
        });
      } catch {
        // non-blocking — activity logging should never break the flow
      }
    },
    [user]
  );

  return logActivity;
}
