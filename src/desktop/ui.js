// Shared building blocks for the desktop (≥860px) views — Ledger's KPI
// cards, card/table chrome, pagination, period control and Chart.js preset.
// Markup-only helpers return strings (same innerHTML idiom as the rest of
// the app); anything that needs wiring has a matching wire*() function.
import { Chart } from 'chart.js'
import { formatMoney, formatMoneyAxis, monthLabel, rangeLabel, escapeHtml } from '../helpers.js'
import { icon, categoryIcon } from '../icons.js'

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// ── Page header ──
export function headHtml(title, sub = '', actions = '') {
  return `
    <div class="d-head">
      <div><h1 class="d-title">${title}</h1>${sub ? `<div class="d-sub">${sub}</div>` : ''}</div>
      ${actions ? `<div class="d-head-actions">${actions}</div>` : ''}
    </div>`
}

// ── KPI card ── kind: income | expense | net | budget | info
export function kpiHtml({ kind = 'net', icon: ic, label, value, valueClass = '', sub = '', extra = '' }) {
  return `
    <div class="d-kpi k-${kind}">
      ${ic ? `<div class="d-kpi-icon">${icon(ic, 14)}</div>` : ''}
      <div class="d-kpi-label">${label}</div>
      <div class="d-kpi-val ${valueClass}">${value}</div>
      ${sub ? `<div class="d-kpi-sub">${sub}</div>` : ''}
      ${extra}
    </div>`
}

export function barHtml(pct, cls = '', labels = null) {
  const w = Math.max(0, Math.min(100, pct || 0))
  return `<div class="d-bar"><span class="${cls}" style="width:${w.toFixed(1)}%"></span></div>${labels ? `<div class="d-bar-labels"><span>${labels[0]}</span><span>${labels[1]}</span></div>` : ''}`
}

export function statusClass(spent, limit) {
  if (!limit) return ''
  if (spent > limit) return 'over'
  return spent / limit >= 0.8 ? 'warn' : ''
}

// ── Card chrome ──
export function cardHtml({ title, sub = '', icon: ic, actions = '', body = '', cls = '', attrs = '' }) {
  return `
    <div class="d-card ${cls}" ${attrs}>
      ${title ? `<div class="d-card-head">
        <div><div class="d-card-title">${ic ? icon(ic, 14) : ''}${title}</div>${sub ? `<div class="d-card-sub">${sub}</div>` : ''}</div>
        ${actions ? `<div class="d-card-actions">${actions}</div>` : ''}
      </div>` : ''}
      ${body}
    </div>`
}

// one-line stand-in for a card with nothing to show (no big empty-state block)
export function emptyCardHtml(title, msg, ic) {
  return `<div class="d-card d-card-empty"><div class="d-card-title">${ic ? icon(ic, 14) : ''}${title}</div><div class="d-card-empty-msg">${msg}</div></div>`
}

// ── Pagination ── Ledger's: info on the left, ← 1 … 4 5 6 … 12 → on the right
export function paginate(list, page, perPage) {
  const totalPages = Math.max(1, Math.ceil(list.length / perPage))
  const p = Math.min(Math.max(1, page), totalPages)
  const start = (p - 1) * perPage
  return { page: p, totalPages, start, items: list.slice(start, start + perPage), total: list.length }
}

export function paginationHtml({ page, totalPages, start, items, total }, noun = 'rows') {
  if (!total) return ''
  let btns = ''
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) btns += `<button class="d-page${p === page ? ' active' : ''}" data-page="${p}">${p}</button>`
    else if (Math.abs(p - page) === 2) btns += '<span class="gap">…</span>'
  }
  return `
    <div class="d-pagination">
      <div class="d-pagination-info">Showing ${start + 1}–${start + items.length} of ${total} ${noun}</div>
      ${totalPages > 1 ? `<div class="d-pages">
        <button class="d-page" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">←</button>
        ${btns}
        <button class="d-page" data-page="${page + 1}" ${page === totalPages ? 'disabled' : ''} aria-label="Next page">→</button>
      </div>` : ''}
    </div>`
}

export function wirePagination(root, onPage) {
  root.querySelectorAll('.d-page[data-page]').forEach(b => {
    b.onclick = () => { if (!b.disabled) onPage(Number(b.dataset.page)) }
  })
}

// ── Period control ── month dropdown + This month + 1M/3M/6M/12M (no arrows)
export const RANGES = [1, 3, 6, 12]

