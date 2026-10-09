import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, categoryBudgetType } from '../categories.js'
import { addTransaction, updateTransaction, deleteTransaction, addRecurring, uploadReceipt, getReceiptUrl, deleteReceipt } from '../supabase.js'
import { todayISO, toast, confirmDialog, formatMoney, escapeHtml, advanceDate, dmyDateFieldHtml, wireDmyDateField, sortByDateDesc } from '../helpers.js'
import { isDesktopView } from '../platform.js'
import { recurScheduleHtml, wireRecurSchedule } from '../recurringScheduleFields.js'
import { openRecurringList } from '../recurringListDialog.js'
import { icon, categoryIcon } from '../icons.js'

// The transaction's own date can be freely backdated (backfilling an old
// bill, say). Seeding next_due from a single advanceDate() off that date
// left it in the past whenever the entry was backdated more than one period
// — processRecurring's catch-up loop then fires on the very next launch and
// posts one transaction per missed period, none of which the user asked
// for. Fast-forward instead: first occurrence on or after today.
function firstDueOnOrAfter(date, frequency) {
  let due = advanceDate(date, frequency)
  const today = todayISO()
  while (due < today) due = advanceDate(due, frequency)
  return due
}

// Builds a searchable "known items" list from vendor names you've actually used
// before (transaction history) plus anything saved as a repeat purchase —
// same idea as NutriLog's food database: type a few letters, tap a match,
// category/vendor/amount all fill in at once.
function buildItemIndex(txns, recurring) {
  const map = new Map()
  const sorted = sortByDateDesc(txns || [])
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

export function renderQuickAdd(container, { onSaved, editingTxn, recurring, txns, onRecurringChanged }) {
  const isEdit = !!editingTxn
  let type = editingTxn?.type || 'expense'
  let category = editingTxn?.category || null
  let amount = editingTxn ? String(editingTxn.amount) : ''
  let date = editingTxn?.date || todayISO()
  let subcategory = editingTxn?.subcategory || ''
  let notes = editingTxn?.notes || ''
  let saveAsRecurring = false
  // shape matches coin_recurring's own field names (and recurringScheduleFields.js's
  // expected state shape) so it can be handed straight to the shared component —
  // next_due/installments_paid are unused here (showNextDue/showInstallmentsPaid
  // are both false for this card; next_due is computed from the transaction's
  // own date on save instead, installments_paid always starts at 1 for Remind)
  let recurForm = { mode: 'auto', frequency: 'monthly', next_due: null, installments_total: null, installments_paid: 0 }
  let isCreditCard = editingTxn?.is_credit_card || false
  let isShopee = editingTxn?.is_shopee || false
  let tags = editingTxn?.tags || []
  // collapsed by default — keeps the common case (no tags) exactly as lean
  // as it was before this existed, only editing an already-tagged entry
  // (or tapping "+ Add tags") expands it
  let showTagInput = tags.length > 0
  // Mobile-only disclosure (desktop always shows these fields inline — see
  // draw()). Collapsed by default to keep the fast-entry path (type, amount,
  // category, vendor, date) front and center, but auto-expanded when editing
  // an entry that already has notes/receipt/tags, so editing never hides
  // data the user is actively trying to change behind an extra tap.
  let showMoreDetails = !!(editingTxn?.notes || editingTxn?.receipt_path || tags.length)
  let receiptFile = null // a freshly-picked File, not yet uploaded — upload happens on save, not on pick
  let receiptPreviewUrl = null // object URL (fresh pick) or signed URL (existing receipt_path), for the <img>
  let receiptPath = editingTxn?.receipt_path || null
  let removeReceipt = false // marks an existing receipt for deletion on save, without touching receiptPath until then

  // Kicked off once here (not inside draw(), which reruns on every field
  // change) — resolves into receiptPreviewUrl and triggers one redraw once
  // the signed URL is ready. draw() isn't defined yet at this point in the
  // file, but it's a hoisted function declaration and this only actually
  // runs later, after the promise settles, well after draw() exists.
  if (receiptPath) {
    getReceiptUrl(receiptPath).then(url => { receiptPreviewUrl = url; draw() }).catch(() => {})
  }

  const itemIndex = buildItemIndex(txns, recurring)

  function cats() {
    return type === 'expense' ? EXPENSE_CATEGORIES.map(c => c.name) : INCOME_CATEGORIES
  }

  // The full chip list (15 expense categories) reads as busy, so show the 6
  // used most in the last 180 days — kept in the usual category order for
  // muscle memory — plus a More chip. The selected category always shows.
  let showAllCats = false
  function visibleCats() {
    const all = cats()
    if (showAllCats || all.length <= 6) return all
    const since = new Date(); since.setDate(since.getDate() - 180)
    const sinceStr = since.toISOString().slice(0, 10)
    const counts = {}
    for (const t of txns || []) if (t.type === type && t.date >= sinceStr) counts[t.category] = (counts[t.category] || 0) + 1
    const top = new Set([...all].sort((a, b) => (counts[b] || 0) - (counts[a] || 0)).slice(0, 6))
    if (category) top.add(category)
    return all.filter(c => top.has(c))
  }

  function quickItems() {
    return (recurring || []).filter(r => r.active && r.mode === 'quick' && r.type === type)
  }

  function draw() {
    const categoryList = cats()
    const quicks = isEdit ? [] : quickItems()
    const mobile = !isDesktopView()

    // Notes/Tags/Receipt/card-source/Repeat-Purchase — the occasional fields,
    // as opposed to the type/amount/category/vendor/date fast-entry path
    // above. On desktop these render inline, unconditionally, exactly as
    // before this block was extracted. On mobile they're gated behind the
    // "More details" disclosure below instead (see the mobile ? ... branch
    // further down) — same markup either way, just wrapped differently, so
    // none of the event wiring beneath this function needs to change.
    const moreDetailsHtml = `
      <label>Notes (optional)</label>
      <textarea id="notesInput" rows="2" placeholder="Anything else...">${notes}</textarea>

      ${showTagInput ? `
        <label>Tags (optional)</label>
        ${tags.length ? `
          <div class="chip-grid" id="tagChips" style="margin-bottom:8px">
            ${tags.map(t => `<span class="chip active" data-tag="${escapeHtml(t)}">${escapeHtml(t)} ${icon('x', 12)}</span>`).join('')}
          </div>
        ` : ''}
        <input id="tagInput" type="text" placeholder="Type a tag, press Enter" autocomplete="off" />
      ` : `
        <button type="button" class="link-btn" id="showTagInputBtn" style="margin-top:2px">+ Add tags</button>
      `}

      <label>Receipt (optional)</label>
      ${(receiptFile || (receiptPath && !removeReceipt)) ? `
        <div class="receipt-preview">
          <img id="receiptPreview" src="${receiptPreviewUrl || ''}" alt="Receipt" />
          <button type="button" class="link-btn" id="removeReceiptBtn">Remove</button>
        </div>
      ` : `
        <input type="file" accept="image/*" capture="environment" id="receiptInput" style="display:none" />
        <button type="button" class="btn secondary" id="pickReceiptBtn" style="width:auto">${icon('camera', 16)} Add receipt photo</button>
      `}

      ${type === 'expense' ? `
        <label class="checkbox-row" style="margin-top:16px">
          <input type="checkbox" id="isCreditCard" ${isCreditCard ? 'checked' : ''} />
          <span>Paid via credit card</span>
        </label>
        <label class="checkbox-row" style="margin-top:8px">
          <input type="checkbox" id="isShopee" ${isShopee ? 'checked' : ''} />
          <span>Bought via Shopee</span>
        </label>
      ` : ''}

      <div class="card" style="margin-top:16px">
        <label class="checkbox-row" style="margin-top:0">
          <input type="checkbox" id="saveAsRecurring" ${saveAsRecurring ? 'checked' : ''} />
          <span>Also save as repeat purchase</span>
        </label>
        ${saveAsRecurring ? recurScheduleHtml(recurForm, { showNextDue: false, showInstallmentsPaid: false }) : ''}
        <button type="button" class="link-btn" id="manageRecurringBtn" style="margin-top:12px">Manage repeat purchases</button>
      </div>
    `

    const headerHtml = `
      <div class="top-bar">
        <h1>${isEdit ? 'Edit transaction' : 'Add transaction'}</h1>
      </div>
    `

    const mainHtml = `
      <div class="toggle-row" id="typeToggle">
        <button data-type="expense" class="${type === 'expense' ? 'active expense' : ''}">Expense</button>
        <button data-type="income" class="${type === 'income' ? 'active income' : ''}">Income</button>
      </div>

      ${quicks.length ? `
        <label>Frequently used</label>
        <div class="quick-chip-row" id="quickChips">
          ${quicks.map(r => `
            <button type="button" class="quick-chip" data-id="${r.id}">
              <span class="qc-name">${categoryIcon(r.category, 14)} ${escapeHtml(r.subcategory || r.category)}</span>
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
        ${visibleCats().map(c => `<div class="chip ${c === category ? 'active' : ''}" data-cat="${c}">${c}</div>`).join('')}
        ${categoryList.length > 6 ? `<button type="button" class="chip chip-more" id="catMore">${showAllCats ? 'Fewer' : 'More'}</button>` : ''}
      </div>

      <label>Vendor / Note</label>
      <div class="vendor-field">
        <input id="subInput" type="text" placeholder="Type to search past vendors, e.g. GLD" value="${subcategory.replace(/"/g, '&quot;')}" autocomplete="off" />
        <div class="vendor-suggestions" id="vendorSuggestions"></div>
      </div>

      <label>Date</label>
      ${dmyDateFieldHtml('dateInput', date)}
    `

    const actionsHtml = `
      <div style="margin-top:22px;display:flex;flex-direction:column;gap:10px" class="qa-actions">
        <button class="btn" id="saveBtn">${isEdit ? 'Save changes' : 'Add transaction'}</button>
        ${!isEdit ? '<button class="btn secondary" id="saveAndAddBtn">Save & add another</button>' : ''}
        ${isEdit ? '<button class="btn secondary" id="cancelBtn">Cancel</button>' : ''}
        ${isEdit ? '<button class="btn danger" id="deleteBtn">Delete</button>' : ''}
      </div>
    `

    // Desktop lays the form out in two columns (fast-entry path + Save on
    // the left, the occasional fields on the right) so nothing needs a
    // scroll; mobile keeps its single column with the "More details" toggle.
    container.innerHTML = mobile ? `
      ${headerHtml}
      ${mainHtml}
      <button type="button" class="link-btn" id="moreDetailsBtn" style="margin-top:18px">${showMoreDetails ? 'Fewer details' : 'More details'}</button>
      <div id="moreDetailsBlock" ${showMoreDetails ? '' : 'hidden'}>${moreDetailsHtml}</div>
      ${actionsHtml}
    ` : `
      ${headerHtml}
      <div class="qa-desk">
        <div class="qa-col">${mainHtml}${actionsHtml}</div>
        <div class="qa-col qa-side"><div class="qa-side-title">Details <span>optional</span></div>${moreDetailsHtml}</div>
      </div>
    `

    container.querySelector('#moreDetailsBtn')?.addEventListener('click', () => {
      showMoreDetails = !showMoreDetails
      draw()
    })

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
    const catMore = container.querySelector('#catMore')
    if (catMore) catMore.onclick = () => { showAllCats = !showAllCats; draw() }
    container.querySelectorAll('#catGrid .chip[data-cat]').forEach(chip => {
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
          <span class="vsg-icon">${categoryIcon(it.category)}</span>
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

    wireDmyDateField(container, 'dateInput', v => { date = v })
    container.querySelector('#notesInput').oninput = e => { notes = e.target.value }
    container.querySelector('#showTagInputBtn')?.addEventListener('click', () => {
      showTagInput = true
      draw()
      container.querySelector('#tagInput')?.focus()
    })
    container.querySelectorAll('#tagChips .chip').forEach(chip => {
      chip.onclick = () => { tags = tags.filter(t => t !== chip.dataset.tag); draw() }
    })
    const tagInputEl = container.querySelector('#tagInput')
    if (tagInputEl) {
      tagInputEl.onkeydown = e => {
        if (e.key !== 'Enter' && e.key !== ',') return
        e.preventDefault()
        const v = tagInputEl.value.replace(/,$/, '').trim()
        if (v && !tags.some(t => t.toLowerCase() === v.toLowerCase())) {
          tags = [...tags, v]
          draw()
          container.querySelector('#tagInput')?.focus()
        } else {
          tagInputEl.value = ''
        }
      }
    }
    container.querySelector('#pickReceiptBtn')?.addEventListener('click', () => container.querySelector('#receiptInput').click())
    container.querySelector('#receiptInput')?.addEventListener('change', e => {
      const file = e.target.files[0]
      if (!file) return
      receiptFile = file
      receiptPreviewUrl = URL.createObjectURL(file)
      removeReceipt = false
      draw()
    })
    container.querySelector('#removeReceiptBtn')?.addEventListener('click', () => {
      if (receiptFile) {
        URL.revokeObjectURL(receiptPreviewUrl)
        receiptFile = null
        receiptPreviewUrl = null
      } else {
        removeReceipt = true
      }
      draw()
    })
    container.querySelector('#isCreditCard')?.addEventListener('change', e => { isCreditCard = e.target.checked })
    container.querySelector('#isShopee')?.addEventListener('change', e => { isShopee = e.target.checked })
    container.querySelector('#saveAsRecurring').onchange = e => { saveAsRecurring = e.target.checked; draw() }
    if (saveAsRecurring) wireRecurSchedule(container, recurForm, { onChange: draw })
    container.querySelector('#manageRecurringBtn').onclick = () => {
      openRecurringList({ recurring, onRecurringChanged })
    }
    container.querySelector('#saveBtn').onclick = () => save(false)
    container.querySelector('#saveAndAddBtn')?.addEventListener('click', () => save(true))
    container.querySelector('#cancelBtn')?.addEventListener('click', () => onSaved())
    container.querySelector('#deleteBtn')?.addEventListener('click', async () => {
      const ok = await confirmDialog('Delete this transaction?', 'Delete', true)
      if (!ok) return
      try {
        await deleteTransaction(editingTxn.id)
        if (editingTxn.receipt_path) deleteReceipt(editingTxn.receipt_path).catch(() => {}) // best-effort — an orphaned file is a much smaller problem than blocking the delete on it
        toast('Deleted')
        onSaved(false, null, { deleted: editingTxn }) // lets the desktop undo stack offer it back
      } catch (e) {
        toast(e.message || 'Failed to delete')
      }
    })

    if (!isEdit) container.querySelector('#amountInput').focus()
  }

  async function save(stayOnAdd) {
    // a tag typed but never confirmed with Enter shouldn't just vanish on save
    const danglingTag = container.querySelector('#tagInput')?.value.trim()
    if (danglingTag && !tags.some(t => t.toLowerCase() === danglingTag.toLowerCase())) tags = [...tags, danglingTag]

    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { toast('Enter a valid amount'); return }
    if (!category) { toast('Pick a category'); return }
    const btn = container.querySelector(stayOnAdd ? '#saveAndAddBtn' : '#saveBtn')
    const otherBtn = container.querySelector(stayOnAdd ? '#saveBtn' : '#saveAndAddBtn')
    btn.disabled = true
    btn.textContent = 'Saving…'
    if (otherBtn) otherBtn.disabled = true
    try {
      const payload = {
        type,
        amount: amt,
        date,
        category,
        subcategory: subcategory || null,
        notes: notes || null,
        tags,
        budget_type: type === 'expense' ? categoryBudgetType(category) : null,
        is_credit_card: type === 'expense' ? isCreditCard : false,
        is_shopee: type === 'expense' ? isShopee : false,
      }
      let savedTxn
      if (isEdit) {
        savedTxn = await updateTransaction(editingTxn.id, payload)
      } else {
        savedTxn = await addTransaction(payload)
      }
      let msg = isEdit ? 'Transaction updated' : 'Added'

      if (removeReceipt && receiptPath) {
        try {
          await deleteReceipt(receiptPath)
          await updateTransaction(savedTxn.id, { receipt_path: null })
          savedTxn = { ...savedTxn, receipt_path: null }
        } catch (e) {
          msg += ' — but removing the receipt failed'
        }
      } else if (receiptFile) {
        try {
          // savedTxn predates the upload — carry the new path so the list
          // shows the receipt badge right away, not after the next refresh
          savedTxn = { ...savedTxn, receipt_path: await uploadReceipt(savedTxn.id, receiptFile) }
          // replacing an existing receipt — best-effort cleanup of the old
          // file, after the new one is confirmed uploaded, not before
          if (receiptPath) deleteReceipt(receiptPath).catch(() => {})
        } catch (e) {
          msg += ' — but the receipt photo failed to upload'
        }
      }
      if (saveAsRecurring) {
        try {
          const isDated = recurForm.mode === 'auto' || recurForm.mode === 'remind'
          // this save() call is itself logging the first real payment, so a
          // Remind item starts already at "1 of N paid," due date advanced
          // to the next period — not "0 of N," which would double-count it
          const installmentsTotal = recurForm.mode === 'remind' ? recurForm.installments_total : null
          await addRecurring({
            type,
            category,
            subcategory: subcategory || null,
            amount: amt,
            mode: recurForm.mode,
            frequency: isDated ? recurForm.frequency : null,
            // 'auto' fast-forwards past a backdated date — auto items
            // self-post via processRecurring's catch-up loop, so a next_due
            // left in the past means a pile of unwanted duplicate
            // transactions on next launch. 'remind' items never auto-post
            // (a human confirms and marks them paid), so a backdated bill
            // correctly shows as due right away instead of being suppressed.
            next_due: recurForm.mode === 'auto' ? firstDueOnOrAfter(date, recurForm.frequency) : (isDated ? advanceDate(date, recurForm.frequency) : null),
            installments_total: installmentsTotal,
            installments_paid: recurForm.mode === 'remind' ? 1 : 0,
            active: !(recurForm.mode === 'remind' && installmentsTotal != null && installmentsTotal <= 1),
            is_credit_card: type === 'expense' ? isCreditCard : false,
            is_shopee: type === 'expense' ? isShopee : false,
          })
          msg += ' · saved as repeat purchase'
        } catch (e) {
          msg += ' — but repeat purchase setup failed'
        }
      }
      toast(stayOnAdd ? `${msg} · ready for the next one` : msg)
      // main.js's render() wipes #app immediately once onSaved runs, which
      // would cut off a CSS-class pulse mid-flight — awaiting the Web
      // Animations API's own finished promise guarantees it actually plays
      // out first instead of relying on incidental network-delay timing.
      try {
        await btn.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.06)', offset: 0.4 }, { transform: 'scale(1)' }],
          { duration: 320, easing: 'ease-out' }
        ).finished
      } catch { /* animation can't reject in practice, but never block the save on it */ }
      onSaved(stayOnAdd, savedTxn)
    } catch (e) {
      toast(e.message || 'Failed to save')
      btn.disabled = false
      btn.textContent = stayOnAdd ? 'Save & add another' : (isEdit ? 'Save changes' : 'Add transaction')
      if (otherBtn) otherBtn.disabled = false
    }
  }

  draw()
}
