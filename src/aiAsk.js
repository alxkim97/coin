import { categoryBreakdown, categoryMonthlyBreakdown, latestAccountValues } from './analysisData.js'
import { computeSuggestedLimits, formatMoney, localISO } from './helpers.js'
import { API_BASE } from './apiConfig.js'

// How far back raw per-transaction detail goes in the digest — bounded so the
// prompt doesn't grow unbounded for a long-time user, but wide enough that
// "what did I buy at Makro last week" resolves by vendor name, not just totals.
const RAW_TXN_MONTHS = 6
const MAX_RAW_TXN_LINES = 400 // safety cap alongside api/ask.js's own length check

function recentTxnsDigest(txns) {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - RAW_TXN_MONTHS)
  const cutoffStr = localISO(cutoff)
  const lines = txns
    .filter(t => t.date >= cutoffStr)
    .map(t => `${t.date} | ${t.type} | ${t.category}${t.subcategory ? ' / ' + t.subcategory : ''} | ${formatMoney(t.amount)}${t.notes ? ' | ' + t.notes : ''}`)
  if (!lines.length) return '(none)'
  if (lines.length <= MAX_RAW_TXN_LINES) return lines.join('\n')
  const trimmed = lines.slice(0, MAX_RAW_TXN_LINES)
  return `${trimmed.join('\n')}\n(${lines.length - MAX_RAW_TXN_LINES} more recent transactions omitted for length)`
}

function budgetsDigest(budgets) {
  if (!budgets?.length) return '(no budgets set)'
  return budgets.map(b => `${b.category}: ${formatMoney(b.monthly_limit)}/mo limit`).join('\n')
}

function categoryMonthlyDigest(txns) {
  return categoryMonthlyBreakdown(txns, 6)
    .map(({ month, categories }) => {
      const entries = Object.entries(categories)
      const body = entries.length ? entries.map(([c, v]) => `${c}=${formatMoney(v)}`).join(', ') : '(none)'
      return `${month}: ${body}`
    })
    .join('\n')
}

function netWorthDigest(networth) {
  const accounts = latestAccountValues(networth)
  if (!accounts.length) return '(no net worth check-ins logged)'
  return accounts.map(a => `${a.name} (${a.category}): ${formatMoney(a.value)} as of ${a.asOfDate}`).join('\n')
}

function suggestedLimitsDigest(txns) {
  const entries = Object.entries(computeSuggestedLimits(txns, 3))
  if (!entries.length) return '(not enough data)'
  return entries.map(([cat, amt]) => `${cat}: ~${formatMoney(amt)}/mo (trailing 3-month average)`).join('\n')
}

export function buildContextDigest({ txns, budgets, networth }) {
  return [
    `## Recent transactions (last ${RAW_TXN_MONTHS} months)`,
    recentTxnsDigest(txns),
    '',
    '## Category spend by month (last 6 months)',
    categoryMonthlyDigest(txns),
    '',
    '## Top spending categories (trailing 30 days)',
    categoryBreakdown(txns, 30).map(c => `${c.category}: ${formatMoney(c.amount)}`).join('\n') || '(none)',
    '',
    '## Current budgets',
    budgetsDigest(budgets),
    '',
    '## Trailing 3-month average spend per category (used for suggested budget limits)',
    suggestedLimitsDigest(txns),
    '',
    '## Net worth — latest known value per account',
    netWorthDigest(networth),
  ].join('\n')
}

export async function askQuestion({ question, txns, budgets, networth, session }) {
  const context = buildContextDigest({ txns, budgets, networth })
  const res = await fetch(`${API_BASE}/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || ''}`,
    },
    body: JSON.stringify({ question, context }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to get an answer')
  return data.answer
}
