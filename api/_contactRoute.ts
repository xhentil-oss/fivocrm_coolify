/**
 * Contact routing — "lead or client?" decided in ONE place (Nov 2026).
 *
 * The law (Salesforce / HubSpot model):
 *
 *   - A LEAD is a person who is not a client yet. Once they are a client the
 *     lead is CLOSED (`Converted`, linked via `customerId`) and stays only as
 *     history — where they came from, who worked them, how long it took.
 *   - A CLIENT never gets an open lead again. New business from a client
 *     (another service, an upsell, a returning ex-client) is a DEAL on the
 *     client's record, never a second pass through the lead pipeline.
 *   - Identity = email OR phone (normalised by the callers through
 *     `contactIdentity`). Either one matching makes it the same person.
 *
 * "Client" means a `customers` record whose status is not `Pending`. A Pending
 * customer is a self-registered portal account that has bought nothing yet — a
 * prospect with a login, so its lead stays open until they become a client.
 *
 * Import-free on purpose: `api/_contactRoute.ts` is a BYTE-IDENTICAL copy
 * (test-enforced), so the browser and every server write path decide the same.
 */

export const CLOSED_LEAD_STATUSES = ['Won', 'Converted', 'Lost'] as const;

/** Statuses that end a lead because it became a client (not because it was lost). */
const CLIENT_LEAD_STATUSES = new Set<string>(['Won', 'Converted']);

export interface RouteLeadFacts {
  id: string;
  status?: string | null;
  customerId?: string | null;
}

export interface RouteCustomerFacts {
  id: string;
  status?: string | null;
}

/**
 * What the caller is doing:
 * - `inquiry`  — the person asks for something (landing form, portal brief,
 *                staff typing a new lead). New business.
 * - `message`  — the person just wrote (WhatsApp). Contact, not necessarily business.
 * - `register` — a portal signup / an imported client record being paired.
 */
export type ContactIntent = 'inquiry' | 'message' | 'register';

export type ContactAction =
  | 'customer-deal'   // client asked for something new → Deal on the client
  | 'customer-touch'  // client wrote / was paired → stamp the client, nothing new
  | 'update-lead'     // an open (or, for a message, closed) lead is the record to use
  | 'reopen-lead'     // a lost / orphaned lead asked again → back to New, history kept
  | 'create-lead';    // unknown person (or a portal prospect with no lead) → new lead

export type ContactRouteReason =
  | 'is-client'
  | 'open-lead'
  | 'closed-lead-message'
  | 'lost-lead-returned'
  | 'converted-lead-orphaned'
  | 'portal-prospect'
  | 'unknown-contact';

export interface ContactRoute {
  action: ContactAction;
  reason: ContactRouteReason;
  /** The lead to update/reopen, or the one history should point at for a client. */
  leadId: string | null;
  customerId: string | null;
  /** Open leads of a client — the caller converts every one of them. */
  closeLeadIds: string[];
}

export const CONTACT_ROUTE_LABELS: Record<ContactRouteReason, string> = {
  'is-client': 'Është klient — kërkesa e re bëhet marrëveshje, jo lead',
  'open-lead': 'Lead i hapur ekzistues',
  'closed-lead-message': 'Mesazh nga një lead i mbyllur',
  'lost-lead-returned': 'Lead i humbur u rikthye',
  'converted-lead-orphaned': 'Lead i konvertuar pa klient — u rihap',
  'portal-prospect': 'I regjistruar në portal, ende pa blerë',
  'unknown-contact': 'Kontakt i ri',
};

export function isOpenLeadStatus(status?: string | null): boolean {
  return !(CLOSED_LEAD_STATUSES as readonly string[]).includes(String(status || 'New'));
}

/** A customer record that is a real client (anything but a Pending portal prospect). */
export function isClientCustomer(customer?: RouteCustomerFacts | null): boolean {
  if (!customer) return false;
  return String(customer.status || 'Active') !== 'Pending';
}

