import React, { useState } from 'react';
import { AlarmClock, CalendarDays, ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Calendar } from '../ui/calendar';
import { Button } from '../ui/button';
import { SNOOZE_PRESETS, dayFromPreset, dueState, type SnoozePresetKey } from '../../lib/crm/followUp';

interface Props {
  onSnooze: (presetOrDate: SnoozePresetKey | Date) => unknown | Promise<unknown>;
  /** Custom trigger; default is a small "Shty ▾" button. */
  trigger?: React.ReactNode;
  size?: 'sm' | 'icon';
  disabled?: boolean;
}

/** One click = one write. Snooze is relative to TODAY (see followUp.ts). */
const SnoozeMenu: React.FC<Props> = ({ onSnooze, trigger, size = 'sm', disabled }) => {
  const [calOpen, setCalOpen] = useState(false);
  const now = new Date();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          {trigger || (
            size === 'icon' ? (
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Shty">
                <AlarmClock className="w-4 h-4" />
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="h-8">
                <AlarmClock className="w-3.5 h-3.5 mr-1" />
                Shty
                <ChevronDown className="w-3 h-3 ml-1 opacity-60" />
              </Button>
            )
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {SNOOZE_PRESETS.filter(p => p.key !== 'custom').map(p => (
            <DropdownMenuItem key={p.key} onClick={() => void onSnooze(p.key)} className="flex justify-between">
              <span>{p.label}</span>
              <span className="text-xs text-muted-foreground">{dueState({ nextFollowUpDate: dayFromPreset(p.key, now) }, now).label}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCalOpen(true)}>
            <CalendarDays className="w-3.5 h-3.5 mr-2" />
            Datë tjetër…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover open={calOpen} onOpenChange={setCalOpen}>
        <PopoverTrigger asChild><span className="sr-only" /></PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <Calendar
            mode="single"
            onSelect={(d) => { if (d) { void onSnooze(d); setCalOpen(false); } }}
            disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
          />
        </PopoverContent>
      </Popover>
    </>
  );
};

export default SnoozeMenu;
