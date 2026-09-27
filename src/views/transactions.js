import { formatMoney, monthLabel, monthRange, dateHeaderLabel, formatDateDMY, localISO, escapeHtml, toast, toastWithAction } from '../helpers.js'
import { CATEGORY_ICONS } from '../categories.js'
import { deleteTransaction, addTransaction } from '../supabase.js'

// persists across re-renders within the session (module-level, like the rest of the app's view state)
let filters = { q: '', category: 'All', min: '', max: '' }
let viewMode = 'list'
let calSelectedDate = null

// closes whichever swipe-to-delete row is currently open when a new one opens
// or the list re-renders — only one row should ever be pulled open at a time
let closeOpenSwipe = null

function txnRowHtml(t) {
  return `
    <div class="swipe-row" data-id="${t.id}">
      <div class="swipe-delete-action">Delete</div>
      <div class="swipe-row-content">
        <div class="txn-row" data-id="${t.id}">
          <div class="txn-icon">${CATEGORY_ICONS[t.category] || '💵'}</div>
          <div class="txn-main">
            <div class="txn-cat">${escapeHtml(t.category)}${t.is_credit_card ? ' <span class="txn-cc" title="Paid via credit card">💳</span>' : ''}${t.is_shopee ? ' <span class="txn-cc" title="Bought via Shopee">🛍️</span>' : ''}</div>
            ${t.subcategory ? `<div class="txn-sub">${escapeHtml(t.subcategory)}</div>` : ''}
          </div>
          <div class="txn-amt ${t.type}">${t.type === 'income' ? '+' : '−'}${formatMoney(t.amount)}</div>
        </div>
      </div>
    </div>
  `
}

// Wires pointer-drag swipe-to-delete on every `.swipe-row` under `root`.
// onEdit/onDelete take the row's txn id — callers look it up in whichever
// array is in scope (filtered list vs. calendar day detail).
function wireTxnRows(root, { onEdit, onDelete }) {
  closeOpenSwipe = null
  root.querySelectorAll('.swipe-row').forEach(swipeRow => {
    const id = swipeRow.dataset.id
    const content = swipeRow.querySelector('.swipe-row-content')
    let startX = 0, startY = 0, baseX = 0, curX = 0, dragging = false, moved = false

    function setX(x, animate) {
      curX = x
      content.style.transition = animate ? 'transform .18s ease' : 'none'
      content.style.transform = x ? `translateX(${x}px)` : ''
    }
    function close() { setX(0, true) }
    function openFull() {
      if (closeOpenSwipe && closeOpenSwipe !== close) closeOpenSwipe()
      setX(-72, true)
      closeOpenSwipe = close
    }

    content.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      startX = e.clientX; startY = e.clientY; baseX = curX; dragging = true; moved = false
    })
    content.addEventListener('pointermove', e => {
      if (!dragging) return
      const dx = e.clientX - startX, dy = e.clientY - startY
      if (!moved) {
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) { dragging = false; return }
        if (Math.abs(dx) < 8) return
        moved = true
      }
      setX(Math.min(0, Math.max(-72, baseX + dx)), false)
    })
    function endDrag() {
      if (!dragging) return
      dragging = false
      if (!moved) return
      if (curX < -36) openFull(); else close()
    }
    content.addEventListener('pointerup', endDrag)
    content.addEventListener('pointercancel', endDrag)

    content.querySelector('.txn-row').onclick = () => {
      if (moved) return
      if (curX !== 0) { close(); return }
      onEdit(id)
    }
    swipeRow.querySelector('.swipe-delete-action').onclick = () => { close(); onDelete(id) }
  })
}

// Mutates `txns` in place (the same array reference main.js holds in
// state.txns) and calls `rerender` — which just re-invokes renderTransactions
// on the view's own container, not the top-level app render, so the
// in-flight undo toast (appended to #app, a sibling of this container)
// survives. Restores on failure. Undo re-adds via addTransaction — it gets a
// new DB id, same visible data, an accepted limitation rather than a bug.
async function deleteTxnRow(id, txns, rerender) {
  const idx = txns.findIndex(t => t.id === id)
  const txn = txns[idx]
  if (!txn) return
  txns.splice(idx, 1)
  rerender()

  try {
    await deleteTransaction(id)
  } catch (e) {
    txns.splice(idx, 0, txn)
    rerender()
    toast(e.message || 'Failed to delete')
    return
  }

  toastWithAction('Transaction deleted', 'Undo', async () => {
    try {
      const { id: _oldId, created_at, ...rest } = txn
      const restored = await addTransaction(rest)
      txns.push(restored)
      rerender()
    } catch (e) {
      toast(e.message || 'Failed to restore')
    }
  })
}

