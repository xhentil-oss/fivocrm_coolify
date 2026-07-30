/**
 * Block registry — what a report is made of.
 *
 * The builder UI, the PDF renderer, the portal renderer and the template seeder all
 * read this one table. Adding a block type means adding an entry here plus a case
 * in the renderers; nothing else in the module needs to know it exists.
 */

import type {
  ReportBlock,
  ReportBlockType,
  ReportTableColumn,
  ReportVisibility,
} from '../../types';

export interface BlockDef {
  type: ReportBlockType;
  label: string;
  /** One-line explanation shown in the "add block" palette. */
  hint: string;
  group: 'Strukturë' | 'Tekst' | 'Metrika' | 'Punë' | 'Rreziqe' | 'Media' | 'Aprovim';
  /** Lucide icon name, resolved by the builder. */
  icon: string;
  /** Sensible default when the block is dropped in. */
  defaults?: Partial<ReportBlock>;
  /** Only an Admin/Owner may add it (raw HTML). */
  adminOnly?: boolean;
  /** Never rendered in the client portal / PDF regardless of visibility. */
  neverClient?: boolean;
}

export const BLOCK_DEFS: BlockDef[] = [
  // ── Strukturë ──
  { type: 'title', label: 'Titull', hint: 'Titull seksioni.', group: 'Strukturë', icon: 'Heading1' },
  { type: 'subtitle', label: 'Nëntitull', hint: 'Nëntitull ose etiketë seksioni.', group: 'Strukturë', icon: 'Heading2' },
  { type: 'page-break', label: 'Ndërprerje faqe', hint: 'Fillon faqe të re në PDF.', group: 'Strukturë', icon: 'Scissors', defaults: { inPortal: false } },

  // ── Tekst ──
  { type: 'executive-summary', label: 'Përmbledhje ekzekutive', hint: 'Çfarë ndodhi, pse, dhe cila është vlera për biznesin.', group: 'Tekst', icon: 'FileText', defaults: { required: true } },
  { type: 'rich-text', label: 'Tekst', hint: 'Paragraf i lirë.', group: 'Tekst', icon: 'AlignLeft' },
  { type: 'recommendation', label: 'Rekomandime', hint: 'Çfarë propozojmë dhe pse.', group: 'Tekst', icon: 'Lightbulb' },
  { type: 'next-steps', label: 'Hapat e radhës', hint: 'Plani për periudhën tjetër.', group: 'Tekst', icon: 'ArrowRightCircle' },
  { type: 'client-action', label: 'Kërkohet nga klienti', hint: 'Aprovime, materiale, vendime që presim.', group: 'Tekst', icon: 'UserCheck', defaults: { visibility: 'client' } },

  // ── Metrika ──
  { type: 'kpi-cards', label: 'Karta KPI', hint: 'Vlerat kryesore për periudhën.', group: 'Metrika', icon: 'LayoutGrid' },
  { type: 'comparison-cards', label: 'Krahasim periudhash', hint: 'Kjo periudhë kundrejt të mëparshmes.', group: 'Metrika', icon: 'GitCompare', defaults: { comparePeriod: 'previous' } },
  { type: 'goal-vs-actual', label: 'Objektiv vs realitet', hint: 'Arritja ndaj targetit.', group: 'Metrika', icon: 'Target' },
  { type: 'chart', label: 'Grafik', hint: 'Trend i një ose më shumë KPI-ve.', group: 'Metrika', icon: 'LineChart', defaults: { chart: 'line' } },
  { type: 'funnel', label: 'Funnel', hint: 'Rruga nga impresione në konvertim.', group: 'Metrika', icon: 'Filter' },
  { type: 'progress', label: 'Progres', hint: 'Përqindje përfundimi.', group: 'Metrika', icon: 'Gauge', defaults: { progress: 0 } },
  { type: 'table', label: 'Tabelë', hint: 'Të dhëna me kolona (fjalë kyçe, fushata, faqe…).', group: 'Metrika', icon: 'Table' },

  // ── Punë ──
  { type: 'work-completed', label: 'Puna e kryer', hint: 'Lista e punës së dorëzuar.', group: 'Punë', icon: 'CheckCircle2', defaults: { source: 'auto:tasks' } },
  { type: 'task-list', label: 'Detyrat', hint: 'Detyra nga CRM për periudhën.', group: 'Punë', icon: 'ListChecks', defaults: { source: 'auto:tasks' } },
  { type: 'milestone-list', label: 'Milestone-t', hint: 'Milestone të përfunduar/vonuar.', group: 'Punë', icon: 'Flag', defaults: { source: 'auto:milestones' } },
  { type: 'timeline', label: 'Kronologji', hint: 'Ngjarjet kryesore me datë.', group: 'Punë', icon: 'GitBranch' },

  // ── Rreziqe ──
  { type: 'risk-register', label: 'Regjistri i rreziqeve', hint: 'Rreziqe, ndikim, masë zbutëse.', group: 'Rreziqe', icon: 'ShieldAlert' },
  { type: 'blocker-list', label: 'Bllokuesit', hint: 'Bllokues të raportuar nga ekipi.', group: 'Rreziqe', icon: 'AlertTriangle', defaults: { source: 'auto:blockers', visibility: 'internal' } },

  // ── Media ──
  { type: 'image', label: 'Imazh', hint: 'Screenshot ose vizual.', group: 'Media', icon: 'Image' },
  { type: 'gallery', label: 'Galeri', hint: 'Disa imazhe bashkë.', group: 'Media', icon: 'Images' },
  { type: 'video-link', label: 'Video', hint: 'Link Loom/YouTube për shpjegim.', group: 'Media', icon: 'Video' },
  { type: 'attachment', label: 'Dokument', hint: 'Bashkëngjitje (PDF, XLS…).', group: 'Media', icon: 'Paperclip' },

  // ── Aprovim ──
  { type: 'approval', label: 'Bllok aprovimi', hint: 'Kërkon vendim nga klienti.', group: 'Aprovim', icon: 'BadgeCheck', defaults: { visibility: 'client' } },
  { type: 'signature', label: 'Nënshkrim', hint: 'Hapësirë nënshkrimi në PDF.', group: 'Aprovim', icon: 'PenTool', defaults: { visibility: 'client' } },
  { type: 'custom-html', label: 'HTML i personalizuar', hint: 'Vetëm admin. Nuk publikohet te klienti.', group: 'Strukturë', icon: 'Code', adminOnly: true, neverClient: true, defaults: { visibility: 'internal', inPortal: false } },
];

