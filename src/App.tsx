import React, { useState, Suspense, useEffect } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { getDoc, setDoc, doc } from 'firebase/firestore';
import { db } from './lib/firebase';
import { useAuth } from './contexts/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import TopNavBar from './components/TopNavBar';
import Sidebar from './components/Sidebar';
import LoginView from './views/LoginView';
import RegisterView from './views/RegisterView';
import WorkspaceSignupView from './views/WorkspaceSignupView';
import MobileBottomNav from './components/MobileBottomNav';
import { AndroidBackButton } from './components/AndroidBackButton';
import DailyReportPopup from './components/DailyReportPopup';
import CommandPalette from './components/CommandPalette';
import PermissionGate from './components/PermissionGate';
import PendingInvitesBanner from './components/PendingInvitesBanner';
import { GoogleApiProvider } from './contexts/GoogleApiContext';
import { PermissionsProvider, usePermissions } from './contexts/PermissionsContext';
import { useTeamDataMigration } from './hooks/useTeamDataMigration';
import { useTeamSettingsSync } from './hooks/useTeamSettings';
import { useBreakReminder } from './hooks/useBreakReminder';
import { usePushNotifications } from './hooks/usePushNotifications';
import { Toaster } from './components/ui/toaster';
import { Loader2 } from 'lucide-react';

