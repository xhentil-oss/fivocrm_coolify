import React, { useMemo, useState } from 'react';
import { Sparkles, TrendingUp, Clock, AlertTriangle, ChevronDown, ChevronUp, DollarSign, Flag, Zap } from 'lucide-react';
import { Badge } from './ui/badge';
import type { Task, Project, Customer, Invoice } from '../types';

interface SmartSuggestionsProps {
  tasks: (Task & { id: string })[];
  projects: (Project & { id: string })[];
  customers: (Customer & { id: string })[];
  invoices: (Invoice & { id: string })[];
  onTaskClick?: (task: Task & { id: string }) => void;
  getUserName?: (userId?: string) => string;
  maxSuggestions?: number;
}

interface ScoredTask {
  task: Task & { id: string };
  score: number;
  reasons: string[];
  clientRevenue: number;
  projectName: string;
  customerName: string;
}

// Priority scoring algorithm
function computeTaskScore(
  task: Task & { id: string },
  allTasks: (Task & { id: string })[],
  projectMap: Map<string, Project & { id: string }>,
  customerRevenueMap: Map<string, number>,
  projectCustomerMap: Map<string, string>,
): ScoredTask {
  let score = 0;
  const reasons: string[] = [];

  // 1. Task priority weight (0-40 points)
  const priorityScores: Record<string, number> = { urgent: 40, high: 30, medium: 15, low: 5 };
  const priorityScore = priorityScores[task.priority || 'medium'] || 15;
  score += priorityScore;
  if (task.priority === 'urgent') reasons.push('Prioritet urgjent');
  else if (task.priority === 'high') reasons.push('Prioritet i lartë');

  // 2. Deadline proximity (0-35 points)
  const dueDate = task.endDate || task.dueDate;
  if (dueDate) {
    const now = new Date();
    const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
    const daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilDue < 0) {
      score += 35; // Overdue — maximum urgency
      reasons.push(`${Math.abs(daysUntilDue)} ditë vonuar!`);
    } else if (daysUntilDue === 0) {
      score += 30;
      reasons.push('Afati sot!');
    } else if (daysUntilDue <= 2) {
      score += 25;
      reasons.push(`Afati në ${daysUntilDue} ditë`);
    } else if (daysUntilDue <= 7) {
      score += 15;
      reasons.push('Afati brenda javës');
    } else if (daysUntilDue <= 14) {
      score += 8;
    }
  }

  // 3. Client revenue importance (0-30 points)
  let clientRevenue = 0;
  let customerName = '';
  let projectName = '';

  if (task.projectId) {
    const project = projectMap.get(task.projectId);
    if (project) {
      projectName = project.name;

      // Project budget boost
      if (project.budget && project.budget > 0) {
        const budgetScore = Math.min(15, Math.floor(project.budget / 1000));
        score += budgetScore;
        if (budgetScore >= 10) reasons.push(`Projekt me buxhet ${project.budget.toLocaleString()} L`);
      }

      // Customer revenue from invoices
      if (project.customerId) {
        clientRevenue = customerRevenueMap.get(project.customerId) || 0;
        if (clientRevenue > 0) {
          const revenueScore = Math.min(15, Math.floor(clientRevenue / 2000));
          score += revenueScore;
          if (revenueScore >= 8) reasons.push(`Klient VIP (${clientRevenue.toLocaleString()} L të ardhura)`);
          else if (revenueScore >= 4) reasons.push(`Klient i rëndësishëm`);
        }
      }
    }
  } else {
    // Check via project-customer mapping for tasks without direct project
    // Still add basic score for unassigned project tasks
  }

  // 4. Blocking factor: tasks that other tasks depend on (0-15 points)
  const blockingCount = allTasks.filter(
    t => t.dependsOn?.includes(task.id) && t.status !== 'Done'
  ).length;
  if (blockingCount > 0) {
    score += Math.min(15, blockingCount * 5);
    reasons.push(`Bllokon ${blockingCount} detyra të tjera`);
  }

  // 5. Status bonus: "In Progress" gets a small boost (it's already started)
  if (task.status === 'In Progress') {
    score += 5;
    reasons.push('Tashmë në progres');
  }

  // 6. Subtask count — tasks with more subtasks are typically bigger/more important
  const subtaskCount = allTasks.filter(t => t.parentTaskId === task.id).length;
  if (subtaskCount >= 3) {
    score += 5;
    reasons.push(`${subtaskCount} nën-detyra`);
  }

  // Find customer name
  if (task.projectId) {
    const project = projectMap.get(task.projectId);
    if (project?.customerId) {
      customerName = projectCustomerMap.get(project.customerId) || '';
    }
  }

  return { task, score, reasons, clientRevenue, projectName, customerName };
}

