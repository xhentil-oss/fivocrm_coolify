import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useCollection, useMutation, getGlobalTeamId, useGlobalTeamId, useWhatsappEnabled } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { ScrollArea } from '../components/ui/scroll-area';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Separator } from '../components/ui/separator';
import {
  Send, MessageSquare, Users, Hash, Paperclip, X, FileIcon,
  FolderOpen, ArrowLeft, Search, Pencil, Trash2, Reply,
  SmilePlus, Check, Plus, Link2,
  Bot, Sparkles, Loader2, Copy, RefreshCw, Phone, Smartphone,
  ClipboardList, ExternalLink, UserPlus,
} from 'lucide-react';
import { useToast } from '../hooks/use-toast';
import { normalizeAlbanianPhone } from '../lib/utils';
import { auth, db } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import type { ChatMessage, UserProfile, Customer, ClientPortalAccess, Project, TeamMember, WhatsAppMessage, ClientRequest, Team, Lead } from '../types';

type ChatMode = 'channel' | 'direct' | 'ai' | 'whatsapp' | 'requests';

// AI Quick Actions
const AI_QUICK_ACTIONS = [
  { id: 'email', label: 'Shkruaj Email', prompt: 'Shkruaj një email profesional për: ', icon: '✉️' },
  { id: 'social', label: 'Post Social Media', prompt: 'Shkruaj një post për Instagram/Facebook për: ', icon: '📱' },
  { id: 'proposal', label: 'Propozim', prompt: 'Gjenero një propozim biznesi për: ', icon: '📄' },
  { id: 'tasks', label: 'Planifiko Detyra', prompt: 'Ndihmomë të planifikoj detyrat për: ', icon: '📋' },
  { id: 'reply', label: 'Përgjigje Klientit', prompt: 'Shkruaj një përgjigje profesionale për klientin i cili: ', icon: '💬' },
  { id: 'pricing', label: 'Çmim & Ofertë', prompt: 'Ndihmomë të krijoj një ofertë çmimi për: ', icon: '💰' },
];

interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  isLoading?: boolean;
}

// Channels
const CHANNELS = [
  { id: 'general' as const, name: 'Përgjithshme', icon: Hash, description: 'Diskutime të përgjithshme' },
  { id: 'team' as const, name: 'Ekipi', icon: Users, description: 'Bashkëpunimi i ekipit' },
  { id: 'support' as const, name: 'Mbështetja', icon: MessageSquare, description: 'Mbështetje klienti' },
] as const;

const EMOJI_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

const ACTIVE_MEMBERS_QUERY = {
  where: [{ field: 'status', operator: '==', value: 'Active' }],
};
const ACTIVE_PORTAL_QUERY = {
  where: [{ field: 'status', operator: '==', value: 'Active' }],
};

