const PRIVACY_KEY = 'coin_privacy_mode'

export function isPrivacyMode() {
  return localStorage.getItem(PRIVACY_KEY) === '1'
}

export function setPrivacyMode(on) {
  if (on) localStorage.setItem(PRIVACY_KEY, '1')
  else localStorage.removeItem(PRIVACY_KEY)
}

// Shared by every view that has its own balance-hiding toggle button
// (Analysis's Net Worth and Projection sections today) — they all mirror the
// same isPrivacyMode() flag, so the markup and its icon/label state belong
// in one place rather than copied per view.
export function privacyToggleHtml(id) {
  const on = isPrivacyMode()
  return `<button class="privacy-toggle-btn" id="${id}" title="${on ? 'Show balances' : 'Hide balances'}">${on ? '🙈' : '👁️'}</button>`
}
