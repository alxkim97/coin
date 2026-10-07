// Shared between the dashboard's quick-log popup (netWorthQuickLog.js) and
// the Settings "New Check-in" form — both log the same coin_networth data,
// and used to carry two independently-hand-copied implementations that had
// already drifted (Settings didn't pre-fill from history and zeroed out any
// blank field on save, contradicting the quick-log's explicit "blank skips
// this account, doesn't zero it" behavior). One implementation now backs both.
import { escapeHtml, formatMoney, evalMoneyExpr } from './helpers.js'

// Seeds item rows from each account's latest known value across ALL
// check-ins — not just whichever check-in happened to be most recent — so
// logging just your banks today and your investments next week still
// carries the other half forward instead of dropping it.
export function seedNetWorthItems(known) {
  return known.length
    ? known.map(i => ({ name: i.name, category: i.category, value: '', lastValue: i.value }))
    : [{ name: '', category: 'cash', value: '', lastValue: null }]
}

export function netWorthItemRowsHtml(items) {
  return items.map((it, i) => `
    <div class="nw-item-row" data-index="${i}">
      <input class="nwItemName" type="text" placeholder="e.g. KBANK Savings" value="${escapeHtml(it.name)}" />
      <select class="nwItemCategory">
        <option value="cash" ${it.category === 'cash' ? 'selected' : ''}>Cash</option>
        <option value="invested" ${it.category === 'invested' ? 'selected' : ''}>Invested</option>
        <option value="insurance" ${it.category === 'insurance' ? 'selected' : ''}>Insurance</option>
      </select>
      <input class="nwItemValue" type="text" inputmode="decimal" placeholder="${it.lastValue != null ? escapeHtml(formatMoney(it.lastValue)) : 'e.g. 500000+3507.34'}" value="${escapeHtml(it.value)}" />
      <button class="nwItemRemove" type="button" ${items.length <= 1 ? 'disabled' : ''}>✕</button>
    </div>
  `).join('')
}

// Wires the item-row inputs inside `root` against `items`. Text/select edits
// mutate items in place (no re-render needed); remove calls onChange since
// the row count changed. onEnter, if given, fires from the value field.
export function wireNetWorthItemRows(root, items, { onChange, onEnter } = {}) {
  root.querySelectorAll('.nw-item-row').forEach(row => {
    const i = Number(row.dataset.index)
    row.querySelector('.nwItemName').oninput = e => { items[i].name = e.target.value }
    row.querySelector('.nwItemCategory').onchange = e => { items[i].category = e.target.value }
    row.querySelector('.nwItemValue').oninput = e => { items[i].value = e.target.value }
    if (onEnter) row.querySelector('.nwItemValue').onkeydown = e => { if (e.key === 'Enter') onEnter() }
    // collapse an expression like "500000+3507.34" down to its total as soon
    // as you tab/click away — confirms it parsed the way you meant
    row.querySelector('.nwItemValue').onblur = e => {
      const raw = e.target.value.trim()
      if (!/[+\-*/]/.test(raw)) return
      const evaluated = evalMoneyExpr(raw)
      if (!isNaN(evaluated)) { e.target.value = String(evaluated); items[i].value = String(evaluated) }
    }
    row.querySelector('.nwItemRemove').onclick = () => { items.splice(i, 1); onChange() }
  })
}

// Rows with a name AND a value that isn't a valid number/expression — checked
// separately from cleanNetWorthItems so callers can toast a specific "can't
// work out X" message before silently dropping the row.
export function findInvalidNetWorthItem(items) {
  return items.find(it => it.name.trim() && it.value !== '' && isNaN(evalMoneyExpr(it.value)))
}

// A blank value means "skip this account this time," not "set it to 0" —
// only rows with both a name and a value that evaluates to a number are
// saved. Call findInvalidNetWorthItem first to catch a typo/bad expression
// before it gets silently dropped here.
export function cleanNetWorthItems(items) {
  return items
    .map(it => ({ name: it.name.trim(), category: it.category, value: it.value }))
    .filter(it => it.name && it.value !== '')
    .map(it => ({ name: it.name, category: it.category, value: evalMoneyExpr(it.value) || 0 }))
}