const ChatView: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  // State
  const [messageText, setMessageText] = useState('');
  const [chatMode, setChatMode] = useState<ChatMode>('channel');
  const [activeChannel, setActiveChannel] = useState<string>('general');
  const [activeDirectUserId, setActiveDirectUserId] = useState<string | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [showAttachmentInput, setShowAttachmentInput] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  // WhatsApp state
  const [activeWaPhone, setActiveWaPhone] = useState<string | null>(null);
  const [activeWaJid, setActiveWaJid] = useState<string | null>(null);
  const [activeWaLeadName, setActiveWaLeadName] = useState('');
  const [activeWaChannel, setActiveWaChannel] = useState<'baileys' | 'meta' | null>(null);
  const [activeWaLeadId, setActiveWaLeadId] = useState<string | null>(null);
  const [convertingToLead, setConvertingToLead] = useState(false);
  const [waText, setWaText] = useState('');
  const [waSending, setWaSending] = useState(false);
  const waScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);
  const markedAsReadRef = useRef<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const prevSeenMsgIdsRef = useRef<Set<string>>(new Set());
  const isInitialMsgLoadRef = useRef(true);

  const playBirdChirp = useCallback(() => {
    try {
      const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new Ctx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      const chirp = (t: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        // Soft frequency sweep — bird chirp feel
        osc.frequency.setValueAtTime(2200, t);
        osc.frequency.exponentialRampToValueAtTime(3800, t + 0.07);
        osc.frequency.exponentialRampToValueAtTime(2600, t + 0.15);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.16, t + 0.02);
        gain.gain.setValueAtTime(0.16, t + 0.10);
        gain.gain.linearRampToValueAtTime(0, t + 0.15);
        osc.start(t);
        osc.stop(t + 0.15);
      };

      const now = ctx.currentTime;
      chirp(now);
      chirp(now + 0.28);
    } catch {
      // Audio not supported — silently ignore
    }
  }, []);

  // AI state
  const [aiMessages, setAiMessages] = useState<AIMessage[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAiActions, setShowAiActions] = useState(true);
  const aiScrollRef = useRef<HTMLDivElement>(null);

  // Data
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', ACTIVE_MEMBERS_QUERY);
  const { data: portalAccess } = useCollection<ClientPortalAccess>('clientPortalAccess', { ...ACTIVE_PORTAL_QUERY, skipTeamFilter: true });
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  const { data: projects } = useCollection<Project>('projects', { skipTeamFilter: true });
  const { data: userProfiles } = useCollection<UserProfile>('userProfiles');
  const { data: teams } = useCollection<Team>('teams');
  const { data: allMessages } = useCollection<ChatMessage>('messages', {
    orderBy: { field: 'createdAt', direction: 'desc' as const },
    limit: 500,
    skipTeamFilter: true,
  });
  const { data: requests, } = useCollection<ClientRequest>('clientRequests', {
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  const requestMutation = useMutation<ClientRequest>('clientRequests');
  const permissions = usePermissions();

  // Requests state
  const [selectedRequest, setSelectedRequest] = useState<ClientRequest | null>(null);
  const [requestStatusFilter, setRequestStatusFilter] = useState<string>('__all__');

  const filteredRequests = useMemo(() => {
    if (!requests) return [];
    if (requestStatusFilter === '__all__') return requests;
    return requests.filter(r => r.status === requestStatusFilter);
  }, [requests, requestStatusFilter]);

  const newRequestsCount = requests?.filter(r => r.status === 'New').length || 0;

  const getReqStatusLabel = (s: string) => {
    const map: Record<string, string> = { New: 'E Re', 'In Review': 'Ne Shqyrtim', 'In Progress': 'Ne Progres', Completed: 'Perfunduar', Rejected: 'Refuzuar' };
    return map[s] ?? s;
  };
  const getReqStatusColor = (s: string) => {
    const map: Record<string, string> = { New: 'bg-blue-100 text-blue-700', 'In Review': 'bg-yellow-100 text-yellow-700', 'In Progress': 'bg-purple-100 text-purple-700', Completed: 'bg-green-100 text-green-700', Rejected: 'bg-red-100 text-red-700' };
    return map[s] ?? 'bg-muted text-muted-foreground';
  };
  const getPriorityColor = (p: string) => {
    const map: Record<string, string> = { low: 'bg-gray-100 text-gray-600', medium: 'bg-amber-100 text-amber-700', high: 'bg-orange-100 text-orange-700', urgent: 'bg-red-100 text-red-700' };
    return map[p] ?? 'bg-muted text-muted-foreground';
  };
  const getPriorityLabel = (p: string) => ({ low: 'E Ulet', medium: 'Mesatare', high: 'E Larte', urgent: 'Urgjente' })[p] ?? p;

  const handleUpdateRequestStatus = async (requestId: string, newStatus: string, adminNotes?: string) => {
    const update: Record<string, any> = { status: newStatus };
    if (adminNotes !== undefined) update.adminNotes = adminNotes;
    await requestMutation.update(requestId, update);
    // Reflect update in selectedRequest without re-opening
    setSelectedRequest(prev => prev?.id === requestId ? { ...prev, status: newStatus as ClientRequest['status'], ...(adminNotes !== undefined ? { adminNotes } : {}) } : prev);
    toast({ title: 'Statusi u perditesua' });
  };

  const handleAssignTeam = async (requestId: string, teamId: string) => {
    await requestMutation.update(requestId, { assignedTeamId: teamId });
    setSelectedRequest(prev => prev?.id === requestId ? { ...prev, assignedTeamId: teamId } : prev);
    toast({ title: 'Ekipi u caktua' });
  };
  const waTeamId = useGlobalTeamId();
  const waEnabled = useWhatsappEnabled();

  // If WhatsApp gets disabled while in whatsapp mode, switch back to channel
  useEffect(() => {
    if (!waEnabled && chatMode === 'whatsapp') {
      setChatMode('channel');
      setActiveWaPhone(null);
      setActiveWaJid(null);
    }
  }, [waEnabled]);
  const waQuery = useMemo(() => ({
    skip: !waEnabled || !waTeamId,
    where: waTeamId ? [{ field: 'teamId', operator: '==' as const, value: waTeamId }] : undefined,
    // No orderBy — avoids composite index requirement; sorting is done client-side
    skipTeamFilter: true,
  }), [waEnabled, waTeamId]);
  const { data: allWaMessages } = useCollection<WhatsAppMessage>('whatsappMessages', waQuery);

  // Client channels (client-*) need skipTeamFilter because portal users may send
  // messages without teamId.  The composite index channelId+createdAt already exists.
  const isClientChannel = activeChannel.startsWith('client-');
  const channelMsgQuery = useMemo(() => ({
    where: [{ field: 'channelId', operator: '==', value: activeChannel }],
    orderBy: { field: 'createdAt', direction: 'asc' as const },
    limit: 100,
    ...(isClientChannel ? { skipTeamFilter: true } : {}),
  }), [activeChannel, isClientChannel]);
  const { data: channelMessages, loading: channelPending, error: channelError } = useCollection<ChatMessage>('messages', channelMsgQuery);

  const directMsgQuery = useMemo(() => ({
    skip: !user?.uid || chatMode !== 'direct',
    where: user?.uid ? [{ field: 'senderId', operator: '==', value: user.uid }] : undefined,
  }), [user?.uid, chatMode]);
  const directMsgReceivedQuery = useMemo(() => ({
    skip: !user?.uid || chatMode !== 'direct',
    where: user?.uid ? [{ field: 'receiverId', operator: '==', value: user.uid }] : undefined,
  }), [user?.uid, chatMode]);

  const { data: sentDirectMessages, loading: sentPending } = useCollection<ChatMessage>('messages', directMsgQuery);
  const { data: receivedDirectMessages, loading: receivedPending } = useCollection<ChatMessage>('messages', directMsgReceivedQuery);

  const allDirectMessages = useMemo(() => {
    if (chatMode !== 'direct') return [];
    const all = [...(sentDirectMessages || []), ...(receivedDirectMessages || [])];
    const seen = new Set<string>();
    return all.filter(m => { if (!m.channelId && !seen.has(m.id)) { seen.add(m.id); return true; } return false; });
  }, [chatMode, sentDirectMessages, receivedDirectMessages]);

  const directMessages = useMemo(() =>
    allDirectMessages.filter(m =>
      (m.senderId === user?.uid && m.receiverId === activeDirectUserId) ||
      (m.senderId === activeDirectUserId && m.receiverId === user?.uid)
    ), [allDirectMessages, user?.uid, activeDirectUserId]);

  const messages = chatMode === 'channel' ? channelMessages : directMessages;
  const isPending = chatMode === 'channel' ? channelPending : (sentPending || receivedPending);
  const error = chatMode === 'channel' ? channelError : null;

  const filteredMessages = useMemo(() => {
    if (!messages) return [];
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

  const otherMembers = useMemo(() => {
    if (!teamMembers) return [];
    const seen = new Set<string>();
    return teamMembers.filter(m => {
      if (m.userId === user?.uid || seen.has(m.userId)) return false;
      seen.add(m.userId);
      return true;
    });
  }, [teamMembers, user?.uid]);

  const messageMutation = useMutation<ChatMessage>('messages');
  const notificationMutation = useMutation<any>('notifications');
  const waMutation = useMutation<WhatsAppMessage>('whatsappMessages');
  const leadsMutation = useMutation<Lead>('leads');
  const isSending = messageMutation.loading;

  // Typing indicators
  const typingMutation = useMutation<any>('typingIndicators');
  const { data: typingIndicators } = useCollection<any>('typingIndicators', { skipTeamFilter: true });
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeTypingUsers = useMemo(() => {
    if (!typingIndicators || !user) return [];
    const now = Date.now();
    const channelOrDm = chatMode === 'channel' ? activeChannel : `dm-${activeDirectUserId}`;
    return typingIndicators.filter((t: any) =>
      t.channelId === channelOrDm && t.userId !== user.uid && t.timestamp &&
      (now - (t.timestamp instanceof Date ? t.timestamp.getTime() : t.timestamp?.toMillis?.() ?? 0)) < 5000
    );
  }, [typingIndicators, user, chatMode, activeChannel, activeDirectUserId]);

  const handleTyping = useCallback(() => {
    if (!user) return;
    const channelOrDm = chatMode === 'channel' ? activeChannel : `dm-${activeDirectUserId}`;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    const existing = typingIndicators?.find((t: any) => t.userId === user.uid && t.channelId === channelOrDm);
    if (existing) {
      typingMutation.update(existing.id, { timestamp: new Date() }).catch(() => {});
    } else {
      typingMutation.create({ userId: user.uid, channelId: channelOrDm, timestamp: new Date() } as any).catch(() => {});
    }
    typingTimeoutRef.current = setTimeout(() => {
      const ex = typingIndicators?.find((t: any) => t.userId === user.uid && t.channelId === channelOrDm);
      if (ex) typingMutation.remove(ex.id).catch(() => {});
    }, 3000);
  }, [user, chatMode, activeChannel, activeDirectUserId, typingIndicators, typingMutation]);

  // Cleanup typing indicator on channel switch or unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (user && typingIndicators) {
        const myIndicators = typingIndicators.filter((t: any) => t.userId === user.uid);
        myIndicators.forEach((t: any) => typingMutation.remove(t.id).catch(() => {}));
      }
    };
  }, [chatMode, activeChannel, activeDirectUserId]);

  // Auto-scroll — on new messages AND when switching conversations
  useEffect(() => {
    const currentCount = filteredMessages?.length || 0;
    if (currentCount > prevMessageCountRef.current && scrollRef.current) {
      // Use rAF to ensure DOM has rendered the new messages before scrolling
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
    prevMessageCountRef.current = currentCount;
  }, [filteredMessages?.length]);

  // Scroll to bottom whenever the active conversation changes
  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, [activeChannel, activeDirectUserId, chatMode]);

  // AI auto-scroll
  useEffect(() => {
    if (aiScrollRef.current) {
      aiScrollRef.current.scrollTop = aiScrollRef.current.scrollHeight;
    }
  }, [aiMessages]);

  // Reset incoming message tracking when conversation changes
  useEffect(() => {
    prevSeenMsgIdsRef.current = new Set();
    isInitialMsgLoadRef.current = true;
  }, [activeChannel, activeDirectUserId, chatMode]);

  // Bird chirp notification on new incoming messages from others
  useEffect(() => {
    if (!user || !filteredMessages) return;
    if (isInitialMsgLoadRef.current) {
      // Seed the set on first load — no sound
      filteredMessages.forEach(m => prevSeenMsgIdsRef.current.add(m.id));
      isInitialMsgLoadRef.current = false;
      return;
    }
    const newIncoming = filteredMessages.filter(
      m => m.senderId !== user.uid && !prevSeenMsgIdsRef.current.has(m.id)
    );
    if (newIncoming.length > 0) {
      playBirdChirp();
    }
    filteredMessages.forEach(m => prevSeenMsgIdsRef.current.add(m.id));
  }, [filteredMessages, user, playBirdChirp]);

  // Helpers
  const getUserDisplayName = useCallback((userId: string) => {
    if (userId === user?.uid) return user?.displayName || user?.email?.split('@')[0] || 'Ti';
    const profile = profileMap.get(userId);
    if (profile?.displayName) return profile.displayName;
    const member = teamMembers?.find(m => m.userId === userId);
    if (member?.displayName) return member.displayName;
    if (member?.email) return member.email.split('@')[0];
    const ownerTeam = teams?.find((t: any) => t.createdByUserId === userId);
    if (ownerTeam) return 'Admin';
    return `User ${userId.slice(0, 6)}`;
  }, [user, profileMap, teamMembers, teams]);

  const getAvatarColor = useCallback((id: string) => {
    const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500', 'bg-teal-500'];
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }, []);

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

  const waConversations = useMemo(() => {
    if (!allWaMessages) return [];
    // Derive canonical phone: prefer jid-based (stable WhatsApp international format)
    const phoneKey = (msg: WhatsAppMessage) => {
      if (msg.jid?.endsWith('@s.whatsapp.net')) return normalizeAlbanianPhone(msg.jid.split('@')[0]);
      return normalizeAlbanianPhone(msg.phone || '');
    };
    // Real phone = has @s.whatsapp.net JID OR phone digits ≤ 13
    const isRealPhone = (phone: string, jid?: string | null) =>
      !!jid?.endsWith('@s.whatsapp.net') || phone.length <= 13;
    const map = new Map<string, { phone: string; jid: string | null; leadName: string; leadId?: string | null; lastMessage: string; lastDate: any; unread: number; isLid: boolean; channel?: 'baileys' | 'meta' }>();
    for (const msg of allWaMessages) {
      const key = phoneKey(msg);
      if (!key) continue;
      const msgIsLid = !isRealPhone(key, msg.jid) || (msg as any).isLid === true;
      // Use leadName, then pushName (WhatsApp display name), then phone/unknown
      const displayName = msg.leadName || msg.pushName || (msgIsLid ? 'Numër i panjohur' : `+${key}`);
      if (!map.has(key)) {
        map.set(key, {
          phone: key,
          jid: msg.jid || null,
          leadName: displayName,
          leadId: msg.leadId || null,
          lastMessage: msg.message,
          lastDate: msg.createdAt,
          unread: (msg.direction === 'inbound' && msg.status === 'received') ? 1 : 0,
          isLid: msgIsLid,
          channel: msg.channel || 'baileys',
        });
      } else {
        const existing = map.get(key)!;
        // Upgrade display name if we find a better one
        if ((msg.leadName || msg.pushName) && (existing.leadName === existing.phone || existing.leadName === 'Numër i panjohur')) {
          existing.leadName = msg.leadName || msg.pushName || existing.leadName;
        }
        if (msg.leadId && !existing.leadId) existing.leadId = msg.leadId;
        if (msg.jid?.endsWith('@s.whatsapp.net') && !existing.jid?.endsWith('@s.whatsapp.net')) existing.jid = msg.jid;
        if (msg.direction === 'inbound' && msg.status === 'received') existing.unread++;
        // Track the latest message per conversation
        const msgTime = msg.createdAt instanceof Date ? msg.createdAt.getTime() : (msg.createdAt as any)?.toMillis?.() ?? 0;
        const existTime = existing.lastDate instanceof Date ? existing.lastDate.getTime() : existing.lastDate?.toMillis?.() ?? 0;
        if (msgTime > existTime) {
          existing.lastDate = msg.createdAt;
          existing.lastMessage = msg.message;
        }
      }
    }
    return Array.from(map.values())
      .sort((a, b) => {
      const ta = a.lastDate instanceof Date ? a.lastDate.getTime() : a.lastDate?.toMillis?.() ?? 0;
      const tb = b.lastDate instanceof Date ? b.lastDate.getTime() : b.lastDate?.toMillis?.() ?? 0;
      return tb - ta;
    });
  }, [allWaMessages]);

  const waActiveMessages = useMemo(() => {
    if (!allWaMessages || !activeWaPhone) return [];
    return [...allWaMessages].filter(m => {
      const key = normalizeAlbanianPhone(
        m.jid?.endsWith('@s.whatsapp.net')
          ? m.jid.split('@')[0]
          : (m.phone || '')
      );
      return key === activeWaPhone;
    }).sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toMillis?.() ?? 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toMillis?.() ?? 0;
      return ta - tb;
    });
  }, [allWaMessages, activeWaPhone]);

  const waTotalUnread = useMemo(
    () => waConversations.reduce((s, c) => s + c.unread, 0),
    [waConversations]
  );

  // WA auto-scroll
  useEffect(() => {
    if (waScrollRef.current) {
      waScrollRef.current.scrollTop = waScrollRef.current.scrollHeight;
    }
  }, [waActiveMessages.length]);

  // Mark WA messages as read when conversation opens or new messages arrive
  useEffect(() => {
    if (!activeWaPhone || !allWaMessages) return;
    const unread = allWaMessages.filter(m => {
      const key = normalizeAlbanianPhone(
        m.jid?.endsWith('@s.whatsapp.net')
          ? m.jid.split('@')[0]
          : (m.phone || '')
      );
      return key === activeWaPhone && m.direction === 'inbound' && m.status === 'received';
    });
    unread.forEach(m => {
      waMutation.update(m.id, { status: 'read' } as any).catch(() => {});
    });
  }, [activeWaPhone, waActiveMessages.length]);

  // Message Handlers
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!messageText.trim() && !attachmentUrl.trim()) || !user) return;

    try {
      const isClientChannel = activeChannel.startsWith('client-');
      const baseMessage: Partial<ChatMessage> = {
        content: messageText || '📎 Attachment',
        senderId: user.uid,
        isRead: true,
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

        if (isClientChannel) {
          const match = activeChannel.match(/^client-(.+?)(?:-project-(.+))?$/);
          if (match) {
            const custId = match[1];
            const projId = match[2];
            const pa = portalAccess?.find(a => a.customerId === custId);
            if (pa) {
              const customer = customers?.find(c => c.id === custId);
              const projectName = projId ? projects?.find(p => p.id === projId)?.name : null;
              const title = projectName
                ? `Mesazh i ri nga stafi - ${projectName}`
                : `Mesazh i ri nga stafi - ${customer?.name || 'Biseda'}`;
              try { await notificationMutation.create({ userId: (pa as any).userId || custId, type: 'staff_message', title, message: (messageText || '📎 Attachment').slice(0, 100), isRead: false, linkTo: activeChannel } as any); } catch { /* skip */ }
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
      const channelOrDm = chatMode === 'channel' ? activeChannel : `dm-${activeDirectUserId}`;
      const ex = typingIndicators?.find((t: any) => t.userId === user.uid && t.channelId === channelOrDm);
      if (ex) typingMutation.remove(ex.id).catch(() => {});
    } catch (err) {
      toast({ title: 'Dërgimi dështoi', description: err instanceof Error ? err.message : 'Gabim', variant: 'destructive' });
    }
  };

  const handleEditMessage = async (msgId: string) => {
    if (!editText.trim()) return;
    try {
      await messageMutation.update(msgId, { content: editText, editedAt: new Date() } as any);
      setEditingMessageId(null);
      setEditText('');
    } catch { toast({ title: 'Gabim', variant: 'destructive' }); }
  };

  const handleDeleteMessage = async (msgId: string) => {
    try { await messageMutation.update(msgId, { deletedAt: new Date(), content: 'Ky mesazh u fshi.', attachmentUrl: null } as any); } catch { /* skip */ }
  };

  const handleReaction = async (msgId: string, emoji: string) => {
    if (!user) return;
    const msg = messages?.find(m => m.id === msgId);
    if (!msg) return;
    const reactions = { ...((msg as any).reactions || {}) };
    const users = reactions[emoji] ? [...reactions[emoji]] : [];
    const idx = users.indexOf(user.uid);
    if (idx >= 0) users.splice(idx, 1); else users.push(user.uid);
    if (users.length === 0) delete reactions[emoji]; else reactions[emoji] = users;
    try { await messageMutation.update(msgId, { reactions } as any); } catch { /* skip */ }
    setShowEmojiPicker(null);
  };

  // AI Chat
  const sendAiMessage = async (text: string) => {
    if (!text.trim() || aiLoading) return;
    setShowAiActions(false);

    const userMsg: AIMessage = { id: `u-${Date.now()}`, role: 'user', content: text, createdAt: new Date() };
    const loadingMsg: AIMessage = { id: `a-${Date.now()}`, role: 'assistant', content: '', createdAt: new Date(), isLoading: true };

    setAiMessages(prev => [...prev, userMsg, loadingMsg]);
    setAiLoading(true);
    setMessageText('');

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: [...aiMessages.filter(m => !m.isLoading), userMsg].map(m => ({ role: m.role, content: m.content })),
          context: { userRole: 'staff' },
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Gabim serveri' }));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setAiMessages(prev => prev.map(m => m.id === loadingMsg.id ? { ...m, content: data.reply, isLoading: false } : m));
    } catch (err: any) {
      setAiMessages(prev => prev.map(m =>
        m.id === loadingMsg.id ? { ...m, content: `⚠️ ${err.message || 'Gabim i papritur'}`, isLoading: false } : m
      ));
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiQuickAction = (action: typeof AI_QUICK_ACTIONS[0]) => {
    setMessageText(action.prompt);
    textareaRef.current?.focus();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Kopjuar!', description: 'Teksti u kopjua në clipboard.' });
  };

  const resetAiChat = () => {
    setAiMessages([]);
    setShowAiActions(true);
  };

  // Navigation
  const handleSelectChannel = useCallback((channelId: string) => {
    setChatMode('channel');
    setActiveChannel(channelId);
    setActiveDirectUserId(null);
    setShowSidebar(false);
    setShowSearch(false);
    setSearchQuery('');
    setReplyingTo(null);
  }, []);

  const handleSelectDirectMessage = useCallback((userId: string) => {
    setChatMode('direct');
    setActiveDirectUserId(userId);
    setShowSidebar(false);
    setShowSearch(false);
    setSearchQuery('');
    setReplyingTo(null);
  }, []);

  const handleSelectAi = useCallback(() => {
    setChatMode('ai');
    setShowSidebar(false);
    setShowSearch(false);
    setSearchQuery('');
    setReplyingTo(null);
  }, []);

  const handleSelectWhatsApp = useCallback((phone: string, leadName: string, jid?: string | null, channel?: 'baileys' | 'meta', leadId?: string | null) => {
    setChatMode('whatsapp');
    setActiveWaPhone(phone);
    setActiveWaJid(jid || null);
    setActiveWaLeadName(leadName);
    setActiveWaChannel(channel || 'baileys');
    setActiveWaLeadId(leadId || null);
    setShowSidebar(false);
    setShowSearch(false);
    setSearchQuery('');
  }, []);

  const handleSendWa = async () => {
    if (!waText.trim() || waSending || !user || !activeWaPhone) return;
    setWaSending(true);
    const body = waText.trim();
    setWaText('');
    try {
      const token = await user.getIdToken();
      const isMeta = activeWaChannel === 'meta';
      const endpoint = isMeta ? '/api/meta-send' : '/api/send-whatsapp';
      const payload = isMeta
        ? { to: activeWaPhone, message: body, leadName: activeWaLeadName, teamId: getGlobalTeamId() }
        : { to: activeWaPhone, message: body, leadName: activeWaLeadName, teamId: getGlobalTeamId(), jid: activeWaJid || undefined };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setWaText(body);
        throw new Error(data.error || 'Dërgimi dështoi');
      }
    } catch (err: unknown) {
      toast({ title: 'Gabim WhatsApp', description: err instanceof Error ? err.message : 'Dërgimi dështoi', variant: 'destructive' });
    } finally {
      setWaSending(false);
    }
  };

  // Convert WhatsApp contact to Lead
  const handleConvertToLead = async () => {
    if (!activeWaPhone || !user || convertingToLead) return;
    setConvertingToLead(true);
    try {
      const teamId = getGlobalTeamId();
      const normPhone = activeWaPhone.replace(/\D/g, '');

      // Duplicate check: query leads by phone
      const leadsRef = collection(db, 'leads');
      const q1 = query(leadsRef, where('phoneNumber', '==', normPhone), where('teamId', '==', teamId));
      const q2 = query(leadsRef, where('phoneNumber', '==', `+${normPhone}`), where('teamId', '==', teamId));
      const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
      if (!snap1.empty || !snap2.empty) {
        const existing = snap1.docs[0]?.data() || snap2.docs[0]?.data();
        toast({ title: 'Numri ekziston tek Leads!', description: `Lead "${existing?.name}" ka të njëjtin numër.`, variant: 'destructive' });
        setConvertingToLead(false);
        return;
      }

      const leadName = activeWaLeadName || `+${activeWaPhone}`;
      const newLead = await leadsMutation.create({
        name: leadName,
        phoneNumber: `+${normPhone}`,
        source: 'WhatsApp',
        status: 'New',
        score: 10,
        probability: 10,
      } as any);

      // Update all whatsappMessages for this phone with the new leadId
      if (newLead?.id) {
        const msgs = allWaMessages?.filter(m => {
          const key = m.jid?.endsWith('@s.whatsapp.net')
            ? normalizeAlbanianPhone(m.jid.split('@')[0])
            : normalizeAlbanianPhone(m.phone || '');
          return key === activeWaPhone;
        }) || [];
        await Promise.all(msgs.map(m => waMutation.update(m.id, { leadId: newLead.id, leadName: leadName })));
        setActiveWaLeadId(newLead.id);
        setActiveWaLeadName(leadName);
      }

      toast({ title: 'Lead u krijua!', description: `"${leadName}" u shtua si lead nga WhatsApp.` });
    } catch (err: unknown) {
      toast({ title: 'Gabim', description: err instanceof Error ? err.message : 'Konvertimi dështoi', variant: 'destructive' });
    } finally {
      setConvertingToLead(false);
    }
  };

  // Mark as Read
  useEffect(() => {
    // Clear read tracking when switching conversations
    markedAsReadRef.current.clear();
  }, [activeDirectUserId, activeChannel, chatMode]);

  useEffect(() => {
    if (!activeDirectUserId || !user || chatMode !== 'direct') return;
    const unread = allDirectMessages.filter(m => m.senderId === activeDirectUserId && m.receiverId === user.uid && !m.isRead && !markedAsReadRef.current.has(m.id));
    unread.forEach(m => { markedAsReadRef.current.add(m.id); messageMutation.update(m.id, { isRead: true }); });
  }, [activeDirectUserId, allDirectMessages, user, chatMode]);

  useEffect(() => {
    if (chatMode !== 'channel' || !user || !channelMessages) return;
    const unread = channelMessages.filter(m => m.senderId !== user.uid && !m.isRead && !markedAsReadRef.current.has(m.id));
    unread.forEach(m => { markedAsReadRef.current.add(m.id); messageMutation.update(m.id, { isRead: true }); });
  }, [chatMode, channelMessages, user]);

  // Auto-resize textarea
  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessageText(e.target.value);
    if (chatMode !== 'ai' && e.target.value) handleTyping();
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  // Loading / Error
  if (chatMode !== 'ai' && chatMode !== 'whatsapp' && isPending) {
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

  // =====================================
  //  R E N D E R
  // =====================================

  return (
    <div className="flex h-[calc(100dvh-64px)] bg-background overflow-hidden">
      {/* SIDEBAR */}
      <aside className={`w-full lg:w-72 border-r bg-muted/5 flex flex-col flex-shrink-0 transition-all ${showSidebar ? 'flex' : 'hidden lg:flex'}`}>
        {/* Sidebar header */}
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="font-semibold text-sm">Mesazhe</h2>
          <div className="flex items-center gap-1">
            {totalUnread > 0 && (
              <Badge variant="destructive" className="h-5 min-w-5 text-[10px] px-1.5">{totalUnread}</Badge>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
          {/* AI Assistant - pinned at top */}
          <button
            onClick={handleSelectAi}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left ${
              chatMode === 'ai'
                ? 'bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-300/30 dark:border-violet-700/30 shadow-sm'
                : 'hover:bg-accent/50'
            }`}
          >
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-sm">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${chatMode === 'ai' ? 'text-violet-700 dark:text-violet-300' : ''}`}>FivoAI</p>
              <p className="text-[11px] text-muted-foreground truncate">Asistenti juaj personal</p>
            </div>
            <Badge className="bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-[9px] border-0 font-normal">AI</Badge>
          </button>

          <div className="h-px bg-border/50 mx-2 my-2" />

          {/* Channels */}
          <p className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Kanale</p>
          {CHANNELS.map(channel => {
            const isActive = chatMode === 'channel' && activeChannel === channel.id;
            const unread = channelUnreadMap.get(channel.id) || 0;
            return (
              <button
                key={channel.id}
                onClick={() => handleSelectChannel(channel.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all text-left ${
                  isActive
                    ? 'bg-primary/8 text-primary font-medium shadow-sm border border-primary/10'
                    : 'hover:bg-accent/50 text-foreground/70'
                }`}
              >
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  isActive ? 'bg-primary/10' : 'bg-muted/80'
                }`}>
                  <channel.icon className={`h-4 w-4 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
                <span className="flex-1 truncate text-sm">{channel.name}</span>
                {unread > 0 && !isActive && (
                  <span className="h-5 min-w-5 px-1.5 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">{unread}</span>
                )}
              </button>
            );
          })}

          {/* Client Channels */}
          {portalAccess && portalAccess.length > 0 && (
            <>
              <div className="h-px bg-border/50 mx-2 my-2" />
              <p className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Klientët</p>
              <div className="relative px-1 mb-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  value={clientSearch}
                  onChange={e => setClientSearch(e.target.value)}
                  placeholder="Kërko klient..."
                  className="h-7 pl-7 pr-6 text-xs rounded-lg bg-muted/40 border-0 focus-visible:ring-1"
                />
                {clientSearch && (
                  <button onClick={() => setClientSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="h-3 w-3 text-muted-foreground" /></button>
                )}
              </div>
              <div className="space-y-0.5 max-h-[30vh] overflow-y-auto">
                {portalAccess.filter((a, i, arr) => {
                  // Deduplicate by customerId — keep first occurrence only
                  if (arr.findIndex(x => x.customerId === a.customerId) !== i) return false;
                  if (!clientSearch.trim()) return true;
                  const q = clientSearch.toLowerCase();
                  const c = customers?.find(cu => cu.id === a.customerId);
                  return c?.name?.toLowerCase().includes(q) || c?.email?.toLowerCase().includes(q) || a.email?.toLowerCase().includes(q);
                }).sort((a, b) => {
                  const ua = (channelUnreadMap.get(`client-${a.customerId}`) || 0)
                    + (projects?.filter(p => p.customerId === a.customerId) || [])
                        .reduce((s, p) => s + (channelUnreadMap.get(`client-${a.customerId}-project-${p.id}`) || 0), 0);
                  const ub = (channelUnreadMap.get(`client-${b.customerId}`) || 0)
                    + (projects?.filter(p => p.customerId === b.customerId) || [])
                        .reduce((s, p) => s + (channelUnreadMap.get(`client-${b.customerId}-project-${p.id}`) || 0), 0);
                  if (ua > 0 && ub === 0) return -1;
                  if (ub > 0 && ua === 0) return 1;
                  return 0;
                }).map(access => {
                  const customer = customers?.find(c => c.id === access.customerId);
                  const clientChannelId = `client-${access.customerId}`;
                  const isActive = chatMode === 'channel' && activeChannel === clientChannelId;
                  const unread = channelUnreadMap.get(clientChannelId) || 0;
                  const clientProjects = projects?.filter(p => p.customerId === access.customerId) || [];
                  return (
                    <div key={access.id}>
                      <button
                        onClick={() => handleSelectChannel(clientChannelId)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all text-left ${
                          isActive ? 'bg-emerald-500/8 text-emerald-700 dark:text-emerald-300 font-medium shadow-sm border border-emerald-200/30 dark:border-emerald-800/30' : 'hover:bg-accent/50 text-foreground/70'
                        }`}
                      >
                        <div className="h-8 w-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{(customer?.name || 'K')[0]}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="truncate block text-sm">{customer?.name || access.email}</span>
                        </div>
                        {unread > 0 && !isActive && (
                          <span className="h-5 min-w-5 px-1.5 flex items-center justify-center rounded-full bg-emerald-500 text-white text-[10px] font-bold">{unread}</span>
                        )}
                      </button>
                      {clientProjects.length > 0 && (
                        <div className="ml-6 pl-3 border-l border-border/40 space-y-0.5 mt-0.5 mb-1">
                          {clientProjects.map(proj => {
                            const projChannelId = `client-${access.customerId}-project-${proj.id}`;
                            const isProjActive = chatMode === 'channel' && activeChannel === projChannelId;
                            const projUnread = channelUnreadMap.get(projChannelId) || 0;
                            return (
                              <button
                                key={proj.id}
                                onClick={() => handleSelectChannel(projChannelId)}
                                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs ${
                                  isProjActive ? 'bg-primary/8 text-primary font-medium' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                                }`}
                              >
                                <FolderOpen className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate flex-1">{proj.name}</span>
                                {projUnread > 0 && !isProjActive && (
                                  <span className="h-4 min-w-4 px-1 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold">{projUnread}</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Client Requests */}
          <div className="h-px bg-border/50 mx-2 my-2" />
          <button
            onClick={() => { setChatMode('requests'); setShowSidebar(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left ${
              chatMode === 'requests'
                ? 'bg-amber-500/10 border border-amber-300/30 dark:border-amber-700/30 shadow-sm'
                : 'hover:bg-accent/50'
            }`}
          >
            <div className={`h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 ${chatMode === 'requests' ? 'bg-amber-500' : 'bg-amber-100 dark:bg-amber-900/30'}`}>
              <ClipboardList className={`h-4 w-4 ${chatMode === 'requests' ? 'text-white' : 'text-amber-600 dark:text-amber-400'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${chatMode === 'requests' ? 'text-amber-700 dark:text-amber-300' : ''}`}>Kërkesat</p>
              <p className="text-[11px] text-muted-foreground truncate">Kërkesat e klientëve</p>
            </div>
            {newRequestsCount > 0 && (
              <Badge className="bg-amber-500 text-white text-[10px] border-0">{newRequestsCount}</Badge>
            )}
          </button>

          {/* Direct Messages */}
          <div className="h-px bg-border/50 mx-2 my-2" />
          <p className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Mesazhe Direkte</p>
          {directConversations.map(userId => {
            const unread = directUnreadMap.get(userId) || 0;
            const isActive = chatMode === 'direct' && activeDirectUserId === userId;
            const name = getUserDisplayName(userId);
            return (
              <button
                key={userId}
                onClick={() => handleSelectDirectMessage(userId)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all text-left ${
                  isActive ? 'bg-primary/8 text-primary font-medium shadow-sm border border-primary/10' : 'hover:bg-accent/50 text-foreground/70'
                }`}
              >
                <div className="relative flex-shrink-0">
                  <div className={`h-8 w-8 rounded-lg ${getAvatarColor(userId)} flex items-center justify-center`}>
                    <span className="text-[10px] font-bold text-white">{name.slice(0, 2).toUpperCase()}</span>
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-background" />
                </div>
                <span className="flex-1 truncate text-sm">{name}</span>
                {unread > 0 && !isActive && (
                  <span className="h-5 min-w-5 px-1.5 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">{unread}</span>
                )}
              </button>
            );
          })}

          {/* Members not in conversation */}
          {otherMembers.filter(m => !directConversations.includes(m.userId)).length > 0 && (
            <>
              <p className="px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Anëtarë</p>
              {otherMembers.filter(m => !directConversations.includes(m.userId)).map(member => {
                const name = getUserDisplayName(member.userId);
                const isActive = chatMode === 'direct' && activeDirectUserId === member.userId;
                return (
                  <button
                    key={member.id}
                    onClick={() => handleSelectDirectMessage(member.userId)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all text-left ${
                      isActive ? 'bg-primary/8 text-primary font-medium' : 'hover:bg-accent/50 text-foreground/70'
                    }`}
                  >
                    <div className={`h-8 w-8 rounded-lg ${getAvatarColor(member.userId)} flex items-center justify-center`}>
                      <span className="text-[10px] font-bold text-white">{name.slice(0, 2).toUpperCase()}</span>
                    </div>
                    <span className="flex-1 truncate text-sm">{name}</span>
                  </button>
                );
              })}
            </>
          )}

          {/* WhatsApp Conversations */}
          {waEnabled && (
          <>
            <div className="h-px bg-border/50 mx-2 my-2" />
            <button
              onClick={() => {
                setChatMode('whatsapp');
                setActiveWaPhone(null);
                setShowSidebar(false);
              }}
              className="w-full px-2 pt-1 pb-1 flex items-center gap-1.5 text-left hover:bg-accent/30 rounded-lg"
            >
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1.5 flex-1">
                <Smartphone className="h-3 w-3 text-[#25D366]" />
                WhatsApp
              </p>
              {waTotalUnread > 0 && (
                <span className="h-4 min-w-4 px-1 flex items-center justify-center rounded-full bg-[#25D366] text-white text-[9px] font-bold">{waTotalUnread}</span>
              )}
            </button>
            {waConversations.length === 0 && (
              <p className="px-3 py-1.5 text-[11px] text-muted-foreground/40 italic">Nuk ka biseda ende</p>
            )}
            {waConversations.map(conv => {
              const isWaActive = chatMode === 'whatsapp' && activeWaPhone === conv.phone;
              return (
                <button
                  key={conv.phone}
                  onClick={() => handleSelectWhatsApp(conv.phone, conv.leadName, conv.jid, conv.channel, conv.leadId)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all text-left ${
                    isWaActive
                      ? 'bg-[#25D366]/10 border border-[#25D366]/20 shadow-sm'
                      : 'hover:bg-accent/50 text-foreground/70'
                  }`}
                >
                  <div className="relative flex-shrink-0">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${conv.channel === 'meta' ? 'bg-blue-500/15' : 'bg-[#25D366]/15'}`}>
                      <Smartphone className={`h-4 w-4 ${conv.channel === 'meta' ? 'text-blue-500' : 'text-[#25D366]'}`} />
                    </div>
                    {!conv.leadId && !conv.isLid && (
                      <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber-500 border-2 border-background" title="Nuk është në CRM" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`truncate block text-sm ${isWaActive ? 'text-[#25D366] font-medium' : ''}`}>{conv.leadName !== conv.phone ? conv.leadName : `+${conv.phone}`}</span>
                    <span className="text-[10px] text-muted-foreground/60 truncate block">
                      {conv.isLid
                        ? (conv.lastMessage || '').slice(0, 32)
                        : conv.leadName !== conv.phone
                          ? `+${conv.phone}${conv.lastMessage ? ' · ' + conv.lastMessage.slice(0, 20) : ''}`
                          : (conv.lastMessage || '').slice(0, 32)
                      }
                    </span>
                  </div>
                  {conv.unread > 0 && !isWaActive && (
                    <span className="h-5 min-w-5 px-1.5 flex items-center justify-center rounded-full bg-[#25D366] text-white text-[10px] font-bold">{conv.unread}</span>
                  )}
                </button>
              );
            })}
          </>
          )}
        </div>
      </aside>

      {/* MAIN CHAT AREA */}
      <main className={`flex-1 flex flex-col min-w-0 ${!showSidebar ? 'flex' : 'hidden lg:flex'}`}>
        {/* Chat Header */}
        <header className="flex items-center gap-3 px-5 py-3 border-b bg-background/80 backdrop-blur-sm flex-shrink-0">
          <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8 -ml-2" onClick={() => setShowSidebar(true)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>

          {chatMode === 'ai' ? (
            <div className="flex items-center gap-3 flex-1">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="font-semibold text-sm">FivoAI Assistant</p>
                <p className="text-[11px] text-emerald-600 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" /> Online
                </p>
              </div>
            </div>
          ) : chatMode === 'channel' ? (
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {activeChannel.startsWith('client-') ? (
                <>
                  <div className="h-9 w-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                    <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">
                      {(() => {
                        const match = activeChannel.match(/^client-(.+?)-project-(.+)$/);
                        if (match) { const c = customers?.find(cu => cu.id === match[1]); const p = projects?.find(pr => pr.id === match[2]); return `${c?.name || 'Klient'} — ${p?.name || 'Projekt'}`; }
                        const custId = activeChannel.replace('client-', '');
                        return customers?.find(c => c.id === custId)?.name || 'Klient';
                      })()}
                    </p>
                    <p className="text-[11px] text-muted-foreground">Kanal klienti</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    {React.createElement(CHANNELS.find(c => c.id === activeChannel)?.icon || Hash, { className: 'h-4 w-4 text-primary' })}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">#{CHANNELS.find(c => c.id === activeChannel)?.name}</p>
                    <p className="text-[11px] text-muted-foreground">{CHANNELS.find(c => c.id === activeChannel)?.description}</p>
                  </div>
                </>
              )}
            </div>
          ) : chatMode === 'whatsapp' ? (
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="h-9 w-9 rounded-xl bg-[#25D366]/15 flex items-center justify-center flex-shrink-0">
                <Smartphone className="h-4 w-4 text-[#25D366]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm truncate">{activeWaLeadName || (activeWaPhone && activeWaPhone.length <= 13 ? `+${activeWaPhone}` : 'Numër i panjohur')}</p>
                {activeWaPhone && activeWaPhone.length <= 13 && (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Phone className="h-3 w-3" /> +{activeWaPhone}
                  </p>
                )}
              </div>
              {activeWaPhone && !activeWaLeadId && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-8 gap-1.5 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-600 dark:text-amber-400 dark:hover:bg-amber-950"
                  onClick={handleConvertToLead}
                  disabled={convertingToLead}
                >
                  {convertingToLead ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                  Shto si Lead
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {activeDirectUserId ? (
                <>
                  <div className="relative flex-shrink-0">
                    <div className={`h-9 w-9 rounded-xl ${getAvatarColor(activeDirectUserId)} flex items-center justify-center`}>
                      <span className="text-xs font-bold text-white">{getUserDisplayName(activeDirectUserId).slice(0, 2).toUpperCase()}</span>
                    </div>
                    <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-background" />
                  </div>
                  <div><p className="font-semibold text-sm">{getUserDisplayName(activeDirectUserId)}</p><p className="text-[11px] text-emerald-600">Aktiv</p></div>
                </>
              ) : <p className="text-sm text-muted-foreground">Zgjidh një person</p>}
            </div>
          )}

          <div className="flex items-center gap-1">
            {chatMode === 'ai' && aiMessages.length > 0 && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={resetAiChat} title="Bisedë e re">
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
            {chatMode !== 'ai' && chatMode !== 'whatsapp' && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setShowSearch(!showSearch); setSearchQuery(''); }}>
                <Search className="h-4 w-4" />
              </Button>
            )}
          </div>
        </header>

        {/* Search bar */}
        {showSearch && chatMode !== 'ai' && chatMode !== 'whatsapp' && (
          <div className="flex items-center gap-2 px-5 py-2 border-b bg-muted/20">
            <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Kërko në mesazhe..." className="h-7 text-sm border-0 bg-transparent focus-visible:ring-0 shadow-none" autoFocus />
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setShowSearch(false); setSearchQuery(''); }}><X className="h-3.5 w-3.5" /></Button>
          </div>
        )}

        {/* AI Chat Area */}
        {chatMode === 'ai' ? (
          <>
            <ScrollArea className="flex-1" ref={aiScrollRef}>
              <div className="max-w-3xl mx-auto px-4 py-6">
                {aiMessages.length === 0 && showAiActions ? (
                  /* Welcome + Quick Actions */
                  <div className="flex flex-col items-center justify-center min-h-[50vh]">
                    <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-5 shadow-lg">
                      <Sparkles className="h-8 w-8 text-white" />
                    </div>
                    <h2 className="text-xl font-bold mb-2">Si mund t'ju ndihmoj?</h2>
                    <p className="text-sm text-muted-foreground mb-8 text-center max-w-md">
                      Jam FivoAI — asistenti juaj personal. Mund të shkruaj emaile, postime, propozime, të ndihmoj me planifikimin e detyrave dhe shumë më tepër.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full max-w-lg">
                      {AI_QUICK_ACTIONS.map(action => (
                        <button
                          key={action.id}
                          onClick={() => handleAiQuickAction(action)}
                          className="flex flex-col items-center gap-2 p-4 rounded-xl border bg-card hover:bg-accent/50 hover:border-primary/30 transition-all text-center group"
                        >
                          <span className="text-2xl group-hover:scale-110 transition-transform">{action.icon}</span>
                          <span className="text-xs font-medium">{action.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* AI Messages */
                  <div className="space-y-6">
                    {aiMessages.map(msg => (
                      <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {msg.role === 'assistant' && (
                          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0 mt-1">
                            <Bot className="h-4 w-4 text-white" />
                          </div>
                        )}
                        <div className={`max-w-[80%] ${msg.role === 'user' ? 'order-first' : ''}`}>
                          <div className={`px-4 py-3 rounded-2xl ${
                            msg.role === 'user'
                              ? 'bg-primary text-primary-foreground rounded-br-md'
                              : 'bg-muted/60 border rounded-bl-md'
                          }`}>
                            {msg.isLoading ? (
                              <div className="flex items-center gap-2 py-1">
                                <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                                <span className="text-sm text-muted-foreground">Duke menduar...</span>
                              </div>
                            ) : (
                              <div className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                            )}
                          </div>
                          {msg.role === 'assistant' && !msg.isLoading && msg.content && (
                            <div className="flex items-center gap-1 mt-1.5 ml-1">
                              <button
                                onClick={() => copyToClipboard(msg.content)}
                                className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-muted transition-colors"
                              >
                                <Copy className="h-3 w-3" /> Kopjo
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* AI Input */}
            <div className="px-4 pb-4 pt-2 max-w-3xl mx-auto w-full">
              <div className="relative flex items-end gap-2 bg-muted/30 border rounded-2xl px-4 py-2 focus-within:border-violet-400/60 focus-within:bg-background focus-within:shadow-md transition-all">
                <textarea
                  ref={textareaRef}
                  value={messageText}
                  onChange={handleTextareaInput}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiMessage(messageText); }
                  }}
                  placeholder="Pyetni FivoAI çdo gjë..."
                  disabled={aiLoading}
                  rows={1}
                  className="flex-1 min-w-0 bg-transparent border-0 outline-none text-sm resize-none py-1.5 placeholder:text-muted-foreground/50 max-h-[120px]"
                />
                <Button
                  size="icon"
                  onClick={() => sendAiMessage(messageText)}
                  disabled={!messageText.trim() || aiLoading}
                  className={`h-8 w-8 rounded-xl flex-shrink-0 transition-all ${
                    messageText.trim() ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-sm' : 'bg-transparent text-muted-foreground/40'
                  }`}
                >
                  {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground/50 text-center mt-1.5">FivoAI mund të bëjë gabime. Verificoni informacionin e rëndësishëm.</p>
            </div>
          </>
        ) : chatMode === 'whatsapp' ? (
          /* WhatsApp Chat Area */
          <>
            <div
              ref={waScrollRef}
              className="flex-1 overflow-y-auto p-4"
              style={{ background: 'var(--wa-bg, #efeae2)' }}
            >
              {!activeWaPhone ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-16">
                  <div className="p-4 bg-[#25D366]/10 rounded-full">
                    <Smartphone className="w-8 h-8 text-[#25D366]/60" />
                  </div>
                  <p className="text-sm font-medium text-foreground/60">Zgjidh një bisedë nga lista</p>
                </div>
              ) : waActiveMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-16">
                  <div className="p-4 bg-[#25D366]/10 rounded-full">
                    <Smartphone className="w-8 h-8 text-[#25D366]/60" />
                  </div>
                  <p className="text-sm font-medium">Asnjë mesazh ende</p>
                  <p className="text-xs text-muted-foreground">Dërgo mesazhin e parë te {activeWaLeadName}</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {waActiveMessages.map((msg) => {
                    const isOut = msg.direction === 'outbound';
                    const timeStr = (() => {
                      const d = msg.createdAt instanceof Date ? msg.createdAt : (msg.createdAt as any)?.toDate?.();
                      return d ? d.toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' }) : '';
                    })();
                    return (
                      <div key={msg.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] sm:max-w-[70%] px-3.5 py-2 rounded-2xl shadow-sm text-sm leading-relaxed ${
                          isOut
                            ? 'bg-[#d9fdd3] dark:bg-[#25D366]/25 text-foreground rounded-tr-none'
                            : 'bg-white dark:bg-card text-foreground rounded-tl-none'
                        }`}>
                          <p style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{msg.message}</p>
                          <div className={`flex items-center gap-1 mt-1 ${isOut ? 'justify-end' : 'justify-start'}`}>
                            <span className="text-[10px] text-muted-foreground/60">{timeStr}</span>
                            {isOut && <span className="text-[10px] text-[#25D366]">{msg.status === 'read' ? '\u2713\u2713' : '\u2713'}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {activeWaPhone && (
              <div className="px-4 pt-2 border-t bg-background" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))' }}>
                <div className="flex items-end gap-2">
                  <textarea
                    value={waText}
                    onChange={(e) => {
                      setWaText(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = Math.min(e.target.scrollHeight, 112) + 'px';
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendWa(); } }}
                    placeholder="Shkruaj mesazhin..."
                    rows={1}
                    className="flex-1 resize-none px-3 py-2.5 bg-muted rounded-2xl text-[16px] sm:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#25D366]/40 overflow-y-auto"
                    style={{ minHeight: '42px', maxHeight: '112px' }}
                  />
                  <Button
                    size="sm"
                    className="bg-[#25D366] hover:bg-[#1da851] text-white h-[42px] w-[42px] p-0 rounded-full shrink-0"
                    onClick={handleSendWa}
                    disabled={!waText.trim() || waSending}
                  >
                    {waSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5 px-1">Enter = dërgo · Shift+Enter = rresht i ri</p>
              </div>
            )}
          </>
        ) : (
          /* Regular Chat Area */
          <>
            <ScrollArea className="flex-1" ref={scrollRef}>
              <div className="px-2 sm:px-5 py-3 sm:py-4 space-y-0">
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
                              <div className="flex-1 h-px bg-border/50" />
                              <span className="text-[11px] font-medium text-muted-foreground/60 bg-background px-3 py-1 rounded-full border border-border/30">{formatDate(message.createdAt)}</span>
                              <div className="flex-1 h-px bg-border/50" />
                            </div>
                          )}
                          <div className={`flex group ${isOwn ? 'justify-end' : 'justify-start'} ${sameSender ? 'mt-0.5' : 'mt-3'}`}>
                            {/* Avatar — hidden on small screens to save space */}
                            {!isOwn && (
                              <div className="hidden sm:flex flex-shrink-0 mr-2 self-end mb-5">
                                {!sameSender ? (
                                  <div className={`h-7 w-7 rounded-xl ${getAvatarColor(message.senderId)} flex items-center justify-center shadow-sm`}>
                                    <span className="text-[9px] font-bold text-white">{senderName.slice(0, 2).toUpperCase()}</span>
                                  </div>
                                ) : <div className="w-7" />}
                              </div>
                            )}

                            <div className={`max-w-[85%] sm:max-w-[70%] flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
                              {/* Sender name */}
                              {!isOwn && !sameSender && (
                                <div className="flex items-center gap-1.5 mb-1 ml-1">
                                  <span className="text-[12px] font-semibold text-foreground/80">{senderName}</span>
                                  {(message as any).senderType === 'client' && (
                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-amber-300 text-amber-700 dark:text-amber-400">Klient</Badge>
                                  )}
                                </div>
                              )}

                              {/* Reply preview */}
                              {(message as any).replyToContent && (
                                <div className={`text-[11px] px-3 py-1.5 mb-1 rounded-xl max-w-full border-l-2 ${
                                  isOwn ? 'bg-primary/15 border-primary-foreground/30' : 'bg-muted/50 border-primary/30'
                                }`}>
                                  <span className="font-semibold text-[10px] text-primary">{(message as any).replyToSender}</span>
                                  <p className="truncate opacity-60 mt-0.5">{(message as any).replyToContent}</p>
                                </div>
                              )}

                              {/* Bubble */}
                              <div className={`relative px-4 py-2.5 ${
                                isOwn
                                  ? 'bg-primary text-primary-foreground rounded-2xl rounded-br-md'
                                  : 'bg-muted/60 border border-border/30 rounded-2xl rounded-bl-md'
                              } ${isDeleted ? 'opacity-30 italic' : ''}`}>
                                {isEditing ? (
                                  <div className="flex gap-1.5 items-center min-w-[160px]">
                                    <Input
                                      value={editText}
                                      onChange={e => setEditText(e.target.value)}
                                      className="h-7 text-xs bg-background text-foreground rounded-lg"
                                      autoFocus
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') handleEditMessage(message.id);
                                        if (e.key === 'Escape') { setEditingMessageId(null); setEditText(''); }
                                      }}
                                    />
                                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleEditMessage(message.id)}>
                                      <Check className="h-3 w-3" />
                                    </Button>
                                  </div>
                                ) : (
                                  <p className="text-[13.5px] leading-relaxed break-words whitespace-pre-wrap">{message.content}</p>
                                )}

                                {message.attachmentUrl && (
                                  <a href={message.attachmentUrl} target="_blank" rel="noopener noreferrer"
                                    className={`inline-flex items-center gap-1.5 text-xs mt-2 px-2.5 py-1 rounded-lg transition-colors ${
                                      isOwn ? 'bg-primary-foreground/15 hover:bg-primary-foreground/25' : 'bg-background hover:bg-accent text-primary'
                                    }`}>
                                    <FileIcon className="h-3 w-3" /><span className="truncate max-w-[140px]">{message.attachmentUrl.split('/').pop() || 'Skedar'}</span>
                                  </a>
                                )}

                                {/* Time inside bubble — WhatsApp style */}
                                {!isEditing && (
                                  <div className={`flex items-center gap-1 mt-1.5 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                                    <span className={`text-[10px] flex items-center gap-1 ${isOwn ? 'text-primary-foreground/55' : 'text-muted-foreground/50'}`}>
                                      {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                      {(message as any).editedAt && <span className="opacity-80"> · ndryshuar</span>}
                                      {isOwn && <Check className="h-2.5 w-2.5 opacity-70" />}
                                    </span>
                                  </div>
                                )}

                                {/* Hover actions — desktop hover, mobile long-press hint */}
                                {!isDeleted && !isEditing && (
                                  <div className={`absolute -top-3.5 ${isOwn ? 'left-1' : 'right-1'} opacity-0 group-hover:opacity-100 active:opacity-100 transition-all flex items-center bg-background border rounded-xl shadow-lg px-1 py-0.5 z-10 gap-0.5`}>
                                    <div className="relative">
                                      <button className="p-1 hover:bg-accent rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                                        onClick={() => setShowEmojiPicker(showEmojiPicker === message.id ? null : message.id)}>
                                        <SmilePlus className="h-3.5 w-3.5" />
                                      </button>
                                      {showEmojiPicker === message.id && (
                                        <div className={`absolute bottom-full ${isOwn ? 'left-0' : 'right-0'} mb-1 flex gap-0.5 bg-popover border rounded-xl shadow-lg px-2 py-1.5 z-50`}>
                                          {EMOJI_REACTIONS.map(emoji => (
                                            <button key={emoji} onClick={() => handleReaction(message.id, emoji)} className="hover:scale-125 transition-transform p-0.5 text-base">{emoji}</button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <button className="p-1 hover:bg-accent rounded-lg text-muted-foreground hover:text-foreground transition-colors" onClick={() => setReplyingTo(message)}>
                                      <Reply className="h-3.5 w-3.5" />
                                    </button>
                                    {isOwn && (
                                      <>
                                        <button className="p-1 hover:bg-accent rounded-lg text-muted-foreground hover:text-foreground transition-colors" onClick={() => { setEditingMessageId(message.id); setEditText(message.content); }}>
                                          <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                        <button className="p-1 hover:bg-destructive/10 rounded-lg text-muted-foreground hover:text-destructive transition-colors" onClick={() => handleDeleteMessage(message.id)}>
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Mobile-visible quick actions row */}
                              {!isDeleted && !isEditing && (
                                <div className={`flex sm:hidden items-center gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                                  <button
                                    className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground active:text-foreground"
                                    onClick={() => setReplyingTo(message)}
                                  >
                                    <Reply className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground active:text-foreground"
                                    onClick={() => setShowEmojiPicker(showEmojiPicker === message.id ? null : message.id)}
                                  >
                                    <SmilePlus className="h-3.5 w-3.5" />
                                  </button>
                                  {showEmojiPicker === message.id && (
                                    <div className={`absolute bottom-full ${isOwn ? 'right-0' : 'left-0'} mb-1 flex gap-1 bg-popover border rounded-xl shadow-lg px-2 py-2 z-50`}>
                                      {EMOJI_REACTIONS.map(emoji => (
                                        <button key={emoji} onClick={() => handleReaction(message.id, emoji)} className="text-lg p-0.5">{emoji}</button>
                                      ))}
                                    </div>
                                  )}
                                  {isOwn && (
                                    <button
                                      className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-destructive active:text-destructive"
                                      onClick={() => handleDeleteMessage(message.id)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              )}

                              {/* Reactions */}
                              {(message as any).reactions && Object.keys((message as any).reactions).length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1 px-0.5">
                                  {Object.entries((message as any).reactions as Record<string, string[]>).map(([emoji, users]) => (
                                    <button key={emoji} onClick={() => handleReaction(message.id, emoji)}
                                      className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                                        users.includes(user?.uid || '') ? 'bg-primary/10 border-primary/30 font-semibold' : 'bg-background border-border hover:border-primary/30'
                                      }`}>
                                      {emoji} <span className="text-[10px]">{users.length}</span>
                                    </button>
                                  ))}
                                </div>
                              )}


                            </div>
                          </div>
                        </React.Fragment>
                      );
                    });
                  })()
                ) : (
                  <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
                    <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
                      <MessageSquare className="h-6 w-6 opacity-30" />
                    </div>
                    <p className="text-sm font-medium text-foreground/50">
                      {searchQuery ? 'Nuk u gjet asnjë mesazh' : chatMode === 'direct' && !activeDirectUserId ? 'Zgjidh një person' : 'Fillo bisedën!'}
                    </p>
                    {!searchQuery && chatMode === 'channel' && <p className="text-xs text-muted-foreground/40 mt-1">Shkruaj mesazhin e parë</p>}
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Typing indicator */}
            {activeTypingUsers.length > 0 && (
              <div className="px-3 sm:px-5 py-1.5 text-xs text-muted-foreground flex items-center gap-2 border-t bg-muted/10">
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
              <div className="mx-3 mb-1 flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-xl border-l-2 border-primary">
                <Reply className="h-3 w-3 text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-semibold text-primary">{getUserDisplayName(replyingTo.senderId)}</span>
                  <p className="text-[11px] text-muted-foreground/70 truncate">{replyingTo.content}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-5 w-5 rounded-full" onClick={() => setReplyingTo(null)}><X className="h-2.5 w-2.5" /></Button>
              </div>
            )}

            {/* Message Input */}
            <div className="px-4 pt-2 border-t bg-background" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))' }}>
              {showAttachmentInput && (
                <div className="flex gap-2 items-center px-3 py-1.5 mb-2 bg-muted/30 rounded-xl border">
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <Input value={attachmentUrl} onChange={e => setAttachmentUrl(e.target.value)} placeholder="Ngjit URL skedarit..." disabled={isSending}
                    className="h-7 text-xs border-0 bg-transparent focus-visible:ring-0 shadow-none" />
                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={() => { setShowAttachmentInput(false); setAttachmentUrl(''); }}><X className="h-3 w-3" /></Button>
                </div>
              )}
              <form onSubmit={handleSendMessage}>
                <div className="flex items-end gap-2 bg-muted/20 border rounded-2xl px-3 py-2 focus-within:border-primary/40 focus-within:bg-background focus-within:shadow-md transition-all">
                  <div className="flex items-center gap-0.5 flex-shrink-0 pb-1">
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-muted-foreground/60 hover:text-foreground"
                      onClick={() => setShowAttachmentInput(!showAttachmentInput)} disabled={isSending}>
                      <Paperclip className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-muted-foreground/60 hover:text-foreground"
                      disabled={isSending} onClick={() => setShowEmojiPicker(showEmojiPicker ? null : 'input')}>
                      <SmilePlus className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <textarea
                    value={messageText}
                    onChange={handleTextareaInput}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e as any); } }}
                    placeholder={`Shkruaj${chatMode === 'channel' ? ` në #${CHANNELS.find(c => c.id === activeChannel)?.name || activeChannel}` : ` te ${getUserDisplayName(activeDirectUserId || '')}`}...`}
                    disabled={isSending}
                    rows={1}
                    className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[16px] sm:text-sm resize-none py-1.5 placeholder:text-muted-foreground/40 max-h-[120px]"
                  />

                  <Button
                    type="submit"
                    size="icon"
                    className={`h-9 w-9 rounded-full flex-shrink-0 mb-0.5 transition-all ${
                      messageText.trim() || attachmentUrl.trim() ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90' : 'bg-transparent text-muted-foreground/30'
                    }`}
                    disabled={isSending || (!messageText.trim() && !attachmentUrl.trim()) || (chatMode === 'direct' && !activeDirectUserId)}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </form>
              <div className="hidden sm:flex items-center justify-between mt-1.5 px-1">
                <p className="text-[10px] text-muted-foreground/30">Enter dërgon · Shift+Enter rresht i ri</p>
                <button className="text-[10px] text-muted-foreground/30 hover:text-primary transition-colors flex items-center gap-1">
                  <Link2 className="h-2.5 w-2.5" /> Lidh me task
                </button>
              </div>
              {messageMutation.error && <p className="text-xs text-destructive mt-1">{messageMutation.error.message}</p>}
            </div>
          </>
        )}

        {/* ── REQUESTS PANEL ── */}
        {chatMode === 'requests' && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Panel header */}
            <div className="px-5 py-3 border-b flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-amber-500" />
              <h2 className="font-semibold text-sm">Kërkesat e Klientëve</h2>
              {newRequestsCount > 0 && (
                <Badge className="bg-amber-500 text-white border-0 text-[10px] ml-1">{newRequestsCount} të reja</Badge>
              )}
            </div>

            {/* Status filter */}
            <div className="px-4 py-3 border-b flex gap-2 flex-wrap bg-muted/5">
              {(['__all__', 'New', 'In Review', 'In Progress', 'Completed', 'Rejected'] as const).map(status => (
                <Button
                  key={status}
                  variant={requestStatusFilter === status ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 text-xs px-3"
                  onClick={() => setRequestStatusFilter(status)}
                >
                  {status === '__all__' ? 'Të gjitha' : getReqStatusLabel(status)}
                  {status !== '__all__' && requests && (
                    <span className="ml-1 opacity-60">({requests.filter(r => r.status === status).length})</span>
                  )}
                </Button>
              ))}
            </div>

            {/* List */}
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-3">
                {filteredRequests.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 text-center">
                    <ClipboardList className="h-12 w-12 text-muted-foreground/30 mb-4" />
                    <p className="text-sm text-muted-foreground">Nuk ka kërkesa</p>
                  </div>
                ) : (
                  filteredRequests.map(request => {
                    const customer = customers?.find(c => c.id === request.customerId);
                    return (
                      <div
                        key={request.id}
                        onClick={() => setSelectedRequest(request)}
                        className="p-4 rounded-xl border bg-card hover:shadow-md hover:border-amber-300/40 cursor-pointer transition-all"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold truncate text-sm">{request.title}</p>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1">
                              <span>{customer?.name || 'Pa emer'}</span>
                              <span>·</span>
                              <span>{request.category}</span>
                              <span>·</span>
                              <span>{request.createdAt instanceof Date ? request.createdAt.toLocaleDateString('sq-AL') : ''}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${getPriorityColor(request.priority)}`}>
                              {getPriorityLabel(request.priority)}
                            </span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${getReqStatusColor(request.status)}`}>
                              {getReqStatusLabel(request.status)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        )}

      </main>

      {/* Request Detail Dialog */}
      <Dialog open={!!selectedRequest} onOpenChange={(open) => { if (!open) setSelectedRequest(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedRequest?.title}</DialogTitle>
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${getReqStatusColor(selectedRequest.status)}`}>
                  {getReqStatusLabel(selectedRequest.status)}
                </span>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${getPriorityColor(selectedRequest.priority)}`}>
                  {getPriorityLabel(selectedRequest.priority)}
                </span>
                <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground">{selectedRequest.category}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Klienti</p>
                  <p className="font-medium">{customers?.find(c => c.id === selectedRequest.customerId)?.name || 'Pa emer'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Data</p>
                  <p className="font-medium">{selectedRequest.createdAt instanceof Date ? selectedRequest.createdAt.toLocaleString('sq-AL') : '-'}</p>
                </div>
              </div>

              <Separator />

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Përshkrimi</p>
                <p className="text-sm whitespace-pre-wrap">{selectedRequest.description}</p>
              </div>

              {selectedRequest.attachmentUrl && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Bashkëngjitje</p>
                  <a href={selectedRequest.attachmentUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" /> Hap bashkëngjitjen
                  </a>
                </div>
              )}

              {selectedRequest.adminNotes && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Përgjigja e Ekipit</p>
                    <p className="text-sm whitespace-pre-wrap bg-muted p-3 rounded-lg">{selectedRequest.adminNotes}</p>
                  </div>
                </>
              )}

              {permissions.canEdit && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs">Ndrysho Statusin</Label>
                      <Select value={selectedRequest.status} onValueChange={(val) => handleUpdateRequestStatus(selectedRequest.id, val)}>
                        <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(['New', 'In Review', 'In Progress', 'Completed', 'Rejected'] as const).map(s => (
                            <SelectItem key={s} value={s}>{getReqStatusLabel(s)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Cakto Ekipin</Label>
                      <Select value={selectedRequest.assignedTeamId || ''} onValueChange={(val) => handleAssignTeam(selectedRequest.id, val)}>
                        <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Zgjidhni ekipin" /></SelectTrigger>
                        <SelectContent>
                          {teams?.map((team: any) => (
                            <SelectItem key={team.id} value={team.id}>{team.name}{team.department ? ` (${team.department})` : ''}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Shënim Administrativ</Label>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const fd = new FormData(e.currentTarget);
                          handleUpdateRequestStatus(selectedRequest.id, selectedRequest.status, fd.get('adminNotes') as string);
                        }}
                        className="flex gap-2 mt-1"
                      >
                        <Textarea name="adminNotes" defaultValue={selectedRequest.adminNotes || ''} placeholder="Shkruani përgjigjen ose shënimin..." rows={3} className="text-sm" />
                        <Button type="submit" size="sm" className="self-end">Ruaj</Button>
                      </form>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ChatView;
