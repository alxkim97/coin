// Desktop History — Ledger's transaction table (no Type column; amount sign
// and colour carry it) with Coin's date-group gaps, Ledger's filter bar and
// pagination, plus a desktop-sized calendar. Search lives in the top bar.
import { formatMoney, rangeWindow, rangeLabel, dateHeaderLabel, formatDateDMY, localISO, escapeHtml, toast, toastWithAction, sortByDateDesc } from '../helpers.js'
import { deleteTransaction, addTransaction } from '../supabase.js'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../categories.js'
import { icon, categoryIcon } from '../icons.js'
import { headHtml, paginate, paginationHtml, wirePagination, segHtml, wireSeg } from './ui.js'

const PER_PAGE = 50
// module-level like the phone view's filter state: survives re-renders and
// navigation within the session
let filters = { q: '', type: '', category: '', min: '', max: '', sort: 'date-desc' }
let page = 1
let viewMode = 'list'
let calSelected = null
let current = null // { container, opts } of the mounted view, for top-bar search

export function setHistorySearch(q) { filters.q = q; page = 1 }
export function getHistorySearch() { return filters.q }
export function applyHistorySearch() { if (current?.container.isConnected) drawList(current.container, current.opts) }

// ── Shared table (Dashboard's "Recent transactions" uses it too) ──
function rowHtml(t, { showDate }) {
  const flags = [
    t.is_credit_card ? `<span class="d-flag" title="Paid by credit card">${icon('creditCard', 12)}</span>` : '',
    t.is_shopee ? `<span class="d-flag" title="Bought on Shopee">${icon('bag', 12)}</span>` : '',
    t.receipt_path ? `<span class="d-flag" title="Has a receipt photo">${icon('paperclip', 12)}</span>` : '',
  ].join('')
  return `
    <tr class="click" data-id="${t.id}">
      ${showDate ? `<td class="mono dim" style="white-space:nowrap">${formatDateDMY(t.date)}</td>` : ''}
      <td><span class="d-cat">${categoryIcon(t.category, 12)}${escapeHtml(t.category)}</span></td>
      <td class="trunc">${t.subcategory ? escapeHtml(t.subcategory) : '<span style="color:var(--text3)">—</span>'}${flags}</td>
      <td class="trunc dim">${escapeHtml(t.notes || '')}</td>
      <td class="dim">${(t.tags || []).map(tag => `<span class="d-tag">${escapeHtml(tag)}</span>`).join('')}</td>
      <td class="r"><span class="d-amt ${t.type}">${t.type === 'income' ? '+' : '−'}${formatMoney(t.amount)}</span></td>
      <td style="width:70px"><div class="d-row-actions">
        <button class="d-act" data-act="edit" data-id="${t.id}" title="Edit" aria-label="Edit">${icon('pen', 12)}</button>
        <button class="d-act del" data-act="delete" data-id="${t.id}" title="Delete" aria-label="Delete">${icon('trash', 12)}</button>
      </div></td>
    </tr>`
}

export function txnTableHtml(list, { groups = true, empty = 'No transactions found.' } = {}) {
  if (!list.length) return `<div class="d-empty">${empty}</div>`
  const head = `<thead><tr>${groups ? '' : '<th>Date</th>'}<th>Category</th><th>Vendor / note</th><th>Notes</th><th>Tags</th><th class="r">Amount</th><th></th></tr></thead>`
  let body = ''
  if (groups) {
    const byDate = new Map()
    for (const t of list) { if (!byDate.has(t.date)) byDate.set(t.date, []); byDate.get(t.date).push(t) }
    for (const [date, items] of byDate) {
      const spent = items.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
      const earned = items.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
      const total = [spent ? `−${formatMoney(spent)}` : '', earned ? `+${formatMoney(earned)}` : ''].filter(Boolean).join(' · ')
      body += `<tr class="d-group"><td colspan="6">${dateHeaderLabel(date)}<span class="d-group-total">${total}</span></td></tr>`
      body += items.map(t => rowHtml(t, { showDate: false })).join('')
    }
  } else {
    body = list.map(t => rowHtml(t, { showDate: true })).join('')
  }
  return `<div class="d-table-scroll"><table class="d-table">${head}<tbody>${body}</tbody></table></div>`
}

