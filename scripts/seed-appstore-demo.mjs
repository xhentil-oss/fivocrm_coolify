// App Store review demo workspace — creates (or RESETS) one isolated tenant with a
// staff owner and realistic sample data, so Apple's reviewer can sign in and see a
// working app, and so the App Store screenshots can be taken from it.
//
//   GOOGLE_APPLICATION_CREDENTIALS=scripts/sa.json \
//   DEMO_EMAIL=appreview@fivocrm.com DEMO_PASSWORD='…' \
//   node scripts/seed-appstore-demo.mjs
//
// Idempotent: every document has a FIXED id under the `demo_appreview` tenant, so a
// re-run overwrites the same rows instead of adding more (dates are re-based on today).
// It touches nothing outside that tenant.
//
// Safe for the crons: the tenant is `status: 'active'` (subscription-lifecycle skips
// it, so it is never suspended during review), customers carry
// `disableOverdueReminders` + `@example.com` addresses (reserved, undeliverable),
// invoices carry every reminder flag already set, nothing is recurring, and no
// WhatsApp account is connected.

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const EMAIL = (process.env.DEMO_EMAIL || 'appreview@fivocrm.com').toLowerCase();
const PASSWORD = process.env.DEMO_PASSWORD;
if (!PASSWORD || PASSWORD.length < 10) {
  console.error('DEMO_PASSWORD (≥10 chars) is required.');
  process.exit(1);
}

if (!getApps().length) initializeApp({ credential: applicationDefault() });
const auth = getAuth();
const db = getFirestore();

const BID = 'demo_appreview';
const TID = 'demo_appreview_team';
const NAME = 'Studio Demo';

const DAY = 86_400_000;
const at = (days, hour = 10) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour - 2, 0, 0, 0); // ~local Tirana hour
  return Timestamp.fromDate(d);
};
const now = Timestamp.now();
const tenant = { businessId: BID, teamId: TID };

// ── 1. The reviewer's login (verified — an unverified email is not an identity) ──
let user;
try {
  user = await auth.getUserByEmail(EMAIL);
  await auth.updateUser(user.uid, { password: PASSWORD, emailVerified: true, displayName: 'Arta Demo', disabled: false });
} catch (err) {
  if (err?.code !== 'auth/user-not-found') throw err;
  user = await auth.createUser({ email: EMAIL, password: PASSWORD, emailVerified: true, displayName: 'Arta Demo' });
}
const UID = user.uid;
// Two colleagues so assignees, chat and the team page are not empty. They have no
// Auth user: they can never sign in, they only exist as rows inside this tenant.
const TEAM = [
  { uid: UID, name: 'Arta Demo', email: EMAIL, role: 'Admin', title: 'Drejtore', position: 'management' },
  { uid: 'demo_user_besnik', name: 'Besnik Hoxha', email: 'besnik@example.com', role: 'Manager', title: 'Menaxher projektesh', position: 'management' },
  { uid: 'demo_user_elira', name: 'Elira Kola', email: 'elira@example.com', role: 'Member', title: 'Specialiste SEO', position: 'seo' },
];

const batch = db.batch();
const put = (col, id, data) => batch.set(db.collection(col).doc(id), data);

// ── 2. Tenant: business + team + settings ────────────────────────────────────
put('businesses', BID, {
  name: NAME,
  ownerEmail: EMAIL,
  ownerId: UID,
  plan: 'business',
  status: 'active',
  seats: 10,
  lockedModules: [],
  disabledModules: [],
  memberCount: TEAM.length,
  teamCount: 1,
  defaultTeamId: TID,
  isDemo: true,
  demoPurpose: 'App Store review + screenshots (scripts/seed-appstore-demo.mjs)',
  createdAt: now,
  updatedAt: now,
  createdByUserId: UID,
  createdBy: 'seed-appstore-demo',
});
put('teams', TID, {
  name: 'Përgjithshëm', businessId: BID, createdByUserId: UID, ownerEmail: EMAIL, createdAt: now, updatedAt: now,
});
put('teamSettings', TID, {
  ...tenant,
  companyName: NAME,
  companyEmail: 'info@example.com',
  eurAllRate: '100',
  whatsappEnabled: false,
  metaEnabled: false,
  updatedAt: now,
});

