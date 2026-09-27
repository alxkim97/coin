import { computeYearReview } from '../analysisData.js'
import { formatMoney, formatDateDMY, escapeHtml } from '../helpers.js'
import { CATEGORY_ICONS } from '../categories.js'

// Persists across re-renders within the session, same idiom as every other
// view's module-level state (transactions.js's filters, analysis.js's period).
let selectedYear = null

export function renderYearReview(container, { txns, onBack }) {
  const years = [...new Set(txns.map(t => Number(t.date.slice(0, 4))))].sort((a, b) => b - a)

  if (selectedYear === null || !years.includes(selectedYear)) {
    const now = new Date()
    const daysIntoYear = Math.ceil((now - new Date(now.getFullYear(), 0, 1)) / 86400000)
    // less than a month into a new year, there's barely anything to review yet —
    // default to the prior (complete-ish) year instead if it has data
    selectedYear = (daysIntoYear < 30 && years.includes(now.getFullYear() - 1))
      ? now.getFullYear() - 1
      : (years[0] ?? now.getFullYear())
  }

  const review = computeYearReview(txns, selectedYear)

  container.innerHTML = `
    <button class="link-btn" id="yrBack" style="margin-bottom:8px">‹ Back to Settings</button>
    <div class="top-bar"><h1>Year in Review</h1></div>
    ${years.length ? `
      <div class="range-toggle" id="yearToggle">
        ${years.map(y => `<button data-year="${y}" class="${y === selectedYear ? 'active' : ''}">${y}</button>`).join('')}
      </div>
    ` : ''}
    ${review.hasData ? reviewContentHtml(review) : `<div class="empty-state">No transactions logged in ${selectedYear}.</div>`}
  `

  container.querySelector('#yrBack').onclick = onBack
  container.querySelectorAll('#yearToggle button').forEach(btn => {
    btn.onclick = () => { selectedYear = Number(btn.dataset.year); renderYearReview(container, { txns, onBack }) }
  })
}

function changeBadgeHtml(pct, goodWhenNegative) {
  if (pct == null) return ''
  const good = goodWhenNegative ? pct <= 0 : pct >= 0
  const arrow = pct >= 0 ? '▲' : '▼'
  return `<div class="holding-change ${good ? 'pos' : 'neg'}">${arrow} ${Math.abs(pct).toFixed(0)}% vs last year</div>`
}

function reviewContentHtml(review) {
  const savedColor = review.netSaved >= 0 ? 'var(--green)' : 'var(--red)'
  return `
    <div class="card nw-hero-card" style="margin-bottom:16px">
      <div class="nw-hero-value" style="color:${savedColor}">${formatMoney(review.netSaved)}</div>
      <div class="nw-hero-trend">saved in ${review.year}${review.savingsRate != null ? ` · ${review.savingsRate.toFixed(0)}% savings rate` : ''}</div>
    </div>

    <div class="summary-grid" style="margin-bottom:20px">
      <div class="summary-tile">
        <div class="label">Income</div>
        <div class="value income">${formatMoney(review.totalIncome)}</div>
        ${changeBadgeHtml(review.incomeChangePct, false)}
      </div>
      <div class="summary-tile">
        <div class="label">Expenses</div>
        <div class="value expense">${formatMoney(review.totalExpense)}</div>
        ${changeBadgeHtml(review.expenseChangePct, true)}
      </div>
      <div class="summary-tile">
        <div class="label">Active Months</div>
        <div class="value">${review.activeMonths}/12</div>
      </div>
    </div>

    <h2>Top Categories</h2>
    <div class="card">
      ${review.topCategories.length ? review.topCategories.map(c => `
        <div class="vendor-row">
          <div class="vendor-rank">${CATEGORY_ICONS[c.category] || '💵'}</div>
          <div class="vendor-name">${escapeHtml(c.category)}</div>
          <div class="vendor-amt">${formatMoney(c.amount)}</div>
        </div>
      `).join('') : '<div class="empty-state">No expenses logged.</div>'}
    </div>

    <h2>Personal Records</h2>
    <div class="card"><div class="record-grid">
      ${review.personalRecords.length ? review.personalRecords.map(r => `
        <div class="record-card">
          <div class="record-icon">${r.icon}</div>
          <div class="record-val">${r.value}</div>
          <div class="record-lbl">${r.label}</div>
          <div class="record-date">${r.date ? formatDateDMY(r.date) : (r.dateLabel || '')}</div>
        </div>
      `).join('') : '<div class="empty-state">Not enough data for records this year.</div>'}
    </div></div>
  `
}
