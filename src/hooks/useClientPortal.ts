import { useEffect, useState, useRef, useCallback } from 'react';
import { useCollection } from './useFirestore';
import { usePortalTenant } from './usePortalTenant';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { collection, addDoc, updateDoc, doc, Timestamp, getDocs, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { notifyStaff } from '../lib/notifyStaff';
import type { ClientPortalAccess, Customer } from '../types';

/**
 * Hook that checks if the current authenticated user has client portal access.
 * Auto-links the userId if the user's email matches a portal access record.
 * Auto-creates Customer + portal access + Lead if user has no records yet.
 *
 * Uses direct Firestore writes (not useMutation) to avoid hook closure issues.
 */

// Default tenant for the apex / *.vercel.app host, where there is no portal
// subdomain to resolve (usePortalTenant returns null there). Without this, a
// brand-new client's records fell back to "the first team member in a
// cross-tenant, unordered query" — i.e. an ARBITRARY tenant — so clients landed
// in the wrong business. Set both to the MAIN tenant's ids in the environment.
const DEFAULT_TEAM_ID = (import.meta.env.VITE_DEFAULT_TEAM_ID as string | undefined) || undefined;
const DEFAULT_BUSINESS_ID = (import.meta.env.VITE_DEFAULT_BUSINESS_ID as string | undefined) || undefined;

// ── Module-level singleton guards ───────────────────────────────────────────
// Multiple portal views call useClientPortal() simultaneously (PortalLayout,
// PortalDashboard, PortalChatView, etc.). Each instance has its own React ref,
// so without a shared lock they all fire auto-create concurrently and produce
// duplicate customers/leads/portal-access records.
// These module vars are shared across ALL hook instances in the same JS process.
let _moduleCreatingForUid: string | null = null;  // uid currently being created
let _moduleCreatedForUid: string | null = null;   // uid already created this session

export function useClientPortal() {
  const { user, loading: authLoading } = useAuth();

  // Admin "view as customer": when a real staff member has an active customer
  // preview, the portal renders as that customer. We short-circuit resolution to
  // the previewed customerId and — crucially — skip ALL auto-create/link/persist
  // side effects, so previewing never mutates data on the admin's own account.
  const perms = usePermissions();
  const isStaff = perms.isOwner || perms.isAdmin || (perms as any).isSuperAdmin;
  const previewCustomerId = isStaff && perms.previewCustomerId ? perms.previewCustomerId : null;

  const [autoCreating, setAutoCreating] = useState(false);
  const [autoCreated, setAutoCreated] = useState(false);
  const [createdCustomerId, setCreatedCustomerId] = useState<string | null>(null);
  const didAutoCreate = useRef(false);
  const didAutoLink = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Query portal access by userId only (single where = no composite index needed)
  const { data: byUserId, loading: byUserIdLoading } = useCollection<ClientPortalAccess>(
    'clientPortalAccess',
    {
      skip: !user,
      where: user ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
      // Portal clients have no active business; the query is authorized per-document
      // by `userId == uid` in the hardened clientPortalAccess rule.
      skipBusinessFilter: true,
      skipTeamFilter: true,
    }
  );

  // Query portal access by email (for unlinked records)
  const { data: byEmail, loading: byEmailLoading } = useCollection<ClientPortalAccess>(
    'clientPortalAccess',
    {
      skip: !user?.email,
      where: user?.email ? [{ field: 'email', operator: '==', value: user.email.toLowerCase() }] : undefined,
      // Authorized per-document by `email == token.email` in the hardened rule.
      skipBusinessFilter: true,
      skipTeamFilter: true,
    }
  );

  // Check for matching customer by email
  const { data: matchingCustomers, loading: customersLoading } = useCollection<Customer>(
    'customers',
    {
      skip: !user?.email,
      where: user?.email ? [{ field: 'email', operator: '==', value: user.email.toLowerCase() }] : undefined,
      skipTeamFilter: true,
    }
  );

  // NOTE: this hook used to read `teamMembers` cross-tenant (skipTeamFilter) to pick
  // notification recipients and to guess a teamId. That exposed every tenant's staff
  // records to any signed-in client, and the "first member found" fallback is what
  // once dropped new clients into an arbitrary tenant. Recipients are now resolved
  // server-side (/api/notify-staff) and the tenant comes from the subdomain or the
  // explicit VITE_DEFAULT_* configuration only.

  // Filter to get only Active access records
  const activeByUserId = byUserId?.filter(a => a.status === 'Active') || [];
  const activeByEmail = byEmail?.filter(a => a.status === 'Active') || [];

  // ANY existing records (any status) — used to block auto-create when duplicates already exist
  const anyByUserId = byUserId || [];
  const anyByEmail = byEmail || [];

  // Auto-link: if portal access exists by email but userId is empty, update it
  useEffect(() => {
    if (previewCustomerId) return; // admin preview — never mutate
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

  // Multi-tenant portal: when the client visits <tenant>.fivocrm.com, resolve which
  // tenant (businessId) they belong to so auto-created records are stamped correctly.
  // On the apex host (fivocrm.com) this is null and behavior is unchanged (agency).
  const { tenantBusinessId, tenantTeamId } = usePortalTenant();

  // Direct Firestore create helper (avoids useMutation hook closure issues).
  // Prefer the subdomain tenant's team; else fall back to any available team member
  // (apex/agency behavior) so portal-created docs satisfy rules requiring teamId.
  const resolveTeamId = useCallback(() => {
    // Priority: subdomain tenant → configured default (main tenant). We deliberately
    // do NOT fall back to "the first cross-tenant member" — that landed brand-new
    // clients in an ARBITRARY tenant. Unresolved → null (fail closed).
    return tenantTeamId || DEFAULT_TEAM_ID || null;
  }, [tenantTeamId]);

  // Resolve the businessId to stamp on client-created docs. On a tenant subdomain
  // this is the tenant's businessId. On the apex/agency host there is no tenant
  // context, so we fall back to the businessId of the SAME team we're stamping
  // (keeps teamId ↔ businessId consistent) — else any team member's businessId.
  // Without this fallback, apex-host clients were created with no businessId and
  // became invisible in the business-scoped admin views.
  const resolveBusinessId = useCallback(() => {
    // Subdomain tenant → configured default → fail closed. There is deliberately no
    // "look at some team member" fallback: it required a cross-tenant read and landed
    // new clients in an arbitrary business.
    if (tenantBusinessId) return tenantBusinessId;
    if (DEFAULT_BUSINESS_ID) return DEFAULT_BUSINESS_ID;
    return null;
  }, [tenantBusinessId]);

  const createDoc = useCallback(async (collName: string, data: Record<string, any>) => {
    const teamId = resolveTeamId();
    const businessId = resolveBusinessId();
    const docData = Object.fromEntries(
      Object.entries({
        ...data,
        ...(teamId ? { teamId } : {}),
        // Stamp the tenant boundary so this client's records isolate to their tenant.
        ...(businessId ? { businessId } : {}),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdByUserId: user?.uid || null,
      }).filter(([_, v]) => v !== undefined)
    );
    const ref = await addDoc(collection(db, collName), docData);
    return { id: ref.id, ...docData };
  }, [user?.uid, resolveTeamId, resolveBusinessId]);

  // Auto-create: if no portal access exists, create Customer + Access + Lead
  useEffect(() => {
    if (previewCustomerId) return; // admin preview — never auto-create records
    if (!user?.email || authLoading || byUserIdLoading || byEmailLoading || customersLoading) return;
    if (autoCreating || didAutoCreate.current) return;
    // Block if ANY portal access record already exists (any status), not just Active.
    // This prevents re-creation for users who have Pending/legacy records.
    if (anyByUserId.length > 0 || anyByEmail.length > 0) return;

    // Module-level guard: if another instance is already creating for this uid,
    // or has already created this session, skip entirely.
    if (_moduleCreatingForUid === user.uid || _moduleCreatedForUid === user.uid) return;

    const customer = matchingCustomers?.[0];

    if (customer) {
      // Customer exists but no Active portal access — create access
      setAutoCreating(true);
      didAutoCreate.current = true;
      _moduleCreatingForUid = user.uid;
      setCreatedCustomerId(customer.id);

      createDoc('clientPortalAccess', {
        customerId: customer.id,
        userId: user.uid,
        email: user.email?.toLowerCase(),
        status: 'Active',
      }).then(() => {
        _moduleCreatedForUid = user.uid;
        _moduleCreatingForUid = null;
        setAutoCreated(true);
        setAutoCreating(false);
      }).catch(() => {
        _moduleCreatingForUid = null;
        setAutoCreating(false);
        setCreatedCustomerId(null);
        didAutoCreate.current = false;
      });
    } else {
      // No customer at all — create Customer + Access + Lead + Notify admins
      // Double-check Firestore directly to avoid race with RegisterView which may
      // have just created a customer moments ago (real-time listener may lag).
      setAutoCreating(true);
      didAutoCreate.current = true;
      _moduleCreatingForUid = user.uid;

      (async () => {
        let existingCustomer: { id: string } | null = null;
        try {
          const snap = await getDocs(
            query(collection(db, 'customers'), where('email', '==', user.email!.toLowerCase()))
          );
          if (!snap.empty) {
            existingCustomer = { id: snap.docs[0].id };
          }
        } catch { /* fall through to create */ }

        if (existingCustomer) {
          // Customer was already created (likely by RegisterView) — just create portal access
          if (mountedRef.current) setCreatedCustomerId(existingCustomer.id);
          createDoc('clientPortalAccess', {
            customerId: existingCustomer.id,
            userId: user.uid,
            email: user.email?.toLowerCase(),
            status: 'Active',
          }).then(() => {
            _moduleCreatedForUid = user.uid;
            _moduleCreatingForUid = null;
            if (!mountedRef.current) return;
            setAutoCreated(true);
            setAutoCreating(false);
          }).catch(() => {
            _moduleCreatingForUid = null;
            if (!mountedRef.current) return;
            setAutoCreating(false);
            setCreatedCustomerId(null);
            didAutoCreate.current = false;
          });
          return;
        }

        const displayName = user.displayName || user.email || 'Klient';

      createDoc('customers', {
        name: displayName,
        email: user.email?.toLowerCase(),
        status: 'Pending',
      }).then(async (newCustomer) => {
        if (mountedRef.current) setCreatedCustomerId(newCustomer.id);

        // Create portal access
        await createDoc('clientPortalAccess', {
          customerId: newCustomer.id,
          userId: user.uid,
          email: user.email?.toLowerCase(),
          status: 'Active',
        });

        // Pair this customer with the CRM lead for the same person — reusing an
        // existing lead (e.g. from a landing-page submission) instead of creating
        // a duplicate, and creating one only when none exists.
        //
        // Server-side on purpose: Firestore rules restrict `leads` writes to
        // business members and only let a portal client READ leads already
        // stamped with their own customerId, so a client can neither find nor
        // link their own lead from here. /api/link-contact does it with admin
        // credentials after verifying the caller owns the customer record.
        try {
          const idToken = await user.getIdToken();
          await fetch('/api/link-contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ customerId: newCustomer.id }),
          });
        } catch { /* non-critical — a staff member can pair them from the CRM */ }

        // Notify the tenant's admins — recipients are resolved server-side from this
        // client's own customer → businessId, so a new client can never fan out to
        // other tenants' admins (nor does the browser need the staff directory).
        void notifyStaff({
          type: 'new_client',
          title: 'Klient i ri u regjistrua',
          message: `${displayName} (${user.email}) u regjistrua në portal.`,
          actionUrl: '/app/customers',
          actionLabel: 'Shiko Klientin',
        });
      }).then(() => {
        _moduleCreatedForUid = user.uid;
        _moduleCreatingForUid = null;
        if (!mountedRef.current) return;
        setAutoCreated(true);
        setAutoCreating(false);
      }).catch(() => {
        _moduleCreatingForUid = null;
        if (!mountedRef.current) return;
        setAutoCreating(false);
        setCreatedCustomerId(null);
        didAutoCreate.current = false;
      });
      })(); // end async IIFE
    }
  }, [user, authLoading, anyByUserId, anyByEmail, byUserIdLoading, byEmailLoading, matchingCustomers, customersLoading, autoCreating, createDoc, tenantBusinessId, resolveBusinessId]);

  const access = (activeByUserId.find(a => a.customerId) || activeByUserId[0])
    || (activeByEmail.find(a => a.customerId) || activeByEmail[0])
    || null;

  // Prefer Active customer when multiple customers share the same email
  const preferredCustomer = matchingCustomers?.find(c => (c as any).status === 'Active')
    || matchingCustomers?.[0]
    || null;

  const resolvedCustomerId = access?.customerId
    || createdCustomerId
    || preferredCustomer?.id
    || null;

  // The tenant this client belongs to. Prefer the client's own customer record
  // (most accurate), then any matching customer, then the team-derived fallback.
  // Portal-created docs (e.g. serviceInquiries) MUST carry this or they fall
  // outside the admin's business-scoped queries and never appear.
  const resolvedBusinessId =
    (preferredCustomer as any)?.businessId
    || (access as any)?.businessId
    || (matchingCustomers as any[] | undefined)?.find(c => (c as any).businessId)?.businessId
    || resolveBusinessId()
    || null;

  // Mirror the portal user's customerId onto users/{uid} so Firestore rules can
  // grant them read access to their own customer's data (isPortalClientFor) once
  // reads are hardened. users/{uid} is uid-keyed, so no clientPortalAccess re-key.
  const persistedCustomerIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (previewCustomerId) return; // admin preview — don't rewrite the admin's own users/{uid}
    if (!user?.uid || !resolvedCustomerId) return;
    if (persistedCustomerIdRef.current === resolvedCustomerId) return;
    persistedCustomerIdRef.current = resolvedCustomerId;
    updateDoc(doc(db, 'users', user.uid), { customerId: resolvedCustomerId, updatedAt: Timestamp.now() })
      .catch(() => {
        // doc may not exist yet — create it
        import('firebase/firestore').then(({ setDoc }) =>
          setDoc(doc(db, 'users', user.uid), { customerId: resolvedCustomerId, updatedAt: Timestamp.now() }, { merge: true }).catch(() => {})
        );
      });
  }, [user?.uid, resolvedCustomerId]);

  // Keep isLoading=true in the gap between "queries done" and "useEffect fires auto-create"
  const queriesLoaded = !byUserIdLoading && !byEmailLoading && !customersLoading;
  const hasNoAccess = activeByUserId.length === 0 && activeByEmail.length === 0;
  const pendingAutoCreate = !!user?.email && queriesLoaded && hasNoAccess && !autoCreating && !didAutoCreate.current;

  // Admin "view as customer" — resolve directly to the previewed customer.
  if (previewCustomerId) {
    return {
      isClient: true,
      portalAccess: null,
      customerId: previewCustomerId,
      businessId: null,
      teamId: null,
      isLoading: false,
    };
  }

  // The tenant's team (department) for portal-created docs that need a teamId.
  const resolvedTeamIdOut =
    (preferredCustomer as any)?.teamId
    || (access as any)?.teamId
    || resolveTeamId()
    || null;

  return {
    isClient: !!access || autoCreating || autoCreated,
    portalAccess: access,
    customerId: resolvedCustomerId,
    businessId: resolvedBusinessId,
    teamId: resolvedTeamIdOut,
    isLoading: authLoading || byUserIdLoading || byEmailLoading || autoCreating || pendingAutoCreate,
  };
}
