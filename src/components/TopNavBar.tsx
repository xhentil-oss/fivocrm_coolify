import React from 'react';
import { Search, Plus, User, Menu, X, LogOut } from 'lucide-react';
import { Button } from './ui/button';
import { useAuth } from '../contexts/AuthContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleSwitchAccount = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-[72px] bg-gradient-primary border-b border-border/20">
      <div className="h-full px-3 sm:px-4 lg:px-6 flex items-center justify-between">
        <div className="flex items-center gap-2 sm:gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleMobileMenu}
            className="lg:hidden bg-white/10 text-primary-foreground hover:bg-white/20"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
          
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            className="hidden lg:flex bg-white/10 text-primary-foreground hover:bg-white/20"
            aria-label="Hap/Mbyll panelin anësor"
          >
            <Menu className="w-5 h-5" />
          </Button>

          <h1 className="text-h4 text-primary-foreground font-medium">
            WorkHub
          </h1>
        </div>

        <div className="flex-1 max-w-xs lg:max-w-xl mx-2 lg:mx-8 hidden md:block">
          <button
            onClick={onOpenCommandPalette}
            className="w-full h-11 px-4 flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-lg text-primary-foreground/80 hover:bg-white/20 transition-colors duration-fast"
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
            className="md:hidden bg-white/10 text-primary-foreground hover:bg-white/20"
            aria-label="Kërko"
          >
            <Search className="w-5 h-5" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon"
                className="bg-white/10 text-primary-foreground hover:bg-white/20"
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
                className="bg-white/10 text-primary-foreground hover:bg-white/20"
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
  );
};

export default TopNavBar;