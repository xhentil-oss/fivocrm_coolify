import React from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useClientPortal } from '../../hooks/useClientPortal';
import { usePortalTenant } from '../../hooks/usePortalTenant';
import { useAuth } from '../../contexts/AuthContext';
import { useCollection, useMutation, useDocument } from '../../hooks/useFirestore';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { ArrowLeft, CheckCircle2, ClipboardList, Info, TrendingUp, Loader2, Edit3 } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import ServiceQuestionnaireForm from '../../components/ServiceQuestionnaireForm';
import { getInquiryCompleteness } from '../../lib/inquiryBrief';
import type { ServiceInquiry, Notification } from '../../types';
import { notifyStaff } from '../../lib/notifyStaff';

/**
 * Faqja e anketës brenda Projekteve: /portal/projects/inquiry/:inquiryId
 * - Nëse kërkesa është 'Draft' → shfaq formularin (ServiceQuestionnaireForm) me ruajtje automatike.
 * - Pas dërgimit → shfaq përmbledhjen "Të dhënat e projektit" (read-only) + statusin.
 * Logjika e automatizimeve (Lead + Task + Notifications) është identike me atë
 * që ishte më parë te PortalServicesView.
 */
/** Nxjerr një vlerë të përafërt (në Lekë) nga një gamë buxheti tekst, sipas monedhës. */
const parseBudgetToAll = (range?: string, currency?: string): number => {
  if (!range) return 0;
  const nums = (range.match(/[\d.,]+/g) || [])
    .map(n => parseInt(n.replace(/[.,]/g, ''), 10))
    .filter(n => !Number.isNaN(n));
  if (nums.length === 0) return 0;
  const val = nums.length >= 2 ? Math.round((nums[0] + nums[1]) / 2) : nums[0];
  return currency === 'EUR' ? val * 100 : val;
};

