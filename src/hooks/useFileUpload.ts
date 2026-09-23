import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getGlobalTeamId } from './useFirestore';
import { trustedFileHost } from '../lib/safeUrl';

// Deployment-wide file host (shared across all of the owner's teams). Used as the
// final fallback so image/file uploads work in EVERY channel/DM for EVERY member,
// even when their active team hasn't configured (or synced) a VPS URL. Vite bakes
// VITE_VPS_URL at build time, so a hardcoded default is what guarantees it works in
// production regardless of per-team settings. Must be HTTPS (page is served over
// HTTPS — an http:// host would be blocked as mixed content).
const DEFAULT_VPS_FILE_URL = 'https://vps.fivocrm.com';

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
    // VPS URL resolution, in priority order:
    //  1. active team's synced URL (localStorage, from teamSettings) — honoured ONLY
    //     when it is one of OUR hosts (`trustedFileHost`: https + *.fivocrm.com). The
    //     request below carries the user's Firebase ID token, and `teamSettings` is
    //     tenant-editable: without the allow-list any team admin could point every
    //     member's token at a server they control.
    //  2. deployment-wide VITE_VPS_URL env (baked at build time)
    //  3. hardcoded shared file host — guarantees uploads work for every member
    //     in every channel/DM, even with no team-specific config.
    let teamVpsRaw = '';
    try { teamVpsRaw = localStorage.getItem('whatsapp_vps_url') || ''; } catch { /* private mode */ }
    const teamVps = trustedFileHost(teamVpsRaw);
    const envVps = ((import.meta.env.VITE_VPS_URL as string | undefined) || '').trim().replace(/\/$/, '');
    // Ignore an http:// env URL on an https page — it would be blocked as mixed
    // content; fall through to the https default instead.
    const isSecure = (u: string) => /^https:\/\//i.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(u);
    const vpsUrl = teamVps || (isSecure(envVps) && envVps) || DEFAULT_VPS_FILE_URL;
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
      // If we reached the VPS over HTTPS but it returned an http:// file URL
      // (PUBLIC_URL unset / no trust-proxy), upgrade it — the page is HTTPS, so an
      // http URL would fail mixed-content and the chat's https-only send guard.
      if (/^https:\/\//i.test(vpsUrl) && /^http:\/\//i.test(result.url)) {
        result.url = result.url.replace(/^http:\/\//i, 'https://');
      }
      return result;
    } catch (err) {
      setError(err as Error);
      setUploading(false);
      throw err;
    }
  }, [user]);

  return { upload, uploading, progress, error };
}
