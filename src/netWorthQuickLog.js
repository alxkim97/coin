import { addNetWorth } from './supabase.js'
import { toast, todayISO, escapeHtml, formatMoney, dmyDateFieldHtml, wireDmyDateField, evalMoneyExpr } from './helpers.js'
import { latestAccountValues } from './analysisData.js'

// Pre-fills from every account's latest known value across ALL check-ins —
// not just whichever check-in happened to be most recent — so logging just
// your banks today and your investments next week still carries the other
// half forward instead of dropping it. Same low-friction idea as a quick
// weight-log popup, applied to a multi-field entry instead of a single number.
export function openNetWorthQuickLog({ networth, onSaved }) {
  const known = latestAccountValues(networth)
  const seedItems = known.length
    ? known.map(i => ({ name: i.name, category: i.category, value: '', lastValue: i.value }))
    : [{ name: '', category: 'cash', value: '', lastValue: null }]

  let items = seedItems
  let date = todayISO()
  // which field to focus on the next render — defaults to the first row's
  // value (updating pre-filled balances); +Add Account points this at the
  // new row's name input instead, since that one's actually empty
  let focusTarget = { index: 0, field: 'value' }

  const overlay = document.createElement('div')
  overlay.className = 'confirm-overlay'
  document.getElementById('app').appendChild(overlay)

  function render() {
    overlay.innerHTML = `
      <div class="confirm-box nwq-box">
        <div class="nwq-title">💰 Log Net Worth</div>
        <div class="nwq-sub">${known.length ? 'Update only what changed — leave the rest blank' : 'Add your accounts and balances'}</div>
        <div class="nwq-date-label">Date</div>
        ${dmyDateFieldHtml('nwqDate', date)}
        <div class="nwq-rows">
          ${items.map((it, i) => `
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
          `).join('')}
        </div>
        <div style="font-size:11.5px;color:var(--text3);margin-top:6px">Leave a balance blank to skip that account this time — it won't be zeroed out.</div>
        <button class="btn secondary" id="nwqAddItem" style="margin-top:8px">+ Add Account</button>
        <div class="confirm-actions" style="margin-top:16px">
          <button class="btn secondary" id="nwqCancel">Cancel</button>
          <button class="btn" id="nwqSave">Save</button>
        </div>
      </div>
    `
    wire()
    const row = overlay.querySelector(`.nw-item-row[data-index="${focusTarget.index}"]`)
    const field = row?.querySelector(focusTarget.field === 'name' ? '.nwItemName' : '.nwItemValue')
    if (field) setTimeout(() => field.focus(), 80)
  }

  function wire() {
    wireDmyDateField(overlay, 'nwqDate', v => { date = v })
    overlay.querySelector('#nwqCancel').onclick = close
    overlay.onclick = (e) => { if (e.target === overlay) close() }

    overlay.querySelectorAll('.nw-item-row').forEach(row => {
      const i = Number(row.dataset.index)
      row.querySelector('.nwItemName').oninput = e => { items[i].name = e.target.value }
      row.querySelector('.nwItemCategory').onchange = e => { items[i].category = e.target.value }
      row.querySelector('.nwItemValue').oninput = e => { items[i].value = e.target.value }
      row.querySelector('.nwItemValue').onkeydown = e => { if (e.key === 'Enter') save() }
      // collapse an expression like "500000+3507.34" down to its total as
      // soon as you tab/click away — confirms it parsed the way you meant
      row.querySelector('.nwItemValue').onblur = e => {
        const raw = e.target.value.trim()
        if (!/[+\-*/]/.test(raw)) return
        const evaluated = evalMoneyExpr(raw)
        if (!isNaN(evaluated)) { e.target.value = String(evaluated); items[i].value = String(evaluated) }
      }
      row.querySelector('.nwItemRemove').onclick = () => { items.splice(i, 1); render() }
    })

    overlay.querySelector('#nwqAddItem').onclick = () => {
      items.push({ name: '', category: 'cash', value: '', lastValue: null })
      focusTarget = { index: items.length - 1, field: 'name' }
      render()
    }
    overlay.querySelector('#nwqSave').onclick = save
  }

  async function save() {
    // a blank value means "skip this account this time," not "set it to 0" —
    // only rows the user actually typed a number into get saved
    const invalidRow = items.find(it => it.name.trim() && it.value !== '' && isNaN(evalMoneyExpr(it.value)))
    if (invalidRow) { toast(`Can't work out "${invalidRow.value}" for ${invalidRow.name.trim()}`); return }
    const cleaned = items
      .map(it => ({ name: it.name.trim(), category: it.category, value: it.value }))
      .filter(it => it.name && it.value !== '')
      .map(it => ({ name: it.name, category: it.category, value: evalMoneyExpr(it.value) }))
    if (!date) { toast('Pick a date'); return }
    if (!cleaned.length) { toast('Enter at least one balance'); return }
    const btn = overlay.querySelector('#nwqSave')
    btn.disabled = true
    btn.textContent = 'Saving…'
    try {
      await addNetWorth({ date, items: cleaned })
    } catch (e) {
      toast(e.message || 'Failed to save')
      btn.disabled = false
      btn.textContent = 'Save'
      return
    }
    toast('Net worth logged')
    close()
    try {
      await onSaved()
    } catch (e) {
      console.error('Net worth saved, but refreshing the view failed', e)
    }
  }

  function close() { overlay.remove() }

  render()
}
