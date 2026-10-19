import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A callback whose IDENTITY never changes but which always runs the latest
 * render's closure. Lets memoized children (task rows/cards) receive handlers
 * that read current state without re-rendering every time that state changes.
 * Only for event handlers — never call the result during render.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  return useCallback((...args: A) => ref.current(...args), []);
}