const PERMS = {
  canAccessProjects: true, canAccessTasks: true, canAccessCRM: true, canAccessInvoices: true,
  canAccessReports: true, canAccessSettings: true, canAccessGoals: true, canAccessTeams: true,
  canAccessChat: true, canAccessCustomers: true, canAccessServices: true, canAccessExpenses: true,
  canAccessProfile: true,
};
for (const m of TEAM) {
  put('teamMembers', `${TID}_${m.uid}`, {
    ...tenant, userId: m.uid, email: m.email, displayName: m.name, role: m.role, jobTitle: m.title, position: m.position,
    // `position` set so RequirePositionDialog does not block the reviewer on first open.
    ...PERMS, canAssignTasks: m.role !== 'Member', status: 'Active',
    invitedAt: now, createdAt: now, updatedAt: now, createdByUserId: UID,
  });
  put('userProfiles', `demo_profile_${m.uid}`, {
    ...tenant, userId: m.uid, displayName: m.name, email: m.email, jobTitle: m.title,
    lastSeenAt: now, createdAt: now, updatedAt: now, createdByUserId: m.uid,
  });
}
put('users', UID, { ...tenant, email: EMAIL, displayName: 'Arta Demo', updatedAt: now });

// ── 3. Catalogue ─────────────────────────────────────────────────────────────
const SERVICES = [
  ['seo', 'SEO mujor', 'SEO', 450, 'në muaj'],
  ['social', 'Menaxhim Social Media', 'Social Media', 600, 'në muaj'],
  ['ads', 'Google & Meta Ads', 'Ads', 400, 'në muaj'],
  ['web', 'Website korporativ', 'Web', 2800, 'një herë'],
  ['brand', 'Identitet vizual', 'Branding', 1200, 'një herë'],
];
for (const [k, name, category, price, billingPeriod] of SERVICES) {
  put('services', `demo_svc_${k}`, {
    ...tenant, name, title: name, category, price, currency: 'EUR', billingPeriod,
    description: `${name} për biznese që duan rezultate të matshme.`,
    createdAt: now, updatedAt: now, createdByUserId: UID,
  });
}

// ── 4. Customers ─────────────────────────────────────────────────────────────
const CUSTOMERS = [
  ['vila', 'Vila Mare Resort', 'Ardit Gjoni', 'Turizëm', 'VIP'],
  ['dent', 'DentaPlus Klinika', 'Dr. Ina Shehu', 'Shëndetësi', 'Active'],
  ['auto', 'AutoLux Tirana', 'Gentian Basha', 'Automjete', 'Active'],
  ['casa', 'Casa Design Studio', 'Klea Murati', 'Dizajn interieri', 'Active'],
  ['nova', 'Nova Pasuri të Paluajtshme', 'Erion Dervishi', 'Real estate', 'Active'],
  ['fresh', 'FreshBite Restorant', 'Sara Leka', 'Restorante', 'Pending'],
];
CUSTOMERS.forEach(([k, name, person, industry, status], i) => {
  put('customers', `demo_cus_${k}`, {
    ...tenant, name, company: name, contactPerson: person, industry, status,
    email: `${k}@example.com`, phone: `+355 69 000 00${10 + i}`,
    address: 'Tiranë, Shqipëri', tags: [industry],
    assignedToUserId: i % 2 ? 'demo_user_besnik' : UID,
    disableOverdueReminders: true, waOptOut: true,
    lastActivityAt: at(-(i + 1)), nextFollowUpDate: at(i + 1, 12), nextFollowUpType: 'call',
    createdAt: at(-90 + i * 7), updatedAt: now, createdByUserId: UID,
  });
});

// ── 5. Leads (a full pipeline) ───────────────────────────────────────────────
const LEADS = [
  ['hotel', 'Hotel Butrinti', 'New', 'Website', 3500],
  ['gym', 'PowerGym Fitness', 'Contacted', 'Facebook', 1800],
  ['law', 'Studio Ligjore Kodra', 'Qualified', 'Referim', 2400],
  ['bake', 'Furra Ëmbëlsira', 'Proposal', 'Instagram', 1500],
  ['agro', 'AgroFresh Export', 'Follow-up', 'Google Ads', 4200],
  ['opt', 'Optika Vizion', 'New', 'Landing page', 900],
  ['tech', 'TechHub Academy', 'Won', 'Referim', 5200],
  ['flor', 'Lulishtja Flora', 'Lost', 'Facebook', 700],
];
LEADS.forEach(([k, name, status, source, value], i) => {
  put('leads', `demo_lead_${k}`, {
    ...tenant, name, company: name, status, source, value, estimatedValue: value,
    probability: { New: 10, Contacted: 25, Qualified: 45, Proposal: 60, 'Follow-up': 50, Won: 100, Lost: 0 }[status],
    email: `${k}@example.com`, phone: `+355 68 000 00${20 + i}`,
    serviceInterest: ['SEO', 'Social Media', 'Ads', 'Web'][i % 4],
    notes: 'Kërkon ofertë për paketën mujore të marketingut.',
    assignedToUserId: i % 3 === 0 ? 'demo_user_besnik' : UID,
    waOptOut: true,
    ...(status === 'Lost' ? { lostReason: 'Buxhet i pamjaftueshëm' } : {}),
    ...(['Won', 'Lost'].includes(status) ? {} : { nextFollowUpDate: at(i % 4, 12), nextFollowUpType: 'whatsapp' }),
    lastActivityAt: at(-i), createdAt: at(-30 + i * 3), updatedAt: now, createdByUserId: UID,
  });
});

