import { Chart } from 'chart.js'
import { EXPENSE_CATEGORIES, BUDGET_TYPE_ORDER } from '../categories.js'
import { upsertBudget, savePushSubscription } from '../supabase.js'
import { toast, formatMoney, confirmDialog, computeSuggestedLimits, urlBase64ToUint8Array } from '../helpers.js'

// Chart.js's registerables are already registered once, by analysis.js on
// module load — this file only needs the Chart constructor itself, same
// precedent as analysisInvestments.js / the dialog files.

// From `npx web-push generate-vapid-keys` — the public half is safe to ship
// client-side by design (same idea as supabase.js's anon key), it just needs
// to match VAPID_PRIVATE_KEY on the server (api/check-budget-alerts.js, set
// as a Vercel env var, never committed) or subscriptions stop working.
const VAPID_PUBLIC_KEY = 'BIpc_gh2sKjZIJeIs6idrop8Tth8SROQMyxz-fLCzj-5lXuO8axFF4p9Bfyv_n9ahV64SkR4Shit-NPiB23SH8U'

const TYPE_COLORS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5']

const chartInstances = {}
function renderChartInstance(key, canvas, config) {
  chartInstances[key]?.destroy()
  chartInstances[key] = new Chart(canvas.getContext('2d'), config)
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function renderBudget(container, opts) {
  const { budgets, txns, onBudgetsChanged } = opts
  const suggestedLimits = computeSuggestedLimits(txns, 3)

  const budgetMap = {}
  for (const b of budgets) budgetMap[b.category] = b.monthly_limit

  const byType = {}
  for (const c of EXPENSE_CATEGORIES) {
    if (!byType[c.type]) byType[c.type] = []
    byType[c.type].push(c.name)
  }

  const incomeByMonth = {}
  for (const t of txns) {
    if (t.type !== 'income') continue
    const key = t.date.slice(0, 7)
    incomeByMonth[key] = (incomeByMonth[key] || 0) + Number(t.amount)
  }
  const incomeMonths = Object.keys(incomeByMonth)
  const avgIncome = incomeMonths.length ? incomeMonths.reduce((s, m) => s + incomeByMonth[m], 0) / incomeMonths.length : null

  const initialTotal = Object.values(budgetMap).reduce((s, v) => s + (Number(v) || 0), 0)

  container.innerHTML = `
    <div class="top-bar"><h1>Budget & Limits</h1></div>

    <h2>Monthly budget limits</h2>
    <div class="budget-overview-grid">
      <div class="card budget-chart-card">
        <div class="chart-box chart-box-donut"><canvas id="budgetChart"></canvas></div>
        <div class="budget-total-row">
          <span class="lbl">Total budgeted</span>
          <span class="val" id="budgetTotalVal">${formatMoney(initialTotal)}</span>
        </div>
        ${avgIncome !== null ? `<div class="budget-income-compare" id="budgetIncomeCompare"></div>` : `<div class="budget-income-compare">Log some income transactions to compare this against your average salary.</div>`}
        <div style="display:flex;gap:10px;margin-top:14px">
          <button class="btn" id="saveBudgets">Save budgets</button>
          <button class="btn secondary" id="loadSuggested">Load suggested</button>
        </div>
        <div style="font-size:12px;color:var(--text2);margin-top:10px">Fills the fields from your average spend per category over the last 3 months — review before saving.</div>
      </div>

      <div class="card budget-inputs-card">
        ${BUDGET_TYPE_ORDER.map(type => `
          <div style="margin-bottom:14px">
            <div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.03em;margin-bottom:8px">${type}</div>
            ${byType[type].map(cat => `
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
                <div style="flex:1;font-size:14px">${cat}</div>
                <input type="number" inputmode="decimal" class="budgetInput" data-cat="${cat}" data-type="${type}"
                  style="width:120px" placeholder="0" value="${budgetMap[cat] || ''}" />
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>
    </div>

    <h2>Budget alerts</h2>
    <div class="card" style="margin-bottom:16px">
      <div style="font-size:13px;color:var(--text2);margin-bottom:12px">Get a push notification when a budget category crosses 90% or 100% for the month.</div>
      <button class="btn secondary" id="enableAlertsBtn">Enable budget alerts</button>
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
    const text2 = cssVar('--text2')
    const surface = cssVar('--surface')
    renderChartInstance('budget', container.querySelector('#budgetChart'), {
      type: 'doughnut',
      data: {
        labels: types,
        datasets: [{
          data: types.map(t => sums[t]),
          backgroundColor: types.map((_, i) => cssVar(TYPE_COLORS[i % TYPE_COLORS.length])),
          borderColor: surface, borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: text2, font: { size: 11 }, boxWidth: 12, padding: 10 } },
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
      const pct = Math.round((total / avgIncome) * 100)
      compareEl.textContent = `${pct}% of your avg income — ${formatMoney(avgIncome)}/mo over ${incomeMonths.length} logged month${incomeMonths.length === 1 ? '' : 's'}`
      compareEl.style.color = total > avgIncome ? 'var(--red)' : 'var(--text2)'
    }
    renderChart()
  }
  container.querySelectorAll('.budgetInput').forEach(input => {
    input.oninput = updateTotal
  })
  updateTotal()

  container.querySelector('#loadSuggested').onclick = async () => {
    const ok = await confirmDialog('Fill budget fields from your last 3 months of spending? This overwrites what\'s currently typed here — nothing saves until you click Save budgets.', 'Load')
    if (!ok) return
    container.querySelectorAll('.budgetInput').forEach(input => {
      const suggested = suggestedLimits[input.dataset.cat]
      if (suggested !== undefined) input.value = suggested
    })
    updateTotal()
    toast('Loaded — review and Save budgets when ready')
  }

  container.querySelector('#saveBudgets').onclick = async () => {
    const btn = container.querySelector('#saveBudgets')
    btn.disabled = true
    btn.textContent = 'Saving…'
    try {
      const inputs = [...container.querySelectorAll('.budgetInput')]
      for (const input of inputs) {
        const val = parseFloat(input.value) || 0
        const prev = budgetMap[input.dataset.cat] || 0
        if (val !== prev) {
          await upsertBudget(input.dataset.cat, val, input.dataset.type)
        }
      }
      toast('Budgets saved')
      await onBudgetsChanged()
    } catch (e) {
      toast(e.message || 'Failed to save budgets')
    } finally {
      btn.disabled = false
      btn.textContent = 'Save budgets'
    }
  }

  container.querySelector('#enableAlertsBtn').onclick = async () => {
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
}
