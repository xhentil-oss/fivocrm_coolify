import React from 'react';
import { useDocument } from '../hooks/useFirestore';
import { usePermissions } from '../contexts/PermissionsContext';
import { getInquirySections, getInquiryCompleteness, canSeeInquiryPricing } from '../lib/inquiryBrief';
import { Badge } from './ui/badge';
import { ClipboardList, ChevronDown, AlertTriangle, AlertCircle, Image as ImageIcon, FileText, ExternalLink } from 'lucide-react';
import type { ServiceInquiry } from '../types';

/**
 * Kartë për staff-in te faqja e projektit: shfaq të dhënat që klienti plotësoi
 * në anketë (ServiceInquiry) kur kërkesa u konvertua në projekt. Merr të dhënat
 * nga anketa e lidhur (`project.sourceQuestionnaireId`) — burim gjithmonë i saktë.
 */
const ProjectClientBrief: React.FC<{ inquiryId?: string }> = ({ inquiryId }) => {
  const [open, setOpen] = React.useState(true);
  const permissions = usePermissions();
  const { data: inquiry, loading } = useDocument<ServiceInquiry>('serviceInquiries', inquiryId || '');

  if (!inquiryId || loading || !inquiry) return null;

  // Pjesa e çmimit shihet vetëm nga Admin/SuperAdmin/SalesAgent.
  const { urgent, sections } = getInquirySections(inquiry, { includePricing: canSeeInquiryPricing(permissions) });
  const completeness = getInquiryCompleteness(inquiry);
  const logoUrl = inquiry.logoUrl;
  const materialFiles = inquiry.materialFiles || [];
  const isImg = (n: string, u: string) => /\.(png|jpe?g|gif|webp|svg|bmp)/i.test(n) || /\.(png|jpe?g|gif|webp|svg|bmp)/i.test(u);

  if (sections.length === 0 && !logoUrl && materialFiles.length === 0) return null;

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
            {completeness.missing.length > 0 && (
              <Badge className="bg-amber-100 text-amber-800 gap-1 rounded-full text-[11px] dark:bg-amber-950/40 dark:text-amber-300">
                {completeness.missing.length} pa dërguar
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Të dhënat që plotësoi klienti gjatë kërkesës</p>
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-5">
          {/* Ende pa dërguar nga klienti */}
          {completeness.missing.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:bg-amber-950/20 dark:border-amber-800/40">
              <p className="text-xs font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5 mb-2">
                <AlertCircle className="h-3.5 w-3.5" /> Klienti nuk ka dërguar akoma
              </p>
              <ol className="space-y-1.5">
                {completeness.missing.map((m, i) => (
                  <li key={m.key} className="text-sm text-amber-900 dark:text-amber-200 flex items-center gap-2">
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-amber-200 text-[11px] font-bold text-amber-800 dark:bg-amber-800/50 dark:text-amber-200">{i + 1}</span>
                    {m.label}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Logo */}
          {logoUrl && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5"><ImageIcon className="h-3.5 w-3.5" /> Logo</p>
              <a href={logoUrl} target="_blank" rel="noopener noreferrer">
                <img src={logoUrl} alt="Logo e biznesit" className="h-16 rounded-lg border bg-white object-contain p-1" />
              </a>
            </div>
          )}

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

          {/* Foto & materiale të ngarkuara */}
          {materialFiles.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5"><ImageIcon className="h-3.5 w-3.5" /> Foto & materiale</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {materialFiles.map((f, i) => (
                  <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" className="group rounded-lg border bg-muted/20 overflow-hidden" title={f.name}>
                    {isImg(f.name, f.url) ? (
                      <img src={f.url} alt={f.name} className="h-20 w-full object-cover" />
                    ) : (
                      <div className="h-20 w-full flex flex-col items-center justify-center gap-1 text-muted-foreground">
                        <FileText className="h-5 w-5" />
                        <span className="text-[10px] px-1 truncate max-w-full">{f.name}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1 px-1.5 py-1 text-[10px] text-muted-foreground group-hover:text-primary">
                      <ExternalLink className="h-3 w-3 flex-shrink-0" /><span className="truncate">{f.name}</span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectClientBrief;
