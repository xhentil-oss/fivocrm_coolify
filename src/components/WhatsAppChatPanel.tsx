import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useCollection, useMutation, useDocument, getGlobalTeamId } from '../hooks/useFirestore';
import { useTeamSettingsData } from '../hooks/useTeamSettings';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/use-toast';
import { X, Send, MessageSquare, Loader2, Phone, FileText, Paperclip, Zap, Sparkles, RefreshCw, Clock, AlertCircle } from 'lucide-react';
import { Button } from './ui/button';
import { normalizeAlbanianPhone, getTimestampMs } from '../lib/utils';
import { useFileUpload } from '../hooks/useFileUpload';
import { useWhatsAppStatus } from '../hooks/useWhatsAppStatus';
import WhatsAppStatusBadge from './WhatsAppStatusBadge';
import { resolveLeadParams } from '../lib/whatsappTemplates';
import { safeExternalUrl } from '../lib/safeUrl';
import type { WhatsAppMessage, WhatsAppTemplate, Lead } from '../types';

interface Props {
  phone: string;
  jid?: string | null;
  leadName: string;
  leadId?: string;
  onClose: () => void;
  /** When true, render inline (fills its container) instead of as a fixed right-side drawer. */
  embedded?: boolean;
  /**
   * Fired after a SUCCESSFUL send. The panel does not know which CRM entity it
   * belongs to, so the owner (CRMView / FollowUpsView / Customer360) logs the
   * timeline row and stamps lastActivityAt — without this the primary WhatsApp
   * path never moved temperature, staleness or the first-response SLA.
   */
  onSent?: (e: { kind: 'text' | 'template' | 'media'; body?: string }) => void;
  /** Pre-filled composer text (a playbook step template) — the user still presses send. */
  initialText?: string;
}

