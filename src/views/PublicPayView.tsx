import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { CreditCard, Check, XCircle, Loader2, ShieldCheck } from 'lucide-react';
import { currencySymbol } from '../lib/utils';

/**
 * Public "pay this invoice" page — /pay/:invoiceId?t=<token>.
 *
 * No login: the token in the link IS the authorization (it must match the
 * invoice's `publicPayToken`, minted by staff in InvoicesView). Everything
 * goes through /api/create-checkout-session — this page never touches
 * Firestore, so the security boundary stays server-side.
 */

interface PayInfo {
  invoiceNumber: string;
  status: string;
  currency: string;
  total: number;
  remainder: number;
  businessName: string | null;
  items?: Array<{ name: string; quantity: number; totalPrice: number }>;
  payable: boolean;
}

const PublicPayView: React.FC = () => {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('t') || '';
  const paymentParam = searchParams.get('payment');

  const [info, setInfo] = useState<PayInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!invoiceId || !token) {
        setError('Linku i pagesës nuk është i plotë. Kërkoni një link të ri.');
        return;
      }
      try {
        const res = await fetch('/api/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoiceId, payToken: token, info: true }),
        });
        const data = await res.json().catch(() => ({} as any));
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 401 || res.status === 403
            ? 'Ky link pagese nuk është i vlefshëm ose ka ndryshuar. Kërkoni një link të ri.'
            : (data?.error || 'Fatura nuk u gjet.'));
          return;
        }
        setInfo(data as PayInfo);
      } catch {
        if (!cancelled) setError('Nuk u lidhëm dot me serverin — provoni sërish.');
      }
    })();
    return () => { cancelled = true; };
    // Re-fetch after returning from Stripe so a completed payment shows as Paid.
  }, [invoiceId, token, paymentParam]);

  const handlePay = async () => {
    if (!invoiceId || !token || paying) return;
    setPaying(true);
    try {
      const base = `${window.location.origin}/pay/${invoiceId}?t=${encodeURIComponent(token)}`;
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId,
          payToken: token,
          successUrl: `${base}&payment=success`,
          cancelUrl: `${base}&payment=cancelled`,
        }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data?.error || 'Pagesa nuk u hap dot.');
      const parsed = new URL(data.url);
      if (parsed.hostname === 'stripe.com' || parsed.hostname.endsWith('.stripe.com')) {
        window.location.href = data.url;
        return;
      }
      throw new Error('URL e pagesës nuk është e vlefshme.');
    } catch (err: any) {
      setError(err?.message || 'Pagesa nuk u hap dot.');
      setPaying(false);
    }
  };

  const cur = info ? currencySymbol(info.currency) : '';
  const isLek = !info?.currency || info.currency.toUpperCase() === 'ALL' || info.currency.toUpperCase() === 'LEK';
  const justPaid = paymentParam === 'success';
  const isPaid = info?.status === 'Paid';

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-slate-500">
            {info?.businessName || 'Pagesë fature'}
          </p>
        </div>

        <Card className="shadow-lg border-slate-200">
          <CardContent className="p-6 space-y-5">
            {/* Loading */}
            {!info && !error && (
              <div className="flex items-center justify-center gap-2 py-10 text-slate-500">
                <Loader2 className="w-5 h-5 animate-spin" />
                Duke ngarkuar faturën…
              </div>
            )}

            {/* Invalid / expired link */}
            {error && (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <XCircle className="w-10 h-10 text-red-500" />
                <p className="text-sm text-slate-600">{error}</p>
              </div>
            )}

            {info && (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">Fatura</p>
                    <p className="text-lg font-semibold text-slate-900">#{info.invoiceNumber}</p>
                  </div>
                  {(isPaid || justPaid) ? (
                    <Badge className="bg-green-100 text-green-800">E paguar</Badge>
                  ) : info.status === 'Overdue' ? (
                    <Badge className="bg-red-100 text-red-800">E vonuar</Badge>
                  ) : (
                    <Badge className="bg-amber-100 text-amber-800">Në pritje</Badge>
                  )}
                </div>

                {(info.items?.length ?? 0) > 0 && (
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {info.items!.map((it, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                        <span className="text-slate-700">
                          {it.quantity > 1 ? `${it.quantity} × ` : ''}{it.name}
                        </span>
                        <span className="font-medium text-slate-900 whitespace-nowrap">
                          {it.totalPrice.toLocaleString()} {cur}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-xl bg-slate-100 p-4 text-center">
                  <p className="text-xs text-slate-500 mb-1">
                    {info.remainder < info.total ? 'Shuma e mbetur' : 'Shuma për pagesë'}
                  </p>
                  <p className="text-3xl font-bold text-slate-900">
                    {info.remainder.toLocaleString()} {cur}
                  </p>
                </div>

                {(isPaid || justPaid) ? (
                  <div className="flex items-center justify-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700">
                    <Check className="w-5 h-5" />
                    <span className="font-medium">
                      {isPaid ? 'Fatura është paguar — faleminderit!' : 'Pagesa u pranua — po konfirmohet…'}
                    </span>
                  </div>
                ) : paymentParam === 'cancelled' && info.payable ? (
                  <div className="text-center text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    Pagesa u anulua — mund ta provoni sërish.
                  </div>
                ) : null}

                {!isPaid && !justPaid && (info.payable ? (
                  <Button
                    className="w-full h-12 text-base bg-[#635BFF] hover:bg-[#5851ea] text-white"
                    disabled={paying}
                    onClick={handlePay}
                  >
                    {paying
                      ? <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      : <CreditCard className="w-5 h-5 mr-2" />}
                    Paguaj me kartë
                  </Button>
                ) : (
                  <div className="text-center text-sm text-slate-500 bg-slate-50 border border-dashed rounded-lg p-3">
                    Kjo faturë nuk pranon pagesë online për momentin.
                  </div>
                ))}

                {isLek && info.payable && !isPaid && !justPaid && (
                  <p className="text-xs text-center text-slate-400">
                    Pagesa online kryhet në EUR sipas kursit të kompanisë.
                  </p>
                )}
              </>
            )}

            <div className="flex items-center justify-center gap-1.5 pt-1 text-xs text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              Pagesë e sigurt përmes Stripe
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PublicPayView;
