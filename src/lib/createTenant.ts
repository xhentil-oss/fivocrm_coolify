import { doc, collection, setDoc, Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import { setGlobalTeamId } from '../hooks/useFirestore';

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

  const teamRef = doc(collection(db, 'teams'));
  const teamId = teamRef.id;

  // 1. Tenant (team). createdByUserId = owner → usePermissions grants them full
  //    owner access scoped to this team, and isTeamOwner() rules pass.
  await setDoc(teamRef, {
    name,
    createdByUserId: uid,
    ownerEmail: email,
    plan: 'trial',
    status: 'trialing',
    trialEndsAt,
    createdAt: now,
    updatedAt: now,
  });

  // 2. Owner membership — keyed {teamId}_{uid} so a future ownsTeamDoc() rule can
  //    tighten reads (Phase 2). usePermissions queries by userId/email, not by id,
  //    so the deterministic key is purely forward-compatibility.
  await setDoc(doc(db, 'teamMembers', `${teamId}_${uid}`), {
    teamId,
    userId: uid,
    email,
    displayName: ownerName.trim(),
    role: 'Admin',
    status: 'Active',
    canAccessProjects: true, canAccessTasks: true, canAccessCRM: true,
    canAccessInvoices: true, canAccessReports: true, canAccessSettings: true,
    canAccessWhatsapp: true, canAccessGoals: true, canAccessTeams: true,
    canAccessChat: true, canAccessCustomers: true, canAccessServices: true,
    canAccessExpenses: true, canAccessProfile: true,
    createdByUserId: uid,
    createdAt: now,
    updatedAt: now,
  });

  // 3. Default per-tenant configuration (the tenant fills the rest in Settings).
  await setDoc(doc(db, 'teamSettings', teamId), {
    companyName: name,
    companyEmail: email,
    eurAllRate: '100',
    whatsappEnabled: false,
    metaEnabled: false,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  // 4. Active-team marker read by the security rules' isTeamMember(teamId), plus the
  //    in-memory global scope so the very first queries hit the right tenant.
  await setDoc(doc(db, 'users', uid), { teamId, updatedAt: now }, { merge: true });
  setGlobalTeamId(teamId);

  return teamId;
}
