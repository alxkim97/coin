import { FREQUENCIES } from './categories.js'
import { frequencyLabel, dmyDateFieldHtml, wireDmyDateField } from './helpers.js'

// Shared by quickAdd.js's inline "Also save as repeat purchase" card and
// recurringFormDialog.js's standalone add/edit popup — the part of a repeat
// purchase that's genuinely identical in both places: how often it recurs,
// and (for Remind items) how many payments. Each caller still owns its own
// type/category/vendor/amount fields and its own save/delete logic — those
// aren't shared since quickAdd borrows them from the transaction already on
// screen, while the standalone dialog has no transaction to borrow from.
// `state` fields use the same snake_case names as the coin_recurring payload
// (mode, frequency, next_due, installments_total, installments_paid) so
// callers can pass their form object straight through with no adapter.
export function recurScheduleHtml(state, { showNextDue, showInstallmentsPaid }) {
  const { mode, frequency, next_due, installments_total, installments_paid } = state
  return `
    <label>Mode</label>
    <div class="toggle-row" id="recurModeToggle">
      <button type="button" data-mode="auto" class="${mode === 'auto' ? 'active' : ''}">Automatic</button>
      <button type="button" data-mode="remind" class="${mode === 'remind' ? 'active' : ''}">Remind</button>
      <button type="button" data-mode="quick" class="${mode === 'quick' ? 'active' : ''}">Quick Pick</button>
    </div>
    ${mode === 'auto' || mode === 'remind' ? `
      <label>Frequency</label>
      <select id="recurFrequency">
        ${FREQUENCIES.map(f => `<option value="${f}" ${f === frequency ? 'selected' : ''}>${frequencyLabel(f)}</option>`).join('')}
      </select>
      ${showNextDue ? `<label>Next Due</label>${dmyDateFieldHtml('recurNextDue', next_due)}` : ''}
      ${mode === 'auto' ? `
        <div style="font-size:12px;color:var(--text2);margin-top:8px">Posts automatically as a real transaction the next time you open Coin on or after this date.</div>
      ` : `
        <label>Number of Payments (optional)</label>
        <input id="recurInstallmentsTotal" type="number" inputmode="numeric" min="1" placeholder="Leave blank if ongoing" value="${installments_total != null ? installments_total : ''}" />
        ${showInstallmentsPaid ? `
          <label>Already Paid (optional)</label>
          <input id="recurInstallmentsPaid" type="number" inputmode="numeric" min="0" placeholder="0" value="${installments_paid || ''}" />
          <div style="font-size:12px;color:var(--text2);margin-top:4px">Set this if you're logging an installment plan that's already partway through — e.g. 3 if you've paid 3 of 10 outside Coin so far.</div>
        ` : ''}
        <div style="font-size:12px;color:var(--text2);margin-top:8px">Shows under Bills Due on the Dashboard when due — you confirm the amount and mark it paid, nothing posts on its own.${installments_total ? ` Stops reminding after ${installments_total} payments${installments_paid ? ` (${installments_paid} so far)` : ''}.` : ' Leave the payment count blank for something ongoing, like rent — set it (e.g. 10) for a fixed-term installment that should stop itself.'}</div>
      `}
    ` : `
      <div style="font-size:12px;color:var(--text2);margin-top:8px">Shows up as a one-tap shortcut on the Add screen — nothing posts until you tap it there.</div>
    `}
  `
}

// `state` is mutated in place (same pattern as netWorthForm.js's item rows) —
// `onChange` re-renders (mode changes which fields show), `onNextDueChange`
// only applies when `showNextDue` was used to render this instance.
export function wireRecurSchedule(container, state, { onChange, onNextDueChange } = {}) {
  container.querySelectorAll('#recurModeToggle button').forEach(btn => {
    btn.onclick = () => { state.mode = btn.dataset.mode; onChange?.() }
  })
  container.querySelector('#recurFrequency')?.addEventListener('change', e => { state.frequency = e.target.value })
  if (container.querySelector('#recurNextDue') && onNextDueChange) wireDmyDateField(container, 'recurNextDue', onNextDueChange)
  container.querySelector('#recurInstallmentsTotal')?.addEventListener('input', e => {
    state.installments_total = e.target.value === '' ? null : parseInt(e.target.value, 10)
  })
  container.querySelector('#recurInstallmentsPaid')?.addEventListener('input', e => {
    state.installments_paid = e.target.value === '' ? 0 : parseInt(e.target.value, 10)
  })
}
