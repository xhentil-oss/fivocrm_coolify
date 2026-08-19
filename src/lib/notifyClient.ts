import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { getGlobalBusinessId } from '../hooks/useFirestore';

/**
 * Resolve the portal-login user id (Firebase Auth uid) for a given customer.
 *
 * Portal clients read their notifications by `userId`, and the notification
 * choke point (useMutation('notifications').create) pushes + emails whoever the
 * `userId` points at. So to notify a client of a new invoice / quote / contract,
 * staff code resolves the client's uid here, then creates a notification for it.
 *
 * Returns null when the customer has no active portal account (nothing to notify).
 */
export async function resolvePortalUserId(customerId?: string | null): Promise<string | null> {
  if (!customerId) return null;
  try {
    // businessId makes the query provable for STAFF under the rules — a
    // customerId-only list only proves the portal-client clause, so this lookup
    // was silently denied for every normal staff member and the client
    // notifications for new invoices/quotes/contracts never fired.
    const activeBusinessId = getGlobalBusinessId();
    const snap = await getDocs(
      query(
        collection(db, 'clientPortalAccess'),
        ...(activeBusinessId ? [where('businessId', '==', activeBusinessId)] : []),
        where('customerId', '==', customerId),
      )
    );
    if (snap.empty) return null;
    // Prefer an Active record that actually carries a userId.
    const docs = snap.docs.map(d => d.data() as any);
    const active = docs.find(d => d.status === 'Active' && d.userId) || docs.find(d => d.userId);
    return active?.userId || null;
  } catch {
    return null;
  }
}
