/**
 * Report detail — edit, review, approve, publish, export, discuss, audit.
 *
 * One screen rather than four, because the same people move between those modes
 * constantly and a separate "review screen" would just duplicate the renderer. The
 * available actions come from `canTransition()`, so the buttons on screen are
 * exactly the transitions the server would accept.
 *
 * The preview toggle is the module's trust device: "Shiko si klienti" renders the
 * report through `redactForClient()` — the very same function the portal, the PDF
 * and the email use — so what you see there is definitionally what the client gets.
 */

import React, { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, BadgeCheck, CheckCircle2, ClipboardCheck, Download,
  Eye, FileText, History, Lock, Pencil, Save, Send, Sparkles, Trash2, XCircle,
} from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { toast } from '../hooks/use-toast';
import { useAuth } from '../contexts/AuthContext';
import { useCollection, useDocument } from '../hooks/useFirestore';
import { useUserNames } from '../hooks/useUserNames';
import { usePermissions } from '../contexts/PermissionsContext';
import { useReports, useReport } from '../hooks/useReports';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import ReportBuilder from '../components/reporting/ReportBuilder';
import ReportBlockRenderer from '../components/reporting/ReportBlockRenderer';
import { ReportComments, ReportAuditTimeline } from '../components/reporting/ReportDiscussion';
import {
  STATUS_LABELS, STATUS_TONE, canEditContent, canTransition, isClientFacingKind,
} from '../lib/reporting/workflow';
import { redactForAudience, redactForClient, findClientLeaks } from '../lib/reporting/visibility';
import { checkReportQuality, qualityBand } from '../lib/reporting/quality';
import { HEALTH_CLASSES, HEALTH_LABELS, overrideNeedsReason } from '../lib/reporting/health';
import { formatPeriodLabel } from '../lib/reporting/period';
import { defaultBranding, downloadReportPdf } from '../lib/reporting/pdf';
import type { Report, ReportBlock, ReportHealth, ReportStatus, TeamMember } from '../types';

const TONE_CLASSES: Record<string, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  info: 'bg-primary/10 text-primary border-primary/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  success: 'bg-success/10 text-success border-success/30',
  error: 'bg-error/10 text-error border-error/30',
};

/** Actions offered, in the order a report actually travels. */
const ACTIONS: Array<{ to: ReportStatus; label: string; icon: React.ComponentType<{ className?: string }>; needsReason?: boolean; variant?: 'default' | 'outline' | 'destructive' }> = [
  { to: 'submitted', label: 'Dorëzo për shqyrtim', icon: Send },
  { to: 'changes_requested', label: 'Kërko ndryshime', icon: XCircle, needsReason: true, variant: 'outline' },
  { to: 'internally_approved', label: 'Aprovo brenda', icon: BadgeCheck },
  { to: 'published', label: 'Publiko për klientin', icon: Eye },
  { to: 'sent', label: 'Dërgo me email', icon: Send, variant: 'outline' },
  { to: 'in_progress', label: 'Rihap për redaktim', icon: Pencil, variant: 'outline' },
  { to: 'archived', label: 'Arkivo', icon: Lock, variant: 'outline' },
];

