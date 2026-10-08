import { monthLabel, rangeLabel } from './helpers.js'
import { icon } from './icons.js'

// Month dropdown + "This month" reset — replaces the ‹ › arrow buttons on
// Dashboard and Transactions. A native <select> so iOS shows its own wheel
// picker. Options run newest-first from the current month back to the
// earliest logged month; months are encoded as year*12+month in the value.
export function monthPickerHtml({ year, month, txns, range = 1 }) {
  const now = new Date()
  const cur = now.getFullYear() * 12 + now.getMonth()
  const sel = year * 12 + month
  let first = Math.min(cur, sel)
  for (const t of txns || []) {
    const y = Number(t.date?.slice(0, 4)), m = Number(t.date?.slice(5, 7))
    if (y && m) first = Math.min(first, y * 12 + m - 1)
  }
  const last = Math.max(cur, sel)
  const options = []
  for (let k = last; k >= first; k--) {
    const y = Math.floor(k / 12), m = k % 12
    options.push(`<option value="${k}"${k === sel ? ' selected' : ''}>${range > 1 ? rangeLabel(y, m, range) : monthLabel(y, m)}</option>`)
  }
  return `
    <div class="month-nav">
      <label class="month-picker">${icon('calendar', 16)}<select id="monthSelect" aria-label="Month">${options.join('')}</select></label>
      ${sel !== cur ? '<button class="month-today" id="monthToday">This month</button>' : ''}
    </div>`
}

export function wireMonthPicker(container, onMonthChange) {
  container.querySelector('#monthSelect').onchange = (e) => {
    const k = Number(e.target.value)
    onMonthChange(Math.floor(k / 12), k % 12)
  }
  const today = container.querySelector('#monthToday')
  if (today) today.onclick = () => { const n = new Date(); onMonthChange(n.getFullYear(), n.getMonth()) }
}
