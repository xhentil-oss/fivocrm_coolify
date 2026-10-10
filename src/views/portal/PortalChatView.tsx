import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { addDoc, collection, doc, updateDoc, writeBatch, Timestamp, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useClientPortal } from '../../hooks/useClientPortal';
import { usePortalTenant } from '../../hooks/usePortalTenant';
import { useCollection, useDocument } from '../../hooks/useFirestore';
import { useFileUpload } from '../../hooks/useFileUpload';
import { safeExternalUrl } from '../../lib/safeUrl';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Badge } from '../../components/ui/badge';
import { Send, MessageSquare, Paperclip, X, FileIcon, FolderKanban, HelpCircle, AlertCircle, RefreshCw, ChevronRight, Reply, SmilePlus, Video } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { useVideoCall } from '../../hooks/useVideoCall';
import VideoCallModal from '../../components/VideoCallModal';
import type { ChatMessage, Project } from '../../types';
import { notifyStaff } from '../../lib/notifyStaff';
import { useLocation, useNavigate } from 'react-router-dom';
import { useConversationPresence } from '../../hooks/useNotificationPrefs';
import { channelConversationKey } from '../../lib/notificationPrefs';

const EMOJI_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

// Lightweight, self-contained inline formatter so staff-authored markdown renders
// for the client instead of showing raw symbols. Supports **bold**, *italic*,
// `code`, @mentions and auto-linked http(s) URLs. Builds React nodes only (never
// dangerouslySetInnerHTML) so all text is auto-escaped and safe from XSS.
const formatMessageContent = (text?: string | null): React.ReactNode => {
  if (!text) return text ?? '';
  const tokenRe = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(@[\w.-]+)|(https?:\/\/[^\s<]+)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const [full, code, bold, italic, mention, url] = match;
    if (code) {
      nodes.push(<code key={key++} className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/15 text-[0.85em] font-mono">{code.slice(1, -1)}</code>);
    } else if (bold) {
      nodes.push(<strong key={key++} className="font-semibold">{bold.slice(2, -2)}</strong>);
    } else if (italic) {
      nodes.push(<em key={key++}>{italic.slice(1, -1)}</em>);
    } else if (mention) {
      nodes.push(<span key={key++} className="font-medium text-primary">{mention}</span>);
    } else if (url) {
      nodes.push(<a key={key++} href={url} target="_blank" rel="noopener noreferrer" className="underline break-all">{url}</a>);
    } else {
      nodes.push(full);
    }
    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
};

const PortalChatView: React.FC = () => {
  const { user } = useAuth();
  const { customerId } = useClientPortal();
  const { tenantBusinessId, tenantTeamId } = usePortalTenant();
  const { toast } = useToast();
  const [messageText, setMessageText] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
  // Mobile long-press action sheet (WhatsApp-style) — replaces the always-visible
  // action buttons that cluttered every bubble on mobile.
  const [longPressMenuId, setLongPressMenuId] = useState<string | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startLongPress = (id: string) => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => { try { navigator.vibrate?.(12); } catch { /* optional */ } setLongPressMenuId(id); }, 450);
  };
  const cancelLongPress = () => { if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; } };
  const scrollRef = useRef<HTMLDivElement>(null);
  const markedAsReadRef = useRef<Set<string>>(new Set());
  // scrollRef points at the inner content div; the actual scrollable element is
  // the Radix ScrollArea viewport that wraps it. Resolve it via closest().
  const getScroller = (): HTMLElement | null =>
    scrollRef.current?.closest<HTMLElement>('[data-radix-scroll-area-viewport]') ?? null;

  // Tap a reply-quote → scroll to + briefly highlight the original message.
  const jumpToMessage = (id?: string | null) => {
    if (!id) return;
    const el = document.getElementById(`msg-${id}`);
    if (!el) {
      toast({ description: 'Mesazhi origjinal nuk është ngarkuar. Shfaq mesazhet më të vjetra.' });
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-primary');
    setTimeout(() => el.classList.remove('ring-2', 'ring-primary'), 1600);
  };

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

  // Arrive from a push/bell deep-link on the RIGHT thread. A staff_message about a
  // project channel used to carry a bare '/portal/chat' actionUrl (which the delivery
  // choke point prefers over linkTo), so every such notification opened the default
  // conversation. The param is stripped afterwards so a reload doesn't re-trigger it.
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const projectParam = new URLSearchParams(location.search).get('project');
    if (!projectParam) return;
    setSelectedProjectId(projectParam);
    navigate(location.pathname, { replace: true });
  }, [location.search]);

  // Tell the delivery path which conversation I am reading, so staff replies land in
  // the bell without also pushing my phone while I am looking at them.
  useConversationPresence(channelId ? channelConversationKey(channelId) : null);

  // Windowed message loading: fetch only the most recent `messageLimit` messages
  // (newest-first server-side), then sort ascending for display. "Load older"
  // grows the window. Portal client has no businessId → this query is not
  // team-scoped, so orderBy+limit apply server-side.
  const MESSAGE_PAGE = 50;
  const [messageLimit, setMessageLimit] = useState(MESSAGE_PAGE);
  const { data: rawMessages, loading } = useCollection<ChatMessage>('messages', {
    where: [{ field: 'channelId', operator: '==', value: channelId }],
    orderBy: { field: 'createdAt', direction: 'desc' },
    limit: messageLimit,
    skipTeamFilter: true,
  });
  // If the window is full, there may be older messages to load.
  const hasOlderMessages = (rawMessages?.length || 0) >= messageLimit;

  // Reset the window when switching channels.
  useEffect(() => { setMessageLimit(MESSAGE_PAGE); }, [channelId]);

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

  // The customer record — the client's own tenant keys + responsible rep come from it.
  const { data: customer } = useDocument<any>('customers', customerId || undefined);

  // Tenant boundary stamped on client-created docs so staff see them in their scoped
  // chat/unread badge. Prefer the customer's own businessId (set for existing agency
  // clients via backfill and for subdomain clients), then the subdomain tenant.
  const clientBusinessId = (customer as any)?.businessId || tenantBusinessId || null;

  // teamId for client messages — required for the staff team-scoped reads. Prefer the
  // tenant's own team (subdomain), then the customer's team. NEVER a cross-tenant
  // member scan (that is how clients used to end up stamped with a random tenant).
  const resolvedTeamId = tenantTeamId || (customer as any)?.teamId || null;

  // NOTE: the portal deliberately does NOT read `teamMembers`. It used to read every
  // tenant's staff records (skipTeamFilter) to pick notification recipients — a
  // cross-tenant leak of staff data including compensation fields. Recipients and
  // conversation routing are resolved server-side by /api/notify-staff instead.
  //
  // Display names come from `userProfiles`, scoped to the client's own business.
  const { data: userProfiles } = useCollection<any>('userProfiles', {
    skip: !clientBusinessId,
    where: clientBusinessId ? [{ field: 'businessId', operator: '==', value: clientBusinessId }] : undefined,
    skipTeamFilter: true,
    skipBusinessFilter: true, // scoped explicitly above (portal users have no active business)
  });

  // No notifications mutation: a portal client cannot write into `notifications`
  // (the rules deny it). Staff are notified server-side via /api/notify-staff.
  // The one write the rules DO allow is marking my own notification as read
  // (userId pinned, isRead/readAt only) — used below to auto-dismiss the bell
  // entry for the conversation the client just opened.

  // My unread bell notifications — a staff_message carries linkTo = this channel
  // id, so opening the conversation should clear it just like tapping it in the
  // bell would. Without this the badge lingered until manually tapped.
  // Same shape as PortalNotificationsBell (userId + createdAt desc + limit 50), so
  // this SHARES its cached listener instead of opening a second one — and, unlike the
  // old `userId + isRead` with a bare `limit: 200`, it actually returns the NEWEST
  // rows: without an orderBy Firestore picks 200 by __name__, an arbitrary subset, so
  // past 200 unread rows opening the chat no longer cleared its bell entry.
  const { data: myNotifs } = useCollection<any>('notifications', {
    skip: !user?.uid,
    where: user?.uid ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
    orderBy: { field: 'createdAt', direction: 'desc' },
    limit: 50,
    skipTeamFilter: true,
  });
  const myUnreadNotifs = React.useMemo(() => (myNotifs || []).filter((n: any) => !n.isRead), [myNotifs]);
  const markedNotifReadRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!channelId || !myUnreadNotifs?.length) return;
    const toClear = myUnreadNotifs.filter(
      (n: any) => n.type === 'staff_message' && n.linkTo === channelId && !markedNotifReadRef.current.has(n.id),
    );
    if (toClear.length === 0) return;
    const ids = toClear.map((n: any) => n.id);
    ids.forEach((id: string) => markedNotifReadRef.current.add(id));
    const batch = writeBatch(db);
    ids.forEach((id: string) => batch.update(doc(db, 'notifications', id), { isRead: true }));
    batch.commit().catch((err) => {
      ids.forEach((id: string) => markedNotifReadRef.current.delete(id));
      console.error('[PortalChatView] dismiss chat notifications failed', err);
    });
  }, [channelId, myUnreadNotifs]);
  const { upload: uploadAttachment, uploading } = useFileUpload();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  // Grow the composer with its content up to ~5 lines, then scroll.
  const MAX_COMPOSER_PX = 120;
  const autoGrowComposer = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_PX)}px`;
  };
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
  const isImageUrl = (url: string) => /\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i.test(url) || /image%2F/i.test(url);
  // Render attachment links as clickable anchors only for http(s) URLs. A row written
  // straight to Firestore can carry a `javascript:`/`data:` URI (XSS on click), and a
  // regex on the raw string misses `java\tscript:` — `safeExternalUrl` PARSES it.
  // Legacy http:// VPS links still download.
  const safeAttachmentHref = (url?: string | null): string | undefined =>
    safeExternalUrl(url) ?? undefined;

  // The portal no longer reads `teamSettings` at all: the document carries the
  // tenant's finance rate card, SMTP identity and bank details, and the rules deny
  // it to portal clients. The upload host comes from the build env / allow-listed
  // default (`useFileUpload`), so a tenant-editable `whatsappVpsUrl` can never
  // receive the client's Firebase ID token.

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
  const notifyStaffOfClientMessage = React.useCallback(async (content: string, channelLabel: string, messageId?: string) => {
    const preview = content.length > 100 ? content.slice(0, 100) + '...' : content;
    const proj = selectedProjectId ? customerProjects?.find(x => x.id === selectedProjectId) : null;
    // Recipients (responsible person → project team → tenant admins) are resolved
    // server-side inside the client's own business; the same call upserts the
    // conversation thread with its owner + watchers.
    await notifyStaff({
      type: 'client_message',
      title: `Mesazh i ri nga klienti${channelLabel ? ` — ${channelLabel}` : ''}`,
      message: preview,
      actionUrl: '/app/chat',
      actionLabel: 'Hap Chat',
      linkTo: channelId,
      // Same keys the staff side stamps: no push/email while the recipient is reading
      // this thread (was never suppressed for client messages), and the row can be
      // dismissed when the message is deleted.
      conversationKey: `ch:${channelId}`,
      ...(messageId ? { messageId } : {}),
      projectId: selectedProjectId || undefined,
      responsibleUserId: responsibleUserId || null,
      conversation: {
        channelId,
        channel: 'portal',
        teamId: (proj as any)?.teamId || resolvedTeamId || null,
        salesAgentId: (customer as any)?.salesAgentId || null,
        subject: customer?.name || undefined,
      },
    });
  }, [responsibleUserId, selectedProjectId, customerProjects, channelId, resolvedTeamId, customer]);

  // Auto-scroll on new messages and when switching project channels.
  // When the user loads OLDER messages we must NOT jump to the bottom — instead
  // we restore the scroll position so their view stays anchored where they were.
  const prevCountRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  useEffect(() => {
    const count = messages?.length || 0;
    if (loadingOlderRef.current) {
      // Older messages just prepended — keep the viewport anchored.
      requestAnimationFrame(() => {
        const vp = getScroller();
        if (vp) vp.scrollTop = vp.scrollHeight - prevScrollHeightRef.current;
        loadingOlderRef.current = false;
      });
    } else if (count > prevCountRef.current) {
      requestAnimationFrame(() => {
        const vp = getScroller();
        if (vp) vp.scrollTop = vp.scrollHeight;
      });
    }
    prevCountRef.current = count;
  }, [messages?.length]);

  const loadOlderMessages = () => {
    const vp = getScroller();
    prevScrollHeightRef.current = vp ? vp.scrollHeight : 0;
    loadingOlderRef.current = true;
    setMessageLimit(l => l + MESSAGE_PAGE);
  };

  useEffect(() => {
    requestAnimationFrame(() => {
      const vp = getScroller();
      if (vp) vp.scrollTop = vp.scrollHeight;
    });
  }, [channelId]);

  // Clear read tracking when switching channels
  useEffect(() => { markedAsReadRef.current.clear(); }, [channelId]);

  // Collapse the auto-grown composer back to a single line once it's emptied.
  useEffect(() => {
    if (composerRef.current && !messageText) composerRef.current.style.height = 'auto';
  }, [messageText]);

  // Mark staff messages as readAt when client opens chat
  useEffect(() => {
    if (!user || !messages.length) return;
    // Only mark staff messages as read while the tab is actually visible —
    // otherwise a background/unfocused portal tab would fire read-receipts on
    // mount without the client having seen anything.
    const markVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const unread = messages.filter((m: any) => m.senderType === 'staff' && !m.readAt && !markedAsReadRef.current.has(m.id));
      if (unread.length === 0) return;
      // Collapse N individual updates into a single Firestore batched write.
      const batch = writeBatch(db);
      const now = new Date();
      unread.forEach((m: any) => {
        markedAsReadRef.current.add(m.id);
        batch.update(doc(db, 'messages', m.id), { readAt: now } as any);
      });
      batch.commit().catch(() => {});
    };
    markVisible();
    document.addEventListener('visibilitychange', markVisible);
    return () => document.removeEventListener('visibilitychange', markVisible);
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
      const createdRef = await addDoc(collection(db, 'messages'), {
        content: msgContent,
        senderId: user.uid,
        channelId,
        isRead: false,
        attachmentUrl: attach || null,
        senderType: 'client',
        ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
        ...(clientBusinessId ? { businessId: clientBusinessId } : {}),
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

      // The conversation thread (owner + watchers) is upserted server-side by
      // /api/notify-staff below — computing watchers needs the tenant's staff list,
      // which the portal must not read.

      // Route the message to the responsible person (in-app + email).
      const channelLabel = selectedProjectId
        ? customerProjects?.find(p => p.id === selectedProjectId)?.name || 'Projekt'
        : 'Bisedë e përgjithshme';
      await notifyStaffOfClientMessage(msgContent, channelLabel, createdRef.id);

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
  // `videoCallsEnabled` was never written anywhere (staff or server), so the flag
  // always resolved to "on"; keep that behaviour without the teamSettings read.
  const videoEnabled = true;
  const handleVideoCall = async () => {
    const room = `fivocrm-${channelId}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
    const url = await startVideo(room);
    if (!url || !user || !customerId) return;
    // Post a join link so the responsible person sees it (and gets notified).
    try {
      const callRef = await addDoc(collection(db, 'messages'), {
        content: `📹 Thirrje video u nis. Bashkohu: ${url}`,
        senderId: user.uid,
        channelId,
        isRead: false,
        senderType: 'client',
        ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
        ...(clientBusinessId ? { businessId: clientBusinessId } : {}),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdByUserId: user.uid,
      });
      await notifyStaffOfClientMessage('📹 Thirrje video', selectedProjectId
        ? customerProjects?.find(p => p.id === selectedProjectId)?.name || 'Projekt'
        : 'Bisedë e përgjithshme', callRef.id);
    } catch { /* non-blocking */ }
  };

  // Upload an image and send it immediately (same flow as the admin chat).
  const handleFileSelect = async (file: File) => {
    if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) {
      toast({ title: 'Format i pasaktë', description: 'Lejohen imazhe (PNG, JPG, GIF, WEBP), PDF, Word, Excel, PowerPoint, TXT ose CSV.', variant: 'destructive' });
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
    return 'Ekipi';
  };

  const getInitials = (senderId: string) => {
    const name = getDisplayName(senderId);
    return name.slice(0, 2).toUpperCase();
  };

  const getAvatarColor = (senderId: string) => {
    const colors = [
      'bg-blue-500', 'bg-emerald-500', 'bg-navy-700', 'bg-amber-500',
      'bg-rose-500', 'bg-cyan-500', 'bg-primary', 'bg-teal-500'
    ];
    let hash = 0;
    for (let i = 0; i < senderId.length; i++) hash = senderId.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const isOwnMessage = (senderId: string) => senderId === user?.uid;

  // Toggle emoji reaction — atomic per-emoji array update, same as the staff
  // ChatView: rebuilding the whole `reactions` object from a snapshot made a
  // client and a staff member reacting near-simultaneously clobber each other.
  const handleReaction = async (msgId: string, emoji: string) => {
    if (!user) return;
    const msg = rawMessages?.find(m => m.id === msgId);
    if (!msg) return;
    const already = Array.isArray((msg as any).reactions?.[emoji]) && (msg as any).reactions[emoji].includes(user.uid);
    try {
      await updateDoc(doc(db, 'messages', msgId), {
        [`reactions.${emoji}`]: already ? arrayRemove(user.uid) : arrayUnion(user.uid),
      } as any);
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
      const quickRef = await addDoc(collection(db, 'messages'), {
        content: msg,
        senderId: user.uid,
        channelId,
        isRead: false,
        senderType: 'client',
        ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
        ...(clientBusinessId ? { businessId: clientBusinessId } : {}),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdByUserId: user.uid,
      });

      // Route the quick message to the responsible person (in-app + email).
      const channelLabel = selectedProjectId
        ? customerProjects?.find(p => p.id === selectedProjectId)?.name || 'Projekt'
        : 'Bisedë e përgjithshme';
      await notifyStaffOfClientMessage(msg, channelLabel, quickRef.id);
    } catch {
      toast({ title: 'Gabim', description: 'Mesazhi nuk u dërgua.', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin motion-reduce:animate-none mx-auto" />
          <p className="text-muted-foreground text-sm">Duke ngarkuar bisedën...</p>
        </div>
      </div>
    );
  }

  return (
    // flex-1 inside the layout's content column, NOT a hand-counted viewport slice.
    // `100dvh - 140px` ignored both safe-area insets and the real chrome around it
    // (4rem header + 4rem nav + 2rem padding = 160px before insets), so the composer
    // sat 20px below the fold on a plain phone and ~80px under the nav on a notched
    // Android — and the admin-preview banner added 40px it never knew about.
    <div className="flex flex-col flex-1 min-h-0 w-full max-w-3xl mx-auto">
      {/* Chat Header */}
      <div className="flex items-center gap-3 pb-3 sm:pb-4 border-b mb-0">
        <div className="relative">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-primary-foreground font-bold text-sm">
            <MessageSquare className="h-5 w-5" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-foreground text-base sm:text-lg">
            {selectedProjectId
              ? customerProjects?.find(p => p.id === selectedProjectId)?.name || 'Projekt'
              : 'Ekipi Ynë'}
          </h1>
          <p className="text-xs text-muted-foreground">Zakonisht përgjigjemi brenda pak orësh</p>
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
                return [
                  hasOlderMessages && (
                    <div key="load-older" className="flex justify-center py-2">
                      <button
                        onClick={loadOlderMessages}
                        disabled={loading}
                        className="text-xs font-medium text-primary hover:underline disabled:opacity-50 px-3 py-1 rounded-full bg-primary/5"
                      >
                        {loading ? 'Duke ngarkuar...' : 'Ngarko mesazhe më të vjetra'}
                      </button>
                    </div>
                  ),
                  ...messages.map((msg: any, idx: number) => {
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
                        id={`msg-${msg.id}`}
                        className={`flex group ${own ? 'justify-end' : 'justify-start'} ${sameSenderAsPrev ? 'mt-0.5' : 'mt-3'} rounded-2xl transition-shadow`}
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

                          {/* Reply preview — tap to jump to the original message */}
                          {msg.replyToContent && (
                            <button
                              type="button"
                              onClick={() => jumpToMessage((msg as any).replyToId)}
                              title="Shko te mesazhi origjinal"
                              className="text-[11px] mb-1 p-1.5 rounded border-l-2 bg-muted/40 border-primary/40 max-w-full block w-full text-left hover:bg-muted transition-colors cursor-pointer"
                            >
                              <span className="font-medium">{msg.replyToSender}</span>
                              <p className="truncate opacity-80">{msg.replyToContent}</p>
                            </button>
                          )}

                          <div
                            onTouchStart={() => startLongPress(msg.id)}
                            onTouchEnd={cancelLongPress}
                            onTouchMove={cancelLongPress}
                            onTouchCancel={cancelLongPress}
                            onContextMenu={(e) => e.preventDefault()}
                            className={`rounded-2xl px-3 sm:px-3.5 py-2 relative select-none sm:select-text [-webkit-touch-callout:none] ${
                              own
                                ? 'bg-primary text-primary-foreground rounded-br-sm'
                                : 'bg-muted/80 border border-border/50 rounded-bl-sm'
                            }`}
                          >
                            <p className="text-[13px] sm:text-[13.5px] leading-relaxed whitespace-pre-wrap break-words">{formatMessageContent(msg.content)}</p>
                            {safeAttachmentHref(msg.attachmentUrl) && (
                              isImageUrl(msg.attachmentUrl) ? (
                                <a href={safeAttachmentHref(msg.attachmentUrl)} target="_blank" rel="noopener noreferrer" className="block mt-1.5">
                                  <img src={safeAttachmentHref(msg.attachmentUrl)} alt="Foto" loading="lazy" className="rounded-lg max-w-[220px] max-h-[280px] object-cover border border-border/40" />
                                </a>
                              ) : (
                                <a
                                  href={safeAttachmentHref(msg.attachmentUrl)}
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

                            {/* Message actions — desktop hover only. On mobile the
                                long-press action sheet (below) handles react/reply so
                                bubbles stay clean. */}
                            <div className={`absolute -top-3 ${own ? 'left-1' : 'right-1'} hidden sm:flex sm:opacity-0 sm:group-hover:opacity-100 transition-opacity items-center gap-0.5 bg-background border rounded-lg shadow-sm px-1 py-0.5 z-10`}>
                              <div className="relative">
                                <button
                                  aria-label="Shto reagim"
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
                                aria-label="Përgjigju mesazhit"
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
                })
                ];
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
          <Button variant="ghost" size="icon" aria-label="Anulo përgjigjen" className="h-6 w-6 flex-shrink-0" onClick={() => setReplyingTo(null)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Message Input Area */}
      <div className="border-t bg-background pt-2" style={{ paddingBottom: 'max(8px, var(--safe-area-bottom))' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
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
            aria-label="Bashkëngjit skedar"
          >
            {uploading ? <RefreshCw className="h-4 w-4 sm:h-5 sm:w-5 animate-spin motion-reduce:animate-none" /> : <Paperclip className="h-4 w-4 sm:h-5 sm:w-5" />}
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
              aria-label="Nis thirrje video"
            >
              {videoStarting ? <RefreshCw className="h-4 w-4 sm:h-5 sm:w-5 animate-spin motion-reduce:animate-none" /> : <Video className="h-4 w-4 sm:h-5 sm:w-5" />}
            </Button>
          )}
          <div className="flex-1 min-w-0">
            <textarea
              ref={composerRef}
              placeholder="Shkruani mesazhin..."
              value={messageText}
              rows={1}
              aria-label="Shkruani mesazhin"
              onChange={(e) => { setMessageText(e.target.value); autoGrowComposer(e.target); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              className="w-full resize-none rounded-2xl px-4 py-2 text-base leading-relaxed bg-muted/50 border border-muted-foreground/20 focus:bg-background focus:outline-none focus:ring-1 focus:ring-primary/40 transition-colors max-h-[120px] overflow-y-auto"
            />
          </div>
          <Button
            type="submit"
            size="icon"
            aria-label="Dërgo mesazhin"
            disabled={!messageText.trim() && !attachmentUrl.trim()}
            className="h-9 w-9 sm:h-10 sm:w-10 rounded-full flex-shrink-0 shadow-sm"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
      {roomUrl && <VideoCallModal roomUrl={roomUrl} userName={customer?.name || 'Klient'} onClose={closeVideo} />}

      {/* Mobile long-press action sheet — react / reply. Portaled to body so it
          isn't clipped; backdrop tap dismisses. Desktop uses the hover toolbar. */}
      {longPressMenuId && createPortal(
        <div className="sm:hidden" role="dialog" aria-modal="true">
          <div className="fixed inset-0 z-[60] bg-black/50 animate-in fade-in duration-150 motion-reduce:animate-none" onClick={() => setLongPressMenuId(null)} />
          <div
            className="fixed inset-x-0 bottom-0 z-[61] bg-popover border-t rounded-t-2xl shadow-2xl animate-in slide-in-from-bottom duration-200 motion-reduce:animate-none"
            style={{ paddingBottom: 'var(--safe-area-bottom)' }}
          >
            <div className="flex justify-center pt-2 pb-1"><div className="h-1 w-9 rounded-full bg-muted-foreground/25" /></div>
            <div className="flex justify-around px-3 py-2 border-b border-border/60">
              {EMOJI_REACTIONS.map(emoji => (
                <button
                  key={emoji}
                  className="text-2xl p-1.5 rounded-full active:scale-125 transition-transform"
                  onClick={() => { handleReaction(longPressMenuId, emoji); setLongPressMenuId(null); }}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <button
              className="flex items-center gap-3 w-full px-5 py-3.5 text-[15px] text-foreground active:bg-accent/60 transition-colors"
              onClick={() => { const m = messages.find((x: any) => x.id === longPressMenuId); if (m) setReplyingTo(m); setLongPressMenuId(null); }}
            >
              <Reply className="h-5 w-5 text-muted-foreground" /> Përgjigju
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default PortalChatView;
