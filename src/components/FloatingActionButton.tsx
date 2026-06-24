import React, { useState } from 'react';
import { Plus, FolderKanban, CheckSquare, Users, FileText } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { useNavigate } from 'react-router-dom';

const FloatingActionButton: React.FC = () => {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();

  const actions = [
    { icon: FolderKanban, label: 'Project', path: '/app/projects' },
    { icon: CheckSquare, label: 'Task', path: '/app/tasks' },
    { icon: Users, label: 'Lead', path: '/app/crm' },
    { icon: FileText, label: 'Note', path: '/app/projects' },
  ];

  return (
    <div className="fixed bottom-20 right-4 lg:bottom-8 lg:right-8 z-50 flex flex-col-reverse items-end gap-3" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {expanded && (
        <div className="flex flex-col-reverse gap-2 animate-fade-in">
          {actions.map((action, index) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                onClick={() => {
                  navigate(action.path);
                  setExpanded(false);
                }}
                className="flex items-center gap-3 bg-card text-foreground px-4 py-3 rounded-lg shadow-lg hover:shadow-xl transition-all duration-fast hover:-translate-y-1 border border-border"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <Icon className="w-5 h-5 text-primary" />
                <span className="text-body-sm font-normal">{action.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <Button
        size="icon"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-14 h-14 rounded-full shadow-primary bg-gradient-primary text-primary-foreground hover:shadow-glow-primary transition-all duration-fast",
          expanded && "rotate-45"
        )}
        aria-label={expanded ? "Close menu" : "Open quick actions"}
      >
        <Plus className="w-6 h-6" />
      </Button>
    </div>
  );
};

export default FloatingActionButton;