export function renderTransactions(container, { txns, budgets, year, month, onMonthChange, onEditTxn }) {
  const { from, to } = monthRange(year, month)
  const monthTxns = txns.filter(t => t.date >= from && t.date <= to)
  const categories = ['All', ...new Set(monthTxns.map(t => t.category))].sort((a, b) => a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b))
  // the filter persists across month navigation, but a category picked in one
  // month may not exist in another — keep it in sync with what the <select>
  // can actually show instead of silently filtering on a value the dropdown
  // doesn't display
  if (!categories.includes(filters.category)) filters.category = 'All'

  container.innerHTML = `
    <div class="top-bar"><h1>Transactions</h1></div>
    <div class="month-nav">
      <button id="prevMonth">‹</button>
      <div class="month-label">${monthLabel(year, month)}</div>
      <button id="nextMonth">›</button>
    </div>

    <div class="range-toggle" id="viewModeToggle">
      <button data-mode="list" class="${viewMode === 'list' ? 'active' : ''}">List</button>
      <button data-mode="calendar" class="${viewMode === 'calendar' ? 'active' : ''}">Calendar</button>
    </div>

    ${viewMode === 'list' ? `
      <div class="filter-bar">
        <input id="filterQ" type="text" placeholder="Search vendor or notes…" value="${escapeHtml(filters.q)}" />
        <div class="filter-row">
          <select id="filterCat">
            ${categories.map(c => `<option value="${escapeHtml(c)}" ${c === filters.category ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
          <input id="filterMin" type="number" inputmode="decimal" placeholder="Min ฿" value="${escapeHtml(filters.min)}" />
          <input id="filterMax" type="number" inputmode="decimal" placeholder="Max ฿" value="${escapeHtml(filters.max)}" />
        </div>
        <button class="filter-clear" id="clearFilters" style="display:none">Clear filters</button>
      </div>

      <div id="txnList"></div>
    ` : `
      <div class="card"><div class="cal-grid" id="calendarGrid"></div></div>
      <div id="calendarDayDetail"></div>
    `}
  `

  container.querySelector('#prevMonth').onclick = () => {
    const m = month === 0 ? 11 : month - 1
    const y = month === 0 ? year - 1 : year
    onMonthChange(y, m)
  }
  container.querySelector('#nextMonth').onclick = () => {
    const m = month === 11 ? 0 : month + 1
    const y = month === 11 ? year + 1 : year
    onMonthChange(y, m)
  }
  container.querySelectorAll('#viewModeToggle button').forEach(btn => {
    btn.onclick = () => {
      viewMode = btn.dataset.mode
      renderTransactions(container, { txns, budgets, year, month, onMonthChange, onEditTxn })
    }
  })

  if (viewMode === 'calendar') {
    renderCalendar(container, txns, monthTxns, budgets || [], year, month, onMonthChange, onEditTxn)
    return
  }

  function updateList() {
    const q = filters.q.trim().toLowerCase()
    const min = filters.min !== '' ? Number(filters.min) : null
    const max = filters.max !== '' ? Number(filters.max) : null
    const filtered = monthTxns.filter(t => {
      if (filters.category !== 'All' && t.category !== filters.category) return false
      if (min !== null && Number(t.amount) < min) return false
      if (max !== null && Number(t.amount) > max) return false
      if (q) {
        const hay = `${t.category} ${t.subcategory || ''} ${t.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    const groups = {}
    for (const t of filtered) {
      if (!groups[t.date]) groups[t.date] = []
      groups[t.date].push(t)
    }
    const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a))
    const hasFilters = q || filters.category !== 'All' || filters.min !== '' || filters.max !== ''
    container.querySelector('#clearFilters').style.display = hasFilters ? '' : 'none'

    const list = container.querySelector('#txnList')
    list.innerHTML = dates.length === 0
      ? `<div class="empty-state">${monthTxns.length === 0 ? 'No transactions this month yet.' : 'No transactions match these filters.'}</div>`
      : dates.map(date => `
        <div class="txn-date-header">${dateHeaderLabel(date)}</div>
        <div class="card">
          ${groups[date].map(txnRowHtml).join('')}
        </div>
      `).join('')

    const rerender = () => renderTransactions(container, { txns, budgets, year, month, onMonthChange, onEditTxn })
    wireTxnRows(list, {
      onEdit: id => onEditTxn(filtered.find(t => t.id === id)),
      onDelete: id => deleteTxnRow(id, txns, rerender),
    })
  }

  container.querySelector('#filterQ').oninput = e => { filters.q = e.target.value; updateList() }
  container.querySelector('#filterCat').onchange = e => { filters.category = e.target.value; updateList() }
  container.querySelector('#filterMin').oninput = e => { filters.min = e.target.value; updateList() }
  container.querySelector('#filterMax').oninput = e => { filters.max = e.target.value; updateList() }
  container.querySelector('#clearFilters').onclick = () => {
    filters = { q: '', category: 'All', min: '', max: '' }
    container.querySelector('#filterQ').value = ''
    container.querySelector('#filterCat').value = 'All'
    container.querySelector('#filterMin').value = ''
    container.querySelector('#filterMax').value = ''
    updateList()
  }

  updateList()
}

