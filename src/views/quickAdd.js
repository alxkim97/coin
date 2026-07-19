import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, categoryBudgetType } from '../categories.js'
import { addTransaction, updateTransaction, deleteTransaction } from '../supabase.js'
import { todayISO, toast } from '../helpers.js'

export function renderQuickAdd(container, { onSaved, editingTxn }) {
  const isEdit = !!editingTxn
  let type = editingTxn?.type || 'expense'
  let category = editingTxn?.category || null
  let amount = editingTxn ? String(editingTxn.amount) : ''
  let date = editingTxn?.date || todayISO()
  let subcategory = editingTxn?.subcategory || ''
  let notes = editingTxn?.notes || ''

  function cats() {
    return type === 'expense' ? EXPENSE_CATEGORIES.map(c => c.name) : INCOME_CATEGORIES
  }

  function draw() {
    const categoryList = cats()
    container.innerHTML = `
      <div class="top-bar">
        <h1>${isEdit ? 'Edit Transaction' : 'Add Transaction'}</h1>
      </div>

      <div class="toggle-row" id="typeToggle">
        <button data-type="expense" class="${type === 'expense' ? 'active expense' : ''}">Expense</button>
        <button data-type="income" class="${type === 'income' ? 'active income' : ''}">Income</button>
      </div>

      <div class="card" style="margin-top:16px">
        <input class="amount-input" id="amountInput" type="number" inputmode="decimal" placeholder="0" value="${amount}" />
      </div>

      <label>Category</label>
      <div class="chip-grid" id="catGrid">
        ${categoryList.map(c => `<div class="chip ${c === category ? 'active' : ''}" data-cat="${c}">${c}</div>`).join('')}
      </div>

      <label>Vendor / Note</label>
      <input id="subInput" type="text" placeholder="e.g. Makro, Salary, Grab" value="${subcategory.replace(/"/g, '&quot;')}" />

      <label>Date</label>
      <input id="dateInput" type="date" value="${date}" />

      <label>Notes (optional)</label>
      <textarea id="notesInput" rows="2" placeholder="Anything else...">${notes}</textarea>

      <div style="margin-top:22px;display:flex;flex-direction:column;gap:10px">
        <button class="btn" id="saveBtn">${isEdit ? 'Save Changes' : 'Add Transaction'}</button>
        ${isEdit ? '<button class="btn secondary" id="cancelBtn">Cancel</button>' : ''}
        ${isEdit ? '<button class="btn danger" id="deleteBtn">Delete</button>' : ''}
      </div>
    `

    container.querySelectorAll('#typeToggle button').forEach(btn => {
      btn.onclick = () => {
        type = btn.dataset.type
        category = null
        draw()
      }
    })
    container.querySelectorAll('#catGrid .chip').forEach(chip => {
      chip.onclick = () => {
        category = chip.dataset.cat
        draw()
      }
    })
    container.querySelector('#amountInput').oninput = e => { amount = e.target.value }
    container.querySelector('#subInput').oninput = e => { subcategory = e.target.value }
    container.querySelector('#dateInput').oninput = e => { date = e.target.value }
    container.querySelector('#notesInput').oninput = e => { notes = e.target.value }
    container.querySelector('#saveBtn').onclick = save
    container.querySelector('#cancelBtn')?.addEventListener('click', () => onSaved())
    container.querySelector('#deleteBtn')?.addEventListener('click', async () => {
      if (!confirm('Delete this transaction?')) return
      try {
        await deleteTransaction(editingTxn.id)
        toast('Deleted')
        onSaved()
      } catch (e) {
        toast(e.message || 'Failed to delete')
      }
    })

    if (!isEdit) container.querySelector('#amountInput').focus()
  }

  async function save() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { toast('Enter a valid amount'); return }
    if (!category) { toast('Pick a category'); return }
    const btn = container.querySelector('#saveBtn')
    btn.disabled = true
    btn.textContent = 'Saving…'
    try {
      const payload = {
        type,
        amount: amt,
        date,
        category,
        subcategory: subcategory || null,
        notes: notes || null,
        budget_type: type === 'expense' ? categoryBudgetType(category) : null,
      }
      if (isEdit) {
        await updateTransaction(editingTxn.id, payload)
        toast('Transaction updated')
      } else {
        await addTransaction(payload)
        toast('Added')
      }
      onSaved()
    } catch (e) {
      toast(e.message || 'Failed to save')
      btn.disabled = false
      btn.textContent = isEdit ? 'Save Changes' : 'Add Transaction'
    }
  }

  draw()
}
