import { Chart } from 'chart.js'
import { EXPENSE_CATEGORIES, BUDGET_TYPE_ORDER } from '../categories.js'
import { upsertBudget, savePushSubscription } from '../supabase.js'
import { toast, formatMoney, monthLabel, suggestionBasis, urlBase64ToUint8Array, escapeHtml } from '../helpers.js'
import { icon, categoryIcon } from '../icons.js'
import { withinHistory } from '../budgetData.js'

// Phone Budget & Limits. Opens in a view mode (this month's spend against the
// limits, a "stayed within" strip, per-category progress) because on the
// phone it's mostly checked, not edited; "Edit limits" switches to the
// inputs, each with its suggestion and the months it was worked out from.

// Chart.js's registerables are already registered once, by analysis.js on
// module load — this file only needs the Chart constructor itself, same
// precedent as analysisInvestments.js / the dialog files.

// From `npx web-push generate-vapid-keys` — the public half is safe to ship
// client-side by design (same idea as supabase.js's anon key), it just needs
// to match VAPID_PRIVATE_KEY on the server (api/check-budget-alerts.js, set
// as a Vercel env var, never committed) or subscriptions stop working.
const VAPID_PUBLIC_KEY = 'BIpc_gh2sKjZIJeIs6idrop8Tth8SROQMyxz-fLCzj-5lXuO8axFF4p9Bfyv_n9ahV64SkR4Shit-NPiB23SH8U'

const TYPE_COLORS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5']
const shortMonth = k => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'short' })

let editing = false

