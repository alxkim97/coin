import { formatMoney, monthLabel, monthRange } from '../helpers.js'
import { BUDGET_TYPE_ORDER } from '../categories.js'

export function renderDashboard(container, { txns, budgets, year, month, onMonthChange }) {
  const { from, to } = monthRange(year, month)
  const monthTxns = txns.filter(t => t.date >= from && t.date <= to)

  const income = monthTxns.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
  const expense = monthTxns.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
  const net = income - expense

  const spentByCategory = {}
  for (const t of monthTxns) {
    if (t.type !== 'expense') continue
    spentByCategory[t.category] = (spentByCategory[t.category] || 0) + Number(t.amount)
  }

  const budgetMap = {}
  for (const b of budgets) budgetMap[b.category] = b

  const activeBudgets = budgets
    .filter(b => b.monthly_limit > 0)
    .sort((a, b) => BUDGET_TYPE_ORDER.indexOf(a.budget_type) - BUDGET_TYPE_ORDER.indexOf(b.budget_type))

  container.innerHTML = `
    <div class="top-bar"><h1>Dashboard</h1></div>
    <div class="month-nav">
      <button id="prevMonth">‹</button>
      <div class="month-label">${monthLabel(year, month)}</div>
      <button id="nextMonth">›</button>
    </div>

    <div class="card">
      <div class="summary-grid">
        <div class="summary-tile">
          <div class="label">Income</div>
          <div class="value income">${formatMoney(income)}</div>
        </div>
        <div class="summary-tile">
          <div class="label">Expense</div>
          <div class="value expense">${formatMoney(expense)}</div>
        </div>
        <div class="summary-tile">
          <div class="label">Net</div>
          <div class="value" style="color:${net >= 0 ? 'var(--green)' : 'var(--red)'}">${formatMoney(net)}</div>
        </div>
      </div>
    </div>

    <h2>Budget vs Actual</h2>
    <div class="card">
      ${activeBudgets.length === 0 ? '<div class="empty-state">No budgets set yet. Add limits in Settings.</div>' : activeBudgets.map(b => {
        const spent = spentByCategory[b.category] || 0
        const pct = Math.min(100, (spent / b.monthly_limit) * 100)
        const cls = spent > b.monthly_limit ? 'over' : (pct >= 80 ? 'warn' : '')
        return `
          <div class="budget-row">
            <div class="budget-row-top">
              <span class="cat">${b.category}</span>
              <span class="nums">${formatMoney(spent)} / ${formatMoney(b.monthly_limit)}</span>
            </div>
            <div class="budget-bar-track"><div class="budget-bar-fill ${cls}" style="width:${pct}%"></div></div>
          </div>
        `
      }).join('')}
    </div>

    <h2>By Category</h2>
    <div class="card">
      ${Object.keys(spentByCategory).length === 0 ? '<div class="empty-state">No expenses yet this month.</div>' :
        Object.entries(spentByCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => `
          <div class="budget-row">
            <div class="budget-row-top">
              <span class="cat">${cat}</span>
              <span class="nums">${formatMoney(amt)}</span>
            </div>
            <div class="budget-bar-track"><div class="budget-bar-fill" style="width:${expense ? (amt / expense) * 100 : 0}%"></div></div>
          </div>
        `).join('')}
    </div>
  `

  container.querySelector('#prevMonth').onclick = () => {
    const m = month === 0 ? 11 : month - 1
    const y = month === 0 ? year - 1 : year
    onMonthChange(y, m)
  }
  container.querySelector('#nextMonth').onclick = () => {
    const m = month === 11 ? 0 : month + 1
    const y = month === 11 ? year + 1 : year
    onMonthChange(y, m)
  }
}
