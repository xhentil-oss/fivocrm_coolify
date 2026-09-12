import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Plus, Trash2, Phone, MessageSquare, Mail, Users, Flag, Eye } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import {
  PLAYBOOK_CHANNELS, PLAYBOOK_LIMITS, PLAYBOOK_RECIPES, normalizePlaybook, playbookRecipe, renderPlaybookTemplate,
  type Playbook, type PlaybookChannel, type PlaybookStep,
} from '../../lib/crm/playbooks';
import { cn } from '../../lib/utils';

const CHANNEL_META: Record<PlaybookChannel, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  call: { label: 'Thirrje', Icon: Phone },
  whatsapp: { label: 'WhatsApp', Icon: MessageSquare },
  email: { label: 'Email', Icon: Mail },
  meeting: { label: 'Takim', Icon: Users },
  other: { label: 'Tjetër', Icon: Flag },
};

const SAMPLE = { name: 'Arben Hoxha', company: 'Hoxha Shpk', staffName: 'Blerta' };

interface Props {
  value: Playbook[];
  onChange: (next: Playbook[]) => void;
  disabled?: boolean;
}

const newId = (base: string, taken: Set<string>) => {
  let id = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'playbook';
  let i = 2;
  const root = id;
  while (taken.has(id)) id = `${root}-${i++}`;
  return id;
};

/**
 * Editor for `teamSettings.followUpPlaybooks`. A playbook = label (service
 * interest) → steps (day, channel, title, template). Recipes are starting points;
 * the parent card saves through `resolvePlaybooks` so an invalid step never lands.
 */
