import type { ServiceInquiry } from '../types';

/**
 * Kompozon të gjitha përgjigjet e një anwhete (ServiceInquiry) në një brief
 * Markdown të strukturuar, gati për t'u ruajtur te `project.description` ose
 * `lead.notes`, që ekipi ta shohë brief-in e plotë pa hapur anketën origjinale.
 *
 * Rregullat:
 * - 4 seksione me tituj `##`; fushat boshe anashkalohen.
 * - Fushat multi (array) shfaqen si lista me bullet.
 * - Seksioni 3 ("Pyetje Specifike") gjenerohet DINAMIKISHT sipas shërbimeve të
 *   zgjedhura te `servicesInterestedIn` — s'ka hardcode të shërbimeve në rrjedhë.
 * - Nëse `isUrgent` është "Po"/true, shtohet një shenjë ⚠️ URGJENTE në krye.
 */

// Vlerat "Po"/true i konsiderojmë pozitive.
const isTruthy = (v: unknown): boolean =>
  v === true || v === 'Po' || v === 'po' || v === 'yes' || v === 'true';

// Kthen true nëse vlera është realisht bosh (null/undefined/""/[] bosh).
const isEmpty = (v: unknown): boolean =>
  v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

// Një rresht `**Label:** value` — kthehet null nëse vlera është bosh.
const row = (label: string, value: unknown): string | null => {
  if (isEmpty(value)) return null;
  if (Array.isArray(value)) return `- **${label}:**\n${value.map(v => `  - ${v}`).join('\n')}`;
  return `- **${label}:** ${value}`;
};

// Bashkon rreshtat jo-bosh me newline.
const block = (...rows: (string | null)[]): string => rows.filter(Boolean).join('\n');

/**
 * Përkufizimi i seksioneve specifike sipas shërbimit. Çelësi `match` përputhet
 * (case-insensitive, substring) me stringjet e `servicesInterestedIn`, kështu që
 * "Web Design", "Faqe Web", "Website" etj. bien te i njëjti grup fushash.
 */
interface ServiceSection {
  match: string[];          // fjalë-kyçe që identifikojnë shërbimin
  header: string;           // titulli i nën-seksionit
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

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function buildProjectDescription(
  inquiry: ServiceInquiry,
  opts?: { now?: Date }
): string {
  const q = inquiry as ServiceInquiry & Record<string, any>;
  const now = opts?.now || new Date();
  const parts: string[] = [];

  // ── Meta + shenja urgjence ──
  parts.push(`_Brief i gjeneruar automatikisht nga anketa — ${formatDate(now)}_`);
  if (isTruthy(q.isUrgent)) parts.push('**⚠️ URGJENTE**');

  // ── 1. Informacion Bazë ──
  const socials = block(
    row('Instagram', q.instagramLink),
    row('Facebook', q.facebookLink),
    row('TikTok', q.tiktokLink),
    row('LinkedIn', q.linkedinLink),
  );
  const basic = block(
    row('Biznesi', q.businessName),
    row('Industria', q.industry),
    row('Kontakti', [q.contactName, q.jobTitle].filter(Boolean).join(' — ') || null),
    row('Email', q.email),
    row('Telefon', q.phoneNumber),
    row('Qyteti / Tregu', q.cityMarket),
    row('Website', q.website),
  );
  if (basic || socials) {
    parts.push(`## Informacion Bazë\n${[basic, socials].filter(Boolean).join('\n')}`);
  }

  // ── 2. Shërbimi & Objektivi ──
  const serviceGoal = block(
    row('Shërbimet', q.servicesInterestedIn),
    row('Objektivi kryesor', q.mainGoal),
    row('Nevoja / përshkrimi', q.projectNeedDescription),
    row('Sfida aktuale', q.currentMainChallenge),
    row('Punë e mëparshme me agjenci', q.hasWorkedWithAgency),
    row('Çfarë keni provuar', q.whatHaveYouTried),
  );
  if (serviceGoal) parts.push(`## Shërbimi & Objektivi\n${serviceGoal}`);

  // ── 3. Pyetje Specifike (dinamike sipas shërbimeve) ──
  const selected = Array.isArray(q.servicesInterestedIn) ? q.servicesInterestedIn : [];
  const usedHeaders = new Set<string>();
  const specificBlocks: string[] = [];
  for (const svc of selected) {
    const key = String(svc).toLowerCase();
    const section = SERVICE_SECTIONS.find(s => s.match.some(m => key.includes(m)));
    if (!section || usedHeaders.has(section.header)) continue;
    const rows = section.fields.map(([field, label]) => row(label, q[field as string]));
    const body = block(...rows);
    if (body) {
      usedHeaders.add(section.header);
      specificBlocks.push(`### ${section.header}\n${body}`);
    }
  }
  if (specificBlocks.length) parts.push(`## Pyetje Specifike\n${specificBlocks.join('\n\n')}`);

  // ── 4. Buxheti & Materialet ──
  const budget = block(
    row('Buxheti', q.budgetRange),
    row('Afati', q.timeline),
    row('Urgjente', isTruthy(q.isUrgent) ? 'Po' : (q.isUrgent ? String(q.isUrgent) : null)),
    row('Vendimmarrësi', q.decisionMaker),
    row('Kontakti i preferuar', q.preferredContactMethod),
    row('Materiale ekzistuese', q.hasExistingMaterials),
    row('Materialet përfshijnë', q.folderIncludes),
    row('Brand guidelines', q.hasBrandGuidelines),
    row('Google Drive', q.googleDriveLink),
  );
  if (budget) parts.push(`## Buxheti & Materialet\n${budget}`);

  return parts.join('\n\n');
}

/**
 * Bashkëngjit një brief të ri poshtë një përshkrimi ekzistues pa e mbishkruar.
 * Përdoret kur `project.description` ekziston tashmë.
 */
export function appendBrief(existing: string | undefined, brief: string): string {
  if (!existing || !existing.trim()) return brief;
  return `${existing}\n\n--- Përditësim nga anketa ---\n\n${brief}`;
}
