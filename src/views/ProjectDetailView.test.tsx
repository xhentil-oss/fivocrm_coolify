import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// ── Mocks ──
// The view is a read-model over eight collections plus a pile of mutations, so
// the whole data layer is stubbed. What this suite guards is the RENDER TREE:
// the header used to carry the budget, the billing panel and the entire client
// questionnaire; those are tabs now, and a crash in any of them (or a filter row
// that keeps scoping panels it has no business scoping) would otherwise only
// show up in production.

const permissions = { isOwner: true, isAdmin: true, isManager: false, isSuperAdmin: false, canEdit: true };
vi.mock('../contexts/PermissionsContext', () => ({ usePermissions: () => permissions }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));

const navigate = vi.fn();
let searchParams = new URLSearchParams();
vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: 'p1' }),
  useNavigate: () => navigate,
  useSearchParams: () => [searchParams, vi.fn()],
}));

vi.mock('../hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const collections: Record<string, any[]> = {};
const documents: Record<string, any> = {};
vi.mock('../hooks/useFirestore', () => ({
  useCollection: (name: string) => ({ data: collections[name] ?? [], loading: false }),
  useDocument: (name: string, id: string) => ({
    data: id ? (documents[`${name}/${id}`] ?? null) : null,
    loading: false,
  }),
  useMutation: () => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn() }),
}));

vi.mock('../hooks/useRoleFilteredData', () => ({
  useFilteredTasks: (tasks: any[]) => tasks,
  useUniqueTeamMembers: (members: any[]) => members,
}));

const NAMES: Record<string, string> = { u1: 'Ana K.', u2: 'Bledi M.' };
vi.mock('../hooks/useUserNames', () => ({
  useUserNames: () => ({
    getName: (id: string) => NAMES[id] || 'I panjohur',
    getInitials: (id: string) => (NAMES[id] || '??').slice(0, 2).toUpperCase(),
  }),
}));

// The panel is a view of its own and pulls in the whole comment stack.
vi.mock('../components/TaskDetailPanel', () => ({
  default: () => <div data-testid="task-panel" />,
}));

// Both reach for the Firebase app at import time, which jsdom has no business
// booting for a render test.
vi.mock('../lib/firebase', () => ({ getNextInvoiceNumber: vi.fn(async () => 'FAT-0001') }));
vi.mock('firebase/firestore', () => ({ increment: (n: number) => n }));
vi.mock('../lib/notifyClient', () => ({ resolvePortalUserId: vi.fn(async () => null) }));

import ProjectDetailView from './ProjectDetailView';

// jsdom implements no layout, so the comment-focus hook's scroll call throws.
Element.prototype.scrollIntoView = vi.fn();

const DAY = 86_400_000;
const now = new Date();
const at = (offsetDays: number) => new Date(now.getTime() + offsetDays * DAY);

/** Radix activates a tab on mousedown/focus, not on a synthetic `click`. */
function selectTab(name: string | RegExp) {
  const trigger = screen.getByRole('tab', { name });
  fireEvent.mouseDown(trigger);
  fireEvent.focus(trigger);
  return trigger;
}

/** A project with tasks, one overdue, money on both sides and an unanswered client. */
function seed() {
  documents['projects/p1'] = {
    id: 'p1', name: 'Website MedRise', status: 'Active', teamId: 't1',
    customerId: 'c1', budget: 450_000, currency: 'ALL', billingType: 'one-time',
    memberUserIds: ['u1', 'u2'], createdByUserId: 'u1',
    sourceQuestionnaireId: 'q1',
  };
  documents['customers/c1'] = { id: 'c1', name: 'MedRise Sh.p.k.' };
  documents['serviceInquiries/q1'] = {
    id: 'q1', businessName: 'MedRise Sh.p.k.', email: 'info@medrise.al',
    businessDescription: 'Klinikë private', website: '', logoUrl: '',
  };

  collections.tasks = [
    { id: 'k1', title: 'Dizajni i homepage', projectId: 'p1', status: 'Done', assignedToUserId: 'u2', endDate: at(-8), section: 'Dizajn', priority: 'high' },
    { id: 'k2', title: 'Ndërtimi i CMS', projectId: 'p1', status: 'In Progress', assignedToUserId: 'u1', endDate: at(9), section: 'Zhvillim', priority: 'high' },
    // Past due and not Done → drives the hero's "Detyra me vonesë" row.
    { id: 'k3', title: 'SEO teknik', projectId: 'p1', status: 'Todo', assignedToUserId: 'u1', endDate: at(-3), section: 'Zhvillim', priority: 'medium' },
  ];
  collections.teams = [{ id: 't1', name: 'Ekipi Dev' }];
  collections.teamMembers = [
    { id: 'm1', userId: 'u1', displayName: 'Ana K.', status: 'Active', teamId: 't1', monthlySalary: 60_000 },
    { id: 'm2', userId: 'u2', displayName: 'Bledi M.', status: 'Active', teamId: 't1', monthlySalary: 55_000 },
  ];
  collections.invoices = [
    { id: 'i1', invoiceNumber: 'FAT-0158', projectId: 'p1', status: 'Paid', total: 150_000, currency: 'ALL', createdAt: at(-20), dueDate: at(-12) },
    { id: 'i2', invoiceNumber: 'FAT-0142', projectId: 'p1', status: 'Overdue', total: 100_000, currency: 'ALL', createdAt: at(-30), dueDate: at(-12) },
  ];
  collections.expenses = [{ id: 'e1', projectId: 'p1', amount: 72_000, currency: 'ALL', date: at(-5) }];
  collections.timeEntries = [{ id: 'te1', projectId: 'p1', taskId: 'k1', duration: 3600 * 6 }];
  // Trailing client message with no team reply after it → 1 unanswered.
  collections.projectComments = [
    { id: 'pc1', projectId: 'p1', senderType: 'team', userId: 'u1', content: 'Ja ku jemi.', createdAt: at(-2) },
    { id: 'pc2', projectId: 'p1', senderType: 'client', content: 'A e shohim draftin?', createdAt: at(-1) },
  ];
  collections.taskComments = [];
}