export const BLOCK_DEF_BY_TYPE: Record<string, BlockDef> = Object.fromEntries(
  BLOCK_DEFS.map(d => [d.type, d]),
);

export function blockLabel(type: ReportBlockType): string {
  return BLOCK_DEF_BY_TYPE[type]?.label || type;
}

/**
 * Drop keys whose value is `undefined`, recursively.
 *
 * Firestore rejects `undefined` outright ("Unsupported field value: undefined").
 * `useMutation` sanitises for us, but `writeBatch`/`setDoc` and the Admin SDK do
 * NOT — and the seeder and the cron generator both use those. Since a block is a
 * bag of optional fields (`title`, `source`, `chart`, `columns`…), a template built
 * from a compact spec is full of `undefined` values, and every direct write of one
 * would throw.
 *
 * So the builders below emit Firestore-safe objects, rather than relying on each
 * call site to remember. `null` is preserved (Firestore accepts it and the module
 * uses it meaningfully, e.g. `deletedAt: null`), and class instances — `Date`, a
 * Firestore `Timestamp` — are passed through untouched. Deliberately implemented
 * without importing anything from `firebase`, which is what keeps this whole
 * directory unit-testable.
 */
export function stripUndefined<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(v => stripUndefined(v)) as unknown as T;
  if (typeof value !== 'object') return value;
  // Only descend into PLAIN objects; Date/Timestamp/etc. must survive intact.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = stripUndefined(v);
  }
  return out as T;
}

/**
 * Deterministic block id. `crypto.randomUUID` isn't available in every runtime the
 * module touches (older Android WebViews, the Node cron), so the id is composed
 * from a caller-supplied seed — the generator passes an index, the UI a counter.
 */
