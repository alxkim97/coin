import { computeYearReview } from './analysisData.js'
import { formatMoney, formatDateDMY, escapeHtml } from './helpers.js'
import { icon, categoryIcon } from './icons.js'

// Persists across re-opens within the session, same idiom as analysis.js's period.
let selectedYear = null

// Same overlay pattern as the other dialogs — reached via a link-card on the
// Analysis page rather than a page hanging off Settings.
export function openYearReview({ txns }) {
  const years = [...new Set(txns.map(t => Number(t.date.slice(0, 4))))].sort((a, b) => b - a)
  if (selectedYear === null || !years.includes(selectedYear)) {
    const now = new Date()
    const daysIntoYear = Math.ceil((now - new Date(now.getFullYear(), 0, 1)) / 86400000)
    selectedYear = (daysIntoYear < 30 && years.includes(now.getFullYear() - 1))
      ? now.getFullYear() - 1
      : (years[0] ?? now.getFullYear())
  }

  const overlay = document.createElement('div')
  overlay.className = 'confirm-overlay'
  document.body.appendChild(overlay)

  function render() {
    const review = computeYearReview(txns, selectedYear)
    overlay.innerHTML = `
      <div class="confirm-box modal-box-lg">
        <div class="nwq-title">Year in review</div>
        ${years.length ? `
          <div class="range-toggle" id="yearToggle" style="margin-top:10px">
            ${years.map(y => `<button data-year="${y}" class="${y === selectedYear ? 'active' : ''}">${y}</button>`).join('')}
          </div>
        ` : ''}
        ${review.hasData ? reviewContentHtml(review) : `<div class="empty-state">No transactions logged in ${selectedYear}.</div>`}
      </div>
    `
    wire()
  }

  function wire() {
    overlay.onclick = e => { if (e.target === overlay) close() }
    overlay.querySelectorAll('#yearToggle button').forEach(btn => {
      btn.onclick = () => { selectedYear = Number(btn.dataset.year); render() }
    })
  }

  function close() { overlay.remove() }

  render()
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
    <div class="card nw-hero-card" style="margin:16px 0">
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

    <h2>Top categories</h2>
    <div class="card">
      ${review.topCategories.length ? review.topCategories.map(c => `
        <div class="vendor-row">
          <div class="vendor-rank">${categoryIcon(c.category)}</div>
          <div class="vendor-name">${escapeHtml(c.category)}</div>
          <div class="vendor-amt">${formatMoney(c.amount)}</div>
        </div>
      `).join('') : '<div class="empty-state">No expenses logged.</div>'}
    </div>

    <h2>Personal records</h2>
    <div class="card"><div class="record-grid">
      ${review.personalRecords.length ? review.personalRecords.map(r => `
        <div class="record-card">
          <div class="record-icon">${icon(r.icon, 22)}</div>
          <div class="record-val">${r.value}</div>
          <div class="record-lbl">${r.label}</div>
          <div class="record-date">${r.date ? formatDateDMY(r.date) : (r.dateLabel || '')}</div>
        </div>
      `).join('') : '<div class="empty-state">Not enough data for records this year.</div>'}
    </div></div>
  `
}
