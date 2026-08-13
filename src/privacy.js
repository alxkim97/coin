const PRIVACY_KEY = 'coin_privacy_mode'

export function isPrivacyMode() {
  return localStorage.getItem(PRIVACY_KEY) === '1'
}

export function setPrivacyMode(on) {
  if (on) localStorage.setItem(PRIVACY_KEY, '1')
  else localStorage.removeItem(PRIVACY_KEY)
}
