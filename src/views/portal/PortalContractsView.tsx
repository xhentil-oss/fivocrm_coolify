import React, { useState, useMemo } from 'react';
import { useCollection, useMutation } from '../../hooks/useFirestore';
import { useAuth } from '../../contexts/AuthContext';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useToast } from '../../hooks/use-toast';
import {
  ScrollText, ChevronDown, ChevronUp, Loader2, FileText, CheckCircle2, XCircle,
} from 'lucide-react';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Separator } from '../../components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import SignaturePad from '../../components/SignaturePad';
import type { Contract } from '../../types';

const STATUS_COLORS: Record<string, string> = {
  Sent: 'bg-blue-100 text-blue-700',
  Signed: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
  Expired: 'bg-orange-100 text-orange-700',
};
const STATUS_LABELS: Record<string, string> = {
  Sent: 'Pret Firmën',
  Signed: 'Nënshkruar',
  Rejected: 'Refuzuar',
  Expired: 'Skaduar',
};

const PortalContractsView: React.FC = () => {
  const { user } = useAuth();
  const { customerId, isLoading: portalLoading } = useClientPortal();
  const { toast } = useToast();

  const { data: contracts, loading } = useCollection<Contract>('contracts', {
    skip: !customerId,
    where: customerId ? [{ field: 'customerId', operator: '==', value: customerId }] : undefined,
    skipTeamFilter: true,
  });

  const contractMutation = useMutation<Contract>('contracts');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [signingContract, setSigningContract] = useState<Contract | null>(null);
  const [rejectingContract, setRejectingContract] = useState<Contract | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const visibleContracts = useMemo(() => {
    if (!contracts) return [];
    return contracts
      .filter(c => c.status !== 'Draft')
      .sort((a, b) => {
        const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toDate?.()?.getTime() ?? 0;
        const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toDate?.()?.getTime() ?? 0;
        return tb - ta;
      });
  }, [contracts]);

  const formatDate = (d: any) => {
    if (!d) return '—';
    const date = d instanceof Date ? d : d?.toDate?.();
    if (!date) return '—';
    return date.toLocaleDateString('sq-AL', { day: '2-digit', month: 'long', year: 'numeric' });
  };

  const handleSign = async (signatureData: string, signatureType: 'drawn' | 'typed') => {
    if (!signingContract || !user) return;
    setSubmitting(true);
    try {
      await contractMutation.update(signingContract.id, {
        status: 'Signed',
        signedAt: new Date(),
        signedByUserId: user.uid,
        signedByEmail: user.email || undefined,
        signatureData,
        signatureType,
        updatedAt: new Date(),
      } as any);
      toast({ title: '✅ Kontrata u nënshkrua me sukses!' });
      setSigningContract(null);
    } catch {
      toast({ title: 'Gabim', description: 'Ndodhi një gabim. Provoni sërish.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectingContract) return;
    setSubmitting(true);
    try {
      await contractMutation.update(rejectingContract.id, {
        status: 'Rejected',
        rejectedAt: new Date(),
        rejectionReason: rejectReason.trim() || undefined,
        updatedAt: new Date(),
      } as any);
      toast({ title: 'Kontrata u refuzua' });
      setRejectingContract(null);
      setRejectReason('');
    } catch {
      toast({ title: 'Gabim', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (portalLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ScrollText className="w-6 h-6" /> Kontratat
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Shikoni dhe nënshkruani kontratat tuaja
        </p>
      </div>

      {visibleContracts.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            <FileText className="w-12 h-12 mx-auto text-muted-foreground/30" />
            <p className="text-muted-foreground">Nuk keni kontratat ende.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleContracts.map(c => {
            const isExpanded = expandedId === c.id;
            return (
              <Card key={c.id} className="overflow-hidden">
                {/* Card Header — always visible */}
                <button
                  className="w-full text-left px-5 py-4 flex items-start gap-3 hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : c.id)}
                >
                  <div className="mt-0.5 p-2 bg-primary/10 rounded-lg shrink-0">
                    <ScrollText className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{c.title}</p>
                      <Badge variant="secondary" className={STATUS_COLORS[c.status] || ''}>
                        {STATUS_LABELS[c.status] || c.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {c.sentAt ? `Dërguar: ${formatDate(c.sentAt)}` : formatDate(c.createdAt)}
                      {c.expiresAt && ` · Skadon: ${formatDate(c.expiresAt)}`}
                    </p>
                    {c.packageSummary && (
                      <p className="text-xs text-muted-foreground">
                        Paketa: {c.packageSummary.label} ·{' '}
                        {c.packageSummary.grandTotal > 0
                          ? `${c.packageSummary.grandTotal.toLocaleString()} ${c.packageSummary.currency}`
                          : `${c.packageSummary.totalMonthly.toLocaleString()} ${c.packageSummary.currency}/muaj`}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-muted-foreground">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t">
                    {/* Package summary */}
                    {c.packageSummary && (
                      <div className="px-5 py-4 bg-muted/30 space-y-2">
                        <p className="text-sm font-semibold">📦 {c.packageSummary.label}</p>
                        <div className="space-y-1">
                          {c.packageSummary.categories.map((cat, i) => (
                            <div key={i} className="flex justify-between text-sm">
                              <span className="text-muted-foreground">{cat.category}</span>
                              <span>
                                {cat.oneTime > 0 && `${cat.oneTime.toLocaleString()} ${c.packageSummary!.currency}`}
                                {cat.oneTime > 0 && cat.monthly > 0 && ' + '}
                                {cat.monthly > 0 && `${cat.monthly.toLocaleString()} ${c.packageSummary!.currency}/muaj`}
                              </span>
                            </div>
                          ))}
                          {(c.packageSummary.discountAmount ?? 0) > 0 && (
                            <div className="flex justify-between text-sm text-green-600">
                              <span>Zbritje ({c.packageSummary.discountLabel})</span>
                              <span>−{c.packageSummary.discountAmount!.toLocaleString()} {c.packageSummary.currency}</span>
                            </div>
                          )}
                        </div>
                        <Separator />
                        <div className="flex justify-between text-sm font-bold">
                          <span>Grand Total</span>
                          <span className="text-primary">
                            {c.packageSummary.grandTotal > 0
                              ? `${c.packageSummary.grandTotal.toLocaleString()} ${c.packageSummary.currency}`
                              : `${c.packageSummary.totalMonthly.toLocaleString()} ${c.packageSummary.currency}/muaj`}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Contract body */}
                    <div className="px-5 py-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Teksti i Kontratës</p>
                      <div className="bg-white border rounded-lg p-4 max-h-64 overflow-y-auto">
                        <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed text-foreground">{c.body}</pre>
                      </div>
                    </div>

                    {/* Signature or status area */}
                    <div className="px-5 pb-5">
                      {c.status === 'Sent' && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
                          <p className="text-sm font-medium text-blue-800">
                            Kjo kontratë pret nënshkrimin tuaj
                          </p>
                          <div className="flex gap-2 flex-wrap">
                            <Button
                              className="bg-green-600 hover:bg-green-700 text-white"
                              onClick={() => setSigningContract(c)}
                            >
                              <CheckCircle2 className="w-4 h-4 mr-1.5" /> Nënshkruaj Kontratën
                            </Button>
                            <Button
                              variant="outline"
                              className="border-red-200 text-red-600 hover:bg-red-50"
                              onClick={() => setRejectingContract(c)}
                            >
                              <XCircle className="w-4 h-4 mr-1.5" /> Refuzo
                            </Button>
                          </div>
                        </div>
                      )}

                      {c.status === 'Signed' && (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
                          <p className="text-sm font-semibold text-green-800 flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4" /> Kontrata u nënshkrua
                          </p>
                          <p className="text-xs text-green-700">
                            Nënshkruar më: {formatDate(c.signedAt)} nga {c.signedByEmail || 'ju'}
                          </p>
                          {c.signatureData && (
                            <div className="pt-1">
                              {c.signatureType === 'drawn' ? (
                                <img src={c.signatureData} alt="Firma" className="h-14 border rounded bg-white p-1" />
                              ) : (
                                <span className="font-serif text-xl italic border rounded px-3 py-1 bg-white inline-block">
                                  {c.signatureData}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {c.status === 'Rejected' && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 space-y-1">
                          <p className="font-medium flex items-center gap-1.5">
                            <XCircle className="w-4 h-4" /> Kontrata u refuzua
                          </p>
                          {c.rejectionReason && <p className="text-xs">{c.rejectionReason}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Sign Dialog */}
      <Dialog open={!!signingContract} onOpenChange={(open) => { if (!open) setSigningContract(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nënshkruaj Kontratën</DialogTitle>
          </DialogHeader>
          {signingContract && (
            <div className="space-y-4 pt-2">
              <div className="bg-muted/40 rounded-lg p-3 text-sm">
                <p className="font-medium">{signingContract.title}</p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  Duke nënshkruar, konfirmoni se keni lexuar dhe pranuar të gjitha kushtet e kontratës.
                </p>
              </div>
              <SignaturePad
                onSign={({ type, data }) => handleSign(data, type)}
                disabled={submitting}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={!!rejectingContract} onOpenChange={(open) => { if (!open) { setRejectingContract(null); setRejectReason(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Refuzo Kontratën</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              A jeni të sigurt që doni të refuzoni këtë kontratë? Kjo veprim nuk mund të zhbëhet.
            </p>
            <div className="space-y-1.5">
              <Label>Arsyeja (opsionale)</Label>
              <Textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Shkruani arsyen e refuzimit..."
                rows={3}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setRejectingContract(null); setRejectReason(''); }}>Anulo</Button>
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={submitting}
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                Refuzo Kontratën
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PortalContractsView;
