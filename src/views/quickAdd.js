import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, categoryBudgetType, CATEGORY_ICONS } from '../categories.js'
import { addTransaction, updateTransaction, deleteTransaction, addRecurring } from '../supabase.js'
import { todayISO, toast, confirmDialog, formatMoney, escapeHtml, advanceDate, frequencyLabel } from '../helpers.js'

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'annually']

// Builds a searchable "known items" list from vendor names you've actually used
// before (transaction history) plus anything saved as a repeat purchase —
// same idea as NutriLog's food database: type a few letters, tap a match,
// category/vendor/amount all fill in at once.
function buildItemIndex(txns, recurring) {
  const map = new Map()
  const sorted = [...(txns || [])].sort((a, b) => b.date.localeCompare(a.date))
  for (const t of sorted) {
    if (!t.subcategory) continue
    const key = `${t.type}::${t.subcategory.toLowerCase()}`
    if (!map.has(key)) map.set(key, { type: t.type, subcategory: t.subcategory, category: t.category, amount: t.amount })
  }
  for (const r of (recurring || [])) {
    if (!r.subcategory) continue
    const key = `${r.type}::${r.subcategory.toLowerCase()}`
    if (!map.has(key)) map.set(key, { type: r.type, subcategory: r.subcategory, category: r.category, amount: r.amount })
  }
  return [...map.values()]
}

