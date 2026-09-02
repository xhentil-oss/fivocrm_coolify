import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useUniqueTeamMembers } from '../hooks/useRoleFilteredData';
import { TaskLabels, LabelEditor } from './TaskLabels';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { completeTask, addFrequency, recurrenceDayOfWeek, recurrenceDayOfMonth, hasLiveSeriesSibling } from '../lib/recurringUtils';
import { deleteTaskCascade } from '../lib/deleteCascade';
import { claimTaskNextCycle, releaseTaskNextCycle } from '../lib/taskRecurrenceClaim';
import { entryDurationMinutes, totalTrackedMinutes } from '../lib/timeTracking';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useActivityLogger } from '../hooks/useActivityLogger';
import { useGoogleApi, DriveFile } from '../contexts/GoogleApiContext';
import {
  Calendar as CalendarIcon,
  MessageSquare,
  Users,
  ChevronDown,
  Clock,
  Play,
  Square,
  Paperclip,
  Upload,
  X,
  Eye,
  Plus,
  Trash2,
  Send,
  Check,
  Cloud,
  Maximize2,
  Minimize2,
  ImageIcon,
  Loader2,
  FileText,
  Download,
  SmilePlus,
  Search,
} from 'lucide-react';
import GoogleDrivePicker from './GoogleDrivePicker';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Calendar } from './ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Checkbox } from './ui/checkbox';
import { ScrollArea } from './ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import RichTextEditor, { RichTextDisplay } from './RichTextEditor';
import { toast } from '../hooks/use-toast';
import { useFileUpload } from '../hooks/useFileUpload';
import { useCommentFocus, COMMENT_FLASH_CLASS } from '../hooks/useCommentFocus';
import { taskDeepLink } from '../lib/deepLinks';
import { taskCompletedNotifications } from '../lib/taskNotifications';
import type { Task, TaskComment } from '../types';

// Quick-reaction emoji set — mirrors the chat reactions for a consistent feel.
const COMMENT_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

// ── Redesign (Aug 2026, Claude Design "Detyrat e Krijuara" + "Detyra e Krijuar
// Mobile") ─────────────────────────────────────────────────────────────────────
// The panel owns its own overlay: a centered 660px dialog on desktop, a bottom
// sheet on mobile. Status is a pill dropdown; the project and the assignee are
// picked through searchable pickers (anchored dropdown on desktop, full-screen
// sheet on mobile); dates/recurrence/priority are one-tap chips. Both mounts
// (TasksView, ProjectDetailView) render the SAME component with no wrapper.

