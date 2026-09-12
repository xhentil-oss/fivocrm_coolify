import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { HeartPulse } from 'lucide-react';
import { CLIENT_HEALTH_CLASSES, CLIENT_HEALTH_LABELS } from '../../lib/reporting/health';
import { computeCustomerHealth, type ClientHealthInputs } from '../../lib/reporting/clientHealthSignals';
import { cn } from '../../lib/utils';

interface Props extends ClientHealthInputs {
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Compact health score for a customer header. Computed live from data the
 * page already holds; the full factor breakdown lives on /app/client-health
 * (Pro reporting module — its ModuleGate does the upsell on click).
 */
const ClientHealthBadge: React.FC<Props> = ({ size = 'md', className, ...inputs }) => {
  const navigate = useNavigate();
  const health = useMemo(() => computeCustomerHealth(inputs), [inputs.customer, inputs.projects, inputs.invoices, inputs.requests, inputs.reports]); // eslint-disable-line react-hooks/exhaustive-deps
  const risk = health.topRisks[0];
  const tooltip = risk ? `${CLIENT_HEALTH_LABELS[health.category]} · për të përmirësuar: ${risk.label}` : CLIENT_HEALTH_LABELS[health.category];
  return (
    <button
      type="button"
      onClick={() => navigate('/app/client-health')}
      title={tooltip}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium transition-opacity hover:opacity-80',
        size === 'sm' ? 'text-[11px] px-1.5 py-px' : 'text-xs px-2 py-0.5',
        CLIENT_HEALTH_CLASSES[health.category],
        className,
      )}
    >
      <HeartPulse className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      <span className="tabular-nums">{health.score}</span>
      <span className="hidden sm:inline">· {CLIENT_HEALTH_LABELS[health.category]}</span>
    </button>
  );
};

export default ClientHealthBadge;