const chartInstances = {}
function renderChartInstance(key, canvas, config) {
  chartInstances[key]?.destroy()
  chartInstances[key] = new Chart(canvas.getContext('2d'), config)
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

const barCls = (spent, limit) => !limit ? '' : spent > limit ? 'over' : spent / limit >= 0.8 ? 'warn' : ''

export function renderBudget(container, opts) {
  const { budgets, txns } = opts
  const now = new Date()
  const year = opts.year ?? now.getFullYear()
  const month = opts.month ?? now.getMonth()

  const limits = {}
  for (const b of budgets) limits[b.category] = Number(b.monthly_limit) || 0
  const basis = suggestionBasis(txns, 3)

  const byType = {}
  for (const c of EXPENSE_CATEGORIES) (byType[c.type] ||= []).push(c.name)

  if (editing) renderEdit(container, opts, { limits, basis, byType })
  else renderView(container, opts, { limits, byType, year, month })
}

function renderView(container, opts, { limits, byType, year, month }) {
  const { txns } = opts
  const mk = `${year}-${String(month + 1).padStart(2, '0')}`
  const spent = {}
  for (const t of txns) {
    if (t.type !== 'expense' || !t.date.startsWith(mk)) continue
    spent[t.category] = (spent[t.category] || 0) + Number(t.amount)
  }
  const budgeted = EXPENSE_CATEGORIES.map(c => c.name).filter(c => limits[c] > 0)
  const totalLimit = budgeted.reduce((s, c) => s + limits[c], 0)
  const totalSpent = budgeted.reduce((s, c) => s + (spent[c] || 0), 0)
  const unbudgeted = Object.entries(spent).filter(([c]) => !budgeted.includes(c)).reduce((s, [, v]) => s + v, 0)
  const left = totalLimit - totalSpent

  const now = new Date()
  const isCurrent = year === now.getFullYear() && month === now.getMonth()
  const daysLeft = isCurrent ? new Date(year, month + 1, 0).getDate() - now.getDate() + 1 : 0
  const history = withinHistory(txns, limits, year, month)

  const summary = totalLimit ? `
    <div class="card budget-summary">
      <div class="budget-summary-label">${left >= 0 ? 'Left to spend' : 'Over budget'}</div>
      <div class="budget-summary-value ${left >= 0 ? 'income' : 'expense'}">${formatMoney(Math.abs(Math.round(left)))}</div>
      <div class="budget-summary-sub">${formatMoney(Math.round(totalSpent))} spent of ${formatMoney(totalLimit)}</div>
      <div class="budget-bar-track"><div class="budget-bar-fill ${barCls(totalSpent, totalLimit)}" style="width:${Math.min(100, totalSpent / totalLimit * 100)}%"></div></div>
      <div class="budget-summary-foot">
        <span>${isCurrent ? (left > 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left · ${formatMoney(Math.round(left / daysLeft))}/day` : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`) : 'Month closed'}</span>
        ${unbudgeted ? `<span>+ ${formatMoney(Math.round(unbudgeted))} without a limit</span>` : ''}
      </div>
    </div>` : `
    <div class="card"><div class="empty-state">No limits set yet. Tap Edit limits to add them — each category gets a suggestion from your recent spending.</div></div>`

  const strip = history.cats.length && history.months.length ? `
    <h2>Stayed within budget?</h2>
    <div class="card">
      <div class="budget-history-head">${history.judged ? `<b>${history.within} of ${history.judged}</b> recent month${history.judged === 1 ? '' : 's'} under your total limit` : 'Needs a complete month of data'}</div>
      <div class="budget-history-strip">
        ${history.totals.map(t => {
          const so = t.k === history.curKey
          const ok = t.s <= history.limTotal
          return `
            <div class="budget-history-month ${so ? 'so-far' : ok ? 'ok' : 'over'}">
              <span class="m">${shortMonth(t.k)}</span>
              <span class="i">${so ? icon('clock', 16) : icon(ok ? 'check' : 'x', 16)}</span>
              <span class="v">${formatMoney(Math.round(t.s))}</span>
            </div>`
        }).join('')}
      </div>
      <div class="budget-history-note">Against today's total limit of ${formatMoney(history.limTotal)} — Coin doesn't keep a record of what each limit used to be.</div>
    </div>` : ''

  const groups = BUDGET_TYPE_ORDER.map(type => {
    const cats = (byType[type] || []).filter(c => limits[c] > 0 || spent[c])
    if (!cats.length) return ''
    return `
      <div class="budget-group-label">${type}</div>
      ${cats.map(c => {
        const lim = limits[c] || 0, sp = spent[c] || 0
        return `
          <div class="budget-row">
            <div class="budget-row-top">
              <span class="cat">${categoryIcon(c, 15)} ${escapeHtml(c)}</span>
              <span class="nums">${formatMoney(Math.round(sp))}${lim ? ` / ${formatMoney(lim)}` : ''}</span>
            </div>
            ${lim ? `<div class="budget-bar-track"><div class="budget-bar-fill ${barCls(sp, lim)}" style="width:${Math.min(100, sp / lim * 100)}%"></div></div>
            <div class="budget-row-foot ${sp > lim ? 'over' : ''}">${sp > lim ? `${formatMoney(Math.round(sp - lim))} over` : `${formatMoney(Math.round(lim - sp))} left`}</div>` : '<div class="budget-row-foot">No limit</div>'}
          </div>`
      }).join('')}`
  }).join('')

  container.innerHTML = `
    <div class="top-bar"><h1>Budget</h1><button class="btn secondary top-bar-action" id="editLimits">${icon('pen', 15)} Edit limits</button></div>
    <div class="page-sub">${monthLabel(year, month)} · limits are monthly</div>
    ${summary}
    ${strip}
    ${groups ? `<h2>By category</h2><div class="card">${groups}</div>` : ''}

    <h2>Budget alerts</h2>
    <div class="card" style="margin-bottom:16px">
      <div style="font-size:13px;color:var(--text2);margin-bottom:12px">Get a push notification when a budget category crosses 90% or 100% for the month.</div>
      <button class="btn secondary" id="enableAlertsBtn">Enable budget alerts</button>
    </div>
  `
  container.querySelector('#editLimits').onclick = () => { editing = true; renderBudget(container, opts) }
  container.querySelector('#enableAlertsBtn').onclick = enableAlerts
}

function renderEdit(container, opts, { limits, basis, byType }) {
  const { txns, onBudgetsChanged } = opts

  // average income over the same months the suggestions use
  const incomeByMonth = {}
  for (const t of txns) if (t.type === 'income') incomeByMonth[t.date.slice(0, 7)] = (incomeByMonth[t.date.slice(0, 7)] || 0) + Number(t.amount)
  const incMonths = basis.months.filter(k => incomeByMonth[k])
  const avgIncome = incMonths.length ? incMonths.reduce((s, k) => s + incomeByMonth[k], 0) / incMonths.length : null
  const monthsTxt = basis.months.map(shortMonth).join(', ')

  const sugLine = cat => {
    const v = basis.perCat[cat]
    if (!v) return ''
    const parts = basis.months.map(k => `${shortMonth(k)} ${formatMoney(Math.round(v.byMonth[k]))}`).join(' · ')
    return `
      <div class="budget-sug">
        <span>${parts}</span>
        <button type="button" class="budget-sug-use" data-cat="${escapeHtml(cat)}" data-v="${v.suggested}">Use ${formatMoney(v.suggested)}</button>
      </div>`
  }

  container.innerHTML = `
    <div class="top-bar"><h1>Edit limits</h1><button class="btn secondary top-bar-action" id="cancelEdit">Cancel</button></div>

    <div class="card budget-explain">
      <div class="budget-explain-title">${icon('bulb', 16)} How suggestions are worked out</div>
      <div class="budget-explain-text">${basis.months.length
        ? `Your average spend per category over the last <b>${basis.months.length} complete month${basis.months.length === 1 ? '' : 's'} with spending logged</b> (${monthsTxt}), rounded to the nearest ฿100. Months with nothing logged are skipped instead of counted as ฿0, so a month you didn't log can't drag a suggestion down.`
        : 'Suggestions appear once at least one complete month has spending logged.'}</div>
    </div>

    <div class="card budget-chart-card">
      <div class="chart-box chart-box-donut"><canvas id="budgetChart"></canvas></div>
      <div class="budget-total-row">
        <span class="lbl">Total budgeted</span>
        <span class="val" id="budgetTotalVal">${formatMoney(0)}</span>
      </div>
      ${avgIncome !== null ? `<div class="budget-income-compare" id="budgetIncomeCompare"></div>` : `<div class="budget-income-compare">Log some income to compare this against your average salary.</div>`}
    </div>

    <div class="card budget-inputs-card">
      ${BUDGET_TYPE_ORDER.map(type => `
        <div class="budget-group-label">${type}</div>
        ${(byType[type] || []).map(cat => `
          <div class="budget-edit-row">
            <div class="budget-edit-top">
              <span class="cat">${categoryIcon(cat, 15)} ${escapeHtml(cat)}</span>
              <input type="number" inputmode="decimal" class="budgetInput" data-cat="${escapeHtml(cat)}" data-type="${type}" placeholder="0" value="${limits[cat] || ''}" />
            </div>
            ${sugLine(cat)}
          </div>
        `).join('')}
      `).join('')}
    </div>

    <div class="budget-edit-actions">
      <button class="btn secondary" id="fillAll">Fill all</button>
      <button class="btn" id="saveBudgets">Save limits</button>
    </div>
  `

  function currentByType() {
    const sums = {}
    for (const type of BUDGET_TYPE_ORDER) sums[type] = 0
    container.querySelectorAll('.budgetInput').forEach(inp => {
      sums[inp.dataset.type] = (sums[inp.dataset.type] || 0) + (parseFloat(inp.value) || 0)
    })
    return sums
  }

  function renderChart() {
    const sums = currentByType()
    const types = BUDGET_TYPE_ORDER.filter(t => sums[t] > 0)
    renderChartInstance('budget', container.querySelector('#budgetChart'), {
      type: 'doughnut',
      data: {
        labels: types,
        datasets: [{
          data: types.map(t => sums[t]),
          backgroundColor: types.map((_, i) => cssVar(TYPE_COLORS[i % TYPE_COLORS.length])),
          borderColor: cssVar('--surface'), borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: cssVar('--text2'), font: { size: 11 }, boxWidth: 12, padding: 10 } },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatMoney(ctx.parsed)}` } },
        },
      },
    })
  }

  function updateTotal() {
    const total = [...container.querySelectorAll('.budgetInput')].reduce((s, inp) => s + (parseFloat(inp.value) || 0), 0)
    container.querySelector('#budgetTotalVal').textContent = formatMoney(total)
    const compareEl = container.querySelector('#budgetIncomeCompare')
    if (compareEl && avgIncome) {
      compareEl.textContent = `${Math.round((total / avgIncome) * 100)}% of your avg income — ${formatMoney(Math.round(avgIncome))}/mo over ${incMonths.map(shortMonth).join(', ')}`
      compareEl.style.color = total > avgIncome ? 'var(--red)' : 'var(--text2)'
    }
    renderChart()
  }
  container.querySelectorAll('.budgetInput').forEach(input => { input.oninput = updateTotal })
  container.querySelectorAll('.budget-sug-use').forEach(btn => {
    btn.onclick = () => {
      const input = container.querySelector(`.budgetInput[data-cat="${CSS.escape(btn.dataset.cat)}"]`)
      if (input) { input.value = btn.dataset.v; updateTotal() }
    }
  })
  updateTotal()

  container.querySelector('#cancelEdit').onclick = () => { editing = false; renderBudget(container, opts) }

  container.querySelector('#fillAll').onclick = () => {
    container.querySelectorAll('.budgetInput').forEach(input => {
      const v = basis.perCat[input.dataset.cat]
      if (v) input.value = v.suggested
    })
    updateTotal()
    toast('Filled from suggestions — review, then Save limits')
  }

  container.querySelector('#saveBudgets').onclick = async () => {
    const btn = container.querySelector('#saveBudgets')
    btn.disabled = true
    btn.textContent = 'Saving…'
    try {
      for (const input of container.querySelectorAll('.budgetInput')) {
        const val = parseFloat(input.value) || 0
        if (val !== (limits[input.dataset.cat] || 0)) await upsertBudget(input.dataset.cat, val, input.dataset.type)
      }
      editing = false
      toast('Limits saved')
      await onBudgetsChanged()
    } catch (e) {
      toast(e.message || 'Failed to save limits')
      btn.disabled = false
      btn.textContent = 'Save limits'
    }
  }
}

async function enableAlerts() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast("This browser doesn't support push notifications")
    return
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') { toast('Notification permission denied'); return }
  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) })
    await savePushSubscription(sub)
    toast('Budget alerts enabled')
  } catch (e) {
    toast(e.message || 'Failed to enable alerts')
  }
}
