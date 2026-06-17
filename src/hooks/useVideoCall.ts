import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './use-toast';

/**
 * Resolves a Daily room URL (create-or-get via /api/daily-room) and tracks the
 * active call so a consumer can render <VideoCallModal>. The room name is
 * deterministic per conversation, so both sides land in the same call.
 */
export function useVideoCall() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const start = useCallback(async (roomName: string): Promise<string | null> => {
    if (!user) return null;
    setStarting(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/daily-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: roomName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        toast({ title: 'Video call', description: data.detail || data.error || 'Nuk u krijua dot thirrja.', variant: 'destructive' });
        return null;
      }
      setRoomUrl(data.url);
      return data.url as string;
    } catch (err) {
      toast({ title: 'Video call', description: (err as Error)?.message || 'Gabim rrjeti.', variant: 'destructive' });
      return null;
    } finally {
      setStarting(false);
    }
  }, [user, toast]);

  const close = useCallback(() => setRoomUrl(null), []);

  return { roomUrl, starting, start, close };
}
