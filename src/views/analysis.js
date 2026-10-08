import { Chart, registerables } from 'chart.js'
import { dailySpend, categoryBreakdown, monthlyRollup, heatmapData, generateInsights, computeProjection, computePersonalRecords, upcomingBills } from '../analysisData.js'
import { getAchievementDefs } from '../achievements.js'
import { formatMoney, localISO, toast, formatDateDMY, escapeHtml, formatMoneyAxis } from '../helpers.js'
import { isPrivacyMode, setPrivacyMode, syncPrivacyButton, privacyOverlayHtml } from '../privacy.js'
import { isDesktopView } from '../platform.js'
import { renderInvestmentDepth, renderNetWorthSummaryCard } from './analysisInvestments.js'
import { openBalanceForecast } from '../balanceForecastDialog.js'
import { openInvestmentCalculator } from '../investmentCalculatorDialog.js'
import { openYearReview } from '../yearReviewDialog.js'
import { icon, categoryIcon } from '../icons.js'

Chart.register(...registerables)

const PERIODS = [7, 30, 90, 365]
// persists across re-renders within the session — same pattern as transactions.js's filter state
let period = 30

// tracks which achievements were already unlocked as of the last render, so
// a toast only fires for ones that flip during this session (not on every render)
let prevUnlocked = new Set()

const chartInstances = {}

