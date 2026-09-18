/**
 * "Is a NEW tenant being provisioned for the signed-in user right now?"
 *
 * `/signup` creates the auth account FIRST (Firebase signs the person in on the spot)
 * and only then writes business → team → membership → users marker → claims. For
 * those few hundred milliseconds the person is signed in with no membership at all,
 * and every "no membership → they must be a client" branch (DefaultRedirect,
 * useClientPortal's auto-create) would read them as a customer: they were sent to
 * /portal, a Customer + portal access + Lead was minted for them in the DEFAULT
 * tenant, and the portal's hosting probes ran with no `cid` and were denied
 * ("Error fetching domains / subscriptions"). The flag closes that window.
 *
 * In-memory only, on purpose: it must vanish with the tab, and a reload mid-signup
 * lands on the normal identity resolution (the membership is there by then).
 */
let _provisioning = false;

export function beginTenantProvisioning(): void { _provisioning = true; }
export function endTenantProvisioning(): void { _provisioning = false; }
export function isTenantProvisioning(): boolean { return _provisioning; }
