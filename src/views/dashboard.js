import { formatMoney, rangeLabel, rangeWindow, escapeHtml, effectiveDate, formatDateDMY, todayISO, toast } from '../helpers.js'
import { BUDGET_TYPE_ORDER, EXPENSE_CATEGORIES, categoryBudgetType } from '../categories.js'
import { getOrder, setOrder, getCollapsed, toggleCollapsed } from '../dashboardLayout.js'
import { isDesktopView } from '../platform.js'
import { computeCurrentLoggingStreak, computeBudgetStreak } from '../achievements.js'
import { openNetWorthCheckins } from '../netWorthCheckins.js'
import { openGoals } from '../goalsDialog.js'
import { netWorthTimeline, goalProgress } from '../analysisData.js'
import { billsDue } from '../recurringReminders.js'
import { openMarkPaidDialog } from '../markPaidDialog.js'
import { addTransaction, deleteSuggestion } from '../supabase.js'
import { icon, categoryIcon } from '../icons.js'
import { monthPickerHtml, wireMonthPicker } from '../monthPicker.js'

const RANGES = [1, 3, 6, 12]

export function renderDashboard(container, opts) {
  const { txns, budgets, year, month, range, onMonthChange, onRangeChange, networth, onNetWorthChanged, recurring, onBillsChanged, suggestions, onSuggestionsChanged, goals, onGoalsChanged, customizing } = opts
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

  // `empty` = the one-line text a widget collapses to when it has nothing to
  // show, instead of a full card holding a single sentence
  const widgets = {
    budget: {
      title: `Budget vs actual${range > 1 ? ` (×${range} mo.)` : ''}`,
      empty: activeBudgets.length ? null : 'No limits set',
      body: activeBudgets.length === 0 ? '<div class="empty-state">No budgets set yet. Add limits in the Budget tab.</div>' : activeBudgets.map(b => {
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
      title: 'By category',
      empty: Object.keys(spentByCategory).length ? null : 'No expenses this period',
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
      title: 'Top vendors',
      empty: topVendors.length ? null : 'No vendor notes this period',
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
      title: 'Net worth',
      empty: netWorthTimeline(networth).length ? null : 'No check-ins yet — tap to log one',
      body: renderNetWorthWidgetBody(networth),
    },
    bills: {
      title: 'Bills due',
      empty: billsDue(recurring).length ? null : 'Nothing due',
      body: renderBillsDueWidgetBody(recurring),
    },
    suggestions: {
      title: 'Suggestions',
      empty: suggestions?.length ? null : 'None right now',
      body: renderSuggestionsWidgetBody(suggestions),
    },
    goals: {
      title: 'Goals',
      empty: goals?.length ? null : 'No goals yet — tap to add one',
      body: renderGoalsWidgetBody(goals, networth),
    },
  }

  const order = getOrder()
  // the phone's saved "collapsed" set now means hidden from Home; widgets are
  // shown/hidden and reordered only inside Customize, not via per-widget controls
  const hidden = getCollapsed(!isDesktopView())

  container.innerHTML = `
    <div class="top-bar"><h1>Dashboard</h1><button class="top-bar-btn" id="openSettings" aria-label="Settings">${icon('settings', 22)}</button></div>
    <div class="range-toggle" id="rangeToggle">
      ${RANGES.map(r => `<button data-range="${r}" class="${r === range ? 'active' : ''}">${r === 1 ? '1M' : r + 'M'}</button>`).join('')}
    </div>
    ${monthPickerHtml({ year, month, txns, range })}

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
        <div class="summary-tile summary-tile-net">
          <div class="label">Net</div>
          <div class="value ${net >= 0 ? 'income' : 'expense'}">${formatMoney(net)}</div>
        </div>
      </div>
    </div>

    ${customizing ? `
      <div class="card customize-bar">
        <div>Drag ${icon('grip', 13)} to reorder · tap ${icon('eye', 13)} to show or hide</div>
        <button class="btn" id="doneCustomizing">Done</button>
      </div>
      <div id="dashWidgets" class="customizing">
        ${order.map(id => customizeRowHtml(id, widgets[id], hidden.has(id))).join('')}
      </div>
    ` : `
      <div id="dashWidgets">
        ${order.filter(id => !hidden.has(id)).map(id => widgetRowHtml(id, widgets[id])).join('')}
      </div>
      <button class="link-btn dash-customize" id="startCustomizing">${icon('layers', 15)} Customize Home</button>
    `}
  `

  container.querySelector('#rangeToggle').querySelectorAll('button').forEach(btn => {
    btn.onclick = () => onRangeChange(Number(btn.dataset.range))
  })
  wireMonthPicker(container, onMonthChange)
  // phone: Settings left the tab bar so Add can sit centred in 5 tabs — it lives here instead
  container.querySelector('#openSettings').onclick = () => opts.onNavigate?.('settings')

  const widgetsEl = container.querySelector('#dashWidgets')
  if (customizing) {
    container.querySelector('#doneCustomizing').onclick = () => opts.onDoneCustomizing?.()
    widgetsEl.querySelectorAll('.customize-eye').forEach(btn => {
      btn.onclick = () => { toggleCollapsed(btn.dataset.widget, !isDesktopView()); renderDashboard(container, opts) }
    })
    setupDragReorder(widgetsEl)
    return // nothing else is tappable while customizing
  }
  container.querySelector('#startCustomizing').onclick = () => opts.onStartCustomizing?.()

  // the full card when there's data, the one-line row when empty — both open the popup
  widgetsEl.querySelector('[data-widget="networth"] .networth-widget-body, [data-widget="networth"].dash-widget-empty')?.addEventListener('click', () => {
    openNetWorthCheckins({ networth, onNetWorthChanged })
  })
  widgetsEl.querySelector('[data-widget="goals"] .card, [data-widget="goals"].dash-widget-empty')?.addEventListener('click', () => {
    openGoals({ goals: goals || [], networth, onGoalsChanged })
  })

  widgetsEl.querySelectorAll('.bill-mark-paid').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = (recurring || []).find(r => r.id === btn.dataset.id)
      if (item) openMarkPaidDialog({ item, onSaved: onBillsChanged })
    })
  })

  widgetsEl.querySelectorAll('.suggestion-accept').forEach(btn => {
    btn.addEventListener('click', async () => {
      const s = (suggestions || []).find(x => x.id === btn.dataset.id)
      if (!s) return
      btn.disabled = true
      try {
        await addTransaction({
          type: s.type,
          amount: s.amount,
          date: s.date,
          category: s.category,
          subcategory: s.subcategory || null,
          notes: s.notes || null,
          budget_type: s.type === 'expense' ? categoryBudgetType(s.category) : null,
          is_credit_card: s.is_credit_card || false,
          is_shopee: s.is_shopee || false,
        })
        await deleteSuggestion(s.id)
        toast('Added')
        await onSuggestionsChanged()
      } catch (e) {
        btn.disabled = false
        toast(e.message || 'Failed to accept suggestion')
      }
    })
  })
  widgetsEl.querySelectorAll('.suggestion-decline').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true
      try {
        await deleteSuggestion(btn.dataset.id)
        toast('Declined')
        await onSuggestionsChanged()
      } catch (e) {
        btn.disabled = false
        toast(e.message || 'Failed to decline suggestion')
      }
    })
  })
}

