import React, { useMemo, useCallback, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  FolderKanban,
  Users,
  CheckSquare,
  Settings,
  UsersRound,
  Receipt,
  MessageSquare,
  MessageCircle,
  Target,
  DollarSign,
  FileText,
  Briefcase,
  LayoutDashboard,
  Award,
  Calculator,
  Globe,
  ScrollText,
  Handshake,
  Building2,
  Wallet,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  PiggyBank,
  Megaphone,
  Rocket,
  Share2,
  Star,
  Package,
  CreditCard,
  ClipboardList,
  HeartPulse,
  Search,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { isPathEnabled, type PlanKey } from '../lib/modules';
import { usePermissions } from '../contexts/PermissionsContext';
import { useAuth } from '../contexts/AuthContext';
import { useCollection, useDocument, useGlobalBusinessId } from '../hooks/useFirestore';
import type { Business } from '../types';

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  /** Collapse/expand toggle rendered inside the sidebar header (design v2). */
  onToggleCollapse?: () => void;
  /** "Gjej modul… ⌘K" search trigger — opens the command palette. */
  onOpenCommandPalette?: () => void;
}

type NavItem = {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permissionKey: string;
};

// A collapsible parent that groups related leaf items under one header.
type NavGroup = {
  group: string;            // stable key
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: NavItem[];
};

type NavEntry = NavItem | NavGroup;

// Nav is organised in labelled sections (design v2: "Puna ime", "Shitjet & klientët"…).
// A section whose entries are all filtered out disappears with them.
type NavSection = { key: string; label: string; entries: NavEntry[] };

const isGroup = (e: NavEntry): e is NavGroup => 'children' in e;

const allSections: NavSection[] = [
  {
    key: 'platform',
    label: 'Platforma',
    entries: [
      // Leaves the tenant shell entirely — the platform console is its own surface.
      { path: '/superadmin', label: 'Konsola e Platformës', icon: Building2, permissionKey: 'isSuperAdmin' },
    ],
  },
  {
    key: 'my-work',
    label: 'Puna ime',
    entries: [
      { path: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard, permissionKey: 'canAccessProfile' },
      { path: '/app/tasks', label: 'Detyrat', icon: CheckSquare, permissionKey: 'canAccessTasks' },
      { path: '/app/projects', label: 'Projektet', icon: FolderKanban, permissionKey: 'canAccessProjects' },
      { path: '/app/workspace', label: 'Workspace', icon: Briefcase, permissionKey: 'canAccessProjects' },
      { path: '/app/goals', label: 'Objektivat', icon: Target, permissionKey: 'canAccessGoals' },
      { path: '/app/momentum', label: 'Performanca ime', icon: Rocket, permissionKey: 'canAccessProfile' },
    ],
  },
  {
    key: 'sales',
    label: 'Shitjet & klientët',
    entries: [
      { path: '/app/crm', label: 'CRM Leads', icon: Users, permissionKey: 'canAccessCRM' },
      { path: '/app/deals', label: 'Marrëveshjet', icon: Handshake, permissionKey: 'canAccessCRM' },
      { path: '/app/customers', label: 'Klientët', icon: Users, permissionKey: 'canAccessCustomers' },
      { path: '/app/service-inquiries', label: 'Kërkesat', icon: FileText, permissionKey: 'canAccessCRM' },
      { path: '/app/contracts', label: 'Kontratat', icon: ScrollText, permissionKey: 'canAccessInvoices' },
      { path: '/app/services', label: 'Shërbimet', icon: Receipt, permissionKey: 'canAccessServices' },
      { path: '/app/products', label: 'Dyqani', icon: Package, permissionKey: 'canAccessProducts' },
      { path: '/app/price-calculator', label: 'Kalkulatori', icon: Calculator, permissionKey: 'canAccessServices' },
    ],
  },
  {
    key: 'comms',
    label: 'Komunikimi',
    entries: [
      { path: '/app/chat', label: 'Chat', icon: MessageSquare, permissionKey: 'canAccessChat' },
      { path: '/app/whatsapp', label: 'WhatsApp', icon: MessageCircle, permissionKey: 'canAccessWhatsapp' },
      { path: '/app/marketing', label: 'Marketing', icon: Megaphone, permissionKey: 'canAccessMarketing' },
      { path: '/app/social', label: 'Rrjetet Sociale', icon: Share2, permissionKey: 'canAccessMarketing' },
      { path: '/app/gmb', label: 'Google Reviews', icon: Star, permissionKey: 'canAccessMarketing' },
      { path: '/app/landing-pages', label: 'Landing Pages', icon: Globe, permissionKey: 'canAccessServices' },
    ],
  },
  {
    key: 'management',
    label: 'Drejtimi',
    entries: [
      {
        // ONE reporting group. The audience split (Brenda agjencisë / Për klientët) is a
        // switch INSIDE /app/reports rather than separate nav entries — reporting used to
        // be spread over four unrelated screens and nobody could tell which report was an
        // obligation to the agency and which was a deliverable for a client.
        group: 'reports',
        label: 'Raportimi',
        icon: ClipboardList,
        children: [
          { path: '/app/reports', label: 'Raportet', icon: ClipboardList, permissionKey: 'canAccessReports' },
          { path: '/app/accountability', label: 'Përgjegjshmëria', icon: Users, permissionKey: 'canAccessReports' },
          { path: '/app/client-health', label: 'Shëndeti i klientëve', icon: HeartPulse, permissionKey: 'canAccessReports' },
          { path: '/app/report-templates', label: 'Konfigurimi', icon: Settings, permissionKey: 'canAccessReports' },
        ],
      },
      {
        group: 'finances',
        label: 'Financat',
        icon: Wallet,
        children: [
          { path: '/app/finances', label: 'Përmbledhje', icon: PiggyBank, permissionKey: 'isAdmin' },
          { path: '/app/invoices', label: 'Faturat', icon: Receipt, permissionKey: 'canAccessInvoices' },
          { path: '/app/payments', label: 'Arkëtimet', icon: Wallet, permissionKey: 'canAccessInvoices' },
          { path: '/app/expenses', label: 'Shpenzimet', icon: DollarSign, permissionKey: 'canAccessExpenses' },
          { path: '/app/bonus', label: 'Bonuset', icon: Award, permissionKey: 'canAccessProfile' },
        ],
      },
      { path: '/app/teams', label: 'Ekipet', icon: UsersRound, permissionKey: 'canAccessTeams' },
    ],
  },
  {
    key: 'account',
    label: 'Llogaria',
    entries: [
      // Profili lives in the user footer row, not here (design v2).
      { path: '/app/settings', label: 'Cilësimet', icon: Settings, permissionKey: 'canAccessProfile' },
      // Abonimi is not a gated module: it must stay reachable on every plan (and while
      // the tenant is suspended) so the owner can always pay.
      { path: '/app/billing', label: 'Abonimi', icon: CreditCard, permissionKey: 'canAccessProfile' },
    ],
  },
];