// Every chart render site used to hand-repeat "destroy the old instance,
// then construct a new one" — skip the destroy once (easy to do, nothing
// enforces it) and the old Chart.js instance leaks, redrawing on a detached
// canvas. One helper makes that step mandatory instead of a convention.
function renderChart(key, canvas, config) {
  chartInstances[key]?.destroy()
  chartInstances[key] = new Chart(canvas.getContext('2d'), config)
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function renderAnalysis(container, opts) {
  const { txns, budgets, recurring, networth } = opts
  const privacyOn = isPrivacyMode()
  const proj12 = computeProjection(txns, networth || [], 12)
  const forecastSummaryText = `Projected net worth 12 months out: ${formatMoney(proj12.points[proj12.points.length - 1].value)}, based on your last 3 months' avg income/expense.`
  container.innerHTML = `
    <div class="top-bar"><h1>Analysis</h1></div>
    <div class="range-toggle" id="periodToggle">
      ${PERIODS.map(p => `<button data-period="${p}" class="${p === period ? 'active' : ''}">${p === 365 ? '1Y' : p + 'D'}</button>`).join('')}
    </div>

    <h2>Spend trend</h2>
    <div class="card"><div class="chart-box"><canvas id="trendChart"></canvas></div></div>

    <h2>By category</h2>
    <div class="card"><div class="chart-box chart-box-donut"><canvas id="categoryChart"></canvas></div></div>

    <h2>Income vs Expense (12 months)</h2>
    <div class="card"><div class="chart-box"><canvas id="rollupChart"></canvas></div></div>

    <h2>Insights</h2>
    <div class="card" id="insightsCard"></div>

    <h2>Activity heatmap</h2>
    <div class="card"><div id="heatmap"></div></div>

    <div id="investmentSection"></div>

    <h2>Balance forecast</h2>
    <div class="privacy-wrap${privacyOn ? ' active' : ''}" style="margin-bottom:16px">
      <div class="card">
        <div style="font-size:13px;color:var(--text2);margin-bottom:12px">${forecastSummaryText}</div>
        <button class="btn secondary" id="balanceForecastBtn" style="width:auto">View full forecast</button>
      </div>
      ${privacyOverlayHtml()}
    </div>

    <h2>Investment calculator</h2>
    <div class="card" style="margin-bottom:16px">
      <div style="font-size:13px;color:var(--text2);margin-bottom:12px">Project how your GLD/index-fund contributions could grow over time.</div>
      <button class="btn secondary" id="investmentCalcBtn" style="width:auto">Open Calculator</button>
    </div>

    <h2>Cashflow forecast (next 60 days)</h2>
    <div class="card"><div id="cashflowForecast"></div></div>

    <h2>Personal records</h2>
    <div class="card"><div class="record-grid" id="personalRecords"></div></div>

    <h2>Year in Review</h2>
    <div class="card" style="margin-bottom:16px">
      <div style="font-size:13px;color:var(--text2);margin-bottom:12px">A recap of any year you've logged — income, spending, top categories, and personal records.</div>
      <button class="btn secondary" id="yearReviewBtn" style="width:auto">View year in review</button>
    </div>

    <div class="top-bar" style="margin-top:6px"><h2 style="margin:0">Achievements</h2><span class="achievement-count" id="achievementCount"></span></div>
    <div class="card"><div class="achievement-grid" id="achievementGrid"></div></div>
  `

  container.querySelectorAll('#periodToggle button').forEach(btn => {
    btn.onclick = () => { period = Number(btn.dataset.period); renderAnalysis(container, opts) }
  })

  renderTrendChart(container, txns)
  renderCategoryChart(container, txns)
  renderRollupChart(container, txns)
  renderInsights(container, txns)
  renderHeatmap(container, txns)
  // Desktop/mobile fork point (Phase 3) — both branches render the same
  // chart today; Phase 4 gives desktop real per-holding depth and mobile a
  // netwrth.app-style summary card instead.
  const investmentSection = container.querySelector('#investmentSection')
  if (isDesktopView()) renderInvestmentDepth(investmentSection, networth || [])
  else renderNetWorthSummaryCard(investmentSection, networth || [])
  container.querySelector('#balanceForecastBtn').onclick = () => openBalanceForecast({ txns, networth: networth || [] })
  container.querySelector('#yearReviewBtn').onclick = () => openYearReview({ txns })
  container.querySelector('#investmentCalcBtn').onclick = () => openInvestmentCalculator({ txns })
  renderCashflowForecast(container, recurring)
  renderPersonalRecords(container, txns)
  renderAchievements(container, txns, budgets, recurring)

  // Hiding balances is a pure CSS toggle (.privacy-wrap.active blurs the
  // card) — it used to call renderAnalysis() here, which re-ran every
  // analytics scan and destroyed/rebuilt all charts just to flip a class,
  // causing a visible stutter right when someone's about to show their
  // screen. Wired last, after the investment section above has rendered its
  // own privacy-toggle button into the DOM — both buttons mirror the same
  // isPrivacyMode() flag and toggle every .privacy-wrap under this
  // container, not just their own section's.
  ;['privacyToggleNw'].forEach(id => {
    const btn = container.querySelector('#' + id)
    if (btn) btn.onclick = () => {
      setPrivacyMode(!isPrivacyMode())
      const on = isPrivacyMode()
      container.querySelectorAll('.privacy-wrap').forEach(w => w.classList.toggle('active', on))
      container.querySelectorAll('.privacy-toggle-btn').forEach(b => {
        syncPrivacyButton(b, on)
      })
    }
  })
}

function renderPersonalRecords(container, txns) {
  const el = container.querySelector('#personalRecords')
  const records = computePersonalRecords(txns)
  if (!records.length) {
    el.innerHTML = '<div class="empty-state">Log some transactions to start setting records!</div>'
    return
  }
  el.innerHTML = records.map(r => `
    <div class="record-card">
      <div class="record-icon">${icon(r.icon, 22)}</div>
      <div class="record-val">${r.value}</div>
      <div class="record-lbl">${r.label}</div>
      <div class="record-date">${r.date ? formatDateDMY(r.date) : (r.dateLabel || '')}</div>
    </div>
  `).join('')
}

function renderCashflowForecast(container, recurring) {
  const bills = upcomingBills(recurring, 60)
  const el = container.querySelector('#cashflowForecast')
  if (!bills.length) {
    el.innerHTML = '<div class="empty-state">No upcoming bills in the next 60 days.</div>'
    return
  }
  const total = bills[bills.length - 1].runningTotal
  el.innerHTML = `
    <div style="font-size:12px;color:var(--text2);margin-bottom:10px">Bills only, not a full balance projection — ${formatMoney(total)} total due over the next 60 days.</div>
    ${bills.map(b => `
      <div class="bill-row">
        <div class="bill-icon">${categoryIcon(b.category)}</div>
        <div class="bill-main">
          <div class="bill-name">${escapeHtml(b.name)}</div>
          <div class="bill-meta">${formatDateDMY(b.date)}</div>
        </div>
        <div class="bill-amt">${formatMoney(b.amount)}</div>
      </div>
    `).join('')}
  `
}

function renderAchievements(container, txns, budgets, recurring) {
  const defs = getAchievementDefs(txns, budgets || [], recurring || [])

  const nowUnlocked = new Set(defs.filter(a => a.u).map(a => a.name))
  if (prevUnlocked.size > 0) {
    for (const name of nowUnlocked) {
      if (!prevUnlocked.has(name)) {
        const a = defs.find(d => d.name === name)
        toast(`Achievement unlocked: ${a.name}`)
      }
    }
  }
  prevUnlocked = nowUnlocked

  const sorted = [...defs].sort((a, b) => (b.u ? 1 : 0) - (a.u ? 1 : 0))
  const unlockedCount = defs.filter(a => a.u).length
  container.querySelector('#achievementCount').textContent = `${unlockedCount} / ${defs.length} unlocked`
  container.querySelector('#achievementGrid').innerHTML = sorted.map(a => `
    <div class="achievement-card ${a.u ? 'unlocked' : 'locked'}" title="${a.desc}">
      <div class="achievement-icon">${icon(a.icon, 22)}</div>
      <div class="achievement-name">${a.name}</div>
      <div class="achievement-desc">${a.desc}</div>
      ${!a.u && a.prog ? `<div class="achievement-progress">${a.prog}</div>` : ''}
    </div>
  `).join('')
}

function renderTrendChart(container, txns) {
  const points = dailySpend(txns, period)
  const avg = points.reduce((s, p) => s + p.amount, 0) / (points.length || 1)
  const canvas = container.querySelector('#trendChart')

  const accent = cssVar('--accent')
  const text3 = cssVar('--text3')
  const grid = cssVar('--chart-grid')
  const labels = points.map(p => {
    const d = new Date(p.date + 'T00:00:00')
    return period > 90
      ? d.toLocaleDateString('en-US', { month: 'short' })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  })

  renderChart('trend', canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Spend', data: points.map(p => p.amount),
          borderColor: accent, backgroundColor: accent + '22', borderWidth: 2,
          fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4,
        },
        {
          label: 'Average', data: points.map(() => avg),
          borderColor: text3, borderDash: [5, 5], borderWidth: 1,
          fill: false, pointRadius: 0, tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}` } },
      },
      scales: {
        x: { ticks: { color: text3, font: { size: 10 }, maxTicksLimit: 8 }, grid: { display: false } },
        y: { ticks: { color: text3, font: { size: 10 }, callback: v => formatMoneyAxis(v) }, grid: { color: grid } },
      },
    },
  })
}

const DONUT_PALETTE = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--chart-7', '--chart-8']

function renderCategoryChart(container, txns) {
  const data = categoryBreakdown(txns, period)
  const canvas = container.querySelector('#categoryChart')
  container.querySelector('#categoryEmpty')?.remove()

  if (!data.length) {
    canvas.style.display = 'none'
    canvas.insertAdjacentHTML('afterend', '<div class="empty-state" id="categoryEmpty">No expenses in this period.</div>')
    return
  }
  canvas.style.display = ''

  const colors = data.map((d, i) => d.category === 'Other' ? cssVar('--chart-other') : cssVar(DONUT_PALETTE[i % DONUT_PALETTE.length]))
  const text2 = cssVar('--text2')
  const surface = cssVar('--surface')
  const total = data.reduce((s, d) => s + d.amount, 0)

  renderChart('category', canvas, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.category),
      datasets: [{ data: data.map(d => d.amount), backgroundColor: colors, borderColor: surface, borderWidth: 2 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: text2, font: { size: 11 }, boxWidth: 12, padding: 10 } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: ${formatMoney(ctx.parsed)} (${total ? Math.round(ctx.parsed / total * 100) : 0}%)`,
          },
        },
      },
    },
  })
}

