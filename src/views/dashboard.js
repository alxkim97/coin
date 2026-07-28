import { formatMoney, rangeLabel, rangeWindow, escapeHtml, effectiveDate } from '../helpers.js'
import { BUDGET_TYPE_ORDER } from '../categories.js'
import { getOrder, setOrder, getCollapsed, toggleCollapsed } from '../dashboardLayout.js'

const RANGES = [1, 3, 6, 12]

export function renderDashboard(container, opts) {
  const { txns, budgets, year, month, range, onMonthChange, onRangeChange } = opts
  const { from, to } = rangeWindow(year, month, range)
  const rangeTxns = txns.filter(t => { const d = effectiveDate(t); return d >= from && d <= to })

  const income = rangeTxns.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
  const expense = rangeTxns.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
  const net = income - expense

  const spentByCategory = {}
  const spentByVendor = {}
  for (const t of rangeTxns) {
    if (t.type !== 'expense') continue
    spentByCategory[t.category] = (spentByCategory[t.category] || 0) + Number(t.amount)
    const vendor = t.subcategory || null
    if (!vendor) continue
    if (!spentByVendor[vendor]) spentByVendor[vendor] = { amount: 0, count: 0 }
    spentByVendor[vendor].amount += Number(t.amount)
    spentByVendor[vendor].count += 1
  }
  const topVendors = Object.entries(spentByVendor).sort((a, b) => b[1].amount - a[1].amount).slice(0, 5)

  // budget limits are monthly — scale to the window so "Budget vs Actual" stays meaningful across ranges
  const activeBudgets = budgets
    .filter(b => b.monthly_limit > 0)
    .sort((a, b) => BUDGET_TYPE_ORDER.indexOf(a.budget_type) - BUDGET_TYPE_ORDER.indexOf(b.budget_type))

  const widgets = {
    budget: {
      title: `Budget vs Actual${range > 1 ? ` (×${range} mo.)` : ''}`,
      body: activeBudgets.length === 0 ? '<div class="empty-state">No budgets set yet. Add limits in Settings.</div>' : activeBudgets.map(b => {
        const limit = b.monthly_limit * range
        const spent = spentByCategory[b.category] || 0
        const pct = Math.min(100, (spent / limit) * 100)
        const cls = spent > limit ? 'over' : (pct >= 80 ? 'warn' : '')
        return `
          <div class="budget-row">
            <div class="budget-row-top">
              <span class="cat">${b.category}</span>
              <span class="nums">${formatMoney(spent)} / ${formatMoney(limit)}</span>
            </div>
            <div class="budget-bar-track"><div class="budget-bar-fill ${cls}" style="width:${pct}%"></div></div>
          </div>
        `
      }).join(''),
    },
    category: {
      title: 'By Category',
      body: Object.keys(spentByCategory).length === 0 ? '<div class="empty-state">No expenses in this period.</div>' :
        Object.entries(spentByCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => `
          <div class="budget-row">
            <div class="budget-row-top">
              <span class="cat">${cat}</span>
              <span class="nums">${formatMoney(amt)}</span>
            </div>
            <div class="budget-bar-track"><div class="budget-bar-fill" style="width:${expense ? (amt / expense) * 100 : 0}%"></div></div>
          </div>
        `).join(''),
    },
    vendors: {
      title: 'Top Vendors',
      body: topVendors.length === 0 ? '<div class="empty-state">No vendor/note data in this period.</div>' :
        topVendors.map(([name, d], i) => `
          <div class="vendor-row">
            <div class="vendor-rank">${i + 1}</div>
            <div class="vendor-name">${escapeHtml(name)}</div>
            <div class="vendor-count">×${d.count}</div>
            <div class="vendor-amt">${formatMoney(d.amount)}</div>
          </div>
        `).join(''),
    },
  }

  const order = getOrder()
  const collapsed = getCollapsed()

  container.innerHTML = `
    <div class="top-bar"><h1>Dashboard</h1></div>
    <div class="range-toggle" id="rangeToggle">
      ${RANGES.map(r => `<button data-range="${r}" class="${r === range ? 'active' : ''}">${r === 1 ? '1M' : r + 'M'}</button>`).join('')}
    </div>
    <div class="month-nav">
      <button id="prevMonth">‹</button>
      <div class="month-label">${rangeLabel(year, month, range)}</div>
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

    <div id="dashWidgets">
      ${order.map(id => widgetRowHtml(id, widgets[id], collapsed.has(id))).join('')}
    </div>
  `

  container.querySelector('#rangeToggle').querySelectorAll('button').forEach(btn => {
    btn.onclick = () => onRangeChange(Number(btn.dataset.range))
  })
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

  const widgetsEl = container.querySelector('#dashWidgets')
  widgetsEl.querySelectorAll('.widget-toggle').forEach(btn => {
    btn.onclick = () => { toggleCollapsed(btn.dataset.widget); renderDashboard(container, opts) }
  })
  setupDragReorder(widgetsEl)
}

function widgetRowHtml(id, def, isCollapsed) {
  return `
    <div class="dash-widget" data-widget="${id}">
      <div class="dash-widget-head">
        <button class="drag-handle" data-widget="${id}" aria-label="Drag to reorder">⠿</button>
        <h2>${def.title}</h2>
        <button class="widget-toggle" data-widget="${id}" aria-label="${isCollapsed ? 'Expand' : 'Collapse'} section">${isCollapsed ? '⌄' : '⌃'}</button>
      </div>
      ${isCollapsed ? '' : `<div class="card">${def.body}</div>`}
    </div>
  `
}

function setupDragReorder(widgetsEl) {
  widgetsEl.querySelectorAll('.drag-handle').forEach(handle => {
    handle.addEventListener('pointerdown', (e) => {
      const dragging = handle.closest('.dash-widget')
      if (!dragging) return
      e.preventDefault()
      dragging.classList.add('dragging')

      const onMove = (ev) => {
        const siblings = [...widgetsEl.querySelectorAll('.dash-widget')].filter(w => w !== dragging)
        for (const sib of siblings) {
          const rect = sib.getBoundingClientRect()
          const mid = rect.top + rect.height / 2
          const sibIsAfter = !!(dragging.compareDocumentPosition(sib) & Node.DOCUMENT_POSITION_FOLLOWING)
          if (sibIsAfter && ev.clientY > mid) {
            widgetsEl.insertBefore(dragging, sib.nextSibling)
            break
          } else if (!sibIsAfter && ev.clientY < mid) {
            widgetsEl.insertBefore(dragging, sib)
            break
          }
        }
      }
      const onUp = () => {
        dragging.classList.remove('dragging')
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        const newOrder = [...widgetsEl.querySelectorAll('.dash-widget')].map(w => w.dataset.widget)
        setOrder(newOrder)
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    })
  })
}