function renderCalendar(container, txns, monthTxns, budgets, year, month, onMonthChange, onEditTxn) {
  const spendByDate = {}
  for (const t of monthTxns) {
    if (t.type !== 'expense') continue
    spendByDate[t.date] = (spendByDate[t.date] || 0) + Number(t.amount)
  }

  const totalBudget = budgets.reduce((s, b) => s + Number(b.monthly_limit || 0), 0)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const dailyBudget = totalBudget > 0 ? totalBudget / daysInMonth : null

  const today = localISO(new Date())
  const firstWeekday = new Date(year, month, 1).getDay()
  const cells = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let day = 1; day <= daysInMonth; day++) cells.push(day)

  const grid = container.querySelector('#calendarGrid')
  grid.innerHTML = `
    <div class="cal-weekdays">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<div>${d}</div>`).join('')}</div>
    <div class="cal-days">
      ${cells.map(day => {
        if (!day) return '<div class="cal-day empty"></div>'
        const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        const spend = spendByDate[ds] || 0
        let dotClass = ''
        if (spend > 0) {
          dotClass = dailyBudget === null ? 'cal-dot-neutral' : (spend > dailyBudget ? 'cal-dot-red' : 'cal-dot-green')
        }
        return `
          <div class="cal-day ${ds === today ? 'today' : ''} ${ds === calSelectedDate ? 'selected' : ''}" data-date="${ds}">
            <span class="cal-day-num">${day}</span>
            ${dotClass ? `<span class="cal-dot ${dotClass}"></span>` : ''}
          </div>
        `
      }).join('')}
    </div>
  `

  grid.querySelectorAll('.cal-day[data-date]').forEach(cell => {
    cell.onclick = () => {
      calSelectedDate = calSelectedDate === cell.dataset.date ? null : cell.dataset.date
      renderCalendar(container, txns, monthTxns, budgets, year, month, onMonthChange, onEditTxn)
    }
  })

  const detail = container.querySelector('#calendarDayDetail')
  if (!calSelectedDate) {
    detail.innerHTML = ''
    return
  }
  const dayTxns = monthTxns.filter(t => t.date === calSelectedDate)
  detail.innerHTML = `
    <div class="txn-date-header">${formatDateDMY(calSelectedDate)}</div>
    <div class="card">
      ${dayTxns.length === 0 ? '<div class="empty-state">No transactions this day.</div>' : dayTxns.map(txnRowHtml).join('')}
    </div>
  `
  const rerender = () => renderTransactions(container, { txns, budgets, year, month, onMonthChange, onEditTxn })
  wireTxnRows(detail, {
    onEdit: id => onEditTxn(dayTxns.find(t => t.id === id)),
    onDelete: id => deleteTxnRow(id, txns, rerender),
  })
}