export function wireTxnTable(root, list, { onEdit, onDelete }) {
  root.querySelectorAll('tr.click').forEach(tr => {
    tr.onclick = (e) => {
      if (e.target.closest('.d-act')) return
      const t = list.find(x => x.id === tr.dataset.id)
      if (t) onEdit(t)
    }
  })
  root.querySelectorAll('.d-act').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation()
      const t = list.find(x => x.id === btn.dataset.id)
      if (!t) return
      if (btn.dataset.act === 'edit') onEdit(t)
      else if (onDelete) onDelete(t)
      else onEdit(t) // Recent-transactions card: delete lives in the edit form
    }
  })
}

// Same optimistic delete + Undo as the phone list: mutates the shared txns
// array in place, redraws, restores on failure; Undo re-adds (new id).
async function deleteTxn(txn, txns, redraw) {
  const idx = txns.findIndex(t => t.id === txn.id)
  if (idx === -1) return
  txns.splice(idx, 1)
  redraw()
  try {
    await deleteTransaction(txn.id)
  } catch (e) {
    txns.splice(idx, 0, txn)
    redraw()
    toast(e.message || 'Failed to delete')
    return
  }
  toastWithAction('Transaction deleted', 'Undo', async () => {
    try {
      const { id: _oldId, created_at, ...rest } = txn
      txns.push(await addTransaction(rest))
      redraw()
    } catch (e) {
      toast(e.message || 'Failed to restore')
    }
  })
}