const STATUS_OPTS: Array<{ v: string; label: string; dot: string; pill: string }> = [
  { v: 'Todo', label: 'Për të bërë', dot: '#94A5BD', pill: 'bg-slate-200/80 text-slate-700 dark:bg-slate-700 dark:text-slate-300' },
  { v: 'In Progress', label: 'Në progres', dot: '#0EA5E9', pill: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  { v: 'Review', label: 'Rishikim', dot: '#D9A514', pill: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  { v: 'Done', label: 'E përfunduar', dot: '#22A565', pill: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
];

/** Deterministic HSL colour from a name — used for project dots + avatars. */
const hashColor = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 55%, 42%)`;
};

/** One-tap selection chip (dates, recurrence, priority). Active = filled navy. */
const chipCls = (on: boolean) =>
  `rounded-full border-[1.5px] px-3 py-[5px] text-xs font-semibold transition-colors ${
    on ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-muted-foreground hover:border-primary'
  }`;

/** Searchable picker body — anchored dropdown on sm+, full-screen bottom sheet
 * on mobile (the two design variants share this one implementation). */
const PickerPanel: React.FC<{
  title: string;
  searchPlaceholder: string;
  query: string;
  onQuery: (v: string) => void;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, searchPlaceholder, query, onQuery, onClose, children }) => (
  <div
    className="max-sm:fixed max-sm:inset-0 max-sm:z-[70] max-sm:flex max-sm:flex-col max-sm:justify-end max-sm:bg-[#0C1B33]/50 sm:absolute sm:left-0 sm:top-[calc(100%+6px)] sm:z-40"
    onClick={(e) => { e.stopPropagation(); onClose(); }}
  >
    <div
      className="flex flex-col bg-background max-sm:h-[78dvh] max-sm:rounded-t-[22px] max-sm:shadow-[0_-12px_40px_rgba(4,12,30,.4)] sm:w-[330px] sm:overflow-hidden sm:rounded-[14px] sm:border sm:shadow-[0_14px_36px_rgba(12,27,51,.22)]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex justify-center pb-0.5 pt-2 sm:hidden">
        <span className="h-[5px] w-[38px] rounded-full bg-border" />
      </div>
      <div className="flex items-center gap-2 px-4 pb-1.5 pt-1 sm:hidden">
        <span className="flex-1 text-[14.5px] font-extrabold text-foreground">{title}</span>
        <button type="button" onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">✕</button>
      </div>
      <div className="px-3 pb-2 pt-2.5">
        <div className="flex items-center gap-2 rounded-full border bg-muted/50 px-3.5 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full min-w-[40px] bg-transparent text-[13px] font-semibold text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          {query && (
            <button type="button" onClick={() => onQuery('')} className="shrink-0 text-[11px] text-muted-foreground">✕</button>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-px overflow-y-auto px-2 pb-3 sm:max-h-[258px]">{children}</div>
    </div>
  </div>
);

interface TaskDetailPanelProps {
  task: Task;
  onClose: () => void;
  onExpand?: () => void;
  isExpanded?: boolean;
  comments: TaskComment[];
  /** Returns the created comment (with its id) when the caller can provide it —
   *  that id becomes the deep link carried by the comment notifications. */
  onAddComment: (taskId: string, content: string, opts?: { visibleToClient?: boolean }) => void | Promise<any>;
  /** Comment to scroll to + flash, set when arriving from a notification. */
  focusCommentId?: string | null;
  onEditComment?: (commentId: string, content: string) => void | Promise<any>;
  onDeleteComment?: (commentId: string) => void | Promise<any>;
  onToggleReaction?: (commentId: string, emoji: string) => void | Promise<any>;
  onUpdate: (id: string, data: any) => Promise<any>;
  onDelete: (id: string) => Promise<any>;
  projects?: { id: string; name: string }[];
  projectsLoading?: boolean;
  allTasks?: Task[];
  onSelectSubtask?: (subtask: Task) => void;
  isProjectGuest?: boolean;
}

const TaskDetailPanel: React.FC<TaskDetailPanelProps> = ({
  task,
  onClose,
  onExpand,
  isExpanded,
  comments,
  onAddComment,
  focusCommentId,
  onEditComment,
  onDeleteComment,
  onToggleReaction,
  onUpdate,
  onDelete,
  projects = [],
  projectsLoading = false,
  allTasks,
  onSelectSubtask,
  isProjectGuest = false,
}) => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const isGuestMode = permissions.isGuest || isProjectGuest;
  // Deep link from a comment notification → scroll to that comment and flash it.
  const { registerComment, isFlashing } = useCommentFocus(focusCommentId);
  const { isConnected: isGoogleConnected } = useGoogleApi();
  const { upload: uploadCommentImage, uploading: commentImageUploading } = useFileUpload();
  const commentFileInputRef = useRef<HTMLInputElement | null>(null);
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const handleCommentImageUpload = async (file: File) => {
    if (!/^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(file.type)) {
      toast({ title: 'Format i pasaktë', description: 'Lejohen vetëm PNG, JPG, GIF, WEBP, SVG.', variant: 'destructive' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Imazhi shumë i madh', description: 'Maksimumi 5 MB.', variant: 'destructive' });
      return;
    }
    try {
      const res = await uploadCommentImage(file, 'comment-images');
      setCommentText(prev => (prev ? prev.trimEnd() + ' ' : '') + res.url + ' ');
    } catch (err) {
      toast({ title: 'Ngarkimi dështoi', description: (err as Error)?.message || 'Provo përsëri.', variant: 'destructive' });
    }
  };
  const [commentText, setCommentText] = useState('');
  // Per-comment client visibility (opt-in; resets after every send).
  const [commentVisibleToClient, setCommentVisibleToClient] = useState(false);
  const [mentionMap, setMentionMap] = useState<Record<string, string>>({}); // displayName → uid
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [confirmDeleteCommentId, setConfirmDeleteCommentId] = useState<string | null>(null);
  // Which comment's emoji picker is open (WhatsApp/Slack-style reactions on comments).
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  const toggleReaction = (commentId: string, emoji: string) => {
    setReactionPickerId(null);
    onToggleReaction?.(commentId, emoji);
  };

  const startEditComment = (c: TaskComment) => {
    setConfirmDeleteCommentId(null);
    setEditingCommentId(c.id);
    // Show the human-readable text (strip the @[Name](uid) storage format).
    setEditingCommentText((c.content || '').replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1'));
  };
  const saveEditComment = async () => {
    const id = editingCommentId;
    const text = editingCommentText.trim();
    if (!id || !text) return;
    await onEditComment?.(id, text);
    setEditingCommentId(null);
    setEditingCommentText('');
  };
  const deleteComment = async (id: string) => {
    await onDeleteComment?.(id);
    setConfirmDeleteCommentId(null);
  };

  // Auto-grow the comment composer so the whole comment is visible (grows on
  // type/mention-insert, shrinks back after submit clears the text).
  useEffect(() => {
    const el = commentInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [commentText]);
  // (a `showSubtasks` toggle used to live here; the collapse control it drove was
  //  removed, so the state was dead — subtasks are always shown.)
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleText, setTitleText] = useState(task.title);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionText, setDescriptionText] = useState(task.description || '');
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [chatMessageText, setChatMessageText] = useState('');
  const [showChat, setShowChat] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const [editingSubtask, setEditingSubtask] = useState<string | null>(null);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  // Recurring edit state
  const [editingRecurring, setEditingRecurring] = useState(false);
  const [recurringDayOfWeek, setRecurringDayOfWeek] = useState<number>((task as any).recurringDayOfWeek ?? 1);
  const [recurringDaysOfWeek, setRecurringDaysOfWeek] = useState<number[]>((task as any).recurringDaysOfWeek ?? [1,2,3,4,5]);
  const toggleRecurringDay = (day: number) => {
    setRecurringDaysOfWeek(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b)
    );
  };
  const saveRecurring = async () => {
    if (task.recurringFrequency === 'weekly') {
      await onUpdate(task.id, { recurringDayOfWeek });
    } else if (task.recurringFrequency === 'daily') {
      await onUpdate(task.id, { recurringDaysOfWeek });
    }
    setEditingRecurring(false);
  };
  // Turn an existing (non-recurring) task into a recurring one. Anchors on the
  // task's due date (or today) and seeds the day-of-week/month + next occurrence.
  const enableRecurring = async (freq: 'daily' | 'weekly' | 'monthly' | 'yearly') => {
    const base = task.endDate ? new Date(task.endDate) : new Date();
    // Zone-explicit getters: a browser outside Europe/Tirane would otherwise
    // store a weekday/day the recurrence engine disagrees with.
    const dow = recurrenceDayOfWeek(base);
    const dom = recurrenceDayOfMonth(base);
    const defaultDays = [1, 2, 3, 4, 5];
    // Seed the next occurrence in the FUTURE: for an old/Done tip the naive
    // (base + frequency) lands in the past, and the cron backstop would spawn
    // immediately — forking a second series next to the already-spawned child.
    const rawNext = addFrequency(base, freq, dow, dom, 1, defaultDays);
    const next = rawNext.getTime() < Date.now()
      ? addFrequency(new Date(), freq, dow, dom, 1, defaultDays)
      : rawNext;
    // Re-arm the spawn flag only when the series has no live occurrence —
    // same guard as re-opening (see hasLiveSeriesSibling).
    const mayRearm = task.status !== 'Done' || !hasLiveSeriesSibling(task, allTasks);
    await onUpdate(task.id, {
      isRecurring: true,
      recurringFrequency: freq,
      recurringInterval: 1,
      ...(freq === 'weekly' ? { recurringDayOfWeek: dow } : {}),
      ...(freq === 'monthly' ? { recurringDayOfMonth: dom } : {}),
      ...(freq === 'daily' ? { recurringDaysOfWeek: defaultDays } : {}),
      // Recurrence needs BOTH date anchors: the cron backstop refuses a tip
      // missing startDate or endDate, so backfilling only endDate produced
      // series the cron could never rescue.
      ...(task.endDate ? {} : { endDate: base }),
      ...(task.startDate ? {} : { startDate: base }),
      nextRecurringDate: next,
      ...(mayRearm ? { nextCycleCreated: false } : {}),
    } as any);
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  
  // Subtask form state
  const [subtaskForm, setSubtaskForm] = useState({
    title: '',
    description: '',
    status: 'Todo',
    priority: 'medium',
    startDate: new Date(),
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    assignedToUserId: '',
  });
  
  // Safe date parser for Firestore Timestamps / Date / string / undefined
  const parseDate = (date: any): Date => {
    if (!date) return new Date();
    if (date instanceof Date) return date;
    if (date.toDate) return date.toDate();
    const parsed = new Date(date);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  };

  // Date editing state
  const [startDate, setStartDate] = useState<Date>(parseDate(task.startDate));
  const [endDate, setEndDate] = useState<Date>(parseDate(task.endDate));
  const [blockerSearch, setBlockerSearch] = useState('');

  // Time tracking state
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const { data: subtasks } = useCollection<Task>('tasks', {
    where: [{ field: 'parentTaskId', operator: '==', value: task.id }]
  });
  
  const { data: taskCollaborators } = useCollection<any>('taskCollaborators', {
    where: [{ field: 'taskId', operator: '==', value: task.id }]
  });

  const { data: timeEntries } = useCollection<any>('timeEntries', {
    where: [{ field: 'taskId', operator: '==', value: task.id }],
    orderBy: { field: 'startTime', direction: 'desc' }
  });

  const { data: taskMessages, loading: isLoadingMessages } = useCollection<any>('messages', {
    where: [{ field: 'taskId', operator: '==', value: task.id }],
    orderBy: { field: 'createdAt', direction: 'asc' },
    // Query server-side by taskId (uses messages: taskId,createdAt index) instead of
    // downloading the whole team's messages and filtering client-side.
    skipTeamFilter: true,
    // Only listen while the panel is actually open. It used to subscribe on every
    // task open, so most tasks paid for a listener nobody looked at.
    skip: !showChat,
  });

  const { data: allActiveTimeEntries } = useCollection<any>('timeEntries', {
    where: [{ field: 'endTime', operator: '==', value: null }]
  });

  const { data: rawTeamMembers } = useCollection<any>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }]
  });
  const teamMembers = useUniqueTeamMembers(rawTeamMembers);
  // Label autocomplete: every label already used across the workspace's tasks.
  const labelSuggestions = useMemo(() => {
    const s = new Set<string>();
    (allTasks || []).forEach(t => ((t as any).labels as string[] | undefined)?.forEach(l => s.add(l)));
    return Array.from(s).sort();
  }, [allTasks]);
  // Per-task activity history (Jira-style audit tab). Single where = index-free.
  const { data: rawTaskActivities } = useCollection<any>('activities', {
    skip: !task.id,
    where: [{ field: 'entityId', operator: '==', value: task.id }],
  });
  const taskActivities = useMemo(() => {
    const ms = (d: any) => d instanceof Date ? d.getTime() : (d?.toMillis?.() ?? 0);
    return [...(rawTaskActivities || [])].sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).slice(0, 30);
  }, [rawTaskActivities]);

  const { data: userProfiles } = useCollection<any>('userProfiles');
  const { data: teams } = useCollection<any>('teams');


  const taskMutation = useMutation<Task>('tasks');
  const timeEntryMutation = useMutation<any>('timeEntries');
  const notificationMutation = useMutation<any>('notifications');
  const messageMutation = useMutation<any>('messages');
  const logActivity = useActivityLogger();
  const manualInputRef = useRef<string>('');

  // Helper for priority colors
  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'urgent':
        return 'bg-error text-error-foreground';
      case 'high':
        return 'bg-warning text-warning-foreground';
      case 'medium':
        return 'bg-info text-info-foreground';
      case 'low':
        return 'bg-success text-success-foreground';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getPriorityLabel = (priority?: string) => {
    switch (priority) {
      case 'urgent': return 'Urgjent';
      case 'high': return 'Lartë';
      case 'medium': return 'Mesatar';
      case 'low': return 'Ulët';
      default: return 'Mesatar';
    }
  };

  // Parse attachments from JSON
  const attachments = React.useMemo(() => {
    if (!task.attachments) return [];
    try {
      return JSON.parse(task.attachments);
    } catch (e) {
      console.error('Corrupted attachments JSON for task', task.id, e);
      return [];
    }
  }, [task.attachments]);

  // Users currently working on this task
  const activeWorkers = React.useMemo(() => {
    if (!allActiveTimeEntries) return [];
    return allActiveTimeEntries.filter(entry => entry.taskId === task.id && entry.userId !== user?.uid);
  }, [allActiveTimeEntries, task.id, user?.uid]);

  // Resolve display name for a user ID
  const getUserDisplayName = React.useCallback((userId: string) => {
    if (userId === user?.uid) return user.displayName || user.email?.split('@')[0] || 'Ti';
    const profile = userProfiles?.find(p => p.userId === userId);
    if (profile?.displayName) return profile.displayName;
    const member = teamMembers?.find(m => m.userId === userId);
    if (member?.displayName) return member.displayName;
    if (member?.email) return member.email.split('@')[0];
    return userId.slice(0, 12);
  }, [user, userProfiles, teamMembers]);

  // Build full mentionable list: teamMembers + team owners who may lack a teamMembers record
  const allMentionable = React.useMemo(() => {
    const list = [...(teamMembers || [])];
    const existingUserIds = new Set(list.map(m => m.userId));
    // Include team owners (Admin/CEO) who don't have a teamMembers entry
    if (teams) {
      for (const team of teams) {
        const ownerId = team.createdByUserId;
        if (ownerId && !existingUserIds.has(ownerId)) {
          existingUserIds.add(ownerId);
          list.push({ id: `owner-${ownerId}`, userId: ownerId, role: 'Admin', status: 'Active' });
        }
      }
    }
    return list;
  }, [teamMembers, teams]);

  // Filter mentionable users for @mention suggestions
  const mentionSuggestions = React.useMemo(() => {
    if (!allMentionable.length) return [];
    const others = allMentionable.filter(m => m.userId !== user?.uid);
    if (!mentionQuery) return others.slice(0, 5);
    const query = mentionQuery.toLowerCase();
    return others.filter(m => {
      const displayName = getUserDisplayName(m.userId).toLowerCase();
      return displayName.includes(query) || m.userId.toLowerCase().includes(query);
    }).slice(0, 5);
  }, [allMentionable, mentionQuery, getUserDisplayName, user?.uid]);

  // Find running entry for this task
  const runningEntry = React.useMemo(() => {
    if (!timeEntries || !user) return null;
    return timeEntries.find(entry => !entry.endTime && entry.userId === user.uid);
  }, [timeEntries, user]);

  // Update elapsed time
  useEffect(() => {
    if (runningEntry) {
      const updateElapsed = () => {
        const elapsed = Math.floor((Date.now() - new Date(runningEntry.startTime).getTime()) / 1000);
        setElapsedSeconds(elapsed);
      };
      
      updateElapsed();
      timerIntervalRef.current = setInterval(updateElapsed, 1000);
    } else {
      setElapsedSeconds(0);
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [runningEntry]);

  // Reset state when task changes
  // Reset local edit state ONLY when switching to a different task. Keying on
  // task.title/description/dates would re-run on every live Firestore update and
  // clobber an in-progress edit (e.g. rescheduling the date while typing the
  // description would wipe the draft).
  useEffect(() => {
    setTitleText(task.title);
    setDescriptionText(task.description || '');
    setStartDate(parseDate(task.startDate));
    setEndDate(parseDate(task.endDate));
    setShowSubtaskForm(false);
    setEditingSubtask(null);
    setIsEditingTitle(false);
    resetSubtaskForm();
    setChatMessageText('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  // Dates, unlike title/description, are NOT a typed draft — every date/time
  // edit persists immediately — so they can safely follow live Firestore
  // updates. Without this, a reschedule made elsewhere while the panel is open
  // left these stale, and the next time-of-day tweak wrote the OLD date back
  // over the fresh one. (Missing dates key as 0 so the parseDate "now" fallback
  // can't retrigger the effect every render.)
  const startDateKey = task.startDate ? parseDate(task.startDate).getTime() : 0;
  const endDateKey = task.endDate ? parseDate(task.endDate).getTime() : 0;
  useEffect(() => {
    setStartDate(parseDate(task.startDate));
    setEndDate(parseDate(task.endDate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDateKey, endDateKey]);

  // Focus title input when editing
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current && showChat) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [taskMessages, showChat]);

  const resetSubtaskForm = () => {
    setSubtaskForm({
      title: '',
      description: '',
      status: 'Todo',
      priority: 'medium',
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      assignedToUserId: user?.uid || '',
    });
  };

  const handleSaveTitle = async () => {
    if (titleText.trim() && titleText !== task.title) {
      await onUpdate(task.id, { title: titleText });
    } else {
      setTitleText(task.title);
    }
    setIsEditingTitle(false);
  };

  const handleCreateSubtask = async () => {
    if (!subtaskForm.title.trim() || !user) return;

    const subtaskAssignee = subtaskForm.assignedToUserId || user.uid;
    const createdSubtask = await taskMutation.create({
      title: subtaskForm.title,
      description: subtaskForm.description,
      status: subtaskForm.status,
      priority: subtaskForm.priority,
      startDate: subtaskForm.startDate,
      endDate: subtaskForm.endDate,
      assignedToUserId: subtaskAssignee,
      projectId: task.projectId,
      parentTaskId: task.id,
      collaboratorIds: [],
      // Inherit the parent task's tenancy scope so a subtask of a cross-department
      // task lands in the parent's team/business, not the viewer's active context.
      teamId: (task as any).teamId,
      businessId: (task as any).businessId,
    });

    // Notify assigned user for subtask
    if (subtaskAssignee !== user.uid) {
      await notificationMutation.create({
        userId: subtaskAssignee,
        type: 'task_assigned',
        title: 'Nën-detyrë e Re e Caktuar',
        message: `Ju u caktuat te nën-detyra: ${subtaskForm.title}`,
        isRead: false,
        actionUrl: (createdSubtask as any)?.id
          ? taskDeepLink((createdSubtask as any).id, task.projectId)
          : taskDeepLink(task.id, task.projectId),
        actionLabel: 'Shiko Detyrën',
      }).catch(err => console.error('[Notifications] subtask_assigned dërgim dështoi:', err));
    }

    resetSubtaskForm();
    setShowSubtaskForm(false);
  };

  const handleUpdateSubtask = async (subtaskId: string, data: any) => {
    await taskMutation.update(subtaskId, data);
    setEditingSubtask(null);
  };

  const handleDeleteSubtask = async (subtaskId: string) => {
    // Cascade: the subtask's comments/collaborator records go with it, and any
    // logged hours are unlinked rather than left pointing at a dead id.
    await deleteTaskCascade(subtaskId);
  };

  const startEditingSubtask = (subtask: any) => {
    setEditingSubtask(subtask.id);
    setSubtaskForm({
      title: subtask.title,
      description: subtask.description || '',
      status: subtask.status,
      priority: subtask.priority || 'medium',
      startDate: parseDate(subtask.startDate),
      endDate: parseDate(subtask.endDate),
      assignedToUserId: subtask.assignedToUserId,
    });
  };

  const cancelEditingSubtask = () => {
    setEditingSubtask(null);
    resetSubtaskForm();
  };

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDuration = (minutes: number) => {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  };

  const startTimer = async () => {
    if (!user) return;

    // Enforce a single running timer per user: close any entry left open from a
    // previous session/task first. Overlapping running timers were the root cause
    // of corrupt totals (a stop computed its duration against the wrong start).
    const myRunning = (allActiveTimeEntries || []).filter(
      (e: any) => e.userId === user.uid && !e.endTime,
    );
    for (const e of myRunning) {
      const endTimeVal = new Date();
      const start = new Date(e.startTime?.toDate ? e.startTime.toDate() : e.startTime);
      const duration = Math.max(0, Math.floor((endTimeVal.getTime() - start.getTime()) / 60000));
      await timeEntryMutation.update(e.id, { endTime: endTimeVal, duration });
    }

    await timeEntryMutation.create({
      userId: user.uid,
      taskId: task.id,
      // EXPLICIT null, never omitted: Firestore's `where('endTime','==',null)`
      // matches only documents that HAVE the field as null — a missing field is
      // invisible to it, which silently disabled the single-timer enforcement,
      // the "Duke punuar" badge and the running-timer views for every entry.
      endTime: null,
      projectId: task.projectId,
      description: `Working on: ${task.title}`,
      startTime: new Date(),
      isBillable: false,
      isPomodoroSession: false,
    });
  };

  const stopTimer = async () => {
    if (!runningEntry || !user) return;

    const endTimeVal = new Date();
    const duration = Math.floor((endTimeVal.getTime() - new Date(runningEntry.startTime).getTime()) / 60000);

    await timeEntryMutation.update(runningEntry.id, {
      endTime: endTimeVal,
      duration,
    });
  };

  const handleCommentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCommentText(value);

    const lastAtIndex = value.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const afterAt = value.slice(lastAtIndex + 1);
      const spaceIndex = afterAt.indexOf(' ');
      if (spaceIndex === -1) {
        setMentionQuery(afterAt);
        setShowMentionSuggestions(true);
      } else {
        setShowMentionSuggestions(false);
      }
    } else {
      setShowMentionSuggestions(false);
    }
  };

  const insertMention = (userId: string) => {
    const displayName = getUserDisplayName(userId);
    const lastAtIndex = commentText.lastIndexOf('@');
    // Store only the readable name in the input; uid is kept in mentionMap
    const newText = commentText.slice(0, lastAtIndex) + `@${displayName} `;
    setCommentText(newText);
    setMentionMap(prev => ({ ...prev, [displayName]: userId }));
    setShowMentionSuggestions(false);
  };

  const playFrogSound = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const playRibbit = (startTime: number) => {
        // Frequency sweep: high → low (the "rib" part)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(900, startTime);
        osc1.frequency.exponentialRampToValueAtTime(300, startTime + 0.12);
        gain1.gain.setValueAtTime(0, startTime);
        gain1.gain.linearRampToValueAtTime(0.18, startTime + 0.01);
        gain1.gain.exponentialRampToValueAtTime(0.001, startTime + 0.13);
        osc1.start(startTime);
        osc1.stop(startTime + 0.14);

        // Second harmonic for texture
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(1600, startTime);
        osc2.frequency.exponentialRampToValueAtTime(600, startTime + 0.10);
        gain2.gain.setValueAtTime(0, startTime);
        gain2.gain.linearRampToValueAtTime(0.07, startTime + 0.01);
        gain2.gain.exponentialRampToValueAtTime(0.001, startTime + 0.11);
        osc2.start(startTime);
        osc2.stop(startTime + 0.12);
      };
      // Two quick "rib-bit" pulses
      playRibbit(ctx.currentTime);
      playRibbit(ctx.currentTime + 0.18);
    } catch {
      // Audio not supported — fail silently
    }
  };

  const handleAddCommentSubmit = async () => {
    const text = commentText.trim();
    if (!text) return;

    // Transform @DisplayName → @[DisplayName](uid) for storage using mentionMap
    let finalText = text;
    Object.entries(mentionMap).forEach(([displayName, uid]) => {
      finalText = finalText.split(`@${displayName}`).join(`@[${displayName}](${uid})`);
    });

    // Also extract uids from already-formatted text (legacy or pasted content)
    const newFormatRegex = /@\[[^\]]+\]\(([^)]+)\)/g;
    const mentionedUids = new Set<string>(Object.values(mentionMap));
    let m: RegExpExecArray | null;
    while ((m = newFormatRegex.exec(finalText)) !== null) mentionedUids.add(m[1]);

    try {
      // Save comment first — then notify. The created id (when the parent hands it
      // back) turns every notification below into a link to THIS comment, not just
      // to the task.
      const created = await onAddComment(task.id, finalText, {
        visibleToClient: commentVisibleToClient && !!(task as any).customerId,
      });
      const newCommentId: string | undefined = (created as any)?.id;
      const commentLink = taskDeepLink(task.id, task.projectId, newCommentId);
      const taskLabel = task.projectId ? 'Shiko Detyrën' : 'Shiko Detyrat';
      setCommentText('');
      setMentionMap({});
      setCommentVisibleToClient(false);
      playFrogSound();

      const mentionedArray = [...mentionedUids].filter(uid => uid !== user?.uid);

      // Followers model (Asana / Linear / Salesforce Chatter): the people who get
      // notified on a record are its *followers*, not the whole team. You become a
      // follower by being assigned, @mentioned, or by commenting. `collaboratorIds`
      // is that follower list here.
      const currentCollaboratorIds: string[] = Array.isArray((task as any).collaboratorIds)
        ? (task as any).collaboratorIds
        : [];
      const newCollaborators = mentionedArray.filter(uid => !currentCollaboratorIds.includes(uid));
      // Commenting auto-follows YOU (so future replies reach you) — but you don't get
      // an "added as collaborator" ping for your own action.
      const senderFollows = !!user?.uid && !currentCollaboratorIds.includes(user.uid) && !newCollaborators.includes(user.uid);
      const collaboratorAdditions = [...newCollaborators, ...(senderFollows ? [user!.uid] : [])];
      if (collaboratorAdditions.length > 0) {
        await taskMutation.update(task.id, {
          collaboratorIds: [...currentCollaboratorIds, ...collaboratorAdditions],
        });
      }
      if (newCollaborators.length > 0) {
        // Notify newly-mentioned staff they now follow (and can see) the task.
        // allSettled everywhere below: the COMMENT is already saved. A rejected
        // notification must not land in the outer catch, which discards the comment
        // text as if the save had failed.
        await Promise.allSettled(newCollaborators.map(uid =>
          notificationMutation.create({
            userId: uid,
            type: 'task_collaborator_added',
            title: '📋 Shtuar si Bashkëpunëtor',
            message: `${user?.displayName || 'Dikush'} ju shtoi si bashkëpunëtor në detyrën: "${task.title}"`,
            isRead: false,
            actionUrl: commentLink,
            actionLabel: taskLabel,
          })
        ));
      }

      // Notify everyone mentioned who didn't already get the "added as collaborator" notification
      const alreadyNotified = new Set(newCollaborators);
      const senderName = user?.displayName || user?.email?.split('@')[0] || 'Dikush';
      const mentionNotifPromises = mentionedArray
        .filter(uid => !alreadyNotified.has(uid))
        .map(uid => notificationMutation.create({
          userId: uid,            // ← goes to RECIPIENT (mentioned person), never sender
          type: 'task_mention',
          title: `💬 ${senderName} ju përmendi`,
          message: `Në detyrën: "${task.title}"`,
          isRead: false,
          actionUrl: commentLink,
          actionLabel: taskLabel,
        }));
      await Promise.allSettled(mentionNotifPromises);

      // Notify the task's participants (assignee, creator, collaborators, previous
      // commenters) about the new comment — so a comment never goes unseen. Excludes
      // the sender and anyone already notified above (mentions/new collaborators), so
      // no one gets a double ping. This is scoped to people involved in the task, not
      // the whole team, to avoid notification spam.
      const excluded = new Set<string>(
        [user?.uid, ...mentionedArray, ...newCollaborators].filter(Boolean) as string[],
      );
      const participantIds = new Set<string>();
      if (task.assignedToUserId) participantIds.add(task.assignedToUserId);
      if (task.createdByUserId) participantIds.add(task.createdByUserId);
      currentCollaboratorIds.forEach(uid => participantIds.add(uid));
      comments.forEach(c => { if (c.userId) participantIds.add(c.userId); });

      const commentPreview = finalText.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1').slice(0, 120);
      const participantNotifPromises = [...participantIds]
        .filter(uid => !excluded.has(uid))
        .map(uid => notificationMutation.create({
          userId: uid,
          type: 'task_comment',
          title: `💬 Koment i ri nga ${senderName}`,
          message: `"${task.title}": ${commentPreview}`,
          isRead: false,
          actionUrl: commentLink,
          actionLabel: taskLabel,
        }));
      await Promise.allSettled(participantNotifPromises);
    } catch {
      // Comment failed to save — keep text so user can retry
    }
  };

  // Materials: images, PDF and office docs (both Office generations), max 15 MB
  // each. Must stay a subset of the VPS ALLOWED_UPLOAD filter (vps/server.ts) —
  // the server is the real gate.
  const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
  const isAllowedMaterial = (f: File) =>
    f.type.startsWith('image/')
    || f.type === 'application/pdf'
    || f.type.includes('officedocument')
    || f.type === 'application/msword'
    || f.type === 'application/vnd.ms-excel'
    || f.type === 'application/vnd.ms-powerpoint'
    || f.type === 'text/plain'
    || f.type === 'text/csv'
    // Some browsers report an empty mime for odd registrations — trust the extension.
    || (!f.type && /\.(docx?|xlsx?|pptx?|pdf|txt|csv)$/i.test(f.name));

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const picked = Array.from(files);
    const valid = picked.filter(f => isAllowedMaterial(f) && f.size <= MAX_ATTACHMENT_BYTES);
    if (valid.length < picked.length) {
      toast({
        title: 'Skedar i papranuar',
        description: 'Lejohen imazhe, PDF, Word, Excel, PowerPoint, TXT ose CSV, deri në 15 MB secili.',
        variant: 'destructive',
      });
    }
    if (valid.length === 0) { e.target.value = ''; return; }

    const newAttachments = [...attachments];

    try {
      for (const file of valid) {
        // Upload to the file server so the URL survives reloads (a blob: URL is
        // session-scoped and dies on navigation/app restart).
        const result = await uploadCommentImage(file, 'task-attachments');
        newAttachments.push({
          name: file.name,
          size: file.size,
          type: file.type,
          url: result.url,
          uploadedBy: user?.uid,
          uploadedAt: new Date().toISOString(),
        });
      }
      await onUpdate(task.id, { attachments: JSON.stringify(newAttachments) });
    } catch (err: any) {
      toast({ title: 'Ngarkimi i skedarit dështoi', description: err?.message, variant: 'destructive' });
    } finally {
      e.target.value = '';
    }
  };

  const handleRemoveAttachment = async (index: number) => {
    const removed = attachments[index];
    if (removed?.url?.startsWith('blob:')) {
      URL.revokeObjectURL(removed.url);
    }
    const newAttachments = attachments.filter((_: any, i: number) => i !== index);
    await onUpdate(task.id, { attachments: JSON.stringify(newAttachments) });
  };

  const handleDriveFileSelect = async (file: DriveFile) => {
    const newAttachments = [...attachments, {
      name: file.name,
      size: file.size ? parseInt(file.size, 10) : 0,
      type: file.mimeType,
      url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      source: 'google-drive',
      driveFileId: file.id,
      uploadedBy: user?.uid,
      uploadedAt: new Date().toISOString(),
    }];
    await onUpdate(task.id, { attachments: JSON.stringify(newAttachments) });
    setShowDrivePicker(false);
  };



  const renderCommentWithMentions = (content: string, isOwn = false) => {
    // Split on mentions OR URLs (so we can detect image URLs and render them inline).
    const tokenRe = /(@\[[^\]]+\]\([^)]+\)|@\S+|https?:\/\/[^\s]+)/g;
    const parts = content.split(tokenRe);
    const isImageUrl = (url: string) => /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(url) || /firebasestorage\.googleapis\.com|firebasestorage\.app/i.test(url);
    // On the sender's own (purple) bubble, text-primary is invisible — use a
    // light-on-purple treatment instead so the @mention stays readable.
    const mentionCls = isOwn
      ? 'text-primary-foreground font-semibold bg-white/25 px-1 rounded'
      : 'text-primary font-medium bg-primary/10 px-1 rounded';
    return parts.map((part, i) => {
      if (!part) return null;
      if (part.startsWith('@')) {
        // New format: @[DisplayName](userId)
        const newFmt = part.match(/^@\[([^\]]+)\]\(([^)]+)\)$/);
        if (newFmt) {
          return (
            <span key={i} className={mentionCls}>
              @{newFmt[1]}
            </span>
          );
        }
        // Legacy format: @userId — resolve name via lookup
        const uid = part.slice(1);
        const displayName = getUserDisplayName(uid);
        return (
          <span key={i} className={mentionCls}>
            @{displayName}
          </span>
        );
      }
      if (/^https?:\/\//.test(part)) {
        if (isImageUrl(part)) {
          return (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="block my-1">
              <img src={part} alt="attachment" className="max-w-[260px] max-h-[260px] rounded-lg border border-border/40 object-cover" loading="lazy" />
            </a>
          );
        }
        return (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline break-all">
            {part}
          </a>
        );
      }
      return <React.Fragment key={i}>{part}</React.Fragment>;
    });
  };

  // Derive the total from each entry's start/end (source of truth) rather than the
  // stored `duration` field, which can be stale/corrupt when overlapping timers were
  // stopped against the wrong start (caused "2h log → 49h total"). See lib/timeTracking.
  const totalMinutes = totalTrackedMinutes(timeEntries);

  const timeStr = (d?: Date) => d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';

  // A moved deadline RE-ARMS the due/overdue alerts: the cron marks
  // dueNotificationSent/overdueNotificationSent once and skips flagged tasks, so
  // without this reset a postponed task never alerted again — the new deadline
  // came and went in silence.
  const rearmDeadlineAlerts: Partial<Task> = { dueNotificationSent: false, overdueNotificationSent: false };

  // Auto-adjust instead of silently blocking, so intra-day edits always apply
  // (Asana-style): if start moves past end, end follows; if end moves before
  // start, start follows.
  const handleStartDateChange = async (date: Date | undefined) => {
    if (!date) return;
    const nd = new Date(date);
    nd.setHours(startDate.getHours(), startDate.getMinutes(), 0, 0);
    setStartDate(nd);
    const patch: Partial<Task> = { startDate: nd };
    if (nd > endDate) { setEndDate(nd); Object.assign(patch, { endDate: nd }, rearmDeadlineAlerts); }
    await onUpdate(task.id, patch);
  };

  const handleEndDateChange = async (date: Date | undefined) => {
    if (!date) return;
    const nd = new Date(date);
    nd.setHours(endDate.getHours(), endDate.getMinutes(), 0, 0);
    setEndDate(nd);
    const patch: Partial<Task> = { endDate: nd, ...rearmDeadlineAlerts };
    if (nd < startDate) { setStartDate(nd); patch.startDate = nd; }
    await onUpdate(task.id, patch);
  };

  // Intra-day scheduling: edit just the time-of-day (same-day tasks, e.g. 09:00–11:00).
  const handleStartTimeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const [h, m] = e.target.value.split(':').map(Number);
    const nd = new Date(startDate); nd.setHours(h || 0, m || 0, 0, 0);
    setStartDate(nd);
    const patch: Partial<Task> = { startDate: nd };
    if (nd > endDate) { setEndDate(nd); Object.assign(patch, { endDate: nd }, rearmDeadlineAlerts); }
    await onUpdate(task.id, patch);
  };
  const handleEndTimeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const [h, m] = e.target.value.split(':').map(Number);
    const nd = new Date(endDate); nd.setHours(h || 0, m || 0, 0, 0);
    setEndDate(nd);
    const patch: Partial<Task> = { endDate: nd, ...rearmDeadlineAlerts };
    if (nd < startDate) { setStartDate(nd); patch.startDate = nd; }
    await onUpdate(task.id, patch);
  };

  const handleSendChatMessage = async () => {
    if (!chatMessageText.trim() || !user) return;

    try {
      await messageMutation.create({
        content: chatMessageText,
        senderId: user.uid,
        taskId: task.id,
        isRead: false,
      });
      setChatMessageText('');
    } catch (err) {
      console.error('Failed to send message:', err);
      // Message stays in input so user can retry
    }
  };

  // Format date compactly (Albanian months — the rest of this panel is sq-AL).
  const formatDateCompact = (date: Date) => {
    const months = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gush', 'Sht', 'Tet', 'Nën', 'Dhj'];
    return `${date.getDate()} ${months[date.getMonth()]}`;
  };

  // ── Redesign state: pill dropdowns + searchable pickers ──
  const [statusOpen, setStatusOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignQuery, setAssignQuery] = useState('');
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const closePickers = () => { setStatusOpen(false); setAssignOpen(false); setProjectOpen(false); };

  const statusMeta = STATUS_OPTS.find(s => s.v === task.status) || STATUS_OPTS[0];

  // Status change — the completeTask flow (recurring next-cycle, blockers) is the
  // same one the old header select ran; both status dropdowns call this.
  const changeStatus = async (newStatus: string) => {
    if (newStatus === task.status) return;
    if (newStatus === 'Done') {
      const outcome = await completeTask(task, {
        createTask: (data) => taskMutation.create(data as any),
        updateTask: (id, data) => onUpdate(id, data),
        allTasks,
        claimNextCycle: claimTaskNextCycle,
        releaseNextCycle: releaseTaskNextCycle,
      });
      const freqLabel: Record<string, string> = { daily: 'ditore', weekly: 'javore', monthly: 'mujore', yearly: 'vjetore' };
      // Every non-blocked outcome ends with the task Done — tell the creator,
      // assignee and collaborators (never the actor themselves).
      if (outcome.kind !== 'blocked' && user?.uid) {
        taskCompletedNotifications(task, user.uid, user.displayName || undefined).forEach(n =>
          notificationMutation.create(n as any).catch(err => console.error('[Notifications] task_completed dërgim dështoi:', err)));
      }
      switch (outcome.kind) {
        case 'blocked':
          toast({ title: '⛔ Detyrë e Bllokuar', description: `Ka ${outcome.blockers} varësi të pakryera para se ta mbyllësh këtë.`, variant: 'destructive' });
          return;
        case 'recurring-created':
          toast({ title: '✅ Detyrë e kryer + cikli i ri!', description: `Detyra periodike ${freqLabel[task.recurringFrequency ?? ''] ?? ''} u rigjenerua automatikisht.` });
          return;
        case 'recurring-ended':
          toast({ title: '✅ Detyrë e kryer', description: 'Cikli i fundit i përsëritjes — nuk u krijua tjetër.' });
          return;
        case 'error':
          console.error('[Recurring] krijimi i ciklit tjetër dështoi:', outcome.error);
          toast({ title: 'Statusi u ndryshua ✓', description: `"${task.title}" → Përfunduar` });
          return;
        default:
          toast({ title: 'Statusi u ndryshua ✓', description: `"${task.title}" → Përfunduar` });
          return;
      }
    }
    // Re-opening a Done recurring tip re-arms it ONLY when the series has no
    // live occurrence left (child deleted by mistake → revive); re-arming while
    // the child is alive would double the series on re-complete.
    const reopening = task.status === 'Done' && task.isRecurring && !hasLiveSeriesSibling(task, allTasks);
    await onUpdate(task.id, { status: newStatus as Task['status'], ...(reopening ? { nextCycleCreated: false } : {}) });
    const labels: Record<string, string> = { Todo: 'Për të bërë', 'In Progress': 'Në progres', Review: 'Rishikim', Done: 'Përfunduar' };
    toast({ title: 'Statusi u ndryshua ✓', description: `"${task.title}" → ${labels[newStatus] ?? newStatus}` });
  };

  // Reassign — notifies the new assignee AND the previous one, and logs, exactly
  // like the old popover handlers did.
  const assignTo = async (newUserId: string) => {
    setAssignOpen(false);
    setAssignQuery('');
    const prevAssignee = task.assignedToUserId;
    if (!newUserId || newUserId === prevAssignee) return;
    await onUpdate(task.id, { assignedToUserId: newUserId });
    const link = taskDeepLink(task.id, task.projectId);
    if (newUserId !== user?.uid) {
      await notificationMutation.create({
        userId: newUserId,
        type: 'task_assigned',
        title: 'Detyrë e Re e Caktuar',
        message: `${user?.displayName || 'Dikush'} ju caktoi detyrën: ${task.title}`,
        isRead: false,
        actionUrl: link,
        actionLabel: 'Shiko Detyrën',
      }).catch(err => console.error('[Notifications] task_assigned dërgim dështoi:', err));
    }
    if (prevAssignee && prevAssignee !== newUserId && prevAssignee !== user?.uid) {
      await notificationMutation.create({
        userId: prevAssignee,
        type: 'task_assigned',
        title: 'Detyrë e Ri-caktuar',
        message: `Detyra "${task.title}" u ri-caktua te ${getUserDisplayName(newUserId)}`,
        isRead: false,
        actionUrl: link,
        actionLabel: 'Shiko Detyrën',
      }).catch(err => console.error('[Notifications] task_assigned dërgim dështoi:', err));
    }
    logActivity('update', `Detyra "${task.title}" u ri-caktua`, {
      description: `Nga: ${prevAssignee || 'Pa caktuar'} → Te: ${newUserId}`,
      entityType: 'task',
      entityId: task.id,
    });
  };

  const changeProject = async (pid: string) => {
    setProjectOpen(false);
    setProjectQuery('');
    if ((task.projectId || '') === pid) return;
    // customerId RIDES on the project (it is what grants the portal client read
    // access to the task) — it must be re-derived on every move, or the OLD
    // project's client keeps seeing a task that now belongs to another client.
    // '' (not undefined — the mutation layer strips undefined) clears it when
    // the new project has no customer or the task leaves projects altogether.
    const newProject = pid ? projects.find(p => p.id === pid) : undefined;
    const patch = { projectId: pid || null, customerId: (newProject as any)?.customerId || '' };
    await onUpdate(task.id, patch as any);
    // Subtasks ride along: they carry the parent's projectId/customerId, and
    // leaving them behind keeps the OLD client's portal read access alive (and
    // deleting the old project later would cascade-delete them).
    await Promise.allSettled(
      (subtasks || []).map(st => taskMutation.update(st.id, patch as any)),
    );
  };

  // Assignee load: open tasks per person — colours match the create form's bars.
  const activeCountOf = (uid: string) => (allTasks || []).filter(t => t.assignedToUserId === uid && t.status !== 'Done').length;
  const loadToneOf = (n: number) => (n >= 8 ? 'text-red-600 dark:text-red-400' : n >= 6 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground');

  const currentProject = projects.find(p => p.id === task.projectId);

  const pq = projectQuery.trim().toLowerCase();
  const projectOptions = [
    { id: '', name: 'Pa projekt', dot: '#C3CEDD', sub: '' },
    ...projects.map(p => {
      const n = (allTasks || []).filter(t => t.projectId === p.id && t.status !== 'Done').length;
      return { id: p.id, name: p.name, dot: hashColor(p.name), sub: n > 0 ? `${n} detyra aktive` : '' };
    }),
  ].filter(o => !pq || o.name.toLowerCase().includes(pq));

  const aq = assignQuery.trim().toLowerCase();
  const assignMembers = (teamMembers || [])
    .filter((m: any) => m.userId !== user?.uid)
    .filter((m: any) => {
      if (!aq) return true;
      const nm = getUserDisplayName(m.userId).toLowerCase();
      return nm.includes(aq) || (m.email || '').toLowerCase().includes(aq);
    });
  const showSelfOption = !!user && (!aq || (user.displayName || '').toLowerCase().includes(aq) || (user.email || '').toLowerCase().includes(aq));
  const assigneeName = getUserDisplayName(task.assignedToUserId || '') || 'Pa caktuar';

  // Quick-date chips: Sot / Nesër / Kjo javë (e premtja) / 📅 datë e lirë.
  const dayKeyOf = (d: Date) => {
    const today = new Date();
    const tom = new Date(); tom.setDate(tom.getDate() + 1);
    const fri = new Date(); fri.setDate(fri.getDate() + ((5 - fri.getDay() + 7) % 7));
    if (d.toDateString() === today.toDateString()) return 'sot';
    if (d.toDateString() === tom.toDateString()) return 'neser';
    if (d.toDateString() === fri.toDateString()) return 'jave';
    return 'date';
  };
  const quickDate = (k: string) => {
    const d = new Date();
    if (k === 'neser') d.setDate(d.getDate() + 1);
    if (k === 'jave') d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
    return d;
  };
  const dueKey = dayKeyOf(endDate);
  const startKey = dayKeyOf(startDate);

  // "krijuar sot 09:40 nga ti" — the subtitle under the title (per the design).
  const createdDate = (() => {
    const raw: any = (task as any).createdAt;
    if (!raw) return null;
    const d = raw instanceof Date ? raw : raw?.toDate?.() ? raw.toDate() : new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  })();
  const justCreated = !!createdDate && Date.now() - createdDate.getTime() < 10 * 60 * 1000;
  const createdLabel = createdDate ? (() => {
    const hm = `${String(createdDate.getHours()).padStart(2, '0')}:${String(createdDate.getMinutes()).padStart(2, '0')}`;
    if (createdDate.toDateString() === new Date().toDateString()) return `sot ${hm}`;
    const months = ['jan', 'shk', 'mar', 'pri', 'maj', 'qer', 'kor', 'gus', 'sht', 'tet', 'nën', 'dhj'];
    return `${createdDate.getDate()} ${months[createdDate.getMonth()]}`;
  })() : null;
  const creatorLabel = (task as any).createdByUserId
    ? ((task as any).createdByUserId === user?.uid ? 'ti' : getUserDisplayName((task as any).createdByUserId))
    : '';
  const subtitleText = [
    currentProject?.name || 'Pa projekt',
    createdLabel ? `krijuar ${createdLabel}${creatorLabel ? ` nga ${creatorLabel}` : ''}` : null,
  ].filter(Boolean).join(' · ');

  const footerSummary = `${assigneeName.split(' ')[0]} · ${formatDateCompact(endDate)}${task.isRecurring ? ' · përsëritet' : ''}`;

  // "Ruaj ndryshimet" — commits any in-progress title/description edit and closes.
  // Every other field already saved on tap (chips/pickers write straight through).
  const handleFooterSave = async () => {
    const patch: any = {};
    if (titleText.trim() && titleText.trim() !== task.title) patch.title = titleText.trim();
    const cleanedDesc = descriptionText === '<p></p>' ? '' : descriptionText;
    if (isEditingDescription && cleanedDesc !== (task.description || '')) patch.description = cleanedDesc;
    if (Object.keys(patch).length > 0) await onUpdate(task.id, patch);
    onClose();
  };

  const rowCls = 'grid grid-cols-[92px_1fr] items-center gap-2.5 border-b border-border/60 py-2 sm:grid-cols-[118px_1fr]';
  const rowLabelCls = 'text-[12.5px] font-semibold text-muted-foreground';

  const memberOption = (uid: string, email: string | undefined, isYou: boolean) => {
    const name = isYou ? (user?.displayName || 'Ti') : getUserDisplayName(uid);
    const n = activeCountOf(uid);
    const on = task.assignedToUserId === uid;
    return (
      <button
        key={uid}
        type="button"
        onClick={() => assignTo(uid)}
        className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-muted max-sm:min-h-[52px] ${on ? 'bg-primary/10' : ''}`}
      >
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold text-white" style={{ background: hashColor(name) }}>
          {name.slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
            <span className="truncate">{name}</span>
            {isYou && <span className="shrink-0 rounded-[5px] bg-primary/10 px-1.5 py-px text-[9.5px] font-extrabold text-primary">Ti</span>}
          </span>
          {email && <span className="mt-px block truncate text-[11px] text-muted-foreground">{email}</span>}
        </span>
        <span title="Detyra aktive" className={`shrink-0 whitespace-nowrap text-[10.5px] font-semibold ${loadToneOf(n)}`}>{n} aktive</span>
        {on && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
      </button>
    );
  };

  return (
    <>
    {/* The parents position the panel (side panel on desktop, bottom sheet on
        mobile) — the panel only brings the design's content. */}
      <div
        className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
        onClick={closePickers}
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center pb-0.5 pt-2 sm:hidden">
          <span className="h-[5px] w-[38px] rounded-full bg-border" />
        </div>

        {/* Header: status pill + freshness + expand/close */}
        <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 sm:px-[18px] sm:py-3">
          <div className="relative">
            <button
              type="button"
              disabled={isGuestMode}
              onClick={(e) => { e.stopPropagation(); setAssignOpen(false); setProjectOpen(false); setStatusOpen(v => !v); }}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold ${statusMeta.pill} disabled:cursor-default`}
            >
              {task.status === 'Done' && <Check className="h-3 w-3" />}
              {statusMeta.label}
              {!isGuestMode && <span className="text-[9px]">▼</span>}
            </button>
            {statusOpen && (
              <div
                className="absolute left-0 top-[calc(100%+6px)] z-40 hidden w-[190px] flex-col gap-px rounded-xl border bg-background p-1.5 shadow-[0_14px_36px_rgba(12,27,51,.2)] sm:flex"
                onClick={(e) => e.stopPropagation()}
              >
                {STATUS_OPTS.map(s => (
                  <button
                    key={s.v}
                    type="button"
                    onClick={() => { setStatusOpen(false); changeStatus(s.v); }}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-semibold text-foreground hover:bg-muted ${task.status === s.v ? 'bg-primary/10' : ''}`}
                  >
                    <span className="h-[9px] w-[9px] rounded-full" style={{ background: s.dot }} />
                    <span className="flex-1">{s.label}</span>
                    {task.status === s.v && <Check className="h-3.5 w-3.5 text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          {justCreated && (
            <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700 dark:text-emerald-400">✓ U krijua tani</span>
          )}
          {activeWorkers.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-success">
              <Eye className="h-3 w-3 animate-pulse" />
              {activeWorkers.length} duke punuar
            </span>
          )}
          <span className="flex-1" />
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              title={isExpanded ? 'Palos' : 'Zgjero'}
              className="hidden h-[30px] w-[30px] items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground sm:flex"
            >
              {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Mbyll"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Mobile: status as a chips row (design mobile), not an anchored menu */}
        {statusOpen && (
          <div className="flex flex-wrap gap-1.5 border-b px-4 py-2.5 sm:hidden">
            {STATUS_OPTS.map(s => (
              <button
                key={s.v}
                type="button"
                onClick={() => { setStatusOpen(false); changeStatus(s.v); }}
                className={`flex min-h-[34px] items-center gap-1.5 rounded-full border-[1.5px] px-3 text-[11.5px] font-bold ${
                  task.status === s.v ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-muted-foreground'
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: s.dot }} />
                {s.label}
              </button>
            ))}
          </div>
        )}

        {/* Scrollable Content */}
        <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4 sm:space-y-5 sm:px-6 sm:py-5">
          {/* Title + created info */}
          <div>
            <input
              ref={titleInputRef}
              value={titleText}
              disabled={isGuestMode}
              onChange={(e) => setTitleText(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setTitleText(task.title);
              }}
              className="w-full border-none bg-transparent text-[21px] font-extrabold tracking-tight text-foreground outline-none disabled:opacity-100 sm:text-[23px]"
            />
            <div className="mt-0.5 text-xs text-muted-foreground">{subtitleText}</div>
          </div>

          {/* Meta rows — label grid per the design */}
          <div className="flex flex-col">
            {/* Projekti */}
            <div className={rowCls}>
              <span className={rowLabelCls}>Projekti</span>
              <div className="relative max-w-full justify-self-start">
                <button
                  type="button"
                  disabled={isGuestMode}
                  onClick={(e) => { e.stopPropagation(); setStatusOpen(false); setAssignOpen(false); setProjectQuery(''); setProjectOpen(v => !v); }}
                  className={`flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 transition-colors disabled:cursor-default ${projectOpen ? 'border-primary bg-primary/10' : 'border-border bg-background hover:border-primary/50'}`}
                >
                  <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: currentProject ? hashColor(currentProject.name) : '#C3CEDD' }} />
                  <span className="truncate text-[13px] font-bold text-foreground">
                    {projectsLoading ? 'Duke ngarkuar…' : (currentProject?.name || 'Pa projekt')}
                  </span>
                  {!isGuestMode && <span className="text-[10px] text-muted-foreground">{projectOpen ? '▲' : '▼'}</span>}
                </button>
                {projectOpen && (
                  <PickerPanel
                    title="Zgjidh projektin"
                    searchPlaceholder="Kërko projektin…"
                    query={projectQuery}
                    onQuery={setProjectQuery}
                    onClose={() => { setProjectOpen(false); setProjectQuery(''); }}
                  >
                    {projectOptions.length === 0 && (
                      <div className="px-3 py-5 text-center text-xs text-muted-foreground">Asnjë projekt nuk përputhet me "{projectQuery}"</div>
                    )}
                    {projectOptions.map(p => (
                      <button
                        key={p.id || '__none__'}
                        type="button"
                        onClick={() => changeProject(p.id)}
                        className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-muted max-sm:min-h-[52px] ${(task.projectId || '') === p.id ? 'bg-primary/10' : ''}`}
                      >
                        <span className="h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: p.dot }} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-foreground">{p.name}</span>
                          {p.sub && <span className="mt-px block text-[11px] text-muted-foreground">{p.sub}</span>}
                        </span>
                        {(task.projectId || '') === p.id && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                      </button>
                    ))}
                  </PickerPanel>
                )}
              </div>
            </div>

            {/* Caktuar te */}
            <div className={rowCls}>
              <span className={rowLabelCls}>Caktuar te</span>
              <div className="relative max-w-full justify-self-start">
                <button
                  type="button"
                  disabled={isGuestMode}
                  onClick={(e) => { e.stopPropagation(); setStatusOpen(false); setProjectOpen(false); setAssignQuery(''); setAssignOpen(v => !v); }}
                  className={`flex max-w-full items-center gap-2 rounded-full border py-1 pl-1 pr-3 transition-colors disabled:cursor-default ${assignOpen ? 'border-primary bg-primary/10' : 'border-border bg-background hover:border-primary/50'}`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold text-white" style={{ background: hashColor(assigneeName) }}>
                    {assigneeName.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="truncate text-[13.5px] font-bold text-foreground">{assigneeName}</span>
                  {!isGuestMode && <span className="text-[10px] text-muted-foreground">{assignOpen ? '▲' : '▼'}</span>}
                </button>
                {assignOpen && (
                  <PickerPanel
                    title="Cakto anëtarin"
                    searchPlaceholder="Kërko anëtarin…"
                    query={assignQuery}
                    onQuery={setAssignQuery}
                    onClose={() => { setAssignOpen(false); setAssignQuery(''); }}
                  >
                    {showSelfOption && user && (
                      <>
                        <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">Përdoruesi aktual</div>
                        {memberOption(user.uid, user.email || undefined, true)}
                      </>
                    )}
                    {permissions.canAssignTasks && assignMembers.length > 0 && (
                      <div className="px-2.5 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">Anëtarët e ekipit</div>
                    )}
                    {permissions.canAssignTasks && assignMembers.map((m: any) => memberOption(m.userId, m.email, false))}
                    {!showSelfOption && (!permissions.canAssignTasks || assignMembers.length === 0) && (
                      <div className="px-3 py-5 text-center text-xs text-muted-foreground">Asnjë anëtar nuk përputhet me "{assignQuery}"</div>
                    )}
                    {permissions.canAssignTasks && (
                      <div className="mt-1 border-t px-2.5 pb-1 pt-2">
                        <p className="mb-1 text-[10px] font-semibold text-muted-foreground">Ose shkruaj User ID:</p>
                        <Input
                          placeholder="User ID…"
                          className="h-8 text-xs"
                          defaultValue={task.assignedToUserId || ''}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const v = (e.target as HTMLInputElement).value.trim();
                              if (v) { manualInputRef.current = v; assignTo(v); }
                            }
                          }}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (manualInputRef.current === v) { manualInputRef.current = ''; return; }
                            if (v && v !== task.assignedToUserId) assignTo(v);
                          }}
                        />
                      </div>
                    )}
                  </PickerPanel>
                )}
              </div>
            </div>

            {/* Afati */}
            <div className={rowCls}>
              <span className={rowLabelCls}>Afati</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {([['sot', 'Sot'], ['neser', 'Nesër'], ['jave', 'Kjo javë']] as const).map(([k, l]) => (
                  <button key={k} type="button" disabled={isGuestMode} onClick={() => handleEndDateChange(quickDate(k))} className={chipCls(dueKey === k)}>
                    {l}
                  </button>
                ))}
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" disabled={isGuestMode} className={chipCls(dueKey === 'date')}>📅 {formatDateCompact(endDate)}</button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={endDate} onSelect={handleEndDateChange} initialFocus />
                  </PopoverContent>
                </Popover>
                {!isGuestMode && (
                  <input
                    type="time"
                    value={timeStr(endDate)}
                    onChange={handleEndTimeChange}
                    className="h-7 rounded border border-border/50 bg-muted/40 px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                )}
              </div>
            </div>

            {/* Fillimi */}
            <div className={rowCls}>
              <span className={rowLabelCls}>Fillimi</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {([['sot', 'Sot'], ['neser', 'Nesër']] as const).map(([k, l]) => (
                  <button key={k} type="button" disabled={isGuestMode} onClick={() => handleStartDateChange(quickDate(k))} className={chipCls(startKey === k)}>
                    {l}
                  </button>
                ))}
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" disabled={isGuestMode} className={chipCls(startKey === 'date' || startKey === 'jave')}>📅 {formatDateCompact(startDate)}</button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={startDate} onSelect={handleStartDateChange} initialFocus />
                  </PopoverContent>
                </Popover>
                {!isGuestMode && (
                  <input
                    type="time"
                    value={timeStr(startDate)}
                    onChange={handleStartTimeChange}
                    className="h-7 rounded border border-border/50 bg-muted/40 px-1.5 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                )}
              </div>
            </div>

            {/* Përsëritet */}
            {(task.isRecurring || permissions.canEdit) && (
              <div className={`${rowCls} items-start`}>
                <span className={`${rowLabelCls} pt-1`}>Përsërit.</span>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={isGuestMode || !permissions.canEdit}
                      onClick={() => task.isRecurring && onUpdate(task.id, { isRecurring: false } as any)}
                      className={chipCls(!task.isRecurring)}
                    >
                      Asnjëherë
                    </button>
                    {([['daily', 'Çdo ditë'], ['weekly', 'Çdo javë'], ['monthly', 'Çdo muaj']] as const).map(([k, l]) => (
                      <button
                        key={k}
                        type="button"
                        disabled={isGuestMode || !permissions.canEdit}
                        onClick={() => (!task.isRecurring || task.recurringFrequency !== k) && enableRecurring(k)}
                        className={chipCls(!!task.isRecurring && task.recurringFrequency === k)}
                      >
                        ↻ {l}
                      </button>
                    ))}
                    {task.isRecurring && <span className="text-[11px] text-muted-foreground">Europe/Tirane</span>}
                  </div>
                  {task.isRecurring && (
                    <>
                      {!editingRecurring ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                            🔄 {task.recurringFrequency === 'daily'
                                 ? (() => {
                                     const days = (task as any).recurringDaysOfWeek as number[] | undefined;
                                     const names = ['Die', 'Hën', 'Mar', 'Mër', 'Enj', 'Pre', 'Sht'];
                                     return days && days.length > 0 ? `Çdo ${days.map(d => names[d]).join(', ')}` : 'Çdo ditë';
                                   })()
                                 : task.recurringFrequency === 'weekly'
                                 ? `Çdo ${(task.recurringInterval ?? 1) > 1 ? (task.recurringInterval ?? 1) + ' javë' : 'javë'}, ${['Diel', 'Hënë', 'Martë', 'Mërkurë', 'Enjte', 'Premte', 'Shtunë'][(task as any).recurringDayOfWeek ?? 0]}`
                                 : task.recurringFrequency === 'monthly'
                                 ? `Çdo ${(task.recurringInterval ?? 1) > 1 ? (task.recurringInterval ?? 1) + ' muaj' : 'muaj'}, ditën ${(task as any).recurringDayOfMonth ?? 1}`
                                 : `Çdo ${(task.recurringInterval ?? 1) > 1 ? (task.recurringInterval ?? 1) + ' vite' : 'vit'}`}
                          </span>
                          {permissions.canEdit && (task.recurringFrequency === 'weekly' || task.recurringFrequency === 'daily') && (
                            <button
                              type="button"
                              onClick={() => setEditingRecurring(true)}
                              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                            >
                              Ndrysho
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {task.recurringFrequency === 'weekly' && (
                            <div className="flex flex-wrap gap-1.5">
                              {[{ v: 1, l: 'Hën' }, { v: 2, l: 'Mar' }, { v: 3, l: 'Mër' }, { v: 4, l: 'Enj' }, { v: 5, l: 'Pre' }, { v: 6, l: 'Sht' }, { v: 0, l: 'Die' }].map(day => (
                                <button key={day.v} type="button" onClick={() => setRecurringDayOfWeek(day.v)} className={chipCls(recurringDayOfWeek === day.v)}>
                                  {day.l}
                                </button>
                              ))}
                            </div>
                          )}
                          {task.recurringFrequency === 'daily' && (
                            <div className="flex flex-wrap gap-1.5">
                              {[{ v: 1, l: 'Hën' }, { v: 2, l: 'Mar' }, { v: 3, l: 'Mër' }, { v: 4, l: 'Enj' }, { v: 5, l: 'Pre' }, { v: 6, l: 'Sht' }, { v: 0, l: 'Die' }].map(day => (
                                <button key={day.v} type="button" onClick={() => toggleRecurringDay(day.v)} className={chipCls(recurringDaysOfWeek.includes(day.v))}>
                                  {day.l}
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="flex gap-2">
                            <Button size="sm" className="h-7 text-xs" onClick={saveRecurring}>Ruaj</Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingRecurring(false)}>Anulo</Button>
                          </div>
                        </div>
                      )}
                      {/* Repeat-until — bounds the recurrence */}
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">Deri më:</span>
                        <input
                          type="date"
                          defaultValue={(task as any).recurringEndDate ? (() => { const d = new Date((task as any).recurringEndDate); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })() : ''}
                          disabled={!permissions.canEdit}
                          onChange={(e) => { const v = e.target.value; const nd = v ? (() => { const [y, mo, dd] = v.split('-').map(Number); return new Date(y, mo - 1, dd); })() : (null as any); onUpdate(task.id, { recurringEndDate: nd } as any); }}
                          className="h-6 rounded border border-border/50 bg-muted/40 px-1.5 text-[11px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
                        />
                        {(task as any).recurringEndDate
                          ? <button type="button" onClick={() => onUpdate(task.id, { recurringEndDate: null as any } as any)} className="text-[11px] text-muted-foreground underline hover:text-foreground">Hiq</button>
                          : <span className="text-[11px] text-muted-foreground/70">pa fund</span>}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Bllokohet nga */}
            {(!isGuestMode || (task.dependsOn && task.dependsOn.length > 0)) && (
              <div className={`${rowCls} items-start`}>
                <span className={`${rowLabelCls} pt-1`}>Bllokohet nga</span>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(task.dependsOn || []).map((depId) => {
                      const dep = allTasks?.find((t) => t.id === depId);
                      const isDone = dep?.status === 'Done';
                      return (
                        <span
                          key={depId}
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            isDone
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'border-orange-200 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300'
                          }`}
                        >
                          {isDone ? '✓' : '🔒'}
                          <span className="max-w-[160px] truncate">{dep?.title || depId.slice(0, 8) + '…'}</span>
                          {!isGuestMode && (
                            <button type="button" onClick={() => onUpdate(task.id, { dependsOn: (task.dependsOn || []).filter((x) => x !== depId) } as any)} className="hover:opacity-70" aria-label="Hiq bllokuesin">
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      );
                    })}
                    {!isGuestMode && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" className="rounded-full border-[1.5px] border-dashed border-border bg-background px-3 py-[5px] text-xs font-semibold text-muted-foreground transition-colors hover:border-primary">
                            ⛓ + Zgjidh detyrën bllokuese
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 p-2" align="start">
                          <Input value={blockerSearch} onChange={(e) => setBlockerSearch(e.target.value)} placeholder="Kërko detyrë…" className="mb-2 h-8 text-sm" />
                          <div className="max-h-52 space-y-0.5 overflow-y-auto">
                            {(allTasks || [])
                              .filter((t) => t.id !== task.id && !(task.dependsOn || []).includes(t.id) && (!blockerSearch.trim() || t.title.toLowerCase().includes(blockerSearch.toLowerCase())))
                              .slice(0, 25)
                              .map((t) => (
                                <button
                                  key={t.id}
                                  type="button"
                                  onClick={() => { onUpdate(task.id, { dependsOn: [...(task.dependsOn || []), t.id] } as any); setBlockerSearch(''); }}
                                  className="w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                                >
                                  {t.title}
                                </button>
                              ))}
                            {(allTasks || []).filter((t) => t.id !== task.id && !(task.dependsOn || []).includes(t.id) && (!blockerSearch.trim() || t.title.toLowerCase().includes(blockerSearch.toLowerCase()))).length === 0 && (
                              <p className="px-2 py-1.5 text-xs text-muted-foreground">Asnjë detyrë.</p>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground">S'mund të përfundohet para varësisë</span>
                </div>
              </div>
            )}

            {/* Prioriteti */}
            <div className={rowCls}>
              <span className={rowLabelCls}>Prioriteti</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {([['low', 'I ulët'], ['medium', 'Mesatar'], ['high', 'I lartë'], ['urgent', '⚠ Urgjent']] as const).map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    disabled={isGuestMode}
                    onClick={() => onUpdate(task.id, { priority: k })}
                    className={chipCls((task.priority || 'medium') === k)}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Etiketat */}
            <div className={`${rowCls} items-start border-b-0`}>
              <span className={`${rowLabelCls} pt-1.5`}>Etiketat</span>
              <div className="min-w-0 flex-1">
                {isGuestMode ? (
                  <TaskLabels labels={(task as any).labels} />
                ) : (
                  <LabelEditor
                    value={(task as any).labels || []}
                    onChange={(labels) => onUpdate(task.id, { labels } as any)}
                    suggestions={labelSuggestions}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Activity history (audit trail) */}
          {taskActivities.length > 0 && (
            <div className="pt-4 border-t">
              <h4 className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground mb-2">Historik</h4>
              <ul className="space-y-1.5">
                {taskActivities.map((a) => (
                  <li key={a.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary/50 flex-shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="text-foreground font-medium">{a.createdByUserId ? getUserDisplayName(a.createdByUserId) : 'Sistemi'}</span>{' '}
                      {a.description || a.message || a.type}
                      <span className="block text-[10px] opacity-60">{formatDateCompact(a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt?.toMillis?.() || Date.now()))}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Description - Rich Text Editor */}
          <div className="pt-4 border-t">
            <h4 className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground mb-2">Përshkrimi</h4>
            {isEditingDescription ? (
              <div>
                <RichTextEditor
                  content={descriptionText}
                  onChange={(html) => setDescriptionText(html)}
                  onBlur={async (html) => {
                    const cleaned = html === '<p></p>' ? '' : html;
                    if (cleaned !== task.description) {
                      await onUpdate(task.id, { description: cleaned });
                    }
                    setIsEditingDescription(false);
                  }}
                  placeholder="Shto përshkrim..."
                  minHeight="150px"
                  autoFocus
                />
                <div className="flex justify-end gap-2 mt-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDescriptionText(task.description || '');
                      setIsEditingDescription(false);
                    }}
                  >
                    Anulo
                  </Button>
                  <Button
                    size="sm"
                    onClick={async () => {
                      const cleaned = descriptionText === '<p></p>' ? '' : descriptionText;
                      if (cleaned !== task.description) {
                        await onUpdate(task.id, { description: cleaned });
                      }
                      setIsEditingDescription(false);
                    }}
                  >
                    Ruaj
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className={`min-h-[100px] text-sm p-3 rounded border border-dashed transition-colors ${!isGuestMode ? 'cursor-pointer hover:bg-muted/50 border-transparent hover:border-border' : 'border-transparent'}`}
                onClick={() => !isGuestMode && setIsEditingDescription(true)}
              >
                {task.description ? (
                  <RichTextDisplay content={task.description} />
                ) : (
                  <span className="text-muted-foreground">{isGuestMode ? 'Nuk ka përshkrim.' : 'Kliko për të shtuar përshkrim...'}</span>
                )}
              </div>
            )}
          </div>

          {/* Collaborators */}
          {taskCollaborators && taskCollaborators.length > 0 && (
            <div className="pt-4 border-t">
              <h4 className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground mb-2">Bashkëpunëtorët</h4>
              <div className="flex flex-wrap gap-2">
                {taskCollaborators.map(collab => (
                  <Badge key={collab.id} variant="secondary" className="text-xs">
                    <Users className="w-3 h-3 mr-1" />
                    {getUserDisplayName(collab.userId)}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Time Tracking - with live timer + entry log */}
          <div className="pt-4 border-t">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Koha
              </h4>
              <span className="text-xs font-medium text-foreground">
                Total: {formatDuration(totalMinutes)}
              </span>
            </div>
            {/* Timer controls */}
            <div className="flex items-center gap-3 mb-3">
              <div className="text-xl font-mono font-bold tabular-nums">
                {formatTime(elapsedSeconds)}
              </div>
              {runningEntry ? (
                <Button onClick={stopTimer} variant="destructive" size="sm">
                  <Square className="w-3 h-3 mr-1" />
                  Stop
                </Button>
              ) : (
                <Button onClick={startTimer} size="sm" className="bg-success hover:bg-success/90">
                  <Play className="w-3 h-3 mr-1" />
                  Start
                </Button>
              )}
            </div>
            {/* Entry log */}
            {timeEntries && timeEntries.filter((e: any) => e.endTime).length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium mb-1">Log</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {timeEntries
                    .filter((e: any) => e.endTime)
                    .map((entry: any) => {
                      const start = new Date(entry.startTime?.toDate ? entry.startTime.toDate() : entry.startTime);
                      const end = new Date(entry.endTime?.toDate ? entry.endTime.toDate() : entry.endTime);
                      // Same source of truth as the Total — never the stored `duration`.
                      const dur = entryDurationMinutes(entry);
                      return (
                        <div key={entry.id} className="flex items-center justify-between text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1">
                          <span>{start.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' })}</span>
                          <span className="tabular-nums">
                            {start.toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' })}
                            {' → '}
                            {end.toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="font-medium text-foreground">{formatDuration(dur)}</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>

          {/* Subtasks */}
          {!task.parentTaskId && (
            <div className="pt-4 border-t">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
                  Nën-detyra ({subtasks?.length || 0})
                </h4>
                {!isGuestMode && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      resetSubtaskForm();
                      setShowSubtaskForm(!showSubtaskForm);
                    }}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                )}
              </div>

              {showSubtaskForm && (
                <div className="bg-muted/50 rounded-lg p-3 mb-3 space-y-3">
                  <Input
                    placeholder="Titulli i nën-detyrës"
                    value={subtaskForm.title}
                    onChange={(e) => setSubtaskForm({ ...subtaskForm, title: e.target.value })}
                    className="text-sm"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleCreateSubtask} disabled={!subtaskForm.title.trim()}>
                      Shto
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowSubtaskForm(false)}>
                      Anulo
                    </Button>
                  </div>
                </div>
              )}

              {subtasks && subtasks.length > 0 && (
                <div className="space-y-2">
                  {subtasks.map(subtask => (
                    <div key={subtask.id}>
                      {/* Subtask Card - Clickable to expand */}
                      <div 
                        className={`group border rounded-lg p-3 cursor-pointer transition-all ${
                          subtask.status === 'Done' ? 'bg-success/10 border-success/20' : 'hover:bg-muted/50 hover:border-primary/30'
                        } ${editingSubtask === subtask.id ? 'ring-2 ring-primary' : ''}`}
                        onClick={() => {
                          if (onSelectSubtask) {
                            onSelectSubtask(subtask);
                          } else if (editingSubtask !== subtask.id) {
                            startEditingSubtask(subtask);
                          }
                        }}
                      >
                        {/* Top row: Checkbox + Title + Delete */}
                        <div className="flex items-start gap-3">
                          <Checkbox 
                            checked={subtask.status === 'Done'}
                            onClick={(e) => e.stopPropagation()}
                            onCheckedChange={(checked) => {
                              handleUpdateSubtask(subtask.id, { 
                                status: checked ? 'Done' : 'Todo' 
                              });
                            }}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${subtask.status === 'Done' ? 'line-through text-muted-foreground' : ''}`}>
                              {subtask.title}
                            </p>
                            {subtask.description && (
                              // Subtasks are written in a plain textarea, so the
                              // stored value keeps real newlines — render them.
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-line">
                                {subtask.description}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteSubtask(subtask.id);
                              }}
                            >
                              <Trash2 className="w-3 h-3 text-muted-foreground" />
                            </Button>
                          </div>
                        </div>
                        
                        {/* Bottom row: Priority + Assignee + Due Date */}
                        <div className="flex items-center gap-2 mt-2 ml-7 flex-wrap">
                          <Badge className={`text-xs ${getPriorityColor(subtask.priority)}`}>
                            {getPriorityLabel(subtask.priority)}
                          </Badge>
                          {subtask.assignedToUserId && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              {getUserDisplayName(subtask.assignedToUserId)}
                            </span>
                          )}
                          {subtask.endDate && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <CalendarIcon className="w-3 h-3" />
                              {new Date(subtask.endDate).toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {/* Expanded Edit Form */}
                      {editingSubtask === subtask.id && (
                        <div className="mt-2 bg-muted/30 rounded-lg p-3 space-y-3 border border-primary/20">
                          <Input
                            placeholder="Titulli i nën-detyrës"
                            value={subtaskForm.title}
                            onChange={(e) => setSubtaskForm({ ...subtaskForm, title: e.target.value })}
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm"
                          />
                          <Textarea
                            placeholder="Përshkrimi..."
                            value={subtaskForm.description}
                            onChange={(e) => setSubtaskForm({ ...subtaskForm, description: e.target.value })}
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm min-h-[60px]"
                          />
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <Select
                              value={subtaskForm.status}
                              onValueChange={(value) => setSubtaskForm({ ...subtaskForm, status: value })}
                            >
                              <SelectTrigger className="text-sm">
                                <SelectValue placeholder="Statusi" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Todo">Për tu bërë</SelectItem>
                                <SelectItem value="In Progress">Në progres</SelectItem>
                                <SelectItem value="Review">Në rishikim</SelectItem>
                                <SelectItem value="Done">Përfunduar</SelectItem>
                              </SelectContent>
                            </Select>
                            <Select
                              value={subtaskForm.priority}
                              onValueChange={(value) => setSubtaskForm({ ...subtaskForm, priority: value })}
                            >
                              <SelectTrigger className="text-sm">
                                <SelectValue placeholder="Prioriteti" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="urgent">Urgjent</SelectItem>
                                <SelectItem value="high">Lartë</SelectItem>
                                <SelectItem value="medium">Mesatar</SelectItem>
                                <SelectItem value="low">Ulët</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className="justify-start text-sm">
                                  <CalendarIcon className="w-3 h-3 mr-1" />
                                  {subtaskForm.startDate.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' })}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0">
                                <Calendar
                                  mode="single"
                                  selected={subtaskForm.startDate}
                                  onSelect={(date) => date && setSubtaskForm({ ...subtaskForm, startDate: date })}
                                />
                              </PopoverContent>
                            </Popover>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className="justify-start text-sm">
                                  <CalendarIcon className="w-3 h-3 mr-1" />
                                  {subtaskForm.endDate.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' })}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0">
                                <Calendar
                                  mode="single"
                                  selected={subtaskForm.endDate}
                                  onSelect={(date) => date && setSubtaskForm({ ...subtaskForm, endDate: date })}
                                />
                              </PopoverContent>
                            </Popover>
                          </div>
                          <Select
                            value={subtaskForm.assignedToUserId}
                            onValueChange={(value) => setSubtaskForm({ ...subtaskForm, assignedToUserId: value })}
                          >
                            <SelectTrigger className="text-sm">
                              <SelectValue placeholder="Cakto personin përgjegjës" />
                            </SelectTrigger>
                            <SelectContent>
                              {teamMembers?.map(member => (
                                <SelectItem key={member.id} value={member.userId}>
                                  {getUserDisplayName(member.userId)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="flex gap-2 pt-2">
                            <Button 
                              size="sm" 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUpdateSubtask(subtask.id, {
                                  title: subtaskForm.title,
                                  description: subtaskForm.description,
                                  status: subtaskForm.status,
                                  priority: subtaskForm.priority,
                                  startDate: subtaskForm.startDate,
                                  endDate: subtaskForm.endDate,
                                  assignedToUserId: subtaskForm.assignedToUserId,
                                });
                                setEditingSubtask(null);
                              }}
                              disabled={!subtaskForm.title.trim()}
                            >
                              <Check className="w-3 h-3 mr-1" />
                              Ruaj
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelEditingSubtask();
                              }}
                            >
                              Anulo
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Attachments */}
          <div className="pt-4 border-t">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground flex items-center gap-2">
                <Paperclip className="w-4 h-4" />
                Materiale ({attachments.length})
              </h4>
              {!isGuestMode && (
                <div className="flex gap-1">
                  {isGoogleConnected && (
                    <Button variant="ghost" size="sm" onClick={() => setShowDrivePicker(true)} title="Google Drive">
                      <Cloud className="w-4 h-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()} disabled={commentImageUploading} title="Bashkëngjit material (imazh, PDF, Word, Excel…)" aria-label="Bashkëngjit material (imazh, PDF, Word, Excel…)">
                    {commentImageUploading ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> : <Upload className="w-4 h-4" />}
                    <span className="hidden sm:inline text-xs">Shto material</span>
                  </Button>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>

            {/* Google Drive Picker Dialog */}
            <GoogleDrivePicker
              open={showDrivePicker}
              onOpenChange={setShowDrivePicker}
              onSelect={handleDriveFileSelect}
            />
            
            {attachments.length > 0 && (
              <div className="space-y-2">
                {attachments.map((file: any, index: number) => {
                  const isImage = typeof file.type === 'string'
                    ? file.type.startsWith('image/')
                    : /\.(png|jpe?g|gif|webp|bmp)(\?.*)?$/i.test(file.url || '');
                  const isPdf = file.type === 'application/pdf' || /\.pdf(\?.*)?$/i.test(file.url || '');
                  const sizeLabel = file.size
                    ? (file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`)
                    : '';
                  return (
                    <div key={index} className="flex items-center justify-between gap-2 p-2 bg-muted/50 rounded text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        {isImage && file.url ? (
                          <a href={file.url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                            <img src={file.url} alt={file.name} loading="lazy" className="w-10 h-10 rounded object-cover border border-border/40" />
                          </a>
                        ) : (
                          <span className={`w-8 h-8 rounded flex items-center justify-center flex-shrink-0 ${isPdf ? 'bg-red-500/10 text-red-600' : 'bg-muted text-muted-foreground'}`}>
                            {file.source === 'google-drive' ? <Cloud className="w-4 h-4 text-blue-500" /> : isPdf ? <FileText className="w-4 h-4" /> : <Paperclip className="w-4 h-4" />}
                          </span>
                        )}
                        <div className="min-w-0">
                          {file.url ? (
                            <a href={file.url} target="_blank" rel="noopener noreferrer" className="block truncate text-blue-600 hover:underline">{file.name}</a>
                          ) : (
                            <span className="block truncate">{file.name}</span>
                          )}
                          {sizeLabel && <span className="text-[11px] text-muted-foreground">{sizeLabel}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        {file.url && (
                          <a href={file.url} download={file.name} target="_blank" rel="noopener noreferrer" title="Shkarko" aria-label={`Shkarko ${file.name}`} className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground">
                            <Download className="w-3 h-3" />
                          </a>
                        )}
                        {!isGuestMode && (
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Hiq materialin" aria-label={`Hiq ${file.name}`} onClick={() => handleRemoveAttachment(index)}>
                            <X className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Chat — a live conversation about this task, separate from the comment
              log. Collapsed by default: the listener only runs while it is open. */}
          <div className="pt-4 border-t">
            <button
              type="button"
              onClick={() => setShowChat(v => !v)}
              aria-expanded={showChat}
              className="w-full flex items-center justify-between mb-3 group"
            >
              <h4 className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                Chat
                {taskMessages.length > 0 && (
                  <span className="text-xs font-normal text-muted-foreground">({taskMessages.length})</span>
                )}
              </h4>
              <ChevronDown
                className={`w-4 h-4 text-muted-foreground transition-transform ${showChat ? 'rotate-180' : ''}`}
              />
            </button>

            {showChat && (
              <div className="space-y-2">
                <div
                  ref={chatScrollRef}
                  className="max-h-64 overflow-y-auto space-y-2 pr-1"
                >
                  {isLoadingMessages ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Po ngarkohen mesazhet...
                    </div>
                  ) : taskMessages.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                      Asnjë mesazh. Shkruaj të parin.
                    </p>
                  ) : (
                    taskMessages.map((m: any) => {
                      const mine = m.senderId === user?.uid;
                      const at = m.createdAt instanceof Date ? m.createdAt : null;
                      return (
                        <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm break-words ${
                              mine
                                ? 'bg-primary text-primary-foreground rounded-br-sm'
                                : 'bg-muted text-foreground rounded-bl-sm'
                            }`}
                          >
                            {!mine && (
                              <p className="text-[11px] font-medium opacity-70 mb-0.5">
                                {getUserDisplayName(m.senderId)}
                              </p>
                            )}
                            <p className="whitespace-pre-wrap">{m.content}</p>
                            {at && (
                              <p className={`text-[10px] mt-0.5 ${mine ? 'opacity-70' : 'text-muted-foreground'}`}>
                                {at.toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Input
                    value={chatMessageText}
                    onChange={(e) => setChatMessageText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendChatMessage();
                      }
                    }}
                    placeholder="Shkruaj një mesazh..."
                    className="flex-1 text-base sm:text-sm"
                  />
                  <Button
                    size="icon"
                    onClick={handleSendChatMessage}
                    disabled={!chatMessageText.trim()}
                    aria-label="Dërgo mesazhin"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Comments */}
          <div className="pt-4 border-t">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                Komente
                {comments.length > 0 && (
                  <span className="text-xs font-normal text-muted-foreground">({comments.length})</span>
                )}
              </h4>
            </div>

            {comments.length > 0 && (
              <div className="space-y-1 mb-4">
                {[...comments]
                  .sort((a, b) => {
                    const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toMillis?.() ?? new Date(a.createdAt as any).getTime() ?? 0;
                    const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toMillis?.() ?? new Date(b.createdAt as any).getTime() ?? 0;
                    return ta - tb;
                  })
                  .map((comment, idx, arr) => {
                    const isCurrentUser = (comment.createdByUserId || comment.userId) === user?.uid;
                    const commenterName = getUserDisplayName(comment.createdByUserId || comment.userId || '');
                    const initials = commenterName.slice(0, 2).toUpperCase();
                    const createdAt = comment.createdAt instanceof Date
                      ? comment.createdAt
                      : (comment.createdAt as any)?.toDate?.()
                        ? (comment.createdAt as any).toDate()
                        : new Date(comment.createdAt as any);
                    const now = new Date();
                    const diffMs = now.getTime() - createdAt.getTime();
                    const diffMin = Math.floor(diffMs / 60000);
                    const timeLabel = diffMin < 1 ? 'tani'
                      : diffMin < 60 ? `${diffMin} min`
                      : diffMin < 1440 ? `${Math.floor(diffMin / 60)} orë`
                      : createdAt.toLocaleDateString('sq-AL', { day: '2-digit', month: 'short' });

                    // Show name only when author changes
                    const prevComment = idx > 0 ? arr[idx - 1] : null;
                    const showName = !prevComment || (prevComment.createdByUserId || prevComment.userId) !== (comment.createdByUserId || comment.userId);

                    return (
                      <div
                        key={comment.id}
                        ref={registerComment(comment.id)}
                        className={`flex gap-2 scroll-mt-24 ${isCurrentUser ? 'flex-row-reverse' : 'flex-row'} ${
                          isFlashing(comment.id) ? `${COMMENT_FLASH_CLASS} p-2 -mx-1` : ''
                        }`}
                      >
                        {/* Avatar — only show when author changes */}
                        <div className="flex-shrink-0 w-7">
                          {showName && (
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold
                              ${isCurrentUser
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted-foreground/20 text-muted-foreground'}`}>
                              {initials}
                            </div>
                          )}
                        </div>

                        <div className={`max-w-[75%] ${isCurrentUser ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                          {showName && (
                            <span className={`text-[11px] font-medium text-muted-foreground px-1 flex items-center gap-1 ${isCurrentUser ? 'justify-end' : 'justify-start'}`}>
                              {isCurrentUser ? 'Ti' : commenterName}
                              {(comment as any).senderType === 'client' && (
                                <span className="text-[9px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1 py-0.5 rounded font-medium">Klient</span>
                              )}
                            </span>
                          )}
                          {editingCommentId === comment.id ? (
                            <div className="w-full flex flex-col gap-1.5">
                              <Textarea
                                value={editingCommentText}
                                onChange={e => setEditingCommentText(e.target.value)}
                                rows={2}
                                autoFocus
                                className="text-sm min-h-[60px] resize-none"
                              />
                              <div className={`flex gap-2 ${isCurrentUser ? 'justify-end' : 'justify-start'}`}>
                                <Button size="sm" className="h-7 px-3" onClick={saveEditComment} disabled={!editingCommentText.trim()}>Ruaj</Button>
                                <Button size="sm" variant="ghost" className="h-7 px-3" onClick={() => { setEditingCommentId(null); setEditingCommentText(''); }}>Anulo</Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed
                                ${isCurrentUser
                                  ? 'bg-primary text-primary-foreground rounded-tr-sm'
                                  : 'bg-muted text-foreground rounded-tl-sm'}`}>
                                {renderCommentWithMentions(comment.content, isCurrentUser)}
                                {(comment as any).edited && <span className="opacity-60 text-[10px] ml-1">(edituar)</span>}
                              </div>
                              {/* Reaction chips — one pill per emoji with its count; click to toggle your own. */}
                              {(() => {
                                const reactions = (comment as any).reactions as Record<string, string[]> | undefined;
                                const entries = reactions ? Object.entries(reactions).filter(([, ids]) => Array.isArray(ids) && ids.length > 0) : [];
                                if (entries.length === 0) return null;
                                return (
                                  <div className={`flex flex-wrap gap-1 ${isCurrentUser ? 'justify-end' : 'justify-start'}`}>
                                    {entries.map(([emoji, ids]) => {
                                      const mine = !!user?.uid && ids.includes(user.uid);
                                      return (
                                        <button
                                          key={emoji}
                                          type="button"
                                          onClick={() => onToggleReaction && toggleReaction(comment.id, emoji)}
                                          disabled={!onToggleReaction}
                                          title={ids.map(id => getUserDisplayName(id)).join(', ')}
                                          className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] border transition-colors ${mine ? 'bg-primary/10 border-primary/40 text-foreground' : 'bg-muted/60 border-transparent hover:bg-muted text-muted-foreground'}`}
                                        >
                                          <span>{emoji}</span>
                                          <span className="font-medium">{ids.length}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                              <div className={`flex items-center gap-2 px-1 ${isCurrentUser ? 'justify-end' : 'justify-start'}`}>
                                <span className="text-[10px] text-muted-foreground">{timeLabel}</span>
                                {onToggleReaction && (
                                  <div className="relative">
                                    <button type="button" onClick={() => setReactionPickerId(reactionPickerId === comment.id ? null : comment.id)} aria-label="Reago" className="text-muted-foreground hover:text-foreground transition-colors flex items-center">
                                      <SmilePlus className="w-3.5 h-3.5" />
                                    </button>
                                    {reactionPickerId === comment.id && (
                                      <div className={`absolute bottom-full mb-1 z-20 flex gap-0.5 bg-popover border rounded-full shadow-lg px-1.5 py-1 ${isCurrentUser ? 'right-0' : 'left-0'}`}>
                                        {COMMENT_REACTIONS.map(emoji => (
                                          <button key={emoji} type="button" onClick={() => toggleReaction(comment.id, emoji)} className="text-base hover:scale-125 transition-transform leading-none">{emoji}</button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                                {isCurrentUser && onEditComment && (
                                  <button type="button" onClick={() => startEditComment(comment)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">Edito</button>
                                )}
                                {isCurrentUser && onDeleteComment && (
                                  confirmDeleteCommentId === comment.id ? (
                                    <span className="inline-flex items-center gap-1.5">
                                      <button type="button" onClick={() => deleteComment(comment.id)} className="text-[10px] font-semibold text-red-500 hover:text-red-600">Fshi vërtet</button>
                                      <button type="button" onClick={() => setConfirmDeleteCommentId(null)} className="text-[10px] text-muted-foreground hover:text-foreground">Jo</button>
                                    </span>
                                  ) : (
                                    <button type="button" onClick={() => setConfirmDeleteCommentId(comment.id)} className="text-[10px] text-muted-foreground hover:text-red-500 transition-colors">Fshi</button>
                                  )
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

            {comments.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4 italic">Ende nuk ka komente</p>
            )}

            {/* Comment Input */}
            <div className="relative">
              <div
                className="flex items-center gap-2 bg-muted/40 border border-border/50 rounded-xl px-3 py-2 focus-within:border-primary/50 focus-within:bg-background transition-colors"
                onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }}
                onDrop={async (e) => {
                  const files = Array.from(e.dataTransfer?.files || []);
                  const imgs = files.filter(f => f.type.startsWith('image/'));
                  if (imgs.length === 0) return;
                  e.preventDefault();
                  for (const f of imgs) await handleCommentImageUpload(f);
                }}
              >
                <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-primary-foreground flex-shrink-0">
                  {user?.displayName?.slice(0, 2).toUpperCase() || user?.email?.slice(0, 2).toUpperCase() || 'U'}
                </div>
                <button
                  type="button"
                  onClick={() => commentFileInputRef.current?.click()}
                  disabled={commentImageUploading}
                  title={commentImageUploading ? 'Po ngarkohet…' : 'Shto imazh'}
                  className="flex-shrink-0 w-6 h-6 rounded hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {commentImageUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
                </button>
                <input
                  ref={commentFileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) await handleCommentImageUpload(f);
                  }}
                />
                <Textarea
                  ref={commentInputRef}
                  rows={1}
                  placeholder="Shto koment... @emri për të përmendur"
                  value={commentText}
                  onChange={handleCommentChange}
                  onPaste={async (e) => {
                    const items = e.clipboardData?.items;
                    if (!items) return;
                    for (let i = 0; i < items.length; i++) {
                      const it = items[i];
                      if (it.kind === 'file' && it.type.startsWith('image/')) {
                        const f = it.getAsFile();
                        if (!f) continue;
                        e.preventDefault();
                        await handleCommentImageUpload(f);
                        return;
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    // Enter submits; Shift+Enter inserts a newline. Never submit
                    // while the @mention list is open (Enter picks a suggestion).
                    if (e.key === 'Enter' && !e.shiftKey && !showMentionSuggestions) {
                      e.preventDefault();
                      handleAddCommentSubmit();
                    }
                    if (e.key === 'Escape') {
                      setShowMentionSuggestions(false);
                    }
                  }}
                  className="border-0 bg-transparent focus-visible:ring-0 text-sm p-0 min-h-0 resize-none leading-snug max-h-40 overflow-y-auto"
                />
                {commentText.trim() && (
                  <button
                    onClick={handleAddCommentSubmit}
                    className="flex-shrink-0 w-7 h-7 rounded-lg bg-primary flex items-center justify-center hover:bg-primary/90 transition-colors"
                  >
                    <Send className="w-3.5 h-3.5 text-primary-foreground" />
                  </button>
                )}
              </div>
              {/* Client visibility is OPT-IN per comment: comments are internal
                  by default; checking this stamps customerId, which is what the
                  portal's query (and the rules) key client access on. */}
              {!!(task as any).customerId && !isGuestMode && (
                <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={commentVisibleToClient}
                    onChange={(e) => setCommentVisibleToClient(e.target.checked)}
                    className="h-3 w-3 accent-primary"
                  />
                  Dukshëm për klientin në portal
                  {commentVisibleToClient && <span className="font-semibold text-amber-600">— klienti do ta lexojë</span>}
                </label>
              )}
              {showMentionSuggestions && mentionSuggestions.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-popover border rounded-lg shadow-lg z-50">
                  <div className="p-1">
                    <p className="text-xs text-muted-foreground px-2 py-1">Përmend dikë</p>
                    {mentionSuggestions.map(member => (
                      <button
                        key={member.id}
                        className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent rounded flex items-center gap-2"
                        onClick={() => insertMention(member.userId)}
                      >
                        <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium">
                          {getUserDisplayName(member.userId).slice(0, 2).toUpperCase()}
                        </div>
                        <span className="truncate">{getUserDisplayName(member.userId)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>

        {/* Footer: Fshi · përmbledhja · Ruaj (design) */}
        <div className="flex items-center gap-2.5 border-t bg-muted/30 px-4 py-3 pb-[max(0.75rem,var(--safe-area-bottom))] sm:px-6 sm:py-3.5">
          {/* Delete: manager rank or owning the task (creator/assignee) — the
              rules accept any member's delete, so the UI must not offer more
              than the role is meant to have. */}
          {!isGuestMode && permissions.canEdit
            && (permissions.isAdmin || permissions.isManager
                || task.createdByUserId === user?.uid || task.assignedToUserId === user?.uid) && (
            <button
              type="button"
              onClick={() => setDeleteConfirm(true)}
              className="flex items-center gap-1.5 text-[12.5px] font-bold text-red-600 transition-colors hover:text-red-700"
            >
              <Trash2 className="h-3.5 w-3.5" /> Fshi
            </button>
          )}
          {isGuestMode && (
            <span className="flex items-center gap-1 text-xs text-amber-600">
              <Eye className="h-3 w-3" />
              Vetëm shikimi + komente
            </span>
          )}
          <span className="flex-1" />
          <span className="hidden text-[11.5px] text-muted-foreground sm:block">{footerSummary}</span>
          {!isGuestMode && (
            <Button size="sm" className="rounded-[10px] text-[13px] font-extrabold" onClick={handleFooterSave}>
              ✓ Ruaj ndryshimet
            </Button>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Fshi Detyrën</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Je i sigurt që dëshiron të fshish detyrën <span className="font-semibold text-foreground">"{task.title}"</span>? Ky veprim nuk mund të zhbëhet.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(false)}>Anulo</Button>
            <Button variant="destructive" onClick={() => { onDelete(task.id); onClose(); setDeleteConfirm(false); }}>Fshi</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default TaskDetailPanel;
