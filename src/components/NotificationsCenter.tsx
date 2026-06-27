import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCollection, useMutation } from '../hooks/useFirestore';
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

// ── Priority config ────────────────────────────────────────────────────────────
type Priority = 'critical' | 'warning' | 'success' | 'info' | 'neutral';

interface TypeConfig {
  icon: React.ReactNode;
  priority: Priority;
  borderColor: string;
  bgColor: string;
}

const TYPE_CONFIG: Record<string, TypeConfig> = {
  // Critical — overdue
  task_overdue:             { icon: <AlertCircle className="w-4 h-4 text-red-500" />,      priority: 'critical', borderColor: 'border-l-red-500',     bgColor: 'bg-red-50/60 dark:bg-red-950/20' },
  invoice_overdue:          { icon: <AlertCircle className="w-4 h-4 text-red-500" />,      priority: 'critical', borderColor: 'border-l-red-500',     bgColor: 'bg-red-50/60 dark:bg-red-950/20' },
  goal_overdue:             { icon: <Target className="w-4 h-4 text-red-500" />,           priority: 'critical', borderColor: 'border-l-red-500',     bgColor: 'bg-red-50/60 dark:bg-red-950/20' },
  // Warning — due soon / follow-up
  task_due_soon:            { icon: <Clock className="w-4 h-4 text-amber-500" />,          priority: 'warning',  borderColor: 'border-l-amber-500',   bgColor: 'bg-amber-50/60 dark:bg-amber-950/20' },
  lead_follow_up:           { icon: <Clock className="w-4 h-4 text-amber-500" />,          priority: 'warning',  borderColor: 'border-l-amber-500',   bgColor: 'bg-amber-50/60 dark:bg-amber-950/20' },
  invoice_reminder_sent:    { icon: <FileText className="w-4 h-4 text-amber-500" />,       priority: 'warning',  borderColor: 'border-l-amber-500',   bgColor: 'bg-amber-50/60 dark:bg-amber-950/20' },
  project_open_reminder:    { icon: <Calendar className="w-4 h-4 text-amber-500" />,       priority: 'warning',  borderColor: 'border-l-amber-500',   bgColor: 'bg-amber-50/60 dark:bg-amber-950/20' },
  // Success
  invoice_paid:             { icon: <DollarSign className="w-4 h-4 text-emerald-500" />,   priority: 'success',  borderColor: 'border-l-emerald-500', bgColor: 'bg-emerald-50/60 dark:bg-emerald-950/20' },
  goal_achieved:            { icon: <CheckCircle className="w-4 h-4 text-emerald-500" />,  priority: 'success',  borderColor: 'border-l-emerald-500', bgColor: 'bg-emerald-50/60 dark:bg-emerald-950/20' },
  project_completed:        { icon: <CheckCircle className="w-4 h-4 text-emerald-500" />,  priority: 'success',  borderColor: 'border-l-emerald-500', bgColor: 'bg-emerald-50/60 dark:bg-emerald-950/20' },
  lead_converted:           { icon: <TrendingUp className="w-4 h-4 text-emerald-500" />,   priority: 'success',  borderColor: 'border-l-emerald-500', bgColor: 'bg-emerald-50/60 dark:bg-emerald-950/20' },
  quote_accepted:           { icon: <CheckCircle className="w-4 h-4 text-emerald-500" />,  priority: 'success',  borderColor: 'border-l-emerald-500', bgColor: 'bg-emerald-50/60 dark:bg-emerald-950/20' },
  quote_rejected:           { icon: <XCircle className="w-4 h-4 text-red-500" />,          priority: 'warning',  borderColor: 'border-l-red-500',     bgColor: 'bg-red-50/60 dark:bg-red-950/20' },
  // Info — assignments & collaboration
  task_assigned:            { icon: <User className="w-4 h-4 text-blue-500" />,            priority: 'info',     borderColor: 'border-l-blue-500',    bgColor: 'bg-blue-50/60 dark:bg-blue-950/20' },
  task_collaborator_added:  { icon: <Users className="w-4 h-4 text-violet-500" />,         priority: 'info',     borderColor: 'border-l-violet-500',  bgColor: 'bg-violet-50/60 dark:bg-violet-950/20' },
  task_mention:             { icon: <MessageSquare className="w-4 h-4 text-violet-500" />, priority: 'info',     borderColor: 'border-l-violet-500',  bgColor: 'bg-violet-50/60 dark:bg-violet-950/20' },
  lead_assigned:            { icon: <User className="w-4 h-4 text-blue-500" />,            priority: 'info',     borderColor: 'border-l-blue-500',    bgColor: 'bg-blue-50/60 dark:bg-blue-950/20' },
  goal_assigned:            { icon: <Target className="w-4 h-4 text-blue-500" />,          priority: 'info',     borderColor: 'border-l-blue-500',    bgColor: 'bg-blue-50/60 dark:bg-blue-950/20' },
  project_status_changed:   { icon: <Zap className="w-4 h-4 text-blue-500" />,             priority: 'info',     borderColor: 'border-l-blue-500',    bgColor: 'bg-blue-50/60 dark:bg-blue-950/20' },
  // Messages
  client_message:           { icon: <MessageSquare className="w-4 h-4 text-emerald-500" />, priority: 'info',   borderColor: 'border-l-emerald-500', bgColor: 'bg-emerald-50/60 dark:bg-emerald-950/20' },
  staff_message:            { icon: <MessageSquare className="w-4 h-4 text-blue-500" />,   priority: 'info',     borderColor: 'border-l-blue-500',    bgColor: 'bg-blue-50/60 dark:bg-blue-950/20' },
  project_comment:          { icon: <MessageSquare className="w-4 h-4 text-blue-500" />,   priority: 'info',     borderColor: 'border-l-blue-500',    bgColor: 'bg-blue-50/60 dark:bg-blue-950/20' },
  client_request:           { icon: <MessageSquare className="w-4 h-4 text-emerald-500" />, priority: 'info',   borderColor: 'border-l-emerald-500', bgColor: 'bg-emerald-50/60 dark:bg-emerald-950/20' },
  // Projects / invoices
  project_created:          { icon: <Zap className="w-4 h-4 text-blue-500" />,             priority: 'neutral',  borderColor: '',                     bgColor: '' },
  auto_invoice_created:     { icon: <FileText className="w-4 h-4 text-blue-500" />,        priority: 'neutral',  borderColor: '',                     bgColor: '' },
  invoice_created:          { icon: <FileText className="w-4 h-4 text-blue-500" />,        priority: 'neutral',  borderColor: '',                     bgColor: '' },
  // Recurring / automation
  recurring_task_created:   { icon: <RefreshCw className="w-4 h-4 text-indigo-500" />,     priority: 'neutral',  borderColor: '',                     bgColor: '' },
  recurring_expense_created:{ icon: <RefreshCw className="w-4 h-4 text-indigo-500" />,     priority: 'neutral',  borderColor: '',                     bgColor: '' },
  project_cycle_reset:      { icon: <RefreshCw className="w-4 h-4 text-indigo-500" />,     priority: 'neutral',  borderColor: '',                     bgColor: '' },
  // Expenses
  expense_submitted:        { icon: <DollarSign className="w-4 h-4 text-blue-500" />,      priority: 'neutral',  borderColor: '',                     bgColor: '' },
  // Guest access
  guest_project_invited:    { icon: <UserPlus className="w-4 h-4 text-amber-500" />,       priority: 'info',     borderColor: 'border-l-amber-500',   bgColor: 'bg-amber-50/60 dark:bg-amber-950/20' },
  guest_task_new:           { icon: <Plus className="w-4 h-4 text-amber-500" />,           priority: 'neutral',  borderColor: '',                     bgColor: '' },
  guest_task_update:        { icon: <Eye className="w-4 h-4 text-amber-500" />,            priority: 'neutral',  borderColor: '',                     bgColor: '' },
  // Daily report blocker
  blocker_reported:         { icon: <AlertCircle className="w-4 h-4 text-red-500" />,      priority: 'warning',  borderColor: 'border-l-red-500',     bgColor: 'bg-red-50/60 dark:bg-red-950/20' },
};

