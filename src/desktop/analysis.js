// Desktop Analysis — Ledger's Trends + Categories pages folded into one,
// plus Coin's own sections. Balance forecast, Investment calculator and Year
// in review live on the page here (popups only on the phone).
import { formatMoney, formatMoneyAxis, effectiveDate, formatDateDMY, escapeHtml, localISO, toast, confirmDialog } from '../helpers.js'
import { dailySpend, heatmapData, generateInsights, computeProjection, computePersonalRecords, upcomingBills, netWorthTimeline, accountReturns, investmentContributions, computeYearReview } from '../analysisData.js'
import { getAchievementDefs } from '../achievements.js'
import { renameNetWorthAccount, deleteNetWorthAccount } from '../supabase.js'
import { openNetWorthCheckins } from '../netWorthCheckins.js'
import { isPrivacyMode, privacyOverlayHtml } from '../privacy.js'
import { icon, categoryIcon } from '../icons.js'
import {
  headHtml, kpiHtml, cardHtml, segHtml, wireSeg, renderChart, baseOptions, chartTheme, cssVar, incomeExpenseConfig,
  donutConfig, legendHtml, paletteColor, paginate, paginationHtml, wirePagination, monthKey, shortMonth,
} from './ui.js'

// session-sticky view state, same pattern as the other views
let win = 12 // months shown in the trend charts; 0 = all logged history
let spendDays = 30
let tableYear = 'all'
let tablePage = 1
let reviewYear = null
let editingAccount = null
let prevUnlocked = new Set()

const WINDOWS = [{ v: 6, label: '6M' }, { v: 12, label: '12M' }, { v: 24, label: '24M' }, { v: 0, label: 'All' }]

// ── month rollup over the whole history (salary-shifted like the Dashboard) ──
function rollupAll(txns) {
  const cur = monthKey(new Date())
  const byKey = new Map()
  let first = cur
  for (const t of txns) {
    const k = effectiveDate(t).slice(0, 7)
    if (k < first) first = k
    if (!byKey.has(k)) byKey.set(k, { key: k, income: 0, expense: 0, count: 0, cats: {} })
    const r = byKey.get(k)
    r.count++
    if (t.type === 'income') r.income += Number(t.amount)
    else { r.expense += Number(t.amount); r.cats[t.category] = (r.cats[t.category] || 0) + Number(t.amount) }
  }
  const rows = []
  const [fy, fm] = first.split('-').map(Number)
  for (let d = new Date(fy, fm - 1, 1); monthKey(d) <= cur; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const k = monthKey(d)
    rows.push(byKey.get(k) || { key: k, income: 0, expense: 0, count: 0, cats: {} })
  }
  return rows
}

