import React, { useState, useRef, useEffect } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useActivityLogger } from '../hooks/useActivityLogger';
import { useGoogleApi, DriveFile } from '../contexts/GoogleApiContext';
import { Calendar as CalendarIcon, MessageSquare, Users, ChevronRight, ChevronDown, Clock, Play, Pause, Square, Paperclip, Upload, X, AtSign, Eye, Plus, Trash2, Edit2, Send, Hash, Check, Cloud } from 'lucide-react';
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
import type { Task, TaskComment } from '../types';

interface TaskDetailPanelProps {
  task: Task;
  onClose: () => void;
  comments: TaskComment[];
  onAddComment: (taskId: string, content: string) => void;
  onUpdate: (id: string, data: any) => Promise<any>;
  onDelete: (id: string) => Promise<any>;
  projects?: { id: string; name: string }[];
  onSelectSubtask?: (subtask: Task) => void;
}

const TaskDetailPanel: React.FC<TaskDetailPanelProps> = ({ 
  task, 
  onClose, 
  comments, 
  onAddComment, 
  onUpdate, 
  onDelete,
  projects = [],
  onSelectSubtask
}) => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const { isConnected: isGoogleConnected } = useGoogleApi();
  const [commentText, setCommentText] = useState('');
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
    } catch {
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

    await taskMutation.create({
      title: subtaskForm.title,
      description: subtaskForm.description,
      status: subtaskForm.status,
      priority: subtaskForm.priority,
      startDate: subtaskForm.startDate,
      endDate: subtaskForm.endDate,
      assignedToUserId: subtaskForm.assignedToUserId || user.uid,
      projectId: task.projectId,
      parentTaskId: task.id,
      collaboratorIds: [],
    });

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
    const lastAtIndex = commentText.lastIndexOf('@');
    const newText = commentText.slice(0, lastAtIndex) + `@${userId} `;
    setCommentText(newText);
    setShowMentionSuggestions(false);
  };

  const handleAddCommentSubmit = async () => {
    if (commentText.trim()) {
      const mentionRegex = /@(\S+)/g;
      const mentions = commentText.match(mentionRegex) || [];
      
      const notificationPromises = mentions
        .map(m => m.slice(1))
        .filter(uid => uid !== user?.uid)
        .map(uid => notificationMutation.create({
          userId: uid,
          title: 'Ju përmendën në një koment',
          message: `${user?.displayName || 'Dikush'} ju përmendi në detyrën: ${task.title}`,
          isRead: false,
        }));
      
      await Promise.all(notificationPromises);

      onAddComment(task.id, commentText);
      setCommentText('');
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
    const parts = content.split(/(@\S+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
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
      {/* Header with Status Badge and Close */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b bg-muted/30">
        <Badge 
          className={`${task.status === 'Done' ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground'}`}
        >
          {task.status === 'Done' && <Check className="w-3 h-3 mr-1" />}
          {task.status}
        </Badge>
        <div className="flex items-center gap-2">
          {activeWorkers.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-success">
              <Eye className="w-3 h-3 animate-pulse" />
              <span>{activeWorkers.length} duke punuar</span>
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
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
                          if (prevAssignee !== user.uid) {
                            await notificationMutation.create({
                              userId: user.uid,
                              title: 'Detyrë e Re e Caktuar',
                              message: `Ju u caktuat te detyra: ${task.title}`,
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
              <div className="flex items-center gap-3 sm:gap-4">
                <span className="text-xs sm:text-sm text-muted-foreground w-16 sm:w-20 flex-shrink-0">Përsërit.</span>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary/10 text-primary px-2.5 py-1 rounded-full">
                    🔄 {task.recurringFrequency === 'daily' ? 'Çdo ditë' :
                         task.recurringFrequency === 'weekly' ? `Çdo ${['Diel','Hënë','Martë','Mërkurë','Enjte','Premte','Shtunë'][(task as any).recurringDayOfWeek ?? 0]}` :
                         task.recurringFrequency === 'monthly' ? `Çdo muaj, ditën ${(task as any).recurringDayOfMonth ?? 1}` :
                         'Çdo vit'}
                  </span>
                </div>
              </div>
            )}

            {/* Project */}
            {task.projectId && (
              <div className="flex items-center gap-3 sm:gap-4">
                <span className="text-xs sm:text-sm text-muted-foreground w-16 sm:w-20 flex-shrink-0">Projekti</span>
                <span className="text-sm">{projects.find(p => p.id === task.projectId)?.name || task.projectId.slice(0, 12) + '...'}</span>
              </div>
            )}

            {/* Status & Priority - Inline */}
            <div className="flex items-center gap-3 sm:gap-4">
              <span className="text-xs sm:text-sm text-muted-foreground w-16 sm:w-20 flex-shrink-0">Statusi</span>
              <Select 
                value={task.status} 
                onValueChange={async (newStatus) => {
                  await onUpdate(task.id, { status: newStatus });
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

          {/* Time Tracking - Compact */}
          <div className="pt-4 border-t">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Koha
              </h4>
              <span className="text-xs text-muted-foreground">
                Total: {formatDuration(totalMinutes)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-xl font-mono font-bold">
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
            <h4 className="text-sm font-medium text-muted-foreground mb-3">
              Komente ({comments.length})
            </h4>
            
            {comments.length > 0 && (
              <div className="space-y-3 mb-4">
                {comments.map(comment => {
                  // Get commenter info
                  const commenterMember = teamMembers?.find(m => m.userId === comment.createdByUserId);
                  const isCurrentUser = comment.createdByUserId === user?.uid;
                  const commenterName = getUserDisplayName(comment.createdByUserId || '');
                  
                  return (
                    <div key={comment.id} className="bg-muted/50 p-3 rounded">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium">
                          {commenterName.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium">{commenterName}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(comment.createdAt).toLocaleString('sq-AL')}
                        </span>
                      </div>
                      <p className="text-sm pl-8">{renderCommentWithMentions(comment.content)}</p>
                    </div>
                  );
                })}
              </div>
            )}
            
            {/* Comment Input */}
            <div className="relative">
              <div className="flex items-center gap-2 bg-muted/30 rounded-lg p-2">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium flex-shrink-0">
                  {user?.displayName?.slice(0, 2).toUpperCase() || 'U'}
                </div>
                <Input
                  placeholder="Shto koment... përdor @emri për të përmendur dikë"
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
                  className="border-0 bg-transparent focus-visible:ring-0 text-sm"
                />
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
