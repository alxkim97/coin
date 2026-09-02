// Lets an amount field take "500000+3507.34" instead of making you do the
// math first — handy when one account line is really two sub-accounts you
// want combined. Only ever reaches Function() after the charset check below
// passes, so nothing but digits/operators/parens/whitespace can execute.
export function evalMoneyExpr(str) {
  const s = String(str ?? '').trim()
  if (!s) return NaN
  if (!/^[0-9+\-*/().\s]+$/.test(s)) return NaN
  try {
    const result = Function(`"use strict"; return (${s})`)()
    return typeof result === 'number' && isFinite(result) ? result : NaN
  } catch {
    return NaN
  }
}

export function formatMoney(n) {
  const v = Number(n) || 0
  return '฿' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

// Formats a Date using its LOCAL year/month/day — never use .toISOString()
// for this. toISOString() converts to UTC first, which silently shifts the
// date backward by a day for anyone in a positive-UTC-offset timezone
// (Thailand included) whenever the Date represents local midnight — exactly
// what every month-boundary/date-math helper below constructs. This bit us
// for real: monthRange/rangeWindow were off by a day at every month
// boundary, effectiveDate's salary shift landed on the wrong day entirely,
// and advanceDate lost whole recurring periods. Route every local date
// through this instead.
export function localISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayISO() {
  return localISO(new Date())
}

// Average monthly spend per expense category over the trailing N months —
// replaces a one-time hardcoded snapshot with something that stays current
// on its own as you keep logging.
export function computeSuggestedLimits(txns, months = 3) {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffStr = localISO(cutoff)
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
  const from = localISO(new Date(year, month, 1))
  const to = localISO(new Date(year, month + 1, 0))
  return { from, to }
}

export function rangeWindow(year, month, span) {
  const from = localISO(new Date(year, month - (span - 1), 1))
  const to = localISO(new Date(year, month + 1, 0))
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
  return localISO(new Date(d.getFullYear(), d.getMonth() + 1, 1))
}

const FREQUENCY_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', annually: 'Annually' }
export function frequencyLabel(frequency) {
  return FREQUENCY_LABELS[frequency] || frequency
}

// Month-based frequencies (monthly/quarterly/annually) clamp to the target
// month's last day instead of overflowing (native setMonth on day 31 rolls
// into the month after next when the target month is shorter) — e.g. a
// monthly item due Jan 31 lands on Feb 28, not Mar 3. Once clamped, later
// months stay clamped rather than jumping back to 31 — same "sticky"
// behavior most calendar apps use for end-of-month recurrences.
export function advanceDate(dateStr, frequency) {
  const d = new Date(dateStr + 'T00:00:00')
  if (frequency === 'daily') { d.setDate(d.getDate() + 1); return localISO(d) }
  if (frequency === 'weekly') { d.setDate(d.getDate() + 7); return localISO(d) }
  const monthsToAdd = frequency === 'quarterly' ? 3 : frequency === 'annually' ? 12 : 1 // monthly, and the default for anything unrecognized
  const day = d.getDate()
  d.setDate(1) // park on the 1st while changing month so the overflow never happens in the first place
  d.setMonth(d.getMonth() + monthsToAdd)
  const daysInTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, daysInTargetMonth))
  return localISO(d)
}

export function formatDateDMY(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${dd}/${mm}/${yy}`
}

// A native <input type="date"> displays its text in whatever format the OS/
// browser locale dictates (MM/DD/YYYY on this machine) — there's no way to
// override that directly. This overlays our own DD/MM/YY text on top (the
// native input's own text is made transparent via CSS) while leaving the
// real date input underneath fully interactive, so the native calendar
// picker still works exactly as before; only what you *read* changes.
export function dmyDateFieldHtml(id, value) {
  return `
    <div class="date-field-dmy">
      <input type="date" id="${id}" value="${value}" />
      <div class="date-display" id="${id}Display">${value ? formatDateDMY(value) : ''}</div>
    </div>
  `
}

export function wireDmyDateField(container, id, onChange) {
  const input = container.querySelector('#' + id)
  const display = container.querySelector('#' + id + 'Display')
  input.oninput = e => {
    display.textContent = e.target.value ? formatDateDMY(e.target.value) : ''
    onChange(e.target.value)
  }
}

export function dateHeaderLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a, b) => a.toDateString() === b.toDateString()
  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, yesterday)) return 'Yesterday'
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' })
  return `${weekday} ${formatDateDMY(dateStr)}`
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
