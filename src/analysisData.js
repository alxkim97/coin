import { localISO, formatMoney, formatDateDMY, sortByDateAsc } from './helpers.js'

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

export function dailySpend(txns, days) {
  const startStr = localISO(daysAgo(days - 1))
  const byDate = {}
  for (const t of txns) {
    if (t.type !== 'expense' || t.date < startStr) continue
    byDate[t.date] = (byDate[t.date] || 0) + Number(t.amount)
  }
  const points = []
  for (let i = days - 1; i >= 0; i--) {
    const ds = localISO(daysAgo(i))
    points.push({ date: ds, amount: byDate[ds] || 0 })
  }
  return points
}

// Top-N categories by spend + everything else folded into "Other" — keeps the
// category donut to a slice count the validated categorical palette actually covers.
export function categoryBreakdown(txns, days, maxSlices = 7) {
  const startStr = localISO(daysAgo(days - 1))
  const sums = {}
  for (const t of txns) {
    if (t.type !== 'expense' || t.date < startStr) continue
    sums[t.category] = (sums[t.category] || 0) + Number(t.amount)
  }
  const sorted = Object.entries(sums).sort((a, b) => b[1] - a[1])
  const top = sorted.slice(0, maxSlices).map(([category, amount]) => ({ category, amount }))
  const otherTotal = sorted.slice(maxSlices).reduce((s, [, v]) => s + v, 0)
  if (otherTotal > 0) top.push({ category: 'Other', amount: otherTotal })
  return top
}

// Per-category, per-month expense totals over the trailing N months — the
// granularity monthlyRollup doesn't have (it only tracks income/expense
// totals). Built for the AI Q&A context digest, where "how much did I spend
// on X in March" needs more than a single rolled-up number.
export function categoryMonthlyBreakdown(txns, months = 12) {
  const now = new Date()
  const keys = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const keySet = new Set(keys)
  const byMonth = Object.fromEntries(keys.map(k => [k, {}]))
  for (const t of txns) {
    if (t.type !== 'expense') continue
    const key = t.date.slice(0, 7)
    if (!keySet.has(key)) continue
    byMonth[key][t.category] = (byMonth[key][t.category] || 0) + Number(t.amount)
  }
  return keys.map(key => ({ month: key, categories: byMonth[key] }))
}

export function monthlyRollup(txns, months = 12) {
  const now = new Date()
  const rows = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('en-US', { month: 'short' })
    rows.push({ key, label, income: 0, expense: 0 })
  }
  const byKey = Object.fromEntries(rows.map(r => [r.key, r]))
  for (const t of txns) {
    const row = byKey[t.date.slice(0, 7)]
    if (!row) continue
    if (t.type === 'income') row.income += Number(t.amount)
    else row.expense += Number(t.amount)
  }
  return rows
}

// {date: amount} for every day with expense activity in the trailing window —
// sparse on purpose, the heatmap fills in zero-days itself.
export function heatmapData(txns, days = 371) {
  const startStr = localISO(daysAgo(days - 1))
  const byDate = {}
  for (const t of txns) {
    if (t.type !== 'expense' || t.date < startStr) continue
    byDate[t.date] = (byDate[t.date] || 0) + Number(t.amount)
  }
  return byDate
}

// A check-in only has to list the accounts you're actually updating that time
// (e.g. just your banks today, just your investments next week) — so "current
// net worth" can't just read the most recent check-in's own items, or
// whichever half you updated last would silently blot out the other half.
// This walks every check-in in date order and keeps the latest known value
// per account name, so partial updates accumulate instead of overwriting.
export function latestAccountValues(networth) {
  const sorted = sortByDateAsc(networth || [])
  const byName = new Map()
  for (const checkin of sorted) {
    for (const item of (checkin.items || [])) {
      const key = item.name.trim().toLowerCase()
      byName.set(key, { name: item.name, category: item.category, value: Number(item.value), asOfDate: checkin.date })
    }
  }
  return [...byName.values()]
}

