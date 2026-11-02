import React, { useState } from 'react';
import { ShieldCheck, ShieldAlert, Send, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { useDocument, useGlobalBusinessId } from '../../hooks/useFirestore';
import { usePermissions } from '../../contexts/PermissionsContext';
import { useToast } from '../../hooks/use-toast';
import { requestCredentialChange, CREDENTIAL_LABELS } from '../../lib/tenantSecrets';
import type { Business, TenantCredentialField } from '../../types';

/** The tenant's business doc (credential status + AI policy), live. */
export function useTenantBusiness(): Business | null {
  const bid = useGlobalBusinessId();
  const { data } = useDocument<Business>('businesses', bid || undefined);
  return data;
}

/**
 * What a tenant sees in place of a credential input: credentials are managed by
 * FivoCRM (only the platform super-admin sets them, for the whole tenant). Shows
 * the status — configured / last 4 / when — and lets an Owner/Admin/Manager ask
 * the platform for a change. Never shows or accepts a value.
 */
const ManagedCredentialNotice: React.FC<{
  field: TenantCredentialField;
  /** Fallback when the business doc carries no status yet (legacy team vault). */
  legacyConfigured?: boolean;
  compact?: boolean;
}> = ({ field, legacyConfigured, compact }) => {
  const biz = useTenantBusiness();
  const { isAdmin, isOwner, isManager } = usePermissions();
  const { toast } = useToast();
  const [sending, setSending] = useState(false);

  const s = biz?.credentials?.[field];
  const configured = s ? s.configured : !!legacyConfigured;
  const canRequest = !!(isAdmin || isOwner || isManager);

  const ask = async () => {
    if (sending) return;
    const note = window.prompt(`Çfarë duhet ndryshuar për "${CREDENTIAL_LABELS[field]}"? (opsionale)`, '');
    if (note === null) return;
    setSending(true);
    try {
      await requestCredentialChange(field, note);
      toast({ title: 'Kërkesa u dërgua', description: 'FivoCRM u njoftua dhe do ta konfigurojë.' });
    } catch (e) {
      toast({ title: 'Kërkesa nuk u dërgua', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`rounded-md border ${configured ? 'border-success/30 bg-success/5' : 'border-border bg-muted/40'} ${compact ? 'p-2' : 'p-3'} flex items-start gap-3`}>
      {configured
        ? <ShieldCheck className="w-4 h-4 text-success shrink-0 mt-0.5" />
        : <ShieldAlert className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-sm text-foreground">
          {CREDENTIAL_LABELS[field]}:{' '}
          <strong>{configured ? (s?.count != null ? `${s.count} kanale` : s?.last4 ? `••••${s.last4}` : 'i konfiguruar') : 'pa konfiguruar'}</strong>
        </p>
        <p className="text-xs text-muted-foreground">
          Menaxhohet nga FivoCRM për gjithë biznesin
          {s?.updatedAt ? ` · ndryshuar ${new Date(s.updatedAt as any).toLocaleDateString('sq-AL')}` : ''}.
        </p>
      </div>
      {canRequest && (
        <Button type="button" size="sm" variant="outline" onClick={ask} disabled={sending} className="gap-1 shrink-0">
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Kërko ndryshim
        </Button>
      )}
    </div>
  );
};

export default ManagedCredentialNotice;
