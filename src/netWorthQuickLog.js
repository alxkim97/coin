import { addNetWorth } from './supabase.js'
import { toast, todayISO, escapeHtml } from './helpers.js'

// Pre-fills from the most recent check-in's accounts so logging a new one is
// just "update the numbers," not "retype every account name again" — the
// same low-friction idea as a quick weight-log popup, applied to a
// multi-field entry instead of a single number.
export function openNetWorthQuickLog({ networth, onSaved }) {
  const sorted = [...(networth || [])].sort((a, b) => b.date.localeCompare(a.date))
  const latest = sorted[0]
  const seedItems = latest?.items?.length
    ? latest.items.map(i => ({ name: i.name, category: i.category, value: '' }))
    : [{ name: '', category: 'cash', value: '' }]

  let items = seedItems
  let date = todayISO()

  const overlay = document.createElement('div')
  overlay.className = 'confirm-overlay'
  document.getElementById('app').appendChild(overlay)

  function render() {
    overlay.innerHTML = `
      <div class="confirm-box nwq-box">
        <div class="nwq-title">💰 Log Net Worth</div>
        <div class="nwq-sub">${latest ? 'Update each balance below' : 'Add your accounts and balances'}</div>
        <label class="nwq-date-label">Date
          <input type="date" id="nwqDate" value="${date}" />
        </label>
        <div class="nwq-rows">
          ${items.map((it, i) => `
            <div class="nw-item-row" data-index="${i}">
              <input class="nwItemName" type="text" placeholder="e.g. KBANK Savings" value="${escapeHtml(it.name)}" />
              <select class="nwItemCategory">
                <option value="cash" ${it.category === 'cash' ? 'selected' : ''}>Cash</option>
                <option value="invested" ${it.category === 'invested' ? 'selected' : ''}>Invested</option>
              </select>
              <input class="nwItemValue" type="number" inputmode="decimal" placeholder="0" value="${escapeHtml(it.value)}" />
              <button class="nwItemRemove" type="button" ${items.length <= 1 ? 'disabled' : ''}>✕</button>
            </div>
          `).join('')}
        </div>
        <button class="btn secondary" id="nwqAddItem" style="margin-top:4px">+ Add Account</button>
        <div class="confirm-actions" style="margin-top:16px">
          <button class="btn secondary" id="nwqCancel">Cancel</button>
          <button class="btn" id="nwqSave">Save</button>
        </div>
      </div>
    `
    wire()
    const firstValue = overlay.querySelector('.nwItemValue')
    if (firstValue) setTimeout(() => firstValue.focus(), 80)
  }

  function wire() {
    overlay.querySelector('#nwqDate').oninput = e => { date = e.target.value }
    overlay.querySelector('#nwqCancel').onclick = close
    overlay.onclick = (e) => { if (e.target === overlay) close() }

    overlay.querySelectorAll('.nw-item-row').forEach(row => {
      const i = Number(row.dataset.index)
      row.querySelector('.nwItemName').oninput = e => { items[i].name = e.target.value }
      row.querySelector('.nwItemCategory').onchange = e => { items[i].category = e.target.value }
      row.querySelector('.nwItemValue').oninput = e => { items[i].value = e.target.value }
      row.querySelector('.nwItemValue').onkeydown = e => { if (e.key === 'Enter') save() }
      row.querySelector('.nwItemRemove').onclick = () => { items.splice(i, 1); render() }
    })

    overlay.querySelector('#nwqAddItem').onclick = () => {
      items.push({ name: '', category: 'cash', value: '' })
      render()
    }
    overlay.querySelector('#nwqSave').onclick = save
  }

  async function save() {
    const cleaned = items
      .map(it => ({ name: it.name.trim(), category: it.category, value: parseFloat(it.value) || 0 }))
      .filter(it => it.name)
    if (!date) { toast('Pick a date'); return }
    if (!cleaned.length) { toast('Add at least one named account'); return }
    const btn = overlay.querySelector('#nwqSave')
    btn.disabled = true
    btn.textContent = 'Saving…'
    try {
      await addNetWorth({ date, items: cleaned })
      toast('Net worth logged')
      close()
      await onSaved()
    } catch (e) {
      toast(e.message || 'Failed to save')
      btn.disabled = false
      btn.textContent = 'Save'
    }
  }

  function close() { overlay.remove() }

  render()
}
