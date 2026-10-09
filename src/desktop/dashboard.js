// Desktop Dashboard — Ledger's layout (KPI row → Income vs Expenses +
// breakdown donut → widgets → recent transactions) with Coin's own widgets.
// Widgets can only be dragged or hidden in Customize mode (top bar toggle).
import { formatMoney, rangeLabel, rangeWindow, escapeHtml, effectiveDate, formatDateDMY, todayISO, toast, sortByDateDesc } from '../helpers.js'
import { BUDGET_TYPE_ORDER, EXPENSE_CATEGORIES, categoryBudgetType } from '../categories.js'
import { getOrder, setOrder, DEFAULT_ORDER } from '../dashboardLayout.js'
import { computeCurrentLoggingStreak, computeBudgetStreak } from '../achievements.js'
import { openNetWorthCheckins } from '../netWorthCheckins.js'
import { openGoals } from '../goalsDialog.js'
import { netWorthTimeline, goalProgress } from '../analysisData.js'
import { billsDue } from '../recurringReminders.js'
import { openMarkPaidDialog } from '../markPaidDialog.js'
import { addTransaction, deleteSuggestion } from '../supabase.js'
import { icon, categoryIcon } from '../icons.js'
import { isPrivacyMode, privacyOverlayHtml } from '../privacy.js'
import {
  headHtml, kpiHtml, barHtml, statusClass, cardHtml, emptyCardHtml, renderChart, baseOptions, BAR,
  chartTheme, donutConfig, legendHtml, paletteColor, monthKeysEnding, shortMonth,
} from './ui.js'
import { txnTableHtml, wireTxnTable } from './history.js'

// Desktop keeps its own hidden set (the phone's collapsed set is a different
// idea — collapsed-but-visible). Category is hidden by default: the donut
// beside the trend chart already shows the same breakdown.
const HIDDEN_KEY = 'coin_dash_hidden_desktop'
const DEFAULT_HIDDEN = ['category']
function getHidden() {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    if (raw === null) return new Set(DEFAULT_HIDDEN)
    const v = JSON.parse(raw)
    return new Set(Array.isArray(v) ? v : [])
  } catch { return new Set(DEFAULT_HIDDEN) }
}
function setHidden(set) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set])) } catch { /* storage unavailable — layout just won't persist */ }
}

const WIDGET_META = {
  suggestions: { title: 'Suggestions', icon: 'bulb' },
  networth: { title: 'Net worth', icon: 'wallet' },
  goals: { title: 'Goals', icon: 'flag' },
  bills: { title: 'Bills due', icon: 'calendar' },
  streaks: { title: 'Streaks', icon: 'flame' },
  budget: { title: 'Budget vs actual', icon: 'budget' },
  category: { title: 'By category', icon: 'pie' },
  vendors: { title: 'Top vendors', icon: 'bag' },
}

