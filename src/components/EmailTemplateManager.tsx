import React, { useState } from 'react';
import EmailHtmlPreview from './EmailHtmlPreview';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/use-toast';
import { Mail, Plus, Trash2, Pencil, Loader2, X } from 'lucide-react';
import { Button } from './ui/button';
import type { EmailTemplate } from '../types';

const CATEGORIES = [
  { value: 'marketing', label: 'Marketing' },
  { value: 'newsletter', label: 'Newsletter' },
  { value: 'onboarding', label: 'Mirëseardhje' },
  { value: 'promo', label: 'Promocion' },
];

const STARTER_HTML = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="color:#12468C;">Përshëndetje {{name}}!</h2>
  <p style="color:#374151;line-height:1.6;">Shkruani mesazhin tuaj këtu…</p>
  <a href="https://fivocrm.vercel.app" style="display:inline-block;background:#0EA5E9;color:#fff;padding:11px 22px;border-radius:6px;text-decoration:none;font-weight:bold;margin-top:12px;">Mëso më shumë</a>
  <p style="color:#9ca3af;font-size:11px;margin-top:28px;">Ky email u dërgua nga ekipi ynë.</p>
</div>`;

const EmailTemplateManager: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: templates } = useCollection<EmailTemplate>('emailTemplates', {
    orderBy: { field: 'createdAt', direction: 'desc' },
  });
  const mutation = useMutation<EmailTemplate>('emailTemplates');

  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('marketing');
  const [html, setHtml] = useState(STARTER_HTML);
  const [busy, setBusy] = useState(false);

  const openNew = () => {
    setEditing(null);
    setName(''); setSubject(''); setCategory('marketing'); setHtml(STARTER_HTML);
    setShowForm(true);
  };
  const openEdit = (t: EmailTemplate) => {
    setEditing(t);
    setName(t.name); setSubject(t.subject); setCategory(t.category || 'marketing'); setHtml(t.html);
    setShowForm(true);
  };

  const save = async () => {
    if (!name.trim() || !subject.trim() || !html.trim()) {
      toast({ title: 'Mungojnë fushat', description: 'Emri, subjekti dhe përmbajtja janë të detyrueshme.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const payload = { name: name.trim(), subject: subject.trim(), category, html };
      if (editing) await mutation.update(editing.id, payload as any);
      else await mutation.create({ ...payload, createdByUserId: user?.uid || null } as any);
      toast({ title: editing ? 'Shablloni u përditësua' : 'Shablloni u ruajt' });
      setShowForm(false);
    } catch {
      toast({ title: 'Gabim', variant: 'destructive' });
    } finally { setBusy(false); }
  };

  const remove = async (t: EmailTemplate) => {
    if (!window.confirm(`Të fshihet shablloni "${t.name}"?`)) return;
    try { await mutation.remove(t.id); toast({ title: 'U fshi' }); }
    catch { toast({ title: 'Gabim', variant: 'destructive' }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Shabllone Email</h3>
          <p className="text-xs text-muted-foreground">Përdor tokenat {'{{name}}'}, {'{{company}}'}, {'{{email}}'} që plotësohen automatikisht.</p>
        </div>
        <Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-1" /> Shabllon i ri</Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {(templates || []).length === 0 && (
          <p className="text-xs text-muted-foreground col-span-full">Asnjë shabllon ende.</p>
        )}
        {(templates || []).map((t) => (
          <div key={t.id} className="border border-border rounded-lg p-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-primary shrink-0" /> {t.name}</p>
              <p className="text-[11px] text-muted-foreground truncate">{t.subject}</p>
              {t.category && <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{t.category}</span>}
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => openEdit(t)} className="p-1.5 rounded hover:bg-muted text-muted-foreground"><Pencil className="w-3.5 h-3.5" /></button>
              <button onClick={() => remove(t)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-background border border-border rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold">{editing ? 'Ndrysho shabllonin' : 'Shabllon i ri'}</h2>
              <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium block mb-1">Emri *</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="p.sh. Newsletter Mujor"
                    className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Kategoria</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
                    {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Subjekti *</label>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="p.sh. Oferta jonë e re, {{name}}!"
                  className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Përmbajtja (HTML) *</label>
                <textarea value={html} onChange={(e) => setHtml(e.target.value)} rows={12}
                  className="w-full px-3 py-2 bg-muted rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground mb-1">Pamja paraprake:</p>
                <EmailHtmlPreview html={html} className="h-56" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Anulo</Button>
              <Button size="sm" onClick={save} disabled={busy}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null} Ruaj
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailTemplateManager;
