import { addTransaction, updateRecurring } from './supabase.js'
import { toast, todayISO, escapeHtml, dmyDateFieldHtml, wireDmyDateField } from './helpers.js'
import { computeMarkPaid } from './recurringReminders.js'

// Confirm-before-logging for a "Remind" bill — amount and date are editable
// (a utility bill varies month to month, and the actual pay date rarely
// matches the reminder date exactly) rather than blindly trusting the
// recurring item's stored amount the way Auto mode does.
export function openMarkPaidDialog({ item, onSaved }) {
  let amount = String(item.amount)
  let date = todayISO()

  const overlay = document.createElement('div')
  overlay.className = 'confirm-overlay'
  document.getElementById('app').appendChild(overlay)

  function render() {
    const progress = item.installments_total
      ? ` · payment ${(item.installments_paid || 0) + 1} of ${item.installments_total}`
      : ''
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="nwq-title">✅ Mark Paid</div>
        <div class="nwq-sub">${escapeHtml(item.subcategory || item.category)}${progress}</div>
        <div class="nwq-date-label">Amount</div>
        <input id="mpAmount" type="number" inputmode="decimal" value="${amount}" style="margin-bottom:12px" />
        <div class="nwq-date-label">Date</div>
        ${dmyDateFieldHtml('mpDate', date)}
        <div class="confirm-actions" style="margin-top:16px">
          <button class="btn secondary" id="mpCancel">Cancel</button>
          <button class="btn" id="mpConfirm">Confirm</button>
        </div>
      </div>
    `
    overlay.querySelector('#mpAmount').oninput = e => { amount = e.target.value }
    overlay.querySelector('#mpAmount').onkeydown = e => { if (e.key === 'Enter') confirm() }
    wireDmyDateField(overlay, 'mpDate', v => { date = v })
    overlay.querySelector('#mpCancel').onclick = close
    overlay.onclick = e => { if (e.target === overlay) close() }
    overlay.querySelector('#mpConfirm').onclick = confirm
  }

  async function confirm() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { toast('Enter a valid amount'); return }
    if (!date) { toast('Pick a date'); return }
    const btn = overlay.querySelector('#mpConfirm')
    btn.disabled = true
    btn.textContent = 'Saving…'
    const { transaction, recurringPatch, isDone } = computeMarkPaid(item, { amount: amt, date })
    try {
      await addTransaction(transaction)
      await updateRecurring(item.id, recurringPatch)
    } catch (e) {
      toast(e.message || 'Failed to save')
      btn.disabled = false
      btn.textContent = 'Confirm'
      return
    }
    toast(isDone ? 'Marked paid — final installment, reminder stopped' : 'Marked paid')
    close()
    try {
      await onSaved()
    } catch (e) {
      console.error('Marked paid, but refreshing the view failed', e)
    }
  }

  function close() { overlay.remove() }

  render()
}