const DEFAULT_CONFIG: TypeConfig = {
  icon: <Info className="w-4 h-4 text-muted-foreground" />,
  priority: 'neutral',
  borderColor: '',
  bgColor: '',
};

function getConfig(type?: string): TypeConfig {
  if (type && TYPE_CONFIG[type]) return TYPE_CONFIG[type];
  return DEFAULT_CONFIG;
}

// ── Category filter ────────────────────────────────────────────────────────────
type Category = 'all' | 'tasks' | 'messages' | 'projects' | 'invoices';

const CATEGORY_TYPES: Record<Exclude<Category, 'all'>, string[]> = {
  tasks:    ['task_overdue', 'task_due_soon', 'task_assigned', 'task_collaborator_added', 'task_mention', 'recurring_task_created', 'goal_overdue', 'goal_assigned', 'goal_achieved', 'blocker_reported'],
  messages: ['client_message', 'staff_message', 'project_comment', 'client_request'],
  projects: ['project_created', 'project_completed', 'project_open_reminder', 'project_cycle_reset', 'lead_converted', 'lead_assigned', 'lead_follow_up', 'guest_project_invited', 'guest_task_new', 'guest_task_update', 'project_status_changed'],
  invoices: ['invoice_overdue', 'invoice_paid', 'invoice_reminder_sent', 'auto_invoice_created', 'invoice_created', 'recurring_expense_created', 'expense_submitted', 'quote_accepted', 'quote_rejected'],
};

