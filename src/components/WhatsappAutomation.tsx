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
