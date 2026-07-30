import React, { useState, useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, CheckSquare, MessageSquare, Users,
  Grid3x3, X, FolderKanban, Target, Receipt, BarChart3,
  Timer, DollarSign, Settings, UserCircle, Briefcase,
  Award, UsersRound, FileText, Shield, Wallet, Package,
} from 'lucide-react';
import { usePermissions } from '../contexts/PermissionsContext';
import { useAuth } from '../contexts/AuthContext';
import { useCollection } from '../hooks/useFirestore';
import { useModules } from '../hooks/useModules';

const MobileBottomNav: React.FC = () => {
  const [showMore, setShowMore] = useState(false);
  const { user } = useAuth();
  const permissions = usePermissions();
  // Mobile nav previously ignored per-tenant module toggles, so a disabled module
  // stayed reachable from the "Më shumë" drawer. Same registry as the sidebar now.
  const { isEnabled } = useModules();

  // ── Unread chat badge (mirrors Sidebar logic) ──
  const unreadDmQuery = useMemo(() => !user ? undefined : {
    where: [
      { field: 'receiverId', operator: '==', value: user.uid },
      { field: 'isRead', operator: '==', value: false },
    ],
    skipTeamFilter: true,
  }, [user]);
  const { data: unreadDms } = useCollection<any>('messages', unreadDmQuery);

  const unreadClientQuery = useMemo(() => !user ? undefined : {
    where: [
      { field: 'senderType', operator: '==', value: 'client' },
      { field: 'isRead', operator: '==', value: false },
    ],
    // Scoped to the active business server-side (businessId only; senderType/isRead
    // filtered client-side). NOT teamScopedWhere — that would need a composite index.
  }, [user]);
  const { data: unreadClientMsgs } = useCollection<any>('messages', unreadClientQuery);

  const unreadChatCount = useMemo(() => {
    let c = 0;
    if (unreadDms && user) c += unreadDms.filter((m: any) => m.senderId !== user.uid && !m.channelId).length;
    if (unreadClientMsgs && user) c += unreadClientMsgs.filter((m: any) => m.senderId !== user.uid).length;
    return c;
  }, [unreadDms, unreadClientMsgs, user]);

  const canAccess = (key: string) =>
    !permissions.isLoading && permissions[key as keyof typeof permissions] === true;

  // ── 4 primary tabs ──
  const primaryItems = [
    { to: '/app/dashboard', icon: LayoutDashboard, label: 'Home',     perm: 'canAccessProfile' },
    { to: '/app/tasks',     icon: CheckSquare,     label: 'Detyrat',  perm: 'canAccessTasks' },
    { to: '/app/chat',      icon: MessageSquare,   label: 'Chat',     perm: 'canAccessChat' },
    { to: '/app/customers', icon: Users,           label: 'Klientët', perm: 'canAccessCustomers' },
  ].filter(item => canAccess(item.perm) && isEnabled(item.to));

  // ── "Më shumë" drawer items ──
  const moreItems = [
    { to: '/app/projects',      icon: FolderKanban, label: 'Projektet',   perm: 'canAccessProjects' },
    { to: '/app/crm',           icon: Shield,       label: 'CRM',         perm: 'canAccessCRM' },
    { to: '/app/products',      icon: Package,      label: 'Dyqani',      perm: 'canAccessProducts' },
    { to: '/app/invoices',      icon: Receipt,      label: 'Faturat',     perm: 'canAccessInvoices' },
    { to: '/app/expenses',      icon: DollarSign,   label: 'Shpenzimet',  perm: 'canAccessExpenses' },
    { to: '/app/goals',         icon: Target,       label: 'Objektivat',  perm: 'canAccessGoals' },
    { to: '/app/teams',         icon: UsersRound,   label: 'Ekipet',      perm: 'canAccessTeams' },
    { to: '/app/finances',      icon: Wallet,       label: 'Financat',    perm: 'isAdmin' },
    { to: '/app/workspace',     icon: Briefcase,    label: 'Workspace',   perm: 'canAccessProjects' },
    { to: '/app/bonus',         icon: Award,        label: 'Bonuset',     perm: 'canAccessProfile' },
    { to: '/app/profile',       icon: UserCircle,   label: 'Profili',     perm: 'canAccessProfile' },
    { to: '/app/settings',      icon: Settings,     label: 'Cilësimet',   perm: 'canAccessSettings' },
  ].filter(item => canAccess(item.perm) && isEnabled(item.to));

  return (
    <>
      {/* Overlay */}
      {showMore && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setShowMore(false)}
        />
      )}

      {/* "Më shumë" slide-up drawer — sits directly above the bottom nav, whose
          height grows by the bottom safe-area inset. */}
      <div
        style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}
        className={`fixed left-0 right-0 z-50 bg-card border-t rounded-t-2xl shadow-xl lg:hidden transition-all duration-300 ease-out ${
          showMore
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-full pointer-events-none'
        }`}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b">
          <span className="text-sm font-semibold text-foreground">Të gjitha seksionet</span>
          <button
            onClick={() => setShowMore(false)}
            className="p-1.5 rounded-full hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-1 p-3 max-h-[50vh] overflow-y-auto">
          {moreItems.map(item => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setShowMore(false)}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1.5 p-3 rounded-xl text-center transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted'
                  }`
                }
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium leading-tight">{item.label}</span>
              </NavLink>
            );
          })}
        </div>
        {/* Safe area spacer */}
        <div className="h-2" />
      </div>

      {/* ── Bottom navigation bar ── */}
      {/* Height grows by the bottom safe-area inset; padding pushes the tabs above the
          gesture bar / home indicator so they stay tappable on edge-to-edge devices. */}
      {/* In-flow flex child at the bottom of the app's h-[100dvh] column (NOT
          position:fixed). This keeps it pinned to the bottom of the VISIBLE
          viewport regardless of the Android WebView's layout/visual viewport
          mismatch that previously pushed a fixed nav off-screen on the chat page.
          Height + padding reserve the bottom safe-area (home indicator). */}
      <nav
        style={{ height: 'calc(4rem + env(safe-area-inset-bottom))', paddingBottom: 'env(safe-area-inset-bottom)' }}
        className="shrink-0 w-full z-40 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 border-t flex items-stretch lg:hidden"
      >
        {primaryItems.map(item => {
          const Icon = item.icon;
          const isChatItem = item.to === '/app/chat';
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center gap-0.5 relative transition-colors ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <div className={`relative p-1.5 rounded-xl transition-all ${isActive ? 'bg-primary/10' : ''}`}>
                    <Icon className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
                    {isChatItem && unreadChatCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 bg-red-500 rounded-full flex items-center justify-center text-white text-[8px] font-bold px-0.5">
                        {unreadChatCount > 9 ? '9+' : unreadChatCount}
                      </span>
                    )}
                  </div>
                  <span className={`text-[10px] font-medium transition-colors ${isActive ? 'text-primary' : ''}`}>
                    {item.label}
                  </span>
                  {/* Active indicator dot */}
                  {isActive && (
                    <span className="absolute bottom-1 w-1 h-1 rounded-full bg-primary" />
                  )}
                </>
              )}
            </NavLink>
          );
        })}

        {/* "Më shumë" button */}
        <button
          onClick={() => setShowMore(prev => !prev)}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
            showMore ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <div className={`p-1.5 rounded-xl transition-all ${showMore ? 'bg-primary/10' : ''}`}>
            <Grid3x3 className={`w-5 h-5 transition-transform ${showMore ? 'scale-110' : ''}`} />
          </div>
          <span className="text-[10px] font-medium">Më shumë</span>
          {showMore && (
            <span className="absolute bottom-1 w-1 h-1 rounded-full bg-primary" />
          )}
        </button>
      </nav>
    </>
  );
};

export default MobileBottomNav;
