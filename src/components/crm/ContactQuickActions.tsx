import React, { useState } from 'react';
import { Phone, Mail, MessageSquare, MessageCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useWhatsappEnabled } from '../../hooks/useFirestore';
import { normalizeAlbanianPhone } from '../../lib/utils';
import type { FollowUpEntity } from '../../lib/crm/followUp';
import type { FollowUpType } from '../../types';
import { cn } from '../../lib/utils';

interface Props {
  contact: { name: string; phone?: string | null; email?: string | null };
  entity: FollowUpEntity;
  /** Icon-only buttons (row hover / mobile footer). */
  compact?: boolean;
  /** Called when the user confirms they contacted the person ("Po, regjistro") or a message was sent. */
  onLogged?: (channel: FollowUpType) => void;
  /** Opens the in-app WhatsApp panel; without it falls back to a wa.me link. */
  onOpenWhatsApp?: () => void;
  /** Opens the in-app email composer; without it falls back to mailto:. */
  onOpenEmail?: () => void;
  /** Show the SMS button (drawer only). */
  withSms?: boolean;
  className?: string;
  stopPropagation?: boolean;
}

/**
 * Thirr · WhatsApp · Email (· SMS) — the same buttons on every surface (lead
 * rows/cards/drawer, customer rows, Customer360 header). `tel:` and `mailto:`
 * cannot tell us what happened, so after the click a small prompt asks
 * "A e kontaktove?" and logs the touch on "Po".
 */
const ContactQuickActions: React.FC<Props> = ({
  contact, compact, onLogged, onOpenWhatsApp, onOpenEmail, withSms, className, stopPropagation = true,
}) => {
  const waEnabled = useWhatsappEnabled();
  const [confirm, setConfirm] = useState<FollowUpType | null>(null);
  const phone = contact.phone?.trim() || '';
  const email = contact.email?.trim() || '';
  const waPhone = phone ? normalizeAlbanianPhone(phone) : '';

  const stop = (e: React.SyntheticEvent) => { if (stopPropagation) e.stopPropagation(); };

  const btnClass = compact ? 'h-7 w-7' : 'h-8';
  const iconClass = compact ? 'w-3.5 h-3.5' : 'w-4 h-4 mr-1.5';

  const askConfirm = (channel: FollowUpType) => {
    if (!onLogged) return;
    // Give the OS a beat to hand off to the dialer/mail client before asking.
    setTimeout(() => setConfirm(channel), 400);
  };

  const confirmPrompt = (channel: FollowUpType, child: React.ReactNode) => (
    <Popover open={confirm === channel} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
      <PopoverTrigger asChild>{child}</PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3" onClick={stop}>
        <p className="text-sm font-medium mb-2">
          A e kontaktove {contact.name.split(' ')[0]}?
        </p>
        <div className="flex gap-2">
          <Button size="sm" className="h-8 flex-1" onClick={(e) => { stop(e); onLogged?.(channel); setConfirm(null); }}>
            Po, regjistro
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={(e) => { stop(e); setConfirm(null); }}>
            Jo
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );

  return (
    <div className={cn('flex items-center gap-1', className)} onClick={stop}>
      {phone && confirmPrompt('call', (
        <Button variant="outline" size={compact ? 'icon' : 'sm'} className={btnClass} asChild title="Thirr">
          <a href={`tel:${phone}`} onClick={(e) => { stop(e); askConfirm('call'); }}>
            <Phone className={iconClass} />
            {!compact && 'Thirr'}
          </a>
        </Button>
      ))}

      {phone && (
        onOpenWhatsApp && waEnabled ? (
          <Button
            variant="outline" size={compact ? 'icon' : 'sm'} title="WhatsApp"
            className={cn(btnClass, 'text-[#25D366] border-[#25D366]/30 hover:bg-[#25D366]/10')}
            onClick={(e) => { stop(e); onOpenWhatsApp(); }}
          >
            <MessageSquare className={iconClass} />
            {!compact && 'WhatsApp'}
          </Button>
        ) : confirmPrompt('whatsapp', (
          <Button
            variant="outline" size={compact ? 'icon' : 'sm'} asChild title="WhatsApp"
            className={cn(btnClass, 'text-[#25D366] border-[#25D366]/30 hover:bg-[#25D366]/10')}
          >
            <a href={`https://wa.me/${waPhone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" onClick={(e) => { stop(e); askConfirm('whatsapp'); }}>
              <MessageSquare className={iconClass} />
              {!compact && 'WhatsApp'}
            </a>
          </Button>
        ))
      )}

      {email && (
        onOpenEmail ? (
          <Button variant="outline" size={compact ? 'icon' : 'sm'} className={btnClass} title="Email" onClick={(e) => { stop(e); onOpenEmail(); }}>
            <Mail className={iconClass} />
            {!compact && 'Email'}
          </Button>
        ) : confirmPrompt('email', (
          <Button variant="outline" size={compact ? 'icon' : 'sm'} className={btnClass} asChild title="Email">
            <a href={`mailto:${email}`} onClick={(e) => { stop(e); askConfirm('email'); }}>
              <Mail className={iconClass} />
              {!compact && 'Email'}
            </a>
          </Button>
        ))
      )}

      {withSms && phone && (
        <Button variant="outline" size={compact ? 'icon' : 'sm'} className={btnClass} asChild title="SMS">
          <a href={`sms:${phone}`} onClick={stop}>
            <MessageCircle className={iconClass} />
            {!compact && 'SMS'}
          </a>
        </Button>
      )}
    </div>
  );
};

export default ContactQuickActions;
