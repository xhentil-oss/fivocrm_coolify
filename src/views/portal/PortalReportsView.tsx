/**
 * Client portal — Reports.
 *
 * Three layers of defence, on purpose:
 *
 *   1. The **query** asks only for `businessId == mine && customerId == mine` and
 *      filters to published, client-facing, non-deleted reports.
 *   2. The **Firestore rules** independently enforce exactly that, so a tampered
 *      query returns nothing rather than more.
 *   3. The **renderer** only ever receives `redactForClient(report)` output — the
 *      same function the PDF and the email use — so even a report that somehow
 *      arrived here cannot show an internal block.
 *
 * Client actions (view tracking, acknowledge, approve, reject) go through
 * `POST /api/reports`, not a direct Firestore write: the status machine and the
 * approval record must be applied server-side (a client may not write `reports`).
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, BadgeCheck, CheckCircle2, ChevronLeft, Download, Eye, FileText,
  MessageCircle, XCircle,
} from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { toast } from '../../hooks/use-toast';
import { auth } from '../../lib/firebase';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useCollection } from '../../hooks/useFirestore';
import ReportBlockRenderer from '../../components/reporting/ReportBlockRenderer';
import { ReportComments } from '../../components/reporting/ReportDiscussion';
import { clientAudience, findClientLeaks, redactForClient } from '../../lib/reporting/visibility';
import { PUBLISHED_STATUSES, isClientFacingKind } from '../../lib/reporting/workflow';
import { formatPeriodLabel } from '../../lib/reporting/period';
import { defaultBranding, downloadReportPdf } from '../../lib/reporting/pdf';
import type { Report, ReportComment } from '../../types';

const PortalReportsView: React.FC = () => {
  const { customerId, businessId, isLoading } = useClientPortal();
  const [openId, setOpenId] = useState<string | null>(null);

  // Narrow, tenant-scoped query. `skipTeamFilter` because a portal client has no
  // staff businessId in the global scope — they constrain the query themselves.
  const { data: rawReports, loading } = useCollection<Report>('reports', {
    skip: !customerId || !businessId,
    where: [
      { field: 'businessId', operator: '==', value: businessId || '' },
      { field: 'customerId', operator: '==', value: customerId || '' },
      // The provable form of "published + client-facing + not deleted" — the
      // rule keys on this denormalized flag; without it the whole query was
      // denied for every real portal client.
      { field: 'portalVisible', operator: '==', value: true },
    ],
    skipTeamFilter: true,
    skipBusinessFilter: true,
  });

  /** Belt-and-braces client-side mirror of the flag's definition. */
  const reports = useMemo(() => (rawReports || [])
    .filter(r => PUBLISHED_STATUSES.has(r.status))
    .filter(r => isClientFacingKind(r.kind))
    .filter(r => !r.deletedAt)
    .sort((a, b) => (b.publishedAt?.getTime() || 0) - (a.publishedAt?.getTime() || 0)),
  [rawReports]);

  const open = reports.find(r => r.id === openId) || null;

  if (isLoading || loading) {
    return (
      <div className="p-4 sm:p-6 space-y-3 max-w-4xl mx-auto">
        {[0, 1, 2].map(i => <Card key={i} className="h-20 animate-pulse bg-muted/40" />)}
      </div>
    );
  }

  if (open && customerId) {
    return <PortalReportDetail report={open} customerId={customerId} onBack={() => setOpenId(null)} />;
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Raportet</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Raportet e performancës të publikuara nga ekipi.
        </p>
      </div>

      {reports.length === 0 && (
        <Card className="p-10 text-center">
          <FileText className="w-8 h-8 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">Nuk ka raporte të publikuara ende.</p>
        </Card>
      )}

      <div className="space-y-2">
        {reports.map(r => (
          <Card
            key={r.id}
            className="p-4 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => setOpenId(r.id)}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground truncate">{r.title}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatPeriodLabel(r.period)}
                  {r.publishedAt ? ` · publikuar ${r.publishedAt.toLocaleDateString('sq-AL')}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {r.status === 'client_approved' && (
                  <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/30 gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Aprovuar
                  </Badge>
                )}
                {r.status === 'client_rejected' && (
                  <Badge variant="outline" className="text-[10px] bg-error/10 text-error border-error/30">
                    Refuzuar
                  </Badge>
                )}
                {r.acknowledgedAt && r.status !== 'client_approved' && (
                  <Badge variant="outline" className="text-[10px]">Konfirmuar</Badge>
                )}
                {!r.firstViewedAt && (
                  <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                    I re
                  </Badge>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

// ── detail ──────────────────────────────────────────────────────────────────────

const PortalReportDetail: React.FC<{
  report: Report;
  customerId: string;
  onBack: () => void;
}> = ({ report, customerId, onBack }) => {
  const [decisionMode, setDecisionMode] = useState<null | 'approve' | 'reject'>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const viewLogged = React.useRef(false);

  const audience = useMemo(() => clientAudience(customerId), [customerId]);

  /** The ONLY payload this screen renders. */
  const payload = useMemo(() => redactForClient(report, customerId), [report, customerId]);

  // Defence in depth: if redaction ever produced internal content, refuse to render.
  const leaks = useMemo(() => findClientLeaks(payload), [payload]);

  const { data: rawComments } = useCollection<ReportComment>('reportComments', {
    where: [
      { field: 'reportId', operator: '==', value: report.id },
      { field: 'internal', operator: '==', value: false },
      // The rule's portal clause is `isPortalClientFor(customerId)` — the query
      // must pin customerId or the listener is denied for every real client
      // (customerId is denormalized onto comments for exactly this).
      { field: 'customerId', operator: '==', value: customerId },
    ],
    skipTeamFilter: true,
    skipBusinessFilter: true,
  });
  const comments = useMemo(
    () => (rawComments || []).filter(c => !c.internal),
    [rawComments],
  );

  const callApi = async (action: string, body: Record<string, unknown> = {}) => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Sesioni skadoi — hyni përsëri.');
    // Plain fetch: nativeApi.installNativeApiBase() rewrites relative /api URLs to
    // the absolute host on Capacitor, so the same call works on web and Android.
    const res = await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, reportId: report.id, ...body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || 'Veprimi dështoi.');
    return json;
  };

  // Read tracking — once per mount, fire-and-forget.
  React.useEffect(() => {
    if (viewLogged.current) return;
    viewLogged.current = true;
    void callApi('view').catch(() => { /* tracking must never block reading */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.id]);

  const decided = report.status === 'client_approved' || report.status === 'client_rejected';

  const submitDecision = async () => {
    if (!decisionMode) return;
    if (decisionMode === 'reject' && !reason.trim()) {
      toast({ title: 'Shkruani arsyen', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      await callApi(decisionMode === 'approve' ? 'approve' : 'reject', { reason: reason.trim() || undefined });
      toast({ title: decisionMode === 'approve' ? 'Faleminderit — raporti u aprovua' : 'Raporti u refuzua' });
      setDecisionMode(null);
      setReason('');
    } catch (err: any) {
      toast({ title: 'Nuk u regjistrua', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl mx-auto">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 -ml-2">
        <ChevronLeft className="w-4 h-4" /> Të gjitha raportet
      </Button>

      <div>
        <h1 className="text-xl font-bold text-foreground">{report.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {formatPeriodLabel(report.period)}
          {report.publishedAt ? ` · publikuar ${report.publishedAt.toLocaleDateString('sq-AL')}` : ''}
        </p>
      </div>

      {leaks.length > 0 ? (
        <Card className="p-6 border-error/40 bg-error/5">
          <p className="text-sm text-error flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            Raporti nuk mund të shfaqet për arsye sigurie. Ekipi është njoftuar.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline" size="sm" className="gap-1.5"
              onClick={() => {
                try {
                  downloadReportPdf(payload, {
                    branding: defaultBranding(),
                    audience: 'client',
                    version: report.version,
                  });
                  void callApi('pdf-downloaded').catch(() => {});
                } catch (err: any) {
                  toast({ title: 'PDF dështoi', description: err?.message, variant: 'destructive' });
                }
              }}
            >
              <Download className="w-4 h-4" /> Shkarko PDF
            </Button>
            {!report.acknowledgedAt && !decided && (
              <Button
                variant="outline" size="sm" className="gap-1.5"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await callApi('acknowledge');
                    toast({ title: 'Konfirmuar' });
                  } catch (err: any) {
                    toast({ title: 'Nuk u regjistrua', description: err?.message, variant: 'destructive' });
                  } finally { setBusy(false); }
                }}
              >
                <Eye className="w-4 h-4" /> Konfirmo marrjen
              </Button>
            )}
            {!decided && (
              <>
                <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => setDecisionMode('approve')}>
                  <BadgeCheck className="w-4 h-4" /> Aprovo raportin
                </Button>
                <Button
                  variant="outline" size="sm" className="gap-1.5 text-error border-error/30"
                  disabled={busy} onClick={() => setDecisionMode('reject')}
                >
                  <XCircle className="w-4 h-4" /> Kërko sqarime
                </Button>
              </>
            )}
          </div>

          {decided && (
            <Card className={`p-3 ${report.status === 'client_approved'
              ? 'border-success/40 bg-success/5' : 'border-error/40 bg-error/5'}`}>
              <p className={`text-sm flex items-center gap-2 ${
                report.status === 'client_approved' ? 'text-success' : 'text-error'}`}>
                {report.status === 'client_approved'
                  ? <><CheckCircle2 className="w-4 h-4" /> Ju aprovuat versionin v{report.clientApprovedVersion}.</>
                  : <><XCircle className="w-4 h-4" /> Ju kërkuat sqarime. Ekipi është njoftuar.</>}
              </p>
            </Card>
          )}

          <ReportBlockRenderer
            blocks={payload.blocks}
            kpiValues={payload.kpiValues}
            currency={report.currency}
          />

          <Card className="p-4">
            <ReportComments
              comments={comments}
              audience={audience}
              mode="client"
              currentUserId={auth.currentUser?.uid || null}
              onSubmit={async body => {
                try {
                  await callApi('comment', { body });
                  toast({ title: 'Komenti u dërgua' });
                } catch (err: any) {
                  toast({ title: 'Komenti nuk u dërgua', description: err?.message, variant: 'destructive' });
                }
              }}
            />
          </Card>

          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <MessageCircle className="w-3 h-3 shrink-0 mt-0.5" />
            Komentet tuaja shkojnë direkt tek ekipi që punon me llogarinë tuaj.
          </p>
        </>
      )}

      <Dialog open={!!decisionMode} onOpenChange={o => !o && setDecisionMode(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {decisionMode === 'approve' ? 'Aprovo raportin' : 'Kërko sqarime'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {decisionMode === 'approve'
                ? `Aprovimi regjistrohet ndaj versionit v${report.version} të këtij raporti.`
                : 'Përshkruani çfarë duhet sqaruar, që ekipi të dijë saktësisht se ku të fokusohet.'}
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">
                {decisionMode === 'approve' ? 'Koment (opsional)' : 'Arsyeja (e detyrueshme)'}
              </Label>
              <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={4} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDecisionMode(null)}>Anulo</Button>
              <Button
                onClick={submitDecision}
                disabled={busy || (decisionMode === 'reject' && !reason.trim())}
              >
                {busy ? 'Duke ruajtur…' : 'Konfirmo'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PortalReportsView;
