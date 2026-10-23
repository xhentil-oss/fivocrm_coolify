import React, { useMemo } from 'react';
import { Activity } from 'lucide-react';
import { useCollection } from '../../../hooks/useFirestore';
import { IconTile, SheetRow, cardCls, dayLabel, timeStr } from './panelShared';

/** "Aktiviteti" card — per-task activity history (Jira-style audit trail),
 *  collapsed into one row ("N ngjarje") that opens the list. */
const TaskActivityTab: React.FC<{
  taskId: string;
  getUserDisplayName: (userId: string) => string;
  open: boolean;
  onToggle: () => void;
}> = ({ taskId, getUserDisplayName, open, onToggle }) => {
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

  const when = (raw: any) => {
    const d = raw instanceof Date ? raw : new Date(raw?.toMillis?.() || Date.now());
    return `${dayLabel(d)} · ${timeStr(d)}`;
  };

  return (
    <div className={cardCls}>
      <SheetRow
        tile={<IconTile tone="neutral"><Activity className="h-[17px] w-[17px]" strokeWidth={2} /></IconTile>}
        label="Aktiviteti"
        value={`${taskActivities.length} ngjarje`}
        valueClassName="text-[15px] text-muted-foreground"
        open={open}
        onToggle={onToggle}
      />
      {open && (
        <ul className="flex flex-col gap-3 px-4 pb-4 pl-[58px] pt-0.5">
          {taskActivities.map((a) => (
            <li key={a.id} className="flex flex-col gap-0.5">
              <div className="text-[14px] text-foreground/80">
                <strong className="font-semibold text-foreground">{a.createdByUserId ? getUserDisplayName(a.createdByUserId) : 'Sistemi'}</strong>{' '}
                {a.description || a.message || a.type}
              </div>
              <div className="text-[12px] text-muted-foreground">{when(a.createdAt)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default TaskActivityTab;
