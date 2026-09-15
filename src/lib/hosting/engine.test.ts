/**
 * @vitest-environment node
 *
 * Node, not jsdom: the drift guard reads `api/_hostingEngine.ts` off disk.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BILLING_CYCLES,
  CYCLE_MONTHS,
  DEFAULT_LIFECYCLE,
  DOMAIN_BLOCK_LABELS,
  ORDER_ERROR_LABELS,
  SUBSCRIPTION_BLOCK_LABELS,
  addMonthsClamped,
  availableCycles,
  cycleFromWhmcs,
  cyclePrice,
  dayKey,
  daysBetween,
  decideDomain,
  decideSubscription,
  deriveCpanelUsername,
  domainPrice,
  generateAccountPassword,
  monthlyEquivalent,
  nextDueDate,
  normalizeLifecycleConfig,
  parseDomain,
  priceOrder,
  renewSubscriptionPatch,
  renewalInvoiceId,
  statusFromRegistrar,
  statusFromWhmAccount,
  suggestSellPrice,
  applyCoupon,
  COUPON_ERROR_LABELS,
  prorationQuote,
  nextRetryDelayMs,
  usageAlertLevel,
  buildExpiryReport,
  PROVISION_RETRY_DELAYS_MS,
  type DomainFacts,
  type SubscriptionFacts,
  type TldPricing,
} from './engine';

const D = (iso: string) => new Date(iso);
const NOW = D('2026-09-15T09:00:00Z');

// ── Drift guard ────────────────────────────────────────────────────────────────

describe('api mirror', () => {
  it('api/_hostingEngine.ts is byte-identical to the canonical engine', () => {
    const root = resolve(__dirname, '../../..');
    const canonical = readFileSync(resolve(root, 'src/lib/hosting/engine.ts'), 'utf8');
    const mirror = readFileSync(resolve(root, 'api/_hostingEngine.ts'), 'utf8');
    expect(mirror).toBe(canonical);
  });
});

// ── Cycles & dates ─────────────────────────────────────────────────────────────

describe('cycles', () => {
  it('every cycle has a month count and a label', () => {
    for (const c of BILLING_CYCLES) {
      expect(CYCLE_MONTHS[c]).toBeGreaterThan(0);
      expect(SUBSCRIPTION_BLOCK_LABELS).toBeTruthy();
    }
  });

  it('maps WHMCS cycle names, never defaults an unknown one', () => {
    expect(cycleFromWhmcs('Monthly')).toBe('monthly');
    expect(cycleFromWhmcs('Semi-Annually')).toBe('semiannually');
    expect(cycleFromWhmcs('Annually')).toBe('annually');
    expect(cycleFromWhmcs('Biennially')).toBe('biennially');
    expect(cycleFromWhmcs('Free Account')).toBeNull();
    expect(cycleFromWhmcs(undefined)).toBeNull();
  });

  it('addMonthsClamped keeps the anchor day and never overflows', () => {
    // 31 Jan + 1 month → 28 Feb (not 3 Mar), then the anchor restores 31 Mar.
    const jan31 = D('2026-01-31T12:00:00Z');
    const feb = addMonthsClamped(jan31, 1, 31);
    expect(dayKey(feb)).toBe('2026-02-28');
    const mar = addMonthsClamped(feb, 1, 31);
    expect(dayKey(mar)).toBe('2026-03-31');
    // Without an anchor the clamped day would drift to the 28th forever.
    expect(dayKey(addMonthsClamped(feb, 1))).toBe('2026-03-28');
  });

  it('nextDueDate follows the cycle and lands at 12:00 UTC', () => {
    const due = D('2026-09-15T12:00:00Z');
    expect(nextDueDate(due, 'monthly').toISOString()).toBe('2026-10-15T12:00:00.000Z');
    expect(nextDueDate(due, 'quarterly').toISOString()).toBe('2026-12-15T12:00:00.000Z');
    expect(nextDueDate(due, 'annually').toISOString()).toBe('2027-09-15T12:00:00.000Z');
    expect(nextDueDate(due, 'triennially').toISOString()).toBe('2029-09-15T12:00:00.000Z');
  });

  it('daysBetween counts UTC calendar days, sign included', () => {
    expect(daysBetween(NOW, D('2026-09-29T00:30:00Z'))).toBe(14);
    expect(daysBetween(NOW, D('2026-09-08T23:59:00Z'))).toBe(-7);
    expect(daysBetween(NOW, NOW)).toBe(0);
  });
});

// ── Pricing ────────────────────────────────────────────────────────────────────

describe('product pricing', () => {
  const pricing = { monthly: { price: 5 }, annually: { price: 50, setupFee: 10 }, quarterly: { price: -1 } };

  it('lists only sellable cycles in canonical order', () => {
    expect(availableCycles(pricing)).toEqual(['monthly', 'annually']);
    expect(availableCycles(null)).toEqual([]);
  });

  it('resolves a cycle price with setup fee, null when not sold', () => {
    expect(cyclePrice(pricing, 'annually')).toEqual({ price: 50, setupFee: 10 });
    expect(cyclePrice(pricing, 'monthly')).toEqual({ price: 5, setupFee: 0 });
    expect(cyclePrice(pricing, 'biennially')).toBeNull();
    expect(monthlyEquivalent(pricing, 'annually')).toBe(4.17);
  });

  it('suggestSellPrice applies the margin and rounds up to .99', () => {
    expect(suggestSellPrice(9.5, 40)).toBe(13.99);
    expect(suggestSellPrice(0, 40)).toBe(0);
  });
});

// ── Domains ────────────────────────────────────────────────────────────────────

describe('parseDomain', () => {
  it('normalises protocol, www, case, trailing dot and paths', () => {
    expect(parseDomain(' HTTPS://www.Shembull.COM/faqe?x=1 ')).toEqual({ name: 'shembull.com', sld: 'shembull', tld: 'com' });
    expect(parseDomain('shembull.com.')).toEqual({ name: 'shembull.com', sld: 'shembull', tld: 'com' });
  });

  it('understands multi-label suffixes we sell', () => {
    expect(parseDomain('firma.com.al')).toEqual({ name: 'firma.com.al', sld: 'firma', tld: 'com.al' });
    expect(parseDomain('shop.co.uk')?.tld).toBe('co.uk');
  });

  it('rejects bare TLDs, illegal labels and third levels', () => {
    expect(parseDomain('com')).toBeNull();
    expect(parseDomain('-bad.com')).toBeNull();
    expect(parseDomain('has space.com')).toBeNull();
    expect(parseDomain('mail.shembull.com')).toBeNull();
    expect(parseDomain('')).toBeNull();
    expect(parseDomain(undefined)).toBeNull();
  });
});

describe('domainPrice', () => {
  const tlds: TldPricing[] = [
    { tld: 'com', currency: 'EUR', registerPrice: 12, renewPrice: 14, transferPrice: 11, minYears: 1, maxYears: 10 },
    { tld: '.al', currency: 'EUR', registerPrice: 20, renewPrice: 20, minYears: 1, maxYears: 1 },
    { tld: 'net', currency: 'EUR', registerPrice: 13, renewPrice: 13, status: 'Archived' },
  ];

  it('prices by kind and clamps years to the TLD limits', () => {
    expect(domainPrice(tlds, 'com', 2)).toEqual({ amount: 24, currency: 'EUR', years: 2 });
    expect(domainPrice(tlds, 'com', 2, 'renew')).toEqual({ amount: 28, currency: 'EUR', years: 2 });
    expect(domainPrice(tlds, 'com', 1, 'transfer')?.amount).toBe(11);
    expect(domainPrice(tlds, 'al', 5)).toEqual({ amount: 20, currency: 'EUR', years: 1 });
    expect(domainPrice(tlds, 'com', 99)?.years).toBe(10);
  });

  it('refuses TLDs we do not sell or archived', () => {
    expect(domainPrice(tlds, 'xyz', 1)).toBeNull();
    expect(domainPrice(tlds, 'net', 1)).toBeNull();
  });
});

// ── cPanel account ─────────────────────────────────────────────────────────────

describe('deriveCpanelUsername', () => {
  it('uses the sld, ≤ 8 chars, letters/digits, no leading digit', () => {
    expect(deriveCpanelUsername('shembull-agency.com')).toBe('shembull');
    expect(deriveCpanelUsername('123abc.com')).toBe('abc');
    expect(deriveCpanelUsername('ab.com')).toBe('abweb');
  });

  it('avoids reserved names and taken ones with a counter', () => {
    expect(deriveCpanelUsername('admin.com')).toBe('admin1');
    expect(deriveCpanelUsername('shembull.com', ['shembull', 'shembul1'])).toBe('shembul2');
  });

  it('generateAccountPassword satisfies cPanel strength classes', () => {
    let seed = 42;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const pw = generateAccountPassword(rnd);
    expect(pw).toHaveLength(16);
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[a-z]/);
    expect(pw).toMatch(/[0-9]/);
    expect(pw).toMatch(/[!@#$%^*\-_=+]/);
  });
});

// ── Subscription lifecycle ─────────────────────────────────────────────────────

const sub = (over: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({
  id: 'S1',
  status: 'Active',
  source: 'fivocrm',
  billingCycle: 'monthly',
  nextDueDate: D('2026-09-25T12:00:00Z'), // 10 days ahead of NOW
  recurringAmount: 10,
  provisionStatus: 'provisioned',
  ...over,
});

describe('decideSubscription', () => {
  it('issues the renewal invoice inside the window, once', () => {
    expect(decideSubscription(sub(), NOW)).toMatchObject({ action: 'issue-renewal-invoice', daysToDue: 10 });
    expect(decideSubscription(sub({ nextDueDate: D('2026-10-20T12:00:00Z') }), NOW).reason).toBe('not-yet-due-for-invoice');
    expect(decideSubscription(sub({ lastInvoicedDueKey: '2026-09-25' }), NOW).reason).toBe('already-invoiced');
  });

  it('names every non-firing', () => {
    expect(decideSubscription(sub({ source: 'whmcs' }), NOW).reason).toBe('not-ours');
    expect(decideSubscription(sub({ status: 'Terminated' }), NOW).reason).toBe('terminal-status');
    expect(decideSubscription(sub({ status: 'Pending' }), NOW).reason).toBe('pending-provisioning');
    expect(decideSubscription(sub({ provisionStatus: 'failed' }), NOW).reason).toBe('pending-provisioning');
    expect(decideSubscription(sub({ nextDueDate: null }), NOW).reason).toBe('no-due-date');
    expect(decideSubscription(sub({ billingCycle: 'Free Account' }), NOW).reason).toBe('unsupported-cycle');
    expect(decideSubscription(sub({ recurringAmount: 0 }), NOW).reason).toBe('zero-amount');
    expect(decideSubscription(sub({ lifecycleHold: true }), NOW).reason).toBe('lifecycle-hold');
    for (const r of Object.keys(SUBSCRIPTION_BLOCK_LABELS)) expect(SUBSCRIPTION_BLOCK_LABELS[r as never]).toBeTruthy();
  });

  it('a paid renewal is inert here (the payment handler moves the due date)', () => {
    const s = sub({ lastInvoicedDueKey: '2026-09-25', currentInvoice: { status: 'Paid' } });
    expect(decideSubscription(s, NOW).reason).toBe('invoice-paid');
  });

  it('unpaid past due: grace → suspend → terminate, honouring the config', () => {
    const due = D('2026-09-05T12:00:00Z'); // 10 days overdue
    const base = sub({ nextDueDate: due, lastInvoicedDueKey: '2026-09-05', currentInvoice: { status: 'Sent' } });
    expect(decideSubscription(base, NOW, { suspendDaysAfter: 14 }).reason).toBe('within-grace');
    expect(decideSubscription(base, NOW).action).toBe('suspend');
    const suspended = { ...base, status: 'Suspended' as const };
    // Termination is OPT-IN: the default config never deletes an account.
    expect(decideSubscription(suspended, NOW).reason).toBe('termination-disabled');
    expect(decideSubscription(suspended, NOW, { terminateDaysAfter: 30 }).reason).toBe('not-yet-terminate');
    expect(decideSubscription(suspended, NOW, { terminateDaysAfter: 7 }).action).toBe('terminate');
    expect(decideSubscription(suspended, NOW, { terminateDaysAfter: 0 }).reason).toBe('termination-disabled');
  });

  it('a suspended account whose renewal was never invoiced still gets its invoice', () => {
    // Staff suspended it by hand before the window; the invoice must still go out
    // so the customer can pay their way back in.
    expect(decideSubscription(sub({ status: 'Suspended' }), NOW).action).toBe('issue-renewal-invoice');
  });

  it('cancel-at-period-end never invoices and ends the term on the due date', () => {
    expect(decideSubscription(sub({ cancelAtPeriodEnd: true }), NOW).reason).toBe('not-yet-due-for-invoice');
    expect(decideSubscription(sub({ cancelAtPeriodEnd: true, nextDueDate: D('2026-09-15T12:00:00Z') }), NOW).action).toBe('cancel-at-period-end');
  });

  it('renewal invoice id is deterministic per due date', () => {
    expect(renewalInvoiceId('sub', 'S1', D('2026-09-25T12:00:00Z'))).toBe('hst_sub_S1_2026-09-25');
    expect(renewalInvoiceId('dom', 'D1', D('2027-01-01T00:00:00Z'))).toBe('hst_dom_D1_2027-01-01');
  });

  it('renewSubscriptionPatch advances one cycle from the paid due date and reactivates', () => {
    const p = renewSubscriptionPatch({ billingCycle: 'monthly', nextDueDate: D('2026-09-25T12:00:00Z'), anchorDay: 31 }, D('2026-08-31T12:00:00Z'));
    expect(p?.status).toBe('Active');
    expect(dayKey(p!.nextDueDate)).toBe('2026-09-30');
    expect(renewSubscriptionPatch({ billingCycle: 'x', nextDueDate: null }, NOW)).toBeNull();
  });

  it('normalizeLifecycleConfig clamps and defaults', () => {
    expect(normalizeLifecycleConfig(null)).toEqual(DEFAULT_LIFECYCLE);
    expect(normalizeLifecycleConfig({ suspendDaysAfter: -5, terminateDaysAfter: 9999 })).toMatchObject({ suspendDaysAfter: 0, terminateDaysAfter: 730 });
  });
});

// ── Domain lifecycle ───────────────────────────────────────────────────────────

const dom = (over: Partial<DomainFacts> = {}): DomainFacts => ({
  id: 'D1',
  status: 'Active',
  source: 'fivocrm',
  registrar: 'dynadot',
  expiryDate: D('2026-10-10T12:00:00Z'), // 25 days ahead
  recurringAmount: 14,
  autoRenew: true,
  ...over,
});

describe('decideDomain', () => {
  it('invoices inside the domain window, once', () => {
    expect(decideDomain(dom(), NOW).action).toBe('issue-renewal-invoice');
    expect(decideDomain(dom({ expiryDate: D('2027-01-01T12:00:00Z') }), NOW).reason).toBe('not-yet-due-for-invoice');
    expect(decideDomain(dom({ lastInvoicedExpiryKey: '2026-10-10' }), NOW).reason).toBe('already-invoiced');
  });

  it('a paid renewal is executed at the registrar exactly once', () => {
    const paid = dom({ lastInvoicedExpiryKey: '2026-10-10', currentInvoice: { status: 'Paid' } });
    expect(decideDomain(paid, NOW).action).toBe('renew-at-registrar');
    expect(decideDomain({ ...paid, renewedAtRegistrarForKey: '2026-10-10' }, NOW).reason).toBe('already-renewed');
  });

  it('unpaid past expiry → grace, then expired after the grace days', () => {
    const past = dom({ expiryDate: D('2026-09-05T12:00:00Z'), lastInvoicedExpiryKey: '2026-09-05', currentInvoice: { status: 'Sent' } });
    expect(decideDomain(past, NOW).action).toBe('mark-grace');
    expect(decideDomain({ ...past, status: 'Grace' }, NOW).reason).toBe('awaiting-payment');
    expect(decideDomain({ ...past, status: 'Grace' }, NOW, { domainGraceDays: 5 }).action).toBe('mark-expired');
  });

  it('auto-renew off: no invoice, just the status bookkeeping', () => {
    expect(decideDomain(dom({ autoRenew: false }), NOW).reason).toBe('auto-renew-off');
    const lapsed = dom({ autoRenew: false, expiryDate: D('2026-09-10T12:00:00Z') });
    expect(decideDomain(lapsed, NOW).action).toBe('mark-grace');
    expect(decideDomain({ ...lapsed, status: 'Grace' }, NOW, { domainGraceDays: 3 }).action).toBe('mark-expired');
  });

  it('names every non-firing', () => {
    expect(decideDomain(dom({ source: 'whmcs' }), NOW).reason).toBe('not-ours');
    expect(decideDomain(dom({ status: 'Expired' }), NOW).reason).toBe('terminal-status');
    expect(decideDomain(dom({ status: 'Pending' }), NOW).reason).toBe('pending-registration');
    expect(decideDomain(dom({ expiryDate: null }), NOW).reason).toBe('no-expiry');
    expect(decideDomain(dom({ recurringAmount: 0 }), NOW).reason).toBe('zero-amount');
    expect(decideDomain(dom({ lifecycleHold: true }), NOW).reason).toBe('lifecycle-hold');
    for (const r of Object.keys(DOMAIN_BLOCK_LABELS)) expect(DOMAIN_BLOCK_LABELS[r as never]).toBeTruthy();
  });

  it('statusFromRegistrar / statusFromWhmAccount map provider facts', () => {
    expect(statusFromRegistrar(D('2026-12-01T00:00:00Z'), NOW, 30)).toBe('Active');
    expect(statusFromRegistrar(D('2026-09-01T00:00:00Z'), NOW, 30)).toBe('Grace');
    expect(statusFromRegistrar(D('2026-06-01T00:00:00Z'), NOW, 30)).toBe('Expired');
    expect(statusFromWhmAccount({ suspended: 1 })).toBe('Suspended');
    expect(statusFromWhmAccount({ suspended: 0 })).toBe('Active');
    expect(statusFromWhmAccount(null)).toBe('Terminated');
  });
});

// ── Orders ─────────────────────────────────────────────────────────────────────

describe('priceOrder', () => {
  const tlds: TldPricing[] = [
    { tld: 'com', currency: 'EUR', registerPrice: 12, renewPrice: 14, transferPrice: 11 },
  ];
  const pricing = { monthly: { price: 5 }, annually: { price: 50, setupFee: 10 } };

  it('prices hosting + domain lines and totals them', () => {
    const r = priceOrder([
      { kind: 'hosting', productId: 'P1', productName: 'Start', cycle: 'annually', pricing, domainName: 'Shembull.com' },
      { kind: 'domain-register', domainName: 'shembull.com', years: 2 },
    ], tlds);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.lines).toHaveLength(2);
    expect(r.order.lines[0]).toMatchObject({ kind: 'hosting', domainName: 'shembull.com', unitPrice: 50, setupFee: 10, total: 60 });
    expect(r.order.lines[1]).toMatchObject({ kind: 'domain-register', years: 2, total: 24 });
    expect(r.order.total).toBe(84);
    expect(r.order.currency).toBe('EUR');
  });

  it('every validation failure is a named error with a label', () => {
    expect(priceOrder([], tlds)).toMatchObject({ ok: false, error: 'empty' });
    expect(priceOrder([{ kind: 'hosting', cycle: 'monthly', pricing, domainName: 'a.com' }], tlds)).toMatchObject({ error: 'hosting-without-product' });
    expect(priceOrder([{ kind: 'hosting', productId: 'P', cycle: 'biennially', pricing, domainName: 'a.com' }], tlds)).toMatchObject({ error: 'hosting-cycle-not-sold' });
    expect(priceOrder([{ kind: 'hosting', productId: 'P', cycle: 'monthly', pricing }], tlds)).toMatchObject({ error: 'hosting-without-domain' });
    expect(priceOrder([{ kind: 'hosting', productId: 'P', cycle: 'monthly', pricing, domainName: 'bad domain' }], tlds)).toMatchObject({ error: 'invalid-domain' });
    expect(priceOrder([{ kind: 'domain-register', domainName: 'a.xyz' }], tlds)).toMatchObject({ error: 'tld-not-sold', index: 0 });
    expect(priceOrder([{ kind: 'domain-register', domainName: 'a.com' }, { kind: 'domain-register', domainName: 'A.com' }], tlds)).toMatchObject({ error: 'duplicate-domain', index: 1 });
    expect(priceOrder([{ kind: 'domain-transfer', domainName: 'a.com' }], tlds)).toMatchObject({ error: 'transfer-without-auth-code' });
    expect(priceOrder([{ kind: 'domain-register', domainName: 'a.free' }], [...tlds, { tld: 'free', currency: 'EUR', registerPrice: 0, renewPrice: 0 }])).toMatchObject({ error: 'domain-zero-price' });
    for (const k of Object.keys(ORDER_ERROR_LABELS)) expect(ORDER_ERROR_LABELS[k as never]).toBeTruthy();
  });
});

// ── Promotions: free domain + coupons ──────────────────────────────────────────

describe('free domain with annual hosting', () => {
  const tlds: TldPricing[] = [{ tld: 'com', currency: 'EUR', registerPrice: 12, renewPrice: 14 }, { tld: 'net', currency: 'EUR', registerPrice: 13, renewPrice: 13 }];
  const pricing = { monthly: { price: 5 }, annually: { price: 50 } };
  const hosting = (cycle: 'monthly' | 'annually') => ({ kind: 'hosting' as const, productId: 'P', productName: 'Start', cycle, pricing, domainName: 'a.com', freeDomainTlds: ['com'], freeDomainMinCycle: 'annually' as const });

  it('gives the first year of ONE matching domain away on an annual package', () => {
    const r = priceOrder([hosting('annually'), { kind: 'domain-register', domainName: 'a.com', years: 2 }, { kind: 'domain-register', domainName: 'b.com', years: 1 }], tlds);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.lines[1]).toMatchObject({ discount: 12, discountReason: 'free-domain', total: 12 });
    expect(r.order.lines[2].discount).toBeUndefined();
    expect(r.order.subtotal).toBe(86);
    expect(r.order.discountTotal).toBe(12);
    expect(r.order.total).toBe(74);
  });

  it('does not apply on a monthly package or a TLD outside the list', () => {
    const m = priceOrder([hosting('monthly'), { kind: 'domain-register', domainName: 'a.com' }], tlds);
    expect(m.ok && m.order.discountTotal).toBe(0);
    const n = priceOrder([hosting('annually'), { kind: 'domain-register', domainName: 'a.net' }], tlds);
    expect(n.ok && n.order.discountTotal).toBe(0);
  });
});

describe('applyCoupon', () => {
  const tlds: TldPricing[] = [{ tld: 'com', currency: 'EUR', registerPrice: 10, renewPrice: 10 }];
  const base = priceOrder([
    { kind: 'hosting', productId: 'P', productName: 'S', cycle: 'annually', pricing: { annually: { price: 90 } }, domainName: 'a.com' },
    { kind: 'domain-register', domainName: 'a.com' },
  ], tlds);
  const order = base.ok ? base.order : (null as never);
  const NOW = new Date('2026-09-15T09:00:00Z');

  it('percent over eligible lines, spread per line, totals honest', () => {
    const r = applyCoupon(order, { code: 'welcome10', type: 'percent', value: 10, appliesTo: 'all' }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.couponCode).toBe('WELCOME10');
    expect(r.order.couponDiscount).toBe(10);
    expect(r.order.total).toBe(90);
    expect(r.order.lines.map((l) => l.total)).toEqual([81, 9]);
    expect(r.order.lines.reduce((s, l) => s + (l.discount || 0), 0)).toBe(10);
  });

  it('fixed amount only on hosting lines, capped at the eligible base', () => {
    const r = applyCoupon(order, { code: 'H5', type: 'fixed', value: 500, currency: 'EUR', appliesTo: 'hosting' }, NOW);
    expect(r.ok && r.order.couponDiscount).toBe(90);
    expect(r.ok && r.order.lines[1].total).toBe(10);
  });

  it('names every refusal', () => {
    expect(applyCoupon(order, null, NOW)).toMatchObject({ error: 'coupon-not-found' });
    expect(applyCoupon(order, { code: 'x', type: 'percent', value: 10, appliesTo: 'all', status: 'Archived' }, NOW)).toMatchObject({ error: 'coupon-inactive' });
    expect(applyCoupon(order, { code: 'x', type: 'percent', value: 10, appliesTo: 'all', validFrom: new Date('2027-01-01') }, NOW)).toMatchObject({ error: 'coupon-not-started' });
    expect(applyCoupon(order, { code: 'x', type: 'percent', value: 10, appliesTo: 'all', validUntil: new Date('2026-01-01') }, NOW)).toMatchObject({ error: 'coupon-expired' });
    expect(applyCoupon(order, { code: 'x', type: 'percent', value: 10, appliesTo: 'all', maxUses: 3, uses: 3 }, NOW)).toMatchObject({ error: 'coupon-exhausted' });
    expect(applyCoupon(order, { code: 'x', type: 'percent', value: 10, appliesTo: 'all', minTotal: 500 }, NOW)).toMatchObject({ error: 'coupon-min-total' });
    expect(applyCoupon(order, { code: 'x', type: 'fixed', value: 10, currency: 'ALL', appliesTo: 'all' }, NOW)).toMatchObject({ error: 'coupon-currency' });
    expect(applyCoupon({ ...order, lines: order.lines.filter((l) => l.kind === 'hosting') }, { code: 'x', type: 'percent', value: 10, appliesTo: 'domains' }, NOW)).toMatchObject({ error: 'coupon-not-applicable' });
    for (const k of Object.keys(COUPON_ERROR_LABELS)) expect(COUPON_ERROR_LABELS[k as never]).toBeTruthy();
  });
});

// ── Proration ──────────────────────────────────────────────────────────────────

describe('prorationQuote', () => {
  it('bills the price difference for the days left in the period', () => {
    // Monthly period 15 Aug → 15 Sep (31 days); today 5 Sep → 10 days left.
    const q = prorationQuote({ oldPrice: 10, newPrice: 41, cycle: 'monthly', nextDueDate: new Date('2026-09-15T12:00:00Z'), now: new Date('2026-09-05T09:00:00Z') });
    expect(q.daysInPeriod).toBe(31);
    expect(q.daysRemaining).toBe(10);
    expect(q.amount).toBe(10);
  });
  it('a downgrade owes nothing now', () => {
    expect(prorationQuote({ oldPrice: 40, newPrice: 10, cycle: 'annually', nextDueDate: new Date('2027-01-01T12:00:00Z'), now: new Date('2026-09-15T00:00:00Z') }).amount).toBe(0);
  });
  it('past the due date nothing remains', () => {
    expect(prorationQuote({ oldPrice: 10, newPrice: 20, cycle: 'monthly', nextDueDate: new Date('2026-09-01T12:00:00Z'), now: new Date('2026-09-15T00:00:00Z') }).amount).toBe(0);
  });
});

// ── Retry backoff, usage alarms, expiry report ─────────────────────────────────

describe('operations helpers', () => {
  it('nextRetryDelayMs backs off and gives up after the table', () => {
    expect(nextRetryDelayMs(1)).toBe(PROVISION_RETRY_DELAYS_MS[0]);
    expect(nextRetryDelayMs(5)).toBe(24 * 3_600_000);
    expect(nextRetryDelayMs(6)).toBeNull();
    expect(nextRetryDelayMs(0)).toBe(PROVISION_RETRY_DELAYS_MS[0]);
  });
  it('usageAlertLevel thresholds', () => {
    expect(usageAlertLevel(500, 1000)).toBeNull();
    expect(usageAlertLevel(910, 1000)).toBe('warning');
    expect(usageAlertLevel(980, 1000)).toBe('critical');
    expect(usageAlertLevel(980, null)).toBeNull();
  });
  it('buildExpiryReport buckets our rows only', () => {
    const now = new Date('2026-09-15T09:00:00Z');
    const r = buildExpiryReport(
      [
        { id: 's1', source: 'fivocrm', status: 'Active', domain: 'a.com', nextDueDate: new Date('2026-09-25T12:00:00Z'), recurringAmount: 5 },
        { id: 's2', source: 'fivocrm', status: 'Suspended', domain: 'b.com', nextDueDate: new Date('2026-09-01T12:00:00Z'), currentInvoiceId: 'inv', recurringAmount: 5 },
        { id: 's3', source: 'whmcs', status: 'Active', domain: 'w.com', nextDueDate: new Date('2026-09-20T12:00:00Z') },
      ],
      [
        { id: 'd1', source: 'fivocrm', status: 'Active', domainName: 'a.com', expiryDate: new Date('2026-10-10T12:00:00Z'), recurringAmount: 14 },
        { id: 'd2', source: 'fivocrm', status: 'Active', domainName: 'c.com', expiryDate: new Date('2026-11-05T12:00:00Z'), recurringAmount: 14 },
        { id: 'd3', source: 'fivocrm', status: 'Expired', domainName: 'x.com', expiryDate: new Date('2026-09-01T12:00:00Z') },
      ],
      now,
    );
    expect(r.domainsWithin30.map((x) => x.id)).toEqual(['d1']);
    expect(r.domainsWithin60.map((x) => x.id)).toEqual(['d2']);
    expect(r.subscriptionsDueWithin30.map((x) => x.id)).toEqual(['s1']);
    expect(r.unpaidRenewals.map((x) => x.id)).toEqual(['s2']);
    expect(r.suspended.map((x) => x.id)).toEqual(['s2']);
    expect(r.total).toBe(5);
  });
});