function renderStreaksBody(txns, budgets) {
  const loggingStreak = computeCurrentLoggingStreak(txns)
  const budgetStreak = computeBudgetStreak(txns, budgets)
  // a streak at 0 shows its icon muted rather than swapping to a different
  // "empty" icon — the tier now reads from the number itself, not the glyph
  return `
    <div class="streak-row">
      <div class="streak-item">
        <div class="streak-icon${loggingStreak ? '' : ' idle'}">${icon('flame', 24)}</div>
        <div class="streak-value">${loggingStreak}</div>
        <div class="streak-label">Day${loggingStreak === 1 ? '' : 's'} logged in a row</div>
      </div>
      <div class="streak-item">
        <div class="streak-icon${budgetStreak ? '' : ' idle'}">${icon(budgetStreak >= 3 ? 'award' : 'shield', 24)}</div>
        <div class="streak-value">${budgetStreak}</div>
        <div class="streak-label">Month${budgetStreak === 1 ? '' : 's'} under budget</div>
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
        <div class="networth-widget-icon">${icon('wallet', 22)}</div>
        <div class="networth-widget-main">
          <div class="networth-widget-val">—</div>
          <div class="networth-widget-delta">No check-ins yet — tap to log one</div>
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

  return `
    <div class="networth-widget-body">
      <div class="networth-widget-icon">${icon('wallet', 22)}</div>
      <div class="networth-widget-main">
        <div class="networth-widget-val">${formatMoney(total)}</div>
        <div class="networth-widget-delta">${deltaHtml}</div>
      </div>
    </div>
  `
}

function renderSuggestionsWidgetBody(suggestions) {
  if (!suggestions || !suggestions.length) return '<div class="empty-state">No suggestions right now.</div>'
  return suggestions.map(s => `
    <div class="suggestion-row">
      <div class="suggestion-icon">${categoryIcon(s.category)}</div>
      <div class="suggestion-main">
        <div class="suggestion-top">
          <span class="suggestion-cat">${escapeHtml(s.category)}${s.subcategory ? ' · ' + escapeHtml(s.subcategory) : ''}</span>
          <span class="suggestion-amt ${s.type}">${s.type === 'income' ? '+' : '−'}${formatMoney(s.amount)}</span>
        </div>
        <div class="suggestion-date">${formatDateDMY(s.date)}${s.notes ? ' · ' + escapeHtml(s.notes) : ''}</div>
        ${s.source_note ? `<div class="suggestion-source">${escapeHtml(s.source_note)}</div>` : ''}
      </div>
      <div class="suggestion-actions">
        <button class="suggestion-decline" data-id="${s.id}" aria-label="Decline">${icon('x', 15)}</button>
        <button class="suggestion-accept" data-id="${s.id}" aria-label="Accept">${icon('check', 15)}</button>
      </div>
    </div>
  `).join('')
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
        <div class="bill-icon">${categoryIcon(r.category)}</div>
        <div class="bill-main">
          <div class="bill-name">${escapeHtml(r.subcategory || r.category)}</div>
          <div class="bill-meta ${overdue ? 'overdue' : ''}">${overdue ? 'Overdue' : 'Due'} ${formatDateDMY(r.next_due)}${progress}</div>
        </div>
        <div class="bill-amt">${formatMoney(r.amount)}</div>
        <button class="btn bill-mark-paid" data-id="${r.id}">Mark paid</button>
      </div>
    `
  }).join('')
}

