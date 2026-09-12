import React from 'react';
import { Phone, MessageSquare, Mail, Users, Flag } from 'lucide-react';
import { dueState, type FollowUpContact } from '../../lib/crm/followUp';
import type { FollowUpType } from '../../types';
import { cn } from '../../lib/utils';

export const FOLLOW_UP_TYPE_ICON: Record<FollowUpType, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  whatsapp: MessageSquare,
  email: Mail,
  meeting: Users,
  other: Flag,
};

interface Props {
  contact: FollowUpContact | null | undefined;
  now?: Date;
  size?: 'sm' | 'md';
  /** Show the channel icon of the next step (default true). */
  showType?: boolean;
  /** Render nothing when there is no next step (default: shows "Pa hap tjetër" muted). */
  hideWhenNone?: boolean;
  className?: string;
  title?: string;
}

/**
 * The ONE rendering of "when is the next step due". Replaces the three
 * duplicated pills CRMView used to carry (mobile card, table cell, drawer tab).
 */
const FollowUpBadge: React.FC<Props> = ({ contact, now, size = 'md', showType = true, hideWhenNone, className, title }) => {
  const due = dueState(contact, now);
  if (due.state === 'none' && hideWhenNone) return null;
  const type = (contact?.nextFollowUpType || 'other') as FollowUpType;
  const Icon = FOLLOW_UP_TYPE_ICON[type];
  return (
    <span
      title={title || (contact?.followUpNote || undefined)}
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap',
        size === 'sm' ? 'text-[11px] px-1.5 py-px' : 'text-xs px-2 py-0.5',
        due.className,
        className,
      )}
    >
      {showType && due.state !== 'none' && <Icon className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />}
      {due.label}
    </span>
  );
};

export default FollowUpBadge;
