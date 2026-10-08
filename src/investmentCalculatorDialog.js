import { Chart } from 'chart.js'
import { investmentContributions } from './analysisData.js'
import { formatMoney, escapeHtml, formatMoneyAxis } from './helpers.js'

// Chart.js's registerables are already registered once, by analysis.js on
// module load — this file only needs the Chart constructor itself, same
// precedent as analysisInvestments.js.

// Crude name-sniff for a sensible default return assumption — just a
// prefilled starting point the user can always override, so a wrong guess
// for some future fund name is low-stakes.
function guessDefaultReturn(name) {
  return /gold|gld/i.test(name) ? 7 : 9
}

const FUND_COLORS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--chart-7', '--chart-8']

// Real transaction history under the "Investment" category can be messy —
// mislabeled entries (a one-off insurance payment accidentally logged under
// Investment), combined/garbled vendor notes, one-off buys mixed in with
// real recurring DCA. Rather than guess which subcategory strings are "real"
// DCA, every detected fund is included by default and the user curates with
// a checkbox per fund — persisted so that curation sticks across visits
// instead of needing to be redone every time.
const EXCLUDED_KEY = 'coin_calc_excluded_funds'
function getExcluded() {
  try {
    const saved = JSON.parse(localStorage.getItem(EXCLUDED_KEY))
    return new Set(Array.isArray(saved) ? saved : [])
  } catch {
    return new Set()
  }
}
function setExcluded(set) {
  localStorage.setItem(EXCLUDED_KEY, JSON.stringify([...set]))
}

function seedFunds(txns) {
  const contributions = investmentContributions(txns)
  const source = contributions.length ? contributions : [{ subcategory: 'Custom', total: 0, avgMonthly: 0 }]
  return source.map(f => ({
    subcategory: f.subcategory,
    start: f.total,
    monthly: Math.round(f.avgMonthly),
    annualReturnPct: guessDefaultReturn(f.subcategory),
  }))
}

