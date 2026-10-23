import React, { useRef, useState } from 'react';
import { Cloud, Download, FileText, Loader2, Paperclip, Upload, X } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useGoogleApi, DriveFile } from '../../../contexts/GoogleApiContext';
import { useFileUpload } from '../../../hooks/useFileUpload';
import { batchLabel } from '../../../lib/uploadQueue';
import { toast } from '../../../hooks/use-toast';
import GoogleDrivePicker from '../../GoogleDrivePicker';
import { Button } from '../../ui/button';
import type { Task } from '../../../types';

/** "Materiale" — uploads (VPS, 3 in parallel), Google Drive links, list. */
const TaskAttachmentsSection: React.FC<{
  task: Task;
  readOnly: boolean;
  onUpdate: (id: string, data: any) => Promise<any>;
}> = ({ task, readOnly, onUpdate }) => {
  const { user } = useAuth();
  const { isConnected: isGoogleConnected } = useGoogleApi();
  // Separate instance for materials so its "3/20" counter is not shared with comment images.
  const { uploadMany: uploadManyAttachments, uploading: attachmentsUploading, batch: attachmentsBatch } = useFileUpload();
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse attachments from JSON
  const attachments = React.useMemo(() => {
    if (!task.attachments) return [];
    try {
      return JSON.parse(task.attachments);
    } catch (e) {
      console.error('Corrupted attachments JSON for task', task.id, e);
      return [];
    }
  }, [task.attachments]);

  // Materials: images, PDF and office docs (both Office generations), max 15 MB
  // each. Must stay a subset of the VPS ALLOWED_UPLOAD filter (vps/server.ts) —
  // the server is the real gate.
  const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
  const isAllowedMaterial = (f: File) =>
    f.type.startsWith('image/')
    || f.type === 'application/pdf'
    || f.type.includes('officedocument')
    || f.type === 'application/msword'
    || f.type === 'application/vnd.ms-excel'
    || f.type === 'application/vnd.ms-powerpoint'
    || f.type === 'text/plain'
    || f.type === 'text/csv'
    // Some browsers report an empty mime for odd registrations — trust the extension.
    || (!f.type && /\.(docx?|xlsx?|pptx?|pdf|txt|csv|heic|heif)$/i.test(f.name));

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const picked = Array.from(files);
    const valid = picked.filter(f => isAllowedMaterial(f) && f.size <= MAX_ATTACHMENT_BYTES);
    if (valid.length < picked.length) {
      toast({
        title: 'Skedar i papranuar',
        description: 'Lejohen imazhe, PDF, Word, Excel, PowerPoint, TXT ose CSV, deri në 15 MB secili.',
        variant: 'destructive',
      });
    }
    if (valid.length === 0) { e.target.value = ''; return; }

    try {
      // Up to 3 in parallel; a failed file never discards the ones that made it —
      // the old loop threw on the first failure and attached NOTHING, leaving the
      // already-uploaded files orphaned on the server.
      const { ok, failed } = await uploadManyAttachments(valid, 'task-attachments');
      if (ok.length) {
        const added = ok.map(({ file, result }) => ({
          name: result.name || file.name,
          size: result.size ?? file.size,
          type: result.type || file.type,
          url: result.url,
          uploadedBy: user?.uid,
          uploadedAt: new Date().toISOString(),
        }));
        await onUpdate(task.id, { attachments: JSON.stringify([...attachments, ...added]) });
      }
      if (failed.length) {
        toast({
          title: ok.length ? `${ok.length} u ngarkuan, ${failed.length} dështuan` : 'Ngarkimi i skedarit dështoi',
          description: failed.slice(0, 3).map(f => `${f.file.name}: ${f.error.message}`).join(' · ')
            + (failed.length > 3 ? ` … +${failed.length - 3}` : ''),
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      toast({ title: 'Materialet nuk u ruajtën', description: err?.message, variant: 'destructive' });
    } finally {
      e.target.value = '';
    }
  };

  const handleRemoveAttachment = async (index: number) => {
    const removed = attachments[index];
    if (removed?.url?.startsWith('blob:')) {
      URL.revokeObjectURL(removed.url);
    }
    const newAttachments = attachments.filter((_: any, i: number) => i !== index);
    await onUpdate(task.id, { attachments: JSON.stringify(newAttachments) });
  };

  const handleDriveFileSelect = async (file: DriveFile) => {
    const newAttachments = [...attachments, {
      name: file.name,
      size: file.size ? parseInt(file.size, 10) : 0,
      type: file.mimeType,
      url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      source: 'google-drive',
      driveFileId: file.id,
      uploadedBy: user?.uid,
      uploadedAt: new Date().toISOString(),
    }];
    await onUpdate(task.id, { attachments: JSON.stringify(newAttachments) });
    setShowDrivePicker(false);
  };

  return (
    <div className="overflow-hidden rounded-[18px] border border-border bg-card px-4 py-3.5 shadow-[0_1px_2px_rgba(12,27,51,0.06)]">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground flex items-center gap-2">
          <Paperclip className="w-4 h-4" />
          Materiale ({attachments.length})
        </h4>
        {!readOnly && (
          <div className="flex gap-1">
            {isGoogleConnected && (
              <Button variant="ghost" size="sm" onClick={() => setShowDrivePicker(true)} title="Google Drive">
                <Cloud className="w-4 h-4" />
              </Button>
            )}
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()} disabled={attachmentsUploading} title="Bashkëngjit material (imazh, PDF, Word, Excel…) — mund të zgjidhni disa njëherësh" aria-label="Bashkëngjit material (imazh, PDF, Word, Excel…)">
              {attachmentsUploading ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> : <Upload className="w-4 h-4" />}
              <span className="hidden sm:inline text-xs" aria-live="polite">{batchLabel(attachmentsBatch) ?? (attachmentsUploading ? 'Po ngarkohet…' : 'Shto material')}</span>
            </Button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
          className="hidden"
          onChange={handleFileUpload}
        />
      </div>

      {/* Google Drive Picker Dialog */}
      <GoogleDrivePicker
        open={showDrivePicker}
        onOpenChange={setShowDrivePicker}
        onSelect={handleDriveFileSelect}
      />
  
      {attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map((file: any, index: number) => {
            const isImage = typeof file.type === 'string'
              ? file.type.startsWith('image/')
              : /\.(png|jpe?g|gif|webp|bmp)(\?.*)?$/i.test(file.url || '');
            const isPdf = file.type === 'application/pdf' || /\.pdf(\?.*)?$/i.test(file.url || '');
            const sizeLabel = file.size
              ? (file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`)
              : '';
            return (
              <div key={index} className="flex items-center justify-between gap-2 p-2 bg-muted/50 rounded text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  {isImage && file.url ? (
                    <a href={file.url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                      <img src={file.url} alt={file.name} loading="lazy" className="w-10 h-10 rounded object-cover border border-border/40" />
                    </a>
                  ) : (
                    <span className={`w-8 h-8 rounded flex items-center justify-center flex-shrink-0 ${isPdf ? 'bg-red-500/10 text-red-600' : 'bg-muted text-muted-foreground'}`}>
                      {file.source === 'google-drive' ? <Cloud className="w-4 h-4 text-blue-500" /> : isPdf ? <FileText className="w-4 h-4" /> : <Paperclip className="w-4 h-4" />}
                    </span>
                  )}
                  <div className="min-w-0">
                    {file.url ? (
                      <a href={file.url} target="_blank" rel="noopener noreferrer" className="block truncate text-blue-600 hover:underline">{file.name}</a>
                    ) : (
                      <span className="block truncate">{file.name}</span>
                    )}
                    {sizeLabel && <span className="text-[11px] text-muted-foreground">{sizeLabel}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  {file.url && (
                    <a href={file.url} download={file.name} target="_blank" rel="noopener noreferrer" title="Shkarko" aria-label={`Shkarko ${file.name}`} className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground">
                      <Download className="w-3 h-3" />
                    </a>
                  )}
                  {!readOnly && (
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Hiq materialin" aria-label={`Hiq ${file.name}`} onClick={() => handleRemoveAttachment(index)}>
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TaskAttachmentsSection;
