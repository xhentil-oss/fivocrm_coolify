import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import {
  Bell, Check, Trash2, AlertCircle, CheckCircle, Info, ExternalLink,
  MessageSquare, DollarSign, RefreshCw, Target, FileText, Users, User,
  Calendar, Clock, TrendingUp, Zap, ChevronDown,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { writeBatch, doc } from 'firebase/firestore';
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
  // Critical — task / deadline overdue
  task_overdue:            { icon: <AlertCircle className="w-4 h-4 text-red-500" />,     priority: 'critical', borderColor: 'border-l-red-500',    bgColor: 'bg-red-50/60 dark:bg-red-950/20' },
  invoice_overdue:         { icon: <AlertCircle className="w-4 h-4 text-red-500" />,     priority: 'critical', borderColor: 'border-l-red-500',    bgColor: 'bg-red-50/60 dark:bg-red-950/20' },
  goal_overdue:            { icon: <Target className="w-4 h-4 text-red-500" />,          priority: 'critical', borderColor: 'border-l-red-500',    bgColor: 'bg-red-50/60 dark:bg-red-950/20' },
  // Warning — due soon / follow-up
  task_due_soon:           { icon: <Clock className="w-4 h-4 text-amber-500" />,         priority: 'warning',  borderColor: 'border-l-amber-500',  bgColor: 'bg-amber-50/60 dark:bg-amber-950/20' },
  lead_follow_up:          { icon: <Clock className="w-4 h-4 text-amber-500" />,         priority: 'warning',  borderColor: 'border-l-amber-500',  bgColor: 'bg-amber-50/60 dark:bg-amber-950/20' },
  invoice_reminder_sent:   { icon: <FileText className="w-4 h-4 text-amber-500" />,      priority: 'warning',  borderColor: 'border-l-amber-500',  bgColor: 'bg-amber-50/60 dark:bg-amber-950/20' },
  project_open_reminder:   { icon: <Calendar className="w-4 h-4 text-amber-500" />,      priority: 'warning',  borderColor: 'border-l-amber-500',  bgColor: 'bg-amber-50/60 dark:bg-amber-950/20' },
  // Success
  invoice_paid:            { icon: <DollarSign className="w-4 h-4 text-emerald-500" />,  priority: 'success',  borderColor: 'border-l-emerald-500', bgColor: 'bg-emerald-50/60 dark:bg-emerald-950/20' },
  goal_achieved:           { icon: <CheckCircle className="w-4 h-4 text-emerald-500" />, priority: 'success',  borderColor: 'border-l-emerald-500', bgColor: 'bg-emerald-50/60 dark:bg-emerald-950/20' },
  // Assignments & collaboration
  task_assigned:           { icon: <User className="w-4 h-4 text-blue-500" />,           priority: 'info',     borderColor: 'border-l-blue-500',   bgColor: 'bg-blue-50/60 dark:bg-blue-950/20' },
  task_collaborator_added: { icon: <Users className="w-4 h-4 text-violet-500" />,        priority: 'info',     borderColor: 'border-l-violet-500',  bgColor: 'bg-violet-50/60 dark:bg-violet-950/20' },
  task_mention:            { icon: <MessageSquare className="w-4 h-4 text-violet-500" />, priority: 'info',    borderColor: 'border-l-violet-500',  bgColor: 'bg-violet-50/60 dark:bg-violet-950/20' },
  lead_assigned:           { icon: <User className="w-4 h-4 text-blue-500" />,           priority: 'info',     borderColor: 'border-l-blue-500',   bgColor: 'bg-blue-50/60 dark:bg-blue-950/20' },
  lead_converted:          { icon: <TrendingUp className="w-4 h-4 text-emerald-500" />,  priority: 'success',  borderColor: 'border-l-emerald-500', bgColor: 'bg-emerald-50/60 dark:bg-emerald-950/20' },
  goal_assigned:           { icon: <Target className="w-4 h-4 text-blue-500" />,         priority: 'info',     borderColor: 'border-l-blue-500',   bgColor: 'bg-blue-50/60 dark:bg-blue-950/20' },
  // Messages
  client_message:          { icon: <MessageSquare className="w-4 h-4 text-emerald-500" />, priority: 'info',   borderColor: 'border-l-emerald-500', bgColor: 'bg-emerald-50/60 dark:bg-emerald-950/20' },
  staff_message:           { icon: <MessageSquare className="w-4 h-4 text-blue-500" />,  priority: 'info',     borderColor: 'border-l-blue-500',   bgColor: 'bg-blue-50/60 dark:bg-blue-950/20' },
  project_comment:         { icon: <MessageSquare className="w-4 h-4 text-blue-500" />,  priority: 'info',     borderColor: 'border-l-blue-500',   bgColor: 'bg-blue-50/60 dark:bg-blue-950/20' },
  client_request:          { icon: <MessageSquare className="w-4 h-4 text-emerald-500" />, priority: 'info',   borderColor: 'border-l-emerald-500', bgColor: 'bg-emerald-50/60 dark:bg-emerald-950/20' },
  // Projects / invoices
  project_created:         { icon: <Zap className="w-4 h-4 text-blue-500" />,            priority: 'neutral',  borderColor: '',                    bgColor: '' },
  auto_invoice_created:    { icon: <FileText className="w-4 h-4 text-blue-500" />,       priority: 'neutral',  borderColor: '',                    bgColor: '' },
  invoice_created:         { icon: <FileText className="w-4 h-4 text-blue-500" />,       priority: 'neutral',  borderColor: '',                    bgColor: '' },
  // Recurring / automation
  recurring_task_created:  { icon: <RefreshCw className="w-4 h-4 text-indigo-500" />,    priority: 'neutral',  borderColor: '',                    bgColor: '' },
  recurring_expense_created:{ icon: <RefreshCw className="w-4 h-4 text-indigo-500" />,   priority: 'neutral',  borderColor: '',                    bgColor: '' },
  project_cycle_reset:     { icon: <RefreshCw className="w-4 h-4 text-indigo-500" />,    priority: 'neutral',  borderColor: '',                    bgColor: '' },
  // Expenses
  expense_submitted:       { icon: <DollarSign className="w-4 h-4 text-blue-500" />,     priority: 'neutral',  borderColor: '',                    bgColor: '' },
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

const LOAD_STEP = 30;

const NotificationsCenter: React.FC = () => {
  const { user } = useAuth();
  const [displayLimit, setDisplayLimit] = useState(LOAD_STEP);

  const { data: notifications, loading: isPending } = useCollection<Notification>('notifications', {
    skip: !user,
    where: user ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
    orderBy: { field: 'createdAt', direction: 'desc' },
  });

  const notificationMutation = useMutation<Notification>('notifications');

  const unreadCount = notifications?.filter(n => !n.isRead).length || 0;
  const unreadClientCount = notifications?.filter(n => !n.isRead && (n as any).type === 'client_message').length || 0;
  const unreadMentionCount = notifications?.filter(n => !n.isRead && ((n as any).type === 'task_mention' || (n as any).type === 'task_collaborator_added')).length || 0;
  const criticalCount = notifications?.filter(n => !n.isRead && getConfig((n as any).type).priority === 'critical').length || 0;

  const handleMarkAsRead = async (id: string) => {
    await notificationMutation.update(id, { isRead: true });
  };

  const handleMarkAllAsRead = async () => {
    const unread = notifications?.filter(n => !n.isRead) || [];
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    for (const notification of unread) {
      batch.update(doc(db, 'notifications', notification.id), { isRead: true });
    }
    await batch.commit();
  };

  const handleDelete = async (id: string) => {
    await notificationMutation.remove(id);
  };

  const unreadNotifications = notifications?.filter(n => !n.isRead) || [];
  const allNotifications = notifications || [];
  const visibleAll = allNotifications.slice(0, displayLimit);
  const hasMore = allNotifications.length > displayLimit;

  return (
    <DropdownMenu>
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
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] max-w-[400px] sm:w-[400px] p-0">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground">Njoftime</h3>
            {criticalCount > 0 && (
              <Badge className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 text-xs px-1.5">
                {criticalCount} urgjent
              </Badge>
            )}
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkAllAsRead}
              className="text-xs"
            >
              <Check className="w-3 h-3 mr-1" />
              Shëno të lexuara
            </Button>
          )}
        </div>

        <Tabs defaultValue="unread" className="w-full">
          <TabsList className="w-full rounded-none border-b">
            <TabsTrigger value="unread" className="flex-1">
              Të palexuara ({unreadCount})
            </TabsTrigger>
            <TabsTrigger value="all" className="flex-1">
              Të gjitha ({allNotifications.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="unread" className="m-0">
            <ScrollArea className="max-h-[60vh] sm:max-h-[400px]">
              {isPending ? (
                <div className="p-8 text-center text-muted-foreground">
                  Duke ngarkuar...
                </div>
              ) : unreadNotifications.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Bell className="w-12 h-12 mx-auto mb-2 opacity-20" />
                  <p>Nuk ka njoftime të palexuara</p>
                </div>
              ) : (
                <div className="divide-y">
                  {unreadNotifications.map(notification => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onMarkAsRead={handleMarkAsRead}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="all" className="m-0">
            <ScrollArea className="max-h-[60vh] sm:max-h-[400px]">
              {isPending ? (
                <div className="p-8 text-center text-muted-foreground">
                  Duke ngarkuar...
                </div>
              ) : allNotifications.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Bell className="w-12 h-12 mx-auto mb-2 opacity-20" />
                  <p>Nuk ka njoftime ende</p>
                </div>
              ) : (
                <div className="divide-y">
                  {visibleAll.map(notification => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onMarkAsRead={handleMarkAsRead}
                      onDelete={handleDelete}
                    />
                  ))}
                  {hasMore && (
                    <button
                      className="w-full py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 flex items-center justify-center gap-1 transition-colors"
                      onClick={() => setDisplayLimit(prev => prev + LOAD_STEP)}
                    >
                      <ChevronDown className="w-4 h-4" />
                      Ngarko më shumë ({allNotifications.length - displayLimit} mbetën)
                    </button>
                  )}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const NotificationItem: React.FC<{
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
}> = ({ notification, onMarkAsRead, onDelete }) => {
  const navigate = useNavigate();
  const n = notification as any;
  const config = getConfig(n.type);

  const timeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return 'tani';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m më parë`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h më parë`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d më parë`;
    return new Date(date).toLocaleDateString('sq-AL');
  };

  const hasAction = n.linkTo || n.actionUrl || n.type === 'client_message';

  const handleAction = () => {
    if (!notification.isRead) onMarkAsRead(notification.id);
    if (n.linkTo) navigate(n.linkTo);
    else if (n.type === 'client_message') navigate('/app/chat');
    else if (n.actionUrl) navigate(n.actionUrl);
  };

  const isUnread = !notification.isRead;
  const borderClass = isUnread && config.borderColor ? `border-l-2 ${config.borderColor}` : '';
  const bgClass = isUnread && config.bgColor ? config.bgColor : isUnread ? 'bg-primary/5' : '';

  return (
    <div
      className={`p-4 hover:bg-muted/50 transition-colors ${borderClass} ${bgClass} ${hasAction ? 'cursor-pointer' : ''}`}
      onClick={hasAction ? handleAction : undefined}
    >
      <div className="flex gap-3">
        <div className="flex-shrink-0 mt-1">
          {config.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="font-medium text-sm text-foreground leading-snug">
                {notification.title}
              </p>
              {notification.message && (
                <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                  {notification.message}
                </p>
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
                      : n.type === 'task_collaborator_added' || n.type === 'task_mention'
                      ? 'border-violet-200 text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-400'
                      : ''
                  }`}
                  onClick={(e) => { e.stopPropagation(); handleAction(); }}
                >
                  {n.type === 'client_message' || n.linkTo
                    ? <><MessageSquare className="w-3 h-3" />Hap Chat</>
                    : <><ExternalLink className="w-3 h-3" />{n.actionLabel || 'Shiko'}</>
                  }
                </Button>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                {timeAgo(notification.createdAt)}
              </p>
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
