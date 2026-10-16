import { describe, it, expect } from 'vitest';
import {
  EXPENSE_CATEGORY_LABELS,
  DEFAULT_EXPENSE_CATEGORIES,
  findBuiltInExpenseCategory,
  expenseCategoryLabel,
} from './expenseLabels';

describe('expense category labels', () => {
  it('the picker and the list read ONE table', () => {
    for (const c of DEFAULT_EXPENSE_CATEGORIES) expect(expenseCategoryLabel(c.value)).toBe(c.label);
    expect(DEFAULT_EXPENSE_CATEGORIES.map(c => c.value)).toEqual(Object.keys(EXPENSE_CATEGORY_LABELS));
    expect(DEFAULT_EXPENSE_CATEGORIES[0]).toEqual({ value: 'Salary', label: 'Paga' });
  });

  it('former labels of Office still resolve to the built-in (stored value unchanged)', () => {
    expect(findBuiltInExpenseCategory('Zyrë')?.value).toBe('Office');
    expect(findBuiltInExpenseCategory(' furnizime zyre ')?.value).toBe('Office');
    expect(findBuiltInExpenseCategory('Office')?.value).toBe('Office');
    expect(findBuiltInExpenseCategory('paga')?.value).toBe('Salary');
    expect(findBuiltInExpenseCategory('Kafe')).toBeUndefined();
  });
});
