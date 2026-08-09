import React from 'react';
import { usePermissions } from '../contexts/PermissionsContext';
import { getInquirySections, getInquiryCompleteness, canSeeInquiryPricing } from '../lib/inquiryBrief';
import { cn } from '../lib/utils';
import { AlertTriangle, FileText, Mail, ExternalLink } from 'lucide-react';
import type { ServiceInquiry } from '../types';

/**
 * Anketa e klientit (ServiceInquiry) e lidhur me projektin, si tab më vete.
 *
 * Kartela merr anketën si PROP — jo id-në: faqja e projektit e lexon vetë atë
 * dokument sepse badge-i i tab-it duhet të dijë sa fusha mungojnë PARA se tab-i
 * të hapet, dhe dy lexime të të njëjtit dokument do të ishin harxhim.
 */
const ProjectClientBrief: React.FC<{ inquiry: ServiceInquiry }> = ({ inquiry }) => {
  const permissions = usePermissions();

  // Pjesa e çmimit shihet vetëm nga Admin/SuperAdmin/SalesAgent.
  const { urgent, sections } = getInquirySections(inquiry, { includePricing: canSeeInquiryPricing(permissions) });
  const completeness = getInquiryCompleteness(inquiry);
  const logoUrl = inquiry.logoUrl;
  const materialFiles = inquiry.materialFiles || [];
  const isImg = (n: string, u: string) => /\.(png|jpe?g|gif|webp|svg|bmp)/i.test(n) || /\.(png|jpe?g|gif|webp|svg|bmp)/i.test(u);

  if (sections.length === 0 && !logoUrl && materialFiles.length === 0) {
    return (
      <p className="rounded-[20px] border border-dashed border-brand-line px-4 py-8 text-center text-[13px] text-brand-muted">
        Anketa e klientit është bosh.
      </p>
    );
  }

  // Logo dhe materialet janë e njëjta rrjetë miniaturash — logoja thjesht vjen e para.
  const files = [
    ...(logoUrl ? [{ name: 'Logo', url: logoUrl }] : []),
    ...materialFiles,
  ];

  const mailtoReminder = inquiry.email
    ? `mailto:${inquiry.email}?subject=${encodeURIComponent('Materialet që mungojnë')}&body=${encodeURIComponent(
        `Përshëndetje,\n\nPër të vazhduar me projektin na mungojnë ende:\n${completeness.missing.map((m, i) => `${i + 1}. ${m.label}`).join('\n')}\n\nFaleminderit!`,
      )}`
    : null;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
      <section className="rounded-[20px] border border-brand-line bg-white px-6 py-5 shadow-[0_1px_3px_rgba(8,24,58,.05)]">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div>
            <h2 className="text-[15px] font-extrabold text-brand-navy">Detajet nga anketa e klientit</h2>
            <p className="mt-0.5 text-[12.5px] text-brand-muted">Të dhënat që plotësoi klienti gjatë kërkesës.</p>
          </div>
          {urgent && (
            <span className="flex items-center gap-1.5 rounded-full bg-brand-neg-tint px-3 py-1 text-[11px] font-extrabold text-brand-neg-ink">
              <AlertTriangle className="h-3 w-3" />
              Urgjente
            </span>
          )}
        </div>

        {sections.map(sec => (
          <div key={sec.title} className="mt-5">
            <h3 className="border-b border-brand-line-soft pb-2 text-[11px] font-extrabold uppercase tracking-[.1em] text-brand-muted-2">
              {sec.title}
            </h3>
            <div className="mt-3 grid gap-x-6 gap-y-3.5 sm:grid-cols-2">
              {sec.rows.map(row => (
                <div key={row.label} className={cn('min-w-0', Array.isArray(row.value) && 'sm:col-span-2')}>
                  <p className="text-[11.5px] font-bold text-brand-muted-2">{row.label}</p>
                  {Array.isArray(row.value) ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {row.value.map((v, i) => (
                        <span key={i} className="rounded-full bg-brand-chip px-3 py-1 text-[11.5px] font-bold text-brand-chip-ink">
                          {v}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 break-words text-[13.5px] font-bold leading-[1.4] text-brand-ink">{row.value}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <div className="flex flex-col gap-4">
        {completeness.missing.length > 0 && (
          <section className="rounded-[20px] border border-brand-warn-line bg-brand-warn-tint px-5 py-5">
            <h3 className="flex items-center gap-2 text-[13px] font-extrabold text-brand-warn-ink">
              <AlertTriangle className="h-3.5 w-3.5" />
              Klienti nuk ka dërguar akoma
            </h3>
            <ol className="mt-3.5 flex flex-col gap-2.5">
              {completeness.missing.map((m, i) => (
                <li key={m.key} className="flex items-center gap-2.5">
                  <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-brand-warn-line text-[11px] font-extrabold text-brand-warn-ink">
                    {i + 1}
                  </span>
                  <span className="text-[13px] font-bold text-[#6d5312]">{m.label}</span>
                </li>
              ))}
            </ol>
            {mailtoReminder && (
              <a
                href={mailtoReminder}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-warn px-4 py-2.5 text-[12.5px] font-bold text-white transition-colors hover:bg-[#b8871a]"
              >
                <Mail className="h-3.5 w-3.5" />
                Kujtoje klientin
              </a>
            )}
          </section>
        )}

        {files.length > 0 && (
          <section className="rounded-[20px] border border-brand-line bg-white px-5 py-5 shadow-[0_1px_3px_rgba(8,24,58,.05)]">
            <h3 className="text-[13px] font-extrabold text-brand-navy">Logo &amp; materiale</h3>
            <div className="mt-3.5 grid grid-cols-2 gap-2.5">
              {files.map((f, i) => (
                <a
                  key={i}
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={f.name}
                  className="overflow-hidden rounded-xl border border-brand-line-soft transition-all hover:border-brand-blue hover:shadow-[0_4px_12px_rgba(8,24,58,.1)]"
                >
                  {isImg(f.name, f.url) ? (
                    <img src={f.url} alt={f.name} className="h-[62px] w-full bg-white object-contain p-1.5" />
                  ) : (
                    <div className="flex h-[62px] w-full items-center justify-center bg-brand-blue-tint text-brand-blue-hover">
                      <FileText className="h-5 w-5" />
                    </div>
                  )}
                  <div className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-brand-chip-ink">
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    <span className="truncate">{f.name}</span>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default ProjectClientBrief;