const WhatsAppChatPanel: React.FC<Props> = ({ phone, jid: jidProp, leadName, leadId, onClose, embedded, onSent, initialText }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [text, setText] = useState(initialText || '');
  useEffect(() => { if (initialText) setText(initialText); }, [initialText]);
  const [sending, setSending] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [tplName, setTplName] = useState('');
  const [tplLang, setTplLang] = useState('sq');
  const [tplParams, setTplParams] = useState('');
  const [tplSending, setTplSending] = useState(false);
  const [pageSize, setPageSize] = useState(100);
  const [mediaSending, setMediaSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const waMutation = useMutation<WhatsAppMessage>('whatsappMessages');
  const { upload } = useFileUpload();
  const waStatus = useWhatsAppStatus();

  // Quick replies (shared "chatSnippets" saved-replies, team-scoped)
  const { data: snippets } = useCollection<any>('chatSnippets');
  const [quickOpen, setQuickOpen] = useState(false);

  // Saved templates + the linked lead (for auto-filling template variables)
  const { data: savedTemplates } = useCollection<WhatsAppTemplate>('waTemplates');
  const { data: leadsForTpl } = useCollection<Lead>('leads', { skip: !leadId });
  const linkedLead = leadId ? leadsForTpl?.find((l) => l.id === leadId) : undefined;

  const applySavedTemplate = (id: string) => {
    const t = savedTemplates?.find((x) => x.id === id);
    if (!t) return;
    setTplName(t.metaTemplateName);
    setTplLang(t.language || 'sq');
    setTplParams(resolveLeadParams(t.paramFields, linkedLead).join(', '));
  };

  const normalizedPhone = normalizeAlbanianPhone(phone);
  const teamId = getGlobalTeamId();

  // ── AI suggestion ("AI propozon, njeriu dërgon") ──
  // The inbound handler (api/_waInbound.ts) drafts a reply onto the conversation doc;
  // nothing is ever auto-sent. The staff member can use it, edit it, or ask again.
  const teamSettings = useTeamSettingsData();
  const aiAssistOn = (teamSettings as any)?.waAiAssist !== 'off' && !!((teamSettings as any)?.hasAiApiKey ?? true);
  const convId = teamId && normalizedPhone ? `wa-${teamId}-${normalizedPhone}` : undefined;
  const { data: conversation } = useDocument<any>('conversations', convId);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDismissedFor, setAiDismissedFor] = useState<string | null>(null);
  const requestAiDraft = async () => {
    if (!user || aiLoading || !teamId) return;
    setAiLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/ai-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ teamId, phone: normalizedPhone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Sugjerimi dështoi');
      setAiDismissedFor(null);
      if (data?.suggestedReply && !conversation?.suggestedReply) setText((t) => t || data.suggestedReply);
    } catch (err: unknown) {
      toast({ title: 'AI', description: err instanceof Error ? err.message : 'Sugjerimi dështoi', variant: 'destructive' });
    } finally {
      setAiLoading(false);
    }
  };

  const { data: rawMessages, loading } = useCollection<WhatsAppMessage>('whatsappMessages', {
    skip: !normalizedPhone || !teamId,
    // Scope by both teamId AND phone so we never load other teams' messages.
    where: [
      { field: 'teamId', operator: '==', value: teamId },
      { field: 'phone', operator: '==', value: normalizedPhone },
    ],
    // Skip the auto team-filter because we already include it explicitly above.
    skipTeamFilter: true,
    // Latest N first (server-side), client-sorts back to ascending below.
    orderBy: { field: 'createdAt', direction: 'desc' },
    limit: pageSize,
  });

  // Sort client-side ascending (oldest → newest) for display.
  const messages = useMemo(() => {
    if (!rawMessages) return null;
    return [...rawMessages].sort((a, b) => getTimestampMs(a.createdAt) - getTimestampMs(b.createdAt));
  }, [rawMessages]);

  // Show "Load older" button if we hit the page cap (likely more behind).
  const hasMore = (rawMessages?.length || 0) >= pageSize;

  // ── 24-hour Meta window awareness ────────────────────────────────────────
  // For Meta-channel chats: if the last inbound message is older than 24h,
  // free-text sends will be rejected (Meta requires a pre-approved template).
  // We surface this as a warning banner so the user knows ahead of time.
  const windowState = useMemo(() => {
    if (!messages || messages.length === 0) return { isMeta: false, withinWindow: true, lastInboundMs: 0 };
    const isMeta = messages.some(m => (m as any).channel === 'meta');
    if (!isMeta) return { isMeta: false, withinWindow: true, lastInboundMs: 0 };
    const lastInbound = [...messages].reverse().find(m => m.direction === 'inbound');
    if (!lastInbound) return { isMeta: true, withinWindow: false, lastInboundMs: 0 };
    const ms = getTimestampMs(lastInbound.createdAt);
    return { isMeta: true, withinWindow: Date.now() - ms < 24 * 60 * 60 * 1000, lastInboundMs: ms };
  }, [messages]);

  // Derive jid from messages if not passed as prop (handles LID contacts in CRM panel)
  const jid = jidProp || messages?.find(m => m.jid)?.jid || null;

  // Auto-scroll to bottom on new messages — but not when user just loaded older history.
  const prevPageSizeRef = useRef(pageSize);
  useEffect(() => {
    const grewByPaging = pageSize !== prevPageSizeRef.current;
    prevPageSizeRef.current = pageSize;
    if (grewByPaging) return; // preserve scroll position when prepending older
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages?.length, pageSize]);

  // Mark inbound messages as read when panel opens or new messages arrive
  useEffect(() => {
    if (!messages) return;
    messages
      .filter(m => m.direction === 'inbound' && m.status === 'received')
      .forEach(m => waMutation.update(m.id, { status: 'read' } as any).catch(() => {}));
  }, [messages?.length]);

  const handleSend = async () => {
    if (!text.trim() || sending || !user) return;
    setSending(true);
    const body = text.trim();
    setText('');
    try {
      const token = await user.getIdToken();
      const isMeta = windowState.isMeta;
      const endpoint = isMeta ? '/api/meta-send' : '/api/whatsapp';
      const payload: Record<string, unknown> = {
        to: normalizedPhone,
        message: body,
        leadId: leadId || null,
        leadName,
        teamId: getGlobalTeamId(),
      };
      if (!isMeta) payload.jid = jid || undefined;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setText(body); // restore on error
        // Window-expired? Suggest opening template dialog.
        if (data?.code === 'WINDOW_EXPIRED' || data?.code === 'NO_INBOUND') {
          toast({
            title: 'Dritarja 24h e Meta',
            description: 'Përdor një template të aprovuar (kliko butonin Template).',
            variant: 'destructive',
          });
          setTemplateOpen(true);
          return;
        }
        throw new Error(data.error || 'Dërgimi dështoi');
      }
      onSent?.({ kind: 'text', body });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Dërgimi dështoi';
      toast({ title: 'Gabim WhatsApp', description: msg, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const handleTemplateSend = async () => {
    if (!tplName.trim() || tplSending || !user) return;
    setTplSending(true);
    try {
      const token = await user.getIdToken();
      // Parse params: comma-separated text → body parameters
      const params = tplParams
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(t => ({ type: 'text', text: t }));
      const components = params.length > 0
        ? [{ type: 'body', parameters: params }]
        : undefined;
      const res = await fetch('/api/meta-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: normalizedPhone,
          teamId: getGlobalTeamId(),
          leadId: leadId || null,
          leadName,
          template: {
            name: tplName.trim(),
            language: { code: tplLang.trim() || 'sq' },
            ...(components ? { components } : {}),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Dërgimi i template-it dështoi');
      toast({ title: 'Template u dërgua', description: tplName.trim() });
      onSent?.({ kind: 'template', body: `Template: ${tplName.trim()}` });
      setTemplateOpen(false);
      setTplName('');
      setTplParams('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Dërgimi i template-it dështoi';
      toast({ title: 'Gabim template', description: msg, variant: 'destructive' });
    } finally {
      setTplSending(false);
    }
  };

  const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

  const handleFilePick = () => {
    if (mediaSending) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input so the same file can be re-picked later
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file || !user) return;

    if (file.size > MAX_MEDIA_BYTES) {
      toast({
        title: 'Skedari shumë i madh',
        description: 'Maksimumi i lejuar nga Meta është 16 MB.',
        variant: 'destructive',
      });
      return;
    }

    // Decide WhatsApp media type from MIME
    const mime = file.type || 'application/octet-stream';
    let mediaType: 'image' | 'video' | 'audio' | 'document';
    if (mime.startsWith('image/') && mime !== 'image/svg+xml') mediaType = 'image';
    else if (mime.startsWith('video/')) mediaType = 'video';
    else if (mime.startsWith('audio/')) mediaType = 'audio';
    else mediaType = 'document';

    setMediaSending(true);
    try {
      // 1) Upload to Firebase Storage
      const uploaded = await upload(file, 'whatsapp-media');

      // 2) Send via /api/meta-send-media (Meta only — Baileys media TBD)
      if (!windowState.isMeta) {
        toast({
          title: 'Vetëm Meta',
          description: 'Dërgimi i medias nga paneli mbështetet vetëm për kanalin Meta.',
          variant: 'destructive',
        });
        return;
      }

      const token = await user.getIdToken();
      const res = await fetch('/api/meta-send-media', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: normalizedPhone,
          teamId: getGlobalTeamId(),
          mediaUrl: uploaded.url,
          mediaType,
          mediaMime: mime,
          filename: file.name,
          caption: text.trim() || undefined,
          leadId: leadId || null,
          leadName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.code === 'WINDOW_EXPIRED' || data?.code === 'NO_INBOUND') {
          toast({
            title: 'Dritarja 24h e Meta',
            description: 'Përdor një template për të rifilluar bisedën.',
            variant: 'destructive',
          });
          setTemplateOpen(true);
          return;
        }
        throw new Error(data.error || 'Dërgimi i medias dështoi');
      }
      onSent?.({ kind: 'media', body: text.trim() || `[${mediaType}] ${file.name}` });
      setText('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Dërgimi i medias dështoi';
      toast({ title: 'Gabim media', description: msg, variant: 'destructive' });
    } finally {
      setMediaSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className={
        embedded
          ? 'relative w-full h-full bg-background flex flex-col overflow-hidden'
          : 'fixed inset-y-0 right-0 w-full sm:w-[400px] bg-background border-l border-border shadow-2xl z-50 flex flex-col overflow-hidden'
      }
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border bg-[#25D366]/5">
        <div className="p-2 bg-[#25D366]/15 rounded-full shrink-0">
          <MessageSquare className="w-4 h-4 text-[#25D366]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground text-sm truncate">{leadName}</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Phone className="w-3 h-3 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">{phone}</p>
            {!windowState.isMeta && <WhatsAppStatusBadge variant="pill" />}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="shrink-0 h-8 w-8 p-0">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-2.5"
        style={{ background: 'var(--wa-bg, #efeae2)' }}
      >
        {loading && (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && hasMore && (
          <div className="flex justify-center pb-2">
            <button
              onClick={() => setPageSize((n) => n + 100)}
              className="text-xs px-3 py-1.5 rounded-full bg-background/80 border border-border text-foreground hover:bg-muted shadow-sm"
            >
              Shfaq mesazhe më të vjetra
            </button>
          </div>
        )}
        {!loading && (!messages || messages.length === 0) && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
            <div className="p-4 bg-[#25D366]/10 rounded-full">
              <MessageSquare className="w-8 h-8 text-[#25D366]/60" />
            </div>
            <p className="text-sm font-medium text-foreground">Asnjë mesazh ende</p>
            <p className="text-xs text-muted-foreground">Dërgo mesazhin e parë te {leadName}</p>
          </div>
        )}
        {messages?.map((msg) => {
          const isOut = msg.direction === 'outbound';
          const timeStr = (() => {
            const d =
              msg.createdAt instanceof Date
                ? msg.createdAt
                : (msg.createdAt as any)?.toDate?.();
            return d
              ? d.toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' })
              : '';
          })();

          return (
            <div key={msg.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[78%] px-3 py-2 rounded-2xl shadow-sm text-sm leading-relaxed ${
                  isOut
                    ? 'bg-[#d9fdd3] dark:bg-[#25D366]/25 text-foreground rounded-tr-none'
                    : 'bg-white dark:bg-card text-foreground rounded-tl-none'
                }`}
              >
                {(msg as any).mediaType === 'image' && safeExternalUrl((msg as any).mediaUrl) && (
                  <a href={safeExternalUrl((msg as any).mediaUrl) ?? undefined} target="_blank" rel="noopener noreferrer">
                    <img
                      src={safeExternalUrl((msg as any).mediaUrl) ?? undefined}
                      alt={(msg as any).mediaFilename || 'image'}
                      className="rounded-lg max-h-64 mb-1 object-cover"
                      loading="lazy"
                    />
                  </a>
                )}
                {(msg as any).mediaType === 'video' && safeExternalUrl((msg as any).mediaUrl) && (
                  <video
                    controls
                    src={safeExternalUrl((msg as any).mediaUrl) ?? undefined}
                    className="rounded-lg max-h-64 mb-1"
                  />
                )}
                {(msg as any).mediaType === 'audio' && safeExternalUrl((msg as any).mediaUrl) && (
                  <audio controls src={safeExternalUrl((msg as any).mediaUrl) ?? undefined} className="mb-1 w-full" />
                )}
                {(msg as any).mediaType === 'document' && safeExternalUrl((msg as any).mediaUrl) && (
                  <a
                    href={safeExternalUrl((msg as any).mediaUrl) ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 mb-1 px-2 py-1.5 rounded-md bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10 text-xs"
                  >
                    <FileText className="w-4 h-4 shrink-0" />
                    <span className="truncate">{(msg as any).mediaFilename || 'Dokument'}</span>
                  </a>
                )}
                {msg.message && (
                  <p style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{msg.message}</p>
                )}
                <div className={`flex items-center gap-1 mt-1 ${isOut ? 'justify-end' : 'justify-start'}`}>
                  <span className="text-[10px] text-muted-foreground">{timeStr}</span>
                  {isOut && (
                    // WhatsApp's own vocabulary: clock = not yet accepted by the server,
                    // ✓ = accepted, ✓✓ grey = delivered, ✓✓ green = read, ! = failed.
                    // Before this every outbound row showed ✓, including ones WhatsApp
                    // had never accepted.
                    msg.status === 'failed' ? (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-red-600" title={(msg as any).error || 'Dërgimi dështoi'}>
                        <AlertCircle className="w-3 h-3" /> Dështoi
                      </span>
                    ) : msg.status === 'pending' ? (
                      <span className="text-[10px] text-muted-foreground" title="Në pritje të konfirmimit nga WhatsApp">
                        <Clock className="w-3 h-3" />
                      </span>
                    ) : msg.status === 'read' ? (
                      <span className="text-[10px] text-[#25D366]" title="Lexuar">✓✓</span>
                    ) : msg.status === 'delivered' ? (
                      <span className="text-[10px] text-muted-foreground" title="Dorëzuar">✓✓</span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground" title="Dërguar">✓</span>
                    )
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input area */}
      <div className="px-3 py-3 border-t border-border bg-background">
        {!windowState.isMeta && !waStatus.loading && (!waStatus.serverOnline || !waStatus.anyConnected) && (
          <div className="mb-2">
            <WhatsAppStatusBadge variant="banner" />
          </div>
        )}
        {windowState.isMeta && !windowState.withinWindow && (
          <div className="mb-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-700 dark:text-amber-400 leading-snug">
            ⚠️ Jashtë dritares 24-orëshe të Meta. Mesazhet me tekst të lirë do refuzohen — duhet të përdorni një template të aprovuar.
          </div>
        )}
        {aiAssistOn && conversation?.awaitingReply && (
          conversation?.suggestedReply && aiDismissedFor !== (conversation.suggestedForMessageId || 'x') ? (
            <div className="mb-2 rounded-md border border-violet-300/60 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-800 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                  <Sparkles className="w-3.5 h-3.5" /> Sugjerim AI — ti e dërgon
                </span>
                <div className="flex items-center gap-1">
                  <button type="button" className="text-violet-700 dark:text-violet-300 hover:opacity-80" title="Rigjenero" onClick={requestAiDraft} disabled={aiLoading}>
                    {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  </button>
                  <button type="button" className="text-muted-foreground hover:text-foreground" title="Hiq" onClick={() => setAiDismissedFor(conversation.suggestedForMessageId || 'x')}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap leading-snug">{conversation.suggestedReply}</p>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setText(conversation.suggestedReply)}>
                  Ndrysho
                </Button>
                <Button size="sm" className="h-7 text-xs bg-[#25D366] hover:bg-[#1da851] text-white"
                  onClick={() => { setText(conversation.suggestedReply); setTimeout(() => { void handleSend(); }, 0); }}
                  disabled={sending}>
                  <Send className="w-3 h-3 mr-1" /> Dërgo
                </Button>
              </div>
            </div>
          ) : (
            <div className="mb-2 flex justify-end">
              <button type="button" onClick={requestAiDraft} disabled={aiLoading}
                className="inline-flex items-center gap-1 text-[11px] text-violet-700 dark:text-violet-300 hover:underline disabled:opacity-60">
                {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Sugjero përgjigje me AI
              </button>
            </div>
          )
        )}
        {quickOpen && (snippets?.length || 0) > 0 && (
          <div className="mb-2 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
            {snippets!.map((s: any) => (
              <button
                key={s.id}
                onClick={() => {
                  setText((prev) => (prev.trim() ? `${prev.trim()} ${s.content}` : s.content));
                  setQuickOpen(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-muted border-b border-border/50 last:border-0"
              >
                {s.shortcut && (
                  <span className="text-[10px] font-medium text-[#25D366] mr-1">/{s.shortcut}</span>
                )}
                <span className="text-xs text-foreground line-clamp-2">{s.content}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
            onChange={handleFileChange}
          />
          {(snippets?.length || 0) > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-[42px] w-[42px] p-0 rounded-full shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setQuickOpen((o) => !o)}
              title="Përgjigje të shpejta"
              aria-label="Përgjigje të shpejta"
            >
              <Zap className="w-4 h-4" />
            </Button>
          )}
          {windowState.isMeta && (
            <Button
              size="sm"
              variant="ghost"
              className="h-[42px] w-[42px] p-0 rounded-full shrink-0 text-muted-foreground hover:text-foreground"
              onClick={handleFilePick}
              disabled={mediaSending}
              title="Bashkëngjit skedar"
            >
              {mediaSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </Button>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Shkruaj mesazhin..."
            rows={1}
            className="flex-1 resize-none px-3 py-2.5 bg-muted rounded-2xl text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#25D366]/40 overflow-y-auto"
            style={{ minHeight: '42px', maxHeight: '112px' }}
          />
          {windowState.isMeta && (
            <Button
              size="sm"
              variant="outline"
              className="h-[42px] w-[42px] p-0 rounded-full shrink-0"
              onClick={() => setTemplateOpen(true)}
              title="Dërgo template"
            >
              <FileText className="w-4 h-4" />
            </Button>
          )}
          <Button
            size="sm"
            className="bg-[#25D366] hover:bg-[#1da851] text-white h-[42px] w-[42px] p-0 rounded-full shrink-0"
            onClick={handleSend}
            disabled={!text.trim() || sending}
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
          Enter = dërgo · Shift+Enter = rresht i ri
        </p>
      </div>

      {/* Template send modal */}
      {templateOpen && (
        <div
          className="absolute inset-0 bg-black/40 flex items-end sm:items-center justify-center z-10"
          onClick={() => !tplSending && setTemplateOpen(false)}
        >
          <div
            className="w-full sm:w-[360px] bg-background border border-border rounded-t-2xl sm:rounded-2xl p-4 m-0 sm:m-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Dërgo template Meta</h3>
              <button
                onClick={() => setTemplateOpen(false)}
                disabled={tplSending}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {(savedTemplates?.length || 0) > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground block">
                  Zgjidh nga template-t e ruajtura
                </label>
                <select
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) applySavedTemplate(e.target.value); }}
                  className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
                  disabled={tplSending}
                >
                  <option value="">— Manual —</option>
                  {savedTemplates!.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground">
                  Variablat plotësohen automatikisht nga Lead-i; mund t'i ndryshosh më poshtë.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground block">
                Emri i template-it <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                placeholder="p.sh. hello_world"
                className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
                disabled={tplSending}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground block">Gjuha</label>
              <input
                type="text"
                value={tplLang}
                onChange={(e) => setTplLang(e.target.value)}
                placeholder="sq / en / en_US"
                className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
                disabled={tplSending}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground block">
                Parametra (ndarë me presje)
              </label>
              <input
                type="text"
                value={tplParams}
                onChange={(e) => setTplParams(e.target.value)}
                placeholder="Emri, 50 EUR, …"
                className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
                disabled={tplSending}
              />
              <p className="text-[10px] text-muted-foreground">
                Çdo vlerë zëvendëson placeholder-in {`{{1}}, {{2}}, …`} në template.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTemplateOpen(false)}
                disabled={tplSending}
              >
                Anulo
              </Button>
              <Button
                size="sm"
                className="bg-[#25D366] hover:bg-[#1da851] text-white"
                onClick={handleTemplateSend}
                disabled={!tplName.trim() || tplSending}
              >
                {tplSending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                Dërgo
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WhatsAppChatPanel;
