// Service-line mix: how ONE project (or one invoice) splits across departments.
//
// A department used to be a single free-text field on the project, so a client
// paying for SEO + Ads on one engagement put the whole fee — and the whole cost —
// into whichever department the project happened to be filed under. Ads looked
// like it earned nothing; SEO looked like it earned Ads' money.
//
// The service catalogue already knew better: `Service.category` is the service
// line, `project.serviceIds` says which services were sold, and
// `invoiceItems.serviceId` says which services were billed. This module turns
// that into weights. It owns no money of its own — the P&L engines multiply their
// figures by these weights, so Σ slices == the project's total by construction.
//
// Resolution order, most explicit first:
//   project:  `serviceMix` (typed by the owner) → `serviceIds` × price → `department`
//   invoice:  its own lines (`invoiceItems` → service category) → the project's mix
// A line with no category, or nothing at all, falls back to `project.department`,
// which is exactly the old behaviour: no service data ⇒ byte-identical results.

import type { Project, Service, InvoiceItem, TeamMember } from '../../types';
import { toAll } from '../utils';

/** Same label departmentPnl / revenueAttribution use for "no department". */
export const NO_SERVICE_LINE = 'Pa departament';

export interface LineShare {
  /** Department / service-line label (canonical spelling — see `createLineLabeler`). */
  line: string;
  /** Fraction of the whole, 0..1. The shares of one mix sum to 1. */
  weight: number;
}

/**
 * Canonicalises free-text line names so "SEO", "seo " and "Seo" are one
 * department. The four places a line is typed (service category, project
 * department, team department, member service lines) are all free text; matching
 * them case-sensitively would split one department into several rows. The FIRST
 * spelling seen wins, so pass the catalogue's categories in first.
 */
export type LineLabeler = (raw: unknown) => string;

