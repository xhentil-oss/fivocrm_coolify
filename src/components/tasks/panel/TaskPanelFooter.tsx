import React from 'react';
import { Eye, Trash2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../ui/dialog';

interface TaskPanelFooterProps {
  readOnly: boolean;
  isGuestMode: boolean;
  /** Manager rank or owning the task (creator/assignee), never read-only. */
  canDelete: boolean;
  summary: string;
  onSave: () => void | Promise<void>;
  /** Opens the panel's delete confirmation (TaskDeleteDialog). */
  onRequestDelete: () => void;
}

/** Footer: Fshi · përmbledhja · Ruaj (design) + the delete confirmation. */
const TaskPanelFooter: React.FC<TaskPanelFooterProps> = ({
  readOnly,
  isGuestMode,
  canDelete,
  summary,
  onSave,
  onRequestDelete,
}) => (
  <div className="flex items-center gap-2.5 border-t bg-muted/30 px-4 py-3 pb-[max(0.75rem,var(--safe-area-bottom))] sm:px-6 sm:py-3.5">
    {/* Delete: manager rank or owning the task (creator/assignee) — the
        rules accept any member's delete, so the UI must not offer more
        than the role is meant to have. */}
    {canDelete && (
      <button
        type="button"
        onClick={onRequestDelete}
        className="flex items-center gap-1.5 text-[12.5px] font-bold text-red-600 transition-colors hover:text-red-700"
      >
        <Trash2 className="h-3.5 w-3.5" /> Fshi
      </button>
    )}
    {readOnly && (
      <span className="flex items-center gap-1 text-xs text-amber-600">
        <Eye className="h-3 w-3" />
        {isGuestMode ? 'Vetëm shikimi + komente' : 'Roli juaj lejon vetëm shikim'}
      </span>
    )}
    <span className="flex-1" />
    <span className="hidden text-[11.5px] text-muted-foreground sm:block">{summary}</span>
    {!readOnly && (
      <Button size="sm" className="rounded-[10px] text-[13px] font-extrabold" onClick={onSave}>
        ✓ Ruaj ndryshimet
      </Button>
    )}
  </div>
);

/** Delete confirmation — rendered by the panel as a SIBLING of its body (outside
 *  the body's click-to-close-pickers handler), exactly where it always was. */
export const TaskDeleteDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskTitle: string;
  onConfirm: () => void;
}> = ({ open, onOpenChange, taskTitle, onConfirm }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-sm">
      <DialogHeader><DialogTitle>Fshi Detyrën</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">Je i sigurt që dëshiron të fshish detyrën <span className="font-semibold text-foreground">"{taskTitle}"</span>? Ky veprim nuk mund të zhbëhet.</p>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={() => onOpenChange(false)}>Anulo</Button>
        <Button variant="destructive" onClick={onConfirm}>Fshi</Button>
      </div>
    </DialogContent>
  </Dialog>
);

export default TaskPanelFooter;
