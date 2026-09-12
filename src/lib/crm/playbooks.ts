// ── Follow-up PLAYBOOKS: label (service interest) → cadence steps → templates ──
//
// Salesforce calls this "Product Interest + Sales Cadence": the interest a lead
// expressed ("SEO") picks a playbook, the playbook says WHEN to touch them
// (day offsets), on WHICH channel, and WITH WHAT text. Enrolment writes the
// existing cadence fields on the lead (`cadenceActive/cadenceStartedAt/
// cadenceStep`) plus `playbookId`; the `lead-cadence-steps` cron then creates the
// step's task WITH the rendered text and sets the lead's next step so the
// Ndjekjet queue shows the right primary action.
//
// Dependency-free on purpose: `api/_playbooks.ts` is a BYTE-IDENTICAL copy
// (`playbooks.test.ts` reads both files) — `api/` never imports `src/`.

export type PlaybookChannel = 'call' | 'whatsapp' | 'email' | 'meeting' | 'other';

export interface PlaybookStep {
  /** Days after enrolment (0 = same day). */
  day: number;
  channel: PlaybookChannel;
  /** Short task title, e.g. "Telefonatë kualifikimi". */
  title: string;
  /** Message text with tokens {{firstName}} {{name}} {{company}} {{service}} {{staffName}}. */
  template?: string;
}

export interface Playbook {
  id: string;
  /** Display name, e.g. "SEO". */
  name: string;
  /** The tag stamped on the lead (and matched against existing tags). */
  tag: string;
  /** Whole-word, accent-insensitive keywords that enrol an inbound lead. */
  keywords: string[];
  steps: PlaybookStep[];
  active: boolean;
  /** After the last step: how often (days) the nurture reminder should re-surface the lead. 0 = none. */
  nurtureEveryDays?: number;
}

export const PLAYBOOK_LIMITS = {
  maxPlaybooks: 20,
  maxSteps: 12,
  maxDay: 180,
  maxKeywords: 20,
  maxTemplateChars: 1000,
  maxNurtureDays: 365,
} as const;

export const PLAYBOOK_CHANNELS: PlaybookChannel[] = ['call', 'whatsapp', 'email', 'meeting', 'other'];

const CHANNEL_SET = new Set<string>(PLAYBOOK_CHANNELS);

function str(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function int(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r < min || r > max ? null : r;
}

/** Validate one playbook; returns null when it cannot be made valid. */
export function normalizePlaybook(raw: unknown): Playbook | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 64).replace(/[^A-Za-z0-9_-]/g, '');
  const name = str(r.name, 60);
  const tag = str(r.tag, 40);
  if (!id || !name || !tag) return null;

  const keywords = Array.from(new Set(
    (Array.isArray(r.keywords) ? r.keywords : [])
      .map(k => str(k, 40).toLowerCase())
      .filter(Boolean),
  )).slice(0, PLAYBOOK_LIMITS.maxKeywords);

  const seenDays = new Set<number>();
  const steps: PlaybookStep[] = [];
  for (const s of Array.isArray(r.steps) ? r.steps : []) {
    if (!s || typeof s !== 'object') continue;
    const so = s as Record<string, unknown>;
    const day = int(so.day, 0, PLAYBOOK_LIMITS.maxDay);
    const channel = str(so.channel, 20);
    const title = str(so.title, 120);
    if (day === null || !CHANNEL_SET.has(channel) || !title || seenDays.has(day)) continue;
    seenDays.add(day);
    const template = str(so.template, PLAYBOOK_LIMITS.maxTemplateChars);
    steps.push({ day, channel: channel as PlaybookChannel, title, ...(template ? { template } : {}) });
    if (steps.length >= PLAYBOOK_LIMITS.maxSteps) break;
  }
  steps.sort((a, b) => a.day - b.day);

  const nurture = int(r.nurtureEveryDays, 0, PLAYBOOK_LIMITS.maxNurtureDays);
  return {
    id, name, tag, keywords, steps,
    active: r.active !== false,
    ...(nurture ? { nurtureEveryDays: nurture } : {}),
  };
}

/** All valid playbooks from a teamSettings-shaped object (invalid entries dropped, duplicates by id dropped). */
export function resolvePlaybooks(settings: { followUpPlaybooks?: unknown } | null | undefined): Playbook[] {
  const raw = settings?.followUpPlaybooks;
  if (!Array.isArray(raw)) return [];
  const out: Playbook[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    const pb = normalizePlaybook(item);
    if (!pb || ids.has(pb.id)) continue;
    ids.add(pb.id);
    out.push(pb);
    if (out.length >= PLAYBOOK_LIMITS.maxPlaybooks) break;
  }
  return out;
}

