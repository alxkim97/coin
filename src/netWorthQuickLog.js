import { addNetWorth } from './supabase.js'
import { toast, todayISO, dmyDateFieldHtml, wireDmyDateField } from './helpers.js'
import { latestAccountValues } from './analysisData.js'
import { seedNetWorthItems, netWorthItemRowsHtml, wireNetWorthItemRows, cleanNetWorthItems } from './netWorthForm.js'

// Pre-fills from every account's latest known value across ALL check-ins —
// not just whichever check-in happened to be most recent — so logging just
// your banks today and your investments next week still carries the other
// half forward instead of dropping it. Same low-friction idea as a quick
// weight-log popup, applied to a multi-field entry instead of a single number.
export function openNetWorthQuickLog({ networth, onSaved }) {
  const known = latestAccountValues(networth)
  let items = seedNetWorthItems(known)
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
          ${netWorthItemRowsHtml(items)}
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

    wireNetWorthItemRows(overlay, items, { onChange: render, onEnter: save })

    overlay.querySelector('#nwqAddItem').onclick = () => {
      items.push({ name: '', category: 'cash', value: '', lastValue: null })
      focusTarget = { index: items.length - 1, field: 'name' }
      render()
    }
    overlay.querySelector('#nwqSave').onclick = save
  }

  async function save() {
    const cleaned = cleanNetWorthItems(items)
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
