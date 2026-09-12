import type { ClientHealthSignals, ClientHealthResult } from './health';
import { computeClientHealth, suggestProjectHealth } from './health';
import { PUBLISHED_STATUSES } from './workflow';
import { buildPeriod, isWithinPeriod } from './period';
import type { ClientRequest, Customer, Invoice, Project, Report } from '../../types';
import { getTimestampMs } from '../utils';

type Period = ReturnType<typeof buildPeriod>;

// ── Build the health SIGNALS for one customer from CRM data ─────────────────
//
// Extracted from ClientHealthView so the same definition of "at risk" can be
// rendered as a compact badge on Customer360 (which already loads this
// customer's projects / invoices / requests — zero extra reads) without
// duplicating the signal logic. `reports` is optional: the badge lives on the
// customers module, which may not have the reporting module's data.

export interface ClientHealthInputs {
  customer: Pick<Customer, 'id' | 'status'>;
  projects?: Project[] | null;
  invoices?: Invoice[] | null;
  requests?: ClientRequest[] | null;
  reports?: Report[] | null;
  now?: Date;
  period?: Period;
}

const CLOSED_PROJECT_STATUSES = ['Completed', 'Archived', 'Cancelled'];

export function buildClientHealthSignals(input: ClientHealthInputs): ClientHealthSignals {
  const now = input.now || new Date();
  const period = input.period || buildPeriod('monthly', now.toISOString().slice(0, 10));
  const id = input.customer.id;
  const custProjects = (input.projects || []).filter(p => p.customerId === id);
  const custInvoices = (input.invoices || []).filter(i => i.customerId === id);
  const custReports = (input.reports || []).filter(r => r.customerId === id);
  const custRequests = (input.requests || []).filter(r => r.customerId === id);

  // Worst project RAG among active projects — same engine as the project-status
  // report, so there is one definition of "at risk" across the product.
  const projectHealths = custProjects
    .filter(p => !CLOSED_PROJECT_STATUSES.includes(p.status))
    .map(p => suggestProjectHealth({
      projectStatus: 'active',
      daysToDeadline: p.endDate
        ? Math.round((getTimestampMs(p.endDate) - now.getTime()) / 86_400_000)
        : undefined,
      budgetConsumed: p.budget && p.spent ? p.spent / p.budget : undefined,
    }).health);
  const worst = projectHealths.includes('red') ? 'red'
    : projectHealths.includes('yellow') ? 'yellow'
      : projectHealths.length ? 'green' : undefined;

  const overdueInvoices = custInvoices.filter(i =>
    i.status !== 'Paid' && i.status !== 'Cancelled' && i.dueDate && getTimestampMs(i.dueDate) < now.getTime()).length;

  const hasReports = !!input.reports;
  const reportsInPeriod = custReports.filter(r => r.period?.start && isWithinPeriod(r.period.start, period));
  const delivered = reportsInPeriod.filter(r => PUBLISHED_STATUSES.has(r.status)).length;

  const latestPublished = custReports
    .filter(r => PUBLISHED_STATUSES.has(r.status))
    .sort((a, b) => (getTimestampMs(b.publishedAt) || 0) - (getTimestampMs(a.publishedAt) || 0))[0];
  const attainments = (latestPublished?.kpiValues || [])
    .filter(k => k.clientVisible && typeof k.value === 'number' && typeof k.target === 'number' && k.target !== 0)
    .map(k => (k.higherIsBetter === false
      ? Math.min(2, (k.target as number) / Math.max(1e-9, k.value as number))
      : (k.value as number) / (k.target as number)));
  const kpiAttainment = attainments.length
    ? attainments.reduce((a, b) => a + b, 0) / attainments.length
    : null;

  const openRequests = custRequests.filter(r => (r.status || '') !== 'Completed').length;
  const pendingApprovals = custReports.filter(r =>
    PUBLISHED_STATUSES.has(r.status) && !r.acknowledgedAt && !r.clientDecisionAt).length;

  const status = input.customer.status === 'Inactive' || input.customer.status === 'Suspended' ? 'paused' : 'active';

  return {
    status: status as ClientHealthSignals['status'],
    kpiAttainment,
    // Without the reporting module's data these are unknown (dropped from the
    // denominator by computeClientHealth), never scored as missing reports.
    reportsDelivered: hasReports ? delivered : undefined,
    reportsDue: hasReports ? (reportsInPeriod.length || (custProjects.length ? 1 : 0)) : undefined,
    openIssues: openRequests,
    overdueClientApprovals: hasReports ? pendingApprovals : undefined,
    overdueInvoices,
    worstProjectHealth: worst as ClientHealthSignals['worstProjectHealth'],
    unansweredMessages: openRequests,
  } as ClientHealthSignals;
}

export function computeCustomerHealth(input: ClientHealthInputs): ClientHealthResult {
  return computeClientHealth(buildClientHealthSignals(input));
}
