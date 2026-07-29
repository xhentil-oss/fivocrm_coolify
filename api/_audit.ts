import admin, { adminDb as db } from './_firebaseAdmin.js';

/**
 * Append-only tenant audit trail (`auditLogs`).
 *
 * Enterprise buyers ask "who did what, when, in my tenant". Firestore rules make
 * the collection read-only-within-the-tenant and never updatable/deletable by a
 * client — every entry is written server-side through this helper.
 *
 * Keep entries small and factual: actor, action, target, tenant, timestamp.
 */
export interface AuditEntry {
  businessId: string | null;
  actorUid: string | null;
  actorEmail?: string | null;
  /** Stable machine action, e.g. 'invite.accept', 'claims.impersonate', 'secrets.update'. */
  action: string;
  /** What the action was performed on, e.g. 'team:abc123' or 'customer:xyz'. */
  target?: string | null;
  meta?: Record<string, any>;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.collection('auditLogs').add({
      businessId: entry.businessId || null,
      actorUid: entry.actorUid || null,
      actorEmail: entry.actorEmail || null,
      action: entry.action,
      target: entry.target || null,
      meta: entry.meta || {},
      createdAt: admin.firestore.Timestamp.now(),
    });
  } catch {
    // Auditing must never break the operation it records.
  }
}
