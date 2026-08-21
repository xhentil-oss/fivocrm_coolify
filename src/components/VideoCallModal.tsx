import React, { useEffect, useRef } from 'react';
import DailyIframe, { type DailyCall } from '@daily-co/daily-js';
import { X } from 'lucide-react';

/**
 * Full-screen Daily Prebuilt video call. Daily allows only one call frame at a
 * time, so we destroy any existing instance before creating ours.
 */
const VideoCallModal: React.FC<{ roomUrl: string; userName?: string; onClose: () => void }> = ({ roomUrl, userName, onClose }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<DailyCall | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { await DailyIframe.getCallInstance()?.destroy(); } catch { /* none */ }
      if (cancelled || !wrapRef.current) return;
      const frame = DailyIframe.createFrame(wrapRef.current, {
        showLeaveButton: true,
        iframeStyle: { width: '100%', height: '100%', border: '0' },
      });
      callRef.current = frame;
      frame.on('left-meeting', onClose);
      try {
        await frame.join({ url: roomUrl, userName: userName || 'Përdorues' });
      } catch { /* join error surfaced inside the iframe */ }
    })();
    return () => {
      cancelled = true;
      callRef.current?.destroy().catch(() => {});
      callRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomUrl]);

  return (
    <div className="fixed inset-0 z-[100] bg-black">
      <button
        onClick={onClose}
        className="absolute right-3 z-10 bg-black/60 hover:bg-black/80 text-white rounded-full p-2"
        style={{ top: 'max(12px, var(--safe-area-top))' }}
        aria-label="Mbyll thirrjen"
      >
        <X className="w-5 h-5" />
      </button>
      <div ref={wrapRef} className="w-full h-full" />
    </div>
  );
};

export default VideoCallModal;
