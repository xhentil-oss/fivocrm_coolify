import React, { useMemo, useEffect, useRef, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { FolderKanban, Users, CheckSquare, BarChart3, Settings, UsersRound, Receipt, MessageSquare, Target, UserCircle, DollarSign, Shield, FileText, Briefcase, LayoutDashboard, Timer, Award } from 'lucide-react';
import { cn } from '../lib/utils';
import { usePermissions } from '../hooks/usePermissions';
import { useAuth } from '../contexts/AuthContext';
import { useCollection } from '../hooks/useFirestore';
import { Badge } from './ui/badge';

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

type NavItem = {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permissionKey: string;
};

const allNavItems: NavItem[] = [
  { path: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard, permissionKey: 'canAccessProfile' },
  { path: '/app/projects', label: 'Projektet', icon: FolderKanban, permissionKey: 'canAccessProjects' },
  { path: '/app/crm', label: 'CRM Leads', icon: Users, permissionKey: 'canAccessCRM' },
  { path: '/app/customers', label: 'Klientët', icon: Users, permissionKey: 'canAccessCustomers' },
  { path: '/app/tasks', label: 'Detyrat', icon: CheckSquare, permissionKey: 'canAccessTasks' },
  { path: '/app/goals', label: 'Objektivat', icon: Target, permissionKey: 'canAccessGoals' },
  { path: '/app/teams', label: 'Ekipet', icon: UsersRound, permissionKey: 'canAccessTeams' },
  { path: '/app/services', label: 'Shërbimet', icon: Receipt, permissionKey: 'canAccessServices' },
  { path: '/app/service-inquiries', label: 'Kërkesat', icon: FileText, permissionKey: 'canAccessCRM' },
  { path: '/app/invoices', label: 'Faturat', icon: Receipt, permissionKey: 'canAccessInvoices' },
  { path: '/app/expenses', label: 'Shpenzimet', icon: DollarSign, permissionKey: 'canAccessExpenses' },
  { path: '/app/time-tracking', label: 'Orari', icon: Timer, permissionKey: 'canAccessTimeTracking' },
  { path: '/app/workspace', label: 'Workspace', icon: Briefcase, permissionKey: 'canAccessProjects' },
  { path: '/app/chat', label: 'Chat', icon: MessageSquare, permissionKey: 'canAccessChat' },
  { path: '/app/reports', label: 'Raportet', icon: BarChart3, permissionKey: 'canAccessReports' },
  { path: '/app/bonus', label: 'Bonuset', icon: Award, permissionKey: 'canAccessProfile' },
  { path: '/app/profile', label: 'Profili', icon: UserCircle, permissionKey: 'canAccessProfile' },
  { path: '/app/settings', label: 'Cilësimet', icon: Settings, permissionKey: 'canAccessSettings' },
];

const Sidebar: React.FC<SidebarProps> = ({ collapsed, mobileOpen, onCloseMobile }) => {
  const permissions = usePermissions();
  const { user } = useAuth();

  // Unread direct messages count
  const { data: unreadMessages } = useCollection<any>('directMessages', {
    where: user ? [
      { field: 'receiverId', operator: '==', value: user.uid },
      { field: 'isRead', operator: '==', value: false },
    ] : undefined,
  });

  const unreadChatCount = useMemo(() => {
    if (!unreadMessages || !user) return 0;
    return unreadMessages.filter(m => m.senderId !== user.uid).length;
  }, [unreadMessages, user]);

  // Play notification sound when unread count increases
  const prevUnreadRef = useRef(unreadChatCount);
  const audioContextRef = useRef<AudioContext | null>(null);

  const playNotificationSound = useCallback(() => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      // Two-tone chime
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch {
      // Audio not supported or blocked — ignore silently
    }
  }, []);

  useEffect(() => {
    if (unreadChatCount > prevUnreadRef.current && prevUnreadRef.current >= 0) {
      playNotificationSound();
    }
    prevUnreadRef.current = unreadChatCount;
  }, [unreadChatCount, playNotificationSound]);

  // Filter nav items based on user permissions
  // While loading, show only profile to avoid unauthorized flicker
  const navItems = permissions.isLoading 
    ? allNavItems.filter(item => item.permissionKey === 'canAccessProfile')
    : allNavItems.filter(item => {
        const permKey = item.permissionKey as keyof typeof permissions;
        return permissions[permKey] === true;
      });

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-[72px] h-[calc(100vh-72px)] bg-card border-r transition-all duration-300 z-40 flex flex-col',
          collapsed ? 'w-16' : 'w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Role indicator */}
        {!collapsed && permissions.role && (
          <div className="px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Roli im</p>
                <p className="text-sm font-medium truncate">{permissions.role}</p>
              </div>
            </div>
            {permissions.teamName && (
              <Badge variant="secondary" className="mt-2 text-xs">
                {permissions.teamName}
              </Badge>
            )}
          </div>
        )}

        <nav className="p-4 space-y-2 flex-1 overflow-y-auto">
          {permissions.isLoading ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              Duke ngarkuar...
            </div>
          ) : (
            navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={onCloseMobile}
                className={({ isActive }) =>
                  cn(
                    'group flex items-center gap-3 px-3 py-3 min-h-[44px] rounded-lg transition-all duration-200',
                    'hover:bg-primary/10 hover:text-primary hover:translate-x-1 active:bg-primary/20',
                    isActive && 'bg-primary/15 text-primary font-medium shadow-sm border-l-2 border-primary',
                    collapsed && 'justify-center hover:translate-x-0'
                  )
                }
              >
                <div className="relative">
                  <item.icon className="h-5 w-5 flex-shrink-0 transition-transform group-hover:scale-110" />
                  {item.path === '/app/chat' && unreadChatCount > 0 && collapsed && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-error rounded-full animate-pulse" />
                  )}
                </div>
                {!collapsed && (
                  <span className="flex-1 flex items-center justify-between transition-colors">
                    {item.label}
                    {item.path === '/app/chat' && unreadChatCount > 0 && (
                      <Badge className="bg-error text-white text-xs px-1.5 py-0 min-w-[20px] h-5 flex items-center justify-center animate-pulse">
                        {unreadChatCount > 99 ? '99+' : unreadChatCount}
                      </Badge>
                    )}
                  </span>
                )}
              </NavLink>
            ))
          )}
        </nav>

        {/* Permission count indicator */}
        {!collapsed && !permissions.isLoading && permissions.role && (
          <div className="px-4 py-3 border-t text-xs text-muted-foreground">
            {navItems.length} module të aksesueshme
          </div>
        )}
      </aside>
    </>
  );
};

export default Sidebar;
