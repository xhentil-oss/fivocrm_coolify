/**
 * Task dependency ("Bllokohet nga") graph helpers — import-free and pure.
 *
 * A blocker that (directly or through a chain) already waits on the task itself
 * closes a cycle: A waits on B, B waits on A, and `completeTask`'s blocker guard
 * then refuses BOTH forever. The picker must refuse such an edge up front.
 */

export interface DependencyNode {
  id: string;
  dependsOn?: readonly string[] | null;
}

/**
 * True when making `taskId` depend on `blockerId` would create a cycle, i.e.
 * `taskId` is reachable from `blockerId` by following `dependsOn` (or the two
 * are the same task). Unknown ids are leaves; a cycle that already exists
 * elsewhere in the graph cannot loop the walk (visited set).
 */
export function wouldCreateDependencyCycle(
  taskId: string,
  blockerId: string,
  tasks: readonly DependencyNode[] | null | undefined,
): boolean {
  if (!taskId || !blockerId) return false;
  if (taskId === blockerId) return true;
  const byId = new Map<string, DependencyNode>();
  for (const t of tasks || []) byId.set(t.id, t);
  const seen = new Set<string>();
  const stack: string[] = [blockerId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of byId.get(id)?.dependsOn || []) {
      if (next && !seen.has(next)) stack.push(next);
    }
  }
  return false;
}
