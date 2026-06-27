import React, { useMemo, useState } from 'react';
import { useCollection } from '../hooks/useFirestore';
import { usePermissions } from '../contexts/PermissionsContext';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Building2, Search, Users, ShieldX } from 'lucide-react';
import { getTimestampMs } from '../lib/utils';
import type { Team, TeamMember } from '../types';

// Super-admin "Relax CRM" panel: lists every tenant (team) — i.e. FivoCRM's own
// customers — across all workspaces. Read-only for now: editing a tenant's
// plan/status needs a server-side super-admin claim (Firestore rules only let a
// team's owner write its doc), which arrives with billing (Phase 4).

const statusMeta: Record<string, { label: string; cls: string }> = {
  trialing: { label: 'Provë', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  active: { label: 'Aktiv', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  past_due: { label: 'Pa paguar', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  suspended: { label: 'Pezulluar', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  canceled: { label: 'Anuluar', cls: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
};

const fmtDate = (d: any) => {
  const ms = getTimestampMs(d);
  return ms ? new Date(ms).toLocaleDateString('sq-AL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
};

const TenantsView: React.FC = () => {
  const permissions = usePermissions();
  const { data: teams } = useCollection<Team>('teams', { skipTeamFilter: true });
  const { data: members } = useCollection<TeamMember>('teamMembers', { skipTeamFilter: true });
  const [search, setSearch] = useState('');

  const memberCount = useMemo(() => {
    const m = new Map<string, number>();
    (members || []).forEach(x => {
      if (x.teamId && x.status === 'Active') m.set(x.teamId, (m.get(x.teamId) || 0) + 1);
    });
    return m;
  }, [members]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (teams || [])
      .filter(t => !q || (t.name || '').toLowerCase().includes(q) || ((t as any).ownerEmail || '').toLowerCase().includes(q))
      .sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));
  }, [teams, search]);

  const stats = useMemo(() => {
    const s = { total: (teams || []).length, trialing: 0, active: 0, other: 0 };
    (teams || []).forEach(t => {
      const st = (t as any).status;
      if (st === 'trialing') s.trialing++;
      else if (st === 'active') s.active++;
      else s.other++;
    });
    return s;
  }, [teams]);

  // Route is also gated, but guard here too.
  if (!permissions.isSuperAdmin) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
        <ShieldX className="h-16 w-16 text-destructive mb-4" />
        <h2 className="text-2xl font-bold mb-2">Akses i Kufizuar</h2>
        <p className="text-muted-foreground">Vetëm super-admin mund të shohë tenant-ët.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Building2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Relax CRM</h1>
          <p className="text-sm text-muted-foreground">Klientët e FivoCRM — të gjithë tenant-ët</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-5">
        {([['Gjithsej', stats.total], ['Provë', stats.trialing], ['Aktiv', stats.active], ['Të tjerë', stats.other]] as const).map(([label, val]) => (
          <Card key={label} className="p-4">
            <p className="text-2xl font-bold">{val}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Kërko tenant ose owner..." className="pl-9" />
      </div>

      {/* List */}
      <Card className="divide-y divide-border/60">
        {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Asnjë tenant.</p>}
        {rows.map(t => {
          const st = (t as any).status as string | undefined;
          const meta = (st && statusMeta[st]) || { label: st || '—', cls: 'bg-muted text-muted-foreground' };
          return (
            <div key={t.id} className="flex items-center gap-3 p-4">
              <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                <Building2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{t.name || 'Pa emër'}</p>
                <p className="text-xs text-muted-foreground truncate">{(t as any).ownerEmail || '—'}</p>
              </div>
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground w-20">
                <Users className="h-3.5 w-3.5" /> {memberCount.get(t.id) || 0}
              </div>
              <div className="hidden md:block text-xs text-muted-foreground w-28">{(t as any).plan || 'trial'}</div>
              <div className="hidden lg:block text-xs text-muted-foreground w-28">{fmtDate(t.createdAt)}</div>
              <Badge className={`${meta.cls} border-0 text-[10px] flex-shrink-0`}>{meta.label}</Badge>
            </div>
          );
        })}
      </Card>

      <p className="text-[11px] text-muted-foreground/60 mt-4">
        Vetëm-lexim. Menaxhimi i planit/statusit aktivizohet me billing-un (kërkon claim super-admin server-side).
      </p>
    </div>
  );
};

export default TenantsView;