/** Open first, then lost, then converted/won; newest id order is the caller's. */
function pickLead(leads: RouteLeadFacts[]): RouteLeadFacts | null {
  return leads.find(l => isOpenLeadStatus(l.status))
    ?? leads.find(l => l.status === 'Lost')
    ?? leads[0]
    ?? null;
}

export function resolveContactRoute(input: {
  leads?: RouteLeadFacts[] | null;
  customer?: RouteCustomerFacts | null;
  intent: ContactIntent;
}): ContactRoute {
  const leads = (input.leads || []).filter(l => l && l.id);
  const customer = input.customer || null;
  const customerId = customer?.id ?? null;

  if (customer && isClientCustomer(customer)) {
    const closeLeadIds = leads.filter(l => isOpenLeadStatus(l.status)).map(l => l.id);
    const history = leads.find(l => l.customerId === customer.id) ?? pickLead(leads);
    return {
      action: input.intent === 'inquiry' ? 'customer-deal' : 'customer-touch',
      reason: 'is-client',
      leadId: history?.id ?? null,
      customerId,
      closeLeadIds,
    };
  }

  const lead = pickLead(leads);
  const base = { leadId: lead?.id ?? null, customerId, closeLeadIds: [] as string[] };
  if (lead && isOpenLeadStatus(lead.status)) return { ...base, action: 'update-lead', reason: 'open-lead' };
  if (lead) {
    // A message alone does not reopen anything — the salesperson decides that.
    if (input.intent === 'message') return { ...base, action: 'update-lead', reason: 'closed-lead-message' };
    return {
      ...base,
      action: 'reopen-lead',
      reason: CLIENT_LEAD_STATUSES.has(String(lead.status)) ? 'converted-lead-orphaned' : 'lost-lead-returned',
    };
  }
  return { ...base, action: 'create-lead', reason: customer ? 'portal-prospect' : 'unknown-contact' };
}

/** The patch that closes a lead because the person is (now) a client. */
export function convertLeadPatch(customerId: string, at: Date): Record<string, unknown> {
  return { status: 'Converted', probability: 100, convertedAt: at, customerId, updatedAt: at };
}

/**
 * Back to `New` for a lost (or orphaned converted) lead that asked again. The
 * previous outcome is kept on the record, never erased.
 */
export function reopenLeadPatch(
  lead: { status?: string | null; lostReason?: string | null },
  at: Date,
): Record<string, unknown> {
  return {
    status: 'New',
    probability: 10,
    reopenedAt: at,
    reopenedFromStatus: lead.status || null,
    ...(lead.lostReason ? { previousLostReason: lead.lostReason } : {}),
    lostReason: null,
    updatedAt: at,
  };
}

/**
 * The Deal a client's new request becomes. Tenant keys (`businessId`/`teamId`)
 * and `createdAt`/`createdByUserId` are stamped by the caller.
 */
export function clientDealDraft(input: {
  customer: { id: string; name?: string | null; status?: string | null; assignedToUserId?: string | null };
  /** What they asked for — a service, a package, or the form's source. */
  subject?: string | null;
  source?: string | null;
  notes?: string | null;
  amount?: number | null;
  currency?: string | null;
  ownerId?: string | null;
  at: Date;
}): Record<string, unknown> {
  const { customer } = input;
  const winBack = String(customer.status || '') === 'Inactive';
  const subject = (input.subject || '').trim() || (input.source || '').trim() || 'shërbim i ri';
  const amount = Number(input.amount);
  return {
    title: `${winBack ? 'Rikthim' : 'Kërkesë e re'}: ${subject} — ${customer.name || 'Klient'}`,
    customerId: customer.id,
    customerName: customer.name || null,
    amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
    currency: input.currency || 'ALL',
    stage: 'Qualification',
    ownerId: input.ownerId || customer.assignedToUserId || null,
    notes: input.notes || null,
    source: input.source || null,
    kind: winBack ? 'win-back' : 'new-business',
    lastActivityAt: input.at,
    updatedAt: input.at,
  };
}
