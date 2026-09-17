/**
 * Module registry — the single source of truth for "what is a module".
 *
 * Before this file, module state lived in three disconnected places: the Sidebar's
 * nav list, the console's local TOGGLEABLE_MODULES array, and the per-role
 * `canAccessX` permission flags. Nothing consulted the tenant's SaaS `plan`, and a
 * disabled module's route was still reachable by typing the URL.
 *
 * Now a module is one entry here, and three independent gates are resolved from it:
 *
 *   1. PERMISSION — does this user's role grant the module? (`permissionKey`)
 *   2. PLAN       — does the tenant's subscription include it? (`minPlan`)
 *   3. TOGGLE     — has it been switched off for this tenant? (`businesses.disabledModules`)
 *
 * All three are enforced at the route level by <ModuleGate>, so nav visibility and
 * actual access can never drift apart.
 */

/** Subscription tiers, cheapest → richest. Mirrors `Business.plan`. */
export type PlanKey = 'trial' | 'starter' | 'pro' | 'business' | 'enterprise';

/**
 * Plan ordering. `trial` ranks at the top on purpose: a trial should be able to
 * evaluate every module before committing to a tier.
 */
export const PLAN_RANK: Record<PlanKey, number> = {
  starter: 1,
  pro: 2,
  business: 3,
  enterprise: 4,
  trial: 4,
};

export const PLAN_LABELS: Record<PlanKey, string> = {
  trial: 'Provë',
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
  enterprise: 'Enterprise',
};

export interface ModuleDef {
  /** Stable key used in code and analytics. Never change it once shipped. */
  id: string;
  /**
   * Primary nav route. This string is ALSO the key stored in
   * `businesses.disabledModules`, so it must match the Sidebar entry exactly.
   */
  path: string;
  label: string;
  description: string;
  /** Key on UserPermissions that the user's role must grant. */
  permissionKey: string;
  /** Cheapest plan that includes the module. */
  minPlan: PlanKey;
  /** false → core module a tenant admin may not switch off (e.g. Cilësimet). */
  optional: boolean;
  /** Off for brand-new tenants until they opt in (see createTenant). */
  defaultOff?: boolean;
  /** Extra routes gated together with `path` (detail pages, sub-tabs). */
  extraPaths?: string[];
  /** Grouping in the module manager UI. */
  group: 'CRM' | 'Operacione' | 'Shitje' | 'Financa' | 'Komunikim' | 'Marketing';
}

