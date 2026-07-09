import type { ServiceInquiry } from '../types';

/**
 * Burim i VETËM i të dhënave për brief-in e një anketë (ServiceInquiry):
 * - `getInquirySections()` kthen seksionet e strukturuara (të përdorura nga karta
 *   e projektit për staff-in).
 * - `buildProjectDescription()` i kompozon ato në Markdown për `project.description`
 *   ose `lead.notes`.
 *
 * Rregullat: fushat boshe anashkalohen; array-t bëhen lista; seksioni "Pyetje
 * Specifike" gjenerohet DINAMIKISHT sipas `servicesInterestedIn` (pa hardcode).
 */

export interface BriefRow { label: string; value: string | string[]; }
export interface BriefSection { title: string; rows: BriefRow[]; }
export interface InquiryBrief { urgent: boolean; sections: BriefSection[]; }

// Vlerat "Po"/true i konsiderojmë pozitive.
const isTruthy = (v: unknown): boolean =>
  v === true || v === 'Po' || v === 'po' || v === 'yes' || v === 'true';

// Kthen true nëse vlera është realisht bosh.
const isEmpty = (v: unknown): boolean =>
  v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

// Ndërton një rresht nëse vlera s'është bosh.
const mk = (label: string, value: unknown): BriefRow | null =>
  isEmpty(value) ? null : { label, value: value as string | string[] };

const section = (title: string, rows: (BriefRow | null)[]): BriefSection | null => {
  const kept = rows.filter(Boolean) as BriefRow[];
  return kept.length ? { title, rows: kept } : null;
};

/**
 * Përkufizimi i seksioneve specifike sipas shërbimit. `match` përputhet
 * (case-insensitive, substring) me stringjet e `servicesInterestedIn`.
 */
interface ServiceSection {
  match: string[];
  header: string;
  fields: Array<[keyof ServiceInquiry, string]>;
}

const SERVICE_SECTIONS: ServiceSection[] = [
  {
    match: ['web', 'faqe', 'website', 'site'],
    header: 'Web Design',
    fields: [
      ['web_hasExistingWebsite', 'Website ekzistues'],
      ['web_existingWebsiteLink', 'Linku ekzistues'],
      ['web_mainPurpose', 'Qëllimi kryesor'],
      ['web_estimatedPages', 'Numri i faqeve'],
      ['web_hasTextsAndPhotos', 'Tekste & foto gati'],
      ['web_features', 'Funksionalitete'],
      ['web_websitesYouLike', 'Referenca / faqe që pëlqen'],
    ],
  },
  {
    match: ['social', 'smm', 'instagram', 'facebook'],
    header: 'Social Media',
    fields: [
      ['smm_mainPlatforms', 'Platformat kryesore'],
      ['smm_organicOrAds', 'Organik apo reklama'],
      ['smm_hasContent', 'Ka përmbajtje'],
      ['smm_postingFrequency', 'Frekuenca e postimeve'],
      ['smm_toneOfCommunication', 'Toni i komunikimit'],
      ['smm_contentTypes', 'Llojet e përmbajtjes'],
    ],
  },
  {
    match: ['ads', 'reklama', 'paid', 'google ads', 'meta ads'],
    header: 'Reklama me Pagesë',
    fields: [
      ['ads_platforms', 'Platformat'],
      ['ads_mainConversionAction', 'Veprimi kryesor i konvertimit'],
      ['ads_monthlyBudget', 'Buxheti mujor i reklamave'],
      ['ads_hasRunAdsBefore', 'Ka pasur reklama më parë'],
      ['ads_pastResults', 'Rezultatet e mëparshme'],
      ['ads_hasLandingPage', 'Ka landing page'],
    ],
  },
  {
    match: ['seo'],
    header: 'SEO',
    fields: [
      ['seo_hasWebsite', 'Ka website'],
      ['seo_websitePlatform', 'Platforma e website-it'],
      ['seo_targetKeywords', 'Fjalët kyçe të synuara'],
      ['seo_targetMarket', 'Tregu i synuar'],
      ['seo_hasDoneSEO', 'Ka bërë SEO më parë'],
      ['seo_competitors', 'Konkurrentët'],
    ],
  },
  {
    match: ['brand', 'logo'],
    header: 'Branding',
    fields: [
      ['brand_hasExistingLogo', 'Ka logo ekzistuese'],
      ['brand_whatYouNeed', 'Çfarë nevojitet'],
      ['brand_coreValues', 'Vlerat thelbësore'],
      ['brand_targetAudience', 'Audienca e synuar'],
      ['brand_competitors', 'Konkurrentët'],
      ['brand_preferredStyle', 'Stili i preferuar'],
    ],
  },
  {
    match: ['content', 'përmbajtje', 'permbajtje'],
    header: 'Krijim Përmbajtjeje',
    fields: [
      ['content_types', 'Llojet e përmbajtjes'],
      ['content_platforms', 'Platformat'],
      ['content_frequency', 'Frekuenca'],
      ['content_hasModels', 'Ka modele'],
      ['content_visualStyle', 'Stili vizual'],
    ],
  },
  {
    match: ['commerce', 'e-commerce', 'ecommerce', 'dyqan', 'shop'],
    header: 'E-commerce',
    fields: [
      ['ecom_platform', 'Platforma'],
      ['ecom_productsCount', 'Numri i produkteve'],
      ['ecom_hasInventory', 'Ka inventar'],
      ['ecom_paymentMethods', 'Metodat e pagesës'],
      ['ecom_shippingNeeds', 'Nevojat e transportit'],
      ['ecom_hasProductPhotos', 'Ka foto produktesh'],
      ['ecom_productCategories', 'Kategoritë e produkteve'],
    ],
  },
];

