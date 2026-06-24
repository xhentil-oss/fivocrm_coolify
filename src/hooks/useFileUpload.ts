import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getGlobalTeamId } from './useFirestore';

interface UploadResult {
  url: string;
  path: string;
  name: string;
  size: number;
  type: string;
}

// Uploads go to the self-hosted VPS (POST {vpsUrl}/upload) instead of Firebase
// Storage. The VPS verifies the Firebase ID token, stores the file on disk, and
// serves it publicly under /files. VPS URL comes from team settings
// (whatsapp_vps_url, synced to localStorage by useTeamSettingsSync).
export function useFileUpload() {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  const upload = useCallback(async (file: File, folder = 'uploads'): Promise<UploadResult> => {
    if (!user) throw new Error('Not authenticated');
    // Prefer the team-specific VPS URL (synced from teamSettings), but fall back
    // to a deployment-wide VITE_VPS_URL so uploads work for every team/member even
    // when a team's settings haven't been populated/synced to this browser yet.
    const teamVps = (localStorage.getItem('whatsapp_vps_url') || '').replace(/\/$/, '');
    const envVps = ((import.meta.env.VITE_VPS_URL as string | undefined) || '').replace(/\/$/, '');
    const vpsUrl = teamVps || envVps;
    if (!vpsUrl) {
      throw new Error('Serveri i skedarëve (VPS) nuk është konfiguruar. Shtoje te Cilësimet → WhatsApp.');
    }
    const teamId = getGlobalTeamId() || 'shared';

    setUploading(true);
    setProgress(0);
    setError(null);

    try {
      const token = await user.getIdToken();
      const form = new FormData();
      form.append('teamId', teamId);
      form.append('folder', folder);
      form.append('file', file);

      const result = await new Promise<UploadResult>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${vpsUrl}/upload`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText) as UploadResult); }
            catch { reject(new Error('Përgjigje e pavlefshme nga serveri')); }
          } else {
            let msg = `Ngarkimi dështoi (${xhr.status})`;
            try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* ignore */ }
            reject(new Error(msg));
          }
        };
        xhr.onerror = () => reject(new Error('Lidhja me serverin e skedarëve dështoi'));
        xhr.send(form);
      });

      setUploading(false);
      setProgress(100);
      return result;
    } catch (err) {
      setError(err as Error);
      setUploading(false);
      throw err;
    }
  }, [user]);

  return { upload, uploading, progress, error };
}
