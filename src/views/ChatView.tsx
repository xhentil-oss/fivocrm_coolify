import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { ScrollArea } from '../components/ui/scroll-area';
import { Send, MessageSquare, Users, Hash, Paperclip, X, FileIcon, FolderOpen, ArrowLeft, Search, Pencil, Trash2, Reply, SmilePlus, Check, Bell, Plus, CheckCircle2, Eye, Link2 } from 'lucide-react';
import { useToast } from '../hooks/use-toast';
import type { ChatMessage, UserProfile, Customer, ClientPortalAccess, Project, TeamMember } from '../types';

type ChatMode = 'channel' | 'direct';
type SidebarTab = 'all' | 'projects' | 'clients' | 'dm' | 'approvals';

const CHANNELS = [
  { id: 'general' as const, name: 'Përgjithshme', icon: Hash, description: 'Diskutime në të gjithë kompaninë' },
  { id: 'team' as const, name: 'Ekipi', icon: Users, description: 'Bashkëpunimi i ekipit' },
  { id: 'support' as const, name: 'Mbështetja', icon: MessageSquare, description: 'Mbështetje për klientët' },
] as const;

const EMOJI_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

// Stable query options — defined outside component to prevent re-subscribes
const ACTIVE_MEMBERS_QUERY: { where: { field: string; operator: string; value: any }[] } = {
  where: [{ field: 'status', operator: '==', value: 'Active' }],
};
const ACTIVE_PORTAL_QUERY: { where: { field: string; operator: string; value: any }[] } = {
  where: [{ field: 'status', operator: '==', value: 'Active' }],
};

