import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCollection, useGlobalTeamId, useWhatsappEnabled } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/use-toast';
import { normalizeAlbanianPhone, getTimestampMs } from '../lib/utils';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import WhatsAppChatPanel from '../components/WhatsAppChatPanel';
import WhatsAppStatusBadge from '../components/WhatsAppStatusBadge';
import WhatsappTemplateManager from '../components/WhatsappTemplateManager';
import WhatsappBroadcasts from '../components/WhatsappBroadcasts';
import WhatsappAnalytics from '../components/WhatsappAnalytics';
import { usePermissions } from '../contexts/PermissionsContext';
import { Search, MessageSquare, UserCircle2, Inbox, FileText, Megaphone, Zap, BarChart3, ArrowLeft } from 'lucide-react';
import type { WhatsAppMessage, WhatsAppThread, TeamMember } from '../types';

type Convo = {
  phone: string;
  jid: string | null;
  leadId: string | null;
  leadName: string | null;
  pushName: string | null;
  channel: 'baileys' | 'meta' | undefined;
  lastText: string;
  lastMs: number;
  unread: number;
};

type TabKey = 'all' | 'unread' | 'mine' | 'unassigned';

const STATUS_LABELS: Record<string, string> = {
  open: 'Hapur',
  pending: 'Në pritje',
  closed: 'Mbyllur',
};

// Canonical phone for a message (mirrors CRMView grouping).
function canonicalPhone(m: WhatsAppMessage): string {
  return normalizeAlbanianPhone(
    m.jid?.endsWith('@s.whatsapp.net') ? m.jid.split('@')[0] : (m.phone || '')
  );
}

