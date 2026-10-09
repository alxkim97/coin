import { addTransaction, updateTransaction, deleteTransaction, deleteSuggestion } from './supabase.js'
import { categoryBudgetType } from './categories.js'
import { escapeHtml, formatMoney, formatDateDMY, toast } from './helpers.js'
import { icon, categoryIcon } from './icons.js'

// Suggestions come from Claude's helper account (scripts/coin-claude.js) and
// never change anything until Accept, which runs through YOUR session.
// action 'add' proposes a new transaction; 'edit' carries the full proposed
// values for target_id; 'delete' proposes removing target_id.
const FIELDS = ['type', 'amount', 'date', 'category', 'subcategory', 'notes', 'is_credit_card', 'is_shopee']

function proposedRow(s) {
  return {
    type: s.type,
    amount: s.amount,
    date: s.date,
    category: s.category,
    subcategory: s.subcategory || null,
    notes: s.notes || null,
    budget_type: s.type === 'expense' ? categoryBudgetType(s.category) : null,
    is_credit_card: s.is_credit_card || false,
    is_shopee: s.is_shopee || false,
    ...(s.tags ? { tags: s.tags } : {}),
  }
}

const LABELS = { type: 'type', amount: 'amount', date: 'date', category: 'category', subcategory: 'vendor', notes: 'note', is_credit_card: 'credit card', is_shopee: 'Shopee' }
function show(field, v) {
  if (field === 'amount') return formatMoney(v)
  if (field === 'date') return formatDateDMY(v)
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  return v == null || v === '' ? '—' : String(v)
}

// "amount ฿39 → ฿45 · category Food → Groceries"
function editSummary(s, target) {
  if (!target) return 'Transaction no longer exists'
  // compare normalized: '' and null are the same "empty", null flags are false
  const norm = (f, v) => f === 'amount' ? Number(v) : f.startsWith('is_') ? !!v : (v ?? '') === '' ? null : v
  const changes = FIELDS.filter(f => norm(f, target[f]) !== norm(f, s[f])).map(f => `${LABELS[f]} ${escapeHtml(show(f, target[f]))} → ${escapeHtml(show(f, s[f]))}`)
  return changes.length ? changes.join(' · ') : 'No changes'
}

export function suggestionRowsHtml(suggestions, txns, iconSize = 18, btnIconSize = 15) {
  if (!suggestions?.length) return '<div class="empty-state">No suggestions right now.</div>'
  const byId = new Map((txns || []).map(t => [t.id, t]))
  return suggestions.map(s => {
    const action = s.action || 'add'
    const target = s.target_id ? byId.get(s.target_id) : null
    const shown = action === 'delete' && target ? target : s
    const badge = action === 'edit' ? '<span class="suggestion-kind edit">Edit</span>' : action === 'delete' ? '<span class="suggestion-kind delete">Delete</span>' : ''
    return `
    <div class="suggestion-row">
      <div class="suggestion-icon">${categoryIcon(shown.category, iconSize)}</div>
      <div class="suggestion-main">
        <div class="suggestion-top">
          <span class="suggestion-cat">${badge}${escapeHtml(shown.category)}${shown.subcategory ? ' · ' + escapeHtml(shown.subcategory) : ''}</span>
          <span class="suggestion-amt ${shown.type}">${shown.type === 'income' ? '+' : '−'}${formatMoney(shown.amount)}</span>
        </div>
        <div class="suggestion-date">${formatDateDMY(shown.date)}${shown.notes ? ' · ' + escapeHtml(shown.notes) : ''}</div>
        ${action === 'edit' ? `<div class="suggestion-change">${editSummary(s, target)}</div>` : ''}
        ${s.source_note ? `<div class="suggestion-source">${escapeHtml(s.source_note)}</div>` : ''}
      </div>
      <div class="suggestion-actions">
        <button class="suggestion-decline" data-id="${s.id}" aria-label="Decline">${icon('x', btnIconSize)}</button>
        <button class="suggestion-accept" data-id="${s.id}" aria-label="Accept">${icon('check', btnIconSize)}</button>
      </div>
    </div>`
  }).join('')
}

async function accept(s) {
  const action = s.action || 'add'
  if (action === 'edit') await updateTransaction(s.target_id, proposedRow(s))
  else if (action === 'delete') await deleteTransaction(s.target_id)
  else await addTransaction(proposedRow(s))
  await deleteSuggestion(s.id)
  return action === 'edit' ? 'Updated' : action === 'delete' ? 'Deleted' : 'Added'
}

export function wireSuggestionActions(root, { suggestions, onSuggestionsChanged }) {
  root.querySelectorAll('.suggestion-accept').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const s = (suggestions || []).find(x => x.id === btn.dataset.id)
      if (!s) return
      btn.disabled = true
      try {
        toast(await accept(s))
        await onSuggestionsChanged()
      } catch (err) {
        btn.disabled = false
        toast(err.message || 'Failed to accept suggestion')
      }
    })
  })
  root.querySelectorAll('.suggestion-decline').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      btn.disabled = true
      try {
        await deleteSuggestion(btn.dataset.id)
        toast('Declined')
        await onSuggestionsChanged()
      } catch (err) {
        btn.disabled = false
        toast(err.message || 'Failed to decline suggestion')
      }
    })
  })
}