const CATEGORY_LABELS: Record<Category, string> = {
  all:      'Të gjitha',
  tasks:    'Detyra',
  messages: 'Mesazhe',
  projects: 'Projekte',
  invoices: 'Fatura',
};

// ── Notification grouping ──────────────────────────────────────────────────────
interface NotifGroup {
  id: string;
  kind: 'single' | 'group';
  items: Notification[];
}

const ONE_HOUR = 60 * 60 * 1000;

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
      if (diff > ONE_HOUR) break;
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
  categoryEnabled: { tasks: boolean; messages: boolean; projects: boolean; invoices: boolean };
  emailEnabled: boolean;
  pushEnabled: boolean;
  soundEnabled: boolean;
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
}

const DEFAULT_PREFS: NotifPrefs = {
  categoryEnabled: { tasks: true, messages: true, projects: true, invoices: true },
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
    categoryEnabled: { ...DEFAULT_PREFS.categoryEnabled, ...(raw.categoryEnabled || {}) },
  };
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
function isTypeMuted(type: string | undefined, prefs: NotifPrefs): boolean {
  if (!type) return false;
  for (const [cat, types] of Object.entries(CATEGORY_TYPES) as [Exclude<Category, 'all'>, string[]][]) {
    if (types.includes(type) && !prefs.categoryEnabled[cat]) return true;
  }
  return false;
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
      if (snap.exists()) {
        const merged = mergePrefs(snap.data() as Partial<NotifPrefs>);
        setLocalPrefs(merged);
        localStorage.setItem(`notif_prefs_${user.uid}`, JSON.stringify(merged));
      }
    }).catch(() => { /* offline */ });
  }, [user?.uid]);

  // ── Real-time alert (toast + chime) when a brand-new notification arrives ──
  const lastNotifIdRef = useRef<string | null>(null);
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
    // First load: remember the newest without alerting (avoids a chime on every refresh)
    if (lastNotifIdRef.current === null) {
      lastNotifIdRef.current = newest.id;
      return;
    }
    if (newest.id === lastNotifIdRef.current) return;
    lastNotifIdRef.current = newest.id;
    // Only alert for a fresh, unread notification, respecting DND + category mute
    if (newest.isRead) return;
    if (isInDndWindow(localPrefs)) return;
    if (isTypeMuted(newest.type, localPrefs)) return;
    toast({ title: newest.title, description: newest.message });
    // Chat messages already get their own sound from the chat UI (Sidebar chime /
    // ChatView chirp). Skip the chime here for those types to avoid a double sound
    // on message arrival; keep it for all other notifications.
    const CHAT_MSG_TYPES = new Set(['client_message', 'staff_message']);
    if (localPrefs.soundEnabled !== false && !CHAT_MSG_TYPES.has(newest.type || '')) playChime();
  }, [notifications, localPrefs, playChime]);

  // Filter out muted categories
  const activeNotifications = useMemo(() => {
    if (!notifications) return [];
    return notifications.filter(n => {
      if (!n.type) return true;
      for (const [cat, types] of Object.entries(CATEGORY_TYPES) as [Exclude<Category, 'all'>, string[]][]) {
        if (types.includes(n.type) && !localPrefs.categoryEnabled[cat]) return false;
      }
      return true;
    });
  }, [notifications, localPrefs]);

  // Filter by selected category chip
  const filteredByCategory = useMemo(() => {
    if (category === 'all') return activeNotifications;
    return activeNotifications.filter(n => CATEGORY_TYPES[category].includes(n.type || ''));
  }, [activeNotifications, category]);

  const unreadCount         = activeNotifications.filter(n => !n.isRead).length;
  const unreadClientCount   = activeNotifications.filter(n => !n.isRead && n.type === 'client_message').length;
  const unreadMentionCount  = activeNotifications.filter(n => !n.isRead && (n.type === 'task_mention' || n.type === 'task_collaborator_added')).length;
  const criticalCount       = activeNotifications.filter(n => !n.isRead && getConfig(n.type).priority === 'critical').length;

  const handleMarkAsRead = async (id: string) => {
    await notificationMutation.update(id, { isRead: true });
  };

  const handleMarkAllAsRead = async () => {
    const unread = activeNotifications.filter(n => !n.isRead);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    for (const n of unread) {
      batch.update(doc(db, 'notifications', n.id), { isRead: true });
    }
    await batch.commit();
  };

  const handleDelete = async (id: string) => {
    await notificationMutation.remove(id);
  };

  const savePrefs = async (newPrefs: NotifPrefs) => {
    if (!user) return;
    setLocalPrefs(newPrefs);
    localStorage.setItem(`notif_prefs_${user.uid}`, JSON.stringify(newPrefs));
    setSavingPrefs(true);
    try {
      await setDoc(doc(db, 'userPreferences', user.uid), newPrefs, { merge: true });
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
          className="bg-white/10 text-primary-foreground hover:bg-white/20 relative"
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
                  ? 'bg-violet-500 text-white'
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
            {!showPrefs && unreadCount > 0 && (
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
              {(['all', 'tasks', 'messages', 'projects', 'invoices'] as Category[]).map(cat => (
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
  const toggleCategory = (cat: Exclude<Category, 'all'>) => {
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
            {(['tasks', 'messages', 'projects', 'invoices'] as Exclude<Category, 'all'>[]).map(cat => (
              <div key={cat} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{CATEGORY_LABELS[cat]}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {cat === 'tasks'    && 'Detyra, afate, objektiva, cikle'}
                    {cat === 'messages' && 'Chat, komente, kërkesa klientësh'}
                    {cat === 'projects' && 'Projekte, leads, status, guests'}
                    {cat === 'invoices' && 'Fatura, pagesa, shpenzime'}
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

// ── Group labels ───────────────────────────────────────────────────────────────
const GROUP_TYPE_LABEL: Record<string, string> = {
  task_assigned:           'caktime detyrash',
  task_overdue:            'detyra të skaduara',
  task_due_soon:           'detyra me afat',
  task_mention:            'përmendje',
  task_collaborator_added: 'shtesa si bashkëpunëtor',
  client_message:          'mesazhe klienti',
  staff_message:           'mesazhe stafi',
  invoice_overdue:         'fatura të skaduara',
  invoice_paid:            'pagesa faturash',
  lead_assigned:           'lead të caktuar',
  lead_follow_up:          'rikontaktime lead',
  recurring_task_created:  'detyra periodike',
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
  const label    = GROUP_TYPE_LABEL[group[0].type || ''] || 'njoftime';

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

  const hasAction = notification.linkTo || notification.actionUrl ||
    notification.type === 'client_message' || notification.type === 'staff_message';

  const handleAction = () => {
    if (!notification.isRead) onMarkAsRead(notification.id);
    onClose();
    if (notification.linkTo) {
      if (notification.linkTo.startsWith('/')) navigate(notification.linkTo);
      else navigate('/app/chat', { state: { channel: notification.linkTo } });
    } else if (notification.type === 'client_message' || notification.type === 'staff_message') {
      navigate('/app/chat');
    } else if (notification.actionUrl) {
      navigate(notification.actionUrl);
    }
  };

  const isUnread    = !notification.isRead;
  const borderClass = isUnread && config.borderColor ? `border-l-2 ${config.borderColor}` : '';
  const bgClass     = isUnread && config.bgColor ? config.bgColor : isUnread ? 'bg-primary/5' : '';
  const isChat      = notification.type === 'client_message' || notification.type === 'staff_message' || !!notification.linkTo;

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
                      ? 'border-violet-200 text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-400'
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