/** Lower-case, accent-stripped (ë→e, ç→c, …), punctuation → space. */
export function normalizeKeywordText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does the keyword occur in the normalised text? Whole word for short keywords
 * ("seo" must not match "seoul"); for keywords of 5+ characters the LAST word may
 * carry an Albanian inflection ("reklama" → "reklamat", "reklamave"; "google ads"
 * → "google adsave" is harmless).
 */
export function keywordOccurs(normalizedText: string, keyword: string): boolean {
  const k = normalizeKeywordText(keyword);
  if (!k) return false;
  const suffix = k.length >= 5 ? '[a-z0-9]{0,4}' : '';
  return new RegExp(`(?:^| )${escapeRe(k)}${suffix}(?= |$)`).test(normalizedText);
}

/**
 * The first ACTIVE playbook whose keyword occurs in the text (see `keywordOccurs`).
 * Longer keywords win over shorter ones across playbooks ("google ads" beats "google").
 */
export function matchPlaybookByKeywords(text: string, playbooks: Playbook[]): Playbook | null {
  const hay = normalizeKeywordText(text);
  if (!hay) return null;
  let best: { pb: Playbook; len: number } | null = null;
  for (const pb of playbooks) {
    if (!pb.active) continue;
    for (const kw of pb.keywords) {
      const k = normalizeKeywordText(kw);
      if (!k) continue;
      if (keywordOccurs(hay, k) && (!best || k.length > best.len)) best = { pb, len: k.length };
    }
  }
  return best?.pb ?? null;
}

/** The first active playbook whose tag is already on the contact (case-insensitive). */
export function matchPlaybookByTags(tags: unknown, playbooks: Playbook[]): Playbook | null {
  if (!Array.isArray(tags)) return null;
  const set = new Set(tags.map(t => String(t).trim().toLowerCase()).filter(Boolean));
  for (const pb of playbooks) {
    if (pb.active && set.has(pb.tag.toLowerCase())) return pb;
  }
  return null;
}

export interface PlaybookRenderContext {
  firstName?: string | null;
  name?: string | null;
  company?: string | null;
  service?: string | null;
  staffName?: string | null;
}

/** Render {{tokens}}; an unknown token renders EMPTY (never leak `{{foo}}` to a customer). */
export function renderPlaybookTemplate(template: string, ctx: PlaybookRenderContext): string {
  const name = (ctx.name || '').trim();
  const values: Record<string, string> = {
    firstname: (ctx.firstName || name.split(/\s+/)[0] || '').trim(),
    name,
    company: (ctx.company || '').trim(),
    service: (ctx.service || '').trim(),
    staffname: (ctx.staffName || '').trim(),
  };
  return String(template || '')
    .replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_m, key: string) => values[key.toLowerCase()] ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export interface CadenceLeadFields {
  playbookId?: string | null;
  cadenceActive?: boolean | null;
  cadenceStep?: number | null;
  cadenceStartedAt?: unknown;
}

/** The step that fired most recently (what the salesperson should be doing now). */
export function currentPlaybookStep(lead: CadenceLeadFields, playbooks: Playbook[]): { playbook: Playbook; step: PlaybookStep; index: number } | null {
  if (!lead.playbookId) return null;
  const pb = playbooks.find(p => p.id === lead.playbookId);
  if (!pb) return null;
  const fired = Number(lead.cadenceStep) || 0;
  const index = fired - 1;
  if (index < 0 || index >= pb.steps.length) return null;
  return { playbook: pb, step: pb.steps[index], index };
}

/** The step the cron will fire next (null when the playbook is finished or not enrolled). */
export function nextPlaybookStep(lead: CadenceLeadFields, playbooks: Playbook[]): { playbook: Playbook; step: PlaybookStep; index: number } | null {
  if (!lead.playbookId || lead.cadenceActive === false) return null;
  const pb = playbooks.find(p => p.id === lead.playbookId);
  if (!pb) return null;
  const index = Number(lead.cadenceStep) || 0;
  if (index >= pb.steps.length) return null;
  return { playbook: pb, step: pb.steps[index], index };
}

