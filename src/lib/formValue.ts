// Turning a <select>/FormData value into something safe to WRITE to Firestore.
//
// Two failure modes this exists to stop, both found live in the expense form:
//
//  1. The sentinel leaked into the database. shadcn/Radix `Select` cannot hold an
//     empty string as an item value, so every "none" option is a sentinel like
//     `'__none__'`. `departmentId || undefined` keeps it (a non-empty string is
//     truthy), so `departmentId: '__none__'` was written as a real value. Such a
//     row then matches NEITHER filter — not "no department" (the field is set)
//     nor any real department (no team has that id) — so it disappeared from
//     both sides of every breakdown.
//
//  2. Clearing a field was impossible. `useMutation.update` runs
//     `removeUndefined()` by design, so `undefined` is DROPPED rather than
//     written — the previous value survives. Choosing "Asnjë projekt" on an
//     expense therefore left it attached to the project, and its cost kept
//     landing in that project's P&L. Only an explicit `null` actually clears.
//
// Hence two functions with deliberately different empty values: `undefined` when
// creating (omit the key entirely) and `null` when updating (clear the field).

/** Sentinels a "nothing selected" option can carry. */
const NONE_SENTINELS = new Set(['__none__', '__all__', '__add__', '']);

function normalize(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || NONE_SENTINELS.has(v)) return null;
  return v;
}

/** For CREATE: the value, or `undefined` so the key is omitted from the doc. */
export function createValue(raw: unknown): string | undefined {
  return normalize(raw) ?? undefined;
}

/** For UPDATE: the value, or `null` so the field is actually CLEARED. */
export function updateValue(raw: unknown): string | null {
  return normalize(raw);
}

/** True when the raw form value means "nothing selected". */
export function isNoneValue(raw: unknown): boolean {
  return normalize(raw) === null;
}

/** For UPDATE of a date: a real Date, or `null` to clear it. */
export function updateDateValue(raw: unknown): Date | null {
  const v = normalize(raw);
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** For CREATE of a date: a real Date, or `undefined` to omit the key. */
export function createDateValue(raw: unknown): Date | undefined {
  return updateDateValue(raw) ?? undefined;
}