/** Kthen seksionet e strukturuara të anketës (vetëm fushat jo-bosh). */
export function getInquirySections(inquiry: ServiceInquiry): InquiryBrief {
  const q = inquiry as ServiceInquiry & Record<string, any>;
  const sections: BriefSection[] = [];

  // 1. Informacion Bazë
  const basic = section('Informacion Bazë', [
    mk('Biznesi', q.businessName),
    mk('Industria', q.industry),
    mk('Kontakti', [q.contactName, q.jobTitle].filter(Boolean).join(' — ') || null),
    mk('Email', q.email),
    mk('Telefon', q.phoneNumber),
    mk('Qyteti / Tregu', q.cityMarket),
    mk('Website', q.website),
    mk('Historiku i biznesit', q.businessDescription),
    mk('Instagram', q.instagramLink),
    mk('Facebook', q.facebookLink),
    mk('TikTok', q.tiktokLink),
    mk('LinkedIn', q.linkedinLink),
  ]);
  if (basic) sections.push(basic);

  // 1b. Shërbimet e biznesit (katalogu i vetë klientit: titull + përshkrim)
  const bServices = Array.isArray(q.businessServices)
    ? q.businessServices.filter((s: any) => s && (String(s.title || '').trim() || String(s.description || '').trim()))
    : [];
  if (bServices.length) {
    sections.push({
      title: 'Shërbimet e biznesit',
      rows: bServices.map((s: any) => ({
        label: String(s.title || '').trim() || 'Shërbim',
        value: String(s.description || '').trim() || '—',
      })),
    });
  }

  // 2. Shërbimi & Objektivi
  const goal = section('Shërbimi & Objektivi', [
    mk('Shërbimet', q.servicesInterestedIn),
    mk('Objektivi kryesor', q.mainGoal),
    mk('Nevoja / përshkrimi', q.projectNeedDescription),
    mk('Sfida aktuale', q.currentMainChallenge),
    mk('Punë e mëparshme me agjenci', q.hasWorkedWithAgency),
    mk('Çfarë keni provuar', q.whatHaveYouTried),
  ]);
  if (goal) sections.push(goal);

  // 3. Pyetje Specifike (dinamike sipas shërbimeve)
  const selected = Array.isArray(q.servicesInterestedIn) ? q.servicesInterestedIn : [];
  const used = new Set<string>();
  for (const svc of selected) {
    const key = String(svc).toLowerCase();
    const svcSec = SERVICE_SECTIONS.find(s => s.match.some(m => key.includes(m)));
    if (!svcSec || used.has(svcSec.header)) continue;
    const sec = section(svcSec.header, svcSec.fields.map(([f, label]) => mk(label, q[f as string])));
    if (sec) { used.add(svcSec.header); sections.push(sec); }
  }

  // 4. Buxheti & Materialet
  const budget = section('Buxheti & Materialet', [
    mk('Buxheti', q.budgetRange),
    mk('Afati', q.timeline),
    mk('Urgjente', isTruthy(q.isUrgent) ? 'Po' : (q.isUrgent ? String(q.isUrgent) : null)),
    mk('Vendimmarrësi', q.decisionMaker),
    mk('Kontakti i preferuar', q.preferredContactMethod),
    mk('Materiale ekzistuese', q.hasExistingMaterials),
    mk('Materialet përfshijnë', q.folderIncludes),
    mk('Brand guidelines', q.hasBrandGuidelines),
    mk('Google Drive', q.googleDriveLink),
    mk('Logo', isEmpty(q.logoUrl) ? null : 'E ngarkuar ✓'),
    mk('Foto/materiale të ngarkuara', Array.isArray(q.materialFiles) ? q.materialFiles.map((f: any) => f?.name).filter(Boolean) : null),
  ]);
  if (budget) sections.push(budget);

  return { urgent: isTruthy(q.isUrgent), sections };
}

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** Kompozon anketën në një brief Markdown (për project.description / lead.notes). */
export function buildProjectDescription(inquiry: ServiceInquiry, opts?: { now?: Date }): string {
  const { urgent, sections } = getInquirySections(inquiry);
  const now = opts?.now || new Date();
  const parts: string[] = [`_Brief i gjeneruar automatikisht nga anketa — ${formatDate(now)}_`];
  if (urgent) parts.push('**⚠️ URGJENTE**');

  // Seksionet e para dy + budget janë "##"; seksionet specifike të shërbimeve i
  // grupojmë nën "## Pyetje Specifike" me nën-tituj "###".
  const topLevel = new Set(['Informacion Bazë', 'Shërbimi & Objektivi', 'Buxheti & Materialet']);
  const specific = sections.filter(s => !topLevel.has(s.title));

  const renderRows = (rows: BriefRow[]) =>
    rows.map(r => Array.isArray(r.value)
      ? `- **${r.label}:**\n${r.value.map(v => `  - ${v}`).join('\n')}`
      : `- **${r.label}:** ${r.value}`).join('\n');

  for (const s of sections.filter(s => topLevel.has(s.title))) {
    // Ruaj renditjen logjike: bazë → objektiv → (specifike) → buxhet
    if (s.title === 'Buxheti & Materialet' && specific.length) {
      parts.push(`## Pyetje Specifike\n${specific.map(sp => `### ${sp.title}\n${renderRows(sp.rows)}`).join('\n\n')}`);
    }
    parts.push(`## ${s.title}\n${renderRows(s.rows)}`);
  }

  return parts.join('\n\n');
}

/** Bashkëngjit një brief poshtë një përshkrimi ekzistues pa e mbishkruar. */
export function appendBrief(existing: string | undefined, brief: string): string {
  if (!existing || !existing.trim()) return brief;
  return `${existing}\n\n--- Përditësim nga anketa ---\n\n${brief}`;
}

/**
 * Plotësimi i anketës: kontrollon të dhënat "e buta" por të vlefshme që klientët
 * shpesh i lënë bosh (logo, foto, shërbimet e biznesit...). Përdoret në CRM për
 * t'i treguar ekipit "çfarë s'ka dërguar akoma klienti".
 */
export interface CompletenessItem { key: string; label: string; done: boolean; }

export function getInquiryCompleteness(inquiry: ServiceInquiry): {
  items: CompletenessItem[];
  missing: CompletenessItem[];
  filled: number;
  total: number;
  percent: number;
} {
  const q = inquiry as ServiceInquiry & Record<string, any>;

  const hasServices = Array.isArray(q.businessServices)
    && q.businessServices.some((s: any) => s && String(s.title || '').trim());
  const hasMaterials = (Array.isArray(q.materialFiles) && q.materialFiles.length > 0)
    || !isEmpty(q.googleDriveLink)
    || (Array.isArray(q.folderIncludes) && q.folderIncludes.length > 0);
  const hasSocial = !isEmpty(q.instagramLink) || !isEmpty(q.facebookLink)
    || !isEmpty(q.tiktokLink) || !isEmpty(q.linkedinLink);

  const items: CompletenessItem[] = [
    { key: 'logo', label: 'Logo e biznesit', done: !isEmpty(q.logoUrl) },
    { key: 'photos', label: 'Foto / materiale', done: hasMaterials },
    { key: 'services', label: 'Shërbimet e biznesit', done: hasServices },
    { key: 'description', label: 'Përshkrimi i biznesit', done: !isEmpty(q.businessDescription) },
    { key: 'website', label: 'Website', done: !isEmpty(q.website) },
    { key: 'social', label: 'Rrjetet sociale', done: hasSocial },
  ];

  const missing = items.filter(i => !i.done);
  const filled = items.length - missing.length;
  return {
    items,
    missing,
    filled,
    total: items.length,
    percent: Math.round((filled / items.length) * 100),
  };
}