export function renderHistoryDesktop(container, opts) {
  const { txns, year, month, range } = opts
  current = { container, opts }
  const { from, to } = rangeWindow(year, month, range)
  const periodTxns = txns.filter(t => t.date >= from && t.date <= to)
  const cats = [...new Set([...EXPENSE_CATEGORIES.map(c => c.name), ...INCOME_CATEGORIES, ...periodTxns.map(t => t.category)])].sort()
  if (filters.category && !cats.includes(filters.category)) filters.category = ''

  container.innerHTML = `
    ${headHtml('History', `<span id="hCount"></span> · ${rangeLabel(year, month, range)}`, segHtml('hMode', [{ v: 'list', label: 'List' }, { v: 'calendar', label: 'Calendar' }], viewMode))}
    ${viewMode === 'list' ? `
      <div class="d-table-card">
        <div class="d-toolbar">
          <div class="d-toolbar-title">All transactions <small id="hTotals"></small></div>
          <select id="hType" aria-label="Type">
            <option value="">All types</option>
            <option value="expense" ${filters.type === 'expense' ? 'selected' : ''}>Expenses</option>
            <option value="income" ${filters.type === 'income' ? 'selected' : ''}>Income</option>
          </select>
          <select id="hCat" aria-label="Category">
            <option value="">All categories</option>
            ${cats.map(c => `<option value="${escapeHtml(c)}" ${c === filters.category ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
          <input id="hMin" type="number" inputmode="decimal" placeholder="Min ฿" value="${escapeHtml(filters.min)}" aria-label="Minimum amount" />
          <input id="hMax" type="number" inputmode="decimal" placeholder="Max ฿" value="${escapeHtml(filters.max)}" aria-label="Maximum amount" />
          <select id="hSort" aria-label="Sort">
            <option value="date-desc" ${filters.sort === 'date-desc' ? 'selected' : ''}>Date ↓</option>
            <option value="date-asc" ${filters.sort === 'date-asc' ? 'selected' : ''}>Date ↑</option>
            <option value="amount-desc" ${filters.sort === 'amount-desc' ? 'selected' : ''}>Amount ↓</option>
            <option value="amount-asc" ${filters.sort === 'amount-asc' ? 'selected' : ''}>Amount ↑</option>
          </select>
          <button class="d-link" id="hClear" style="display:none">Clear filters</button>
        </div>
        <div id="hTable"></div>
        <div id="hPages"></div>
      </div>
    ` : `
      <div class="d-row r-21">
        <div class="d-card" id="hCal"></div>
        <div id="hDay"></div>
      </div>
    `}
  `
  wireSeg(container, 'hMode', v => { viewMode = v; renderHistoryDesktop(container, opts) })

  if (viewMode === 'calendar') {
    container.querySelector('#hCount').textContent = `${periodTxns.length} transaction${periodTxns.length === 1 ? '' : 's'}`
    drawCalendar(container, opts)
    return
  }

  const bind = (id, key, ev = 'oninput') => {
    container.querySelector(id)[ev] = e => { filters[key] = e.target.value; page = 1; drawList(container, opts) }
  }
  bind('#hType', 'type', 'onchange')
  bind('#hCat', 'category', 'onchange')
  bind('#hMin', 'min')
  bind('#hMax', 'max')
  bind('#hSort', 'sort', 'onchange')
  container.querySelector('#hClear').onclick = () => {
    filters = { ...filters, type: '', category: '', min: '', max: '', q: '' }
    const search = document.querySelector('#deskSearch')
    if (search) search.value = ''
    page = 1
    renderHistoryDesktop(container, opts)
  }
  drawList(container, opts)
}

function filtered(opts) {
  const { txns, year, month, range } = opts
  const { from, to } = rangeWindow(year, month, range)
  const q = filters.q.trim().toLowerCase()
  const min = filters.min !== '' ? Number(filters.min) : null
  const max = filters.max !== '' ? Number(filters.max) : null
  const list = txns.filter(t => {
    if (t.date < from || t.date > to) return false
    if (filters.type && t.type !== filters.type) return false
    if (filters.category && t.category !== filters.category) return false
    if (min !== null && Number(t.amount) < min) return false
    if (max !== null && Number(t.amount) > max) return false
    if (q) {
      const hay = `${t.category} ${t.subcategory || ''} ${t.notes || ''} ${(t.tags || []).join(' ')} ${t.amount}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
  const s = filters.sort
  if (s === 'date-desc') return sortByDateDesc(list)
  if (s === 'date-asc') return sortByDateDesc(list).reverse()
  return list.sort((a, b) => s === 'amount-desc' ? b.amount - a.amount : a.amount - b.amount)
}

function drawList(container, opts) {
  const list = filtered(opts)
  const pg = paginate(list, page, PER_PAGE)
  page = pg.page
  const grouped = filters.sort.startsWith('date')
  const hasFilters = filters.q || filters.type || filters.category || filters.min !== '' || filters.max !== ''
  const spent = list.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
  const earned = list.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)

  container.querySelector('#hCount').textContent = `${list.length} transaction${list.length === 1 ? '' : 's'}`
  container.querySelector('#hTotals').textContent = list.length ? `−${formatMoney(Math.round(spent))} · +${formatMoney(Math.round(earned))}` : ''
  container.querySelector('#hClear').style.display = hasFilters ? '' : 'none'
  const tableEl = container.querySelector('#hTable')
  tableEl.innerHTML = txnTableHtml(pg.items, { groups: grouped, empty: hasFilters ? 'No transactions match these filters.' : 'No transactions in this period yet.' })
  container.querySelector('#hPages').innerHTML = paginationHtml(pg, 'transactions')
  wirePagination(container.querySelector('#hPages'), p => { page = p; drawList(container, opts); container.querySelector('#hTable').scrollIntoView({ block: 'nearest' }) })
  wireTxnTable(tableEl, pg.items, {
    onEdit: opts.onEditTxn,
    onDelete: t => deleteTxn(t, opts.txns, () => drawList(container, opts)),
  })
}

