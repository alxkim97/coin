// Desktop top toolbar — Ledger's layout: search on the left; period control,
// Customize, privacy, theme and "+ Add transaction" on the right. Rebuilt on
// every app render like the sidebar.
import { icon } from '../icons.js'
import { escapeHtml } from '../helpers.js'
import { periodHtml, wirePeriod } from './ui.js'
import { isPrivacyMode } from '../privacy.js'

// which views get the period control, and whether it shows the 1M–12M range
const PERIOD_VIEWS = { dashboard: true, transactions: true, budget: false }

export function renderTopbar(el, opts) {
  const { view, year, month, range, txns, searchQuery, customizing } = opts
  const hasPeriod = view in PERIOD_VIEWS
  const privacyOn = isPrivacyMode()
  const dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
    (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)

  el.innerHTML = `
    <div class="desk-search">
      ${icon('search', 13)}
      <input id="deskSearch" type="search" placeholder="Search transactions…" value="${escapeHtml(searchQuery || '')}" autocomplete="off" />
    </div>
    <div class="desk-topbar-right">
      ${hasPeriod ? periodHtml({ year, month, range, txns, showRange: PERIOD_VIEWS[view] }) + '<div class="desk-sep"></div>' : ''}
      ${view === 'dashboard' ? `<button class="d-btn ${customizing ? 'active' : ''}" id="deskCustomize" title="Rearrange or hide dashboard widgets">${icon('layers', 13)}<span class="lbl">Customize</span></button>` : ''}
      <button class="d-btn icon-only" id="deskPrivacy" title="${privacyOn ? 'Show balances' : 'Hide balances'}" aria-pressed="${privacyOn}">${icon(privacyOn ? 'eyeOff' : 'eye', 14)}</button>
      <button class="d-btn icon-only" id="deskTheme" title="Switch to ${dark ? 'light' : 'dark'} mode">${icon(dark ? 'sun' : 'moon', 14)}</button>
      <div class="desk-sep"></div>
      <button class="d-btn-primary" id="deskAdd">${icon('plus', 13)}Add transaction</button>
    </div>
  `

  if (hasPeriod) wirePeriod(el, opts)
  el.querySelector('#deskCustomize')?.addEventListener('click', opts.onToggleCustomize)
  el.querySelector('#deskPrivacy').onclick = opts.onTogglePrivacy
  el.querySelector('#deskTheme').onclick = () => opts.onToggleTheme(dark)
  el.querySelector('#deskAdd').onclick = opts.onAdd
  el.querySelector('#deskSearch').oninput = e => opts.onSearch(e.target.value)
}
