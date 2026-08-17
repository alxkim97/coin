import { Chart, registerables } from 'chart.js'
import { dailySpend, categoryBreakdown, monthlyRollup, heatmapData, generateInsights, computeProjection, computePersonalRecords, netWorthTimeline } from '../analysisData.js'
import { getAchievementDefs } from '../achievements.js'
import { formatMoney, localISO, toast, formatDateDMY } from '../helpers.js'
import { isPrivacyMode, setPrivacyMode } from '../privacy.js'

Chart.register(...registerables)

const PERIODS = [7, 30, 90, 365]
// persists across re-renders within the session — same pattern as transactions.js's filter state
let period = 30

// tracks which achievements were already unlocked as of the last render, so
// a toast only fires for ones that flip during this session (not on every render)
let prevUnlocked = new Set()

const chartInstances = {}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function privacyToggleHtml(id) {
  const on = isPrivacyMode()
  return `<button class="privacy-toggle-btn" id="${id}" title="${on ? 'Show balances' : 'Hide balances'}">${on ? '🙈' : '👁️'}</button>`
}

export function renderAnalysis(container, opts) {
  const { txns, budgets, recurring, networth } = opts
  const privacyOn = isPrivacyMode()
  container.innerHTML = `
    <div class="top-bar"><h1>Analysis</h1></div>
    <div class="range-toggle" id="periodToggle">
      ${PERIODS.map(p => `<button data-period="${p}" class="${p === period ? 'active' : ''}">${p === 365 ? '1Y' : p + 'D'}</button>`).join('')}
    </div>

    <h2>Spend Trend</h2>
    <div class="card"><div class="chart-box"><canvas id="trendChart"></canvas></div></div>

    <h2>By Category</h2>
    <div class="card"><div class="chart-box chart-box-donut"><canvas id="categoryChart"></canvas></div></div>

    <h2>Income vs Expense (12 months)</h2>
    <div class="card"><div class="chart-box"><canvas id="rollupChart"></canvas></div></div>

    <h2>Insights</h2>
    <div class="card" id="insightsCard"></div>

    <h2>Activity Heatmap</h2>
    <div class="card"><div id="heatmap"></div></div>

    <div class="top-bar" style="margin-top:6px"><h2 style="margin:0">Net Worth</h2>${privacyToggleHtml('privacyToggleNw')}</div>
    <div class="privacy-wrap${privacyOn ? ' active' : ''}">
      <div class="card"><div class="chart-box"><canvas id="networthChart"></canvas></div></div>
      ${privacyOn ? '<div class="privacy-overlay">🔒 Balances hidden</div>' : ''}
    </div>

    <div class="top-bar" style="margin-top:6px"><h2 style="margin:0">Projection</h2>${privacyToggleHtml('privacyToggleProj')}</div>
    <div class="privacy-wrap${privacyOn ? ' active' : ''}">
      <div class="card">
        <div class="proj-phase" id="projPhase"></div>
        <div class="proj-stats" id="projStats"></div>
        <div class="chart-box"><canvas id="projChart"></canvas></div>
        <div class="proj-note" id="projNote"></div>
      </div>
      ${privacyOn ? '<div class="privacy-overlay">🔒 Balances hidden</div>' : ''}
    </div>

    <h2>Personal Records</h2>
    <div class="card"><div class="record-grid" id="personalRecords"></div></div>

    <div class="top-bar" style="margin-top:6px"><h2 style="margin:0">Achievements</h2><span class="achievement-count" id="achievementCount"></span></div>
    <div class="card"><div class="achievement-grid" id="achievementGrid"></div></div>
  `

  container.querySelectorAll('#periodToggle button').forEach(btn => {
    btn.onclick = () => { period = Number(btn.dataset.period); renderAnalysis(container, opts) }
  })

  ;['privacyToggleNw', 'privacyToggleProj'].forEach(id => {
    const btn = container.querySelector('#' + id)
    if (btn) btn.onclick = () => { setPrivacyMode(!isPrivacyMode()); renderAnalysis(container, opts) }
  })

  renderTrendChart(container, txns)
  renderCategoryChart(container, txns)
  renderRollupChart(container, txns)
  renderInsights(container, txns)
  renderHeatmap(container, txns)
  renderNetWorthChart(container, networth || [])
  renderProjectionSection(container, txns, networth || [])
  renderPersonalRecords(container, txns)
  renderAchievements(container, txns, budgets, recurring)
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
      <div class="record-icon">${r.icon}</div>
      <div class="record-val">${r.value}</div>
      <div class="record-lbl">${r.label}</div>
      <div class="record-date">${r.date ? formatDateDMY(r.date) : (r.dateLabel || '')}</div>
    </div>
  `).join('')
}

function renderNetWorthChart(container, networth) {
  const canvas = container.querySelector('#networthChart')
  if (chartInstances.networth) chartInstances.networth.destroy()
  container.querySelector('#networthEmpty')?.remove()

  const timeline = netWorthTimeline(networth)
  if (!timeline.length) {
    canvas.style.display = 'none'
    canvas.insertAdjacentHTML('afterend', '<div class="empty-state" id="networthEmpty">No check-ins yet — add one in Settings → Net Worth.</div>')
    return
  }
  canvas.style.display = ''

  const labels = timeline.map(n => new Date(n.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }))
  const text3 = cssVar('--text3')
  const grid = cssVar('--chart-grid')
  const c1 = cssVar('--chart-1')
  const c3 = cssVar('--chart-3')
  const c5 = cssVar('--chart-5')
  const accent = cssVar('--accent')
  const hasInsurance = timeline.some(n => n.insurance > 0)

  chartInstances.networth = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Total', data: timeline.map(n => n.total),
          borderColor: accent, backgroundColor: accent + '22', borderWidth: 3,
          fill: true, tension: 0.3, pointRadius: 3,
        },
        {
          label: 'Cash', data: timeline.map(n => n.cash),
          borderColor: c1, borderWidth: 1.5, borderDash: [4, 3], fill: false, tension: 0.3, pointRadius: 2,
        },
        {
          label: 'Invested', data: timeline.map(n => n.invested),
          borderColor: c3, borderWidth: 1.5, borderDash: [4, 3], fill: false, tension: 0.3, pointRadius: 2,
        },
        ...(hasInsurance ? [{
          label: 'Insurance', data: timeline.map(n => n.insurance),
          borderColor: c5, borderWidth: 1.5, borderDash: [4, 3], fill: false, tension: 0.3, pointRadius: 2,
        }] : []),
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
        y: { ticks: { color: text3, font: { size: 10 }, callback: v => formatMoney(v) }, grid: { color: grid } },
      },
    },
  })
}

function renderProjectionSection(container, txns, networth) {
  const proj = computeProjection(txns, networth, 12)

  container.querySelector('#projPhase').innerHTML = `<span class="proj-phase-icon">${proj.phaseIcon}</span> ${proj.phase}`
  container.querySelector('#projStats').innerHTML = `
    <div class="proj-stat"><div class="proj-stat-label">Avg Income</div><div class="proj-stat-val">${formatMoney(proj.avgIncome)}/mo</div></div>
    <div class="proj-stat"><div class="proj-stat-label">Avg Expense</div><div class="proj-stat-val">${formatMoney(proj.avgExpense)}/mo</div></div>
    <div class="proj-stat"><div class="proj-stat-label">Avg Net</div><div class="proj-stat-val" style="color:${proj.avgNet >= 0 ? 'var(--green)' : 'var(--red)'}">${formatMoney(proj.avgNet)}/mo</div></div>
  `
  container.querySelector('#projNote').textContent = proj.hasCheckin
    ? ''
    : 'No net worth check-in yet — projection starts from ฿0. Add a check-in in Settings → Net Worth for a real starting point.'

  if (chartInstances.projection) chartInstances.projection.destroy()
  const text3 = cssVar('--text3')
  const grid = cssVar('--chart-grid')
  const accent = cssVar('--accent')

  chartInstances.projection = new Chart(container.querySelector('#projChart').getContext('2d'), {
    type: 'line',
    data: {
      labels: proj.points.map(p => p.label),
      datasets: [{
        label: 'Projected Net Worth', data: proj.points.map(p => p.value),
        borderColor: accent, backgroundColor: accent + '15', borderWidth: 2, borderDash: [6, 4],
        fill: true, tension: 0.3, pointRadius: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => formatMoney(ctx.parsed.y) } },
      },
      scales: {
        x: { ticks: { color: text3, font: { size: 10 }, maxTicksLimit: 7 }, grid: { display: false } },
        y: { ticks: { color: text3, font: { size: 10 }, callback: v => formatMoney(v) }, grid: { color: grid } },
      },
    },
  })
}

function renderAchievements(container, txns, budgets, recurring) {
  const defs = getAchievementDefs(txns, budgets || [], recurring || [])

  const nowUnlocked = new Set(defs.filter(a => a.u).map(a => a.name))
  if (prevUnlocked.size > 0) {
    for (const name of nowUnlocked) {
      if (!prevUnlocked.has(name)) {
        const a = defs.find(d => d.name === name)
        toast(`🎉 Achievement unlocked: ${a.icon} ${a.name}`)
      }
    }
  }
  prevUnlocked = nowUnlocked

  const sorted = [...defs].sort((a, b) => (b.u ? 1 : 0) - (a.u ? 1 : 0))
  const unlockedCount = defs.filter(a => a.u).length
  container.querySelector('#achievementCount').textContent = `${unlockedCount} / ${defs.length} unlocked`
  container.querySelector('#achievementGrid').innerHTML = sorted.map(a => `
    <div class="achievement-card ${a.u ? 'unlocked' : 'locked'}" title="${a.desc}">
      <div class="achievement-icon">${a.icon}</div>
      <div class="achievement-name">${a.name}</div>
      <div class="achievement-desc">${a.desc}</div>
      ${!a.u && a.prog ? `<div class="achievement-progress">${a.prog}</div>` : ''}
    </div>
  `).join('')
}

function renderTrendChart(container, txns) {
  const points = dailySpend(txns, period)
  const avg = points.reduce((s, p) => s + p.amount, 0) / (points.length || 1)
  const ctx = container.querySelector('#trendChart').getContext('2d')
  if (chartInstances.trend) chartInstances.trend.destroy()

  const accent = cssVar('--accent')
  const text3 = cssVar('--text3')
  const grid = cssVar('--chart-grid')
  const labels = points.map(p => {
    const d = new Date(p.date + 'T00:00:00')
    return period > 90
      ? d.toLocaleDateString('en-US', { month: 'short' })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  })

  chartInstances.trend = new Chart(ctx, {
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
        y: { ticks: { color: text3, font: { size: 10 }, callback: v => formatMoney(v) }, grid: { color: grid } },
      },
    },
  })
}

const DONUT_PALETTE = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--chart-7', '--chart-8']

function renderCategoryChart(container, txns) {
  const data = categoryBreakdown(txns, period)
  const canvas = container.querySelector('#categoryChart')
  if (chartInstances.category) chartInstances.category.destroy()
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

  chartInstances.category = new Chart(canvas.getContext('2d'), {
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
  if (chartInstances.rollup) chartInstances.rollup.destroy()

  const text3 = cssVar('--text3')
  const grid = cssVar('--chart-grid')
  const green = cssVar('--green')
  const red = cssVar('--red')

  chartInstances.rollup = new Chart(container.querySelector('#rollupChart').getContext('2d'), {
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
        y: { ticks: { color: text3, font: { size: 10 }, callback: v => formatMoney(v) }, grid: { color: grid } },
      },
    },
  })
}

function renderInsights(container, txns) {
  const insights = generateInsights(txns)
  container.querySelector('#insightsCard').innerHTML = insights.length
    ? insights.map(text => `<div class="insight-row">💡 ${text}</div>`).join('')
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
