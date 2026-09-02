import { formatMoney, rangeLabel, rangeWindow, escapeHtml, effectiveDate, formatDateDMY, todayISO } from '../helpers.js'
import { BUDGET_TYPE_ORDER, EXPENSE_CATEGORIES, CATEGORY_ICONS } from '../categories.js'
import { getOrder, setOrder, getCollapsed, toggleCollapsed } from '../dashboardLayout.js'
import { computeCurrentLoggingStreak, computeBudgetStreak } from '../achievements.js'
import { openNetWorthQuickLog } from '../netWorthQuickLog.js'
import { netWorthTimeline } from '../analysisData.js'
import { billsDue } from '../recurringReminders.js'
import { openMarkPaidDialog } from '../markPaidDialog.js'

const RANGES = [1, 3, 6, 12]

export function renderDashboard(container, opts) {
  const { txns, budgets, year, month, range, onMonthChange, onRangeChange, networth, onNetWorthChanged, recurring, onBillsChanged } = opts
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

  // budget limits are monthly — scale to the window so "Budget vs Actual" stays meaningful across ranges.
  // Also drop any budget row whose category no longer exists (e.g. a removed
  // category like the old Subscriptions) — deleting a category from the
  // picker doesn't delete rows already saved for it in coin_budgets.
  const validCategoryNames = new Set(EXPENSE_CATEGORIES.map(c => c.name))
  const activeBudgets = budgets
    .filter(b => b.monthly_limit > 0 && validCategoryNames.has(b.category))
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
    streaks: {
      title: 'Streaks',
      body: renderStreaksBody(txns, budgets),
    },
    networth: {
      title: 'Net Worth',
      body: renderNetWorthWidgetBody(networth),
    },
    bills: {
      title: 'Bills Due',
      body: renderBillsDueWidgetBody(recurring),
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

  widgetsEl.querySelector('[data-widget="networth"] .networth-widget-body')?.addEventListener('click', () => {
    openNetWorthQuickLog({ networth, onSaved: onNetWorthChanged })
  })

  widgetsEl.querySelectorAll('.bill-mark-paid').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = (recurring || []).find(r => r.id === btn.dataset.id)
      if (item) openMarkPaidDialog({ item, onSaved: onBillsChanged })
    })
  })
}

function loggingStreakIcon(days) {
  if (days >= 30) return '👑'
  if (days >= 7) return '🔥'
  if (days >= 1) return '⚡'
  return '🌱'
}

function budgetStreakIcon(months) {
  if (months >= 3) return '🏆'
  if (months >= 1) return '🛡️'
  return '⚖️'
}

function renderStreaksBody(txns, budgets) {
  const loggingStreak = computeCurrentLoggingStreak(txns)
  const budgetStreak = computeBudgetStreak(txns, budgets)
  return `
    <div class="streak-row">
      <div class="streak-item">
        <div class="streak-icon">${loggingStreakIcon(loggingStreak)}</div>
        <div class="streak-value">${loggingStreak}</div>
        <div class="streak-label">Day${loggingStreak === 1 ? '' : 's'} Logged in a Row</div>
      </div>
      <div class="streak-item">
        <div class="streak-icon">${budgetStreakIcon(budgetStreak)}</div>
        <div class="streak-value">${budgetStreak}</div>
        <div class="streak-label">Month${budgetStreak === 1 ? '' : 's'} Under Budget</div>
      </div>
    </div>
  `
}

function renderNetWorthWidgetBody(networth) {
  const timeline = netWorthTimeline(networth)
  const latest = timeline[timeline.length - 1]
  const prev = timeline[timeline.length - 2]

  if (!latest) {
    return `
      <div class="networth-widget-body">
        <div class="networth-widget-icon">💰</div>
        <div class="networth-widget-main">
          <div class="networth-widget-label">No check-ins yet <span class="networth-widget-tap">· tap to log</span></div>
          <div class="networth-widget-val">—</div>
        </div>
      </div>
    `
  }

  const total = latest.total
  let deltaHtml = `<span class="networth-widget-date">${formatDateDMY(latest.date)}</span>`
  if (prev) {
    const delta = total - prev.total
    const sign = delta >= 0 ? '+' : '−'
    const color = delta >= 0 ? 'var(--green)' : 'var(--red)'
    deltaHtml = `<span style="color:${color}">${sign}${formatMoney(Math.abs(delta))}</span> from last`
  }

  const splitParts = [`Liquid ${formatMoney(latest.cash)}`, `Invested ${formatMoney(latest.invested)}`]
  if (latest.insurance > 0) splitParts.push(`Insurance ${formatMoney(latest.insurance)}`)

  return `
    <div class="networth-widget-body">
      <div class="networth-widget-icon">💰</div>
      <div class="networth-widget-main">
        <div class="networth-widget-label">Net Worth <span class="networth-widget-tap">· tap to log</span></div>
        <div class="networth-widget-val">${formatMoney(total)}</div>
        <div class="networth-widget-split">${splitParts.join(' · ')}</div>
        <div class="networth-widget-delta">${deltaHtml}</div>
      </div>
    </div>
  `
}

function renderBillsDueWidgetBody(recurring) {
  const due = billsDue(recurring)
  if (!due.length) return '<div class="empty-state">Nothing due right now.</div>'
  const today = todayISO()
  return due.map(r => {
    const overdue = r.next_due < today
    const progress = r.installments_total ? ` · ${r.installments_paid || 0} of ${r.installments_total} paid` : ''
    return `
      <div class="bill-row">
        <div class="bill-icon">${CATEGORY_ICONS[r.category] || '💵'}</div>
        <div class="bill-main">
          <div class="bill-name">${escapeHtml(r.subcategory || r.category)}</div>
          <div class="bill-meta ${overdue ? 'overdue' : ''}">${overdue ? 'Overdue' : 'Due'} ${formatDateDMY(r.next_due)}${progress}</div>
        </div>
        <div class="bill-amt">${formatMoney(r.amount)}</div>
        <button class="btn bill-mark-paid" data-id="${r.id}">Mark Paid</button>
      </div>
    `
  }).join('')
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
