import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, Link as RouterLink } from 'react-router-dom';
import { useCollection, useMutation, getGlobalTeamId, getGlobalBusinessId } from '../hooks/useFirestore';
import { aiResponseError } from '../lib/aiClient';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import {
  Send, MessageSquare, Users, Hash, Paperclip, X, FileIcon,
  FolderOpen, ArrowLeft, Search, Pencil, Trash2, Reply,
  SmilePlus, Check, Plus, Link2,
  Bot, Sparkles, Loader2, Copy, RefreshCw,
  ClipboardList, ExternalLink, UserPlus, ChevronDown, CheckCheck,
  ImageIcon, Circle, Pin, PinOff, Mic, Square, Filter, AtSign,
  Bookmark, BookmarkCheck, ListChecks,
  Zap, BellRing, AlarmClock, Wand2, Clock, CalendarClock, Rows3, Languages, Video,
  LogOut, Crown, Settings2, MoreVertical,
} from 'lucide-react';
import { useVideoCall } from '../hooks/useVideoCall';
import ConversationOwnerBar from '../components/chat/ConversationOwnerBar';
// Lazy-loaded so the ~260KB Daily.co video SDK only loads when a call starts.
const VideoCallModal = React.lazy(() => import('../components/VideoCallModal'));
import { useToast } from '../hooks/use-toast';
import { copyWithToast } from '../lib/clipboard';
import { ToastAction } from '../components/ui/toast';
import { useFileUpload } from '../hooks/useFileUpload';
import { getTimestampMs } from '../lib/utils';
import { safeExternalUrl } from '../lib/safeUrl';
import { useUnreadChat } from '../hooks/useUnreadChat';
import { isDmForMe, isUnreadClientMessage, groupFullyReadAfter, unionById } from '../lib/chat/unread';
import { useNotificationPrefs, useConversationPresence } from '../hooks/useNotificationPrefs';
import { channelConversationKey, dmConversationKey } from '../lib/notificationPrefs';
import { auth, db } from '../lib/firebase';
import { writeBatch, doc, updateDoc, setDoc, deleteDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import type { ChatMessage, UserProfile, Customer, ClientPortalAccess, Project, TeamMember, ClientRequest, Team, Task, Channel } from '../types';
import UnifiedChatList, { type UnifiedConv } from '../components/UnifiedChatList';

type ChatMode = 'channel' | 'direct' | 'ai' | 'requests';

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

// Fixed default channels (Përgjithshme / Ekipi / Mbështetja) were removed per
// product decision — chat now uses dynamic groups + DMs only. Kept as an (empty)
// typed list so the shared lookup/badge helpers that iterate it stay valid.
const CHANNELS: { id: string; name: string; icon: typeof Hash; description: string }[] = [];

// Fan-out ceiling for a group-channel notification. Each recipient costs one
// notification document plus one delivery relay call, and the relay is rate limited
// per caller (300/h) — an unbounded fan-out in a 100-person channel would exhaust it
// and start dropping notifications for everything else. A truncated fan-out is
// LOGGED, never silent.
// Mirrors MAX_FANOUT in api/_send-notification-email.ts. The fan-out is ONE server
// call, so the cap only bounds that call's work; 25 silently dropped members 26+.
const MAX_CHANNEL_NOTIFY = 200;
/** Newest messages loaded per DM thread (each direction). */
const DM_THREAD_LIMIT = 300;
/** dmThreads doc id: the two uids sorted, joined with '__' (mirrored in api/cron/run.ts). */
const dmThreadId = (a: string, b: string) => [a, b].sort().join('__');
const isCoarsePointer = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)')?.matches;

const EMOJI_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '💯', '✅', '🙏', '😎', '🤔'];

// Composer emoji grid — the quick reactions plus a modest extended set so the
// "Emoji" button in the message composer can insert emojis into the text.
const COMPOSER_EMOJIS = [
  ...EMOJI_REACTIONS,
  '😀', '😅', '😊', '😍', '😘', '😜', '🤗', '🙄', '😴', '😇',
  '👏', '🙌', '🤝', '👌', '✌️', '🤞', '💪', '🫶', '👀', '🧠',
  '🚀', '⭐', '🌟', '⚡', '💡', '📈', '💰', '🎯', '📌', '☕',
];

// Simple Albanian pluralization helper: singular when n === 1, else plural.
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const ACTIVE_MEMBERS_QUERY = {
  where: [{ field: 'status', operator: '==', value: 'Active' }],
  // Cross-team DM: list all active members across every team so people can
  // direct-message each other regardless of team membership.
  skipTeamFilter: true,
};
const ACTIVE_PORTAL_QUERY = {
  where: [{ field: 'status', operator: '==', value: 'Active' }],
};