export function makeBlockId(type: ReportBlockType, seed: string | number): string {
  return `${type}-${String(seed).replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/** A fresh block of `type`, with registry defaults applied. */
export function createBlock(
  type: ReportBlockType,
  order: number,
  overrides: Partial<ReportBlock> = {},
): ReportBlock {
  const def = BLOCK_DEF_BY_TYPE[type];
  const base: ReportBlock = {
    id: makeBlockId(type, overrides.id ?? `${order}-${Math.abs(hashString(`${type}${order}`))}`),
    type,
    order,
    // Internal is the safe default: a new block never becomes client-visible by
    // accident — the author has to choose that explicitly.
    visibility: 'internal',
    ...(def?.defaults || {}),
    ...overrides,
  };
  // `overrides` routinely carries explicit `undefined` (a compact template spec has
  // no `chart`, no `columns`, …) and Firestore refuses to store those.
  return stripUndefined(base);
}

/** Small stable string hash — only used for id readability, never for security. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** Move a block within the list and renumber `order` (drag-and-drop). */
export function reorderBlocks(blocks: ReportBlock[], fromIndex: number, toIndex: number): ReportBlock[] {
  const list = [...blocks].sort((a, b) => a.order - b.order);
  if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) {
    return list.map((b, i) => ({ ...b, order: i }));
  }
  const [moved] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);
  return list.map((b, i) => ({ ...b, order: i }));
}

/** Remove a block unless the template locked it. Returns the list unchanged if locked. */
export function removeBlock(blocks: ReportBlock[], blockId: string): { blocks: ReportBlock[]; removed: boolean } {
  const target = blocks.find(b => b.id === blockId);
  if (!target || target.locked) return { blocks, removed: false };
  const next = blocks.filter(b => b.id !== blockId).sort((a, b) => a.order - b.order).map((b, i) => ({ ...b, order: i }));
  return { blocks: next, removed: true };
}

/** Normalise order values to 0..n-1 without changing the sequence. */
export function normaliseOrder(blocks: ReportBlock[]): ReportBlock[] {
  return [...blocks].sort((a, b) => a.order - b.order).map((b, i) => ({ ...b, order: i }));
}

export interface BlockValidationIssue {
  blockId: string;
  field?: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Structural validation, independent of workflow. Errors block a save; warnings
 * are surfaced in the quality panel and never block anything.
 */
export function validateBlock(block: ReportBlock, opts: { isAdmin?: boolean } = {}): BlockValidationIssue[] {
  const issues: BlockValidationIssue[] = [];
  const def = BLOCK_DEF_BY_TYPE[block.type];

  if (!def) {
    issues.push({ blockId: block.id, message: `Tip blloku i panjohur: ${block.type}`, severity: 'error' });
    return issues;
  }
  if (def.adminOnly && !opts.isAdmin) {
    issues.push({ blockId: block.id, message: `"${def.label}" mund të shtohet vetëm nga administratori.`, severity: 'error' });
  }
  if (def.neverClient && (block.visibility === 'client' || block.visibility === 'client_contacts')) {
    issues.push({
      blockId: block.id,
      field: 'visibility',
      message: `"${def.label}" nuk mund të bëhet i dukshëm për klientin.`,
      severity: 'error',
    });
  }
  if (block.visibility === 'custom_roles' && (block.visibleRoles || []).length === 0) {
    issues.push({ blockId: block.id, field: 'visibleRoles', message: 'Zgjidhni të paktën një rol.', severity: 'warning' });
  }
  if (block.type === 'progress' && block.progress !== undefined && (block.progress < 0 || block.progress > 100)) {
    issues.push({ blockId: block.id, field: 'progress', message: 'Progresi duhet 0–100.', severity: 'error' });
  }
  if (block.type === 'table') {
    const cols = block.columns || [];
    if (cols.length === 0 && (block.rows || []).length > 0) {
      issues.push({ blockId: block.id, field: 'columns', message: 'Tabela ka rreshta pa kolona të përcaktuara.', severity: 'error' });
    }
    const keys = new Set<string>();
    for (const c of cols) {
      if (keys.has(c.key)) {
        issues.push({ blockId: block.id, field: 'columns', message: `Kolona "${c.key}" është e dyfishuar.`, severity: 'error' });
      }
      keys.add(c.key);
    }
  }
  if ((block.type === 'image' || block.type === 'video-link') && block.url && !isSafeUrl(block.url)) {
    issues.push({ blockId: block.id, field: 'url', message: 'Lidhja duhet të jetë https.', severity: 'error' });
  }
  if (block.aiSuggested && !block.aiApprovedByUserId
      && (block.visibility === 'client' || block.visibility === 'client_contacts')) {
    issues.push({
      blockId: block.id,
      message: 'Përmbajtja nga AI duhet aprovuar përpara se të shihet nga klienti.',
      severity: 'warning',
    });
  }
  return issues;
}

export function validateBlocks(blocks: ReportBlock[], opts: { isAdmin?: boolean } = {}): BlockValidationIssue[] {
  const issues = blocks.flatMap(b => validateBlock(b, opts));
  const ids = new Set<string>();
  for (const b of blocks) {
    if (ids.has(b.id)) {
      issues.push({ blockId: b.id, message: 'Id e bllokut është e dyfishuar.', severity: 'error' });
    }
    ids.add(b.id);
  }
  return issues;
}

/**
 * URL allow-list for embedded media. Mirrors the attachment check in ChatView:
 * only https (and Firebase Storage), never `javascript:` / `data:`.
 */
export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!/^https:\/\//i.test(trimmed)) return false;
  // Reject credentials-in-URL and control characters.
  if (/[\s<>"']/.test(trimmed)) return false;
  if (/@/.test(trimmed.slice(8).split('/')[0])) return false;
  return true;
}

/** Standard column sets used by the seeded templates. */
export const TABLE_PRESETS: Record<string, ReportTableColumn[]> = {
  keywords: [
    { key: 'keyword', label: 'Fjala kyçe' },
    { key: 'before', label: 'Pozicioni para', format: 'number', align: 'right' },
    { key: 'after', label: 'Pozicioni tani', format: 'number', align: 'right' },
    { key: 'change', label: 'Ndryshim', format: 'number', align: 'right' },
    { key: 'volume', label: 'Volumi', format: 'number', align: 'right' },
  ],
  landingPages: [
    { key: 'page', label: 'Faqja' },
    { key: 'users', label: 'Vizitorë', format: 'number', align: 'right' },
    { key: 'conversions', label: 'Konvertime', format: 'number', align: 'right' },
    { key: 'rate', label: 'Norma', format: 'percent', align: 'right' },
  ],
  campaigns: [
    { key: 'campaign', label: 'Fushata' },
    { key: 'spend', label: 'Shpenzim', format: 'currency', align: 'right' },
    { key: 'leads', label: 'Leads', format: 'number', align: 'right' },
    { key: 'cpl', label: 'Kosto/Lead', format: 'currency', align: 'right' },
    { key: 'roas', label: 'ROAS', format: 'number', align: 'right' },
  ],
  content: [
    { key: 'title', label: 'Përmbajtja' },
    { key: 'type', label: 'Formati' },
    { key: 'reach', label: 'Shtrirje', format: 'number', align: 'right' },
    { key: 'engagement', label: 'Interaksione', format: 'number', align: 'right' },
    { key: 'rate', label: 'Norma', format: 'percent', align: 'right' },
  ],
  risks: [
    { key: 'risk', label: 'Rreziku' },
    { key: 'impact', label: 'Ndikimi' },
    { key: 'likelihood', label: 'Probabiliteti' },
    { key: 'mitigation', label: 'Masa zbutëse' },
    { key: 'owner', label: 'Përgjegjësi' },
  ],
  bugs: [
    { key: 'issue', label: 'Problemi' },
    { key: 'severity', label: 'Rëndësia' },
    { key: 'status', label: 'Statusi' },
    { key: 'resolvedAt', label: 'Zgjidhur', format: 'date' },
  ],
  maintenance: [
    { key: 'action', label: 'Veprimi' },
    { key: 'date', label: 'Data', format: 'date' },
    { key: 'result', label: 'Rezultati' },
  ],
};

/** Visibility values considered "confidential" in the editor's warning banner. */
export const CONFIDENTIAL_VISIBILITIES: ReportVisibility[] = ['management', 'author'];
