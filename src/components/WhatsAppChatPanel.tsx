import React, { useState, useRef, useEffect } from 'react';
import { useCollection } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/use-toast';
import { X, Send, MessageSquare, Loader2, Phone } from 'lucide-react';
import { Button } from './ui/button';
import type { WhatsAppMessage } from '../types';

interface Props {
  phone: string;
  leadName: string;
  leadId?: string;
  onClose: () => void;
}

const WhatsAppChatPanel: React.FC<Props> = ({ phone, leadName, leadId, onClose }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const normalizedPhone = phone.replace(/[^\d]/g, '');

  const { data: messages, loading } = useCollection<WhatsAppMessage>('whatsappMessages', {
    where: [{ field: 'phone', operator: '==', value: normalizedPhone }],
    orderBy: { field: 'createdAt', direction: 'asc' },
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages?.length]);

  const handleSend = async () => {
    if (!text.trim() || sending || !user) return;
    setSending(true);
    const body = text.trim();
    setText('');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: normalizedPhone,
          message: body,
          leadId: leadId || null,
          leadName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setText(body); // restore on error
        throw new Error(data.error || 'Dërgimi dështoi');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Dërgimi dështoi';
      toast({ title: 'Gabim WhatsApp', description: msg, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[400px] bg-background border-l border-border shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border bg-[#25D366]/5">
        <div className="p-2 bg-[#25D366]/15 rounded-full shrink-0">
          <MessageSquare className="w-4 h-4 text-[#25D366]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground text-sm truncate">{leadName}</p>
          <div className="flex items-center gap-1">
            <Phone className="w-3 h-3 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">{phone}</p>
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
                <p style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{msg.message}</p>
                <div className={`flex items-center gap-1 mt-1 ${isOut ? 'justify-end' : 'justify-start'}`}>
                  <span className="text-[10px] text-muted-foreground">{timeStr}</span>
                  {isOut && (
                    <span className="text-[10px] text-[#25D366]">
                      {msg.status === 'read' ? '✓✓' : '✓'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input area */}
      <div className="px-3 py-3 border-t border-border bg-background">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Shkruaj mesazhin..."
            rows={1}
            className="flex-1 resize-none px-3 py-2.5 bg-muted rounded-2xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#25D366]/40 overflow-y-auto"
            style={{ minHeight: '42px', maxHeight: '112px' }}
          />
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
    </div>
  );
};

export default WhatsAppChatPanel;
