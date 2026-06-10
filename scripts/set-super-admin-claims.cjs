// Set a SERVER-TRUSTWORTHY `superAdmin` custom claim on the super-admin users.
//
// Today super-admin status is decided purely client-side from
// VITE_SUPER_ADMIN_EMAILS (see src/hooks/usePermissions.ts), so Firestore rules
// have no way to know a user is a super-admin. This script promotes those emails
// to a real Firebase Auth custom claim (`superAdmin: true`), which rules CAN read
// via `request.auth.token.superAdmin`. That unblocks tightening the read rules
// while keeping a global-read escape hatch for admins (see
// workspace/SECURITY_RULES_MIGRATION.md and the isSuperAdmin() rule helper).
//
// After running, affected users must refresh their ID token (sign out/in, or the
// client calls getIdToken(true)) for the new claim to take effect.
//
// SAFETY: dry-run by default. Pass --apply to actually set claims.
//
// Usage:
//   node scripts/set-super-admin-claims.cjs                          # dry-run, reads SUPER_ADMIN_EMAILS / VITE_SUPER_ADMIN_EMAILS
//   node scripts/set-super-admin-claims.cjs --apply
//   node scripts/set-super-admin-claims.cjs a@x.com,b@y.com --apply  # explicit list
//   node scripts/set-super-admin-claims.cjs --revoke c@x.com --apply # remove the claim
//
// Credentials: scripts/sa.json if present, else FIREBASE_* in ../.env.vercel.local
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const revokeIdx = args.indexOf('--revoke');
const REVOKE = revokeIdx >= 0;

// ── load env (also used to default the email list) ──
let env = {};
const envPath = path.join(__dirname, '..', '.env.vercel.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=("(.*)"|(.*))$/);
    if (m) env[m[1]] = m[3] !== undefined ? m[3] : m[4];
  }
}

// Email list: explicit positional arg (or value after --revoke) > env vars
const positional = args.find(a => a.includes('@'));
const rawEmails = positional
  || env.SUPER_ADMIN_EMAILS
  || env.VITE_SUPER_ADMIN_EMAILS
  || '';
const emails = rawEmails.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

if (emails.length === 0) {
  console.error('No emails. Pass a comma list, or set SUPER_ADMIN_EMAILS / VITE_SUPER_ADMIN_EMAILS in .env.vercel.local');
  process.exit(1);
}

// ── credentials ──
const saPath = path.join(__dirname, 'sa.json');
let cred;
if (fs.existsSync(saPath)) {
  cred = admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8')));
} else {
  cred = admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  });
}
admin.initializeApp({ credential: cred });
const auth = admin.auth();

(async () => {
  console.log(`\nsuper-admin claims — ${APPLY ? 'APPLY' : 'DRY-RUN'} — action=${REVOKE ? 'REVOKE' : 'GRANT'}\n`);
  for (const email of emails) {
    try {
      const u = await auth.getUserByEmail(email);
      const existing = u.customClaims || {};
      const next = { ...existing };
      if (REVOKE) delete next.superAdmin; else next.superAdmin = true;
      console.log(`${email.padEnd(34)} uid=${u.uid}  current=${existing.superAdmin === true}  ->  ${REVOKE ? 'false' : 'true'}`);
      if (APPLY) await auth.setCustomUserClaims(u.uid, next);
    } catch (e) {
      console.log(`${email.padEnd(34)} ERROR: ${e.message}`);
    }
  }
  if (!APPLY) console.log('\nDry-run only. Re-run with --apply. Affected users must refresh their token (sign out/in or getIdToken(true)).');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
