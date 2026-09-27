// Shared between the dashboard's quick-log popup (netWorthQuickLog.js) and
// the Settings "New Check-in" form — both log the same coin_networth data,
// and used to carry two independently-hand-copied implementations that had
// already drifted (Settings didn't pre-fill from history and zeroed out any
// blank field on save, contradicting the quick-log's explicit "blank skips
// this account, doesn't zero it" behavior). One implementation now backs both.
import { escapeHtml, formatMoney } from './helpers.js'

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
      <input class="nwItemValue" type="number" inputmode="decimal" placeholder="${it.lastValue != null ? escapeHtml(formatMoney(it.lastValue)) : '0'}" value="${escapeHtml(it.value)}" />
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
    row.querySelector('.nwItemRemove').onclick = () => { items.splice(i, 1); onChange() }
  })
}

// A blank value means "skip this account this time," not "set it to 0" —
// only rows with both a name and a typed number are saved.
export function cleanNetWorthItems(items) {
  return items
    .map(it => ({ name: it.name.trim(), category: it.category, value: it.value }))
    .filter(it => it.name && it.value !== '')
    .map(it => ({ name: it.name, category: it.category, value: parseFloat(it.value) || 0 }))
}
