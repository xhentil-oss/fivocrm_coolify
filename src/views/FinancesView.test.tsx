import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// ── Mocks ──
// The view is a pure read-model over five collections, so the whole data layer
// is stubbed. What this suite guards is the RENDER TREE: the layout is a navy
// hero + four KPI cards + four tabs, and a crash in any tab (or a control that
// stops scoping its panels) would otherwise only show up in production, since
// this view has no other coverage.

const permissions = { isOwner: true, isAdmin: false, isSuperAdmin: false };
vi.mock('../contexts/PermissionsContext', () => ({
  usePermissions: () => permissions,
}));

// The view reads the signed-in user because compensation is now loaded through
// `useMemberCompensation`, which only reads a member's own pay row when they are
// not an admin. An owner here, matching `permissions` above.
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'owner-1' } }) }));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
// Hosting module off in these tests: the MRR card and the extra listeners stay out of the way.
vi.mock('../hooks/useModules', () => ({ useModules: () => ({ isEnabled: () => false, blockReason: () => null, plan: 'pro', disabledModules: [], loading: false, canManage: false, modules: [], setModuleEnabled: async () => {} }) }));

// jsdom reports zero width, so recharts' ResponsiveContainer renders nothing and
// logs. Swap it for a fixed-size box; the charts themselves still mount.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 230 }}>{children}</div>
    ),
  };
});

const DAY = 86_400_000;
const now = new Date();
const iso = (offsetDays: number) => new Date(now.getTime() + offsetDays * DAY).toISOString();

const MONTHS = [
  'Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor',
  'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor',
];
const CUR_MONTH = MONTHS[now.getMonth()];
const PREV_MONTH = MONTHS[(now.getMonth() + 11) % 12];

const collections: Record<string, any[]> = {};
const documents: Record<string, any> = {};
vi.mock('../hooks/useFirestore', () => ({
  useCollection: (name: string) => ({ data: collections[name] ?? [], loading: false }),
  // `useMemberCompensation` reads a single `teamMemberComp` row for a
  // non-privileged viewer. Nothing is seeded here, which is the pre-backfill
  // state: the legacy `teamMembers` fields keep answering, and the payroll
  // figures these tests assert on must be identical either way.
  useDocument: (name: string, id?: string) => ({
    data: id ? (documents[`${name}/${id}`] ?? null) : null,
    loading: false,
  }),
}));

import FinancesView from './FinancesView';

/**
 * Radix activates a tab on mousedown/focus, not on a synthetic `click` — in a
 * real browser the click carries the focus with it, in jsdom it does not.
 */
function selectTab(name: string | RegExp) {
  const trigger = screen.getByRole('tab', { name });
  fireEvent.mouseDown(trigger);
  fireEvent.focus(trigger);
  return trigger;
}

/**
 * The hero defaults to the CLOSED month before the 15th, so any assertion about
 * this month's figures has to pin the toggle first — otherwise the suite passes
 * or fails depending on the day it runs.
 */
function showCurrentMonth() {
  fireEvent.click(screen.getByRole('button', { name: `${CUR_MONTH} · deri sot` }));
}

/** A tenant with money in, money out, an overdue invoice and a stuck recurring. */
function seed() {
  collections.invoices = [
    {
      id: 'i1', customerId: 'c1', status: 'Paid', total: 400_000, currency: 'ALL',
      invoiceDate: iso(-6), paidAt: iso(-3), dueDate: iso(-10), source: 'whmcs',
    },
    {
      id: 'i2', customerId: 'c2', status: 'Paid', total: 250_000, currency: 'ALL',
      invoiceDate: iso(-5), paidAt: iso(-2), dueDate: iso(-5), projectId: 'p1',
    },
    // Outstanding + past due → drives the "Të vonuara" tile and the alarms.
    { id: 'i3', customerId: 'c1', status: 'Pending', total: 120_000, currency: 'ALL', invoiceDate: iso(-25), dueDate: iso(-20) },
    // A recurring parent whose next cycle is long past and never spawned a child.
    {
      id: 'i4', customerId: 'c2', status: 'Sent', total: 90_000, currency: 'ALL',
      invoiceDate: iso(-70), isRecurring: true, recurringFrequency: 'monthly',
      nextRecurringDate: iso(-40), dueDate: iso(-40),
    },
    // A recurring parent with no frequency at all → misconfigured branch.
    { id: 'i5', customerId: 'c1', status: 'Sent', total: 30_000, currency: 'ALL', invoiceDate: iso(-15), isRecurring: true },
  ];
  collections.expenses = [
    { id: 'e1', amount: 50_000, currency: 'ALL', date: iso(-4), category: 'Qira' },
    { id: 'e2', amount: 20_000, currency: 'ALL', date: iso(-1), projectId: 'p1' },
  ];
  collections.customers = [
    { id: 'c1', name: 'Alfa Group' },
    { id: 'c2', name: 'Beta Studio' },
  ];
  collections.projects = [
    {
      id: 'p1', name: 'Rifreskim Web', customerId: 'c2', budget: 300_000, currency: 'ALL',
      status: 'Active', department: 'Web', responsibleUserId: 'u1', billingType: 'one-time',
      startDate: iso(-60), spent: 80_000,
    },
    {
      id: 'p2', name: 'Retainer Social', customerId: 'c1', budget: 100_000, currency: 'ALL',
      status: 'Active', department: 'Social', responsibleUserId: 'u2', billingType: 'monthly',
      isRecurring: true, startDate: iso(-120), spent: 200_000,
    },
  ];
  collections.teamMembers = [
    { id: 't1', userId: 'u1', displayName: 'Ana K.', monthlySalary: 60_000, status: 'active' },
    { id: 't2', userId: 'u2', displayName: 'Bledi M.', monthlySalary: 55_000, status: 'active' },
  ];
}

