import React from 'react';
import { Trash2, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { Task } from '../../types';

interface TaskBulkBarProps {
  count: number;
  canAssignTasks: boolean;
  /** Assignee choices (already deduped and scoped to the active business). */
  members: { userId: string }[];
  getUserName: (userId?: string) => string;
  onUpdate: (patch: Partial<Task>) => void;
  onDelete: () => void;
  onClear: () => void;
}

/** Floating bulk-action bar (list view only, where the checkboxes are). */
const TaskBulkBar: React.FC<TaskBulkBarProps> = ({ count, canAssignTasks, members, getUserName, onUpdate, onDelete, onClear }) => (
  <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-2 rounded-xl bg-card border shadow-lg flex-wrap max-w-[95vw]">
    <span className="text-sm font-medium px-1">{count} të zgjedhura</span>
    <Select onValueChange={(v) => onUpdate({ status: v as any })}>
      <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue placeholder="Statusi" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="Todo">Për të bërë</SelectItem>
        <SelectItem value="In Progress">Në progres</SelectItem>
        <SelectItem value="Review">Rishikim</SelectItem>
        <SelectItem value="Done">Përfunduar</SelectItem>
      </SelectContent>
    </Select>
    <Select onValueChange={(v) => onUpdate({ priority: v as any })}>
      <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue placeholder="Prioriteti" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="low">I ulët</SelectItem>
        <SelectItem value="medium">Mesatar</SelectItem>
        <SelectItem value="high">I lartë</SelectItem>
        <SelectItem value="urgent">Urgjent</SelectItem>
      </SelectContent>
    </Select>
    {canAssignTasks && (
      <Select onValueChange={(v) => onUpdate({ assignedToUserId: v })}>
        <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue placeholder="Cakto te" /></SelectTrigger>
        <SelectContent>
          {members.map((m) => (
            <SelectItem key={m.userId} value={m.userId}>{getUserName(m.userId)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )}
    <Button variant="destructive" size="sm" className="h-8" onClick={onDelete}><Trash2 className="w-3.5 h-3.5 mr-1" />Fshi</Button>
    <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onClear}><X className="w-4 h-4" /></Button>
  </div>
);

export default TaskBulkBar;
