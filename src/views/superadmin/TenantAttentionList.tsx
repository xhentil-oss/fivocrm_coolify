import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';
import { Card } from '../../components/ui/card';
import type { AttentionItem } from '../../lib/platformAdmin';

/**
 * The operator's work queue.
 *
 * A status column tells you what a tenant IS; this tells you what to DO. The ranking
 * is deliberate: a tenant that still pays but stopped using the product outranks a
 * trial that never started, because that is the revenue actually at risk.
 */
const TenantAttentionList: React.FC<{ items: AttentionItem[] }> = ({ items }) => {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;

  const high = items.filter(i => i.severity === 'high').length;
  const shown = open ? items.slice(0, 8) : [];

  return (
    <Card className="p-4 mb-5 border-amber-300/60 dark:border-amber-800/60">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 text-left"
        aria-expanded={open}
      >
        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
        <span className="text-sm font-semibold">Kërkojnë veprim</span>
        <span className="text-xs text-muted-foreground">
          {items.length} tenantë{high ? ` · ${high} urgjent` : ''}
        </span>
        <span className="ml-auto text-muted-foreground">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {open && (
        <div className="mt-3 divide-y divide-border/60">
          {shown.map(item => (
            <Link
              key={`${item.businessId}-${item.reason}`}
              to={`/superadmin/tenants/${item.businessId}`}
              className="flex items-center gap-2 py-2 group"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                  item.severity === 'high' ? 'bg-red-500' : 'bg-amber-500'
                }`}
              />
              <span className="text-sm font-medium truncate max-w-[40%]">{item.name}</span>
              <span className="text-xs text-muted-foreground truncate flex-1">{item.reason}</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
            </Link>
          ))}
          {items.length > shown.length && (
            <p className="pt-2 text-xs text-muted-foreground">
              +{items.length - shown.length} të tjerë — renditi listën sipas “Më të qetët”.
            </p>
          )}
        </div>
      )}
    </Card>
  );
};

export default TenantAttentionList;