export function renderDashboardDesktop(container, opts) {
  const { txns, budgets, year, month, range, networth, recurring, suggestions, goals, customizing } = opts
  const { from, to } = rangeWindow(year, month, range)
  const inRange = txns.filter(t => { const d = effectiveDate(t); return d >= from && d <= to })
  const incomeTx = inRange.filter(t => t.type === 'income')
  const expenseTx = inRange.filter(t => t.type === 'expense')
  const income = incomeTx.reduce((s, t) => s + Number(t.amount), 0)
  const expense = expenseTx.reduce((s, t) => s + Number(t.amount), 0)
  const net = income - expense

  const validCats = new Set(EXPENSE_CATEGORIES.map(c => c.name))
  const activeBudgets = budgets
    .filter(b => b.monthly_limit > 0 && validCats.has(b.category))
    .sort((a, b) => BUDGET_TYPE_ORDER.indexOf(a.budget_type) - BUDGET_TYPE_ORDER.indexOf(b.budget_type))
  const totalLimit = activeBudgets.reduce((s, b) => s + Number(b.monthly_limit), 0) * range
  // budget use counts only budgeted categories, so an unbudgeted one-off
  // (e.g. Travel) can't make the card read "over" on its own
  const budgetedCats = new Set(activeBudgets.map(b => b.category))
  const budgetedSpend = expenseTx.filter(t => budgetedCats.has(t.category)).reduce((s, t) => s + Number(t.amount), 0)
  const budgetPct = totalLimit ? budgetedSpend / totalLimit * 100 : 0

  const spentByCategory = {}
  const spentByVendor = {}
  for (const t of expenseTx) {
    spentByCategory[t.category] = (spentByCategory[t.category] || 0) + Number(t.amount)
    const vendor = (t.subcategory || '').trim()
    if (!vendor) continue
    if (!spentByVendor[vendor]) spentByVendor[vendor] = { amount: 0, count: 0 }
    spentByVendor[vendor].amount += Number(t.amount)
    spentByVendor[vendor].count += 1
  }
  const catRows = Object.entries(spentByCategory).sort((a, b) => b[1] - a[1])

  const hidden = getHidden()
  const order = getOrder()
  const widgets = buildWidgets({ txns, budgets, activeBudgets, range, spentByCategory, spentByVendor, catRows, expense, networth, recurring, suggestions, goals })
  const visibleOrder = customizing ? order : order.filter(id => !hidden.has(id))

  const periodText = rangeLabel(year, month, range)
  const recent = sortByDateDesc(txns).slice(0, 8)

  container.innerHTML = `
    ${headHtml('Dashboard', `Showing ${periodText}`)}
    ${customizing ? `
      <div class="d-customize-bar">${icon('layers', 14)}
        <span>Drag ${icon('grip', 12)} to reorder widgets, or hide the ones you don't use. Hidden widgets stay listed here, dimmed.</span>
        <button class="d-btn" id="dReset">Reset layout</button>
        <button class="d-btn-primary" id="dDone">Done</button>
      </div>` : ''}

    <div class="d-kpis">
      ${kpiHtml({ kind: 'income', icon: 'trendingUp', label: 'Income', value: formatMoney(income), valueClass: 'pos', sub: `${incomeTx.length} transaction${incomeTx.length === 1 ? '' : 's'}` })}
      ${kpiHtml({ kind: 'expense', icon: 'trendingDown', label: 'Expenses', value: formatMoney(expense), valueClass: 'neg', sub: `${expenseTx.length} transaction${expenseTx.length === 1 ? '' : 's'}` })}
      ${kpiHtml({ kind: 'net', icon: 'dollar', label: 'Net balance', value: formatMoney(net), valueClass: net >= 0 ? 'pos' : 'neg', sub: income ? `${net >= 0 ? 'Surplus' : 'Deficit'} · ${Math.round(net / income * 100)}% of income saved` : (net >= 0 ? 'Surplus' : 'Deficit') })}
      ${kpiHtml({
        kind: 'budget', icon: 'budget', label: 'Budget used',
        value: totalLimit ? `${Math.round(budgetPct)}%` : '—',
        valueClass: budgetPct >= 100 ? 'neg' : budgetPct < 80 && totalLimit ? 'pos' : '',
        sub: totalLimit ? '' : 'No limits set — Budget & Limits',
        extra: totalLimit ? barHtml(budgetPct, statusClass(budgetedSpend, totalLimit), [formatMoney(Math.round(budgetedSpend)), formatMoney(totalLimit)]) : '',
      })}
    </div>

    <div class="d-row r-21 stretch">
      ${cardHtml({ title: 'Income vs expenses', sub: `12 months to ${shortMonth(monthKeysEnding(year, month, 1)[0])}`, body: '<div class="d-chart"><canvas id="dTrend"></canvas></div>' })}
      ${cardHtml({
        title: 'Breakdown', sub: `Expenses by category · ${periodText}`,
        body: catRows.length ? '<div class="d-donut-split"><div class="d-chart h-sm"><canvas id="dDonut"></canvas></div><div id="dDonutLegend"></div></div>' : '<div class="d-empty">No expenses in this period.</div>',
      })}
    </div>

    <div class="d-widgets ${customizing ? 'customizing' : ''}" id="dWidgets">
      ${visibleOrder.map(id => widgetHtml(id, widgets[id], { customizing, isHidden: hidden.has(id) })).join('')}
    </div>

    <div class="d-table-card">
      <div class="d-toolbar">
        <div class="d-toolbar-title">Recent transactions</div>
        <button class="d-btn" id="dViewAll">View all ${icon('arrowRight', 12)}</button>
      </div>
      <div id="dRecent">${txnTableHtml(recent, { groups: false })}</div>
    </div>
  `

  drawTrend(container, txns, year, month)
  if (catRows.length) drawDonut(container, catRows)

  const recentEl = container.querySelector('#dRecent')
  wireTxnTable(recentEl, recent, { onEdit: opts.onEditTxn })
  container.querySelector('#dViewAll').onclick = () => opts.onNavigate('transactions')

  const widgetsEl = container.querySelector('#dWidgets')
  wireWidgets(widgetsEl, opts)

  if (customizing) {
    container.querySelector('#dDone').onclick = opts.onDoneCustomizing
    container.querySelector('#dReset').onclick = () => {
      setOrder([...DEFAULT_ORDER])
      setHidden(new Set(DEFAULT_HIDDEN))
      renderDashboardDesktop(container, opts)
    }
    widgetsEl.querySelectorAll('.d-hide').forEach(btn => {
      btn.onclick = () => {
        const set = getHidden()
        if (set.has(btn.dataset.widget)) set.delete(btn.dataset.widget)
        else set.add(btn.dataset.widget)
        setHidden(set)
        renderDashboardDesktop(container, opts)
      }
    })
    setupDrag(widgetsEl)
  }
}