export function renderAnalysisDesktop(container, opts) {
  const { txns, budgets, recurring, networth } = opts
  const all = rollupAll(txns)
  const rows = win ? all.slice(-win) : all
  const curKey = monthKey(new Date())
  // averages use complete months that have any data — an empty or
  // still-running month would drag every average down
  const done = rows.filter(r => r.key !== curKey && r.count > 0)
  const avg = f => done.length ? done.reduce((s, r) => s + f(r), 0) / done.length : 0
  const avgIncome = avg(r => r.income)
  const avgExpense = avg(r => r.expense)
  const avgRate = avgIncome ? (avgIncome - avgExpense) / avgIncome * 100 : null
  const timeline = netWorthTimeline(networth)
  const latestNw = timeline[timeline.length - 1]
  const privacyOn = isPrivacyMode()
  const winLabel = win ? `last ${win} months` : 'all history'

  container.innerHTML = `
    ${headHtml('Analysis', `${done.length} complete month${done.length === 1 ? '' : 's'} with data · ${winLabel}`, segHtml('aWin', WINDOWS, win))}

    <div class="d-kpis">
      ${kpiHtml({ kind: 'income', icon: 'trendingUp', label: 'Avg monthly income', value: formatMoney(Math.round(avgIncome)), valueClass: 'pos', sub: `over ${done.length} month${done.length === 1 ? '' : 's'} with data` })}
      ${kpiHtml({ kind: 'expense', icon: 'trendingDown', label: 'Avg monthly expenses', value: formatMoney(Math.round(avgExpense)), valueClass: 'neg', sub: 'same months' })}
      ${kpiHtml({ kind: 'green', icon: 'pie', label: 'Avg savings rate', value: avgRate === null ? '—' : `${avgRate.toFixed(1)}%`, valueClass: avgRate === null ? '' : avgRate >= 0 ? 'green' : 'neg', sub: avgRate === null ? 'needs income data' : `${formatMoney(Math.round(avgIncome - avgExpense))} kept per month` })}
      <div class="privacy-wrap${privacyOn ? ' active' : ''}">
        ${kpiHtml({ kind: 'gold', icon: 'wallet', label: 'Net worth', value: latestNw ? formatMoney(latestNw.total) : '—', valueClass: 'gold', sub: latestNw ? `as of ${formatDateDMY(latestNw.date)}` : 'no check-ins yet' })}
        ${privacyOverlayHtml()}
      </div>
    </div>

    ${cardHtml({ title: 'Income vs expenses', sub: `Monthly · ${winLabel} · expenses drawn below the line`, body: '<div class="d-chart h-lg"><canvas id="aIE"></canvas></div>' })}

    <div class="d-row">
      ${cardHtml({ title: 'Net balance by month', sub: 'Income − expenses · green = surplus', body: '<div class="d-chart"><canvas id="aNet"></canvas></div>' })}
      ${cardHtml({ title: 'Savings rate', sub: '(Income − expenses) ÷ income, per month', body: '<div class="d-chart"><canvas id="aRate"></canvas></div>' })}
    </div>

    <div class="d-row">
      ${cardHtml({ title: 'Expense categories', sub: `Where money goes · ${winLabel}`, body: '<div class="d-donut-split"><div class="d-chart h-sm"><canvas id="aExpCats"></canvas></div><div id="aExpLegend"></div></div>' })}
      ${cardHtml({ title: 'Income sources', sub: `Where money comes from · ${winLabel}`, body: '<div class="d-donut-split"><div class="d-chart h-sm"><canvas id="aIncCats"></canvas></div><div id="aIncLegend"></div></div>' })}
    </div>

    <div class="d-row r-21">
      ${cardHtml({ title: 'Daily spending', sub: 'Dashed line = average for the period', actions: segHtml('aDays', [{ v: 7, label: '7D' }, { v: 30, label: '30D' }, { v: 90, label: '90D' }, { v: 365, label: '1Y' }], spendDays), body: '<div class="d-chart"><canvas id="aDaily"></canvas></div>' })}
      ${cardHtml({ title: 'Insights', icon: 'bulb', body: '<div id="aInsights"></div>' })}
    </div>

    <div class="d-table-card" id="aMonthly"></div>

    <div id="aNetWorth"></div>

    ${cardHtml({ title: 'Spending heatmap', sub: 'Each square is one day · hover for the amount', icon: 'calendar', body: '<div id="aHeat"></div>' })}

    <div class="d-row stretch">
      <div id="aForecast"></div>
      ${cardHtml({ title: 'Bills · next 60 days', sub: 'Repeat purchases on Auto or Remind', icon: 'calendar', body: '<div id="aBills"></div>' })}
    </div>

    <div id="aCalc"></div>
    <div id="aReview"></div>

    ${cardHtml({ title: 'Personal records', sub: 'All-time', icon: 'award', body: '<div class="d-squares" id="aRecords"></div>' })}
    ${cardHtml({ title: 'Achievements', icon: 'star', actions: '<span class="d-list-meta" id="aAchCount"></span>', body: '<div class="d-squares" id="aAch"></div>' })}
  `

  wireSeg(container, 'aWin', v => { win = Number(v); tablePage = 1; renderAnalysisDesktop(container, opts) })
  wireSeg(container, 'aDays', v => { spendDays = Number(v); drawDaily(container, txns); container.querySelectorAll('#aDays button').forEach(b => b.classList.toggle('active', b.dataset.v === v)) })

  drawTrendCharts(container, rows)
  drawCategoryDonuts(container, txns, rows)
  drawDaily(container, txns)
  drawInsights(container, txns)
  drawMonthlyTable(container, all)
  drawNetWorth(container, opts)
  drawHeatmap(container, txns)
  drawForecast(container, txns, networth)
  drawBills(container, recurring)
  drawCalculator(container, txns)
  drawReview(container, txns)
  drawRecords(container, txns)
  drawAchievements(container, txns, budgets, recurring)
}

// ── Trend charts ──
function drawTrendCharts(container, rows) {
  const labels = rows.map(r => shortMonth(r.key))
  renderChart('a-ie', container.querySelector('#aIE'), incomeExpenseConfig(labels, rows.map(r => r.income), rows.map(r => r.expense)))

  const t = chartTheme()
  const net = rows.map(r => r.income - r.expense)
  const netOpts = baseOptions({ legend: false })
  netOpts.plugins.tooltip.callbacks = { label: ctx => ` Net: ${formatMoney(ctx.parsed.y)}` }
  renderChart('a-net', container.querySelector('#aNet'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Net', data: net, backgroundColor: net.map(v => v >= 0 ? t.green : t.red), borderRadius: 3, borderSkipped: false, categoryPercentage: 0.86, barPercentage: 0.94, maxBarThickness: 46 }] },
    options: netOpts,
  })

  const rate = rows.map(r => r.income ? Math.round((r.income - r.expense) / r.income * 1000) / 10 : null)
  const rateOpts = baseOptions({ money: false, legend: false, yTicks: v => v + '%' })
  rateOpts.plugins.tooltip.callbacks = { label: ctx => ` Savings rate: ${ctx.parsed.y}%` }
  const emerald = cssVar('--emerald')
  renderChart('a-rate', container.querySelector('#aRate'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Savings rate', data: rate, borderColor: emerald, backgroundColor: emerald + '22', fill: true, tension: 0.15, pointRadius: 3, pointBackgroundColor: emerald, spanGaps: true }] },
    options: rateOpts,
  })
}

