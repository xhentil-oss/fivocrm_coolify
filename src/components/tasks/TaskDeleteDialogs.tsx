import React from 'react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

/** Single-task delete confirmation (row menu → "Fshi"). */
export const TaskDeleteConfirmDialog: React.FC<{
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}> = ({ open, onCancel, onConfirm }) => (
  <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
    <DialogContent className="max-w-sm">
      <DialogHeader><DialogTitle>Fshi Detyrën</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">
        A jeni i sigurt që doni të fshini këtë detyrë? Ky veprim nuk mund të zhbëhet.
      </p>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>Anulo</Button>
        <Button variant="destructive" onClick={onConfirm}>Fshi, jam i sigurt</Button>
      </div>
    </DialogContent>
  </Dialog>
);

/** Bulk delete confirmation — only the rows the user may delete are deleted. */
export const TaskBulkDeleteDialog: React.FC<{
  open: boolean;
  deleting: boolean;
  allowedCount: number;
  skipped: number;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}> = ({ open, deleting, allowedCount, skipped, onClose, onConfirm }) => (
  <Dialog open={open} onOpenChange={(o) => { if (!o && !deleting) onClose(); }}>
    <DialogContent className="max-w-sm">
      <DialogHeader><DialogTitle>Fshi {allowedCount} detyra</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">
        {allowedCount > 0
          ? `A jeni i sigurt që doni të fshini ${allowedCount} detyra (bashkë me nën-detyrat dhe komentet e tyre)? Ky veprim nuk mund të zhbëhet.`
          : 'Nuk keni të drejtë të fshini asnjë nga detyrat e zgjedhura.'}
      </p>
      {skipped > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {skipped} nga të zgjedhurat do të anashkalohen — mund t'i fshijë vetëm krijuesi, i caktuari ose një menaxher.
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" disabled={deleting} onClick={onClose}>Anulo</Button>
        {allowedCount > 0 && (
          <Button variant="destructive" disabled={deleting} onClick={onConfirm}>
            {deleting ? 'Duke fshirë…' : 'Fshi, jam i sigurt'}
          </Button>
        )}
      </div>
    </DialogContent>
  </Dialog>
);