// Auto-reload on chunk load failure (stale deployment cache)
function lazyRetry(factory: () => Promise<any>): React.LazyExoticComponent<any> {
  return React.lazy(() =>
    factory().catch((err: any) => {
      // Use a per-factory key so multiple chunks can each trigger one reload
      const key = `chunk_reload_${factory.toString().slice(0, 60)}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        window.location.reload();
        return { default: () => null };
      }
      sessionStorage.removeItem(key);
      throw err;
    })
  );
}

// Lazy-loaded views — each becomes a separate chunk
const ProjectsView = lazyRetry(() => import('./views/ProjectsView'));
const ProjectDetailView = lazyRetry(() => import('./views/ProjectDetailView'));
const CRMView = lazyRetry(() => import('./views/CRMView'));
const DealsView = lazyRetry(() => import('./views/DealsView'));
const TasksView = lazyRetry(() => import('./views/TasksView'));
const GoalsView = lazyRetry(() => import('./views/GoalsView'));
const TeamsView = lazyRetry(() => import('./views/TeamsView'));
const InvoicesView = lazyRetry(() => import('./views/InvoicesView'));
const ChatView = lazyRetry(() => import('./views/ChatView'));
const WhatsappInboxView = lazyRetry(() => import('./views/WhatsappInboxView'));
const MarketingView = lazyRetry(() => import('./views/MarketingView'));
const SocialMediaView = lazyRetry(() => import('./views/SocialMediaView'));
const FinancesView = lazyRetry(() => import('./views/FinancesView'));
const BonusView = lazyRetry(() => import('./views/BonusView'));
const UserProfileView = lazyRetry(() => import('./views/UserProfileView'));
const SettingsView = lazyRetry(() => import('./views/SettingsView'));
const TenantsView = lazyRetry(() => import('./views/TenantsView'));
const CustomersView = lazyRetry(() => import('./views/CustomersView'));
const ServicesView = lazyRetry(() => import('./views/ServicesView'));
const ServiceInquiriesView = lazyRetry(() => import('./views/ServiceInquiriesView'));
const ExpensesView = lazyRetry(() => import('./views/ExpensesView'));
const WorkspaceView = lazyRetry(() => import('./views/WorkspaceView'));
const StaffDashboard = lazyRetry(() => import('./views/StaffDashboard'));
const MomentumView = lazyRetry(() => import('./views/MomentumView'));
const JoinInviteView = lazyRetry(() => import('./views/JoinInviteView'));
const Customer360View = lazyRetry(() => import('./views/Customer360View'));
const PortalLayout = lazyRetry(() => import('./views/portal/PortalLayout'));
const PortalDashboard = lazyRetry(() => import('./views/portal/PortalDashboard'));
const PortalInvoicesView = lazyRetry(() => import('./views/portal/PortalInvoicesView'));
const PortalServicesView = lazyRetry(() => import('./views/portal/PortalServicesView'));
const PortalChatView = lazyRetry(() => import('./views/portal/PortalChatView'));
const PortalProjectsView = lazyRetry(() => import('./views/portal/PortalProjectsView'));
const PortalInquiryView = lazyRetry(() => import('./views/portal/PortalInquiryView'));
const PortalProjectDetailView = lazyRetry(() => import('./views/portal/PortalProjectDetailView'));
const PortalQuotesView = lazyRetry(() => import('./views/portal/PortalQuotesView'));
const OnboardingWizard = lazyRetry(() => import('./components/OnboardingWizard'));
const SeoLandingPage = lazyRetry(() => import('./views/landing/SeoLandingPage'));
const RealEstateLandingPage = lazyRetry(() => import('./views/landing/RealEstateLandingPage'));
const ResortLandingPage = lazyRetry(() => import('./views/landing/ResortLandingPage'));
const EstetikeLandingPage = lazyRetry(() => import('./views/landing/EstetikeLandingPage'));
const RecruitLandingPage = lazyRetry(() => import('./views/landing/RecruitLandingPage'));
const InteriorDesignLandingPage = lazyRetry(() => import('./views/landing/InteriorDesignLandingPage'));
const EducationLandingPage = lazyRetry(() => import('./views/landing/EducationLandingPage'));
const SocialMediaLandingPage = lazyRetry(() => import('./views/landing/SocialMediaLandingPage'));
const MassageLandingPage = lazyRetry(() => import('./views/landing/MassageLandingPage'));
const AgroturizemLandingPage = lazyRetry(() => import('./views/landing/AgroturizemLandingPage'));
const WebsiteLandingPage = lazyRetry(() => import('./views/landing/WebsiteLandingPage'));
const WebsiteMaintenanceLandingPage = lazyRetry(() => import('./views/landing/WebsiteMaintenanceLandingPage'));
const PergolaLandingPage = lazyRetry(() => import('./views/landing/PergolaLandingPage'));
const FotoVideoLandingPage = lazyRetry(() => import('./views/landing/FotoVideoLandingPage'));
const TransferLandingPage = lazyRetry(() => import('./views/landing/TransferLandingPage'));
const BakeryLandingPage = lazyRetry(() => import('./views/landing/BakeryLandingPage'));
const ShopProduktLandingPage = lazyRetry(() => import('./views/landing/ShopProduktLandingPage'));
const PriceCalculatorView = lazyRetry(() => import('./views/PriceCalculatorView'));
const LandingPagesView = lazyRetry(() => import('./views/LandingPagesView'));
const PrivacyPolicyView = lazyRetry(() => import('./views/PrivacyPolicyView'));
const DeleteAccountView = lazyRetry(() => import('./views/DeleteAccountView'));
const ContractsView = lazyRetry(() => import('./views/ContractsView'));
const PortalContractsView = lazyRetry(() => import('./views/portal/PortalContractsView'));
const PortalSocialView = lazyRetry(() => import('./views/portal/PortalSocialView'));

function LazyFallback() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

// Protected Route Component
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
}

// Redirect to the best available page based on permissions
function DefaultRedirect() {
  const permissions = usePermissions();
  
  if (permissions.isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // If user has no team membership (not admin/owner/member), they are a client → go to portal
  if (!permissions.role && !permissions.isOwner && !permissions.isAdmin) {
    return <Navigate to="/portal" replace />;
  }
  
  return <Navigate to="/app/dashboard" replace />;
}

function AppContent() {
  // Persisted so a collapsed (icons-only) sidebar stays that way across reloads —
  // useful e.g. on the chat page where the extra width matters.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar_collapsed') === '1'; } catch { return false; }
  });
  const toggleSidebar = React.useCallback(() => {
    setSidebarCollapsed(v => {
      const next = !v;
      try { localStorage.setItem('sidebar_collapsed', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user } = useAuth();
  const { isOwner, previewRole, isLoading: permissionsLoading } = usePermissions();
  const location = useLocation();
  // Full-bleed routes fill the content column exactly (no padding, no internal
  // page scroll) and manage their own scrolling — e.g. the chat, which needs a
  // single flex height context so the bottom nav can't fall off a mismatched
  // (svh vs layout) viewport.
  const isFullBleedRoute = location.pathname.startsWith('/app/chat');
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('fivocrm_onboarding_done');
  });

  // Sync team settings from Firestore → localStorage on every change
  useTeamSettingsSync();

  // Break reminder — get-up-and-move reminder every 2 hours from 8:00
  useBreakReminder();

  // Register for push notifications on Android (saves FCM token to Firestore)
  usePushNotifications(user?.uid);

  // Cross-device onboarding check: if Firestore says completed, skip wizard
  useEffect(() => {
    if (!user || !showOnboarding) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      if (snap.exists() && snap.data()?.onboardingCompleted) {
        localStorage.setItem('fivocrm_onboarding_done', '1');
        setShowOnboarding(false);
      }
    }).catch(() => { /* non-blocking */ });
  }, [user, showOnboarding]);

  // Auto-skip onboarding for staff members — wizard is only for owners setting up a new account.
  // Waits for permissions to load so we don't dismiss prematurely before knowing the role.
  useEffect(() => {
    if (permissionsLoading || !showOnboarding) return;
    if (!isOwner) {
      localStorage.setItem('fivocrm_onboarding_done', '1');
      setShowOnboarding(false);
    }
  }, [permissionsLoading, isOwner, showOnboarding]);

  // One-time migration: stamp teamId on pre-isolation documents
  useTeamDataMigration();

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <Routes>
      {/* Public route */}
      <Route path="/login" element={user ? <DefaultRedirect /> : <LoginView />} />
      <Route path="/register" element={<RegisterView />} />
      {/* SaaS workspace signup — creates a new isolated tenant (vs /register lead-capture) */}
      <Route path="/signup" element={user ? <DefaultRedirect /> : <WorkspaceSignupView />} />
      <Route path="/join/:token" element={<JoinInviteView />} />
      <Route path="/seo" element={<Suspense fallback={<LazyFallback />}><SeoLandingPage /></Suspense>} />
      <Route path="/real-estate" element={<Suspense fallback={<LazyFallback />}><RealEstateLandingPage /></Suspense>} />
      <Route path="/resorte" element={<Suspense fallback={<LazyFallback />}><ResortLandingPage /></Suspense>} />
      <Route path="/estetike" element={<Suspense fallback={<LazyFallback />}><EstetikeLandingPage /></Suspense>} />
      <Route path="/recruit" element={<Suspense fallback={<LazyFallback />}><RecruitLandingPage /></Suspense>} />
      <Route path="/interior-design" element={<Suspense fallback={<LazyFallback />}><InteriorDesignLandingPage /></Suspense>} />
      <Route path="/arsim" element={<Suspense fallback={<LazyFallback />}><EducationLandingPage /></Suspense>} />
      <Route path="/social-media" element={<Suspense fallback={<LazyFallback />}><SocialMediaLandingPage /></Suspense>} />
      <Route path="/masazh" element={<Suspense fallback={<LazyFallback />}><MassageLandingPage /></Suspense>} />
      <Route path="/agroturizem" element={<Suspense fallback={<LazyFallback />}><AgroturizemLandingPage /></Suspense>} />
      <Route path="/website" element={<Suspense fallback={<LazyFallback />}><WebsiteLandingPage /></Suspense>} />
      <Route path="/website-maintenance" element={<Suspense fallback={<LazyFallback />}><WebsiteMaintenanceLandingPage /></Suspense>} />
      <Route path="/pergola" element={<Suspense fallback={<LazyFallback />}><PergolaLandingPage /></Suspense>} />
      <Route path="/foto-video" element={<Suspense fallback={<LazyFallback />}><FotoVideoLandingPage /></Suspense>} />
      <Route path="/transfer" element={<Suspense fallback={<LazyFallback />}><TransferLandingPage /></Suspense>} />
      <Route path="/bakery" element={<Suspense fallback={<LazyFallback />}><BakeryLandingPage /></Suspense>} />
      <Route path="/shop-produkte" element={<Suspense fallback={<LazyFallback />}><ShopProduktLandingPage /></Suspense>} />
      <Route path="/privacy" element={<Suspense fallback={<LazyFallback />}><PrivacyPolicyView /></Suspense>} />
      <Route path="/privatesia" element={<Suspense fallback={<LazyFallback />}><PrivacyPolicyView /></Suspense>} />
      <Route path="/delete-account" element={<Suspense fallback={<LazyFallback />}><DeleteAccountView /></Suspense>} />
      <Route path="/fshi-llogarine" element={<Suspense fallback={<LazyFallback />}><DeleteAccountView /></Suspense>} />

      {/* Client Portal routes */}
      <Route path="/portal" element={<Suspense fallback={<LazyFallback />}><PortalLayout /></Suspense>}>
        <Route index element={<Suspense fallback={<LazyFallback />}><PortalDashboard /></Suspense>} />
        <Route path="invoices" element={<Suspense fallback={<LazyFallback />}><PortalInvoicesView /></Suspense>} />
        <Route path="services" element={<Suspense fallback={<LazyFallback />}><PortalServicesView /></Suspense>} />
        <Route path="chat" element={<Suspense fallback={<LazyFallback />}><PortalChatView /></Suspense>} />
        {/* Requests removed — chat is now the single support channel. Redirect old links. */}
        <Route path="requests" element={<Navigate to="/portal/chat" replace />} />
        <Route path="projects" element={<Suspense fallback={<LazyFallback />}><PortalProjectsView /></Suspense>} />
        <Route path="projects/inquiry/:inquiryId" element={<Suspense fallback={<LazyFallback />}><PortalInquiryView /></Suspense>} />
        <Route path="projects/:projectId" element={<Suspense fallback={<LazyFallback />}><PortalProjectDetailView /></Suspense>} />
        <Route path="preventiva" element={<Suspense fallback={<LazyFallback />}><PortalQuotesView /></Suspense>} />
        <Route path="contracts" element={<Suspense fallback={<LazyFallback />}><PortalContractsView /></Suspense>} />
        <Route path="social" element={<Suspense fallback={<LazyFallback />}><PortalSocialView /></Suspense>} />
      </Route>
      
      {/* Protected routes */}
      <Route path="/*" element={
        <ProtectedRoute>
          {showOnboarding && user && (
            <Suspense fallback={null}>
              <OnboardingWizard
                userName={user.displayName?.split(' ')[0]}
                onComplete={() => {
                  localStorage.setItem('fivocrm_onboarding_done', '1');
                  if (user) {
                    setDoc(doc(db, 'users', user.uid), { onboardingCompleted: true }, { merge: true }).catch(() => {});
                  }
                  setShowOnboarding(false);
                }}
              />
            </Suspense>
          )}
          <div
            // Single fixed-height flex column: the fixed TopNavBar overlays the
            // reserved top padding, the content row is flex-1, and MobileBottomNav
            // is the last flex child — so header, content, and nav share ONE height
            // basis (dvh) and the nav can never anchor to a taller layout viewport
            // than the content uses (the svh/layout mismatch that hid it on mobile).
            className="h-[100dvh] flex flex-col overflow-hidden bg-background text-foreground"
            style={{
              paddingTop: `calc(${isOwner && previewRole ? '108px' : '72px'} + env(safe-area-inset-top))`,
            }}
          >
            <TopNavBar
              onToggleSidebar={toggleSidebar}
              onOpenCommandPalette={() => setCommandPaletteOpen(true)}
              onToggleMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)}
              mobileMenuOpen={mobileMenuOpen}
            />

            <div className="flex flex-1 min-h-0 min-w-0">
              <Sidebar
                collapsed={sidebarCollapsed}
                mobileOpen={mobileMenuOpen}
                onCloseMobile={() => setMobileMenuOpen(false)}
              />

              <main
                // min-w-0: a flex item defaults to min-width:auto, which lets wide
                // content (full-bleed views, wide chat bubbles, nowrap buttons) push
                // <main> past the viewport and cause horizontal overflow. min-w-0
                // lets it shrink to the available width so inner overflow-x scrolls.
                // flex flex-col min-h-0: main owns the content column height; the
                // route wrapper below is the scroll region (or full-bleed for chat).
                className={`flex-1 min-w-0 flex flex-col min-h-0 transition-all duration-normal ease-in-out ${
                  sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'
                }`}
              >
                <div
                  className={`flex-1 min-h-0 ${
                    isFullBleedRoute
                      ? 'overflow-hidden'
                      : 'overflow-y-auto p-3 sm:p-6 lg:p-8'
                  }`}
                >
                  <PendingInvitesBanner />
                  <ErrorBoundary>
                    <Suspense fallback={<LazyFallback />}>
                    <Routes>
                      <Route path="/" element={<DefaultRedirect />} />
                      <Route path="/app/dashboard" element={<StaffDashboard />} />
                      <Route path="/app/tenants" element={<PermissionGate permissionKey="isSuperAdmin"><TenantsView /></PermissionGate>} />
                      <Route path="/app/projects" element={<PermissionGate permissionKey="canAccessProjects"><ProjectsView /></PermissionGate>} />
                      <Route path="/app/projects/:projectId" element={<PermissionGate permissionKey="canAccessProjects"><ProjectDetailView /></PermissionGate>} />
                      <Route path="/app/crm" element={<PermissionGate permissionKey="canAccessCRM"><CRMView /></PermissionGate>} />
                      <Route path="/app/deals" element={<PermissionGate permissionKey="canAccessCRM"><DealsView /></PermissionGate>} />
                      <Route path="/app/tasks" element={<PermissionGate permissionKey="canAccessTasks"><TasksView /></PermissionGate>} />
                      <Route path="/app/goals" element={<PermissionGate permissionKey="canAccessGoals"><GoalsView /></PermissionGate>} />
                      <Route path="/app/teams" element={<PermissionGate permissionKey="canAccessTeams"><TeamsView /></PermissionGate>} />
                      <Route path="/app/invoices" element={<PermissionGate permissionKey="canAccessInvoices"><InvoicesView /></PermissionGate>} />
                      <Route path="/app/chat" element={<PermissionGate permissionKey="canAccessChat"><ChatView /></PermissionGate>} />
                      <Route path="/app/whatsapp" element={<PermissionGate permissionKey="canAccessWhatsapp"><WhatsappInboxView /></PermissionGate>} />
                      <Route path="/app/marketing" element={<PermissionGate permissionKey="canAccessMarketing"><MarketingView /></PermissionGate>} />
                      <Route path="/app/social" element={<PermissionGate permissionKey="canAccessMarketing"><SocialMediaView /></PermissionGate>} />
                      <Route path="/app/finances" element={<PermissionGate permissionKey="isAdmin"><FinancesView /></PermissionGate>} />
                      <Route path="/app/bonus" element={<PermissionGate permissionKey="canAccessProfile"><BonusView /></PermissionGate>} />
                      <Route path="/app/profile" element={<UserProfileView />} />
                      <Route path="/app/customers" element={<PermissionGate permissionKey="canAccessCustomers"><CustomersView /></PermissionGate>} />
                      <Route path="/app/customers/:customerId" element={<PermissionGate permissionKey="canAccessCustomers"><Customer360View /></PermissionGate>} />
                      <Route path="/app/services" element={<PermissionGate permissionKey="canAccessServices"><ServicesView /></PermissionGate>} />
                      <Route path="/app/service-inquiries" element={<PermissionGate permissionKey="canAccessCRM"><ServiceInquiriesView /></PermissionGate>} />
                      <Route path="/app/expenses" element={<PermissionGate permissionKey="canAccessExpenses"><ExpensesView /></PermissionGate>} />
                      <Route path="/app/workspace" element={<PermissionGate permissionKey="canAccessProjects"><WorkspaceView /></PermissionGate>} />
                      <Route path="/app/momentum" element={<PermissionGate permissionKey="canAccessProfile"><MomentumView /></PermissionGate>} />
                      <Route path="/app/price-calculator" element={<PermissionGate permissionKey="canAccessServices"><Suspense fallback={<div className="p-8 text-center"><span className="animate-spin">⏳</span></div>}><PriceCalculatorView /></Suspense></PermissionGate>} />
                      <Route path="/app/landing-pages" element={<PermissionGate permissionKey="canAccessServices"><Suspense fallback={<div className="p-8 text-center"><span className="animate-spin">⏳</span></div>}><LandingPagesView /></Suspense></PermissionGate>} />
                      <Route path="/app/contracts" element={<PermissionGate permissionKey="canAccessInvoices"><ContractsView /></PermissionGate>} />
                      <Route path="/app/settings" element={<PermissionGate permissionKey="canAccessProfile"><SettingsView /></PermissionGate>} />
                      <Route path="*" element={
                      <div className="text-center py-20">
                        <h1 className="text-4xl font-bold text-foreground mb-4">404</h1>
                        <p className="text-muted-foreground mb-6">Faqja nuk u gjet</p>
                        <Link to="/app/profile" className="text-primary hover:underline">
                          Kthehu në dashboard
                        </Link>
                      </div>
                    } />
                    </Routes>
                    </Suspense>
                  </ErrorBoundary>
                </div>
              </main>
            </div>

            <MobileBottomNav />
            <DailyReportPopup />
            <CommandPalette 
              open={commandPaletteOpen} 
              onOpenChange={setCommandPaletteOpen} 
            />
            <Toaster />
          </div>
        </ProtectedRoute>
      } />
    </Routes>
  );
}

// Use HashRouter for native (Capacitor), BrowserRouter for web
const Router = Capacitor.isNativePlatform() ? HashRouter : BrowserRouter;

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <AndroidBackButton />
        <GoogleApiProvider>
          <PermissionsProvider>
            <AppContent />
          </PermissionsProvider>
        </GoogleApiProvider>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
