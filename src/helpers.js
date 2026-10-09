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

// Short money for chart axes (฿90k, ฿1.2M) — full figures clip on phone-width
// y-axes and crowd them on desktop. Tooltips keep using formatMoney.
export function formatMoneyAxis(n) {
  const v = Number(n) || 0, a = Math.abs(v), s = v < 0 ? '-' : ''
  if (a >= 1e6) return s + '฿' + +(a / 1e6).toFixed(1) + 'M'
  if (a >= 1e3) return s + '฿' + +(a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k'
  return s + '฿' + a
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

// Sorts a list of {date, created_at?} records by date — used for net worth
// check-ins, transactions, anything with a plain ISO date field. Same-date
// entries break ties by created_at (when present) instead of leaving
// same-day order to array insertion order, so "the latest entry" means the
// same thing everywhere this is used rather than depending on which of the
// four-plus copies of this comparator a given call site happened to have.
export function sortByDateAsc(list) {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.created_at || '').localeCompare(b.created_at || ''))
}
export function sortByDateDesc(list) {
  return [...list].sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || '').localeCompare(a.created_at || ''))
}

// Suggested monthly limit per expense category: the average of the last N
// *complete* months that have any spending logged — empty (not-yet-logged)
// months are skipped instead of counted as ฿0, which used to drag every
// suggestion down — rounded to the nearest ฿100. Looks back up to 12 months
// for N months with data. Returns the months used and each category's
// per-month spend so the Budget page can show its working.
export function suggestionBasis(txns, months = 3, now = new Date()) {
  const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const spend = {}
  for (const t of txns) {
    if (t.type !== 'expense') continue
    const k = t.date.slice(0, 7)
    if (!spend[k]) spend[k] = {}
    spend[k][t.category] = (spend[k][t.category] || 0) + Number(t.amount)
  }
  const used = []
  for (let i = 1; i <= 12 && used.length < months; i++) {
    const k = key(new Date(now.getFullYear(), now.getMonth() - i, 1))
    if (spend[k]) used.push(k)
  }
  used.reverse()
  const perCat = {}
  for (const k of used) for (const cat in spend[k]) if (!perCat[cat]) perCat[cat] = {}
  for (const cat in perCat) {
    const byMonth = Object.fromEntries(used.map(k => [k, spend[k][cat] || 0]))
    const avg = used.length ? Object.values(byMonth).reduce((s, v) => s + v, 0) / used.length : 0
    perCat[cat] = { byMonth, avg, suggested: Math.round(avg / 100) * 100 }
  }
  return { months: used, perCat }
}

export function computeSuggestedLimits(txns, months = 3) {
  const { perCat } = suggestionBasis(txns, months)
  return Object.fromEntries(Object.entries(perCat).map(([cat, v]) => [cat, v.suggested]))
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
function getToastEl() {
  let el = document.querySelector('.toast')
  if (!el) {
    el = document.createElement('div')
    el.className = 'toast'
    // body, not #app: popups live on body, and a toast inside #app painted
    // underneath their backdrop
    document.body.appendChild(el)
  }
  return el
}

// Converts a VAPID public key (base64url string) into the Uint8Array
// pushManager.subscribe()'s applicationServerKey option expects — standard
// boilerplate for the Web Push API, same conversion WalkLog's client uses.
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

export function toast(msg) {
  const el = getToastEl()
  el.classList.remove('has-action')
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000)
}

// Same toast, but with a button (e.g. "Undo") that fires onAction and dismisses
// immediately. Stays up longer than a plain toast since there's something to read.
export function toastWithAction(msg, actionLabel, onAction) {
  const el = getToastEl()
  el.classList.add('has-action', 'show')
  el.innerHTML = `<span class="toast-msg"></span><button type="button" class="toast-action">${escapeHtml(actionLabel)}</button>`
  el.querySelector('.toast-msg').textContent = msg
  el.querySelector('.toast-action').onclick = () => {
    clearTimeout(toastTimer)
    el.classList.remove('show')
    onAction()
  }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000)
}

// Custom in-DOM confirm — some mobile browsers (e.g. Brave on Android, when the
// app is running as an installed PWA) don't wire up window.confirm() to a real
// dialog, so it returns immediately without giving the user a chance to answer.
export function confirmDialog(message, confirmLabel = 'Confirm', danger = false) {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    // confirm-top + body: it's usually raised from inside another popup (also
    // on body, same z-index), and appending it to #app put it underneath
    overlay.className = 'confirm-overlay confirm-top'
    overlay.innerHTML = `
      <div class="confirm-box">
        <p>${escapeHtml(message)}</p>
        <div class="confirm-actions">
          <button class="btn secondary" id="confirmNo">Cancel</button>
          <button class="btn ${danger ? 'danger' : ''}" id="confirmYes">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)
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
  const header = ['date', 'type', 'category', 'subcategory', 'amount', 'notes', 'tags']
  // semicolon-joined, not comma — commas are the CSV delimiter itself
  const rows = txns.map(t => [t.date, t.type, t.category, t.subcategory || '', t.amount, t.notes || '', (t.tags || []).join('; ')].map(csvField).join(','))
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

// On sign-out — the offline copy is real financial data and shouldn't
// outlive the session on a shared computer.
export function clearCachedData() {
  try { localStorage.removeItem(CACHE_KEY) } catch { /* storage unavailable — nothing cached either */ }
}

export function getCachedData() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY))
    return raw && Array.isArray(raw.txns) ? raw : null
  } catch {
    return null
  }
}
