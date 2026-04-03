import { useRef, useState, useCallback } from 'react';

/**
 * Tracks unsaved form changes and manages a discard-confirmation dialog.
 *
 * Usage:
 *   const { setDirty, isDirtyRef, discardOpen, requestClose, confirmDiscard, cancelDiscard } = useUnsavedChanges();
 *
 *   - Pass `setDirty` (or a wrapper) to the form via an `onDirtyChange` prop.
 *   - Call `requestClose(closeFn)` instead of calling closeFn directly (e.g. in onOpenChange, cancel button).
 *   - Render the AlertDialog controlled by `discardOpen` / `confirmDiscard` / `cancelDiscard`.
 *   - Access `isDirtyRef.current` in DialogContent's onInteractOutside / onEscapeKeyDown.
 */
export function useUnsavedChanges() {
  const isDirtyRef = useRef(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const discardFnRef = useRef<() => void>(() => {});

  const setDirty = useCallback((dirty: boolean) => {
    isDirtyRef.current = dirty;
  }, []);

  const requestClose = useCallback((closeFn: () => void) => {
    if (isDirtyRef.current) {
      discardFnRef.current = closeFn;
      setDiscardOpen(true);
    } else {
      closeFn();
    }
  }, []);

  const confirmDiscard = useCallback(() => {
    isDirtyRef.current = false;
    setDiscardOpen(false);
    discardFnRef.current();
  }, []);

  const cancelDiscard = useCallback(() => {
    setDiscardOpen(false);
  }, []);

  return { setDirty, isDirtyRef, discardOpen, requestClose, confirmDiscard, cancelDiscard };
}
