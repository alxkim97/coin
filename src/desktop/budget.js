// Desktop Budget & Limits — spent vs limit per category (grouped by budget
// type, Ledger's budget cards), the suggestion maths shown openly, and a
// "stayed within" history grid. Month comes from the top-bar picker.
import { EXPENSE_CATEGORIES, BUDGET_TYPE_ORDER } from '../categories.js'
import { upsertBudget, savePushSubscription } from '../supabase.js'
import { formatMoney, toast, monthLabel, suggestionBasis, urlBase64ToUint8Array, escapeHtml } from '../helpers.js'
import { icon, categoryIcon } from '../icons.js'
import { headHtml, kpiHtml, barHtml, statusClass, cardHtml, renderChart, donutConfig, legendHtml, cssVar, monthKey, shortMonth, catBadge, catColor } from './ui.js'
import { withinHistory } from '../budgetData.js' // shared with the phone Budget page

// same public VAPID key as views/budget.js — the public half is safe to ship
// and must match VAPID_PRIVATE_KEY on the server (api/check-budget-alerts.js)
const VAPID_PUBLIC_KEY = 'BIpc_gh2sKjZIJeIs6idrop8Tth8SROQMyxz-fLCzj-5lXuO8axFF4p9Bfyv_n9ahV64SkR4Shit-NPiB23SH8U'
const TYPE_COLOR = { 'Fixed Essential': '--chart-1', 'Variable Essential': '--chart-3', Investment: '--chart-4', Discretionary: '--chart-2' }

let editing = false
let draft = {} // category → typed limit while editing

