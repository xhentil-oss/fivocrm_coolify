import { describe, it, expect } from 'vitest';
import { grantsCanAssignTasks, sameTenant } from './memberOverrides';

const row = (o: Partial<Parameters<typeof grantsCanAssignTasks>[1] & {}> = {}) => ({
  teamId: 't1', businessId: 'b1', role: 'Member', status: 'Active', canAssignTasks: false, ...o,
});

describe('grantsCanAssignTasks', () => {
  it('is false for a plain Member with no override', () => {
    const m = row();
    expect(grantsCanAssignTasks([m], m)).toBe(false);
  });

  it('is true when the anchor row itself grants it', () => {
    const m = row({ canAssignTasks: true });
    expect(grantsCanAssignTasks([m], m)).toBe(true);
  });

  it('reads the grant from a SIBLING row of the same business (the row the admin ticked)', () => {
    const picked = row({ teamId: 't1' });
    const ticked = row({ teamId: 't2', canAssignTasks: true });
    // Fetch order put the un-ticked row first → it became the "best" membership.
    expect(grantsCanAssignTasks([picked, ticked], picked)).toBe(true);
  });

  it('ignores a grant on a row of ANOTHER business', () => {
    const picked = row({ businessId: 'b1' });
    const other = row({ businessId: 'b2', teamId: 't9', canAssignTasks: true });
    expect(grantsCanAssignTasks([picked, other], picked)).toBe(false);
  });

  it('ignores an Inactive row', () => {
    const picked = row();
    const old = row({ teamId: 't2', canAssignTasks: true, status: 'Inactive' });
    expect(grantsCanAssignTasks([picked, old], picked)).toBe(false);
  });

  it('never grants a Viewer or Guest, even if the row says so', () => {
    const v = row({ role: 'Viewer', canAssignTasks: true });
    expect(grantsCanAssignTasks([v], v)).toBe(false);
    const g = row({ role: 'Guest', canAssignTasks: true });
    expect(grantsCanAssignTasks([g], g)).toBe(false);
    // …and a Viewer sibling row does not lend the right to a Member row either.
    const m = row();
    expect(grantsCanAssignTasks([m, row({ teamId: 't2', role: 'Viewer', canAssignTasks: true })], m)).toBe(false);
  });

  it('falls back to the anchor when the list is empty, and to the team when businessId is missing', () => {
    const m = row({ canAssignTasks: true });
    expect(grantsCanAssignTasks([], m)).toBe(true);
    const legacyAnchor = row({ businessId: undefined, teamId: 't1' });
    const legacyGrant = row({ businessId: undefined, teamId: 't1', canAssignTasks: true });
    expect(sameTenant(legacyGrant, legacyAnchor)).toBe(true);
    expect(grantsCanAssignTasks([legacyAnchor, legacyGrant], legacyAnchor)).toBe(true);
    expect(grantsCanAssignTasks([legacyAnchor, row({ businessId: undefined, teamId: 't2', canAssignTasks: true })], legacyAnchor)).toBe(false);
  });
});
