import { describe, expect, it } from 'vitest';
import {
  MODULES,
  MODULE_BY_ID,
  MODULE_GROUP_ORDER,
  defaultDisabledModulePaths,
  disabledPathsFor,
  groupedOptionalModules,
  findModuleForPath,
  isModuleEnabled,
  isPathEnabled,
  lockedPathsFor,
  optionalPathsExcept,
  moduleBlockReason,
  planIncludes,
} from './modules';

const shop = MODULE_BY_ID.shop;

const allowAll = { canAccessProducts: true, canAccessServices: true };

describe('registry integrity', () => {
  it('has unique ids and paths', () => {
    expect(new Set(MODULES.map(m => m.id)).size).toBe(MODULES.length);
    expect(new Set(MODULES.map(m => m.path)).size).toBe(MODULES.length);
  });

  it('registers the shop module on /app/products with its orders sub-route', () => {
    expect(shop).toBeDefined();
    expect(shop.path).toBe('/app/products');
    expect(shop.extraPaths).toContain('/app/shop-orders');
    expect(shop.permissionKey).toBe('canAccessProducts');
  });

  it('starts the shop disabled for brand-new tenants', () => {
    expect(defaultDisabledModulePaths()).toContain('/app/products');
  });
});

describe('disabledPathsFor (console tenant creation)', () => {
  it('disables exactly the optional modules that were not switched on', () => {
    const on = MODULES.filter(m => m.optional && m.id !== 'shop' && m.id !== 'hosting').map(m => m.path);
    expect(disabledPathsFor(on).sort()).toEqual(['/app/hosting', '/app/products'].sort());
  });

  it('reproduces the self-serve default when the default-off modules are left off', () => {
    const on = MODULES.filter(m => m.optional && !m.defaultOff).map(m => m.path);
    expect(disabledPathsFor(on).sort()).toEqual(defaultDisabledModulePaths().sort());
  });

  it('writes nothing when every optional module is on, and ignores unknown paths', () => {
    const on = [...MODULES.filter(m => m.optional).map(m => m.path), '/app/does-not-exist'];
    expect(disabledPathsFor(on)).toEqual([]);
  });

  it('never lists a core module, even when the caller left it out', () => {
    const core = MODULES.filter(m => !m.optional).map(m => m.path);
    const out = disabledPathsFor([]);
    for (const p of core) expect(out).not.toContain(p);
    expect(out.length).toBe(MODULES.filter(m => m.optional).length);
  });

  it('buckets optional modules by group in display order', () => {
    const groups = groupedOptionalModules();
    expect(groups.map(g => g.group)).toEqual(MODULE_GROUP_ORDER.filter(g => groups.some(x => x.group === g)));
    expect(groups.flatMap(g => g.modules).length).toBe(MODULES.filter(m => m.optional).length);
    for (const g of groups) expect(g.modules.length).toBeGreaterThan(0);
  });
});

describe('findModuleForPath', () => {
  it('resolves primary paths, extra paths and nested routes', () => {
    expect(findModuleForPath('/app/products')?.id).toBe('shop');
    expect(findModuleForPath('/app/products/abc123')?.id).toBe('shop');
    expect(findModuleForPath('/app/shop-orders')?.id).toBe('shop');
  });

  it('returns nothing for ungated routes', () => {
    expect(findModuleForPath('/app/dashboard')).toBeUndefined();
    expect(findModuleForPath('/app/settings')).toBeUndefined();
  });

  it('does not treat a path prefix as a match', () => {
    // '/app/product-feed' must not resolve to the '/app/products' module.
    expect(findModuleForPath('/app/product-feed')).toBeUndefined();
  });
});

