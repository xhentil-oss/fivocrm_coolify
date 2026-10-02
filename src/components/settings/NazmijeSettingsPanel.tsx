import React, { useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, MessageSquare, Save, Sparkles } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { db } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useCollection } from '../../hooks/useFirestore';
import { saveTeamSettings, useTeamSettingsData, type TeamSettings } from '../../hooks/useTeamSettings';
import { useToast } from '../../hooks/use-toast';
import { disableNazmije, enableNazmije, NazmijeApiError } from '../../lib/nazmije/client';
import {
  NAZMIJE_AVATAR_PATH, NAZMIJE_BLOCK_LABELS, NAZMIJE_LIMITS, NAZMIJE_SIGNATURE,
  dayIndexOf, humorLineForDay, localParts, resolveNazmijeSettings, sayingForDay,
  type NazmijeSettings,
} from '../../lib/nazmije/core';
import type { Channel } from '../../types';

/**
 * Cilësimet → Automatizimi → "Nazmija — sekretarja virtuale".
 *
 * `enabled` and `channelId` flip through POST /api/nazmije (the server creates her
 * profile, adds her to the group and says hello); everything else is a plain
 * `teamSettings.nazmije` merge. The panel never renders a second copy of her
 * voice: the preview lines come from the same core the server uses.
 */
interface Props {
  teamId: string | null;
  settings: TeamSettings | null;
  canEdit: boolean;
}

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Hën' }, { value: 2, label: 'Mar' }, { value: 3, label: 'Mër' }, { value: 4, label: 'Enj' },
  { value: 5, label: 'Pre' }, { value: 6, label: 'Sht' }, { value: 0, label: 'Die' },
];

type Draft = Omit<NazmijeSettings, 'enabled' | 'lastRun'>;

function draftFrom(s: NazmijeSettings): Draft {
  const { enabled: _e, lastRun: _l, ...rest } = s;
  return rest;
}