function buildWidgets({ txns, budgets, activeBudgets, range, spentByCategory, spentByVendor, catRows, expense, networth, recurring, suggestions, goals }) {
  const w = {}

  w.suggestions = suggestions?.length
    ? { body: suggestions.map(s => `
        <div class="suggestion-row">
          <div class="suggestion-icon">${categoryIcon(s.category, 15)}</div>
          <div class="suggestion-main">
            <div class="suggestion-top">
              <span class="suggestion-cat">${escapeHtml(s.category)}${s.subcategory ? ' · ' + escapeHtml(s.subcategory) : ''}</span>
              <span class="suggestion-amt ${s.type}">${s.type === 'income' ? '+' : '−'}${formatMoney(s.amount)}</span>
            </div>
            <div class="suggestion-date">${formatDateDMY(s.date)}${s.notes ? ' · ' + escapeHtml(s.notes) : ''}</div>
          </div>
          <div class="suggestion-actions">
            <button class="suggestion-decline" data-id="${s.id}" aria-label="Decline">${icon('x', 13)}</button>
            <button class="suggestion-accept" data-id="${s.id}" aria-label="Accept">${icon('check', 13)}</button>
          </div>
        </div>`).join('') }
    : { empty: 'None right now' }

  const timeline = netWorthTimeline(networth)
  const latest = timeline[timeline.length - 1]
  const prev = timeline[timeline.length - 2]
  if (!latest) w.networth = { empty: 'No check-ins yet — click to log one' }
  else {
    const delta = prev ? latest.total - prev.total : null
    w.networth = {
      privacy: true,
      body: `
        <div class="d-nw-widget">
          <div style="flex:1;min-width:0">
            <div class="d-nw-widget-val">${formatMoney(latest.total)}</div>
            <div class="d-list-meta">${delta === null ? `as of ${formatDateDMY(latest.date)}` : `<span class="${delta >= 0 ? 'pos' : 'neg'}">${delta >= 0 ? '+' : '−'}${formatMoney(Math.abs(delta))}</span> since last · ${formatDateDMY(latest.date)}`}</div>
          </div>
          <span class="d-link">Check-ins ${icon('arrowRight', 11)}</span>
        </div>
        <div style="display:flex;gap:14px;margin-top:10px">
          ${[['Cash', latest.cash], ['Invested', latest.invested], ['Insurance', latest.insurance]].filter(([, v]) => v).map(([l, v]) => `<div><div class="d-kpi-label">${l}</div><div class="d-list-val">${formatMoney(v)}</div></div>`).join('')}
        </div>`,
    }
  }

  w.goals = goals?.length
    ? { body: goals.map(g => {
        const p = goalProgress(g, networth)
        return `<div class="d-meter"><div class="d-meter-top"><span class="n">${escapeHtml(g.name)}</span><span class="v">${formatMoney(p.current)} <small>/ ${formatMoney(p.target)}</small></span></div>${barHtml(p.pct, p.pct >= 100 ? '' : 'accent')}</div>`
      }).join('') }
    : { empty: 'No goals yet — click to add one' }

  const due = billsDue(recurring)
  const today = todayISO()
  w.bills = due.length
    ? { body: due.map(r => {
        const overdue = r.next_due < today
        const progress = r.installments_total ? ` · ${r.installments_paid || 0}/${r.installments_total}` : ''
        return `
          <div class="bill-row">
            <div class="bill-icon">${categoryIcon(r.category, 15)}</div>
            <div class="bill-main">
              <div class="bill-name">${escapeHtml(r.subcategory || r.notes || r.category)}</div>
              <div class="bill-meta ${overdue ? 'overdue' : ''}">${overdue ? 'Overdue' : 'Due'} ${formatDateDMY(r.next_due)}${progress}</div>
            </div>
            <div class="bill-amt">${formatMoney(r.amount)}</div>
            <button class="d-btn bill-mark-paid" data-id="${r.id}">Mark paid</button>
          </div>`
      }).join('') }
    : { empty: 'Nothing due right now' }

  const logStreak = computeCurrentLoggingStreak(txns)
  const budgetStreak = computeBudgetStreak(txns, budgets)
  w.streaks = {
    body: `
      <div class="d-streaks">
        <div class="d-streak${logStreak ? '' : ' idle'}">${icon('flame', 20)}<div><div class="d-streak-val">${logStreak}</div><div class="d-streak-lbl">day${logStreak === 1 ? '' : 's'} logged in a row</div></div></div>
        <div class="d-streak${budgetStreak ? '' : ' idle'}">${icon(budgetStreak >= 3 ? 'award' : 'shield', 20)}<div><div class="d-streak-val">${budgetStreak}</div><div class="d-streak-lbl">month${budgetStreak === 1 ? '' : 's'} under budget</div></div></div>
      </div>`,
  }

  w.budget = activeBudgets.length
    ? { sub: range > 1 ? `limits × ${range} months` : '', body: activeBudgets.map(b => {
        const limit = b.monthly_limit * range
        const spent = spentByCategory[b.category] || 0
        return `<div class="d-meter"><div class="d-meter-top"><span class="n">${escapeHtml(b.category)}</span><span class="v">${formatMoney(Math.round(spent))} <small>/ ${formatMoney(limit)}</small></span></div>${barHtml(spent / limit * 100, statusClass(spent, limit))}</div>`
      }).join('') }
    : { empty: 'No limits set yet' }

  w.category = catRows.length
    ? { body: catRows.map(([cat, amt]) => `<div class="d-meter"><div class="d-meter-top"><span class="n">${escapeHtml(cat)}</span><span class="v">${formatMoney(Math.round(amt))}</span></div>${barHtml(expense ? amt / expense * 100 : 0, 'accent')}</div>`).join('') }
    : { empty: 'No expenses in this period' }

  const vendors = Object.entries(spentByVendor).sort((a, b) => b[1].amount - a[1].amount).slice(0, 6)
  w.vendors = vendors.length
    ? { body: vendors.map(([name, d], i) => `<div class="d-list-row"><span class="d-list-meta" style="width:14px">${i + 1}</span><span class="d-list-name">${escapeHtml(name)}</span><span class="d-list-meta">×${d.count}</span><span class="d-list-val">${formatMoney(Math.round(d.amount))}</span></div>`).join('') }
    : { empty: 'No vendor names logged in this period' }

  return w
}

