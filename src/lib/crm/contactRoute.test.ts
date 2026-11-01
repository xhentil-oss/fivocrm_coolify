/**
 * @vitest-environment node
 *
 * Node, not jsdom: the drift guard reads `api/_contactRoute.ts` off disk.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  clientDealDraft,
  convertLeadPatch,
  isClientCustomer,
  isOpenLeadStatus,
  reopenLeadPatch,
  resolveContactRoute,
} from './contactRoute';

const AT = new Date('2026-11-01T10:00:00Z');

describe('isClientCustomer', () => {
  it('Pending is a portal prospect, everything else is a client', () => {
    expect(isClientCustomer({ id: 'c', status: 'Pending' })).toBe(false);
    for (const s of ['Active', 'VIP', 'Inactive', 'Suspended']) expect(isClientCustomer({ id: 'c', status: s })).toBe(true);
    expect(isClientCustomer({ id: 'c' })).toBe(true); // WHMCS / legacy rows carry no status
    expect(isClientCustomer(null)).toBe(false);
  });
});

describe('isOpenLeadStatus', () => {
  it('only Won / Converted / Lost are closed', () => {
    expect(isOpenLeadStatus('New')).toBe(true);
    expect(isOpenLeadStatus('Proposal')).toBe(true);
    expect(isOpenLeadStatus(undefined)).toBe(true);
    for (const s of ['Won', 'Converted', 'Lost']) expect(isOpenLeadStatus(s)).toBe(false);
  });
});

describe('resolveContactRoute — a client never gets an open lead', () => {
  const client = { id: 'c1', status: 'Active' };

  it('client + inquiry → deal, and every open lead of theirs is closed', () => {
    const r = resolveContactRoute({
      customer: client,
      leads: [{ id: 'l1', status: 'Proposal' }, { id: 'l2', status: 'Converted', customerId: 'c1' }, { id: 'l3', status: 'New' }],
      intent: 'inquiry',
    });
    expect(r.action).toBe('customer-deal');
    expect(r.reason).toBe('is-client');
    expect(r.closeLeadIds).toEqual(['l1', 'l3']);
    expect(r.leadId).toBe('l2'); // history points at the lead already paired with them
  });

  it('client + message / register → touch the client, no new record', () => {
    expect(resolveContactRoute({ customer: client, leads: [], intent: 'message' }).action).toBe('customer-touch');
    expect(resolveContactRoute({ customer: client, leads: [], intent: 'register' }).action).toBe('customer-touch');
  });

  it('a returning ex-client (Inactive) is still a client → deal', () => {
    expect(resolveContactRoute({ customer: { id: 'c', status: 'Inactive' }, leads: [], intent: 'inquiry' }).action).toBe('customer-deal');
  });
});

describe('resolveContactRoute — prospects and unknown people', () => {
  it('open lead → update it (never a second lead)', () => {
    const r = resolveContactRoute({ leads: [{ id: 'l1', status: 'Lost' }, { id: 'l2', status: 'Qualified' }], intent: 'inquiry' });
    expect(r).toMatchObject({ action: 'update-lead', reason: 'open-lead', leadId: 'l2' });
  });

  it('lost lead asks again → reopen; just writes → leave it to the salesperson', () => {
    expect(resolveContactRoute({ leads: [{ id: 'l1', status: 'Lost' }], intent: 'inquiry' }))
      .toMatchObject({ action: 'reopen-lead', reason: 'lost-lead-returned', leadId: 'l1' });
    expect(resolveContactRoute({ leads: [{ id: 'l1', status: 'Lost' }], intent: 'message' }))
      .toMatchObject({ action: 'update-lead', reason: 'closed-lead-message' });
  });

  it('converted lead whose client is gone → reopen', () => {
    expect(resolveContactRoute({ leads: [{ id: 'l1', status: 'Converted', customerId: 'deleted' }], intent: 'inquiry' }).reason)
      .toBe('converted-lead-orphaned');
  });

  it('portal prospect (Pending) keeps its lead open / gets one', () => {
    const pending = { id: 'c1', status: 'Pending' };
    expect(resolveContactRoute({ customer: pending, leads: [], intent: 'register' }))
      .toMatchObject({ action: 'create-lead', reason: 'portal-prospect', customerId: 'c1' });
    expect(resolveContactRoute({ customer: pending, leads: [{ id: 'l1', status: 'New' }], intent: 'inquiry' }).action).toBe('update-lead');
  });

  it('nobody known → create', () => {
    expect(resolveContactRoute({ intent: 'inquiry' })).toMatchObject({ action: 'create-lead', reason: 'unknown-contact', leadId: null });
  });
});

describe('patches', () => {
  it('convertLeadPatch closes and links', () => {
    expect(convertLeadPatch('c1', AT)).toMatchObject({ status: 'Converted', probability: 100, customerId: 'c1', convertedAt: AT });
  });

  it('reopenLeadPatch keeps the previous outcome', () => {
    const p = reopenLeadPatch({ status: 'Lost', lostReason: 'Çmimi i lartë' }, AT);
    expect(p).toMatchObject({ status: 'New', reopenedFromStatus: 'Lost', previousLostReason: 'Çmimi i lartë', lostReason: null });
  });

  it('clientDealDraft: new business vs win-back, owner falls back to the account owner', () => {
    const d = clientDealDraft({ customer: { id: 'c1', name: 'Blerta', status: 'Active', assignedToUserId: 'u9' }, subject: 'SEO', amount: 500, at: AT });
    expect(d).toMatchObject({ title: 'Kërkesë e re: SEO — Blerta', stage: 'Qualification', ownerId: 'u9', amount: 500, kind: 'new-business', customerId: 'c1' });
    const w = clientDealDraft({ customer: { id: 'c1', name: 'Blerta', status: 'Inactive' }, source: 'Landing', amount: -3, at: AT });
    expect(w).toMatchObject({ title: 'Rikthim: Landing — Blerta', kind: 'win-back', amount: 0 });
  });
});

describe('api mirror', () => {
  it('api/_contactRoute.ts is byte-identical to the canonical module', () => {
    const root = resolve(__dirname, '../../..');
    const canonical = readFileSync(resolve(root, 'src/lib/crm/contactRoute.ts'), 'utf8');
    const mirror = readFileSync(resolve(root, 'api/_contactRoute.ts'), 'utf8');
    expect(mirror).toBe(canonical);
  });
});