export const MODULES: ModuleDef[] = [
  // ── CRM ──
  { id: 'crm', path: '/app/crm', label: 'CRM Leads', description: 'Pipeline i lead-eve, temperatura, SLA dhe raporte.', permissionKey: 'canAccessCRM', minPlan: 'starter', optional: true, group: 'CRM', extraPaths: ['/app/follow-ups'] },
  { id: 'deals', path: '/app/deals', label: 'Marrëveshjet', description: 'Oportunitetet e kualifikuara, të ndara nga lead-et.', permissionKey: 'canAccessCRM', minPlan: 'pro', optional: true, group: 'CRM' },
  { id: 'customers', path: '/app/customers', label: 'Klientët', description: 'Kartela 360° e klientit, kontaktet dhe historiku.', permissionKey: 'canAccessCustomers', minPlan: 'starter', optional: true, group: 'CRM' },

  // ── Operacione ──
  { id: 'projects', path: '/app/projects', label: 'Projektet', description: 'Projekte, milestone-e dhe buxhet.', permissionKey: 'canAccessProjects', minPlan: 'starter', optional: true, group: 'Operacione' },
  { id: 'tasks', path: '/app/tasks', label: 'Detyrat', description: 'Bordi i detyrave, etiketat, bllokuesit dhe përsëritjet.', permissionKey: 'canAccessTasks', minPlan: 'starter', optional: true, group: 'Operacione' },
  { id: 'goals', path: '/app/goals', label: 'Objektivat', description: 'OKR-të, key results dhe progresi automatik.', permissionKey: 'canAccessGoals', minPlan: 'pro', optional: true, group: 'Operacione' },
  {
    id: 'reporting',
    path: '/app/reports',
    label: 'Raportimi',
    description: 'Raporte ditore/javore të stafit, raporte klientit me aprovime, PDF, portal, KPI dhe përgjegjshmëri.',
    permissionKey: 'canAccessReports',
    // Pro: the daily/weekly accountability half is useful to a small team; the
    // client-facing half (approvals, PDF, portal publishing) is what agencies buy.
    minPlan: 'pro',
    optional: true,
    extraPaths: [
      '/app/reports/new',
      '/app/report-templates',
      '/app/report-kpis',
      '/app/report-schedules',
      '/app/accountability',
      '/app/client-health',
    ],
    group: 'Operacione',
  },

  // ── Shitje ──
  { id: 'services', path: '/app/services', label: 'Shërbimet', description: 'Katalogu i shërbimeve që faturohen.', permissionKey: 'canAccessServices', minPlan: 'starter', optional: true, group: 'Shitje' },
  {
    id: 'shop',
    path: '/app/products',
    label: 'Dyqani & Produktet',
    description: 'Katalog produktesh me variante, inventar, porosi dhe dyqan në portalin e klientit.',
    permissionKey: 'canAccessProducts',
    minPlan: 'pro',
    optional: true,
    // Most tenants are service agencies — the shop stays off until they ask for it.
    defaultOff: true,
    extraPaths: ['/app/shop-orders'],
    group: 'Shitje',
  },
  {
    id: 'hosting',
    path: '/app/hosting',
    label: 'Hosting & Domain-e',
    description: 'Shitje hosting-u dhe domain-esh: paketa cPanel/WHM, regjistrim domain-esh (Dynadot), faturim periodik, pezullim automatik dhe portal klienti.',
    permissionKey: 'canAccessHosting',
    minPlan: 'pro',
    optional: true,
    // Only hosting resellers need it — stays off until the tenant switches it on.
    defaultOff: true,
    group: 'Shitje',
  },
  { id: 'price-calculator', path: '/app/price-calculator', label: 'Kalkulatori', description: 'Preventiva të çmimeve me paketa dhe zbritje.', permissionKey: 'canAccessServices', minPlan: 'pro', optional: true, group: 'Shitje' },
  { id: 'contracts', path: '/app/contracts', label: 'Kontratat', description: 'Kontrata me nënshkrim dhe gjurmë auditi.', permissionKey: 'canAccessInvoices', minPlan: 'pro', optional: true, group: 'Shitje' },

  // ── Financa ──
  { id: 'invoices', path: '/app/invoices', label: 'Faturat', description: 'Faturim, faturim i përsëritur dhe arkëtime.', permissionKey: 'canAccessInvoices', minPlan: 'starter', optional: true, group: 'Financa' },
  { id: 'expenses', path: '/app/expenses', label: 'Shpenzimet', description: 'Shpenzime, aprovime dhe kategori.', permissionKey: 'canAccessExpenses', minPlan: 'starter', optional: true, group: 'Financa' },
  { id: 'bonus', path: '/app/bonus', label: 'Bonuset', description: 'Bonuset dhe komisionet e ekipit.', permissionKey: 'canAccessProfile', minPlan: 'business', optional: true, group: 'Financa' },

  // ── Komunikim ──
  { id: 'chat', path: '/app/chat', label: 'Chat', description: 'Chat i ekipit, DM dhe kanale me klientët.', permissionKey: 'canAccessChat', minPlan: 'starter', optional: true, group: 'Komunikim' },
  { id: 'whatsapp', path: '/app/whatsapp', label: 'WhatsApp', description: 'Inbox WhatsApp, template dhe broadcast.', permissionKey: 'canAccessWhatsapp', minPlan: 'pro', optional: true, group: 'Komunikim' },

  // ── Marketing ──
  { id: 'marketing', path: '/app/marketing', label: 'Marketing', description: 'Kampanja email + WhatsApp me drip.', permissionKey: 'canAccessMarketing', minPlan: 'business', optional: true, group: 'Marketing' },
  { id: 'social', path: '/app/social', label: 'Rrjetet Sociale', description: 'Analitika mujore Facebook & Instagram.', permissionKey: 'canAccessMarketing', minPlan: 'business', optional: true, group: 'Marketing' },
  { id: 'gmb', path: '/app/gmb', label: 'Google Reviews', description: 'Reviews të Google Business Profile: përgjigje me AI, raportime dhe postime.', permissionKey: 'canAccessMarketing', minPlan: 'pro', optional: true, defaultOff: true, group: 'Marketing' },
  { id: 'landing-pages', path: '/app/landing-pages', label: 'Landing Pages', description: 'Faqe marketing publike (modul i agjencisë).', permissionKey: 'canAccessServices', minPlan: 'enterprise', optional: true, defaultOff: true, group: 'Marketing' },
];

export const MODULE_BY_ID: Record<string, ModuleDef> = Object.fromEntries(
  MODULES.map(m => [m.id, m]),
);