// Current progress toward a savings goal — either its own manually-updated
// current_amount, or (if linked_account is set) the latest known value of
// that net-worth account via latestAccountValues above. suggestedMonthly
// assumes even pacing to target_date; null with no target_date, an already-
// past target_date, or nothing left to save.
export function goalProgress(goal, networth) {
  let current = Number(goal.current_amount) || 0
  if (goal.linked_account) {
    const match = latestAccountValues(networth).find(a => a.name.toLowerCase() === goal.linked_account.toLowerCase())
    if (match) current = match.value
  }
  const target = Number(goal.target_amount) || 0
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0
  const remaining = Math.max(0, target - current)

  let suggestedMonthly = null
  if (goal.target_date && remaining > 0) {
    const msRemaining = new Date(goal.target_date + 'T00:00:00') - new Date()
    if (msRemaining > 0) {
      const monthsRemaining = Math.max(1, msRemaining / (1000 * 60 * 60 * 24 * 30.44))
      suggestedMonthly = remaining / monthsRemaining
    }
  }

  return { current, target, pct, remaining, suggestedMonthly }
}

// One point per check-in *event*, but each point's total reflects the full
// latest-per-account picture as of that moment (via latestAccountValues),
// not just that one check-in's own items — so logging banks and investments
// as two separate check-ins the same day still produces a combined total on
// the second point instead of a misleading dip back to just one half.
export function netWorthTimeline(networth) {
  const sorted = sortByDateAsc(networth || [])
  const byName = new Map()
  const points = []
  for (const checkin of sorted) {
    for (const item of (checkin.items || [])) {
      byName.set(item.name.trim().toLowerCase(), { category: item.category, value: Number(item.value) })
    }
    let cash = 0, invested = 0, insurance = 0
    for (const v of byName.values()) {
      if (v.category === 'cash') cash += v.value
      else if (v.category === 'insurance') insurance += v.value
      else invested += v.value // unrecognized future category — still counted, just grouped with invested rather than silently dropped
    }
    // legacy check-ins from before multi-asset support have no items at all —
    // fall back to their own cash/invested fields so old history still counts
    if (!checkin.items || !checkin.items.length) {
      cash = Number(checkin.cash) || cash
      invested = Number(checkin.invested) || invested
    }
    points.push({ date: checkin.date, cash, invested, insurance, total: cash + invested + insurance })
  }
  return points
}

// Percent change in total net worth between the first and last check-in
// points — a trend badge only needs the two endpoints, not the full series,
// so this stays a thin wrapper over netWorthTimeline rather than its own scan.
export function netWorthChangePct(networth) {
  const points = netWorthTimeline(networth)
  if (points.length < 2) return null
  const first = points[0].total
  const last = points[points.length - 1].total
  if (first === 0) return null
  return ((last - first) / Math.abs(first)) * 100
}

// Per-account analogue of netWorthTimeline: one entry per account (same
// lowercase-name identity model as latestAccountValues — renaming an
// account looks like a new one with no history, a pre-existing limitation,
// not a regression here), each with its own {date, value} series across
// every check-in that mentioned it, instead of collapsing into the three
// category totals.
export function accountHistory(networth) {
  const sorted = sortByDateAsc(networth || [])
  const byName = new Map()
  for (const checkin of sorted) {
    for (const item of (checkin.items || [])) {
      const key = item.name.trim().toLowerCase()
      if (!byName.has(key)) byName.set(key, { name: item.name, category: item.category, points: [] })
      const entry = byName.get(key)
      entry.category = item.category // keep the most recent category label, in case it was ever recategorized
      entry.points.push({ date: checkin.date, value: Number(item.value) })
    }
  }
  return [...byName.values()]
}

// Pure derived math off accountHistory — no new data needed. changePct is
// null (not 0 or NaN) when the account started at ฿0, since "% change from
// zero" isn't a meaningful number to show.
export function accountReturns(networth) {
  return accountHistory(networth).map(({ name, category, points }) => {
    const first = points[0]
    const last = points[points.length - 1]
    const changeAbs = last.value - first.value
    const changePct = first.value !== 0 ? (changeAbs / Math.abs(first.value)) * 100 : null
    return { name, category, firstDate: first.date, firstValue: first.value, lastDate: last.date, lastValue: last.value, changeAbs, changePct, points }
  })
}