export function lineKey(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

export function createLineLabeler(seed: Iterable<unknown> = []): LineLabeler {
  const labels = new Map<string, string>();
  const label: LineLabeler = (raw) => {
    const k = lineKey(raw);
    if (!k) return NO_SERVICE_LINE;
    const known = labels.get(k);
    if (known) return known;
    const spelled = (raw as string).trim().replace(/\s+/g, ' ');
    labels.set(k, spelled);
    return spelled;
  };
  for (const s of seed) label(s);
  return label;
}

/**
 * The labeler every engine must use, seeded in ONE fixed order (catalogue
 * categories, then project departments). The department P&L and the collected
 * column are merged by label on Financat; seeding them differently would let
 * "seo" win in one and "SEO" in the other, and the row would split in two.
 */
export function labelerFor(
  services: Array<Pick<Service, 'category'>> | null | undefined,
  projects: Array<Pick<Project, 'department'>> | null | undefined,
): LineLabeler {
  return createLineLabeler([
    ...(services || []).map(s => s.category),
    ...(projects || []).map(p => (p as any)?.department),
  ]);
}

/** Merge duplicate lines and normalise to Σ weight = 1. Empty / zero input → []. */
export function normalizeMix(parts: Array<{ line: string; amount: number }>): LineShare[] {
  const byLine = new Map<string, number>();
  for (const p of parts) {
    if (!(p.amount > 0)) continue;
    byLine.set(p.line, (byLine.get(p.line) || 0) + p.amount);
  }
  const total = [...byLine.values()].reduce((s, v) => s + v, 0);
  if (!(total > 0)) return [];
  return [...byLine.entries()]
    .map(([line, amount]) => ({ line, weight: amount / total }))
    .sort((a, b) => b.weight - a.weight || a.line.localeCompare(b.line));
}

/** The whole project in its own department — the legacy, single-line answer. */
export function departmentMix(project: Pick<Project, 'department'> | undefined, label: LineLabeler): LineShare[] {
  return [{ line: label((project as any)?.department), weight: 1 }];
}

/**
 * How a project's fee splits across service lines.
 *
 *   1. `project.serviceMix` — an explicit split the owner typed (e.g. SEO 40 / Ads 60);
 *   2. `project.serviceIds` — the services sold, weighted by catalogue price (all
 *      prices 0 ⇒ equally). A service with no category counts for the project's
 *      own department, so it is never dropped;
 *   3. `project.department` — the whole fee in one line (the old model).
 */
export function projectServiceMix(
  project: Project,
  servicesById: Map<string, Service>,
  label: LineLabeler,
): LineShare[] {
  const explicit = (project as any).serviceMix as Project['serviceMix'];
  if (Array.isArray(explicit) && explicit.length > 0) {
    const mix = normalizeMix(explicit.map(s => ({ line: label(s?.line), amount: Number(s?.pct) || 0 })));
    if (mix.length) return mix;
  }

  const ownDept = label((project as any).department);
  const sold = (project.serviceIds || [])
    .map(id => servicesById.get(id))
    .filter((s): s is Service => !!s);
  if (sold.length > 0) {
    const priced = sold.map(s => ({
      line: lineKey(s.category) ? label(s.category) : ownDept,
      amount: toAll(Number(s.price) || 0, s.currency),
    }));
    const byPrice = normalizeMix(priced);
    if (byPrice.length) return byPrice;
    const equal = normalizeMix(priced.map(p => ({ line: p.line, amount: 1 })));
    if (equal.length) return equal;
  }

  return departmentMix(project, label);
}

/** Amount a line item stands for (its total, else quantity × unit price). */
export function invoiceItemAmount(item: Pick<InvoiceItem, 'totalPrice' | 'quantity' | 'unitPrice'>): number {
  const total = Number(item.totalPrice);
  if (Number.isFinite(total) && total !== 0) return total;
  return (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
}

/**
 * How ONE invoice's money splits across service lines, from its own lines.
 *
 * Weights, not amounts: an invoice's lines often do not add up to its total (a
 * project priced by budget writes the catalogue prices as lines, a discount is
 * applied to the whole), so each line contributes its SHARE of the lines and the
 * caller multiplies the money actually collected by it. A line with no service
 * (a free-text "Projekti X – Gusht" line) is spread by `fallback` — the project's
 * mix — rather than dumped on one department.
 */
export function invoiceServiceMix(
  items: InvoiceItem[] | undefined | null,
  servicesById: Map<string, Service>,
  label: LineLabeler,
  fallback: LineShare[],
): LineShare[] {
  const parts: Array<{ line: string; amount: number }> = [];
  for (const it of items || []) {
    const amount = invoiceItemAmount(it);
    if (!(amount > 0)) continue;
    const svc = it.serviceId ? servicesById.get(it.serviceId) : undefined;
    if (svc && lineKey(svc.category)) {
      parts.push({ line: label(svc.category), amount });
    } else {
      for (const f of fallback) parts.push({ line: f.line, amount: amount * f.weight });
    }
  }
  const mix = normalizeMix(parts);
  return mix.length ? mix : fallback;
}

/** The service lines a person's work belongs to (`serviceLines`, else the legacy singular). */
export function memberServiceLines(m: Pick<TeamMember, 'serviceLines' | 'serviceLine'> | undefined, label: LineLabeler): string[] {
  if (!m) return [];
  const raw = Array.isArray(m.serviceLines) && m.serviceLines.length ? m.serviceLines : (m.serviceLine ? [m.serviceLine] : []);
  return [...new Set(raw.filter(r => lineKey(r)).map(r => label(r)))];
}

/**
 * Where one person's cost on a project goes.
 *
 * The cost follows the person's craft WITHIN the project: an SEO specialist's
 * hours on an SEO + Ads engagement belong to the SEO line, the Ads specialist's
 * to Ads. Someone on several of the project's lines is split by the project's own
 * weights over those lines. A person whose lines the project does not sell (or
 * who has none) is spread by the project's mix — the cost follows the revenue it
 * produced, never a department that earned nothing from this project.
 */
export function memberLaborSplit(memberLines: string[], projectMix: LineShare[]): LineShare[] {
  if (projectMix.length <= 1 || memberLines.length === 0) return projectMix;
  const own = new Set(memberLines);
  const overlap = projectMix.filter(s => own.has(s.line));
  if (overlap.length === 0) return projectMix;
  return normalizeMix(overlap.map(s => ({ line: s.line, amount: s.weight })));
}

/** Weight of `line` in `mix` (0 when absent). */
export function weightOf(mix: LineShare[], line: string): number {
  return mix.find(s => s.line === line)?.weight || 0;
}

/**
 * Clean the "Ndarja sipas shërbimit" form rows before saving: drop empty lines
 * and non-positive %, merge spelling variants of one line (first spelling wins),
 * round to 2 decimals. Returns [] when nothing usable is left (= derived split).
 */
export function cleanServiceMixInput(rows: Array<{ line?: unknown; pct?: unknown }> | null | undefined): Array<{ line: string; pct: number }> {
  const out = new Map<string, { line: string; pct: number }>();
  for (const r of rows || []) {
    const k = lineKey(r?.line);
    const pct = Number(r?.pct);
    if (!k || !Number.isFinite(pct) || pct <= 0) continue;
    const prev = out.get(k);
    if (prev) prev.pct += pct;
    else out.set(k, { line: String(r!.line).trim().replace(/\s+/g, ' '), pct });
  }
  return [...out.values()].map(r => ({ line: r.line, pct: Math.round(r.pct * 100) / 100 }));
}
