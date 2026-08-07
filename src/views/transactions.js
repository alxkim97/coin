import { formatMoney, monthLabel, monthRange, dateHeaderLabel, escapeHtml } from '../helpers.js'
import { CATEGORY_ICONS } from '../categories.js'

// persists across re-renders within the session (module-level, like the rest of the app's view state)
let filters = { q: '', category: 'All', min: '', max: '' }

export function renderTransactions(container, { txns, year, month, onMonthChange, onEditTxn }) {
  const { from, to } = monthRange(year, month)
  const monthTxns = txns.filter(t => t.date >= from && t.date <= to)
  const categories = ['All', ...new Set(monthTxns.map(t => t.category))].sort((a, b) => a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b))

  container.innerHTML = `
    <div class="top-bar"><h1>Transactions</h1></div>
    <div class="month-nav">
      <button id="prevMonth">‹</button>
      <div class="month-label">${monthLabel(year, month)}</div>
      <button id="nextMonth">›</button>
    </div>

    <div class="filter-bar">
      <input id="filterQ" type="text" placeholder="Search vendor or notes…" value="${escapeHtml(filters.q)}" />
      <div class="filter-row">
        <select id="filterCat">
          ${categories.map(c => `<option value="${escapeHtml(c)}" ${c === filters.category ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
        <input id="filterMin" type="number" inputmode="decimal" placeholder="Min ฿" value="${escapeHtml(filters.min)}" />
        <input id="filterMax" type="number" inputmode="decimal" placeholder="Max ฿" value="${escapeHtml(filters.max)}" />
      </div>
      <button class="filter-clear" id="clearFilters" style="display:none">Clear filters</button>
    </div>

    <div id="txnList"></div>
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

  function updateList() {
    const q = filters.q.trim().toLowerCase()
    const min = filters.min !== '' ? Number(filters.min) : null
    const max = filters.max !== '' ? Number(filters.max) : null
    const filtered = monthTxns.filter(t => {
      if (filters.category !== 'All' && t.category !== filters.category) return false
      if (min !== null && Number(t.amount) < min) return false
      if (max !== null && Number(t.amount) > max) return false
      if (q) {
        const hay = `${t.category} ${t.subcategory || ''} ${t.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    const groups = {}
    for (const t of filtered) {
      if (!groups[t.date]) groups[t.date] = []
      groups[t.date].push(t)
    }
    const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a))
    const hasFilters = q || filters.category !== 'All' || filters.min !== '' || filters.max !== ''
    container.querySelector('#clearFilters').style.display = hasFilters ? '' : 'none'

    const list = container.querySelector('#txnList')
    list.innerHTML = dates.length === 0
      ? `<div class="empty-state">${monthTxns.length === 0 ? 'No transactions this month yet.' : 'No transactions match these filters.'}</div>`
      : dates.map(date => `
        <div class="txn-date-header">${dateHeaderLabel(date)}</div>
        <div class="card">
          ${groups[date].map(t => `
            <div class="txn-row" data-id="${t.id}">
              <div class="txn-icon">${CATEGORY_ICONS[t.category] || '💵'}</div>
              <div class="txn-main">
                <div class="txn-cat">${escapeHtml(t.category)}</div>
                ${t.subcategory ? `<div class="txn-sub">${escapeHtml(t.subcategory)}</div>` : ''}
              </div>
              <div class="txn-amt ${t.type}">${t.type === 'income' ? '+' : '−'}${formatMoney(t.amount)}</div>
            </div>
          `).join('')}
        </div>
      `).join('')

    list.querySelectorAll('.txn-row').forEach(row => {
      row.onclick = () => {
        const txn = filtered.find(t => t.id === row.dataset.id)
        onEditTxn(txn)
      }
    })
  }

  container.querySelector('#filterQ').oninput = e => { filters.q = e.target.value; updateList() }
  container.querySelector('#filterCat').onchange = e => { filters.category = e.target.value; updateList() }
  container.querySelector('#filterMin').oninput = e => { filters.min = e.target.value; updateList() }
  container.querySelector('#filterMax').oninput = e => { filters.max = e.target.value; updateList() }
  container.querySelector('#clearFilters').onclick = () => {
    filters = { q: '', category: 'All', min: '', max: '' }
    container.querySelector('#filterQ').value = ''
    container.querySelector('#filterCat').value = 'All'
    container.querySelector('#filterMin').value = ''
    container.querySelector('#filterMax').value = ''
    updateList()
  }

  updateList()
}
