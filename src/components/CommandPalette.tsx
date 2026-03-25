import React from 'react';
import { Search, FolderKanban, Users, CheckSquare, BarChart3, Settings } from 'lucide-react';
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
} from './ui/command';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onOpenChange }) => {
  const navigate = useNavigate();

  const commands = [
    { icon: FolderKanban, label: 'Go to Projects', path: '/app/projects' },
    { icon: Users, label: 'Go to CRM Leads', path: '/app/crm' },
    { icon: CheckSquare, label: 'Go to Tasks', path: '/app/tasks' },
    { icon: BarChart3, label: 'Go to Reports', path: '/app/reports' },
    { icon: Settings, label: 'Go to Settings', path: '/app/settings' },
    { icon: FolderKanban, label: 'Create New Project', path: '/app/projects' },
    { icon: Users, label: 'Create New Lead', path: '/app/crm' },
    { icon: CheckSquare, label: 'Create New Task', path: '/app/tasks' },
  ];

  const handleSelect = (path: string) => {
    navigate(path);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 max-w-2xl">
        <Command className="rounded-lg border-0">
          <CommandInput 
            placeholder="Search or type a command..." 
            className="text-foreground"
          />
          <CommandList>
            <CommandEmpty className="text-muted-foreground py-6 text-center">
              No results found.
            </CommandEmpty>
            <CommandGroup heading="Navigation" className="text-muted-foreground">
              {commands.slice(0, 5).map((command) => {
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
            <CommandGroup heading="Actions" className="text-muted-foreground">
              {commands.slice(5).map((command) => {
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
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
};

export default CommandPalette;