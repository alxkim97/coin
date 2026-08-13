import { localISO, formatMoney, formatDateDMY } from './helpers.js'

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

  const sorted = [...networth].sort((a, b) => b.date.localeCompare(a.date))
  const latest = sorted[0]
  const startTotal = latest ? Number(latest.cash) + Number(latest.invested) : 0
  const startDate = latest ? new Date(latest.date + 'T00:00:00') : now

  const points = [{ label: 'Now', value: Math.round(startTotal) }]
  let running = startTotal
  for (let i = 1; i <= months; i++) {
    running += avgNet
    const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1)
    points.push({ label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), value: Math.round(running) })
  }

  return { phase, phaseIcon, avgIncome, avgExpense, avgNet, hasCheckin: !!latest, points }
}

// All-time highlight stats — separate from generateInsights (which is a
// rolling 30-day behavior read); these are "personal bests" that only move
// when a new record is actually set, so they don't churn month to month.
export function computePersonalRecords(txns) {
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
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let longest = 0, current = 0, longestEnd = null
  for (let d = new Date(allDates[0] + 'T00:00:00'); d <= today; d.setDate(d.getDate() + 1)) {
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
