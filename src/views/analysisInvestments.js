import { Chart } from 'chart.js'
import { netWorthTimeline } from '../analysisData.js'
import { formatMoney } from '../helpers.js'
import { isPrivacyMode, privacyToggleHtml } from '../privacy.js'

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

// Phase 3 of the design-evolution plan: wires the desktop/mobile fork point
// in analysis.js without changing behavior yet — both branches render
// today's net-worth chart unchanged. Phase 4 replaces renderInvestmentDepth
// with real per-holding rows + sparklines (KevFin-style) and
// renderNetWorthSummaryCard with a netwrth.app-style hero card.
export function renderInvestmentDepth(container, networth) {
  renderNetWorthSection(container, networth)
}

export function renderNetWorthSummaryCard(container, networth) {
  renderNetWorthSection(container, networth)
}

function renderNetWorthSection(container, networth) {
  const privacyOn = isPrivacyMode()
  container.innerHTML = `
    <div class="top-bar" style="margin-top:6px"><h2 style="margin:0">Net Worth</h2>${privacyToggleHtml('privacyToggleNw')}</div>
    <div class="privacy-wrap${privacyOn ? ' active' : ''}">
      <div class="card"><div class="chart-box"><canvas id="networthChart"></canvas></div></div>
      <div class="privacy-overlay">🔒 Balances hidden</div>
    </div>
  `
  renderNetWorthChart(container, networth)
}

function renderNetWorthChart(container, networth) {
  const canvas = container.querySelector('#networthChart')
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
        y: { ticks: { color: text3, font: { size: 10 }, callback: v => formatMoney(v) }, grid: { color: grid } },
      },
    },
  })
}
