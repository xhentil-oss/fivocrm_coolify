import { useEffect, useRef } from 'react';
import { collection, getDocs, writeBatch, doc, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from './usePermissions';

/**
 * One-time migration: stamps teamId on existing Firestore documents
 * that were created before data-isolation (Phase 47).
 * Runs once per user, tracked via localStorage.
 * Only migrates documents owned by the current user.
 */

const TEAM_SCOPED_COLLECTIONS = [
  'tasks', 'invoices', 'customers', 'leads', 'services',
  'expenses', 'goals', 'timeEntries', 'channels', 'messages',
  'clientRequests', 'invoiceItems', 'taskComments',
  'taskCollaborators', 'customIndustries', 'typingIndicators',
  'directMessages', 'milestones', 'serviceInquiries', 'projectComments',
  'workspaceFolders', 'workspaceDriveFiles', 'projects',
  'roleTemplates', 'dailyReports',
];

export function useTeamDataMigration() {
  const { user } = useAuth();
  const { teamId, isLoading, role, isOwner } = usePermissions();
  const migrating = useRef(false);

  useEffect(() => {
    // Only run for staff (admins/owners), not portal clients
    if (!user || !teamId || isLoading || migrating.current) return;
    if (!role && !isOwner) return;

    const migrationKey = `teamId_migration_v2_${user.uid}`;
    if (localStorage.getItem(migrationKey)) return;

    migrating.current = true;

    const migrate = async () => {
      let totalUpdated = 0;

      for (const colName of TEAM_SCOPED_COLLECTIONS) {
        try {
          // Only fetch docs created by this user that lack teamId
          const q = query(
            collection(db, colName),
            where('createdByUserId', '==', user.uid)
          );
          const snapshot = await getDocs(q);
          const docsWithoutTeamId = snapshot.docs.filter(
            d => !d.data().teamId
          );

          if (docsWithoutTeamId.length === 0) continue;

          for (let i = 0; i < docsWithoutTeamId.length; i += 500) {
            const batch = writeBatch(db);
            const chunk = docsWithoutTeamId.slice(i, i + 500);
            chunk.forEach(docSnap => {
              batch.update(doc(db, colName, docSnap.id), { teamId });
            });
            await batch.commit();
            totalUpdated += chunk.length;
          }
        } catch {
          // Skip collections that fail (e.g. permission issues) — non-critical
        }
      }

      // Always mark as complete so it doesn't retry every session
      localStorage.setItem(migrationKey, Date.now().toString());
      if (totalUpdated > 0) {
        console.log(`[Migration] Stamped teamId on ${totalUpdated} documents`);
      }

      migrating.current = false;
    };

    migrate();
  }, [user, teamId, isLoading, role, isOwner]);
}
