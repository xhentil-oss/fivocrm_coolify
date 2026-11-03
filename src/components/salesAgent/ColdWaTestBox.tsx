import { useState } from 'react';
import { Eye, Loader2, Send } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useToast } from '../../hooks/use-toast';
import { describeSalesAgentError, testColdWa, type ColdWaTestResult } from '../../lib/salesAgent/api';

/**
 * "Provo mesazhin e parë": shows the first cold message exactly as the job renders it
 * (SAVED template + persona) and sends it to the manager's own number. Never touches a
 * prospect, a lead or the sender's quota (api/_salesAgent.ts → `coldwa.test`).
 */
export default function ColdWaTestBox({ dirty, disabled }: { dirty: boolean; disabled: boolean }) {
  const { toast } = useToast();
  const [phone, setPhone] = useState('');
  const [sampleName, setSampleName] = useState('');
  const [sampleCity, setSampleCity] = useState('');
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null);
  const [result, setResult] = useState<ColdWaTestResult | null>(null);

  const run = async (send: boolean) => {
    setBusy(send ? 'send' : 'preview');
    try {
      const r = await testColdWa({ send, phone: send ? phone : undefined, sampleName: sampleName || undefined, sampleCity: sampleCity || undefined });
      setResult(r);
      if (send) toast({ title: 'Mesazhi i provës u dërgua', description: `Shiko WhatsApp-in te ${phone}.` });
    } catch (err) {
      toast({ title: send ? 'Prova nuk u dërgua' : 'Parapamja dështoi', description: describeSalesAgentError(err), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div>
        <p className="text-sm font-medium">Provo mesazhin e parë</p>
        <p className="text-[11px] text-muted-foreground">Dërgohet vetëm te numri që shkruan këtu, nga i njëjti numër dërgues. Asnjë prospekt nuk kontaktohet dhe kuota ditore nuk preket.</p>
      </div>
      {dirty && <p className="text-[11px] text-amber-700">Ruaj ndryshimet më parë — prova përdor cilësimet e ruajtura.</p>}
      <div className="grid sm:grid-cols-3 gap-2">
        <div className="space-y-1"><Label className="text-xs">Emri i biznesit (shembull)</Label><Input value={sampleName} placeholder="Biznesi Shembull" maxLength={80} onChange={(e) => setSampleName(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">Qyteti (shembull)</Label><Input value={sampleCity} placeholder="Tiranë" maxLength={60} onChange={(e) => setSampleCity(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">Numri yt</Label><Input value={phone} placeholder="069…" inputMode="tel" maxLength={40} onChange={(e) => setPhone(e.target.value)} /></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={disabled || busy !== null} onClick={() => { void run(false); }}>
          {busy === 'preview' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}Parapamje
        </Button>
        <Button type="button" size="sm" disabled={disabled || busy !== null || dirty || phone.trim().length < 8} onClick={() => { void run(true); }}>
          {busy === 'send' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}Dërgo provë te numri im
        </Button>
      </div>
      {result && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">
            {result.sender ? `Nga numri ${result.sender.phone || result.sender.agentId}${result.sender.connected ? '' : ' (jo i lidhur)'}` : 'Asnjë numër WhatsApp i lidhur për dërgim'}
            {result.coldWaEnabled === false ? ' · mesazhet e ftohta janë ende të fikura' : ''}
          </p>
          <pre className="whitespace-pre-wrap text-sm rounded-md bg-muted p-3 font-sans">{result.text}</pre>
        </div>
      )}
    </div>
  );
}
