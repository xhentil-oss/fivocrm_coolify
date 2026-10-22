import React, { useState, useMemo, useEffect } from 'react';
import { useCollection, useMutation, useGlobalTeamId } from '../hooks/useFirestore';
import { useTeamSettingsData } from '../hooks/useTeamSettings';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/use-toast';
import { X, Plus, Trash2, FileText, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from './ui/alert-dialog';
import {
  LEAD_FIELD_OPTIONS,
  fillTemplateBody,
  countTemplateParams,
} from '../lib/whatsappTemplates';
import type { WhatsAppTemplate } from '../types';

// Pseudo-fields the campaign/automation sender resolves for a CONTACT (see
// CLAUDE.md "WhatsApp campaign automation": paramFields accepts these too).
const CONTACT_PSEUDO_FIELDS: { key: string; label: string }[] = [
  { key: 'firstName', label: 'Emri i parë' },
  { key: 'notes', label: 'Shënimet (përmbledhje)' },
  { key: 'service', label: 'Shërbimi' },
  { key: 'link', label: 'Linku' },
];

// Fields the invoice-reminder cron resolves for a template used by "Kujtesa
// faturash në WhatsApp" — same keys as the server (`invoiceWaTemplateParams`).
export const INVOICE_PARAM_FIELD_OPTIONS: { key: string; label: string }[] = [
  { key: 'invoiceNumber', label: 'Nr. fature' },
  { key: 'amount', label: 'Shuma' },
  { key: 'balanceDue', label: 'Mbetja' },
  { key: 'currency', label: 'Monedha' },
  { key: 'dueDate', label: 'Afati' },
  { key: 'daysLate', label: 'Ditë vonesë' },
  { key: 'customerName', label: 'Emri i klientit' },
  { key: 'companyName', label: 'Kompania jonë' },
  { key: 'paymentLink', label: 'Linku i pagesës' },
];
const INVOICE_KEYS = new Set(INVOICE_PARAM_FIELD_OPTIONS.map((o) => o.key));
const ALL_FIELD_OPTIONS = [...LEAD_FIELD_OPTIONS, ...CONTACT_PSEUDO_FIELDS, ...INVOICE_PARAM_FIELD_OPTIONS];

type MetaTemplateStatus = { name: string; language?: string; status?: string; category?: string; rejectedReason?: string | null };

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  APPROVED: { label: 'Aprovuar', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' },
  PENDING: { label: 'Në shqyrtim', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30' },
  IN_APPEAL: { label: 'Në apelim', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30' },
  REJECTED: { label: 'Refuzuar', className: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30' },
  PAUSED: { label: 'Pezulluar', className: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30' },
  DISABLED: { label: 'Çaktivizuar', className: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30' },
};

interface Props {
  onClose: () => void;
}

type Draft = Partial<WhatsAppTemplate>;

const emptyDraft: Draft = {
  name: '',
  metaTemplateName: '',
  language: 'sq',
  category: 'MARKETING',
  body: '',
  paramFields: [],
};

const WhatsappTemplateManager: React.FC<Props> = ({ onClose }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: templates } = useCollection<WhatsAppTemplate>('waTemplates', {
    orderBy: { field: 'name', direction: 'asc' },
  });
  const mutation = useMutation<WhatsAppTemplate>('waTemplates');
  const teamSettings = useTeamSettingsData();
  const teamId = useGlobalTeamId();

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<WhatsAppTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Meta's approval state per template (GET /api/whatsapp?action=template-status).
  // Best-effort: any failure leaves a small note, never an error toast.
  const [metaStatuses, setMetaStatuses] = useState<MetaTemplateStatus[] | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const metaOn = !!teamSettings?.metaEnabled;
  useEffect(() => {
    if (!user || !metaOn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/whatsapp?action=template-status${teamId ? `&teamId=${encodeURIComponent(teamId)}` : ''}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        // 409 not-configured = no Meta WABA to ask; that is not a failure worth a note.
        if (data?.code === 'not-configured') { setStatusFailed(false); return; }
        if (!res.ok || !Array.isArray(data?.templates)) { setStatusFailed(true); return; }
        setMetaStatuses(data.templates as MetaTemplateStatus[]);
        setStatusFailed(false);
      } catch {
        if (!cancelled) setStatusFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user, metaOn, teamId]);
  const statusFor = (t: Pick<WhatsAppTemplate, 'metaTemplateName' | 'language'>): MetaTemplateStatus | undefined => {
    if (!metaStatuses) return undefined;
    const name = (t.metaTemplateName || '').trim();
    const lang = (t.language || '').trim().toLowerCase();
    return metaStatuses.find((s) => s.name === name && (s.language || '').toLowerCase() === lang)
      || metaStatuses.find((s) => s.name === name);
  };
  const StatusBadge: React.FC<{ s?: MetaTemplateStatus; withReason?: boolean }> = ({ s, withReason }) => {
    if (!s?.status) return null;
    const st = STATUS_STYLE[s.status.toUpperCase()] || { label: s.status, className: 'bg-muted text-muted-foreground border-border' };
    return (
      <span className="inline-flex flex-col gap-0.5">
        <span className={`inline-flex w-fit items-center px-1.5 py-px rounded border text-[9px] font-medium ${st.className}`} title={s.rejectedReason || undefined}>
          {st.label}
        </span>
        {withReason && s.rejectedReason && s.rejectedReason !== 'NONE' && (
          <span className="text-[10px] text-red-700 dark:text-red-400">Arsyeja: {s.rejectedReason}</span>
        )}
      </span>
    );
  };

  // Is this template the one "Kujtesa faturash në WhatsApp" sends? Then its
  // variables are invoice fields (the cron fills them per invoice).
  const usedForInvoices = !!editingId && editingId === teamSettings?.waOverdueTemplateId;
  const showInvoiceFields = usedForInvoices || draft.category === 'UTILITY'
    || (draft.paramFields || []).some((f) => INVOICE_KEYS.has(f));

  const paramCount = useMemo(() => countTemplateParams(draft.body || ''), [draft.body]);

  // Keep paramFields length in sync with the placeholders in the body.
  const paramFields = useMemo(() => {
    const pf = [...(draft.paramFields || [])];
    pf.length = paramCount;
    for (let i = 0; i < paramCount; i++) if (!pf[i]) pf[i] = 'custom';
    return pf;
  }, [draft.paramFields, paramCount]);

  const previewParams = paramFields.map((f) => {
    const opt = ALL_FIELD_OPTIONS.find((o) => o.key === f);
    return f === 'custom' || !opt ? '____' : `[${opt.label}]`;
  });
  const preview = fillTemplateBody(draft.body || '', previewParams);

  const startEdit = (t: WhatsAppTemplate) => {
    setEditingId(t.id);
    setDraft({ ...t });
  };
  const startNew = () => {
    setEditingId(null);
    setDraft(emptyDraft);
  };

  const save = async () => {
    if (!draft.name?.trim() || !draft.metaTemplateName?.trim() || !draft.body?.trim()) {
      toast({ title: 'Mungojnë fushat', description: 'Emri, emri Meta dhe teksti janë të detyrueshëm.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: draft.name!.trim(),
        metaTemplateName: draft.metaTemplateName!.trim(),
        language: (draft.language || 'sq').trim(),
        category: draft.category || 'MARKETING',
        body: draft.body!.trim(),
        paramFields,
      };
      if (editingId) {
        await mutation.update(editingId, payload);
        toast({ title: 'Template u përditësua' });
      } else {
        await mutation.create({ ...payload, createdByUserId: user?.uid || null } as any);
        toast({ title: 'Template u krijua' });
      }
      startNew();
    } catch (err) {
      console.error('[TemplateManager] save failed', err);
      toast({ title: 'Gabim', description: 'Ruajtja dështoi.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setDeleting(true);
    try {
      await mutation.remove(id);
      if (editingId === id) startNew();
      toast({ title: 'Template u fshi' });
      setPendingDelete(null);
    } catch {
      toast({ title: 'Gabim', description: 'Fshirja dështoi.', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const setField = (patch: Draft) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#25D366]" /> Template-t e WhatsApp
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* List */}
          <div className="w-52 border-r border-border flex flex-col">
            <button
              onClick={startNew}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#1da851] hover:bg-muted border-b border-border"
            >
              <Plus className="w-3.5 h-3.5" /> Template i ri
            </button>
            <div className="flex-1 overflow-y-auto">
              {(templates || []).map((t) => (
                <div
                  key={t.id}
                  className={`group flex items-center justify-between px-3 py-2 border-b border-border/50 cursor-pointer ${
                    editingId === t.id ? 'bg-muted' : 'hover:bg-muted/60'
                  }`}
                  onClick={() => startEdit(t)}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{t.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{t.metaTemplateName} · {t.language}</p>
                    <StatusBadge s={statusFor(t)} />
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setPendingDelete(t); }}
                    className="sm:opacity-0 sm:group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1 -m-1"
                    aria-label={`Fshi template-in ${t.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {(templates || []).length === 0 && (
                <p className="text-[11px] text-muted-foreground p-3">Asnjë template ende.</p>
              )}
              {metaOn && statusFailed && (templates || []).length > 0 && (
                <p className="text-[10px] text-muted-foreground px-3 py-2">Statusi në Meta s’u lexua.</p>
              )}
            </div>
          </div>

          {/* Editor */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1">Emri (i brendshëm) *</label>
                <input
                  value={draft.name || ''}
                  onChange={(e) => setField({ name: e.target.value })}
                  placeholder="p.sh. Mirëseardhje"
                  className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Emri Meta *</label>
                <input
                  value={draft.metaTemplateName || ''}
                  onChange={(e) => setField({ metaTemplateName: e.target.value })}
                  placeholder="p.sh. hello_world"
                  className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Gjuha</label>
                <input
                  value={draft.language || ''}
                  onChange={(e) => setField({ language: e.target.value })}
                  placeholder="sq / en_US"
                  className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Kategoria</label>
                <select
                  value={draft.category || 'MARKETING'}
                  onChange={(e) => setField({ category: e.target.value })}
                  className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
                >
                  <option value="MARKETING">MARKETING</option>
                  <option value="UTILITY">UTILITY</option>
                  <option value="AUTHENTICATION">AUTHENTICATION</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium block mb-1">
                Teksti i template-it * <span className="text-muted-foreground font-normal">— përdor {`{{1}}, {{2}}`} për variablat</span>
              </label>
              <textarea
                value={draft.body || ''}
                onChange={(e) => setField({ body: e.target.value })}
                rows={4}
                placeholder="Përshëndetje {{1}}, oferta jonë për {{2}} është gati!"
                className="w-full px-3 py-2 bg-muted rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
              />
            </div>

            {editingId && statusFor(draft as WhatsAppTemplate) && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Statusi në Meta:</span>
                <StatusBadge s={statusFor(draft as WhatsAppTemplate)} withReason />
              </div>
            )}

            {paramCount > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-medium block">
                  {showInvoiceFields ? 'Variablat (fushat e kontaktit ose të faturës)' : 'Variablat (nga fushat e Lead-it)'}
                </label>
                {usedForInvoices && (
                  <p className="text-[10px] text-muted-foreground">Ky template përdoret për kujtesat e faturave — zgjidh fushat e faturës.</p>
                )}
                {Array.from({ length: paramCount }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-10">{`{{${i + 1}}}`}</span>
                    <select
                      value={paramFields[i] || 'custom'}
                      onChange={(e) => {
                        const pf = [...paramFields];
                        pf[i] = e.target.value;
                        setField({ paramFields: pf });
                      }}
                      className="flex-1 px-2 py-1.5 bg-muted rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
                    >
                      <optgroup label="Kontakti">
                        {[...LEAD_FIELD_OPTIONS, ...CONTACT_PSEUDO_FIELDS].map((o) => (
                          <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                      </optgroup>
                      {showInvoiceFields && (
                        <optgroup label="Fatura (kujtesat e faturave)">
                          {INVOICE_PARAM_FIELD_OPTIONS.map((o) => (
                            <option key={o.key} value={o.key}>{o.label}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="text-xs font-medium block mb-1">Pamja paraprake</label>
              <div className="px-3 py-2 rounded-md bg-[#d9fdd3] dark:bg-[#25D366]/20 text-sm text-foreground whitespace-pre-wrap">
                {preview || '—'}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              {editingId && (
                <Button variant="outline" size="sm" onClick={startNew} disabled={saving}>
                  Anulo
                </Button>
              )}
              <Button
                size="sm"
                className="bg-[#25D366] hover:bg-[#1da851] text-white"
                onClick={save}
                disabled={saving}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                {editingId ? 'Ruaj ndryshimet' : 'Krijo template'}
              </Button>
            </div>
          </div>
        </div>
      </div>
      {/* Portal events bubble through the React tree: without this wrapper a click in
          the dialog reached the backdrop's onClose. */}
      <div onClick={(e) => e.stopPropagation()}>
      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => { if (!o && !deleting) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fshi template-in “{pendingDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Template-i hiqet vetëm nga FivoCRM (jo nga Meta). Fushatat, kujtesat ose automatizimet që e përdorin nuk do të dërgojnë dot derisa të zgjidhet një tjetër.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Anulo</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); if (pendingDelete) void remove(pendingDelete.id); }}
            >
              {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
              Fshi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </div>
  );
};

export default WhatsappTemplateManager;
