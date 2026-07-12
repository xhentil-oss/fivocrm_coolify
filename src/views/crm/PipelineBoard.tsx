import React, { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Zap, Percent, GripVertical } from 'lucide-react';
import type { Lead } from '../../types';
import { leadTemperature, leadSla, TEMP_META } from '../../lib/leadIntel';

const STAGE_PROBABILITY: Record<string, number> = {
  New: 10,
  Contacted: 20,
  Qualified: 40,
  'Follow-up': 30,
  Converted: 100,
};

type StageKey = 'New' | 'Contacted' | 'Qualified' | 'Follow-up' | 'Converted';

const STAGES: { key: StageKey; label: string; accent: string }[] = [
  { key: 'New', label: 'Të reja', accent: 'border-l-blue-400' },
  { key: 'Contacted', label: 'Kontaktuara', accent: 'border-l-navy-700' },
  { key: 'Qualified', label: 'Kualifikuara', accent: 'border-l-green-500' },
  { key: 'Follow-up', label: 'Në ndjekje', accent: 'border-l-yellow-500' },
  { key: 'Converted', label: 'Konvertuara', accent: 'border-l-emerald-600' },
];

interface PipelineBoardProps {
  leads: Lead[];
  onStatusChange: (lead: Lead, newStatus: string) => void | Promise<void>;
  onCardClick: (lead: Lead) => void;
  calculateLeadScore: (l: Lead) => number;
}

function LeadCard({ lead, calculateLeadScore, onCardClick }: { lead: Lead; calculateLeadScore: (l: Lead) => number; onCardClick: (l: Lead) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id });
  const score = (lead as any).score ?? calculateLeadScore(lead);
  const scoreColor = score >= 70 ? 'text-green-600' : score >= 40 ? 'text-yellow-600' : 'text-red-500';
  const prob = lead.probability ?? STAGE_PROBABILITY[lead.status] ?? 0;
  return (
    <div
      ref={setNodeRef}
      className={`bg-card border border-border rounded-md p-3 shadow-sm hover:shadow-md transition-shadow ${isDragging ? 'opacity-30' : ''}`}
    >
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none shrink-0 mt-0.5"
          aria-label="Tërhiq lead"
          {...listeners}
          {...attributes}
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onCardClick(lead)}
          className="flex-1 min-w-0 text-left"
        >
          <p className="font-medium text-foreground text-sm truncate">
            <span className="mr-1">{TEMP_META[leadTemperature(lead)].emoji}</span>
            {lead.name}
            {leadSla(lead).breached && <span className="ml-1 text-[9px] px-1 py-0.5 rounded-full font-medium bg-red-500 text-white align-middle">SLA</span>}
          </p>
          {lead.company && (
            <p className="text-xs text-muted-foreground truncate">{lead.company}</p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {lead.estimatedValue ? (
              <span className="text-xs font-semibold tabular-nums text-foreground">
                {lead.estimatedValue.toLocaleString()} L
              </span>
            ) : null}
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-0.5">
              <Zap className={`w-2.5 h-2.5 ${scoreColor}`} />
              <span className={`${scoreColor} tabular-nums`}>{score}</span>
            </Badge>
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-0.5">
              <Percent className="w-2.5 h-2.5" />
              <span className="tabular-nums">{prob}%</span>
            </Badge>
          </div>
        </button>
      </div>
    </div>
  );
}

function StageColumn({ stage, accent, label, leads, calculateLeadScore, onCardClick }: { stage: StageKey; accent: string; label: string; leads: Lead[]; calculateLeadScore: (l: Lead) => number; onCardClick: (l: Lead) => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: stage });
  const total = leads.reduce((s, l) => s + (l.estimatedValue || 0), 0);
  return (
    <div className="flex flex-col min-w-[80vw] w-[80vw] sm:min-w-[260px] sm:w-[260px]">
      <div className={`bg-muted/60 border-l-4 ${accent} rounded-t-md px-3 py-2 flex items-center justify-between`}>
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {leads.length} · {total.toLocaleString()} L
          </p>
        </div>
      </div>
      <Card
        ref={setNodeRef}
        className={`flex-1 rounded-t-none border-t-0 p-2 space-y-2 min-h-[200px] transition-colors ${isOver ? 'bg-primary/5 ring-2 ring-primary/40 ring-inset' : ''}`}
      >
        {leads.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4 italic">
            Asnjë lead këtu
          </p>
        ) : (
          leads.map(lead => (
            <LeadCard
              key={lead.id}
              lead={lead}
              calculateLeadScore={calculateLeadScore}
              onCardClick={onCardClick}
            />
          ))
        )}
      </Card>
    </div>
  );
}

export const PipelineBoard: React.FC<PipelineBoardProps> = ({ leads, onStatusChange, onCardClick, calculateLeadScore }) => {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [activeId, setActiveId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map: Record<StageKey, Lead[]> = {
      New: [], Contacted: [], Qualified: [], 'Follow-up': [], Converted: [],
    };
    for (const lead of leads) {
      if (lead.status === 'Lost') continue;
      const key = (STAGES.find(s => s.key === lead.status)?.key) || 'New';
      map[key].push(lead);
    }
    return map;
  }, [leads]);

  const activeLead = activeId ? leads.find(l => l.id === activeId) : null;

  const handleStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const handleEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    if (!e.over) return;
    const lead = leads.find(l => l.id === e.active.id);
    if (!lead) return;
    const target = String(e.over.id) as StageKey;
    if (lead.status === target) return;
    await onStatusChange(lead, target);
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleStart} onDragEnd={handleEnd}>
      <div className="w-full min-w-0 overflow-x-auto -mx-4 px-4 pb-4">
        <div className="flex gap-3 min-w-max">
          {STAGES.map(s => (
            <StageColumn
              key={s.key}
              stage={s.key}
              label={s.label}
              accent={s.accent}
              leads={grouped[s.key]}
              calculateLeadScore={calculateLeadScore}
              onCardClick={onCardClick}
            />
          ))}
        </div>
      </div>
      <DragOverlay>
        {activeLead ? (
          <div className="bg-card border-2 border-primary rounded-md p-3 shadow-2xl rotate-1 w-[244px]">
            <p className="font-medium text-foreground text-sm truncate">{activeLead.name}</p>
            {activeLead.company && (
              <p className="text-xs text-muted-foreground truncate">{activeLead.company}</p>
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};

export default PipelineBoard;
