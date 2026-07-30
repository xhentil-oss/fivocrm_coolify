/**
 * Report builder — drag-and-drop block editor.
 *
 * The one design decision that matters here: **visibility is never a quiet
 * dropdown.** A block that will reach the client is outlined in the primary colour
 * and labelled; an internal block is grey and locked-looking. Accidental disclosure
 * is the expensive failure mode in this module, so the editor makes the boundary
 * impossible to miss rather than merely configurable.
 */

import React, { useMemo, useState } from 'react';
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertTriangle, ChevronDown, ChevronUp, Eye, GripVertical, Lock, Plus,
  Settings2, Sparkles, Trash2, X,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import {
  BLOCK_DEFS, TABLE_PRESETS, createBlock, normaliseOrder, removeBlock, reorderBlocks,
  validateBlock,
} from '../../lib/reporting/blocks';
import { VISIBILITY_OPTIONS, isClientVisibility } from '../../lib/reporting/visibility';
import { blockLabel } from '../../lib/reporting/blocks';
import type { ReportBlock, ReportKpi, ReportVisibility } from '../../types';

interface Props {
  blocks: ReportBlock[];
  onChange: (blocks: ReportBlock[]) => void;
  kpis: ReportKpi[];
  /** Raw-HTML blocks and admin-only affordances. */
  isAdmin?: boolean;
  /** Read-only when the report is past the editable statuses. */
  disabled?: boolean;
}