describe('planIncludes', () => {
  it('orders the paid tiers', () => {
    expect(planIncludes('starter', 'pro')).toBe(false);
    expect(planIncludes('pro', 'pro')).toBe(true);
    expect(planIncludes('enterprise', 'business')).toBe(true);
  });

  it('gives trials the full product so they can evaluate it', () => {
    expect(planIncludes('trial', 'enterprise')).toBe(true);
  });

  it('treats an unknown or missing plan as a trial rather than locking the tenant out', () => {
    expect(planIncludes(undefined, 'business')).toBe(true);
    expect(planIncludes('legacy-plan', 'business')).toBe(true);
  });
});

describe('moduleBlockReason', () => {
  it('allows the module when permission, plan and toggle all pass', () => {
    expect(moduleBlockReason(shop, { plan: 'pro', permissions: allowAll })).toBeNull();
  });

  it('reports the missing permission before anything else', () => {
    // A Viewer shouldn't be told to upgrade a plan they still couldn't use.
    const reason = moduleBlockReason(shop, {
      plan: 'starter',
      disabledModules: ['/app/products'],
      permissions: { canAccessProducts: false },
    });
    expect(reason).toBe('permission');
  });

  it('reports the plan before the tenant toggle', () => {
    const reason = moduleBlockReason(shop, {
      plan: 'starter',
      disabledModules: ['/app/products'],
      permissions: allowAll,
    });
    expect(reason).toBe('plan');
  });

  it('reports the tenant toggle last', () => {
    expect(moduleBlockReason(shop, {
      plan: 'business',
      disabledModules: ['/app/products'],
      permissions: allowAll,
    })).toBe('disabled');
  });

  it('reports a platform lock before the owner toggle — the owner cannot undo it', () => {
    // Both lists name the module: the lock is what the tenant must be told about,
    // because flipping their own switch changes nothing.
    expect(moduleBlockReason(shop, {
      plan: 'business',
      lockedModules: ['/app/products'],
      disabledModules: ['/app/products'],
      permissions: allowAll,
    })).toBe('locked');
    expect(moduleBlockReason(shop, {
      plan: 'business',
      lockedModules: ['/app/products'],
      permissions: allowAll,
    })).toBe('locked');
  });

  it('reports the plan before a platform lock', () => {
    expect(moduleBlockReason(shop, {
      plan: 'starter',
      lockedModules: ['/app/products'],
      permissions: allowAll,
    })).toBe('plan');
  });

  it('a lock on another module does not touch this one', () => {
    expect(moduleBlockReason(shop, {
      plan: 'business',
      lockedModules: ['/app/hosting'],
      permissions: allowAll,
    })).toBeNull();
  });

  it('lockedPathsFor mirrors disabledPathsFor over the optional set', () => {
    const available = MODULES.filter(m => m.optional && m.id !== 'hosting').map(m => m.path);
    expect(lockedPathsFor(available)).toEqual(['/app/hosting']);
    expect(lockedPathsFor(MODULES.map(m => m.path))).toEqual([]);
    expect(lockedPathsFor([])).toEqual(optionalPathsExcept([]));
  });

  it('lets a super-admin through every gate', () => {
    expect(moduleBlockReason(shop, {
      plan: 'starter',
      disabledModules: ['/app/products'],
      permissions: { canAccessProducts: false },
      isSuperAdmin: true,
    })).toBeNull();
  });

  it('requires the permission key to be exactly true, not merely truthy', () => {
    expect(isModuleEnabled(shop, { plan: 'pro', permissions: { canAccessProducts: 'yes' } })).toBe(false);
  });
});

describe('isPathEnabled', () => {
  it('gates every route the module owns', () => {
    const ctx = { plan: 'pro' as const, disabledModules: ['/app/products'], permissions: allowAll };
    expect(isPathEnabled('/app/products', ctx)).toBe(false);
    expect(isPathEnabled('/app/shop-orders', ctx)).toBe(false);
  });

  it('leaves unregistered routes open', () => {
    expect(isPathEnabled('/app/dashboard', { plan: 'starter', permissions: {} })).toBe(true);
  });
});
