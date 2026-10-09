// Desktop Projection (new) — Ledger's 36-month projection made generic:
// your recent run-rate carried forward, plus events you add yourself
// (one-off or repeating income/expenses), from your latest net worth.
import { formatMoney, escapeHtml, toast, confirmDialog, effectiveDate } from '../helpers.js'
import { netWorthTimeline } from '../analysisData.js'
import { addProjectionEvent, updateProjectionEvent, deleteProjectionEvent } from '../supabase.js'
import { icon } from '../icons.js'
import { headHtml, kpiHtml, cardHtml, segHtml, wireSeg, renderChart, baseOptions, chartTheme, cssVar, paginate, paginationHtml, wirePagination, monthKey, shortMonth } from './ui.js'

let horizon = 36
let basisMonths = 6
let tablePage = 1
let editingId = null // event id being edited, 'new' for the add form

const signed = n => (n < 0 ? '−' : '') + formatMoney(Math.abs(Math.round(n)))
const FREQ_LABEL = { once: 'Once', monthly: 'Monthly', yearly: 'Yearly' }

// Run-rate from the last N complete months that have data. Investment
// transfers are kept out of "spending": that money stays in your net worth.
function runRate(txns, n) {
  const byMonth = {}
  for (const t of txns) {
    const k = effectiveDate(t).slice(0, 7)
    const m = (byMonth[k] ||= { income: 0, spend: 0, invest: 0 })
    if (t.type === 'income') m.income += Number(t.amount)
    else if (t.category === 'Investment') m.invest += Number(t.amount)
    else m.spend += Number(t.amount)
  }
  const now = new Date()
  const used = []
  for (let i = 1; i <= 24 && used.length < n; i++) {
    const k = monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1))
    if (byMonth[k]) used.push(k)
  }
  const avg = f => used.length ? used.reduce((s, k) => s + byMonth[k][f], 0) / used.length : 0
  return { used, income: avg('income'), spend: avg('spend'), invest: avg('invest') }
}

function eventAmountFor(ev, key) {
  const start = ev.start_month.slice(0, 7)
  const end = ev.end_month ? ev.end_month.slice(0, 7) : null
  if (key < start || (end && key > end)) return 0
  const sign = ev.kind === 'income' ? 1 : -1
  if (ev.frequency === 'once') return key === start ? sign * Number(ev.amount) : 0
  if (ev.frequency === 'monthly') return sign * Number(ev.amount)
  const [sy, sm] = start.split('-').map(Number)
  const [ky, km] = key.split('-').map(Number)
  return (ky * 12 + km - (sy * 12 + sm)) % 12 === 0 ? sign * Number(ev.amount) : 0
}

function project(start, rate, events, months) {
  const now = new Date()
  const rows = []
  let base = start, withEv = start
  for (let i = 0; i < months; i++) {
    const key = monthKey(new Date(now.getFullYear(), now.getMonth() + i, 1))
    const net = rate.income - rate.spend
    const ev = events.reduce((s, e) => s + eventAmountFor(e, key), 0)
    base += net
    withEv += net + ev
    rows.push({ key, income: rate.income, spend: rate.spend, ev, net: net + ev, base, nw: withEv, names: events.filter(e => eventAmountFor(e, key)).map(e => e.name) })
  }
  return rows
}

