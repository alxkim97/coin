export const EXPENSE_CATEGORIES = [
  { name: 'Rent', type: 'Fixed Essential' },
  { name: 'Insurance', type: 'Fixed Essential' },
  { name: 'Internet', type: 'Fixed Essential' },
  { name: 'Subscriptions', type: 'Fixed Essential' },
  { name: 'Bank/Finance', type: 'Fixed Essential' },
  { name: 'Food', type: 'Variable Essential' },
  { name: 'Groceries', type: 'Variable Essential' },
  { name: 'Transport', type: 'Variable Essential' },
  { name: 'Health', type: 'Variable Essential' },
  { name: 'Utilities', type: 'Variable Essential' },
  { name: 'Investment', type: 'Investment' },
  { name: 'Shopping', type: 'Discretionary' },
  { name: 'Social', type: 'Discretionary' },
  { name: 'Travel', type: 'Discretionary' },
  { name: 'Education', type: 'Discretionary' },
  { name: 'Other', type: 'Discretionary' },
]

export const INCOME_CATEGORIES = [
  'Salary',
  'Reimbursement',
  'Bonus',
  'Overtime',
  'Investment Returns',
  'Other',
]

export const BUDGET_TYPE_ORDER = ['Fixed Essential', 'Variable Essential', 'Investment', 'Discretionary']

export function categoryBudgetType(name) {
  const found = EXPENSE_CATEGORIES.find(c => c.name === name)
  return found ? found.type : 'Discretionary'
}

// One-time seed pulled from the "SUB-BUDGET LIMITS" table in Income-Expense.xlsx
// (Monthly Tracker sheet), as of Jul 2026. Categories not listed there (Health,
// Bank/Finance, Education, Travel) are left with no suggested limit.
export const SUGGESTED_BUDGET_LIMITS = {
  Rent: 8000,
  Utilities: 3065, // Common Fee 2,500 + Electricity 450 + Water 115
  Insurance: 4166.67, // 20/20 investment installment
  Internet: 997, // Truemove 462 + AIS 535
  Subscriptions: 371.58, // Hevy Pro 61.58 + Claude Pro 310
  Groceries: 6000,
  Food: 1000, // "Meals / Food" line
  Transport: 2000, // Gas
  Investment: 2100, // SCBS&P500e 1,680 + GLD 420
  Shopping: 800, // Shopee
  Social: 400, // "Social / Date"
  Other: 800, // "Other Wants" catch-all (games/clothes/travel/misc in the sheet)
}