// Forward-looking net worth projection from trailing complete-month averages
// (not the current in-progress month, which would understate spend). Starts
// from the latest check-in if one exists, else from ฿0 — either way it's
// showing "where trend continues from here," not an absolute net worth claim
// when there's no real starting balance on record.
export function computeProjection(txns, networth, months = 12) {
  const now = new Date()
  let incomeSum = 0, expenseSum = 0, investSum = 0
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    for (const t of txns) {
      if (t.date.slice(0, 7) !== key) continue
      if (t.type === 'income') incomeSum += Number(t.amount)
      else {
        expenseSum += Number(t.amount)
        if (t.category === 'Investment') investSum += Number(t.amount)
      }
    }
  }
  const avgIncome = incomeSum / 3
  const avgExpense = expenseSum / 3
  const avgInvest = investSum / 3
  const avgNet = avgIncome - avgExpense

  let phase = 'Saving', phaseIcon = '💰'
  if (avgNet <= 0) { phase = 'Tight Month'; phaseIcon = '⚠️' }
  else if (avgInvest > avgNet * 0.3) { phase = 'Investing'; phaseIcon = '📈' }

  const timeline = netWorthTimeline(networth)
  const latestPoint = timeline[timeline.length - 1]
  const startTotal = latestPoint ? latestPoint.total : 0
  const startDate = latestPoint ? new Date(latestPoint.date + 'T00:00:00') : now

  const points = [{ label: 'Now', value: Math.round(startTotal) }]
  let running = startTotal
  for (let i = 1; i <= months; i++) {
    running += avgNet
    const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1)
    points.push({ label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), value: Math.round(running) })
  }

  return { phase, phaseIcon, avgIncome, avgExpense, avgNet, hasCheckin: !!latestPoint, points }
}

// All-time highlight stats — separate from generateInsights (which is a
// rolling 30-day behavior read); these are "personal bests" that only move
// when a new record is actually set, so they don't churn month to month.
// `asOf` bounds the no-spend-streak walk (defaults to today, the original
// all-time behavior) — computeYearReview passes a year's Dec 31 (or today,
// if the year isn't over yet) so a review of an old year doesn't silently
// walk the streak all the way through the present.
export function computePersonalRecords(txns, asOf = new Date()) {
  if (!txns.length) return []

  const incomeByDate = {}, expenseByDate = {}
  for (const t of txns) {
    const bucket = t.type === 'income' ? incomeByDate : expenseByDate
    bucket[t.date] = (bucket[t.date] || 0) + Number(t.amount)
  }
  const topEntry = obj => Object.entries(obj).reduce((best, [d, v]) => (!best || v > best.v ? { d, v } : best), null)
  const bestIncomeDay = topEntry(incomeByDate)
  const bestSpendDay = topEntry(expenseByDate)

  let biggestPurchase = null
  for (const t of txns) {
    if (t.type !== 'expense') continue
    if (!biggestPurchase || Number(t.amount) > biggestPurchase.amount) {
      biggestPurchase = { amount: Number(t.amount), date: t.date, label: t.subcategory || t.category }
    }
  }

  // Longest run of consecutive days with zero expenses logged, over the
  // full history so far (first-ever transaction through today).
  const allDates = [...new Set(txns.map(t => t.date))].sort()
  const expenseDates = new Set(txns.filter(t => t.type === 'expense').map(t => t.date))
  const walkEnd = new Date(asOf)
  walkEnd.setHours(0, 0, 0, 0)
  let longest = 0, current = 0, longestEnd = null
  for (let d = new Date(allDates[0] + 'T00:00:00'); d <= walkEnd; d.setDate(d.getDate() + 1)) {
    const ds = localISO(d)
    if (expenseDates.has(ds)) {
      current = 0
    } else {
      current++
      if (current > longest) { longest = current; longestEnd = ds }
    }
  }

  const byMonth = {}
  for (const t of txns) {
    const key = t.date.slice(0, 7)
    if (!byMonth[key]) byMonth[key] = { income: 0, expense: 0 }
    if (t.type === 'income') byMonth[key].income += Number(t.amount)
    else byMonth[key].expense += Number(t.amount)
  }
  let bestMonth = null
  for (const [key, v] of Object.entries(byMonth)) {
    const net = v.income - v.expense
    if (!bestMonth || net > bestMonth.net) bestMonth = { key, net }
  }

  const records = []
  if (bestIncomeDay) records.push({ icon: '🏆', label: 'Biggest Income Day', value: formatMoney(bestIncomeDay.v), date: bestIncomeDay.d })
  if (bestSpendDay) records.push({ icon: '💸', label: 'Biggest Spend Day', value: formatMoney(bestSpendDay.v), date: bestSpendDay.d })
  if (biggestPurchase) records.push({ icon: '🛍️', label: 'Biggest Single Purchase', value: `${formatMoney(biggestPurchase.amount)} · ${biggestPurchase.label}`, date: biggestPurchase.date })
  if (longest > 0) records.push({ icon: '🧘', label: 'Longest No-Spend Streak', value: `${longest} day${longest === 1 ? '' : 's'}`, date: longestEnd })
  if (bestMonth) {
    const [y, m] = bestMonth.key.split('-').map(Number)
    records.push({ icon: '📈', label: 'Best Savings Month', value: formatMoney(bestMonth.net), dateLabel: new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) })
  }
  return records
}