const ChatView: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [messageText, setMessageText] = useState('');
  const [chatMode, setChatMode] = useState<ChatMode>('channel');
  const [activeChannel, setActiveChannel] = useState<string>('general');
  const [activeDirectUserId, setActiveDirectUserId] = useState<string | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [showAttachmentInput, setShowAttachmentInput] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true); // B6: mobile toggle
  const [searchQuery, setSearchQuery] = useState(''); // C11: message search
  const [showSearch, setShowSearch] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null); // C12: edit
  const [editText, setEditText] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null); // C13: reply
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null); // C10: reactions
  const [clientSearch, setClientSearch] = useState('');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);
  const markedAsReadRef = useRef<Set<string>>(new Set()); // A5: mark-as-read only once

  // --- Data Fetching with stable query objects ---
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', ACTIVE_MEMBERS_QUERY);
  const { data: portalAccess } = useCollection<ClientPortalAccess>('clientPortalAccess', { ...ACTIVE_PORTAL_QUERY, skipTeamFilter: true });
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  const { data: projects } = useCollection<Project>('projects', { skipTeamFilter: true });
  const { data: userProfiles } = useCollection<UserProfile>('userProfiles');
  const { data: teams } = useCollection<any>('teams');

  // A1: Fetch ALL messages for unread counts across all channels
  const { data: allMessages } = useCollection<ChatMessage>('messages', { skipTeamFilter: true });

  // Memoize channel message query to prevent infinite re-subscribes
  const channelMsgQuery = useMemo(() => ({
    where: [{ field: 'channelId', operator: '==', value: activeChannel }],
    orderBy: { field: 'createdAt', direction: 'asc' as const },
    skipTeamFilter: true,
  }), [activeChannel]);

  const { data: channelMessages, loading: channelPending, error: channelError } = useCollection<ChatMessage>('messages', channelMsgQuery);

  // Memoize direct message query
  const directMsgQuery = useMemo(() => {
    if (!user?.uid || chatMode !== 'direct') return undefined;
    return {
      where: [{ field: 'senderId', operator: '==', value: user.uid }],
      skipTeamFilter: true,
    };
  }, [user?.uid, chatMode]);

  const directMsgReceivedQuery = useMemo(() => {
    if (!user?.uid || chatMode !== 'direct') return undefined;
    return {
      where: [{ field: 'receiverId', operator: '==', value: user.uid }],
      skipTeamFilter: true,
    };
  }, [user?.uid, chatMode]);

  const { data: sentDirectMessages, loading: sentPending } = useCollection<ChatMessage>(
    'messages',
    directMsgQuery
  );
  const { data: receivedDirectMessages, loading: receivedPending } = useCollection<ChatMessage>(
    'messages',
    directMsgReceivedQuery
  );

  // Merge & deduplicate sent + received direct messages
  const allDirectMessages = useMemo(() => {
    if (chatMode !== 'direct') return [];
    const all = [...(sentDirectMessages || []), ...(receivedDirectMessages || [])];
    const seen = new Set<string>();
    return all.filter(m => {
      if (!m.channelId && !seen.has(m.id)) {
        seen.add(m.id);
        return true;
      }
      return false;
    });
  }, [chatMode, sentDirectMessages, receivedDirectMessages]);

  const directMessages = useMemo(() =>
    allDirectMessages.filter(m =>
      (m.senderId === user?.uid && m.receiverId === activeDirectUserId) ||
      (m.senderId === activeDirectUserId && m.receiverId === user?.uid)
    ),
    [allDirectMessages, user?.uid, activeDirectUserId]
  );

  const messages = chatMode === 'channel' ? channelMessages : directMessages;
  const isPending = chatMode === 'channel' ? channelPending : (sentPending || receivedPending);
  const error = chatMode === 'channel' ? channelError : null;

  // C11: filtered messages by search
  const filteredMessages = useMemo(() => {
    if (!messages) return [];
    // Filter out deleted messages
    const visible = messages.filter(m => !(m as any).deletedAt);
    if (!searchQuery.trim()) return visible;
    const q = searchQuery.toLowerCase();
    return visible.filter(m => m.content.toLowerCase().includes(q));
  }, [messages, searchQuery]);

  const profileMap = useMemo(() => {
    const map = new Map<string, UserProfile>();
    userProfiles?.forEach(p => map.set(p.userId, p));
    return map;
  }, [userProfiles]);

  const directConversations = useMemo(() => {
    if (!allDirectMessages.length || !user) return [];
    const userIds = new Set<string>();
    allDirectMessages.forEach(m => {
      if (m.senderId !== user.uid) userIds.add(m.senderId);
      if (m.receiverId && m.receiverId !== user.uid) userIds.add(m.receiverId);
    });
    return Array.from(userIds);
  }, [allDirectMessages, user]);

  // Memoize unread counts for direct conversations
  const directUnreadMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!user) return map;
    allDirectMessages.forEach(m => {
      if (m.senderId !== user.uid && m.receiverId === user.uid && !m.isRead) {
        map.set(m.senderId, (map.get(m.senderId) || 0) + 1);
      }
    });
    return map;
  }, [allDirectMessages, user]);

  // A1: Unread counts for ALL channels (not just active)
  const channelUnreadMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!user || !allMessages) return map;
    allMessages.forEach(m => {
      if (m.channelId && !m.isRead && m.senderId !== user.uid && !(m as any).deletedAt) {
        map.set(m.channelId, (map.get(m.channelId) || 0) + 1);
      }
    });
    return map;
  }, [allMessages, user]);

  const otherMembers = useMemo(
    () => teamMembers?.filter(m => m.userId !== user?.uid) || [],
    [teamMembers, user?.uid]
  );

  const messageMutation = useMutation<ChatMessage>('messages');
  const notificationMutation = useMutation<any>('notifications');
  const isSending = messageMutation.loading;

  // C9: Typing indicator
  const typingMutation = useMutation<any>('typingIndicators');
  const { data: typingIndicators } = useCollection<any>('typingIndicators', { skipTeamFilter: true });
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeTypingUsers = useMemo(() => {
    if (!typingIndicators || !user) return [];
    const now = Date.now();
    const channelOrDm = chatMode === 'channel' ? activeChannel : `dm-${activeDirectUserId}`;
    return typingIndicators.filter((t: any) =>
      t.channelId === channelOrDm &&
      t.userId !== user.uid &&
      t.timestamp &&
      (now - (t.timestamp instanceof Date ? t.timestamp.getTime() : t.timestamp?.toMillis?.() ?? 0)) < 5000
    );
  }, [typingIndicators, user, chatMode, activeChannel, activeDirectUserId]);

  const handleTyping = useCallback(() => {
    if (!user) return;
    const channelOrDm = chatMode === 'channel' ? activeChannel : `dm-${activeDirectUserId}`;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    // Update or create typing indicator
    const existing = typingIndicators?.find((t: any) => t.userId === user.uid && t.channelId === channelOrDm);
    if (existing) {
      typingMutation.update(existing.id, { timestamp: new Date() }).catch(() => {});
    } else {
      typingMutation.create({ userId: user.uid, channelId: channelOrDm, timestamp: new Date() } as any).catch(() => {});
    }
    // Auto-clear after 3s of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      const ex = typingIndicators?.find((t: any) => t.userId === user.uid && t.channelId === channelOrDm);
      if (ex) typingMutation.remove(ex.id).catch(() => {});
    }, 3000);
  }, [user, chatMode, activeChannel, activeDirectUserId, typingIndicators, typingMutation]);

  // Auto-scroll only when message count actually changes
  useEffect(() => {
    const currentCount = filteredMessages?.length || 0;
    if (currentCount > prevMessageCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevMessageCountRef.current = currentCount;
  }, [filteredMessages?.length]);

  const getUserDisplayName = useCallback((userId: string) => {
    if (userId === user?.uid) return user?.displayName || user?.email?.split('@')[0] || 'Ti';
    const profile = profileMap.get(userId);
    if (profile?.displayName) return profile.displayName;
    const member = teamMembers?.find(m => m.userId === userId);
    if (member?.displayName) return member.displayName;
    if (member?.email) return member.email.split('@')[0];
    // Check if team owner/admin
    const ownerTeam = teams?.find((t: any) => t.createdByUserId === userId);
    if (ownerTeam) return 'Admin';
    return `User ${userId.slice(0, 6)}`;
  }, [user, profileMap, teamMembers, teams]);

  const getAvatarColor = useCallback((id: string) => {
    const colors = [
      'bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500',
      'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500', 'bg-teal-500',
    ];
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }, []);

  // A2+A3: Send message with senderType and notifications
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!messageText.trim() && !attachmentUrl.trim()) || !user) return;

    try {
      const isClientChannel = activeChannel.startsWith('client-');
      const baseMessage: Partial<ChatMessage> = {
        content: messageText || '📎 Attachment',
        senderId: user.uid,
        isRead: false,
        attachmentUrl: attachmentUrl.trim() || undefined,
        ...(isClientChannel && chatMode === 'channel' ? { senderType: 'staff' as const } : {}),
        ...(replyingTo ? {
          replyToId: replyingTo.id,
          replyToContent: replyingTo.content.slice(0, 100),
          replyToSender: getUserDisplayName(replyingTo.senderId),
        } : {}),
      };

      if (chatMode === 'channel') {
        await messageMutation.create({ ...baseMessage, channelId: activeChannel } as Omit<ChatMessage, 'id'>);

        // A2: Notify client portal users when staff writes to client channel
        if (isClientChannel) {
          const match = activeChannel.match(/^client-(.+?)(?:-project-(.+))?$/);
          if (match) {
            const custId = match[1];
            const projId = match[2];
            // Find portal access for this customer
            const pa = portalAccess?.find(a => a.customerId === custId);
            if (pa) {
              const customer = customers?.find(c => c.id === custId);
              const projectName = projId ? projects?.find(p => p.id === projId)?.name : null;
              const title = projectName
                ? `Mesazh i ri nga stafi - ${projectName}`
                : `Mesazh i ri nga stafi - ${customer?.name || 'Biseda'}`;
              // Notify the portal user
              try {
                await notificationMutation.create({
                  userId: (pa as any).userId || custId,
                  type: 'staff_message',
                  title,
                  message: (messageText || '📎 Attachment').slice(0, 100),
                  isRead: false,
                  linkTo: activeChannel,
                } as any);
              } catch { /* don't block */ }
            }
          }
        }
      } else if (activeDirectUserId) {
        await messageMutation.create({ ...baseMessage, receiverId: activeDirectUserId } as Omit<ChatMessage, 'id'>);
      }
      setMessageText('');
      setAttachmentUrl('');
      setShowAttachmentInput(false);
      setReplyingTo(null);
      // Clear typing indicator
      const channelOrDm = chatMode === 'channel' ? activeChannel : `dm-${activeDirectUserId}`;
      const ex = typingIndicators?.find((t: any) => t.userId === user.uid && t.channelId === channelOrDm);
      if (ex) typingMutation.remove(ex.id).catch(() => {});
    } catch (err) {
      toast({
        title: 'Dërgimi dështoi',
        description: err instanceof Error ? err.message : 'Gabim i panjohur',
        variant: 'destructive',
      });
    }
  };

  // C12: Edit message
  const handleEditMessage = async (msgId: string) => {
    if (!editText.trim()) return;
    try {
      await messageMutation.update(msgId, { content: editText, editedAt: new Date() } as any);
      setEditingMessageId(null);
      setEditText('');
    } catch {
      toast({ title: 'Gabim', description: 'Nuk u ndryshua mesazhi.', variant: 'destructive' });
    }
  };

  // C12: Delete message (soft delete)
  const handleDeleteMessage = async (msgId: string) => {
    try {
      await messageMutation.update(msgId, { deletedAt: new Date(), content: 'Ky mesazh u fshi.' } as any);
    } catch {
      toast({ title: 'Gabim', description: 'Nuk u fshi mesazhi.', variant: 'destructive' });
    }
  };

  // C10: Toggle emoji reaction
  const handleReaction = async (msgId: string, emoji: string) => {
    if (!user) return;
    const msg = messages?.find(m => m.id === msgId);
    if (!msg) return;
    const reactions = { ...((msg as any).reactions || {}) };
    const users = reactions[emoji] ? [...reactions[emoji]] : [];
    const idx = users.indexOf(user.uid);
    if (idx >= 0) {
      users.splice(idx, 1);
    } else {
      users.push(user.uid);
    }
    if (users.length === 0) {
      delete reactions[emoji];
    } else {
      reactions[emoji] = users;
    }
    try {
      await messageMutation.update(msgId, { reactions } as any);
    } catch { /* silent */ }
    setShowEmojiPicker(null);
  };

  const handleSelectChannel = useCallback((channelId: string) => {
    setChatMode('channel');
    setActiveChannel(channelId);
    setActiveDirectUserId(null);
    setShowSidebar(false); // B6: auto-hide sidebar on mobile
    setShowSearch(false);
    setSearchQuery('');
    setReplyingTo(null);
  }, []);

  const handleSelectDirectMessage = useCallback((userId: string) => {
    setChatMode('direct');
    setActiveDirectUserId(userId);
    setShowSidebar(false); // B6: auto-hide sidebar on mobile
    setShowSearch(false);
    setSearchQuery('');
    setReplyingTo(null);
  }, []);

  // A5: Mark messages as read only once
  useEffect(() => {
    if (!activeDirectUserId || !user || chatMode !== 'direct') return;
    const unread = allDirectMessages.filter(
      m => m.senderId === activeDirectUserId && m.receiverId === user.uid && !m.isRead && !markedAsReadRef.current.has(m.id)
    );
    unread.forEach(m => {
      markedAsReadRef.current.add(m.id);
      messageMutation.update(m.id, { isRead: true });
    });
  }, [activeDirectUserId, allDirectMessages, user, chatMode]);

  // Mark channel messages as read
  useEffect(() => {
    if (chatMode !== 'channel' || !user || !channelMessages) return;
    const unread = channelMessages.filter(
      m => m.senderId !== user.uid && !m.isRead && !markedAsReadRef.current.has(m.id)
    );
    unread.forEach(m => {
      markedAsReadRef.current.add(m.id);
      messageMutation.update(m.id, { isRead: true });
    });
  }, [chatMode, channelMessages, user]);

  // Date formatting helpers
  const formatDate = (date: any) => {
    if (!date) return '';
    const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Sot';
    if (diffDays === 1) return 'Dje';
    return d.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' });
  };

  const getDateKey = (date: any) => {
    if (!date) return '';
    const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };

  const totalUnread = useMemo(() => {
    let count = 0;
    CHANNELS.forEach(c => { count += channelUnreadMap.get(c.id) || 0; });
    directConversations.forEach(uid => { count += directUnreadMap.get(uid) || 0; });
    return count;
  }, [channelUnreadMap, directUnreadMap, directConversations]);

  if (isPending) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">Duke ngarkuar bisedën...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-destructive text-sm">Gabim: {error.message}</div>
      </div>
    );
  }

  // --- SIDEBAR ---
  const sidebarContent = (
    <div className="flex flex-col py-2">
      {/* Channels — shown in 'all' or 'projects' tab */}
      {(sidebarTab === 'all' || sidebarTab === 'projects') && (
        <div className="px-2 pb-2">
          <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Projekte</p>
          <div className="space-y-0.5">
            {CHANNELS.map((channel) => {
              const isActive = chatMode === 'channel' && activeChannel === channel.id;
              const unreadCount = channelUnreadMap.get(channel.id) || 0;
              return (
                <button
                  key={channel.id}
                  onClick={() => handleSelectChannel(channel.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors text-left text-sm ${
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-foreground/70 hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <span className={`text-[11px] font-bold ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>#</span>
                  <span className="flex-1 truncate">{channel.name}</span>
                  {unreadCount > 0 && !isActive && (
                    <span className="h-[18px] min-w-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                      {unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Client Channels */}
      {(sidebarTab === 'all' || sidebarTab === 'clients') && portalAccess && portalAccess.length > 0 && (
        <div className="px-2 pb-2">
          {sidebarTab === 'all' && <div className="h-px bg-border/50 mx-2 my-2" />}
          <p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Klientët</p>
          <div className="relative px-1 mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              placeholder="Emri, telefon, NIPT..."
              className="h-8 pl-8 pr-7 text-xs rounded-lg bg-muted/50 border-0 focus-visible:ring-1"
            />
            {clientSearch && (
              <button
                onClick={() => setClientSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="space-y-0.5 max-h-[40vh] overflow-y-auto">
            {(() => {
              const q = clientSearch.toLowerCase().trim();
              const filtered = portalAccess.filter((access) => {
                if (!q) return true;
                const customer = customers?.find(c => c.id === access.customerId);
                return (
                  customer?.name?.toLowerCase().includes(q) ||
                  customer?.phone?.toLowerCase().includes(q) ||
                  (customer as any)?.taxId?.toLowerCase().includes(q) ||
                  customer?.email?.toLowerCase().includes(q) ||
                  customer?.company?.toLowerCase().includes(q) ||
                  access.email?.toLowerCase().includes(q)
                );
              });
              if (filtered.length === 0) {
                return (
                  <p className="text-xs text-muted-foreground text-center py-3">
                    {q ? 'Nuk u gjet asnjë klient' : 'Nuk ka klientë'}
                  </p>
                );
              }
              return filtered.map((access) => {
                const customer = customers?.find(c => c.id === access.customerId);
                const clientChannelId = `client-${access.customerId}`;
                const isClientActive = chatMode === 'channel' && activeChannel === clientChannelId;
                const clientUnread = channelUnreadMap.get(clientChannelId) || 0;
                const clientProjects = projects?.filter(p => p.customerId === access.customerId) || [];
                return (
                  <div key={access.id}>
                    <button
                      onClick={() => handleSelectChannel(clientChannelId)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors text-left text-sm ${
                        isClientActive
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-foreground/70 hover:bg-accent hover:text-foreground'
                      }`}
                    >
                      <div className="h-6 w-6 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                          {(customer?.name || 'K')[0]}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="truncate block text-sm">{customer?.name || access.email}</span>
                        {customer?.phone && (
                          <span className="text-[10px] text-muted-foreground truncate block">{customer.phone}</span>
                        )}
                      </div>
                      {clientUnread > 0 && !isClientActive && (
                        <span className="h-[18px] min-w-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                          {clientUnread}
                        </span>
                      )}
                    </button>
                    {clientProjects.length > 0 && (
                      <div className="ml-5 pl-3 border-l border-border/50 space-y-0.5 mt-0.5">
                        {clientProjects.map((proj) => {
                          const projChannelId = `client-${access.customerId}-project-${proj.id}`;
                          const isProjActive = chatMode === 'channel' && activeChannel === projChannelId;
                          const projUnread = channelUnreadMap.get(projChannelId) || 0;
                          return (
                            <button
                              key={proj.id}
                              onClick={() => handleSelectChannel(projChannelId)}
                              className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors text-left text-xs ${
                                isProjActive
                                  ? 'bg-primary/10 text-primary font-medium'
                                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                              }`}
                            >
                              <FolderOpen className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate flex-1">{proj.name}</span>
                              {projUnread > 0 && !isProjActive && (
                                <span className="h-4 min-w-4 px-1 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold">
                                  {projUnread}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* Direct Messages */}
      {(sidebarTab === 'all' || sidebarTab === 'dm') && (
      <div className="px-2 pb-3">
        {sidebarTab === 'all' && <div className="h-px bg-border/50 mx-2 my-2" />}
        <p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Mesazhe Direkte</p>
        <div className="space-y-0.5">
          {directConversations.map((userId) => {
            const unreadCount = directUnreadMap.get(userId) || 0;
            const isActive = chatMode === 'direct' && activeDirectUserId === userId;
            const name = getUserDisplayName(userId);
            return (
              <button
                key={userId}
                onClick={() => handleSelectDirectMessage(userId)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors text-left text-sm ${
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground/70 hover:bg-accent hover:text-foreground'
                }`}
              >
                <div className="relative flex-shrink-0">
                  <div className={`h-7 w-7 rounded-full ${getAvatarColor(userId)} flex items-center justify-center`}>
                    <span className="text-[10px] font-bold text-white">{name.slice(0, 2).toUpperCase()}</span>
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-background" />
                </div>
                <span className="flex-1 truncate">{name}</span>
                {unreadCount > 0 && !isActive && (
                  <span className="h-[18px] min-w-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                    {unreadCount}
                  </span>
                )}
              </button>
            );
          })}

          {otherMembers.filter(m => !directConversations.includes(m.userId)).length > 0 && (
            <>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 px-3 pt-3 pb-1 font-semibold">Anëtarë</p>
              {otherMembers
                .filter(m => !directConversations.includes(m.userId))
                .map((member) => {
                  const name = getUserDisplayName(member.userId);
                  const isActive = chatMode === 'direct' && activeDirectUserId === member.userId;
                  return (
                    <button
                      key={member.id}
                      onClick={() => handleSelectDirectMessage(member.userId)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors text-left text-sm ${
                        isActive
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-foreground/70 hover:bg-accent hover:text-foreground'
                      }`}
                    >
                      <div className="relative flex-shrink-0">
                        <div className={`h-7 w-7 rounded-full ${getAvatarColor(member.userId)} flex items-center justify-center`}>
                          <span className="text-[10px] font-bold text-white">{name.slice(0, 2).toUpperCase()}</span>
                        </div>
                        <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-gray-400 border-2 border-background" />
                      </div>
                      <span className="flex-1 truncate">{name}</span>
                    </button>
                  );
                })}
            </>
          )}

          {otherMembers.length === 0 && directConversations.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              Nuk ka anëtarë të tjerë
            </p>
          )}
        </div>
      </div>
      )}

      {/* Aprovime tab */}
      {sidebarTab === 'approvals' && (
        <div className="px-2 pt-2 pb-3">
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Aprovime</p>
          <div className="space-y-1 mt-1">
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-accent cursor-pointer transition-colors">
              <div className="h-7 w-7 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">Logo Approval</p>
                <p className="text-[10px] text-muted-foreground">Në pritje</p>
              </div>
              <span className="h-[18px] min-w-[18px] px-1 flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold">2</span>
            </div>
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-accent cursor-pointer transition-colors">
              <div className="h-7 w-7 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                <Eye className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">Brief Sign-off</p>
                <p className="text-[10px] text-muted-foreground">Aprovuar</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const SIDEBAR_TABS: { id: SidebarTab; label: string }[] = [
    { id: 'all', label: 'Të gjitha' },
    { id: 'projects', label: 'Projekte' },
    { id: 'clients', label: 'Klientë' },
    { id: 'dm', label: 'DM' },
    { id: 'approvals', label: 'Aprovim' },
  ];

  return (
    <div className="flex flex-col h-[calc(100dvh-96px)] sm:h-[calc(100dvh-120px)] lg:h-[calc(100dvh-136px)]">
      {/* Compact top bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-background">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold tracking-tight text-foreground">Biseda</h1>
          {totalUnread > 0 && (
            <span className="h-[18px] min-w-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
              {totalUnread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
            <Bell className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden h-8"
            onClick={() => setShowSidebar(!showSidebar)}
          >
            {showSidebar ? <X className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className={`w-60 lg:w-64 border-r bg-muted/10 flex-shrink-0 flex flex-col ${showSidebar ? 'flex' : 'hidden lg:flex'}`}>
          {/* Sidebar Tabs — underline style */}
          <div className="flex border-b border-border/50 px-1 overflow-x-auto">
            {SIDEBAR_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setSidebarTab(tab.id)}
                className={`flex-shrink-0 px-3 py-2.5 text-xs font-medium transition-all border-b-2 -mb-px ${
                  sidebarTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {sidebarContent}
          </div>
        </div>

        {/* Chat Area */}
        <div className={`flex-1 flex flex-col min-w-0 ${!showSidebar ? 'flex' : 'hidden lg:flex'}`}>
          {/* Chat header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b bg-background/80 backdrop-blur-sm">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden h-8 w-8 flex-shrink-0 -ml-1"
              onClick={() => setShowSidebar(true)}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>

            {chatMode === 'channel' ? (
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                {activeChannel.startsWith('client-') ? (
                  <>
                    <div className="h-8 w-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                      <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">
                        {(() => {
                          const match = activeChannel.match(/^client-(.+?)-project-(.+)$/);
                          if (match) {
                            const customer = customers?.find(c => c.id === match[1]);
                            const project = projects?.find(p => p.id === match[2]);
                            return `${customer?.name || 'Klient'} — ${project?.name || 'Projekt'}`;
                          }
                          const custId = activeChannel.replace('client-', '');
                          const customer = customers?.find(c => c.id === custId);
                          return customer?.name || 'Klient';
                        })()}
                      </p>
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Link2 className="h-2.5 w-2.5" />
                        {(() => {
                          const match = activeChannel.match(/^client-(.+?)-project-(.+)$/);
                          if (match) {
                            const project = projects?.find(p => p.id === match[2]);
                            return project?.name ? `Lidhur me: ${project.name}` : 'Kanal projekti';
                          }
                          return 'Kanal klienti';
                        })()}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      {React.createElement(CHANNELS.find(c => c.id === activeChannel)?.icon || Hash, {
                        className: 'h-4 w-4 text-primary'
                      })}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">
                        #{CHANNELS.find(c => c.id === activeChannel)?.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {CHANNELS.find(c => c.id === activeChannel)?.description}
                      </p>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                {activeDirectUserId ? (
                  <>
                    <div className="relative flex-shrink-0">
                      <div className={`h-8 w-8 rounded-full ${getAvatarColor(activeDirectUserId)} flex items-center justify-center`}>
                        <span className="text-[10px] font-bold text-white">{getUserDisplayName(activeDirectUserId).slice(0, 2).toUpperCase()}</span>
                      </div>
                      <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-background" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{getUserDisplayName(activeDirectUserId)}</p>
                      <p className="text-[11px] text-emerald-600">Aktiv</p>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Zgjidh një person</p>
                )}
              </div>
            )}

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => { setShowSearch(!showSearch); setSearchQuery(''); }}
              >
                <Search className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Bell className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Search bar */}
          {showSearch && (
            <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
              <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Kërko në mesazhe..."
                className="h-7 text-sm border-0 bg-transparent focus-visible:ring-0 shadow-none"
                autoFocus
              />
              <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={() => { setShowSearch(false); setSearchQuery(''); }}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Messages */}
          <ScrollArea className="flex-1" ref={scrollRef}>
            <div className="px-4 py-4 space-y-0">
              {filteredMessages.length > 0 ? (
                (() => {
                  let lastDateKey = '';
                  return filteredMessages.map((message, idx) => {
                    const isOwn = message.senderId === user?.uid;
                    const dateKey = getDateKey(message.createdAt);
                    const showDateSep = dateKey !== lastDateKey;
                    lastDateKey = dateKey;
                    const prevMsg = idx > 0 ? filteredMessages[idx - 1] : null;
                    const sameSender = prevMsg && prevMsg.senderId === message.senderId && !showDateSep;
                    const isDeleted = !!(message as any).deletedAt;
                    const isEditing = editingMessageId === message.id;
                    const senderName = getUserDisplayName(message.senderId);

                    return (
                      <React.Fragment key={message.id}>
                        {showDateSep && (
                          <div className="flex items-center gap-3 py-5">
                            <div className="flex-1 h-px bg-border/60" />
                            <span className="text-[11px] font-medium text-muted-foreground/70 bg-background px-2">{formatDate(message.createdAt)}</span>
                            <div className="flex-1 h-px bg-border/60" />
                          </div>
                        )}
                        <div
                          className={`flex group ${isOwn ? 'justify-end' : 'justify-start'} ${sameSender ? 'mt-0.5' : 'mt-3'}`}
                        >
                          {/* Avatar for other users */}
                          {!isOwn && (
                            <div className="flex-shrink-0 mr-2.5 self-end mb-5">
                              {!sameSender ? (
                                <div className={`h-7 w-7 rounded-full ${getAvatarColor(message.senderId)} flex items-center justify-center shadow-sm`}>
                                  <span className="text-[10px] font-bold text-white">{senderName.slice(0, 2).toUpperCase()}</span>
                                </div>
                              ) : (
                                <div className="w-7" />
                              )}
                            </div>
                          )}

                          <div className={`max-w-[72%] sm:max-w-[60%] flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
                            {/* Sender name + badge */}
                            {!isOwn && !sameSender && (
                              <div className="flex items-center gap-1.5 mb-1 ml-1">
                                <span className="text-[12px] font-semibold text-foreground/80">{senderName}</span>
                                {(message as any).senderType === 'client' && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">Klient</span>
                                )}
                              </div>
                            )}

                            {/* Reply preview */}
                            {(message as any).replyToContent && (
                              <div className={`text-[11px] px-2.5 py-1.5 mb-1 rounded-lg max-w-full border-l-2 ${
                                isOwn
                                  ? 'bg-primary/15 border-primary-foreground/40'
                                  : 'bg-muted/60 border-primary/40'
                              }`}>
                                <span className="font-semibold text-[10px] text-primary">{(message as any).replyToSender}</span>
                                <p className="truncate opacity-60 mt-0.5">{(message as any).replyToContent}</p>
                              </div>
                            )}

                            {/* Message bubble */}
                            <div
                              className={`relative px-3.5 py-2 ${
                                isOwn
                                  ? 'bg-primary text-primary-foreground rounded-2xl rounded-br-sm'
                                  : 'bg-muted rounded-2xl rounded-bl-sm'
                              } ${isDeleted ? 'opacity-40 italic' : ''}`}
                            >
                              {/* Edit mode */}
                              {isEditing ? (
                                <div className="flex gap-1.5 items-center min-w-[160px]">
                                  <Input
                                    value={editText}
                                    onChange={(e) => setEditText(e.target.value)}
                                    className="h-7 text-xs bg-background text-foreground rounded-lg"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleEditMessage(message.id);
                                      if (e.key === 'Escape') { setEditingMessageId(null); setEditText(''); }
                                    }}
                                  />
                                  <Button size="icon" variant="ghost" className="h-6 w-6 flex-shrink-0" onClick={() => handleEditMessage(message.id)}>
                                    <Check className="h-3 w-3" />
                                  </Button>
                                </div>
                              ) : (
                                <p className="text-[13.5px] leading-relaxed break-words whitespace-pre-wrap">{message.content}</p>
                              )}

                              {/* Attachment */}
                              {message.attachmentUrl && (
                                <a
                                  href={message.attachmentUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`inline-flex items-center gap-1.5 text-xs mt-1.5 px-2 py-1 rounded-md transition-colors ${
                                    isOwn
                                      ? 'bg-primary-foreground/15 hover:bg-primary-foreground/25'
                                      : 'bg-background/80 hover:bg-accent text-primary'
                                  }`}
                                >
                                  <FileIcon className="h-3 w-3" />
                                  <span className="truncate max-w-[140px]">{message.attachmentUrl.split('/').pop() || 'Skedar'}</span>
                                </a>
                              )}

                              {/* Hover action bar */}
                              {!isDeleted && !isEditing && (
                                <div className={`absolute -top-3 ${isOwn ? 'left-1' : 'right-1'} opacity-0 group-hover:opacity-100 transition-opacity flex items-center bg-background border rounded-full shadow-sm px-1 py-0.5 z-10 gap-0.5`}>
                                  <div className="relative">
                                    <button
                                      className="p-1 hover:bg-accent rounded-full text-muted-foreground hover:text-foreground transition-colors"
                                      onClick={() => setShowEmojiPicker(showEmojiPicker === message.id ? null : message.id)}
                                    >
                                      <SmilePlus className="h-3.5 w-3.5" />
                                    </button>
                                    {showEmojiPicker === message.id && (
                                      <div className={`absolute bottom-full ${isOwn ? 'left-0' : 'right-0'} mb-1 flex gap-0.5 bg-popover border rounded-full shadow-lg px-2 py-1 z-50`}>
                                        {EMOJI_REACTIONS.map(emoji => (
                                          <button
                                            key={emoji}
                                            onClick={() => handleReaction(message.id, emoji)}
                                            className="hover:scale-125 transition-transform p-0.5 text-base"
                                          >
                                            {emoji}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <button className="p-1 hover:bg-accent rounded-full text-muted-foreground hover:text-foreground transition-colors" onClick={() => setReplyingTo(message)}>
                                    <Reply className="h-3.5 w-3.5" />
                                  </button>
                                  {isOwn && (
                                    <>
                                      <button className="p-1 hover:bg-accent rounded-full text-muted-foreground hover:text-foreground transition-colors" onClick={() => { setEditingMessageId(message.id); setEditText(message.content); }}>
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                      <button className="p-1 hover:bg-destructive/10 rounded-full text-muted-foreground hover:text-destructive transition-colors" onClick={() => handleDeleteMessage(message.id)}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Reactions */}
                            {(message as any).reactions && Object.keys((message as any).reactions).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1 px-0.5">
                                {Object.entries((message as any).reactions as Record<string, string[]>).map(([emoji, users]) => (
                                  <button
                                    key={emoji}
                                    onClick={() => handleReaction(message.id, emoji)}
                                    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] border transition-colors ${
                                      users.includes(user?.uid || '')
                                        ? 'bg-primary/10 border-primary/30 font-semibold'
                                        : 'bg-background border-border hover:border-primary/30'
                                    }`}
                                  >
                                    {emoji} <span className="text-[10px]">{users.length}</span>
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Timestamp */}
                            <span className={`text-[10px] text-muted-foreground/50 mt-1 px-0.5 flex items-center gap-1 ${
                              isOwn ? 'flex-row-reverse' : ''
                            }`}>
                              {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              {(message as any).editedAt && <span className="opacity-60"> · ndryshuar</span>}
                              {isOwn && <Check className="h-2.5 w-2.5 opacity-50" />}
                            </span>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  });
                })()
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                  <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                    <MessageSquare className="h-5 w-5 opacity-40" />
                  </div>
                  <p className="text-sm font-medium text-foreground/60">
                    {searchQuery
                      ? 'Nuk u gjet asnjë mesazh'
                      : chatMode === 'direct' && !activeDirectUserId
                        ? 'Zgjidh një person për të biseduar'
                        : 'Fillo bisedën!'}
                  </p>
                  {!searchQuery && chatMode === 'channel' && (
                    <p className="text-xs text-muted-foreground/50 mt-1">Nuk ka mesazhe ende në këtë kanal</p>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Typing indicator */}
          {activeTypingUsers.length > 0 && (
            <div className="px-4 py-1 text-xs text-muted-foreground flex items-center gap-2">
              <span className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" />
              </span>
              {activeTypingUsers.map((t: any) => getUserDisplayName(t.userId)).join(', ')} po shkruan...
            </div>
          )}

          {/* Reply preview */}
          {replyingTo && (
            <div className="mx-4 mb-1.5 flex items-center gap-2 px-3 py-1.5 bg-muted/40 rounded-lg border-l-2 border-primary">
              <Reply className="h-3 w-3 text-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-semibold text-primary">{getUserDisplayName(replyingTo.senderId)}</span>
                <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">{replyingTo.content}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-5 w-5 flex-shrink-0 rounded-full" onClick={() => setReplyingTo(null)}>
                <X className="h-2.5 w-2.5" />
              </Button>
            </div>
          )}

          {/* Input area */}
          <div className="px-4 pt-2 pb-3 border-t bg-background/95">
            {showAttachmentInput && (
              <div className="flex gap-2 items-center px-3 py-1.5 mb-2 bg-muted/40 rounded-xl border border-border/50">
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <Input
                  value={attachmentUrl}
                  onChange={(e) => setAttachmentUrl(e.target.value)}
                  placeholder="Ngjit URL skedari..."
                  disabled={isSending}
                  className="h-7 text-xs border-0 bg-transparent focus-visible:ring-0 shadow-none min-w-0"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0 rounded-full"
                  onClick={() => { setShowAttachmentInput(false); setAttachmentUrl(''); }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
            <form onSubmit={handleSendMessage}>
              <div className="flex items-center gap-0.5 bg-muted/30 border border-border/40 rounded-2xl px-2.5 py-1 focus-within:border-primary/40 focus-within:bg-background focus-within:shadow-sm transition-all">
                {/* Left toolbar */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="flex-shrink-0 h-7 w-7 rounded-full text-muted-foreground/70 hover:text-foreground hover:bg-accent"
                  onClick={() => setShowAttachmentInput(!showAttachmentInput)}
                  disabled={isSending}
                  title="Bashkangjit skedar"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="flex-shrink-0 h-7 w-7 rounded-full text-muted-foreground/70 hover:text-foreground hover:bg-accent"
                  disabled={isSending}
                  title="Emoji"
                  onClick={() => setShowEmojiPicker(showEmojiPicker ? null : 'input')}
                >
                  <SmilePlus className="h-3.5 w-3.5" />
                </Button>

                <Input
                  value={messageText}
                  onChange={(e) => {
                    setMessageText(e.target.value);
                    if (e.target.value) handleTyping();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(e as any);
                    }
                  }}
                  placeholder={`Shkruaj${chatMode === 'channel' ? ` në #${CHANNELS.find(c => c.id === activeChannel)?.name || activeChannel}` : ` te ${getUserDisplayName(activeDirectUserId || '')}`}...`}
                  disabled={isSending}
                  className="flex-1 min-w-0 h-8 border-0 bg-transparent focus-visible:ring-0 shadow-none text-sm placeholder:text-muted-foreground/50"
                />

                <Button
                  type="submit"
                  size="icon"
                  className={`flex-shrink-0 h-7 w-7 rounded-full transition-all ${
                    messageText.trim() || attachmentUrl.trim()
                      ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                      : 'bg-transparent text-muted-foreground/40 cursor-default'
                  }`}
                  disabled={isSending || (!messageText.trim() && !attachmentUrl.trim()) || (chatMode === 'direct' && !activeDirectUserId)}
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            </form>
            {/* Bottom hint */}
            <div className="flex items-center justify-between mt-1 px-1">
              <p className="text-[10px] text-muted-foreground/40">Enter dërgon · Shift+Enter rresht i ri</p>
              <button className="text-[10px] text-muted-foreground/40 hover:text-primary transition-colors flex items-center gap-1">
                <Link2 className="h-2.5 w-2.5" />
                Lidh me task / faturë
              </button>
            </div>
            {messageMutation.error && (
              <p className="text-xs text-destructive mt-1">
                Gabim: {messageMutation.error.message}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatView;
