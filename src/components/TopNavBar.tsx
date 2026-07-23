import React from 'react';
import { Search, Plus, User, Menu, X, LogOut, Eye, EyeOff, PanelLeft } from 'lucide-react';
import { Button } from './ui/button';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { useNavigate } from 'react-router-dom';
import NotificationsCenter from './NotificationsCenter';

interface TopNavBarProps {
  onToggleSidebar: () => void;
  onOpenCommandPalette: () => void;
  onToggleMobileMenu: () => void;
  mobileMenuOpen: boolean;
}

const TopNavBar: React.FC<TopNavBarProps> = ({ 
  onToggleSidebar, 
  onOpenCommandPalette,
  onToggleMobileMenu,
  mobileMenuOpen
}) => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { isOwner, previewRole, setPreviewRole } = usePermissions();

  const ROLES = ['Admin', 'Sales', 'Manager', 'Member', 'Viewer'] as const;

  const roleLabelMap: Record<string, string> = {
    Admin: 'Admin',
    Sales: 'Shitje',
    Manager: 'Menaxher',
    Member: 'Anëtar',
    Viewer: 'Shikues',
  };

  const handleLogout = async () => {
    setPreviewRole(null);
    await logout();
    navigate('/login');
  };

  const handleSwitchAccount = async () => {
    setPreviewRole(null);
    await logout();
    navigate('/login');
  };

  return (
    <>
      {/* height grows by the top safe-area inset; padding pushes the content below
          the status bar / notch on edge-to-edge Android/iOS. */}
      <header
        className="fixed top-0 left-0 right-0 z-50 bg-brand-navy border-b border-white/10"
        style={{ height: 'calc(72px + env(safe-area-inset-top))', paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="h-full px-3 sm:px-4 lg:px-6 flex items-center justify-between">
        <div className="flex items-center gap-2 sm:gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleMobileMenu}
            className="lg:hidden bg-white/10 text-white hover:bg-white/20"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
          
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            className="hidden lg:flex bg-white/10 text-white hover:bg-white/20"
            aria-label="Zvogëlo/Zgjero panelin anësor"
            title="Zvogëlo/Zgjero panelin anësor (vetëm ikonat)"
          >
            <PanelLeft className="w-5 h-5" />
          </Button>

          <h1 className="text-h4 text-white font-medium">
            FivoCRM
          </h1>
        </div>

        <div className="flex-1 max-w-xs lg:max-w-xl mx-2 lg:mx-8 hidden md:block">
          <button
            onClick={onOpenCommandPalette}
            className="w-full h-11 px-4 flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-lg text-white/80 hover:bg-white/20 transition-colors duration-fast"
          >
            <Search className="w-5 h-5" />
            <span className="text-body-sm">Kërko ose shkruaj një komandë...</span>
            <kbd className="ml-auto px-2 py-1 text-caption bg-white/10 rounded">
              ⌘K
            </kbd>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenCommandPalette}
            className="md:hidden bg-white/10 text-white hover:bg-white/20"
            aria-label="Kërko"
          >
            <Search className="w-5 h-5" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon"
                className="bg-white/10 text-white hover:bg-white/20"
                aria-label="Shto shpejt"
              >
                <Plus className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-foreground">Shto Shpejt</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/app/projects')} className="text-foreground">
                Projekt i Ri
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/app/crm')} className="text-foreground">
                Lead i Ri
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/app/tasks')} className="text-foreground">
                Detyrë e Re
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <NotificationsCenter />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon"
                className={`bg-white/10 text-white hover:bg-white/20 ${previewRole ? 'ring-2 ring-yellow-400' : ''}`}
                aria-label="Menyja e përdoruesit"
              >
                {user?.photoURL ? (
                  <img 
                    src={user.photoURL} 
                    alt={user.displayName || 'User'} 
                    className="w-8 h-8 rounded-full"
                  />
                ) : (
                  <User className="w-5 h-5" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {user && (
                <>
                  <DropdownMenuLabel className="text-foreground">
                    <div className="flex flex-col">
                      <span className="font-medium">{user.displayName || user.email || 'User'}</span>
                      <span className="text-xs text-muted-foreground">{user.email}</span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={() => navigate('/app/profile')} className="text-foreground">
                <User className="w-4 h-4 mr-2" />
                Profili
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/app/settings')} className="text-foreground">
                Cilësimet
              </DropdownMenuItem>

              {/* Role preview — only for the owner */}
              {isOwner && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="text-foreground">
                      <Eye className="w-4 h-4 mr-2" />
                      Shiko si rol tjetër
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {ROLES.map(role => (
                        <DropdownMenuItem
                          key={role}
                          onClick={() => setPreviewRole(previewRole === role ? null : role)}
                          className={previewRole === role ? 'bg-yellow-100 text-yellow-800 font-medium' : 'text-foreground'}
                        >
                          {previewRole === role && <EyeOff className="w-4 h-4 mr-2" />}
                          {previewRole !== role && <Eye className="w-4 h-4 mr-2 opacity-40" />}
                          {roleLabelMap[role]}
                          {previewRole === role && <span className="ml-auto text-xs">(aktiv)</span>}
                        </DropdownMenuItem>
                      ))}
                      {previewRole && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setPreviewRole(null)} className="text-foreground font-medium">
                            <EyeOff className="w-4 h-4 mr-2" />
                            Dil nga preview
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSwitchAccount} className="text-foreground">
                <User className="w-4 h-4 mr-2" />
                Ndrysho Llogarinë
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                <LogOut className="w-4 h-4 mr-2" />
                Dil nga Llogaria
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>

    {/* Preview mode banner */}
    {isOwner && previewRole && (
      <div
        className="fixed left-0 right-0 z-40 flex items-center justify-between px-4 py-1.5 bg-yellow-400 text-yellow-900 text-sm font-medium"
        style={{ top: 'calc(72px + env(safe-area-inset-top))' }}
      >
        <span>
          <Eye className="inline w-4 h-4 mr-1.5 mb-0.5" />
          Po shikoni si: <strong>{roleLabelMap[previewRole]}</strong> — kjo është vetëm një preview, të dhënat janë reale.
        </span>
        <button
          onClick={() => setPreviewRole(null)}
          className="flex items-center gap-1 underline hover:no-underline"
        >
          <EyeOff className="w-4 h-4" /> Dil nga preview
        </button>
      </div>
    )}
    </>
  );
};

export default TopNavBar;