describe('FinancesView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(collections).forEach(k => delete collections[k]);
    permissions.isOwner = true;
    seed();
  });

  it('leads with exactly one hero figure and its derivation', () => {
    render(<FinancesView />);
    expect(screen.getByRole('heading', { level: 1, name: 'Financat' })).toBeInTheDocument();
    expect(screen.getByText('Fitimi neto')).toBeInTheDocument();
    // The "where does this number come from" waterfall lives INSIDE the hero, so
    // the headline is never shown unexplained.
    expect(screen.getByText('Para që hyri (arkëtuar)')).toBeInTheDocument();
    expect(screen.getByText('− Rrogat')).toBeInTheDocument();
    expect(screen.getByText('= Fitimi neto')).toBeInTheDocument();
    // Exactly four supporting measures — a fifth would compete with the hero.
    expect(screen.getByText(/^Parashikim ·/)).toBeInTheDocument();
    expect(screen.getByText('Marzhi i fitimit')).toBeInTheDocument();
    expect(screen.getByText('Të pambledhura')).toBeInTheDocument();
    expect(screen.getByText('Të vonuara')).toBeInTheDocument();
  });

  it('reads the closed month or month-to-date, and says which', () => {
    render(<FinancesView />);
    const prevBtn = screen.getByRole('button', { name: `${PREV_MONTH} (i mbyllur)` });
    const curBtn = screen.getByRole('button', { name: `${CUR_MONTH} · deri sot` });

    // Before the 15th a few days of collections against a whole month's payroll
    // is noise, so the CLOSED month leads by default.
    const autoPrev = now.getDate() < 15;
    expect(prevBtn).toHaveAttribute('aria-pressed', String(autoPrev));
    expect(curBtn).toHaveAttribute('aria-pressed', String(!autoPrev));

    // The month pill in the hero follows the toggle, both ways.
    fireEvent.click(curBtn);
    expect(screen.getByText(`${CUR_MONTH} ${now.getFullYear()}`)).toBeInTheDocument();
    fireEvent.click(prevBtn);
    expect(screen.queryByText(`${CUR_MONTH} ${now.getFullYear()}`)).not.toBeInTheDocument();
  });

  it('counts risks on the tab badge and details them inside the tab', () => {
    render(<FinancesView />);
    showCurrentMonth();

    // Overdue invoice + stuck recurring + misconfigured recurring all fire, so
    // the badge carries a count rather than the page carrying an alarm banner.
    const riskTab = screen.getByRole('tab', { name: /Rreziqet/ });
    expect(within(riskTab).getByText(/^\d+$/)).toBeInTheDocument();

    selectTab(/Rreziqet/);
    expect(screen.getByText('Çfarë kërkon vëmendje')).toBeInTheDocument();
    expect(screen.getByText('Faturat recurring')).toBeInTheDocument();
    expect(screen.getByText('Shëndeti i rrjedhës së parasë')).toBeInTheDocument();
    // Both broken-recurring branches render: overdue and never-will-generate.
    expect(screen.getByText(/ditë vonesë/)).toBeInTheDocument();
    expect(screen.getByText(/Konfigurim i paplotë/)).toBeInTheDocument();
  });

  it('renders every tab without crashing', () => {
    render(<FinancesView />);

    // Tab 1 — overview
    expect(screen.getByText('Trendi i fitimit')).toBeInTheDocument();
    expect(screen.getByText('Arkëtimet sipas muajit')).toBeInTheDocument();

    // Tab 2 — profit, plus the one filter row that scopes its panels
    selectTab('Fitimi');
    expect(screen.getByText('Periudha')).toBeInTheDocument();
    expect(screen.getByText('Fitimi sipas departamentit')).toBeInTheDocument();
    expect(screen.getByText('Të ardhurat sipas përgjegjësit')).toBeInTheDocument();
    // The deeper cuts stay reachable, just folded away.
    expect(screen.getByText('Fitimi sipas projekti')).toBeInTheDocument();

    // Tab 3 — clients
    selectTab('Klientët');
    expect(screen.getByText('Klientët më fitimprurës')).toBeInTheDocument();
    expect(screen.getByText('Klientët me humbje')).toBeInTheDocument();
  });

  it('scopes the profit panels with one shared period + basis control', () => {
    render(<FinancesView />);
    selectTab('Fitimi');

    // Default: the year, on money actually collected — profit should open on
    // cash that arrived, not on a plan.
    expect(screen.getByRole('button', { name: 'Viti', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paguar', pressed: true })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Viti ${now.getFullYear()}`))).toBeInTheDocument();
    expect(screen.getByText(/vetëm faturat e paguara/)).toBeInTheDocument();

    // Switching the basis re-labels the summary line, proving the single control
    // reaches the panels (it used to live buried inside one card).
    fireEvent.click(screen.getByRole('button', { name: 'Buxhet' }));
    expect(screen.getByRole('button', { name: 'Buxhet', pressed: true })).toBeInTheDocument();
    expect(screen.getByText(/buxheti i projekteve/)).toBeInTheDocument();

    // A specific month is reachable from the same row, replacing the second,
    // independent month dropdown the responsible card used to own.
    const monthPicker = screen.getByLabelText('Zgjidh një muaj të caktuar') as HTMLSelectElement;
    fireEvent.change(monthPicker, { target: { value: monthPicker.options[1].value } });
    expect(screen.getByRole('button', { name: 'Viti', pressed: false })).toBeInTheDocument();
  });

  it('shows revenue, cash and profit symmetrically for department and person', () => {
    render(<FinancesView />);
    selectTab('Fitimi');

    // Both tables carry the same column ruler, so "who brought in what" reads
    // the same either way you slice it: 2 headers × 3 shared measures.
    for (const label of ['Të ardhura', 'Arkëtuar', 'Fitimi']) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(2);
    }
    // …and both foot in a totals row rather than leaving the columns unanchored.
    expect(screen.getAllByText('Gjithsej').length).toBeGreaterThanOrEqual(2);

    // i2 (250 000, paid, projectId p1) is the only invoice attributable to a
    // project — p1 is department "Web", responsible u1 ("Ana K.").
    expect(screen.getAllByText('250 000 Lekë').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Ana K\./)).toBeInTheDocument();
  });

  it('warns that collected cash with no project cannot reach either breakdown', () => {
    render(<FinancesView />);
    selectTab('Fitimi');
    // i1 is paid (400 000) but carries no projectId, so it belongs to no
    // department and no person — the panel must say so rather than silently
    // showing columns that do not add up.
    expect(screen.getByText(/nuk i takon\s+asnjë departamenti apo personi/)).toBeInTheDocument();
    expect(screen.getAllByText(/400 000 Lekë/).length).toBeGreaterThanOrEqual(1);
  });

  it('links unlinked invoices to the invoices page', () => {
    render(<FinancesView />);
    selectTab('Fitimi');
    fireEvent.click(screen.getByRole('button', { name: 'Lidhi me projektet' }));
    expect(navigate).toHaveBeenCalledWith('/app/invoices?project=none');
  });

  it('expands a department row into its projects', () => {
    render(<FinancesView />);
    selectTab('Fitimi');

    const row = screen.getByRole('button', { name: /^Social/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    // The project name also appears in the folded project table, so what proves
    // the drill-down opened is that it appears ONE MORE time than before.
    const before = screen.queryAllByText('Retainer Social').length;

    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryAllByText('Retainer Social').length).toBeGreaterThan(before);
  });

  it('stays owner-only', () => {
    permissions.isOwner = false;
    render(<FinancesView />);
    expect(screen.getByText('Kjo faqe është vetëm për pronarin.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Financat' })).not.toBeInTheDocument();
  });
});
