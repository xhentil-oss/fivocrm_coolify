import React, { useMemo } from 'react';
import { useCollection } from '../../../hooks/useFirestore';
import { formatDateCompact } from './panelShared';

/** "Historik" — per-task activity history (Jira-style audit trail). */
const TaskActivityTab: React.FC<{
  taskId: string;
  getUserDisplayName: (userId: string) => string;
}> = ({ taskId, getUserDisplayName }) => {
  // Per-task activity history (Jira-style audit tab). Single where = index-free.
  const { data: rawTaskActivities } = useCollection<any>('activities', {
    skip: !taskId,
    where: [{ field: 'entityId', operator: '==', value: taskId }],
  });
  const taskActivities = useMemo(() => {
    const ms = (d: any) => d instanceof Date ? d.getTime() : (d?.toMillis?.() ?? 0);
    return [...(rawTaskActivities || [])].sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).slice(0, 30);
  }, [rawTaskActivities]);

  if (taskActivities.length === 0) return null;

  return (
    <div className="pt-4 border-t">
      <h4 className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground mb-2">Historik</h4>
      <ul className="space-y-1.5">
        {taskActivities.map((a) => (
          <li key={a.id} className="flex items-start gap-2 text-xs text-muted-foreground">
            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary/50 flex-shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="text-foreground font-medium">{a.createdByUserId ? getUserDisplayName(a.createdByUserId) : 'Sistemi'}</span>{' '}
              {a.description || a.message || a.type}
              <span className="block text-[10px] opacity-60">{formatDateCompact(a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt?.toMillis?.() || Date.now()))}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default TaskActivityTab;