export function renderBudgetDesktop(container, opts) {
  const { budgets, txns, year, month, onBudgetsChanged } = opts
  const limits = {}
  for (const b of budgets) limits[b.category] = Number(b.monthly_limit) || 0
  const mk = `${year}-${String(month + 1).padStart(2, '0')}`
  const spent = {}
  for (const t of txns) {
    if (t.type !== 'expense' || !t.date.startsWith(mk)) continue
    spent[t.category] = (spent[t.category] || 0) + Number(t.amount)
  }
  const basis = suggestionBasis(txns, 3)
  const byType = {}
  for (const c of EXPENSE_CATEGORIES) (byType[c.type] ||= []).push(c.name)

  const limitOf = cat => editing ? (Number(draft[cat]) || 0) : (limits[cat] || 0)
  const budgetedCats = EXPENSE_CATEGORIES.map(c => c.name).filter(c => limitOf(c) > 0)
  const totalLimit = budgetedCats.reduce((s, c) => s + limitOf(c), 0)
  const totalSpent = budgetedCats.reduce((s, c) => s + (spent[c] || 0), 0)
  const unbudgetedSpent = Object.entries(spent).filter(([c]) => !budgetedCats.includes(c)).reduce((s, [, v]) => s + v, 0)

  // average income over the same months the suggestions use
  const incomeByMonth = {}
  for (const t of txns) if (t.type === 'income') incomeByMonth[t.date.slice(0, 7)] = (incomeByMonth[t.date.slice(0, 7)] || 0) + Number(t.amount)
  const incMonths = basis.months.filter(k => incomeByMonth[k])
  const avgIncome = incMonths.length ? incMonths.reduce((s, k) => s + incomeByMonth[k], 0) / incMonths.length : null

  // days left only means something for the current month
  const now = new Date()
  const isCurrent = year === now.getFullYear() && month === now.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysLeft = isCurrent ? daysInMonth - now.getDate() + 1 : 0
  const left = totalLimit - totalSpent

  const history = withinHistory(txns, limits, year, month)

  container.innerHTML = `
    ${headHtml('Budget &amp; Limits', `${monthLabel(year, month)} · limits are monthly`, editing ? `
      <button class="d-btn" id="bApplyAll" title="Fill every field with its suggestion">${icon('bulb', 12)}Fill all suggestions</button>
      <button class="d-btn" id="bCancel">Cancel</button>
      <button class="d-btn-primary" id="bSave">${icon('check', 13)}Save limits</button>
    ` : `
      <button class="d-btn" id="bAlerts" title="Push notification at 90% and 100% of a limit">${icon('alert', 12)}Budget alerts</button>
      <button class="d-btn-primary" id="bEdit">${icon('pen', 12)}Edit limits</button>
    `)}

    <div class="d-kpis">
      ${kpiHtml({ kind: 'budget', icon: 'budget', label: 'Total budgeted', value: formatMoney(totalLimit), sub: avgIncome ? `${Math.round(totalLimit / avgIncome * 100)}% of avg income (${formatMoney(Math.round(avgIncome))})` : `${budgetedCats.length} categories with a limit` })}
      ${kpiHtml({ kind: 'expense', icon: 'trendingDown', label: 'Spent', value: formatMoney(Math.round(totalSpent)), valueClass: totalSpent > totalLimit && totalLimit ? 'neg' : '', sub: unbudgetedSpent ? `+ ${formatMoney(Math.round(unbudgetedSpent))} in categories without a limit` : 'on budgeted categories', extra: totalLimit ? barHtml(totalSpent / totalLimit * 100, statusClass(totalSpent, totalLimit)) : '' })}
      ${kpiHtml({ kind: left >= 0 ? 'green' : 'expense', icon: 'wallet', label: left >= 0 ? 'Left to spend' : 'Over budget', value: formatMoney(Math.abs(Math.round(left))), valueClass: left >= 0 ? 'green' : 'neg', sub: isCurrent && left > 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left · ${formatMoney(Math.round(left / daysLeft))}/day` : (isCurrent ? 'this month' : 'month closed') })}
      ${kpiHtml({ kind: 'gold', icon: 'award', label: 'Months within budget', value: history.judged ? `${history.within} / ${history.judged}` : '—', valueClass: 'gold', sub: history.judged ? `complete months with data, at today's limits` : 'needs a few months of data' })}
    </div>

    <div class="d-row">
      ${BUDGET_TYPE_ORDER.map(type => typeCardHtml(type, byType[type] || [], { limitOf, spent, basis })).join('')}
    </div>

    <div class="d-row r-21">
      ${suggestionCardHtml(basis, limits)}
      ${cardHtml({ title: 'How the budget splits', sub: 'Monthly limits by type', body: totalLimit ? '<div class="d-chart h-sm"><canvas id="bSplit"></canvas></div><div id="bSplitLegend" style="margin-top:12px"></div>' : '<div class="d-note">No limits set yet.</div>' })}
    </div>

    ${historyHtml(history, limits)}
  `

  if (totalLimit) {
    const rows = BUDGET_TYPE_ORDER.map(type => ({ label: type, amount: (byType[type] || []).reduce((s, c) => s + limitOf(c), 0) })).filter(r => r.amount > 0)
    const colors = rows.map(r => cssVar(TYPE_COLOR[r.label]))
    renderChart('b-split', container.querySelector('#bSplit'), donutConfig(rows.map(r => r.label), rows.map(r => r.amount), colors))
    container.querySelector('#bSplitLegend').innerHTML = legendHtml(rows, colors)
  }

  const rerender = () => renderBudgetDesktop(container, opts)
  if (editing) {
    container.querySelectorAll('.bLimit').forEach(inp => {
      inp.oninput = () => { draft[inp.dataset.cat] = inp.value }
      inp.onchange = rerender // refresh totals/bars once a value is committed (focus is kept while typing)
    })
    container.querySelectorAll('.bUseSug').forEach(btn => {
      btn.onclick = () => { draft[btn.dataset.cat] = String(btn.dataset.v); rerender() }
    })
    container.querySelector('#bApplyAll').onclick = () => {
      for (const [cat, v] of Object.entries(basis.perCat)) if (EXPENSE_CATEGORIES.some(c => c.name === cat)) draft[cat] = String(v.suggested)
      rerender()
      toast('Filled from suggestions — review, then Save limits')
    }
    container.querySelector('#bCancel').onclick = () => { editing = false; draft = {}; rerender() }
    container.querySelector('#bSave').onclick = async (e) => {
      const btn = e.currentTarget
      btn.disabled = true
      try {
        for (const c of EXPENSE_CATEGORIES) {
          const v = Number(draft[c.name]) || 0
          if (v !== (limits[c.name] || 0)) await upsertBudget(c.name, v, c.type)
        }
        editing = false
        draft = {}
        toast('Limits saved')
        await onBudgetsChanged()
      } catch (err) {
        btn.disabled = false
        toast(err.message || 'Failed to save limits')
      }
    }
  } else {
    container.querySelector('#bEdit').onclick = () => {
      editing = true
      draft = Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c.name, limits[c.name] ? String(limits[c.name]) : '']))
      rerender()
    }
    container.querySelector('#bAlerts').onclick = enableAlerts
  }
}

function typeCardHtml(type, cats, { limitOf, spent, basis }) {
  const typeLimit = cats.reduce((s, c) => s + limitOf(c), 0)
  const typeSpent = cats.reduce((s, c) => s + (spent[c] || 0), 0)
  // the % only counts categories that have a limit — unbudgeted spend in the
  // same group (e.g. Insurance with no limit) can't push it "over"
  const limitedSpent = cats.filter(c => limitOf(c) > 0).reduce((s, c) => s + (spent[c] || 0), 0)
  const cls = statusClass(limitedSpent, typeLimit)
  const pill = typeLimit ? `<span class="d-pill ${cls || 'ok'}">${Math.round(limitedSpent / typeLimit * 100)}%</span>` : '<span class="d-pill info">no limits</span>'
  const rows = cats.map(cat => {
    const lim = limitOf(cat)
    const sp = spent[cat] || 0
    const sug = basis.perCat[cat]?.suggested
    if (editing) {
      return `
        <div class="d-budget-row editing">
          <span class="d-budget-name" style="--cat:${catColor(cat)}">${categoryIcon(cat, 13)}${escapeHtml(cat)}</span>
          <span class="d-list-meta">spent ${formatMoney(Math.round(sp))}</span>
          ${sug !== undefined && sug !== lim ? `<button class="d-link bUseSug" data-cat="${escapeHtml(cat)}" data-v="${sug}" title="Use the suggestion">use ${formatMoney(sug)}</button>` : '<span></span>'}
          <input class="bLimit mono" type="number" min="0" step="100" inputmode="decimal" placeholder="0" data-cat="${escapeHtml(cat)}" value="${escapeHtml(String(draft[cat] ?? ''))}" aria-label="${escapeHtml(cat)} limit" />
        </div>`
    }
    if (!lim && !sp) return `<div class="d-budget-row none"><span class="d-budget-name" style="--cat:${catColor(cat)}">${categoryIcon(cat, 13)}${escapeHtml(cat)}</span><span class="d-list-meta">no limit · nothing spent</span></div>`
    return `
      <div class="d-budget-row">
        <div class="d-meter-top"><span class="n d-budget-name" style="--cat:${catColor(cat)}">${categoryIcon(cat, 13)}${escapeHtml(cat)}</span><span class="v">${formatMoney(Math.round(sp))} <small>/ ${lim ? formatMoney(lim) : 'no limit'}</small></span></div>
        ${barHtml(lim ? sp / lim * 100 : 0, statusClass(sp, lim))}
        ${lim ? `<div class="d-bar-labels"><span>${sp > lim ? `${formatMoney(Math.round(sp - lim))} over` : `${formatMoney(Math.round(lim - sp))} left`}</span><span>${Math.round(sp / lim * 100)}%</span></div>` : ''}
      </div>`
  }).join('')
  return cardHtml({
    title: type, sub: typeLimit ? `${formatMoney(Math.round(limitedSpent))} of ${formatMoney(typeLimit)}${typeSpent > limitedSpent ? ` · +${formatMoney(Math.round(typeSpent - limitedSpent))} without a limit` : ''}` : `${formatMoney(Math.round(typeSpent))} spent`,
    actions: pill, body: rows, cls: 'd-budget-card',
  })
}

function suggestionCardHtml(basis, limits) {
  const cats = Object.entries(basis.perCat).filter(([c]) => EXPENSE_CATEGORIES.some(x => x.name === c)).sort((a, b) => b[1].avg - a[1].avg)
  const monthsTxt = basis.months.map(shortMonth).join(', ')
  return `
    <div class="d-table-card">
      <div class="d-toolbar"><div class="d-toolbar-title">${icon('bulb', 14)}How suggestions are worked out</div></div>
      <div class="d-note" style="padding:12px 16px 4px">
        ${basis.months.length
          ? `Average spend per category over the last <b>${basis.months.length} complete month${basis.months.length === 1 ? '' : 's'} that have spending logged</b> (${monthsTxt}), rounded to the nearest ฿100. Months with nothing logged are skipped instead of counted as ฿0, so a month you didn't log can't drag a suggestion down. The current month only counts once it's over.`
          : 'Suggestions appear once at least one complete month has spending logged.'}
      </div>
      ${cats.length ? `<div class="d-table-scroll"><table class="d-table">
        <thead><tr><th>Category</th>${basis.months.map(k => `<th class="r">${shortMonth(k)}</th>`).join('')}<th class="r">Average</th><th class="r">Suggested</th><th class="r">Your limit</th></tr></thead>
        <tbody>${cats.map(([cat, v]) => `<tr class="hover">
          <td>${catBadge(cat)}</td>
          ${basis.months.map(k => `<td class="r mono dim">${formatMoney(Math.round(v.byMonth[k]))}</td>`).join('')}
          <td class="r mono">${formatMoney(Math.round(v.avg))}</td>
          <td class="r mono gold">${formatMoney(v.suggested)}</td>
          <td class="r mono ${limits[cat] ? '' : 'dim'}">${limits[cat] ? formatMoney(limits[cat]) : '—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : ''}
    </div>`
}

function historyHtml(h, limits) {
  if (!h.cats.length || !h.months.length) return ''
  const curKey = monthKey(new Date())
  const cell = (s, lim) => {
    const cls = !s ? 'd-cell-none' : s > lim ? 'd-cell-over' : s / lim >= 0.8 ? 'd-cell-warn' : 'd-cell-ok'
    return `<td class="r mono ${cls}">${s ? formatMoney(Math.round(s)) : '—'}</td>`
  }
  return `
    <div class="d-table-card">
      <div class="d-toolbar">
        <div class="d-toolbar-title">${icon('award', 14)}Stayed within? <small>${h.within} of ${h.judged} complete month${h.judged === 1 ? '' : 's'} under the total limit</small></div>
        <span class="d-heat-scale d-list-meta"><span class="d-heat-key"><i class="d-heat-cell" style="background:var(--green-dim)"></i>under 80%</span><span class="d-heat-key"><i class="d-heat-cell" style="background:var(--amber-dim)"></i>80–100%</span><span class="d-heat-key"><i class="d-heat-cell" style="background:var(--red-dim)"></i>over</span></span>
      </div>
      <div class="d-table-scroll"><table class="d-table">
        <thead><tr><th>Category</th><th class="r">Limit</th>${h.months.map(k => `<th class="r">${shortMonth(k)}${k === curKey ? ' <span class="d-pill info">so far</span>' : ''}</th>`).join('')}</tr></thead>
        <tbody>${h.cats.map(c => `<tr class="hover"><td>${catBadge(c)}</td><td class="r mono dim">${formatMoney(limits[c])}</td>${h.months.map(k => cell(h.spend[k]?.[c] || 0, limits[c])).join('')}</tr>`).join('')}</tbody>
        <tfoot><tr><td>All budgeted</td><td class="r">${formatMoney(h.limTotal)}</td>${h.totals.map(t => `<td class="r ${t.s > h.limTotal ? 'neg' : 'pos'}">${formatMoney(Math.round(t.s))}</td>`).join('')}</tr></tfoot>
      </table></div>
      <div class="d-note" style="padding:8px 16px 12px">Past months are compared with today's limits — Coin doesn't keep a record of what each limit used to be.</div>
    </div>`
}

async function enableAlerts() {
  // The installed desktop app loads from file://, where service workers (and
  // so push) can't run — navigator.serviceWorker.ready would wait forever.
  if (window.electronAPI?.isElectron) { toast('Budget alerts work in the browser or phone version of Coin — turn them on there'); return }
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) { toast("This browser doesn't support push notifications"); return }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') { toast('Notification permission denied'); return }
  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) })
    await savePushSubscription(sub)
    toast('Budget alerts on — you’ll be notified at 90% and 100% of a limit')
  } catch (e) {
    toast(e.message || 'Failed to enable alerts')
  }
}
