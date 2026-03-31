import { useState, useCallback } from 'react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { getGlobalTeamId } from './useFirestore';

interface UploadResult {
  url: string;
  path: string;
  name: string;
  size: number;
  type: string;
}

export function useFileUpload() {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  const upload = useCallback(async (file: File, folder = 'uploads'): Promise<UploadResult> => {
    if (!user) throw new Error('Not authenticated');
    const teamId = getGlobalTeamId() || 'shared';
    const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = `${teamId}/${folder}/${safeName}`;
    const storageRef = ref(storage, storagePath);

    setUploading(true);
    setProgress(0);
    setError(null);

    return new Promise((resolve, reject) => {
      const task = uploadBytesResumable(storageRef, file, {
        customMetadata: { uploadedBy: user.uid },
      });

      task.on(
        'state_changed',
        (snapshot) => {
          setProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
        },
        (err) => {
          setError(err);
          setUploading(false);
          reject(err);
        },
        async () => {
          const url = await getDownloadURL(task.snapshot.ref);
          setUploading(false);
          setProgress(100);
          resolve({ url, path: storagePath, name: file.name, size: file.size, type: file.type });
        }
      );
    });
  }, [user]);

  return { upload, uploading, progress, error };
}
