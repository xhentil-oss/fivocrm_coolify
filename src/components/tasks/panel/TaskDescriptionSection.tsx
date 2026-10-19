import React from 'react';
import RichTextEditor, { RichTextDisplay } from '../../RichTextEditor';
import { Button } from '../../ui/button';
import type { Task } from '../../../types';

interface TaskDescriptionSectionProps {
  task: Task;
  readOnly: boolean;
  // The draft lives in the panel: "Ruaj ndryshimet" in the footer commits it.
  isEditing: boolean;
  setIsEditing: (v: boolean) => void;
  draft: string;
  setDraft: (v: string) => void;
  onUpdate: (id: string, data: any) => Promise<any>;
}

/** "Përshkrimi" — rich-text description (click to edit). */
const TaskDescriptionSection: React.FC<TaskDescriptionSectionProps> = ({
  task,
  readOnly,
  isEditing: isEditingDescription,
  setIsEditing: setIsEditingDescription,
  draft: descriptionText,
  setDraft: setDescriptionText,
  onUpdate,
}) => (
  <div className="pt-4 border-t">
    <h4 className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground mb-2">Përshkrimi</h4>
    {isEditingDescription ? (
      <div>
        <RichTextEditor
          content={descriptionText}
          onChange={(html) => setDescriptionText(html)}
          onBlur={async (html) => {
            const cleaned = html === '<p></p>' ? '' : html;
            if (cleaned !== task.description) {
              await onUpdate(task.id, { description: cleaned });
            }
            setIsEditingDescription(false);
          }}
          placeholder="Shto përshkrim..."
          minHeight="150px"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDescriptionText(task.description || '');
              setIsEditingDescription(false);
            }}
          >
            Anulo
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              const cleaned = descriptionText === '<p></p>' ? '' : descriptionText;
              if (cleaned !== task.description) {
                await onUpdate(task.id, { description: cleaned });
              }
              setIsEditingDescription(false);
            }}
          >
            Ruaj
          </Button>
        </div>
      </div>
    ) : (
      <div
        className={`min-h-[100px] text-sm p-3 rounded border border-dashed transition-colors ${!readOnly ? 'cursor-pointer hover:bg-muted/50 border-transparent hover:border-border' : 'border-transparent'}`}
        onClick={() => !readOnly && setIsEditingDescription(true)}
      >
        {task.description ? (
          <RichTextDisplay content={task.description} />
        ) : (
          <span className="text-muted-foreground">{readOnly ? 'Nuk ka përshkrim.' : 'Kliko për të shtuar përshkrim...'}</span>
        )}
      </div>
    )}
  </div>
);

export default TaskDescriptionSection;
