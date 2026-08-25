import React, { useState, useMemo } from 'react';
import { NavLink, Outlet, useNavigate, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useClientPortal } from '../../hooks/useClientPortal';
import { usePermissions } from '../../contexts/PermissionsContext';
import { useCollection } from '../../hooks/useFirestore';
import { LayoutDashboard, FileText, ShoppingBag, ClipboardList, FolderKanban, Calculator, ScrollText, LogOut, Menu, X, User, Eye, EyeOff, Sparkles, MessageCircle, ArrowRight, Share2, ShoppingCart } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Loader2 } from 'lucide-react';
import PortalPushPrompt from './PortalPushPrompt';
import PortalNotificationsBell from './PortalNotificationsBell';

// Full menu — shown in the desktop sidebar and the mobile drawer.
// `shopOnly` entries appear only when this tenant actually publishes products, so a
// service agency's clients never see an empty shop tab.
const navItems = [
  { to: '/portal', icon: LayoutDashboard, label: 'Paneli Kryesor', end: true },
  { to: '/portal/invoices', icon: FileText, label: 'Faturat' },
  { to: '/portal/chat', icon: MessageCircle, label: 'Mesazhet' },
  { to: '/portal/contracts', icon: ScrollText, label: 'Kontratat' },
  { to: '/portal/services', icon: ShoppingBag, label: 'Shërbimet' },
  { to: '/portal/shop', icon: ShoppingCart, label: 'Dyqani', shopOnly: true },
  { to: '/portal/projects', icon: FolderKanban, label: 'Projektet' },
  { to: '/portal/reports', icon: ClipboardList, label: 'Raportet' },
  { to: '/portal/preventiva', icon: Calculator, label: 'Preventiva' },
  { to: '/portal/social', icon: Share2, label: 'Rrjetet Sociale' },
  { to: '/portal/profile', icon: User, label: 'Profili im' },
];

// Curated set for the mobile bottom bar — 4 primary destinations + a "More"
// button that opens the full drawer. Keeps tabs readable on small screens.
const bottomNavItems = [
  { to: '/portal', icon: LayoutDashboard, label: 'Paneli', end: true },
  { to: '/portal/invoices', icon: FileText, label: 'Faturat' },
  { to: '/portal/chat', icon: MessageCircle, label: 'Mesazhet' },
  { to: '/portal/projects', icon: FolderKanban, label: 'Projektet' },
];

const PortalLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const permissions = usePermissions();
  const { isClient, isLoading, businessId } = useClientPortal();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // ── Unread staff messages badge ──
  // Bounded: this only drives an unread badge. Unlimited, it streamed the client's
  // whole notification history on every portal page load.
  const { data: portalNotifs } = useCollection<any>('notifications', {
    skip: !user,
    where: user ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
    orderBy: { field: 'createdAt', direction: 'desc' },
    limit: 50,
    skipTeamFilter: true,
  });
  const unreadStaffMsgs = useMemo(
    () => portalNotifs?.filter((n: any) => n.type === 'staff_message' && !n.isRead).length || 0,
    [portalNotifs]
  );

  // ── Shop tab visibility ──
  // Show "Dyqani" only when this client's tenant has at least one product published
  // to the portal. Capped at 1 doc, so the check costs a single read.
  const { data: portalProducts } = useCollection<any>('products', {
    skip: !businessId,
    where: [
      { field: 'businessId', operator: '==', value: businessId || '' },
      { field: 'visibleInPortal', operator: '==', value: true },
    ],
    skipTeamFilter: true,
    limit: 1,
  });
  const hasShop = (portalProducts?.length || 0) > 0;
  const visibleNavItems = useMemo(
    () => navItems.filter(item => !(item as any).shopOnly || hasShop),
    [hasShop],
  );

  // Admin "view as customer" preview — a real staff member is inspecting a
  // specific client's portal. Keep them here instead of bouncing to /app.
  const previewCustomerId = permissions.previewCustomerId;
  const previewCustomerName = permissions.previewCustomerName;

  // Staff members should never land on the client portal.
  // Redirect them to the main app before useClientPortal can auto-create client records.
  // Exception: an active customer preview (they explicitly chose to view a client).
  if (!permissions.isLoading && (permissions.role || permissions.isOwner) && !previewCustomerId) {
    return <Navigate to="/app/dashboard" replace />;
  }

  const exitPreview = () => {
    const id = previewCustomerId;
    permissions.setPreviewCustomer(null);
    navigate(id ? `/app/customers/${id}` : '/app/customers');
  };

  if (isLoading || permissions.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    // Preserve the FULL destination (path + query), not a fixed '/portal': the
    // invoice email's "Paguaj Tani" button lands on /portal/invoices?invoice=<id>,
    // and login must bring the client back to that exact invoice. LoginView
    // validates the redirect as a safe relative path.
    return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />;
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

  // When an admin previews the portal, a banner sits under the header; everything
  // below the header shifts down by its height so nothing is hidden.
  const headerTop = 'calc(4rem + var(--safe-area-top))';
  const headerPlusBanner = 'calc(4rem + var(--safe-area-top) + 40px)';
  const contentTop = previewCustomerId ? headerPlusBanner : headerTop;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top Bar — grows by the top safe-area inset so it clears the notch/status bar */}
      <header
        style={{ height: 'calc(4rem + var(--safe-area-top))', paddingTop: 'var(--safe-area-top)' }}
        className="fixed top-0 left-0 right-0 z-50 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 flex items-center px-4 lg:px-6"
      >
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden mr-2"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>

        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-brand-gradient flex items-center justify-center shadow-sm">
            <span className="text-white font-bold text-sm">CP</span>
          </div>
          <span className="font-semibold text-lg hidden sm:block tracking-tight">Portali i Klientit</span>
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <PortalNotificationsBell />
          <NavLink
            to="/portal/profile"
            className="flex items-center gap-2 rounded-full border bg-background/60 pl-1 pr-1 sm:pr-3 py-1 hover:bg-background transition-colors"
            title="Profili im"
          >
            <div className="h-7 w-7 rounded-full bg-brand-gradient flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[11px] font-semibold">{(user.email || 'K').slice(0, 2).toUpperCase()}</span>
            </div>
            <span className="text-sm text-muted-foreground hidden sm:block max-w-[200px] truncate">{user.email}</span>
          </NavLink>
          <Button variant="outline" size="icon" className="rounded-full" onClick={() => { logout(); navigate('/login'); }} title="Dil">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Admin "view as customer" banner — fixed just under the header */}
      {previewCustomerId && (
        <div
          className="fixed left-0 right-0 z-40 h-10 flex items-center justify-between gap-2 px-4 lg:px-6 bg-amber-400 text-amber-950 text-sm font-medium"
          style={{ top: headerTop }}
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <Eye className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">
              Po shikoni portalin si klient{previewCustomerName ? <>: <strong>{previewCustomerName}</strong></> : null} — vetëm pamje.
            </span>
          </span>
          <button
            onClick={exitPreview}
            className="flex items-center gap-1 whitespace-nowrap underline hover:no-underline flex-shrink-0"
          >
            <EyeOff className="w-4 h-4" /> Dil nga pamja
          </button>
        </div>
      )}

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — top tracks the header height (incl. top safe-area inset) */}
      <aside
        style={{ top: contentTop }}
        className={`fixed left-0 bottom-0 z-40 w-[262px] bg-card border-r transition-transform duration-200 lg:translate-x-0 flex flex-col ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-5 pt-5 pb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/70">Menuja</div>
        <nav className="px-4 space-y-1 flex-1 overflow-y-auto">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isChatItem = item.to === '/portal/chat';
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-brand-gradient text-white shadow-lg shadow-primary/30'
                      : 'text-muted-foreground hover:bg-primary/5 hover:text-foreground'
                  }`
                }
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1">{item.label}</span>
                {isChatItem && unreadStaffMsgs > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] font-bold">
                    {unreadStaffMsgs > 9 ? '9+' : unreadStaffMsgs}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Quick-help card → the single, prominent entry to support chat */}
        <div className="mt-auto m-4 rounded-2xl border-2 border-primary/25 bg-gradient-to-b from-primary/[0.08] to-primary/[0.16] p-5 shadow-lg shadow-primary/10">
          <div className="flex items-center gap-2 text-sm font-bold text-primary mb-2">
            <Sparkles className="h-4 w-4" /> Ndihmë e shpejtë
            {unreadStaffMsgs > 0 && (
              <span className="ml-auto min-w-[20px] h-5 px-1.5 bg-red-500 text-white rounded-full flex items-center justify-center text-[11px] font-bold">
                {unreadStaffMsgs > 9 ? '9+' : unreadStaffMsgs}
              </span>
            )}
          </div>
          <p className="text-[13px] leading-relaxed text-muted-foreground mb-3.5">
            Keni pyetje për një shërbim? Ekipi ynë përgjigjet brenda 24 orëve.
          </p>
          <NavLink to="/portal/chat" onClick={() => setMobileOpen(false)}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand-gradient text-white py-2.5 text-sm font-semibold shadow-md shadow-primary/25 hover:opacity-95 transition-opacity">
            <MessageCircle className="h-4 w-4" />
            {unreadStaffMsgs > 0 ? 'Vazhdo bisedën' : 'Kontakto ekipin'}
            <ArrowRight className="h-4 w-4" />
          </NavLink>
        </div>
      </aside>

      {/* Main content — top clears the (inset-grown) header, bottom clears the
          (inset-grown) mobile nav. */}
      <main className="lg:ml-[262px]" style={{ paddingTop: contentTop }}>
        <div className="p-4 sm:p-6 lg:p-8" style={{ paddingBottom: 'calc(5rem + var(--safe-area-bottom))' }}>
          <PortalPushPrompt />
          <Outlet />
        </div>
      </main>

      {/* ── Mobile bottom navigation (hidden on lg+) ── */}
      {/* Height grows by the bottom safe-area inset; padding lifts the tabs above the
          gesture bar / home indicator. */}
      <nav
        style={{ height: 'calc(4rem + var(--safe-area-bottom))', paddingBottom: 'var(--safe-area-bottom)' }}
        className="fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 border-t flex items-stretch lg:hidden"
      >
        {bottomNavItems.map(item => {
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
        {/* "More" opens the full menu drawer */}
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 text-muted-foreground transition-colors"
        >
          <div className="p-1.5 rounded-xl">
            <Menu className="w-5 h-5" />
          </div>
          <span className="text-[10px] font-medium leading-none">Më shumë</span>
        </button>
      </nav>
    </div>
  );
};

export default PortalLayout;
