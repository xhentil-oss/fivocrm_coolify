import React, { useState, useMemo } from 'react';
import { NavLink, Outlet, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useClientPortal } from '../../hooks/useClientPortal';
import { usePermissions } from '../../hooks/usePermissions';
import { useCollection } from '../../hooks/useFirestore';
import {
  LayoutDashboard,
  FileText,
  ShoppingBag,
  MessageSquare,
  ClipboardList,
  FolderKanban,
  Calculator,
  ScrollText,
  LogOut,
  Menu,
  X,
  User,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Loader2 } from 'lucide-react';

const navItems = [
  { to: '/portal', icon: LayoutDashboard, label: 'Paneli Kryesor', end: true },
  { to: '/portal/invoices', icon: FileText, label: 'Faturat' },
  { to: '/portal/contracts', icon: ScrollText, label: 'Kontratat' },
  { to: '/portal/services', icon: ShoppingBag, label: 'Shërbimet' },
  { to: '/portal/projects', icon: FolderKanban, label: 'Projektet' },
  { to: '/portal/chat', icon: MessageSquare, label: 'Mbështetje' },
  { to: '/portal/preventiva', icon: Calculator, label: 'Preventiva' },
];

const PortalLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const permissions = usePermissions();
  const { isClient, isLoading } = useClientPortal();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  // ── Unread staff messages badge ──
  const { data: portalNotifs } = useCollection<any>('notifications', {
    skip: !user,
    where: user ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
    skipTeamFilter: true,
  });
  const unreadStaffMsgs = useMemo(
    () => portalNotifs?.filter((n: any) => n.type === 'staff_message' && !n.isRead).length || 0,
    [portalNotifs]
  );

  // Staff members should never land on the client portal.
  // Redirect them to the main app before useClientPortal can auto-create client records.
  if (!permissions.isLoading && (permissions.role || permissions.isOwner)) {
    return <Navigate to="/app/dashboard" replace />;
  }

  if (isLoading || permissions.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    navigate('/login?redirect=/portal');
    return null;
  }

  if (!isClient) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md space-y-4 p-8">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto">
            <User className="h-8 w-8 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Akses i Kufizuar</h1>
          <p className="text-muted-foreground">
            Llogaria juaj nuk ka akses në portalin e klientëve. Kontaktoni ekipin tonë për ndihmë.
          </p>
          <Button variant="outline" onClick={() => { logout(); navigate('/login'); }}>
            Dil nga llogaria
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top Bar */}
      <header className="fixed top-0 left-0 right-0 z-50 h-16 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 flex items-center px-4 lg:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden mr-2"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>

        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">CP</span>
          </div>
          <span className="font-semibold text-lg hidden sm:block">Portali i Klientit</span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted-foreground hidden sm:block">
            {user.email}
          </span>
          <Button variant="ghost" size="icon" onClick={() => { logout(); navigate('/login'); }}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-16 left-0 bottom-0 z-40 w-[240px] bg-card border-r transition-transform duration-200 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <nav className="p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <main className="lg:ml-[240px] pt-16">
        <div className="p-4 pb-20 sm:p-6 sm:pb-20 lg:p-8">
          <Outlet />
        </div>
      </main>

      {/* ── Mobile bottom navigation (hidden on lg+) ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 h-16 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 border-t flex items-stretch lg:hidden">
        {navItems.map(item => {
          const Icon = item.icon;
          const isChatItem = item.to === '/portal/chat';
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMobileOpen(false)}
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
                    {isChatItem && unreadStaffMsgs > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 bg-red-500 rounded-full flex items-center justify-center text-white text-[8px] font-bold px-0.5">
                        {unreadStaffMsgs > 9 ? '9+' : unreadStaffMsgs}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-medium leading-none">{item.label}</span>
                  {isActive && (
                    <span className="absolute bottom-1 w-1 h-1 rounded-full bg-primary" />
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
};

export default PortalLayout;
