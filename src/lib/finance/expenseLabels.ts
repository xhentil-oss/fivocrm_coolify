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
  Office: 'Zyrë',
  Hosting: 'Hosting & Software',
  Marketing: 'Marketing',
  Travel: 'Udhëtim',
  Other: 'Tjetër',
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
