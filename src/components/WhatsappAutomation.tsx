import React, { useState } from 'react';
import { useCollection, useGlobalTeamId } from '../hooks/useFirestore';
import { useTeamSettingsData, saveTeamSettings } from '../hooks/useTeamSettings';
import { useToast } from '../hooks/use-toast';
import { X, Zap, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import type { WhatsAppTemplate } from '../types';

interface Props {
  onClose: () => void;
}

const WhatsappAutomation: React.FC<Props> = ({ onClose }) => {
  const teamId = useGlobalTeamId();
  const settings = useTeamSettingsData();
  const { toast } = useToast();
  const { data: templates } = useCollection<WhatsAppTemplate>('waTemplates');
  const channels = settings?.metaChannels || [];

  const [autoReply, setAutoReply] = useState(!!settings?.waAutoReplyEnabled);
  const [replyText, setReplyText] = useState(settings?.waAutoReplyText || '');
  const [start, setStart] = useState(settings?.waBusinessStart || '09:00');
  const [end, setEnd] = useState(settings?.waBusinessEnd || '17:00');
  const [followUp, setFollowUp] = useState(!!settings?.waFollowUpEnabled);
  const [followUpTpl, setFollowUpTpl] = useState(settings?.waFollowUpTemplateId || '');
  const [followUpChannel, setFollowUpChannel] = useState(settings?.waFollowUpChannelPhoneNumberId || '');
  // Auto-reminder for stale "waiting" leads
  const [autoRem, setAutoRem] = useState(!!settings?.waAutoReminderEnabled);
  const [autoRemDays, setAutoRemDays] = useState<number>(settings?.waAutoReminderDays ?? 7);
  const [autoRemStatuses, setAutoRemStatuses] = useState<string[]>(settings?.waAutoReminderStatuses ?? ['Follow-up', 'Proposal']);
  const [autoRemTpl, setAutoRemTpl] = useState(settings?.waAutoReminderTemplateId || '');
  const [autoRemChannel, setAutoRemChannel] = useState(settings?.waAutoReminderChannelPhoneNumberId || '');
  const STATUS_OPTIONS: { value: string; label: string }[] = [
    { value: 'New', label: 'Të reja' },
    { value: 'Contacted', label: 'Kontaktuara' },
    { value: 'Qualified', label: 'Kualifikuara' },
    { value: 'Follow-up', label: 'Në ndjekje' },
    { value: 'Proposal', label: 'Propozim' },
  ];
  const toggleStatus = (s: string) =>
    setAutoRemStatuses(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  // Overdue-invoice WhatsApp escalation
  const [overdue, setOverdue] = useState(!!settings?.waOverdueEnabled);
  const [overdueDays, setOverdueDays] = useState<number>(settings?.waOverdueDays ?? 60);
  const [overdueTpl, setOverdueTpl] = useState(settings?.waOverdueTemplateId || '');
  const [overdueChannel, setOverdueChannel] = useState(settings?.waOverdueChannelPhoneNumberId || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!teamId) return;
    setSaving(true);
    try {
      await saveTeamSettings(teamId, {
        waAutoReplyEnabled: autoReply,
        waAutoReplyText: replyText.trim(),
        waBusinessStart: start,
        waBusinessEnd: end,
        waFollowUpEnabled: followUp,
        waFollowUpTemplateId: followUpTpl,
        waFollowUpChannelPhoneNumberId: followUpChannel,
        waAutoReminderEnabled: autoRem,
        waAutoReminderDays: Number(autoRemDays) || 7,
        waAutoReminderStatuses: autoRemStatuses,
        waAutoReminderTemplateId: autoRemTpl,
        waAutoReminderChannelPhoneNumberId: autoRemChannel,
        waOverdueEnabled: overdue,
        waOverdueDays: Number(overdueDays) || 60,
        waOverdueTemplateId: overdueTpl,
        waOverdueChannelPhoneNumberId: overdueChannel,
      });
      toast({ title: 'Automatizimet u ruajtën' });
      onClose();
    } catch (err) {
      console.error('[WhatsappAutomation] save failed', err);
      toast({ title: 'Gabim', description: 'Ruajtja dështoi (vetëm pronari i ekipit mund t’i ndryshojë).', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-2xl w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-[#25D366]" /> Automatizime WhatsApp
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Auto-reply */}
          <section className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={autoReply} onChange={(e) => setAutoReply(e.target.checked)} />
              Përgjigje automatike jashtë orarit
            </label>
            <p className="text-[11px] text-muted-foreground">
              Kur një klient shkruan jashtë orarit, dërgohet një mesazh mirëseardhjeje (një herë çdo 6 orë për kontakt).
            </p>
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              rows={3}
              disabled={!autoReply}
              placeholder="Faleminderit që na shkruat! Jemi jashtë orarit; do t’ju përgjigjemi sa më parë."
              className="w-full px-3 py-2 bg-muted rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#25D366]/40 disabled:opacity-50"
            />
            <div className="flex items-center gap-3">
              <label className="text-xs text-muted-foreground">Orari (Tiranë)</label>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} disabled={!autoReply}
                className="px-2 py-1.5 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40 disabled:opacity-50" />
              <span className="text-xs text-muted-foreground">deri</span>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} disabled={!autoReply}
                className="px-2 py-1.5 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40 disabled:opacity-50" />
            </div>
          </section>

          <div className="border-t border-border" />

          {/* Follow-up */}
          <section className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />
              Follow-up automatik me template
            </label>
            <p className="text-[11px] text-muted-foreground">
              Kur një lead arrin datën e rikontaktit, dërgohet automatikisht template-i i zgjedhur (përveç njoftimit te agjenti).
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-muted-foreground block mb-1">Template</label>
                <select value={followUpTpl} onChange={(e) => setFollowUpTpl(e.target.value)} disabled={!followUp}
                  className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40 disabled:opacity-50">
                  <option value="">— Zgjidh —</option>
                  {templates?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              {channels.length > 1 && (
                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">Kanali Meta</label>
                  <select value={followUpChannel} onChange={(e) => setFollowUpChannel(e.target.value)} disabled={!followUp}
                    className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40 disabled:opacity-50">
                    <option value="">I pari</option>
                    {channels.map((c) => <option key={c.phoneNumberId} value={c.phoneNumberId}>{c.label || c.phone}</option>)}
                  </select>
                </div>
              )}
            </div>
          </section>

          <div className="border-t border-border" />

          {/* Auto-reminder for stale waiting leads */}
          <section className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={autoRem} onChange={(e) => setAutoRem(e.target.checked)} />
              Rikujtues automatik WhatsApp (lead në pritje)
            </label>
            <p className="text-[11px] text-muted-foreground">
              Nëse një lead është në statuset e zgjedhura dhe kanë kaluar X ditë nga komunikimi i fundit, i dërgohet automatikisht template-i WhatsApp.
            </p>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-muted-foreground">Pas</label>
              <input type="number" min={1} max={90} value={autoRemDays} onChange={(e) => setAutoRemDays(Number(e.target.value))} disabled={!autoRem}
                className="w-16 px-2 py-1.5 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40 disabled:opacity-50" />
              <label className="text-[11px] text-muted-foreground">ditësh pa komunikim</label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map(s => (
                <button key={s.value} type="button" onClick={() => toggleStatus(s.value)} disabled={!autoRem}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors disabled:opacity-50 ${
                    autoRemStatuses.includes(s.value) ? 'bg-[#25D366] text-white border-[#25D366]' : 'bg-background border-border hover:bg-muted'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-muted-foreground block mb-1">Template</label>
                <select value={autoRemTpl} onChange={(e) => setAutoRemTpl(e.target.value)} disabled={!autoRem}
                  className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40 disabled:opacity-50">
                  <option value="">— Zgjidh —</option>
                  {templates?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              {channels.length > 1 && (
                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">Kanali Meta</label>
                  <select value={autoRemChannel} onChange={(e) => setAutoRemChannel(e.target.value)} disabled={!autoRem}
                    className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40 disabled:opacity-50">
                    <option value="">I pari</option>
                    {channels.map((c) => <option key={c.phoneNumberId} value={c.phoneNumberId}>{c.label || c.phone}</option>)}
                  </select>
                </div>
              )}
            </div>
          </section>
          <div className="border-t border-border" />

          {/* Overdue invoice → WhatsApp escalation */}
          <section className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />
              Eskalim WhatsApp për fatura të vonuara
            </label>
            <p className="text-[11px] text-muted-foreground">
              Nëse një faturë mbetet e papaguar (Overdue) më shumë se X ditë, klientit i dërgohet automatikisht template-i WhatsApp (përveç email-it javor). Klientët me opsionin e fikur anashkalohen.
            </p>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-muted-foreground">Pas</label>
              <input type="number" min={1} max={365} value={overdueDays} onChange={(e) => setOverdueDays(Number(e.target.value))} disabled={!overdue}
                className="w-16 px-2 py-1.5 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40 disabled:opacity-50" />
              <label className="text-[11px] text-muted-foreground">ditësh vonesë (60 ≈ 2 muaj)</label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-muted-foreground block mb-1">Template</label>
                <select value={overdueTpl} onChange={(e) => setOverdueTpl(e.target.value)} disabled={!overdue}
                  className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40 disabled:opacity-50">
                  <option value="">— Zgjidh —</option>
                  {templates?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              {channels.length > 1 && (
                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">Kanali Meta</label>
                  <select value={overdueChannel} onChange={(e) => setOverdueChannel(e.target.value)} disabled={!overdue}
                    className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40 disabled:opacity-50">
                    <option value="">I pari</option>
                    {channels.map((c) => <option key={c.phoneNumberId} value={c.phoneNumberId}>{c.label || c.phone}</option>)}
                  </select>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Anulo</Button>
          <Button size="sm" className="bg-[#25D366] hover:bg-[#1da851] text-white" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null} Ruaj
          </Button>
        </div>
      </div>
    </div>
  );
};

export default WhatsappAutomation;