// ── 6. Projects + tasks ──────────────────────────────────────────────────────
const PROJECTS = [
  ['vila', 'Fushata verore — Vila Mare', 'vila', 'Active', 'monthly', 1050, 'Social Media'],
  ['dent', 'SEO lokal — DentaPlus', 'dent', 'Active', 'monthly', 450, 'SEO'],
  ['auto', 'Website i ri — AutoLux', 'auto', 'Active', 'one-time', 2800, 'Web'],
  ['casa', 'Identitet vizual — Casa Design', 'casa', 'Completed', 'one-time', 1200, 'Branding'],
];
for (const [k, name, cus, status, billingType, budget, department] of PROJECTS) {
  put('projects', `demo_prj_${k}`, {
    ...tenant, name, status, billingType, budget, currency: 'EUR', department,
    customerId: `demo_cus_${cus}`,
    description: `${department} për ${name.split('— ')[1]}.`,
    responsibleUserId: k === 'dent' ? 'demo_user_elira' : 'demo_user_besnik',
    memberUserIds: TEAM.map((m) => m.uid),
    startDate: at(-40), endDate: at(status === 'Completed' ? -5 : 45),
    isRecurring: false, workCycle: null,
    createdAt: at(-40), updatedAt: now, createdByUserId: UID,
  });
}
const TASKS = [
  ['vila', 'Kalendari i postimeve për korrik', 'Done', 'medium', -3, UID],
  ['vila', 'Xhirim reels në resort', 'In Progress', 'high', 1, 'demo_user_besnik'],
  ['vila', 'Raporti mujor i rezultateve', 'Todo', 'medium', 6, UID],
  ['vila', 'Fushatë Meta Ads për rezervime', 'Review', 'urgent', 0, 'demo_user_besnik'],
  ['dent', 'Optimizim Google Business Profile', 'Done', 'high', -6, 'demo_user_elira'],
  ['dent', 'Kërkim fjalësh kyçe — implante', 'In Progress', 'medium', 2, 'demo_user_elira'],
  ['dent', '4 artikuj blogu për muajin', 'Todo', 'medium', 9, 'demo_user_elira'],
  ['auto', 'Wireframe i faqes kryesore', 'Done', 'high', -10, UID],
  ['auto', 'Katalogu i makinave me filtra', 'In Progress', 'urgent', 3, 'demo_user_besnik'],
  ['auto', 'Formulari i test-drive', 'Todo', 'medium', 7, UID],
  ['auto', 'Testim në celular dhe publikim', 'Todo', 'high', 14, 'demo_user_besnik'],
  ['casa', 'Logo dhe paleta e ngjyrave', 'Done', 'high', -20, UID],
  ['casa', 'Manuali i brandit (PDF)', 'Done', 'medium', -8, UID],
  [null, 'Telefono klientin e ri — Hotel Butrinti', 'Todo', 'high', 0, UID],
];
TASKS.forEach(([prj, title, status, priority, dueIn, assignee], i) => {
  put('tasks', `demo_task_${String(i + 1).padStart(2, '0')}`, {
    ...tenant, title, status, priority,
    ...(prj ? { projectId: `demo_prj_${prj}` } : {}),
    assignedToUserId: assignee,
    startDate: at(dueIn - 3, 9), endDate: at(dueIn, 17), dueDate: at(dueIn, 17),
    isRecurring: false,
    ...(status === 'Done' ? { completedAt: at(dueIn, 15) } : {}),
    createdAt: at(dueIn - 5), updatedAt: now, createdByUserId: UID,
  });
});

