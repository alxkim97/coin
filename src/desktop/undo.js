// Undo / redo for transaction changes on desktop (Ctrl+Z / Ctrl+Y), like
// Ledger's. Each action knows how to reverse and replay itself against
// Supabase; the stack lives for the session only. A re-added row gets a new
// id (same data), so actions carry the current id in a closure.
import { addTransaction, updateTransaction, deleteTransaction } from '../supabase.js'
import { formatMoney } from '../helpers.js'

const LIMIT = 40
const undoStack = []
const redoStack = []
const listeners = new Set()

const notify = () => listeners.forEach(fn => fn())
export function onUndoChange(fn) { listeners.add(fn); return () => listeners.delete(fn) }
export function undoLabel() { return undoStack[undoStack.length - 1]?.label || null }
export function redoLabel() { return redoStack[redoStack.length - 1]?.label || null }

export function record(action) {
  undoStack.push(action)
  if (undoStack.length > LIMIT) undoStack.shift()
  redoStack.length = 0
  notify()
}

export async function undo() {
  const a = undoStack.pop()
  if (!a) return null
  try { await a.undo() } catch (e) { undoStack.push(a); notify(); throw e }
  redoStack.push(a)
  notify()
  return a
}

export async function redo() {
  const a = redoStack.pop()
  if (!a) return null
  try { await a.redo() } catch (e) { redoStack.push(a); notify(); throw e }
  undoStack.push(a)
  notify()
  return a
}

const FIELDS = ['type', 'amount', 'date', 'category', 'subcategory', 'notes', 'budget_type', 'is_credit_card', 'is_shopee', 'tags', 'receipt_path']
const pick = row => Object.fromEntries(FIELDS.filter(f => f in row).map(f => [f, row[f]]))
const describe = t => `${t.category} ${formatMoney(t.amount)}`

export function addedAction(saved) {
  let id = saved.id
  return {
    label: `add ${describe(saved)}`,
    undo: () => deleteTransaction(id),
    redo: async () => { id = (await addTransaction(pick(saved))).id },
  }
}

export function editedAction(before, after) {
  const id = after.id
  return {
    label: `edit ${describe(after)}`,
    undo: () => updateTransaction(id, pick(before)),
    redo: () => updateTransaction(id, pick(after)),
  }
}

export function deletedAction(txn) {
  let id = txn.id
  return {
    label: `delete ${describe(txn)}`,
    undo: async () => { id = (await addTransaction(pick(txn))).id },
    redo: () => deleteTransaction(id),
  }
}
