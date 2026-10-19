import { describe, it, expect } from 'vitest';
import { wouldCreateDependencyCycle } from './taskDependencies';

describe('wouldCreateDependencyCycle', () => {
  it('refuses a task blocking itself', () => {
    expect(wouldCreateDependencyCycle('a', 'a', [])).toBe(true);
  });

  it('refuses the direct A↔B cycle', () => {
    const tasks = [{ id: 'a' }, { id: 'b', dependsOn: ['a'] }];
    expect(wouldCreateDependencyCycle('a', 'b', tasks)).toBe(true);
  });

  it('refuses a transitive cycle A → B → C → A', () => {
    const tasks = [{ id: 'a' }, { id: 'b', dependsOn: ['c'] }, { id: 'c', dependsOn: ['a'] }];
    expect(wouldCreateDependencyCycle('a', 'b', tasks)).toBe(true);
  });

  it('accepts an acyclic edge', () => {
    const tasks = [{ id: 'a' }, { id: 'b', dependsOn: ['c'] }, { id: 'c' }];
    expect(wouldCreateDependencyCycle('a', 'b', tasks)).toBe(false);
  });

  it('terminates on a pre-existing cycle elsewhere and on unknown ids', () => {
    const tasks = [{ id: 'a' }, { id: 'b', dependsOn: ['c', 'ghost'] }, { id: 'c', dependsOn: ['b'] }];
    expect(wouldCreateDependencyCycle('a', 'b', tasks)).toBe(false);
  });

  it('handles missing inputs', () => {
    expect(wouldCreateDependencyCycle('a', 'b', null)).toBe(false);
    expect(wouldCreateDependencyCycle('', 'b', [])).toBe(false);
  });
});
