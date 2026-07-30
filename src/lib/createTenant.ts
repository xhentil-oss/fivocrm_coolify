import { doc, collection, setDoc, Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import { setGlobalTeamId, setGlobalBusinessId } from '../hooks/useFirestore';
import { defaultDisabledModulePaths } from './modules';
import { syncTenantClaims } from './tenantClaims';

/**
 * Creates a brand-new, isolated SaaS tenant for a freshly registered owner.
 *
 * A "tenant" is a `teams/{teamId}` document. Every other collection is scoped by
 * `teamId`, so creating the team + the owner's membership + default settings is all
 * it takes to give a business its own private workspace on the shared infrastructure
 * (Model A multi-tenancy — see the SaaS plan). No per-tenant VPS/Firestore/SMTP.
 *
 * Order matters: the team doc must exist before teamSettings, because the
 * `teamSettings` security rule checks isTeamOwner(teamId) by reading the team doc.
 */
export interface CreateTenantInput {
  uid: string;
  companyName: string;
  ownerName: string;
  ownerEmail: string;
}

const TRIAL_DAYS = 14;

export async function createTenant({ uid, companyName, ownerName, ownerEmail }: CreateTenantInput): Promise<string> {
  const name = companyName.trim();
  const email = ownerEmail.trim().toLowerCase();
  const now = Timestamp.now();
  const trialEndsAt = Timestamp.fromDate(new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000));

  // Two-level model: a tenant is a BUSINESS (isolation boundary) containing a
  // default TEAM (department). Data is scoped by businessId; teamId sub-groups.
  const businessRef = doc(collection(db, 'businesses'));
  const businessId = businessRef.id;
  const teamRef = doc(collection(db, 'teams'));
  const teamId = teamRef.id;

  // 1. Business (the tenant). ownerId = owner.
  await setDoc(businessRef, {
    name,
    ownerId: uid,
    ownerEmail: email,
    plan: 'trial',
    status: 'trialing',
    trialEndsAt,
    // Modules flagged defaultOff in the registry start disabled (landing pages are
    // agency-only; the shop is for retailers, not the service agencies that are the
    // common case). The owner turns them on from Cilësimet → Modulet.
    disabledModules: defaultDisabledModulePaths(),
    createdAt: now,
    updatedAt: now,
  });

  // 2. Default team/department inside the business. createdByUserId = owner →
  //    usePermissions grants full owner access; businessId links it to the tenant.
  await setDoc(teamRef, {
    name: 'Përgjithshëm',
    businessId,
    createdByUserId: uid,
    ownerEmail: email,
    createdAt: now,
    updatedAt: now,
  });

  // 3. Owner membership — keyed {teamId}_{uid} for a future ownsTeamDoc() rule.
  await setDoc(doc(db, 'teamMembers', `${teamId}_${uid}`), {
    teamId,
    businessId,
    userId: uid,
    email,
    displayName: ownerName.trim(),
    role: 'Admin',
    status: 'Active',
    canAccessProjects: true, canAccessTasks: true, canAccessCRM: true,
    canAccessInvoices: true, canAccessReports: true, canAccessSettings: true,
    canAccessWhatsapp: true, canAccessGoals: true, canAccessTeams: true,
    canAccessChat: true, canAccessCustomers: true, canAccessServices: true,
    canAccessProducts: true, canAccessExpenses: true, canAccessProfile: true,
    createdByUserId: uid,
    createdAt: now,
    updatedAt: now,
  });

  // 4. Default configuration (keyed by the default team for now).
  await setDoc(doc(db, 'teamSettings', teamId), {
    companyName: name,
    companyEmail: email,
    eurAllRate: '100',
    whatsappEnabled: false,
    metaEnabled: false,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  // 5. Markers read by security rules + in-memory global scope so the first queries
  //    hit the right tenant immediately.
  await setDoc(doc(db, 'users', uid), { teamId, businessId, updatedAt: now }, { merge: true });
  setGlobalTeamId(teamId);
  setGlobalBusinessId(businessId);

  // 6. Server-signed tenant identity (bid/tid/roles) — the authoritative boundary
  //    used by Firestore rules. Best-effort: the users/{uid} marker above still
  //    works as a fallback if the endpoint is briefly unavailable.
  await syncTenantClaims();

  return teamId;
}
