import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { Bell, Check, Trash2, Mail, Calendar, User, AlertCircle, CheckCircle, Info, ExternalLink } from 'lucide-react';
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

const NotificationsCenter: React.FC = () => {
  const { user } = useAuth();
  const { data: notifications, loading: isPending } = useCollection<Notification>('notifications', {
    where: user ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
    orderBy: { field: 'createdAt', direction: 'desc' },
  });

  const notificationMutation = useMutation<Notification>('notifications');

  const unreadCount = notifications?.filter(n => !n.isRead).length || 0;

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

  const getNotificationIcon = (title: string) => {
    if (title.includes('Task')) return <Calendar className="w-4 h-4 text-primary" />;
    if (title.includes('Comment')) return <Mail className="w-4 h-4 text-info" />;
    if (title.includes('Assigned')) return <User className="w-4 h-4 text-success" />;
    if (title.includes('Due')) return <AlertCircle className="w-4 h-4 text-warning" />;
    if (title.includes('Completed')) return <CheckCircle className="w-4 h-4 text-success" />;
    return <Info className="w-4 h-4 text-muted-foreground" />;
  };

  const unreadNotifications = notifications?.filter(n => !n.isRead) || [];
  const readNotifications = notifications?.filter(n => n.isRead) || [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon"
          className="bg-white/10 text-primary-foreground hover:bg-white/20 relative"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <Badge 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 bg-accent text-accent-foreground text-xs"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] max-w-[400px] sm:w-[400px] p-0">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Notifications</h3>
          {unreadCount > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleMarkAllAsRead}
              className="text-xs"
            >
              <Check className="w-3 h-3 mr-1" />
              Mark all read
            </Button>
          )}
        </div>

        <Tabs defaultValue="unread" className="w-full">
          <TabsList className="w-full rounded-none border-b">
            <TabsTrigger value="unread" className="flex-1">
              Unread ({unreadCount})
            </TabsTrigger>
            <TabsTrigger value="all" className="flex-1">
              All ({notifications?.length || 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="unread" className="m-0">
            <ScrollArea className="max-h-[60vh] sm:max-h-[400px]">
              {isPending ? (
                <div className="p-8 text-center text-muted-foreground">
                  Loading notifications...
                </div>
              ) : unreadNotifications.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Bell className="w-12 h-12 mx-auto mb-2 opacity-20" />
                  <p>No unread notifications</p>
                </div>
              ) : (
                <div className="divide-y">
                  {unreadNotifications.map(notification => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onMarkAsRead={handleMarkAsRead}
                      onDelete={handleDelete}
                      getIcon={getNotificationIcon}
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
                  Loading notifications...
                </div>
              ) : notifications?.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Bell className="w-12 h-12 mx-auto mb-2 opacity-20" />
                  <p>No notifications yet</p>
                </div>
              ) : (
                <div className="divide-y">
                  {notifications?.map(notification => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onMarkAsRead={handleMarkAsRead}
                      onDelete={handleDelete}
                      getIcon={getNotificationIcon}
                    />
                  ))}
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
  getIcon: (title: string) => React.ReactNode;
}> = ({ notification, onMarkAsRead, onDelete, getIcon }) => {
  const navigate = useNavigate();
  const timeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(date).toLocaleDateString();
  };

  const handleAction = () => {
    const n = notification as any;
    if (n.actionType === 'navigate' && n.actionUrl) {
      navigate(n.actionUrl);
      if (!notification.isRead) onMarkAsRead(notification.id);
    }
  };

  const actionLabel = (notification as any).actionLabel;
  const actionUrl = (notification as any).actionUrl;

  return (
    <div 
      className={`p-4 hover:bg-muted/50 transition-colors ${
        !notification.isRead ? 'bg-primary/5' : ''
      }`}
    >
      <div className="flex gap-3">
        <div className="flex-shrink-0 mt-1">
          {getIcon(notification.title)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="font-medium text-sm text-foreground">
                {notification.title}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {notification.message}
              </p>
              {actionUrl && actionLabel && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 h-7 text-xs gap-1"
                  onClick={handleAction}
                >
                  <ExternalLink className="w-3 h-3" />
                  {actionLabel}
                </Button>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                {timeAgo(notification.createdAt)}
              </p>
            </div>
            {!notification.isRead && (
              <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-1" />
            )}
          </div>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          {!notification.isRead && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onMarkAsRead(notification.id)}
            >
              <Check className="w-4 h-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-error hover:text-error"
            onClick={() => onDelete(notification.id)}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotificationsCenter;
