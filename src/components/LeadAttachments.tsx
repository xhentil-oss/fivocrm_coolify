import React, { useRef, useState } from 'react';
import { Paperclip, X, FileText, FileSpreadsheet, Image as ImageIcon, File as FileIcon, Download, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { useFileUpload } from '../hooks/useFileUpload';
import { useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/use-toast';
import { safeExternalUrl } from '../lib/safeUrl';
import { batchLabel } from '../lib/uploadQueue';
import type { Lead, LeadActivity, FileAttachment } from '../types';

// What the CRM lets you attach. Must stay a subset of the VPS ALLOWED_UPLOAD
// filter (vps/server.ts) — the server is the real gate, this only drives the
// file picker.
export const CRM_UPLOAD_ACCEPT = [
  'image/*',
  'application/pdf',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.csv',
].join(',');

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // mirrors the VPS multer limit

export function formatBytes(size?: number): string {
  if (!size || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(att: FileAttachment): React.ReactNode {
  const t = att.type || '';
  const n = (att.name || '').toLowerCase();
  if (t.startsWith('image/')) return <ImageIcon className="w-3.5 h-3.5 shrink-0" />;
  if (t.includes('spreadsheet') || t.includes('ms-excel') || /\.(xlsx?|csv)$/.test(n)) return <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />;
  if (t.includes('pdf') || t.includes('word') || t.includes('presentation') || /\.(docx?|pdf|pptx?|txt)$/.test(n)) return <FileText className="w-3.5 h-3.5 shrink-0" />;
  return <FileIcon className="w-3.5 h-3.5 shrink-0" />;
}

/** Compact chip list for attachments (timeline entries, composer pending list). */
export const AttachmentChips: React.FC<{
  attachments: FileAttachment[];
  onRemove?: (index: number) => void;
}> = ({ attachments, onRemove }) => {
  if (!attachments.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {attachments.map((att, i) => (
        <span
          key={`${att.url}-${i}`}
          className="inline-flex items-center gap-1.5 max-w-full pl-2 pr-1 py-1 rounded-md border border-border bg-muted/40 text-xs text-foreground"
        >
          {iconFor(att)}
          <a
            href={safeExternalUrl(att.url) ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate max-w-[180px] hover:underline"
            title={att.name}
          >
            {att.name}
          </a>
          {att.size ? <span className="text-muted-foreground shrink-0">{formatBytes(att.size)}</span> : null}
          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
              aria-label={`Hiq ${att.name}`}
            >
              <X className="w-3 h-3" />
            </button>
          ) : (
            <a
              href={safeExternalUrl(att.url) ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              download={att.name}
              className="p-0.5 rounded hover:bg-muted text-muted-foreground"
              aria-label={`Shkarko ${att.name}`}
            >
              <Download className="w-3 h-3" />
            </a>
          )}
        </span>
      ))}
    </div>
  );
};

/** Hidden file input + paperclip trigger; uploads to the VPS and reports results. */
export const AttachmentPickerButton: React.FC<{
  onUploaded: (atts: FileAttachment[]) => void;
  folder?: string;
  disabled?: boolean;
  className?: string;
  label?: string;
}> = ({ onUploaded, folder = 'crm', disabled, className, label }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadMany, uploading, batch } = useFileUpload();
  const { toast } = useToast();

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    const tooBig = picked.filter(f => f.size > MAX_UPLOAD_BYTES);
    if (tooBig.length) {
      toast({ title: 'Skedar shumë i madh', description: `${tooBig.map(f => f.name).slice(0, 3).join(', ')}${tooBig.length > 3 ? ` … +${tooBig.length - 3}` : ''} kalon 15 MB.`, variant: 'destructive' });
    }
    // Up to 3 in parallel; the ones that made it are saved even when some fail.
    const { ok, failed } = await uploadMany(picked.filter(f => f.size <= MAX_UPLOAD_BYTES), folder);
    if (failed.length) {
      toast({
        title: ok.length ? `${ok.length} u ngarkuan, ${failed.length} dështuan` : 'Ngarkimi dështoi',
        description: failed.slice(0, 3).map(f => `${f.file.name}: ${f.error.message}`).join(' · ') + (failed.length > 3 ? ` … +${failed.length - 3}` : ''),
        variant: 'destructive',
      });
    }
    const done: FileAttachment[] = ok.map(({ file, result: res }) => ({ url: res.url, name: res.name || file.name, size: res.size ?? file.size, type: res.type || file.type || '' }));
    if (done.length) onUploaded(done);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={CRM_UPLOAD_ACCEPT}
        className="hidden"
        onChange={(e) => { void handleFiles(e.target.files); e.target.value = ''; }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className}
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        title="Bashkëngjit dokumente ose foto (mund të zgjidhni disa njëherësh)"
      >
        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
        {batchLabel(batch)
          ? <span className="ml-1.5 tabular-nums" aria-live="polite">{batchLabel(batch)}</span>
          : label ? <span className="ml-1.5">{label}</span> : null}
      </Button>
    </>
  );
};

/**
 * "Dokumente" tab in the lead drawer: the lead's own attachment list.
 * Self-contained (seeds from the lead snapshot, then owns its state) because
 * the drawer's `selectedLead` is a snapshot that does not live-sync.
 */
export const LeadDocumentsPanel: React.FC<{ lead: Lead; canEdit: boolean }> = ({ lead, canEdit }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const leadMutation = useMutation<Lead>('leads');
  const activityMutation = useMutation<LeadActivity>('leadActivities');
  const [attachments, setAttachments] = useState<FileAttachment[]>(lead.attachments || []);
  const [saving, setSaving] = useState(false);

  const persist = async (next: FileAttachment[], logTitle?: string, logBody?: string) => {
    setSaving(true);
    try {
      await leadMutation.update(lead.id, { attachments: next } as Partial<Lead>);
      setAttachments(next);
      if (logTitle) {
        // Timeline entry so the upload shows up in "Aktiviteti" too (non-critical).
        try {
          await activityMutation.create({
            leadId: lead.id,
            type: 'note',
            title: logTitle,
            body: logBody || undefined,
            userId: user?.uid ?? null,
            userName: user?.displayName || user?.email || undefined,
          } as any);
        } catch { /* non-critical */ }
      }
    } catch (err) {
      toast({
        title: 'Ruajtja dështoi',
        description: err instanceof Error ? err.message : 'gabim i panjohur',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Dokumente ({attachments.length})</p>
        <AttachmentPickerButton
          label="Ngarko"
          disabled={saving}
          onUploaded={(atts) => {
            const next = [...attachments, ...atts];
            void persist(
              next,
              atts.length === 1 ? `Dokument u ngarkua: ${atts[0].name}` : `${atts.length} dokumente u ngarkuan`,
              atts.map(a => a.name).join(', ')
            );
          }}
        />
      </div>

      {attachments.length === 0 ? (
        <div className="text-center py-8 space-y-2">
          <Paperclip className="w-8 h-8 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            Asnjë dokument. Ngarko PDF, Word, Excel, PowerPoint, CSV ose imazhe (deri 15 MB).
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {attachments.map((att, i) => (
            <div key={`${att.url}-${i}`} className="flex items-center gap-2 p-2.5 rounded-lg border bg-muted/30 text-sm min-w-0">
              {iconFor(att)}
              <div className="flex-1 min-w-0">
                <a
                  href={safeExternalUrl(att.url) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate font-medium hover:underline"
                  title={att.name}
                >
                  {att.name}
                </a>
                {att.size ? <p className="text-xs text-muted-foreground">{formatBytes(att.size)}</p> : null}
              </div>
              <a
                href={safeExternalUrl(att.url) ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                download={att.name}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                aria-label={`Shkarko ${att.name}`}
              >
                <Download className="w-4 h-4" />
              </a>
              {canEdit && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    const next = attachments.filter((_, idx) => idx !== i);
                    void persist(next, `Dokument u hoq: ${att.name}`);
                  }}
                  className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                  aria-label={`Hiq ${att.name}`}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