function drawCategoryDonuts(container, txns, rows) {
  const keys = new Set(rows.map(r => r.key))
  const exp = {}, inc = {}
  for (const t of txns) {
    if (!keys.has(effectiveDate(t).slice(0, 7))) continue
    const bucket = t.type === 'income' ? inc : exp
    bucket[t.category] = (bucket[t.category] || 0) + Number(t.amount)
  }
  for (const [map, canvasId, legendId, key] of [[exp, '#aExpCats', '#aExpLegend', 'a-exp'], [inc, '#aIncCats', '#aIncLegend', 'a-inc']]) {
    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1])
    const legendEl = container.querySelector(legendId)
    if (!sorted.length) { legendEl.innerHTML = '<div class="d-note">Nothing logged in this window.</div>'; continue }
    const top = sorted.slice(0, 7).map(([label, amount]) => ({ label, amount }))
    const rest = sorted.slice(7).reduce((s, [, v]) => s + v, 0)
    if (rest > 0) {
      const other = top.find(r => r.label === 'Other')
      if (other) other.amount += rest
      else top.push({ label: 'Other', amount: rest })
    }
    const colors = top.map((r, i) => paletteColor(i, r.label))
    renderChart(key, container.querySelector(canvasId), donutConfig(top.map(r => r.label), top.map(r => r.amount), colors))
    legendEl.innerHTML = legendHtml(top, colors)
  }
}

function drawDaily(container, txns) {
  const points = dailySpend(txns, spendDays)
  const avg = points.reduce((s, p) => s + p.amount, 0) / (points.length || 1)
  const t = chartTheme()
  const opts = baseOptions({ legend: false })
  opts.scales.x.ticks.maxTicksLimit = 8
  renderChart('a-daily', container.querySelector('#aDaily'), {
    type: spendDays <= 30 ? 'bar' : 'line',
    data: {
      labels: points.map(p => new Date(p.date + 'T00:00:00').toLocaleDateString('en-US', spendDays > 90 ? { month: 'short' } : { day: 'numeric', month: 'short' })),
      datasets: [
        spendDays <= 30
          ? { label: 'Spent', data: points.map(p => p.amount), backgroundColor: t.accent, borderRadius: 2, categoryPercentage: 0.9, barPercentage: 0.9 }
          : { label: 'Spent', data: points.map(p => p.amount), borderColor: t.accent, backgroundColor: t.accent + '22', fill: true, tension: 0.3, pointRadius: 0, borderWidth: 1.5 },
        { type: 'line', label: 'Average', data: points.map(() => avg), borderColor: t.text, borderDash: [5, 5], borderWidth: 1, pointRadius: 0, fill: false },
      ],
    },
    options: opts,
  })
}

function drawInsights(container, txns) {
  const list = generateInsights(txns)
  container.querySelector('#aInsights').innerHTML = list.length
    ? list.map(text => `<div class="d-list-row" style="align-items:flex-start"><span style="color:var(--gold);margin-top:1px">${icon('bulb', 14)}</span><span style="font-size:12.5px;color:var(--text2);line-height:1.45">${text}</span></div>`).join('')
    : '<div class="d-note">Not enough data yet — keep logging.</div>'
}

