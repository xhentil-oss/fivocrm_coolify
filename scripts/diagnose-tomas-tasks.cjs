// Usage: node scripts/diagnose-tomas-tasks.cjs [email]
// Diagnoses why a user's tasks may not show for an admin.
// Prints: the user's teamMember records (teamId + role), all distinct teamIds
// present across tasks, and a breakdown of that user's tasks by teamId / status /
// whether they're subtasks. Helps confirm a teamId mismatch.
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const target = (process.argv[2] || 'tomas@fivo.al').toLowerCase().trim();

const saPath = path.join(__dirname, 'sa.json');
let cred;
if (fs.existsSync(saPath)) {
  cred = admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8')));
} else {
  const envText = fs.readFileSync(path.join(__dirname, '..', '.env.vercel.local'), 'utf8');
  const env = {};
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=("(.*)"|(.*))$/);
    if (m) env[m[1]] = m[3] !== undefined ? m[3] : m[4];
  }
  cred = admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  });
}
admin.initializeApp({ credential: cred });
const db = admin.firestore();

(async () => {
  // 1) Find the user's teamMember records (by email or userId)
  const tmSnap = await db.collection('teamMembers').get();
  const userMembers = [];
  const teamNameById = {};
  for (const d of tmSnap.docs) {
    const x = d.data();
    if ((x.email || '').toLowerCase() === target || (x.userId || '').toLowerCase() === target) {
      userMembers.push({ id: d.id, userId: x.userId, email: x.email, role: x.role, status: x.status, teamId: x.teamId });
    }
  }
  console.log(`\n=== teamMembers for ${target} (${tmSnap.size} total members) ===`);
  userMembers.forEach(m => console.log(JSON.stringify(m)));

  // Candidate identifiers for the user (userId may be uid or email)
  const userIds = new Set();
  userMembers.forEach(m => { if (m.userId) userIds.add(m.userId); });
  // also try Firebase Auth uid
  try {
    const authUser = await admin.auth().getUserByEmail(target);
    userIds.add(authUser.uid);
    console.log(`Auth uid: ${authUser.uid}`);
  } catch { console.log('No Firebase Auth user for that email'); }
  console.log('Identifiers used to match assignee:', [...userIds, target]);

  // 2) Teams collection (for names)
  const teamsSnap = await db.collection('teams').get();
  teamsSnap.docs.forEach(d => { teamNameById[d.id] = d.data().name || '(no name)'; });

  // 3) Tasks: distribution by teamId, and this user's tasks
  const tasksSnap = await db.collection('tasks').get();
  const byTeam = {};
  const userTasks = [];
  for (const d of tasksSnap.docs) {
    const x = d.data();
    const tid = x.teamId || '(none)';
    byTeam[tid] = (byTeam[tid] || 0) + 1;
    const assignee = (x.assignedToUserId || '').toLowerCase();
    if (userIds.has(x.assignedToUserId) || assignee === target) {
      userTasks.push({
        id: d.id,
        title: x.title,
        teamId: x.teamId || '(none)',
        status: x.status,
        isSubtask: !!x.parentTaskId,
        endDate: x.endDate && x.endDate.toDate ? x.endDate.toDate().toISOString().slice(0, 10) : x.endDate,
      });
    }
  }

  console.log(`\n=== tasks teamId distribution (${tasksSnap.size} total) ===`);
  Object.entries(byTeam).sort((a, b) => b[1] - a[1]).forEach(([tid, n]) =>
    console.log(`  ${n.toString().padStart(4)}  ${tid}  ${teamNameById[tid] ? '(' + teamNameById[tid] + ')' : ''}`));

  console.log(`\n=== tasks assigned to ${target}: ${userTasks.length} ===`);
  userTasks.forEach(t => console.log(JSON.stringify(t)));

  // 4) Summary of user's task teamIds
  const userTaskTeams = {};
  userTasks.forEach(t => { userTaskTeams[t.teamId] = (userTaskTeams[t.teamId] || 0) + 1; });
  console.log(`\n=== ${target}'s tasks grouped by teamId ===`);
  Object.entries(userTaskTeams).forEach(([tid, n]) =>
    console.log(`  ${n} task(s) in teamId=${tid} ${teamNameById[tid] ? '(' + teamNameById[tid] + ')' : ''}`));
  console.log('\nMember teamIds:', userMembers.map(m => m.teamId));

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
