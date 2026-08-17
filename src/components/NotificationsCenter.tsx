import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCollection, useMutation, useGlobalBusinessId } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { toast } from '../hooks/use-toast';
import {
  Bell, Check, Trash2, AlertCircle, CheckCircle, XCircle, Info, ExternalLink,
  MessageSquare, DollarSign, RefreshCw, Target, FileText, Users, User,
  Calendar, Clock, TrendingUp, Zap, ChevronDown, ChevronRight, UserPlus, Eye, Plus,
  Settings, Moon,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { Switch } from './ui/switch';
import { writeBatch, doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import type { Notification } from '../types';
import {
  NOTIFICATION_CATEGORIES,
  CATEGORY_LABELS as REGISTRY_CATEGORY_LABELS,
  CATEGORY_DESCRIPTIONS,
  categoryOf,
  priorityOf,
  groupLabelOf,
  isTypeMutedByPrefs,
  type NotificationCategory,
  type NotificationPriority,
} from '../lib/notificationTypes';
import { dndZoneStamp } from '../lib/notificationPrefs';

// ── Presentation ───────────────────────────────────────────────────────────────
// Priority, category and group label now come from the SHARED registry
// (src/lib/notificationTypes.ts) so the bell, the mute preferences and the server's
// push/email gate can no longer disagree. Only the icon — the one genuinely
// React-shaped piece — stays here.
type Priority = NotificationPriority;

const PRIORITY_STYLE: Record<Priority, { borderColor: string; bgColor: string }> = {
  critical: { borderColor: 'border-l-red-500',     bgColor: 'bg-red-50/60 dark:bg-red-950/20' },
  warning:  { borderColor: 'border-l-amber-500',   bgColor: 'bg-amber-50/60 dark:bg-amber-950/20' },
  success:  { borderColor: 'border-l-emerald-500', bgColor: 'bg-emerald-50/60 dark:bg-emerald-950/20' },
  info:     { borderColor: 'border-l-blue-500',    bgColor: 'bg-blue-50/60 dark:bg-blue-950/20' },
  neutral:  { borderColor: '',                     bgColor: '' },
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  task_overdue:             <AlertCircle className="w-4 h-4 text-red-500" />,
  invoice_overdue:          <AlertCircle className="w-4 h-4 text-red-500" />,
  goal_overdue:             <Target className="w-4 h-4 text-red-500" />,
  task_due_soon:            <Clock className="w-4 h-4 text-amber-500" />,
  lead_follow_up:           <Clock className="w-4 h-4 text-amber-500" />,
  lead_cadence_step:        <Clock className="w-4 h-4 text-amber-500" />,
  invoice_reminder_sent:    <FileText className="w-4 h-4 text-amber-500" />,
  invoice_reminder1_sent:   <FileText className="w-4 h-4 text-amber-500" />,
  invoice_reminder2_sent:   <FileText className="w-4 h-4 text-amber-500" />,
  project_open_reminder:    <Calendar className="w-4 h-4 text-amber-500" />,
  invoice_paid:             <DollarSign className="w-4 h-4 text-emerald-500" />,
  goal_achieved:            <CheckCircle className="w-4 h-4 text-emerald-500" />,
  project_completed:        <CheckCircle className="w-4 h-4 text-emerald-500" />,
  lead_converted:           <TrendingUp className="w-4 h-4 text-emerald-500" />,
  quote_accepted:           <CheckCircle className="w-4 h-4 text-emerald-500" />,
  quote_rejected:           <XCircle className="w-4 h-4 text-red-500" />,
  quote_sent:               <FileText className="w-4 h-4 text-blue-500" />,
  contract_sent:            <FileText className="w-4 h-4 text-amber-500" />,
  task_assigned:            <User className="w-4 h-4 text-blue-500" />,
  task_completed:           <CheckCircle className="w-4 h-4 text-emerald-500" />,
  task_collaborator_added:  <Users className="w-4 h-4 text-primary" />,
  task_mention:             <MessageSquare className="w-4 h-4 text-primary" />,
  task_comment:             <MessageSquare className="w-4 h-4 text-blue-500" />,
  lead_assigned:            <User className="w-4 h-4 text-blue-500" />,
  lead_created:             <UserPlus className="w-4 h-4 text-blue-500" />,
  goal_assigned:            <Target className="w-4 h-4 text-blue-500" />,
  project_status_changed:   <Zap className="w-4 h-4 text-blue-500" />,
  client_message:           <MessageSquare className="w-4 h-4 text-emerald-500" />,
  staff_message:            <MessageSquare className="w-4 h-4 text-blue-500" />,
  direct_message:           <MessageSquare className="w-4 h-4 text-blue-500" />,
  mention:                  <MessageSquare className="w-4 h-4 text-primary" />,
  project_comment:          <MessageSquare className="w-4 h-4 text-blue-500" />,
  client_request:           <MessageSquare className="w-4 h-4 text-emerald-500" />,
  project_created:          <Zap className="w-4 h-4 text-blue-500" />,
  auto_invoice_created:     <FileText className="w-4 h-4 text-blue-500" />,
  invoice_created:          <FileText className="w-4 h-4 text-blue-500" />,
  invoice_sent:             <FileText className="w-4 h-4 text-blue-500" />,
  recurring_task_created:   <RefreshCw className="w-4 h-4 text-tertiary" />,
  recurring_expense_created:<RefreshCw className="w-4 h-4 text-tertiary" />,
  project_cycle_reset:      <RefreshCw className="w-4 h-4 text-tertiary" />,
  expense_submitted:        <DollarSign className="w-4 h-4 text-blue-500" />,
  guest_project_invited:    <UserPlus className="w-4 h-4 text-amber-500" />,
  guest_task_new:           <Plus className="w-4 h-4 text-amber-500" />,
  guest_task_update:        <Eye className="w-4 h-4 text-amber-500" />,
  blocker_reported:         <AlertCircle className="w-4 h-4 text-red-500" />,
  report:                   <FileText className="w-4 h-4 text-primary" />,
  billing:                  <DollarSign className="w-4 h-4 text-amber-500" />,
  recurring_project_no_budget: <AlertCircle className="w-4 h-4 text-amber-500" />,
  recurring_project_billing_misconfigured: <AlertCircle className="w-4 h-4 text-amber-500" />,
};

const FALLBACK_ICON = <Info className="w-4 h-4 text-muted-foreground" />;

interface TypeConfig {
  icon: React.ReactNode;
  priority: Priority;
  borderColor: string;
  bgColor: string;
}

function getConfig(type?: string): TypeConfig {
  const priority = priorityOf(type);
  return {
    icon: (type && TYPE_ICON[type]) || FALLBACK_ICON,
    priority,
    ...PRIORITY_STYLE[priority],
  };
}

// ── Category filter ────────────────────────────────────────────────────────────
type Category = 'all' | NotificationCategory;

const CATEGORY_LABELS: Record<Category, string> = {
  all: 'Të gjitha',
  ...REGISTRY_CATEGORY_LABELS,
};

// ── Notification grouping ──────────────────────────────────────────────────────
interface NotifGroup {
  id: string;
  kind: 'single' | 'group';
  items: Notification[];
}

const ONE_HOUR = 60 * 60 * 1000;

// Two notifications are exact duplicates when they carry the same type + content.
// The cron may emit identical reminders days apart, so these must collapse even
// when they fall outside the 1-hour "burst" window.
const isSameContent = (a: Notification, b: Notification) =>
  a.type === b.type && a.title === b.title && (a.message || '') === (b.message || '');

function groupNotifications(notifs: Notification[]): NotifGroup[] {
  const result: NotifGroup[] = [];
  let i = 0;
  while (i < notifs.length) {
    const n = notifs[i];
    const group: Notification[] = [n];
    let j = i + 1;
    while (j < notifs.length) {
      const c = notifs[j];
      if (c.type !== n.type) break;
      const diff = Math.abs(new Date(n.createdAt).getTime() - new Date(c.createdAt).getTime());
      // Group same-type bursts within an hour, OR exact-duplicate content any time apart.
      if (diff > ONE_HOUR && !isSameContent(n, c)) break;
      group.push(c);
      j++;
    }
    result.push({
      id: group.length > 1 ? `grp-${n.id}` : n.id,
      kind: group.length > 1 ? 'group' : 'single',
      items: group,
    });
    i = j;
  }
  return result;
}

// ── User preferences ───────────────────────────────────────────────────────────
interface NotifPrefs {
  categoryEnabled: Record<NotificationCategory, boolean>;
  emailEnabled: boolean;
  pushEnabled: boolean;
  soundEnabled: boolean;
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
  /**
   * IANA zone the DND window is expressed in, plus the raw offset as a fallback.
   *
   * The window is typed into an `<input type="time">`, i.e. WALL-CLOCK time in the
   * user's own zone — but the server evaluated it with getUTCHours(). For Albania
   * (UTC+2 in summer) "22:00–08:00" actually silenced 00:00–10:00: pushes came at
   * midnight and were swallowed all morning. Storing the zone lets the server
   * reconstruct the user's local time instead of guessing.
   */
  dndTimeZone?: string;
  /** Minutes to ADD to UTC to get local time (Europe/Tirane summer = +120). */
  dndUtcOffsetMinutes?: number;
}

const ALL_CATEGORIES_ON = NOTIFICATION_CATEGORIES.reduce((acc, c) => {
  acc[c] = true;
  return acc;
}, {} as Record<NotificationCategory, boolean>);

const DEFAULT_PREFS: NotifPrefs = {
  categoryEnabled: { ...ALL_CATEGORIES_ON },
  emailEnabled: true,
  pushEnabled: true,
  soundEnabled: true,
  dndEnabled: false,
  dndStart: '22:00',
  dndEnd: '08:00',
};

function mergePrefs(raw: Partial<NotifPrefs>): NotifPrefs {
  return {
    ...DEFAULT_PREFS,
    ...raw,
    // A category absent from the stored doc (e.g. the new `reports` / `system`
    // groups on an old preferences record) defaults to ON, never to muted.
    categoryEnabled: { ...ALL_CATEGORIES_ON, ...(raw.categoryEnabled || {}) },
  };
}

/** Stamp the current zone/offset onto the prefs so the server can honour DND. */
function withDndZone(prefs: NotifPrefs): NotifPrefs {
  return { ...prefs, ...dndZoneStamp() };
}

// True when the current local time falls inside the user's Do-Not-Disturb window.
export function isInDndWindow(prefs: { dndEnabled?: boolean; dndStart?: string; dndEnd?: string }): boolean {
  if (!prefs.dndEnabled || !prefs.dndStart || !prefs.dndEnd) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = prefs.dndStart.split(':').map(Number);
  const [eh, em] = prefs.dndEnd.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return start <= end ? (cur >= start && cur < end) : (cur >= start || cur < end);
}

// Is a notification type muted by the user's category preferences?
// Delegates to the shared registry so client and server mute identically.
function isTypeMuted(type: string | undefined, prefs: NotifPrefs): boolean {
  return isTypeMutedByPrefs(type, prefs.categoryEnabled);
}

const LOAD_STEP = 30;

// ── Main component ─────────────────────────────────────────────────────────────
const NotificationsCenter: React.FC = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(LOAD_STEP);
  const [category, setCategory] = useState<Category>('all');
  const [showPrefs, setShowPrefs] = useState(false);
  const [localPrefs, setLocalPrefs] = useState<NotifPrefs>(DEFAULT_PREFS);
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Server-side limit: fetch max 100 most-recent notifications
  const { data: notifications, loading: isPending } = useCollection<Notification>('notifications', {
    skip: !user,
    where: user ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
    orderBy: { field: 'createdAt', direction: 'desc' },
    limit: 100,
  });

  const notificationMutation = useMutation<Notification>('notifications');

  // Load preferences: localStorage first (instant), then sync from Firestore
  useEffect(() => {
    if (!user) return;
    const stored = localStorage.getItem(`notif_prefs_${user.uid}`);
    if (stored) {
      try { setLocalPrefs(mergePrefs(JSON.parse(stored))); } catch { /* ignore */ }
    }
    getDoc(doc(db, 'userPreferences', user.uid)).then(snap => {
      if (!snap.exists()) return;
      const merged = mergePrefs(snap.data() as Partial<NotifPrefs>);
      setLocalPrefs(merged);
      localStorage.setItem(`notif_prefs_${user.uid}`, JSON.stringify(merged));
      // One-time migration for records saved before DND carried a timezone: the
      // server would otherwise keep reading these hours as UTC. Written silently
      // on first load; costs one write per user, once.
      if (merged.dndEnabled && !merged.dndTimeZone) {
        const stamped = withDndZone(merged);
        setLocalPrefs(stamped);
        localStorage.setItem(`notif_prefs_${user.uid}`, JSON.stringify(stamped));
        setDoc(doc(db, 'userPreferences', user.uid), {
          dndTimeZone: stamped.dndTimeZone,
          dndUtcOffsetMinutes: stamped.dndUtcOffsetMinutes,
        }, { merge: true }).catch(() => { /* non-critical */ });
      }
    }).catch(() => { /* offline */ });
  }, [user?.uid]);

  // ── Real-time alert (toast + chime) when a brand-new notification arrives ──
  // Keyed on the newest createdAt (ms), not the newest id — see the effect below.
  const lastNotifAtRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playChime = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch { /* audio blocked — ignore */ }
  }, []);

  useEffect(() => {
    if (!notifications || notifications.length === 0) return;
    const newest = notifications[0]; // query is ordered createdAt desc
    // Track the newest by TIMESTAMP, not by id. Keying on `notifications[0].id`
    // meant that deleting the top notification promoted an older one to index 0
    // with a different id — which read as "something new arrived" and replayed a
    // toast + chime for a notification from days ago.
    const newestAt = new Date(newest.createdAt).getTime();
    if (lastNotifAtRef.current === null) {
      lastNotifAtRef.current = newestAt;   // first load: prime, never alert
      return;
    }
    if (newestAt <= lastNotifAtRef.current) return;
    lastNotifAtRef.current = newestAt;
    // Only alert for a fresh, unread notification, respecting DND + category mute
    if (newest.isRead) return;
    if (isInDndWindow(localPrefs)) return;
    if (isTypeMuted(newest.type, localPrefs)) return;
    toast({ title: newest.title, description: newest.message });
    // Chat messages already get their own sound from the chat UI (Sidebar chime /
    // ChatView chirp). Skip the chime here for those types to avoid a double sound
    // on message arrival; keep it for all other notifications.
    const CHAT_MSG_TYPES = new Set(['client_message', 'staff_message', 'direct_message', 'mention']);
    if (localPrefs.soundEnabled !== false && !CHAT_MSG_TYPES.has(newest.type || '')) playChime();
  }, [notifications, localPrefs, playChime]);

  // Tenant boundary + muted categories. The query is by userId only, so a user who
  // is staff in TWO businesses (or a super-admin inside a tenant) saw the other
  // tenant's notifications here, with actionUrls that 403 after navigation. Filtered
  // client-side, not in the query: legacy rows carry no businessId and must stay
  // visible, and no composite index is needed this way.
  const activeBusinessId = useGlobalBusinessId();
  const activeNotifications = useMemo(() => {
    if (!notifications) return [];
    return notifications.filter(n =>
      (!activeBusinessId || !(n as any).businessId || (n as any).businessId === activeBusinessId)
      && !isTypeMuted(n.type, localPrefs));
  }, [notifications, localPrefs, activeBusinessId]);

  // Filter by selected category chip
  const filteredByCategory = useMemo(() => {
    if (category === 'all') return activeNotifications;
    return activeNotifications.filter(n => categoryOf(n.type) === category);
  }, [activeNotifications, category]);

  const unreadCount         = activeNotifications.filter(n => !n.isRead).length;
  // Over ALL fetched rows (muted included): "Shëno të lexuara" clears muted rows too,
  // but its visibility keyed on unreadCount — when only muted unread remained, the
  // button vanished and those rows stayed unread forever (still counted by the digest).
  const unreadTotalCount    = (notifications || []).filter(n => !n.isRead).length;
  const unreadClientCount   = activeNotifications.filter(n => !n.isRead && n.type === 'client_message').length;
  // Anything that is literally someone talking TO me: task mentions, chat mentions,
  // DMs and being pulled into a task. `mention` and `direct_message` used to be
  // missing here, so a chat @mention never changed the bell icon.
  const MENTION_TYPES = new Set(['task_mention', 'task_collaborator_added', 'mention', 'direct_message']);
  const unreadMentionCount  = activeNotifications.filter(n => !n.isRead && MENTION_TYPES.has(n.type || '')).length;
  const criticalCount       = activeNotifications.filter(n => !n.isRead && getConfig(n.type).priority === 'critical').length;

  const handleMarkAsRead = async (id: string) => {
    await notificationMutation.update(id, { isRead: true });
  };

  const handleMarkAllAsRead = async () => {
    // Deliberately over `notifications`, NOT `activeNotifications`: the latter hides
    // muted categories, so those rows stayed unread forever — invisible in the bell
    // yet still counted by the daily digest job. "Mark all read" now means all.
    const unread = (notifications || []).filter(n => !n.isRead);
    if (unread.length === 0) return;
    // Firestore caps a batch at 500 writes; the query caps at 100, but chunk anyway
    // so raising the limit later can't silently start failing.
    const CHUNK = 400;
    for (let i = 0; i < unread.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const n of unread.slice(i, i + CHUNK)) {
        batch.update(doc(db, 'notifications', n.id), { isRead: true });
      }
      await batch.commit();
    }
  };

  const handleDelete = async (id: string) => {
    await notificationMutation.remove(id);
  };

  const savePrefs = async (newPrefs: NotifPrefs) => {
    if (!user) return;
    // Stamp the zone the DND hours were entered in, so the server evaluates the
    // window in the user's local time instead of UTC.
    const stamped = withDndZone(newPrefs);
    setLocalPrefs(stamped);
    localStorage.setItem(`notif_prefs_${user.uid}`, JSON.stringify(stamped));
    setSavingPrefs(true);
    try {
      await setDoc(doc(db, 'userPreferences', user.uid), stamped, { merge: true });
    } finally {
      setSavingPrefs(false);
    }
  };

  const unreadFiltered = filteredByCategory.filter(n => !n.isRead);
  const visibleAll     = filteredByCategory.slice(0, displayLimit);
  const hasMore        = filteredByCategory.length > displayLimit;

  const groupedUnread = useMemo(() => groupNotifications(unreadFiltered), [unreadFiltered]);
  const groupedAll    = useMemo(() => groupNotifications(visibleAll),     [visibleAll]);

  const closeDropdown = () => setOpen(false);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(v) => { setOpen(v); if (!v) setShowPrefs(false); }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="bg-white/10 text-white hover:bg-white/20 relative"
          aria-label="Notifications"
        >
          {unreadClientCount > 0
            ? <span className="text-base leading-none animate-bird-fly">🐦</span>
            : unreadMentionCount > 0
            ? <span className="text-base leading-none animate-bird-fly">💬</span>
            : <Bell className="w-5 h-5" />
          }
          {unreadCount > 0 && (
            <Badge
              className={`absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs ${
                criticalCount > 0
                  ? 'bg-red-500 text-white animate-pulse'
                  : unreadClientCount > 0
                  ? 'bg-emerald-500 text-white'
                  : unreadMentionCount > 0
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-accent text-accent-foreground'
              }`}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] max-w-[400px] sm:w-[400px] p-0">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            {showPrefs ? (
              <button
                onClick={() => setShowPrefs(false)}
                className="flex items-center gap-1 text-sm font-semibold text-foreground hover:text-primary transition-colors"
              >
                <ChevronRight className="w-4 h-4 rotate-180" />
                Preferencat
              </button>
            ) : (
              <>
                <h3 className="font-semibold text-foreground">Njoftime</h3>
                {criticalCount > 0 && (
                  <Badge className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 text-xs px-1.5">
                    {criticalCount} urgjent
                  </Badge>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            {!showPrefs && unreadTotalCount > 0 && (
              <Button variant="ghost" size="sm" onClick={handleMarkAllAsRead} className="text-xs">
                <Check className="w-3 h-3 mr-1" />
                Shëno të lexuara
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${showPrefs ? 'bg-accent text-accent-foreground' : ''}`}
              onClick={() => setShowPrefs(p => !p)}
              title="Preferencat e njoftimeve"
            >
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {showPrefs ? (
          <PreferencesPanel prefs={localPrefs} onSave={savePrefs} saving={savingPrefs} />
        ) : (
          <>
            {/* Category filter chips */}
            <div className="flex gap-1.5 px-3 py-2 border-b overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {(['all', ...NOTIFICATION_CATEGORIES] as Category[]).map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`flex-shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    category === cat
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {CATEGORY_LABELS[cat]}
                  {cat !== 'all' && !localPrefs.categoryEnabled[cat] && (
                    <span className="ml-1 opacity-60" title="Të çaktivizuara">🔇</span>
                  )}
                </button>
              ))}
            </div>

            <Tabs defaultValue="unread" className="w-full">
              <TabsList className="w-full rounded-none border-b">
                <TabsTrigger value="unread" className="flex-1">
                  Të palexuara ({unreadFiltered.length})
                </TabsTrigger>
                <TabsTrigger value="all" className="flex-1">
                  Të gjitha ({filteredByCategory.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="unread" className="m-0">
                <ScrollArea className="max-h-[60vh] sm:max-h-[360px]">
                  {isPending ? (
                    <div className="p-8 text-center text-muted-foreground">Duke ngarkuar...</div>
                  ) : groupedUnread.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                      <Bell className="w-12 h-12 mx-auto mb-2 opacity-20" />
                      <p>Nuk ka njoftime të palexuara</p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {groupedUnread.map(group =>
                        group.kind === 'group' ? (
                          <GroupedNotificationItem
                            key={group.id}
                            group={group.items}
                            onMarkAsRead={handleMarkAsRead}
                            onDelete={handleDelete}
                            onClose={closeDropdown}
                          />
                        ) : (
                          <NotificationItem
                            key={group.id}
                            notification={group.items[0]}
                            onMarkAsRead={handleMarkAsRead}
                            onDelete={handleDelete}
                            onClose={closeDropdown}
                          />
                        )
                      )}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="all" className="m-0">
                <ScrollArea className="max-h-[60vh] sm:max-h-[360px]">
                  {isPending ? (
                    <div className="p-8 text-center text-muted-foreground">Duke ngarkuar...</div>
                  ) : groupedAll.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                      <Bell className="w-12 h-12 mx-auto mb-2 opacity-20" />
                      <p>Nuk ka njoftime ende</p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {groupedAll.map(group =>
                        group.kind === 'group' ? (
                          <GroupedNotificationItem
                            key={group.id}
                            group={group.items}
                            onMarkAsRead={handleMarkAsRead}
                            onDelete={handleDelete}
                            onClose={closeDropdown}
                          />
                        ) : (
                          <NotificationItem
                            key={group.id}
                            notification={group.items[0]}
                            onMarkAsRead={handleMarkAsRead}
                            onDelete={handleDelete}
                            onClose={closeDropdown}
                          />
                        )
                      )}
                      {hasMore && (
                        <button
                          className="w-full py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 flex items-center justify-center gap-1 transition-colors"
                          onClick={() => setDisplayLimit(prev => prev + LOAD_STEP)}
                        >
                          <ChevronDown className="w-4 h-4" />
                          Ngarko më shumë ({filteredByCategory.length - displayLimit} mbetën)
                        </button>
                      )}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// ── Preferences Panel ──────────────────────────────────────────────────────────
const PreferencesPanel: React.FC<{
  prefs: NotifPrefs;
  onSave: (prefs: NotifPrefs) => void;
  saving: boolean;
}> = ({ prefs, onSave, saving }) => {
  const toggleCategory = (cat: NotificationCategory) => {
    onSave({ ...prefs, categoryEnabled: { ...prefs.categoryEnabled, [cat]: !prefs.categoryEnabled[cat] } });
  };

  return (
    <ScrollArea className="max-h-[60vh] sm:max-h-[420px]">
      <div className="p-4 space-y-5">
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Kategorite e njoftimeve
          </h4>
          <div className="space-y-3.5">
            {NOTIFICATION_CATEGORIES.map(cat => (
              <div key={cat} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{CATEGORY_LABELS[cat]}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {CATEGORY_DESCRIPTIONS[cat]}
                  </p>
                </div>
                <Switch
                  checked={prefs.categoryEnabled[cat]}
                  onCheckedChange={() => toggleCategory(cat)}
                  disabled={saving}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="border-t pt-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Do Not Disturb
          </h4>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Moon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-sm font-medium">Mos shqetëso</p>
                <p className="text-xs text-muted-foreground">Suprimo push gjatë orëve të pushimit</p>
              </div>
            </div>
            <Switch
              checked={prefs.dndEnabled}
              onCheckedChange={() => onSave({ ...prefs, dndEnabled: !prefs.dndEnabled })}
              disabled={saving}
            />
          </div>
          {prefs.dndEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Nga</label>
                <input
                  type="time"
                  value={prefs.dndStart}
                  onChange={e => onSave({ ...prefs, dndStart: e.target.value })}
                  className="w-full text-sm border border-border rounded-md px-2 py-1.5 bg-background"
                  disabled={saving}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Deri</label>
                <input
                  type="time"
                  value={prefs.dndEnd}
                  onChange={e => onSave({ ...prefs, dndEnd: e.target.value })}
                  className="w-full text-sm border border-border rounded-md px-2 py-1.5 bg-background"
                  disabled={saving}
                />
              </div>
            </div>
          )}
        </div>

        {saving && (
          <p className="text-xs text-muted-foreground text-center italic">Duke ruajtur...</p>
        )}
      </div>
    </ScrollArea>
  );
};

// ── Grouped notification item ──────────────────────────────────────────────────
const GroupedNotificationItem: React.FC<{
  group: Notification[];
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}> = ({ group, onMarkAsRead, onDelete, onClose }) => {
  const [expanded, setExpanded] = useState(false);
  const config   = getConfig(group[0].type);
  const allRead  = group.every(n => n.isRead);
  const label    = groupLabelOf(group[0].type);

  return (
    <div className={`${!allRead && config.bgColor ? config.bgColor : !allRead ? 'bg-primary/5' : ''}`}>
      <button
        className="w-full p-4 text-left hover:bg-muted/50 transition-colors flex items-center gap-3"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-shrink-0">{config.icon}</div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-foreground">
            {group.length} {label}
          </p>
          <p className="text-xs text-muted-foreground">
            {expanded ? 'Kliko për të mbyllur' : 'Kliko për të parë të gjitha'}
          </p>
        </div>
        {!allRead && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
        <ChevronRight
          className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      {expanded && (
        <div className="border-t divide-y bg-muted/20">
          {group.map(n => (
            <NotificationItem
              key={n.id}
              notification={n}
              onMarkAsRead={onMarkAsRead}
              onDelete={onDelete}
              onClose={onClose}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Single notification item ───────────────────────────────────────────────────
const NotificationItem: React.FC<{
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}> = ({ notification, onMarkAsRead, onDelete, onClose }) => {
  const navigate = useNavigate();
  const config   = getConfig(notification.type);

  const timeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
    if (seconds < 60)    return 'tani';
    if (seconds < 3600)  return `${Math.floor(seconds / 60)}m më parë`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h më parë`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d më parë`;
    return new Date(date).toLocaleDateString('sq-AL');
  };

  const CHAT_TYPES = new Set(['client_message', 'staff_message', 'direct_message', 'mention']);
  const isChatType = CHAT_TYPES.has(notification.type || '');

  const hasAction = !!notification.linkTo || !!notification.actionUrl || isChatType;

  const handleAction = () => {
    if (!notification.isRead) onMarkAsRead(notification.id);
    onClose();
    // An explicit actionUrl is the most specific target and now wins over the
    // generic chat fallback — a `direct_message` carries actionUrl
    // `/app/chat?directUserId=…` and used to be swallowed by the type check below.
    if (notification.actionUrl?.startsWith('/')) {
      navigate(notification.actionUrl);
    } else if (notification.linkTo) {
      if (notification.linkTo.startsWith('/')) navigate(notification.linkTo);
      else navigate('/app/chat', { state: { channel: notification.linkTo } });
    } else if (isChatType) {
      navigate('/app/chat');
    }
  };

  const isUnread    = !notification.isRead;
  const borderClass = isUnread && config.borderColor ? `border-l-2 ${config.borderColor}` : '';
  const bgClass     = isUnread && config.bgColor ? config.bgColor : isUnread ? 'bg-primary/5' : '';
  const isChat      = isChatType || !!notification.linkTo;

  return (
    <div
      className={`p-4 hover:bg-muted/50 transition-colors ${borderClass} ${bgClass} ${hasAction ? 'cursor-pointer' : ''}`}
      onClick={hasAction ? handleAction : undefined}
    >
      <div className="flex gap-3">
        <div className="flex-shrink-0 mt-1">{config.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="font-medium text-sm text-foreground leading-snug">{notification.title}</p>
              {notification.message && (
                <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{notification.message}</p>
              )}
              {hasAction && (
                <Button
                  variant="outline"
                  size="sm"
                  className={`mt-2 h-7 text-xs gap-1 ${
                    config.priority === 'critical'
                      ? 'border-red-200 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400'
                      : config.priority === 'warning'
                      ? 'border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400'
                      : config.priority === 'success'
                      ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400'
                      : notification.type === 'task_collaborator_added' || notification.type === 'task_mention'
                      ? 'border-primary/30 text-primary hover:bg-accent-soft dark:border-primary/40 dark:text-primary'
                      : ''
                  }`}
                  onClick={(e) => { e.stopPropagation(); handleAction(); }}
                >
                  {isChat
                    ? <><MessageSquare className="w-3 h-3" />Hap Chat</>
                    : <><ExternalLink className="w-3 h-3" />{notification.actionLabel || 'Shiko'}</>
                  }
                </Button>
              )}
              <p className="text-xs text-muted-foreground mt-2">{timeAgo(notification.createdAt)}</p>
            </div>
            {isUnread && (
              <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${
                config.priority === 'critical' ? 'bg-red-500' :
                config.priority === 'warning'  ? 'bg-amber-500' :
                config.priority === 'success'  ? 'bg-emerald-500' :
                'bg-primary'
              }`} />
            )}
          </div>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          {isUnread && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => { e.stopPropagation(); onMarkAsRead(notification.id); }}
            >
              <Check className="w-4 h-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-error hover:text-error"
            onClick={(e) => { e.stopPropagation(); onDelete(notification.id); }}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotificationsCenter;
