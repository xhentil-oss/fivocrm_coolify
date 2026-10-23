import React from 'react';
import { Eye } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../../ui/dialog';

interface TaskPanelFooterProps {
  readOnly: boolean;
  isGuestMode: boolean;
  /** "Ndryshuar nga Emanuela · 22 Tet" (design) — who touched it last, when. */
  summary: string;
  /** True while a title/description draft differs from the saved task. */
  dirty: boolean;
  onSave: () => void | Promise<void>;
}

/** Bottom bar (design): translucent, "Ndryshuar nga … · date" on the left and
 *  the Ruaj pill on the right. Every other field already saved on tap, so the
 *  bar says "Ruhet automatikisht" until a typed draft is pending. */
const TaskPanelFooter: React.FC<TaskPanelFooterProps> = ({
  readOnly,
  isGuestMode,
  summary,
  dirty,
  onSave,
}) => (
  <div className="sticky bottom-0 z-20 flex shrink-0 items-center justify-between gap-3 border-t border-border bg-background/80 px-4 pb-[max(1.125rem,var(--safe-area-bottom))] pt-3.5 backdrop-blur-xl">
    <div className="min-w-0">
      {readOnly ? (
        <span className="flex items-center gap-1 text-[13px] text-amber-600 dark:text-amber-400">
          <Eye className="h-3.5 w-3.5" />
          {isGuestMode ? 'Vetëm shikimi + komente' : 'Roli juaj lejon vetëm shikim'}
        </span>
      ) : (
        <>
          <div className="truncate text-[13px] text-muted-foreground">{summary}</div>
          {!dirty && (
            <div className="mt-0.5 flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Ruhet automatikisht
            </div>
          )}
        </>
      )}
    </div>
    {!readOnly && (
      <button
        type="button"
        onClick={onSave}
        className={`h-11 shrink-0 rounded-full px-7 text-[15px] font-bold transition-colors ${
          dirty
            ? 'bg-primary text-primary-foreground shadow-[0_8px_24px_-8px_rgba(18,70,140,.6)] hover:bg-primary/90'
            : 'border border-border bg-card text-foreground hover:bg-muted'
        }`}
      >
        {dirty ? 'Ruaj' : 'Mbyll'}
      </button>
    )}
  </div>
);

/** Delete confirmation (design): a centred card, title + sentence, Anulo | Fshi.
 *  Rendered by the panel as a SIBLING of its body (outside the body's
 *  click-to-close-pickers handler), exactly where it always was. */
export const TaskDeleteDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskTitle: string;
  onConfirm: () => void;
}> = ({ open, onOpenChange, taskTitle, onConfirm }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="w-[calc(100%-48px)] max-w-[300px] gap-0 overflow-hidden rounded-[18px] border-0 p-0 text-center shadow-[0_18px_48px_rgba(12,27,51,.18)] [&>button]:hidden">
      <div className="flex flex-col gap-1.5 px-5 pb-[18px] pt-[22px]">
        <DialogTitle className="text-[18px] font-bold tracking-tight text-foreground">Të fshihet detyra?</DialogTitle>
        <p className="text-[14px] text-foreground/80">
          “{taskTitle}” do të hiqet për të gjithë anëtarët e projektit.
        </p>
      </div>
      <div className="grid grid-cols-2 border-t border-border">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="h-12 border-r border-border text-[16px] font-semibold text-foreground transition-colors hover:bg-muted"
        >
          Anulo
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="h-12 text-[16px] font-bold text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
        >
          Fshi
        </button>
      </div>
    </DialogContent>
  </Dialog>
);

export default TaskPanelFooter;