// ── 7. Invoices + expenses ───────────────────────────────────────────────────
const REMINDERS_DONE = {
  emailSent: true, reminderSent: true, reminder25Sent: true, reminderLastDaySent: true,
  preDueWaSentAt: now, dueWaSentAt: now, overdueWaSentAt: now, overdueNoticeSentAt: now,
};
const INVOICES = [
  ['001', 'vila', 'vila', 1050, 'Paid', -45],
  ['002', 'dent', 'dent', 450, 'Paid', -40],
  ['003', 'casa', 'casa', 1200, 'Paid', -25],
  ['004', 'vila', 'vila', 1050, 'Paid', -15],
  ['005', 'dent', 'dent', 450, 'Pending', -5],
  ['006', 'auto', 'auto', 1400, 'Pending', -2],
  ['007', 'nova', null, 650, 'Overdue', -35],
];
for (const [n, cus, prj, amount, status, issuedIn] of INVOICES) {
  put('invoices', `demo_inv_${n}`, {
    ...tenant, invoiceNumber: `INV-2026-${n}`, customerId: `demo_cus_${cus}`,
    ...(prj ? { projectId: `demo_prj_${prj}` } : {}),
    amount, total: amount, subtotal: amount, currency: 'EUR', status,
    invoiceDate: at(issuedIn), dueDate: at(issuedIn + 15),
    ...(status === 'Paid' ? { paidAt: at(issuedIn + 7), paidAmount: amount } : {}),
    isRecurring: false, notes: 'Faleminderit për bashkëpunimin!',
    ...REMINDERS_DONE,
    createdAt: at(issuedIn), updatedAt: now, createdByUserId: UID,
  });
}
const EXPENSES = [
  ['ads', 'Buxhet reklamash Meta — Vila Mare', 300, 'Marketing', 'vila', -10],
  ['soft', 'Abonime software (Adobe, Figma)', 95, 'Software', null, -12],
  ['rent', 'Qiraja e zyrës', 600, 'Rent', null, -18],
  ['photo', 'Fotograf për xhirimet', 180, 'Freelance', 'vila', -4],
];
for (const [k, title, amount, category, prj, d] of EXPENSES) {
  put('expenses', `demo_exp_${k}`, {
    ...tenant, title, amount, currency: 'EUR', category, date: at(d),
    ...(prj ? { projectId: `demo_prj_${prj}` } : {}),
    approvalStatus: 'Approved', approvedByUserId: UID, status: 'Paid', isRecurring: false,
    createdAt: at(d), updatedAt: now, createdByUserId: UID,
  });
}

// ── 8. Team chat (one group channel) ─────────────────────────────────────────
const CH = 'demo_channel_team';
const MESSAGES = [
  ['demo_user_besnik', 'Mirëmëngjes! Reels-at për Vila Mare janë gati për rishikim 🎬', -95],
  [UID, 'Super, i shoh tani. Le t\'i publikojmë nesër në 10:00.', -80],
  ['demo_user_elira', 'DentaPlus doli në top 3 për "implante dentare Tiranë" 🎉', -45],
  [UID, 'Bravo Elira! E fus në raportin mujor për klientin.', -30],
  ['demo_user_besnik', 'Kujtesë: takim me AutoLux sot në 15:00 për katalogun.', -10],
];
put('channels', CH, {
  ...tenant, name: 'Ekipi', description: 'Biseda e përditshme e ekipit', isGroup: true, isPrivate: false,
  members: TEAM.map((m) => m.uid), admins: [UID],
  lastMessageAt: Timestamp.fromMillis(Date.now() + MESSAGES.at(-1)[2] * 60_000),
  lastMessagePreview: MESSAGES.at(-1)[1], lastMessageSenderId: MESSAGES.at(-1)[0],
  createdAt: at(-60), updatedAt: now, createdByUserId: UID,
});
MESSAGES.forEach(([sender, content, minutesAgo], i) => {
  const ts = Timestamp.fromMillis(Date.now() + minutesAgo * 60_000);
  put('messages', `demo_msg_${i + 1}`, {
    ...tenant, channelId: CH, senderId: sender, senderType: 'staff', content,
    isRead: true, readBy: TEAM.map((m) => m.uid),
    createdAt: ts, updatedAt: ts,
  });
});

await batch.commit();

// ── 9. Claims (bid/tid/roles) — the same shape _tenantClaims mints ───────────
// The app re-mints them on login anyway (ensureTenantClaims); setting them here
// means the very first request already passes the rules.
await auth.setCustomUserClaims(UID, { bid: BID, tid: TID, roles: ['Admin'] });

console.log(JSON.stringify({ ok: true, email: EMAIL, uid: UID, businessId: BID, teamId: TID }, null, 2));
