import React, { useState, useRef, useEffect } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useActivityLogger } from '../hooks/useActivityLogger';
import { useGoogleApi, DriveFile } from '../contexts/GoogleApiContext';
import { Calendar as CalendarIcon, MessageSquare, Users, ChevronRight, ChevronDown, Clock, Play, Pause, Square, Paperclip, Upload, X, AtSign, Eye, Plus, Trash2, Edit2, Send, Hash, Check, Cloud, Maximize2, Minimize2 } from 'lucide-react';
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
import type { Task, TaskComment } from '../types';

interface TaskDetailPanelProps {
  task: Task;
  onClose: () => void;
  onExpand?: () => void;
  isExpanded?: boolean;
  comments: TaskComment[];
  onAddComment: (taskId: string, content: string) => void;
  onUpdate: (id: string, data: any) => Promise<any>;
  onDelete: (id: string) => Promise<any>;
  projects?: { id: string; name: string }[];
  projectsLoading?: boolean;
  allTasks?: Task[];
  onSelectSubtask?: (subtask: Task) => void;
}

const TaskDetailPanel: React.FC<TaskDetailPanelProps> = ({ 
  task, 
  onClose,
  onExpand,
  isExpanded,
  comments, 
  onAddComment, 
  onUpdate, 
  onDelete,
  projects = [],
  projectsLoading = false,
  allTasks,
  onSelectSubtask
}) => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const { isConnected: isGoogleConnected } = useGoogleApi();
  const [commentText, setCommentText] = useState('');
  const [mentionMap, setMentionMap] = useState<Record<string, string>>({}); // displayName → uid
  const [showSubtasks, setShowSubtasks] = useState(true);
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
    orderBy: { field: 'createdAt', direction: 'asc' }
  });

  const { data: allActiveTimeEntries } = useCollection<any>('timeEntries', {
    where: [{ field: 'endTime', operator: '==', value: null }]
  });

  const { data: teamMembers } = useCollection<any>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }]
  });

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
  }, [task.id, task.title, task.description, task.startDate, task.endDate]);

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
    await taskMutation.create({
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
    });

    // Notify assigned user for subtask
    if (subtaskAssignee !== user.uid) {
      await notificationMutation.create({
        userId: subtaskAssignee,
        title: 'Nën-detyrë e Re e Caktuar',
        message: `Ju u caktuat te nën-detyra: ${subtaskForm.title}`,
        isRead: false,
      }).catch(() => {});
    }

    resetSubtaskForm();
    setShowSubtaskForm(false);
  };

  const handleUpdateSubtask = async (subtaskId: string, data: any) => {
    await taskMutation.update(subtaskId, data);
    setEditingSubtask(null);
  };

  const handleDeleteSubtask = async (subtaskId: string) => {
    await taskMutation.remove(subtaskId);
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

    await timeEntryMutation.create({
      userId: user.uid,
      taskId: task.id,
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
      // Save comment first — then notify
      await onAddComment(task.id, finalText);
      setCommentText('');
      setMentionMap({});
      playFrogSound();

      const mentionedArray = [...mentionedUids].filter(uid => uid !== user?.uid);

      // Auto-add mentioned staff as task collaborators so they can see task + project
      const currentCollaboratorIds: string[] = Array.isArray((task as any).collaboratorIds)
        ? (task as any).collaboratorIds
        : [];
      const newCollaborators = mentionedArray.filter(uid => !currentCollaboratorIds.includes(uid));
      if (newCollaborators.length > 0) {
        await taskMutation.update(task.id, {
          collaboratorIds: [...currentCollaboratorIds, ...newCollaborators],
        });
        // Notify new collaborators they now have access
        await Promise.all(newCollaborators.map(uid =>
          notificationMutation.create({
            userId: uid,
            type: 'task_collaborator_added',
            title: '📋 Shtuar si Bashkëpunëtor',
            message: `${user?.displayName || 'Dikush'} ju shtoi si bashkëpunëtor në detyrën: "${task.title}"`,
            isRead: false,
            actionUrl: task.projectId ? `/app/projects/${task.projectId}` : '/app/tasks',
            actionLabel: task.projectId ? 'Shiko Projektin' : 'Shiko Detyrat',
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
          actionUrl: task.projectId ? `/app/projects/${task.projectId}` : '/app/tasks',
          actionLabel: task.projectId ? 'Shiko Detyrën' : 'Shiko Detyrat',
        }));
      await Promise.all(mentionNotifPromises);
    } catch {
      // Comment failed to save — keep text so user can retry
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments = [...attachments];
    
    for (const file of Array.from(files)) {
      const url = URL.createObjectURL(file);
      const attachment = {
        name: file.name,
        size: file.size,
        type: file.type,
        url,
        uploadedBy: user?.uid,
        uploadedAt: new Date().toISOString(),
      };
      newAttachments.push(attachment);
    }

    await onUpdate(task.id, { attachments: JSON.stringify(newAttachments) });
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



  const renderCommentWithMentions = (content: string) => {
    // Split on either @[Name](uid) or legacy @uid tokens
    const parts = content.split(/(@\[[^\]]+\]\([^)]+\)|@\S+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        // New format: @[DisplayName](userId)
        const newFmt = part.match(/^@\[([^\]]+)\]\(([^)]+)\)$/);
        if (newFmt) {
          return (
            <span key={i} className="text-primary font-medium bg-primary/10 px-1 rounded">
              @{newFmt[1]}
            </span>
          );
        }
        // Legacy format: @userId — resolve name via lookup
        const uid = part.slice(1);
        const displayName = getUserDisplayName(uid);
        return (
          <span key={i} className="text-primary font-medium bg-primary/10 px-1 rounded">
            @{displayName}
          </span>
        );
      }
      return part;
    });
  };

  const totalMinutes = timeEntries?.reduce((sum, entry) => sum + (entry.duration || 0), 0) || 0;

  const handleStartDateChange = async (date: Date | undefined) => {
    if (date) {
      if (date > endDate) {
        return; // Data e fillimit nuk mund të jetë pas përfundimit
      }
      setStartDate(date);
      await onUpdate(task.id, { startDate: date });
    }
  };

  const handleEndDateChange = async (date: Date | undefined) => {
    if (date) {
      if (date < startDate) {
        return; // Afati i përfundimit nuk mund të jetë para fillimit
      }
      setEndDate(date);
      await onUpdate(task.id, { endDate: date });
    }
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

  const taskLabel = React.useMemo(() => {
    const words = task.title.split(' ').slice(0, 3);
    if (words.length === 1 && words[0].length > 15) {
      return words[0].slice(0, 12) + '...';
    }
    return words.join(' ');
  }, [task.title]);

  // Format date compactly
  const formatDateCompact = (date: Date) => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}`;
  };

  return (
    <>
    <div className="h-full flex flex-col bg-background border-l">
      {/* Header with Status Select and Close */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b bg-muted/30">
        <Select
          value={task.status}
          onValueChange={async (newStatus) => {
            await onUpdate(task.id, { status: newStatus });
            const labels: Record<string, string> = { Todo: 'Për të bërë', 'In Progress': 'Në progres', Review: 'Rishikim', Done: 'Përfunduar' };
            toast({ title: 'Statusi u ndryshua ✓', description: `"${task.title}" → ${labels[newStatus] ?? newStatus}` });
          }}
        >
          <SelectTrigger
            className={`
              h-7 w-auto border-0 shadow-none text-xs font-semibold px-2.5 py-1 rounded-full focus:ring-0 gap-1.5
              ${task.status === 'Done' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25'
                : task.status === 'In Progress' ? 'bg-blue-500/15 text-blue-700 dark:text-blue-400 hover:bg-blue-500/25'
                : task.status === 'Review' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25'
                : 'bg-slate-200/80 text-slate-700 dark:bg-slate-700 dark:text-slate-300 hover:bg-slate-300/80'}
            `}
          >
            {task.status === 'Done' && <Check className="w-3 h-3" />}
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Todo">Për të bërë</SelectItem>
            <SelectItem value="In Progress">Në progres</SelectItem>
            <SelectItem value="Review">Rishikim</SelectItem>
            <SelectItem value="Done">Përfunduar</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          {activeWorkers.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-success">
              <Eye className="w-3 h-3 animate-pulse" />
              <span>{activeWorkers.length} duke punuar</span>
            </div>
          )}
          {/* Expand / shrink panel */}
          {onExpand && (
            <Button variant="ghost" size="sm" onClick={onExpand} title={isExpanded ? 'Palos' : 'Zgjero'}>
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </Button>
          )}
          {/* Close button — clearly visible */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0 rounded-md hover:bg-destructive/10 hover:text-destructive"
            title="Mbyll"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Scrollable Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
          {/* Editable Title */}
          <div>
            {isEditingTitle ? (
              <div className="flex items-center gap-2">
                <Input
                  ref={titleInputRef}
                  value={titleText}
                  onChange={(e) => setTitleText(e.target.value)}
                  onBlur={handleSaveTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTitle();
                    if (e.key === 'Escape') {
                      setTitleText(task.title);
                      setIsEditingTitle(false);
                    }
                  }}
                  className="text-xl sm:text-2xl font-semibold h-auto py-1 px-2"
                />
              </div>
            ) : (
              <h1 
                className="text-xl sm:text-2xl font-semibold text-foreground cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors"
                onClick={() => setIsEditingTitle(true)}
              >
                {task.title}
              </h1>
            )}
          </div>

          {/* Compact Info Row: Assignee + Dates */}
          <div className="space-y-3">
            {/* Assignee - Editable */}
            <div className="flex items-center gap-3 sm:gap-4">
              <span className="text-xs sm:text-sm text-muted-foreground w-16 sm:w-20 flex-shrink-0">Caktuar te</span>
              <Popover>
                <PopoverTrigger asChild>
                  <button 
                    className="flex items-center gap-2 hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors"
                  >
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium">
                      {getUserDisplayName(task.assignedToUserId!).slice(0, 2).toUpperCase()}
                    </div>
                    <span className="text-sm">
                      {getUserDisplayName(task.assignedToUserId || '') || 'Pa caktuar'}
                    </span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="start">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground px-2 py-1">Zgjidh përdoruesin</p>
                    
                    {/* Current user option */}
                    {user && (
                      <button
                        className={`w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-muted/50 text-left ${
                          task.assignedToUserId === user.uid ? 'bg-primary/10' : ''
                        }`}
                        onClick={async () => {
                          const prevAssignee = task.assignedToUserId;
                          await onUpdate(task.id, { assignedToUserId: user.uid });
                          if (prevAssignee && prevAssignee !== user.uid) {
                            await notificationMutation.create({
                              userId: prevAssignee,
                              title: 'Detyrë e Ri-caktuar',
                              message: `Detyra "${task.title}" u ri-caktua nga ti te ${user.displayName || 'një anëtar tjetër'}`,
                              isRead: false,
                            });
                            logActivity('update', `Detyra "${task.title}" u ri-caktua`, {
                              description: `Nga: ${prevAssignee || 'Pa caktuar'} → Te: ${user.uid}`,
                              entityType: 'task',
                              entityId: task.id,
                            });
                          }
                        }}
                      >
                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium">
                          {user.displayName?.slice(0, 2).toUpperCase() || 'U'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{user.displayName || 'Ti'}</p>
                          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                        </div>
                        {task.assignedToUserId === user.uid && (
                          <Check className="w-4 h-4 text-primary" />
                        )}
                      </button>
                    )}
                    
                    {/* Team members - only for users with canAssignTasks */}
                    {permissions.canAssignTasks && teamMembers && teamMembers.length > 0 && (
                      <>
                        <div className="border-t my-2" />
                        <p className="text-xs text-muted-foreground px-2 py-1">Anëtarët e ekipit</p>
                        {teamMembers
                          .filter(m => m.userId !== user?.uid)
                          .map(member => (
                            <button
                              key={member.id}
                              className={`w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-muted/50 text-left ${
                                task.assignedToUserId === member.userId ? 'bg-primary/10' : ''
                              }`}
                              onClick={async () => {
                                  const prevAssignee = task.assignedToUserId;
                                  await onUpdate(task.id, { assignedToUserId: member.userId });
                                  if (member.userId !== prevAssignee) {
                                    if (member.userId !== user?.uid) {
                                      await notificationMutation.create({
                                        userId: member.userId,
                                        title: 'Detyrë e Re e Caktuar',
                                        message: `${user?.displayName || 'Dikush'} ju caktoi detyrën: ${task.title}`,
                                        isRead: false,
                                      });
                                    }
                                    logActivity('update', `Detyra "${task.title}" u ri-caktua`, {
                                      description: `Nga: ${prevAssignee || 'Pa caktuar'} → Te: ${member.userId}`,
                                      entityType: 'task',
                                      entityId: task.id,
                                    });
                                  }
                              }}
                            >
                              <div className="w-6 h-6 rounded-full bg-secondary/50 flex items-center justify-center text-xs font-medium">
                                {getUserDisplayName(member.userId).slice(0, 2).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm truncate">{getUserDisplayName(member.userId)}</p>
                                <p className="text-xs text-muted-foreground">{member.role}</p>
                              </div>
                              {task.assignedToUserId === member.userId && (
                                <Check className="w-4 h-4 text-primary" />
                              )}
                            </button>
                          ))}
                      </>
                    )}
                    
                    {/* Manual input option - only for admin/manager */}
                    {permissions.canAssignTasks && (
                    <>
                    <div className="border-t my-2" />
                    <div className="px-2">
                      <p className="text-xs text-muted-foreground mb-1">Ose shkruaj User ID:</p>
                      <Input
                        placeholder="User ID..."
                        className="h-8 text-xs"
                        defaultValue={task.assignedToUserId || ''}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            const newUserId = (e.target as HTMLInputElement).value;
                            if (newUserId && newUserId !== task.assignedToUserId) {
                              manualInputRef.current = newUserId;
                              const prevAssignee = task.assignedToUserId;
                              await onUpdate(task.id, { assignedToUserId: newUserId });
                              if (newUserId !== user?.uid) {
                                await notificationMutation.create({
                                  userId: newUserId,
                                  title: 'Detyrë e Re e Caktuar',
                                  message: `${user?.displayName || 'Dikush'} ju caktoi detyrën: ${task.title}`,
                                  isRead: false,
                                });
                              }
                              logActivity('update', `Detyra "${task.title}" u ri-caktua`, {
                                description: `Nga: ${prevAssignee || 'Pa caktuar'} → Te: ${newUserId}`,
                                entityType: 'task',
                                entityId: task.id,
                              });
                            }
                          }
                        }}
                        onBlur={async (e) => {
                          const newUserId = e.target.value;
                          // Skip if already handled by Enter key
                          if (manualInputRef.current === newUserId) {
                            manualInputRef.current = '';
                            return;
                          }
                          if (newUserId && newUserId !== task.assignedToUserId) {
                            const prevAssignee = task.assignedToUserId;
                            await onUpdate(task.id, { assignedToUserId: newUserId });
                            if (newUserId !== user?.uid) {
                              await notificationMutation.create({
                                userId: newUserId,
                                title: 'Detyrë e Re e Caktuar',
                                message: `${user?.displayName || 'Dikush'} ju caktoi detyrën: ${task.title}`,
                                isRead: false,
                              });
                            }
                            logActivity('update', `Detyra "${task.title}" u ri-caktua`, {
                              description: `Nga: ${prevAssignee || 'Pa caktuar'} → Te: ${newUserId}`,
                              entityType: 'task',
                              entityId: task.id,
                            });
                          }
                        }}
                      />
                    </div>
                    </>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Due Date - Compact */}
            <div className="flex items-center gap-3 sm:gap-4">
              <span className="text-xs sm:text-sm text-muted-foreground w-16 sm:w-20 flex-shrink-0">Afati</span>
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-2 text-sm hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors">
                    <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                    <span>{formatDateCompact(endDate)}</span>
                    <X className="w-3 h-3 text-muted-foreground hover:text-foreground" onClick={(e) => e.stopPropagation()} />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar 
                    mode="single" 
                    selected={endDate} 
                    onSelect={handleEndDateChange}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Start Date - Compact (optional, smaller) */}
            <div className="flex items-center gap-3 sm:gap-4">
              <span className="text-xs sm:text-sm text-muted-foreground w-16 sm:w-20 flex-shrink-0">Fillimi</span>
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-2 text-sm text-muted-foreground hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors">
                    <CalendarIcon className="w-3 h-3" />
                    <span className="text-xs">{formatDateCompact(startDate)}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar 
                    mode="single" 
                    selected={startDate} 
                    onSelect={handleStartDateChange}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Recurring Info */}
            {task.isRecurring && (
              <div className="flex items-start gap-3 sm:gap-4">
                <span className="text-xs sm:text-sm text-muted-foreground w-16 sm:w-20 flex-shrink-0 pt-0.5">Përsërit.</span>
                <div className="flex-1">
                  {!editingRecurring ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary/10 text-primary px-2.5 py-1 rounded-full">
                        🔄 {task.recurringFrequency === 'daily'
                             ? (() => {
                                 const days = (task as any).recurringDaysOfWeek as number[] | undefined;
                                 const names = ['Die','Hën','Mar','Mër','Enj','Pre','Sht'];
                                 return days && days.length > 0
                                   ? `Çdo ${days.map(d => names[d]).join(', ')}`
                                   : `Çdo ditë`;
                               })()
                             : task.recurringFrequency === 'weekly'
                             ? `Çdo ${(task.recurringInterval ?? 1) > 1 ? (task.recurringInterval ?? 1) + ' javë' : 'javë'}, ${['Diel','Hënë','Martë','Mërkurë','Enjte','Premte','Shtunë'][(task as any).recurringDayOfWeek ?? 0]}`
                             : task.recurringFrequency === 'monthly'
                             ? `Çdo ${(task.recurringInterval ?? 1) > 1 ? (task.recurringInterval ?? 1) + ' muaj' : 'muaj'}, ditën ${(task as any).recurringDayOfMonth ?? 1}`
                             : `Çdo ${(task.recurringInterval ?? 1) > 1 ? (task.recurringInterval ?? 1) + ' vite' : 'vit'}`}
                      </span>
                      {permissions.canEdit && (task.recurringFrequency === 'weekly' || task.recurringFrequency === 'daily') && (
                        <button
                          onClick={() => setEditingRecurring(true)}
                          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                        >
                          Ndrysho
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {task.recurringFrequency === 'weekly' && (
                        <div className="flex flex-wrap gap-1.5">
                          {[{v:1,l:'Hën'},{v:2,l:'Mar'},{v:3,l:'Mër'},{v:4,l:'Enj'},{v:5,l:'Pre'},{v:6,l:'Sht'},{v:0,l:'Die'}].map(day => (
                            <button
                              key={day.v}
                              type="button"
                              onClick={() => setRecurringDayOfWeek(day.v)}
                              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                                recurringDayOfWeek === day.v
                                  ? 'bg-primary text-primary-foreground border-primary'
                                  : 'bg-background text-foreground border-border hover:bg-muted'
                              }`}
                            >
                              {day.l}
                            </button>
                          ))}
                        </div>
                      )}
                      {task.recurringFrequency === 'daily' && (
                        <div className="flex flex-wrap gap-1.5">
                          {[{v:1,l:'Hën'},{v:2,l:'Mar'},{v:3,l:'Mër'},{v:4,l:'Enj'},{v:5,l:'Pre'},{v:6,l:'Sht'},{v:0,l:'Die'}].map(day => (
                            <button
                              key={day.v}
                              type="button"
                              onClick={() => toggleRecurringDay(day.v)}
                              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                                recurringDaysOfWeek.includes(day.v)
                                  ? 'bg-primary text-primary-foreground border-primary'
                                  : 'bg-background text-foreground border-border hover:bg-muted'
                              }`}
                            >
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
                </div>
              </div>
            )}

            {/* Dependencies */}
            {task.dependsOn && task.dependsOn.length > 0 && (
              <div className="flex items-start gap-3 sm:gap-4">
                <span className="text-xs sm:text-sm text-muted-foreground w-16 sm:w-20 flex-shrink-0 pt-0.5">Varet nga</span>
                <div className="flex flex-col gap-1">
                  {task.dependsOn.map((depId) => {
                    // Look up the dependency among subtasks + any task we might have
                    const allKnown = [...(subtasks || [])];
                    const dep = allKnown.find((t) => t.id === depId);
                    const isDone = dep?.status === 'Done';
                    return (
                      <span
                        key={depId}
                        className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${
                          isDone
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300'
                        }`}
                      >
                        {isDone ? '✓' : '🔒'}
                        <span className="truncate max-w-[160px]">
                          {dep?.title || depId.slice(0, 8) + '…'}
                        </span>
                        {dep && (
                          <span className="text-[10px] opacity-70">
                            ({dep.status === 'Done' ? 'Kryer' : dep.status === 'In Progress' ? 'Në progres' : dep.status === 'Review' ? 'Rishikim' : 'Në pritje'})
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Project */}
            {task.projectId && (
              <div className="flex items-center gap-3 sm:gap-4">
                <span className="text-xs sm:text-sm text-muted-foreground w-16 sm:w-20 flex-shrink-0">Projekti</span>
                <span className="text-sm">
                  {projectsLoading
                    ? <span className="text-muted-foreground">Duke ngarkuar...</span>
                    : (projects.find(p => p.id === task.projectId)?.name || <span className="text-muted-foreground italic">Pa projekt</span>)
                  }
                </span>
              </div>
            )}

            {/* Status & Priority - Inline */}
            <div className="flex items-center gap-3 sm:gap-4">
              <span className="text-xs sm:text-sm text-muted-foreground w-16 sm:w-20 flex-shrink-0">Statusi</span>
              <Select 
                value={task.status} 
                onValueChange={async (newStatus) => {
                  await onUpdate(task.id, { status: newStatus });
                  const labels: Record<string, string> = { Todo: 'Për të bërë', 'In Progress': 'Në progres', Review: 'Rishikim', Done: 'Përfunduar' };
                  toast({ title: 'Statusi u ndryshua ✓', description: `"${task.title}" → ${labels[newStatus] ?? newStatus}` });
                }}
              >
                <SelectTrigger className="w-32 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Todo">Për të bërë</SelectItem>
                  <SelectItem value="In Progress">Në progres</SelectItem>
                  <SelectItem value="Review">Rishikim</SelectItem>
                  <SelectItem value="Done">Përfunduar</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3 sm:gap-4">
              <span className="text-xs sm:text-sm text-muted-foreground w-16 sm:w-20 flex-shrink-0">Prioriteti</span>
              <Select 
                value={task.priority || 'medium'} 
                onValueChange={async (newPriority) => {
                  await onUpdate(task.id, { priority: newPriority });
                }}
              >
                <SelectTrigger className="w-32 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">I ulët</SelectItem>
                  <SelectItem value="medium">Mesatar</SelectItem>
                  <SelectItem value="high">I lartë</SelectItem>
                  <SelectItem value="urgent">Urgjent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Description - Rich Text Editor */}
          <div className="pt-4 border-t">
            <h4 className="text-sm font-medium text-muted-foreground mb-2">Përshkrimi</h4>
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
                className="min-h-[100px] text-sm cursor-pointer hover:bg-muted/50 p-3 rounded border border-dashed border-transparent hover:border-border transition-colors"
                onClick={() => setIsEditingDescription(true)}
              >
                {task.description ? (
                  <RichTextDisplay content={task.description} />
                ) : (
                  <span className="text-muted-foreground">Kliko për të shtuar përshkrim...</span>
                )}
              </div>
            )}
          </div>

          {/* Collaborators */}
          {taskCollaborators && taskCollaborators.length > 0 && (
            <div className="pt-4 border-t">
              <h4 className="text-sm font-medium text-muted-foreground mb-2">Bashkëpunëtorët</h4>
              <div className="flex flex-wrap gap-2">
                {taskCollaborators.map(collab => (
                  <Badge key={collab.id} variant="secondary" className="text-xs">
                    <Users className="w-3 h-3 mr-1" />
                    {collab.userId.slice(0, 8)}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Time Tracking - with live timer + entry log */}
          <div className="pt-4 border-t">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
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
                      const dur = entry.duration || Math.floor((end.getTime() - start.getTime()) / 60000);
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
                <h4 className="text-sm font-medium text-muted-foreground">
                  Nën-detyra ({subtasks?.length || 0})
                </h4>
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
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
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
                          <div className="grid grid-cols-2 gap-2">
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
                          <div className="grid grid-cols-2 gap-2">
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
                                  {member.userId.slice(0, 12)}...
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
              <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Paperclip className="w-4 h-4" />
                Skedarët ({attachments.length})
              </h4>
              <div className="flex gap-1">
                {isGoogleConnected && (
                  <Button variant="ghost" size="sm" onClick={() => setShowDrivePicker(true)} title="Google Drive">
                    <Cloud className="w-4 h-4" />
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} title="Ngarko skedar">
                  <Upload className="w-4 h-4" />
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
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
                {attachments.map((file: any, index: number) => (
                  <div key={index} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      {file.source === 'google-drive' ? (
                        <Cloud className="w-3 h-3 text-blue-500 flex-shrink-0" />
                      ) : (
                        <Paperclip className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      )}
                      {file.url ? (
                        <a href={file.url} target="_blank" rel="noopener noreferrer" className="truncate text-blue-600 hover:underline">{file.name}</a>
                      ) : (
                        <span className="truncate">{file.name}</span>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => handleRemoveAttachment(index)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Comments */}
          <div className="pt-4 border-t">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
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
                      <div key={comment.id} className={`flex gap-2 ${isCurrentUser ? 'flex-row-reverse' : 'flex-row'}`}>
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
                            <span className={`text-[11px] font-medium text-muted-foreground px-1 ${isCurrentUser ? 'text-right' : 'text-left'}`}>
                              {isCurrentUser ? 'Ti' : commenterName}
                            </span>
                          )}
                          <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed
                            ${isCurrentUser
                              ? 'bg-primary text-primary-foreground rounded-tr-sm'
                              : 'bg-muted text-foreground rounded-tl-sm'}`}>
                            {renderCommentWithMentions(comment.content)}
                          </div>
                          <span className={`text-[10px] text-muted-foreground px-1 ${isCurrentUser ? 'text-right' : 'text-left'}`}>
                            {timeLabel}
                          </span>
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
              <div className="flex items-center gap-2 bg-muted/40 border border-border/50 rounded-xl px-3 py-2 focus-within:border-primary/50 focus-within:bg-background transition-colors">
                <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-primary-foreground flex-shrink-0">
                  {user?.displayName?.slice(0, 2).toUpperCase() || user?.email?.slice(0, 2).toUpperCase() || 'U'}
                </div>
                <Input
                  placeholder="Shto koment... @emri për të përmendur"
                  value={commentText}
                  onChange={handleCommentChange}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !showMentionSuggestions) {
                      handleAddCommentSubmit();
                    }
                    if (e.key === 'Escape') {
                      setShowMentionSuggestions(false);
                    }
                  }}
                  className="border-0 bg-transparent focus-visible:ring-0 text-sm p-0 h-auto"
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

      {/* Footer Actions */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-t bg-muted/30">
        <Button variant="ghost" size="sm" className="text-error hover:text-error" onClick={() => setDeleteConfirm(true)}>
          <Trash2 className="w-4 h-4 mr-1" />
          Fshi
        </Button>
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