function renderGoalsWidgetBody(goals, networth) {
  if (!goals?.length) return '<div class="empty-state">No goals yet — tap to add one.</div>'
  return goals.map(g => {
    const progress = goalProgress(g, networth)
    const cls = progress.pct >= 100 ? '' : (progress.pct >= 80 ? 'warn' : '')
    return `
      <div class="budget-row">
        <div class="budget-row-top">
          <span class="cat">${escapeHtml(g.name)}</span>
          <span class="nums">${formatMoney(progress.current)} / ${formatMoney(progress.target)}</span>
        </div>
        <div class="budget-bar-track"><div class="budget-bar-fill ${cls}" style="width:${progress.pct}%"></div></div>
      </div>
    `
  }).join('')
}

function widgetRowHtml(id, def) {
  if (def.empty) {
    return `
      <div class="dash-widget dash-widget-empty" data-widget="${id}">
        <span class="t">${def.title}</span><span class="n">${def.empty}</span>
      </div>`
  }
  return `
    <div class="dash-widget" data-widget="${id}">
      <h2 class="dash-widget-title">${def.title}</h2>
      <div class="card">${def.body}</div>
    </div>
  `
}

// Customize mode: titles only, so the list is short enough to drag through
function customizeRowHtml(id, def, isHidden) {
  return `
    <div class="dash-widget customize-row${isHidden ? ' is-hidden' : ''}" data-widget="${id}">
      <button class="drag-handle" data-widget="${id}" aria-label="Drag to reorder">${icon('grip', 18)}</button>
      <span class="t">${def.title}</span>
      <button class="customize-eye" data-widget="${id}" aria-label="${isHidden ? 'Show on Home' : 'Hide from Home'}" aria-pressed="${!isHidden}">${icon(isHidden ? 'eyeOff' : 'eye', 18)}</button>
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