const PortalInquiryView: React.FC = () => {
  const { inquiryId } = useParams<{ inquiryId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { customerId, businessId } = useClientPortal();
  const { tenantBusinessId } = usePortalTenant();
  const { toast } = useToast();

  const { data: inquiry, loading } = useDocument<ServiceInquiry>('serviceInquiries', inquiryId || '');
  const [editing, setEditing] = React.useState(false);

  const inquiryMutation = useMutation<ServiceInquiry>('serviceInquiries');
  const notificationMutation = useMutation<Notification>('notifications');
  // The portal never reads `teamMembers` (cross-tenant staff data). The follow-up
  // task + notifications are created server-side by /api/notify-staff, which assigns
  // them to sales staff of THIS client's business. The teamId for the lead comes from
  // the tenant we resolved (subdomain), not from an arbitrary member.
  const { tenantTeamId } = usePortalTenant();
  const resolvedTeamId = tenantTeamId || null;

  const createLeadAndAutomations = async (formData: any, id: string) => {
    if ((inquiry as any)?.leadId) return; // already converted

    const tags: string[] = [];
    if (formData.servicesInterestedIn.includes('Web Design')) tags.push('Web Design Lead');
    if (formData.servicesInterestedIn.includes('Social Media Marketing')) tags.push('SMM Lead');
    if (formData.servicesInterestedIn.includes('Paid Ads')) tags.push('Ads Lead');
    const estimatedValue = parseBudgetToAll(formData.budgetRange, formData.currency);
    if (estimatedValue >= 150000) tags.push('High Value Lead');
    if (formData.timeline === 'Menjëherë') tags.push('Urgent Lead');

    const leadData: Record<string, any> = {
      name: formData.contactName,
      email: formData.email,
      phoneNumber: formData.phoneNumber,
      company: formData.businessName,
      status: 'New',
      source: 'Service Questionnaire',
      estimatedValue,
      tags,
      notes: `Shërbime: ${formData.servicesInterestedIn.join(', ')}\nObjektivi: ${formData.mainGoal}\nBuxheti: ${formData.budgetRange}\nAfati: ${formData.timeline}\n\nPërshkrimi: ${formData.projectNeedDescription}\nSfida: ${formData.currentMainChallenge}`,
      serviceInquiryId: id,
      ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
      // Business-scoped CRM reads filter on businessId; without it the lead is invisible in /app/crm.
      // Use the REAL businessId from useClientPortal (never the teamId — that failed isBusinessMember).
      ...(businessId ? { businessId } : {}),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdByUserId: user?.uid || null,
    };
    if (formData.jobTitle) leadData.jobTitle = formData.jobTitle;
    if (formData.website) leadData.website = formData.website;
    const leadRef = await addDoc(collection(db, 'leads'), leadData);

    await inquiryMutation.update(id, { leadId: leadRef.id });

    const taskPriority = formData.timeline === 'Menjëherë' || formData.isUrgent === 'Po' ? 'urgent' : 'high';

    // The follow-up task + the "new lead" notifications are created SERVER-SIDE:
    // assigning the task needs the tenant's sales staff, and the portal must not read
    // `teamMembers` (that was a cross-tenant read of every business's staff records).
    // /api/notify-staff resolves both from this client's own customer → businessId.
    await notifyStaff({
      type: 'lead_created',
      title: 'Lead i Ri nga Pyetësori',
      message: `${formData.contactName} (${formData.businessName}) dorëzoi pyetësorin për: ${formData.servicesInterestedIn.join(', ')}`,
      actionUrl: '/app/crm',
      actionLabel: 'Shiko Lead-in',
      task: {
        title: `Kontakto lead: ${formData.contactName} (${formData.businessName})`,
        description: `Lead i ri nga pyetësori i shërbimeve.\n\nShërbime: ${formData.servicesInterestedIn.join(', ')}\nObjektivi: ${formData.mainGoal}\nBuxheti: ${formData.budgetRange}\nAfati: ${formData.timeline}\nKontakt: ${formData.email} / ${formData.phoneNumber}${formData.preferredContactMethod ? '\nMënyra e preferuar: ' + formData.preferredContactMethod : ''}`,
        priority: taskPriority,
        dueInDays: 1,
        leadId: leadRef.id,
      },
    });
  };

  const handleSubmit = async (formData: any) => {
    if (!inquiryId) return;
    const wasDraft = inquiry?.status === 'Draft';
    await inquiryMutation.update(inquiryId, {
      ...formData,
      status: wasDraft ? 'New' : (inquiry?.status || 'New'),
      isDraft: false,
      clientUserId: user?.uid || undefined,
    });
    if (wasDraft) await createLeadAndAutomations(formData, inquiryId);
    setEditing(false);
    toast({
      title: wasDraft ? 'Brief-i u dërgua me sukses!' : 'Brief-i u përditësua!',
      description: 'Ekipi ynë do t\'ju kontaktojë brenda 24 orëve.',
    });
    // Kërkesa (realtime) bëhet 'New' → komponenti kalon automatikisht te përmbledhja.
  };

  const handleDraftSave = React.useCallback(async (formData: any, step: number) => {
    if (!inquiryId) return;
    if (inquiry?.status === 'Draft') {
      await inquiryMutation.update(inquiryId, { ...formData, lastSavedStep: step, isDraft: true, status: 'Draft' });
    }
  }, [inquiryId, inquiry, inquiryMutation]);

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }

  if (!inquiry) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/portal/projects')} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Projektet
        </Button>
        <Card className="rounded-2xl"><CardContent className="py-12 text-center">
          <p className="text-muted-foreground">Brief-i nuk u gjet</p>
        </CardContent></Card>
      </div>
    );
  }

  const serviceTitle = (inquiry as any).serviceTitle || (inquiry.servicesInterestedIn?.[0]) || 'Brief-i i projektit';
  const isDraft = inquiry.status === 'Draft';

  const isConverted = inquiry.status === 'Converted';

  // ── Read-only summary (submitted, not editing) ──
  if (!isDraft && !editing) {
    const statusLabel = inquiry.status === 'Reviewed' ? 'Në shqyrtim' : inquiry.status === 'Converted' ? 'Konvertuar' : 'Në shqyrtim';
    return (
      <div className="space-y-6 max-w-3xl">
        <Link to="/portal/projects" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Projektet
        </Link>

        <div className="flex items-center gap-4 rounded-2xl border border-green-200 bg-green-50 p-5 dark:bg-green-950/20 dark:border-green-800/40">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-500 shadow-lg shadow-green-500/30">
            <CheckCircle2 className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            <h2 className="font-bold">Brief-i u dërgua me sukses!</h2>
            <p className="text-sm text-muted-foreground">Ekipi do të shqyrtojë të dhënat dhe do t'ju kontaktojë brenda 24 orëve.</p>
          </div>
          <Badge className="bg-yellow-100 text-yellow-800 rounded-full whitespace-nowrap">{statusLabel}</Badge>
        </div>

        {!isConverted && (() => {
          const c = getInquiryCompleteness(inquiry);
          if (c.missing.length === 0) return null;
          return (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:bg-amber-950/20 dark:border-amber-800/40">
              <p className="font-semibold text-amber-800 dark:text-amber-300">Dëshironi ta plotësoni edhe pak?</p>
              <p className="text-sm text-amber-900/80 dark:text-amber-200/80 mt-0.5 mb-3">
                S'është e detyrueshme, por sa më shumë të dimë, aq më mirë punojmë për ju. Mund të shtoni:
              </p>
              <div className="flex flex-wrap gap-2 mb-4">
                {c.missing.map(m => (
                  <Badge key={m.key} variant="outline" className="rounded-full border-amber-300 text-amber-800 dark:text-amber-200">{m.label}</Badge>
                ))}
              </div>
              <Button size="sm" className="gap-2 rounded-xl bg-brand-gradient text-white shadow-md shadow-primary/25 hover:opacity-95" onClick={() => setEditing(true)}>
                <Edit3 className="h-4 w-4" /> Plotëso tani
              </Button>
            </div>
          );
        })()}

        <Card className="rounded-2xl">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-4">
              <ClipboardList className="h-5 w-5 text-primary" />
              <h3 className="font-bold">Të dhënat e projektit</h3>
            </div>

            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Informacion bazë</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-6">
              <div><p className="text-xs text-muted-foreground">Biznesi</p><p className="text-sm font-semibold">{inquiry.businessName || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Kontakti</p><p className="text-sm font-semibold">{inquiry.contactName || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Industria</p><p className="text-sm font-semibold">{[(inquiry as any).industry, (inquiry as any).cityMarket].filter(Boolean).join(' · ') || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Website</p><p className="text-sm font-semibold">{(inquiry as any).website || '—'}</p></div>
            </div>

            {(inquiry as any).businessDescription && (
              <div className="mb-6">
                <p className="text-xs text-muted-foreground">Historiku i biznesit</p>
                <p className="text-sm leading-relaxed mt-0.5">{(inquiry as any).businessDescription}</p>
              </div>
            )}

            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Shërbimi & objektivi</p>
            <div className="flex flex-wrap gap-2 mb-2">
              {(inquiry.servicesInterestedIn || []).map(s => (
                <Badge key={s} variant="secondary" className="rounded-full">{s}</Badge>
              ))}
              {inquiry.mainGoal && <Badge variant="outline" className="rounded-full">Objektivi: {inquiry.mainGoal}</Badge>}
            </div>
            {inquiry.projectNeedDescription && (
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">{inquiry.projectNeedDescription}</p>
            )}

            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Buxheti & afati</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-muted/60 border p-3"><p className="text-xs text-muted-foreground">Buxheti</p><p className="text-sm font-bold font-mono">{inquiry.budgetRange || '—'}</p></div>
              <div className="rounded-xl bg-muted/60 border p-3"><p className="text-xs text-muted-foreground">Afati</p><p className="text-sm font-bold">{inquiry.timeline || '—'}</p></div>
              <div className="rounded-xl bg-muted/60 border p-3"><p className="text-xs text-muted-foreground">Materialet</p><p className="text-sm font-bold">{((inquiry as any).folderIncludes || []).join(', ') || '—'}</p></div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
            {isConverted ? 'Kjo kërkesë është konvertuar — kontaktoni ekipin për ndryshime.' : 'Mund t\'i editoni të dhënat derisa ekipi t\'i shqyrtojë.'}
          </p>
          <div className="flex items-center gap-2">
            {!isConverted && (
              <Button className="gap-2 rounded-xl bg-brand-gradient text-white shadow-md shadow-primary/25 hover:opacity-95" onClick={() => setEditing(true)}>
                <Edit3 className="h-4 w-4" /> Edito briefin
              </Button>
            )}
            <Button variant="outline" className="gap-2 rounded-xl" onClick={() => navigate('/portal/projects')}>
              <ArrowLeft className="h-4 w-4" /> Te Projektet
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Draft (fill) OR editing an already-submitted inquiry ──
  return (
    <div className="space-y-6 max-w-3xl">
      <button
        type="button"
        onClick={() => (editing ? setEditing(false) : navigate('/portal/projects'))}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {editing ? 'Anulo editimin' : 'Projektet'}
      </button>

      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-brand-gradient shadow-lg shadow-primary/30">
          <TrendingUp className="h-6 w-6 text-white" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{serviceTitle}</h1>
            <Badge className="bg-primary/10 text-primary rounded-full">{editing ? 'Duke edituar' : 'Brief i ri'}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {editing ? 'Ndryshoni të dhënat dhe ruani përditësimin.' : 'Plotësoni të dhënat e projektit për të vazhduar me propozimin'}
          </p>
        </div>
      </div>

      <Card className="rounded-2xl">
        <CardContent className="pt-6">
          <ServiceQuestionnaireForm
            key={inquiry.id}
            onSubmit={handleSubmit}
            prefillEmail={user?.email || ''}
            prefillName={user?.displayName || ''}
            initialDraft={{ ...inquiry, id: inquiry.id }}
            onDraftSave={editing ? undefined : handleDraftSave}
            isEditing={editing}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default PortalInquiryView;
