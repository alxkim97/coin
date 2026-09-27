// Pure logic for the "Remind" repeat-purchase mode — surfaced as a Bills Due
// list on the Dashboard instead of silently auto-posting (Auto mode) or
// waiting to be manually picked (Quick mode). A card payment can fail and a
// utility's due date shifts bill to bill, so this mode asks for a tap-to-
// confirm instead of assuming the date arriving means it was paid. Kept
// side-effect-free (no network, no DOM) so the due/advance/auto-stop rules
// can be unit-tested directly.
import { advanceDate, todayISO } from './helpers.js'
import { categoryBudgetType } from './categories.js'

// Bills due today or overdue, from a full recurring list — soonest first.
export function billsDue(recurring, today = todayISO()) {
  return (recurring || [])
    .filter(r => r.active && r.mode === 'remind' && r.next_due && r.next_due <= today)
    .sort((a, b) => a.next_due.localeCompare(b.next_due))
}

// What confirming a payment on `item` should produce: the transaction to
// log, and the patch to apply back to the recurring row — due date advanced,
// installment count incremented, and auto-deactivated once a fixed-term item
// (e.g. a 10-month PC installment) hits its total. `installments_total` left
// null means "ongoing" (rent, an annual subscription) and never auto-stops.
export function computeMarkPaid(item, { amount, date }) {
  const paidCount = (item.installments_paid || 0) + 1
  const isDone = item.installments_total != null && paidCount >= item.installments_total
  return {
    transaction: {
      type: item.type,
      amount,
      date,
      category: item.category,
      subcategory: item.subcategory || null,
      notes: item.notes || null,
      budget_type: item.type === 'expense' ? categoryBudgetType(item.category) : null,
      is_credit_card: item.is_credit_card || false,
      is_shopee: item.is_shopee || false,
    },
    recurringPatch: {
      next_due: advanceDate(date, item.frequency),
      installments_paid: paidCount,
      active: !isDone,
    },
    isDone,
  }
}