// A year's recap — total income/expense/savings, top categories, a
// prior-year comparison when there's data for it, and computePersonalRecords
// re-scoped to the year by simply pre-filtering txns first (it has no
// internal date logic that assumes "now", so this needed no changes there).
export function computeYearReview(txns, year) {
  const yearStr = String(year)
  const yearTxns = txns.filter(t => t.date.slice(0, 4) === yearStr)
  const prevYearTxns = txns.filter(t => t.date.slice(0, 4) === String(year - 1))

  let totalIncome = 0, totalExpense = 0
  const categorySums = {}
  for (const t of yearTxns) {
    if (t.type === 'income') totalIncome += Number(t.amount)
    else {
      totalExpense += Number(t.amount)
      categorySums[t.category] = (categorySums[t.category] || 0) + Number(t.amount)
    }
  }
  const topCategories = Object.entries(categorySums)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, amount]) => ({ category, amount }))

  let prevIncome = 0, prevExpense = 0
  for (const t of prevYearTxns) {
    if (t.type === 'income') prevIncome += Number(t.amount)
    else prevExpense += Number(t.amount)
  }
  const hasPrevYear = prevYearTxns.length > 0
  const incomeChangePct = hasPrevYear && prevIncome > 0 ? ((totalIncome - prevIncome) / prevIncome) * 100 : null
  const expenseChangePct = hasPrevYear && prevExpense > 0 ? ((totalExpense - prevExpense) / prevExpense) * 100 : null

  const netSaved = totalIncome - totalExpense
  const savingsRate = totalIncome > 0 ? (netSaved / totalIncome) * 100 : null
  const activeMonths = new Set(yearTxns.map(t => t.date.slice(0, 7))).size

  // Bounds the no-spend-streak walk inside computePersonalRecords to this
  // year — Dec 31 for a past year, today if the year isn't over yet — so
  // reviewing e.g. 2024 doesn't walk that streak all the way through today.
  const yearEnd = new Date(year, 11, 31)
  const now = new Date()
  const recordsAsOf = yearEnd < now ? yearEnd : now

  return {
    year,
    hasData: yearTxns.length > 0,
    totalIncome, totalExpense, netSaved, savingsRate, activeMonths,
    topCategories,
    incomeChangePct, expenseChangePct,
    personalRecords: computePersonalRecords(yearTxns, recordsAsOf),
  }
}

export function generateInsights(txns) {
  const insights = []

  const curMap = Object.fromEntries(categoryBreakdown(txns, 30, 99).map(c => [c.category, c.amount]))
  const prevStart = localISO(daysAgo(59))
  const prevEnd = localISO(daysAgo(30))
  const prevSums = {}
  for (const t of txns) {
    if (t.type !== 'expense' || t.date < prevStart || t.date > prevEnd) continue
    prevSums[t.category] = (prevSums[t.category] || 0) + Number(t.amount)
  }
  let biggestIncrease = null
  for (const [cat, amt] of Object.entries(curMap)) {
    const prev = prevSums[cat] || 0
    if (prev < 100) continue // skip noisy % swings off a near-zero base
    const pct = Math.round(((amt - prev) / prev) * 100)
    if (pct >= 15 && (!biggestIncrease || pct > biggestIncrease.pct)) biggestIncrease = { cat, pct }
  }
  if (biggestIncrease) {
    insights.push(`${biggestIncrease.cat} spend is ${biggestIncrease.pct}% higher than the previous 30 days.`)
  }

  const daily = dailySpend(txns, 30)
  const activeDays = daily.filter(d => d.amount > 0)
  if (activeDays.length) {
    const top = activeDays.reduce((a, b) => (b.amount > a.amount ? b : a))
    const weekday = new Date(top.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })
    insights.push(`Your biggest spending day in the last 30 days was ${weekday} ${formatDateDMY(top.date)} at ${formatMoney(top.amount)}.`)
  }

  const noSpendDays = daily.length - activeDays.length
  if (noSpendDays > 0) {
    insights.push(`You had ${noSpendDays} day${noSpendDays === 1 ? '' : 's'} with no spending in the last 30 days.`)
  }

  return insights
}
