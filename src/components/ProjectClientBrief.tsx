import React from 'react';
import { useDocument } from '../hooks/useFirestore';
import { getInquirySections } from '../lib/inquiryBrief';
import { Badge } from './ui/badge';
import { ClipboardList, ChevronDown, AlertTriangle } from 'lucide-react';
import type { ServiceInquiry } from '../types';

/**
 * Kartë për staff-in te faqja e projektit: shfaq të dhënat që klienti plotësoi
 * në anketë (ServiceInquiry) kur kërkesa u konvertua në projekt. Merr të dhënat
 * nga anketa e lidhur (`project.sourceQuestionnaireId`) — burim gjithmonë i saktë.
 */
const ProjectClientBrief: React.FC<{ inquiryId?: string }> = ({ inquiryId }) => {
  const [open, setOpen] = React.useState(true);
  const { data: inquiry, loading } = useDocument<ServiceInquiry>('serviceInquiries', inquiryId || '');

  if (!inquiryId || loading || !inquiry) return null;

  const { urgent, sections } = getInquirySections(inquiry);
  if (sections.length === 0) return null;

  return (
    <div className="mx-4 sm:mx-6 mb-4 rounded-2xl border border-primary/15 bg-gradient-to-b from-primary/[0.04] to-transparent overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <ClipboardList className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm">Detajet nga anketa e klientit</h3>
            {urgent && (
              <Badge className="bg-red-100 text-red-700 gap-1 rounded-full text-[11px] dark:bg-red-950/40 dark:text-red-300">
                <AlertTriangle className="h-3 w-3" /> Urgjente
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Të dhënat që plotësoi klienti gjatë kërkesës</p>
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-5">
          {sections.map(sec => (
            <div key={sec.title}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">{sec.title}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                {sec.rows.map(row => (
                  <div key={row.label} className={Array.isArray(row.value) ? 'sm:col-span-2' : ''}>
                    <p className="text-xs text-muted-foreground">{row.label}</p>
                    {Array.isArray(row.value) ? (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {row.value.map((v, i) => (
                          <Badge key={i} variant="secondary" className="rounded-full text-xs font-normal">{v}</Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm font-medium break-words">{row.value}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProjectClientBrief;
