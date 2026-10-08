import { Chart } from 'chart.js'
import { computeProjection } from './analysisData.js'
import { formatMoney, formatMoneyAxis } from './helpers.js'
import { isPrivacyMode, setPrivacyMode, privacyToggleHtml, syncPrivacyButton, privacyOverlayHtml } from './privacy.js'
import { icon } from './icons.js'

// Chart.js's registerables are already registered once, by analysis.js on
// module load — this file only needs the Chart constructor itself, same
// precedent as analysisInvestments.js.

const HORIZONS = [6, 12, 24, 36]
let horizon = 12

const chartInstances = {}
function renderChart(key, canvas, config) {
  chartInstances[key]?.destroy()
  chartInstances[key] = new Chart(canvas.getContext('2d'), config)
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// Same markPaidDialog.js/netWorthQuickLog.js overlay pattern — a self-closing
// popup appended straight to document.body, rather than a dedicated page reached by
// navigating away from Analysis.
export function openBalanceForecast({ txns, networth }) {
  const overlay = document.createElement('div')
  overlay.className = 'confirm-overlay'
  document.body.appendChild(overlay)

  function render() {
    const privacyOn = isPrivacyMode()
    overlay.innerHTML = `
      <div class="confirm-box modal-box-xl">
        <div class="nwq-title" style="display:flex;align-items:center;justify-content:space-between">
          <span>Balance Forecast</span>
          ${privacyToggleHtml('privacyToggleBf')}
        </div>
        <div class="range-toggle" id="horizonToggle" style="margin-top:10px">
          ${HORIZONS.map(h => `<button data-horizon="${h}" class="${h === horizon ? 'active' : ''}">${h}M</button>`).join('')}
        </div>

        <div class="privacy-wrap${privacyOn ? ' active' : ''}" style="margin-top:14px">
          <div class="proj-phase" id="projPhase"></div>
          <div class="proj-stats" id="projStats"></div>
          <div class="chart-box large"><canvas id="projChart"></canvas></div>
          <div class="proj-note" id="projNote"></div>
          ${privacyOverlayHtml()}
        </div>
      </div>
    `
    wire()
    draw()
  }

  function wire() {
    overlay.onclick = e => { if (e.target === overlay) close() }
    overlay.querySelectorAll('#horizonToggle button').forEach(btn => {
      btn.onclick = () => { horizon = Number(btn.dataset.horizon); render() }
    })
    const privacyBtn = overlay.querySelector('#privacyToggleBf')
    if (privacyBtn) {
      privacyBtn.onclick = () => {
        setPrivacyMode(!isPrivacyMode())
        const on = isPrivacyMode()
        overlay.querySelectorAll('.privacy-wrap').forEach(w => w.classList.toggle('active', on))
        syncPrivacyButton(privacyBtn, on)
      }
    }
  }

  function draw() {
    const proj = computeProjection(txns, networth, horizon)

    overlay.querySelector('#projPhase').innerHTML = `<span class="proj-phase-icon">${icon(proj.phaseIcon, 18)}</span> ${proj.phase}`
    overlay.querySelector('#projStats').innerHTML = `
      <div class="proj-stat"><div class="proj-stat-label">Avg Income</div><div class="proj-stat-val">${formatMoney(proj.avgIncome)}/mo</div></div>
      <div class="proj-stat"><div class="proj-stat-label">Avg Expense</div><div class="proj-stat-val">${formatMoney(proj.avgExpense)}/mo</div></div>
      <div class="proj-stat"><div class="proj-stat-label">Avg Net</div><div class="proj-stat-val" style="color:${proj.avgNet >= 0 ? 'var(--green)' : 'var(--red)'}">${formatMoney(proj.avgNet)}/mo</div></div>
    `
    overlay.querySelector('#projNote').textContent = proj.hasCheckin
      ? ''
      : 'No net worth check-in yet — projection starts from ฿0. Tap the Net worth widget on the Dashboard to log one for a real starting point.'

    const text3 = cssVar('--text3')
    const grid = cssVar('--chart-grid')
    const accent = cssVar('--accent')

    renderChart('projection', overlay.querySelector('#projChart'), {
      type: 'line',
      data: {
        labels: proj.points.map(p => p.label),
        datasets: [{
          label: 'Projected net worth', data: proj.points.map(p => p.value),
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
          y: { ticks: { color: text3, font: { size: 10 }, callback: v => formatMoneyAxis(v) }, grid: { color: grid } },
        },
      },
    })
  }

  function close() {
    chartInstances.projection?.destroy()
    overlay.remove()
  }

  render()
}
