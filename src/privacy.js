import { icon } from './icons.js'

const PRIVACY_KEY = 'coin_privacy_mode'

export function isPrivacyMode() {
  return localStorage.getItem(PRIVACY_KEY) === '1'
}

export function setPrivacyMode(on) {
  if (on) localStorage.setItem(PRIVACY_KEY, '1')
  else localStorage.removeItem(PRIVACY_KEY)
}

// Shared by every balance-hiding toggle (sidebar, Analysis, the Net Worth
// and Balance Forecast popups) — they all mirror the same isPrivacyMode()
// flag, so the markup and its icon/label state live here, not per view.
export function privacyToggleHtml(id) {
  const on = isPrivacyMode()
  return `<button class="privacy-toggle-btn" id="${id}" title="${on ? 'Show balances' : 'Hide balances'}" aria-pressed="${on}">${icon(on ? 'eyeOff' : 'eye', 16)}</button>`
}

export function syncPrivacyButton(btn, on) {
  btn.innerHTML = icon(on ? 'eyeOff' : 'eye', 16)
  btn.title = on ? 'Show balances' : 'Hide balances'
  btn.setAttribute('aria-pressed', String(on))
}

export function privacyOverlayHtml(label = 'Balances hidden') {
  return `<div class="privacy-overlay">${icon('lock', 14)}<span>${label}</span></div>`
}