// ── Monthly summary table — Ledger's, with a year filter and pages ──
function drawMonthlyTable(container, all) {
  const el = container.querySelector('#aMonthly')
  const years = [...new Set(all.map(r => r.key.slice(0, 4)))].sort().reverse()
  if (tableYear !== 'all' && !years.includes(tableYear)) tableYear = 'all'
  const list = all.filter(r => tableYear === 'all' || r.key.startsWith(tableYear)).slice().reverse()
  const pg = paginate(list, tablePage, 12)
  tablePage = pg.page
  const sum = list.reduce((s, r) => ({ income: s.income + r.income, expense: s.expense + r.expense, count: s.count + r.count }), { income: 0, expense: 0, count: 0 })
  el.innerHTML = `
    <div class="d-toolbar">
      <div class="d-toolbar-title">Monthly summary <small>${list.length} month${list.length === 1 ? '' : 's'}</small></div>
      <select id="aYear" aria-label="Year">
        <option value="all">All years</option>
        ${years.map(y => `<option value="${y}" ${y === tableYear ? 'selected' : ''}>${y}</option>`).join('')}
      </select>
    </div>
    <div class="d-table-scroll"><table class="d-table">
      <thead><tr><th>Month</th><th class="r">Income</th><th class="r">Expenses</th><th class="r">Net</th><th class="r">Savings rate</th><th class="r">Entries</th><th>Top category</th></tr></thead>
      <tbody>${pg.items.map(r => {
        const net = r.income - r.expense
        const top = Object.entries(r.cats).sort((a, b) => b[1] - a[1])[0]
        const rate = r.income ? (net / r.income * 100).toFixed(1) + '%' : '—'
        return `<tr class="hover${r.count ? '' : ' d-cell-none'}">
          <td class="mono">${new Date(r.key + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</td>
          <td class="r mono pos">${r.income ? formatMoney(Math.round(r.income)) : '—'}</td>
          <td class="r mono">${r.expense ? formatMoney(Math.round(r.expense)) : '—'}</td>
          <td class="r mono ${r.count ? (net >= 0 ? 'pos' : 'neg') : ''}">${r.count ? formatMoney(Math.round(net)) : '—'}</td>
          <td class="r mono">${rate}</td>
          <td class="r mono dim">${r.count || '—'}</td>
          <td>${top ? `<span class="d-cat">${categoryIcon(top[0], 12)}${escapeHtml(top[0])}</span>` : '<span class="dim">no data</span>'}</td>
        </tr>`
      }).join('')}</tbody>
      <tfoot><tr><td>Total</td><td class="r pos">${formatMoney(Math.round(sum.income))}</td><td class="r">${formatMoney(Math.round(sum.expense))}</td><td class="r ${sum.income - sum.expense >= 0 ? 'pos' : 'neg'}">${formatMoney(Math.round(sum.income - sum.expense))}</td><td class="r">${sum.income ? ((sum.income - sum.expense) / sum.income * 100).toFixed(1) + '%' : '—'}</td><td class="r">${sum.count}</td><td></td></tr></tfoot>
    </table></div>
    ${paginationHtml(pg, 'months')}`
  el.querySelector('#aYear').onchange = e => { tableYear = e.target.value; tablePage = 1; drawMonthlyTable(container, all) }
  wirePagination(el, p => { tablePage = p; drawMonthlyTable(container, all) })
}

// ── Net worth: trend + every account, editable ──
const TYPE_LABEL = { cash: 'Cash', invested: 'Invested', insurance: 'Insurance' }
function drawNetWorth(container, opts) {
  const { networth, onNetWorthChanged } = opts
  const el = container.querySelector('#aNetWorth')
  const timeline = netWorthTimeline(networth)
  const privacyOn = isPrivacyMode()
  const checkinBtn = '<button class="d-btn" id="aCheckins">' + icon('pen', 12) + 'Check-ins</button>'
  if (!timeline.length) {
    el.innerHTML = cardHtml({ title: 'Net worth', icon: 'wallet', actions: checkinBtn, body: '<div class="d-empty">No check-ins yet. Log your account balances now and then to see the trend here.</div>' })
    el.querySelector('#aCheckins').onclick = () => openNetWorthCheckins({ networth, onNetWorthChanged })
    return
  }
  const order = { cash: 0, invested: 1, insurance: 2 }
  const accounts = accountReturns(networth).sort((a, b) => (order[a.category] ?? 3) - (order[b.category] ?? 3) || b.lastValue - a.lastValue)
  el.innerHTML = `
    <div class="privacy-wrap${privacyOn ? ' active' : ''}">
      <div class="d-row r-12 stretch">
        ${cardHtml({ title: 'Net worth', icon: 'wallet', sub: `${timeline.length} check-in${timeline.length === 1 ? '' : 's'}`, actions: checkinBtn, body: '<div class="d-chart h-lg"><canvas id="aNwChart"></canvas></div>' })}
        <div class="d-table-card">
          <div class="d-toolbar"><div class="d-toolbar-title">Accounts <small>rename, retype or delete — applies to every check-in</small></div></div>
          <div class="d-table-scroll"><table class="d-table">
            <thead><tr><th>Account</th><th>Type</th><th class="r">Latest</th><th class="r">Change</th><th class="r">As of</th><th></th></tr></thead>
            <tbody>${accounts.map(a => editingAccount === a.name ? `
              <tr data-acct="${escapeHtml(a.name)}">
                <td><input class="aAcctName" type="text" value="${escapeHtml(a.name)}" style="padding:5px 8px;font-size:12.5px" /></td>
                <td><select class="aAcctType" style="padding:5px 8px;font-size:12px;width:auto">${Object.entries(TYPE_LABEL).map(([k, l]) => `<option value="${k}" ${k === a.category ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
                <td class="r mono">${formatMoney(a.lastValue)}</td>
                <td colspan="2"></td>
                <td style="white-space:nowrap;text-align:right"><button class="d-btn aAcctSave" style="height:26px">Save</button> <button class="d-btn aAcctCancel" style="height:26px">Cancel</button></td>
              </tr>` : `
              <tr class="hover" data-acct="${escapeHtml(a.name)}">
                <td>${escapeHtml(a.name)}</td>
                <td><span class="d-cat">${icon(a.category === 'cash' ? 'wallet' : a.category === 'insurance' ? 'shield' : 'trendingUp', 12)}${TYPE_LABEL[a.category] || a.category}</span></td>
                <td class="r mono">${formatMoney(a.lastValue)}</td>
                <td class="r mono ${a.changeAbs >= 0 ? 'pos' : 'neg'}">${a.points.length > 1 ? `${a.changeAbs >= 0 ? '+' : '−'}${formatMoney(Math.abs(a.changeAbs))}${a.changePct != null ? ` <span class="dim">(${a.changePct >= 0 ? '+' : ''}${a.changePct.toFixed(1)}%)</span>` : ''}` : '<span class="dim">—</span>'}</td>
                <td class="r mono dim">${formatDateDMY(a.lastDate)}</td>
                <td style="width:70px"><div class="d-row-actions">
                  <button class="d-act aAcctEdit" title="Rename or change type" aria-label="Edit account">${icon('pen', 12)}</button>
                  <button class="d-act del aAcctDel" title="Delete account" aria-label="Delete account">${icon('trash', 12)}</button>
                </div></td>
              </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>
      ${privacyOverlayHtml()}
    </div>`

  const t = chartTheme()
  const hasIns = timeline.some(n => n.insurance > 0)
  const gold = cssVar('--gold')
  renderChart('a-nw', el.querySelector('#aNwChart'), {
    type: 'line',
    data: {
      labels: timeline.map(n => new Date(n.date + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' })),
      datasets: [
        { label: 'Total', data: timeline.map(n => n.total), borderColor: gold, backgroundColor: gold + '1f', fill: true, borderWidth: 2.5, tension: 0.3, pointRadius: 3, pointBackgroundColor: gold },
        { label: 'Cash', data: timeline.map(n => n.cash), borderColor: cssVar('--chart-1'), borderWidth: 1.5, borderDash: [4, 3], tension: 0.3, pointRadius: 0 },
        { label: 'Invested', data: timeline.map(n => n.invested), borderColor: t.green, borderWidth: 1.5, borderDash: [4, 3], tension: 0.3, pointRadius: 0 },
        ...(hasIns ? [{ label: 'Insurance', data: timeline.map(n => n.insurance), borderColor: cssVar('--chart-5'), borderWidth: 1.5, borderDash: [4, 3], tension: 0.3, pointRadius: 0 }] : []),
      ],
    },
    options: baseOptions(),
  })

  const rerender = () => drawNetWorth(container, opts)
  el.querySelector('#aCheckins').onclick = () => openNetWorthCheckins({ networth, onNetWorthChanged })
  el.querySelectorAll('.aAcctEdit').forEach(b => { b.onclick = () => { editingAccount = b.closest('tr').dataset.acct; rerender() } })
  el.querySelector('.aAcctCancel')?.addEventListener('click', () => { editingAccount = null; rerender() })
  el.querySelector('.aAcctSave')?.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr')
    const oldName = tr.dataset.acct
    const name = tr.querySelector('.aAcctName').value.trim()
    const category = tr.querySelector('.aAcctType').value
    if (!name) { toast('Give the account a name'); return }
    const clash = accounts.find(a => a.name.toLowerCase() === name.toLowerCase() && a.name.toLowerCase() !== oldName.toLowerCase())
    if (clash && !(await confirmDialog(`"${clash.name}" already exists — merge "${oldName}" into it?`, 'Merge'))) return
    e.target.disabled = true
    try {
      await renameNetWorthAccount(oldName, { name, category })
      editingAccount = null
      toast('Account updated')
      await onNetWorthChanged()
    } catch (err) {
      e.target.disabled = false
      toast(err.message || 'Failed to update account')
    }
  })
  el.querySelectorAll('.aAcctDel').forEach(b => {
    b.onclick = async () => {
      const name = b.closest('tr').dataset.acct
      const ok = await confirmDialog(`Delete "${name}" from every check-in? Its history disappears from your net worth.`, 'Delete', true)
      if (!ok) return
      try {
        await deleteNetWorthAccount(name)
        toast('Account deleted')
        await onNetWorthChanged()
      } catch (err) {
        toast(err.message || 'Failed to delete account')
      }
    }
  })
}

// ── Heatmap with month + weekday labels and an amount legend ──
function drawHeatmap(container, txns) {
  const days = 371
  const data = heatmapData(txns, days)
  const amounts = Object.values(data).filter(a => a > 0).sort((a, b) => a - b)
  const q = p => amounts.length ? amounts[Math.min(amounts.length - 1, Math.floor(p * amounts.length))] : 0
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75)
  const level = a => !a ? 0 : a <= t1 ? 1 : a <= t2 ? 2 : a <= t3 ? 3 : 4

  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - (days - 1))
  start.setDate(start.getDate() - start.getDay()) // back to Sunday so weeks are whole columns
  const weeks = []
  for (const c = new Date(start); c <= today; c.setDate(c.getDate() + 1)) {
    if (c.getDay() === 0) weeks.push([])
    const ds = localISO(c)
    weeks[weeks.length - 1].push({ amt: data[ds] || 0, d: new Date(c) })
  }
  // month name over the week holding that month's 1st (Jan also gets the year)
  const monthLabels = weeks.map(w => {
    const first = w.find(x => x.d.getDate() === 1)
    if (!first) return ''
    return first.d.toLocaleDateString('en-US', { month: 'short' }) + (first.d.getMonth() === 0 ? ` ’${String(first.d.getFullYear()).slice(2)}` : '')
  })
  const fmtK = v => formatMoneyAxis(Math.round(v))
  const DOW = ['', 'Mon', '', 'Wed', '', 'Fri', '']
  container.querySelector('#aHeat').innerHTML = `
    <div class="d-heat" style="--weeks:${weeks.length}">
      <div></div>${monthLabels.map(l => `<div class="d-heat-month">${l}</div>`).join('')}
      ${DOW.map((lbl, dow) => `
        <div class="d-heat-dow">${lbl}</div>
        ${weeks.map(w => { const c = w[dow]; return c ? `<div class="d-heat-cell heat-${level(c.amt)}" title="${c.d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}: ${c.amt ? formatMoney(Math.round(c.amt)) : 'no spending'}"></div>` : '<div></div>' }).join('')}
      `).join('')}
    </div>
    <div class="d-heat-legend">
      <span>${amounts.length} spending days · ${formatDateDMY(localISO(start))} – ${formatDateDMY(localISO(today))}</span>
      <span class="d-heat-scale">
        <span class="d-heat-key"><i class="d-heat-cell heat-0"></i>none</span>
        <span class="d-heat-key"><i class="d-heat-cell heat-1"></i>≤ ${fmtK(t1)}</span>
        <span class="d-heat-key"><i class="d-heat-cell heat-2"></i>≤ ${fmtK(t2)}</span>
        <span class="d-heat-key"><i class="d-heat-cell heat-3"></i>≤ ${fmtK(t3)}</span>
        <span class="d-heat-key"><i class="d-heat-cell heat-4"></i>&gt; ${fmtK(t3)}</span>
      </span>
    </div>`
}

// ── Balance forecast — numbers only (the line is always straight) ──
function drawForecast(container, txns, networth) {
  const p = computeProjection(txns, networth, 36)
  container.querySelector('#aForecast').innerHTML = cardHtml({
    title: 'Balance forecast', icon: 'activity',
    sub: `If the last 3 months' pace holds · starting from ${p.hasCheckin ? 'your latest net worth' : '฿0 (no check-in yet)'}`,
    actions: `<span class="d-pill ${p.avgNet > 0 ? 'ok' : 'over'}">${p.phase}</span>`,
    body: `
      <div class="d-res-row"><span class="l">Avg income</span><span class="v pos">${formatMoney(Math.round(p.avgIncome))}/mo</span></div>
      <div class="d-res-row"><span class="l">Avg expenses</span><span class="v">${formatMoney(Math.round(p.avgExpense))}/mo</span></div>
      <div class="d-res-row"><span class="l">Avg net</span><span class="v ${p.avgNet >= 0 ? 'green' : 'neg'}">${p.avgNet >= 0 ? '+' : '−'}${formatMoney(Math.abs(Math.round(p.avgNet)))}/mo</span></div>
      <div class="d-forecast-grid">
        ${[[6, '6 months'], [12, '1 year'], [24, '2 years'], [36, '3 years']].map(([m, l]) => `<div class="d-forecast-cell"><div class="d-kpi-label">${l}</div><div class="d-list-val gold" style="font-size:14px">${formatMoney(p.points[m]?.value)}</div><div class="d-list-meta">${p.points[m]?.label || ''}</div></div>`).join('')}
      </div>
      <div class="d-note" style="margin-top:10px">A straight line on purpose. For one-offs and new income (a renovation, rent coming in), use Projection in the sidebar.</div>`,
  })
}

function drawBills(container, recurring) {
  const bills = upcomingBills(recurring, 60)
  const el = container.querySelector('#aBills')
  if (!bills.length) { el.innerHTML = '<div class="d-note">No upcoming bills in the next 60 days.</div>'; return }
  el.innerHTML = `
    ${bills.slice(0, 9).map(b => `<div class="d-list-row"><span class="d-list-meta" style="width:58px">${formatDateDMY(b.date)}</span><span style="color:var(--accent-ink)">${categoryIcon(b.category, 13)}</span><span class="d-list-name">${escapeHtml(b.name)}</span><span class="d-list-val">${formatMoney(b.amount)}</span></div>`).join('')}
    ${bills.length > 9 ? `<div class="d-note" style="margin-top:6px">+ ${bills.length - 9} more</div>` : ''}
    <div class="d-res-row total" style="margin-top:6px"><span class="l">Total due</span><span class="v">${formatMoney(bills[bills.length - 1].runningTotal)}</span></div>`
}

// ── Investment calculator — on the page. Funds are edited / added / removed
// in place; typing only redraws the chart and totals, so nothing jumps. ──
const CALC_KEY = 'coin_calc_funds_desktop'
const CALC_YEARS_KEY = 'coin_calc_years_desktop'
function seedFunds(txns, fresh = false) {
  if (!fresh) {
    try {
      const saved = JSON.parse(localStorage.getItem(CALC_KEY))
      if (Array.isArray(saved) && saved.length) return saved
    } catch { /* fall through to seeding from history */ }
  }
  const c = investmentContributions(txns)
  return (c.length ? c : [{ subcategory: 'My fund', total: 0, avgMonthly: 0 }]).map(f => ({
    name: f.subcategory, start: Math.round(f.total), monthly: Math.round(f.avgMonthly), rate: /gold|gld/i.test(f.subcategory) ? 7 : 9,
  }))
}
function saveFunds(funds) { try { localStorage.setItem(CALC_KEY, JSON.stringify(funds)) } catch { /* not persisted this session */ } }

function drawCalculator(container, txns) {
  const el = container.querySelector('#aCalc')
  let funds = seedFunds(txns)
  let years = Number(localStorage.getItem(CALC_YEARS_KEY)) || 10

  el.innerHTML = cardHtml({
    title: 'Investment calculator', icon: 'trendingUp',
    sub: 'Projection, not a forecast — each fund grows at its own flat yearly return, compounded monthly, plus its monthly amount',
    actions: '<button class="d-link" id="cReset" title="Rebuild the list from your Investment transactions">Reset from my data</button>',
    body: `
      <div class="d-calc">
        <div>
          <div class="d-table-scroll"><table class="d-table d-calc-table">
            <thead><tr><th>Fund</th><th class="r">Starting ฿</th><th class="r">Monthly ฿</th><th class="r">Return %/yr</th><th></th></tr></thead>
            <tbody id="cRows"></tbody>
          </table></div>
          <button class="d-btn" id="cAdd" style="margin-top:10px">${icon('plus', 12)}Add fund</button>
          <div class="d-field" style="margin-top:16px">
            <label for="cYears">Time horizon — <span id="cYearsLbl" class="mono">${years}</span> years</label>
            <input type="range" id="cYears" min="1" max="40" value="${years}" style="padding:0;border:none;background:none;box-shadow:none;accent-color:var(--gold)" />
          </div>
          <div class="d-calc-stats">
            <div class="d-calc-stat"><div class="d-kpi-label">Projected value</div><div class="d-list-val gold" id="cFinal"></div></div>
            <div class="d-calc-stat"><div class="d-kpi-label">You put in</div><div class="d-list-val" id="cIn"></div></div>
            <div class="d-calc-stat"><div class="d-kpi-label">Growth</div><div class="d-list-val green" id="cGrowth"></div></div>
          </div>
        </div>
        <div>
          <div class="d-chart h-lg"><canvas id="cChart"></canvas></div>
        </div>
      </div>`,
  })

  const rowsEl = el.querySelector('#cRows')
  function drawRows() {
    rowsEl.innerHTML = funds.map((f, i) => `
      <tr data-i="${i}">
        <td><input class="cName" type="text" value="${escapeHtml(f.name)}" placeholder="Fund name" aria-label="Fund name" /></td>
        <td class="r"><input class="cStart mono" type="number" min="0" step="100" value="${f.start}" aria-label="Starting amount" /></td>
        <td class="r"><input class="cMonthly mono" type="number" min="0" step="100" value="${f.monthly}" aria-label="Monthly amount" /></td>
        <td class="r"><input class="cRate mono" type="number" min="0" max="30" step="0.5" value="${f.rate}" aria-label="Yearly return" /></td>
        <td style="width:36px"><button class="d-act del cDel" title="Remove fund" aria-label="Remove fund">${icon('trash', 12)}</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="dim">No funds — add one.</td></tr>'
    rowsEl.querySelectorAll('tr[data-i]').forEach(tr => {
      const f = funds[Number(tr.dataset.i)]
      tr.querySelector('.cName').oninput = e => { f.name = e.target.value; saveFunds(funds); recompute() }
      tr.querySelector('.cStart').oninput = e => { f.start = Number(e.target.value) || 0; saveFunds(funds); recompute() }
      tr.querySelector('.cMonthly').oninput = e => { f.monthly = Number(e.target.value) || 0; saveFunds(funds); recompute() }
      tr.querySelector('.cRate').oninput = e => { f.rate = Number(e.target.value) || 0; saveFunds(funds); recompute() }
      tr.querySelector('.cDel').onclick = () => { funds.splice(Number(tr.dataset.i), 1); saveFunds(funds); drawRows(); recompute() }
    })
  }

  function recompute() {
    const series = funds.map(f => {
      const r = f.rate / 100 / 12
      let bal = f.start
      const yearly = [bal]
      for (let m = 1; m <= years * 12; m++) { bal = bal * (1 + r) + f.monthly; if (m % 12 === 0) yearly.push(bal) }
      return yearly
    })
    const total = Array.from({ length: years + 1 }, (_, y) => series.reduce((s, sr) => s + sr[y], 0))
    const put = funds.reduce((s, f) => s + f.start + f.monthly * years * 12, 0)
    el.querySelector('#cFinal').textContent = formatMoney(Math.round(total[years]))
    el.querySelector('#cIn').textContent = formatMoney(Math.round(put))
    el.querySelector('#cGrowth').textContent = formatMoney(Math.round(total[years] - put))
    const gold = cssVar('--gold')
    renderChart('a-calc', el.querySelector('#cChart'), {
      type: 'line',
      data: {
        labels: total.map((_, y) => y === 0 ? 'Now' : `Yr ${y}`),
        datasets: [
          ...funds.map((f, i) => ({ label: f.name || `Fund ${i + 1}`, data: series[i], borderColor: paletteColor(i), borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: 0.2 })),
          { label: 'Total', data: total, borderColor: gold, backgroundColor: gold + '1c', fill: true, borderWidth: 2.5, pointRadius: 0, tension: 0.2 },
        ],
      },
      options: { ...baseOptions(), animation: false },
    })
  }

  el.querySelector('#cAdd').onclick = () => {
    funds.push({ name: '', start: 0, monthly: 1000, rate: 8 })
    saveFunds(funds)
    drawRows()
    recompute()
    rowsEl.querySelector(`tr[data-i="${funds.length - 1}"] .cName`)?.focus()
  }
  el.querySelector('#cReset').onclick = () => {
    try { localStorage.removeItem(CALC_KEY) } catch { /* nothing saved */ }
    funds = seedFunds(txns, true)
    drawRows()
    recompute()
  }
  el.querySelector('#cYears').oninput = e => {
    years = Number(e.target.value)
    el.querySelector('#cYearsLbl').textContent = years
    try { localStorage.setItem(CALC_YEARS_KEY, String(years)) } catch { /* not persisted */ }
    recompute()
  }
  drawRows()
  recompute()
}

// ── Year in review — on the page ──
function changeHtml(pct, goodWhenDown) {
  if (pct == null) return '<div class="d-list-meta">no prior year</div>'
  const good = goodWhenDown ? pct <= 0 : pct >= 0
  return `<div class="d-list-meta ${good ? 'pos' : 'neg'}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}% vs last year</div>`
}
function recordSquares(records) {
  return records.map(r => `
    <div class="d-square" title="${escapeHtml(String(r.value))} — ${escapeHtml(r.label)}">
      <span class="d-square-icon">${icon(r.icon, 18)}</span>
      <div class="d-square-val">${escapeHtml(String(r.value))}</div>
      <div class="d-square-lbl">${escapeHtml(r.label)}</div>
      <div class="d-square-meta">${r.date ? formatDateDMY(r.date) : (r.dateLabel || '')}</div>
    </div>`).join('')
}

function drawReview(container, txns) {
  const el = container.querySelector('#aReview')
  const years = [...new Set(txns.map(t => t.date.slice(0, 4)))].sort().reverse().map(Number)
  if (!years.length) { el.innerHTML = ''; return }
  if (!years.includes(reviewYear)) reviewYear = years[0]
  const r = computeYearReview(txns, reviewYear)
  el.innerHTML = cardHtml({
    title: `Year in review · ${reviewYear}`, icon: 'calendar',
    actions: years.length > 1 ? segHtml('aRevYear', years.map(y => ({ v: y, label: String(y) })), reviewYear) : '',
    body: `
      <div class="d-review">
        <div class="d-review-hero">
          <div class="d-kpi-label">${r.netSaved >= 0 ? 'Saved' : 'Overspent'} in ${reviewYear}</div>
          <div class="d-review-big ${r.netSaved >= 0 ? 'green' : 'neg'}">${formatMoney(Math.round(r.netSaved))}</div>
          <div class="d-list-meta">${r.savingsRate != null ? `${r.savingsRate.toFixed(0)}% savings rate` : ''}</div>
          <div class="d-review-stats">
            <div><div class="d-kpi-label">Income</div><div class="d-list-val pos">${formatMoney(Math.round(r.totalIncome))}</div>${changeHtml(r.incomeChangePct, false)}</div>
            <div><div class="d-kpi-label">Expenses</div><div class="d-list-val">${formatMoney(Math.round(r.totalExpense))}</div>${changeHtml(r.expenseChangePct, true)}</div>
            <div><div class="d-kpi-label">Active months</div><div class="d-list-val">${r.activeMonths} / 12</div></div>
          </div>
        </div>
        <div>
          <div class="d-label" style="margin-bottom:8px">Top categories</div>
          ${r.topCategories.length ? r.topCategories.map((c, i) => `<div class="d-list-row"><span class="d-list-meta" style="width:12px">${i + 1}</span><span style="color:var(--accent-ink)">${categoryIcon(c.category, 13)}</span><span class="d-list-name">${escapeHtml(c.category)}</span><span class="d-list-val">${formatMoney(Math.round(c.amount))}</span></div>`).join('') : '<div class="d-note">No expenses logged.</div>'}
        </div>
        <div>
          <div class="d-label" style="margin-bottom:8px">Records this year</div>
          <div class="d-squares sm">${r.personalRecords.length ? recordSquares(r.personalRecords) : '<div class="d-note">Not enough data.</div>'}</div>
        </div>
      </div>`,
  })
  wireSeg(el, 'aRevYear', v => { reviewYear = Number(v); drawReview(container, txns) })
}

function drawRecords(container, txns) {
  const recs = computePersonalRecords(txns)
  container.querySelector('#aRecords').innerHTML = recs.length ? recordSquares(recs) : '<div class="d-note">Log some transactions to start setting records.</div>'
}

function drawAchievements(container, txns, budgets, recurring) {
  const defs = getAchievementDefs(txns, budgets || [], recurring || [])
  const now = new Set(defs.filter(a => a.u).map(a => a.name))
  if (prevUnlocked.size) for (const n of now) if (!prevUnlocked.has(n)) toast(`Achievement unlocked: ${n}`)
  prevUnlocked = now
  container.querySelector('#aAchCount').textContent = `${now.size} / ${defs.length} unlocked`
  container.querySelector('#aAch').innerHTML = [...defs].sort((a, b) => (b.u ? 1 : 0) - (a.u ? 1 : 0)).map(a => `
    <div class="d-square ach ${a.u ? 'unlocked' : 'locked'}" title="${escapeHtml(a.desc)}">
      <span class="d-square-icon">${icon(a.icon, 18)}</span>
      <div class="d-square-val" style="font-family:var(--font-body);font-size:12.5px">${escapeHtml(a.name)}</div>
      <div class="d-square-lbl">${escapeHtml(a.desc)}</div>
      <div class="d-square-meta">${a.u ? 'Unlocked' : (a.prog || 'Locked')}</div>
    </div>`).join('')
}