const ReportBuilder: React.FC<Props> = ({ blocks, onChange, kpis, isAdmin = false, disabled = false }) => {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(() => [...blocks].sort((a, b) => a.order - b.order), [blocks]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = sorted.findIndex(b => b.id === active.id);
    const to = sorted.findIndex(b => b.id === over.id);
    onChange(reorderBlocks(sorted, from, to));
  };

  const updateBlock = (id: string, patch: Partial<ReportBlock>) => {
    onChange(sorted.map(b => (b.id === id ? { ...b, ...patch } : b)));
  };

  const addBlock = (type: ReportBlock['type']) => {
    // Ids include the current length so a block added, removed and re-added never
    // collides with a still-present block of the same type.
    const next = createBlock(type, sorted.length, { id: `${type}-${Date.now().toString(36)}` });
    onChange(normaliseOrder([...sorted, next]));
    setExpanded(next.id);
    setPaletteOpen(false);
  };

  const deleteBlock = (id: string) => {
    const result = removeBlock(sorted, id);
    if (!result.removed) return;
    onChange(result.blocks);
    if (expanded === id) setExpanded(null);
  };

  const clientCount = sorted.filter(b => isClientVisibility(b.visibility)).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="outline" className="gap-1 bg-primary/10 text-primary border-primary/30">
            <Eye className="w-3 h-3" /> {clientCount} për klientin
          </Badge>
          <Badge variant="outline" className="gap-1 bg-muted text-muted-foreground">
            <Lock className="w-3 h-3" /> {sorted.length - clientCount} të brendshme
          </Badge>
        </div>
        {!disabled && (
          <Button size="sm" variant="outline" onClick={() => setPaletteOpen(true)} className="gap-1.5">
            <Plus className="w-4 h-4" /> Shto bllok
          </Button>
        )}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sorted.map(b => b.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {sorted.map(block => (
              <SortableBlock
                key={block.id}
                block={block}
                kpis={kpis}
                isAdmin={isAdmin}
                disabled={disabled}
                expanded={expanded === block.id}
                onToggle={() => setExpanded(expanded === block.id ? null : block.id)}
                onChange={patch => updateBlock(block.id, patch)}
                onDelete={() => deleteBlock(block.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {!sorted.length && (
        <div className="text-center py-10 border border-dashed border-border rounded-lg">
          <p className="text-sm text-muted-foreground mb-3">Raporti është bosh.</p>
          {!disabled && (
            <Button size="sm" variant="outline" onClick={() => setPaletteOpen(true)}>Shto bllokun e parë</Button>
          )}
        </div>
      )}

      <BlockPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onPick={addBlock} isAdmin={isAdmin} />
    </div>
  );
};

// ── one sortable block ──────────────────────────────────────────────────────────

const SortableBlock: React.FC<{
  block: ReportBlock;
  kpis: ReportKpi[];
  isAdmin: boolean;
  disabled: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<ReportBlock>) => void;
  onDelete: () => void;
}> = ({ block, kpis, isAdmin, disabled, expanded, onToggle, onChange, onDelete }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id, disabled,
  });
  const clientVisible = isClientVisibility(block.visibility);
  const issues = validateBlock(block, { isAdmin });
  const errors = issues.filter(i => i.severity === 'error');

  return (
    <Card
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`overflow-hidden ${isDragging ? 'opacity-60 shadow-lg' : ''} ${
        clientVisible ? 'border-l-4 border-l-primary' : 'border-l-4 border-l-border'}`}
    >
      <div className="flex items-center gap-2 p-3">
        {!disabled && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
            aria-label={`Zvarrit bllokun ${block.title || blockLabel(block.type)}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="w-4 h-4" />
          </button>
        )}

        <button type="button" onClick={onToggle} className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground truncate">
              {block.title || blockLabel(block.type)}
            </span>
            <Badge variant="outline" className="text-[10px] shrink-0">{blockLabel(block.type)}</Badge>
            {block.required && <Badge variant="outline" className="text-[10px] shrink-0">detyrueshëm</Badge>}
            {block.locked && (
              <Badge variant="outline" className="text-[10px] shrink-0 gap-1">
                <Lock className="w-2.5 h-2.5" /> nga template
              </Badge>
            )}
            {block.aiSuggested && !block.aiApprovedByUserId && (
              <Badge variant="outline" className="text-[10px] shrink-0 gap-1 bg-warning/10 text-warning border-warning/30">
                <Sparkles className="w-2.5 h-2.5" /> AI
              </Badge>
            )}
            {errors.length > 0 && (
              <Badge variant="outline" className="text-[10px] shrink-0 gap-1 bg-error/10 text-error border-error/30">
                <AlertTriangle className="w-2.5 h-2.5" /> {errors.length}
              </Badge>
            )}
          </div>
        </button>

        <Badge
          variant="outline"
          className={`text-[10px] gap-1 shrink-0 ${clientVisible
            ? 'bg-primary/10 text-primary border-primary/40 font-semibold'
            : 'bg-muted text-muted-foreground'}`}
        >
          {clientVisible ? <Eye className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
          {clientVisible ? 'KLIENTI' : 'Brenda'}
        </Badge>

        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onToggle}
          aria-label={expanded ? 'Mbyll' : 'Hap'}>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </Button>

        {!disabled && !block.locked && (
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-error"
            onClick={onDelete} aria-label="Fshi bllokun">
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-border p-4 space-y-4 bg-muted/20">
          <BlockFields block={block} kpis={kpis} disabled={disabled} isAdmin={isAdmin} onChange={onChange} />
          {issues.length > 0 && (
            <ul className="space-y-1">
              {issues.map((i, idx) => (
                <li key={idx} className={`text-xs flex items-start gap-1.5 ${
                  i.severity === 'error' ? 'text-error' : 'text-warning'}`}>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
};

// ── field editors per block type ────────────────────────────────────────────────

const BlockFields: React.FC<{
  block: ReportBlock;
  kpis: ReportKpi[];
  disabled: boolean;
  isAdmin: boolean;
  onChange: (patch: Partial<ReportBlock>) => void;
}> = ({ block, kpis, disabled, isAdmin, onChange }) => {
  const textual = ['rich-text', 'executive-summary', 'recommendation', 'next-steps', 'client-action', 'work-completed', 'title', 'subtitle', 'approval'];
  const listy = ['work-completed', 'task-list', 'milestone-list', 'timeline', 'blocker-list', 'recommendation', 'next-steps', 'client-action'];
  const kpiBased = ['kpi-cards', 'comparison-cards', 'goal-vs-actual', 'chart', 'funnel'];
  const tabular = ['table', 'risk-register', 'blocker-list', 'task-list'];

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Titulli i seksionit</Label>
          <Input
            value={block.title || ''}
            disabled={disabled}
            onChange={e => onChange({ title: e.target.value })}
            placeholder={blockLabel(block.type)}
          />
        </div>
        <VisibilityControl block={block} disabled={disabled} onChange={onChange} />
      </div>

      {textual.includes(block.type) && (
        <div className="space-y-1.5">
          <Label className="text-xs">Përmbajtja</Label>
          <Textarea
            value={block.text || ''}
            disabled={disabled}
            onChange={e => onChange({ text: e.target.value })}
            rows={block.type === 'executive-summary' ? 6 : 4}
            className="text-base sm:text-sm"
            placeholder={
              block.type === 'executive-summary'
                ? 'Çfarë ndodhi, pse, dhe çfarë vlere krijoi për klientin…'
                : 'Shkruani tekstin…'
            }
          />
        </div>
      )}

      {listy.includes(block.type) && (
        <ListEditor
          items={block.items || []}
          disabled={disabled}
          onChange={items => onChange({ items })}
        />
      )}

      {kpiBased.includes(block.type) && (
        <KpiPicker
          selected={block.kpiIds || []}
          kpis={kpis}
          disabled={disabled}
          onChange={kpiIds => onChange({ kpiIds })}
        />
      )}

      {block.type === 'chart' && (
        <div className="space-y-1.5">
          <Label className="text-xs">Tipi i grafikut</Label>
          <Select value={block.chart || 'line'} disabled={disabled}
            onValueChange={v => onChange({ chart: v as ReportBlock['chart'] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="line">Linjë</SelectItem>
              <SelectItem value="bar">Shtylla</SelectItem>
              <SelectItem value="area">Sipërfaqe</SelectItem>
              <SelectItem value="pie">Byrek</SelectItem>
              <SelectItem value="doughnut">Rrethor</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {block.type === 'progress' && (
        <div className="space-y-1.5">
          <Label className="text-xs">Progresi (%)</Label>
          <Input
            type="number" min={0} max={100}
            value={block.progress ?? 0}
            disabled={disabled}
            onChange={e => onChange({ progress: Math.max(0, Math.min(100, Number(e.target.value))) })}
          />
        </div>
      )}

      {tabular.includes(block.type) && (
        <TableEditor block={block} disabled={disabled} onChange={onChange} />
      )}

      {(block.type === 'image' || block.type === 'video-link') && (
        <div className="space-y-1.5">
          <Label className="text-xs">Lidhja (vetëm https)</Label>
          <Input
            value={block.url || ''}
            disabled={disabled}
            onChange={e => onChange({ url: e.target.value })}
            placeholder="https://…"
          />
        </div>
      )}

      {block.type === 'custom-html' && isAdmin && (
        <div className="space-y-1.5">
          <Label className="text-xs">HTML (nuk publikohet te klienti)</Label>
          <Textarea
            value={block.html || ''}
            disabled={disabled}
            onChange={e => onChange({ html: e.target.value })}
            rows={5}
            className="font-mono text-xs"
          />
        </div>
      )}

      {/* Output toggles + AI approval */}
      <div className="flex flex-wrap gap-4 pt-1">
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={block.inPdf !== false}
            disabled={disabled}
            onChange={e => onChange({ inPdf: e.target.checked })}
            className="rounded border-border"
          />
          Përfshi në PDF
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={block.inPortal !== false}
            disabled={disabled}
            onChange={e => onChange({ inPortal: e.target.checked })}
            className="rounded border-border"
          />
          Përfshi në portal
        </label>
        {block.aiSuggested && (
          <label className="flex items-center gap-2 text-xs text-warning cursor-pointer font-medium">
            <input
              type="checkbox"
              checked={!!block.aiApprovedByUserId}
              disabled={disabled}
              onChange={e => onChange({ aiApprovedByUserId: e.target.checked ? 'approved' : null })}
              className="rounded border-warning"
            />
            Aprovoj përmbajtjen e sugjeruar nga AI
          </label>
        )}
      </div>
    </div>
  );
};

/** The visibility selector — the most consequential control in the module. */
const VisibilityControl: React.FC<{
  block: ReportBlock;
  disabled: boolean;
  onChange: (patch: Partial<ReportBlock>) => void;
}> = ({ block, disabled, onChange }) => {
  const clientVisible = isClientVisibility(block.visibility);
  const option = VISIBILITY_OPTIONS.find(o => o.value === block.visibility);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs flex items-center gap-1.5">
        <Settings2 className="w-3 h-3" /> Kush e shikon
      </Label>
      <Select
        value={block.visibility}
        disabled={disabled}
        onValueChange={v => onChange({ visibility: v as ReportVisibility })}
      >
        <SelectTrigger className={clientVisible ? 'border-primary/50 text-primary font-medium' : ''}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VISIBILITY_OPTIONS.map(o => (
            <SelectItem key={o.value} value={o.value}>
              <span className={o.client ? 'text-primary font-medium' : ''}>{o.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {option && (
        <p className={`text-[11px] ${clientVisible ? 'text-primary' : 'text-muted-foreground'}`}>
          {option.hint}
        </p>
      )}
    </div>
  );
};

const ListEditor: React.FC<{
  items: string[];
  disabled: boolean;
  onChange: (items: string[]) => void;
}> = ({ items, disabled, onChange }) => (
  <div className="space-y-2">
    <Label className="text-xs">Pikat</Label>
    {items.map((item, i) => (
      <div key={i} className="flex gap-2">
        <Input
          value={item}
          disabled={disabled}
          onChange={e => onChange(items.map((it, idx) => (idx === i ? e.target.value : it)))}
          placeholder={`Pika ${i + 1}`}
        />
        {!disabled && (
          <Button variant="ghost" size="icon" className="shrink-0"
            onClick={() => onChange(items.filter((_, idx) => idx !== i))} aria-label="Hiq pikën">
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
    ))}
    {!disabled && (
      <Button variant="outline" size="sm" onClick={() => onChange([...items, ''])} className="gap-1.5">
        <Plus className="w-3.5 h-3.5" /> Shto pikë
      </Button>
    )}
  </div>
);

const KpiPicker: React.FC<{
  selected: string[];
  kpis: ReportKpi[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}> = ({ selected, kpis, disabled, onChange }) => {
  const active = kpis.filter(k => k.active);
  const byService = useMemo(() => {
    const map = new Map<string, ReportKpi[]>();
    for (const k of active) {
      const key = k.service || 'other';
      map.set(key, [...(map.get(key) || []), k]);
    }
    return map;
  }, [active]);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  };

  if (!active.length) {
    return (
      <p className="text-xs text-muted-foreground">
        Nuk ka KPI aktive. Shtoni KPI në Cilësimet e raportimit → KPI.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs">KPI-të e përfshira ({selected.length})</Label>
      <div className="max-h-52 overflow-y-auto border border-border rounded-lg p-2 space-y-2">
        {[...byService.entries()].map(([service, list]) => (
          <div key={service}>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-1 mb-1">{service}</p>
            <div className="flex flex-wrap gap-1.5">
              {list.map(k => {
                const on = selected.includes(k.id);
                return (
                  <button
                    key={k.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggle(k.id)}
                    className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                      on ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-foreground border-border hover:border-primary/50'}`}
                  >
                    {k.name}
                    {!k.clientVisible && <Lock className="w-2.5 h-2.5 inline ml-1 opacity-70" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
        <Lock className="w-3 h-3" /> KPI me bravë nuk shfaqen nga klienti, edhe në bllok publik.
      </p>
    </div>
  );
};

const TableEditor: React.FC<{
  block: ReportBlock;
  disabled: boolean;
  onChange: (patch: Partial<ReportBlock>) => void;
}> = ({ block, disabled, onChange }) => {
  const columns = block.columns || [];
  const rows = block.rows || [];

  const applyPreset = (name: string) => {
    onChange({ columns: TABLE_PRESETS[name]?.map(c => ({ ...c })) || [], rows: [] });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2 flex-wrap">
        <div className="space-y-1.5 flex-1 min-w-[180px]">
          <Label className="text-xs">Kolonat</Label>
          <Select disabled={disabled} onValueChange={applyPreset}>
            <SelectTrigger><SelectValue placeholder="Zgjidh një set kolonash…" /></SelectTrigger>
            <SelectContent>
              {Object.keys(TABLE_PRESETS).map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {!disabled && columns.length > 0 && (
          <Button
            variant="outline" size="sm" className="gap-1.5"
            onClick={() => onChange({
              rows: [...rows, Object.fromEntries(columns.map(c => [c.key, ''])) as Record<string, string>],
            })}
          >
            <Plus className="w-3.5 h-3.5" /> Rresht
          </Button>
        )}
      </div>

      {columns.length > 0 && (
        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-xs min-w-[420px]">
            <thead className="bg-muted/40">
              <tr>
                {columns.map(c => <th key={c.key} className="text-left px-2 py-1.5 font-medium">{c.label}</th>)}
                {!disabled && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-t border-border">
                  {columns.map(c => (
                    <td key={c.key} className="p-1">
                      <Input
                        className="h-8 text-xs"
                        value={String(row[c.key] ?? '')}
                        disabled={disabled}
                        inputMode={c.format && c.format !== 'text' && c.format !== 'date' ? 'decimal' : undefined}
                        onChange={e => {
                          const raw = e.target.value;
                          const numeric = c.format && ['number', 'currency', 'percent', 'hours'].includes(c.format);
                          const value = numeric && raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
                          onChange({ rows: rows.map((r, i) => (i === ri ? { ...r, [c.key]: value } : r)) });
                        }}
                      />
                    </td>
                  ))}
                  {!disabled && (
                    <td className="p-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => onChange({ rows: rows.filter((_, i) => i !== ri) })}
                        aria-label="Hiq rreshtin">
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── add-block palette ───────────────────────────────────────────────────────────

const BlockPalette: React.FC<{
  open: boolean;
  onClose: () => void;
  onPick: (type: ReportBlock['type']) => void;
  isAdmin: boolean;
}> = ({ open, onClose, onPick, isAdmin }) => {
  const groups = useMemo(() => {
    const map = new Map<string, typeof BLOCK_DEFS>();
    for (const d of BLOCK_DEFS) {
      if (d.adminOnly && !isAdmin) continue;
      map.set(d.group, [...(map.get(d.group) || []), d]);
    }
    return map;
  }, [isAdmin]);

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Shto bllok</DialogTitle></DialogHeader>
        <div className="space-y-5">
          {[...groups.entries()].map(([group, defs]) => (
            <div key={group}>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{group}</p>
              <div className="grid sm:grid-cols-2 gap-2">
                {defs.map(d => (
                  <button
                    key={d.type}
                    type="button"
                    onClick={() => onPick(d.type)}
                    className="text-left p-3 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors"
                  >
                    <p className="text-sm font-medium text-foreground">{d.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{d.hint}</p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReportBuilder;
