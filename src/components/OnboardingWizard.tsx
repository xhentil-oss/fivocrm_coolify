import React, { useState } from 'react';
import { CheckCircle2, ArrowRight, Users, LayoutDashboard, Briefcase, ListChecks } from 'lucide-react';
import { Card } from './ui/card';
import { Button } from './ui/button';

interface OnboardingWizardProps {
  userName?: string;
  onComplete: () => void;
}

const steps = [
  {
    icon: Users,
    title: 'Mirë se vini në FivoCRM!',
    description: 'Platforma juaj e plotë për menaxhimin e biznesit. Le t\'ju tregojmë si funksionon.',
    tip: 'Mund të ftoni anëtarë të ekipit tuaj nga Cilësimet > Ekipi.',
  },
  {
    icon: Briefcase,
    title: 'Krijoni Projektin e Parë',
    description: 'Organizoni punën tuaj në projekte. Çdo projekt ka detyra, afate, dhe anëtarë.',
    tip: 'Shkoni te "Projekte" në menunë anësore dhe klikoni "Projekt i Ri".',
  },
  {
    icon: ListChecks,
    title: 'Menaxhoni Detyrat',
    description: 'Krijoni, caktoni dhe ndiqni detyrat me tabelën Kanban ose listë.',
    tip: 'Tërhiqni dhe lëshoni kartelat në tabelën Kanban për të ndryshuar statusin.',
  },
  {
    icon: LayoutDashboard,
    title: 'Eksploroni Panelin',
    description: 'Faturat, klientët, shpenzimet, raportet — gjithçka në një vend.',
    tip: 'Përdorni Command Palette (Ctrl+K) për lundrimin e shpejtë.',
  },
];

const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ userName, onComplete }) => {
  const [step, setStep] = useState(0);
  const current = steps[step];
  const Icon = current.icon;
  const isLast = step === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <Card className="w-full max-w-lg p-8 space-y-6 shadow-2xl">
        {/* Progress dots */}
        <div className="flex justify-center gap-2">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all ${
                i === step ? 'w-8 bg-primary' : i < step ? 'w-2 bg-primary/60' : 'w-2 bg-muted'
              }`}
            />
          ))}
        </div>

        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Icon className="w-8 h-8 text-primary" />
          </div>
        </div>

        {/* Content */}
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold">
            {step === 0 && userName ? `${current.title.replace('!', `, ${userName}!`)}` : current.title}
          </h2>
          <p className="text-muted-foreground">{current.description}</p>
        </div>

        {/* Tip */}
        <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">💡 Këshillë: </span>
          {current.tip}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep(s => s - 1)}>
              Mbrapa
            </Button>
          ) : (
            <Button variant="ghost" onClick={onComplete}>
              Kalo
            </Button>
          )}

          <Button onClick={() => {
            if (isLast) {
              onComplete();
            } else {
              setStep(s => s + 1);
            }
          }}>
            {isLast ? (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Fillo
              </>
            ) : (
              <>
                Tjetër
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default OnboardingWizard;