// Month-by-month monthly-compounding projection, sampled at each year mark
// (index 0 = now) — standard future-value-of-a-monthly-annuity math, same
// approach verified against the closed-form formula in the standalone
// Investment Tracker. Returns an array of length `years + 1`.
function projectFund(fund, horizonYears) {
  const n = horizonYears * 12
  const r = fund.annualReturnPct / 100 / 12
  let bal = fund.start
  const yearly = [bal]
  for (let m = 1; m <= n; m++) {
    bal = bal * (1 + r) + fund.monthly
    if (m % 12 === 0) yearly.push(bal)
  }
  return yearly
}

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
export function openInvestmentCalculator({ txns }) {
  let funds = seedFunds(txns)
  let years = 10
  let excluded = getExcluded()

  const overlay = document.createElement('div')
  overlay.className = 'confirm-overlay'
  document.body.appendChild(overlay)

  function render() {
    overlay.innerHTML = `
      <div class="confirm-box modal-box-xl">
        <div class="nwq-title">Investment calculator</div>
        <div class="nwq-sub">Projection only, not a forecast — assumes each checked fund's contribution pace and a flat annual return compounded monthly, held constant for the whole horizon.</div>

        <div class="chart-box large"><canvas id="icChart"></canvas></div>

        <div class="proj-stats" style="margin-top:14px">
          <div class="proj-stat"><div class="proj-stat-label">Projected Value</div><div class="proj-stat-val" id="icFinalValue"></div></div>
          <div class="proj-stat"><div class="proj-stat-label">Total Contributed</div><div class="proj-stat-val" id="icContributed"></div></div>
          <div class="proj-stat"><div class="proj-stat-label">Total Growth</div><div class="proj-stat-val" id="icGrowth"></div></div>
        </div>

        <label style="margin-top:18px">Time horizon — <strong id="icYearsLabel">${years}</strong> year${years === 1 ? '' : 's'}</label>
        <input type="range" id="icYears" min="1" max="40" step="1" value="${years}" style="accent-color:var(--accent)" />

        <label style="margin-top:18px">Funds <span style="font-weight:400;color:var(--text2);text-transform:none;letter-spacing:0">— uncheck anything mislabeled or not real DCA</span></label>
        <div class="nwq-rows">
          ${funds.map((f, i) => {
            const key = f.subcategory.toLowerCase()
            const isIncluded = !excluded.has(key)
            return `
            <div class="fund-row" data-fund-card="${i}" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--border);border-radius:10px;margin-bottom:6px;opacity:${isIncluded ? '1' : '.5'}">
              <label style="display:flex;align-items:center;gap:8px;margin:0;flex:1;min-width:150px;cursor:pointer">
                <input type="checkbox" class="fund-include" data-fund="${i}" ${isIncluded ? 'checked' : ''} style="width:16px;height:16px;margin:0;padding:0;border:none;background:none;accent-color:var(--accent);flex-shrink:0" />
                <span>
                  <div style="font-weight:700;font-size:13px;line-height:1.3">${escapeHtml(f.subcategory)}</div>
                  <div style="font-size:11px;color:var(--text2)">${formatMoney(f.start)} basis</div>
                </span>
              </label>
              <div style="display:flex;align-items:center;gap:5px">
                <span style="font-size:11px;color:var(--text2);white-space:nowrap">/mo</span>
                <input type="number" class="fund-monthly" data-fund="${i}" value="${f.monthly}" min="0" step="10" style="width:76px;padding:6px 8px;font-size:13px" />
              </div>
              <div style="display:flex;align-items:center;gap:5px">
                <input type="number" class="fund-return" data-fund="${i}" value="${f.annualReturnPct}" min="0" max="30" step="0.5" style="width:52px;padding:6px 8px;font-size:13px" />
                <span style="font-size:11px;color:var(--text2);white-space:nowrap">%/yr</span>
              </div>
            </div>
          `}).join('')}
        </div>
      </div>
    `
    wire()
    recompute()
  }

  function wire() {
    overlay.onclick = e => { if (e.target === overlay) close() }

    overlay.querySelectorAll('.fund-monthly').forEach(el => {
      el.oninput = () => { funds[Number(el.dataset.fund)].monthly = parseFloat(el.value) || 0; recompute() }
    })
    overlay.querySelectorAll('.fund-return').forEach(el => {
      el.oninput = () => { funds[Number(el.dataset.fund)].annualReturnPct = parseFloat(el.value) || 0; recompute() }
    })
    overlay.querySelectorAll('.fund-include').forEach(el => {
      el.onchange = () => {
        const key = funds[Number(el.dataset.fund)].subcategory.toLowerCase()
        if (el.checked) excluded.delete(key)
        else excluded.add(key)
        setExcluded(excluded)
        render()
      }
    })
    const yearsInput = overlay.querySelector('#icYears')
    yearsInput.oninput = () => {
      years = Number(yearsInput.value)
      overlay.querySelector('#icYearsLabel').textContent = years
      recompute()
    }
  }

  function recompute() {
    const activeFunds = funds.filter(f => !excluded.has(f.subcategory.toLowerCase()))
    const series = activeFunds.map(f => projectFund(f, years))
    const totalSeries = series.length
      ? series[0].map((_, yi) => series.reduce((s, s2) => s + s2[yi], 0))
      : Array.from({ length: years + 1 }, () => 0)
    const finalValue = totalSeries[totalSeries.length - 1]
    const totalContributed = activeFunds.reduce((s, f) => s + f.start + f.monthly * years * 12, 0)
    const growth = finalValue - totalContributed

    overlay.querySelector('#icFinalValue').textContent = formatMoney(finalValue)
    overlay.querySelector('#icContributed').textContent = formatMoney(totalContributed)
    const growthEl = overlay.querySelector('#icGrowth')
    growthEl.textContent = formatMoney(growth)
    growthEl.style.color = growth >= 0 ? 'var(--green)' : 'var(--red)'

    const labels = totalSeries.map((_, yi) => yi === 0 ? 'Now' : `Yr ${yi}`)
    const text3 = cssVar('--text3')
    const grid = cssVar('--chart-grid')
    const accent = cssVar('--accent')

    const fundDatasets = activeFunds.map((f, i) => ({
      label: f.subcategory,
      data: series[i],
      borderColor: cssVar(FUND_COLORS[i % FUND_COLORS.length]),
      borderWidth: 1.5,
      borderDash: [5, 4],
      fill: false,
      pointRadius: 0,
      tension: 0.2,
    }))

    renderChart('investmentCalc', overlay.querySelector('#icChart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          ...fundDatasets,
          {
            label: 'Total', data: totalSeries,
            borderColor: accent, backgroundColor: accent + '15', borderWidth: 2.5, borderDash: [6, 4],
            fill: fundDatasets.length > 1, tension: 0.2, pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: fundDatasets.length > 1
            ? { position: 'bottom', labels: { color: text3, font: { size: 10 }, boxWidth: 10, usePointStyle: true } }
            : { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}` } },
        },
        scales: {
          x: { ticks: { color: text3, font: { size: 10 }, maxTicksLimit: 10 }, grid: { display: false } },
          y: { ticks: { color: text3, font: { size: 10 }, callback: v => formatMoneyAxis(v) }, grid: { color: grid } },
        },
      },
    })
  }

  function close() {
    chartInstances.investmentCalc?.destroy()
    overlay.remove()
  }

  render()
}