function widgetHtml(id, def, { customizing, isHidden }) {
  const meta = WIDGET_META[id]
  if (!meta || !def) return ''
  const ctrls = `
    <div class="d-widget-ctrls">
      <button class="d-btn icon-only d-hide" data-widget="${id}" title="${isHidden ? 'Show on dashboard' : 'Hide from dashboard'}">${icon(isHidden ? 'eye' : 'eyeOff', 13)}</button>
      <button class="d-btn icon-only d-drag" data-widget="${id}" title="Drag to reorder" aria-label="Drag to reorder">${icon('grip', 13)}</button>
    </div>`
  let inner
  if (def.empty && !customizing) {
    inner = emptyCardHtml(meta.title, def.empty, meta.icon)
  } else {
    const body = def.empty ? `<div class="d-note">${def.empty}</div>` : def.body
    inner = cardHtml({ title: meta.title, sub: def.sub || '', icon: meta.icon, actions: customizing ? ctrls : '', body })
  }
  const privacyOn = def.privacy && isPrivacyMode()
  return `<div class="d-widget${isHidden ? ' is-hidden' : ''}" data-widget="${id}">${def.privacy ? `<div class="privacy-wrap${privacyOn ? ' active' : ''}">${inner}${privacyOverlayHtml()}</div>` : inner}</div>`
}

