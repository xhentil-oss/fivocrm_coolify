import React, { useEffect, useMemo, useState } from 'react';
import { Coins, Plus, Save, X } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useCollection } from '../../hooks/useFirestore';
import { useMemberCompensation } from '../../hooks/useMemberCompensation';
import { saveTeamSettings, type TeamSettings } from '../../hooks/useTeamSettings';
import { useToast } from '../../hooks/use-toast';
import type { TeamMember } from '../../types';
import { formatALL } from '../../lib/utils';
import { buildRateCard, type RateCardRole } from '../../lib/finance/costRates';
import { DEFAULT_FINANCE_SETTINGS, resolveFinanceSettings, type FinanceSettings } from '../../lib/finance/profitabilityCore';

/**
 * Cilësimet → Financat: the rules behind every cost figure in Financat.
 *
 *  · kosto e ngarkuar = paga × (1 + kontributet e punëdhënësit)
 *  · kosto/orë = kosto e ngarkuar / kapaciteti praktik për klientë (jo 176 h)
 *  · pragjet e marzhit (🟢/🟡/🔴), baza e overhead-it, alarmet 70/85/100 %
 *  · kategoritë pass-through (ad spend) që hiqen nga xhiro para marzhit
 *  · Rate Card i brendshëm: rol → kapacitet default + tarifë shitjeje
 *
 * Every card saves only its own keys through `saveTeamSettings` (merge).
 */
interface Props {
  teamId: string | null;
  settings: TeamSettings | null;
  canEdit: boolean;
}

const pctIn = (v: number) => String(Math.round(v * 1000) / 10);

