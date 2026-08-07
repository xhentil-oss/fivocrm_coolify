import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Mocks ──
// The view is a pure read-model over five collections, so the whole data layer
// is stubbed. What this suite guards is the RENDER TREE: the layout was rebuilt
// from one 12-card scroll into hero + tiles + four tabs, and a crash in any tab
// (or a control that stops scoping its panels) would otherwise only show up in
// production, since this view has no other coverage.

const permissions = { isOwner: true, isAdmin: false, isSuperAdmin: false };
vi.mock('../contexts/PermissionsContext', () => ({
  usePermissions: () => permissions,
}));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

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

const collections: Record<string, any[]> = {};
vi.mock('../hooks/useFirestore', () => ({
  useCollection: (name: string) => ({ data: collections[name] ?? [], loading: false }),
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
    // Outstanding + past due → drives the "Të vonuara" tile and the alarm strip.
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
    expect(screen.getByText(/^Fitimi neto ·/)).toBeInTheDocument();
    // The "where does this number come from" waterfall is merged into the hero,
    // so the headline is never shown unexplained.
    expect(screen.getByText('Nga del ky numër')).toBeInTheDocument();
    expect(screen.getByText('Para që hyri (arkëtuar)')).toBeInTheDocument();
    expect(screen.getByText('= Fitimi neto')).toBeInTheDocument();
  });

  it('surfaces alarms at the top and jumps to the risk tab', () => {
    render(<FinancesView />);
    // Overdue invoice + stuck recurring both fire, so the strip must be present
    // ABOVE the tabs rather than at the bottom of a long scroll.
    const seeAll = screen.getByRole('button', { name: /Shiko/ });
    fireEvent.click(seeAll);
    expect(screen.getByText('Çfarë kërkon vëmendje')).toBeInTheDocument();
    expect(screen.getByText('Fatura recurring që nuk u përsëritën')).toBeInTheDocument();
    // The misconfigured branch renders too (recurring with no frequency).
    expect(screen.getByText(/Konfigurim i paplotë/)).toBeInTheDocument();
  });

  it('renders every tab without crashing', () => {
    render(<FinancesView />);

    // Tab 1 — overview
    expect(screen.getByText('Trendi i fitimit dhe parashikimi')).toBeInTheDocument();
    expect(screen.getByText('Të ardhurat sipas burimit')).toBeInTheDocument();
    expect(screen.getByText('Pa paguar nga WHMCS')).toBeInTheDocument();

    // Tab 2 — profit, plus the one filter row that scopes all four of its panels
    selectTab('Fitimi');
    expect(screen.getByText('Periudha')).toBeInTheDocument();
    expect(screen.getByText('Fitimi sipas projekti')).toBeInTheDocument();
    expect(screen.getByText('Të ardhurat dhe fitimi sipas departamentit')).toBeInTheDocument();
    expect(screen.getByText('Të ardhurat dhe fitimi sipas përgjegjësit')).toBeInTheDocument();

    // Tab 3 — clients
    selectTab('Klientët');
    expect(screen.getByText('Ku fiton më shumë')).toBeInTheDocument();
    expect(screen.getByText('Ku humb para')).toBeInTheDocument();

    // Tab 4 — cashflow
    selectTab(/Rrjedha/);
    expect(screen.getByText('Shëndeti i rrjedhës së parasë (mujore)')).toBeInTheDocument();
  });

  it('scopes the profit panels with one shared period + basis control', () => {
    render(<FinancesView />);
    selectTab('Fitimi');

    // Default: the year, on the budget basis.
    expect(screen.getByRole('button', { name: 'Viti', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buxhet', pressed: true })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Viti ${now.getFullYear()}`))).toBeInTheDocument();

    // Switching the basis re-labels the summary line, proving the single control
    // reaches the panels (it used to live buried inside one card).
    fireEvent.click(screen.getByRole('button', { name: 'Faturuar' }));
    expect(screen.getByRole('button', { name: 'Faturuar', pressed: true })).toBeInTheDocument();
    expect(screen.getByText(/fatura reale të lidhura/)).toBeInTheDocument();

    // A specific month is reachable from the same row, replacing the second,
    // independent month dropdown the responsible card used to own.
    const monthPicker = screen.getByLabelText('Zgjidh një muaj të caktuar') as HTMLSelectElement;
    fireEvent.change(monthPicker, { target: { value: monthPicker.options[1].value } });
    expect(screen.getByRole('button', { name: 'Viti', pressed: false })).toBeInTheDocument();
  });

  it('shows revenue, cash and profit symmetrically for department and person', () => {
    render(<FinancesView />);
    selectTab('Fitimi');

    expect(screen.getByText('Të ardhurat dhe fitimi sipas departamentit')).toBeInTheDocument();
    expect(screen.getByText('Të ardhurat dhe fitimi sipas përgjegjësit')).toBeInTheDocument();

    // The same four measures appear in both panels: two totals strips plus one
    // row each (Web department / Ana K.), so 4 of each label at minimum.
    for (const label of ['Të ardhura', 'Arkëtuar', 'Pa mbledhur', 'Fitim']) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(4);
    }

    // i2 (250 000, paid, projectId p1) is the only invoice attributable to a
    // project — p1 is department "Web", responsible u1 ("Ana K.").
    expect(screen.getAllByText('250 000 Lekë').length).toBeGreaterThanOrEqual(2);
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

  it('stays owner-only', () => {
    permissions.isOwner = false;
    render(<FinancesView />);
    expect(screen.getByText('Kjo faqe është vetëm për pronarin.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Financat' })).not.toBeInTheDocument();
  });
});