/** Every route a module owns (primary + extras). */
export function modulePaths(mod: ModuleDef): string[] {
  return [mod.path, ...(mod.extraPaths || [])];
}

/** Resolve the module that owns a route, matching the longest path first. */
export function findModuleForPath(pathname: string): ModuleDef | undefined {
  let best: ModuleDef | undefined;
  let bestLen = -1;
  for (const mod of MODULES) {
    for (const p of modulePaths(mod)) {
      if ((pathname === p || pathname.startsWith(p + '/')) && p.length > bestLen) {
        best = mod;
        bestLen = p.length;
      }
    }
  }
  return best;
}

/** Paths a brand-new tenant starts with disabled. */
export function defaultDisabledModulePaths(): string[] {
  return MODULES.filter(m => m.defaultOff).map(m => m.path);
}

/** Display order of module groups — shared by every module manager UI. */
export const MODULE_GROUP_ORDER: ModuleDef['group'][] = ['CRM', 'Shitje', 'Operacione', 'Financa', 'Komunikim', 'Marketing'];

/** Optional modules bucketed by group, in display order (empty groups omitted). */
export function groupedOptionalModules(): Array<{ group: ModuleDef['group']; modules: ModuleDef[] }> {
  const map = new Map<ModuleDef['group'], ModuleDef[]>();
  for (const mod of MODULES) {
    if (!mod.optional) continue;
    if (!map.has(mod.group)) map.set(mod.group, []);
    map.get(mod.group)!.push(mod);
  }
  return MODULE_GROUP_ORDER.filter(g => map.has(g)).map(g => ({ group: g, modules: map.get(g)! }));
}

/**
 * Turn "which modules did the operator switch ON" into the `disabledModules` value
 * to store. Only optional modules can be off; a core module is never written to the
 * list even if the caller left it out, and unknown paths are ignored — so a stale
 * selection from an older UI cannot switch off something that no longer exists or
 * that a tenant may not lose.
 */
export function disabledPathsFor(enabledPaths: Iterable<string>): string[] {
  const on = new Set(enabledPaths);
  return MODULES.filter(m => m.optional && !on.has(m.path)).map(m => m.path);
}

/** Does `plan` include a module requiring at least `minPlan`? */
export function planIncludes(plan: PlanKey | string | undefined, minPlan: PlanKey): boolean {
  // Unknown/missing plan → treat as trial (evaluation), never as "locked out"; a
  // tenant with a broken plan field must not silently lose its whole workspace.
  const rank = PLAN_RANK[(plan as PlanKey) ?? 'trial'] ?? PLAN_RANK.trial;
  return rank >= PLAN_RANK[minPlan];
}

/** The cheapest plan that unlocks the module — used in upgrade prompts. */
export function requiredPlanLabel(mod: ModuleDef): string {
  return PLAN_LABELS[mod.minPlan];
}

export type ModuleBlockReason = 'permission' | 'plan' | 'disabled' | null;

export interface ModuleAccessInput {
  plan?: PlanKey | string;
  disabledModules?: string[];
  isSuperAdmin?: boolean;
  /** Map of permission key → granted. Pass the UserPermissions object directly. */
  permissions?: Record<string, any>;
}

/**
 * Resolve why (or whether) a module is unavailable. Returns null when accessible.
 * Order matters: permission first (a Viewer shouldn't be told to upgrade a plan
 * they can't reach anyway), then plan, then the tenant toggle.
 */
export function moduleBlockReason(mod: ModuleDef, input: ModuleAccessInput): ModuleBlockReason {
  // Super-admins run the platform — they see every tenant's modules regardless.
  if (input.isSuperAdmin) return null;
  if (input.permissions && input.permissions[mod.permissionKey] !== true) return 'permission';
  if (!planIncludes(input.plan, mod.minPlan)) return 'plan';
  if ((input.disabledModules || []).includes(mod.path)) return 'disabled';
  return null;
}

/** Convenience predicate over moduleBlockReason. */
export function isModuleEnabled(mod: ModuleDef, input: ModuleAccessInput): boolean {
  return moduleBlockReason(mod, input) === null;
}

/**
 * Gate for a nav path. Paths with no registered module (Dashboard, Profili,
 * Cilësimet, Relax CRM…) are always allowed — only registered modules are gated.
 */
export function isPathEnabled(pathname: string, input: ModuleAccessInput): boolean {
  const mod = findModuleForPath(pathname);
  if (!mod) return true;
  return isModuleEnabled(mod, input);
}
