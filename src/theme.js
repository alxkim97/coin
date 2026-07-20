const MODE_KEY = 'coin_theme_mode'
const ACCENT_KEY = 'coin_theme_accent'

export const ACCENTS = [
  { id: 'blue', label: 'Blue', swatch: '#2563eb' },
  { id: 'violet', label: 'Violet', swatch: '#7c5cfc' },
  { id: 'forest', label: 'Forest', swatch: '#15803d' },
  { id: 'amber', label: 'Amber', swatch: '#b45309' },
  { id: 'rose', label: 'Rose', swatch: '#be185d' },
  { id: 'teal', label: 'Teal', swatch: '#0f766e' },
  { id: 'indigo', label: 'Indigo', swatch: '#4f52e8' },
]

export function getMode() {
  return localStorage.getItem(MODE_KEY) || 'system'
}

export function setMode(mode) {
  localStorage.setItem(MODE_KEY, mode)
  applyTheme()
}

export function getAccent() {
  return localStorage.getItem(ACCENT_KEY) || 'blue'
}

export function setAccent(accent) {
  localStorage.setItem(ACCENT_KEY, accent)
  applyTheme()
}

export function applyTheme() {
  const root = document.documentElement
  const mode = getMode()
  const accent = getAccent()
  if (mode === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', mode)
  }
  if (accent === 'blue') {
    root.removeAttribute('data-accent')
  } else {
    root.setAttribute('data-accent', accent)
  }
}