export function periodHtml({ year, month, range = 1, txns, showRange = true }) {
  const now = new Date()
  const cur = now.getFullYear() * 12 + now.getMonth()
  const sel = year * 12 + month
  let first = Math.min(cur, sel)
  for (const t of txns || []) {
    const y = Number(t.date?.slice(0, 4)), m = Number(t.date?.slice(5, 7))
    if (y && m) first = Math.min(first, y * 12 + m - 1)
  }
  const last = Math.max(cur, sel)
  const r = showRange ? range : 1
  const options = []
  for (let k = last; k >= first; k--) {
    const y = Math.floor(k / 12), m = k % 12
    options.push(`<option value="${k}"${k === sel ? ' selected' : ''}>${r > 1 ? rangeLabel(y, m, r) : monthLabel(y, m)}</option>`)
  }
  return `
    <div class="d-period">
      <select id="dPeriodMonth" aria-label="Month">${options.join('')}</select>
      ${sel !== cur ? '<button class="d-btn" id="dPeriodToday">This month</button>' : ''}
      ${showRange ? `<div class="d-seg" role="group" aria-label="Range">${RANGES.map(x => `<button data-range="${x}" class="${x === range ? 'active' : ''}">${x}M</button>`).join('')}</div>` : ''}
    </div>`
}

export function wirePeriod(root, { onMonthChange, onRangeChange }) {
  const sel = root.querySelector('#dPeriodMonth')
  if (sel) sel.onchange = e => { const k = Number(e.target.value); onMonthChange(Math.floor(k / 12), k % 12) }
  const today = root.querySelector('#dPeriodToday')
  if (today) today.onclick = () => { const n = new Date(); onMonthChange(n.getFullYear(), n.getMonth()) }
  root.querySelectorAll('.d-period .d-seg button').forEach(b => { b.onclick = () => onRangeChange?.(Number(b.dataset.range)) })
}

// generic segmented control (analysis windows, projection horizon, …)
export function segHtml(id, options, active) {
  return `<div class="d-seg" id="${id}" role="group">${options.map(o => `<button data-v="${o.v}" class="${String(o.v) === String(active) ? 'active' : ''}">${escapeHtml(o.label)}</button>`).join('')}</div>`
}
export function wireSeg(root, id, onPick) {
  root.querySelectorAll(`#${id} button`).forEach(b => { b.onclick = () => onPick(b.dataset.v) })
}

// ── Charts ──
// One preset so every desktop chart shares Ledger's mono ticks, hairline
// grid and tight bars. Animation is off when the OS asks for reduced motion
// (also what lets the screenshot rig, which freezes the clock, render them).
const instances = {}
export function renderChart(key, canvas, config) {
  instances[key]?.destroy()
  if (!canvas) return null
  instances[key] = new Chart(canvas.getContext('2d'), config)
  return instances[key]
}

export function chartTheme() {
  return {
    text: cssVar('--text3'),
    text2: cssVar('--text2'),
    grid: cssVar('--chart-grid'),
    surface: cssVar('--surface'),
    accent: cssVar('--accent'),
    green: cssVar('--green'),
    red: cssVar('--red'),
    amber: cssVar('--amber'),
    mono: "'DM Mono', ui-monospace, monospace",
    body: "'Outfit', 'Segoe UI', sans-serif",
  }
}

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function baseOptions({ money = true, legend = true, stacked = false, yTicks } = {}) {
  const t = chartTheme()
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: reduced() ? false : { duration: 350 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: legend
        ? { position: 'top', align: 'end', labels: { color: t.text2, font: { family: t.body, size: 11 }, boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'rectRounded', padding: 12 } }
        : { display: false },
      tooltip: {
        backgroundColor: cssVar('--surface'), titleColor: cssVar('--text'), bodyColor: cssVar('--text2'),
        borderColor: cssVar('--border-2'), borderWidth: 1, padding: 10, cornerRadius: 8,
        titleFont: { family: t.body, size: 12, weight: '600' }, bodyFont: { family: t.mono, size: 11 },
        callbacks: money ? { label: ctx => ` ${ctx.dataset.label}: ${formatMoney(ctx.parsed.y ?? ctx.parsed)}` } : {},
      },
    },
    scales: {
      x: { stacked, ticks: { color: t.text, font: { family: t.mono, size: 10 }, maxRotation: 0, autoSkipPadding: 8 }, grid: { display: false }, border: { color: t.grid } },
      y: { stacked, ticks: { color: t.text, font: { family: t.mono, size: 10 }, callback: yTicks || (v => money ? formatMoneyAxis(v) : v), maxTicksLimit: 6 }, grid: { color: t.grid }, border: { display: false } },
    },
  }
}

