export function formatMoney(n) {
  const v = Number(n) || 0
  return '฿' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export function todayISO() {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}

// Average monthly spend per expense category over the trailing N months —
// replaces a one-time hardcoded snapshot with something that stays current
// on its own as you keep logging.
export function computeSuggestedLimits(txns, months = 3) {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  const sums = {}
  for (const t of txns) {
    if (t.type !== 'expense' || t.date < cutoffStr) continue
    sums[t.category] = (sums[t.category] || 0) + Number(t.amount)
  }
  const result = {}
  for (const cat in sums) result[cat] = Math.round((sums[cat] / months) * 100) / 100
  return result
}

export function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export function monthRange(year, month) {
  const from = new Date(year, month, 1).toISOString().slice(0, 10)
  const to = new Date(year, month + 1, 0).toISOString().slice(0, 10)
  return { from, to }
}

export function rangeWindow(year, month, span) {
  const from = new Date(year, month - (span - 1), 1).toISOString().slice(0, 10)
  const to = new Date(year, month + 1, 0).toISOString().slice(0, 10)
  return { from, to }
}

export function rangeLabel(year, month, span) {
  if (span === 1) return monthLabel(year, month)
  const start = new Date(year, month - (span - 1), 1)
  const startLabel = start.toLocaleDateString('en-US', { month: 'short', year: start.getFullYear() === year ? undefined : 'numeric' })
  return `${startLabel} – ${monthLabel(year, month)}`
}

// Salary paid at end of month (day >= 25) is money meant to fund *next*
// month's spending, not the month it happened to land in. Counting it toward
// the calendar month it was deposited makes that next month look like pure
// expense with no income until its own end-of-month payday — same fix as
// Ledger's budget-mode shift. Only affects dashboard totals/budgets; the
// Transactions list still shows the real deposit date.
const SALARY_SHIFT_DAY = 25
export function effectiveDate(t) {
  if (t.type !== 'income' || t.category !== 'Salary') return t.date
  const d = new Date(t.date + 'T00:00:00')
  if (d.getDate() < SALARY_SHIFT_DAY) return t.date
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().slice(0, 10)
}

const FREQUENCY_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', annually: 'Annually' }
export function frequencyLabel(frequency) {
  return FREQUENCY_LABELS[frequency] || frequency
}

export function advanceDate(dateStr, frequency) {
  const d = new Date(dateStr + 'T00:00:00')
  if (frequency === 'daily') d.setDate(d.getDate() + 1)
  else if (frequency === 'weekly') d.setDate(d.getDate() + 7)
  else if (frequency === 'quarterly') d.setMonth(d.getMonth() + 3)
  else if (frequency === 'annually') d.setFullYear(d.getFullYear() + 1)
  else d.setMonth(d.getMonth() + 1) // monthly, and the default for anything unrecognized
  return d.toISOString().slice(0, 10)
}

export function dateHeaderLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a, b) => a.toDateString() === b.toDateString()
  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

let toastTimer = null
export function toast(msg) {
  let el = document.querySelector('.toast')
  if (!el) {
    el = document.createElement('div')
    el.className = 'toast'
    document.getElementById('app').appendChild(el)
  }
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000)
}

// Custom in-DOM confirm — some mobile browsers (e.g. Brave on Android, when the
// app is running as an installed PWA) don't wire up window.confirm() to a real
// dialog, so it returns immediately without giving the user a chance to answer.
export function confirmDialog(message, confirmLabel = 'Confirm', danger = false) {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.className = 'confirm-overlay'
    overlay.innerHTML = `
      <div class="confirm-box">
        <p>${escapeHtml(message)}</p>
        <div class="confirm-actions">
          <button class="btn secondary" id="confirmNo">Cancel</button>
          <button class="btn ${danger ? 'danger' : ''}" id="confirmYes">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `
    document.getElementById('app').appendChild(overlay)
    const close = (result) => { overlay.remove(); resolve(result) }
    overlay.querySelector('#confirmNo').onclick = () => close(false)
    overlay.querySelector('#confirmYes').onclick = () => close(true)
    overlay.onclick = (e) => { if (e.target === overlay) close(false) }
  })
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

export function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function csvField(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function txnsToCsv(txns) {
  const header = ['date', 'type', 'category', 'subcategory', 'amount', 'notes']
  const rows = txns.map(t => [t.date, t.type, t.category, t.subcategory || '', t.amount, t.notes || ''].map(csvField).join(','))
  return [header.join(','), ...rows].join('\n')
}

const CACHE_KEY = 'coin_data_cache'

export function cacheData(txns, budgets) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ txns, budgets }))
  } catch {
    // localStorage full or unavailable — offline fallback just won't have data, non-fatal
  }
}

export function getCachedData() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY))
    return raw && Array.isArray(raw.txns) ? raw : null
  } catch {
    return null
  }
}
