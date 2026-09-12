import React from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronRight, ExternalLink, MessageSquare, Bell } from 'lucide-react';
import { Button } from '../ui/button';
import FollowUpBadge, { FOLLOW_UP_TYPE_ICON } from './FollowUpBadge';
import NextStepPopover, { type NextStepSubmit } from './NextStepPopover';
import SnoozeMenu from './SnoozeMenu';
import ContactQuickActions from './ContactQuickActions';
import { followUpItemHref, waitingSince, type FollowUpItem, type SnoozePresetKey } from '../../lib/crm/followUp';
import type { FollowUpType } from '../../types';
import { cn } from '../../lib/utils';

// ── Row ──────────────────────────────────────────────────────────────────────

const DUE_DOT: Record<string, string> = {
  overdue: 'bg-red-500 text-white',
  today: 'bg-amber-500 text-white',
  upcoming: 'bg-blue-500 text-white',
  none: 'bg-muted text-muted-foreground',
  waiting: 'bg-red-600 text-white',
};

export interface FollowUpRowProps {
  item: FollowUpItem;
  now: Date;
  getName: (uid: string) => string;
  /** Section the row is rendered in — a waiting row shows the inbound context. */
  section: 'awaitingReply' | 'overdue' | 'today' | 'thisWeek' | 'noNextStep';
  onComplete: (item: FollowUpItem, payload: NextStepSubmit) => unknown | Promise<unknown>;
  onSchedule: (item: FollowUpItem, payload: NextStepSubmit) => unknown | Promise<unknown>;
  onSnooze: (item: FollowUpItem, preset: SnoozePresetKey | Date) => unknown | Promise<unknown>;
  onLogged: (item: FollowUpItem, channel: FollowUpType) => void;
  onOpenWhatsApp?: (item: FollowUpItem) => void;
  onOpenEmail?: (item: FollowUpItem) => void;
  onCloseLead?: (item: FollowUpItem, status: 'Won' | 'Lost') => void;
  focused?: boolean;
  /** When set, the row fades out (just completed / snoozed). */
  leaving?: boolean;
  /** Playbook context, e.g. "SEO · hapi 2/7" — shown as a chip. */
  hint?: string | null;
  /** Contact tags (first two shown). */
  tags?: string[] | null;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || '?';

export const FollowUpRow: React.FC<FollowUpRowProps> = ({
  item, now, getName, section, onComplete, onSchedule, onSnooze, onLogged, onOpenWhatsApp, onOpenEmail, onCloseLead, focused, leaving, hint, tags,
}) => {
  const isWaiting = section === 'awaitingReply';
  const TypeIcon = FOLLOW_UP_TYPE_ICON[item.type];
  const dotClass = isWaiting ? DUE_DOT.waiting : DUE_DOT[item.due.state];
  const assignee = item.assignedToUserId ? getName(item.assignedToUserId) : null;
  const href = followUpItemHref(item);
  const primaryLabel = isWaiting ? 'Përgjigju' : item.type === 'call' ? 'Thirr' : item.type === 'whatsapp' ? 'WhatsApp' : item.type === 'email' ? 'Email' : 'U bë';

  const contact = { name: item.name, phone: item.phone, email: item.email };

  const completeTrigger = (
    <Button size="sm" variant="outline" className="h-8 border-emerald-500/40 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40" title="U bë">
      <Check className="w-4 h-4 sm:mr-1" />
      <span className="hidden sm:inline">U bë</span>
    </Button>
  );

  const scheduleTrigger = (
    <Button size="sm" variant={section === 'noNextStep' ? 'default' : 'ghost'} className="h-8" title="Cakto hapin tjetër">
      <Bell className="w-4 h-4 sm:mr-1" />
      <span className="hidden sm:inline">{section === 'noNextStep' ? 'Cakto hapin' : 'Ndrysho'}</span>
    </Button>
  );

  return (
    <div
      data-followup-id={`${item.kind}:${item.id}`}
      className={cn(
        'group flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 py-2.5 sm:min-h-[56px] rounded-lg border bg-card transition-all',
        focused && 'ring-2 ring-primary/50',
        leaving && 'opacity-0 translate-x-2 pointer-events-none',
      )}
    >
      {/* Identity */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className={cn('w-8 h-8 rounded-full flex items-center justify-center shrink-0', dotClass)} title={item.due.label}>
          {isWaiting ? <MessageSquare className="w-4 h-4" /> : <TypeIcon className="w-4 h-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <Link to={href} className="font-medium text-sm truncate hover:underline" onClick={(e) => e.stopPropagation()}>
              {item.name}
            </Link>
            {item.company && <span className="text-xs text-muted-foreground truncate hidden md:inline">— {item.company}</span>}
            <span className={cn('text-[10px] uppercase tracking-wide rounded px-1 py-px shrink-0',
              item.kind === 'lead' ? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300')}>
              {item.kind === 'lead' ? 'Lead' : 'Klient'}
            </span>
            {(tags || []).slice(0, 2).map(t => (
              <span key={t} className="hidden sm:inline text-[10px] rounded px-1 py-px bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300 shrink-0">{t}</span>
            ))}
            {hint && <span className="hidden md:inline text-[10px] text-muted-foreground shrink-0">· {hint}</span>}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
            {isWaiting ? (
              <span className="truncate text-red-600 dark:text-red-400 font-medium">
                Pret përgjigje {waitingSince(item.raw, now) ? `· ${waitingSince(item.raw, now)}` : ''}
                {(item.raw as any).lastInboundText ? ` · “${(item.raw as any).lastInboundText}”` : ''}
              </span>
            ) : item.note ? (
              <span className="truncate">{item.note}</span>
            ) : (
              <span className="truncate italic opacity-70">{section === 'noNextStep' ? 'Asgjë e planifikuar' : 'Pa shënim'}</span>
            )}
          </div>
        </div>
      </div>

      {/* Due + assignee */}
      <div className="flex items-center gap-2 sm:shrink-0">
        {!isWaiting && <FollowUpBadge contact={item.raw} now={now} showType={false} hideWhenNone />}
        {assignee && (
          <span className="w-6 h-6 rounded-full bg-muted text-[10px] font-semibold flex items-center justify-center shrink-0" title={assignee}>
            {initials(assignee)}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 sm:shrink-0 sm:opacity-80 sm:group-hover:opacity-100">
        <ContactQuickActions
          contact={contact}
          entity={item.kind}
          compact
          onLogged={(ch) => onLogged(item, ch)}
          onOpenWhatsApp={onOpenWhatsApp ? () => onOpenWhatsApp(item) : undefined}
          onOpenEmail={onOpenEmail ? () => onOpenEmail(item) : undefined}
        />
        <span className="w-px h-5 bg-border mx-1 hidden sm:block" />
        {section === 'noNextStep' ? (
          <NextStepPopover
            contact={item.raw as any}
            entity={item.kind}
            mode="schedule"
            trigger={scheduleTrigger}
            onSubmit={(p) => onSchedule(item, p)}
            onCloseLead={onCloseLead ? (s) => onCloseLead(item, s) : undefined}
          />
        ) : (
          <>
            <NextStepPopover
              contact={item.raw as any}
              entity={item.kind}
              mode="complete"
              trigger={completeTrigger}
              onSubmit={(p) => onComplete(item, p)}
              onCloseLead={onCloseLead ? (s) => onCloseLead(item, s) : undefined}
            />
            {!isWaiting && <SnoozeMenu size="icon" onSnooze={(p) => onSnooze(item, p)} />}
          </>
        )}
        <Button asChild variant="ghost" size="icon" className="h-8 w-8 hidden sm:inline-flex" title="Hap">
          <Link to={href}><ExternalLink className="w-4 h-4" /></Link>
        </Button>
        <span className="sm:hidden ml-auto text-xs text-muted-foreground">{primaryLabel}</span>
      </div>
    </div>
  );
};

// ── Section ──────────────────────────────────────────────────────────────────

interface SectionProps {
  id: string;
  title: string;
  count: number;
  tone: 'red' | 'amber' | 'blue' | 'gray' | 'crimson';
  hint?: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
  emptyText?: string;
}

const TONE: Record<SectionProps['tone'], string> = {
  crimson: 'text-red-700 dark:text-red-400 border-red-300/60',
  red: 'text-red-600 dark:text-red-400 border-red-200/60',
  amber: 'text-amber-700 dark:text-amber-400 border-amber-200/60',
  blue: 'text-blue-700 dark:text-blue-400 border-blue-200/60',
  gray: 'text-muted-foreground border-border',
};

export const FollowUpSection: React.FC<SectionProps> = ({ id, title, count, tone, hint, defaultOpen = true, collapsible = true, action, children, emptyText }) => {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section id={id} className="space-y-2 scroll-mt-24">
      <div className={cn('sticky top-0 z-10 bg-background/95 backdrop-blur flex items-center gap-2 py-1.5 border-b', TONE[tone])}>
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm font-semibold"
          onClick={() => collapsible && setOpen(o => !o)}
          disabled={!collapsible}
        >
          {collapsible ? (open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : <span className="w-4" />}
          {title}
          <span className="ml-1 text-xs font-mono rounded-full bg-muted text-foreground px-1.5 py-px">{count}</span>
        </button>
        {hint && <span className="text-xs text-muted-foreground hidden md:inline">{hint}</span>}
        <div className="ml-auto flex items-center gap-2">{action}</div>
      </div>
      {open && (
        count === 0 ? (
          <p className="text-xs text-muted-foreground px-3 py-2">{emptyText || 'Asgjë këtu.'}</p>
        ) : (
          <div className="space-y-1.5">{children}</div>
        )
      )}
    </section>
  );
};

export default FollowUpRow;