const SmartSuggestions: React.FC<SmartSuggestionsProps> = ({
  tasks,
  projects,
  customers,
  invoices,
  onTaskClick,
  getUserName,
  maxSuggestions = 5,
}) => {
  // Collapsed by default so the actual task list (below) is immediately visible;
  // the user's choice is remembered across reloads.
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem('smart_suggestions_expanded') === 'true'; } catch { return false; }
  });
  const toggleExpanded = () => {
    setExpanded(prev => {
      const next = !prev;
      try { localStorage.setItem('smart_suggestions_expanded', String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Build lookup maps
  const projectMap = useMemo(() => {
    const map = new Map<string, Project & { id: string }>();
    projects?.forEach(p => map.set(p.id, p));
    return map;
  }, [projects]);

  const customerRevenueMap = useMemo(() => {
    const map = new Map<string, number>();
    invoices?.forEach(inv => {
      if (inv.customerId && (inv.status === 'Paid' || inv.status === 'Pending')) {
        const current = map.get(inv.customerId) || 0;
        map.set(inv.customerId, current + (inv.total ?? inv.amount ?? 0));
      }
    });
    return map;
  }, [invoices]);

  const projectCustomerMap = useMemo(() => {
    const map = new Map<string, string>();
    customers?.forEach(c => map.set(c.id, c.name));
    return map;
  }, [customers]);

  // Score and rank all active tasks
  const scoredTasks = useMemo(() => {
    if (!tasks || tasks.length === 0) return [];

    const activeTasks = tasks.filter(
      t => t.status !== 'Done' && !t.parentTaskId // Only parent, non-done tasks
    );

    const scored = activeTasks.map(task =>
      computeTaskScore(task, tasks, projectMap, customerRevenueMap, projectCustomerMap)
    );

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSuggestions);
  }, [tasks, projectMap, customerRevenueMap, projectCustomerMap, maxSuggestions]);

  if (scoredTasks.length === 0) return null;

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-red-600 dark:text-red-400';
    if (score >= 50) return 'text-orange-600 dark:text-orange-400';
    if (score >= 30) return 'text-blue-600 dark:text-blue-400';
    return 'text-muted-foreground';
  };

  const getScoreBg = (score: number) => {
    if (score >= 70) return 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800';
    if (score >= 50) return 'bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800';
    if (score >= 30) return 'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800';
    return 'bg-muted/30 border-border';
  };

  const getPriorityIcon = (priority?: string) => {
    switch (priority) {
      case 'urgent': return <AlertTriangle className="w-3.5 h-3.5 text-red-500" />;
      case 'high': return <Flag className="w-3.5 h-3.5 text-orange-500" />;
      case 'medium': return <Flag className="w-3.5 h-3.5 text-blue-500" />;
      default: return <Flag className="w-3.5 h-3.5 text-green-500" />;
    }
  };

  return (
    <div className="border-b bg-gradient-to-r from-amber-50/50 via-orange-50/30 to-rose-50/50 dark:from-amber-950/20 dark:via-orange-950/10 dark:to-rose-950/20">
      <button
        onClick={toggleExpanded}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-semibold text-foreground">
            Sugjerime Inteligjente
          </span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
            {scoredTasks.length}
          </Badge>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-1.5">
          {scoredTasks.map((scored, index) => (
            <div
              key={scored.task.id}
              className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border cursor-pointer hover:shadow-sm transition-all ${getScoreBg(scored.score)}`}
              onClick={() => onTaskClick?.(scored.task)}
            >
              {/* Rank number */}
              <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                index === 0 ? 'bg-amber-500 text-white' :
                index === 1 ? 'bg-gray-400 text-white' :
                index === 2 ? 'bg-orange-400 text-white' :
                'bg-muted text-muted-foreground'
              }`}>
                {index + 1}
              </div>

              {/* Task info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {getPriorityIcon(scored.task.priority)}
                  <span className="text-sm font-medium text-foreground truncate">
                    {scored.task.title}
                  </span>
                </div>

                {/* Context row */}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {scored.projectName && (
                    <span className="text-[11px] text-muted-foreground bg-background/80 px-1.5 py-0.5 rounded">
                      {scored.projectName}
                    </span>
                  )}
                  {scored.customerName && (
                    <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                      <DollarSign className="w-3 h-3" />
                      {scored.customerName}
                    </span>
                  )}
                  {scored.task.assignedToUserId && getUserName && (
                    <span className="text-[11px] text-muted-foreground">
                      → {getUserName(scored.task.assignedToUserId)}
                    </span>
                  )}
                </div>

                {/* Reason tags */}
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {scored.reasons.map((reason, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-background/60 text-muted-foreground border border-border/50"
                    >
                      {reason.includes('Bllokon') ? <Zap className="w-2.5 h-2.5 text-amber-500" /> :
                       reason.includes('vonuar') || reason.includes('sot') ? <Clock className="w-2.5 h-2.5 text-red-500" /> :
                       reason.includes('VIP') || reason.includes('ardhura') ? <TrendingUp className="w-2.5 h-2.5 text-green-500" /> :
                       null}
                      {reason}
                    </span>
                  ))}
                </div>
              </div>

              {/* Score badge */}
              <div className={`flex-shrink-0 text-right`}>
                <div className={`text-lg font-bold tabular-nums ${getScoreColor(scored.score)}`}>
                  {scored.score}
                </div>
                <div className="text-[9px] text-muted-foreground uppercase tracking-wider">pikë</div>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-1.5 px-2 pt-1 text-[10px] text-muted-foreground">
            <Sparkles className="w-3 h-3" />
            <span>Renditja bazohet në: prioritet, afat, vlerë klienti, buxhet projekti, dhe varësi detyrash</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default SmartSuggestions;
