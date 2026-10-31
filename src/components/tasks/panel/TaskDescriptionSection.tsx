import React from 'react';
import RichTextEditor, { RichTextDisplay } from '../../RichTextEditor';
import { Button } from '../../ui/button';
import type { Task } from '../../../types';
import { cardCls, eyebrowCls } from './panelShared';

interface TaskDescriptionSectionProps {
  task: Task;
  readOnly: boolean;
  // The draft lives in the panel: "Ruaj" in the footer commits it.
  isEditing: boolean;
  setIsEditing: (v: boolean) => void;
  draft: string;
  setDraft: (v: string) => void;
  /** The panel's ONE description write: skips a value it already wrote, so the
   *  editor's blur (a click blurs it first) and this card's Ruaj never write
   *  the same HTML twice. */
  onCommit: (html: string) => Promise<void>;
}

/** "Përshkrimi" — eyebrow + a card that reads like the design's textarea
 *  (tap to edit; rich text underneath). */
const TaskDescriptionSection: React.FC<TaskDescriptionSectionProps> = ({
  task,
  readOnly,
  isEditing: isEditingDescription,
  setIsEditing: setIsEditingDescription,
  draft: descriptionText,
  setDraft: setDescriptionText,
  onCommit,
}) => (
  <div className="flex flex-col gap-2">
    <div className={eyebrowCls}>Përshkrimi</div>
    {isEditingDescription ? (
      <div className={`${cardCls} p-3`}>
        <RichTextEditor
          content={descriptionText}
          onChange={(html) => setDescriptionText(html)}
          onBlur={async (html) => {
            await onCommit(html);
            setIsEditingDescription(false);
          }}
          placeholder="Shto shënime, lidhje ose hapat e radhës…"
          minHeight="120px"
          autoFocus
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full"
            onClick={() => {
              setDescriptionText(task.description || '');
              setIsEditingDescription(false);
            }}
          >
            Anulo
          </Button>
          <Button
            size="sm"
            className="rounded-full"
            onClick={async () => {
              await onCommit(descriptionText);
              setIsEditingDescription(false);
            }}
          >
            Ruaj
          </Button>
        </div>
      </div>
    ) : (
      <div
        role={readOnly ? undefined : 'button'}
        tabIndex={readOnly ? undefined : 0}
        className={`${cardCls} min-h-[112px] px-4 py-3.5 text-[16px] leading-relaxed text-foreground transition-colors ${!readOnly ? 'cursor-text hover:border-primary/40' : ''}`}
        onClick={() => !readOnly && setIsEditingDescription(true)}
        onKeyDown={(e) => { if (!readOnly && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setIsEditingDescription(true); } }}
      >
        {task.description ? (
          <RichTextDisplay content={task.description} />
        ) : (
          <span className="text-muted-foreground/70">{readOnly ? 'Nuk ka përshkrim.' : 'Shto shënime, lidhje ose hapat e radhës…'}</span>
        )}
      </div>
    )}
  </div>
);

export default TaskDescriptionSection;
