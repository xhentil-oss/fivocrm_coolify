import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Calendar } from '../ui/calendar';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  FOLLOW_UP_TYPES, FOLLOW_UP_TYPE_META, NEXT_STEP_PRESETS, OUTCOME_META, dayFromPreset, dueState,
  normalizeFollowUpDate, isOpenLead,
  type FollowUpContact, type FollowUpEntity, type FollowUpOutcomeResult, type NextStep, type NextStepPresetKey,
} from '../../lib/crm/followUp';
import type { FollowUpType } from '../../types';
import { FOLLOW_UP_TYPE_ICON } from './FollowUpBadge';
import { cn } from '../../lib/utils';

export interface NextStepSubmit {
  /** Present in `complete` mode. */
  outcome?: { channel: FollowUpType; result: FollowUpOutcomeResult | null };
  /** null = no next step (allowed for customers, or when the lead is being closed). */
  next: NextStep | null;
}

interface Props {
  contact: FollowUpContact & { name?: string };
  entity: FollowUpEntity;
  mode: 'schedule' | 'complete';
  trigger: React.ReactNode;
  onSubmit: (payload: NextStepSubmit) => unknown | Promise<unknown>;
  /** "Mbyll lead-in…" escape hatch — the only way out of a mandatory next step for an open lead. */
  onCloseLead?: (status: 'Won' | 'Lost') => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
}

const OUTCOME_KEYS = Object.keys(OUTCOME_META) as FollowUpOutcomeResult[];

/**
 * One popover for both "Cakto hapin" and "U bë ✓". Rule (the feature itself):
 * for an OPEN LEAD a next step is mandatory — the only escape is closing the
 * lead. A customer may be left without a step. Keys 1-4 pick a preset, Enter
 * saves, Esc closes.
 */