const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  mobileOpen,
  onCloseMobile,
  onToggleCollapse,
  onOpenCommandPalette,
}) => {
  const permissions = usePermissions();
  const { user } = useAuth();
  // Active business (tenant) — used to scope the unread badge so a super-admin
  // doesn't get sound/badge for OTHER tenants' client messages (which the scoped
  // chat then can't show → "badge but no message").
  const businessId = useGlobalBusinessId();

  // Unread direct messages count — DMs are stored in the `messages` collection
  // (not `directMessages`).  A DM has a `receiverId` but no `channelId`.
  const unreadDmQuery = useMemo(() => {
    if (!user) return undefined;
    return {
      where: [
        { field: 'receiverId', operator: '==', value: user.uid },
        { field: 'isRead', operator: '==', value: false },
      ],
      skipTeamFilter: true,
      // Badge only needs a count — cap the listener so an ignored inbox can't
      // stream an unbounded number of docs forever.
      limit: 200,
    };
  }, [user]);

  const { data: unreadMessages } = useCollection<any>('messages', unreadDmQuery);

  // Unread client-channel messages. Mirrors ChatView's allUnreadChannelQuery (same
  // where/orderBy/limit → the two share one listener + the existing composite index
  // messages(businessId, isRead, createdAt DESC)). The old shape (businessId-only
  // server query, senderType/isRead filtered client-side) downloaded the tenant's
  // ENTIRE message history just to draw a badge. senderType is filtered below.
  const unreadClientQuery = useMemo(() => {
    if (!user) return undefined;
    return {
      where: [{ field: 'isRead', operator: '==', value: false }],
      orderBy: { field: 'createdAt', direction: 'desc' as const },
      limit: 200,
      teamScopedWhere: true,
    };
  }, [user]);
  const { data: unreadClientMessages } = useCollection<any>('messages', unreadClientQuery);

  // Group channels I belong to — needed to count their unread messages. A group
  // message was in NO badge before: this query counts unread `messages` and the DM
  // pass below only looks at rows WITHOUT a channelId.
  const { data: myChannels } = useCollection<any>('channels', { skipTeamFilter: true });
  const myGroupIds = useMemo(() => {
    const ids = new Set<string>();
    (myChannels || []).forEach((c: any) => {
      if (c?.isGroup && Array.isArray(c.members) && user?.uid && c.members.includes(user.uid)) ids.add(c.id);
    });
    return ids;
  }, [myChannels, user?.uid]);

  const unreadChatCount = useMemo(() => {
    let count = 0;
    // Scope to the active business: only count messages belonging to this tenant
    // (when a businessId is active). Excludes other tenants' client messages so the
    // super-admin's badge matches the (scoped) chat list.
    const inBusiness = (m: any) => !businessId || m.businessId === businessId;
    if (unreadMessages && user) {
      count += unreadMessages.filter(m => m.senderId !== user.uid && !m.channelId && inBusiness(m)).length;
    }
    if (unreadClientMessages && user) {
      count += unreadClientMessages.filter(m => m.senderType === 'client' && m.senderId !== user.uid && inBusiness(m)).length;
      // Group-channel messages. Read state for a group is per-member (`readBy`), not
      // the shared `isRead` flag, so "unread for me" = my uid is not in readBy.
      count += unreadClientMessages.filter(m =>
        m.channelId && myGroupIds.has(m.channelId) && m.senderId !== user.uid && inBusiness(m)
        && !(Array.isArray(m.readBy) && m.readBy.includes(user.uid))).length;
    }
    return count;
  }, [unreadMessages, unreadClientMessages, user, businessId, myGroupIds]);

  // NO chime here. The unread badge above is this component's job; the SOUND belongs
  // to exactly one owner, and that is the bell (NotificationsCenter) when off the chat
  // page, the ChatView chirp when on it.
  //
  // This used to be a second owner, and once the bell stopped suppressing chat types
  // (it had to — an @mention made no sound anywhere while chat was closed) every DM
  // and client message rang TWICE, from two near-identical two-tone chimes fired by
  // the same Firestore snapshot burst.
  //
  // The notification document is the better trigger anyway: it is what the server
  // already filtered through pushEnabled/DND/mutes and the "is he reading it right
  // now" presence check. A badge with no notification behind it is precisely the case
  // where the system decided not to interrupt — so staying silent is correct.

  // Filter nav items based on user permissions.
  // While loading, show only profile to avoid unauthorized flicker.
  // Module availability (plan tier + per-tenant toggle) is resolved by the shared
  // registry in lib/modules, so the sidebar and <ModuleGate> can never disagree
  // about what this tenant has.
  const { data: business } = useDocument<Business>('businesses', businessId || undefined);
  const disabledModules = useMemo(
    () => ((business as any)?.disabledModules as string[] | undefined) || [],
    [business],
  );
  const plan = ((business as any)?.plan as PlanKey) || 'trial';

  const canSeeLeaf = useCallback((item: NavItem) => {
    const permKey = item.permissionKey as keyof typeof permissions;
    if (permissions[permKey] !== true) return false;
    // Routes with no registered module (Dashboard, Profili, Cilësimet…) pass through.
    return isPathEnabled(item.path, {
      plan,
      disabledModules,
      isSuperAdmin: permissions.isSuperAdmin,
      permissions: permissions as unknown as Record<string, any>,
    });
  }, [permissions, disabledModules, plan]);

  // Resolve permissions/module toggles per entry. Groups keep only their
  // visible children; groups and sections drop out entirely when empty.
  const sections: NavSection[] = useMemo(() => {
    return allSections.flatMap(section => {
      const entries = section.entries.flatMap<NavEntry>(entry => {
        if (isGroup(entry)) {
          if (permissions.isLoading) return [];
          const children = entry.children.filter(canSeeLeaf);
          return children.length ? [{ ...entry, children }] : [];
        }
        if (permissions.isLoading) {
          return entry.permissionKey === 'canAccessProfile' ? [entry] : [];
        }
        return canSeeLeaf(entry) ? [entry] : [];
      });
      return entries.length ? [{ ...section, entries }] : [];
    });
  }, [permissions.isLoading, canSeeLeaf]);

  // Expand a group by default when one of its children is the active route;
  // manual toggles override that.
  const location = useLocation();
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});
  const groupChildActive = (g: NavGroup) => g.children.some(c => location.pathname.startsWith(c.path));
  const isGroupOpen = (g: NavGroup) => manualOpen[g.group] ?? groupChildActive(g);
  const toggleGroup = (key: string, open: boolean) =>
    setManualOpen(prev => ({ ...prev, [key]: !open }));

  const initials = useMemo(() => {
    const name = user?.displayName || user?.email || '';
    const parts = name.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
    return (parts.slice(0, 2).map(p => p[0]).join('') || 'U').toUpperCase();
  }, [user]);

  // Shared leaf renderer (used at top level and inside expanded groups).
  const renderLeaf = (item: NavItem) => (
    <NavLink
      key={item.path}
      to={item.path}
      onClick={onCloseMobile}
      title={collapsed ? item.label : undefined}
      aria-label={item.label}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-2.5 w-full min-h-[40px] rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors duration-150',
          isActive
            ? 'bg-[#2f6fe0] text-white'
            : 'text-[#a9b9d2] hover:bg-white/[.08] hover:text-white',
          collapsed && 'justify-center px-0'
        )
      }
    >
      {({ isActive }) => (
        <>
          <span className="relative flex-shrink-0">
            <item.icon
              className={cn(
                'h-[18px] w-[18px] transition-colors',
                isActive ? 'text-white' : 'text-[#6e82a4] group-hover:text-white'
              )}
            />
            {item.path === '/app/chat' && unreadChatCount > 0 && collapsed && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#d64545] rounded-full animate-pulse" />
            )}
          </span>
          {!collapsed && (
            <>
              <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{item.label}</span>
              {item.path === '/app/chat' && unreadChatCount > 0 && (
                <span className="flex-shrink-0 font-mono text-[10px] font-bold text-white bg-[#d64545] rounded-full px-2 py-0.5 animate-pulse">
                  {unreadChatCount > 99 ? '99+' : unreadChatCount}
                </span>
              )}
            </>
          )}
        </>
      )}
    </NavLink>
  );

  // Indented child row inside an expanded group — dot bullet instead of icon (design v2).
  const renderChild = (item: NavItem) => (
    <NavLink
      key={item.path}
      to={item.path}
      onClick={onCloseMobile}
      aria-label={item.label}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 w-full min-h-[36px] rounded-lg py-1.5 pl-6 pr-3 text-[12.5px] font-semibold transition-colors duration-150',
          isActive
            ? 'bg-[#2f6fe0]/[.22] text-white'
            : 'text-[#8fa0bd] hover:bg-white/[.08] hover:text-white'
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'w-1 h-1 rounded-full flex-shrink-0',
              isActive ? 'bg-[#7fa8ef]' : 'bg-[#4d6187]'
            )}
          />
          <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{item.label}</span>
        </>
      )}
    </NavLink>
  );

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Sidebar — dark navy shell (design v2) */}
      <aside
        // Offset/height track the header, which grows by the top safe-area inset.
        style={{
          top: 'calc(72px + var(--safe-area-top))',
          height: 'calc(100vh - 72px - var(--safe-area-top))',
        }}
        className={cn(
          'fixed left-0 bg-[#08183A] transition-all duration-300 z-40 flex flex-col',
          collapsed ? 'w-16' : 'w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Search trigger + collapse toggle */}
        <div
          className={cn(
            'flex items-center gap-2 px-3 pt-3 pb-2 border-b border-white/[.08]',
            collapsed && 'flex-col px-0'
          )}
        >
          <button
            type="button"
            onClick={onOpenCommandPalette}
            aria-label="Gjej modul (⌘K)"
            className={cn(
              'flex items-center gap-2 rounded-lg border border-white/10 bg-white/[.07] text-[#6e82a4] transition-colors hover:border-white/25 hover:text-white',
              collapsed ? 'justify-center w-10 h-9 border-transparent bg-transparent' : 'flex-1 min-w-0 px-3 py-1.5'
            )}
          >
            <Search className="h-3.5 w-3.5 flex-shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left text-xs font-semibold whitespace-nowrap">Gjej modul…</span>
                <kbd className="font-mono text-[9px] font-bold border border-white/[.15] rounded px-1.5 py-px">⌘K</kbd>
              </>
            )}
          </button>
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title={collapsed ? 'Hap menunë' : 'Palos menunë'}
              aria-label={collapsed ? 'Hap menunë' : 'Palos menunë'}
              className="hidden lg:flex items-center justify-center w-7 h-7 rounded-md text-[#6e82a4] transition-colors hover:text-white hover:bg-white/[.08] flex-shrink-0"
            >
              {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
            </button>
          )}
        </div>

        <nav className={cn('flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 space-y-0.5', collapsed && 'px-2')}>
          {permissions.isLoading && sections.length === 0 ? (
            <div className="text-sm text-[#6e82a4] text-center py-4">Duke ngarkuar...</div>
          ) : (
            sections.map((section, si) => (
              <React.Fragment key={section.key}>
                {collapsed ? (
                  si > 0 && <div className="my-2 mx-2 border-t border-white/[.08]" />
                ) : (
                  <div className="text-[9px] font-extrabold uppercase tracking-[.11em] text-[#4d6187] px-3 pt-3.5 pb-1 whitespace-nowrap">
                    {section.label}
                  </div>
                )}
                {section.entries.map(entry => {
                  // Leaf — render directly.
                  if (!isGroup(entry)) return renderLeaf(entry);

                  // Collapsed sidebar (icon-only): flatten children to icon links so
                  // everything stays reachable without a text header.
                  if (collapsed) {
                    return <React.Fragment key={entry.group}>{entry.children.map(renderLeaf)}</React.Fragment>;
                  }

                  // Expanded: collapsible header + dot-bulleted children.
                  const open = isGroupOpen(entry);
                  const childActive = groupChildActive(entry);
                  return (
                    <div key={entry.group}>
                      <button
                        type="button"
                        onClick={() => toggleGroup(entry.group, open)}
                        aria-expanded={open}
                        className={cn(
                          'group w-full flex items-center gap-2.5 min-h-[40px] rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors duration-150 text-left',
                          childActive && !open
                            ? 'bg-[#2f6fe0]/[.18] text-white'
                            : 'text-[#a9b9d2] hover:bg-white/[.08] hover:text-white'
                        )}
                      >
                        <entry.icon
                          className={cn(
                            'h-[18px] w-[18px] flex-shrink-0 transition-colors',
                            childActive && !open ? 'text-white' : 'text-[#6e82a4] group-hover:text-white'
                          )}
                        />
                        <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{entry.label}</span>
                        <ChevronDown
                          className={cn('h-3.5 w-3.5 flex-shrink-0 text-[#6e82a4] transition-transform duration-150', open && 'rotate-180')}
                        />
                      </button>
                      {open && <div className="mt-0.5 space-y-0.5">{entry.children.map(renderChild)}</div>}
                    </div>
                  );
                })}
              </React.Fragment>
            ))
          )}
        </nav>

        {/* User footer — the Profili entry lives here (design v2) */}
        <div className={cn('border-t border-white/[.08] p-3', collapsed && 'p-2')}>
          <div className={cn('flex items-center gap-2.5 rounded-lg p-1.5 transition-colors hover:bg-white/[.08]', collapsed && 'justify-center')}>
            <NavLink
              to="/app/profile"
              onClick={onCloseMobile}
              aria-label="Profili"
              title={collapsed ? 'Profili' : undefined}
              className="flex items-center gap-2.5 min-w-0 flex-1"
            >
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'User'}
                  className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <span className="w-7 h-7 rounded-full bg-[#2f6fe0] text-white flex items-center justify-center text-[10px] font-extrabold flex-shrink-0">
                  {initials}
                </span>
              )}
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold text-white whitespace-nowrap overflow-hidden text-ellipsis">
                    {user?.displayName || user?.email || 'Përdorues'}
                  </span>
                  {(permissions.role || permissions.teamName) && (
                    <span className="block text-[10px] font-bold text-[#6e82a4] whitespace-nowrap overflow-hidden text-ellipsis">
                      {[permissions.role, permissions.teamName].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
              )}
            </NavLink>
            {!collapsed && (
              <NavLink
                to="/app/settings"
                onClick={onCloseMobile}
                aria-label="Cilësimet"
                className="text-[#6e82a4] hover:text-white transition-colors flex-shrink-0 p-1"
              >
                <Settings className="h-3.5 w-3.5" />
              </NavLink>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
