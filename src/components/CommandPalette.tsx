import React, { useMemo } from 'react';
import {
  FolderKanban,
  Users,
  CheckSquare,
  Settings,
  Hash,
  MessageSquare,
  User as UserIcon,
  Wallet,
  Package,
  BellRing,
  Server as ServerIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
} from './ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from './ui/command';
import { useCollection } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { useModules } from '../hooks/useModules';
import type { Channel, TeamMember, Customer } from '../types';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onOpenChange }) => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: channels } = useCollection<Channel>('channels');
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers');
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });

  // The palette used to list every destination regardless of the tenant's modules or
  // the user's role, so it could navigate straight into a blocked page.
  const { isEnabled } = useModules();

  const commands = [
    { icon: FolderKanban, label: 'Shko te Projektet', path: '/app/projects' },
    { icon: BellRing, label: 'Shko te Ndjekjet (sot / vonuar)', path: '/app/follow-ups' },
    { icon: Users, label: 'Shko te Klientët / Lead-et', path: '/app/crm' },
    { icon: CheckSquare, label: 'Shko te Detyrat', path: '/app/tasks' },
    { icon: Package, label: 'Shko te Dyqani', path: '/app/products' },
    { icon: Package, label: 'Shko te Porositë', path: '/app/shop-orders' },
    { icon: ServerIcon, label: 'Shko te Hosting & Domain-e', path: '/app/hosting' },
    { icon: MessageSquare, label: 'Shko te Chati', path: '/app/chat' },
    { icon: Wallet, label: 'Shko te Financat', path: '/app/finances' },
    { icon: Settings, label: 'Shko te Cilësimet', path: '/app/settings' },
  ].filter(c => isEnabled(c.path));

  const actions = [
    { icon: FolderKanban, label: 'Krijo Projekt të Ri', path: '/app/projects' },
    { icon: Users, label: 'Krijo Lead të Ri', path: '/app/crm' },
    // `?new=1` makes TasksView open its create form (and drop the param) — the
    // action used to land on the list and leave the user to find the button.
    { icon: CheckSquare, label: 'Krijo Detyrë të Re', path: '/app/tasks?new=1' },
    { icon: Package, label: 'Krijo Produkt të Ri', path: '/app/products' },
    // The module registry resolves routes, not query strings.
  ].filter(a => isEnabled(a.path.split('?')[0]));

  const handleSelect = (path: string) => {
    navigate(path);
    onOpenChange(false);
  };

  const handleOpenChannel = (channelId: string) => {
    navigate('/app/chat', { state: { channel: channelId } });
    onOpenChange(false);
  };

  const handleOpenDM = (userId: string) => {
    navigate('/app/chat', { state: { directUserId: userId } });
    onOpenChange(false);
  };

  const sortedChannels = useMemo(
    () => (channels || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [channels]
  );

  const otherMembers = useMemo(
    () => (teamMembers || []).filter(m => m.userId && m.userId !== user?.uid),
    [teamMembers, user?.uid]
  );

  const sortedCustomers = useMemo(
    () => (customers || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [customers]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 max-w-2xl">
        <Command className="rounded-lg border-0">
          <CommandInput
            placeholder="Kërko ose shkruaj një komandë..."
            className="text-foreground"
          />
          <CommandList className="max-h-[500px]">
            <CommandEmpty className="text-muted-foreground py-6 text-center">
              Asnjë rezultat.
            </CommandEmpty>

            <CommandGroup heading="Navigim" className="text-muted-foreground">
              {commands.map((command) => {
                const Icon = command.icon;
                return (
                  <CommandItem
                    key={command.label}
                    onSelect={() => handleSelect(command.path)}
                    className="text-foreground"
                  >
                    <Icon className="w-4 h-4 mr-3 text-primary" />
                    {command.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Veprime" className="text-muted-foreground">
              {actions.map((command) => {
                const Icon = command.icon;
                return (
                  <CommandItem
                    key={command.label}
                    onSelect={() => handleSelect(command.path)}
                    className="text-foreground"
                  >
                    <Icon className="w-4 h-4 mr-3 text-primary" />
                    {command.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>

            {sortedChannels.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Kanalet" className="text-muted-foreground">
                  {sortedChannels.slice(0, 30).map((ch) => (
                    <CommandItem
                      key={ch.id}
                      value={`#${ch.name || ''} kanal channel`}
                      onSelect={() => handleOpenChannel(ch.id)}
                      className="text-foreground"
                    >
                      <Hash className="w-4 h-4 mr-3 text-primary" />
                      {ch.name || ch.id}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {otherMembers.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Mesazh direkt" className="text-muted-foreground">
                  {otherMembers.slice(0, 30).map((m) => (
                    <CommandItem
                      key={m.userId}
                      value={`${m.displayName || ''} ${m.email || ''} dm direct mesazh`}
                      onSelect={() => handleOpenDM(m.userId)}
                      className="text-foreground"
                    >
                      <UserIcon className="w-4 h-4 mr-3 text-primary" />
                      {m.displayName || m.email || 'Pa emër'}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {sortedCustomers.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Klientët" className="text-muted-foreground">
                  {sortedCustomers.slice(0, 20).map((c) => (
                    <CommandItem
                      key={c.id}
                      value={`${c.name || ''} ${c.company || ''} klient customer`}
                      onSelect={() => handleSelect(`/app/customers/${c.id}`)}
                      className="text-foreground"
                    >
                      <Users className="w-4 h-4 mr-3 text-primary" />
                      {c.name || c.company || 'Pa emër'}
                      {c.company && c.name && (
                        <span className="ml-2 text-xs text-muted-foreground">· {c.company}</span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
};

export default CommandPalette;