// tight grouped bars — "tighter bar spacing" ask: wide bars, small gaps
export const BAR = { borderRadius: 3, borderSkipped: false, categoryPercentage: 0.78, barPercentage: 0.92, maxBarThickness: 34 }

// Ledger's original income/expense chart: income bars up, expenses as
// upside-down red bars from the same zero line, sharing one column per
// month — so there's no gap between a month's pair, and wide bars.
export function incomeExpenseConfig(labels, income, expense, extra = []) {
  const t = chartTheme()
  const opts = baseOptions({ stacked: true, yTicks: v => formatMoneyAxis(Math.abs(v)) })
  opts.plugins.tooltip.callbacks = { label: ctx => ` ${ctx.dataset.label}: ${formatMoney(Math.abs(ctx.parsed.y))}` }
  opts.scales.y.grid = { color: ctx => ctx.tick.value === 0 ? cssVar('--border-2') : t.grid, lineWidth: ctx => ctx.tick.value === 0 ? 1.5 : 1 }
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Income', data: income, backgroundColor: t.green, borderRadius: 3, borderSkipped: false, categoryPercentage: 0.86, barPercentage: 0.94, maxBarThickness: 46 },
        { label: 'Expenses', data: expense.map(v => -v), backgroundColor: t.red, borderRadius: 3, borderSkipped: false, categoryPercentage: 0.86, barPercentage: 0.94, maxBarThickness: 46 },
        ...extra,
      ],
    },
    options: opts,
  }
}

export const PALETTE = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--chart-7', '--chart-8']
export function paletteColor(i, name) {
  return name === 'Other' ? cssVar('--chart-other') : cssVar(PALETTE[i % PALETTE.length])
}

export function donutConfig(labels, values, colors) {
  const t = chartTheme()
  const total = values.reduce((s, v) => s + v, 0)
  return {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      animation: reduced() ? false : { duration: 350 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cssVar('--surface'), titleColor: cssVar('--text'), bodyColor: cssVar('--text2'),
          borderColor: cssVar('--border-2'), borderWidth: 1, padding: 10, cornerRadius: 8,
          bodyFont: { family: t.mono, size: 11 },
          callbacks: { label: ctx => ` ${ctx.label}: ${formatMoney(ctx.parsed)} (${total ? (ctx.parsed / total * 100).toFixed(1) : 0}%)` },
        },
      },
    },
  }
}

export function legendHtml(rows, colors) {
  const total = rows.reduce((s, r) => s + r.amount, 0)
  return `<div class="d-legend">${rows.map((r, i) => `
    <div class="d-leg"><span class="d-leg-dot" style="background:${colors[i]}"></span>
      <span class="d-leg-name">${escapeHtml(r.label)}</span>
      <span class="d-leg-val">${formatMoney(Math.round(r.amount))}</span>
      <span class="d-leg-pct">${total ? Math.round(r.amount / total * 100) : 0}%</span></div>`).join('')}</div>`
}

// month key helpers shared by the views
export function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
export function shortMonth(key) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}
// trailing month keys ending at (year, month), oldest first
export function monthKeysEnding(year, month, n) {
  const keys = []
  for (let i = n - 1; i >= 0; i--) keys.push(monthKey(new Date(year, month - i, 1)))
  return keys
}

// One colour per category, used on every badge and donut so a category
// reads the same everywhere. Mid-tone hues that hold up on both themes;
// badges tint their background from it (see .d-cat in desktop.css).
const CATEGORY_COLORS = {
  Rent: '#4f8ff7', Insurance: '#9d7bff', Internet: '#22b8cf', 'Bank/Finance': '#8a94a6',
  Food: '#f59f3a', Groceries: '#3fbf6f', Transport: '#3aa0e8', Health: '#ef5d8f', Utilities: '#e3b52f',
  Investment: '#c9a227', Shopping: '#e45ab8', Social: '#8b6cf0', Travel: '#18b6a4', Education: '#5c6cf0', Other: '#9aa0ab',
  Salary: '#2fbf71', Reimbursement: '#45a6e6', Bonus: '#e0b43a', Overtime: '#37b39a', 'Investment Returns': '#c9a227',
}
const FALLBACK = ['#f07c5a', '#5aa9f0', '#b06cf0', '#4cc38a', '#f0c24c', '#ef6f9f']
export function catColor(name) {
  if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name]
  let h = 0
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return FALLBACK[h % FALLBACK.length]
}
export function catBadge(name, size = 12) {
  return `<span class="d-cat" style="--cat:${catColor(name)}">${categoryIcon(name, size)}${escapeHtml(name)}</span>`
}
