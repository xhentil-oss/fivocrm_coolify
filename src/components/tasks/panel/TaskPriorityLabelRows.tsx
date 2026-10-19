import React from 'react';
import { TaskLabels, LabelEditor } from '../../TaskLabels';
import type { Task } from '../../../types';
import { chipCls, rowCls, rowLabelCls } from './panelShared';

/** "Prioriteti" + "Etiketat" rows (the last rows of the meta grid). */
const TaskPriorityLabelRows: React.FC<{
  task: Task;
  readOnly: boolean;
  labelSuggestions: string[];
  onUpdate: (id: string, data: any) => Promise<any>;
}> = ({ task, readOnly, labelSuggestions, onUpdate }) => (
  <>
    {/* Prioriteti */}
    <div className={rowCls}>
      <span className={rowLabelCls}>Prioriteti</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {([['low', 'I ulët'], ['medium', 'Mesatar'], ['high', 'I lartë'], ['urgent', '⚠ Urgjent']] as const).map(([k, l]) => (
          <button
            key={k}
            type="button"
            disabled={readOnly}
            onClick={() => onUpdate(task.id, { priority: k })}
            className={chipCls((task.priority || 'medium') === k)}
          >
            {l}
          </button>
        ))}
      </div>
    </div>

    {/* Etiketat */}
    <div className={`${rowCls} items-start border-b-0`}>
      <span className={`${rowLabelCls} pt-1.5`}>Etiketat</span>
      <div className="min-w-0 flex-1">
        {readOnly ? (
          <TaskLabels labels={(task as any).labels} />
        ) : (
          <LabelEditor
            value={(task as any).labels || []}
            onChange={(labels) => onUpdate(task.id, { labels } as any)}
            suggestions={labelSuggestions}
          />
        )}
      </div>
    </div>
  </>
);

export default TaskPriorityLabelRows;
