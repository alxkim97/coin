import { localISO } from './helpers.js'

function uniqueDates(txns) {
  return [...new Set(txns.map(t => t.date))].sort()
}

// Current (still-ongoing) streak, not best-ever — for the dashboard widget.
// Today not being logged yet doesn't break it, so opening the app first thing
// in the morning doesn't show yesterday's streak as already lost.
export function computeCurrentLoggingStreak(txns) {
  const dateSet = new Set(txns.map(t => t.date))
  const cursor = new Date()
  if (!dateSet.has(localISO(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (dateSet.has(localISO(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export function computeLoggingStreak(txns) {
  const dates = uniqueDates(txns)
  let best = 0, cur = 0, prev = null
  for (const d of dates) {
    const dt = new Date(d + 'T00:00:00')
    cur = prev && Math.round((dt - prev) / 86400000) === 1 ? cur + 1 : 1
    if (cur > best) best = cur
    prev = dt
  }
  return best
}

// Consecutive complete months (walking backward from last month, skipping the
// still-in-progress current month) where total expense stayed within total
// budgeted limits. Stops at the first over-budget month or the first month
// with no logged data at all.
export function computeBudgetStreak(txns, budgets) {
  const totalLimit = budgets.reduce((s, b) => s + (Number(b.monthly_limit) || 0), 0)
  if (!totalLimit) return 0
  const byMonth = {}
  for (const t of txns) {
    if (t.type !== 'expense') continue
    const key = t.date.slice(0, 7)
    byMonth[key] = (byMonth[key] || 0) + Number(t.amount)
  }
  const now = new Date()
  let streak = 0
  for (let i = 1; ; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!(key in byMonth)) break
    if (byMonth[key] <= totalLimit) streak++
    else break
  }
  return streak
}

export function getAchievementDefs(txns, budgets, recurring) {
  const totalDays = uniqueDates(txns).length
  const totalEntries = txns.length
  const bestStreak = computeLoggingStreak(txns)
  const uniqueCategories = new Set(txns.filter(t => t.type === 'expense').map(t => t.category)).size
  const budgetStreak = computeBudgetStreak(txns, budgets)
  const activeRecurring = (recurring || []).filter(r => r.active).length

  return [
    { icon: '🏁', name: 'First Log', desc: 'Log your first transaction', u: totalDays >= 1 },
    { icon: '📝', name: '10 Days', desc: 'Log on 10 different days', u: totalDays >= 10, prog: `${Math.min(totalDays, 10)}/10` },
    { icon: '📅', name: '30 Days', desc: 'Log on 30 different days', u: totalDays >= 30, prog: `${Math.min(totalDays, 30)}/30` },
    { icon: '💯', name: 'Century', desc: 'Log on 100 different days', u: totalDays >= 100, prog: `${Math.min(totalDays, 100)}/100` },
    { icon: '💎', name: 'Elite 200', desc: 'Log on 200 different days', u: totalDays >= 200, prog: `${Math.min(totalDays, 200)}/200` },

    { icon: '⚡', name: '3-Day Streak', desc: 'Log 3 days in a row', u: bestStreak >= 3 },
    { icon: '🔥', name: 'Week Warrior', desc: 'Log 7 days in a row', u: bestStreak >= 7, prog: `${Math.min(bestStreak, 7)}/7` },
    { icon: '🌟', name: 'Fortnight', desc: 'Log 14 days in a row', u: bestStreak >= 14, prog: `${Math.min(bestStreak, 14)}/14` },
    { icon: '👑', name: 'Month Master', desc: 'Log 30 days in a row', u: bestStreak >= 30, prog: `${Math.min(bestStreak, 30)}/30` },
    { icon: '🏔️', name: '50-Day Streak', desc: 'Log 50 days in a row', u: bestStreak >= 50, prog: `${Math.min(bestStreak, 50)}/50` },

    { icon: '🧾', name: '100 Entries', desc: 'Log 100 transactions total', u: totalEntries >= 100, prog: `${Math.min(totalEntries, 100)}/100` },
    { icon: '📚', name: '500 Entries', desc: 'Log 500 transactions total', u: totalEntries >= 500, prog: `${Math.min(totalEntries, 500)}/500` },
    { icon: '🗄️', name: '1K Entries', desc: 'Log 1,000 transactions total', u: totalEntries >= 1000, prog: `${Math.min(totalEntries, 1000)}/1000` },

    { icon: '⚖️', name: 'On Budget', desc: 'Stay under your total budget for a full month', u: budgetStreak >= 1 },
    { icon: '🛡️', name: 'Budget Pro', desc: 'Stay under budget 3 months in a row', u: budgetStreak >= 3, prog: `${Math.min(budgetStreak, 3)}/3` },
    { icon: '🏆', name: 'Budget Master', desc: 'Stay under budget 6 months in a row', u: budgetStreak >= 6, prog: `${Math.min(budgetStreak, 6)}/6` },

    { icon: '🗂️', name: 'Well-Rounded', desc: 'Log expenses in 5 different categories', u: uniqueCategories >= 5, prog: `${Math.min(uniqueCategories, 5)}/5` },
    { icon: '🌈', name: 'Full Spectrum', desc: 'Log expenses in 10 different categories', u: uniqueCategories >= 10, prog: `${Math.min(uniqueCategories, 10)}/10` },

    { icon: '🔁', name: 'On Repeat', desc: 'Set up your first repeat purchase', u: activeRecurring >= 1 },
    { icon: '⚙️', name: 'Automated', desc: 'Have 3 active repeat purchases', u: activeRecurring >= 3, prog: `${Math.min(activeRecurring, 3)}/3` },
  ]
}
