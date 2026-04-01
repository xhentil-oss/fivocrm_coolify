import { useEffect, useRef } from 'react';
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from './usePermissions';

/**
 * One-time migration: stamps teamId on existing Firestore documents
 * that were created before data-isolation (Phase 47).
 * Runs once per user, tracked via localStorage.
 */

const TEAM_SCOPED_COLLECTIONS = [
  'tasks', 'invoices', 'customers', 'leads', 'services',
  'expenses', 'goals', 'timeEntries', 'channels', 'messages',
  'activities', 'clientRequests', 'invoiceItems', 'taskComments',
  'taskCollaborators', 'customIndustries', 'typingIndicators',
  'directMessages', 'milestones', 'serviceInquiries', 'projectComments',
  'workspaceFolders', 'workspaceDriveFiles', 'projects',
  'roleTemplates', 'dailyReports',
];

export function useTeamDataMigration() {
  const { user } = useAuth();
  const { teamId, isLoading } = usePermissions();
  const migrating = useRef(false);

  useEffect(() => {
    if (!user || !teamId || isLoading || migrating.current) return;

    const migrationKey = `teamId_migration_v2_${user.uid}`;
    if (localStorage.getItem(migrationKey)) return;

    migrating.current = true;

    const migrate = async () => {
      try {
        let totalUpdated = 0;

        for (const colName of TEAM_SCOPED_COLLECTIONS) {
          const snapshot = await getDocs(collection(db, colName));
          const docsWithoutTeamId = snapshot.docs.filter(
            d => !d.data().teamId
          );

          if (docsWithoutTeamId.length === 0) continue;

          // Firestore writeBatch limit is 500 operations
          for (let i = 0; i < docsWithoutTeamId.length; i += 500) {
            const batch = writeBatch(db);
            const chunk = docsWithoutTeamId.slice(i, i + 500);
            chunk.forEach(docSnap => {
              batch.update(doc(db, colName, docSnap.id), { teamId });
            });
            await batch.commit();
            totalUpdated += chunk.length;
          }
        }

        localStorage.setItem(migrationKey, Date.now().toString());
        if (totalUpdated > 0) {
          console.log(`[Migration] Stamped teamId on ${totalUpdated} documents`);
        }
      } catch (err) {
        console.error('[Migration] Failed to stamp teamId:', err);
      } finally {
        migrating.current = false;
      }
    };

    migrate();
  }, [user, teamId, isLoading]);
}
