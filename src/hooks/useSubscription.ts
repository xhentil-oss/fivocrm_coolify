import { useMemo } from 'react';
import { useDocument, useGlobalBusinessId } from './useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { subscriptionState, type SubscriptionState } from '../lib/billing';
import type { Business } from '../types';

export interface SubscriptionInfo extends SubscriptionState {
  businessId: string | null;
  business: (Business & { id: string }) | null;
  loading: boolean;
  /** Only the business owner can buy/manage the subscription (rules enforce it too). */
  canManageBilling: boolean;
  /** Seats included by the plan, after any Enterprise override. */
  seats: number;
}

/**
 * The tenant's billing state, read once from `businesses/{businessId}`.
 *
 * Everything derived (trial countdown, grace period, suspension) comes from the pure
 * `subscriptionState()` helper so the UI, the cron job and the tests agree.
 */
export function useSubscription(): SubscriptionInfo {
  const businessId = useGlobalBusinessId();
  const permissions = usePermissions();
  const { user } = useAuth();
  const { data: business, loading } = useDocument<Business>('businesses', businessId || undefined);

  const state = useMemo(() => subscriptionState(business as any), [business]);

  const seats = ((business as any)?.limits?.seats as number)
    || ((business as any)?.seats as number)
    || 5;

  return {
    ...state,
    businessId,
    business: (business as any) || null,
    loading,
    // Only the owner (or the platform console) can buy/manage — Firestore rules and
    // /api/billing enforce the same thing server-side.
    canManageBilling:
      (!!business && !!user && (business as any).ownerId === user.uid)
      || permissions.isSuperAdmin === true,
    seats,
  };
}
