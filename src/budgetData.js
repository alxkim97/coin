// Budget maths shared by the phone (views/budget.js) and desktop
// (desktop/budget.js) Budget pages, so both show the same numbers.
import { EXPENSE_CATEGORIES } from './categories.js'

const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

// Up to `n` months with data, ending at the selected month, each judged
// against today's limits (limits aren't versioned, so that's the only
// yardstick there is — both pages say so under the history).
export function withinHistory(txns, limits, year, month, n = 6) {
  const cats = Object.keys(limits).filter(c => limits[c] > 0 && EXPENSE_CATEGORIES.some(x => x.name === c))
  const spend = {}
  for (const t of txns) {
    if (t.type !== 'expense') continue
    const k = t.date.slice(0, 7)
    ;(spend[k] ||= {})[t.category] = (spend[k][t.category] || 0) + Number(t.amount)
  }
  const curKey = monthKey(new Date())
  const months = []
  for (let i = 0; i < 18 && months.length < n; i++) {
    const k = monthKey(new Date(year, month - i, 1))
    if (k <= curKey && spend[k]) months.push(k)
  }
  months.reverse()
  const limTotal = cats.reduce((sum, c) => sum + limits[c], 0)
  let within = 0, judged = 0
  const totals = months.map(k => {
    const s = cats.reduce((sum, c) => sum + (spend[k]?.[c] || 0), 0)
    if (k !== curKey) { judged++; if (s <= limTotal) within++ }
    return { k, s }
  })
  return { cats, months, spend, totals, limTotal, within, judged, curKey }
}
