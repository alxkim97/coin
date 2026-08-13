export const EXPENSE_CATEGORIES = [
  { name: 'Rent', type: 'Fixed Essential' },
  { name: 'Insurance', type: 'Fixed Essential' },
  { name: 'Internet', type: 'Fixed Essential' },
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

export const CATEGORY_ICONS = {
  Rent: '🏠', Insurance: '🛡️', Internet: '📶', 'Bank/Finance': '🏦',
  Food: '🍜', Groceries: '🛒', Transport: '🚗', Health: '💊', Utilities: '💡',
  Investment: '📈', Shopping: '🛍️', Social: '🎉', Travel: '✈️', Education: '📚', Other: '📦',
  Salary: '💰', Reimbursement: '↩️', Bonus: '🎁', Overtime: '⏱️', 'Investment Returns': '📊',
}

export function categoryBudgetType(name) {
  const found = EXPENSE_CATEGORIES.find(c => c.name === name)
  return found ? found.type : 'Discretionary'
}