const WhatsappInboxView: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const permissions = usePermissions();
  const teamId = useGlobalTeamId();
  const waEnabled = useWhatsappEnabled();

  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  // Deep link from a notification / the follow-up queue: /app/whatsapp?phone=355…
  // Same normalisation as the conversation keys, so the preselect matches the row.
  const [searchParams] = useSearchParams();
  const phoneParam = searchParams.get('phone');
  useEffect(() => {
    if (!phoneParam) return;
    const p = normalizeAlbanianPhone(phoneParam);
    if (p) setSelectedPhone(p);
  }, [phoneParam]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<TabKey>('all');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [broadcastsOpen, setBroadcastsOpen] = useState(false);
  // "Automatizime" now lives in Cilësimet → Automatizimi (FollowUpSettingsPanel).
  const navigate = useNavigate();
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  const { data: messages } = useCollection<WhatsAppMessage>('whatsappMessages', {
    skip: !waEnabled || !teamId,
    where: teamId ? [{ field: 'teamId', operator: '==', value: teamId }] : undefined,
    skipTeamFilter: true,
  });
  const { data: threads } = useCollection<WhatsAppThread>('whatsappThreads', { skip: !teamId });
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
  });

  const threadByPhone = useMemo(() => {
    const map = new Map<string, WhatsAppThread>();
    (threads || []).forEach((t) => map.set(t.phone, t));
    return map;
  }, [threads]);

  // Group messages into conversations keyed by canonical phone.
  const conversations = useMemo<Convo[]>(() => {
    const map = new Map<string, Convo>();
    (messages || []).forEach((m) => {
      const phone = canonicalPhone(m);
      if (!phone) return;
      const ms = getTimestampMs(m.createdAt);
      let c = map.get(phone);
      if (!c) {
        c = {
          phone,
          jid: m.jid || null,
          leadId: m.leadId || null,
          leadName: m.leadName || null,
          pushName: m.pushName || null,
          channel: m.channel,
          lastText: '',
          lastMs: 0,
          unread: 0,
        };
        map.set(phone, c);
      }
      if (ms >= c.lastMs) {
        c.lastMs = ms;
        c.lastText = m.message || ((m as any).mediaType ? '[Media]' : '');
        c.channel = m.channel || c.channel;
        c.jid = m.jid || c.jid;
      }
      if (m.leadId && !c.leadId) c.leadId = m.leadId;
      if (m.leadName && !c.leadName) c.leadName = m.leadName;
      if (m.pushName && !c.pushName) c.pushName = m.pushName;
      if (m.direction === 'inbound' && m.status === 'received') c.unread += 1;
    });
    return Array.from(map.values()).sort((a, b) => b.lastMs - a.lastMs);
  }, [messages]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      const t = threadByPhone.get(c.phone);
      if (tab === 'unread' && c.unread === 0) return false;
      if (tab === 'mine' && t?.assignedToUserId !== user?.uid) return false;
      if (tab === 'unassigned' && t?.assignedToUserId) return false;
      if (!q) return true;
      const name = (c.leadName || c.pushName || '').toLowerCase();
      return name.includes(q) || c.phone.includes(q) || c.lastText.toLowerCase().includes(q);
    });
  }, [conversations, threadByPhone, tab, search, user?.uid]);

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unread, 0),
    [conversations]
  );

  const selected = selectedPhone ? conversations.find((c) => c.phone === selectedPhone) : null;
  const selectedThread = selectedPhone ? threadByPhone.get(selectedPhone) : undefined;

  const saveThread = async (phone: string, patch: Partial<WhatsAppThread>) => {
    if (!teamId) return;
    try {
      await setDoc(
        doc(db, 'whatsappThreads', `${teamId}_${phone}`),
        {
          teamId,
          phone,
          ...patch,
          updatedAt: Timestamp.now(),
          updatedByUserId: user?.uid || null,
        },
        { merge: true }
      );
    } catch (err) {
      console.error('[WhatsappInbox] saveThread failed', err);
      toast({ title: 'Gabim', description: 'Ruajtja dështoi.', variant: 'destructive' });
    }
  };

  const memberName = (m: TeamMember) => m.displayName || m.email || 'Pa emër';

  if (!waEnabled) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3 text-center">
        <div className="p-4 bg-muted rounded-full">
          <MessageSquare className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">WhatsApp nuk është aktivizuar për këtë ekip.</p>
        <p className="text-xs text-muted-foreground">Aktivizoje te Cilësimet → WhatsApp.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-180px)] lg:h-[calc(100dvh-7rem)]">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold truncate">WhatsApp Inbox</h1>
          {totalUnread > 0 && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#25D366] text-white">
              {totalUnread}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => setBroadcastsOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border border-border hover:bg-muted"
          >
            <Megaphone className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Fushatat</span>
          </button>
          <button
            onClick={() => setTemplatesOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border border-border hover:bg-muted"
          >
            <FileText className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Template-t</span>
          </button>
          <button
            onClick={() => setAnalyticsOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border border-border hover:bg-muted"
          >
            <BarChart3 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Statistika</span>
          </button>
          {(permissions.isOwner || permissions.isAdmin) && (
            <button
              onClick={() => navigate('/app/settings?tab=automation')}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border border-border hover:bg-muted"
            >
              <Zap className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Automatizime</span>
            </button>
          )}
          <WhatsAppStatusBadge variant="pill" />
        </div>
      </div>
      {templatesOpen && <WhatsappTemplateManager onClose={() => setTemplatesOpen(false)} />}
      {broadcastsOpen && <WhatsappBroadcasts onClose={() => setBroadcastsOpen(false)} />}
      {analyticsOpen && <WhatsappAnalytics onClose={() => setAnalyticsOpen(false)} />}

      <div className="flex flex-1 min-h-0 gap-3">
        {/* Conversation list */}
        <div className={`${selectedPhone ? 'hidden lg:flex' : 'flex'} w-full lg:max-w-sm flex-col border border-border rounded-lg bg-card overflow-hidden`}>
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Kërko bisedë, numër, tekst..."
                className="w-full pl-8 pr-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
              />
            </div>
            <div className="flex gap-1 mt-2">
              {(['all', 'unread', 'mine', 'unassigned'] as TabKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${
                    tab === k
                      ? 'bg-[#25D366] text-white border-[#25D366]'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {k === 'all' ? 'Të gjitha' : k === 'unread' ? 'Të palexuara' : k === 'mine' ? 'Të miat' : 'Pa caktuar'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-6 text-muted-foreground">
                <Inbox className="w-7 h-7" />
                <p className="text-sm">Asnjë bisedë.</p>
              </div>
            )}
            {filtered.map((c) => {
              const t = threadByPhone.get(c.phone);
              const name = c.leadName || c.pushName || c.phone;
              const active = c.phone === selectedPhone;
              return (
                <button
                  key={c.phone}
                  onClick={() => setSelectedPhone(c.phone)}
                  className={`w-full text-left px-3 py-2.5 border-b border-border/60 flex gap-3 items-center ${
                    active ? 'bg-muted' : 'hover:bg-muted/60'
                  }`}
                >
                  <div className="w-9 h-9 rounded-full bg-[#25D366]/15 flex items-center justify-center shrink-0">
                    <span className="text-sm font-semibold text-[#1da851]">
                      {name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{name}</span>
                      {c.unread > 0 && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#25D366] text-white shrink-0">
                          {c.unread}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground truncate flex-1">
                        {c.lastText || '—'}
                      </span>
                      {c.channel && (
                        <span className="text-[9px] uppercase text-muted-foreground/70 shrink-0">
                          {c.channel}
                        </span>
                      )}
                    </div>
                    {(t?.assignedToName || t?.status) && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {t?.assignedToName && (
                          <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5">
                            <UserCircle2 className="w-3 h-3" /> {t.assignedToName}
                          </span>
                        )}
                        {t?.status && t.status !== 'open' && (
                          <span className="text-[10px] px-1.5 rounded bg-muted-foreground/10 text-muted-foreground">
                            {STATUS_LABELS[t.status]}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Thread + chat */}
        <div className={`${selectedPhone ? 'flex' : 'hidden lg:flex'} flex-1 min-w-0 flex-col border border-border rounded-lg bg-card overflow-hidden`}>
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center text-muted-foreground">
              <MessageSquare className="w-10 h-10" />
              <p className="text-sm">Zgjidh një bisedë për ta hapur.</p>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              {/* Assignment / status / note bar */}
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-background">
                <button
                  onClick={() => setSelectedPhone(null)}
                  className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-md hover:bg-muted -ml-1"
                  aria-label="Kthehu te bisedat"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <select
                  value={selectedThread?.assignedToUserId || ''}
                  onChange={(e) => {
                    const m = teamMembers?.find((x) => x.userId === e.target.value);
                    saveThread(selected.phone, {
                      assignedToUserId: e.target.value || null,
                      assignedToName: m ? memberName(m) : null,
                    });
                  }}
                  className="text-xs px-2 py-1.5 rounded-md bg-muted focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
                  title="Cakto agjent"
                >
                  <option value="">Pa caktuar</option>
                  {teamMembers?.filter((m) => m.userId).map((m) => (
                    <option key={m.id} value={m.userId}>
                      {memberName(m)}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedThread?.status || 'open'}
                  onChange={(e) => saveThread(selected.phone, { status: e.target.value as WhatsAppThread['status'] })}
                  className="text-xs px-2 py-1.5 rounded-md bg-muted focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
                  title="Statusi i bisedës"
                >
                  <option value="open">Hapur</option>
                  <option value="pending">Në pritje</option>
                  <option value="closed">Mbyllur</option>
                </select>
                <input
                  defaultValue={selectedThread?.internalNote || ''}
                  key={selected.phone}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== (selectedThread?.internalNote || '')) {
                      saveThread(selected.phone, { internalNote: v || null });
                    }
                  }}
                  placeholder="Shënim i brendshëm (vetëm ekipi)..."
                  className="flex-1 min-w-[140px] text-xs px-2 py-1.5 rounded-md bg-muted focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
                />
              </div>

              <div className="flex-1 min-h-0">
                <WhatsAppChatPanel
                  key={selected.phone}
                  embedded
                  phone={selected.phone}
                  jid={selected.jid}
                  leadName={selected.leadName || selected.pushName || selected.phone}
                  leadId={selected.leadId || undefined}
                  onClose={() => setSelectedPhone(null)}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WhatsappInboxView;
