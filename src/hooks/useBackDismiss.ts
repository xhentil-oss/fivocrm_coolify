import { useEffect, useRef } from 'react';

/**
 * Makes an overlay (drawer / bottom sheet) dismissable with Back.
 *
 * A drawer that lives only in React state is invisible to history: pressing
 * Back — the Android hardware button, the browser arrow, or a swipe — pops the
 * page BEHIND it, so opening a task inside a project and going back threw the
 * user out to the dashboard instead of back to the task list.
 *
 * Opening the overlay therefore pushes one sentinel history entry at the SAME
 * url. Back consumes that entry (popstate) and we close the overlay; closing it
 * from the UI consumes the entry itself, so Back never needs two presses.
 *
 * @param open      is the overlay on screen
 * @param onDismiss close it (called on Back only, never on a UI close)
 */
export function useBackDismiss(open: boolean, onDismiss: () => void) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;

    // Where we were when the overlay opened. If the user navigated away with it
    // still open, the sentinel is no longer the top entry and popping it would
    // yank them back to this page.
    const origin = window.location.pathname + window.location.search;
    let sentinel = true;

    window.history.pushState({ ...window.history.state, overlay: true }, '');

    const onPop = () => {
      sentinel = false; // Back already consumed it
      dismissRef.current();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      const here = window.location.pathname + window.location.search;
      if (sentinel && here === origin) window.history.back();
    };
  }, [open]);
}

export default useBackDismiss;
