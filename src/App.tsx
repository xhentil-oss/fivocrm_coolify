import React, { useState, Suspense, useEffect } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { getDoc, setDoc, doc } from 'firebase/firestore';
import { db } from './lib/firebase';
import { useAuth } from './contexts/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import TopNavBar from './components/TopNavBar';
import Sidebar from './components/Sidebar';
import LoginView from './views/LoginView';
import RegisterView from './views/RegisterView';
import FloatingActionButton from './components/FloatingActionButton';
import DailyReportPopup from './components/DailyReportPopup';
import CommandPalette from './components/CommandPalette';
import PermissionGate from './components/PermissionGate';
import PendingInvitesBanner from './components/PendingInvitesBanner';
import { GoogleApiProvider } from './contexts/GoogleApiContext';
import { PermissionsProvider, usePermissions } from './contexts/PermissionsContext';
import { useTeamDataMigration } from './hooks/useTeamDataMigration';
import { useTeamSettingsSync } from './hooks/useTeamSettings';
import { useBreakReminder } from './hooks/useBreakReminder';
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
const TasksView = lazyRetry(() => import('./views/TasksView'));
const GoalsView = lazyRetry(() => import('./views/GoalsView'));
const TeamsView = lazyRetry(() => import('./views/TeamsView'));
const InvoicesView = lazyRetry(() => import('./views/InvoicesView'));
const ChatView = lazyRetry(() => import('./views/ChatView'));
const ReportsView = lazyRetry(() => import('./views/ReportsView'));
const BonusView = lazyRetry(() => import('./views/BonusView'));
const UserProfileView = lazyRetry(() => import('./views/UserProfileView'));
const SettingsView = lazyRetry(() => import('./views/SettingsView'));
const CustomersView = lazyRetry(() => import('./views/CustomersView'));
const ServicesView = lazyRetry(() => import('./views/ServicesView'));
const ServiceInquiriesView = lazyRetry(() => import('./views/ServiceInquiriesView'));
const ExpensesView = lazyRetry(() => import('./views/ExpensesView'));
const TimeTrackingView = lazyRetry(() => import('./views/TimeTrackingView'));
const WorkspaceView = lazyRetry(() => import('./views/WorkspaceView'));
const StaffDashboard = lazyRetry(() => import('./views/StaffDashboard'));
const WorkloadView = lazyRetry(() => import('./views/WorkloadView'));
const JoinInviteView = lazyRetry(() => import('./views/JoinInviteView'));
const Customer360View = React.lazy(() => import('./views/Customer360View'));
const PortalLayout = React.lazy(() => import('./views/portal/PortalLayout'));
const PortalDashboard = React.lazy(() => import('./views/portal/PortalDashboard'));
const PortalInvoicesView = React.lazy(() => import('./views/portal/PortalInvoicesView'));
const PortalServicesView = React.lazy(() => import('./views/portal/PortalServicesView'));
const PortalChatView = React.lazy(() => import('./views/portal/PortalChatView'));
const PortalRequestsView = React.lazy(() => import('./views/portal/PortalRequestsView'));
const PortalProjectsView = React.lazy(() => import('./views/portal/PortalProjectsView'));
const PortalProjectDetailView = React.lazy(() => import('./views/portal/PortalProjectDetailView'));
const OnboardingWizard = React.lazy(() => import('./components/OnboardingWizard'));
const SeoLandingPage = lazyRetry(() => import('./views/landing/SeoLandingPage'));
const RealEstateLandingPage = lazyRetry(() => import('./views/landing/RealEstateLandingPage'));
const ResortLandingPage = lazyRetry(() => import('./views/landing/ResortLandingPage'));
const EstetikeLandingPage = lazyRetry(() => import('./views/landing/EstetikeLandingPage'));
const PriceCalculatorView = lazyRetry(() => import('./views/PriceCalculatorView'));
const LandingPagesView = lazyRetry(() => import('./views/LandingPagesView'));

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user } = useAuth();
  const { isOwner, previewRole } = usePermissions();
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('fivocrm_onboarding_done');
  });

  // Sync team settings from Firestore → localStorage on every change
  useTeamSettingsSync();

  // Break reminder — get-up-and-move reminder every 2 hours from 8:00
  useBreakReminder();

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
      <Route path="/join/:token" element={<JoinInviteView />} />
      <Route path="/seo" element={<Suspense fallback={<LazyFallback />}><SeoLandingPage /></Suspense>} />
      <Route path="/real-estate" element={<Suspense fallback={<LazyFallback />}><RealEstateLandingPage /></Suspense>} />
      <Route path="/resorte" element={<Suspense fallback={<LazyFallback />}><ResortLandingPage /></Suspense>} />
      <Route path="/estetike" element={<Suspense fallback={<LazyFallback />}><EstetikeLandingPage /></Suspense>} />

      {/* Client Portal routes */}
      <Route path="/portal" element={<Suspense fallback={<LazyFallback />}><PortalLayout /></Suspense>}>
        <Route index element={<Suspense fallback={<LazyFallback />}><PortalDashboard /></Suspense>} />
        <Route path="invoices" element={<Suspense fallback={<LazyFallback />}><PortalInvoicesView /></Suspense>} />
        <Route path="services" element={<Suspense fallback={<LazyFallback />}><PortalServicesView /></Suspense>} />
        <Route path="chat" element={<Suspense fallback={<LazyFallback />}><PortalChatView /></Suspense>} />
        <Route path="requests" element={<Suspense fallback={<LazyFallback />}><PortalRequestsView /></Suspense>} />
        <Route path="projects" element={<Suspense fallback={<LazyFallback />}><PortalProjectsView /></Suspense>} />
        <Route path="projects/:projectId" element={<Suspense fallback={<LazyFallback />}><PortalProjectDetailView /></Suspense>} />
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
          <div className="min-h-screen bg-background text-foreground">
            <TopNavBar 
              onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
              onOpenCommandPalette={() => setCommandPaletteOpen(true)}
              onToggleMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)}
              mobileMenuOpen={mobileMenuOpen}
            />
            
            <div className="flex">
              <Sidebar 
                collapsed={sidebarCollapsed} 
                mobileOpen={mobileMenuOpen}
                onCloseMobile={() => setMobileMenuOpen(false)}
              />
              
              <main 
                className={`flex-1 transition-all duration-normal ease-in-out ${
                  isOwner && previewRole ? 'mt-[108px]' : 'mt-[72px]'
                } ${
                  sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'
                }`}
              >
                <div className="p-3 sm:p-6 lg:p-8">
                  <PendingInvitesBanner />
                  <ErrorBoundary>
                    <Suspense fallback={<LazyFallback />}>
                    <Routes>
                      <Route path="/" element={<DefaultRedirect />} />
                      <Route path="/app/dashboard" element={<StaffDashboard />} />
                      <Route path="/app/projects" element={<PermissionGate permissionKey="canAccessProjects"><ProjectsView /></PermissionGate>} />
                      <Route path="/app/projects/:projectId" element={<PermissionGate permissionKey="canAccessProjects"><ProjectDetailView /></PermissionGate>} />
                      <Route path="/app/crm" element={<PermissionGate permissionKey="canAccessCRM"><CRMView /></PermissionGate>} />
                      <Route path="/app/tasks" element={<PermissionGate permissionKey="canAccessTasks"><TasksView /></PermissionGate>} />
                      <Route path="/app/goals" element={<PermissionGate permissionKey="canAccessGoals"><GoalsView /></PermissionGate>} />
                      <Route path="/app/teams" element={<PermissionGate permissionKey="canAccessTeams"><TeamsView /></PermissionGate>} />
                      <Route path="/app/invoices" element={<PermissionGate permissionKey="canAccessInvoices"><InvoicesView /></PermissionGate>} />
                      <Route path="/app/chat" element={<PermissionGate permissionKey="canAccessChat"><ChatView /></PermissionGate>} />
                      <Route path="/app/reports" element={<PermissionGate permissionKey="canAccessReports"><ReportsView /></PermissionGate>} />
                      <Route path="/app/bonus" element={<PermissionGate permissionKey="canAccessProfile"><BonusView /></PermissionGate>} />
                      <Route path="/app/profile" element={<UserProfileView />} />
                      <Route path="/app/customers" element={<PermissionGate permissionKey="canAccessCustomers"><CustomersView /></PermissionGate>} />
                      <Route path="/app/customers/:customerId" element={<PermissionGate permissionKey="canAccessCustomers"><Customer360View /></PermissionGate>} />
                      <Route path="/app/services" element={<PermissionGate permissionKey="canAccessServices"><ServicesView /></PermissionGate>} />
                      <Route path="/app/service-inquiries" element={<PermissionGate permissionKey="canAccessCRM"><ServiceInquiriesView /></PermissionGate>} />
                      <Route path="/app/expenses" element={<PermissionGate permissionKey="canAccessExpenses"><ExpensesView /></PermissionGate>} />
                      <Route path="/app/time-tracking" element={<PermissionGate permissionKey="canAccessTimeTracking"><TimeTrackingView /></PermissionGate>} />
                      <Route path="/app/workspace" element={<PermissionGate permissionKey="canAccessProjects"><WorkspaceView /></PermissionGate>} />
                      <Route path="/app/workload" element={<PermissionGate permissionKey="canAccessReports"><WorkloadView /></PermissionGate>} />
                      <Route path="/app/price-calculator" element={<PermissionGate permissionKey="canAccessServices"><Suspense fallback={<div className="p-8 text-center"><span className="animate-spin">⏳</span></div>}><PriceCalculatorView /></Suspense></PermissionGate>} />
                      <Route path="/app/landing-pages" element={<PermissionGate permissionKey="canAccessServices"><Suspense fallback={<div className="p-8 text-center"><span className="animate-spin">⏳</span></div>}><LandingPagesView /></Suspense></PermissionGate>} />
                      <Route path="/app/settings" element={<PermissionGate permissionKey="canAccessSettings"><SettingsView /></PermissionGate>} />
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

            <FloatingActionButton />
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