function renderRollupChart(container, txns) {
  const rows = monthlyRollup(txns, 12)

  const text3 = cssVar('--text3')
  const grid = cssVar('--chart-grid')
  const green = cssVar('--green')
  const red = cssVar('--red')

  renderChart('rollup', container.querySelector('#rollupChart'), {
    type: 'bar',
    data: {
      labels: rows.map(r => r.label),
      datasets: [
        { label: 'Income', data: rows.map(r => r.income), backgroundColor: green, borderRadius: 4, maxBarThickness: 18 },
        { label: 'Expense', data: rows.map(r => r.expense), backgroundColor: red, borderRadius: 4, maxBarThickness: 18 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', align: 'end', labels: { color: text3, font: { size: 11 }, boxWidth: 10, usePointStyle: true } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}` } },
      },
      scales: {
        x: { ticks: { color: text3, font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: text3, font: { size: 10 }, callback: v => formatMoneyAxis(v) }, grid: { color: grid } },
      },
    },
  })
}

function renderInsights(container, txns) {
  const insights = generateInsights(txns)
  container.querySelector('#insightsCard').innerHTML = insights.length
    ? insights.map(text => `<div class="insight-row">${icon('bulb', 16)}<span>${text}</span></div>`).join('')
    : '<div class="empty-state">Not enough data yet for insights — keep logging.</div>'
}

function renderHeatmap(container, txns) {
  const days = 371
  const data = heatmapData(txns, days)
  const amounts = Object.values(data).filter(a => a > 0).sort((a, b) => a - b)
  const quantile = p => amounts.length ? amounts[Math.min(amounts.length - 1, Math.floor(p * amounts.length))] : 0
  const t1 = quantile(0.25), t2 = quantile(0.5), t3 = quantile(0.75)
  const levelFor = amt => !amt ? 0 : amt <= t1 ? 1 : amt <= t2 ? 2 : amt <= t3 ? 3 : 4

  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - (days - 1))
  start.setDate(start.getDate() - start.getDay()) // back up to the preceding Sunday so weeks form complete columns

  const cells = []
  const cursor = new Date(start)
  while (cursor <= today) {
    const ds = localISO(cursor)
    cells.push({ date: ds, amount: data[ds] || 0, level: levelFor(data[ds] || 0) })
    cursor.setDate(cursor.getDate() + 1)
  }
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  container.querySelector('#heatmap').innerHTML = `
    <div class="heatmap-grid">
      ${weeks.map(week => `
        <div class="heatmap-col">
          ${week.map(c => `<div class="heatmap-cell heat-${c.level}" title="${formatDateDMY(c.date)}: ${formatMoney(c.amount)}"></div>`).join('')}
        </div>
      `).join('')}
    </div>
    <div class="heatmap-legend">
      <span>Less</span>
      ${[0, 1, 2, 3, 4].map(l => `<div class="heatmap-cell heat-${l}"></div>`).join('')}
      <span>More</span>
    </div>
  `

  // open scrolled to the most recent week (right edge) — otherwise the grid
  // defaults to showing a year-old, inevitably-empty left edge first
  const grid = container.querySelector('.heatmap-grid')
  grid.scrollLeft = grid.scrollWidth
}
