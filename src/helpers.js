export function formatMoney(n) {
  const v = Number(n) || 0
  return '฿' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export function todayISO() {
  const d = new Date()
  return d.toISOString().slice(0, 10)
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
export function confirmDialog(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.className = 'confirm-overlay'
    overlay.innerHTML = `
      <div class="confirm-box">
        <p>${escapeHtml(message)}</p>
        <div class="confirm-actions">
          <button class="btn secondary" id="confirmNo">Cancel</button>
          <button class="btn danger" id="confirmYes">Delete</button>
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