const NextStepPopover: React.FC<Props> = ({
  contact, entity, mode, trigger, onSubmit, onCloseLead, open: openProp, onOpenChange, align = 'end', side,
}) => {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => { setOpenState(v); onOpenChange?.(v); };

  const [result, setResult] = useState<FollowUpOutcomeResult | null>(null);
  const [channel, setChannel] = useState<FollowUpType>((contact.nextFollowUpType as FollowUpType) || 'call');
  const [nextType, setNextType] = useState<FollowUpType>((contact.nextFollowUpType as FollowUpType) || 'call');
  const [preset, setPreset] = useState<NextStepPresetKey | 'none'>('tomorrow');
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [note, setNote] = useState(contact.followUpNote || '');
  const [saving, setSaving] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  // Reset when (re)opened for a different contact / mode.
  useEffect(() => {
    if (!open) return;
    const t = (contact.nextFollowUpType as FollowUpType) || 'call';
    setResult(null);
    setChannel(t);
    setNextType(t);
    setNote(mode === 'schedule' ? (contact.followUpNote || '') : '');
    setShowCalendar(false);
    if (mode === 'schedule' && contact.nextFollowUpDate) {
      // Editing an existing step: start from its date.
      setPreset('custom');
      setCustomDate(new Date(dueState(contact).dueMs || Date.now()));
    } else {
      setPreset('tomorrow');
      setCustomDate(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, (contact as any).id]);

  const mandatory = entity === 'lead' && isOpenLead(contact as any);
  const noneAllowed = !mandatory;

  const resolvedDate = useMemo<Date | null>(() => {
    if (preset === 'none') return null;
    if (preset === 'custom') return customDate ? normalizeFollowUpDate(customDate) : null;
    return dayFromPreset(preset);
  }, [preset, customDate]);

  const canSave = preset === 'none' ? noneAllowed : !!resolvedDate;

  const submit = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await onSubmit({
        outcome: mode === 'complete' ? { channel, result } : undefined,
        next: resolvedDate ? { date: resolvedDate, type: nextType, note: note.trim() || null } : null,
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); void submit(); return; }
    const idx = Number(e.key);
    if (idx >= 1 && idx <= 4 && !(e.target instanceof HTMLInputElement)) {
      const p = NEXT_STEP_PRESETS[idx - 1];
      if (p && p.key !== 'custom') { setPreset(p.key); setShowCalendar(false); }
    }
  };

  const previewLabel = resolvedDate ? dueState({ nextFollowUpDate: resolvedDate }).label : (preset === 'none' ? 'Pa hap tjetër' : '—');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} side={side} className="w-[320px] p-3 space-y-3" onKeyDown={onKeyDown}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">
            {mode === 'complete' ? 'U bë — si shkoi?' : (contact.nextFollowUpDate ? 'Ndrysho hapin tjetër' : 'Cakto hapin tjetër')}
          </p>
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)} aria-label="Mbyll">
            <X className="w-4 h-4" />
          </button>
        </div>

        {mode === 'complete' && (
          <>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Kanali</p>
              <div className="flex gap-1">
                {FOLLOW_UP_TYPES.map(t => {
                  const Icon = FOLLOW_UP_TYPE_ICON[t];
                  return (
                    <button
                      key={t} type="button" title={FOLLOW_UP_TYPE_META[t].label}
                      onClick={() => setChannel(t)}
                      className={cn('flex-1 h-8 rounded-md border flex items-center justify-center transition-colors',
                        channel === t ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}
                    >
                      <Icon className="w-4 h-4" />
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Rezultati</p>
              <div className="grid grid-cols-2 gap-1">
                {OUTCOME_KEYS.map(k => (
                  <button
                    key={k} type="button"
                    onClick={() => setResult(result === k ? null : k)}
                    className={cn('h-8 rounded-md border text-xs px-2 transition-colors truncate',
                      result === k ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}
                  >
                    {OUTCOME_META[k].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="border-t" />
          </>
        )}

        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
            {mode === 'complete' ? 'Hapi tjetër' : 'Kur'}
            {mandatory && <span className="ml-1 normal-case text-[10px] text-muted-foreground/80">(i detyrueshëm për lead të hapur)</span>}
          </p>
          <div className="flex flex-wrap gap-1">
            {NEXT_STEP_PRESETS.map((p, i) => (
              <button
                key={p.key} type="button"
                onClick={() => { setPreset(p.key); setShowCalendar(p.key === 'custom'); }}
                className={cn('h-7 rounded-full border text-xs px-2.5 transition-colors inline-flex items-center gap-1',
                  preset === p.key ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}
              >
                {p.key === 'custom' && <CalendarDays className="w-3 h-3" />}
                {p.label}
                {i < 4 && <kbd className="hidden sm:inline text-[9px] opacity-60 ml-0.5">{i + 1}</kbd>}
              </button>
            ))}
            {noneAllowed && (
              <button
                type="button"
                onClick={() => { setPreset('none'); setShowCalendar(false); }}
                className={cn('h-7 rounded-full border text-xs px-2.5 transition-colors',
                  preset === 'none' ? 'bg-muted text-foreground border-foreground/30' : 'text-muted-foreground hover:bg-muted')}
              >
                Pa hap
              </button>
            )}
          </div>
          {showCalendar && (
            <div className="mt-2 rounded-md border">
              <Calendar
                mode="single"
                selected={customDate}
                onSelect={(d) => { setCustomDate(d || undefined); if (d) setPreset('custom'); }}
                disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
              />
            </div>
          )}
        </div>

        {preset !== 'none' && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Si</p>
            <div className="flex gap-1">
              {FOLLOW_UP_TYPES.map(t => {
                const Icon = FOLLOW_UP_TYPE_ICON[t];
                return (
                  <button
                    key={t} type="button" title={FOLLOW_UP_TYPE_META[t].label}
                    onClick={() => setNextType(t)}
                    className={cn('flex-1 h-8 rounded-md border flex items-center justify-center transition-colors',
                      nextType === t ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                );
              })}
            </div>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Shënim: diskuto çmimin, dërgo ofertën…"
              className="mt-2 h-8 text-sm"
              maxLength={140}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-muted-foreground truncate">{previewLabel}</span>
          <div className="flex items-center gap-1.5">
            {mandatory && onCloseLead && (
              <div className="flex items-center gap-1">
                <Button type="button" size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" onClick={() => { setOpen(false); onCloseLead('Lost'); }}>
                  Humbur
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-8 text-xs text-emerald-700" onClick={() => { setOpen(false); onCloseLead('Won'); }}>
                  Fituar
                </Button>
              </div>
            )}
            <Button type="button" size="sm" className="h-8" onClick={submit} disabled={!canSave || saving}>
              <Check className="w-4 h-4 mr-1" />
              {saving ? 'Duke ruajtur…' : 'Ruaj'}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NextStepPopover;
