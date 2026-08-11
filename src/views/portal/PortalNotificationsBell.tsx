import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { writeBatch, doc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useCollection, useMutation } from '../../hooks/useFirestore';
import {
  Bell,
  FileText,
  Calculator,
  ScrollText,
  MessageCircle,
  FolderKanban,
  CheckCircle2,
  ClipboardList,
  Check,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
} from '../../components/ui/dropdown-menu';
import { ScrollArea } from '../../components/ui/scroll-area';
import type { Notification } from '../../types';

// Icon + color per notification type (client-facing types).
const visualFor = (type?: string): { Icon: any; box: string } => {
  switch (type) {
    case 'invoice_sent':
    case 'invoice_created':
    case 'invoice_overdue':
    case 'invoice_reminder_sent': return { Icon: FileText, box: 'bg-blue-100 text-blue-600' };
    case 'invoice_paid': return { Icon: CheckCircle2, box: 'bg-green-100 text-green-600' };
    case 'quote_sent':
    case 'quote_accepted':
    case 'quote_rejected': return { Icon: Calculator, box: 'bg-primary/15 text-primary' };
    case 'contract_sent': return { Icon: ScrollText, box: 'bg-amber-100 text-amber-600' };
    case 'staff_message':
    case 'client_message': return { Icon: MessageCircle, box: 'bg-pink-100 text-pink-600' };
    case 'project_created':
    case 'project_completed':
    case 'project_comment': return { Icon: FolderKanban, box: 'bg-purple-100 text-purple-600' };
    default: return { Icon: ClipboardList, box: 'bg-muted text-muted-foreground' };
  }
};

const timeAgo = (v: any): string => {
  const d = v instanceof Date ? v : v?.toDate?.();
  if (!d) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'tani';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} orë`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} ditë`;
  return d.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' });
};

/**
 * In-portal notifications inbox. Reuses the uid-keyed `notifications` collection
 * (same data the push/email choke point writes). Portal-safe: deep-links stay
 * under /portal/* via each notification's actionUrl.
 */
const PortalNotificationsBell: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const notificationMutation = useMutation<Notification>('notifications');

  const { data: rawNotifs } = useCollection<Notification>('notifications', {
    skip: !user,
    where: user ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
    orderBy: { field: 'createdAt', direction: 'desc' },
    limit: 50,
    skipTeamFilter: true,
  });

  const notifs = rawNotifs || [];
  const unread = useMemo(() => notifs.filter(n => !n.isRead), [notifs]);

  const markRead = (id: string) => {
    notificationMutation.update(id, { isRead: true } as any).catch(() => { /* non-blocking */ });
  };

  const markAllRead = async () => {
    if (unread.length === 0) return;
    try {
      const batch = writeBatch(db);
      unread.forEach(n => batch.update(doc(db, 'notifications', n.id), { isRead: true }));
      await batch.commit();
    } catch { /* non-blocking */ }
  };

  // Where a notification should land inside the portal when it has no in-portal
  // actionUrl of its own. Everything used to fall back to /portal/chat, so an
  // invoice or contract notification opened the conversation instead of the thing
  // it was about.
  const PORTAL_FALLBACK: Record<string, string> = {
    invoice_sent: '/portal/invoices',
    invoice_created: '/portal/invoices',
    invoice_paid: '/portal/invoices',
    invoice_overdue: '/portal/invoices',
    invoice_reminder_sent: '/portal/invoices',
    quote_sent: '/portal/quotes',
    quote_accepted: '/portal/quotes',
    quote_rejected: '/portal/quotes',
    contract_sent: '/portal/contracts',
    project_created: '/portal/projects',
    project_completed: '/portal/projects',
    project_comment: '/portal/projects',
    report: '/portal/reports',
    staff_message: '/portal/chat',
    client_message: '/portal/chat',
  };

  const handleClick = (n: Notification) => {
    if (!n.isRead) markRead(n.id);
    setOpen(false);
    const target = n.actionUrl?.startsWith('/portal')
      ? n.actionUrl
      : PORTAL_FALLBACK[n.type || ''] || '/portal';
    navigate(target);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Njoftimet"
          className="relative flex h-9 w-9 items-center justify-center rounded-full border bg-background/60 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Bell className="h-4 w-4" />
          {unread.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white rounded-full flex items-center justify-center text-[9px] font-bold">
              {unread.length > 9 ? '9+' : unread.length}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[340px] p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="font-semibold text-sm">Njoftimet</span>
          {unread.length > 0 && (
            <button onClick={markAllRead} className="text-xs text-primary hover:underline flex items-center gap-1">
              <Check className="h-3 w-3" /> Shëno të gjitha
            </button>
          )}
        </div>
        {notifs.length === 0 ? (
          <div className="py-12 text-center px-6">
            <Bell className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nuk keni njoftime</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[380px]">
            <div>
              {notifs.map(n => {
                const v = visualFor(n.type);
                const Icon = v.Icon;
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/40 transition-colors ${!n.isRead ? 'bg-primary/[0.04]' : ''}`}
                  >
                    <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${v.box}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-sm truncate ${!n.isRead ? 'font-semibold' : 'font-medium'}`}>{n.title}</p>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">{timeAgo(n.createdAt)}</span>
                      </div>
                      {n.message && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.message}</p>}
                    </div>
                    {!n.isRead && <span className="mt-1.5 h-2 w-2 rounded-full bg-primary flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default PortalNotificationsBell;