const ChatView: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  // State
  const [messageText, setMessageText] = useState('');
  const [chatMode, setChatMode] = useState<ChatMode>('channel');
  const [activeChannel, setActiveChannel] = useState<string>(() => {
    const s = (location.state as any);
    // No fixed channels anymore — default to no selection (empty state) unless a
    // specific channel/group was passed via navigation state or ?channel= (push deep-link).
    if (s?.channel && typeof s.channel === 'string') return s.channel;
    return new URLSearchParams(location.search).get('channel') || '';
  });
  const [activeDirectUserId, setActiveDirectUserId] = useState<string | null>(() => {
    const s = (location.state as any);
    return s?.directUserId || new URLSearchParams(location.search).get('directUserId') || null;
  });
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
  const [clientScope, setClientScope] = useState<'all' | 'mine'>('all');
  // Search box to start a new DM (replaces the always-on "Anëtarë" list)
  const [dmSearch, setDmSearch] = useState('');
  // Pagination state
  const [channelLimit, setChannelLimit] = useState(100);

  // Mention autocomplete
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionAnchorIdx, setMentionAnchorIdx] = useState(0);
  const [mentionSelected, setMentionSelected] = useState(0);
  const [mentionKind, setMentionKind] = useState<'user' | 'customer'>('user');

  // Slash commands
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashSelected, setSlashSelected] = useState(0);

  // Pinned bar collapse
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  const [reactionPopover, setReactionPopover] = useState<{ msgId: string; emoji: string } | null>(null);

  // #44 Compact mode (persisted in localStorage)
  const [compactMode, setCompactMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('chat-compact-mode') === '1';
  });
  useEffect(() => {
    try { localStorage.setItem('chat-compact-mode', compactMode ? '1' : '0'); } catch { /* ignore */ }
  }, [compactMode]);

  // #43 Reaction shortcuts — keys 1..5 react with EMOJI_REACTIONS[0..4] on hovered message
  const hoveredMessageIdRef = useRef<string | null>(null);

  // #45 Custom status dialog
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusEmojiInput, setStatusEmojiInput] = useState('💬');
  const [statusTextInput, setStatusTextInput] = useState('');
  const [statusHoursInput, setStatusHoursInput] = useState<number>(2);

  // #42 Edit history viewer
  const [editHistoryMessageId, setEditHistoryMessageId] = useState<string | null>(null);
  const [readReceiptFor, setReadReceiptFor] = useState<string | null>(null); // group message id → show who read

  // Search filters
  const [showSearchFilters, setShowSearchFilters] = useState(false);
  const [searchSenderId, setSearchSenderId] = useState<string>('__any__');
  const [searchDateFrom, setSearchDateFrom] = useState<string>('');
  const [searchDateTo, setSearchDateTo] = useState<string>('');

  // Voice notes
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const editSavingRef = useRef(false);
  const recordingTimerRef = useRef<number | null>(null);

  // UX state
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  // Only render the most-recent N bubbles in the DOM (older reachable via the
  // "load older" button). Typing re-renders ChatView, and re-executing the full
  // bubble map for 100+ complex messages per keystroke is what made the keyboard
  // lag on mid/low devices (e.g. S21). Capping the rendered window keeps the
  // per-keystroke cost bounded regardless of thread length.
  const RENDER_STEP = 40;
  const [renderCap, setRenderCap] = useState(RENDER_STEP);

  // Mobile long-press action menu (WhatsApp/Telegram style): holds the id of the
  // message whose bottom-sheet is open. Desktop keeps its hover toolbar untouched.
  const [longPressMenuId, setLongPressMenuId] = useState<string | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards the synthetic click that fires after a long-press touchend, so opening
  // the menu doesn't also trigger a tap action on the bubble.
  const longPressFiredRef = useRef(false);

  // Start the press timer; after ~450ms open the action sheet + a subtle haptic.
  const startLongPress = useCallback((id: string) => {
    longPressFiredRef.current = false;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      try { navigator.vibrate?.(12); } catch { /* haptics optional */ }
      setLongPressMenuId(id);
    }, 450);
  }, []);
  // Cancel a pending press (finger lifted early, moved/scrolled, or cancelled).
  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  }, []);
  useEffect(() => () => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }, []);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const sessionUnreadIdsRef = useRef<Set<string>>(new Set());
  const seededConvKeyRef = useRef<string>('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);
  // Whether the user is scrolled to the bottom (kept in a ref so async effects
  // read a fresh value without re-subscribing).
  const atBottomRef = useRef(true);
  // Radix <ScrollArea> forwards its ref to the (overflow-hidden) Root; the real
  // scroller is the inner Viewport. Resolve it for any programmatic scrolling.
  const getScroller = (root: HTMLElement | null): HTMLElement | null =>
    root?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]') ?? null;
  const markedAsReadRef = useRef<Set<string>>(new Set());
  // Notification docs (bell) already dismissed this session so we don't re-batch them.
  const markedNotifReadRef = useRef<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);
  const composerEmojiRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const prevSeenMsgIdsRef = useRef<Set<string>>(new Set());
  const isInitialMsgLoadRef = useRef(true);
  const prevBgDmIdsRef = useRef<Set<string>>(new Set());
  const bgDmInitialRef = useRef(true);
  const mountTimeRef = useRef(new Date());

  // Pre-warm AudioContext on first user gesture so Chrome autoplay policy allows it
  useEffect(() => {
    const init = () => {
      const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new Ctx();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
    };
    document.addEventListener('click', init, { once: true });
    document.addEventListener('keydown', init, { once: true });
    return () => {
      document.removeEventListener('click', init);
      document.removeEventListener('keydown', init);
    };
  }, []);

  const playBirdChirp = useCallback(() => {
    try {
      const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new Ctx();
      }
      const ctx = audioCtxRef.current;
      // Skip if still suspended — browser hasn't unlocked audio yet
      if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); return; }

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
  const { data: rawPortalAccess } = useCollection<ClientPortalAccess>('clientPortalAccess', { ...ACTIVE_PORTAL_QUERY, skipTeamFilter: true });
  // No skipTeamFilter: customers/projects are businessIsolatedAlways, so the flag
  // never changed WHAT was read — it only fragmented the listener cache key, so
  // chat opened its own full-collection streams instead of sharing the ones the
  // CRM views already hold.
  const { data: customers } = useCollection<Customer>('customers');
  const { data: projects } = useCollection<Project>('projects');
  // `live`: the online dot / "Aktiv tani" read `lastSeen` (60 s heartbeat, 3-min
  // window); through the 5-minute static cache the dot lagged reality by minutes.
  const { data: userProfiles } = useCollection<UserProfile>('userProfiles', { live: true });
  // clientPortalAccess isn't business-scoped (portal users have no businessId), so the
  // chat "Klientët" list leaked other tenants' clients. customers IS business-scoped,
  // so intersect by customerId to scope the client list to this business.
  const portalAccess = useMemo(() => {
    if (!rawPortalAccess) return rawPortalAccess;
    const ids = new Set((customers || []).map(c => c.id));
    return rawPortalAccess.filter(a => a.customerId && ids.has(a.customerId));
  }, [rawPortalAccess, customers]);
  const { data: teams } = useCollection<Team>('teams');
  // 200 newest, pushed server-side (teamScopedWhere) — the previous read pulled
  // every request the business ever had, on every chat open. Composite index:
  // clientRequests(businessId, createdAt DESC).
  // The "requests" mode is unreachable (nothing sets it any more) — do not open a
  // 200-row listener on every chat visit for a panel nobody can reach.
  const { data: requests, } = useCollection<ClientRequest>('clientRequests', {
    skip: chatMode !== 'requests',
    orderBy: { field: 'createdAt', direction: 'desc' },
    limit: 200,
    teamScopedWhere: true,
  });
  const requestMutation = useMutation<ClientRequest>('clientRequests');
  const permissions = usePermissions();

  // ── WhatsApp-style groups (dynamic `channels` collection) ──
  // Visibility is membership-based, not team-based: a group is created with the
  // creator's teamId, but members from other teams must see it too. So we read
  // cross-team (skipTeamFilter) and gate purely on the `members` array below —
  // mirroring how DMs span teams.
  const { data: allGroups } = useCollection<Channel>('channels', { skipTeamFilter: true });
  const channelMutation = useMutation<Channel>('channels');
  // Only Admin/Manager/Owner may create groups.
  const canCreateGroups = !!(permissions.isAdmin || permissions.isManager || permissions.isOwner);
  // Groups the current user belongs to — only members see a group.
  const myGroups = useMemo(
    () => (allGroups || [])
      .filter(g => g.isGroup && Array.isArray(g.members) && user?.uid && g.members.includes(user.uid))
      // Most-recent conversation first (WhatsApp-style); name as tiebreaker.
      .sort((a, b) => {
        const at = a.lastMessageAt ? getTimestampMs(a.lastMessageAt) : 0;
        const bt = b.lastMessageAt ? getTimestampMs(b.lastMessageAt) : 0;
        if (bt !== at) return bt - at;
        return (a.name || '').localeCompare(b.name || '', 'sq');
      }),
    [allGroups, user?.uid],
  );
  // Resolve any active channel id → display metadata (fixed channel OR dynamic group).
  const getChannelMeta = useCallback((id: string): { name: string; description?: string; icon: any; isGroup: boolean; group?: Channel } | null => {
    const fixed = CHANNELS.find(c => c.id === id);
    if (fixed) return { name: fixed.name, description: fixed.description, icon: fixed.icon, isGroup: false };
    const g = (allGroups || []).find(x => x.id === id);
    if (g) return { name: g.name, description: g.description, icon: Users, isGroup: true, group: g };
    return null;
  }, [allGroups]);

  // Group create/manage dialog state
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState<string[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [manageGroupId, setManageGroupId] = useState<string | null>(null);
  const [addMemberQuery, setAddMemberQuery] = useState('');

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
    const map: Record<string, string> = { New: 'bg-blue-100 text-blue-700', 'In Review': 'bg-yellow-100 text-yellow-700', 'In Progress': 'bg-accent-soft text-primary', Completed: 'bg-green-100 text-green-700', Rejected: 'bg-red-100 text-red-700' };
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

  // Client channels (client-*) need skipTeamFilter because portal users may send
  // messages without teamId.  No orderBy — avoids composite index requirement;
  // sorting is done client-side in filteredMessages.
  const isClientChannel = activeChannel.startsWith('client-');
  // Group channels can hold messages stamped with different teamIds (members may
  // belong to different teams), so read them cross-team and filter by channelId.
  const isGroupChannel = useMemo(
    () => (allGroups || []).some(g => g.id === activeChannel && g.isGroup),
    [allGroups, activeChannel],
  );
  const usesServerLimit = isClientChannel || isGroupChannel;
  // Channel mode with nothing valid selected (fixed channels were removed) — show
  // the empty state and hide the composer.
  const channelHasNoSelection = chatMode === 'channel' && !isClientChannel && !isGroupChannel;
  const channelMsgQuery = useMemo(() => ({
    // No conversation open → no query. Without this, the empty-selection mount
    // ran a team-scoped read (where businessId only, everything else client-side)
    // that downloaded the ENTIRE business message history just to render nothing.
    skip: chatMode !== 'channel' || !activeChannel,
    where: [{ field: 'channelId', operator: '==', value: activeChannel }],
    // Order by time so the limit window is the NEWEST messages. Without this the
    // group/client path (skipTeamFilter) applied `limit` server-side with no
    // orderBy → Firestore ordered by document-id (random), so a freshly-sent
    // message often fell outside the window and only appeared after a refresh.
    // Index messages(channelId, createdAt DESC) already exists.
    orderBy: { field: 'createdAt', direction: 'desc' as const },
    limit: channelLimit,
    // Always the server-limited path: channelIds are globally unique (group doc
    // ids / client-<customerId>), so the tenant predicate adds nothing here, and
    // the team-scoped fallback (e.g. a group deep-link arriving before allGroups
    // loads) silently ignored `limit` and pulled the whole business history.
    skipTeamFilter: true,
  }), [chatMode, activeChannel, channelLimit]);
  const { data: channelMessages, loading: channelPending, error: channelError } = useCollection<ChatMessage>('messages', channelMsgQuery);

  // Background query: unread client messages — drives per-channel unread badges.
  // teamScopedWhere pushes the whole predicate server-side; without it the
  // "team-scoped" default fetched EVERY message in the business and filtered
  // client-side, with no limit at all (the top chat-load cost). Composite index:
  // messages(businessId, senderType, isRead, createdAt DESC).
  const allUnreadClientQuery = useMemo(() => ({
    where: [
      { field: 'senderType', operator: '==' as const, value: 'client' },
      { field: 'isRead', operator: '==' as const, value: false },
    ],
    orderBy: { field: 'createdAt', direction: 'desc' as const },
    limit: 300,
    teamScopedWhere: true,
  }), []);
  const { data: allUnreadClientMsgs } = useCollection<ChatMessage>('messages', allUnreadClientQuery);

  // Background query: most-recent client messages (read OR unread, any team) —
  // drives last-activity sorting of the client conversation list. skipTeamFilter
  // because client conversations span teams; server-side orderBy needs the
  // composite index messages(senderType, createdAt) in firestore.indexes.json.
  const recentClientMsgsQuery = useMemo(() => ({
    where: [{ field: 'senderType', operator: '==' as const, value: 'client' }],
    orderBy: { field: 'createdAt', direction: 'desc' as const },
    limit: 200,
    // Push everything server-side: the businessId-only default IGNORES limit
    // (useCollection applies it only under teamScopedWhere), so this "200 newest"
    // read actually downloaded every message in the business. Composite index:
    // messages(businessId, senderType, createdAt DESC).
    teamScopedWhere: true,
  }), []);
  const { data: recentClientMsgs } = useCollection<ChatMessage>('messages', recentClientMsgsQuery);

  // customerId → latest client-message timestamp (ms).
  const clientRecencyMap = useMemo(() => {
    const map = new Map<string, number>();
    recentClientMsgs?.forEach(m => {
      const cid = (m.channelId || '').match(/^client-([A-Za-z0-9]+)/)?.[1];
      if (!cid) return;
      const t = getTimestampMs(m.createdAt);
      if (t > (map.get(cid) || 0)) map.set(cid, t);
    });
    return map;
  }, [recentClientMsgs]);

  // ONE unread model for every surface (list badges, header total, Sidebar,
  // MobileBottomNav) — see src/lib/chat/unread.ts. The DM badge used to be counted
  // from `bgReceivedDMs` (the 100 newest received rows of ANY read state) while the
  // nav badge counted `receiverId == me && isRead == false`; a group badge was
  // "read by anyone" here and per-member in the Sidebar. Counted == marked now.
  const unread = useUnreadChat();
  // Per-channel client unread — from the shared model (excludes deleted rows and
  // colleagues' messages; the old map counted every row of the query).
  const clientUnreadMap = unread.clientByChannel;

  // ONE thread, bounded. These used to be `senderId == me` / `receiverId == me` with
  // no limit — every message the user ever sent ANYWHERE (groups, client threads)
  // was downloaded on entering DM mode and filtered client-side. Now: the pair,
  // newest DM_THREAD_LIMIT, server-side (index messages(senderId, receiverId,
  // createdAt DESC)); cross-team by design, so no tenant predicate.
  const directMsgQuery = useMemo(() => ({
    skip: !user?.uid || chatMode !== 'direct' || !activeDirectUserId,
    where: user?.uid && activeDirectUserId ? [
      { field: 'senderId', operator: '==' as const, value: user.uid },
      { field: 'receiverId', operator: '==' as const, value: activeDirectUserId },
    ] : undefined,
    orderBy: { field: 'createdAt', direction: 'desc' as const },
    limit: DM_THREAD_LIMIT,
    skipTeamFilter: true,
  }), [user?.uid, chatMode, activeDirectUserId]);
  const directMsgReceivedQuery = useMemo(() => ({
    skip: !user?.uid || chatMode !== 'direct' || !activeDirectUserId,
    where: user?.uid && activeDirectUserId ? [
      { field: 'senderId', operator: '==' as const, value: activeDirectUserId },
      { field: 'receiverId', operator: '==' as const, value: user.uid },
    ] : undefined,
    orderBy: { field: 'createdAt', direction: 'desc' as const },
    limit: DM_THREAD_LIMIT,
    skipTeamFilter: true,
  }), [user?.uid, chatMode, activeDirectUserId]);

  // Thread heads for the DM list (WhatsApp-style): one doc per pair, written by the
  // sender on every DM. The list preview used to come from the 100 newest messages
  // I SENT anywhere — for a group-heavy user that window held no DMs at all, so
  // every DM row lost its "Ti: …" preview and its recency, and dropped out of the
  // main list. Legacy threads without a head still fall back to those windows.
  const dmThreadsQuery = useMemo(() => ({
    skip: !user?.uid,
    where: user?.uid ? [{ field: 'participants', operator: 'array-contains' as const, value: user.uid }] : undefined,
    skipTeamFilter: true,
  }), [user?.uid]);
  const { data: dmThreads } = useCollection<any>('dmThreads', dmThreadsQuery);

  // Always-on background query: received DMs regardless of active chat mode
  const bgDmQuery = useMemo(() => ({
    skip: !user?.uid,
    where: user?.uid ? [{ field: 'receiverId', operator: '==', value: user.uid }] : undefined,
    orderBy: { field: 'createdAt', direction: 'desc' as const },
    limit: 100,
    skipTeamFilter: true,
  }), [user?.uid]);

  // Always-on background query: sent DMs (for last-message preview in sidebar)
  const bgSentDMsQuery = useMemo(() => ({
    skip: !user?.uid,
    where: user?.uid ? [{ field: 'senderId', operator: '==', value: user.uid }] : undefined,
    orderBy: { field: 'createdAt', direction: 'desc' as const },
    limit: 100,
    skipTeamFilter: true,
  }), [user?.uid]);
  const { data: bgSentDMs } = useCollection<ChatMessage>('messages', bgSentDMsQuery);

  // Always-on background query: unread messages (drives sidebar channel badges).
  // Capped to the 200 NEWEST — and the cap is real only with teamScopedWhere
  // (the default businessId-only path ignores server limit and downloaded the
  // whole message history). Composite index: messages(businessId, isRead, createdAt DESC).
  const allUnreadChannelQuery = useMemo(() => ({
    skip: !user?.uid,
    where: [{ field: 'isRead', operator: '==', value: false }],
    orderBy: { field: 'createdAt', direction: 'desc' as const },
    limit: 200,
    teamScopedWhere: true,
  }), [user?.uid]);
  const { data: allUnreadTeamMsgs } = useCollection<ChatMessage>('messages', allUnreadChannelQuery);
  const { data: bgReceivedDMs } = useCollection<ChatMessage>('messages', bgDmQuery);

  // My unread bell notifications — used to auto-dismiss a chat notification (client
  // message / @mention) the moment I open its linked conversation. Without this the
  // message badge cleared but the bell count lingered until manually tapped.
  // EXACTLY the shape NotificationsCenter uses (userId + createdAt desc + limit 100),
  // for two reasons. (1) The old query was `userId + isRead` with `limit: 200` and NO
  // orderBy — Firestore then returns 200 documents by __name__, an arbitrary subset,
  // so past 200 unread rows opening a conversation no longer cleared its bell entry.
  // (2) The module-level listener cache keys on the query shape, so matching the bell
  // means SHARING its listener instead of opening a second one. `isRead` is filtered
  // client-side, and the existing notifications(userId, createdAt DESC) index covers it.
  const myNotifQuery = useMemo(() => ({
    skip: !user?.uid,
    where: user?.uid ? [{ field: 'userId', operator: '==' as const, value: user.uid }] : undefined,
    orderBy: { field: 'createdAt', direction: 'desc' as const },
    limit: 100,
  }), [user?.uid]);
  const { data: myNotifs } = useCollection<any>('notifications', myNotifQuery);
  const myUnreadNotifs = useMemo(() => (myNotifs || []).filter((n: any) => !n.isRead), [myNotifs]);

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

  const messages = useMemo(() => {
    if (chatMode !== 'channel') return directMessages;
    // Guard against the brief flash of the previous channel's messages right
    // after a switch — the live query result lags the activeChannel change.
    return (channelMessages || []).filter(m => m.channelId === activeChannel);
  }, [chatMode, channelMessages, activeChannel, directMessages]);
  const isPending = chatMode === 'channel' ? channelPending : (sentPending || receivedPending);
  // A permission-denied on one channel must NOT blank the whole chat — that channel
  // just isn't readable (e.g. a stale/cross-tenant/deleted conversation). Only treat
  // genuine/unexpected errors as fatal; permission-denied leaves chat usable and the
  // selected channel simply renders empty.
  const error = chatMode === 'channel' && (channelError as any)?.code !== 'permission-denied' ? channelError : null;

  const filteredMessages = useMemo(() => {
    if (!messages) return [];
    const visible = messages.filter(m => !(m as any).deletedAt);
    // Always sort by time — DMs have no server-side orderBy to avoid composite index
    const sorted = [...visible].sort((a, b) => getTimestampMs(a.createdAt) - getTimestampMs(b.createdAt));
    // Channel pagination: team-scoped reads ignore the server `limit`, so bound the
    // rendered window to the most-recent `channelLimit` here ("load older" raises it).
    const ordered = (chatMode === 'channel' && !usesServerLimit && sorted.length > channelLimit)
      ? sorted.slice(-channelLimit)
      : sorted;
    const senderFilter = searchSenderId !== '__any__' ? searchSenderId : null;
    const fromMs = searchDateFrom ? new Date(searchDateFrom + 'T00:00:00').getTime() : null;
    const toMs = searchDateTo ? new Date(searchDateTo + 'T23:59:59').getTime() : null;
    const q = searchQuery.trim().toLowerCase();
    if (!q && !senderFilter && fromMs == null && toMs == null) return ordered;
    return ordered.filter(m => {
      if (q && !(m.content || '').toLowerCase().includes(q)) return false;
      if (senderFilter && m.senderId !== senderFilter) return false;
      if (fromMs != null || toMs != null) {
        const t = getTimestampMs(m.createdAt);
        if (fromMs != null && t < fromMs) return false;
        if (toMs != null && t > toMs) return false;
      }
      return true;
    });
  }, [messages, searchQuery, searchSenderId, searchDateFrom, searchDateTo, chatMode, usesServerLimit, channelLimit]);

  // Pinned messages for current channel/DM — always visible, regardless of search filters
  const pinnedMessages = useMemo(() => {
    if (!messages) return [];
    return messages.filter(m => (m as any).isPinned && !(m as any).deletedAt);
  }, [messages]);

  // Unique senders within the visible message set — for the search Sender filter
  const visibleSenders = useMemo(() => {
    if (!messages) return [] as string[];
    const set = new Set<string>();
    messages.forEach(m => { if (!(m as any).deletedAt) set.add(m.senderId); });
    return Array.from(set);
  }, [messages]);

  const profileMap = useMemo(() => {
    const map = new Map<string, UserProfile>();
    userProfiles?.forEach(p => map.set(p.userId, p));
    return map;
  }, [userProfiles]);

  // Hoisted above AI callbacks (summarize / polish / suggest / extract / translate / reminder)
  // to avoid TDZ when their dependency arrays reference `getUserDisplayName` before declaration.
  const displayNameCache = useMemo(() => {
    const map = new Map<string, string>();
    if (user?.uid) map.set(user.uid, user.displayName || user.email?.split('@')[0] || 'Ti');
    userProfiles?.forEach(p => { if (p.userId && p.displayName) map.set(p.userId, p.displayName); });
    teamMembers?.forEach(m => {
      if (m.userId && !map.has(m.userId)) {
        if (m.displayName) map.set(m.userId, m.displayName);
        else if (m.email) map.set(m.userId, m.email.split('@')[0]);
      }
    });
    teams?.forEach((t: any) => {
      if (t.createdByUserId && !map.has(t.createdByUserId)) map.set(t.createdByUserId, 'Admin');
    });
    // Portal clients: resolve their auth uid → customer name (they aren't team members).
    portalAccess?.forEach((a: any) => {
      if (a.userId && !map.has(a.userId)) {
        const c = customers?.find(cu => cu.id === a.customerId);
        if (c?.name) map.set(a.userId, c.name);
        else if (a.email) map.set(a.userId, a.email.split('@')[0]);
      }
    });
    return map;
  }, [user?.uid, user?.displayName, user?.email, userProfiles, teamMembers, teams, portalAccess, customers]);

  const getUserDisplayName = useCallback((userId: string) => {
    const cached = displayNameCache.get(userId);
    if (cached) return cached;
    return `User ${userId.slice(0, 6)}`;
  }, [displayNameCache]);

  // Sender avatar for push notifications — only https URLs (the FCM image field
  // rejects anything else). Returns undefined for users without an uploaded photo,
  // which safely falls back to a plain notification.
  const getUserAvatar = useCallback((userId: string): string | undefined => {
    const url = (profileMap.get(userId) as any)?.avatarUrl;
    return typeof url === 'string' && /^https:\/\//i.test(url) ? url : undefined;
  }, [profileMap]);

  // #45 Custom status — returns active (non-expired) status for a user, or null.
  const getUserStatus = useCallback((uid: string): { emoji: string; text: string } | null => {
    const p = profileMap.get(uid);
    if (!p) return null;
    const status = (p as any).customStatus as string | undefined;
    const emoji = (p as any).customStatusEmoji as string | undefined;
    if (!status && !emoji) return null;
    const expires = (p as any).customStatusExpiresAt;
    if (expires) {
      const exp = expires instanceof Date ? expires.getTime() : new Date(expires).getTime();
      if (Number.isFinite(exp) && exp <= Date.now()) return null;
    }
    return { emoji: emoji || '💬', text: status || '' };
  }, [profileMap]);

  const directConversations = useMemo(() => {
    if (!user) return [];
    const userIds = new Set<string>();
    allDirectMessages.forEach(m => {
      if (m.senderId !== user.uid) userIds.add(m.senderId);
      if (m.receiverId && m.receiverId !== user.uid) userIds.add(m.receiverId);
    });
    bgReceivedDMs?.forEach(m => {
      if (!(m as any).channelId) userIds.add(m.senderId);
    });
    bgSentDMs?.forEach(m => {
      if (!(m as any).channelId && m.receiverId && m.receiverId !== user.uid) userIds.add(m.receiverId);
    });
    (dmThreads || []).forEach((t: any) => {
      (Array.isArray(t.participants) ? t.participants : []).forEach((uid: string) => { if (uid && uid !== user.uid) userIds.add(uid); });
    });
    return Array.from(userIds);
  }, [allDirectMessages, bgReceivedDMs, bgSentDMs, dmThreads, user]);

  const directUnreadMap = unread.dmBySender;
  const channelUnreadMap = unread.groupByChannel;

  const otherMembers = useMemo(() => {
    if (!teamMembers) return [];
    const seen = new Set<string>();
    return teamMembers.filter(m => {
      if (m.userId === user?.uid || seen.has(m.userId)) return false;
      seen.add(m.userId);
      return true;
    });
  }, [teamMembers, user?.uid]);

  // Who is legitimately IN a conversation — i.e. the only people a notification
  // about it may reach. A group channel carries an explicit `members` array; a
  // client-portal channel is staff-side (the portal client is notified separately).
  // Returns null when the audience cannot be resolved, and callers then fall back to
  // "notify nobody new" rather than guessing — a mention that reaches a non-member
  // ships 100 characters of the message to someone the Firestore rules would refuse
  // to let open the channel.
  const channelMemberIds = useCallback((channelId: string): string[] | null => {
    if (!channelId) return null;
    const group = (allGroups || []).find(g => g.id === channelId && (g as any).isGroup);
    if (group) return Array.isArray((group as any).members) ? (group as any).members.filter(Boolean) : [];
    if (channelId.startsWith('client-')) {
      return (teamMembers || []).map((m: any) => m.userId).filter(Boolean);
    }
    return null;
  }, [allGroups, teamMembers]);

  // Members matching the "start a new DM" search box (by display name).
  const dmSearchResults = useMemo(() => {
    const q = dmSearch.trim().toLowerCase();
    if (!q) return [];
    return otherMembers
      .filter(m => getUserDisplayName(m.userId).toLowerCase().includes(q))
      .slice(0, 30);
  }, [dmSearch, otherMembers, getUserDisplayName]);

  const messageMutation = useMutation<ChatMessage>('messages');
  const notificationMutation = useMutation<any>('notifications');
  // The ONE gate for every in-chat alert (chirp + toast). Cilësimet → Tingull, the
  // DND window and a muted "Mesazhe" category were all invisible to this view, so
  // chat rang through a mute and through DND.
  const { canPlaySound, canAlert } = useNotificationPrefs();
  const userProfileMutation = useMutation<UserProfile>('userProfiles');
  const taskMutation = useMutation<Task>('tasks');
  const bookmarkMutation = useMutation<any>('chatBookmarks');
  const isSending = messageMutation.loading;

  // ── #7 Drafts auto-save (per conversation, localStorage) ──
  const draftKey = useMemo(() => {
    if (!user?.uid) return null;
    if (chatMode === 'channel' && activeChannel) return `chat:draft:${user.uid}:channel:${activeChannel}`;
    if (chatMode === 'direct' && activeDirectUserId) return `chat:draft:${user.uid}:dm:${activeDirectUserId}`;
    return null;
  }, [user?.uid, chatMode, activeChannel, activeDirectUserId]);

  // Load draft when conversation changes
  useEffect(() => {
    if (!draftKey) return;
    try {
      const draft = localStorage.getItem(draftKey) || '';
      setMessageText(draft);
    } catch { /* localStorage disabled */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // Save / clear draft on text change (debounced)
  useEffect(() => {
    if (!draftKey) return;
    const t = setTimeout(() => {
      try {
        if (messageText && messageText.trim().length > 0) localStorage.setItem(draftKey, messageText);
        else localStorage.removeItem(draftKey);
      } catch { /* localStorage disabled */ }
    }, 400);
    return () => clearTimeout(t);
  }, [messageText, draftKey]);

  // ── #8 Bookmarks / Save for later ──
  const bookmarksQuery = useMemo(() => ({
    skip: !user?.uid,
    where: user?.uid ? [{ field: 'userId', operator: '==' as const, value: user.uid }] : undefined,
    skipTeamFilter: true,
  }), [user?.uid]);
  const { data: bookmarks } = useCollection<any>('chatBookmarks', bookmarksQuery);
  const bookmarkedMessageIds = useMemo(() => {
    const s = new Set<string>();
    bookmarks?.forEach(b => { if (b.messageId) s.add(b.messageId); });
    return s;
  }, [bookmarks]);

  const handleToggleBookmark = useCallback(async (msg: ChatMessage) => {
    if (!user?.uid) return;
    const existing = bookmarks?.find((b: any) => b.messageId === msg.id);
    try {
      if (existing) {
        await bookmarkMutation.remove(existing.id);
        toast({ title: 'U hoq nga të ruajturat' });
      } else {
        const teamId = getGlobalTeamId() || '';
        await bookmarkMutation.create({
          userId: user.uid,
          teamId,
          messageId: msg.id,
          channelId: (msg as any).channelId || null,
          directWith: (msg as any).channelId ? null : (msg.senderId === user.uid ? msg.receiverId : msg.senderId),
          senderId: msg.senderId,
          content: (msg.content || '').slice(0, 500),
          createdAt: new Date(),
        } as any);
        toast({ title: 'U ruajt për më vonë', description: 'E gjen te tab-i "Të Ruajtura".' });
      }
    } catch (err) {
      console.error('[ChatView] bookmark toggle failed', err);
      toast({ title: 'Gabim', description: 'Nuk u arrit ruajtja.', variant: 'destructive' });
    }
  }, [user?.uid, bookmarks, bookmarkMutation, toast]);

  // ── #6 Saved Replies / Snippets ──
  const snippetMutation = useMutation<any>('chatSnippets');
  const { data: snippets } = useCollection<any>('chatSnippets');
  const [snippetPickerOpen, setSnippetPickerOpen] = useState(false);
  const [snippetSearch, setSnippetSearch] = useState('');
  const [newSnippetShortcut, setNewSnippetShortcut] = useState('');
  const [newSnippetContent, setNewSnippetContent] = useState('');

  const filteredSnippets = useMemo(() => {
    const q = snippetSearch.trim().toLowerCase();
    const list = snippets || [];
    if (!q) return list;
    return list.filter((s: any) =>
      (s.shortcut || '').toLowerCase().includes(q) ||
      (s.content || '').toLowerCase().includes(q)
    );
  }, [snippets, snippetSearch]);

  const insertSnippet = useCallback((content: string) => {
    setMessageText(prev => {
      const text = (prev || '').trim();
      // If composer starts with `/snippet` slash, replace whole text
      if (/^\/(snippet|sn)\b/.test(text)) return content;
      return text ? `${text} ${content}` : content;
    });
    setSnippetPickerOpen(false);
    requestAnimationFrame(() => chatTextareaRef.current?.focus());
  }, []);

  const handleCreateSnippet = useCallback(async () => {
    if (!user?.uid || !newSnippetContent.trim()) return;
    try {
      await snippetMutation.create({
        shortcut: newSnippetShortcut.trim().toLowerCase().replace(/\s+/g, '-') || `snippet-${Date.now()}`,
        content: newSnippetContent.trim(),
        createdByUserId: user.uid,
        createdAt: new Date(),
      } as any);
      setNewSnippetShortcut('');
      setNewSnippetContent('');
      toast({ title: 'Përgjigja u ruajt' });
    } catch (err) {
      console.error('[ChatView] create snippet failed', err);
      toast({ title: 'Gabim', description: 'Përgjigja nuk u ruajt.', variant: 'destructive' });
    }
  }, [user?.uid, newSnippetShortcut, newSnippetContent, snippetMutation, toast]);

  const handleDeleteSnippet = useCallback(async (id: string) => {
    try {
      await snippetMutation.remove(id);
      toast({ title: 'U fshi' });
    } catch (err) {
      console.error('[ChatView] delete snippet failed', err);
    }
  }, [snippetMutation, toast]);

  // ── Video call (Daily) ──
  const { roomUrl: videoRoomUrl, starting: videoStarting, start: startVideo, close: closeVideo } = useVideoCall();
  const startVideoCall = async () => {
    let room = '';
    if (chatMode === 'channel' && activeChannel) room = `fivocrm-${activeChannel}`;
    else if (chatMode === 'direct' && activeDirectUserId && user) room = `fivocrm-dm-${[user.uid, activeDirectUserId].sort().join('-')}`;
    else return;
    room = room.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
    const url = await startVideo(room);
    if (!url) return;
    // Post the join link as a message in EVERY conversation kind — the DM /
    // group notification path is what actually tells the callee (nothing else
    // did: useVideoCall only creates the room).
    handleSendMessage(null, { content: `📹 Thirrje video u nis. Bashkohu: ${url}` });
  };

  // ── #19 AI Summary of conversation ──
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryText, setSummaryText] = useState('');

  const handleSummarizeChat = useCallback(async () => {
    if (!user || summaryLoading) return;
    const source = chatMode === 'channel' ? channelMessages : directMessages;
    const recent = (source || []).slice(-60).filter((m: any) => !m.deletedAt && (m.content || '').trim());
    if (recent.length === 0) {
      toast({ title: 'Asnjë mesazh për të përmbledhur' });
      return;
    }
    setSummaryOpen(true);
    setSummaryLoading(true);
    setSummaryText('');
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      const transcript = recent.map((m: any) => {
        const name = getUserDisplayName(m.senderId) || 'Përdorues';
        const plain = String(m.content || '').replace(/<[^>]+>/g, '').replace(/[*_`~]/g, '');
        return `${name}: ${plain}`;
      }).join('\n');
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `Përmblidh shkurt këtë bisedë në shqip. Jep:\n1. Tema kryesore (1 fjali)\n2. Vendimet e marra (lista)\n3. Hapat e ardhshëm / detyrat (lista me përgjegjësin nëse përmendet)\n4. Pyetjet e hapura (nëse ka)\n\nBiseda:\n\n${transcript}`,
          }],
          context: { userRole: 'staff' },
          teamId: getGlobalTeamId(),
        }),
      });
      if (!res.ok) throw await aiResponseError(res);
      const data = await res.json();
      setSummaryText(data.reply || 'Pa përgjigje.');
    } catch (err: any) {
      console.error('[ChatView] summarize failed', err);
      setSummaryText(`⚠️ ${err.message || 'Gabim gjatë përmbledhjes.'}`);
    } finally {
      setSummaryLoading(false);
    }
  }, [user, summaryLoading, chatMode, channelMessages, directMessages, toast, getUserDisplayName]);

  // ── #23 Tone polish with AI ──
  const [polishLoading, setPolishLoading] = useState(false);
  const handlePolishMessage = useCallback(async () => {
    if (polishLoading) return;
    const raw = messageText.trim();
    if (!raw) return;
    setPolishLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `Përmirëso këtë mesazh në shqip për një bisedë profesionale (qartë, e sjellshme, pa gabime, pa shtuar informacione të reja, ruaj kuptimin dhe gjatësinë e ngjashme). Ktheji VETËM tekstin e përmirësuar, pa shpjegime ose thonjëza.\n\nMesazhi:\n${raw}`,
          }],
          context: { userRole: 'staff' },
          teamId: getGlobalTeamId(),
        }),
      });
      if (!res.ok) throw await aiResponseError(res);
      const data = await res.json();
      const polished = String(data.reply || '').trim().replace(/^["']|["']$/g, '');
      if (polished) {
        setMessageText(polished);
        toast({ title: 'Teksti u përmirësua' });
      }
    } catch (err: any) {
      console.error('[ChatView] polish failed', err);
      toast({ title: 'Gabim', description: err.message || 'Përmirësimi dështoi', variant: 'destructive' });
    } finally {
      setPolishLoading(false);
    }
  }, [polishLoading, messageText, toast]);

  // ── #21 Smart Reply suggestions ──
  const [smartReplies, setSmartReplies] = useState<string[]>([]);
  const [smartRepliesLoading, setSmartRepliesLoading] = useState(false);
  const handleSuggestReplies = useCallback(async () => {
    if (smartRepliesLoading) return;
    const pool: any[] = chatMode === 'direct' ? directMessages : channelMessages;
    if (!pool || pool.length === 0) return;
    // Find the last incoming (non-own) message
    const lastIncoming = [...pool].reverse().find(m => m.senderId !== user?.uid && !(m as any).deletedAt);
    if (!lastIncoming) {
      toast({ title: 'Nuk ka mesazh për t\u2019iu përgjigjur' });
      return;
    }
    const lastFew = pool.slice(-8).map((m: any) => {
      const who = m.senderId === user?.uid ? 'Unë' : (getUserDisplayName(m.senderId) || 'Përdorues');
      const plain = String(m.content || '').replace(/<[^>]+>/g, '').replace(/[*_`~]/g, '');
      return `${who}: ${plain}`;
    }).join('\n');
    setSmartRepliesLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `Bazuar në këtë bisedë, sugjero 3 përgjigje TË SHKURTRA e profesionale në shqip (maksimum 12 fjalë secila), si "Unë" do të përgjigjej te mesazhi i fundit i marrë. Ktheji VETËM si JSON array me 3 stringje, pa shpjegim. Shembull: ["Po, dakord", "Mund të flasim nesër?", "Faleminderit, e mora"].\n\nBiseda:\n${lastFew}`,
          }],
          context: { userRole: 'staff' },
          teamId: getGlobalTeamId(),
        }),
      });
      if (!res.ok) throw await aiResponseError(res);
      const data = await res.json();
      const raw = String(data.reply || '').trim();
      let parsed: string[] = [];
      try {
        const match = raw.match(/\[[\s\S]*\]/);
        parsed = JSON.parse(match ? match[0] : raw);
      } catch {
        parsed = raw.split(/\n+/).map(s => s.replace(/^[\d.\-*\s"'`]+|["'`]+$/g, '').trim()).filter(Boolean).slice(0, 3);
      }
      const cleaned = parsed.filter(s => typeof s === 'string' && s.trim()).slice(0, 3);
      if (cleaned.length === 0) throw new Error('Pa sugjerime');
      setSmartReplies(cleaned);
    } catch (err: any) {
      console.error('[ChatView] smart replies failed', err);
      toast({ title: 'Gabim', description: err.message || 'Sugjerimet dështuan', variant: 'destructive' });
    } finally {
      setSmartRepliesLoading(false);
    }
  }, [smartRepliesLoading, chatMode, directMessages, channelMessages, user, toast, getUserDisplayName]);

  // ── #22 Auto-translate inline ──
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const handleTranslateMessage = useCallback(async (msgId: string, content: string) => {
    if (translatingId) return;
    if (translations[msgId]) {
      // Toggle off
      setTranslations(prev => { const next = { ...prev }; delete next[msgId]; return next; });
      return;
    }
    const plain = String(content || '').replace(/<[^>]+>/g, '').trim();
    if (!plain) return;
    setTranslatingId(msgId);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `Përkthe këtë tekst në shqip (nëse është tashmë në shqip, përktheje në anglisht). Ktheji VETËM tekstin e përkthyer, pa shpjegim ose thonjëza.\n\nTeksti:\n${plain}`,
          }],
          context: { userRole: 'staff' },
          teamId: getGlobalTeamId(),
        }),
      });
      if (!res.ok) throw await aiResponseError(res);
      const data = await res.json();
      const translated = String(data.reply || '').trim().replace(/^["']|["']$/g, '');
      if (translated) setTranslations(prev => ({ ...prev, [msgId]: translated }));
    } catch (err: any) {
      console.error('[ChatView] translate failed', err);
      toast({ title: 'Përkthimi dështoi', description: err.message, variant: 'destructive' });
    } finally {
      setTranslatingId(null);
    }
  }, [translatingId, translations, toast]);

  // ── #24 Action extraction: AI proposes tasks from recent messages ──
  const [actionExtractOpen, setActionExtractOpen] = useState(false);
  const [actionExtractLoading, setActionExtractLoading] = useState(false);
  const [proposedActions, setProposedActions] = useState<Array<{ title: string; priority: 'low' | 'medium' | 'high'; assignee?: string; selected: boolean }>>([]);
  const handleExtractActions = useCallback(async () => {
    if (actionExtractLoading) return;
    const pool: any[] = chatMode === 'direct' ? directMessages : channelMessages;
    if (!pool || pool.length === 0) {
      toast({ title: 'Asnjë mesazh për të analizuar' });
      return;
    }
    setActionExtractOpen(true);
    setActionExtractLoading(true);
    setProposedActions([]);
    try {
      const recent = pool.slice(-50);
      const transcript = recent.map((m: any) => {
        const name = getUserDisplayName(m.senderId) || 'Përdorues';
        const plain = String(m.content || '').replace(/<[^>]+>/g, '').replace(/[*_`~]/g, '');
        return `${name}: ${plain}`;
      }).join('\n');
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `Lexo këtë bisedë dhe nxirr VETËM detyrat konkrete që dikush duhet të kryejë (action items). Ktheji si JSON array, pa shpjegim, formati:\n[{"title":"...","priority":"low|medium|high","assignee":"emri ose null"}]\nNëse nuk ka detyra, kthe [].\n\nBiseda:\n${transcript}`,
          }],
          context: { userRole: 'staff' },
          teamId: getGlobalTeamId(),
        }),
      });
      if (!res.ok) throw await aiResponseError(res);
      const data = await res.json();
      const raw = String(data.reply || '').trim();
      let parsed: any[] = [];
      try {
        const match = raw.match(/\[[\s\S]*\]/);
        parsed = JSON.parse(match ? match[0] : raw);
      } catch { parsed = []; }
      const cleaned = (Array.isArray(parsed) ? parsed : [])
        .filter((p: any) => p && typeof p.title === 'string' && p.title.trim())
        .slice(0, 15)
        .map((p: any) => ({
          title: String(p.title).trim().slice(0, 200),
          priority: (['low', 'medium', 'high'].includes(p.priority) ? p.priority : 'medium') as 'low' | 'medium' | 'high',
          assignee: typeof p.assignee === 'string' && p.assignee !== 'null' ? p.assignee : undefined,
          selected: true,
        }));
      setProposedActions(cleaned);
      if (cleaned.length === 0) toast({ title: 'Nuk u gjetën detyra konkrete' });
    } catch (err: any) {
      console.error('[ChatView] action extract failed', err);
      toast({ title: 'Gabim', description: err.message || 'Nxjerrja dështoi', variant: 'destructive' });
    } finally {
      setActionExtractLoading(false);
    }
  }, [actionExtractLoading, chatMode, directMessages, channelMessages, toast, getUserDisplayName]);

  const handleCreateProposedActions = useCallback(async () => {
    if (!user?.uid) return;
    const selected = proposedActions.filter(a => a.selected && a.title.trim());
    if (selected.length === 0) {
      toast({ title: 'Asnjë detyrë e zgjedhur' });
      return;
    }
    let created = 0;
    for (const a of selected) {
      // Try to match assignee name to teamMember.userId
      let assigneeUid: string | undefined;
      if (a.assignee) {
        const needle = a.assignee.toLowerCase();
        const match = teamMembers?.find((m: any) =>
          (m.displayName || '').toLowerCase().includes(needle) ||
          (m.email || '').toLowerCase().includes(needle)
        );
        assigneeUid = (match as any)?.userId;
      }
      try {
        const createdTask = await taskMutation.create({
          title: a.title.trim(),
          description: `Krijuar automatikisht nga AI bazuar në bisedë.`,
          status: 'Todo',
          priority: a.priority,
          assignedToUserId: assigneeUid || user.uid,
          createdByUserId: user.uid,
        } as any);
        // Chat was the only assignment surface that didn't notify the assignee.
        if (assigneeUid && assigneeUid !== user.uid) {
          notificationMutation.create({
            userId: assigneeUid,
            type: 'task_assigned',
            title: 'Detyrë e Re e Caktuar',
            message: `Ju u caktuat te detyra: ${a.title.trim()}`,
            isRead: false,
            actionUrl: `/app/tasks?taskId=${(createdTask as any)?.id || ''}`,
            actionLabel: 'Shiko Detyrën',
          } as any).catch(err => console.error('[Notifications] task_assigned dërgim dështoi:', err));
        }
        created++;
      } catch (err) {
        console.error('[ChatView] create proposed task failed', err);
      }
    }
    toast({ title: `${created} detyra u krijuan` });
    setActionExtractOpen(false);
    setProposedActions([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposedActions, user?.uid, teamMembers, taskMutation, toast]);

  // ── #5 Snooze / Remind me ──
  const reminderMutation = useMutation<any>('chatReminders');
  // Only PENDING reminders: fired rows are marked sent and used to stay in the
  // listener forever (a list that only ever grew).
  const { data: reminders } = useCollection<any>('chatReminders', {
    skipTeamFilter: true,
    where: user?.uid ? [
      { field: 'userId', operator: '==' as const, value: user.uid },
      { field: 'sent', operator: '==' as const, value: false },
    ] : undefined,
  });
  const [reminderPickerFor, setReminderPickerFor] = useState<string | null>(null);
  const firedRemindersRef = useRef<Set<string>>(new Set());

  const scheduleReminder = useCallback(async (msg: ChatMessage, minutes: number) => {
    if (!user) return;
    const remindAt = new Date(Date.now() + minutes * 60 * 1000);
    const plain = (msg.content || '').replace(/<[^>]+>/g, '').trim().slice(0, 200);
    try {
      await reminderMutation.create({
        userId: user.uid,
        messageId: msg.id,
        channelId: msg.channelId || null,
        senderId: msg.senderId,
        senderName: getUserDisplayName(msg.senderId) || 'Përdorues',
        content: plain,
        remindAt: remindAt.toISOString(),
        sent: false,
      });
      setReminderPickerFor(null);
      const label = minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${Math.round(minutes / 60)} orë` : 'nesër';
      toast({ title: 'Kujtues u vendos', description: `Do të kujtohesh pas ${label}` });
    } catch (err: any) {
      console.error('[ChatView] reminder create failed', err);
      toast({ title: 'Gabim', description: 'Kujtuesi nuk u ruajt', variant: 'destructive' });
    }
  }, [user, reminderMutation, toast, getUserDisplayName]);

  // Poll reminders every 30s; fire toast and mark sent.
  useEffect(() => {
    if (!user || !reminders) return;
    const check = () => {
      const now = Date.now();
      (reminders || []).forEach((r: any) => {
        if (!r || r.sent || firedRemindersRef.current.has(r.id)) return;
        const t = r.remindAt ? new Date(r.remindAt).getTime() : 0;
        if (t && t <= now) {
          firedRemindersRef.current.add(r.id);
          toast({
            title: `🔔 Kujtues: ${r.senderName || 'Mesazh'}`,
            description: r.content || '(pa tekst)',
            duration: 10000,
          });
          reminderMutation.update(r.id, { sent: true }).catch(() => {});
        }
      });
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [user, reminders, reminderMutation, toast]);

  // ── #4 Scheduled messages ──
  const scheduledMutation = useMutation<any>('chatScheduledMessages');
  const { data: scheduledMessages } = useCollection<any>('chatScheduledMessages', {
    skipTeamFilter: true,
    where: user?.uid ? [{ field: 'senderId', operator: '==' as const, value: user.uid }] : undefined,
  });
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const firedScheduledRef = useRef<Set<string>>(new Set());

  const pendingScheduledForCurrent = useMemo(() => {
    if (!scheduledMessages) return [];
    return scheduledMessages.filter((s: any) => !s.sent && (
      (chatMode === 'channel' && s.channelId === activeChannel) ||
      (chatMode === 'direct' && s.directUserId === activeDirectUserId)
    ));
  }, [scheduledMessages, chatMode, activeChannel, activeDirectUserId]);

  const handleScheduleMessage = useCallback(async (whenMs: number) => {
    if (!user) return;
    const content = messageText.trim();
    if (!content && !attachmentUrl.trim()) {
      toast({ title: 'Mesazh bosh', variant: 'destructive' });
      return;
    }
    try {
      await scheduledMutation.create({
        senderId: user.uid,
        channelId: chatMode === 'channel' ? activeChannel : null,
        directUserId: chatMode === 'direct' ? activeDirectUserId : null,
        content,
        attachmentUrl: attachmentUrl || null,
        scheduledAt: new Date(whenMs).toISOString(),
        sent: false,
      });
      setMessageText('');
      setAttachmentUrl('');
      setScheduleOpen(false);
      setScheduleDate('');
      setScheduleTime('');
      const mins = Math.round((whenMs - Date.now()) / 60000);
      const label = mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.round(mins / 60)} orë` : `${Math.round(mins / 1440)} ditë`;
      toast({ title: 'Mesazhi u programua', description: `Do të dërgohet pas ${label}` });
    } catch (err: any) {
      console.error('[ChatView] schedule failed', err);
      toast({ title: 'Gabim', description: err.message || 'Programimi dështoi', variant: 'destructive' });
    }
  }, [user, messageText, attachmentUrl, scheduledMutation, chatMode, activeChannel, activeDirectUserId, toast]);

  const handleCancelScheduled = useCallback(async (id: string) => {
    try {
      await scheduledMutation.remove(id);
      toast({ title: 'Mesazhi u anulua' });
    } catch (err) {
      console.error('[ChatView] cancel scheduled failed', err);
    }
  }, [scheduledMutation, toast]);

  // #45 Set or clear my custom status
  const handleSetMyStatus = useCallback(async (emoji: string | null, text: string | null, hours: number) => {
    if (!user || !userProfiles) return;
    const myProfile = userProfiles.find(p => p.userId === user.uid);
    if (!myProfile) {
      toast({ title: 'Profili mungon', variant: 'destructive' });
      return;
    }
    const patch: any = {
      customStatus: text || null,
      customStatusEmoji: emoji || null,
      customStatusExpiresAt: hours > 0 ? new Date(Date.now() + hours * 3600 * 1000) : null,
    };
    try {
      await userProfileMutation.update(myProfile.id, patch);
      setStatusDialogOpen(false);
      toast({ title: emoji ? `${emoji} Statusi u përditësua` : 'Statusi u pastrua' });
    } catch (err: any) {
      toast({ title: 'Gabim', description: err.message, variant: 'destructive' });
    }
  }, [user, userProfiles, userProfileMutation, toast]);

  // Poll scheduled messages every 30s; send and remove when due.
  useEffect(() => {
    if (!user || !scheduledMessages) return;
    const fire = async () => {
      const now = Date.now();
      for (const s of (scheduledMessages || [])) {
        if (!s || s.sent || firedScheduledRef.current.has(s.id)) continue;
        const t = s.scheduledAt ? new Date(s.scheduledAt).getTime() : 0;
        if (!t || t > now) continue;
        firedScheduledRef.current.add(s.id);
        try {
          // Claim first: a second tab/device polling the same row sees `sent: true`
          // and skips it. The old order (create, then remove) let both send.
          await scheduledMutation.update(s.id, { sent: true, sentAt: new Date() });
          const isClientTarget = typeof s.channelId === 'string' && s.channelId.startsWith('client-');
          const base: any = {
            content: s.content || '📎 Bashkëngjitje',
            senderId: user.uid,
            // Staff→client rows are read by the CLIENT via `readAt`; `isRead` is the
            // staff-side flag and would otherwise sit in the unread window forever.
            isRead: isClientTarget,
            ...(isClientTarget ? { senderType: 'staff' as const } : {}),
          };
          if (s.attachmentUrl) base.attachmentUrl = s.attachmentUrl;
          if (s.channelId) {
            await messageMutation.create({ ...base, channelId: s.channelId });
          } else if (s.directUserId) {
            await messageMutation.create({ ...base, receiverId: s.directUserId });
          }
          await scheduledMutation.remove(s.id);
          toast({ title: '📨 Mesazhi i programuar u dërgua' });
        } catch (err) {
          console.error('[ChatView] scheduled send failed', err);
          firedScheduledRef.current.delete(s.id);
        }
      }
    };
    fire();
    const id = setInterval(fire, 30000);
    return () => clearInterval(id);
  }, [user, scheduledMessages, messageMutation, scheduledMutation, toast]);

  // ── #3 Message → Task ──
  const [taskFromMsgOpen, setTaskFromMsgOpen] = useState(false);
  const [taskFromMsgSource, setTaskFromMsgSource] = useState<ChatMessage | null>(null);
  const [taskFromMsgTitle, setTaskFromMsgTitle] = useState('');
  const [taskFromMsgAssignee, setTaskFromMsgAssignee] = useState<string>('');
  const [taskFromMsgDueDate, setTaskFromMsgDueDate] = useState<string>('');
  const [taskFromMsgPriority, setTaskFromMsgPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');

  const openTaskFromMessage = useCallback((msg: ChatMessage) => {
    setTaskFromMsgSource(msg);
    const plain = (msg.content || '').replace(/<[^>]+>/g, '').replace(/[*_`~]/g, '').trim();
    setTaskFromMsgTitle(plain.slice(0, 120) || 'Detyrë nga chat');
    setTaskFromMsgAssignee(user?.uid || '');
    setTaskFromMsgDueDate('');
    setTaskFromMsgPriority('medium');
    setTaskFromMsgOpen(true);
  }, [user?.uid]);

  const handleCreateTaskFromMessage = useCallback(async () => {
    if (!user?.uid) return;
    const senderName = taskFromMsgSource ? getUserDisplayName(taskFromMsgSource.senderId) : '';
    const description = taskFromMsgSource
      ? `Nga ${senderName} në chat:\n\n${taskFromMsgSource.content || ''}`
      : '';
    try {
      // endDate, not the legacy dueDate: the deadline cron, calendar, timeline
      // and every date UI key on endDate — a chat task with only dueDate got no
      // due/overdue alert and was invisible on calendar/timeline.
      const due = taskFromMsgDueDate ? new Date(taskFromMsgDueDate) : undefined;
      if (due) due.setHours(17, 0, 0, 0);
      const assignee = taskFromMsgAssignee || user.uid;
      const created = await taskMutation.create({
        title: taskFromMsgTitle.trim() || 'Detyrë nga chat',
        description,
        status: 'Todo',
        priority: taskFromMsgPriority,
        assignedToUserId: assignee,
        ...(due ? { startDate: due, endDate: due } : {}),
        dueNotificationSent: false,
        createdByUserId: user.uid,
      } as any);
      // Every other assignment surface notifies the assignee — chat was the
      // exception, so tasks delegated from a conversation went unseen.
      if (assignee !== user.uid) {
        notificationMutation.create({
          userId: assignee,
          type: 'task_assigned',
          title: 'Detyrë e Re e Caktuar',
          message: `Ju u caktuat te detyra: ${taskFromMsgTitle.trim() || 'Detyrë nga chat'}`,
          isRead: false,
          actionUrl: `/app/tasks?taskId=${(created as any)?.id || ''}`,
          actionLabel: 'Shiko Detyrën',
        } as any).catch(err => console.error('[Notifications] task_assigned dërgim dështoi:', err));
      }
      toast({ title: 'Detyra u krijua', description: 'U shtua në listën e detyrave.' });
      setTaskFromMsgOpen(false);
      setTaskFromMsgSource(null);
    } catch (err) {
      console.error('[ChatView] create task from message failed', err);
      toast({ title: 'Gabim', description: 'Detyra nuk u krijua.', variant: 'destructive' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskFromMsgSource, taskFromMsgTitle, taskFromMsgAssignee, taskFromMsgDueDate, taskFromMsgPriority, user?.uid, taskMutation, toast]);


  // Typing indicators — scoped to the OPEN conversation only. The old unscoped
  // read (skipTeamFilter, no where) streamed every typing doc across ALL tenants
  // (typingIndicators is not business-isolated) and re-fired this component on
  // every keystroke anywhere on the platform.
  const typingMutation = useMutation<any>('typingIndicators');
  const typingConversationKey = chatMode === 'channel'
    ? activeChannel
    : (user?.uid && activeDirectUserId ? `dm-${[user.uid, activeDirectUserId].sort().join('-')}` : '');
  // businessId == bid AND channelId == key, both server-side (two equalities need
  // no composite index). The old shape was channelId-only with skipTeamFilter — an
  // UNSCOPED list the rules cannot prove (`isBusinessMember(resource.data.businessId)`
  // is unconstrained), so it was denied for everyone but a super-admin: the indicator
  // never showed, and because the writer looked up "my existing doc" in that empty
  // list, every second of typing CREATED a new document that nothing ever deleted.
  const typingQuery = useMemo(() => ({
    skip: !typingConversationKey,
    where: [{ field: 'channelId', operator: '==' as const, value: typingConversationKey }],
    teamScopedWhere: true,
  }), [typingConversationKey]);
  const { data: typingIndicators } = useCollection<any>('typingIndicators', typingQuery);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingWriteRef = useRef<number>(0);
  // Always-fresh view of typing docs so the switch/unmount cleanup removes MY
  // current doc (the cleanup closure would otherwise hold a stale snapshot and
  // leak the typing indicator to others).
  const typingIndicatorsRef = useRef(typingIndicators);
  typingIndicatorsRef.current = typingIndicators;

  // Periodic tick so time-based UI (typing freshness, online dots, last-seen)
  // re-evaluates even when no other state changes — otherwise a stale "po
  // shkruan…" or "Aktiv tani" can linger until an unrelated re-render.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick(t => (t + 1) % 1000), 3000);
    return () => clearInterval(id);
  }, []);

  const activeTypingUsers = useMemo(() => {
    if (!typingIndicators || !user) return [];
    const now = Date.now();
    const channelOrDm = chatMode === 'channel' ? activeChannel : `dm-${[user.uid, activeDirectUserId].sort().join('-')}`;
    return typingIndicators.filter((t: any) =>
      t.channelId === channelOrDm && t.userId !== user.uid && t.timestamp &&
      (now - getTimestampMs(t.timestamp)) < 5000
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typingIndicators, user, chatMode, activeChannel, activeDirectUserId, nowTick]);

  // One document per (conversation, user), at a deterministic id — so "stop typing"
  // and the switch/unmount cleanup can delete it WITHOUT having read it first.
  const typingDocId = useCallback((key: string) => `${key}__${user?.uid || ''}`, [user?.uid]);
  const handleTyping = useCallback(() => {
    if (!user) return;
    const channelOrDm = chatMode === 'channel' ? activeChannel : `dm-${[user.uid, activeDirectUserId].sort().join('-')}`;
    if (!channelOrDm) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    // Debounce: only write to Firestore at most once per second
    const now = Date.now();
    if (now - lastTypingWriteRef.current >= 1000) {
      lastTypingWriteRef.current = now;
      // setDoc(merge) = create or refresh; the rules accept the create through the
      // tenant stamp and the update through `userId == me`.
      setDoc(doc(db, 'typingIndicators', typingDocId(channelOrDm)), {
        userId: user.uid, channelId: channelOrDm, timestamp: new Date(),
        businessId: getGlobalBusinessId() || undefined, teamId: getGlobalTeamId() || undefined,
      }, { merge: true }).catch(() => {});
    }
    typingTimeoutRef.current = setTimeout(() => {
      deleteDoc(doc(db, 'typingIndicators', typingDocId(channelOrDm))).catch(() => {});
    }, 3000);
  }, [user, chatMode, activeChannel, activeDirectUserId, typingDocId]);

  // Cleanup typing indicator on channel switch or unmount — by id, plus whatever
  // the (now readable) list still shows as mine.
  useEffect(() => {
    if (!user) return;
    const key = typingConversationKey;
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (key) deleteDoc(doc(db, 'typingIndicators', typingDocId(key))).catch(() => {});
      const list = typingIndicatorsRef.current;
      (list || []).filter((t: any) => t.userId === user.uid).forEach((t: any) => typingMutation.remove(t.id).catch(() => {}));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMode, activeChannel, activeDirectUserId]);

  // Which conversation I am reading right now, published for the SENDER's benefit:
  // a notification stamped with the same key is delivered to the bell but NOT pushed
  // or emailed, so a colleague's message no longer buzzes a phone that is already
  // showing it. The DM key is the PEER's uid, which is what the sender stamps.
  const activeConversationKey = useMemo(() => {
    if (chatMode === 'channel') return activeChannel ? channelConversationKey(activeChannel) : null;
    if (chatMode === 'direct') return activeDirectUserId ? dmConversationKey(activeDirectUserId) : null;
    return null;
  }, [chatMode, activeChannel, activeDirectUserId]);
  useConversationPresence(activeConversationKey);

  // Presence heartbeat — write lastSeen to my userProfile every 60 seconds.
  // Direct updateDoc, NOT userProfileMutation: userProfiles is a static (TTL-cached)
  // collection, and the mutation path invalidates that cache on every write — so the
  // heartbeat forced a full userProfiles re-read across the app once a minute.
  useEffect(() => {
    if (!user || !userProfiles) return;
    const myProfile = userProfiles.find(p => p.userId === user.uid);
    if (!myProfile) return;
    const profileRef = doc(db, 'userProfiles', myProfile.id);
    const beat = () => updateDoc(profileRef, { lastSeen: new Date() }).catch(() => {});
    beat();
    const interval = setInterval(beat, 60000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, userProfiles?.length]);

  // Capture unread message IDs for the "New messages" divider — seeded ONCE per
  // conversation, but only after messages have actually loaded (seeding at switch
  // time caught an empty list, so the divider never appeared).
  useEffect(() => {
    if (!user) return;
    const convKey = chatMode === 'channel' ? `c:${activeChannel}` : `d:${activeDirectUserId}`;
    if (seededConvKeyRef.current === convKey) return; // already seeded this conversation
    if (filteredMessages.length === 0) return;         // wait for the first load
    seededConvKeyRef.current = convKey;
    const unreadIds = filteredMessages
      .filter(m => m.senderId !== user.uid && !m.isRead && !(m as any).deletedAt)
      .map(m => m.id);
    sessionUnreadIdsRef.current = new Set(unreadIds);
    // Jump to the first unread message on open (mirrors the pin/reply jump: scroll
    // + brief highlight). Runs after the conversation-switch scroll-to-bottom so it
    // wins, but only when there ARE unreads — otherwise we leave the bottom view be.
    if (unreadIds.length > 0) {
      const firstId = unreadIds[0];
      setTimeout(() => {
        const el = document.getElementById(`msg-${firstId}`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-primary');
        setTimeout(() => el.classList.remove('ring-2', 'ring-primary'), 1600);
      }, 350);
    }
  }, [chatMode, activeChannel, activeDirectUserId, filteredMessages, user]);

  // IntersectionObserver — show jump-to-bottom when sentinel is out of view
  useEffect(() => {
    const sentinel = bottomSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        atBottomRef.current = entry.isIntersecting;
        setShowJumpToBottom(!entry.isIntersecting);
      },
      { threshold: 1.0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // Re-attach on conversation switch and once the list first has messages
    // (the sentinel only exists while the message pane is rendered).
  }, [chatMode, activeChannel, activeDirectUserId, (filteredMessages?.length || 0) > 0]);

  // Auto-scroll on new messages — but only if the user is already at the bottom
  // or the new message is their own send (don't yank readers up in history).
  useEffect(() => {
    const currentCount = filteredMessages?.length || 0;
    const last = currentCount > 0 ? filteredMessages[currentCount - 1] : undefined;
    const isOwn = !!last && !!user && last.senderId === user.uid;
    if (currentCount > prevMessageCountRef.current && (atBottomRef.current || isOwn)) {
      // rAF to ensure the new messages are in the DOM before scrolling
      requestAnimationFrame(() => {
        const vp = getScroller(scrollRef.current);
        if (vp) vp.scrollTop = vp.scrollHeight;
      });
    }
    prevMessageCountRef.current = currentCount;
  }, [filteredMessages?.length]);

  // Open a conversation when arrived from a notification — either via React Router
  // navigation state (in-app bell click) or via ?channel=/?directUserId= query
  // params (push deep-link, which sets the URL hash rather than router state).
  useEffect(() => {
    const s = location.state as any;
    const params = new URLSearchParams(location.search);
    const channel = (s?.channel && typeof s.channel === 'string') ? s.channel : params.get('channel');
    const directUserId = (s?.directUserId && typeof s.directUserId === 'string') ? s.directUserId : params.get('directUserId');
    if (channel) {
      setChatMode('channel');
      setActiveChannel(channel);
      setShowSidebar(false);
    } else if (directUserId) {
      setChatMode('direct');
      setActiveDirectUserId(directUserId);
      setShowSidebar(false);
    } else {
      return;
    }
    // Clear state + query params so a reload / back-navigation doesn't re-trigger.
    // navigate() is router-aware (works for both HashRouter on native and
    // BrowserRouter on web) — raw history.replaceState would drop the hash route.
    navigate(location.pathname, { replace: true });
  }, [location.state, location.search]);

  // Scroll to bottom whenever the active conversation changes
  useEffect(() => {
    // Reset the count baseline so the next conversation's first load is treated
    // as a fresh scroll-to-bottom, not a spurious "new message" from the prior one.
    prevMessageCountRef.current = 0;
    atBottomRef.current = true;
    // Fresh conversation → show the most-recent window again.
    setRenderCap(RENDER_STEP);
    requestAnimationFrame(() => {
      const vp = getScroller(scrollRef.current);
      if (vp) vp.scrollTop = vp.scrollHeight;
    });
  }, [activeChannel, activeDirectUserId, chatMode]);

  // AI auto-scroll
  useEffect(() => {
    const vp = getScroller(aiScrollRef.current);
    if (vp) vp.scrollTop = vp.scrollHeight;
  }, [aiMessages]);

  // Reset incoming message tracking and pagination when conversation changes
  useEffect(() => {
    prevSeenMsgIdsRef.current = new Set();
    isInitialMsgLoadRef.current = true;
    setChannelLimit(100);
  }, [activeChannel, activeDirectUserId, chatMode]);

  // Bird chirp notification on new incoming messages from others (active conversation)
  useEffect(() => {
    if (!user || !filteredMessages) return;
    if (isInitialMsgLoadRef.current) {
      // Seed the set on the first REAL load — no sound. Right after a switch the
      // list is empty while the new query loads; seeding on that emptied the set,
      // so the messages of the thread you just opened (e.g. the DM whose toast you
      // tapped) chirped a second time when they arrived.
      if (isPending && filteredMessages.length === 0) return;
      filteredMessages.forEach(m => prevSeenMsgIdsRef.current.add(m.id));
      isInitialMsgLoadRef.current = false;
      return;
    }
    const newIncoming = filteredMessages.filter(
      m => m.senderId !== user.uid && !prevSeenMsgIdsRef.current.has(m.id)
    );
    // Only chirp for messages that genuinely arrived during this session. Without
    // this, expanding the visible window ("load older", pagination, opening a
    // menu that refreshes the list) reveals old messages that aren't in the seen
    // set yet and would falsely trigger the sound.
    const genuinelyNew = newIncoming.filter(
      m => getTimestampMs(m.createdAt) > mountTimeRef.current.getTime()
    );
    // Respect the user's own settings: the Tingull switch, the DND window and a muted
    // "Mesazhe" category. This view read none of them, so chat was the one surface
    // that rang anyway.
    if (genuinelyNew.length > 0 && canPlaySound(chatMode === 'direct' ? 'direct_message' : 'channel_message')) {
      playBirdChirp();
    }
    filteredMessages.forEach(m => prevSeenMsgIdsRef.current.add(m.id));
  }, [filteredMessages, isPending, user, playBirdChirp, canPlaySound, chatMode]);

  // Helpers
  // (displayNameCache + getUserDisplayName hoisted above near profileMap to fix TDZ.)

  // Aurora: all chat avatars use the navy brand gradient (uniform, no rainbow).
  const getAvatarColor = useCallback((_id: string) => 'bg-brand-gradient', []);

  const formatShortTime = useCallback((date: any) => {
    if (!date) return '';
    const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Dje';
    if (diffDays < 7) return d.toLocaleDateString('sq-AL', { weekday: 'short' });
    return d.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' });
  }, []);

  const dmLastMessageMap = useMemo(() => {
    const map = new Map<string, { content: string; isOwn: boolean; createdAt: any }>();
    const process = (m: ChatMessage, peerId: string) => {
      if ((m as any).channelId || (m as any).deletedAt) return;
      const existing = map.get(peerId);
      if (!existing || getTimestampMs(m.createdAt) > getTimestampMs(existing.createdAt)) {
        map.set(peerId, {
          content: m.attachmentUrl ? '📎 Skedar' : (m.content || ''),
          isOwn: m.senderId === user?.uid,
          createdAt: m.createdAt,
        });
      }
    };
    bgReceivedDMs?.forEach(m => process(m, m.senderId));
    bgSentDMs?.forEach(m => { if (m.receiverId) process(m, m.receiverId); });
    (dmThreads || []).forEach((t: any) => {
      const peer = (Array.isArray(t.participants) ? t.participants : []).find((uid: string) => uid !== user?.uid);
      const lm = t.lastMessage;
      if (!peer || !lm) return;
      const existing = map.get(peer);
      if (!existing || getTimestampMs(lm.createdAt) >= getTimestampMs(existing.createdAt)) {
        map.set(peer, { content: lm.attachment ? '📎 Skedar' : (lm.content || ''), isOwn: lm.senderId === user?.uid, createdAt: lm.createdAt });
      }
    });
    return map;
  }, [bgReceivedDMs, bgSentDMs, dmThreads, user?.uid]);

  // Kept as fallback / future use; the active renderer is renderMessageBody.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _highlightText = useCallback((text: string, query: string) => {
    if (!query.trim()) return <>{text}</>;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase()
            ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-700 text-inherit rounded-sm px-0.5">{part}</mark>
            : part
        )}
      </>
    );
  }, []);
  void _highlightText;

  const getFilename = useCallback((url: string) => {
    try {
      const pathname = new URL(url).pathname;
      return decodeURIComponent(pathname.split('/').pop() || '') || 'Skedar';
    } catch {
      return url.split('/').pop() || 'Skedar';
    }
  }, []);

  const isImageUrl = useCallback((url: string) =>
    /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?.*)?$/i.test(url), []);

  // Only allow https:// attachment links to be rendered as clickable anchors.
  // A message written directly to Firestore could carry a `javascript:` (or
  // other) URI that would execute on click — reject anything non-https here.
  const safeAttachmentHref = useCallback((url?: string | null): string | undefined => {
    // Only http(s) survives — decided by PARSING the value (`lib/safeUrl`): a regex
    // on the raw string misses `java\tscript:`, which the browser reads as
    // `javascript:`. Legacy http:// VPS attachment links still download.
    return safeExternalUrl(url) ?? undefined;
  }, []);

  // Scroll to + briefly highlight a message by id. Used by the reply-quote preview
  // (tap a quoted message → jump to the original) and reusable elsewhere. The original
  // lives in the same channel; if it isn't currently loaded in the DOM, tell the user.
  const jumpToMessage = useCallback((id?: string | null) => {
    if (!id) return;
    const el = document.getElementById(`msg-${id}`);
    if (!el) {
      toast({ description: 'Mesazhi origjinal nuk është ngarkuar. Shfaq mesazhet më të vjetra dhe provo sërish.' });
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-primary');
    setTimeout(() => el.classList.remove('ring-2', 'ring-primary'), 1600);
  }, [toast]);

  // Audio attachment detection — used for voice-notes rendering
  const isAudioUrl = useCallback((url: string) =>
    /\.(webm|ogg|mp3|m4a|wav)(\?.*)?$/i.test(url) || /audio%2F/i.test(url), []);

  // Lower-cased member-name → userId lookup, for @mention matching
  const memberNameIndex = useMemo(() => {
    const idx = new Map<string, string>();
    // Display names ONLY — the email local-part fallback made "@social media"
    // resolve to social@fivo.al and push a mention nobody typed.
    teamMembers?.forEach(m => {
      if (!m.userId) return;
      const name = (m.displayName || '').trim();
      if (name) idx.set(name.toLowerCase(), m.userId);
    });
    userProfiles?.forEach(p => {
      if (p.userId && p.displayName) idx.set(p.displayName.toLowerCase(), p.userId);
    });
    if (user?.uid) {
      const myName = (user.displayName || user.email?.split('@')[0] || '').trim();
      if (myName) idx.set(myName.toLowerCase(), user.uid);
    }
    return idx;
  }, [teamMembers, userProfiles, user?.uid, user?.displayName, user?.email]);

  // Lower-cased customer-name → customerId lookup, for @@Customer mention matching
  const customerNameIndex = useMemo(() => {
    const idx = new Map<string, string>();
    customers?.forEach(c => {
      if (!c.id) return;
      const name = (c.name || c.company || '').trim();
      if (name) idx.set(name.toLowerCase(), c.id);
    });
    return idx;
  }, [customers]);

  // Detect mentions inside text — returns array of mentioned userIds.
  const extractMentions = useCallback((text: string): string[] => {
    if (!text) return [];
    const out = new Set<string>();
    const re = /@([\p{L}][\p{L}0-9_.\- ]{0,40})/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      // Skip "@@Customer" — that's a customer mention, not a user mention.
      if (m.index > 0 && text[m.index - 1] === '@') continue;
      const candidate = m[1].trim().toLowerCase();
      // Try progressively shorter prefixes (longest match)
      let parts = candidate.split(/\s+/);
      while (parts.length > 0) {
        const probe = parts.join(' ');
        const uid = memberNameIndex.get(probe);
        if (uid) { out.add(uid); break; }
        parts.pop();
      }
    }
    return Array.from(out);
  }, [memberNameIndex]);

  // Render message content with: **bold** *italic* `code` URL autolink + @mention highlight + search hits.
  const renderMessageBody = useCallback((text: string, query: string) => {
    if (!text) return null;
    type Tok = { t: 'text' | 'bold' | 'italic' | 'code' | 'url' | 'mention' | 'cmention'; v: string; uid?: string; cid?: string };
    const tokens: Tok[] = [];
    const re = /(\*\*[^*\n]+?\*\*)|(`[^`\n]+?`)|(\*[^*\n]+?\*)|(https?:\/\/[^\s]+)|(@@[\p{L}][\p{L}0-9_.\- ]{0,40})|(@[\p{L}][\p{L}0-9_.\- ]{0,40})/gu;
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > lastIdx) tokens.push({ t: 'text', v: text.slice(lastIdx, m.index) });
      if (m[1]) { tokens.push({ t: 'bold', v: m[1].slice(2, -2) }); lastIdx = m.index + m[0].length; }
      else if (m[2]) { tokens.push({ t: 'code', v: m[2].slice(1, -1) }); lastIdx = m.index + m[0].length; }
      else if (m[3]) { tokens.push({ t: 'italic', v: m[3].slice(1, -1) }); lastIdx = m.index + m[0].length; }
      else if (m[4]) { tokens.push({ t: 'url', v: m[4] }); lastIdx = m.index + m[0].length; }
      else if (m[5]) {
        // @@Customer mention — longest prefix match against customer names
        const inner = m[5].slice(2);
        let bestLen = 0; let bestCid: string | undefined;
        const parts = inner.split(/\s+/);
        for (let i = parts.length; i > 0; i--) {
          const probe = parts.slice(0, i).join(' ').toLowerCase();
          const cid = customerNameIndex.get(probe);
          if (cid) { bestLen = probe.length; bestCid = cid; break; }
        }
        if (bestCid) {
          tokens.push({ t: 'cmention', v: '@@' + inner.slice(0, bestLen), cid: bestCid });
          lastIdx = m.index + 2 + bestLen;
          re.lastIndex = lastIdx;
        } else {
          tokens.push({ t: 'text', v: m[5] });
          lastIdx = m.index + m[0].length;
        }
      }
      else if (m[6]) {
        // Longest-prefix match against member names
        const inner = m[6].slice(1);
        let bestLen = 0; let bestUid: string | undefined;
        const parts = inner.split(/\s+/);
        for (let i = parts.length; i > 0; i--) {
          const probe = parts.slice(0, i).join(' ').toLowerCase();
          const uid = memberNameIndex.get(probe);
          if (uid) { bestLen = probe.length; bestUid = uid; break; }
        }
        if (bestUid) {
          tokens.push({ t: 'mention', v: '@' + inner.slice(0, bestLen), uid: bestUid });
          lastIdx = m.index + 1 + bestLen;
          re.lastIndex = lastIdx;
        } else {
          tokens.push({ t: 'text', v: m[6] });
          lastIdx = m.index + m[0].length;
        }
      }
    }
    if (lastIdx < text.length) tokens.push({ t: 'text', v: text.slice(lastIdx) });

    const q = query.trim().toLowerCase();
    const renderText = (raw: string, key: string | number) => {
      if (!q) return <React.Fragment key={key}>{raw}</React.Fragment>;
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const parts = raw.split(new RegExp(`(${escaped})`, 'gi'));
      return <React.Fragment key={key}>{parts.map((p, i) =>
        p.toLowerCase() === q
          ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-700 text-inherit rounded-sm px-0.5">{p}</mark>
          : <React.Fragment key={i}>{p}</React.Fragment>
      )}</React.Fragment>;
    };

    return tokens.map((tok, i) => {
      if (tok.t === 'bold') return <strong key={i} className="font-semibold">{tok.v}</strong>;
      if (tok.t === 'italic') return <em key={i} className="italic">{tok.v}</em>;
      if (tok.t === 'code') return <code key={i} className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 font-mono text-[0.85em]">{tok.v}</code>;
      if (tok.t === 'url') return <a key={i} href={tok.v} target="_blank" rel="noopener noreferrer" className="underline opacity-90 hover:opacity-100 break-all">{tok.v}</a>;
      if (tok.t === 'mention') {
        const isMe = tok.uid === user?.uid;
        return <span key={i} className={`px-1 rounded font-semibold ${isMe ? 'bg-yellow-300/50 text-yellow-900 dark:bg-yellow-500/30 dark:text-yellow-100' : 'bg-primary/15 text-primary'}`}>{tok.v}</span>;
      }
      if (tok.t === 'cmention') {
        return <RouterLink key={i} to={`/app/customers/${tok.cid}`} className="px-1 rounded font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:underline">{tok.v}</RouterLink>;
      }
      return renderText(tok.v, i);
    });
  }, [memberNameIndex, customerNameIndex, user?.uid]);

  const isOnline = useCallback((userId: string) => {
    const profile = profileMap.get(userId);
    if (!profile) return false;
    const ls = (profile as any).lastSeen;
    if (!ls) return false;
    const d = ls instanceof Date ? ls : ls?.toDate?.();
    return d && (Date.now() - d.getTime()) < 3 * 60 * 1000;
  }, [profileMap]);

  const getLastSeenText = useCallback((userId: string) => {
    if (isOnline(userId)) return 'Aktiv tani';
    const profile = profileMap.get(userId);
    const ls = (profile as any)?.lastSeen;
    if (!ls) return 'Joaktiv';
    const d = ls instanceof Date ? ls : ls?.toDate?.();
    if (!d) return 'Joaktiv';
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 60) return `Parë ${min} ${plural(min, 'minutë', 'minuta')} më parë`;
    const h = Math.floor(min / 60);
    if (h < 24) return `Parë ${h} ${plural(h, 'orë', 'orë')} më parë`;
    const days = Math.floor(h / 24);
    return `Parë ${days} ${plural(days, 'ditë', 'ditë')} më parë`;
  }, [isOnline, profileMap]);

  // Background DM notifications — fires when a DM arrives in any conversation
  useEffect(() => {
    if (!user || !bgReceivedDMs) return;
    if (bgDmInitialRef.current) {
      bgReceivedDMs.forEach(m => prevBgDmIdsRef.current.add(m.id));
      bgDmInitialRef.current = false;
      return;
    }
    const newDMs = bgReceivedDMs.filter(m => {
      if (prevBgDmIdsRef.current.has(m.id)) return false;
      if ((m as any).deletedAt) return false;
      // Ignore messages that existed before this session started
      const createdAt = m.createdAt instanceof Date ? m.createdAt : (m.createdAt as any)?.toDate?.();
      return createdAt && createdAt > mountTimeRef.current;
    });
    if (newDMs.length > 0) {
      // Only notify for DMs not in the currently open conversation
      const notifyDMs = newDMs.filter(
        m => !(chatMode === 'direct' && activeDirectUserId === m.senderId)
      );
      // Same gates as every other surface — DND / mute silence the toast too, and
      // the chirp additionally obeys the Tingull switch.
      if (notifyDMs.length > 0 && canAlert('direct_message')) {
        if (canPlaySound('direct_message')) playBirdChirp();
        notifyDMs.forEach(dm => {
          const senderName = getUserDisplayName(dm.senderId);
          const senderId = dm.senderId;
          toast({
            title: `📩 ${senderName}`,
            description: (dm.content || '').slice(0, 80) || 'Dërgoi një attachment',
            action: (
              <ToastAction
                altText="Hap bisedën"
                onClick={() => handleSelectDirectMessage(senderId)}
              >
                Hap
              </ToastAction>
            ),
          });
        });
      }
    }
    bgReceivedDMs.forEach(m => prevBgDmIdsRef.current.add(m.id));
  }, [bgReceivedDMs, user, chatMode, activeDirectUserId, playBirdChirp, toast, getUserDisplayName, canAlert, canPlaySound]);

  const formatDate = (date: any) => {
    if (!date) return '';
    const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    const full = d.toLocaleDateString('sq-AL', { weekday: 'long', day: 'numeric', month: 'long' });
    const cap = full.charAt(0).toUpperCase() + full.slice(1);
    if (diffDays === 0) return `Sot · ${cap}`;
    if (diffDays === 1) return `Dje · ${cap}`;
    return cap;
  };

  const getDateKey = (date: any) => {
    if (!date) return '';
    const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };

  // Same number the Sidebar / MobileBottomNav show — one model.
  const totalUnread = unread.total;

  // Last own message in current DM — for read receipt display
  const lastOwnMsgId = useMemo(() => {
    if (chatMode !== 'direct') return null;
    const own = filteredMessages.filter(m => m.senderId === user?.uid && !(m as any).deletedAt);
    return own.length > 0 ? own[own.length - 1].id : null;
  }, [filteredMessages, chatMode, user?.uid]);

  // Unread count in currently open conversation (used for jump-to-bottom badge)
  const currentConvUnread = useMemo(() => {
    if (chatMode === 'channel') return channelUnreadMap.get(activeChannel) || 0;
    if (chatMode === 'direct') return directUnreadMap.get(activeDirectUserId || '') || 0;
    return 0;
  }, [chatMode, activeChannel, activeDirectUserId, channelUnreadMap, directUnreadMap]);

  // Message Handlers
  const { upload: uploadAttachment, uploading: attachmentUploading } = useFileUpload();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // SVG removed — script injection vector. Use raster formats only.
  const ALLOWED_IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  // Must stay a subset of the VPS ALLOWED_UPLOAD filter (vps/server.ts).
  const ALLOWED_DOC_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
  ];
  const ALLOWED_ATTACHMENT_TYPES = [...ALLOWED_IMG_TYPES, ...ALLOWED_DOC_TYPES];
  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

  const handleAttachmentUpload = async (file: File) => {
    if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) {
      toast({ title: 'Format i pasaktë', description: 'Lejohen imazhe (PNG, JPG, GIF, WEBP), PDF, Word, Excel, PowerPoint, TXT ose CSV.', variant: 'destructive' });
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast({ title: 'Skedari shumë i madh', description: 'Maksimumi 10 MB.', variant: 'destructive' });
      return;
    }
    // Guard: must have a valid send target before consuming the upload.
    if (chatMode === 'channel' && !activeChannel) {
      toast({ title: 'Zgjidh një kanal', description: 'Hap një kanal për të dërguar skedarin.', variant: 'destructive' });
      return;
    }
    if (chatMode === 'direct' && !activeDirectUserId) {
      toast({ title: 'Zgjidh një bisedë', description: 'Hap një DM për të dërguar skedarin.', variant: 'destructive' });
      return;
    }
    if (chatMode !== 'channel' && chatMode !== 'direct') {
      toast({ title: 'Nuk mund të dërgohet', description: 'Skedarët dërgohen vetëm në kanale ose DM.', variant: 'destructive' });
      return;
    }
    // Snapshot the target now — the user may switch conversations during upload.
    const target = { targetMode: chatMode as 'channel' | 'direct', targetChannel: activeChannel, targetDirectUserId: activeDirectUserId };
    try {
      const res = await uploadAttachment(file, 'chat-attachments');
      await handleSendMessage(null, { attachmentUrl: res.url, ...target });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[chat] image upload failed', err);
      const code = (err as any)?.code as string | undefined;
      const detail = code === 'storage/unauthorized'
        ? 'Nuk keni leje për këtë bucket. Verifikoni rregullat e Storage.'
        : code === 'storage/canceled'
          ? 'Ngarkimi u anulua.'
          : (err as Error)?.message || 'Provo përsëri.';
      toast({ title: 'Ngarkimi dështoi', description: detail, variant: 'destructive' });
    }
  };

  const handleSendMessage = async (e?: React.FormEvent | null, override?: { content?: string; attachmentUrl?: string; targetMode?: 'channel' | 'direct'; targetChannel?: string; targetDirectUserId?: string | null }) => {
    if (e && typeof (e as any).preventDefault === 'function') (e as any).preventDefault();
    // Target conversation — snapshotted by attachment/voice senders before their
    // upload await, so a mid-upload conversation switch doesn't misroute the message.
    const targetMode = override?.targetMode ?? chatMode;
    const targetChannel = override?.targetChannel ?? activeChannel;
    const targetDirectUserId = override?.targetDirectUserId ?? activeDirectUserId;
    const effectiveText = override?.content ?? messageText;
    const effectiveAttachment = (override?.attachmentUrl ?? attachmentUrl).trim();
    if ((!effectiveText.trim() && !effectiveAttachment) || !user || isSending) return;
    // Validate attachment URL — block javascript:/data: URIs, allow only https.
    if (effectiveAttachment) {
      try {
        const parsed = new URL(effectiveAttachment);
        if (parsed.protocol !== 'https:') {
          toast({ title: 'URL e pavlefshme', description: 'Lejohen vetëm lidhje https.', variant: 'destructive' });
          return;
        }
      } catch {
        toast({ title: 'URL e pavlefshme', description: 'Ngjit një URL të plotë https.', variant: 'destructive' });
        return;
      }
    }

    try {
      const isClientChannel = targetChannel.startsWith('client-');
      // Handle /me action command — render as italic third-person action
      let finalText = effectiveText;
      if (finalText.startsWith('/me ')) {
        const action = finalText.slice(4).trim();
        if (action) {
          const who = getUserDisplayName(user.uid) || 'Dikush';
          finalText = `*${who} ${action}*`;
        }
      }
      const mentions = extractMentions(finalText);
      const isStaffToClient = isClientChannel && targetMode === 'channel';
      const baseMessage: Partial<ChatMessage> = {
        content: finalText || '📎 Attachment',
        senderId: user.uid,
        // `isRead` is the STAFF-side flag (DMs, client messages). A staff→client row
        // is read by the client through `readAt` (portal), so it starts read here —
        // otherwise it sat in the tenant's `isRead == false` window until a colleague
        // happened to open the thread, crowding real unread rows out of the cap.
        isRead: isStaffToClient,
        attachmentUrl: effectiveAttachment || undefined,
        ...(mentions.length > 0 ? { mentions } as any : {}),
        ...(isClientChannel && targetMode === 'channel' ? { senderType: 'staff' as const } : {}),
        ...(replyingTo ? {
          replyToId: replyingTo.id,
          replyToContent: (replyingTo.content || '').length > 100 ? (replyingTo.content || '').slice(0, 100) + '…' : (replyingTo.content || ''),
          replyToSender: getUserDisplayName(replyingTo.senderId),
        } : {}),
      };

      if (targetMode === 'channel' && !targetChannel) {
        toast({ title: 'Zgjidh një kanal', description: 'Asnjë kanal aktiv për të dërguar.', variant: 'destructive' });
        return;
      }
      if (targetMode === 'direct' && !targetDirectUserId) {
        toast({ title: 'Zgjidh një bisedë', description: 'Hap një DM për të dërguar.', variant: 'destructive' });
        return;
      }
      if (targetMode !== 'channel' && targetMode !== 'direct') {
        toast({ title: 'Modaliteti nuk lejon dërgim', description: 'Përdor kanal ose DM për mesazhe me imazh.', variant: 'destructive' });
        return;
      }

      if (targetMode === 'channel') {
        // The id is kept: every chat notification carries `messageId` so the reader
        // can dismiss it when the message is later deleted (the sender cannot — the
        // rules let only the recipient write a notification).
        const createdMsg = await messageMutation.create({ ...baseMessage, channelId: targetChannel } as Omit<ChatMessage, 'id'>);
        const messageId = (createdMsg as any)?.id as string | undefined;
        const convKey = channelConversationKey(targetChannel);

        // Denormalize last-activity so the sidebar can sort conversations by
        // recency (WhatsApp-style). Fire-and-forget — never block the send.
        const nowTs = new Date();
        if (isClientChannel) {
          const custId = targetChannel.match(/^client-([A-Za-z0-9]+)/)?.[1];
          if (custId) updateDoc(doc(db, 'customers', custId), { lastClientMessageAt: nowTs }).catch(() => {});
        } else if ((allGroups || []).some(g => g.id === targetChannel && g.isGroup)) {
          // Preview + sender so the list row can show the last message instead of a
          // member count (the rules let any MEMBER write exactly these fields).
          updateDoc(doc(db, 'channels', targetChannel), {
            lastMessageAt: nowTs,
            lastMessagePreview: (effectiveAttachment && !finalText ? '📎 Skedar' : finalText).slice(0, 140),
            lastMessageSenderId: user.uid,
          }).catch(() => {});
        }

        // Notify mentioned staff (mention highlighting existed but no notification was created)
        const audience = channelMemberIds(targetChannel);
        const notifiedMentions = new Set<string>();
        if (mentions.length > 0) {
          mentions
            .filter(uid => uid !== user.uid)
            // A mention must never reach someone outside the conversation: the
            // notification ships 100 characters of the message and a linkTo that the
            // rules would refuse them. The picker is filtered too; this is the guard
            // for a hand-typed name and for a member removed after the draft started.
            .filter(uid => !audience || audience.includes(uid))
            .forEach(uid => {
              notifiedMentions.add(uid);
              notificationMutation.create({
                userId: uid,
                type: 'mention',
                title: `${getUserDisplayName(user.uid)} ju përmendi`,
                message: (finalText || '📎 Attachment').slice(0, 100),
                isRead: false,
                linkTo: targetChannel,
                imageUrl: getUserAvatar(user.uid),
                conversationKey: convKey,
                ...(messageId ? { messageId } : {}),
              } as any).catch(() => { /* non-blocking */ });
            });
        }

        // A message in a team/group channel used to notify NOBODY — no bell row, no
        // push, no email, and the Sidebar badge did not count it either, so the whole
        // conversation was invisible the moment the chat page was closed. Members are
        // the channel's own `members` array, minus the sender and minus anyone the
        // mention pass above already notified (two rows for one message otherwise).
        const isGroupTarget = (allGroups || []).some(g => g.id === targetChannel && (g as any).isGroup);
        if (isGroupTarget && audience) {
          const eligible = audience.filter(uid => uid && uid !== user.uid && !notifiedMentions.has(uid));
          const recipients = eligible.slice(0, MAX_CHANNEL_NOTIFY);
          if (eligible.length > recipients.length) {
            console.warn(`[ChatView] channel_message fan-out capped at ${MAX_CHANNEL_NOTIFY}: ${eligible.length - recipients.length} member(s) of ${targetChannel} were not notified`);
          }
          const channelName = (allGroups || []).find(g => g.id === targetChannel)?.name || 'Kanali';
          if (recipients.length > 0) {
            // ONE server call, not one per member. The usual browser path (a
            // notification document per recipient through the mutation choke point)
            // relays once per document, and that relay is rate limited per CALLER —
            // a chatty group would have burned this user's whole hourly budget and
            // silently dropped their task/invoice notifications with it. The server
            // writes the documents itself (notifyUser) and re-checks membership
            // against the channel document, which is also the stricter check.
            void (async () => {
              try {
                const token = await auth.currentUser?.getIdToken();
                if (!token) return;
                const res = await fetch('/api/send-notification-email', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({
                    channelFanout: {
                      channelId: targetChannel,
                      userIds: recipients,
                      type: 'channel_message',
                      title: `${getUserDisplayName(user.uid)} · ${channelName}`,
                      message: (finalText || '📎 Attachment').slice(0, 100),
                      imageUrl: getUserAvatar(user.uid),
                      conversationKey: convKey,
                      ...(messageId ? { messageId } : {}),
                    },
                  }),
                });
                if (!res.ok) console.warn(`[ChatView] channel_message fan-out failed (${res.status}) — members were not notified`);
              } catch (err) {
                console.warn('[ChatView] channel_message fan-out unreachable — members were not notified', err);
              }
            })();
          }
        }

        if (isClientChannel) {
          const match = targetChannel.match(/^client-(.+?)(?:-project-(.+))?$/);
          if (match) {
            const custId = match[1];
            const projId = match[2];
            const pa = portalAccess?.find(a => a.customerId === custId);
            // A client with NO portal record used to get nothing at all — no bell,
            // no email — while staff saw a normal sent bubble. The email endpoint
            // resolves the address itself (customer.email, then the portal login).
            if (!pa) {
              try {
                const token = await auth.currentUser?.getIdToken();
                if (token) {
                  fetch('/api/send-invoice-email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({
                      type: 'notify-client',
                      channelId: targetChannel,
                      senderName: getUserDisplayName(user.uid) || 'Ekipi',
                      messagePreview: (effectiveText || '📎 Bashkëngjitje').slice(0, 200),
                    }),
                  }).catch(() => {});
                }
              } catch { /* skip */ }
            }
            if (pa) {
              const customer = customers?.find(c => c.id === custId);
              const projectName = projId ? projects?.find(p => p.id === projId)?.name : null;
              const title = projectName
                ? `Mesazh i ri nga stafi - ${projectName}`
                : `Mesazh i ri nga stafi - ${customer?.name || 'Biseda'}`;
              // actionUrl points at the PORTAL chat — the recipient is a client and
              // has no access to /app/chat, so the choke point must not derive an
              // /app/chat deep-link from linkTo. linkTo is kept for in-app routing.
              // Only notify when the portal record actually carries a Firebase uid.
              // The old fallback (`|| custId`) wrote a notification addressed to a
              // CUSTOMER id, which is not an auth uid: nobody could ever read it, and
              // the server could not resolve an email for it either. The email below
              // still goes out, so a client without a portal login is not left out.
              const portalUid = (pa as any).userId;
              if (portalUid) {
                // actionUrl carries the PROJECT: the choke point prefers actionUrl over
                // linkTo, so a bare '/portal/chat' landed every push about a project
                // thread on the client's default conversation. PortalChatView reads
                // ?project= on arrival and selects that channel.
                const portalUrl = projId ? `/portal/chat?project=${encodeURIComponent(projId)}` : '/portal/chat';
                try {
                  await notificationMutation.create({
                    userId: portalUid,
                    type: 'staff_message',
                    title,
                    message: (finalText || '📎 Attachment').slice(0, 100),
                    isRead: false,
                    linkTo: targetChannel,
                    actionUrl: portalUrl,
                    conversationKey: convKey,
                    ...(messageId ? { messageId } : {}),
                  } as any);
                } catch { /* skip */ }
              }
              // Direct email FALLBACK for a client with no portal login only: the
              // notification above already emails the portal user via the choke
              // point (respecting emailEnabled/DND/mutes), so sending this one too
              // double-emailed every message — and this path bypasses those gates.
              if (!portalUid && (pa as any).email) {
                try {
                  const token = await auth.currentUser?.getIdToken();
                  if (token) {
                    fetch('/api/send-invoice-email', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({
                        type: 'notify-client',
                        recipientEmail: (pa as any).email,
                        recipientName: customer?.name,
                        channelId: targetChannel,
                        senderName: 'Ekipi',
                        messagePreview: (effectiveText || '📎 Bashkëngjitje').slice(0, 200),
                      }),
                    }).catch(() => {});
                  }
                } catch { /* skip */ }
              }
            }
          }
        }
      } else if (targetDirectUserId) {
        const createdDm = await messageMutation.create({ ...baseMessage, receiverId: targetDirectUserId } as Omit<ChatMessage, 'id'>);
        const dmMessageId = (createdDm as any)?.id as string | undefined;
        // Thread head for the list preview / recency (see dmThreadsQuery). Never blocks the send.
        setDoc(doc(db, 'dmThreads', dmThreadId(user.uid, targetDirectUserId)), {
          participants: [user.uid, targetDirectUserId].sort(),
          businessId: getGlobalBusinessId() || null,
          lastMessage: { content: (finalText || '').slice(0, 140), senderId: user.uid, createdAt: new Date(), attachment: !!effectiveAttachment },
          updatedAt: new Date(),
        }, { merge: true }).catch(() => {});
        // Notify the recipient (push + email, arrives even when the app is closed).
        // DMs previously created no notification, so recipients missed messages while
        // away. Title = sender's name, imageUrl = their avatar (WhatsApp/Airbnb style).
        // actionUrl deep-links back to this DM thread on tap.
        notificationMutation.create({
          userId: targetDirectUserId,
          type: 'direct_message',
          title: getUserDisplayName(user.uid),
          message: (finalText || '📎 Attachment').slice(0, 100),
          isRead: false,
          actionUrl: `/app/chat?directUserId=${user.uid}`,
          imageUrl: getUserAvatar(user.uid),
          // From the RECIPIENT's side this thread is keyed on me, the sender — that
          // is the key their ChatView publishes while reading it, and the server
          // uses the match to skip push+email (never the bell row).
          conversationKey: dmConversationKey(user.uid),
          ...(dmMessageId ? { messageId: dmMessageId } : {}),
        } as any).catch(() => { /* non-blocking */ });
      }

      setMessageText('');
      setAttachmentUrl('');
      setShowAttachmentInput(false);
      setReplyingTo(null);
      // Reset textarea height
      if (chatTextareaRef.current) chatTextareaRef.current.style.height = 'auto';
      const channelOrDm = chatMode === 'channel' ? activeChannel : `dm-${[user.uid, activeDirectUserId].sort().join('-')}`;
      const ex = typingIndicators?.find((t: any) => t.userId === user.uid && t.channelId === channelOrDm);
      if (ex) typingMutation.remove(ex.id).catch(() => {});
    } catch (err) {
      toast({ title: 'Dërgimi dështoi', description: err instanceof Error ? err.message : 'Gabim', variant: 'destructive' });
    }
  };

  const handleEditMessage = async (msgId: string) => {
    if (!editText.trim()) return;
    if (editSavingRef.current) return; // guard against rapid double-submit (Enter held)
    editSavingRef.current = true;
    try {
      const current = messages?.find(m => m.id === msgId);
      const prevHistory: any[] = ((current as any)?.editHistory as any[]) || [];
      const prevContent = current?.content;
      const nextHistory = prevContent
        ? [...prevHistory, { content: prevContent, editedAt: new Date() }].slice(-20) // keep last 20 versions
        : prevHistory;
      await messageMutation.update(msgId, { content: editText, editedAt: new Date(), editHistory: nextHistory } as any);
      setEditingMessageId(null);
      setEditText('');
    } catch { toast({ title: 'Gabim', variant: 'destructive' }); }
    finally { editSavingRef.current = false; }
  };

  const handleDeleteMessage = async (msgId: string) => {
    try {
      // `isRead: true` so a deleted row leaves every unread window (a badge with
      // nothing behind it otherwise); `editHistory: []` so earlier versions of a
      // message the sender withdrew are not still readable by the whole tenant.
      await messageMutation.update(msgId, { deletedAt: new Date(), content: 'Ky mesazh u fshi.', attachmentUrl: null, reactions: {}, isPinned: false, isRead: true, editHistory: [] } as any);
    } catch {
      toast({ title: 'Fshirja dështoi', description: 'Provo përsëri.', variant: 'destructive' });
    }
  };

  const handleReaction = async (msgId: string, emoji: string) => {
    if (!user || !EMOJI_REACTIONS.includes(emoji)) return;
    const msg = messages?.find(m => m.id === msgId);
    const already = !!msg && Array.isArray((msg as any).reactions?.[emoji]) && (msg as any).reactions[emoji].includes(user.uid);
    setShowEmojiPicker(null);
    try {
      // Atomic per-emoji array update so two users reacting at once don't clobber
      // each other (the old read-modify-write of the whole `reactions` object did).
      await updateDoc(doc(db, 'messages', msgId), {
        [`reactions.${emoji}`]: already ? arrayRemove(user.uid) : arrayUnion(user.uid),
      } as any);
    } catch {
      toast({ title: 'Reaksioni dështoi', description: 'Provo përsëri.', variant: 'destructive' });
    }
  };

  // Pin / Unpin (per-channel/DM)
  const handleTogglePin = async (msg: ChatMessage) => {
    try {
      await messageMutation.update(msg.id, { isPinned: !(msg as any).isPinned } as any);
    } catch {
      toast({ title: 'Veprimi dështoi', description: 'Provo përsëri.', variant: 'destructive' });
    }
  };

  // #43 Keyboard reaction shortcuts: digits 1..5 react on currently hovered message.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
      const n = parseInt(e.key, 10);
      if (!Number.isFinite(n) || n < 1 || n > 5) return;
      const msgId = hoveredMessageIdRef.current;
      if (!msgId) return;
      const emoji = EMOJI_REACTIONS[n - 1];
      if (!emoji) return;
      e.preventDefault();
      handleReaction(msgId, emoji);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Voice notes — record, upload, send as audio attachment
  const startRecording = async () => {
    if (isRecording) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      toast({ title: 'Mikrofoni i pasupërtuar', description: 'Shfletuesi nuk lejon regjistrimin.', variant: 'destructive' });
      return;
    }
    // Snapshot the target at record start — the conversation may change before stop.
    const target = { targetMode: chatMode as 'channel' | 'direct', targetChannel: activeChannel, targetDirectUserId: activeDirectUserId };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm') ? { mimeType: 'audio/webm' } : undefined);
      recordingChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) recordingChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        try { stream.getTracks().forEach(t => t.stop()); } catch { /* */ }
        const blob = new Blob(recordingChunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (recordingTimerRef.current) { window.clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
        setRecordingDuration(0);
        setIsRecording(false);
        if (blob.size < 500) return; // ignore tiny accidental presses
        // iOS/Safari records audio/mp4, not webm — name the file after what was
        // actually recorded, or the file host serves it with the wrong
        // Content-Type and playback fails.
        const ext = /mp4|aac/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm';
        const fileName = `voice-${Date.now()}.${ext}`;
        const file = new File([blob], fileName, { type: blob.type });
        try {
          const res = await uploadAttachment(file, 'voice-notes');
          await handleSendMessage(null, { content: '🎙️ Voice note', attachmentUrl: res.url, ...target });
        } catch (err) {
          toast({ title: 'Ngarkimi dështoi', description: err instanceof Error ? err.message : 'Provo përsëri.', variant: 'destructive' });
        }
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setIsRecording(true);
      setRecordingDuration(0);
      const MAX_RECORDING_SECONDS = 300; // auto-stop at 5 min (keeps blob under upload limit)
      recordingTimerRef.current = window.setInterval(() => setRecordingDuration(d => {
        const next = d + 1;
        if (next >= MAX_RECORDING_SECONDS) stopRecording(true);
        return next;
      }), 1000);
    } catch (err) {
      toast({ title: 'Mikrofoni u refuzua', description: err instanceof Error ? err.message : 'Lejet u refuzuan.', variant: 'destructive' });
    }
  };

  const stopRecording = (sendIt: boolean) => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    if (!sendIt) recordingChunksRef.current = []; // cancel: clear data so onstop sees empty blob
    try { rec.stop(); } catch { /* */ }
  };

  // Release the mic and timer if the chat unmounts mid-recording (otherwise the
  // stream stays live and the "recording" indicator never turns off).
  useEffect(() => () => {
    if (recordingTimerRef.current) { window.clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      recordingChunksRef.current = []; // discard — don't upload a partial note on unmount
      try { rec.stop(); } catch { /* */ }
    }
  }, []);

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
          teamId: getGlobalTeamId(),
        }),
      });

      if (!res.ok) throw await aiResponseError(res);

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

  // Await the write and toast the real outcome — writeText() rejects without a
  // fresh user gesture and on several Android WebView builds, and this used to
  // claim success regardless.
  const copyToClipboard = (text: string) => {
    void copyWithToast(text, toast, 'Kopjuar!');
  };

  const resetAiChat = () => {
    setAiMessages([]);
    setShowAiActions(true);
  };

  // Navigation
  // Reset all search state — sender/date filters must clear too, or the new
  // conversation renders empty (filtered by a sender that doesn't exist there).
  const resetSearch = () => {
    setShowSearch(false);
    setSearchQuery('');
    setSearchSenderId('__any__');
    setSearchDateFrom('');
    setSearchDateTo('');
    setShowSearchFilters(false);
  };

  const handleSelectChannel = useCallback((channelId: string) => {
    setChatMode('channel');
    setActiveChannel(channelId);
    setActiveDirectUserId(null);
    setShowSidebar(false);
    resetSearch();
    setReplyingTo(null);
  }, []);

  // If the active group no longer includes me (removed by an admin), leave the view.
  useEffect(() => {
    if (chatMode !== 'channel' || !allGroups || !user?.uid) return;
    const g = allGroups.find(x => x.id === activeChannel && x.isGroup);
    if (g && !(g.members || []).includes(user.uid)) {
      handleSelectChannel('');
    }
  }, [allGroups, activeChannel, chatMode, user?.uid, handleSelectChannel]);

  // ── Group management ──
  const manageGroup = useMemo(
    () => (manageGroupId ? (allGroups || []).find(g => g.id === manageGroupId) || null : null),
    [manageGroupId, allGroups],
  );
  const isGroupAdmin = useCallback(
    (g: Channel | null) => !!(g && user?.uid && Array.isArray(g.admins) && g.admins.includes(user.uid)),
    [user?.uid],
  );

  const handleCreateGroup = useCallback(async () => {
    const name = newGroupName.trim();
    if (!name || !user || creatingGroup) return;
    setCreatingGroup(true);
    try {
      // Creator is always a member and an admin.
      const members = Array.from(new Set([user.uid, ...newGroupMembers]));
      const created = await channelMutation.create({
        name,
        description: newGroupDesc.trim() || undefined,
        isGroup: true,
        isPrivate: true,
        members,
        admins: [user.uid],
      } as any);
      setShowCreateGroup(false);
      setNewGroupName('');
      setNewGroupDesc('');
      setNewGroupMembers([]);
      if (created?.id) handleSelectChannel(created.id);
      toast({ title: 'Grupi u krijua', description: `"${name}" u krijua me ${members.length} anëtarë.` });
    } catch {
      toast({ title: 'Gabim', description: 'Krijimi i grupit dështoi.', variant: 'destructive' });
    } finally {
      setCreatingGroup(false);
    }
  }, [newGroupName, newGroupDesc, newGroupMembers, user, creatingGroup, channelMutation, handleSelectChannel, toast]);

  const handleAddGroupMember = useCallback(async (g: Channel, userId: string) => {
    const members = Array.from(new Set([...(g.members || []), userId]));
    await channelMutation.update(g.id, { members } as any);
  }, [channelMutation]);

  const handleRemoveGroupMember = useCallback(async (g: Channel, userId: string) => {
    const members = (g.members || []).filter(m => m !== userId);
    const admins = (g.admins || []).filter(a => a !== userId);
    await channelMutation.update(g.id, { members, admins } as any);
  }, [channelMutation]);

  const handleToggleGroupAdmin = useCallback(async (g: Channel, userId: string) => {
    const isAdmin = (g.admins || []).includes(userId);
    const admins = isAdmin
      ? (g.admins || []).filter(a => a !== userId)
      : Array.from(new Set([...(g.admins || []), userId]));
    if (admins.length === 0) {
      toast({ title: 'Veprim i ndaluar', description: 'Grupi duhet të ketë të paktën një admin.', variant: 'destructive' });
      return;
    }
    await channelMutation.update(g.id, { admins } as any);
  }, [channelMutation, toast]);

  const handleLeaveGroup = useCallback(async (g: Channel) => {
    if (!user) return;
    const remainingMembers = (g.members || []).filter(m => m !== user.uid);
    let admins = (g.admins || []).filter(a => a !== user.uid);
    // If the last admin leaves, promote the first remaining member so the group isn't orphaned.
    if (admins.length === 0 && remainingMembers.length > 0) admins = [remainingMembers[0]];
    await channelMutation.update(g.id, { members: remainingMembers, admins } as any);
    setManageGroupId(null);
    if (activeChannel === g.id) handleSelectChannel('');
    toast({ title: 'Dole nga grupi', description: `Nuk je më anëtar i "${g.name}".` });
  }, [user, channelMutation, activeChannel, handleSelectChannel, toast]);

  const handleDeleteGroup = useCallback(async (g: Channel) => {
    await channelMutation.remove(g.id);
    setManageGroupId(null);
    if (activeChannel === g.id) handleSelectChannel('');
    toast({ title: 'Grupi u fshi', description: `"${g.name}" u fshi përfundimisht.` });
  }, [channelMutation, activeChannel, handleSelectChannel, toast]);

  const handleSelectDirectMessage = useCallback((userId: string) => {
    setChatMode('direct');
    setActiveDirectUserId(userId);
    setShowSidebar(false);
    resetSearch();
    setReplyingTo(null);
    setDmSearch('');
  }, []);

  const handleSelectAi = useCallback(() => {
    setChatMode('ai');
    setShowSidebar(false);
    setShowSearch(false);
    setSearchQuery('');
    setReplyingTo(null);
  }, []);

  // Mark as Read
  useEffect(() => {
    // Clear read tracking when switching conversations
    markedAsReadRef.current.clear();
  }, [activeDirectUserId, activeChannel, chatMode]);

  // A rejected read-mark used to be invisible: the optimistic snapshot hid the
  // badge while the thread was open, the server rolled it back, the effect retried
  // on every snapshot and only console.error knew. Now a failure is (a) surfaced
  // once, (b) retried per document so one bad row cannot veto the rest, and (c)
  // NOT retried in a loop — the ids stay in markedAsReadRef until the next switch.
  const readMarkToastShownRef = useRef(false);
  const commitReadMarks = useCallback((patches: { id: string; patch: Record<string, unknown> }[], label: string) => {
    const CHUNK = 400;
    for (let i = 0; i < patches.length; i += CHUNK) {
      const chunk = patches.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      chunk.forEach(({ id, patch }) => batch.update(doc(db, 'messages', id), patch));
      batch.commit().catch(async (err) => {
        console.error(`[ChatView] markAsRead ${label} batch failed`, err);
        const failures: unknown[] = [];
        await Promise.all(chunk.map(({ id, patch }) =>
          updateDoc(doc(db, 'messages', id), patch).catch(e => { failures.push(e); })));
        if (failures.length > 0 && !readMarkToastShownRef.current) {
          readMarkToastShownRef.current = true;
          const code = (failures[0] as any)?.code || (err as any)?.code || 'unknown';
          toast({
            title: 'Mesazhet nuk u shënuan si të lexuara',
            description: `Numri i palexuar do të mbetet. Gabimi: ${code}. Rifresko faqen; nëse vazhdon, njofto administratorin.`,
            variant: 'destructive',
          });
        }
      });
    }
  }, [toast]);

  useEffect(() => {
    if (!activeDirectUserId || !user || chatMode !== 'direct') return;
    const snapshotDmUserId = activeDirectUserId;
    // Union of every DM source we hold: the unread listener (what the badge
    // counts), the recency window (bgReceivedDMs) and the open thread itself —
    // so a message that is rendered, or counted, is always also marked. The old
    // pass read ONLY bgReceivedDMs (100 newest received rows of any state), so a
    // counted-elsewhere or thread-only row could stay unread forever.
    const source = unionById<ChatMessage>(unread.unreadDms, bgReceivedDMs, directMessages);
    const toMark = source.filter(m =>
      isDmForMe(m, user.uid) && m.senderId === snapshotDmUserId && !m.isRead && !markedAsReadRef.current.has(m.id));
    if (toMark.length === 0) return;
    const ids = toMark.map(m => m.id);
    ids.forEach(id => markedAsReadRef.current.add(id));
    commitReadMarks(ids.map(id => ({ id, patch: { isRead: true } })), 'DM');
  }, [activeDirectUserId, bgReceivedDMs, directMessages, unread.unreadDms, user, chatMode, commitReadMarks]);

  useEffect(() => {
    if (chatMode !== 'channel' || !user || !activeChannel) return;
    // Snapshot the active channel — guard against rapid switches (mirror of the DM path)
    const snapshotChannel = activeChannel;
    // Union the open conversation's messages with the ALWAYS-ON background unread
    // queries (client/team), filtered to this channel — so opening a conversation
    // clears its badge immediately, even before its own messages have loaded (a
    // quick open+leave otherwise left it unread).
    const bg = (isClientChannel ? (allUnreadClientMsgs || []) : (allUnreadTeamMsgs || []))
      .filter(m => (m as any).channelId === activeChannel);
    const rows = unionById<ChatMessage>(channelMessages, bg);
    const groupMembers = isGroupChannel ? (allGroups || []).find(g => g.id === snapshotChannel)?.members : undefined;
    const patches: { id: string; patch: Record<string, unknown> }[] = [];
    rows.forEach(m => {
      if (m.senderId === user.uid || markedAsReadRef.current.has(m.id)) return;
      if (isGroupChannel) {
        // Per-member read (readBy). `isRead` is flipped ONLY once every other member
        // has read — it is what lets the row leave the shared `isRead == false`
        // window. It used to flip on the FIRST reader, so members B and C never saw
        // a badge for a message A had opened.
        if (((m as any).readBy || []).includes(user.uid)) return;
        const patch: Record<string, unknown> = { readBy: arrayUnion(user.uid) };
        if (groupFullyReadAfter(m as any, user.uid, groupMembers)) patch.isRead = true;
        patches.push({ id: m.id, patch });
      } else if (isClientChannel) {
        if (m.isRead) return;
        // Only the CLIENT's messages get a staff read receipt. A colleague's message
        // to the client is flushed from the unread window (isRead) but never gets
        // `readAt` — that field is the client's receipt ("✓✓ Parë"), written by the
        // portal alone; staff opening the thread used to forge it.
        patches.push({ id: m.id, patch: isUnreadClientMessage(m, user.uid) ? { isRead: true, readAt: new Date() } : { isRead: true } });
      } else {
        if (m.isRead) return;
        patches.push({ id: m.id, patch: { isRead: true } });
      }
    });
    if (patches.length === 0) return;
    patches.forEach(p => markedAsReadRef.current.add(p.id));
    if (activeChannel !== snapshotChannel || chatMode !== 'channel') {
      patches.forEach(p => markedAsReadRef.current.delete(p.id));
      return;
    }
    commitReadMarks(patches, 'channel');
  }, [chatMode, channelMessages, allUnreadClientMsgs, allUnreadTeamMsgs, allGroups, user, activeChannel, isClientChannel, isGroupChannel, commitReadMarks]);

  // Dismiss the bell notification(s) tied to the conversation I just opened.
  // Chat notifications (client_message, @mention) carry linkTo = the channel id;
  // a direct_message carries NO linkTo — its sender is embedded in actionUrl —
  // so DM threads are matched on that instead. Opening the conversation should
  // clear them just like tapping them in the bell would.
  useEffect(() => {
    if (!myUnreadNotifs?.length) return;
    let toClear: any[] = [];
    if (chatMode === 'channel' && activeChannel) {
      toClear = myUnreadNotifs.filter(
        (n: any) => n.linkTo === activeChannel && !markedNotifReadRef.current.has(n.id),
      );
    } else if (chatMode === 'direct' && activeDirectUserId) {
      const dmUrl = `/app/chat?directUserId=${activeDirectUserId}`;
      toClear = myUnreadNotifs.filter(
        (n: any) => n.type === 'direct_message' && n.actionUrl === dmUrl && !markedNotifReadRef.current.has(n.id),
      );
    }
    if (toClear.length === 0) return;
    const ids = toClear.map((n: any) => n.id);
    ids.forEach((id: string) => markedNotifReadRef.current.add(id));
    const batch = writeBatch(db);
    ids.forEach((id: string) => batch.update(doc(db, 'notifications', id), { isRead: true }));
    batch.commit().catch((err) => {
      ids.forEach((id: string) => markedNotifReadRef.current.delete(id));
      console.error('[ChatView] dismiss chat notifications failed', err);
    });
  }, [chatMode, activeChannel, activeDirectUserId, myUnreadNotifs]);

  // A deleted message must not keep a bell row alive quoting text that no longer
  // exists. Only the RECIPIENT may write a notification (rules: userId pinned,
  // isRead/readAt only), so the sender structurally cannot clean up after
  // handleDeleteMessage — this pass does it from the reader's side, using the
  // `messageId` every chat notification now carries.
  useEffect(() => {
    if (!myUnreadNotifs?.length) return;
    const deleted = new Set<string>();
    const scan = (list: any[] | null | undefined) =>
      (list || []).forEach(m => { if (m?.deletedAt && m.id) deleted.add(m.id); });
    scan(channelMessages as any);
    scan(allUnreadTeamMsgs as any);
    scan(allUnreadClientMsgs as any);
    scan(bgReceivedDMs as any);
    if (deleted.size === 0) return;
    const ids = myUnreadNotifs
      .filter((n: any) => n.messageId && deleted.has(n.messageId) && !markedNotifReadRef.current.has(n.id))
      .map((n: any) => n.id);
    if (ids.length === 0) return;
    ids.forEach((id: string) => markedNotifReadRef.current.add(id));
    const batch = writeBatch(db);
    ids.forEach((id: string) => batch.update(doc(db, 'notifications', id), { isRead: true }));
    batch.commit().catch((err) => {
      ids.forEach((id: string) => markedNotifReadRef.current.delete(id));
      console.error('[ChatView] dismiss notifications of deleted messages failed', err);
    });
  }, [myUnreadNotifs, channelMessages, allUnreadTeamMsgs, allUnreadClientMsgs, bgReceivedDMs]);

  // Auto-resize textarea + @mention detection
  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setMessageText(v);
    if (chatMode !== 'ai' && v) handleTyping();
    // Auto-grow in rAF so we don't force a synchronous reflow on every keystroke.
    const ta = e.target;
    requestAnimationFrame(() => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; });
    // Detect "@xxx" prefix immediately before caret
    if (chatMode === 'channel' || chatMode === 'direct') {
      const caret = e.target.selectionStart ?? v.length;
      const upto = v.slice(0, caret);
      // @@Customer first (longer prefix wins)
      const mc = upto.match(/(?:^|\s)@@([\p{L}0-9_.\- ]{0,40})$/u);
      const mu = upto.match(/(?:^|\s)@([\p{L}0-9_.\- ]{0,30})$/u);
      if (mc) {
        setMentionKind('customer');
        setMentionOpen(true);
        setMentionQuery(mc[1].toLowerCase());
        setMentionAnchorIdx(caret - mc[1].length - 2);
        setMentionSelected(0);
      } else if (mu && !mu[0].includes('@@')) {
        setMentionKind('user');
        setMentionOpen(true);
        setMentionQuery(mu[1].toLowerCase());
        setMentionAnchorIdx(caret - mu[1].length - 1);
        setMentionSelected(0);
      } else if (mentionOpen) {
        setMentionOpen(false);
      }
    }
    // Detect "/xxx" as start of textarea (no spaces yet)
    const slashMatch = v.match(/^\/(\w{0,20})$/);
    if (slashMatch && (chatMode === 'channel' || chatMode === 'direct')) {
      setSlashOpen(true);
      setSlashQuery(slashMatch[1]);
      setSlashSelected(0);
    } else if (slashOpen) {
      setSlashOpen(false);
    }
  };

  const mentionCandidates = useMemo(() => {
    if (!mentionOpen) return [] as Array<{ uid: string; name: string; kind: 'user' | 'customer' }>;
    const q = mentionQuery;
    if (mentionKind === 'customer') {
      const all = (customers || []).map(c => ({ uid: c.id, name: (c.name || c.company || '').trim(), kind: 'customer' as const }))
        .filter(c => c.name);
      return all.filter(c => c.name.toLowerCase().includes(q)).slice(0, 6);
    }
    // Only people who are actually in this conversation. Offering the whole business
    // let you mention a non-member of a private group, who then got a push with the
    // message text and a link to a channel the rules forbid them to read.
    const audience = chatMode === 'channel' ? channelMemberIds(activeChannel) : null;
    const all = (otherMembers || [])
      .filter(m => !audience || audience.includes(m.userId))
      .map(m => ({ uid: m.userId, name: getUserDisplayName(m.userId), kind: 'user' as const }));
    return all.filter(c => c.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mentionOpen, mentionQuery, mentionKind, otherMembers, getUserDisplayName, customers, chatMode, activeChannel, channelMemberIds]);

  const insertMention = useCallback((name: string) => {
    const prefixLen = mentionKind === 'customer' ? 2 : 1;
    const prefix = mentionKind === 'customer' ? '@@' : '@';
    const before = messageText.slice(0, mentionAnchorIdx);
    const after = messageText.slice(mentionAnchorIdx + prefixLen + mentionQuery.length);
    const newText = `${before}${prefix}${name} ${after}`;
    setMessageText(newText);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      const ta = chatTextareaRef.current;
      if (ta) {
        const newCaret = before.length + prefixLen + name.length + 1;
        ta.focus();
        ta.setSelectionRange(newCaret, newCaret);
      }
    });
  }, [messageText, mentionAnchorIdx, mentionQuery, mentionKind]);

  // Insert an emoji from the composer picker at the caret (falls back to append
  // when the textarea ref isn't available). Closes the picker after inserting.
  const insertEmoji = useCallback((emoji: string) => {
    const ta = chatTextareaRef.current;
    if (ta) {
      const start = ta.selectionStart ?? messageText.length;
      const end = ta.selectionEnd ?? messageText.length;
      const newText = messageText.slice(0, start) + emoji + messageText.slice(end);
      setMessageText(newText);
      requestAnimationFrame(() => {
        ta.focus();
        const caret = start + emoji.length;
        try { ta.setSelectionRange(caret, caret); } catch { /* noop */ }
      });
    } else {
      setMessageText(prev => prev + emoji);
    }
    setShowEmojiPicker(null);
  }, [messageText]);

  // Close the composer emoji picker on Escape or an outside click.
  useEffect(() => {
    if (showEmojiPicker !== 'input') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowEmojiPicker(null); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      // Ignore clicks on the trigger itself — it manages its own toggle.
      if (t?.closest?.('[data-emoji-trigger]')) return;
      if (composerEmojiRef.current && !composerEmojiRef.current.contains(t)) {
        setShowEmojiPicker(null);
      }
    };
    document.addEventListener('keydown', onKey);
    // Delay the outside-click listener a tick so the opening click doesn't close it.
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [showEmojiPicker]);

  // Slash commands registry
  const SLASH_COMMANDS = useMemo(() => ([
    { cmd: 'task', label: '/task', desc: 'Krijo një detyrë nga ky tekst' },
    { cmd: 'snippet', label: '/snippet', desc: 'Fut një përgjigje të ruajtur' },
    { cmd: 'me', label: '/me', desc: 'Dërgo si veprim (italic)' },
    { cmd: 'shrug', label: '/shrug', desc: 'Fut ¯\\_(\u30c4)_/¯' },
    { cmd: 'tableflip', label: '/tableflip', desc: 'Fut (\u256f\u00b0\u25a1\u00b0)\u256f\ufe35 \u253b\u2501\u253b' },
    { cmd: 'clear', label: '/clear', desc: 'Pastro tekstin' },
  ]), []);

  const slashCandidates = useMemo(() => {
    if (!slashOpen) return [] as typeof SLASH_COMMANDS;
    const q = slashQuery.toLowerCase();
    return SLASH_COMMANDS.filter(c => c.cmd.startsWith(q));
  }, [slashOpen, slashQuery, SLASH_COMMANDS]);

  const executeSlash = useCallback((cmd: string) => {
    setSlashOpen(false);
    switch (cmd) {
      case 'task': {
        setTaskFromMsgSource(null);
        setTaskFromMsgTitle('');
        setTaskFromMsgAssignee(user?.uid || '');
        setTaskFromMsgDueDate('');
        setTaskFromMsgPriority('medium');
        setTaskFromMsgOpen(true);
        setMessageText('');
        return;
      }
      case 'snippet': {
        setMessageText('');
        setSnippetSearch('');
        setSnippetPickerOpen(true);
        return;
      }
      case 'me': {
        setMessageText('/me ');
        requestAnimationFrame(() => chatTextareaRef.current?.focus());
        return;
      }
      case 'shrug': {
        setMessageText('\u00af\\_(\u30c4)_/\u00af');
        return;
      }
      case 'tableflip': {
        setMessageText('(\u256f\u00b0\u25a1\u00b0)\u256f\ufe35 \u253b\u2501\u253b');
        return;
      }
      case 'clear': {
        setMessageText('');
        return;
      }
    }
  }, [user]);

  // Loading / Error
  // The list model is built once per data change — it used to be an IIFE inside
  // the JSX, rebuilt (with every closure) on each keystroke of the composer.
  const unifiedConversations = useMemo((): UnifiedConv[] => {
            const convs: UnifiedConv[] = [];
            // FivoAI — always pinned at top.
            convs.push({ key: 'ai', type: 'ai', name: 'FivoAI', preview: 'Asistenti juaj personal', time: 0, unread: 0, pinned: true, initials: 'AI', isActive: chatMode === 'ai', onSelect: handleSelectAi });
            // Groups
            (myGroups || []).forEach(g => convs.push({
              key: 'g-' + g.id, type: 'group', name: g.name || 'Grup',
              preview: (g as any).lastMessagePreview
                ? `${(g as any).lastMessageSenderId === user?.uid ? 'Ti' : getUserDisplayName((g as any).lastMessageSenderId || '')}: ${(g as any).lastMessagePreview}`
                : `${(g.members || []).length} ${plural((g.members || []).length, 'anëtar', 'anëtarë')}`,
              time: (g as any).lastMessageAt ? getTimestampMs((g as any).lastMessageAt) : 0,
              unread: channelUnreadMap.get(g.id) || 0,
              initials: (g.name || 'G').slice(0, 2).toUpperCase(),
              isActive: chatMode === 'channel' && activeChannel === g.id,
              onSelect: () => handleSelectChannel(g.id),
            }));
            // Clients — list EVERY customer of this business, not just those with a
            // clientPortalAccess record. Previously the list was driven by
            // `portalAccess`, so a client only appeared after logging into the portal
            // at least once; CRM-only clients (e.g. added but never logged in) were
            // invisible and un-messageable. `customers` is business-scoped, so the
            // `client-{id}` channel is always readable under RLS. Portal access is
            // merged in only for the email fallback on the display name.
            const portalByCustomer = new Map<string, ClientPortalAccess>();
            (portalAccess || []).forEach(a => { if (a.customerId && !portalByCustomer.has(a.customerId)) portalByCustomer.set(a.customerId, a); });
            (customers || []).forEach(c => {
              if (!c.id) return;
              const access = portalByCustomer.get(c.id);
              const cid = `client-${c.id}`;
              const repId = (c as any)?.assignedToUserId;
              const denorm = (c as any)?.lastClientMessageAt ? getTimestampMs((c as any).lastClientMessageAt) : 0;
              convs.push({
                key: 'c-' + c.id, type: 'client', name: c.name || access?.email || 'Klient',
                preview: repId ? `👤 ${repId === user?.uid ? 'Ti' : getUserDisplayName(repId)}` : '',
                unassigned: !repId && Math.max(denorm, clientRecencyMap.get(c.id) || 0) > 0,
                time: Math.max(denorm, clientRecencyMap.get(c.id) || 0),
                unread: clientUnreadMap.get(cid) || 0,
                initials: (c.name || access?.email || 'K').slice(0, 2).toUpperCase(),
                isActive: chatMode === 'channel' && activeChannel === cid,
                onSelect: () => handleSelectChannel(cid),
              });
            });
            // Staff DMs (existing convos + all active members so new DMs can start)
            const staffIds = new Set<string>(directConversations || []);
            (teamMembers || []).forEach(m => { if (m.userId && m.userId !== user?.uid) staffIds.add(m.userId); });
            staffIds.forEach(uid => {
              const last = dmLastMessageMap.get(uid);
              const status = getUserStatus(uid);
              convs.push({
                key: 's-' + uid, type: 'staff', name: getUserDisplayName(uid),
                preview: last ? `${last.isOwn ? 'Ti: ' : ''}${last.content}` : '',
                time: last ? getTimestampMs(last.createdAt) : 0,
                unread: directUnreadMap.get(uid) || 0,
                online: isOnline(uid),
                statusEmoji: status?.emoji,
                initials: (getUserDisplayName(uid) || '??').slice(0, 2).toUpperCase(),
                isActive: chatMode === 'direct' && activeDirectUserId === uid,
                onSelect: () => handleSelectDirectMessage(uid),
              });
            });
    return convs;
  }, [myGroups, customers, portalAccess, teamMembers, directConversations, dmLastMessageMap, clientRecencyMap,
      channelUnreadMap, clientUnreadMap, directUnreadMap, chatMode, activeChannel, activeDirectUserId, user?.uid,
      getUserDisplayName, getUserStatus, isOnline, handleSelectAi, handleSelectChannel, handleSelectDirectMessage]);

  if (chatMode !== 'ai' && isPending) {
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

  // Fills the full-bleed route wrapper (App.tsx gives /app/chat a padding-free
  // flex-1 min-h-0 container). h-full + the parent's single dvh height context
  // means no svh/-mb hacks are needed and the bottom nav stays on-screen.
  return (
    <div className="flex min-w-0 h-full bg-background overflow-hidden">
      {/* SIDEBAR — full-width master list on mobile, fixed rail on lg+. On mobile
          it collapses (hidden) once a conversation opens so <main> fills the screen. */}
      <aside className={`w-full lg:w-72 min-w-0 border-r border-[#E4E9F1] dark:border-border bg-[#F7F9FC] dark:bg-muted/5 flex flex-col flex-shrink-0 min-h-0 overflow-hidden transition-all ${showSidebar ? 'flex' : 'hidden lg:flex'}`}>
        {/* Sidebar header */}
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="font-semibold text-sm">Mesazhe</h2>
          <div className="flex items-center gap-1">
            {totalUnread > 0 && (
              <Badge variant="destructive" className="h-5 min-w-5 text-[10px] px-1.5">{totalUnread}</Badge>
            )}
            {canCreateGroups && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Krijo grup të ri"
                title="Grup i ri"
                onClick={() => { setNewGroupName(''); setNewGroupDesc(''); setNewGroupMembers([]); setShowCreateGroup(true); }}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <UnifiedChatList
          canCreateGroups={canCreateGroups}
          onCreateGroup={() => { setNewGroupName(''); setNewGroupDesc(''); setNewGroupMembers([]); setShowCreateGroup(true); }}
          conversations={unifiedConversations}
        />

        {/* Sidebar-i i vjetër me seksione, i zëvendësuar nga <UnifiedChatList> më lart.
            Mbahet i parkuar me `{false && …}` si referencë; `false &&` është i
            qëllimshëm, ndaj heshtohet rregulli përkatës në vend që të fshihet kodi. */}
        {/* eslint-disable-next-line no-constant-binary-expression */}
        {false && (<div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
          {/* AI Assistant - pinned at top */}
          <button
            onClick={handleSelectAi}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left ${
              chatMode === 'ai'
                ? 'bg-accent-soft dark:bg-primary/10 border border-primary/30 dark:border-primary/40 shadow-sm'
                : 'hover:bg-accent/50'
            }`}
          >
            <div className="h-9 w-9 rounded-xl bg-gradient-primary flex items-center justify-center flex-shrink-0 shadow-sm">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${chatMode === 'ai' ? 'text-primary' : ''}`}>FivoAI</p>
              <p className="text-[11px] text-muted-foreground truncate">Asistenti juaj personal</p>
            </div>
            <Badge className="bg-accent-soft dark:bg-primary/10 text-primary text-[9px] border-0 font-normal">AI</Badge>
          </button>

          <div className="h-px bg-border/50 mx-2 my-2" />

          {/* Groups (WhatsApp-style, member-scoped) */}
          <div className="flex items-center justify-between px-2 pt-3 pb-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Grupet</p>
            {canCreateGroups && (
              <button
                onClick={() => { setNewGroupName(''); setNewGroupDesc(''); setNewGroupMembers([]); setShowCreateGroup(true); }}
                className="h-5 w-5 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                title="Krijo grup të ri"
                aria-label="Krijo grup të ri"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {myGroups.length === 0 && (
            <p className="px-3 py-1 text-[11px] text-muted-foreground/60">
              {canCreateGroups ? 'Asnjë grup. Kliko + për të krijuar.' : 'Nuk je në asnjë grup.'}
            </p>
          )}
          {myGroups.map(group => {
            const isActive = chatMode === 'channel' && activeChannel === group.id;
            const unread = channelUnreadMap.get(group.id) || 0;
            return (
              <div
                key={group.id}
                className={`group/grp w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all text-left cursor-pointer ${
                  isActive
                    ? 'bg-primary/8 text-primary font-medium shadow-sm border border-primary/10'
                    : 'hover:bg-accent/50 text-foreground/70'
                }`}
                onClick={() => handleSelectChannel(group.id)}
              >
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  isActive ? 'bg-primary/10' : 'bg-muted/80'
                }`}>
                  <Users className={`h-4 w-4 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="block truncate text-sm">{group.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{(group.members || []).length} anëtarë</span>
                </div>
                {unread > 0 && !isActive && (
                  <span className="h-5 min-w-5 px-1.5 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">{unread}</span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); setAddMemberQuery(''); setManageGroupId(group.id); }}
                  className="opacity-0 group-hover/grp:opacity-100 h-6 w-6 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-all flex-shrink-0"
                  title="Menaxho grupin"
                  aria-label="Menaxho grupin"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}

          {/* Client Channels */}
          {portalAccess && portalAccess.length > 0 && (
            <>
              <div className="h-px bg-border/50 mx-2 my-2" />
              <div className="flex items-center justify-between px-2 pt-1 pb-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Klientët</p>
                {allUnreadClientMsgs && allUnreadClientMsgs.length > 0 && (
                  <button
                    onClick={async () => {
                      await Promise.all(allUnreadClientMsgs.map(m => messageMutation.update(m.id, { isRead: true })));
                    }}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    title="Shëno të gjitha si të lexuara"
                  >
                    Pastro {allUnreadClientMsgs.length}
                  </button>
                )}
              </div>
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
              {/* Scope: mine (assigned to me) vs all (admins follow everything) */}
              <div className="px-1 mb-1.5 inline-flex items-center gap-0.5 bg-muted/40 rounded-lg p-0.5 text-[11px]">
                {([['all', 'Të gjitha'], ['mine', 'Të miat']] as const).map(([v, label]) => (
                  <button key={v} onClick={() => setClientScope(v)}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${clientScope === v ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="space-y-0.5 max-h-[30vh] overflow-y-auto">
                {portalAccess.filter((a, i, arr) => {
                  // Deduplicate by customerId — keep first occurrence only
                  if (arr.findIndex(x => x.customerId === a.customerId) !== i) return false;
                  const c = customers?.find(cu => cu.id === a.customerId);
                  // "Të miat" = conversations of customers assigned to me
                  if (clientScope === 'mine' && (c as any)?.assignedToUserId !== user?.uid) return false;
                  if (!clientSearch.trim()) return true;
                  const q = clientSearch.toLowerCase();
                  return c?.name?.toLowerCase().includes(q) || c?.email?.toLowerCase().includes(q) || a.email?.toLowerCase().includes(q);
                }).sort((a, b) => {
                  // Sort by most-recent conversation (WhatsApp-style). Recency =
                  // latest client message (recentClientMsgs, read or unread) OR the
                  // denormalized lastClientMessageAt (covers staff replies too).
                  const recency = (customerId: string) => {
                    const c = customers?.find(cu => cu.id === customerId);
                    const denorm = (c as any)?.lastClientMessageAt ? getTimestampMs((c as any).lastClientMessageAt) : 0;
                    return Math.max(denorm, clientRecencyMap.get(customerId) || 0);
                  };
                  return recency(b.customerId) - recency(a.customerId);
                }).map(access => {
                  const customer = customers?.find(c => c.id === access.customerId);
                  const clientChannelId = `client-${access.customerId}`;
                  const isActive = chatMode === 'channel' && activeChannel === clientChannelId;
                  const unread = clientUnreadMap.get(clientChannelId) || 0;
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
                          {(() => {
                            const repId = (customer as any)?.assignedToUserId;
                            const mine = repId && repId === user?.uid;
                            return (
                              <span className={`truncate block text-[10px] ${mine ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-muted-foreground'}`}>
                                {repId ? `👤 ${mine ? 'Ti' : getUserDisplayName(repId)}` : '⚠️ Pa përgjegjës'}
                              </span>
                            );
                          })()}
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
                            const projUnread = clientUnreadMap.get(projChannelId) || 0;
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

          {/* Direct Messages */}
          <div className="h-px bg-border/50 mx-2 my-2" />
          <p className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Mesazhe Direkte</p>
          {/* Search to start a new DM (replaces the always-on "Anëtarë" list) */}
          <div className="relative px-1 mb-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={dmSearch}
              onChange={e => setDmSearch(e.target.value)}
              placeholder="Kërko person për t'i shkruar..."
              className="h-7 pl-7 pr-6 text-xs rounded-lg bg-muted/40 border-0 focus-visible:ring-1"
            />
            {dmSearch && (
              <button onClick={() => setDmSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="h-3 w-3 text-muted-foreground" /></button>
            )}
          </div>
          {/* Search results: matching members → click to start a DM */}
          {dmSearch.trim() && (
            dmSearchResults.length === 0 ? (
              <p className="px-3 py-1.5 text-[11px] text-muted-foreground/40 italic">Asnjë person s'u gjet</p>
            ) : (
              dmSearchResults.map(member => {
                const name = getUserDisplayName(member.userId);
                const status = getUserStatus(member.userId);
                return (
                  <button
                    key={member.id}
                    onClick={() => handleSelectDirectMessage(member.userId)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all text-left hover:bg-accent/50 text-foreground/70"
                  >
                    <div className="relative flex-shrink-0">
                      <div className={`h-8 w-8 rounded-lg ${getAvatarColor(member.userId)} flex items-center justify-center`}>
                        <span className="text-[10px] font-bold text-white">{name.slice(0, 2).toUpperCase()}</span>
                      </div>
                      {isOnline(member.userId) && (
                        <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 border-2 border-background" />
                      )}
                    </div>
                    <span className="flex-1 truncate text-sm flex items-center gap-1.5">
                      <span className="truncate">{name}</span>
                      {status && (
                        <span className="flex-shrink-0 text-xs opacity-75" title={status.text}>{status.emoji}</span>
                      )}
                    </span>
                  </button>
                );
              })
            )
          )}
          {!dmSearch.trim() && directConversations.length === 0 && (
            <p className="px-3 py-1.5 text-[11px] text-muted-foreground/40 italic">Kërko një person për të nisur një bisedë.</p>
          )}
          {!dmSearch.trim() && directConversations.map(userId => {
            const unread = directUnreadMap.get(userId) || 0;
            const isActive = chatMode === 'direct' && activeDirectUserId === userId;
            const name = getUserDisplayName(userId);
            const lastMsg = dmLastMessageMap.get(userId);
            return (
              <button
                key={userId}
                onClick={() => handleSelectDirectMessage(userId)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left ${
                  isActive ? 'bg-primary/8 text-primary font-medium shadow-sm border border-primary/10' : 'hover:bg-accent/50 text-foreground/70'
                }`}
              >
                <div className="relative flex-shrink-0">
                  <div className={`h-9 w-9 rounded-xl ${getAvatarColor(userId)} flex items-center justify-center`}>
                    <span className="text-[11px] font-bold text-white">{name.slice(0, 2).toUpperCase()}</span>
                  </div>
                  {isOnline(userId) && (
                    <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-background" />
                  )}
                  {unread > 0 && !isActive && (
                    <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-bold">{unread > 9 ? '9+' : unread}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`truncate text-sm ${unread > 0 && !isActive ? 'font-semibold text-foreground' : ''}`}>{name}</span>
                    {lastMsg && <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">{formatShortTime(lastMsg.createdAt)}</span>}
                  </div>
                  {lastMsg && (
                    <p className={`text-[11px] truncate mt-0.5 ${unread > 0 && !isActive ? 'text-foreground/80 font-medium' : 'text-muted-foreground/60'}`}>
                      {lastMsg.isOwn && <span className="text-muted-foreground/50">Ti: </span>}{lastMsg.content}
                    </p>
                  )}
                </div>
              </button>
            );
          })}

          {/* WhatsApp moved to its own page (/app/whatsapp) — old inline section removed. */}
        </div>)}
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
              <div className="h-9 w-9 rounded-xl bg-gradient-primary flex items-center justify-center shadow-sm">
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
              {activeChannel.startsWith('client-') ? (() => {
                const clientName = (() => {
                  const match = activeChannel.match(/^client-(.+?)-project-(.+)$/);
                  if (match) { const c = customers?.find(cu => cu.id === match[1]); const p = projects?.find(pr => pr.id === match[2]); return `${c?.name || 'Klient'} — ${p?.name || 'Projekt'}`; }
                  const custId = activeChannel.replace('client-', '');
                  return customers?.find(c => c.id === custId)?.name || 'Klient';
                })();
                return (
                  <>
                    <div className="h-11 w-11 rounded-full bg-[#E6F6EF] dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-[#1B9E63] dark:text-emerald-300">{clientName.slice(0, 2).toUpperCase()}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-[15px] text-[#0C1B33] dark:text-foreground truncate">{clientName}</p>
                        <span className="flex-shrink-0 text-[9.5px] font-bold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded bg-[#E6F6EF] text-[#1B9E63] dark:bg-emerald-900/30 dark:text-emerald-300">Klient</span>
                      </div>
                      <p className="text-[11.5px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Aktiv tani
                      </p>
                    </div>
                  </>
                );
              })() : (() => {
                const meta = getChannelMeta(activeChannel);
                // Fixed channels removed — a non-client channel is either a group
                // or nothing selected (empty state).
                if (!meta || !meta.isGroup) {
                  return (
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="h-9 w-9 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm">Bisedat</p>
                        <p className="text-[11px] text-muted-foreground">Zgjidh një grup ose bisedë</p>
                      </div>
                    </div>
                  );
                }
                return (
                  <button
                    type="button"
                    onClick={() => { if (meta.group) { setAddMemberQuery(''); setManageGroupId(meta.group.id); } }}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer rounded-lg -mx-1 px-1 hover:bg-accent/40"
                  >
                    <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Users className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{meta.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {(meta.group?.members || []).length} {plural((meta.group?.members || []).length, 'anëtar', 'anëtarë')} · prek për të menaxhuar
                      </p>
                    </div>
                  </button>
                );
              })()}
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {activeDirectUserId ? (
                <>
                  <div className="relative flex-shrink-0">
                    <div className={`h-9 w-9 rounded-xl ${getAvatarColor(activeDirectUserId)} flex items-center justify-center`}>
                      <span className="text-xs font-bold text-white">{getUserDisplayName(activeDirectUserId).slice(0, 2).toUpperCase()}</span>
                    </div>
                    <div className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background ${isOnline(activeDirectUserId) ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{getUserDisplayName(activeDirectUserId)}</p>
                    <p className={`text-[11px] flex items-center gap-1 ${isOnline(activeDirectUserId) ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                      <Circle className={`h-1.5 w-1.5 fill-current ${isOnline(activeDirectUserId) ? 'text-emerald-500' : 'text-muted-foreground/50'}`} />
                      {getLastSeenText(activeDirectUserId)}
                    </p>
                  </div>
                </>
              ) : <p className="text-sm text-muted-foreground">Zgjidh një person</p>}
            </div>
          )}

          <div className="flex items-center gap-1">
            {chatMode === 'ai' && aiMessages.length > 0 && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={resetAiChat} aria-label="Bisedë e re" title="Bisedë e re">
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
            {(chatMode === 'channel' ? !!activeChannel : chatMode === 'direct' ? !!activeDirectUserId : false) && (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600 hover:text-emerald-700" onClick={startVideoCall} disabled={videoStarting} aria-label="Thirrje video" title="Thirrje video">
                {videoStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
              </Button>
            )}
            {chatMode !== 'ai' && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSummarizeChat} disabled={summaryLoading} aria-label="Përmblidh bisedën me AI" title="Përmblidh bisedën me AI">
                {summaryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              </Button>
            )}
            {chatMode !== 'ai' && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setShowSearch(!showSearch); setSearchQuery(''); }} aria-label="Kërko në bisedë" title="Kërko në bisedë">
                <Search className="h-4 w-4" />
              </Button>
            )}
            {chatMode !== 'ai' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Më shumë veprime" title="Më shumë">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onClick={handleExtractActions} disabled={actionExtractLoading}>
                    {actionExtractLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
                    <span>Nxirr detyrat (AI)</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      const cur = user ? getUserStatus(user.uid) : null;
                      setStatusEmojiInput(cur?.emoji || '💬');
                      setStatusTextInput(cur?.text || '');
                      setStatusHoursInput(2);
                      setStatusDialogOpen(true);
                    }}
                  >
                    {(() => {
                      const s = user ? getUserStatus(user.uid) : null;
                      return s ? <span className="text-base leading-none">{s.emoji}</span> : <Circle className="h-4 w-4" />;
                    })()}
                    <span>Statusi im</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setCompactMode(c => !c)}>
                    <Rows3 className={`h-4 w-4 ${compactMode ? 'text-primary' : ''}`} />
                    <span>{compactMode ? 'Pamje normale' : 'Pamje kompakte'}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </header>

        {/* Owner + watchers routing bar for client conversations (Request 1) */}
        {chatMode === 'channel' && isClientChannel && (
          <ConversationOwnerBar channelId={activeChannel} />
        )}

        {/* Search bar */}
        {showSearch && chatMode !== 'ai' && (
          <div className="border-b bg-muted/20">
            <div className="flex items-center gap-2 px-5 py-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Kërko në mesazhe..." className="h-7 text-sm border-0 bg-transparent focus-visible:ring-0 shadow-none" autoFocus />
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 ${showSearchFilters || searchSenderId !== '__any__' || searchDateFrom || searchDateTo ? 'text-primary' : ''}`}
                onClick={() => setShowSearchFilters(s => !s)}
                title="Filtra"
              ><Filter className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchSenderId('__any__'); setSearchDateFrom(''); setSearchDateTo(''); setShowSearchFilters(false); }}><X className="h-3.5 w-3.5" /></Button>
            </div>
            {showSearchFilters && (
              <div className="flex flex-wrap items-center gap-2 px-5 pb-2 text-xs">
                <span className="text-muted-foreground">Dërguesi:</span>
                <select
                  value={searchSenderId}
                  onChange={e => setSearchSenderId(e.target.value)}
                  className="h-7 rounded-md border bg-background px-2 text-base sm:text-xs"
                >
                  <option value="__any__">Të gjithë</option>
                  {visibleSenders.map(uid => (
                    <option key={uid} value={uid}>{getUserDisplayName(uid)}</option>
                  ))}
                </select>
                <span className="text-muted-foreground ml-2">Nga:</span>
                <input
                  type="date"
                  value={searchDateFrom}
                  onChange={e => setSearchDateFrom(e.target.value)}
                  className="h-7 rounded-md border bg-background px-2 text-base sm:text-xs"
                />
                <span className="text-muted-foreground">Deri:</span>
                <input
                  type="date"
                  value={searchDateTo}
                  onChange={e => setSearchDateTo(e.target.value)}
                  className="h-7 rounded-md border bg-background px-2 text-base sm:text-xs"
                />
                {(searchSenderId !== '__any__' || searchDateFrom || searchDateTo) && (
                  <button
                    onClick={() => { setSearchSenderId('__any__'); setSearchDateFrom(''); setSearchDateTo(''); }}
                    className="text-[11px] text-primary hover:underline ml-1"
                  >Pastro filtrat</button>
                )}
              </div>
            )}
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
                    <div className="h-16 w-16 rounded-2xl bg-gradient-primary flex items-center justify-center mb-5 shadow-lg">
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
                          <div className="h-8 w-8 rounded-xl bg-gradient-primary flex items-center justify-center flex-shrink-0 mt-1">
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
                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
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
              <div className="relative flex items-end gap-2 bg-muted/30 border rounded-2xl px-4 py-2 focus-within:border-primary/60 focus-within:bg-background focus-within:shadow-md transition-all">
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
                    messageText.trim() ? 'bg-primary hover:bg-primary-hover text-primary-foreground shadow-sm' : 'bg-transparent text-muted-foreground/40'
                  }`}
                >
                  {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground/50 text-center mt-1.5">FivoAI mund të bëjë gabime. Verificoni informacionin e rëndësishëm.</p>
            </div>
          </>
        ) : (
          /* Regular Chat Area */
          <>
            <div className="relative flex-1 min-h-0">
            <ScrollArea className="h-full" ref={scrollRef}>
              <div
                className={`px-2 sm:px-5 ${compactMode ? 'py-1 sm:py-2 text-[13px]' : 'py-3 sm:py-4'} space-y-0`}
                onMouseOver={(e) => {
                  const el = (e.target as HTMLElement | null)?.closest?.('[id^="msg-"]');
                  hoveredMessageIdRef.current = el ? (el as HTMLElement).id.replace(/^msg-/, '') : null;
                }}
                onMouseLeave={() => { hoveredMessageIdRef.current = null; }}
              >
                {/* Pinned messages bar */}
                {pinnedMessages.length > 0 && (
                  <div className="sticky top-0 z-10 -mx-2 sm:-mx-5 mb-2 px-3 sm:px-5 py-2 bg-amber-50/95 dark:bg-amber-950/40 border-y border-amber-200/60 dark:border-amber-800/40 backdrop-blur">
                    <button
                      onClick={() => setPinnedCollapsed(c => !c)}
                      className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:underline"
                    >
                      <Pin className="h-3 w-3" />
                      <span>{pinnedMessages.length} {pinnedMessages.length === 1 ? 'mesazh i fiksuar' : 'mesazhe të fiksuara'}</span>
                      <ChevronDown className={`h-3 w-3 transition-transform ${pinnedCollapsed ? '-rotate-90' : ''}`} />
                    </button>
                    {!pinnedCollapsed && (
                      <div className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
                        {pinnedMessages.map(pm => (
                          <button
                            key={pm.id}
                            onClick={() => {
                              const el = document.getElementById(`msg-${pm.id}`);
                              if (el) {
                                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                el.classList.add('ring-2', 'ring-amber-400');
                                setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400'), 1600);
                              }
                            }}
                            className="block w-full text-left text-[11px] px-2 py-1 rounded hover:bg-amber-100/60 dark:hover:bg-amber-900/30 truncate"
                          >
                            <span className="font-medium text-amber-700 dark:text-amber-300">{getUserDisplayName(pm.senderId)}:</span>{' '}
                            <span className="text-foreground/80">{(() => { const t = (pm.content || '').replace(/[*_`~]/g, ''); return t.slice(0, 90) + (t.length > 90 ? '…' : ''); })()}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {/* Load older — reveals more of the render window, and fetches more
                    from Firestore once the window reaches the query limit. */}
                {(chatMode === 'channel' || chatMode === 'direct') && !searchQuery &&
                  (renderCap < filteredMessages.length || (chatMode === 'channel' && filteredMessages.length >= channelLimit)) && (
                  <div className="flex justify-center py-3">
                    <button
                      onClick={() => {
                        setRenderCap(c => c + RENDER_STEP);
                        if (chatMode === 'channel' && filteredMessages.length >= channelLimit) setChannelLimit(l => l + 100);
                      }}
                      className="text-xs text-primary underline hover:opacity-80"
                    >
                      Ngarko mesazhe më të vjetra
                    </button>
                  </div>
                )}
                {filteredMessages.length > 0 ? (
                  (() => {
                    let lastDateKey = '';
                    // Render only the most-recent window (older via "load older").
                    const visibleMessages = filteredMessages.length > renderCap
                      ? filteredMessages.slice(filteredMessages.length - renderCap)
                      : filteredMessages;
                    return visibleMessages.map((message, idx) => {
                      const isOwn = message.senderId === user?.uid;
                      const dateKey = getDateKey(message.createdAt);
                      const showDateSep = dateKey !== lastDateKey;
                      lastDateKey = dateKey;
                      const prevMsg = idx > 0 ? visibleMessages[idx - 1] : null;
                      // Slack-style: group messages within 5-minute window from same sender
                      const sameSender = !!(prevMsg &&
                        prevMsg.senderId === message.senderId &&
                        !showDateSep &&
                        getTimestampMs(message.createdAt) - getTimestampMs(prevMsg.createdAt) < 5 * 60 * 1000);
                      const isDeleted = !!(message as any).deletedAt;
                      const isEditing = editingMessageId === message.id;
                      const senderName = getUserDisplayName(message.senderId);
                      const mentionsMe = !!((message as any).mentions as string[] | undefined)?.includes(user?.uid || '__');
                      const isPinned = !!(message as any).isPinned;
                      // New messages divider: show before the first message that was unread when we opened
                      const isFirstUnread = sessionUnreadIdsRef.current.has(message.id) &&
                        (idx === 0 || !sessionUnreadIdsRef.current.has(visibleMessages[idx - 1].id));
                      // Read receipt: last own message in DM that has been read
                      const showReadReceipt = isOwn &&
                        chatMode === 'direct' &&
                        message.id === lastOwnMsgId &&
                        message.isRead;
                      // Image attachment
                      // An attachment renders ONLY through its http(s)-checked URL; a
                      // row carrying any other scheme shows no media and no link.
                      const attachmentHref = safeAttachmentHref(message.attachmentUrl);
                      const hasImage = !!(attachmentHref && isImageUrl(attachmentHref));
                      const hasAudio = !!(attachmentHref && !hasImage && isAudioUrl(attachmentHref));
                      // Placeholder text shown when a message is media-only — hide it so
                      // the image/voice note is the only thing in the bubble (no "📎 Attachment").
                      const isPlaceholderContent = message.content === '📎 Attachment' || message.content === '🎙️ Voice note';

                      return (
                        <React.Fragment key={message.id}>
                          {showDateSep && (
                            <div className="flex items-center gap-3 py-5">
                              <div className="flex-1 h-px bg-border/50" />
                              <span className="text-[11px] font-semibold text-primary bg-accent-soft px-3 py-1 rounded-full border border-primary/15">{formatDate(message.createdAt)}</span>
                              <div className="flex-1 h-px bg-border/50" />
                            </div>
                          )}
                          {/* New messages divider */}
                          {isFirstUnread && (
                            <div className="flex items-center gap-3 py-2">
                              <div className="flex-1 h-px bg-primary/40" />
                              <span className="text-[10px] font-semibold text-primary bg-primary/8 px-3 py-1 rounded-full border border-primary/20 flex items-center gap-1.5">
                                <Circle className="h-1.5 w-1.5 fill-primary" /> Mesazhe të reja
                              </span>
                              <div className="flex-1 h-px bg-primary/40" />
                            </div>
                          )}
                          <div id={`msg-${message.id}`} className={`flex group ${isOwn ? 'justify-end' : 'justify-start'} ${sameSender ? (compactMode ? 'mt-0' : 'mt-0.5') : (compactMode ? 'mt-1' : 'mt-3')}`}>
                            {/* Avatar — hidden on small screens to save space */}
                            {!isOwn && (
                              <div className="hidden sm:flex flex-shrink-0 mr-2 self-end mb-5">
                                {!sameSender ? (
                                  <div className="h-7 w-7 rounded-full bg-brand-gradient flex items-center justify-center shadow-sm">
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

                              {/* Reply preview — tap to jump to the original message */}
                              {(message as any).replyToContent && (
                                <button
                                  type="button"
                                  onClick={() => jumpToMessage((message as any).replyToId)}
                                  title="Shko te mesazhi origjinal"
                                  className={`text-[11px] px-3 py-1.5 mb-1 rounded-xl max-w-full border-l-2 block w-full text-left transition-colors cursor-pointer ${
                                    isOwn ? 'bg-white/15 border-white/50 hover:bg-white/25' : 'bg-muted/50 border-primary/30 hover:bg-muted'
                                  }`}
                                >
                                  <span className={`font-semibold text-[10px] ${isOwn ? 'text-white' : 'text-primary'}`}>{(message as any).replyToSender}</span>
                                  <p className="truncate opacity-70 mt-0.5">{(message as any).replyToContent}</p>
                                </button>
                              )}

                              {/* Bubble — long-press (mobile) opens the action sheet; on
                                  mobile text isn't selectable and the native callout is
                                  suppressed so the press feels like a native app. Desktop
                                  keeps text selection + the hover toolbar unchanged. */}
                              <div
                                onTouchStart={() => { if (!isDeleted && !isEditing) startLongPress(message.id); }}
                                onTouchEnd={cancelLongPress}
                                onTouchMove={cancelLongPress}
                                onTouchCancel={cancelLongPress}
                                onContextMenu={(e) => { if (!isDeleted && !isEditing) e.preventDefault(); }}
                                className={`relative select-none sm:select-text [-webkit-touch-callout:none] ${(hasImage || hasAudio) && isPlaceholderContent ? 'p-1.5' : 'px-4 py-2.5'} ${
                                isOwn
                                  ? 'bg-accent-gradient text-white rounded-2xl rounded-br-md shadow-[0_6px_16px_-8px_rgba(14,165,233,0.6)]'
                                  : 'bg-card text-foreground border border-border rounded-2xl rounded-tl-md shadow-sm'
                              } ${isDeleted ? 'opacity-30 italic pointer-events-none select-none' : ''} ${mentionsMe ? 'ring-2 ring-yellow-400/60 dark:ring-yellow-500/40' : ''} ${isPinned ? 'shadow-md' : ''}`}>
                                {isPinned && !isDeleted && (
                                  <div className={`absolute -top-2 ${isOwn ? 'left-2' : 'right-2'} flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[9px] font-semibold border border-amber-300/40`}>
                                    <Pin className="h-2.5 w-2.5" /> I fiksuar
                                  </div>
                                )}
                                {isEditing ? (
                                  <div className="flex gap-1.5 items-center min-w-[160px]">
                                    <Input
                                      value={editText}
                                      onChange={e => setEditText(e.target.value)}
                                      className="h-7 text-xs bg-background text-foreground rounded-lg"
                                      autoFocus
                                      onKeyDown={e => {
                                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditMessage(message.id); }
                                        if (e.key === 'Escape') { setEditingMessageId(null); setEditText(''); }
                                      }}
                                    />
                                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleEditMessage(message.id)}>
                                      <Check className="h-3 w-3" />
                                    </Button>
                                  </div>
                                ) : (!isPlaceholderContent || (!hasImage && !hasAudio)) ? (
                                  <p className="text-[13.5px] leading-relaxed break-words whitespace-pre-wrap">
                                    {renderMessageBody(message.content, searchQuery)}
                                  </p>
                                ) : null}

                                {/* #22 Inline translation */}
                                {!isEditing && translations[message.id] && (
                                  <div className={`mt-1.5 pt-1.5 border-t ${isOwn ? 'border-primary-foreground/20' : 'border-border/40'} text-[12.5px] italic opacity-90 leading-relaxed whitespace-pre-wrap break-words flex items-start gap-1.5`}>
                                    <Languages className="h-3 w-3 mt-0.5 flex-shrink-0 opacity-70" />
                                    <span className="flex-1">{translations[message.id]}</span>
                                  </div>
                                )}

                                {/* Inline audio (voice note) preview */}
                                {attachmentHref && hasAudio && (
                                  <audio controls src={attachmentHref} className="mt-2 max-w-[240px] h-9" preload="metadata" />
                                )}

                                {/* Inline image preview */}
                                {attachmentHref && hasImage && (
                                  <a href={attachmentHref} target="_blank" rel="noopener noreferrer" className={`block ${isPlaceholderContent ? '' : 'mt-2'}`}>
                                    <img
                                      src={attachmentHref}
                                      alt="attachment"
                                      loading="lazy"
                                      decoding="async"
                                      className="max-w-[260px] max-h-[280px] rounded-xl object-contain bg-white border border-black/5 hover:opacity-90 transition-opacity"
                                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget.nextElementSibling as HTMLElement | null)?.removeAttribute('hidden'); }}
                                    />
                                    <span hidden className="inline-flex items-center gap-1.5 text-xs mt-1">
                                      <ImageIcon className="h-3 w-3" /> Shiko foton
                                    </span>
                                  </a>
                                )}
                                {/* Non-image / non-audio attachment */}
                                {attachmentHref && !hasImage && !hasAudio && (
                                  <a href={attachmentHref} target="_blank" rel="noopener noreferrer"
                                    className={`inline-flex items-center gap-1.5 text-xs mt-2 px-2.5 py-1 rounded-lg transition-colors ${
                                      isOwn ? 'bg-primary-foreground/15 hover:bg-primary-foreground/25' : 'bg-background hover:bg-accent text-primary'
                                    }`}>
                                    <FileIcon className="h-3 w-3" /><span className="truncate max-w-[140px]">{getFilename(attachmentHref)}</span>
                                  </a>
                                )}

                                {/* Time inside bubble — WhatsApp style */}
                                {!isEditing && (
                                  <div className={`flex items-center gap-1 mt-1.5 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                                    <span
                                      className={`text-[10px] flex items-center gap-1 ${isOwn ? 'text-white/80' : 'text-muted-foreground/60'}`}
                                      title={new Date(message.createdAt).toLocaleString('sq-AL', { dateStyle: 'full', timeStyle: 'short' })}
                                    >
                                      {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                      {(message as any).editedAt && (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); setEditHistoryMessageId(message.id); }}
                                          className="opacity-80 hover:opacity-100 hover:underline cursor-pointer"
                                          title="Shiko historikun e ndryshimeve"
                                        >
                                          {' '}· ndryshuar
                                        </button>
                                      )}
                                      {isOwn && !isGroupChannel && <Check className="h-2.5 w-2.5 opacity-70" />}
                                      {isOwn && isGroupChannel && (() => {
                                        const gm = (getChannelMeta(activeChannel)?.group?.members || []).filter((uid: string) => uid !== user?.uid);
                                        const readers = ((message as any).readBy || []).filter((uid: string) => uid !== user?.uid && gm.includes(uid));
                                        const allRead = gm.length > 0 && readers.length >= gm.length;
                                        return (
                                          <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); setReadReceiptFor(message.id); }}
                                            className="inline-flex items-center gap-0.5 hover:opacity-100"
                                            title="Kush e ka lexuar"
                                          >
                                            <CheckCheck className={`h-3 w-3 ${allRead ? 'text-sky-400' : 'opacity-60'}`} />
                                            {gm.length > 0 && <span className="text-[9px]">{readers.length}/{gm.length}</span>}
                                          </button>
                                        );
                                      })()}
                                      {isOwn && isClientChannel && (message as any).readAt && (
                                        <span className="opacity-80 text-[9px]">
                                          · Parë {(() => { const d = (message as any).readAt?.toDate?.() ?? (message as any).readAt; return d instanceof Date ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; })()}
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                )}

                                {/* Hover actions — desktop only (hidden on mobile; the mobile quick-actions row below handles touch, so the emoji picker isn't duplicated) */}
                                {!isDeleted && !isEditing && (
                                  <div className={`absolute -top-9 ${isOwn ? 'right-1' : 'left-1'} hidden sm:flex opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-all items-center flex-nowrap whitespace-nowrap bg-background border rounded-xl shadow-lg px-1 py-0.5 z-20 gap-0.5`}>
                                    <div className="relative">
                                      <button className="p-1 hover:bg-accent rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                                        aria-label="Reago me emoji" title="Reago"
                                        onClick={() => setShowEmojiPicker(showEmojiPicker === message.id ? null : message.id)}>
                                        <SmilePlus className="h-3.5 w-3.5" />
                                      </button>
                                      {showEmojiPicker === message.id && (
                                        <div className={`absolute bottom-full ${isOwn ? 'left-0' : 'right-0'} mb-1 flex flex-wrap gap-0.5 bg-popover border rounded-xl shadow-lg px-2 py-1.5 z-50 max-w-[200px]`}>
                                          {EMOJI_REACTIONS.map(emoji => (
                                            <button key={emoji} onClick={() => handleReaction(message.id, emoji)} className="hover:scale-125 transition-transform p-2 sm:p-0.5 text-xl sm:text-base">{emoji}</button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <button className="p-1 hover:bg-accent rounded-lg text-muted-foreground hover:text-foreground transition-colors" aria-label="Përgjigju" title="Përgjigju" onClick={() => setReplyingTo(message)}>
                                      <Reply className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      className={`p-1 hover:bg-accent rounded-lg transition-colors ${bookmarkedMessageIds.has(message.id) ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'}`}
                                      onClick={() => handleToggleBookmark(message)}
                                      aria-label={bookmarkedMessageIds.has(message.id) ? 'Hiq nga të ruajturat' : 'Ruaj për më vonë'}
                                      aria-pressed={bookmarkedMessageIds.has(message.id)}
                                      title={bookmarkedMessageIds.has(message.id) ? 'Hiq nga të ruajturat' : 'Ruaj për më vonë'}
                                    >
                                      {bookmarkedMessageIds.has(message.id) ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
                                    </button>
                                    <button
                                      className="p-1 hover:bg-accent rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                                      onClick={() => openTaskFromMessage(message)}
                                      aria-label="Krijo detyrë nga ky mesazh"
                                      title="Krijo detyrë nga ky mesazh"
                                    >
                                      <ListChecks className="h-3.5 w-3.5" />
                                    </button>
                                    <div className="relative">
                                      <button
                                        className="p-1 hover:bg-accent rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                                        onClick={() => setReminderPickerFor(reminderPickerFor === message.id ? null : message.id)}
                                        aria-label="Kujtomë për këtë mesazh"
                                        title="Kujtomë për këtë mesazh"
                                      >
                                        <BellRing className="h-3.5 w-3.5" />
                                      </button>
                                      {reminderPickerFor === message.id && (
                                        <div className={`absolute bottom-full ${isOwn ? 'left-0' : 'right-0'} mb-1 bg-popover border rounded-xl shadow-lg py-1 z-50 min-w-[160px]`}>
                                          {[
                                            { label: 'Pas 15 minutash', m: 15 },
                                            { label: 'Pas 1 ore', m: 60 },
                                            { label: 'Pas 3 orësh', m: 180 },
                                            { label: 'Nesër', m: 60 * 24 },
                                            { label: 'Javën tjetër', m: 60 * 24 * 7 },
                                          ].map(opt => (
                                            <button
                                              key={opt.m}
                                              onClick={() => scheduleReminder(message, opt.m)}
                                              className="block w-full text-left px-3 py-1.5 text-xs hover:bg-accent text-foreground"
                                            >
                                              <AlarmClock className="inline h-3 w-3 mr-1.5 text-muted-foreground" />{opt.label}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <button
                                      className={`p-1 hover:bg-accent rounded-lg transition-colors ${isPinned ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'}`}
                                      onClick={() => handleTogglePin(message)}
                                      aria-label={isPinned ? 'Hiq fiksimin' : 'Fikso mesazhin'}
                                      aria-pressed={isPinned}
                                      title={isPinned ? 'Hiq fiksimin' : 'Fikso mesazhin'}
                                    >
                                      {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                                    </button>
                                    <button
                                      className="p-1 hover:bg-accent rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                                      aria-label="Kopjo mesazhin"
                                      title="Kopjo"
                                      onClick={() => {
                                        navigator.clipboard.writeText(message.content).catch(() => {});
                                        setCopiedMsgId(message.id);
                                        setTimeout(() => setCopiedMsgId(null), 1500);
                                      }}
                                    >
                                      {copiedMsgId === message.id
                                        ? <CheckCheck className="h-3.5 w-3.5 text-emerald-500" />
                                        : <Copy className="h-3.5 w-3.5" />}
                                    </button>
                                    <button
                                      className={`p-1 hover:bg-accent rounded-lg transition-colors ${translations[message.id] ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                                      onClick={() => handleTranslateMessage(message.id, message.content)}
                                      disabled={translatingId === message.id}
                                      aria-label={translations[message.id] ? 'Fshih përkthimin' : 'Përkthe me AI'}
                                      title={translations[message.id] ? 'Fshih përkthimin' : 'Përkthe me AI'}
                                    >
                                      {translatingId === message.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
                                    </button>
                                    {isOwn && (
                                      <>
                                        <button className="p-1 hover:bg-accent rounded-lg text-muted-foreground hover:text-foreground transition-colors" aria-label="Modifiko mesazhin" title="Modifiko" onClick={() => { setEditingMessageId(message.id); setEditText(message.content); }}>
                                          <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                        <button className="p-1 hover:bg-destructive/10 rounded-lg text-muted-foreground hover:text-destructive transition-colors" aria-label="Fshij mesazhin" title="Fshij" onClick={() => handleDeleteMessage(message.id)}>
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* DM read receipt under last own message */}
                              {showReadReceipt && (
                                <div className={`flex items-center gap-1 mt-0.5 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                                  <CheckCheck className="h-3 w-3 text-primary" />
                                  <span className="text-[9px] text-primary/70">Lexuar</span>
                                </div>
                              )}

                              {/* Mobile long-press action sheet — replaces the old
                                  always-visible quick-actions row. Opened by long-pressing
                                  the bubble (see startLongPress on the bubble above) and
                                  rendered in a portal on document.body so it can't be
                                  clipped by the chat's overflow/scroll containers. Only
                                  one is ever open (keyed by longPressMenuId). sm:hidden →
                                  mobile only; desktop keeps its hover toolbar. */}
                              {longPressMenuId === message.id && !isDeleted && !isEditing && createPortal(
                                <div className="sm:hidden" role="dialog" aria-modal="true">
                                  {/* Backdrop — tap anywhere to dismiss */}
                                  <div
                                    className="fixed inset-0 z-[60] bg-black/50 animate-in fade-in duration-150 motion-reduce:animate-none"
                                    onClick={() => setLongPressMenuId(null)}
                                  />
                                  {/* Slide-up sheet */}
                                  <div
                                    className="fixed inset-x-0 bottom-0 z-[61] bg-popover border-t rounded-t-2xl shadow-2xl animate-in slide-in-from-bottom duration-200 motion-reduce:animate-none"
                                    style={{ paddingBottom: 'var(--safe-area-bottom)' }}
                                  >
                                    {/* Grab handle */}
                                    <div className="flex justify-center pt-2 pb-1">
                                      <div className="h-1 w-9 rounded-full bg-muted-foreground/25" />
                                    </div>
                                    {/* Quick emoji reactions */}
                                    <div className="flex justify-around px-3 py-2 border-b border-border/60">
                                      {EMOJI_REACTIONS.map(emoji => (
                                        <button
                                          key={emoji}
                                          className="text-2xl p-1.5 rounded-full active:scale-125 transition-transform"
                                          onClick={() => { handleReaction(message.id, emoji); setLongPressMenuId(null); }}
                                        >
                                          {emoji}
                                        </button>
                                      ))}
                                    </div>
                                    {/* Actions (≥48px rows for comfortable touch) */}
                                    <div className="py-1.5">
                                      <button
                                        className="flex items-center gap-3 w-full px-5 py-3 text-[15px] text-foreground active:bg-accent/60 transition-colors"
                                        onClick={() => { setReplyingTo(message); setLongPressMenuId(null); }}
                                      >
                                        <Reply className="h-5 w-5 text-muted-foreground" /> Përgjigju
                                      </button>
                                      <button
                                        className="flex items-center gap-3 w-full px-5 py-3 text-[15px] text-foreground active:bg-accent/60 transition-colors"
                                        onClick={() => {
                                          navigator.clipboard.writeText(message.content).catch(() => {});
                                          setCopiedMsgId(message.id);
                                          setTimeout(() => setCopiedMsgId(null), 1500);
                                          setLongPressMenuId(null);
                                        }}
                                      >
                                        <Copy className="h-5 w-5 text-muted-foreground" /> Kopjo
                                      </button>
                                      {isOwn && (
                                        <>
                                          <button
                                            className="flex items-center gap-3 w-full px-5 py-3 text-[15px] text-foreground active:bg-accent/60 transition-colors"
                                            onClick={() => { setEditingMessageId(message.id); setEditText(message.content); setLongPressMenuId(null); }}
                                          >
                                            <Pencil className="h-5 w-5 text-muted-foreground" /> Modifiko
                                          </button>
                                          <button
                                            className="flex items-center gap-3 w-full px-5 py-3 text-[15px] text-destructive active:bg-destructive/10 transition-colors"
                                            onClick={() => { handleDeleteMessage(message.id); setLongPressMenuId(null); }}
                                          >
                                            <Trash2 className="h-5 w-5" /> Fshij
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>,
                                document.body
                              )}

                              {/* Reactions */}
                              {(message as any).reactions && Object.keys((message as any).reactions).length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1 px-0.5 relative">
                                  {Object.entries((message as any).reactions as Record<string, string[]>).filter(([, users]) => users && users.length > 0).map(([emoji, users]) => {
                                    const names = users.map(u => getUserDisplayName(u)).join(', ');
                                    const showPop = reactionPopover?.msgId === message.id && reactionPopover?.emoji === emoji;
                                    return (
                                      <div key={emoji} className="relative">
                                        <button
                                          onClick={() => handleReaction(message.id, emoji)}
                                          onMouseEnter={() => setReactionPopover({ msgId: message.id, emoji })}
                                          onMouseLeave={() => setReactionPopover(p => p?.msgId === message.id && p?.emoji === emoji ? null : p)}
                                          aria-label={`${emoji}, ${users.length} — ${names}`}
                                          aria-pressed={users.includes(user?.uid || '')}
                                          title={names}
                                          className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                                            users.includes(user?.uid || '') ? 'bg-primary/10 border-primary/30 font-semibold' : 'bg-background border-border hover:border-primary/30'
                                          }`}>
                                          {emoji} <span className="text-[10px]">{users.length}</span>
                                        </button>
                                        {showPop && (
                                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-30 px-2 py-1 rounded-lg bg-popover border shadow-lg text-[10px] whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis">
                                            {names}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
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
                      {searchQuery
                        ? 'Nuk u gjet asnjë mesazh'
                        : chatMode === 'direct' && !activeDirectUserId
                          ? 'Zgjidh një person'
                          : chatMode === 'channel' && !activeChannel.startsWith('client-') && !getChannelMeta(activeChannel)
                            ? 'Zgjidh një grup ose bisedë nga lista'
                            : 'Fillo bisedën!'}
                    </p>
                    {!searchQuery && chatMode === 'channel' && (getChannelMeta(activeChannel)?.isGroup || activeChannel.startsWith('client-')) && <p className="text-xs text-muted-foreground/40 mt-1">Shkruaj mesazhin e parë</p>}
                  </div>
                )}
                {/* Bottom sentinel for jump-to-bottom detection */}
                <div ref={bottomSentinelRef} className="h-1 w-full" />
              </div>
            </ScrollArea>

            {/* Jump-to-bottom floating button */}
            {showJumpToBottom && (chatMode === 'channel' || chatMode === 'direct') && (
              <button
                onClick={() => {
                  const vp = getScroller(scrollRef.current);
                  if (vp) vp.scrollTop = vp.scrollHeight;
                  setShowJumpToBottom(false);
                }}
                aria-label="Shko te mesazhi i fundit"
                title="Shko poshtë"
                className="absolute bottom-4 right-5 z-20 h-9 w-9 rounded-full bg-background border shadow-lg flex items-center justify-center hover:bg-accent transition-colors"
              >
                {currentConvUnread > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-bold">
                    {currentConvUnread > 9 ? '9+' : currentConvUnread}
                  </span>
                )}
                <ChevronDown className="h-5 w-5 text-foreground" />
              </button>
            )}
            </div>

            {/* Typing indicator */}
            {activeTypingUsers.length > 0 && (
              <div className="px-3 sm:px-5 py-1.5 text-xs text-muted-foreground flex items-center gap-2 border-t bg-muted/10">
                <span className="flex gap-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/70 animate-bounce motion-reduce:animate-none [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/70 animate-bounce motion-reduce:animate-none [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/70 animate-bounce motion-reduce:animate-none" />
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

            {/* Message Input — hidden when no group/conversation is selected */}
            {!channelHasNoSelection && (
            <div className="px-4 pt-2 border-t bg-background" style={{ paddingBottom: 'max(12px, var(--safe-area-bottom))' }}>
              {showAttachmentInput && (
                <div className="flex gap-2 items-center px-3 py-1.5 mb-2 bg-muted/30 rounded-xl border">
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <Input value={attachmentUrl} onChange={e => setAttachmentUrl(e.target.value)} placeholder="Ngjit URL skedarit..." disabled={isSending}
                    className="h-8 text-base sm:h-7 sm:text-xs border-0 bg-transparent focus-visible:ring-0 shadow-none" />
                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={() => { setShowAttachmentInput(false); setAttachmentUrl(''); }}><X className="h-3 w-3" /></Button>
                </div>
              )}
              <form onSubmit={(e) => handleSendMessage(e)}>
                {/* Pending scheduled messages banner */}
                {pendingScheduledForCurrent.length > 0 && (
                  <div className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 text-xs">
                    <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                    <span className="text-amber-700 dark:text-amber-300 truncate flex-1">
                      {pendingScheduledForCurrent.length} mesazh{pendingScheduledForCurrent.length === 1 ? '' : 'e'} i programuar
                      {pendingScheduledForCurrent[0]?.scheduledAt && ` · ${new Date(pendingScheduledForCurrent[0].scheduledAt).toLocaleString('sq-AL', { dateStyle: 'short', timeStyle: 'short' })}`}
                    </span>
                    <button
                      type="button"
                      className="text-amber-700 dark:text-amber-300 hover:underline text-xs font-medium"
                      onClick={() => handleCancelScheduled(pendingScheduledForCurrent[0].id)}
                    >
                      Anulo
                    </button>
                  </div>
                )}
                {/* Voice recording overlay */}
                {isRecording && (
                  <div className="flex items-center gap-3 px-3 py-2 mb-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-900/40">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500 animate-pulse motion-reduce:animate-none" />
                    <span className="text-sm font-semibold text-rose-700 dark:text-rose-300">Po regjistron…</span>
                    <span className="text-xs text-rose-600/80 dark:text-rose-300/80 font-mono">
                      {(() => {
                        const m = Math.floor(recordingDuration / 60).toString().padStart(2, '0');
                        const s = (recordingDuration % 60).toString().padStart(2, '0');
                        return `${m}:${s}`;
                      })()}
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <Button type="button" size="sm" variant="ghost" className="h-7 text-xs"
                        onClick={() => stopRecording(false)}>Anulo</Button>
                      <Button type="button" size="sm" className="h-7 text-xs gap-1"
                        onClick={() => stopRecording(true)}>
                        <Send className="h-3 w-3" /> Dërgo
                      </Button>
                    </div>
                  </div>
                )}
                {/* #21 Smart Reply suggestions */}
                {smartReplies.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap mb-2 px-1">
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> Sugjerime AI:
                    </span>
                    {smartReplies.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => { setMessageText(prev => prev ? `${prev} ${s}` : s); setSmartReplies([]); chatTextareaRef.current?.focus(); }}
                        className="text-xs px-2.5 py-1 rounded-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setSmartReplies([])}
                      className="text-[10px] text-muted-foreground hover:text-foreground ml-auto"
                      title="Mbyll sugjerimet"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <div
                  className="flex items-end gap-2 bg-muted/20 border rounded-2xl px-3 py-2 focus-within:border-primary/40 focus-within:bg-background focus-within:shadow-md transition-all relative"
                  onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }}
                  onDrop={async (e) => {
                    const files = Array.from(e.dataTransfer?.files || []);
                    const accepted = files.filter(f => ALLOWED_ATTACHMENT_TYPES.includes(f.type));
                    if (accepted.length === 0) return;
                    e.preventDefault();
                    for (const f of accepted) await handleAttachmentUpload(f);
                  }}
                >
                  {/* @mention autocomplete */}
                  {mentionOpen && mentionCandidates.length > 0 && (
                    <div className="absolute bottom-full left-2 mb-1 z-30 min-w-[200px] max-w-[280px] bg-popover border rounded-xl shadow-lg overflow-hidden">
                      <div className="px-2.5 py-1 text-[10px] font-semibold text-muted-foreground border-b bg-muted/30 flex items-center gap-1">
                        <AtSign className="h-2.5 w-2.5" /> {mentionKind === 'customer' ? 'Përmend një klient' : 'Përmend një anëtar'}
                      </div>
                      <div className="max-h-[200px] overflow-y-auto">
                        {mentionCandidates.map((c, i) => (
                          <button
                            key={c.uid}
                            type="button"
                            onMouseEnter={() => setMentionSelected(i)}
                            onClick={() => insertMention(c.name)}
                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors ${
                              i === mentionSelected ? 'bg-primary/10' : 'hover:bg-accent'
                            }`}
                          >
                            <div className={`h-5 w-5 rounded-md ${getAvatarColor(c.uid)} flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0`}>
                              {c.name.slice(0, 2).toUpperCase()}
                            </div>
                            <span className="truncate">{c.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Slash commands popover */}
                  {slashOpen && slashCandidates.length > 0 && (
                    <div className="absolute bottom-full left-2 mb-1 z-30 min-w-[260px] max-w-[340px] bg-popover border rounded-xl shadow-lg overflow-hidden">
                      <div className="px-2.5 py-1 text-[10px] font-semibold text-muted-foreground border-b bg-muted/30">
                        Komanda
                      </div>
                      <div className="max-h-[240px] overflow-y-auto">
                        {slashCandidates.map((c, i) => (
                          <button
                            key={c.cmd}
                            type="button"
                            onMouseEnter={() => setSlashSelected(i)}
                            onClick={() => executeSlash(c.cmd)}
                            className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs transition-colors ${
                              i === slashSelected ? 'bg-primary/10' : 'hover:bg-accent'
                            }`}
                          >
                            <span className="font-mono font-semibold text-primary">{c.label}</span>
                            <span className="text-[10px] text-muted-foreground truncate">{c.desc}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Composer emoji picker — opened by the "Emoji" button (desktop
                      inline + mobile "+" menu). Inserts at the caret. */}
                  {showEmojiPicker === 'input' && (
                    <div
                      ref={composerEmojiRef}
                      role="dialog"
                      aria-label="Zgjidh një emoji"
                      className="absolute bottom-full left-2 mb-1 z-30 w-[260px] bg-popover border rounded-xl shadow-lg p-2"
                    >
                      <div className="grid grid-cols-8 gap-0.5 max-h-[180px] overflow-y-auto">
                        {COMPOSER_EMOJIS.map((emoji, i) => (
                          <button
                            key={`${emoji}-${i}`}
                            type="button"
                            aria-label={`Fut emoji ${emoji}`}
                            onClick={() => insertEmoji(emoji)}
                            className="text-xl leading-none p-1 rounded-lg hover:bg-accent transition-colors"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-0.5 flex-shrink-0 pb-1">
                    {/* Overflow "+" — secondary actions (snippets, AI polish/replies, schedule) */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" className="h-10 w-10 lg:h-7 lg:w-7 rounded-lg text-muted-foreground/60 hover:text-foreground" disabled={isSending} aria-label="Më shumë opsione" title="Më shumë">
                          <Plus className="h-5 w-5 lg:h-4 lg:w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" side="top" className="w-56">
                        {/* Mobile-only: the inline image/voice/emoji buttons are hidden
                            below lg to give the textarea room, so surface them here. */}
                        <DropdownMenuItem
                          className="lg:hidden"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={
                            isSending || attachmentUploading ||
                            (chatMode === 'channel' && !activeChannel) ||
                            (chatMode === 'direct' && !activeDirectUserId) ||
                            (chatMode !== 'channel' && chatMode !== 'direct')
                          }
                        >
                          {attachmentUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />} <span>Dërgo imazh ose PDF</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="lg:hidden"
                          onClick={() => { if (isRecording) stopRecording(true); else startRecording(); }}
                          disabled={isSending || attachmentUploading}
                        >
                          <Mic className="h-4 w-4" /> <span>Regjistro notë zanore</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="lg:hidden"
                          onClick={() => setShowEmojiPicker(showEmojiPicker ? null : 'input')}
                          disabled={isSending}
                        >
                          <SmilePlus className="h-4 w-4" /> <span>Emoji</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setShowAttachmentInput(!showAttachmentInput); }}>
                          <Link2 className="h-4 w-4" /> <span>Ngjit URL skedari</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setSnippetSearch(''); setSnippetPickerOpen(true); }}>
                          <Zap className="h-4 w-4" /> <span>Përgjigje të ruajtura</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={polishLoading || !messageText.trim()} onClick={handlePolishMessage}>
                          {polishLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} <span>Përmirëso tekstin (AI)</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={smartRepliesLoading} onClick={handleSuggestReplies}>
                          {smartRepliesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} <span>Sugjero përgjigje (AI)</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={(!messageText.trim() && !attachmentUrl.trim()) || chatMode === 'ai'}
                          onClick={() => {
                            const d = new Date(Date.now() + 60 * 60 * 1000);
                            setScheduleDate(d.toISOString().slice(0, 10));
                            setScheduleTime(d.toTimeString().slice(0, 5));
                            setScheduleOpen(true);
                          }}
                        >
                          <CalendarClock className="h-4 w-4" /> <span>Programo mesazhin</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {/* Inline image/voice/emoji — desktop only; on mobile they live in
                        the "+" menu (above) and voice is the right-side mic (below). */}
                    <Button type="button" variant="ghost" size="icon" className="hidden lg:inline-flex h-7 w-7 rounded-lg text-muted-foreground/60 hover:text-foreground"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={
                        isSending ||
                        attachmentUploading ||
                        (chatMode === 'channel' && !activeChannel) ||
                        (chatMode === 'direct' && !activeDirectUserId) ||
                        (chatMode !== 'channel' && chatMode !== 'direct')
                      }
                      aria-label={attachmentUploading ? 'Po ngarkohet' : 'Dërgo imazh ose PDF'}
                      title={attachmentUploading ? 'Po ngarkohet…' : 'Dërgo imazh ose PDF'}>
                      {attachmentUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                    </Button>
                    <Button type="button" variant="ghost" size="icon"
                      className={`hidden lg:inline-flex h-7 w-7 rounded-lg transition-colors ${isRecording ? 'text-rose-500 animate-pulse motion-reduce:animate-none' : 'text-muted-foreground/60 hover:text-foreground'}`}
                      onClick={() => { if (isRecording) stopRecording(true); else startRecording(); }}
                      disabled={isSending || attachmentUploading}
                      aria-label={isRecording ? 'Ndalo dhe dërgo notën zanore' : 'Regjistro një notë zanore'}
                      title={isRecording ? 'Ndalo dhe dërgo' : 'Regjistro një notë zanore'}>
                      {isRecording ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-3.5 w-3.5" />}
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) await handleAttachmentUpload(f);
                      }}
                    />
                    <Button type="button" variant="ghost" size="icon" className="hidden lg:inline-flex h-7 w-7 rounded-lg text-muted-foreground/60 hover:text-foreground"
                      disabled={isSending} onClick={() => setShowEmojiPicker(showEmojiPicker ? null : 'input')}
                      data-emoji-trigger aria-label="Fut emoji" aria-expanded={showEmojiPicker === 'input'} title="Emoji">
                      <SmilePlus className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <textarea
                    ref={chatTextareaRef}
                    value={messageText}
                    onChange={handleTextareaInput}
                    onKeyDown={e => {
                      if (mentionOpen && mentionCandidates.length > 0) {
                        if (e.key === 'ArrowDown') { e.preventDefault(); setMentionSelected(s => (s + 1) % mentionCandidates.length); return; }
                        if (e.key === 'ArrowUp') { e.preventDefault(); setMentionSelected(s => (s - 1 + mentionCandidates.length) % mentionCandidates.length); return; }
                        if (e.key === 'Enter' || e.key === 'Tab') {
                          e.preventDefault();
                          const c = mentionCandidates[mentionSelected] || mentionCandidates[0];
                          if (c) insertMention(c.name);
                          return;
                        }
                        if (e.key === 'Escape') { e.preventDefault(); setMentionOpen(false); return; }
                      }
                      if (slashOpen && slashCandidates.length > 0) {
                        if (e.key === 'ArrowDown') { e.preventDefault(); setSlashSelected(s => (s + 1) % slashCandidates.length); return; }
                        if (e.key === 'ArrowUp') { e.preventDefault(); setSlashSelected(s => (s - 1 + slashCandidates.length) % slashCandidates.length); return; }
                        if (e.key === 'Enter' || e.key === 'Tab') {
                          e.preventDefault();
                          const c = slashCandidates[slashSelected] || slashCandidates[0];
                          if (c) executeSlash(c.cmd);
                          return;
                        }
                        if (e.key === 'Escape') { e.preventDefault(); setSlashOpen(false); return; }
                      }
                      // Desktop: Enter sends, Shift+Enter breaks the line. Touch
                      // keyboards: Enter breaks the line (there is no Shift), the
                      // send button sends. IME composition Enter never sends.
                      if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as any)?.isComposing && !isCoarsePointer()) {
                        e.preventDefault(); handleSendMessage(e as any);
                      }
                    }}
                    onPaste={async (e) => {
                      const items = e.clipboardData?.items;
                      if (!items) return;
                      for (let i = 0; i < items.length; i++) {
                        const it = items[i];
                        if (it.kind === 'file' && it.type.startsWith('image/')) {
                          const f = it.getAsFile();
                          if (!f) continue;
                          e.preventDefault();
                          await handleAttachmentUpload(f);
                          return;
                        }
                      }
                    }}
                    placeholder={`Shkruaj${chatMode === 'channel' ? ` në ${getChannelMeta(activeChannel)?.isGroup ? '' : '#'}${getChannelMeta(activeChannel)?.name || activeChannel}` : ` te ${getUserDisplayName(activeDirectUserId || '')}`}...`}
                    disabled={isSending}
                    rows={1}
                    className="flex-1 min-w-0 bg-transparent border-0 outline-none text-base sm:text-sm resize-none py-1.5 placeholder:text-muted-foreground/40 max-h-[120px]"
                  />

                  {/* MOBILE right control — WhatsApp pattern: mic when the field is
                      empty, Send once there's text. Desktop (lg+) always shows Send
                      (its voice mic lives inline on the left). */}
                  <Button
                    type="button"
                    size="icon"
                    onClick={() => { if (isRecording) stopRecording(true); else startRecording(); }}
                    disabled={isSending || attachmentUploading}
                    aria-label={isRecording ? 'Ndalo dhe dërgo notën zanore' : 'Regjistro një notë zanore'}
                    title={isRecording ? 'Ndalo dhe dërgo' : 'Regjistro një notë zanore'}
                    className={`lg:hidden ${messageText.trim() || attachmentUrl.trim() ? 'hidden' : 'flex'} h-11 w-11 rounded-[13px] flex-shrink-0 transition-all ${
                      isRecording ? 'bg-rose-500 text-white animate-pulse motion-reduce:animate-none' : 'bg-muted text-muted-foreground/70 hover:text-foreground'
                    }`}
                  >
                    {isRecording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" />}
                  </Button>
                  <Button
                    type="submit"
                    size="icon"
                    className={`${messageText.trim() || attachmentUrl.trim() ? 'flex' : 'hidden'} lg:flex h-11 w-11 rounded-[13px] flex-shrink-0 transition-all ${
                      messageText.trim() || attachmentUrl.trim() ? 'bg-accent-gradient text-white shadow-[0_8px_18px_-8px_#0EA5E9] hover:opacity-95' : 'bg-muted text-muted-foreground/40'
                    }`}
                    disabled={isSending || (!messageText.trim() && !attachmentUrl.trim()) || (chatMode === 'direct' && !activeDirectUserId)}
                    aria-label="Dërgo mesazhin"
                    title="Dërgo"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </form>
              <div className="hidden sm:flex items-center justify-between mt-1.5 px-1">
                <p className="text-[10px] text-muted-foreground/60">Enter për të dërguar · Shift+Enter për rresht të ri</p>
                <button
                  type="button"
                  aria-label="Krijo detyrë nga ky tekst"
                  title="Krijo detyrë nga ky tekst"
                  onClick={() => {
                    setTaskFromMsgSource(null);
                    setTaskFromMsgTitle(messageText.trim().slice(0, 120));
                    setTaskFromMsgAssignee(user?.uid || '');
                    setTaskFromMsgDueDate('');
                    setTaskFromMsgPriority('medium');
                    setTaskFromMsgOpen(true);
                  }}
                  className="text-[10px] text-muted-foreground/30 hover:text-primary transition-colors flex items-center gap-1"
                >
                  <Link2 className="h-2.5 w-2.5" /> Lidh me task
                </button>
              </div>
              {messageMutation.error && <p className="text-xs text-destructive mt-1">{messageMutation.error.message}</p>}
            </div>
            )}
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

      {/* Krijo Detyrë nga Mesazhi */}
      <Dialog open={taskFromMsgOpen} onOpenChange={setTaskFromMsgOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base"><ListChecks className="h-4 w-4" /> Krijo detyrë nga mesazhi</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Titulli</Label>
              <Input value={taskFromMsgTitle} onChange={(e) => setTaskFromMsgTitle(e.target.value)} placeholder="Titulli i detyrës..." className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Caktuar</Label>
                <Select value={taskFromMsgAssignee} onValueChange={setTaskFromMsgAssignee}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Zgjidh..." /></SelectTrigger>
                  <SelectContent>
                    {teamMembers?.map(m => (
                      <SelectItem key={m.userId} value={m.userId}>{m.displayName || m.email || 'Pa emër'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Prioriteti</Label>
                <Select value={taskFromMsgPriority} onValueChange={(v) => setTaskFromMsgPriority(v as any)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">I ulët</SelectItem>
                    <SelectItem value="medium">Mesatar</SelectItem>
                    <SelectItem value="high">I lartë</SelectItem>
                    <SelectItem value="urgent">Urgjent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Afati (opsional)</Label>
              <Input type="date" value={taskFromMsgDueDate} onChange={(e) => setTaskFromMsgDueDate(e.target.value)} className="mt-1" />
            </div>
            {taskFromMsgSource && (
              <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-2 max-h-24 overflow-y-auto">
                <span className="font-medium">Burimi: </span>
                {(taskFromMsgSource.content || '').slice(0, 200).replace(/<[^>]+>/g, '')}
                {(taskFromMsgSource.content || '').length > 200 ? '…' : ''}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setTaskFromMsgOpen(false)}>Anulo</Button>
              <Button size="sm" onClick={handleCreateTaskFromMessage} disabled={taskMutation.loading || !taskFromMsgTitle.trim()}>
                {taskMutation.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                Krijo Detyrën
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Saved Replies / Snippets picker */}
      <Dialog open={snippetPickerOpen} onOpenChange={setSnippetPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base"><Zap className="h-4 w-4" /> Përgjigje të ruajtura</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={snippetSearch}
              onChange={(e) => setSnippetSearch(e.target.value)}
              placeholder="Kërko shkurtore ose tekst..."
              className="h-9"
            />
            <div className="max-h-[260px] overflow-y-auto space-y-1.5 -mx-1 px-1">
              {filteredSnippets.length === 0 && (
                <div className="text-xs text-muted-foreground py-6 text-center">
                  {snippets && snippets.length === 0 ? 'Asnjë përgjigje e ruajtur. Krijo një më poshtë.' : 'Asnjë rezultat.'}
                </div>
              )}
              {filteredSnippets.map((s: any) => (
                <div key={s.id} className="group flex items-start gap-2 p-2 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                  <button type="button" className="flex-1 text-left min-w-0" onClick={() => insertSnippet(s.content)}>
                    {s.shortcut && (
                      <div className="text-[10px] font-mono font-semibold text-primary mb-0.5">/{s.shortcut}</div>
                    )}
                    <div className="text-xs text-foreground/90 whitespace-pre-wrap break-words line-clamp-3">{s.content}</div>
                  </button>
                  {s.createdByUserId === user?.uid && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100"
                      onClick={() => handleDeleteSnippet(s.id)}
                      title="Fshi">
                      <Trash2 className="h-3 w-3 text-rose-500" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <Separator />
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">Krijo përgjigje të re</div>
              <Input
                value={newSnippetShortcut}
                onChange={(e) => setNewSnippetShortcut(e.target.value)}
                placeholder="Shkurtore (p.sh. faleminderit)"
                className="h-8 text-xs"
              />
              <Textarea
                value={newSnippetContent}
                onChange={(e) => setNewSnippetContent(e.target.value)}
                placeholder="Teksti i përgjigjes..."
                rows={3}
                className="text-xs resize-none"
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={handleCreateSnippet} disabled={snippetMutation.loading || !newSnippetContent.trim()}>
                  {snippetMutation.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                  Ruaj
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Summary of conversation */}
      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> Përmbledhje e bisedës
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {summaryLoading && (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Po analizoj bisedën...
              </div>
            )}
            {!summaryLoading && summaryText && (
              <div className="text-sm whitespace-pre-wrap text-foreground/90 leading-relaxed max-h-[60vh] overflow-y-auto rounded-lg bg-muted/30 p-3 border">
                {summaryText}
              </div>
            )}
            {!summaryLoading && summaryText && (
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { void copyWithToast(summaryText, toast); }}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> Kopjo
                </Button>
                <Button variant="outline" size="sm" onClick={handleSummarizeChat}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" /> Rigjenero
                </Button>
                <Button size="sm" onClick={() => setSummaryOpen(false)}>Mbyll</Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* #4 Schedule message dialog */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-primary" /> Programo mesazhin
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Pas 1 ore', m: 60 },
                { label: 'Pas 3 orësh', m: 180 },
                { label: 'Nesër 09:00', custom: 'tomorrow9' },
                { label: 'Të hënën 09:00', custom: 'mon9' },
              ].map(opt => (
                <Button
                  key={opt.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  onClick={() => {
                    let when = Date.now();
                    if (opt.m) when += opt.m * 60 * 1000;
                    else if (opt.custom === 'tomorrow9') {
                      const d = new Date();
                      d.setDate(d.getDate() + 1);
                      d.setHours(9, 0, 0, 0);
                      when = d.getTime();
                    } else if (opt.custom === 'mon9') {
                      const d = new Date();
                      const diff = (8 - d.getDay()) % 7 || 7;
                      d.setDate(d.getDate() + diff);
                      d.setHours(9, 0, 0, 0);
                      when = d.getTime();
                    }
                    handleScheduleMessage(when);
                  }}
                >
                  <AlarmClock className="h-3.5 w-3.5 mr-1.5" />{opt.label}
                </Button>
              ))}
            </div>
            <div className="border-t pt-3">
              <Label className="text-xs text-muted-foreground">Ose zgjidh datën dhe orën</Label>
              <div className="flex gap-2 mt-1.5">
                <Input
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="flex-1"
                />
                <Input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="w-32"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setScheduleOpen(false)}>Anulo</Button>
              <Button
                size="sm"
                disabled={!scheduleDate || !scheduleTime}
                onClick={() => {
                  const when = new Date(`${scheduleDate}T${scheduleTime}`).getTime();
                  if (isNaN(when) || when <= Date.now()) {
                    toast({ title: 'Koha e pavlefshme', description: 'Zgjidh një kohë në të ardhmen', variant: 'destructive' });
                    return;
                  }
                  handleScheduleMessage(when);
                }}
              >
                <CalendarClock className="h-3.5 w-3.5 mr-1" /> Programo
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* #45 Custom status dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Statusi im</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                { emoji: '🤝', text: 'Në mbledhje', h: 1 },
                { emoji: '🍽️', text: 'Në drekë', h: 1 },
                { emoji: '🎧', text: 'Fokus i thellë', h: 3 },
                { emoji: '🏖️', text: 'Jashtë zyre', h: 8 },
                { emoji: '🤒', text: 'I sëmurë sot', h: 24 },
                { emoji: '✈️', text: 'Në udhëtim', h: 24 },
              ].map(p => (
                <Button
                  key={p.text}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start text-xs"
                  onClick={() => handleSetMyStatus(p.emoji, p.text, p.h)}
                >
                  <span className="text-base mr-1.5">{p.emoji}</span>{p.text}
                </Button>
              ))}
            </div>
            <div className="border-t pt-3 space-y-2">
              <Label className="text-xs text-muted-foreground">Status i personalizuar</Label>
              <div className="flex gap-2">
                <Input
                  value={statusEmojiInput}
                  onChange={(e) => setStatusEmojiInput(e.target.value.slice(0, 2))}
                  className="w-14 text-center text-lg"
                  maxLength={2}
                />
                <Input
                  value={statusTextInput}
                  onChange={(e) => setStatusTextInput(e.target.value.slice(0, 60))}
                  placeholder="Çfarë po bën?"
                  className="flex-1"
                  maxLength={60}
                />
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Label className="text-muted-foreground">Skadon pas:</Label>
                <Select value={String(statusHoursInput)} onValueChange={(v) => setStatusHoursInput(Number(v))}>
                  <SelectTrigger className="h-8 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 orë</SelectItem>
                    <SelectItem value="2">2 orë</SelectItem>
                    <SelectItem value="4">4 orë</SelectItem>
                    <SelectItem value="8">8 orë</SelectItem>
                    <SelectItem value="24">24 orë</SelectItem>
                    <SelectItem value="0">Pa skadim</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={() => handleSetMyStatus(null, null, 0)}>
                Pastro statusin
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setStatusDialogOpen(false)}>Anulo</Button>
                <Button
                  size="sm"
                  disabled={!statusTextInput.trim() && !statusEmojiInput.trim()}
                  onClick={() => handleSetMyStatus(statusEmojiInput || '💬', statusTextInput, statusHoursInput)}
                >
                  Cakto
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* #42 Edit history viewer */}
      <Dialog open={!!editHistoryMessageId} onOpenChange={(o) => !o && setEditHistoryMessageId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Historiku i ndryshimeve</DialogTitle>
          </DialogHeader>
          {(() => {
            const m = messages?.find(x => x.id === editHistoryMessageId) as any;
            if (!m) return <p className="text-sm text-muted-foreground">Nuk u gjet.</p>;
            const history: any[] = Array.isArray(m.editHistory) ? m.editHistory : [];
            const fmt = (d: any) => {
              const dt = d?.toDate?.() ?? d;
              return dt instanceof Date ? dt.toLocaleString('sq-AL') : '';
            };
            return (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                <div className="rounded-lg border p-3 bg-primary/5">
                  <div className="text-[10px] text-muted-foreground mb-1">Aktual {m.editedAt ? `· ${fmt(m.editedAt)}` : ''}</div>
                  <div className="text-sm whitespace-pre-wrap break-words">{m.content}</div>
                </div>
                {history.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nuk ka versione të mëparshme të ruajtura.</p>
                )}
                {[...history].reverse().map((h, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <div className="text-[10px] text-muted-foreground mb-1">Version i mëparshëm {h.editedAt ? `· ${fmt(h.editedAt)}` : ''}</div>
                    <div className="text-sm whitespace-pre-wrap break-words opacity-80">{h.content}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Group read receipts — who has read this message and who hasn't */}
      <Dialog open={!!readReceiptFor} onOpenChange={(o) => !o && setReadReceiptFor(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <CheckCheck className="h-4 w-4 text-sky-500" /> Lexuar nga
            </DialogTitle>
          </DialogHeader>
          {(() => {
            const m = messages?.find(x => x.id === readReceiptFor) as any;
            if (!m) return <p className="text-sm text-muted-foreground">Nuk u gjet.</p>;
            const gmembers = (getChannelMeta(activeChannel)?.group?.members || []).filter((uid: string) => uid !== m.senderId);
            const readBy: string[] = Array.isArray(m.readBy) ? m.readBy : [];
            const read = gmembers.filter((uid: string) => readBy.includes(uid));
            const unread = gmembers.filter((uid: string) => !readBy.includes(uid));
            const Row = ({ uid, seen }: { uid: string; seen: boolean }) => (
              <div className="flex items-center gap-2 py-1.5">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-semibold text-primary flex-shrink-0">
                  {getUserDisplayName(uid).slice(0, 2).toUpperCase()}
                </div>
                <span className="text-sm truncate flex-1">{getUserDisplayName(uid)}</span>
                {seen ? <CheckCheck className="h-4 w-4 text-sky-500 flex-shrink-0" /> : <Check className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />}
              </div>
            );
            return (
              <div className="max-h-[60vh] overflow-y-auto">
                <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mt-1 mb-0.5">Lexuar · {read.length}</div>
                {read.length === 0 && <p className="text-xs text-muted-foreground py-1">Askush ende.</p>}
                {read.map(uid => <Row key={uid} uid={uid} seen />)}
                <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mt-3 mb-0.5">Pa lexuar · {unread.length}</div>
                {unread.length === 0 && <p className="text-xs text-muted-foreground py-1">Të gjithë e kanë lexuar 🎉</p>}
                {unread.map(uid => <Row key={uid} uid={uid} seen={false} />)}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* #24 Action extraction dialog */}
      <Dialog open={actionExtractOpen} onOpenChange={setActionExtractOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <ListChecks className="h-4 w-4" /> Detyra të propozuara nga AI
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {actionExtractLoading && (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Po analizoj bisedën...
              </div>
            )}
            {!actionExtractLoading && proposedActions.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">Nuk u gjetën detyra konkrete në bisedë.</p>
            )}
            {!actionExtractLoading && proposedActions.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground">Zgjidh detyrat që do të krijohen:</p>
                <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                  {proposedActions.map((a, i) => (
                    <div key={i} className={`rounded-lg border p-2.5 transition-colors ${a.selected ? 'bg-primary/5 border-primary/30' : 'bg-muted/30'}`}>
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={a.selected}
                          onChange={(e) => setProposedActions(prev => prev.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))}
                          className="mt-1"
                        />
                        <div className="flex-1 space-y-1.5">
                          <Input
                            value={a.title}
                            onChange={(e) => setProposedActions(prev => prev.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                            className="h-8 text-sm"
                          />
                          <div className="flex items-center gap-2 text-xs">
                            <Select
                              value={a.priority}
                              onValueChange={(v) => setProposedActions(prev => prev.map((x, j) => j === i ? { ...x, priority: v as any } : x))}
                            >
                              <SelectTrigger className="h-7 w-28 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="low">I ulët</SelectItem>
                                <SelectItem value="medium">Mesatar</SelectItem>
                                <SelectItem value="high">I lartë</SelectItem>
                              </SelectContent>
                            </Select>
                            {a.assignee && (
                              <span className="text-muted-foreground flex items-center gap-1">
                                <Users className="h-3 w-3" /> {a.assignee}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="outline" size="sm" onClick={() => setActionExtractOpen(false)}>Mbyll</Button>
              <Button
                size="sm"
                onClick={handleCreateProposedActions}
                disabled={actionExtractLoading || proposedActions.filter(a => a.selected).length === 0 || taskMutation.loading}
              >
                {taskMutation.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                Krijo {proposedActions.filter(a => a.selected).length} detyra
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* ── Krijo Grup ── */}
      <Dialog open={showCreateGroup} onOpenChange={setShowCreateGroup}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Krijo grup të ri</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Emri i grupit</Label>
              <Input
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                placeholder="p.sh. Marketing, Projekti X..."
                className="mt-1"
                autoFocus
                maxLength={60}
              />
            </div>
            <div>
              <Label className="text-xs">Përshkrim (opsional)</Label>
              <Input
                value={newGroupDesc}
                onChange={e => setNewGroupDesc(e.target.value)}
                placeholder="Për çfarë është ky grup?"
                className="mt-1"
                maxLength={120}
              />
            </div>
            <div>
              <Label className="text-xs">Anëtarët ({newGroupMembers.length} të zgjedhur)</Label>
              <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-border/60 divide-y divide-border/40">
                {otherMembers.length === 0 && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">Asnjë anëtar ekipi tjetër.</p>
                )}
                {otherMembers.map(m => {
                  const selected = newGroupMembers.includes(m.userId);
                  return (
                    <button
                      key={m.userId}
                      type="button"
                      onClick={() => setNewGroupMembers(prev => selected ? prev.filter(x => x !== m.userId) : [...prev, m.userId])}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors"
                    >
                      <div className={`h-4 w-4 rounded border flex items-center justify-center flex-shrink-0 ${selected ? 'bg-primary border-primary' : 'border-muted-foreground/40'}`}>
                        {selected && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                      <span className="text-sm truncate">{getUserDisplayName(m.userId)}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Ti shtohesh automatikisht si admin i grupit.</p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setShowCreateGroup(false)}>Anulo</Button>
              <Button size="sm" onClick={handleCreateGroup} disabled={!newGroupName.trim() || creatingGroup}>
                {creatingGroup ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                Krijo grupin
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Menaxho Grupin ── */}
      <Dialog open={!!manageGroup} onOpenChange={(o) => { if (!o) setManageGroupId(null); }}>
        <DialogContent className="sm:max-w-md">
          {manageGroup && (() => {
            const amAdmin = isGroupAdmin(manageGroup);
            const members = manageGroup.members || [];
            const admins = manageGroup.admins || [];
            const nonMembers = otherMembers.filter(m => !members.includes(m.userId));
            const filteredNonMembers = addMemberQuery.trim()
              ? nonMembers.filter(m => getUserDisplayName(m.userId).toLowerCase().includes(addMemberQuery.trim().toLowerCase()))
              : nonMembers;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center"><Users className="h-4 w-4 text-primary" /></div>
                    <div className="min-w-0">
                      <p className="truncate">{manageGroup.name}</p>
                      {manageGroup.description && <p className="text-[11px] font-normal text-muted-foreground truncate">{manageGroup.description}</p>}
                    </div>
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  {/* Members */}
                  <div>
                    <Label className="text-xs">Anëtarët ({members.length})</Label>
                    <div className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-border/60 divide-y divide-border/40">
                      {members.map(uid => {
                        const isAdm = admins.includes(uid);
                        const isMe = uid === user?.uid;
                        return (
                          <div key={uid} className="flex items-center gap-2 px-3 py-2">
                            <span className="text-sm truncate flex-1">
                              {getUserDisplayName(uid)}{isMe && <span className="text-muted-foreground"> (ti)</span>}
                            </span>
                            {isAdm && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                <Crown className="h-3 w-3" /> Admin
                              </span>
                            )}
                            {amAdmin && !isMe && (
                              <>
                                <button
                                  onClick={() => handleToggleGroupAdmin(manageGroup, uid)}
                                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                  title={isAdm ? 'Hiq admin' : 'Bëj admin'}
                                >
                                  {isAdm ? 'Hiq admin' : 'Bëj admin'}
                                </button>
                                <button
                                  onClick={() => handleRemoveGroupMember(manageGroup, uid)}
                                  className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                                  title="Hiq nga grupi"
                                  aria-label="Hiq nga grupi"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Add members (admin only) */}
                  {amAdmin && (
                    <div>
                      <Label className="text-xs">Shto anëtarë</Label>
                      <div className="relative mt-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          value={addMemberQuery}
                          onChange={e => setAddMemberQuery(e.target.value)}
                          placeholder="Kërko anëtar ekipi..."
                          className="pl-8 h-8 text-sm"
                        />
                      </div>
                      {filteredNonMembers.length > 0 && (
                        <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-border/60 divide-y divide-border/40">
                          {filteredNonMembers.map(m => (
                            <button
                              key={m.userId}
                              onClick={() => handleAddGroupMember(manageGroup, m.userId)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors"
                            >
                              <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-sm truncate">{getUserDisplayName(m.userId)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {filteredNonMembers.length === 0 && (
                        <p className="mt-1 px-1 text-[11px] text-muted-foreground">Të gjithë anëtarët janë në grup.</p>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-1 border-t border-border/40">
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleLeaveGroup(manageGroup)}>
                      <LogOut className="h-3.5 w-3.5 mr-1" /> Dil nga grupi
                    </Button>
                    {amAdmin && (
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteGroup(manageGroup)}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Fshi grupin
                      </Button>
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {videoRoomUrl && (
        <React.Suspense fallback={null}>
          <VideoCallModal roomUrl={videoRoomUrl} userName={getUserDisplayName(user?.uid || '') || 'Agjent'} onClose={closeVideo} />
        </React.Suspense>
      )}
    </div>
  );
};

export default ChatView;
