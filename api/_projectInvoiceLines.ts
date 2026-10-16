// The lines of an invoice raised for a PROJECT, split by service.
//
// IMPORT-FREE on purpose: `api/_projectInvoiceLines.ts` is a byte-identical copy
// (test-enforced) used by the recurring-project cron, and this file is used by
// ProjectsView when the first invoice is created. Both must write the same lines.
//
// Why it exists: the department P&L splits an invoice's cash by its OWN lines
// (serviceMix.ts). The cron used to write one free-text line per period, so every
// retainer invoice lost its SEO / Ads split; and the UI wrote the catalogue price
// per service while the invoice total was the project budget, so the lines did
// not add up to the invoice. Here the TOTAL is divided across the services, and
// the lines always sum to it exactly (the last line takes the rounding).
//
// Resolution, same order as projectServiceMix():
//   1. project.serviceMix (explicit %) → one line per service line, carrying the
//      id of a sold service in that category when there is one;
//   2. project.serviceIds → one line per service, weighted by catalogue price
//      (all prices 0 ⇒ equally);
//   3. nothing → one line with the project name (the old behaviour).
//
// Every line built from 1 or 2 carries `serviceLine` — the department it was
// written FOR (the explicit split's line, or the sold service's category). The
// department P&L reads it before anything else: an explicit "Ads 60 %" line with
// no Ads service sold has no `serviceId`, and without the label it was spread
// over the project's whole mix, so the invoice no longer said what it billed.
//
// Currency weights: `rateToAll` (one unit of `currency` in ALL) lets the browser
// pass the configured rates (`getRateToAll` in src/lib/utils.ts). The default
// table below is the SAME as utils' DEFAULT_RATES, so with no configured rate
// (the cron) this file and `projectServiceMix()` weigh a mixed-currency service
// list identically.

export interface InvoiceLineService {
  id: string;
  name?: string;
  title?: string;
  category?: string;
  price?: number;
  currency?: string;
}

export interface ProjectInvoiceLine {
  serviceId?: string;
  /** The department / service line this line bills (explicit split line, or the service's category). */
  serviceLine?: string;
  description: string;
  amount: number;
}

export interface ProjectInvoiceLinesInput {
  /** The invoice total, in the invoice's currency. */
  total: number;
  projectName: string;
  /** Appended to every description, e.g. "tetor 2026". */
  periodLabel?: string;
  serviceIds?: string[] | null;
  serviceMix?: Array<{ line: string; pct: number }> | null;
  /** The catalogue (only the sold ids are read). */
  services: InvoiceLineService[];
  /** One unit of `currency` in ALL (weights only). Default: DEFAULT_WEIGHT_RATE_TO_ALL. */
  rateToAll?: (currency: string) => number;
}

/**
 * Weights only — a mixed-currency service list must not read 1 EUR as 1 L.
 * Keep equal to DEFAULT_RATES in src/lib/utils.ts (projectServiceMix uses toAll).
 */
export const DEFAULT_WEIGHT_RATE_TO_ALL: Record<string, number> = { EUR: 100, USD: 92, GBP: 118 };
const defaultRateToAll = (currency: string): number => DEFAULT_WEIGHT_RATE_TO_ALL[(currency || '').toUpperCase()] || 1;
const priceWeight = (s: InvoiceLineService, rateToAll: (currency: string) => number): number => {
  const p = Number(s.price) || 0;
  if (!(p > 0)) return 0;
  const r = Number(rateToAll(s.currency || ''));
  return p * (Number.isFinite(r) && r > 0 ? r : 1);
};

const key = (v: unknown): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').toLowerCase() : '');
const round2 = (n: number): number => Math.round(n * 100) / 100;

function withPeriod(text: string, periodLabel?: string): string {
  return periodLabel ? `${text} – ${periodLabel}` : text;
}

/** Split `total` by `weights` into amounts that sum to `total` exactly. */
export function splitAmount(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + (w > 0 ? w : 0), 0);
  if (!(sum > 0) || weights.length === 0) return weights.map(() => 0);
  const out: number[] = [];
  let used = 0;
  for (let i = 0; i < weights.length; i++) {
    if (i === weights.length - 1) { out.push(round2(total - used)); break; }
    const a = round2(total * ((weights[i] > 0 ? weights[i] : 0) / sum));
    out.push(a);
    used += a;
  }
  return out;
}

export function projectInvoiceLines(input: ProjectInvoiceLinesInput): ProjectInvoiceLine[] {
  const total = Number(input.total) || 0;
  if (!(total > 0)) return [];
  const byId = new Map(input.services.map(s => [s.id, s]));
  const sold = (input.serviceIds || []).map(id => byId.get(id)).filter((s): s is InvoiceLineService => !!s);

  // 1. Explicit split typed by the owner.
  const mixParts = new Map<string, { line: string; pct: number }>();
  for (const m of input.serviceMix || []) {
    const k = key(m && m.line);
    const pct = Number(m && m.pct) || 0;
    if (!k || !(pct > 0)) continue;
    const prev = mixParts.get(k);
    mixParts.set(k, { line: prev ? prev.line : String(m.line).trim().replace(/\s+/g, ' '), pct: (prev ? prev.pct : 0) + pct });
  }
  if (mixParts.size > 0) {
    const parts = [...mixParts.entries()];
    const amounts = splitAmount(total, parts.map(([, p]) => p.pct));
    return parts.map(([k, p], i) => {
      const svc = sold.find(s => key(s.category) === k);
      return {
        ...(svc ? { serviceId: svc.id } : {}),
        serviceLine: p.line,
        description: withPeriod(`${p.line} – ${input.projectName}`, input.periodLabel),
        amount: amounts[i],
      };
    });
  }

  // 2. The services sold, by price.
  if (sold.length > 0) {
    const rateToAll = input.rateToAll || defaultRateToAll;
    const weights = sold.map(s => priceWeight(s, rateToAll));
    const usable = weights.some(w => w > 0) ? weights : sold.map(() => 1);
    const amounts = splitAmount(total, usable);
    return sold
      .map((s, i) => ({
        serviceId: s.id,
        ...(key(s.category) ? { serviceLine: String(s.category).trim().replace(/\s+/g, ' ') } : {}),
        description: withPeriod(s.name || s.title || input.projectName, input.periodLabel),
        amount: amounts[i],
      }))
      .filter(l => l.amount !== 0);
  }

  // 3. Nothing to split by.
  return [{ description: withPeriod(input.projectName, input.periodLabel), amount: round2(total) }];
}
