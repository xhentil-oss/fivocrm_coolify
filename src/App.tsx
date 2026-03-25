import React, { useState } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useAuth } from './contexts/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import TopNavBar from './components/TopNavBar';
import Sidebar from './components/Sidebar';
import LoginView from './views/LoginView';
import RegisterView from './views/RegisterView';
import ProjectsView from './views/ProjectsView';
import ProjectDetailView from './views/ProjectDetailView';
import CRMView from './views/CRMView';
import TasksView from './views/TasksView';
import GoalsView from './views/GoalsView';
import TeamsView from './views/TeamsView';
import InvoicesView from './views/InvoicesView';
import ChatView from './views/ChatView';
import ReportsView from './views/ReportsView';
import UserProfileView from './views/UserProfileView';
import SettingsView from './views/SettingsView';
import CustomersView from './views/CustomersView';
import ServicesView from './views/ServicesView';
import ServiceInquiriesView from './views/ServiceInquiriesView';
import ExpensesView from './views/ExpensesView';
import TimeTrackingView from './views/TimeTrackingView';
import WorkspaceView from './views/WorkspaceView';
import StaffDashboard from './views/StaffDashboard';
import JoinInviteView from './views/JoinInviteView';
import Customer360View from './views/Customer360View';
import PortalLayout from './views/portal/PortalLayout';
import PortalDashboard from './views/portal/PortalDashboard';
import PortalInvoicesView from './views/portal/PortalInvoicesView';
import PortalServicesView from './views/portal/PortalServicesView';
import PortalChatView from './views/portal/PortalChatView';
import PortalRequestsView from './views/portal/PortalRequestsView';
import PortalProjectsView from './views/portal/PortalProjectsView';
import PortalProjectDetailView from './views/portal/PortalProjectDetailView';
import FloatingActionButton from './components/FloatingActionButton';
import CommandPalette from './components/CommandPalette';
import PermissionGate from './components/PermissionGate';
import PendingInvitesBanner from './components/PendingInvitesBanner';
import { GoogleApiProvider } from './contexts/GoogleApiContext';
import { usePermissions } from './hooks/usePermissions';
import { useTeamDataMigration } from './hooks/useTeamDataMigration';
import { Toaster } from './components/ui/toaster';
import { Loader2 } from 'lucide-react';

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

      {/* Client Portal routes */}
      <Route path="/portal" element={<PortalLayout />}>
        <Route index element={<PortalDashboard />} />
        <Route path="invoices" element={<PortalInvoicesView />} />
        <Route path="services" element={<PortalServicesView />} />
        <Route path="chat" element={<PortalChatView />} />
        <Route path="requests" element={<PortalRequestsView />} />
        <Route path="projects" element={<PortalProjectsView />} />
        <Route path="projects/:projectId" element={<PortalProjectDetailView />} />
      </Route>
      
      {/* Protected routes */}
      <Route path="/*" element={
        <ProtectedRoute>
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
                className={`flex-1 transition-all duration-normal ease-in-out mt-[72px] ${
                  sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'
                }`}
              >
                <div className="p-3 sm:p-6 lg:p-8">
                  <PendingInvitesBanner />
                  <ErrorBoundary>
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
                      <Route path="/app/profile" element={<UserProfileView />} />
                      <Route path="/app/customers" element={<PermissionGate permissionKey="canAccessCustomers"><CustomersView /></PermissionGate>} />
                      <Route path="/app/customers/:customerId" element={<PermissionGate permissionKey="canAccessCustomers"><Customer360View /></PermissionGate>} />
                      <Route path="/app/services" element={<PermissionGate permissionKey="canAccessServices"><ServicesView /></PermissionGate>} />
                      <Route path="/app/service-inquiries" element={<PermissionGate permissionKey="canAccessCRM"><ServiceInquiriesView /></PermissionGate>} />
                      <Route path="/app/expenses" element={<PermissionGate permissionKey="canAccessExpenses"><ExpensesView /></PermissionGate>} />
                      <Route path="/app/time-tracking" element={<PermissionGate permissionKey="canAccessTimeTracking"><TimeTrackingView /></PermissionGate>} />
                      <Route path="/app/workspace" element={<PermissionGate permissionKey="canAccessProjects"><WorkspaceView /></PermissionGate>} />
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
                  </ErrorBoundary>
                </div>
              </main>
            </div>

            <FloatingActionButton />
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
          <AppContent />
        </GoogleApiProvider>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