function wireWidgets(el, opts) {
  const { networth, onNetWorthChanged, goals, onGoalsChanged, recurring, onBillsChanged, suggestions, onSuggestionsChanged, customizing } = opts
  if (!customizing) {
    el.querySelector('[data-widget="networth"] .d-card')?.addEventListener('click', () => openNetWorthCheckins({ networth, onNetWorthChanged }))
    el.querySelector('[data-widget="goals"] .d-card')?.addEventListener('click', () => openGoals({ goals: goals || [], networth, onGoalsChanged }))
  }
  el.querySelectorAll('.bill-mark-paid').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation()
      const item = (recurring || []).find(r => r.id === btn.dataset.id)
      if (item) openMarkPaidDialog({ item, onSaved: onBillsChanged })
    }
  })
  el.querySelectorAll('.suggestion-accept').forEach(btn => {
    btn.onclick = async () => {
      const s = (suggestions || []).find(x => x.id === btn.dataset.id)
      if (!s) return
      btn.disabled = true
      try {
        await addTransaction({
          type: s.type, amount: s.amount, date: s.date, category: s.category,
          subcategory: s.subcategory || null, notes: s.notes || null,
          budget_type: s.type === 'expense' ? categoryBudgetType(s.category) : null,
          is_credit_card: s.is_credit_card || false, is_shopee: s.is_shopee || false,
        })
        await deleteSuggestion(s.id)
        toast('Added')
        await onSuggestionsChanged()
      } catch (e) {
        btn.disabled = false
        toast(e.message || 'Failed to accept suggestion')
      }
    }
  })
  el.querySelectorAll('.suggestion-decline').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true
      try {
        await deleteSuggestion(btn.dataset.id)
        toast('Declined')
        await onSuggestionsChanged()
      } catch (e) {
        btn.disabled = false
        toast(e.message || 'Failed to decline suggestion')
      }
    }
  })
}

// Multi-column layout, so "where to drop" comes from the widget under the
// pointer (top half → before it, bottom half → after it), not a single
// vertical list of midpoints.
function setupDrag(el) {
  el.querySelectorAll('.d-drag').forEach(handle => {
    handle.addEventListener('pointerdown', e => {
      const dragging = handle.closest('.d-widget')
      if (!dragging) return
      e.preventDefault()
      dragging.classList.add('dragging')
      const onMove = ev => {
        const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.d-widget')
        if (!target || target === dragging || !el.contains(target)) return
        const r = target.getBoundingClientRect()
        el.insertBefore(dragging, ev.clientY < r.top + r.height / 2 ? target : target.nextSibling)
      }
      const onUp = () => {
        dragging.classList.remove('dragging')
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        setOrder([...el.querySelectorAll('.d-widget')].map(w => w.dataset.widget))
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    })
  })
}

function drawTrend(container, txns, year, month) {
  const keys = monthKeysEnding(year, month, 12)
  const idx = Object.fromEntries(keys.map((k, i) => [k, i]))
  const inc = keys.map(() => 0), exp = keys.map(() => 0)
  for (const t of txns) {
    const i = idx[effectiveDate(t).slice(0, 7)]
    if (i === undefined) continue
    if (t.type === 'income') inc[i] += Number(t.amount)
    else exp[i] += Number(t.amount)
  }
  const c = chartTheme()
  renderChart('dash-trend', container.querySelector('#dTrend'), {
    type: 'bar',
    data: {
      labels: keys.map(shortMonth),
      datasets: [
        { label: 'Income', data: inc, backgroundColor: c.green, ...BAR },
        { label: 'Expenses', data: exp, backgroundColor: c.red, ...BAR },
      ],
    },
    options: baseOptions(),
  })
}

function drawDonut(container, catRows) {
  const top = catRows.slice(0, 7).map(([label, amount]) => ({ label, amount }))
  const rest = catRows.slice(7).reduce((s, [, v]) => s + v, 0)
  if (rest > 0) top.push({ label: 'Other', amount: rest })
  const colors = top.map((r, i) => paletteColor(i, r.label))
  renderChart('dash-donut', container.querySelector('#dDonut'), donutConfig(top.map(r => r.label), top.map(r => r.amount), colors))
  container.querySelector('#dDonutLegend').innerHTML = legendHtml(top, colors)
}
