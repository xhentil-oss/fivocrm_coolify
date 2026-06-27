import React, { useState, useEffect, useRef } from 'react';
import { addDoc, collection, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useCollection, useMutation, useDocument } from '../../hooks/useFirestore';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useAuth } from '../../contexts/AuthContext';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Badge } from '../../components/ui/badge';
import { Send, MessageSquare, Paperclip, X, FileIcon, FolderKanban, HelpCircle, AlertCircle, RefreshCw, ChevronRight, Reply, SmilePlus, Video } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { useVideoCall } from '../../hooks/useVideoCall';
import VideoCallModal from '../../components/VideoCallModal';
import type { ChatMessage, Project } from '../../types';

const EMOJI_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

const PortalChatView: React.FC = () => {
  const { user } = useAuth();
  const { customerId } = useClientPortal();
  const { toast } = useToast();
  const [messageText, setMessageText] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const markedAsReadRef = useRef<Set<string>>(new Set());

  // Fetch projects assigned to this customer
  const { data: customerProjects } = useCollection<Project>('projects', {
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });

  // Channel includes project if selected, otherwise general client channel
  const channelId = customerId
    ? (selectedProjectId
      ? `client-${customerId}-project-${selectedProjectId}`
      : `client-${customerId}`)
    : '';

  const { data: rawMessages, loading } = useCollection<ChatMessage>('messages', {
    where: [{ field: 'channelId', operator: '==', value: channelId }],
    skipTeamFilter: true,
  });

  // Sort client-side to avoid Firestore composite index requirement
  const messages = React.useMemo(() => {
    if (!rawMessages) return [];
    return [...rawMessages]
      .filter(m => !(m as any).deletedAt)
      .sort((a, b) => {
        const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toMillis?.() ?? 0;
        const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toMillis?.() ?? 0;
        return ta - tb;
      });
  }, [rawMessages]);

  // Fetch team members only for the customer's project teams (for display names + notifications)
  const projectTeamIds = React.useMemo(() => {
    if (!customerProjects) return [];
    return [...new Set(customerProjects.map(p => p.teamId).filter(Boolean))];
  }, [customerProjects]);
  const { data: allTeamMembers } = useCollection<any>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
    skipTeamFilter: true, // portal client has no businessId → avoids the loading-forever guard
  });
  const teamMembers = React.useMemo(() => {
    if (!allTeamMembers || projectTeamIds.length === 0) return allTeamMembers || [];
    return allTeamMembers.filter((m: any) => projectTeamIds.includes(m.teamId));
  }, [allTeamMembers, projectTeamIds]);

  // Fetch user profiles for display names (only displayName exposed, no sensitive data)
  const { data: userProfiles } = useCollection<any>('userProfiles');

  const messageMutation = useMutation<ChatMessage>('messages');
  const notificationMutation = useMutation<any>('notifications');
  const { upload: uploadAttachment, uploading } = useFileUpload();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const ALLOWED_IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const ALLOWED_DOC_TYPES = ['application/pdf'];
  const ALLOWED_ATTACHMENT_TYPES = [...ALLOWED_IMG_TYPES, ...ALLOWED_DOC_TYPES];
  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
  const isImageUrl = (url: string) => /\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i.test(url) || /image%2F/i.test(url);

  // Resolve teamId from team members so client messages include it — required for
  // admin's team-scoped useCollection('messages') to see them.
  const resolvedTeamId = allTeamMembers?.find((m: any) => m.teamId)?.teamId || null;

  // The customer record — used to find the responsible rep for the general channel.
  const { data: customer } = useDocument<any>('customers', customerId || undefined);

  // The file-upload VPS URL lives in teamSettings but is synced to localStorage
  // only for staff. Portal clients must load it themselves so photo upload works.
  const { data: teamSettings } = useDocument<any>('teamSettings', resolvedTeamId || undefined);
  useEffect(() => {
    const url = teamSettings?.whatsappVpsUrl;
    if (url) { try { localStorage.setItem('whatsapp_vps_url', url); } catch { /* ignore */ } }
  }, [teamSettings]);

  // Who should receive the client's message: the responsible person for the
  // active project, else the customer's assigned rep. Null → fall back to team.
  const responsibleUserId: string | null = React.useMemo(() => {
    if (selectedProjectId) {
      const p = customerProjects?.find(x => x.id === selectedProjectId) as any;
      const r = p?.responsibleUserId || p?.assignedToUserId;
      if (r) return r as string;
    }
    return (customer as any)?.assignedToUserId || null;
  }, [selectedProjectId, customerProjects, customer]);

  // Notify the responsible person about a client message (in-app → also emails
  // them via the notification choke point). Falls back to the project team /
  // admins when no responsible person is set.
  const notifyStaffOfClientMessage = React.useCallback(async (content: string, channelLabel: string) => {
    let recipients: string[] = [];
    if (responsibleUserId) {
      recipients = [responsibleUserId];
    } else if (teamMembers) {
      const proj = selectedProjectId ? customerProjects?.find(x => x.id === selectedProjectId) : null;
      const teamFallback = proj?.teamId ? teamMembers.filter((m: any) => m.teamId === proj.teamId && m.status === 'Active') : [];
      const pool = teamFallback.length ? teamFallback : teamMembers.filter((m: any) => m.role === 'Admin' || m.canAccessCRM);
      recipients = pool.map((m: any) => m.userId);
    }
    const preview = content.length > 100 ? content.slice(0, 100) + '...' : content;
    await Promise.all(
      [...new Set(recipients)].filter(Boolean).map(uid =>
        notificationMutation.create({
          userId: uid,
          type: 'client_message',
          title: `Mesazh i ri nga klienti${channelLabel ? ` — ${channelLabel}` : ''}`,
          message: preview,
          isRead: false,
          actionUrl: '/app/chat',
          actionLabel: 'Hap Chat',
          linkTo: channelId,
        } as any).catch(() => { /* don't block */ })
      )
    );
  }, [responsibleUserId, teamMembers, selectedProjectId, customerProjects, channelId, notificationMutation]);

  // Auto-scroll on new messages and when switching project channels
  const prevCountRef = useRef(0);
  useEffect(() => {
    const count = messages?.length || 0;
    if (count > prevCountRef.current && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    }
    prevCountRef.current = count;
  }, [messages?.length]);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, [channelId]);

  // Clear read tracking when switching channels
  useEffect(() => { markedAsReadRef.current.clear(); }, [channelId]);

  // Mark staff messages as readAt when client opens chat
  useEffect(() => {
    if (!user || !messages.length) return;
    const unread = messages.filter(
      (m: any) => m.senderType === 'staff' && !m.readAt && !markedAsReadRef.current.has(m.id)
    );
    unread.forEach((m: any) => {
      markedAsReadRef.current.add(m.id);
      messageMutation.update(m.id, { readAt: new Date() } as any).catch(() => {});
    });
  }, [messages, user]);

  const handleSendMessage = async (e?: React.FormEvent | null, override?: { attachmentUrl?: string }) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const attach = (override?.attachmentUrl ?? attachmentUrl).trim();
    if ((!messageText.trim() && !attach) || !user || !customerId) return;

    try {
      const msgContent = messageText || (attach && isImageUrl(attach) ? '📷 Foto' : '📎 Bashkëngjitje');
      // Use addDoc directly — portal users have getGlobalTeamId()=null which makes
      // useMutation.create() throw before reaching Firestore. The Firestore rule
      // allows create when senderType == 'client' (no teamId needed).
      await addDoc(collection(db, 'messages'), {
        content: msgContent,
        senderId: user.uid,
        channelId,
        isRead: false,
        attachmentUrl: attach || null,
        senderType: 'client',
        ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
        ...(replyingTo ? {
          replyToId: replyingTo.id,
          replyToContent: replyingTo.content.slice(0, 100),
          replyToSender: getDisplayName(replyingTo.senderId),
        } : {}),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdByUserId: user.uid,
      });

      // Bump last-activity so the staff sidebar sorts this conversation by recency.
      updateDoc(doc(db, 'customers', customerId), { lastClientMessageAt: Timestamp.now() }).catch(() => { /* non-blocking */ });

      // Route the message to the responsible person (in-app + email).
      const channelLabel = selectedProjectId
        ? customerProjects?.find(p => p.id === selectedProjectId)?.name || 'Projekt'
        : 'Bisedë e përgjithshme';
      await notifyStaffOfClientMessage(msgContent, channelLabel);

      setMessageText('');
      setAttachmentUrl('');
      setReplyingTo(null);
    } catch (err) {
      toast({
        title: 'Gabim',
        description: 'Mesazhi nuk u dërgua. Provoni përsëri.',
        variant: 'destructive',
      });
    }
  };

  // ── Video call (Daily) ──────────────────────────────────────────────────
  const { roomUrl, starting: videoStarting, start: startVideo, close: closeVideo } = useVideoCall();
  const videoEnabled = teamSettings?.videoCallsEnabled !== false; // default on
  const handleVideoCall = async () => {
    const room = `fivocrm-${channelId}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
    const url = await startVideo(room);
    if (!url || !user || !customerId) return;
    // Post a join link so the responsible person sees it (and gets notified).
    try {
      await addDoc(collection(db, 'messages'), {
        content: `📹 Thirrje video u nis. Bashkohu: ${url}`,
        senderId: user.uid,
        channelId,
        isRead: false,
        senderType: 'client',
        ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdByUserId: user.uid,
      });
      await notifyStaffOfClientMessage('📹 Thirrje video', selectedProjectId
        ? customerProjects?.find(p => p.id === selectedProjectId)?.name || 'Projekt'
        : 'Bisedë e përgjithshme');
    } catch { /* non-blocking */ }
  };

  // Upload an image and send it immediately (same flow as the admin chat).
  const handleFileSelect = async (file: File) => {
    if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) {
      toast({ title: 'Format i pasaktë', description: 'Lejohen vetëm PNG, JPG, GIF, WEBP ose PDF.', variant: 'destructive' });
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast({ title: 'Skedari shumë i madh', description: 'Maksimumi 10 MB.', variant: 'destructive' });
      return;
    }
    try {
      const res = await uploadAttachment(file, 'portal-chat');
      await handleSendMessage(null, { attachmentUrl: res.url });
    } catch (err) {
      toast({ title: 'Ngarkimi dështoi', description: (err as Error)?.message || 'Provo përsëri.', variant: 'destructive' });
    }
  };

  const getDisplayName = (senderId: string) => {
    if (senderId === user?.uid) return 'Ju';
    const profile = userProfiles?.find((p: any) => p.userId === senderId);
    if (profile?.displayName) return profile.displayName;
    const member = teamMembers?.find((m: any) => m.userId === senderId);
    if (member?.email) return member.email.split('@')[0];
    if (member) return `${member.role || 'Staf'}`;
    return 'Ekipi';
  };

  const getInitials = (senderId: string) => {
    const name = getDisplayName(senderId);
    return name.slice(0, 2).toUpperCase();
  };

  const getAvatarColor = (senderId: string) => {
    const colors = [
      'bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-amber-500', 
      'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500', 'bg-teal-500'
    ];
    let hash = 0;
    for (let i = 0; i < senderId.length; i++) hash = senderId.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const isOwnMessage = (senderId: string) => senderId === user?.uid;

  // Toggle emoji reaction
  const handleReaction = async (msgId: string, emoji: string) => {
    if (!user) return;
    const msg = rawMessages?.find(m => m.id === msgId);
    if (!msg) return;
    const reactions = { ...((msg as any).reactions || {}) };
    const users = reactions[emoji] ? [...reactions[emoji]] : [];
    const idx = users.indexOf(user.uid);
    if (idx >= 0) users.splice(idx, 1);
    else users.push(user.uid);
    if (users.length === 0) delete reactions[emoji];
    else reactions[emoji] = users;
    try {
      await messageMutation.update(msgId, { reactions } as any);
    } catch { /* silent */ }
    setShowEmojiPicker(null);
  };

  // Group messages by date
  const formatDate = (date: any) => {
    if (!date) return '';
    const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Sot';
    if (diffDays === 1) return 'Dje';
    if (diffDays < 7) {
      const days = ['E Diel', 'E Hënë', 'E Martë', 'E Mërkurë', 'E Enjte', 'E Premte', 'E Shtunë'];
      return days[d.getDay()];
    }
    return d.toLocaleDateString('sq-AL', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const formatTime = (date: any) => {
    if (!date) return '';
    const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' });
  };

  const getDateKey = (date: any) => {
    if (!date) return '';
    const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };

  // Quick action messages
  const quickActions = [
    { icon: HelpCircle, label: 'Kam një pyetje', message: 'Përshëndetje! Kam një pyetje për ju.' },
    { icon: AlertCircle, label: 'Raportoj problem', message: 'Përshëndetje, doja të raportoja një problem.' },
    { icon: RefreshCw, label: 'Kërkoj përditësim', message: 'Përshëndetje, a mund të më jepni një përditësim mbi gjendjen e punës?' },
  ];

  const sendQuickMessage = async (msg: string) => {
    if (!user || !customerId) return;
    try {
      await addDoc(collection(db, 'messages'), {
        content: msg,
        senderId: user.uid,
        channelId,
        isRead: false,
        senderType: 'client',
        ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdByUserId: user.uid,
      });

      // Route the quick message to the responsible person (in-app + email).
      const channelLabel = selectedProjectId
        ? customerProjects?.find(p => p.id === selectedProjectId)?.name || 'Projekt'
        : 'Bisedë e përgjithshme';
      await notifyStaffOfClientMessage(msg, channelLabel);
    } catch {
      toast({ title: 'Gabim', description: 'Mesazhi nuk u dërgua.', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">Duke ngarkuar bisedën...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-140px)] sm:h-[calc(100dvh-160px)] max-w-3xl mx-auto">
      {/* Chat Header */}
      <div className="flex items-center gap-3 pb-3 sm:pb-4 border-b mb-0">
        <div className="relative">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-primary-foreground font-bold text-sm">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-background" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-foreground text-base sm:text-lg">
            {selectedProjectId
              ? customerProjects?.find(p => p.id === selectedProjectId)?.name || 'Projekt'
              : 'Ekipi Ynë'}
          </h1>
          <p className="text-xs text-emerald-600 font-medium">Aktiv tani</p>
        </div>
        {messages && messages.length > 0 && (
          <Badge variant="outline" className="text-xs hidden sm:flex">
            {messages.length} mesazhe
          </Badge>
        )}
      </div>

      {/* Project Tabs - Scrollable */}
      {customerProjects && customerProjects.length > 0 && (
        <div className="flex items-center gap-1.5 sm:gap-2 py-2 sm:py-3 border-b overflow-x-auto scrollbar-hide">
          <button
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
              selectedProjectId === null
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
            onClick={() => setSelectedProjectId(null)}
          >
            <MessageSquare className="h-3 w-3" />
            Përgjithshme
          </button>
          {customerProjects.map((project) => (
            <button
              key={project.id}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                selectedProjectId === project.id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
              onClick={() => setSelectedProjectId(project.id)}
            >
              <FolderKanban className="h-3 w-3" />
              {project.name}
            </button>
          ))}
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-hidden relative">
        <ScrollArea className="h-full">
          <div ref={scrollRef} className="px-2 py-4 space-y-1">
            {!messages || messages.length === 0 ? (
              /* Empty State - Personalized Welcome */
              <div className="flex flex-col items-center justify-center py-8 sm:py-12 px-4">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-4 sm:mb-6">
                  <MessageSquare className="h-8 w-8 sm:h-10 sm:w-10 text-primary/60" />
                </div>
                <h2 className="text-lg sm:text-xl font-semibold text-foreground mb-2">
                  Mirë se vini! 👋
                </h2>
                <p className="text-muted-foreground text-center text-sm mb-6 sm:mb-8 max-w-sm">
                  Jemi këtu për t'ju ndihmuar. Zgjidhni një opsion më poshtë ose shkruani direkt mesazhin tuaj.
                </p>
                <div className="grid gap-3 w-full max-w-sm">
                  {quickActions.map((action, i) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={i}
                        onClick={() => sendQuickMessage(action.message)}
                        className="flex items-center gap-3 p-3 sm:p-3.5 rounded-xl border bg-card hover:bg-accent hover:border-primary/30 transition-all text-left group"
                      >
                        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <span className="text-sm font-medium text-foreground">{action.label}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto group-hover:text-primary transition-colors" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Messages with Date Separators */
              (() => {
                let lastDateKey = '';
                return messages.map((msg: any, idx: number) => {
                  const own = isOwnMessage(msg.senderId);
                  const dateKey = getDateKey(msg.createdAt);
                  const showDateSeparator = dateKey !== lastDateKey;
                  lastDateKey = dateKey;
                  const prevMsg = idx > 0 ? messages[idx - 1] : null;
                  const sameSenderAsPrev = prevMsg && prevMsg.senderId === msg.senderId && !showDateSeparator;

                  return (
                    <React.Fragment key={msg.id}>
                      {showDateSeparator && (
                        <div className="flex items-center justify-center py-4">
                          <div className="px-3 py-1 rounded-full bg-muted text-muted-foreground text-[11px] font-medium shadow-sm">
                            {formatDate(msg.createdAt)}
                          </div>
                        </div>
                      )}
                      <div
                        className={`flex group ${own ? 'justify-end' : 'justify-start'} ${sameSenderAsPrev ? 'mt-0.5' : 'mt-3'}`}
                      >
                        {/* Team Avatar */}
                        {!own && (
                          <div className="flex-shrink-0 mr-2 self-end">
                            {!sameSenderAsPrev ? (
                              <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full ${getAvatarColor(msg.senderId)} flex items-center justify-center text-white text-xs font-bold shadow-sm`}>
                                {getInitials(msg.senderId)}
                              </div>
                            ) : (
                              <div className="w-7 sm:w-8" />
                            )}
                          </div>
                        )}

                        <div className={`max-w-[82%] sm:max-w-[78%] ${own ? 'items-end' : 'items-start'} flex flex-col`}>
                          {/* Sender name for team messages */}
                          {!own && !sameSenderAsPrev && (
                            <span className="text-[11px] font-medium text-muted-foreground mb-1 ml-1">
                              {getDisplayName(msg.senderId)}
                              {msg.senderType === 'staff' && (
                                <Badge variant="outline" className="h-3.5 px-1 text-[8px] ml-1 border-blue-300 text-blue-600 inline-flex">Staf</Badge>
                              )}
                            </span>
                          )}

                          {/* Reply preview */}
                          {msg.replyToContent && (
                            <div className="text-[11px] mb-1 p-1.5 rounded border-l-2 bg-muted/40 border-primary/40 max-w-full">
                              <span className="font-medium">{msg.replyToSender}</span>
                              <p className="truncate opacity-80">{msg.replyToContent}</p>
                            </div>
                          )}

                          <div
                            className={`rounded-2xl px-3 sm:px-3.5 py-2 relative ${
                              own
                                ? 'bg-primary text-primary-foreground rounded-br-sm'
                                : 'bg-muted/80 border border-border/50 rounded-bl-sm'
                            }`}
                          >
                            <p className="text-[13px] sm:text-[13.5px] leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
                            {msg.attachmentUrl && (
                              isImageUrl(msg.attachmentUrl) ? (
                                <a href={msg.attachmentUrl} target="_blank" rel="noopener noreferrer" className="block mt-1.5">
                                  <img src={msg.attachmentUrl} alt="Foto" loading="lazy" className="rounded-lg max-w-[220px] max-h-[280px] object-cover border border-border/40" />
                                </a>
                              ) : (
                                <a
                                  href={msg.attachmentUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`inline-flex items-center gap-1.5 text-xs mt-1.5 px-2 py-1 rounded-md ${
                                    own ? 'bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25' : 'bg-background text-primary hover:bg-accent'
                                  } transition-colors`}
                                >
                                  <FileIcon className="h-3 w-3" />
                                  Skedar i bashkëngjitur
                                </a>
                              )
                            )}

                            {/* Message actions on hover */}
                            <div className={`absolute -top-3 ${own ? 'left-1' : 'right-1'} opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center gap-0.5 bg-background border rounded-lg shadow-sm px-1 py-0.5 z-10`}>
                              <div className="relative">
                                <button
                                  className="p-2 sm:p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground"
                                  onClick={() => setShowEmojiPicker(showEmojiPicker === msg.id ? null : msg.id)}
                                >
                                  <SmilePlus className="h-3.5 w-3.5" />
                                </button>
                                {showEmojiPicker === msg.id && (
                                  <div className={`absolute bottom-full ${own ? 'left-0' : 'right-0'} mb-1 flex gap-1 bg-popover border rounded-lg shadow-lg p-1.5 z-50`}>
                                    {EMOJI_REACTIONS.map(emoji => (
                                      <button
                                        key={emoji}
                                        onClick={() => handleReaction(msg.id, emoji)}
                                        className="hover:bg-accent rounded p-2 sm:p-1 text-xl sm:text-base leading-none transition-transform hover:scale-125"
                                      >
                                        {emoji}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <button
                                className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground"
                                onClick={() => setReplyingTo(msg)}
                              >
                                <Reply className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Reactions display */}
                          {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {Object.entries(msg.reactions as Record<string, string[]>).map(([emoji, users]) => (
                                <button
                                  key={emoji}
                                  onClick={() => handleReaction(msg.id, emoji)}
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                                    users.includes(user?.uid || '')
                                      ? 'bg-primary/10 border-primary/30'
                                      : 'bg-muted border-border hover:bg-accent'
                                  }`}
                                >
                                  {emoji} <span className="text-[10px]">{users.length}</span>
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Timestamp */}
                          <span className={`text-[10px] mt-0.5 px-1.5 ${own ? 'text-muted-foreground/60' : 'text-muted-foreground/60'}`}>
                            {formatTime(msg.createdAt)}
                            {(msg as any).editedAt && ' · ndryshuar'}
                            {own && (
                              <span className="ml-1 text-primary/60">✓</span>
                            )}
                            {own && (msg as any).readAt && (
                              <span className="ml-1 text-emerald-500/70 text-[9px]">
                                ✓✓ Parë {formatTime((msg as any).readAt)}
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                });
              })()
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Reply preview */}
      {replyingTo && (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/60 border-l-2 border-primary rounded-lg mx-1 mb-1">
          <Reply className="h-4 w-4 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-xs font-medium text-primary">{getDisplayName(replyingTo.senderId)}</span>
            <p className="text-xs text-muted-foreground truncate">{replyingTo.content}</p>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={() => setReplyingTo(null)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Message Input Area */}
      <div className="border-t bg-background pt-2" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom, 8px))' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); e.target.value = ''; }}
        />
        <form onSubmit={handleSendMessage} className="flex items-end gap-1.5 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={uploading}
            className="h-9 w-9 sm:h-10 sm:w-10 rounded-full flex-shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
            title="Dërgo foto"
          >
            {uploading ? <RefreshCw className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" /> : <Paperclip className="h-4 w-4 sm:h-5 sm:w-5" />}
          </Button>
          {videoEnabled && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={videoStarting}
              className="h-9 w-9 sm:h-10 sm:w-10 rounded-full flex-shrink-0 text-muted-foreground hover:text-foreground"
              onClick={handleVideoCall}
              title="Thirrje video"
            >
              {videoStarting ? <RefreshCw className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" /> : <Video className="h-4 w-4 sm:h-5 sm:w-5" />}
            </Button>
          )}
          <div className="flex-1 min-w-0">
            <Input
              placeholder="Shkruani mesazhin..."
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              className="rounded-full pr-4 h-9 sm:h-10 bg-muted/50 border-muted-foreground/20 focus:bg-background transition-colors"
            />
          </div>
          <Button 
            type="submit" 
            size="icon" 
            disabled={!messageText.trim() && !attachmentUrl.trim()} 
            className="h-9 w-9 sm:h-10 sm:w-10 rounded-full flex-shrink-0 shadow-sm"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
      {roomUrl && <VideoCallModal roomUrl={roomUrl} userName={customer?.name || 'Klient'} onClose={closeVideo} />}
    </div>
  );
};

export default PortalChatView;