export function renderProjectionDesktop(container, opts) {
  const { txns, networth, events, eventsReady, onEventsChanged } = opts
  const timeline = netWorthTimeline(networth)
  const latest = timeline[timeline.length - 1]
  const start = latest ? latest.total : 0
  const rate = runRate(txns, basisMonths)
  const rows = project(start, rate, events, horizon)
  const at = m => rows[Math.min(m, rows.length) - 1]
  const lowest = rows.reduce((lo, r) => (r.nw < lo.nw ? r : lo), rows[0])
  const endRow = rows[rows.length - 1]
  const monthName = k => new Date(k + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

  container.innerHTML = `
    ${headHtml('Projection', `${monthName(rows[0].key)} → ${monthName(endRow.key)} · run-rate from ${rate.used.length} month${rate.used.length === 1 ? '' : 's'} with data + your events`,
      `<span class="d-list-meta">Based on</span>${segHtml('pBasis', [{ v: 3, label: '3 mo' }, { v: 6, label: '6 mo' }, { v: 12, label: '12 mo' }], basisMonths)}
       <span class="d-list-meta" style="margin-left:6px">Horizon</span>${segHtml('pHorizon', [{ v: 12, label: '1Y' }, { v: 24, label: '2Y' }, { v: 36, label: '3Y' }, { v: 60, label: '5Y' }], horizon)}`)}

    <div class="d-kpis">
      ${kpiHtml({ kind: 'gold', icon: 'wallet', label: 'Starting net worth', value: formatMoney(Math.round(start)), valueClass: 'gold', sub: latest ? `latest check-in` : 'no check-in yet — starts from ฿0' })}
      ${kpiHtml({ kind: 'green', icon: 'trendingUp', label: 'In 12 months', value: signed(at(12).nw), valueClass: at(12).nw >= start ? 'green' : 'neg', sub: `${at(12).nw - start >= 0 ? '+' : '−'}${formatMoney(Math.abs(Math.round(at(12).nw - start)))} · ${monthName(at(12).key)}` })}
      ${kpiHtml({ kind: 'net', icon: 'flag', label: `End of horizon`, value: signed(endRow.nw), valueClass: endRow.nw >= start ? 'pos' : 'neg', sub: `${monthName(endRow.key)} · run-rate alone: ${formatMoney(Math.round(endRow.base))}` })}
      ${kpiHtml({ kind: lowest.nw < 0 ? 'expense' : 'info', icon: 'alert', label: 'Lowest point', value: signed(lowest.nw), valueClass: lowest.nw < 0 ? 'neg' : '', sub: monthName(lowest.key) + (lowest.names.length ? ` · ${escapeHtml(lowest.names.join(', '))}` : '') })}
    </div>

    <div class="d-row r-21 stretch">
      ${cardHtml({ title: 'Net worth trajectory', sub: 'Gold = with your events · dashed = run-rate alone', body: '<div class="d-chart h-lg"><canvas id="pChart"></canvas></div>' })}
      ${cardHtml({
        title: 'Run-rate', sub: rate.used.length ? `Average of ${rate.used.map(shortMonth).join(', ')}` : 'No complete months yet',
        body: `
          <div class="d-res-row"><span class="l">Income</span><span class="v pos">${formatMoney(Math.round(rate.income))}/mo</span></div>
          <div class="d-res-row"><span class="l">Spending</span><span class="v neg">${formatMoney(Math.round(rate.spend))}/mo</span></div>
          <div class="d-res-row"><span class="l">Investing <span class="d-list-meta">(stays in net worth)</span></span><span class="v">${formatMoney(Math.round(rate.invest))}/mo</span></div>
          <div class="d-res-row total"><span class="l">Net worth grows</span><span class="v ${rate.income - rate.spend >= 0 ? 'green' : 'neg'}">${rate.income - rate.spend >= 0 ? '+' : '−'}${formatMoney(Math.abs(Math.round(rate.income - rate.spend)))}/mo</span></div>
          <div class="d-note" style="margin-top:10px">Months with nothing logged are skipped. Investment transfers count as saving, not spending, since that money is still yours.</div>`,
      })}
    </div>

    <div class="d-table-card" id="pEvents"></div>
    <div class="d-table-card" id="pTable"></div>
  `

  wireSeg(container, 'pBasis', v => { basisMonths = Number(v); renderProjectionDesktop(container, opts) })
  wireSeg(container, 'pHorizon', v => { horizon = Number(v); tablePage = 1; renderProjectionDesktop(container, opts) })

  const t = chartTheme()
  const gold = cssVar('--gold')
  const chartOpts = baseOptions()
  chartOpts.plugins.tooltip.callbacks = {
    label: ctx => ` ${ctx.dataset.label}: ${formatMoney(Math.round(ctx.parsed.y))}`,
    afterBody: items => { const r = rows[items[0].dataIndex]; return r.names.length ? `Events: ${r.names.join(', ')}` : '' },
  }
  renderChart('p-nw', container.querySelector('#pChart'), {
    type: 'line',
    data: {
      labels: rows.map(r => shortMonth(r.key)),
      datasets: [
        { label: 'With events', data: rows.map(r => Math.round(r.nw)), borderColor: gold, backgroundColor: gold + '1f', fill: true, borderWidth: 2.5, tension: 0.15, pointRadius: rows.map((r, i) => r.ev !== (i ? rows[i - 1].ev : 0) && r.ev ? 5 : 0), pointBackgroundColor: rows.map(r => r.ev > 0 ? t.green : t.red), pointBorderColor: gold },
        { label: 'Run-rate alone', data: rows.map(r => Math.round(r.base)), borderColor: t.text, borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, fill: false },
      ],
    },
    options: chartOpts,
  })

  drawEvents(container, opts)
  drawTable(container, rows)
}

function eventFormRow(ev) {
  const e = ev || { name: '', kind: 'expense', amount: '', frequency: 'once', start_month: monthKey(new Date()) + '-01', end_month: null, notes: '' }
  return `
    <tr class="d-ev-form" data-id="${ev ? ev.id : 'new'}">
      <td><input class="pName" type="text" placeholder="e.g. Condo renovation" value="${escapeHtml(e.name)}" /></td>
      <td><select class="pKind"><option value="expense" ${e.kind === 'expense' ? 'selected' : ''}>Expense</option><option value="income" ${e.kind === 'income' ? 'selected' : ''}>Income</option></select></td>
      <td class="r"><input class="pAmount mono" type="number" min="0" step="100" placeholder="0" value="${escapeHtml(String(e.amount))}" /></td>
      <td><select class="pFreq">${Object.entries(FREQ_LABEL).map(([k, l]) => `<option value="${k}" ${e.frequency === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><input class="pStart mono" type="month" value="${e.start_month.slice(0, 7)}" /></td>
      <td><input class="pEnd mono" type="month" value="${e.end_month ? e.end_month.slice(0, 7) : ''}" ${e.frequency === 'once' ? 'disabled' : ''} /></td>
      <td><input class="pNotes" type="text" placeholder="optional" value="${escapeHtml(e.notes || '')}" /></td>
      <td style="white-space:nowrap;text-align:right"><button class="d-btn-primary pSave" style="height:28px;font-size:12px">Save</button> <button class="d-btn pCancel" style="height:28px">Cancel</button></td>
    </tr>`
}

function drawEvents(container, opts) {
  const { events, eventsReady, onEventsChanged } = opts
  const el = container.querySelector('#pEvents')
  if (!eventsReady) {
    el.innerHTML = `
      <div class="d-toolbar"><div class="d-toolbar-title">${icon('calendar', 14)}Events</div></div>
      <div class="d-note" style="padding:14px 16px">Events need a one-time database setup: run the <b>coin_projection_events</b> SQL from SUPABASE-SETUP.md in Supabase, then reload. Until then the projection uses your run-rate alone.</div>`
    return
  }
  const sorted = [...events].sort((a, b) => a.start_month.localeCompare(b.start_month))
  el.innerHTML = `
    <div class="d-toolbar">
      <div class="d-toolbar-title">${icon('calendar', 14)}Events <small>one-offs and changes you expect · they move the gold line</small></div>
      <button class="d-btn-primary" id="pAdd" ${editingId ? 'disabled' : ''}>${icon('plus', 12)}Add event</button>
    </div>
    <div class="d-table-scroll"><table class="d-table d-ev-table">
      <thead><tr><th>Event</th><th>Type</th><th class="r">Amount</th><th>Repeats</th><th>From</th><th>Until</th><th>Notes</th><th></th></tr></thead>
      <tbody>
        ${editingId === 'new' ? eventFormRow(null) : ''}
        ${sorted.map(ev => editingId === ev.id ? eventFormRow(ev) : `
          <tr class="hover" data-id="${ev.id}">
            <td>${escapeHtml(ev.name)}</td>
            <td><span class="d-pill ${ev.kind === 'income' ? 'ok' : 'over'}">${ev.kind === 'income' ? 'Income' : 'Expense'}</span></td>
            <td class="r"><span class="d-amt ${ev.kind}">${ev.kind === 'income' ? '+' : '−'}${formatMoney(ev.amount)}</span></td>
            <td class="dim">${FREQ_LABEL[ev.frequency] || ev.frequency}</td>
            <td class="mono dim">${shortMonth(ev.start_month.slice(0, 7))}</td>
            <td class="mono dim">${ev.frequency === 'once' ? '—' : ev.end_month ? shortMonth(ev.end_month.slice(0, 7)) : 'ongoing'}</td>
            <td class="trunc dim">${escapeHtml(ev.notes || '')}</td>
            <td style="width:70px"><div class="d-row-actions">
              <button class="d-act pEdit" title="Edit" aria-label="Edit event">${icon('pen', 12)}</button>
              <button class="d-act del pDel" title="Delete" aria-label="Delete event">${icon('trash', 12)}</button>
            </div></td>
          </tr>`).join('')}
        ${!sorted.length && editingId !== 'new' ? '<tr><td colspan="8" class="dim" style="padding:16px 13px">No events yet. Add the big things you can see coming — a renovation, a bonus, rent income starting.</td></tr>' : ''}
      </tbody>
    </table></div>`

  const redraw = () => drawEvents(container, opts)
  el.querySelector('#pAdd').onclick = () => { editingId = 'new'; redraw(); el.querySelector('.pName')?.focus() }
  el.querySelectorAll('.pEdit').forEach(b => { b.onclick = () => { editingId = b.closest('tr').dataset.id; redraw() } })
  el.querySelectorAll('.pDel').forEach(b => {
    b.onclick = async () => {
      const ev = events.find(x => x.id === b.closest('tr').dataset.id)
      if (!ev || !(await confirmDialog(`Delete "${ev.name}"?`, 'Delete', true))) return
      try { await deleteProjectionEvent(ev.id); toast('Event deleted'); await onEventsChanged() } catch (err) { toast(err.message || 'Failed to delete') }
    }
  })
  const form = el.querySelector('.d-ev-form')
  if (!form) return
  form.querySelector('.pFreq').onchange = e => { form.querySelector('.pEnd').disabled = e.target.value === 'once' }
  form.querySelector('.pCancel').onclick = () => { editingId = null; redraw() }
  form.querySelector('.pSave').onclick = async (e) => {
    const name = form.querySelector('.pName').value.trim()
    const amount = Number(form.querySelector('.pAmount').value)
    const startM = form.querySelector('.pStart').value
    const freq = form.querySelector('.pFreq').value
    const endM = freq === 'once' ? '' : form.querySelector('.pEnd').value
    if (!name) { toast('Give the event a name'); return }
    if (!(amount > 0)) { toast('Enter an amount'); return }
    if (!startM) { toast('Pick a start month'); return }
    if (endM && endM < startM) { toast('"Until" is before "From"'); return }
    const row = { name, kind: form.querySelector('.pKind').value, amount, frequency: freq, start_month: startM + '-01', end_month: endM ? endM + '-01' : null, notes: form.querySelector('.pNotes').value.trim() || null }
    e.currentTarget.disabled = true
    try {
      if (form.dataset.id === 'new') await addProjectionEvent(row)
      else await updateProjectionEvent(form.dataset.id, row)
      editingId = null
      toast('Event saved')
      await onEventsChanged()
    } catch (err) {
      e.currentTarget.disabled = false
      toast(err.message || 'Failed to save event')
    }
  }
}

function drawTable(container, rows) {
  const el = container.querySelector('#pTable')
  const pg = paginate(rows, tablePage, 12)
  tablePage = pg.page
  el.innerHTML = `
    <div class="d-toolbar"><div class="d-toolbar-title">Month by month <small>${rows.length} months</small></div></div>
    <div class="d-table-scroll"><table class="d-table">
      <thead><tr><th>Month</th><th class="r">Income</th><th class="r">Spending</th><th class="r">Events</th><th class="r">Net</th><th class="r">Net worth</th><th>What happens</th></tr></thead>
      <tbody>${pg.items.map(r => `<tr class="hover">
        <td class="mono">${new Date(r.key + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
        <td class="r mono pos">${formatMoney(Math.round(r.income))}</td>
        <td class="r mono neg">${formatMoney(Math.round(r.spend))}</td>
        <td class="r mono ${r.ev > 0 ? 'pos' : r.ev < 0 ? 'neg' : 'dim'}">${r.ev ? (r.ev > 0 ? '+' : '−') + formatMoney(Math.abs(r.ev)) : '—'}</td>
        <td class="r mono ${r.net >= 0 ? 'pos' : 'neg'}">${signed(r.net)}</td>
        <td class="r mono gold">${signed(r.nw)}</td>
        <td class="dim trunc">${escapeHtml(r.names.join(', '))}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    ${paginationHtml(pg, 'months')}`
  wirePagination(el, p => { tablePage = p; drawTable(container, rows) })
}
