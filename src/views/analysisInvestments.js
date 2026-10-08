import { Chart } from 'chart.js'
import { netWorthTimeline, netWorthChangePct, accountReturns } from '../analysisData.js'
import { formatMoney, formatDateDMY, escapeHtml, formatMoneyAxis } from '../helpers.js'
import { isPrivacyMode, privacyToggleHtml, privacyOverlayHtml } from '../privacy.js'
import { icon } from '../icons.js'

// Chart.js's registerables are already registered once, at module load, by
// analysis.js — which is always imported before this file's renderers are
// ever called (main.js -> analysis.js -> this module, all static ESM
// imports resolve before any render function runs). No need to repeat it.
const chartInstances = {}
function renderChart(key, canvas, config) {
  chartInstances[key]?.destroy()
  chartInstances[key] = new Chart(canvas.getContext('2d'), config)
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

const CATEGORY_ICON = { cash: 'wallet', invested: 'trendingUp', insurance: 'shield' }
const CATEGORY_LABEL = { cash: 'Cash', invested: 'Invested', insurance: 'Insurance' }
const CATEGORY_ORDER = ['cash', 'invested', 'insurance']

function changeBadgeHtml(changePct) {
  if (changePct == null) return ''
  const sign = changePct >= 0 ? 'pos' : 'neg'
  const arrow = changePct >= 0 ? '▲' : '▼'
  return `<div class="holding-change ${sign}">${arrow} ${Math.abs(changePct).toFixed(1)}%</div>`
}

// Desktop: KevFin-style density — the same total/cash/invested/insurance
// trend chart as before, plus every holding broken out individually with
// its own current value, return %, and a tiny sparkline.
export function renderInvestmentDepth(container, networth) {
  const privacyOn = isPrivacyMode()

  // Gated on the timeline, not accountReturns — a check-in from before
  // multi-asset support has no per-account items at all (just legacy
  // cash/invested fields, which only netWorthTimeline's fallback reads), so
  // it wouldn't show up as any account here even though it's real history.
  if (!netWorthTimeline(networth).length) {
    container.innerHTML = `
      <div class="top-bar" style="margin-top:6px"><h2 style="margin:0">Net worth</h2></div>
      <div class="card"><div class="empty-state">No check-ins yet — tap the Net worth widget on the Dashboard to log one.</div></div>
    `
    return
  }

  const returns = accountReturns(networth)
  const groups = { cash: [], invested: [], insurance: [] }
  for (const r of returns) {
    const bucket = groups[r.category] ? r.category : 'invested' // unrecognized future category — grouped with invested, same rule netWorthTimeline uses
    groups[bucket].push(r)
  }
  for (const key of CATEGORY_ORDER) groups[key].sort((a, b) => b.lastValue - a.lastValue)

  container.innerHTML = `
    <div class="top-bar" style="margin-top:6px"><h2 style="margin:0">Net worth</h2>${privacyToggleHtml('privacyToggleNw')}</div>
    <div class="privacy-wrap${privacyOn ? ' active' : ''}">
      <div class="card"><div class="chart-box"><canvas id="networthChart"></canvas></div></div>
      ${CATEGORY_ORDER.filter(k => groups[k].length).map(k => `
        <h2 style="margin-top:16px">${CATEGORY_LABEL[k]}</h2>
        <div class="card">
          ${groups[k].map(r => holdingRowHtml(r)).join('')}
        </div>
      `).join('')}
      ${privacyOverlayHtml()}
    </div>
  `

  renderTotalChart(container, networth)
  for (const key of CATEGORY_ORDER) {
    for (const r of groups[key]) renderSparkline(container, r)
  }
}

function holdingRowHtml(r) {
  const slug = r.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()
  return `
    <div class="holding-row">
      <div class="holding-icon">${icon(CATEGORY_ICON[r.category] || 'wallet')}</div>
      <div class="holding-main">
        <div class="holding-name">${escapeHtml(r.name)}</div>
        <div class="holding-meta">as of ${formatDateDMY(r.lastDate)}</div>
      </div>
      <div class="holding-spark"><canvas id="spark-${slug}"></canvas></div>
      <div class="holding-vals">
        <div class="holding-value">${formatMoney(r.lastValue)}</div>
        ${changeBadgeHtml(r.changePct)}
      </div>
    </div>
  `
}

function renderSparkline(container, r) {
  const slug = r.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const canvas = container.querySelector(`#spark-${slug}`)
  if (!canvas || r.points.length < 2) { canvas?.closest('.holding-spark')?.remove(); return }

  const color = cssVar(r.changePct != null && r.changePct < 0 ? '--red' : '--green')
  renderChart(`spark-${slug}`, canvas, {
    type: 'line',
    data: {
      labels: r.points.map(p => p.date),
      datasets: [{ data: r.points.map(p => p.value), borderColor: color, borderWidth: 1.5, fill: false, tension: 0.3, pointRadius: 0 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
    },
  })
}

function renderTotalChart(container, networth) {
  const canvas = container.querySelector('#networthChart')
  const timeline = netWorthTimeline(networth)

  const labels = timeline.map(n => new Date(n.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }))
  const text3 = cssVar('--text3')
  const grid = cssVar('--chart-grid')
  const c1 = cssVar('--chart-1')
  const c3 = cssVar('--chart-3')
  const c5 = cssVar('--chart-5')
  const accent = cssVar('--accent')
  const hasInsurance = timeline.some(n => n.insurance > 0)

  renderChart('networth', canvas, {
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
        y: { ticks: { color: text3, font: { size: 10 }, callback: v => formatMoneyAxis(v) }, grid: { color: grid } },
      },
    },
  })
}

// Mobile: netwrth.app-style hero card — one big number + a trend badge,
// nothing else. Per-holding depth is a desktop-only feature in this pass.
export function renderNetWorthSummaryCard(container, networth) {
  const timeline = netWorthTimeline(networth)
  const privacyOn = isPrivacyMode()

  if (!timeline.length) {
    container.innerHTML = `
      <div class="top-bar" style="margin-top:6px"><h2 style="margin:0">Net worth</h2></div>
      <div class="card"><div class="empty-state">No check-ins yet — tap the Net worth widget on the Dashboard to log one.</div></div>
    `
    return
  }

  const total = timeline[timeline.length - 1].total
  const changePct = netWorthChangePct(networth)

  container.innerHTML = `
    <div class="top-bar" style="margin-top:6px"><h2 style="margin:0">Net worth</h2>${privacyToggleHtml('privacyToggleNw')}</div>
    <div class="privacy-wrap${privacyOn ? ' active' : ''}">
      <div class="card nw-hero-card">
        <div class="nw-hero-value">${formatMoney(total)}</div>
        ${changePct != null ? `<div class="nw-hero-trend ${changePct >= 0 ? 'pos' : 'neg'}">${changePct >= 0 ? '▲' : '▼'} ${Math.abs(changePct).toFixed(1)}% since first check-in</div>` : ''}
      </div>
      ${privacyOverlayHtml()}
    </div>
  `
}
