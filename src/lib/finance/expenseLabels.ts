// Labels shared by the expense list and the expense/series page. One table, so
// a category or cadence is never spelled two ways on two screens.

export const EXPENSE_FREQ_LABELS: Record<string, string> = {
  weekly: 'Javore',
  monthly: 'Mujore',
  quarterly: 'Tremujore',
  yearly: 'Vjetore',
};

export const expenseFreqLabel = (f?: string | null): string => (f ? (EXPENSE_FREQ_LABELS[f] || f) : '');

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  Salary: 'Paga',
  Rent: 'Qira',
  Utilities: 'Shërbime (Ujë, Dritë)',
  // ONE spelling. The list said "Zyrë" while the form's picker said "Furnizime
  // Zyre", so the same row read as two different categories on two screens.
  // The stored VALUE never changed ('Office'); the old labels live on as
  // aliases below so a custom category typed with either is still recognised.
  Office: 'Furnizime zyre',
  Hosting: 'Hosting & Software',
  Marketing: 'Marketing',
  Travel: 'Udhëtim',
  Other: 'Tjetër',
};

/** Former labels of a built-in, still reserved (a custom category with one of these names IS the built-in). */
export const EXPENSE_CATEGORY_LABEL_ALIASES: Record<string, string[]> = {
  Office: ['Zyrë', 'Zyre', 'Furnizime Zyre', 'Furnizime zyrë'],
};

/** The built-ins in picker order — the form's list, derived from the one table. */
export const DEFAULT_EXPENSE_CATEGORIES: { value: string; label: string }[] =
  Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => ({ value, label }));

const normCat = (s: string) => s.trim().toLowerCase();

/** The built-in a typed name refers to — by value, current label or a former label. */
export const findBuiltInExpenseCategory = (name: string): { value: string; label: string } | undefined => {
  const n = normCat(name);
  return DEFAULT_EXPENSE_CATEGORIES.find(c =>
    normCat(c.value) === n
    || normCat(c.label) === n
    || (EXPENSE_CATEGORY_LABEL_ALIASES[c.value] || []).some(a => normCat(a) === n));
};

export const expenseCategoryLabel = (c?: string | null): string => (c ? (EXPENSE_CATEGORY_LABELS[c] || c) : '');

export const EXPENSE_CATEGORY_CLASSES: Record<string, string> = {
  Salary: 'bg-blue-100 text-blue-800',
  Rent: 'bg-accent-soft text-primary',
  Utilities: 'bg-yellow-100 text-yellow-800',
  Office: 'bg-green-100 text-green-800',
  Hosting: 'bg-navy-700/10 text-navy-700',
};

export const expenseCategoryClass = (c?: string | null): string =>
  (c && EXPENSE_CATEGORY_CLASSES[c]) || 'bg-gray-100 text-gray-800';