function drawCalendar(container, opts) {
  const { txns, budgets, year, month } = opts
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`
  const monthTxns = txns.filter(t => t.date.startsWith(monthKey))
  const byDate = {}
  for (const t of monthTxns) {
    if (!byDate[t.date]) byDate[t.date] = { spend: 0, count: 0 }
    byDate[t.date].count++
    if (t.type === 'expense') byDate[t.date].spend += Number(t.amount)
  }
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const totalBudget = (budgets || []).reduce((s, b) => s + Number(b.monthly_limit || 0), 0)
  const daily = totalBudget > 0 ? totalBudget / daysInMonth : null
  const today = localISO(new Date())
  const firstWd = new Date(year, month, 1).getDay()
  const cells = []
  for (let i = 0; i < firstWd; i++) cells.push('<div class="d-cal-day blank"></div>')
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${monthKey}-${String(d).padStart(2, '0')}`
    const info = byDate[ds]
    const flag = info?.spend && daily !== null ? (info.spend > daily ? 'over' : 'under') : ''
    cells.push(`
      <div class="d-cal-day ${ds === today ? 'today' : ''} ${ds === calSelected ? 'selected' : ''} ${flag}" data-date="${ds}" role="button" tabindex="0">
        <span class="d-cal-num">${d}</span>
        ${info ? `<span class="d-cal-count">${info.count} item${info.count === 1 ? '' : 's'}</span>` : ''}
        ${info?.spend ? `<span class="d-cal-amt">−${formatMoney(Math.round(info.spend))}</span>` : ''}
      </div>`)
  }
  const cal = container.querySelector('#hCal')
  cal.innerHTML = `
    <div class="d-card-head"><div>
      <div class="d-card-title">${new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
      <div class="d-card-sub">${daily !== null ? `Green/red underline = under/over your daily budget of ${formatMoney(Math.round(daily))}` : 'Set budget limits to see over/under-budget days'}</div>
    </div></div>
    <div class="d-cal">
      ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(w => `<div class="d-cal-wd">${w}</div>`).join('')}
      ${cells.join('')}
    </div>`
  cal.querySelectorAll('.d-cal-day[data-date]').forEach(cell => {
    const pick = () => { calSelected = calSelected === cell.dataset.date ? null : cell.dataset.date; drawCalendar(container, opts) }
    cell.onclick = pick
    cell.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } }
  })

  const dayEl = container.querySelector('#hDay')
  const sel = calSelected && calSelected.startsWith(monthKey) ? calSelected : null
  const dayTxns = sel ? monthTxns.filter(t => t.date === sel) : []
  const spend = monthTxns.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
  const activeDays = Object.keys(byDate).length
  dayEl.innerHTML = sel ? `
    <div class="d-table-card">
      <div class="d-toolbar"><div class="d-toolbar-title">${dateHeaderLabel(sel)}</div></div>
      <div id="hDayTable">${txnTableHtml(dayTxns, { groups: false, empty: 'Nothing logged this day.' })}</div>
    </div>` : `
    <div class="d-card">
      <div class="d-card-head"><div><div class="d-card-title">This month</div><div class="d-card-sub">Click a day to see its transactions</div></div></div>
      <div class="d-res-row"><span class="l">Spent</span><span class="v">${formatMoney(Math.round(spend))}</span></div>
      <div class="d-res-row"><span class="l">Days with activity</span><span class="v">${activeDays} / ${daysInMonth}</span></div>
      <div class="d-res-row"><span class="l">Avg per active day</span><span class="v">${activeDays ? formatMoney(Math.round(spend / activeDays)) : '—'}</span></div>
      ${daily !== null ? `<div class="d-res-row"><span class="l">Daily budget</span><span class="v">${formatMoney(Math.round(daily))}</span></div>` : ''}
    </div>`
  const dayTable = dayEl.querySelector('#hDayTable')
  if (dayTable) wireTxnTable(dayTable, dayTxns, { onEdit: opts.onEditTxn, onDelete: t => deleteTxn(t, opts.txns, () => drawCalendar(container, opts)) })
}
