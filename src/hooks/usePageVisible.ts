import { useEffect, useState } from 'react';

/** True while the tab is visible — "Parë" receipts are written only then. */
export function usePageVisible(): boolean {
  const read = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  const [visible, setVisible] = useState(read);
  useEffect(() => {
    const on = () => setVisible(read());
    document.addEventListener('visibilitychange', on);
    window.addEventListener('focus', on);
    return () => {
      document.removeEventListener('visibilitychange', on);
      window.removeEventListener('focus', on);
    };
  }, []);
  return visible;
}