describe('ProjectDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(collections).forEach(k => delete collections[k]);
    Object.keys(documents).forEach(k => delete documents[k]);
    permissions.isAdmin = true;
    searchParams = new URLSearchParams();
    seed();
  });

  it('leads with the project identity and one hero figure', () => {
    render(<ProjectDetailView />);
    expect(screen.getByRole('heading', { level: 1, name: 'Website MedRise' })).toBeInTheDocument();
    // Client · team, which the old header showed as a bare team chip.
    expect(screen.getByText('MedRise Sh.p.k. · Ekipi Dev')).toBeInTheDocument();

    expect(screen.getByText('Progresi')).toBeInTheDocument();
    expect(screen.getByText('33%')).toBeInTheDocument(); // 1 of 3 tasks Done
    expect(screen.getByText('1 nga 3 detyra të përfunduara')).toBeInTheDocument();
    expect(screen.getByText('Orë të regjistruara')).toBeInTheDocument();
    expect(screen.getByText('Detyra me vonesë')).toBeInTheDocument();
    expect(screen.getByText('Komente pa përgjigje')).toBeInTheDocument();
  });

  it('shows the four money tiles to a user who may see financials', () => {
    render(<ProjectDetailView />);
    expect(screen.getByText('Buxheti i shpenzuar')).toBeInTheDocument();
    expect(screen.getByText('Faturuar')).toBeInTheDocument();
    expect(screen.getByText('Arkëtuar')).toBeInTheDocument();
    expect(screen.getByText('Pa arkëtuar')).toBeInTheDocument();
    // FAT-0142 is outstanding and 12 days past due → it names itself on the tile.
    expect(screen.getByText(/FAT-0142 vonesë/)).toBeInTheDocument();
  });

  it('hides money entirely from a user who may not see financials', () => {
    permissions.isAdmin = false;
    render(<ProjectDetailView />);
    expect(screen.queryByText('Buxheti i shpenzuar')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Financat/ })).not.toBeInTheDocument();
    // The hero still stands on its own.
    expect(screen.getByText('Progresi')).toBeInTheDocument();
  });

  it('renders every tab without crashing', () => {
    render(<ProjectDetailView />);

    // Lista
    expect(screen.getByText('Dizajni i homepage')).toBeInTheDocument();
    expect(screen.getByText('SEO teknik')).toBeInTheDocument();

    selectTab('Bordi');
    expect(screen.getByText('Për të bërë')).toBeInTheDocument();

    selectTab('Kalendar');
    expect(screen.getByText('Hën')).toBeInTheDocument();

    selectTab(/Financat/);
    expect(screen.getByText('Buxheti')).toBeInTheDocument();
    expect(screen.getByText('Faturimi')).toBeInTheDocument();
    expect(screen.getByText('FAT-0158')).toBeInTheDocument();

    selectTab(/Anketa/);
    expect(screen.getByText('Detajet nga anketa e klientit')).toBeInTheDocument();

    selectTab(/Diskutimi/);
    expect(screen.getByText('Diskutimi me klientin')).toBeInTheDocument();
    expect(screen.getByText('A e shohim draftin?')).toBeInTheDocument();
  });

  it('scopes the task filters to the task views only', () => {
    render(<ProjectDetailView />);
    expect(screen.getByPlaceholderText('Kërko detyrë…')).toBeInTheDocument();

    // Financat has no tasks to filter, so the row must not follow it there.
    selectTab(/Financat/);
    expect(screen.queryByPlaceholderText('Kërko detyrë…')).not.toBeInTheDocument();

    selectTab('Bordi');
    expect(screen.getByPlaceholderText('Kërko detyrë…')).toBeInTheDocument();
  });

  it('counts what needs attention on the tab badges', () => {
    render(<ProjectDetailView />);
    // One client message with no reply after it.
    expect(within(screen.getByRole('tab', { name: /Diskutimi/ })).getByText('1')).toBeInTheDocument();
    // The questionnaire is mostly empty → several missing items.
    const anketa = screen.getByRole('tab', { name: /Anketa/ });
    expect(Number(within(anketa).getByText(/^\d+$/).textContent)).toBeGreaterThan(0);
  });

  it('filters the task list by search', () => {
    render(<ProjectDetailView />);
    fireEvent.change(screen.getByPlaceholderText('Kërko detyrë…'), { target: { value: 'SEO' } });
    expect(screen.getByText('SEO teknik')).toBeInTheDocument();
    expect(screen.queryByText('Dizajni i homepage')).not.toBeInTheDocument();
  });

  it('opens the discussion tab for a "new client comment" deep link', () => {
    // The comment used to sit under the task list; now it is a tab, so the
    // notification link has to land ON that tab or it leads nowhere.
    searchParams = new URLSearchParams('projectComment=pc2');
    render(<ProjectDetailView />);
    expect(screen.getByText('Diskutimi me klientin')).toBeInTheDocument();
    expect(screen.getByText('A e shohim draftin?')).toBeInTheDocument();
  });

  it('opens a task in the drawer rather than squeezing the list', () => {
    render(<ProjectDetailView />);
    expect(screen.queryByTestId('task-panel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('SEO teknik'));
    expect(screen.getByTestId('task-panel')).toBeInTheDocument();
    // The list is still there underneath — the old layout hid it on desktop.
    expect(screen.getByText('Dizajni i homepage')).toBeInTheDocument();
  });
});