export function renderQuickAdd(container, { onSaved, editingTxn, recurring, txns }) {
  const isEdit = !!editingTxn
  let type = editingTxn?.type || 'expense'
  let category = editingTxn?.category || null
  let amount = editingTxn ? String(editingTxn.amount) : ''
  let date = editingTxn?.date || todayISO()
  let subcategory = editingTxn?.subcategory || ''
  let notes = editingTxn?.notes || ''
  let saveAsRecurring = false
  let recurMode = 'auto'
  let recurFrequency = 'monthly'
  let isCreditCard = editingTxn?.is_credit_card || false

  const itemIndex = buildItemIndex(txns, recurring)

  function cats() {
    return type === 'expense' ? EXPENSE_CATEGORIES.map(c => c.name) : INCOME_CATEGORIES
  }

  function quickItems() {
    return (recurring || []).filter(r => r.active && r.mode === 'quick' && r.type === type)
  }

  function draw() {
    const categoryList = cats()
    const quicks = isEdit ? [] : quickItems()
    container.innerHTML = `
      <div class="top-bar">
        <h1>${isEdit ? 'Edit Transaction' : 'Add Transaction'}</h1>
      </div>

      <div class="toggle-row" id="typeToggle">
        <button data-type="expense" class="${type === 'expense' ? 'active expense' : ''}">Expense</button>
        <button data-type="income" class="${type === 'income' ? 'active income' : ''}">Income</button>
      </div>

      ${quicks.length ? `
        <label>Frequently Used</label>
        <div class="quick-chip-row" id="quickChips">
          ${quicks.map(r => `
            <button type="button" class="quick-chip" data-id="${r.id}">
              <span class="qc-name">${CATEGORY_ICONS[r.category] || '💵'} ${escapeHtml(r.subcategory || r.category)}</span>
              <span class="qc-amt">${formatMoney(r.amount)}</span>
            </button>
          `).join('')}
        </div>
      ` : ''}

      <div class="card" style="margin-top:16px">
        <input class="amount-input" id="amountInput" type="number" inputmode="decimal" placeholder="0" value="${amount}" />
      </div>

      <label>Category</label>
      <div class="chip-grid" id="catGrid">
        ${categoryList.map(c => `<div class="chip ${c === category ? 'active' : ''}" data-cat="${c}">${c}</div>`).join('')}
      </div>

      <label>Vendor / Note</label>
      <div class="vendor-field">
        <input id="subInput" type="text" placeholder="Type to search past vendors, e.g. GLD" value="${subcategory.replace(/"/g, '&quot;')}" autocomplete="off" />
        <div class="vendor-suggestions" id="vendorSuggestions"></div>
      </div>

      <label>Date</label>
      <input id="dateInput" type="date" value="${date}" />

      <label>Notes (optional)</label>
      <textarea id="notesInput" rows="2" placeholder="Anything else...">${notes}</textarea>

      ${type === 'expense' ? `
        <label class="checkbox-row" style="margin-top:16px">
          <input type="checkbox" id="isCreditCard" ${isCreditCard ? 'checked' : ''} />
          <span>💳 Paid via credit card</span>
        </label>
      ` : ''}

      <div class="card" style="margin-top:16px">
        <label class="checkbox-row" style="margin-top:0">
          <input type="checkbox" id="saveAsRecurring" ${saveAsRecurring ? 'checked' : ''} />
          <span>Also save as Repeat Purchase</span>
        </label>
        ${saveAsRecurring ? `
          <div class="toggle-row" id="recurModeToggle" style="margin-top:12px">
            <button type="button" data-mode="auto" class="${recurMode === 'auto' ? 'active' : ''}">Automatic</button>
            <button type="button" data-mode="quick" class="${recurMode === 'quick' ? 'active' : ''}">Quick Pick</button>
          </div>
          ${recurMode === 'auto' ? `
            <label>Frequency</label>
            <select id="recurFrequency">
              ${FREQUENCIES.map(f => `<option value="${f}" ${f === recurFrequency ? 'selected' : ''}>${frequencyLabel(f)}</option>`).join('')}
            </select>
          ` : `<div style="font-size:12px;color:var(--text2);margin-top:8px">Shows up as a one-tap chip under Frequently Used — you log it manually each time.</div>`}
        ` : ''}
      </div>

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
    container.querySelectorAll('#quickChips .quick-chip').forEach(chip => {
      chip.onclick = () => {
        const r = quicks.find(q => q.id === chip.dataset.id)
        if (!r) return
        category = r.category
        subcategory = r.subcategory || ''
        amount = String(r.amount)
        draw()
        container.querySelector('#amountInput')?.focus()
      }
    })
    container.querySelectorAll('#catGrid .chip').forEach(chip => {
      chip.onclick = () => {
        category = chip.dataset.cat
        draw()
      }
    })
    container.querySelector('#amountInput').oninput = e => { amount = e.target.value }

    const subInput = container.querySelector('#subInput')
    const suggBox = container.querySelector('#vendorSuggestions')
    function closeSuggestions() {
      suggBox.innerHTML = ''
      suggBox.classList.remove('open')
    }
    function openSuggestions() {
      const q = subcategory.trim().toLowerCase()
      if (!q) { closeSuggestions(); return }
      const matches = itemIndex.filter(it => it.type === type && it.subcategory.toLowerCase().includes(q)).slice(0, 6)
      if (!matches.length) { closeSuggestions(); return }
      suggBox.classList.add('open')
      suggBox.innerHTML = matches.map(it => `
        <div class="vendor-suggestion" data-sub="${escapeHtml(it.subcategory)}" data-cat="${escapeHtml(it.category)}" data-amt="${it.amount}">
          <span class="vsg-icon">${CATEGORY_ICONS[it.category] || '💵'}</span>
          <span class="vsg-name">${escapeHtml(it.subcategory)}</span>
          <span class="vsg-cat">${escapeHtml(it.category)}</span>
        </div>
      `).join('')
      suggBox.querySelectorAll('.vendor-suggestion').forEach(row => {
        row.onclick = () => {
          subcategory = row.dataset.sub
          category = row.dataset.cat
          amount = row.dataset.amt
          draw()
          container.querySelector('#amountInput')?.focus()
        }
      })
    }
    subInput.oninput = e => { subcategory = e.target.value; openSuggestions() }
    subInput.addEventListener('focus', openSuggestions)
    // delay so a click on a suggestion still registers before the list disappears
    subInput.addEventListener('blur', () => setTimeout(closeSuggestions, 150))

    container.querySelector('#dateInput').oninput = e => { date = e.target.value }
    container.querySelector('#notesInput').oninput = e => { notes = e.target.value }
    container.querySelector('#isCreditCard')?.addEventListener('change', e => { isCreditCard = e.target.checked })
    container.querySelector('#saveAsRecurring').onchange = e => { saveAsRecurring = e.target.checked; draw() }
    container.querySelectorAll('#recurModeToggle button').forEach(btn => {
      btn.onclick = () => { recurMode = btn.dataset.mode; draw() }
    })
    container.querySelector('#recurFrequency')?.addEventListener('change', e => { recurFrequency = e.target.value })
    container.querySelector('#saveBtn').onclick = save
    container.querySelector('#cancelBtn')?.addEventListener('click', () => onSaved())
    container.querySelector('#deleteBtn')?.addEventListener('click', async () => {
      const ok = await confirmDialog('Delete this transaction?', 'Delete', true)
      if (!ok) return
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
        is_credit_card: type === 'expense' ? isCreditCard : false,
      }
      if (isEdit) {
        await updateTransaction(editingTxn.id, payload)
      } else {
        await addTransaction(payload)
      }
      let msg = isEdit ? 'Transaction updated' : 'Added'
      if (saveAsRecurring) {
        try {
          await addRecurring({
            type,
            category,
            subcategory: subcategory || null,
            amount: amt,
            mode: recurMode,
            frequency: recurMode === 'auto' ? recurFrequency : null,
            next_due: recurMode === 'auto' ? advanceDate(date, recurFrequency) : null,
            active: true,
          })
          msg += ' · saved as repeat purchase'
        } catch (e) {
          msg += ' — but repeat purchase setup failed'
        }
      }
      toast(msg)
      onSaved()
    } catch (e) {
      toast(e.message || 'Failed to save')
      btn.disabled = false
      btn.textContent = isEdit ? 'Save Changes' : 'Add Transaction'
    }
  }

  draw()
}
