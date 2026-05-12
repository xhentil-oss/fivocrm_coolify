import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Input } from './ui/input';
import { Trash2 } from 'lucide-react';

interface SignatureResult {
  type: 'drawn' | 'typed';
  data: string;
}

interface Props {
  onSign: (result: SignatureResult) => void;
  disabled?: boolean;
}

const SignaturePad: React.FC<Props> = ({ onSign, disabled }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const getCtx = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return ctx;
  };

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      const touch = e.touches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    setIsDrawing(true);
    lastPos.current = getPos(e, canvas);
  }, [disabled]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || disabled) return;
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx || !lastPos.current) return;
    e.preventDefault();
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
    setHasDrawn(true);
  }, [isDrawing, disabled]);

  const stopDraw = useCallback(() => {
    setIsDrawing(false);
    lastPos.current = null;
  }, []);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  // Resize canvas to maintain crisp resolution
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);
  }, [mode]);

  const handleConfirmDrawn = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;
    onSign({ type: 'drawn', data: canvas.toDataURL('image/png') });
  };

  const handleConfirmTyped = () => {
    if (!typedName.trim()) return;
    onSign({ type: 'typed', data: typedName.trim() });
  };

  return (
    <div className="space-y-3">
      <Tabs value={mode} onValueChange={(v) => setMode(v as 'draw' | 'type')}>
        <TabsList className="w-full">
          <TabsTrigger value="draw" className="flex-1">Vizato Firmën</TabsTrigger>
          <TabsTrigger value="type" className="flex-1">Shkruaj Emrin</TabsTrigger>
        </TabsList>

        <TabsContent value="draw" className="space-y-2 mt-3">
          <p className="text-xs text-muted-foreground">Vizato firmën tuaj me mouse ose gisht:</p>
          <div className="relative border-2 border-dashed border-border rounded-lg overflow-hidden bg-white">
            <canvas
              ref={canvasRef}
              className="w-full h-32 cursor-crosshair touch-none"
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={stopDraw}
              onMouseLeave={stopDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={stopDraw}
            />
            {!hasDrawn && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-xs text-muted-foreground/50">Firma këtu</p>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={clearCanvas} disabled={!hasDrawn || disabled}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Fshij
            </Button>
            <Button
              size="sm"
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              onClick={handleConfirmDrawn}
              disabled={!hasDrawn || disabled}
            >
              Konfirmo Firmën
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="type" className="space-y-2 mt-3">
          <p className="text-xs text-muted-foreground">Shkruani emrin tuaj të plotë si firmë:</p>
          <Input
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder="Emri i Plotë"
            className="font-serif text-lg h-12"
            disabled={disabled}
          />
          {typedName && (
            <div className="border rounded-lg p-3 bg-white text-center">
              <span className="font-serif text-2xl italic text-gray-800">{typedName}</span>
            </div>
          )}
          <Button
            size="sm"
            className="w-full bg-green-600 hover:bg-green-700 text-white"
            onClick={handleConfirmTyped}
            disabled={!typedName.trim() || disabled}
          >
            Konfirmo Firmën
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SignaturePad;