const PlaybookEditor: React.FC<Props> = ({ value, onChange, disabled }) => {
  const [open, setOpen] = useState<string | null>(value[0]?.id ?? null);
  const [preview, setPreview] = useState<string | null>(null);
  const taken = new Set(value.map(p => p.id));

  const update = (id: string, patch: Partial<Playbook>) => onChange(value.map(p => (p.id === id ? { ...p, ...patch } : p)));
  const updateStep = (id: string, idx: number, patch: Partial<PlaybookStep>) =>
    update(id, { steps: value.find(p => p.id === id)!.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)) });
  const removeStep = (id: string, idx: number) => update(id, { steps: value.find(p => p.id === id)!.steps.filter((_, i) => i !== idx) });
  const addStep = (id: string) => {
    const pb = value.find(p => p.id === id)!;
    if (pb.steps.length >= PLAYBOOK_LIMITS.maxSteps) return;
    const lastDay = pb.steps.length ? Math.max(...pb.steps.map(s => s.day)) : 0;
    update(id, { steps: [...pb.steps, { day: Math.min(PLAYBOOK_LIMITS.maxDay, lastDay + 3), channel: 'whatsapp', title: 'Ndjekje', template: '' }] });
  };
  const addFromRecipe = (recipeId: string) => {
    const r = playbookRecipe(recipeId);
    if (!r || value.length >= PLAYBOOK_LIMITS.maxPlaybooks) return;
    const id = newId(r.id, taken);
    onChange([...value, { ...r, id }]);
    setOpen(id);
  };
  const addBlank = () => {
    if (value.length >= PLAYBOOK_LIMITS.maxPlaybooks) return;
    const id = newId('playbook', taken);
    onChange([...value, { id, name: 'Shërbim i ri', tag: 'Shërbim', keywords: [], steps: [{ day: 1, channel: 'call', title: 'Telefonatë kualifikimi', template: '' }], active: true, nurtureEveryDays: 30 }]);
    setOpen(id);
  };
  const remove = (id: string) => { onChange(value.filter(p => p.id !== id)); if (open === id) setOpen(null); };
  const duplicate = (pb: Playbook) => {
    const id = newId(`${pb.id}-kopje`, taken);
    onChange([...value, { ...JSON.parse(JSON.stringify(pb)), id, name: `${pb.name} (kopje)` }]);
    setOpen(id);
  };

  const missingRecipes = PLAYBOOK_RECIPES.filter(r => !value.some(p => p.id === r.id || p.tag.toLowerCase() === r.tag.toLowerCase()));

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Asnjë playbook ende. Nis nga një recetë — çdo hap vjen me ditën, kanalin dhe tekstin, që t'i përshtatësh.
        </p>
      )}

      {value.map(pb => {
        const valid = normalizePlaybook(pb);
        const isOpen = open === pb.id;
        return (
          <div key={pb.id} className={cn('rounded-lg border', !pb.active && 'opacity-70')}>
            <div className="flex items-center gap-2 px-3 py-2">
              <button type="button" className="flex items-center gap-1.5 min-w-0 flex-1 text-left" onClick={() => setOpen(isOpen ? null : pb.id)}>
                {isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                <span className="font-medium text-sm truncate">{pb.name}</span>
                <Badge variant="outline" className="text-[10px]">{pb.tag}</Badge>
                <span className="text-xs text-muted-foreground shrink-0">{pb.steps.length} hapa</span>
                {pb.keywords.length > 0 && <span className="text-[11px] text-muted-foreground hidden md:inline truncate">· {pb.keywords.slice(0, 4).join(', ')}{pb.keywords.length > 4 ? '…' : ''}</span>}
                {!valid && <Badge variant="destructive" className="text-[10px]">i paplotë</Badge>}
              </button>
              <Switch checked={pb.active} onCheckedChange={(v) => update(pb.id, { active: v })} disabled={disabled} aria-label="Aktiv" />
              {!disabled && (
                <>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Kopjo" onClick={() => duplicate(pb)}><Copy className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Fshi" onClick={() => remove(pb.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                </>
              )}
            </div>

            {isOpen && (
              <div className="border-t px-3 py-3 space-y-3">
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Emri</Label>
                    <Input value={pb.name} onChange={(e) => update(pb.id, { name: e.target.value })} disabled={disabled} className="h-8 text-sm" maxLength={60} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Etiketa në lead</Label>
                    <Input value={pb.tag} onChange={(e) => update(pb.id, { tag: e.target.value })} disabled={disabled} className="h-8 text-sm" maxLength={40} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nurture çdo (ditë) pas hapit të fundit</Label>
                    <Input type="number" min={0} max={PLAYBOOK_LIMITS.maxNurtureDays} value={pb.nurtureEveryDays ?? 0}
                      onChange={(e) => update(pb.id, { nurtureEveryDays: Math.max(0, Number(e.target.value) || 0) })} disabled={disabled} className="h-8 text-sm" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Fjalëkyçe (ndarë me presje) — një mesazh WhatsApp hyrës me këto fjalë e regjistron lead-in automatikisht</Label>
                  <Input
                    value={pb.keywords.join(', ')}
                    onChange={(e) => update(pb.id, { keywords: e.target.value.split(',').map(k => k.trim().toLowerCase()).filter(Boolean).slice(0, PLAYBOOK_LIMITS.maxKeywords) })}
                    disabled={disabled} className="h-8 text-sm" placeholder="seo, google, renditje"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Hapat (dita · kanali · titulli · teksti)</Label>
                    <span className="text-[11px] text-muted-foreground">Tokens: {'{{firstName}} {{name}} {{company}} {{service}} {{staffName}}'}</span>
                  </div>
                  {[...pb.steps].map((s, idx) => {
                    const { Icon } = CHANNEL_META[s.channel];
                    const key = `${pb.id}:${idx}`;
                    return (
                      <div key={key} className="rounded-md border bg-muted/30 p-2 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-1">
                            <span className="text-[11px] text-muted-foreground">Dita</span>
                            <Input type="number" min={0} max={PLAYBOOK_LIMITS.maxDay} value={s.day}
                              onChange={(e) => updateStep(pb.id, idx, { day: Math.max(0, Number(e.target.value) || 0) })} disabled={disabled} className="h-8 w-16 text-sm" />
                          </div>
                          <div className="flex items-center gap-0.5">
                            {PLAYBOOK_CHANNELS.map(c => {
                              const M = CHANNEL_META[c];
                              return (
                                <button key={c} type="button" title={M.label} disabled={disabled} onClick={() => updateStep(pb.id, idx, { channel: c })}
                                  className={cn('h-8 w-8 rounded-md border flex items-center justify-center', s.channel === c ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}>
                                  <M.Icon className="w-3.5 h-3.5" />
                                </button>
                              );
                            })}
                          </div>
                          <Input value={s.title} onChange={(e) => updateStep(pb.id, idx, { title: e.target.value })} disabled={disabled}
                            className="h-8 text-sm flex-1 min-w-[160px]" placeholder="Titulli i hapit" maxLength={120} />
                          <Button variant="ghost" size="icon" className="h-8 w-8" title={preview === key ? 'Mbyll shikimin' : 'Shiko me emra'} onClick={() => setPreview(preview === key ? null : key)}>
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          {!disabled && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Hiq hapin" onClick={() => removeStep(pb.id, idx)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                        {s.channel !== 'other' && (
                          <Textarea value={s.template || ''} onChange={(e) => updateStep(pb.id, idx, { template: e.target.value })} disabled={disabled}
                            rows={2} className="text-sm" placeholder={`Teksti që ${CHANNEL_META[s.channel].label.toLowerCase()} do të ketë gati…`} maxLength={PLAYBOOK_LIMITS.maxTemplateChars} />
                        )}
                        {preview === key && s.template && (
                          <div className="rounded-md bg-background border p-2 text-xs whitespace-pre-wrap">
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground mb-1"><Icon className="w-3 h-3" /> Si e sheh {SAMPLE.name}:</span>
                            <div>{renderPlaybookTemplate(s.template, { ...SAMPLE, service: pb.name })}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {!disabled && pb.steps.length < PLAYBOOK_LIMITS.maxSteps && (
                    <Button variant="outline" size="sm" className="h-8" onClick={() => addStep(pb.id)}><Plus className="w-3.5 h-3.5 mr-1" />Shto hap</Button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {!disabled && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-muted-foreground">Shto:</span>
          {missingRecipes.map(r => (
            <Button key={r.id} variant="outline" size="sm" className="h-8" onClick={() => addFromRecipe(r.id)}>
              <Plus className="w-3.5 h-3.5 mr-1" />{r.name}
            </Button>
          ))}
          <Button variant="ghost" size="sm" className="h-8" onClick={addBlank}><Plus className="w-3.5 h-3.5 mr-1" />Bosh</Button>
        </div>
      )}
    </div>
  );
};

export default PlaybookEditor;
