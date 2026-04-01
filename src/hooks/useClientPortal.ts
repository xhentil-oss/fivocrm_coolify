import { useEffect, useState, useRef, useCallback } from 'react';
import { useCollection } from './useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { collection, addDoc, updateDoc, doc, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { ClientPortalAccess, Customer } from '../types';

/**
 * Hook that checks if the current authenticated user has client portal access.
 * Auto-links the userId if the user's email matches a portal access record.
 * Auto-creates Customer + portal access + Lead if user has no records yet.
 *
 * Uses direct Firestore writes (not useMutation) to avoid hook closure issues.
 */
export function useClientPortal() {
  const { user, loading: authLoading } = useAuth();
  const [autoCreating, setAutoCreating] = useState(false);
  const [autoCreated, setAutoCreated] = useState(false);
  const [createdCustomerId, setCreatedCustomerId] = useState<string | null>(null);
  const didAutoCreate = useRef(false);
  const didAutoLink = useRef(false);

  // Query portal access by userId only (single where = no composite index needed)
  const { data: byUserId, loading: byUserIdLoading } = useCollection<ClientPortalAccess>(
    'clientPortalAccess',
    user
      ? { where: [{ field: 'userId', operator: '==', value: user.uid }] }
      : undefined
  );

  // Query portal access by email (for unlinked records)
  const { data: byEmail, loading: byEmailLoading } = useCollection<ClientPortalAccess>(
    'clientPortalAccess',
    user?.email
      ? { where: [{ field: 'email', operator: '==', value: user.email }] }
      : undefined
  );

  // Check for matching customer by email
  const { data: matchingCustomers, loading: customersLoading } = useCollection<Customer>(
    'customers',
    user?.email
      ? { where: [{ field: 'email', operator: '==', value: user.email }], skipTeamFilter: true }
      : undefined
  );

  // Fetch team members to notify admins and resolve teamId
  const { data: allTeamMembers, loading: teamMembersLoading } = useCollection<any>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
  });

  // Filter to get only Active access records
  const activeByUserId = byUserId?.filter(a => a.status === 'Active') || [];
  const activeByEmail = byEmail?.filter(a => a.status === 'Active') || [];

  // Auto-link: if portal access exists by email but userId is empty, update it
  useEffect(() => {
    if (!user || byUserIdLoading || byEmailLoading || didAutoLink.current) return;
    if (activeByUserId.length > 0) return; // Already linked

    const emailMatch = activeByEmail.find(a => !a.userId || a.userId === '');
    if (emailMatch) {
      didAutoLink.current = true;
      updateDoc(doc(db, 'clientPortalAccess', emailMatch.id), {
        userId: user.uid,
        updatedAt: Timestamp.now(),
      }).catch(() => { didAutoLink.current = false; });
    }
  }, [user, activeByUserId, activeByEmail, byUserIdLoading, byEmailLoading]);

  // Direct Firestore create helper (avoids useMutation hook closure issues)
  // Resolves teamId from the first available team member so portal-created docs
  // satisfy Firestore rules that require `teamId is string`.
  const resolveTeamId = useCallback(() => {
    return allTeamMembers?.find((m: any) => m.teamId)?.teamId || null;
  }, [allTeamMembers]);

  const createDoc = useCallback(async (collName: string, data: Record<string, any>) => {
    const teamId = resolveTeamId();
    const docData = Object.fromEntries(
      Object.entries({
        ...data,
        ...(teamId ? { teamId } : {}),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdByUserId: user?.uid || null,
      }).filter(([_, v]) => v !== undefined)
    );
    const ref = await addDoc(collection(db, collName), docData);
    return { id: ref.id, ...docData };
  }, [user?.uid, resolveTeamId]);

  // Auto-create: if no portal access exists, create Customer + Access + Lead
  useEffect(() => {
    if (!user?.email || authLoading || byUserIdLoading || byEmailLoading || customersLoading || teamMembersLoading) return;
    if (autoCreating || didAutoCreate.current) return;
    if (activeByUserId.length > 0) return;
    if (activeByEmail.length > 0) return;

    const customer = matchingCustomers?.[0];

    if (customer) {
      // Customer exists but no Active portal access — create access
      setAutoCreating(true);
      didAutoCreate.current = true;
      setCreatedCustomerId(customer.id);

      createDoc('clientPortalAccess', {
        customerId: customer.id,
        userId: user.uid,
        email: user.email,
        status: 'Active',
      }).then(() => {
        setAutoCreated(true);
        setAutoCreating(false);
      }).catch(() => {
        setAutoCreating(false);
        setCreatedCustomerId(null);
        didAutoCreate.current = false;
      });
    } else {
      // No customer at all — create Customer + Access + Lead + Notify admins
      setAutoCreating(true);
      didAutoCreate.current = true;
      const displayName = user.displayName || user.email || 'Klient';

      createDoc('customers', {
        name: displayName,
        email: user.email,
        status: 'Pending',
      }).then(async (newCustomer) => {
        setCreatedCustomerId(newCustomer.id);

        // Create portal access
        await createDoc('clientPortalAccess', {
          customerId: newCustomer.id,
          userId: user.uid,
          email: user.email!,
          status: 'Active',
        });

        // Create Lead (so admin sees it in CRM)
        createDoc('leads', {
          name: displayName,
          email: user.email,
          status: 'New',
          source: 'Portal - Google Sign In',
        }).catch(() => { /* non-critical */ });

        // Notify admin team members
        const admins = allTeamMembers?.filter(
          (m: any) => m.role === 'Admin'
        ) || [];
        // Also check for team owners
        for (const admin of admins) {
          createDoc('notifications', {
            userId: admin.userId,
            type: 'new_client',
            title: 'Klient i ri u regjistrua',
            message: `${displayName} (${user.email}) u regjistrua në portal.`,
            read: false,
          }).catch(() => { /* non-critical */ });
        }
      }).then(() => {
        setAutoCreated(true);
        setAutoCreating(false);
      }).catch(() => {
        setAutoCreating(false);
        setCreatedCustomerId(null);
        didAutoCreate.current = false;
      });
    }
  }, [user, authLoading, activeByUserId, activeByEmail, byUserIdLoading, byEmailLoading, matchingCustomers, customersLoading, teamMembersLoading, autoCreating, createDoc, allTeamMembers]);

  const access = activeByUserId[0] || activeByEmail[0] || null;

  const resolvedCustomerId = access?.customerId
    || createdCustomerId
    || matchingCustomers?.[0]?.id
    || null;

  // Keep isLoading=true in the gap between "queries done" and "useEffect fires auto-create"
  const queriesLoaded = !byUserIdLoading && !byEmailLoading && !customersLoading && !teamMembersLoading;
  const hasNoAccess = activeByUserId.length === 0 && activeByEmail.length === 0;
  const pendingAutoCreate = !!user?.email && queriesLoaded && hasNoAccess && !autoCreating && !didAutoCreate.current;

  return {
    isClient: !!access || autoCreating || autoCreated,
    portalAccess: access,
    customerId: resolvedCustomerId,
    isLoading: authLoading || byUserIdLoading || byEmailLoading || teamMembersLoading || autoCreating || pendingAutoCreate,
  };
}
