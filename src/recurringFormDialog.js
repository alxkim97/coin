import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from './categories.js'
import { addRecurring, updateRecurring, deleteRecurring } from './supabase.js'
import { toast, confirmDialog, escapeHtml, todayISO } from './helpers.js'
import { recurScheduleHtml, wireRecurSchedule } from './recurringScheduleFields.js'

// Same markPaidDialog.js/netWorthCheckins.js overlay pattern — a self-closing
// popup appended straight to document.body, rather than an inline form that pushes
// the Repeat Purchases list down the page. `item` is an existing coin_recurring
// row to edit, or null/undefined to create a new one.
export function openRecurringForm({ item, onSaved }) {
  const form = item ? {
    id: item.id, type: item.type, category: item.category, subcategory: item.subcategory || '',
    amount: String(item.amount), mode: item.mode, frequency: item.frequency || 'monthly', next_due: item.next_due || todayISO(),
    installments_total: item.installments_total ?? null,
    installments_paid: item.installments_paid || 0,
    is_credit_card: item.is_credit_card || false,
    is_shopee: item.is_shopee || false,
  } : {
    id: null, type: 'expense', category: null, subcategory: '', amount: '', mode: 'auto', frequency: 'monthly',
    next_due: todayISO(), installments_total: null, installments_paid: 0, is_credit_card: false, is_shopee: false,
  }

  const overlay = document.createElement('div')
  overlay.className = 'confirm-overlay'
  document.body.appendChild(overlay)

  function render() {
    const categoryList = form.type === 'expense' ? EXPENSE_CATEGORIES.map(c => c.name) : INCOME_CATEGORIES
    overlay.innerHTML = `
      <div class="confirm-box modal-box-lg">
        <div class="nwq-title">${form.id ? 'Edit' : 'New'} Repeat Purchase</div>

        <div class="toggle-row" id="recTypeToggle">
          <button type="button" data-type="expense" class="${form.type === 'expense' ? 'active expense' : ''}">Expense</button>
          <button type="button" data-type="income" class="${form.type === 'income' ? 'active income' : ''}">Income</button>
        </div>

        <label>Category</label>
        <div class="chip-grid" id="recCatGrid">
          ${categoryList.map(c => `<div class="chip ${c === form.category ? 'active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</div>`).join('')}
        </div>

        <label>Vendor / Note</label>
        <input id="recSub" type="text" placeholder="e.g. Condo, AIA Insurance" value="${escapeHtml(form.subcategory)}" />

        <label>Amount</label>
        <input id="recAmount" type="number" inputmode="decimal" placeholder="0" value="${escapeHtml(form.amount)}" />

        ${recurScheduleHtml(form, { showNextDue: true, showInstallmentsPaid: !form.id })}

        ${form.type === 'expense' ? `
          <label class="checkbox-row" style="margin-top:16px">
            <input type="checkbox" id="recIsCreditCard" ${form.is_credit_card ? 'checked' : ''} />
            <span>💳 Paid via credit card</span>
          </label>
          <label class="checkbox-row" style="margin-top:8px">
            <input type="checkbox" id="recIsShopee" ${form.is_shopee ? 'checked' : ''} />
            <span>🛍️ Bought via Shopee</span>
          </label>
        ` : ''}

        <div class="confirm-actions" style="margin-top:16px">
          <button class="btn secondary" id="recCancel">Cancel</button>
          <button class="btn" id="recSave">${form.id ? 'Save Changes' : 'Add'}</button>
          ${form.id ? '<button class="btn danger" id="recDelete">Delete</button>' : ''}
        </div>
      </div>
    `
    wire()
  }

  function wire() {
    overlay.onclick = e => { if (e.target === overlay) close() }

    overlay.querySelectorAll('#recTypeToggle button').forEach(btn => {
      btn.onclick = () => { form.type = btn.dataset.type; form.category = null; render() }
    })
    overlay.querySelectorAll('#recCatGrid .chip').forEach(chip => {
      chip.onclick = () => { form.category = chip.dataset.cat; render() }
    })
    overlay.querySelector('#recSub').oninput = e => { form.subcategory = e.target.value }
    overlay.querySelector('#recAmount').oninput = e => { form.amount = e.target.value }
    wireRecurSchedule(overlay, form, {
      onChange: render,
      onNextDueChange: v => { form.next_due = v },
    })
    overlay.querySelector('#recIsCreditCard')?.addEventListener('change', e => { form.is_credit_card = e.target.checked })
    overlay.querySelector('#recIsShopee')?.addEventListener('change', e => { form.is_shopee = e.target.checked })

    overlay.querySelector('#recCancel').onclick = close

    overlay.querySelector('#recSave').onclick = async () => {
      const amt = parseFloat(form.amount)
      if (!amt || amt <= 0) { toast('Enter a valid amount'); return }
      if (!form.category) { toast('Pick a category'); return }
      const btn = overlay.querySelector('#recSave')
      btn.disabled = true
      btn.textContent = 'Saving…'
      try {
        const payload = {
          type: form.type,
          category: form.category,
          subcategory: form.subcategory || null,
          amount: amt,
          mode: form.mode,
          frequency: form.mode === 'auto' || form.mode === 'remind' ? form.frequency : null,
          next_due: form.mode === 'auto' || form.mode === 'remind' ? form.next_due : null,
          installments_total: form.mode === 'remind' ? (form.installments_total || null) : null,
          installments_paid: form.installments_paid || 0,
          active: true,
          is_credit_card: form.type === 'expense' ? !!form.is_credit_card : false,
          is_shopee: form.type === 'expense' ? !!form.is_shopee : false,
        }
        if (form.id) {
          await updateRecurring(form.id, payload)
          toast('Saved')
        } else {
          await addRecurring(payload)
          toast('Added')
        }
        close()
        await onSaved()
      } catch (e) {
        toast(e.message || 'Failed to save')
        btn.disabled = false
        btn.textContent = form.id ? 'Save Changes' : 'Add'
      }
    }

    overlay.querySelector('#recDelete')?.addEventListener('click', async () => {
      const ok = await confirmDialog('Delete this repeat purchase?', 'Delete', true)
      if (!ok) return
      try {
        await deleteRecurring(form.id)
        toast('Deleted')
        close()
        await onSaved()
      } catch (e) {
        toast(e.message || 'Failed to delete')
      }
    })
  }

  function close() { overlay.remove() }

  render()
}