function whenLabel(v: unknown): string {
  const d = v instanceof Date ? v : (v as any)?.toDate?.() instanceof Date ? (v as any).toDate() : null;
  if (!d) return '';
  return d.toLocaleString('sq-AL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const KIND_LABEL: Record<string, string> = { reply: 'përgjigje', morning: 'plani i mëngjesit', afternoon: '"ku jemi"', weekly: 'përmbledhja javore', event: 'ngjarje' };

export default function NazmijeSettingsPanel({ teamId, settings, canEdit }: Props) {
  const { toast } = useToast();
  const resolved = useMemo(() => resolveNazmijeSettings(settings?.nazmije), [settings?.nazmije]);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(resolved));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const { data: channels } = useCollection<Channel>('channels', { skipTeamFilter: true });
  const groups = useMemo(() => (channels || []).filter(c => c.isGroup), [channels]);

  useEffect(() => { if (!dirty) setDraft(draftFrom(resolved)); }, [resolved, dirty]);

  const patch = (p: Partial<Draft>) => { setDraft(d => ({ ...d, ...p })); setDirty(true); };

  const today = localParts(new Date(), 'Europe/Tirane');
  const dayIndex = dayIndexOf(today.date);
  const saying = sayingForDay(dayIndex);
  const joke = humorLineForDay(today.weekday === 1 ? 'monday' : today.weekday === 5 ? 'friday' : 'morning', dayIndex);

  const handleToggle = async (on: boolean) => {
    if (!teamId || !canEdit) return;
    setToggling(true);
    try {
      if (on) {
        const r = await enableNazmije({
          teamId,
          channelId: draft.channelId || undefined,
          createChannel: !draft.channelId,
          settings: { ...draft },
        });
        toast({ title: `${draft.displayName} u aktivizua`, description: r.helloId ? 'Sapo u prezantua në kanalin e grupit.' : 'Zgjidh një kanal grupi që të postojë.' });
      } else {
        await disableNazmije(teamId);
        toast({ title: `${draft.displayName} u fik`, description: 'Asgjë nuk u fshi — mund ta rindizësh kur të duash.' });
      }
      setDirty(false);
    } catch (err) {
      const msg = err instanceof NazmijeApiError ? err.message : (err as Error)?.message;
      toast({ title: 'Nuk u ndryshua', description: msg || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setToggling(false);
    }
  };

  const handleSave = async () => {
    if (!teamId || !canEdit) return;
    setSaving(true);
    try {
      const clean = resolveNazmijeSettings({ ...draft, enabled: resolved.enabled });
      const { enabled: _e, lastRun: _l, ...toStore } = clean;
      await saveTeamSettings(teamId, { nazmije: toStore });
      setDirty(false);
      toast({ title: 'U ruajt', description: `Cilësimet e ${clean.displayName}s u ruajtën.` });
    } catch (err) {
      toast({ title: 'Ruajtja dështoi', description: (err as Error)?.message || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const lastRun = resolved.lastRun;
  const hasAiKey = !!settings?.hasAiApiKey;

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <img src={NAZMIJE_AVATAR_PATH} alt="" className="w-11 h-11 rounded-xl flex-shrink-0" />
          <div>
            <h3 className="text-h4 text-foreground flex items-center gap-2">
              {draft.displayName} — sekretarja virtuale
              <Badge variant={resolved.enabled ? 'default' : 'secondary'} className="text-[10px]">{resolved.enabled ? 'Aktive' : 'E fikur'}</Badge>
            </h3>
            <p className="text-body-sm text-muted-foreground mt-1 max-w-xl">
              Flet vetëm me stafin, në chat: plani i ditës në mëngjes, "ku jemi" pasdite, java në shifra të premten, dhe përgjigjet kur e
              thërrisni me <code className="text-xs">@{draft.displayName}</code> ose në DM. Çdo shifër vjen nga FivoCRM — nuk shpik asgjë.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {toggling && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Switch checked={resolved.enabled} disabled={!canEdit || toggling || !teamId} onCheckedChange={handleToggle} />
        </div>
      </div>

      {!hasAiKey && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-300">
          Pa çelës AI (Integrimet → FivoAI) {draft.displayName} është "vetëm listë": postimet me orar dalin, por pyetjeve u përgjigjet me një rresht fiks.
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="naz-name">Emri</Label>
          <Input id="naz-name" value={draft.displayName} disabled={!canEdit} maxLength={40} onChange={e => patch({ displayName: e.target.value })} />
          <p className="text-[11px] text-muted-foreground">Personazhi mbetet i njëjti; vetëm emri ndryshon.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Kanali i grupit për postimet</Label>
          <Select value={draft.channelId || '__new__'} disabled={!canEdit} onValueChange={v => patch({ channelId: v === '__new__' ? null : v })}>
            <SelectTrigger><SelectValue placeholder="Zgjidh grupin" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__new__">{resolved.enabled ? '— asnjë (postimet me orar ndalen)' : 'Krijo grupin "Zyra" me gjithë ekipin'}</SelectItem>
              {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Humori</Label>
          <Select value={draft.humor} disabled={!canEdit} onValueChange={v => patch({ humor: v as NazmijeSettings['humor'] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Pa shaka</SelectItem>
              <SelectItem value="light">I lehtë — vetëm nga banka e saj, max 1 në ditë</SelectItem>
              <SelectItem value="full">I plotë — AI improvizon brenda rregullave (vetëm në grup)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">Kurrë për performancën, pagën apo mungesat e dikujt — kjo është në kod, jo në prompt.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="naz-cap">Përgjigje në ditë (kufiri i kostos AI)</Label>
          <Input id="naz-cap" type="number" min={1} max={NAZMIJE_LIMITS.dailyReplyCapMax} value={draft.dailyReplyCap} disabled={!canEdit}
            onChange={e => patch({ dailyReplyCap: Number(e.target.value) || NAZMIJE_LIMITS.dailyReplyCapDefault })} />
          <p className="text-[11px] text-muted-foreground">Plus {NAZMIJE_LIMITS.replyPerUserPerHour} pyetje në orë për person.</p>
        </div>
      </div>

      <div className="space-y-3">
        <Label>Çfarë thotë pa e pyetur</Label>
        <div className="grid gap-2 sm:grid-cols-3">
          {([
            ['morningDigest', `Plani i ditës · ${draft.morningAt}`],
            ['afternoonDigest', `"Ku jemi" + raporti ditor · ${draft.afternoonAt}`],
            ['weeklyDigest', 'Java në shifra · e premte 16:30'],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm">
              <span>{label}</span>
              <Switch checked={draft[key]} disabled={!canEdit} onCheckedChange={v => patch({ [key]: v } as Partial<Draft>)} />
            </label>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">Orët janë të serverit (Europe/Tirane). Kur s'ka asgjë për të thënë, hesht — nuk shkruan "asgjë sot".</p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Ditët e punës</Label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map(d => {
              const on = draft.workDays.includes(d.value);
              return (
                <Button key={d.value} type="button" size="sm" variant={on ? 'default' : 'outline'} disabled={!canEdit} className="h-7 px-2.5 text-xs"
                  onClick={() => patch({ workDays: on ? draft.workDays.filter(x => x !== d.value) : [...draft.workDays, d.value].sort((a, b) => a - b) })}>
                  {d.label}
                </Button>
              );
            })}
          </div>
        </div>
        <div className="space-y-2">
          <Label>Orë të qeta (asnjë postim pa u pyetur)</Label>
          <div className="flex items-center gap-2">
            <Input type="time" value={draft.quietFrom} disabled={!canEdit} className="w-28" onChange={e => patch({ quietFrom: e.target.value })} />
            <span className="text-sm text-muted-foreground">deri</span>
            <Input type="time" value={draft.quietTo} disabled={!canEdit} className="w-28" onChange={e => patch({ quietTo: e.target.value })} />
          </div>
        </div>
      </div>

      <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm">
        <span className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-muted-foreground" /> Stafi mund t'i shkruajë në DM</span>
        <Switch checked={draft.dmAllowed} disabled={!canEdit} onCheckedChange={v => patch({ dmAllowed: v })} />
      </label>

      <div className="rounded-lg bg-muted/40 p-4 space-y-2">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Si tingëllon sot</p>
        <p className="text-sm italic">"{saying.text}" — {NAZMIJE_SIGNATURE}</p>
        {draft.humor !== 'off' && joke && <p className="text-sm">{joke.text}</p>}
        <p className="text-sm text-muted-foreground">"Këtë s'e kam në sistem. Pyete personin që e mban projektin."</p>
      </div>

      {lastRun && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5" />
          Herën e fundit ({KIND_LABEL[String(lastRun.kind)] || lastRun.kind}{lastRun.at ? `, ${whenLabel(lastRun.at)}` : ''}):{' '}
          {lastRun.posted ? 'postoi.' : lastRun.blocked ? NAZMIJE_BLOCK_LABELS[lastRun.blocked] + '.' : lastRun.error ? `gabim — ${lastRun.error}` : '—'}
        </p>
      )}

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!dirty || saving || !teamId} size="sm">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Ruaj cilësimet
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * Cilësimet → Njoftimet: the person's own "Mos më përmend" switch
 * (`userPreferences/{uid}.nazmijeOptOut`). Rendered only while she is on.
 */
export function NazmijeOptOutCard() {
  const { user } = useAuth();
  const settings = useTeamSettingsData();
  const resolved = useMemo(() => resolveNazmijeSettings(settings?.nazmije), [settings?.nazmije]);
  const [optOut, setOptOut] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    getDoc(doc(db, 'userPreferences', user.uid))
      .then(snap => setOptOut(snap.exists() && (snap.data() as any)?.nazmijeOptOut === true))
      .catch(() => setOptOut(false));
  }, [user?.uid]);

  if (!resolved.enabled || !user) return null;
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <img src={NAZMIJE_AVATAR_PATH} alt="" className="w-9 h-9 rounded-lg flex-shrink-0" />
          <div className="space-y-1">
            <p className="text-body text-foreground font-normal">{resolved.displayName} — "Mos më përmend"</p>
            <p className="text-body-sm text-muted-foreground">
              Kur është ndezur, {resolved.displayName} nuk të përgjigjet më në chat. Postimet e grupit vazhdojnë si për të gjithë.
            </p>
          </div>
        </div>
        <Switch
          checked={optOut === true}
          disabled={optOut === null}
          onCheckedChange={(v) => {
            setOptOut(v);
            setDoc(doc(db, 'userPreferences', user.uid), { nazmijeOptOut: v }, { merge: true }).catch(() => setOptOut(!v));
          }}
        />
      </div>
    </Card>
  );
}