const ReportDetailView: React.FC = () => {
  const { reportId } = useParams<{ reportId: string }>();
  const navigate = useNavigate();
  // `?comment=<id>` — a comment notification links straight to its comment.
  const [searchParams] = useSearchParams();
  const focusCommentId = searchParams.get('comment');
  const { user } = useAuth();
  const permissions = usePermissions();
  const { data: report, loading } = useDocument<Report>('reports', reportId);
  const { comments, versions, approvals, events } = useReport(reportId);
  const {
    kpis, viewer, actorFor, audienceFor, saveContent, setHealth, transition,
    addComment, resolveComment, softDelete, logEvent,
  } = useReports({ skip: true });
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', { skipTeamFilter: true });
  const { getName } = useUserNames(teamMembers);

  const [draftBlocks, setDraftBlocks] = useState<ReportBlock[] | null>(null);
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<'internal' | 'client'>('internal');
  const [reasonFor, setReasonFor] = useState<ReportStatus | null>(null);
  const [reason, setReason] = useState('');
  const [healthDialog, setHealthDialog] = useState(false);

  const dirty = draftBlocks !== null || draftTitle !== null;
  useUnsavedChanges(dirty);

  // Note: staff opens are deliberately NOT written to `reportEvents`. The audit
  // stream records decisions and deliveries; logging every internal page view would
  // bury those in noise and cost a write per navigation. Client views ARE tracked
  // (server-side, via /api/reports) because "did the client read it" is the question
  // the agency actually needs answered.

  const working: Report | null = useMemo(() => {
    if (!report) return null;
    return {
      ...report,
      ...(draftBlocks ? { blocks: draftBlocks } : {}),
      ...(draftTitle !== null ? { title: draftTitle } : {}),
    };
  }, [report, draftBlocks, draftTitle]);

  const actor = working ? actorFor(working) : null;
  const audience = working ? audienceFor(working) : null;
  const editable = !!working && !!actor && canEditContent(working, actor);

  const quality = useMemo(() => (working ? checkReportQuality(working) : null), [working]);

  // The client preview goes through the SAME redactor the portal/PDF/email use.
  const clientPayload = useMemo(
    () => (working && working.customerId ? redactForClient(working, working.customerId) : null),
    [working],
  );
  const internalPayload = useMemo(
    () => (working && audience ? redactForAudience(working, audience) : null),
    [working, audience],
  );

  const available = useMemo(() => {
    if (!working || !actor) return [];
    return ACTIONS.filter(a => canTransition(working, a.to, { actor, reason: a.needsReason ? 'x' : undefined }).ok);
  }, [working, actor]);

  if (loading) {
    return <div className="p-6 max-w-5xl mx-auto"><Card className="h-64 animate-pulse bg-muted/40" /></div>;
  }
  if (!report || !working || !audience) {
    return (
      <div className="p-6 max-w-3xl mx-auto text-center">
        <FileText className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-muted-foreground">Raporti nuk u gjet ose nuk kini akses.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/app/reports')}>
          Kthehu te raportet
        </Button>
      </div>
    );
  }

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await saveContent(report, {
        ...(draftBlocks ? { blocks: draftBlocks } : {}),
        ...(draftTitle !== null ? { title: draftTitle } : {}),
      });
      setDraftBlocks(null);
      setDraftTitle(null);
      toast({ title: 'U ruajt' });
    } catch (err: any) {
      toast({ title: 'Ruajtja dështoi', description: err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const runTransition = async (to: ReportStatus, why?: string) => {
    if (dirty) {
      toast({ title: 'Ruani ndryshimet së pari', variant: 'destructive' });
      return;
    }
    try {
      await transition(report, to, { reason: why });
      toast({ title: `Statusi: ${STATUS_LABELS[to]}` });
      setReasonFor(null);
      setReason('');
    } catch (err: any) {
      toast({ title: 'Veprimi nuk u krye', description: err?.message, variant: 'destructive' });
    }
  };

  const exportPdf = (mode: 'client' | 'internal') => {
    try {
      const payload = mode === 'client'
        ? (clientPayload || redactForAudience(working, audience, { target: 'pdf' }))
        : redactForAudience(working, audience, { target: 'pdf' });
      if (mode === 'client') {
        const leaks = findClientLeaks(payload);
        if (leaks.length) throw new Error('Përmbajtje e brendshme u zbulua — publikimi u ndal.');
      }
      downloadReportPdf(payload, {
        branding: {
          ...defaultBranding(),
          confidentialityNotice: mode === 'internal'
            ? 'DOKUMENT I BRENDSHËM — nuk shpërndahet jashtë agjencisë.'
            : undefined,
        },
        audience: mode,
        version: report.version,
        accountManagerName: report.accountManagerUserId ? getName(report.accountManagerUserId) : undefined,
        includeTableOfContents: true,
        includeApprovalHistory: approvals.map(a => ({
          stage: a.stage,
          decision: a.decision,
          by: a.approverName || getName(a.approverUserId),
          at: a.createdAt instanceof Date ? a.createdAt.toLocaleDateString('sq-AL') : '',
        })),
      });
      void logEvent(report, 'pdf-downloaded', { meta: { mode } });
    } catch (err: any) {
      toast({ title: 'PDF dështoi', description: err?.message, variant: 'destructive' });
    }
  };

  const showClientPreview = preview === 'client' && !!clientPayload;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/app/reports')} className="gap-1.5 -ml-2">
          <ArrowLeft className="w-4 h-4" /> Raportet
        </Button>

        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            {editable ? (
              <Input
                value={draftTitle ?? report.title}
                onChange={e => setDraftTitle(e.target.value)}
                className="text-lg font-semibold h-auto py-1.5"
              />
            ) : (
              <h1 className="text-xl font-bold text-foreground">{report.title}</h1>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant="outline" className={`text-xs ${TONE_CLASSES[STATUS_TONE[report.status]]}`}>
                {STATUS_LABELS[report.status]}
              </Badge>
              <Badge variant="outline" className="text-xs">v{report.version}</Badge>
              <span className="text-xs text-muted-foreground">{formatPeriodLabel(report.period)}</span>
              {report.customerName && <span className="text-xs text-muted-foreground">· {report.customerName}</span>}
              {report.health && (
                <button type="button" onClick={() => setHealthDialog(true)}>
                  <Badge variant="outline" className={`text-xs ${HEALTH_CLASSES[report.health]}`}>
                    {HEALTH_LABELS[report.health]}
                  </Badge>
                </button>
              )}
              {report.hasUnpublishedChanges && (
                <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
                  pret re-aprovim
                </Badge>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {dirty && (
              <Button onClick={save} disabled={saving} className="gap-1.5">
                <Save className="w-4 h-4" /> {saving ? 'Duke ruajtur…' : 'Ruaj'}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => exportPdf('internal')} className="gap-1.5">
              <Download className="w-4 h-4" /> PDF i brendshëm
            </Button>
            {report.customerId && (
              <Button variant="outline" size="sm" onClick={() => exportPdf('client')} className="gap-1.5">
                <Download className="w-4 h-4" /> PDF i klientit
              </Button>
            )}
          </div>
        </div>

        {/* Workflow actions */}
        {available.length > 0 && (
          <Card className="p-3 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground mr-1">Veprime:</span>
            {available.map(a => (
              <Button
                key={a.to}
                size="sm"
                variant={a.variant || 'default'}
                className="gap-1.5"
                onClick={() => (a.needsReason ? setReasonFor(a.to) : void runTransition(a.to))}
              >
                <a.icon className="w-3.5 h-3.5" /> {a.label}
              </Button>
            ))}
          </Card>
        )}

        {/* Change-request banner */}
        {report.status === 'changes_requested' && (
          <Card className="p-3 border-warning/40 bg-warning/5">
            <p className="text-sm text-warning flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Kërkohen ndryshime.
                {approvals.find(a => a.decision === 'changes_requested')?.comment
                  && ` "${approvals.find(a => a.decision === 'changes_requested')!.comment}"`}
              </span>
            </p>
          </Card>
        )}
      </div>

      {/* Preview switch */}
      {report.customerId && (
        <div className="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit">
          <button
            type="button"
            onClick={() => setPreview('internal')}
            className={`text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${
              preview === 'internal' ? 'bg-card shadow-sm font-medium text-foreground' : 'text-muted-foreground'}`}
          >
            <Lock className="w-3 h-3" /> Pamja e brendshme
          </button>
          <button
            type="button"
            onClick={() => setPreview('client')}
            className={`text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${
              preview === 'client' ? 'bg-primary text-primary-foreground shadow-sm font-semibold' : 'text-muted-foreground'}`}
          >
            <Eye className="w-3 h-3" /> Shiko si klienti
          </button>
        </div>
      )}

      {showClientPreview && (
        <Card className="p-3 border-primary/40 bg-primary/5">
          <p className="text-xs text-primary flex items-start gap-2">
            <Eye className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Kjo është saktësisht ajo që shikon klienti — e prodhuar nga i njëjti filtër
              që përdorin portali, PDF-i dhe emaili. {clientPayload?.blocks.length || 0} seksione,{' '}
              {clientPayload?.kpiValues?.length || 0} KPI.
            </span>
          </p>
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <Tabs defaultValue={editable && !showClientPreview ? 'edit' : 'view'}>
            <TabsList>
              <TabsTrigger value="view">Pamja</TabsTrigger>
              {editable && !showClientPreview && <TabsTrigger value="edit">Redakto</TabsTrigger>}
              <TabsTrigger value="history" className="gap-1.5">
                <History className="w-3.5 h-3.5" /> Historiku
              </TabsTrigger>
            </TabsList>

            <TabsContent value="view" className="mt-4">
              <ReportBlockRenderer
                blocks={(showClientPreview ? clientPayload : internalPayload)?.blocks || []}
                kpiValues={(showClientPreview ? clientPayload : internalPayload)?.kpiValues || []}
                currency={report.currency}
                showVisibilityBadges={!showClientPreview}
              />
            </TabsContent>

            {editable && !showClientPreview && (
              <TabsContent value="edit" className="mt-4">
                <ReportBuilder
                  blocks={draftBlocks ?? report.blocks}
                  onChange={setDraftBlocks}
                  kpis={kpis}
                  isAdmin={permissions.isAdmin || permissions.isOwner}
                />
              </TabsContent>
            )}

            <TabsContent value="history" className="mt-4 space-y-6">
              <div>
                <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4" /> Aprovimet
                </h3>
                {approvals.length === 0
                  ? <p className="text-sm text-muted-foreground">Pa aprovime të regjistruara.</p>
                  : (
                    <div className="space-y-2">
                      {approvals.map(a => (
                        <Card key={a.id} className="p-3">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <p className="text-sm text-foreground">
                              {a.approverCustomerId ? 'Klienti' : (a.approverName || getName(a.approverUserId))}
                              {' — '}
                              <span className={a.decision === 'approved' ? 'text-success'
                                : a.decision === 'rejected' ? 'text-error' : 'text-warning'}>
                                {a.decision}
                              </span>
                            </p>
                            <span className="text-xs text-muted-foreground">
                              v{a.version} · {a.createdAt instanceof Date ? a.createdAt.toLocaleDateString('sq-AL') : ''}
                            </span>
                          </div>
                          {a.comment && <p className="text-xs text-muted-foreground mt-1 italic">"{a.comment}"</p>}
                        </Card>
                      ))}
                    </div>
                  )}
              </div>

              <div>
                <h3 className="font-semibold text-foreground mb-3">Versionet</h3>
                {versions.length === 0
                  ? <p className="text-sm text-muted-foreground">Pa versione të ruajtura.</p>
                  : (
                    <div className="space-y-1.5">
                      {versions.map(v => (
                        <div key={v.id} className="flex items-center justify-between gap-2 text-sm py-1.5 border-b border-border/50 last:border-0">
                          <span className="text-foreground">v{v.version} · {v.reason}</span>
                          <span className="text-xs text-muted-foreground">
                            {v.createdAt instanceof Date ? v.createdAt.toLocaleDateString('sq-AL') : ''}
                            {report.clientApprovedVersion === v.version && (
                              <Badge variant="outline" className="ml-2 text-[10px] bg-success/10 text-success border-success/30">
                                aprovuar nga klienti
                              </Badge>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
              </div>

              <div>
                <h3 className="font-semibold text-foreground mb-3">Gjurma e auditit</h3>
                <ReportAuditTimeline events={events} getName={getName} />
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* Quality */}
          {quality && (
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground text-sm">Cilësia e raportit</h3>
                <Badge variant="outline" className={`text-xs ${qualityBand(quality.score).className}`}>
                  {quality.score} · {qualityBand(quality.score).label}
                </Badge>
              </div>
              {quality.suggestions.length === 0 ? (
                <p className="text-xs text-success flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Të gjitha kontrollet kaluan.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {quality.suggestions.slice(0, 6).map(s => (
                    <li key={s.key} className={`text-xs flex items-start gap-1.5 ${
                      s.blocking ? 'text-error' : 'text-muted-foreground'}`}>
                      <span className="shrink-0 mt-0.5">{s.blocking ? '●' : '○'}</span>
                      <span>
                        {s.label}
                        {s.hint && <span className="block text-[11px] opacity-80 mt-0.5">{s.hint}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
                Sugjerime, jo bllokues — vetëm fushat e detyrueshme ndalojnë dorëzimin.
              </p>
            </Card>
          )}

          {/* Meta */}
          <Card className="p-4 space-y-2.5 text-sm">
            <h3 className="font-semibold text-foreground">Detajet</h3>
            <MetaRow label="Autori" value={getName(report.authorUserId)} />
            {report.reviewerUserId && <MetaRow label="Shqyrtuesi" value={getName(report.reviewerUserId)} />}
            {report.approverUserId && <MetaRow label="Aprovuesi" value={getName(report.approverUserId)} />}
            {report.dueAt && <MetaRow label="Afati" value={report.dueAt.toLocaleDateString('sq-AL')} />}
            {report.publishedAt && <MetaRow label="Publikuar" value={report.publishedAt.toLocaleDateString('sq-AL')} />}
            {report.firstViewedAt && <MetaRow label="Hapur nga klienti" value={report.firstViewedAt.toLocaleDateString('sq-AL')} />}
            {typeof report.viewCount === 'number' && <MetaRow label="Shikime" value={String(report.viewCount)} />}
            {report.acknowledgedAt && <MetaRow label="Konfirmuar" value={report.acknowledgedAt.toLocaleDateString('sq-AL')} />}
            {report.templateKey && <MetaRow label="Template" value={`${report.templateKey} v${report.templateVersion ?? 1}`} />}
            {isClientFacingKind(report.kind) && (
              <MetaRow label="Për klientin" value={`${clientPayload?.blocks.length || 0} seksione`} />
            )}
          </Card>

          {/* Health override */}
          {report.suggestedHealth && (
            <Card className="p-4 space-y-2">
              <h3 className="font-semibold text-foreground text-sm">Statusi i sugjeruar</h3>
              <Badge variant="outline" className={`text-xs ${HEALTH_CLASSES[report.suggestedHealth]}`}>
                {HEALTH_LABELS[report.suggestedHealth]}
              </Badge>
              {report.suggestedHealthReasons?.length ? (
                <ul className="space-y-1 mt-1">
                  {report.suggestedHealthReasons.map((r, i) => (
                    <li key={i} className="text-[11px] text-muted-foreground">• {r}</li>
                  ))}
                </ul>
              ) : null}
              {report.healthOverrideReason && (
                <p className="text-[11px] text-warning border-t border-border pt-2 mt-2">
                  Mbivendosur: "{report.healthOverrideReason}"
                </p>
              )}
              <Button variant="outline" size="sm" className="w-full" onClick={() => setHealthDialog(true)}>
                Ndrysho statusin
              </Button>
            </Card>
          )}

          {/* AI notice */}
          {report.blocks.some(b => b.aiSuggested && !b.aiApprovedByUserId) && (
            <Card className="p-4 border-warning/40 bg-warning/5">
              <p className="text-xs text-warning flex items-start gap-2">
                <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Ka përmbajtje të sugjeruar nga AI që pret aprovim njerëzor. Publikimi bllokohet derisa ta aprovoni.
              </p>
            </Card>
          )}

          {/* Danger zone */}
          {(viewer.isManagement || report.authorUserId === user?.uid) && !report.legalHold && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5 text-error border-error/30"
              onClick={async () => {
                if (!window.confirm('Fshi raportin? Do të kalojë në koshin (soft delete).')) return;
                try {
                  await softDelete(report);
                  toast({ title: 'Raporti u fshi' });
                  navigate('/app/reports');
                } catch (err: any) {
                  toast({ title: 'Nuk u fshi', description: err?.message, variant: 'destructive' });
                }
              }}
            >
              <Trash2 className="w-3.5 h-3.5" /> Fshi raportin
            </Button>
          )}

          {report.legalHold && (
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <Lock className="w-3 h-3 shrink-0 mt-0.5" />
              Aprovuar nga klienti — raporti ruhet si dokument dhe nuk fshihet.
            </p>
          )}
        </div>
      </div>

      {/* Discussion */}
      <Card className="p-4">
        <ReportComments
          comments={comments}
          audience={audience}
          mode="staff"
          currentUserId={user?.uid}
          getName={getName}
          focusCommentId={focusCommentId}
          onSubmit={async (body, internal) => {
            try {
              await addComment(report, body, { internal });
            } catch (err: any) {
              toast({ title: 'Komenti nuk u shtua', description: err?.message, variant: 'destructive' });
            }
          }}
          onResolve={resolveComment}
        />
      </Card>

      {/* Reason dialog */}
      <Dialog open={!!reasonFor} onOpenChange={o => !o && setReasonFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{reasonFor ? STATUS_LABELS[reasonFor] : ''}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Arsyeja (regjistrohet në gjurmën e auditit)</Label>
              <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={4} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReasonFor(null)}>Anulo</Button>
              <Button
                disabled={!reason.trim()}
                onClick={() => reasonFor && void runTransition(reasonFor, reason.trim())}
              >
                Konfirmo
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <HealthDialog
        open={healthDialog}
        onClose={() => setHealthDialog(false)}
        report={report}
        onSave={async (health, why) => {
          try {
            await setHealth(report, health, why);
            toast({ title: 'Statusi u përditësua' });
            setHealthDialog(false);
          } catch (err: any) {
            toast({ title: 'Nuk u ruajt', description: err?.message, variant: 'destructive' });
          }
        }}
      />
    </div>
  );
};

const MetaRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between gap-2">
    <span className="text-muted-foreground text-xs">{label}</span>
    <span className="text-foreground text-xs text-right truncate max-w-[60%]" title={value}>{value}</span>
  </div>
);

const HealthDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  report: Report;
  onSave: (health: ReportHealth, reason?: string) => Promise<void>;
}> = ({ open, onClose, report, onSave }) => {
  const [health, setHealthValue] = useState<ReportHealth>(report.health || report.suggestedHealth || 'green');
  const [why, setWhy] = useState(report.healthOverrideReason || '');
  const needsReason = overrideNeedsReason(report.suggestedHealth, health);

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Statusi i shëndetit</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {report.suggestedHealth && (
            <p className="text-xs text-muted-foreground">
              Sistemi sugjeron: <strong>{HEALTH_LABELS[report.suggestedHealth]}</strong>
            </p>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Statusi</Label>
            <Select value={health} onValueChange={v => setHealthValue(v as ReportHealth)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['green', 'yellow', 'red', 'blue', 'grey'] as ReportHealth[]).map(h => (
                  <SelectItem key={h} value={h}>{HEALTH_LABELS[h]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {needsReason && (
            <div className="space-y-1.5">
              <Label className="text-xs text-warning">
                Po e ndryshoni nga sugjerimi — shkruani arsyen (e detyrueshme)
              </Label>
              <Textarea value={why} onChange={e => setWhy(e.target.value)} rows={3} />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Anulo</Button>
            <Button
              disabled={needsReason && !why.trim()}
              onClick={() => void onSave(health, why.trim() || undefined)}
            >
              Ruaj
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReportDetailView;