const FinanceSettingsPanel: React.FC<Props> = ({ teamId, settings, canEdit }) => {
  const { toast } = useToast();
  const resolved = useMemo(() => resolveFinanceSettings(settings?.financeSettings), [settings?.financeSettings]);
  const [draft, setDraft] = useState<FinanceSettings>(resolved);
  const [alertsText, setAlertsText] = useState(resolved.budgetAlertThresholds.join(', '));
  const [passText, setPassText] = useState(resolved.passThroughExpenseCategories.join(', '));
  const [card, setCard] = useState<RateCardRole[]>(settings?.rateCard || []);
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => {
    setDraft(resolved);
    setAlertsText(resolved.budgetAlertThresholds.join(', '));
    setPassText(resolved.passThroughExpenseCategories.join(', '));
  }, [resolved]);
  useEffect(() => { setCard(settings?.rateCard || []); }, [settings?.rateCard]);

  const { data: rawMembers } = useCollection<TeamMember>('teamMembers', { skipTeamFilter: true });
  const { members } = useMemberCompensation(rawMembers);
  const { data: categories } = useCollection<{ id: string; name?: string }>('expenseCategories', { skipTeamFilter: true });
  const monthEnd = useMemo(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth() + 1, 0, 23, 59, 59); }, []);
  const rateCard = useMemo(() => buildRateCard(members, draft, monthEnd, card), [members, draft, monthEnd, card]);

  const saveRules = async () => {
    if (!teamId || !canEdit) return;
    const next = resolveFinanceSettings({
      ...draft,
      budgetAlertThresholds: alertsText.split(/[,\s]+/).map(Number).filter(n => Number.isFinite(n) && n > 0),
      passThroughExpenseCategories: passText.split(',').map(s => s.trim()).filter(Boolean),
    });
    setSaving('rules');
    try {
      await saveTeamSettings(teamId, { financeSettings: next });
      toast({ title: 'Rregullat e financave u ruajtën' });
    } catch (e: any) {
      toast({ title: 'Nuk u ruajt', description: e?.message, variant: 'destructive' });
    } finally { setSaving(null); }
  };
  const saveCard = async () => {
    if (!teamId || !canEdit) return;
    const clean = card.map(r => ({
      role: r.role.trim(),
      ...(r.defaultCapacityHours && r.defaultCapacityHours > 0 ? { defaultCapacityHours: r.defaultCapacityHours } : {}),
      ...(r.sellRate && r.sellRate > 0 ? { sellRate: r.sellRate } : {}),
    })).filter(r => r.role);
    setSaving('card');
    try {
      await saveTeamSettings(teamId, { rateCard: clean });
      toast({ title: 'Rate card u ruajt' });
    } catch (e: any) {
      toast({ title: 'Nuk u ruajt', description: e?.message, variant: 'destructive' });
    } finally { setSaving(null); }
  };
  const cardRow = (role: string) => card.find(r => r.role.trim().toLowerCase() === role.toLowerCase());
  const patchCard = (role: string, patch: Partial<RateCardRole>) => {
    setCard(prev => {
      const i = prev.findIndex(r => r.role.trim().toLowerCase() === role.toLowerCase());
      if (i < 0) return [...prev, { role, ...patch }];
      const next = [...prev]; next[i] = { ...next[i], ...patch }; return next;
    });
  };
  const [newRole, setNewRole] = useState('');

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          <Coins className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <h3 className="font-semibold text-foreground">Kosto e punës dhe marzhet</h3>
            <p className="text-sm text-muted-foreground">
              Kosto/orë e një personi = paga × (1 + kontributet) ÷ orët praktike për klientë në muaj.
              Këto rregulla ushqejnë Financat → Klientët, planin e projektit dhe alarmet e buxhetit.
            </p>
            {!canEdit && (
              <p className="mt-1 text-xs font-medium text-muted-foreground">Vetëm pronari ose Admin mund ta ndryshojë.</p>
            )}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="fs-load">Kontributet e punëdhënësit (%)</Label>
            <Input id="fs-load" type="number" min="0" max="100" step="0.1" disabled={!canEdit}
              value={pctIn(draft.employerCostPct)}
              onChange={e => setDraft(d => ({ ...d, employerCostPct: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) / 100 }))} />
            <p className="text-[11px] text-muted-foreground mt-1">Shqipëri: 15 % sigurime shoqërore + 1.7 % shëndetësore ≈ 16.7 %.</p>
          </div>
          <div>
            <Label htmlFor="fs-cap">Kapaciteti praktik për klientë (orë/muaj)</Label>
            <Input id="fs-cap" type="number" min="1" max="400" disabled={!canEdit}
              value={draft.defaultClientCapacityHours}
              onChange={e => setDraft(d => ({ ...d, defaultClientCapacityHours: parseFloat(e.target.value) || DEFAULT_FINANCE_SETTINGS.defaultClientCapacityHours }))} />
            <p className="text-[11px] text-muted-foreground mt-1">Jo 176 h: mbledhjet, administrata, pushimet dhe puna e brendshme nuk janë orë klienti.</p>
          </div>
          <div>
            <Label>Marzhi bruto: 🟢 i shëndetshëm nga (%)</Label>
            <Input type="number" min="0" max="100" disabled={!canEdit} value={draft.marginThresholds.healthy}
              onChange={e => setDraft(d => ({ ...d, marginThresholds: { ...d.marginThresholds, healthy: parseFloat(e.target.value) || 0 } }))} />
          </div>
          <div>
            <Label>🟡 nën kontroll nga (%) — më poshtë 🔴 hetim</Label>
            <Input type="number" min="0" max="100" disabled={!canEdit} value={draft.marginThresholds.watch}
              onChange={e => setDraft(d => ({ ...d, marginThresholds: { ...d.marginThresholds, watch: parseFloat(e.target.value) || 0 } }))} />
          </div>
          <div>
            <Label>Alarmet e buxhetit (% e planit)</Label>
            <Input disabled={!canEdit} value={alertsText} onChange={e => setAlertsText(e.target.value)} placeholder="70, 85, 100" />
          </div>
          <div>
            <Label>Overhead-i shpërndahet sipas</Label>
            <div className="mt-1 flex gap-2">
              {(['labor-hours', 'revenue'] as const).map(b => (
                <button key={b} type="button" disabled={!canEdit} onClick={() => setDraft(d => ({ ...d, overheadBasis: b }))}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${draft.overheadBasis === b ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border text-muted-foreground'}`}>
                  {b === 'labor-hours' ? 'Orëve të punës (rekomanduar)' : 'Të ardhurave'}
                </button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <Label>Kategori pass-through (ad spend, media…)</Label>
            <Input disabled={!canEdit} value={passText} onChange={e => setPassText(e.target.value)} placeholder="Ad Spend, Media Buying" list="fs-cats" />
            <datalist id="fs-cats">{(categories || []).map(c => <option key={c.id} value={c.name || ''} />)}</datalist>
            <p className="text-[11px] text-muted-foreground mt-1">Para që klienti të paguan për t'i kaluar tjetërkund: hiqen nga xhiro para se të gjykohet marzhi.</p>
          </div>
          <div>
            <Label>Utilizimi: nën (%) = kapacitet i lirë</Label>
            <Input type="number" min="0" max="100" disabled={!canEdit} value={draft.utilizationBands.low}
              onChange={e => setDraft(d => ({ ...d, utilizationBands: { ...d.utilizationBands, low: parseFloat(e.target.value) || 0 } }))} />
          </div>
          <div>
            <Label>Mbi (%) = i mbingarkuar</Label>
            <Input type="number" min="0" max="200" disabled={!canEdit} value={draft.utilizationBands.high}
              onChange={e => setDraft(d => ({ ...d, utilizationBands: { ...d.utilizationBands, high: parseFloat(e.target.value) || 0 } }))} />
          </div>
        </div>
        {canEdit && (
          <div className="flex justify-end">
            <Button size="sm" onClick={saveRules} disabled={saving === 'rules'}><Save className="mr-1.5 h-4 w-4" /> Ruaj rregullat</Button>
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-foreground">Rate Card i brendshëm</h3>
          <p className="text-sm text-muted-foreground">
            Sa kushton një orë e çdo roli (nga pagat reale) dhe me sa e shet agjencia. Vetëm i brendshëm — klienti nuk e sheh.
            Roli i çdo personi vendoset te Ekipet → anëtari → "Roli në rate card".
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 text-left">Roli</th>
                <th className="py-2 text-right">Persona</th>
                <th className="py-2 text-right">Kosto mujore</th>
                <th className="py-2 text-right">Kapacitet (h)</th>
                <th className="py-2 text-right">Kosto/orë</th>
                <th className="py-2 text-right">Tarifa shitje/orë</th>
                <th className="py-2 text-right">Marzh/orë</th>
                {canEdit && <th className="py-2" />}
              </tr>
            </thead>
            <tbody>
              {rateCard.length === 0 && <tr><td colSpan={8} className="py-4 text-center text-muted-foreground">Asnjë anëtar me pagë. Vendos pagat te Ekipet.</td></tr>}
              {rateCard.map(r => (
                <tr key={r.role} className="border-b border-border/60 last:border-0">
                  <td className="py-2 font-medium">
                    {r.role}
                    {r.withoutRate > 0 && <span className="ml-2 text-[11px] font-semibold text-amber-600">{r.withoutRate} pa pagë</span>}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">{r.headcount}</td>
                  <td className="py-2 text-right font-mono tabular-nums">{formatALL(Math.round(r.monthlyCost))}</td>
                  <td className="py-2 text-right">
                    <Input type="number" min="1" max="400" disabled={!canEdit} className="ml-auto h-8 w-20 text-right"
                      value={cardRow(r.role)?.defaultCapacityHours ?? ''} placeholder={String(draft.defaultClientCapacityHours)}
                      onChange={e => patchCard(r.role, { defaultCapacityHours: parseFloat(e.target.value) || undefined })} />
                  </td>
                  <td className="py-2 text-right font-mono font-semibold tabular-nums">{r.costRate ? formatALL(Math.round(r.costRate)) : '—'}</td>
                  <td className="py-2 text-right">
                    <Input type="number" min="0" disabled={!canEdit} className="ml-auto h-8 w-24 text-right"
                      value={cardRow(r.role)?.sellRate ?? ''} placeholder="—"
                      onChange={e => patchCard(r.role, { sellRate: parseFloat(e.target.value) || undefined })} />
                  </td>
                  <td className={`py-2 text-right font-mono tabular-nums ${r.hourMarginPct == null ? 'text-muted-foreground' : r.hourMarginPct >= draft.marginThresholds.healthy ? 'text-emerald-600' : r.hourMarginPct >= draft.marginThresholds.watch ? 'text-amber-600' : 'text-red-600'}`}>
                    {r.hourMarginPct == null ? '—' : `${Math.round(r.hourMarginPct)} %`}
                  </td>
                  {canEdit && (
                    <td className="py-2 text-right">
                      {r.headcount === 0 && (
                        <button type="button" className="text-muted-foreground hover:text-red-600" aria-label="Hiq rolin"
                          onClick={() => setCard(prev => prev.filter(x => x.role.toLowerCase() !== r.role.toLowerCase()))}>
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Input value={newRole} onChange={e => setNewRole(e.target.value)} placeholder="Rol i ri (p.sh. Freelancer Video)" className="h-8 w-56" />
              <Button type="button" size="sm" variant="outline" onClick={() => { if (newRole.trim()) { patchCard(newRole.trim(), {}); setNewRole(''); } }}>
                <Plus className="mr-1 h-4 w-4" /> Shto
              </Button>
            </div>
            <Button size="sm" onClick={saveCard} disabled={saving === 'card'}><Save className="mr-1.5 h-4 w-4" /> Ruaj rate card</Button>
          </div>
        )}
      </Card>
    </div>
  );
};

export default FinanceSettingsPanel;
