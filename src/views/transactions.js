import { formatMoney, monthLabel, monthRange, dateHeaderLabel } from '../helpers.js'

const CATEGORY_ICONS = {
  Rent: '🏠', Insurance: '🛡️', Internet: '📶', Subscriptions: '🔁', 'Bank/Finance': '🏦',
  Food: '🍜', Groceries: '🛒', Transport: '🚗', Health: '💊', Utilities: '💡',
  Investment: '📈', Shopping: '🛍️', Social: '🎉', Travel: '✈️', Education: '📚', Other: '📦',
  Salary: '💰', Reimbursement: '↩️', Bonus: '🎁', Overtime: '⏱️', 'Investment Returns': '📊',
}

export function renderTransactions(container, { txns, year, month, onMonthChange, onEditTxn }) {
  const { from, to } = monthRange(year, month)
  const monthTxns = txns.filter(t => t.date >= from && t.date <= to)

  const groups = {}
  for (const t of monthTxns) {
    if (!groups[t.date]) groups[t.date] = []
    groups[t.date].push(t)
  }
  const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a))

  container.innerHTML = `
    <div class="top-bar"><h1>Transactions</h1></div>
    <div class="month-nav">
      <button id="prevMonth">‹</button>
      <div class="month-label">${monthLabel(year, month)}</div>
      <button id="nextMonth">›</button>
    </div>
    <div id="txnList">
      ${dates.length === 0 ? '<div class="empty-state">No transactions this month yet.</div>' : dates.map(date => `
        <div class="txn-date-header">${dateHeaderLabel(date)}</div>
        <div class="card">
          ${groups[date].map(t => `
            <div class="txn-row" data-id="${t.id}">
              <div class="txn-icon">${CATEGORY_ICONS[t.category] || '💵'}</div>
              <div class="txn-main">
                <div class="txn-cat">${t.category}</div>
                ${t.subcategory ? `<div class="txn-sub">${t.subcategory}</div>` : ''}
              </div>
              <div class="txn-amt ${t.type}">${t.type === 'income' ? '+' : '−'}${formatMoney(t.amount)}</div>
            </div>
          `).join('')}
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
  container.querySelectorAll('.txn-row').forEach(row => {
    row.onclick = () => {
      const txn = monthTxns.find(t => t.id === row.dataset.id)
      onEditTxn(txn)
    }
  })
}