/** Patch that enrols a lead into a playbook (restarts from step 0). */
export function enrollPlaybookPatch(pb: Playbook, now: Date): { playbookId: string; cadenceActive: true; cadenceStartedAt: Date; cadenceStep: 0 } {
  return { playbookId: pb.id, cadenceActive: true, cadenceStartedAt: now, cadenceStep: 0 };
}

/** Patch that stops any cadence (playbook or default) without forgetting which playbook it was. */
export function stopCadencePatch(): { cadenceActive: false } {
  return { cadenceActive: false };
}

/** Merge a playbook's tag into a tag list (case-insensitive, preserves order). */
export function withPlaybookTag(tags: unknown, pb: Playbook): string[] {
  const list = Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : [];
  if (list.some(t => t.toLowerCase() === pb.tag.toLowerCase())) return list;
  return [...list, pb.tag];
}

// ── Recipes (Albanian, agency services) ──────────────────────────────────────
// A recipe is a starting point the owner edits; nothing ships enabled by itself.

export const PLAYBOOK_RECIPES: Playbook[] = [
  {
    id: 'seo',
    name: 'SEO',
    tag: 'SEO',
    keywords: ['seo', 'google', 'renditje', 'kerkim', 'pozicionim', 'optimizim'],
    active: true,
    nurtureEveryDays: 30,
    steps: [
      { day: 1, channel: 'call', title: 'Telefonatë kualifikimi',
        template: 'Përshëndetje {{firstName}}, jam {{staffName}}. Ju shkruat për SEO — a keni 10 minuta sot që të kuptoj faqen tuaj dhe objektivat, që t\'ju përgatis një vlerësim konkret?' },
      { day: 3, channel: 'whatsapp', title: 'Dërgo mini-auditin SEO',
        template: 'Përshëndetje {{firstName}}, siç premtova, ju dërgoj një mini-audit të faqes suaj: 3 gjërat që po ju kushtojnë renditje sot dhe çfarë do të rregullonim në muajin e parë. Cila orë ju përshtatet për t\'i kaluar bashkë?' },
      { day: 7, channel: 'email', title: 'Dërgo ofertën SEO',
        template: 'Përshëndetje {{firstName}},\n\nJu dërgoj ofertën për SEO bazuar në bisedën tonë: paketa, çfarë përfshihet çdo muaj dhe rezultatet që synojmë në 3 dhe 6 muaj.\n\nJam në dispozicion për çdo pyetje.\n\n{{staffName}}' },
      { day: 10, channel: 'whatsapp', title: 'Ndjekje e ofertës',
        template: 'Përshëndetje {{firstName}}, a patët mundësi ta shihni ofertën për SEO? Nëse ka diçka që do ta përshtasnim (buxhet, fillim, fokus), më thoni dhe e rregullojmë.' },
      { day: 14, channel: 'call', title: 'Telefonatë vendimi',
        template: 'Përshëndetje {{firstName}}, po ju telefonoj për të mbyllur bisedën për SEO — a fillojmë këtë muaj, apo ka ende ndonjë pyetje që duhet t\'ju përgjigjem?' },
      { day: 21, channel: 'whatsapp', title: 'Objeksione / hera e fundit',
        template: 'Përshëndetje {{firstName}}, e kuptoj që koha është e ngushtë. Nëse SEO nuk është prioritet tani, më thoni thjesht "më vonë" dhe ju rikontaktoj pas 1 muaji — pa presion.' },
      { day: 30, channel: 'other', title: 'Mbyll: Fituar / Humbur / Nurture' },
    ],
  },
  {
    id: 'ads',
    name: 'Google / Meta Ads',
    tag: 'Ads',
    keywords: ['ads', 'reklama', 'reklame', 'google ads', 'meta ads', 'facebook ads', 'instagram ads', 'sponsorizim'],
    active: true,
    nurtureEveryDays: 30,
    steps: [
      { day: 1, channel: 'call', title: 'Telefonatë kualifikimi (buxhet, objektiv)',
        template: 'Përshëndetje {{firstName}}, jam {{staffName}}. Për reklamat më ndihmon të di: cili është objektivi (klientë, shitje, rezervime) dhe buxheti mujor që keni në mendje? Kështu ju propozoj strukturën e duhur.' },
      { day: 3, channel: 'whatsapp', title: 'Dërgo strukturë fushate + shembull rezultati',
        template: 'Përshëndetje {{firstName}}, ju dërgoj një strukturë fushate për {{company}} dhe një shembull rezultatesh nga një klient i ngjashëm. Kur e shohim bashkë?' },
      { day: 7, channel: 'email', title: 'Dërgo ofertën për Ads',
        template: 'Përshëndetje {{firstName}},\n\nBashkangjitur oferta për menaxhimin e reklamave: tarifa e menaxhimit, buxheti i rekomanduar për reklama dhe KPI-të që raportojmë çdo muaj.\n\n{{staffName}}' },
      { day: 10, channel: 'whatsapp', title: 'Ndjekje e ofertës',
        template: 'Përshëndetje {{firstName}}, a e shikuat ofertën për reklamat? Mund ta fillojmë me një muaj provë nëse preferoni.' },
      { day: 14, channel: 'call', title: 'Telefonatë vendimi' },
      { day: 21, channel: 'whatsapp', title: 'Hera e fundit',
        template: 'Përshëndetje {{firstName}}, nëse reklamat nuk janë prioritet tani, më thoni "më vonë" dhe ju rikontaktoj pas 1 muaji.' },
      { day: 30, channel: 'other', title: 'Mbyll: Fituar / Humbur / Nurture' },
    ],
  },
  {
    id: 'social',
    name: 'Social Media',
    tag: 'Social',
    keywords: ['social', 'instagram', 'facebook', 'tiktok', 'rrjete sociale', 'postime', 'reels', 'menaxhim rrjetesh'],
    active: true,
    nurtureEveryDays: 30,
    steps: [
      { day: 1, channel: 'call', title: 'Telefonatë kualifikimi',
        template: 'Përshëndetje {{firstName}}, jam {{staffName}}. Për rrjetet sociale: cilat platforma përdorni sot dhe çfarë doni të arrini (ndjekës, mesazhe, shitje)?' },
      { day: 3, channel: 'whatsapp', title: 'Dërgo shembuj përmbajtjeje',
        template: 'Përshëndetje {{firstName}}, ju dërgoj 3 shembuj postimesh/reels që kemi bërë për biznese si {{company}} dhe planin mujor tipik të përmbajtjes.' },
      { day: 7, channel: 'email', title: 'Dërgo ofertën Social',
        template: 'Përshëndetje {{firstName}},\n\nOferta për menaxhimin e rrjeteve sociale: numri i postimeve/reels në muaj, dizajni, raportimi.\n\n{{staffName}}' },
      { day: 10, channel: 'whatsapp', title: 'Ndjekje e ofertës' },
      { day: 14, channel: 'call', title: 'Telefonatë vendimi' },
      { day: 30, channel: 'other', title: 'Mbyll: Fituar / Humbur / Nurture' },
    ],
  },
  {
    id: 'web',
    name: 'Website',
    tag: 'Web',
    keywords: ['website', 'web', 'faqe interneti', 'site', 'landing', 'e-commerce', 'dyqan online'],
    active: true,
    nurtureEveryDays: 45,
    steps: [
      { day: 1, channel: 'call', title: 'Telefonatë: qëllimi i faqes, referenca, afati',
        template: 'Përshëndetje {{firstName}}, jam {{staffName}}. Për faqen: çfarë duhet të bëjë (prezantim, rezervime, shitje), keni referenca që ju pëlqejnë, dhe deri kur ju duhet?' },
      { day: 4, channel: 'whatsapp', title: 'Dërgo portofol + strukturë propozimi',
        template: 'Përshëndetje {{firstName}}, ju dërgoj 3 faqe nga portofoli ynë të ngjashme me atë që kërkoni dhe një strukturë të propozuar për {{company}}.' },
      { day: 7, channel: 'email', title: 'Dërgo ofertën për faqen',
        template: 'Përshëndetje {{firstName}},\n\nOferta për faqen tuaj: faza (dizajn, zhvillim, përmbajtje), afati dhe çmimi.\n\n{{staffName}}' },
      { day: 12, channel: 'whatsapp', title: 'Ndjekje e ofertës' },
      { day: 18, channel: 'call', title: 'Telefonatë vendimi' },
      { day: 30, channel: 'other', title: 'Mbyll: Fituar / Humbur / Nurture' },
    ],
  },
];

export function playbookRecipe(id: string): Playbook | null {
  const r = PLAYBOOK_RECIPES.find(p => p.id === id);
  return r ? JSON.parse(JSON.stringify(r)) as Playbook : null;
}
