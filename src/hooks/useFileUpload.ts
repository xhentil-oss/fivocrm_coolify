import { useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getGlobalTeamId } from './useFirestore';
import { trustedFileHost } from '../lib/safeUrl';
import { runLimited, heicToJpegIfPossible } from '../lib/uploadQueue';

/** Parallel uploads per batch — enough to hide latency, gentle on the VPS. */
export const UPLOAD_CONCURRENCY = 3;

// Deployment-wide file host (shared across all of the owner's teams). Used as the
// final fallback so image/file uploads work in EVERY channel/DM for EVERY member,
// even when their active team hasn't configured (or synced) a VPS URL. Vite bakes
// VITE_VPS_URL at build time, so a hardcoded default is what guarantees it works in
// production regardless of per-team settings. Must be HTTPS (page is served over
// HTTPS — an http:// host would be blocked as mixed content).
const DEFAULT_VPS_FILE_URL = 'https://vps.fivocrm.com';

export interface UploadResult {
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
  // Several uploads may be in flight at once (multi-select). `uploading` is true
  // while ANY of them runs — a per-call true/false would flip off mid-batch.
  const inFlight = useRef(0);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);

  const upload = useCallback(async (picked: File, folder = 'uploads'): Promise<UploadResult> => {
    if (!user) throw new Error('Not authenticated');
    // HEIC (iPhone photos copied to a computer) renders only in Safari — re-encode
    // to JPEG where the browser can decode it; otherwise upload the original.
    const file = await heicToJpegIfPossible(picked);
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

    inFlight.current += 1;
    setUploading(true);
    setProgress(0);
    setError(null);
    const finish = () => { inFlight.current = Math.max(0, inFlight.current - 1); if (inFlight.current === 0) setUploading(false); };

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

      finish();
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
      finish();
      throw err;
    }
  }, [user]);

  /**
   * Multi-select upload: one promise per file, in the order picked, at most
   * UPLOAD_CONCURRENCY at once. A failed file rejects ITS promise only — callers
   * keep the rest. `batch` drives the "Po ngarkohet 3/20" label.
   */
  const uploadEach = useCallback((files: File[], folder = 'uploads'): Promise<UploadResult>[] => {
    if (files.length === 0) return [];
    let done = 0;
    setBatch({ done: 0, total: files.length });
    const promises = runLimited(files, UPLOAD_CONCURRENCY, (f) => upload(f, folder).finally(() => {
      done += 1;
      setBatch(done >= files.length ? null : { done, total: files.length });
    }));
    // Never leave an unhandled rejection behind — the caller reads each promise.
    promises.forEach((p) => p.catch(() => {}));
    return promises;
  }, [upload]);

  /** Same as uploadEach, settled: `{ ok, failed }` both in the order picked. */
  const uploadMany = useCallback(async (files: File[], folder = 'uploads') => {
    const settled = await Promise.allSettled(uploadEach(files, folder));
    const ok: Array<{ file: File; result: UploadResult }> = [];
    const failed: Array<{ file: File; error: Error }> = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') ok.push({ file: files[i], result: r.value });
      else failed.push({ file: files[i], error: r.reason instanceof Error ? r.reason : new Error(String(r.reason)) });
    });
    return { ok, failed };
  }, [uploadEach]);

  return { upload, uploadEach, uploadMany, uploading, progress, error, batch };
}
